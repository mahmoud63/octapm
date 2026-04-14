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

const listItps = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.itpRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
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

  const count = await prisma.itpRecord.count({ where: { projectId } });

  return prisma.itpRecord.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `ITP-${String(count + 1).padStart(3, '0')}`,
      title: payload.title,
      pointType: payload.pointType || 'hold',
      status: payload.status || 'pending',
      inspectionDate: payload.inspectionDate
        ? new Date(payload.inspectionDate)
        : null,
      inspector: payload.inspector?.trim() || null,
      notes: payload.notes?.trim() || null,
    },
  });
};

const updateItp = async ({ orgId, projectId, itpId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.itpRecord.findFirst({
    where: { id: itpId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'ITP_NOT_FOUND', 'ITP not found');
  }

  return prisma.itpRecord.update({
    where: { id: itpId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
      title: payload.title ?? existing.title,
      pointType: payload.pointType ?? existing.pointType,
      status: payload.status ?? existing.status,
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
