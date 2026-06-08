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

const listCorrespondence = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.correspondence.findMany({
    where: { projectId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
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

  return prisma.correspondence.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `COR-${String(count + 1).padStart(3, '0')}`,
      direction: payload.direction,
      type: payload.type,
      subject: payload.subject,
      body: payload.body?.trim() || null,
      contractualNotice: Boolean(payload.contractualNotice),
      date: payload.date ? new Date(payload.date) : new Date(),
      responseRequiredBy: payload.responseRequiredBy
        ? new Date(payload.responseRequiredBy)
        : null,
      responseDate: payload.responseDate
        ? new Date(payload.responseDate)
        : null,
      status: payload.status || 'open',
    },
  });
};

const updateCorrespondence = async ({
  orgId,
  projectId,
  correspondenceId,
  payload,
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

  return prisma.correspondence.update({
    where: { id: correspondenceId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
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
      status: payload.status ?? existing.status,
    },
  });
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
