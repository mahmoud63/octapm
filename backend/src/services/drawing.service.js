const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  RECORD_TYPES,
  assignmentData,
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

const listDrawings = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await prisma.drawingRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.DRAWING,
    records,
  });

  return {
    rows,
    summary: {
      active: rows.filter((row) => row.status === 'active').length,
      superseded: rows.filter((row) => row.status === 'superseded').length,
      cancelled: rows.filter((row) => row.status === 'cancelled').length,
    },
  };
};

const createDrawing = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.drawingRecord.count({ where: { projectId } });
  const activityId = primaryActivityIdFromPayload(payload);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.drawingRecord.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || `DWG-${String(count + 1).padStart(3, '0')}`,
        drawingNumber: payload.drawingNumber,
        title: payload.title,
        discipline: payload.discipline?.trim() || null,
        revision: payload.revision || '0',
        purpose: payload.purpose?.trim() || null,
        status: payload.status || 'active',
        ...assignmentData(payload),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        reviewedOn: payload.reviewedOn ? new Date(payload.reviewedOn) : null,
        issueDate: payload.issueDate ? new Date(payload.issueDate) : null,
        fileUrl: payload.fileUrl?.trim() || null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.DRAWING,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.DRAWING,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.purpose,
      force: true,
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.DRAWING,
      record: created,
      payload,
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.DRAWING,
    records: [row],
  });
  return enriched;
};

const updateDrawing = async ({
  orgId,
  projectId,
  drawingId,
  payload,
  userId,
  userRole,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.drawingRecord.findFirst({
    where: { id: drawingId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'DRAWING_NOT_FOUND', 'Drawing not found');
  }

  const nextStatus = payload.status ?? existing.status;
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.drawingRecord.update({
      where: { id: drawingId },
      data: {
        activityId,
        drawingNumber: payload.drawingNumber ?? existing.drawingNumber,
        title: payload.title ?? existing.title,
        discipline:
          payload.discipline !== undefined
            ? payload.discipline?.trim() || null
            : existing.discipline,
        revision: payload.revision ?? existing.revision,
        purpose:
          payload.purpose !== undefined
            ? payload.purpose?.trim() || null
            : existing.purpose,
        status: nextStatus,
        ...assignmentData(payload, existing),
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
        issueDate:
          payload.issueDate !== undefined
            ? payload.issueDate
              ? new Date(payload.issueDate)
              : null
            : existing.issueDate,
        fileUrl:
          payload.fileUrl !== undefined
            ? payload.fileUrl?.trim() || null
            : existing.fileUrl,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.DRAWING,
      recordId: drawingId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.DRAWING,
      recordId: drawingId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment || payload.purpose,
      userId,
      userRole,
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.DRAWING,
      record: updated,
      payload,
      userId,
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.DRAWING,
    records: [row],
  });
  return enriched;
};

const deleteDrawing = async ({ orgId, projectId, drawingId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.drawingRecord.findFirst({
    where: { id: drawingId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'DRAWING_NOT_FOUND', 'Drawing not found');
  }

  await prisma.drawingRecord.delete({ where: { id: drawingId } });
  return { deleted: true };
};

module.exports = {
  listDrawings,
  createDrawing,
  updateDrawing,
  deleteDrawing,
};
