const { createHash, randomBytes } = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const { sendEmail, templates } = require("./email.service");
const companyPartyService = require("./company-party.service");
const membershipService = require("./membership.service");

// every role the permission policy knows (shared/permissions.json) — one list, kept there
const ALLOWED_ROLES = require("../config/permissions").ALL_ROLES;

/**
 * The status a person shows in one workspace's user list: their identity
 * status while their membership is active; `inactive` once the membership is
 * suspended or left (the vocabulary the clients already use); `invited` for a
 * membership that is waiting on acceptance.
 */
const statusInWorkspace = (user, membership) => {
  if (!membership) return user.status;
  if (membership.status === membershipService.MEMBERSHIP_STATUSES.ACTIVE) return user.status;
  if (membership.status === membershipService.MEMBERSHIP_STATUSES.INVITED) return "invited";
  return "inactive";
};

/**
 * A user as this workspace sees them. With a membership, role and standing
 * are the membership's — the same person can be a QS here and a PM elsewhere.
 * Without one (a client that knows no memberships, or a row seeded before
 * the backfill) the User columns speak, as they always did.
 */
const sanitizeUser = (user, membership = user.memberships?.[0] || null) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: membership?.role ?? user.role,
  isCompanyAdmin: Boolean(membership ? membership.isAdmin || membership.isOwner : user.isCompanyAdmin),
  isOwner: Boolean(membership?.isOwner),
  status: statusInWorkspace(user, membership),
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

const withCount = { _count: { select: { projectAssignments: true } } };

/** The user row with its membership in this workspace beside it, when the client knows memberships. */
const membershipInclude = (orgId) =>
  membershipService.hasMembershipModel(prisma) && membershipService.isMembershipReadEnabled()
    ? { memberships: { where: { orgId }, take: 1 } }
    : {};

const findUserInOrg = ({ orgId, userId, tx = prisma }) =>
  membershipService.findUserInOrg({
    tx,
    orgId,
    userId,
    include: { ...withCount, ...membershipInclude(orgId) },
  });

const listUsers = async ({ orgId, query }) => {
  const take = 20;
  const membershipAware = membershipService.hasMembershipModel(prisma) && membershipService.isMembershipReadEnabled();
  // Everyone who belongs to this workspace: by membership, or by the User
  // column for rows seeded before memberships. The role filter looks at the
  // membership's role first, since that is the role this workspace sees.
  const where = { AND: [membershipService.userInOrgWhere({ tx: prisma, orgId })] };

  if (query.status) where.AND.push({ status: query.status });
  if (query.role) {
    where.AND.push(
      membershipAware
        ? { OR: [{ memberships: { some: { orgId, role: query.role } } }, { role: query.role, memberships: { none: { orgId } } }] }
        : { role: query.role },
    );
  }

  if (query.search) {
    where.AND.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
      ],
    });
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
    include: { ...withCount, ...membershipInclude(orgId) },
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
    items: users.map((user) => sanitizeUser(user)),
    pagination: { limit: take, nextCursor },
  };
};

/**
 * POST /users. A new email makes an identity and its membership. An email
 * that already names an identity gets a membership in this workspace instead
 * (membership doc §5) — the response says `existingIdentity: true`, the
 * password is ignored, and the identity's name and password are never
 * overwritten. An identity that is already in this workspace is refused as
 * before (409 EMAIL_EXISTS).
 */
