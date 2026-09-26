const { param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { validate } = require("../middleware/validate");
const { loginLimiter } = require("../middleware/rate-limit");
const { verifyAccessToken } = require("../utils/tokens");
const { API_KEY_PREFIX } = require("../services/api-client.service");
const authService = require("../services/auth.service");
const workspaceLinkService = require("../services/workspace-link.service");

/**
 * Workspace session issue (workspace switching doc §2), registered on the
 * `/auth` router so it shares its cookie helpers and rate limits.
 *
 * POST /auth/workspaces/:orgId/session takes any valid access token — bound
 * to whichever workspace — or the identity token a sign-in returns when the
 * person has several workspaces (membership doc §6), and answers with a new
 * access + refresh pair bound to the person's membership in `:orgId`, on the
 * caller's channel. The other workspace's session is not revoked.
 *
 * The token is verified here rather than by `authenticate`: an identity token
 * names no workspace, and this is the one place it is meant to be used other
 * than the caller's own profile. The membership it names (if any) need not be
 * live — a person suspended in one workspace can still enter another.
 */
const tokenError = (error) => {
  if (error.name === "TokenExpiredError") {
    return new HttpError(401, "TOKEN_EXPIRED", "Access token has expired");
  }
  if (error.name === "JsonWebTokenError") {
    return new HttpError(401, "INVALID_TOKEN", "Access token is invalid");
  }
  return error;
};

const subjectOfToken = (req, _res, next) => {
  const [scheme, token] = String(req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return next(new HttpError(401, "AUTH_REQUIRED", "Missing or invalid Authorization header"));
  }
  if (token.startsWith(API_KEY_PREFIX)) {
    return next(new HttpError(403, "API_KEY_FORBIDDEN", "A workspace session cannot be issued to an API key"));
  }
  let payload;
  try {
    payload = verifyAccessToken(token, { allowIdentity: true });
  } catch (error) {
    return next(tokenError(error));
  }
  // An identity token names no workspace; an access token names the one the
  // session is bound to, which is what "is this link's project in the active
  // workspace" is answered against.
  req.tokenSubject = { userId: payload.sub, type: payload.type, orgId: payload.orgId || null };
  return next();
};

/**
 * The same, for a route that works without a session but honours one when
 * it is offered: invitation acceptance, where a bearer for the invited
 * identity is its proof (membership doc §5, §6). No header means no subject;
 * a header that is present must be a valid token — a stale one is an error,
 * not silently nobody.
 */
const optionalTokenSubject = (req, res, next) => {
  if (!req.headers.authorization) {
    req.tokenSubject = null;
    return next();
  }
  return subjectOfToken(req, res, next);
};

const register = (router, { sendSession, getRequestContext }) => {
  /**
   * GET /auth/workspaces/resolve?projectId= (workspace switching doc §5): which
   * of the caller's workspaces owns this project, for the web client's legacy
   * `/projects/:id` redirect. Any token of the identity will do, including
   * the identity token from a sign-in with several workspaces, because the
   * question is about the identity's memberships, not one session.
   */
  router.get(
    "/workspaces/resolve",
    [query("projectId").isUUID(), validate],
    subjectOfToken,
    asyncHandler(async (req, res) => {
      const result = await workspaceLinkService.resolveProjectWorkspace({
        userId: req.tokenSubject.userId,
        projectId: req.query.projectId,
        activeOrgId: req.tokenSubject.orgId,
      });
      return sendSuccess(res, result);
    }),
  );

  router.post(
    "/workspaces/:orgId/session",
    loginLimiter,
    [param("orgId").isUUID(), validate],
    subjectOfToken,
    asyncHandler(async (req, res) => {
      const result = await authService.issueWorkspaceSession(
        { userId: req.tokenSubject.userId, orgId: req.params.orgId },
        getRequestContext(req),
      );
      return sendSession(req, res, result);
    }),
  );
};

module.exports = { register, subjectOfToken, optionalTokenSubject };
