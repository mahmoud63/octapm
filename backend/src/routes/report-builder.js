const express = require("express");
const { body, param, query } = require("express-validator");
const { scalarFigure, INT4_MAX } = require("../utils/figure-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, noApiKey } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/report-builder.service");
const reportAssistant = require("../services/report-assistant.service");

/** Report builder (OCTA-RPT-BUILDER-023): `/reports`. Org-level; every run is scoped per project as the caller. */
const router = express.Router();
router.use(authenticate);

const user = (req) => ({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, isCompanyAdmin: Boolean(req.user.isCompanyAdmin) });
const orgId = (req) => req.user.orgId;

const definitionValidators = (partial = false) => [
  partial ? body("name").optional().isString().trim().isLength({ min: 1, max: 160 }) : body("name").isString().trim().isLength({ min: 1, max: 160 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  partial ? body("source").optional().isString() : body("source").isString(),
  body("projectId").optional({ nullable: true }).isString().isUUID(),
  body("columns").optional().isArray({ max: 60 }),
  body("columns.*").optional().isString(),
  body("filters").optional().isArray({ max: 30 }),
  body("filters.*.field").optional().isString(),
  body("filters.*.op").optional().isIn(service.OPERATORS),
  body("sort").optional({ nullable: true }).isObject(),
  body("groupBy").optional({ nullable: true }).isString(),
  body("aggregates").optional().isArray({ max: 10 }),
  body("aggregates.*.fn").optional().isIn(service.AGGREGATE_FNS),
  body("chart").optional({ nullable: true }).isObject(),
  body("visibility").optional().isIn(service.VISIBILITIES),
];

const previewValidators = [
  body("source").isString(),
  body("projectId").optional({ nullable: true }).isString().isUUID(),
  body("columns").optional().isArray({ max: 60 }),
  body("filters").optional().isArray({ max: 30 }),
  body("sort").optional({ nullable: true }).isObject(),
  body("groupBy").optional({ nullable: true }).isString(),
  body("aggregates").optional().isArray({ max: 10 }),
  body("limit").optional().custom(scalarFigure).bail().isInt({ min: 1, max: 1000 }).toInt(),
  body("offset").optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
];

const scheduleValidators = [
  body("frequency").optional().isIn(service.FREQUENCIES),
  body("dayOfWeek").optional().custom(scalarFigure).bail().isInt({ min: 0, max: 6 }).toInt(),
  body("dayOfMonth").optional().custom(scalarFigure).bail().isInt({ min: 1, max: 31 }).toInt(),
  body("hour").optional().custom(scalarFigure).bail().isInt({ min: 0, max: 23 }).toInt(),
  body("minute").optional().custom(scalarFigure).bail().isInt({ min: 0, max: 59 }).toInt(),
  body("timezone").optional().isString().trim().isLength({ max: 64 }),
  body("format").optional().isIn(service.FORMATS),
  body("recipients").optional().isObject(),
  body("recipients.userIds").optional().isArray({ max: 100 }),
  body("recipients.roles").optional().isArray({ max: 20 }),
  body("recipients.emails").optional().isArray({ max: 50 }),
  body("enabled").optional().isBoolean().toBoolean(),
];

const sendFile = (res, file) => {
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  return res.send(file.buffer);
};

// ── static paths first ───────────────────────────────────────────────────

router.get(
  "/sources",
  requirePermission("report", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, { sources: await service.listSources({ orgId: req.user.orgId }) })),
);

router.post(
  "/preview",
  requirePermission("report", "read"),
  [...previewValidators, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.preview({ orgId: orgId(req), user: user(req), apiClient: req.apiClient || null, payload: req.body, limit: req.body.limit || service.PREVIEW_LIMIT, offset: req.body.offset || 0 }))),
);

// OCTA-AI-NLREPORT-033: a question becomes a definition; a preview becomes a narrative.
router.post(
  "/ask",
  requirePermission("assistant", "read"),
  requirePermission("report", "read"),
  [body("question").isString().trim().isLength({ min: 3, max: 1000 }), body("projectId").optional({ nullable: true }).isString().isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await reportAssistant.ask({ orgId: orgId(req), user: user(req), apiClient: req.apiClient || null, question: req.body.question, projectId: req.body.projectId || null }))),
);

router.post(
  "/narrate",
  requirePermission("assistant", "read"),
  requirePermission("report", "read"),
  [...previewValidators, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await reportAssistant.narrate({ orgId: orgId(req), user: user(req), apiClient: req.apiClient || null, payload: req.body }))),
);

router.post(
  "/export",
  requirePermission("report", "export"),
  [...previewValidators, body("format").optional().isIn(["pdf", "xlsx"]), body("name").optional().isString().trim().isLength({ max: 160 }), validate],
  asyncHandler(async (req, res) => sendFile(res, await service.renderDefinition({ orgId: orgId(req), user: user(req), apiClient: req.apiClient || null, definition: req.body, format: req.body.format || "xlsx" }))),
);

