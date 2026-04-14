const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const changeOrderService = require('../services/change-order.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.listChangeOrders({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'qs'),
  [
    body('description').isString().trim().notEmpty(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('category').optional().isString().trim(),
    body('value').optional().isFloat({ min: 0 }).toFloat(),
    body('status').optional().isIn(['pending', 'approved', 'rejected']),
    body('scheduleImpact').optional().isInt().toInt(),
    body('submittedDate').optional().isISO8601(),
    body('raisedBy').optional().isString().trim(),
    body('rejectedReason').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.createChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:id',
  requireRoles('pm', 'qs'),
  [
    param('id').isUUID(),
    body('description').optional().isString().trim().notEmpty(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('category').optional().isString().trim(),
    body('value').optional().isFloat({ min: 0 }).toFloat(),
    body('status').optional().isIn(['pending', 'approved', 'rejected']),
    body('scheduleImpact').optional().isInt().toInt(),
    body('submittedDate').optional().isISO8601(),
    body('raisedBy').optional().isString().trim(),
    body('rejectedReason').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.updateChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  '/:id',
  requireRoles('pm'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    await changeOrderService.deleteChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
    });
    return sendSuccess(res, { deleted: true });
  }),
);

module.exports = router;
