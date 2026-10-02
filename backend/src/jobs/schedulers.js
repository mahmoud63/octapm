const { createSchedulerLeader, leaderOptionsFromEnv } = require("./scheduler-leader");
const { isSwitchOn } = require("../config/switches");

/**
 * The periodic schedulers, run by exactly one process at a time.
 *
 * Any process with SCHEDULERS_ENABLED=true (default off) competes for scheduler
 * leadership; only the leader runs them. Locally the one API process wins at
 * once and behaves as before. In production the API tasks set
 * SCHEDULERS_ENABLED=false and the worker service leads; the lock is the
 * safety net for a misconfigured task or a rolling deploy that briefly runs
 * two workers. Each scheduler still has its own *_SCHEDULER_ENABLED switch.
 */

const SHARED_STATE_PRUNE_INTERVAL_MS = 15 * 60 * 1000;

const SCHEDULERS = [
  ["billing", () => require("./billing-scheduler"), "startBillingScheduler", "stopBillingScheduler"],
  ["notification", () => require("./notification-scheduler"), "startNotificationScheduler", "stopNotificationScheduler"],
  // Daily log weather feed and evening distribution (OCTA-FLD-DAILY-022).
  ["daily-log", () => require("./daily-log-scheduler"), "startDailyLogScheduler", "stopDailyLogScheduler"],
  // Scheduled reports and portfolio snapshots (OCTA-RPT-BUILDER-023).
  ["report", () => require("./report-scheduler"), "startReportScheduler", "stopReportScheduler"],
  // Workflow SLA escalation (OCTA-PLAT-WF-024).
  ["workflow", () => require("./workflow-scheduler"), "startWorkflowScheduler", "stopWorkflowScheduler"],
  // Accounting payment polling (OCTA-INT-API-026).
  ["accounting", () => require("./accounting-scheduler"), "startAccountingScheduler", "stopAccountingScheduler"],
  // Nightly exception re-evaluation of every active project (PC-7b; EXCEPTIONS_ENGINE_ENABLED and EXCEPTIONS_SCHEDULER_ENABLED).
  ["exception", () => require("./exception-scheduler"), "startExceptionScheduler", "stopExceptionScheduler"],
];

/**
 * Clears expired rows of the shared-state tables (rate-limit buckets) once for
 * the whole cluster. The store module provides pruneSharedState when it keeps
 * state in Postgres; until then there is nothing to prune.
 */
const pruneSharedState = async () => {
  let store;
  try {
    store = require("../config/rate-limit-store");
  } catch {
    return null;
  }
  if (typeof store?.pruneSharedState !== "function") return null;
  try {
    return await store.pruneSharedState();
  } catch (error) {
    console.error("[shared-state-prune]", error?.message || error);
    return null;
  }
};

let pruneTimer = null;
let running = false;

const startSchedulers = () => {
  if (running) return;
  running = true;
  for (const [name, load, start] of SCHEDULERS) {
    try {
      load()[start]();
    } catch (error) {
      console.error(`[schedulers] ${name} failed to start`, error?.message || error);
    }
  }
  pruneTimer = setInterval(pruneSharedState, SHARED_STATE_PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();
  console.log("[schedulers] started");
};

const stopSchedulers = () => {
  if (!running) return;
  running = false;
  for (const [name, load, , stop] of SCHEDULERS) {
    try {
      load()[stop]();
    } catch (error) {
      console.error(`[schedulers] ${name} failed to stop`, error?.message || error);
    }
  }
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = null;
  console.log("[schedulers] stopped");
};

let leader = null;

// Off unless SCHEDULERS_ENABLED is exactly "true" (C0-2); never under test.
const schedulersEnabled = (env = process.env) => isSwitchOn("SCHEDULERS_ENABLED", env) && env.NODE_ENV !== "test";

/** Starts competing for leadership; returns null when this process may not schedule. */
const startSchedulerLeadership = ({ env = process.env, logger = console } = {}) => {
  if (leader) return leader;
  if (!schedulersEnabled(env)) {
    logger.log("[schedulers] disabled in this process: SCHEDULERS_ENABLED is not true");
    return null;
  }
  leader = createSchedulerLeader({
    ...leaderOptionsFromEnv(env),
    onElected: startSchedulers,
    onDemoted: stopSchedulers,
    logger,
  });
  leader.start();
  return leader;
};

/** Stops the schedulers and gives up the lock; safe to call when leadership never started. */
const stopSchedulerLeadership = async () => {
  const current = leader;
  leader = null;
  if (current) await current.stop();
  else stopSchedulers();
};

module.exports = {
  pruneSharedState,
  schedulersEnabled,
  startSchedulerLeadership,
  startSchedulers,
  stopSchedulerLeadership,
  stopSchedulers,
};
