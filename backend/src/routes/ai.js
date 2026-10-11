const express = require("express");
const { query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { dateInput } = require("../utils/date-input");
const { authenticate } = require("../middleware/auth");
const { requireCompanyAdmin, noApiKey } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const gateway = require("../services/ai/gateway");
const usage = require("../services/ai/usage");
const smartSearch = require("../services/ai/smart-search.service");

/**
 * The AI platform's organisation routes (AI-1), mounted at /api/v1/ai.
 *
 *   GET /capabilities  what AI can do on this server (enabled, mode mock|live|disabled, features);
 *                      provider and model names only for company admins (AI-0 audit S3)
 *   GET /usage         the company's AI usage by feature and status, company admins only;
 *                      no prompt or answer content is ever stored or returned
 *   GET /search        Smart Search (AI-4), over the caller's own authorised search
 */
const router = express.Router();
router.use(authenticate);

router.get(
  "/capabilities",
  asyncHandler(async (req, res) => sendSuccess(res, gateway.capabilities({ detailed: Boolean(req.user?.isCompanyAdmin) }))),
);

router.get(
  "/usage",
  noApiKey,
  requireCompanyAdmin,
  [query("from").optional().isString().custom(dateInput), query("to").optional().isString().custom(dateInput), validate],
  asyncHandler(async (req, res) => {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    sendSuccess(res, await usage.summary({ orgId: req.user.orgId, from, to }));
  }),
);

/**
 * @openapi
 * /ai/search:
 *   get:
 *     tags: [AI]
 *     summary: Smart Search - a plain-language query turned into OctaPM's search filters
 *     description: Results come only from the caller's authorised search and dashboard queues; `interpretation` shows the filters chosen. `explain=true` adds an AI answer citing the results (null when AI is unavailable).
 *     parameters:
 *       - { in: query, name: q, required: true, schema: { type: string, maxLength: 300 } }
 *       - { in: query, name: projectId, schema: { type: string, format: uuid } }
 *       - { in: query, name: explain, schema: { type: boolean, default: false } }
 *     responses:
 *       200: { description: Results with interpretation }
 */
router.get(
  "/search",
  noApiKey,
  [
    query("q").isString().trim().isLength({ min: 2, max: 300 }),
    query("projectId").optional().isString().isUUID(),
    query("explain").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await smartSearch.search({ req, q: req.query.q, projectId: req.query.projectId || null, explain: req.query.explain === true })),
  ),
);

module.exports = router;
