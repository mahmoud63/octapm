const { createHash, randomBytes } = require("crypto");
const domains = require("../config/domains");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { normalizeLimit } = require("../utils/list-query");
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

// The acceptance link opens where the invitation's person will work (domain
// architecture §14): a project-party invitation (a consultant, any external
// company on the project) on the external collaboration portal, every other
// invitation on the application. Decided by the invitation, never the e-mail.
const buildAcceptInvitationUrl = (token, invitation = {}) =>
  domains.buildUrl(domains.invitationSurface(invitation), "/accept-invite", { token });

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
  // The caller's page size, 20 by default and at most 100 (it was always 20,
  // whatever the request asked; D-PAGE-1).
  const take = normalizeLimit(query.limit, { defaultLimit: 20, maxLimit: 100 });
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

  const DEFAULT_SORT_DIR = { name: "asc", email: "asc", projects: "desc", created: "desc" };
  const sortKey = DEFAULT_SORT_DIR[query.sortBy] ? query.sortBy : "created";
  const dir = query.sortDir === "asc" || query.sortDir === "desc" ? query.sortDir : DEFAULT_SORT_DIR[sortKey];
  // Every order ends on the id (D-PAGE-1). The cursor row is found by its
  // place in the order, so rows that tie on the sort value need a unique last
  // key: people created by one bulk import share a createdAt, and most people
  // have the same project count, and without it some of them were returned by
  // no page at all (3 of 27 in one certification workspace).
  const orderBy = [
    sortKey === "projects"
      ? { projectAssignments: { _count: dir } }
      : { [sortKey === "created" ? "createdAt" : sortKey]: dir },
    { id: dir },
  ];

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
 * POST /users — the deprecated alias of POST /users/invitations (owner
 * decision D-ID-1). Adding a person is always an invitation: nobody's
 * account or password is made here, and the answer is the invitation's,
 * identical for an e-mail that has an account and one that has none. The
 * person creates or signs in to their own identity and accepts; only then
 * do they belong to the workspace.
 */
