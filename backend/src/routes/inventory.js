const express = require("express");
const { body, param, query } = require("express-validator");
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
  assertKeyAllowsProject(req, result?.projectId ?? result?.order?.projectId ?? result?.invoice?.projectId ?? null);
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

const optionalProject = query("projectId").optional({ nullable: true }).isUUID();

// ─── item master ───────────────────────────────────────────────────────────

router.get(
  "/items",
  requirePermission("inventory", "read"),
  [
    optionalProject,
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("category").optional().isString().trim().isLength({ max: 80 }),
    query("status").optional().isIn(service.ITEM_STATUSES),
    query("lowStock").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.listItems({
        orgId: req.user.orgId,
        projectId: req.query.projectId ?? null,
        search: req.query.search ?? null,
        category: req.query.category ?? null,
        status: req.query.status ?? "active",
        lowStock: Boolean(req.query.lowStock),
      })
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
    sendSuccess(
      res,
      await service.findByCode({ orgId: req.user.orgId, code: req.params.code })
    )
  )
);

router.get(
  "/items/:itemId",
  requirePermission("inventory", "read"),
  [param("itemId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.getItem({ orgId: req.user.orgId, itemId: req.params.itemId })
    )
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
  body("preferredSupplierId").optional({ nullable: true }).isUUID(),
  body("projectId").optional({ nullable: true }).isUUID(),
  body("unitCost").optional().isFloat({ min: 0 }),
  body("reorderLevel").optional().isFloat({ min: 0 }),
  body("minStock").optional().isFloat({ min: 0 }),
  body("maxStock").optional({ nullable: true }).isFloat({ min: 0 }),
  body("leadTimeDays").optional().isInt({ min: 0 }),
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
      await service.createItem({ orgId: req.user.orgId, user: req.user, payload: req.body }),
      201
    )
  )
);

router.patch(
  "/items/:itemId",
  requirePermission("inventory", "update", { transition: "item.manage" }),
  [param("itemId").isUUID(), ...itemBody, validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.updateItem({
        orgId: req.user.orgId,
        user: req.user,
        itemId: req.params.itemId,
        payload: req.body,
      })
    )
  )
);

// ─── warehouses and locations ──────────────────────────────────────────────

