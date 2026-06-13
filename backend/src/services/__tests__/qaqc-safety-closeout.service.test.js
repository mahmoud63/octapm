const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  ncrRecord: {
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  safetyIncident: {
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  workflowAttachment: {
    count: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  workflowStatusHistory: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  workflowActivityLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  documentRevision: {
    findMany: jest.fn(),
  },
  approvalWorkflowEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  auditEvent: {
    create: jest.fn(),
  },
  recordHistorySnapshot: {
    create: jest.fn(),
  },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const ncrService = require("../ncr.service");
const safetyService = require("../safety.service");

const ncr = {
  id: "ncr-1",
  projectId: "project-1",
  activityId: null,
  ref: "NCR-001",
  severity: "major",
  status: "open",
  owner: "QA Engineer",
  responsible: null,
  dueDate: null,
};

const safetyIncident = {
  id: "safe-1",
  projectId: "project-1",
  activityId: null,
  ref: "SAF-001",
  title: "Near miss at crane swing radius",
  incidentType: "near_miss",
  severity: "medium",
  status: "investigating",
  owner: "Safety Officer",
  responsible: null,
  dueDate: null,
};

describe("QA/QC and safety closeout workflows", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.workflowAttachment.count.mockResolvedValue(0);
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValue([]);
    mockPrisma.workflowActivityLink.findMany.mockResolvedValue([]);
    mockPrisma.documentRevision.findMany.mockResolvedValue([]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValue([]);
    mockPrisma.approvalWorkflowEvent.create.mockImplementation(({ data }) => ({
      id: "event-1",
      ...data,
    }));
    mockPrisma.auditEvent.create.mockImplementation(({ data }) => ({
      id: "audit-1",
      ...data,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      occurredAt: data.occurredAt || new Date("2026-06-12T00:00:00.000Z"),
    }));
    mockPrisma.recordHistorySnapshot.create.mockResolvedValue({
      id: "snapshot-1",
    });
    mockPrisma.workflowStatusHistory.create.mockImplementation(({ data }) => ({
      id: "history-1",
      ...data,
    }));
  });

  it("requires evidence before an NCR closeout can be submitted", async () => {
    mockPrisma.ncrRecord.findFirst.mockResolvedValue(ncr);

    await expect(
      ncrService.submitNcrCloseout({
        orgId: "org-1",
        projectId: "project-1",
        ncrId: ncr.id,
        payload: {
          responsible: "QA Lead",
          dueDate: "2026-06-20",
          closureComment: "Corrective action complete",
        },
        userId: "site-1",
        userRole: "site_engineer",
      }),
    ).rejects.toMatchObject({
      code: "NCR_CLOSEOUT_EVIDENCE_REQUIRED",
    });

    expect(mockPrisma.ncrRecord.update).not.toHaveBeenCalled();
  });

  it("submits NCR closeout with required party, due date, evidence, and history", async () => {
    mockPrisma.ncrRecord.findFirst.mockResolvedValue(ncr);
    mockPrisma.ncrRecord.update.mockImplementation(({ data }) => ({
      ...ncr,
      ...data,
    }));

    const result = await ncrService.submitNcrCloseout({
      orgId: "org-1",
      projectId: "project-1",
      ncrId: ncr.id,
      payload: {
        responsible: "QA Lead",
        dueDate: "2026-06-20",
        closureComment: "Corrective action complete",
        attachmentRefs: [
          { fileName: "photo.jpg", fileUrl: "/evidence/photo.jpg" },
        ],
      },
      userId: "site-1",
      userRole: "site_engineer",
    });

    expect(result.status).toBe("submitted");
    expect(mockPrisma.ncrRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ncr.id },
        data: expect.objectContaining({
          status: "submitted",
          responsible: "QA Lead",
          closureComment: "Corrective action complete",
          closureSubmittedBy: "site-1",
        }),
      }),
    );
    expect(mockPrisma.workflowAttachment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ fileName: "photo.jpg" }),
        ]),
      }),
    );
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          oldStatus: "open",
          newStatus: "submitted",
          comment: "Corrective action complete",
        }),
      }),
    );
    expect(mockPrisma.approvalWorkflowEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "ncr",
          action: "submitted",
          decision: "submitted",
        }),
      }),
    );
  });

  it("allows PM approval only after NCR closeout submission", async () => {
    mockPrisma.ncrRecord.findFirst.mockResolvedValue(ncr);

    await expect(
      ncrService.approveNcr({
        orgId: "org-1",
        projectId: "project-1",
        ncrId: ncr.id,
        userId: "pm-1",
        userRole: "pm",
      }),
    ).rejects.toMatchObject({
      code: "NCR_NOT_READY_FOR_APPROVAL",
    });

    const submitted = { ...ncr, status: "submitted" };
    mockPrisma.ncrRecord.findFirst.mockResolvedValue(submitted);
    mockPrisma.ncrRecord.update.mockImplementation(({ data }) => ({
      ...submitted,
      ...data,
    }));

    const result = await ncrService.approveNcr({
      orgId: "org-1",
      projectId: "project-1",
      ncrId: ncr.id,
      comment: "Accepted",
      userId: "pm-1",
      userRole: "pm",
    });

    expect(result.status).toBe("closed");
    expect(mockPrisma.approvalWorkflowEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: "submitted",
          toStatus: "closed",
          action: "approved",
        }),
      }),
    );
  });

  it("returns rejected safety closeouts to investigation with workflow history", async () => {
    const submitted = { ...safetyIncident, status: "submitted" };
    mockPrisma.safetyIncident.findFirst.mockResolvedValue(submitted);
    mockPrisma.safetyIncident.update.mockImplementation(({ data }) => ({
      ...submitted,
      ...data,
    }));

    const result = await safetyService.rejectSafetyIncident({
      orgId: "org-1",
      projectId: "project-1",
      incidentId: safetyIncident.id,
      reason: "Evidence incomplete",
      userId: "pm-1",
      userRole: "pm",
    });

    expect(result.status).toBe("investigating");
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          oldStatus: "submitted",
          newStatus: "investigating",
          comment: "Evidence incomplete",
        }),
      }),
    );
    expect(mockPrisma.approvalWorkflowEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "safety_incident",
          action: "rejected",
          reason: "Evidence incomplete",
        }),
      }),
    );
  });

  it("archives safety incidents with audit and workflow history", async () => {
    const archived = {
      ...safetyIncident,
      status: "archived",
      archivedAt: new Date("2026-06-12T00:00:00.000Z"),
      archivedBy: "pm-1",
    };
    mockPrisma.safetyIncident.findFirst.mockResolvedValue(safetyIncident);
    mockPrisma.safetyIncident.update.mockResolvedValue(archived);

    const result = await safetyService.deleteSafetyIncident({
      orgId: "org-1",
      projectId: "project-1",
      incidentId: safetyIncident.id,
      userId: "pm-1",
      userRole: "pm",
    });

    expect(mockPrisma.safetyIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: safetyIncident.id },
        data: expect.objectContaining({
          status: "archived",
          archivedAt: expect.any(Date),
          archivedBy: "pm-1",
        }),
      }),
    );
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "safety_incident",
          oldStatus: "investigating",
          newStatus: "archived",
        }),
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "safety_incident",
          action: "archived",
          oldStatus: "investigating",
          newStatus: "archived",
        }),
      }),
    );
    expect(result).toMatchObject({
      id: safetyIncident.id,
      archived: true,
      deleted: false,
      status: "archived",
    });
  });
});
