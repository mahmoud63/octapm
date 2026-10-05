const express = require("express");
const { body, param, query } = require("express-validator");
const { scalarFigure } = require("../utils/figure-input");
const { dateOnlyInput } = require("../utils/date-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/timesheet.service");

/** Timesheets and crews (OCTA-FLD-TIME-037): `/projects/:projectId/timesheets`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actorFor = (req) => ({ id: req.user.id, name: req.user.name || null, role: getEffectiveRole(req), projectAccess: req.projectAccess || null });
// A filter is one value: isIn()/matches() check a repeated one (?status=a&status=b)
// element by element, and the list reached Prisma — a 500 (CERT-2 shapes).
const dateQuery = (name) => query(name).optional().isString().custom(dateOnlyInput);
const idOrNull = (field) => body(field).optional({ nullable: true }).isString();

const workerValidators = (partial = false) => [
  partial ? body("name").optional().isString().trim().isLength({ min: 1, max: 200 }) : body("name").isString().trim().isLength({ min: 1, max: 200 }),
  idOrNull("companyId"),
  idOrNull("userId"),
  body("employeeNumber").optional({ nullable: true }).isString().isLength({ max: 60 }),
  body("trade").optional({ nullable: true }).isString().isLength({ max: 80 }),
  body("classification").optional({ nullable: true }).isString().isLength({ max: 80 }),
  // No more than the rate's columns hold (service.RATE_MAX): 1e20 failed at the write with a 500 (CERT-2).
  body("hourlyRate").optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: service.RATE_MAX }),
  body("overtimeMultiplier").optional().custom(scalarFigure).bail().isFloat({ min: 1, max: 5 }),
  body("status").optional().isIn(["active", "inactive"]),
  body("notes").optional({ nullable: true }).isString().isLength({ max: 2000 }),
];

const crewValidators = (partial = false) => [
  partial ? body("name").optional().isString().trim().isLength({ min: 1, max: 120 }) : body("name").isString().trim().isLength({ min: 1, max: 120 }),
  idOrNull("companyId"),
  idOrNull("partyId"),
  idOrNull("foremanUserId"),
  idOrNull("defaultCostCodeId"),
  idOrNull("defaultActivityId"),
  body("status").optional().isIn(["active", "inactive"]),
  body("workerIds").optional().isArray({ max: 500 }),
  body("workerIds.*").isString(),
];

const entryValidators = () => [
  body("entries").optional().isArray({ max: 500 }),
  body("entries.*.workerId").isString(),
  body("entries.*.activityId").optional({ nullable: true }).isString(),
  body("entries.*.costCodeId").optional({ nullable: true }).isString(),
  body("entries.*.locationId").optional({ nullable: true }).isString(),
  body("entries.*.timeType").optional().isIn(service.TIME_TYPES),
  body("entries.*.hours").custom(scalarFigure).bail().isFloat({ min: 0, max: 24 }),
  body("entries.*.startTime").optional({ nullable: true }).isString().isLength({ max: 5 }),
  body("entries.*.endTime").optional({ nullable: true }).isString().isLength({ max: 5 }),
  body("entries.*.notes").optional({ nullable: true }).isString().isLength({ max: 1000 }),
];

// Workers (company-level; listed under the project so party users are scoped)
router.get("/workers", requirePermission("timesheet", "read"), [query("q").optional().isString().isLength({ max: 120 }), query("companyId").optional().isString(), query("status").optional().isString().isIn(["active", "inactive"]), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listWorkers({ orgId: req.user.orgId, query: { ...req.query, projectId: req.params.projectId }, viewer: actorFor(req) }))));
router.post("/workers", requirePermission("timesheet", "create", { transition: "timesheet.worker_admin" }), [...workerValidators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.createWorker({ orgId: req.user.orgId, payload: req.body, actor: actorFor(req), viewer: actorFor(req) }), 201)));
router.post("/workers/import", requirePermission("timesheet", "create", { transition: "timesheet.worker_admin" }), [body("rows").isArray({ min: 1, max: 1000 }), body("rows.*.userId").optional({ nullable: true }).isString(), body("rows.*.companyId").optional({ nullable: true }).isString(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.importWorkers({ orgId: req.user.orgId, rows: req.body.rows, actor: actorFor(req), viewer: actorFor(req) }))));
router.patch("/workers/:workerId", requirePermission("timesheet", "update", { transition: "timesheet.worker_admin" }), [param("workerId").isUUID(), ...workerValidators(true), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateWorker({ orgId: req.user.orgId, workerId: req.params.workerId, payload: req.body, viewer: actorFor(req) }))));

// Crews
router.get("/crews", requirePermission("timesheet", "read"), [query("status").optional().isString().isIn(["active", "inactive"]), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listCrews({ ...scope(req), query: req.query, viewer: actorFor(req) }))));
router.post("/crews", requirePermission("timesheet", "create"), [...crewValidators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.createCrew({ ...scope(req), payload: req.body, actor: actorFor(req), viewer: actorFor(req) }), 201)));
router.patch("/crews/:crewId", requirePermission("timesheet", "update"), [param("crewId").isUUID(), ...crewValidators(true), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateCrew({ ...scope(req), crewId: req.params.crewId, payload: req.body, actor: actorFor(req), viewer: actorFor(req) }))));
router.delete("/crews/:crewId", requirePermission("timesheet", "delete"), [param("crewId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteCrew({ ...scope(req), crewId: req.params.crewId, actor: actorFor(req), viewer: actorFor(req) }))));

// Views and exports (static paths before /:timesheetId)
router.get("/week", requirePermission("timesheet", "read"), [query("weekStart").isString().custom(dateOnlyInput), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.weekSummary({ ...scope(req), weekStart: req.query.weekStart, viewer: actorFor(req) }))));
router.get("/productivity", requirePermission("timesheet", "read"), [dateQuery("from"), dateQuery("to"), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.productivity({ ...scope(req), query: req.query, viewer: actorFor(req) }))));
router.get(
  "/export.xlsx",
  requirePermission("timesheet", "export"),
  [dateQuery("from"), dateQuery("to"), query("status").optional().isString().isIn(Object.values(service.STATUS)), validate],
  asyncHandler(async (req, res) => {
    const result = await service.exportTimesheets({ ...scope(req), query: req.query, viewer: actorFor(req) });
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    return res.send(result.buffer);
  }),
);

// Timesheets (a crew is named by one id: .isString() before .isUUID(), which
// checks an array element by element — crewId ["<id>"] reached Prisma as a 500, CERT-2)
router.get("/", requirePermission("timesheet", "read"), [dateQuery("from"), dateQuery("to"), query("status").optional().isString().isIn(Object.values(service.STATUS)), query("crewId").optional().isString().isUUID(), query("companyId").optional().isString(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listTimesheets({ ...scope(req), query: req.query, viewer: actorFor(req) }))));
router.post("/", requirePermission("timesheet", "create"), [body("date").custom(dateOnlyInput), body("crewId").optional({ nullable: true }).isString().isUUID(), body("companyId").optional({ nullable: true }).isString(), body("notes").optional({ nullable: true }).isString().isLength({ max: 2000 }), body("defaultHours").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: 24 }), body("clientRequestId").optional({ nullable: true }).isString().isLength({ max: 120 }), ...entryValidators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.createTimesheet({ ...scope(req), payload: req.body, actor: actorFor(req), viewer: actorFor(req) }), 201)));
router.get("/:timesheetId", requirePermission("timesheet", "read"), [param("timesheetId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getTimesheet({ ...scope(req), timesheetId: req.params.timesheetId, viewer: actorFor(req) }))));
router.patch("/:timesheetId", requirePermission("timesheet", "update"), [param("timesheetId").isUUID(), body("date").optional().custom(dateOnlyInput), body("notes").optional({ nullable: true }).isString().isLength({ max: 2000 }), ...entryValidators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateTimesheet({ ...scope(req), timesheetId: req.params.timesheetId, payload: req.body, actor: actorFor(req), viewer: actorFor(req) }))));
router.delete("/:timesheetId", requirePermission("timesheet", "delete"), [param("timesheetId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteTimesheet({ ...scope(req), timesheetId: req.params.timesheetId, actor: actorFor(req), viewer: actorFor(req) }))));
router.post("/:timesheetId/submit", requirePermission("timesheet", "submit", { transition: "timesheet.submit" }), [param("timesheetId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.submitTimesheet({ ...scope(req), timesheetId: req.params.timesheetId, actor: actorFor(req), viewer: actorFor(req) }))));
router.post("/:timesheetId/approve", requirePermission("timesheet", "approve", { transition: "timesheet.approve" }), [param("timesheetId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.approveTimesheet({ ...scope(req), timesheetId: req.params.timesheetId, actor: actorFor(req), viewer: actorFor(req) }))));
router.post("/:timesheetId/reject", requirePermission("timesheet", "approve", { transition: "timesheet.reject" }), [param("timesheetId").isUUID(), body("reason").isString().trim().isLength({ min: 1, max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.rejectTimesheet({ ...scope(req), timesheetId: req.params.timesheetId, payload: req.body, actor: actorFor(req), viewer: actorFor(req) }))));
router.post("/:timesheetId/reopen", requirePermission("timesheet", "approve", { transition: "timesheet.reopen" }), [param("timesheetId").isUUID(), body("reason").optional({ nullable: true }).isString().isLength({ max: 500 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.reopenTimesheet({ ...scope(req), timesheetId: req.params.timesheetId, payload: req.body, actor: actorFor(req), viewer: actorFor(req) }))));

module.exports = router;
