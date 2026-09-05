const { verifyAccessToken } = require('../utils/tokens');
const { HttpError } = require('../utils/http-error');

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

    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      orgId: payload.orgId,
      role: payload.role,
      email: payload.email,
      name: payload.name,
      isCompanyAdmin: Boolean(payload.isCompanyAdmin),
    };

    return next();
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
