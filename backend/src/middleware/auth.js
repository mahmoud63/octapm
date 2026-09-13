const { verifyAccessToken } = require('../utils/tokens');
const { HttpError } = require('../utils/http-error');
const { prisma } = require('../config/db');
const { API_KEY_PREFIX, authenticateApiKey } = require('../services/api-client.service');

const parseBearerToken = (authorizationHeader) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
};

const authenticate = (req, res, next) => {
  try {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      return next(
        new HttpError(
          401,
          'AUTH_REQUIRED',
          'Missing or invalid Authorization header',
        ),
      );
    }

    // Public API keys (OCTA-INT-API-026) act as their owner, limited by scopes.
    if (token.startsWith(API_KEY_PREFIX)) {
      return authenticateApiKey(token)
        .then(({ user, apiClient }) => {
          req.user = user;
          req.apiClient = apiClient;
          return next();
        })
        .catch(next);
    }

    const payload = verifyAccessToken(token);
    // The token is honoured only while the account it names is active, and
    // with the role and standing the account holds now — not those it held
    // when the token was minted: a deactivated or demoted person kept their
    // old authority until the token expired (Phase 21D, CX21-485).
    return prisma.user
      .findUnique({ where: { id: payload.sub }, select: { id: true, orgId: true, role: true, status: true, isCompanyAdmin: true } })
      .then((account) => {
        if (!account || account.orgId !== payload.orgId || account.status !== 'active') {
          return next(new HttpError(401, 'USER_INACTIVE', 'This account is no longer active'));
        }
        req.user = {
          id: payload.sub,
          orgId: payload.orgId,
          role: account.role || payload.role,
          email: payload.email,
          name: payload.name,
          isCompanyAdmin: Boolean(account.isCompanyAdmin),
        };
        return next();
      })
      .catch(next);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(
        new HttpError(401, 'TOKEN_EXPIRED', 'Access token has expired'),
      );
    }

    if (error.name === 'JsonWebTokenError') {
      return next(
        new HttpError(401, 'INVALID_TOKEN', 'Access token is invalid'),
      );
    }

    return next(error);
  }
};

module.exports = { authenticate };