const createUser = async ({ orgId, actor = null, payload, context = {} }) => {
  const email = normalizeEmail(payload.email);
  const existing = await prisma.user.findUnique({
    where: { email },
  });

  const role =
    payload.role && ALLOWED_ROLES.includes(payload.role)
      ? payload.role
      : "site_engineer";

  if (existing) {
    const membershipAware = membershipService.hasMembershipModel(prisma) && membershipService.isMembershipWriteEnabled();
    const membership = membershipAware ? await membershipService.findMembership({ tx: prisma, orgId, userId: existing.id }) : null;
    const alreadyHere = membership
      ? membership.status !== membershipService.MEMBERSHIP_STATUSES.LEFT
      : existing.orgId === orgId;
    if (!membershipAware || alreadyHere) {
      throw new HttpError(409, "EMAIL_EXISTS", "Email already exists");
    }
    if (existing.status !== "active") {
      throw new HttpError(403, "USER_INACTIVE", "This email belongs to a deactivated account");
    }

    const ensured = await prisma.$transaction(async (tx) => {
      const result = await membershipService.ensureMembership({
        tx,
        orgId,
        userId: existing.id,
        role,
        invitedById: actor?.id || null,
      });
      await membershipService.recordMembershipEvent({
        tx,
        orgId,
        membership: result.membership,
        action: "membership.created",
        actor,
        context,
        metadata: { role, existingIdentity: true },
      });
      return result;
    });
    const user = await prisma.user.findUnique({ where: { id: existing.id }, include: withCount });
    return { ...sanitizeUser(user, ensured.membership), existingIdentity: true };
  }

  if (!payload.password) {
    throw new HttpError(400, "VALIDATION_ERROR", "A password is required for a new account");
  }
  // Asked before the account exists: a personal workspace's one-member rule
  // (ENT-6) refuses the seat, and must not leave an identity behind with no
  // membership when it does.
  await membershipService.assertWorkspaceAcceptsMember({ tx: prisma, orgId });
  const passwordHash = await bcrypt.hash(payload.password, 12);

  // The identity and its seat in one transaction, as SSO provisioning and
  // invitation acceptance do: the check above is a fast refusal, but the
  // seat is decided under the organisation-row lock inside ensureMembership,
  // and a seat taken meanwhile (409) must roll the new identity back with it
  // rather than leave an account homed here with no membership.
  const { user, ensured } = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        orgId,
        name: payload.name,
        email,
        phone: payload.phone ?? null,
        passwordHash,
        role,
        status: "active",
      },
      include: withCount,
    });

    const seat = await membershipService.ensureMembership({
      tx,
      orgId,
      userId: created.id,
      role,
      invitedById: actor?.id || null,
    });
    if (seat) {
      await membershipService.recordMembershipEvent({
        tx,
        orgId,
        membership: seat.membership,
        action: "membership.created",
        actor,
        context,
        metadata: { role, existingIdentity: false },
      });
    }
    return { user: created, ensured: seat };
  });

  return sanitizeUser(user, ensured?.membership || null);
};

const getUserById = async ({ orgId, userId }) => {
  const user = await findUserInOrg({ orgId, userId });

  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  return sanitizeUser(user);
};

/**
 * Deactivation is a workspace decision: the membership is suspended (with
 * the last-owner and self guards), the person's assignments in this
 * workspace's projects go, and the identity itself is closed only when this
 * was the last workspace it could enter — one person, one workspace was the
 * whole story until now, and for such a person nothing changes.
 */
const deactivateUser = async ({ orgId, userId, actor = null, context = {} }) => {
  const user = await findUserInOrg({ orgId, userId });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  const membership = user.memberships?.[0] || null;
  if (user.status === "inactive" || (membership && membership.status !== membershipService.MEMBERSHIP_STATUSES.ACTIVE)) {
    throw new HttpError(400, "ALREADY_INACTIVE", "User is already inactive");
  }

  const membershipAware = Boolean(membership) && membershipService.isMembershipWriteEnabled();
  const closeIdentity =
    user.orgId === orgId && !(await membershipService.hasOtherActiveMembership({ tx: prisma, orgId, userId }));

  const updated = await prisma.$transaction(async (tx) => {
    const suspended = membershipAware
      ? await membershipService.changeMembership({
          tx,
          orgId,
          userId,
          actor,
          changes: { status: membershipService.MEMBERSHIP_STATUSES.SUSPENDED },
          context,
        })
      : null;
    const row = closeIdentity
      ? await tx.user.update({
          where: { id: userId },
          data: { status: "inactive" },
          include: withCount,
        })
      : user;
    await tx.projectAssignment.deleteMany({ where: { userId, project: { orgId } } });
    await tx.activityAssignment.deleteMany({ where: { userId, activity: { project: { orgId } } } });
    return sanitizeUser(row, suspended?.membership || (closeIdentity ? null : membership));
  });

  return updated;
};

