const progressService = require("../progress.service");
const { prisma } = require("../../config/db");

jest.mock("../../config/db", () => ({
  prisma: {
    project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", orgId: "o1" }) },
    progressSubmission: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

/**
 * A daily report asks what was recorded on one day, and the register had no way
 * to answer that: every consumer pulled the whole project and bucketed dates on
 * the client, so a back-dated report quietly landed on the wrong day.
 *
 * These hold the contract of the filter rather than its plumbing: that asking
 * for a day narrows the query to that day, that a submission never sent is
 * dated by when it was made, and — most importantly — that a caller who asks
 * for nothing still gets everything, because every existing consumer does.
 */
describe("listing progress submissions by date", () => {
  beforeEach(() => {
    prisma.progressSubmission.findMany.mockClear();
  });

  const whereOf = () => prisma.progressSubmission.findMany.mock.calls[0][0].where;

  it("asks for the whole project when no dates are given, as every existing caller does", async () => {
    await progressService.listProgressSubmissions({ orgId: "o1", projectId: "p1" });
    expect(whereOf()).toEqual({ projectId: "p1" });
  });

  it("narrows to one day, and dates an unsent submission by when it was made", async () => {
    await progressService.listProgressSubmissions({ orgId: "o1", projectId: "p1", from: "2026-09-20", to: "2026-09-20" });
    const where = whereOf();
    expect(where.projectId).toBe("p1");
    expect(where.OR).toHaveLength(2);
    const [sent, unsent] = where.OR;
    expect(sent.submittedAt.gte.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(sent.submittedAt.lte.toISOString()).toBe("2026-09-20T23:59:59.999Z");
    expect(unsent.submittedAt).toBeNull();
    expect(unsent.createdAt.gte.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("takes the caller's own instants, so a day on site is that day and not UTC's", async () => {
    // Eight in the evening in Baton Rouge is already tomorrow in UTC. A caller
    // that knows its offset asks for its own day and must get exactly that.
    await progressService.listProgressSubmissions({ orgId: "o1", projectId: "p1", from: "2026-09-20T05:00:00.000Z", to: "2026-09-21T04:59:59.999Z" });
    const where = whereOf();
    expect(where.OR[0].submittedAt.gte.toISOString()).toBe("2026-09-20T05:00:00.000Z");
    expect(where.OR[0].submittedAt.lte.toISOString()).toBe("2026-09-21T04:59:59.999Z");
  });

  it("takes an open range at either end", async () => {
    await progressService.listProgressSubmissions({ orgId: "o1", projectId: "p1", from: "2026-09-01" });
    expect(whereOf().OR[0].submittedAt.lte).toBeUndefined();
    prisma.progressSubmission.findMany.mockClear();
    await progressService.listProgressSubmissions({ orgId: "o1", projectId: "p1", to: "2026-09-30" });
    expect(prisma.progressSubmission.findMany.mock.calls[0][0].where.OR[0].submittedAt.gte).toBeUndefined();
  });

  it("still narrows by activity and status alongside the dates", async () => {
    await progressService.listProgressSubmissions({ orgId: "o1", projectId: "p1", activityId: "a1", status: "approved", from: "2026-09-20" });
    const where = whereOf();
    expect(where.activityId).toBe("a1");
    expect(where.status).toBe("approved");
    expect(where.OR).toHaveLength(2);
  });
});
