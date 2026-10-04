const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/rfi-assistant.service");

/**
 * RFI drafting and response assistant (OCTA-AI-RFI-029). Mounted inside the
 * RFI router (`/projects/:projectId/rfi`), which already authenticates and
 * resolves project access; every route also needs the `assistant` module so
 * API keys without `assistant:read` cannot spend model calls.
 */
const router = express.Router({ mergeParams: true });

const actor = (req) => ({ orgId: req.user.orgId, user: { ...req.user, role: getEffectiveRole(req) }, projectId: req.params.projectId, projectAccess: req.projectAccess || null });

router.post(
  "/ai/draft",
  requirePermission("assistant", "read"),
  requirePermission("rfi", "create"),
  [
    body("prompt").isString().trim().isLength({ min: 1, max: 4000 }),
    body("specSection").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body("discipline").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body("activityId").optional({ nullable: true }).isString().isUUID(),
    body("locationId").optional({ nullable: true }).isString().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.draftQuestion({ ...actor(req), payload: req.body }))),
);

router.get(
  "/ai/similar",
  requirePermission("assistant", "read"),
  requirePermission("rfi", "read"),
  [
    query("q").isString().trim().isLength({ min: 3, max: 300 }),
    query("limit").isString().optional().isInt({ min: 1, max: 10 }).toInt(),
    query("excludeRfiId").isString().optional({ values: "falsy" }).isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.similar({ ...actor(req), q: req.query.q, limit: req.query.limit || 5, excludeRfiId: req.query.excludeRfiId || null }))),
);

router.post(
  "/:rfiId/ai/response",
  requirePermission("assistant", "read"),
  requirePermission("rfi", "submit"),
  [param("rfiId").isUUID(), body("instructions").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.suggestResponse({ ...actor(req), rfiId: req.params.rfiId, payload: req.body }))),
);

router.post(
  "/:rfiId/ai/summary",
  requirePermission("assistant", "read"),
  requirePermission("rfi", "read"),
  [param("rfiId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.summarize({ ...actor(req), rfiId: req.params.rfiId }))),
);

module.exports = router;
