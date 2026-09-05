const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "user-1",
      orgId: "org-1",
      role: req.get("x-role") || "site_engineer",
    };
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
