const { prisma } = require('../config/db');
const { normalizePartyRoleId, normalizeRoleId } = require('../config/permissions');
const { HttpError } = require('../utils/http-error');

const PROJECT_ACCESS_DENIED_CODE = 'PROJECT_ACCESS_DENIED';
const PROJECT_ACCESS_DENIED_MESSAGE = 'You are not assigned to this project';
const ORG_WIDE_PROJECT_ACCESS_ROLES = new Set(['pm', 'super_admin']);

const canAccessAllProjects = (role) =>
  ORG_WIDE_PROJECT_ACCESS_ROLES.has(normalizeRoleId(role));

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
    OR: [
      {
        assignments: {
          some: {
            userId,
          },
        },
      },
      {
        parties: {
          some: {
            status: 'active',
            members: {
              some: {
                userId,
                status: 'active',
              },
            },
          },
        },
      },
    ],
  };
};

const projectPartyAccessSelect = (userId) => ({
  where: {
    status: 'active',
    members: {
      some: {
        userId,
        status: 'active',
      },
    },
  },
  select: {
    id: true,
    companyId: true,
    role: true,
    accessLevel: true,
    permissionProfile: true,
    company: {
      select: {
        id: true,
        name: true,
        status: true,
      },
    },
    members: {
      where: {
        userId,
        status: 'active',
      },
      select: {
        id: true,
        role: true,
        status: true,
      },
      take: 1,
    },
  },
});

const serializePartyAccess = (parties = []) =>
  parties.map((party) => ({
    projectPartyId: party.id,
    companyId: party.companyId,
    companyName: party.company?.name || null,
    role: normalizePartyRoleId(party.role),
    accessLevel: party.accessLevel || 'collaborator',
    permissionProfile: party.permissionProfile || null,
    memberRole: party.members?.[0]?.role || null,
  }));

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
    select.parties = projectPartyAccessSelect(userId);
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

  const assignmentRole = normalizeRoleId(project.assignments?.[0]?.role) || null;
  const partyAccess = serializePartyAccess(project.parties);

  return {
    id: project.id,
    orgId: project.orgId,
    role: assignmentRole || (partyAccess.length ? 'external_party' : normalizeRoleId(role)),
    assignmentRole,
    partyAccess,
    scope: assignmentRole
      ? 'assignment'
      : partyAccess.length
        ? 'party'
        : 'org',
  };
};

module.exports = {
  PROJECT_ACCESS_DENIED_CODE,
  PROJECT_ACCESS_DENIED_MESSAGE,
  assertProjectAccess,
  canAccessAllProjects,
  getProjectAccessWhere,
  projectPartyAccessSelect,
  serializePartyAccess,
  throwProjectNotFoundOrAccessDenied,
};