router.get(
  "/warehouses",
  requirePermission("inventory", "read"),
  [optionalProject, validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.listWarehouses({
        orgId: req.user.orgId,
        projectId: req.query.projectId ?? null,
      })
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
    body("projectId").optional({ nullable: true }).isUUID(),
    body("managerId").optional({ nullable: true }).isUUID(),
    body("address").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.createWarehouse({ orgId: req.user.orgId, user: req.user, payload: req.body }),
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
    body("managerId").optional({ nullable: true }).isUUID(),
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
    body("parentId").optional({ nullable: true }).isUUID(),
    body("sortOrder").optional().isInt(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.createLocation({
        orgId: req.user.orgId,
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
  body("itemId").isUUID(),
  body("warehouseId").isUUID(),
  body("locationId").optional({ nullable: true }).isUUID(),
  body("quantity").isFloat(),
  body("batchNo").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("serialNo").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("reference").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
];

router.post(
  "/stock/receive",
  requirePermission("inventory", "create", { transition: "stock.receive" }),
  [
    ...movementBody,
    body("unitCost").optional({ nullable: true }).isFloat({ min: 0 }),
    body("damagedQty").optional({ nullable: true }).isFloat({ min: 0 }),
    body("poLineId").optional({ nullable: true }).isUUID(),
    body("receiptLineId").optional({ nullable: true }).isUUID(),
    body("expiryDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.receiveStock({ orgId: req.user.orgId, user: req.user, payload: req.body }),
      201
    )
  )
);

router.post(
  "/stock/issue",
  requirePermission("inventory", "submit", { transition: "stock.issue" }),
  [
    ...movementBody,
    body("projectId").optional({ nullable: true }).isUUID(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("costCodeId").optional({ nullable: true }).isUUID(),
    body("boqItemId").optional({ nullable: true }).isUUID(),
    body("locationRefId").optional({ nullable: true }).isUUID(),
    body("commitmentId").optional({ nullable: true }).isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopedCall(req, req.body.projectId, () => service.issueStock({ orgId: req.user.orgId, user: req.user, payload: req.body })),
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
    body("itemId").isUUID(),
    body("warehouseId").isUUID(),
    body("locationId").optional({ nullable: true }).isUUID(),
    body("quantity").isFloat().toFloat(),
    body("reference").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.adjustReservation({ orgId: req.user.orgId, user: req.user, payload: req.body })
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
      body("projectId").optional({ nullable: true }).isUUID(),
      body("activityId").optional({ nullable: true }).isUUID(),
      validate,
    ],
    asyncHandler(async (req, res) =>
      sendSuccess(
        res,
        await service.adjustStock({
          orgId: req.user.orgId,
          user: req.user,
          payload: req.body,
          type,
        }),
        201
      )
    )
  );
}

router.get(
  "/stock/transactions",
  requirePermission("inventory", "read"),
  [
    query("itemId").optional().isUUID(),
    query("warehouseId").optional().isUUID(),
    query("projectId").optional().isUUID(),
    query("activityId").optional().isUUID(),
    query("type").optional().isString().trim(),
    query("limit").optional().isInt({ min: 1, max: 500 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.listTransactions({
        orgId: req.user.orgId,
        itemId: req.query.itemId ?? null,
        warehouseId: req.query.warehouseId ?? null,
        projectId: req.query.projectId ?? null,
        activityId: req.query.activityId ?? null,
        type: req.query.type ?? null,
        limit: req.query.limit ?? 100,
      })
    )
  )
);

// ─── transfers ─────────────────────────────────────────────────────────────

router.get(
  "/transfers",
  requirePermission("inventory", "read"),
  [query("status").optional().isIn(service.TRANSFER_STATUSES), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.listTransfers({ orgId: req.user.orgId, status: req.query.status ?? null })
    )
  )
);

router.post(
  "/transfers",
  requirePermission("inventory", "create", { transition: "stock.transfer" }),
  [
    body("fromWarehouseId").isUUID(),
    body("toWarehouseId").isUUID(),
    body("lines").isArray({ min: 1 }),
    body("lines.*.itemId").isUUID(),
    body("lines.*.quantity").isFloat({ gt: 0 }),
    body("ref").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.createTransfer({ orgId: req.user.orgId, user: req.user, payload: req.body }),
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
    body("lines.*.id").optional().isUUID(),
    body("lines.*.receivedQty").optional().isFloat({ min: 0 }),
    body("lines.*.damagedQty").optional().isFloat({ min: 0 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.receiveTransfer({
        orgId: req.user.orgId,
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
  [optionalProject, query("scope").optional().isIn(goodsReceipt.ORDER_SCOPES), validate],
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
    body("orderId").isUUID(),
    body("warehouseId").isUUID(),
    body("receiptNumber").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body("deliveryNote").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body("lines").isArray({ min: 1 }),
    body("lines.*.poLineId").isUUID(),
    body("lines.*.acceptedQty").optional().isFloat({ min: 0 }),
    body("lines.*.rejectedQty").optional().isFloat({ min: 0 }),
    body("lines.*.unitCost").optional({ nullable: true }).isFloat({ min: 0 }),
    body("lines.*.locationId").optional({ nullable: true }).isUUID(),
    body("lines.*.inventoryItemId").optional({ nullable: true }).isUUID(),
    body("lines.*.batchNo").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("lines.*.serialNo").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("lines.*.expiryDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await scopedCall(req, req.body.projectId, () => goodsReceipt.receiveAgainstOrder({ orgId: req.user.orgId, user: req.user, payload: req.body })),
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
      await service.getSummary({
        orgId: req.user.orgId,
        projectId: req.query.projectId ?? null,
      })
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
      await analytics.getAnalytics({
        orgId: req.user.orgId,
        projectId: req.query.projectId ?? null,
      })
    )
  )
);

module.exports = router;
