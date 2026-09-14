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
  const { transition = null } = typeof options === 'string' ? { transition: options } : options || {};
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

/** The policy module a role-guarded route belongs to, from where it is mounted. */
const MODULE_BY_SEGMENT = { 'change-orders': 'change_order', eot: 'eot', boq: 'boq', billing: 'billing', projects: 'project' };
const moduleForRequest = (req) => {
  const segments = String(req.baseUrl || '').split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return MODULE_BY_SEGMENT[last] || (segments.includes('projects') ? 'project' : last || 'project');
};
const ACTION_BY_METHOD = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

/**
 * Account security — a second factor, its backup codes — is the person's own
 * act. An API key acts as its owner for the work it is scoped to, never for
 * this (Phase 21D, CX21-429).
 */
const personal = (what) => (req, res, next) =>
  req.apiClient
    ? next(new HttpError(403, 'API_KEY_FORBIDDEN', `${what} cannot be reached with an API key`))
    : next();
const noApiKey = personal('Account security');

const requireRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required'),
      );
    }

    // An API key never exceeds its scopes, whatever its owner may do — the
    // permission guard has always said so; this role guard did not, and a
    // read-only key could edit or archive a project (Phase 21D, CX21-415).
    // — and a read through it needs a read scope on the route's module just
    // the same: the billing history answered a key with only an inventory scope
    // (Phase 21D, CX21-476).
    const action = ACTION_BY_METHOD[req.method] || 'read';
    const moduleName = moduleForRequest(req);
    if (req.apiClient && !require('../services/api-client.service').scopeAllows(req.apiClient, moduleName, action)) {
      return next(new HttpError(403, 'API_KEY_SCOPE', 'This API key does not allow that action'));
    }

    // A permission template attached by the project middleware decides here as
    // it does for the permission guard: this role guard never asked it, and a
    // template that refused change orders did not stop their creation, edit
    // or archive (Phase 21D, CX21-515). Modules the policy does not know keep
    // the role list.
    const { permissionPolicy } = require('../config/permissions');
    const decided = permissionPolicy.modules[moduleName] ? templateDecision(req, moduleName, action, null) : null;
    if (decided !== null) {
      if (decided) return next();
      const error = new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action');
      error.details = { module: moduleName, action, transition: null, source: 'template' };
      return next(error);
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
  const { transition = null } = typeof options === 'string' ? { transition: options } : options || {};

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
  noApiKey,
  personal,
  personal,
  COMPANY_ADMIN_MODULES,
  getEffectiveRole,
  hasPermission,
  requireCompanyAdmin,
  requirePermission,
  requireRoles,
};
