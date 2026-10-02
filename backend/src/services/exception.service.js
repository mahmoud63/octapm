const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { cursorArgs, toCursorPage, normalizeListQuery } = require("../utils/list-query");
const { recordWorkspacePath } = require("../utils/record-links");
const {
  EXCEPTION_BOQ_SUBJECT_TYPES,
  changeEventRefsOf,
  withheldChangeEventAnswer,
  EXCEPTION_MODULES,
  exceptionAccess,
  exceptionPolicy,
  exceptionReadable,
  exceptionReadableWhere,
  exceptionsWithheldMarker,
  isBoqDerivedException,
  withheldExceptionCounts,
} = require("../utils/boq-figures");
const auditService = require("./audit.service");
const changeEventService = require("./change-event.service");

/**
 * Project exceptions — read, review and hand off (PC-7b, OCTAPM_CHANGE_INTELLIGENCE §1, §2, §5).
 *
 * The rows are derived and rebuildable: the exception engine writes them
 * (exception-engine.service). This service only reads them, records a
 * person's review of one (review, snooze, dismiss) and hands one off to a
 * change event. Nothing here writes a change order, a budget, a schedule, a
 * cost record or any figure: an exception's measured and limit figures are
 * the ones its owning service stated, shown with their basis; a change event
 * raised from one is a DRAFT (status open) with the amount left blank for
 * the QS. Who may read which exception, and the BOQ-derived withholding, is
 * decided in utils/boq-figures (the PC-7b exceptions block).
 */

const STATUSES = Object.freeze(["open", "in_change", "snoozed", "dismissed", "resolved"]);
const SEVERITIES = Object.freeze(["info", "warning", "critical"]);
const DISMISSED_PREFIX = "dismissed:";
const RELEASED_EVENT_STATUSES = Object.freeze([changeEventService.STATUS.VOID, changeEventService.STATUS.CLOSED]);
const MAX_SNOOZE_DAYS = 365;

const KIND_LABELS = Object.freeze({
  quantity_over_allocation: "Installed quantity over the allocation",
  quantity_over_boq: "Installed quantity over the BOQ quantity",
  certified_over_installed: "Certified quantity over the installed quantity",
  certified_over_earned: "Certified value over earned value",
  committed_over_budget: "Committed over the revised budget",
  actual_over_committed: "Actual cost over the committed value",
  forecast_over_revised: "Forecast over the revised budget",
  allocation_over_capacity: "Allocations over the BOQ item",
  schedule_slip_on_mapped_item: "Schedule slip on a mapped item",
  budget_truths_disagree: "Budget totals disagree",
  forecast_without_provenance: "Forecast without provenance",
  activity_budget_mismatch: "Activity budget differs from its allocations",
  unit_unresolved: "Unit not in the unit master",
  unit_mismatch: "Units differ",
  structure_missing: "Structure missing",
  progress_stale: "Progress not updated",
  period_not_locked: "Reporting period not locked",
  ev_basis_divergence: "Earned value bases differ",
  equipment_cost_unposted: "Equipment cost not posted",
  orphan_change_link: "Change link names a missing record",
  readiness_override_active: "Readiness override active",
  change_order_possible_duplicate: "Change order may duplicate another",
});
const kindLabel = (kind) => KIND_LABELS[kind] || String(kind || "Exception").replace(/_/g, " ");

