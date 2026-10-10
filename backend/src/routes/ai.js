const express = require("express");
const { query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requireCompanyAdmin, noApiKey } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const gateway = require("../services/ai/gateway");
const usage = require("../services/ai/usage");

/**
 * The AI platform's organisation routes (AI-1), mounted at /api/v1/ai.
 *
 *   GET /capabilities  what AI can do on this server (enabled, mode mock|live|disabled, features);
 *                      provider and model names only for company admins (AI-0 audit S3)
 *   GET /usage         the company's AI usage by feature and status, company admins only;
 *                      no prompt or answer content is ever stored or returned
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
  [query("from").optional().isISO8601(), query("to").optional().isISO8601(), validate],
  asyncHandler(async (req, res) => {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    sendSuccess(res, await usage.summary({ orgId: req.user.orgId, from, to }));
  }),
);

module.exports = router;
