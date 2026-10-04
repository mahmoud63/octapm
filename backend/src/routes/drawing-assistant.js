const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/drawing-assistant.service");

/** Drawing intelligence (OCTA-AI-DWG-035): `/projects/:projectId/drawings/ai`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const user = (req) => ({ ...req.user, role: getEffectiveRole(req) });
const reviewPermission = requirePermission("document_control", "submit", { transition: "document.revision.upload" });

router.get(
  "/status",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, service.status())),
);

router.post(
  "/sets/:setId/read",
  requirePermission("assistant", "read"),
  reviewPermission,
  [
    param("setId").isUUID(),
    body("pages").isArray({ min: 1, max: 12 }),
    body("pages.*.revisionId").isString().isUUID(),
    body("pages.*.image").isString().isLength({ min: 32, max: 3_000_000 }),
    body("apply").optional().isBoolean().toBoolean(),
    body("overwrite").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.readTitleBlocks({ ...scope(req), setId: req.params.setId, user: user(req), payload: req.body }))),
);

router.post(
  "/sets/:setId/references",
  reviewPermission,
  [param("setId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.buildSetReferences({ ...scope(req), setId: req.params.setId }))),
);

router.get(
  "/sheets/:sheetId/references",
  requirePermission("document_control", "read"),
  [param("sheetId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.listReferences({ ...scope(req), sheetId: req.params.sheetId }))),
);

router.post(
  "/sheets/:sheetId/references",
  reviewPermission,
  [param("sheetId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.buildSheetReferences({ ...scope(req), sheetId: req.params.sheetId }))),
);

router.post(
  "/sheets/:sheetId/compare",
  requirePermission("assistant", "read"),
  requirePermission("document_control", "read"),
  [
    param("sheetId").isUUID(),
    body("a.revisionId").isString().isUUID(),
    body("a.image").isString().isLength({ min: 32, max: 3_000_000 }),
    body("b.revisionId").isString().isUUID(),
    body("b.image").isString().isLength({ min: 32, max: 3_000_000 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.compareRevisions({ ...scope(req), sheetId: req.params.sheetId, user: user(req), payload: req.body }))),
);

module.exports = router;
