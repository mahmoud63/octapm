/**
 * The membership integrity sentinel: what must stay true about who belongs to
 * which workspace, and whether anything changed that nobody meant to change.
 *
 * On 2026-09-26 one live test's updateMany ran with every filter undefined and
 * gave all 47 memberships of the shared database the PM role. Nothing noticed
 * for two hours. This module is how the next one is noticed at once: it takes
 * a snapshot before a live run or an integration step, checks the standing
 * invariants, and compares the snapshot afterwards.
 *
 * Invariants (on durable organisations — every organisation except the
 * throwaway "LiveTest <uuid>" ones, which tests create and drop mid-run):
 *   - every active organisation has an active owner membership;
 *   - every owner membership is active, administers (owner implies admin) and
 *     belongs to an active person;
 *   - a PM is not an administrator merely by being a PM: a home membership
 *     with isAdmin must come from the person's company-admin grant or from
 *     ownership (the M2 rule, membership doc §7);
 *   - a home membership's role equals the person's User.role (dual-write);
 *   - every person has a membership in their home workspace;
 *   - every project assignment has a membership in the project's workspace.
 *
 * Comparison (before → after, durable organisations only): a membership that
 * existed before must keep its role, kind, admin, owner and status, and must
 * still exist; nobody who held an active membership may end with none. New
 * memberships and new organisations are expected — suites create data — and
 * are reported, not refused.
 */
const EPHEMERAL = /^LiveTest [0-9a-f-]{36}$/;
const WATCHED_FIELDS = ["role", "kind", "isAdmin", "isOwner", "status"];

const captureState = async (prisma) => {
  const [orgs, memberships, users, orphanAssignments] = await Promise.all([
    prisma.organisation.findMany({ select: { id: true, name: true, kind: true, status: true } }),
    prisma.organizationMembership.findMany({
      select: { id: true, orgId: true, userId: true, role: true, kind: true, isAdmin: true, isOwner: true, status: true },
    }),
    prisma.user.findMany({ select: { id: true, email: true, orgId: true, role: true, isCompanyAdmin: true, status: true } }),
    prisma.$queryRawUnsafe(`
      SELECT pa."id", pa."projectId", pa."userId", p."orgId"
      FROM "ProjectAssignment" pa
      JOIN "Project" p ON p."id" = pa."projectId"
      LEFT JOIN "OrganizationMembership" m ON m."orgId" = p."orgId" AND m."userId" = pa."userId"
      WHERE m."id" IS NULL`),
  ]);
  return { capturedAt: new Date().toISOString(), orgs, memberships, users, orphanAssignments };
};

const durableOrgIds = (state, includeOrgIds = []) =>
  new Set(state.orgs.filter((org) => !EPHEMERAL.test(org.name) || includeOrgIds.includes(org.id)).map((org) => org.id));

const summarise = (state, includeOrgIds = []) => {
  const durable = durableOrgIds(state, includeOrgIds);
  const perOrg = {};
  for (const org of state.orgs) {
    if (!durable.has(org.id)) continue;
    perOrg[org.id] = { name: org.name, kind: org.kind, memberships: 0, owners: 0, admins: 0, roles: {} };
  }
  for (const m of state.memberships) {
    const row = perOrg[m.orgId];
    if (!row) continue;
    row.memberships += 1;
    if (m.status === "active" && m.isOwner) row.owners += 1;
    if (m.status === "active" && m.isAdmin) row.admins += 1;
    row.roles[m.role] = (row.roles[m.role] || 0) + 1;
  }
  const inDurable = state.memberships.filter((m) => durable.has(m.orgId));
  return {
    organisations: durable.size,
    memberships: inDurable.length,
    owners: inDurable.filter((m) => m.status === "active" && m.isOwner).length,
    admins: inDurable.filter((m) => m.status === "active" && m.isAdmin).length,
    ephemeralOrganisations: state.orgs.length - durable.size,
    perOrg,
  };
};

