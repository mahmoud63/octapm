const express = require("express");
const { body, param, query } = require("express-validator");
const { scalarFigure, INT4_MAX, INT4_MIN } = require("../utils/figure-input");
const { dateInput } = require("../utils/date-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/inventory.service");
const goodsReceipt = require("../services/goods-receipt.service");
const analytics = require("../services/inventory-analytics.service");
const { HttpError } = require("../utils/http-error");

/**
 * An API key limited to some projects may not read or move another project's
 * records through the warehouse routes, which are not under a project router
 * (Phase 21D, CX21-416).
 */
const assertKeyAllowsProject = (req, projectId) => {
  const allowed = req.apiClient?.projectIds;
  if (allowed?.length && projectId && !allowed.includes(projectId)) {
    throw new HttpError(403, "FORBIDDEN_PROJECT", "This API key is not allowed on that project");
  }
};
const keyProjects = (req) => (req.apiClient?.projectIds?.length ? req.apiClient.projectIds : null);
const scopedCall = (req, projectId, run) => {
  assertKeyAllowsProject(req, projectId);
  return run();
};
const sendScoped = (req, res, result) => {
  assertKeyAllowsProject(req, result?.projectId ?? result?.item?.projectId ?? result?.order?.projectId ?? result?.invoice?.projectId ?? null);
  return sendSuccess(res, result);
};

/**
 * Inventory and warehouse (OCTA-INV-STOCK-050).
 *
 * Company-level, because a central store serves every project. Movements carry
 * the project they are for; the item master and the warehouses do not have to.
 */
const router = express.Router();
router.use(authenticate);

// An identifier is one string. express-validator's isUUID() checks an array
// element by element, so ["<id>"] passed — the organisation's own id as much
// as another company's or one that exists nowhere — and reached Prisma as a
// 500 (CERT-2 shapes). Every identifier field below is a string first; any
// other shape is a 400 VALIDATION_ERROR naming the field, whoever's id it wraps.
const idBody = (field) => body(field).isString().isUUID();
const optionalIdBody = (field) => body(field).optional({ nullable: true }).isString().isUUID();
const optionalIdQuery = (field) => query(field).optional({ nullable: true }).isString().isUUID();

const optionalProject = optionalIdQuery("projectId");

// A figure no larger than its column holds (CERT-2): a unit cost of 1e15
// failed at the write with a 500, a quantity of 1e15 was stored. The bounds
// and why they are what they are: utils/stock-figures.js.
const { QUANTITY_MAX, UNIT_COST_MAX } = require("../utils/stock-figures");
const quantityOf = (field) => body(field).custom(scalarFigure).bail().isFloat({ min: -QUANTITY_MAX, max: QUANTITY_MAX });
const unitCostOf = (field) => body(field).optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: UNIT_COST_MAX });
// A date is one string that is a date: "x", {"not":"x"} and [] reached the
// stock ledger and failed at the write with a 500 (CERT-2).
const optionalDateBody = (field) => body(field).optional({ nullable: true }).isString().custom(dateInput);

// ─── item master ───────────────────────────────────────────────────────────

router.get(
  "/items",
  requirePermission("inventory", "read"),
  [
    optionalProject,
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("category").optional().isString().trim().isLength({ max: 80 }),
    // One status: ?status=a&status=b is an array, which isIn() checks element by element (CERT-2 shapes).
    query("status").optional().isString().isIn(service.ITEM_STATUSES),
    query("lowStock").isString().optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopedCall(req, req.query.projectId ?? null, () => service.listItems({
        orgId: req.user.orgId,
        projectId: req.query.projectId ?? null,
        projectIds: keyProjects(req),
        search: req.query.search ?? null,
        category: req.query.category ?? null,
        status: req.query.status ?? "active",
        lowStock: Boolean(req.query.lowStock),
      }))
    )
  )
);

/**
 * What a scanner points at.
 *
 * Takes a barcode, a QR token or a printed SKU and answers with the item, what
 * is on hand, and where it is — so one scan is one round trip.
 */
router.get(
  "/items/scan/:code",
  requirePermission("inventory", "read"),
  [param("code").isString().trim().isLength({ min: 1, max: 120 }), validate],
  asyncHandler(async (req, res) =>
    sendScoped(req, res, await service.findByCode({ orgId: req.user.orgId, code: req.params.code, allowedProjectIds: keyProjects(req) }))
  )
);

