const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { validate } = require("../middleware/validate");
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

const getRequestContext = (req) => ({
  userAgent: req.get("user-agent") || null,
  ipAddress: req.ip || req.socket?.remoteAddress || null,
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

const requireRefreshCookie = (req) => {
  const refreshToken = getRefreshTokenFromCookie(req);
  if (!refreshToken) {
    throw new HttpError(
      401,
      "REFRESH_SESSION_REQUIRED",
      "Refresh session cookie is required",
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
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body, getRequestContext(req));
    setRefreshCookie(res, result);
    return sendSuccess(res, toPublicAuthResponse(result), 201);
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
    // A second factor is pending: no session yet, only the challenge token.
    if (result.mfaRequired) return sendSuccess(res, result);
    setRefreshCookie(res, result);
    return sendSuccess(res, toPublicAuthResponse(result));
  }),
);

require("./auth-security").register(router, {
  setRefreshCookie,
  toPublicAuthResponse,
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
  asyncHandler(async (req, res) => {
    const result = await authService.acceptInvitation(
      req.body,
      getRequestContext(req),
    );
    setRefreshCookie(res, result);
    return sendSuccess(res, toPublicAuthResponse(result));
  }),
);

router.post(
  "/refresh",
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const result = await authService.refresh({
      refreshToken: requireRefreshCookie(req),
      ...getRequestContext(req),
    });
    setRefreshCookie(res, result);
    return sendSuccess(res, toPublicAuthResponse(result));
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const result = await authService.logout({
      refreshToken: getRefreshTokenFromCookie(req),
    });
    clearRefreshCookie(res);
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
