const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { subscriptionGate } = require("../middleware/subscription-gate");
const { validate } = require("../middleware/validate");
const taskService = require("../services/task.service");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { assertProjectAccess } = require("../services/project-authorization.service");
const { attachTemplateContext } = require("../services/permission-template.service");

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(subscriptionGate);

// An API key limited to some projects is held to them on this mount as on a
// project's own: the list and the creation carry its list, and every task
// addressed by id must be on one of its projects (Phase 21D, CX21-486).
const keyProjects = (req) => (req.apiClient?.projectIds?.length ? req.apiClient.projectIds : null);
router.param("id", asyncHandler(async (req, res, next) => {
  const task = await prisma.task.findFirst({ where: { id: req.params.id, orgId: req.user.orgId }, select: { projectId: true } });
  req.taskProjectId = task?.projectId || null;
  const allowed = keyProjects(req);
  if (allowed && task && !allowed.includes(task.projectId)) {
    return next(new HttpError(403, "FORBIDDEN_PROJECT", "This API key is not allowed on that project"));
  }
  return next();
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestedProjectId = (req) => {
  const candidate = req.taskProjectId || req.body?.projectId || req.query?.projectId || null;
  const id = candidate ? String(candidate).trim() : null;
  return id && UUID.test(id) ? id : null;
};

// Mounted outside a project (/api/v1/tasks), the request still names one — in
// its query, its body, or through the task it addresses — and that project's
// permission template must decide as it does on the project's own mount: a
// template that refused tasks there was not consulted here, and the role's
// policy answered instead (Phase 21D, CX21-492). The project mount has done
// all of this already (req.projectAccess is set) and is left alone.
const projectContext = asyncHandler(async (req, res, next) => {
  if (req.params.projectId || req.projectAccess) return next();
  const projectId = requestedProjectId(req);
  if (!projectId) return next();
  const allowed = keyProjects(req);
  if (allowed && !allowed.includes(projectId)) {
    return next(new HttpError(403, "FORBIDDEN_PROJECT", "This API key is not allowed on that project"));
  }
  req.projectAccess = await assertProjectAccess({
    orgId: req.user.orgId,
    projectId,
    userId: req.user.id,
    role: req.user.role,
    isCompanyAdmin: req.user.isCompanyAdmin,
  });
  await attachTemplateContext({ req });
  return next();
});

const optionalNullableUuid = (field) =>
  body(field).optional({ values: "falsy" }).isUUID();

const attachmentValidators = [
  body("attachments")
    .optional()
    .custom((value) => Array.isArray(value) || typeof value === "object")
    .withMessage("attachments must be an array or object"),
  body("attachments.*.projectDocumentId")
    .optional({ values: "falsy" })
    .isUUID(),
  body("attachments.*.documentId").optional({ values: "falsy" }).isUUID(),
  body("attachments.*.id").optional({ values: "falsy" }).isUUID(),
  body("attachments.*.fileName")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 255 }),
  body("attachments.*.fileUrl")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 2000 }),
  body("attachments.*.storageKey")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 1000 }),
];

const taskPayloadValidators = ({ requireTitle = false } = {}) => [
  requireTitle
    ? body("title").isString().trim().notEmpty().isLength({ max: 255 })
    : body("title").optional().isString().trim().notEmpty().isLength({ max: 255 }),
  body("description")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 4000 }),
  body("label").optional().isIn(taskService.TASK_LABELS),
  body("priority").optional().isIn(taskService.TASK_PRIORITIES),
  body("status").optional().isIn(taskService.TASK_STATUSES),
  body("dueDate").optional({ nullable: true }).isISO8601(),
  optionalNullableUuid("projectId"),
  optionalNullableUuid("activityId"),
  optionalNullableUuid("assigneeId"),
  body("comment")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 4000 }),
  ...attachmentValidators,
  validate,
];

router.get(
  "/",
  projectContext,
  requirePermission("task", "read"),
  [
    query("cursor").optional({ values: "falsy" }).isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").optional().isString().trim(),
    query("priority").optional().isString().trim(),
    query("assignee").optional().isIn(["me"]),
    query("assigneeId").optional({ values: "falsy" }).isUUID(),
    query("overdue").optional().isBoolean().toBoolean(),
    query("includeArchived").optional().isBoolean().toBoolean(),
    query("search").optional().isString().trim(),
    query("sortBy")
      .optional()
      .isIn(["created", "updated", "due", "priority", "status"]),
    query("sortDir").optional().isIn(["asc", "desc"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await taskService.listTasks({
      orgId: req.user.orgId,
      projectId: req.params.projectId || null,
      userId: req.user.id,
      role: req.user.role,
      projectAccess: req.projectAccess || null,
      query: req.query,
      projectIds: keyProjects(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  projectContext,
  requirePermission("task", "create", { transition: "task.assign" }),
  taskPayloadValidators({ requireTitle: true }),
  asyncHandler(async (req, res) => {
    const result = await taskService.createTask({
      orgId: req.user.orgId,
      projectId: req.params.projectId || null,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
      allowedProjectIds: keyProjects(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  "/:id",
  projectContext,
  requirePermission("task", "read"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await taskService.getTaskById({
      orgId: req.user.orgId,
      projectId: req.params.projectId || null,
      taskId: req.params.id,
      userId: req.user.id,
      role: req.user.role,
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:id",
  projectContext,
  requirePermission("task", "update"),
  [param("id").isUUID(), ...taskPayloadValidators()],
  asyncHandler(async (req, res) => {
    const result = await taskService.updateTask({
      orgId: req.user.orgId,
      projectId: req.params.projectId || null,
      taskId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/close",
  projectContext,
  requirePermission("task", "update", { transition: "task.close" }),
  [
    param("id").isUUID(),
    body("comment")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 4000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await taskService.closeTask({
      orgId: req.user.orgId,
      projectId: req.params.projectId || null,
      taskId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/comments",
  projectContext,
  requirePermission("task", "submit", { transition: "task.comment" }),
  [
    param("id").isUUID(),
    body("body").isString().trim().notEmpty().isLength({ max: 4000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await taskService.addTaskComment({
      orgId: req.user.orgId,
      projectId: req.params.projectId || null,
      taskId: req.params.id,
      body: req.body.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/:id/attachments",
  projectContext,
  requirePermission("task", "update"),
  [param("id").isUUID(), ...attachmentValidators, validate],
  asyncHandler(async (req, res) => {
    const result = await taskService.addTaskAttachment({
      orgId: req.user.orgId,
      projectId: req.params.projectId || null,
      taskId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.delete(
  "/:id",
  projectContext,
  requirePermission("task", "delete"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await taskService.deleteTask({
      orgId: req.user.orgId,
      projectId: req.params.projectId || null,
      taskId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      projectAccess: req.projectAccess || null,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
