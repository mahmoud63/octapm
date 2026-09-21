/**
 * req.ip follows TRUST_PROXY_HOPS, seen through the rate limiter over real
 * HTTP.
 *
 * Behind the ALB (one hop) the client is the last X-Forwarded-For entry, the
 * one the ALB itself appended; whatever a client wrote to the left of it is
 * ignored. So two requests from one client with different spoofed prefixes
 * share a rate-limit bucket, and a different client gets a fresh one:
 * remaining 99, 98, 99. Were trust proxy off, every request would share the
 * load balancer's bucket (99, 98, 97) — one abusive client would throttle
 * everybody, and the login lockout would lock out everyone behind the ALB.
 */
const crypto = require("crypto");
const { freePort, liveDescribe, spawnNode } = require("./helpers");
const { BLANK, rawDatabaseUrl } = require("./fixtures/edge-env");

const ENTRY = "src/__live__/fixtures/edge-app-server.js";

// Addresses from the benchmark range, fresh per run, so a counter left by an
// earlier run (the shared store is Postgres in production) cannot interfere.
const randomAddress = () => {
  const [a, b, c] = crypto.randomBytes(3);
  return `198.${18 + (a % 2)}.${b}.${1 + (c % 250)}`;
};

liveDescribe("trusted proxy hops", () => {
  let api;

  afterAll(async () => {
    if (api) await api.kill();
  });

  it("keys limits on the client the load balancer saw, not on spoofed entries or the balancer", async () => {
    const port = await freePort();
    api = spawnNode(ENTRY, {
      env: {
        ...BLANK,
        PORT: String(port),
        NODE_ENV: "production",
        TRUST_PROXY_HOPS: "1",
        CORS_ALLOWED_ORIGINS: "https://app.example.com",
        DATABASE_URL: `${rawDatabaseUrl()}${rawDatabaseUrl().includes("?") ? "&" : "?"}connection_limit=2`,
        RATE_LIMIT_API_MAX: "100",
        RATE_LIMIT_API_WINDOW_MS: "900000",
        // The production default: JSON request lines, so the logged ip can be read.
        REQUEST_LOG_FORMAT: undefined,
      },
    });
    await api.waitForOutput(/running on port/);

    const client = randomAddress();
    const other = randomAddress();
    const probe = async (forwardedFor) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/__proxy-ip-probe`, {
        headers: { "x-forwarded-for": forwardedFor, "x-request-id": `proxy-${crypto.randomUUID()}` },
      });
      return { remaining: response.headers.get("ratelimit-remaining"), requestId: response.headers.get("x-request-id") };
    };

    const first = await probe(`10.9.8.7, ${client}`);
    const second = await probe(`6.6.6.6, ${client}`);
    const third = await probe(other);

    expect([first.remaining, second.remaining, third.remaining]).toEqual(["99", "98", "99"]);

    // The request log records the same client address.
    await api.waitForOutput(new RegExp(third.requestId));
    const lines = api
      .output()
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    const ipOf = (requestId) => lines.find((line) => line.requestId === requestId)?.ip;
    expect(ipOf(first.requestId)).toBe(client);
    expect(ipOf(second.requestId)).toBe(client);
    expect(ipOf(third.requestId)).toBe(other);
  });
});
