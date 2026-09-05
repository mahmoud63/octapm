const { Prisma } = require("@prisma/client");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const domainEvents = require("../events/bus");
const { JobError, isTransientError } = require("./errors");

/**
 * Durable background job queue backed by the BackgroundJob table.
 *
 * Why Postgres and not an in-memory Map: jobs must survive API restarts and be
 * visible to every API instance. Claiming uses `FOR UPDATE SKIP LOCKED`, so any
 * number of workers can poll the same table without double-processing.
 *
 * Lifecycle: queued → running → succeeded | failed (retryable failures go back
 * to queued with an exponential backoff until maxAttempts is reached). A job
 * whose worker dies is detected by a stale heartbeat and re-queued.
 */

const JOB_TYPES = Object.freeze({
  BOQ_PARSE: "boq.parse",
  SCHEDULE_GENERATE: "schedule.generate",
  SCHEDULE_IMPORT: "schedule.import",
  DOCUMENT_EXTRACT: "document.extract",
  REPORT_RENDER: "report.render",
  NOTIFICATION_DELIVER: "notification.deliver",
  PHOTO_THUMBNAIL: "photo.thumbnail",
  DRAWING_SET_PROCESS: "drawing.set_process",
  DAILY_LOG_WEATHER: "daily_log.weather",
  DAILY_LOG_DISTRIBUTE: "daily_log.distribute",
  PORTFOLIO_REFRESH: "portfolio.refresh",
});

const JOB_STATUSES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const TERMINAL_STATUSES = new Set([
  JOB_STATUSES.SUCCEEDED,
  JOB_STATUSES.FAILED,
  JOB_STATUSES.CANCELLED,
]);

/** Status vocabulary the existing pollers understand. */
const LEGACY_STATUS = Object.freeze({
  [JOB_STATUSES.QUEUED]: "processing",
  [JOB_STATUSES.RUNNING]: "running",
  [JOB_STATUSES.SUCCEEDED]: "done",
  [JOB_STATUSES.FAILED]: "error",
  [JOB_STATUSES.CANCELLED]: "error",
});

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 10 * 60 * 1000;
const BASE_BACKOFF_MS = 30 * 1000;

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const defaultTtlMs = () =>
  readPositiveInt(process.env.JOB_TTL_MS, 7 * 24 * 60 * 60 * 1000);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const backoffMs = (attempt) =>
  Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));

const assertKnownType = (type) => {
  const normalized = trimOrNull(type);
  if (!normalized || !Object.values(JOB_TYPES).includes(normalized)) {
    throw new HttpError(400, "JOB_TYPE_INVALID", `Unknown job type: ${type}`);
  }
  return normalized;
};

const errorView = (job) =>
  job.errorCode || job.errorMessage
    ? {
        code: job.errorCode || "JOB_FAILED",
        message: job.errorMessage || "Job failed",
        details: job.errorJson || null,
      }
    : null;

const canRetry = (job) =>
  job.status === JOB_STATUSES.FAILED || job.status === JOB_STATUSES.CANCELLED;

const serializeJob = (job) => ({
  id: job.id,
  orgId: job.orgId,
  projectId: job.projectId || null,
  type: job.type,
  status: job.status,
  priority: job.priority ?? 0,
  attempts: job.attempts ?? 0,
  maxAttempts: job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  payload: job.payloadJson || {},
  progress: job.progressJson || {},
  result: job.resultJson || null,
  error: errorView(job),
  requestedBy: job.requestedBy || null,
  lockedBy: job.lockedBy || null,
  runAfter: toIso(job.runAfter),
  startedAt: toIso(job.startedAt),
  finishedAt: toIso(job.finishedAt),
  heartbeatAt: toIso(job.heartbeatAt),
  expiresAt: toIso(job.expiresAt),
  createdAt: toIso(job.createdAt),
  updatedAt: toIso(job.updatedAt),
  canRetry: canRetry(job),
  isTerminal: TERMINAL_STATUSES.has(job.status),
});

/**
 * Backwards-compatible view for the schedule/BOQ job pollers: result fields are
 * spread at the top level and the status uses the legacy vocabulary.
 */
