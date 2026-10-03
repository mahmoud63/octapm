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
  // evidence filed by reference is a link the visibility rule reads (certification L2, L24)
  workflowAttachment: { findMany: jest.fn(async () => []) },
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
  // commitment and sub_pay_app as attachment.service maps them: an executed agreement and a lien waiver are read under them (certification L24)
  RECORD_TYPE_MODULES: { rfi: "rfi", ipc: "ipc", ncr: "ncr", commitment: "commitment", sub_pay_app: "sub_pay_app" },
}));
// the writer of a link, rebuilt as a route would judge them (certification R29)
const mockMembership = { resolveRequestPrincipal: jest.fn() };
const mockProjectAccess = { requestForProject: jest.fn() };
const mockRbac = { hasPermission: jest.fn() };
jest.mock("../membership.service", () => mockMembership);
jest.mock("../../middleware/project-access", () => mockProjectAccess);
jest.mock("../../middleware/rbac", () => mockRbac);

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
        arrayBuffer: async () => Uint8Array.from(Buffer.from("Rebar spacing 200mm")).buffer,
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

describe("Phase 21D — integrity (release challenge, twelfth pass)", () => {
  afterEach(() => { delete mockPrisma.rfi; });

  it("CX21-530: a party-scoped viewer reaches a document through the records routed to its party only — the visibility rule, the content search and the text endpoint agree", async () => {
    const doc = { id: "doc-rfi", projectId: "project-1", orgId: "org-1", originalName: "x.pdf", fileName: "x.pdf", mimeType: "application/pdf", uploadedAt: new Date(), text: null, documentRevisions: [], attachments: [{ recordType: "rfi", recordId: "rfi-b", role: "attachment" }] };
    const partyViewer = { canRead: () => true, partyIds: ["party-a"] };
    mockPrisma.rfi = { findMany: jest.fn(async () => []) }; // routed to another party
    let partyVisible = await service.recordRuleVisibleIds({ documents: [doc], viewer: partyViewer });
    expect(service.documentVisible(doc, partyViewer, partyVisible)).toBe(false);
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["rfi-b"] }, OR: expect.any(Array) }) }));
    mockPrisma.rfi.findMany.mockResolvedValue([{ id: "rfi-b" }]); // routed to this party
    partyVisible = await service.recordRuleVisibleIds({ documents: [doc], viewer: partyViewer });
    expect(service.documentVisible(doc, partyViewer, partyVisible)).toBe(true);
    // a viewer that is not party-scoped is judged by modules alone for a routed record, as before
    const staff = { canRead: () => true };
    const staffRuled = await service.recordRuleVisibleIds({ documents: [doc], viewer: staff });
    expect(staffRuled.size).toBe(0);
    expect(service.documentVisible(doc, staff, staffRuled)).toBe(true);
    // the content search and the text endpoint take the same answer
    mockPrisma.rfi.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([{ documentId: "doc-rfi", projectId: "project-1", rank: 1, headline: "x" }]);
    mockPrisma.projectDocument.findMany.mockResolvedValue([doc]);
    expect(await service.searchDocumentContent({ orgId: "org-1", projectIds: ["project-1"], q: "x", viewerFor: () => partyViewer })).toHaveLength(0);
    expect(await service.searchDocumentContent({ orgId: "org-1", projectIds: ["project-1"], q: "x", viewerFor: () => staff })).toHaveLength(1);
    mockPrisma.projectDocument.findFirst.mockResolvedValue({ ...doc, text: null });
    await expect(service.getDocumentText({ orgId: "org-1", projectId: "project-1", documentId: "doc-rfi", viewer: partyViewer })).rejects.toMatchObject({ status: 403 });
  });
});

