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
  TYPES: ["inspection", "itp", "form", "talk"],
  OUTCOMES: ["pass", "fail"],
  SIGNATURE_ROLES: ["inspector", "approver", "subcontractor", "witness", "attendee"],
  listInstances: jest.fn(),
  createInstance: jest.fn(),
  getInstance: jest.fn(),
  updateInstance: jest.fn(),
  deleteInstance: jest.fn(),
  respond: jest.fn(),
  startInstance: jest.fn(),
  completeInstance: jest.fn(),
  transition: jest.fn(),
  sign: jest.fn(),
  raiseDeficiency: jest.fn(),
  openHoldPoints: jest.fn(),
  exportInstancePdf: jest.fn(),
  listTemplates: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  archiveTemplate: jest.fn(),
  duplicateTemplate: jest.fn(),
};
jest.mock("../../services/form.service", () => mockService);

const formsRouter = require("../forms");
const templatesRouter = require("../form-templates");

const ID = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/forms/templates", templatesRouter);
  app.use("/projects/:projectId/forms", formsRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details } }));
  return app;
};

describe("forms routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockService)
      .filter((value) => typeof value === "function")
      .forEach((fn) => fn.mockResolvedValue({ id: ID }));
    mockService.listInstances.mockResolvedValue({ items: [], summary: {} });
    mockService.listTemplates.mockResolvedValue({ items: [], summary: {} });
    mockService.openHoldPoints.mockResolvedValue([{ ref: "ITP-001", label: "Cover", state: "pending" }]);
    mockService.exportInstancePdf.mockResolvedValue({ buffer: Buffer.from("%PDF-1.4"), fileName: "itp-001.pdf" });
  });

  it("lists with viewer context and maps ballInCourtUserId=me", async () => {
    const app = buildApp();
    const response = await request(app).get("/projects/p1/forms?type=itp&overdue=true&ballInCourtUserId=me").set("x-party", "subcontractor");
    expect(response.status).toBe(200);
    expect(mockService.listInstances).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ type: "itp", overdue: true, ballInCourtUserId: "user-1" }), viewer: expect.objectContaining({ projectAccess: expect.objectContaining({ scope: "party" }) }) }),
    );
    const holds = await request(app).get(`/projects/p1/forms/hold-points?activityId=${ID}`);
    expect(holds.status).toBe(200);
    expect(holds.body.data.open).toBe(1);
  });

  it("creates for site engineers and QS, not warehouse; validates the template id", async () => {
    const app = buildApp();
    expect((await request(app).post("/projects/p1/forms").set("x-role", "site_engineer").send({ templateId: ID, activityId: ID, startNow: true })).status).toBe(201);
    expect(mockService.createInstance).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ templateId: ID, startNow: true }) }));
    expect((await request(app).post("/projects/p1/forms").set("x-role", "qs").send({ templateId: ID })).status).toBe(201);
    expect((await request(app).post("/projects/p1/forms").set("x-role", "warehouse").send({ templateId: ID })).status).toBe(403);
    expect((await request(app).post("/projects/p1/forms").send({ templateId: "nope" })).status).toBe(400);
  });

  it("lets subcontractors answer, sign and complete, but only PM / planning close or void", async () => {
    const app = buildApp();
    const answer = await request(app).put(`/projects/p1/forms/${ID}/responses`).set("x-party", "subcontractor").send({ responses: [{ itemId: ITEM, value: "pass" }] });
    expect(answer.status).toBe(200);
    expect(mockService.respond).toHaveBeenCalledWith(expect.objectContaining({ responses: [{ itemId: ITEM, value: "pass" }] }));
    expect((await request(app).put(`/projects/p1/forms/${ID}/responses`).send({ responses: [] })).status).toBe(400);
    expect((await request(app).post(`/projects/p1/forms/${ID}/signatures`).set("x-party", "subcontractor").send({ role: "subcontractor", image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" })).status).toBe(201);
    expect((await request(app).post(`/projects/p1/forms/${ID}/signatures`).send({ role: "boss", image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" })).status).toBe(400);
    expect((await request(app).post(`/projects/p1/forms/${ID}/complete`).set("x-party", "subcontractor").send({})).status).toBe(200);
    expect((await request(app).post(`/projects/p1/forms/${ID}/close`).set("x-party", "subcontractor").send({})).status).toBe(403);
    expect((await request(app).post(`/projects/p1/forms/${ID}/close`).set("x-role", "site_engineer").send({})).status).toBe(403);
    expect((await request(app).post(`/projects/p1/forms/${ID}/close`).set("x-role", "planning_eng").send({})).status).toBe(200);
    expect((await request(app).post(`/projects/p1/forms/${ID}/void`).set("x-role", "planning_eng").send({ reason: "dup" })).status).toBe(403);
    expect((await request(app).post(`/projects/p1/forms/${ID}/void`).set("x-role", "pm").send({ reason: "dup" })).status).toBe(200);
    expect(mockService.transition).toHaveBeenLastCalledWith(expect.objectContaining({ action: "void", reason: "dup" }));
  });

  it("raising a deficiency needs punch create as well; export needs export", async () => {
    const app = buildApp();
    expect((await request(app).post(`/projects/p1/forms/${ID}/items/${ITEM}/deficiency`).set("x-party", "subcontractor").send({})).status).toBe(403);
    expect((await request(app).post(`/projects/p1/forms/${ID}/items/${ITEM}/deficiency`).set("x-role", "site_engineer").send({ priority: "high" })).status).toBe(201);
    const pdf = await request(app).get(`/projects/p1/forms/${ID}/export.pdf?includePhotos=true`).set("x-role", "qs");
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-disposition"]).toContain("itp-001.pdf");
    expect(mockService.exportInstancePdf).toHaveBeenCalledWith(expect.objectContaining({ includePhotos: true }));
    expect((await request(app).get(`/projects/p1/forms/${ID}/export.pdf`).set("x-role", "warehouse")).status).toBe(403);
  });

  it("templates: everyone reads, template admins write, site engineers do not", async () => {
    const app = buildApp();
    expect((await request(app).get("/projects/p1/forms/templates?scope=all").set("x-role", "warehouse")).status).toBe(200);
    expect(mockService.listTemplates).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", query: expect.objectContaining({ scope: "all" }) }));
    expect((await request(app).post("/projects/p1/forms/templates").set("x-role", "site_engineer").send({ name: "Walk" })).status).toBe(403);
    expect((await request(app).post("/projects/p1/forms/templates").set("x-role", "qs").send({ name: "Walk", sections: [{ title: "A", items: [{ label: "x" }] }] })).status).toBe(201);
    expect((await request(app).post("/projects/p1/forms/templates").set("x-party", "subcontractor").send({ name: "Walk" })).status).toBe(403);
    expect((await request(app).post(`/projects/p1/forms/templates/${ID}/duplicate`).set("x-role", "pm").send({})).status).toBe(201);
    expect(mockService.duplicateTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: ID, targetProjectId: "p1" }));
    expect((await request(app).delete(`/projects/p1/forms/templates/${ID}`).set("x-role", "planning_eng")).status).toBe(200);
  });
});
