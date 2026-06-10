const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
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
  requirePermission('procurement', 'read'),
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
  requirePermission('procurement', 'create', { transition: 'material.plan' }),
  [
    body('name').isString().trim().notEmpty(),
    body('code').optional({ nullable: true }).isString().trim(),
    body('spec').optional({ nullable: true }).isString().trim(),
    body('supplierId').optional({ nullable: true }).isUUID(),
    body('supplierName').optional({ nullable: true }).isString().trim(),
    body('supplierContact').optional({ nullable: true }).isString().trim(),
    body('procurementPackageId').optional({ nullable: true }).isUUID(),
    body('unit')
      .isIn(UNITS)
      .withMessage(`Unit must be one of: ${UNITS.join(', ')}`),
    body('qty')
      .isFloat({ min: 0.001 })
      .toFloat()
      .withMessage('Quantity must be positive'),
    body('plannedQty').optional().isFloat({ min: 0.001 }).toFloat(),
    body('requiredDate').optional({ nullable: true }).isISO8601().toDate(),
    body('requiredTiming')
      .optional()
      .isIn(['activity_start', 'activity_finish']),
    body('needOffsetDays').optional().isInt({ min: 0 }).toInt(),
    body('leadWeeks').optional().isInt({ min: 0 }).toInt(),
    body('bufferDays').optional().isInt({ min: 0 }).toInt(),
    body('orderByDate').optional({ nullable: true }).isISO8601().toDate(),
    body('notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await materialService.addMaterial({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      payload: req.body,
      actor: req.user,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:materialId',
  requirePermission('procurement', 'update', { transition: 'material.plan' }),
  [
    param('materialId').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('code').optional({ nullable: true }).isString().trim(),
    body('spec').optional({ nullable: true }).isString().trim(),
    body('supplierId').optional({ nullable: true }).isUUID(),
    body('supplierName').optional({ nullable: true }).isString().trim(),
    body('supplierContact').optional({ nullable: true }).isString().trim(),
    body('procurementPackageId').optional({ nullable: true }).isUUID(),
    body('unit').optional().isIn(UNITS),
    body('qty').optional().isFloat({ min: 0.001 }).toFloat(),
    body('plannedQty').optional().isFloat({ min: 0.001 }).toFloat(),
    body('requiredDate').optional({ nullable: true }).isISO8601().toDate(),
    body('requiredTiming')
      .optional()
      .isIn(['activity_start', 'activity_finish']),
    body('needOffsetDays').optional().isInt({ min: 0 }).toInt(),
    body('leadWeeks').optional().isInt({ min: 0 }).toInt(),
    body('bufferDays').optional().isInt({ min: 0 }).toInt(),
    body('orderByDate').optional({ nullable: true }).isISO8601().toDate(),
    body('status')
      .optional()
      .isIn(['planned', 'ordered', 'partial', 'received', 'issued', 'consumed', 'cancelled']),
    body('notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await materialService.updateMaterial({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      materialId: req.params.materialId,
      payload: req.body,
      actor: req.user,
    });

    return sendSuccess(res, result);
  }),
);

router.post(
  '/:materialId/usage',
  requirePermission('procurement', 'submit', { transition: 'material.use' }),
  [
    param('materialId').isUUID(),
    body('usedQty')
      .isFloat({ min: 0.001 })
      .toFloat()
      .withMessage('Used quantity must be positive'),
    body('wasteQty').optional().isFloat({ min: 0 }).toFloat(),
    body('usageDate').optional({ nullable: true }).isISO8601().toDate(),
    body('poLineId').optional({ nullable: true }).isUUID(),
    body('receiptLineId').optional({ nullable: true }).isUUID(),
    body('installedLocation').optional({ nullable: true }).isString().trim(),
    body('notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await materialService.recordMaterialUsage({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      materialId: req.params.materialId,
      payload: req.body,
      actor: req.user,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.delete(
  '/:materialId',
  requirePermission('procurement', 'delete'),
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
