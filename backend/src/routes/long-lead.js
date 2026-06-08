const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const longLeadService = require('../services/long-lead.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await longLeadService.listLongLeadItems({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'planning_eng', 'procurement'),
  [
    body('item').isString().trim().notEmpty(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('leadWeeks').optional().isInt({ min: 0 }).toInt(),
    body('orderBy').optional().isString().trim(),
    body('criticality').optional().isString().trim(),
    body('risk').optional().isString().trim(),
    body('status').optional().isIn(['not_ordered', 'ordered', 'delivered']),
    body('supplier').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await longLeadService.createLongLeadItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:id',
  requireRoles('pm', 'planning_eng', 'procurement'),
  [
    param('id').isUUID(),
    body('item').optional().isString().trim().notEmpty(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('leadWeeks').optional().isInt({ min: 0 }).toInt(),
    body('orderBy').optional().isString().trim(),
    body('criticality').optional().isString().trim(),
    body('risk').optional().isString().trim(),
    body('status').optional().isIn(['not_ordered', 'ordered', 'delivered']),
    body('supplier').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await longLeadService.updateLongLeadItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  '/:id',
  requireRoles('pm', 'planning_eng'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    await longLeadService.deleteLongLeadItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemId: req.params.id,
    });
    return sendSuccess(res, { deleted: true });
  }),
);

module.exports = router;