// Kinds whose measured − limit is a quantity the change event's line can carry.
const QUANTITY_DELTA_KINDS = new Set(["quantity_over_allocation", "quantity_over_boq", "certified_over_installed", "allocation_over_capacity"]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const num = (value) => (value === null || value === undefined ? null : Number(value));
const round3 = (value) => Math.round(Number(value) * 1000) / 1000;

// ─── The engine's rule registry (when merged) ─────────────────────────────
//
// exception-rules/index.js (the engine track) loads every rule file; each
// rule states its `module` and `boqDerived`. Read once; its statements only
// widen the withholding (utils/boq-figures exceptionPolicy). Absent (this
// track's base), the API's own table stands.
//
// The engine's index exports functions (kindMeta, getRules, …), not an
// array: kindMeta() — kind → { module, boqDerived } — is its statement,
// getRules() the fallback; a bare array (or .rules) is still read.
const ruleListOf = (loaded) => {
  if (!loaded) return [];
  if (typeof loaded.kindMeta === "function") return Object.values(loaded.kindMeta() || {});
  if (typeof loaded.getRules === "function") return [...(loaded.getRules() || [])];
  if (Array.isArray(loaded)) return loaded;
  if (Array.isArray(loaded.rules)) return loaded.rules;
  if (Array.isArray(loaded.RULES)) return loaded.RULES;
  return [];
};

/** kind → { module, boqDerived } from a loaded rule registry; null when it states none. */
const registryFrom = (loaded) => {
  const registry = {};
  for (const rule of ruleListOf(loaded)) {
    if (rule && typeof rule === "object" && typeof rule.kind === "string" && rule.kind) {
      registry[rule.kind] = { module: rule.module, boqDerived: rule.boqDerived === true };
    }
  }
  return Object.keys(registry).length ? registry : null;
};

let registryCache;
const ruleRegistry = () => {
  if (registryCache !== undefined) return registryCache;
  registryCache = null;
  let loaded;
  try {
    loaded = require("./exception-rules");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND" && String(error.message).includes("exception-rules")) return registryCache;
    throw error;
  }
  registryCache = registryFrom(loaded);
  return registryCache;
};

const policyOf = (row) => exceptionPolicy(row.kind, ruleRegistry());

// ─── Status ───────────────────────────────────────────────────────────────

const liveEvent = (row) => Boolean(row.changeEventId && row.changeEvent && !RELEASED_EVENT_STATUSES.includes(row.changeEvent.status));

/** open | in_change | snoozed | dismissed | resolved, as of `now`. */
const statusOf = (row, now = new Date()) => {
  if (row.resolvedAt) return String(row.resolvedReason || "").startsWith(DISMISSED_PREFIX) ? "dismissed" : "resolved";
  if (liveEvent(row)) return "in_change";
  if (row.snoozedUntil && new Date(row.snoozedUntil).getTime() > now.getTime()) return "snoozed";
  return "open";
};

// No live change event: none, or one void / closed (the gap is open again).
const NOT_IN_CHANGE = Object.freeze({ OR: [{ changeEventId: null }, { changeEvent: { status: { in: [...RELEASED_EVENT_STATUSES] } } }] });
const IN_CHANGE = Object.freeze({ changeEventId: { not: null }, changeEvent: { status: { notIn: [...RELEASED_EVENT_STATUSES] } } });

const statusWhere = (status, now) => {
  switch (status) {
    case "open":
      return { resolvedAt: null, AND: [NOT_IN_CHANGE, { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }] };
    case "in_change":
      return { resolvedAt: null, ...IN_CHANGE };
    case "snoozed":
      return { resolvedAt: null, snoozedUntil: { gt: now }, AND: [NOT_IN_CHANGE] };
    case "dismissed":
      return { resolvedAt: { not: null }, resolvedReason: { startsWith: DISMISSED_PREFIX } };
    case "resolved":
      return { resolvedAt: { not: null }, OR: [{ resolvedReason: null }, { NOT: { resolvedReason: { startsWith: DISMISSED_PREFIX } } }] };
    case "all":
      return {};
    default:
      // Unresolved: open, in change and snoozed.
      return { resolvedAt: null };
  }
};

// ─── Labels ───────────────────────────────────────────────────────────────

const activityLabel = (row) => [row.activityCode || row.wbsCode, row.name].filter(Boolean).join(" ") || "Activity";
const boqLabel = (row) => [row.code || row.ref, row.description].filter(Boolean).join(" ") || "BOQ item";

/** Words for every subject of these rows, read per type in one query each, scoped to the project. */
const loadSubjectLabels = async ({ projectId, rows }) => {
  const ids = {};
  const add = (type, id) => {
    if (!type || !id) return;
    (ids[type] = ids[type] || new Set()).add(id);
  };
  for (const row of rows) {
    add(row.subjectType, row.subjectId);
    add(row.secondarySubjectType, row.secondarySubjectId);
  }
  const labels = new Map();
  const put = (type, id, label) => labels.set(`${type}:${id}`, label);
  const list = (type) => [...(ids[type] || [])];
  const activitySelect = { id: true, name: true, activityCode: true, wbsCode: true };

  const allocationIds = [...list("allocation"), ...list("activity_boq_allocation")];
  const loaders = [
    list("boq_item").length &&
      prisma.boqItem.findMany({ where: { projectId, id: { in: list("boq_item") } }, select: { id: true, code: true, ref: true, description: true } }).then((found) => found.forEach((row) => put("boq_item", row.id, boqLabel(row)))),
    allocationIds.length &&
      prisma.activityBoqAllocation
        .findMany({ where: { projectId, id: { in: allocationIds } }, select: { id: true, boqItem: { select: { code: true, ref: true, description: true } }, activity: { select: activitySelect } } })
        .then((found) =>
          found.forEach((row) => {
            const label = `${row.boqItem ? row.boqItem.code || row.boqItem.ref || "BOQ item" : "BOQ item"} → ${row.activity ? activityLabel(row.activity) : "activity"}`;
            put("allocation", row.id, label);
            put("activity_boq_allocation", row.id, label);
          }),
        ),
    list("activity").length &&
      prisma.activity.findMany({ where: { projectId, id: { in: list("activity") } }, select: activitySelect }).then((found) => found.forEach((row) => put("activity", row.id, activityLabel(row)))),
    list("budget_line").length &&
      prisma.budgetLine
        .findMany({ where: { projectId, id: { in: list("budget_line") } }, select: { id: true, description: true, costCode: { select: { code: true, name: true } } } })
        .then((found) => found.forEach((row) => put("budget_line", row.id, [row.costCode?.code, row.description || row.costCode?.name].filter(Boolean).join(" ") || "Budget line"))),
    list("commitment").length &&
      prisma.commitment.findMany({ where: { projectId, id: { in: list("commitment") } }, select: { id: true, ref: true, title: true } }).then((found) => found.forEach((row) => put("commitment", row.id, [row.ref, row.title].filter(Boolean).join(" ")))),
    [...list("certificate_item"), ...list("ipc_item")].length &&
      prisma.ipcItem
        .findMany({ where: { projectId, id: { in: [...list("certificate_item"), ...list("ipc_item")] } }, select: { id: true, ipcPeriod: true, boqItem: { select: { code: true, ref: true } } } })
        .then((found) =>
          found.forEach((row) => {
            const label = `${row.ipcPeriod} · ${row.boqItem ? row.boqItem.code || row.boqItem.ref || "BOQ item" : "BOQ item"}`;
            put("certificate_item", row.id, label);
            put("ipc_item", row.id, label);
          }),
        ),
    list("project").length &&
      prisma.project.findMany({ where: { id: { in: list("project") } }, select: { id: true, name: true } }).then((found) => found.forEach((row) => put("project", row.id, row.name))),
  ].filter(Boolean);
  await Promise.all(loaders);
  return labels;
};

const loadUserNames = async (rows) => {
  const ids = [...new Set(rows.flatMap((row) => [row.reviewedBy, row.snoozedBy, row.dataJson?.dismissedBy]).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name || null]));
};

const ROW_INCLUDE = Object.freeze({
  changeEvent: { select: { id: true, ref: true, status: true, title: true } },
  wbsNode: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
  costCode: { select: { id: true, code: true, name: true } },
});

// ─── Serialising ──────────────────────────────────────────────────────────

/**
 * What this caller may do with this exception: review / snooze / dismiss on
 * change_event update or the subject module's update; raise / associate on
 * change_event create — and only in a state that allows it.
 */
const actionsFor = (row, status, may) => {
  const policy = policyOf(row);
  const reviewer = Boolean(may && (may.changeEventUpdate || (may.moduleUpdate && may.moduleUpdate[policy.module])));
  const creator = Boolean(may && may.changeEventCreate);
  const live = status === "open" || status === "snoozed";
  return {
    review: reviewer && (live || status === "in_change"),
    snooze: reviewer && live,
    dismiss: reviewer && live,
    raiseChangeEvent: creator && live,
    associateChangeEvent: creator && live,
  };
};

const subjectOut = (type, id, labels) => (type && id ? { type, id, label: labels.get(`${type}:${id}`) || null } : null);

