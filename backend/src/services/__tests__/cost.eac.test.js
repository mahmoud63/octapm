/**
 * Estimate at completion on the cost summary (Phase 22A).
 *
 * The Phase 22 audit found the cost cockpit's "Most Likely" forecast sitting
 * below actual-to-date, with "Optimistic" above it — a raw sum of per-record
 * forecasts (many unset) beside plain budget multiples. The rule now: a
 * record's EAC is its forecast when that is a forecast at completion, else
 * the larger of its budget and its actual; the scenarios vary only the cost
 * to complete. Anchored on the Phase 21 actual, 71,204.00.
 */
const mockPrisma = {
  project: { findFirst: jest.fn(async ({ where }) => ({ id: where.id, orgId: "org-1", currency: "USD" })) },
  costRecord: { findMany: jest.fn(async () => []) },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../activity-boq-allocation.service", () => ({
  getApprovedActivityAllocationTotals: jest.fn(async ({ activityIds }) => new Map((activityIds || []).map((id) => [id, { amount: mockBudgets[id] ?? 0 }]))),
}));
jest.mock("../commitment.service", () => ({ activitiesWithExecutedCommitments: jest.fn(async () => new Set()) }));
jest.mock("../budget.service", () => ({
  listBudgetLines: jest.fn(async () => ({ items: [], summary: { totals: { originalBudget: 170000, approvedChanges: 25000, revisions: 5000, revisedBudget: 200000 } } })),
}));

const mockBudgets = {};
const service = require("../cost.service");

const record = (id, { budget, actual, forecast }) => {
  mockBudgets[id] = budget;
  return { id: `cr-${id}`, projectId: "project-1", activityId: id, budget, committed: 0, actual, forecast, activity: { id, category: "Substructure" } };
};

describe("Phase 22A — estimate at completion", () => {
  beforeEach(() => { for (const key of Object.keys(mockBudgets)) delete mockBudgets[key]; });

  it("the most-likely EAC never sits below actual-to-date, and the scenarios order optimistic ≤ most likely ≤ pessimistic, all ≥ actual", async () => {
    mockPrisma.costRecord.findMany.mockResolvedValue([
      record("a", { budget: 100000, actual: 60000, forecast: 0 }), // no forecast set → expects to spend its budget
      record("b", { budget: 50000, actual: 11204, forecast: 6000 }), // a stale forecast below what is already spent → floored at actual
      record("c", { budget: 75000, actual: 0, forecast: 80000 }), // an explicit forecast at completion is kept
    ]);
    const summary = await service.getCostSummary({ orgId: "org-1", projectId: "project-1" });
    expect(summary.totals.actual).toBe(71204);
    expect(summary.eac.basis).toBe("estimate_at_completion");
    // a: max(100000, 60000) = 100000; b: max(50000, 11204) = 50000 (the 6,000 forecast is not an EAC); c: 80000
    expect(summary.eac.mostLikely).toBe(230000);
    expect(summary.totals.forecast).toBe(summary.eac.mostLikely);
    expect(summary.eac.mostLikely).toBeGreaterThanOrEqual(summary.totals.actual);
    expect(summary.eac.optimistic).toBeLessThanOrEqual(summary.eac.mostLikely);
    expect(summary.eac.pessimistic).toBeGreaterThanOrEqual(summary.eac.mostLikely);
    expect(summary.eac.optimistic).toBeGreaterThanOrEqual(summary.totals.actual);
    // scenarios vary the cost to complete only: 230,000 − 71,204 = 158,796
    expect(summary.eac.toComplete).toBeCloseTo(158796, 2);
    expect(summary.eac.optimistic).toBeCloseTo(71204 + 158796 * 0.9, 2);
    expect(summary.eac.pessimistic).toBeCloseTo(71204 + 158796 * 1.15, 2);
  });

  it("a project spent past every forecast reports EAC = actual and a zero cost to complete — never a negative or a figure below actual", async () => {
    mockPrisma.costRecord.findMany.mockResolvedValue([
      record("a", { budget: 10000, actual: 71204, forecast: 5000 }),
    ]);
    const summary = await service.getCostSummary({ orgId: "org-1", projectId: "project-1" });
    expect(summary.eac.mostLikely).toBe(71204);
    expect(summary.eac.toComplete).toBe(0);
    expect(summary.eac.optimistic).toBe(71204);
    expect(summary.eac.pessimistic).toBe(71204);
  });

  it("the summary carries the budget register's own figures, so the cockpit and the register agree on original, changes, revisions and revised budget", async () => {
    mockPrisma.costRecord.findMany.mockResolvedValue([record("a", { budget: 225000, actual: 71204, forecast: 0 })]);
    const summary = await service.getCostSummary({ orgId: "org-1", projectId: "project-1" });
    expect(summary.budget).toEqual({ originalBudget: 170000, approvedChanges: 25000, revisions: 5000, revisedBudget: 200000, source: "budget_register", allocatedToActivities: 225000 });
  });
});
