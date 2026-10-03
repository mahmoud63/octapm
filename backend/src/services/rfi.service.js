const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  containsInsensitive,
  cursorArgs,
  dateRangeFilter,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
} = require("../utils/list-query");
const {
  RECORD_TYPES,
  attachWorkflowDetailsToRecords,
  primaryActivityIdFromPayload,
  recordDocumentRevisions,
  recordWorkflowHistory,
  syncWorkflowReferences,
  workflowPartyAssignmentData,
} = require("./workflow-support.service");
const {
  applyPartyWorkflowVisibility,
  assertPartyWorkflowAccess,
  withDefaultOwnerParty,
} = require("./company-party.service");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");
const rfiWorkflow = require("./rfi-workflow.service");
const { nextRef } = require("../utils/reference-number");
const {
  ARCHIVED_STATUS,
  applyArchiveVisibility,
  assertNotArchived,
  archiveResult,
} = require("./archive-policy.service");

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return project;
};

/**
 * An `activityId` sent beside `activityLinks` / `activityIds` was neither
 * stored (the links name the primary activity) nor checked (CERT-2). It names
 * one of this project's activities; another company's activity and one that
 * exists nowhere get the 400 the links' own check gives a missing activity.
 */
const assertActivityIdInProject = ({ projectId, activityId }) =>
  require("./tenant-references.service")
    .assertProjectRows({ model: "activity", projectId, ids: [activityId], code: "WORKFLOW_ACTIVITY_NOT_FOUND", message: "One or more linked activities were not found in this project" })
    .catch((error) => {
      throw error?.code === "WORKFLOW_ACTIVITY_NOT_FOUND" ? new HttpError(400, error.code, error.message) : error;
    });

const RFI_STATUSES = ["draft", "open", "answered", "closed", ARCHIVED_STATUS];
const RFI_OPEN_STATUSES = ["draft", "open", "answered"];

const toMoney = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** Fields added by OCTA-PM-RFI-016, normalised for create / update. */
const upgradeFields = (payload = {}, existing = null) => {
  const data = {};
  if (payload.managerUserId !== undefined) data.managerUserId = payload.managerUserId || null;
  if (payload.specSection !== undefined) data.specSection = payload.specSection?.trim() || null;
  if (payload.locationId !== undefined) data.locationId = payload.locationId || null;
  if (payload.costImpact !== undefined) data.costImpact = Boolean(payload.costImpact);
  if (payload.costImpactAmount !== undefined) data.costImpactAmount = toMoney(payload.costImpactAmount);
  if (payload.scheduleImpactFlag !== undefined) data.scheduleImpactFlag = Boolean(payload.scheduleImpactFlag);
  else if (payload.scheduleImpact !== undefined && !existing) data.scheduleImpactFlag = Number(payload.scheduleImpact) > 0;
  if (payload.officialResponseId !== undefined) data.officialResponseId = payload.officialResponseId || null;
  if (payload.bumpRevision) {
    data.revision = { increment: 1 };
    data.officialResponseId = null;
  }
  return data;
};
const RFI_PRIORITIES = ["low", "normal", "high", "urgent"];
const RFI_SORT_FIELDS = {
  created: "createdAt",
  updated: "updatedAt",
  dueDate: "dueDate",
  raisedDate: "raisedDate",
  responseRequiredBy: "responseRequiredBy",
  answeredDate: "answeredDate",
  priority: "priority",
  status: "status",
  ref: "ref",
};

const dateSummary = (value) => (value ? new Date(value).toISOString() : null);

const decisionText = (payload = {}) =>
  payload.reason ||
  payload.rejectedReason ||
  payload.comment ||
  payload.statusComment ||
  null;

