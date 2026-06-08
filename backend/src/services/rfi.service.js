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

const listRfis = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.rfi.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });

  return {
    rows,
    summary: {
      open: rows.filter((row) => row.status === 'open').length,
      answered: rows.filter((row) => row.status === 'answered').length,
      closed: rows.filter((row) => row.status === 'closed').length,
      scheduleImpactDays: rows.reduce(
        (sum, row) => sum + (Number(row.scheduleImpact) || 0),
        0,
      ),
    },
  };
};

const createRfi = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.rfi.count({ where: { projectId } });

  return prisma.rfi.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `RFI-${String(count + 1).padStart(3, '0')}`,
      subject: payload.subject,
      question: payload.question?.trim() || null,
      response: payload.response?.trim() || null,
      discipline: payload.discipline?.trim() || null,
      priority: payload.priority || 'normal',
      status: payload.status || 'open',
      scheduleImpact: Number(payload.scheduleImpact) || 0,
      raisedBy: payload.raisedBy?.trim() || null,
      answeredBy: payload.answeredBy?.trim() || null,
      raisedDate: payload.raisedDate
        ? new Date(payload.raisedDate)
        : new Date(),
      dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
      responseRequiredBy: payload.responseRequiredBy
        ? new Date(payload.responseRequiredBy)
        : null,
      answeredDate: payload.answeredDate
        ? new Date(payload.answeredDate)
        : null,
    },
  });
};

const updateRfi = async ({ orgId, projectId, rfiId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'RFI_NOT_FOUND', 'RFI not found');
  }

  return prisma.rfi.update({
    where: { id: rfiId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
      subject: payload.subject ?? existing.subject,
      question:
        payload.question !== undefined
          ? payload.question?.trim() || null
          : existing.question,
      response:
        payload.response !== undefined
          ? payload.response?.trim() || null
          : existing.response,
      discipline:
        payload.discipline !== undefined
          ? payload.discipline?.trim() || null
          : existing.discipline,
      priority: payload.priority ?? existing.priority,
      status: payload.status ?? existing.status,
      scheduleImpact:
        payload.scheduleImpact !== undefined
          ? Number(payload.scheduleImpact) || 0
          : existing.scheduleImpact,
      raisedBy:
        payload.raisedBy !== undefined
          ? payload.raisedBy?.trim() || null
          : existing.raisedBy,
      answeredBy:
        payload.answeredBy !== undefined
          ? payload.answeredBy?.trim() || null
          : existing.answeredBy,
      raisedDate:
        payload.raisedDate !== undefined
          ? payload.raisedDate
            ? new Date(payload.raisedDate)
            : null
          : existing.raisedDate,
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
      answeredDate:
        payload.answeredDate !== undefined
          ? payload.answeredDate
            ? new Date(payload.answeredDate)
            : null
          : existing.answeredDate,
    },
  });
};

const deleteRfi = async ({ orgId, projectId, rfiId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.rfi.findFirst({
    where: { id: rfiId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'RFI_NOT_FOUND', 'RFI not found');
  }

  await prisma.rfi.delete({ where: { id: rfiId } });
  return { deleted: true };
};

module.exports = {
  listRfis,
  createRfi,
  updateRfi,
  deleteRfi,
};
