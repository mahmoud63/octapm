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
const { getEffectiveRole, hasPermission, requirePermission } = require('../middleware/rbac');
const { validate, validateWithReasons } = require('../middleware/validate');
const scheduleService = require('../services/schedule.service');
const {
  boqFigureAccess,
  withheldError,
  withheldRevision,
  withheldSchedule,
  withheldScheduleReadiness,
} = require('../utils/boq-figures');
const ganttLayoutService = require('../services/gantt-layout.service');
const fileStorageService = require('../services/file-storage.service');
const jobService = require('../jobs/job.service');

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

/*
 * The schedule is read by everyone who may read the programme; the bill's
 * figures on it (each activity's approved allocation, the open value, the
 * readiness check that states the bill's value) are for those who may read
 * the BOQ, and its budgets for those who may read the BOQ or the cost
 * module (§12). Every response that carries a revision or an activity goes
 * through utils/boq-figures; a BOQ reader's answer is the service's own.
 */
// The lifecycle answers: a revision, or { revision, readiness?, ... }.
const withheldLifecycle = (result, req) => {
  const access = boqFigureAccess(req);
  if (access.boq || !result || typeof result !== 'object') return result;
  return {
    ...result,
    revision: withheldRevision(result.revision, access),
    ...('readiness' in result
      ? { readiness: withheldScheduleReadiness(result.readiness, access) }
      : {}),
  };
};

// ... and so are their refusals: approval and baseline lock refuse a
// schedule that is not ready (SCHEDULE_NOT_READY) with the whole readiness
// as error.details, which goes the way of the readiness a success answer
// carries. Status, code, message, ready and blockingCount stay.
const withheldRefusals = (handler) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    throw withheldError(error, boqFigureAccess(req));
  }
};

/*
 * The lifecycle's own refusals say what is missing (validateWithReasons makes
 * the first failing check's message the error's message), so an API client
 * — mobile, which production answers without details — reads the reason the
 * screen would give, never a bare "Validation failed".
 */
const reasonRequired = (requiredMessage, subject) => [
  body('reason')
    .isString()
    .withMessage(requiredMessage)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(requiredMessage)
    .bail()
    .isLength({ max: 2000 })
    .withMessage(`${subject} can be at most 2,000 characters.`),
];
const ACTIVATION_MAPPINGS_REQUIRED =
  'Activation needs the activity mappings: send "mappings" as a list pairing each active activity with its activity in this revision (an empty list when no schedule is active yet).';
// A lifecycle comment: optional, at most 2,000 characters, refused in words.
const optionalComment = (subject) =>
  body('comment')
    .optional({ nullable: true })
    .isString()
    .withMessage(`${subject} must be text.`)
    .bail()
    .trim()
    .isLength({ max: 2000 })
    .withMessage(`${subject} can be at most 2,000 characters.`);

/*
 * Whether this caller may take each fix a SCHEDULE_NOT_READY refusal names
 * (schedule.service FIX_PERMISSIONS): the refusal says who can when the
 * caller cannot, rather than sending them to a step they are not offered.
 */
const fixAccessFor = (req) => ({
  can: (key) => {
    const permission = scheduleService.FIX_PERMISSIONS[key];
    return Boolean(
      permission &&
        hasPermission(req, permission.module, permission.action, {
          transition: permission.transition,
        }),
    );
  },
});
const REVISION_ID_INVALID =
  'The schedule revision id is not valid: refresh Schedule › Revisions and try again.';
const ACTIVATION_REMOVALS_LIST =
  'Send "unmappedRemovals" as a list: one { oldActivityId, reason } for each active activity this revision leaves out.';
const ACTIVATION_REMOVAL_INCOMPLETE =
  'Each removal needs the active activity (oldActivityId) and the reason it is removed (reason).';
const ACTIVATION_MAPPING_INCOMPLETE =
  'Each activity mapping needs both the active activity (oldActivityId) and its activity in this revision (newActivityKey).';

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
    return sendSuccess(res, withheldSchedule(result, boqFigureAccess(req)));
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
    const access = boqFigureAccess(req);
    return sendSuccess(res, result.map((revision) => withheldRevision(revision, access)));
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
    return sendSuccess(res, withheldScheduleReadiness(result, boqFigureAccess(req)));
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
    return sendSuccess(res, withheldLifecycle(result, req));
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
    return sendSuccess(res, withheldRevision(result, boqFigureAccess(req)));
  }),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/activate
