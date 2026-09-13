const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const { requirePermission, hasPermission } = require("../middleware/rbac");
const { sendSuccess } = require("../utils/api-response");
const { moneyBody } = require("../utils/money");
const {
  listBudgetRevisions,
  createBudgetRevision,
  updateBudgetRevision,
  deleteBudgetRevision,
} = require("../services/budget-revision.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("cost", "read"),
  asyncHandler(async (req, res) => {
    const data = await listBudgetRevisions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("cost", "create"),
  [
    body("title").trim().notEmpty(),
    body("changeType").isIn(["addition", "deduction"]),
    moneyBody("amount", { required: true }),
    body("effectiveDate").optional().isISO8601(),
    body("status")
      .optional()
      .isIn(["draft", "submitted", "approved", "rejected"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createBudgetRevision({
      orgId: req.user.orgId,
      canApprove: hasPermission(req, "cost", "approve"),
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row, 201);
  }),
);

router.patch(
  "/:revisionId",
  requirePermission("cost", "update"),
  [
    param("revisionId").isUUID(),
    body("changeType").optional().isIn(["addition", "deduction"]),
    moneyBody("amount"),
    body("effectiveDate").optional().isISO8601(),
    body("status")
      .optional()
      .isIn(["draft", "submitted", "approved", "rejected"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateBudgetRevision({
      orgId: req.user.orgId,
      canApprove: hasPermission(req, "cost", "approve"),
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:revisionId",
  requirePermission("cost", "delete"),
  [param("revisionId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteBudgetRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
