const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { exceptionAccess, EXCEPTION_MODULES } = require("../utils/boq-figures");
const changeEventService = require("../services/change-event.service");
const service = require("../services/exception.service");

/**
 * Project exceptions (PC-7b): `/projects/:projectId/controls/exceptions`.
 *
 * Reading needs no single module: each exception is read through its
 * subject's module (boq, cost, schedule, progress) and a BOQ-derived one only
 * by a BOQ reader — decided per row in utils/boq-figures, as this project's
 * own routes decide each permission. Review, snooze and dismiss need
 * change_event update or the subject module's update; raising or associating
 * a change event needs change_event create. Nothing here writes a change
 * order, a budget, a schedule or a figure.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actorFor = (req) => ({ id: req.user.id, name: req.user.name || null, role: getEffectiveRole(req) });
/** The caller as this project's routes see them: what they may read, and what they may do. */
const callerFor = (req) => ({
  access: exceptionAccess(req),
  may: {
    changeEventCreate: hasPermission(req, "change_event", "create"),
    changeEventUpdate: hasPermission(req, "change_event", "update"),
    moduleUpdate: Object.fromEntries(EXCEPTION_MODULES.map((module) => [module, hasPermission(req, module, "update")])),
  },
});
const exceptionIdParam = param("exceptionId").isUUID();

// A change event body over a prefill: the words, type, activity, location,
// schedule estimate and lines. Origin and the typed source link belong to the
// endpoint and are not accepted.
const draftValidators = [
  body("title").optional().isString().trim().isLength({ min: 1, max: 200 }),
  body("description").optional({ nullable: true }).isString().isLength({ max: 8000 }),
  body("type").optional().isIn(changeEventService.TYPES),
  body("notes").optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body("activityId").optional({ nullable: true }).isString(),
  body("locationId").optional({ nullable: true }).isString(),
  body("scheduleImpactDays").optional().isInt({ min: 0, max: 3650 }),
  body("ownerChange").optional().isBoolean().toBoolean(),
  body("romAmount").optional({ nullable: true }).isFloat({ min: 0 }),
  body("lines").optional().isArray({ max: 200 }),
  body("lines.*.description").isString().trim().isLength({ min: 1, max: 500 }),
  body("lines.*.costCodeId").optional({ nullable: true }).isString(),
  body("lines.*.budgetLineId").optional({ nullable: true }).isString(),
  body("lines.*.activityId").optional({ nullable: true }).isString(),
  body("lines.*.commitmentId").optional({ nullable: true }).isString(),
  body("lines.*.quantity").optional().isFloat({ min: 0 }),
  body("lines.*.unit").optional({ nullable: true }).isString().isLength({ max: 20 }),
  body("lines.*.unitCost").optional({ nullable: true }).isFloat({ min: 0 }),
  body("lines.*.romAmount").optional({ nullable: true }).isFloat({ min: 0 }),
  body("lines.*.notes").optional({ nullable: true }).isString().isLength({ max: 1000 }),
];
const draftBody = (req) => {
  const { origin, sourceRecordType, sourceRecordId, ...rest } = req.body || {};
  for (const field of changeEventService.SOURCE_LINK_FIELDS) delete rest[field];
  return rest;
};

router.get(
  "/",
  [
    query("status").optional().isIn([...service.STATUSES, "all"]),
    query("kind").optional().isString().isLength({ max: 500 }),
    query("severity").optional().isString().isLength({ max: 60 }),
    query("subject").optional().isString().isLength({ max: 120 }),
    query("subjectType").optional().isString().isLength({ max: 60 }),
    query("subjectId").optional().isUUID(),
    query("wbsNodeId").optional().isUUID(),
    query("locationId").optional().isUUID(),
    query("costCodeId").optional().isUUID(),
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.listExceptions({ ...scope(req), ...callerFor(req), query: req.query }))),
);

router.get("/:exceptionId", [exceptionIdParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getException({ ...scope(req), ...callerFor(req), exceptionId: req.params.exceptionId }))));

