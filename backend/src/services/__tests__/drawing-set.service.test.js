const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  location: { findFirst: jest.fn() },
  drawingSet: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  sheet: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  sheetRevision: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
    groupBy: jest.fn(),
  },
};
const mockFileStorage = {
  DOCUMENT_TYPES: { DRAWING_SET: "drawing_set", SITE_PHOTO: "site_photo" },
  uploadProjectDocument: jest.fn(),
};
const mockJobs = {
  JOB_TYPES: { DRAWING_SET_PROCESS: "drawing.set_process" },
  enqueueJob: jest.fn(async () => ({ id: "job-1" })),
};
const mockAudit = {
  ENTITY_TYPES: { DRAWING_SET: "drawing_set", SHEET: "sheet", SHEET_REVISION: "sheet_revision" },
  ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", DELETED: "deleted", SUPERSEDED: "superseded" },
  recordEvent: jest.fn(async () => ({})),
};
const mockNotifications = {
  NOTIFICATION_CATEGORIES: { WORKFLOW: "workflow" },
  createNotifications: jest.fn(async () => ({ created: 0 })),
};
const mockDocumentText = { readDocumentBytes: jest.fn() };
const mockPdfPages = jest.fn();
const mockListSubscribers = jest.fn(async () => []);

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../file-storage.service", () => mockFileStorage);
jest.mock("../../jobs/job.service", () => mockJobs);
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../document-text.service", () => mockDocumentText);
jest.mock("../../utils/document-text", () => ({ pdfPages: (...args) => mockPdfPages(...args) }));
jest.mock("../comment.service", () => ({ listSubscribers: (...args) => mockListSubscribers(...args) }));

const service = require("../drawing-set.service");

const ORG = "org-1";
const PROJECT = "project-1";
const SET_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "22222222-2222-4222-8222-222222222222";

const baseSet = (overrides = {}) => ({
  id: SET_ID,
  orgId: ORG,
  projectId: PROJECT,
  setNumber: "SET-001",
  name: "IFC Architecture",
  discipline: "Architectural",
  status: "review",
  sourceDocumentId: DOC_ID,
  sourceDocument: { id: DOC_ID, mimeType: "application/pdf", fileName: "ifc.pdf", orgId: ORG, projectId: PROJECT, documentType: "drawing_set" },
  pageCount: null,
  processedPages: 0,
  uploadedBy: "user-1",
  publishedAt: null,
  publishedBy: null,
  createdAt: new Date("2026-09-06T08:00:00Z"),
  updatedAt: new Date("2026-09-06T08:00:00Z"),
  ...overrides,
});

