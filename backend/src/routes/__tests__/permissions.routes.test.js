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

const mockService = {
  TEMPLATE_KINDS: ["internal", "external"],
  CLIENT_TYPES: ["gc", "owner", "consultant", "subcontractor"],
  TEMPLATE_STATUSES: { ACTIVE: "active", ARCHIVED: "archived" },
  LEVEL_VALUES: ["none", "read_only", "standard", "admin"],
  getCatalog: jest.fn(() => ({ modules: [], levels: [] })),
  listTemplates: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  duplicateTemplate: jest.fn(),
  archiveTemplate: jest.fn(),
};

jest.mock("../../services/permission-template.service", () => mockService);

const permissionsRouter = require("../permissions");

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/permissions", permissionsRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message },
    }),
  );
  return app;
};

describe("permission template routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.listTemplates.mockResolvedValue({ items: [] });
    mockService.createTemplate.mockResolvedValue({ id: TEMPLATE_ID });
    mockService.updateTemplate.mockResolvedValue({ id: TEMPLATE_ID });
    mockService.archiveTemplate.mockResolvedValue({ id: TEMPLATE_ID, status: "archived" });
    mockService.duplicateTemplate.mockResolvedValue({ id: TEMPLATE_ID });
  });

  it("serves the catalog to any authenticated user", async () => {
    const res = await request(buildApp()).get("/permissions/catalog").set("x-role", "warehouse");
    expect(res.status).toBe(200);
    expect(mockService.getCatalog).toHaveBeenCalled();
  });

  it("restricts template administration to PMs and company admins", async () => {
    const app = buildApp();

    const denied = await request(app).get("/permissions/templates").set("x-role", "qs");
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    const asPm = await request(app).get("/permissions/templates?kind=external").set("x-role", "pm");
    expect(asPm.status).toBe(200);
    expect(mockService.listTemplates).toHaveBeenCalledWith({
      orgId: "org-1",
      query: expect.objectContaining({ kind: "external" }),
    });

    const asCompanyAdmin = await request(app)
      .post("/permissions/templates")
      .set("x-role", "finance")
      .set("x-company-admin", "1")
      .send({
        name: "Finance read only",
        baseRole: "finance",
        tools: [{ module: "cost", level: "read_only" }],
      });
    expect(asCompanyAdmin.status).toBe(201);
    expect(mockService.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        actorId: "user-1",
        actorRole: "finance",
        payload: expect.objectContaining({ name: "Finance read only" }),
      }),
    );
  });

  it("validates payloads before reaching the service", async () => {
    const app = buildApp();

    const missingName = await request(app)
      .post("/permissions/templates")
      .set("x-role", "pm")
      .send({ tools: [] });
    expect(missingName.status).toBe(400);

    const badLevel = await request(app)
      .patch(`/permissions/templates/${TEMPLATE_ID}`)
      .set("x-role", "pm")
      .send({ tools: [{ module: "cost", level: "owner" }] });
    expect(badLevel.status).toBe(400);
    expect(mockService.updateTemplate).not.toHaveBeenCalled();

    const badId = await request(app).delete("/permissions/templates/not-a-uuid").set("x-role", "pm");
    expect(badId.status).toBe(400);
  });

  it("archives and duplicates through the service", async () => {
    const app = buildApp();
    await request(app).delete(`/permissions/templates/${TEMPLATE_ID}`).set("x-role", "pm").expect(200);
    expect(mockService.archiveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", templateId: TEMPLATE_ID }),
    );

    await request(app)
      .post(`/permissions/templates/${TEMPLATE_ID}/duplicate`)
      .set("x-role", "pm")
      .send({ name: "Copy" })
      .expect(201);
    expect(mockService.duplicateTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: TEMPLATE_ID, payload: { name: "Copy" } }),
    );
  });
});