/**
 * Reactivation mirrors deactivation: the membership is this workspace's to
 * reopen; the identity (User.status) belongs to its home workspace and is
 * reopened only from there. Another workspace that finds the identity itself
 * closed is refused, as it is for the name, email and password.
 */
const activateUser = async ({ orgId, userId, actor = null, context = {} }) => {
  const user = await findUserInOrg({ orgId, userId });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  const membership = user.memberships?.[0] || null;
  const membershipActive = !membership || membership.status === membershipService.MEMBERSHIP_STATUSES.ACTIVE;
  if (user.status === "active" && membershipActive) {
    throw new HttpError(400, "ALREADY_ACTIVE", "User is already active");
  }
  const homeOrg = user.orgId === orgId;
  if (user.status !== "active" && !homeOrg) {
    throw new HttpError(403, "FORBIDDEN", "This person's account is managed by their own workspace");
  }

  const membershipAware = Boolean(membership) && membershipService.isMembershipWriteEnabled();
  return prisma.$transaction(async (tx) => {
    const reactivated =
      membershipAware && !membershipActive
        ? await membershipService.changeMembership({
            tx,
            orgId,
            userId,
            actor,
            changes: { status: membershipService.MEMBERSHIP_STATUSES.ACTIVE },
            context,
          })
        : null;
    const row =
      user.status !== "active"
        ? await tx.user.update({
            where: { id: userId },
            data: { status: "active" },
            include: withCount,
          })
        : user;
    return sanitizeUser(row, reactivated?.membership || membership);
  });
};

/**
 * PATCH /users/:id. Name, phone and email belong to the identity and are
 * edited only from its own workspace; role and standing belong to the
 * membership and are changed through it, with its guards (self-elevation,
 * owner-only ownership, last owner), then mirrored to the User columns in
 * the identity's own workspace (M5 dual-write). Without a membership row the
 * User columns are written as before — the self guard holds either way.
 */
const updateUser = async ({ orgId, userId, actor = null, payload, context = {} }) => {
  const user = await findUserInOrg({ orgId, userId });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  const homeOrg = user.orgId === orgId;

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
  if (Object.keys(data).length && !homeOrg) {
    throw new HttpError(403, "FORBIDDEN", "This person's name, phone and email are managed by their own workspace");
  }

  if (payload.role !== undefined && !ALLOWED_ROLES.includes(payload.role)) {
    throw new HttpError(400, "INVALID_ROLE", "Role is invalid");
  }

  const wantsStanding =
    payload.role !== undefined || payload.isCompanyAdmin !== undefined || payload.isOwner !== undefined;
  let membership = user.memberships?.[0] || null;

  if (wantsStanding) {
    const membershipAware = membershipService.hasMembershipModel(prisma) && membershipService.isMembershipWriteEnabled();
    if (membershipAware) {
      // In a transaction: a missing seat is decided under the organisation-row
      // lock the one-member rule takes, which lasts only until the caller's
      // transaction ends — outside one, the count and the insert would not be
      // serialised against a concurrent seat.
      membership = await prisma.$transaction((tx) => membershipService.ensureMembershipForUser({ tx, user, orgId }));
    }
    if (membership) {
      const changed = await membershipService.changeMembership({
        tx: prisma,
        orgId,
        userId,
        actor,
        changes: {
          role: payload.role,
          isAdmin: payload.isCompanyAdmin,
          isOwner: payload.isOwner,
        },
        context,
      });
      membership = changed.membership;
      if (homeOrg) {
        data.role = membership.role;
        data.isCompanyAdmin = Boolean(membership.isAdmin || membership.isOwner);
      }
    } else {
      const roleChanges = payload.role !== undefined && payload.role !== user.role;
      const adminChanges =
        payload.isCompanyAdmin !== undefined && Boolean(payload.isCompanyAdmin) !== Boolean(user.isCompanyAdmin);
      if (actor?.id && actor.id === userId && (roleChanges || adminChanges)) {
        throw new HttpError(403, "SELF_ELEVATION_FORBIDDEN", "You cannot change your own role or standing");
      }
      // Standing is granted by the workspace's administration here too: a
      // client that knows no memberships must not be the way a PM mints
      // an administrator (membership doc §2.1).
      const wantsOwner = payload.isOwner !== undefined && Boolean(payload.isOwner);
      if ((adminChanges || wantsOwner) && !actor?.isCompanyAdmin) {
        throw new HttpError(403, "OWNER_REQUIRED", "Only a workspace owner can grant or revoke ownership or administration");
      }
      if (payload.role !== undefined) data.role = payload.role;
      if (payload.isCompanyAdmin !== undefined) data.isCompanyAdmin = Boolean(payload.isCompanyAdmin);
    }
  }

  const updated = Object.keys(data).length
    ? await prisma.user.update({
        where: { id: userId },
        data,
        include: withCount,
      })
    : user;

  return sanitizeUser(updated, membership);
};