const serialize = (row, { labels, names, may, now = new Date() }) => {
  const status = statusOf(row, now);
  const data = row.dataJson && typeof row.dataJson === "object" ? row.dataJson : {};
  const out = {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    kindLabel: kindLabel(row.kind),
    severity: row.severity,
    status,
    module: policyOf(row).module,
    subject: subjectOut(row.subjectType, row.subjectId, labels),
    group: {
      wbsNodeId: row.wbsNodeId || null,
      wbsNode: row.wbsNode ? { id: row.wbsNode.id, code: row.wbsNode.code, name: row.wbsNode.name } : null,
      locationId: row.locationId || null,
      location: row.location ? { id: row.location.id, code: row.location.code || null, name: row.location.name } : null,
      costCodeId: row.costCodeId || null,
      costCode: row.costCode ? { id: row.costCode.id, code: row.costCode.code, name: row.costCode.name } : null,
    },
    measured: { value: num(row.measured), unitCode: row.unitCode || null, basis: row.measuredBasis },
    limit: { value: num(row.limit), unitCode: row.unitCode || null, basis: row.limitBasis },
    detectedAt: toIso(row.detectedAt),
    lastSeenAt: toIso(row.lastSeenAt),
    resolvedAt: toIso(row.resolvedAt),
    review: row.reviewedAt ? { reviewedAt: toIso(row.reviewedAt), reviewedBy: row.reviewedBy || null, reviewedByName: names.get(row.reviewedBy) || null, note: row.reviewNote || null } : null,
    snooze: row.snoozedUntil ? { until: toIso(row.snoozedUntil), by: row.snoozedBy || null, byName: names.get(row.snoozedBy) || null, reason: data.review?.snoozeReason || null } : null,
    // How a resolved (not dismissed) exception was resolved: 'cleared' — the
    // condition is no longer found — or 'not_comparable' — the rule can no
    // longer measure the subject, with its reason (never read as cleared).
    resolution:
      status === "resolved"
        ? { reason: row.resolvedReason || "cleared", at: toIso(row.resolvedAt), detail: row.resolvedReason === "not_comparable" ? data.notComparable?.reason || null : null }
        : null,
    dismissal:
      status === "dismissed"
        ? { at: toIso(row.resolvedAt), reason: String(row.resolvedReason).slice(DISMISSED_PREFIX.length) || null, by: data.dismissedBy || null, byName: names.get(data.dismissedBy) || null }
        : null,
    changeEvent: row.changeEvent
      ? { id: row.changeEvent.id, ref: row.changeEvent.ref, status: row.changeEvent.status, title: row.changeEvent.title, path: recordWorkspacePath({ projectId: row.projectId, recordType: "change_event", recordId: row.changeEvent.id }) }
      : null,
    actions: actionsFor(row, status, may),
  };
  const secondary = subjectOut(row.secondarySubjectType, row.secondarySubjectId, labels);
  if (secondary) out.secondarySubject = secondary;
  return out;
};

const serializeAll = async ({ projectId, rows, may }) => {
  const [labels, names] = await Promise.all([loadSubjectLabels({ projectId, rows }), loadUserNames(rows)]);
  const now = new Date();
  return rows.map((row) => serialize(row, { labels, names, may, now }));
};

// ─── Reading ──────────────────────────────────────────────────────────────

const csv = (value) =>
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((part) => String(part).trim())
    .filter(Boolean);

/** Subject filter: the subject or secondary subject, and — for an activity or a BOQ item — the allocations that tie them. */
const subjectWhere = async ({ projectId, subjectType, subjectId }) => {
  if (!subjectType && !subjectId) return null;
  const pair = (type, id) => ({ ...(type ? { subjectType: type } : {}), ...(id ? { subjectId: id } : {}) });
  const second = (type, id) => ({ ...(type ? { secondarySubjectType: type } : {}), ...(id ? { secondarySubjectId: id } : {}) });
  const clauses = [pair(subjectType, subjectId), second(subjectType, subjectId)];
  if (subjectId && (subjectType === "activity" || subjectType === "boq_item")) {
    const allocations = await prisma.activityBoqAllocation.findMany({
      where: { projectId, ...(subjectType === "activity" ? { activityId: subjectId } : { boqItemId: subjectId }) },
      select: { id: true },
    });
    if (allocations.length) clauses.push({ subjectType: { in: ["allocation", "activity_boq_allocation"] }, subjectId: { in: allocations.map((row) => row.id) } });
  }
  return { OR: clauses };
};

/**
 * GET /projects/:id/controls/exceptions — the exceptions this caller may
 * read (utils/boq-figures exceptionReadableWhere, in the query), newest
 * first, cursor-paged; `withheld` on every answer whose caller may not read
 * every kind (never a count).
 */
const listExceptions = async ({ orgId, projectId, access, may, query = {} }) => {
  const registry = ruleRegistry();
  const withheld = exceptionsWithheldMarker(access);
  const { limit } = normalizeListQuery({ limit: query.limit }, { defaultLimit: 50, maxLimit: 100 });
  const readable = exceptionReadableWhere(access, registry);
  const answer = (data, nextCursor = null) => ({ data, pagination: { limit, nextCursor }, ...(withheld ? { withheld } : {}) });
  if (!readable) return answer([]);

  const now = new Date();
  const and = [readable, statusWhere(query.status, now)];
  const kinds = csv(query.kind);
  if (kinds.length) and.push({ kind: { in: kinds } });
  const severities = csv(query.severity).filter((value) => SEVERITIES.includes(value));
  if (severities.length) and.push({ severity: { in: severities } });
  let subjectType = trimOrNull(query.subjectType);
  let subjectId = trimOrNull(query.subjectId);
  const subject = trimOrNull(query.subject);
  if (subject) {
    const [type, id] = subject.split(":");
    subjectType = trimOrNull(type) || subjectType;
    subjectId = trimOrNull(id) || subjectId;
  }
  const bySubject = await subjectWhere({ projectId, subjectType, subjectId });
  if (bySubject) and.push(bySubject);
  for (const key of ["wbsNodeId", "locationId", "costCodeId"]) {
    const value = trimOrNull(query[key]);
    if (value) and.push({ [key]: value });
  }

  const rows = await prisma.projectException.findMany({
    where: { orgId, projectId, AND: and },
    include: ROW_INCLUDE,
    orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...cursorArgs(trimOrNull(query.cursor)),
  });
  // Belt and braces: the query already kept only readable rows.
  const page = toCursorPage(rows.filter((row) => exceptionReadable(row, access, registry)), limit);
  return answer(await serializeAll({ projectId, rows: page.rows, may }), page.pagination.nextCursor);
};

/**
 * GET /projects/:id/controls/exceptions/summary — the Overview strip: the
 * project's exceptions this caller may read that are OPEN or IN CHANGE (a
 * live change event carries them), counted per severity — `total` and
 * `bySeverity` are the two together, `open` and `inChange` each apart.
 * Snoozed, dismissed and resolved rows are not counted. The readable filter
 * is the list's own (in the query); a caller who may not read every kind gets
 * `withheld { reason, modules }` from their access alone — never a count of
 * what was left out, never whether there is any.
 */
