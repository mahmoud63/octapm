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

const listSubmittals = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const rows = await prisma.submittal.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }],
  });

  return {
    rows,
    summary: {
      pending: rows.filter((row) => row.status === 'pending').length,
      underReview: rows.filter((row) => row.status === 'under_review').length,
      approved: rows.filter((row) => row.status === 'approved').length,
      resubmit: rows.filter((row) => row.status === 'resubmit').length,
      rejected: rows.filter((row) => row.status === 'rejected').length,
    },
  };
};

const createSubmittal = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.submittal.count({ where: { projectId } });

  return prisma.submittal.create({
    data: {
      projectId,
      activityId: payload.activityId || null,
      ref: payload.ref || `SUB-${String(count + 1).padStart(3, '0')}`,
      title: payload.title,
      discipline: payload.discipline?.trim() || null,
      revision: payload.revision || 'A',
      specRef: payload.specRef?.trim() || null,
      status: payload.status || 'pending',
      submittedOn: payload.submittedOn ? new Date(payload.submittedOn) : null,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
      reviewedOn: payload.reviewedOn ? new Date(payload.reviewedOn) : null,
      remarks: payload.remarks?.trim() || null,
    },
  });
};

const updateSubmittal = async ({ orgId, projectId, submittalId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.submittal.findFirst({
    where: { id: submittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'SUBMITTAL_NOT_FOUND', 'Submittal not found');
  }

  return prisma.submittal.update({
    where: { id: submittalId },
    data: {
      activityId:
        payload.activityId !== undefined
          ? payload.activityId
          : existing.activityId,
      title: payload.title ?? existing.title,
      discipline:
        payload.discipline !== undefined
          ? payload.discipline?.trim() || null
          : existing.discipline,
      revision: payload.revision ?? existing.revision,
      specRef:
        payload.specRef !== undefined
          ? payload.specRef?.trim() || null
          : existing.specRef,
      status: payload.status ?? existing.status,
      submittedOn:
        payload.submittedOn !== undefined
          ? payload.submittedOn
            ? new Date(payload.submittedOn)
            : null
          : existing.submittedOn,
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
      remarks:
        payload.remarks !== undefined
          ? payload.remarks?.trim() || null
          : existing.remarks,
    },
  });
};

const deleteSubmittal = async ({ orgId, projectId, submittalId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.submittal.findFirst({
    where: { id: submittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, 'SUBMITTAL_NOT_FOUND', 'Submittal not found');
  }

  await prisma.submittal.delete({ where: { id: submittalId } });
  return { deleted: true };
};

module.exports = {
  listSubmittals,
  createSubmittal,
  updateSubmittal,
  deleteSubmittal,
};
