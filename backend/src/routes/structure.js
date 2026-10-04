const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { boqFigureAccess, withheldWbsList } = require("../utils/boq-figures");
const wbsService = require("../services/wbs.service");
const uomService = require("../services/uom.service");

/**
 * Project-controls structure (PC-1): the WBS tree of a project and the
 * organisation's units of measure, mounted at /projects/:projectId/structure.
 *
 * Both are gated by the `boq` module — structure is what the bill and the
 * programme are grouped by, and the integration doc (§2) keeps the controls
 * pages on `boq` read/update rather than adding a catalogue module. The one
 * exception is reading the WBS outline, open to schedule readers too (D3).
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const wbsPayloadValidators = ({ requireCore = false } = {}) => [
  requireCore
    ? body("code").isString().trim().isLength({ min: 1, max: 60 })
    : body("code").optional().isString().trim().isLength({ min: 1, max: 60 }),
  requireCore
    ? body("name").isString().trim().isLength({ min: 1, max: 160 })
    : body("name").optional().isString().trim().isLength({ min: 1, max: 160 }),
  body("parentId").optional({ nullable: true }).isString().isUUID(),
  body("sortOrder").optional({ nullable: true }).isInt({ min: 0 }).toInt(),
  body("isPackage").optional().isBoolean().toBoolean(),
  body("ownerPartyId").optional({ nullable: true }).isString().isUUID(),
  body("commitmentId").optional({ nullable: true }).isString().isUUID(),
  body("externalId").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  validate,
];

const reasonValidators = [
  param("id").isUUID(),
  body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  validate,
];

// ─── WBS ─────────────────────────────────────────────────────────────────────

// The WBS outline is read by anyone who can read the schedule (owner
// decision D3): the Schedule's WBS tab is built from it. A BOQ reader keeps
// the whole answer exactly as before; a schedule reader who may not read the
// BOQ gets the outline (utils/boq-figures withheldWbsList). Writes stay on
// boq:update below.
const wbsOutlineReader = (req, res, next) =>
  req.user && hasPermission(req, "boq", "read")
    ? next()
    : requirePermission("schedule", "read")(req, res, next);

router.get(
  "/wbs",
  wbsOutlineReader,
  [query("includeArchived").isString().optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => {
    const result = await wbsService.listWbsNodes({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    return sendSuccess(res, withheldWbsList(result, boqFigureAccess(req)));
  }),
);

router.post(
  "/wbs",
  requirePermission("boq", "update"),
  wbsPayloadValidators({ requireCore: true }),
  asyncHandler(async (req, res) => {
    const result = await wbsService.createWbsNode({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  "/wbs/:id",
  requirePermission("boq", "update"),
  [param("id").isUUID(), ...wbsPayloadValidators()],
  asyncHandler(async (req, res) => {
    const result = await wbsService.updateWbsNode({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      nodeId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/wbs/:id/archive",
  requirePermission("boq", "update"),
  reasonValidators,
  asyncHandler(async (req, res) => {
    const result = await wbsService.archiveWbsNode({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      nodeId: req.params.id,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/wbs/:id/restore",
  requirePermission("boq", "update"),
  reasonValidators,
  asyncHandler(async (req, res) => {
    const result = await wbsService.restoreWbsNode({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      nodeId: req.params.id,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

// ─── Units of measure ────────────────────────────────────────────────────────

router.get(
  "/units",
  requirePermission("boq", "read"),
  [query("includeArchived").isString().optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => {
    const result = await uomService.listUnits({
      orgId: req.user.orgId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

// What a spelling resolves to, for a grid to show beside what was typed.
router.get(
  "/units/normalise",
  requirePermission("boq", "read"),
  [query("unit").isString().trim().isLength({ min: 1, max: 40 }), validate],
  asyncHandler(async (req, res) => {
    const result = await uomService.normalise({
      orgId: req.user.orgId,
      unit: req.query.unit,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/units",
  requirePermission("boq", "update"),
  [
    body("code").isString().trim().isLength({ min: 1, max: 16 }),
    body("name").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("dimension").optional({ nullable: true }).isIn(uomService.UNIT_DIMENSIONS),
    body("aliases").optional({ nullable: true }).isArray({ max: 50 }),
    body("aliases.*").isString().trim().isLength({ min: 1, max: 40 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await uomService.createUnit({
      orgId: req.user.orgId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

module.exports = router;
