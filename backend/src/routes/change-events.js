const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/change-event.service");
const exceptionService = require("../services/exception.service");
const { boqFigureAccess } = require("../utils/boq-figures");

/** Change events and RFQs (OCTA-COM-CE-038): `/projects/:projectId/change-events`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actorFor = (req) => ({ id: req.user.id, name: req.user.name || null, role: getEffectiveRole(req), projectAccess: req.projectAccess || null });
const idOrNull = (field) => body(field).optional({ nullable: true }).isString();
// Every answer that carries a change event, as this caller may receive it: one
// raised from a BOQ-derived exception names neither the exception nor what
// came from it to a reader without boq:read (PC-7b; utils/boq-figures).
const send = (req, res, answer, status) =>
  exceptionService
    .changeEventAnswerFor({ ...scope(req), access: boqFigureAccess(req), answer })
    .then((out) => (status ? sendSuccess(res, out, status) : sendSuccess(res, out)));

const eventValidators = (partial = false) => [
  partial ? body("title").optional().isString().trim().isLength({ min: 1, max: 200 }) : body("title").isString().trim().isLength({ min: 1, max: 200 }),
  body("description").optional({ nullable: true }).isString().isLength({ max: 8000 }),
  body("type").optional().isIn(service.TYPES),
  body("origin").optional().isIn(service.ORIGINS),
  body("sourceRecordType").optional({ nullable: true }).isString().isLength({ max: 60 }),
  idOrNull("sourceRecordId"),
  idOrNull("activityId"),
  idOrNull("locationId"),
  body("romAmount").optional({ nullable: true }).isFloat({ min: 0 }),
  body("scheduleImpactDays").optional().isInt({ min: 0, max: 3650 }),
  body("ownerChange").optional().isBoolean().toBoolean(),
  body("notes").optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body("lines").optional().isArray({ max: 200 }),
  body("lines.*.description").isString().trim().isLength({ min: 1, max: 500 }),
  body("lines.*.id").optional({ nullable: true }).isString(),
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

router.get("/", requirePermission("change_event", "read"), [query("status").optional().isIn(Object.values(service.STATUS)), query("type").optional().isIn(service.TYPES), query("origin").optional().isIn(service.ORIGINS), query("q").optional().isString().isLength({ max: 200 }), validate], asyncHandler(async (req, res) => send(req, res, await service.listChangeEvents({ ...scope(req), query: req.query }))));
router.post("/", requirePermission("change_event", "create"), [...eventValidators(), validate], asyncHandler(async (req, res) => send(req, res, await service.createChangeEvent({ ...scope(req), payload: req.body, actor: actorFor(req) }), 201)));

router.post("/rfqs/:rfqId/remind", requirePermission("change_event", "submit", { transition: "change_event.rfq_send" }), [param("rfqId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.remindRfq({ ...scope(req), rfqId: req.params.rfqId, actor: actorFor(req) }))));
router.post("/rfqs/:rfqId/cancel", requirePermission("change_event", "submit", { transition: "change_event.rfq_send" }), [param("rfqId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.cancelRfq({ ...scope(req), rfqId: req.params.rfqId, actor: actorFor(req) }))));
router.post("/rfqs/:rfqId/accept", requirePermission("change_event", "approve", { transition: "change_event.quote_accept" }), [param("rfqId").isUUID(), body("createCommitmentChangeOrder").optional().isBoolean().toBoolean(), validate], asyncHandler(async (req, res) => send(req, res, await service.acceptQuote({ ...scope(req), rfqId: req.params.rfqId, payload: req.body, actor: actorFor(req), access: boqFigureAccess(req) }))));
router.post("/rfqs/:rfqId/reject", requirePermission("change_event", "approve", { transition: "change_event.quote_accept" }), [param("rfqId").isUUID(), body("reason").optional({ nullable: true }).isString().isLength({ max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.rejectQuote({ ...scope(req), rfqId: req.params.rfqId, payload: req.body, actor: actorFor(req) }))));

router.get("/:changeEventId", requirePermission("change_event", "read"), [param("changeEventId").isUUID(), validate], asyncHandler(async (req, res) => send(req, res, await service.getChangeEvent({ ...scope(req), changeEventId: req.params.changeEventId }))));
router.patch("/:changeEventId", requirePermission("change_event", "update"), [param("changeEventId").isUUID(), ...eventValidators(true), validate], asyncHandler(async (req, res) => send(req, res, await service.updateChangeEvent({ ...scope(req), changeEventId: req.params.changeEventId, payload: req.body, actor: actorFor(req), access: boqFigureAccess(req) }))));
router.delete("/:changeEventId", requirePermission("change_event", "delete"), [param("changeEventId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteChangeEvent({ ...scope(req), changeEventId: req.params.changeEventId, actor: actorFor(req) }))));
router.post(
  "/:changeEventId/rfqs",
  requirePermission("change_event", "submit", { transition: "change_event.rfq_send" }),
  [param("changeEventId").isUUID(), body("recipients").isArray({ min: 1, max: 50 }), body("recipients.*.commitmentId").optional({ nullable: true }).isString(), body("recipients.*.vendorCompanyId").optional({ nullable: true }).isString(), body("recipients.*.companyName").optional({ nullable: true }).isString().isLength({ max: 200 }), body("recipients.*.contactName").optional({ nullable: true }).isString().isLength({ max: 120 }), body("recipients.*.contactEmail").optional({ nullable: true }).isString().isLength({ max: 200 }), body("dueDate").optional({ nullable: true }).isISO8601(), body("instructions").optional({ nullable: true }).isString().isLength({ max: 4000 }), body("lineIds").optional().isArray({ max: 200 }), validate],
  asyncHandler(async (req, res) => send(req, res, await service.sendRfqs({ ...scope(req), changeEventId: req.params.changeEventId, payload: req.body, actor: actorFor(req), access: boqFigureAccess(req) }), 201)),
);
router.post("/:changeEventId/convert", requirePermission("change_event", "approve", { transition: "change_event.convert" }), [param("changeEventId").isUUID(), body("value").optional({ nullable: true }).isFloat({ min: 0 }), body("description").optional({ nullable: true }).isString().isLength({ max: 2000 }), body("includeCommitmentChangeOrders").optional().isBoolean().toBoolean(), validate], asyncHandler(async (req, res) => send(req, res, await service.convertToChangeOrder({ ...scope(req), changeEventId: req.params.changeEventId, payload: req.body, actor: actorFor(req), access: boqFigureAccess(req) }), 201)));
router.post("/:changeEventId/close", requirePermission("change_event", "approve", { transition: "change_event.close" }), [param("changeEventId").isUUID(), body("reason").optional({ nullable: true }).isString().isLength({ max: 500 }), validate], asyncHandler(async (req, res) => send(req, res, await service.closeChangeEvent({ ...scope(req), changeEventId: req.params.changeEventId, payload: req.body, actor: actorFor(req) }))));
router.post("/:changeEventId/void", requirePermission("change_event", "approve", { transition: "change_event.void" }), [param("changeEventId").isUUID(), body("reason").isString().trim().isLength({ min: 1, max: 1000 }), validate], asyncHandler(async (req, res) => send(req, res, await service.voidChangeEvent({ ...scope(req), changeEventId: req.params.changeEventId, payload: req.body, actor: actorFor(req) }))));

module.exports = router;
