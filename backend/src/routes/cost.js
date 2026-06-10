const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const costService = require('../services/cost.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  requirePermission('cost', 'read'),
  [
    query('cursor').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('activityId').optional().isUUID(),
    query('category').optional().isString().trim().isLength({ max: 120 }),
    query('search').optional().isString().trim().isLength({ max: 120 }),
    query('sortBy')
      .optional()
      .isIn([
        'activity',
        'phase',
        'updated',
        'labour',
        'material',
        'equipment',
        'subcontract',
        'committed',
        'actual',
        'forecast',
      ]),
    query('sortDir').optional().isIn(['asc', 'desc']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.getCostRecords({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/summary',
  requirePermission('cost', 'read'),
  asyncHandler(async (req, res) => {
    const result = await costService.getCostSummary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/burn-rate',
  requirePermission('cost', 'read'),
  asyncHandler(async (req, res) => {
    const result = await costService.getBurnRate({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/burn-rate',
  requirePermission('cost', 'create', {
    transition: 'burn_rate.create',
  }),
  [
    body('date').optional().isISO8601(),
    moneyBody('amount', { required: true }),
    body('category').optional().isString().trim(),
    body('note').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.addBurnRateEntry({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/activity/:activityId',
  requirePermission('cost', 'create', {
    transition: 'activity_cost.upsert',
  }),
  [
    param('activityId').isUUID(),
    moneyBody('labour'),
    moneyBody('material'),
    moneyBody('equipment'),
    moneyBody('subcontract'),
    moneyBody('indirect'),
    moneyBody('overhead'),
    moneyBody('contingency'),
    moneyBody('budget'),
    moneyBody('committed'),
    moneyBody('actual'),
    body('actualThroughDate').optional({ nullable: true }).isISO8601(),
    moneyBody('forecast'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.upsertCostRecord({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:id',
  requirePermission('cost', 'update', {
    transition: 'activity_cost.update',
  }),
  [
    param('id').isUUID(),
    moneyBody('labour'),
    moneyBody('material'),
    moneyBody('equipment'),
    moneyBody('subcontract'),
    moneyBody('indirect'),
    moneyBody('overhead'),
    moneyBody('contingency'),
    moneyBody('budget'),
    moneyBody('committed'),
    moneyBody('actual'),
    body('actualThroughDate').optional({ nullable: true }).isISO8601(),
    moneyBody('forecast'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.updateCostRecord({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costRecordId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
