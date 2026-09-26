const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('./http-error');

const ACCESS_TOKEN_DEFAULT_EXPIRY = '15m';
const REFRESH_TOKEN_DEFAULT_EXPIRY = '7d';
// An identity token is what a sign-in hands out when there is no single
// workspace to enter (none, or several): long enough to pick one, no longer.
const IDENTITY_TOKEN_DEFAULT_EXPIRY = '10m';

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

/**
 * The workspace-membership claims a principal carries (membership doc §3). A
 * principal is either a bare user row — the pre-membership shape, still what
 * the fallback path and the live kit mint from — or the membership-derived
 * shape authenticate builds. The claims are added only when the principal
 * names a membership, so a token minted from a bare user row is exactly the
 * token that was minted before memberships existed.
 */
const membershipClaims = (user) => {
  if (!user.membershipId) return {};
  return {
    mid: user.membershipId,
    adm: Boolean(user.isAdmin ?? user.isCompanyAdmin),
    own: Boolean(user.isOwner),
    kind: user.kind || 'member',
  };
};

const createAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
      name: user.name,
      // Kept beside adm/own: the server no longer reads it, but the web and
      // mobile clients are not changed in this wave, and a claim they were
      // minted with is not dropped from under them.
      isCompanyAdmin: Boolean(user.isCompanyAdmin),
      ...membershipClaims(user),
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
      // The membership the session was issued for; refresh binds the stored
      // session to it and re-mints from the membership row (M4).
      ...(user.membershipId ? { mid: user.membershipId } : {}),
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

/**
 * A token that names an identity and no workspace (membership doc §6): what a
 * sign-in returns when the person has no workspace to enter, or several to
 * choose from. It carries no orgId, so nothing scoped to a workspace can be
 * reached with it; authenticate honours it only where the route says so.
 */
const createIdentityToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      type: 'identity',
    },
    getEnv('JWT_SECRET'),
    {
      expiresIn:
        process.env.JWT_IDENTITY_EXPIRY || IDENTITY_TOKEN_DEFAULT_EXPIRY,
    },
  );

const verifyAccessToken = (token, { allowIdentity = false } = {}) => {
  const payload = jwt.verify(token, getEnv('JWT_SECRET'));
  if (payload.type === 'identity' && allowIdentity) {
    return payload;
  }
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
  createIdentityToken,
  createRefreshToken,
  getAccessTokenExpiresInSeconds,
  getRefreshTokenExpiresAt,
  hashRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
