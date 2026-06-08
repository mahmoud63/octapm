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

const listDefects = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.defectRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
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

  const count = await prisma.defectRecord.count({ where: { projectId } });

  return prisma.defectRecord.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `DEF-${String(count + 1).padStart(3, '0')}`,
      title: payload.title,
      trade: payload.trade?.trim() || null,
      location: payload.location?.trim() || null,
      severity: payload.severity || 'minor',
      status: payload.status || 'open',
      assignee: payload.assignee?.trim() || null,
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
};

const updateDefect = async ({ orgId, projectId, defectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.defectRecord.findFirst({
    where: { id: defectId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'DEFECT_NOT_FOUND', 'Defect not found');
  }

  const nextStatus = payload.status ?? existing.status;

  return prisma.defectRecord.update({
    where: { id: defectId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
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