const toLegacyJobView = (job) => {
  const progress = job.progressJson || {};
  const error = errorView(job);
  return {
    ...(isPlainObject(job.resultJson) ? job.resultJson : {}),
    id: job.id,
    jobId: job.id,
    type: job.type,
    status: LEGACY_STATUS[job.status] || job.status,
    jobStatus: job.status,
    step: progress.step || null,
    currentStep: progress.currentStep ?? null,
    totalSteps: progress.totalSteps ?? null,
    steps: progress.steps || null,
    progress: progress.progress ?? 0,
    message: progress.message || null,
    error: error ? error.message : null,
    errorCode: error ? error.code : null,
    projectId: job.projectId || null,
    attempts: job.attempts ?? 0,
    maxAttempts: job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    canRetry: canRetry(job),
    queuedAt: toIso(job.createdAt),
    startedAt: toIso(job.startedAt),
    finishedAt: toIso(job.finishedAt),
    updatedAt: toIso(job.updatedAt),
  };
};

const publishJobEvent = (job, extra = {}) => {
  try {
    domainEvents.publish({
      type: domainEvents.EVENT_TYPES.JOB_PROGRESS,
      orgId: job.orgId,
      projectId: job.projectId || null,
      entityType: "background_job",
      entityId: job.id,
      action: job.status,
      actorId: job.requestedBy || null,
      recipientUserIds: job.projectId ? [] : [job.requestedBy].filter(Boolean),
      payload: {
        jobType: job.type,
        status: job.status,
        attempts: job.attempts,
        progress: job.progressJson || {},
        ...extra,
      },
    });
  } catch (error) {
    console.error("[job-event]", error);
  }
};

const findJob = async ({ orgId, projectId = null, jobId }) => {
  if (!jobId || !orgId) return null;
  return prisma.backgroundJob.findFirst({
    where: {
      id: jobId,
      orgId,
      ...(projectId ? { projectId } : {}),
    },
  });
};

const requireJob = async (params) => {
  const job = await findJob(params);
  if (!job) {
    throw new HttpError(404, "JOB_NOT_FOUND", "Job not found or expired");
  }
  return job;
};

const enqueueJob = async ({
  orgId,
  projectId = null,
  type,
  payload = {},
  progress = {},
  result = null,
  requestedBy = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  priority = 0,
  runAfter = new Date(),
  ttlMs = defaultTtlMs(),
}) => {
  if (!orgId) {
    throw new HttpError(400, "JOB_ORG_REQUIRED", "Jobs require an org id");
  }
  const jobType = assertKnownType(type);

  const job = await prisma.backgroundJob.create({
    data: {
      orgId,
      projectId: projectId || null,
      type: jobType,
      status: JOB_STATUSES.QUEUED,
      priority: Math.trunc(Number(priority)) || 0,
      maxAttempts: Math.max(1, Math.trunc(Number(maxAttempts)) || 1),
      payloadJson: payload || {},
      progressJson: { progress: 0, ...(progress || {}) },
      resultJson: result || null,
      requestedBy: requestedBy || null,
      runAfter: runAfter instanceof Date ? runAfter : new Date(runAfter),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  publishJobEvent(job);
  return serializeJob(job);
};

/** Records a job that completed synchronously so callers keep one polling path. */
const recordCompletedJob = async ({
  orgId,
  projectId = null,
  type,
  result = null,
  progress = {},
  requestedBy = null,
  ttlMs = defaultTtlMs(),
}) => {
  if (!orgId) {
    throw new HttpError(400, "JOB_ORG_REQUIRED", "Jobs require an org id");
  }
  const jobType = assertKnownType(type);
  const now = new Date();

  const job = await prisma.backgroundJob.create({
    data: {
      orgId,
      projectId: projectId || null,
      type: jobType,
      status: JOB_STATUSES.SUCCEEDED,
      attempts: 1,
      maxAttempts: 1,
      progressJson: { progress: 100, step: "Complete", ...(progress || {}) },
      resultJson: result || null,
      requestedBy: requestedBy || null,
      startedAt: now,
      finishedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
    },
  });

  publishJobEvent(job);
  return serializeJob(job);
};

const getJob = async (params) => {
  const job = await findJob(params);
  return job ? serializeJob(job) : null;
};

const getLegacyJob = async (params) => {
  const job = await findJob(params);
  return job ? toLegacyJobView(job) : null;
};

const listJobs = async ({ orgId, projectId, query = {} }) => {
  const where = { orgId, projectId };
  if (query.status && Object.values(JOB_STATUSES).includes(query.status)) {
    where.status = query.status;
  }
  if (query.type && Object.values(JOB_TYPES).includes(query.type)) {
    where.type = query.type;
  }
  const limit = Math.min(Math.max(readPositiveInt(query.limit, 25), 1), 100);

  const rows = await prisma.backgroundJob.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });

  return {
    items: rows.map(serializeJob),
    summary: {
      queued: rows.filter((row) => row.status === JOB_STATUSES.QUEUED).length,
      running: rows.filter((row) => row.status === JOB_STATUSES.RUNNING).length,
      failed: rows.filter((row) => row.status === JOB_STATUSES.FAILED).length,
      succeeded: rows.filter((row) => row.status === JOB_STATUSES.SUCCEEDED)
        .length,
    },
  };
};

const updateJobProgress = async ({ jobId, progress = {}, merge = true }) => {
  const current = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!current) return null;

  const progressJson = merge
    ? { ...(current.progressJson || {}), ...(progress || {}) }
    : { ...(progress || {}) };

  const job = await prisma.backgroundJob.update({
    where: { id: jobId },
    data: { progressJson, heartbeatAt: new Date() },
  });

  publishJobEvent(job);
  return serializeJob(job);
};

