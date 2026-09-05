/**
 * Rate-limit counter stores.
 *
 * A store answers `hit(key, windowMs) -> { count, resetAt }` for a fixed
 * window. The memory store is process-local (development, tests, single
 * instance). The Redis store shares counters across every API instance and is
 * selected automatically when REDIS_URL is set. If Redis is unreachable at
 * request time the limiter falls back to the memory store for that request
 * and logs once per minute, so an outage degrades to per-instance limits
 * instead of blocking traffic.
 */

const createMemoryStore = () => {
  const entries = new Map();

  return {
    kind: "memory",
    async hit(key, windowMs, now = Date.now()) {
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        entries.set(key, entry);
      }
      entry.count += 1;
      return { count: entry.count, resetAt: entry.resetAt };
    },
    async reset(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
};

const createRedisStore = ({ client, prefix = "ratelimit:" }) => {
  if (!client) {
    throw new Error("createRedisStore requires a Redis client");
  }

  const fullKey = (key) => `${prefix}${key}`;

  return {
    kind: "redis",
    async hit(key, windowMs, now = Date.now()) {
      const redisKey = fullKey(key);
      const results = await client.multi().incr(redisKey).pttl(redisKey).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      let ttl = Number(results?.[1]?.[1] ?? -1);

      if (!Number.isFinite(ttl) || ttl < 0) {
        // First hit in the window (or a key without expiry): start the window.
        await client.pexpire(redisKey, windowMs);
        ttl = windowMs;
      }

      return { count, resetAt: now + ttl };
    },
    async reset(key) {
      await client.del(fullKey(key));
    },
    async clear() {
      const keys = await client.keys(`${prefix}*`);
      if (keys.length) await client.del(...keys);
    },
  };
};

const createRedisClient = ({ url, logger = console } = {}) => {
  let Redis;
  try {
    // Optional dependency: only needed when REDIS_URL is configured.
    Redis = require("ioredis");
  } catch (error) {
    throw new Error(
      `REDIS_URL is set but the "ioredis" package is not installed (${error.message})`,
    );
  }

  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5000,
  });

  let lastErrorLog = 0;
  client.on("error", (error) => {
    const now = Date.now();
    if (now - lastErrorLog > 60_000) {
      lastErrorLog = now;
      logger.error("[rate-limit] redis error:", error.message);
    }
  });
  client.connect().catch(() => {
    // Errors surface through the "error" listener and per-request fallback.
  });

  return client;
};

const createResilientStore = ({ primary, fallback, logger = console }) => {
  let lastFallbackLog = 0;

  return {
    kind: `${primary.kind}+fallback`,
    primary,
    fallback,
    async hit(key, windowMs, now = Date.now()) {
      try {
        return await primary.hit(key, windowMs, now);
      } catch (error) {
        const stamp = Date.now();
        if (stamp - lastFallbackLog > 60_000) {
          lastFallbackLog = stamp;
          logger.warn(
            `[rate-limit] ${primary.kind} store unavailable (${error.message}); using per-instance limits`,
          );
        }
        return fallback.hit(key, windowMs, now);
      }
    },
    async reset(key) {
      await Promise.allSettled([primary.reset(key), fallback.reset(key)]);
    },
    clear() {
      fallback.clear();
      return Promise.resolve(primary.clear?.()).catch(() => {});
    },
  };
};

const resolveRateLimitStore = ({ env = process.env, logger = console } = {}) => {
  const memory = createMemoryStore();
  const url = String(env.REDIS_URL || "").trim();
  if (!url) return memory;

  try {
    const client = createRedisClient({ url, logger });
    const redis = createRedisStore({ client, prefix: env.RATE_LIMIT_REDIS_PREFIX });
    logger.log("[rate-limit] using shared Redis counters");
    return createResilientStore({ primary: redis, fallback: memory, logger });
  } catch (error) {
    logger.error(
      `[rate-limit] ${error.message}; falling back to per-instance memory counters`,
    );
    return memory;
  }
};

let sharedStore = null;

const getSharedRateLimitStore = () => {
  if (!sharedStore) sharedStore = resolveRateLimitStore();
  return sharedStore;
};

const setSharedRateLimitStore = (store) => {
  sharedStore = store || null;
  return sharedStore;
};

module.exports = {
  createMemoryStore,
  createRedisClient,
  createRedisStore,
  createResilientStore,
  getSharedRateLimitStore,
  resolveRateLimitStore,
  setSharedRateLimitStore,
};