router.post(
  '/revisions/:revisionId/activate',
  requirePermission('schedule', 'approve', {
    transition: 'revision.activate',
  }),
  [
    param('revisionId').isUUID().withMessage(REVISION_ID_INVALID),
    body('mappings').isArray().withMessage(ACTIVATION_MAPPINGS_REQUIRED),
    body('mappings.*.oldActivityId')
      .isString()
      .withMessage(ACTIVATION_MAPPING_INCOMPLETE)
      .trim()
      .notEmpty()
      .withMessage(ACTIVATION_MAPPING_INCOMPLETE),
    body('mappings.*.newActivityKey')
      .isString()
      .withMessage(ACTIVATION_MAPPING_INCOMPLETE)
      .trim()
      .notEmpty()
      .withMessage(ACTIVATION_MAPPING_INCOMPLETE),
    body('unmappedRemovals')
      .optional({ nullable: true })
      .isArray()
      .withMessage(ACTIVATION_REMOVALS_LIST),
    body('unmappedRemovals.*.oldActivityId')
      .optional()
      .isString()
      .withMessage(ACTIVATION_REMOVAL_INCOMPLETE)
      .trim()
      .notEmpty()
      .withMessage(ACTIVATION_REMOVAL_INCOMPLETE),
    body('unmappedRemovals.*.reason')
      .optional()
      .isString()
      .withMessage(ACTIVATION_REMOVAL_INCOMPLETE)
      .trim()
      .notEmpty()
      .withMessage(ACTIVATION_REMOVAL_INCOMPLETE)
      .isLength({ max: 2000 })
      .withMessage('A removal reason can be at most 2,000 characters.'),
    optionalComment('The activation comment'),
    validateWithReasons,
  ],
  asyncHandler(withheldRefusals(async (req, res) => {
    const result = await scheduleService.activateRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      mappings: req.body.mappings,
      unmappedRemovals: req.body.unmappedRemovals || [],
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, withheldLifecycle(result, req));
  })),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/rollback
router.post(
  '/revisions/:revisionId/rollback',
  requirePermission('schedule', 'approve', {
    transition: 'revision.rollback',
  }),
  [
    param('revisionId').isUUID().withMessage(REVISION_ID_INVALID),
    ...reasonRequired('A rollback reason is required.', 'The rollback reason'),
    validateWithReasons,
  ],
  asyncHandler(withheldRefusals(async (req, res) => {
    const result = await scheduleService.rollbackRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      reason: req.body.reason,
    });
    return sendSuccess(res, withheldLifecycle(result, req));
  })),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/submit-review
