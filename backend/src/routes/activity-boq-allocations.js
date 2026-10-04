const express = require('express');
const multer = require('multer');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const allocationService = require('../services/activity-boq-allocation.service');
const suggestionService = require('../services/mapping-suggestion.service');
const importService = require('../services/mapping-import.service');

const router = express.Router({ mergeParams: true });
const CAN_CREATE = requirePermission('boq', 'create', {
  transition: 'allocation.create',
});
const CAN_UPDATE = requirePermission('boq', 'update', {
  transition: 'allocation.update',
});
const CAN_SUBMIT = requirePermission('boq', 'submit', {
  transition: 'allocation.submit',
});
const CAN_APPROVE = requirePermission('boq', 'approve', {
  transition: 'allocation.approve',
});
const CAN_REJECT = requirePermission('boq', 'approve', {
  transition: 'allocation.reject',
});

// A mapping file is small (two code columns and a figure) and read once, so
// it stays in memory: no temp file, no document record, nothing to clean up.
const mappingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = `.${String(file.originalname || '').split('.').pop().toLowerCase()}`;
    if (['.xlsx', '.xls', '.csv'].includes(ext)) return cb(null, true);
    return cb(new HttpError(400, 'MAPPING_IMPORT_INVALID', 'Upload an .xlsx, .xls or .csv mapping file'));
  },
});

const allocationFigureValidators = () => [
  body('quantity').optional().isFloat({ gt: 0 }).toFloat(),
  moneyBody('amount', { min: 0.01 }),
  body('weight').optional().isFloat({ min: 0 }).toFloat(),
  body('basis').optional().isIn(allocationService.VALID_BASES),
  body('source').optional().isIn(['manual', 'import', 'ai', 'migration']),
  body('notes').optional({ nullable: true }).isString().trim(),
  body('locationId').optional({ nullable: true }).isString().isUUID(),
  body('suggestedBy').optional({ nullable: true }).isIn(allocationService.SUGGESTION_SOURCES),
  body('confidence').optional({ nullable: true }).isFloat({ min: 0, max: 1 }).toFloat(),
];

router.use(authenticate);

router.get(
  '/',
  requirePermission('boq', 'read'),
  [
    query('status').isString()
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    query('boqItemId').isString().optional().isUUID(),
    query('activityId').isString().optional().isUUID(),
    query('includeInactive').isString().optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await allocationService.listAllocations({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status,
      boqItemId: req.query.boqItemId,
      activityId: req.query.activityId,
      includeInactive: req.query.includeInactive,
    });

    return sendSuccess(res, result);
  }),
);

// Coverage (§69): the allocation summary grouped by a structure dimension,
// as of an optional cutoff date.
router.get(
  '/coverage',
  requirePermission('boq', 'read'),
  [
    query('groupBy').isString().optional().isIn(allocationService.GROUP_BY_OPTIONS),
    query('cutoffDate').isString().optional().isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await allocationService.getCoverage({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      groupBy: req.query.groupBy || 'none',
      cutoffDate: req.query.cutoffDate || null,
    });
    return sendSuccess(res, result);
  }),
);

// Suggestions (§94-§95): ranked candidates with provenance; never writes.
router.get(
  '/suggestions',
  requirePermission('boq', 'read'),
  [
    query('boqItemId').isString().optional().isUUID(),
    query('limit').isString().optional().isInt({ min: 1, max: 20 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await suggestionService.listSuggestions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      boqItemId: req.query.boqItemId || null,
      limit: req.query.limit,
    });
    return sendSuccess(res, result);
  }),
);

// Mapping rule (§66-§68) on a set of rows or a whole section.
router.patch(
  '/mapping-rules',
  CAN_UPDATE,
  [
    body('rule').isIn(allocationService.MAPPING_RULES),
    body('itemIds').optional().isArray({ max: 2000 }),
    body('itemIds.*').isString().isUUID(),
    body('section').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await allocationService.setMappingRules({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

// Several drafts in one call (the matrix's bulk allocate); each row is judged
// on its own and reported.
router.post(
  '/bulk',
  CAN_CREATE,
  [
    body('allocations').isArray({ min: 1, max: 500 }),
    body('allocations.*.boqItemId').isString().isUUID(),
    body('allocations.*.activityId').isString().isUUID(),
    body('allocations.*.quantity').optional().isFloat({ gt: 0 }).toFloat(),
    // Money is money on every path: the same two-decimal rule as the single
    // create, so a bulk row cannot carry a figure the service would round.
    moneyBody('allocations.*.amount', { min: 0.01 }),
    body('allocations.*.weight').optional().isFloat({ min: 0 }).toFloat(),
    body('allocations.*.basis').optional().isIn(allocationService.VALID_BASES),
    body('allocations.*.notes').optional({ nullable: true }).isString().trim(),
    body('allocations.*.locationId').optional({ nullable: true }).isString().isUUID(),
    body('allocations.*.suggestedBy').optional({ nullable: true }).isIn(allocationService.SUGGESTION_SOURCES),
    body('allocations.*.confidence').optional({ nullable: true }).isFloat({ min: 0, max: 1 }).toFloat(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await allocationService.createAllocationsBulk({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      allocations: req.body.allocations,
    });
    return sendSuccess(res, result, result.createdCount > 0 ? 201 : 200);
  }),
);

// Mapping-file import: ?dryRun=true reports; without it, applies as drafts
// under one batch id.
router.post(
  '/import',
  CAN_CREATE,
  [query('dryRun').isString().optional().isBoolean().toBoolean(), validate],
  mappingUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer) throw new HttpError(400, 'NO_FILE', 'No file uploaded');
    const args = {
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      file: req.file.buffer,
    };
    if (req.query.dryRun === true) {
      return sendSuccess(res, await importService.dryRunImport(args));
    }
    const result = await importService.applyImport(args);
    return sendSuccess(res, result, result.summary.created > 0 ? 201 : 200);
  }),
);

router.post(
  '/import/:batchId/undo',
  CAN_REJECT,
  [param('batchId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await importService.undoImportBatch({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      batchId: req.params.batchId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  CAN_CREATE,
  [
    body('boqItemId').isString().isUUID(),
    body('activityId').isString().isUUID(),
    ...allocationFigureValidators(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await allocationService.createAllocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:id',
  CAN_UPDATE,
  [
    param('id').isUUID(),
    body('boqItemId').optional().isString().isUUID(),
    body('activityId').optional().isString().isUUID(),
    ...allocationFigureValidators(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await allocationService.updateAllocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      allocationId: req.params.id,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, result);
  }),
);

router.post(
  '/:id/submit',
  CAN_SUBMIT,
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await allocationService.submitAllocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      allocationId: req.params.id,
      userId: req.user.id,
    });

    return sendSuccess(res, result);
  }),
);

router.post(
  '/:id/approve',
  CAN_APPROVE,
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await allocationService.approveAllocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      allocationId: req.params.id,
      userId: req.user.id,
    });

    return sendSuccess(res, result);
  }),
);

router.post(
  '/:id/reject',
  CAN_REJECT,
  [
    param('id').isUUID(),
    body('reason').isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await allocationService.rejectAllocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      allocationId: req.params.id,
      userId: req.user.id,
      reason: req.body.reason,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
