/**
 * Organisation membership: one person's place in one workspace.
 *
 * ENT-1 shipped the read side and the pure rules the backfill and the
 * validation report share. ENT-2 (this file's second half) wires the
 * membership into authentication and adds the write path: the principal a
 * request acts as, the session a sign-in binds to, invitations and direct
 * adds for identities that already exist elsewhere, and role changes with the
 * self-elevation and last-owner guards.
 *
 * Two flags keep the migration reversible (wave plan M4/M5):
 *   AUTH_MEMBERSHIP_READ  (default true) — authenticate, sockets, API keys and
 *     refresh read the membership; off, they read the User columns as before.
 *   AUTH_MEMBERSHIP_WRITE (default true) — user management, invitation
 *     acceptance, SSO provisioning and sign-up write the membership beside the
 *     User columns; off, only the User columns are written.
 *
 * Either way a person with no membership row at all (an organisation seeded
 * before the backfill, or by a process that predates this wave) keeps working
 * from their User columns: that fallback is what lets a token minted before
 * this wave live out its lifetime, and what keeps the E2E reset's users
 * signing in until the seed writes memberships.
 */
const { prisma } = require("../config/db");
const { ALL_ROLES } = require("../config/permissions");
const { HttpError } = require("../utils/http-error");

/** The only role a guest (party member) membership may carry. */
const GUEST_ROLE = "external_party";

const MEMBERSHIP_KINDS = Object.freeze({ MEMBER: "member", GUEST: "guest" });

const MEMBERSHIP_STATUSES = Object.freeze({
  INVITED: "invited",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  LEFT: "left",
});

/** Catalogue roles a member-kind membership may carry (shared/permissions.json). */
const CATALOGUE_ROLES = Object.freeze([...ALL_ROLES]);

/** One wording for every refusal of a standing change (utils/error-codes.js keeps the same). */
const OWNER_REQUIRED_MESSAGE = "Only a workspace owner can grant or revoke ownership or administration";

const flagOn = (name) =>
  String(process.env[name] ?? "true").trim().toLowerCase() !== "false";

const isMembershipReadEnabled = () => flagOn("AUTH_MEMBERSHIP_READ");
const isMembershipWriteEnabled = () => flagOn("AUTH_MEMBERSHIP_WRITE");

/** Whether this client (real or a test double) knows the membership model at all. */
const hasMembershipModel = (tx) =>
  Boolean(tx?.organizationMembership?.findFirst);

/**
 * Whether a role is legal for a membership of the given kind. A member holds a
 * catalogue role; a guest holds exactly external_party. `super_admin` is in
 * neither set on purpose: it was never assignable and this wave retires it.
 */
const isMembershipRoleValid = ({ role, kind = MEMBERSHIP_KINDS.MEMBER }) => {
  if (kind === MEMBERSHIP_KINDS.GUEST) return role === GUEST_ROLE;
  return CATALOGUE_ROLES.includes(role);
};

/** Deterministic order: earliest created first, id as the tie-break. */
const byCreation = (a, b) => {
  const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return delta !== 0 ? delta : String(a.id).localeCompare(String(b.id));
};

/**
 * Who owns a workspace that has no owner yet (membership doc §7, [D]).
 *
 * Given the organisation's users, the owner is the earliest-created active
 * user who is a company administrator; failing that, the earliest-created
 * active `pm`, who is promoted to administrator in the process; failing that,
 * the earliest-created active user of any role, which the report flags as a
 * fallback the operator should look at. An organisation with no active user
 * gets no owner and is listed.
 *
 * Pure: the caller decides whether to write anything.
 *
 * @param {Array<{ id: string, role: string, isCompanyAdmin: boolean, status: string, createdAt: Date|string }>} users
 * @returns {{ ownerUserId: string|null, basis: 'admin'|'pm_promoted'|'fallback'|null }}
 */
