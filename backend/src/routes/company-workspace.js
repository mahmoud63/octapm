const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requireCompanyAdmin } = require("../middleware/rbac");
const { subscriptionGate } = require("../middleware/subscription-gate");
const { validate } = require("../middleware/validate");
const { moneyBody } = require("../utils/money");
const companyWorkspaceService = require("../services/company-workspace.service");
const projectTemplateService = require("../services/project-template.service");
const formService = require("../services/form.service");
const submittalWorkflow = require("../services/submittal-workflow.service");

/**
 * Company workspace (OCTA-ADM-COMPANY-007): directory, vendors, cost codes,
 * equipment masters and project templates. Reads are open to every user so
 * project pickers can use them; writes need a company admin or PM.
 */
const router = express.Router();
router.use(authenticate);
router.use(subscriptionGate);

const actor = (req) => ({ actorId: req.user.id, actorRole: getEffectiveRole(req) });

// ─── Directory ──────────────────────────────────────────────────────────────
router.get(
  "/directory",
  [
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("status").optional().isIn(["active", "inactive"]),
    query("vendorsOnly").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await companyWorkspaceService.listDirectory({ orgId: req.user.orgId, query: req.query })),
  ),
);

// ─── Vendors ────────────────────────────────────────────────────────────────
const vendorValidators = ({ requireName = false } = {}) => [
  requireName
    ? body("name").isString().trim().notEmpty().isLength({ max: 255 })
    : body("name").optional().isString().trim().notEmpty().isLength({ max: 255 }),
  body("legalName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("tradeName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("registrationNumber").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("taxNumber").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("email").optional({ nullable: true }).isEmail().normalizeEmail(),
  body("phone").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("website").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("address").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("contactName").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("trades").optional(),
  body("vendorProfile").optional({ nullable: true }).isObject(),
  body("leadTimeReliability").optional({ nullable: true }).isFloat({ min: 0, max: 100 }).toFloat(),
  body("paymentTerms").optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  body("status").optional().isIn(["active", "inactive"]),
  body("isVendor").optional().isBoolean().toBoolean(),
  validate,
];

router.get(
  "/vendors",
  [
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("trade").optional().isString().trim().isLength({ max: 80 }),
    query("includeInactive").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await companyWorkspaceService.listVendors({ orgId: req.user.orgId, query: req.query })),
  ),
);

router.get(
  "/vendors/migration-report",
  requireCompanyAdmin,
  asyncHandler(async (req, res) =>
    sendSuccess(res, await companyWorkspaceService.vendorMigrationReport({ orgId: req.user.orgId })),
  ),
);

router.post(
  "/vendors",
  requireCompanyAdmin,
  vendorValidators({ requireName: true }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await companyWorkspaceService.createVendor({ orgId: req.user.orgId, payload: req.body, ...actor(req) }),
      201,
    ),
  ),
);

router.patch(
  "/vendors/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...vendorValidators()],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await companyWorkspaceService.updateVendor({
        orgId: req.user.orgId,
        vendorId: req.params.id,
        payload: req.body,
        ...actor(req),
      }),
    ),
  ),
);

// ─── Cost codes ─────────────────────────────────────────────────────────────
const costCodeValidators = ({ requireAll = false } = {}) => [
  requireAll ? body("code").isString().trim().notEmpty().isLength({ max: 40 }) : body("code").optional().isString().trim().notEmpty().isLength({ max: 40 }),
  requireAll ? body("name").isString().trim().notEmpty().isLength({ max: 255 }) : body("name").optional().isString().trim().notEmpty().isLength({ max: 255 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("category").optional().isIn(companyWorkspaceService.COST_CODE_CATEGORIES),
  body("parentId").optional({ nullable: true }).isUUID(),
  body("sortOrder").optional().isInt({ min: 0 }).toInt(),
  body("status").optional().isIn(["active", "archived"]),
  validate,
];

router.get(
  "/cost-codes",
  [
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("category").optional().isIn(companyWorkspaceService.COST_CODE_CATEGORIES),
    query("includeArchived").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await companyWorkspaceService.listCostCodes({ orgId: req.user.orgId, query: req.query })),
  ),
);

router.post(
  "/cost-codes",
  requireCompanyAdmin,
  costCodeValidators({ requireAll: true }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await companyWorkspaceService.createCostCode({ orgId: req.user.orgId, payload: req.body, ...actor(req) }),
      201,
    ),
  ),
);

