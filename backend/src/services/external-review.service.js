const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { hasPermission } = require("../middleware/rbac");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const { isPartyScopedAccess } = require("./company-party.service");
const sources = require("./external-review-sources");

/**
 * External review / consultant portal (CONSULTANT V1, 2026-10-11): one engine
 * for every record a contractor formally issues to a consultant for review.
 *
 * The clock: a review cycle's `submittedAt` (the formal issue) starts the
 * consultant's time; nothing persists a running "open days" figure — open,
 * response and overdue durations are computed from stored timestamps.
 * `firstOpenedAt` is recorded when the responsible reviewer first opens it and
 * never starts the clock.
 *
 * Who holds the action follows from the status alone:
 *   submitted, under_review              → the consultant
 *   returned, revising, responded        → the contractor
 *   acknowledged, closed, withdrawn      → nobody
 *
 * Every cycle is kept as issued and as answered; a resubmission opens a new
 * cycle on a new revision. Only the responsible reviewer (or a primary
 * reviewer of the same consultant party, the explicit delegate) issues the
 * authoritative decision. Internal contractor notes never reach a party.
 *
 * Authorisation before retrieval: every read is scoped to the project and,
 * for a party-scoped caller, to the submissions of their own party or
 * addressed to them; the source record's module must be readable too.
 */

const STATUS = Object.freeze({
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  RETURNED: "returned",
  REVISING: "revising",
  RESPONDED: "responded",
  ACKNOWLEDGED: "acknowledged",
  CLOSED: "closed",
  WITHDRAWN: "withdrawn",
});
const WITH_CONSULTANT = Object.freeze([STATUS.SUBMITTED, STATUS.UNDER_REVIEW]);
const WITH_CONTRACTOR = Object.freeze([STATUS.RETURNED, STATUS.REVISING, STATUS.RESPONDED]);
const FINISHED = Object.freeze([STATUS.ACKNOWLEDGED, STATUS.CLOSED, STATUS.WITHDRAWN]);
const STATUS_LABEL = Object.freeze({
  submitted: "Awaiting review",
  under_review: "Under review",
  returned: "Returned to contractor",
  revising: "Revision in preparation",
  responded: "Response received",
  acknowledged: "Acknowledged",
  closed: "Closed",
  withdrawn: "Withdrawn",
});

const MAX_DUE_DAYS = 365;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_TEXT = 8000;

const text = (value, max = MAX_TEXT) => {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
};
const iso = (value) => (value ? new Date(value).toISOString() : null);
const uniq = (values) => [...new Set((values || []).filter(Boolean))];

// ─── who is asking ────────────────────────────────────────────────────────

/**
 * The caller as the project's routes see them. A party-scoped caller is the
 * consultant side; anyone else on the project is the contractor side.
 */
const viewerOf = (req) => {
  const partyAccess = Array.isArray(req.projectAccess?.partyAccess) ? req.projectAccess.partyAccess : [];
  const partyScoped = isPartyScopedAccess(req.projectAccess || {});
  return {
    req,
    id: req.user.id,
    name: req.user.name || null,
    orgId: req.user.orgId,
    partyScoped,
    side: partyScoped ? "consultant" : "contractor",
    partyIds: uniq(partyAccess.map((party) => party.projectPartyId)),
    companyIds: uniq(partyAccess.map((party) => party.companyId)),
  };
};

const can = (viewer, module, action, transition = null) => hasPermission(viewer.req, module, action, transition ? { transition } : {});

const forbidden = (message, details = null) => Object.assign(new HttpError(403, "FORBIDDEN", message), details ? { details } : {});
const notFound = () => new HttpError(404, "EXTERNAL_REVIEW_NOT_FOUND", "Review not found");

/** The rows a caller may see on a project: everything for the contractor, their own party's or addressed to them for a consultant. */
const scopeWhere = (viewer) =>
  viewer.partyScoped
    ? { OR: [...(viewer.partyIds.length ? [{ partyId: { in: viewer.partyIds } }] : []), { recipients: { some: { userId: viewer.id, removedAt: null } } }] }
    : {};

/** The source modules the caller reads: a submission of a record type is shown only to someone who reads that module. */
const readableSourceTypes = (viewer) => sources.SOURCE_TYPES.filter((type) => can(viewer, sources.sourceOf(type).module, "read"));

const assertCanRead = (viewer) => {
  if (!can(viewer, "external_review", "read")) throw forbidden("You cannot read consultant reviews on this project", { module: "external_review", action: "read" });
};

const loadVisible = async ({ orgId, projectId, viewer, id, tx = prisma }) => {
  assertCanRead(viewer);
  const types = readableSourceTypes(viewer);
  const row = await tx.externalSubmission.findFirst({ where: { id, orgId, projectId, sourceType: { in: types }, ...scopeWhere(viewer) } });
  if (!row) throw notFound();
  return row;
};

// ─── durations ────────────────────────────────────────────────────────────

/** A cycle's clock: open time until answered (or withdrawn), response time once answered, overdue against its due date. */
const clockOf = (cycle, now = new Date()) => {
  const submittedAt = new Date(cycle.submittedAt);
  const dueAt = new Date(cycle.dueAt);
  const endedAt = cycle.respondedAt ? new Date(cycle.respondedAt) : cycle.withdrawnAt ? new Date(cycle.withdrawnAt) : null;
  const stop = endedAt || now;
  const openMs = Math.max(0, stop - submittedAt);
  const overdueMs = Math.max(0, stop - dueAt);
  return {
    open: !endedAt,
    openMs,
    responseMs: cycle.respondedAt ? openMs : null,
    overdue: !endedAt && now > dueAt,
    overdueMs: overdueMs || 0,
    respondedLate: Boolean(cycle.respondedAt) && new Date(cycle.respondedAt) > dueAt,
    dueInMs: dueAt - now,
  };
};

const actionWith = (status, { partyName, reviewerName, contractorName }) => {
  if (WITH_CONSULTANT.includes(status)) return { side: "consultant", label: partyName, reviewer: reviewerName };
  if (WITH_CONTRACTOR.includes(status)) return { side: "contractor", label: contractorName, reviewer: null };
  return { side: "none", label: status === STATUS.WITHDRAWN ? "Withdrawn" : "Closed", reviewer: null };
};

// ─── serialisation ────────────────────────────────────────────────────────

const namesFor = async (userIds) => {
  const ids = uniq(userIds);
  if (!ids.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name || user.email]));
};

const partiesFor = async (partyIds) => {
  const ids = uniq(partyIds);
  if (!ids.length) return new Map();
  const parties = await prisma.projectParty.findMany({ where: { id: { in: ids } }, select: { id: true, discipline: true, company: { select: { name: true } } } });
  return new Map(parties.map((party) => [party.id, { id: party.id, name: party.company?.name || "Consultant", discipline: party.discipline }]));
};

const contractorNameOf = async (orgId) => (await prisma.organisation.findUnique({ where: { id: orgId }, select: { name: true } }))?.name || "Contractor";

const serializeRow = ({ submission, cycle, names, parties, contractorName, now }) => {
  const party = parties.get(submission.partyId) || { id: submission.partyId, name: "Consultant", discipline: null };
  const clock = clockOf(cycle, now);
  const reviewerName = names.get(submission.responsibleUserId) || null;
  return {
    id: submission.id,
    ref: submission.ref,
    sourceType: submission.sourceType,
    sourceLabel: sources.sourceOf(submission.sourceType)?.label || submission.sourceType,
    sourceId: submission.sourceId,
    sourceRef: submission.sourceRef,
    sourcePath: sources.sourceOf(submission.sourceType)?.path(submission.projectId, submission.sourceId) || null,
    title: submission.title,
    party,
    responsible: { id: submission.responsibleUserId, name: reviewerName },
    status: submission.status,
    statusLabel: STATUS_LABEL[submission.status] || submission.status,
    actionWith: actionWith(submission.status, { partyName: party.name, reviewerName, contractorName }),
    revision: submission.revision,
    cycle: submission.currentCycle,
    firstSubmittedAt: iso(submission.firstSubmittedAt),
    submittedAt: iso(cycle.submittedAt),
    submittedBy: names.get(cycle.submittedBy) || null,
    dueAt: iso(cycle.dueAt),
    firstOpenedAt: iso(cycle.firstOpenedAt),
    respondedAt: iso(cycle.respondedAt),
    acknowledgedAt: iso(cycle.acknowledgedAt),
    decision: cycle.decision,
    decisionLabel: cycle.decisionLabel,
    openMs: clock.openMs,
    responseMs: clock.responseMs,
    overdue: clock.overdue,
    overdueMs: clock.overdueMs,
    respondedLate: clock.respondedLate,
    dueInMs: clock.dueInMs,
    awaitingConsultant: WITH_CONSULTANT.includes(submission.status),
    totalElapsedMs: Math.max(0, (submission.closedAt ? new Date(submission.closedAt) : now) - new Date(submission.firstSubmittedAt)),
    closedAt: iso(submission.closedAt),
  };
};

