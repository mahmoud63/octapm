const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const {
  listNcrs,
  createNcr,
  updateNcr,
  submitNcrCloseout,
  closeNcr,
  approveNcr,
  rejectNcr,
  reopenNcr,
  deleteNcr,
} = require("../services/ncr.service");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const ncrCloseoutValidators = [
  param("ncrId").isUUID(),
  body("responsible").optional().isString().trim(),
  body("owner").optional().isString().trim(),
  body("dueDate").optional({ nullable: true }).isISO8601(),
  body("closureComment").optional().isString().trim(),
  body("comment").optional().isString().trim(),
  body("statusComment").optional().isString().trim(),
  body("activityId").optional({ nullable: true }).isUUID(),
  body("activityIds").optional().isArray(),
  body("activityIds.*").optional().isUUID(),
  body("activityLinks").optional().isArray(),
  body("activityLinks.*.activityId").optional().isUUID(),
  body("attachments").optional().isArray(),
  body("attachmentRefs").optional().isArray(),
  validate,
];

router.get(
  "/",
  requirePermission("ncr", "read"),
  asyncHandler(async (req, res) => {
    const data = await listNcrs({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("ncr", "create"),
  [
    body("severity").optional().isIn(["major", "minor"]),
    body("status").optional().isIn(["open"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    body("responsible").optional().isString().trim(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("closureComment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createNcr({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row, 201);
  }),
);

router.post(
  "/:ncrId/submit",
  requirePermission("ncr", "submit", { transition: "ncr.submit" }),
  ncrCloseoutValidators,
  asyncHandler(async (req, res) => {
    const row = await submitNcrCloseout({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      ncrId: req.params.ncrId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:ncrId/close",
  requirePermission("ncr", "submit", { transition: "ncr.close" }),
  ncrCloseoutValidators,
  asyncHandler(async (req, res) => {
    const row = await closeNcr({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      ncrId: req.params.ncrId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:ncrId/approve",
  requirePermission("ncr", "approve", { transition: "ncr.approve" }),
  [
    param("ncrId").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await approveNcr({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      ncrId: req.params.ncrId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

const rejectNcrRoute = asyncHandler(async (req, res) => {
  const row = await rejectNcr({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    ncrId: req.params.ncrId,
    reason: req.body.reason,
    userId: req.user.id,
    userRole: getEffectiveRole(req),
  });

  return sendSuccess(res, row);
});

const rejectNcrValidators = [
  param("ncrId").isUUID(),
  body("reason").trim().notEmpty(),
  validate,
];

router.post(
  "/:ncrId/reject",
  requirePermission("ncr", "approve", { transition: "ncr.reject" }),
  rejectNcrValidators,
  rejectNcrRoute,
);

router.post(
  "/:ncrId/disapprove",
  requirePermission("ncr", "approve", { transition: "ncr.reject" }),
  rejectNcrValidators,
  rejectNcrRoute,
);

router.patch(
  "/:ncrId",
  requirePermission("ncr", "update"),
  [
    param("ncrId").isUUID(),
    body("severity").optional().isIn(["major", "minor"]),
    body("status").optional().isIn(["open"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    body("responsible").optional().isString().trim(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("closureComment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("closedDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateNcr({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      ncrId: req.params.ncrId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:ncrId/reopen",
  requirePermission("ncr", "approve", { transition: "ncr.reopen" }),
  [param("ncrId").isUUID(), body("reason").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const row = await reopenNcr({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      ncrId: req.params.ncrId,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:ncrId",
  requirePermission("ncr", "delete"),
  [param("ncrId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteNcr({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      ncrId: req.params.ncrId,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
