const fs = require("fs");
const os = require("os");
const path = require("path");

const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(),
  projectDocument: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  documentText: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  },
  documentChunk: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};
const mockFileStorage = {
  DOCUMENT_TYPES: { SITE_PHOTO: "site_photo", WORKFLOW_ATTACHMENT: "workflow_attachment" },
  getProjectDocumentFile: jest.fn(),
};
const mockJobs = {
  JOB_TYPES: { DOCUMENT_EXTRACT: "document.extract" },
  enqueueJob: jest.fn(async () => ({ id: "job-1" })),
};
const mockEmbeddings = {
  isEnabled: jest.fn(() => false),
  describe: jest.fn(() => ({ enabled: false })),
  embedTexts: jest.fn(),
  embedQuery: jest.fn(),
  cosineSimilarity: jest.fn(() => 0),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../file-storage.service", () => mockFileStorage);
jest.mock("../../jobs/job.service", () => mockJobs);
jest.mock("../embedding.service", () => mockEmbeddings);
jest.mock("../attachment.service", () => ({
  RECORD_TYPE_MODULES: { rfi: "rfi", ipc: "ipc", ncr: "ncr" },
}));

const service = require("../document-text.service");

const ORG = "org-1";
const PROJECT = "project-1";
const DOC_ID = "11111111-1111-4111-8111-111111111111";

const textDocument = (overrides = {}) => ({
  id: DOC_ID,
  orgId: ORG,
  projectId: PROJECT,
  documentType: "workflow_attachment",
  mimeType: "text/plain",
  fileName: "method-statement.txt",
  originalName: "Method Statement.txt",
  sizeBytes: 120,
  uploadedAt: new Date("2026-09-05T08:00:00Z"),
  status: "available",
  documentRevisions: [],
  attachments: [],
  text: null,
  ...overrides,
});

describe("document text service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbeddings.isEnabled.mockReturnValue(false);
    mockEmbeddings.describe.mockReturnValue({ enabled: false });
    mockPrisma.documentText.upsert.mockImplementation(({ create, update }) =>
      Promise.resolve({ id: "text-1", documentId: DOC_ID, ...create, ...update }),
    );
    mockPrisma.documentText.update.mockResolvedValue({});
    mockPrisma.documentChunk.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.documentChunk.createMany.mockResolvedValue({ count: 1 });
  });

  describe("enqueueExtraction", () => {
    it("queues text-bearing documents and marks images unsupported without a job", async () => {
      mockPrisma.projectDocument.findFirst.mockResolvedValue(textDocument());
      mockPrisma.documentText.findUnique.mockResolvedValue(null);
      const queued = await service.enqueueExtraction({ orgId: ORG, projectId: PROJECT, documentId: DOC_ID, requestedBy: "user-1" });
      expect(queued).toEqual({ queued: true, status: "pending", jobId: "job-1" });
      expect(mockJobs.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: "document.extract", payload: { documentId: DOC_ID, force: false } }),
      );

      mockPrisma.projectDocument.findFirst.mockResolvedValue(
        textDocument({ mimeType: "image/jpeg", fileName: "site.jpg" }),
      );
      const image = await service.enqueueExtraction({ orgId: ORG, projectId: PROJECT, documentId: DOC_ID });
      expect(image.queued).toBe(false);
      expect(image.status).toBe("unsupported");
      expect(mockJobs.enqueueJob).toHaveBeenCalledTimes(1);
    });

    it("does not re-queue an indexed document unless forced", async () => {
      mockPrisma.projectDocument.findFirst.mockResolvedValue(textDocument());
      mockPrisma.documentText.findUnique.mockResolvedValue({ status: "ready" });
      expect(await service.enqueueExtraction({ orgId: ORG, projectId: PROJECT, documentId: DOC_ID })).toEqual({
        queued: false,
        status: "ready",
        jobId: null,
      });
      const forced = await service.enqueueExtraction({ orgId: ORG, projectId: PROJECT, documentId: DOC_ID, force: true });
      expect(forced.queued).toBe(true);
      expect(mockJobs.enqueueJob).toHaveBeenLastCalledWith(
        expect.objectContaining({ payload: { documentId: DOC_ID, force: true } }),
      );
    });
  });

  describe("runDocumentExtractJob", () => {
    it("extracts a local file, stores text and chunks, and records the embedding state", async () => {
      const tmp = path.join(os.tmpdir(), `octapm-doc-text-${Date.now()}.txt`);
      fs.writeFileSync(tmp, "Concrete shall be cured for seven days.\n\nFormwork removal after 3 days.");
      mockPrisma.projectDocument.findFirst.mockResolvedValue(textDocument());
      mockFileStorage.getProjectDocumentFile.mockResolvedValue({ path: tmp });
      const updateProgress = jest.fn();

      const result = await service.runDocumentExtractJob({
        job: { id: "job-1", orgId: ORG },
        payload: { documentId: DOC_ID },
        updateProgress,
      });
      fs.unlinkSync(tmp);

      expect(result).toMatchObject({ documentId: DOC_ID, status: "ready", extractor: "text", chunkCount: 1, embeddingStatus: "disabled" });
      expect(mockPrisma.documentText.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { documentId: DOC_ID },
          update: expect.objectContaining({
            status: "ready",
            text: "Concrete shall be cured for seven days.\n\nFormwork removal after 3 days.",
            wordCount: 12,
            chunkCount: 1,
          }),
        }),
      );
      expect(mockPrisma.documentChunk.deleteMany).toHaveBeenCalledWith({ where: { documentId: DOC_ID } });
      expect(mockPrisma.documentChunk.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ documentId: DOC_ID, documentTextId: "text-1", index: 0, charStart: 0 }),
        ],
      });
      expect(mockPrisma.documentText.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ embeddingStatus: "disabled" }) }),
      );
      expect(updateProgress).toHaveBeenLastCalledWith({ step: "done", progress: 100 });
    });

    it("embeds chunks when a provider is configured and keeps text on embedding failure", async () => {
      mockPrisma.projectDocument.findFirst.mockResolvedValue(textDocument());
      mockFileStorage.getProjectDocumentFile.mockResolvedValue({ redirectUrl: "https://files.example/doc.txt" });
      global.fetch = jest.fn(async () => ({
        ok: true,
        arrayBuffer: async () => Buffer.from("Rebar spacing 200mm").buffer,
      }));
      mockEmbeddings.isEnabled.mockReturnValue(true);
      mockEmbeddings.describe.mockReturnValue({ enabled: true, provider: "openai", model: "text-embedding-3-small" });
      mockEmbeddings.embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);

      const ready = await service.runDocumentExtractJob({ job: { orgId: ORG }, payload: { documentId: DOC_ID } });
      expect(ready.embeddingStatus).toBe("ready");
      expect(mockPrisma.documentChunk.update).toHaveBeenCalledWith({
        where: { documentId_index: { documentId: DOC_ID, index: 0 } },
        data: { embedding: [0.1, 0.2, 0.3] },
      });

      mockEmbeddings.embedTexts.mockRejectedValue(new Error("rate limited"));
      const failed = await service.runDocumentExtractJob({ job: { orgId: ORG }, payload: { documentId: DOC_ID } });
      expect(failed.status).toBe("ready");
      expect(failed.embeddingStatus).toBe("failed");
      expect(mockPrisma.documentText.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ embeddingStatus: "failed", embeddingError: "rate limited" }) }),
      );
      delete global.fetch;
    });

    it("marks scanned PDFs unsupported with the reason and clears old chunks", async () => {
      mockPrisma.projectDocument.findFirst.mockResolvedValue(
        textDocument({ mimeType: "application/pdf", fileName: "scan.pdf" }),
      );
      const tmp = path.join(os.tmpdir(), `octapm-doc-text-${Date.now()}.pdf`);
      fs.writeFileSync(
        tmp,
        "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>",
      );
      mockFileStorage.getProjectDocumentFile.mockResolvedValue({ path: tmp });
      const result = await service.runDocumentExtractJob({ job: { orgId: ORG }, payload: { documentId: DOC_ID } });
      fs.unlinkSync(tmp);
      expect(result).toEqual({ documentId: DOC_ID, status: "unsupported", reason: "no_text_layer" });
      expect(mockPrisma.documentText.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ status: "unsupported", error: "no_text_layer", pageCount: 1 }) }),
      );
      expect(mockPrisma.documentChunk.deleteMany).toHaveBeenCalled();
    });
  });

  describe("searchDocuments", () => {
    it("ranks full-text hits, hides documents the viewer cannot see, and links to records", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { documentId: DOC_ID, projectId: PROJECT, rank: 0.8, headline: "Rebar [[spacing]] shall be 200mm" },
        { documentId: "doc-ipc", projectId: PROJECT, rank: 0.4, headline: "[[spacing]] of payments" },
      ]);
      mockPrisma.projectDocument.findMany.mockResolvedValue([
        textDocument({
          documentRevisions: [
            { id: "rev-1", recordType: "rfi", recordId: "rfi-1", revision: "A", status: "approved", title: "Rebar RFI", documentNumber: "RFI-012", folderPath: "/RFI", isLatest: true },
          ],
          text: { status: "ready", extractor: "pdf", wordCount: 300, pageCount: 2, excerpt: "Rebar…", embeddingStatus: "disabled" },
        }),
        textDocument({
          id: "doc-ipc",
          fileName: "ipc-3.pdf",
          attachments: [{ recordType: "ipc", recordId: "ipc-3", role: "attachment" }],
        }),
      ]);
      const viewer = { canRead: (moduleName) => moduleName !== "ipc" };

      const result = await service.searchDocuments({ orgId: ORG, projectId: PROJECT, q: "spacing", viewer });
      expect(result.meta.mode).toBe("text");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          documentId: DOC_ID,
          title: "Rebar RFI",
          documentNumber: "RFI-012",
          snippet: "Rebar [[spacing]] shall be 200mm",
          snippetText: "Rebar spacing shall be 200mm",
          path: `/projects/${PROJECT}/doc-control/rfi?recordId=rfi-1&source=rfi`,
          fileUrl: `/api/v1/projects/${PROJECT}/attachments/documents/${DOC_ID}`,
          score: 1,
        }),
      );
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it("returns an empty result without querying when the term is blank", async () => {
      const result = await service.searchDocuments({ orgId: ORG, projectId: PROJECT, q: "   " });
      expect(result).toMatchObject({ query: null, items: [] });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("merges semantic matches when embeddings are enabled", async () => {
      mockEmbeddings.isEnabled.mockReturnValue(true);
      mockEmbeddings.describe.mockReturnValue({ enabled: true, provider: "openai", model: "m" });
      mockEmbeddings.embedQuery.mockResolvedValue([1, 0]);
      mockEmbeddings.cosineSimilarity.mockImplementation((_q, vector) => vector[0]);
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.documentChunk.findMany.mockResolvedValue([
        { documentId: DOC_ID, index: 0, text: "Curing regime for slabs", embedding: [0.9, 0] },
        { documentId: DOC_ID, index: 1, text: "Unrelated", embedding: [0.1, 0] },
      ]);
      mockPrisma.projectDocument.findMany.mockResolvedValue([textDocument()]);

      const result = await service.searchDocuments({ orgId: ORG, projectId: PROJECT, q: "how long to cure slabs", semantic: true });
      expect(result.meta.mode).toBe("hybrid");
      expect(result.items[0]).toEqual(
        expect.objectContaining({ documentId: DOC_ID, semanticScore: 0.9, matchedChunk: "Curing regime for slabs", score: 0.9 }),
      );
    });
  });

  describe("reindexProject / getIndexStatus", () => {
    it("queues missing documents, skips indexed ones, and counts unsupported files", async () => {
      mockPrisma.projectDocument.findMany.mockResolvedValue([
        textDocument({ id: "a", text: null }),
        textDocument({ id: "b", text: { status: "ready" } }),
        textDocument({ id: "c", mimeType: "application/zip", fileName: "model.zip", text: null }),
      ]);
      mockPrisma.documentText.findUnique.mockResolvedValue(null);
      const summary = await service.reindexProject({ orgId: ORG, projectId: PROJECT, requestedBy: "user-1" });
      expect(summary).toEqual({ total: 3, queued: 1, skipped: 1, unsupported: 1 });
      expect(mockJobs.enqueueJob).toHaveBeenCalledTimes(1);
      expect(mockJobs.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { documentId: "a", force: false } }));
    });

    it("summarises index coverage", async () => {
      mockPrisma.documentText.groupBy.mockResolvedValue([
        { status: "ready", _count: { _all: 4 } },
        { status: "unsupported", _count: { _all: 1 } },
      ]);
      mockPrisma.projectDocument.count.mockResolvedValue(7);
      expect(await service.getIndexStatus({ orgId: ORG, projectId: PROJECT })).toEqual({
        documents: 7,
        indexed: 5,
        notIndexed: 2,
        counts: { pending: 0, ready: 4, unsupported: 1, failed: 0 },
        embeddings: { enabled: false },
      });
    });
  });
});

