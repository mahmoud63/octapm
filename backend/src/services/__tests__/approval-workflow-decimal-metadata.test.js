const { Prisma } = require("@prisma/client");

// Regression for a defect that only appeared against a real database: callers
// pass raw Prisma rows as workflow-event metadata, so money arrives as a
// Decimal. compactJson walked it like a plain object and stored its internals,
// and Prisma then refused to write the Json column — taking the surrounding
// transaction with it, so creating a change order failed outright.
describe("approval workflow event metadata", () => {
  const load = () => {
    jest.resetModules();
    jest.doMock("../../config/db", () => ({ prisma: {} }));
    jest.doMock("../notification.service", () => ({}));
    jest.doMock("../../events/bus", () => ({
      publish: jest.fn(),
      EVENT_TYPES: { APPROVAL_DECIDED: "approval.decided" },
    }));
    return require("../approval-workflow.service");
  };

  it("stores a Decimal amount as a number, not as its internal representation", async () => {
    const service = load();
    let written = null;
    const tx = {
      approvalWorkflowEvent: {
        create: async ({ data }) => {
          written = data;
          return { id: "evt-1", ...data };
        },
      },
    };

    await service.recordTransition({
      tx,
      orgId: "org-1",
      projectId: "project-1",
      recordType: service.RECORD_TYPES.CHANGE_ORDER,
      recordId: "co-1",
      fromStatus: null,
      toStatus: "draft",
      actorId: "user-1",
      actorRole: "pm",
      metadata: {
        ref: "VO-01",
        value: new Prisma.Decimal("48500.00"),
        nested: { approved: new Prisma.Decimal("1234.56") },
        amounts: [new Prisma.Decimal("10.5")],
      },
    });

    expect(written).not.toBeNull();
    expect(written.metadataJson.value).toBe(48500);
    expect(written.metadataJson.nested.approved).toBe(1234.56);
    expect(written.metadataJson.amounts).toEqual([10.5]);

    // The whole payload must survive a JSON round trip, which is what the
    // Json column ultimately requires.
    expect(() => JSON.parse(JSON.stringify(written.metadataJson))).not.toThrow();
    expect(JSON.stringify(written.metadataJson)).not.toContain("constructor");
  });
});
