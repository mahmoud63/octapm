const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  rfi: {
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  submittal: {
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  workflowStatusHistory: {
    create: jest.fn(),
  },
  approvalWorkflowEvent: {
    create: jest.fn(),
  },
};

const mockAuditService = {
  ENTITY_TYPES: {
    RFI: "rfi",
    SUBMITTAL: "submittal",
  },
  ACTIONS: {
    ARCHIVED: "archived",
  },
  recordEvent: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAuditService);

const rfiService = require("../rfi.service");
const submittalService = require("../submittal.service");

const rfi = {
  id: "rfi-1",
  projectId: "project-1",
  activityId: null,
  ref: "RFI-001",
  subject: "Confirm footing detail",
  question: "Which detail applies?",
  response: null,
  discipline: "civil",
  priority: "normal",
  status: "open",
  scheduleImpact: 0,
  owner: null,
  reviewer: null,
  approver: null,
  raisedBy: "Site",
  answeredBy: null,
  raisedDate: new Date("2026-06-01T00:00:00.000Z"),
  dueDate: new Date("2026-06-08T00:00:00.000Z"),
  responseRequiredBy: null,
  answeredDate: null,
  archivedAt: null,
  archivedBy: null,
};

const submittal = {
  id: "sub-1",
  projectId: "project-1",
  activityId: null,
  ref: "SUB-001",
  title: "Concrete mix design",
  discipline: "civil",
  revision: "A",
  specRef: "033000",
  status: "under_review",
  owner: null,
  reviewer: null,
  approver: null,
  submittedOn: new Date("2026-06-02T00:00:00.000Z"),
  dueDate: new Date("2026-06-09T00:00:00.000Z"),
  reviewedOn: null,
  remarks: null,
  archivedAt: null,
  archivedBy: null,
};

describe("document-control archive behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.workflowStatusHistory.create.mockImplementation(({ data }) => ({
      id: "history-1",
      ...data,
    }));
    mockPrisma.approvalWorkflowEvent.create.mockImplementation(({ data }) => ({
      id: "event-1",
      ...data,
      createdAt: data.createdAt || new Date("2026-06-12T00:00:00.000Z"),
    }));
    mockAuditService.recordEvent.mockResolvedValue({ id: "audit-1" });
  });

  it("archives RFIs instead of hard deleting them", async () => {
    const archived = {
      ...rfi,
      status: "archived",
      archivedAt: new Date("2026-06-12T00:00:00.000Z"),
      archivedBy: "pm-1",
    };
    mockPrisma.rfi.findFirst.mockResolvedValue(rfi);
    mockPrisma.rfi.update.mockResolvedValue(archived);

    const result = await rfiService.deleteRfi({
      orgId: "org-1",
      projectId: "project-1",
      rfiId: rfi.id,
      userId: "pm-1",
      userRole: "pm",
    });

    expect(mockPrisma.rfi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: rfi.id },
        data: expect.objectContaining({
          status: "archived",
          archivedAt: expect.any(Date),
          archivedBy: "pm-1",
        }),
      }),
    );
    expect(mockPrisma.rfi.delete).not.toHaveBeenCalled();
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "rfi",
          oldStatus: "open",
          newStatus: "archived",
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "rfi",
        entityId: rfi.id,
        action: "archived",
        oldStatus: "open",
        newStatus: "archived",
      }),
    );
    expect(result).toMatchObject({
      id: rfi.id,
      archived: true,
      deleted: false,
      status: "archived",
    });
  });

  it("archives submittals instead of hard deleting them", async () => {
    const archived = {
      ...submittal,
      status: "archived",
      archivedAt: new Date("2026-06-12T00:00:00.000Z"),
      archivedBy: "pm-1",
    };
    mockPrisma.submittal.findFirst.mockResolvedValue(submittal);
    mockPrisma.submittal.update.mockResolvedValue(archived);

    const result = await submittalService.deleteSubmittal({
      orgId: "org-1",
      projectId: "project-1",
      submittalId: submittal.id,
      userId: "pm-1",
      userRole: "pm",
    });

    expect(mockPrisma.submittal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: submittal.id },
        data: expect.objectContaining({
          status: "archived",
          archivedAt: expect.any(Date),
          archivedBy: "pm-1",
        }),
      }),
    );
    expect(mockPrisma.submittal.delete).not.toHaveBeenCalled();
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "submittal",
          oldStatus: "under_review",
          newStatus: "archived",
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "submittal",
        entityId: submittal.id,
        action: "archived",
        oldStatus: "under_review",
        newStatus: "archived",
      }),
    );
    expect(result).toMatchObject({
      id: submittal.id,
      archived: true,
      deleted: false,
      status: "archived",
    });
  });
});
