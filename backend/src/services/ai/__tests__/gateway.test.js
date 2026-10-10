jest.mock("../../../config/db", () => ({ prisma: { aiRun: { create: jest.fn(async () => ({ id: "run-1" })) } } }));

const { prisma } = require("../../../config/db");
const gateway = require("../gateway");
const aiContext = require("../context");
const { estimateCostMicros } = require("../pricing");
const { mockTransport } = require("../mock-provider");

const ASSISTANT_SYSTEM = 'Return ONLY a JSON object: {"answer": "...", "citations": [1], "actions": []}';
const SOURCES = "[1] RFI RFI-012 — Slab edge detail (Riverside Tower, open)\nWhat is the slab edge detail?\n\n[2] Activity A-200 — Frame level 3 (Riverside Tower, In Progress)";

describe("AI gateway (AI-1)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    prisma.aiRun.create.mockClear();
    process.env = { ...saved, AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", AI_RETRY_BASE_MS: "1" };
    delete process.env.AI_MODEL;
  });
  afterAll(() => { process.env = saved; });

  test("the mock answers in the assistant's JSON shape, citing only the sources it was given", async () => {
    const result = await gateway.complete({ feature: "assistant.ask", system: ASSISTANT_SYSTEM, messages: [{ role: "user", content: `${SOURCES}\n\nQuestion: what is open?` }] });
    const parsed = JSON.parse(result.text);
    expect(parsed.citations).toEqual([1, 2]);
    expect(parsed.actions).toEqual([]);
    expect(parsed.answer).toMatch(/Development mock answer/);
    expect(parsed.answer).toMatch(/RFI RFI-012 — Slab edge detail .*\[1\]/);
    expect(result.provider).toBe("mock");
    expect(result.model).toBe("octapm-mock-1");
  });

  test("every successful call writes one ledger row with feature, tokens, cost and attribution", async () => {
    const result = await aiContext.runWith({ orgId: "org-1", projectId: "p-1", userId: "u-1", actorKind: "human" }, () =>
      gateway.complete({ feature: "ai.attention", system: "plain", messages: [{ role: "user", content: "FACT: 3 activities are late" }] }));
    expect(result.runId).toBe("run-1");
    expect(prisma.aiRun.create).toHaveBeenCalledTimes(1);
    const data = prisma.aiRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ orgId: "org-1", projectId: "p-1", userId: "u-1", actorKind: "human", feature: "ai.attention", provider: "mock", model: "octapm-mock-1", status: "ok", costMicros: 0, retries: 0 });
    expect(data.inputTokens).toBeGreaterThan(0);
    expect(data.outputTokens).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toMatch(/3 activities are late/); // no prompt content in the ledger
  });

  test("a provider failure is recorded as failed and surfaces as 503 AI_UNAVAILABLE without the provider's words", async () => {
    const transport = jest.fn(async () => { throw Object.assign(new Error("sk-ant-SECRET quota exceeded at api.example"), { status: 500 }); });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(gateway.complete({ feature: "rfi.draft", system: "s", messages: [{ role: "user", content: "q" }], transport })).rejects.toMatchObject({ status: 503, code: "AI_UNAVAILABLE" });
    spy.mockRestore();
    const data = prisma.aiRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ feature: "rfi.draft", status: "failed", errorClass: "provider_error" });
    expect(JSON.stringify(data)).not.toMatch(/SECRET|quota/);
  });

  test("rate limits are retried, then succeed, and the retries are counted", async () => {
    let calls = 0;
    const transport = jest.fn(async () => {
      calls += 1;
      if (calls < 2) throw Object.assign(new Error("slow down"), { status: 429 });
      return { text: "ok", usage: { inputTokens: 10, outputTokens: 2 } };
    });
    const result = await gateway.complete({ feature: "assistant.ask", system: "s", messages: [{ role: "user", content: "q" }], transport });
    expect(result.text).toBe("ok");
    expect(prisma.aiRun.create.mock.calls[0][0].data).toMatchObject({ status: "ok", retries: 1 });
  });

  test("with AI disabled the call fails 503 AI_NOT_CONFIGURED and is recorded as disabled", async () => {
    process.env.AI_PROVIDER = "disabled";
    await expect(gateway.complete({ feature: "assistant.ask", system: "s", messages: [{ role: "user", content: "q" }] })).rejects.toMatchObject({ status: 503, code: "AI_NOT_CONFIGURED" });
    expect(prisma.aiRun.create.mock.calls[0][0].data).toMatchObject({ status: "disabled", errorClass: "AI_NOT_CONFIGURED" });
    expect(gateway.capabilities()).toMatchObject({ enabled: false, mode: "disabled" });
  });

  test("capabilities name the provider and model only for detailed (company admin) callers", () => {
    expect(gateway.capabilities()).toEqual(expect.not.objectContaining({ provider: expect.anything() }));
    expect(gateway.capabilities({ detailed: true })).toMatchObject({ mode: "mock", provider: "mock", model: "octapm-mock-1" });
  });

  test("requireAiAccess fails closed when the authorisation context was never resolved", () => {
    expect(() => aiContext.requireAiAccess({ orgId: "o", userId: "u", access: undefined })).toThrow(expect.objectContaining({ code: "AI_CONTEXT_MISSING" }));
    expect(() => aiContext.requireAiAccess({ orgId: null, userId: "u", access: {} })).toThrow(expect.objectContaining({ code: "AI_CONTEXT_MISSING" }));
    expect(aiContext.requireAiAccess({ orgId: "o", userId: "u", access: { schedule: true } })).toBe(true);
  });

  test("cost is estimated in micro-USD for a known model and left null for an unknown one", () => {
    expect(estimateCostMicros({ model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 100 })).toBe(4500);
    expect(estimateCostMicros({ model: "unknown-model", inputTokens: 1000, outputTokens: 100 })).toBeNull();
  });

  test("the mock restates FACT lines and never invents records when it has none", async () => {
    const empty = await mockTransport({ system: "plain", messages: [{ role: "user", content: "Question: anything late?" }] });
    expect(empty.text).toMatch(/could not find OctaPM records/);
    const facts = await mockTransport({ system: "plain", messages: [{ role: "user", content: "FACT: A-200 is 8 working days late\nQuestion: what is late?" }] });
    expect(facts.text).toMatch(/- A-200 is 8 working days late/);
  });
});
