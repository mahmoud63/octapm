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

const mockService = {
  listProjectTeam: jest.fn(),
  setProjectUserPermission: jest.fn(),
  removeProjectUserPermission: jest.fn(),
  setPartyTemplate: jest.fn(),
};

jest.mock("../../services/permission-template.service", () => mockService);

const teamRouter = require("../project-team");

const USER_ID = "22222222-2222-4222-8222-222222222222";
const PARTY_ID = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/team", teamRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message },
    }),
  );
  return app;
};

describe("project team routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.listProjectTeam.mockResolvedValue({ items: [], parties: [] });
    mockService.setProjectUserPermission.mockResolvedValue({ id: "pup-1" });
    mockService.removeProjectUserPermission.mockResolvedValue({ removed: true });
    mockService.setPartyTemplate.mockResolvedValue({ id: PARTY_ID });
  });

  it("lets any project member read the team", async () => {
    const res = await request(buildApp()).get("/projects/project-1/team").set("x-role", "warehouse");
    expect(res.status).toBe(200);
    expect(mockService.listProjectTeam).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId: "project-1",
    });
  });

  it("only PMs and company admins may change template assignments", async () => {
    const app = buildApp();

    const denied = await request(app)
      .put(`/projects/project-1/team/${USER_ID}/permissions`)
      .set("x-role", "planning_eng")
      .send({ templateId: TEMPLATE_ID });
    expect(denied.status).toBe(403);
    expect(mockService.setProjectUserPermission).not.toHaveBeenCalled();

    const asAdmin = await request(app)
      .put(`/projects/project-1/team/${USER_ID}/permissions`)
      .set("x-role", "qs")
      .set("x-company-admin", "1")
      .send({ templateId: TEMPLATE_ID, overrides: { tools: { cost: "none" } } });
    expect(asAdmin.status).toBe(200);
    expect(mockService.setProjectUserPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        userId: USER_ID,
        payload: { templateId: TEMPLATE_ID, overrides: { tools: { cost: "none" } } },
      }),
    );

    await request(app)
      .delete(`/projects/project-1/team/${USER_ID}/permissions`)
      .set("x-role", "pm")
      .expect(200);
    expect(mockService.removeProjectUserPermission).toHaveBeenCalled();

    await request(app)
      .put(`/projects/project-1/team/parties/${PARTY_ID}/permissions`)
      .set("x-role", "pm")
      .send({ templateId: null })
      .expect(200);
    expect(mockService.setPartyTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ partyId: PARTY_ID, payload: { templateId: null } }),
    );
  });

  it("rejects malformed ids and payloads", async () => {
    const app = buildApp();
    const badUser = await request(app)
      .put("/projects/project-1/team/not-a-uuid/permissions")
      .set("x-role", "pm")
      .send({ templateId: TEMPLATE_ID });
    expect(badUser.status).toBe(400);

    const badTemplate = await request(app)
      .put(`/projects/project-1/team/${USER_ID}/permissions`)
      .set("x-role", "pm")
      .send({ templateId: "nope" });
    expect(badTemplate.status).toBe(400);
  });
});
