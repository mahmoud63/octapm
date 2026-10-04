const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const budgetService = require("../services/budget.service");
const {
  boqFigureAccess,
  withheldAllocationSuggestion,
  withheldBudgetReconciliation,
  withheldBudgetSnapshot,
} = require("../utils/boq-figures");

/** Budget by cost code (OCTA-FIN-COSTCODE-019): `/projects/:projectId/budget`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const moneyField = (name) => body(name).optional({ nullable: true }).isFloat({ min: -1e12, max: 1e12 });

// The project's cost codes are reference data: change events, timesheets and direct costs
// pick from them, so any member of the project reads them (Phase 22B). Changing the set
// stays with cost control (PUT below).
router.get(
  "/cost-codes",
  [query("includeArchived").isString().optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.listProjectCostCodes({ ...scope(req), query: req.query }))),
);

router.put(
  "/cost-codes",
  requirePermission("cost", "update"),
  [
    body("costCodeIds").optional().isArray({ max: 2000 }),
    body("costCodeIds.*").isString().isUUID(),
    body("removeCostCodeIds").optional().isArray({ max: 2000 }),
    body("removeCostCodeIds.*").isString().isUUID(),
    body("importAll").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.selectProjectCostCodes({ ...scope(req), payload: req.body, actor: actor(req) }))),
);

router.get(
  "/lines",
  requirePermission("cost", "read"),
  [
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
    query("costType").isString().optional().isIn(budgetService.COST_TYPES),
    query("costCodeId").isString().optional({ values: "falsy" }).isUUID(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    validate,
  ],
  // Each line says whether its Original Budget is locked, and why (PC-7a), so
  // an edit screen shows it read-only instead of inviting a refused write.
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.listBudgetLines({ ...scope(req), query: req.query, originalLocks: true }))),
);

router.post(
  "/lines",
  requirePermission("cost", "create"),
  [
    body("costCodeId").isString().isUUID(),
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
  [body("fromLineId").isString().isUUID(), body("toLineId").isString().isUUID(), body("amount").isFloat({ gt: 0 }), body("note").optional({ nullable: true }).isString().trim().isLength({ max: 500 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.transferBudget({ ...scope(req), payload: req.body, actor: actor(req) }))),
);

router.get(
  "/reconciliation",
  requirePermission("cost", "read"),
  // Each activity's approved BOQ allocation is withheld from a caller who may
  // not read the BOQ (owner decision E1, utils/boq-figures).
  asyncHandler(async (req, res) => sendSuccess(res, withheldBudgetReconciliation(await budgetService.reconcile(scope(req)), boqFigureAccess(req)))),
);

router.get(
  "/snapshots",
  requirePermission("cost", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, withheldBudgetSnapshot(await budgetService.listSnapshots(scope(req)), boqFigureAccess(req)))),
);

router.post(
  "/snapshots",
  requirePermission("cost", "approve"),
  [body("label").optional({ nullable: true }).isString().trim().isLength({ max: 160 }), body("reportingPeriodId").optional({ nullable: true }).isString().isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.takeSnapshot({ ...scope(req), payload: req.body, actor: actor(req) }), 201)),
);

router.get(
  "/snapshots/:snapshotId",
  requirePermission("cost", "read"),
  [param("snapshotId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, withheldBudgetSnapshot(await budgetService.getSnapshot({ ...scope(req), snapshotId: req.params.snapshotId }), boqFigureAccess(req)))),
);

router.put(
  "/change-orders/:changeOrderId/line",
  requirePermission("cost", "update"),
  [param("changeOrderId").isUUID(), body("lineId").optional({ nullable: true }).isString().isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.setChangeOrderBudgetLine({ ...scope(req), changeOrderId: req.params.changeOrderId, lineId: req.body.lineId || null, actor: actor(req) }))),
);

router.get(
  "/lines/:lineId",
  requirePermission("cost", "read"),
  [param("lineId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.getBudgetLine({ ...scope(req), lineId: req.params.lineId, originalLocks: true }))),
);

// originalBudget is validated here as a number; whether it may still move is
// the service's one Original Budget guard (409 BUDGET_ORIGINAL_LOCKED, PC-7a).
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
  [param("lineId").isUUID(), body("allocations").isArray({ max: 500 }), body("allocations.*.activityId").isString().isUUID(), body("allocations.*.weight").isFloat({ min: 0, max: 100 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.setLineAllocations({ ...scope(req), lineId: req.params.lineId, payload: req.body, actor: actor(req) }))),
);

router.get(
  "/lines/:lineId/allocations/suggest",
  requirePermission("cost", "read"),
  [param("lineId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, withheldAllocationSuggestion(await budgetService.suggestAllocations({ ...scope(req), lineId: req.params.lineId }), boqFigureAccess(req)))),
);

router.post(
  "/lines/:lineId/revisions",
  requirePermission("cost", "approve"),
  [param("lineId").isUUID(), body("amount").isFloat(), body("note").isString().trim().notEmpty().isLength({ max: 500 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await budgetService.addRevision({ ...scope(req), lineId: req.params.lineId, payload: req.body, actor: actor(req) }), 201)),
);

module.exports = router;
