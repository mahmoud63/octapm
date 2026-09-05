const {
  createMemoryStore,
  createRedisStore,
  createResilientStore,
  resolveRateLimitStore,
} = require("../rate-limit-store");

const createFakeRedis = () => {
  const data = new Map();
  const expiry = new Map();
  const now = () => Date.now();
  const client = {
    calls: [],
    multi() {
      const ops = [];
      const chain = {
        incr: (key) => {
          ops.push(["incr", key]);
          return chain;
        },
        pttl: (key) => {
          ops.push(["pttl", key]);
          return chain;
        },
        exec: async () =>
          ops.map(([op, key]) => {
            if (op === "incr") {
              const next = (data.get(key) || 0) + 1;
              data.set(key, next);
              return [null, next];
            }
            const until = expiry.get(key);
            return [null, until ? Math.max(0, until - now()) : -1];
          }),
      };
      return chain;
    },
    async pexpire(key, ms) {
      client.calls.push(["pexpire", key, ms]);
      expiry.set(key, now() + ms);
      return 1;
    },
    async del(...keys) {
      keys.forEach((key) => {
        data.delete(key);
        expiry.delete(key);
      });
      return keys.length;
    },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, "");
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
  };
  return client;
};

describe("rate limit stores", () => {
  it("memory store counts within a window and resets after it", async () => {
    const store = createMemoryStore();
    const start = 1_000;

    expect(await store.hit("k", 100, start)).toEqual({ count: 1, resetAt: 1_100 });
    expect(await store.hit("k", 100, start + 50)).toEqual({
      count: 2,
      resetAt: 1_100,
    });
    expect(await store.hit("k", 100, start + 150)).toEqual({
      count: 1,
      resetAt: 1_250,
    });
  });

  it("redis store increments atomically and starts the window on first hit", async () => {
    const client = createFakeRedis();
    const store = createRedisStore({ client, prefix: "rl:" });

    const first = await store.hit("api:1.2.3.4", 60_000, 5_000);
    const second = await store.hit("api:1.2.3.4", 60_000, 5_000);

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(client.calls).toEqual([["pexpire", "rl:api:1.2.3.4", 60_000]]);
    expect(second.resetAt).toBeGreaterThan(5_000);

    await store.clear();
    expect(await client.keys("rl:*")).toEqual([]);
  });

  it("falls back to the memory store when the primary store fails", async () => {
    const failing = {
      kind: "redis",
      hit: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      reset: jest.fn(),
      clear: jest.fn(),
    };
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    const store = createResilientStore({
      primary: failing,
      fallback: createMemoryStore(),
      logger,
    });

    const result = await store.hit("k", 1_000, 10);

    expect(result.count).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await store.hit("k", 1_000, 20);
    expect(logger.warn).toHaveBeenCalledTimes(1); // throttled
  });

  it("uses memory when REDIS_URL is unset and degrades gracefully when the client cannot be built", () => {
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    expect(resolveRateLimitStore({ env: {}, logger }).kind).toBe("memory");

    jest.doMock("ioredis", () => {
      throw new Error("module missing");
    });
    const store = resolveRateLimitStore({
      env: { REDIS_URL: "redis://localhost:6379" },
      logger,
    });
    expect(store.kind).toBe("memory");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("falling back to per-instance memory counters"),
    );
    jest.dontMock("ioredis");
  });
});
