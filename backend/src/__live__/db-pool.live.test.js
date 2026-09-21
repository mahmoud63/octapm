/**
 * The Prisma pool each process opens, counted on the real Postgres.
 *
 * Before: nothing sized the pool, so every process took Prisma's default of
 * cores × 2 + 1 connections (33 on this machine) — N API tasks plus a worker
 * against one small RDS instance, doubled during a rolling deploy. Now
 * DATABASE_CONNECTION_LIMIT and DATABASE_POOL_TIMEOUT_SECONDS size it, a value
 * written into the URL wins, jest gets 3, and with neither set the client is
 * built exactly as before.
 *
 * Each probe runs six queries at once, each holding its connection briefly,
 * and reports how many distinct server backends answered.
 */
const { liveDescribe, spawnNode } = require("./helpers");
const { rawDatabaseUrl } = require("./fixtures/edge-env");

const ENTRY = "src/__live__/fixtures/pool-probe.js";

const probe = async (env) => {
  const proc = spawnNode(ENTRY, {
    env: {
      DATABASE_URL: rawDatabaseUrl(),
      DATABASE_CONNECTION_LIMIT: undefined,
      DATABASE_POOL_TIMEOUT_SECONDS: undefined,
      PROBE_CONCURRENCY: "6",
      PROBE_SLEEP_SECONDS: "0.6",
      ...env,
    },
  });
  const { code, output } = await proc.exited;
  const match = /POOL_RESULT (.*)/.exec(output);
  return { code, output, result: match ? JSON.parse(match[1]) : null };
};

const withParam = (url, param) => `${url}${url.includes("?") ? "&" : "?"}${param}`;

liveDescribe("database pool size", () => {
  it("takes its size from DATABASE_CONNECTION_LIMIT", async () => {
    const { code, result } = await probe({ NODE_ENV: "development", DATABASE_CONNECTION_LIMIT: "3" });
    expect({ code, result }).toEqual({ code: 0, result: { distinctPids: 3 } });
  });

  it("leaves the default pool alone in development when nothing is set", async () => {
    const { code, result } = await probe({ NODE_ENV: "development" });
    expect(code).toBe(0);
    expect(result.distinctPids).toBeGreaterThan(3);
  });

  it("lets a connection_limit written into the URL win over the environment", async () => {
    const { code, result } = await probe({
      NODE_ENV: "development",
      DATABASE_URL: withParam(rawDatabaseUrl(), "connection_limit=2"),
      DATABASE_CONNECTION_LIMIT: "3",
    });
    expect({ code, result }).toEqual({ code: 0, result: { distinctPids: 2 } });
  });

  it("keeps a jest process to three connections", async () => {
    const { code, result } = await probe({ NODE_ENV: "test" });
    expect({ code, result }).toEqual({ code: 0, result: { distinctPids: 3 } });
  });

  it("gives up waiting for a connection after DATABASE_POOL_TIMEOUT_SECONDS", async () => {
    const { code, result } = await probe({
      NODE_ENV: "development",
      DATABASE_CONNECTION_LIMIT: "1",
      DATABASE_POOL_TIMEOUT_SECONDS: "1",
      PROBE_MODE: "timeout",
      PROBE_SLEEP_SECONDS: "3",
    });
    expect(code).toBe(0);
    const failed = result.outcomes.filter((outcome) => !outcome.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0].code).toBe("P2024");
    expect(failed[0].atMs).toBeLessThan(2500);
  });

  it("refuses a pool size that is not a number instead of silently using the default", async () => {
    const { code, output } = await probe({ NODE_ENV: "development", DATABASE_CONNECTION_LIMIT: "abc" });
    expect(code).not.toBe(0);
    expect(output).toMatch(/POOL_ERROR DATABASE_CONNECTION_LIMIT must be a positive whole number/);
  });
});
