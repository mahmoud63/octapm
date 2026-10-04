const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requireCompanyAdmin } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { subscriptionGate } = require("../middleware/subscription-gate");
const permissionTemplateService = require("../services/permission-template.service");

/**
 * Company-level permission administration: the catalog of modules/actions,
 * and CRUD over permission templates. Template assignment to project users
 * lives under /projects/:projectId/team.
 */

const router = express.Router();
router.use(authenticate);
router.use(subscriptionGate);

const templatePayloadValidators = ({ requireName = false } = {}) => [
  requireName
    ? body("name").isString().trim().isLength({ min: 1, max: 120 })
    : body("name").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("kind").optional().isIn(permissionTemplateService.TEMPLATE_KINDS),
  body("clientType").optional({ nullable: true }).isIn([
    ...permissionTemplateService.CLIENT_TYPES,
    null,
  ]),
  body("baseRole").optional({ nullable: true }).isString().trim(),
  body("basePartyRole").optional({ nullable: true }).isString().trim(),
  body("status").optional().isIn(Object.values(permissionTemplateService.TEMPLATE_STATUSES)),
  body("tools").optional().isArray(),
  body("tools.*.module").optional().isString().trim().notEmpty(),
  body("tools.*.level").optional().isIn(permissionTemplateService.LEVEL_VALUES),
  body("grants").optional().isArray(),
  validate,
];

router.get(
  "/catalog",
  asyncHandler(async (_req, res) =>
    sendSuccess(res, permissionTemplateService.getCatalog()),
  ),
);

router.get(
  "/templates",
  requireCompanyAdmin,
  [
    query("status").isString().optional().isIn(Object.values(permissionTemplateService.TEMPLATE_STATUSES)),
    query("kind").isString().optional().isIn(permissionTemplateService.TEMPLATE_KINDS),
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.listTemplates({
      orgId: req.user.orgId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/templates",
  requireCompanyAdmin,
  templatePayloadValidators({ requireName: true }),
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.createTemplate({
      orgId: req.user.orgId,
      payload: req.body,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  "/templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.getTemplate({
      orgId: req.user.orgId,
      templateId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...templatePayloadValidators()],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.updateTemplate({
      orgId: req.user.orgId,
      templateId: req.params.id,
      payload: req.body,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/templates/:id/duplicate",
  requireCompanyAdmin,
  [
    param("id").isUUID(),
    body("name").optional().isString().trim().isLength({ min: 1, max: 120 }),
    body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.duplicateTemplate({
      orgId: req.user.orgId,
      templateId: req.params.id,
      payload: req.body,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.delete(
  "/templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.archiveTemplate({
      orgId: req.user.orgId,
      templateId: req.params.id,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