router.post(
  '/revisions/:revisionId/submit-review',
  requirePermission('schedule', 'submit', {
    transition: 'revision.submit_review',
  }),
  [
    param('revisionId').isUUID().withMessage(REVISION_ID_INVALID),
    optionalComment('The review comment'),
    validateWithReasons,
  ],
  asyncHandler(withheldRefusals(async (req, res) => {
    const result = await scheduleService.submitRevisionForReview({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, withheldRevision(result, boqFigureAccess(req)));
  })),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/approve
router.post(
  '/revisions/:revisionId/approve',
  requirePermission('schedule', 'approve', {
    transition: 'revision.approve',
  }),
  [
    param('revisionId').isUUID().withMessage(REVISION_ID_INVALID),
    optionalComment('The approval comment'),
    validateWithReasons,
  ],
  asyncHandler(withheldRefusals(async (req, res) => {
    const result = await scheduleService.approveRevision({
      fixAccess: fixAccessFor(req),
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, withheldRevision(result, boqFigureAccess(req)));
  })),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/reject
router.post(
  '/revisions/:revisionId/reject',
  requirePermission('schedule', 'approve', {
    transition: 'revision.reject',
  }),
  [
    param('revisionId').isUUID().withMessage(REVISION_ID_INVALID),
    ...reasonRequired('A rejection reason is required.', 'The rejection reason'),
    validateWithReasons,
  ],
  asyncHandler(withheldRefusals(async (req, res) => {
    const result = await scheduleService.rejectRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      reason: req.body.reason,
    });
    return sendSuccess(res, withheldRevision(result, boqFigureAccess(req)));
  })),
);

// POST /projects/:projectId/schedule/revisions/:revisionId/baseline
router.post(
  '/revisions/:revisionId/baseline',
  requirePermission('schedule', 'baseline', {
    transition: 'revision.baseline',
  }),
  [
    param('revisionId').isUUID().withMessage(REVISION_ID_INVALID),
    optionalComment('The baseline comment'),
    validateWithReasons,
  ],
  asyncHandler(withheldRefusals(async (req, res) => {
    const result = await scheduleService.lockBaseline({
      fixAccess: fixAccessFor(req),
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, withheldLifecycle(result, req));
  })),
);

// POST /projects/:projectId/schedule/baseline
router.post(
  '/baseline',
  requirePermission('schedule', 'baseline', {
    transition: 'revision.baseline',
  }),
  [
    body('revisionId').optional({ nullable: true }).isUUID().withMessage(REVISION_ID_INVALID),
    optionalComment('The baseline comment'),
    validateWithReasons,
  ],
  asyncHandler(withheldRefusals(async (req, res) => {
    const result = await scheduleService.lockBaseline({
      fixAccess: fixAccessFor(req),
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.body?.revisionId || null,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, withheldLifecycle(result, req));
  })),
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

// The stored source of a schedule generation is the uploaded bill — every
// row's description, quantity, rate and amount — so it is served to a member
// who may read both the schedule and the BOQ (§12), as the BOQ's own
// uploads are under the BOQ's permission.
router.get(
  '/uploads/:documentId',
  requirePermission('schedule', 'read'),
  requirePermission('boq', 'read'),
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

// GET /projects/:projectId/schedule/job/:jobId — poll the durable job status
router.get(
  '/job/:jobId',
  requirePermission('schedule', 'read'),
  [param('jobId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const job = await jobService.getLegacyJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
    });
    if (!job)
      throw new HttpError(404, 'JOB_NOT_FOUND', 'Job not found or expired');
    return sendSuccess(res, job);
  }),
);

// POST /projects/:projectId/schedule/job/:jobId/retry — re-queue a failed job
router.post(
  '/job/:jobId/retry',
  requirePermission('schedule', 'update'),
  [param('jobId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    await jobService.retryJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
      userId: req.user.id,
    });
    const job = await jobService.getLegacyJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
    });
    return sendSuccess(res, job, 202);
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

/*
 * Saved Gantt layouts.
 *
 * A layout is a view of the schedule, not schedule data — nothing here changes
 * an activity — so reading the schedule is permission enough to keep one and to
 * share it with the project. Who may change or remove a shared layout is
 * decided per row in the service.
 */
const layoutBody = [
  body('name').optional().isString().trim().isLength({ min: 1, max: 60 }),
  body('visibility').optional().isIn(ganttLayoutService.VISIBILITIES),
  body('layout').optional().isObject(),
];

// GET /projects/:projectId/schedule/layouts
router.get(
  '/layouts',
  requirePermission('schedule', 'read'),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await ganttLayoutService.listLayouts({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        user: req.user,
      }),
    ),
  ),
);

// POST /projects/:projectId/schedule/layouts — save under a name
router.post(
  '/layouts',
  requirePermission('schedule', 'read'),
  [
    body('name').isString().trim().isLength({ min: 1, max: 60 }),
    body('layout').isObject(),
    body('visibility').optional().isIn(ganttLayoutService.VISIBILITIES),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await ganttLayoutService.saveLayoutFor({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        user: req.user,
        payload: req.body,
      }),
      201,
    ),
  ),
);

// PATCH /projects/:projectId/schedule/layouts/:layoutId — rename, reshare, restate
router.patch(
  '/layouts/:layoutId',
  requirePermission('schedule', 'read'),
  [param('layoutId').isUUID(), ...layoutBody, validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await ganttLayoutService.updateLayout({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        user: req.user,
        layoutId: req.params.layoutId,
        payload: req.body,
      }),
    ),
  ),
);

// DELETE /projects/:projectId/schedule/layouts/:layoutId
router.delete(
  '/layouts/:layoutId',
  requirePermission('schedule', 'read'),
  [param('layoutId').isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await ganttLayoutService.deleteLayout({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        user: req.user,
        layoutId: req.params.layoutId,
      }),
    ),
  ),
);

module.exports = router;
