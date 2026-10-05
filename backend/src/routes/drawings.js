const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { validate } = require("../middleware/validate");
const { requirePermission } = require("../middleware/rbac");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const {
  listDrawings,
  createDrawing,
  updateDrawing,
  deleteDrawing,
} = require("../services/drawing.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("document_control", "read"),
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
  requirePermission("document_control", "create"),
  [
    body("drawingNumber").isString().trim().notEmpty(),
    body("title").isString().trim().notEmpty(),
    body("status").optional().isIn(["active", "superseded", "cancelled"]),
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
    body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
    body("reviewedOn").optional({ nullable: true }).isString().custom(dateInput),
    body("issueDate").optional({ nullable: true }).isString().custom(dateInput),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("discipline").optional({ nullable: true }).isString(),
    body("purpose").optional({ nullable: true }).isString(),
    body("fileUrl").optional({ nullable: true }).isString(),
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
  requirePermission("document_control", "update"),
  [
    param("drawingId").isUUID(),
    body("status").optional().isIn(["active", "superseded", "cancelled"]),
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
    body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
    body("reviewedOn").optional({ nullable: true }).isString().custom(dateInput),
    body("issueDate").optional({ nullable: true }).isString().custom(dateInput),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("discipline").optional({ nullable: true }).isString(),
    body("purpose").optional({ nullable: true }).isString(),
    body("fileUrl").optional({ nullable: true }).isString(),
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
  requirePermission("document_control", "update"),
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
