const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requireProjectAccess } = require("../middleware/project-access");
const { requireRoles } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const {
  enforceProjectLimit,
  subscriptionGate,
} = require("../middleware/subscription-gate");
const { moneyBody } = require("../utils/money");
const projectService = require("../services/project.service");
const setupReadinessService = require("../services/project-setup-readiness.service");
const workspaceDashboardService = require("../services/workspace-dashboard.service");

const router = express.Router();

router.use(authenticate);
router.use(subscriptionGate);

const CONTRACT_TYPES = [
  "lump_sum",
  "unit_rate",
  "remeasurement",
  "cost_plus",
  "design_build",
  "epc",
  "other",
];

const PROJECT_CALENDARS = ["five_day", "six_day", "seven_day", "custom"];
const nestedProjectAccess = [
  param("projectId").isUUID(),
  validate,
  requireProjectAccess("projectId"),
];

const emptyStringToNull = (value) => {
  if (value === null || value === undefined) return value;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const optionalText = (field) =>
  body(field)
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 255 })
    .customSanitizer(emptyStringToNull);

const optionalEnum = (field, values) =>
  body(field)
    .optional({ nullable: true })
    .customSanitizer(emptyStringToNull)
    .custom((value) => {
      if (value === null || values.includes(value)) return true;
      throw new Error(`${field} is invalid`);
    });

const projectPayloadValidators = ({ requireName = false } = {}) => [
  requireName
    ? body("name").isString().trim().notEmpty()
    : body("name").optional().isString().trim().notEmpty(),
  optionalText("type"),
  optionalText("location"),
  optionalText("clientName"),
  optionalText("consultantName"),
  optionalText("contractorName"),
  optionalEnum("contractType", CONTRACT_TYPES),
  optionalText("contractNumber"),
  body("startDate").optional({ nullable: true }).isISO8601(),
  body("endDate").optional({ nullable: true }).isISO8601(),
  body("completionDate").optional({ nullable: true }).isISO8601(),
  body("baselineDate").optional({ nullable: true }).isISO8601(),
  body("dataDate").optional({ nullable: true }).isISO8601(),
  body("revisedCompletionDate").optional({ nullable: true }).isISO8601(),
  body("duration").optional({ nullable: true }).isInt({ min: 0 }).toInt(),
  body("durationUnit").optional().isIn(["days", "weeks", "months"]),
  moneyBody("contractValue"),
  body("defaultRetentionRate")
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 100 })
    .toFloat(),
  moneyBody("ldRatePerDay"),
  body("weatherAllowanceDays").optional().isInt({ min: 0 }).toInt(),
  optionalEnum("projectCalendar", PROJECT_CALENDARS),
  body("reportingCutoffDay")
    .optional({ nullable: true })
    .isInt({ min: 1, max: 31 })
    .toInt(),
  body("currency")
    .optional()
    .isString()
    .isLength({ min: 3, max: 3 })
    .customSanitizer((value) => value.toUpperCase()),
  body("status")
    .optional()
    .isIn(["active", "on_hold", "completed", "cancelled"]),
  body("parties").optional().custom((value) => {
    if (Array.isArray(value) || typeof value === "object") return true;
    throw new Error("parties must be an object or array");
  }),
  body("parties.*.role")
    .optional()
    .isIn(["owner", "consultant", "contractor", "subcontractor"]),
  body("parties.*.companyId").optional({ nullable: true }).isUUID(),
  body("parties.*.companyName")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 255 }),
  body("parties.*.contactName")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 255 }),
  body("parties.*.contactEmail")
    .optional({ nullable: true })
    .isEmail()
    .normalizeEmail(),
  body("parties.*.contactPhone")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 80 }),
  body("parties.*.accessLevel")
    .optional()
    .isIn(["read_only", "collaborator", "reviewer", "admin"]),
  body("endDate")
    .optional({ nullable: true })
    .custom((endDate, { req }) => {
      if (endDate && req.body.startDate) {
        if (new Date(endDate) <= new Date(req.body.startDate)) {
          throw new Error("endDate must be after startDate");
        }
      }

      return true;
    }),
];

router.get(
  "/",
  [
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").optional().isString(),
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("search").optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await projectService.listProjects({
      orgId: req.user.orgId,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: req.user.isCompanyAdmin,
      query: req.query,
    });

    return sendSuccess(res, result);
  }),
);

