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

const listNcrs = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.ncrRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
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

const createNcr = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.ncrRecord.count({ where: { projectId } });

  return prisma.ncrRecord.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `NCR-${String(count + 1).padStart(3, '0')}`,
      severity: payload.severity || 'minor',
      description: payload.description?.trim() || null,
      disposition: payload.disposition?.trim() || null,
      status: payload.status || 'open',
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
};

const updateNcr = async ({ orgId, projectId, ncrId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'NCR_NOT_FOUND', 'NCR not found');
  }

  const nextStatus = payload.status ?? existing.status;

  return prisma.ncrRecord.update({
    where: { id: ncrId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
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
