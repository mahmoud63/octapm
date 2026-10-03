const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requireCompanyAdmin } = require("../middleware/rbac");
const { requestForProject } = require("../middleware/project-access");
const { subscriptionGate } = require("../middleware/subscription-gate");
const { validate } = require("../middleware/validate");
const { moneyBody } = require("../utils/money");
const companyWorkspaceService = require("../services/company-workspace.service");
const prequalService = require("../services/vendor-prequalification.service");
const evaluationService = require("../services/subcontractor-evaluation.service");
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

/**
 * Companies that are probably the same company (OCTA-ADM-DEDUPE-061).
 * Reports, never merges — moving commitments, prequalifications and insurance
 * between legal entities is a decision for a person.
 */
router.get(
  "/vendors/duplicates",
  requireCompanyAdmin,
  asyncHandler(async (req, res) =>
    sendSuccess(res, await companyWorkspaceService.duplicateCompanyReport({ orgId: req.user.orgId })),
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

// ─── Prequalification (OCTA-SUB-PREQUAL-057) ────────────────────────────────
// Reads are open — everybody choosing a subcontractor should be able to see
// whether that subcontractor is qualified. Scoring and deciding need an admin.

router.get(
  "/prequalification",
  [query("withinDays").optional().isInt({ min: 1, max: 365 }).toInt(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await prequalService.listStates({ orgId: req.user.orgId, withinDays: req.query.withinDays ?? 60 }),
    ),
  ),
);

/**
 * What this subcontractor's finished subcontracts say about them
 * (OCTA-SUB-PERF-058) — the history that informs the next time they bid.
 */
router.get(
  "/vendors/:id/performance",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await evaluationService.listForCompany({ orgId: req.user.orgId, companyId: req.params.id }),
    ),
  ),
);

router.get(
  "/vendors/:id/prequalification",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await prequalService.getPrequalification({
        orgId: req.user.orgId,
        companyId: req.params.id,
        userId: req.user.id,
      }),
    ),
  ),
);

router.patch(
  "/vendors/:id/prequalification/criteria/:key",
  requireCompanyAdmin,
  [
    param("id").isUUID(),
    param("key").isString().trim().isLength({ min: 1, max: 60 }),
    body("score").optional({ nullable: true }).isInt({ min: 0, max: 5 }).toInt(),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body("reference").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("expiresAt").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await prequalService.scoreCriterion({
        orgId: req.user.orgId,
        companyId: req.params.id,
        key: req.params.key,
        payload: req.body,
        userId: req.user.id,
      }),
    ),
  ),
);

router.post(
  "/vendors/:id/prequalification/decision",
  requireCompanyAdmin,
  [
    param("id").isUUID(),
    body("status").isIn(prequalService.DECIDED),
    body("validUntil").optional({ nullable: true }).isISO8601(),
    body("conditions").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    body("decisionNote").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    moneyBody("singleAwardLimit", { nullable: true }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await prequalService.decide({
        orgId: req.user.orgId,
        companyId: req.params.id,
        payload: req.body,
        userId: req.user.id,
      }),
    ),
  ),
);

router.post(
  "/vendors/:id/prequalification/reopen",
  requireCompanyAdmin,
  [
    param("id").isUUID(),
    body("reason").isString().trim().notEmpty().isLength({ max: 500 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await prequalService.reopen({
        orgId: req.user.orgId,
        companyId: req.params.id,
        reason: req.body.reason,
        userId: req.user.id,
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

// ── Workflow templates (OCTA-PLAT-WF-024) ────────────────────────────────

const workflowEngine = require("../services/workflow-engine.service");
const workflowTools = require("../services/workflow-tools");

const workflowTemplateValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 160 }) : body("name").optional().isString().trim().isLength({ min: 1, max: 160 }),
  body("tool").optional().isIn(workflowTools.TOOL_KEYS),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  body("isDefault").optional().isBoolean().toBoolean(),
  body("priority").optional().isInt({ min: -100, max: 100 }).toInt(),
  body("status").optional().isIn(["active", "archived"]),
  body("rules").optional().isArray({ max: 20 }),
  body("steps").optional().isArray({ max: 20 }),
  body("startStep").optional({ nullable: true }).isString(),
  validate,
];

router.get(
  "/workflow-tools",
  asyncHandler(async (req, res) => sendSuccess(res, { tools: await workflowEngine.describeTools({ orgId: req.user.orgId }) })),
);

router.get(
  "/workflow-templates",
  [query("tool").optional().isIn(workflowTools.TOOL_KEYS), query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await workflowEngine.listTemplates({ orgId: req.user.orgId, projectId: null, tool: req.query.tool || null, includeArchived: Boolean(req.query.includeArchived), scope: "company" }) })),
);

router.post(
  "/workflow-templates",
  requireCompanyAdmin,
  [body("tool").isIn(workflowTools.TOOL_KEYS), ...workflowTemplateValidators({ requireName: true })],
  asyncHandler(async (req, res) => sendSuccess(res, await workflowEngine.createTemplate({ orgId: req.user.orgId, projectId: null, payload: req.body, actor: formActor(req) }), 201)),
);

router.post(
  "/workflow-templates/defaults",
  requireCompanyAdmin,
  asyncHandler(async (req, res) => sendSuccess(res, await workflowEngine.seedDefaultTemplates({ orgId: req.user.orgId, actor: formActor(req) }), 201)),
);

router.patch(
  "/workflow-templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...workflowTemplateValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await workflowEngine.updateTemplate({ orgId: req.user.orgId, projectId: null, templateId: req.params.id, payload: req.body, actor: formActor(req) }))),
);

router.delete(
  "/workflow-templates/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await workflowEngine.archiveTemplate({ orgId: req.user.orgId, projectId: null, templateId: req.params.id, actor: formActor(req) }))),
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
        // The new project's commercial terms are shown to the creator on the
        // same rule as GET /projects/:id (ipc:read on that project; L25).
        commercialAccessFor: async (projectId) => hasPermission(await requestForProject(req, projectId), "ipc", "read"),
      }),
      201,
    ),
  ),
);

