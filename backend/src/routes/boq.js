const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const { body, param, query } = require('express-validator');
const { validate, validateWithReasons } = require('../middleware/validate');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const {
  aiGenerationLimiter,
  uploadLimiter,
} = require('../middleware/rate-limit');
const { getEffectiveRole, hasPermission, requirePermission, requireRoles } = require('../middleware/rbac');
const { JOB_TYPES } = require('../jobs/job.service');

// The BOQ job routes are for BOQ jobs: the polling and the retry took any
// job of the project — a failed schedule import could be re-queued from
// here under the BOQ guard (Phase 21D, CX21-533).
const boqJobOnly = (job) => {
  if (!job || job.type !== JOB_TYPES.BOQ_PARSE) throw new HttpError(404, 'JOB_NOT_FOUND', 'Job not found or expired');
  return job;
};
// The upload polls its job's status: someone the template lets upload (BOQ
// create) but not read must still see their upload finish (the twelfth
// pass's note on CX21-526).
const canPollBoqJob = (req, res, next) =>
  hasPermission(req, 'boq', 'read') || hasPermission(req, 'boq', 'create')
    ? next()
    : next(Object.assign(new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action'), { details: { module: 'boq', action: 'read', source: req.projectAccess?.template ? 'template' : 'role' } }));
const boqService = require('../services/boq.service');
const controlsDetailService = require('../services/controls-detail.service');
const quantityViewsService = require('../services/quantity-views.service');
const { boqFigureAccess, withheldBoqItemDetail, withheldBoqItemQuantities } = require('../utils/boq-figures');
const fileStorageService = require('../services/file-storage.service');
const jobService = require('../jobs/job.service');
const { assertMoneyInput } = require('../utils/money');

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
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (
      ['.xlsx', '.xls'].includes(ext) &&
      fileStorageService.isAllowedOriginalNameForType(
        fileStorageService.DOCUMENT_TYPES.BOQ_UPLOAD,
        file.originalname,
      )
    ) cb(null, true);
    else cb(new HttpError(400, 'UNSUPPORTED_FORMAT', 'Only .xlsx and .xls files are allowed'));
  },
});

const CAN_MODIFY = requireRoles('pm', 'planning_eng', 'qs');

