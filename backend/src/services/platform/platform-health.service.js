/**
 * System Health and error analytics for the platform console
 * (docs/platform/OCTAPM_SUPERADMIN_DESIGN.md §6).
 *
 * Built on what already exists — the readiness check's SELECT 1, the
 * BackgroundJob table, the scheduler leader's advisory lock, webhook and
 * notification delivery rows, the release identity — plus the count-only
 * PlatformErrorEvent. No hostnames, connection strings, database names,
 * error messages or stack traces are returned; error detail stays in the
 * redacted server log, found by request id.
 */
const { prisma } = require("../../config/db");
const { getRelease } = require("../../config/release");
const telemetry = require("./telemetry.service");
const { daysAgo } = require("./platform-read-models");

// scheduler-leader.js: pg_try_advisory_lock(918273::int4, hashtext(key))
const SCHEDULER_LOCK_CLASS = 918273;
const STUCK_AFTER_MS = 5 * 60 * 1000; // matches the worker's default JOB_STALE_MS

const checkDatabase = async () => {
  const started = Date.now();
  try {
    const [row] = await prisma.$queryRaw`
      -- Estimated from the catalogue (pages as of the last VACUUM/ANALYZE):
      -- pg_database_size() walks every data file and took 1.4 s on 300k rows.
      SELECT (SELECT sum(relpages)::bigint FROM pg_class) * current_setting('block_size')::bigint AS bytes,
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
             (SELECT count(*)::int FROM pg_stat_activity
               WHERE datname = current_database() AND state = 'active' AND now() - query_start > interval '30 seconds') AS long_running`;
    return {
      ok: true,
      latencyMs: Date.now() - started,
      sizeBytes: Number(row.bytes), // estimate: catalogue pages × block size
      connections: row.connections,
      queriesOver30s: row.long_running,
    };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
};

const envFlag = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
};

const getSystemHealth = async ({ now = new Date() } = {}) => {
  const since1 = daysAgo(1, now);
  const since7 = daysAgo(7, now);
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);

  const [database, jobs, queue, recentFailedJobs, lastWorker, scheduler, webhooks, deliveries, deliveryErrors] =
    await Promise.all([
      checkDatabase(),
      prisma.$queryRaw`
        SELECT status, count(*)::int AS n FROM "BackgroundJob" WHERE "updatedAt" >= ${since1} GROUP BY 1`,
      prisma.$queryRaw`
        SELECT count(*) FILTER (WHERE status = 'queued' AND "runAfter" <= ${now})::int AS ready,
               count(*) FILTER (WHERE status = 'queued' AND "runAfter" > ${now})::int AS scheduled,
               count(*) FILTER (WHERE status = 'running')::int AS running,
               count(*) FILTER (WHERE status = 'running' AND coalesce("heartbeatAt", "startedAt", "updatedAt") < ${stuckBefore})::int AS stuck,
               min("runAfter") FILTER (WHERE status = 'queued' AND "runAfter" <= ${now}) AS oldest_ready
        FROM "BackgroundJob" WHERE status IN ('queued', 'running')`,
      prisma.$queryRaw`
        SELECT j.id, j.type, j."errorCode", j.attempts, j."maxAttempts", j."updatedAt", j."orgId", o.name AS org_name
        FROM "BackgroundJob" j LEFT JOIN "Organisation" o ON o.id = j."orgId"
        WHERE j.status = 'failed' AND j."updatedAt" >= ${since7}
        ORDER BY j."updatedAt" DESC LIMIT 20`,
      prisma.$queryRaw`
        SELECT max(coalesce("heartbeatAt", "finishedAt", "startedAt")) AS at FROM "BackgroundJob"
        WHERE "updatedAt" >= ${since7}`,
      prisma.$queryRaw`
        SELECT count(*)::int AS holders FROM pg_locks
        WHERE locktype = 'advisory' AND classid = ${SCHEDULER_LOCK_CLASS}::oid AND granted
          -- pg_locks is cluster-wide: only a leader of THIS database counts.
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      prisma.$queryRaw`
        SELECT status, count(*)::int AS n FROM "WebhookDelivery" WHERE "createdAt" >= ${since7} GROUP BY 1`,
      prisma.$queryRaw`
        SELECT channel, status, count(*)::int AS n FROM "NotificationDeliveryAttempt"
        WHERE "createdAt" >= ${since7} GROUP BY 1, 2 ORDER BY 1, 2`,
      prisma.$queryRaw`
        SELECT channel, coalesce("errorCode", 'UNSPECIFIED') AS code, count(*)::int AS n
        FROM "NotificationDeliveryAttempt"
        WHERE "createdAt" >= ${since7} AND status IN ('failed', 'dead', 'error')
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
    ]);

  const workerEnabled = envFlag("JOB_WORKER_ENABLED", true);
  const schedulersEnabled = envFlag("SCHEDULERS_ENABLED", true);
  return {
    generatedAt: now.toISOString(),
    release: { ...getRelease(), uptimeSeconds: Math.round(process.uptime()), node: process.version },
    database,
    jobs: {
      last24HoursByStatus: Object.fromEntries(jobs.map((r) => [r.status, r.n])),
      queue: {
        readyToRun: queue[0].ready,
        scheduledLater: queue[0].scheduled,
        running: queue[0].running,
        stuck: queue[0].stuck,
        oldestReadySince: queue[0].oldest_ready,
        stuckDefinition: `running with no heartbeat for ${STUCK_AFTER_MS / 60000} minutes`,
      },
      recentFailures: recentFailedJobs.map((j) => ({
        id: j.id,
        type: j.type,
        errorCode: j.errorCode,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
        failedAt: j.updatedAt,
        organisation: j.orgId ? { id: j.orgId, name: j.org_name } : null,
      })),
    },
    worker: {
      enabledInThisProcess: workerEnabled,
      lastJobActivityAt: lastWorker[0].at,
      note: "Worker liveness is inferred from job heartbeats/finishes; there is no separate worker heartbeat record.",
    },
    scheduler: {
      enabledInThisProcess: schedulersEnabled,
      leaderLockHeld: scheduler[0].holders > 0,
      note: "A held leader lock means some process is running the schedulers; per-scheduler last-run times are not recorded.",
    },
    webhooks: { last7DaysByStatus: Object.fromEntries(webhooks.map((r) => [r.status, r.n])) },
    notifications: { last7Days: deliveries, failuresByCode: deliveryErrors },
    telemetry: telemetry.stats(),
  };
};

