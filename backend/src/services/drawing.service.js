const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

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

  const rows = await prisma.drawingRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
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

  return prisma.drawingRecord.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `DWG-${String(count + 1).padStart(3, '0')}`,
      drawingNumber: payload.drawingNumber,
      title: payload.title,
      discipline: payload.discipline?.trim() || null,
      revision: payload.revision || '0',
      purpose: payload.purpose?.trim() || null,
      status: payload.status || 'active',
      issueDate: payload.issueDate ? new Date(payload.issueDate) : null,
      fileUrl: payload.fileUrl?.trim() || null,
    },
  });
};

const updateDrawing = async ({ orgId, projectId, drawingId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.drawingRecord.findFirst({
    where: { id: drawingId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'DRAWING_NOT_FOUND', 'Drawing not found');
  }

  return prisma.drawingRecord.update({
    where: { id: drawingId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
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
      status: payload.status ?? existing.status,
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
