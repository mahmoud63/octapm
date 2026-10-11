const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param, query } = require("express-validator");
const { scalarFigure, MONEY_FIGURE_MAX } = require("../utils/figure-input");
const { dateInput } = require("../utils/date-input");
const { authenticate } = require("../middleware/auth");
const { HttpError } = require("../utils/http-error");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { lockIfIssued } = require("../middleware/external-review-lock");
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The assistant's record routes (`/:rfiId/ai/*`) load the RFI themselves: its
// party routing and draft privacy are checked here first, as on every other
// by-id RFI route (certification finding L42) — but only for a caller the
// route itself lets through. A caller without the route's permissions gets
// the route's own refusal, whether the RFI exists or not (review finding R11:
// a missing id answered 404 and an existing one 403). An assistant record
// route not listed here is guarded on rfi read. A malformed id is left to the
// assistant route's own validator.
const ASSISTANT_RECORD_RFI_ACTIONS = Object.freeze({ "/summary": "read", "/response": "submit" });
const assistantRecordAllowed = (req) => {
  const route = String(req.path || "").replace(/\/+$/, "").toLowerCase();
  return hasPermission(req, "assistant", "read") && hasPermission(req, "rfi", ASSISTANT_RECORD_RFI_ACTIONS[route] || "read");
};
router.use(
  "/:rfiId/ai",
  asyncHandler(async (req, _res, next) => {
    if (UUID_PATTERN.test(req.params.rfiId || "") && assistantRecordAllowed(req)) {
      await rfiWorkflow.assertRfiVisible({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, projectAccess: req.projectAccess, viewerId: req.user.id });
    }
    next();
  }),
);
// OCTA-AI-RFI-029: `/ai/*` and `/:rfiId/ai/*` — registered before the record routes.
router.use(require("./rfi-assistant"));

// OCTA-PM-RFI-016 fields shared by create and update.
const upgradeValidators = () => [
  body("managerUserId").optional({ nullable: true }).isString().isUUID(),
  body("assigneeUserIds").optional().isArray({ max: rfiWorkflow.MAX_PEOPLE }),
  body("assigneeUserIds.*").isString().isUUID(),
  body("distributionUserIds").optional().isArray({ max: rfiWorkflow.MAX_PEOPLE }),
  body("distributionUserIds.*").isString().isUUID(),
  body("specSection").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("locationId").optional({ nullable: true }).isString().isUUID(),
  body("costImpact").optional().isBoolean().toBoolean(),
  body("costImpactAmount").optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: MONEY_FIGURE_MAX }),
  body("scheduleImpactFlag").optional().isBoolean().toBoolean(),
  body("question").optional({ nullable: true }).isString().trim().isLength({ max: 20000 }),
  body("discipline").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
];

const actorArgs = (req) => ({
  userId: req.user.id,
  userRole: getEffectiveRole(req),
  projectAccess: req.projectAccess,
});

// The caller's own transition check, for a status or answer sent straight to
// create / update (certification finding L40): the service decides which
// transition the change needs, this answers whether the caller holds it.
const canTransition = (req) => (action, transition) => hasPermission(req, "rfi", action, { transition });
const viewArgs = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, viewerId: req.user.id, projectAccess: req.projectAccess });

