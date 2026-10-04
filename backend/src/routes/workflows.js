const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, hasPermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const engine = require("../services/workflow-engine.service");
const tools = require("../services/workflow-tools");
const primeContractService = require("../services/prime-contract.service");
const { isPartyScopedAccess } = require("../services/company-party.service");
const { boqFigureAccess, withheldWorkflowInstance } = require("../utils/boq-figures");

/** Workflow engine (OCTA-PLAT-WF-024): `/projects/:projectId/workflows`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });

// Who reads a run: the run is its record's, shown to someone assigned to it
// or who may read the record — its module, and for a party member the
// record's own rule (certification L41, workflow-engine visibleRunIds). The
// same viewer the comment and attachment routes judge a record with.
const viewer = (req) => {
  const partyScoped = isPartyScopedAccess(req.projectAccess || {});
  const parties = req.projectAccess?.partyAccess || [];
  return {
    id: req.user.id,
    userId: req.user.id,
    canRead: (moduleName) => hasPermission(req, moduleName, "read"),
    partyIds: partyScoped ? parties.map((party) => party.projectPartyId).filter(Boolean) : null,
    companyIds: partyScoped ? [...new Set(parties.map((party) => party.companyId).filter(Boolean))] : null,
  };
};

// A payment-certificate run's context `amount` is the certificate's net
// payable when the run started. The engine no longer stores it while the
// contract's value is unestablished under a retention cap; a run stored
// before that rule still carries it, and loses it here for a member who may
// not read the BOQ (utils/boq-figures withheldWorkflowInstance). The
// contract's terms are read once per request and only for such a member.
const instanceView = async (req) => {
  const access = boqFigureAccess(req);
  if (access.boq) return (instance) => instance;
  const terms = await primeContractService.contractValueTerms(scope(req));
  return (instance) => withheldWorkflowInstance(instance, terms, access);
};
const viewed = async (req, instance) => (await instanceView(req))(instance);

const templateValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 160 }) : body("name").optional().isString().trim().isLength({ min: 1, max: 160 }),
  body("tool").optional().isIn(tools.TOOL_KEYS),
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
  "/tools",
  requirePermission("workflow", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, { tools: await engine.describeTools({ orgId: req.user.orgId }) })),
);

router.get(
  "/templates",
  requirePermission("workflow", "read"),
  [query("tool").isString().optional().isIn(tools.TOOL_KEYS), query("includeArchived").isString().optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await engine.listTemplates({ ...scope(req), tool: req.query.tool || null, includeArchived: Boolean(req.query.includeArchived), viewer: viewer(req) }) })),
);

router.post(
  "/templates",
  requirePermission("workflow", "update", { transition: "workflow.manage" }),
  [body("tool").isIn(tools.TOOL_KEYS), ...templateValidators({ requireName: true })],
  asyncHandler(async (req, res) => sendSuccess(res, await engine.createTemplate({ ...scope(req), payload: req.body, actor: actor(req) }), 201)),
);

router.patch(
  "/templates/:templateId",
  requirePermission("workflow", "update", { transition: "workflow.manage" }),
  [param("templateId").isUUID(), ...templateValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await engine.updateTemplate({ ...scope(req), templateId: req.params.templateId, payload: req.body, actor: actor(req) }))),
);

router.delete(
  "/templates/:templateId",
  requirePermission("workflow", "update", { transition: "workflow.manage" }),
  [param("templateId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await engine.archiveTemplate({ ...scope(req), templateId: req.params.templateId, actor: actor(req) }))),
);

router.get(
  "/my-steps",
  requirePermission("workflow", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, { items: await engine.myAssignments({ orgId: req.user.orgId, userId: req.user.id, projectId: req.params.projectId }) })),
);

router.get(
  "/instances",
  requirePermission("workflow", "read"),
  [query("tool").isString().optional().isIn(tools.TOOL_KEYS), query("recordId").isString().optional({ values: "falsy" }).isUUID(), query("status").isString().optional().isIn(Object.values(engine.INSTANCE_STATUS)), query("limit").isString().optional().isInt({ min: 1, max: 200 }).toInt(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, { items: (await engine.listInstances({ ...scope(req), tool: req.query.tool || null, recordId: req.query.recordId || null, status: req.query.status || null, limit: req.query.limit || 50, viewerId: req.user.id, viewer: viewer(req) })).map(await instanceView(req)) }),
  ),
);

router.post(
  "/instances",
  requirePermission("workflow", "update", { transition: "workflow.manage" }),
  [body("tool").isIn(tools.TOOL_KEYS), body("recordId").isString().isUUID(), body("templateId").optional({ nullable: true }).isString().isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await viewed(req, await engine.startInstance({ ...scope(req), tool: req.body.tool, recordId: req.body.recordId, templateId: req.body.templateId || null, actor: actor(req), trigger: "manual", viewer: viewer(req) })), 201)),
);

router.get(
  "/instances/:instanceId",
  requirePermission("workflow", "read"),
  [param("instanceId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await viewed(req, await engine.getInstance({ ...scope(req), instanceId: req.params.instanceId, viewerId: req.user.id, viewer: viewer(req) })))),
);

router.post(
  "/instances/:instanceId/respond",
  requirePermission("workflow", "submit", { transition: "workflow.respond" }),
  [param("instanceId").isUUID(), body("response").isString().trim().notEmpty(), body("comment").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await viewed(req, await engine.respond({ ...scope(req), instanceId: req.params.instanceId, actor: actor(req), response: req.body.response, comment: req.body.comment || null, canOverride: hasPermission(req, "workflow", "update", { transition: "workflow.manage" }), viewer: viewer(req) })),
    ),
  ),
);

router.post(
  "/instances/:instanceId/cancel",
  requirePermission("workflow", "update", { transition: "workflow.manage" }),
  [param("instanceId").isUUID(), body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await viewed(req, await engine.cancelInstance({ ...scope(req), instanceId: req.params.instanceId, actor: actor(req), reason: req.body.reason || null, viewer: viewer(req) })))),
);

module.exports = router;
