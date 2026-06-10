const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { toMoneyNumber } = require('../utils/money');
const {
  getProjectAccessWhere,
  throwProjectNotFoundOrAccessDenied,
} = require('./project-authorization.service');

const DEFAULT_RETENTION_RATE = 5;
const DEFAULT_REPORTING_CUTOFF_DAY = 25;

const cleanOptionalString = (value) => {
  if (value === null) return null;
  const trimmed = String(value || '').trim();
  return trimmed || null;
};

const parseOptionalDate = (value) => {
  if (value === null || value === '') return null;
  return value !== undefined ? new Date(value) : undefined;
};

const parseOptionalNumber = (value) => {
  if (value === null || value === '') return null;
  return value !== undefined ? Number(value) : undefined;
};

const parseOptionalMoney = (value) => {
  if (value === null || value === '') return null;
  return value !== undefined ? toMoneyNumber(value) : undefined;
};

const sanitizeProject = (project) => ({
  id: project.id,
  orgId: project.orgId,
  name: project.name,
  type: project.type,
  location: project.location,
  clientName: project.clientName ?? null,
  consultantName: project.consultantName ?? null,
  contractorName: project.contractorName ?? null,
  contractType: project.contractType ?? null,
  contractNumber: project.contractNumber ?? null,
  startDate: project.startDate,
  endDate: project.endDate,
  completionDate: project.completionDate ?? null,
  baselineDate: project.baselineDate ?? null,
  revisedCompletionDate: project.revisedCompletionDate ?? null,
  duration: project.duration,
  durationUnit: project.durationUnit,
  contractValue: project.contractValue,
  defaultRetentionRate: project.defaultRetentionRate ?? DEFAULT_RETENTION_RATE,
  ldRatePerDay: project.ldRatePerDay,
  weatherAllowanceDays: project.weatherAllowanceDays,
  projectCalendar: project.projectCalendar ?? null,
  reportingCutoffDay:
    project.reportingCutoffDay ?? DEFAULT_REPORTING_CUTOFF_DAY,
  currency: project.currency,
  status: project.status,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

const buildProjectData = (payload) => {
  const data = {};

  if (payload.name !== undefined) data.name = payload.name;
  if (payload.type !== undefined) data.type = cleanOptionalString(payload.type);
  if (payload.location !== undefined)
    data.location = cleanOptionalString(payload.location);
  if (payload.clientName !== undefined)
    data.clientName = cleanOptionalString(payload.clientName);
  if (payload.consultantName !== undefined)
    data.consultantName = cleanOptionalString(payload.consultantName);
  if (payload.contractorName !== undefined)
    data.contractorName = cleanOptionalString(payload.contractorName);
  if (payload.contractType !== undefined)
    data.contractType = cleanOptionalString(payload.contractType);
  if (payload.contractNumber !== undefined)
    data.contractNumber = cleanOptionalString(payload.contractNumber);
  if (payload.startDate !== undefined)
    data.startDate = parseOptionalDate(payload.startDate);
  if (payload.endDate !== undefined)
    data.endDate = parseOptionalDate(payload.endDate);
  if (payload.completionDate !== undefined)
    data.completionDate = parseOptionalDate(payload.completionDate);
  if (payload.baselineDate !== undefined)
    data.baselineDate = parseOptionalDate(payload.baselineDate);
  if (payload.revisedCompletionDate !== undefined)
    data.revisedCompletionDate = parseOptionalDate(
      payload.revisedCompletionDate,
    );
  if (payload.duration !== undefined) data.duration = payload.duration;
  if (payload.durationUnit !== undefined)
    data.durationUnit = payload.durationUnit;
  if (payload.contractValue !== undefined)
    data.contractValue = parseOptionalMoney(payload.contractValue);
  if (payload.defaultRetentionRate !== undefined) {
    data.defaultRetentionRate = parseOptionalNumber(
      payload.defaultRetentionRate,
    );
  }
  if (payload.ldRatePerDay !== undefined)
    data.ldRatePerDay = toMoneyNumber(payload.ldRatePerDay);
  if (payload.weatherAllowanceDays !== undefined)
    data.weatherAllowanceDays = Number(payload.weatherAllowanceDays) || 0;
  if (payload.projectCalendar !== undefined)
    data.projectCalendar = cleanOptionalString(payload.projectCalendar);
  if (payload.reportingCutoffDay !== undefined)
    data.reportingCutoffDay = parseOptionalNumber(payload.reportingCutoffDay);
  if (payload.currency !== undefined) data.currency = payload.currency;
  if (payload.status !== undefined) data.status = payload.status;

  return data;
};

const validateProjectDates = ({
  startDate,
  endDate,
  completionDate,
  revisedCompletionDate,
}) => {
  if (startDate && endDate && endDate <= startDate) {
    throw new HttpError(
      400,
      'INVALID_DATES',
      'endDate must be after startDate',
    );
  }

  if (startDate && completionDate && completionDate < startDate) {
    throw new HttpError(
      400,
      'INVALID_DATES',
      'completionDate must be on or after startDate',
    );
  }

  if (startDate && revisedCompletionDate && revisedCompletionDate < startDate) {
    throw new HttpError(
      400,
      'INVALID_DATES',
      'revisedCompletionDate must be on or after startDate',
    );
  }
};

const createProject = async ({ orgId, userId, role, payload }) => {
  const data = buildProjectData(payload);
  data.orgId = orgId;

  if (userId) {
    data.assignments = {
      create: {
        userId,
        role: role || 'project_member',
      },
    };
  }

  validateProjectDates({
    startDate: data.startDate,
    endDate: data.endDate,
    completionDate: data.completionDate,
    revisedCompletionDate: data.revisedCompletionDate,
  });

  const project = await prisma.project.create({ data });
  return sanitizeProject(project);
};

const findAccessibleProject = async ({ orgId, projectId, userId, role }) => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      orgId,
      ...getProjectAccessWhere({ userId, role }),
    },
  });

  if (!project) {
    await throwProjectNotFoundOrAccessDenied({ orgId, projectId });
  }

  return project;
};

const listProjects = async ({ orgId, userId, role, query }) => {
  const take = Math.min(Math.max(query.limit || 20, 1), 100);

  const where = {
    orgId,
    ...getProjectAccessWhere({ userId, role }),
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

const getProjectById = async ({ orgId, projectId, userId, role }) => {
  const project = await findAccessibleProject({
    orgId,
    projectId,
    userId,
    role,
  });

  return sanitizeProject(project);
};

const updateProject = async ({ orgId, projectId, userId, role, payload }) => {
  const existingProject = await findAccessibleProject({
    orgId,
    projectId,
    userId,
    role,
  });

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
  const nextCompletionDate =
    data.completionDate !== undefined
      ? data.completionDate
      : existingProject.completionDate;
  const nextRevisedCompletionDate =
    data.revisedCompletionDate !== undefined
      ? data.revisedCompletionDate
      : existingProject.revisedCompletionDate;
  validateProjectDates({
    startDate: nextStartDate,
    endDate: nextEndDate,
    completionDate: nextCompletionDate,
    revisedCompletionDate: nextRevisedCompletionDate,
  });

  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data,
  });

  return sanitizeProject(updatedProject);
};

const deleteProject = async ({ orgId, projectId, userId, role }) => {
  await findAccessibleProject({
    orgId,
    projectId,
    userId,
    role,
  });

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
  DEFAULT_RETENTION_RATE,
  DEFAULT_REPORTING_CUTOFF_DAY,
};
