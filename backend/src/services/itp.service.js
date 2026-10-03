const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { nextRef } = require("../utils/reference-number");
const {
  RECORD_TYPES,
  workflowAssignmentData,
  attachWorkflowDetailsToRecords,
  assertPayloadActivity,
  primaryActivityIdFromPayload,
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

const listItps = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await prisma.itpRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.ITP,
    records,
  });

  return {
    rows,
    summary: {
      pending: rows.filter((row) => row.status === 'pending').length,
      passed: rows.filter((row) => row.status === 'passed').length,
      failed: rows.filter((row) => row.status === 'failed').length,
      waived: rows.filter((row) => row.status === 'waived').length,
    },
  };
};

const createItp = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });
  await assertPayloadActivity({ projectId, payload });

  const generatedRef = await nextRef(prisma, { table: 'ItpRecord', scopeColumn: 'projectId', scopeId: projectId, prefix: 'ITP' });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.itpRecord.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || generatedRef,
        title: payload.title,
        pointType: payload.pointType || 'hold',
        status: payload.status || 'pending',
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          status: payload.status || 'pending',
          assigneeTextField: 'inspector',
        })),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        inspectionDate: payload.inspectionDate
          ? new Date(payload.inspectionDate)
          : null,
        inspector: payload.inspector?.trim() || null,
        notes: payload.notes?.trim() || null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.ITP,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.ITP,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.notes,
      force: true,
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.ITP,
    records: [row],
  });
  return enriched;
};

const updateItp = async ({ orgId, projectId, itpId, payload, userId, userRole }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.itpRecord.findFirst({
    where: { id: itpId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'ITP_NOT_FOUND', 'ITP not found');
  }

  const nextStatus = payload.status ?? existing.status;
  await assertPayloadActivity({ projectId, payload });
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.itpRecord.update({
      where: { id: itpId },
      data: {
        activityId,
        title: payload.title ?? existing.title,
        pointType: payload.pointType ?? existing.pointType,
        status: nextStatus,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          existing,
          status: nextStatus,
          assigneeTextField: 'inspector',
        })),
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
        inspectionDate:
          payload.inspectionDate !== undefined
            ? payload.inspectionDate
              ? new Date(payload.inspectionDate)
              : null
            : existing.inspectionDate,
        inspector:
          payload.inspector !== undefined
            ? payload.inspector?.trim() || null
            : existing.inspector,
        notes:
          payload.notes !== undefined
            ? payload.notes?.trim() || null
            : existing.notes,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.ITP,
      recordId: itpId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.ITP,
      recordId: itpId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment,
      userId,
      userRole,
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.ITP,
    records: [row],
  });
  return enriched;
};

const deleteItp = async ({ orgId, projectId, itpId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.itpRecord.findFirst({
    where: { id: itpId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'ITP_NOT_FOUND', 'ITP not found');
  }

  await prisma.itpRecord.delete({ where: { id: itpId } });
  return { deleted: true };
};

module.exports = {
  listItps,
  createItp,
  updateItp,
  deleteItp,
};
