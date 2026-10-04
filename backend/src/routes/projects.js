const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requestForProject, requireProjectAccess } = require("../middleware/project-access");
const { hasPermission, requireRoles } = require("../middleware/rbac");
const { boqFigureAccess, canReadBoq, withheldWorkspaceDashboard } = require("../utils/boq-figures");
const exceptionService = require("../services/exception.service");
const exceptionsRouter = require("./exceptions");
const { validate } = require("../middleware/validate");
const {
  enforceProjectLimit,
  subscriptionGate,
} = require("../middleware/subscription-gate");
const { moneyBody } = require("../utils/money");
const projectService = require("../services/project.service");
const setupReadinessService = require("../services/project-setup-readiness.service");
const workspaceDashboardService = require("../services/workspace-dashboard.service");
const taskService = require("../services/task.service");

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

// The project's commercial terms (contract value, LD rate, default
// retention) go to a caller who may read them on that project — ipc:read,
// the guard on GET /prime-contract, decided as that project's own routes
// decide it (template, role, party). On a project route the request already
// carries that project's access; across projects each is resolved on its own
// (certification L25, project.service COMMERCIAL_TERMS).
const commercialAccessOnRoute = (req) => async () =>
  hasPermission(req, "ipc", "read");
const commercialAccessPerProject = (req) => async (projectId) =>
  hasPermission(await requestForProject(req, projectId), "ipc", "read");
// A page of projects is decided in one go — the same rule, each project's
// own view, without resolving access and template once per row (R28).
const commercialAccessForPage = (req) => async (projectIds) =>
  projectService.commercialTermsReadableIds({ req, projectIds });
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
  body("startDate").optional({ nullable: true }).isString().isISO8601(),
  body("endDate").optional({ nullable: true }).isString().isISO8601(),
  body("completionDate").optional({ nullable: true }).isString().isISO8601(),
  body("baselineDate").optional({ nullable: true }).isString().isISO8601(),
  body("dataDate").optional({ nullable: true }).isString().isISO8601(),
  body("revisedCompletionDate").optional({ nullable: true }).isString().isISO8601(),
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
  body("parties.*.companyId").optional({ nullable: true }).isString().isUUID(),
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
    query("cursor").isString().optional().isUUID(),
    query("limit").isString().optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").optional().isString(),
    query("includeArchived").isString().optional().isBoolean().toBoolean(),
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
      commercialAccessForProjects: commercialAccessForPage(req),
    });

    return sendSuccess(res, result);
  }),
);

