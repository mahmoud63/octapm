/**
 * The exception engine (PC-7b; OCTAPM_CHANGE_INTELLIGENCE.md §1, §6).
 *
 * One evaluator, two triggers, no second engine. `evaluateProject` runs every
 * rule of exception-rules/ against one project — each rule a pure read of the
 * figures its owner service states — and reconciles what they found with the
 * project's ProjectException rows in ONE transaction:
 *
 *   - a finding with an open row for its subject (the partial unique key
 *     ProjectException_open_subject_key: project, kind, subject, secondary
 *     subject; NULL-safe) refreshes that row: lastSeenAt always moves; the
 *     figures, bases, severity, group keys and data are rewritten only when
 *     one of them changed;
 *   - a finding with no open row opens one — unless the latest resolved row
 *     for that subject was DISMISSED by a person (resolvedReason
 *     'dismissed:…', its measured/limit fingerprint in dataJson.dismissal) and
 *     the measured figure has not moved past the dismissed one in the adverse
 *     (upward) direction: then nothing is written. A worsening opens a NEW
 *     open row that names the dismissed one (dataJson.reopenedFrom); the
 *     person's dismissal stays as they left it;
 *   - an open row whose kind was evaluated and whose subject was not found
 *     again is resolved: resolvedAt = now, resolvedReason 'cleared'. A kind
 *     whose rule was skipped (its source absent) or failed keeps its rows.
 *
 * The engine writes ProjectException rows and nothing else: no change order,
 * no budget, schedule, forecast or EAC figure, no audit event, no domain
 * event. A snoozed row keeps refreshing; who is notified, and when, is the
 * listeners' business (registerEvaluationListener — the api track's
 * notifications), told after the commit which rows opened or became critical
 * and whether each is snoozed. `dryRun` reads and plans and writes nothing.
 *
 * Tenancy: the project is loaded where { id, orgId } before any rule runs;
 * every rule reads through a service scoped to that project.
 */
const { Prisma } = require("@prisma/client");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const registry = require("./exception-rules");
const { QUANTITY_TOLERANCE } = require("./exception-rules/_thresholds");

const RESOLVED_CLEARED = "cleared";
const DISMISSED_PREFIX = "dismissed:";
// dataJson keys the engine and the dismissal own; a rule's data never uses them.
const RESERVED_DATA_KEYS = Object.freeze(["dismissal", "reopenedFrom"]);
const TRIGGERS = Object.freeze(["event", "scheduled", "manual", "test"]);
const DEBOUNCE_MS = 30_000;
const TRANSACTION_OPTIONS = Object.freeze({ maxWait: 15_000, timeout: 120_000 });

/** EXCEPTIONS_ENGINE_ENABLED (default true): the event subscriber, the nightly tick and the job handler all stand down when it is "false". */
const engineEnabled = (env = process.env) => String(env.EXCEPTIONS_ENGINE_ENABLED ?? "true").trim().toLowerCase() !== "false";

const jobService = () => require("../jobs/job.service");

// ─── figures and keys ──────────────────────────────────────────────────────

const decimalText = (value) => new Prisma.Decimal(value ?? 0).toFixed(3);
const storedText = (value) => (value === null || value === undefined ? null : new Prisma.Decimal(value.toString()).toFixed(3));

const keyOf = (row) => [row.kind, row.subjectType, row.subjectId, row.secondarySubjectType || "", row.secondarySubjectId || ""].join("\u0000");

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (value[key] !== undefined) acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
};
const stable = (value) => JSON.stringify(sortKeys(value));