const SUMMARY_BASIS = "Unresolved project exceptions this caller may read that are open (not snoozed, not carried by a live change event) or in change (carried by a live change event); snoozed, dismissed and resolved ones are not counted";
const emptyCounts = () => ({ total: 0, bySeverity: { critical: 0, warning: 0, info: 0 } });
const exceptionsSummary = async ({ orgId, projectId, access }) => {
  const registry = ruleRegistry();
  const withheld = exceptionsWithheldMarker(access);
  const open = emptyCounts();
  const inChange = emptyCounts();
  const readable = exceptionReadableWhere(access, registry);
  if (readable) {
    const rows = await prisma.projectException.findMany({
      where: { orgId, projectId, resolvedAt: null, AND: [readable] },
      select: { kind: true, severity: true, subjectType: true, secondarySubjectType: true, snoozedUntil: true, changeEventId: true, changeEvent: { select: { status: true } } },
    });
    const now = new Date();
    for (const row of rows) {
      // Belt and braces: the query already kept only readable rows.
      if (!exceptionReadable(row, access, registry)) continue;
      const status = statusOf(row, now);
      const bucket = status === "open" ? open : status === "in_change" ? inChange : null;
      if (!bucket) continue;
      bucket.total += 1;
      if (Object.prototype.hasOwnProperty.call(bucket.bySeverity, row.severity)) bucket.bySeverity[row.severity] += 1;
    }
  }
  const bySeverity = Object.fromEntries(Object.keys(open.bySeverity).map((severity) => [severity, open.bySeverity[severity] + inChange.bySeverity[severity]]));
  return { total: open.total + inChange.total, bySeverity, open, inChange, basis: SUMMARY_BASIS, ...(withheld ? { withheld } : {}) };
};

/** One exception this caller may read, or 404 — an unreadable one is not said to exist. */
const loadReadable = async ({ orgId, projectId, exceptionId, access, tx = prisma }) => {
  const row = await tx.projectException.findFirst({ where: { id: exceptionId, orgId, projectId }, include: ROW_INCLUDE });
  if (!row || !exceptionReadable(row, access, ruleRegistry())) throw new HttpError(404, "EXCEPTION_NOT_FOUND", "Exception not found");
  return row;
};

const getException = async ({ orgId, projectId, exceptionId, access, may }) => {
  const row = await loadReadable({ orgId, projectId, exceptionId, access });
  const [serialized] = await serializeAll({ projectId, rows: [row], may });
  return serialized;
};

// ─── Review actions ───────────────────────────────────────────────────────

const forbidden = (action, module) => {
  const error = new HttpError(403, "FORBIDDEN", "You do not have permission for this action");
  error.details = { action, requires: ["change_event:update", `${module}:update`] };
  return error;
};

const requireReviewer = (row, may, action) => {
  const policy = policyOf(row);
  if (!(may.changeEventUpdate || (may.moduleUpdate && may.moduleUpdate[policy.module]))) throw forbidden(action, policy.module);
};

const requireCreator = (may, action) => {
  if (!may.changeEventCreate) {
    const error = new HttpError(403, "FORBIDDEN", "You do not have permission for this action");
    error.details = { action, requires: ["change_event:create"] };
    throw error;
  }
};

const notOpen = (status) =>
  status === "in_change"
    ? new HttpError(409, "EXCEPTION_IN_CHANGE", "This exception is already carried by a change event")
    : new HttpError(409, "EXCEPTION_NOT_OPEN", `A ${status} exception cannot take this action`);

// The audit event names the kind, the subject and what was done — never a
// figure — and says whether the exception is BOQ-derived and its module, so
// the history withholds it as it withholds the exception (utils/boq-figures
// withheldExceptionEvent).
const auditExceptionEvent = ({ row, actor, action, oldStatus = null, newStatus = null, reason = null, summary = {} }) =>
  auditService.recordEvent({
    orgId: row.orgId,
    projectId: row.projectId,
    entityType: "project_exception",
    entityId: row.id,
    action,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    oldStatus,
    newStatus,
    reason,
    summary: { kind: row.kind, severity: row.severity, subjectType: row.subjectType, subjectId: row.subjectId, ...summary },
    metadata: { boqDerived: isBoqDerivedException(row, policyOf(row)), module: policyOf(row).module },
  });

const reread = async ({ orgId, projectId, exceptionId, access, may }) => getException({ orgId, projectId, exceptionId, access, may });

/** POST …/:exceptionId/review — a reviewer's note; the exception stays as it is. */
const reviewException = async ({ orgId, projectId, exceptionId, access, may, actor, payload = {} }) => {
  const row = await loadReadable({ orgId, projectId, exceptionId, access });
  requireReviewer(row, may, "review");
  const status = statusOf(row);
  if (!["open", "snoozed", "in_change"].includes(status)) throw notOpen(status);
  const note = trimOrNull(payload.note);
  if (!note) throw new HttpError(400, "VALIDATION_ERROR", "A review needs a note");
  const updated = await prisma.projectException.updateMany({
    where: { id: row.id, orgId, projectId, resolvedAt: null },
    data: { reviewedAt: new Date(), reviewedBy: actor?.id || null, reviewNote: note.slice(0, 2000) },
  });
  if (updated.count !== 1) throw notOpen("resolved");
  await auditExceptionEvent({ row, actor, action: auditService.ACTIONS.UPDATED, summary: { review: "reviewed", note: note.slice(0, 2000) } });
  return reread({ orgId, projectId, exceptionId, access, may });
};

const mergeData = (row, patch) => ({ ...(row.dataJson && typeof row.dataJson === "object" ? row.dataJson : {}), ...patch });

/** POST …/:exceptionId/snooze — kept refreshing by the engine, not re-notified until `until`. */
const snoozeException = async ({ orgId, projectId, exceptionId, access, may, actor, payload = {} }) => {
  const row = await loadReadable({ orgId, projectId, exceptionId, access });
  requireReviewer(row, may, "snooze");
  const status = statusOf(row);
  if (!["open", "snoozed"].includes(status)) throw notOpen(status);
  const until = new Date(payload.until);
  const now = new Date();
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime() || until.getTime() > now.getTime() + MAX_SNOOZE_DAYS * 86_400_000) {
    throw new HttpError(400, "EXCEPTION_SNOOZE_INVALID", `Snooze until a moment in the next ${MAX_SNOOZE_DAYS} days`);
  }
  const reason = trimOrNull(payload.reason);
  if (!reason) throw new HttpError(400, "VALIDATION_ERROR", "A snooze needs a reason");
  const updated = await prisma.projectException.updateMany({
    where: { id: row.id, orgId, projectId, resolvedAt: null, AND: [NOT_IN_CHANGE] },
    data: {
      snoozedUntil: until,
      snoozedBy: actor?.id || null,
      dataJson: mergeData(row, { review: { ...(row.dataJson?.review || {}), snoozeReason: reason.slice(0, 500), snoozedAt: now.toISOString(), snoozedBy: actor?.id || null } }),
    },
  });
  if (updated.count !== 1) throw notOpen("in_change");
  await auditExceptionEvent({ row, actor, action: auditService.ACTIONS.STATUS_CHANGED, oldStatus: status, newStatus: "snoozed", reason: reason.slice(0, 500), summary: { snoozedUntil: until.toISOString() } });
  return reread({ orgId, projectId, exceptionId, access, may });
};

