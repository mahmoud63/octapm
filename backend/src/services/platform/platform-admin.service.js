/**
 * Platform-admin read models: overview, companies, company detail, users,
 * projects, subscriptions (docs/platform/OCTAPM_SUPERADMIN_DESIGN.md §4).
 *
 * Read-only. Platform metadata only: names, counts, statuses, dates. No record
 * content (RFI text, documents, messages), no commercial figures (contract
 * values, budgets, costs), no credentials (password hashes, MFA secrets,
 * token hashes, provider ids). Every list is paged; every cross-organisation
 * aggregate is one grouped query, never a query per company.
 *
 * Nothing here is called by ordinary tenant routes and nothing here relaxes
 * their scoping: these are separate queries behind the platform gate.
 */
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { HttpError } = require("../../utils/http-error");
const { getRelease } = require("../../config/release");
const {
  ACTIVITY_LOOKBACK_DAYS,
  activitySql,
  daysAgo,
  pageInfo,
  paging,
  platformSubscription,
  recordModuleSql,
  SYSTEM_RECORD_TYPES,
  startOfUtcMonth,
  toInt,
} = require("./platform-read-models");

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const assertUuid = (value, code) => {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(404, code, "Not found");
};
const like = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
const getOverview = async ({ now = new Date() } = {}) => {
  const since30 = daysAgo(30, now);
  const since1 = daysAgo(1, now);
  const since7 = daysAgo(7, now);
  const monthStart = startOfUtcMonth(now);

  const [orgs, subs, users, projects, activity, invitations, storage, jobs, errors] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'active')::int AS active_status,
             count(*) FILTER (WHERE status <> 'active')::int AS inactive_status,
             count(*) FILTER (WHERE kind = 'personal')::int AS personal,
             count(*) FILTER (WHERE kind <> 'personal')::int AS company,
             count(*) FILTER (WHERE "createdAt" >= ${monthStart})::int AS new_this_month
      FROM "Organisation"`,
    prisma.$queryRaw`
      SELECT s.plan, s.status, count(*)::int AS n
      FROM "Subscription" s GROUP BY 1, 2 ORDER BY 1, 2`,
    prisma.$queryRaw`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'active')::int AS active_status,
             count(*) FILTER (WHERE "createdAt" >= ${monthStart})::int AS new_this_month
      FROM "User"`,
    prisma.$queryRaw`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE "archivedAt" IS NULL AND status <> 'archived')::int AS active,
             count(*) FILTER (WHERE "archivedAt" IS NOT NULL OR status = 'archived')::int AS archived
      FROM "Project"`,
    prisma.$queryRaw`
      SELECT count(DISTINCT a."orgId")::int AS active_orgs_30d,
             count(DISTINCT a."userId")::int AS active_users_30d,
             count(DISTINCT a."userId") FILTER (WHERE a.at >= ${since1})::int AS active_users_24h
      FROM (${activitySql(since30)}) a
      JOIN "Organisation" o ON o.id = a."orgId" AND o.status = 'active'`,
    prisma.$queryRaw`
      SELECT count(*)::int AS pending
      FROM "InvitationToken" WHERE status = 'pending' AND "expiresAt" > ${now} AND "revokedAt" IS NULL`,
    prisma.$queryRaw`SELECT coalesce(sum("sizeBytes"), 0)::bigint AS bytes, count(*)::int AS files FROM "ProjectDocument"`,
    prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE status = 'failed' AND "updatedAt" >= ${since1})::int AS failed_24h,
             count(*) FILTER (WHERE status = 'failed' AND "updatedAt" >= ${since7})::int AS failed_7d
      FROM "BackgroundJob" WHERE "updatedAt" >= ${since7}`,
    prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE status >= 500)::int AS server_24h, count(*)::int AS all_24h
      FROM "PlatformErrorEvent" WHERE "occurredAt" >= ${since1}`,
  ]);

  const byPlan = {};
  const byStatus = {};
  for (const row of subs) {
    byPlan[row.plan] = (byPlan[row.plan] || 0) + row.n;
    byStatus[row.status] = (byStatus[row.status] || 0) + row.n;
  }
  const subscribed = subs.reduce((sum, row) => sum + row.n, 0);
  const o = orgs[0];
  return {
    generatedAt: now.toISOString(),
    organisations: {
      total: o.total,
      activeStatus: o.active_status,
      suspendedOrClosed: o.inactive_status,
      company: o.company,
      personal: o.personal,
      activeLast30Days: activity[0].active_orgs_30d,
      newThisMonth: o.new_this_month,
      withoutSubscription: o.total - subscribed,
    },
    subscriptions: {
      byPlan,
      byStatus,
      trial: byPlan.trial || 0,
      business: byPlan.business || 0,
      enterprise: byPlan.enterprise || 0,
      individual: byPlan.individual || 0,
      canceledOrExpired: (byStatus.canceled || 0) + (byStatus.expired || 0),
      pastDue: byStatus.past_due || 0,
    },
    users: {
      total: users[0].total,
      activeStatus: users[0].active_status,
      activeLast24Hours: activity[0].active_users_24h,
      activeLast30Days: activity[0].active_users_30d,
      newThisMonth: users[0].new_this_month,
    },
    projects: { total: projects[0].total, active: projects[0].active, archived: projects[0].archived },
    invitations: { pending: invitations[0].pending },
    storage: { bytes: Number(storage[0].bytes), files: storage[0].files, source: "ProjectDocument.sizeBytes" },
    jobs: { failedLast24Hours: jobs[0].failed_24h, failedLast7Days: jobs[0].failed_7d },
    errors: { last24Hours: errors[0].all_24h, serverErrorsLast24Hours: errors[0].server_24h },
    release: getRelease(),
    definitions: {
      activeLast30Days:
        "Distinct people/companies with a recorded change, a tracked product event or a session issued or refreshed in the last 30 days (active companies only).",
    },
  };
};

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------
const COMPANY_SORTS = Object.freeze({
  name: Prisma.sql`lower(name) ASC, id ASC`,
  "-name": Prisma.sql`lower(name) DESC, id ASC`,
  created: Prisma.sql`"createdAt" ASC, id ASC`,
  "-created": Prisma.sql`"createdAt" DESC, id ASC`,
  members: Prisma.sql`active_members ASC, id ASC`,
  "-members": Prisma.sql`active_members DESC, id ASC`,
  projects: Prisma.sql`active_projects ASC, id ASC`,
  "-projects": Prisma.sql`active_projects DESC, id ASC`,
  activity: Prisma.sql`last_activity ASC NULLS FIRST, id ASC`,
  "-activity": Prisma.sql`last_activity DESC NULLS LAST, id ASC`,
});
const SIZE_BUCKETS = Object.freeze({
  solo: [0, 1],
  small: [2, 10],
  medium: [11, 50],
  large: [51, null],
});

const companyBaseSql = (since, { withActivity = true } = {}) => Prisma.sql`
  WITH mem AS (
    SELECT "orgId",
           count(*) FILTER (WHERE status = 'active')::int AS active_members,
           count(*)::int AS total_members
    FROM "OrganizationMembership" GROUP BY 1
  ), prj AS (
    SELECT "orgId",
           count(*) FILTER (WHERE "archivedAt" IS NULL AND status <> 'archived')::int AS active_projects,
           count(*)::int AS total_projects
    FROM "Project" GROUP BY 1
  ), act AS (
    ${
      withActivity
        ? Prisma.sql`SELECT a."orgId", max(a.at) AS last_activity FROM (${activitySql(since, { liveOrgsOnly: false })}) a GROUP BY 1`
        : Prisma.sql`SELECT NULL::text AS "orgId", NULL::timestamp AS last_activity WHERE false`
    }
  ), base AS (
    SELECT o.id, o.name, o.slug, o.kind, o.status, o."defaultTimezone" AS timezone, o."createdAt",
           s.plan, s.status AS subscription_status, s.seats,
           coalesce(mem.active_members, 0) AS active_members, coalesce(mem.total_members, 0) AS total_members,
           coalesce(prj.active_projects, 0) AS active_projects, coalesce(prj.total_projects, 0) AS total_projects,
           act.last_activity
    FROM "Organisation" o
    LEFT JOIN "Subscription" s ON s."orgId" = o.id
    LEFT JOIN mem ON mem."orgId" = o.id
    LEFT JOIN prj ON prj."orgId" = o.id
    LEFT JOIN act ON act."orgId" = o.id
  )`;

/**
 * Last activity of the given organisations only (index lookups by orgId):
 * used for a page of companies when nothing sorts or filters by activity, so
 * the list does not scan every company's 90 days of activity for 25 rows.
 */
const lastActivityFor = async (orgIds, since) => {
  if (!orgIds.length) return new Map();
  const ids = Prisma.join(orgIds);
  const rows = await prisma.$queryRaw`
    SELECT "orgId", max(at) AS last_activity FROM (
      SELECT "orgId", max("occurredAt") AS at FROM "AuditEvent"
        WHERE "orgId" IN (${ids}) AND "occurredAt" >= ${since} AND "entityType" NOT IN (${Prisma.join(SYSTEM_RECORD_TYPES)})
        GROUP BY 1
      UNION ALL
      SELECT "orgId", max("createdAt") FROM "ProductEvent" WHERE "orgId" IN (${ids}) AND "createdAt" >= ${since} GROUP BY 1
      UNION ALL
      SELECT "orgId", max("createdAt") FROM "RefreshSession" WHERE "orgId" IN (${ids}) AND "createdAt" >= ${since} GROUP BY 1
    ) x GROUP BY 1`;
  return new Map(rows.map((r) => [r.orgId, r.last_activity]));
};

const listCompanies = async (query = {}, { now = new Date() } = {}) => {
  const paged = paging(query);
  const since = daysAgo(ACTIVITY_LOOKBACK_DAYS, now);
  const active30 = daysAgo(30, now);
  const filters = [];
  if (query.q) filters.push(Prisma.sql`(name ILIKE ${like(query.q)} OR slug ILIKE ${like(query.q)})`);
  if (query.plan) filters.push(Prisma.sql`plan = ${query.plan}`);
  if (query.subscriptionStatus) filters.push(Prisma.sql`subscription_status = ${query.subscriptionStatus}`);
  if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
  if (query.kind) filters.push(Prisma.sql`kind = ${query.kind}`);
  if (query.activity === "active") filters.push(Prisma.sql`last_activity >= ${active30}`);
  if (query.activity === "inactive") filters.push(Prisma.sql`(last_activity IS NULL OR last_activity < ${active30})`);
  if (query.size && SIZE_BUCKETS[query.size]) {
    const [min, max] = SIZE_BUCKETS[query.size];
    filters.push(max === null ? Prisma.sql`active_members >= ${min}` : Prisma.sql`active_members BETWEEN ${min} AND ${max}`);
  }
  if (query.createdFrom) filters.push(Prisma.sql`"createdAt" >= ${query.createdFrom}`);
  if (query.createdTo) filters.push(Prisma.sql`"createdAt" <= ${query.createdTo}`);
  const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
  const order = COMPANY_SORTS[query.sort] || COMPANY_SORTS["-created"];
  // Activity across every company only when the order or a filter needs it.
  const withActivity = Boolean(query.activity) || String(query.sort || "").endsWith("activity");

  const rows = await prisma.$queryRaw`
    ${companyBaseSql(since, { withActivity })}
    SELECT *, count(*) OVER ()::int AS total_count FROM base ${where}
    ORDER BY ${order} LIMIT ${paged.pageSize} OFFSET ${paged.offset}`;
  const ids = rows.map((r) => r.id);
  const total = rows[0]?.total_count ?? (paged.offset ? await countCompanies(since, where, withActivity) : 0);
  const activityBy = withActivity
    ? new Map(rows.map((r) => [r.id, r.last_activity]))
    : await lastActivityFor(ids, since);

  const [storage, errors] = ids.length
    ? await Promise.all([
        prisma.$queryRaw`
          SELECT "orgId", coalesce(sum("sizeBytes"), 0)::bigint AS bytes
          FROM "ProjectDocument" WHERE "orgId" IN (${Prisma.join(ids)}) GROUP BY 1`,
        prisma.$queryRaw`
          SELECT "orgId", count(*) FILTER (WHERE status >= 500)::int AS server_errors
          FROM "PlatformErrorEvent" WHERE "orgId" IN (${Prisma.join(ids)}) AND "occurredAt" >= ${daysAgo(7, now)}
          GROUP BY 1`,
      ])
    : [[], []];
  const bytesBy = new Map(storage.map((r) => [r.orgId, Number(r.bytes)]));
  const errorsBy = new Map(errors.map((r) => [r.orgId, r.server_errors]));

  return {
    items: rows.map((r) => {
      const flags = [];
      if (r.status !== "active") flags.push("organisation_inactive");
      if (!r.plan) flags.push("no_subscription");
      if (r.subscription_status === "past_due") flags.push("payment_past_due");
      if (r.subscription_status === "expired" || r.subscription_status === "canceled") flags.push("subscription_ended");
      if (r.plan && !["trial", "individual", "business", "enterprise"].includes(r.plan)) flags.push("plan_unrecognized");
      if (r.seats && r.active_members > r.seats) flags.push("members_exceed_seats");
      if ((errorsBy.get(r.id) || 0) > 0) flags.push("server_errors_7d");
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        workspaceType: r.kind,
        status: r.status,
        timezone: r.timezone,
        createdAt: r.createdAt,
        plan: r.plan,
        subscriptionStatus: r.subscription_status,
        seats: r.seats,
        activeMembers: r.active_members,
        totalMembers: r.total_members,
        activeProjects: r.active_projects,
        totalProjects: r.total_projects,
        lastActivityAt: activityBy.get(r.id) || null,
        storageBytes: bytesBy.get(r.id) || 0,
        serverErrors7d: errorsBy.get(r.id) || 0,
        healthFlags: flags,
      };
    }),
    page: pageInfo(paged, total),
    definitions: {
      lastActivityAt: `Latest recorded change, tracked product event or session within the last ${ACTIVITY_LOOKBACK_DAYS} days; null = none in that window.`,
    },
  };
};

const countCompanies = async (since, where, withActivity) => {
  const rows = await prisma.$queryRaw`${companyBaseSql(since, { withActivity })} SELECT count(*)::int AS n FROM base ${where}`;
  return rows[0].n;
};

// ---------------------------------------------------------------------------
// Company detail
// ---------------------------------------------------------------------------
const MEMBER_LIMIT = 200;
const PROJECT_LIMIT = 200;

const getCompany = async (orgId, { now = new Date() } = {}) => {
  assertUuid(orgId, "PLATFORM_COMPANY_NOT_FOUND");
  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: {
      id: true, name: true, slug: true, kind: true, status: true, defaultTimezone: true,
      defaultCurrency: true, createdAt: true, ssoEnabled: true, ssoRequired: true, mfaRequired: true,
    },
  });
  if (!org) throw new HttpError(404, "PLATFORM_COMPANY_NOT_FOUND", "Company not found");

  const since30 = daysAgo(30, now);
  const since90 = daysAgo(ACTIVITY_LOOKBACK_DAYS, now);
  const [
    subscription, lastInvoice, memberStats, roleStats, members, projects, projectActivity,
    recordUsage, trackedUsage, errorStats, jobStats, failedJobs, invitations, storage, platformViews,
  ] = await Promise.all([
    prisma.subscription.findUnique({ where: { orgId } }),
    prisma.invoice.findFirst({
      where: { subscription: { orgId } },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    }),
    prisma.$queryRaw`
      SELECT status, count(*)::int AS n,
             count(*) FILTER (WHERE "isAdmin" OR "isOwner")::int AS admins,
             count(*) FILTER (WHERE "isOwner")::int AS owners,
             count(*) FILTER (WHERE kind = 'guest')::int AS guests
      FROM "OrganizationMembership" WHERE "orgId" = ${orgId} GROUP BY 1`,
    prisma.$queryRaw`
      SELECT role, count(*)::int AS n FROM "OrganizationMembership"
      WHERE "orgId" = ${orgId} AND status = 'active' GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`
      SELECT u.id, u.name, u.email, u.status AS user_status, u."lastLogin", m.role, m.kind, m.status,
             m."isAdmin", m."isOwner", m."joinedAt", m."createdAt"
      FROM "OrganizationMembership" m JOIN "User" u ON u.id = m."userId"
      WHERE m."orgId" = ${orgId}
      ORDER BY lower(u.name), u.id LIMIT ${MEMBER_LIMIT}`,
    prisma.$queryRaw`
      SELECT p.id, p.name, p.status, p."createdAt", p."archivedAt",
             (SELECT count(*)::int FROM "ProjectAssignment" pa WHERE pa."projectId" = p.id) AS members
      FROM "Project" p WHERE p."orgId" = ${orgId}
      ORDER BY p."createdAt" DESC, p.id LIMIT ${PROJECT_LIMIT}`,
    prisma.$queryRaw`
      SELECT "projectId", max("occurredAt") AS last_activity, count(*) FILTER (WHERE "occurredAt" >= ${since30})::int AS changes_30d
      FROM "AuditEvent" WHERE "orgId" = ${orgId} AND "projectId" IS NOT NULL AND "occurredAt" >= ${since90}
      GROUP BY 1`,
    prisma.$queryRaw`
      SELECT ${recordModuleSql()} AS module, action, count(*)::int AS events, count(DISTINCT "actorId")::int AS people
      FROM "AuditEvent"
      WHERE "orgId" = ${orgId} AND "occurredAt" >= ${since30} AND "entityType" NOT IN (${Prisma.join(SYSTEM_RECORD_TYPES)})
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    prisma.$queryRaw`
      SELECT "eventName", module, count(*)::int AS events, count(DISTINCT "userId")::int AS people
      FROM "ProductEvent" WHERE "orgId" = ${orgId} AND "createdAt" >= ${since30}
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    prisma.$queryRaw`
      SELECT code, status, count(*)::int AS n FROM "PlatformErrorEvent"
      WHERE "orgId" = ${orgId} AND "occurredAt" >= ${since30} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
    prisma.$queryRaw`
      SELECT status, count(*)::int AS n FROM "BackgroundJob"
      WHERE "orgId" = ${orgId} AND "createdAt" >= ${since30} GROUP BY 1`,
    prisma.backgroundJob.findMany({
      where: { orgId, status: "failed", updatedAt: { gte: since30 } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, type: true, errorCode: true, attempts: true, maxAttempts: true, finishedAt: true, updatedAt: true },
    }),
    prisma.invitationToken.count({ where: { orgId, status: "pending", expiresAt: { gt: now }, revokedAt: null } }),
    prisma.$queryRaw`
      SELECT coalesce(sum("sizeBytes"), 0)::bigint AS bytes, count(*)::int AS files
      FROM "ProjectDocument" WHERE "orgId" = ${orgId}`,
    prisma.platformAuditEvent.findMany({
      where: { targetOrgId: orgId },
      orderBy: { occurredAt: "desc" },
      take: 20,
      select: { actorEmail: true, action: true, statusCode: true, occurredAt: true },
    }),
  ]);

  const activityBy = new Map(projectActivity.map((r) => [r.projectId, r]));
  const membersByStatus = Object.fromEntries(memberStats.map((r) => [r.status, r.n]));
  const active = memberStats.find((r) => r.status === "active");

  return {
    company: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      workspaceType: org.kind,
      status: org.status,
      timezone: org.defaultTimezone,
      currency: org.defaultCurrency,
      createdAt: org.createdAt,
      security: { ssoEnabled: org.ssoEnabled, ssoRequired: org.ssoRequired, mfaRequired: org.mfaRequired },
    },
    subscription: platformSubscription(subscription, { lastInvoiceStatus: lastInvoice?.status || null }),
    members: {
      byStatus: membersByStatus,
      activeAdmins: active?.admins || 0,
      activeOwners: active?.owners || 0,
      activeGuests: active?.guests || 0,
      activeByRole: roleStats,
      pendingInvitations: invitations,
      listed: members.length,
      limit: MEMBER_LIMIT,
      items: members.map((m) => ({
        userId: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        kind: m.kind,
        membershipStatus: m.status,
        accountStatus: m.user_status,
        isAdmin: m.isAdmin,
        isOwner: m.isOwner,
        joinedAt: m.joinedAt || m.createdAt,
        lastLoginAt: m.lastLogin,
      })),
    },
    projects: {
      listed: projects.length,
      limit: PROJECT_LIMIT,
      items: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.archivedAt ? "archived" : p.status,
        createdAt: p.createdAt,
        archivedAt: p.archivedAt,
        members: p.members,
        lastActivityAt: activityBy.get(p.id)?.last_activity || null,
        recordChanges30d: activityBy.get(p.id)?.changes_30d || 0,
      })),
    },
    usage: {
      windowDays: 30,
      recordActivity: recordUsage,
      trackedEvents: trackedUsage,
    },
    errors: { windowDays: 30, byCode: errorStats },
    jobs: {
      windowDays: 30,
      byStatus: Object.fromEntries(jobStats.map((r) => [r.status, r.n])),
      recentFailures: failedJobs,
    },
    storage: { bytes: Number(storage[0].bytes), files: storage[0].files },
    platformAccess: { recentViews: platformViews },
  };
};

/**
 * The total for a page: the window count on its rows, or — when a page past
 * the end came back empty — the total of page 1 (pre-merge review CX-8).
 */
const totalOf = async (rows, paged, firstPage) =>
  rows[0]?.total_count ?? (paged.offset ? (await firstPage()).page.total : 0);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const USER_SORTS = Object.freeze({
  name: Prisma.sql`lower(u.name) ASC, u.id ASC`,
  "-created": Prisma.sql`u."createdAt" DESC, u.id ASC`,
  created: Prisma.sql`u."createdAt" ASC, u.id ASC`,
  "-lastLogin": Prisma.sql`u."lastLogin" DESC NULLS LAST, u.id ASC`,
  lastLogin: Prisma.sql`u."lastLogin" ASC NULLS FIRST, u.id ASC`,
  "-memberships": Prisma.sql`coalesce(mem.active_memberships, 0) DESC, u.id ASC`,
});

const listUsers = async (query = {}, { now = new Date() } = {}) => {
  const paged = paging(query);
  const filters = [];
  if (query.q) filters.push(Prisma.sql`(u.name ILIKE ${like(query.q)} OR u.email ILIKE ${like(query.q)})`);
  if (query.status) filters.push(Prisma.sql`u.status = ${query.status}`);
  if (query.multiCompany === "true") filters.push(Prisma.sql`coalesce(mem.active_memberships, 0) >= 2`);
  if (query.orgId && UUID.test(query.orgId)) {
    filters.push(Prisma.sql`EXISTS (SELECT 1 FROM "OrganizationMembership" x WHERE x."userId" = u.id AND x."orgId" = ${query.orgId})`);
  }
  if (query.lastLogin === "never") filters.push(Prisma.sql`u."lastLogin" IS NULL`);
  if (query.lastLogin === "30d") filters.push(Prisma.sql`u."lastLogin" >= ${daysAgo(30, now)}`);
  if (query.lastLogin === "stale") filters.push(Prisma.sql`u."lastLogin" < ${daysAgo(90, now)}`);
  const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
  const order = USER_SORTS[query.sort] || USER_SORTS["-created"];

  const rows = await prisma.$queryRaw`
    WITH mem AS (
      SELECT m."userId",
             count(*)::int AS memberships,
             count(*) FILTER (WHERE m.status = 'active')::int AS active_memberships,
             (array_agg(json_build_object('id', o.id, 'name', o.name, 'role', m.role, 'status', m.status)
                        ORDER BY (m.status = 'active') DESC, lower(o.name)))[1:5] AS companies
      FROM "OrganizationMembership" m JOIN "Organisation" o ON o.id = m."orgId"
      GROUP BY 1
    )
    SELECT u.id, u.name, u.email, u.status, u."createdAt", u."lastLogin", u."mfaEnabled",
           (u."ssoSubject" IS NOT NULL) AS sso_linked,
           coalesce(mem.memberships, 0) AS memberships, coalesce(mem.active_memberships, 0) AS active_memberships,
           coalesce(mem.companies, ARRAY[]::json[]) AS companies,
           (pa.status = 'active') AS platform_operator,
           count(*) OVER ()::int AS total_count
    FROM "User" u
    LEFT JOIN mem ON mem."userId" = u.id
    LEFT JOIN "PlatformUserAccess" pa ON pa."userId" = u.id
    ${where}
    ORDER BY ${order} LIMIT ${paged.pageSize} OFFSET ${paged.offset}`;

  const emails = rows.map((r) => r.email);
  const pending = emails.length
    ? await prisma.$queryRaw`
        SELECT lower(email) AS email, count(*)::int AS n FROM "InvitationToken"
        WHERE lower(email) IN (${Prisma.join(emails.map((e) => e.toLowerCase()))})
          AND status = 'pending' AND "expiresAt" > ${now} AND "revokedAt" IS NULL
        GROUP BY 1`
    : [];
  const pendingBy = new Map(pending.map((r) => [r.email, r.n]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      accountStatus: r.status,
      createdAt: r.createdAt,
      lastLoginAt: r.lastLogin,
      mfaEnabled: r.mfaEnabled,
      ssoLinked: r.sso_linked,
      memberships: r.memberships,
      activeMemberships: r.active_memberships,
      companies: r.companies,
      pendingInvitations: pendingBy.get(r.email.toLowerCase()) || 0,
      platformOperator: Boolean(r.platform_operator),
    })),
    page: pageInfo(paged, await totalOf(rows, paged, () => listUsers({ ...query, page: 1, pageSize: 1 }, { now }))),
    definitions: {
      role: "A person has a role per company membership; there is no platform-wide role. companies lists up to five memberships.",
    },
  };
};

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
const PROJECT_SORTS = Object.freeze({
  "-created": Prisma.sql`p."createdAt" DESC, p.id ASC`,
  created: Prisma.sql`p."createdAt" ASC, p.id ASC`,
  name: Prisma.sql`lower(p.name) ASC, p.id ASC`,
  company: Prisma.sql`lower(o.name) ASC, lower(p.name) ASC, p.id ASC`,
});

const listProjects = async (query = {}, { now = new Date() } = {}) => {
  const paged = paging(query);
  const filters = [];
  if (query.q) filters.push(Prisma.sql`(p.name ILIKE ${like(query.q)} OR o.name ILIKE ${like(query.q)})`);
  if (query.orgId && UUID.test(query.orgId)) filters.push(Prisma.sql`p."orgId" = ${query.orgId}`);
  if (query.status === "archived") filters.push(Prisma.sql`(p."archivedAt" IS NOT NULL OR p.status = 'archived')`);
  else if (query.status === "active") filters.push(Prisma.sql`(p."archivedAt" IS NULL AND p.status <> 'archived')`);
  else if (query.status) filters.push(Prisma.sql`p.status = ${query.status} AND p."archivedAt" IS NULL`);
  const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
  const order = PROJECT_SORTS[query.sort] || PROJECT_SORTS["-created"];

  const rows = await prisma.$queryRaw`
    SELECT p.id, p.name, p.status, p."createdAt", p."archivedAt", o.id AS org_id, o.name AS org_name,
           count(*) OVER ()::int AS total_count
    FROM "Project" p JOIN "Organisation" o ON o.id = p."orgId"
    ${where}
    ORDER BY ${order} LIMIT ${paged.pageSize} OFFSET ${paged.offset}`;
  const ids = rows.map((r) => r.id);
  const since90 = daysAgo(ACTIVITY_LOOKBACK_DAYS, now);
  const since30 = daysAgo(30, now);
  const [members, activity, modules] = ids.length
    ? await Promise.all([
        prisma.$queryRaw`
          SELECT "projectId", count(*)::int AS n FROM "ProjectAssignment"
          WHERE "projectId" IN (${Prisma.join(ids)}) GROUP BY 1`,
        prisma.$queryRaw`
          SELECT "projectId", max("occurredAt") AS last_activity,
                 count(*) FILTER (WHERE "occurredAt" >= ${since30})::int AS changes_30d
          FROM "AuditEvent" WHERE "projectId" IN (${Prisma.join(ids)}) AND "occurredAt" >= ${since90}
          GROUP BY 1`,
        prisma.$queryRaw`
          SELECT "projectId", array_agg(DISTINCT module ORDER BY module) AS modules
          FROM (
            SELECT "projectId", ${recordModuleSql()} AS module FROM "AuditEvent"
            WHERE "projectId" IN (${Prisma.join(ids)}) AND "occurredAt" >= ${since30}
              AND "entityType" NOT IN (${Prisma.join(SYSTEM_RECORD_TYPES)})
            UNION ALL
            SELECT "projectId", module FROM "ProductEvent"
            WHERE "projectId" IN (${Prisma.join(ids)}) AND "createdAt" >= ${since30}
          ) x GROUP BY 1`,
      ])
    : [[], [], []];
  const membersBy = new Map(members.map((r) => [r.projectId, r.n]));
  const activityBy = new Map(activity.map((r) => [r.projectId, r]));
  const modulesBy = new Map(modules.map((r) => [r.projectId, r.modules]));

  return {
    items: rows.map((r) => {
      const act = activityBy.get(r.id);
      const archived = Boolean(r.archivedAt) || r.status === "archived";
      const health = [];
      if (!archived && !act) health.push("no_activity_90d");
      if ((membersBy.get(r.id) || 0) === 0) health.push("no_members");
      return {
        id: r.id,
        name: r.name,
        status: archived ? "archived" : r.status,
        createdAt: r.createdAt,
        archivedAt: r.archivedAt,
        organisation: { id: r.org_id, name: r.org_name },
        members: membersBy.get(r.id) || 0,
        lastActivityAt: act?.last_activity || null,
        recordChanges30d: act?.changes_30d || 0,
        modulesUsed30d: modulesBy.get(r.id) || [],
        healthFlags: health,
      };
    }),
    page: pageInfo(paged, await totalOf(rows, paged, () => listProjects({ ...query, page: 1, pageSize: 1 }, { now }))),
  };
};

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
const SUBSCRIPTION_SORTS = Object.freeze({
  company: Prisma.sql`lower(o.name) ASC, o.id ASC`,
  "-updated": Prisma.sql`s."updatedAt" DESC, s.id ASC`,
  trialEnds: Prisma.sql`s."trialEndsAt" ASC NULLS LAST, s.id ASC`,
  periodEnd: Prisma.sql`s."currentPeriodEnd" ASC NULLS LAST, s.id ASC`,
});

const listSubscriptions = async (query = {}, { now = new Date() } = {}) => {
  const paged = paging(query);
  const filters = [];
  if (query.q) filters.push(Prisma.sql`o.name ILIKE ${like(query.q)}`);
  if (query.plan) filters.push(Prisma.sql`s.plan = ${query.plan}`);
  if (query.status) filters.push(Prisma.sql`s.status = ${query.status}`);
  if (query.paymentIssue === "true") filters.push(Prisma.sql`(s.status = 'past_due' OR inv.status = 'failed')`);
  if (query.trialEndingDays) {
    const days = Math.min(90, Math.max(1, Number.parseInt(query.trialEndingDays, 10) || 7));
    filters.push(Prisma.sql`s.status = 'trialing' AND s."trialEndsAt" BETWEEN ${now} AND ${daysAgo(-days, now)}`);
  }
  const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
  const order = SUBSCRIPTION_SORTS[query.sort] || SUBSCRIPTION_SORTS.company;

  const [rows, summary] = await Promise.all([
    prisma.$queryRaw`
      SELECT s.*, o.name AS org_name, o.kind AS org_kind, o.status AS org_status, inv.status AS last_invoice_status,
             (SELECT count(*)::int FROM "OrganizationMembership" m WHERE m."orgId" = o.id AND m.status = 'active') AS active_members,
             count(*) OVER ()::int AS total_count
      FROM "Subscription" s
      JOIN "Organisation" o ON o.id = s."orgId"
      LEFT JOIN LATERAL (
        SELECT i.status FROM "Invoice" i WHERE i."subscriptionId" = s.id ORDER BY i."createdAt" DESC LIMIT 1
      ) inv ON true
      ${where}
      ORDER BY ${order} LIMIT ${paged.pageSize} OFFSET ${paged.offset}`,
    prisma.$queryRaw`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE s.status = 'trialing' AND s."trialEndsAt" BETWEEN ${now} AND ${daysAgo(-7, now)})::int AS trials_ending_7d,
             count(*) FILTER (WHERE s.status = 'past_due')::int AS past_due,
             count(*) FILTER (WHERE s."cancelAtPeriodEnd")::int AS cancel_at_period_end,
             count(*) FILTER (WHERE s.plan NOT IN ('trial', 'individual', 'business', 'enterprise'))::int AS unrecognized_plan
      FROM "Subscription" s`,
  ]);
  return {
    items: rows.map((r) => ({
      organisation: { id: r.orgId, name: r.org_name, workspaceType: r.org_kind, status: r.org_status },
      activeMembers: r.active_members,
      updatedAt: r.updatedAt,
      ...platformSubscription(r, { lastInvoiceStatus: r.last_invoice_status || null }),
    })),
    summary: {
      total: summary[0].total,
      trialsEndingIn7Days: summary[0].trials_ending_7d,
      pastDue: summary[0].past_due,
      cancelAtPeriodEnd: summary[0].cancel_at_period_end,
      unrecognizedPlan: summary[0].unrecognized_plan,
    },
    page: pageInfo(paged, await totalOf(rows, paged, () => listSubscriptions({ ...query, page: 1, pageSize: 1 }, { now }))),
  };
};

module.exports = {
  COMPANY_SORTS,
  PROJECT_SORTS,
  SUBSCRIPTION_SORTS,
  USER_SORTS,
  getCompany,
  getOverview,
  listCompanies,
  listProjects,
  listSubscriptions,
  listUsers,
  toInt,
};
