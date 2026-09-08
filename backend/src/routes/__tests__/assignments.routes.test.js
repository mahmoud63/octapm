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
  RECORD_TYPE_IDS: ["risk", "ncr", "rfi"],
  ASSIGNABLE_FIELDS: ["ownerUserId", "assigneeUserId", "assigneeCompanyId"],
  listMyOpenItems: jest.fn(),
  listUnresolvedAssignments: jest.fn(),
  resolveAssignment: jest.fn(),
};

jest.mock("../../services/record-assignment.service", () => mockService);

const assignmentsRouter = require("../assignments");

const RECORD = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/assignments", assignmentsRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message },
    }),
  );
  return app;
};

describe("assignment routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.listMyOpenItems.mockResolvedValue({ items: [], summary: { total: 0 } });
    mockService.listUnresolvedAssignments.mockResolvedValue({ total: 0, items: [] });
    mockService.resolveAssignment.mockResolvedValue({ recordId: RECORD });
  });

  it("lets any project member read their own open items", async () => {
    const res = await request(buildApp())
      .get("/projects/project-1/assignments/mine?limit=25")
      .set("x-role", "warehouse");
    expect(res.status).toBe(200);
    expect(mockService.listMyOpenItems).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "user-1",
      // The role decides the derived half of the list: a purchase order
      // waiting on approval names a role, not a stored user id.
      role: "warehouse",
      projectIds: ["project-1"],
      limit: 25,
    });
  });

  it("gates the backfill report and manual mapping to PMs and company admins", async () => {
    const app = buildApp();
    const denied = await request(app)
      .get("/projects/project-1/assignments/unresolved")
      .set("x-role", "qs");
    expect(denied.status).toBe(403);

    const report = await request(app)
      .get("/projects/project-1/assignments/unresolved")
      .set("x-role", "finance")
      .set("x-company-admin", "1");
    expect(report.status).toBe(200);
    expect(mockService.listUnresolvedAssignments).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId: "project-1",
    });

    const resolved = await request(app)
      .post("/projects/project-1/assignments/resolve")
      .set("x-role", "pm")
      .send({ recordType: "ncr", recordId: RECORD, field: "assigneeUserId", userId: USER });
    expect(resolved.status).toBe(200);
    expect(mockService.resolveAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        actorId: "user-1",
        actorRole: "pm",
        payload: expect.objectContaining({ field: "assigneeUserId", userId: USER }),
      }),
    );
  });

  it("validates the mapping payload", async () => {
    const app = buildApp();
    const badType = await request(app)
      .post("/projects/project-1/assignments/resolve")
      .set("x-role", "pm")
      .send({ recordType: "invoice", recordId: RECORD, field: "ownerUserId", userId: USER });
    expect(badType.status).toBe(400);

    const badField = await request(app)
      .post("/projects/project-1/assignments/resolve")
      .set("x-role", "pm")
      .send({ recordType: "rfi", recordId: RECORD, field: "owner", userId: USER });
    expect(badField.status).toBe(400);

    const badUser = await request(app)
      .post("/projects/project-1/assignments/resolve")
      .set("x-role", "pm")
      .send({ recordType: "rfi", recordId: RECORD, field: "ownerUserId", userId: "nope" });
    expect(badUser.status).toBe(400);
    expect(mockService.resolveAssignment).not.toHaveBeenCalled();
  });
});