/**
 * POST …/:exceptionId/dismiss — resolved by a person: resolvedAt now,
 * resolvedReason `dismissed:<reason>`, and the measured / limit it was
 * dismissed at kept in dataJson.dismissedFingerprint. The engine keeps it
 * dismissed while those are unchanged and opens a new row only when the
 * measured value moves past it in the adverse direction.
 */
const dismissException = async ({ orgId, projectId, exceptionId, access, may, actor, payload = {} }) => {
  const row = await loadReadable({ orgId, projectId, exceptionId, access });
  requireReviewer(row, may, "dismiss");
  const status = statusOf(row);
  if (!["open", "snoozed"].includes(status)) throw notOpen(status);
  const reason = trimOrNull(payload.reason);
  if (!reason) throw new HttpError(400, "VALIDATION_ERROR", "A dismissal needs a reason");
  const now = new Date();
  const updated = await prisma.projectException.updateMany({
    where: { id: row.id, orgId, projectId, resolvedAt: null, AND: [NOT_IN_CHANGE] },
    data: {
      resolvedAt: now,
      resolvedReason: `${DISMISSED_PREFIX}${reason.slice(0, 500)}`,
      dataJson: mergeData(row, {
        dismissedFingerprint: { measured: num(row.measured), limit: num(row.limit), unitCode: row.unitCode || null, measuredBasis: row.measuredBasis, limitBasis: row.limitBasis },
        dismissedBy: actor?.id || null,
        dismissedAt: now.toISOString(),
      }),
    },
  });
  if (updated.count !== 1) throw notOpen("in_change");
  await auditExceptionEvent({ row, actor, action: auditService.ACTIONS.STATUS_CHANGED, oldStatus: status, newStatus: "dismissed", reason: reason.slice(0, 500) });
  return reread({ orgId, projectId, exceptionId, access, may });
};

// ─── The handoff (§2) ─────────────────────────────────────────────────────

const projectCostCode = async ({ projectId, costCodeId }) => {
  if (!costCodeId) return null;
  const found = await prisma.projectCostCode.findFirst({ where: { projectId, costCodeId }, select: { costCodeId: true } });
  return found ? costCodeId : null;
};

/**
 * The draft a change event raised from this exception starts from: origin
 * `exception`, the activity and location, and one line from the subject
 * (cost code / budget line / activity / commitment; the quantity delta as
 * the line quantity for the quantity kinds), unit cost and amount 0 — blank
 * for the QS. The words carry no figure and, for a BOQ-derived exception, no
 * BOQ item's code or description: the change event is the commercial
 * module's record, read by change-event readers who may not read the BOQ or
 * the cost module. The exception link (exceptionId) carries the rest.
 */
// The words of a change event raised from a BOQ-derived exception: the kind
// is named only by the typed link (withheld from a reader without boq:read).
const GENERIC_EXCEPTION_TITLE = "Raised from a project controls exception";
// The draft AND the exact fields it filled from the exception — { event:
// [field], line: [field] } — so the raise records its provenance as stated,
// never guessed from the values (a quantity delta of exactly 1 with no unit
// is the line's default quantity, and still the exception's figure).
const buildExceptionPrefill = async (row) => {
  const filled = { event: [], line: [] };
  const projectId = row.projectId;
  const boqDerived = isBoqDerivedException(row, policyOf(row));
  const label = boqDerived ? GENERIC_EXCEPTION_TITLE : kindLabel(row.kind);
  const line = { description: label.slice(0, 500), quantity: 1, unit: null, unitCost: 0, romAmount: 0 };
  let activityId = row.subjectType === "activity" ? row.subjectId : row.secondarySubjectType === "activity" ? row.secondarySubjectId : null;
  let costCodeId = row.costCodeId || null;
  let hasRef = false;

  if (row.subjectType === "allocation" || row.subjectType === "activity_boq_allocation") {
    const allocation = await prisma.activityBoqAllocation.findFirst({ where: { id: row.subjectId, projectId }, select: { activityId: true, unitCode: true, boqItem: { select: { costCodeId: true } } } });
    if (allocation) {
      activityId = allocation.activityId;
      costCodeId = costCodeId || allocation.boqItem?.costCodeId || null;
    }
  } else if (row.subjectType === "boq_item") {
    const item = await prisma.boqItem.findFirst({ where: { id: row.subjectId, projectId }, select: { costCodeId: true } });
    costCodeId = costCodeId || item?.costCodeId || null;
  } else if (row.subjectType === "budget_line") {
    const budgetLine = await prisma.budgetLine.findFirst({ where: { id: row.subjectId, projectId, orgId: row.orgId }, select: { id: true, costCodeId: true } });
    if (budgetLine) {
      line.budgetLineId = budgetLine.id;
      costCodeId = budgetLine.costCodeId;
      hasRef = true;
    }
  } else if (row.subjectType === "commitment") {
    const commitment = await prisma.commitment.findFirst({ where: { id: row.subjectId, projectId, orgId: row.orgId }, select: { id: true } });
    if (commitment) {
      line.commitmentId = commitment.id;
      hasRef = true;
    }
  } else if (row.subjectType === "certificate_item" || row.subjectType === "ipc_item") {
    const item = await prisma.ipcItem.findFirst({ where: { id: row.subjectId, projectId }, select: { boqItem: { select: { costCodeId: true } } } });
    costCodeId = costCodeId || item?.boqItem?.costCodeId || null;
  }

  if (activityId) {
    const activity = await prisma.activity.findFirst({ where: { id: activityId, projectId }, select: { id: true } });
    activityId = activity ? activity.id : null;
  }
  costCodeId = await projectCostCode({ projectId, costCodeId });
  if (activityId) {
    line.activityId = activityId;
    filled.event.push("activityId");
    filled.line.push("activityId");
    hasRef = true;
  }
  if (costCodeId) {
    line.costCodeId = costCodeId;
    filled.line.push("costCodeId");
    hasRef = true;
  }
  if (QUANTITY_DELTA_KINDS.has(row.kind)) {
    const delta = round3(num(row.measured) - num(row.limit));
    if (delta > 0) {
      line.quantity = delta;
      line.unit = row.unitCode ? String(row.unitCode).slice(0, 20) : null;
      filled.line.push("quantity", "unit");
      hasRef = true;
    }
  }
  let locationId = row.locationId || null;
  if (locationId) {
    const location = await prisma.location.findFirst({ where: { id: locationId, projectId }, select: { id: true } });
    locationId = location ? location.id : null;
  }
  const subjectWords = boqDerived ? null : (await loadSubjectLabels({ projectId, rows: [row] })).get(`${row.subjectType}:${row.subjectId}`) || null;
  const prefill = {
    title: (subjectWords ? `${label}: ${subjectWords}` : label).slice(0, 200),
    description: (boqDerived
      ? `${GENERIC_EXCEPTION_TITLE}. The amount is left for the QS to price.`
      : `Raised from a project exception (${label}) detected ${toIso(row.detectedAt)?.slice(0, 10) || ""}. The amount is left for the QS to price.`
    ).slice(0, 8000),
    type: "other",
    origin: "exception",
    activityId,
    locationId,
    romAmount: 0,
    scheduleImpactDays: 0,
    lines: hasRef ? [line] : [],
  };
  if (!hasRef) filled.line = [];
  return { prefill, filled };
};
const exceptionPrefill = async (row) => (await buildExceptionPrefill(row)).prefill;

