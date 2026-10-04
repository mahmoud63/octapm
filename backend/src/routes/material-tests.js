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
  listMaterialTests,
  createMaterialTest,
  updateMaterialTest,
  deleteMaterialTest,
} = require("../services/material-test.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("inspection", "read"),
  asyncHandler(async (req, res) => {
    const data = await listMaterialTests({
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
    body("testType").trim().notEmpty(),
    body("result").optional().isIn(["pass", "fail", "pending"]),
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
    body("dueDate").optional({ nullable: true }).isString().isISO8601(),
    body("testDate").optional({ nullable: true }).isString().isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createMaterialTest({
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
  "/:testId",
  requirePermission("inspection", "update"),
  [
    param("testId").isUUID(),
    body("result").optional().isIn(["pass", "fail", "pending"]),
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
    body("dueDate").optional({ nullable: true }).isString().isISO8601(),
    body("testDate").optional({ nullable: true }).isString().isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateMaterialTest({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      testId: req.params.testId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:testId",
  requirePermission("inspection", "delete"),
  [param("testId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteMaterialTest({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      testId: req.params.testId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
