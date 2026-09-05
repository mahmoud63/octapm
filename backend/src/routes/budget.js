const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const budgetService = require("../services/budget.service");

/** Budget by cost code (OCTA-FIN-COSTCODE-019): `/projects/:projectId/budget`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const moneyField = (name) => body(name).optional({ nullable: true }).isFloat({ min: -1e12, max: 1e12 });

router.get(
  "/cost-codes",
  requirePermission("cost", "read"),
  [query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.listProjectCostCodes({ ...scope(req), query: req.query }))),
);

router.put(
  "/cost-codes",
  requirePermission("cost", "update"),
  [
    body("costCodeIds").optional().isArray({ max: 2000 }),
    body("costCodeIds.*").isUUID(),
    body("removeCostCodeIds").optional().isArray({ max: 2000 }),
    body("removeCostCodeIds.*").isUUID(),
    body("importAll").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.selectProjectCostCodes({ ...scope(req), payload: req.body, actor: actor(req) }))),
);

router.get(
  "/lines",
  requirePermission("cost", "read"),
  [
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("costType").optional().isIn(budgetService.COST_TYPES),
    query("costCodeId").optional({ values: "falsy" }).isUUID(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.listBudgetLines({ ...scope(req), query: req.query }))),
);

router.post(
  "/lines",
  requirePermission("cost", "create"),
  [
    body("costCodeId").isUUID(),
    body("costType").optional().isIn(budgetService.COST_TYPES),
    body("description").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    moneyField("originalBudget"),
    moneyField("committed"),
    moneyField("actual"),
    moneyField("forecast"),
    body("sortOrder").optional().isInt({ min: 0 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.createBudgetLine({ ...scope(req), payload: req.body, actor: actor(req) }), 201)),
);

router.post(
  "/lines/import",
  requirePermission("cost", "create"),
  [
    body("rows").isArray({ min: 1, max: 2000 }),
    body("rows.*.code").isString().trim().notEmpty(),
    body("rows.*.costType").optional().isIn(budgetService.COST_TYPES),
    body("rows.*.originalBudget").optional({ nullable: true }).isFloat(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.importBudgetLines({ ...scope(req), rows: req.body.rows, actor: actor(req) }), 201)),
);

router.post(
  "/transfers",
  requirePermission("cost", "approve"),
  [body("fromLineId").isUUID(), body("toLineId").isUUID(), body("amount").isFloat({ gt: 0 }), body("note").optional({ nullable: true }).isString().trim().isLength({ max: 500 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.transferBudget({ ...scope(req), payload: req.body, actor: actor(req) }))),
);

router.get(
  "/reconciliation",
  requirePermission("cost", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.reconcile(scope(req)))),
);

router.get(
  "/snapshots",
  requirePermission("cost", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.listSnapshots(scope(req)))),
);

router.post(
  "/snapshots",
  requirePermission("cost", "approve"),
  [body("label").optional({ nullable: true }).isString().trim().isLength({ max: 160 }), body("reportingPeriodId").optional({ nullable: true }).isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.takeSnapshot({ ...scope(req), payload: req.body, actor: actor(req) }), 201)),
);

router.get(
  "/snapshots/:snapshotId",
  requirePermission("cost", "read"),
  [param("snapshotId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.getSnapshot({ ...scope(req), snapshotId: req.params.snapshotId }))),
);

router.put(
  "/change-orders/:changeOrderId/line",
  requirePermission("cost", "update"),
  [param("changeOrderId").isUUID(), body("lineId").optional({ nullable: true }).isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.setChangeOrderBudgetLine({ ...scope(req), changeOrderId: req.params.changeOrderId, lineId: req.body.lineId || null, actor: actor(req) }))),
);

router.get(
  "/lines/:lineId",
  requirePermission("cost", "read"),
  [param("lineId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.getBudgetLine({ ...scope(req), lineId: req.params.lineId }))),
);

router.patch(
  "/lines/:lineId",
  requirePermission("cost", "update"),
  [
    param("lineId").isUUID(),
    body("costType").optional().isIn(budgetService.COST_TYPES),
    body("description").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    moneyField("originalBudget"),
    moneyField("committed"),
    moneyField("actual"),
    moneyField("forecast"),
    body("sortOrder").optional().isInt({ min: 0 }).toInt(),
    body("status").optional().isIn(["active", "archived"]),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.updateBudgetLine({ ...scope(req), lineId: req.params.lineId, payload: req.body, actor: actor(req) }))),
);

router.delete(
  "/lines/:lineId",
  requirePermission("cost", "delete"),
  [param("lineId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.archiveBudgetLine({ ...scope(req), lineId: req.params.lineId, actor: actor(req) }))),
);

router.put(
  "/lines/:lineId/allocations",
  requirePermission("cost", "update"),
  [param("lineId").isUUID(), body("allocations").isArray({ max: 500 }), body("allocations.*.activityId").isUUID(), body("allocations.*.weight").isFloat({ min: 0, max: 100 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.setLineAllocations({ ...scope(req), lineId: req.params.lineId, payload: req.body, actor: actor(req) }))),
);

router.get(
  "/lines/:lineId/allocations/suggest",
  requirePermission("cost", "read"),
  [param("lineId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.suggestAllocations({ ...scope(req), lineId: req.params.lineId }))),
);

router.post(
  "/lines/:lineId/revisions",
  requirePermission("cost", "approve"),
  [param("lineId").isUUID(), body("amount").isFloat(), body("note").isString().trim().notEmpty().isLength({ max: 500 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.addRevision({ ...scope(req), lineId: req.params.lineId, payload: req.body, actor: actor(req) }), 201)),
);

module.exports = router;