const ruleDataOf = (dataJson) => {
  const data = dataJson && typeof dataJson === "object" && !Array.isArray(dataJson) ? { ...dataJson } : {};
  for (const key of RESERVED_DATA_KEYS) delete data[key];
  return data;
};
const reservedDataOf = (dataJson) => {
  const data = dataJson && typeof dataJson === "object" && !Array.isArray(dataJson) ? dataJson : {};
  return Object.fromEntries(RESERVED_DATA_KEYS.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

/** A rule's row checked and put in the stored form; throws on a malformed row (the rule then counts as failed). */
const normalizeFinding = (rule, raw) => {
  const fail = (message) => {
    throw new Error(`exception rule ${rule.kind}: ${message}`);
  };
  if (!raw || typeof raw !== "object") fail("a finding must be an object");
  const subjectType = trimOrNull(raw.subjectType) || fail("subjectType is required");
  const subjectId = trimOrNull(raw.subjectId) || fail("subjectId is required");
  const secondarySubjectType = trimOrNull(raw.secondarySubjectType);
  const secondarySubjectId = trimOrNull(raw.secondarySubjectId);
  if (Boolean(secondarySubjectType) !== Boolean(secondarySubjectId)) fail("a secondary subject needs both its type and its id");
  for (const side of ["measured", "limit"]) {
    const figure = raw[side];
    if (!figure || !Number.isFinite(Number(figure.value)) || figure.value === null || figure.value === "") fail(`${side}.value must be a finite number`);
    if (!trimOrNull(figure.basis)) fail(`${side}.basis is required: every figure states where it came from`);
  }
  const severity = raw.severity === undefined ? rule.severity : raw.severity;
  if (!registry.SEVERITIES.includes(severity)) fail(`severity ${severity} is not one of ${registry.SEVERITIES.join(", ")}`);
  const data = raw.data === undefined || raw.data === null ? {} : raw.data;
  if (typeof data !== "object" || Array.isArray(data)) fail("data must be an object");
  for (const key of RESERVED_DATA_KEYS) if (data[key] !== undefined) fail(`data.${key} is reserved for the engine`);
  const groupKeys = raw.groupKeys || {};
  return {
    kind: rule.kind,
    severity,
    subjectType,
    subjectId,
    secondarySubjectType,
    secondarySubjectId,
    wbsNodeId: trimOrNull(groupKeys.wbsNodeId),
    locationId: trimOrNull(groupKeys.locationId),
    costCodeId: trimOrNull(groupKeys.costCodeId),
    measured: decimalText(raw.measured.value),
    limit: decimalText(raw.limit.value),
    unitCode: trimOrNull(raw.measured.unitCode) || trimOrNull(raw.limit.unitCode),
    measuredBasis: String(raw.measured.basis).trim(),
    limitBasis: String(raw.limit.basis).trim(),
    data: JSON.parse(JSON.stringify(data)),
  };
};

// What a refresh compares: everything a rule states about the subject.
const fingerprintOfFinding = (finding) =>
  stable({
    severity: finding.severity,
    measured: finding.measured,
    limit: finding.limit,
    unitCode: finding.unitCode,
    measuredBasis: finding.measuredBasis,
    limitBasis: finding.limitBasis,
    wbsNodeId: finding.wbsNodeId,
    locationId: finding.locationId,
    costCodeId: finding.costCodeId,
    data: finding.data,
  });
const fingerprintOfRow = (row) =>
  stable({
    severity: row.severity,
    measured: storedText(row.measured),
    limit: storedText(row.limit),
    unitCode: row.unitCode || null,
    measuredBasis: row.measuredBasis,
    limitBasis: row.limitBasis,
    wbsNodeId: row.wbsNodeId || null,
    locationId: row.locationId || null,
    costCodeId: row.costCodeId || null,
    data: ruleDataOf(row.dataJson),
  });

const isDismissed = (row) => typeof row?.resolvedReason === "string" && row.resolvedReason.startsWith(DISMISSED_PREFIX);

/** The measured figure a dismissal was made against: its fingerprint, else the frozen row's own. */
const dismissedMeasured = (row) => {
  const fingerprint = row?.dataJson?.dismissal?.measured;
  return Number(fingerprint !== undefined && fingerprint !== null ? fingerprint : storedText(row.measured));
};

/** A dismissed condition comes back only when its measured figure has moved past the dismissed one, upwards. */
const worsenedSince = (finding, dismissedRow) => Number(finding.measured) > dismissedMeasured(dismissedRow) + QUANTITY_TOLERANCE;

/** The status the readers show: dismissed / resolved / in_change / snoozed / open. */
const statusOf = (row, now = new Date()) => {
  if (row.resolvedAt) return isDismissed(row) ? "dismissed" : "resolved";
  if (row.changeEventId) return "in_change";
  if (row.snoozedUntil && new Date(row.snoozedUntil) > now) return "snoozed";
  return "open";
};

const isSnoozed = (row, now) => Boolean(row?.snoozedUntil && new Date(row.snoozedUntil) > now);

// ─── the plan (pure) ───────────────────────────────────────────────────────

/**
 * What the findings mean for the stored rows. `open` is every open row of the
 * project; `latestResolved` maps a subject key to its latest resolved row;
 * `evaluatedKinds` are the kinds whose rules ran to the end.
 */
const planChanges = ({ findings, open, latestResolved, evaluatedKinds }) => {
  const openByKey = new Map(open.map((row) => [keyOf(row), row]));
  const plan = { create: [], refresh: [], touch: [], resolve: [], suppressed: [] };
  const seen = new Set();
  for (const finding of findings) {
    const key = keyOf(finding);
    seen.add(key);
    const existing = openByKey.get(key);
    if (existing) {
      if (fingerprintOfRow(existing) === fingerprintOfFinding(finding)) plan.touch.push({ existing, finding });
      else plan.refresh.push({ existing, finding });
      continue;
    }
    const previous = latestResolved.get(key) || null;
    if (previous && isDismissed(previous)) {
      if (!worsenedSince(finding, previous)) {
        plan.suppressed.push({ dismissed: previous, finding });
        continue;
      }
      plan.create.push({ finding, reopenedFrom: previous });
      continue;
    }
    plan.create.push({ finding, reopenedFrom: null });
  }
  for (const row of open) {
    if (!seen.has(keyOf(row)) && evaluatedKinds.has(row.kind)) plan.resolve.push(row);
  }
  return plan;
};

// ─── listeners ─────────────────────────────────────────────────────────────

const listeners = new Set();
/** A listener receives { orgId, projectId, trigger, opened: [row], escalated: [row] } after each committed evaluation; returns an unregister function. */
const registerEvaluationListener = (listener) => {
  if (typeof listener !== "function") throw new TypeError("An evaluation listener must be a function");
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notifyListeners = async (payload) => {
  for (const listener of [...listeners]) {
    try {
      await listener(payload);
    } catch (error) {
      console.error("[exception-engine] listener failed", error?.message || error);
    }
  }
};

// ─── evaluation ────────────────────────────────────────────────────────────

const loadProject = async ({ orgId, projectId }, client = prisma) => {
  if (!orgId || !projectId) throw new HttpError(400, "VALIDATION_ERROR", "orgId and projectId are required");
  const project = await client.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, orgId: true, name: true, currency: true, timezone: true, status: true, archivedAt: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// A calendar date is THE reporting cutoff (the end of that day in the
// project's zone, as EV and the quantity views read it); an instant is taken
// as it is; nothing means "as of now".
const resolveCutoff = async ({ cutoff, orgId, projectId }) => {
  if (cutoff === undefined || cutoff === null || cutoff === "") return null;
  if (cutoff instanceof Date) {
    if (Number.isNaN(cutoff.getTime())) throw new HttpError(400, "VALIDATION_ERROR", "cutoff must be a valid date");
    return cutoff;
  }
  const { cutoffDate } = await require("./quantity-views.service").resolveViewCutoff({ cutoffDate: cutoff, orgId, projectId });
  return cutoffDate;
};

const buildContext = ({ project, cutoff, now }) => {
  const cache = new Map();
  const notes = [];
  return {
    orgId: project.orgId,
    projectId: project.id,
    projectName: project.name,
    currency: project.currency || null,
    cutoff,
    now,
    memo(key, read) {
      if (!cache.has(key)) cache.set(key, Promise.resolve().then(read));
      return cache.get(key);
    },
    note(message) {
      notes.push(String(message));
    },
    notes,
  };
};

/** Runs the rules one after another; a rule that fails or whose source is absent leaves its kind's rows alone. */
const runRules = async ({ rules, ctx, log }) => {
  const findings = [];
  const evaluatedKinds = new Set();
  const skipped = [];
  const errors = [];
  for (const rule of rules) {
    const unavailable = rule.requires ? rule.requires() : null;
    if (unavailable) {
      skipped.push({ kind: rule.kind, reason: unavailable });
      log(`skipped ${rule.kind}: ${unavailable}`);
      continue;
    }
    try {
      const raw = await rule.evaluate({ orgId: ctx.orgId, projectId: ctx.projectId, cutoff: ctx.cutoff, ctx });
      if (!Array.isArray(raw)) throw new Error(`exception rule ${rule.kind}: evaluate must answer an array`);
      const keys = new Set();
      const ruleFindings = [];
      for (const row of raw) {
        const finding = normalizeFinding(rule, row);
        const key = keyOf(finding);
        if (keys.has(key)) {
          ctx.note(`${rule.kind}: subject ${finding.subjectType} ${finding.subjectId} was found twice; the first finding stands`);
          continue;
        }
        keys.add(key);
        ruleFindings.push(finding);
      }
      findings.push(...ruleFindings);
      evaluatedKinds.add(rule.kind);
    } catch (error) {
      errors.push({ kind: rule.kind, message: error?.message || String(error) });
      log(`rule ${rule.kind} failed: ${error?.message || error}`);
    }
  }
  return { findings, evaluatedKinds, skipped, errors };
};

const readLatestResolved = async ({ client, orgId, projectId, findings, openKeys }) => {
  const wanted = findings.filter((finding) => !openKeys.has(keyOf(finding)));
  if (!wanted.length) return new Map();
  const rows = await client.projectException.findMany({
    where: {
      orgId,
      projectId,
      resolvedAt: { not: null },
      kind: { in: [...new Set(wanted.map((finding) => finding.kind))] },
      subjectId: { in: [...new Set(wanted.map((finding) => finding.subjectId))] },
    },
    orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
  });
  const latest = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!latest.has(key)) latest.set(key, row);
  }
  return latest;
};

const rowSummary = (row, change, now) => ({
  id: row.id || null,
  change,
  kind: row.kind,
  severity: row.severity,
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  secondarySubjectType: row.secondarySubjectType || null,
  secondarySubjectId: row.secondarySubjectId || null,
  measured: typeof row.measured === "string" ? row.measured : storedText(row.measured),
  limit: typeof row.limit === "string" ? row.limit : storedText(row.limit),
  unitCode: row.unitCode || null,
  snoozed: isSnoozed(row, now),
});

const findingData = (finding) => ({
  severity: finding.severity,
  wbsNodeId: finding.wbsNodeId,
  locationId: finding.locationId,
  costCodeId: finding.costCodeId,
  measured: finding.measured,
  limit: finding.limit,
  unitCode: finding.unitCode,
  measuredBasis: finding.measuredBasis,
  limitBasis: finding.limitBasis,
});

const applyPlan = async ({ tx, plan, project, now }) => {
  const opened = [];
  const refreshed = [];
  for (const { finding, reopenedFrom } of plan.create) {
    const created = await tx.projectException.create({
      data: {
        orgId: project.orgId,
        projectId: project.id,
        kind: finding.kind,
        subjectType: finding.subjectType,
        subjectId: finding.subjectId,
        secondarySubjectType: finding.secondarySubjectType,
        secondarySubjectId: finding.secondarySubjectId,
        ...findingData(finding),
        detectedAt: now,
        lastSeenAt: now,
        dataJson: {
          ...finding.data,
          ...(reopenedFrom
            ? { reopenedFrom: { id: reopenedFrom.id, resolvedReason: reopenedFrom.resolvedReason, dismissedMeasured: String(dismissedMeasured(reopenedFrom)) } }
            : {}),
        },
      },
    });
    opened.push({ row: created, reopened: Boolean(reopenedFrom) });
  }
  for (const { existing, finding } of plan.refresh) {
    const updated = await tx.projectException.update({
      where: { id: existing.id },
      data: { ...findingData(finding), lastSeenAt: now, dataJson: { ...finding.data, ...reservedDataOf(existing.dataJson) } },
    });
    refreshed.push({ before: existing, row: updated });
  }
  const touchIds = plan.touch.map(({ existing }) => existing.id);
  if (touchIds.length) {
    await tx.projectException.updateMany({ where: { id: { in: touchIds }, projectId: project.id, resolvedAt: null }, data: { lastSeenAt: now } });
  }
  const resolveIds = plan.resolve.map((row) => row.id);
  if (resolveIds.length) {
    await tx.projectException.updateMany({
      where: { id: { in: resolveIds }, projectId: project.id, resolvedAt: null },
      data: { resolvedAt: now, resolvedReason: RESOLVED_CLEARED },
    });
  }
  return { opened, refreshed };
};

/**
 * Evaluates one project. Returns { opened, refreshed, resolved, unchanged,
 * suppressed, skipped: [{ kind, reason }], errors: [{ kind, message }],
 * notes, rows } — `rows` summarises every row touched (or, on a dry run,
 * that would be).
 */
const evaluateProject = async ({ orgId, projectId, cutoff = null, trigger = "manual", dryRun = false, rules = null, now = new Date(), logger = console } = {}) => {
  const project = await loadProject({ orgId, projectId });
  const resolvedCutoff = await resolveCutoff({ cutoff, orgId, projectId });
  const ctx = buildContext({ project, cutoff: resolvedCutoff, now });
  const log = (message) => logger?.log?.(`[exception-engine] ${project.id}: ${message}`);
  const { findings, evaluatedKinds, skipped, errors } = await runRules({ rules: rules || registry.getRules(), ctx, log });

  const reconcile = async (client) => {
    const open = await client.projectException.findMany({ where: { orgId, projectId, resolvedAt: null } });
    const latestResolved = await readLatestResolved({ client, orgId, projectId, findings, openKeys: new Set(open.map(keyOf)) });
    return planChanges({ findings, open, latestResolved, evaluatedKinds });
  };

  const base = {
    projectId,
    orgId,
    trigger: TRIGGERS.includes(trigger) ? trigger : "manual",
    dryRun: Boolean(dryRun),
    cutoff: resolvedCutoff ? resolvedCutoff.toISOString() : null,
    evaluatedKinds: [...evaluatedKinds],
    skipped,
    errors,
    notes: ctx.notes,
  };

  if (dryRun) {
    const plan = await reconcile(prisma);
    return {
      ...base,
      opened: plan.create.length,
      refreshed: plan.refresh.length,
      resolved: plan.resolve.length,
      unchanged: plan.touch.length,
      suppressed: plan.suppressed.length,
      rows: [
        ...plan.create.map(({ finding, reopenedFrom }) => rowSummary(finding, reopenedFrom ? "reopen" : "open", now)),
        ...plan.refresh.map(({ existing, finding }) => ({ ...rowSummary(finding, "refresh", now), id: existing.id, snoozed: isSnoozed(existing, now) })),
        ...plan.touch.map(({ existing }) => rowSummary(existing, "unchanged", now)),
        ...plan.resolve.map((row) => rowSummary(row, "resolve", now)),
        ...plan.suppressed.map(({ dismissed, finding }) => ({ ...rowSummary(finding, "suppressed", now), id: null, dismissedId: dismissed.id })),
      ],
    };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // One evaluation of a project at a time: the open-row key is enforced by
    // the database, and the lock keeps two evaluations from racing into it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-exceptions:${projectId}`}))`;
    const plan = await reconcile(tx);
    const applied = await applyPlan({ tx, plan, project, now });
    return { plan, applied };
  }, TRANSACTION_OPTIONS);

  const { plan, applied } = outcome;
  const opened = applied.opened.map(({ row, reopened }) => ({ ...rowSummary(row, reopened ? "reopen" : "open", now) }));
  const escalated = applied.refreshed
    .filter(({ before, row }) => row.severity === "critical" && before.severity !== "critical")
    .map(({ row }) => rowSummary(row, "escalate", now));
  const result = {
    ...base,
    opened: plan.create.length,
    refreshed: plan.refresh.length,
    resolved: plan.resolve.length,
    unchanged: plan.touch.length,
    suppressed: plan.suppressed.length,
    rows: [
      ...opened,
      ...applied.refreshed.map(({ row }) => rowSummary(row, "refresh", now)),
      ...plan.touch.map(({ existing }) => rowSummary(existing, "unchanged", now)),
      ...plan.resolve.map((row) => rowSummary(row, "resolve", now)),
    ],
  };
  if (opened.length || escalated.length) await notifyListeners({ orgId, projectId, trigger: result.trigger, opened, escalated });
  return result;
};

// ─── a person's dismissal (for the api track's action) ────────────────────

/**
 * Dismisses an open exception: resolvedAt now, resolvedReason
 * 'dismissed:<reason>', the review stamped, and the measured/limit
 * fingerprint the engine compares against kept in dataJson.dismissal. The
 * engine will not reopen the condition while its measured figure stays at or
 * below the dismissed one. Writes this one row only.
 */
const setDismissed = async ({ orgId, projectId, exceptionId, actorId = null, reason, note = null, now = new Date() }) => {
  const text = trimOrNull(reason);
  if (!text) throw new HttpError(400, "VALIDATION_ERROR", "A dismissal needs a reason");
  await loadProject({ orgId, projectId });
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-exceptions:${projectId}`}))`;
    const row = await tx.projectException.findFirst({ where: { id: exceptionId, projectId, orgId } });
    if (!row) throw new HttpError(404, "EXCEPTION_NOT_FOUND", "Exception not found");
    if (row.resolvedAt) throw new HttpError(409, "EXCEPTION_NOT_OPEN", "The exception is no longer open", { status: statusOf(row, now) });
    const noteText = trimOrNull(note);
    return tx.projectException.update({
      where: { id: row.id },
      data: {
        resolvedAt: now,
        resolvedReason: `${DISMISSED_PREFIX}${text.slice(0, 200)}`,
        reviewedAt: now,
        reviewedBy: actorId,
        reviewNote: noteText ? noteText.slice(0, 2000) : row.reviewNote,
        dataJson: {
          ...(row.dataJson && typeof row.dataJson === "object" ? row.dataJson : {}),
          dismissal: {
            measured: storedText(row.measured),
            limit: storedText(row.limit),
            unitCode: row.unitCode || null,
            dismissedAt: now.toISOString(),
            dismissedBy: actorId,
            reason: text.slice(0, 200),
          },
        },
      },
    });
  }, TRANSACTION_OPTIONS);
};