function assertPositiveNumber(value, field) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a positive number`,
    );
  }
}

function assertPositiveMoney(value, field) {
  assertMoneyInput(field, value, { min: 0.01 });
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A bill row says which activity it belongs to in one of two ways, never both:
 * activityId names one already on the programme, activityName describes one to
 * create. Accepting both would leave it ambiguous which the caller meant, and
 * guessing is how a shadow schedule gets built.
 */
function assertActivityChoice(body) {
  if (body.activityId && body.activityName) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Give either activityId, to use an activity already on the programme, or activityName, to create one — not both',
    );
  }
  if (body.activityId !== undefined && body.activityId !== null && !UUID.test(String(body.activityId))) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'activityId must be a UUID');
  }
}

function assertValidDependencyType(value) {
  if (value === undefined || value === null || value === '') return;
  if (!['FS', 'SS'].includes(value)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'dependencyType must be FS, SS, or null',
    );
  }
}

// GET /projects/:projectId/boq/template
router.get(
  '/template',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const workbook = await boqService.generateBoqTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="boq-template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  }),
);

// POST /projects/:projectId/boq/upload
//
// With ?dryRun=true the workbook is parsed and compared with the current bill
// and the answer is the comparison alone: no document, no revision, no rows,
// no job. The real upload is the same request without the flag.
//
// A dry run queues no AI job and spends no AI quota, so it is not counted
// against the AI generation window: previewing a workbook a few times must
// not lock the person out of the real upload for the rest of the hour. The
// upload window still counts it, since it is still a file the API parses.
const aiGenerationLimiterUnlessDryRun = (req, res, next) =>
  req.query.dryRun === true ? next() : aiGenerationLimiter(req, res, next);

router.post(
  '/upload',
  authenticate,
  CAN_MODIFY,
  [query('dryRun').isString().optional().isBoolean().toBoolean(), validate],
  uploadLimiter,
  aiGenerationLimiterUnlessDryRun,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');
    const { projectId } = req.params;
    const label = req.body?.label || null;

    try {
      if (req.query.dryRun === true) {
        const preview = await boqService.processBoqUpload(
          projectId,
          { path: req.file.path },
          label,
          { orgId: req.user.orgId, userId: req.user.id, dryRun: true },
        );
        return sendSuccess(res, preview);
      }

      const document = await fileStorageService.uploadBoqFile({
        orgId: req.user.orgId,
        projectId,
        userId: req.user.id,
        file: req.file,
      });
      const result = await boqService.processBoqUpload(
        projectId,
        { path: req.file.path },
        label,
        {
          orgId: req.user.orgId,
          userId: req.user.id,
          userRole: getEffectiveRole(req),
          documentId: document.documentId,
        },
      );
      return sendSuccess(res, { ...result, document });
    } finally {
      await fileStorageService.cleanupTempFiles(req.file);
    }
  }),
);

// GET /projects/:projectId/boq/uploads/:documentId
router.get(
  '/uploads/:documentId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const file = await fileStorageService.getBoqUploadFile({
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

// GET /projects/:projectId/boq/job/:jobId — poll the durable job status
router.get(
  '/job/:jobId',
  authenticate,
  canPollBoqJob,
  asyncHandler(async (req, res) => {
    const job = boqJobOnly(await jobService.getLegacyJob({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
    }));
    return sendSuccess(res, job);
  }),
);

// POST /projects/:projectId/boq/job/:jobId/retry — re-queue a failed AI job
router.post(
  '/job/:jobId/retry',
  authenticate,
  requirePermission('boq', 'update'),
  asyncHandler(async (req, res) => {
    boqJobOnly(await jobService.getLegacyJob({ orgId: req.user.orgId, projectId: req.params.projectId, jobId: req.params.jobId }));
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

// GET /projects/:projectId/boq/shadow-activities
//
// Reports activities that look like a bill row minted its own copy beside a
// real programme: money on them, no duration, no logic, while other activities
// on the same project have both. It only ever reports — deciding that two
// activities are the same piece of work is a person's judgement, and merging
// them would move financial history.
router.get(
  '/shadow-activities',
  authenticate,
  requirePermission('boq', 'read'),
  asyncHandler(async (req, res) => {
    const data = await boqService.findShadowActivities(req.params.projectId, {
      orgId: req.user.orgId,
    });
    return sendSuccess(res, data);
  }),
);

// GET /projects/:projectId/boq — the register is read under the BOQ
// permission (the project's template, a key's scope): it had authentication
// only, and a template that refused BOQ, or a key with no boq scope, read the
// financial register (Phase 21D, CX21-526).
router.get(
  '/',
  authenticate,
  requirePermission('boq', 'read'),
  asyncHandler(async (req, res) => {
    const data = await boqService.getProjectBoq(req.params.projectId, {
      orgId: req.user.orgId,
    });
    return sendSuccess(res, data);
  }),
);

// GET /projects/:projectId/boq/items/:itemId/detail — the BOQ item's whole
// story (PC-5): its structure, mapping and linked activities, quantities,
// money, certification, commitments, changes, procurement, readiness flags,
// documents and history, each section gated by the module that owns it
// (controls-detail.service). Another organisation's item, or a missing one,
// is 404 BOQ_ITEM_NOT_FOUND.
router.get(
  '/items/:itemId/detail',
  authenticate,
  requirePermission('boq', 'read'),
  [param('itemId').isUUID().withMessage('The BOQ item id is not valid'), validate],
  asyncHandler(async (req, res) => {
    const detail = await controlsDetailService.getBoqItemDetail({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
      ...controlsDetailService.detailReader(req),
    });
    return sendSuccess(res, withheldBoqItemDetail(detail, boqFigureAccess(req)));
  }),
);

// GET /projects/:projectId/boq/items/:itemId/quantities — the row's five
// quantities (PC-6): installed, certified, paid, received, issued — plus
// committed — each from the service that owns it, each with its truth, basis,
// unit and unit-match flag, never merged or summed across units
// (quantity-views.service). cutoffDate bounds installed, certified and the
// stock movements. Admitted on boq:read; the certified and paid figures
// follow ipc:read, received and issued inventory:read, committed
// commitment:read — a figure a viewer's modules do not admit says so.
router.get(
  '/items/:itemId/quantities',
  authenticate,
  requirePermission('boq', 'read'),
  [
    param('itemId').isUUID().withMessage('The BOQ item id is not valid'),
    query('cutoffDate').isString().optional().isISO8601().withMessage('cutoffDate must be an ISO 8601 date'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const { can, partyScoped } = controlsDetailService.detailReader(req);
    const view = await quantityViewsService.getBoqItemQuantities({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
      cutoffDate: req.query.cutoffDate || null,
      can,
      partyScoped,
    });
    return sendSuccess(res, withheldBoqItemQuantities(view, boqFigureAccess(req)));
  }),
);

// The revision review (PC-2). Submit and approve are the BOQ module's own
// submit / approve actions; the lock is an approval too — the policy's
// `baseline` action on the BOQ module names no role, so it cannot gate
// anything yet. There is no unlock, as there is none for a schedule baseline.
// The review steps refuse in words (validateWithReasons): an API client —
// mobile, which production answers without details — reads the reason.
const revisionParams = [
  param('revisionId')
    .isUUID()
    .withMessage('The BOQ revision id is not valid: refresh the BOQ page and try again.'),
];
const reviewComment = body('comment')
  .optional({ nullable: true })
  .isString()
  .withMessage('The review comment must be text.')
  .bail()
  .trim()
  .isLength({ max: 2000 })
  .withMessage('The review comment can be at most 2,000 characters.');
const revisionOptions = (req) => ({
  orgId: req.user.orgId,
  userId: req.user.id,
  userRole: getEffectiveRole(req),
  comment: req.body?.comment || null,
});

// GET /projects/:projectId/boq/revisions/:revisionId
router.get(
  '/revisions/:revisionId',
  authenticate,
  requirePermission('boq', 'read'),
  [...revisionParams, validateWithReasons],
  asyncHandler(async (req, res) => {
    const revision = await boqService.getBoqRevision(
      req.params.projectId,
      req.params.revisionId,
      { orgId: req.user.orgId },
    );
    return sendSuccess(res, revision);
  }),
);

// POST /projects/:projectId/boq/revisions/:revisionId/submit
router.post(
  '/revisions/:revisionId/submit',
  authenticate,
  requirePermission('boq', 'submit'),
  [...revisionParams, reviewComment, validateWithReasons],
  asyncHandler(async (req, res) => {
    const revision = await boqService.submitBoqRevision(
      req.params.projectId,
      req.params.revisionId,
      revisionOptions(req),
    );
    return sendSuccess(res, revision);
  }),
);

// POST /projects/:projectId/boq/revisions/:revisionId/approve
router.post(
  '/revisions/:revisionId/approve',
  authenticate,
  requirePermission('boq', 'approve'),
  [...revisionParams, reviewComment, validateWithReasons],
  asyncHandler(async (req, res) => {
    const revision = await boqService.approveBoqRevision(
      req.params.projectId,
      req.params.revisionId,
      revisionOptions(req),
    );
    return sendSuccess(res, revision);
  }),
);

// POST /projects/:projectId/boq/revisions/:revisionId/lock
router.post(
  '/revisions/:revisionId/lock',
  authenticate,
  requirePermission('boq', 'approve'),
  [...revisionParams, reviewComment, validateWithReasons],
  asyncHandler(async (req, res) => {
    const result = await boqService.lockBoqBaseline(
      req.params.projectId,
      req.params.revisionId,
      revisionOptions(req),
    );
    return sendSuccess(res, result);
  }),
);

// PATCH /projects/:projectId/boq/items/:itemId
router.patch(
  '/items/:itemId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const result = await boqService.updateBoqItem(
      req.params.projectId,
      req.params.itemId,
      req.body,
      {
        orgId: req.user.orgId,
        userId: req.user.id,
        userRole: getEffectiveRole(req),
      },
    );
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/boq/items
router.post(
  '/items',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const { code, description, quantity, unit, rate } = req.body;
    if (!code || !description || !quantity || !unit || !rate) {
      throw new HttpError(400, 'MISSING_FIELDS', 'code, description, quantity, unit and rate are required');
    }
    // The activity is optional now, and may be given either way: activityId to
    // allocate the row to an activity already on the programme, activityName to
    // create one for it, or neither to leave the row unallocated and split it
    // across several activities afterwards.
    assertActivityChoice(req.body);
    assertPositiveNumber(quantity, 'quantity');
    assertPositiveMoney(rate, 'rate');
    const result = await boqService.createManualBoqItem(
      req.params.projectId,
      req.body,
      {
        orgId: req.user.orgId,
        userId: req.user.id,
        userRole: getEffectiveRole(req),
      },
    );
    return sendSuccess(res, result, 201);
  }),
);

// DELETE /projects/:projectId/boq/items/:itemId — deletion is the BOQ delete
// permission's (PM only in the policy); the shared modification list let a
// QS or planning engineer remove rows (Phase 21D, CX21-537).
router.delete(
  '/items/:itemId',
  authenticate,
  requirePermission('boq', 'delete'),
  asyncHandler(async (req, res) => {
    const result = await boqService.deleteBoqItem(
      req.params.projectId,
      req.params.itemId,
      {
        orgId: req.user.orgId,
        userId: req.user.id,
        userRole: getEffectiveRole(req),
      },
    );
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/boq/items/:itemId/activities
router.post(
  '/items/:itemId/activities',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const { activityId, activityName, unit, quantity, rate } = req.body;
    if ((!activityId && !activityName) || !unit || quantity === undefined || rate === undefined) {
      throw new HttpError(
        400,
        'MISSING_FIELDS',
        'unit, quantity and rate are required, with either activityId (an activity already on the programme) or activityName (one to create)',
      );
    }
    assertActivityChoice(req.body);
    assertPositiveNumber(quantity, 'quantity');
    assertPositiveMoney(rate, 'rate');
    assertValidDependencyType(req.body.dependencyType);
    const result = await boqService.createActivity(
      req.params.projectId,
      req.params.itemId,
      req.body,
      {
        orgId: req.user.orgId,
        userId: req.user.id,
        userRole: getEffectiveRole(req),
      },
    );
    return sendSuccess(res, result, 201);
  }),
);

// PATCH /projects/:projectId/boq/activities/:activityId
router.patch(
  '/activities/:activityId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    if (req.body.quantity !== undefined) {
      assertPositiveNumber(req.body.quantity, 'quantity');
    }
    if (req.body.rate !== undefined) {
      assertPositiveMoney(req.body.rate, 'rate');
    }
    assertValidDependencyType(req.body.dependencyType);
    const result = await boqService.updateActivity(
      req.params.projectId,
      req.params.activityId,
      req.body,
      {
        orgId: req.user.orgId,
        userId: req.user.id,
        userRole: getEffectiveRole(req),
      },
    );
    return sendSuccess(res, result);
  }),
);

// DELETE /projects/:projectId/boq/activities/:activityId
router.delete(
  '/activities/:activityId',
  authenticate,
  requirePermission('boq', 'delete'),
  asyncHandler(async (req, res) => {
    const result = await boqService.deleteActivity(
      req.params.projectId,
      req.params.activityId,
      {
        orgId: req.user.orgId,
        userId: req.user.id,
        userRole: getEffectiveRole(req),
        allocationId: req.body?.allocationId || req.query?.allocationId || null,
      },
    );
    return sendSuccess(res, result ?? null);
  }),
);

module.exports = router;