describe("Phase 21D — integrity (release challenge, thirteenth pass)", () => {
  afterEach(() => { delete mockPrisma.timesheet; delete mockPrisma.task; delete mockPrisma.conversation; delete mockPrisma.rfi; });
  const link = (recordType, recordId) => ({ recordType, recordId, role: "attachment" });
  const docWith = (attachments, id = "doc-x") => ({ id, projectId: "project-1", orgId: "org-1", originalName: "x.pdf", fileName: "x.pdf", mimeType: "application/pdf", uploadedAt: new Date(), text: null, documentRevisions: [], attachments });

  it("CX21-540: a party-scoped viewer reaches a document through a company-attributed or personal record only under that record's own rule — another company's timesheet and someone else's task are withheld; a conversation's attachments are its members' for everyone", async () => {
    const party = { canRead: () => true, partyIds: ["party-a"], companyIds: ["co-a"], userId: "sub-1" };
    mockPrisma.timesheet = { findMany: jest.fn(async () => []) };
    const ts = docWith([link("timesheet", "ts-b")]);
    let ruled = await service.recordRuleVisibleIds({ documents: [ts], viewer: party });
    expect(service.documentVisible(ts, party, ruled)).toBe(false);
    expect(mockPrisma.timesheet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["ts-b"] }, OR: expect.arrayContaining([{ companyId: { in: ["co-a"] } }, { createdBy: "sub-1" }]) }) }));
    mockPrisma.timesheet.findMany.mockResolvedValue([{ id: "ts-b" }]);
    ruled = await service.recordRuleVisibleIds({ documents: [ts], viewer: party });
    expect(service.documentVisible(ts, party, ruled)).toBe(true);
    // someone else's task
    mockPrisma.task = { findMany: jest.fn(async () => []) };
    const task = docWith([link("task", "task-9")]);
    expect(service.documentVisible(task, party, await service.recordRuleVisibleIds({ documents: [task], viewer: party }))).toBe(false);
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ assigneeId: "sub-1" }, { createdById: "sub-1" }] }) }));
    // a member of the project is judged by modules for those
    const staff = { canRead: () => true, userId: "pm-1" };
    expect(service.documentVisible(ts, staff, await service.recordRuleVisibleIds({ documents: [ts], viewer: staff }))).toBe(true);
    // a conversation's attachments are its members' — for the member too
    mockPrisma.conversation = { findMany: jest.fn(async () => []) };
    const chat = docWith([link("conversation", "conv-1")]);
    expect(service.documentVisible(chat, staff, await service.recordRuleVisibleIds({ documents: [chat], viewer: staff }))).toBe(false);
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["conv-1"] }, OR: [{ members: { some: { userId: "pm-1", leftAt: null } } }] }) }));
    mockPrisma.conversation.findMany.mockResolvedValue([{ id: "conv-1" }]);
    expect(service.documentVisible(chat, staff, await service.recordRuleVisibleIds({ documents: [chat], viewer: staff }))).toBe(true);
    // the text endpoint agrees
    mockPrisma.timesheet.findMany.mockResolvedValue([]);
    mockPrisma.projectDocument.findFirst.mockResolvedValue({ ...ts, text: null });
    await expect(service.getDocumentText({ orgId: "org-1", projectId: "project-1", documentId: ts.id, viewer: party })).rejects.toMatchObject({ status: 403 });
  });

  it("the note on CX21-530: every link is read — an accessible RFI link after ten routed elsewhere is not lost, and the search loads them all", async () => {
    const party = { canRead: () => true, partyIds: ["party-a"], companyIds: [], userId: "sub-1" };
    const links = [...Array.from({ length: 10 }, (_, i) => link("rfi", `rfi-away-${i}`)), link("rfi", "rfi-mine")];
    mockPrisma.rfi = { findMany: jest.fn(async ({ where }) => (where.id.in.includes("rfi-mine") ? [{ id: "rfi-mine" }] : [])) };
    const doc = docWith(links, "doc-eleven");
    expect(service.documentVisible(doc, party, await service.recordRuleVisibleIds({ documents: [doc], viewer: party }))).toBe(true);
    mockPrisma.$queryRaw.mockResolvedValue([{ documentId: "doc-eleven", projectId: "project-1", rank: 1, headline: "x" }]);
    mockPrisma.projectDocument.findMany.mockResolvedValue([doc]);
    const hits = await service.searchDocumentContent({ orgId: "org-1", projectIds: ["project-1"], q: "x", viewerFor: () => party });
    expect(hits).toHaveLength(1);
    expect(mockPrisma.projectDocument.findMany.mock.calls.at(-1)[0].include.attachments.take).toBeUndefined();
    // the returned records do not disclose the ten inaccessible links, only the accessible one (thirteenth-pass note)
    expect(hits[0].records.map((record) => record.recordId)).toEqual(["rfi-mine"]);
  });
});

