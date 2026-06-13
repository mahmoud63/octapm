const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const { sendSuccess } = require("../utils/api-response");
const { moneyBody } = require("../utils/money");
const {
  listSubValuations,
  createSubValuation,
  updateSubValuation,
  deleteSubValuation,
} = require("../services/sub-valuation.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await listSubValuations({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  [
    body("subcontractor").trim().notEmpty(),
    body("period").trim().notEmpty(),
    moneyBody("workDone"),
    moneyBody("materialsOnSite"),
    body("retentionRate").optional().isFloat({ min: 0, max: 100 }),
    moneyBody("backCharges"),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("activityLinks.*.relationType").optional().isString().trim(),
    body("activityLinks.*.quantity").optional().isFloat({ min: 0 }),
    moneyBody("activityLinks.*.amount"),
    body("allocationLinks").optional().isArray(),
    body("allocationLinks.*.allocationId")
      .optional({ nullable: true })
      .isUUID(),
    body("allocationLinks.*.boqItemId").optional({ nullable: true }).isUUID(),
    body("allocationLinks.*.quantity").optional().isFloat({ min: 0 }),
    moneyBody("allocationLinks.*.workDoneAmount"),
    moneyBody("allocationLinks.*.materialsOnSiteAmount"),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isUUID(),
    body("attachmentRefs").optional().isArray(),
    body("status").optional().isIn(["draft", "submitted", "certified", "paid"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createSubValuation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row, 201);
  }),
);

router.patch(
  "/:valuationId",
  [
    param("valuationId").isUUID(),
    moneyBody("workDone"),
    moneyBody("materialsOnSite"),
    body("retentionRate").optional().isFloat({ min: 0, max: 100 }),
    moneyBody("backCharges"),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("activityLinks.*.relationType").optional().isString().trim(),
    body("activityLinks.*.quantity").optional().isFloat({ min: 0 }),
    moneyBody("activityLinks.*.amount"),
    body("allocationLinks").optional().isArray(),
    body("allocationLinks.*.allocationId")
      .optional({ nullable: true })
      .isUUID(),
    body("allocationLinks.*.boqItemId").optional({ nullable: true }).isUUID(),
    body("allocationLinks.*.quantity").optional().isFloat({ min: 0 }),
    moneyBody("allocationLinks.*.workDoneAmount"),
    moneyBody("allocationLinks.*.materialsOnSiteAmount"),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isUUID(),
    body("attachmentRefs").optional().isArray(),
    body("status").optional().isIn(["draft", "submitted", "certified", "paid"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateSubValuation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      valuationId: req.params.valuationId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:valuationId",
  [param("valuationId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteSubValuation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      valuationId: req.params.valuationId,
      userId: req.user.id,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