const getExceptionPrefill = async ({ orgId, projectId, exceptionId, access, may }) => {
  const row = await loadReadable({ orgId, projectId, exceptionId, access });
  requireCreator(may, "raiseChangeEvent");
  const status = statusOf(row);
  if (!["open", "snoozed"].includes(status)) throw notOpen(status);
  return { prefill: await exceptionPrefill(row), links: { exceptionId: row.id } };
};

/**
 * POST …/:exceptionId/raise-change-event — a person's explicit act: ONE
 * change event, status open (the draft), through change-event.service
 * createChangeEvent with the typed exceptionId link; the exception is
 * claimed (changeEventId) in the same transaction and reads in_change.
 * Nothing else is written: no change order, budget, schedule or figure.
 */
const raiseFromException = async ({ orgId, projectId, exceptionId, access, may, actor, payload = {} }) => {
  const row = await loadReadable({ orgId, projectId, exceptionId, access });
  requireCreator(may, "raiseChangeEvent");
  const status = statusOf(row);
  if (!["open", "snoozed"].includes(status)) throw notOpen(status);
  const { prefill, filled } = await buildExceptionPrefill(row);
  const draft = changeEventService.draftOverPrefill(prefill, payload);
  draft.origin = "exception";
  const boqDerived = isBoqDerivedException(row, policyOf(row));
  // For a BOQ-derived exception, what the event takes from the prefill (the
  // mapped activity, the cost code, the quantity delta) is recorded with the
  // creation (metadata.prefillProvenance) so it can be withheld from a
  // change-event reader without boq:read for as long as it stays as taken.
  const changeEvent = await changeEventService.createChangeEvent({ orgId, projectId, payload: draft, actor, links: { exceptionId: row.id }, auditMetadata: { sourceBoqDerived: boqDerived }, prefillProvenance: boqDerived ? { prefill, fields: filled } : null });
  await auditExceptionEvent({ row, actor, action: auditService.ACTIONS.STATUS_CHANGED, oldStatus: status, newStatus: "in_change", summary: { changeEventId: changeEvent.id, changeEventRef: changeEvent.ref, handoff: "raised" } });
  return { exception: await reread({ orgId, projectId, exceptionId, access, may }), changeEvent };
};

/** POST …/:exceptionId/associate-change-event — carried by an existing change event of the same project. */
const associateChangeEvent = async ({ orgId, projectId, exceptionId, access, may, actor, payload = {} }) => {
  const row = await loadReadable({ orgId, projectId, exceptionId, access });
  requireCreator(may, "associateChangeEvent");
  const status = statusOf(row);
  if (!["open", "snoozed"].includes(status)) throw notOpen(status);
  const changeEventId = trimOrNull(payload.changeEventId);
  const event = changeEventId ? await prisma.changeEvent.findFirst({ where: { id: changeEventId, orgId, projectId }, select: { id: true, ref: true, status: true } }) : null;
  if (!event) throw new HttpError(404, "CHANGE_EVENT_NOT_FOUND", "Change event not found");
  if (RELEASED_EVENT_STATUSES.includes(event.status)) throw new HttpError(409, "EXCEPTION_CHANGE_EVENT_CLOSED", `A ${event.status} change event cannot carry an exception`);
  const updated = await prisma.projectException.updateMany({
    where: { id: row.id, orgId, projectId, resolvedAt: null, AND: [NOT_IN_CHANGE] },
    data: { changeEventId: event.id },
  });
  if (updated.count !== 1) throw notOpen("in_change");
  await auditExceptionEvent({ row, actor, action: auditService.ACTIONS.STATUS_CHANGED, oldStatus: status, newStatus: "in_change", summary: { changeEventId: event.id, changeEventRef: event.ref, handoff: "associated" } });
  return reread({ orgId, projectId, exceptionId, access, may });
};

// ─── Change events raised from a BOQ-derived exception ───────────────────

/** Of these exception ids (of this project and organisation), the BOQ-derived ones. */
const boqDerivedExceptionIds = async ({ orgId, projectId, ids }) => {
  const wanted = [...new Set((ids || []).filter(Boolean))];
  if (!wanted.length) return new Set();
  const rows = await prisma.projectException.findMany({ where: { orgId, projectId, id: { in: wanted } }, select: { id: true, kind: true, subjectType: true, secondarySubjectType: true } });
  const found = new Set(rows.map((row) => row.id));
  // An id that names no exception of the project (it cannot be told) is
  // treated as BOQ-derived: withholding too much is safe, leaking is not.
  return new Set([...rows.filter((row) => isBoqDerivedException(row, policyOf(row))).map((row) => row.id), ...wanted.filter((id) => !found.has(id))]);
};

/**
 * Of these change events ({ id, exceptionId, origin } — stored rows or
 * answers), the ones raised from a BOQ-derived exception, each with the
 * prefill provenance its creation recorded: Map id → { provenance } (null
 * when none is on record — utils/boq-figures then fails closed). An event is
 * one when its exception link names a BOQ-derived exception (or one the
 * project does not have), or — its link gone — when its creation audit says
 * so (metadata.sourceBoqDerived true). The provenance lives in the creation
 * audit's metadata (change-event.service createChangeEvent); no column holds it.
 */