const rfiAuditSummary = (record) => ({
  ref: record.ref,
  subject: record.subject,
  activityId: record.activityId || null,
  question: record.question || null,
  response: record.response || null,
  discipline: record.discipline || null,
  priority: record.priority,
  status: record.status,
  scheduleImpact: Number(record.scheduleImpact || 0),
  owner: record.owner || null,
  ownerPartyId: record.ownerPartyId || null,
  reviewer: record.reviewer || null,
  reviewerPartyId: record.reviewerPartyId || null,
  approver: record.approver || null,
  approverPartyId: record.approverPartyId || null,
  raisedBy: record.raisedBy || null,
  answeredBy: record.answeredBy || null,
  raisedDate: dateSummary(record.raisedDate),
  dueDate: dateSummary(record.dueDate),
  responseRequiredBy: dateSummary(record.responseRequiredBy),
  answeredDate: dateSummary(record.answeredDate),
  archivedAt: dateSummary(record.archivedAt),
  archivedBy: record.archivedBy || null,
  managerUserId: record.managerUserId || null,
  specSection: record.specSection || null,
  locationId: record.locationId || null,
  costImpact: Boolean(record.costImpact),
  costImpactAmount: record.costImpactAmount === null || record.costImpactAmount === undefined ? null : Number(record.costImpactAmount),
  scheduleImpactFlag: Boolean(record.scheduleImpactFlag),
  revision: Number(record.revision || 0),
  officialResponseId: record.officialResponseId || null,
});

const buildRfiWhere = ({ projectId, query = {} }) => {
  const where = { projectId };

  if (RFI_STATUSES.includes(query.status)) where.status = query.status;
  applyArchiveVisibility(where, query);
  if (RFI_PRIORITIES.includes(query.priority)) where.priority = query.priority;
  if (trimToNull(query.activityId))
    where.activityId = trimToNull(query.activityId);

  const owner = trimToNull(query.owner);
  if (owner) where.owner = containsInsensitive(owner);
  if (trimToNull(query.ownerPartyId))
    where.ownerPartyId = trimToNull(query.ownerPartyId);

  const dueDate = dateRangeFilter({
    after: trimToNull(query.dueAfter),
    before: trimToNull(query.dueBefore),
  });
  if (dueDate) where.dueDate = dueDate;

  // OCTA-PM-RFI-016 filters: manager, assignees, ball in court, location, overdue.
  if (trimToNull(query.managerUserId)) where.managerUserId = trimToNull(query.managerUserId);
  if (trimToNull(query.ballInCourtUserId)) where.ballInCourtUserId = trimToNull(query.ballInCourtUserId);
  if (trimToNull(query.locationId)) where.locationId = trimToNull(query.locationId);
  if (trimToNull(query.assigneeUserId)) {
    const assigneeUserId = trimToNull(query.assigneeUserId);
    where.AND = [
      ...(where.AND || []),
      { OR: [{ assigneeUserId }, { assignees: { some: { userId: assigneeUserId, role: "assignee" } } }] },
    ];
  }
  if (query.overdue === true || query.overdue === "true") {
    const now = new Date();
    where.status = where.status && RFI_OPEN_STATUSES.includes(where.status) ? where.status : { in: RFI_OPEN_STATUSES };
    where.AND = [
      ...(where.AND || []),
      { OR: [{ responseRequiredBy: { lt: now } }, { responseRequiredBy: null, dueDate: { lt: now } }] },
    ];
  }

  const search = trimToNull(query.search);
  if (search) {
    where.OR = [
      { ref: containsInsensitive(search) },
      { subject: containsInsensitive(search) },
      { question: containsInsensitive(search) },
      { response: containsInsensitive(search) },
      { discipline: containsInsensitive(search) },
      { owner: containsInsensitive(search) },
      { reviewer: containsInsensitive(search) },
      { approver: containsInsensitive(search) },
    ];
  }

  if (trimToNull(query.partyId)) {
    const partyId = trimToNull(query.partyId);
    const partyClause = {
      OR: [
        { ownerPartyId: partyId },
        { reviewerPartyId: partyId },
        { approverPartyId: partyId },
      ],
    };
    if (where.OR) {
      where.AND = [...(where.AND || []), { OR: where.OR }, partyClause];
      delete where.OR;
    } else {
      where.OR = partyClause.OR;
    }
  }

  return where;
};

