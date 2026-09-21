const os = require("os");
const jobService = require("./job.service");
const { isTransientError } = require("./errors");

/**
 * Background job worker.
 *
 * Polls the BackgroundJob table, claims runnable jobs with SKIP LOCKED, runs
 * the registered handler with a heartbeat, and records success or failure.
 * Runs in-process with the API by default (JOB_WORKER_ENABLED != "false") and
 * can also run as a dedicated process via `node src/worker.js`.
 */

const handlers = new Map();

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const registerJobHandler = (type, handler) => {
  if (typeof handler !== "function") {
    throw new TypeError(`Job handler for ${type} must be a function`);
  }
  handlers.set(type, handler);
  return () => handlers.delete(type);
};

const getRegisteredJobTypes = () => [...handlers.keys()];

const resetJobHandlers = () => handlers.clear();

const errorPayload = (error) => ({
  code: error?.code || "JOB_FAILED",
  message: error?.message || "Job failed",
  details: error?.details ?? null,
});

const notifyRequester = async (job, error) => {
  if (!job.requestedBy) return;
  try {
    const notificationService = require("../services/notification.service");
    await notificationService.createNotifications({
      orgId: job.orgId,
      projectId: job.projectId,
      recipientUserIds: [job.requestedBy],
      type: "job",
      category: "workflow",
      event: "job.failed",
      title: `Background job failed: ${job.type}`,
      message: `${error.message} (${error.code}). Open the module to retry.`,
      priority: "high",
      entityType: "background_job",
      entityId: job.id,
      actionUrl: job.projectId ? `/projects/${job.projectId}` : null,
      dedupeKeyBase: `job.failed:${job.id}:${job.attempts}`,
      metadata: { jobType: job.type, attempts: job.attempts },
    });
  } catch (notifyError) {
    console.error("[job-worker] failure notification", notifyError);
  }
};

const recordAudit = async (job, action, extra = {}) => {
  if (!job.projectId) return;
  try {
    const auditService = require("../services/audit.service");
    await auditService.recordEvent({
      orgId: job.orgId,
      projectId: job.projectId,
      entityType: auditService.ENTITY_TYPES.BACKGROUND_JOB,
      entityId: job.id,
      action,
      actorId: job.requestedBy || null,
      newStatus: job.status,
      summary: { type: job.type, attempts: job.attempts, ...extra },
      metadata: { source: "job-worker" },
    });
  } catch (auditError) {
    console.error("[job-worker] audit", auditError);
  }
};

/** JOB_WORKER_TYPES: a comma list restricting what this process claims; unset means every registered type. */
const typesFromEnv = (value = process.env.JOB_WORKER_TYPES) => {
  const list = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : null;
};

