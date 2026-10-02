const { prisma } = require("../config/db");

/**
 * Trigger 2 of the exception engine (OCTAPM_CHANGE_INTELLIGENCE.md §6): once a
 * night every active project of every organisation gets an
 * 'exceptions.evaluate' job — unless one is already queued or running for it —
 * so a condition no event announced (a ledger posting from a source that
 * publishes nothing, a date that simply passed) is still found, and stale rows
 * are resolved. The same pattern as report-scheduler runPortfolioTick.
 *
 * It runs at EXCEPTIONS_NIGHTLY_HOUR_UTC (default 7 — 02:00 in Chicago), never
 * at start-up: an API that starts does not evaluate anything. Behind two
 * switches: EXCEPTIONS_ENGINE_ENABLED (default true; false stands the whole
 * engine down — trigger, tick and handler) and its own
 * EXCEPTIONS_SCHEDULER_ENABLED (default true, like DAILY_LOG_ / REPORT_ /
 * WORKFLOW_SCHEDULER_ENABLED; false keeps the event trigger and the job
 * handler but starts no nightly tick) — and, like every scheduler, the
 * scheduler leadership (jobs/schedulers.js).
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_NIGHTLY_HOUR_UTC = 7;

const engine = () => require("../services/exception-engine.service");
const jobService = () => require("./job.service");

/**
 * EXCEPTIONS_SCHEDULER_ENABLED (default true): the nightly tick's own switch,
 * beside the engine's. It can only take the tick away: the tick never starts
 * unless the engine itself is on (EXCEPTIONS_ENGINE_ENABLED=true, default off).
 */
const schedulerEnabled = (env = process.env) => String(env.EXCEPTIONS_SCHEDULER_ENABLED ?? "true").trim().toLowerCase() !== "false";

const nightlyHour = (env = process.env) => {
  const hour = Number.parseInt(env.EXCEPTIONS_NIGHTLY_HOUR_UTC ?? "", 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_NIGHTLY_HOUR_UTC;
};

/**
 * Enqueues one evaluation per active project, per organisation, skipping a
 * project whose evaluation is already queued or running. `orgIds` limits the
 * tick to those organisations (a test proves it touches nothing else).
 */
async function runExceptionTick({ now = new Date(), orgIds = null } = {}) {
  const { JOB_TYPES, JOB_STATUSES, enqueueJob } = jobService();
  if (Array.isArray(orgIds) && orgIds.length === 0) return { orgs: 0, projects: 0, queued: 0, skipped: 0 };
  const projects = await prisma.project.findMany({
    where: { status: "active", archivedAt: null, ...(Array.isArray(orgIds) ? { orgId: { in: orgIds } } : {}) },
    select: { id: true, orgId: true },
    orderBy: [{ orgId: "asc" }, { id: "asc" }],
  });
  let queued = 0;
  let skipped = 0;
  for (const { id: projectId, orgId } of projects) {
    const pending = await prisma.backgroundJob.findFirst({
      where: { orgId, projectId, type: JOB_TYPES.EXCEPTIONS_EVALUATE, status: { in: [JOB_STATUSES.QUEUED, JOB_STATUSES.RUNNING] } },
      select: { id: true },
    });
    if (pending) {
      skipped += 1;
      continue;
    }
    await enqueueJob({ orgId, projectId, type: JOB_TYPES.EXCEPTIONS_EVALUATE, payload: { trigger: "scheduled", at: now.toISOString() }, maxAttempts: 2 });
    queued += 1;
  }
  return { orgs: new Set(projects.map((project) => project.orgId)).size, projects: projects.length, queued, skipped };
}

let timer = null;
let lastRunDay = null;

/** The check the timer runs: the tick once per UTC day, in the nightly hour. */
async function checkNightly({ now = new Date(), env = process.env } = {}) {
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() !== nightlyHour(env) || lastRunDay === day) return null;
  const result = await runExceptionTick({ now });
  // Marked only once it ran: a tick that failed is tried again at the next check.
  lastRunDay = day;
  return result;
}

function startExceptionScheduler({ env = process.env } = {}) {
  if (timer) return timer;
  if (!engine().engineEnabled(env)) {
    console.log("[exception-scheduler] disabled: EXCEPTIONS_ENGINE_ENABLED is not true");
    return null;
  }
  if (!schedulerEnabled(env)) {
    console.log("[exception-scheduler] disabled by EXCEPTIONS_SCHEDULER_ENABLED=false");
    return null;
  }
  timer = setInterval(() => checkNightly().catch((error) => console.error("[exception-scheduler]", error)), CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

function stopExceptionScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

const resetForTests = () => {
  lastRunDay = null;
};

module.exports = { DEFAULT_NIGHTLY_HOUR_UTC, checkNightly, nightlyHour, resetForTests, runExceptionTick, schedulerEnabled, startExceptionScheduler, stopExceptionScheduler };