const heartbeatJob = async ({ jobId, workerId }) =>
  prisma.backgroundJob.updateMany({
    where: { id: jobId, lockedBy: workerId, status: JOB_STATUSES.RUNNING },
    data: { heartbeatAt: new Date() },
  });

/**
 * Atomically claims the next runnable job. Safe across processes because the
 * subquery locks the row with SKIP LOCKED; concurrent workers never receive the
 * same job.
 */
const claimNextJob = async ({ workerId, types = null }) => {
  if (!workerId) {
    throw new HttpError(500, "JOB_WORKER_ID_REQUIRED", "Worker id is required");
  }

  const typeFilter =
    Array.isArray(types) && types.length
      ? Prisma.sql`AND "type" IN (${Prisma.join(types)})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw`
    UPDATE "BackgroundJob"
    SET "status" = ${JOB_STATUSES.RUNNING},
        "lockedBy" = ${workerId},
        "lockedAt" = NOW(),
        "heartbeatAt" = NOW(),
        "startedAt" = COALESCE("startedAt", NOW()),
        "attempts" = "attempts" + 1,
        "errorCode" = NULL,
        "errorMessage" = NULL,
        "errorJson" = NULL,
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "BackgroundJob"
      WHERE "status" = ${JOB_STATUSES.QUEUED}
        AND "runAfter" <= NOW()
        ${typeFilter}
      ORDER BY "priority" DESC, "runAfter" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  publishJobEvent(row);
  return serializeJob(row);
};

const completeJob = async ({ jobId, result = null, progress = {} }) => {
  const current = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!current) return null;

  const job = await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: JOB_STATUSES.SUCCEEDED,
      resultJson: {
        ...(isPlainObject(current.resultJson) ? current.resultJson : {}),
        ...(isPlainObject(result) ? result : {}),
      },
      progressJson: {
        ...(current.progressJson || {}),
        ...(progress || {}),
        progress: 100,
      },
      errorCode: null,
      errorMessage: null,
      errorJson: null,
      lockedBy: null,
      lockedAt: null,
      finishedAt: new Date(),
    },
  });

  publishJobEvent(job);
  return serializeJob(job);
};

/**
 * Records a failed attempt. Retryable failures under maxAttempts return the
 * job to the queue with a backoff; otherwise the job becomes failed.
 */
const failJob = async ({
  jobId,
  error = {},
  retryable = true,
  now = new Date(),
}) => {
  const current = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!current) return null;

  const attempts = current.attempts ?? 0;
  const willRetry = Boolean(retryable) && attempts < (current.maxAttempts ?? 1);
  const errorCode = trimOrNull(error.code) || "JOB_FAILED";
  const errorMessage = trimOrNull(error.message) || "Job failed";
  const errorJson = error.details ?? null;
  const delay = backoffMs(attempts);

  const job = await prisma.backgroundJob.update({
    where: { id: jobId },
    data: willRetry
      ? {
          status: JOB_STATUSES.QUEUED,
          runAfter: new Date(now.getTime() + delay),
          errorCode,
          errorMessage,
          errorJson,
          lockedBy: null,
          lockedAt: null,
          progressJson: {
            ...(current.progressJson || {}),
            message: `Attempt ${attempts} failed: ${errorMessage}. Retrying in ${Math.round(delay / 1000)}s.`,
          },
        }
      : {
          status: JOB_STATUSES.FAILED,
          errorCode,
          errorMessage,
          errorJson,
          lockedBy: null,
          lockedAt: null,
          finishedAt: now,
        },
  });

  publishJobEvent(job, { willRetry, retryInMs: willRetry ? delay : null });
  return { job: serializeJob(job), willRetry, retryInMs: willRetry ? delay : null };
};

