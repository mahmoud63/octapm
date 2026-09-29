const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param, query } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const { HttpError } = require("../utils/http-error");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const {
  listRfis,
  createRfi,
  updateRfi,
  submitRfi,
  answerRfi,
  closeRfi,
  reopenRfi,
  approveRfi,
  rejectRfi,
  deleteRfi,
} = require("../services/rfi.service");
const rfiWorkflow = require("../services/rfi-workflow.service");
const { boqFigureAccess, withheldAllocationLinks } = require("../utils/boq-figures");

const router = express.Router({ mergeParams: true });
router.use(authenticate);
// OCTA-AI-RFI-029: `/ai/*` and `/:rfiId/ai/*` — registered before the record routes.
router.use(require("./rfi-assistant"));

// OCTA-PM-RFI-016 fields shared by create and update.
const upgradeValidators = () => [
  body("managerUserId").optional({ nullable: true }).isUUID(),
  body("assigneeUserIds").optional().isArray({ max: rfiWorkflow.MAX_PEOPLE }),
  body("assigneeUserIds.*").isUUID(),
  body("distributionUserIds").optional().isArray({ max: rfiWorkflow.MAX_PEOPLE }),
  body("distributionUserIds.*").isUUID(),
  body("specSection").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("locationId").optional({ nullable: true }).isUUID(),
  body("costImpact").optional().isBoolean().toBoolean(),
  body("costImpactAmount").optional({ nullable: true }).isFloat({ min: 0 }),
  body("scheduleImpactFlag").optional().isBoolean().toBoolean(),
  body("question").optional({ nullable: true }).isString().trim().isLength({ max: 20000 }),
  body("discipline").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
];

const actorArgs = (req) => ({
  userId: req.user.id,
  userRole: getEffectiveRole(req),
  projectAccess: req.projectAccess,
});

