const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const {
  aiGenerationLimiter,
  uploadLimiter,
} = require('../middleware/rate-limit');
const { getEffectiveRole, requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const scheduleService = require('../services/schedule.service');
const fileStorageService = require('../services/file-storage.service');

// Mounted with mergeParams: true from projects router
const router = express.Router({ mergeParams: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, fileStorageService.ensureTempUploadDirSync());
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => {
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '').toLowerCase()}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (
      allowed.includes(ext) &&
      fileStorageService.isAllowedOriginalNameForType(
        fileStorageService.DOCUMENT_TYPES.SCHEDULE_GENERATION_SOURCE,
        file.originalname,
      )
    ) cb(null, true);
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
  requirePermission('schedule', 'read'),
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
  requirePermission('schedule', 'read'),
  asyncHandler(async (req, res) => {
    const result = await scheduleService.listRevisions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

// GET /projects/:projectId/schedule/revisions/:revisionId/readiness
router.get(
  '/revisions/:revisionId/readiness',
  requirePermission('schedule', 'read'),
  [param('revisionId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.getScheduleReadiness({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
    });
    return sendSuccess(res, result);
  }),
);

// GET /projects/:projectId/schedule/revisions/:revisionId/mapping
router.get(
  '/revisions/:revisionId/mapping',
  requirePermission('schedule', 'read'),
  [param('revisionId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.getRevisionMapping({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
    });
    return sendSuccess(res, result);
  }),
);

// GET /projects/:projectId/schedule/revisions/:revisionId
router.get(
  '/revisions/:revisionId',
  requirePermission('schedule', 'read'),
  [param('revisionId').isUUID(), validate],
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

// POST /projects/:projectId/schedule/revisions/:revisionId/activate
router.post(
  '/revisions/:revisionId/activate',
  requirePermission('schedule', 'approve', {
    transition: 'revision.activate',
  }),
  [
    param('revisionId').isUUID(),
    body('mappings').isArray(),
    body('mappings.*.oldActivityId').isString().trim().notEmpty(),
    body('mappings.*.newActivityKey').isString().trim().notEmpty(),
    body('unmappedRemovals').optional({ nullable: true }).isArray(),
    body('unmappedRemovals.*.oldActivityId')
      .optional()
      .isString()
      .trim()
      .notEmpty(),
    body('unmappedRemovals.*.reason')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .isLength({ max: 2000 }),
    body('comment').optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.activateRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      mappings: req.body.mappings,
      unmappedRemovals: req.body.unmappedRemovals || [],
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/rollback
router.post(
  '/revisions/:revisionId/rollback',
  requirePermission('schedule', 'approve', {
    transition: 'revision.rollback',
  }),
  [
    param('revisionId').isUUID(),
    body('reason').isString().trim().notEmpty().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.rollbackRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      reason: req.body.reason,
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/submit-review
router.post(
  '/revisions/:revisionId/submit-review',
  requirePermission('schedule', 'submit', {
    transition: 'revision.submit_review',
  }),
  [
    param('revisionId').isUUID(),
    body('comment').optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.submitRevisionForReview({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/approve
router.post(
  '/revisions/:revisionId/approve',
  requirePermission('schedule', 'approve', {
    transition: 'revision.approve',
  }),
  [
    param('revisionId').isUUID(),
    body('comment').optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.approveRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/reject
router.post(
  '/revisions/:revisionId/reject',
  requirePermission('schedule', 'approve', {
    transition: 'revision.reject',
  }),
  [
    param('revisionId').isUUID(),
    body('reason').isString().trim().notEmpty().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.rejectRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      reason: req.body.reason,
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/baseline
router.post(
  '/revisions/:revisionId/baseline',
  requirePermission('schedule', 'baseline', {
    transition: 'revision.baseline',
  }),
  [
    param('revisionId').isUUID(),
    body('comment').optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.lockBaseline({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/baseline
router.post(
  '/baseline',
  requirePermission('schedule', 'baseline', {
    transition: 'revision.baseline',
  }),
  [
    body('revisionId').optional({ nullable: true }).isUUID(),
    body('comment').optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await scheduleService.lockBaseline({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.body?.revisionId || null,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/schedule/generate — returns jobId immediately
router.post(
  '/generate',
  requirePermission('schedule', 'create'),
  aiGenerationLimiter,
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');
    let document = null;
    try {
      document = await fileStorageService.uploadScheduleGenerationFile({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        file: req.file,
      });
      const result = await scheduleService.startGenerateJob({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        file: req.file,
        label: req.body?.label || null,
        userId: req.user.id,
      });
      await fileStorageService.markDocumentLinked({
        documentId: document.documentId,
        entityType: 'schedule_generation_job',
        entityId: result.jobId,
      });
      return sendSuccess(res, { ...result, document }, 202);
    } catch (error) {
      if (document?.documentId) {
        await fileStorageService.markDocumentRejected({
          documentId: document.documentId,
          code: error.code || 'SCHEDULE_GENERATION_FAILED',
          message: error.message,
        }).catch(() => {});
      }
      throw error;
    } finally {
      await fileStorageService.cleanupTempFiles(req.file);
    }
  }),
);

router.get(
  '/uploads/:documentId',
  requirePermission('schedule', 'read'),
  asyncHandler(async (req, res) => {
    const file = await fileStorageService.getScheduleGenerationFile({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      key: req.params.documentId,
    });
    if (file.redirectUrl) {
      return res.redirect(302, file.redirectUrl);
    }
    res.type(file.mimeType);
    return res.sendFile(file.path);
  }),
);

// GET /projects/:projectId/schedule/job/:jobId — poll for status
router.get(
  '/job/:jobId',
  requirePermission('schedule', 'read'),
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
  requirePermission('schedule', 'read'),
  asyncHandler(async (req, res) => {
    const result = await scheduleService.getResourcePlan({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
