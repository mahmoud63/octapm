const { prisma } = require("../config/db");
const {
  getPartyPermissionProfile,
  normalizePartyRoleId,
} = require("../config/permissions");
const { HttpError } = require("../utils/http-error");

const PARTY_ROLES = ["owner", "consultant", "contractor", "subcontractor"];
const ACCESS_LEVELS = ["read_only", "collaborator", "reviewer", "admin"];

const LEGACY_PROJECT_FIELDS = {
  owner: "clientName",
  consultant: "consultantName",
  contractor: "contractorName",
};

const trimToNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const normalizeStatus = (value, fallback = "active") =>
  trimToNull(value) || fallback;

const normalizeRole = (value) => {
  const role = normalizePartyRoleId(value);
  if (!PARTY_ROLES.includes(role)) {
    throw new HttpError(
      400,
      "INVALID_PROJECT_PARTY_ROLE",
      "Project party role is invalid",
    );
  }
  return role;
};

const normalizeAccessLevel = (value) => {
  const level = trimToNull(value) || "collaborator";
  if (!ACCESS_LEVELS.includes(level)) {
    throw new HttpError(
      400,
      "INVALID_PROJECT_PARTY_ACCESS_LEVEL",
      "Project party access level is invalid",
    );
  }
  return level;
};

const getDefaultPermissionProfile = (role) => `default_${role}`;

const sanitizeCompany = (company) => ({
  id: company.id,
  orgId: company.orgId,
  name: company.name,
  legalName: company.legalName ?? null,
  tradeName: company.tradeName ?? null,
  registrationNumber: company.registrationNumber ?? null,
  taxNumber: company.taxNumber ?? null,
  type: company.type,
  email: company.email ?? null,
  phone: company.phone ?? null,
  website: company.website ?? null,
  address: company.address ?? null,
  status: company.status,
  createdAt: company.createdAt,
  updatedAt: company.updatedAt,
});

const sanitizeMember = (member) => ({
  id: member.id,
  userId: member.userId,
  companyMembershipId: member.companyMembershipId ?? null,
  role: member.role,
  status: member.status,
  invitedAt: member.invitedAt ?? null,
  acceptedAt: member.acceptedAt ?? null,
  user: member.user
    ? {
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        role: member.user.role,
        status: member.user.status,
      }
    : null,
});

const sanitizeProjectParty = (party) => ({
  id: party.id,
  projectId: party.projectId,
  companyId: party.companyId,
  role: party.role,
  roleLabel: party.role
    ? party.role.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
    : null,
  contactName: party.contactName ?? null,
  contactEmail: party.contactEmail ?? null,
  contactPhone: party.contactPhone ?? null,
  accessLevel: party.accessLevel,
  permissionProfile: party.permissionProfile ?? getDefaultPermissionProfile(party.role),
  permissionPolicy: getPartyPermissionProfile(party.role),
  permissionTemplateId: party.permissionTemplateId ?? null,
  permissionTemplate: party.permissionTemplate
    ? { id: party.permissionTemplate.id, name: party.permissionTemplate.name }
    : null,
  status: party.status,
  company: party.company ? sanitizeCompany(party.company) : null,
  members: (party.members || []).map(sanitizeMember),
  createdAt: party.createdAt,
  updatedAt: party.updatedAt,
});

const ensureProject = async ({ tx = prisma, orgId, projectId }) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, orgId: true },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return project;
};

const buildCompanyData = (orgId, payload = {}) => ({
  orgId,
  name: trimToNull(payload.name || payload.companyName),
  legalName: trimToNull(payload.legalName),
  tradeName: trimToNull(payload.tradeName),
  registrationNumber: trimToNull(payload.registrationNumber),
  taxNumber: trimToNull(payload.taxNumber),
  type: trimToNull(payload.type) || "external",
  email: trimToNull(payload.email),
  phone: trimToNull(payload.phone),
  website: trimToNull(payload.website),
  address: trimToNull(payload.address),
  status: normalizeStatus(payload.status),
});

const ensureCompany = async ({ tx = prisma, orgId, payload = {} }) => {
  if (payload.companyId) {
    const company = await tx.company.findFirst({
      where: { id: payload.companyId, orgId },
    });
    if (!company) {
      throw new HttpError(404, "COMPANY_NOT_FOUND", "Company not found");
    }
    return company;
  }

  const data = buildCompanyData(orgId, payload);
  if (!data.name) {
    throw new HttpError(
      400,
      "COMPANY_REQUIRED",
      "A companyId or companyName is required",
    );
  }

  const existing = await tx.company.findFirst({
    where: { orgId, name: data.name },
  });
  if (existing) return existing;

  return tx.company.create({ data });
};

