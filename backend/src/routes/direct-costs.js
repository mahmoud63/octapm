const express = require("express");
const { body, param, query } = require("express-validator");
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
const date = (field) => body(field).optional({ nullable: true }).isISO8601();

const validators = (partial = false) => [
  partial ? body("description").optional().isString().trim().isLength({ min: 1, max: 2000 }) : body("description").isString().trim().isLength({ min: 1, max: 2000 }),
  partial ? body("costDate").optional().isISO8601() : body("costDate").isISO8601(),
  body("type").optional().isIn(service.TYPES),
  body("vendorCompanyId").optional({ nullable: true }).isString(),
  body("vendorName").optional({ nullable: true }).isString().isLength({ max: 200 }),
  body("invoiceNumber").optional({ nullable: true }).isString().isLength({ max: 80 }),
  date("dueDate"),
  date("receivedDate"),
  body("tax").optional({ nullable: true }).isFloat({ min: 0 }),
  body("paymentTerms").optional({ nullable: true }).isString().isLength({ max: 120 }),
  body("notes").optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body("lines").optional().isArray({ max: 500 }),
  body("lines.*.description").isString().trim().isLength({ min: 1, max: 500 }),
  body("lines.*.costCodeId").optional({ nullable: true }).isString(),
  body("lines.*.budgetLineId").optional({ nullable: true }).isString(),
  body("lines.*.activityId").optional({ nullable: true }).isString(),
  body("lines.*.costType").optional({ nullable: true }).isIn(service.COST_TYPES),
  body("lines.*.quantity").optional().isFloat({ min: 0 }),
  body("lines.*.unit").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("lines.*.unitCost").optional({ nullable: true }).isFloat({ min: 0 }),
  body("lines.*.amount").optional({ nullable: true }).isFloat({ min: 0 }),
  body("lines.*.notes").optional({ nullable: true }).isString().isLength({ max: 1000 }),
];

router.get("/", requirePermission("cost", "read"), [query("status").optional().isIn(Object.values(service.STATUS)), query("type").optional().isIn(service.TYPES), query("vendorCompanyId").optional().isString(), query("from").optional().isISO8601(), query("to").optional().isISO8601(), query("q").optional().isString().isLength({ max: 200 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listDirectCosts({ ...scope(req), query: req.query }))));
router.post("/", requirePermission("cost", "create"), [...validators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.createDirectCost({ ...scope(req), payload: req.body, actor: actorFor(req) }), 201)));
router.get("/:directCostId", requirePermission("cost", "read"), [param("directCostId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getDirectCost({ ...scope(req), directCostId: req.params.directCostId }))));
router.patch("/:directCostId", requirePermission("cost", "update"), [param("directCostId").isUUID(), ...validators(true), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateDirectCost({ ...scope(req), directCostId: req.params.directCostId, payload: req.body, actor: actorFor(req) }))));
router.delete("/:directCostId", requirePermission("cost", "delete"), [param("directCostId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteDirectCost({ ...scope(req), directCostId: req.params.directCostId, actor: actorFor(req) }))));
router.post("/:directCostId/submit", requirePermission("cost", "submit", { transition: "direct_cost.submit" }), [param("directCostId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.submitDirectCost({ ...scope(req), directCostId: req.params.directCostId, actor: actorFor(req) }))));
router.post("/:directCostId/approve", requirePermission("cost", "approve", { transition: "direct_cost.approve" }), [param("directCostId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.approveDirectCost({ ...scope(req), directCostId: req.params.directCostId, actor: actorFor(req) }))));
router.post("/:directCostId/reject", requirePermission("cost", "approve", { transition: "direct_cost.approve" }), [param("directCostId").isUUID(), body("reason").isString().trim().isLength({ min: 1, max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.rejectDirectCost({ ...scope(req), directCostId: req.params.directCostId, payload: req.body, actor: actorFor(req) }))));
router.post("/:directCostId/void", requirePermission("cost", "approve", { transition: "direct_cost.void" }), [param("directCostId").isUUID(), body("reason").isString().trim().isLength({ min: 1, max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.voidDirectCost({ ...scope(req), directCostId: req.params.directCostId, payload: req.body, actor: actorFor(req) }))));
router.post("/:directCostId/payments", requirePermission("cost", "approve", { transition: "direct_cost.pay" }), [param("directCostId").isUUID(), body("amount").isFloat({ gt: 0 }), body("paidAt").optional({ nullable: true }).isISO8601(), body("method").optional({ nullable: true }).isString().isLength({ max: 60 }), body("reference").optional({ nullable: true }).isString().isLength({ max: 120 }), body("note").optional({ nullable: true }).isString().isLength({ max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.recordPayment({ ...scope(req), directCostId: req.params.directCostId, payload: req.body, actor: actorFor(req) }), 201)));

module.exports = router;
