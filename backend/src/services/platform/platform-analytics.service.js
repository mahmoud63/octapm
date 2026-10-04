/**
 * Product Adoption analytics (docs/platform/OCTAPM_SUPERADMIN_DESIGN.md §5).
 *
 * Behaviour only — usage, breadth, repeat use, completion. Nothing here says
 * whether people LIKE a feature; low usage is reported as low usage.
 *
 * Two evidence sources, always labelled:
 * - record activity: AuditEvent rows (who changed which kind of record) —
 *   exists for the whole history the product has kept;
 * - tracked events: ProductEvent rows (screens opened, imports, exports,
 *   searches) — only since tracking was deployed; an empty table is reported
 *   as "no tracked data yet", never as zero usage.
 *
 * Windows are bounded to 7, 30 or 90 days. Every figure is one grouped query.
 */
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { activitySql, daysAgo, LIVE_ORG_FILTER, recordModuleSql, SYSTEM_RECORD_TYPES, WINDOWS } = require("./platform-read-models");

const resolveWindow = (value) => {
  const days = Number.parseInt(value, 10);
  return WINDOWS.includes(days) ? days : 30;
};

const ratio = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);

const getProductAnalytics = async ({ windowDays, now = new Date() } = {}) => {
  const days = resolveWindow(windowDays);
  const since = daysAgo(days, now);
  const prior = daysAgo(days * 2, now);

  const [
    trackedTotal, recordModules, trackedModules, trackedEvents, activeCompanies, eligibleCompanies,
    engagement, daily, signups, returning, lastActive, repeatModules,
  ] = await Promise.all([
    prisma.$queryRaw`SELECT count(*)::int AS n, min("createdAt") AS first_at FROM "ProductEvent"`,
    prisma.$queryRaw`
      SELECT ${recordModuleSql()} AS module, count(*)::int AS events,
             count(DISTINCT "orgId")::int AS companies, count(DISTINCT "actorId")::int AS people
      FROM "AuditEvent"
      WHERE "occurredAt" >= ${since} AND "entityType" NOT IN (${Prisma.join(SYSTEM_RECORD_TYPES)}) AND ${LIVE_ORG_FILTER}
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`
      SELECT module, count(*)::int AS events, count(DISTINCT "orgId")::int AS companies,
             count(DISTINCT "userId")::int AS people
      FROM "ProductEvent" WHERE "createdAt" >= ${since} AND ${LIVE_ORG_FILTER} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`
      SELECT "eventName", module, platform, count(*)::int AS events, count(DISTINCT "orgId")::int AS companies,
             count(DISTINCT "userId")::int AS people
      FROM "ProductEvent" WHERE "createdAt" >= ${since} AND ${LIVE_ORG_FILTER} GROUP BY 1, 2, 3 ORDER BY 4 DESC`,
    prisma.$queryRaw`
      SELECT count(DISTINCT a."orgId")::int AS n
      FROM (${activitySql(since)}) a JOIN "Organisation" o ON o.id = a."orgId" AND o.status = 'active'`,
    prisma.$queryRaw`
      SELECT count(*)::int AS n FROM "Organisation" o
      WHERE o.status = 'active'
        AND EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."orgId" = o.id AND m.status = 'active')`,
    prisma.$queryRaw`
      SELECT count(DISTINCT "userId") FILTER (WHERE at >= ${daysAgo(1, now)})::int AS dau,
             count(DISTINCT "userId") FILTER (WHERE at >= ${daysAgo(7, now)})::int AS wau,
             count(DISTINCT "userId") FILTER (WHERE at >= ${daysAgo(30, now)})::int AS mau
      FROM (${activitySql(daysAgo(30, now))}) a WHERE "userId" IS NOT NULL`,
    prisma.$queryRaw`
      SELECT date_trunc('day', at)::date AS day, count(DISTINCT "userId")::int AS people,
             count(DISTINCT "orgId")::int AS companies
      FROM (${activitySql(since)}) a WHERE "userId" IS NOT NULL GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT date_trunc('day', d)::date AS day,
             count(*) FILTER (WHERE kind = 'user')::int AS new_users,
             count(*) FILTER (WHERE kind = 'org')::int AS new_companies
      FROM (
        SELECT "createdAt" AS d, 'user' AS kind FROM "User" WHERE "createdAt" >= ${since}
        UNION ALL
        SELECT "createdAt", 'org' FROM "Organisation" WHERE "createdAt" >= ${since}
      ) x GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      WITH cur AS (SELECT DISTINCT "userId" FROM (${activitySql(since)}) a WHERE "userId" IS NOT NULL),
           prev AS (SELECT DISTINCT "userId" FROM (${activitySql(prior)}) a WHERE "userId" IS NOT NULL AND at < ${since})
      SELECT (SELECT count(*)::int FROM cur) AS active,
             (SELECT count(*)::int FROM cur WHERE "userId" IN (SELECT "userId" FROM prev)) AS returning,
             (SELECT count(*)::int FROM cur c JOIN "User" u ON u.id = c."userId" WHERE u."createdAt" >= ${since}) AS new_and_active`,
    prisma.$queryRaw`
      SELECT CASE
               WHEN "lastLogin" IS NULL THEN 'never'
               WHEN "lastLogin" >= ${daysAgo(1, now)} THEN 'last_24h'
               WHEN "lastLogin" >= ${daysAgo(7, now)} THEN 'last_7d'
               WHEN "lastLogin" >= ${daysAgo(30, now)} THEN 'last_30d'
               WHEN "lastLogin" >= ${daysAgo(90, now)} THEN 'last_90d'
               ELSE 'older' END AS bucket,
             count(*)::int AS people
      FROM "User" WHERE status = 'active' GROUP BY 1`,
    prisma.$queryRaw`
      SELECT module, count(*)::int AS people, count(*) FILTER (WHERE active_days >= 2)::int AS repeat_people
      FROM (
        SELECT module, "userId", count(DISTINCT date_trunc('day', at))::int AS active_days
        FROM (
          SELECT ${recordModuleSql()} AS module, "actorId" AS "userId", "occurredAt" AS at FROM "AuditEvent"
          WHERE "occurredAt" >= ${since} AND "entityType" NOT IN (${Prisma.join(SYSTEM_RECORD_TYPES)}) AND ${LIVE_ORG_FILTER}
          UNION ALL
          SELECT module, "userId", "createdAt" FROM "ProductEvent" WHERE "createdAt" >= ${since} AND ${LIVE_ORG_FILTER}
        ) x WHERE "userId" IS NOT NULL GROUP BY 1, 2
      ) y GROUP BY 1 ORDER BY 2 DESC`,
  ]);

  const activeCount = activeCompanies[0].n;
  const eligibleCount = eligibleCompanies[0].n;
  const adoption = (rows) =>
    rows.map((r) => ({
      ...r,
      shareOfActiveCompanies: ratio(r.companies, activeCount),
      shareOfEligibleCompanies: ratio(r.companies, eligibleCount),
    }));

  return {
    windowDays: days,
    from: since.toISOString(),
    to: now.toISOString(),
    denominators: {
      activeCompanies: activeCount,
      eligibleCompanies: eligibleCount,
      definitions: {
        activeCompanies: "Active companies with a recorded change, tracked event or session in the window.",
        eligibleCompanies: "Active companies with at least one active member.",
      },
    },
    tracking: {
      trackedEventsAllTime: trackedTotal[0].n,
      trackingSince: trackedTotal[0].first_at,
      note:
        trackedTotal[0].n === 0
          ? "No tracked product events yet: screen opens, imports, exports and searches are recorded from the deployment of this release onward. Record activity below covers history."
          : null,
    },
    modules: {
      recordActivity: adoption(recordModules),
      trackedEvents: adoption(trackedModules),
      mostUsed: recordModules.slice(0, 5).map((r) => r.module),
      leastUsed: recordModules.slice(-5).reverse().map((r) => r.module),
    },
    events: trackedEvents,
    repeatUse: repeatModules.map((r) => ({ ...r, repeatRate: ratio(r.repeat_people, r.people) })),
    engagement: {
      dailyActivePeople: engagement[0].dau,
      weeklyActivePeople: engagement[0].wau,
      monthlyActivePeople: engagement[0].mau,
      activeInWindow: returning[0].active,
      returningFromPreviousWindow: returning[0].returning,
      newAndActive: returning[0].new_and_active,
      lastSignInDistribution: Object.fromEntries(lastActive.map((r) => [r.bucket, r.people])),
      daily,
      signups,
      definitions: {
        activePeople:
          "Activity-based, not sessions: a person counts when they changed a record, produced a tracked event, or had a session issued or refreshed. OctaPM has no reliable session-length model, so session counts are not reported.",
        lastSignInDistribution: "User.lastLogin of active accounts (written at password and SSO sign-in).",
      },
    },
    funnels: await getFunnels({ since }),
  };
};

