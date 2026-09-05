const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", role: req.get("x-role") || "site_engineer" };
    next();
  },
}));
jest.mock("../../middleware/rate-limit", () => ({ uploadLimiter: (_req, _res, next) => next() }));
jest.mock("../../services/file-storage.service", () => ({
  ensureTempUploadDirSync: () => require("os").tmpdir(),
  cleanupTempFiles: jest.fn(async () => {}),
}));

const mockService = {
  listSets: jest.fn(),
  createSet: jest.fn(),
  getSet: jest.fn(),
  updateSet: jest.fn(),
  deleteSet: jest.fn(),
  reprocessSet: jest.fn(),
  reviewRevisions: jest.fn(),
  publishSet: jest.fn(),
  listSheets: jest.fn(),
  getSheet: jest.fn(),
  updateSheet: jest.fn(),
  listSheetRevisions: jest.fn(),
  addSheetRevision: jest.fn(),
  publishSheetRevision: jest.fn(),
  offlineManifest: jest.fn(),
};
jest.mock("../../services/drawing-set.service", () => mockService);

const setsRouter = require("../drawing-sets");
const sheetsRouter = require("../sheets");

const SET_ID = "11111111-1111-4111-8111-111111111111";
const SHEET_ID = "22222222-2222-4222-8222-222222222222";
const REV_ID = "33333333-3333-4333-8333-333333333333";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/drawings/sets", setsRouter);
  app.use("/projects/:projectId/drawings/sheets", sheetsRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message } }),
  );
  return app;
};