router.get(
  "/workspace-dashboard",
  asyncHandler(async (req, res) => {
    // The caller as each project's own routes see them (template, role,
    // party), resolved once per project.
    const views = new Map();
    const viewFor = (projectId) => {
      if (!views.has(projectId)) views.set(projectId, requestForProject(req, projectId));
      return views.get(projectId);
    };

    const result = await workspaceDashboardService.getWorkspaceDashboard({
      orgId: req.user.orgId,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: req.user.isCompanyAdmin,
      // The IPC queue, as the IPC routes admit it: a project's certificates
      // only to a member who may read its IPC (ipc:read, the guard on
      // GET /ipc), and its certificate lines — one per BOQ row allocated,
      // valued off it — only to one who may also read its BOQ, as
      // GET /ipc/:period withholds them (utils/boq-figures).
      ipcAccessFor: async (projectId) => {
        const view = await viewFor(projectId);
        const certificates = hasPermission(view, "ipc", "read");
        return { certificates, lines: certificates && canReadBoq(view) };
      },
      // Every other queue, as that module's own routes decide it on that
      // project (certification N3), and tasks under the task list's rule.
      moduleAccessFor: async (projectId) => {
        const view = await viewFor(projectId);
        return {
          can: (moduleName) => hasPermission(view, moduleName, "read"),
          projectWideTasks: Boolean(view.user) && taskService.hasProjectWideTaskVisibility({ role: req.user.role, projectAccess: view.projectAccess }),
        };
      },
    });

    // Each project's row states its budget (bac) and the EAC built from it:
    // the approved allocations, which that project's schedule, forecast and
    // history withhold from someone who may read neither the BOQ nor the
    // cost module there (§12, utils/boq-figures). Decided per project, as
    // that project's own routes decide it.
    const rows = Array.isArray(result?.projectHealth) ? result.projectHealth : [];
    const access = new Map(
      await Promise.all(
        rows.map(async (row) => [row.id, boqFigureAccess(await viewFor(row.id))]),
      ),
    );
    // PC-7b: the open-exceptions figure, org-wide (§35 rule 2) over the
    // projects the caller can open, counting on each only the exceptions
    // they may read there (utils/boq-figures, per project).
    const openExceptions = await exceptionService.workspaceOpenExceptions({
      orgId: req.user.orgId,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: req.user.isCompanyAdmin,
      accessFor: async (projectId) => exceptionService.exceptionAccessForView(await viewFor(projectId)),
    });
    const dashboard = withheldWorkspaceDashboard(result, (projectId) => access.get(projectId));
    // Each project's contract value, and their total, only where the caller
    // may read the project's commercial terms (certification L25).
    const withTerms = await projectService.withheldDashboardContractValues({
      dashboard,
      orgId: req.user.orgId,
      userId: req.user.id,
      role: req.user.role,
      isCompanyAdmin: req.user.isCompanyAdmin,
      commercialAccessFor: async (projectId) => hasPermission(await viewFor(projectId), "ipc", "read"),
    });
    return sendSuccess(res, { ...withTerms, openExceptions });
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
      commercialAccessFor: commercialAccessPerProject(req),
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
      commercialAccessFor: commercialAccessOnRoute(req),
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
      // Readiness is open to every project member; the bill's rows, values
      // and review trail in it are for those who may read the BOQ, as the
      // BOQ and coverage endpoints decide it (template, role or party).
      canReadBoq: canReadBoq(req),
      // Nor the activities and schedule revisions named under an issue to
      // a member whose template takes the schedule away.
      canReadSchedule: hasPermission(req, "schedule", "read"),
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
      commercialAccessFor: commercialAccessOnRoute(req),
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

// PC-7b: project exceptions, and "Raise change event" beside each source
// record's own routes (full paths, registered before those modules' routers).
router.use("/:projectId/controls/exceptions", nestedProjectAccess, exceptionsRouter);
exceptionsRouter.registerSourceRaiseRoutes(router, nestedProjectAccess);
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
router.use("/:projectId/structure", nestedProjectAccess, require("./structure"));
router.use("/:projectId/jobs", nestedProjectAccess, require("./jobs"));
router.use("/:projectId/custom-fields", nestedProjectAccess, require("./custom-fields"));
router.use("/:projectId/accounting", nestedProjectAccess, require("./project-accounting"));
router.use("/:projectId/bids", nestedProjectAccess, require("./bids"));
router.use("/:projectId/assistant", nestedProjectAccess, require("./assistant"));
router.use("/:projectId/forecast", nestedProjectAccess, require("./forecast"));
router.use("/:projectId/contract", nestedProjectAccess, require("./contract"));
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
  "/:projectId/daily-logs",
  nestedProjectAccess,
  require("./daily-logs"),
);
// PC-6: installed quantities' pending layer (quantity progress entries).
router.use(
  "/:projectId/quantity-progress",
  nestedProjectAccess,
  require("./quantity-progress"),
);
router.use(
  "/:projectId/workflows",
  nestedProjectAccess,
  require("./workflows"),
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
router.use(
  "/:projectId/purchase-orders",
  nestedProjectAccess,
  require("./purchase-orders"),
);
router.use("/:projectId/cost", nestedProjectAccess, require("./cost"));
router.use("/:projectId/budget", nestedProjectAccess, require("./budget"));
router.use("/:projectId/commitments", nestedProjectAccess, require("./commitments"));
router.use("/:projectId/pay-apps", nestedProjectAccess, require("./sub-pay-apps"));
router.use(
  "/:projectId/change-orders",
  nestedProjectAccess,
  require("./change-orders"),
);
router.use("/:projectId/ipc", nestedProjectAccess, require("./ipc"));
router.use(
  "/:projectId/prime-contract",
  nestedProjectAccess,
  require("./prime-contract"),
);
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
router.use("/:projectId/punch", nestedProjectAccess, require("./punch"));
router.use("/:projectId/forms/templates", nestedProjectAccess, require("./form-templates"));
router.use("/:projectId/forms", nestedProjectAccess, require("./forms"));
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
  "/:projectId/drawings/ai",
  nestedProjectAccess,
  require("./drawing-assistant"),
);
router.use(
  "/:projectId/specifications",
  nestedProjectAccess,
  require("./specifications"),
);
router.use(
  "/:projectId/timesheets",
  nestedProjectAccess,
  require("./timesheets"),
);
router.use(
  "/:projectId/change-events",
  nestedProjectAccess,
  require("./change-events"),
);
router.use(
  "/:projectId/direct-costs",
  nestedProjectAccess,
  require("./direct-costs"),
);
router.use(
  "/:projectId/lookaheads",
  nestedProjectAccess,
  require("./lookaheads"),
);
router.use(
  "/:projectId/emails",
  nestedProjectAccess,
  require("./project-emails"),
);
router.use("/:projectId/bim", nestedProjectAccess, require("./bim"));
router.use(
  "/:projectId/drawings/sets",
  nestedProjectAccess,
  require("./drawing-sets"),
);
router.use(
  "/:projectId/drawings/sheets/:sheetId/markups",
  nestedProjectAccess,
  require("./markups"),
);
router.use(
  "/:projectId/drawings/sheets/:sheetId/pins",
  nestedProjectAccess,
  require("./pins"),
);
router.use(
  "/:projectId/drawings/pins",
  nestedProjectAccess,
  require("./record-pins"),
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
