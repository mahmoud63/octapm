/**
 * The task API mounted outside a project (/api/v1/tasks) lets the named
 * project's permission template decide, as the project's own mount does
 * (Phase 21D, CX21-492).
 */
const express = require("express");
const request = require("supertest");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

const mockPrisma = {
  task: { findFirst: jest.fn(async () => ({ projectId: PROJECT_ID })) },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", role: "pm", isCompanyAdmin: false };
    next();
  },
}));
jest.mock("../../middleware/subscription-gate", () => ({ subscriptionGate: (_req, _res, next) => next() }));

const mockTaskService = {
  TASK_LABELS: ["general"],
  TASK_PRIORITIES: ["medium"],
  TASK_STATUSES: ["todo", "done"],
  listTasks: jest.fn(async () => ({ items: [], pagination: { hasMore: false, nextCursor: null } })),
  getTaskById: jest.fn(async () => ({ id: TASK_ID, projectId: PROJECT_ID })),
  createTask: jest.fn(async () => ({ id: TASK_ID, projectId: PROJECT_ID })),
  updateTask: jest.fn(async () => ({ id: TASK_ID })),
};
jest.mock("../../services/task.service", () => mockTaskService);

const mockAssertProjectAccess = jest.fn(async ({ projectId }) => ({ id: projectId, role: "pm", scope: "project", partyAccess: [] }));
jest.mock("../../services/project-authorization.service", () => ({ assertProjectAccess: mockAssertProjectAccess }));

const mockTemplates = jest.requireActual("../../services/permission-template.service");
const denyTasks = mockTemplates.compileTemplate({
  id: "tpl-1",
  name: "No tasks",
  kind: "internal",
  baseRole: "pm",
  tools: [{ module: "task", level: "none" }],
  grants: [],
});
let attachedTemplate = null;
const mockAttachTemplateContext = jest.fn(async ({ req }) => {
  if (req.projectAccess && attachedTemplate) req.projectAccess.template = attachedTemplate;
  return null;
});
jest.mock("../../services/permission-template.service", () => ({
  attachTemplateContext: mockAttachTemplateContext,
  templateAllows: mockTemplates.templateAllows,
}));

const tasksRouter = require("../tasks");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/tasks", tasksRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details } }),
  );
  return app;
};

describe("Phase 21D — integrity (release challenge, ninth pass)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    attachedTemplate = null;
  });

  it("CX21-492: the project named in the query, the body or through the task is resolved, and a template that refuses tasks there refuses them here", async () => {
    attachedTemplate = denyTasks;
    const app = buildApp();

    const list = await request(app).get(`/tasks?projectId=${PROJECT_ID}`);
    expect([list.status, list.body.error?.code, list.body.error?.details?.source]).toEqual([403, "FORBIDDEN", "template"]);
    expect(mockTaskService.listTasks).not.toHaveBeenCalled();

    const byId = await request(app).get(`/tasks/${TASK_ID}`);
    expect([byId.status, byId.body.error?.code]).toEqual([403, "FORBIDDEN"]);
    expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TASK_ID, orgId: "org-1" } }));
    expect(mockTaskService.getTaskById).not.toHaveBeenCalled();

    const created = await request(app).post("/tasks").send({ projectId: PROJECT_ID, title: "Snag list" });
    expect([created.status, created.body.error?.code]).toEqual([403, "FORBIDDEN"]);
    expect(mockTaskService.createTask).not.toHaveBeenCalled();

    const edited = await request(app).patch(`/tasks/${TASK_ID}`).send({ title: "Renamed" });
    expect(edited.status).toBe(403);
    expect(mockTaskService.updateTask).not.toHaveBeenCalled();

    expect(mockAssertProjectAccess).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: PROJECT_ID, userId: "user-1" }));
  });

  it("CX21-492: without a template the role policy answers as before, and a list across projects needs no project", async () => {
    const app = buildApp();
    expect((await request(app).get(`/tasks?projectId=${PROJECT_ID}`)).status).toBe(200);
    expect((await request(app).get(`/tasks/${TASK_ID}`)).status).toBe(200);
    expect((await request(app).post("/tasks").send({ projectId: PROJECT_ID, title: "Snag list" })).status).toBe(201);
    mockAssertProjectAccess.mockClear();
    expect((await request(app).get("/tasks")).status).toBe(200);
    expect(mockAssertProjectAccess).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — integrity (release challenge, tenth pass)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    attachedTemplate = null;
  });

  it("CX21-510: a list asked for one project is that project's list — the access resolved for it is not applied across every project", async () => {
    const app = buildApp();
    expect((await request(app).get(`/tasks?projectId=${PROJECT_ID}`)).status).toBe(200);
    expect(mockTaskService.listTasks).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT_ID, projectAccess: expect.objectContaining({ id: PROJECT_ID }) }));
    mockTaskService.listTasks.mockClear();
    expect((await request(app).get("/tasks")).status).toBe(200);
    expect(mockTaskService.listTasks).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, projectAccess: null }));
  });
});
