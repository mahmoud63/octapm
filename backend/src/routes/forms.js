const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { validate } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const formService = require("../services/form.service");

/**
 * Inspections, ITPs, forms and toolbox talks: instances of a template
 * (OCTA-QA-TEMPLATE-014). Mounted at /projects/:projectId/forms.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const viewer = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req), projectAccess: req.projectAccess });
const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });

const instanceValidators = ({ create = false } = {}) => [
  create ? body("templateId").isUUID() : body("templateId").not().exists(),
  body("title").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body("activityId").optional({ nullable: true }).isUUID(),
  body("locationId").optional({ nullable: true }).isUUID(),
  body("sheetId").optional({ nullable: true }).isUUID(),
  body("assigneeUserId").optional({ nullable: true }).isUUID(),
  body("assigneeCompanyId").optional({ nullable: true }).isUUID(),
  body("inspectorUserId").optional({ nullable: true }).isUUID(),
  body("approverUserId").optional({ nullable: true }).isUUID(),
  body("scheduledFor").optional({ nullable: true }).isISO8601(),
  body("dueDate").optional({ nullable: true }).isISO8601(),
  body("recurrence").optional({ nullable: true }).isObject(),
  body("startNow").optional().isBoolean().toBoolean(),
  body("clientRequestId").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("clientCreatedAt").optional({ nullable: true }).isISO8601(),
  body("deviceId").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  validate,
];

const listValidators = [
  query("status").optional().isString().trim().isLength({ max: 120 }),
  query("type").optional().isIn(formService.TYPES),
  query("templateId").optional({ values: "falsy" }).isUUID(),
  query("activityId").optional({ values: "falsy" }).isUUID(),
  query("locationId").optional({ values: "falsy" }).isUUID(),
  query("sheetId").optional({ values: "falsy" }).isUUID(),
  query("assigneeUserId").optional({ values: "falsy" }).isUUID(),
  query("assigneeCompanyId").optional({ values: "falsy" }).isUUID(),
  query("ballInCourtUserId")
    .optional({ values: "falsy" })
    .matches(/^(me|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i),
  query("outcome").optional().isIn(formService.OUTCOMES),
  query("overdue").optional().isBoolean().toBoolean(),
  query("from").optional({ values: "falsy" }).isISO8601(),
  query("to").optional({ values: "falsy" }).isISO8601(),
  query("search").optional().isString().trim().isLength({ max: 120 }),
  query("limit").optional().isInt({ min: 1, max: 1000 }).toInt(),
  validate,
];

const filtersFrom = (req) => ({
  status: req.query.status || undefined,
  type: req.query.type || undefined,
  templateId: req.query.templateId || null,
  activityId: req.query.activityId || null,
  locationId: req.query.locationId || null,
  sheetId: req.query.sheetId || null,
  assigneeUserId: req.query.assigneeUserId || null,
  assigneeCompanyId: req.query.assigneeCompanyId || null,
  ballInCourtUserId: req.query.ballInCourtUserId === "me" ? req.user.id : req.query.ballInCourtUserId || null,
  outcome: req.query.outcome || null,
  overdue: req.query.overdue === true,
  from: req.query.from || null,
  to: req.query.to || null,
  search: req.query.search || "",
  limit: req.query.limit,
});

router.get(
  "/",
  requirePermission("inspection", "read"),
  listValidators,
  asyncHandler(async (req, res) => sendSuccess(res, await formService.listInstances({ ...scope(req), filters: filtersFrom(req), viewer: viewer(req) }))),
);

router.post(
  "/",
  requirePermission("inspection", "create"),
  instanceValidators({ create: true }),
  asyncHandler(async (req, res) => sendSuccess(res, await formService.createInstance({ ...scope(req), payload: req.body, actor: viewer(req) }), 201)),
);

router.get(
  "/hold-points",
  requirePermission("inspection", "read"),
  [query("activityId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const holdPoints = await formService.openHoldPoints({ projectId: req.params.projectId, activityId: req.query.activityId });
    return sendSuccess(res, { activityId: req.query.activityId, open: holdPoints.length, holdPoints });
  }),
);

router.get(
  "/:instanceId",
  requirePermission("inspection", "read"),
  [param("instanceId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.getInstance({ ...scope(req), instanceId: req.params.instanceId, viewer: viewer(req) }))),
);

router.get(
  "/:instanceId/export.pdf",
  requirePermission("inspection", "export"),
  [param("instanceId").isUUID(), query("includePhotos").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => {
    const result = await formService.exportInstancePdf({ ...scope(req), instanceId: req.params.instanceId, includePhotos: req.query.includePhotos === true, viewer: viewer(req) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  }),
);

router.patch(
  "/:instanceId",
  requirePermission("inspection", "update"),
  [param("instanceId").isUUID(), ...instanceValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.updateInstance({ ...scope(req), instanceId: req.params.instanceId, payload: req.body, actor: viewer(req) }))),
);

router.delete(
  "/:instanceId",
  requirePermission("inspection", "delete"),
  [param("instanceId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.deleteInstance({ ...scope(req), instanceId: req.params.instanceId, actor: viewer(req) }))),
);

router.post(
  "/:instanceId/start",
  requirePermission("inspection", "submit", { transition: "inspection.start" }),
  [param("instanceId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.startInstance({ ...scope(req), instanceId: req.params.instanceId, actor: viewer(req), viewer: viewer(req) }))),
);

router.put(
  "/:instanceId/responses",
  requirePermission("inspection", "submit", { transition: "inspection.start" }),
  [
    param("instanceId").isUUID(),
    body("responses").isArray({ min: 1, max: 500 }),
    body("responses.*.itemId").isUUID(),
    body("responses.*.value").optional({ nullable: true }),
    body("responses.*.note").optional({ nullable: true }).isString().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.respond({ ...scope(req), instanceId: req.params.instanceId, responses: req.body.responses, actor: viewer(req), viewer: viewer(req) }))),
);

router.post(
  "/:instanceId/complete",
  requirePermission("inspection", "submit", { transition: "inspection.complete" }),
  [param("instanceId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.completeInstance({ ...scope(req), instanceId: req.params.instanceId, actor: viewer(req), viewer: viewer(req) }))),
);

const reasonValidators = [param("instanceId").isUUID(), body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate];

router.post(
  "/:instanceId/close",
  requirePermission("inspection", "approve", { transition: "inspection.close" }),
  reasonValidators,
  asyncHandler(async (req, res) => sendSuccess(res, await formService.transition({ ...scope(req), instanceId: req.params.instanceId, action: "close", reason: req.body.reason, actor: viewer(req) }))),
);

router.post(
  "/:instanceId/reopen",
  requirePermission("inspection", "approve", { transition: "inspection.reopen" }),
  reasonValidators,
  asyncHandler(async (req, res) => sendSuccess(res, await formService.transition({ ...scope(req), instanceId: req.params.instanceId, action: "reopen", reason: req.body.reason, actor: viewer(req) }))),
);

router.post(
  "/:instanceId/void",
  requirePermission("inspection", "approve", { transition: "inspection.void" }),
  reasonValidators,
  asyncHandler(async (req, res) => sendSuccess(res, await formService.transition({ ...scope(req), instanceId: req.params.instanceId, action: "void", reason: req.body.reason, actor: viewer(req) }))),
);

router.post(
  "/:instanceId/signatures",
  requirePermission("inspection", "submit", { transition: "inspection.sign" }),
  [
    param("instanceId").isUUID(),
    body("role").isIn(formService.SIGNATURE_ROLES),
    body("image").isString().isLength({ min: 30, max: 600_000 }),
    body("signerName").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("signerCompany").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("itemId").optional({ nullable: true }).isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await formService.sign({
        ...scope(req),
        instanceId: req.params.instanceId,
        payload: req.body,
        actor: viewer(req),
        viewer: viewer(req),
        meta: { ip: req.ip, userAgent: req.get("user-agent") },
      }),
      201,
    ),
  ),
);

router.post(
  "/:instanceId/items/:itemId/deficiency",
  requirePermission("inspection", "submit", { transition: "inspection.complete" }),
  requirePermission("punch", "create"),
  [
    param("instanceId").isUUID(),
    param("itemId").isUUID(),
    body("target").optional().isIn(["punch_item", "observation"]),
    body("title").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]),
    body("trade").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("locationText").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("assigneeCompanyId").optional({ nullable: true }).isUUID(),
    body("assigneeUserId").optional({ nullable: true }).isUUID(),
    body("managerUserId").optional({ nullable: true }).isUUID(),
    body("finalApproverUserId").optional({ nullable: true }).isUUID(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await formService.raiseDeficiency({ ...scope(req), instanceId: req.params.instanceId, itemId: req.params.itemId, payload: req.body, actor: viewer(req), viewer: viewer(req) }),
      201,
    ),
  ),
);

module.exports = router;
