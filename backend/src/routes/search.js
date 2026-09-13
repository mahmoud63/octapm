const express = require("express");
const { query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { subscriptionGate } = require("../middleware/subscription-gate");
const { validate } = require("../middleware/validate");
const searchService = require("../services/search.service");

const router = express.Router();

router.use(authenticate);
router.use(subscriptionGate);

router.get(
  "/",
  [
    query("q").optional().isString().trim().isLength({ max: 120 }),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("type").optional().isString().trim().isLength({ max: 255 }),
    query("types").optional().isString().trim().isLength({ max: 255 }),
    query("projectId").optional({ values: "falsy" }).isUUID(),
    query("status").optional().isString().trim().isLength({ max: 255 }),
    query("statuses").optional().isString().trim().isLength({ max: 255 }),
    query("dateFrom").optional({ values: "falsy" }).isISO8601(),
    query("dateTo").optional({ values: "falsy" }).isISO8601(),
    query("from").optional({ values: "falsy" }).isISO8601(),
    query("to").optional({ values: "falsy" }).isISO8601(),
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await searchService.globalSearch({
      orgId: req.user.orgId,
      userId: req.user.id,
      role: req.user.role,
      query: req.query,
      apiClient: req.apiClient || null,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
