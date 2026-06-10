const permissionPolicy = require('../../../shared/permissions.json');

const ALL_ACTIONS = permissionPolicy.actions;
const ALL_ROLES = permissionPolicy.roles.map((role) => role.id);

const getModulePolicy = (moduleName) => permissionPolicy.modules[moduleName];

const hasRole = (allowedRoles, role) =>
  Array.isArray(allowedRoles) && allowedRoles.includes(role);

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

module.exports = {
  ALL_ACTIONS,
  ALL_ROLES,
  can,
  getAllowedRoles,
  permissionPolicy,
};