/**
 * A status — or an answer — written straight through create / update is the
 * decision an action route takes (/submit, /answer, /close, /reject, /reopen)
 * and needs the transition that route needs (certification finding L40: a
 * subcontractor without rfi.answer or rfi.close closed its own RFI through
 * PATCH, with an answer it wrote and an approved schedule impact).
 * `canTransition(action, transition)` is the caller's permission check, given
 * by the create / update routes; internal callers that already passed an
 * action route's guard give none.
 */
const RFI_ANSWER_FIELDS = Object.freeze(["response", "answeredBy", "answeredDate", "officialResponseId"]);

const directStatusTransition = (fromStatus, toStatus) => {
  if (!toStatus || toStatus === fromStatus) return null;
  if (toStatus === "answered") return { action: "submit", transition: "rfi.answer" };
  if (toStatus === "closed") return { action: "approve", transition: "rfi.close" };
  if (toStatus === "open" && fromStatus === "draft") return { action: "submit", transition: "rfi.submit" };
  if (toStatus === "open" && fromStatus === "answered") return { action: "approve", transition: "rfi.reject" };
  if (toStatus === "open" && fromStatus === "closed") return { action: "approve", transition: "rfi.reopen" };
  return null;
};

const sameAnswerValue = (field, next, current) => {
  if (field === "answeredDate") return (next ? new Date(next).getTime() : null) === (current ? new Date(current).getTime() : null);
  return trimToNull(next) === trimToNull(current);
};

/**
 * The figures a close approves: the schedule impact is written onto the
 * activity link when the RFI closes, and convert-to-change prices the change
 * order from them. Once closed they change only for whoever closes RFIs
 * (review finding R8: a subcontractor rewrote a closed RFI's cost and days,
 * and the change order converted from it later took the rewritten figures).
 */
const RFI_IMPACT_FIELDS = Object.freeze(["costImpact", "costImpactAmount", "scheduleImpact", "scheduleImpactFlag"]);

const sameImpactValue = (field, next, current) => {
  if (field === "costImpact" || field === "scheduleImpactFlag") return Boolean(next) === Boolean(current);
  if (field === "costImpactAmount") return toMoney(next) === (current === null || current === undefined ? null : Number(current));
  return (Number(next) || 0) === (Number(current) || 0);
};

const assertDirectRfiChange = ({ existing = null, payload = {}, canTransition = null }) => {
  if (typeof canTransition !== "function") return;
  const fromStatus = existing ? existing.status : null;
  const toStatus = payload.status ?? fromStatus;
  const statusNeed = directStatusTransition(fromStatus, toStatus);
  if (statusNeed && !canTransition(statusNeed.action, statusNeed.transition)) {
    throw new HttpError(403, "FORBIDDEN", `Moving this RFI to "${toStatus}" needs the ${statusNeed.transition} permission; use the RFI's workflow action`, { module: "rfi", action: statusNeed.action, transition: statusNeed.transition, fromStatus, toStatus });
  }
  const answerFields = RFI_ANSWER_FIELDS.filter((field) => payload[field] !== undefined && !sameAnswerValue(field, payload[field], existing ? existing[field] : null));
  if (answerFields.length && !canTransition("submit", "rfi.answer")) {
    throw new HttpError(403, "FORBIDDEN", "Answering an RFI needs the rfi.answer permission; use the answer action", { module: "rfi", action: "submit", transition: "rfi.answer", fields: answerFields });
  }
  // A new revision is the reopen's: it clears the official answer (review
  // finding R9 — bumpRevision sent through PATCH did that with no decision).
  if (payload.bumpRevision && !canTransition("approve", "rfi.reopen")) {
    throw new HttpError(403, "FORBIDDEN", "A new RFI revision starts when the RFI is reopened; use the reopen action", { module: "rfi", action: "approve", transition: "rfi.reopen", fields: ["bumpRevision"] });
  }
  if (fromStatus === "closed" && toStatus === "closed") {
    const impactFields = RFI_IMPACT_FIELDS.filter((field) => payload[field] !== undefined && !sameImpactValue(field, payload[field], existing[field]));
    if (impactFields.length && !canTransition("approve", "rfi.close")) {
      throw new HttpError(403, "FORBIDDEN", "A closed RFI's impact figures are the ones its close approved; reopen it to change them", { module: "rfi", action: "approve", transition: "rfi.close", fields: impactFields });
    }
  }
};

