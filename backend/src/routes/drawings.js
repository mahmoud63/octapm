const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const {
  listDrawings,
  createDrawing,
  updateDrawing,
  deleteDrawing,
} = require("../services/drawing.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await listDrawings({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  [
    body("drawingNumber").trim().notEmpty(),
    body("title").trim().notEmpty(),
    body("status").optional().isIn(["active", "superseded", "cancelled"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
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
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("reviewedOn").optional({ nullable: true }).isISO8601(),
    body("issueDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createDrawing({
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
  "/:drawingId",
  [
    param("drawingId").isUUID(),
    body("status").optional().isIn(["active", "superseded", "cancelled"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
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
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("reviewedOn").optional({ nullable: true }).isISO8601(),
    body("issueDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateDrawing({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      drawingId: req.params.drawingId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:drawingId",
  [param("drawingId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteDrawing({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      drawingId: req.params.drawingId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