// ─── Custom fields, fieldsets and record types (OCTA-PLAT-FIELDS-025) ─────
const customFields = require("../services/custom-field.service");

const customFieldValidators = ({ requireLabel = false } = {}) => [
  requireLabel ? body("label").isString().trim().notEmpty().isLength({ max: 120 }) : body("label").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("key").optional().isString().trim().isLength({ max: 60 }),
  body("type").optional().isIn(customFields.FIELD_TYPES),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("options").optional({ nullable: true }).isArray({ max: 100 }),
  body("required").optional().isBoolean().toBoolean(),
  body("hidden").optional().isBoolean().toBoolean(),
  body("validation").optional({ nullable: true }).isObject(),
  body("condition").optional({ nullable: true }),
  body("position").optional().isInt({ min: 0, max: 10000 }).toInt(),
  body("status").optional().isIn(["active", "archived"]),
  validate,
];

router.get(
  "/custom-fields/record-types",
  asyncHandler(async (req, res) => sendSuccess(res, { recordTypes: await customFields.describeRecordTypes({ orgId: req.user.orgId }), fieldTypes: customFields.FIELD_TYPES, conditionOps: customFields.CONDITION_OPS })),
);

router.get(
  "/custom-fields",
  [query("recordType").optional().isIn(customFields.RECORD_TYPE_KEYS), query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await customFields.listDefinitions({ orgId: req.user.orgId, recordType: req.query.recordType || null, includeArchived: Boolean(req.query.includeArchived), scope: "company" }) })),
);

router.post(
  "/custom-fields",
  requireCompanyAdmin,
  [body("recordType").isIn(customFields.RECORD_TYPE_KEYS), body("type").isIn(customFields.FIELD_TYPES), ...customFieldValidators({ requireLabel: true })],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.createDefinition({ orgId: req.user.orgId, projectId: null, recordType: req.body.recordType, payload: req.body, actor: formActor(req) }), 201)),
);

router.patch(
  "/custom-fields/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...customFieldValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.updateDefinition({ orgId: req.user.orgId, projectId: null, definitionId: req.params.id, payload: req.body, actor: formActor(req) }))),
);

router.delete(
  "/custom-fields/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.archiveDefinition({ orgId: req.user.orgId, projectId: null, definitionId: req.params.id, actor: formActor(req) }))),
);

const fieldsetValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 120 }) : body("name").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("isDefault").optional().isBoolean().toBoolean(),
  body("fields").optional().isArray({ max: 100 }),
  body("status").optional().isIn(["active", "archived"]),
  validate,
];

router.get(
  "/custom-fieldsets",
  [query("recordType").optional().isIn(customFields.RECORD_TYPE_KEYS), query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await customFields.listFieldsets({ orgId: req.user.orgId, recordType: req.query.recordType || null, includeArchived: Boolean(req.query.includeArchived) }) })),
);

router.post(
  "/custom-fieldsets",
  requireCompanyAdmin,
  [body("recordType").isIn(customFields.RECORD_TYPE_KEYS), ...fieldsetValidators({ requireName: true })],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.createFieldset({ orgId: req.user.orgId, payload: req.body, actor: formActor(req) }), 201)),
);

router.patch(
  "/custom-fieldsets/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...fieldsetValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.updateFieldset({ orgId: req.user.orgId, fieldsetId: req.params.id, payload: req.body, actor: formActor(req) }))),
);

router.delete(
  "/custom-fieldsets/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.archiveFieldset({ orgId: req.user.orgId, fieldsetId: req.params.id, actor: formActor(req) }))),
);

const recordTypeValidators = ({ requireLabel = false } = {}) => [
  requireLabel ? body("label").isString().trim().notEmpty().isLength({ max: 120 }) : body("label").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("key").optional().isString().trim().isLength({ max: 60 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("fieldsetId").optional({ nullable: true }).isUUID(),
  body("settings").optional({ nullable: true }).isObject(),
  body("position").optional().isInt({ min: 0, max: 10000 }).toInt(),
  body("status").optional().isIn(["active", "archived"]),
  validate,
];

router.get(
  "/record-types",
  [query("tool").optional().isIn(customFields.TOOLS_WITH_RECORD_TYPES), query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await customFields.listRecordTypes({ orgId: req.user.orgId, tool: req.query.tool || null, includeArchived: Boolean(req.query.includeArchived) }), tools: customFields.TOOLS_WITH_RECORD_TYPES })),
);

router.post(
  "/record-types",
  requireCompanyAdmin,
  [body("tool").isIn(customFields.TOOLS_WITH_RECORD_TYPES), ...recordTypeValidators({ requireLabel: true })],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.createRecordType({ orgId: req.user.orgId, payload: req.body, actor: formActor(req) }), 201)),
);

router.patch(
  "/record-types/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), ...recordTypeValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.updateRecordType({ orgId: req.user.orgId, recordTypeId: req.params.id, payload: req.body, actor: formActor(req) }))),
);

router.delete(
  "/record-types/:id",
  requireCompanyAdmin,
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await customFields.archiveRecordType({ orgId: req.user.orgId, recordTypeId: req.params.id, actor: formActor(req) }))),
);

module.exports = router;