router.get(
  "/items/:itemId",
  requirePermission("inventory", "read"),
  [param("itemId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    // A project item is that project's (Phase 21D, CX21-451).
    sendScoped(req, res, await service.getItem({ orgId: req.user.orgId, itemId: req.params.itemId, allowedProjectIds: keyProjects(req) }))
  )
);

const itemBody = [
  body("sku").optional().isString().trim().isLength({ min: 1, max: 60 }),
  body("name").optional().isString().trim().isLength({ min: 1, max: 200 }),
  body("unit").optional().isString().trim().isLength({ min: 1, max: 20 }),
  body("barcode").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("qrCode").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("category").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("manufacturer").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("model").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("specification").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  optionalIdBody("preferredSupplierId"),
  optionalIdBody("projectId"),
  body("unitCost").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: UNIT_COST_MAX }),
  body("reorderLevel").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
  body("minStock").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
  body("maxStock").optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
  body("leadTimeDays").optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }),
  body("isSerialised").optional().isBoolean(),
  body("isBatched").optional().isBoolean(),
  body("status").optional().isIn(service.ITEM_STATUSES),
];

router.post(
  "/items",
  requirePermission("inventory", "create", { transition: "item.manage" }),
  [
    body("sku").isString().trim().isLength({ min: 1, max: 60 }),
    body("name").isString().trim().isLength({ min: 1, max: 200 }),
    body("unit").isString().trim().isLength({ min: 1, max: 20 }),
    ...itemBody,
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopedCall(req, req.body.projectId ?? null, () => service.createItem({ orgId: req.user.orgId, user: req.user, payload: req.body })),
      201
    )
  )
);

router.patch(
  "/items/:itemId",
  requirePermission("inventory", "update", { transition: "item.manage" }),
  [param("itemId").isUUID(), ...itemBody, validate],
  asyncHandler(async (req, res) => {
    // A project item is that project's, and an item may not be moved onto a
    // project the key is not allowed on (Phase 21D, CX21-451).
    const current = await service.getItem({ orgId: req.user.orgId, itemId: req.params.itemId });
    assertKeyAllowsProject(req, current?.projectId ?? null);
    assertKeyAllowsProject(req, req.body.projectId ?? null);
    return sendSuccess(
      res,
      await service.updateItem({
        orgId: req.user.orgId,
        user: req.user,
        itemId: req.params.itemId,
        payload: req.body,
      })
    );
  })
);

// ─── warehouses and locations ──────────────────────────────────────────────

router.get(
  "/warehouses",
  requirePermission("inventory", "read"),
  [optionalProject, validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopedCall(req, req.query.projectId ?? null, () => service.listWarehouses({
        orgId: req.user.orgId,
        projectId: req.query.projectId ?? null,
        projectIds: keyProjects(req),
      }))
    )
  )
);

router.post(
  "/warehouses",
  requirePermission("inventory", "create", { transition: "warehouse.manage" }),
  [
    body("code").isString().trim().isLength({ min: 1, max: 30 }),
    body("name").isString().trim().isLength({ min: 1, max: 200 }),
    body("kind").optional().isIn(service.WAREHOUSE_KINDS),
    optionalIdBody("projectId"),
    optionalIdBody("managerId"),
    body("address").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopedCall(req, req.body.projectId ?? null, () => service.createWarehouse({ orgId: req.user.orgId, user: req.user, payload: req.body })),
      201
    )
  )
);

router.patch(
  "/warehouses/:warehouseId",
  requirePermission("inventory", "update", { transition: "warehouse.manage" }),
  [
    param("warehouseId").isUUID(),
    body("name").optional().isString().trim().isLength({ min: 1, max: 200 }),
    body("kind").optional().isIn(service.WAREHOUSE_KINDS),
    optionalIdBody("managerId"),
    body("address").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body("status").optional().isIn(["active", "archived"]),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.updateWarehouse({
        orgId: req.user.orgId,
        user: req.user,
        warehouseId: req.params.warehouseId,
        payload: req.body,
        allowedProjectIds: keyProjects(req),
      })
    )
  )
);

