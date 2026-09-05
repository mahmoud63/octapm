const mockPrisma = {
  project: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  company: { findMany: jest.fn() },
  projectParty: { findMany: jest.fn() },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../approval-workflow.service", () => ({
  listEventsForRecords: jest.fn(async () => new Map()),
}));

const service = require("../workflow-support.service");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const COMPANY = "33333333-3333-4333-8333-333333333333";

describe("ball in court", () => {
  it("routes to the reviewer while open and back to the originator after a decision", () => {
    const refs = { ownerUserId: USER_A, reviewerUserId: USER_B };
    expect(service.deriveBallInCourt({ status: "open", refs })).toBe(USER_B);
    expect(service.deriveBallInCourt({ status: "under_review", refs })).toBe(USER_B);
    expect(service.deriveBallInCourt({ status: "answered", refs })).toBe(USER_A);
    expect(service.deriveBallInCourt({ status: "resubmit", refs })).toBe(USER_A);
    expect(service.deriveBallInCourt({ status: "closed", refs })).toBeNull();
    expect(service.deriveBallInCourt({ status: "approved", refs })).toBeNull();
  });

  it("falls back through approver, assignee and owner", () => {
    expect(
      service.deriveBallInCourt({ status: "open", refs: { approverUserId: USER_B } }),
    ).toBe(USER_B);
    expect(
      service.deriveBallInCourt({ status: "pending", refs: { assigneeUserId: USER_A } }),
    ).toBe(USER_A);
    expect(service.deriveBallInCourt({ status: "open", refs: {} })).toBeNull();
  });
});

describe("workflowAssignmentData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findMany.mockResolvedValue([
      { id: USER_A, name: "Amira Owner", email: "amira@example.com" },
      { id: USER_B, name: "Bilal Reviewer", email: "bilal@example.com" },
    ]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: COMPANY }]);
  });

  it("keeps the legacy text fields when only text is provided", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { owner: "Someone", reviewer: " R ", approver: null },
      status: "open",
    });
    expect(data).toMatchObject({ owner: "Someone", reviewer: "R", approver: null });
    expect(data.ballInCourtUserId).toBeNull();
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("validates ids against the organisation and mirrors names into text columns", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: {
        ownerUserId: USER_A,
        reviewerUserId: USER_B,
        assigneeUserId: USER_A,
        assigneeCompanyId: COMPANY,
      },
      status: "open",
      assigneeTextField: "responsible",
    });

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1", id: { in: [USER_A, USER_B] } }),
      }),
    );
    expect(data).toMatchObject({
      ownerUserId: USER_A,
      reviewerUserId: USER_B,
      assigneeUserId: USER_A,
      assigneeCompanyId: COMPANY,
      owner: "Amira Owner",
      reviewer: "Bilal Reviewer",
      responsible: "Amira Owner",
      ballInCourtUserId: USER_B,
    });
  });

  it("does not overwrite explicit text with the mirrored name", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { ownerUserId: USER_A, owner: "Custom label" },
      status: "open",
    });
    expect(data.owner).toBe("Custom label");
    expect(data.ownerUserId).toBe(USER_A);
  });

  it("rejects users and companies outside the organisation", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await expect(
      service.workflowAssignmentData({
        orgId: "org-1",
        projectId: "project-1",
        payload: { ownerUserId: USER_A },
        status: "open",
      }),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_USER_NOT_FOUND" });

    mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A, name: "A" }]);
    mockPrisma.company.findMany.mockResolvedValue([]);
    await expect(
      service.workflowAssignmentData({
        orgId: "org-1",
        projectId: "project-1",
        payload: { assigneeCompanyId: COMPANY },
        status: "open",
      }),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_COMPANY_NOT_FOUND" });
  });

  it("recomputes ball in court from existing references on a status change", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { status: "answered" },
      existing: { ownerUserId: USER_A, reviewerUserId: USER_B, owner: "Amira Owner" },
      status: "answered",
    });
    expect(data.ballInCourtUserId).toBe(USER_A);
    expect(data.owner).toBe("Amira Owner");
    expect(data.ownerUserId).toBeUndefined();
  });

  it("honours an explicit ball-in-court override", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { ballInCourtUserId: USER_B },
      existing: { ownerUserId: USER_A },
      status: "closed",
    });
    expect(data.ballInCourtUserId).toBe(USER_B);
  });

  it("resolves the org from the project when the caller omits it", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ orgId: "org-9" });
    await service.workflowAssignmentData({
      projectId: "project-1",
      payload: { ownerUserId: USER_A },
      status: "open",
    });
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "org-9" }) }),
    );
  });
});

describe("workflowPartyAssignmentData", () => {
  it("copies the routed party's company into assigneeCompanyId", async () => {
    mockPrisma.projectParty.findMany.mockResolvedValue([
      { id: "party-1", companyId: COMPANY, company: { id: COMPANY, name: "Consult Co" } },
    ]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: COMPANY }]);
    const data = await service.workflowPartyAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { reviewerPartyId: "party-1" },
      status: "open",
    });
    expect(data.reviewerPartyId).toBe("party-1");
    expect(data.reviewer).toBe("Consult Co");
    expect(data.assigneeCompanyId).toBe(COMPANY);
  });
});

describe("assignmentUserIds and reference serialization", () => {
  it("collects unique user ids from the reference columns only", () => {
    expect(
      service.assignmentUserIds({
        ownerUserId: USER_A,
        reviewerUserId: USER_A,
        approverUserId: "not-a-uuid",
        assigneeUserId: USER_B,
        owner: "Free text",
      }),
    ).toEqual([USER_A, USER_B]);
  });

  it("attaches user and company objects to rows", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A, name: "Amira", email: "a@x" }]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: COMPANY, name: "Consult Co" }]);
    const [row] = await service.attachAssignmentReferences({
      rows: [{ id: "r1", ownerUserId: USER_A, assigneeCompanyId: COMPANY, ballInCourtUserId: USER_B }],
    });
    expect(row.ownerUser).toEqual({ id: USER_A, name: "Amira", email: "a@x" });
    expect(row.assigneeCompany).toEqual({ id: COMPANY, name: "Consult Co" });
    expect(row.ballInCourtUser).toEqual({ id: USER_B, name: null, email: null });
    expect(row.reviewerUser).toBeNull();
  });
});