const countByStatus = (counts, statuses) =>
  counts.reduce(
    (acc, row) => ({
      ...acc,
      [row.status]: row._count?._all || 0,
    }),
    Object.fromEntries(statuses.map((status) => [status, 0])),
  );

const listRfis = async ({ orgId, projectId, query = {}, projectAccess = null, viewerId = null }) => {
  await ensureProject({ orgId, projectId });

  const listQuery = normalizeListQuery(query, {
    allowedSorts: Object.keys(RFI_SORT_FIELDS),
    defaultSortBy: "created",
    defaultSortDir: "desc",
  });
  const where = rfiWorkflow.withDraftVisibility(
    applyPartyWorkflowVisibility(buildRfiWhere({ projectId, query }), projectAccess),
    viewerId,
  );
  const orderBy = [
    { [RFI_SORT_FIELDS[listQuery.sortBy]]: listQuery.sortDir },
    { id: listQuery.sortDir },
  ];

  const [records, statusCounts, impact] = await Promise.all([
    prisma.rfi.findMany({
      where,
      take: listQuery.limit + 1,
      orderBy,
      ...cursorArgs(listQuery.cursor),
    }),
    prisma.rfi.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.rfi.aggregate({
      where,
      _sum: { scheduleImpact: true },
    }),
  ]);
  const page = toCursorPage(records, listQuery.limit);
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.RFI,
    records: page.rows,
  });
  const summaryCounts = countByStatus(statusCounts, RFI_STATUSES);

  return {
    rows: rows.map((row) => ({ ...row, isOverdue: rfiWorkflow.isOverdue(row) })),
    summary: {
      draft: summaryCounts.draft,
      open: summaryCounts.open,
      answered: summaryCounts.answered,
      closed: summaryCounts.closed,
      archived: summaryCounts.archived,
      scheduleImpactDays: Number(impact._sum?.scheduleImpact || 0),
    },
    pagination: page.pagination,
  };
};

