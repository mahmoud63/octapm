const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "user-1",
      orgId: "org-1",
      role: req.get("x-role") || "site_engineer",
    };
    next();
  },
}));
jest.mock("../../middleware/rate-limit", () => ({
  uploadLimiter: (_req, _res, next) => next(),
}));
jest.mock("../../services/file-storage.service", () => ({
  DOCUMENT_TYPES: { WORKFLOW_ATTACHMENT: "workflow_attachment" },
  ALLOWED_WORKFLOW_MIME: new Set(["image/jpeg", "application/pdf"]),
  isAllowedOriginalNameForType: () => true,
  ensureTempUploadDirSync: () => require("os").tmpdir(),
  cleanupTempFiles: jest.fn(async () => {}),
}));

const mockService = {
  RECORD_TYPES: ["ncr", "rfi", "ipc", "task"],
  ATTACHMENT_ROLES: ["attachment", "evidence", "photo", "reference"],
  moduleForRecordType: (recordType) => {
    const map = { ncr: "ncr", rfi: "rfi", ipc: "ipc", task: "task" };
    if (!map[recordType]) {
      const { HttpError } = require("../../utils/http-error");
      throw new HttpError(400, "ATTACHMENT_RECORD_TYPE_INVALID", "bad type");
    }
    return map[recordType];
  },
  createAttachments: jest.fn(),
  parseDocumentIds: (value) => (Array.isArray(value) ? value : value ? [value] : []),
  listAttachments: jest.fn(),
  getAttachment: jest.fn(),
  deleteAttachment: jest.fn(),
  getDocumentFile: jest.fn(),
  listPhotos: jest.fn(),
  updatePhoto: jest.fn(),
  getPhotoFile: jest.fn(),
};
jest.mock("../../services/attachment.service", () => mockService);
jest.mock("../../services/document-text.service", () => ({ recordVisibleToViewer: jest.fn(async () => true), documentReadableToViewer: jest.fn(async () => true) }));

const attachmentsRouter = require("../attachments");
const photosRouter = require("../photos");

const ATTACHMENT_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "22222222-2222-4222-8222-222222222222";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/attachments", attachmentsRouter);
  app.use("/projects/:projectId/photos", photosRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message },
    }),
  );
  return app;
};

describe("attachment routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.listAttachments.mockResolvedValue({ items: [] });
    mockService.createAttachments.mockResolvedValue({ items: [{ id: ATTACHMENT_ID }] });
    mockService.deleteAttachment.mockResolvedValue({ deleted: true });
    mockService.getAttachment.mockResolvedValue({ id: ATTACHMENT_ID, recordType: "ipc" });
    mockService.listPhotos.mockResolvedValue({ items: [], pagination: {}, summary: {} });
    mockService.updatePhoto.mockResolvedValue({ id: PHOTO_ID });
  });

  it("reads attachments with the record module's read permission", async () => {
    const app = buildApp();
    const ok = await request(app)
      .get("/projects/project-1/attachments?recordType=ncr&recordId=ncr-1")
      .set("x-role", "warehouse");
    expect(ok.status).toBe(200);
    expect(mockService.listAttachments).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      projectId: "project-1",
      recordType: "ncr",
      recordId: "ncr-1",
      viewer: expect.any(Object),
    }));

    const bad = await request(app).get("/projects/project-1/attachments?recordType=invoice");
    expect(bad.status).toBe(400);
  });

  it("requires a write permission on the record module to attach or unlink", async () => {
    const app = buildApp();

    // site engineers may submit NCRs → may attach evidence
    const attached = await request(app)
      .post("/projects/project-1/attachments")
      .set("x-role", "site_engineer")
      .field("recordType", "ncr")
      .field("recordId", "ncr-1")
      .field("role", "evidence")
      .attach("files", Buffer.from("fake"), { filename: "photo.jpg", contentType: "image/jpeg" });
    expect(attached.status).toBe(201);
    expect(mockService.createAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: "ncr",
        recordId: "ncr-1",
        role: "evidence",
        files: expect.arrayContaining([expect.objectContaining({ originalname: "photo.jpg" })]),
      }),
    );

    // …but not on IPCs, which warehouse/site roles cannot touch
    const denied = await request(app)
      .post("/projects/project-1/attachments")
      .set("x-role", "site_engineer")
      .field("recordType", "ipc")
      .field("recordId", "ipc-1");
    expect(denied.status).toBe(403);
    expect(mockService.createAttachments).toHaveBeenCalledTimes(1);

    const unlinkDenied = await request(app)
      .delete(`/projects/project-1/attachments/${ATTACHMENT_ID}`)
      .set("x-role", "site_engineer");
    expect(unlinkDenied.status).toBe(403);
    expect(mockService.deleteAttachment).not.toHaveBeenCalled();

    // a QS may update IPCs → may unlink IPC attachments
    const unlinked = await request(app)
      .delete(`/projects/project-1/attachments/${ATTACHMENT_ID}`)
      .set("x-role", "qs");
    expect(unlinked.status).toBe(200);
    expect(mockService.deleteAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: ATTACHMENT_ID, userRole: "qs" }),
    );
  });

  it("serves the gallery to readers and edits to document creators", async () => {
    const app = buildApp();
    const list = await request(app)
      .get("/projects/project-1/photos?tag=concrete&limit=20")
      .set("x-role", "finance");
    expect(list.status).toBe(200);
    expect(mockService.listPhotos).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ tag: "concrete", limit: 20 }) }),
    );

    const denied = await request(app)
      .patch(`/projects/project-1/photos/${PHOTO_ID}`)
      .set("x-role", "finance")
      .send({ caption: "x" });
    expect(denied.status).toBe(403);

    const updated = await request(app)
      .patch(`/projects/project-1/photos/${PHOTO_ID}`)
      .set("x-role", "site_engineer")
      .send({ caption: "Grid B3", tags: ["concrete"] });
    expect(updated.status).toBe(200);
    expect(mockService.updatePhoto).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: PHOTO_ID, payload: { caption: "Grid B3", tags: ["concrete"] } }),
    );

    const badDate = await request(app).get("/projects/project-1/photos?from=not-a-date");
    expect(badDate.status).toBe(400);
  });
});

