const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  rfi: { findMany: jest.fn(), findFirst: jest.fn() },
  submittal: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  drawingRecord: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  transmittal: { findMany: jest.fn(), findFirst: jest.fn() },
  correspondence: { findMany: jest.fn(), findFirst: jest.fn() },
  projectDocument: { findFirst: jest.fn(), update: jest.fn() },
  documentRevision: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  workflowAttachment: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  workflowStatusHistory: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  workflowActivityLink: { findMany: jest.fn() },
};

const mockAuditService = {
  ENTITY_TYPES: { DOCUMENT_REVISION: "document_revision" },
  ACTIONS: {
    CREATED: "created",
    STATUS_CHANGED: "status_changed",
    APPROVED: "approved",
    SUPERSEDED: "superseded",
  },
  recordEvent: jest.fn(),
};

const mockFileStorageService = {
  getWorkflowFile: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAuditService);
jest.mock("../file-storage.service", () => mockFileStorageService);

const docControlService = require("../doc-control.service");

describe("document-control register and revision controls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.rfi.findMany.mockResolvedValue([]);
    mockPrisma.submittal.findMany.mockResolvedValue([]);
    mockPrisma.drawingRecord.findMany.mockResolvedValue([]);
    mockPrisma.transmittal.findMany.mockResolvedValue([]);
    mockPrisma.correspondence.findMany.mockResolvedValue([]);
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValue([]);
    mockPrisma.workflowActivityLink.findMany.mockResolvedValue([]);
    mockAuditService.recordEvent.mockResolvedValue({ id: "audit-1" });
  });

  it("identifies the latest approved revision and keeps superseded history in the register", async () => {
    mockPrisma.rfi.findMany.mockResolvedValue([
      {
        id: "rfi-1",
        ref: "RFI-001",
        subject: "Confirm slab edge",
        status: "answered",
        updatedAt: new Date("2026-06-05T00:00:00Z"),
      },
    ]);
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([
      {
        id: "att-1",
        recordId: "rfi-1",
        fileName: "response.pdf",
        storageKey: "doc-2",
      },
    ]);
    mockPrisma.documentRevision.findMany.mockResolvedValue([
      {
        id: "rev-b",
        projectId: "project-1",
        projectDocumentId: "doc-2",
        recordType: "rfi",
        recordId: "rfi-1",
        revision: "B",
        status: "approved",
        isLatest: true,
        fileName: "response-b.pdf",
        issuedAt: new Date("2026-06-04T00:00:00Z"),
      },
      {
        id: "rev-a",
        projectId: "project-1",
        recordType: "rfi",
        recordId: "rfi-1",
        revision: "A",
        status: "superseded",
        isLatest: false,
        issuedAt: new Date("2026-06-01T00:00:00Z"),
      },
    ]);

    const result = await docControlService.listDocumentRegister({
      orgId: "org-1",
      projectId: "project-1",
      query: { recordType: "rfi" },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        recordType: "rfi",
        ref: "RFI-001",
        revisionCount: 2,
        supersededRevisionCount: 1,
        attachmentCount: 1,
      }),
    );
    expect(result.rows[0].latestRevision).toEqual(
      expect.objectContaining({
        id: "rev-b",
        revision: "B",
        status: "approved",
        isLatest: true,
        downloadUrl:
          "/api/v1/projects/project-1/doc-control/revisions/rev-b/download",
      }),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        records: 1,
        latestApproved: 1,
        supersededRevisions: 1,
      }),
    );
  });

  it("shows only the current approved revision to site-facing roles", async () => {
    mockPrisma.drawingRecord.findMany.mockResolvedValue([
      {
        id: "drawing-1",
        ref: "DRG-001",
        drawingNumber: "A-101",
        title: "Ground floor plan",
        revision: "B",
        status: "active",
        updatedAt: new Date("2026-06-05T00:00:00Z"),
      },
    ]);
    mockPrisma.documentRevision.findMany.mockResolvedValue([
      {
        id: "rev-b",
        projectId: "project-1",
        projectDocumentId: "doc-b",
        recordType: "drawing",
        recordId: "drawing-1",
        revision: "B",
        status: "approved",
        isLatest: true,
        category: "Drawings",
        folderPath: "/Drawings/Architectural",
        fileName: "a-101-b.pdf",
        issuedAt: new Date("2026-06-04T00:00:00Z"),
      },
      {
        id: "rev-a",
        projectId: "project-1",
        projectDocumentId: "doc-a",
        recordType: "drawing",
        recordId: "drawing-1",
        revision: "A",
        status: "superseded",
        isLatest: false,
        fileName: "a-101-a.pdf",
        issuedAt: new Date("2026-06-01T00:00:00Z"),
      },
    ]);

    const result = await docControlService.listDocumentRegister({
      orgId: "org-1",
      projectId: "project-1",
      query: { recordType: "drawing", folder: "drawings" },
      userRole: "site_engineer",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        folderKey: "drawings",
        restrictedToCurrentRevision: true,
        revisionCount: 1,
        supersededRevisionCount: 0,
      }),
    );
    expect(result.rows[0].revisions).toEqual([
      expect.objectContaining({ id: "rev-b", status: "approved" }),
    ]);
    expect(result.summary.currentOnly).toBe(true);
  });

  it("uploads a revision against a private ProjectDocument and links it to the record", async () => {
    const rfi = {
      id: "rfi-1",
      ref: "RFI-001",
      subject: "Confirm slab edge",
      status: "open",
    };
    const document = {
      id: "doc-1",
      orgId: "org-1",
      projectId: "project-1",
      fileName: "slab-edge.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      scanStatus: "clean",
      status: "available",
      uploadedBy: "uploader-1",
    };
    const revision = {
      id: "rev-1",
      projectId: "project-1",
      projectDocumentId: "doc-1",
      recordType: "rfi",
      recordId: "rfi-1",
      revision: "A",
      status: "uploaded",
      isLatest: false,
      fileName: "slab-edge.pdf",
      issuedAt: new Date("2026-06-05T00:00:00Z"),
    };

    mockPrisma.rfi.findFirst.mockResolvedValue(rfi);
    mockPrisma.projectDocument.findFirst.mockResolvedValue(document);
    mockPrisma.documentRevision.findFirst.mockResolvedValue(null);
    mockPrisma.documentRevision.create.mockResolvedValue(revision);

    const result = await docControlService.uploadDocumentRevision({
      orgId: "org-1",
      projectId: "project-1",
      recordType: "rfi",
      recordId: "rfi-1",
      payload: { revision: "A", projectDocumentId: "doc-1" },
      userId: "pm-1",
      userRole: "pm",
    });

    expect(mockPrisma.projectDocument.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: expect.objectContaining({
        status: "linked",
        linkedEntityType: "rfi",
        linkedEntityId: "rfi-1",
        category: "RFI",
        folderPath: "/RFI",
      }),
    });
    expect(mockPrisma.workflowAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "rfi",
          recordId: "rfi-1",
          storageKey: "doc-1",
          fileName: "slab-edge.pdf",
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "document_revision",
        action: "created",
        newStatus: "uploaded",
      }),
    );
    expect(result.downloadUrl).toBe(
      "/api/v1/projects/project-1/doc-control/revisions/rev-1/download",
    );
  });

  it("rejects revision upload when the private source file is outside the project", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue({
      id: "rfi-1",
      ref: "RFI-001",
      subject: "Confirm slab edge",
      status: "open",
    });
    mockPrisma.projectDocument.findFirst.mockResolvedValue(null);

    await expect(
      docControlService.uploadDocumentRevision({
        orgId: "org-1",
        projectId: "project-1",
        recordType: "rfi",
        recordId: "rfi-1",
        payload: { revision: "A", projectDocumentId: "doc-other-project" },
        userId: "pm-1",
        userRole: "pm",
      }),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });

    expect(mockPrisma.projectDocument.findFirst).toHaveBeenCalledWith({
      where: {
        orgId: "org-1",
        projectId: "project-1",
        OR: [{ id: "doc-other-project" }, { storageKey: "doc-other-project" }],
      },
    });
    expect(mockPrisma.documentRevision.create).not.toHaveBeenCalled();
  });

  it("submits an uploaded revision for review with workflow history and audit", async () => {
    const existing = {
      id: "rev-1",
      projectId: "project-1",
      recordType: "drawing",
      recordId: "drawing-1",
      revision: "A",
      status: "uploaded",
      isLatest: false,
    };
    const submitted = {
      ...existing,
      status: "submitted",
      submittedBy: "planner-1",
      submittedAt: new Date("2026-06-06T00:00:00Z"),
    };
    mockPrisma.documentRevision.findFirst.mockResolvedValue(existing);
    mockPrisma.drawingRecord.findFirst.mockResolvedValue({
      id: "drawing-1",
      ref: "DRG-001",
      drawingNumber: "A-101",
      title: "Ground floor plan",
      status: "active",
    });
    mockPrisma.documentRevision.update.mockResolvedValue(submitted);

    const result = await docControlService.submitDocumentRevisionForReview({
      orgId: "org-1",
      projectId: "project-1",
      revisionId: "rev-1",
      comment: "Ready for consultant review",
      userId: "planner-1",
      userRole: "planning_eng",
    });

    expect(mockPrisma.documentRevision.update).toHaveBeenCalledWith({
      where: { id: "rev-1" },
      data: expect.objectContaining({
        status: "submitted",
        submittedBy: "planner-1",
      }),
    });
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "drawing",
          recordId: "drawing-1",
          comment: "Ready for consultant review",
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "status_changed",
        oldStatus: "uploaded",
        newStatus: "submitted",
      }),
    );
    expect(result.status).toBe("submitted");
  });

  it("approves a revision as latest and supersedes the prior latest revision", async () => {
    const existing = {
      id: "rev-2",
      projectId: "project-1",
      recordType: "rfi",
      recordId: "rfi-1",
      revision: "B",
      status: "uploaded",
      isLatest: false,
    };
    const approved = {
      ...existing,
      status: "approved",
      isLatest: true,
      approvedBy: "pm-1",
      approvedAt: new Date("2026-06-06T00:00:00Z"),
    };
    mockPrisma.documentRevision.findFirst.mockResolvedValue(existing);
    mockPrisma.rfi.findFirst.mockResolvedValue({
      id: "rfi-1",
      ref: "RFI-001",
      subject: "Confirm slab edge",
      status: "answered",
    });
    mockPrisma.documentRevision.update.mockResolvedValue(approved);

    const result = await docControlService.approveDocumentRevision({
      orgId: "org-1",
      projectId: "project-1",
      revisionId: "rev-2",
      comment: "Approved for use",
      userId: "pm-1",
      userRole: "pm",
    });

    expect(mockPrisma.documentRevision.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordType: "rfi",
          recordId: "rfi-1",
          isLatest: true,
          id: { not: "rev-2" },
        }),
        data: expect.objectContaining({
          status: "superseded",
          isLatest: false,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ status: "approved", isLatest: true }),
    );
  });

  it("returns private storage download metadata for a revision", async () => {
    mockPrisma.documentRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      projectId: "project-1",
      projectDocumentId: "doc-1",
      recordType: "drawing",
      recordId: "drawing-1",
      revision: "C",
    });
    mockFileStorageService.getWorkflowFile.mockResolvedValue({
      redirectUrl: "https://example.com/private",
      mimeType: "application/pdf",
      fileName: "drawing-c.pdf",
    });

    const file = await docControlService.getRevisionDownloadFile({
      orgId: "org-1",
      projectId: "project-1",
      revisionId: "rev-1",
    });

    expect(mockFileStorageService.getWorkflowFile).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId: "project-1",
      key: "doc-1",
    });
    expect(file.redirectUrl).toBe("https://example.com/private");
  });

  it("denies superseded revision downloads to site-facing roles", async () => {
    mockPrisma.documentRevision.findFirst.mockResolvedValue({
      id: "rev-a",
      projectId: "project-1",
      projectDocumentId: "doc-a",
      recordType: "drawing",
      recordId: "drawing-1",
      revision: "A",
      status: "superseded",
      isLatest: false,
    });

    await expect(
      docControlService.getRevisionDownloadFile({
        orgId: "org-1",
        projectId: "project-1",
        revisionId: "rev-a",
        userRole: "site_engineer",
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_REVISION_HISTORY_FORBIDDEN" });

    expect(mockFileStorageService.getWorkflowFile).not.toHaveBeenCalled();
  });

  it("does not download a revision through another project", async () => {
    mockPrisma.documentRevision.findFirst.mockResolvedValue(null);

    await expect(
      docControlService.getRevisionDownloadFile({
        orgId: "org-1",
        projectId: "project-2",
        revisionId: "rev-1",
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_REVISION_NOT_FOUND" });

    expect(mockPrisma.documentRevision.findFirst).toHaveBeenCalledWith({
      where: { id: "rev-1", projectId: "project-2" },
    });
    expect(mockFileStorageService.getWorkflowFile).not.toHaveBeenCalled();
  });
});
