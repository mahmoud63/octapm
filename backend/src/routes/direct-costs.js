const express = require("express");
const { body, param, query } = require("express-validator");
const { scalarFigure, MONEY_FIGURE_MAX } = require("../utils/figure-input");
const { QUANTITY_MAX } = require("../utils/stock-figures");
const { dateInput } = require("../utils/date-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/direct-cost.service");

/** Direct costs (OCTA-FIN-DIRECT-039): `/projects/:projectId/direct-costs`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actorFor = (req) => ({ id: req.user.id, name: req.user.name || null, role: getEffectiveRole(req) });
const date = (field) => body(field).optional({ nullable: true }).custom(dateInput);

const validators = (partial = false) => [
  partial ? body("description").optional().isString().trim().isLength({ min: 1, max: 2000 }) : body("description").isString().trim().isLength({ min: 1, max: 2000 }),
  partial ? body("costDate").optional().custom(dateInput) : body("costDate").custom(dateInput),
  body("type").optional().isIn(service.TYPES),
  body("vendorCompanyId").optional({ nullable: true }).isString(),
  body("vendorName").optional({ nullable: true }).isString().isLength({ max: 200 }),
  body("invoiceNumber").optional({ nullable: true }).isString().isLength({ max: 80 }),
  // The purchase order this invoice is against, so the order can say how much
  // of it has been billed and the three-way match has something to compare.
  body("purchaseOrderId").optional({ nullable: true }).isString().isUUID(),
  date("dueDate"),
  date("receivedDate"),
  body("tax").optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: MONEY_FIGURE_MAX }),
  body("paymentTerms").optional({ nullable: true }).isString().isLength({ max: 120 }),
  body("notes").optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body("lines").optional().isArray({ max: 500 }),
  body("lines.*.description").isString().trim().isLength({ min: 1, max: 500 }),
  body("lines.*.costCodeId").optional({ nullable: true }).isString(),
  body("lines.*.budgetLineId").optional({ nullable: true }).isString(),
  body("lines.*.activityId").optional({ nullable: true }).isString(),
  // A purchase-order line is named by one string; any other shape reached
  // Prisma as a 500 (CERT-2 shapes).
  body("lines.*.poLineId").optional({ nullable: true }).isString(),
  body("lines.*.costType").optional({ nullable: true }).isIn(service.COST_TYPES),
  body("lines.*.quantity").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }),
  body("lines.*.unit").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("lines.*.unitCost").optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: MONEY_FIGURE_MAX }),
  body("lines.*.amount").optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: MONEY_FIGURE_MAX }),
  body("lines.*.notes").optional({ nullable: true }).isString().isLength({ max: 1000 }),
];

router.get("/", requirePermission("cost", "read"), [query("status").isString().optional().isIn(Object.values(service.STATUS)), query("type").isString().optional().isIn(service.TYPES), query("vendorCompanyId").optional().isString(), query("from").isString().optional().custom(dateInput), query("to").isString().optional().custom(dateInput), query("q").optional().isString().isLength({ max: 200 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listDirectCosts({ ...scope(req), query: req.query }))));
router.post("/", requirePermission("cost", "create"), [...validators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.createDirectCost({ ...scope(req), payload: req.body, actor: actorFor(req) }), 201)));
router.get("/:directCostId", requirePermission("cost", "read"), [param("directCostId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getDirectCost({ ...scope(req), directCostId: req.params.directCostId }))));
router.patch("/:directCostId", requirePermission("cost", "update"), [param("directCostId").isUUID(), ...validators(true), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateDirectCost({ ...scope(req), directCostId: req.params.directCostId, payload: req.body, actor: actorFor(req) }))));
router.delete("/:directCostId", requirePermission("cost", "delete"), [param("directCostId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteDirectCost({ ...scope(req), directCostId: req.params.directCostId, actor: actorFor(req) }))));
router.post("/:directCostId/submit", requirePermission("cost", "submit", { transition: "direct_cost.submit" }), [param("directCostId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.submitDirectCost({ ...scope(req), directCostId: req.params.directCostId, actor: actorFor(req) }))));
router.post("/:directCostId/approve", requirePermission("cost", "approve", { transition: "direct_cost.approve" }), [param("directCostId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.approveDirectCost({ ...scope(req), directCostId: req.params.directCostId, actor: actorFor(req) }))));
router.post("/:directCostId/reject", requirePermission("cost", "approve", { transition: "direct_cost.approve" }), [param("directCostId").isUUID(), body("reason").isString().trim().isLength({ min: 1, max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.rejectDirectCost({ ...scope(req), directCostId: req.params.directCostId, payload: req.body, actor: actorFor(req) }))));
router.post("/:directCostId/void", requirePermission("cost", "approve", { transition: "direct_cost.void" }), [param("directCostId").isUUID(), body("reason").isString().trim().isLength({ min: 1, max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.voidDirectCost({ ...scope(req), directCostId: req.params.directCostId, payload: req.body, actor: actorFor(req) }))));
router.post("/:directCostId/payments", requirePermission("cost", "approve", { transition: "direct_cost.pay" }), [param("directCostId").isUUID(), body("amount").custom(scalarFigure).bail().isFloat({ gt: 0, max: MONEY_FIGURE_MAX }), body("paidAt").optional({ nullable: true }).custom(dateInput), body("method").optional({ nullable: true }).isString().isLength({ max: 60 }), body("reference").optional({ nullable: true }).isString().isLength({ max: 120 }), body("note").optional({ nullable: true }).isString().isLength({ max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.recordPayment({ ...scope(req), directCostId: req.params.directCostId, payload: req.body, actor: actorFor(req) }), 201)));

module.exports = router;