const createUser = async ({ orgId, actor = null, payload, context = {} }) =>
  inviteUser({ orgId, actor, payload, context, via: "users.create" });

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

  const updated = await prisma.$transaction(async (tx) => {
    // Under the lock invitations and acceptances of this e-mail here take,
    // so no link is minted or accepted half-way through the suspension.
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${user.email}))`;
    }
    // Stamped once the lock is held, so the sessions, tickets and links it
    // ends are never dated before rows written while it waited.
    const now = new Date();
    // Read again under the lock: an acceptance that held it a moment ago may
    // have written the person's row here since the read above (D-ID-1 R2).
    const current = membershipService.hasMembershipModel(tx)
      ? await membershipService.findMembership({ tx, orgId, userId })
      : null;
    if (current && current.status !== membershipService.MEMBERSHIP_STATUSES.ACTIVE) {
      throw new HttpError(400, "ALREADY_INACTIVE", "User is already inactive");
    }
    // Narrowing access is never paused: the suspension is written to the
    // membership even while the emergency switch is off (D-ID-1 Q10), since
    // the membership row is what every request is judged by.
    let suspended = current
      ? await membershipService.changeMembership({
          tx,
          orgId,
          userId,
          actor,
          changes: { status: membershipService.MEMBERSHIP_STATUSES.SUSPENDED },
          context,
        })
      : null;
    // A person homed here before memberships has no row to suspend. They get
    // one, suspended, from their own columns — otherwise the User-column
    // fallback would keep admitting them here whenever the identity itself
    // stays open because another workspace holds them (D-ID-1 SUSP).
    if (!current && user.orgId === orgId && membershipService.hasMembershipModel(tx)) {
      const row = await tx.organizationMembership.create({
        data: {
          ...membershipService.membershipFromUser(user),
          role: membershipService.isMembershipRoleValid({ role: user.role }) ? user.role : "site_engineer",
          status: membershipService.MEMBERSHIP_STATUSES.SUSPENDED,
        },
        include: membershipService.PRINCIPAL_INCLUDE,
      });
      await membershipService.recordMembershipEvent({ tx, orgId, membership: row, action: "membership.suspended", actor, context, metadata: { from: "legacy", to: "suspended" } });
      suspended = { membership: row };
    }
    // The identity itself closes only when this was its home and it is part of
    // no other workspace — active or suspended there (D-ID-1 ID-GUARD): a
    // suspension elsewhere is that company's to lift. The identity lock comes
    // first, so an acceptance into another workspace running now is either
    // committed and seen by the write below, or waits for this one.
    // Closing is a credential event: every token of the identity stops working.
    let closedIdentity = false;
    if (user.orgId === orgId) {
      await membershipService.lockIdentity(tx, userId);
      const closed = await tx.user.updateMany({
        where: { id: userId, orgId, status: "active", ...membershipService.noOtherPresentMembershipWhere(orgId) },
        data: { status: "inactive", credentialEpoch: { increment: 1 } },
      });
      closedIdentity = closed.count === 1;
    }
    if (closedIdentity) {
      // A credential event: every session, unexchanged SSO ticket and API key
      // the person created ends, in every workspace (D-ID-1 Q6, Q-KEY).
      await require("./auth.service").endIdentitySessions(tx, userId, now, { reason: "identity_closed", actorId: actor?.id || null });
    } else {
      await tx.refreshSession.updateMany({ where: { userId, orgId, revokedAt: null }, data: { revokedAt: now } });
      // An SSO sign-in ticket not yet exchanged would open a session here
      // after the suspension.
      if (tx.ssoTicket?.updateMany) {
        await tx.ssoTicket.updateMany({ where: { userId, orgId, usedAt: null }, data: { usedAt: now } });
      }
    }
    // Links this workspace sent the person stop working: a suspension is not
    // undone by accepting an offer made before it (D-ID-1 Q3).
    const pending = await tx.invitationToken.findMany({
      where: { orgId, email: user.email, status: "pending", acceptedAt: null, revokedAt: null },
      select: { id: true, projectId: true },
    });
    if (pending.length) {
      await tx.invitationToken.updateMany({
        where: { id: { in: pending.map((row) => row.id) }, status: "pending", acceptedAt: null, revokedAt: null },
        data: { status: "revoked", revokedAt: now },
      });
      for (const row of pending) {
        await recordAuthAuditEvent({
          tx,
          orgId,
          projectId: row.projectId || null,
          userId,
          actorId: actor?.id || null,
          actorRole: actor?.role || null,
          entityType: "invitation",
          entityId: row.id,
          action: "invitation_revoked",
          email: user.email,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { reason: "member_suspended" },
        });
      }
    }
    await tx.projectAssignment.deleteMany({ where: { userId, project: { orgId } } });
    await tx.activityAssignment.deleteMany({ where: { userId, activity: { project: { orgId } } } });
    const row = closedIdentity ? await tx.user.findUnique({ where: { id: userId }, include: withCount }) : user;
    return sanitizeUser(row, suspended?.membership || (closedIdentity ? null : current));
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
  // Reactivation widens access: paused while the emergency switch is off (D-ID-1 Q10).
  membershipService.assertAccessExpansionAllowed();
  const user = await findUserInOrg({ orgId, userId });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  const membership = user.memberships?.[0] || null;
  // An invitation is the person's to accept with their own session; the
  // workspace cannot turn it into membership for them (owner decision L38).
  if (membership?.status === membershipService.MEMBERSHIP_STATUSES.INVITED) {
    throw new HttpError(409, "MEMBERSHIP_PENDING_ACCEPTANCE", "This person joins when they accept their invitation");
  }
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
    // One standing change at a time for this person here: activation,
    // deactivation, a role edit and an invitation take the same lock (D-ID-1 N1).
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${user.email}))`;
    }
    if (user.status !== "active") await membershipService.lockIdentity(tx, userId);
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

  // The sign-in e-mail is the person's own (owner decision D-ID-1): moving it
  // would let whoever moved it take the account over through the reset link,
  // and probing for a clash told them which addresses have accounts. Refused
  // whatever the value — the route refuses the field before this runs.
  if (Object.prototype.hasOwnProperty.call(payload, "email")) {
    throw new HttpError(400, "USER_EMAIL_IDENTITY_OWNED", "A person's sign-in e-mail is theirs; it cannot be changed from user management");
  }

  const data = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.phone !== undefined) data.phone = payload.phone || null;

  if (Object.keys(data).length && !homeOrg) {
    throw new HttpError(403, "FORBIDDEN", "This person's name, phone and email are managed by their own workspace");
  }

  if (payload.role !== undefined && !ALLOWED_ROLES.includes(payload.role)) {
    throw new HttpError(400, "INVALID_ROLE", "Role is invalid");
  }

  const wantsStanding =
    payload.role !== undefined || payload.isCompanyAdmin !== undefined || payload.isOwner !== undefined;
  let membership = user.memberships?.[0] || null;

  // A fast refusal only: while the emergency switch is off a role change or a
  // grant is refused (D-ID-1 Q10). The decision that counts is taken again
  // under the lock, against the row as it is then (changeMembership, and the
  // User-column branch below) — a snapshot read here can be stale by then.
  if (!membershipService.isMembershipWriteEnabled()) {
    const current = membership || { role: user.role, isAdmin: user.isCompanyAdmin, isOwner: false };
    const roleChanges = payload.role !== undefined && payload.role !== current.role;
    const grantsAdmin = payload.isCompanyAdmin === true && !(current.isAdmin || current.isOwner);
    const grantsOwner = payload.isOwner === true && !current.isOwner;
    if (roleChanges || grantsAdmin || grantsOwner) membershipService.assertAccessExpansionAllowed();
  }

  if (!wantsStanding) {
    const updated = Object.keys(data).length
      ? await prisma.user.update({ where: { id: userId }, data, include: withCount })
      : user;
    return sanitizeUser(updated, membership);
  }

  // Standing is changed in one transaction, under the lock deactivation,
  // activation and invitations of this e-mail here take (D-ID-1 N1, R2): the
  // membership is read — or, for a person homed here before memberships,
  // written — under it, the change is judged against that row, and the User
  // columns that mirror it in the home workspace are written in the same
  // transaction, so a delayed mirror can never undo a later change.
  const updated = await prisma.$transaction(async (tx) => {
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${user.email}))`;
    }
    const locked = await tx.user.findUnique({ where: { id: userId }, include: withCount });
    if (!locked) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    // A missing seat is decided under the organisation-row lock the one-member
    // rule takes inside ensureMembershipForUser. With the emergency switch off
    // no row is written (that would be a seat); an existing row is returned.
    const row = membershipService.hasMembershipModel(tx)
      ? (await membershipService.ensureMembershipForUser({ tx, user: locked, orgId })) ||
        (await membershipService.findMembership({ tx, orgId, userId }))
      : null;
    if (row) {
      const changed = await membershipService.changeMembership({
        tx,
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
      // No membership row anywhere here (the read switched off, or a client
      // that knows none): the User columns are the standing, judged as read
      // under the lock.
      const roleChanges = payload.role !== undefined && payload.role !== locked.role;
      const adminChanges =
        payload.isCompanyAdmin !== undefined && Boolean(payload.isCompanyAdmin) !== Boolean(locked.isCompanyAdmin);
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
      const grants = roleChanges || (payload.isCompanyAdmin === true && !locked.isCompanyAdmin) || wantsOwner;
      if (grants) membershipService.assertAccessExpansionAllowed();
      if (payload.role !== undefined) data.role = payload.role;
      if (payload.isCompanyAdmin !== undefined) data.isCompanyAdmin = Boolean(payload.isCompanyAdmin);
    }
    return Object.keys(data).length
      ? tx.user.update({ where: { id: userId }, data, include: withCount })
      : locked;
  });

  return sanitizeUser(updated, membership);
};

/**
 * POST /users/:id/password-reset-email (owner decision D-ID-1 Q4). Recovery is
 * the person's own: an administrator may only ask OctaPM to send the ordinary
 * self-service reset e-mail, to the address the identity already has, for
 * someone who is part of this workspace (active or suspended here, or homed
 * here before memberships). The administrator never sees the token or the
 * link, never sets the password, never changes where it goes, and the answer
 * — always `{ sent: true }` — says nothing about the account's state: a
 * closed identity is sent nothing and answered the same.
 */
const sendPasswordResetEmail = async ({ orgId, userId, actor = null, context = {} }) => {
  const user = await findUserInOrg({ orgId, userId });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  await recordAuthAuditEvent({
    orgId,
    userId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    entityType: "password_reset",
    entityId: userId,
    action: "password_reset_email_requested_by_admin",
    email: user.email,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
  const authService = require("./auth.service");
  await authService.requestPasswordReset({ email: user.email }, context);
  return { sent: true };
};

/**
 * POST /users/invitations — the one way a person is added (owner decision
 * D-ID-1), and POST /users, its deprecated alias. The answer is the
 * invitation alone, with the same keys and values whether or not the e-mail
 * has an account, and nothing is written to any identity or membership: the
 * person creates or signs in to their own identity and accepts with it
 * (auth.service acceptInvitation). One pending invitation per (workspace,
 * e-mail): a new one replaces the old, whose link stops working.
 *
 * Who is already part of the workspace is decided under the lock that
 * acceptance and deactivation of the same e-mail here take, so an invitation
 * can never be judged against a membership that changes under it.
 */
const inviteUser = async ({ orgId, actor, payload, context = {}, via = "users.invite", resendOf = null }) => {
  // Inviting widens access: paused while the emergency switch is off (D-ID-1 Q10).
  membershipService.assertAccessExpansionAllowed();
  const email = normalizeEmail(payload.email);
  // The offer names a role the workspace really has; an unknown one is refused
  // as PATCH refuses it, not quietly turned into another role.
  if (!ALLOWED_ROLES.includes(payload.role)) {
    throw new HttpError(400, "INVALID_ROLE", "Role is invalid");
  }
  const role = payload.role;
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

  const [org, project, company] = await Promise.all([
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

  const rawToken = createAccountToken();
  const expiresAt = getInvitationExpiresAt();
  const now = new Date();

  const { invitation, existingUserId } = await prisma.$transaction(async (tx) => {
    // Invitations, acceptances and deactivations of one e-mail in one
    // workspace are made one at a time.
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${email}))`;
    }
    // A resend is judged under the lock too: the link it replaces may have
    // been accepted a moment ago, and then there is nothing to send again.
    if (resendOf) {
      const original = await tx.invitationToken.findFirst({ where: { id: resendOf, orgId }, select: { status: true, acceptedAt: true } });
      if (!original || original.acceptedAt || original.status === "accepted") {
        throw new HttpError(409, "INVITATION_NOT_PENDING", "This invitation is no longer pending");
      }
    }
    const existingUser = await tx.user.findUnique({
      where: { email },
      select: { id: true, orgId: true, status: true },
    });
    // Somebody already part of this workspace is not invited into it again
    // (owner decision D-ID-1 Q3): an active member needs no workspace
    // invitation (a project or party one still assigns them), and a suspended
    // one — including a closed account homed here, or a person homed here
    // before memberships whose account is closed — comes back only through
    // Activate, never through an offer. Someone who left may be invited again.
    const existingMembership = existingUser
      ? await membershipService.findMembership({ tx, orgId, userId: existingUser.id })
      : null;
    const legacyHome = Boolean(existingUser) && !existingMembership && existingUser.orgId === orgId;
    const activeHere = existingMembership
      ? existingMembership.status === membershipService.MEMBERSHIP_STATUSES.ACTIVE
      : legacyHome && existingUser.status === "active";
    const suspendedHere = existingMembership
      ? existingMembership.status === membershipService.MEMBERSHIP_STATUSES.SUSPENDED
      : legacyHome && existingUser.status !== "active";
    if (suspendedHere || (activeHere && !projectId && !companyId && !projectPartyId)) {
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
      activeHere && (!existingMembership || existingMembership.kind === membershipService.MEMBERSHIP_KINDS.MEMBER);
    if (!projectPartyId && !seatedMemberHere) {
      await membershipService.assertWorkspaceAcceptsMember({ tx, orgId, userId: existingUser?.id || null });
    }

    const pendingBefore = await tx.invitationToken.findMany({
      where: { orgId, email, status: "pending", acceptedAt: null, revokedAt: null },
      select: { id: true },
    });
    let superseded = [];
    if (pendingBefore.length) {
      await tx.invitationToken.updateMany({
        where: { id: { in: pendingBefore.map((row) => row.id) }, status: "pending", acceptedAt: null, revokedAt: null },
        data: { status: "revoked", revokedAt: now },
      });
      // Audited as revoked only what this update revoked (acceptance takes the
      // same lock, so a link accepted meanwhile is not among them).
      superseded = await tx.invitationToken.findMany({
        where: { id: { in: pendingBefore.map((row) => row.id) }, status: "revoked", revokedAt: now },
        select: { id: true },
      });
    }

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

    for (const row of superseded) {
      await recordAuthAuditEvent({
        tx,
        orgId,
        userId: existingUser?.id || null,
        actorId: actor?.id || null,
        actorRole: actor?.role || null,
        entityType: "invitation",
        entityId: row.id,
        action: "invitation_revoked",
        email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: "superseded", supersededBy: created.id },
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
      metadata: { invitationId: created.id, email, role, projectId, projectPartyId, existingUser: Boolean(existingUser), via },
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
        via,
      },
    });

    // The project's own history is read by the inviting workspace, so it
    // carries the invitation only — never whether the e-mail has an account.
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
          companyName: company?.name || null,
          projectPartyRole: projectParty?.role || null,
        },
      });
    }

    return { invitation: created, existingUserId: existingUser?.id || null };
  });

  const acceptUrl = buildAcceptInvitationUrl(rawToken, { projectPartyId });
  const template = templates.invitation({
    orgName: org.name,
    inviterName: actor?.name || actor?.email || null,
    acceptUrl,
    role: ROLE_LABELS.get(role) || role,
    projectName: project?.name || null,
    note,
    expiresAt: invitation.expiresAt,
  });

  // A failed send has one answer for every e-mail and every transport fault
  // (D-ID-1 ID-h): the invitation stays pending — the earlier link was
  // already replaced, which keeps a corrected offer from leaving the old one
  // usable — the failure is audited, and the admin sends it again from the
  // pending list.
  try {
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
  } catch (error) {
    console.error(
      `[users] invitation ${invitation.id} e-mail was not delivered: ${error?.code || error?.name || "ERROR"}`,
    );
    await recordAuthAuditEvent({
      orgId,
      projectId,
      userId: existingUserId,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      entityType: "invitation",
      entityId: invitation.id,
      action: "invitation_delivery_failed",
      email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { code: error?.code || error?.name || null },
    }).catch(() => null);
    const failure = new HttpError(
      502,
      "INVITATION_EMAIL_FAILED",
      "The invitation was saved but its e-mail could not be sent; send it again from pending invitations",
      { invitationId: invitation.id },
    );
    failure.expose = true;
    throw failure;
  }

  return { ...sanitizeInvitation(invitation), invited: true };
};

