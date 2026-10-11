const store = { conversations: [], messages: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

const mockPrisma = {
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

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
// The project a run is scoped to is decided by the project access rule (certification R19).
const mockAccess = { assertProjectAccess: jest.fn() };
jest.mock("../project-authorization.service", () => ({ ...jest.requireActual("../project-authorization.service"), assertProjectAccess: (...args) => mockAccess.assertProjectAccess(...args) }));

const reportBuilder = require("../report-builder.service");
const service = require("../report-assistant.service");

const user = { id: "u-1", orgId: "org-1", role: "pm", isCompanyAdmin: false };
const previewResult = (overrides = {}) => ({
  source: { key: "rfi", label: "RFIs", module: "rfi" },
  columns: [{ key: "ref", label: "RFI", type: "string" }, { key: "subject", label: "Subject", type: "string" }, { key: "status", label: "Status", type: "enum" }, { key: "raisedDate", label: "Raised", type: "date" }],
  rows: [
    { id: "r1", projectId: "p1", projectName: "Tower", ref: "RFI-001", subject: "Pile cap links", status: "open", raisedDate: "2026-08-30T00:00:00.000Z" },
    { id: "r2", projectId: "p1", projectName: "Tower", ref: "RFI-002", subject: "Slab edge lap", status: "open", raisedDate: "2026-09-01T00:00:00.000Z" },
  ],
  rowCount: 2,
  total: 7,
  truncated: false,
  groupBy: { key: "status", label: "Status", type: "enum" },
  aggregates: [{ fn: "count", field: null, key: "count", label: "Count" }],
  groups: [{ key: "open", label: "open", count: 5 }, { key: "answered", label: "answered", count: 2 }],
  totals: { count: 7 },
  projects: { inScope: 3, queried: 2, denied: 1 },
  generatedAt: "2026-09-05T10:00:00.000Z",
  ...overrides,
});

describe("natural-language reporting", () => {
  let runQuery;
  let preview;
  beforeAll(() => {
    process.env.AI_RETRY_BASE_MS = "1";
  });
  beforeEach(() => {
    store.conversations.length = 0;
    store.messages.length = 0;
    jest.clearAllMocks();
    // "Without a provider" means none at all: a development .env may name the mock (AI-1).
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    runQuery = jest.spyOn(reportBuilder, "runQuery").mockResolvedValue(previewResult());
    preview = jest.spyOn(reportBuilder, "preview").mockResolvedValue(previewResult());
    mockAccess.assertProjectAccess.mockImplementation(async ({ projectId }) => ({ id: projectId, role: "pm", partyAccess: [] }));
  });
  afterEach(() => {
    runQuery.mockRestore();
    preview.mockRestore();
  });

  it("turns a question into a valid definition through the model, repairing what the builder rejects, and previews it", async () => {
    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("report builder");
      const content = messages[0].content;
      expect(content).toContain("Catalogue:");
      expect(content).toContain("- rfi (RFIs;");
      expect(content).toContain("status:enum[draft|open|answered|closed]");
      expect(content).toContain("Question: open RFIs raised in the last 30 days by status");
      expect(content).toContain("Scope: every project the person can open");
      return { text: JSON.stringify({ name: "Open RFIs — last 30 days", description: "RFIs raised in the last 30 days that are still open, by status", source: "rfi", columns: ["ref", "subject", "status", "priority", "raisedDate", "responseRequiredBy", "ballInCourt"], filters: [{ field: "status", op: "in", value: ["open", "answered"] }, { field: "raisedDate", op: "last_days", value: 30 }, { field: "nonsense", op: "eq", value: 1 }], sort: { field: "raisedDate", dir: "desc" }, groupBy: "status", aggregates: [{ fn: "count" }, { fn: "sum", field: "subject" }], chart: { type: "bar", metric: "count" }, explanation: "Open = status open or answered; window on the raised date.", assumptions: ["Answered RFIs count as open until closed"] }), usage: { inputTokens: 2500, outputTokens: 300 } };
    });
    const result = await service.ask({ orgId: "org-1", user, question: "open RFIs raised in the last 30 days by status", transport });
    expect(result.degraded).toBe(false);
    expect(result.definition).toMatchObject({ name: "Open RFIs — last 30 days", source: "rfi", projectId: null, columns: ["ref", "subject", "status", "priority", "raisedDate", "responseRequiredBy"], sort: { field: "raisedDate", dir: "desc" }, groupBy: "status", aggregates: [{ fn: "count", field: null }], chart: { type: "bar", metric: "count" }, visibility: "private" });
    expect(result.definition.filters).toEqual([{ field: "status", op: "in", value: ["open", "answered"] }, { field: "raisedDate", op: "last_days", value: 30 }]);
    expect(result.warnings).toEqual([expect.stringContaining("Dropped unknown column ballInCourt"), expect.stringContaining("Dropped a filter that could not be applied (nonsense eq)"), expect.stringContaining("Dropped the aggregates the builder rejected")]);
    expect(result.explanation).toBe("Open = status open or answered; window on the raised date.");
    expect(result.assumptions).toEqual(["Answered RFIs count as open until closed"]);
    expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", user, definition: expect.objectContaining({ source: "rfi", groupBy: "status", projectId: null }), limit: 50 }));
    expect(result.preview).toMatchObject({ total: 7, groups: [{ label: "open", count: 5 }, { label: "answered", count: 2 }] });
    expect(result.message).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(store.conversations[0]).toMatchObject({ kind: "report_nl", title: "open RFIs raised in the last 30 days by status" });
  });

  it("falls back to keywords without a provider and when the model picks an unknown source", async () => {
    const plain = await service.ask({ orgId: "org-1", user, question: "Overdue urgent RFIs by discipline in the last 2 weeks", projectId: "11111111-1111-4111-8111-111111111111" });
    expect(plain.degraded).toBe(true);
    expect(plain.reason).toContain("read by keywords");
    expect(plain.definition).toMatchObject({ source: "rfi", projectId: "11111111-1111-4111-8111-111111111111", groupBy: "discipline", chart: { type: "bar", metric: "count" } });
    expect(plain.definition.filters).toEqual([{ field: "overdue", op: "is_true", value: null }, { field: "priority", op: "in", value: ["high", "urgent"] }, { field: "raisedDate", op: "last_days", value: 14 }]);
    expect(plain.definition.columns).toEqual(expect.arrayContaining(["ref", "subject", "status", "discipline"]));
    expect(plain.assumptions).toEqual([expect.stringContaining("last 14 days")]);
    expect(store.conversations).toHaveLength(0);

    const manpower = await service.ask({ orgId: "org-1", user, question: "total man-hours by trade this month" });
    expect(manpower.definition.source).toBe("daily_log_manpower");
    expect(manpower.definition.groupBy).toBe("trade");
    expect(manpower.definition.aggregates.map((aggregate) => aggregate.fn)).toEqual(["count", "sum"]);

    const bogus = jest.fn(async () => ({ text: JSON.stringify({ name: "x", source: "invoices", columns: [] }) }));
    const rescued = await service.ask({ orgId: "org-1", user, question: "open punch items by trade", transport: bogus });
    expect(rescued.degraded).toBe(false);
    expect(rescued.definition.source).toBe("punch_item");
    expect(rescued.definition.groupBy).toBe("trade");
    expect(rescued.warnings[0]).toContain("Unknown report source: invoices; the source was chosen by keywords instead.");

    const broken = jest.fn(async () => ({ text: "no json here" }));
    const recovered = await service.ask({ orgId: "org-1", user, question: "open RFIs", transport: broken });
    expect(recovered.degraded).toBe(true);
    expect(recovered.reason).toContain("did not return a report definition");
    expect(recovered.definition.source).toBe("rfi");

    await expect(service.ask({ orgId: "org-1", user, question: " " })).rejects.toMatchObject({ code: "REPORT_NL_QUESTION_REQUIRED" });
  });

  it("decides the run's project before it reads, asks a model or stores anything (certification R19)", async () => {
    const P = "11111111-1111-4111-8111-111111111111";
    const transport = jest.fn(async () => ({ text: JSON.stringify({ name: "Open RFIs", source: "rfi", columns: ["ref"] }), usage: null }));
    const refuse = (code, status) => Object.assign(new Error(code), { status, code });
    for (const [code, status] of [["PROJECT_ACCESS_DENIED", 403], ["PROJECT_NOT_FOUND", 404]]) {
      mockAccess.assertProjectAccess.mockRejectedValueOnce(refuse(code, status));
      await expect(service.ask({ orgId: "org-1", user, question: "open RFIs", projectId: P, transport })).rejects.toMatchObject({ code });
      mockAccess.assertProjectAccess.mockRejectedValueOnce(refuse(code, status));
      await expect(service.narrate({ orgId: "org-1", user, payload: { source: "rfi", projectId: P }, transport })).rejects.toMatchObject({ code });
    }
    expect(mockAccess.assertProjectAccess).toHaveBeenCalledWith({ orgId: "org-1", projectId: P, userId: "u-1", role: "pm", isCompanyAdmin: false });
    expect(transport).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(store.conversations).toHaveLength(0);
    // An API key only on its own projects.
    await expect(service.ask({ orgId: "org-1", user, question: "open RFIs", projectId: P, transport, apiClient: { projectIds: ["other"] } })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN_PROJECT" });
    expect(store.conversations).toHaveLength(0);

    // A project the caller opens: the run is stored against it.
    const asked = await service.ask({ orgId: "org-1", user, question: "open RFIs", projectId: P, transport });
    expect(asked.message).toEqual(expect.objectContaining({ id: expect.any(String) }));
    const told = await service.narrate({ orgId: "org-1", user, payload: { source: "rfi", projectId: P }, transport: jest.fn(async () => ({ text: JSON.stringify({ headline: "h", summary: "s", highlights: [], caveats: [] }) })) });
    expect(told.message).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(store.conversations.map((row) => [row.kind, row.projectId])).toEqual([["report_nl", P], ["report_narrative", P]]);
  });

  it("narrates a preview from the numbers, and through the model", async () => {
    const plain = await service.narrate({ orgId: "org-1", user, payload: { source: "rfi", groupBy: "status" } });
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ payload: { source: "rfi", groupBy: "status" }, limit: 200 }));
    expect(plain.degraded).toBe(true);
    expect(plain.narrative.headline).toBe("7 rfis across 2 projects; largest group open (5).");
    expect(plain.narrative.highlights).toEqual(["open: 5", "answered: 2"]);
    expect(plain.narrative.caveats).toEqual(["1 project skipped because you cannot read this register there."]);
    expect(plain.result).toEqual({ total: 7, groups: 2, projects: { inScope: 3, queried: 2, denied: 1 }, truncated: false });

    const transport = jest.fn(async ({ system, messages }) => {
      expect(system).toContain("summarise the result");
      const digest = messages[0].content;
      expect(digest).toContain("Source: RFIs; 7 rows across 2 projects (1 skipped for permissions)");
      expect(digest).toContain("- open: count 5");
      expect(digest).toContain("RFI: RFI-001 · Subject: Pile cap links · Status: open · Raised: 2026-08-30");
      return { text: JSON.stringify({ headline: "Five of seven RFIs are still open.", summary: "Two were answered; the open ones were raised in the last week.", highlights: ["5 open", "2 answered"], caveats: ["One project was skipped"], recommendations: ["Chase the five open RFIs"] }), usage: { inputTokens: 400, outputTokens: 90 } };
    });
    const told = await service.narrate({ orgId: "org-1", user, payload: { source: "rfi", groupBy: "status" }, transport });
    expect(told.degraded).toBe(false);
    // AI-5: FACT is the builder's own numbers whatever the model says; the model's parts are labelled.
    expect(told.facts).toEqual({ headline: plain.narrative.headline, items: plain.narrative.highlights, caveats: plain.narrative.caveats });
    expect(plain.facts).toEqual(told.facts);
    expect([plain.generatedBy, told.generatedBy]).toEqual(["rules", "ai"]);
    expect(told.recommendations).toEqual(["Chase the five open RFIs"]);
    expect(plain.recommendations).toEqual([]);
    expect(told.narrative).toEqual({ headline: "Five of seven RFIs are still open.", summary: "Two were answered; the open ones were raised in the last week.", highlights: ["5 open", "2 answered"], caveats: ["One project was skipped"] });
    expect(store.conversations[0]).toMatchObject({ kind: "report_narrative", title: "Narrative: RFIs" });
  });
});