describe("Phase 21D — integrity (release challenge, fourteenth pass)", () => {
  const docText = require("../../services/document-text.service");
  const DOC = "33333333-3333-4333-8333-333333333333";
  beforeEach(() => {
    jest.clearAllMocks();
    docText.recordVisibleToViewer.mockResolvedValue(true);
    docText.documentReadableToViewer.mockResolvedValue(true);
    mockService.parseDocumentIds = (value) => (Array.isArray(value) ? value : value ? [value] : []);
    mockService.listAttachments.mockResolvedValue({ items: [] });
    mockService.getAttachment.mockResolvedValue({ id: ATTACHMENT_ID, recordType: "rfi", recordId: "rfi-1" });
    mockService.deleteAttachment.mockResolvedValue({ deleted: true });
    mockService.createAttachments.mockResolvedValue({ items: [] });
    mockService.getDocumentFile.mockResolvedValue({ redirectUrl: "https://x/y" });
  });

  it("CX21-551: a record the viewer's rule excludes hides its attachment list and its download, and the list is scoped to the viewer", async () => {
    const app = buildApp();
    docText.recordVisibleToViewer.mockResolvedValue(false);
    expect((await request(app).get(`/projects/project-1/attachments?recordType=rfi&recordId=rfi-b`).set("x-role", "pm")).status).toBe(404);
    expect(mockService.listAttachments).not.toHaveBeenCalled();
    docText.documentReadableToViewer.mockResolvedValue(false);
    expect((await request(app).get(`/projects/project-1/attachments/documents/${DOC}`).set("x-role", "pm")).status).toBe(404);
    expect(mockService.getDocumentFile).not.toHaveBeenCalled();
    // a visible record passes and the list is called with a viewer
    docText.recordVisibleToViewer.mockResolvedValue(true);
    expect((await request(app).get(`/projects/project-1/attachments?recordType=rfi&recordId=rfi-a`).set("x-role", "pm")).status).toBe(200);
    expect(mockService.listAttachments).toHaveBeenCalledWith(expect.objectContaining({ viewer: expect.any(Object) }));
  });

  it("CX21-552: linking pulls in only documents the viewer may see, and unlinking checks the record", async () => {
    const app = buildApp();
    docText.documentReadableToViewer.mockResolvedValue(false);
    const link = await request(app).post(`/projects/project-1/attachments`).set("x-role", "pm").field("recordType", "rfi").field("recordId", "rfi-a").field("documentIds", DOC);
    expect(link.status).toBe(404);
    expect(mockService.createAttachments).not.toHaveBeenCalled();
    docText.recordVisibleToViewer.mockResolvedValue(false);
    expect((await request(app).delete(`/projects/project-1/attachments/${ATTACHMENT_ID}`).set("x-role", "pm")).status).toBe(404);
    expect(mockService.deleteAttachment).not.toHaveBeenCalled();
  });
});
