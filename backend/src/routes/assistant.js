const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { requirePermission, hasPermission, noApiKey } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/assistant.service");
const briefService = require("../services/ai/project-brief.service");
const { currentRecordSource, RECORD_TYPES } = require("../services/ai/sources/current-record");
const { moduleSources } = require("../services/ai/sources/module-sources");
const { orgModuleSources } = require("../services/ai/sources/inventory-snapshot");
const { requestForProject } = require("../middleware/project-access");
const { throwProjectNotFoundOrAccessDenied } = require("../services/project-authorization.service");
const { canReadBoq } = require("../utils/boq-figures");

/**
 * The caller's access to a project an answer is asked about, decided as that
 * project's own assistant route decides it: the project opened by the caller
 * (403 PROJECT_ACCESS_DENIED, or 404 PROJECT_NOT_FOUND for a project not of
 * this company) and the assistant readable there (template, role, party).
 * The organisation-mounted assistant took the project from the body with no
 * such decision (certification L46); assistant.service ask asks this before
 * it stores, retrieves or calls a model.
 */
const assistantAccessFor = (req) => async (projectId) => {
  const view = await requestForProject(req, projectId);
  if (!view.user) await throwProjectNotFoundOrAccessDenied({ orgId: req.user.orgId, projectId });
  if (!hasPermission(view, "assistant", "read")) {
    const forbidden = new HttpError(403, "FORBIDDEN", "You cannot use the assistant on this project");
    forbidden.details = { module: "assistant", action: "read" };
    throw forbidden;
  }
  return view.projectAccess;
};

/**
 * Whether the caller may read the BOQ on a project now, as that project's
 * own routes decide it (template, role and party) — for a stored run built
 * from the bill, whose owner is given its content only then (owner check,
 * 2026-09-29; assistant.service). Decided on the run's own project, never
 * on the project the route is mounted under.
 */
const readsBoqFor = (req) => async (projectId) =>
  canReadBoq(await requestForProject(req, projectId));

/**
 * Project knowledge assistant (OCTA-AI-ASSIST-028). Mounted twice: under a
 * project (`/projects/:projectId/assistant`, project access resolved) and
 * globally (`/assistant`, every project the caller can open).
 */
