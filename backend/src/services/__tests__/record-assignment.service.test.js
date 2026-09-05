const mockModel = () => ({ findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() });

const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  company: { findMany: jest.fn() },
  authAuditEvent: { create: jest.fn() },
  risk: mockModel(),
  ncrRecord: mockModel(),
  itpRecord: mockModel(),
  defectRecord: mockModel(),
  safetyIncident: mockModel(),
  materialTest: mockModel(),
  rfi: mockModel(),
  submittal: mockModel(),
  drawingRecord: mockModel(),
  transmittal: mockModel(),
  correspondence: mockModel(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../approval-workflow.service", () => ({
  listEventsForRecords: jest.fn(async () => new Map()),
}));

const service = require("../record-assignment.service");

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const RECORD = "33333333-3333-4333-8333-333333333333";

const allModels = () =>
  Object.values(service.RECORD_MODELS).map((config) => mockPrisma[config.model]);

describe("unresolved assignment report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", name: "Tower A" });
    for (const model of allModels()) model.findMany.mockResolvedValue([]);
  });

  it("lists every record field whose text has no matching user", async () => {
    mockPrisma.ncrRecord.findMany.mockResolvedValue([
      {
        id: RECORD,
        ref: "NCR-001",
        description: "Honeycombing",
        status: "open",
        owner: "Unknown Person",
        ownerUserId: null,
        reviewer: "Bilal",
        reviewerUserId: OTHER,
        approver: null,
        approverUserId: null,
        responsible: "  ",
        assigneeUserId: null,
      },
    ]);
    mockPrisma.rfi.findMany.mockResolvedValue([
      {
        id: "r-2",
        ref: "RFI-002",
        subject: "Beam depth",
        status: "open",
        owner: "Consult Co",
        ownerUserId: null,
        reviewer: null,
        reviewerUserId: null,
        approver: null,
        approverUserId: null,
      },
    ]);

    const report = await service.listUnresolvedAssignments({
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(report.projectName).toBe("Tower A");
    expect(report.total).toBe(2);
    expect(report.byType).toEqual({ ncr: 1, rfi: 1 });
    expect(report.items[0]).toMatchObject({
      recordType: "ncr",
      recordId: RECORD,
      field: "ownerUserId",
      textField: "owner",
      value: "Unknown Person",
      title: "Honeycombing",
    });
    expect(report.items[1]).toMatchObject({ recordType: "rfi", value: "Consult Co" });
    // Query asks for rows with text present and the reference still null.
    expect(mockPrisma.ncrRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          OR: expect.arrayContaining([{ owner: { not: null }, ownerUserId: null }]),
        }),
      }),
    );
  });
});

describe("manual mapping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", name: "Tower A" });
    mockPrisma.user.findMany.mockResolvedValue([{ id: ME, name: "Me", email: "me@x" }]);
  });

  it("sets the reference, mirrors the name and recomputes ball in court", async () => {
    mockPrisma.defectRecord.findFirst.mockResolvedValue({
      id: RECORD,
      status: "open",
      assignee: "Someone",
      assigneeUserId: null,
    });
    mockPrisma.defectRecord.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: RECORD, ...data }),
    );

    const result = await service.resolveAssignment({
      orgId: "org-1",
      projectId: "project-1",
      actorId: OTHER,
      actorRole: "pm",
      payload: { recordType: "defect", recordId: RECORD, field: "assigneeUserId", userId: ME },
    });

    expect(mockPrisma.defectRecord.update).toHaveBeenCalledWith({
      where: { id: RECORD },
      data: expect.objectContaining({
        assigneeUserId: ME,
        assignee: "Me",
        ballInCourtUserId: ME,
      }),
    });
    expect(result).toMatchObject({ field: "assigneeUserId", value: ME, ballInCourtUserId: ME });
    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entityType: "record_assignment", action: "resolved" }),
      }),
    );
  });

  it("rejects unknown record types and fields", async () => {
    await expect(
      service.resolveAssignment({
        orgId: "org-1",
        projectId: "project-1",
        payload: { recordType: "invoice", recordId: RECORD, field: "ownerUserId", userId: ME },
      }),
    ).rejects.toMatchObject({ code: "RECORD_TYPE_INVALID" });
    await expect(
      service.resolveAssignment({
        orgId: "org-1",
        projectId: "project-1",
        payload: { recordType: "rfi", recordId: RECORD, field: "owner", userId: ME },
      }),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_FIELD_INVALID" });
  });
});

describe("my open items", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of allModels()) model.findMany.mockResolvedValue([]);
  });

  it("returns nothing without projects", async () => {
    const result = await service.listMyOpenItems({ orgId: "org-1", userId: ME, projectIds: [] });
    expect(result.items).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it("collects records across types, flags ball in court and overdue, and sorts them first", async () => {
    const past = new Date(Date.now() - 3 * 86400000);
    const future = new Date(Date.now() + 5 * 86400000);
    mockPrisma.rfi.findMany.mockResolvedValue([
      {
        id: "rfi-1",
        projectId: "project-1",
        ref: "RFI-001",
        subject: "Slab thickness",
        status: "open",
        dueDate: future,
        updatedAt: new Date(),
        ownerUserId: ME,
        reviewerUserId: OTHER,
        approverUserId: null,
        assigneeUserId: null,
        ballInCourtUserId: OTHER,
        project: { id: "project-1", name: "Tower A" },
      },
    ]);
    mockPrisma.ncrRecord.findMany.mockResolvedValue([
      {
        id: "ncr-1",
        projectId: "project-1",
        ref: "NCR-004",
        description: "Cover",
        status: "open",
        dueDate: past,
        updatedAt: new Date(),
        ownerUserId: null,
        reviewerUserId: null,
        approverUserId: null,
        assigneeUserId: ME,
        ballInCourtUserId: ME,
        project: { id: "project-1", name: "Tower A" },
      },
      {
        id: "ncr-closed",
        projectId: "project-1",
        ref: "NCR-001",
        description: "Old",
        status: "closed",
        dueDate: null,
        updatedAt: new Date(),
        assigneeUserId: ME,
        ballInCourtUserId: null,
        project: { id: "project-1", name: "Tower A" },
      },
    ]);

    const result = await service.listMyOpenItems({
      orgId: "org-1",
      userId: ME,
      projectIds: ["project-1"],
    });

    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: { in: ["project-1"] },
          status: { notIn: ["closed", "archived"] },
          OR: expect.arrayContaining([{ ownerUserId: ME }, { ballInCourtUserId: ME }]),
        }),
      }),
    );
    expect(result.summary).toMatchObject({ total: 2, overdue: 1, ballInCourt: 1 });
    expect(result.items[0]).toMatchObject({
      recordType: "ncr",
      ref: "NCR-004",
      ballInCourt: true,
      overdue: true,
      roles: ["assignee", "ballInCourt"],
      target: { projectId: "project-1", module: "quality", child: "ncr" },
    });
    expect(result.items[1]).toMatchObject({
      recordType: "rfi",
      ballInCourt: false,
      roles: ["owner"],
    });
  });
});
