const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", role: req.get("x-role") || "site_engineer" };
    next();
  },
}));

const mockService = {
  searchDocuments: jest.fn(),
  getIndexStatus: jest.fn(),
  reindexProject: jest.fn(),
  getDocumentText: jest.fn(),
  enqueueExtraction: jest.fn(),
};
jest.mock("../../services/document-text.service", () => mockService);

const router = require("../document-search");

const DOC_ID = "11111111-1111-4111-8111-111111111111";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/documents", router);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message } }),
  );
  return app;
};

describe("document search routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.searchDocuments.mockResolvedValue({ query: "rebar", items: [], meta: { total: 0 } });
    mockService.getIndexStatus.mockResolvedValue({ documents: 0 });
    mockService.reindexProject.mockResolvedValue({ queued: 2, skipped: 0, unsupported: 0, total: 2 });
    mockService.getDocumentText.mockResolvedValue({ document: {}, text: null, extractable: true });
    mockService.enqueueExtraction.mockResolvedValue({ queued: true, status: "pending", jobId: "job-1" });
  });

  it("searches with a viewer that mirrors the caller's module permissions", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/projects/project-1/documents/search?q=rebar&limit=5&semantic=true")
      .set("x-role", "pm");
    expect(response.status).toBe(200);
    const call = mockService.searchDocuments.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({ orgId: "org-1", projectId: "project-1", q: "rebar", limit: 5, semantic: true }),
    );
    expect(call.viewer.canRead("ipc")).toBe(true);

    const engineer = await request(app)
      .get("/projects/project-1/documents/search?q=rebar")
      .set("x-role", "site_engineer");
    expect(engineer.status).toBe(200);
    expect(mockService.searchDocuments.mock.calls[1][0].viewer.canRead("ipc")).toBe(false);

    const missing = await request(app).get("/projects/project-1/documents/search");
    expect(missing.status).toBe(400);
  });

  it("gates re-indexing on document_control.update", async () => {
    const app = buildApp();
    const denied = await request(app).post("/projects/project-1/documents/reindex").set("x-role", "site_engineer").send({});
    expect(denied.status).toBe(403);

    const accepted = await request(app).post("/projects/project-1/documents/reindex").set("x-role", "pm").send({ force: true });
    expect(accepted.status).toBe(202);
    expect(mockService.reindexProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", requestedBy: "user-1", force: true }),
    );

    const extract = await request(app).post(`/projects/project-1/documents/${DOC_ID}/extract`).set("x-role", "pm");
    expect(extract.status).toBe(202);
    expect(mockService.enqueueExtraction).toHaveBeenCalledWith(expect.objectContaining({ documentId: DOC_ID, force: true }));
  });

  it("returns text and index status to readers", async () => {
    const app = buildApp();
    const text = await request(app).get(`/projects/project-1/documents/${DOC_ID}/text?maxChars=500`);
    expect(text.status).toBe(200);
    expect(mockService.getDocumentText).toHaveBeenCalledWith(expect.objectContaining({ documentId: DOC_ID, maxChars: 500 }));

    const status = await request(app).get("/projects/project-1/documents/index-status");
    expect(status.status).toBe(200);

    const badId = await request(app).get("/projects/project-1/documents/not-a-uuid/text");
    expect(badId.status).toBe(400);
  });
});