router.get(
  "/warehouses/:warehouseId/locations",
  requirePermission("inventory", "read"),
  [param("warehouseId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.listLocations({
        orgId: req.user.orgId,
        warehouseId: req.params.warehouseId,
        allowedProjectIds: keyProjects(req),
      })
    )
  )
);

router.post(
  "/warehouses/:warehouseId/locations",
  requirePermission("inventory", "create", { transition: "warehouse.manage" }),
  [
    param("warehouseId").isUUID(),
    body("code").isString().trim().isLength({ min: 1, max: 40 }),
    body("name").isString().trim().isLength({ min: 1, max: 200 }),
    body("kind").optional().isIn(service.LOCATION_KINDS),
    optionalIdBody("parentId"),
    body("sortOrder").optional().custom(scalarFigure).bail().isInt({ min: INT4_MIN, max: INT4_MAX }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.createLocation({
        orgId: req.user.orgId,
        allowedProjectIds: keyProjects(req),
        user: req.user,
        warehouseId: req.params.warehouseId,
        payload: req.body,
      }),
      201
    )
  )
);

// ─── movements ─────────────────────────────────────────────────────────────

const movementBody = [
  idBody("itemId"),
  idBody("warehouseId"),
  optionalIdBody("locationId"),
  quantityOf("quantity"),
  body("batchNo").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("serialNo").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("reference").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  // When the stock moved (a device syncing later sends it; defaults to now)
  // and when a batch expires. Read by every movement; only the issue checked
  // them, and then not as one string.
  optionalDateBody("occurredAt"),
  optionalDateBody("expiryDate"),
];

router.post(
  "/stock/receive",
  requirePermission("inventory", "create", { transition: "stock.receive" }),
  [
    ...movementBody,
    unitCostOf("unitCost"),
    body("damagedQty").optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
    optionalIdBody("poLineId"),
    optionalIdBody("receiptLineId"),
    // What a direct receipt may carry for the movement it posts: each one
    // string, checked as this organisation's by the service (CERT-2). The
    // projectId used to have no check here at all, so every shape of it —
    // {"id":…}, 12345, true, {"not":"x"} — reached Prisma as a 500.
    optionalIdBody("projectId"),
    optionalIdBody("activityId"),
    optionalIdBody("costCodeId"),
    optionalIdBody("boqItemId"),
    optionalIdBody("commitmentId"),
    optionalIdBody("locationRefId"),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      // A direct receipt names its project (or none); the key's list travels
      // with it as it does for an issue (Phase 21D, CX21-441).
      await scopedCall(req, req.body.projectId, () => service.receiveStock({ orgId: req.user.orgId, user: req.user, payload: { ...req.body, allowedProjectIds: keyProjects(req) } })),
      201
    )
  )
);

router.post(
  "/stock/issue",
  requirePermission("inventory", "submit", { transition: "stock.issue" }),
  [
    ...movementBody,
    optionalIdBody("projectId"),
    optionalIdBody("activityId"),
    optionalIdBody("costCodeId"),
    optionalIdBody("boqItemId"),
    optionalIdBody("locationRefId"),
    optionalIdBody("commitmentId"),
    // When the stock left (occurredAt, in movementBody); defaults to now.
    // The cost is dated on the project's reporting day of this instant.
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopedCall(req, req.body.projectId, () => service.issueStock({ orgId: req.user.orgId, user: req.user, payload: { ...req.body, allowedProjectIds: keyProjects(req) } })),
      201
    )
  )
);

/**
 * Reserve stock, or give it back. A positive quantity reserves, a negative one
 * releases. Reserved stock stays on hand but stops being available, and an
 * issue may only draw on what is available.
 */
router.post(
  "/stock/reserve",
  requirePermission("inventory", "submit", { transition: "stock.issue" }),
  [
    idBody("itemId"),
    idBody("warehouseId"),
    optionalIdBody("locationId"),
    quantityOf("quantity").toFloat(),
    body("reference").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      // A reservation is a claim on a project's stock as much as an issue is (CX21-451).
      await service.adjustReservation({ orgId: req.user.orgId, user: req.user, payload: { ...req.body, allowedProjectIds: keyProjects(req) } })
    )
  )
);