const ownerRule = (users) => {
  const active = (users || []).filter((user) => user.status === "active").sort(byCreation);
  const admin = active.find((user) => Boolean(user.isCompanyAdmin));
  if (admin) return { ownerUserId: admin.id, basis: "admin" };
  const pm = active.find((user) => user.role === "pm");
  if (pm) return { ownerUserId: pm.id, basis: "pm_promoted" };
  if (active.length) return { ownerUserId: active[0].id, basis: "fallback" };
  return { ownerUserId: null, basis: null };
};

/**
 * The membership row a legacy User row implies (membership doc §7). Owners are
 * administrators by definition, so isAdmin is forced on for the owner even
 * when the User flag is off (the "PMcopilots UAT Fixtures" promotion).
 */
const membershipFromUser = (user, { isOwner = false } = {}) => ({
  orgId: user.orgId,
  userId: user.id,
  role: user.role,
  kind: MEMBERSHIP_KINDS.MEMBER,
  isAdmin: Boolean(user.isCompanyAdmin) || Boolean(isOwner),
  isOwner: Boolean(isOwner),
  status: user.status === "active" ? MEMBERSHIP_STATUSES.ACTIVE : MEMBERSHIP_STATUSES.SUSPENDED,
  joinedAt: user.createdAt ?? null,
});

/** The person's active membership in one workspace, or null. */
const findActiveMembership = async ({ orgId, userId, tx = prisma }) => {
  if (!orgId || !userId) return null;
  return tx.organizationMembership.findFirst({
    where: { orgId, userId, status: MEMBERSHIP_STATUSES.ACTIVE },
  });
};

/**
 * Every workspace a person belongs to, with the organisation's name, slug and
 * kind for a picker. Rows with status `left` are kept for audit but are not a
 * workspace the person can enter, so they are left out unless asked for.
 */
