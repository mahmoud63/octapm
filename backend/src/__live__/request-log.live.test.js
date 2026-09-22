/**
 * The production request log keeps secrets out of CloudWatch.
 *
 * Before: morgan('dev') ran in production too and printed every URL whole —
 * vendor portal tokens, invitation tokens, OAuth codes and states, the
 * inbound webhook's ?token=, an email in ?email= — in ANSI colour with no
 * request id. Now production writes one JSON line per request with those
 * segments masked and only the names of query parameters; local development
 * keeps morgan exactly as before.
 */
const crypto = require("crypto");
const { prisma } = require("../config/db");
const { createLiveOrg, dropLiveOrg, freePort, liveDescribe, sleep, spawnNode } = require("./helpers");
const { BLANK, rawDatabaseUrl } = require("./fixtures/edge-env");

const ENTRY = "src/__live__/fixtures/edge-app-server.js";
const token = (length = 40) => crypto.randomBytes(length).toString("base64url").slice(0, length);

liveDescribe("request log", () => {
  let live;
  const started = [];

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
  });

  afterAll(async () => {
    await Promise.all(started.map((proc) => proc.kill()));
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  const startApp = async (env) => {
    const port = await freePort();
    const proc = spawnNode(ENTRY, {
      env: {
        ...BLANK,
        PORT: String(port),
        DATABASE_URL: `${rawDatabaseUrl()}${rawDatabaseUrl().includes("?") ? "&" : "?"}connection_limit=2`,
        // Neither test sets a format: each must get its environment's default.
        REQUEST_LOG_FORMAT: undefined,
        ...env,
      },
    });
    started.push(proc);
    await proc.waitForOutput(/running on port/);
    return { proc, base: `http://127.0.0.1:${port}` };
  };

  it("writes JSON lines in production with every token, code, state and email masked", async () => {
    const { proc, base } = await startApp({ NODE_ENV: "production", TRUST_PROXY_HOPS: "1", CORS_ALLOWED_ORIGINS: "https://app.example.com" });
    const T = Array.from({ length: 9 }, (_, index) => (index === 8 ? token(32) : token()));
    const email = `secret.person.${crypto.randomUUID().slice(0, 8)}@example.com`;
    const documentId = crypto.randomUUID();

    const requests = [
      ["GET", `/api/v1/public/bids/${T[0]}/documents/${documentId}`],
      ["GET", `/api/v1/public/rfqs/${T[1]}`],
      ["GET", `/api/v1/auth/invitations/${T[2]}`],
      ["GET", `/api/v1/auth/sso/callback?code=${T[3]}&state=${T[4]}`],
      ["GET", `/api/v1/integrations/accounting/quickbooks/callback?code=${T[5]}&state=${T[6]}&realmId=1`],
      ["POST", `/api/v1/public/inbound-email/postmark?token=${T[7]}`],
      ["GET", `/api/v1/auth/sso/lookup?email=${encodeURIComponent(email)}`],
      ["GET", `/api/v1/some-future-route/${T[8]}`],
      ["GET", "/api/v1/auth/me", { authorization: `Bearer ${live.token}` }],
      ["GET", "/api/health"],
    ];

    const sent = [];
    for (const [method, path, headers = {}] of requests) {
      const response = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        headers: { "content-type": "application/json", ...headers },
        body: method === "POST" ? "{}" : undefined,
      });
      await response.arrayBuffer();
      sent.push({ path, status: response.status, requestId: response.headers.get("x-request-id") });
    }
    await sleep(300);

    const output = proc.output();
    for (const secret of [...T, email, encodeURIComponent(email)]) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toMatch(/\[/);

    // Other modules print plain start-up notes ("[schedule] …"); no request
    // is ever logged as anything but a JSON line.
    const lines = output.split(/\r?\n/);
    expect(lines.filter((line) => /^(GET|POST|PUT|PATCH|DELETE) \//.test(line))).toEqual([]);
    const records = lines.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
    // A 5xx also has its unhandled_error line; the request line is the one here.
    const byRequest = (requestId) =>
      records.find((record) => record.msg === "request" && record.requestId === requestId);

    const bids = byRequest(sent[0].requestId);
    expect(bids.path).toBe(`/api/v1/public/bids/:token/documents/${documentId}`);
    expect(byRequest(sent[1].requestId).path).toBe("/api/v1/public/rfqs/:token");
    expect(byRequest(sent[2].requestId).path).toBe("/api/v1/auth/invitations/:token");
    expect(byRequest(sent[3].requestId).queryKeys).toEqual(["code", "state"]);
    expect(byRequest(sent[4].requestId).queryKeys).toEqual(["code", "realmId", "state"]);
    expect(byRequest(sent[5].requestId).queryKeys).toEqual(["token"]);
    expect(byRequest(sent[6].requestId).queryKeys).toEqual(["email"]);
    expect(byRequest(sent[7].requestId).path).toBe("/api/v1/some-future-route/:redacted");

    const me = byRequest(sent[8].requestId);
    expect(me).toMatchObject({ method: "GET", path: "/api/v1/auth/me", status: 200, userId: live.user.id, orgId: live.org.id });
    expect(typeof me.durationMs).toBe("number");

    // Every request but the healthy health check has its line.
    expect(byRequest(sent[9].requestId)).toBeUndefined();
    for (const { requestId, status } of sent.slice(0, 9)) {
      expect(byRequest(requestId)).toMatchObject({ msg: "request", status });
    }
  });

  it("keeps morgan's development lines locally when nothing is set", async () => {
    const { proc, base } = await startApp({ NODE_ENV: "development" });
    await (await fetch(`${base}/api/health`)).arrayBuffer();
    await proc.waitForOutput(/GET \/api\/health.*200/);
    expect(proc.output()).not.toMatch(/^\{/m);
  });
});
