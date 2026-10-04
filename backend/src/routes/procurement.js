const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const procurementService = require('../services/procurement.service');
const goodsReceiptService = require('../services/goods-receipt.service');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { QUANTITY_MAX, UNIT_COST_MAX } = require('../utils/stock-figures');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

// A date is one string: isISO8601() alone checks an array element by
// element, so [] and ["2026-10-01"] passed (CERT-2 shapes).
const optionalDate = (field) =>
  body(field).optional({ nullable: true }).isString().isISO8601().toDate();

// An identifier that must be one string: isUUID() alone checks an array
// element by element, so ["<id>"] passed and reached Prisma as a 500
// (CERT-2 shapes).
const optionalId = (field) =>
  body(field).optional({ nullable: true }).isString().isUUID();

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
    body('companyId').optional({ nullable: true }).isString().isUUID(),
    body('name')
      .if(body('companyId').not().exists({ checkFalsy: true }))
      .isString()
      .trim()
      .notEmpty(),
    body('name').optional({ nullable: true }).isString().trim(),
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
    optionalId('supplierId'),
    optionalId('activityId'),
    body('status')
      .optional()
      .isIn(['planning', 'tendering', 'awarded', 'in_delivery', 'closed', 'cancelled']),
    body('buyer').optional({ nullable: true }).isString().trim(),
    optionalDate('plannedAwardDate'),
    optionalDate('requiredOnSiteDate'),
    body('requiredTiming')
      .optional()
      .isIn(['activity_start', 'activity_finish']),
    body('needOffsetDays').optional().isInt({ min: 0 }).toInt(),
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

/**
 * Raise the order for an awarded package. Everything on it is already known,
 * so nothing is asked for that the system can read (OCTA-UX-PODUP-102). The
 * three overridable fields are accepted here and are the only ones a buyer
 * would sensibly change at this point.
 */
