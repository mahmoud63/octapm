const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const allocationService = require('../services/activity-boq-allocation.service');

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

router.use(authenticate);

router.get(
  '/',
  requirePermission('boq', 'read'),
  [
    query('status')
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    query('boqItemId').optional().isUUID(),
    query('activityId').optional().isUUID(),
    query('includeInactive').optional().isBoolean().toBoolean(),
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

router.post(
  '/',
  CAN_CREATE,
  [
    body('boqItemId').isUUID(),
    body('activityId').isUUID(),
    body('quantity').isFloat({ gt: 0 }).toFloat(),
    moneyBody('amount', { min: 0.01 }),
    body('weight').optional().isFloat({ min: 0 }).toFloat(),
    body('source').optional().isIn(['manual', 'import', 'ai', 'migration']),
    body('notes').optional({ nullable: true }).isString().trim(),
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
    body('boqItemId').optional().isUUID(),
    body('activityId').optional().isUUID(),
    body('quantity').optional().isFloat({ gt: 0 }).toFloat(),
    moneyBody('amount', { min: 0.01 }),
    body('weight').optional().isFloat({ min: 0 }).toFloat(),
    body('source').optional().isIn(['manual', 'import', 'ai', 'migration']),
    body('notes').optional({ nullable: true }).isString().trim(),
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
