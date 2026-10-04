const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const riskService = require("../services/risk.service");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const riskPayloadValidators = ({ requireDescription = false } = {}) => [
  requireDescription
    ? body("description").isString().trim().notEmpty()
    : body("description").optional().isString().trim().notEmpty(),
  body("probability").optional().isIn(["low", "medium", "high"]),
  body("impact").optional().isIn(["low", "medium", "high"]),
  body("severity").optional().isIn(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  body("mitigation").optional({ nullable: true }).isString().trim(),
  body("responsePlan").optional({ nullable: true }).isString().trim(),
  body("residualProbability").optional().isIn(["low", "medium", "high"]),
  body("residualImpact").optional().isIn(["low", "medium", "high"]),
  body("residualSeverity")
    .optional()
    .isIn(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  body("residualDescription").optional({ nullable: true }).isString().trim(),
  body("phase").optional({ nullable: true }).isString().trim(),
  body("owner").optional({ nullable: true }).isString().trim(),
  ...assignmentReferenceValidators(),
  body("dueDate").optional({ nullable: true }).isISO8601(),
  body("escalationLevel").optional().isIn(["none", "watch", "escalated"]),
  body("escalationNotes").optional({ nullable: true }).isString().trim(),
  body("status").optional().isIn(["open", "monitoring"]),
  body("activityId").optional({ nullable: true }).isString().isUUID(),
  body("activityIds").optional().isArray(),
  body("activityIds.*").optional().isString().isUUID(),
  body("activityLinks").optional().isArray(),
  body("activityLinks.*.activityId").optional().isString().isUUID(),
  body("activityLinks.*.id").optional().isString().isUUID(),
  body("activityLinks.*.relationType").optional().isString().trim(),
  body("activityLinks.*.scheduleImpactDays").optional().isInt().toInt(),
  body("activityLinks.*.costImpact").optional().isFloat({ min: 0 }).toFloat(),
  body("activityLinks.*.notes").optional({ nullable: true }).isString().trim(),
  body("comment").optional({ nullable: true }).isString().trim(),
  body("statusComment").optional({ nullable: true }).isString().trim(),
  validate,
];

const closeoutValidators = [
  param("id").isUUID(),
  body("dueDate").optional({ nullable: true }).isISO8601(),
  body("responsePlan").optional({ nullable: true }).isString().trim(),
  body("closeoutComment").optional({ nullable: true }).isString().trim(),
  body("comment").optional({ nullable: true }).isString().trim(),
  body("statusComment").optional({ nullable: true }).isString().trim(),
  validate,
];

router.get(
  "/",
  requirePermission("risk", "read"),
  [
    query("status").isString()
      .optional()
      .isIn(["open", "monitoring", "submitted", "closed", "archived"]),
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await riskService.listRisks({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  requirePermission("risk", "create"),
  riskPayloadValidators({ requireDescription: true }),
  asyncHandler(async (req, res) => {
    const result = await riskService.createRisk({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/:id/submit",
  requirePermission("risk", "submit", { transition: "risk.submit" }),
  closeoutValidators,
  asyncHandler(async (req, res) => {
    const result = await riskService.submitRiskCloseout({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/close",
  requirePermission("risk", "submit", { transition: "risk.submit" }),
  closeoutValidators,
  asyncHandler(async (req, res) => {
    const result = await riskService.submitRiskCloseout({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/approve",
  requirePermission("risk", "approve", { transition: "risk.approve" }),
  [
    param("id").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await riskService.approveRiskCloseout({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/reject",
  requirePermission("risk", "approve", { transition: "risk.reject" }),
  [param("id").isUUID(), body("reason").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const result = await riskService.rejectRiskCloseout({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/disapprove",
  requirePermission("risk", "approve", { transition: "risk.reject" }),
  [param("id").isUUID(), body("reason").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const result = await riskService.rejectRiskCloseout({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/reopen",
  requirePermission("risk", "approve", { transition: "risk.reopen" }),
  [param("id").isUUID(), body("reason").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const result = await riskService.reopenRisk({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:id",
  requirePermission("risk", "update"),
  [param("id").isUUID(), ...riskPayloadValidators()],
  asyncHandler(async (req, res) => {
    const result = await riskService.updateRisk({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  "/:id",
  requirePermission("risk", "delete"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await riskService.deleteRisk({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