const PENDING_PAGE = 50;

/** The invitation-manager's view of an invitation: the offer and its state, nothing about any account. */
const pendingInvitationView = (invitation, failures) => ({
  ...sanitizeInvitation(invitation),
  note: invitation.note ?? null,
  lastDeliveryFailedAt: failures.get(invitation.id) || null,
});

/**
 * GET /users/invitations (owner decision D-ID-1 Q5): the invitations of this
 * workspace still waiting to be accepted — pending and unexpired — for the
 * people who manage invitations. Each carries its offer and whether its last
 * e-mail failed, and nothing about whether the address has an account.
 */
const listInvitations = async ({ orgId, query = {} }) => {
  const rows = await prisma.invitationToken.findMany({
    where: { orgId, status: "pending", acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PENDING_PAGE + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  let nextCursor = null;
  if (rows.length > PENDING_PAGE) {
    rows.pop();
    nextCursor = rows[rows.length - 1].id;
  }
  const failures = new Map();
  if (rows.length && prisma.authAuditEvent?.findMany) {
    const failed = await prisma.authAuditEvent.findMany({
      where: { orgId, entityType: "invitation", action: "invitation_delivery_failed", entityId: { in: rows.map((row) => row.id) } },
      select: { entityId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    for (const row of failed) if (!failures.has(row.entityId)) failures.set(row.entityId, row.createdAt);
  }
  return {
    items: rows.map((row) => pendingInvitationView(row, failures)),
    pagination: { limit: PENDING_PAGE, nextCursor },
  };
};

const findWorkspaceInvitation = async ({ orgId, invitationId }) => {
  const row = await prisma.invitationToken.findFirst({ where: { id: invitationId, orgId } });
  if (!row) throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  return row;
};

/**
 * DELETE /users/invitations/:id: the link stops working, exactly as an
 * expired one does. Taken under the e-mail's lock and as a conditional write
 * on the pending state, so a revoke and an acceptance of the same link cannot
 * both succeed: whichever comes second finds it no longer pending (409 here,
 * an invalid link there). An expired link that was never revoked can still be
 * revoked, once.
 */
const revokeInvitation = async ({ orgId, invitationId, actor = null, context = {} }) => {
  const row = await findWorkspaceInvitation({ orgId, invitationId });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${row.email}))`;
    }
    const { count } = await tx.invitationToken.updateMany({
      where: { id: row.id, orgId, status: "pending", acceptedAt: null, revokedAt: null },
      data: { status: "revoked", revokedAt: now },
    });
    if (count !== 1) throw new HttpError(409, "INVITATION_NOT_PENDING", "This invitation is no longer pending");
    await recordAuthAuditEvent({
      tx,
      orgId,
      projectId: row.projectId || null,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      entityType: "invitation",
      entityId: row.id,
      action: "invitation_revoked",
      email: row.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reason: "revoked_by_admin" },
    });
    if (row.projectId) {
      await auditService.recordEvent({
        tx,
        orgId,
        projectId: row.projectId,
        entityType: "user_invitation",
        entityId: row.id,
        action: auditService.ACTIONS.UPDATED,
        actorId: actor?.id || null,
        actorRole: actor?.role || null,
        summary: { email: row.email, role: row.role, status: "revoked" },
        metadata: {},
      });
    }
  });
  return { id: row.id, revoked: true };
};

/**
 * POST /users/invitations/:id/resend: a new invitation with the stored offer
 * — the same e-mail, role, project, company, party and note, never a re-typed
 * one — which replaces the earlier link. An accepted invitation is not
 * re-sent.
 */
const resendInvitation = async ({ orgId, invitationId, actor = null, context = {} }) => {
  const row = await findWorkspaceInvitation({ orgId, invitationId });
  if (row.acceptedAt || row.status === "accepted") {
    throw new HttpError(409, "INVITATION_NOT_PENDING", "This invitation is no longer pending");
  }
  return inviteUser({
    orgId,
    actor,
    context,
    via: "users.invitation_resend",
    resendOf: row.id,
    payload: {
      email: row.email,
      role: row.role,
      projectId: row.projectId,
      companyId: row.projectPartyId ? null : row.companyId,
      projectPartyId: row.projectPartyId,
      note: row.note,
    },
  });
};

module.exports = {
  listUsers,
  createUser,
  inviteUser,
  listInvitations,
  revokeInvitation,
  resendInvitation,
  ALLOWED_ROLES,
  getUserById,
  updateUser,
  sendPasswordResetEmail,
  deactivateUser,
  activateUser,
};