router.post(
  "/cost-codes/import",
  requireCompanyAdmin,
  [body("rows").isArray({ min: 1, max: 2000 }), body("rows.*.code").isString().trim().notEmpty(), body("rows.*.name").isString().trim().notEmpty(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await companyWorkspaceService.importCostCodes({ orgId: req.user.orgId, rows: req.body.rows, ...actor(req) }),
    ),
  ),
);

router.patch(
  "/cost-codes/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...costCodeValidators()],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await companyWorkspaceService.updateCostCode({
        orgId: req.user.orgId,
        costCodeId: req.params.id,
        payload: req.body,
        ...actor(req),
      }),
    ),
  ),
);

// ─── Equipment masters ──────────────────────────────────────────────────────
const equipmentValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 255 }) : body("name").optional().isString().trim().notEmpty().isLength({ max: 255 }),
  body("category").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("rateType").optional().isIn(companyWorkspaceService.RATE_TYPES),
  moneyBody("rate"),
  body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("status").optional().isIn(["active", "archived"]),
  validate,
];

router.get(
  "/equipment",
  [
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("includeArchived").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await companyWorkspaceService.listCompanyEquipment({ orgId: req.user.orgId, query: req.query })),
  ),
);

router.post(
  "/equipment",
  requireCompanyAdmin,
  equipmentValidators({ requireName: true }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await companyWorkspaceService.createCompanyEquipment({ orgId: req.user.orgId, payload: req.body, ...actor(req) }),
      201,
    ),
  ),
);

router.patch(
  "/equipment/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...equipmentValidators()],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await companyWorkspaceService.updateCompanyEquipment({
        orgId: req.user.orgId,
        equipmentId: req.params.id,
        payload: req.body,
        ...actor(req),
      }),
    ),
  ),
);

// ─── Project templates ──────────────────────────────────────────────────────
const templateValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 120 }) : body("name").optional().isString().trim().notEmpty().isLength({ max: 120 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("settings").optional({ nullable: true }).isObject(),
  body("parties").optional().isArray(),
  body("folders").optional().isArray(),
  body("locations").optional().isArray(),
  body("assignments").optional().isArray(),
  body("isDefault").optional().isBoolean().toBoolean(),
  body("status").optional().isIn(["active", "archived"]),
  validate,
];

router.get(
  "/project-templates",
  [query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await projectTemplateService.listTemplates({ orgId: req.user.orgId, query: req.query })),
  ),
);

router.post(
  "/project-templates",
  requireCompanyAdmin,
  templateValidators({ requireName: true }),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await projectTemplateService.createTemplate({ orgId: req.user.orgId, payload: req.body, ...actor(req) }),
      201,
    ),
  ),
);

router.get(
  "/project-templates/:id",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await projectTemplateService.getTemplate({ orgId: req.user.orgId, templateId: req.params.id })),
  ),
);

router.patch(
  "/project-templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...templateValidators()],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await projectTemplateService.updateTemplate({
        orgId: req.user.orgId,
        templateId: req.params.id,
        payload: req.body,
        ...actor(req),
      }),
    ),
  ),
);

router.delete(
  "/project-templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await projectTemplateService.archiveTemplate({ orgId: req.user.orgId, templateId: req.params.id, ...actor(req) }),
    ),
  ),
);

// ─── Checklist / form templates (company library) ───────────────────────────
const formActor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const formTemplateValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 200 }) : body("name").optional().isString().trim().notEmpty().isLength({ max: 200 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  body("trade").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("type").optional().isIn(formService.TYPES),
  body("status").optional().isIn(["draft", "active", "archived"]),
  body("settings").optional({ nullable: true }).isObject(),
  body("sections").optional().isArray({ max: 100 }),
  body("sections.*.items").optional().isArray({ max: 500 }),
  validate,
];

router.get(
  "/form-templates",
  [
    query("type").optional().isIn(formService.TYPES),
    query("status").optional().isIn(["draft", "active", "archived"]),
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.listTemplates({ orgId: req.user.orgId, projectId: null, query: { ...req.query, scope: "company" } }))),
);

