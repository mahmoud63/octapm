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
  listTransmittals,
  createTransmittal,
  updateTransmittal,
  deleteTransmittal,
} = require("../services/transmittal.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("document_control", "read"),
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
  requirePermission("document_control", "create"),
  [
    body("subject").isString().trim().notEmpty(),
    body("sender").isString().trim().notEmpty(),
    body("recipient").isString().trim().notEmpty(),
    // The reference and the notes are text too (CERT-2, robustness-6): an
    // array as the ref reached the write after the register's next number had
    // been drawn, and notes as an object failed in the service's trim() (500).
    body("ref").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body("notes").optional({ nullable: true }).isString(),
    body("method").optional().isIn(["email", "courier", "hand"]),
    body("status").optional().isIn(["pending_ack", "acknowledged"]),
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
    body("dueDate").optional({ nullable: true }).custom(dateInput),
    body("transmittedOn").optional({ nullable: true }).custom(dateInput),
    body("acknowledgedOn").optional({ nullable: true }).custom(dateInput),
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
  requirePermission("document_control", "update"),
  [
    param("transmittalId").isUUID(),
    // What the service writes as text, checked as text (CERT-2, robustness-6):
    // an object as the subject was read by Prisma as an update operation
    // ("Unknown argument"), notes as an object failed in trim() (500).
    body("subject").optional().isString(),
    body("sender").optional().isString(),
    body("recipient").optional().isString(),
    body("notes").optional({ nullable: true }).isString(),
    body("method").optional().isIn(["email", "courier", "hand"]),
    body("status").optional().isIn(["pending_ack", "acknowledged"]),
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
    body("dueDate").optional({ nullable: true }).custom(dateInput),
    body("transmittedOn").optional({ nullable: true }).custom(dateInput),
    body("acknowledgedOn").optional({ nullable: true }).custom(dateInput),
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
  requirePermission("document_control", "update"),
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
