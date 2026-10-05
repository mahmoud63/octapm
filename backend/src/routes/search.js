const express = require("express");
const { query } = require("express-validator");
const { dateInput } = require("../utils/date-input");
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
    query("projectId").isString().optional({ values: "falsy" }).isUUID(),
    query("status").optional().isString().trim().isLength({ max: 255 }),
    query("statuses").optional().isString().trim().isLength({ max: 255 }),
    query("dateFrom").isString().optional({ values: "falsy" }).custom(dateInput),
    query("dateTo").isString().optional({ values: "falsy" }).custom(dateInput),
    query("from").isString().optional({ values: "falsy" }).custom(dateInput),
    query("to").isString().optional({ values: "falsy" }).custom(dateInput),
    // The service also reads these aliases of the range (search.service.js
    // parseDateRange); unchecked, "notadate", a value sent twice or ?x[k]=v
    // became an Invalid Date in the query and a 500 (CERT-2).
    query("updatedAfter").isString().optional({ values: "falsy" }).custom(dateInput),
    query("updatedBefore").isString().optional({ values: "falsy" }).custom(dateInput),
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
    query("limit").isString().optional().isInt({ min: 1, max: 50 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await searchService.globalSearch({
      orgId: req.user.orgId,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: Boolean(req.user.isCompanyAdmin),
      query: req.query,
      apiClient: req.apiClient || null,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
