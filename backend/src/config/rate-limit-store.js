/**
 * Rate-limit counter stores.
 *
 * A store answers `hit(key, windowMs) -> { count, resetAt }` for a fixed
 * window. Three stores keep that one contract:
 *
 * - memory: process-local (development, tests, a single instance).
 * - postgres: one row per key in the UNLOGGED "RateLimitBucket" table, shared
 *   by every API task that reaches the same database. This is the production
 *   default, because RDS is already on the critical path and needs no extra
 *   service.
 * - redis: shared counters in Redis, used whenever REDIS_URL is set.
 *
 * A shared store is wrapped so that, if it fails at request time, the limiter
 * falls back to the memory store for that request and logs once per minute.
 * An outage then degrades to per-instance limits instead of blocking traffic.
 */

// The memory store drops expired windows at most this often, so a stream of
// one-off keys (random emails, rotating addresses) cannot grow the Map forever.
const MEMORY_SWEEP_INTERVAL_MS = 60_000;

const createMemoryStore = () => {
  const entries = new Map();
  let lastSweep = 0;

  const sweep = (now) => {
    if (now - lastSweep < MEMORY_SWEEP_INTERVAL_MS && now >= lastSweep) return;
    lastSweep = now;
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  };

  return {
    kind: "memory",
    async hit(key, windowMs, now = Date.now()) {
      sweep(now);
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

/**
 * Counters in Postgres. Each hit is one statement: the insert starts a window,
 * and on conflict the same statement either counts the hit or, when the stored
 * window has ended, restarts it at 1. Postgres takes the row lock for the
 * conflicting update, so two tasks hitting one key at the same moment always
 * see 1 and 2, never 1 and 1.
 *
 * Times are the application clock (`now`), the same clock the memory and Redis
 * stores use, written as UTC wall-clock like every other Prisma timestamp in
 * the schema. The window end comes back as epoch milliseconds so no timezone
 * conversion sits between the database and the caller.
 */
const createPostgresStore = ({ prisma, prefix = "" }) => {
  if (!prisma) {
    throw new Error("createPostgresStore requires a Prisma client");
  }

  const fullKey = (key) => `${prefix}${key}`;
  const utc = (ms) => new Date(ms).toISOString();

  return {
    kind: "postgres",
    async hit(key, windowMs, now = Date.now()) {
      const rows = await prisma.$queryRaw`
        INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
        VALUES (${fullKey(key)}, 1, ${utc(now + windowMs)}::timestamp(3))
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE
            WHEN "RateLimitBucket"."resetAt" <= ${utc(now)}::timestamp(3) THEN 1
            ELSE "RateLimitBucket"."count" + 1
          END,
          "resetAt" = CASE
            WHEN "RateLimitBucket"."resetAt" <= ${utc(now)}::timestamp(3) THEN EXCLUDED."resetAt"
            ELSE "RateLimitBucket"."resetAt"
          END
        RETURNING "count", (EXTRACT(EPOCH FROM "resetAt") * 1000)::float8 AS "resetAtMs"`;
      const row = rows?.[0];
      if (!row) throw new Error("rate-limit upsert returned no row");
      return { count: Number(row.count), resetAt: Math.round(Number(row.resetAtMs)) };
    },
    async reset(key) {
      await prisma.rateLimitBucket.deleteMany({ where: { key: fullKey(key) } });
    },
    async clear() {
      await prisma.rateLimitBucket.deleteMany(prefix ? { where: { key: { startsWith: prefix } } } : {});
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

const STORE_KINDS = new Set(["memory", "postgres", "redis"]);

/**
 * Which store this process uses. RATE_LIMIT_STORE names one explicitly.
 * Without it: Redis when REDIS_URL is set, Postgres under NODE_ENV=production,
 * and memory everywhere else, so local development and the test suite keep
 * today's per-process counters with no new variable. (Production refusing
 * `memory` is enforced by validateProductionEnv, not here.)
 */
const selectStoreKind = (env) => {
  const explicit = String(env.RATE_LIMIT_STORE || "").trim().toLowerCase();
  if (STORE_KINDS.has(explicit)) return explicit;
  if (String(env.REDIS_URL || "").trim()) return "redis";
  if (env.NODE_ENV === "production") return "postgres";
  return "memory";
};

const resolveRateLimitStore = ({ env = process.env, logger = console, prisma = null } = {}) => {
  const memory = createMemoryStore();
  const kind = selectStoreKind(env);
  if (kind === "memory") return memory;

  if (kind === "postgres") {
    try {
      const client = prisma || require("./db").prisma;
      const store = createPostgresStore({ prisma: client });
      logger.log("[rate-limit] using shared Postgres counters");
      return createResilientStore({ primary: store, fallback: memory, logger });
    } catch (error) {
      logger.error(
        `[rate-limit] ${error.message}; falling back to per-instance memory counters`,
      );
      return memory;
    }
  }

  const url = String(env.REDIS_URL || "").trim();
  try {
    if (!url) throw new Error("RATE_LIMIT_STORE=redis needs REDIS_URL");
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

// A login-throttle row with no failure for a day holds nothing worth keeping.
const AUTH_THROTTLE_IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes shared-state rows that can no longer affect a decision: rate-limit
 * windows that have ended, and login-throttle rows untouched for a day whose
 * lock (if any) has run out. Safe to call from any process at any time; the
 * worker's prune interval calls it. Tables that do not exist yet (a database
 * behind on migrations) are skipped rather than failing the caller.
 */
const pruneSharedState = async ({ prisma = null, now = new Date() } = {}) => {
  const client = prisma || require("./db").prisma;
  const result = { rateLimitBuckets: 0, authThrottles: 0 };

  if (client.rateLimitBucket?.deleteMany) {
    const removed = await client.rateLimitBucket
      .deleteMany({ where: { resetAt: { lte: now } } })
      .catch(() => ({ count: 0 }));
    result.rateLimitBuckets = removed.count;
  }

  if (client.authThrottle?.deleteMany) {
    const removed = await client.authThrottle
      .deleteMany({
        where: {
          updatedAt: { lt: new Date(now.getTime() - AUTH_THROTTLE_IDLE_MS) },
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
        },
      })
      .catch(() => ({ count: 0 }));
    result.authThrottles = removed.count;
  }

  return result;
};

module.exports = {
  createMemoryStore,
  createPostgresStore,
  createRedisClient,
  createRedisStore,
  createResilientStore,
  getSharedRateLimitStore,
  pruneSharedState,
  resolveRateLimitStore,
  selectStoreKind,
  setSharedRateLimitStore,
};
