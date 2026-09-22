/**
 * Health routes, outside /api/v1 and outside authentication.
 *
 * - GET /api/health: the load balancer's check. The process is up and
 *   serving HTTP and is not draining; nothing else is touched. If it looked
 *   at the database, one database blip would mark every task unhealthy at
 *   once and ECS would replace them all — with no benefit, since the
 *   replacements share the same database. It does read the drain flag: once
 *   shutdown sets app.locals.draining it answers 503 SERVICE_NOT_READY, so
 *   the balancer stops sending new requests to this task even if the task
 *   was not deregistered first. The flag is in memory, so this costs nothing.
 * - GET /api/health/live: liveness only — 200 while the process is alive,
 *   draining or not. It is the "should this process be restarted" probe, and
 *   a draining task must not be restarted mid-drain.
 * - GET /api/health/ready: readiness. `SELECT 1` against the database, given
 *   up after HEALTH_DB_TIMEOUT_MS (Prisma alone would wait out its connect
 *   and pool timeouts), and a 503 while the process is draining for shutdown.
 *   For deploy gates, alarms and release checks.
 *
 * Every body carries the release identity. None carries a hostname, a
 * database name or an error message: anyone can call these.
 */
const express = require("express");
const { prisma } = require("../config/db");
const { buildErrorEnvelope, sendSuccess } = require("../utils/api-response");

const DEFAULT_DB_TIMEOUT_MS = 2000;

const dbTimeoutMs = (env = process.env) => {
  const parsed = Number.parseInt(env.HEALTH_DB_TIMEOUT_MS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DB_TIMEOUT_MS;
};

/**
 * `SELECT 1` raced against a timer. Resolves, never rejects, with booleans and
 * a latency only; the reason is a fixed word, never the driver's message.
 */
const checkDatabase = async (timeoutMs) => {
  const started = Date.now();
  let timer;
  // Promise.resolve().then(...) so a client that fails to build (a bad pool
  // setting) is a failed check rather than an exception in the route.
  const query = Promise.resolve()
    .then(() => prisma.$queryRaw`SELECT 1`)
    .then(() => "ok", () => "error");
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const outcome = await Promise.race([query, timeout]);
  clearTimeout(timer);
  const latencyMs = Date.now() - started;
  return outcome === "ok"
    ? { ok: true, latencyMs }
    : { ok: false, latencyMs, reason: outcome };
};

const createHealthRouter = ({ release }) => {
  const router = express.Router();
  // Probes can arrive from several places at once; they share one query.
  let pending = null;

  const noStore = (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  };

  const live = (_req, res) =>
    sendSuccess(res, {
      status: "ok",
      timestamp: new Date().toISOString(),
      release,
    });

  const balancerCheck = (req, res) => {
    if (!req.app.locals.draining) return live(req, res);
    const envelope = buildErrorEnvelope({
      status: 503,
      code: "SERVICE_NOT_READY",
      message: "The service is shutting down",
      details: { draining: true, release },
      includeDetails: true,
      requestId: req.id,
    });
    return res.status(envelope.status).json(envelope.body);
  };

  router.get("/", noStore, balancerCheck);
  router.get("/live", noStore, live);

  router.get("/ready", noStore, async (req, res) => {
    const draining = Boolean(req.app.locals.draining);
    let database = null;
    if (!draining) {
      if (!pending) {
        pending = checkDatabase(dbTimeoutMs()).finally(() => {
          pending = null;
        });
      }
      database = await pending;
    }

    if (!draining && database.ok) {
      return sendSuccess(res, {
        status: "ready",
        timestamp: new Date().toISOString(),
        checks: { database },
        release,
      });
    }

    const envelope = buildErrorEnvelope({
      status: 503,
      code: "SERVICE_NOT_READY",
      message: draining
        ? "The service is shutting down"
        : "The service cannot reach its database",
      details: { draining, checks: database ? { database } : {}, release },
      includeDetails: true,
      requestId: req.id,
    });
    return res.status(envelope.status).json(envelope.body);
  });

  return router;
};

module.exports = { checkDatabase, createHealthRouter, dbTimeoutMs };
