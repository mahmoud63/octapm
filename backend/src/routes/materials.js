const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const materialService = require('../services/material.service');

const UNITS = [
  'TON',
  'KG',
  'M3',
  'M2',
  'M',
  'PCS',
  'L',
  'BAG',
  'SHEET',
  'ROLL',
  'LOAD',
];

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await materialService.listMaterials({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'planning_eng'),
  [
    body('name').isString().trim().notEmpty(),
    body('unit')
      .isIn(UNITS)
      .withMessage(`Unit must be one of: ${UNITS.join(', ')}`),
    body('qty')
      .isFloat({ min: 0.001 })
      .toFloat()
      .withMessage('Quantity must be positive'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await materialService.addMaterial({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      payload: req.body,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:materialId',
  requireRoles('pm', 'planning_eng'),
  [
    param('materialId').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('unit').optional().isIn(UNITS),
    body('qty').optional().isFloat({ min: 0.001 }).toFloat(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await materialService.updateMaterial({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      materialId: req.params.materialId,
      payload: req.body,
    });

    return sendSuccess(res, result);
  }),
);

router.delete(
  '/:materialId',
  requireRoles('pm', 'planning_eng'),
  [param('materialId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await materialService.deleteMaterial({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      materialId: req.params.materialId,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