/**
 * Spike days: at least 10 errors and more than 3× the median day of the last
 * `days` UTC calendar days, today included. Days with no error row count as
 * zero — the database only returns days that had errors, and a median over
 * those alone hid a single bad day among quiet ones (pre-merge review CX-6).
 * `daily` rows are { day: Date|string (UTC date), n }.
 */
const detectSpikes = (daily, { days = 14, now = new Date() } = {}) => {
  const key = (d) => new Date(d).toISOString().slice(0, 10);
  const byDay = new Map(daily.map((d) => [key(d.day), Number(d.n) || 0]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const series = Array.from({ length: days }, (_, i) => {
    const day = new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, n: byDay.get(day) || 0 };
  });
  const sorted = series.map((d) => d.n).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return series.filter((d) => d.n >= 10 && d.n > 3 * Math.max(1, median)).map((d) => d.day);
};

const getErrorAnalytics = async ({ now = new Date() } = {}) => {
  const since1 = daysAgo(1, now);
  const since7 = daysAgo(7, now);
  const since14 = daysAgo(14, now);
  const [summary, byCode, byModule, byOrg, byRoute, daily] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE "occurredAt" >= ${since1})::int AS all_24h,
             count(*) FILTER (WHERE "occurredAt" >= ${since1} AND status >= 500)::int AS server_24h,
             count(*)::int AS all_7d,
             count(*) FILTER (WHERE status >= 500)::int AS server_7d
      FROM "PlatformErrorEvent" WHERE "occurredAt" >= ${since7}`,
    prisma.$queryRaw`
      SELECT code, min(status)::int AS status, count(*)::int AS n FROM "PlatformErrorEvent"
      WHERE "occurredAt" >= ${since7} GROUP BY 1 ORDER BY 3 DESC LIMIT 20`,
    prisma.$queryRaw`
      SELECT coalesce(module, '(unmatched)') AS module, count(*)::int AS n,
             count(*) FILTER (WHERE status >= 500)::int AS server
      FROM "PlatformErrorEvent" WHERE "occurredAt" >= ${since7} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    prisma.$queryRaw`
      SELECT e."orgId", o.name AS org_name, count(*)::int AS n, count(*) FILTER (WHERE e.status >= 500)::int AS server
      FROM "PlatformErrorEvent" e LEFT JOIN "Organisation" o ON o.id = e."orgId"
      WHERE e."occurredAt" >= ${since7} AND e."orgId" IS NOT NULL
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`,
    prisma.$queryRaw`
      SELECT method, "routePattern", count(*)::int AS n, count(*) FILTER (WHERE status >= 500)::int AS server
      FROM "PlatformErrorEvent" WHERE "occurredAt" >= ${since7} AND status >= 500
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`,
    prisma.$queryRaw`
      SELECT date_trunc('day', "occurredAt")::date AS day, count(*)::int AS n,
             count(*) FILTER (WHERE status >= 500)::int AS server
      FROM "PlatformErrorEvent" WHERE "occurredAt" >= ${since14} GROUP BY 1 ORDER BY 1`,
  ]);
  const spikes = detectSpikes(daily, { days: 14, now });
  return {
    summary: {
      last24Hours: summary[0].all_24h,
      serverErrorsLast24Hours: summary[0].server_24h,
      last7Days: summary[0].all_7d,
      serverErrorsLast7Days: summary[0].server_7d,
    },
    topCodes: byCode,
    byModule,
    byOrganisation: byOrg.map((r) => ({ organisation: { id: r.orgId, name: r.org_name }, n: r.n, server: r.server })),
    topServerErrorRoutes: byRoute,
    daily,
    spikes,
    definitions: {
      recorded: "Every API response with status >= 400 except TOKEN_EXPIRED (the normal refresh cycle). Code, status, route pattern and company only — messages and stack traces stay in the server log, found by request id.",
      spike: "A day with at least 10 errors and more than three times the median day of the last 14 days.",
    },
  };
};

module.exports = { detectSpikes, getErrorAnalytics, getSystemHealth, SCHEDULER_LOCK_CLASS };
