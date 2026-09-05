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

const mockLocationService = {
  LOCATION_KINDS: ["site", "building", "level", "zone", "room", "area", "external"],
  listLocations: jest.fn(),
  createLocation: jest.fn(),
  updateLocation: jest.fn(),
  reorderLocations: jest.fn(),
  archiveLocation: jest.fn(),
  restoreLocation: jest.fn(),
};

jest.mock("../../services/location.service", () => mockLocationService);

const locationsRouter = require("../locations");

const roles = [
  "pm",
  "planning_eng",
  "qs",
  "cost_controller",
  "procurement",
  "warehouse",
  "site_engineer",
  "finance",
];

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/locations", locationsRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message },
    }),
  );
  return app;
};

const routeSpecs = [
  {
    name: "location list",
    method: "get",
    path: "/projects/project-1/locations",
    body: undefined,
    allowed: roles,
    expectedStatus: 200,
    mock: mockLocationService.listLocations,
    response: { items: [], tree: [], summary: { total: 0 } },
  },
  {
    name: "location creation",
    method: "post",
    path: "/projects/project-1/locations",
    body: { name: "Level 1", kind: "level", parentId: PARENT_ID },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 201,
    mock: mockLocationService.createLocation,
    response: { id: LOCATION_ID, name: "Level 1" },
  },
  {
    name: "location update",
    method: "patch",
    path: `/projects/project-1/locations/${LOCATION_ID}`,
    body: { name: "Level 1A" },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockLocationService.updateLocation,
    response: { id: LOCATION_ID, name: "Level 1A" },
  },
  {
    name: "location reorder",
    method: "post",
    path: "/projects/project-1/locations/reorder",
    body: { orderedIds: [LOCATION_ID, PARENT_ID] },
    allowed: ["pm", "planning_eng", "site_engineer"],
    expectedStatus: 200,
    mock: mockLocationService.reorderLocations,
    response: [],
  },
  {
    name: "location archive",
    method: "post",
    path: `/projects/project-1/locations/${LOCATION_ID}/archive`,
    body: { reason: "Demolished" },
    allowed: ["pm", "planning_eng"],
    expectedStatus: 200,
    mock: mockLocationService.archiveLocation,
    response: { id: LOCATION_ID, archived: true },
  },
  {
    name: "location restore",
    method: "post",
    path: `/projects/project-1/locations/${LOCATION_ID}/restore`,
    body: {},
    allowed: ["pm", "planning_eng"],
    expectedStatus: 200,
    mock: mockLocationService.restoreLocation,
    response: { id: LOCATION_ID, status: "active" },
  },
];

describe("location routes", () => {
  it.each(
    routeSpecs.flatMap((spec) =>
      roles.map((role) => ({
        role,
        spec,
        expectedAllowed: spec.allowed.includes(role),
      })),
    ),
  )("$role -> $spec.name", async ({ role, spec, expectedAllowed }) => {
    jest.clearAllMocks();
    spec.mock.mockResolvedValue(spec.response);

    const req = request(buildApp())[spec.method](spec.path).set("x-role", role);
    const res = spec.body === undefined ? await req : await req.send(spec.body);

    if (expectedAllowed) {
      expect(res.status).toBe(spec.expectedStatus);
      expect(spec.mock).toHaveBeenCalledTimes(1);
      return;
    }

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(spec.mock).not.toHaveBeenCalled();
  });

  it("validates payloads before calling the service", async () => {
    jest.clearAllMocks();
    const app = buildApp();

    const missingName = await request(app)
      .post("/projects/project-1/locations")
      .set("x-role", "pm")
      .send({ kind: "level" });
    expect(missingName.status).toBe(400);
    expect(missingName.body.error.code).toBe("VALIDATION_ERROR");

    const badKind = await request(app)
      .post("/projects/project-1/locations")
      .set("x-role", "pm")
      .send({ name: "Level 1", kind: "planet" });
    expect(badKind.status).toBe(400);

    const badParent = await request(app)
      .post("/projects/project-1/locations")
      .set("x-role", "pm")
      .send({ name: "Level 1", parentId: "not-a-uuid" });
    expect(badParent.status).toBe(400);

    const badReorder = await request(app)
      .post("/projects/project-1/locations/reorder")
      .set("x-role", "pm")
      .send({ orderedIds: [] });
    expect(badReorder.status).toBe(400);

    expect(mockLocationService.createLocation).not.toHaveBeenCalled();
    expect(mockLocationService.reorderLocations).not.toHaveBeenCalled();
  });

  it("passes the authenticated context and effective role to the service", async () => {
    jest.clearAllMocks();
    mockLocationService.createLocation.mockResolvedValue({ id: LOCATION_ID });

    await request(buildApp())
      .post("/projects/project-1/locations")
      .set("x-role", "planning_eng")
      .send({ name: "Zone 3", kind: "zone" })
      .expect(201);

    expect(mockLocationService.createLocation).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId: "project-1",
      payload: expect.objectContaining({ name: "Zone 3", kind: "zone" }),
      userId: "user-1",
      userRole: "planning_eng",
    });
  });
});
