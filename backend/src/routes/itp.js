const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { lockIfIssued } = require("../middleware/external-review-lock");
const { validate } = require("../middleware/validate");
const { requirePermission } = require("../middleware/rbac");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const {
  listItps,
  createItp,
  updateItp,
  deleteItp,
} = require("../services/itp.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("inspection", "read"),
  asyncHandler(async (req, res) => {
    const data = await listItps({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("inspection", "create"),
  [
    body("title").isString().trim().notEmpty(),
    body("pointType").optional().isIn(["hold", "witness", "review"]),
    body("status").optional().isIn(["pending", "passed", "failed", "waived"]),
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
    body("comment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
    body("inspectionDate").optional({ nullable: true }).isString().custom(dateInput),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("inspector").optional({ nullable: true }).isString(),
    body("notes").optional({ nullable: true }).isString(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createItp({
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
  "/:itpId",
  requirePermission("inspection", "update"),
  lockIfIssued("itp", "itpId"),
  [
    param("itpId").isUUID(),
    body("pointType").optional().isIn(["hold", "witness", "review"]),
    body("status").optional().isIn(["pending", "passed", "failed", "waived"]),
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
    body("comment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
    body("inspectionDate").optional({ nullable: true }).isString().custom(dateInput),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("inspector").optional({ nullable: true }).isString(),
    body("notes").optional({ nullable: true }).isString(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateItp({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itpId: req.params.itpId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:itpId",
  requirePermission("inspection", "delete"),
  [param("itpId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteItp({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itpId: req.params.itpId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
