const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { boqFigureAccess, withheldDailyLog, withheldDailyLogList } = require("../utils/boq-figures");
const service = require("../services/daily-log.service");

/** Project daily log (OCTA-FLD-DAILY-022): `/projects/:projectId/daily-logs`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);
// OCTA-AI-DAILY-030: `/ai/*` and `/:date/ai/*` — registered before the day routes.
router.use(require("./daily-log-assistant"));

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const viewer = (req) => ({ id: req.user.id, projectAccess: req.projectAccess });
// PC-6: the quantities section names BOQ items, so every log answer goes
// through utils/boq-figures — a reader who may not read the BOQ gets the
// row's description and unit name, never its quantity, item or allocation,
// and no per-unit total (withheldDailyLog; the list of days likewise).
const send = (req, res, log, status) => sendSuccess(res, withheldDailyLog(log, boqFigureAccess(req)), status);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = param("date").matches(DATE_RE).withMessage("date must be YYYY-MM-DD");
const sectionParam = param("section").isIn(service.SECTION_KEYS);
const entryParam = param("entryId").isUUID();
const optionalText = (field, max = 2000) => body(field).optional({ nullable: true }).isString().trim().isLength({ max });
const optionalNumber = (field, options = {}) => body(field).optional({ nullable: true }).isFloat(options);

const entryValidators = [
  optionalText("clientRequestId", 100),
  body("partyId").optional({ nullable: true }).isString().isUUID(),
  body("companyId").optional({ nullable: true }).isString().isUUID(),
  optionalText("companyName", 200),
  optionalText("trade", 120),
  body("workers").optional({ nullable: true }).isInt({ min: 0, max: 100000 }),
  optionalNumber("hours", { min: 0, max: 24 }),
  body("equipmentId").optional({ nullable: true }).isString().isUUID(),
  optionalText("name", 200),
  body("count").optional({ nullable: true }).isInt({ min: 1, max: 10000 }),
  optionalNumber("hoursOperated", { min: 0, max: 24 }),
  optionalNumber("hoursIdle", { min: 0, max: 24 }),
  optionalText("supplierName", 200),
  optionalText("description", 2000),
  optionalNumber("quantity", { min: 0 }),
  optionalText("unit", 40),
  optionalText("poRef", 80),
  optionalText("receivedBy", 120),
  optionalText("deliveredAt", 40),
  optionalText("company", 200),
  optionalText("purpose", 500),
  optionalText("arrivedAt", 40),
  optionalText("leftAt", 40),
  body("type").optional({ nullable: true }).isIn(service.DELAY_TYPES),
  optionalNumber("hoursLost", { min: 0, max: 24 }),
  body("kind").optional({ nullable: true }).isIn(service.NOTE_KINDS),
  optionalText("text", 4000),
  body("activityId").optional({ nullable: true }).isString().isUUID(),
  body("locationId").optional({ nullable: true }).isString().isUUID(),
  optionalText("notes", 2000),
  body("status").optional().isIn(["draft", "approved"]),
  // PC-6: the quantities section — the item (allocated to the activity), the
  // allocation it was picked from, and the unit (the item's or an alias;
  // `unit` above is accepted as a spelling of it).
  body("boqItemId").optional({ nullable: true }).isString().isUUID(),
  body("allocationId").optional({ nullable: true }).isString().isUUID(),
  optionalText("unitCode", 32),
];

// ── settings & reports (static paths before /:date) ──────────────────────

router.get(
  "/settings",
  requirePermission("progress", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.getSettings(scope(req)))),
);

router.put(
  "/settings",
  requirePermission("progress", "approve", { transition: "daily_log.configure" }),
  [
    optionalNumber("latitude", { min: -90, max: 90 }),
    optionalNumber("longitude", { min: -180, max: 180 }),
    optionalText("timezone", 64),
    body("weatherFeedEnabled").optional().isBoolean().toBoolean(),
    body("thresholds").optional({ nullable: true }).isObject(),
    body("distributionRoles").optional().isArray({ max: 20 }),
    body("distributionEmails").optional(),
    optionalText("autoDistributeAt", 5),
    body("copySections").optional().isArray({ max: 6 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.updateSettings({ ...scope(req), payload: req.body, actorId: req.user.id }))),
);

router.get(
  "/manpower-report",
  requirePermission("progress", "read"),
  [query("from").isString().optional().matches(DATE_RE), query("to").isString().optional().matches(DATE_RE), query("groupBy").isString().optional().isIn(["company", "trade", "company_trade", "activity"]), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await service.manpowerReport({ ...scope(req), from: req.query.from || null, to: req.query.to || null, groupBy: req.query.groupBy || "company", viewer: viewer(req) })),
  ),
);

router.get(
  "/",
  requirePermission("progress", "read"),
  [query("from").isString().optional().matches(DATE_RE), query("to").isString().optional().matches(DATE_RE), validate],
  asyncHandler(async (req, res) => sendSuccess(res, withheldDailyLogList(await service.listLogs({ ...scope(req), from: req.query.from || null, to: req.query.to || null, viewer: viewer(req) }), boqFigureAccess(req)))),
);

// ── one day ──────────────────────────────────────────────────────────────

router.get(
  "/:date",
  requirePermission("progress", "read"),
  [dateParam, validate],
  asyncHandler(async (req, res) => send(req, res, await service.getLog({ ...scope(req), date: req.params.date, viewer: viewer(req) }))),
);

router.patch(
  "/:date",
  requirePermission("progress", "update", { transition: "daily_log.update" }),
  [dateParam, optionalText("summary", 8000), body("weather").optional({ nullable: true }).custom((value) => value === null || (typeof value === "object" && !Array.isArray(value))), validate],
  asyncHandler(async (req, res) => send(req, res, await service.updateLog({ ...scope(req), date: req.params.date, payload: req.body, actor: actor(req), viewer: viewer(req) }))),
);

router.get(
  "/:date/export.pdf",
  requirePermission("progress", "export"),
  [dateParam, validate],
  asyncHandler(async (req, res) => {
    const { buffer, fileName } = await service.renderPdf({ ...scope(req), date: req.params.date, viewer: viewer(req), boqAccess: boqFigureAccess(req) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  }),
);

router.post(
  "/:date/weather/refresh",
  requirePermission("progress", "update", { transition: "daily_log.update" }),
  [dateParam, validate],
  asyncHandler(async (req, res) => send(req, res, await service.refreshWeather({ ...scope(req), date: req.params.date, actor: actor(req), viewer: viewer(req) }))),
);

router.post(
  "/:date/copy-previous",
  requirePermission("progress", "submit", { transition: "daily_log.submit" }),
  [dateParam, body("sections").optional().isArray({ max: 6 }), body("sections.*").optional().isIn(service.SECTION_KEYS), validate],
  asyncHandler(async (req, res) => send(req, res, await service.copyPrevious({ ...scope(req), date: req.params.date, sections: req.body.sections || null, actor: actor(req), viewer: viewer(req) }))),
);

router.post(
  "/:date/submit",
  requirePermission("progress", "submit", { transition: "daily_log.submit" }),
  [dateParam, validate],
  asyncHandler(async (req, res) => send(req, res, await service.submitLog({ ...scope(req), date: req.params.date, actor: actor(req), viewer: viewer(req) }))),
);

router.post(
  "/:date/approve",
  requirePermission("progress", "approve", { transition: "daily_log.approve" }),
  [dateParam, validate],
  asyncHandler(async (req, res) => send(req, res, await service.approveLog({ ...scope(req), date: req.params.date, actor: actor(req), viewer: viewer(req) }))),
);

router.post(
  "/:date/reopen",
  requirePermission("progress", "approve", { transition: "daily_log.approve" }),
  [dateParam, optionalText("reason", 1000), validate],
  asyncHandler(async (req, res) => send(req, res, await service.reopenLog({ ...scope(req), date: req.params.date, reason: req.body.reason || null, actor: actor(req), viewer: viewer(req) }))),
);

router.post(
  "/:date/distribute",
  requirePermission("progress", "submit", { transition: "daily_log.distribute" }),
  [
    dateParam,
    body("roles").optional().isArray({ max: 20 }),
    body("roles.*").optional().isIn(service.DISTRIBUTION_ROLES),
    body("userIds").optional().isArray({ max: 100 }),
    body("userIds.*").optional().isString().isUUID(),
    body("emails").optional().isArray({ max: 50 }),
    body("emails.*").optional().isEmail(),
    optionalText("note", 2000),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const to = req.body.roles !== undefined || req.body.userIds !== undefined || req.body.emails !== undefined ? { roles: req.body.roles, userIds: req.body.userIds, emails: req.body.emails } : null;
    return send(req, res, await service.distribute({ ...scope(req), date: req.params.date, actor: actor(req), to, note: req.body.note || null }));
  }),
);

// ── entries ──────────────────────────────────────────────────────────────

router.post(
  "/:date/entries/:section",
  requirePermission("progress", "submit", { transition: "daily_log.submit" }),
  [dateParam, sectionParam, ...entryValidators, validate],
  asyncHandler(async (req, res) =>
    send(req, res, await service.addEntry({ ...scope(req), date: req.params.date, section: req.params.section, payload: req.body, actor: actor(req), viewer: viewer(req) }), 201),
  ),
);

router.patch(
  "/:date/entries/:section/:entryId",
  requirePermission("progress", "submit", { transition: "daily_log.submit" }),
  [dateParam, sectionParam, entryParam, ...entryValidators, validate],
  asyncHandler(async (req, res) =>
    send(req, res, await service.updateEntry({ ...scope(req), date: req.params.date, section: req.params.section, entryId: req.params.entryId, payload: req.body, actor: actor(req), viewer: viewer(req) })),
  ),
);

router.delete(
  "/:date/entries/:section/:entryId",
  requirePermission("progress", "submit", { transition: "daily_log.submit" }),
  [dateParam, sectionParam, entryParam, validate],
  asyncHandler(async (req, res) =>
    send(req, res, await service.deleteEntry({ ...scope(req), date: req.params.date, section: req.params.section, entryId: req.params.entryId, actor: actor(req), viewer: viewer(req) })),
  ),
);

router.post(
  "/:date/entries/:section/:entryId/review",
  requirePermission("progress", "approve", { transition: "daily_log.entry_review" }),
  [dateParam, sectionParam, entryParam, body("decision").isIn(["approve", "reject"]), optionalText("reason", 1000), validate],
  asyncHandler(async (req, res) =>
    send(req, res, await service.reviewEntry({ ...scope(req), date: req.params.date, section: req.params.section, entryId: req.params.entryId, decision: req.body.decision, reason: req.body.reason || null, actor: actor(req), viewer: viewer(req) })),
  ),
);

router.post(
  "/:date/entries/delays/:entryId/weather-delay",
  requirePermission("progress", "update", { transition: "daily_log.update" }),
  [dateParam, entryParam, optionalNumber("delayDays", { min: 0, max: 365 }), body("contractual").optional().isBoolean().toBoolean(), optionalText("description", 2000), body("activityIds").optional().isArray({ max: 200 }), body("activityIds.*").optional().isString().isUUID(), validate],
  asyncHandler(async (req, res) =>
    send(req, res, await service.logWeatherDelay({ ...scope(req), date: req.params.date, entryId: req.params.entryId, payload: req.body, actor: actor(req), viewer: viewer(req) })),
  ),
);

module.exports = router;