/**
 * Funnels built from the canonical records' CURRENT state, for records created
 * in the window. Semantics are the records' own statuses, so they hold for the
 * whole history (not only since tracking began).
 */
const getFunnels = async ({ since }) => {
  const [setup, rfi, progress, dailyReports] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*)::int AS created,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BoqItem" b WHERE b."projectId" = p.id))::int AS boq,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Activity" a WHERE a."projectId" = p.id))::int AS schedule,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ActivityBoqAllocation" x WHERE x."projectId" = p.id AND x.status = 'approved'))::int AS mapped,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ScheduleRevision" r WHERE r."projectId" = p.id AND r."baselinedAt" IS NOT NULL))::int AS baselined
      FROM "Project" p WHERE p."createdAt" >= ${since}`,
    prisma.$queryRaw`
      SELECT count(*)::int AS created,
             count(*) FILTER (WHERE status IN ('open', 'answered', 'closed'))::int AS sent,
             count(*) FILTER (WHERE status IN ('answered', 'closed'))::int AS answered,
             count(*) FILTER (WHERE status = 'closed')::int AS closed
      FROM "Rfi" WHERE "createdAt" >= ${since}`,
    prisma.$queryRaw`
      SELECT count(*)::int AS created,
             count(*) FILTER (WHERE status IN ('submitted', 'approved', 'rejected'))::int AS submitted,
             count(*) FILTER (WHERE status = 'approved')::int AS approved,
             count(*) FILTER (WHERE status = 'rejected')::int AS rejected
      FROM "ProgressSubmission" WHERE "createdAt" >= ${since}`,
    prisma.$queryRaw`
      SELECT count(*)::int AS created,
             count(*) FILTER (WHERE status IN ('submitted', 'approved', 'rejected'))::int AS submitted,
             count(*) FILTER (WHERE status = 'approved')::int AS approved
      FROM "DailyReport" WHERE "createdAt" >= ${since}`,
  ]);
  const steps = (row, labels) =>
    labels.map(([key, label]) => ({ key, label, count: row[key], ofFirst: ratio(row[key], row[labels[0][0]]) }));
  return [
    {
      key: "project_setup",
      label: "Project setup (projects created in the window)",
      steps: steps(setup[0], [
        ["created", "Project created"],
        ["boq", "BOQ loaded"],
        ["schedule", "Schedule loaded"],
        ["mapped", "BOQ mapped to activities (approved)"],
        ["baselined", "Baseline locked"],
      ]),
    },
    {
      key: "rfi",
      label: "RFIs created in the window, by current status",
      steps: steps(rfi[0], [
        ["created", "Created"],
        ["sent", "Sent (open or later)"],
        ["answered", "Answered"],
        ["closed", "Closed"],
      ]),
    },
    {
      key: "progress",
      label: "Progress submissions created in the window",
      steps: steps(progress[0], [
        ["created", "Started"],
        ["submitted", "Submitted"],
        ["approved", "Approved"],
      ]),
      rejected: progress[0].rejected,
    },
    {
      key: "daily_reports",
      label: "Daily reports created in the window",
      steps: steps(dailyReports[0], [
        ["created", "Started"],
        ["submitted", "Submitted"],
        ["approved", "Approved"],
      ]),
    },
  ];
};

module.exports = { getFunnels, getProductAnalytics, resolveWindow };
