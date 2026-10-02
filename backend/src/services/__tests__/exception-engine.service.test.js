/**
 * PC-7b exception engine: the reconciliation of findings with stored rows
 * (open / refresh / unchanged / cleared / dismissed-not-reopened /
 * worsened-reopened), the failed- and skipped-rule rules, dryRun, the
 * listeners, the dismissal and the debounced enqueue. Prisma is mocked: this
 * proves the engine's decisions; the live suite proves them against Postgres.
 */
jest.mock("../../config/db", () => ({
  prisma: {
    project: { findFirst: jest.fn() },
    projectException: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    backgroundJob: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));
jest.mock("../../jobs/job.service", () => ({
  JOB_TYPES: { EXCEPTIONS_EVALUATE: "exceptions.evaluate" },
  JOB_STATUSES: { QUEUED: "queued", RUNNING: "running" },
  enqueueJob: jest.fn(),
}));

const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const jobService = require("../../jobs/job.service");
const engine = require("../exception-engine.service");

const ORG = "org-1";
const PROJECT = "project-1";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const quiet = { log: () => {} };

const finding = (overrides = {}) => ({
  subjectType: "boq_item",
  subjectId: "item-1",
  measured: { value: 110, unitCode: "m3", basis: "installed basis" },
  limit: { value: 100, unitCode: "m3", basis: "limit basis" },
  groupKeys: { wbsNodeId: "wbs-1" },
  data: { label: "1.1 Concrete" },
  ...overrides,
});
const ruleOf = (kind, rows, extra = {}) => ({ kind, severity: "warning", subjectType: "boq_item", module: "boq", boqDerived: true, evaluate: jest.fn(async () => rows), ...extra });

// A stored row as Prisma returns it.
const stored = (overrides = {}) => ({
  id: "row-1",
  orgId: ORG,
  projectId: PROJECT,
  kind: "quantity_over_boq",
  severity: "warning",
  subjectType: "boq_item",
  subjectId: "item-1",
  secondarySubjectType: null,
  secondarySubjectId: null,
  wbsNodeId: "wbs-1",
  locationId: null,
  costCodeId: null,
  measured: new Prisma.Decimal("110"),
  limit: new Prisma.Decimal("100"),
  unitCode: "m3",
  measuredBasis: "installed basis",
  limitBasis: "limit basis",
  resolvedAt: null,
  resolvedReason: null,
  changeEventId: null,
  snoozedUntil: null,
  dataJson: { label: "1.1 Concrete" },
  ...overrides,
});

let openRows;
let resolvedRows;
beforeEach(() => {
  jest.resetAllMocks();
  openRows = [];
  resolvedRows = [];
  prisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: ORG, name: "Riverside", currency: "USD" });
  prisma.projectException.findMany.mockImplementation(async ({ where }) => (where.resolvedAt === null ? openRows : resolvedRows));
  prisma.projectException.create.mockImplementation(async ({ data }) => ({ id: `new-${data.subjectId}`, ...data }));
  prisma.projectException.update.mockImplementation(async ({ where, data }) => ({ ...openRows.find((row) => row.id === where.id), ...data }));
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
});

const evaluate = (rules, extra = {}) => engine.evaluateProject({ orgId: ORG, projectId: PROJECT, trigger: "test", rules, now: NOW, logger: quiet, ...extra });

