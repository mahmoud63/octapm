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
  beforeEach(() => { ledger.reset(); mockPrisma.$queryRaw.mockClear(); mockPrisma.$queryRaw.mockImplementation(async () => []); });

  it("CX21-457: a posting holds the (project, activity) pair before it looks for the record it may have to create", async () => {
    await service.post(posting({ activityId: "act-9", incurredOn: "2027-03-10" }));
    const held = mockPrisma.$queryRaw.mock.calls.find(([strings, ...values]) => Array.isArray(strings) && strings.join("?").includes("pg_advisory_xact_lock") && values.includes("cost-record:p1:act-9"));
    expect(held).toBeDefined();
    const records = await mockPrisma.costRecord.findMany({ where: { activityId: "act-9" } });
    expect(records).toHaveLength(1);
  });
});
