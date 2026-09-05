const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const {
  listDefects,
  createDefect,
  updateDefect,
  deleteDefect,
} = require("../services/defect.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await listDefects({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  [
    body("title").trim().notEmpty(),
    body("severity").optional().isIn(["minor", "major", "critical"]),
    body("status").optional().isIn(["open", "in_progress", "closed"]),
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
    body("statusComment").optional().isString().trim(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("targetCloseBy").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createDefect({
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
  "/:defectId",
  [
    param("defectId").isUUID(),
    body("severity").optional().isIn(["minor", "major", "critical"]),
    body("status").optional().isIn(["open", "in_progress", "closed"]),
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
    body("statusComment").optional().isString().trim(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("targetCloseBy").optional({ nullable: true }).isISO8601(),
    body("closedDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateDefect({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      defectId: req.params.defectId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:defectId",
  [param("defectId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteDefect({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      defectId: req.params.defectId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
