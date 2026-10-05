const express = require("express");
const { body, param } = require("express-validator");
const { scalarFigure } = require("../utils/figure-input");
const { dateInput } = require("../utils/date-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { validate } = require("../middleware/validate");
const service = require("../services/change-event.service");

/**
 * Vendor quotation portal (OCTA-COM-CE-038): `/public/rfqs/:token`. No
 * login — the token from the RFQ email is the credential; every response
 * is scoped to that one request, so vendors never see each other's quotes.
 */
const router = express.Router();

const tokenParam = param("token").isString().trim().isLength({ min: 20, max: 200 });

router.get("/:token", [tokenParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.portalView(req.params.token))));

router.put(
  "/:token/quote",
  [tokenParam, body("lines").optional().isArray({ max: 200 }), body("lines.*.lineId").isString(), body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }), body("validUntil").optional({ nullable: true }).custom(dateInput), body("leadTimeDays").optional({ nullable: true }).custom(scalarFigure).bail().isInt({ min: 0, max: 3650 }), body("quotedBy").optional({ nullable: true }).isString().trim().isLength({ max: 120 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.portalSubmitQuote(req.params.token, req.body))),
);

router.post("/:token/decline", [tokenParam, body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.portalDecline(req.params.token, { reason: req.body?.reason || null }))));

module.exports = router;
