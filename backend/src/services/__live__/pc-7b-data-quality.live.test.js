/**
 * PC-7b data quality (docs/project-controls/OCTAPM_CHANGE_INTELLIGENCE.md §7)
 * — the data-quality rules of the exception engine, proven against the real
 * local Postgres in throwaway "LiveTest <uuid>" organisations.
 *
 * Two projects are built directly (fixture rows in this LiveTest org only):
 *   gaps  — every §7 gap the rules know, each set up once on purpose;
 *   clean — the same kinds of records with nothing wrong.
 * Each rule is evaluated standalone (exception-rules/data-quality.js), as the
 * engine will call it, and asserted row by row: subject, measured / limit and
 * their basis. Then: no rule writes anything (every row of the organisation
 * compared before and after), a rule asked for a project under another
 * organisation sees nothing, and the engine itself (merged on the base, PC-7b
 * integration: nothing here is skipped) opens, refreshes and resolves the rows.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run -s test:live -- src/services/__live__/pc-7b-data-quality.live.test.js
 */
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const RULES = require("../exception-rules/data-quality");

// ─── the engine (merged on the base: every case runs, none is skipped) ────
const engine = require("../exception-engine.service");
const engineIt = it;

// ─── every row of the organisation ("writes nothing") ─────────────────────
const scalarField = (model, name) => model.fields.some((field) => field.name === name && field.kind === "scalar");
const THROUGH_ACTIVITY = new Set(["ActivityProgress", "ActivityAssignment", "ActivityEquipment"]);
const scopeOf = (model) => {
  if (model.name === "Organisation") return ({ orgId }) => ({ id: orgId });
  if (scalarField(model, "orgId")) return ({ orgId }) => ({ orgId });
  if (scalarField(model, "projectId")) return ({ projectIds }) => ({ projectId: { in: projectIds } });
  if (THROUGH_ACTIVITY.has(model.name)) return ({ projectIds }) => ({ activity: { projectId: { in: projectIds } } });
  return null;
};
const SCOPED = Prisma.dmmf.datamodel.models
  .map((model) => ({
    name: model.name,
    delegate: model.name[0].toLowerCase() + model.name.slice(1),
    key: model.primaryKey?.fields?.length ? model.primaryKey.fields : model.fields.filter((field) => field.isId).map((field) => field.name),
    where: scopeOf(model),
  }))
  .filter((table) => table.where);
const stable = (value) => JSON.stringify(value, (key, inner) => (typeof inner === "bigint" ? `${inner}n` : inner));
const everyRow = async (scope) => {
  const snapshot = new Map();
  for (let index = 0; index < SCOPED.length; index += 3) {
    await Promise.all(SCOPED.slice(index, index + 3).map(async (table) => {
      const found = await prisma[table.delegate].findMany({ where: table.where(scope) });
      snapshot.set(table.name, new Map(found.map((row) => [table.key.map((field) => stable(row[field])).join("|"), stable(row)])));
    }));
  }
  return snapshot;
};
const changesBetween = (before, after) => {
  const changes = [];
  for (const [name, rowsAfter] of after) {
    const rowsBefore = before.get(name) || new Map();
    for (const [key, row] of rowsAfter) if (rowsBefore.get(key) !== row) changes.push(`${name} ${key}: ${rowsBefore.has(key) ? "changed" : "added"}`);
    for (const key of rowsBefore.keys()) if (!rowsAfter.has(key)) changes.push(`${name} ${key}: removed`);
  }
  return changes;
};

const ruleOf = (kind) => {
  const rule = RULES.find((entry) => entry.kind === kind);
  if (!rule) throw new Error(`no data-quality rule ${kind}`);
  return rule;
};
const NOW = new Date();
const DAY = 86_400_000;
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY);
// What the standalone tests assert, rule by rule, on the gaps project.
const EXPECTED_GAPS = Object.freeze({
  budget_truths_disagree: 3, forecast_without_provenance: 2, activity_budget_mismatch: 2, committed_definition_mixed: 1, equipment_cost_unposted: 2,
  unit_unresolved: 1, unit_mismatch: 2, structure_missing: 4,
  progress_stale: 1, period_not_locked: 1, ev_basis_divergence: 1, readiness_override_active: 1,
  orphan_change_link: 4, change_order_possible_duplicate: 1,
});
// The kinds that compare two owner figures: each measures the gap between them.
const GAP_KINDS = Object.freeze(["budget_truths_disagree", "forecast_without_provenance", "activity_budget_mismatch", "committed_definition_mixed", "equipment_cost_unposted", "ev_basis_divergence"]);