describe("drawing set and sheet routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.listSets.mockResolvedValue({ items: [] });
    mockService.createSet.mockResolvedValue({ id: SET_ID, status: "processing" });
    mockService.getSet.mockResolvedValue({ id: SET_ID, revisions: [], counts: null });
    mockService.reviewRevisions.mockResolvedValue({ items: [] });
    mockService.publishSet.mockResolvedValue({ published: 1 });
    mockService.listSheets.mockResolvedValue({ items: [], summary: {} });
    mockService.getSheet.mockResolvedValue({ id: SHEET_ID, revisions: [] });
    mockService.updateSheet.mockResolvedValue({ id: SHEET_ID });
    mockService.addSheetRevision.mockResolvedValue({ revision: { id: REV_ID } });
    mockService.publishSheetRevision.mockResolvedValue({ revisionId: REV_ID });
    mockService.offlineManifest.mockResolvedValue({ items: [] });
  });

  it("uploads a set as a PDF and rejects other files", async () => {
    const app = buildApp();
    const accepted = await request(app)
      .post("/projects/project-1/drawings/sets")
      .set("x-role", "site_engineer")
      .field("name", "IFC set")
      .field("purpose", "IFC")
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "set.pdf", contentType: "application/pdf" });
    expect(accepted.status).toBe(202);
    expect(mockService.createSet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        file: expect.objectContaining({ originalname: "set.pdf" }),
        payload: expect.objectContaining({ name: "IFC set", purpose: "IFC" }),
      }),
    );

    const rejected = await request(app)
      .post("/projects/project-1/drawings/sets")
      .attach("file", Buffer.from("PK"), { filename: "set.zip", contentType: "application/zip" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("UNSUPPORTED_DRAWING_FILE");

    const readOnly = await request(app)
      .post("/projects/project-1/drawings/sets")
      .set("x-role", "warehouse")
      .attach("file", Buffer.from("%PDF"), { filename: "set.pdf", contentType: "application/pdf" });
    expect(readOnly.status).toBe(403);
  });

  it("lets site engineers review the grid but only PM / planning publish", async () => {
    const app = buildApp();
    const review = await request(app)
      .patch(`/projects/project-1/drawings/sets/${SET_ID}/revisions`)
      .set("x-role", "site_engineer")
      .send({ updates: [{ id: REV_ID, number: "A-101", title: "Plan", revision: "B" }] });
    expect(review.status).toBe(200);
    expect(mockService.reviewRevisions).toHaveBeenCalledWith(expect.objectContaining({ setId: SET_ID, userId: "user-1" }));

    const invalid = await request(app)
      .patch(`/projects/project-1/drawings/sets/${SET_ID}/revisions`)
      .send({ updates: [{ id: "nope" }] });
    expect(invalid.status).toBe(400);

    const denied = await request(app).post(`/projects/project-1/drawings/sets/${SET_ID}/publish`).set("x-role", "site_engineer").send({});
    expect(denied.status).toBe(403);

    const planning = await request(app).post(`/projects/project-1/drawings/sets/${SET_ID}/publish`).set("x-role", "planning_eng").send({ revisionIds: [REV_ID] });
    expect(planning.status).toBe(200);
    expect(mockService.publishSet).toHaveBeenCalledWith(expect.objectContaining({ revisionIds: [REV_ID], userId: "user-1" }));

    const pm = await request(app).post(`/projects/project-1/drawings/sets/${SET_ID}/publish`).set("x-role", "pm").send({});
    expect(pm.status).toBe(200);
  });

  it("hides superseded revisions from site roles and shows them to PM", async () => {
    const app = buildApp();
    await request(app).get(`/projects/project-1/drawings/sheets/${SHEET_ID}`).set("x-role", "site_engineer");
    expect(mockService.getSheet).toHaveBeenLastCalledWith(expect.objectContaining({ sheetId: SHEET_ID, includeSuperseded: false }));

    await request(app).get(`/projects/project-1/drawings/sheets/${SHEET_ID}`).set("x-role", "pm");
    expect(mockService.getSheet).toHaveBeenLastCalledWith(expect.objectContaining({ includeSuperseded: true }));

    const list = await request(app).get("/projects/project-1/drawings/sheets?discipline=Architectural&status=all&search=plan").set("x-role", "warehouse");
    expect(list.status).toBe(200);
    expect(mockService.listSheets).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ discipline: "Architectural", status: "all", search: "plan" }) }),
    );

    const manifest = await request(app).get("/projects/project-1/drawings/sheets/offline-manifest");
    expect(manifest.status).toBe(200);
    expect(mockService.offlineManifest).toHaveBeenCalled();
  });

  it("uploads a single sheet revision and refuses publish-on-upload without the transition", async () => {
    const app = buildApp();
    const uploaded = await request(app)
      .post(`/projects/project-1/drawings/sheets/${SHEET_ID}/revisions`)
      .set("x-role", "site_engineer")
      .field("revision", "C")
      .attach("file", Buffer.from("%PDF"), { filename: "a-101-c.pdf", contentType: "application/pdf" });
    expect(uploaded.status).toBe(201);
    expect(mockService.addSheetRevision).toHaveBeenCalledWith(expect.objectContaining({ sheetId: SHEET_ID, payload: expect.objectContaining({ revision: "C" }) }));

    const publishDenied = await request(app)
      .post(`/projects/project-1/drawings/sheets/${SHEET_ID}/revisions`)
      .set("x-role", "site_engineer")
      .field("revision", "C")
      .field("publish", "true")
      .attach("file", Buffer.from("%PDF"), { filename: "a-101-c.pdf", contentType: "application/pdf" });
    expect(publishDenied.status).toBe(403);

    const obsolete = await request(app)
      .patch(`/projects/project-1/drawings/sheets/${SHEET_ID}`)
      .set("x-role", "pm")
      .send({ status: "obsolete", obsoleteReason: "Replaced by A-101A" });
    expect(obsolete.status).toBe(200);
    const denied = await request(app).patch(`/projects/project-1/drawings/sheets/${SHEET_ID}`).set("x-role", "site_engineer").send({ status: "obsolete" });
    expect(denied.status).toBe(403);

    const publish = await request(app).post(`/projects/project-1/drawings/sheets/revisions/${REV_ID}/publish`).set("x-role", "pm");
    expect(publish.status).toBe(200);
  });
});
