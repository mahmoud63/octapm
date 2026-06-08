const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const sanitizeProject = (project) => ({
  id: project.id,
  orgId: project.orgId,
  name: project.name,
  type: project.type,
  location: project.location,
  startDate: project.startDate,
  endDate: project.endDate,
  duration: project.duration,
  durationUnit: project.durationUnit,
  contractValue: project.contractValue,
  currency: project.currency,
  status: project.status,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

const buildProjectData = (payload) => {
  const data = {};

  if (payload.name !== undefined) data.name = payload.name;
  if (payload.type !== undefined) data.type = payload.type;
  if (payload.location !== undefined) data.location = payload.location;
  if (payload.startDate !== undefined)
    data.startDate = payload.startDate ? new Date(payload.startDate) : null;
  if (payload.endDate !== undefined)
    data.endDate = payload.endDate ? new Date(payload.endDate) : null;
  if (payload.duration !== undefined) data.duration = payload.duration;
  if (payload.durationUnit !== undefined)
    data.durationUnit = payload.durationUnit;
  if (payload.contractValue !== undefined)
    data.contractValue = payload.contractValue;
  if (payload.currency !== undefined) data.currency = payload.currency;
  if (payload.status !== undefined) data.status = payload.status;

  return data;
};

const validateProjectDates = (startDate, endDate) => {
  if (startDate && endDate && endDate <= startDate) {
    throw new HttpError(
      400,
      'INVALID_DATES',
      'endDate must be after startDate',
    );
  }
};

const createProject = async ({ orgId, payload }) => {
  const data = buildProjectData(payload);
  data.orgId = orgId;

  validateProjectDates(data.startDate, data.endDate);

  const project = await prisma.project.create({ data });
  return sanitizeProject(project);
};

const listProjects = async ({ orgId, query }) => {
  const take = Math.min(Math.max(query.limit || 20, 1), 100);

  const where = {
    orgId,
  };

  if (query.status) {
    where.status = query.status;
  }

  if (query.search) {
    where.name = {
      contains: query.search,
      mode: 'insensitive',
    };
  }

  const projects = await prisma.project.findMany({
    where,
    take: take + 1,
    orderBy: {
      id: 'asc',
    },
    ...(query.cursor
      ? {
          cursor: { id: query.cursor },
          skip: 1,
        }
      : {}),
  });

  let nextCursor = null;
  if (projects.length > take) {
    const nextProject = projects.pop();
    nextCursor = nextProject.id;
  }

  return {
    items: projects.map(sanitizeProject),
    pagination: {
      limit: take,
      nextCursor,
    },
  };
};

const getProjectById = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      orgId,
    },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return sanitizeProject(project);
};

const updateProject = async ({ orgId, projectId, payload }) => {
  const existingProject = await prisma.project.findFirst({
    where: {
      id: projectId,
      orgId,
    },
  });

  if (!existingProject) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  const data = buildProjectData(payload);
  if (Object.keys(data).length === 0) {
    throw new HttpError(
      400,
      'NO_UPDATES',
      'No valid fields provided for update',
    );
  }

  const nextStartDate =
    data.startDate !== undefined ? data.startDate : existingProject.startDate;
  const nextEndDate =
    data.endDate !== undefined ? data.endDate : existingProject.endDate;
  validateProjectDates(nextStartDate, nextEndDate);

  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data,
  });

  return sanitizeProject(updatedProject);
};

const deleteProject = async ({ orgId, projectId }) => {
  const existingProject = await prisma.project.findFirst({
    where: {
      id: projectId,
      orgId,
    },
  });

  if (!existingProject) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  try {
    await prisma.project.delete({
      where: { id: projectId },
    });

    return { deleted: true };
  } catch (error) {
    if (error?.code === 'P2003' || error?.code === 'P2014') {
      throw new HttpError(
        409,
        'PROJECT_HAS_DEPENDENCIES',
        'Project cannot be deleted while linked records still exist',
      );
    }

    throw error;
  }
};

module.exports = {
  createProject,
  listProjects,
  getProjectById,
  updateProject,
  deleteProject,
};
