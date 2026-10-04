const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/photo-assistant.service");
const { documentViewer } = require("../services/document-text.service");

/**
 * Photo and safety intelligence (OCTA-AI-PHOTO-034). Mounted inside the
 * photo router (`/projects/:projectId/photos`), which already authenticates
 * and resolves project access; `/ai/*` sits before `/:photoId`.
 */
const router = express.Router({ mergeParams: true });

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const user = (req) => ({ ...req.user, role: getEffectiveRole(req) });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
// Who reads (document-text.service documentViewer): the assistant works only
// on a photo whose document the caller may read (certification R31).
const viewer = (req) =>
  documentViewer({
    userId: req.user.id,
    projectAccess: req.projectAccess || null,
    canRead: (moduleName) => hasPermission(req, moduleName, "read"),
  });

router.get(
  "/ai/status",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, service.status())),
);

router.post(
  "/ai/analyze",
  requirePermission("assistant", "read"),
  requirePermission("document_control", "create"),
  [
    body("photoIds").optional().isArray({ max: 40 }),
    body("photoIds.*").isString().isUUID(),
    body("from").optional({ nullable: true }).isString().isISO8601(),
    body("to").optional({ nullable: true }).isString().isISO8601(),
    body("uncaptionedOnly").optional().isBoolean().toBoolean(),
    body("force").optional().isBoolean().toBoolean(),
    body("limit").optional().isInt({ min: 1, max: 40 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.analyzeBatch({ ...scope(req), user: user(req), payload: req.body, viewer: viewer(req) }))),
);

router.get(
  "/:photoId/ai",
  requirePermission("document_control", "read"),
  [param("photoId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.latestAnalysis({ ...scope(req), photoId: req.params.photoId, viewer: viewer(req) }))),
);

router.post(
  "/:photoId/ai/analyze",
  requirePermission("assistant", "read"),
  requirePermission("document_control", "create"),
  [param("photoId").isUUID(), body("force").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.analyzePhoto({ ...scope(req), photoId: req.params.photoId, user: user(req), force: Boolean(req.body?.force), viewer: viewer(req) }))),
);

router.post(
  "/:photoId/ai/apply",
  requirePermission("document_control", "create"),
  [
    param("photoId").isUUID(),
    body("caption").optional({ nullable: true }).isString().trim().isLength({ max: 300 }),
    body("tags").optional().isArray({ max: 10 }),
    body("tags.*").isString().trim().isLength({ min: 1, max: 40 }),
    body("locationId").optional({ nullable: true }).isString().isUUID(),
    body("overwrite").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.applyAnalysis({ ...scope(req), photoId: req.params.photoId, payload: req.body, actor: actor(req), viewer: viewer(req) }))),
);

router.post(
  "/:photoId/ai/observation",
  requirePermission("punch", "create"),
  [
    param("photoId").isUUID(),
    body("hazard").isString().trim().isLength({ min: 1, max: 120 }),
    body("description").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    body("severity").optional({ nullable: true }).isIn(service.SEVERITIES),
    body("contributingCondition").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("trade").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("locationId").optional({ nullable: true }).isString().isUUID(),
    body("assigneeCompanyId").optional({ nullable: true }).isString().isUUID(),
    body("dueDate").optional({ nullable: true }).isString().isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.raiseObservation({ ...scope(req), photoId: req.params.photoId, payload: req.body, actor: actor(req), viewer: viewer(req) }), 201)),
);

module.exports = router;
