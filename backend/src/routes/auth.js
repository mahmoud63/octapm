const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { validate } = require("../middleware/validate");
const { workspaceDefaultValidators } = require("../middleware/workspace-defaults");
const { authenticate } = require("../middleware/auth");
const {
  authLimiter,
  loginLimiter,
  refreshLimiter,
} = require("../middleware/rate-limit");
const authService = require("../services/auth.service");
const userSettingsService = require("../services/user-settings.service");

const router = express.Router();
const REFRESH_COOKIE_NAME = "pmc_refresh_token";

router.use(authLimiter);

const parseCookieHeader = (header) => {
  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
};

const getRefreshTokenFromCookie = (req) =>
  parseCookieHeader(req.headers.cookie)[REFRESH_COOKIE_NAME];

// ── Native clients ──
// A native app cannot hold an httpOnly cookie in its keychain, so a request
// that identifies itself as one receives the refresh token in the response
// body and presents it back in the request body. The header chooses the
// delivery channel and nothing else: authorization is decided by the same
// middleware, on the same access token, for both kinds of client. A token is
// bound to its channel by the service, so the header cannot be used to move a
// cookie's token into a body or the reverse.
const CLIENT_HEADER = "x-octapm-client";
const clientOf = (req) =>
  String(req.get(CLIENT_HEADER) || "")
    .trim()
    .toLowerCase() === "mobile"
    ? "mobile"
    : "web";
const isNativeClient = (req) => clientOf(req) === "mobile";
const getRefreshToken = (req) =>
  isNativeClient(req)
    ? typeof req.body?.refreshToken === "string"
      ? req.body.refreshToken
      : undefined
    : getRefreshTokenFromCookie(req);

const getRequestContext = (req) => ({
  userAgent: req.get("user-agent") || null,
  ipAddress: req.ip || req.socket?.remoteAddress || null,
  client: clientOf(req),
});

const getRefreshCookieBaseOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/v1/auth",
});

const setRefreshCookie = (res, result) => {
  const expiresAt = result.refreshTokenExpiresAt
    ? new Date(result.refreshTokenExpiresAt)
    : null;
  const maxAge = expiresAt
    ? Math.max(0, expiresAt.getTime() - Date.now())
    : undefined;

  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
    ...getRefreshCookieBaseOptions(),
    maxAge,
    expires: expiresAt || undefined,
  });
};

const clearRefreshCookie = (res) => {
  res.cookie(REFRESH_COOKIE_NAME, "", {
    ...getRefreshCookieBaseOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
};

const toPublicAuthResponse = (result) => {
  const { refreshToken, refreshTokenExpiresAt, ...publicResult } = result;
  return publicResult;
};

const toNativeAuthResponse = (result) => {
  const { refreshToken, refreshTokenExpiresAt, ...publicResult } = result;
  return {
    ...publicResult,
    tokens: {
      ...publicResult.tokens,
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt
        ? new Date(refreshTokenExpiresAt).toISOString()
        : null,
    },
  };
};

/** Send a new session the way this client can keep it. */
const sendSession = (req, res, result, status = 200) => {
  if (isNativeClient(req)) {
    return sendSuccess(res, toNativeAuthResponse(result), status);
  }
  setRefreshCookie(res, result);
  return sendSuccess(res, toPublicAuthResponse(result), status);
};

const requireRefreshToken = (req) => {
  const refreshToken = getRefreshToken(req);
  if (!refreshToken) {
    throw new HttpError(
      401,
      "REFRESH_SESSION_REQUIRED",
      isNativeClient(req)
        ? "Refresh token is required"
        : "Refresh session cookie is required",
    );
  }

  return refreshToken;
};

router.post(
  "/register",
  [
    body("orgName").optional().isString().trim().notEmpty(),
    body("name").isString().trim().notEmpty(),
    body("email").isEmail().normalizeEmail(),
    body("password").isString().isLength({ min: 8 }),
    body("phone").optional().isString().trim().notEmpty(),
    // The personal workspace's project defaults (ENT-6 §16), optional.
    ...workspaceDefaultValidators,
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body, getRequestContext(req));
    return sendSession(req, res, result, 201);
  }),
);

router.post(
  "/login",
  loginLimiter,
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isString().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body, getRequestContext(req));
    // A second factor is pending, or the identity has no single workspace to
    // enter (membership doc §6): no session yet, only the token for the next
    // step — the challenge, or POST /auth/workspaces/:orgId/session.
    if (result.mfaRequired || result.chooseWorkspace || result.needsWorkspace) {
      return sendSuccess(res, result);
    }
    return sendSession(req, res, result);
  }),
);

require("./auth-security").register(router, {
  sendSession,
  getRequestContext,
});
require("./workspaces").register(router, {
  sendSession,
  getRequestContext,
});

router.post(
  "/forgot-password",
  [body("email").isEmail().normalizeEmail(), validate],
  asyncHandler(async (req, res) => {
    const result = await authService.requestPasswordReset(
      req.body,
      getRequestContext(req),
    );
    return sendSuccess(res, result);
  }),
);

