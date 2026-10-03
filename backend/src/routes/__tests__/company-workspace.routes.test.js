const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "user-1",
      orgId: "org-1",
      role: req.get("x-role") || "site_engineer",
      isCompanyAdmin: req.get("x-company-admin") === "1",
    };
    next();
  },
}));
jest.mock("../../middleware/subscription-gate", () => ({
  subscriptionGate: (_req, _res, next) => next(),
}));

const mockWorkspace = {
  COST_CODE_CATEGORIES: ["labour", "material", "equipment", "subcontract", "indirect", "overhead", "contingency", "other"],
  RATE_TYPES: ["hourly", "daily"],
  listDirectory: jest.fn(),
  listVendors: jest.fn(),
  vendorMigrationReport: jest.fn(),
  createVendor: jest.fn(),
  updateVendor: jest.fn(),
  listCostCodes: jest.fn(),
  createCostCode: jest.fn(),
  importCostCodes: jest.fn(),
  updateCostCode: jest.fn(),
  listCompanyEquipment: jest.fn(),
  createCompanyEquipment: jest.fn(),
  updateCompanyEquipment: jest.fn(),
};
const mockTemplates = {
  listTemplates: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  archiveTemplate: jest.fn(),
  createProjectFromTemplate: jest.fn(),
};
const mockEngine = {
  describeTools: jest.fn(),
  listTemplates: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  archiveTemplate: jest.fn(),
  seedDefaultTemplates: jest.fn(),
};
jest.mock("../../services/company-workspace.service", () => mockWorkspace);
jest.mock("../../services/project-template.service", () => mockTemplates);
jest.mock("../../services/workflow-engine.service", () => mockEngine);

const router = require("../company-workspace");

const ID = "11111111-1111-4111-8111-111111111111";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/company", router);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message },
    }),
  );
  return app;
};

describe("company workspace routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of Object.values(mockWorkspace)) if (typeof fn === "function") fn.mockResolvedValue({ items: [] });
    for (const fn of Object.values(mockTemplates)) fn.mockResolvedValue({ id: ID });
  });

  it("lets every user read masters for pickers", async () => {
    const app = buildApp();
    for (const path of ["/company/directory", "/company/vendors?trade=steel", "/company/cost-codes", "/company/equipment", "/company/project-templates"]) {
      const res = await request(app).get(path).set("x-role", "warehouse");
      expect(res.status).toBe(200);
    }
    expect(mockWorkspace.listVendors).toHaveBeenCalledWith({ orgId: "org-1", query: expect.objectContaining({ trade: "steel" }) });
  });

  it("gates writes and the migration report to company admins and owners", async () => {
    const app = buildApp();
    const denied = await request(app).post("/company/vendors").set("x-role", "qs").send({ name: "Acme" });
    expect(denied.status).toBe(403);
    // A PM without the admin flag is a member like any other here (ENT-2,
    // product-owner decision 1: the PM shortcut is retired).
    const plainPm = await request(app).post("/company/vendors").set("x-role", "pm").send({ name: "Acme" });
    expect(plainPm.status).toBe(403);
    const deniedReport = await request(app).get("/company/vendors/migration-report").set("x-role", "qs");
    expect(deniedReport.status).toBe(403);

    const created = await request(app)
      .post("/company/vendors")
      .set("x-role", "finance")
      .set("x-company-admin", "1")
      .send({ name: "Acme", trades: ["steel"], leadTimeReliability: 90 });
    expect(created.status).toBe(201);
    expect(mockWorkspace.createVendor).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", actorId: "user-1", payload: expect.objectContaining({ name: "Acme", leadTimeReliability: 90 }) }),
    );

    const imported = await request(app)
      .post("/company/cost-codes/import")
      .set("x-role", "pm").set("x-company-admin", "1")
      .send({ rows: [{ code: "01", name: "General" }] });
    expect(imported.status).toBe(200);

    const fromTemplate = await request(app)
      .post(`/company/project-templates/${ID}/create-project`)
      .set("x-role", "pm").set("x-company-admin", "1")
      .send({ name: "Marina Heights", startDate: "2026-10-01", endDate: "2027-10-01" });
    expect(fromTemplate.status).toBe(201);
    expect(mockTemplates.createProjectFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: ID, userId: "user-1", role: "pm", payload: expect.objectContaining({ name: "Marina Heights" }) }),
    );
  });

  it("validates payloads", async () => {
    const app = buildApp();
    expect((await request(app).post("/company/vendors").set("x-role", "pm").set("x-company-admin", "1").send({})).status).toBe(400);
    expect((await request(app).post("/company/cost-codes").set("x-role", "pm").set("x-company-admin", "1").send({ code: "01" })).status).toBe(400);
    expect((await request(app).post("/company/cost-codes").set("x-role", "pm").set("x-company-admin", "1").send({ code: "01", name: "x", category: "plumbing" })).status).toBe(400);
    expect((await request(app).post("/company/equipment").set("x-role", "pm").set("x-company-admin", "1").send({ name: "Crane", rateType: "weekly" })).status).toBe(400);
    expect((await request(app).post("/company/cost-codes/import").set("x-role", "pm").set("x-company-admin", "1").send({ rows: [] })).status).toBe(400);
    expect((await request(app).post(`/company/project-templates/${ID}/create-project`).set("x-role", "pm").set("x-company-admin", "1").send({})).status).toBe(400);
    expect((await request(app).patch("/company/vendors/not-a-uuid").set("x-role", "pm").set("x-company-admin", "1").send({ name: "x" })).status).toBe(400);
  });

  it("certification R23: lists a member the company workflow templates of the tools their role reads; an admin all", async () => {
    const app = buildApp();
    mockEngine.listTemplates.mockResolvedValue([]);
    expect((await request(app).get("/company/workflow-templates").set("x-role", "site_engineer")).status).toBe(200);
    const site = mockEngine.listTemplates.mock.calls[0][0];
    expect(site).toMatchObject({ orgId: "org-1", projectId: null, scope: "company" });
    expect(site.viewer.canRead("ipc")).toBe(false);
    expect(site.viewer.canRead("commitment")).toBe(false);
    expect(site.viewer.canRead("change_order")).toBe(false);
    expect(site.viewer.canRead("document_control")).toBe(true);

    await request(app).get("/company/workflow-templates").set("x-role", "qs");
    const qs = mockEngine.listTemplates.mock.calls[1][0];
    expect(qs.viewer.canRead("ipc")).toBe(true);
    expect(qs.viewer.canRead("change_order")).toBe(true);

    await request(app).get("/company/workflow-templates").set("x-role", "site_engineer").set("x-company-admin", "1");
    expect(mockEngine.listTemplates.mock.calls[2][0].viewer).toBeNull();
  });
});
