const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { nextRef } = require("../utils/reference-number");
const {
  RECORD_TYPES,
  workflowAssignmentData,
  attachWorkflowDetailsToRecords,
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

const listDefects = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await prisma.defectRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.DEFECT,
    records,
  });

  return {
    rows,
    summary: {
      open: rows.filter((row) => row.status === 'open').length,
      inProgress: rows.filter((row) => row.status === 'in_progress').length,
      closed: rows.filter((row) => row.status === 'closed').length,
      critical: rows.filter((row) => row.severity === 'critical').length,
      major: rows.filter((row) => row.severity === 'major').length,
      minor: rows.filter((row) => row.severity === 'minor').length,
    },
  };
};

const createDefect = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const generatedRef = await nextRef(prisma, { table: 'DefectRecord', scopeColumn: 'projectId', scopeId: projectId, prefix: 'DEF' });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.defectRecord.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || generatedRef,
        title: payload.title,
        trade: payload.trade?.trim() || null,
        location: payload.location?.trim() || null,
        severity: payload.severity || 'minor',
        status: payload.status || 'open',
        assignee: payload.assignee?.trim() || null,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          status: payload.status || 'open',
          assigneeTextField: 'assignee',
        })),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        targetCloseBy: payload.targetCloseBy
          ? new Date(payload.targetCloseBy)
          : null,
        closedDate:
          payload.status === 'closed'
            ? payload.closedDate
              ? new Date(payload.closedDate)
              : new Date()
            : null,
        notes: payload.notes?.trim() || null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.DEFECT,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.DEFECT,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.notes,
      force: true,
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.DEFECT,
    records: [row],
  });
  return enriched;
};

const updateDefect = async ({ orgId, projectId, defectId, payload, userId, userRole }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.defectRecord.findFirst({
    where: { id: defectId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'DEFECT_NOT_FOUND', 'Defect not found');
  }

  const nextStatus = payload.status ?? existing.status;
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.defectRecord.update({
      where: { id: defectId },
      data: {
        activityId,
        title: payload.title ?? existing.title,
        trade:
          payload.trade !== undefined
            ? payload.trade?.trim() || null
            : existing.trade,
        location:
          payload.location !== undefined
            ? payload.location?.trim() || null
            : existing.location,
        severity: payload.severity ?? existing.severity,
        status: nextStatus,
        assignee:
          payload.assignee !== undefined
            ? payload.assignee?.trim() || null
            : existing.assignee,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          existing,
          status: nextStatus,
          assigneeTextField: 'assignee',
        })),
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
        targetCloseBy:
          payload.targetCloseBy !== undefined
            ? payload.targetCloseBy
              ? new Date(payload.targetCloseBy)
              : null
            : existing.targetCloseBy,
        closedDate:
          nextStatus === 'closed'
            ? payload.closedDate
              ? new Date(payload.closedDate)
              : existing.closedDate || new Date()
            : null,
        notes:
          payload.notes !== undefined
            ? payload.notes?.trim() || null
            : existing.notes,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.DEFECT,
      recordId: defectId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.DEFECT,
      recordId: defectId,
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
    recordType: RECORD_TYPES.DEFECT,
    records: [row],
  });
  return enriched;
};

const deleteDefect = async ({ orgId, projectId, defectId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.defectRecord.findFirst({
    where: { id: defectId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'DEFECT_NOT_FOUND', 'Defect not found');
  }

  await prisma.defectRecord.delete({ where: { id: defectId } });
  return { deleted: true };
};

module.exports = {
  listDefects,
  createDefect,
  updateDefect,
  deleteDefect,
};
