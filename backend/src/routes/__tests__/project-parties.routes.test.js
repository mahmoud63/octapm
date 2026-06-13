const express = require("express");
const request = require("supertest");

const projectId = "11111111-1111-4111-8111-111111111111";
const partyId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const mockCompanyPartyService = {
  ACCESS_LEVELS: ["read_only", "collaborator", "reviewer", "admin"],
  PARTY_ROLES: ["owner", "consultant", "contractor", "subcontractor"],
  addProjectPartyMember: jest.fn(),
  createCompany: jest.fn(),
  listCompanies: jest.fn(),
  listProjectParties: jest.fn(),
  removeProjectParty: jest.fn(),
  removeProjectPartyMember: jest.fn(),
  upsertProjectParty: jest.fn(),
};

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "pm-1",
      orgId: "org-1",
      role: req.get("x-role") || "pm",
    };
    next();
  },
}));

jest.mock("../../middleware/subscription-gate", () => ({
  subscriptionGate: (_req, _res, next) => next(),
}));

jest.mock("../../services/company-party.service", () => mockCompanyPartyService);

const companiesRouter = require("../companies");
const projectPartiesRouter = require("../project-parties");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/companies", companiesRouter);
  app.use("/projects/:projectId/parties", projectPartiesRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || "INTERNAL_ERROR",
        message: err.message,
        details: err.details,
      },
    }),
  );
  return app;
}

describe("project party routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates managed companies through the project-party permission gate", async () => {
    mockCompanyPartyService.createCompany.mockResolvedValue({
      id: "company-1",
      name: "Owner Co",
      status: "active",
    });

    const res = await request(buildApp()).post("/companies").send({
      name: "Owner Co",
      type: "external",
      email: "owner@example.com",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: { id: "company-1", name: "Owner Co" },
    });
    expect(mockCompanyPartyService.createCompany).toHaveBeenCalledWith({
      orgId: "org-1",
      payload: expect.objectContaining({
        name: "Owner Co",
        email: "owner@example.com",
      }),
    });
  });

  it("assigns a company as a project party", async () => {
    mockCompanyPartyService.upsertProjectParty.mockResolvedValue({
      id: partyId,
      role: "consultant",
      company: { name: "Consultant Co" },
    });

    const res = await request(buildApp())
      .post(`/projects/${projectId}/parties`)
      .send({
        role: "consultant",
        companyName: "Consultant Co",
        accessLevel: "reviewer",
      });

    expect(res.status).toBe(201);
    expect(mockCompanyPartyService.upsertProjectParty).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId,
      payload: expect.objectContaining({
        role: "consultant",
        companyName: "Consultant Co",
      }),
    });
  });

  it("adds an existing user to a project party", async () => {
    mockCompanyPartyService.addProjectPartyMember.mockResolvedValue({
      id: "member-1",
      status: "active",
    });

    const res = await request(buildApp())
      .post(`/projects/${projectId}/parties/${partyId}/members`)
      .send({ userId, role: "reviewer" });

    expect(res.status).toBe(201);
    expect(mockCompanyPartyService.addProjectPartyMember).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId,
      partyId,
      payload: { userId, role: "reviewer" },
    });
  });

  it("rejects invalid party roles before service execution", async () => {
    const res = await request(buildApp())
      .post(`/projects/${projectId}/parties`)
      .send({ role: "designer", companyName: "Designer Co" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(mockCompanyPartyService.upsertProjectParty).not.toHaveBeenCalled();
  });

  it("denies project-party management to roles without authority", async () => {
    const res = await request(buildApp())
      .post(`/projects/${projectId}/parties`)
      .set("x-role", "site_engineer")
      .send({ role: "consultant", companyName: "Consultant Co" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(mockCompanyPartyService.upsertProjectParty).not.toHaveBeenCalled();
  });
});
