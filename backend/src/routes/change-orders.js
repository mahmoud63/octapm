const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const {
  getEffectiveRole,
  requirePermission,
  requireRoles,
} = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { moneyBody } = require("../utils/money");
const changeOrderService = require("../services/change-order.service");
const {
  boqFigureAccess,
  withheldAllocationLinks,
} = require("../utils/boq-figures");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  // The register carries contract values and pricing, so it is not open to
  // every project member: the change_order policy limits reads to the
  // commercial and financial roles.
  requirePermission("change_order", "read"),
  [
    query("status").isString()
      .optional()
      .isIn(["draft", "pending", "approved", "rejected", "archived"]),
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.listChangeOrders({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    // A link's BOQ row and allocation go only to a BOQ reader.
    const access = boqFigureAccess(req);
    return sendSuccess(res, {
      ...result,
      orders: result.orders.map((order) => withheldAllocationLinks(order, access)),
    });
  }),
);

router.post(
  "/",
  requireRoles("pm", "qs"),
  [
    body("description").isString().trim().notEmpty(),
    body("activityId").optional({ nullable: true }).isString().isUUID(),
    body("budgetLineId").optional({ nullable: true }).isString().isUUID(),
    body("budgetAllocations").optional().isArray({ max: 50 }),
    body("budgetAllocations.*.budgetLineId").isString().isUUID(),
    moneyBody("budgetAllocations.*.amount"),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("activityLinks.*.relationType").optional().isString().trim(),
    body("activityLinks.*.scheduleImpactDays").optional().isInt().toInt(),
    body("activityLinks.*.approvedScheduleImpactDays")
      .optional()
      .isInt()
      .toInt(),
    moneyBody("activityLinks.*.costImpact"),
    moneyBody("activityLinks.*.approvedCostImpact"),
    body("activityLinks.*.baselineStart")
      .optional({ nullable: true })
      .isString().isISO8601(),
    body("activityLinks.*.baselineFinish")
      .optional({ nullable: true })
      .isString().isISO8601(),
    body("activityLinks.*.impactedStart")
      .optional({ nullable: true })
      .isString().isISO8601(),
    body("activityLinks.*.impactedFinish")
      .optional({ nullable: true })
      .isString().isISO8601(),
    body("activityLinks.*.impactBasis")
      .optional({ nullable: true })
      .isString()
      .trim(),
    body("activityLinks.*.notes")
      .optional({ nullable: true })
      .isString()
      .trim(),
    body("affectedActivityIds").optional().isArray(),
    body("affectedActivityIds.*").optional().isString().isUUID(),
    body("allocationLinks").optional().isArray(),
    body("allocationLinks.*.allocationId")
      .optional({ nullable: true })
      .isString().isUUID(),
    body("allocationLinks.*.boqItemId").optional({ nullable: true }).isString().isUUID(),
    body("allocationLinks.*.quantity").optional().isFloat({ min: 0 }).toFloat(),
    moneyBody("allocationLinks.*.amount"),
    body("allocationLinks.*.notes")
      .optional({ nullable: true })
      .isString()
      .trim(),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isString().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isString().isUUID(),
    body("correspondenceLinks.*.relationType").optional().isString().trim(),
    body("attachmentRefs").optional().isArray(),
    body("attachmentRefs.*.documentId").optional({ nullable: true }).isString().isUUID(),
    body("supportingDocumentIds").optional().isArray(),
    body("supportingDocumentIds.*").optional().isString().isUUID(),
    body("documentIds").optional().isArray(),
    body("documentIds.*").optional().isString().isUUID(),
    body("category").optional().isString().trim(),
    moneyBody("value"),
    body("status").optional().isIn(["draft"]),
    body("scheduleImpact").optional().isInt().toInt(),
    body("scheduleImpactSummary")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({
        max: 4000,
      }),
    body("costImpactSummary")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({
        max: 4000,
      }),
    body("submittedDate").optional().isString().isISO8601(),
    body("raisedBy").optional().isString().trim(),
    body("rejectedReason").optional().isString().trim(),
    body("approvalComment")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({
        max: 2000,
      }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.createChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      payload: req.body,
    });
    return sendSuccess(res, withheldAllocationLinks(result, boqFigureAccess(req)), 201);
  }),
);

