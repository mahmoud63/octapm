/**
 * Rate limits shared by every API task through Postgres.
 *
 * Two real API processes, each with its own Prisma pool, count one login
 * window together: three attempts on A and two on B use up a limit of five,
 * so the sixth request is refused wherever it lands. The requests carry an
 * empty password, so validation answers 400 after the limiter has counted
 * them and the sign-in lockout never runs; a 429 can only come from the
 * shared counter.
 */
const crypto = require("crypto");
const { prisma } = require("../db");
const { createPostgresStore, pruneSharedState } = require("../rate-limit-store");
const { freePort, liveDescribe, spawnNode } = require("../../__live__/helpers");

const NODE_ENTRY = "src/services/__live__/shared-state-node.js";

const startNode = async (env = {}) => {
  const port = await freePort();
  const node = spawnNode(NODE_ENTRY, { env: { PORT: String(port), ...env } });
  await node.waitForOutput(/running on port/);
  return { node, base: `http://127.0.0.1:${port}` };
};

const attemptLogin = (base, email) =>
  fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "" }),
  });

liveDescribe("rate limits shared across API tasks (Postgres store)", () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const email = `ratelimit-${tag}@octapm-live.test`;
  const nodes = [];

  afterAll(async () => {
    await Promise.all(nodes.map((entry) => entry.node.kill()));
    await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: tag } } });
    await prisma.$disconnect();
  });

  it("three login attempts on A and two on B use up one limit of five: the sixth gets 429", async () => {
    const env = { RATE_LIMIT_STORE: "postgres", RATE_LIMIT_LOGIN_MAX: "5" };
    const [a, b] = await Promise.all([startNode(env), startNode(env)]);
    nodes.push(a, b);

    const statuses = [];
    const remaining = [];
    for (const target of [a, a, a, b, b]) {
      const response = await attemptLogin(target.base, email);
      statuses.push(response.status);
      remaining.push(Number(response.headers.get("ratelimit-remaining")));
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400]);
    expect(remaining).toEqual([4, 3, 2, 1, 0]);

    const sixth = await attemptLogin(a.base, email);
    const body = await sixth.json();
    expect({ status: sixth.status, code: body.error?.code }).toEqual({ status: 429, code: "RATE_LIMITED" });
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts concurrent hits on one key exactly once each, and prunes ended windows", async () => {
    const store = createPostgresStore({ prisma });
    const key = `live-concurrency:${tag}`;
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 12 }, () => store.hit(key, 60_000, now)));
    expect(results.map((row) => row.count).sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(results.map((row) => row.resetAt))).toEqual(new Set([now + 60_000]));

    // A window that has ended starts again at 1 with a fresh end.
    const later = now + 61_000;
    expect(await store.hit(key, 60_000, later)).toEqual({ count: 1, resetAt: later + 60_000 });

    const ended = `live-ended:${tag}`;
    await store.hit(ended, 1, now - 10_000);
    const pruned = await pruneSharedState({ prisma, now: new Date(now) });
    expect(pruned.rateLimitBuckets).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: ended } })).toBeNull();
    expect(await prisma.rateLimitBucket.findUnique({ where: { key } })).not.toBeNull();
  });
});