router.post(
  "/:exceptionId/review",
  [exceptionIdParam, body("note").isString().trim().isLength({ min: 1, max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.reviewException({ ...scope(req), ...callerFor(req), exceptionId: req.params.exceptionId, actor: actorFor(req), payload: req.body }))),
);
router.post(
  "/:exceptionId/snooze",
  [exceptionIdParam, body("until").isISO8601(), body("reason").isString().trim().isLength({ min: 1, max: 500 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.snoozeException({ ...scope(req), ...callerFor(req), exceptionId: req.params.exceptionId, actor: actorFor(req), payload: req.body }))),
);
router.post(
  "/:exceptionId/dismiss",
  [exceptionIdParam, body("reason").isString().trim().isLength({ min: 1, max: 500 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.dismissException({ ...scope(req), ...callerFor(req), exceptionId: req.params.exceptionId, actor: actorFor(req), payload: req.body }))),
);
router.get(
  "/:exceptionId/change-event-prefill",
  [exceptionIdParam, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.getExceptionPrefill({ ...scope(req), ...callerFor(req), exceptionId: req.params.exceptionId }))),
);
router.post(
  "/:exceptionId/raise-change-event",
  [exceptionIdParam, ...draftValidators, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.raiseFromException({ ...scope(req), ...callerFor(req), exceptionId: req.params.exceptionId, actor: actorFor(req), payload: draftBody(req) }), 201)),
);
router.post(
  "/:exceptionId/associate-change-event",
  [exceptionIdParam, body("changeEventId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.associateChangeEvent({ ...scope(req), ...callerFor(req), exceptionId: req.params.exceptionId, actor: actorFor(req), payload: req.body }))),
);

/**
 * "Raise change event" from a project record (PC-7b §2, §126): mounted
 * beside each record's own routes as `/<module path>/:recordId/…`. The caller
 * must read the record — its module's read here, and the record's own rule in
 * change-event.service (RFI draft, company party, unpublished drawing
 * revision) — and create change events. GET returns the prefill; POST
 * creates one DRAFT change event with the typed link. The shared helper is
 * change-event.service prefillFromRecord / raiseFromRecord.
 */
const SOURCE_READ_MODULE = Object.freeze(
  Object.fromEntries(changeEventService.RECORD_SOURCE_TYPES.map((type) => [type, changeEventService.RECORD_SOURCES[type].readModule])),
);
// Where each source's routes live under /projects/:projectId.
const SOURCE_MOUNTS = Object.freeze({
  rfi: "rfi",
  daily_log: "daily-logs",
  ncr: "ncr",
  punch_item: "punch",
  drawing_revision: "drawings/sheets/revisions",
  submittal: "submittals",
  meeting_action: "meetings/action-items",
});
/** The caller, for the record's own read rule. */
const recordViewerFor = (req) => ({
  id: req.user.id,
  projectAccess: req.projectAccess || null,
  documentControlUpdate: hasPermission(req, "document_control", "update"),
});

/**
 * Adds the two routes per source to the projects router as full paths
 * (`/:projectId/<mount>/:recordId/…`), so the project-access check runs only
 * for these paths and never in front of the source module's own routes.
 */
const registerSourceRaiseRoutes = (projectsRouter, projectAccess) => {
  for (const [recordType, mount] of Object.entries(SOURCE_MOUNTS)) {
    const guards = [requirePermission(SOURCE_READ_MODULE[recordType], "read"), requirePermission("change_event", "create")];
    const record = (req) => ({ ...scope(req), recordType, recordId: req.params.recordId, viewer: recordViewerFor(req) });
    projectsRouter.get(
      `/:projectId/${mount}/:recordId/change-event-prefill`,
      ...projectAccess,
      ...guards,
      [param("recordId").isUUID(), validate],
      asyncHandler(async (req, res) => sendSuccess(res, await changeEventService.prefillFromRecord(record(req)))),
    );
    projectsRouter.post(
      `/:projectId/${mount}/:recordId/raise-change-event`,
      ...projectAccess,
      ...guards,
      [param("recordId").isUUID(), ...draftValidators, validate],
      asyncHandler(async (req, res) => sendSuccess(res, await changeEventService.raiseFromRecord({ ...record(req), actor: actorFor(req), payload: draftBody(req) }), 201)),
    );
  }
};

module.exports = router;
module.exports.registerSourceRaiseRoutes = registerSourceRaiseRoutes;
module.exports.SOURCE_MOUNTS = SOURCE_MOUNTS;
module.exports.SOURCE_READ_MODULE = SOURCE_READ_MODULE;
