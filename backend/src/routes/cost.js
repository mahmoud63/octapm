const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const costService = require('../services/cost.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await costService.getCostRecords({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/summary',
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
  requireRoles('pm', 'cost_controller', 'qs'),
  [
    body('date').optional().isISO8601(),
    body('amount').isFloat({ min: 0 }).toFloat(),
    body('category').optional().isString().trim(),
    body('note').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.addBurnRateEntry({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/activity/:activityId',
  requireRoles('pm', 'cost_controller', 'qs'),
  [
    param('activityId').isUUID(),
    body('labour').optional().isFloat({ min: 0 }).toFloat(),
    body('material').optional().isFloat({ min: 0 }).toFloat(),
    body('equipment').optional().isFloat({ min: 0 }).toFloat(),
    body('subcontract').optional().isFloat({ min: 0 }).toFloat(),
    body('indirect').optional().isFloat({ min: 0 }).toFloat(),
    body('overhead').optional().isFloat({ min: 0 }).toFloat(),
    body('contingency').optional().isFloat({ min: 0 }).toFloat(),
    body('budget').optional().isFloat({ min: 0 }).toFloat(),
    body('committed').optional().isFloat({ min: 0 }).toFloat(),
    body('actual').optional().isFloat({ min: 0 }).toFloat(),
    body('forecast').optional().isFloat({ min: 0 }).toFloat(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.upsertCostRecord({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:id',
  requireRoles('pm', 'cost_controller', 'qs'),
  [
    param('id').isUUID(),
    body('labour').optional().isFloat({ min: 0 }).toFloat(),
    body('material').optional().isFloat({ min: 0 }).toFloat(),
    body('equipment').optional().isFloat({ min: 0 }).toFloat(),
    body('subcontract').optional().isFloat({ min: 0 }).toFloat(),
    body('indirect').optional().isFloat({ min: 0 }).toFloat(),
    body('overhead').optional().isFloat({ min: 0 }).toFloat(),
    body('contingency').optional().isFloat({ min: 0 }).toFloat(),
    body('budget').optional().isFloat({ min: 0 }).toFloat(),
    body('committed').optional().isFloat({ min: 0 }).toFloat(),
    body('actual').optional().isFloat({ min: 0 }).toFloat(),
    body('forecast').optional().isFloat({ min: 0 }).toFloat(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.updateCostRecord({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costRecordId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
