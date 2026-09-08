const store = { conversations: [], messages: [], sections: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

const SPEC_TEXT = [
  "PROJECT SPECIFICATION",
  "TABLE OF CONTENTS",
  "SECTION 03 30 00 CAST-IN-PLACE CONCRETE",
  "SECTION 09 91 00 PAINTING",
  "SECTION 26 05 19 LOW-VOLTAGE ELECTRICAL POWER CONDUCTORS AND CABLES",
  "",
  "SECTION 03 30 00",
  "CAST-IN-PLACE CONCRETE",
  "PART 1 - GENERAL",
  "1.01 SUMMARY",
  "A. This section covers cast-in-place concrete for foundations, slabs on grade, suspended slabs, beams and columns including formwork, reinforcement and curing.",
  "PART 2 - PRODUCTS",
  "2.01 CONCRETE",
  "A. Structural concrete shall be grade C40/50 with a maximum water-cement ratio of 0.45 and minimum cement content of 360 kg/m3.",
  "B. Reinforcement shall be grade B500B to BS 4449.",
  "END OF SECTION",
  "",
  "SECTION 09 91 00 – PAINTING",
  "PART 1 - GENERAL",
  "A. This section covers surface preparation and field painting of exposed interior and exterior items and surfaces, including two finish coats over primer.",
  "END OF SECTION",
  "",
  "SECTION 26 05 19",
  "LOW-VOLTAGE ELECTRICAL POWER CONDUCTORS AND CABLES",
  "PART 1 - GENERAL",
  "A. This section covers building wires and cables rated 600 V and less, connectors, splices and terminations, with copper conductors throughout.",
  "END OF SECTION",
].join("\n");

const PAGES = [
  { pageNumber: 1, text: "PROJECT SPECIFICATION TABLE OF CONTENTS SECTION 03 30 00 CAST-IN-PLACE CONCRETE SECTION 09 91 00 PAINTING SECTION 26 05 19" },
  { pageNumber: 2, text: "SECTION 03 30 00 CAST-IN-PLACE CONCRETE PART 1 - GENERAL" },
  { pageNumber: 3, text: "PART 2 - PRODUCTS 2.01 CONCRETE" },
  { pageNumber: 4, text: "SECTION 09 91 00 – PAINTING PART 1 - GENERAL" },
  { pageNumber: 5, text: "SECTION 26 05 19 LOW-VOLTAGE ELECTRICAL POWER CONDUCTORS AND CABLES" },
];

const DOCUMENT = { id: "doc-1", orgId: "org-1", projectId: "p1", title: "Technical specification", originalName: "spec.pdf", documentNumber: "SPEC-001", category: "specification", discipline: null, mimeType: "application/pdf", uploadedAt: new Date("2026-08-01"), storageKey: "spec.pdf" };

const mockPrisma = {
  projectDocument: { findFirst: jest.fn(async ({ where }) => (where.id === "doc-1" ? { ...DOCUMENT, text: { status: "ready", text: SPEC_TEXT, wordCount: 200, pageCount: 5 } } : null)) },
  documentText: {
    findMany: jest.fn(async ({ select }) =>
      select?.text
        ? [
            { documentId: "doc-1", text: SPEC_TEXT },
            { documentId: "doc-2", text: "Minutes of meeting 12. Attendees. Actions." },
          ]
        : [
            { documentId: "doc-1", wordCount: 200, pageCount: 5, excerpt: SPEC_TEXT.slice(0, 300), document: { ...DOCUMENT } },
            { documentId: "doc-2", wordCount: 40, pageCount: 1, excerpt: "Minutes of meeting", document: { ...DOCUMENT, id: "doc-2", title: "MoM 12", originalName: "mom.docx", category: null } },
          ],
    ),
  },
  specSection: {
    deleteMany: jest.fn(async ({ where }) => {
      store.sections = store.sections.filter((row) => row.documentId !== where.documentId);
      return { count: 0 };
    }),
    createMany: jest.fn(async ({ data }) => {
      for (const row of data) store.sections.push({ id: nextId("sec"), createdAt: new Date(), updatedAt: new Date(), ...row });
      return { count: data.length };
    }),
    findMany: jest.fn(async ({ where = {} }) => store.sections.filter((row) => row.projectId === where.projectId && (!where.division || row.division === where.division) && (!where.documentId || row.documentId === where.documentId)).map((row) => ({ ...row, document: { id: DOCUMENT.id, title: DOCUMENT.title, originalName: DOCUMENT.originalName } }))),
    findFirst: jest.fn(async ({ where }) => {
      const row = store.sections.find((item) => item.id === where.id && item.projectId === where.projectId);
      return row ? { ...row, document: { id: DOCUMENT.id, title: DOCUMENT.title, originalName: DOCUMENT.originalName, text: { text: SPEC_TEXT } } } : null;
    }),
    groupBy: jest.fn(async ({ by }) => {
      const groups = new Map();
      for (const row of store.sections) {
        const key = row[by[0]];
        const group = groups.get(key) || { [by[0]]: key, _count: { _all: 0 }, _max: { updatedAt: row.updatedAt } };
        group._count._all += 1;
        groups.set(key, group);
      }
      return [...groups.values()];
    }),
  },
  boqItem: { findMany: jest.fn(async () => [{ id: "boq-1", code: "3.1", description: "Concrete C40 to slabs", unit: "m3", qty: 120, section: "Substructure" }, { id: "boq-2", code: "26.1", description: "Cable tray 300 mm", unit: "m", qty: 40, section: null }]) },
  sheet: { findMany: jest.fn(async () => [{ id: "sh-s201", number: "S-201", title: "Level 1 framing plan", discipline: "Structural", currentRevisionId: "rev-s201" }, { id: "sh-e101", number: "E-101", title: "Lighting layout", discipline: "Electrical", currentRevisionId: "rev-e101" }]) },
  activity: { findMany: jest.fn(async () => [{ id: "act-1", name: "Pour slab concrete L1", activityCode: "A100", wbsCode: "1.2" }, { id: "act-2", name: "Cable pulling", activityCode: "A200", wbsCode: "1.5" }]) },
  rfi: { findMany: jest.fn(async () => [{ id: "rfi-1", ref: "RFI-001", subject: "Concrete grade at ground beams", question: "?", response: null, specSection: "03 30 00", status: "open" }]) },
  sheetRevision: { findMany: jest.fn(async ({ where }) => [{ id: "rev-s201", sheetId: "sh-s201", documentId: "dwg-1", pageNumber: 4, revision: "B" }].filter((row) => where.id.in.includes(row.id))) },
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
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
const mockDocumentText = { readDocumentBytes: jest.fn(async () => Buffer.from("pdf")) };
const mockPdfPages = jest.fn(() => ({ encrypted: false, pageCount: PAGES.length, pages: PAGES }));
const mockDrawingAssistant = { pageTextFor: jest.fn(async () => "GENERAL NOTES: 1. ALL STRUCTURAL CONCRETE GRADE C35/45 U.N.O. 2. REINFORCEMENT GRADE B500B. SEE S-501 FOR DETAILS.") };
const mockRfi = { createRfi: jest.fn(async ({ payload }) => ({ id: "rfi-9", ref: "RFI-009", status: payload.status })) };
const mockAudit = { ACTIONS: { CREATED: "created", UPDATED: "updated" }, recordEvent: jest.fn(async () => null) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../document-text.service", () => mockDocumentText);
jest.mock("../../utils/document-text", () => ({ pdfPages: (buffer) => mockPdfPages(buffer) }));
jest.mock("../drawing-assistant.service", () => mockDrawingAssistant);
jest.mock("../rfi.service", () => mockRfi);
jest.mock("../audit.service", () => mockAudit);

const service = require("../specification.service");

const user = { id: "u-1", orgId: "org-1", role: "pm" };
const scope = { orgId: "org-1", projectId: "p1" };

describe("specifications and scope intelligence", () => {
  beforeAll(() => {
    process.env.AI_RETRY_BASE_MS = "1";
  });
  beforeEach(() => {
    store.conversations.length = 0;
    store.messages.length = 0;
    store.sections = [];
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  describe("section parsing", () => {
    it("reads CSI sections, drops the table of contents and ignores paragraph numbering inside sections", () => {
      const sections = service.parseSections(SPEC_TEXT);
      expect(sections.map((row) => [row.code, row.codeKey, row.division, row.title])).toEqual([
        ["03 30 00", "033000", "03", "CAST-IN-PLACE CONCRETE"],
        ["09 91 00", "099100", "09", "PAINTING"],
        ["26 05 19", "260519", "26", "LOW-VOLTAGE ELECTRICAL POWER CONDUCTORS AND CABLES"],
      ]);
      expect(sections[0].dropped).toBe(3);
      expect(sections[0].wordCount).toBeGreaterThan(30);
      expect(SPEC_TEXT.slice(sections[0].charStart, sections[0].charEnd)).toContain("grade C40/50");
      expect(SPEC_TEXT.slice(sections[1].charStart, sections[1].charEnd)).not.toContain("C40/50");
    });

    it("falls back to generic SECTION n and numbered headings", () => {
      const generic = ["SECTION 5 – CONCRETE WORKS", `${"Concrete works text. ".repeat(10)}`, "SECTION 6 – BLOCKWORK", `${"Blockwork text. ".repeat(10)}`].join("\n");
      expect(service.parseSections(generic).map((row) => [row.codeKey, row.division, row.title])).toEqual([
        ["5", "05", "CONCRETE WORKS"],
        ["6", "06", "BLOCKWORK"],
      ]);
      const numbered = ["3.1 EXCAVATION", `${"Excavate to the levels shown. ".repeat(8)}`, "3.2 BACKFILL", `${"Backfill in layers. ".repeat(8)}`].join("\n");
      expect(service.parseSections(numbered).map((row) => [row.code, row.division, row.title])).toEqual([
        ["3.1", "03", "EXCAVATION"],
        ["3.2", "03", "BACKFILL"],
      ]);
      expect(service.parseSections("Nothing to see here")).toEqual([]);
    });

    it("locates each section's pages from the PDF page texts, preferring the body over the table of contents", () => {
      const located = service.pagesFor(service.parseSections(SPEC_TEXT), PAGES);
      expect(located.map((row) => [row.code, row.pageFrom, row.pageTo])).toEqual([
        ["03 30 00", 2, 4],
        ["09 91 00", 4, 5],
        ["26 05 19", 5, 5],
      ]);
    });
  });

  describe("relating", () => {
    it("relates a section to BOQ items, sheets, activities and RFIs with a basis for each", () => {
      const section = { projectId: "p1", codeKey: "033000", division: "03", title: "Cast-in-place concrete" };
      const context = {
        boqItems: [{ id: "boq-1", code: "3.1", description: "Concrete C40 to slabs", keys: service.tokens("Concrete C40 to slabs"), codeKey: "31" }, { id: "boq-2", code: "26.1", description: "Cable tray", keys: service.tokens("Cable tray"), codeKey: "261" }, { id: "boq-3", code: "03 30 00.10", description: "Item by code", keys: new Set(), codeKey: "03300010" }],
        sheets: [{ id: "sh-1", number: "S-201", title: "Level 1 framing plan", discipline: "Structural", keys: service.tokens("Level 1 framing plan") }, { id: "sh-2", number: "E-101", title: "Lighting layout", discipline: "Electrical", keys: service.tokens("Lighting layout") }, { id: "sh-3", number: "S-501", title: "Concrete details", discipline: "Structural", keys: service.tokens("Concrete details") }],
        activities: [{ id: "a-1", name: "Pour slab concrete L1", keys: service.tokens("Pour slab concrete L1") }, { id: "a-2", name: "Cable pulling", keys: service.tokens("Cable pulling") }],
        rfis: [{ id: "r-1", ref: "RFI-001", subject: "Concrete grade", status: "open", keys: service.tokens("Concrete grade"), specKey: "033000" }, { id: "r-2", ref: "RFI-002", subject: "Lighting levels", status: "open", keys: service.tokens("Lighting levels"), specKey: "" }],
      };
      const related = service.relateSection(section, context);
      expect(related.boqItems.map((row) => [row.id, row.basis])).toEqual([
        ["boq-3", "code"],
        ["boq-1", "title"],
      ]);
      expect(related.sheets.map((row) => [row.number, row.basis])).toEqual([
        ["S-501", "title"],
        ["S-201", "discipline"],
      ]);
      expect(related.activities.map((row) => row.id)).toEqual(["a-1"]);
      expect(related.rfis.map((row) => [row.ref, row.basis])).toEqual([["RFI-001", "spec_section"]]);
      expect(related.disciplines).toEqual(["Structural", "Civil"]);
    });
  });

  describe("index", () => {
    it("indexes a document into sections with pages and replaces earlier rows", async () => {
      const result = await service.indexDocument({ ...scope, documentId: "doc-1", userId: "u-1" });
      expect(result).toMatchObject({ documentId: "doc-1", sections: 3, dropped: 3, divisions: ["03", "09", "26"] });
      expect(mockPrisma.specSection.deleteMany).toHaveBeenCalledWith({ where: { documentId: "doc-1" } });
      expect(store.sections.map((row) => [row.code, row.pageFrom])).toEqual([
        ["03 30 00", 2],
        ["09 91 00", 4],
        ["26 05 19", 5],
      ]);
      expect(store.sections[0]).not.toHaveProperty("headingText");
      await expect(service.indexDocument({ ...scope, documentId: "doc-9" })).rejects.toMatchObject({ status: 404 });
    });

    it("scans the project for documents that read like specifications and lists documents", async () => {
      const scan = await service.scanProject({ ...scope, userId: "u-1" });
      expect(scan.documents.map((row) => [row.documentId, row.sections])).toEqual([["doc-1", 3]]);
      const documents = await service.listDocuments(scope);
      expect(documents.items.map((row) => [row.id, row.sections, row.likelySpec])).toEqual([
        ["doc-1", 3, true],
        ["doc-2", 0, false],
      ]);
      const list = await service.listSections({ ...scope, q: "paint" });
      expect(list.total).toBe(3);
      expect(list.divisions.map((row) => [row.division, row.label, row.count])).toEqual([
        ["03", "Concrete", 1],
        ["09", "Finishes", 1],
        ["26", "Electrical", 1],
      ]);
    });
  });

  describe("scope gaps", () => {
    beforeEach(async () => {
      await service.indexDocument({ ...scope, documentId: "doc-1" });
    });

    it("finds sections without coverage, BOQ items no section covers and disciplines without a specification", async () => {
      const gaps = await service.scopeGaps(scope);
      const byCode = Object.fromEntries(gaps.sections.map((row) => [row.code, row]));
      expect(byCode["03 30 00"].gaps).toEqual([]);
      expect(byCode["03 30 00"].counts).toMatchObject({ boq: 1, sheets: 0, sheetsByDiscipline: 1, activities: 1, rfis: 1 });
      expect(byCode["09 91 00"].gaps).toEqual(["no_boq", "no_drawings", "no_activities"]);
      expect(byCode["26 05 19"].gaps).toEqual(["no_boq", "no_activities"]);
      expect(gaps.summary).toMatchObject({ sections: 3, withGaps: 2, noBoq: 2, noDrawings: 1, noActivities: 2, boqItems: 2, uncoveredBoq: 1 });
      expect(gaps.uncoveredBoq.map((row) => row.code)).toEqual(["26.1"]);
      expect(gaps.uncoveredDisciplines).toEqual([]);
      expect(gaps.notes).toEqual([]);
    });

    it("explains the gaps with the model and stores the run, or with the computed review without a provider", async () => {
      const degraded = await service.explainScopeGaps({ ...scope, user });
      expect(degraded.degraded).toBe(true);
      expect(degraded.review.narrative).toContain("3 specification sections checked");
      expect(degraded.review.narrative).toContain("09 91 00 PAINTING: no BOQ items, no drawings, no activities");

      const transport = jest.fn(async ({ messages }) => {
        const digest = JSON.parse(messages[0].content);
        expect(digest.sectionsWithGaps.map((row) => row.code)).toEqual(["09 91 00", "26 05 19"]);
        return { text: JSON.stringify({ headline: "Painting and cabling are not priced", narrative: "Painting has no BOQ line…", actions: [{ type: "create_task", title: "Price Division 09", description: "Add painting to the BOQ" }, { type: "create_rfi", subject: "" }, { type: "weird" }] }) };
      });
      const result = await service.explainScopeGaps({ ...scope, user, transport });
      expect(result.degraded).toBe(false);
      expect(result.review.headline).toBe("Painting and cabling are not priced");
      expect(result.review.actions).toEqual([{ type: "create_task", title: "Price Division 09", description: "Add painting to the BOQ" }]);
      expect(store.conversations[0]).toMatchObject({ kind: "scope_gap", recordType: "project", recordId: "p1" });
      expect(result.message.id).toMatch(/^msg-/);
    });
  });

  describe("conflicts and RFIs", () => {
    let concreteId;
    beforeEach(async () => {
      await service.indexDocument({ ...scope, documentId: "doc-1" });
      concreteId = store.sections.find((row) => row.code === "03 30 00").id;
    });

    it("returns the section text with its related records", async () => {
      const section = await service.getSection({ ...scope, sectionId: concreteId });
      expect(section.text).toContain("grade C40/50");
      expect(section.related.boqItems.map((row) => row.code)).toEqual(["3.1"]);
      expect(section.related.rfis.map((row) => row.ref)).toEqual(["RFI-001"]);
      expect(section.path).toBe("/projects/p1/doc-control/specifications?recordId=" + concreteId + "&source=spec_section");
    });

    it("checks the section against the related sheets' text layers and normalises the findings", async () => {
      const transport = jest.fn(async ({ system, messages }) => {
        expect(system).toContain("CONFLICTS");
        expect(messages[0].content).toContain("SPECIFICATION SECTION 03 30 00 — CAST-IN-PLACE CONCRETE (Division 03 Concrete)");
        expect(messages[0].content).toContain("grade C40/50");
        expect(messages[0].content).toContain("--- S-201 Level 1 framing plan rev B ---");
        expect(messages[0].content).toContain("GRADE C35/45");
        expect(messages[0].content).toContain("RFI-001 (open) Concrete grade at ground beams");
        return { text: JSON.stringify({ summary: "The framing plan calls C35/45 where the specification requires C40/50.", conflicts: [{ topic: "Concrete grade", specSays: "C40/50", drawingSays: "C35/45 U.N.O.", sheetNumber: "s-201", severity: "high", recommendation: "Confirm the grade with the structural engineer" }, { topic: "", specSays: "x" }], gaps: [{ topic: "Curing", detail: "No curing note on the drawings", where: "drawings" }], confidence: "high" }) };
      });
      const result = await service.findConflicts({ ...scope, sectionId: concreteId, user, transport });
      expect(result.degraded).toBe(false);
      expect(result.sheetsChecked.map((row) => [row.number, row.basis, row.chars > 0])).toEqual([["S-201", "discipline", true]]);
      expect(result.result.conflicts).toEqual([{ topic: "Concrete grade", specSays: "C40/50", drawingSays: "C35/45 U.N.O.", sheetNumber: "S-201", severity: "high", recommendation: "Confirm the grade with the structural engineer" }]);
      expect(result.result.gaps).toEqual([{ topic: "Curing", detail: "No curing note on the drawings", where: "drawings" }]);
      expect(store.conversations[0]).toMatchObject({ kind: "spec_conflict", recordType: "spec_section", recordId: concreteId });
      expect(mockDrawingAssistant.pageTextFor).toHaveBeenCalledWith(expect.objectContaining({ documentId: "dwg-1", pageNumber: 4 }));

      const degraded = await service.findConflicts({ ...scope, sectionId: concreteId, user });
      expect(degraded.degraded).toBe(true);
      expect(degraded.result).toBeNull();
    });

    it("raises a draft RFI tagged with the section", async () => {
      const result = await service.raiseRfi({ ...scope, sectionId: concreteId, user, payload: { subject: "Concrete grade: C40/50 or C35/45?", question: "S-201 shows C35/45; 03 30 00 requires C40/50.", priority: "high" } });
      expect(mockRfi.createRfi).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ specSection: "03 30 00", discipline: "Structural", status: "draft", priority: "high" }), userId: "u-1" }));
      expect(result).toEqual({ record: { id: "rfi-9", ref: "RFI-009", status: "draft" }, url: "/projects/p1/doc-control/rfi?recordId=rfi-9&source=rfi" });
      await expect(service.raiseRfi({ ...scope, sectionId: concreteId, user, payload: {} })).rejects.toMatchObject({ code: "SPEC_RFI_SUBJECT" });
    });
  });
});