const listCompanies = async ({ orgId, query = {} }) => {
  const take = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const where = { orgId };
  if (query.status) where.status = query.status;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { legalName: { contains: query.search, mode: "insensitive" } },
      { tradeName: { contains: query.search, mode: "insensitive" } },
      { registrationNumber: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const companies = await prisma.company.findMany({
    where,
    take: take + 1,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  let nextCursor = null;
  if (companies.length > take) {
    companies.pop();
  // The cursor is the last row we actually returned, not the look-ahead row.
  // Prisma's `cursor` is inclusive and `skip: 1` steps over it, so handing
  // back the look-ahead id meant the next page began *after* it and that row
  // was returned by no page at all — one record lost per page boundary,
  // silently (OCTA-API-PAGING-110).
    nextCursor = companies[companies.length - 1].id;
  }

  return {
    items: companies.map(sanitizeCompany),
    pagination: { limit: take, nextCursor },
  };
};

const createCompany = async ({ orgId, payload }) => {
  const data = buildCompanyData(orgId, payload);
  if (!data.name) {
    throw new HttpError(400, "COMPANY_NAME_REQUIRED", "Company name is required");
  }

  const existing = await prisma.company.findFirst({
    where: { orgId, name: data.name },
  });
  if (existing) {
    throw new HttpError(409, "COMPANY_EXISTS", "Company already exists");
  }

  const company = await prisma.company.create({ data });
  return sanitizeCompany(company);
};

/**
 * Edit a company in the directory (Phase 22B). Only the fields sent change;
 * the name stays unique within the organisation; parties, vendors, bids and
 * commitments that reference the company keep their link.
 */
const updateCompany = async ({ orgId, companyId, payload = {} }) => {
  const existing = await prisma.company.findFirst({ where: { id: companyId, orgId } });
  if (!existing) throw new HttpError(404, "COMPANY_NOT_FOUND", "Company not found");
  const built = buildCompanyData(orgId, payload);
  const data = {};
  for (const key of ["name", "legalName", "tradeName", "registrationNumber", "taxNumber", "type", "email", "phone", "website", "address", "status"]) {
    if (payload[key] !== undefined) data[key] = built[key];
  }
  if (data.name === null) throw new HttpError(400, "COMPANY_NAME_REQUIRED", "Company name is required");
  if (data.name && data.name !== existing.name) {
    const clash = await prisma.company.findFirst({ where: { orgId, name: data.name, id: { not: companyId } } });
    if (clash) throw new HttpError(409, "COMPANY_EXISTS", "Another company already has this name");
  }
  const company = await prisma.company.update({ where: { id: companyId }, data });
  return sanitizeCompany(company);
};

const projectPartyInclude = {
  company: true,
  permissionTemplate: { select: { id: true, name: true } },
  members: {
    where: { status: "active" },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  },
};

const listProjectParties = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });

  const where = { projectId };
  if (query.role && query.role !== "all") where.role = normalizeRole(query.role);
  if (query.status && query.status !== "all") where.status = query.status;
  else where.status = "active";

  const parties = await prisma.projectParty.findMany({
    where,
    include: projectPartyInclude,
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return { items: parties.map(sanitizeProjectParty) };
};

const updateLegacyPartyNames = async ({ tx = prisma, projectId }) => {
  const parties = await tx.projectParty.findMany({
    where: {
      projectId,
      status: "active",
      role: { in: Object.keys(LEGACY_PROJECT_FIELDS) },
    },
    include: { company: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  const data = {
    clientName: null,
    consultantName: null,
    contractorName: null,
  };

  for (const party of parties) {
    const field = LEGACY_PROJECT_FIELDS[party.role];
    if (field && !data[field]) {
      data[field] = party.company?.name || null;
    }
  }

  await tx.project.update({
    where: { id: projectId },
    data,
  });

  return data;
};

const upsertProjectPartyWithTx = async ({
  tx = prisma,
  orgId,
  projectId,
  payload,
}) => {
  await ensureProject({ tx, orgId, projectId });
  // The party is locked before it is read, so an edit is judged — and
  // written — against the party as it is, not as it was before a concurrent
  // closure: a stale read written back would reopen a party someone just
  // closed, even while the emergency switch is off (D-ID-1 Q10).
  const canLock = tx !== prisma && typeof tx.$queryRaw === "function";
  if (payload.partyId && canLock) {
    await tx.$queryRaw`SELECT "id" FROM "ProjectParty" WHERE "id" = ${payload.partyId} AND "projectId" = ${projectId} FOR UPDATE`;
  }
  const existingById = payload.partyId
    ? await assertProjectParty({
        tx,
        orgId,
        projectId,
        partyId: payload.partyId,
      })
    : null;
  const role = payload.role ? normalizeRole(payload.role) : existingById?.role;
  if (!role) {
    throw new HttpError(
      400,
      "INVALID_PROJECT_PARTY_ROLE",
      "Project party role is required",
    );
  }
  const hasCompanyPayload =
    payload.companyId || payload.companyName || payload.name;
  const company = hasCompanyPayload
    ? await ensureCompany({ tx, orgId, payload })
    : existingById?.company;
  if (!company) {
    throw new HttpError(
      400,
      "COMPANY_REQUIRED",
      "A companyId or companyName is required",
    );
  }
  const accessLevel = normalizeAccessLevel(
    payload.accessLevel ?? existingById?.accessLevel,
  );

  if (canLock) {
    await tx.$queryRaw`SELECT "id" FROM "ProjectParty" WHERE "projectId" = ${projectId} AND "companyId" = ${company.id} AND "role"::text = ${role} FOR UPDATE`;
  }
  const existing = await tx.projectParty.findFirst({
    where: { projectId, companyId: company.id, role },
  });

  const data = {
    contactName:
      payload.contactName !== undefined
        ? trimToNull(payload.contactName)
        : existingById?.contactName ?? null,
    contactEmail:
      payload.contactEmail !== undefined
        ? trimToNull(payload.contactEmail)
        : existingById?.contactEmail ?? null,
    contactPhone:
      payload.contactPhone !== undefined
        ? trimToNull(payload.contactPhone)
        : existingById?.contactPhone ?? null,
    accessLevel,
    permissionProfile:
      payload.permissionProfile !== undefined
        ? trimToNull(payload.permissionProfile) || getDefaultPermissionProfile(role)
        : existingById?.permissionProfile || getDefaultPermissionProfile(role),
    permissionsJson:
      payload.permissions || payload.permissionsJson || existingById?.permissionsJson || {},
    status: normalizeStatus(payload.status, existingById?.status || "active"),
  };
  // Permission template (OCTA-ADM-PERM-003): applied to every member of the party.
  if (payload.permissionTemplateId !== undefined) {
    const permissionTemplateId = trimToNull(payload.permissionTemplateId);
    if (permissionTemplateId && tx.permissionTemplate?.findFirst) {
      const template = await tx.permissionTemplate.findFirst({
        where: { id: permissionTemplateId, orgId },
        select: { id: true },
      });
      if (!template) {
        throw new HttpError(
          404,
          "PERMISSION_TEMPLATE_NOT_FOUND",
          "Permission template not found",
        );
      }
    }
    data.permissionTemplateId = permissionTemplateId;
  }

  // While the emergency membership switch is off, a party's members get no
  // more than they have (owner decision D-ID-1 Q10): a change to what the
  // party may do — its role, access level, permission profile, permissions or
  // template — or bringing an inactive party back is refused. Closing a party,
  // or editing its contact details, still works.
  const current = existingById || existing;
  if (current && !require("./membership.service").isMembershipWriteEnabled()) {
    const differs = (a, b) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
    const widens =
      role !== current.role ||
      differs(data.accessLevel, current.accessLevel) ||
      differs(data.permissionProfile, current.permissionProfile) ||
      differs(data.permissionsJson, current.permissionsJson) ||
      (data.permissionTemplateId !== undefined && differs(data.permissionTemplateId, current.permissionTemplateId)) ||
      (payload.partyId && company.id !== current.companyId) ||
      (data.status === "active" && current.status !== "active");
    if (widens) require("./membership.service").assertAccessExpansionAllowed();
  }

  if (payload.partyId) {
    return tx.projectParty.update({
      where: { id: payload.partyId },
      data: {
        companyId: company.id,
        role,
        ...data,
      },
      include: projectPartyInclude,
    });
  }

  if (existing) {
    return tx.projectParty.update({
      where: { id: existing.id },
      data,
      include: projectPartyInclude,
    });
  }

  return tx.projectParty.create({
    data: {
      projectId,
      companyId: company.id,
      role,
      ...data,
    },
    include: projectPartyInclude,
  });
};

const upsertProjectParty = async ({ orgId, projectId, payload }) => {
  const party = await prisma.$transaction(async (tx) => {
    const row = await upsertProjectPartyWithTx({
      tx,
      orgId,
      projectId,
      payload,
    });
    await updateLegacyPartyNames({ tx, projectId });
    return row;
  });

  return sanitizeProjectParty(party);
};

const removeProjectParty = async ({ orgId, projectId, partyId }) => {
  await ensureProject({ orgId, projectId });

  const party = await prisma.projectParty.findFirst({
    where: { id: partyId, projectId },
  });

  if (!party) {
    throw new HttpError(
      404,
      "PROJECT_PARTY_NOT_FOUND",
      "Project party not found",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    // The party row first, then its members: the order invitation acceptance
    // takes them in (assertPartyOffer), so the two never wait on each other.
    if (typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT "id" FROM "ProjectParty" WHERE "id" = ${partyId} FOR UPDATE`;
    }
    await tx.projectPartyMember.updateMany({
      where: { projectPartyId: partyId, status: "active" },
      data: { status: "inactive" },
    });
    const row = await tx.projectParty.update({
      where: { id: partyId },
      data: { status: "inactive" },
      include: projectPartyInclude,
    });
    await updateLegacyPartyNames({ tx, projectId });
    return row;
  });

  return sanitizeProjectParty(updated);
};

const normalizeSyncEntries = (parties) => {
  if (!parties) return null;
  if (Array.isArray(parties)) return parties;

  const entries = [];
  for (const role of ["owner", "consultant", "contractor"]) {
    if (Object.prototype.hasOwnProperty.call(parties, role)) {
      entries.push({ role, ...(parties[role] || {}), clear: !parties[role] });
    }
  }
  if (Array.isArray(parties.subcontractors)) {
    entries.push(
      ...parties.subcontractors.map((entry) => ({
        role: "subcontractor",
        ...entry,
      })),
    );
  }
  return entries;
};

const syncProjectParties = async ({
  tx = prisma,
  orgId,
  projectId,
  parties,
}) => {
  const entries = normalizeSyncEntries(parties);
  if (!entries) return [];

  const results = [];
  for (const entry of entries) {
    const role = normalizeRole(entry.role);
    const isClear =
      entry.clear ||
      (!trimToNull(entry.companyId) && !trimToNull(entry.companyName || entry.name));

    if (isClear) {
      if (role !== "subcontractor") {
        await tx.projectParty.updateMany({
          where: { projectId, role, status: "active" },
          data: { status: "inactive" },
        });
      }
      continue;
    }

    results.push(
      await upsertProjectPartyWithTx({
        tx,
        orgId,
        projectId,
        payload: {
          ...entry,
          role,
          companyName: entry.companyName || entry.name,
        },
      }),
    );
  }

  await updateLegacyPartyNames({ tx, projectId });
  return results.map(sanitizeProjectParty);
};

const assertProjectParty = async ({ tx = prisma, orgId, projectId, partyId }) => {
  const party = await tx.projectParty.findFirst({
    where: {
      id: partyId,
      projectId,
      project: { orgId },
      status: "active",
    },
    include: { company: true },
  });

  if (!party) {
    throw new HttpError(
      404,
      "PROJECT_PARTY_NOT_FOUND",
      "Project party not found",
    );
  }

  return party;
};

const addProjectPartyMemberWithTx = async ({
  tx = prisma,
  orgId,
  projectId,
  partyId,
  userId,
  role = "member",
  invitedAt = null,
  acceptedAt = null,
}) => {
  // The person may belong to this workspace already, or be an identity from
  // another one joining as a guest (architecture doc §6): either way they
  // hold a membership here afterwards — a guest one when they had none, and
  // whatever they had otherwise (a member is never downgraded).
  const membershipService = require("./membership.service");
  // Inside a transaction the party row is locked first, in the order invitation
  // acceptance and party removal take it, so none of them wait on each other.
  if (tx !== prisma && typeof tx.$queryRaw === "function") {
    await tx.$queryRaw`SELECT "id" FROM "ProjectParty" WHERE "id" = ${partyId} FOR UPDATE`;
  }
  const [party, user] = await Promise.all([
    assertProjectParty({ tx, orgId, projectId, partyId }),
    membershipService.findUserInOrg({ tx, orgId, userId }),
  ]);

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  }

  const ensured = await membershipService.ensureMembership({
    tx,
    orgId,
    userId,
    role: membershipService.GUEST_ROLE,
    kind: membershipService.MEMBERSHIP_KINDS.GUEST,
    joinedAt: acceptedAt || new Date(),
  });
  if (ensured?.created) {
    await membershipService.recordMembershipEvent({
      tx,
      orgId,
      membership: ensured.membership,
      action: "membership.created",
      metadata: { kind: "guest", projectId, projectPartyId: partyId },
    });
  }

  const companyMembership = await tx.companyMembership.upsert({
    where: {
      companyId_userId: {
        companyId: party.companyId,
        userId,
      },
    },
    create: {
      orgId,
      companyId: party.companyId,
      userId,
      role,
      status: "active",
    },
    update: {
      role,
      status: "active",
    },
  });

  return tx.projectPartyMember.upsert({
    where: {
      projectPartyId_userId: {
        projectPartyId: partyId,
        userId,
      },
    },
    create: {
      projectPartyId: partyId,
      userId,
      companyMembershipId: companyMembership.id,
      role,
      status: "active",
      invitedAt,
      acceptedAt,
    },
    update: {
      companyMembershipId: companyMembership.id,
      role,
      status: "active",
      acceptedAt,
    },
  });
};

const addProjectPartyMember = async ({ orgId, projectId, partyId, payload }) => {
  // Widens access: refused while the emergency membership switch is off (D-ID-1 Q10).
  require("./membership.service").assertAccessExpansionAllowed();
  const member = await prisma.$transaction((tx) =>
    addProjectPartyMemberWithTx({
      tx,
      orgId,
      projectId,
      partyId,
      userId: payload.userId,
      role: payload.role || "member",
      invitedAt: payload.invitedAt ? new Date(payload.invitedAt) : null,
      acceptedAt: payload.acceptedAt ? new Date(payload.acceptedAt) : null,
    }),
  );

  return { id: member.id, status: member.status };
};

const removeProjectPartyMember = async ({ orgId, projectId, partyId, userId }) => {
  await assertProjectParty({ orgId, projectId, partyId });

  const updated = await prisma.projectPartyMember.updateMany({
    where: { projectPartyId: partyId, userId },
    data: { status: "inactive" },
  });

  if (!updated.count) {
    throw new HttpError(
      404,
      "PROJECT_PARTY_MEMBER_NOT_FOUND",
      "Project party member not found",
    );
  }

  return { projectPartyId: partyId, userId, status: "inactive" };
};

const getProjectPartyForInvitation = async ({ orgId, projectId, partyId }) =>
  assertProjectParty({ orgId, projectId, partyId });

/**
 * The party a party invitation offered is still the one acceptance would
 * join: active, on the invitation's project, and of the company the
 * invitation named. A party moved to another company since (or closed)
 * would otherwise take the person somewhere they were never offered
 * (certification L38, review A7): refused, and a new invitation is needed.
 */
const assertPartyOffer = async ({ tx = prisma, invitation }) => {
  if (!invitation?.projectPartyId) return;
  // Inside the acceptance transaction the party row is locked first, so a
  // party edit cannot move it to another company between this check and the
  // assignment that follows (it waits for the acceptance to commit).
  if (tx !== prisma && typeof tx.$queryRaw === "function") {
    await tx.$queryRaw`SELECT "id" FROM "ProjectParty" WHERE "id" = ${invitation.projectPartyId} FOR UPDATE`;
  }
  const party = await tx.projectParty.findFirst({
    where: { id: invitation.projectPartyId, projectId: invitation.projectId || undefined, project: { orgId: invitation.orgId }, status: "active" },
    select: { companyId: true },
  });
  if (!invitation.projectId || !party || (invitation.companyId && party.companyId !== invitation.companyId)) {
    throw new HttpError(409, "INVITATION_OFFER_CHANGED", "This invitation no longer matches its project party; ask for a new invitation");
  }
};

const acceptProjectPartyInvitation = async ({ tx, invitation, user }) => {
  if (!invitation.projectPartyId && !invitation.companyId) return null;

  const projectPartyId = invitation.projectPartyId || null;
  const projectId = invitation.projectId || null;
  const orgId = invitation.orgId;

  if (projectPartyId && projectId) {
    await assertPartyOffer({ tx, invitation });
    const member = await addProjectPartyMemberWithTx({
      tx,
      orgId,
      projectId,
      partyId: projectPartyId,
      userId: user.id,
      role: "member",
      invitedAt: invitation.createdAt || null,
      acceptedAt: new Date(),
    });
    // A consultant invitation carries the reviewer's details and the access the contractor chose (CONSULTANT V1).
    await require("./consultant.service").applyInvitationDetails({ tx, invitation, userId: user.id });
    return member;
  }

  if (invitation.companyId) {
    return tx.companyMembership.upsert({
      where: {
        companyId_userId: {
          companyId: invitation.companyId,
          userId: user.id,
        },
      },
      create: {
        orgId,
        companyId: invitation.companyId,
        userId: user.id,
        role: "member",
        status: "active",
      },
      update: {
        status: "active",
      },
    });
  }

  return null;
};

const normalizeProjectAccess = (projectAccess) => projectAccess || {};

const getPartyIdsFromProjectAccess = (projectAccess = {}) =>
  (normalizeProjectAccess(projectAccess).partyAccess || [])
    .map((party) => party.projectPartyId)
    .filter(Boolean);

const isPartyScopedAccess = (projectAccess = {}) => {
  const access = normalizeProjectAccess(projectAccess);
  return (
    access.scope === "party" ||
    (!access.assignmentRole && getPartyIdsFromProjectAccess(access).length > 0)
  );
};

const withDefaultOwnerParty = (payload = {}, projectAccess = {}) => {
  if (!isPartyScopedAccess(projectAccess)) return payload;
  if (
    payload.ownerPartyId ||
    payload.reviewerPartyId ||
    payload.approverPartyId
  ) {
    return payload;
  }

  const ownerPartyId = getPartyIdsFromProjectAccess(projectAccess)[0];
  return ownerPartyId ? { ...payload, ownerPartyId } : payload;
};

const applyPartyWorkflowVisibility = (where, projectAccess = {}) => {
  if (!isPartyScopedAccess(projectAccess)) return where;
  const partyIds = getPartyIdsFromProjectAccess(projectAccess);
  if (!partyIds.length) {
    where.id = "__no_party_access__";
    return where;
  }

  const partyVisibility = {
    OR: [
      { ownerPartyId: { in: partyIds } },
      { reviewerPartyId: { in: partyIds } },
      { approverPartyId: { in: partyIds } },
    ],
  };

  if (where.OR) {
    where.AND = [...(where.AND || []), { OR: where.OR }, partyVisibility];
    delete where.OR;
  } else {
    where.AND = [...(where.AND || []), partyVisibility];
  }

  return where;
};

const assertPartyWorkflowAccess = ({ projectAccess = {}, record }) => {
  if (!isPartyScopedAccess(projectAccess)) return;

  const partyIds = new Set(getPartyIdsFromProjectAccess(projectAccess));
  const routedIds = [
    record.ownerPartyId,
    record.reviewerPartyId,
    record.approverPartyId,
  ].filter(Boolean);

  if (!routedIds.length) {
    throw new HttpError(
      403,
      "PROJECT_PARTY_RECORD_ACCESS_DENIED",
      "This workflow record is not routed to your company",
    );
  }

  const hasMatch = routedIds.some((partyId) => partyIds.has(partyId));
  if (!hasMatch) {
    throw new HttpError(
      403,
      "PROJECT_PARTY_RECORD_ACCESS_DENIED",
      "This workflow record is routed to another company",
    );
  }
};

module.exports = {
  ACCESS_LEVELS,
  PARTY_ROLES,
  addProjectPartyMember,
  addProjectPartyMemberWithTx,
  updateCompany,
  applyPartyWorkflowVisibility,
  assertPartyWorkflowAccess,
  acceptProjectPartyInvitation,
  assertPartyOffer,
  createCompany,
  ensureCompany,
  getProjectPartyForInvitation,
  isPartyScopedAccess,
  listCompanies,
  listProjectParties,
  normalizeRole,
  removeProjectParty,
  removeProjectPartyMember,
  sanitizeCompany,
  sanitizeProjectParty,
  syncProjectParties,
  updateLegacyPartyNames,
  upsertProjectParty,
  upsertProjectPartyWithTx,
  withDefaultOwnerParty,
};