describe("evaluateProject", () => {
  it("loads the project where { id, orgId } first: another organisation's project is 404 and no rule runs", async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    const rule = ruleOf("quantity_over_boq", [finding()]);
    await expect(evaluate([rule])).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PROJECT, orgId: ORG } }));
    expect(rule.evaluate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("opens a row for a new finding, with both figures and their bases, in one transaction under the project's lock", async () => {
    const result = await evaluate([ruleOf("quantity_over_boq", [finding()])]);
    expect(result).toMatchObject({ opened: 1, refreshed: 0, resolved: 0, unchanged: 0, suppressed: 0, errors: [], skipped: [] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.projectException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG,
        projectId: PROJECT,
        kind: "quantity_over_boq",
        severity: "warning",
        subjectType: "boq_item",
        subjectId: "item-1",
        secondarySubjectType: null,
        secondarySubjectId: null,
        wbsNodeId: "wbs-1",
        measured: "110.000",
        limit: "100.000",
        unitCode: "m3",
        measuredBasis: "installed basis",
        limitBasis: "limit basis",
        detectedAt: NOW,
        lastSeenAt: NOW,
        dataJson: { label: "1.1 Concrete" },
      }),
    });
  });

  it("an unchanged finding moves lastSeenAt only; a changed figure refreshes the row and keeps the engine's own data keys", async () => {
    openRows = [stored({ dataJson: { label: "1.1 Concrete", reopenedFrom: { id: "old" } } })];
    let result = await evaluate([ruleOf("quantity_over_boq", [finding()])]);
    expect(result).toMatchObject({ opened: 0, refreshed: 0, unchanged: 1 });
    expect(prisma.projectException.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["row-1"] }, projectId: PROJECT, resolvedAt: null }, data: { lastSeenAt: NOW } });
    expect(prisma.projectException.update).not.toHaveBeenCalled();
    expect(prisma.projectException.create).not.toHaveBeenCalled();

    jest.clearAllMocks();
    result = await evaluate([ruleOf("quantity_over_boq", [finding({ measured: { value: 125, unitCode: "m3", basis: "installed basis" }, severity: "critical" })])]);
    expect(result).toMatchObject({ refreshed: 1, unchanged: 0 });
    expect(prisma.projectException.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({ measured: "125.000", severity: "critical", lastSeenAt: NOW, dataJson: { label: "1.1 Concrete", reopenedFrom: { id: "old" } } }),
    });
  });

  it("a row the rules no longer return is resolved 'cleared' — only for a kind that ran; a failed or skipped rule's rows stand", async () => {
    openRows = [stored({ id: "boq-row" }), stored({ id: "money-row", kind: "committed_over_budget", subjectType: "budget_line", subjectId: "line-1" }), stored({ id: "dq-row", kind: "skipped_kind", subjectId: "x" })];
    const failing = ruleOf("committed_over_budget", [], { evaluate: jest.fn(async () => { throw new Error("register down"); }) });
    const skipped = ruleOf("skipped_kind", [], { requires: () => "source absent" });
    const result = await evaluate([ruleOf("quantity_over_boq", []), failing, skipped]);
    expect(result).toMatchObject({ resolved: 1, errors: [{ kind: "committed_over_budget", message: "register down" }], skipped: [{ kind: "skipped_kind", reason: "source absent" }] });
    expect(skipped.evaluate).not.toHaveBeenCalled();
    expect(prisma.projectException.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["boq-row"] }, projectId: PROJECT, resolvedAt: null }, data: { resolvedAt: NOW, resolvedReason: "cleared" } });
    expect(prisma.projectException.updateMany).toHaveBeenCalledTimes(1);
  });

  it("a malformed finding fails its rule (its rows stand); a finding twice for one subject is kept once", async () => {
    openRows = [stored()];
    let result = await evaluate([ruleOf("quantity_over_boq", [finding({ measured: { value: 1, basis: "" } })])]);
    expect(result.errors[0].message).toMatch(/measured\.basis is required/);
    expect(result.resolved).toBe(0);
    openRows = [];
    jest.clearAllMocks();
    result = await evaluate([ruleOf("quantity_over_boq", [finding(), finding({ measured: { value: 999, basis: "x" } })])]);
    expect(result.opened).toBe(1);
    expect(result.notes.join(" ")).toMatch(/found twice/);
  });

  it("a dismissed condition is not reopened while its measured figure is not above the dismissed one; it reopens as a NEW row when it worsens", async () => {
    resolvedRows = [stored({ id: "dismissed-row", resolvedAt: new Date("2026-09-30"), resolvedReason: "dismissed:accepted", dataJson: { label: "x", dismissal: { measured: "110.000", limit: "100.000" } } })];
    let result = await evaluate([ruleOf("quantity_over_boq", [finding()])]);
    expect(result).toMatchObject({ opened: 0, suppressed: 1 });
    expect(prisma.projectException.create).not.toHaveBeenCalled();
    expect(prisma.projectException.update).not.toHaveBeenCalled();
    // A lower limit with the same measured figure: still the person's dismissal.
    result = await evaluate([ruleOf("quantity_over_boq", [finding({ limit: { value: 90, basis: "limit basis" } })])]);
    expect(result.suppressed).toBe(1);
    result = await evaluate([ruleOf("quantity_over_boq", [finding({ measured: { value: 112, unitCode: "m3", basis: "installed basis" } })])]);
    expect(result).toMatchObject({ opened: 1, suppressed: 0 });
    expect(prisma.projectException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ measured: "112.000", dataJson: { label: "1.1 Concrete", reopenedFrom: { id: "dismissed-row", resolvedReason: "dismissed:accepted", dismissedMeasured: "110" } } }),
    });
    expect(result.rows[0].change).toBe("reopen");
  });

  it("an episode key (data.dismissalKey) decides the dismissal of a figure that grows by itself: the same key stays dismissed however far it grows; a new key reopens", async () => {
    const staleRule = (rows) => ruleOf("progress_stale", rows, { subjectType: "activity", module: "progress", boqDerived: false });
    const stale = (days, dismissalKey) => finding({ subjectType: "activity", subjectId: "act-1", measured: { value: days, unitCode: "day", basis: "days basis" }, limit: { value: 14, unitCode: "day", basis: "threshold" }, data: { label: "A1", dismissalKey } });
    resolvedRows = [
      stored({ id: "dismissed-stale", kind: "progress_stale", subjectType: "activity", subjectId: "act-1", measured: new Prisma.Decimal("20"), limit: new Prisma.Decimal("14"), unitCode: "day", resolvedAt: new Date("2026-09-30"), resolvedReason: "dismissed:known", dataJson: { label: "A1", dismissalKey: "activity_progress:p1@2026-09-01T00:00:00.000Z" } }),
    ];
    // The same episode, 25 days further on: still the person's dismissal.
    let result = await evaluate([staleRule([stale(45, "activity_progress:p1@2026-09-01T00:00:00.000Z")])]);
    expect(result).toMatchObject({ opened: 0, suppressed: 1 });
    expect(prisma.projectException.create).not.toHaveBeenCalled();
    // Newer approved progress that went stale again: a new episode reopens, even at a LOWER figure.
    result = await evaluate([staleRule([stale(16, "activity_progress:p2@2026-09-20T00:00:00.000Z")])]);
    expect(result).toMatchObject({ opened: 1, suppressed: 0 });
    expect(prisma.projectException.create).toHaveBeenCalledWith({ data: expect.objectContaining({ measured: "16.000", dataJson: expect.objectContaining({ dismissalKey: "activity_progress:p2@2026-09-20T00:00:00.000Z", reopenedFrom: expect.objectContaining({ id: "dismissed-stale" }) }) }) });
    expect(result.rows[0].change).toBe("reopen");
    // A dismissal stored before keys existed: the measured rule decides.
    prisma.projectException.create.mockClear();
    resolvedRows = [stored({ id: "legacy", kind: "progress_stale", subjectType: "activity", subjectId: "act-1", measured: new Prisma.Decimal("20"), limit: new Prisma.Decimal("14"), resolvedAt: new Date("2026-09-30"), resolvedReason: "dismissed:known", dataJson: { label: "A1" } })];
    expect((await evaluate([staleRule([stale(20, "activity_progress:p1@x")])])).suppressed).toBe(1);
    expect((await evaluate([staleRule([stale(21, "activity_progress:p1@x")])])).opened).toBe(1);
    // A key that is not a non-empty string fails the rule (its rows stand).
    const bad = await evaluate([staleRule([stale(30, 42)])]);
    expect(bad.errors.map((error) => error.kind)).toEqual(["progress_stale"]);
    expect(bad.errors[0].message).toMatch(/dismissalKey/);
  });

  it("a dismissal whose condition clears is released on its row; a later recurrence then opens a fresh row instead of being suppressed", async () => {
    const dismissedRow = stored({ id: "dismissed-row", resolvedAt: new Date("2026-09-30"), resolvedReason: "dismissed:accepted", dataJson: { label: "x", dismissedFingerprint: { measured: 110 } } });
    resolvedRows = [dismissedRow];
    // The subject is not found by its (evaluated) kind: the release is recorded on the dismissed row.
    let result = await evaluate([ruleOf("quantity_over_boq", [])]);
    expect(result).toMatchObject({ opened: 0, resolved: 0, released: 1 });
    expect(prisma.projectException.updateMany).toHaveBeenCalledWith({
      where: { id: "dismissed-row", projectId: PROJECT, resolvedAt: { not: null } },
      data: { dataJson: { label: "x", dismissedFingerprint: { measured: 110 }, dismissalReleasedAt: NOW.toISOString(), dismissalReleaseTrigger: "test" } },
    });
    expect(result.rows.map((row) => [row.change, row.id])).toEqual([["release", "dismissed-row"]]);
    // Not released: the kind failed, or the subject is still found (still suppressed), or the row is not the subject's latest.
    prisma.projectException.updateMany.mockClear();
    // (another kind ran to the end beside the failed one, so the evaluation itself is not empty)
    result = await evaluate([ruleOf("quantity_over_boq", [], { evaluate: jest.fn(async () => { throw new Error("owner down"); }) }), ruleOf("committed_over_budget", [])]);
    expect(result.released).toBe(0);
    result = await evaluate([ruleOf("quantity_over_boq", [finding()])]);
    expect(result).toMatchObject({ released: 0, suppressed: 1 });
    resolvedRows = [stored({ id: "cleared-later", resolvedAt: new Date("2026-10-01"), resolvedReason: "cleared" }), dismissedRow];
    expect((await evaluate([ruleOf("quantity_over_boq", [])])).released).toBe(0);
    expect(prisma.projectException.updateMany).not.toHaveBeenCalled();
    // Released: the condition comes back as a FRESH row (no reopenedFrom), even at the dismissed figure.
    resolvedRows = [{ ...dismissedRow, dataJson: { ...dismissedRow.dataJson, dismissalReleasedAt: "2026-10-01T00:00:00.000Z", dismissalReleaseTrigger: "scheduled" } }];
    result = await evaluate([ruleOf("quantity_over_boq", [finding()])]);
    expect(result).toMatchObject({ opened: 1, suppressed: 0, released: 0 });
    expect(prisma.projectException.create).toHaveBeenCalledWith({ data: expect.objectContaining({ dataJson: { label: "1.1 Concrete" } }) });
    expect(result.rows[0].change).toBe("open");
    // A rule may not write the engine's release keys.
    const bad = await evaluate([ruleOf("quantity_over_boq", [finding({ data: { dismissalReleasedAt: "x" } })])]);
    expect(bad.errors[0].message).toMatch(/reserved/);
  });

  it("an open row the rule can no longer measure is resolved 'not_comparable' with the rule's reason — never 'cleared'", async () => {
    openRows = [stored({ id: "measured-before" }), stored({ id: "cleared-one", subjectId: "item-2" })];
    const rows = Object.defineProperty([], "notComparable", { value: [{ subjectType: "boq_item", subjectId: "item-1", reason: "installed is in t, the row in m3" }], enumerable: false });
    const result = await evaluate([ruleOf("quantity_over_boq", rows)]);
    expect(result).toMatchObject({ notComparable: 1, resolved: 1, opened: 0 });
    expect(prisma.projectException.updateMany).toHaveBeenCalledWith({
      where: { id: "measured-before", projectId: PROJECT, resolvedAt: null },
      data: { resolvedAt: NOW, resolvedReason: "not_comparable", dataJson: { label: "1.1 Concrete", notComparable: { reason: "installed is in t, the row in m3", at: NOW.toISOString(), trigger: "test" } } },
    });
    expect(prisma.projectException.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["cleared-one"] }, projectId: PROJECT, resolvedAt: null },
      data: { resolvedAt: NOW, resolvedReason: "cleared" },
    });
    expect(result.rows.map((row) => [row.change, row.id, row.reason])).toEqual([["resolve", "cleared-one", undefined], ["not_comparable", "measured-before", "installed is in t, the row in m3"]]);
    // A subject the rule did find is a finding, whatever the list says; a list entry without a reason fails the rule.
    prisma.projectException.updateMany.mockClear();
    const both = Object.defineProperty([finding()], "notComparable", { value: [{ subjectType: "boq_item", subjectId: "item-1", reason: "x" }], enumerable: false });
    expect(await evaluate([ruleOf("quantity_over_boq", both)])).toMatchObject({ notComparable: 0, unchanged: 1 });
    const bad = Object.defineProperty([], "notComparable", { value: [{ subjectType: "boq_item", subjectId: "item-1" }], enumerable: false });
    const failed = await evaluate([ruleOf("quantity_over_boq", bad)]);
    expect([failed.errors[0]?.message, failed.notComparable, failed.resolved]).toEqual([expect.stringMatching(/needs a reason/), 0, 0]);
  });

  it("a condition that was cleared and comes back opens a new row", async () => {
    resolvedRows = [stored({ id: "cleared-row", resolvedAt: new Date("2026-09-30"), resolvedReason: "cleared" })];
    const result = await evaluate([ruleOf("quantity_over_boq", [finding()])]);
    expect(result.opened).toBe(1);
  });

  it("dryRun plans and writes nothing: no transaction, no lock, no create/update", async () => {
    openRows = [stored({ id: "stale", subjectId: "item-9" })];
    const result = await evaluate([ruleOf("quantity_over_boq", [finding()])], { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, opened: 1, resolved: 1 });
    expect(result.rows.map((row) => [row.change, row.subjectId])).toEqual([["open", "item-1"], ["resolve", "item-9"]]);
    for (const write of [prisma.$transaction, prisma.$executeRaw, prisma.projectException.create, prisma.projectException.update, prisma.projectException.updateMany]) expect(write).not.toHaveBeenCalled();
  });

  it("tells the listeners, after the commit, which rows opened and which became critical — with their snooze state", async () => {
    const listener = jest.fn();
    const off = engine.registerEvaluationListener(listener);
    openRows = [stored({ id: "snoozed", subjectId: "item-2", snoozedUntil: new Date("2026-10-05") })];
    await evaluate([ruleOf("quantity_over_boq", [finding(), finding({ subjectId: "item-2", severity: "critical" })])]);
    expect(listener).toHaveBeenCalledTimes(1);
    const payload = listener.mock.calls[0][0];
    expect(payload).toMatchObject({ orgId: ORG, projectId: PROJECT, trigger: "test" });
    expect(payload.opened.map((row) => [row.subjectId, row.severity, row.snoozed])).toEqual([["item-1", "warning", false]]);
    expect(payload.escalated.map((row) => [row.subjectId, row.severity, row.snoozed])).toEqual([["item-2", "critical", true]]);
    off();
    await evaluate([ruleOf("quantity_over_boq", [finding({ subjectId: "item-3" })])]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("statusOf", () => {
  it("dismissed / resolved / in_change / snoozed / open", () => {
    expect(engine.statusOf(stored({ resolvedAt: NOW, resolvedReason: "dismissed:x" }), NOW)).toBe("dismissed");
    expect(engine.statusOf(stored({ resolvedAt: NOW, resolvedReason: "cleared" }), NOW)).toBe("resolved");
    expect(engine.statusOf(stored({ changeEventId: "ce", snoozedUntil: new Date("2026-10-09") }), NOW)).toBe("in_change");
    expect(engine.statusOf(stored({ snoozedUntil: new Date("2026-10-09") }), NOW)).toBe("snoozed");
    expect(engine.statusOf(stored({ snoozedUntil: new Date("2026-09-01") }), NOW)).toBe("open");
  });
});

describe("setDismissed", () => {
  it("resolves the open row 'dismissed:<reason>', stamps the review and keeps the measured/limit fingerprint", async () => {
    prisma.projectException.findFirst.mockResolvedValue(stored({ dataJson: { label: "x" } }));
    await engine.setDismissed({ orgId: ORG, projectId: PROJECT, exceptionId: "row-1", actorId: "user-1", reason: "Accepted by the client", note: "see minutes", now: NOW });
    expect(prisma.projectException.findFirst).toHaveBeenCalledWith({ where: { id: "row-1", projectId: PROJECT, orgId: ORG } });
    expect(prisma.projectException.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({
        resolvedAt: NOW,
        resolvedReason: "dismissed:Accepted by the client",
        reviewedAt: NOW,
        reviewedBy: "user-1",
        reviewNote: "see minutes",
        dataJson: { label: "x", dismissal: { measured: "110.000", limit: "100.000", unitCode: "m3", dismissedAt: NOW.toISOString(), dismissedBy: "user-1", reason: "Accepted by the client" } },
      }),
    });
  });

  it("refuses no reason (400), another project's or a missing row (404) and a row no longer open (409)", async () => {
    await expect(engine.setDismissed({ orgId: ORG, projectId: PROJECT, exceptionId: "row-1", reason: "  " })).rejects.toMatchObject({ status: 400 });
    prisma.projectException.findFirst.mockResolvedValue(null);
    await expect(engine.setDismissed({ orgId: ORG, projectId: PROJECT, exceptionId: "row-1", reason: "x" })).rejects.toMatchObject({ status: 404, code: "EXCEPTION_NOT_FOUND" });
    prisma.projectException.findFirst.mockResolvedValue(stored({ resolvedAt: NOW, resolvedReason: "cleared" }));
    await expect(engine.setDismissed({ orgId: ORG, projectId: PROJECT, exceptionId: "row-1", reason: "x" })).rejects.toMatchObject({ status: 409, code: "EXCEPTION_NOT_OPEN" });
    expect(prisma.projectException.update).not.toHaveBeenCalled();
  });
});

describe("enqueueEvaluation (the debounce)", () => {
  beforeEach(() => {
    prisma.project.findFirst.mockResolvedValue({ id: PROJECT });
    jobService.enqueueJob.mockImplementation(async (job) => ({ id: "job-1", ...job }));
  });

  it("queues one job DEBOUNCE_MS ahead for the project; a queued one already waiting absorbs the request", async () => {
    prisma.backgroundJob.findFirst.mockResolvedValue(null);
    expect(await engine.enqueueEvaluation({ orgId: ORG, projectId: PROJECT, reason: "record.changed:change_order:approved", now: NOW })).toEqual({ enqueued: true, jobId: "job-1" });
    expect(prisma.backgroundJob.findFirst).toHaveBeenCalledWith({ where: { orgId: ORG, projectId: PROJECT, type: "exceptions.evaluate", status: "queued" }, select: { id: true } });
    expect(jobService.enqueueJob).toHaveBeenCalledWith({
      orgId: ORG,
      projectId: PROJECT,
      type: "exceptions.evaluate",
      payload: { trigger: "event", reason: "record.changed:change_order:approved" },
      runAfter: new Date(NOW.getTime() + engine.DEBOUNCE_MS),
      maxAttempts: 2,
    });
    prisma.backgroundJob.findFirst.mockResolvedValue({ id: "waiting" });
    expect(await engine.enqueueEvaluation({ orgId: ORG, projectId: PROJECT, now: NOW })).toEqual({ enqueued: false, debounced: true, jobId: "waiting" });
    expect(jobService.enqueueJob).toHaveBeenCalledTimes(1);
  });

  it("two requests at once in one process make one job; a project of another organisation is never queued", async () => {
    prisma.backgroundJob.findFirst.mockResolvedValue(null);
    const [first, second] = await Promise.all([engine.enqueueEvaluation({ orgId: ORG, projectId: PROJECT }), engine.enqueueEvaluation({ orgId: ORG, projectId: PROJECT })]);
    expect([first.enqueued, second.enqueued, second.coalesced]).toEqual([true, false, true]);
    expect(jobService.enqueueJob).toHaveBeenCalledTimes(1);
    prisma.project.findFirst.mockResolvedValue(null);
    expect((await engine.enqueueEvaluation({ orgId: "org-2", projectId: PROJECT })).enqueued).toBe(false);
    expect(jobService.enqueueJob).toHaveBeenCalledTimes(1);
  });
});

describe("runEvaluationJob", () => {
  const env = process.env.EXCEPTIONS_ENGINE_ENABLED;
  afterEach(() => {
    if (env === undefined) delete process.env.EXCEPTIONS_ENGINE_ENABLED;
    else process.env.EXCEPTIONS_ENGINE_ENABLED = env;
  });

  it("stands down when the engine is disabled; otherwise evaluates the job's own organisation and project", async () => {
    // Off is the default: an explicit false, a missing variable, an empty one and
    // anything that is not exactly "true" all leave the handler standing down (C0-1).
    for (const value of ["false", undefined, "", "  ", "1", "yes", "on", "enabled", "truthy", "true,false"]) {
      if (value === undefined) delete process.env.EXCEPTIONS_ENGINE_ENABLED;
      else process.env.EXCEPTIONS_ENGINE_ENABLED = value;
      expect([value, await engine.runEvaluationJob({ job: { orgId: ORG, projectId: PROJECT } })]).toEqual([value, { skipped: "EXCEPTIONS_ENGINE_ENABLED is not true" }]);
    }
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    process.env.EXCEPTIONS_ENGINE_ENABLED = "true";
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(engine.runEvaluationJob({ job: { orgId: ORG, projectId: PROJECT, payload: { trigger: "scheduled" } } })).rejects.toMatchObject({ status: 404 });
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PROJECT, orgId: ORG } }));
    await expect(engine.runEvaluationJob({ job: { orgId: ORG } })).rejects.toMatchObject({ status: 400 });
  });
});
