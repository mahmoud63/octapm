/**
 * Platform AI usage (Superadmin integration, 2026-10-11): read only from the
 * AI gateway's own ledger (AiRun — one row per model call: who, which
 * feature, provider/model, status, token counts, latency, estimated cost).
 * The ledger never holds a prompt or an answer and nothing here reads one.
 * Cost is an estimate from the configured price table (services/ai/pricing.js,
 * AI_PRICE_OVERRIDES) and is null for a model with no configured price —
 * the provider's invoice is the record.
 *
 * Every query is bounded by its window on AiRun.createdAt.
 */
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { daysAgo } = require("./platform-read-models");

const WINDOWS = Object.freeze([1, 7, 30, 90]);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const startOfUtcDay = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const n = (value) => (value === null || value === undefined ? 0 : Number(value));
const nullable = (value) => (value === null || value === undefined ? null : Number(value));

/** The gateway's configured provider and limits — names and numbers only, never a key. */
const configuration = () => {
  const gateway = require("../ai/gateway");
  const caps = gateway.capabilities({ detailed: true });
  const limits = gateway.limits();
  return {
    mode: caps.mode,
    provider: caps.provider,
    model: caps.model,
    fastModel: process.env.AI_FAST_MODEL || null,
    limits: {
      dailyTokensPerOrganisation: limits.orgTokens || null,
      dailyTokensPerUser: limits.userTokens || null,
      dailyRequestsPerUser: limits.userCalls || null,
      maxOutputTokensPerAnswer: limits.maxOutput || null,
      note: "Daily limits run per UTC day; 0 / null means no limit. Configured on the API (AI_DAILY_* variables); the console cannot change them.",
    },
    pricing: process.env.AI_PRICE_OVERRIDES ? "configured overrides + built-in table" : "built-in table only",
  };
};

const summarise = (row) => ({
  requests: n(row.requests),
  ok: n(row.ok),
  failed: n(row.failed),
  blocked: n(row.blocked),
  disabled: n(row.disabled),
  inputTokens: n(row.input_tokens),
  outputTokens: n(row.output_tokens),
  totalTokens: n(row.input_tokens) + n(row.output_tokens),
  estimatedCostMicros: nullable(row.cost_micros),
  // Successful calls whose model has no configured price: their cost is unknown, never guessed.
  unpricedRequests: n(row.unpriced),
  avgLatencyMs: nullable(row.avg_latency),
  p95LatencyMs: nullable(row.p95_latency),
});

const AGG = Prisma.sql`
  count(*)::int AS requests,
  count(*) FILTER (WHERE r.status = 'ok')::int AS ok,
  count(*) FILTER (WHERE r.status = 'failed')::int AS failed,
  count(*) FILTER (WHERE r.status = 'blocked')::int AS blocked,
  count(*) FILTER (WHERE r.status = 'disabled')::int AS disabled,
  coalesce(sum(r."inputTokens"), 0)::bigint AS input_tokens,
  coalesce(sum(r."outputTokens"), 0)::bigint AS output_tokens,
  sum(r."costMicros")::bigint AS cost_micros,
  count(*) FILTER (WHERE r.status = 'ok' AND r."costMicros" IS NULL)::int AS unpriced,
  round(avg(r."latencyMs") FILTER (WHERE r.status = 'ok'))::int AS avg_latency,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY r."latencyMs") FILTER (WHERE r.status = 'ok'))::int AS p95_latency`;

/**
 * AI usage over a window (default 7 days), platform-wide or for one
 * organisation: totals today and in the window, by model, by feature/module,
 * by organisation (with today's tokens against the configured organisation
 * limit), by user, failures by error class, and the daily series.
 */