describe("Phase 21D — integrity (release challenge, fourteenth pass)", () => {
  afterEach(() => { delete mockPrisma.commitmentChangeOrder; });
  it("CX21-550: a change order's attachment follows the parent commitment's rule, not the change order's own createdBy", async () => {
    const doc = { id: "doc-cco", projectId: "project-1", orgId: "org-1", originalName: "co.pdf", fileName: "co.pdf", mimeType: "application/pdf", uploadedAt: new Date(), text: null, documentRevisions: [], attachments: [{ recordType: "commitment_change_order", recordId: "cco-b", role: "attachment" }] };
    const party = { canRead: () => true, partyIds: ["party-a"], companyIds: ["co-a"], userId: "u" };
    mockPrisma.commitmentChangeOrder = { findMany: jest.fn(async () => []) }; // parent belongs to another company
    expect(service.documentVisible(doc, party, await service.recordRuleVisibleIds({ documents: [doc], viewer: party }))).toBe(false);
    // the query asks the parent commitment's rule (vendor company or its creator), not the change order's own createdBy
    expect(mockPrisma.commitmentChangeOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["cco-b"] }, OR: [{ commitment: { OR: [{ vendorCompanyId: { in: ["co-a"] } }, { createdBy: "u" }] } }] } }));
    mockPrisma.commitmentChangeOrder.findMany.mockResolvedValue([{ id: "cco-b" }]); // parent is the party's
    expect(service.documentVisible(doc, party, await service.recordRuleVisibleIds({ documents: [doc], viewer: party }))).toBe(true);
  });
});

