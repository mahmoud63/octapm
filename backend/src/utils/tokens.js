const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('./http-error');

const ACCESS_TOKEN_DEFAULT_EXPIRY = '15m';
const REFRESH_TOKEN_DEFAULT_EXPIRY = '7d';

const parseExpirySeconds = (value, fallbackSeconds) => {
  const rawValue = value || '';
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(/^(\d+)\s*([smhd])$/);
  if (!match) {
    return fallbackSeconds;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };

  return amount * multipliers[unit];
};

const getEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new HttpError(
      500,
      'CONFIG_ERROR',
      `Missing environment variable: ${name}`,
    );
  }

  return value;
};

const createAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
      name: user.name,
      isCompanyAdmin: Boolean(user.isCompanyAdmin),
      type: 'access',
    },
    getEnv('JWT_SECRET'),
    { expiresIn: process.env.JWT_EXPIRY || ACCESS_TOKEN_DEFAULT_EXPIRY },
  );
};

const createRefreshToken = (user, sessionId, client = 'web') => {
  if (!sessionId) {
    throw new HttpError(
      500,
      'CONFIG_ERROR',
      'Refresh token creation requires a server session id',
    );
  }

  return jwt.sign(
    {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      type: 'refresh',
      // The delivery channel this token was issued on: 'web' (httpOnly cookie)
      // or 'mobile' (response body, kept in the device keychain). A token that
      // turns up on the other channel is refused and its session family revoked.
      cli: client,
    },
    getEnv('JWT_REFRESH_SECRET'),
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRY || REFRESH_TOKEN_DEFAULT_EXPIRY,
      jwtid: sessionId,
    },
  );
};

const hashRefreshToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const getRefreshTokenExpiresAt = (token) => {
  const decoded = jwt.decode(token);
  if (!decoded?.exp) {
    return new Date(
      Date.now() +
        parseExpirySeconds(
          process.env.JWT_REFRESH_EXPIRY || REFRESH_TOKEN_DEFAULT_EXPIRY,
          7 * 24 * 60 * 60,
        ) *
          1000,
    );
  }

  return new Date(decoded.exp * 1000);
};

const getAccessTokenExpiresInSeconds = () =>
  parseExpirySeconds(
    process.env.JWT_EXPIRY || ACCESS_TOKEN_DEFAULT_EXPIRY,
    15 * 60,
  );

const verifyAccessToken = (token) => {
  const payload = jwt.verify(token, getEnv('JWT_SECRET'));
  if (payload.type !== 'access') {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid access token type');
  }

  return payload;
};

const verifyRefreshToken = (token) => {
  const payload = jwt.verify(token, getEnv('JWT_REFRESH_SECRET'));
  if (payload.type !== 'refresh') {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid refresh token type');
  }
  if (!payload.jti) {
    throw new HttpError(
      401,
      'INVALID_REFRESH_TOKEN',
      'Refresh token session is invalid',
    );
  }

  return payload;
};

module.exports = {
  createAccessToken,
  createRefreshToken,
  getAccessTokenExpiresInSeconds,
  getRefreshTokenExpiresAt,
  hashRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