const retryJob = async ({ orgId, projectId = null, jobId, userId = null }) => {
  const current = await requireJob({ orgId, projectId, jobId });
  if (!canRetry(current)) {
    throw new HttpError(
      409,
      "JOB_NOT_RETRYABLE",
      `Only failed or cancelled jobs can be retried (current status: ${current.status})`,
    );
  }

  const job = await prisma.backgroundJob.update({
    where: { id: current.id },
    data: {
      status: JOB_STATUSES.QUEUED,
      runAfter: new Date(),
      maxAttempts: Math.max(current.maxAttempts ?? 1, (current.attempts ?? 0) + 1),
      errorCode: null,
      errorMessage: null,
      errorJson: null,
      lockedBy: null,
      lockedAt: null,
      finishedAt: null,
      expiresAt: new Date(Date.now() + defaultTtlMs()),
      progressJson: {
        ...(current.progressJson || {}),
        message: `Retry requested${userId ? ` by ${userId}` : ""}`,
        step: "Queued for retry",
      },
    },
  });

  publishJobEvent(job, { retriedBy: userId });
  return serializeJob(job);
};

const cancelJob = async ({ orgId, projectId = null, jobId, userId = null }) => {
  const current = await requireJob({ orgId, projectId, jobId });
  if (current.status !== JOB_STATUSES.QUEUED) {
    throw new HttpError(
      409,
      "JOB_NOT_CANCELLABLE",
      `Only queued jobs can be cancelled (current status: ${current.status})`,
    );
  }

  const job = await prisma.backgroundJob.update({
    where: { id: current.id },
    data: {
      status: JOB_STATUSES.CANCELLED,
      finishedAt: new Date(),
      errorCode: "JOB_CANCELLED",
      errorMessage: `Cancelled${userId ? ` by ${userId}` : ""}`,
    },
  });

  publishJobEvent(job, { cancelledBy: userId });
  return serializeJob(job);
};

/**
 * Re-queues (or fails) running jobs whose worker stopped heartbeating, e.g.
 * after a crash or deploy. The claim already counted the attempt.
 */
const recoverStaleJobs = async ({ staleMs, now = new Date() }) => {
  const cutoff = new Date(now.getTime() - staleMs);
  const stale = await prisma.backgroundJob.findMany({
    where: {
      status: JOB_STATUSES.RUNNING,
      OR: [
        { heartbeatAt: { lt: cutoff } },
        { heartbeatAt: null, lockedAt: { lt: cutoff } },
      ],
    },
  });

  let requeued = 0;
  let failed = 0;
  for (const job of stale) {
    const result = await failJob({
      jobId: job.id,
      error: {
        code: "JOB_WORKER_LOST",
        message: `Worker ${job.lockedBy || "unknown"} stopped responding`,
      },
      retryable: true,
      now,
    });
    if (result?.willRetry) requeued += 1;
    else failed += 1;
  }

  return { scanned: stale.length, requeued, failed };
};

const pruneExpiredJobs = async ({ now = new Date() } = {}) => {
  const result = await prisma.backgroundJob.deleteMany({
    where: {
      expiresAt: { lt: now },
      status: { in: [...TERMINAL_STATUSES] },
    },
  });
  return { deleted: result?.count ?? 0 };
};

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  JOB_STATUSES,
  JOB_TYPES,
  JobError,
  LEGACY_STATUS,
  TERMINAL_STATUSES,
  backoffMs,
  cancelJob,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  getJob,
  getLegacyJob,
  heartbeatJob,
  isTransientError,
  listJobs,
  pruneExpiredJobs,
  recordCompletedJob,
  recoverStaleJobs,
  retryJob,
  serializeJob,
  toLegacyJobView,
  updateJobProgress,
};
