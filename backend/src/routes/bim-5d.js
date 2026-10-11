const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { canReadBoq } = require("../utils/boq-figures");
const { HttpError } = require("../utils/http-error");
const controlsDetailService = require("../services/controls-detail.service");
const service = require("../services/bim-5d.service");

/**
 * BIM / 5D commercial intelligence (BIM-1..BIM-6), `/projects/:projectId/bim/5d`,
 * behind the project's own access check. Model, element and mapping reads need
 * bim:read; anything that states a BOQ quantity also needs the BOQ (canReadBoq,
 * the rule every BOQ figure follows); executed / approved / certified / paid
 * are read through the official quantity engine as the caller (can(module)).
 */
const router = express.Router({ mergeParams: true });

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actorFor = (req) => ({ id: req.user.id, name: req.user.name || null, role: getEffectiveRole(req) });
const requireBoq = (req, _res, next) => (canReadBoq(req) ? next() : next(Object.assign(new HttpError(403, "FORBIDDEN", "BOQ quantities need BOQ read access on this project"), { details: { module: "boq", action: "read" } })));
const modelParam = [param("modelId").isUUID()];

router.get("/overview", requirePermission("bim", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.overview({ ...scope(req), reader: controlsDetailService.detailReader(req), canReadBoq: canReadBoq(req) }))));
router.get("/register", requirePermission("bim", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.revisionRegister(scope(req)))));
router.get("/reconciliation", requirePermission("bim", "read"), requireBoq, [query("tolerancePct").optional().isFloat({ min: 0, max: 50 }).toFloat(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.reconciliation({ ...scope(req), reader: controlsDetailService.detailReader(req), tolerancePct: req.query.tolerancePct ?? 2 }))));