// ─── the job and its debounce ──────────────────────────────────────────────

const pendingEnqueues = new Map();

/**
 * Asks for an evaluation of a project by a background job, debounced: when a
 * QUEUED 'exceptions.evaluate' job for the project already waits, nothing is
 * added (it will read the newest figures when it runs). A job that is already
 * RUNNING may have read its figures before this change, so one more is queued
 * behind it — at most one ever waits per project. The job runs DEBOUNCE_MS
 * after the first request, so a burst of approvals is evaluated once.
 */
const enqueueEvaluation = async ({ orgId, projectId, reason = null, trigger = "event", delayMs = DEBOUNCE_MS, now = new Date() }) => {
  if (!orgId || !projectId) return { enqueued: false, reason: "orgId and projectId are required" };
  const inFlight = pendingEnqueues.get(projectId);
  if (inFlight) return inFlight.then((answer) => ({ ...answer, enqueued: false, coalesced: true }));
  const work = (async () => {
    const { JOB_TYPES, JOB_STATUSES, enqueueJob } = jobService();
    const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
    if (!project) return { enqueued: false, reason: "project not found in this organisation" };
    const waiting = await prisma.backgroundJob.findFirst({
      where: { orgId, projectId, type: JOB_TYPES.EXCEPTIONS_EVALUATE, status: JOB_STATUSES.QUEUED },
      select: { id: true },
    });
    if (waiting) return { enqueued: false, debounced: true, jobId: waiting.id };
    const job = await enqueueJob({
      orgId,
      projectId,
      type: JOB_TYPES.EXCEPTIONS_EVALUATE,
      payload: { trigger: TRIGGERS.includes(trigger) ? trigger : "event", reason: trimOrNull(reason) },
      runAfter: new Date(now.getTime() + Math.max(0, Number(delayMs) || 0)),
      maxAttempts: 2,
    });
    return { enqueued: true, jobId: job.id };
  })();
  pendingEnqueues.set(projectId, work);
  try {
    return await work;
  } finally {
    pendingEnqueues.delete(projectId);
  }
};