describe("certification L2, L23, L24 — every place a document is filed is a link to its record", () => {
  afterEach(() => {
    delete mockPrisma.commitment;
    delete mockPrisma.rfi;
    delete mockPrisma.photo;
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([]);
  });
  const doc = (over = {}) => ({ id: "doc-1", projectId: "project-1", orgId: "org-1", storageKey: "key-1", documentType: "workflow_attachment", originalName: "x.pdf", fileName: "x.pdf", mimeType: "application/pdf", uploadedAt: new Date(), text: null, documentRevisions: [], attachments: [], ...over });
  const staff = (modules) => ({ userId: "u-1", canRead: (moduleName) => modules.includes(moduleName) });
  const party = { userId: "sub-b", canRead: () => true, partyIds: ["party-b"], companyIds: ["co-b"] };

  it("L24: a file of a tool of its own follows that tool — the uploaded bill needs the BOQ, a generation source the schedule and the BOQ", () => {
    const bill = doc({ documentType: "boq_upload" });
    expect(service.documentVisible(bill, staff(["document_control"]), new Set())).toBe(false);
    expect(service.documentVisible(bill, staff(["boq"]), new Set())).toBe(true);
    const source = doc({ documentType: "schedule_generation_source" });
    expect(service.documentVisible(source, staff(["schedule", "document_control"]), new Set())).toBe(false);
    expect(service.documentVisible(source, staff(["schedule", "boq"]), new Set())).toBe(true);
  });

  it("L24: an executed agreement follows its commitment — the module, and the vendor rule for a party; a file linked from nowhere stays under document control", async () => {
    const agreement = doc({ commitmentsExecuted: [{ id: "c-1" }] });
    expect(service.documentVisible(agreement, staff(["document_control"]), new Set())).toBe(false);
    expect(service.documentVisible(agreement, staff(["commitment"]), new Set())).toBe(true);
    mockPrisma.commitment = { findMany: jest.fn(async () => []) }; // another vendor's
    expect(service.documentVisible(agreement, party, await service.recordRuleVisibleIds({ documents: [agreement], viewer: party }))).toBe(false);
    expect(mockPrisma.commitment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["c-1"] }, OR: expect.arrayContaining([{ vendorCompanyId: { in: ["co-b"] } }]) }) }));
    mockPrisma.commitment.findMany.mockResolvedValue([{ id: "c-1" }]); // the party's own company is the vendor
    expect(service.documentVisible(agreement, party, await service.recordRuleVisibleIds({ documents: [agreement], viewer: party }))).toBe(true);
    expect(service.documentVisible(doc(), staff(["document_control"]), new Set())).toBe(true);
    expect(service.documentVisible(doc(), staff(["commitment"]), new Set())).toBe(false);
  });

  it("L24: a lien waiver, commercial evidence and the document's own pointer are links; the pointer does not repeat a link a table gives", () => {
    const waiver = doc({ subPayAppWaivers: [{ id: "spa-1" }] });
    expect(service.documentVisible(waiver, staff(["document_control"]), new Set())).toBe(false);
    expect(service.documentVisible(waiver, staff(["sub_pay_app"]), new Set())).toBe(true);
    const evidence = doc({ commercialAttachmentRefs: [{ recordType: "eot_claim", recordId: "eot-1" }] });
    expect(service.documentVisible(evidence, staff(["document_control"]), new Set())).toBe(false);
    expect(service.documentVisible(evidence, staff(["eot"]), new Set())).toBe(true);
    const pointed = doc({ linkedEntityType: "ncr", linkedEntityId: "ncr-1" }); // e.g. a photo filed on a record by its pointer only
    expect(service.documentVisible(pointed, staff(["document_control"]), new Set())).toBe(false);
    expect(service.documentVisible(pointed, staff(["ncr"]), new Set())).toBe(true);
    expect(service.documentLinks(doc({ linkedEntityType: "rfi", linkedEntityId: "r-1", documentRevisions: [{ recordType: "rfi", recordId: "r-1" }] }))).toEqual([
      { recordType: "rfi", recordId: "r-1", modules: ["document_control", "rfi"] },
    ]);
  });

  it("L23: a document-control revision follows its record — the RFI's routing for a party, the RFI's module besides document control", async () => {
    const revisionDoc = doc({ documentRevisions: [{ id: "rev-1", recordType: "rfi", recordId: "rfi-x", revision: "A", isLatest: false }] });
    mockPrisma.rfi = { findMany: jest.fn(async () => []) }; // routed to other parties
    expect(service.documentVisible(revisionDoc, party, await service.recordRuleVisibleIds({ documents: [revisionDoc], viewer: party }))).toBe(false);
    mockPrisma.rfi.findMany.mockResolvedValue([{ id: "rfi-x" }]); // routed to the reader's party
    expect(service.documentVisible(revisionDoc, party, await service.recordRuleVisibleIds({ documents: [revisionDoc], viewer: party }))).toBe(true);
    // a member is judged by the RFI's draft rule (R35): the RFI is not someone else's draft here
    const member = staff(["document_control", "rfi"]);
    const memberRuled = await service.recordRuleVisibleIds({ documents: [revisionDoc], viewer: member });
    expect(service.documentVisible(revisionDoc, staff(["document_control"]), memberRuled)).toBe(false);
    expect(service.documentVisible(revisionDoc, member, memberRuled)).toBe(true);
  });

  it("R35: a file on someone else's draft RFI is withheld from every member, as GET /rfi withholds the draft; its author and manager keep it", async () => {
    const draftDoc = doc({ attachments: [{ recordType: "rfi", recordId: "rfi-d", role: "attachment" }] });
    const member = staff(["document_control", "rfi"]);
    mockPrisma.rfi = { findMany: jest.fn(async () => []) }; // a colleague's draft
    expect(service.documentVisible(draftDoc, member, await service.recordRuleVisibleIds({ documents: [draftDoc], viewer: member }))).toBe(false);
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["rfi-d"] }, OR: [{ status: { not: "draft" } }, { createdBy: "u-1" }, { managerUserId: "u-1" }] },
    }));
    mockPrisma.rfi.findMany.mockResolvedValue([{ id: "rfi-d" }]); // the member's own draft, or one no longer a draft
    expect(service.documentVisible(draftDoc, member, await service.recordRuleVisibleIds({ documents: [draftDoc], viewer: member }))).toBe(true);
    // a party guest is held to both the routing and the draft rule
    mockPrisma.rfi.findMany.mockClear();
    await service.recordRuleVisibleIds({ documents: [draftDoc], viewer: party });
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["rfi-d"] }, AND: [expect.objectContaining({ OR: expect.arrayContaining([{ ownerPartyId: { in: ["party-b"] } }]) }), { OR: [{ status: { not: "draft" } }, { createdBy: "sub-b" }, { managerUserId: "sub-b" }] }] },
    }));
  });

  it("R34: the WorkflowAttachment row filed with a revision is read under the revision's modules, not the record's alone", () => {
    const filed = doc({
      documentRevisions: [{ id: "rev-1", recordType: "rfi", recordId: "rfi-x" }],
      workflowAttachments: [{ projectId: "project-1", recordType: "rfi", recordId: "rfi-x", storageKey: "doc-1" }],
    });
    expect(service.documentLinks(filed).map((link) => link.modules)).toEqual([["document_control", "rfi"], ["document_control", "rfi"]]);
    const rfiOnly = { canRead: (moduleName) => moduleName === "rfi" };
    expect(service.documentVisible(filed, rfiOnly, null)).toBe(false);
    // evidence on another record keeps its own module
    const evidence = doc({ workflowAttachments: [{ projectId: "project-1", recordType: "ncr", recordId: "ncr-1", storageKey: "doc-1" }] });
    expect(service.documentLinks(evidence)).toEqual([{ recordType: "ncr", recordId: "ncr-1", modules: ["ncr"] }]);
  });

  it("R38: a hit and the text endpoint describe only the revision and the links this viewer may see", async () => {
    const shared = doc({
      documentRevisions: [
        { id: "rev-foreign", recordType: "rfi", recordId: "rfi-foreign", revision: "A", isLatest: true, title: "Foreign title", documentNumber: "F-1" },
        { id: "rev-own", recordType: "rfi", recordId: "rfi-own", revision: "B", isLatest: false, title: "Own title", documentNumber: "O-1" },
      ],
      attachments: [{ recordType: "commitment", recordId: "c-foreign", role: "attachment" }, { recordType: "rfi", recordId: "rfi-own", role: "attachment" }],
    });
    const ruled = new Set(["rfi:rfi-own"]);
    const hit = service.serializeHit({ document: shared, viewer: party, ruled });
    expect(hit.revision.id).toBe("rev-own");
    expect(hit.title).toBe("Own title");
    expect(hit.records.map((row) => row.recordId)).toEqual(["rfi-own"]);
    expect(JSON.stringify(hit)).not.toContain("rfi-foreign");
    expect(JSON.stringify(hit)).not.toContain("c-foreign");
    const everything = service.serializeHit({ document: shared });
    expect(everything.revision.id).toBe("rev-foreign");
    // the text endpoint judges with the viewer too
    mockPrisma.projectDocument.findFirst = jest.fn(async () => ({ ...shared, text: null }));
    mockPrisma.rfi = { findMany: jest.fn(async () => [{ id: "rfi-own" }]) };
    mockPrisma.commitment = { findMany: jest.fn(async () => []) };
    const text = await service.getDocumentText({ orgId: "org-1", projectId: "project-1", documentId: "doc-1", viewer: party });
    expect(text.document.revision.id).toBe("rev-own");
    expect(text.document.records.map((row) => row.recordId)).toEqual(["rfi-own"]);
  });

  it("L2/L24: evidence filed by reference (WorkflowAttachment) is found by the document's id or storage key and follows its record", async () => {
    mockPrisma.projectDocument.findMany.mockResolvedValue([doc()]);
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([{ projectId: "project-1", recordType: "ncr", recordId: "ncr-1", storageKey: "key-1" }]);
    const scope = { orgId: "org-1", projectId: "project-1" };
    expect((await service.readableDocumentIds({ ...scope, documentIds: ["doc-1"], viewer: staff(["document_control"]) })).has("doc-1")).toBe(false);
    expect(mockPrisma.workflowAttachment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: { in: ["project-1"] }, storageKey: { in: ["doc-1", "key-1"] } } }));
    expect(await service.documentReadableToViewer({ ...scope, documentId: "doc-1", viewer: staff(["ncr"]) })).toBe(true);
    expect(await service.documentReadableToViewer({ ...scope, documentId: "doc-1", viewer: staff(["document_control"]) })).toBe(false);
  });

  it("L2: a job on a document the viewer may not read comes without its payload and result; a job on a readable one and other jobs are untouched", async () => {
    mockPrisma.photo = { findMany: jest.fn(async () => [{ id: "photo-1", documentId: "doc-2" }]) };
    mockPrisma.projectDocument.findMany.mockResolvedValue([doc(), doc({ id: "doc-2", storageKey: "key-2", attachments: [{ recordType: "ncr", recordId: "n-1", role: "photo" }] })]);
    const jobs = [
      { id: "j1", type: "document.extract", payload: { documentId: "doc-1", force: false }, result: { status: "ready" }, error: null },
      { id: "j2", type: "photo.thumbnail", payload: { photoId: "photo-1" }, result: { thumbnailDocumentId: "t-1" }, error: { code: "X", message: "m", details: { documentId: "doc-2" } } },
      { id: "j3", type: "boq.parse", payload: { documentId: "doc-9" }, result: { rows: 3 }, error: null },
    ];
    const out = await service.withheldDocumentJobs({ orgId: "org-1", projectId: "project-1", jobs, viewer: staff(["document_control"]) });
    expect(out[0]).toBe(jobs[0]); // linked from nowhere: document control reads it
    expect(out[1]).toMatchObject({ id: "j2", payload: {}, result: null, error: { code: "X", details: null }, payloadWithheld: { keys: ["photoId"] } });
    expect(out[2]).toBe(jobs[2]); // not a document job
    expect(mockPrisma.photo.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["photo-1"] }, orgId: "org-1", projectId: "project-1" } }));
    const reader = await service.withheldDocumentJobs({ orgId: "org-1", projectId: "project-1", jobs, viewer: staff(["document_control", "ncr"]) });
    expect(reader[1]).toBe(jobs[1]);
  });
});