router.patch(
  "/:id",
  requireRoles("pm", "qs"),
  [
    param("id").isUUID(),
    body("description").optional().isString().trim().notEmpty(),
    body("activityId").optional({ nullable: true }).isString().isUUID(),
    body("budgetLineId").optional({ nullable: true }).isString().isUUID(),
    body("budgetAllocations").optional().isArray({ max: 50 }),
    body("budgetAllocations.*.budgetLineId").isString().isUUID(),
    moneyBody("budgetAllocations.*.amount"),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("activityLinks.*.relationType").optional().isString().trim(),
    body("activityLinks.*.scheduleImpactDays").optional().isInt().toInt(),
    body("activityLinks.*.approvedScheduleImpactDays")
      .optional()
      .isInt()
      .toInt(),
    moneyBody("activityLinks.*.costImpact"),
    moneyBody("activityLinks.*.approvedCostImpact"),
    body("activityLinks.*.baselineStart")
      .optional({ nullable: true })
      .isString().isISO8601(),
    body("activityLinks.*.baselineFinish")
      .optional({ nullable: true })
      .isString().isISO8601(),
    body("activityLinks.*.impactedStart")
      .optional({ nullable: true })
      .isString().isISO8601(),
    body("activityLinks.*.impactedFinish")
      .optional({ nullable: true })
      .isString().isISO8601(),
    body("activityLinks.*.impactBasis")
      .optional({ nullable: true })
      .isString()
      .trim(),
    body("activityLinks.*.notes")
      .optional({ nullable: true })
      .isString()
      .trim(),
    body("affectedActivityIds").optional().isArray(),
    body("affectedActivityIds.*").optional().isString().isUUID(),
    body("allocationLinks").optional().isArray(),
    body("allocationLinks.*.allocationId")
      .optional({ nullable: true })
      .isString().isUUID(),
    body("allocationLinks.*.boqItemId").optional({ nullable: true }).isString().isUUID(),
    body("allocationLinks.*.quantity").optional().isFloat({ min: 0 }).toFloat(),
    moneyBody("allocationLinks.*.amount"),
    body("allocationLinks.*.notes")
      .optional({ nullable: true })
      .isString()
      .trim(),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isString().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isString().isUUID(),
    body("correspondenceLinks.*.relationType").optional().isString().trim(),
    body("attachmentRefs").optional().isArray(),
    body("attachmentRefs.*.documentId").optional({ nullable: true }).isString().isUUID(),
    body("supportingDocumentIds").optional().isArray(),
    body("supportingDocumentIds.*").optional().isString().isUUID(),
    body("documentIds").optional().isArray(),
    body("documentIds.*").optional().isString().isUUID(),
    body("category").optional().isString().trim(),
    moneyBody("value"),
    body("status")
      .optional()
      .isIn(["draft", "pending", "approved", "rejected"]),
    body("scheduleImpact").optional().isInt().toInt(),
    body("scheduleImpactSummary")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({
        max: 4000,
      }),
    body("costImpactSummary")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({
        max: 4000,
      }),
    body("submittedDate").optional().isString().isISO8601(),
    body("raisedBy").optional().isString().trim(),
    body("rejectedReason").optional().isString().trim(),
    body("approvalComment")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({
        max: 2000,
      }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.updateChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      payload: req.body,
    });
    return sendSuccess(res, withheldAllocationLinks(result, boqFigureAccess(req)));
  }),
);

router.post(
  "/:id/submit",
  requirePermission("change_order", "submit", {
    transition: "change_order.submit",
  }),
  [
    param("id").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.submitChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body.comment,
    });
    return sendSuccess(res, withheldAllocationLinks(result, boqFigureAccess(req)));
  }),
);

router.post(
  "/:id/approve",
  requirePermission("change_order", "approve", {
    transition: "change_order.approve",
  }),
  [
    param("id").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.approveChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body.comment,
    });
    return sendSuccess(res, withheldAllocationLinks(result, boqFigureAccess(req)));
  }),
);

const rejectChangeOrderRoute = asyncHandler(async (req, res) => {
  const result = await changeOrderService.rejectChangeOrder({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    coId: req.params.id,
    userId: req.user.id,
    userRole: getEffectiveRole(req),
    reason: req.body.reason,
  });
  return sendSuccess(res, withheldAllocationLinks(result, boqFigureAccess(req)));
});

const rejectChangeOrderValidators = [
  param("id").isUUID(),
  body("reason").trim().notEmpty().isLength({ max: 2000 }),
  validate,
];

router.post(
  "/:id/reject",
  requirePermission("change_order", "approve", {
    transition: "change_order.reject",
  }),
  rejectChangeOrderValidators,
  rejectChangeOrderRoute,
);

router.post(
  "/:id/disapprove",
  requirePermission("change_order", "approve", {
    transition: "change_order.reject",
  }),
  rejectChangeOrderValidators,
  rejectChangeOrderRoute,
);

router.post(
  "/:id/reopen",
  requirePermission("change_order", "submit", {
    transition: "change_order.reopen",
  }),
  [
    param("id").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.reopenChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body.comment,
    });
    return sendSuccess(res, withheldAllocationLinks(result, boqFigureAccess(req)));
  }),
);

router.delete(
  "/:id",
  requireRoles("pm"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.deleteChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
