const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const {
  listTransmittals,
  createTransmittal,
  updateTransmittal,
  deleteTransmittal,
} = require("../services/transmittal.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await listTransmittals({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  [
    body("subject").trim().notEmpty(),
    body("sender").trim().notEmpty(),
    body("recipient").trim().notEmpty(),
    body("method").optional().isIn(["email", "courier", "hand"]),
    body("status").optional().isIn(["pending_ack", "acknowledged"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
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
    body("transmittedOn").optional({ nullable: true }).isISO8601(),
    body("acknowledgedOn").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createTransmittal({
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
  "/:transmittalId",
  [
    param("transmittalId").isUUID(),
    body("method").optional().isIn(["email", "courier", "hand"]),
    body("status").optional().isIn(["pending_ack", "acknowledged"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
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
    body("transmittedOn").optional({ nullable: true }).isISO8601(),
    body("acknowledgedOn").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateTransmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      transmittalId: req.params.transmittalId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:transmittalId",
  [param("transmittalId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteTransmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      transmittalId: req.params.transmittalId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
