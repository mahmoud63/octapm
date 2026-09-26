/**
 * Organisation membership: one person's place in one workspace.
 *
 * ENT-1 ships only the read side and the pure rules the backfill and the
 * validation report share. Nothing here is wired into authentication or RBAC
 * yet — that is ENT-2, which adds the write path (invitations, direct adds,
 * role changes with the self-elevation and last-owner guards) on top of these
 * helpers. Until then User.orgId / User.role / User.isCompanyAdmin stay the
 * columns the API reads, and the membership rows mirror them.
 */
const { prisma } = require("../config/db");
const { ALL_ROLES } = require("../config/permissions");

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

/**
 * Whether a role is legal for a membership of the given kind. A member holds a
 * catalogue role; a guest holds exactly external_party. `super_admin` is in
 * neither set on purpose: it was never assignable and ENT-2 retires it.
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

module.exports = {
  CATALOGUE_ROLES,
  GUEST_ROLE,
  MEMBERSHIP_KINDS,
  MEMBERSHIP_STATUSES,
  findActiveMembership,
  isMembershipRoleValid,
  listMembershipsForUser,
  membershipFromUser,
  ownerRule,
};
