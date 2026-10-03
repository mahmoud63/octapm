const express = require("express");
const { param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { hasPermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const jobService = require("../jobs/job.service");
const documentTextService = require("../services/document-text.service");
const { boqFigureAccess, withheldJob } = require("../utils/boq-figures");

/**
 * Project background jobs (durable queue).
 *
 * A job is read under the read permission of the module it belongs to and
 * retried or cancelled under its update permission, so a QS can retry a BOQ
 * job but not a schedule job (Phase 21D, CX21-533, CX21-543).
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
  [jobService.JOB_TYPES.PHOTO_ANALYZE]: "document_control",
  [jobService.JOB_TYPES.DRAWING_SET_PROCESS]: "document_control",
  [jobService.JOB_TYPES.BIM_PARSE]: "bim",
  [jobService.JOB_TYPES.DAILY_LOG_WEATHER]: "progress",
  [jobService.JOB_TYPES.DAILY_LOG_DISTRIBUTE]: "progress",
  [jobService.JOB_TYPES.PORTFOLIO_REFRESH]: "portfolio",
});

// A job is read under the read permission of the module it belongs to — a
// key with only a BOQ scope listed every module's jobs with their payloads
// and results (Phase 21D, CX21-533).
// Every job type names its module; a job whose type names none is nobody's
// to read or manage — the fallback to "schedule" let a schedule key read
// photo-analysis and BIM jobs and denied them to their own readers (CX21-543).
const moduleOfJob = (job) => JOB_MODULE_BY_TYPE[job?.type] || null;
const canReadJob = (req, job) => {
  const moduleName = moduleOfJob(job);
  return Boolean(moduleName) && hasPermission(req, moduleName, "read");
};

// A job as this caller may receive it: a job whose input is the uploaded
// bill (schedule.generate) comes without the bill to a member who may not
// read the BOQ (§12) — utils/boq-figures decides. A job on a document — a
// text extraction, a photo, a drawing set — comes without its payload and
// result to a caller who may not read that document, judged as
// /attachments/documents judges it: the list gave every document-control
// reader the ids of other parties' and other tools' files (certification
// L2) — document-text.service decides. Every answer that carries a
// serialized job goes through here: the list, one job, retry and cancel.
const jobViews = (req, jobs) =>
  documentTextService.withheldDocumentJobs({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    jobs: jobs.map((job) => withheldJob(job, boqFigureAccess(req))),
    viewer: documentTextService.documentViewer({
      userId: req.user.id,
      projectAccess: req.projectAccess,
      canRead: (moduleName) => hasPermission(req, moduleName, "read"),
    }),
  });
const jobView = async (req, job) => (await jobViews(req, [job]))[0];

const assertCanManageJob = (req, job) => {
  const moduleName = moduleOfJob(job);
  // The same decision every write goes through — role, project template,
  // and an API key's scopes; a static role check let a read-only key cancel
  // a job (Phase 21D, CX21-444).
  const allowed = Boolean(moduleName) && hasPermission(req, moduleName, "update");
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
    const items = await jobViews(req, (result.items || []).filter((job) => canReadJob(req, job)));
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
    return sendSuccess(res, await jobView(req, job));
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
    return sendSuccess(res, await jobView(req, result), 202);
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
    return sendSuccess(res, await jobView(req, result));
  }),
);

module.exports = router;
