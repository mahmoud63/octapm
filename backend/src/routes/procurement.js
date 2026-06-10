const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const procurementService = require('../services/procurement.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const optionalDate = (field) =>
  body(field).optional({ nullable: true }).isISO8601().toDate();

const optionalUuid = (field) =>
  body(field).optional({ nullable: true }).isUUID();

router.get(
  '/',
  requirePermission('procurement', 'read'),
  asyncHandler(async (req, res) => {
    const result = await procurementService.getProcurementOverview({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/suppliers',
  requirePermission('procurement', 'read'),
  asyncHandler(async (req, res) => {
    const result = await procurementService.listSuppliers({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/suppliers',
  requirePermission('procurement', 'create', {
    transition: 'supplier.manage',
  }),
  [
    body('name').isString().trim().notEmpty(),
    body('code').optional({ nullable: true }).isString().trim(),
    body('contactName').optional({ nullable: true }).isString().trim(),
    body('email').optional({ nullable: true }).isEmail().normalizeEmail(),
    body('phone').optional({ nullable: true }).isString().trim(),
    body('address').optional({ nullable: true }).isString().trim(),
    body('tradeCategories').optional().isArray(),
    body('status')
      .optional()
      .isIn(['approved', 'pending', 'on_hold', 'blocked']),
    body('leadTimeReliability').optional().isFloat({ min: 0, max: 100 }).toFloat(),
    body('notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.createSupplier({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      actor: req.user,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  '/packages',
  requirePermission('procurement', 'read'),
  asyncHandler(async (req, res) => {
    const result = await procurementService.listPackages({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/packages',
  requirePermission('procurement', 'create', {
    transition: 'package.manage',
  }),
  [
    body('packageNumber').isString().trim().notEmpty(),
    body('title').isString().trim().notEmpty(),
    body('description').optional({ nullable: true }).isString().trim(),
    optionalUuid('supplierId'),
    optionalUuid('activityId'),
    body('status')
      .optional()
      .isIn(['planning', 'tendering', 'awarded', 'in_delivery', 'closed', 'cancelled']),
    body('buyer').optional({ nullable: true }).isString().trim(),
    optionalDate('plannedAwardDate'),
    optionalDate('requiredOnSiteDate'),
    body('leadWeeks').optional().isInt({ min: 0 }).toInt(),
    body('bufferDays').optional().isInt({ min: 0 }).toInt(),
    body('notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.createPackage({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      actor: req.user,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  '/purchase-orders',
  requirePermission('procurement', 'read'),
  asyncHandler(async (req, res) => {
    const result = await procurementService.listPurchaseOrders({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/purchase-orders',
  requirePermission('procurement', 'create', { transition: 'po.issue' }),
  [
    body('ref').isString().trim().notEmpty(),
    body('item').optional({ nullable: true }).isString().trim(),
    optionalUuid('activityId'),
    optionalUuid('packageId'),
    optionalUuid('supplierId'),
    body('supplier').optional({ nullable: true }).isString().trim(),
    body('status')
      .optional()
      .isIn(['planned', 'draft', 'issued', 'partial', 'received', 'closed', 'cancelled']),
    body('leadWeeks').optional().isInt({ min: 0 }).toInt(),
    body('requiredTiming')
      .optional()
      .isIn(['activity_start', 'activity_finish']),
    body('needOffsetDays').optional().isInt({ min: 0 }).toInt(),
    body('bufferDays').optional().isInt({ min: 0 }).toInt(),
    body('currency').optional().isString().trim().isLength({ min: 3, max: 3 }),
    optionalDate('orderDate'),
    optionalDate('requiredBy'),
    optionalDate('promisedDate'),
    optionalDate('deliveryDate'),
    body('buyer').optional({ nullable: true }).isString().trim(),
    body('notes').optional({ nullable: true }).isString().trim(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.lineNumber').optional().isInt({ min: 1 }).toInt(),
    body('lines.*.activityId').isUUID(),
    optionalUuid('lines.*.activityMaterialId'),
    optionalUuid('lines.*.materialMasterId'),
    optionalUuid('lines.*.packageId'),
    optionalUuid('lines.*.supplierId'),
    body('lines.*.itemCode').optional({ nullable: true }).isString().trim(),
    body('lines.*.description').isString().trim().notEmpty(),
    body('lines.*.spec').optional({ nullable: true }).isString().trim(),
    body('lines.*.unit').isString().trim().notEmpty(),
    body('lines.*.orderedQty').isFloat({ min: 0.001 }).toFloat(),
    moneyBody('lines.*.unitCost'),
    body('lines.*.leadWeeks').optional().isInt({ min: 0 }).toInt(),
    body('lines.*.requiredTiming')
      .optional()
      .isIn(['activity_start', 'activity_finish']),
    body('lines.*.needOffsetDays').optional().isInt({ min: 0 }).toInt(),
    body('lines.*.bufferDays').optional().isInt({ min: 0 }).toInt(),
    optionalDate('lines.*.requiredDate'),
    optionalDate('lines.*.promisedDate'),
    body('lines.*.notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.createPurchaseOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      actor: req.user,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/purchase-orders/:orderId/receipts',
  requirePermission('procurement', 'submit', { transition: 'receipt.post' }),
  [
    param('orderId').isUUID(),
    body('receiptNumber').isString().trim().notEmpty(),
    optionalDate('receivedAt'),
    body('receivedBy').optional({ nullable: true }).isString().trim(),
    body('warehouseLocation').optional({ nullable: true }).isString().trim(),
    body('deliveryNote').optional({ nullable: true }).isString().trim(),
    body('issueToActivity').optional().isBoolean().toBoolean(),
    body('notes').optional({ nullable: true }).isString().trim(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.poLineId').isUUID(),
    body('lines.*.acceptedQty').isFloat({ min: 0.001 }).toFloat(),
    body('lines.*.rejectedQty').optional().isFloat({ min: 0 }).toFloat(),
    body('lines.*.issuedQty').optional().isFloat({ min: 0 }).toFloat(),
    body('lines.*.notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.recordDeliveryReceipt({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      orderId: req.params.orderId,
      actor: req.user,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  '/lead-time-alerts',
  requirePermission('procurement', 'read'),
  [
    query('status')
      .optional()
      .isIn(['open', 'acknowledged', 'resolved']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.listLeadTimeAlerts({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status || null,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/lead-time-alerts/:alertId',
  requirePermission('procurement', 'update', {
    transition: 'alert.acknowledge',
  }),
  [
    param('alertId').isUUID(),
    body('status').isIn(['open', 'acknowledged', 'resolved']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.updateLeadTimeAlert({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      alertId: req.params.alertId,
      actor: req.user,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
