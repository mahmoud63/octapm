const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const scheduleService = require('../services/schedule.service');

// Mounted with mergeParams: true from projects router
const router = express.Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else
      cb(
        new HttpError(
          400,
          'UNSUPPORTED_FORMAT',
          `Allowed formats: ${allowed.join(', ')}`,
        ),
      );
  },
});

router.use(authenticate);

// Disable caching for all schedule endpoints
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// GET /projects/:projectId/schedule
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await scheduleService.getProjectSchedule({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

// GET /projects/:projectId/schedule/revisions
router.get(
  '/revisions',
  asyncHandler(async (req, res) => {
    const result = await scheduleService.listRevisions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

// GET /projects/:projectId/schedule/revisions/:revisionId
router.get(
  '/revisions/:revisionId',
  asyncHandler(async (req, res) => {
    const result = await scheduleService.getRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
    });
    if (!result) {
      throw new HttpError(404, 'REVISION_NOT_FOUND', 'Revision not found');
    }
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/baseline
router.post(
  '/baseline',
  requireRoles('pm', 'planning_eng'),
  asyncHandler(async (req, res) => {
    const result = await scheduleService.lockBaseline({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/generate — returns jobId immediately
router.post(
  '/generate',
  requireRoles('pm', 'planning_eng'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');
    const result = await scheduleService.startGenerateJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      file: req.file,
      label: req.body?.label || null,
    });
    return sendSuccess(res, result, 202);
  }),
);

// GET /projects/:projectId/schedule/job/:jobId — poll for status
router.get(
  '/job/:jobId',
  asyncHandler(async (req, res) => {
    const job = scheduleService.getJob(req.params.jobId);
    if (!job)
      throw new HttpError(404, 'JOB_NOT_FOUND', 'Job not found or expired');
    // Verify job belongs to this project
    if (job.projectId !== req.params.projectId) {
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Job does not belong to this project',
      );
    }
    return sendSuccess(res, job);
  }),
);

// GET /projects/:projectId/schedule/resources
router.get(
  '/resources',
  asyncHandler(async (req, res) => {
    const result = await scheduleService.getResourcePlan({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