describe("certification R29 — a link names only a document its writer may read", () => {
  const VICTIM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const OWN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const KEPT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const refuse = () => Object.assign(new Error("not found"), { status: 404, code: "FILE_NOT_FOUND" });
  const stored = (over = {}) => ({ id: VICTIM, projectId: "project-1", orgId: "org-1", storageKey: `${VICTIM.slice(0, 8)}-0000-4000-8000-000000000000`, documentType: "workflow_attachment", uploadedBy: "pm-1", documentRevisions: [], attachments: [], ...over });
  const reader = (modules, over = {}) => ({ userId: "sub-1", canRead: (moduleName) => modules.includes(moduleName), ...over });
  const scope = { orgId: "org-1", projectId: "project-1", refuse };

  beforeEach(() => {
    mockPrisma.projectDocument.findMany.mockReset();
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([]);
    mockMembership.resolveRequestPrincipal.mockReset();
    mockProjectAccess.requestForProject.mockReset();
    mockRbac.hasPermission.mockReset();
  });
  afterEach(() => {
    delete mockPrisma.commitment;
    delete mockPrisma.project;
  });

  it("refuses a document linked only to a record the writer may not see, and passes one the writer may read", async () => {
    const victim = stored({ attachments: [{ recordType: "commitment", recordId: "c-other", role: "attachment" }] });
    mockPrisma.projectDocument.findMany.mockResolvedValue([victim]);
    mockPrisma.commitment = { findMany: jest.fn(async () => []) }; // another vendor's commitment
    const guest = reader(["commitment", "punch", "document_control"], { partyIds: ["party-y"], companyIds: ["co-y"] });
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [VICTIM], viewer: guest })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project-1", orgId: "org-1", OR: [{ id: { in: [VICTIM] } }, { storageKey: { in: [VICTIM] } }] } }));
    // the vendor's own guest may read it, so may link it
    mockPrisma.commitment.findMany.mockResolvedValue([{ id: "c-other" }]);
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [VICTIM], viewer: guest })).resolves.toBeUndefined();
  });

  it("a key naming no document of the project is refused as a forbidden one is; a legacy name or URL is not a document key", async () => {
    mockPrisma.projectDocument.findMany.mockResolvedValue([]);
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [VICTIM], viewer: reader(["document_control"]) })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    mockPrisma.projectDocument.findMany.mockClear();
    await expect(service.assertDocumentsLinkable({ ...scope, keys: ["legacy/mill-cert.pdf", "/api/v1/files/x.pdf"], viewer: reader([]) })).resolves.toBeUndefined();
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
  });

  it("what the record already names stays as it is, and is not looked up", async () => {
    const unchanged = jest.fn(async () => [KEPT]);
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [KEPT], unchanged, viewer: reader([]) })).resolves.toBeUndefined();
    expect(unchanged).toHaveBeenCalled();
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
  });

  it("the writer's own upload linked from nowhere is theirs to link; someone else's is not, unless the writer reads document control", async () => {
    mockPrisma.projectDocument.findMany.mockResolvedValue([stored({ id: OWN, storageKey: null, uploadedBy: "sub-1" })]);
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [OWN], viewer: reader(["punch"]) })).resolves.toBeUndefined();
    mockPrisma.projectDocument.findMany.mockResolvedValue([stored({ id: OWN, storageKey: null, uploadedBy: "pm-1" })]);
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [OWN], viewer: reader(["punch"]) })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [OWN], viewer: reader(["punch", "document_control"]) })).resolves.toBeUndefined();
  });

  it("when nobody can say who writes, only a document linked from nowhere may be named", async () => {
    mockPrisma.projectDocument.findMany.mockResolvedValue([stored({ id: OWN, storageKey: null })]);
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [OWN] })).resolves.toBeUndefined();
    mockPrisma.projectDocument.findMany.mockResolvedValue([stored({ attachments: [{ recordType: "ncr", recordId: "ncr-1", role: "attachment" }] })]);
    await expect(service.assertDocumentsLinkable({ ...scope, keys: [VICTIM] })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    expect(mockMembership.resolveRequestPrincipal).not.toHaveBeenCalled();
  });

  it("a writer named by id is judged as the project's own routes judge them, and one with no standing reads nothing", async () => {
    mockPrisma.project = { findUnique: jest.fn(async () => ({ orgId: "org-1" })) };
    mockPrisma.projectDocument.findMany.mockResolvedValue([stored({ attachments: [{ recordType: "ncr", recordId: "ncr-1", role: "attachment" }] })]);
    const view = { user: { id: "site-1" }, projectAccess: { role: "site_engineer" } };
    mockMembership.resolveRequestPrincipal.mockResolvedValue({ id: "site-1", orgId: "org-1", role: "site_engineer" });
    mockProjectAccess.requestForProject.mockResolvedValue(view);
    mockRbac.hasPermission.mockImplementation((req, moduleName, action) => req === view && action === "read" && moduleName === "ncr");
    await expect(service.assertDocumentsLinkable({ projectId: "project-1", refuse, keys: [VICTIM], userId: async () => "site-1" })).resolves.toBeUndefined();
    expect(mockMembership.resolveRequestPrincipal).toHaveBeenCalledWith(expect.objectContaining({ userId: "site-1", orgId: "org-1" }));
    expect(mockProjectAccess.requestForProject).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: "site-1", orgId: "org-1" }) }), "project-1");
    mockRbac.hasPermission.mockImplementation(() => false); // no NCR read
    await expect(service.assertDocumentsLinkable({ projectId: "project-1", refuse, keys: [VICTIM], userId: "site-1" })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    mockMembership.resolveRequestPrincipal.mockResolvedValue(null); // no standing in the organisation
    mockRbac.hasPermission.mockImplementation((req) => Boolean(req?.user));
    const viewer = await service.documentWriterViewer({ orgId: "org-1", projectId: "project-1", userId: "gone-1" });
    expect(viewer.canRead("ncr")).toBe(false);
    expect(viewer.mayApprove).toBe(false);
  });
});

// Certification R14: a legacy subcontractor valuation is its subcontractor's.
describe("RECORD_RULES.sub_valuation", () => {
  const rule = service.RECORD_RULES.sub_valuation;
  it("binds party readers to their own companies' valuations", () => {
    expect(rule).toMatchObject({ model: "subValuation", party: true });
    expect(rule.clauses({ companyIds: ["company-x"], userId: "u1" }).filter(Boolean)).toEqual([{ companyId: { in: ["company-x"] } }]);
  });
  it("leaves a party reader with no company nothing to read", () => {
    expect(rule.clauses({ companyIds: [], userId: "u1" }).filter(Boolean)).toEqual([]);
  });
});