const changeEventWithholding = async ({ orgId, projectId, events }) => {
  const list = (events || []).filter((event) => event && event.id);
  const withholding = new Map();
  if (!list.length) return withholding;
  const boqIds = await boqDerivedExceptionIds({ orgId, projectId, ids: list.map((event) => event.exceptionId) });
  const candidates = list.filter((event) => (event.exceptionId ? boqIds.has(event.exceptionId) : event.origin === "exception"));
  if (!candidates.length) return withholding;
  const audits = await prisma.auditEvent.findMany({
    where: { orgId, projectId, entityType: "change_event", entityId: { in: [...new Set(candidates.map((event) => event.id))] }, action: auditService.ACTIONS.CREATED },
    orderBy: { occurredAt: "asc" },
    select: { entityId: true, metadataJson: true },
  });
  const metaOf = new Map();
  for (const audit of audits) if (!metaOf.has(audit.entityId)) metaOf.set(audit.entityId, audit.metadataJson && typeof audit.metadataJson === "object" ? audit.metadataJson : {});
  for (const event of candidates) {
    const meta = metaOf.get(event.id) || null;
    if (!event.exceptionId && !(meta && meta.sourceBoqDerived === true)) continue;
    const provenance = meta && meta.prefillProvenance && typeof meta.prefillProvenance === "object" ? meta.prefillProvenance : null;
    withholding.set(event.id, { provenance });
  }
  return withholding;
};

/**
 * A change-event answer (an event, a list, or { changeEvent }) as this caller
 * may receive it: an event raised from a BOQ-derived exception names neither
 * the exception nor what came from it to a reader without boq:read
 * (utils/boq-figures withheldChangeEventAnswer).
 */
const changeEventAnswerFor = async ({ orgId, projectId, access, answer }) => {
  if (!access || access.boq === true) return answer;
  const refs = changeEventRefsOf(answer);
  if (!refs.length) return answer;
  const withholding = await changeEventWithholding({ orgId, projectId, events: refs });
  if (!withholding.size) return answer;
  return withheldChangeEventAnswer(answer, access, withholding);
};

// ─── The workspace dashboard's open-exceptions figure ─────────────────────

/**
 * What the caller may read of one project's exceptions, from that project's
 * view (middleware/project-access requestForProject) — failing CLOSED.
 * requestForProject attaches the member's permission template, but a failed
 * lookup there is swallowed and leaves the role's defaults in place (which
 * read the BOQ for a QS or site engineer whose template says "none"). For a
 * figure that withholds, that would count what the template withholds; so a
 * view with no template attached is resolved once more here, and a lookup
 * that fails counts nothing on that project (`null`: named in the marker).
 */
const exceptionAccessForView = async (view) => {
  if (!view || !view.user) return null;
  const projectAccess = view.projectAccess;
  if (!projectAccess || !projectAccess.id) return null;
  if (projectAccess.template) return exceptionAccess(view);
  const templates = require("./permission-template.service");
  let context;
  try {
    context = await templates.resolveTemplateContext({ projectId: projectAccess.id, userId: view.user.id, partyAccess: projectAccess.partyAccess || [] });
  } catch (error) {
    console.error("[exceptions] permission template lookup failed; the project's exceptions are not counted", error?.message || error);
    return null;
  }
  if (!context) return exceptionAccess(view);
  return exceptionAccess({ ...view, projectAccess: { ...projectAccess, template: context.compiled, templateSource: context.source } });
};

/**
 * Org-wide (§35 rule 2) over the projects the caller can open: unresolved
 * exceptions they may read, as each project's routes decide it
 * (`accessFor(projectId)` → exceptionAccess). `total` / `bySeverity` count
 * the open ones (not in a live change event, not snoozed); `inChange` and
 * `snoozed` the others. BOQ-derived kinds are not counted on a project whose
 * BOQ the caller may not read, nor a module's kinds where they may not read
 * it — and `withheld` says so, without a count.
 */
