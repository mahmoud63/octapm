const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  projectDocument: { findMany: jest.fn(), findFirst: jest.fn() },
  attachment: {
    count: jest.fn(),
    upsert: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
  photo: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  location: { findFirst: jest.fn(), findMany: jest.fn() },
  backgroundJob: { create: jest.fn() },
};

const mockFileStorage = {
  DOCUMENT_TYPES: { WORKFLOW_ATTACHMENT: "workflow_attachment", SITE_PHOTO: "site_photo" },
  uploadProjectDocument: jest.fn(),
  getProjectDocumentFile: jest.fn(),
};
const mockAudit = {
  ENTITY_TYPES: { ATTACHMENT: "attachment", PHOTO: "photo" },
  ACTIONS: { CREATED: "created", UPDATED: "updated", DELETED: "deleted" },
  recordEvent: jest.fn(),
};
const mockJobService = {
  JOB_TYPES: { PHOTO_THUMBNAIL: "photo.thumbnail" },
  enqueueJob: jest.fn(),
};
const mockReadImageMetadata = jest.fn();
// A viewer here carries the documents and records it may read (document-text.service decides for real).
const mockDocText = {
  readableDocumentIds: jest.fn(async ({ documentIds, viewer }) => new Set(documentIds.filter((id) => viewer.readable.includes(id)))),
  documentReadableToViewer: jest.fn(async ({ documentId, viewer }) => viewer.readable.includes(documentId)),
  recordRuleVisibleIds: jest.fn(async ({ viewer }) => new Set(viewer.records)),
  attachmentVisible: jest.fn((link, _viewer, ruled) => ruled.has(`${link.recordType}:${link.recordId}`)),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../document-text.service", () => mockDocText);
jest.mock("../file-storage.service", () => mockFileStorage);
jest.mock("../audit.service", () => mockAudit);
jest.mock("../../jobs/job.service", () => mockJobService);
jest.mock("../../utils/image-metadata", () => ({
  readImageMetadata: (...args) => mockReadImageMetadata(...args),
}));

const service = require("../attachment.service");

const DOC_IMAGE = "11111111-1111-4111-8111-111111111111";
const DOC_PDF = "22222222-2222-4222-8222-222222222222";
const PHOTO_ID = "33333333-3333-4333-8333-333333333333";

const imageDocument = {
  id: DOC_IMAGE,
  fileName: "wall.jpg",
  originalName: "wall.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1200,
  documentType: "workflow_attachment",
  uploadedAt: new Date("2026-09-05T08:00:00Z"),
  uploadedBy: "user-1",
};
const pdfDocument = { ...imageDocument, id: DOC_PDF, fileName: "spec.pdf", mimeType: "application/pdf" };

describe("attachment service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.attachment.count.mockResolvedValue(0);
    mockPrisma.attachment.upsert.mockImplementation(({ create, include }) =>
      Promise.resolve({
        id: `att-${create.documentId}`,
        ...create,
        createdAt: new Date("2026-09-05T09:00:00Z"),
        document: create.documentId === DOC_IMAGE ? { ...imageDocument, photo: null } : { ...pdfDocument, photo: null },
        include,
      }),
    );
    mockPrisma.photo.upsert.mockImplementation(({ create }) =>
      Promise.resolve({ id: PHOTO_ID, ...create, thumbnailKey: null, createdAt: new Date(), updatedAt: new Date() }),
    );
    mockReadImageMetadata.mockResolvedValue({
      width: 4032,
      height: 3024,
      takenAt: new Date("2026-09-04T10:30:00Z"),
      latitude: 25.2,
      longitude: 55.27,
      altitude: null,
      cameraMake: "Acme",
      cameraModel: "SiteCam",
      orientation: 1,
      raw: { format: "jpeg" },
    });
    mockFileStorage.uploadProjectDocument.mockImplementation(({ file }) =>
      Promise.resolve(file.mimetype.startsWith("image/") ? imageDocument : pdfDocument),
    );
  });

  it("stores uploads, creates a Photo with EXIF for images, audits and queues a thumbnail", async () => {
    const result = await service.createAttachments({
      orgId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      userRole: "site_engineer",
      recordType: "ncr",
      recordId: "ncr-1",
      caption: "Honeycombing at grid B3",
      tags: "Concrete, Defect ,concrete",
      files: [
        { path: "/tmp/a.jpg", mimetype: "image/jpeg", originalname: "wall.jpg" },
        { path: "/tmp/b.pdf", mimetype: "application/pdf", originalname: "spec.pdf" },
      ],
    });

    expect(mockReadImageMetadata).toHaveBeenCalledWith("/tmp/a.jpg");
    expect(mockFileStorage.uploadProjectDocument).toHaveBeenCalledTimes(2);
    expect(mockFileStorage.uploadProjectDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: "workflow_attachment", linkedEntityType: "ncr", linkedEntityId: "ncr-1" }),
    );
    expect(mockPrisma.attachment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recordType_recordId_documentId: { recordType: "ncr", recordId: "ncr-1", documentId: DOC_IMAGE } },
        create: expect.objectContaining({ role: "photo", source: "upload", caption: "Honeycombing at grid B3" }),
      }),
    );
    expect(mockPrisma.attachment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ documentId: DOC_PDF, role: "attachment" }) }),
    );
    expect(mockPrisma.photo.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.photo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentId: DOC_IMAGE },
        create: expect.objectContaining({
          takenAt: new Date("2026-09-04T10:30:00Z"),
          latitude: 25.2,
          cameraModel: "SiteCam",
          tags: ["concrete", "defect"],
          thumbnailStatus: "pending",
        }),
      }),
    );
    expect(mockAudit.recordEvent).toHaveBeenCalledTimes(2);
    expect(mockJobService.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: "photo.thumbnail", payload: { photoId: PHOTO_ID } }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0].fileUrl).toBe(`/api/v1/projects/project-1/attachments/documents/${DOC_IMAGE}`);
    expect(result.items[0].photo).toMatchObject({ id: PHOTO_ID, thumbnailStatus: "pending" });
  });

  it("links existing documents without re-uploading and rejects foreign documents", async () => {
    mockPrisma.projectDocument.findMany.mockResolvedValue([imageDocument]);
    const result = await service.createAttachments({
      orgId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      recordType: "rfi",
      recordId: "rfi-1",
      documentIds: JSON.stringify([DOC_IMAGE]),
    });
    expect(mockFileStorage.uploadProjectDocument).not.toHaveBeenCalled();
    expect(mockPrisma.attachment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ source: "link", role: "photo" }) }),
    );
    expect(result.items).toHaveLength(1);

    mockPrisma.projectDocument.findMany.mockResolvedValue([]);
    await expect(
      service.createAttachments({
        orgId: "org-1",
        projectId: "project-1",
        recordType: "rfi",
        recordId: "rfi-1",
        documentIds: [DOC_PDF],
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_DOCUMENT_NOT_FOUND" });
  });

  it("validates record types, roles and requires at least one file or link", async () => {
    await expect(
      service.createAttachments({ orgId: "org-1", projectId: "project-1", recordType: "invoice", recordId: "x", files: [{}] }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_RECORD_TYPE_INVALID" });
    await expect(
      service.createAttachments({ orgId: "org-1", projectId: "project-1", recordType: "rfi", recordId: "x" }),
    ).rejects.toMatchObject({ code: "NO_FILE" });
    expect(() => service.moduleForRecordType("rfi")).not.toThrow();
    expect(service.moduleForRecordType("daily_report")).toBe("progress");
    // The form service stores a checklist signature as an attachment under this role; it must stay accepted.
    expect(service.ATTACHMENT_ROLES).toContain("signature");
    mockPrisma.projectDocument.findMany.mockResolvedValue([pdfDocument]);
    await expect(
      service.createAttachments({ orgId: "org-1", projectId: "project-1", recordType: "rfi", recordId: "x", role: "boss", documentIds: [DOC_PDF] }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_ROLE_INVALID" });
  });

  it("unlinks an attachment and audits the removal", async () => {
    mockPrisma.attachment.findFirst.mockResolvedValue({
      id: "att-1",
      recordType: "ncr",
      recordId: "ncr-1",
      documentId: DOC_IMAGE,
      document: imageDocument,
    });
    const result = await service.deleteAttachment({
      orgId: "org-1",
      projectId: "project-1",
      attachmentId: "att-1",
      userId: "user-1",
    });
    expect(mockPrisma.attachment.delete).toHaveBeenCalledWith({ where: { id: "att-1" } });
    expect(mockAudit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "attachment", action: "deleted", entityId: "att-1" }),
    );
    expect(result).toMatchObject({ deleted: true, recordType: "ncr" });
  });

  it("lists the gallery with date, location subtree and tag filters plus record links", async () => {
    mockPrisma.location.findFirst.mockResolvedValue({ id: "loc-1", path: "root/loc-1" });
    mockPrisma.location.findMany.mockResolvedValue([{ id: "loc-1" }, { id: "loc-2" }]);
    mockPrisma.photo.findMany
      .mockResolvedValueOnce([
        {
          id: PHOTO_ID,
          documentId: DOC_IMAGE,
          locationId: "loc-2",
          location: { id: "loc-2", name: "Level 3", path: "root/loc-1/loc-2" },
          caption: "Grid B3",
          tags: ["concrete"],
          takenAt: new Date("2026-09-04T10:30:00Z"),
          thumbnailStatus: "ready",
          thumbnailKey: "thumb-1",
          document: imageDocument,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([{ tags: ["concrete"] }, { tags: ["concrete", "rebar"] }]);
    mockPrisma.photo.count.mockResolvedValue(2);
    mockPrisma.attachment.findMany.mockResolvedValue([
      { documentId: DOC_IMAGE, recordType: "ncr", recordId: "ncr-1", role: "photo" },
      { documentId: DOC_IMAGE, recordType: "rfi", recordId: "rfi-9", role: "reference" },
    ]);

    const result = await service.listPhotos({
      orgId: "org-1",
      projectId: "project-1",
      query: { from: "2026-09-01", to: "2026-09-30", locationId: "loc-1", tag: "Concrete", limit: 10 },
    });

    expect(mockPrisma.photo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          takenAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
          locationId: { in: ["loc-1", "loc-2"] },
          tags: { has: "concrete" },
        }),
        take: 11,
      }),
    );
    expect(result.items[0]).toMatchObject({
      id: PHOTO_ID,
      thumbnailUrl: `/api/v1/projects/project-1/photos/${PHOTO_ID}/thumbnail`,
      location: { name: "Level 3" },
      records: [
        { recordType: "ncr", recordId: "ncr-1", role: "photo" },
        { recordType: "rfi", recordId: "rfi-9", role: "reference" },
      ],
    });
    expect(result.summary).toEqual({ total: 2, tags: [{ tag: "concrete", count: 2 }, { tag: "rebar", count: 1 }] });
    expect(result.pagination.nextCursor).toBeNull();
  });

  // Certification R31: a photo is its document's, and its document its records'.
  it("lists, pages and counts only the photos, records and tags a viewer may read", async () => {
    const photo = (id, documentId, tags) => ({ id, projectId: "project-1", orgId: "org-1", documentId, tags, caption: null, takenAt: null, thumbnailStatus: "pending", thumbnailKey: null, document: { ...imageDocument, id: documentId }, createdAt: new Date(), updatedAt: new Date() });
    const rows = [photo("ph-1", "doc-a", ["concrete"]), photo("ph-2", "doc-b", ["lien-waiver"]), photo("ph-3", "doc-c", ["rebar"])];
    mockPrisma.photo.findMany.mockImplementation(async ({ select, take, cursor, skip = 0 }) => {
      if (select) return rows.map((row) => ({ documentId: row.documentId, tags: row.tags }));
      const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + skip : 0;
      return rows.slice(start, start + take);
    });
    mockPrisma.attachment.findMany.mockImplementation(async ({ where }) =>
      [
        { documentId: "doc-a", recordType: "ncr", recordId: "ncr-1", role: "photo" },
        { documentId: "doc-a", recordType: "rfi", recordId: "rfi-9", role: "reference" },
        { documentId: "doc-b", recordType: "sub_pay_app", recordId: "spa-1", role: "evidence" },
        { documentId: "doc-c", recordType: "location", recordId: "loc-1", role: "photo" },
      ].filter((link) => where.documentId.in.includes(link.documentId)),
    );
    const viewer = { userId: "user-2", readable: ["doc-a", "doc-c"], records: ["ncr:ncr-1", "location:loc-1"] };
    const scope = { orgId: "org-1", projectId: "project-1" };

    const first = await service.listPhotos({ ...scope, query: { limit: 1 }, viewer });
    expect(first.items.map((item) => [item.id, item.records])).toEqual([["ph-1", [{ recordType: "ncr", recordId: "ncr-1", role: "photo" }]]]);
    expect(first.pagination.nextCursor).toBe("ph-1");
    expect(first.summary).toEqual({ total: 2, tags: [{ tag: "concrete", count: 1 }, { tag: "rebar", count: 1 }] });
    const second = await service.listPhotos({ ...scope, query: { limit: 1, cursor: "ph-1" }, viewer });
    expect(second.items.map((item) => item.id)).toEqual(["ph-3"]);
    expect(second.pagination.nextCursor).toBeNull();

    // a record filter matches only a link the viewer may see
    const byHiddenRecord = await service.listPhotos({ ...scope, query: { recordType: "rfi", recordId: "rfi-9" }, viewer });
    expect(byHiddenRecord.items).toEqual([]);
    const byLocation = await service.listPhotos({ ...scope, query: { recordType: "location", recordId: "loc-1" }, viewer });
    expect(byLocation.items.map((item) => item.id)).toEqual(["ph-3"]);

    // the PM's viewer reads them all
    const pm = await service.listPhotos({ ...scope, query: {}, viewer: { userId: "pm", readable: ["doc-a", "doc-b", "doc-c"], records: ["ncr:ncr-1", "rfi:rfi-9", "sub_pay_app:spa-1", "location:loc-1"] } });
    expect(pm.items.map((item) => item.id)).toEqual(["ph-1", "ph-2", "ph-3"]);
    expect(pm.summary.total).toBe(3);

    // a photo's file: a hidden one is answered as a missing photo
    mockPrisma.photo.findFirst.mockResolvedValue(rows[1]);
    mockPrisma.projectDocument.findFirst.mockResolvedValue({ id: "doc-b", documentType: "workflow_attachment" });
    mockFileStorage.getProjectDocumentFile.mockResolvedValue({ path: "/tmp/b.jpg", mimeType: "image/jpeg" });
    await expect(service.getPhotoFile({ ...scope, photoId: "ph-2", viewer })).rejects.toMatchObject({ status: 404, code: "PHOTO_NOT_FOUND" });
    expect(mockFileStorage.getProjectDocumentFile).not.toHaveBeenCalled();
    await expect(service.getPhotoFile({ ...scope, photoId: "ph-2", variant: "thumbnail", viewer: { ...viewer, readable: ["doc-b"] } })).resolves.toEqual({ path: "/tmp/b.jpg", mimeType: "image/jpeg" });
    await expect(service.getPhotoFile({ ...scope, photoId: "ph-2" })).resolves.toEqual({ path: "/tmp/b.jpg", mimeType: "image/jpeg" });
    mockPrisma.photo.findMany.mockReset();
    mockPrisma.attachment.findMany.mockReset();
  });

  it("marks thumbnails unavailable when the image codec is not installed", async () => {
    mockPrisma.photo.findFirst.mockResolvedValue({
      id: PHOTO_ID,
      orgId: "org-1",
      projectId: "project-1",
      documentId: DOC_IMAGE,
      document: imageDocument,
    });
    mockPrisma.photo.update.mockResolvedValue({});
    const result = await service.runPhotoThumbnailJob({
      job: { orgId: "org-1" },
      payload: { photoId: PHOTO_ID },
    });
    expect(result.status).toBe("unavailable");
    expect(mockPrisma.photo.update).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { thumbnailStatus: "unavailable" },
    });

    mockPrisma.photo.findFirst.mockResolvedValue(null);
    await expect(
      service.runPhotoThumbnailJob({ job: { orgId: "org-1" }, payload: { photoId: "missing" } }),
    ).rejects.toMatchObject({ code: "PHOTO_NOT_FOUND", retryable: false });
  });

  it("normalizes tags and validates photo updates", async () => {
    expect(service.normalizeTags(" A, b ,,a")).toEqual(["a", "b"]);
    expect(service.normalizeTags(["X", "x", "y"])).toEqual(["x", "y"]);

    mockPrisma.photo.findFirst.mockResolvedValue({ id: PHOTO_ID, document: imageDocument });
    mockPrisma.location.findFirst.mockResolvedValue(null);
    await expect(
      service.updatePhoto({ orgId: "org-1", projectId: "project-1", photoId: PHOTO_ID, payload: { locationId: "nope" } }),
    ).rejects.toMatchObject({ code: "LOCATION_NOT_FOUND" });
  });
});