router.post(
  '/packages/:packageId/order',
  requirePermission('procurement', 'create', { transition: 'po.issue' }),
  [
    param('packageId').isUUID(),
    body('ref').optional({ values: 'falsy' }).isString().trim(),
    body('leadWeeks').optional().isInt({ min: 0 }).toInt(),
    optionalDate('requiredBy'),
    body('notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.raiseOrderFromAward({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      packageId: req.params.packageId,
      actor: req.user,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/purchase-orders',
  requirePermission('procurement', 'create', { transition: 'po.issue' }),
  [
    // Optional: the project numbers its own orders unless the buyer has a
    // reference of their own to use (OCTA-UX-PODUP-102).
    body('ref').optional({ values: 'falsy' }).isString().trim(),
    body('item').optional({ nullable: true }).isString().trim(),
    optionalId('activityId'),
    optionalId('packageId'),
    optionalId('supplierId'),
    optionalId('commitmentId'),
    body('supplier').optional({ nullable: true }).isString().trim(),
    // A new order may only be planned or drafted here. Approved, issued and
    // acknowledged are decisions made on the register, which records who made
    // them (OCTA-PROC-APPROVAL-067).
    body('status').optional().isIn(['planned', 'draft']),
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
    body('lines.*.activityId').isString().isUUID(),
    // Cost coding at the moment the order is raised (OCTA-FIN-POLINE-060).
    // Each one string (CERT-2 shapes): isUUID() alone took ["<id>"] element by
    // element; a package or a supplier sent so reached Prisma as a 500, the
    // coding was refused only later, by the service.
    optionalId('lines.*.costCodeId'),
    optionalId('lines.*.budgetLineId'),
    optionalId('lines.*.boqItemId'),
    optionalId('lines.*.activityMaterialId'),
    optionalId('lines.*.materialMasterId'),
    optionalId('lines.*.packageId'),
    optionalId('lines.*.supplierId'),
    body('lines.*.itemCode').optional({ nullable: true }).isString().trim(),
    body('lines.*.description').isString().trim().notEmpty(),
    body('lines.*.spec').optional({ nullable: true }).isString().trim(),
    body('lines.*.unit').isString().trim().notEmpty(),
    // A quantity the stock ledger can hold to four decimal places (CERT-2:
    // 1e15 at 100.00 overflowed the order's value with a 500).
    body('lines.*.orderedQty').isFloat({ min: 0.001, max: QUANTITY_MAX }).toFloat(),
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


/**
 * Where the goods went.
 *
 * Receiving stock needs a real warehouse, not a line of free text — free text
 * is why deliveries booked here used to create nothing. Take the one the caller
 * named; failing that, the project's own warehouse when it has exactly one;
 * failing that, the central warehouse when there is exactly one. Never choose
 * between several, and never fall through silently: a delivery that cannot say
 * where it went is refused, because the alternative is a receipt that looks
 * posted and leaves the shelf empty.
 */
const resolveReceiptWarehouse = async ({ orgId, projectId, requested }) => {
  if (requested) return requested;

  const candidates = await prisma.warehouse.findMany({
    where: { orgId, status: 'active', OR: [{ projectId }, { projectId: null }] },
    select: { id: true, name: true, code: true, projectId: true },
    orderBy: { name: 'asc' },
  });
  const ownedByProject = candidates.filter((row) => row.projectId === projectId);
  const central = candidates.filter((row) => row.projectId === null);
  const chosen =
    ownedByProject.length === 1
      ? ownedByProject[0]
      : central.length === 1
        ? central[0]
        : null;
  if (chosen) return chosen.id;

  const error = new HttpError(
    400,
    'WAREHOUSE_REQUIRED_FOR_RECEIPT',
    candidates.length
      ? 'Say which warehouse the delivery went to — this project has more than one to choose from.'
      : 'This delivery has nowhere to go: the project has no active warehouse. Create one, then receive against it.',
  );
  error.details = {
    warehouses: candidates.map(({ id, name, code }) => ({ id, name, code })),
  };
  throw error;
};

router.post(
  '/purchase-orders/:orderId/receipts',
  requirePermission('procurement', 'submit', { transition: 'receipt.post' }),
  [
    param('orderId').isUUID(),
    body('receiptNumber').isString().trim().notEmpty(),
    optionalDate('receivedAt'),
    body('receivedBy').optional({ nullable: true }).isString().trim(),
    // Every identifier one string (CERT-2 shapes): isUUID() alone let
    // ["<id>"] through, element by element.
    optionalId('warehouseId'),
    body('deliveryNote').optional({ nullable: true }).isString().trim(),
    optionalId('dailyReportId'),
    body('issueToActivity').optional().isBoolean().toBoolean(),
    body('notes').optional({ nullable: true }).isString().trim(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.poLineId').isString().isUUID(),
    optionalId('lines.*.dailyReportId'),
    // The bin and the stocked item a line is put away as had no check here.
    optionalId('lines.*.locationId'),
    optionalId('lines.*.inventoryItemId'),
    // The price a line was delivered at: "abc" had no check here, became NaN
    // on the stock ledger and reset the item's average, last price and unit
    // cost to 0 (CERT-2). And no more than the item's price columns hold
    // (Decimal(18,4)): 1e15 failed at the write with a 500.
    body('lines.*.unitCost').optional({ nullable: true }).isFloat({ min: 0, max: UNIT_COST_MAX }),
    body('lines.*.acceptedQty').isFloat({ min: 0.001, max: QUANTITY_MAX }).toFloat(),
    body('lines.*.rejectedQty').optional().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('lines.*.issuedQty').optional().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    // A date the stock ledger can store: "x" had no check here and failed at
    // the write with a 500 (CERT-2).
    body('lines.*.expiryDate').optional({ nullable: true }).isString().isISO8601(),
    body('lines.*.notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    // One receipt, two doors. Procurement and the warehouse may both start the
    // job, but a delivery is a single economic event and there is one writer
    // for it — the goods-receipt service, which puts the stock away, values it,
    // carries the buyer's coding onto the stock ledger and refuses a delivery
    // against an order nobody ever sent. While this route had a writer of its
    // own it had none of that: it recorded deliveries that created no stock at
    // all, and accepted them against orders still sitting in "planned"
    // (OCTA-PROC-RECEIPT-081).
    const warehouseId = await resolveReceiptWarehouse({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      requested: req.body.warehouseId,
    });
    const result = await goodsReceiptService.receiveAgainstOrder({
      orgId: req.user.orgId,
      user: req.user,
      payload: {
        ...req.body,
        orderId: req.params.orderId,
        // This route is scoped to a project; the order has to be on it.
        projectId: req.params.projectId,
        warehouseId,
      },
    });
    return sendSuccess(res, result, 201);
  }),
);

// Quotes for a procurement package. In Procurement's own words: ask suppliers
// to price this. Underneath it is the bid engine, which already levels and
// awards — the buyer does not need to know that.
router.post(
  '/packages/:packageId/quotes',
  requirePermission('bid', 'create'),
  [
    param('packageId').isUUID(),
    body('title').optional().isString().trim().isLength({ max: 200 }),
    body('description').optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    body('instructions').optional({ nullable: true }).isString().trim().isLength({ max: 8000 }),
    body('dueAt').optional({ nullable: true }).isString().isISO8601(),
    body('currency').optional().isString().trim().isLength({ min: 3, max: 3 }),
    body('boqSections').optional().isArray({ max: 100 }),
    // Each a section name, as the bid package takes them (CERT-2 shapes).
    body('boqSections.*').isString(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await procurementService.requestQuotes({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        packageId: req.params.packageId,
        actor: req.user,
        payload: req.body,
      }),
      201,
    ),
  ),
);

router.get(
  '/packages/:packageId/quotes',
  requirePermission('bid', 'read'),
  [param('packageId').isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await procurementService.listQuotes({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        packageId: req.params.packageId,
      }),
    ),
  ),
);

router.get(
  '/lead-time-alerts',
  requirePermission('procurement', 'read'),
  [
    query('status').isString()
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

router.patch(
  '/lead-time-alerts/:alertId/acknowledge',
  requirePermission('procurement', 'update', {
    transition: 'alert.acknowledge',
  }),
  [
    param('alertId').isUUID(),
    body('note').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.acknowledgeLeadTimeAlert({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      alertId: req.params.alertId,
      actor: req.user,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/lead-time-alerts/:alertId/resolve',
  requirePermission('procurement', 'update', {
    transition: 'alert.resolve',
  }),
  [
    param('alertId').isUUID(),
    body('note').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await procurementService.resolveLeadTimeAlert({
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