const workspaceOpenExceptions = async ({ orgId, userId, role, isCompanyAdmin = false, accessFor }) => {
  const basis = "Unresolved project exceptions the caller may read, on every project they can open; open = not carried by a live change event and not snoozed";
  const empty = { total: 0, bySeverity: { critical: 0, warning: 0, info: 0 }, inChange: 0, snoozed: 0, basis };
  const { getProjectAccessWhere } = require("./project-authorization.service");
  const projects = await prisma.project.findMany({
    where: { orgId, archivedAt: null, ...getProjectAccessWhere({ userId, role, isCompanyAdmin, orgId }) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const projectIds = projects.map((project) => project.id);
  if (!projectIds.length) return empty;
  const accessById = new Map(await Promise.all(projectIds.map(async (id) => [id, (await accessFor(id)) || null])));
  const rows = await prisma.projectException.findMany({
    where: { orgId, projectId: { in: projectIds }, resolvedAt: null },
    select: { projectId: true, kind: true, severity: true, subjectType: true, secondarySubjectType: true, snoozedUntil: true, changeEventId: true, changeEvent: { select: { status: true } } },
  });
  const registry = ruleRegistry();
  const now = new Date();
  const byStatus = { open: [], in_change: [], snoozed: [] };
  for (const row of rows) byStatus[statusOf(row, now)]?.push(row);
  const accessOf = (projectId) => accessById.get(projectId) || null;
  const open = withheldExceptionCounts(byStatus.open, accessOf, registry);
  const inChange = withheldExceptionCounts(byStatus.in_change, accessOf, registry).total;
  const snoozed = withheldExceptionCounts(byStatus.snoozed, accessOf, registry).total;
  // What the caller may read on EVERY project: a module (or the BOQ) missing
  // on any one is named in the marker.
  const accesses = [...accessById.values()];
  const union = {
    boq: accesses.every((access) => access && access.boq === true),
    modules: Object.fromEntries(EXCEPTION_MODULES.map((module) => [module, accesses.every((access) => access && access.modules && access.modules[module] === true)])),
  };
  const marker = exceptionsWithheldMarker(union);
  // Per project, which kinds are not counted there and why — the caller's
  // access on that project, never whether it has any exception.
  const withheldProjects = projects
    .map((project) => ({ project, marker: exceptionsWithheldMarker(accessById.get(project.id) || null) }))
    .filter((entry) => entry.marker)
    .map(({ project, marker: own }) => ({ projectId: project.id, name: project.name, reason: own.reason, modules: own.modules }));
  return {
    ...open,
    inChange,
    snoozed,
    basis,
    ...(marker ? { withheld: { reason: `On some of your projects: ${marker.reason}`, modules: marker.modules, projects: withheldProjects } } : {}),
  };
};

// ─── Notifications for a newly opened critical exception ─────────────────

/**
 * Notifies the project's PM and QS (their project assignments) of each open,
 * critical, unsnoozed exception of the project — once per opening: the
 * dedupe key is the exception and its detectedAt, so a refresh, a snoozed
 * row or an unchanged one is never re-notified, and a row the engine opens
 * again (a new detectedAt) is. Each person is told only of an exception they
 * may read (module, and BOQ for a BOQ-derived one). Category commercial.
 * The engine calls this after it commits a project's evaluation.
 */
const notifyOpenedCritical = async ({ orgId, projectId, exceptionIds = null }) => {
  const notificationService = require("./notification.service");
  const { normalizeRoleId } = require("../config/permissions");
  const { resolveRequestPrincipal } = require("./membership.service");
  const { requestForProject } = require("../middleware/project-access");
  const now = new Date();
  const rows = await prisma.projectException.findMany({
    where: {
      orgId,
      projectId,
      severity: "critical",
      resolvedAt: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      ...(Array.isArray(exceptionIds) ? { id: { in: exceptionIds } } : {}),
    },
    include: ROW_INCLUDE,
  });
  const due = rows.filter((row) => statusOf(row, now) === "open");
  if (!due.length) return { notified: 0, exceptions: 0 };
  const assignments = await prisma.projectAssignment.findMany({ where: { projectId, orgId }, select: { userId: true, role: true } });
  const candidates = [...new Set(assignments.filter((row) => ["pm", "qs"].includes(normalizeRoleId(row.role))).map((row) => row.userId))];
  const accessByUser = new Map();
  for (const userId of candidates) {
    const principal = await resolveRequestPrincipal({ userId, orgId }).catch(() => null);
    accessByUser.set(userId, principal ? await exceptionAccessForView(await requestForProject({ user: principal }, projectId)) : null);
  }
  const labels = await loadSubjectLabels({ projectId, rows: due });
  const registry = ruleRegistry();
  let notified = 0;
  for (const row of due) {
    const recipients = candidates.filter((userId) => exceptionReadable(row, accessByUser.get(userId), registry));
    if (!recipients.length) continue;
    const subject = labels.get(`${row.subjectType}:${row.subjectId}`) || row.subjectType.replace(/_/g, " ");
    const unit = row.unitCode ? ` ${row.unitCode}` : "";
    const result = await notificationService.createNotifications({
      orgId,
      projectId,
      recipientUserIds: recipients,
      type: "project_exception",
      category: notificationService.NOTIFICATION_CATEGORIES.COMMERCIAL,
      event: "exception.opened",
      priority: "high",
      title: `Critical exception: ${kindLabel(row.kind)}`,
      message: `${subject}: ${num(row.measured)}${unit} (${row.measuredBasis}) against ${num(row.limit)}${unit} (${row.limitBasis}). Review it, or raise a change event.`,
      actionUrl: recordWorkspacePath({ projectId, recordType: "project_exception", recordId: row.id }),
      entityType: "project_exception",
      entityId: row.id,
      dedupeKeyBase: `project_exception:${row.id}:opened:${new Date(row.detectedAt).getTime()}`,
      metadata: { kind: row.kind, severity: row.severity },
    });
    notified += result.created;
  }
  return { notified, exceptions: due.length };
};

/**
 * The engine's notify hook (PC-7b contract): `exceptions` are the rows (or
 * ids) its evaluation of the project just OPENED. Only the open, critical,
 * unsnoozed ones among them notify, once per opening (see above); an empty
 * list notifies nothing. The engine calls it after its transaction commits.
 */
const notifyOpened = ({ orgId, projectId, exceptions = [] }) =>
  notifyOpenedCritical({
    orgId,
    projectId,
    exceptionIds: (Array.isArray(exceptions) ? exceptions : [])
      .map((row) => (typeof row === "string" ? row : row && row.id))
      .filter(Boolean),
  });

/**
 * The bridge from the engine to the notice: the engine tells its evaluation
 * listeners, after each committed evaluation, which rows OPENED and which
 * became critical (`escalated`, never notified as a warning); both go to
 * notifyOpened, which tells only the open, critical, unsnoozed ones, once
 * per opening. Registered once per process — by the API entry point and the
 * dedicated worker (src/index.js, src/worker.js), wherever an evaluation job
 * may run — and stands down with EXCEPTIONS_ENGINE_ENABLED=false, as the
 * engine's own trigger and tick do. Without the engine (this track's base)
 * it registers nothing. Returns the unregister function.
 */
let notifierOff = null;
const engineEnabledByEnv = (env) => String(env.EXCEPTIONS_ENGINE_ENABLED ?? "true").trim().toLowerCase() !== "false";
const evaluationListener = async ({ orgId, projectId, opened = [], escalated = [] } = {}) => {
  const exceptions = [...(Array.isArray(opened) ? opened : []), ...(Array.isArray(escalated) ? escalated : [])];
  if (!orgId || !projectId || !exceptions.length) return { notified: 0, exceptions: 0 };
  return notifyOpened({ orgId, projectId, exceptions });
};
const registerExceptionNotifier = ({ env = process.env, engine = null, logger = console } = {}) => {
  if (notifierOff) return notifierOff;
  if (!engineEnabledByEnv(env)) {
    logger?.log?.("[exception-notifier] disabled by EXCEPTIONS_ENGINE_ENABLED=false");
    return () => {};
  }
  let target = engine;
  if (!target) {
    try {
      // eslint-disable-next-line global-require
      target = require("./exception-engine.service");
    } catch (error) {
      if (error && error.code === "MODULE_NOT_FOUND" && String(error.message).includes("exception-engine.service")) return () => {};
      throw error;
    }
  }
  if (typeof target?.registerEvaluationListener !== "function") return () => {};
  const off = target.registerEvaluationListener(evaluationListener);
  notifierOff = () => {
    if (typeof off === "function") off();
    notifierOff = null;
  };
  return notifierOff;
};

module.exports = {
  STATUSES,
  SEVERITIES,
  DISMISSED_PREFIX,
  KIND_LABELS,
  statusOf,
  listExceptions,
  exceptionsSummary,
  getException,
  reviewException,
  snoozeException,
  dismissException,
  getExceptionPrefill,
  raiseFromException,
  associateChangeEvent,
  workspaceOpenExceptions,
  notifyOpenedCritical,
  notifyOpened,
  exceptionAccessForView,
  registerExceptionNotifier,
  boqDerivedExceptionIds,
  changeEventAnswerFor,
  changeEventWithholding,
  GENERIC_EXCEPTION_TITLE,
  // The kinds' registry the list reads with (forecast.service exceptionNotes reads with it too).
  ruleRegistry,
  // for tests
  _evaluationListener: evaluationListener,
  _exceptionPrefill: exceptionPrefill,
  _registryFrom: registryFrom,
  _ruleRegistry: () => ruleRegistry(),
  _resetRegistry: () => {
    registryCache = undefined;
  },
};
