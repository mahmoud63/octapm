const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "user-1",
      orgId: "org-1",
      role: req.get("x-role") || "site_engineer",
    };
    // An API key acting as that user (Phase 21D, CX21-444).
    if (req.get("x-api-scopes")) req.apiClient = { id: "key-1", scopes: req.get("x-api-scopes").split(","), projectIds: [] };
    next();
  },
}));

const mockJobService = {
  JOB_TYPES: {
    BOQ_PARSE: "boq.parse",
    SCHEDULE_GENERATE: "schedule.generate",
    SCHEDULE_IMPORT: "schedule.import",
    DOCUMENT_EXTRACT: "document.extract",
    REPORT_RENDER: "report.render",
    NOTIFICATION_DELIVER: "notification.deliver",
  },
  JOB_STATUSES: {
    QUEUED: "queued",
    RUNNING: "running",
    SUCCEEDED: "succeeded",
    FAILED: "failed",
    CANCELLED: "cancelled",
  },
  listJobs: jest.fn(),
  getJob: jest.fn(),
  retryJob: jest.fn(),
  cancelJob: jest.fn(),
};

jest.mock("../../jobs/job.service", () => mockJobService);

const jobsRouter = require("../jobs");

const JOB_ID = "11111111-1111-4111-8111-111111111111";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/jobs", jobsRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message },
    }),
  );
  return app;
};

describe("project jobs routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJobService.listJobs.mockResolvedValue({ items: [], summary: {} });
    mockJobService.retryJob.mockResolvedValue({ id: JOB_ID, status: "queued" });
    mockJobService.cancelJob.mockResolvedValue({ id: JOB_ID, status: "cancelled" });
  });

  it("lists and reads jobs scoped to the org and project", async () => {
    mockJobService.getJob.mockResolvedValue({ id: JOB_ID, type: "boq.parse" });
    const app = buildApp();

    await request(app)
      .get("/projects/project-1/jobs?status=failed&limit=10")
      .set("x-role", "finance")
      .expect(200);
    expect(mockJobService.listJobs).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId: "project-1",
      query: expect.objectContaining({ status: "failed", limit: 10 }),
    });

    await request(app).get(`/projects/project-1/jobs/${JOB_ID}`).expect(200);
    expect(mockJobService.getJob).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId: "project-1",
      jobId: JOB_ID,
    });

    mockJobService.getJob.mockResolvedValue(null);
    const missing = await request(app).get(`/projects/project-1/jobs/${JOB_ID}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("JOB_NOT_FOUND");
  });

  it("allows retry only for roles with update permission on the job's module", async () => {
    const app = buildApp();

    mockJobService.getJob.mockResolvedValue({ id: JOB_ID, type: "boq.parse" });
    await request(app)
      .post(`/projects/project-1/jobs/${JOB_ID}/retry`)
      .set("x-role", "qs")
      .expect(202);
    expect(mockJobService.retryJob).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId: "project-1",
      jobId: JOB_ID,
      userId: "user-1",
    });

    mockJobService.getJob.mockResolvedValue({ id: JOB_ID, type: "schedule.generate" });
    const denied = await request(app)
      .post(`/projects/project-1/jobs/${JOB_ID}/retry`)
      .set("x-role", "qs");
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    await request(app)
      .post(`/projects/project-1/jobs/${JOB_ID}/retry`)
      .set("x-role", "planning_eng")
      .expect(202);
    expect(mockJobService.retryJob).toHaveBeenCalledTimes(2);
  });

  it("validates job ids and gates cancel the same way", async () => {
    const app = buildApp();
    mockJobService.getJob.mockResolvedValue({ id: JOB_ID, type: "schedule.generate" });

    await request(app)
      .post("/projects/project-1/jobs/not-a-uuid/cancel")
      .set("x-role", "pm")
      .expect(400);

    await request(app)
      .post(`/projects/project-1/jobs/${JOB_ID}/cancel`)
      .set("x-role", "site_engineer")
      .expect(403);

    await request(app)
      .post(`/projects/project-1/jobs/${JOB_ID}/cancel`)
      .set("x-role", "pm")
      .expect(200);
    expect(mockJobService.cancelJob).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 21D — integrity (release challenge, fourth pass)", () => {
  it("CX21-444: a read-only API key cannot retry or cancel a job its owner could", async () => {
    const app = buildApp();
    mockJobService.getJob.mockResolvedValue({ id: JOB_ID, type: "schedule.generate" });
    mockJobService.retryJob.mockResolvedValue({ id: JOB_ID, status: "queued" });
    mockJobService.cancelJob.mockResolvedValue({ id: JOB_ID, status: "cancelled" });
    const retry = await request(app).post(`/projects/project-1/jobs/${JOB_ID}/retry`).set("x-role", "pm").set("x-api-scopes", "*:read");
    expect(retry.status).toBe(403);
    const cancel = await request(app).post(`/projects/project-1/jobs/${JOB_ID}/cancel`).set("x-role", "pm").set("x-api-scopes", "*:read");
    expect(cancel.status).toBe(403);
    await request(app).post(`/projects/project-1/jobs/${JOB_ID}/retry`).set("x-role", "pm").set("x-api-scopes", "*:write").expect(202);
  });
});

describe("Phase 21D — integrity (release challenge, twelfth pass)", () => {
  it("CX21-533: a job is listed and read under its module's read permission — a key with only a BOQ scope sees BOQ jobs only; a PM sees them all", async () => {
    const app = buildApp();
    mockJobService.listJobs.mockResolvedValue({ items: [{ id: "j1", type: "boq.parse" }, { id: "j2", type: "schedule.generate", payload: { rows: 3 } }], summary: {} });
    const keyed = await request(app).get(`/projects/22222222-2222-4222-8222-222222222222/jobs`).set("x-role", "pm").set("x-api-scopes", "boq:read");
    expect(keyed.status).toBe(200);
    expect(keyed.body.data.items.map((job) => job.id)).toEqual(["j1"]);
    mockJobService.getJob.mockResolvedValue({ id: JOB_ID, type: "schedule.generate" });
    expect((await request(app).get(`/projects/22222222-2222-4222-8222-222222222222/jobs/${JOB_ID}`).set("x-role", "pm").set("x-api-scopes", "boq:read")).status).toBe(404);
    const pm = await request(app).get(`/projects/22222222-2222-4222-8222-222222222222/jobs`).set("x-role", "pm");
    expect(pm.body.data.items).toHaveLength(2);
  });
});
