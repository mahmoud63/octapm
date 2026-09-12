const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const { requirePermission } = require("../middleware/rbac");
const { sendSuccess } = require("../utils/api-response");
const { moneyBody } = require("../utils/money");
const {
  listCashFlow,
  createManualCashFlowEntry,
  rebuildCashFlow,
  deleteCashFlowEntry,
} = require("../services/cash-flow.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("cost", "read"),
  asyncHandler(async (req, res) => {
    const data = await listCashFlow({
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
    body("period").matches(/^\d{4}-\d{2}$/),
    moneyBody("inflow"),
    moneyBody("outflow"),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createManualCashFlowEntry({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });

    return sendSuccess(res, row, 201);
  }),
);

router.post(
  "/rebuild",
  requirePermission("cost", "update"),
  asyncHandler(async (req, res) => {
    const data = await rebuildCashFlow({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.delete(
  "/:entryId",
  requirePermission("cost", "delete"),
  [param("entryId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteCashFlowEntry({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      entryId: req.params.entryId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