const getAiUsage = async ({ days, orgId = null, now = new Date() } = {}) => {
  const window = WINDOWS.includes(Number(days)) ? Number(days) : 7;
  const since = daysAgo(window, now);
  const today = startOfUtcDay(now);
  const org = orgId && UUID.test(orgId) ? Prisma.sql`AND r."orgId" = ${orgId}` : Prisma.empty;
  const cfg = configuration();

  const [todayRow, windowRow, byModel, byFeature, byOrg, byUser, failures, daily, orgToday] = await Promise.all([
    prisma.$queryRaw`SELECT ${AGG} FROM "AiRun" r WHERE r."createdAt" >= ${today} ${org}`,
    prisma.$queryRaw`SELECT ${AGG} FROM "AiRun" r WHERE r."createdAt" >= ${since} ${org}`,
    prisma.$queryRaw`
      SELECT coalesce(r.provider, '—') AS provider, coalesce(r.model, '—') AS model, ${AGG}
      FROM "AiRun" r WHERE r."createdAt" >= ${since} ${org} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
    prisma.$queryRaw`
      SELECT r.feature, split_part(r.feature, '.', 1) AS module, ${AGG}
      FROM "AiRun" r WHERE r."createdAt" >= ${since} ${org} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 40`,
    prisma.$queryRaw`
      SELECT r."orgId" AS org_id, o.name AS org_name, ${AGG},
             count(DISTINCT r."userId")::int AS people, count(DISTINCT r."projectId")::int AS projects
      FROM "AiRun" r LEFT JOIN "Organisation" o ON o.id = r."orgId"
      WHERE r."createdAt" >= ${since} ${org} GROUP BY 1, 2 ORDER BY requests DESC LIMIT 25`,
    prisma.$queryRaw`
      SELECT r."userId" AS user_id, u.name AS user_name, u.email AS user_email, r."orgId" AS org_id, o.name AS org_name, ${AGG}
      FROM "AiRun" r LEFT JOIN "User" u ON u.id = r."userId" LEFT JOIN "Organisation" o ON o.id = r."orgId"
      WHERE r."createdAt" >= ${since} AND r."userId" IS NOT NULL ${org} GROUP BY 1, 2, 3, 4, 5 ORDER BY requests DESC LIMIT 25`,
    prisma.$queryRaw`
      SELECT r.status, coalesce(r."errorClass", '—') AS error_class, count(*)::int AS n
      FROM "AiRun" r WHERE r."createdAt" >= ${since} AND r.status <> 'ok' ${org} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
    prisma.$queryRaw`
      SELECT date_trunc('day', r."createdAt")::date AS day, count(*)::int AS requests,
             (coalesce(sum(r."inputTokens"), 0) + coalesce(sum(r."outputTokens"), 0))::bigint AS tokens,
             count(*) FILTER (WHERE r.status <> 'ok')::int AS not_ok
      FROM "AiRun" r WHERE r."createdAt" >= ${since} ${org} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT r."orgId" AS org_id, (coalesce(sum(r."inputTokens"), 0) + coalesce(sum(r."outputTokens"), 0))::bigint AS tokens, count(*)::int AS requests
      FROM "AiRun" r WHERE r."createdAt" >= ${today} AND r."orgId" IS NOT NULL ${org} GROUP BY 1`,
  ]);
  const todayByOrg = new Map(orgToday.map((row) => [row.org_id, { tokens: n(row.tokens), requests: n(row.requests) }]));
  const orgLimit = cfg.limits.dailyTokensPerOrganisation;
  return {
    generatedAt: now.toISOString(),
    windowDays: window,
    organisation: orgId || null,
    configuration: cfg,
    today: summarise(todayRow[0] || {}),
    window: summarise(windowRow[0] || {}),
    byModel: byModel.map((row) => ({ provider: row.provider, model: row.model, ...summarise(row) })),
    byFeature: byFeature.map((row) => ({ feature: row.feature, module: row.module, ...summarise(row) })),
    byOrganisation: byOrg.map((row) => {
      const usedToday = todayByOrg.get(row.org_id) || { tokens: 0, requests: 0 };
      return {
        organisation: row.org_id ? { id: row.org_id, name: row.org_name || "—" } : null,
        people: n(row.people),
        projects: n(row.projects),
        ...summarise(row),
        today: usedToday,
        todayShareOfLimit: orgLimit ? Math.round((usedToday.tokens / orgLimit) * 1000) / 10 : null,
      };
    }),
    byUser: byUser.map((row) => ({ user: { id: row.user_id, name: row.user_name || null, email: row.user_email || null }, organisation: row.org_id ? { id: row.org_id, name: row.org_name || "—" } : null, ...summarise(row) })),
    failures: failures.map((row) => ({ status: row.status, errorClass: row.error_class, count: n(row.n) })),
    daily: daily.map((row) => ({ day: row.day, requests: n(row.requests), tokens: n(row.tokens), notOk: n(row.not_ok) })),
    definitions: {
      source: "AiRun, written by the AI gateway for every model call (no prompt or answer content).",
      today: "Since 00:00 UTC.",
      estimatedCost: "Estimated from the configured price table; null for a model without a configured price. Not an invoice.",
      blocked: "Refused by the spending guard (configured daily limits).",
      disabled: "No provider configured when the call was made.",
    },
  };
};

module.exports = { getAiUsage, configuration, WINDOWS };