router.get(
  "/workspace-dashboard",
  asyncHandler(async (req, res) => {
    const result = await workspaceDashboardService.getWorkspaceDashboard({
      orgId: req.user.orgId,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: req.user.isCompanyAdmin,
    });

    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  requireRoles("pm", "planning_eng"),
  enforceProjectLimit,
  [...projectPayloadValidators({ requireName: true }), validate],
  asyncHandler(async (req, res) => {
    const result = await projectService.createProject({
      orgId: req.user.orgId,
      userId: req.user.id,
      role: req.user.role,
      payload: req.body,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.get(
  "/:id",
  [param("id").isUUID(), validate, requireProjectAccess("id")],
  asyncHandler(async (req, res) => {
    const result = await projectService.getProjectById({
      orgId: req.user.orgId,
      projectId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: req.user.isCompanyAdmin,
    });

    return sendSuccess(res, result);
  }),
);

router.get(
  "/:id/setup-readiness",
  [param("id").isUUID(), validate, requireProjectAccess("id")],
  asyncHandler(async (req, res) => {
    const result = await setupReadinessService.getSetupReadiness({
      orgId: req.user.orgId,
      projectId: req.params.id,
    });

    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:id",
  requireRoles("pm", "planning_eng"),
  [
    param("id").isUUID(),
    ...projectPayloadValidators(),
    validate,
    requireProjectAccess("id"),
  ],
  asyncHandler(async (req, res) => {
    const result = await projectService.updateProject({
      orgId: req.user.orgId,
      projectId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
      payload: req.body,
    });

    return sendSuccess(res, result);
  }),
);

router.delete(
  "/:id",
  requireRoles("pm", "planning_eng"),
  [param("id").isUUID(), validate, requireProjectAccess("id")],
  asyncHandler(async (req, res) => {
    const result = await projectService.deleteProject({
      orgId: req.user.orgId,
      projectId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
    });

    return sendSuccess(res, result);
  }),
);

router.use("/:projectId/boq", nestedProjectAccess, require("./boq"));
router.use(
  "/:projectId/activity-boq-allocations",
  nestedProjectAccess,
  require("./activity-boq-allocations"),
);
router.use(
  "/:projectId/parties",
  nestedProjectAccess,
  require("./project-parties"),
);
router.use(
  "/:projectId/locations",
  nestedProjectAccess,
  require("./locations"),
);
router.use("/:projectId/jobs", nestedProjectAccess, require("./jobs"));
router.use("/:projectId/team", nestedProjectAccess, require("./project-team"));
router.use(
  "/:projectId/assignments",
  nestedProjectAccess,
  require("./assignments"),
);
router.use(
  "/:projectId/attachments",
  nestedProjectAccess,
  require("./attachments"),
);
router.use("/:projectId/photos", nestedProjectAccess, require("./photos"));
router.use("/:projectId/comments", nestedProjectAccess, require("./comments"));
router.use(
  "/:projectId/documents",
  nestedProjectAccess,
  require("./document-search"),
);
router.use(
  "/:projectId/subscriptions",
  nestedProjectAccess,
  require("./subscriptions"),
);
router.use(
  "/:projectId/activities",
  nestedProjectAccess,
  require("./activities"),
);
router.use(
  "/:projectId/daily-reports",
  nestedProjectAccess,
  require("./daily-reports"),
);
router.use(
  "/:projectId/site-diaries",
  nestedProjectAccess,
  require("./site-diaries"),
);
router.use(
  "/:projectId/site-reporting",
  nestedProjectAccess,
  require("./site-reporting"),
);
router.use(
  "/:projectId/workflow",
  nestedProjectAccess,
  require("./workflow-uploads"),
);
router.use(
  "/:projectId/equipment",
  nestedProjectAccess,
  require("./equipment"),
);
router.use("/:projectId/audit", nestedProjectAccess, require("./audit"));
router.use("/:projectId/schedule", nestedProjectAccess, require("./schedule"));
router.use("/:projectId/import", nestedProjectAccess, require("./import"));
router.use("/:projectId/export", nestedProjectAccess, require("./export"));
router.use(
  "/:projectId/weekly-reports",
  nestedProjectAccess,
  require("./weekly-reports"),
);
router.use("/:projectId/reports", nestedProjectAccess, require("./reports"));
router.use("/:projectId/health", nestedProjectAccess, require("./health"));
router.use("/:projectId/meetings", nestedProjectAccess, require("./meetings"));
router.use("/:projectId/tasks", nestedProjectAccess, require("./tasks"));
router.use("/:projectId/risks", nestedProjectAccess, require("./risks"));
router.use(
  "/:projectId/long-lead",
  nestedProjectAccess,
  require("./long-lead"),
);
router.use(
  "/:projectId/procurement",
  nestedProjectAccess,
  require("./procurement"),
);
router.use("/:projectId/cost", nestedProjectAccess, require("./cost"));
router.use(
  "/:projectId/change-orders",
  nestedProjectAccess,
  require("./change-orders"),
);
router.use("/:projectId/ipc", nestedProjectAccess, require("./ipc"));
router.use(
  "/:projectId/sub-valuations",
  nestedProjectAccess,
  require("./sub-valuations"),
);
router.use(
  "/:projectId/budget-revisions",
  nestedProjectAccess,
  require("./budget-revisions"),
);
router.use(
  "/:projectId/cash-flow",
  nestedProjectAccess,
  require("./cash-flow"),
);
router.use("/:projectId/eot", nestedProjectAccess, require("./eot"));
router.use(
  "/:projectId/weather-delays",
  nestedProjectAccess,
  require("./weather-delays"),
);
router.use("/:projectId/quality", nestedProjectAccess, require("./quality"));
router.use("/:projectId/ncr", nestedProjectAccess, require("./ncr"));
router.use("/:projectId/itp", nestedProjectAccess, require("./itp"));
router.use("/:projectId/defects", nestedProjectAccess, require("./defects"));
router.use("/:projectId/safety", nestedProjectAccess, require("./safety"));
router.use(
  "/:projectId/material-tests",
  nestedProjectAccess,
  require("./material-tests"),
);
router.use(
  "/:projectId/doc-control",
  nestedProjectAccess,
  require("./doc-control"),
);
router.use("/:projectId/rfi", nestedProjectAccess, require("./rfi"));
router.use(
  "/:projectId/submittals",
  nestedProjectAccess,
  require("./submittals"),
);
// Drawing sets and sheets must be mounted before the legacy drawings router,
// whose `/:drawingId` route would otherwise swallow `/sets` and `/sheets`.
router.use(
  "/:projectId/drawings/sets",
  nestedProjectAccess,
  require("./drawing-sets"),
);
router.use("/:projectId/drawings/sheets", nestedProjectAccess, require("./sheets"));
router.use("/:projectId/drawings", nestedProjectAccess, require("./drawings"));
router.use(
  "/:projectId/transmittals",
  nestedProjectAccess,
  require("./transmittals"),
);
router.use(
  "/:projectId/correspondence",
  nestedProjectAccess,
  require("./correspondence"),
);

module.exports = router;