router.get("/boq-items/:boqItemId/elements", requirePermission("bim", "read"), requireBoq, [param("boqItemId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.boqItemElements({ ...scope(req), boqItemId: req.params.boqItemId }))));
router.get("/rules", requirePermission("bim", "read"), requireBoq, asyncHandler(async (req, res) => sendSuccess(res, await service.listRules(scope(req)))));
router.put(
  "/rules/:boqItemId",
  requirePermission("bim", "update", { transition: "bim.link" }),
  requireBoq,
  [
    param("boqItemId").isUUID(),
    body("quantityField").isIn(service.QUANTITY_FIELDS),
    body("allowedTypes").optional().isArray({ max: 40 }),
    body("allowedTypes.*").isString().isLength({ max: 60 }),
    body("factor").optional({ nullable: true }).isFloat({ gt: 0, max: 1e6 }),
    body("rounding").optional({ nullable: true }).isInt({ min: 0, max: 6 }),
    body("unit").optional({ nullable: true }).isString().isLength({ max: 20 }),
    body(["includeText", "excludeText"]).optional({ nullable: true }).isString().isLength({ max: 120 }),
    body("notes").optional({ nullable: true }).isString().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.upsertRule({ ...scope(req), boqItemId: req.params.boqItemId, payload: req.body, actor: actorFor(req) }))),
);

router.get("/models/:modelId/suggestions", requirePermission("bim", "read"), [...modelParam, validate], asyncHandler(async (req, res) => {
  const found = await service.suggestions({ ...scope(req), modelId: req.params.modelId });
  // BOQ suggestions name BOQ items: only for a BOQ reader.
  return sendSuccess(res, canReadBoq(req) ? found : { ...found, boq: [] });
}));
router.post(
  "/models/:modelId/apply-suggestions",
  requirePermission("bim", "update", { transition: "bim.link" }),
  [...modelParam, body("kinds").optional().isArray({ max: 2 }), body("kinds.*").isIn(["location", "boq"]), validate],
  asyncHandler(async (req, res) => {
    const kinds = (req.body.kinds || ["location", "boq"]).filter((kind) => kind !== "boq" || canReadBoq(req));
    return sendSuccess(res, await service.applySuggestions({ ...scope(req), modelId: req.params.modelId, kinds, actor: actorFor(req) }));
  }),
);
router.post(
  "/models/:modelId/map-boq",
  requirePermission("bim", "update", { transition: "bim.link" }),
  requireBoq,
  [...modelParam, body("boqItemId").isUUID(), body("elementIds").isArray({ min: 1, max: 5000 }), body("elementIds.*").isUUID(), body("quantityField").optional({ nullable: true }).isIn(service.QUANTITY_FIELDS), body("method").optional().isIn(["manual", "bulk"]), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.mapToBoq({ ...scope(req), modelId: req.params.modelId, boqItemId: req.body.boqItemId, elementIds: req.body.elementIds, quantityField: req.body.quantityField || null, method: req.body.method || (req.body.elementIds.length > 1 ? "bulk" : "manual"), actor: actorFor(req) }), 201)),
);
router.get("/elements/:elementId/provenance", requirePermission("bim", "read"), [param("elementId").isUUID(), query("boqItemId").optional().isUUID(), validate], asyncHandler(async (req, res) => {
  const answer = await service.provenance({ ...scope(req), elementId: req.params.elementId, boqItemId: req.query.boqItemId || null });
  // The BOQ quantities only for a BOQ reader; identity, model, location and activity for every BIM reader.
  return sendSuccess(res, canReadBoq(req) ? answer : { ...answer, quantities: [], quantitiesWithheld: "BOQ quantities need BOQ read access on this project" });
}));

// ─── Second batch (BIM-7..BIM-11) ─────────────────────────────────────────
const changes = require("../services/bim-5d-changes.service");
const { hasPermission } = require("../middleware/rbac");

router.get(
  "/models/:modelId/diff",
  requirePermission("bim", "read"),
  [...modelParam, query("fromModelId").optional().isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await changes.compareRevisions({ ...scope(req), toModelId: req.params.modelId, fromModelId: req.query.fromModelId || null, reader: controlsDetailService.detailReader(req), canReadBoq: canReadBoq(req) }))),
);
// Opens a review for each BOQ-impacting change of the revision (decided reviews keep their decision).
router.post(
  "/models/:modelId/diff/reviews",
  requirePermission("bim", "update", { transition: "bim.link" }),
  [...modelParam, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await changes.compareRevisions({ ...scope(req), toModelId: req.params.modelId, reader: controlsDetailService.detailReader(req), canReadBoq: canReadBoq(req), persistReviews: true }))),
);
router.post(
  "/models/:modelId/carry-forward",
  requirePermission("bim", "update", { transition: "bim.link" }),
  requireBoq,
  [...modelParam, validate],
  asyncHandler(async (req, res) => sendSuccess(res, await changes.carryForward({ ...scope(req), toModelId: req.params.modelId, actor: actorFor(req) }))),
);
router.get("/duplicates", requirePermission("bim", "read"), requireBoq, asyncHandler(async (req, res) => sendSuccess(res, await changes.duplicates(scope(req)))));
router.get("/elements/:elementId/commercial", requirePermission("bim", "read"), [param("elementId").isUUID(), validate], asyncHandler(async (req, res) => {
  const state = await changes.elementCommercialState({ ...scope(req), elementId: req.params.elementId, reader: controlsDetailService.detailReader(req) });
  // Certified and paid are BOQ quantities: only for a BOQ reader.
  return sendSuccess(res, canReadBoq(req) ? state : { ...state, certified: null, paid: null });
}));
router.get("/elements/:elementId/history", requirePermission("bim", "read"), [param("elementId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await changes.elementHistory({ ...scope(req), elementId: req.params.elementId }))));
router.get("/reviews", requirePermission("bim", "read"), [query("status").optional().isIn(["open", "ignored", "associated", "draft_created"]), validate], asyncHandler(async (req, res) => sendSuccess(res, await changes.listReviews({ ...scope(req), status: req.query.status || null }))));
router.post(
  "/reviews/:reviewId/decision",
  requirePermission("bim", "update", { transition: "bim.link" }),
  [param("reviewId").isUUID(), body("action").isIn(["ignore", "associate", "draft_change_event", "reopen"]), body("changeEventId").optional({ nullable: true }).isUUID(), body("note").optional({ nullable: true }).isString().isLength({ max: 1000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await changes.decideReview({ ...scope(req), reviewId: req.params.reviewId, action: req.body.action, changeEventId: req.body.changeEventId || null, note: req.body.note || null, actor: actorFor(req), canCreateChangeEvent: hasPermission(req, "change_event", "create"), reader: controlsDetailService.detailReader(req), canReadBoq: canReadBoq(req) }))),
);

module.exports = router;
