const store = { conversations: [], messages: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ("in" in expected) return expected.in.includes(row[key]);
      return matches(row[key] || {}, expected);
    }
    return row[key] === expected;
  });

const mockPrisma = {
  assistantConversation: {
    findMany: jest.fn(async ({ where }) => store.conversations.filter((row) => matches(row, where)).map((row) => ({ ...row, project: null, _count: { messages: store.messages.filter((message) => message.conversationId === row.id).length } }))),
    findFirst: jest.fn(async ({ where }) => store.conversations.find((row) => matches(row, where)) || null),
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("conv"), createdAt: new Date(), updatedAt: new Date(), ...data };
      store.conversations.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(store.conversations.find((row) => row.id === where.id), data)),
  },
  assistantMessage: {
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("msg"), createdAt: new Date(), citationsJson: [], actionsJson: [], sourcesJson: [], ...data };
      store.messages.push(row);
      return row;
    }),
    findFirst: jest.fn(async ({ where }) => {
      const row = store.messages.find((message) => message.id === where.id && message.orgId === where.orgId) || null;
      if (!row) return null;
      const conversation = store.conversations.find((item) => item.id === row.conversationId);
      return where.conversation?.userId && conversation?.userId !== where.conversation.userId ? null : row;
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(store.messages.find((row) => row.id === where.id), data)),
  },
  project: { findMany: jest.fn(async ({ where }) => where.id.in.map((id) => ({ id, name: id === "p1" ? "Tower" : "Bridge", status: "active", currency: "USD", contractValue: 5000000, startDate: null, endDate: null, clientName: "Skyline Ltd", location: null, type: null }))) },
  rfi: {
    findFirst: jest.fn(async ({ where }) => {
      if (where.id === "rfi-7") return { subject: "Pile cap links", question: "Drawing S-201 shows T16 links; spec 03 30 00 says T12. Which governs?", response: "T16 per S-201 rev C governs.", status: "answered", discipline: "Structural", specSection: "03 30 00" };
      if (where.id === "rfi-20") return { subject: "Slab edge reinforcement at grid C", question: "Unclear lap length at the slab edge.", response: null, status: "open", discipline: "Structural", specSection: "03 30 00" };
      return null;
    }),
  },
  activity: { findFirst: jest.fn(async ({ where }) => (where.id === "act-1" ? { name: "Level 3 slab pour" } : null)) },
  location: { findFirst: jest.fn(async ({ where }) => (where.id === "loc-1" ? { name: "Level 3", path: "Tower / Level 3" } : null)) },
  submittal: { findFirst: jest.fn(async () => null) },
};
const mockSearch = { globalSearch: jest.fn(async () => ({ items: [], meta: { authorizedProjectCount: 1, mode: "text" } })) };
const mockDocumentText = { searchDocuments: jest.fn(async () => ({ items: [] })) };
const mockEmbeddings = { isEnabled: jest.fn(() => false), describe: jest.fn(() => ({ enabled: false })) };
const mockAccess = { assertProjectAccess: jest.fn(async () => ({ id: "p1", role: "pm", partyAccess: [] })) };
const mockTemplates = { resolveTemplateContext: jest.fn(async () => null), templateAllows: jest.fn(() => null) };
const mockAudit = { ACTIONS: { CREATED: "created" }, recordEvent: jest.fn(async () => ({})) };

