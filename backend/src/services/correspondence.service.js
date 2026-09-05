const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  RECORD_TYPES,
  workflowAssignmentData,
  attachWorkflowDetailsToRecords,
  primaryActivityIdFromPayload,
  recordDocumentRevisions,
  recordWorkflowHistory,
  syncWorkflowReferences,
} = require('./workflow-support.service');

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const listCorrespondence = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await prisma.correspondence.findMany({
    where: { projectId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.CORRESPONDENCE,
    records,
  });

  return {
    rows,
    summary: {
      open: rows.filter((row) => row.status === 'open').length,
      closed: rows.filter((row) => row.status === 'closed').length,
      notices: rows.filter((row) => row.contractualNotice).length,
      incoming: rows.filter((row) => row.direction === 'incoming').length,
      outgoing: rows.filter((row) => row.direction === 'outgoing').length,
    },
  };
};

const createCorrespondence = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.correspondence.count({ where: { projectId } });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.correspondence.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || `COR-${String(count + 1).padStart(3, '0')}`,
        direction: payload.direction,
        type: payload.type,
        subject: payload.subject,
        body: payload.body?.trim() || null,
        contractualNotice: Boolean(payload.contractualNotice),
        date: payload.date ? new Date(payload.date) : new Date(),
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          status: payload.status || 'open',
        })),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        responseRequiredBy: payload.responseRequiredBy
          ? new Date(payload.responseRequiredBy)
          : null,
        responseDate: payload.responseDate
          ? new Date(payload.responseDate)
          : null,
        status: payload.status || 'open',
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.CORRESPONDENCE,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.CORRESPONDENCE,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.body,
      force: true,
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.CORRESPONDENCE,
      record: created,
      payload,
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.CORRESPONDENCE,
    records: [row],
  });
  return enriched;
};

const updateCorrespondence = async ({
  orgId,
  projectId,
  correspondenceId,
  payload,
  userId,
  userRole,
  viaWorkflow = false,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.correspondence.findFirst({
    where: { id: correspondenceId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'CORRESPONDENCE_NOT_FOUND',
      'Correspondence not found',
    );
  }

  const nextStatus = payload.status ?? existing.status;
  if (nextStatus !== existing.status && !viaWorkflow) {
    await require('./workflow-engine.service').assertNotLocked({ tool: 'correspondence', projectId, recordId: correspondenceId });
  }
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.correspondence.update({
      where: { id: correspondenceId },
      data: {
        activityId,
        direction: payload.direction ?? existing.direction,
        type: payload.type ?? existing.type,
        subject: payload.subject ?? existing.subject,
        body:
          payload.body !== undefined
            ? payload.body?.trim() || null
            : existing.body,
        contractualNotice:
          payload.contractualNotice !== undefined
            ? Boolean(payload.contractualNotice)
            : existing.contractualNotice,
        date:
          payload.date !== undefined
            ? payload.date
              ? new Date(payload.date)
              : null
            : existing.date,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          existing,
          status: nextStatus,
        })),
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
        responseDate:
          payload.responseDate !== undefined
            ? payload.responseDate
              ? new Date(payload.responseDate)
              : null
            : existing.responseDate,
        status: nextStatus,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.CORRESPONDENCE,
      recordId: correspondenceId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.CORRESPONDENCE,
      recordId: correspondenceId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment || payload.body,
      userId,
      userRole,
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.CORRESPONDENCE,
      record: updated,
      payload,
      userId,
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.CORRESPONDENCE,
    records: [row],
  });
  return enriched;
};

const deleteCorrespondence = async ({ orgId, projectId, correspondenceId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.correspondence.findFirst({
    where: { id: correspondenceId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'CORRESPONDENCE_NOT_FOUND',
      'Correspondence not found',
    );
  }

  await prisma.correspondence.delete({ where: { id: correspondenceId } });
  return { deleted: true };
};

module.exports = {
  listCorrespondence,
  createCorrespondence,
  updateCorrespondence,
  deleteCorrespondence,
};