router.get(
  "/",
  requirePermission("rfi", "read"),
  [
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").optional().isIn(["draft", "open", "answered", "closed", "archived"]),
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("priority").optional().isIn(["low", "normal", "high", "urgent"]),
    query("activityId").optional().isUUID(),
    query("owner").optional().isString().trim().isLength({ max: 120 }),
    query("ownerPartyId").optional().isUUID(),
    query("partyId").optional().isUUID(),
    query("managerUserId").optional({ values: "falsy" }).isUUID(),
    query("assigneeUserId").optional({ values: "falsy" }).isUUID(),
    query("ballInCourtUserId")
      .optional({ values: "falsy" })
      .matches(/^(me|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i),
    query("locationId").optional({ values: "falsy" }).isUUID(),
    query("overdue").optional().isBoolean().toBoolean(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("dueAfter").optional().isISO8601(),
    query("dueBefore").optional().isISO8601(),
    query("sortBy")
      .optional()
      .isIn([
        "created",
        "updated",
        "dueDate",
        "raisedDate",
        "responseRequiredBy",
        "answeredDate",
        "priority",
        "status",
        "ref",
      ]),
    query("sortDir").optional().isIn(["asc", "desc"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await listRfis({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query.ballInCourtUserId === "me" ? { ...req.query, ballInCourtUserId: req.user.id } : req.query,
      projectAccess: req.projectAccess,
      viewerId: req.user.id,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("rfi", "create"),
  [
    body("subject").trim().notEmpty(),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]),
    body("status").optional().isIn(["draft", "open", "answered", "closed"]),
    ...upgradeValidators(),
    body("owner").optional().isString().trim(),
    body("ownerPartyId").optional({ nullable: true }).isUUID(),
    body("reviewer").optional().isString().trim(),
    body("reviewerPartyId").optional({ nullable: true }).isUUID(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("approverPartyId").optional({ nullable: true }).isUUID(),
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
    body("raisedDate").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("responseRequiredBy").optional({ nullable: true }).isISO8601(),
    body("answeredDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row, 201);
  }),
);

// ─── OCTA-PM-RFI-016: detail, people, responses, change event, PDF ────────

router.get(
  "/:rfiId",
  requirePermission("rfi", "read"),
  [param("rfiId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await rfiWorkflow.getRfi({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, viewerId: req.user.id })),
  ),
);

router.get(
  "/:rfiId/export.pdf",
  requirePermission("rfi", "export"),
  [param("rfiId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await rfiWorkflow.exportRfiPdf({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, viewerId: req.user.id });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  }),
);

router.put(
  "/:rfiId/people",
  requirePermission("rfi", "update"),
  [
    param("rfiId").isUUID(),
    body("managerUserId").optional({ nullable: true }).isUUID(),
    body("assigneeUserIds").optional().isArray({ max: rfiWorkflow.MAX_PEOPLE }),
    body("assigneeUserIds.*").isUUID(),
    body("distributionUserIds").optional().isArray({ max: rfiWorkflow.MAX_PEOPLE }),
    body("distributionUserIds.*").isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    await updateRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      payload: {
        managerUserId: req.body.managerUserId,
        assigneeUserIds: req.body.assigneeUserIds,
        distributionUserIds: req.body.distributionUserIds,
        comment: "People updated",
      },
      ...actorArgs(req),
    });
    return sendSuccess(res, await rfiWorkflow.getRfi({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, viewerId: req.user.id }));
  }),
);

router.get(
  "/:rfiId/responses",
  requirePermission("rfi", "read"),
  [param("rfiId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await rfiWorkflow.listResponses({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, viewerId: req.user.id })),
  ),
);

router.post(
  "/:rfiId/responses",
  requirePermission("rfi", "submit"),
  [
    param("rfiId").isUUID(),
    body("body").isString().trim().isLength({ min: 1, max: 20000 }),
    body("isOfficial").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    if (req.body.isOfficial === true && !hasPermission(req, "rfi", "submit", { transition: "rfi.answer" })) {
      const forbidden = new HttpError(403, "FORBIDDEN", "You cannot give the official answer on this project");
      forbidden.details = { module: "rfi", action: "submit", transition: "rfi.answer" };
      throw forbidden;
    }
    return sendSuccess(
      res,
      await rfiWorkflow.addResponse({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, payload: req.body, ...actorArgs(req) }),
      201,
    );
  }),
);

router.patch(
  "/:rfiId/responses/:responseId",
  requirePermission("rfi", "submit"),
  [param("rfiId").isUUID(), param("responseId").isUUID(), body("body").isString().trim().isLength({ min: 1, max: 20000 }), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await rfiWorkflow.updateResponse({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, responseId: req.params.responseId, payload: req.body, ...actorArgs(req) }),
    ),
  ),
);

router.delete(
  "/:rfiId/responses/:responseId",
  requirePermission("rfi", "submit"),
  [param("rfiId").isUUID(), param("responseId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await rfiWorkflow.deleteResponse({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, responseId: req.params.responseId, ...actorArgs(req) }),
    ),
  ),
);

router.post(
  "/:rfiId/responses/:responseId/official",
  requirePermission("rfi", "submit", { transition: "rfi.answer" }),
  [param("rfiId").isUUID(), param("responseId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await rfiWorkflow.setOfficialResponse({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, responseId: req.params.responseId, ...actorArgs(req) }),
    ),
  ),
);

router.post(
  "/:rfiId/convert-to-change",
  requirePermission("change_order", "create"),
  [
    param("rfiId").isUUID(),
    body("description").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    body("category").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("value").optional({ nullable: true }).isFloat({ min: 0 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const converted = await rfiWorkflow.convertToChangeEvent({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, payload: req.body, userId: req.user.id, userRole: getEffectiveRole(req) });
    // The change order it answers with is the register's own serializer: its
    // allocation links go without their BOQ row to a caller who may not read the BOQ.
    return sendSuccess(res, { ...converted, changeOrder: withheldAllocationLinks(converted.changeOrder, boqFigureAccess(req)) }, 201);
  }),
);

router.post(
  "/:rfiId/submit",
  requirePermission("rfi", "submit", { transition: "rfi.submit" }),
  [
    param("rfiId").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await submitRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:rfiId/answer",
  requirePermission("rfi", "submit", { transition: "rfi.answer" }),
  [
    param("rfiId").isUUID(),
    body("response").trim().notEmpty(),
    body("answeredBy").optional({ nullable: true }).isString().trim(),
    body("answeredDate").optional({ nullable: true }).isISO8601(),
    body("ownerPartyId").optional({ nullable: true }).isUUID(),
    body("reviewerPartyId").optional({ nullable: true }).isUUID(),
    body("approverPartyId").optional({ nullable: true }).isUUID(),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("revisions").optional().isArray(),
    body("revision").optional().isString().trim(),
    body("projectDocumentId").optional().isUUID(),
    body("documentId").optional().isUUID(),
    body("storageKey").optional().isString().trim(),
    body("comment").optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await answerRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:rfiId/approve",
  requirePermission("rfi", "approve", { transition: "rfi.approve" }),
  [
    param("rfiId").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await approveRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:rfiId/close",
  requirePermission("rfi", "approve", { transition: "rfi.close" }),
  [param("rfiId").isUUID(), body("comment").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const row = await closeRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:rfiId/reopen",
  requirePermission("rfi", "approve", { transition: "rfi.reopen" }),
  [param("rfiId").isUUID(), body("reason").trim().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const row = await reopenRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

const rejectRfiRoute = asyncHandler(async (req, res) => {
  const row = await rejectRfi({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    rfiId: req.params.rfiId,
    reason: req.body.reason,
    userId: req.user.id,
    userRole: getEffectiveRole(req),
    projectAccess: req.projectAccess,
  });

  return sendSuccess(res, row);
});

const rejectRfiValidators = [
  param("rfiId").isUUID(),
  body("reason").trim().notEmpty(),
  validate,
];

router.post(
  "/:rfiId/reject",
  requirePermission("rfi", "approve", { transition: "rfi.reject" }),
  rejectRfiValidators,
  rejectRfiRoute,
);

router.post(
  "/:rfiId/disapprove",
  requirePermission("rfi", "approve", { transition: "rfi.reject" }),
  rejectRfiValidators,
  rejectRfiRoute,
);

router.patch(
  "/:rfiId",
  requirePermission("rfi", "update"),
  [
    param("rfiId").isUUID(),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]),
    body("status").optional().isIn(["draft", "open", "answered", "closed"]),
    ...upgradeValidators(),
    body("owner").optional().isString().trim(),
    body("ownerPartyId").optional({ nullable: true }).isUUID(),
    body("reviewer").optional().isString().trim(),
    body("reviewerPartyId").optional({ nullable: true }).isUUID(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("approverPartyId").optional({ nullable: true }).isUUID(),
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
    body("raisedDate").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("responseRequiredBy").optional({ nullable: true }).isISO8601(),
    body("answeredDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:rfiId",
  requirePermission("rfi", "delete"),
  [param("rfiId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteRfi({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      rfiId: req.params.rfiId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
