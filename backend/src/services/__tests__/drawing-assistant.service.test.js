const store = { conversations: [], messages: [], references: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

const SHEETS = [
  { id: "sh-a101", number: "A-101", title: "Level 1 plan", discipline: "Architectural", status: "current", projectId: "p1", orgId: "org-1" },
  { id: "sh-a501", number: "A-501", title: "Details", discipline: "Architectural", status: "current", projectId: "p1", orgId: "org-1" },
  { id: "sh-s201", number: "S-201", title: "Level 1 framing", discipline: "Structural", status: "current", projectId: "p1", orgId: "org-1" },
];
const REVISIONS = [
  { id: "rev-a101-b", setId: "set-1", sheetId: "sh-a101", documentId: "doc-1", pageNumber: 1, number: "A-101", title: "Level 1 plan", revision: "B", discipline: "Architectural", status: "published", textStatus: "ready", publishedAt: new Date("2026-09-01") },
  { id: "rev-a101-a", setId: "set-0", sheetId: "sh-a101", documentId: "doc-0", pageNumber: 1, number: "A-101", title: "Level 1 plan", revision: "A", discipline: "Architectural", status: "superseded", textStatus: "ready", publishedAt: new Date("2026-06-01") },
  { id: "rev-p2", setId: "set-1", sheetId: null, documentId: "doc-1", pageNumber: 2, number: null, title: null, revision: null, discipline: null, status: "pending_review", textStatus: "no_text", publishedAt: null },
  { id: "rev-p3", setId: "set-1", sheetId: null, documentId: "doc-1", pageNumber: 3, number: "S-201", title: null, revision: null, discipline: null, status: "pending_review", textStatus: "ready", publishedAt: null },
  { id: "rev-s201", setId: "set-1", sheetId: "sh-s201", documentId: "doc-1", pageNumber: 4, number: "S-201", title: "Level 1 framing", revision: "A", discipline: "Structural", status: "published", textStatus: "ready", publishedAt: new Date("2026-09-01") },
];
const PAGE_TEXT = {
  1: "LEVEL 1 PLAN  SEE S-201 FOR FRAMING. DETAIL 3/A-501 TYP. SECTION 5/A-501. ALSO A-101 SELF. ISO 9001 SHEET SIZE A1",
  4: "LEVEL 1 FRAMING — REFER A-101 FOR SETTING OUT",
};

const mockPrisma = {
  drawingSet: { findFirst: jest.fn(async ({ where }) => (where.id === "set-1" ? { id: "set-1", setNumber: "SET-01", name: "IFC set", discipline: "Architectural" } : null)) },
  sheetRevision: { findMany: jest.fn(async ({ where = {} }) => REVISIONS.filter((row) => (!where.setId || row.setId === where.setId) && (!where.id?.in || where.id.in.includes(row.id)) && (!where.sheetId || (typeof where.sheetId === "object" ? row.sheetId !== null : row.sheetId === where.sheetId)) && (!where.status || row.status === where.status)).map((row) => (where.sheetId && typeof where.sheetId === "object" ? { ...row, sheet: SHEETS.find((sheet) => sheet.id === row.sheetId) || null } : row))) },
  sheet: {
    findFirst: jest.fn(async ({ where, include }) => {
      const sheet = SHEETS.find((row) => row.id === where.id && row.projectId === where.projectId);
      if (!sheet) return null;
      return include?.revisions ? { ...sheet, revisions: REVISIONS.filter((row) => row.sheetId === sheet.id && row.status === "published") } : sheet;
    }),
    findMany: jest.fn(async () => SHEETS),
  },
  projectDocument: { findFirst: jest.fn(async ({ where }) => ({ id: where.id, storageKey: `${where.id}.pdf` })) },
  sheetReference: {
    findMany: jest.fn(async ({ where }) => store.references.filter((row) => (where.sheetId ? row.sheetId === where.sheetId : true) && (where.targetSheetId ? row.targetSheetId === where.targetSheetId : true)).map((row) => ({ ...row, targetSheet: SHEETS.find((sheet) => sheet.id === row.targetSheetId) || null, sheet: SHEETS.find((sheet) => sheet.id === row.sheetId) || null }))),
    upsert: jest.fn(async ({ where, create, update }) => {
      const existing = store.references.find((row) => row.sheetId === where.sheetId_targetNumber.sheetId && row.targetNumber === where.sheetId_targetNumber.targetNumber);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      const row = { id: nextId("ref"), createdAt: new Date(), updatedAt: new Date(), ...create };
      store.references.push(row);
      return row;
    }),
    deleteMany: jest.fn(async ({ where }) => {
      const before = store.references.length;
      store.references = store.references.filter((row) => !(row.sheetId === where.sheetId && row.source === where.source && !where.targetNumber.notIn.includes(row.targetNumber)));
      return { count: before - store.references.length };
    }),
  },
  assistantConversation: {
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("conv"), createdAt: new Date(), ...data };
      store.conversations.push(row);
      return row;
    }),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
  },
  assistantMessage: {
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("msg"), createdAt: new Date(), citationsJson: [], actionsJson: [], sourcesJson: [], ...data };
      store.messages.push(row);
      return row;
    }),
  },
};
const mockDocumentText = { readDocumentBytes: jest.fn(async (document) => Buffer.from(`pdf:${document.id}`)) };
const mockPdfPages = jest.fn((buffer) => ({ encrypted: false, pageCount: 4, pages: [1, 2, 3, 4].map((pageNumber) => ({ pageNumber, text: String(buffer).endsWith("doc-1") ? PAGE_TEXT[pageNumber] || "" : "", width: 841, height: 594, rotation: 0 })) }));
const mockDrawingSets = { reviewRevisions: jest.fn(async ({ updates }) => ({ items: updates })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../document-text.service", () => mockDocumentText);
jest.mock("../../utils/document-text", () => ({ pdfPages: (buffer) => mockPdfPages(buffer) }));
jest.mock("../drawing-set.service", () => mockDrawingSets);

const service = require("../drawing-assistant.service");

const user = { id: "u-1", orgId: "org-1", role: "pm" };
const scope = { orgId: "org-1", projectId: "p1" };
const image = `data:image/jpeg;base64,${Buffer.from("x".repeat(64)).toString("base64")}`;

describe("drawing intelligence", () => {
  beforeAll(() => {
    process.env.AI_RETRY_BASE_MS = "1";
  });
  beforeEach(() => {
    store.conversations.length = 0;
    store.messages.length = 0;
    store.references = [];
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_VISION;
  });

  describe("cross-references", () => {
    it("finds sheet numbers and detail callouts naming other sheets, ignoring itself and non-sheet tokens", () => {
      const found = service.extractReferences(PAGE_TEXT[1], ["A-101", "A-501", "S-201", "M-301"], "A-101");
      expect(found.map((row) => [row.targetNumber, row.count])).toEqual([
        ["A-501", 2],
        ["S-201", 1],
      ]);
      expect(found[0].samples[0]).toContain("DETAIL 3/A-501");
      expect(service.extractReferences("Nothing here", ["A-101"], null)).toEqual([]);
    });

    it("builds a sheet's outgoing links from the published revision's text layer and lists both directions", async () => {
      const result = await service.buildSheetReferences({ ...scope, sheetId: "sh-a101" });
      expect(result.built).toBe(2);
      expect(result.textStatus).toBe("ready");
      expect(result.outgoing.map((row) => [row.targetNumber, row.targetSheet?.id, row.count])).toEqual([
        ["A-501", "sh-a501", 2],
        ["S-201", "sh-s201", 1],
      ]);
      expect(result.outgoing[0].targetSheet.path).toBe("/projects/p1/doc-control/drawings?recordId=sh-a501&source=sheet");
      expect(mockDocumentText.readDocumentBytes).toHaveBeenCalledTimes(1);

      const listed = await service.listReferences({ ...scope, sheetId: "sh-s201" });
      expect(listed.outgoing).toEqual([]);
      expect(listed.incoming.map((row) => row.sheet.number)).toEqual(["A-101"]);
    });

    it("rebuilds a whole set with one parse per document and drops stale text links", async () => {
      store.references.push({ id: "ref-stale", orgId: "org-1", projectId: "p1", sheetId: "sh-a101", targetNumber: "M-301", targetSheetId: null, count: 1, samplesJson: [], source: "text", updatedAt: new Date() });
      const result = await service.buildSetReferences({ ...scope, setId: "set-1" });
      expect(result).toMatchObject({ setId: "set-1", sheetsBuilt: 2, references: 3, noText: 0, revisions: 2 });
      expect(mockPdfPages).toHaveBeenCalledTimes(1);
      expect(store.references.map((row) => `${row.sheetId}>${row.targetNumber}`).sort()).toEqual(["sh-a101>A-501", "sh-a101>S-201", "sh-s201>A-101"]);
      await expect(service.buildSetReferences({ ...scope, setId: "set-9" })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("title-block reading", () => {
    it("degrades without a vision provider", async () => {
      const result = await service.readTitleBlocks({ ...scope, setId: "set-1", user, payload: { pages: [{ revisionId: "rev-p2", image }] } });
      expect(result.degraded).toBe(true);
      expect(result.items).toEqual([]);
    });

    it("reads rendered pages, normalises the proposals, stores runs and applies on request to empty fields only", async () => {
      const answers = { 2: { number: "s 202", title: "Level 2 Framing Plan", revision: "c", date: "2026-08-14", discipline: "structural", scale: "1:100", drawnBy: "MA", references: ["A-101", "s-202", "A-501"], confidence: { number: "high", title: "high", revision: "medium" } }, 3: { number: "S-201", title: "Level 1 framing plan", revision: "B", discipline: "Structural", references: [], confidence: { number: "high", title: "medium" } } };
      const transport = jest.fn(async ({ system, messages }) => {
        expect(system).toContain("title block");
        const content = messages[0].content;
        expect(content[0].text).toContain("Set SET-01 — IFC set (Architectural)");
        expect(content[1]).toMatchObject({ type: "image", mediaType: "image/jpeg" });
        const page = Number(/page (\d+)/.exec(content[0].text)[1]);
        return { text: JSON.stringify(answers[page]), usage: { inputTokens: 900, outputTokens: 120 } };
      });
      const result = await service.readTitleBlocks({ ...scope, setId: "set-1", user, transport, payload: { pages: [{ revisionId: "rev-p2", image }, { revisionId: "rev-p3", image }, { revisionId: "rev-zzz", image }, { revisionId: "rev-a101-b", image: "not-an-image" }], apply: true } });
      expect(result.degraded).toBe(false);
      expect(transport).toHaveBeenCalledTimes(2);
      const [p2, p3, missing, bad] = result.items;
      expect(p2.proposal).toMatchObject({ number: "S202", title: "Level 2 Framing Plan", revision: "C", discipline: "Structural", scale: "1:100", drawnBy: "MA", references: ["A-101", "A-501"] });
      expect(p2.proposal.fields.number.confidence).toBe(0.9);
      expect(p2.proposal.fields.revision.confidence).toBe(0.65);
      expect(p2.current).toMatchObject({ status: "pending_review", textStatus: "no_text" });
      expect(p2.message.id).toMatch(/^msg-/);
      expect(p3.proposal.fields.revision.confidence).toBe(0.35);
      expect(missing.error).toBe("Not a page of this set");
      expect(bad.error).toContain("data URL");
      expect(result.applied).toBe(2);
      expect(mockDrawingSets.reviewRevisions).toHaveBeenCalledWith(expect.objectContaining({ setId: "set-1", userId: "u-1", updates: [{ id: "rev-p2", number: "S202", title: "Level 2 Framing Plan", revision: "C", discipline: "Structural" }, { id: "rev-p3", title: "Level 1 framing plan", revision: "B", discipline: "Structural" }] }));
      expect(store.conversations.map((row) => row.kind)).toEqual(["sheet_read", "sheet_read"]);
      expect(store.conversations[0]).toMatchObject({ recordType: "sheet_revision", recordId: "rev-p2" });
    });

    it("rejects an unknown set and an empty page list", async () => {
      await expect(service.readTitleBlocks({ ...scope, setId: "set-9", user, payload: { pages: [{ revisionId: "rev-p2", image }] } })).rejects.toMatchObject({ status: 404 });
      await expect(service.readTitleBlocks({ ...scope, setId: "set-1", user, payload: { pages: [] } })).rejects.toMatchObject({ code: "DRAWING_AI_PAGES_REQUIRED" });
    });
  });

  describe("revision comparison", () => {
    it("sends both rendered revisions in order and normalises the change list", async () => {
      const transport = jest.fn(async ({ messages }) => {
        const content = messages[0].content;
        expect(content.map((block) => block.type)).toEqual(["text", "image", "text", "image"]);
        expect(content[0].text).toContain("Image A: revision A (2026-06-01)");
        expect(content[2].text).toContain("Image B: revision B (2026-09-01)");
        return { text: JSON.stringify({ summary: "Grid C-D partition moved 300 mm; door D12 added.", changes: [{ area: "Grid C-D", description: "Partition relocated 300 mm east", kind: "modified", impact: "high" }, { area: "Room 104", description: "Door D12 added", kind: "added", impact: "medium" }, { area: "", description: "", kind: "removed" }, { area: "Notes", description: "General note 4 reworded", kind: "weird", impact: "cosmetic" }], confidence: "medium" }) };
      });
      const result = await service.compareRevisions({ ...scope, sheetId: "sh-a101", user, transport, payload: { a: { revisionId: "rev-a101-a", image }, b: { revisionId: "rev-a101-b", image } } });
      expect(result.degraded).toBe(false);
      expect(result.from).toEqual({ id: "rev-a101-a", revision: "A" });
      expect(result.to).toEqual({ id: "rev-a101-b", revision: "B" });
      expect(result.comparison.changes).toEqual([
        { area: "Grid C-D", description: "Partition relocated 300 mm east", kind: "modified", impact: "high" },
        { area: "Room 104", description: "Door D12 added", kind: "added", impact: "medium" },
        { area: "Notes", description: "General note 4 reworded", kind: "modified", impact: "medium" },
      ]);
      expect(result.comparison.confidence).toBe("medium");
      expect(store.conversations[0]).toMatchObject({ kind: "sheet_diff", recordType: "sheet", recordId: "sh-a101" });
      expect(result.message.id).toBe(store.messages.find((row) => row.role === "assistant").id);
    });

    it("refuses revisions that are not two different revisions of the sheet, and degrades without vision", async () => {
      await expect(service.compareRevisions({ ...scope, sheetId: "sh-a101", user, transport: jest.fn(), payload: { a: { revisionId: "rev-a101-a", image }, b: { revisionId: "rev-s201", image } } })).rejects.toMatchObject({ code: "DRAWING_AI_REVISIONS" });
      await expect(service.compareRevisions({ ...scope, sheetId: "sh-a101", user, transport: jest.fn(), payload: { a: { revisionId: "rev-a101-a", image }, b: { revisionId: "rev-a101-a", image } } })).rejects.toMatchObject({ code: "DRAWING_AI_REVISIONS" });
      const degraded = await service.compareRevisions({ ...scope, sheetId: "sh-a101", user, payload: { a: { revisionId: "rev-a101-a", image }, b: { revisionId: "rev-a101-b", image } } });
      expect(degraded.degraded).toBe(true);
      expect(degraded.comparison).toBeNull();
    });
  });

  it("reports the provider status", () => {
    expect(service.status()).toMatchObject({ vision: false, pageLimit: 8 });
  });
});
