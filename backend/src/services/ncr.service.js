const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  RECORD_TYPES,
  assignmentData,
  attachWorkflowDetailsToRecords,
  primaryActivityIdFromPayload,
  recordWorkflowHistory,
  syncWorkflowReferences,
} = require('./workflow-support.service');
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

const listNcrs = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await prisma.ncrRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.NCR,
    records,
  });

  const now = Date.now();
  const summary = {
    open: rows.filter((row) => row.status === 'open').length,
    closed: rows.filter((row) => row.status === 'closed').length,
    major: rows.filter((row) => row.severity === 'major').length,
    minor: rows.filter((row) => row.severity === 'minor').length,
    overdue: rows.filter(
      (row) =>
        row.status !== 'closed' &&
        row.dueDate &&
        new Date(row.dueDate).getTime() < now,
    ).length,
  };

  return { rows, summary };
};

const createNcr = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.ncrRecord.count({ where: { projectId } });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.ncrRecord.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || `NCR-${String(count + 1).padStart(3, '0')}`,
        severity: payload.severity || 'minor',
        description: payload.description?.trim() || null,
        disposition: payload.disposition?.trim() || null,
        status: payload.status || 'open',
        ...assignmentData(payload),
        responsible: payload.responsible?.trim() || null,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        closedDate:
          payload.status === 'closed'
            ? payload.closedDate
              ? new Date(payload.closedDate)
              : new Date()
            : null,
      },
    });

    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.description,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment || payload.description,
      metadata: {
        ref: created.ref,
        severity: created.severity,
        activityId: created.activityId,
      },
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.NCR,
    records: [row],
  });
  return enriched;
};

const updateNcr = async ({ orgId, projectId, ncrId, payload, userId, userRole }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'NCR_NOT_FOUND', 'NCR not found');
  }

  const nextStatus = payload.status ?? existing.status;
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.ncrRecord.update({
      where: { id: ncrId },
      data: {
        activityId,
        severity: payload.severity ?? existing.severity,
        description:
          payload.description !== undefined
            ? payload.description?.trim() || null
            : existing.description,
        disposition:
          payload.disposition !== undefined
            ? payload.disposition?.trim() || null
            : existing.disposition,
        status: nextStatus,
        ...assignmentData(payload, existing),
        responsible:
          payload.responsible !== undefined
            ? payload.responsible?.trim() || null
            : existing.responsible,
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
        closedDate:
          nextStatus === 'closed'
            ? payload.closedDate
              ? new Date(payload.closedDate)
              : existing.closedDate || new Date()
            : null,
      },
    });

    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: ncrId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment,
      metadata: {
        ref: updated.ref,
        severity: updated.severity,
        activityId: updated.activityId,
      },
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.NCR,
    records: [row],
  });
  return enriched;
};

const deleteNcr = async ({ orgId, projectId, ncrId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'NCR_NOT_FOUND', 'NCR not found');
  }

  await prisma.ncrRecord.delete({ where: { id: ncrId } });
  return { deleted: true };
};

module.exports = {
  listNcrs,
  createNcr,
  updateNcr,
  deleteNcr,
};
