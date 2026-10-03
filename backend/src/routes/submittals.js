const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param, query } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const {
  assignmentReferenceValidators,
} = require("../utils/assignment-validators");
const {
  listSubmittals,
  createSubmittal,
  updateSubmittal,
  submitSubmittal,
  reviewSubmittal,
  resubmitSubmittal,
  approveSubmittal,
  rejectSubmittal,
  deleteSubmittal,
} = require("../services/submittal.service");
const submittalWorkflow = require("../services/submittal-workflow.service");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const actorArgs = (req) => ({ userId: req.user.id, userRole: getEffectiveRole(req), projectAccess: req.projectAccess });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
// Party routing of packages and records (certification findings L42 / FILES-X1).
const partyScope = (req) => ({ ...scope(req), projectAccess: req.projectAccess, viewerId: req.user.id });
// The caller's own transition check, for a status or review outcome sent
// straight to create / update (finding L40): the service decides which
// transition the change needs, this answers whether the caller holds it.
const canTransition = (req) => (action, transition) => hasPermission(req, "submittal", action, { transition });
// Who may change the project's review routes (finding X-PARTY-2): the service decides from these.
const routeAdmin = (req) => ({
  projectAccess: req.projectAccess,
  canManageWorkflows: hasPermission(req, "workflow", "update", { transition: "workflow.manage" }),
  canReviewSubmittals: hasPermission(req, "submittal", "submit", { transition: "submittal.review" }),
});

// OCTA-PM-SUB-017 fields shared by create and update.
const upgradeValidators = () => [
  body("packageId").optional({ nullable: true }).isUUID(),
  body("workflowTemplateId").optional({ nullable: true }).isUUID(),
  body("leadTimeWeeks").optional({ nullable: true }).isInt({ min: 0, max: 104 }),
  body("reviewDays").optional({ nullable: true }).isInt({ min: 0, max: 365 }),
  body("requiredOnSite").optional({ nullable: true }).isISO8601(),
  body("managerUserId").optional({ nullable: true }).isUUID(),
  body("distributionUserIds").optional().isArray({ max: 20 }),
  body("distributionUserIds.*").isUUID(),
  body("discipline").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("specRef").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("revision").optional({ nullable: true }).isString().trim().isLength({ max: 20 }),
];

const templateValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 120 }) : body("name").optional().isString().trim().notEmpty().isLength({ max: 120 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("isDefault").optional().isBoolean().toBoolean(),
  body("status").optional().isIn(["active", "archived"]),
  body("steps").optional().isArray({ max: 12 }),
  body("steps.*.name").optional().isString(),
  body("steps.*.mode").optional().isIn(["sequential", "parallel"]),
  body("steps.*.days").optional().isInt({ min: 0, max: 365 }).toInt(),
  body("steps.*.assignees").optional().isArray({ max: 20 }),
];

const decisionValidators = [
  body("decision").isIn(["approve", "reject"]),
  body("responseCode").optional().isIn(["approved", "approved_as_noted", "revise_resubmit", "rejected", "custom"]),
  body("responseCodeLabel").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("comment").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
];

router.get(
  "/",
  requirePermission("submittal", "read"),
  [
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("packageId").optional({ values: "falsy" }).isUUID(),
    query("managerUserId").optional({ values: "falsy" }).isUUID(),
    query("workflowTemplateId").optional({ values: "falsy" }).isUUID(),
    query("ballInCourtUserId")
      .optional({ values: "falsy" })
      .matches(/^(me|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i),
    query("responseCode").optional().isIn(["approved", "approved_as_noted", "revise_resubmit", "rejected", "custom"]),
    query("overdue").optional().isBoolean().toBoolean(),
    query("status")
      .optional()
      .isIn([
        "pending",
        "under_review",
        "approved",
        "resubmit",
        "rejected",
        "archived",
      ]),
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("activityId").optional().isUUID(),
    query("owner").optional().isString().trim().isLength({ max: 120 }),
    query("ownerPartyId").optional().isUUID(),
    query("partyId").optional().isUUID(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("dueAfter").optional().isISO8601(),
    query("dueBefore").optional().isISO8601(),
    query("sortBy")
      .optional()
      .isIn([
        "created",
        "updated",
        "dueDate",
        "submittedOn",
        "reviewedOn",
        "status",
        "ref",
        "title",
      ]),
    query("sortDir").optional().isIn(["asc", "desc"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await listSubmittals({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query.ballInCourtUserId === "me" ? { ...req.query, ballInCourtUserId: req.user.id } : req.query,
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, data);
  }),
);

// ─── OCTA-PM-SUB-017: packages and workflow templates (static paths first) ──

router.get(
  "/packages",
  requirePermission("submittal", "read"),
  [query("status").optional().isIn(["open", "submitted", "closed"]), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.listPackages({ ...partyScope(req), query: req.query }))),
);

router.post(
  "/packages",
  requirePermission("submittal", "create"),
  [
    body("name").isString().trim().notEmpty().isLength({ max: 160 }),
    body("description").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("requiredOnSite").optional({ nullable: true }).isISO8601(),
    body("managerUserId").optional({ nullable: true }).isUUID(),
    body("submittalIds").optional().isArray({ max: 200 }),
    body("submittalIds.*").isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.createPackage({ ...scope(req), payload: req.body, actor: actor(req), projectAccess: req.projectAccess }), 201)),
);

router.get(
  "/packages/:packageId",
  requirePermission("submittal", "read"),
  [param("packageId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.getPackage({ ...partyScope(req), packageId: req.params.packageId }))),
);

router.patch(
  "/packages/:packageId",
  requirePermission("submittal", "update"),
  [
    param("packageId").isUUID(),
    body("name").optional().isString().trim().notEmpty().isLength({ max: 160 }),
    body("description").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("requiredOnSite").optional({ nullable: true }).isISO8601(),
    body("managerUserId").optional({ nullable: true }).isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.updatePackage({ ...scope(req), packageId: req.params.packageId, payload: req.body, actor: actor(req), projectAccess: req.projectAccess }))),
);

router.post(
  "/packages/:packageId/items",
  requirePermission("submittal", "update"),
  [param("packageId").isUUID(), body("submittalIds").isArray({ min: 1, max: 200 }), body("submittalIds.*").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.addPackageItems({ ...scope(req), packageId: req.params.packageId, submittalIds: req.body.submittalIds, actor: actor(req), projectAccess: req.projectAccess }))),
);

router.delete(
  "/packages/:packageId/items/:submittalId",
  requirePermission("submittal", "update"),
  [param("packageId").isUUID(), param("submittalId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.removePackageItem({ ...scope(req), packageId: req.params.packageId, submittalId: req.params.submittalId, actor: actor(req), projectAccess: req.projectAccess }))),
);

router.post(
  "/packages/:packageId/submit",
  requirePermission("submittal", "submit", { transition: "submittal.submit" }),
  [param("packageId").isUUID(), body("comment").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.submitPackage({ ...scope(req), packageId: req.params.packageId, payload: req.body, ...actorArgs(req) }))),
);

router.post(
  "/packages/:packageId/decide",
  requirePermission("submittal", "submit", { transition: "submittal.review" }),
  [param("packageId").isUUID(), ...decisionValidators, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.decidePackage({ ...scope(req), packageId: req.params.packageId, payload: req.body, ...actorArgs(req) }))),
);

router.get(
  "/workflow-templates",
  requirePermission("submittal", "read"),
  [query("scope").optional().isIn(["all", "project", "company"]), query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.listTemplates({ ...scope(req), query: req.query }))),
);

router.post(
  "/workflow-templates",
  requirePermission("submittal", "update"),
  [...templateValidators({ requireName: true }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.createTemplate({ ...scope(req), payload: req.body, actor: actor(req), access: routeAdmin(req) }), 201)),
);

router.patch(
  "/workflow-templates/:templateId",
  requirePermission("submittal", "update"),
  [param("templateId").isUUID(), ...templateValidators(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.updateTemplate({ ...scope(req), templateId: req.params.templateId, payload: req.body, actor: actor(req), access: routeAdmin(req) }))),
);

router.delete(
  "/workflow-templates/:templateId",
  requirePermission("submittal", "update"),
  [param("templateId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.archiveTemplate({ ...scope(req), templateId: req.params.templateId, actor: actor(req), access: routeAdmin(req) }))),
);

router.post(
  "/",
  requirePermission("submittal", "create"),
  [
    body("title").trim().notEmpty(),
    body("status")
      .optional()
      .isIn(["pending", "under_review", "approved", "resubmit", "rejected"]),
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
    body("submittedOn").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("reviewedOn").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createSubmittal({
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

const submittalEvidenceValidators = [
  body("activityId").optional({ nullable: true }).isUUID(),
  body("activityIds").optional().isArray(),
  body("activityIds.*").optional().isUUID(),
  body("activityLinks").optional().isArray(),
  body("activityLinks.*.activityId").optional().isUUID(),
  body("ownerPartyId").optional({ nullable: true }).isUUID(),
  body("reviewerPartyId").optional({ nullable: true }).isUUID(),
  body("approverPartyId").optional({ nullable: true }).isUUID(),
  body("attachments").optional().isArray(),
  body("attachmentRefs").optional().isArray(),
  body("revisions").optional().isArray(),
  body("revision").optional().isString().trim(),
  body("projectDocumentId").optional().isUUID(),
  body("documentId").optional().isUUID(),
  body("storageKey").optional().isString().trim(),
  body("remarks").optional({ nullable: true }).isString().trim(),
  body("comment").optional({ nullable: true }).isString().trim(),
  body("submittedOn").optional({ nullable: true }).isISO8601(),
  body("reviewedOn").optional({ nullable: true }).isISO8601(),
];

router.get(
  "/:submittalId",
  requirePermission("submittal", "read"),
  [param("submittalId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.getSubmittal({ ...scope(req), submittalId: req.params.submittalId, projectAccess: req.projectAccess }))),
);

router.post(
  "/:submittalId/decide",
  requirePermission("submittal", "submit", { transition: "submittal.review" }),
  [param("submittalId").isUUID(), ...decisionValidators, validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await submittalWorkflow.decideStep({ ...scope(req), submittalId: req.params.submittalId, payload: req.body, userId: req.user.id, userRole: getEffectiveRole(req) })),
  ),
);

router.put(
  "/:submittalId/people",
  requirePermission("submittal", "update"),
  [
    param("submittalId").isUUID(),
    body("managerUserId").optional({ nullable: true }).isUUID(),
    body("distributionUserIds").optional().isArray({ max: 20 }),
    body("distributionUserIds.*").isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    await updateSubmittal({
      ...scope(req),
      submittalId: req.params.submittalId,
      payload: { managerUserId: req.body.managerUserId, distributionUserIds: req.body.distributionUserIds, comment: "People updated" },
      ...actorArgs(req),
    });
    return sendSuccess(res, await submittalWorkflow.getSubmittal({ ...scope(req), submittalId: req.params.submittalId, projectAccess: req.projectAccess }));
  }),
);

router.post(
  "/:submittalId/submit",
  requirePermission("submittal", "submit", {
    transition: "submittal.submit",
  }),
  [param("submittalId").isUUID(), ...submittalEvidenceValidators, validate],
  asyncHandler(async (req, res) => {
    const row = await submitSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:submittalId/review",
  requirePermission("submittal", "submit", {
    transition: "submittal.review",
  }),
  [
    param("submittalId").isUUID(),
    body("comment").trim().notEmpty(),
    body("remarks").optional({ nullable: true }).isString().trim(),
    body("reviewedOn").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await reviewSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:submittalId/resubmit",
  requirePermission("submittal", "submit", {
    transition: "submittal.resubmit",
  }),
  [
    param("submittalId").isUUID(),
    body("reason").optional({ nullable: true }).isString().trim(),
    ...submittalEvidenceValidators,
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await resubmitSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/:submittalId/approve",
  requirePermission("submittal", "approve", {
    transition: "submittal.approve",
  }),
  [
    param("submittalId").isUUID(),
    body("comment").optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await approveSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess,
    });

    return sendSuccess(res, row);
  }),
);

const rejectSubmittalRoute = asyncHandler(async (req, res) => {
  const row = await rejectSubmittal({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    submittalId: req.params.submittalId,
    reason: req.body.reason,
    userId: req.user.id,
    userRole: getEffectiveRole(req),
    projectAccess: req.projectAccess,
  });

  return sendSuccess(res, row);
});

const rejectSubmittalValidators = [
  param("submittalId").isUUID(),
  body("reason").trim().notEmpty(),
  validate,
];

router.post(
  "/:submittalId/reject",
  requirePermission("submittal", "approve", {
    transition: "submittal.reject",
  }),
  rejectSubmittalValidators,
  rejectSubmittalRoute,
);

router.post(
  "/:submittalId/disapprove",
  requirePermission("submittal", "approve", {
    transition: "submittal.reject",
  }),
  rejectSubmittalValidators,
  rejectSubmittalRoute,
);

router.patch(
  "/:submittalId",
  requirePermission("submittal", "update"),
  [
    param("submittalId").isUUID(),
    body("status")
      .optional()
      .isIn(["pending", "under_review", "approved", "resubmit", "rejected"]),
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
    body("submittedOn").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    body("reviewedOn").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
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
  "/:submittalId",
  requirePermission("submittal", "delete"),
  [param("submittalId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteSubmittal({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      submittalId: req.params.submittalId,
      ...actorArgs(req),
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
