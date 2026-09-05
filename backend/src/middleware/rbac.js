const { HttpError } = require('../utils/http-error');
const { can, canParty, normalizeRoleId } = require('../config/permissions');

/**
 * Module/action authorization.
 *
 * Resolution order when a project route is hit:
 *   1. company admin → always allowed on the company administration modules
 *      (user_management, project_parties);
 *   2. a permission template attached by the project-access middleware
 *      (req.projectAccess.template) decides the module/action/transition;
 *   3. otherwise the legacy static policy: effective role (project assignment
 *      role or org role) and any active project-party profile.
 */

const COMPANY_ADMIN_MODULES = new Set(['user_management', 'project_parties']);

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

const templateDecision = (req, moduleName, action, transition) => {
  const template = req.projectAccess?.template;
  if (!template) return null;
  // Lazy require keeps this middleware free of a service import cycle.
  const { templateAllows } = require('../services/permission-template.service');
  return templateAllows(template, { module: moduleName, action, transition });
};

const isCompanyAdmin = (req) => Boolean(req.user?.isCompanyAdmin);

/**
 * Pure decision used by requirePermission and available to services that need
 * to check a second action inside a handler.
 */
const hasPermission = (req, moduleName, action, options = {}) => {
  const { transition = null } = options;
  if (!req?.user) return false;
  // An API key never exceeds its scopes, whatever its owner may do.
  if (req.apiClient && !require('../services/api-client.service').scopeAllows(req.apiClient, moduleName, action)) return false;
  if (isCompanyAdmin(req) && COMPANY_ADMIN_MODULES.has(moduleName)) return true;

  const decided = templateDecision(req, moduleName, action, transition);
  if (decided !== null) return decided;

  return (
    can({
      role: getEffectiveRole(req),
      module: moduleName,
      action,
      transition,
    }) || canPartyAccess(req, moduleName, action, transition)
  );
};

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

    if (!hasPermission(req, moduleName, action, { transition })) {
      const error = new HttpError(
        403,
        'FORBIDDEN',
        'You do not have permission for this action',
      );
      error.details = {
        module: moduleName,
        action,
        transition,
        source: req.projectAccess?.template ? 'template' : 'role',
      };
      return next(error);
    }

    return next();
  };
};

/** Company administration: company admins and project managers. */
const requireCompanyAdmin = (req, res, next) => {
  if (!req.user) {
    return next(
      new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required'),
    );
  }
  if (req.apiClient) {
    return next(
      new HttpError(403, 'API_KEY_FORBIDDEN', 'API keys cannot administer the company'),
    );
  }
  if (isCompanyAdmin(req) || getEffectiveRole(req) === 'pm') {
    return next();
  }
  const error = new HttpError(
    403,
    'FORBIDDEN',
    'Company administration requires a company admin or project manager',
  );
  error.details = { requires: 'company_admin' };
  return next(error);
};

module.exports = {
  COMPANY_ADMIN_MODULES,
  getEffectiveRole,
  hasPermission,
  requireCompanyAdmin,
  requirePermission,
  requireRoles,
};
