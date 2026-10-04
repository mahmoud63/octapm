const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { validate } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const formService = require("../services/form.service");

/**
 * Project-level checklist templates (OCTA-QA-TEMPLATE-014). Company
 * templates are read here too but edited under /company/form-templates.
 * Mounted at /projects/:projectId/forms/templates.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const admin = requirePermission("inspection", "update", { transition: "inspection.template_admin" });

const templateValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 200 }) : body("name").optional().isString().trim().notEmpty().isLength({ max: 200 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  body("trade").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("type").optional().isIn(formService.TYPES),
  body("status").optional().isIn(["draft", "active", "archived"]),
  body("settings").optional({ nullable: true }).isObject(),
  body("sections").optional().isArray({ max: 100 }),
  body("sections.*.title").optional().isString(),
  body("sections.*.items").optional().isArray({ max: 500 }),
  body("sourceTemplateId").optional({ nullable: true }).isString().isUUID(),
  validate,
];

router.get(
  "/",
  requirePermission("inspection", "read"),
  [
    query("scope").isString().optional().isIn(["all", "project", "company"]),
    query("type").isString().optional().isIn(formService.TYPES),
    query("status").isString().optional().isIn(["draft", "active", "archived"]),
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.listTemplates({ orgId: req.user.orgId, projectId: req.params.projectId, query: req.query }))),
);

router.post(
  "/",
  admin,
  templateValidators({ requireName: true }),
  asyncHandler(async (req, res) =>
    sendSuccess(res, await formService.createTemplate({ orgId: req.user.orgId, projectId: req.params.projectId, payload: req.body, actor: actor(req) }), 201),
  ),
);

router.get(
  "/:templateId",
  requirePermission("inspection", "read"),
  [param("templateId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.getTemplate({ orgId: req.user.orgId, projectId: req.params.projectId, templateId: req.params.templateId }))),
);

router.patch(
  "/:templateId",
  admin,
  [param("templateId").isUUID(), ...templateValidators()],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await formService.updateTemplate({ orgId: req.user.orgId, projectId: req.params.projectId, templateId: req.params.templateId, payload: req.body, actor: actor(req) }),
    ),
  ),
);

router.delete(
  "/:templateId",
  admin,
  [param("templateId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await formService.archiveTemplate({ orgId: req.user.orgId, projectId: req.params.projectId, templateId: req.params.templateId, actor: actor(req) })),
  ),
);

router.post(
  "/:templateId/duplicate",
  admin,
  [param("templateId").isUUID(), body("name").optional({ nullable: true }).isString().trim().isLength({ max: 200 }), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await formService.duplicateTemplate({ orgId: req.user.orgId, templateId: req.params.templateId, targetProjectId: req.params.projectId, name: req.body.name, actor: actor(req) }),
      201,
    ),
  ),
);

module.exports = router;
