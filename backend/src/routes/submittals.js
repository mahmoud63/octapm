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
  listSubmittals,
  createSubmittal,
  updateSubmittal,
  submitSubmittal,
  reviewSubmittal,
  resubmitSubmittal,
  approveSubmittal,
  rejectSubmittal,
  deleteSubmittal,
} = require("../services/submittal.service");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  requirePermission("submittal", "read"),
  [
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status")
      .optional()
      .isIn([
        "pending",
        "under_review",
        "approved",
        "resubmit",
        "rejected",
        "archived",
      ]),
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("activityId").optional().isUUID(),
    query("owner").optional().isString().trim().isLength({ max: 120 }),
    query("ownerPartyId").optional().isUUID(),
    query("partyId").optional().isUUID(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("dueAfter").optional().isISO8601(),
    query("dueBefore").optional().isISO8601(),
    query("sortBy")
      .optional()
      .isIn([
        "created",
        "updated",
        "dueDate",
        "submittedOn",
        "reviewedOn",
        "status",
        "ref",
        "title",
      ]),
    query("sortDir").optional().isIn(["asc", "desc"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await listSubmittals({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("submittal", "create"),
  [
    body("title").trim().notEmpty(),
    body("status")
      .optional()
      .isIn(["pending", "under_review", "approved", "resubmit", "rejected"]),
    body("owner").optional().isString().trim(),
    body("ownerPartyId").optional({ nullable: true }).isUUID(),
    body("reviewer").optional().isString().trim(),
    body("reviewerPartyId").optional({ nullable: true }).isUUID(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("approverPartyId").optional({ nullable: true }).isUUID(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("revisions").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("submittedOn").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("reviewedOn").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row, 201);
  }),
);

const submittalEvidenceValidators = [
  body("activityId").optional({ nullable: true }).isUUID(),
  body("activityIds").optional().isArray(),
  body("activityIds.*").optional().isUUID(),
  body("activityLinks").optional().isArray(),
  body("activityLinks.*.activityId").optional().isUUID(),
  body("ownerPartyId").optional({ nullable: true }).isUUID(),
  body("reviewerPartyId").optional({ nullable: true }).isUUID(),
  body("approverPartyId").optional({ nullable: true }).isUUID(),
  body("attachments").optional().isArray(),
  body("attachmentRefs").optional().isArray(),
  body("revisions").optional().isArray(),
  body("revision").optional().isString().trim(),
  body("projectDocumentId").optional().isUUID(),
  body("documentId").optional().isUUID(),
  body("storageKey").optional().isString().trim(),
  body("remarks").optional({ nullable: true }).isString().trim(),
  body("comment").optional({ nullable: true }).isString().trim(),
  body("submittedOn").optional({ nullable: true }).isISO8601(),
  body("reviewedOn").optional({ nullable: true }).isISO8601(),
];

router.post(
  "/:submittalId/submit",
  requirePermission("submittal", "submit", {
    transition: "submittal.submit",
  }),
  [param("submittalId").isUUID(), ...submittalEvidenceValidators, validate],
  asyncHandler(async (req, res) => {
    const row = await submitSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:submittalId/review",
  requirePermission("submittal", "submit", {
    transition: "submittal.review",
  }),
  [
    param("submittalId").isUUID(),
    body("comment").trim().notEmpty(),
    body("remarks").optional({ nullable: true }).isString().trim(),
    body("reviewedOn").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await reviewSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:submittalId/resubmit",
  requirePermission("submittal", "submit", {
    transition: "submittal.resubmit",
  }),
  [
    param("submittalId").isUUID(),
    body("reason").optional({ nullable: true }).isString().trim(),
    ...submittalEvidenceValidators,
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await resubmitSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:submittalId/approve",
  requirePermission("submittal", "approve", {
    transition: "submittal.approve",
  }),
  [
    param("submittalId").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await approveSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

const rejectSubmittalRoute = asyncHandler(async (req, res) => {
  const row = await rejectSubmittal({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    submittalId: req.params.submittalId,
    reason: req.body.reason,
    userId: req.user.id,
    userRole: getEffectiveRole(req),
    projectAccess: req.projectAccess,
  });

  return sendSuccess(res, row);
});

const rejectSubmittalValidators = [
  param("submittalId").isUUID(),
  body("reason").trim().notEmpty(),
  validate,
];

router.post(
  "/:submittalId/reject",
  requirePermission("submittal", "approve", {
    transition: "submittal.reject",
  }),
  rejectSubmittalValidators,
  rejectSubmittalRoute,
);

router.post(
  "/:submittalId/disapprove",
  requirePermission("submittal", "approve", {
    transition: "submittal.reject",
  }),
  rejectSubmittalValidators,
  rejectSubmittalRoute,
);

router.patch(
  "/:submittalId",
  requirePermission("submittal", "update"),
  [
    param("submittalId").isUUID(),
    body("status")
      .optional()
      .isIn(["pending", "under_review", "approved", "resubmit", "rejected"]),
    body("owner").optional().isString().trim(),
    body("ownerPartyId").optional({ nullable: true }).isUUID(),
    body("reviewer").optional().isString().trim(),
    body("reviewerPartyId").optional({ nullable: true }).isUUID(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("approverPartyId").optional({ nullable: true }).isUUID(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("revisions").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("submittedOn").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("reviewedOn").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:submittalId",
  requirePermission("submittal", "delete"),
  [param("submittalId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