const listMembershipsForUser = async (userId, { includeLeft = false, tx = prisma } = {}) => {
  if (!userId) return [];
  return tx.organizationMembership.findMany({
    where: {
      userId,
      ...(includeLeft ? {} : { status: { not: MEMBERSHIP_STATUSES.LEFT } }),
    },
    include: { org: { select: { id: true, name: true, slug: true, kind: true, status: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
};

// ─── The principal a request acts as (M4 dual-read) ────────────────────────

const PRINCIPAL_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  orgId: true,
  role: true,
  isCompanyAdmin: true,
};
const PRINCIPAL_ORG_SELECT = { id: true, name: true, kind: true, slug: true, status: true };
const PRINCIPAL_INCLUDE = {
  user: { select: PRINCIPAL_USER_SELECT },
  org: { select: PRINCIPAL_ORG_SELECT },
};

/**
 * req.user as the architecture doc §2.1 defines it. `isCompanyAdmin` is kept
 * as the property name the forty-odd read sites use; it now means "admin or
 * owner in the active workspace".
 */
const principalFromMembership = (membership) => ({
  id: membership.userId,
  orgId: membership.orgId,
  membershipId: membership.id,
  role: membership.role,
  isAdmin: Boolean(membership.isAdmin),
  isOwner: Boolean(membership.isOwner),
  isCompanyAdmin: Boolean(membership.isAdmin || membership.isOwner),
  orgKind: membership.org?.kind || "company",
  orgSlug: membership.org?.slug || null,
  kind: membership.kind || MEMBERSHIP_KINDS.MEMBER,
  email: membership.user?.email ?? null,
  name: membership.user?.name ?? null,
});

/** The same shape from a User row alone: the pre-membership fallback. */
const principalFromUser = (user) => ({
  id: user.id,
  orgId: user.orgId,
  membershipId: null,
  role: user.role,
  isAdmin: Boolean(user.isCompanyAdmin),
  isOwner: false,
  isCompanyAdmin: Boolean(user.isCompanyAdmin),
  orgKind: user.org?.kind || "company",
  orgSlug: user.org?.slug || null,
  kind: MEMBERSHIP_KINDS.MEMBER,
  email: user.email ?? null,
  name: user.name ?? null,
});

const isLive = (membership) =>
  membership.status === MEMBERSHIP_STATUSES.ACTIVE &&
  membership.user?.status === "active" &&
  (membership.org?.status ?? "active") === "active";

/**
 * Resolves the membership a token names, as it stands now.
 *
 * Returns `{ principal }` when the membership is live, `{ inactive: true }`
 * when a row exists but is not (suspended, left, the person deactivated, the
 * organisation archived — the token is refused), and `{ legacy: true }` when
 * there is no membership row for this person in this workspace at all, or
 * the membership read is switched off: the caller then falls back to the
 * User columns, which is how a token minted before this wave keeps working.
 *
 * A token that names a membership id (`mid`) is held to it: the row must be
 * that person's in that workspace, or the token is refused.
 */
const resolveMembershipPrincipal = async ({ tx = prisma, userId, orgId, membershipId = null }) => {
  if (!userId || !orgId || !isMembershipReadEnabled() || !hasMembershipModel(tx)) {
    return { legacy: true };
  }
  const membership = await tx.organizationMembership.findFirst({
    where: membershipId ? { id: membershipId, userId, orgId } : { userId, orgId },
    include: PRINCIPAL_INCLUDE,
  });
  if (!membership) return membershipId ? { inactive: true } : { legacy: true };
  if (!isLive(membership)) return { inactive: true };
  return { principal: principalFromMembership(membership), membership };
};

/**
 * The principal for a request: the membership when there is one, the User
 * columns when there is not. Null means the token is not honoured — the
 * caller answers 401 USER_INACTIVE, as it always has (Phase 21D, CX21-485).
 */
const resolveRequestPrincipal = async ({ tx = prisma, userId, orgId, membershipId = null }) => {
  const resolved = await resolveMembershipPrincipal({ tx, userId, orgId, membershipId });
  if (resolved.principal) return resolved.principal;
  if (resolved.inactive) return null;
  if (!tx?.user?.findUnique) return null;
  const account = await tx.user.findUnique({
    where: { id: userId },
    select: PRINCIPAL_USER_SELECT,
  });
  if (!account || account.orgId !== orgId || account.status !== "active") return null;
  return principalFromUser(account);
};

// ─── The membership a session is issued for ─────────────────────────────────

/**
 * The principal a session is minted for. Given a principal (it already names
 * a membership) it is returned as is; given a User row, the person's
 * membership in `orgId` (their User.orgId unless the caller says otherwise)
 * is read and the tokens are bound to it. A row that is not active refuses
 * the session — a suspended member does not get in through a path that read
 * only the User columns — and so does an identity that its home workspace
 * closed (User.status): no path mints a session for an inactive account.
 * No row at all means the pre-membership fallback.
 */
const resolveSessionPrincipal = async (tx, user, { orgId = null } = {}) => {
  if (!user) throw new HttpError(401, "USER_INACTIVE", "Your account is not active");
  if (user.membershipId) return user;
  if (user.status !== undefined && user.status !== "active") {
    throw new HttpError(403, "USER_INACTIVE", "Your account is not active");
  }
  const targetOrgId = orgId || user.orgId;
  if (!isMembershipReadEnabled() || !hasMembershipModel(tx)) {
    return principalFromUser({ ...user, orgId: targetOrgId });
  }
  const membership = await tx.organizationMembership.findFirst({
    where: { orgId: targetOrgId, userId: user.id },
    include: PRINCIPAL_INCLUDE,
  });
  if (!membership) {
    if (targetOrgId !== user.orgId) {
      throw new HttpError(404, "WORKSPACE_NOT_FOUND", "You are not a member of this workspace");
    }
    return principalFromUser(user);
  }
  if (membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
    throw new HttpError(403, "USER_INACTIVE", "Your access to this workspace is not active");
  }
  if ((membership.org?.status ?? "active") !== "active") {
    throw new HttpError(403, "USER_INACTIVE", "This workspace is not active");
  }
  return principalFromMembership({ ...membership, user: membership.user || user });
};

/** A picker entry (membership doc §3, §6). */
const workspaceEntry = (membership) => ({
  orgId: membership.orgId,
  membershipId: membership.id,
  slug: membership.org?.slug || null,
  name: membership.org?.name || null,
  kind: membership.org?.kind || "company",
  role: membership.role,
  isAdmin: Boolean(membership.isAdmin),
  isOwner: Boolean(membership.isOwner),
  status: membership.status,
});

/**
 * The workspaces a person can see in a picker: every membership that is not
 * `left`, in an organisation that is still active. Suspended ones are listed
 * with their status so the picker can explain; they cannot be entered.
 */
const listWorkspacesForUser = async (userId, { tx = prisma } = {}) => {
  if (!hasMembershipModel(tx)) return [];
  const rows = await listMembershipsForUser(userId, { tx });
  return rows.filter((row) => (row.org?.status ?? "active") === "active").map(workspaceEntry);
};

// ─── Writes (M5 dual-write) ─────────────────────────────────────────────────

/** Audit trail entries for membership changes (membership doc §8). */
const recordMembershipEvent = async ({
  tx = prisma,
  orgId,
  membership = null,
  userId = null,
  action,
  actor = null,
  context = {},
  metadata = {},
}) => {
  if (!tx?.authAuditEvent?.create) return null;
  try {
    return await tx.authAuditEvent.create({
      data: {
        orgId,
        userId: membership?.userId || userId,
        actorId: actor?.id || null,
        actorRole: actor?.role || null,
        entityType: "membership",
        entityId: membership?.id || null,
        action,
        email: null,
        ipAddress: context.ipAddress || null,
        userAgent: context.userAgent || null,
        metadataJson: { membershipId: membership?.id || null, ...metadata },
      },
    });
  } catch {
    // The audit line is never the reason a membership change fails.
    return null;
  }
};

/** The person's membership row in a workspace, whatever its status. */
const findMembership = async ({ tx = prisma, orgId, userId }) => {
  if (!orgId || !userId || !hasMembershipModel(tx)) return null;
  return tx.organizationMembership.findFirst({
    where: { orgId, userId },
    include: PRINCIPAL_INCLUDE,
  });
};

/**
 * A user who belongs to a workspace: by membership, or by the User.orgId
 * column for rows that predate memberships. `where` narrows further; the
 * shape of the query is the one user.service always ran when the client
 * knows no memberships (test doubles), so those callers are unchanged.
 */
const userInOrgWhere = ({ tx = prisma, orgId, where = {} }) =>
  hasMembershipModel(tx) && isMembershipReadEnabled()
    ? {
        ...where,
        OR: [
          { orgId },
          { memberships: { some: { orgId, status: { not: MEMBERSHIP_STATUSES.LEFT } } } },
        ],
      }
    : { ...where, orgId };

const findUserInOrg = async ({ tx = prisma, orgId, userId, include = undefined, select = undefined }) =>
  tx.user.findFirst({
    where: userInOrgWhere({ tx, orgId, where: { id: userId } }),
    ...(include ? { include } : {}),
    ...(select ? { select } : {}),
  });

const assertRoleForKind = ({ role, kind }) => {
  if (kind === MEMBERSHIP_KINDS.GUEST) return GUEST_ROLE;
  if (!isMembershipRoleValid({ role, kind })) {
    throw new HttpError(400, "INVALID_ROLE", "Role is invalid");
  }
  return role;
};

/** One wording for every refusal of a second member in a personal workspace (utils/error-codes.js keeps the same). */
const PERSONAL_WORKSPACE_MESSAGE =
  "A personal workspace has one member. Convert it to a company workspace to invite people.";

/**
 * The one-member rule of a personal workspace (wave plan, product-owner
 * decision 5): it holds exactly its owner, plus guests. Every path that would
 * give a second person a member-kind membership — a direct add, a workspace
 * or project invitation, invitation acceptance, SSO auto-provisioning — asks
 * here first and is refused with 409 PERSONAL_WORKSPACE_CONVERT_REQUIRED,
 * which names the way out. A guest (party member) is not a member and is not
 * counted or refused. A client that does not know the organisation model (a
 * test double) has no personal workspaces.
 *
 * `userId` is the person about to join: their own row, whatever its state,
 * never counts against them (the owner's sign-up membership; a member coming
 * back after leaving is refused only when somebody else holds the seat).
 */
const assertWorkspaceAcceptsMember = async ({ tx = prisma, orgId, userId = null, kind = MEMBERSHIP_KINDS.MEMBER }) => {
  if (kind === MEMBERSHIP_KINDS.GUEST || !orgId || !hasMembershipModel(tx) || !tx?.organisation?.findUnique) return;
  const org = await tx.organisation.findUnique({ where: { id: orgId }, select: { kind: true } });
  if (!org || org.kind !== "personal") return;
  // Count-then-insert is serialised on the organisation row: two seats taken
  // at once in an empty personal workspace would otherwise both count zero.
  // FOR NO KEY UPDATE, not FOR UPDATE: it queues seat checks behind each
  // other and behind a conversion (an UPDATE of the row), but not behind the
  // key-share locks every insert of a row pointing at the organisation takes.
  // The lock lasts until the caller's transaction ends, which is why callers
  // that seat a member run the check and the insert in one transaction.
  // The kind is re-read under the lock: a conversion that won the race has
  // made the workspace a company, and a company takes any number of members.
  if (typeof tx.$queryRaw === "function") {
    const [locked] = await tx.$queryRaw`SELECT "kind" FROM "Organisation" WHERE "id" = ${orgId} FOR NO KEY UPDATE`;
    if (!locked || locked.kind !== "personal") return;
  }
  const seated = await tx.organizationMembership.count({
    where: {
      orgId,
      kind: MEMBERSHIP_KINDS.MEMBER,
      status: { not: MEMBERSHIP_STATUSES.LEFT },
      ...(userId ? { userId: { not: userId } } : {}),
    },
  });
  if (seated > 0) {
    throw new HttpError(409, "PERSONAL_WORKSPACE_CONVERT_REQUIRED", PERSONAL_WORKSPACE_MESSAGE);
  }
};

/**
 * Creates or reactivates a membership (invitation acceptance, direct add,
 * SSO provisioning, sign-up, party-member add). Idempotent on (org, user).
 *
 * A member is never downgraded to a guest: a party-member add for someone
 * who already belongs to the workspace leaves their membership alone. A guest
 * who is invited as a member is upgraded. An invitation never confers admin
 * or ownership (membership doc §5), so those flags are only ever set on
 * creation by callers that own that decision (sign-up, bootstrap).
 *
 * Returns `{ membership, created, reactivated }`, or null when the membership
 * write is switched off or the client does not know the model.
 */
const ensureMembership = async ({
  tx = prisma,
  orgId,
  userId,
  role,
  kind = MEMBERSHIP_KINDS.MEMBER,
  isAdmin = false,
  isOwner = false,
  status = MEMBERSHIP_STATUSES.ACTIVE,
  invitedById = null,
  invitationId = null,
  joinedAt = new Date(),
}) => {
  if (!isMembershipWriteEnabled() || !hasMembershipModel(tx)) return null;
  const wantedRole = assertRoleForKind({ role, kind });
  const existing = await tx.organizationMembership.findFirst({ where: { orgId, userId } });

  // A member-kind membership that is new, or was a guest's or a left one, is
  // a seat being taken: the personal-workspace rule decides whether there is one.
  const takesSeat =
    kind === MEMBERSHIP_KINDS.MEMBER &&
    (!existing || existing.kind === MEMBERSHIP_KINDS.GUEST || existing.status === MEMBERSHIP_STATUSES.LEFT);
  if (takesSeat) await assertWorkspaceAcceptsMember({ tx, orgId, userId, kind });

  if (!existing) {
    const membership = await tx.organizationMembership.create({
      data: {
        orgId,
        userId,
        role: wantedRole,
        kind,
        isAdmin: kind === MEMBERSHIP_KINDS.GUEST ? false : Boolean(isAdmin || isOwner),
        isOwner: kind === MEMBERSHIP_KINDS.GUEST ? false : Boolean(isOwner),
        status,
        invitedById,
        invitationId,
        joinedAt: status === MEMBERSHIP_STATUSES.ACTIVE ? joinedAt : null,
      },
      include: PRINCIPAL_INCLUDE,
    });
    return { membership, created: true, reactivated: false };
  }

  // A guest add never touches an existing membership of either kind.
  if (kind === MEMBERSHIP_KINDS.GUEST) {
    const membership = await tx.organizationMembership.findFirst({ where: { id: existing.id }, include: PRINCIPAL_INCLUDE });
    return { membership, created: false, reactivated: false };
  }

  const wasActive = existing.status === MEMBERSHIP_STATUSES.ACTIVE;
  const membership = await tx.organizationMembership.update({
    where: { id: existing.id },
    data: {
      kind: MEMBERSHIP_KINDS.MEMBER,
      role: wantedRole,
      status,
      leftAt: null,
      ...(invitationId ? { invitationId } : {}),
      ...(invitedById && !existing.invitedById ? { invitedById } : {}),
      ...(status === MEMBERSHIP_STATUSES.ACTIVE && !existing.joinedAt ? { joinedAt } : {}),
    },
    include: PRINCIPAL_INCLUDE,
  });
  return { membership, created: false, reactivated: !wasActive && status === MEMBERSHIP_STATUSES.ACTIVE };
};

/**
 * The membership a legacy User row implies, written when it is missing — so
 * a change made through user management lands on a membership row even for
 * a person seeded before the backfill. Never invents an owner: ownership is
 * decided by the backfill's owner rule or by an owner, not by a role edit.
 */
const ensureMembershipForUser = async ({ tx = prisma, user, orgId }) => {
  if (!isMembershipWriteEnabled() || !hasMembershipModel(tx)) return null;
  const existing = await findMembership({ tx, orgId, userId: user.id });
  if (existing) return existing;
  if (user.orgId !== orgId) return null;
  const implied = membershipFromUser(user);
  // The implied row is a member seat, so a personal workspace's one-member
  // rule (ENT-6) decides it like every other: a person homed there without a
  // seat — one the backfill held back, or an identity a refused sign-in left
  // behind — is not seated by a role edit behind the owner's back.
  await assertWorkspaceAcceptsMember({ tx, orgId, userId: user.id, kind: implied.kind });
  return tx.organizationMembership.create({
    data: {
      ...implied,
      role: isMembershipRoleValid({ role: implied.role }) ? implied.role : "site_engineer",
    },
    include: PRINCIPAL_INCLUDE,
  });
};

const countActiveOwners = async ({ tx = prisma, orgId, excludeUserId = null }) =>
  tx.organizationMembership.count({
    where: {
      orgId,
      isOwner: true,
      status: MEMBERSHIP_STATUSES.ACTIVE,
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
  });

/**
 * Changes a membership's role, standing or status with the guards the
 * membership doc §2.1 requires:
 *
 *   - nobody changes their own role, admin flag, ownership or status
 *     (403 SELF_ELEVATION_FORBIDDEN);
 *   - only an owner grants or revokes ownership or administration
 *     (403 OWNER_REQUIRED); in a workspace with no membership rows of its
 *     own a company administrator grants administration, as before;
 *   - the last active owner cannot be demoted, suspended or removed
 *     (409 LAST_OWNER);
 *   - an owner is always an administrator (isOwner ⇒ isAdmin, written here);
 *   - a guest carries no role but external_party and no standing.
 *
 * `changes` may hold role, isAdmin, isOwner and status; fields left undefined
 * are untouched, and a value equal to the current one is not a change (an
 * edit form that re-sends the same role is not an elevation attempt).
 *
 * Returns `{ membership, before, changed }`; `changed` lists what moved so the
 * caller can mirror it to the User columns and drop the person's sockets.
 */
const changeMembership = async ({ tx = prisma, orgId, userId, actor = null, changes = {}, context = {} }) => {
  const membership = await findMembership({ tx, orgId, userId });
  if (!membership) throw new HttpError(404, "USER_NOT_FOUND", "User not found");

  const next = {
    role: changes.role !== undefined ? changes.role : membership.role,
    isOwner: changes.isOwner !== undefined ? Boolean(changes.isOwner) : membership.isOwner,
    status: changes.status !== undefined ? changes.status : membership.status,
  };
  next.isAdmin = (changes.isAdmin !== undefined ? Boolean(changes.isAdmin) : membership.isAdmin) || next.isOwner;

  if (membership.kind === MEMBERSHIP_KINDS.GUEST) {
    if (next.role !== GUEST_ROLE || next.isAdmin || next.isOwner) {
      throw new HttpError(400, "INVALID_ROLE", "A guest cannot hold a company role or administer the company");
    }
  } else if (!isMembershipRoleValid({ role: next.role })) {
    throw new HttpError(400, "INVALID_ROLE", "Role is invalid");
  }
  if (!Object.values(MEMBERSHIP_STATUSES).includes(next.status)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Membership status is invalid");
  }

  const changed = ["role", "isAdmin", "isOwner", "status"].filter((field) => next[field] !== membership[field]);
  if (!changed.length) return { membership, before: membership, changed };

  if (actor?.id && actor.id === userId) {
    throw new HttpError(403, "SELF_ELEVATION_FORBIDDEN", "You cannot change your own role or standing");
  }
  // Standing is granted by an owner (membership doc §2.1): admin as much as
  // ownership, or two PMs could make each other administrators and hollow
  // out the retired PM shortcut. An actor with no membership row of their
  // own (a workspace seeded before the backfill, where nobody is an owner)
  // grants it as a company administrator, which is all that workspace has.
  const mayGrantStanding = actor?.isOwner || (!actor?.membershipId && actor?.isCompanyAdmin);
  if ((changed.includes("isOwner") || changed.includes("isAdmin")) && !mayGrantStanding) {
    throw new HttpError(403, "OWNER_REQUIRED", OWNER_REQUIRED_MESSAGE);
  }
  if (changed.includes("isOwner") && !actor?.isOwner) {
    throw new HttpError(403, "OWNER_REQUIRED", OWNER_REQUIRED_MESSAGE);
  }

  const losesOwnership =
    membership.isOwner &&
    membership.status === MEMBERSHIP_STATUSES.ACTIVE &&
    (!next.isOwner || next.status !== MEMBERSHIP_STATUSES.ACTIVE);
  if (losesOwnership && (await countActiveOwners({ tx, orgId, excludeUserId: userId })) === 0) {
    throw new HttpError(409, "LAST_OWNER", "This workspace needs at least one active owner");
  }
  // A member coming back from `left` takes a seat again — ensureMembership
  // counts it the same way — so a personal workspace's one-member rule
  // (ENT-6) decides it: reactivating a former member beside the one who
  // holds the seat now would make a second member.
  if (
    membership.kind === MEMBERSHIP_KINDS.MEMBER &&
    membership.status === MEMBERSHIP_STATUSES.LEFT &&
    next.status !== MEMBERSHIP_STATUSES.LEFT
  ) {
    await assertWorkspaceAcceptsMember({ tx, orgId, userId, kind: MEMBERSHIP_KINDS.MEMBER });
  }

  const now = new Date();
  const updated = await tx.organizationMembership.update({
    where: { id: membership.id },
    data: {
      role: next.role,
      isAdmin: next.isAdmin,
      isOwner: next.isOwner,
      status: next.status,
      ...(next.status === MEMBERSHIP_STATUSES.LEFT ? { leftAt: now } : {}),
      ...(next.status === MEMBERSHIP_STATUSES.ACTIVE && membership.status !== MEMBERSHIP_STATUSES.ACTIVE
        ? { leftAt: null, joinedAt: membership.joinedAt || now }
        : {}),
    },
    include: PRINCIPAL_INCLUDE,
  });

  const events = [];
  if (changed.includes("role")) events.push(["membership.role_changed", { from: membership.role, to: next.role }]);
  if (changed.includes("isAdmin")) events.push([next.isAdmin ? "membership.admin_granted" : "membership.admin_revoked", {}]);
  if (changed.includes("isOwner")) events.push([next.isOwner ? "membership.owner_granted" : "membership.owner_revoked", {}]);
  if (changed.includes("status")) {
    const byStatus = {
      [MEMBERSHIP_STATUSES.SUSPENDED]: "membership.suspended",
      [MEMBERSHIP_STATUSES.ACTIVE]: "membership.reactivated",
      [MEMBERSHIP_STATUSES.LEFT]: "membership.left",
      [MEMBERSHIP_STATUSES.INVITED]: "membership.invited",
    };
    events.push([byStatus[next.status], { from: membership.status, to: next.status }]);
  }
  for (const [action, metadata] of events) {
    await recordMembershipEvent({ tx, orgId, membership: updated, action, actor, context, metadata });
  }

  return { membership: updated, before: membership, changed };
};

/**
 * Whether the person still has a workspace they can enter besides this one:
 * decides whether a deactivation in one workspace may also close the identity
 * (User.status), as it did when one person was one workspace.
 */
const hasOtherActiveMembership = async ({ tx = prisma, orgId, userId }) => {
  if (!hasMembershipModel(tx)) return false;
  const count = await tx.organizationMembership.count({
    where: { userId, orgId: { not: orgId }, status: MEMBERSHIP_STATUSES.ACTIVE },
  });
  return count > 0;
};

/**
 * Who a workspace's bills and trial reminders go to: its owner (ENT-6,
 * personal and company alike) — the earliest active owner membership's
 * user, since ownership is a membership fact. A workspace with no owner row
 * (seeded before the backfill) answers null and the caller keeps its older
 * pick. Only the address and name are read; no billing figure lives here.
 *
 * EXTENSION POINT (acceptance §18; ownership doc, "Billing recipient"): the
 * billing model has no organisation-level contact yet, so the owner is the
 * default. When one is added — a column such as
 * `Organisation.billingContactEmail` (or `Subscription.billingEmail`, or a
 * BillingContact row) — it is read HERE, first, and takes precedence over
 * the owner. The resolution order is then:
 *
 *   1. the organisation's billing contact, when set;
 *   2. the owner membership's user (this query);
 *   3. null — and the two callers fall back to the legacy earliest PM.
 *
 * This is the one place to change: billing-scheduler.js pmEmail and
 * subscription.service.js orgEmail both ask here and nowhere else, so a
 * billing contact never has to be threaded through them, and billing never
 * hangs on one person's permanent address.
 */
const findBillingRecipient = async ({ tx = prisma, orgId }) => {
  if (!orgId || !hasMembershipModel(tx)) return null;
  const owner = await tx.organizationMembership.findFirst({
    where: { orgId, isOwner: true, status: MEMBERSHIP_STATUSES.ACTIVE, user: { status: "active" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { userId: true, user: { select: { id: true, email: true, name: true } } },
  });
  return owner?.user ?? null;
};

module.exports = {
  CATALOGUE_ROLES,
  assertWorkspaceAcceptsMember,
  findBillingRecipient,
  GUEST_ROLE,
  MEMBERSHIP_KINDS,
  MEMBERSHIP_STATUSES,
  PRINCIPAL_INCLUDE,
  changeMembership,
  countActiveOwners,
  ensureMembership,
  ensureMembershipForUser,
  findActiveMembership,
  findMembership,
  findUserInOrg,
  hasMembershipModel,
  hasOtherActiveMembership,
  isMembershipReadEnabled,
  isMembershipRoleValid,
  isMembershipWriteEnabled,
  listMembershipsForUser,
  listWorkspacesForUser,
  membershipFromUser,
  ownerRule,
  principalFromMembership,
  principalFromUser,
  recordMembershipEvent,
  resolveMembershipPrincipal,
  resolveRequestPrincipal,
  resolveSessionPrincipal,
  userInOrgWhere,
  workspaceEntry,
};