/** The 'exceptions.evaluate' job handler: one project, the job's organisation. */
const runEvaluationJob = async ({ job, log = () => {} }) => {
  if (!engineEnabled()) return { skipped: "EXCEPTIONS_ENGINE_ENABLED=false" };
  if (!job?.orgId || !job?.projectId) throw new HttpError(400, "VALIDATION_ERROR", "An exceptions.evaluate job names its organisation and project");
  const payload = job.payload || job.payloadJson || {};
  const result = await evaluateProject({ orgId: job.orgId, projectId: job.projectId, trigger: TRIGGERS.includes(payload.trigger) ? payload.trigger : "event" });
  log(`opened ${result.opened}, refreshed ${result.refreshed}, resolved ${result.resolved}, unchanged ${result.unchanged}, suppressed ${result.suppressed}`);
  const { rows, ...counts } = result;
  return { ...counts, rows: rows.length };
};

module.exports = {
  DEBOUNCE_MS,
  DISMISSED_PREFIX,
  RESERVED_DATA_KEYS,
  RESOLVED_CLEARED,
  TRIGGERS,
  engineEnabled,
  enqueueEvaluation,
  evaluateProject,
  fingerprintOfFinding,
  fingerprintOfRow,
  isDismissed,
  keyOf,
  normalizeFinding,
  planChanges,
  registerEvaluationListener,
  runEvaluationJob,
  setDismissed,
  statusOf,
  worsenedSince,
};
