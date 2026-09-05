const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param, query } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const {
  listSafetyIncidents,
  createSafetyIncident,
  updateSafetyIncident,
  submitSafetyCloseout,
  closeSafetyIncident,
  approveSafetyIncident,
  rejectSafetyIncident,
  reopenSafetyIncident,
  deleteSafetyIncident,
} = require("../services/safety.service");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const safetyCloseoutValidators = [
  param("incidentId").isUUID(),
  body("responsible").optional().isString().trim(),
  body("owner").optional().isString().trim(),
  body("assigneeUserId").optional({ nullable: true }).isUUID(),
  body("assigneeCompanyId").optional({ nullable: true }).isUUID(),
  body("dueDate").optional({ nullable: true }).isISO8601(),
  body("closureComment").optional().isString().trim(),
  body("comment").optional().isString().trim(),
  body("statusComment").optional().isString().trim(),
  body("activityId").optional({ nullable: true }).isUUID(),
  body("activityIds").optional().isArray(),
  body("activityIds.*").optional().isUUID(),
  body("activityLinks").optional().isArray(),
  body("activityLinks.*.activityId").optional().isUUID(),
  body("attachments").optional().isArray(),
  body("attachmentRefs").optional().isArray(),
  validate,
];

router.get(
  "/",
  requirePermission("safety", "read"),
  [
    query("status")
      .optional()
      .isIn(["open", "investigating", "submitted", "closed", "archived"]),
    query("includeArchived").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await listSafetyIncidents({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("safety", "create"),
  [
    body("incidentType").isIn(["near_miss", "first_aid", "lti", "fatality"]),
    body("title").trim().notEmpty(),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    body("responsible").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("closureComment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("date").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("closedDate").optional({ nullable: true }).isISO8601(),
    body("lostDays").optional().isInt({ min: 0 }),
    body("status").optional().isIn(["open", "investigating"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createSafetyIncident({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row, 201);
  }),
);

router.post(
  "/:incidentId/submit",
  requirePermission("safety", "submit", { transition: "safety.submit" }),
  safetyCloseoutValidators,
  asyncHandler(async (req, res) => {
    const row = await submitSafetyCloseout({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      incidentId: req.params.incidentId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:incidentId/close",
  requirePermission("safety", "submit", { transition: "safety.close" }),
  safetyCloseoutValidators,
  asyncHandler(async (req, res) => {
    const row = await closeSafetyIncident({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      incidentId: req.params.incidentId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:incidentId/approve",
  requirePermission("safety", "approve", { transition: "safety.approve" }),
  [
    param("incidentId").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await approveSafetyIncident({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      incidentId: req.params.incidentId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

const rejectSafetyRoute = asyncHandler(async (req, res) => {
  const row = await rejectSafetyIncident({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    incidentId: req.params.incidentId,
    reason: req.body.reason,
    userId: req.user.id,
    userRole: getEffectiveRole(req),
  });

  return sendSuccess(res, row);
});

const rejectSafetyValidators = [
  param("incidentId").isUUID(),
  body("reason").trim().notEmpty(),
  validate,
];

router.post(
  "/:incidentId/reject",
  requirePermission("safety", "approve", { transition: "safety.reject" }),
  rejectSafetyValidators,
  rejectSafetyRoute,
);

router.post(
  "/:incidentId/disapprove",
  requirePermission("safety", "approve", { transition: "safety.reject" }),
  rejectSafetyValidators,
  rejectSafetyRoute,
);

router.patch(
  "/:incidentId",
  requirePermission("safety", "update"),
  [
    param("incidentId").isUUID(),
    body("incidentType")
      .optional()
      .isIn(["near_miss", "first_aid", "lti", "fatality"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("closureComment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("date").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("closedDate").optional({ nullable: true }).isISO8601(),
    body("lostDays").optional().isInt({ min: 0 }),
    body("status").optional().isIn(["open", "investigating"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateSafetyIncident({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      incidentId: req.params.incidentId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:incidentId/reopen",
  requirePermission("safety", "approve", { transition: "safety.reopen" }),
  [param("incidentId").isUUID(), body("reason").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const row = await reopenSafetyIncident({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      incidentId: req.params.incidentId,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:incidentId",
  requirePermission("safety", "delete"),
  [param("incidentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteSafetyIncident({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      incidentId: req.params.incidentId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
