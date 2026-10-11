jest.mock("../../../config/db", () => ({ prisma: { aiRun: { create: jest.fn(async () => ({ id: "run-1" })) }, projectDocument: { findMany: jest.fn() }, documentChunk: { findMany: jest.fn() } } }));
jest.mock("../../document-text.service", () => ({ documentViewer: jest.fn((args) => ({ ...args, id: args.userId })), readableDocumentIds: jest.fn(), searchDocuments: jest.fn() }));
jest.mock("../../../middleware/rbac", () => ({ hasPermission: jest.fn() }));
jest.mock("../../embedding.service", () => ({ isEnabled: () => false }));

const { prisma } = require("../../../config/db");
const documentText = require("../../document-text.service");
const { hasPermission } = require("../../../middleware/rbac");
const qa = require("../document-qa.service");

const P = "11111111-1111-4111-8111-111111111111";
const SPEC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MINUTES = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HIDDEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const req = { user: { orgId: "org-1", id: "u-1", role: "site_eng" }, projectAccess: { id: P, partyAccess: [] } };
const CHUNKS = [
  { id: "c1", documentId: SPEC, index: 0, text: "Section 08 44 00 Curtain wall. Glazing shall be acoustic double-glazed units with Rw 38 dB.", charStart: 0, charEnd: 90 },
  { id: "c2", documentId: SPEC, index: 1, text: "Fixings: stainless steel brackets at each slab edge.", charStart: 90, charEnd: 140 },
  { id: "c3", documentId: MINUTES, index: 0, text: "Meeting 12: the client asked about acoustic rating of party walls.", charStart: 0, charEnd: 70 },
];

describe("Document Q&A (AI-6)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" };
    jest.clearAllMocks();
    hasPermission.mockImplementation((_req, moduleName) => moduleName === "document_control");
    prisma.projectDocument.findMany.mockImplementation(async ({ where }) => [{ id: SPEC, title: "Facade specification", documentNumber: "SPEC-08", originalName: "spec.pdf", text: { status: "ready" } }, { id: MINUTES, title: "Minutes 12", documentNumber: null, originalName: "m12.docx", text: { status: "ready" } }].filter((row) => where.id.in.includes(row.id)));
    prisma.documentChunk.findMany.mockImplementation(async ({ where }) => CHUNKS.filter((chunk) => where.documentId.in.includes(chunk.documentId)));
  });
  afterAll(() => { process.env = saved; });

  test("named documents: every one must be readable by the caller's own viewer, or nothing is read", async () => {
    documentText.readableDocumentIds.mockResolvedValue(new Set([SPEC]));
    await expect(qa.ask({ req, projectId: P, question: "What glazing is specified?", documentIds: [SPEC, HIDDEN] })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
    expect(documentText.readableDocumentIds).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: P, documentIds: [SPEC, HIDDEN], viewer: expect.objectContaining({ userId: "u-1", canRead: expect.any(Function) }) }));
    expect(prisma.documentChunk.findMany).not.toHaveBeenCalled();
  });

  test("answers from the named document's passages only, citing them", async () => {
    documentText.readableDocumentIds.mockResolvedValue(new Set([SPEC]));
    const result = await qa.ask({ req, projectId: P, question: "What acoustic glazing is specified?", documentIds: [SPEC] });
    expect(prisma.documentChunk.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", projectId: P, documentId: { in: [SPEC] } });
    expect(result.passages.map((passage) => passage.documentId)).toEqual([SPEC]);
    expect(result.passages[0]).toMatchObject({ n: 1, ref: "SPEC-08", chunkIndex: 0 });
    expect(result.passages[0].text).toBeUndefined();
    expect(result.answer).toMatchObject({ mock: true, label: "AI interpretation" });
    expect(result.answer.citations.map((citation) => citation.n)).toEqual([1]);
    expect(result.insufficient).toBe(false);
  });

  test("across the project: needs document control read, and searches as the caller", async () => {
    hasPermission.mockReturnValue(false);
    await expect(qa.ask({ req, projectId: P, question: "acoustic rating" })).rejects.toMatchObject({ status: 403 });
    expect(documentText.searchDocuments).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_req, moduleName) => moduleName === "document_control");
    documentText.searchDocuments.mockImplementation(async ({ q }) => ({ items: q === "acoustic" ? [{ documentId: MINUTES, score: 0.5 }, { documentId: SPEC, score: 0.4 }] : [{ documentId: SPEC, score: 0.2 }] }));
    const result = await qa.ask({ req, projectId: P, question: "acoustic rating" });
    for (const [args] of documentText.searchDocuments.mock.calls) expect(args).toMatchObject({ orgId: "org-1", projectId: P, viewer: expect.objectContaining({ userId: "u-1" }) });
    expect(new Set(result.passages.map((passage) => passage.documentId))).toEqual(new Set([SPEC, MINUTES]));
  });

  test("no matching passage: says so instead of answering", async () => {
    documentText.readableDocumentIds.mockResolvedValue(new Set([SPEC]));
    const result = await qa.ask({ req, projectId: P, question: "What is the retention percentage?", documentIds: [SPEC] });
    expect(result).toMatchObject({ insufficient: true, answer: null, passages: [] });
  });

  test("without AI the best passages still come back", async () => {
    process.env.AI_PROVIDER = "disabled";
    documentText.readableDocumentIds.mockResolvedValue(new Set([SPEC]));
    const result = await qa.ask({ req, projectId: P, question: "stainless steel fixings", documentIds: [SPEC] });
    expect(result).toMatchObject({ degraded: true, degradedReason: "AI_NOT_CONFIGURED", answer: null });
    expect(result.passages[0]).toMatchObject({ documentId: SPEC, chunkIndex: 1 });
  });

  test("summary reads a named document from its start, even with no matching words; compare spreads across the documents", async () => {
    documentText.readableDocumentIds.mockImplementation(async ({ documentIds }) => new Set(documentIds));
    const summary = await qa.ask({ req, projectId: P, question: "Summarize this document", documentIds: [SPEC], mode: "summary" });
    expect(summary.passages.map((passage) => passage.chunkIndex)).toEqual([0, 1]);
    expect(summary.insufficient).toBe(false);
    const compare = await qa.ask({ req, projectId: P, question: "Compare these documents", documentIds: [SPEC, MINUTES], mode: "compare" });
    expect(new Set(compare.passages.map((passage) => passage.documentId))).toEqual(new Set([SPEC, MINUTES]));
    await expect(qa.ask({ req, projectId: P, question: "Summarize", mode: "summary" })).rejects.toMatchObject({ code: "DOCUMENTS_REQUIRED" });
  });

  test("no project access context, nothing read", async () => {
    await expect(qa.ask({ req: { user: req.user }, projectId: P, question: "glazing", documentIds: [SPEC] })).rejects.toMatchObject({ code: "AI_CONTEXT_MISSING" });
    expect(documentText.readableDocumentIds).not.toHaveBeenCalled();
  });
});