const resetPassword = async ({
  orgId,
  userId,
  newPassword,
  actor = null,
  context = {},
}) => {
  const user = await findUserInOrg({ orgId, userId });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  // A password belongs to the identity: only its own workspace resets it.
  if (user.orgId !== orgId) {
    throw new HttpError(403, "FORBIDDEN", "This person's password is managed by their own workspace");
  }

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

  // An identity that exists in another workspace may be invited (membership
  // doc §5): acceptance gives it a second membership. One that is already an
  // active member here needs no workspace invitation — a project or party
  // invitation still makes sense, it assigns them. A membership that was
  // left or suspended goes back to `invited` and waits on acceptance.
  const existingMembership = existingUser
    ? await membershipService.findMembership({ tx: prisma, orgId, userId: existingUser.id })
    : null;
  const activeHere = existingMembership
    ? existingMembership.status === membershipService.MEMBERSHIP_STATUSES.ACTIVE
    : Boolean(existingUser && existingUser.orgId === orgId && existingUser.status === "active");
  if (activeHere && !projectId && !companyId && !projectPartyId) {
    throw new HttpError(409, "ALREADY_MEMBER", "This person is already a member of the workspace");
  }
  // Acceptance seats a guest only for a party invitation (auth.service
  // isPartyInvitation: a projectPartyId); every other invitation — a
  // workspace, project or company-directory one — seats a member. A personal
  // workspace refuses those before the invitation is minted (ENT-6), so
  // nobody is sent a link that acceptance would refuse. The one exemption is
  // somebody already holding a member seat here, who is only being assigned
  // a project; an active guest is not, and accepting would take a seat.
  const seatedMemberHere =
    activeHere && existingMembership?.kind === membershipService.MEMBERSHIP_KINDS.MEMBER;
  if (!projectPartyId && !seatedMemberHere) {
    await membershipService.assertWorkspaceAcceptsMember({ tx: prisma, orgId, userId: existingUser?.id || null });
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

    if (
      existingMembership &&
      membershipService.isMembershipWriteEnabled() &&
      [membershipService.MEMBERSHIP_STATUSES.LEFT, membershipService.MEMBERSHIP_STATUSES.SUSPENDED].includes(existingMembership.status)
    ) {
      await tx.organizationMembership.update({
        where: { id: existingMembership.id },
        data: { status: membershipService.MEMBERSHIP_STATUSES.INVITED, invitationId: created.id },
      });
    }
    await membershipService.recordMembershipEvent({
      tx,
      orgId,
      membership: existingMembership,
      userId: existingUser?.id || null,
      action: "membership.invited",
      actor,
      context,
      metadata: { invitationId: created.id, email, role, projectId, projectPartyId, existingUser: Boolean(existingUser) },
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
