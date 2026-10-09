const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requireCompanyAdmin } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const ssoService = require("../services/sso.service");
const mfaService = require("../services/mfa.service");
const { disconnectUser } = require("../realtime/socket");

/** Company › Security (OCTA-SEC-AUTH-040): SSO settings and the MFA policy — company admins only. */
const router = express.Router();
router.use(authenticate);
router.use(requireCompanyAdmin);

const actor = (req) => ({ id: req.user.id, role: getEffectiveRole(req) });
const context = (req) => ({ userAgent: req.get("user-agent") || null, ipAddress: req.ip || req.socket?.remoteAddress || null });

router.get("/security", asyncHandler(async (req, res) => sendSuccess(res, await ssoService.securityOverview({ orgId: req.user.orgId }))));
router.put(
  "/security/sso",
  [body("enabled").optional().isBoolean().toBoolean(), body("issuer").optional({ nullable: true }).isString().isLength({ max: 500 }), body("clientId").optional({ nullable: true }).isString().isLength({ max: 500 }), body("clientSecret").optional({ nullable: true }).isString().isLength({ max: 2000 }), body("domains").optional(), body("autoProvision").optional().isBoolean().toBoolean(), body("defaultRole").optional().isIn(ssoService.ROLES), body("required").optional().isBoolean().toBoolean(), body("mfaRequired").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await ssoService.updateSettings({ orgId: req.user.orgId, payload: req.body, actor: actor(req) }))),
);
router.post("/security/sso/test", asyncHandler(async (req, res) => sendSuccess(res, await ssoService.testConnection({ orgId: req.user.orgId }))));
router.post("/security/users/:userId/mfa/reset", [param("userId").isUUID(), validate], asyncHandler(async (req, res) => {
  const result = await mfaService.adminReset({ orgId: req.user.orgId, userId: req.params.userId, actor: actor(req), context: context(req) });
  // Clearing the factor ends every session, live sockets included (D-ID-1 Q6).
  disconnectUser(req.app.get("io"), req.params.userId);
  return sendSuccess(res, result);
}));

module.exports = router;
