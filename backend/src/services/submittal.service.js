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

const SUBMITTAL_STATUSES = [
  'pending',
  'under_review',
  'approved',
  'resubmit',
  'rejected',
];
const SUBMITTAL_SORT_FIELDS = {
  created: 'createdAt',
  updated: 'updatedAt',
  dueDate: 'dueDate',
  submittedOn: 'submittedOn',
  reviewedOn: 'reviewedOn',
  status: 'status',
  ref: 'ref',
  title: 'title',
};

const dateSummary = (value) =>
  value ? new Date(value).toISOString() : null;

const submittalAuditSummary = (record) => ({
  ref: record.ref,
  title: record.title,
  activityId: record.activityId || null,
  discipline: record.discipline || null,
  revision: record.revision,
  specRef: record.specRef || null,
  status: record.status,
  owner: record.owner || null,
  reviewer: record.reviewer || null,
  approver: record.approver || null,
  submittedOn: dateSummary(record.submittedOn),
  dueDate: dateSummary(record.dueDate),
  reviewedOn: dateSummary(record.reviewedOn),
  remarks: record.remarks || null,
});

const buildSubmittalWhere = ({ projectId, query = {} }) => {
  const where = { projectId };

  if (SUBMITTAL_STATUSES.includes(query.status)) where.status = query.status;
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
      { title: containsInsensitive(search) },
      { discipline: containsInsensitive(search) },
      { specRef: containsInsensitive(search) },
      { remarks: containsInsensitive(search) },
      { owner: containsInsensitive(search) },
      { reviewer: containsInsensitive(search) },
      { approver: containsInsensitive(search) },
    ];
  }

  return where;
};

const countByStatus = (counts) =>
  counts.reduce(
    (acc, row) => ({
      ...acc,
      [row.status]: row._count?._all || 0,
    }),
    Object.fromEntries(SUBMITTAL_STATUSES.map((status) => [status, 0])),
  );

const listSubmittals = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });

  const listQuery = normalizeListQuery(query, {
    allowedSorts: Object.keys(SUBMITTAL_SORT_FIELDS),
    defaultSortBy: 'created',
    defaultSortDir: 'desc',
  });
  const where = buildSubmittalWhere({ projectId, query });
  const orderBy = [
    { [SUBMITTAL_SORT_FIELDS[listQuery.sortBy]]: listQuery.sortDir },
    { id: listQuery.sortDir },
  ];

  const [records, statusCounts] = await Promise.all([
    prisma.submittal.findMany({
      where,
      take: listQuery.limit + 1,
      orderBy,
      ...cursorArgs(listQuery.cursor),
    }),
    prisma.submittal.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
  ]);
  const page = toCursorPage(records, listQuery.limit);
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SUBMITTAL,
    records: page.rows,
  });
  const summaryCounts = countByStatus(statusCounts);

  return {
    rows,
    summary: {
      pending: summaryCounts.pending,
      underReview: summaryCounts.under_review,
      approved: summaryCounts.approved,
      resubmit: summaryCounts.resubmit,
      rejected: summaryCounts.rejected,
    },
    pagination: page.pagination,
  };
};

const createSubmittal = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.submittal.count({ where: { projectId } });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.submittal.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || `SUB-${String(count + 1).padStart(3, '0')}`,
        title: payload.title,
        discipline: payload.discipline?.trim() || null,
        revision: payload.revision || 'A',
        specRef: payload.specRef?.trim() || null,
        status: payload.status || 'pending',
        ...assignmentData(payload),
        submittedOn: payload.submittedOn ? new Date(payload.submittedOn) : null,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        reviewedOn: payload.reviewedOn ? new Date(payload.reviewedOn) : null,
        remarks: payload.remarks?.trim() || null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.remarks,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SUBMITTAL,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment || payload.remarks,
      metadata: {
        ref: created.ref,
        title: created.title,
        revision: created.revision,
      },
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      record: created,
      payload,
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL,
      entityId: created.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: null,
      newStatus: created.status,
      reason: payload.comment || payload.statusComment || null,
      newSummary: submittalAuditSummary(created),
      summary: {
        ref: created.ref,
        title: created.title,
        status: created.status,
        revision: created.revision,
      },
      metadata: { source: 'document_control.submittal' },
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SUBMITTAL,
    records: [row],
  });
  return enriched;
};

const updateSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  payload,
  userId,
  userRole,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.submittal.findFirst({
    where: { id: submittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'SUBMITTAL_NOT_FOUND', 'Submittal not found');
  }

  const nextStatus = payload.status ?? existing.status;
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.submittal.update({
      where: { id: submittalId },
      data: {
        activityId,
        title: payload.title ?? existing.title,
        discipline:
          payload.discipline !== undefined
            ? payload.discipline?.trim() || null
            : existing.discipline,
        revision: payload.revision ?? existing.revision,
        specRef:
          payload.specRef !== undefined
            ? payload.specRef?.trim() || null
            : existing.specRef,
        status: nextStatus,
        ...assignmentData(payload, existing),
        submittedOn:
          payload.submittedOn !== undefined
            ? payload.submittedOn
              ? new Date(payload.submittedOn)
              : null
            : existing.submittedOn,
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
        reviewedOn:
          payload.reviewedOn !== undefined
            ? payload.reviewedOn
              ? new Date(payload.reviewedOn)
              : null
            : existing.reviewedOn,
        remarks:
          payload.remarks !== undefined
            ? payload.remarks?.trim() || null
            : existing.remarks,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment || payload.remarks,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      reason: payload.comment || payload.statusComment || payload.remarks,
      comment: payload.comment || payload.statusComment || payload.remarks,
      metadata: {
        ref: updated.ref,
        title: updated.title,
        revision: updated.revision,
      },
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      record: updated,
      payload,
      userId,
    });
    const reason = payload.comment || payload.statusComment || null;
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL,
      entityId: submittalId,
      action:
        existing.status !== updated.status
          ? auditService.ACTIONS.STATUS_CHANGED
          : auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: updated.status,
      reason,
      oldSummary: submittalAuditSummary(existing),
      newSummary: submittalAuditSummary(updated),
      summary: {
        ref: updated.ref,
        title: updated.title,
        status: updated.status,
        revision: updated.revision,
      },
      metadata: { source: 'document_control.submittal' },
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SUBMITTAL,
    records: [row],
  });
  return enriched;
};

const deleteSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.submittal.findFirst({
    where: { id: submittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'SUBMITTAL_NOT_FOUND', 'Submittal not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.submittal.delete({ where: { id: submittalId } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL,
      entityId: submittalId,
      action: auditService.ACTIONS.DELETED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: null,
      oldSummary: submittalAuditSummary(existing),
      summary: {
        ref: existing.ref,
        title: existing.title,
        status: existing.status,
        revision: existing.revision,
      },
      metadata: { source: 'document_control.submittal' },
    });
  });
  return { deleted: true };
};

module.exports = {
  listSubmittals,
  createSubmittal,
  updateSubmittal,
  deleteSubmittal,
};
