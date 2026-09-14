const express = require("express");
const { param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { hasPermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const jobService = require("../jobs/job.service");

/**
 * Project background jobs (durable queue).
 *
 * Reading job state needs only project access (the mounting router already
 * enforces it). Retry/cancel require the update permission of the module the
 * job belongs to, so a QS can retry a BOQ job but not a schedule job.
 */

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const JOB_MODULE_BY_TYPE = Object.freeze({
  [jobService.JOB_TYPES.BOQ_PARSE]: "boq",
  [jobService.JOB_TYPES.SCHEDULE_GENERATE]: "schedule",
  [jobService.JOB_TYPES.SCHEDULE_IMPORT]: "schedule",
  [jobService.JOB_TYPES.DOCUMENT_EXTRACT]: "document_control",
  [jobService.JOB_TYPES.REPORT_RENDER]: "report",
  [jobService.JOB_TYPES.NOTIFICATION_DELIVER]: "user_management",
  [jobService.JOB_TYPES.WEBHOOK_DELIVER]: "user_management",
  [jobService.JOB_TYPES.ACCOUNTING_SYNC]: "sub_pay_app",
  [jobService.JOB_TYPES.ACCOUNTING_POLL]: "sub_pay_app",
  [jobService.JOB_TYPES.PHOTO_THUMBNAIL]: "document_control",
  [jobService.JOB_TYPES.DRAWING_SET_PROCESS]: "document_control",
  [jobService.JOB_TYPES.DAILY_LOG_WEATHER]: "progress",
  [jobService.JOB_TYPES.DAILY_LOG_DISTRIBUTE]: "progress",
  [jobService.JOB_TYPES.PORTFOLIO_REFRESH]: "portfolio",
});

// A job is read under the read permission of the module it belongs to — a
// key with only a BOQ scope listed every module's jobs with their payloads
// and results (Phase 21D, CX21-533).
const canReadJob = (req, job) => hasPermission(req, JOB_MODULE_BY_TYPE[job.type] || "schedule", "read");

const assertCanManageJob = (req, job) => {
  const moduleName = JOB_MODULE_BY_TYPE[job.type] || "schedule";
  // The same decision every write goes through — role, project template,
  // and an API key's scopes; a static role check let a read-only key cancel
  // a job (Phase 21D, CX21-444).
  const allowed = hasPermission(req, moduleName, "update");
  if (!allowed) {
    const error = new HttpError(
      403,
      "FORBIDDEN",
      "You do not have permission for this action",
    );
    error.details = { module: moduleName, action: "update", jobType: job.type };
    throw error;
  }
};

router.get(
  "/",
  [
    query("status").optional().isIn(Object.values(jobService.JOB_STATUSES)),
    query("type").optional().isIn(Object.values(jobService.JOB_TYPES)),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await jobService.listJobs({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    const items = (result.items || []).filter((job) => canReadJob(req, job));
    return sendSuccess(res, { ...result, items });
  }),
);

router.get(
  "/:jobId",
  [param("jobId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const job = await jobService.getJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
    });
    if (!job || !canReadJob(req, job)) {
      throw new HttpError(404, "JOB_NOT_FOUND", "Job not found or expired");
    }
    return sendSuccess(res, job);
  }),
);

router.post(
  "/:jobId/retry",
  [param("jobId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const job = await jobService.getJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
    });
    if (!job) {
      throw new HttpError(404, "JOB_NOT_FOUND", "Job not found or expired");
    }
    assertCanManageJob(req, job);

    const result = await jobService.retryJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
      userId: req.user.id,
    });
    return sendSuccess(res, result, 202);
  }),
);

router.post(
  "/:jobId/cancel",
  [param("jobId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const job = await jobService.getJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
    });
    if (!job) {
      throw new HttpError(404, "JOB_NOT_FOUND", "Job not found or expired");
    }
    assertCanManageJob(req, job);

    const result = await jobService.cancelJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
