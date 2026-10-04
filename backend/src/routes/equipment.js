const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission, requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const equipmentService = require('../services/equipment.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/usage',
  requirePermission('cost', 'read'),
  [
    query('activityId').isString().optional().isUUID(),
    query('equipmentId').isString().optional().isUUID(),
    query('from').isString().optional().isISO8601(),
    query('to').isString().optional().isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await equipmentService.getEquipmentUtilization({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.query.activityId || null,
      equipmentId: req.query.equipmentId || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await equipmentService.listEquipment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'planning_eng'),
  [
    body('companyEquipmentId').optional({ nullable: true }).isString().isUUID(),
    body('name')
      .if(body('companyEquipmentId').not().exists({ checkFalsy: true }))
      .isString()
      .trim()
      .notEmpty(),
    body('name').optional({ nullable: true }).isString().trim(),
    body('rateType')
      .if(body('companyEquipmentId').not().exists({ checkFalsy: true }))
      .isIn(['hourly', 'daily']),
    body('rateType').optional().isIn(['hourly', 'daily']),
    moneyBody('rate'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await equipmentService.addEquipment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:equipmentId',
  requireRoles('pm', 'planning_eng'),
  [
    param('equipmentId').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('rateType').optional().isIn(['hourly', 'daily']),
    moneyBody('rate'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await equipmentService.updateEquipment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      equipmentId: req.params.equipmentId,
      payload: req.body,
    });

    return sendSuccess(res, result);
  }),
);

router.delete(
  '/:equipmentId',
  requireRoles('pm', 'planning_eng'),
  [param('equipmentId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await equipmentService.deleteEquipment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      equipmentId: req.params.equipmentId,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
