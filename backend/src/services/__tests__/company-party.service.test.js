jest.mock("../../config/db", () => ({ prisma: {} }));

const {
  applyPartyWorkflowVisibility,
  assertPartyWorkflowAccess,
  withDefaultOwnerParty,
} = require("../company-party.service");

const partyAccess = {
  scope: "party",
  assignmentRole: null,
  partyAccess: [
    {
      projectPartyId: "party-1",
      role: "consultant",
      companyId: "company-1",
    },
  ],
};

describe("company party workflow access", () => {
  it("limits party-scoped workflow lists to routed party ids", () => {
    const where = {
      projectId: "project-1",
      OR: [{ subject: { contains: "slab", mode: "insensitive" } }],
    };

    expect(applyPartyWorkflowVisibility(where, partyAccess)).toEqual({
      projectId: "project-1",
      AND: [
        { OR: [{ subject: { contains: "slab", mode: "insensitive" } }] },
        {
          OR: [
            { ownerPartyId: { in: ["party-1"] } },
            { reviewerPartyId: { in: ["party-1"] } },
            { approverPartyId: { in: ["party-1"] } },
          ],
        },
      ],
    });
  });

  it("treats null project access as non-party-scoped instead of throwing", () => {
    const where = { projectId: "project-1" };

    expect(applyPartyWorkflowVisibility(where, null)).toEqual(where);
    expect(withDefaultOwnerParty({ subject: "RFI" }, null)).toEqual({
      subject: "RFI",
    });
    expect(() =>
      assertPartyWorkflowAccess({
        projectAccess: null,
        record: { ownerPartyId: "party-1" },
      }),
    ).not.toThrow();
  });

  it("allows routed records and denies cross-party workflow records", () => {
    expect(() =>
      assertPartyWorkflowAccess({
        projectAccess: partyAccess,
        record: { ownerPartyId: "party-1" },
      }),
    ).not.toThrow();

    try {
      assertPartyWorkflowAccess({
        projectAccess: partyAccess,
        record: { ownerPartyId: "party-2" },
      });
      throw new Error("Expected cross-party access denial");
    } catch (error) {
      expect(error).toMatchObject({
        status: 403,
        code: "PROJECT_PARTY_RECORD_ACCESS_DENIED",
      });
    }
  });

  it("defaults new party-scoped workflow records to the caller party", () => {
    expect(withDefaultOwnerParty({ subject: "RFI" }, partyAccess)).toMatchObject({
      subject: "RFI",
      ownerPartyId: "party-1",
    });

    expect(
      withDefaultOwnerParty(
        { subject: "RFI", reviewerPartyId: "party-reviewer" },
        partyAccess,
      ),
    ).toEqual({ subject: "RFI", reviewerPartyId: "party-reviewer" });
  });
});
