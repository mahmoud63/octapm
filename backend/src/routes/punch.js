const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const punchService = require("../services/punch.service");

/**
 * Punch list (OCTA-FLD-PUNCH-013), mounted at /projects/:projectId/punch.
 * Reads are scoped to the caller's company for party users; state changes
 * map to `punch.*` transitions on the punch module.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const TRANSITION_PERMISSION = Object.freeze({
  open: ["submit", "punch.open"],
  ready_for_review: ["submit", "punch.ready_for_review"],
  close: ["approve", "punch.close"],
  reopen: ["submit", "punch.reopen"],
  dispute: ["submit", "punch.dispute"],
  resolve_dispute: ["submit", "punch.reopen"],
  void: ["approve", "punch.void"],
});

const actorFor = (req) => ({
  id: req.user.id,
  name: req.user.name || null,
  role: getEffectiveRole(req),
  projectAccess: req.projectAccess || null,
});

const REFERENCE_FIELDS = Object.freeze(["locationId", "sheetId", "activityId", "assigneeCompanyId", "assigneeUserId", "managerUserId", "finalApproverUserId"]);

const itemValidators = (partial = false) => [
  partial ? body("title").optional().isString().trim().isLength({ min: 1, max: 200 }) : body("title").isString().trim().isLength({ min: 1, max: 200 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
  body("priority").optional().isIn(punchService.PRIORITIES),
  body("kind").optional().isIn(punchService.KINDS),
  body("clientRequestId").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("observationType").optional({ nullable: true }).isIn(punchService.OBSERVATION_TYPES),
  body("hazard").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("contributingCondition").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  body("sourceRecordType").optional({ nullable: true }).isString().trim().isLength({ max: 60 }),
  body("sourceRecordId").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("trade").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("locationText").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body("locationId").optional({ nullable: true }).isUUID(),
  body("sheetId").optional({ nullable: true }).isUUID(),
  body("activityId").optional({ nullable: true }).isUUID(),
  body("assigneeCompanyId").optional({ nullable: true }).isUUID(),
  body("assigneeUserId").optional({ nullable: true }).isUUID(),
  body("managerUserId").optional({ nullable: true }).isUUID(),
  body("finalApproverUserId").optional({ nullable: true }).isUUID(),
  body("dueDate").optional({ nullable: true }).isISO8601(),
  body("status").optional().isIn(["draft", "open"]),
  body("activityIds").optional().isArray(),
  body("activityIds.*").optional().isUUID(),
  body("activityLinks").optional().isArray(),
  body("attachmentRefs").optional().isArray(),
];

const filterValidators = () => [
  query("kind").optional().isIn([...punchService.KINDS, "all"]),
  query("observationType").optional().isIn(punchService.OBSERVATION_TYPES),
  query("status").optional().isString().trim().isLength({ max: 120 }),
  query("assigneeCompanyId").optional({ values: "falsy" }).isUUID(),
  query("assigneeUserId").optional({ values: "falsy" }).isUUID(),
  query("managerUserId").optional({ values: "falsy" }).isUUID(),
  query("finalApproverUserId").optional({ values: "falsy" }).isUUID(),
  query("ballInCourtUserId")
    .optional({ values: "falsy" })
    .matches(/^(me|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
    .withMessage("ballInCourtUserId must be a user id or `me`"),
  query("locationId").optional({ values: "falsy" }).isUUID(),
  query("sheetId").optional({ values: "falsy" }).isUUID(),
  query("trade").optional().isString().trim().isLength({ max: 80 }),
  query("priority").optional().isIn(punchService.PRIORITIES),
  query("overdue").optional().isBoolean().toBoolean(),
  query("search").optional().isString().trim().isLength({ max: 120 }),
  query("limit").optional().isInt({ min: 1, max: 1000 }).toInt(),
];

const filtersFrom = (req) => ({
  kind: req.query.kind || "punch",
  observationType: req.query.observationType || null,
  status: req.query.status || null,
  assigneeCompanyId: req.query.assigneeCompanyId || null,
  assigneeUserId: req.query.assigneeUserId || null,
  managerUserId: req.query.managerUserId || null,
  finalApproverUserId: req.query.finalApproverUserId || null,
  ballInCourtUserId: req.query.ballInCourtUserId === "me" ? req.user.id : req.query.ballInCourtUserId || null,
  locationId: req.query.locationId || null,
  sheetId: req.query.sheetId || null,
  trade: req.query.trade || null,
  priority: req.query.priority || null,
  overdue: req.query.overdue === true,
  search: req.query.search || null,
  limit: req.query.limit || undefined,
});

router.get(
  "/",
  requirePermission("punch", "read"),
  [...filterValidators(), validate],
  asyncHandler(async (req, res) => {
    const result = await punchService.listPunchItems({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      filters: filtersFrom(req),
      viewer: actorFor(req),
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/export.pdf",
  requirePermission("punch", "export"),
  [
    ...filterValidators(),
    query("groupBy").optional().isIn(["company", "location", "none"]),
    query("includePhotos").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await punchService.exportPunchListPdf({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      filters: filtersFrom(req),
      groupBy: req.query.groupBy || "company",
      includePhotos: req.query.includePhotos === true,
      viewer: actorFor(req),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    return res.send(result.buffer);
  }),
);

router.get(
  "/export.csv",
  requirePermission("punch", "export"),
  [...filterValidators(), validate],
  asyncHandler(async (req, res) => {
    const result = await punchService.exportPunchListCsv({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      filters: filtersFrom(req),
      viewer: actorFor(req),
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    return res.send(result.csv);
  }),
);

router.post(
  "/",
  requirePermission("punch", "create"),
  [...itemValidators(), validate],
  asyncHandler(async (req, res) => {
    const item = await punchService.createPunchItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      actor: actorFor(req),
    });
    return sendSuccess(res, item, 201);
  }),
);

router.post(
  "/bulk",
  requirePermission("punch", "create"),
  [
    body("items").isArray({ min: 1, max: punchService.MAX_BULK }),
    body("items.*.title").isString().trim().isLength({ min: 1, max: 200 }),
    body("items.*.clientRequestId").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body("defaults").optional().isObject(),
    // An item's references are identifiers, as on a single create; the service
    // checks that each names this project's or this company's record.
    ...REFERENCE_FIELDS.flatMap((field) => [body(`items.*.${field}`).optional({ nullable: true }).isUUID(), body(`defaults.${field}`).optional({ nullable: true }).isUUID()]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await punchService.bulkCreatePunchItems({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      items: req.body.items,
      defaults: req.body.defaults || {},
      actor: actorFor(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/distribute",
  requirePermission("punch", "submit", { transition: "punch.distribute" }),
  [
    body("itemIds").optional().isArray({ max: 1000 }),
    body("itemIds.*").isUUID(),
    body("companyIds").optional().isArray({ max: 50 }),
    body("companyIds.*").isUUID(),
    body("userIds").optional().isArray({ max: 200 }),
    body("userIds.*").isUUID(),
    body("message").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body("kind").optional().isIn(punchService.KINDS),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await punchService.distributePunchItems({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemIds: req.body.itemIds || [],
      companyIds: req.body.companyIds || [],
      userIds: req.body.userIds || [],
      message: req.body.message || null,
      kind: req.body.kind || "punch",
      actor: actorFor(req),
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/:itemId",
  requirePermission("punch", "read"),
  [param("itemId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const item = await punchService.getPunchItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
      viewer: actorFor(req),
    });
    return sendSuccess(res, item);
  }),
);

router.patch(
  "/:itemId",
  requirePermission("punch", "update"),
  [param("itemId").isUUID(), ...itemValidators(true), validate],
  asyncHandler(async (req, res) => {
    const item = await punchService.updatePunchItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
      payload: req.body,
      actor: actorFor(req),
    });
    return sendSuccess(res, item);
  }),
);

router.post(
  "/:itemId/transition",
  [
    param("itemId").isUUID(),
    body("action").isIn(punchService.ACTIONS),
    body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const [action, transition] = TRANSITION_PERMISSION[req.body.action];
    if (!hasPermission(req, "punch", action, { transition })) {
      const forbidden = new HttpError(403, "FORBIDDEN", `You cannot ${req.body.action.replace(/_/g, " ")} punch items on this project`);
      forbidden.details = { module: "punch", action, transition };
      throw forbidden;
    }
    const item = await punchService.transitionPunchItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
      action: req.body.action,
      reason: req.body.reason || null,
      actor: actorFor(req),
    });
    return sendSuccess(res, item);
  }),
);

router.delete(
  "/:itemId",
  requirePermission("punch", "delete"),
  [param("itemId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await punchService.deletePunchItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
      actor: actorFor(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
