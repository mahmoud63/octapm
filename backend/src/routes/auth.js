const express = require('express');
const { body } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const authService = require('../services/auth.service');

const router = express.Router();
const REFRESH_COOKIE_NAME = 'pmc_refresh_token';

const parseCookieHeader = (header) => {
  if (!header) {
    return {};
  }

  return header.split(';').reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValue.join('='));
    return cookies;
  }, {});
};

const getRefreshTokenFromCookie = (req) =>
  parseCookieHeader(req.headers.cookie)[REFRESH_COOKIE_NAME];

const getRequestContext = (req) => ({
  userAgent: req.get('user-agent') || null,
  ipAddress: req.ip || req.socket?.remoteAddress || null,
});

const getRefreshCookieBaseOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/api/v1/auth',
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
  res.cookie(REFRESH_COOKIE_NAME, '', {
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
      'REFRESH_SESSION_REQUIRED',
      'Refresh session cookie is required',
    );
  }

  return refreshToken;
};

router.post(
  '/register',
  [
    body('orgName').optional().isString().trim().notEmpty(),
    body('name').isString().trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isString().isLength({ min: 8 }),
    body('phone').optional().isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body, getRequestContext(req));
    setRefreshCookie(res, result);
    return sendSuccess(res, toPublicAuthResponse(result), 201);
  }),
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isString().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body, getRequestContext(req));
    setRefreshCookie(res, result);
    return sendSuccess(res, toPublicAuthResponse(result));
  }),
);

router.post(
  '/refresh',
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
  '/logout',
  asyncHandler(async (req, res) => {
    const result = await authService.logout({
      refreshToken: getRefreshTokenFromCookie(req),
    });
    clearRefreshCookie(res);
    return sendSuccess(res, result);
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await authService.getProfile({
      userId: req.user.id,
      orgId: req.user.orgId,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