const pendingRevision = (overrides = {}) => ({
  id: `rev-${overrides.pageNumber || 1}`,
  orgId: ORG,
  projectId: PROJECT,
  setId: SET_ID,
  sheetId: null,
  documentId: DOC_ID,
  pageNumber: 1,
  number: "A-101",
  title: "GROUND FLOOR PLAN",
  revision: "B",
  discipline: "Architectural",
  status: "pending_review",
  confidence: 0.9,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("drawing set service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, name: "Tower" });
    mockPrisma.drawingSet.update.mockImplementation(({ data }) => Promise.resolve({ ...baseSet(), ...data }));
    mockPrisma.sheetRevision.update.mockImplementation(({ where, data }) => Promise.resolve({ ...pendingRevision(), id: where.id, ...data }));
    mockPrisma.sheetRevision.upsert.mockImplementation(({ create }) => Promise.resolve({ id: `rev-${create.pageNumber}`, ...create }));
    mockPrisma.sheetRevision.groupBy.mockResolvedValue([]);
  });

  describe("createSet", () => {
    it("uploads the PDF, numbers the set, queues processing and audits", async () => {
      mockFileStorage.uploadProjectDocument.mockResolvedValue({ id: DOC_ID, fileName: "ifc.pdf", originalName: "IFC Set.pdf", sizeBytes: 1024 });
      mockPrisma.drawingSet.count.mockResolvedValue(2);
      mockPrisma.drawingSet.create.mockImplementation(({ data }) => Promise.resolve({ id: SET_ID, ...data, createdAt: new Date(), updatedAt: new Date() }));

      const set = await service.createSet({
        orgId: ORG,
        projectId: PROJECT,
        userId: "user-1",
        file: { path: "/tmp/x.pdf", originalname: "IFC Set.pdf", mimetype: "application/pdf", size: 1024 },
        payload: { purpose: "ifc", discipline: "Architectural" },
      });
      expect(mockFileStorage.uploadProjectDocument).toHaveBeenCalledWith(
        expect.objectContaining({ documentType: "drawing_set", linkedEntityType: "drawing_set" }),
      );
      expect(mockPrisma.drawingSet.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ setNumber: "SET-003", name: "IFC Set.pdf", purpose: "IFC", status: "processing" }) }),
      );
      expect(mockJobs.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "drawing.set_process", payload: { setId: SET_ID } }));
      expect(mockAudit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ entityType: "drawing_set", action: "created" }));
      expect(set).toEqual(expect.objectContaining({ setNumber: "SET-003", status: "processing", jobId: "job-1", fileUrl: `/api/v1/projects/${PROJECT}/attachments/documents/${DOC_ID}` }));
    });

    it("rejects unknown purposes and missing files", async () => {
      await expect(service.createSet({ orgId: ORG, projectId: PROJECT, file: null, payload: {} })).rejects.toMatchObject({ code: "NO_FILE" });
      await expect(
        service.createSet({ orgId: ORG, projectId: PROJECT, file: { path: "x" }, payload: { purpose: "DRAFT" } }),
      ).rejects.toMatchObject({ code: "DRAWING_SET_PURPOSE_INVALID" });
    });
  });

  describe("runDrawingSetJob", () => {
    it("detects a title block per page and moves the set to review", async () => {
      mockPrisma.drawingSet.findFirst.mockResolvedValue(baseSet({ status: "processing" }));
      mockDocumentText.readDocumentBytes.mockResolvedValue(Buffer.from("%PDF"));
      mockPdfPages.mockReturnValue({
        encrypted: false,
        pageCount: 2,
        pages: [
          { pageNumber: 1, text: "GROUND FLOOR PLAN\nDWG NO A-101\nREV B", width: 2384, height: 1684, rotation: 0 },
          { pageNumber: 2, text: "", width: 2384, height: 1684, rotation: 90 },
        ],
      });
      mockPrisma.sheetRevision.findMany.mockResolvedValue([]);
      const updateProgress = jest.fn();

      const result = await service.runDrawingSetJob({ job: { orgId: ORG }, payload: { setId: SET_ID }, updateProgress });

      expect(result).toEqual({ setId: SET_ID, pages: 2, detected: 1, needsReview: 1, noText: 1, kept: 0 });
      expect(mockPrisma.sheetRevision.upsert).toHaveBeenCalledTimes(2);
      const first = mockPrisma.sheetRevision.upsert.mock.calls[0][0];
      expect(first.where).toEqual({ setId_pageNumber: { setId: SET_ID, pageNumber: 1 } });
      expect(first.create).toEqual(
        expect.objectContaining({
          documentId: DOC_ID,
          number: "A-101",
          title: "GROUND FLOOR PLAN",
          revision: "B",
          discipline: "Architectural",
          detectedNumber: "A-101",
          status: "pending_review",
          widthPt: 2384,
          rotation: 0,
          textStatus: "ready",
        }),
      );
      const second = mockPrisma.sheetRevision.upsert.mock.calls[1][0];
      expect(second.create).toEqual(expect.objectContaining({ number: null, title: "Page 2", textStatus: "no_text", discipline: "Architectural", rotation: 90 }));
      expect(mockPrisma.drawingSet.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "review", processedPages: 2, detectionSummaryJson: expect.objectContaining({ detected: 1 }) }) }),
      );
      expect(updateProgress).toHaveBeenLastCalledWith({ step: "done", progress: 100 });
    });

    it("keeps pages that were already published and fails encrypted files", async () => {
      mockPrisma.drawingSet.findFirst.mockResolvedValue(baseSet({ status: "processing" }));
      mockDocumentText.readDocumentBytes.mockResolvedValue(Buffer.from("%PDF"));
      mockPdfPages.mockReturnValue({ encrypted: false, pageCount: 1, pages: [{ pageNumber: 1, text: "DWG NO A-101", width: 1, height: 1, rotation: 0 }] });
      mockPrisma.sheetRevision.findMany.mockResolvedValue([{ pageNumber: 1, status: "published" }]);
      const kept = await service.runDrawingSetJob({ job: { orgId: ORG }, payload: { setId: SET_ID } });
      expect(kept.kept).toBe(1);
      expect(mockPrisma.sheetRevision.upsert).not.toHaveBeenCalled();

      mockPdfPages.mockReturnValue({ encrypted: true, pageCount: 0, pages: [] });
      await expect(service.runDrawingSetJob({ job: { orgId: ORG }, payload: { setId: SET_ID } })).rejects.toMatchObject({ code: "DRAWING_SET_ENCRYPTED" });
      expect(mockPrisma.drawingSet.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "failed", error: "encrypted" } }));
    });
  });

  describe("publishSet", () => {
    it("creates sheets, supersedes the previous current revision, audits and notifies", async () => {
      mockPrisma.drawingSet.findFirst.mockResolvedValue(baseSet());
      mockPrisma.sheetRevision.findMany
        .mockResolvedValueOnce([pendingRevision({ pageNumber: 1 }), pendingRevision({ pageNumber: 2, number: "A-102", title: "FIRST FLOOR PLAN" }), pendingRevision({ pageNumber: 3, number: null, title: "Page 3" })])
        .mockResolvedValueOnce([pendingRevision({ pageNumber: 1 }), pendingRevision({ pageNumber: 2, number: "A-102", title: "FIRST FLOOR PLAN" })]);
      mockPrisma.sheet.findFirst
        .mockResolvedValueOnce({ id: "sheet-a101", projectId: PROJECT, number: "A-101", title: "GROUND FLOOR PLAN", discipline: "Architectural", currentRevisionId: "rev-old" })
        .mockResolvedValueOnce(null);
      mockPrisma.sheetRevision.findFirst.mockResolvedValue({ id: "rev-old", status: "published", revision: "A" });
      mockPrisma.sheet.create.mockImplementation(({ data }) => Promise.resolve({ id: "sheet-a102", ...data, currentRevisionId: null }));
      mockPrisma.sheet.update.mockResolvedValue({});
      mockPrisma.sheetRevision.count.mockResolvedValue(1);
      mockListSubscribers.mockResolvedValue([{ userId: "follower-1" }]);

      const result = await service.publishSet({ orgId: ORG, projectId: PROJECT, setId: SET_ID, userId: "pm-1" });

      expect(result.published).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.remaining).toBe(1);
      expect(result.results).toEqual([
        expect.objectContaining({ number: "A-101", revision: "B", supersededRevisionId: "rev-old", isNewSheet: false }),
        expect.objectContaining({ number: "A-102", revision: "B", supersededRevisionId: null, isNewSheet: true }),
      ]);
      expect(mockPrisma.sheetRevision.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "rev-old" }, data: expect.objectContaining({ status: "superseded", supersededById: "rev-1" }) }),
      );
      expect(mockPrisma.sheet.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ number: "A-102", sortKey: "a-000102", status: "current" }) }),
      );
      expect(mockPrisma.sheet.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "sheet-a101" }, data: expect.objectContaining({ currentRevisionId: "rev-1", status: "current" }) }),
      );
      const auditActions = mockAudit.recordEvent.mock.calls.map(([args]) => `${args.entityType}:${args.action}`);
      expect(auditActions).toEqual(expect.arrayContaining(["sheet_revision:published", "sheet_revision:superseded", "drawing_set:published"]));
      expect(mockPrisma.drawingSet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "review", publishedBy: "pm-1" }) }),
      );
      expect(mockNotifications.createNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "workflow",
          event: "drawing_set.published",
          recipientUserIds: ["follower-1"],
          recipientRoles: ["pm", "planning_eng", "site_engineer"],
          title: "Drawing set SET-001 published",
          actionUrl: `/projects/${PROJECT}/doc-control/drawings?recordId=${SET_ID}&source=drawing_set`,
        }),
      );
    });

    it("refuses duplicate sheet numbers and sets that are still processing", async () => {
      mockPrisma.drawingSet.findFirst.mockResolvedValue(baseSet({ status: "processing" }));
      await expect(service.publishSet({ orgId: ORG, projectId: PROJECT, setId: SET_ID })).rejects.toMatchObject({ code: "DRAWING_SET_NOT_REVIEWABLE" });

      mockPrisma.drawingSet.findFirst.mockResolvedValue(baseSet());
      mockPrisma.sheetRevision.findMany.mockResolvedValue([pendingRevision({ pageNumber: 1 }), pendingRevision({ pageNumber: 2, number: "a - 101" })]);
      await expect(service.publishSet({ orgId: ORG, projectId: PROJECT, setId: SET_ID })).rejects.toMatchObject({ code: "SHEET_NUMBER_DUPLICATE" });
      expect(mockPrisma.sheet.create).not.toHaveBeenCalled();
    });
  });

  describe("reviewRevisions", () => {
    it("normalises edits and derives the discipline from the number", async () => {
      mockPrisma.drawingSet.findFirst.mockResolvedValue(baseSet());
      mockPrisma.sheetRevision.findMany.mockResolvedValue([pendingRevision({ pageNumber: 4, number: null, discipline: null })]);
      const result = await service.reviewRevisions({
        orgId: ORG,
        projectId: PROJECT,
        setId: SET_ID,
        userId: "user-1",
        updates: [{ id: "rev-4", number: " s - 301 ", title: "  Roof framing ", revision: "b" }],
      });
      expect(mockPrisma.sheetRevision.update).toHaveBeenCalledWith({
        where: { id: "rev-4" },
        data: expect.objectContaining({ number: "S-301", title: "Roof framing", revision: "B", discipline: "Structural", reviewedBy: "user-1" }),
      });
      expect(result.items[0].number).toBe("S-301");
    });
  });

  describe("listSheets / getSheet", () => {
    it("filters by location subtree and only shows superseded revisions to privileged users", async () => {
      mockPrisma.location.findFirst.mockResolvedValue({ path: "site/bldg-a" });
      mockPrisma.sheet.findMany.mockResolvedValue([
        { id: "sheet-1", projectId: PROJECT, number: "A-101", title: "GF", discipline: "Architectural", status: "current", currentRevisionId: "rev-1", location: null, _count: { revisions: 2 }, createdAt: new Date(), updatedAt: new Date() },
        { id: "sheet-2", projectId: PROJECT, number: "S-201", title: "Beams", discipline: "Structural", status: "obsolete", currentRevisionId: null, location: null, _count: { revisions: 0 }, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockPrisma.sheetRevision.findMany.mockResolvedValue([pendingRevision({ id: "rev-1", status: "published", sheetId: "sheet-1", document: { fileName: "ifc.pdf", sizeBytes: 5 } })]);

      const list = await service.listSheets({ orgId: ORG, projectId: PROJECT, filters: { locationId: "loc-1", status: "all" } });
      expect(mockPrisma.sheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ location: { path: { startsWith: "site/bldg-a" } } }) }),
      );
      expect(list.summary).toEqual({ total: 2, current: 1, obsolete: 1, disciplines: [{ discipline: "Architectural", count: 1 }, { discipline: "Structural", count: 1 }] });
      expect(list.items[0].currentRevision).toEqual(expect.objectContaining({ id: "rev-1", fileName: "ifc.pdf" }));
      expect(list.items[1].hasFile).toBe(false);

      mockPrisma.sheet.findFirst.mockResolvedValue({
        id: "sheet-1", projectId: PROJECT, number: "A-101", title: "GF", status: "current", currentRevisionId: "rev-new", location: null, createdAt: new Date(), updatedAt: new Date(),
        revisions: [
          pendingRevision({ id: "rev-new", status: "published", sheetId: "sheet-1", revision: "B" }),
          pendingRevision({ id: "rev-old", status: "superseded", sheetId: "sheet-1", revision: "A" }),
        ],
      });
      const site = await service.getSheet({ orgId: ORG, projectId: PROJECT, sheetId: "sheet-1", includeSuperseded: false });
      expect(site.revisions.map((row) => row.revision)).toEqual(["B"]);
      expect(site.revisionCount).toBe(2);
      const pm = await service.getSheet({ orgId: ORG, projectId: PROJECT, sheetId: "sheet-1", includeSuperseded: true });
      expect(pm.revisions.map((row) => row.revision)).toEqual(["B", "A"]);
    });
  });
});
