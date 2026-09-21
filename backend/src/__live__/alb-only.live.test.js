/**
 * An API that sits directly behind the load balancer boots in production and
 * serves its routes — and a mismatched edge configuration refuses to boot.
 *
 * Before: CLOUDFRONT_SHARED_SECRET was required at boot, and once set the
 * origin guard answered every request without the header with 403. No web or
 * mobile client sends it, so an ALB-only API would have refused everyone
 * while its /api/health check stayed green.
 */
const { freePort, liveDescribe, spawnNode } = require("./helpers");
const { productionEnv } = require("./fixtures/edge-env");

const ENTRY = "src/__live__/fixtures/edge-app-server.js";

liveDescribe("ALB-only production API", () => {
  const started = [];
  const start = (env) => {
    const proc = spawnNode(ENTRY, { env });
    started.push(proc);
    return proc;
  };

  afterAll(async () => {
    await Promise.all(started.map((proc) => proc.kill()));
  });

  it("boots with the full production contract and no CloudFront secret, and serves API routes", async () => {
    const port = await freePort();
    const env = productionEnv({ PORT: String(port) });
    const api = start(env);
    await api.waitForOutput(/running on port/);

    const spec = await fetch(`http://127.0.0.1:${port}/api/v1/openapi.json`);
    expect(spec.status).toBe(200);
    expect((await spec.json()).openapi).toBe("3.0.3");

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("x-octapm-release")).toBe(env.RELEASE_GIT_SHA);
  });

  it.each([
    ["the CloudFront secret with one hop", { CLOUDFRONT_SHARED_SECRET: "cloudfront-secret-with-32-plus-chars" }, /CLOUDFRONT_SHARED_SECRET must be unset when TRUST_PROXY_HOPS=1/],
    ["two hops without the secret", { TRUST_PROXY_HOPS: "2" }, /CLOUDFRONT_SHARED_SECRET is required when TRUST_PROXY_HOPS=2/],
    ["a hop count that is not a number", { TRUST_PROXY_HOPS: "abc" }, /TRUST_PROXY_HOPS must be 1/],
  ])("refuses to boot with %s", async (_label, overrides, message) => {
    const port = await freePort();
    const api = start(productionEnv({ PORT: String(port), ...overrides }));
    const { code, output } = await api.exited;
    expect(code).not.toBe(0);
    expect(output).toMatch(/Production environment validation failed/);
    expect(output).toMatch(message);
    expect(output).not.toMatch(/running on port/);
  });
});
