const { HttpError } = require('../utils/http-error');

const requireRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required'),
      );
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new HttpError(
          403,
          'FORBIDDEN',
          'You do not have permission for this action',
        ),
      );
    }

    return next();
  };
};

module.exports = { requireRoles };
