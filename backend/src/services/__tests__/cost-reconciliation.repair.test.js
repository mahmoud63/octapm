/**
 * The reconciliation repair rebuilds the projections from the ledger under a
 * lock taken first, in its own statement (Phase 21D, CX21-428 / CX21-432).
 */
const calls = [];
const mockPrisma = {
  project: { findFirst: jest.fn(async () => ({ id: "p1", name: "Tower" })) },
  costLedgerEntry: { findMany: jest.fn(async () => [{ amount: 150, budgetLineId: "bl-1", activityId: "act-1", sourceType: "timesheet", costType: "labour", incurredOn: new Date("2027-03-02T00:00:00.000Z") }]) },
  budgetLine: { findMany: jest.fn(async () => [{ id: "bl-1", actual: 100, costType: "labour", costCode: { code: "01-100", name: "Earthworks" } }]) },
  costRecord: {
    findMany: jest.fn(async () => [{ id: "cr-1", activityId: "act-1", actual: 100, actualThroughDate: new Date("2027-02-02T00:00:00.000Z"), activity: { activityCode: "A-100", name: "Excavate" } }]),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(async (strings) => { calls.push(`lock:${strings.join("?")}`); return []; }),
  $executeRaw: jest.fn(async (strings) => { calls.push(`write:${strings.join("?")}`); return 1; }),
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => ({ ENTITY_TYPES: { COST_RECORD: "cost_record" }, ACTIONS: { UPDATED: "updated" }, recordEvent: jest.fn(async () => ({})) }));
jest.mock("../cost-migration.service", () => ({ analyse: jest.fn(async () => ({ migrationRequired: false, summary: { rowsNeedingOpening: 0, openingTotal: 0, byClassification: {} } })) }));

const service = require("../cost-reconciliation.service");

describe("Phase 21D — integrity (release challenge, third pass)", () => {
  it("CX21-432: the repair holds the projection rows in their own statement, then derives amount and through-date in one write", async () => {
    await service.recomputeActualCost({ orgId: "org-1", projectId: "p1", actor: { id: "pm" } });
    const locks = calls.filter((c) => c.startsWith("lock:"));
    const writes = calls.filter((c) => c.startsWith("write:"));
    expect(locks).toHaveLength(2);
    expect(writes).toHaveLength(2);
    expect(calls.findIndex((c) => c.startsWith("lock:"))).toBeLessThan(calls.findIndex((c) => c.startsWith("write:")));
    expect(locks.every((c) => c.includes("FOR NO KEY UPDATE"))).toBe(true);
    const recordWrite = writes.find((c) => c.includes('"CostRecord"'));
    expect(recordWrite).toContain('MAX(e."incurredOn")');
    expect(recordWrite).toContain("SUM(e.amount)");
    expect(mockPrisma.costRecord.updateMany).not.toHaveBeenCalled();
  });
});
