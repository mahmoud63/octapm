const permissionPolicy = require('../../../shared/permissions.json');

const ALL_ACTIONS = permissionPolicy.actions;
const ALL_ROLES = permissionPolicy.roles.map((role) => role.id);
const ALL_PARTY_ROLES = (permissionPolicy.partyRoles || []).map(
  (role) => role.id,
);
const ROLE_ALIASES = new Map([
  ['pm', 'pm'],
  ['project_manager', 'pm'],
  ['project manager', 'pm'],
  ['planning_eng', 'planning_eng'],
  ['planning_engineer', 'planning_eng'],
  ['planning engineer', 'planning_eng'],
  ['qs', 'qs'],
  ['quantity_surveyor', 'qs'],
  ['quantity surveyor', 'qs'],
  ['cost_controller', 'cost_controller'],
  ['cost controller', 'cost_controller'],
  ['procurement', 'procurement'],
  ['warehouse', 'warehouse'],
  ['site_engineer', 'site_engineer'],
  ['site engineer', 'site_engineer'],
  ['finance', 'finance'],
]);

const getModulePolicy = (moduleName) => permissionPolicy.modules[moduleName];
const getPartyModulePolicy = (partyRole, moduleName) =>
  permissionPolicy.partyPermissions?.[partyRole]?.modules?.[moduleName];

const normalizeRoleId = (role) => {
  if (!role) return role;
  const normalized = String(role).trim().toLowerCase().replace(/[-\s]+/g, '_');
  return (
    ROLE_ALIASES.get(normalized) ||
    ROLE_ALIASES.get(String(role).trim().toLowerCase()) ||
    role
  );
};

const hasRole = (allowedRoles, role) =>
  Array.isArray(allowedRoles) && allowedRoles.includes(normalizeRoleId(role));

const getAllowedRoles = ({ module: moduleName, action, transition }) => {
  const modulePolicy = getModulePolicy(moduleName);
  if (!modulePolicy) return [];

  if (transition && modulePolicy.transitions?.[transition]) {
    return modulePolicy.transitions[transition];
  }

  return modulePolicy.actions?.[action] || [];
};

const can = ({ role, module: moduleName, action, transition }) =>
  hasRole(getAllowedRoles({ module: moduleName, action, transition }), role);

const normalizePartyRoleId = (role) => {
  if (!role) return role;
  const normalized = String(role).trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'client') return 'owner';
  if (normalized === 'main_contractor') return 'contractor';
  return normalized;
};

const canParty = ({ partyRole, module: moduleName, action, transition }) => {
  const role = normalizePartyRoleId(partyRole);
  const modulePolicy = getPartyModulePolicy(role, moduleName);
  if (!modulePolicy) return false;

  if (transition) {
    return Array.isArray(modulePolicy.transitions)
      ? modulePolicy.transitions.includes(transition)
      : false;
  }

  return Array.isArray(modulePolicy.actions)
    ? modulePolicy.actions.includes(action)
    : false;
};

const getPartyPermissionProfile = (partyRole) => {
  const role = normalizePartyRoleId(partyRole);
  return permissionPolicy.partyPermissions?.[role] || null;
};

module.exports = {
  ALL_ACTIONS,
  ALL_PARTY_ROLES,
  ALL_ROLES,
  can,
  canParty,
  getAllowedRoles,
  getPartyPermissionProfile,
  normalizePartyRoleId,
  normalizeRoleId,
  permissionPolicy,
};
