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
const mockPrisma = { ...ledger.tables };
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
