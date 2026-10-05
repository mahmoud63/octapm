const express = require('express');
const { body, param } = require('express-validator');
const { scalarFigure, INT4_MAX } = require('../utils/figure-input');
const { QUANTITY_MAX } = require('../utils/stock-figures');
const { dateInput } = require('../utils/date-input');
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
    body('supplierId').optional({ nullable: true }).isString().isUUID(),
    body('supplierName').optional({ nullable: true }).isString().trim(),
    body('supplierContact').optional({ nullable: true }).isString().trim(),
    body('procurementPackageId').optional({ nullable: true }).isString().isUUID(),
    body('unit')
      .isIn(UNITS)
      .withMessage(`Unit must be one of: ${UNITS.join(', ')}`),
    body('qty')
      .custom(scalarFigure).bail().isFloat({ min: 0.001, max: QUANTITY_MAX })
      .toFloat()
      .withMessage('Quantity must be positive'),
    body('plannedQty').optional().custom(scalarFigure).bail().isFloat({ min: 0.001, max: QUANTITY_MAX }).toFloat(),
    body('requiredDate').optional({ nullable: true }).custom(dateInput).toDate(),
    body('requiredTiming')
      .optional()
      .isIn(['activity_start', 'activity_finish']),
    body('needOffsetDays').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('leadWeeks').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('bufferDays').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('orderByDate').optional({ nullable: true }).custom(dateInput).toDate(),
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
    body('supplierId').optional({ nullable: true }).isString().isUUID(),
    body('supplierName').optional({ nullable: true }).isString().trim(),
    body('supplierContact').optional({ nullable: true }).isString().trim(),
    body('procurementPackageId').optional({ nullable: true }).isString().isUUID(),
    body('unit').optional().isIn(UNITS),
    body('qty').optional().custom(scalarFigure).bail().isFloat({ min: 0.001, max: QUANTITY_MAX }).toFloat(),
    body('plannedQty').optional().custom(scalarFigure).bail().isFloat({ min: 0.001, max: QUANTITY_MAX }).toFloat(),
    body('requiredDate').optional({ nullable: true }).custom(dateInput).toDate(),
    body('requiredTiming')
      .optional()
      .isIn(['activity_start', 'activity_finish']),
    body('needOffsetDays').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('leadWeeks').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('bufferDays').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('orderByDate').optional({ nullable: true }).custom(dateInput).toDate(),
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
      .custom(scalarFigure).bail().isFloat({ min: 0.001, max: QUANTITY_MAX })
      .toFloat()
      .withMessage('Used quantity must be positive'),
    body('wasteQty').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('usageDate').optional({ nullable: true }).custom(dateInput).toDate(),
    body('poLineId').optional({ nullable: true }).isString().isUUID(),
    body('receiptLineId').optional({ nullable: true }).isString().isUUID(),
    body('dailyReportId').optional({ nullable: true }).isString().isUUID(),
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