const createRfi = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
  projectAccess = null,
  canTransition = null,
}) => {
  await ensureProject({ orgId, projectId });
  assertDirectRfiChange({ payload, canTransition });
  await assertActivityIdInProject({ projectId, activityId: payload.activityId });

  const generatedRef = await nextRef(prisma, { table: 'Rfi', scopeColumn: 'projectId', scopeId: projectId, prefix: 'RFI' });
  const activityId = primaryActivityIdFromPayload(payload);
  const assignmentPayload = withDefaultOwnerParty(payload, projectAccess);
  await rfiWorkflow.validateUsers({ orgId, userIds: [payload.managerUserId] });
  await rfiWorkflow.validateLocation({ projectId, locationId: payload.locationId });

  const { row, people } = await prisma.$transaction(async (tx) => {
    const assignments = await workflowPartyAssignmentData({
      tx,
      orgId,
      projectId,
      payload: assignmentPayload,
      status: payload.status || "open",
    });
    const created = await tx.rfi.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || generatedRef,
        subject: payload.subject,
        question: payload.question?.trim() || null,
        response: payload.response?.trim() || null,
        discipline: payload.discipline?.trim() || null,
        priority: payload.priority || "normal",
        status: payload.status || "open",
        scheduleImpact: Number(payload.scheduleImpact) || 0,
        ...assignments,
        ...upgradeFields(payload),
        createdBy: userId || null,
        raisedBy: payload.raisedBy?.trim() || null,
        answeredBy: payload.answeredBy?.trim() || null,
        raisedDate: payload.raisedDate
          ? new Date(payload.raisedDate)
          : new Date(),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        responseRequiredBy: payload.responseRequiredBy
          ? new Date(payload.responseRequiredBy)
          : null,
        answeredDate: payload.answeredDate
          ? new Date(payload.answeredDate)
          : null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.RFI,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.RFI,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.question,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RFI,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment || payload.question,
      metadata: {
        ref: created.ref,
        subject: created.subject,
        scheduleImpact: Number(created.scheduleImpact || 0),
      },
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.RFI,
      record: created,
      payload,
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.RFI,
      entityId: created.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: null,
      newStatus: created.status,
      reason: payload.comment || payload.statusComment || null,
      newSummary: rfiAuditSummary(created),
      summary: {
        ref: created.ref,
        subject: created.subject,
        status: created.status,
        scheduleImpact: Number(created.scheduleImpact || 0),
      },
      metadata: { source: "document_control.rfi" },
    });
    const syncedPeople = await rfiWorkflow.syncPeople({
      tx,
      orgId,
      rfiId: created.id,
      assigneeUserIds: payload.assigneeUserIds,
      distributionUserIds: payload.distributionUserIds,
      actorId: userId,
    });
    const withBall = await rfiWorkflow.applyBallInCourt({ tx, rfi: created });
    return { row: withBall || created, people: syncedPeople };
  });

  if (row.status === "open") {
    await rfiWorkflow.notifyAssigned({ orgId, projectId, rfi: row, userIds: [...people.assigneesAdded, row.managerUserId], actorId: userId });
    await rfiWorkflow.notifyDistribution({ orgId, projectId, rfi: row, userIds: people.distributionAdded, actorId: userId });
  }

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.RFI,
    records: [row],
  });
  return enriched;
};

const requireDecisionText = (value, code, message) => {
  const text = decisionText({ comment: value, reason: value });
  if (!text) {
    throw new HttpError(400, code, message);
  }
  return text;
};

const getRfiForWorkflow = async ({ orgId, projectId, rfiId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "RFI_NOT_FOUND", "RFI not found");
  }

  return existing;
};

