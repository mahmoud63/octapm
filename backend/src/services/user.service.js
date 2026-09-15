const { createHash, randomBytes } = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const { sendEmail, templates } = require("./email.service");
const companyPartyService = require("./company-party.service");

// every role the permission policy knows (shared/permissions.json) — one list, kept there
const ALLOWED_ROLES = require("../config/permissions").ALL_ROLES;

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  isCompanyAdmin: Boolean(user.isCompanyAdmin),
  status: user.status,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  projectCount: user._count?.projectAssignments ?? 0,
});

const ROLE_LABELS = new Map([
  ["pm", "Project Manager"],
  ["planning_eng", "Planning Engineer"],
  ["qs", "QS"],
  ["cost_controller", "Cost Controller"],
  ["procurement", "Procurement"],
  ["warehouse", "Warehouse"],
  ["site_engineer", "Site Engineer"],
  ["quality_engineer", "Quality Engineer"],
  ["finance", "Finance"],
]);

const normalizeEmail = (email) => email.trim().toLowerCase();

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createAccountToken = () => randomBytes(32).toString("base64url");

const hashAccountToken = (token) =>
  createHash("sha256").update(token).digest("hex");

const getInvitationExpiresAt = () =>
  new Date(
    Date.now() +
      readPositiveInt(process.env.INVITATION_TOKEN_DAYS, 7) *
        24 *
        60 *
        60 *
        1000,
  );

const getWebAppBaseUrl = () =>
  (
    process.env.WEB_APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    "http://localhost:5173"
  ).replace(/\/$/, "");

const buildAcceptInvitationUrl = (token) => {
  const url = new URL("/accept-invite", `${getWebAppBaseUrl()}/`);
  url.searchParams.set("token", token);
  return url.toString();
};

const recordAuthAuditEvent = async ({
  tx = prisma,
  orgId,
  projectId = null,
  userId = null,
  actorId = null,
  actorRole = null,
  entityType,
  entityId = null,
  action,
  email = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
}) => {
  if (!tx.authAuditEvent?.create) {
    return null;
  }

  return tx.authAuditEvent.create({
    data: {
      orgId,
      projectId,
      userId,
      actorId,
      actorRole,
      entityType,
      entityId,
      action,
      email,
      ipAddress,
      userAgent,
      metadataJson: metadata,
    },
  });
};

const sanitizeInvitation = (invitation) => ({
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  projectId: invitation.projectId,
  companyId: invitation.companyId ?? null,
  projectPartyId: invitation.projectPartyId ?? null,
  invitedById: invitation.invitedById,
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
});

const listUsers = async ({ orgId, query }) => {
  const take = 20;
  const where = { orgId };

  if (query.status) where.status = query.status;
  if (query.role) where.role = query.role;

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
      { phone: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const SORT_FIELDS = {
    name: { name: "asc" },
    email: { email: "asc" },
    projects: { projectAssignments: { _count: "desc" } },
    created: { createdAt: "desc" },
  };
  const sortKey = SORT_FIELDS[query.sortBy] ? query.sortBy : "created";
  let orderBy = SORT_FIELDS[sortKey];
  if (
    query.sortDir === "desc" &&
    sortKey !== "projects" &&
    sortKey !== "created"
  ) {
    orderBy = { [sortKey]: "desc" };
  }
  if (
    query.sortDir === "asc" &&
    (sortKey === "projects" || sortKey === "created")
  ) {
    orderBy =
      sortKey === "projects"
        ? { projectAssignments: { _count: "asc" } }
        : { createdAt: "asc" };
  }

  const users = await prisma.user.findMany({
    where,
    take: take + 1,
    include: { _count: { select: { projectAssignments: true } } },
    orderBy,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  let nextCursor = null;
  if (users.length > take) {
    users.pop();
  // The cursor is the last row we actually returned, not the look-ahead row.
  // Prisma's `cursor` is inclusive and `skip: 1` steps over it, so handing
  // back the look-ahead id meant the next page began *after* it and that row
  // was returned by no page at all — one record lost per page boundary,
  // silently (OCTA-API-PAGING-110).
    nextCursor = users[users.length - 1].id;
  }

  return {
    items: users.map(sanitizeUser),
    pagination: { limit: take, nextCursor },
  };
};

const createUser = async ({ orgId, payload }) => {
  const existing = await prisma.user.findUnique({
    where: { email: payload.email },
  });
  if (existing) {
    throw new HttpError(409, "EMAIL_EXISTS", "Email already exists");
  }

  const role =
    payload.role && ALLOWED_ROLES.includes(payload.role)
      ? payload.role
      : "site_engineer";

  const passwordHash = await bcrypt.hash(payload.password, 12);

  const user = await prisma.user.create({
    data: {
      orgId,
      name: payload.name,
      email: payload.email,
      phone: payload.phone ?? null,
      passwordHash,
      role,
      status: "active",
    },
    include: { _count: { select: { projectAssignments: true } } },
  });

  return sanitizeUser(user);
};

const getUserById = async ({ orgId, userId }) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId },
    include: { _count: { select: { projectAssignments: true } } },
  });

  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  return sanitizeUser(user);
};

const deactivateUser = async ({ orgId, userId }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  if (user.status === "inactive") {
    throw new HttpError(400, "ALREADY_INACTIVE", "User is already inactive");
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { status: "inactive" },
      include: { _count: { select: { projectAssignments: true } } },
    }),
    prisma.projectAssignment.deleteMany({ where: { userId } }),
    prisma.activityAssignment.deleteMany({ where: { userId } }),
  ]);

  return sanitizeUser(updated);
};

