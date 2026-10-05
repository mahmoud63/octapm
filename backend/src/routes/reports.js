const express = require("express");
const { body, param, query } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { moneyBody } = require("../utils/money");
const evService = require("../services/earned-value.service");
const {
  boqFigureAccess,
  withheldError,
  withheldEvReport,
} = require("../utils/boq-figures");

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const COST_LOADING_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "superseded",
];
const COST_LOADING_CREATE_STATUSES = ["draft", "submitted"];

const COST_LOADING_SOURCES = [
  "manual",
  "import",
  "ai",
  "migration",
  "budget_revision",
];

router.get(
  "/periods",
  requirePermission("cost", "read"),
  asyncHandler(async (req, res) => {
    const result = await evService.listReportingPeriods({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/periods",
  requirePermission("cost", "create"),
  [
    body("code").optional().isString().trim().isLength({ max: 40 }),
    body("label").optional().isString().trim().isLength({ max: 120 }),
    body("periodStart").custom(dateInput),
    body("periodEnd").custom(dateInput),
    body("cutoffDate").optional().custom(dateInput),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.createReportingPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

// The EV report is a cost reader's (§12, utils/boq-figures): the budget —
// the approved allocations' sum — stays; a cost reader who may not read the
// BOQ loses the bill's open value and the bill's figures in the readiness
// gate, on the report, on a locked period's report and on the gate a lock is
// refused with. Output only: the stored snapshot keeps its basis. The lock
// answers with the locked period's report and the locked-period history, as
// GET /reports/ev?periodId= then gives it (earned-value.service
// withLockedEvHistory), withheld the same way.
router.post(
  "/periods/:periodId/lock",
  requirePermission("cost", "approve", {
    transition: "reporting_period.lock",
  }),
  [
    param("periodId").isUUID(),
    body("overrideReason")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const access = boqFigureAccess(req);
    let result;
    try {
      result = await evService.lockReportingPeriod({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        periodId: req.params.periodId,
        userId: req.user.id,
        userRole: getEffectiveRole(req),
        overrideReason: req.body?.overrideReason || null,
      });
    } catch (error) {
      throw withheldError(error, access);
    }
    return sendSuccess(res, withheldEvReport(result, access));
  }),
);

router.get(
  "/cost-loading",
  requirePermission("cost", "read"),
  [query("status").isString().optional().isIn(COST_LOADING_STATUSES), validate],
  asyncHandler(async (req, res) => {
    const result = await evService.listCostLoadings({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/cost-loading",
  requirePermission("cost", "create"),
  [
    body("activityId").isString().isUUID(),
    body("reportingPeriodId").optional({ nullable: true }).isString().isUUID(),
    body("plannedDate").custom(dateInput),
    moneyBody("plannedValue", { required: true }),
    body("source").optional().isIn(COST_LOADING_SOURCES),
    body("baselineVersion").optional().isString().trim().isLength({ max: 80 }),
    body("status").optional().isIn(COST_LOADING_CREATE_STATUSES),
    body("notes").optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.createCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      userRole: req.user.role,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  "/cost-loading/:id",
  requirePermission("cost", "update"),
  [
    param("id").isUUID(),
    body("activityId").optional().isString().isUUID(),
    body("reportingPeriodId").optional({ nullable: true }).isString().isUUID(),
    body("plannedDate").optional().custom(dateInput),
    moneyBody("plannedValue"),
    body("source").optional().isIn(COST_LOADING_SOURCES),
    body("baselineVersion").optional().isString().trim().isLength({ max: 80 }),
    body("notes").optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.updateCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costLoadingId: req.params.id,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/cost-loading/:id/submit",
  requirePermission("cost", "submit"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await evService.submitCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costLoadingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/cost-loading/:id/approve",
  requirePermission("cost", "approve"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await evService.approveCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costLoadingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/cost-loading/:id/reject",
  requirePermission("cost", "approve"),
  [
    param("id").isUUID(),
    body("reason").isString().trim().notEmpty().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await evService.rejectCostLoading({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costLoadingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
      reason: req.body.reason,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/ev",
  requirePermission("cost", "read"),
  [
    query("periodId").isString().optional().isUUID(),
    query("cutoffDate").isString().optional().custom(dateInput),
    validate,
  ],
  asyncHandler(async (req, res) => {
    // The report plus the locked periods' measured history (PC-7a item 3).
    // The history is project-level totals only, so withheldEvReport passes
    // it to every cost reader; the activity breakdown stays BOQ-gated.
    const result = await evService.buildEvReportWithHistory({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      periodId: req.query.periodId || null,
      cutoffDate: req.query.cutoffDate || null,
    });
    return sendSuccess(res, withheldEvReport(result, boqFigureAccess(req)));
  }),
);

module.exports = router;
