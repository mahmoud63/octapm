const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  containsInsensitive,
  cursorArgs,
  dateRangeFilter,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
} = require('../utils/list-query');
const {
  RECORD_TYPES,
  assignmentData,
  attachWorkflowDetailsToRecords,
  primaryActivityIdFromPayload,
  recordDocumentRevisions,
  recordWorkflowHistory,
  syncWorkflowReferences,
} = require('./workflow-support.service');
const auditService = require('./audit.service');
const approvalWorkflowService = require('./approval-workflow.service');

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const RFI_STATUSES = ['open', 'answered', 'closed'];
const RFI_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const RFI_SORT_FIELDS = {
  created: 'createdAt',
  updated: 'updatedAt',
  dueDate: 'dueDate',
  raisedDate: 'raisedDate',
  responseRequiredBy: 'responseRequiredBy',
  answeredDate: 'answeredDate',
  priority: 'priority',
  status: 'status',
  ref: 'ref',
};

const dateSummary = (value) =>
  value ? new Date(value).toISOString() : null;

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
  reviewer: record.reviewer || null,
  approver: record.approver || null,
  raisedBy: record.raisedBy || null,
  answeredBy: record.answeredBy || null,
  raisedDate: dateSummary(record.raisedDate),
  dueDate: dateSummary(record.dueDate),
  responseRequiredBy: dateSummary(record.responseRequiredBy),
  answeredDate: dateSummary(record.answeredDate),
});

const buildRfiWhere = ({ projectId, query = {} }) => {
  const where = { projectId };

  if (RFI_STATUSES.includes(query.status)) where.status = query.status;
  if (RFI_PRIORITIES.includes(query.priority)) where.priority = query.priority;
  if (trimToNull(query.activityId)) where.activityId = trimToNull(query.activityId);

  const owner = trimToNull(query.owner);
  if (owner) where.owner = containsInsensitive(owner);

  const dueDate = dateRangeFilter({
    after: trimToNull(query.dueAfter),
    before: trimToNull(query.dueBefore),
  });
  if (dueDate) where.dueDate = dueDate;

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

  return where;
};

const countByStatus = (counts, statuses) =>
  counts.reduce(
    (acc, row) => ({
      ...acc,
      [row.status]: row._count?._all || 0,
    }),
    Object.fromEntries(statuses.map((status) => [status, 0])),
  );

const listRfis = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });

  const listQuery = normalizeListQuery(query, {
    allowedSorts: Object.keys(RFI_SORT_FIELDS),
    defaultSortBy: 'created',
    defaultSortDir: 'desc',
  });
  const where = buildRfiWhere({ projectId, query });
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
      by: ['status'],
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
    rows,
    summary: {
      open: summaryCounts.open,
      answered: summaryCounts.answered,
      closed: summaryCounts.closed,
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
}) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.rfi.count({ where: { projectId } });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.rfi.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || `RFI-${String(count + 1).padStart(3, '0')}`,
        subject: payload.subject,
        question: payload.question?.trim() || null,
        response: payload.response?.trim() || null,
        discipline: payload.discipline?.trim() || null,
        priority: payload.priority || 'normal',
        status: payload.status || 'open',
        scheduleImpact: Number(payload.scheduleImpact) || 0,
        ...assignmentData(payload),
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
      metadata: { source: 'document_control.rfi' },
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.RFI,
    records: [row],
  });
  return enriched;
};

const updateRfi = async ({ orgId, projectId, rfiId, payload, userId, userRole }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'RFI_NOT_FOUND', 'RFI not found');
  }

  const nextStatus = payload.status ?? existing.status;
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
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
        ...assignmentData(payload, existing),
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
      comment: payload.comment || payload.statusComment || payload.response,
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
      },
      metadata: { source: 'document_control.rfi' },
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.RFI,
    records: [row],
  });
  return enriched;
};

const deleteRfi = async ({
  orgId,
  projectId,
  rfiId,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'RFI_NOT_FOUND', 'RFI not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.rfi.delete({ where: { id: rfiId } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.RFI,
      entityId: rfiId,
      action: auditService.ACTIONS.DELETED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: null,
      oldSummary: rfiAuditSummary(existing),
      summary: {
        ref: existing.ref,
        subject: existing.subject,
        status: existing.status,
      },
      metadata: { source: 'document_control.rfi' },
    });
  });
  return { deleted: true };
};

module.exports = {
  listRfis,
  createRfi,
  updateRfi,
  deleteRfi,
};
