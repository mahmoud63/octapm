const { body, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { validate } = require("../middleware/validate");
const { authenticate, requireCredentialSession } = require("../middleware/auth");
const { noApiKey } = require("../middleware/rbac");
const { loginLimiter } = require("../middleware/rate-limit");
const authService = require("../services/auth.service");
const mfaService = require("../services/mfa.service");
const ssoService = require("../services/sso.service");
const { RETURN_SURFACES } = require("../config/domains");

/**
 * Two-factor and single sign-on endpoints (OCTA-SEC-AUTH-040), registered
 * on the `/auth` router so they share its cookie helpers and rate limits.
 */
const register = (router, { sendSession, getRequestContext }) => {
  // ── MFA: second login step ──
  router.post(
    "/mfa/verify",
    loginLimiter,
    [body("mfaToken").isString().isLength({ min: 20 }), body("code").isString().trim().isLength({ min: 6, max: 12 }), validate],
    asyncHandler(async (req, res) => {
      const result = await authService.completeMfaLogin(req.body, getRequestContext(req));
      // The second factor is proven; with no single workspace to enter the
      // answer is the workspace choice, as at the first login step.
      if (result.chooseWorkspace || result.needsWorkspace) return sendSuccess(res, result);
      return sendSession(req, res, result);
    }),
  );

  // ── MFA: enrolment and management (signed in) ──
  // A change to the identity's own second factor needs a session the person
  // opened with their own credentials, never one a company's SSO issued (D-ID-1 Q2).
  router.get("/mfa", authenticate, asyncHandler(async (req, res) => sendSuccess(res, await mfaService.status({ userId: req.user.id }))));
  router.post("/mfa/setup", authenticate, noApiKey, requireCredentialSession, asyncHandler(async (req, res) => sendSuccess(res, await mfaService.beginEnrollment({ userId: req.user.id, epoch: req.user.credentialEpoch }))));
  router.post("/mfa/enable", authenticate, noApiKey, requireCredentialSession, [body("code").isString().trim().isLength({ min: 6, max: 8 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await mfaService.enable({ userId: req.user.id, code: req.body.code, epoch: req.user.credentialEpoch, context: getRequestContext(req) }))));
  router.post("/mfa/disable", authenticate, noApiKey, requireCredentialSession, [body("password").isString().notEmpty(), body("code").isString().trim().isLength({ min: 6, max: 12 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await mfaService.disable({ userId: req.user.id, password: req.body.password, code: req.body.code, epoch: req.user.credentialEpoch, context: getRequestContext(req) }))));
  router.post("/mfa/backup-codes", authenticate, noApiKey, requireCredentialSession, [body("code").isString().trim().isLength({ min: 6, max: 8 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await mfaService.regenerateBackupCodes({ userId: req.user.id, code: req.body.code, epoch: req.user.credentialEpoch, context: getRequestContext(req) }))));

  // ── SSO ──
  router.get("/sso/lookup", [query("email").isString().isEmail(), validate], asyncHandler(async (req, res) => sendSuccess(res, await ssoService.lookup({ email: req.query.email }))));
  router.post("/sso/start", loginLimiter, [body("email").optional({ nullable: true }).isString().isEmail(), body("orgId").optional({ nullable: true }).isString().isUUID(), body("redirectTo").optional({ nullable: true }).isString().isLength({ max: 500 }), body("surface").optional({ nullable: true }).isString().isIn(RETURN_SURFACES), validate], asyncHandler(async (req, res) => sendSuccess(res, await ssoService.start({ email: req.body.email || null, orgId: req.body.orgId || null, redirectTo: req.body.redirectTo || null, surface: req.body.surface || null }))));
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
      return sendSession(req, res, result);
    }),
  );
};

module.exports = { register };
