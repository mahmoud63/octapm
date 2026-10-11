jest.mock("../../../config/db", () => ({ prisma: { aiRun: { create: jest.fn(async () => ({ id: "run-1" })), aggregate: jest.fn() } } }));
// A live provider without the network: the Anthropic SDK answers locally.
const mockCreate = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: "end_turn" }));
jest.mock("@anthropic-ai/sdk", () => jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })));

const { prisma } = require("../../../config/db");
const gateway = require("../gateway");
const aiContext = require("../context");

const who = { orgId: "org-1", userId: "u-1", projectId: "p-1", actorKind: "human" };
const totals = (orgTokens, userTokens, userCalls) => {
  prisma.aiRun.aggregate.mockImplementation(async ({ where }) => (where.userId ? { _sum: { inputTokens: userTokens, outputTokens: 0 }, _count: { _all: userCalls } } : { _sum: { inputTokens: orgTokens, outputTokens: 0 }, _count: { _all: 0 } }));
};
const ask = (feature = "assistant.ask", maxTokens = 1500) => aiContext.runWith(who, () => gateway.complete({ feature, system: "s", messages: [{ role: "user", content: "q" }], maxTokens }));

describe("AI gateway spending guard (live provider)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...saved, AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real", AI_MODEL: "claude-sonnet-5-5", AI_RETRY_BASE_MS: "1" };
    delete process.env.AI_FAST_MODEL;
    delete process.env.AI_DAILY_TOKEN_LIMIT_ORG;
    delete process.env.AI_DAILY_TOKEN_LIMIT_USER;
    delete process.env.AI_DAILY_REQUEST_LIMIT_USER;
    delete process.env.AI_MAX_OUTPUT_TOKENS;
  });
  afterAll(() => { process.env = saved; });

  test("under the limits the call goes through, with the answer length capped", async () => {
    totals(0, 0, 0);
    const result = await ask("assistant.ask", 5000);
    expect(result).toMatchObject({ text: "ok", provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(2000);
    expect(prisma.aiRun.aggregate.mock.calls[0][0].where).toMatchObject({ status: "ok", provider: { not: "mock" } });
  });

  test("the company's daily tokens reached: no provider call, a blocked ledger row, the degradable error", async () => {
    totals(1_000_000, 0, 0);
    await expect(ask()).rejects.toMatchObject({ status: 429, code: "AI_UNAVAILABLE", details: { reason: "budget", scope: "organisation" } });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(prisma.aiRun.create.mock.calls[0][0].data).toMatchObject({ status: "blocked", errorClass: "budget", orgId: "org-1", userId: "u-1" });
  });

  test("one user's daily tokens or calls reached blocks that user", async () => {
    totals(10, 250_000, 1);
    await expect(ask()).rejects.toMatchObject({ details: { scope: "user" } });
    totals(10, 10, 150);
    await expect(ask()).rejects.toMatchObject({ details: { scope: "user" } });
    process.env.AI_DAILY_REQUEST_LIMIT_USER = "0";
    await expect(ask()).resolves.toMatchObject({ text: "ok" });
  });

  test("search interpretation uses the fast model when one is set", async () => {
    totals(0, 0, 0);
    process.env.AI_FAST_MODEL = "claude-haiku-5-5";
    await ask("search.interpret");
    await ask("assistant.ask");
    expect(mockCreate.mock.calls.map(([args]) => args.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });

  test("a model that rejects temperature is retried once without it, and remembered", async () => {
    totals(0, 0, 0);
    process.env.AI_MODEL = "claude-test-no-temperature";
    mockCreate.mockImplementationOnce(async () => { throw Object.assign(new Error("`temperature` is deprecated for this model."), { status: 400 }); });
    await expect(ask()).resolves.toMatchObject({ text: "ok" });
    await expect(ask()).resolves.toMatchObject({ text: "ok" });
    const sent = mockCreate.mock.calls.map(([args]) => ("temperature" in args ? args.temperature : "omitted"));
    expect(sent).toEqual([0.2, "omitted", "omitted"]);
    // Any other bad request is not retried.
    mockCreate.mockImplementationOnce(async () => { throw Object.assign(new Error("max_tokens too large"), { status: 400 }); });
    await expect(ask()).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });

  test("the mock is never limited and never queries the ledger", async () => {
    process.env.AI_PROVIDER = "mock";
    totals(9_999_999, 9_999_999, 9_999);
    // AI_MODEL (the staged live model) does not rename the mock.
    await expect(ask()).resolves.toMatchObject({ provider: "mock", model: "octapm-mock-1" });
    expect(prisma.aiRun.aggregate).not.toHaveBeenCalled();
  });
});