const updateRfi = async ({
  orgId,
  projectId,
  rfiId,
  payload,
  userId,
  userRole,
  forceWorkflowEvent = false,
  projectAccess = null,
  canTransition = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "RFI_NOT_FOUND", "RFI not found");
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });
  assertNotArchived(existing, {
    code: "RFI_ARCHIVED",
    message: "Archived RFIs cannot be updated through normal workflow actions",
  });
  assertDirectRfiChange({ existing, payload, canTransition });
  // As on create: checked before anything is written (CERT-2).
  await assertActivityIdInProject({ projectId, activityId: payload.activityId });

  const nextStatus = payload.status ?? existing.status;
  if (nextStatus === ARCHIVED_STATUS && existing.status !== ARCHIVED_STATUS) {
    throw new HttpError(
      400,
      "RFI_ARCHIVE_ACTION_REQUIRED",
      "Use the archive/delete endpoint to archive an RFI",
    );
  }
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);
  if (payload.managerUserId) await rfiWorkflow.validateUsers({ orgId, userIds: [payload.managerUserId] });
  if (payload.locationId) await rfiWorkflow.validateLocation({ projectId, locationId: payload.locationId });
  // An official response is chosen among this RFI's own responses (certification finding L9).
  if (payload.officialResponseId) {
    const response = await prisma.rfiResponse.findFirst({ where: { id: payload.officialResponseId, rfiId: existing.id }, select: { id: true } });
    if (!response) throw new HttpError(404, "RFI_RESPONSE_NOT_FOUND", "Response not found on this RFI");
  }

  const { row, people } = await prisma.$transaction(async (tx) => {
    const assignments = await workflowPartyAssignmentData({
      tx,
      orgId,
      projectId,
      payload,
      existing,
      status: nextStatus,
    });
    const updated = await tx.rfi.update({
      where: { id: rfiId },
      data: {
        activityId,
        subject: payload.subject ?? existing.subject,
        question:
          payload.question !== undefined
            ? payload.question?.trim() || null
            : existing.question,
        response:
          payload.response !== undefined
            ? payload.response?.trim() || null
            : existing.response,
        discipline:
          payload.discipline !== undefined
            ? payload.discipline?.trim() || null
            : existing.discipline,
        priority: payload.priority ?? existing.priority,
        status: nextStatus,
        scheduleImpact:
          payload.scheduleImpact !== undefined
            ? Number(payload.scheduleImpact) || 0
            : existing.scheduleImpact,
        ...assignments,
        ...upgradeFields(payload, existing),
        raisedBy:
          payload.raisedBy !== undefined
            ? payload.raisedBy?.trim() || null
            : existing.raisedBy,
        answeredBy:
          payload.answeredBy !== undefined
            ? payload.answeredBy?.trim() || null
            : existing.answeredBy,
        raisedDate:
          payload.raisedDate !== undefined
            ? payload.raisedDate
              ? new Date(payload.raisedDate)
              : null
            : existing.raisedDate,
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
        responseRequiredBy:
          payload.responseRequiredBy !== undefined
            ? payload.responseRequiredBy
              ? new Date(payload.responseRequiredBy)
              : null
            : existing.responseRequiredBy,
        answeredDate:
          payload.answeredDate !== undefined
            ? payload.answeredDate
              ? new Date(payload.answeredDate)
              : null
            : existing.answeredDate,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.RFI,
      recordId: rfiId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.RFI,
      recordId: rfiId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment || payload.response,
      userId,
      userRole,
      force: forceWorkflowEvent,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RFI,
      recordId: rfiId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      reason: decisionText(payload),
      comment: payload.comment || payload.statusComment || payload.response,
      force: forceWorkflowEvent,
      metadata: {
        ref: updated.ref,
        subject: updated.subject,
        scheduleImpact: Number(updated.scheduleImpact || 0),
      },
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.RFI,
      record: updated,
      payload,
      userId,
    });
    const reason = payload.comment || payload.statusComment || null;
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.RFI,
      entityId: rfiId,
      action:
        existing.status !== updated.status
          ? auditService.ACTIONS.STATUS_CHANGED
          : auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: updated.status,
      reason,
      oldSummary: rfiAuditSummary(existing),
      newSummary: rfiAuditSummary(updated),
      summary: {
        ref: updated.ref,
        subject: updated.subject,
        status: updated.status,
        scheduleImpact: Number(updated.scheduleImpact || 0),
        ...(payload.bumpRevision ? { revision: Number(updated.revision || 0) } : {}),
      },
      metadata: { source: "document_control.rfi" },
    });
    const syncedPeople = await rfiWorkflow.syncPeople({
      tx,
      orgId,
      rfiId,
      assigneeUserIds: payload.assigneeUserIds,
      distributionUserIds: payload.distributionUserIds,
      actorId: userId,
    });
    const withBall = await rfiWorkflow.applyBallInCourt({ tx, rfi: updated });
    if (updated.status === "closed" && existing.status !== "closed") {
      await rfiWorkflow.applyScheduleImpact({ tx, projectId, rfi: updated });
    }
    return { row: withBall || updated, people: syncedPeople };
  });

  if (row.status === "open") {
    const newManager = payload.managerUserId && payload.managerUserId !== existing.managerUserId ? [payload.managerUserId] : [];
    await rfiWorkflow.notifyAssigned({ orgId, projectId, rfi: row, userIds: [...people.assigneesAdded, ...newManager], actorId: userId });
  }
  if (people.distributionAdded.length) {
    await rfiWorkflow.notifyDistribution({ orgId, projectId, rfi: row, userIds: people.distributionAdded, actorId: userId });
  }

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.RFI,
    records: [row],
  });
  return enriched;
};

