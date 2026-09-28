const { HttpError } = require('../utils/http-error');
const {
  assertProjectAccess,
} = require('../services/project-authorization.service');
const {
  attachTemplateContext,
} = require('../services/permission-template.service');

const requireProjectAccess = (paramName = 'projectId') => {
  return async (req, _res, next) => {
    try {
      if (!req.user) {
        return next(
          new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required'),
        );
      }

      const projectId = req.params[paramName];
      if (req.apiClient?.projectIds?.length && !req.apiClient.projectIds.includes(projectId)) {
        return next(new HttpError(403, 'API_KEY_PROJECT', 'This API key is limited to other projects'));
      }
      const access = await assertProjectAccess({
        orgId: req.user.orgId,
        projectId,
        userId: req.user.id,
        role: req.user.role,
        isCompanyAdmin: req.user.isCompanyAdmin,
      });

      req.projectAccess = access;
      // Permission templates (if any) layer over the role/party policy.
      await attachTemplateContext({ req });
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

/**
 * The request as one project's own routes see it, for an answer that spans
 * projects (the workspace dashboard): the same person and API key, with the
 * project access and permission template requireProjectAccess attaches — so
 * hasPermission decides there exactly as it decides on that project's routes
 * (template, role and party). A project those routes would refuse (outside
 * an API key's projects, or no longer reachable) gets no person at all, and
 * hasPermission then allows nothing.
 */
const requestForProject = async (req, projectId) => {
  const view = { user: req.user, apiClient: req.apiClient, params: { projectId } };
  if (!req.user || (req.apiClient?.projectIds?.length && !req.apiClient.projectIds.includes(projectId))) {
    return { ...view, user: null };
  }
  try {
    view.projectAccess = await assertProjectAccess({
      orgId: req.user.orgId,
      projectId,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: req.user.isCompanyAdmin,
    });
  } catch {
    return { ...view, user: null };
  }
  await attachTemplateContext({ req: view });
  return view;
};

module.exports = { requestForProject, requireProjectAccess };
