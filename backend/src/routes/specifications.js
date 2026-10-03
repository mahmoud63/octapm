const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/specification.service");
const { documentViewer } = require("../services/document-text.service");
const { boqFigureAccess } = require("../utils/boq-figures");

/** Specifications and scope intelligence (OCTA-AI-SPEC-036): `/projects/:projectId/specifications`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const user = (req) => ({ ...req.user, role: getEffectiveRole(req) });
// The BOQ coverage, the related BOQ rows and the prompt's BOQ lines go only
// to a member who may read the BOQ (boq-figures.js; owner check 2026-09-29).
const access = (req) => boqFigureAccess(req);
// Who reads, as every door to a document reads them (document-text.service
// documentViewer): the module decision this request makes (role, template,
// party, API key) and a party member's parties and companies. A document,
// its sections and their text go only to a reader of the records it is
// linked from, and a section's related RFIs are those the RFI register lists
// to them (certification R30, R7).
const reader = (req) => ({
  viewer: documentViewer({
    userId: req.user.id,
    projectAccess: req.projectAccess || null,
    canRead: (moduleName) => hasPermission(req, moduleName, "read"),
  }),
  projectAccess: req.projectAccess || {},
});

router.get(
  "/status",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, service.status())),
);

router.get(
  "/documents",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.listDocuments({ ...scope(req), viewer: reader(req).viewer }))),
);

router.post(
  "/index",
  requirePermission("document_control", "update"),
  [body("documentIds").optional().isArray({ max: 50 }), body("documentIds.*").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.scanProject({ ...scope(req), documentIds: req.body.documentIds || null, userId: req.user.id, viewer: reader(req).viewer }))),
);

router.get(
  "/",
  requirePermission("document_control", "read"),
  [query("q").optional().isString().isLength({ max: 200 }), query("division").optional().isString().isLength({ max: 4 }), query("documentId").optional().isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.listSections({ ...scope(req), q: req.query.q || null, division: req.query.division || null, documentId: req.query.documentId || null, viewer: reader(req).viewer }))),
);

router.get(
  "/scope-gaps",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.scopeGaps({ ...scope(req), access: access(req), ...reader(req) }))),
);

router.post(
  "/scope-gaps/explain",
  requirePermission("assistant", "read"),
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.explainScopeGaps({ ...scope(req), user: user(req), access: access(req), ...reader(req) }))),
);

router.get(
  "/:sectionId",
  requirePermission("document_control", "read"),
  [param("sectionId").isUUID(), query("maxChars").optional().isInt({ min: 500, max: 200000 }).toInt(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.getSection({ ...scope(req), sectionId: req.params.sectionId, maxChars: req.query.maxChars || undefined, access: access(req), ...reader(req) }))),
);

router.post(
  "/:sectionId/conflicts",
  requirePermission("assistant", "read"),
  requirePermission("document_control", "read"),
  [param("sectionId").isUUID(), body("sheetIds").optional().isArray({ max: 12 }), body("sheetIds.*").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.findConflicts({ ...scope(req), sectionId: req.params.sectionId, user: user(req), payload: req.body, access: access(req), ...reader(req) }))),
);

router.post(
  "/:sectionId/rfi",
  requirePermission("rfi", "create"),
  [param("sectionId").isUUID(), body("subject").isString().isLength({ min: 3, max: 200 }), body("question").optional({ nullable: true }).isString().isLength({ max: 4000 }), body("discipline").optional({ nullable: true }).isString().isLength({ max: 80 }), body("priority").optional().isIn(["low", "normal", "high", "urgent"]), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.raiseRfi({ ...scope(req), sectionId: req.params.sectionId, user: user(req), projectAccess: req.projectAccess || null, payload: req.body, viewer: reader(req).viewer }), 201)),
);

module.exports = router;