liveDescribe("PC-7b data quality: the §7 kinds are rules of the one engine, read-only, each citing its evidence", () => {
  let live;
  let other;
  const gaps = {};
  const clean = {};
  // edges: the thresholds' boundaries; bare: a project with no schedule;
  // outOfScope: an archived and a completed project the nightly tick skips.
  const edges = {};
  const bare = {};
  const outOfScope = [];

  const evaluate = (kind, built, { orgId = live.org.id, ctx = {} } = {}) => ruleOf(kind).evaluate({ orgId, projectId: built.project.id, cutoff: NOW, ctx });
  const figuresOf = (row) => Object.fromEntries(Object.entries(row.data.figures || {}).map(([name, figure]) => [name, figure.value]));
  const bySubject = (rows) =>new Map(rows.map((row) => [`${row.subjectType}:${row.subjectId}${row.secondarySubjectId ? `:${row.secondarySubjectId}` : ""}`, row]));

  /** A project with the records every rule reads; `gap` sets each §7 gap up on purpose. */
  const build = async (target, { gap }) => {
    const orgId = live.org.id;
    const tag = `${gap ? "gaps" : "clean"}-${Date.now().toString(36)}`;
    const project = await prisma.project.create({
      data: { orgId, name: `LiveTest PC-7b data quality ${tag}`, status: "active", contractValue: gap ? 100000 : 50000, startDate: new Date("2026-01-05"), endDate: new Date("2027-06-30") },
    });
    target.project = project;
    const costCode = await prisma.costCode.create({ data: { orgId, code: `LT7B-${tag}`, name: "LiveTest data quality" } });
    await prisma.projectCostCode.create({ data: { orgId, projectId: project.id, costCodeId: costCode.id } });
    target.line = await prisma.budgetLine.create({ data: { orgId, projectId: project.id, costCodeId: costCode.id, costType: "material", originalBudget: gap ? 80000 : 50000 } });

    // Structure: both projects have a WBS node; only the clean one has a
    // location and files its rows and activities under the node and a cost code.
    target.wbs = await prisma.wbsNode.create({ data: { orgId, projectId: project.id, code: "DQ", name: "LiveTest scope", path: "DQ" } });
    if (!gap) target.location = await prisma.location.create({ data: { orgId, projectId: project.id, name: "LiveTest level 1", code: "L1", path: "L1" } });
    const filed = gap ? {} : { wbsNodeId: target.wbs.id };

    const activity = (code, extra = {}) =>
      prisma.activity.create({ data: { projectId: project.id, name: `LiveTest ${code}`, activityCode: code, duration: 10, startDate: new Date("2026-02-02"), endDate: new Date("2026-02-13"), ...filed, ...extra } });
    target.a1 = await activity("DQ-A1", { budget: gap ? 0 : 50000 });
    target.a2 = await activity("DQ-A2", { budget: gap ? 7000 : 0 });
    target.a3 = await activity("DQ-A3", { budget: 0 });

    const itemFiling = gap ? {} : { wbsNodeId: target.wbs.id, costCodeId: costCode.id };
    target.item = await prisma.boqItem.create({ data: { projectId: project.id, code: "DQ.1", description: "LiveTest concrete", unit: "m3", qty: 10, rate: 5000, amount: 50000, ...itemFiling } });
    // A second, unpriced row: a unit nobody recognises on the gaps project.
    target.item2 = await prisma.boqItem.create({ data: { projectId: project.id, code: "DQ.2", description: "LiveTest sundries", unit: gap ? "cubbits" : "m2", qty: 1, rate: 0, amount: 0, ...itemFiling } });
    // Units: on the gaps project A1 is measured in m2 against its m3 row, and
    // an executed commitment's SOV line names the row in tonnes.
    if (gap) {
      await prisma.activityProgressMethod.create({ data: { projectId: project.id, activityId: target.a1.id, method: "quantity", quantityUnit: "m2", plannedQuantity: 10 } });
      const commitment = await prisma.commitment.create({ data: { orgId, projectId: project.id, number: 1, ref: `SC-${tag}`, title: "LiveTest subcontract", status: "executed" } });
      await prisma.commitmentSovLine.create({ data: { orgId, projectId: project.id, commitmentId: commitment.id, lineNumber: 1, description: "LiveTest concrete", boqItemId: target.item.id, unit: "t", qty: 5, rate: 100, amount: 500 } });
    }
    target.allocation = await prisma.activityBoqAllocation.create({
      data: { projectId: project.id, boqItemId: target.item.id, activityId: target.a1.id, quantity: 10, amount: 50000, weight: 100, status: "approved", approvedAt: daysAgo(30) },
    });
    if (gap) {
      await prisma.budgetRevision.create({ data: { projectId: project.id, ref: "BR-DQ1", title: "LiveTest addition", changeType: "addition", amount: 1000, status: "approved", effectiveDate: daysAgo(20), approvedAt: daysAgo(20) } });
    }

    // Cost records: A1 a NULL-source forecast (gap) or an entered one;
    // A2 a default the actual has passed (gap) or a default above it; A3
    // an entered forecast below its actual (never a gap: entered stands).
    const record = (activityId, data) => prisma.costRecord.create({ data: { projectId: project.id, activityId, ...data } });
    target.r1 = await record(target.a1.id, gap ? { budget: 0, forecast: 1200, forecastSource: null, actual: 300 } : { budget: 50000, forecast: 52000, forecastSource: "entered", actual: 300 });
    target.r2 = await record(target.a2.id, gap ? { budget: 7000, forecast: 7000, forecastSource: "default", actual: 9000 } : { budget: 0, forecast: 900, forecastSource: "default", actual: 800 });
    target.r3 = await record(target.a3.id, { budget: 0, forecast: 100, forecastSource: "entered", actual: 500 });

    if (gap) await prisma.procurementOrder.create({ data: { projectId: project.id, ref: `PO-${tag}`, item: "LiveTest rebar", status: "issued", value: 5000 } });

    // Progress: A1 is 40 % done, approved 30 days ago (stale) or 2 days ago;
    // on the gaps project A2 is complete and A3 has never begun.
    const progress = (activityId, pctComplete, days) =>
      prisma.activityProgress.create({ data: { activityId, pctComplete, status: "approved", approvedAt: daysAgo(days), updatedAt: daysAgo(days) } });
    target.p1 = await progress(target.a1.id, 40, gap ? 30 : 2);
    if (gap) await progress(target.a2.id, 100, 60);

    // Reporting periods. Gaps: P0 locked over a PM override 60 days ago, P1
    // open with its cutoff 40 days ago (the default EV period: progress
    // approved after it is not in its EV), P2 open with its cutoff ahead.
    // Clean: P0 locked 20 days ago WITHOUT an override, its snapshot's EV the
    // same 20,000 the mapping summary reads.
    const { storedValueForReportingDate } = require("../../utils/reporting-cutoff");
    const localDate = (days) => new Date(NOW.getTime() - days * DAY).toISOString().slice(0, 10);
    const period = (code, days, extra = {}) =>
      prisma.reportingPeriod.create({ data: { projectId: project.id, code, label: `LiveTest ${code}`, periodStart: new Date(NOW.getTime() - (days + 27) * DAY), periodEnd: storedValueForReportingDate(localDate(days)), cutoffDate: storedValueForReportingDate(localDate(days)), ...extra } });
    const lockedOver = async (code, days, { override, ev }) => {
      const row = await period(code, days, { status: "locked", lockedAt: daysAgo(days - 1), lockedBy: live.user.id });
      await prisma.evPeriodSnapshot.create({
        data: {
          projectId: project.id, reportingPeriodId: row.id, cutoffDate: row.cutoffDate, ev, totalBudget: 50000, lockedAt: daysAgo(days - 1), lockedBy: live.user.id,
          basisJson: { readinessOverride: override ? { reason: "LiveTest: lock over the gate", actorId: live.user.id, actorRole: "pm", overriddenAt: daysAgo(days - 1).toISOString() } : null },
        },
      });
      return row;
    };
    if (gap) {
      target.period0 = await lockedOver("DQ-P0", 60, { override: true, ev: 0 });
      target.period1 = await period("DQ-P1", 40);
      target.period2 = await period("DQ-P2", -10);
    } else {
      target.period0 = await lockedOver("DQ-P0", 20, { override: false, ev: 20000 });
    }

    // Change orders. Gaps: VO-2 repeats VO-1 (description differing only in
    // case and spacing, the same 10 days on A1); VO-3 the same words with 5
    // days; VO-4 a repeat archived; VO-5 a repeat only pending. Clean: two
    // approved orders on A1 with different descriptions.
    const SAME = "LiveTest Client instruction: upgrade blockwork, grid A-F";
    const order = (ref, description, { status = "approved", archivedAt = null, days = 10, approvedDaysAgo = 10 } = {}) =>
      prisma.changeOrder.create({
        data: {
          projectId: project.id, ref, description, status, archivedAt, value: 0,
          approvedAt: status === "approved" ? daysAgo(approvedDaysAgo) : null,
          activityLinks: { create: [{ projectId: project.id, activityId: target.a1.id, relationType: "delay", scheduleImpactDays: days, approvedScheduleImpactDays: status === "approved" ? days : 0 }] },
        },
      });
    target.vo1 = await order("VO-1", gap ? SAME : "LiveTest Client instruction A");
    target.vo2 = await order("VO-2", gap ? `  ${SAME.toUpperCase().replace(/ /g, "   ")} ` : "LiveTest Client instruction B", { approvedDaysAgo: 9 });
    if (gap) {
      target.vo3 = await order("VO-3", SAME, { days: 5, approvedDaysAgo: 8 });
      target.vo4 = await order("VO-4", SAME, { archivedAt: daysAgo(1), approvedDaysAgo: 7 });
      target.vo5 = await order("VO-5", SAME, { status: "pending" });
    }

    // Change links. Gaps: a draft revision naming no order (VO-404), two
    // naming real ones (by ref, by id); a workflow link to an RFI that is not
    // there beside one to a real RFI. Clean: each link resolves.
    const revision = (ref, linkedChangeOrder) => prisma.budgetRevision.create({ data: { projectId: project.id, ref, title: `LiveTest ${ref}`, status: "draft", amount: 10, linkedChangeOrder } });
    if (gap) target.orphanRevision = await revision("BR-DQ2", "VO-404");
    await revision("BR-DQ3", "VO-1");
    await revision("BR-DQ4", target.vo2.id);
    target.rfi = await prisma.rfi.create({ data: { projectId: project.id, ref: "RFI-1", subject: "LiveTest question" } });
    await prisma.workflowActivityLink.create({ data: { projectId: project.id, recordType: "rfi", recordId: target.rfi.id, activityId: target.a1.id } });
    if (gap) target.orphanLink = await prisma.workflowActivityLink.create({ data: { projectId: project.id, recordType: "rfi", recordId: "00000000-0000-4000-8000-00000000dead", activityId: target.a1.id } });

    // Equipment usage: DR1 with no posting (gap), DR2 posted, DR3 posted then
    // reversed (gap). The clean project's one report is posted.
    const report = (date) => prisma.dailyReport.create({ data: { projectId: project.id, activityId: target.a1.id, engineerId: live.user.id, date, status: "approved" } });
    const usage = (dailyReportId, costAmount) =>
      prisma.activityEquipmentUsage.create({ data: { projectId: project.id, activityId: target.a1.id, dailyReportId, equipmentName: "LiveTest excavator", hours: 4, rate: costAmount / 4, costAmount, usageDate: daysAgo(5) } });
    const ledger = (sourceId, amount, suffix = "header") =>
      prisma.costLedgerEntry.create({ data: { orgId, projectId: project.id, sourceKey: `equipment:${sourceId}:${suffix}`, sourceType: "equipment", sourceId, amount, incurredOn: daysAgo(5), activityId: target.a1.id, costType: "equipment" } });
    if (gap) {
      target.dr1 = await report(daysAgo(5));
      await usage(target.dr1.id, 400);
      target.dr2 = await report(daysAgo(4));
      await usage(target.dr2.id, 300);
      await ledger(target.dr2.id, 300);
      target.dr3 = await report(daysAgo(3));
      await usage(target.dr3.id, 500);
      await ledger(target.dr3.id, 500);
      await ledger(target.dr3.id, -500, "reversal");
    } else {
      target.dr1 = await report(daysAgo(5));
      await usage(target.dr1.id, 250);
      await ledger(target.dr1.id, 250);
    }
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    await build(gaps, { gap: true });
    await build(clean, { gap: false });
    // An RFI of the gaps project whose change order is the clean project's.
    gaps.crossRfi = await prisma.rfi.create({ data: { projectId: gaps.project.id, ref: "RFI-2", subject: "LiveTest converted elsewhere", changeOrderId: clean.vo1.id } });
    // A workflow link of the gaps project naming the CLEAN project's RFI: a
    // record that exists, but not in the link's own project.
    gaps.crossLink = await prisma.workflowActivityLink.create({ data: { projectId: gaps.project.id, recordType: "rfi", recordId: clean.rfi.id, activityId: gaps.a1.id } });

    // Edges: progress approved exactly 14 and 15 days before the cutoff; four
    // open periods whose cutoffs fall 6-9 local days back (whole days elapsed
    // 7 and 8 among them, whatever instant a local cutoff date maps to).
    const orgId = live.org.id;
    const { storedValueForReportingDate } = require("../../utils/reporting-cutoff");
    edges.project = await prisma.project.create({ data: { orgId, name: `LiveTest PC-7b data quality edges-${Date.now().toString(36)}`, status: "active" } });
    const edgeActivity = (code) => prisma.activity.create({ data: { projectId: edges.project.id, name: `LiveTest ${code}`, activityCode: code, duration: 10, startDate: new Date("2026-02-02"), endDate: new Date("2026-02-13") } });
    edges.e14 = await edgeActivity("DQ-E14");
    edges.e15 = await edgeActivity("DQ-E15");
    for (const [activity, days] of [[edges.e14, 14], [edges.e15, 15]]) {
      await prisma.activityProgress.create({ data: { activityId: activity.id, pctComplete: 40, status: "approved", approvedAt: daysAgo(days), updatedAt: daysAgo(days) } });
    }
    edges.periods = [];
    for (const days of [6, 7, 8, 9]) {
      const local = new Date(NOW.getTime() - days * DAY).toISOString().slice(0, 10);
      edges.periods.push(await prisma.reportingPeriod.create({ data: { projectId: edges.project.id, code: `DQ-E${days}`, label: `LiveTest E${days}`, periodStart: daysAgo(days + 27), periodEnd: storedValueForReportingDate(local), cutoffDate: storedValueForReportingDate(local) } }));
    }
    bare.project = await prisma.project.create({ data: { orgId, name: `LiveTest PC-7b data quality bare-${Date.now().toString(36)}`, status: "active" } });
    outOfScope.push(await prisma.project.create({ data: { orgId, name: "LiveTest PC-7b archived", status: "active", archivedAt: daysAgo(1) } }));
    outOfScope.push(await prisma.project.create({ data: { orgId, name: "LiveTest PC-7b completed", status: "completed" } }));
  }, 120_000);

  afterAll(async () => {
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["auditEvent", "backgroundJob", "outboundEvent", "notification", "projectException"]) await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  }, 120_000);

  it("every rule declares the engine's contract: info/warning only, a permission module, a BOQ flag, words without figures", () => {
    const kinds = RULES.map((rule) => rule.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(RULES.DATA_QUALITY_KINDS).toEqual(kinds);
    for (const rule of RULES) {
      expect(["info", "warning"]).toContain(rule.severity);
      expect(["boq", "cost", "schedule", "progress"]).toContain(rule.module);
      expect(typeof rule.boqDerived).toBe("boolean");
      expect(typeof rule.evaluate).toBe("function");
      expect(typeof rule.label).toBe("string");
      expect(rule.note(3)).not.toMatch(/\d{2,}/);
    }
  });

  // ─── budget and cost provenance ──────────────────────────────────────────

  it("budget_truths_disagree: one row per pair of the three budgets that differ, each figure from its owner", async () => {
    const rows = bySubject(await evaluate("budget_truths_disagree", gaps));
    const pid = gaps.project.id;
    // register 80,000; EV BAC 50,000 + 1,000 = 51,000; waterfall 100,000 + 1,000 = 101,000.
    expect([...rows.keys()].sort()).toEqual([`project:${pid}:ev_bac_vs_contract_waterfall`, `project:${pid}:register_vs_contract_waterfall`, `project:${pid}:register_vs_ev_bac`]);
    const pair = rows.get(`project:${pid}:register_vs_ev_bac`);
    // The gap is measured; both figures stay in data with their owners' bases.
    expect([pair.measured.value, pair.limit.value, figuresOf(pair), pair.data.higher]).toEqual([29000, 0.01, { register: 80000, evBac: 51000 }, "register"]);
    expect(pair.data.figures.register.basis).toMatch(/budget\.service listBudgetLines/);
    expect(pair.data.figures.evBac.basis).toMatch(/earned-value\.service buildOfficialEvReport totalBudget/);
    expect(pair.measured.basis).toMatch(/budget\.service listBudgetLines[\s\S]*buildOfficialEvReport totalBudget/);
    const evVsContract = rows.get(`project:${pid}:ev_bac_vs_contract_waterfall`);
    expect([evVsContract.measured.value, figuresOf(evVsContract), evVsContract.data.higher]).toEqual([50000, { evBac: 51000, contract: 101000 }, "contract"]);
    expect(rows.get(`project:${pid}:register_vs_contract_waterfall`).data.figures.contract.basis).toMatch(/budget-revision\.service listBudgetRevisions/);
    expect(await evaluate("budget_truths_disagree", clean)).toEqual([]);
  });

  it("forecast_without_provenance: a NULL-source forecast and a default the actual passed; an entered forecast never", async () => {
    const rows = bySubject(await evaluate("forecast_without_provenance", gaps));
    expect([...rows.keys()].sort()).toEqual([`cost_record:${gaps.r1.id}`, `cost_record:${gaps.r2.id}`].sort());
    const unknown = rows.get(`cost_record:${gaps.r1.id}`);
    expect(unknown.data.reason).toBe("source_not_recorded");
    // The stored 1,200 beside what the R5-2 default would be now: max(0, the approved allocation 50,000, actual 300).
    expect([unknown.measured.value, figuresOf(unknown), unknown.data.higher]).toEqual([48800, { storedForecast: 1200, defaultNow: 50000 }, "defaultNow"]);
    expect(unknown.data.figures.defaultNow.basis).toMatch(/defaultForecast/);
    const passed = rows.get(`cost_record:${gaps.r2.id}`);
    expect(passed.data.reason).toBe("default_below_actual");
    expect([passed.measured.value, figuresOf(passed), passed.data.higher]).toEqual([2000, { actual: 9000, storedDefault: 7000 }, "actual"]);
    expect(await evaluate("forecast_without_provenance", clean)).toEqual([]);
  });

  it("activity_budget_mismatch: a stored budget that differs from the approved allocations, per activity", async () => {
    const rows = bySubject(await evaluate("activity_budget_mismatch", gaps));
    expect([...rows.keys()].sort()).toEqual([`activity:${gaps.a1.id}`, `activity:${gaps.a2.id}`].sort());
    const a1 = rows.get(`activity:${gaps.a1.id}`);
    expect([a1.measured.value, figuresOf(a1), a1.data.field, a1.data.higher]).toEqual([50000, { storedBudget: 0, approvedAllocation: 50000 }, "cost_record.budget", "approvedAllocation"]);
    expect(a1.data.figures.approvedAllocation.basis).toMatch(/getApprovedActivityAllocationTotals/);
    const a2 = rows.get(`activity:${gaps.a2.id}`);
    expect([a2.measured.value, figuresOf(a2), a2.data.higher]).toEqual([7000, { storedBudget: 7000, approvedAllocation: 0 }, "storedBudget"]);
    expect(await evaluate("activity_budget_mismatch", clean)).toEqual([]);
  });

  it("committed_definition_mixed: the purchase-order register's `committed` alias beside the register's committed cost", async () => {
    const [row, ...rest] = await evaluate("committed_definition_mixed", gaps);
    expect(rest).toEqual([]);
    expect([row.subjectType, row.subjectId, row.measured.value, row.limit.value, figuresOf(row)]).toEqual(["project", gaps.project.id, 5000, 0.01, { purchaseOrderCommitted: 5000, registerCommitted: 0 }]);
    expect(row.data.figures.purchaseOrderCommitted.basis).toMatch(/NOT committed cost/);
    expect(await evaluate("committed_definition_mixed", clean)).toEqual([]);
  });

  it("equipment_cost_unposted: usage cost a daily report carries beyond the ledger's net posting", async () => {
    const rows = bySubject(await evaluate("equipment_cost_unposted", gaps));
    expect([...rows.keys()].sort()).toEqual([`daily_report:${gaps.dr1.id}`, `daily_report:${gaps.dr3.id}`].sort());
    expect([rows.get(`daily_report:${gaps.dr1.id}`).measured.value, figuresOf(rows.get(`daily_report:${gaps.dr1.id}`))]).toEqual([400, { usageCost: 400, ledgerNet: 0 }]);
    expect([rows.get(`daily_report:${gaps.dr3.id}`).measured.value, figuresOf(rows.get(`daily_report:${gaps.dr3.id}`))]).toEqual([500, { usageCost: 500, ledgerNet: 0 }]);
    expect(await evaluate("equipment_cost_unposted", clean)).toEqual([]);
  });

  it("every two-figure kind measures the GAP: it rises when the figures move apart on either side, so a dismissal can never hide a worsening", async () => {
    const { subtractMoney } = require("../../utils/money");
    // Shape: |a − b| against the cent tolerance, both figures (and their bases) in data.
    for (const kind of GAP_KINDS) {
      const rows = await evaluate(kind, gaps);
      expect([kind, rows.length > 0]).toEqual([kind, true]);
      for (const row of rows) {
        const figures = Object.values(row.data.figures);
        expect([kind, figures.length]).toEqual([kind, 2]);
        expect([kind, row.measured.value]).toEqual([kind, Math.abs(subtractMoney(figures[0].value, figures[1].value))]);
        expect([kind, row.limit.value, row.measured.value > row.limit.value]).toEqual([kind, 0.01, true]);
        for (const figure of figures) expect(row.measured.basis).toContain(figure.basis);
      }
    }
    const pid = gaps.project.id;
    const measuredOf = async (kind, key) => bySubject(await evaluate(kind, gaps)).get(key)?.measured.value;

    // The LARGER figure of a pair rises (the contract waterfall): the gap widens.
    const evVsContract = `project:${pid}:ev_bac_vs_contract_waterfall`;
    expect(await measuredOf("budget_truths_disagree", evVsContract)).toBe(50000);
    await prisma.project.update({ where: { id: pid }, data: { contractValue: 140000 } });
    try {
      expect(await measuredOf("budget_truths_disagree", evVsContract)).toBe(90000);
    } finally {
      await prisma.project.update({ where: { id: pid }, data: { contractValue: 100000 } });
    }
    // The approved allocation (A1's larger figure; the stored budget is 0)
    // rises from 40,000 back to 50,000 (the BOQ row's amount caps it): the gap follows.
    await prisma.activityBoqAllocation.update({ where: { id: gaps.allocation.id }, data: { amount: 40000 } });
    try {
      expect(await measuredOf("activity_budget_mismatch", `activity:${gaps.a1.id}`)).toBe(40000);
    } finally {
      await prisma.activityBoqAllocation.update({ where: { id: gaps.allocation.id }, data: { amount: 50000 } });
    }
    expect(await measuredOf("activity_budget_mismatch", `activity:${gaps.a1.id}`)).toBe(50000);
    // A daily report's posting (the smaller figure) is reversed: the unposted gap grows back.
    const entry = (amount, suffix) => prisma.costLedgerEntry.create({ data: { orgId: live.org.id, projectId: pid, sourceKey: `equipment:${gaps.dr1.id}:${suffix}`, sourceType: "equipment", sourceId: gaps.dr1.id, amount, incurredOn: daysAgo(5), activityId: gaps.a1.id, costType: "equipment" } });
    const added = [];
    try {
      added.push(await entry(150, "partial"));
      expect(await measuredOf("equipment_cost_unposted", `daily_report:${gaps.dr1.id}`)).toBe(250);
      added.push(await entry(-150, "partial-reversal"));
      expect(await measuredOf("equipment_cost_unposted", `daily_report:${gaps.dr1.id}`)).toBe(400);
    } finally {
      await prisma.costLedgerEntry.deleteMany({ where: { id: { in: added.map((row) => row.id) } } });
    }
  }, 120_000);

  it("a failure of the EV report reaches the engine: the rules that read it throw instead of answering fewer rows", async () => {
    const earnedValue = require("../earned-value.service");
    const spy = jest.spyOn(earnedValue, "buildOfficialEvReport").mockRejectedValue(Object.assign(new Error("Connection terminated unexpectedly"), { code: "P1017" }));
    try {
      for (const kind of ["budget_truths_disagree", "ev_basis_divergence"]) {
        await expect(evaluate(kind, gaps)).rejects.toThrow(/Connection terminated unexpectedly/);
      }
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    // Restored: both answer again.
    expect((await evaluate("budget_truths_disagree", gaps)).length).toBe(3);
    expect((await evaluate("ev_basis_divergence", gaps)).length).toBe(1);
  });

  // ─── structure and units ─────────────────────────────────────────────────

  it("structure_missing: one row per structure check the setup readiness raises, its uncapped count measured", async () => {
    const rows = bySubject(await evaluate("structure_missing", gaps));
    const pid = gaps.project.id;
    expect([...rows.keys()].sort()).toEqual(["ACTIVITIES_WITHOUT_WBS", "BOQ_ITEMS_WITHOUT_COST_CODE", "BOQ_ITEMS_WITHOUT_WBS", "NO_LOCATIONS"].map((code) => `project:${pid}:${code}`));
    expect(rows.get(`project:${pid}:ACTIVITIES_WITHOUT_WBS`).measured.value).toBe(3);
    expect(rows.get(`project:${pid}:BOQ_ITEMS_WITHOUT_WBS`).measured.value).toBe(2);
    expect(rows.get(`project:${pid}:BOQ_ITEMS_WITHOUT_COST_CODE`).data.items.map((item) => item.id).sort()).toEqual([gaps.item.id, gaps.item2.id].sort());
    const none = rows.get(`project:${pid}:NO_LOCATIONS`);
    expect([none.measured.value, none.limit.value, none.secondarySubjectType]).toEqual([1, 0, "readiness_check"]);
    expect(none.measured.basis).toMatch(/project-setup-readiness\.service getSetupReadiness/);
    expect(await evaluate("structure_missing", clean)).toEqual([]);
  });

  it("unit_unresolved: the BOQ rows whose unit the organisation's list does not resolve, with the spellings", async () => {
    const [row, ...rest] = await evaluate("unit_unresolved", gaps);
    expect(rest).toEqual([]);
    expect([row.secondarySubjectId, row.measured.value, row.limit.value]).toEqual(["BOQ_UNIT_UNRESOLVED", 1, 0]);
    expect(row.data.units.map((unit) => unit.unit)).toEqual(["cubbits"]);
    expect(row.data.items.map((item) => item.id)).toEqual([gaps.item2.id]);
    expect(await evaluate("unit_unresolved", clean)).toEqual([]);
  });

  it("unit_mismatch: an allocation measured in another unit (readiness) and a BOQ row's SOV quantity in another unit (quantity views)", async () => {
    const rows = bySubject(await evaluate("unit_mismatch", gaps));
    const pid = gaps.project.id;
    expect([...rows.keys()].sort()).toEqual([`boq_item:${gaps.item.id}`, `project:${pid}:UNIT_MISMATCH_COUNT`].sort());
    const allocation = rows.get(`project:${pid}:UNIT_MISMATCH_COUNT`);
    expect([allocation.measured.value, allocation.data.items.map((item) => item.id)]).toEqual([1, [gaps.allocation.id]]);
    const item = rows.get(`boq_item:${gaps.item.id}`);
    expect([item.measured.value, item.measured.unitCode, item.data.columns]).toEqual([1, "m3", [{ figure: "committed", unitCode: "t" }]]);
    expect(item.measured.basis).toMatch(/quantity-views\.service quantityBlocks/);
    expect(await evaluate("unit_mismatch", clean)).toEqual([]);
  });

  // ─── progress and reporting ──────────────────────────────────────────────

  it("progress_stale: a begun, incomplete activity whose latest approved progress is older than 14 days", async () => {
    const [row, ...rest] = await evaluate("progress_stale", gaps);
    expect(rest).toEqual([]);
    expect([row.subjectType, row.subjectId, row.measured.value, row.measured.unitCode, row.limit.value]).toEqual(["activity", gaps.a1.id, 30, "day", 14]);
    expect(row.data.progressId).toBe(gaps.p1.id);
    expect(row.measured.basis).toMatch(/selectApprovedProgressForCutoff/);
    expect(RULES.THRESHOLDS.PROGRESS_STALE_DAYS).toBe(require("../forecast.service").STALL_DAYS);
    expect(await evaluate("progress_stale", clean)).toEqual([]);
  });

  it("period_not_locked: a period whose cutoff passed more than 7 days ago with no locked snapshot", async () => {
    const [row, ...rest] = await evaluate("period_not_locked", gaps);
    expect(rest).toEqual([]);
    expect([row.subjectType, row.subjectId, row.limit.value]).toEqual(["reporting_period", gaps.period1.id, 7]);
    expect(row.measured.value).toBe(Math.floor((NOW.getTime() - new Date(row.data.cutoffDate).getTime()) / DAY));
    expect(row.measured.value).toBeGreaterThan(7);
    expect(await evaluate("period_not_locked", clean)).toEqual([]);
  });

  it("the thresholds' boundaries: stale after MORE than 14 days (14 is not), late after MORE than 7 days (7 is not)", async () => {
    const stale = await evaluate("progress_stale", edges);
    expect(stale.map((row) => [row.subjectId, row.measured.value])).toEqual([[edges.e15.id, 15]]);
    const { periods } = await require("../earned-value.service").listReportingPeriods({ orgId: live.org.id, projectId: edges.project.id });
    const elapsed = new Map(periods.map((period) => [period.id, Math.floor((NOW.getTime() - new Date(period.cutoffDate).getTime()) / DAY)]));
    expect([...elapsed.values()]).toEqual(expect.arrayContaining([7, 8]));
    const late = await evaluate("period_not_locked", edges);
    const expected = [...elapsed].filter(([, days]) => days > 7).map(([id]) => id).sort();
    expect(late.map((row) => row.subjectId).sort()).toEqual(expected);
    expect(late.map((row) => row.measured.value).sort()).toEqual(expected.map((id) => elapsed.get(id)).sort());
    expect(late.map((row) => row.measured.value)).not.toContain(7);
  });

  it("ev_basis_divergence: the mapping summary's latest EV against the official EV at the default period's cutoff", async () => {
    const [row, ...rest] = await evaluate("ev_basis_divergence", gaps);
    expect(rest).toEqual([]);
    // 50,000 × 40 % approved after P1's cutoff: in the summary, not in the official EV.
    expect([row.measured.value, row.limit.value, figuresOf(row), row.data.higher, row.data.period, row.data.isSnapshot]).toEqual([20000, 0.01, { summaryEv: 20000, officialEv: 0 }, "summaryEv", "DQ-P1", false]);
    expect(row.data.figures.officialEv.basis).toMatch(/buildOfficialEvReport ev/);
    // Clean: the locked snapshot's EV and the summary agree.
    expect(await evaluate("ev_basis_divergence", clean)).toEqual([]);
  });

  it("readiness_override_active: the last lock went over a PM override and the gate is still blocked; a lock without one never", async () => {
    const [row, ...rest] = await evaluate("readiness_override_active", gaps);
    expect(rest).toEqual([]);
    expect([row.subjectType, row.subjectId, row.data.overriddenByRole]).toEqual(["reporting_period", gaps.period0.id, "pm"]);
    expect(row.data.blockerCodes).toContain("NO_APPROVED_COST_LOADING");
    expect(row.measured.value).toBe(row.data.blockerCodes.length);
    expect(JSON.stringify(row.data)).not.toMatch(/Amount/);
    // The clean project's gate is blocked too, but its lock carried no override.
    expect(await evaluate("readiness_override_active", clean)).toEqual([]);
  });

  // ─── change links ────────────────────────────────────────────────────────

  it("orphan_change_link: a revision naming no order, a workflow link to a missing record, an RFI pointing at another project's order", async () => {
    const rows = bySubject(await evaluate("orphan_change_link", gaps));
    expect([...rows.keys()].sort()).toEqual([`budget_revision:${gaps.orphanRevision.id}`, `rfi:${gaps.crossRfi.id}`, `workflow_activity_link:${gaps.orphanLink.id}`, `workflow_activity_link:${gaps.crossLink.id}`].sort());
    expect(rows.get(`budget_revision:${gaps.orphanRevision.id}`).data.value).toBe("VO-404");
    expect(rows.get(`workflow_activity_link:${gaps.orphanLink.id}`).data.recordType).toBe("rfi");
    // A record that exists in ANOTHER project does not resolve the link: it is checked in the link's own project.
    expect([rows.get(`workflow_activity_link:${gaps.crossLink.id}`).data.recordType, rows.get(`workflow_activity_link:${gaps.crossLink.id}`).data.value]).toEqual(["rfi", clean.rfi.id]);
    expect(rows.get(`rfi:${gaps.crossRfi.id}`).data.crossProject).toBe(true);
    for (const row of rows.values()) expect([row.measured.value, row.limit.value]).toEqual([1, 0]);
    expect(await evaluate("orphan_change_link", clean)).toEqual([]);
  });

  it("change_order_possible_duplicate: approved, unarchived repeats of one description and activity impact — one info row naming the original", async () => {
    const [row, ...rest] = await evaluate("change_order_possible_duplicate", gaps);
    expect(rest).toEqual([]);
    expect([row.subjectType, row.subjectId, row.secondarySubjectType, row.secondarySubjectId]).toEqual(["change_order", gaps.vo2.id, "change_order", gaps.vo1.id]);
    expect([row.measured.value, row.limit.value, row.data.refs]).toEqual([2, 1, ["VO-1", "VO-2"]]);
    expect(row.data.activityImpacts).toEqual([{ activityId: gaps.a1.id, approvedScheduleImpactDays: 10 }]);
    expect(ruleOf("change_order_possible_duplicate").severity).toBe("info");
    expect(await evaluate("change_order_possible_duplicate", clean)).toEqual([]);
  });

  // ─── tenancy and read-only ───────────────────────────────────────────────

  it("a rule asked for a project under another organisation sees nothing of it", async () => {
    for (const rule of RULES) {
      let rows;
      try {
        rows = await rule.evaluate({ orgId: other.org.id, projectId: gaps.project.id, cutoff: NOW, ctx: {} });
      } catch (error) {
        expect([rule.kind, error.code || error.status]).toEqual([rule.kind, expect.stringMatching(/NOT_FOUND|404/)]);
        continue;
      }
      expect([rule.kind, rows]).toEqual([rule.kind, []]);
    }
  });

  it("evaluating every rule on both projects writes nothing (every row of the organisation compared)", async () => {
    const scope = { orgId: live.org.id, projectIds: [gaps.project.id, clean.project.id] };
    const before = await everyRow(scope);
    const ctx = {};
    for (const built of [gaps, clean]) {
      for (const rule of RULES) await rule.evaluate({ orgId: live.org.id, projectId: built.project.id, cutoff: NOW, ctx });
    }
    expect(changesBetween(before, await everyRow(scope))).toEqual([]);
  }, 120_000);

  // ─── the forecast reads the open data-quality rows ───────────────────────

  // The forecast as the base (dfb2e77, before PC-7b dq) builds it, compiled
  // in memory beside the real file so its requires resolve; nothing written.
  let baseForecast = null;
  const baseForecastService = () => {
    if (baseForecast) return baseForecast;
    const { execFileSync } = require("child_process");
    const Module = require("module");
    const path = require("path");
    const source = execFileSync("git", ["show", "dfb2e77:backend/src/services/forecast.service.js"], { cwd: path.resolve(__dirname, "..", "..", ".."), encoding: "utf8" });
    const filename = path.join(__dirname, "..", "forecast.service.at-dfb2e77.in-memory.js");
    const baseModule = new Module(filename, module);
    baseModule.filename = filename;
    baseModule.paths = Module._nodeModulePaths(path.dirname(filename));
    baseModule._compile(source, filename);
    baseForecast = baseModule.exports;
    return baseForecast;
  };
  const FULL = { boq: true, budget: true };
  const forecastFigures = (forecast) => stable({ ...forecast, dataQuality: undefined, dataQualityItems: undefined, dataQualityWithheld: undefined });

  it("forecast.dataQuality lists the open data-quality rows per reader beside its own notes; every figure is byte-identical to the base code's", async () => {
    const { buildForecast } = require("../forecast.service");
    const base = baseForecastService();

    const orgId = live.org.id;
    const projectId = gaps.project.id;
    const COST = { boq: false, budget: true };
    const NONE = { boq: false, budget: false };
    const figures = forecastFigures;

    const before = await base.buildForecast({ orgId, projectId, asOf: NOW });
    expect(before.available).toBe(true);
    // No exception rows yet: the answer is the base's, notes included.
    expect(stable(await buildForecast({ orgId, projectId, asOf: NOW, access: FULL }))).toBe(stable(before));

    const exception = (kind, severity, subjectId, extra = {}) => ({
      orgId, projectId, kind, severity, subjectType: "test", subjectId, measured: 1, limit: 0, measuredBasis: "LiveTest", limitBasis: "LiveTest", ...extra,
    });
    const rows = [
      exception("progress_stale", "warning", "a"),
      exception("forecast_without_provenance", "info", "b"),
      exception("forecast_without_provenance", "info", "c"),
      exception("budget_truths_disagree", "info", "d"),
      exception("budget_truths_disagree", "warning", "e"),
      exception("budget_truths_disagree", "info", "f"),
      exception("period_not_locked", "warning", "g", { snoozedUntil: new Date(NOW.getTime() + 5 * DAY) }), // snoozed: not listed
      exception("period_not_locked", "warning", "h", { resolvedAt: daysAgo(1), resolvedReason: "dismissed:LiveTest" }), // dismissed: not listed
      exception("quantity_over_boq", "critical", "i"), // an overrun kind: never a data note
    ];
    await prisma.projectException.createMany({ data: rows });
    // Another organisation's row never reaches this project's notes.
    const otherProject = await prisma.project.create({ data: { orgId: other.org.id, name: "LiveTest PC-7b other" } });
    await prisma.projectException.create({ data: { ...exception("progress_stale", "warning", "z"), orgId: other.org.id, projectId: otherProject.id } });
    try {
      const full = await buildForecast({ orgId, projectId, asOf: NOW, access: FULL });
      expect(figures(full)).toBe(figures(before));
      const own = before.dataQualityItems;
      expect(full.dataQualityItems.slice(0, own.length)).toEqual(own);
      const added = full.dataQualityItems.slice(own.length);
      expect(added.map((item) => [item.kind, item.severity, item.subject])).toEqual([
        ["budget_truths_disagree", "warning", ruleOf("budget_truths_disagree").label],
        ["forecast_without_provenance", "info", ruleOf("forecast_without_provenance").label],
        ["progress_stale", "warning", ruleOf("progress_stale").label],
      ]);
      expect(added.map((item) => item.message)).toEqual([ruleOf("budget_truths_disagree").note(3), ruleOf("forecast_without_provenance").note(2), ruleOf("progress_stale").note(1)]);
      expect(full.dataQuality).toEqual(full.dataQualityItems.map((item) => item.message));

      // A cost reader without the BOQ: no BOQ-derived kind, the cost kinds stay.
      const cost = await buildForecast({ orgId, projectId, asOf: NOW, access: COST });
      expect(figures(cost)).toBe(figures(before));
      expect(cost.dataQualityItems.slice(own.length).map((item) => item.kind)).toEqual(["budget_truths_disagree", "progress_stale"]);
      // The kinds left out are named (PC-7b integration D): from the access, with no count; the full reader has no marker.
      expect(full).not.toHaveProperty("dataQualityWithheld");
      expect(cost.dataQualityWithheld.reason).toMatch(/available only to members who may read the BOQ/);
      expect(JSON.stringify(cost.dataQualityWithheld)).not.toMatch(/\d/);
      // A schedule reader of neither, and a caller that names no access: the progress kind only.
      for (const access of [NONE, null, undefined]) {
        const plain = await buildForecast({ orgId, projectId, asOf: NOW, ...(access === undefined ? {} : { access }) });
        expect(figures(plain)).toBe(figures(before));
        expect(plain.dataQualityItems.slice(own.length).map((item) => item.kind)).toEqual(["progress_stale"]);
        expect(plain.dataQuality).toEqual(plain.dataQualityItems.map((item) => item.message));
      }
    } finally {
      await prisma.projectException.deleteMany({ where: { orgId: { in: [orgId, other.org.id] }, subjectType: "test" } });
    }
  }, 120_000);

  it("a project without a schedule: the forecast's 'no schedule' answer lists its open data-quality rows too, nothing else changes", async () => {
    const { buildForecast } = require("../forecast.service");
    const orgId = live.org.id;
    const projectId = bare.project.id;
    const before = await baseForecastService().buildForecast({ orgId, projectId, asOf: NOW });
    expect(before.available).toBe(false);
    // No rows yet: the base's answer.
    expect(stable(await buildForecast({ orgId, projectId, asOf: NOW, access: FULL }))).toBe(stable(before));
    await prisma.projectException.create({ data: { orgId, projectId, kind: "progress_stale", severity: "warning", subjectType: "test", subjectId: "bare", measured: 20, limit: 14, measuredBasis: "LiveTest", limitBasis: "LiveTest" } });
    try {
      const after = await buildForecast({ orgId, projectId, asOf: NOW, access: FULL });
      expect(after.available).toBe(false);
      expect(forecastFigures(after)).toBe(forecastFigures(before));
      expect(after.dataQualityItems).toEqual([...before.dataQualityItems, { kind: "progress_stale", severity: "warning", subject: ruleOf("progress_stale").label, message: ruleOf("progress_stale").note(1) }]);
      expect(after.dataQuality).toEqual(after.dataQualityItems.map((item) => item.message));
    } finally {
      await prisma.projectException.deleteMany({ where: { orgId, projectId, subjectType: "test" } });
    }
  }, 120_000);

  // ─── the read-only dry-run script ────────────────────────────────────────

  const runDryRun = (extra) => {
    const { spawnSync } = require("child_process");
    const path = require("path");
    const os = require("os");
    const out = path.join(os.tmpdir(), `pc7b-dq-dry-run-${process.pid}-${Date.now()}.json`);
    const run = spawnSync(process.execPath, ["scripts/project-controls/exception-dry-run.js", "--org", live.org.id, "--cutoff", NOW.toISOString(), "--json", out, ...extra], {
      cwd: path.resolve(__dirname, "..", "..", ".."),
      env: { ...process.env, DATABASE_CONNECTION_LIMIT: "1" },
      encoding: "utf8",
      timeout: 180_000,
    });
    const result = run.status === 0 && require("fs").existsSync(out) ? JSON.parse(require("fs").readFileSync(out, "utf8")) : null;
    if (result) require("fs").unlinkSync(out);
    return { status: run.status, output: `${run.stdout}\n${run.stderr}`, result };
  };
  const activeProjectIds = () => [gaps.project.id, clean.project.id, edges.project.id, bare.project.id];

  it("exception-dry-run.js --rules-only: one read-only session, the tick's projects only, the rows each rule finds, nothing written", async () => {
    const scope = { orgId: live.org.id, projectIds: [...activeProjectIds(), ...outOfScope.map((project) => project.id)] };
    const before = await everyRow(scope);
    const { status, output, result } = runDryRun(["--rules-only"]);
    expect([status, output]).toEqual([0, expect.stringContaining("read-only session verified")]);
    // The nightly tick's filter (status 'active', not archived): the archived and the completed project are not evaluated.
    expect([result.mode, result.sessionReadOnly, result.scope, result.projects, result.projectsOutOfScope, result.errors]).toEqual(["rules_only", "on", "active", 4, 2, []]);
    expect(result.perProject.map((row) => row.projectId).sort()).toEqual(activeProjectIds().sort());
    const counts = Object.fromEntries(result.perProject.map((row) => [row.projectId, row.counts]));
    expect(counts[gaps.project.id]).toEqual(EXPECTED_GAPS);
    expect(counts[clean.project.id]).toEqual({});
    expect(counts[edges.project.id].progress_stale).toBe(1);
    // Rules only: what the rules FIND, never called "would open".
    for (const [kind, rows] of Object.entries(EXPECTED_GAPS)) expect([kind, result.kinds[kind].found >= rows, "wouldOpen" in result.kinds[kind]]).toEqual([kind, true, false]);
    expect(output).toContain("rows the rules find");
    expect(output).not.toContain("would open");
    expect(changesBetween(before, await everyRow(scope))).toEqual([]);

    // --all-projects: every project of the organisation, archived and completed included.
    const all = runDryRun(["--rules-only", "--all-projects"]);
    expect([all.status, all.result.scope, all.result.projects, all.result.projectsOutOfScope]).toEqual([0, "all", 6, 0]);
  }, 300_000);

  it("exception-dry-run.js without --rules-only goes through the engine's dryRun", async () => {
    const { status, output, result } = runDryRun([]);
    expect([status, result.mode, result.sessionReadOnly, result.projects, result.errors]).toEqual([0, "engine_dry_run", "on", 4, []]);
    // A first pass: every data-quality row the gaps project would hold is a new one.
    const counts = Object.fromEntries(result.perProject.map((row) => [row.projectId, row.counts]));
    for (const [kind, rows] of Object.entries(EXPECTED_GAPS)) expect([kind, counts[gaps.project.id][kind]]).toEqual([kind, rows]);
    expect(output).toContain("rows it would open");
  }, 180_000);

  // ─── the engine (after the merge) ────────────────────────────────────────

  engineIt("the engine's rule registry picks the data-quality kinds up, with their module and BOQ flag", () => {
    const registry = require("../exception-rules");
    const rules = typeof registry.getRules === "function" ? registry.getRules() : registry;
    const meta = registry.kindMeta();
    for (const rule of RULES) {
      const loaded = rules.find((entry) => entry.kind === rule.kind);
      expect([rule.kind, Boolean(loaded), loaded?.file]).toEqual([rule.kind, true, "data-quality.js"]);
      expect([rule.kind, meta[rule.kind]]).toEqual([rule.kind, { kind: rule.kind, severity: rule.severity, subjectType: rule.subjectType, module: rule.module, boqDerived: rule.boqDerived }]);
    }
  });

  engineIt("evaluateProject opens the data-quality rows once, a dry run writes nothing, and a fixed gap resolves", async () => {
    const orgId = live.org.id;
    const projectId = gaps.project.id;
    const scope = { orgId, projectIds: [projectId, clean.project.id] };
    const dqKinds = [...RULES.DATA_QUALITY_KINDS];
    const openRows = () => prisma.projectException.findMany({ where: { orgId, projectId, kind: { in: dqKinds }, resolvedAt: null } });
    const idsOf = (rows) => rows.map((row) => row.id).sort();

    const before = await everyRow(scope);
    const dry = await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test", dryRun: true });
    expect(changesBetween(before, await everyRow(scope))).toEqual([]);
    expect(Array.isArray(dry.rows)).toBe(true);

    await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
    const first = await openRows();
    const expected = EXPECTED_GAPS;
    expect(Object.keys(expected).sort()).toEqual([...dqKinds].sort());
    for (const [kind, count] of Object.entries(expected)) expect([kind, first.filter((row) => row.kind === kind).length]).toEqual([kind, count]);
    expect(first.every((row) => ["info", "warning"].includes(row.severity) && row.measuredBasis && row.limitBasis)).toBe(true);
    // The two-figure kinds hold the gap: measured above the cent tolerance on every row.
    for (const row of first.filter((entry) => GAP_KINDS.includes(entry.kind))) expect([row.kind, Number(row.measured) >= Number(row.limit), Number(row.limit)]).toEqual([row.kind, true, 0.01]);
    // The dry run said what the write did.
    for (const [kind, count] of Object.entries(expected)) expect([kind, dry.rows.filter((row) => row.kind === kind && row.change === "open").length]).toEqual([kind, count]);

    // Idempotent: a second pass opens nothing new and keeps one open row per subject.
    await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
    expect(idsOf(await openRows())).toEqual(idsOf(first));

    // The clean project opens none of these kinds.
    await engine.evaluateProject({ orgId, projectId: clean.project.id, cutoff: NOW, trigger: "test" });
    expect(await prisma.projectException.count({ where: { orgId, projectId: clean.project.id, kind: { in: dqKinds } } })).toBe(0);

    // A person enters the forecast: the provenance row resolves as cleared.
    await prisma.costRecord.update({ where: { id: gaps.r1.id }, data: { forecastSource: "entered" } });
    try {
      await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
      const resolved = await prisma.projectException.findFirst({ where: { orgId, projectId, kind: "forecast_without_provenance", subjectId: gaps.r1.id } });
      expect([resolved.resolvedAt !== null, resolved.resolvedReason]).toEqual([true, "cleared"]);
    } finally {
      await prisma.costRecord.update({ where: { id: gaps.r1.id }, data: { forecastSource: null } });
    }
  }, 180_000);

  engineIt("after a real pass the dry run counts nothing as 'would open': refreshes, unchanged rows, resolutions and suppressions are tallied apart", async () => {
    const orgId = live.org.id;
    for (const projectId of activeProjectIds()) await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
    // Dismiss one open row: the dry run must count it as suppressed, never as an opening.
    const dismissed = await prisma.projectException.findFirst({ where: { orgId, projectId: gaps.project.id, kind: "orphan_change_link", subjectId: gaps.orphanRevision.id, resolvedAt: null } });
    await engine.setDismissed({ orgId, projectId: gaps.project.id, exceptionId: dismissed.id, actorId: live.user.id, reason: "LiveTest reviewed" });
    const { status, output, result } = runDryRun([]);
    expect([status, result.mode, result.errors]).toEqual([0, "engine_dry_run", []]);
    for (const row of result.perProject) expect([row.projectId, row.counts]).toEqual([row.projectId, {}]);
    for (const [kind, entry] of Object.entries(result.kinds)) expect([kind, entry.wouldOpen, entry.projects]).toEqual([kind, 0, 0]);
    expect(result.engineTotals.opened).toBe(0);
    expect(result.kinds.orphan_change_link.suppressed).toBe(1);
    expect(result.kinds.orphan_change_link.unchanged).toBe(EXPECTED_GAPS.orphan_change_link - 1);
    expect(output).toContain("rows it would open");
  }, 240_000);

  engineIt("a dismissed disagreement whose LARGER figure moves further away reopens (the gap is measured, so the worsening is seen)", async () => {
    const orgId = live.org.id;
    const projectId = gaps.project.id;
    const where = { orgId, projectId, kind: "budget_truths_disagree", secondarySubjectId: "ev_bac_vs_contract_waterfall" };
    await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
    const row = await prisma.projectException.findFirst({ where: { ...where, resolvedAt: null } });
    expect(Number(row.measured)).toBe(50000);
    await engine.setDismissed({ orgId, projectId, exceptionId: row.id, actorId: live.user.id, reason: "LiveTest reviewed" });
    // Unchanged: it stays dismissed.
    await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
    expect(await prisma.projectException.count({ where: { ...where, resolvedAt: null } })).toBe(0);
    // The contract waterfall (the larger figure) rises: the EV BAC is 51,000 still, the gap 90,000.
    await prisma.project.update({ where: { id: projectId }, data: { contractValue: 140000 } });
    try {
      await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
      const reopened = await prisma.projectException.findFirst({ where: { ...where, resolvedAt: null } });
      expect([Boolean(reopened), reopened && Number(reopened.measured), reopened?.dataJson?.reopenedFrom?.id]).toEqual([true, 90000, row.id]);
    } finally {
      await prisma.project.update({ where: { id: projectId }, data: { contractValue: 100000 } });
    }
  }, 180_000);

  // ─── PC-7b integration E: dismissal episodes ─────────────────────────────

  engineIt("progress_stale and period_not_locked name their episode: a dismissal holds however many days pass, and a new episode reopens", async () => {
    const orgId = live.org.id;
    const projectId = gaps.project.id;
    const later = (days) => new Date(NOW.getTime() + days * DAY);
    const openOf = (kind, subjectId) => prisma.projectException.findFirst({ where: { orgId, projectId, kind, subjectId, resolvedAt: null } });
    await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
    const stale = await openOf("progress_stale", gaps.a1.id);
    const period = await openOf("period_not_locked", gaps.period1.id);
    expect([stale.dataJson.dismissalKey, period.dataJson.dismissalKey]).toEqual([`activity_progress:${gaps.p1.id}@${gaps.p1.approvedAt.toISOString()}`, `reporting_period:${gaps.period1.id}`]);
    const exceptionService = require("../exception.service");
    const access = { boq: true, modules: { boq: true, cost: true, schedule: true, progress: true } };
    const may = { changeEventUpdate: true, changeEventCreate: true, moduleUpdate: {} };
    // Dismissed through the API's own action (dataJson.dismissedFingerprint).
    for (const row of [stale, period]) await exceptionService.dismissException({ orgId, projectId, exceptionId: row.id, access, may, actor: { id: live.user.id, role: "pm" }, payload: { reason: "LiveTest known" } });
    // Ten and forty days later the same episodes have grown — they stay dismissed.
    for (const days of [10, 40]) {
      const result = await engine.evaluateProject({ orgId, projectId, cutoff: later(days), trigger: "test" });
      expect([days, await openOf("progress_stale", gaps.a1.id), await openOf("period_not_locked", gaps.period1.id)]).toEqual([days, null, null]);
      expect(result.rows.filter((row) => row.change === "suppressed" || row.change === "reopen").length).toBe(0);
    }
    // A new episode: newer approved progress on A1 that went stale itself.
    const newer = await prisma.activityProgress.create({ data: { activityId: gaps.a1.id, pctComplete: 45, status: "approved", approvedAt: daysAgo(20), updatedAt: daysAgo(20) } });
    try {
      await engine.evaluateProject({ orgId, projectId, cutoff: NOW, trigger: "test" });
      const reopened = await openOf("progress_stale", gaps.a1.id);
      expect([Boolean(reopened), reopened && Number(reopened.measured), reopened?.dataJson?.reopenedFrom?.id, reopened?.dataJson?.dismissalKey]).toEqual([true, 20, stale.id, `activity_progress:${newer.id}@${newer.approvedAt.toISOString()}`]);
      // The period's dismissal still holds.
      expect(await openOf("period_not_locked", gaps.period1.id)).toBeNull();
    } finally {
      await prisma.projectException.deleteMany({ where: { orgId, projectId, kind: "progress_stale", resolvedAt: null } });
      await prisma.activityProgress.delete({ where: { id: newer.id } });
    }
  }, 240_000);
});