const rfiDetail = () => ({
  id: "rfi-20",
  ref: "RFI-020",
  subject: "Slab edge reinforcement at grid C",
  question: "Drawing S-310 shows a 40d lap at the slab edge while spec 03 30 00 clause 3.4 requires 50d. Which applies at grid C, level 3?",
  status: "open",
  priority: "high",
  revision: 0,
  discipline: "Structural",
  specSection: "03 30 00",
  activity: { id: "act-1", name: "Level 3 slab pour" },
  location: { id: "loc-1", name: "Level 3" },
  responseRequiredBy: new Date("2026-09-12"),
  costImpact: false,
  scheduleImpactFlag: true,
  scheduleImpact: 2,
  responses: [{ id: "resp-1", body: "We will check the latest structural revision.", isOfficial: false, revision: 0, author: { name: "Dana Reviewer" }, createdAt: new Date("2026-09-06") }],
  officialResponse: null,
});
const mockRfiWorkflow = { getRfi: jest.fn(async () => rfiDetail()) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../search.service", () => mockSearch);
jest.mock("../document-text.service", () => mockDocumentText);
jest.mock("../embedding.service", () => mockEmbeddings);
jest.mock("../project-authorization.service", () => mockAccess);
jest.mock("../permission-template.service", () => mockTemplates);
jest.mock("../audit.service", () => mockAudit);
jest.mock("../rfi-workflow.service", () => mockRfiWorkflow);

const service = require("../rfi-assistant.service");
const assistant = require("../assistant.service");

const user = { id: "u-1", orgId: "org-1", role: "pm", isCompanyAdmin: false };
const hits = () => ({
  items: [
    { id: "rfi-20", type: "rfi", typeLabel: "RFI", module: "docControl", projectId: "p1", projectName: "Tower", title: "Slab edge reinforcement at grid C", identifier: "RFI-020", status: "open", date: "2026-09-05T00:00:00.000Z", url: "/projects/p1/doc-control/rfi?recordId=rfi-20", metadata: { rank: 0.95 } },
    { id: "content:doc-3", type: "document", typeLabel: "Document", module: "docControl", projectId: "p1", projectName: "Tower", title: "Structural specification rev B", identifier: "SPEC-S-01", status: null, date: "2026-07-01T00:00:00.000Z", url: "/projects/p1/doc-control/documents?recordId=doc-3", metadata: { documentId: "doc-3", snippet: "Lap lengths shall be 50 bar diameters unless noted otherwise on the drawings.", rank: 0.8 } },
    { id: "rfi-7", type: "rfi", typeLabel: "RFI", module: "docControl", projectId: "p1", projectName: "Tower", title: "Pile cap links", identifier: "RFI-007", status: "answered", date: "2026-08-20T00:00:00.000Z", url: "/projects/p1/doc-control/rfi?recordId=rfi-7", metadata: { rank: 0.7 } },
    { id: "rfi-b1", type: "rfi", typeLabel: "RFI", module: "docControl", projectId: "p2", projectName: "Bridge", title: "Lap length at deck edge", identifier: "RFI-003", status: "closed", date: "2026-05-02T00:00:00.000Z", url: "/projects/p2/doc-control/rfi?recordId=rfi-b1", metadata: { rank: 0.6 } },
  ],
  meta: { authorizedProjectCount: 2, mode: "text" },
});

describe("RFI drafting and response assistant", () => {
  beforeAll(() => {
    process.env.AI_RETRY_BASE_MS = "1";
  });
  beforeEach(() => {
    store.conversations.length = 0;
    store.messages.length = 0;
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_PROVIDER;
    mockSearch.globalSearch.mockResolvedValue(hits());
  });

  it("drafts a formal RFI from a rough note with the documents and flags prior RFIs that may already answer it", async () => {
    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("Request for Information");
      const content = messages[0].content;
      expect(content).toContain("[2] Document SPEC-S-01");
      expect(content).toContain("What the user wrote:\nlap at slab edge grid C looks short vs spec");
      expect(content).toContain('Known references: spec section 03 30 00, activity "Level 3 slab pour", location "Level 3"');
      return { text: '{"subject": "Lap length at slab edge, grid C level 3", "question": "Drawing S-310 shows 40d while the specification requires 50d [2]. Please confirm which governs at grid C.", "discipline": "Structural", "specSection": "03 30 00", "priority": "high", "costImpact": false, "scheduleImpactFlag": true, "impactReason": "The pour is programmed for next week.", "alreadyAnswered": [{"sourceN": 3, "why": "RFI-007 resolved the same drawing-versus-spec conflict for pile caps."}, {"sourceN": 99}], "citations": [2]}', usage: { inputTokens: 700, outputTokens: 150 } };
    });
    const result = await service.draftQuestion({ orgId: "org-1", user, projectId: "p1", payload: { prompt: "lap at slab edge grid C looks short vs spec", specSection: "03 30 00", activityId: "act-1", locationId: "loc-1" }, transport });
    expect(mockSearch.globalSearch).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ projectId: "p1", q: expect.stringContaining("Level 3 slab pour") }) }));
    expect(result.degraded).toBe(false);
    expect(result.draft).toMatchObject({ subject: "Lap length at slab edge, grid C level 3", discipline: "Structural", specSection: "03 30 00", priority: "high", costImpact: false, scheduleImpactFlag: true, impactReason: "The pour is programmed for next week." });
    expect(result.draft.citations.map((citation) => [citation.n, citation.ref])).toEqual([[2, "SPEC-S-01"]]);
    expect(result.draft.questionPlain).toBe("Drawing S-310 shows 40d while the specification requires 50d (Document SPEC-S-01). Please confirm which governs at grid C.");
    expect(result.draft.alreadyAnswered).toEqual([expect.objectContaining({ n: 3, ref: "RFI-007", why: expect.stringContaining("pile caps") })]);
    expect(result.similar.map((row) => [row.ref, row.sameProject])).toEqual([["RFI-020", true], ["RFI-007", true], ["RFI-003", false]]);
    expect(result.message).toEqual(expect.objectContaining({ id: expect.any(String), model: "test" }));
    expect(store.conversations[0]).toMatchObject({ kind: "rfi_draft", projectId: "p1", userId: "u-1", title: "RFI draft: Lap length at slab edge, grid C level 3" });
    expect(store.messages[1].sourcesJson).toHaveLength(4);
    // record runs never show up in Ask OctaPM
    expect(await assistant.listConversations({ orgId: "org-1", user, projectId: "p1" })).toEqual([]);
  });

  it("degrades to similar RFIs and sources when no provider is configured", async () => {
    const result = await service.draftQuestion({ orgId: "org-1", user, projectId: "p1", payload: { prompt: "lap at slab edge" } });
    expect(result).toMatchObject({ degraded: true, draft: null, message: null });
    expect(result.reason).toContain("not configured");
    expect(result.similar.map((row) => row.ref)).toEqual(["RFI-020", "RFI-007", "RFI-003"]);
    expect(result.citations).toHaveLength(4);
    await expect(service.draftQuestion({ orgId: "org-1", user, projectId: "p1", payload: { prompt: "   " } })).rejects.toMatchObject({ code: "RFI_AI_PROMPT_REQUIRED" });
  });

  it("suggests a response from the sources the responder can read, leaving the RFI itself out and keeping the thread", async () => {
    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("conflicts");
      const content = messages[0].content;
      expect(content).not.toContain("RFI-020 — Slab edge reinforcement"); // the record itself is not a source
      expect(content).toContain("[1] Document SPEC-S-01");
      expect(content).toContain("[2] RFI RFI-007");
      expect(content).toContain("RFI RFI-020: Slab edge reinforcement at grid C");
      expect(content).toContain("Reply by Dana Reviewer on 2026-09-06");
      expect(content).toContain("Instructions from the responder: keep it short");
      return { text: '{"response": "The specification governs: provide a 50d lap at the slab edge [1]. The same precedence was confirmed on RFI-007 [2].", "confidence": "medium", "basis": ["SPEC-S-01 sets 50d unless noted on the drawings", "RFI-007 applied the drawing revision over the spec"], "conflicts": [{"description": "S-310 shows 40d while the specification requires 50d", "sourceNs": [1, 9]}], "openPoints": ["Confirm whether S-310 rev C notes a reduced lap"], "impacts": {"cost": "possible", "schedule": "none", "reason": "Extra bar length"}, "citations": [1, 2]}', usage: { inputTokens: 900, outputTokens: 200 } };
    });
    const result = await service.suggestResponse({ orgId: "org-1", user, projectId: "p1", rfiId: "rfi-20", payload: { instructions: "keep it short" }, transport });
    expect(mockRfiWorkflow.getRfi).toHaveBeenCalledWith({ orgId: "org-1", projectId: "p1", rfiId: "rfi-20", viewerId: "u-1" });
    expect(result.degraded).toBe(false);
    expect(result.suggestion).toMatchObject({ confidence: "medium", openPoints: ["Confirm whether S-310 rev C notes a reduced lap"], impacts: { cost: "possible", schedule: "none", reason: "Extra bar length" } });
    expect(result.suggestion.conflicts).toEqual([{ description: "S-310 shows 40d while the specification requires 50d", sourceNs: [1] }]);
    expect(result.suggestion.citations.map((citation) => [citation.n, citation.ref])).toEqual([[1, "SPEC-S-01"], [2, "RFI-007"]]);
    expect(result.suggestion.responsePlain).toBe("The specification governs: provide a 50d lap at the slab edge (Document SPEC-S-01). The same precedence was confirmed on RFI-007 (RFI RFI-007).");
    expect(result.similar.map((row) => row.ref)).toEqual(["RFI-007", "RFI-003"]);
    expect(store.conversations[0]).toMatchObject({ kind: "rfi_response", recordType: "rfi", recordId: "rfi-20", title: "Response draft: RFI-020" });
    const rated = await assistant.feedback({ orgId: "org-1", user, messageId: result.message.id, rating: "down", note: "too cautious" });
    expect(rated).toMatchObject({ feedback: "down", feedbackNote: "too cautious" });

    mockRfiWorkflow.getRfi.mockResolvedValueOnce({ ...rfiDetail(), status: "closed" });
    await expect(service.suggestResponse({ orgId: "org-1", user, projectId: "p1", rfiId: "rfi-20", transport })).rejects.toMatchObject({ code: "RFI_ALREADY_CLOSED" });

    const failing = jest.fn(async () => {
      throw Object.assign(new Error("rate limited"), { status: 429 });
    });
    const outage = await service.suggestResponse({ orgId: "org-1", user, projectId: "p1", rfiId: "rfi-20", transport: failing });
    expect(outage).toMatchObject({ degraded: true, suggestion: null });
    expect(outage.reason).toContain("did not answer");
    expect(outage.citations).toHaveLength(3);
  });

  it("summarises the thread, falling back to a factual summary without a provider", async () => {
    const plain = await service.summarize({ orgId: "org-1", user, projectId: "p1", rfiId: "rfi-20" });
    expect(plain.degraded).toBe(true);
    expect(plain.summary.summary).toContain("RFI-020 (open) asks: Slab edge reinforcement at grid C. 1 reply in the thread. No official answer yet.");
    expect(plain.summary.openPoints).toEqual(["No official answer has been given."]);
    expect(store.conversations).toHaveLength(0);

    const transport = jest.fn(async ({ messages }) => {
      expect(messages[0].content).toContain("Question:\nDrawing S-310 shows a 40d lap");
      return { text: '{"summary": "The contractor asks which lap length applies at grid C. One reply promises a check of the latest revision; no answer yet.", "decisions": [], "openPoints": ["Which revision of S-310 is current"], "suggestedNextStep": "The structural engineer confirms the lap length.", "suggestedStatus": "open"}' };
    });
    const result = await service.summarize({ orgId: "org-1", user, projectId: "p1", rfiId: "rfi-20", transport });
    expect(result.degraded).toBe(false);
    expect(result.summary).toMatchObject({ openPoints: ["Which revision of S-310 is current"], suggestedNextStep: "The structural engineer confirms the lap length.", suggestedStatus: "open" });
    expect(store.conversations[0]).toMatchObject({ kind: "rfi_summary", recordType: "rfi", recordId: "rfi-20" });
  });

  it("finds similar RFIs across the caller's projects without a model call, current project first", async () => {
    const result = await service.similar({ orgId: "org-1", user, projectId: "p2", q: "lap length slab edge", excludeRfiId: "rfi-7" });
    expect(mockSearch.globalSearch).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ q: "lap length slab edge", types: ["rfi"], projectId: undefined }) }));
    expect(result.items.map((row) => [row.ref, row.sameProject])).toEqual([["RFI-003", true], ["RFI-020", false]]);
    await expect(service.similar({ orgId: "org-1", user, projectId: "p1", q: "" })).rejects.toMatchObject({ code: "RFI_AI_QUERY_REQUIRED" });
  });
});
