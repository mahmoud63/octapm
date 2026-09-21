const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { getEffectiveRole, requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const activityService = require('../services/activity.service');
const progressService = require('../services/progress.service');

const VALID_CATEGORIES = [
  'civil',
  'structural',
  'mechanical',
  'electrical',
  'plumbing',
  'finishing',
  'landscaping',
  'demolition',
  'inspection',
  'other',
];
const VALID_RELATIONSHIPS = ['FS', 'SS', 'FF', 'SF'];
const VALID_PROGRESS_METHODS = [
  'percent',
  'quantity',
  'weighted_milestone',
  'inspection',
  'manual',
  'percent_complete',
  'physical_percent',
  'duration',
  'milestone',
];
const VALID_PROGRESS_SOURCES = ['manual', 'import', 'mobile', 'daily_report'];
const VALID_PROGRESS_STATUSES = ['draft', 'submitted'];

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  requirePermission('schedule', 'read'),
  asyncHandler(async (req, res) => {
    const result = await activityService.listActivities({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requirePermission('schedule', 'create'),
  [
    body('name').isString().trim().notEmpty(),
    body('category').optional().isIn(VALID_CATEGORIES),
    body('activityCode')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 64 }),
    body('wbsCode').optional().isString().trim(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('earlyStart').optional().isInt({ min: 0 }).toInt(),
    body('earlyFinish').optional().isInt({ min: 0 }).toInt(),
    body('lateStart').optional().isInt({ min: 0 }).toInt(),
    body('lateFinish').optional().isInt({ min: 0 }).toInt(),
    body('totalFloat').optional().isInt({ min: 0 }).toInt(),
    body('duration').optional().isInt({ min: 0 }).toInt(),
    body('predecessors').optional().isString().trim(),
    body('dependencies').optional().isArray(),
    body('dependencies.*.predecessorId').optional().isUUID(),
    body('dependencies.*.predecessorActivityId').optional().isUUID(),
    body('dependencies.*.predecessorRef').optional().isString().trim(),
    body('dependencies.*.relationshipType').optional().isIn(VALID_RELATIONSHIPS),
    body('dependencies.*.lagDays').optional().isInt().toInt(),
    body('isCritical').optional().isBoolean().toBoolean(),
    moneyBody('budget'),
    body('isMilestone').optional().isBoolean().toBoolean(),
    body('sortOrder').optional().isInt({ min: 0 }).toInt(),
    body('engineerIds')
      .isArray({ min: 1 })
      .withMessage('At least one engineer required'),
    body('engineerIds.*').isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.createActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/bulk-progress',
  requirePermission('progress', 'submit', {
    transition: 'submission.submit',
  }),
  [
    body('updates').isArray({ min: 1 }),
    body('updates.*.activityId').isUUID(),
    body('updates.*.pctComplete')
      .optional()
      .isFloat({ min: 0, max: 100 })
      .toFloat(),
    moneyBody('updates.*.actualCost'),
    body('updates.*.progressMethod').optional().isIn(VALID_PROGRESS_METHODS),
    body('updates.*.method').optional().isIn(VALID_PROGRESS_METHODS),
    body('updates.*.status').optional().isIn(VALID_PROGRESS_STATUSES),
    body('updates.*.source').optional().isIn(VALID_PROGRESS_SOURCES),
    body('updates.*.quantityComplete').optional().isFloat({ min: 0 }).toFloat(),
    body('updates.*.quantityPlanned').optional().isFloat({ min: 0 }).toFloat(),
    body('updates.*.quantityUnit').optional().isString().trim(),
    body('updates.*.inspectionStatus').optional().isString().trim(),
    body('updates.*.notes').optional().isString().trim(),
    body('updates.*.evidence').optional().isObject(),
    body('updates.*.milestones').optional().isArray(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.bulkUpdateProgress({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      updates: req.body.updates,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/progress-submissions',
  requirePermission('progress', 'read'),
  [
    query('status')
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    query('from').optional().isISO8601({ strict: true }),
    query('to').optional().isISO8601({ strict: true }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await progressService.listProgressSubmissions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/:id',
  requirePermission('schedule', 'read'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await activityService.getActivityById({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/:id',
  requirePermission('schedule', 'update'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('category').optional().isIn(VALID_CATEGORIES),
    body('activityCode')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 64 }),
    body('wbsCode').optional().isString().trim(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('earlyStart').optional().isInt({ min: 0 }).toInt(),
    body('earlyFinish').optional().isInt({ min: 0 }).toInt(),
    body('lateStart').optional().isInt({ min: 0 }).toInt(),
    body('lateFinish').optional().isInt({ min: 0 }).toInt(),
    body('totalFloat').optional().isInt({ min: 0 }).toInt(),
    body('duration').optional().isInt({ min: 0 }).toInt(),
    body('predecessors').optional().isString().trim(),
    body('dependencies').optional().isArray(),
    body('dependencies.*.predecessorId').optional().isUUID(),
    body('dependencies.*.predecessorActivityId').optional().isUUID(),
    body('dependencies.*.predecessorRef').optional().isString().trim(),
    body('dependencies.*.relationshipType').optional().isIn(VALID_RELATIONSHIPS),
    body('dependencies.*.lagDays').optional().isInt().toInt(),
    body('isCritical').optional().isBoolean().toBoolean(),
    moneyBody('budget'),
    body('isMilestone').optional().isBoolean().toBoolean(),
    body('sortOrder').optional().isInt({ min: 0 }).toInt(),
    body('engineerIds').optional().isArray({ min: 1 }),
    body('engineerIds.*').optional().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.updateActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/:id/progress-method',
  requirePermission('progress', 'read'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await progressService.getProgressMethod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.put(
  '/:id/progress-method',
  requirePermission('progress', 'update', {
    transition: 'method.configure',
  }),
  [
    param('id').isUUID(),
    body('method').isIn(VALID_PROGRESS_METHODS),
    body('plannedQuantity').optional({ nullable: true }).isFloat({ min: 0 }).toFloat(),
    body('quantityUnit').optional({ nullable: true }).isString().trim(),
    body('milestoneWeights').optional({ nullable: true }).isArray(),
    body('milestoneWeights.*.id').optional().isString().trim(),
    body('milestoneWeights.*.name').optional().isString().trim(),
    body('milestoneWeights.*.weight').optional().isFloat({ min: 0 }).toFloat(),
    body('inspectionRequired').optional().isBoolean().toBoolean(),
    body('evidenceRequired').optional().isBoolean().toBoolean(),
    body('notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await progressService.upsertProgressMethod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/:id/progress-submissions',
  requirePermission('progress', 'read'),
  [
    param('id').isUUID(),
    query('status')
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await progressService.listProgressSubmissions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      status: req.query.status || null,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:id/progress',
  requirePermission('progress', 'submit', {
    transition: 'submission.submit',
  }),
  [
    param('id').isUUID(),
    body('pctComplete').optional().isFloat({ min: 0, max: 100 }).toFloat(),
    moneyBody('actualCost'),
    body('actualStart').optional().isISO8601(),
    body('actualFinish').optional().isISO8601(),
    body('progressMethod').optional().isIn(VALID_PROGRESS_METHODS),
    body('method').optional().isIn(VALID_PROGRESS_METHODS),
    body('status').optional().isIn(VALID_PROGRESS_STATUSES),
    body('source').optional().isIn(VALID_PROGRESS_SOURCES),
    body('quantityComplete').optional().isFloat({ min: 0 }).toFloat(),
    body('quantityPlanned').optional().isFloat({ min: 0 }).toFloat(),
    body('quantityUnit').optional().isString().trim(),
    body('milestones').optional().isArray(),
    body('milestones.*.id').optional().isString().trim(),
    body('milestones.*.name').optional().isString().trim(),
    body('milestones.*.weight').optional().isFloat({ min: 0 }).toFloat(),
    body('milestones.*.pctComplete')
      .optional()
      .isFloat({ min: 0, max: 100 })
      .toFloat(),
    body('milestones.*.complete').optional().isBoolean().toBoolean(),
    body('inspectionStatus').optional().isString().trim(),
    body('evidence').optional().isObject(),
    body('notes').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.updateProgress({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      userId: req.user.id,
      // Without this the caller arrives at the assignment check with no role,
      // so the PM/planning override the refusal names can never apply — and
      // the same person doing the same thing through bulk-progress, which does
      // pass it, is allowed.
      userRole: getEffectiveRole(req),
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:id/progress-submissions/:submissionId/approve',
  requirePermission('progress', 'approve', {
    transition: 'submission.approve',
  }),
  [param('id').isUUID(), param('submissionId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await progressService.approveProgressSubmission({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      submissionId: req.params.submissionId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:id/progress-submissions/:submissionId/reject',
  requirePermission('progress', 'approve', {
    transition: 'submission.reject',
  }),
  [
    param('id').isUUID(),
    param('submissionId').isUUID(),
    body('reason').isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await progressService.rejectProgressSubmission({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      submissionId: req.params.submissionId,
      userId: req.user.id,
      reason: req.body.reason,
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  '/:id',
  requirePermission('schedule', 'delete'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await activityService.deleteActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.use('/:activityId/materials', require('./materials'));

module.exports = router;
