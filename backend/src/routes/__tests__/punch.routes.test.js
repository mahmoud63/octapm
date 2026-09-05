const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", name: "Sami", role: req.get("x-role") || "site_engineer" };
    if (req.get("x-party") === "subcontractor") {
      req.projectAccess = { role: "external_party", scope: "party", partyAccess: [{ projectPartyId: "party-1", companyId: "company-sub", role: "subcontractor" }] };
    }
    next();
  },
}));

const mockService = {
  ACTIONS: ["open", "ready_for_review", "close", "reopen", "dispute", "resolve_dispute", "void"],
  PRIORITIES: ["low", "normal", "high", "urgent"],
  MAX_BULK: 100,
  listPunchItems: jest.fn(),
  createPunchItem: jest.fn(),
  bulkCreatePunchItems: jest.fn(),
  getPunchItem: jest.fn(),
  updatePunchItem: jest.fn(),
  transitionPunchItem: jest.fn(),
  deletePunchItem: jest.fn(),
  distributePunchItems: jest.fn(),
  exportPunchListPdf: jest.fn(),
  exportPunchListCsv: jest.fn(),
};
jest.mock("../../services/punch.service", () => mockService);

const router = require("../punch");

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/punch", router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message } }));
  return app;
};

describe("punch routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.listPunchItems.mockResolvedValue({ items: [], summary: {} });
    mockService.createPunchItem.mockResolvedValue({ id: ITEM_ID });
    mockService.bulkCreatePunchItems.mockResolvedValue({ items: [], created: 2 });
    mockService.transitionPunchItem.mockResolvedValue({ id: ITEM_ID, status: "closed" });
    mockService.distributePunchItems.mockResolvedValue({ items: 1, recipients: [] });
    mockService.exportPunchListPdf.mockResolvedValue({ buffer: Buffer.from("%PDF-1.4"), fileName: "punch.pdf", count: 1 });
    mockService.exportPunchListCsv.mockResolvedValue({ csv: "Ref,Title", fileName: "punch.csv", count: 1 });
    mockService.updatePunchItem.mockResolvedValue({ id: ITEM_ID });
    mockService.deletePunchItem.mockResolvedValue({ deleted: true });
  });

  it("lists with the caller's party context so subcontractors are scoped", async () => {
    const app = buildApp();
    const response = await request(app).get("/projects/project-1/punch?status=open&overdue=true&ballInCourtUserId=me").set("x-party", "subcontractor");
    expect(response.status).toBe(200);
    expect(mockService.listPunchItems).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ status: "open", overdue: true, ballInCourtUserId: "user-1" }),
        viewer: expect.objectContaining({ projectAccess: expect.objectContaining({ scope: "party" }) }),
      }),
    );
  });

  it("lets site engineers and QS create, but not warehouse", async () => {
    const app = buildApp();
    const created = await request(app).post("/projects/project-1/punch").set("x-role", "site_engineer").send({ title: "Crack", priority: "high", status: "open" });
    expect(created.status).toBe(201);
    expect(mockService.createPunchItem).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ title: "Crack", status: "open" }) }));
    const qs = await request(app).post("/projects/project-1/punch").set("x-role", "qs").send({ title: "Crack" });
    expect(qs.status).toBe(201);
    const denied = await request(app).post("/projects/project-1/punch").set("x-role", "warehouse").send({ title: "Crack" });
    expect(denied.status).toBe(403);
    const invalid = await request(app).post("/projects/project-1/punch").send({ title: "", priority: "asap" });
    expect(invalid.status).toBe(400);
    const bulk = await request(app).post("/projects/project-1/punch/bulk").send({ items: [{ title: "A" }, { title: "B" }], defaults: { trade: "Paint" } });
    expect(bulk.status).toBe(201);
    expect(mockService.bulkCreatePunchItems).toHaveBeenCalledWith(expect.objectContaining({ items: [{ title: "A" }, { title: "B" }], defaults: { trade: "Paint" } }));
  });

  it("maps actions to transitions: subs submit for review, only PM closes or voids", async () => {
    const app = buildApp();
    const ready = await request(app).post(`/projects/project-1/punch/${ITEM_ID}/transition`).set("x-party", "subcontractor").send({ action: "ready_for_review" });
    expect(ready.status).toBe(200);
    const subClose = await request(app).post(`/projects/project-1/punch/${ITEM_ID}/transition`).set("x-party", "subcontractor").send({ action: "close" });
    expect(subClose.status).toBe(403);
    const siteClose = await request(app).post(`/projects/project-1/punch/${ITEM_ID}/transition`).set("x-role", "site_engineer").send({ action: "close" });
    expect(siteClose.status).toBe(403);
    const pmClose = await request(app).post(`/projects/project-1/punch/${ITEM_ID}/transition`).set("x-role", "pm").send({ action: "close" });
    expect(pmClose.status).toBe(200);
    expect(mockService.transitionPunchItem).toHaveBeenLastCalledWith(expect.objectContaining({ action: "close", actor: expect.objectContaining({ role: "pm" }) }));
    const siteVoid = await request(app).post(`/projects/project-1/punch/${ITEM_ID}/transition`).set("x-role", "site_engineer").send({ action: "void", reason: "duplicate" });
    expect(siteVoid.status).toBe(403);
    const bad = await request(app).post(`/projects/project-1/punch/${ITEM_ID}/transition`).set("x-role", "pm").send({ action: "explode" });
    expect(bad.status).toBe(400);
  });

  it("exports PDF and CSV with the export permission and distributes with the transition", async () => {
    const app = buildApp();
    const pdf = await request(app).get("/projects/project-1/punch/export.pdf?groupBy=location&includePhotos=true").set("x-role", "qs");
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain("punch.pdf");
    expect(mockService.exportPunchListPdf).toHaveBeenCalledWith(expect.objectContaining({ groupBy: "location", includePhotos: true }));
    const csv = await request(app).get("/projects/project-1/punch/export.csv").set("x-role", "site_engineer");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const noExport = await request(app).get("/projects/project-1/punch/export.csv").set("x-role", "warehouse");
    expect(noExport.status).toBe(403);

    const distributed = await request(app).post("/projects/project-1/punch/distribute").set("x-role", "site_engineer").send({ companyIds: ["22222222-2222-4222-8222-222222222222"], message: "Please action" });
    expect(distributed.status).toBe(200);
    const subDistribute = await request(app).post("/projects/project-1/punch/distribute").set("x-party", "subcontractor").send({});
    expect(subDistribute.status).toBe(403);
  });
});