describe("Phase 21D — integrity (release challenge, eleventh pass)", () => {
  it("CX21-522: a content hit is judged as the document itself would be — a document attached only to a record whose module the viewer may not read is not surfaced", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { documentId: "doc-rfi", projectId: "project-1", rank: 0.9, headline: "the [[slab]] opening" },
      { documentId: "doc-dc", projectId: "project-1", rank: 0.5, headline: "[[slab]] drawing" },
    ]);
    mockPrisma.projectDocument.findMany.mockResolvedValue([
      { id: "doc-rfi", projectId: "project-1", orgId: "org-1", originalName: "rfi-attachment.pdf", fileName: "rfi-attachment.pdf", mimeType: "application/pdf", uploadedAt: new Date(), text: null, documentRevisions: [], attachments: [{ recordType: "rfi", recordId: "rfi-1", role: "attachment" }] },
      { id: "doc-dc", projectId: "project-1", orgId: "org-1", originalName: "drawing.pdf", fileName: "drawing.pdf", mimeType: "application/pdf", uploadedAt: new Date(), text: null, documentRevisions: [{ id: "rev-1", recordType: "document_control", recordId: "d1", revision: "A", status: "issued", title: "Drawing", documentNumber: "DWG-1", folderPath: "/", isLatest: true }], attachments: [] },
    ]);
    const viewerFor = () => ({ canRead: (moduleName) => moduleName === "document_control" }); // RFIs refused
    const hits = await service.searchDocumentContent({ orgId: "org-1", projectIds: ["project-1"], q: "slab", viewerFor });
    expect(hits.map((hit) => hit.documentId ?? hit.id)).toEqual(["doc-dc"]);
    const everything = await service.searchDocumentContent({ orgId: "org-1", projectIds: ["project-1"], q: "slab", viewerFor: () => ({ canRead: () => true }) });
    expect(everything).toHaveLength(2);
  });
});
