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

const mockEvService = {
  listReportingPeriods: jest.fn(),
  createReportingPeriod: jest.fn(),
  lockReportingPeriod: jest.fn(),
  listCostLoadings: jest.fn(),
  createCostLoading: jest.fn(),
  updateCostLoading: jest.fn(),
  submitCostLoading: jest.fn(),
  approveCostLoading: jest.fn(),
  rejectCostLoading: jest.fn(),
  buildOfficialEvReport: jest.fn(),
};

jest.mock("../../services/earned-value.service", () => mockEvService);

const reportsRouter = require("../reports");

const periodId = "11111111-1111-4111-8111-111111111111";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/reports", reportsRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || "INTERNAL_ERROR",
        message: err.message,
      },
    }),
  );
  return app;
}

describe("reports route official EV controls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes PM override reasons into reporting-period lock", async () => {
    mockEvService.lockReportingPeriod.mockResolvedValue({
      official: true,
      readinessOverride: { reason: "Owner monthly steering snapshot" },
    });

    const res = await request(buildApp())
      .post(`/projects/project-1/reports/periods/${periodId}/lock`)
      .set("x-role", "pm")
      .send({ overrideReason: "Owner monthly steering snapshot" });

    expect(res.status).toBe(200);
    expect(mockEvService.lockReportingPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        projectId: "project-1",
        periodId,
        userId: "user-1",
        userRole: "pm",
        overrideReason: "Owner monthly steering snapshot",
      }),
    );
  });

  it("allows Finance to lock ready reporting periods without override", async () => {
    mockEvService.lockReportingPeriod.mockResolvedValue({
      official: true,
      readinessOverride: null,
    });

    const res = await request(buildApp())
      .post(`/projects/project-1/reports/periods/${periodId}/lock`)
      .set("x-role", "finance")
      .send({});

    expect(res.status).toBe(200);
    expect(mockEvService.lockReportingPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        userRole: "finance",
        overrideReason: null,
      }),
    );
  });

  it("blocks QS users from locking official EV snapshots", async () => {
    const res = await request(buildApp())
      .post(`/projects/project-1/reports/periods/${periodId}/lock`)
      .set("x-role", "qs")
      .send({});

    expect(res.status).toBe(403);
    expect(mockEvService.lockReportingPeriod).not.toHaveBeenCalled();
  });
});
