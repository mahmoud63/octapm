const express = require("express");
const { body, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { subscriptionGate } = require("../middleware/subscription-gate");
const { validate } = require("../middleware/validate");
const companyPartyService = require("../services/company-party.service");

const router = express.Router();

router.use(authenticate);
router.use(subscriptionGate);

const companyValidators = [
  body("name").isString().trim().notEmpty().isLength({ max: 255 }),
  body("legalName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("tradeName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("registrationNumber").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("taxNumber").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("type").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("email").optional({ nullable: true }).isEmail().normalizeEmail(),
  body("phone").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("website").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("address").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("status").optional().isIn(["active", "inactive"]),
];

router.get(
  "/",
  requirePermission("project_parties", "read"),
  [
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").optional().isIn(["active", "inactive"]),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await companyPartyService.listCompanies({
      orgId: req.user.orgId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  requirePermission("project_parties", "create", {
    transition: "party.assign",
  }),
  [...companyValidators, validate],
  asyncHandler(async (req, res) => {
    const result = await companyPartyService.createCompany({
      orgId: req.user.orgId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

module.exports = router;
