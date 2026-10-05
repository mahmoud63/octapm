/**
 * A reversed posting does not hold its key (Phase 21D, CX21-006).
 *
 * Approve, reopen, approve again: the first posting, its reversal and the
 * second posting must all be on the ledger, and the net must be the approved
 * amount. Before this, the second approval answered "already posted" and the
 * cost stayed reversed.
 */
const { createCostLedgerMock } = require("./helpers/cost-ledger-mock");

const ledger = createCostLedgerMock();
const mockPrisma = {
  ...ledger.tables,
  $queryRaw: jest.fn(async () => []), // row locks (Phase 21D): the held row, when a test says so
  $executeRaw: jest.fn(async () => 0), // advisory locks (Phase 21D): run, nothing read back
  // Only p1 is org-1's (Phase 21D, CX21-420).
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" && where.orgId === "org-1" ? { id: "p1" } : null)) },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const service = require("../cost-ledger.service");

const posting = (over = {}) => ({
  tx: mockPrisma,
  orgId: "org-1",
  projectId: "p1",
  sourceType: "timesheet",
  sourceId: "ts-1",
  sourceLineId: "entry-1",
  amount: 400,
  costType: "labour",
  incurredOn: "2027-02-02",
  ...over,
});

describe("cost ledger — posting again after a reversal", () => {
  beforeEach(() => ledger.reset());

  it("posts once, refuses the same event twice, and posts again once the first posting is reversed", async () => {
    const first = await service.post(posting());
    expect(first.posted).toBe(true);

    const twice = await service.post(posting());
    expect(twice.posted).toBe(false);
    expect(twice.reason).toBe("already_posted");

    const reversed = await service.reverse({ tx: mockPrisma, orgId: "org-1", projectId: "p1", sourceType: "timesheet", sourceId: "ts-1" });
    expect(reversed.reversed).toBe(1);

    const again = await service.post(posting());
    expect(again.posted).toBe(true);
    expect(again.entry.sourceKey).toBe("timesheet:ts-1:entry-1:r2");

    const entries = await mockPrisma.costLedgerEntry.findMany({ where: { orgId: "org-1" } });
    const net = entries.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(entries).toHaveLength(3);
    expect(net).toBe(400);
  });

  it("a second reversal frees the second posting for a third", async () => {
    await service.post(posting());
    await service.reverse({ tx: mockPrisma, orgId: "org-1", projectId: "p1", sourceType: "timesheet", sourceId: "ts-1" });
    await service.post(posting());
    await service.reverse({ tx: mockPrisma, orgId: "org-1", projectId: "p1", sourceType: "timesheet", sourceId: "ts-1" });
    const third = await service.post(posting());
    expect(third.posted).toBe(true);
    expect(third.entry.sourceKey).toBe("timesheet:ts-1:entry-1:r3");
    const entries = await mockPrisma.costLedgerEntry.findMany({ where: { orgId: "org-1" } });
    expect(entries.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(400);
  });
});

describe("cost ledger — the project must be the organisation's", () => {
  beforeEach(() => ledger.reset());

  it("CX21-420: refuses to post onto a project that is not the caller's organisation's, whatever it was handed", async () => {
    await expect(service.post(posting({ projectId: "p-of-another-tenant" }))).rejects.toMatchObject({ code: "COST_LEDGER_PROJECT_FOREIGN", status: 403 });
    expect(await mockPrisma.costLedgerEntry.findMany({ where: {} })).toHaveLength(0);
    const own = await service.post(posting());
    expect(own.posted).toBe(true);
  });
});

describe("cost ledger — the through-date is decided under the lock", () => {
  beforeEach(() => { ledger.reset(); mockPrisma.$queryRaw.mockImplementation(async () => []); });

  it("CX21-445: a posting that read an old date does not drag a later, committed date back", async () => {
    ledger.seedCostRecord({ id: "cr-1", projectId: "p1", activityId: "act-1", actual: 0, actualThroughDate: new Date("2027-01-01T00:00:00.000Z") });
    // Under the lock the row already carries a later date (another posting committed in between).
    mockPrisma.$queryRaw.mockImplementation(async (strings) => (strings.join("?").includes('FROM "CostRecord"') ? [{ actualThroughDate: new Date("2027-03-20T00:00:00.000Z") }] : []));
    await service.post(posting({ activityId: "act-1", incurredOn: "2027-03-10" }));
    const [record] = await mockPrisma.costRecord.findMany({ where: { activityId: "act-1" } });
    expect(new Date(record.actualThroughDate).toISOString()).toBe("2027-01-01T00:00:00.000Z"); // untouched: the held date is later
    expect(record.actual).toBe(400);
    // and when the held date is earlier, the posting advances it
    mockPrisma.$queryRaw.mockImplementation(async (strings) => (strings.join("?").includes('FROM "CostRecord"') ? [{ actualThroughDate: new Date("2027-02-01T00:00:00.000Z") }] : []));
    await service.post(posting({ sourceId: "ts-2", sourceLineId: "entry-2", activityId: "act-1", incurredOn: "2027-03-10" }));
    const [advanced] = await mockPrisma.costRecord.findMany({ where: { activityId: "act-1" } });
    expect(new Date(advanced.actualThroughDate).toISOString()).toBe("2027-03-10T00:00:00.000Z");
  });
});

describe("cost ledger — one projection row per activity", () => {
  beforeEach(() => { ledger.reset(); mockPrisma.$queryRaw.mockClear(); mockPrisma.$executeRaw.mockClear(); mockPrisma.$queryRaw.mockImplementation(async () => []); });

  it("CX21-457: a posting holds the (project, activity) pair before it looks for the record it may have to create", async () => {
    await service.post(posting({ activityId: "act-9", incurredOn: "2027-03-10" }));
    const held = mockPrisma.$executeRaw.mock.calls.find(([strings, ...values]) => Array.isArray(strings) && strings.join("?").includes("pg_advisory_xact_lock") && values.includes("cost-record:p1:act-9"));
    expect(mockPrisma.$queryRaw.mock.calls.some(([strings]) => Array.isArray(strings) && strings.join("?").includes("pg_advisory_xact_lock"))).toBe(false); // never through $queryRaw: void cannot be read back
    expect(held).toBeDefined();
    const records = await mockPrisma.costRecord.findMany({ where: { activityId: "act-9" } });
    expect(records).toHaveLength(1);
  });

  // Owner decision R5-2: the record a first posting creates has no forecast
  // supplied, so it gets the initial default — marked as one — worked from the
  // activity's approved allocation, as the cost API's creator works it. From a
  // budget of 0 it was just the posting's own amount.
  it("R5-2: the record a first posting creates carries the default forecast — the larger of the activity's approved allocation and the posting — marked 'default'", async () => {
    ledger.seedAllocation({ projectId: "p1", activityId: "act-below", amount: 10000 });
    ledger.seedAllocation({ projectId: "p1", activityId: "act-above", amount: 6000 });
    ledger.seedAllocation({ projectId: "p1", activityId: "act-above", amount: 4000 });
    await service.post(posting({ sourceLineId: "below", activityId: "act-below", amount: 500 }));
    await service.post(posting({ sourceLineId: "above", activityId: "act-above", amount: 12000 }));
    await service.post(posting({ sourceLineId: "none", activityId: "act-none", amount: 700 }));
    const stored = async (activityId) => (await mockPrisma.costRecord.findMany({ where: { activityId } })).map((row) => ({ actual: row.actual, forecast: row.forecast, forecastSource: row.forecastSource, budget: row.budget }));
    expect(await stored("act-below")).toEqual([{ actual: 500, forecast: 10000, forecastSource: "default", budget: undefined }]);
    expect(await stored("act-above")).toEqual([{ actual: 12000, forecast: 12000, forecastSource: "default", budget: undefined }]);
    expect(await stored("act-none")).toEqual([{ actual: 700, forecast: 700, forecastSource: "default", budget: undefined }]);
    // A later posting finds the record: it moves actual only.
    await service.post(posting({ sourceLineId: "below-2", activityId: "act-below", amount: 300 }));
    expect(await stored("act-below")).toEqual([{ actual: 800, forecast: 10000, forecastSource: "default", budget: undefined }]);
  });
});

/**
 * CERT-2 (alerts-money-5): what a posting leaves on the projections fits them.
 * The activity's actual and the budget line's actual are Decimal(18,2):
 * postings that each fit could together pass 10^16, and the increment failed
 * at the write with a 500 — two workers at the highest rate on one day, a
 * second issue of costly stock to the same activity. Refused with a 400
 * before the entry is written.
 */
describe("cost ledger — the projections hold what is posted (CERT-2)", () => {
  beforeEach(() => { ledger.reset(); mockPrisma.$queryRaw.mockImplementation(async () => []); mockPrisma.$executeRaw.mockClear(); });
  const entries = () => mockPrisma.costLedgerEntry.findMany({ where: {} });

  it("a posting that would take the activity's actual past 10^16 is a 400 COST_LEDGER_TOTAL_TOO_LARGE, and nothing is written", async () => {
    ledger.seedCostRecord({ id: "cr-1", projectId: "p1", activityId: "act-1", actual: 6e15 });
    await expect(service.post(posting({ activityId: "act-1", amount: 5e15 }))).rejects.toMatchObject({ status: 400, code: "COST_LEDGER_TOTAL_TOO_LARGE" });
    expect(await entries()).toHaveLength(0);
    expect(ledger.store.costRecords[0].actual).toBe(6e15);
    // Checked under the pair's advisory lock, before the record is read.
    const lock = mockPrisma.$executeRaw.mock.calls.findIndex(([strings, ...values]) => strings.join("?").includes("pg_advisory_xact_lock") && values.includes("cost-record:p1:act-1"));
    expect(lock).toBeGreaterThanOrEqual(0);
    // What fits is posted; a return that brings it down is too.
    await expect(service.post(posting({ activityId: "act-1", amount: 3e15 }))).resolves.toMatchObject({ posted: true });
    await expect(service.post(posting({ sourceLineId: "back", activityId: "act-1", amount: -4e15 }))).resolves.toMatchObject({ posted: true });
    expect(ledger.store.costRecords[0].actual).toBe(5e15);
  });

  it("the budget line's actual likewise", async () => {
    ledger.seedBudgetLine({ id: "bl-1", projectId: "p1", costCodeId: "cc-1", costType: "labour", actual: 9e15 });
    await expect(service.post(posting({ budgetLineId: "bl-1", amount: 2e15 }))).rejects.toMatchObject({ status: 400, code: "COST_LEDGER_TOTAL_TOO_LARGE" });
    expect(await entries()).toHaveLength(0);
    expect(ledger.store.budgetLines[0].actual).toBe(9e15);
  });

  it("a single amount the ledger cannot hold is a 400 COST_LEDGER_AMOUNT_TOO_LARGE", async () => {
    await expect(service.post(posting({ amount: 2e16 }))).rejects.toMatchObject({ status: 400, code: "COST_LEDGER_AMOUNT_TOO_LARGE" });
    expect(await entries()).toHaveLength(0);
  });

  it("a reversal is held to the same bound: one that would take the actual past -10^16 is refused, and no mirror is written", async () => {
    ledger.seedCostRecord({ id: "cr-1", projectId: "p1", activityId: "act-1", actual: 0 });
    await service.post(posting({ activityId: "act-1", amount: 2e15 }));
    // Since moved by something else to near the floor of the column.
    ledger.store.costRecords[0].actual = -9e15;
    await expect(service.reverse({ tx: mockPrisma, orgId: "org-1", projectId: "p1", sourceType: "timesheet", sourceId: "ts-1" })).rejects.toMatchObject({ status: 400, code: "COST_LEDGER_TOTAL_TOO_LARGE" });
    expect(await entries()).toHaveLength(1);
    expect(ledger.store.costRecords[0].actual).toBe(-9e15);
  });

  it("a posting already on the ledger is not refused for the sum it is already part of", async () => {
    ledger.seedCostRecord({ id: "cr-1", projectId: "p1", activityId: "act-1", actual: 0 });
    await service.post(posting({ activityId: "act-1", amount: 9e15 }));
    await expect(service.post(posting({ activityId: "act-1", amount: 9e15 }))).resolves.toMatchObject({ posted: false, reason: "already_posted" });
  });
});