const checkInvariants = (state, { includeOrgIds = [] } = {}) => {
  const durable = durableOrgIds(state, includeOrgIds);
  const usersById = new Map(state.users.map((u) => [u.id, u]));
  const membershipKey = (orgId, userId) => `${orgId}:${userId}`;
  const memberships = new Map(state.memberships.map((m) => [membershipKey(m.orgId, m.userId), m]));
  const violations = [];
  const add = (check, detail) => violations.push({ check, ...detail });

  for (const org of state.orgs) {
    if (!durable.has(org.id) || org.status !== "active") continue;
    const owners = state.memberships.filter((m) => m.orgId === org.id && m.isOwner && m.status === "active");
    if (!owners.length) add("organisation_without_owner", { orgId: org.id, orgName: org.name });
  }
  for (const m of state.memberships) {
    if (!durable.has(m.orgId)) continue;
    const user = usersById.get(m.userId);
    if (m.isOwner && (m.status !== "active" || !m.isAdmin || user?.status !== "active")) {
      add("owner_membership_invalid", { membershipId: m.id, orgId: m.orgId, email: user?.email, status: m.status, isAdmin: m.isAdmin, userStatus: user?.status });
    }
    const home = user && user.orgId === m.orgId;
    if (home && m.kind === "member" && m.role !== user.role) {
      add("role_drift", { membershipId: m.id, orgId: m.orgId, email: user.email, userRole: user.role, membershipRole: m.role });
    }
    if (home && m.isAdmin && !m.isOwner && !user.isCompanyAdmin) {
      add("admin_without_grant", { membershipId: m.id, orgId: m.orgId, email: user.email, role: m.role });
    }
  }
  for (const user of state.users) {
    if (!durable.has(user.orgId)) continue;
    if (!memberships.has(membershipKey(user.orgId, user.id))) add("user_without_home_membership", { userId: user.id, email: user.email, orgId: user.orgId });
  }
  for (const a of state.orphanAssignments) {
    if (durable.has(a.orgId)) add("assignment_without_membership", { assignmentId: a.id, projectId: a.projectId, userId: a.userId, orgId: a.orgId });
  }
  return violations;
};

const compareStates = (before, after, { includeOrgIds = [] } = {}) => {
  const durable = durableOrgIds(before, includeOrgIds);
  const now = new Map(after.memberships.map((m) => [m.id, m]));
  const email = new Map([...before.users, ...after.users].map((u) => [u.id, u.email]));
  const violations = [];
  let created = 0;
  for (const m of before.memberships) {
    if (!durable.has(m.orgId)) continue;
    const later = now.get(m.id);
    if (!later) {
      violations.push({ check: "membership_removed", membershipId: m.id, orgId: m.orgId, email: email.get(m.userId), was: m });
      continue;
    }
    const changed = WATCHED_FIELDS.filter((field) => m[field] !== later[field]);
    if (changed.length) {
      violations.push({
        check: "membership_changed",
        membershipId: m.id,
        orgId: m.orgId,
        email: email.get(m.userId),
        changes: Object.fromEntries(changed.map((field) => [field, { from: m[field], to: later[field] }])),
      });
    }
  }
  const beforeIds = new Set(before.memberships.map((m) => m.id));
  for (const m of after.memberships) if (durable.has(m.orgId) && !beforeIds.has(m.id)) created += 1;

  const activeCount = (state) => {
    const counts = new Map();
    for (const m of state.memberships) if (m.status === "active" && durable.has(m.orgId)) counts.set(m.userId, (counts.get(m.userId) || 0) + 1);
    return counts;
  };
  const had = activeCount(before);
  const has = activeCount(after);
  for (const [userId] of had) {
    if (!has.get(userId)) violations.push({ check: "user_lost_every_membership", userId, email: email.get(userId) });
  }
  // A broad change is the incident's signature: say so plainly when it happens.
  const changedByOrg = {};
  for (const v of violations) if (v.check === "membership_changed") changedByOrg[v.orgId] = (changedByOrg[v.orgId] || 0) + 1;
  const broad = Object.entries(changedByOrg).filter(([, n]) => n >= 3).map(([orgId, n]) => ({ orgId, changed: n }));
  return { violations, created, broad };
};

module.exports = { EPHEMERAL, WATCHED_FIELDS, captureState, checkInvariants, compareStates, durableOrgIds, summarise };
