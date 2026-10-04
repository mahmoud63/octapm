const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/lookahead.service");

/** Lookaheads (OCTA-SCH-LOOKAHEAD-041): `/projects/:projectId/lookaheads`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actorFor = (req) => ({ id: req.user.id, name: req.user.name || null, role: getEffectiveRole(req), projectAccess: req.projectAccess || null });
const optionalDate = (field) => body(field).optional({ nullable: true }).isISO8601();
const optionalText = (field, max) => body(field).optional({ nullable: true }).isString().isLength({ max });

const headerValidators = (partial = false) => [
  partial ? body("startDate").optional().isISO8601() : body("startDate").isISO8601(),
  body("weeks").optional().isInt({ min: 2, max: 6 }),
  body("weekStartDay").optional().isInt({ min: 0, max: 6 }),
  optionalText("title", 200),
  optionalText("notes", 4000),
  body("filter").optional({ nullable: true }).isObject(),
  body("filter.wbsPrefixes").optional().isArray({ max: 50 }),
  body("filter.categories").optional().isArray({ max: 50 }),
  body("filter.activityIds").optional().isArray({ max: 2000 }),
  body("filter.onlyCritical").optional().isBoolean(),
  body("seed").optional().isBoolean(),
];

const itemValidators = () => [
  optionalText("name", 300),
  body("activityId").optional({ nullable: true }).isString(),
  optionalText("wbsCode", 60),
  optionalDate("plannedStart"),
  optionalDate("plannedFinish"),
  body("crewId").optional({ nullable: true }).isString(),
  body("companyId").optional({ nullable: true }).isString(),
  body("assigneeUserId").optional({ nullable: true }).isString(),
  body("locationId").optional({ nullable: true }).isString(),
  body("quantity").optional({ nullable: true }).isFloat({ min: 0 }),
  optionalText("unit", 20),
  body("status").optional().isIn(service.LIVE_ITEM_STATUSES),
  body("pctComplete").optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body("varianceReason").optional({ nullable: true }).isString().isLength({ max: 40 }),
  optionalText("constraint", 1000),
  body("constraintStatus").optional().isIn(service.CONSTRAINT_STATUSES),
  body("constraintOwnerUserId").optional({ nullable: true }).isString(),
  optionalDate("constraintDueDate"),
  optionalText("notes", 4000),
  body("sortOrder").optional().isInt({ min: 0 }),
];

const idParams = [param("lookaheadId").isUUID()];
const itemParams = [param("lookaheadId").isUUID(), param("itemId").isUUID()];

router.get("/", requirePermission("lookahead", "read"), [query("status").isString().optional().isIn(Object.values(service.STATUS)), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listLookaheads({ ...scope(req), query: req.query, viewer: actorFor(req) }))));
router.post("/", requirePermission("lookahead", "create"), [...headerValidators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.createLookahead({ ...scope(req), payload: req.body, actor: actorFor(req) }), 201)));
router.get("/constraints", requirePermission("lookahead", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.listConstraints({ ...scope(req), viewer: actorFor(req) }))));
router.get("/:lookaheadId", requirePermission("lookahead", "read"), [...idParams, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getLookahead({ ...scope(req), lookaheadId: req.params.lookaheadId, viewer: actorFor(req) }))));
router.patch("/:lookaheadId", requirePermission("lookahead", "update"), [...idParams, ...headerValidators(true), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateLookahead({ ...scope(req), lookaheadId: req.params.lookaheadId, payload: req.body, actor: actorFor(req) }))));
router.delete("/:lookaheadId", requirePermission("lookahead", "delete"), [...idParams, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteLookahead({ ...scope(req), lookaheadId: req.params.lookaheadId, actor: actorFor(req) }))));
router.post("/:lookaheadId/refresh", requirePermission("lookahead", "update"), [...idParams, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.refreshFromSchedule({ ...scope(req), lookaheadId: req.params.lookaheadId, actor: actorFor(req) }))));
router.post("/:lookaheadId/publish", requirePermission("lookahead", "submit", { transition: "lookahead.publish" }), [...idParams, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.publishLookahead({ ...scope(req), lookaheadId: req.params.lookaheadId, actor: actorFor(req) }))));
router.post("/:lookaheadId/archive", requirePermission("lookahead", "update", { transition: "lookahead.archive" }), [...idParams, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.archiveLookahead({ ...scope(req), lookaheadId: req.params.lookaheadId, actor: actorFor(req) }))));
router.post("/:lookaheadId/roll-forward", requirePermission("lookahead", "create"), [...idParams, body("startDate").optional({ nullable: true }).isISO8601(), body("weeks").optional().isInt({ min: 2, max: 6 }), optionalText("title", 200), optionalText("notes", 4000), body("archiveSource").optional().isBoolean(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.rollForward({ ...scope(req), lookaheadId: req.params.lookaheadId, payload: req.body, actor: actorFor(req) }), 201)));
router.get("/:lookaheadId/export.xlsx", requirePermission("lookahead", "export"), [...idParams, validate], asyncHandler(async (req, res) => {
  const { workbook, filename } = await service.exportLookahead({ ...scope(req), lookaheadId: req.params.lookaheadId, viewer: actorFor(req) });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}));
router.post("/:lookaheadId/items", requirePermission("lookahead", "update"), [...idParams, ...itemValidators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.addItem({ ...scope(req), lookaheadId: req.params.lookaheadId, payload: req.body, actor: actorFor(req), viewer: actorFor(req) }), 201)));
router.patch("/:lookaheadId/items/:itemId", requirePermission("lookahead", "update"), [...itemParams, ...itemValidators(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateItem({ ...scope(req), lookaheadId: req.params.lookaheadId, itemId: req.params.itemId, payload: req.body, actor: actorFor(req), viewer: actorFor(req) }))));
router.post("/:lookaheadId/items/:itemId/status", requirePermission("lookahead", "update", { transition: "lookahead.item_status" }), [...itemParams, body("status").isIn(service.LIVE_ITEM_STATUSES), body("varianceReason").optional({ nullable: true }).isString().isLength({ max: 40 }), body("pctComplete").optional({ nullable: true }).isFloat({ min: 0, max: 100 }), optionalText("notes", 4000), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateItem({ ...scope(req), lookaheadId: req.params.lookaheadId, itemId: req.params.itemId, payload: { status: req.body.status, varianceReason: req.body.varianceReason, pctComplete: req.body.pctComplete, notes: req.body.notes }, actor: actorFor(req), viewer: actorFor(req) }))));
router.delete("/:lookaheadId/items/:itemId", requirePermission("lookahead", "update"), [...itemParams, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.removeItem({ ...scope(req), lookaheadId: req.params.lookaheadId, itemId: req.params.itemId, actor: actorFor(req), viewer: actorFor(req) }))));

module.exports = router;