const createJobWorker = ({
  workerId = `${os.hostname()}:${process.pid}`,
  types = typesFromEnv(),
  pollIntervalMs = readPositiveInt(process.env.JOB_POLL_INTERVAL_MS, 2000),
  concurrency = readPositiveInt(process.env.JOB_WORKER_CONCURRENCY, 2),
  heartbeatMs = readPositiveInt(process.env.JOB_HEARTBEAT_MS, 15_000),
  staleMs = readPositiveInt(process.env.JOB_STALE_MS, 5 * 60_000),
  recoverIntervalMs = readPositiveInt(process.env.JOB_RECOVER_INTERVAL_MS, 60_000),
  pruneIntervalMs = readPositiveInt(process.env.JOB_PRUNE_INTERVAL_MS, 60 * 60_000),
  logger = console,
} = {}) => {
  const active = new Set();
  const timers = [];
  let running = false;
  let pollTimer = null;

  const resolvedTypes = () =>
    Array.isArray(types) && types.length ? types : getRegisteredJobTypes();

  const runJob = async (job) => {
    const handler = handlers.get(job.type);
    if (!handler) {
      const result = await jobService.failJob({
        jobId: job.id,
        error: {
          code: "JOB_HANDLER_MISSING",
          message: `No handler registered for job type ${job.type}`,
        },
        retryable: false,
        workerId,
      });
      if (result) await recordAudit(result.job, "failed");
      return result;
    }

    const heartbeat = setInterval(() => {
      jobService
        .heartbeatJob({ jobId: job.id, workerId })
        .then((outcome) => {
          if (outcome && outcome.count === 0) {
            logger.warn(`[job-worker] ${job.type} ${job.id} is no longer held by ${workerId}; its outcome will not be recorded`);
          }
        })
        .catch((error) => logger.error("[job-worker] heartbeat", error));
    }, heartbeatMs);
    heartbeat.unref?.();

    const updateProgress = (progress) =>
      jobService.updateJobProgress({ jobId: job.id, progress });

    try {
      const result = await handler({
        job,
        payload: job.payload || {},
        updateProgress,
        workerId,
        log: (...args) => logger.log(`[job ${job.type}:${job.id}]`, ...args),
      });
      const completed = await jobService.completeJob({
        jobId: job.id,
        result: result && typeof result === "object" ? result : null,
        workerId,
      });
      if (!completed) {
        // Recovered by another process meanwhile (or otherwise moved on):
        // the current owner records the outcome, not this worker.
        logger.warn(`[job-worker] ${job.type} ${job.id} finished here but is no longer held by ${workerId}; outcome not recorded`);
        return null;
      }
      await recordAudit(completed, "completed");
      return completed;
    } catch (error) {
      logger.error(`[job-worker] ${job.type} ${job.id} failed`, error);
      const failure = await jobService.failJob({
        jobId: job.id,
        error: errorPayload(error),
        retryable: isTransientError(error),
        workerId,
      });
      if (!failure) {
        logger.warn(`[job-worker] ${job.type} ${job.id} failed here but is no longer held by ${workerId}; failure not recorded`);
      }
      if (failure && !failure.willRetry) {
        await notifyRequester(failure.job, errorPayload(error));
        await recordAudit(failure.job, "failed", { error: errorPayload(error) });
      }
      return failure;
    } finally {
      clearInterval(heartbeat);
    }
  };

  const tick = async () => {
    while (running && active.size < concurrency) {
      let job = null;
      try {
        job = await jobService.claimNextJob({
          workerId,
          types: resolvedTypes(),
        });
      } catch (error) {
        logger.error("[job-worker] claim", error);
        break;
      }
      if (!job) break;

      const promise = runJob(job)
        .catch((error) => logger.error("[job-worker] run", error))
        .finally(() => active.delete(promise));
      active.add(promise);
    }
  };

  const schedule = () => {
    if (!running) return;
    pollTimer = setTimeout(async () => {
      await tick();
      schedule();
    }, pollIntervalMs);
    pollTimer.unref?.();
  };

  const recover = async ({ rethrow = false } = {}) => {
    try {
      const result = await jobService.recoverStaleJobs({ staleMs });
      if (result.scanned) logger.warn("[job-worker] recovered stale jobs", result);
      return result;
    } catch (error) {
      if (rethrow) throw error;
      logger.error("[job-worker] recover", error);
      return null;
    }
  };

  const prune = async () => {
    try {
      return await jobService.pruneExpiredJobs({});
    } catch (error) {
      logger.error("[job-worker] prune", error);
      return null;
    }
  };

  /**
   * With `strict`, the first recovery — also the first database contact —
   * must work: the dedicated worker process that cannot reach its queue at
   * start fails loudly (it exits and is restarted) instead of idling as if
   * all were well. The API's in-process worker keeps polling through it.
   */
  const start = async ({ strict = false } = {}) => {
    if (running) return;
    running = true;
    try {
      await recover({ rethrow: strict });
    } catch (error) {
      running = false;
      throw error;
    }
    await tick();
    schedule();

    const recoverTimer = setInterval(recover, recoverIntervalMs);
    const pruneTimer = setInterval(prune, pruneIntervalMs);
    recoverTimer.unref?.();
    pruneTimer.unref?.();
    timers.push(recoverTimer, pruneTimer);
    logger.log(
      `[job-worker] ${workerId} started (concurrency=${concurrency}, types=${resolvedTypes().join(",") || "all"})`,
    );
  };

  /**
   * Stops claiming and waits for the jobs in hand. With a deadline (epoch ms)
   * the wait ends there even if jobs are still running: they keep their
   * claim, stop heartbeating when the process exits, and stale-job recovery
   * re-queues them. Resolves { drained, pending }.
   */
  const stop = async ({ deadline = null } = {}) => {
    running = false;
    if (pollTimer) clearTimeout(pollTimer);
    for (const timer of timers.splice(0)) clearInterval(timer);
    const settled = Promise.allSettled([...active]).then(() => true);
    if (!deadline) {
      await settled;
      return { drained: true, pending: 0 };
    }
    let expiry = null;
    const expired = new Promise((resolve) => {
      expiry = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
    });
    const drained = await Promise.race([settled, expired]);
    clearTimeout(expiry);
    if (!drained) logger.warn(`[job-worker] ${workerId} stopped with ${active.size} job(s) still running; recovery will re-queue them`);
    return { drained, pending: drained ? 0 : active.size };
  };

  const runOnce = async () => {
    running = true;
    await tick();
    await Promise.allSettled([...active]);
    running = false;
  };

  return {
    workerId,
    start,
    stop,
    runOnce,
    runJob,
    recover,
    prune,
    isRunning: () => running,
    activeCount: () => active.size,
  };
};

let defaultWorker = null;

const startJobWorker = ({ strictStart = false, ...options } = {}) => {
  if (String(process.env.JOB_WORKER_ENABLED || "true").toLowerCase() === "false") {
    console.log("[job-worker] disabled by JOB_WORKER_ENABLED=false");
    return null;
  }
  if (defaultWorker) return defaultWorker;

  require("./handlers").registerAllHandlers();
  const worker = createJobWorker(options);
  defaultWorker = worker;
  // `ready` settles once the first start has run: the dedicated worker
  // process awaits it and exits when it rejects; the API only logs.
  worker.ready = worker.start({ strict: strictStart });
  worker.ready.catch((error) => {
    console.error("[job-worker] failed to start", error);
    if (defaultWorker === worker) defaultWorker = null;
  });
  return worker;
};

/** Stops the process's job worker; `deadline` (epoch ms) bounds the wait for jobs in hand. */
const stopJobWorker = async ({ deadline = null } = {}) => {
  if (!defaultWorker) return { drained: true, pending: 0 };
  const worker = defaultWorker;
  defaultWorker = null;
  return worker.stop({ deadline });
};

module.exports = {
  createJobWorker,
  getRegisteredJobTypes,
  isTransientError,
  registerJobHandler,
  resetJobHandlers,
  startJobWorker,
  stopJobWorker,
  typesFromEnv,
};
