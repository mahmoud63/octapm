/**
 * The burn-rate budget line is the contract value over the duration, so it
 * follows the project record's rule for the value (certification L25 / R21):
 * only a reader with ipc:read gets it.
 */

const mockPrisma = {
  project: { findFirst: jest.fn() },
  burnRateEntry: { findMany: jest.fn() },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const costService = require("../cost.service");

describe("burn rate: the budget line", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "p1", orgId: "org-1", contractValue: 78800000, duration: 810, durationUnit: "days" });
    mockPrisma.burnRateEntry.findMany.mockResolvedValue([
      { date: new Date("2026-09-01"), amount: 1000 },
      { date: new Date("2026-09-01"), amount: 500 },
      { date: new Date("2026-09-02"), amount: 250 },
    ]);
  });

  it("gives a reader with ipc:read the budget rate and the line", async () => {
    const result = await costService.getBurnRate({ orgId: "org-1", projectId: "p1", commercial: true });
    expect(result.budgetRate).toBeCloseTo(97283.95, 2);
    expect(result.data).toEqual([
      { date: "2026-09-01", actual: 1500, budget: result.budgetRate },
      { date: "2026-09-02", actual: 250, budget: result.budgetRate },
    ]);
    expect(result.budgetWithheld).toBeUndefined();
  });

  it("withholds both from a reader without it (the default), and keeps the actual spend", async () => {
    const result = await costService.getBurnRate({ orgId: "org-1", projectId: "p1" });
    expect(result.budgetRate).toBeNull();
    expect(result.budgetWithheld).toBe(true);
    expect(result.data).toEqual([
      { date: "2026-09-01", actual: 1500, budget: null },
      { date: "2026-09-02", actual: 250, budget: null },
    ]);
  });
});