const currentCycles = async (submissions) => {
  if (!submissions.length) return new Map();
  const cycles = await prisma.externalReviewCycle.findMany({ where: { OR: submissions.map((row) => ({ submissionId: row.id, cycle: row.currentCycle })) } });
  return new Map(cycles.map((cycle) => [cycle.submissionId, cycle]));
};

// ─── the queue ────────────────────────────────────────────────────────────

const SORTS = Object.freeze({
  priority: (a, b) => Number(b.overdue) - Number(a.overdue) || (a.awaitingConsultant === b.awaitingConsultant ? 0 : a.awaitingConsultant ? -1 : 1) || new Date(a.dueAt) - new Date(b.dueAt) || new Date(a.submittedAt) - new Date(b.submittedAt),
  oldest: (a, b) => new Date(a.submittedAt) - new Date(b.submittedAt),
  newest: (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt),
  due: (a, b) => new Date(a.dueAt) - new Date(b.dueAt),
  overdue: (a, b) => b.overdueMs - a.overdueMs || new Date(a.dueAt) - new Date(b.dueAt),
});

const startOfDay = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/**
 * The open-request queue for the caller, with its summary. Filters:
 * party, reviewer, module (sourceType), status group (open | awaiting |
 * returned | responded | closed | all), overdue, due / submitted ranges,
 * discipline, action (consultant | contractor), q (reference, title,
 * consultant, reviewer); sort priority | oldest | newest | due | overdue.
 */
