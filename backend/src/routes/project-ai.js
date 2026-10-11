const express = require("express");
const { body, query } = require("express-validator");
const { validate } = require("../middleware/validate");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, noApiKey } = require("../middleware/rbac");
const briefService = require("../services/ai/project-brief.service");
const reportService = require("../services/ai/project-report.service");
const documentQa = require("../services/ai/document-qa.service");

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

/**
 * @openapi
 * /projects/{projectId}/ai/report:
 *   get:
 *     tags: [AI]
 *     summary: AI project status report - FACT, AI INTERPRETATION and AI RECOMMENDATION kept apart
 *     description: "`facts` and `attention` are OctaPM's own figures and records for the caller; `interpretation` and `recommendations` are the model's, each citing the numbered `sources` (uncited recommendations are dropped). Without AI only the facts are returned (`degraded`)."
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Status report }
 */
router.get(
  "/report",
  requirePermission("assistant", "read"),
  asyncHandler(async (req, res) => {
    req.aiProjectId = req.params.projectId;
    return sendSuccess(res, await reportService.report({ req, projectId: req.params.projectId }));
  }),
);

/**
 * @openapi
 * /projects/{projectId}/ai/documents/ask:
 *   post:
 *     tags: [AI]
 *     summary: Document Q&A - a question answered from the passages of documents the caller may read
 *     description: "With `documentIds`, every one must be readable by the caller (else 404); without, the project's documents are found by the caller's own document search (needs document_control read). `passages` are always returned; `answer` cites them, or is null when AI is unavailable (`degraded`). `insufficient` when no passage matches."
 *     parameters:
 *       - { in: path, name: projectId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question]
 *             properties:
 *               question: { type: string, maxLength: 1000 }
 *               documentIds: { type: array, maxItems: 10, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Answer with passages }
 */
router.post(
  "/documents/ask",
  requirePermission("assistant", "read"),
  [
    body("question").isString().trim().isLength({ min: 3, max: 1000 }),
    body("documentIds").optional({ nullable: true }).isArray({ max: 10 }),
    body("documentIds.*").isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    req.aiProjectId = req.params.projectId;
    return sendSuccess(res, await documentQa.ask({ req, projectId: req.params.projectId, question: req.body.question, documentIds: req.body.documentIds || null }));
  }),
);

module.exports = router;
