const { body, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { validate } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rate-limit");
const authService = require("../services/auth.service");
const mfaService = require("../services/mfa.service");
const ssoService = require("../services/sso.service");

/**
 * Two-factor and single sign-on endpoints (OCTA-SEC-AUTH-040), registered
 * on the `/auth` router so they share its cookie helpers and rate limits.
 */
const register = (router, { setRefreshCookie, toPublicAuthResponse, getRequestContext }) => {
  // ── MFA: second login step ──
  router.post(
    "/mfa/verify",
    loginLimiter,
    [body("mfaToken").isString().isLength({ min: 20 }), body("code").isString().trim().isLength({ min: 6, max: 12 }), validate],
    asyncHandler(async (req, res) => {
      const result = await authService.completeMfaLogin(req.body, getRequestContext(req));
      setRefreshCookie(res, result);
      return sendSuccess(res, toPublicAuthResponse(result));
    }),
  );

  // ── MFA: enrolment and management (signed in) ──
  router.get("/mfa", authenticate, asyncHandler(async (req, res) => sendSuccess(res, await mfaService.status({ userId: req.user.id }))));
  router.post("/mfa/setup", authenticate, asyncHandler(async (req, res) => sendSuccess(res, await mfaService.beginEnrollment({ userId: req.user.id }))));
  router.post("/mfa/enable", authenticate, [body("code").isString().trim().isLength({ min: 6, max: 8 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await mfaService.enable({ userId: req.user.id, code: req.body.code, context: getRequestContext(req) }))));
  router.post("/mfa/disable", authenticate, [body("password").isString().notEmpty(), body("code").isString().trim().isLength({ min: 6, max: 12 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await mfaService.disable({ userId: req.user.id, password: req.body.password, code: req.body.code, context: getRequestContext(req) }))));
  router.post("/mfa/backup-codes", authenticate, [body("code").isString().trim().isLength({ min: 6, max: 8 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await mfaService.regenerateBackupCodes({ userId: req.user.id, code: req.body.code, context: getRequestContext(req) }))));

  // ── SSO ──
  router.get("/sso/lookup", [query("email").isEmail(), validate], asyncHandler(async (req, res) => sendSuccess(res, await ssoService.lookup({ email: req.query.email }))));
  router.post("/sso/start", loginLimiter, [body("email").optional({ nullable: true }).isEmail(), body("orgId").optional({ nullable: true }).isUUID(), body("redirectTo").optional({ nullable: true }).isString().isLength({ max: 500 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await ssoService.start({ email: req.body.email || null, orgId: req.body.orgId || null, redirectTo: req.body.redirectTo || null }))));
  router.get(
    "/sso/callback",
    asyncHandler(async (req, res) => {
      const result = await ssoService.callback({ code: req.query.code, state: req.query.state, error: req.query.error || null, errorDescription: req.query.error_description || null }, getRequestContext(req));
      return res.redirect(302, result.redirectUrl);
    }),
  );
  router.post(
    "/sso/complete",
    loginLimiter,
    [body("ticket").isString().isLength({ min: 20, max: 200 }), validate],
    asyncHandler(async (req, res) => {
      const result = await ssoService.complete({ ticket: req.body.ticket }, getRequestContext(req));
      setRefreshCookie(res, result);
      return sendSuccess(res, toPublicAuthResponse(result));
    }),
  );
};

module.exports = { register };
