const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const evService = require('../services/earned-value.service');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const COST_LOADING_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'superseded',
];
const COST_LOADING_CREATE_STATUSES = ['draft', 'submitted'];

const COST_LOADING_SOURCES = [
  'manual',
  'import',
  'ai',
  'migration',
  'budget_revision',
];

router.get(
  '/periods',
  requirePermission('cost', 'read'),
  asyncHandler(async (req, res) => {
    const result = await evService.listReportingPeriods({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/periods',
  requirePermission('cost', 'create'),
  [
    body('code').optional().isString().trim().isLength({ max: 40 }),
    body('label').optional().isString().trim().isLength({ max: 120 }),
    body('periodStart').isISO8601(),
    body('periodEnd').isISO8601(),
    body('cutoffDate').optional().isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.createReportingPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/periods/:periodId/lock',
  requirePermission('cost', 'approve'),
  [param('periodId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await evService.lockReportingPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      periodId: req.params.periodId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/cost-loading',
  requirePermission('cost', 'read'),
  [
    query('status').optional().isIn(COST_LOADING_STATUSES),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.listCostLoadings({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/cost-loading',
  requirePermission('cost', 'create'),
  [
    body('activityId').isUUID(),
    body('reportingPeriodId').optional({ nullable: true }).isUUID(),
    body('plannedDate').isISO8601(),
    moneyBody('plannedValue', { required: true }),
    body('source').optional().isIn(COST_LOADING_SOURCES),
    body('baselineVersion').optional().isString().trim().isLength({ max: 80 }),
    body('status').optional().isIn(COST_LOADING_CREATE_STATUSES),
    body('notes').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.createCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      userRole: req.user.role,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/cost-loading/:id',
  requirePermission('cost', 'update'),
  [
    param('id').isUUID(),
    body('activityId').optional().isUUID(),
    body('reportingPeriodId').optional({ nullable: true }).isUUID(),
    body('plannedDate').optional().isISO8601(),
    moneyBody('plannedValue'),
    body('source').optional().isIn(COST_LOADING_SOURCES),
    body('baselineVersion').optional().isString().trim().isLength({ max: 80 }),
    body('notes').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.updateCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costLoadingId: req.params.id,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/cost-loading/:id/submit',
  requirePermission('cost', 'submit'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await evService.submitCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costLoadingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/cost-loading/:id/approve',
  requirePermission('cost', 'approve'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await evService.approveCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costLoadingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/cost-loading/:id/reject',
  requirePermission('cost', 'approve'),
  [
    param('id').isUUID(),
    body('reason').isString().trim().notEmpty().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.rejectCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costLoadingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
      reason: req.body.reason,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/ev',
  requirePermission('cost', 'read'),
  [
    query('periodId').optional().isUUID(),
    query('cutoffDate').optional().isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.buildOfficialEvReport({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      periodId: req.query.periodId || null,
      cutoffDate: req.query.cutoffDate || null,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