router.get(
  "/runs/:runId/download",
  requirePermission("report", "read"),
  noApiKey,
  [param("runId").isUUID(), query("format").isString().optional().isIn(["pdf", "xlsx"]), validate],
  asyncHandler(async (req, res) => sendFile(res, await service.getRunFile({ orgId: orgId(req), user: user(req), runId: req.params.runId, format: req.query.format || "pdf" }))),
);

router.get(
  "/",
  requirePermission("report", "read"),
  [query("projectId").isString().optional({ values: "falsy" }).isUUID(), query("source").optional().isString(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.listDefinitions({ orgId: orgId(req), user: user(req), projectId: req.query.projectId || null, source: req.query.source || null }))),
);

router.post(
  "/",
  requirePermission("report", "create"),
  noApiKey,
  [...definitionValidators(false), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.createDefinition({ orgId: orgId(req), user: user(req), payload: req.body }), 201)),
);

// ── one report ───────────────────────────────────────────────────────────

router.get(
  "/:reportId",
  requirePermission("report", "read"),
  [param("reportId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.getDefinition({ orgId: orgId(req), user: user(req), reportId: req.params.reportId }))),
);

router.put(
  "/:reportId",
  requirePermission("report", "update"),
  noApiKey,
  [param("reportId").isUUID(), ...definitionValidators(true), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.updateDefinition({ orgId: orgId(req), user: user(req), reportId: req.params.reportId, payload: req.body }))),
);

router.delete(
  "/:reportId",
  requirePermission("report", "delete"),
  noApiKey,
  [param("reportId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.deleteDefinition({ orgId: orgId(req), user: user(req), reportId: req.params.reportId }))),
);

router.post(
  "/:reportId/run",
  requirePermission("report", "read"),
  [param("reportId").isUUID(), body("limit").optional().custom(scalarFigure).bail().isInt({ min: 1, max: 1000 }).toInt(), body("offset").optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.runDefinition({ orgId: orgId(req), user: user(req), apiClient: req.apiClient || null, reportId: req.params.reportId, limit: req.body.limit || service.PREVIEW_LIMIT, offset: req.body.offset || 0 }))),
);

router.get(
  "/:reportId/export.pdf",
  requirePermission("report", "export"),
  [param("reportId").isUUID(), validate],
  asyncHandler(async (req, res) => sendFile(res, await service.renderDefinition({ orgId: orgId(req), user: user(req), apiClient: req.apiClient || null, reportId: req.params.reportId, format: "pdf" }))),
);

router.get(
  "/:reportId/export.xlsx",
  requirePermission("report", "export"),
  [param("reportId").isUUID(), validate],
  asyncHandler(async (req, res) => sendFile(res, await service.renderDefinition({ orgId: orgId(req), user: user(req), apiClient: req.apiClient || null, reportId: req.params.reportId, format: "xlsx" }))),
);

router.get(
  "/:reportId/runs",
  requirePermission("report", "read"),
  [param("reportId").isUUID(), query("limit").isString().optional().isInt({ min: 1, max: 100 }).toInt(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await service.listRuns({ orgId: orgId(req), user: user(req), reportId: req.params.reportId, limit: req.query.limit || 20 }) })),
);

router.post(
  "/:reportId/runs",
  requirePermission("report", "export"),
  noApiKey,
  [param("reportId").isUUID(), body("format").optional().isIn(service.FORMATS), body("deliver").optional().isBoolean().toBoolean(), body("recipients").optional().isObject(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.createRun({ orgId: orgId(req), user: user(req), reportId: req.params.reportId, format: req.body.format || "pdf", deliver: Boolean(req.body.deliver), recipients: req.body.recipients || null }), 201)),
);

router.get(
  "/:reportId/schedules",
  requirePermission("report", "read"),
  [param("reportId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await service.listSchedules({ orgId: orgId(req), user: user(req), reportId: req.params.reportId }) })),
);

router.post(
  "/:reportId/schedules",
  requirePermission("report", "update", { transition: "report.schedule" }),
  noApiKey,
  [param("reportId").isUUID(), ...scheduleValidators, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.createSchedule({ orgId: orgId(req), user: user(req), reportId: req.params.reportId, payload: req.body }), 201)),
);

router.patch(
  "/:reportId/schedules/:scheduleId",
  requirePermission("report", "update", { transition: "report.schedule" }),
  noApiKey,
  [param("reportId").isUUID(), param("scheduleId").isUUID(), ...scheduleValidators, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.updateSchedule({ orgId: orgId(req), user: user(req), reportId: req.params.reportId, scheduleId: req.params.scheduleId, payload: req.body }))),
);

router.delete(
  "/:reportId/schedules/:scheduleId",
  requirePermission("report", "update", { transition: "report.schedule" }),
  noApiKey,
  [param("reportId").isUUID(), param("scheduleId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.deleteSchedule({ orgId: orgId(req), user: user(req), reportId: req.params.reportId, scheduleId: req.params.scheduleId }))),
);

module.exports = router;
