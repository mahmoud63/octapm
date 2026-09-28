/**
 * What a failing request shows the client, against the real Postgres.
 *
 * Before: the handler sent err.message for any error, so in production a
 * Prisma validation error returned the whole User column list (passwordHash,
 * mfaSecretEnc…), a raw-query error named the relation, and internal codes
 * such as P2025 or P2010 leaked as error.code. Now only deliberate errors keep
 * their words in production; development keeps the raw text for developers.
 */
const { prisma } = require("../config/db");
const { createLiveOrg, dropLiveOrg, freePort, liveDescribe, spawnNode } = require("./helpers");
const { BLANK } = require("./fixtures/edge-env");

const ENTRY = "src/__live__/fixtures/error-probe-server.js";
const LEAK = /prisma|invocation|relation|passwordHash|mfaSecret|no_such_table|Cannot read|P20\d\d|x-api-key/i;

const startProbe = async (nodeEnv) => {
  const port = await freePort();
  const proc = spawnNode(ENTRY, {
    env: { ...BLANK, PORT: String(port), NODE_ENV: nodeEnv },
  });
  await proc.waitForOutput(/running on port/);
  return { proc, base: `http://127.0.0.1:${port}` };
};

const call = async (base, path, init = {}) => {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text), requestId: response.headers.get("x-request-id") };
};

liveDescribe("error bodies", () => {
  let live;
  let production;
  let development;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    production = await startProbe("production");
    development = await startProbe("development");
  });

  afterAll(async () => {
    if (production) await production.proc.kill();
    if (development) await development.proc.kill();
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  it.each([
    ["a Prisma validation error", "/validation"],
    ["a raw query on a missing relation", "/p2010"],
    ["a TypeError", "/type-error"],
    ["a plain error carrying an upstream 401", "/upstream"],
  ])("hides %s behind a plain 500 in production", async (_label, path) => {
    const res = await call(production.base, path);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error", requestId: res.requestId },
    });
    expect(res.text).not.toMatch(LEAK);
  });

  it("answers a missing record with 404 and a taken unique value with 409, without Prisma text", async () => {
    const missing = await call(production.base, "/p2025");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    expect(missing.text).not.toMatch(LEAK);

    const taken = await call(production.base, "/p2002", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: live.org.id, email: live.user.email }),
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("CONFLICT");
    expect(taken.text).not.toMatch(LEAK);
  });

  it("keeps deliberate errors, body-parser and upload errors as their authors wrote them", async () => {
    const deliberate = await call(production.base, "/http-error");
    expect(deliberate.status).toBe(503);
    expect(deliberate.body.error).toMatchObject({
      code: "AI_NOT_CONFIGURED",
      message: "No AI provider is configured for this workspace",
    });

    const malformed = await call(production.base, "/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
    expect(malformed.body.error.message).toBe("The request body is not valid JSON.");

    const tooLarge = await call(production.base, "/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(4096) }),
    });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe("PAYLOAD_TOO_LARGE");

    const form = new FormData();
    form.append("file", new Blob(["eleven bytes"]), "big.txt");
    const upload = await call(production.base, "/upload", { method: "POST", body: form });
    expect(upload.status).toBe(413);
    expect(upload.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("keeps a 5xx HttpError's code but not the upstream text it wraps, in production only", async () => {
    const upstream = /ENOTFOUND|anthropic|x-api-key|sk-ant|LEAKEDSECRET|did not answer/i;

    const res = await call(production.base, "/upstream-5xx");
    expect(res.status).toBe(502);
    // AI_PROVIDER_ERROR has no catalogue entry and 502 no status default of
    // its own, so the message is the generic server one.
    expect(res.body).toEqual({
      success: false,
      error: { code: "AI_PROVIDER_ERROR", message: "Unexpected server error", requestId: res.requestId },
    });
    expect(res.text).not.toMatch(upstream);

    // The log still has the provider's words, next to the request id.
    await production.proc.waitForOutput(new RegExp(`"requestId":"${res.requestId}"`));
    const line = production.proc
      .output()
      .split(/\r?\n/)
      .find((entry) => entry.includes(`"requestId":"${res.requestId}"`));
    expect(JSON.parse(line).message).toMatch(/ENOTFOUND api\.anthropic\.com/);

    const dev = await call(development.base, "/upstream-5xx");
    expect(dev.status).toBe(502);
    expect(dev.body.error).toMatchObject({ code: "AI_PROVIDER_ERROR", message: expect.stringMatching(/sk-ant-api03-LEAKEDSECRET/) });
  });

  it("logs a production 500 as one JSON line with the request id and the real error", async () => {
    const res = await call(production.base, "/p2010");
    await production.proc.waitForOutput(new RegExp(`"requestId":"${res.requestId}"`));
    const line = production.proc
      .output()
      .split(/\r?\n/)
      .find((entry) => entry.includes(`"requestId":"${res.requestId}"`));
    const logged = JSON.parse(line);
    expect(logged).toMatchObject({ level: "error", msg: "unhandled_error", status: 500, path: "/p2010" });
    expect(logged.message).toMatch(/no_such_table_for_live_tests/);
  });

  it("still shows developers the raw error outside production", async () => {
    const res = await call(development.base, "/validation");
    expect(res.status).toBe(500);
    expect(res.body.error.message).toMatch(/Invalid `prisma\.user\.findMany\(\)` invocation/);
  });
});
