const express = require("express");
const { query } = require("express-validator");
const { validate } = require("../middleware/validate");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, noApiKey } = require("../middleware/rbac");
const briefService = require("../services/ai/project-brief.service");

/**
 * Project-level AI (AI-3), mounted at /projects/:projectId/ai behind the
 * project's own access check. The assistant permission admits the feature;
 * what it reads is then decided module by module as the dashboard decides
 * it (services/ai/sources/workspace-snapshot), before any model call.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);
// Briefs are written for the person reading them, under their own access;
// an API key has the report assistant and nothing here (as /assistant).
router.use(noApiKey);

// `narrative=false` returns the facts and the list without calling a model:
// the overview loads that on every visit and asks for the narrative only
// when the reader does (cost control).
const briefRoute = (kind) => [
  query("narrative").optional().isBoolean().toBoolean(),
  validate,
  asyncHandler(async (req, res) => {
    req.aiProjectId = req.params.projectId;
    return sendSuccess(res, await briefService.brief({ req, projectId: req.params.projectId, kind, withNarrative: req.query.narrative !== false }));
  }),
];

/**
 * @openapi
 * /projects/{projectId}/ai/attention:
 *   get:
 *     tags: [AI]
 *     summary: What needs attention on the project, with an AI brief when a provider is configured
 *     description: Deterministic attention list and facts from the caller's own dashboard, each linked to its record; `narrative` is an AI interpretation citing them, or null when AI is unavailable (`degraded`).
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: narrative, schema: { type: boolean, default: true }, description: "false: facts and list only, no model call" }
 *     responses:
 *       200: { description: Brief }
 * /projects/{projectId}/ai/summary:
 *   get:
 *     tags: [AI]
 *     summary: Project summary (facts plus an AI narrative citing them)
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Brief }
 */
router.get("/attention", requirePermission("assistant", "read"), briefRoute("attention"));
router.get("/summary", requirePermission("assistant", "read"), briefRoute("summary"));

module.exports = router;