router.get(
  "/",
  requirePermission("rfi", "read"),
  [
    query("cursor").isString().optional().isUUID(),
    query("limit").isString().optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").isString().optional().isIn(["draft", "open", "answered", "closed", "archived"]),
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
    query("priority").isString().optional().isIn(["low", "normal", "high", "urgent"]),
    query("activityId").isString().optional().isUUID(),
    query("owner").optional().isString().trim().isLength({ max: 120 }),
    query("ownerPartyId").isString().optional().isUUID(),
    query("partyId").isString().optional().isUUID(),
    query("managerUserId").isString().optional({ values: "falsy" }).isUUID(),
    query("assigneeUserId").isString().optional({ values: "falsy" }).isUUID(),
    query("ballInCourtUserId").isString()
      .optional({ values: "falsy" })
      .matches(/^(me|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i),
    query("locationId").isString().optional({ values: "falsy" }).isUUID(),
    query("overdue").isString().optional().isBoolean().toBoolean(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("dueAfter").isString().optional().custom(dateInput),
    query("dueBefore").isString().optional().custom(dateInput),
    query("sortBy").isString()
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
    query("sortDir").isString().optional().isIn(["asc", "desc"]),
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
    body("subject").isString().trim().notEmpty(),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]),
    body("status").optional().isIn(["draft", "open", "answered", "closed"]),
    ...upgradeValidators(),
    body("owner").optional().isString().trim(),
    body("ownerPartyId").optional({ nullable: true }).isString().isUUID(),
    body("reviewer").optional().isString().trim(),
    body("reviewerPartyId").optional({ nullable: true }).isString().isUUID(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("approverPartyId").optional({ nullable: true }).isString().isUUID(),
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
    body("raisedDate").optional({ nullable: true }).isString().custom(dateInput),
    body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
    body("responseRequiredBy").optional({ nullable: true }).isString().custom(dateInput),
    body("answeredDate").optional({ nullable: true }).isString().custom(dateInput),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("response").optional({ nullable: true }).isString(),
    body("raisedBy").optional({ nullable: true }).isString(),
    body("answeredBy").optional({ nullable: true }).isString(),
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
      canTransition: canTransition(req),
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
    sendSuccess(res, await rfiWorkflow.getRfi(viewArgs(req))),
  ),
);

router.get(
  "/:rfiId/export.pdf",
  requirePermission("rfi", "export"),
  [param("rfiId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await rfiWorkflow.exportRfiPdf(viewArgs(req));
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
    body("managerUserId").optional({ nullable: true }).isString().isUUID(),
    body("assigneeUserIds").optional().isArray({ max: rfiWorkflow.MAX_PEOPLE }),
    body("assigneeUserIds.*").isString().isUUID(),
    body("distributionUserIds").optional().isArray({ max: rfiWorkflow.MAX_PEOPLE }),
    body("distributionUserIds.*").isString().isUUID(),
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
    return sendSuccess(res, await rfiWorkflow.getRfi(viewArgs(req)));
  }),
);

router.get(
  "/:rfiId/responses",
  requirePermission("rfi", "read"),
  [param("rfiId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await rfiWorkflow.listResponses(viewArgs(req))),
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
    body("value").optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: MONEY_FIGURE_MAX }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const converted = await rfiWorkflow.convertToChangeEvent({ orgId: req.user.orgId, projectId: req.params.projectId, rfiId: req.params.rfiId, payload: req.body, ...actorArgs(req) });
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
    body("response").isString().trim().notEmpty(),
    body("answeredBy").optional({ nullable: true }).isString().trim(),
    body("answeredDate").optional({ nullable: true }).isString().custom(dateInput),
    body("ownerPartyId").optional({ nullable: true }).isString().isUUID(),
    body("reviewerPartyId").optional({ nullable: true }).isString().isUUID(),
    body("approverPartyId").optional({ nullable: true }).isString().isUUID(),
    body("activityId").optional({ nullable: true }).isString().isUUID(),
    body("activityIds").optional().isArray(),
    body("activityIds.*").optional().isString().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("attachments").optional().isArray(),
    body("attachmentRefs").optional().isArray(),
    body("revisions").optional().isArray(),
    body("revision").optional().isString().trim(),
    body("projectDocumentId").optional().isString().isUUID(),
    body("documentId").optional().isString().isUUID(),
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
  [param("rfiId").isUUID(), body("comment").isString().trim().notEmpty(), validate],
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
  [param("rfiId").isUUID(), body("reason").isString().trim().notEmpty(), validate],
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
  body("reason").isString().trim().notEmpty(),
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
  lockIfIssued("rfi", "rfiId"),
  [
    param("rfiId").isUUID(),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]),
    body("status").optional().isIn(["draft", "open", "answered", "closed"]),
    ...upgradeValidators(),
    body("owner").optional().isString().trim(),
    body("ownerPartyId").optional({ nullable: true }).isString().isUUID(),
    body("reviewer").optional().isString().trim(),
    body("reviewerPartyId").optional({ nullable: true }).isString().isUUID(),
    body("approver").optional().isString().trim(),
    ...assignmentReferenceValidators(),
    body("approverPartyId").optional({ nullable: true }).isString().isUUID(),
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
    body("raisedDate").optional({ nullable: true }).isString().custom(dateInput),
    body("dueDate").optional({ nullable: true }).isString().custom(dateInput),
    body("responseRequiredBy").optional({ nullable: true }).isString().custom(dateInput),
    body("answeredDate").optional({ nullable: true }).isString().custom(dateInput),
    // Text the service trims (CERT-2, robustness-6): an object, an array, a number or a
    // boolean here failed in its trim() with a TypeError (500), or reached Prisma.
    body("response").optional({ nullable: true }).isString(),
    body("raisedBy").optional({ nullable: true }).isString(),
    body("answeredBy").optional({ nullable: true }).isString(),
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
      canTransition: canTransition(req),
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
      ...actorArgs(req),
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
