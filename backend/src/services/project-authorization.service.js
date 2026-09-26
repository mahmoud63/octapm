const { prisma } = require('../config/db');
const { normalizePartyRoleId, normalizeRoleId } = require('../config/permissions');
const { HttpError } = require('../utils/http-error');

const PROJECT_ACCESS_DENIED_CODE = 'PROJECT_ACCESS_DENIED';
const PROJECT_ACCESS_DENIED_MESSAGE = 'You are not assigned to this project';
// `super_admin` is gone from this set: it was never in the catalogue and never
// assignable; workspace admins and owners carry the intent (membership doc §1).
const ORG_WIDE_PROJECT_ACCESS_ROLES = new Set(['pm']);

// Org-wide project visibility: the PM role, plus the workspace's admins and
// owners (membership isAdmin || isOwner) regardless of their functional role.
const canAccessAllProjects = (role, options = {}) =>
  Boolean(options?.isCompanyAdmin) ||
  ORG_WIDE_PROJECT_ACCESS_ROLES.has(normalizeRoleId(role));

const projectAccessDenied = () =>
  new HttpError(
    403,
    PROJECT_ACCESS_DENIED_CODE,
    PROJECT_ACCESS_DENIED_MESSAGE,
  );

const getProjectAccessWhere = ({ userId, role, isCompanyAdmin = false, orgId = null }) => {
  if (canAccessAllProjects(role, { isCompanyAdmin })) {
    return {};
  }

  if (!userId) {
    throw projectAccessDenied();
  }

  // An assignment counts only inside the workspace the token is for
  // (architecture doc §2.2) — redundant once the composite FK lands in M7,
  // kept as defence in depth. Rows written before the column existed carry
  // no orgId and keep counting until M7 fills and constrains them.
  const assignmentWhere = orgId
    ? { userId, OR: [{ orgId }, { orgId: null }] }
    : { userId };

  return {
    OR: [
      {
        assignments: {
          some: assignmentWhere,
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

const assertProjectAccess = async ({
  orgId,
  projectId,
  userId,
  role,
  isCompanyAdmin = false,
}) => {
  const select = {
    id: true,
    orgId: true,
  };

  const orgWide = canAccessAllProjects(role, { isCompanyAdmin });
  if (userId && (!orgWide || isCompanyAdmin)) {
    // Company admins still get their assignment/party context so templates
    // and party-scoped rules can apply to them.
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
      ...getProjectAccessWhere({ userId, role, isCompanyAdmin, orgId }),
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
    isCompanyAdmin: Boolean(isCompanyAdmin),
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
