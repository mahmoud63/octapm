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
  listRfis,
  createRfi,
  updateRfi,
  submitRfi,
  answerRfi,
  closeRfi,
  reopenRfi,
  approveRfi,
  rejectRfi,
  deleteRfi,
} = require("../services/rfi.service");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  requirePermission("rfi", "read"),
  [
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").optional().isIn(["open", "answered", "closed", "archived"]),
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("priority").optional().isIn(["low", "normal", "high", "urgent"]),
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
        "raisedDate",
        "responseRequiredBy",
        "answeredDate",
        "priority",
        "status",
        "ref",
      ]),
    query("sortDir").optional().isIn(["asc", "desc"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await listRfis({
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
  requirePermission("rfi", "create"),
  [
    body("subject").trim().notEmpty(),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]),
    body("status").optional().isIn(["open", "answered", "closed"]),
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
    body("raisedDate").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("responseRequiredBy").optional({ nullable: true }).isISO8601(),
    body("answeredDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createRfi({
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

router.post(
  "/:rfiId/submit",
  requirePermission("rfi", "submit", { transition: "rfi.submit" }),
  [
    param("rfiId").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await submitRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:rfiId/answer",
  requirePermission("rfi", "submit", { transition: "rfi.answer" }),
  [
    param("rfiId").isUUID(),
    body("response").trim().notEmpty(),
    body("answeredBy").optional({ nullable: true }).isString().trim(),
    body("answeredDate").optional({ nullable: true }).isISO8601(),
    body("ownerPartyId").optional({ nullable: true }).isUUID(),
    body("reviewerPartyId").optional({ nullable: true }).isUUID(),
    body("approverPartyId").optional({ nullable: true }).isUUID(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("revisions").optional().isArray(),
    body("revision").optional().isString().trim(),
    body("projectDocumentId").optional().isUUID(),
    body("documentId").optional().isUUID(),
    body("storageKey").optional().isString().trim(),
    body("comment").optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await answerRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:rfiId/approve",
  requirePermission("rfi", "approve", { transition: "rfi.approve" }),
  [
    param("rfiId").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await approveRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:rfiId/close",
  requirePermission("rfi", "approve", { transition: "rfi.close" }),
  [param("rfiId").isUUID(), body("comment").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const row = await closeRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:rfiId/reopen",
  requirePermission("rfi", "approve", { transition: "rfi.reopen" }),
  [param("rfiId").isUUID(), body("reason").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const row = await reopenRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

const rejectRfiRoute = asyncHandler(async (req, res) => {
  const row = await rejectRfi({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    rfiId: req.params.rfiId,
    reason: req.body.reason,
    userId: req.user.id,
    userRole: getEffectiveRole(req),
    projectAccess: req.projectAccess,
  });

  return sendSuccess(res, row);
});

const rejectRfiValidators = [
  param("rfiId").isUUID(),
  body("reason").trim().notEmpty(),
  validate,
];

router.post(
  "/:rfiId/reject",
  requirePermission("rfi", "approve", { transition: "rfi.reject" }),
  rejectRfiValidators,
  rejectRfiRoute,
);

router.post(
  "/:rfiId/disapprove",
  requirePermission("rfi", "approve", { transition: "rfi.reject" }),
  rejectRfiValidators,
  rejectRfiRoute,
);

router.patch(
  "/:rfiId",
  requirePermission("rfi", "update"),
  [
    param("rfiId").isUUID(),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]),
    body("status").optional().isIn(["open", "answered", "closed"]),
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
    body("raisedDate").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("responseRequiredBy").optional({ nullable: true }).isISO8601(),
    body("answeredDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:rfiId",
  requirePermission("rfi", "delete"),
  [param("rfiId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