router.post(
  "/reset-password",
  [
    body("token").isString().isLength({ min: 20 }),
    body("password")
      .isString()
      .isLength({ min: 8 })
      .matches(/[a-z]/)
      .withMessage("Password must contain a lowercase letter")
      .matches(/[0-9]/)
      .withMessage("Password must contain a number"),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.resetPassword(
      req.body,
      getRequestContext(req),
    );
    return sendSuccess(res, result);
  }),
);

router.get(
  "/invitations/:token",
  [param("token").isString().isLength({ min: 20 }), validate],
  asyncHandler(async (req, res) => {
    const result = await authService.getInvitationPreview({
      token: req.params.token,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/invitations/accept",
  [
    body("token").isString().isLength({ min: 20 }),
    body("name").isString().trim().notEmpty(),
    body("password")
      .optional({ values: "falsy" })
      .isString()
      .isLength({ min: 8 })
      .matches(/[a-z]/)
      .withMessage("Password must contain a lowercase letter")
      .matches(/[0-9]/)
      .withMessage("Password must contain a number"),
    body("phone").optional().isString().trim(),
    validate,
  ],
  // A bearer, when the invitee is signed in, proves the existing identity
  // the invitation names (membership doc §5); the password does otherwise.
  require("./workspaces").optionalTokenSubject,
  asyncHandler(async (req, res) => {
    const result = await authService.acceptInvitation(
      { ...req.body, identityUserId: req.tokenSubject?.userId || null },
      getRequestContext(req),
    );
    return sendSession(req, res, result);
  }),
);

router.post(
  "/refresh",
  refreshLimiter,
  // Only a native client sends the token in the body; a browser's body is
  // ignored entirely, so it is not validated either.
  [
    body("refreshToken")
      .if((_value, { req }) => isNativeClient(req))
      .optional()
      .isString()
      .isLength({ min: 20, max: 4096 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.refresh({
      refreshToken: requireRefreshToken(req),
      ...getRequestContext(req),
    });
    return sendSession(req, res, result);
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const result = await authService.logout({
      refreshToken: getRefreshToken(req),
      client: clientOf(req),
    });
    if (!isNativeClient(req)) clearRefreshCookie(res);
    return sendSuccess(res, result);
  }),
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await authService.getProfile({
      userId: req.user.id,
      orgId: req.user.orgId,
      principal: req.user,
    });

    return sendSuccess(res, result);
  }),
);

router.get(
  "/me/settings",
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await userSettingsService.getUserSettings({
      userId: req.user.id,
      orgId: req.user.orgId,
    });

    return sendSuccess(res, result);
  }),
);

/**
 * Effective permission matrix for the caller: org-wide when no projectId is
 * given, otherwise resolved through the project's permission template chain
 * (user template → party template → assignment role → org role).
 */
router.get(
  "/me/permissions",
  authenticate,
  [query("projectId").optional().isUUID(), validate],
  asyncHandler(async (req, res) => {
    const permissionTemplateService = require("../services/permission-template.service");
    if (!req.query.projectId) {
      return sendSuccess(
        res,
        permissionTemplateService.resolveOrgPermissions({ user: req.user }),
      );
    }

    const { assertProjectAccess } = require("../services/project-authorization.service");
    const projectAccess = await assertProjectAccess({
      orgId: req.user.orgId,
      projectId: req.query.projectId,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: req.user.isCompanyAdmin,
    });
    const result = await permissionTemplateService.resolveProjectPermissions({
      orgId: req.user.orgId,
      projectId: req.query.projectId,
      user: req.user,
      projectAccess,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/me/profile",
  authenticate,
  [
    body("username").isString().trim().isLength({ min: 2, max: 30 }),
    body("bio").optional({ nullable: true }).isString().trim().isLength({
      max: 160,
    }),
    body("urls").optional().isArray({ max: 10 }),
    body("urls.*.value")
      .optional({ values: "falsy" })
      .isURL({ require_protocol: true })
      .isLength({ max: 2048 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userSettingsService.updateProfileSettings({
      userId: req.user.id,
      orgId: req.user.orgId,
      payload: req.body,
    });

    return sendSuccess(res, result);
  }),
);

router.patch(
  "/me/account",
  authenticate,
  [
    body("name").isString().trim().isLength({ min: 2, max: 30 }),
    body("dob").optional({ nullable: true }).isISO8601().toDate(),
    body("language").isIn([...userSettingsService.LANGUAGES]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userSettingsService.updateAccountSettings({
      userId: req.user.id,
      orgId: req.user.orgId,
      payload: req.body,
    });

    return sendSuccess(res, result);
  }),
);

router.patch(
  "/me/appearance",
  authenticate,
  [
    body("theme").isIn([...userSettingsService.THEMES]),
    body("font").isIn([...userSettingsService.FONTS]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userSettingsService.updateAppearanceSettings({
      userId: req.user.id,
      orgId: req.user.orgId,
      payload: req.body,
    });

    return sendSuccess(res, result);
  }),
);

router.patch(
  "/me/display",
  authenticate,
  [
    body("items").isArray({ min: 1 }),
    body("items.*").isIn([...userSettingsService.DISPLAY_ITEMS]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userSettingsService.updateDisplaySettings({
      userId: req.user.id,
      orgId: req.user.orgId,
      payload: req.body,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