const submitRfi = async ({
  orgId,
  projectId,
  rfiId,
  comment = null,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const existing = await getRfiForWorkflow({ orgId, projectId, rfiId });
  if (existing.status === "closed") {
    throw new HttpError(
      409,
      "RFI_ALREADY_CLOSED",
      "Closed RFIs must be reopened before submission",
    );
  }

  const row = await updateRfi({
    orgId,
    projectId,
    rfiId,
    payload: {
      status: "open",
      comment: comment || "RFI submitted for response",
      statusComment: comment || "RFI submitted for response",
    },
    userId,
    userRole,
    projectAccess,
    forceWorkflowEvent: true,
  });
  if (existing.status === "draft") {
    const people = await rfiWorkflow.loadPeople({ rfiId });
    await rfiWorkflow.notifyAssigned({
      orgId,
      projectId,
      rfi: row,
      userIds: [...people.assignees.map((entry) => entry.userId), row.managerUserId],
      actorId: userId,
    });
    await rfiWorkflow.notifyDistribution({ orgId, projectId, rfi: row, userIds: people.distribution.map((entry) => entry.userId), actorId: userId });
  }
  return row;
};

const answerRfi = async ({
  orgId,
  projectId,
  rfiId,
  payload = {},
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const response = requireDecisionText(
    payload.response || payload.comment,
    "RFI_RESPONSE_REQUIRED",
    "A response is required to answer an RFI",
  );
  const existing = await getRfiForWorkflow({ orgId, projectId, rfiId });
  if (existing.status === "closed") {
    throw new HttpError(
      409,
      "RFI_ALREADY_CLOSED",
      "Closed RFIs must be reopened before answer updates",
    );
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  const row = await updateRfi({
    orgId,
    projectId,
    rfiId,
    payload: {
      ...payload,
      status: "answered",
      response,
      answeredBy: payload.answeredBy || userId,
      answeredDate: payload.answeredDate || new Date().toISOString(),
      comment: payload.comment || response,
      statusComment: payload.statusComment || payload.comment || response,
    },
    userId,
    userRole,
    projectAccess,
  });
  // The answer is also the official entry of the response thread.
  if (!payload.officialResponseId) {
    await rfiWorkflow.recordOfficialResponse({ orgId, projectId, rfi: row, body: response, authorId: userId });
  }
  const people = await rfiWorkflow.loadPeople({ rfiId });
  await rfiWorkflow.notifyDistribution({
    orgId,
    projectId,
    rfi: row,
    userIds: [row.managerUserId, row.createdBy, ...people.distribution.map((entry) => entry.userId)],
    actorId: userId,
    event: "rfi.answered",
    title: `${row.ref} answered: ${row.subject}`,
  });
  return row;
};

const closeRfi = async ({
  orgId,
  projectId,
  rfiId,
  comment,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const closeComment = requireDecisionText(
    comment,
    "RFI_CLOSE_COMMENT_REQUIRED",
    "A close comment is required",
  );
  const existing = await getRfiForWorkflow({ orgId, projectId, rfiId });
  if (existing.status === "closed") {
    throw new HttpError(409, "RFI_ALREADY_CLOSED", "RFI is already closed");
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  return updateRfi({
    orgId,
    projectId,
    rfiId,
    payload: {
      status: "closed",
      comment: closeComment,
      statusComment: closeComment,
    },
    userId,
    userRole,
    projectAccess,
  });
};

const reopenRfi = async ({
  orgId,
  projectId,
  rfiId,
  reason,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const reopenReason = requireDecisionText(
    reason,
    "RFI_REOPEN_REASON_REQUIRED",
    "A reason is required to reopen an RFI",
  );
  const existing = await getRfiForWorkflow({ orgId, projectId, rfiId });
  if (existing.status === "open") {
    throw new HttpError(409, "RFI_ALREADY_OPEN", "RFI is already open");
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  const row = await updateRfi({
    orgId,
    projectId,
    rfiId,
    payload: {
      status: "open",
      reason: reopenReason,
      comment: reopenReason,
      statusComment: reopenReason,
      // A reopened RFI starts a new revision: the next official answer replaces the old one.
      bumpRevision: existing.status !== "draft",
    },
    userId,
    userRole,
    projectAccess,
  });
  const people = await rfiWorkflow.loadPeople({ rfiId });
  await rfiWorkflow.notifyAssigned({
    orgId,
    projectId,
    rfi: row,
    userIds: [...people.assignees.map((entry) => entry.userId), row.managerUserId],
    actorId: userId,
  });
  return row;
};

const approveRfi = async ({
  orgId,
  projectId,
  rfiId,
  comment = null,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "RFI_NOT_FOUND", "RFI not found");
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  if (existing.status !== "answered") {
    throw new HttpError(
      409,
      "RFI_NOT_READY_FOR_APPROVAL",
      "Only answered RFIs can be approved",
    );
  }

  return updateRfi({
    orgId,
    projectId,
    rfiId,
    payload: {
      status: "closed",
      statusComment: comment,
      comment,
    },
    userId,
    userRole,
    projectAccess,
  });
};

const rejectRfi = async ({
  orgId,
  projectId,
  rfiId,
  reason,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const rejectionReason = decisionText({ reason });
  if (!rejectionReason) {
    throw new HttpError(
      400,
      "APPROVAL_WORKFLOW_REASON_REQUIRED",
      "A reason is required for this workflow decision",
    );
  }

  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "RFI_NOT_FOUND", "RFI not found");
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  if (existing.status !== "answered") {
    throw new HttpError(
      409,
      "RFI_NOT_READY_FOR_REJECTION",
      "Only answered RFIs can be rejected",
    );
  }

  return updateRfi({
    orgId,
    projectId,
    rfiId,
    payload: {
      status: "open",
      reason: rejectionReason,
      statusComment: rejectionReason,
      comment: rejectionReason,
    },
    userId,
    userRole,
    projectAccess,
  });
};

const deleteRfi = async ({
  orgId,
  projectId,
  rfiId,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "RFI_NOT_FOUND", "RFI not found");
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  if (existing.status === ARCHIVED_STATUS || existing.archivedAt) {
    return archiveResult({
      id: rfiId,
      status: ARCHIVED_STATUS,
      archivedAt: existing.archivedAt,
    });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const archived = await tx.rfi.update({
      where: { id: rfiId },
      data: {
        status: ARCHIVED_STATUS,
        archivedAt: now,
        archivedBy: userId || null,
      },
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.RFI,
      recordId: rfiId,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      comment: "RFI archived",
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RFI,
      recordId: rfiId,
      fromStatus: existing.status,
      toStatus: ARCHIVED_STATUS,
      actorId: userId,
      actorRole: userRole,
      comment: "RFI archived",
      metadata: {
        ref: existing.ref,
        subject: existing.subject,
        archivedAt: now.toISOString(),
      },
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.RFI,
      entityId: rfiId,
      action: auditService.ACTIONS.ARCHIVED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      oldSummary: rfiAuditSummary(existing),
      newSummary: rfiAuditSummary(archived),
      summary: {
        transition: "rfi.archive",
        ref: existing.ref,
        subject: existing.subject,
        status: ARCHIVED_STATUS,
      },
      metadata: { source: "document_control.rfi" },
    });
  });
  return archiveResult({ id: rfiId, archivedAt: now });
};

module.exports = {
  RFI_STATUSES,
  assertDirectRfiChange,
  listRfis,
  createRfi,
  updateRfi,
  submitRfi,
  answerRfi,
  closeRfi,
  reopenRfi,
  approveRfi,
  rejectRfi,
  deleteRfi,
};
