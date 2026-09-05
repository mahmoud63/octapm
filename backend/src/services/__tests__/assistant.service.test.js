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
const withMessages = (row) => (row ? { ...row, project: row.projectId ? { id: row.projectId, name: "Tower" } : null, messages: store.messages.filter((message) => message.conversationId === row.id), _count: { messages: store.messages.filter((message) => message.conversationId === row.id).length } } : null);

const mockPrisma = {
  assistantConversation: {
    findMany: jest.fn(async ({ where }) => store.conversations.filter((row) => matches(row, where)).map(withMessages)),
    findFirst: jest.fn(async ({ where }) => withMessages(store.conversations.find((row) => matches(row, where)) || null)),
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("conv"), createdAt: new Date(), updatedAt: new Date(), ...data };
      store.conversations.push(row);
      return withMessages(row);
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(store.conversations.find((row) => row.id === where.id), data)),
    delete: jest.fn(async ({ where }) => store.conversations.splice(store.conversations.findIndex((row) => row.id === where.id), 1)[0]),
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
  project: { findMany: jest.fn(async ({ where }) => where.id.in.map((id) => ({ id, name: "Tower", status: "active", currency: "USD", contractValue: 12000000, startDate: new Date("2026-01-10"), endDate: new Date("2027-06-30"), clientName: "Skyline Ltd", location: "Riyadh", type: "commercial" }))) },
  rfi: { findFirst: jest.fn(async ({ where }) => (where.id === "rfi-12" ? { subject: "Pile cap reinforcement", question: "Drawing S-201 shows T16 links but the spec calls for T12. Which governs?", response: "Use T16 per S-201 revision C.", status: "answered", discipline: "Structural" } : null)) },
  submittal: { findFirst: jest.fn(async () => null) },
};
const mockSearch = { globalSearch: jest.fn(async () => ({ items: [], meta: { authorizedProjectCount: 1, mode: "text" } })) };
const mockDocumentText = { searchDocuments: jest.fn(async () => ({ items: [] })) };
const mockEmbeddings = { isEnabled: jest.fn(() => false), describe: jest.fn(() => ({ enabled: false })) };
const mockRfiService = { createRfi: jest.fn(async ({ payload }) => ({ id: "rfi-new", ref: "RFI-013", status: payload.status })) };
const mockTaskService = { createTask: jest.fn(async ({ payload }) => ({ id: "task-new", taskNumber: 41, status: "todo", title: payload.title })) };
const mockAudit = { ACTIONS: { CREATED: "created" }, recordEvent: jest.fn(async () => ({})) };
const mockAccess = { assertProjectAccess: jest.fn(async () => ({ id: "p1", role: "pm", partyAccess: [] })) };
const mockTemplates = { resolveTemplateContext: jest.fn(async () => null), templateAllows: jest.fn(() => null) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../search.service", () => mockSearch);
jest.mock("../document-text.service", () => mockDocumentText);
jest.mock("../embedding.service", () => mockEmbeddings);
jest.mock("../rfi.service", () => mockRfiService);
jest.mock("../task.service", () => mockTaskService);
jest.mock("../audit.service", () => mockAudit);
jest.mock("../project-authorization.service", () => mockAccess);
jest.mock("../permission-template.service", () => mockTemplates);

const retrieval = require("../retrieval.service");
const service = require("../assistant.service");
const aiProvider = require("../ai-provider.service");

const user = { id: "u-1", orgId: "org-1", role: "pm", isCompanyAdmin: false };
const hits = () => ({
  items: [
    { id: "rfi-12", type: "rfi", typeLabel: "RFI", module: "docControl", projectId: "p1", projectName: "Tower", title: "Pile cap reinforcement", subtitle: "Structural", identifier: "RFI-012", status: "answered", date: "2026-08-20T00:00:00.000Z", url: "/projects/p1/doc-control/rfi?recordId=rfi-12", metadata: { rank: 0.8 } },
    { id: "content:doc-7", type: "document", typeLabel: "Document", module: "docControl", projectId: "p1", projectName: "Tower", title: "Structural specification rev B", subtitle: "spec.pdf", identifier: "SPEC-S-01", status: null, date: "2026-07-01T00:00:00.000Z", url: "/projects/p1/doc-control/documents?recordId=doc-7", metadata: { documentId: "doc-7", snippet: "Links to pile caps shall be <b>T12</b> at 200 centres unless noted on the drawings.", source: "content", rank: 0.6 } },
  ],
  meta: { authorizedProjectCount: 1, mode: "text" },
});

describe("project knowledge assistant", () => {
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
  });

  it("retrieves only what the search layer allows, quotes record bodies and numbers the sources", async () => {
    mockSearch.globalSearch.mockResolvedValueOnce(hits());
    const result = await retrieval.retrieve({ orgId: "org-1", user, projectId: "p1", query: "which links go in the pile caps?" });
    expect(mockSearch.globalSearch).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", userId: "u-1", role: "pm", query: expect.objectContaining({ q: "which links go in the pile caps?", projectId: "p1" }) }));
    expect(result.sources.map((source) => [source.n, source.type, source.ref])).toEqual([[1, "rfi", "RFI-012"], [2, "document", "SPEC-S-01"]]);
    expect(result.sources[0].text).toContain("Answer: Use T16 per S-201 revision C.");
    expect(result.sources[1].snippet).toBe("Links to pile caps shall be T12 at 200 centres unless noted on the drawings.");
    expect(result.projects[0]).toMatchObject({ name: "Tower", contractValue: 12000000 });
    expect(mockDocumentText.searchDocuments).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", semantic: false, viewer: expect.objectContaining({ id: "u-1", canRead: expect.any(Function) }) }));
    const formatted = retrieval.formatSources(result.sources);
    expect(formatted).toContain("[1] RFI RFI-012 — Pile cap reinforcement (Tower, answered)");
    expect(formatted).toContain("[2] Document SPEC-S-01 — Structural specification rev B");
  });

  it("answers with citations and suggested actions through the model, and keeps the exchange", async () => {
    mockSearch.globalSearch.mockResolvedValue(hits());
    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("ONLY the numbered sources");
      expect(messages[messages.length - 1].content).toContain("[1] RFI RFI-012");
      expect(messages[messages.length - 1].content).toContain("Question: which links go in the pile caps?");
      return { text: '```json\n{"answer": "Use **T16** links as answered in RFI-012 [1]; the specification originally called for T12 [2].", "citations": [1, 2], "actions": [{"type": "create_task", "label": "Update the spec", "title": "Issue spec revision for pile cap links", "description": "Align section 03 30 00 with S-201 rev C", "sourceN": 2}, {"type": "open", "label": "Open RFI-012", "sourceN": 1}, {"type": "bogus"}]}\n```', usage: { inputTokens: 900, outputTokens: 120 }, stopReason: "end_turn" };
    });
    const result = await service.ask({ orgId: "org-1", user, projectId: "p1", question: "which links go in the pile caps?", transport });
    expect(result.degraded).toBe(false);
    expect(result.message.content).toContain("T16");
    expect(result.message.citations.map((citation) => [citation.n, citation.ref, citation.url])).toEqual([[1, "RFI-012", "/projects/p1/doc-control/rfi?recordId=rfi-12"], [2, "SPEC-S-01", "/projects/p1/doc-control/documents?recordId=doc-7"]]);
    expect(result.message.actions).toEqual([
      expect.objectContaining({ type: "create_task", title: "Issue spec revision for pile cap links", sourceN: 2 }),
      expect.objectContaining({ type: "open", label: "Open RFI-012", url: "/projects/p1/doc-control/rfi?recordId=rfi-12" }),
    ]);
    expect(store.conversations[0]).toMatchObject({ projectId: "p1", userId: "u-1", title: "which links go in the pile caps?" });
    expect(store.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(store.messages[1].sourcesJson).toHaveLength(2);
    expect(store.messages[1].usageJson).toEqual({ inputTokens: 900, outputTokens: 120 });

    // follow-up in the same conversation carries the history
    const followUp = jest.fn(async ({ messages }) => {
      expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
      return { text: '{"answer": "Revision C [1].", "citations": [1], "actions": []}' };
    });
    const second = await service.ask({ orgId: "org-1", user, conversationId: result.conversationId, question: "which revision?", transport: followUp });
    expect(second.conversationId).toBe(result.conversationId);
    expect(second.message.citations).toHaveLength(1);
    const conversation = await service.getConversation({ orgId: "org-1", user, conversationId: result.conversationId });
    expect(conversation.messages).toHaveLength(4);
    const rated = await service.feedback({ orgId: "org-1", user, messageId: result.message.id, rating: "up" });
    expect(rated.feedback).toBe("up");
    await expect(service.feedback({ orgId: "org-1", user: { ...user, id: "someone-else" }, messageId: result.message.id, rating: "down" })).rejects.toMatchObject({ code: "ASSISTANT_MESSAGE_NOT_FOUND" });
  });

  it("degrades to search results when no provider is configured or the provider fails", async () => {
    mockSearch.globalSearch.mockResolvedValue(hits());
    const plain = await service.ask({ orgId: "org-1", user, projectId: "p1", question: "pile cap links?" });
    expect(plain.degraded).toBe(true);
    expect(plain.message.content).toContain("AI answers are not configured");
    expect(plain.message.content).toContain("[1] RFI RFI-012");
    expect(plain.message.citations).toHaveLength(2);
    expect(plain.message.actions).toEqual([]);

    const failing = jest.fn(async () => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    });
    const outage = await service.ask({ orgId: "org-1", user, projectId: "p1", question: "pile cap links?", transport: failing });
    expect(outage.degraded).toBe(true);
    expect(outage.message.content).toContain("did not answer");
    expect(failing).toHaveBeenCalledTimes(3);
    expect(aiProvider.describe()).toMatchObject({ enabled: false, provider: null, model: null, vision: false });
  });

  it("runs suggested actions through the record services as drafts", async () => {
    const rfi = await service.executeAction({ orgId: "org-1", user, projectId: "p1", action: { type: "create_rfi", subject: "Pile cap link size", question: "Confirm T16 vs T12" } });
    expect(mockRfiService.createRfi).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", payload: expect.objectContaining({ subject: "Pile cap link size", status: "draft" }), userId: "u-1" }));
    expect(rfi).toMatchObject({ type: "create_rfi", record: { ref: "RFI-013", status: "draft" }, url: "/projects/p1/doc-control/rfi?recordId=rfi-new" });
    const task = await service.executeAction({ orgId: "org-1", user, projectId: "p1", action: { type: "create_task", title: "Issue spec revision" } });
    expect(task).toMatchObject({ type: "create_task", record: { ref: "T-41" } });
    await expect(service.executeAction({ orgId: "org-1", user, projectId: "p1", action: { type: "open" } })).rejects.toMatchObject({ code: "ASSISTANT_ACTION_UNKNOWN" });
    await expect(service.executeAction({ orgId: "org-1", user, projectId: "p1", action: { type: "create_rfi" } })).rejects.toMatchObject({ code: "ASSISTANT_ACTION_SUBJECT" });
  });

  it("parses model answers with or without fences and picks a provider from the environment", () => {
    expect(aiProvider.parseJsonAnswer('Sure:\n```json\n{"answer":"x","citations":[1]}\n```')).toEqual({ answer: "x", citations: [1] });
    expect(aiProvider.parseJsonAnswer('{"answer": "plain"} trailing')).toEqual({ answer: "plain" });
    expect(aiProvider.parseJsonAnswer("no json here")).toBeNull();
    process.env.OPENAI_API_KEY = "sk-test";
    expect(aiProvider.resolveProvider()).toMatchObject({ provider: "openai", model: "gpt-4o-mini" });
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    process.env.AI_MODEL = "claude-test";
    expect(aiProvider.resolveProvider()).toMatchObject({ provider: "anthropic", model: "claude-test" });
    process.env.AI_PROVIDER = "openai";
    expect(aiProvider.resolveProvider().provider).toBe("openai");
    delete process.env.AI_MODEL;
  });
});
