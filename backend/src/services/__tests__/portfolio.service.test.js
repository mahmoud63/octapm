const mockPrisma = {
  project: { findMany: jest.fn(async () => []) },
  cashFlowEntry: { findMany: jest.fn(async () => []) },
  rfi: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
  punchItem: { groupBy: jest.fn(async () => []) },
  ncrRecord: { groupBy: jest.fn(async () => []) },
  submittal: { groupBy: jest.fn(async () => []) },
  projectHealthSnapshot: { upsert: jest.fn(async ({ create }) => create) },
  backgroundJob: { findFirst: jest.fn(async () => null) },
};
const mockDashboard = { getWorkspaceDashboard: jest.fn() };
const mockJobs = { JOB_TYPES: { PORTFOLIO_REFRESH: "portfolio.refresh" }, JOB_STATUSES: { QUEUED: "queued", RUNNING: "running" }, enqueueJob: jest.fn(async ({ type }) => ({ id: "job-1", status: "queued", type })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../workspace-dashboard.service", () => mockDashboard);
jest.mock("../project-authorization.service", () => ({ getProjectAccessWhere: () => ({}) }));
jest.mock("../../jobs/job.service", () => mockJobs);

const service = require("../portfolio.service");

const now = new Date("2026-09-05T12:00:00Z");
const healthRow = (id, overrides = {}) => ({ id, name: id, overallScore: 72, dimensions: { schedule: 80, cost: 60 }, weakestDimension: { key: "cost", label: "Cost", score: 60 }, spi: 0.95, cpi: 0.88, ev: 1200000, pv: 1260000, ac: 1360000, eac: 5680000, bac: 5000000, openTasks: 4, overdueTasks: 1, pendingChangeOrders: 2, delayedActivities: 3, criticalActivities: 12, procurementRisks: 1, overdueNcrRfi: 2, ...overrides });

describe("portfolio snapshots", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refreshes one snapshot per project from the dashboard, cash flow and open-item counts", async () => {
    mockDashboard.getWorkspaceDashboard.mockResolvedValue({ projectHealth: [healthRow("p1"), healthRow("p2", { spi: null, cpi: null, overallScore: 55 })] });
    mockPrisma.cashFlowEntry.findMany.mockResolvedValue([
      { projectId: "p1", period: "2026-08", inflow: 500000, outflow: 400000 },
      { projectId: "p1", period: "2026-09", inflow: 300000, outflow: 250000 },
      { projectId: "p1", period: "2026-11", inflow: 100000, outflow: 220000 },
      { projectId: "p1", period: "2026-12", inflow: 900000, outflow: 0 },
    ]);
    mockPrisma.rfi.groupBy.mockResolvedValue([{ projectId: "p1", _count: { _all: 5 } }]);
    mockPrisma.rfi.findMany.mockResolvedValue([{ projectId: "p1" }, { projectId: "p1" }]);
    mockPrisma.punchItem.groupBy.mockResolvedValue([{ projectId: "p1", _count: { _all: 9 } }]);
    mockPrisma.ncrRecord.groupBy.mockResolvedValue([{ projectId: "p2", _count: { _all: 1 } }]);
    mockPrisma.submittal.groupBy.mockResolvedValue([]);
    const result = await service.refreshSnapshots({ orgId: "org-1", now });
    expect(mockDashboard.getWorkspaceDashboard).toHaveBeenCalledWith({ orgId: "org-1", userId: null, role: "pm", isCompanyAdmin: true, allProjects: true });
    expect(result).toEqual({ projects: 2, updated: 2, computedAt: now.toISOString() });
    const p1 = mockPrisma.projectHealthSnapshot.upsert.mock.calls.find((call) => call[0].where.projectId === "p1")[0].create;
    expect(p1).toMatchObject({ orgId: "org-1", overallScore: 72, weakestDimension: "cost", spi: 0.95, cpi: 0.88, ev: 1200000, bac: 5000000, cashIn90: 400000, cashOut90: 470000, cashNet90: -70000, cashNetToDate: 150000, openRfis: 5, overdueRfis: 2, openPunch: 9, openNcrs: 0, openTasks: 4, overdueItems: 3, computedAt: now });
    const p2 = mockPrisma.projectHealthSnapshot.upsert.mock.calls.find((call) => call[0].where.projectId === "p2")[0].create;
    expect(p2).toMatchObject({ spi: null, cpi: null, openNcrs: 1, openRfis: 0, cashNet90: 0 });
  });

  it("reads the portfolio from snapshots and flags stale rows", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "p1", name: "Tower", status: "active", currency: "USD", contractValue: 5000000, startDate: new Date("2026-01-01"), endDate: null, clientName: "Acme", healthSnapshot: { overallScore: 72, dimensionsJson: { cost: 60 }, weakestDimension: "cost", spi: 0.95, cpi: 0.88, ev: 1200000, pv: 1260000, ac: 1360000, eac: 5680000, bac: 5000000, cashIn90: 1, cashOut90: 2, cashNet90: -1, cashNetToDate: 5, openRfis: 5, overdueRfis: 2, openPunch: 9, openNcrs: 0, pendingSubmittals: 1, openTasks: 4, overdueTasks: 1, pendingChangeOrders: 2, delayedActivities: 3, criticalActivities: 12, procurementRisks: 1, overdueItems: 3, computedAt: new Date("2026-09-05T11:30:00Z") } },
      { id: "p2", name: "Bridge", status: "active", currency: "USD", contractValue: 2000000, startDate: null, endDate: null, clientName: null, healthSnapshot: null },
      { id: "p3", name: "Depot", status: "on_hold", currency: "USD", contractValue: 100, startDate: null, endDate: null, clientName: null, healthSnapshot: { overallScore: 40, dimensionsJson: {}, weakestDimension: "schedule", spi: 0.7, cpi: 1.1, ev: 0, pv: 0, ac: 0, eac: 0, bac: 0, cashIn90: 0, cashOut90: 0, cashNet90: 0, cashNetToDate: 0, openRfis: 0, overdueRfis: 0, openPunch: 0, openNcrs: 0, pendingSubmittals: 0, openTasks: 0, overdueTasks: 0, pendingChangeOrders: 0, delayedActivities: 0, criticalActivities: 0, procurementRisks: 0, overdueItems: 0, computedAt: new Date("2026-09-05T08:00:00Z") } },
    ]);
    mockPrisma.backgroundJob.findFirst.mockResolvedValue({ id: "job-9" });
    const portfolio = await service.getPortfolio({ orgId: "org-1", user: { id: "u", role: "pm" }, now });
    expect(portfolio.refreshing).toBe(true);
    expect(portfolio.rows.map((row) => [row.name, row.stale])).toEqual([["Tower", false], ["Bridge", true], ["Depot", true]]);
    expect(portfolio.rows[0].snapshot).toMatchObject({ overallScore: 72, spi: 0.95, openItems: 19, overdueItems: 3, stale: false });
    expect(portfolio.summary).toEqual({ projects: 3, active: 2, contractValue: 7000100, averageHealth: 56, atRisk: 1, spiWatch: 1, cpiWatch: 1, openItems: 19, overdueItems: 3, cashNet90: -1, staleCount: 2 });
    expect(portfolio.computedAt).toBe("2026-09-05T11:30:00.000Z");
  });

  it("queues a refresh job once", async () => {
    mockPrisma.backgroundJob.findFirst.mockResolvedValueOnce(null);
    expect(await service.requestRefresh({ orgId: "org-1", user: { id: "u" } })).toEqual({ jobId: "job-1", status: "queued", queued: true });
    expect(mockJobs.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", type: "portfolio.refresh", requestedBy: "u" }));
    mockPrisma.backgroundJob.findFirst.mockResolvedValueOnce({ id: "job-1", status: "running" });
    expect(await service.requestRefresh({ orgId: "org-1", user: { id: "u" } })).toEqual({ jobId: "job-1", status: "running", queued: false });
    expect(mockJobs.enqueueJob).toHaveBeenCalledTimes(1);
  });
});