for (const [path, type, transition] of [
  ["return", "return", "stock.return"],
  ["adjust", "adjust", "stock.adjust"],
  ["damage", "damage", "stock.adjust"],
  ["quarantine", "quarantine", "stock.adjust"],
  ["release", "release", "stock.adjust"],
]) {
  router.post(
    `/stock/${path}`,
    requirePermission("inventory", "update", { transition }),
    [
      ...movementBody,
      optionalIdBody("projectId"),
      optionalIdBody("activityId"),
      optionalIdBody("costCodeId"),
      // Read by the movement as an issue reads them (CERT-2).
      optionalIdBody("boqItemId"),
      optionalIdBody("commitmentId"),
      optionalIdBody("locationRefId"),
      validate,
    ],
    asyncHandler(async (req, res) =>
      sendSuccess(
        res,
        // The key's project list travels with the movement, as it does for an
        // issue: a return or adjustment named for another project's activity
        // used to add stock and post cost there (Phase 21D, CX21-430).
        await scopedCall(req, req.body.projectId, () =>
          service.adjustStock({
            orgId: req.user.orgId,
            user: req.user,
            payload: { ...req.body, allowedProjectIds: keyProjects(req) },
            type,
          })
        ),
        201
      )
    )
  );
}

router.get(
  "/stock/transactions",
  requirePermission("inventory", "read"),
  [
    // ?itemId=a&itemId=b is an array: one string each, or a 400 (CERT-2 shapes).
    optionalIdQuery("itemId"),
    optionalIdQuery("warehouseId"),
    optionalIdQuery("projectId"),
    optionalIdQuery("activityId"),
    query("type").optional().isString().trim(),
    query("limit").isString().optional().isInt({ min: 1, max: 500 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await scopedCall(req, req.query.projectId, () => service.listTransactions({ projectIds: keyProjects(req), orgId: req.user.orgId,
        itemId: req.query.itemId ?? null,
        warehouseId: req.query.warehouseId ?? null,
        projectId: req.query.projectId ?? null,
        activityId: req.query.activityId ?? null,
        type: req.query.type ?? null,
        limit: req.query.limit ?? 100,
      }))
    )
  )
);

// ─── transfers ─────────────────────────────────────────────────────────────

router.get(
  "/transfers",
  requirePermission("inventory", "read"),
  // One status: ?status=draft&status=received reached Prisma as a 500 (CERT-2 shapes).
  [query("status").optional().isString().isIn(service.TRANSFER_STATUSES), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.listTransfers({ orgId: req.user.orgId, status: req.query.status ?? null, projectIds: keyProjects(req) })
    )
  )
);

router.post(
  "/transfers",
  requirePermission("inventory", "create", { transition: "stock.transfer" }),
  [
    idBody("fromWarehouseId"),
    idBody("toWarehouseId"),
    body("lines").isArray({ min: 1 }),
    idBody("lines.*.itemId"),
    body("lines.*.quantity").custom(scalarFigure).bail().isFloat({ gt: 0, max: QUANTITY_MAX }),
    body("ref").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.createTransfer({ orgId: req.user.orgId, user: req.user, payload: { ...req.body, allowedProjectIds: keyProjects(req) } }),
      201
    )
  )
);

router.post(
  "/transfers/:transferId/dispatch",
  requirePermission("inventory", "update", { transition: "stock.transfer" }),
  [param("transferId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.dispatchTransfer({
        orgId: req.user.orgId,
        allowedProjectIds: keyProjects(req),
        user: req.user,
        transferId: req.params.transferId,
      })
    )
  )
);

router.post(
  "/transfers/:transferId/receive",
  requirePermission("inventory", "update", { transition: "stock.transfer" }),
  [
    param("transferId").isUUID(),
    body("lines").optional().isArray(),
    // Each reported line is an object: [null] failed in the service with a 500,
    // and ["x"] was ignored, so the whole transfer was booked in as sent (CERT-2).
    body("lines.*").isObject(),
    // Each reported line names one of the transfer's lines, as one string:
    // ["<id>"] passed isUUID() element by element and was then matched to
    // nothing, so the line was booked in full and the reported quantities
    // dropped (CERT-2). A line that names no line reports nothing it can be
    // booked against; the service refuses a line that is not the transfer's.
    idBody("lines.*.id"),
    body("lines.*.receivedQty").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
    body("lines.*.damagedQty").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.receiveTransfer({
        orgId: req.user.orgId,
        allowedProjectIds: keyProjects(req),
        user: req.user,
        transferId: req.params.transferId,
        payload: req.body,
      })
    )
  )
);

