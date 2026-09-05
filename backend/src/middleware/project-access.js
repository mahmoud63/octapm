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

module.exports = { requireProjectAccess };
