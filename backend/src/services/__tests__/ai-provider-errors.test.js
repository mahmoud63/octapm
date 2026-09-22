/**
 * The AI provider's own words stay in the server log.
 *
 * Callers put the message of AI_UNAVAILABLE / AI_TRANSCRIPTION_FAILED into
 * 200 "degraded" answers (the assistants, contract notices) and production
 * 5xx bodies carry it as well, so an upstream host name, quota text or echoed
 * key prefix must never be in it. These drive the real functions with a
 * failing transport — no network, no database.
 */
const aiProvider = require("../ai-provider.service");

const UPSTREAM = "getaddrinfo ENOTFOUND api.anthropic.com — invalid x-api-key sk-ant-api03-LEAKEDSECRET";
const LEAK = /ENOTFOUND|anthropic\.com|x-api-key|sk-ant|LEAKEDSECRET/;

describe("AI provider errors", () => {
  let logged;
  beforeEach(() => {
    logged = [];
    jest.spyOn(console, "error").mockImplementation((...args) => logged.push(args.join(" ")));
  });
  afterEach(() => jest.restoreAllMocks());

  it("says the provider did not answer, and logs what it said instead of repeating it", async () => {
    const transport = async () => { throw new Error(UPSTREAM); };
    const error = await aiProvider.complete({ system: "s", messages: [{ role: "user", content: "hi" }], transport, retries: 1 }).catch((e) => e);
    expect(error).toMatchObject({ status: 503, code: "AI_UNAVAILABLE", retryable: true });
    expect(error.message).toBe("The AI provider did not answer. Try again shortly.");
    expect(error.message).not.toMatch(LEAK);
    expect(logged.join("\n")).toContain("LEAKEDSECRET");
  });

  it("says transcription failed without the provider's reply", async () => {
    const previous = { key: process.env.OPENAI_API_KEY, off: process.env.AI_TRANSCRIPTION };
    process.env.OPENAI_API_KEY = "sk-test-transcription";
    delete process.env.AI_TRANSCRIPTION;
    try {
      const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: UPSTREAM } }), text: async () => JSON.stringify({ error: { message: UPSTREAM } }) });
      const error = await aiProvider.transcribeAudio({ buffer: Buffer.from("audio"), fetchImpl }).catch((e) => e);
      expect(error).toMatchObject({ status: 503, code: "AI_TRANSCRIPTION_FAILED" });
      expect(error.message).toBe("Transcription failed. Try again shortly.");
      expect(error.message).not.toMatch(LEAK);
      expect(logged.join("\n")).toContain("LEAKEDSECRET");
    } finally {
      if (previous.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.key;
      if (previous.off !== undefined) process.env.AI_TRANSCRIPTION = previous.off;
    }
  });
});
