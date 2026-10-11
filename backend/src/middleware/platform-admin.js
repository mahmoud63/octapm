/**
 * The gate for /api/v1/platform-admin (docs/platform/OCTAPM_SUPERADMIN_DESIGN.md §2).
 *
 * Fails closed, and is the only authority — the web console hiding its
 * navigation is a convenience, not a control:
 * - no / bad / expired bearer token → 401 (as everywhere);
 * - a public API key → 403: keys act for an organisation, never the platform;
 * - an inactive person → 401 USER_INACTIVE;
 * - anyone without an active PlatformUserAccess row → 403
 *   PLATFORM_ACCESS_REQUIRED — company admins, owners, PMs, every catalogue
 *   role and every membership included. Organisation standing is not read;
 * - MFA not enrolled where it is required → 403 PLATFORM_MFA_REQUIRED;
 * - a session that did not prove the second factor itself, or proved it more
 *   than PLATFORM_ADMIN_SESSION_MAX_HOURS ago → 403 PLATFORM_MFA_SESSION_REQUIRED
 *   (a customer-application session on the same identity is not enough, on any host);
 * - a token from before the identity's last credential event → 401 SESSION_REVOKED.
 *
 * The host the request came from (admin.octapm.com or any other) is never read:
 * a hostname chooses a screen, it grants nothing.
 *
 * It accepts a workspace-bound access token or the identity token a sign-in
 * with several workspaces returns: platform access belongs to the person, not
 * to any one workspace, so the bound workspace is irrelevant here (and is not
 * put on req.user — platform handlers have no tenant).
 */
const { mfaProvenAt, tokenEpoch, verifyAccessToken } = require("../utils/tokens");
const { HttpError } = require("../utils/http-error");
const { API_KEY_PREFIX } = require("../services/api-client.service");
const { resolvePlatformPrincipal } = require("../services/platform/platform-access.service");
const platformAudit = require("../services/platform/platform-audit.service");

const parseBearer = (header) => {
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
};

const DENIAL = Object.freeze({
  USER_INACTIVE: () => new HttpError(401, "USER_INACTIVE", "This account is no longer active"),
  NO_ACCESS: () => new HttpError(403, "PLATFORM_ACCESS_REQUIRED", "This area is for OctaPM platform operators only."),
  MFA_REQUIRED: () =>
    new HttpError(403, "PLATFORM_MFA_REQUIRED", "Platform access requires two-factor authentication on this account."),
  MFA_SESSION_REQUIRED: () =>
    new HttpError(403, "PLATFORM_MFA_SESSION_REQUIRED", "Sign in again with your authentication code to open Platform Administration."),
  SESSION_REVOKED: () => new HttpError(401, "SESSION_REVOKED", "This session has ended; sign in again"),
});

const requirePlatformAdmin = async (req, _res, next) => {
  try {
    const token = parseBearer(req.headers.authorization);
    if (!token) throw new HttpError(401, "AUTH_REQUIRED", "Missing or invalid Authorization header");
    if (token.startsWith(API_KEY_PREFIX)) {
      throw DENIAL.NO_ACCESS();
    }
    let payload;
    try {
      payload = verifyAccessToken(token, { allowIdentity: true });
    } catch (error) {
      if (error.name === "TokenExpiredError") throw new HttpError(401, "TOKEN_EXPIRED", "Access token has expired");
      if (error.name === "JsonWebTokenError") throw new HttpError(401, "INVALID_TOKEN", "Access token is invalid");
      throw error;
    }
    const result = await resolvePlatformPrincipal(payload.sub, {
      session: { epoch: tokenEpoch(payload), mfaAt: mfaProvenAt(payload) },
    });
    if (!result.ok) {
      // Every refusal of a verified token subject is audited, an inactive or
      // deleted account included (pre-merge review CX-3).
      platformAudit.recordDenied({
        userId: payload.sub,
        email: result.user?.email || payload.email,
        reason: result.reason,
        req,
        statusCode: result.reason === "USER_INACTIVE" || result.reason === "SESSION_REVOKED" ? 401 : 403,
      });
      throw DENIAL[result.reason]();
    }
    req.platformAdmin = result.principal;
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Per-route audit: awaits the trail entry before the handler runs (no entry →
 * 503 PLATFORM_AUDIT_UNAVAILABLE, nothing served), then records the final
 * status when the response finishes. `targetOf(req)` names what was looked at.
 */
const auditPlatformAction = (action, targetOf = () => ({})) => async (req, res, next) => {
  try {
    const target = targetOf(req) || {};
    let entry;
    try {
      entry = await platformAudit.openEntry({ actor: req.platformAdmin, action, target, req });
    } catch {
      throw new HttpError(503, "PLATFORM_AUDIT_UNAVAILABLE", "The platform audit trail cannot be written; nothing was served.");
    }
    res.once("finish", () => {
      platformAudit.closeEntry(entry.id, { statusCode: res.statusCode, target: res.locals.platformTarget || target });
    });
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { auditPlatformAction, requirePlatformAdmin };