// ─── goods receipt against a purchase order ────────────────────────────────

router.get(
  "/purchase-orders",
  requirePermission("inventory", "read"),
  [optionalProject, query("scope").isString().optional().isIn(goodsReceipt.ORDER_SCOPES), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await scopedCall(req, req.query.projectId, () => goodsReceipt.listOrders({ projectIds: keyProjects(req),
        orgId: req.user.orgId,
        projectId: req.query.projectId ?? null,
        scope: req.query.scope ?? "all",
      }))
    )
  )
);

/** What a storeman scans off the delivery note. */
router.get(
  "/purchase-orders/:ref",
  requirePermission("inventory", "read"),
  [param("ref").isString().trim().isLength({ min: 1, max: 120 }), validate],
  asyncHandler(async (req, res) =>
    sendScoped(req, res, await goodsReceipt.findPurchaseOrder({
        orgId: req.user.orgId,
        ref: req.params.ref,
      })
    )
  )
);

router.post(
  "/goods-receipt",
  requirePermission("inventory", "create", { transition: "stock.receive" }),
  [
    idBody("orderId"),
    idBody("warehouseId"),
    // The project, who received it and when had no check here (CERT-2). The
    // daily report is left to the service on purpose: any value that is not
    // one string is answered there exactly as a report that exists nowhere
    // (404 DAILY_REPORT_NOT_FOUND), the answer a string id of another
    // company's report gets. receivedAt likewise: the service refuses any
    // value that is not a date (400 RECEIPT_DATE_INVALID).
    optionalIdBody("projectId"),
    body("receivedBy").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("receiptNumber").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body("deliveryNote").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body("lines").isArray({ min: 1 }),
    idBody("lines.*.poLineId"),
    body("lines.*.acceptedQty").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
    body("lines.*.rejectedQty").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
    unitCostOf("lines.*.unitCost"),
    optionalIdBody("lines.*.locationId"),
    optionalIdBody("lines.*.inventoryItemId"),
    body("lines.*.batchNo").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("lines.*.serialNo").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    optionalDateBody("lines.*.expiryDate"),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await scopedCall(req, req.body.projectId, () => goodsReceipt.receiveAgainstOrder({ orgId: req.user.orgId, user: req.user, payload: req.body, allowedProjectIds: keyProjects(req) })),
      201
    )
  )
);

// ─── three-way match ───────────────────────────────────────────────────────

router.get(
  "/match/order/:orderId",
  requirePermission("inventory", "read"),
  [param("orderId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendScoped(req, res, await goodsReceipt.matchOrder({
        orgId: req.user.orgId,
        orderId: req.params.orderId,
      })
    )
  )
);

router.get(
  "/match/invoice/:directCostId",
  requirePermission("inventory", "read"),
  [param("directCostId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendScoped(req, res, await goodsReceipt.matchInvoice({
        orgId: req.user.orgId,
        directCostId: req.params.directCostId,
      })
    )
  )
);

// ─── analytics ─────────────────────────────────────────────────────────────

router.get(
  "/summary",
  requirePermission("inventory", "read"),
  [optionalProject, validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopedCall(req, req.query.projectId ?? null, () => service.getSummary({
        orgId: req.user.orgId,
        projectId: req.query.projectId ?? null,
        projectIds: keyProjects(req),
      }))
    )
  )
);

/**
 * The full picture, with the rows behind every number.
 *
 * Separate from /summary because it is a much heavier read: /summary is the
 * strip of tiles at the top of every inventory screen, this is the dashboard.
 */
router.get(
  "/analytics",
  requirePermission("inventory", "read"),
  [optionalProject, validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      // Analytics are project figures too (usage and cost by activity):
      // a key limited to some projects sees those projects' (CX21-430).
      await scopedCall(req, req.query.projectId ?? null, () =>
        analytics.getAnalytics({
          orgId: req.user.orgId,
          projectId: req.query.projectId ?? null,
          projectIds: keyProjects(req),
        })
      )
    )
  )
);

module.exports = router;