const build = ({ withActions }) => {
  const router = express.Router({ mergeParams: true });
  router.use(authenticate);
  // The assistant retrieves, answers and keeps conversations as the person
  // it talks to; an API key has the report assistant, scoped to its own
  // projects and modules, and nothing here (Phase 21D, CX21-443).
  router.use(noApiKey);

  const user = (req) => req.user;
  const projectIdOf = (req) =>
    req.params.projectId || req.body?.projectId || req.query?.projectId || null;

  router.get(
    "/status",
    requirePermission("assistant", "read"),
    asyncHandler(async (req, res) => sendSuccess(res, service.status())),
  );

  router.post(
    "/ask",
    requirePermission("assistant", "read"),
    [
      body("question").isString().trim().notEmpty().isLength({ max: 2000 }),
      body("conversationId").optional({ nullable: true }).isString().isUUID(),
      body("projectId").optional({ nullable: true }).isString().isUUID(),
      // The screen asked from (AI UX correction): labels plus the record on it.
      body("context").optional({ nullable: true }).isObject(),
      body(["context.module", "context.moduleKey", "context.child", "context.childKey", "context.label"]).optional({ nullable: true }).isString().isLength({ max: 120 }),
      body("context.recordType").optional({ nullable: true }).isIn(RECORD_TYPES),
      body("context.recordId").optional({ nullable: true }).isUUID(),
      validate,
    ],
    asyncHandler(async (req, res) =>
      sendSuccess(
        res,
        await service.ask({
          orgId: req.user.orgId,
          user: user(req),
          projectId: projectIdOf(req),
          conversationId: req.body.conversationId || null,
          question: req.body.question,
          projectAccess: req.projectAccess || null,
          accessFor: assistantAccessFor(req),
          // The project digest is the contractor's dashboard; an external party gets none of it (CONSULTANT V1) —
          // their questions are answered from their review queue and the records they may read.
          digestFor: async (projectId) => (require("../services/company-party.service").isPartyScopedAccess((await requestForProject(req, projectId)).projectAccess || {}) ? null : briefService.digest(req, projectId)),
          // The record on the caller's screen, only as that project's own
          // routes would show it to them (services/ai/sources/current-record).
          recordFor: async (projectId, screen) =>
            currentRecordSource({ view: await requestForProject(req, projectId), projectId, recordType: screen.recordType, recordId: screen.recordId }),
          // The module on screen's own results (CPM on Schedule…), decided per module.
          moduleFor: async (projectId, screen) =>
            moduleSources({ view: await requestForProject(req, projectId), projectId, moduleKey: screen.moduleKey, child: screen.childKey }),
          // A company screen (no project), on the caller's own request.
          orgModuleFor: (screen) => orgModuleSources({ req, moduleKey: screen.moduleKey }),
          context: req.body.context || null,
          readsBoq: readsBoqFor(req),
        }),
      ),
    ),
  );

  router.get(
    "/conversations",
    requirePermission("assistant", "read"),
    [query("limit").isString().optional().isInt({ min: 1, max: 100 }).toInt(), validate],
    asyncHandler(async (req, res) =>
      sendSuccess(res, {
        items: await service.listConversations({
          orgId: req.user.orgId,
          user: user(req),
          projectId: req.params.projectId || null,
          limit: req.query.limit || 30,
        }),
      }),
    ),
  );

  router.get(
    "/conversations/:conversationId",
    requirePermission("assistant", "read"),
    [param("conversationId").isUUID(), validate],
    asyncHandler(async (req, res) =>
      sendSuccess(
        res,
        await service.getConversation({
          orgId: req.user.orgId,
          user: user(req),
          conversationId: req.params.conversationId,
          readsBoq: readsBoqFor(req),
        }),
      ),
    ),
  );

  router.delete(
    "/conversations/:conversationId",
    requirePermission("assistant", "read"),
    [param("conversationId").isUUID(), validate],
    asyncHandler(async (req, res) =>
      sendSuccess(
        res,
        await service.deleteConversation({
          orgId: req.user.orgId,
          user: user(req),
          conversationId: req.params.conversationId,
        }),
      ),
    ),
  );

  router.post(
    "/messages/:messageId/feedback",
    requirePermission("assistant", "read"),
    [
      param("messageId").isUUID(),
      body("rating").custom(
        (value) => value === null || ["up", "down"].includes(value),
      ),
      body("note")
        .optional({ nullable: true })
        .isString()
        .trim()
        .isLength({ max: 1000 }),
      validate,
    ],
    asyncHandler(async (req, res) =>
      sendSuccess(
        res,
        await service.feedback({
          orgId: req.user.orgId,
          user: user(req),
          messageId: req.params.messageId,
          rating: req.body.rating,
          note: req.body.note || null,
          readsBoq: readsBoqFor(req),
        }),
      ),
    ),
  );

  /** Suggested actions run through the record's own module permission (project mount only). */
  if (withActions)
    router.post(
      "/actions",
      requirePermission("assistant", "read"),
      [
        body("action").isObject(),
        body("action.type").isIn(service.ACTION_TYPES),
        validate,
      ],
      asyncHandler(async (req, res) => {
        const projectId = projectIdOf(req);
        if (!projectId)
          throw new HttpError(
            400,
            "ASSISTANT_PROJECT_REQUIRED",
            "Actions run inside a project",
          );
        if (!req.params.projectId)
          throw new HttpError(
            400,
            "ASSISTANT_PROJECT_ROUTE",
            "Use the project-scoped assistant to run actions",
          );
        const moduleName =
          req.body.action.type === "create_rfi" ? "rfi" : "task";
        if (!hasPermission(req, moduleName, "create"))
          throw new HttpError(
            403,
            "FORBIDDEN",
            `You cannot create ${moduleName === "rfi" ? "RFIs" : "tasks"} on this project`,
          );
        return sendSuccess(
          res,
          await service.executeAction({
            orgId: req.user.orgId,
            user: user(req),
            projectId,
            action: req.body.action,
            projectAccess: req.projectAccess || null,
          }),
          201,
        );
      }),
    );

  return router;
};

module.exports = build({ withActions: true });
module.exports.orgRouter = build({ withActions: false });