const activateUser = async ({ orgId, userId }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  if (user.status === "active") {
    throw new HttpError(400, "ALREADY_ACTIVE", "User is already active");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: "active" },
    include: { _count: { select: { projectAssignments: true } } },
  });

  return sanitizeUser(updated);
};

const updateUser = async ({ orgId, userId, payload }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");

  const data = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.phone !== undefined) data.phone = payload.phone || null;

  if (payload.email !== undefined) {
    const normalized = payload.email.trim().toLowerCase();
    if (normalized !== user.email) {
      const clash = await prisma.user.findUnique({
        where: { email: normalized },
      });
      if (clash)
        throw new HttpError(409, "EMAIL_EXISTS", "Email already exists");
      data.email = normalized;
    }
  }

  if (payload.role !== undefined) {
    if (!ALLOWED_ROLES.includes(payload.role)) {
      throw new HttpError(400, "INVALID_ROLE", "Role is invalid");
    }
    data.role = payload.role;
  }

  if (payload.isCompanyAdmin !== undefined) {
    data.isCompanyAdmin = Boolean(payload.isCompanyAdmin);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    include: { _count: { select: { projectAssignments: true } } },
  });

  return sanitizeUser(updated);
};

const resetPassword = async ({
  orgId,
  userId,
  newPassword,
  actor = null,
  context = {},
}) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.refreshSession?.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAuthAuditEvent({
      tx,
      orgId,
      userId,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      entityType: "password_reset",
      entityId: userId,
      action: "password_reset_admin_completed",
      email: user.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return { id: user.id, reset: true };
};

const inviteUser = async ({ orgId, actor, payload, context = {} }) => {
  const email = normalizeEmail(payload.email);
  const role = ALLOWED_ROLES.includes(payload.role)
    ? payload.role
    : "site_engineer";
  let projectId = payload.projectId || null;
  let companyId = payload.companyId || null;
  const projectPartyId = payload.projectPartyId || null;
  const note = payload.note?.trim() || null;

  let projectParty = null;
  if (projectPartyId) {
    if (!projectId) {
      throw new HttpError(
        400,
        "PROJECT_PARTY_PROJECT_REQUIRED",
        "projectId is required when inviting a project party user",
      );
    }
    projectParty = await companyPartyService.getProjectPartyForInvitation({
      orgId,
      projectId,
      partyId: projectPartyId,
    });
    companyId = projectParty.companyId;
  }

  const [org, project, company, existingUser] = await Promise.all([
    prisma.organisation.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    }),
    projectId
      ? prisma.project.findFirst({
          where: { id: projectId, orgId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    companyId
      ? prisma.company.findFirst({
          where: { id: companyId, orgId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    prisma.user.findUnique({ where: { email } }),
  ]);

  if (!org) {
    throw new HttpError(404, "ORG_NOT_FOUND", "Organization not found");
  }

  if (projectId && !project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  if (companyId && !company) {
    throw new HttpError(404, "COMPANY_NOT_FOUND", "Company not found");
  }

  if (existingUser && existingUser.orgId !== orgId) {
    throw new HttpError(
      409,
      "INVITATION_EMAIL_IN_OTHER_ORG",
      "Email is already registered to another organization",
    );
  }

  const rawToken = createAccountToken();
  const expiresAt = getInvitationExpiresAt();
  const now = new Date();

  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitationToken.updateMany({
      where: {
        orgId,
        email,
        status: "pending",
        acceptedAt: null,
        revokedAt: null,
      },
      data: {
        status: "revoked",
        revokedAt: now,
      },
    });

    const created = await tx.invitationToken.create({
      data: {
        orgId,
        projectId,
        companyId,
        projectPartyId,
        email,
        role,
        tokenHash: hashAccountToken(rawToken),
        note,
        invitedById: actor?.id || null,
        userAgent: context.userAgent || null,
        ipAddress: context.ipAddress || null,
        expiresAt,
      },
    });

    await recordAuthAuditEvent({
      tx,
      orgId,
      projectId,
      userId: existingUser?.id || null,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      entityType: "invitation",
      entityId: created.id,
      action: "invitation_created",
      email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        role,
        projectId,
        companyId,
        projectPartyId,
        existingUser: Boolean(existingUser),
        expiresAt,
      },
    });

    if (projectId) {
      await auditService.recordEvent({
        tx,
        orgId,
        projectId,
        entityType: "user_invitation",
        entityId: created.id,
        action: auditService.ACTIONS.CREATED,
        actorId: actor?.id || null,
        actorRole: actor?.role || null,
        summary: {
          email,
          role,
          projectId,
          companyId,
          projectPartyId,
          status: "pending",
        },
        metadata: {
          expiresAt,
          existingUser: Boolean(existingUser),
          companyName: company?.name || null,
          projectPartyRole: projectParty?.role || null,
        },
      });
    }

    return created;
  });

  const acceptUrl = buildAcceptInvitationUrl(rawToken);
  const template = templates.invitation({
    orgName: org.name,
    inviterName: actor?.name || actor?.email || null,
    acceptUrl,
    role: ROLE_LABELS.get(role) || role,
    projectName: project?.name || null,
    note,
    expiresAt: invitation.expiresAt,
  });

  await sendEmail({
    to: email,
    ...template,
    metadata: {
      orgId,
      projectId,
      companyId,
      projectPartyId,
      invitationId: invitation.id,
      type: "invitation",
    },
  });

  return sanitizeInvitation(invitation);
};

module.exports = {
  listUsers,
  createUser,
  inviteUser,
  ALLOWED_ROLES,
  getUserById,
  updateUser,
  resetPassword,
  deactivateUser,
  activateUser,
};
