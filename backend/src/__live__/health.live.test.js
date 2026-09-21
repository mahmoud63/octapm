/**
 * Liveness, readiness and release identity, from real processes.
 *
 * - Liveness (/api/health, the load balancer's check, and /api/health/live)
 *   never touches the database, so it answers at once even when the database
 *   does not.
 * - Readiness gives up on a database that accepts connections and never
 *   answers after HEALTH_DB_TIMEOUT_MS, and answers 503 SERVICE_NOT_READY
 *   with no host or driver text; it also turns 503 while the process drains.
 * - Every response names the release in X-OctaPM-Release.
 * - In production behind CloudFront, all three health paths answer the load
 *   balancer, which never carries the CloudFront secret.
 */
const net = require("net");
const { freePort, liveDescribe, spawnNode } = require("./helpers");
const { BLANK, productionEnv, randomSha, rawDatabaseUrl } = require("./fixtures/edge-env");

const ENTRY = "src/__live__/fixtures/edge-app-server.js";

const timed = async (url, init) => {
  const started = Date.now();
  const response = await fetch(url, init);
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text), ms: Date.now() - started, headers: response.headers };
};

liveDescribe("service health", () => {
  const started = [];
  let blackHole;
  const sockets = new Set();

  const startApp = async (env) => {
    const port = await freePort();
    const proc = spawnNode(ENTRY, { env: { ...BLANK, PORT: String(port), ...env } });
    started.push(proc);
    await proc.waitForOutput(/running on port/);
    return { proc, base: `http://127.0.0.1:${port}` };
  };

  afterAll(async () => {
    await Promise.all(started.map((proc) => proc.kill()));
    for (const socket of sockets) socket.destroy();
    if (blackHole) await new Promise((resolve) => blackHole.close(resolve));
  });

  it("reports the release and a ready database, then refuses readiness while draining", async () => {
    const sha = randomSha();
    const { proc, base } = await startApp({
      NODE_ENV: "development",
      APP_ENV: "staging",
      RELEASE_GIT_SHA: sha,
      RELEASE_BUILD_TIME: "2026-09-21T12:00:00Z",
      DATABASE_URL: `${rawDatabaseUrl()}${rawDatabaseUrl().includes("?") ? "&" : "?"}connection_limit=1`,
    });

    const live = await timed(`${base}/api/health`);
    expect(live.status).toBe(200);
    expect(live.headers.get("x-octapm-release")).toBe(sha);
    expect(live.body.data).toMatchObject({
      status: "ok",
      release: { sha, builtAt: "2026-09-21T12:00:00Z", environment: "staging", version: expect.any(String) },
    });
    expect((await timed(`${base}/api/health/live`)).body.data.release.sha).toBe(sha);

    const ready = await timed(`${base}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({ status: "ready", checks: { database: { ok: true } }, release: { sha } });

    // The API's shutdown sets app.locals.draining first; readiness must say so.
    await proc.signal("SIGTERM");
    await proc.waitForOutput(/draining/);
    const draining = await timed(`${base}/api/health/ready`);
    expect(draining.status).toBe(503);
    expect(draining.body.error).toMatchObject({ code: "SERVICE_NOT_READY", details: { draining: true } });
    expect((await timed(`${base}/api/health`)).status).toBe(200);
  });

  it("stays live and turns not-ready within the timeout when the database never answers", async () => {
    blackHole = net.createServer((socket) => {
      // Accept and never answer; the app's process dies at the end with the
      // socket still open, which resets it.
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise((resolve) => blackHole.listen(0, "127.0.0.1", resolve));
    const holePort = blackHole.address().port;

    const { base } = await startApp({
      NODE_ENV: "development",
      HEALTH_DB_TIMEOUT_MS: "2000",
      DATABASE_URL: `postgresql://octapm_app:pw@127.0.0.1:${holePort}/octapm?connect_timeout=30&connection_limit=1`,
    });

    const live = await timed(`${base}/api/health`);
    expect(live.status).toBe(200);
    expect(live.ms).toBeLessThan(200);

    const ready = await timed(`${base}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(ready.body.error.code).toBe("SERVICE_NOT_READY");
    expect(ready.body.error.details.checks.database).toMatchObject({ ok: false, reason: "timeout" });
    expect(ready.ms).toBeGreaterThanOrEqual(1900);
    expect(ready.ms).toBeLessThan(2600);
    expect(ready.text).not.toContain("127.0.0.1");
    expect(ready.text).not.toContain(String(holePort));
    expect(ready.text).not.toMatch(/octapm_app|postgres|prisma/i);

    // Liveness is still immediate while a readiness probe is stuck.
    const [again] = await Promise.all([timed(`${base}/api/health/live`), timed(`${base}/api/health/ready`)]);
    expect(again.status).toBe(200);
    expect(again.ms).toBeLessThan(200);
  });

  it("answers every health path in production behind CloudFront without the secret header", async () => {
    const secret = "cloudfront-secret-with-32-plus-characters";
    const env = productionEnv({ TRUST_PROXY_HOPS: "2", CLOUDFRONT_SHARED_SECRET: secret, HEALTH_DB_TIMEOUT_MS: "300" });
    const { base } = await startApp(env);

    for (const path of ["/api/health", "/api/health/live", "/api/health/", "/api/health/ready"]) {
      const response = await timed(`${base}${path}`);
      expect({ path, status: response.status }).toEqual({ path, status: path.endsWith("ready") ? 503 : 200 });
      expect(response.headers.get("x-octapm-release")).toBe(env.RELEASE_GIT_SHA);
    }

    const guarded = await timed(`${base}/api/v1/openapi.json`);
    expect(guarded.status).toBe(403);
    expect(guarded.body.error.code).toBe("CLOUDFRONT_ORIGIN_REQUIRED");
    expect((await fetch(`${base}/api/v1/openapi.json`, { headers: { "x-cloudfront-secret": secret } })).status).toBe(200);
  });
});