const list = async ({ orgId, projectId, viewer, query = {} }) => {
  assertCanRead(viewer);
  const now = new Date();
  const types = readableSourceTypes(viewer);
  const where = { orgId, projectId, sourceType: { in: types }, ...scopeWhere(viewer) };
  if (query.partyId) where.partyId = query.partyId;
  if (query.reviewerId) where.responsibleUserId = query.reviewerId;
  if (query.sourceType) where.sourceType = types.includes(query.sourceType) ? query.sourceType : "__none__";
  const group = query.status || "open";
  if (group === "open") where.status = { notIn: FINISHED };
  else if (group === "awaiting") where.status = { in: WITH_CONSULTANT };
  else if (group === "returned") where.status = { in: [STATUS.RETURNED, STATUS.REVISING] };
  else if (group === "responded") where.status = { in: [STATUS.RESPONDED, STATUS.ACKNOWLEDGED] };
  else if (group === "closed") where.status = { in: FINISHED };
  else if (Object.values(STATUS).includes(group)) where.status = group;
  const submissions = await prisma.externalSubmission.findMany({ where, orderBy: { lastSubmittedAt: "desc" }, take: 1000 });
  const cycles = await currentCycles(submissions);
  const names = await namesFor(submissions.flatMap((row) => [row.responsibleUserId, cycles.get(row.id)?.submittedBy]));
  const parties = await partiesFor(submissions.map((row) => row.partyId));
  const contractorName = await contractorNameOf(orgId);
  let items = submissions.filter((row) => cycles.get(row.id)).map((submission) => serializeRow({ submission, cycle: cycles.get(submission.id), names, parties, contractorName, now }));
  if (query.overdue === "true") items = items.filter((row) => row.overdue);
  if (query.action === "consultant") items = items.filter((row) => row.actionWith.side === "consultant");
  if (query.action === "contractor") items = items.filter((row) => row.actionWith.side === "contractor");
  if (query.discipline) items = items.filter((row) => row.party.discipline === query.discipline);
  const inRange = (value, from, to) => (!from || new Date(value) >= new Date(from)) && (!to || new Date(value) <= new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`));
  if (query.dueFrom || query.dueTo) items = items.filter((row) => inRange(row.dueAt, query.dueFrom, query.dueTo));
  if (query.submittedFrom || query.submittedTo) items = items.filter((row) => inRange(row.submittedAt, query.submittedFrom, query.submittedTo));
  const q = text(query.q, 200)?.toLowerCase();
  if (q) items = items.filter((row) => [row.ref, row.sourceRef, row.title, row.party.name, row.responsible.name].some((value) => String(value || "").toLowerCase().includes(q)));
  items.sort(SORTS[query.sort] || SORTS.priority);
  return { items, summary: await summary({ orgId, projectId, viewer, now }), now: now.toISOString(), side: viewer.side };
};

/** The headline counts and response times, over everything the caller may see on the project. */
const summary = async ({ orgId, projectId, viewer, now = new Date() }) => {
  const types = readableSourceTypes(viewer);
  const scope = { orgId, projectId, sourceType: { in: types }, ...scopeWhere(viewer) };
  const open = await prisma.externalSubmission.findMany({ where: { ...scope, status: { in: [...WITH_CONSULTANT, ...WITH_CONTRACTOR] } }, select: { id: true, status: true, currentCycle: true, ref: true, sourceRef: true, title: true } });
  const cycles = await currentCycles(open);
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const weekEnd = new Date(today.getTime() + 7 * DAY);
  const weekStart = new Date(today.getTime() - 7 * DAY);
  const awaiting = open.filter((row) => WITH_CONSULTANT.includes(row.status));
  const cycleOf = (row) => cycles.get(row.id);
  const overdue = awaiting.filter((row) => cycleOf(row) && now > new Date(cycleOf(row).dueAt));
  const oldest = awaiting.map((row) => ({ row, cycle: cycleOf(row) })).filter((item) => item.cycle).sort((a, b) => new Date(a.cycle.submittedAt) - new Date(b.cycle.submittedAt))[0] || null;
  const answered = await prisma.externalReviewCycle.findMany({ where: { orgId, projectId, respondedAt: { not: null }, submission: { sourceType: { in: types }, ...scopeWhere(viewer) } }, select: { submittedAt: true, respondedAt: true, dueAt: true, decision: true } });
  const durations = answered.map((cycle) => new Date(cycle.respondedAt) - new Date(cycle.submittedAt)).sort((a, b) => a - b);
  return {
    awaitingConsultant: awaiting.length,
    dueToday: awaiting.filter((row) => cycleOf(row) && new Date(cycleOf(row).dueAt) >= today && new Date(cycleOf(row).dueAt) < tomorrow).length,
    dueThisWeek: awaiting.filter((row) => cycleOf(row) && new Date(cycleOf(row).dueAt) >= today && new Date(cycleOf(row).dueAt) < weekEnd).length,
    overdue: overdue.length,
    returnedToContractor: open.filter((row) => [STATUS.RETURNED, STATUS.REVISING].includes(row.status)).length,
    responseReceived: open.filter((row) => row.status === STATUS.RESPONDED).length,
    respondedThisWeek: answered.filter((cycle) => new Date(cycle.respondedAt) >= weekStart).length,
    averageResponseMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    medianResponseMs: durations.length ? durations[Math.floor((durations.length - 1) / 2)] : null,
    onTimePct: answered.length ? Math.round((answered.filter((cycle) => new Date(cycle.respondedAt) <= new Date(cycle.dueAt)).length / answered.length) * 100) : null,
    oldestOpen: oldest ? { id: oldest.row.id, ref: oldest.row.sourceRef || oldest.row.ref, title: oldest.row.title, openMs: Math.max(0, now - new Date(oldest.cycle.submittedAt)) } : null,
  };
};

/**
 * Response performance by consultant party and reviewer, from the review
 * cycles themselves (contractor side; a consultant sees only their own).
 */
const performance = async ({ orgId, projectId, viewer, query = {} }) => {
  assertCanRead(viewer);
  const now = new Date();
  const types = readableSourceTypes(viewer);
  const where = { orgId, projectId, submission: { sourceType: { in: query.sourceType && types.includes(query.sourceType) ? [query.sourceType] : types }, ...scopeWhere(viewer) } };
  if (query.partyId) where.partyId = query.partyId;
  if (query.reviewerId) where.responsibleUserId = query.reviewerId;
  if (query.from || query.to) where.submittedAt = { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(`${String(query.to).slice(0, 10)}T23:59:59.999Z`) } : {}) };
  const cycles = await prisma.externalReviewCycle.findMany({ where, select: { partyId: true, responsibleUserId: true, submittedAt: true, dueAt: true, respondedAt: true, decision: true, status: true } });
  const parties = await partiesFor(cycles.map((cycle) => cycle.partyId));
  const names = await namesFor(cycles.map((cycle) => cycle.responsibleUserId));
  const group = (keyOf, labelOf) => {
    const map = new Map();
    for (const cycle of cycles) {
      const key = keyOf(cycle);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(cycle);
    }
    return [...map.entries()].map(([key, rows]) => {
      const live = rows.filter((cycle) => cycle.status === "open");
      const answered = rows.filter((cycle) => cycle.respondedAt);
      const durations = answered.map((cycle) => new Date(cycle.respondedAt) - new Date(cycle.submittedAt)).sort((a, b) => a - b);
      return {
        key,
        label: labelOf(key),
        open: live.length,
        overdue: live.filter((cycle) => now > new Date(cycle.dueAt)).length,
        completed: answered.length,
        returned: answered.filter((cycle) => sources.RETURNING.includes(cycle.decision)).length,
        averageResponseMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
        medianResponseMs: durations.length ? durations[Math.floor((durations.length - 1) / 2)] : null,
        onTimePct: answered.length ? Math.round((answered.filter((cycle) => new Date(cycle.respondedAt) <= new Date(cycle.dueAt)).length / answered.length) * 100) : null,
      };
    });
  };
  return {
    byParty: group((cycle) => cycle.partyId, (key) => parties.get(key)?.name || "Consultant").map((row) => ({ ...row, discipline: parties.get(row.key)?.discipline || null })),
    byReviewer: group((cycle) => cycle.responsibleUserId, (key) => names.get(key) || "Reviewer"),
    basis: "Review cycles: response time = respondedAt − submittedAt; on time = responded by the cycle's due date. Calendar time, not contract working days.",
  };
};

// ─── one submission ───────────────────────────────────────────────────────

const isResponsible = async ({ submission, viewer }) => {
  if (!viewer.partyScoped) return false;
  if (submission.responsibleUserId === viewer.id) return true;
  // The explicit delegate: a primary reviewer of the same consultant party.
  if (!viewer.partyIds.includes(submission.partyId)) return false;
  const member = await prisma.projectPartyMember.findFirst({ where: { projectPartyId: submission.partyId, userId: viewer.id, status: "active", isPrimaryReviewer: true }, select: { id: true } });
  return Boolean(member);
};

/** A primary reviewer of the submission's own consultant party: the party's administrator for its reviews. */
const isPrimaryOfParty = async ({ submission, viewer }) => {
  if (!viewer.partyScoped || !viewer.partyIds.includes(submission.partyId)) return false;
  return Boolean(await prisma.projectPartyMember.findFirst({ where: { projectPartyId: submission.partyId, userId: viewer.id, status: "active", isPrimaryReviewer: true }, select: { id: true } }));
};

const allowedActions = async ({ submission, cycle, viewer }) => {
  const type = submission.sourceType;
  const responsible = await isResponsible({ submission, viewer });
  const primary = await isPrimaryOfParty({ submission, viewer });
  const contractor = !viewer.partyScoped;
  return {
    decide: responsible && WITH_CONSULTANT.includes(submission.status) && cycle.status === "open" && can(viewer, "external_review", "approve", `external_review.review_${type}`),
    attachResponse: viewer.partyScoped && WITH_CONSULTANT.includes(submission.status) && cycle.status === "open" && can(viewer, "external_review", "update"),
    commentShared: can(viewer, "external_review", "update"),
    commentInternal: contractor && can(viewer, "external_review", "update"),
    acknowledge: contractor && cycle.respondedAt && !cycle.acknowledgedAt && can(viewer, "external_review", "update"),
    createRevision: contractor && [STATUS.RETURNED, STATUS.RESPONDED, STATUS.ACKNOWLEDGED].includes(submission.status) && can(viewer, "external_review", "create"),
    resubmit: contractor && submission.status === STATUS.REVISING && can(viewer, "external_review", "create"),
    withdraw: contractor && WITH_CONSULTANT.includes(submission.status) && can(viewer, "external_review", "update", "external_review.withdraw"),
    close: contractor && [STATUS.RETURNED, STATUS.REVISING, STATUS.RESPONDED].includes(submission.status) && can(viewer, "external_review", "update"),
    reassign: WITH_CONSULTANT.includes(submission.status) && ((contractor && can(viewer, "external_review", "update", "external_review.reassign")) || primary),
    changeDueDate: contractor && WITH_CONSULTANT.includes(submission.status) && can(viewer, "external_review", "update", "external_review.due_date"),
  };
};

const fileLabels = async (documentIds) => {
  const ids = uniq(documentIds);
  if (!ids.length) return new Map();
  const docs = await prisma.projectDocument.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, originalName: true, fileName: true, mimeType: true, sizeBytes: true } });
  return new Map(docs.map((doc) => [doc.id, { id: doc.id, label: doc.title || doc.originalName || doc.fileName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes }]));
};

const responseFiles = async (cycleIds) => {
  if (!cycleIds.length) return new Map();
  const rows = await prisma.attachment.findMany({ where: { recordType: "external_review_cycle", recordId: { in: cycleIds } }, orderBy: { createdAt: "asc" }, select: { id: true, recordId: true, documentId: true, uploadedBy: true, createdAt: true, document: { select: { title: true, originalName: true, fileName: true, mimeType: true, sizeBytes: true } } } });
  const map = new Map();
  for (const row of rows) map.set(row.recordId, [...(map.get(row.recordId) || []), { id: row.documentId, attachmentId: row.id, label: row.document?.title || row.document?.originalName || row.document?.fileName || "Document", mimeType: row.document?.mimeType, sizeBytes: row.document?.sizeBytes, uploadedBy: row.uploadedBy, uploadedAt: iso(row.createdAt) }]);
  return map;
};

const TIMELINE_LABEL = Object.freeze({
  "external_review.submitted": "submitted",
  "external_review.resubmitted": "resubmitted",
  "external_review.opened": "first opened",
  "external_review.decided": "responded",
  "external_review.acknowledged": "acknowledged the response",
  "external_review.revision_created": "created a revision",
  "external_review.withdrawn": "withdrew",
  "external_review.closed": "closed",
  "external_review.reassigned": "reassigned the reviewer",
  "external_review.due_date": "changed the due date",
  "external_review.comment": "added correspondence",
  "external_review.notified": "notified",
});

/** The formal history from the audit trail: actor, side, time, action, cycle and revision; internal-note events never for a party. */
const timeline = async ({ orgId, projectId, submission, viewer }) => {
  const events = await prisma.auditEvent.findMany({ where: { orgId, projectId, entityType: auditService.ENTITY_TYPES.EXTERNAL_SUBMISSION, entityId: submission.id }, orderBy: { occurredAt: "asc" }, take: 500 });
  const visible = events.filter((event) => !(viewer.partyScoped && event.metadataJson?.visibility === "internal"));
  const names = await namesFor(visible.map((event) => event.actorId));
  return visible.map((event) => ({
    id: event.id,
    at: iso(event.occurredAt),
    actor: names.get(event.actorId) || "OctaPM",
    side: event.metadataJson?.side || null,
    action: event.summaryJson?.transition || event.action,
    label: TIMELINE_LABEL[event.summaryJson?.transition] || event.action,
    cycle: event.metadataJson?.cycle ?? null,
    revision: event.metadataJson?.revision ?? null,
    detail: event.summaryJson?.detail || null,
    reason: event.reason || null,
    oldStatus: event.oldStatus,
    newStatus: event.newStatus,
  }));
};

const detail = async ({ orgId, projectId, viewer, id, markOpened = true }) => {
  let submission = await loadVisible({ orgId, projectId, viewer, id });
  let cycles = await prisma.externalReviewCycle.findMany({ where: { submissionId: submission.id }, orderBy: { cycle: "asc" } });
  let current = cycles.find((cycle) => cycle.cycle === submission.currentCycle) || cycles[cycles.length - 1];
  // The responsible reviewer opening it the first time: recorded once, never the start of the clock.
  if (markOpened && current && current.status === "open" && !current.firstOpenedAt && (await isResponsible({ submission, viewer }))) {
    const now = new Date();
    const claimed = await prisma.externalReviewCycle.updateMany({ where: { id: current.id, firstOpenedAt: null }, data: { firstOpenedAt: now, firstOpenedBy: viewer.id } });
    if (claimed.count) {
      if (submission.status === STATUS.SUBMITTED) await prisma.externalSubmission.update({ where: { id: submission.id }, data: { status: STATUS.UNDER_REVIEW } });
      await audit({ orgId, projectId, submission, viewer, transition: "external_review.opened", oldStatus: submission.status, newStatus: STATUS.UNDER_REVIEW, cycle: current.cycle, revision: current.revision, detail: `${viewer.name || "Reviewer"} opened revision ${current.revision}` });
      submission = await prisma.externalSubmission.findUnique({ where: { id: submission.id } });
      cycles = await prisma.externalReviewCycle.findMany({ where: { submissionId: submission.id }, orderBy: { cycle: "asc" } });
      current = cycles.find((cycle) => cycle.cycle === submission.currentCycle);
    }
  }
  const now = new Date();
  const names = await namesFor([submission.responsibleUserId, submission.createdBy, ...cycles.flatMap((cycle) => [cycle.submittedBy, cycle.respondedBy, cycle.acknowledgedBy, cycle.firstOpenedBy, cycle.withdrawnBy, cycle.responsibleUserId])]);
  const parties = await partiesFor([submission.partyId]);
  const contractorName = await contractorNameOf(orgId);
  const issued = await fileLabels(cycles.flatMap((cycle) => cycle.issuedDocumentIdsJson || []));
  const responses = await responseFiles(cycles.map((cycle) => cycle.id));
  const recipients = await prisma.externalSubmissionRecipient.findMany({ where: { submissionId: submission.id, removedAt: null }, select: { userId: true, role: true, partyId: true } });
  const recipientNames = await namesFor(recipients.map((row) => row.userId));
  const recipientParties = await partiesFor(recipients.map((row) => row.partyId));
  const messages = await prisma.externalReviewMessage.findMany({ where: { submissionId: submission.id, ...(viewer.partyScoped ? { visibility: "shared" } : {}) }, orderBy: { createdAt: "asc" } });
  const messageNames = await namesFor(messages.map((row) => row.authorId));
  const source = sources.sourceOf(submission.sourceType);
  const currentNow = source ? await source.load({ projectId, sourceId: submission.sourceId }).catch(() => null) : null;
  const row = serializeRow({ submission, cycle: current, names, parties, contractorName, now });
  const actions = await allowedActions({ submission, cycle: current, viewer });
  return {
    ...row,
    sourceStatus: currentNow?.status || null,
    sourceTitleNow: currentNow?.title || null,
    recipients: recipients.map((recipient) => ({ userId: recipient.userId, name: recipientNames.get(recipient.userId) || null, role: recipient.role, party: recipientParties.get(recipient.partyId)?.name || null })),
    decisions: sources.decisionsFor(submission.sourceType),
    cycles: cycles.map((cycle, index) => {
      const clock = clockOf(cycle, now);
      const previous = cycles[index - 1];
      return {
        id: cycle.id,
        cycle: cycle.cycle,
        revision: cycle.revision,
        status: cycle.status,
        responsible: { id: cycle.responsibleUserId, name: names.get(cycle.responsibleUserId) || null },
        coverNote: cycle.coverNote,
        snapshot: cycle.snapshotJson || {},
        issuedFiles: (cycle.issuedDocumentIdsJson || []).map((documentId) => issued.get(documentId) || { id: documentId, label: "Document" }),
        submittedAt: iso(cycle.submittedAt),
        submittedBy: names.get(cycle.submittedBy) || null,
        dueAt: iso(cycle.dueAt),
        firstOpenedAt: iso(cycle.firstOpenedAt),
        firstOpenedBy: names.get(cycle.firstOpenedBy) || null,
        respondedAt: iso(cycle.respondedAt),
        respondedBy: names.get(cycle.respondedBy) || null,
        decision: cycle.decision,
        decisionLabel: cycle.decisionLabel,
        responseComment: cycle.responseComment,
        responseFiles: (responses.get(cycle.id) || []).map((file) => ({ ...file, uploadedBy: names.get(file.uploadedBy) || null })),
        acknowledgedAt: iso(cycle.acknowledgedAt),
        acknowledgedBy: names.get(cycle.acknowledgedBy) || null,
        withdrawnAt: iso(cycle.withdrawnAt),
        withdrawReason: cycle.withdrawReason,
        openMs: clock.openMs,
        responseMs: clock.responseMs,
        overdue: clock.overdue,
        overdueMs: clock.overdueMs,
        respondedLate: clock.respondedLate,
        // The contractor's own time between the previous answer and this issue — never counted as consultant time.
        contractorMsBefore: previous?.respondedAt ? Math.max(0, new Date(cycle.submittedAt) - new Date(previous.respondedAt)) : null,
      };
    }),
    messages: messages.map((message) => ({ id: message.id, cycle: message.cycle, author: messageNames.get(message.authorId) || null, side: message.authorSide, visibility: message.visibility, body: message.body, at: iso(message.createdAt) })),
    timeline: await timeline({ orgId, projectId, submission, viewer }),
    actions,
    // Who the review can be reassigned to: the other active members of the same consultant party.
    reassignTo: actions.reassign ? await colleaguesOf(submission) : [],
    viewerSide: viewer.side,
  };
};

const colleaguesOf = async (submission) => {
  const members = await prisma.projectPartyMember.findMany({ where: { projectPartyId: submission.partyId, status: "active", userId: { not: submission.responsibleUserId } }, select: { userId: true, jobTitle: true } });
  const names = await namesFor(members.map((member) => member.userId));
  return members.map((member) => ({ userId: member.userId, name: names.get(member.userId) || null, jobTitle: member.jobTitle }));
};

// ─── writes ───────────────────────────────────────────────────────────────

const audit = ({ tx, orgId, projectId, submission, viewer, transition, action = auditService.ACTIONS.STATUS_CHANGED, oldStatus = null, newStatus = null, reason = null, cycle = null, revision = null, detail = null, visibility = "shared", extra = {} }) =>
  auditService
    .recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.EXTERNAL_SUBMISSION,
      entityId: submission.id,
      action,
      actorId: viewer?.id || null,
      actorRole: viewer ? (viewer.partyScoped ? "external_party" : null) : null,
      oldStatus,
      newStatus,
      reason,
      summary: { transition, ref: submission.ref, sourceType: submission.sourceType, sourceRef: submission.sourceRef, detail },
      metadata: { side: viewer?.side || "system", cycle, revision, visibility, partyId: submission.partyId, ...extra },
    })
    .catch(() => null);

const notify = async ({ orgId, projectId, submission, recipients, event, title, message, actorId, priority = "normal", dueAt = null }) => {
  const ids = uniq(recipients).filter((id) => id !== actorId);
  if (!ids.length) return null;
  return notificationService
    .createNotifications({
      orgId,
      projectId,
      actorId,
      recipientUserIds: ids,
      type: "external_review",
      category: event.includes("submitted") ? notificationService.NOTIFICATION_CATEGORIES.APPROVAL : notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
      event,
      title,
      message,
      priority,
      dueAt,
      actionUrl: `/projects/${projectId}/reviews?recordId=${submission.id}`,
      entityType: "external_submission",
      entityId: submission.id,
      dedupeKeyBase: `external_review:${submission.id}:${event}:${Date.now()}`,
      metadata: { ref: submission.ref, sourceType: submission.sourceType, sourceRef: submission.sourceRef, status: submission.status },
    })
    .catch(() => null);
};

const consultantRecipients = async (submissionId) => (await prisma.externalSubmissionRecipient.findMany({ where: { submissionId, removedAt: null }, select: { userId: true } })).map((row) => row.userId);
const contractorRecipients = async (submissionId) => {
  const cycles = await prisma.externalReviewCycle.findMany({ where: { submissionId }, select: { submittedBy: true } });
  const submission = await prisma.externalSubmission.findUnique({ where: { id: submissionId }, select: { createdBy: true } });
  return uniq([submission?.createdBy, ...cycles.map((cycle) => cycle.submittedBy)]);
};

/** An active consultant-party member of the project (the reviewer or a copied participant). */
const assertPartyMember = async ({ projectId, partyId, userId, label }) => {
  const member = await prisma.projectPartyMember.findFirst({
    where: { userId, status: "active", projectParty: { id: partyId, projectId, status: "active", role: "consultant" } },
    select: { id: true },
  });
  if (!member) throw new HttpError(400, "EXTERNAL_REVIEW_RECIPIENT_INVALID", `${label} must be an active member of the consultant party on this project`);
};

const parseDue = (value, submittedAt) => {
  const due = value ? new Date(value) : null;
  if (!due || Number.isNaN(due.getTime())) throw new HttpError(400, "EXTERNAL_REVIEW_DUE_REQUIRED", "Set the date the response is due");
  if (due <= submittedAt) throw new HttpError(400, "EXTERNAL_REVIEW_DUE_INVALID", "The due date must be after the submission");
  if (due - submittedAt > MAX_DUE_DAYS * DAY) throw new HttpError(400, "EXTERNAL_REVIEW_DUE_INVALID", "The due date is more than a year away");
  return due;
};

/** The files a submission issues: only files attached to the record itself. */
const issuedFiles = (loaded, documentIds) => {
  const allowed = new Set(loaded.documents.map((doc) => doc.id));
  const asked = documentIds === undefined || documentIds === null ? [...allowed] : uniq(documentIds);
  for (const id of asked) if (!allowed.has(id)) throw new HttpError(400, "EXTERNAL_REVIEW_FILE_INVALID", "Only files attached to the record can be issued with it");
  return asked;
};

/** What was issued, kept as issued: the content rows and only the files issued with it. */
const snapshotOf = (loaded, documentIds) => ({ ref: loaded.ref, title: loaded.title, status: loaded.status, fields: loaded.fields, files: loaded.documents.filter((doc) => documentIds.includes(doc.id)) });

const nextNumber = async (tx, projectId) => ((await tx.externalSubmission.aggregate({ where: { projectId }, _max: { number: true } }))._max.number || 0) + 1;

/**
 * Submit to Consultant: issues the record's current content as revision 1 to
 * a consultant party's responsible reviewer, starting the review clock.
 */
const submit = async ({ orgId, projectId, viewer, payload }) => {
  if (viewer.partyScoped) throw forbidden("Only the contractor submits records for consultant review");
  if (!can(viewer, "external_review", "create")) throw forbidden("You cannot submit records for consultant review", { module: "external_review", action: "create" });
  const sourceType = payload.sourceType;
  const source = sources.sourceOf(sourceType);
  if (!source) throw new HttpError(400, "EXTERNAL_REVIEW_SOURCE_INVALID", "This record type cannot be submitted for review");
  if (!can(viewer, source.module, "read")) throw forbidden(`You cannot read ${source.label.toLowerCase()}s on this project`, { module: source.module, action: "read" });
  const loaded = await sources.loadSource({ projectId, sourceType, sourceId: payload.sourceId });
  if (!loaded) throw new HttpError(404, "EXTERNAL_REVIEW_SOURCE_NOT_FOUND", `${source.label} not found on this project`);
  const party = await prisma.projectParty.findFirst({ where: { id: payload.partyId, projectId, role: "consultant", status: "active", project: { orgId } }, select: { id: true } });
  if (!party) throw new HttpError(400, "EXTERNAL_REVIEW_PARTY_INVALID", "Choose a consultant party on this project");
  await assertPartyMember({ projectId, partyId: party.id, userId: payload.responsibleUserId, label: "The responsible reviewer" });
  const cc = uniq(payload.ccUserIds).filter((userId) => userId !== payload.responsibleUserId);
  const ccParties = [];
  for (const userId of cc) {
    const member = await prisma.projectPartyMember.findFirst({ where: { userId, status: "active", projectParty: { projectId, status: "active", role: "consultant" } }, select: { projectPartyId: true } });
    if (!member) throw new HttpError(400, "EXTERNAL_REVIEW_RECIPIENT_INVALID", "Copied reviewers must be active consultant members on this project");
    ccParties.push({ userId, partyId: member.projectPartyId });
  }
  const now = new Date();
  const dueAt = parseDue(payload.dueAt, now);
  const documentIds = issuedFiles(loaded, payload.documentIds);
  const coverNote = text(payload.coverNote);

  let created = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    try {
      created = await prisma.$transaction(async (tx) => {
        // One live review per record: a record is not with two consultants for authoritative answers at once.
        const live = await tx.externalSubmission.findFirst({ where: { projectId, sourceType, sourceId: payload.sourceId, status: { notIn: FINISHED } }, select: { ref: true } });
        if (live) throw new HttpError(409, "EXTERNAL_REVIEW_ACTIVE", `${loaded.ref} is already in consultant review (${live.ref}); withdraw or close it first`);
        const number = await nextNumber(tx, projectId);
        const submission = await tx.externalSubmission.create({
          data: {
            orgId, projectId, number, ref: `CR-${String(number).padStart(4, "0")}`,
            sourceType, sourceId: payload.sourceId, sourceRef: loaded.ref, title: loaded.title, activityId: loaded.activityId || null,
            partyId: party.id, responsibleUserId: payload.responsibleUserId, status: STATUS.SUBMITTED, revision: 1, currentCycle: 1,
            dueAt, firstSubmittedAt: now, lastSubmittedAt: now, createdBy: viewer.id,
          },
        });
        await tx.externalReviewCycle.create({ data: { orgId, projectId, submissionId: submission.id, cycle: 1, revision: 1, partyId: party.id, responsibleUserId: payload.responsibleUserId, coverNote, snapshotJson: snapshotOf(loaded, documentIds), issuedDocumentIdsJson: documentIds, submittedBy: viewer.id, submittedAt: now, dueAt } });
        await tx.externalSubmissionRecipient.create({ data: { submissionId: submission.id, userId: payload.responsibleUserId, partyId: party.id, role: "responsible", addedBy: viewer.id } });
        for (const row of ccParties) await tx.externalSubmissionRecipient.create({ data: { submissionId: submission.id, userId: row.userId, partyId: row.partyId, role: "cc", addedBy: viewer.id } });
        if (coverNote) await tx.externalReviewMessage.create({ data: { orgId, projectId, submissionId: submission.id, cycle: 1, authorId: viewer.id, authorSide: "contractor", visibility: "shared", body: coverNote } });
        return submission;
      });
    } catch (error) {
      if (error?.code !== "P2002" || attempt === 2) throw error;
    }
  }
  await source.onIssued?.({ projectId, sourceId: payload.sourceId }).catch(() => null);
  await audit({ orgId, projectId, submission: created, viewer, transition: "external_review.submitted", action: auditService.ACTIONS.CREATED, newStatus: STATUS.SUBMITTED, cycle: 1, revision: 1, detail: `${viewer.name || "Contractor"} submitted ${loaded.ref} revision 1, due ${dueAt.toISOString()}`, extra: { dueAt: dueAt.toISOString(), responsibleUserId: payload.responsibleUserId, cc, documents: documentIds.length } });
  const recipients = [payload.responsibleUserId, ...cc];
  await notify({ orgId, projectId, submission: created, recipients, actorId: viewer.id, event: "external_review.submitted", title: `${source.label} ${loaded.ref} submitted for your review`, message: `${loaded.title} — due ${dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, priority: "high", dueAt });
  await audit({ orgId, projectId, submission: created, viewer: null, transition: "external_review.notified", action: auditService.ACTIONS.UPDATED, cycle: 1, revision: 1, detail: `${recipients.length} reviewer(s) notified` });
  return detail({ orgId, projectId, viewer, id: created.id, markOpened: false });
};

