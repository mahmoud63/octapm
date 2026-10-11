const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission, requirePermissionOr } = require("../middleware/rbac");
const { prisma } = require("../config/db");
const { lockIfIssued } = require("../middleware/external-review-lock");
const { validate } = require("../middleware/validate");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
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
  body("assigneeUserId").optional({ nullable: true }).isString().isUUID(),
  body("assigneeCompanyId").optional({ nullable: true }).isString().isUUID(),
  body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
  body("closureComment").optional().isString().trim(),
  body("comment").optional().isString().trim(),
  body("statusComment").optional().isString().trim(),
  body("activityId").optional({ nullable: true }).isString().isUUID(),
  body("activityIds").optional().isArray(),
  body("activityIds.*").optional().isString().isUUID(),
  body("activityLinks").optional().isArray(),
  body("activityLinks.*.activityId").optional().isString().isUUID(),
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
    body("ref").optional({ nullable: true }).isString(),
    body("severity").optional().isIn(["major", "minor"]),
    body("status").optional().isIn(["open"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    body("responsible").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("activityId").optional({ nullable: true }).isString().isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isString().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("closureComment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("description").optional({ nullable: true }).isString(),
    body("disposition").optional({ nullable: true }).isString(),
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

// The person the NCR is assigned to may submit its closeout whatever their role
// (Phase 22B): a procurement lead answering for a material defect, a site
// engineer for a pour. Approval stays with the quality engineer.
const isNcrAssignee = async (req) => {
  const row = await prisma.ncrRecord.findFirst({
    where: { id: req.params.ncrId, projectId: req.params.projectId },
    select: { assigneeUserId: true },
  });
  return Boolean(row?.assigneeUserId) && row.assigneeUserId === req.user.id;
};

router.post(
  "/:ncrId/submit",
  requirePermissionOr("ncr", "submit", { transition: "ncr.submit" }, isNcrAssignee),
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
  requirePermissionOr("ncr", "submit", { transition: "ncr.close" }, isNcrAssignee),
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
  body("reason").isString().trim().notEmpty(),
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
  lockIfIssued("ncr", "ncrId"),
  [
    param("ncrId").isUUID(),
    body("severity").optional().isIn(["major", "minor"]),
    body("status").optional().isIn(["open"]),
    body("owner").optional().isString().trim(),
    body("reviewer").optional().isString().trim(),
    body("approver").optional().isString().trim(),
    body("responsible").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("activityId").optional({ nullable: true }).isString().isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isString().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("comment").optional().isString().trim(),
    body("closureComment").optional().isString().trim(),
    body("statusComment").optional().isString().trim(),
    body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
    body("closedDate").optional({ nullable: true }).isString().custom(dateInput),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("description").optional({ nullable: true }).isString(),
    body("disposition").optional({ nullable: true }).isString(),
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
  [param("ncrId").isUUID(), body("reason").isString().trim().notEmpty(), validate],
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