router.post(
  "/form-templates",
  requireCompanyAdmin,
  formTemplateValidators({ requireName: true }),
  asyncHandler(async (req, res) => sendSuccess(res, await formService.createTemplate({ orgId: req.user.orgId, projectId: null, payload: req.body, actor: formActor(req) }), 201)),
);

router.post(
  "/form-templates/starters",
  requireCompanyAdmin,
  asyncHandler(async (req, res) => sendSuccess(res, await formService.seedStarterTemplates({ orgId: req.user.orgId, actor: formActor(req) }), 201)),
);

router.get(
  "/form-templates/:id",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.getTemplate({ orgId: req.user.orgId, projectId: null, templateId: req.params.id }))),
);

router.patch(
  "/form-templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...formTemplateValidators()],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await formService.updateTemplate({ orgId: req.user.orgId, projectId: null, templateId: req.params.id, payload: req.body, actor: formActor(req) })),
  ),
);

router.delete(
  "/form-templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await formService.archiveTemplate({ orgId: req.user.orgId, projectId: null, templateId: req.params.id, actor: formActor(req) }))),
);

router.post(
  "/form-templates/:id/duplicate",
  requireCompanyAdmin,
  [param("id").isUUID(), body("targetProjectId").optional({ nullable: true }).isUUID(), body("name").optional({ nullable: true }).isString().trim().isLength({ max: 200 }), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await formService.duplicateTemplate({ orgId: req.user.orgId, templateId: req.params.id, targetProjectId: req.body.targetProjectId || null, name: req.body.name, actor: formActor(req) }),
      201,
    ),
  ),
);

// ─── Submittal workflow templates (company library) ────────────────────────
const submittalTemplateValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 120 }) : body("name").optional().isString().trim().notEmpty().isLength({ max: 120 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("isDefault").optional().isBoolean().toBoolean(),
  body("status").optional().isIn(["active", "archived"]),
  body("steps").optional().isArray({ max: 12 }),
  body("steps.*.mode").optional().isIn(["sequential", "parallel"]),
  body("steps.*.days").optional().isInt({ min: 0, max: 365 }).toInt(),
  body("steps.*.assignees").optional().isArray({ max: 20 }),
  validate,
];

router.get(
  "/submittal-workflow-templates",
  [query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.listTemplates({ orgId: req.user.orgId, projectId: null, query: { ...req.query, scope: "company" } }))),
);

router.post(
  "/submittal-workflow-templates",
  requireCompanyAdmin,
  submittalTemplateValidators({ requireName: true }),
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.createTemplate({ orgId: req.user.orgId, projectId: null, payload: req.body, actor: formActor(req) }), 201)),
);

router.post(
  "/submittal-workflow-templates/starters",
  requireCompanyAdmin,
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.seedStarterTemplates({ orgId: req.user.orgId, actor: formActor(req) }), 201)),
);

router.patch(
  "/submittal-workflow-templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...submittalTemplateValidators()],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await submittalWorkflow.updateTemplate({ orgId: req.user.orgId, projectId: null, templateId: req.params.id, payload: req.body, actor: formActor(req) })),
  ),
);

router.delete(
  "/submittal-workflow-templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await submittalWorkflow.archiveTemplate({ orgId: req.user.orgId, projectId: null, templateId: req.params.id, actor: formActor(req) }))),
);

router.post(
  "/project-templates/:id/create-project",
  requireCompanyAdmin,
  [param("id").isUUID(), body("name").isString().trim().notEmpty(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await projectTemplateService.createProjectFromTemplate({
        orgId: req.user.orgId,
        userId: req.user.id,
        role: req.user.role,
        isCompanyAdmin: req.user.isCompanyAdmin,
        templateId: req.params.id,
        payload: req.body,
      }),
      201,
    ),
  ),
);

module.exports = router;
