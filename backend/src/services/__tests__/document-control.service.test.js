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
// A file named by id is filed only by someone who may read it (certification FILES-X2).
const mockDocumentReadableToViewer = jest.fn(async () => true);
jest.mock("../document-text.service", () => ({
  documentViewer: (viewer) => viewer,
  documentReadableToViewer: (...args) => mockDocumentReadableToViewer(...args),
}));

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

describe("certification L23 and FILES-X2 — the reader's routing, module and approve right", () => {
  const scope = { orgId: "org-1", projectId: "project-1" };
  const party = {
    userId: "sub-b",
    projectAccess: { scope: "party", partyAccess: [{ projectPartyId: "party-b", companyId: "co-b" }] },
    canRead: () => true,
    mayApprove: false,
  };
  const pm = { userId: "pm-1", projectAccess: { scope: "assignment", assignmentRole: "pm" }, canRead: () => true, mayApprove: true };
  const routedTo = (where, partyId) => JSON.stringify(where).includes(`"ownerPartyId":{"in":["${partyId}"]}`);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    for (const model of ["rfi", "submittal", "drawingRecord", "transmittal", "correspondence"]) mockPrisma[model].findMany.mockResolvedValue([]);
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValue([]);
    mockPrisma.workflowActivityLink.findMany.mockResolvedValue([]);
    mockPrisma.documentRevision.findMany.mockResolvedValue([]);
    mockAuditService.recordEvent.mockResolvedValue({ id: "audit-1" });
    mockDocumentReadableToViewer.mockResolvedValue(true);
  });

  it("L23: the register and the dashboard ask for the RFIs and submittals routed to a party-scoped reader — drafts only its own — and drawings as their own list does", async () => {
    await docControlService.listDocumentRegister({ ...scope, query: {}, reader: party });
    const rfiWhere = mockPrisma.rfi.findMany.mock.calls[0][0].where;
    expect(routedTo(rfiWhere, "party-b")).toBe(true);
    expect(JSON.stringify(rfiWhere)).toContain('"createdBy":"sub-b"'); // a draft only its creator's
    expect(routedTo(mockPrisma.submittal.findMany.mock.calls[0][0].where, "party-b")).toBe(true);
    expect(mockPrisma.drawingRecord.findMany.mock.calls[0][0].where).toEqual({ projectId: "project-1" });

    jest.clearAllMocks();
    await docControlService.getDocControlDashboard({ ...scope, reader: party });
    expect(routedTo(mockPrisma.rfi.findMany.mock.calls[0][0].where, "party-b")).toBe(true);
    expect(routedTo(mockPrisma.submittal.findMany.mock.calls[0][0].where, "party-b")).toBe(true);

    // a member of the project is not filtered by routing; a system caller with no reader is not filtered at all
    jest.clearAllMocks();
    await docControlService.listDocumentRegister({ ...scope, query: { recordType: "submittal" }, reader: pm });
    expect(mockPrisma.submittal.findMany.mock.calls[0][0].where).toEqual({ projectId: "project-1" });
    jest.clearAllMocks();
    await docControlService.getDocControlDashboard(scope);
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith({ where: { projectId: "project-1" } });
  });

  it("L23: a reader who may not read RFIs gets no RFI rows and no RFI count, and the other types still", async () => {
    const noRfi = { ...pm, canRead: (moduleName) => moduleName !== "rfi" };
    const register = await docControlService.listDocumentRegister({ ...scope, query: {}, reader: noRfi });
    expect(mockPrisma.rfi.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.submittal.findMany).toHaveBeenCalled();
    expect(register.rows).toEqual([]);
    jest.clearAllMocks();
    const dashboard = await docControlService.getDocControlDashboard({ ...scope, reader: noRfi });
    expect(mockPrisma.rfi.findMany).not.toHaveBeenCalled();
    expect(dashboard.metrics.rfiOpen).toBe(0);
  });

  it("L23: the file of a revision of an RFI routed to other parties is answered as a revision that does not exist; the routed reader gets it", async () => {
    mockPrisma.documentRevision.findFirst.mockResolvedValue({ id: "rev-1", projectId: "project-1", projectDocumentId: "doc-1", recordType: "rfi", recordId: "rfi-1", revision: "A", status: "uploaded", isLatest: false });
    mockPrisma.rfi.findFirst.mockResolvedValue(null);
    await expect(docControlService.getRevisionDownloadFile({ ...scope, revisionId: "rev-1", userRole: "external_party", reader: party })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_REVISION_NOT_FOUND" });
    expect(routedTo(mockPrisma.rfi.findFirst.mock.calls[0][0].where, "party-b")).toBe(true);
    expect(mockFileStorageService.getWorkflowFile).not.toHaveBeenCalled();

    mockPrisma.rfi.findFirst.mockResolvedValue({ id: "rfi-1", status: "open", ownerPartyId: "party-b" });
    mockFileStorageService.getWorkflowFile.mockResolvedValue({ path: "/tmp/rev.pdf", mimeType: "application/pdf", fileName: "rev.pdf" });
    await expect(docControlService.getRevisionPreviewFile({ ...scope, revisionId: "rev-1", userRole: "external_party", reader: party })).resolves.toMatchObject({ path: "/tmp/rev.pdf" });
  });

  it("FILES-X2: a party files no revision on, and sends none for review from, an RFI routed to other parties", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue(null);
    await expect(docControlService.uploadDocumentRevision({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "X", projectDocumentId: "doc-1" }, userId: "sub-b", reader: party })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_RECORD_NOT_FOUND" });
    expect(mockPrisma.documentRevision.create).not.toHaveBeenCalled();
    mockPrisma.documentRevision.findFirst.mockResolvedValue({ id: "rev-1", projectId: "project-1", recordType: "rfi", recordId: "rfi-1", revision: "A", status: "uploaded" });
    await expect(docControlService.submitDocumentRevisionForReview({ ...scope, revisionId: "rev-1", userId: "sub-b", reader: party })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_REVISION_NOT_FOUND" });
    expect(mockPrisma.documentRevision.update).not.toHaveBeenCalled();
  });

  it("FILES-X2: only an approver files a revision as approved — stamped with who approved it; an unknown status is refused", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue({ id: "rfi-1", ref: "RFI-001", subject: "Edge", status: "open", ownerPartyId: "party-b" });
    mockPrisma.projectDocument.findFirst.mockResolvedValue({ id: "doc-1", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, scanStatus: "clean", status: "available" });
    mockPrisma.documentRevision.findFirst.mockResolvedValue(null);
    mockPrisma.documentRevision.create.mockImplementation(async ({ data }) => ({ id: "rev-9", ...data }));

    await expect(docControlService.uploadDocumentRevision({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "A", status: "approved", projectDocumentId: "doc-1" }, userId: "sub-b", reader: party })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(docControlService.assertRevisionFilingAllowed({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { status: "published" }, reader: pm })).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expect(mockPrisma.documentRevision.create).not.toHaveBeenCalled();

    const filed = await docControlService.uploadDocumentRevision({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "A", status: "approved", projectDocumentId: "doc-1" }, userId: "pm-1", reader: pm });
    expect(mockPrisma.documentRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "approved", approvedBy: "pm-1", approvedAt: expect.any(Date) }) });
    expect(filed.approvedBy).toBe("pm-1");
    const party2 = await docControlService.uploadDocumentRevision({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "B", projectDocumentId: "doc-1" }, userId: "sub-b", reader: party });
    expect(party2.status).toBe("uploaded"); // the routed party files an ordinary revision
  });

  it("FILES-X2: a file named by id is filed only by someone who may read it; a file the route stored for the filer is theirs", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue({ id: "rfi-1", ref: "RFI-001", subject: "Edge", status: "open", ownerPartyId: "party-b" });
    mockPrisma.projectDocument.findFirst.mockResolvedValue({ id: "doc-other", fileName: "w.pdf", mimeType: "application/pdf", sizeBytes: 1, scanStatus: "clean", status: "linked" });
    mockPrisma.documentRevision.findFirst.mockResolvedValue(null);
    mockPrisma.documentRevision.create.mockImplementation(async ({ data }) => ({ id: "rev-9", ...data }));
    mockDocumentReadableToViewer.mockResolvedValue(false);
    await expect(docControlService.uploadDocumentRevision({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "C", projectDocumentId: "doc-other" }, userId: "sub-b", reader: party })).rejects.toMatchObject({ status: 404, code: "FILE_NOT_FOUND" });
    expect(mockDocumentReadableToViewer).toHaveBeenCalledWith(expect.objectContaining({ documentId: "doc-other", viewer: expect.objectContaining({ userId: "sub-b" }) }));
    expect(mockPrisma.documentRevision.create).not.toHaveBeenCalled();
    await docControlService.uploadDocumentRevision({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "D", projectDocumentId: "doc-other" }, userId: "sub-b", reader: party, storedForFiler: true });
    expect(mockPrisma.documentRevision.create).toHaveBeenCalled();
  });

  it("R36: a file the filer may not read is not found, before its scan or status is told; a reader of it learns why it cannot be filed", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue({ id: "rfi-1", ref: "RFI-001", subject: "Edge", status: "open", ownerPartyId: "party-b" });
    mockPrisma.documentRevision.findFirst.mockResolvedValue(null);
    for (const unavailable of [{ scanStatus: "pending", status: "available" }, { scanStatus: "clean", status: "rejected" }]) {
      mockPrisma.projectDocument.findFirst.mockResolvedValue({ id: "doc-hidden", fileName: "h.pdf", mimeType: "application/pdf", sizeBytes: 1, ...unavailable });
      mockDocumentReadableToViewer.mockResolvedValue(false);
      await expect(docControlService.uploadDocumentRevision({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "R", projectDocumentId: "doc-hidden" }, userId: "sub-b", reader: party })).rejects.toMatchObject({ status: 404, code: "FILE_NOT_FOUND" });
      mockDocumentReadableToViewer.mockResolvedValue(true);
      await expect(docControlService.uploadDocumentRevision({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "R", projectDocumentId: "doc-hidden" }, userId: "sub-b", reader: party })).rejects.toMatchObject({ status: 409, code: "FILE_NOT_AVAILABLE" });
    }
    expect(mockPrisma.documentRevision.create).not.toHaveBeenCalled();
  });

  it("R37: the revision code and that the record has none under it are checked before the upload route stores a file", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue({ id: "rfi-1", ref: "RFI-001", subject: "Edge", status: "open", ownerPartyId: "party-b" });
    mockPrisma.documentRevision.findFirst.mockResolvedValue(null);
    await expect(docControlService.assertRevisionFilingAllowed({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: {}, reader: pm })).rejects.toMatchObject({ status: 400, code: "DOCUMENT_REVISION_REQUIRED" });
    mockPrisma.documentRevision.findFirst.mockResolvedValue({ id: "rev-a", revision: "A" });
    await expect(docControlService.assertRevisionFilingAllowed({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "A" }, reader: pm })).rejects.toMatchObject({ status: 409, code: "DOCUMENT_REVISION_EXISTS" });
    expect(mockPrisma.documentRevision.findFirst).toHaveBeenCalledWith({ where: { projectId: "project-1", recordType: "rfi", recordId: "rfi-1", revision: "A" } });
    mockPrisma.documentRevision.findFirst.mockResolvedValue(null);
    await expect(docControlService.assertRevisionFilingAllowed({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "B" }, reader: pm })).resolves.toMatchObject({ revision: "B", requestedStatus: "uploaded" });
    // a record not routed to the filer is not found before its revisions are looked at
    mockPrisma.rfi.findFirst.mockResolvedValue(null);
    mockPrisma.documentRevision.findFirst.mockClear();
    await expect(docControlService.assertRevisionFilingAllowed({ ...scope, recordType: "rfi", recordId: "rfi-1", payload: { revision: "A" }, reader: party })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_RECORD_NOT_FOUND" });
    expect(mockPrisma.documentRevision.findFirst).not.toHaveBeenCalled();
  });
});