/** The consultant's authoritative response to the open cycle. */
const decide = async ({ orgId, projectId, viewer, id, payload }) => {
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  const decision = payload.decision;
  const offered = sources.decisionsFor(submission.sourceType).map((row) => row.value);
  if (!offered.includes(decision)) throw new HttpError(400, "EXTERNAL_REVIEW_DECISION_INVALID", "This decision is not offered for this record type");
  if (!(await isResponsible({ submission, viewer }))) throw forbidden("Only the responsible reviewer (or the party's primary reviewer) can respond to this submission");
  if (!can(viewer, "external_review", "approve", `external_review.review_${submission.sourceType}`)) throw forbidden("Your access does not include reviewing this record type", { module: "external_review", transition: `external_review.review_${submission.sourceType}` });
  const comment = text(payload.comment);
  if (sources.COMMENT_REQUIRED.includes(decision) && !comment) throw new HttpError(400, "EXTERNAL_REVIEW_COMMENT_REQUIRED", decision === "approved_with_comments" ? "Approve with Comments needs the comments" : "Say why the record is returned");
  const now = new Date();
  const label = sources.decisionLabel(submission.sourceType, decision);
  const newStatus = sources.RETURNING.includes(decision) ? STATUS.RETURNED : STATUS.RESPONDED;
  const result = await prisma.$transaction(async (tx) => {
    // Only an open cycle with the consultant takes a decision: a replay, or a decision after withdrawal, finds none.
    const cycle = await tx.externalReviewCycle.findFirst({ where: { submissionId: submission.id, cycle: submission.currentCycle, status: "open" } });
    const claimed = cycle ? await tx.externalReviewCycle.updateMany({ where: { id: cycle.id, status: "open" }, data: { status: "responded", decision, decisionLabel: label, responseComment: comment, respondedAt: now, respondedBy: viewer.id, firstOpenedAt: cycle.firstOpenedAt || now, firstOpenedBy: cycle.firstOpenedBy || viewer.id } }) : { count: 0 };
    if (!claimed.count || !WITH_CONSULTANT.includes(submission.status)) throw new HttpError(409, "EXTERNAL_REVIEW_NOT_OPEN", "This submission is not waiting for a response");
    await tx.externalSubmission.update({ where: { id: submission.id }, data: { status: newStatus, decision, lastRespondedAt: now } });
    return cycle;
  });
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.decided", action: sources.RETURNING.includes(decision) ? auditService.ACTIONS.REJECTED : auditService.ACTIONS.APPROVED, oldStatus: submission.status, newStatus, reason: comment, cycle: result.cycle, revision: result.revision, detail: `${viewer.name || "Reviewer"}: ${label}`, extra: { decision, responseMs: now - new Date(result.submittedAt), late: now > new Date(result.dueAt) } });
  await notify({ orgId, projectId, submission, recipients: await contractorRecipients(submission.id), actorId: viewer.id, event: sources.RETURNING.includes(decision) ? "external_review.returned" : "external_review.responded", title: `${submission.sourceRef || submission.ref}: ${label}`, message: comment ? comment.slice(0, 240) : `${submission.title}`, priority: sources.RETURNING.includes(decision) ? "high" : "normal" });
  await audit({ orgId, projectId, submission, viewer: null, transition: "external_review.notified", action: auditService.ACTIONS.UPDATED, cycle: result.cycle, revision: result.revision, detail: "Contractor notified" });
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

const contractorOnly = (viewer, action = "update", transition = null) => {
  if (viewer.partyScoped) throw forbidden("Only the contractor can do this");
  if (!can(viewer, "external_review", action, transition)) throw forbidden("You cannot manage consultant reviews on this project", { module: "external_review", action, transition });
};

const acknowledge = async ({ orgId, projectId, viewer, id }) => {
  contractorOnly(viewer);
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  const cycle = await prisma.externalReviewCycle.findFirst({ where: { submissionId: submission.id, cycle: submission.currentCycle } });
  if (!cycle?.respondedAt) throw new HttpError(409, "EXTERNAL_REVIEW_NO_RESPONSE", "There is no response to acknowledge");
  if (cycle.acknowledgedAt) return detail({ orgId, projectId, viewer, id, markOpened: false });
  const now = new Date();
  await prisma.externalReviewCycle.updateMany({ where: { id: cycle.id, acknowledgedAt: null }, data: { acknowledgedAt: now, acknowledgedBy: viewer.id } });
  // An approval acknowledged is finished; a returned record still waits for its revision or closure.
  const newStatus = submission.status === STATUS.RESPONDED ? STATUS.ACKNOWLEDGED : submission.status;
  if (newStatus !== submission.status) await prisma.externalSubmission.update({ where: { id: submission.id }, data: { status: newStatus, closedAt: now, closedBy: viewer.id } });
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.acknowledged", oldStatus: submission.status, newStatus, cycle: cycle.cycle, revision: cycle.revision, detail: `${viewer.name || "Contractor"} acknowledged ${cycle.decisionLabel || "the response"}` });
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

const createRevision = async ({ orgId, projectId, viewer, id, reason = null }) => {
  contractorOnly(viewer, "create");
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  if (![STATUS.RETURNED, STATUS.RESPONDED, STATUS.ACKNOWLEDGED].includes(submission.status)) throw new HttpError(409, "EXTERNAL_REVIEW_CANNOT_REVISE", "A revision follows a consultant response");
  const revision = submission.revision + 1;
  const updated = await prisma.externalSubmission.updateMany({ where: { id: submission.id, status: submission.status }, data: { status: STATUS.REVISING, revision, closedAt: null, closedBy: null } });
  if (!updated.count) throw new HttpError(409, "EXTERNAL_REVIEW_CHANGED", "The submission changed; reload it");
  await sources.sourceOf(submission.sourceType)?.onRevision?.({ projectId, sourceId: submission.sourceId, revision }).catch(() => null);
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.revision_created", oldStatus: submission.status, newStatus: STATUS.REVISING, reason: text(reason), cycle: submission.currentCycle, revision, detail: `${viewer.name || "Contractor"} created revision ${revision}; the record can be edited until it is resubmitted` });
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

/** Resubmit: the record as it stands now becomes the next revision, in a new cycle with its own clock. */
const resubmit = async ({ orgId, projectId, viewer, id, payload = {} }) => {
  contractorOnly(viewer, "create");
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  if (submission.status !== STATUS.REVISING) throw new HttpError(409, "EXTERNAL_REVIEW_NOT_REVISING", "Create a revision before resubmitting");
  const loaded = await sources.loadSource({ projectId, sourceType: submission.sourceType, sourceId: submission.sourceId });
  if (!loaded) throw new HttpError(404, "EXTERNAL_REVIEW_SOURCE_NOT_FOUND", "The record no longer exists");
  const responsibleUserId = payload.responsibleUserId || submission.responsibleUserId;
  await assertPartyMember({ projectId, partyId: submission.partyId, userId: responsibleUserId, label: "The responsible reviewer" });
  const now = new Date();
  const dueAt = parseDue(payload.dueAt, now);
  const documentIds = issuedFiles(loaded, payload.documentIds);
  const coverNote = text(payload.coverNote);
  const cycleNumber = submission.currentCycle + 1;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.externalSubmission.updateMany({ where: { id: submission.id, status: STATUS.REVISING, currentCycle: submission.currentCycle }, data: { status: STATUS.SUBMITTED, currentCycle: cycleNumber, dueAt, lastSubmittedAt: now, responsibleUserId, decision: null, title: loaded.title, sourceRef: loaded.ref } });
    if (!claimed.count) throw new HttpError(409, "EXTERNAL_REVIEW_CHANGED", "The submission changed; reload it");
    await tx.externalReviewCycle.create({ data: { orgId, projectId, submissionId: submission.id, cycle: cycleNumber, revision: submission.revision, partyId: submission.partyId, responsibleUserId, coverNote, snapshotJson: snapshotOf(loaded, documentIds), issuedDocumentIdsJson: documentIds, submittedBy: viewer.id, submittedAt: now, dueAt } });
    if (responsibleUserId !== submission.responsibleUserId) {
      await tx.externalSubmissionRecipient.updateMany({ where: { submissionId: submission.id, role: "responsible", removedAt: null }, data: { removedAt: now } });
      await tx.externalSubmissionRecipient.upsert({ where: { submissionId_userId: { submissionId: submission.id, userId: responsibleUserId } }, create: { submissionId: submission.id, userId: responsibleUserId, partyId: submission.partyId, role: "responsible", addedBy: viewer.id }, update: { role: "responsible", removedAt: null } });
    }
    if (coverNote) await tx.externalReviewMessage.create({ data: { orgId, projectId, submissionId: submission.id, cycle: cycleNumber, authorId: viewer.id, authorSide: "contractor", visibility: "shared", body: coverNote } });
  });
  await sources.sourceOf(submission.sourceType)?.onIssued?.({ projectId, sourceId: submission.sourceId }).catch(() => null);
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.resubmitted", oldStatus: STATUS.REVISING, newStatus: STATUS.SUBMITTED, cycle: cycleNumber, revision: submission.revision, detail: `${viewer.name || "Contractor"} resubmitted revision ${submission.revision} (review cycle ${cycleNumber}), due ${dueAt.toISOString()}`, extra: { dueAt: dueAt.toISOString(), documents: documentIds.length } });
  await notify({ orgId, projectId, submission, recipients: await consultantRecipients(submission.id), actorId: viewer.id, event: "external_review.resubmitted", title: `${submission.sourceRef || submission.ref} revision ${submission.revision} resubmitted for your review`, message: `${loaded.title} — due ${dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, priority: "high", dueAt });
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

const withdraw = async ({ orgId, projectId, viewer, id, reason }) => {
  contractorOnly(viewer, "update", "external_review.withdraw");
  const why = text(reason, 2000);
  if (!why) throw new HttpError(400, "EXTERNAL_REVIEW_REASON_REQUIRED", "Say why the submission is withdrawn");
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // A response already given is never erased: only an unanswered cycle is withdrawn.
    const claimed = await tx.externalReviewCycle.updateMany({ where: { submissionId: submission.id, cycle: submission.currentCycle, status: "open" }, data: { status: "withdrawn", withdrawnAt: now, withdrawnBy: viewer.id, withdrawReason: why } });
    if (!claimed.count || !WITH_CONSULTANT.includes(submission.status)) throw new HttpError(409, "EXTERNAL_REVIEW_NOT_OPEN", "Only a submission waiting for the consultant can be withdrawn");
    await tx.externalSubmission.update({ where: { id: submission.id }, data: { status: STATUS.WITHDRAWN, closedAt: now, closedBy: viewer.id, closeReason: why } });
  });
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.withdrawn", oldStatus: submission.status, newStatus: STATUS.WITHDRAWN, reason: why, cycle: submission.currentCycle, revision: submission.revision, detail: `${viewer.name || "Contractor"} withdrew the submission` });
  await notify({ orgId, projectId, submission, recipients: await consultantRecipients(submission.id), actorId: viewer.id, event: "external_review.withdrawn", title: `${submission.sourceRef || submission.ref} withdrawn by the contractor`, message: why });
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

const close = async ({ orgId, projectId, viewer, id, reason = null }) => {
  contractorOnly(viewer);
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  if (![STATUS.RETURNED, STATUS.REVISING, STATUS.RESPONDED].includes(submission.status)) throw new HttpError(409, "EXTERNAL_REVIEW_CANNOT_CLOSE", "Only a submission back with the contractor can be closed");
  const why = text(reason, 2000);
  if (submission.status !== STATUS.RESPONDED && !why) throw new HttpError(400, "EXTERNAL_REVIEW_REASON_REQUIRED", "Say why the returned submission is closed without resubmitting");
  const now = new Date();
  await prisma.externalSubmission.update({ where: { id: submission.id }, data: { status: STATUS.CLOSED, closedAt: now, closedBy: viewer.id, closeReason: why } });
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.closed", oldStatus: submission.status, newStatus: STATUS.CLOSED, reason: why, cycle: submission.currentCycle, revision: submission.revision, detail: `${viewer.name || "Contractor"} closed the review` });
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

/** A new responsible reviewer within the same consultant party; the clock keeps its original start. */
const reassign = async ({ orgId, projectId, viewer, id, responsibleUserId, reason }) => {
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  const allowed = viewer.partyScoped ? await isPrimaryOfParty({ submission, viewer }) : can(viewer, "external_review", "update", "external_review.reassign");
  if (!allowed) throw forbidden("You cannot reassign this review");
  if (!WITH_CONSULTANT.includes(submission.status)) throw new HttpError(409, "EXTERNAL_REVIEW_NOT_OPEN", "Only a submission waiting for the consultant can be reassigned");
  const why = text(reason, 2000);
  if (!why) throw new HttpError(400, "EXTERNAL_REVIEW_REASON_REQUIRED", "Say why the reviewer changes");
  if (responsibleUserId === submission.responsibleUserId) throw new HttpError(400, "EXTERNAL_REVIEW_SAME_REVIEWER", "That person is already the responsible reviewer");
  await assertPartyMember({ projectId, partyId: submission.partyId, userId: responsibleUserId, label: "The new reviewer" });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.externalSubmission.update({ where: { id: submission.id }, data: { responsibleUserId } });
    await tx.externalReviewCycle.updateMany({ where: { submissionId: submission.id, cycle: submission.currentCycle, status: "open" }, data: { responsibleUserId } });
    await tx.externalSubmissionRecipient.updateMany({ where: { submissionId: submission.id, role: "responsible", removedAt: null }, data: { removedAt: now } });
    await tx.externalSubmissionRecipient.upsert({ where: { submissionId_userId: { submissionId: submission.id, userId: responsibleUserId } }, create: { submissionId: submission.id, userId: responsibleUserId, partyId: submission.partyId, role: "responsible", addedBy: viewer.id }, update: { role: "responsible", removedAt: null } });
  });
  const names = await namesFor([submission.responsibleUserId, responsibleUserId]);
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.reassigned", action: auditService.ACTIONS.UPDATED, reason: why, cycle: submission.currentCycle, revision: submission.revision, detail: `Reviewer ${names.get(submission.responsibleUserId) || "—"} → ${names.get(responsibleUserId) || "—"}`, extra: { from: submission.responsibleUserId, to: responsibleUserId } });
  await notify({ orgId, projectId, submission, recipients: [responsibleUserId], actorId: viewer.id, event: "external_review.assigned", title: `${submission.sourceRef || submission.ref} reassigned to you for review`, message: submission.title, priority: "high" });
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

const changeDueDate = async ({ orgId, projectId, viewer, id, dueAt, reason }) => {
  contractorOnly(viewer, "update", "external_review.due_date");
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  if (!WITH_CONSULTANT.includes(submission.status)) throw new HttpError(409, "EXTERNAL_REVIEW_NOT_OPEN", "Only an open review's due date can change");
  const why = text(reason, 2000);
  if (!why) throw new HttpError(400, "EXTERNAL_REVIEW_REASON_REQUIRED", "Say why the due date changes");
  const cycle = await prisma.externalReviewCycle.findFirst({ where: { submissionId: submission.id, cycle: submission.currentCycle, status: "open" } });
  if (!cycle) throw new HttpError(409, "EXTERNAL_REVIEW_NOT_OPEN", "This submission is not waiting for a response");
  const due = parseDue(dueAt, new Date(cycle.submittedAt));
  await prisma.$transaction([
    prisma.externalReviewCycle.update({ where: { id: cycle.id }, data: { dueAt: due } }),
    prisma.externalSubmission.update({ where: { id: submission.id }, data: { dueAt: due } }),
  ]);
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.due_date", action: auditService.ACTIONS.UPDATED, reason: why, cycle: cycle.cycle, revision: cycle.revision, detail: `Due date ${cycle.dueAt.toISOString()} → ${due.toISOString()}`, extra: { from: cycle.dueAt.toISOString(), to: due.toISOString() } });
  await notify({ orgId, projectId, submission, recipients: await consultantRecipients(submission.id), actorId: viewer.id, event: "external_review.due_date", title: `${submission.sourceRef || submission.ref}: due date changed`, message: `Now due ${due.toISOString().slice(0, 16).replace("T", " ")} UTC — ${why}`, dueAt: due });
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

/** Correspondence: shared (both sides) or an internal contractor note (never shown to a party). */
const addMessage = async ({ orgId, projectId, viewer, id, body, visibility = "shared" }) => {
  if (!can(viewer, "external_review", "update")) throw forbidden("You cannot add correspondence on this review", { module: "external_review", action: "update" });
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  const message = text(body);
  if (!message) throw new HttpError(400, "EXTERNAL_REVIEW_MESSAGE_REQUIRED", "Write the message");
  const kind = visibility === "internal" ? "internal" : "shared";
  if (kind === "internal" && viewer.partyScoped) throw forbidden("Internal notes belong to the contractor");
  const row = await prisma.externalReviewMessage.create({ data: { orgId, projectId, submissionId: submission.id, cycle: submission.currentCycle, authorId: viewer.id, authorSide: viewer.side, visibility: kind, body: message } });
  // The body of an internal note stays out of the audit summary; the event itself is internal.
  await audit({ orgId, projectId, submission, viewer, transition: "external_review.comment", action: auditService.ACTIONS.UPDATED, cycle: submission.currentCycle, revision: submission.revision, detail: kind === "internal" ? "Internal contractor note" : `${viewer.side === "consultant" ? "Consultant" : "Contractor"} correspondence: ${message.slice(0, 160)}`, visibility: kind, extra: { messageId: row.id } });
  if (kind === "shared") {
    const recipients = viewer.partyScoped ? await contractorRecipients(submission.id) : await consultantRecipients(submission.id);
    await notify({ orgId, projectId, submission, recipients, actorId: viewer.id, event: "external_review.comment", title: `${submission.sourceRef || submission.ref}: new correspondence`, message: message.slice(0, 240) });
  }
  return detail({ orgId, projectId, viewer, id, markOpened: false });
};

/** A file issued with, or returned on, the submission: served only to a caller who sees the submission. */
const fileFor = async ({ orgId, projectId, viewer, id, documentId }) => {
  const submission = await loadVisible({ orgId, projectId, viewer, id });
  const cycles = await prisma.externalReviewCycle.findMany({ where: { submissionId: submission.id }, select: { id: true, issuedDocumentIdsJson: true } });
  const issued = cycles.some((cycle) => (cycle.issuedDocumentIdsJson || []).includes(documentId));
  const returned = issued ? true : Boolean(await prisma.attachment.findFirst({ where: { recordType: "external_review_cycle", recordId: { in: cycles.map((cycle) => cycle.id) }, documentId }, select: { id: true } }));
  if (!issued && !returned) throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
  const document = await prisma.projectDocument.findFirst({ where: { id: documentId, orgId, projectId }, select: { originalName: true, fileName: true } });
  const file = await require("./attachment.service").getDocumentFile({ orgId, projectId, documentId });
  return { ...file, fileName: document?.originalName || document?.fileName || "file" };
};

/** The review panel on a source record: its live and past submissions, as the caller may see them. */
const forSource = async ({ orgId, projectId, viewer, sourceType, sourceId }) => {
  assertCanRead(viewer);
  if (!readableSourceTypes(viewer).includes(sourceType)) return { items: [], canSubmit: false };
  const rows = await prisma.externalSubmission.findMany({ where: { orgId, projectId, sourceType, sourceId, ...scopeWhere(viewer) }, orderBy: { firstSubmittedAt: "desc" } });
  const cycles = await currentCycles(rows);
  const names = await namesFor(rows.map((row) => row.responsibleUserId));
  const parties = await partiesFor(rows.map((row) => row.partyId));
  const contractorName = await contractorNameOf(orgId);
  const now = new Date();
  const items = rows.filter((row) => cycles.get(row.id)).map((submission) => serializeRow({ submission, cycle: cycles.get(submission.id), names, parties, contractorName, now }));
  const canSubmit = !viewer.partyScoped && can(viewer, "external_review", "create") && !rows.some((row) => !FINISHED.includes(row.status));
  const loaded = canSubmit ? await sources.loadSource({ projectId, sourceType, sourceId }) : null;
  return { items, canSubmit: canSubmit && Boolean(loaded), documents: loaded?.documents || [], decisions: sources.decisionsFor(sourceType) };
};

/** The consultant parties and their active members a contractor can address a submission to. */
const recipientsDirectory = async ({ orgId, projectId, viewer }) => {
  assertCanRead(viewer);
  if (viewer.partyScoped) return { parties: [] };
  const parties = await prisma.projectParty.findMany({
    where: { projectId, role: "consultant", status: "active", project: { orgId } },
    select: { id: true, discipline: true, company: { select: { name: true } }, members: { where: { status: "active" }, select: { userId: true, jobTitle: true, isPrimaryReviewer: true, projectRole: true } } },
    orderBy: { createdAt: "asc" },
  });
  const names = await namesFor(parties.flatMap((party) => party.members.map((member) => member.userId)));
  return {
    parties: parties.map((party) => ({
      id: party.id,
      name: party.company?.name || "Consultant",
      discipline: party.discipline,
      members: party.members.map((member) => ({ userId: member.userId, name: names.get(member.userId) || null, jobTitle: member.jobTitle, projectRole: member.projectRole, isPrimaryReviewer: member.isPrimaryReviewer })),
    })),
  };
};

/**
 * Whether a source record's issued content may change now: refused while a
 * submission of it is out for review or answered, until the contractor
 * creates a revision (or the review is withdrawn / closed).
 */
const assertSourceEditable = async ({ projectId, sourceType, sourceId }) => {
  const live = await prisma.externalSubmission.findFirst({ where: { projectId, sourceType, sourceId, status: { in: [STATUS.SUBMITTED, STATUS.UNDER_REVIEW, STATUS.RETURNED, STATUS.RESPONDED] } }, select: { ref: true, revision: true, status: true } });
  if (live) {
    throw new HttpError(409, "EXTERNAL_REVIEW_ISSUED", `Revision ${live.revision} was issued to the consultant (${live.ref}, ${STATUS_LABEL[live.status].toLowerCase()}); create a revision on the review before changing it`);
  }
};

module.exports = {
  STATUS,
  STATUS_LABEL,
  WITH_CONSULTANT,
  WITH_CONTRACTOR,
  FINISHED,
  viewerOf,
  clockOf,
  actionWith,
  list,
  summary,
  performance,
  detail,
  submit,
  decide,
  acknowledge,
  createRevision,
  resubmit,
  withdraw,
  close,
  reassign,
  changeDueDate,
  addMessage,
  fileFor,
  forSource,
  recipientsDirectory,
  assertSourceEditable,
};
