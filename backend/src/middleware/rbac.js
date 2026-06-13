const { HttpError } = require('../utils/http-error');
const { can, canParty, normalizeRoleId } = require('../config/permissions');

const getEffectiveRole = (req) =>
  normalizeRoleId(req.projectAccess?.role || req.user?.role);

const getPartyAccessList = (req) =>
  Array.isArray(req.projectAccess?.partyAccess)
    ? req.projectAccess.partyAccess
    : [];

const canPartyAccess = (req, moduleName, action, transition) =>
  getPartyAccessList(req).some((partyAccess) =>
    canParty({
      partyRole: partyAccess.role,
      module: moduleName,
      action,
      transition,
    }),
  );

const requireRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required'),
      );
    }

    if (!allowedRoles.includes(getEffectiveRole(req))) {
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

const requirePermission = (moduleName, action, options = {}) => {
  const { transition = null } = options;

  return (req, res, next) => {
    if (!req.user) {
      return next(
        new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required'),
      );
    }

    if (
      !can({
        role: getEffectiveRole(req),
        module: moduleName,
        action,
        transition,
      }) &&
      !canPartyAccess(req, moduleName, action, transition)
    ) {
      const error = new HttpError(
        403,
        'FORBIDDEN',
        'You do not have permission for this action',
      );
      error.details = { module: moduleName, action, transition };
      return next(error);
    }

    return next();
  };
};

module.exports = { getEffectiveRole, requirePermission, requireRoles };
