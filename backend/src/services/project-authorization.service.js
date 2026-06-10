const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const PROJECT_ACCESS_DENIED_CODE = 'PROJECT_ACCESS_DENIED';
const PROJECT_ACCESS_DENIED_MESSAGE = 'You are not assigned to this project';
const ORG_WIDE_PROJECT_ACCESS_ROLES = new Set(['pm', 'super_admin']);

const canAccessAllProjects = (role) => ORG_WIDE_PROJECT_ACCESS_ROLES.has(role);

const projectAccessDenied = () =>
  new HttpError(
    403,
    PROJECT_ACCESS_DENIED_CODE,
    PROJECT_ACCESS_DENIED_MESSAGE,
  );

const getProjectAccessWhere = ({ userId, role }) => {
  if (canAccessAllProjects(role)) {
    return {};
  }

  if (!userId) {
    throw projectAccessDenied();
  }

  return {
    assignments: {
      some: {
        userId,
      },
    },
  };
};

const throwProjectNotFoundOrAccessDenied = async ({ orgId, projectId }) => {
  const projectExists = await prisma.project.findFirst({
    where: {
      id: projectId,
      orgId,
    },
    select: {
      id: true,
    },
  });

  if (projectExists) {
    throw projectAccessDenied();
  }

  throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
};

const assertProjectAccess = async ({ orgId, projectId, userId, role }) => {
  const select = {
    id: true,
    orgId: true,
  };

  if (!canAccessAllProjects(role) && userId) {
    select.assignments = {
      where: { userId },
      select: { role: true },
      take: 1,
    };
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      orgId,
      ...getProjectAccessWhere({ userId, role }),
    },
    select,
  });

  if (!project) {
    await throwProjectNotFoundOrAccessDenied({ orgId, projectId });
  }

  return {
    id: project.id,
    orgId: project.orgId,
    role: project.assignments?.[0]?.role || role,
  };
};

module.exports = {
  PROJECT_ACCESS_DENIED_CODE,
  PROJECT_ACCESS_DENIED_MESSAGE,
  assertProjectAccess,
  canAccessAllProjects,
  getProjectAccessWhere,
  throwProjectNotFoundOrAccessDenied,
};
