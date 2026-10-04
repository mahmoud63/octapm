const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const { requirePermission } = require("../middleware/rbac");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const {
  listCorrespondence,
  createCorrespondence,
  updateCorrespondence,
  deleteCorrespondence,
} = require("../services/correspondence.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => {
    const data = await listCorrespondence({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("document_control", "create"),
  [
    body("direction").isIn(["incoming", "outgoing"]),
    body("type").isIn(["letter", "email", "memo", "notice"]),
    body("recordTypeKey").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("subject").trim().notEmpty(),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("activityId").optional({ nullable: true }).isString().isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isString().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("revisions").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("date").optional({ nullable: true }).isString().isISO8601(),
    body("dueDate").optional({ nullable: true }).isString().isISO8601(),
    body("responseRequiredBy").optional({ nullable: true }).isString().isISO8601(),
    body("responseDate").optional({ nullable: true }).isString().isISO8601(),
    body("status").optional().isIn(["open", "closed"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createCorrespondence({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });

    return sendSuccess(res, row, 201);
  }),
);

router.patch(
  "/:correspondenceId",
  requirePermission("document_control", "update"),
  [
    param("correspondenceId").isUUID(),
    body("direction").optional().isIn(["incoming", "outgoing"]),
    body("type").optional().isIn(["letter", "email", "memo", "notice"]),
    body("recordTypeKey").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("activityId").optional({ nullable: true }).isString().isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isString().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("revisions").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("date").optional({ nullable: true }).isString().isISO8601(),
    body("dueDate").optional({ nullable: true }).isString().isISO8601(),
    body("responseRequiredBy").optional({ nullable: true }).isString().isISO8601(),
    body("responseDate").optional({ nullable: true }).isString().isISO8601(),
    body("status").optional().isIn(["open", "closed"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateCorrespondence({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      correspondenceId: req.params.correspondenceId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:correspondenceId",
  requirePermission("document_control", "update"),
  [param("correspondenceId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteCorrespondence({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      correspondenceId: req.params.correspondenceId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
