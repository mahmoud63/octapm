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
    PHOTO_ANALYZE: "photo.analyze",
    BIM_PARSE: "bim.parse",
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

// A job on a document is withheld by document-text.service (certification L2);
// here it passes every job through unless a test says otherwise.
const mockWithheldDocumentJobs = jest.fn(async ({ jobs }) => jobs);
jest.mock("../../services/document-text.service", () => ({
  documentViewer: (viewer) => viewer,
  withheldDocumentJobs: (...args) => mockWithheldDocumentJobs(...args),
}));

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

describe("Phase 21D — integrity (release challenge, thirteenth pass)", () => {
  it("CX21-543: every job type names its module — a schedule key does not see photo-analysis or BIM jobs, their own readers do, and a job of no known type is nobody's to read or manage", async () => {
    const app = buildApp();
    const P = "22222222-2222-4222-8222-222222222222";
    mockJobService.listJobs.mockResolvedValue({ items: [{ id: "p1", type: "photo.analyze", payload: { photoId: "x" } }, { id: "b1", type: "bim.parse" }, { id: "s1", type: "schedule.import" }, { id: "u1", type: "something.new" }], summary: {} });
    const schedule = await request(app).get(`/projects/${P}/jobs`).set("x-role", "pm").set("x-api-scopes", "schedule:read");
    expect(schedule.body.data.items.map((job) => job.id)).toEqual(["s1"]);
    const bim = await request(app).get(`/projects/${P}/jobs`).set("x-role", "pm").set("x-api-scopes", "bim:read");
    expect(bim.body.data.items.map((job) => job.id)).toEqual(["b1"]);
    const documents = await request(app).get(`/projects/${P}/jobs`).set("x-role", "pm").set("x-api-scopes", "document_control:read");
    expect(documents.body.data.items.map((job) => job.id)).toEqual(["p1"]);
    const pm = await request(app).get(`/projects/${P}/jobs`).set("x-role", "pm");
    expect(pm.body.data.items.map((job) => job.id).sort()).toEqual(["b1", "p1", "s1"]);
    mockJobService.getJob.mockResolvedValue({ id: JOB_ID, type: "photo.analyze" });
    expect((await request(app).get(`/projects/${P}/jobs/${JOB_ID}`).set("x-role", "pm").set("x-api-scopes", "schedule:read")).status).toBe(404);
    expect((await request(app).post(`/projects/${P}/jobs/${JOB_ID}/cancel`).set("x-role", "pm").set("x-api-scopes", "schedule:write")).status).toBe(403);
    mockJobService.getJob.mockResolvedValue({ id: JOB_ID, type: "something.new" });
    expect((await request(app).get(`/projects/${P}/jobs/${JOB_ID}`).set("x-role", "pm")).status).toBe(404);
    expect((await request(app).post(`/projects/${P}/jobs/${JOB_ID}/cancel`).set("x-role", "pm")).status).toBe(403);
  });
});

describe("certification L2 — a job on a document carries it only to a reader of that document", () => {
  beforeEach(() => jest.clearAllMocks());

  it("the list and one job go through the document rule with the caller's own viewer, and answer what it returns", async () => {
    const app = buildApp();
    const P = "22222222-2222-4222-8222-222222222222";
    const extract = { id: JOB_ID, type: "document.extract", payload: { documentId: "doc-other-party" }, result: { status: "ready" } };
    const withheld = { ...extract, payload: {}, result: null, payloadWithheld: { keys: ["documentId"], reason: "x" } };
    mockWithheldDocumentJobs.mockImplementation(async ({ jobs }) => jobs.map((job) => (job.type === "document.extract" ? withheld : job)));
    mockJobService.listJobs.mockResolvedValue({ items: [extract, { id: "b1", type: "bim.parse" }], summary: {} });
    const list = await request(app).get(`/projects/${P}/jobs`).set("x-role", "site_engineer");
    expect(list.status).toBe(200);
    expect(list.body.data.items).toEqual([withheld, { id: "b1", type: "bim.parse" }]);
    const [{ orgId, projectId, viewer }] = mockWithheldDocumentJobs.mock.calls[0];
    expect({ orgId, projectId, userId: viewer.userId }).toEqual({ orgId: "org-1", projectId: P, userId: "user-1" });
    expect(viewer.canRead("document_control")).toBe(true);
    expect(viewer.canRead("commitment")).toBe(false); // the site engineer's own reads
    mockJobService.getJob.mockResolvedValue(extract);
    const one = await request(app).get(`/projects/${P}/jobs/${JOB_ID}`).set("x-role", "site_engineer");
    expect(one.status).toBe(200);
    expect(one.body.data).toEqual(withheld);
    mockWithheldDocumentJobs.mockImplementation(async ({ jobs }) => jobs);
  });
});
