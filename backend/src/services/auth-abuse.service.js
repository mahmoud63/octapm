const { HttpError } = require('../utils/http-error');

const EMAIL_BACKOFF_AFTER = 3;
const EMAIL_LOCK_AFTER = 5;
const IP_BACKOFF_AFTER = 15;
const IP_LOCK_AFTER = 30;
const LOCKOUT_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 60_000;

const EMAIL_LIMITS = { backoffAfter: EMAIL_BACKOFF_AFTER, lockAfter: EMAIL_LOCK_AFTER };
const IP_LIMITS = { backoffAfter: IP_BACKOFF_AFTER, lockAfter: IP_LOCK_AFTER };

let nowOverride = null;

function nowMs() {
  return nowOverride ? nowOverride.getTime() : Date.now();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function retryAfterSeconds(until, now) {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function throwIfBlocked(entry, scope, currentNow) {
  if (entry.lockedUntil && entry.lockedUntil > currentNow) {
    throw new HttpError(
      429,
      'LOGIN_TEMPORARILY_LOCKED',
      'Too many failed login attempts. Try again later.',
      {
        scope,
        retryAfterSeconds: retryAfterSeconds(entry.lockedUntil, currentNow),
      },
    );
  }

  if (entry.backoffUntil && entry.backoffUntil > currentNow) {
    throw new HttpError(
      429,
      'LOGIN_BACKOFF',
      'Too many failed login attempts. Wait briefly before trying again.',
      {
        scope,
        retryAfterSeconds: retryAfterSeconds(entry.backoffUntil, currentNow),
      },
    );
  }
}

function computeBackoffMs(failures, backoffAfter) {
  if (failures < backoffAfter) return null;
  return Math.min(MAX_BACKOFF_MS, 2 ** (failures - backoffAfter) * 5_000);
}

/**
 * What a failure count means, given when it happened: the lock or backoff to
 * apply, or null when the count is still below both thresholds. Both stores
 * call this one function, so the thresholds and the curve cannot drift apart.
 */
function penaltyFor(failures, { backoffAfter, lockAfter }, currentNow) {
  if (failures >= lockAfter) {
    return { lockedUntil: currentNow + LOCKOUT_MS, backoffUntil: null };
  }
  const backoffMs = computeBackoffMs(failures, backoffAfter);
  return backoffMs ? { backoffUntil: currentNow + backoffMs } : null;
}

// ─── Stores ────────────────────────────────────────────────────────────────
//
// Timestamps travel as epoch milliseconds between this module and a store.
// Every store answers the same four questions, so the rules above are written
// once and the only thing that changes between one API task and several is
// where the counts are kept.

/**
 * Counts held in this process. What development, the tests and a single
 * instance have always used; with more than one task each task would count
 * on its own, and an attacker spread across them would get N times the tries.
 */
function createMemoryThrottleStore() {
  const scopes = { email: new Map(), ip: new Map() };

  return {
    kind: 'memory',
    async read(scope, key) {
      return scopes[scope].get(key) || null;
    },
    async recordFailure(scope, key, limits, currentNow) {
      const store = scopes[scope];
      const entry = store.get(key) || { failures: 0, backoffUntil: null, lockedUntil: null };
      store.set(key, entry);
      entry.failures += 1;
      Object.assign(entry, penaltyFor(entry.failures, limits, currentNow) || {});
    },
    async clear(scope, key) {
      scopes[scope].delete(key);
    },
    async repay(scope, key, currentNow) {
      const store = scopes[scope];
      const entry = store.get(key);
      if (!entry) return;
      if (entry.lockedUntil && entry.lockedUntil > currentNow) return;
      entry.failures = Math.max(0, entry.failures - 1);
      entry.lockedUntil = null;
      entry.backoffUntil = null;
      if (entry.failures === 0) store.delete(key);
    },
    reset() {
      scopes.email.clear();
      scopes.ip.clear();
    },
  };
}

const toMs = (value) => (value ? new Date(value).getTime() : null);
const toDate = (value) => (value === null || value === undefined ? value : new Date(value));

/**
 * Counts held in the AuthThrottle table, where every API task sees the same
 * number. Each change is a single conditional statement, so two tasks failing
 * the same email at the same instant both count, and a repayment cannot undo
 * a lock another task has just imposed.
 */
function createPostgresThrottleStore({ prisma }) {
  return {
    kind: 'postgres',
    async read(scope, key) {
      const row = await prisma.authThrottle.findUnique({
        where: { scope_key: { scope, key } },
      });
      if (!row) return null;
      return {
        failures: row.failures,
        backoffUntil: toMs(row.backoffUntil),
        lockedUntil: toMs(row.lockedUntil),
      };
    },
    async recordFailure(scope, key, limits, currentNow) {
      // The increment is one upsert, so concurrent failures on different
      // tasks never read the same count and write back the same "+1".
      // updatedAt is stored as UTC wall-clock time, as Prisma stores it.
      const rows = await prisma.$queryRaw`
        INSERT INTO "AuthThrottle" ("scope", "key", "failures", "updatedAt")
        VALUES (${scope}, ${key}, 1, (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("scope", "key") DO UPDATE
          SET "failures" = "AuthThrottle"."failures" + 1,
              "updatedAt" = EXCLUDED."updatedAt"
        RETURNING "failures"`;
      const failures = Number(rows[0]?.failures || 0);
      const penalty = penaltyFor(failures, limits, currentNow);
      if (!penalty) return;
      // Applied only while the count is still the one this failure produced:
      // if another task has already counted a later failure, its penalty is
      // the newer one and must not be overwritten by this older, lighter one.
      await prisma.authThrottle.updateMany({
        where: { scope, key, failures },
        data: {
          ...('lockedUntil' in penalty ? { lockedUntil: toDate(penalty.lockedUntil) } : {}),
          backoffUntil: toDate(penalty.backoffUntil),
        },
      });
    },
    async clear(scope, key) {
      await prisma.authThrottle.deleteMany({ where: { scope, key } });
    },
    async repay(scope, key, currentNow) {
      const now = new Date(currentNow);
      // A running lock is served in full, exactly as in memory: the condition
      // on lockedUntil is part of the statement, not a check made beforehand.
      await prisma.authThrottle.updateMany({
        where: {
          scope,
          key,
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
        },
        data: {
          failures: { decrement: 1 },
          lockedUntil: null,
          backoffUntil: null,
        },
      });
      await prisma.authThrottle.deleteMany({ where: { scope, key, failures: { lte: 0 } } });
    },
    reset() {},
  };
}

const memoryStore = createMemoryThrottleStore();
let postgresStore = null;
let storeOverride = null;

/**
 * `memory` unless NODE_ENV=production, where the counts must be shared by
 * every task; AUTH_THROTTLE_STORE names either one explicitly. Production
 * refusing `memory` is the boot check's job (config/security.js).
 */
function resolveAuthThrottleStoreKind(env = process.env) {
  const requested = String(env.AUTH_THROTTLE_STORE || '').trim().toLowerCase();
  if (requested === 'postgres' || requested === 'memory') return requested;
  return env.NODE_ENV === 'production' ? 'postgres' : 'memory';
}

function getStore() {
  if (storeOverride) return storeOverride;
  if (resolveAuthThrottleStoreKind() === 'memory') return memoryStore;
  if (!postgresStore) {
    postgresStore = createPostgresThrottleStore({ prisma: require('../config/db').prisma });
  }
  return postgresStore;
}

// ─── The rules ─────────────────────────────────────────────────────────────

async function assertLoginAllowed({ email, ipAddress }) {
  const store = getStore();
  const currentNow = nowMs();
  const normalizedEmail = normalizeEmail(email);

  const [emailEntry, ipEntry] = await Promise.all([
    normalizedEmail ? store.read('email', normalizedEmail) : null,
    ipAddress ? store.read('ip', ipAddress) : null,
  ]);

  if (emailEntry) throwIfBlocked(emailEntry, 'email', currentNow);
  if (ipEntry) throwIfBlocked(ipEntry, 'ip', currentNow);
}

async function recordLoginFailure({ email, ipAddress }) {
  const store = getStore();
  const currentNow = nowMs();
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    await store.recordFailure('email', normalizedEmail, EMAIL_LIMITS, currentNow);
  }
  if (ipAddress) {
    await store.recordFailure('ip', ipAddress, IP_LIMITS, currentNow);
  }
}

/**
 * A successful sign-in clears that person’s own failure count outright, and
 * repays the address they came from exactly one failure.
 *
 * The address is only repaid, never cleared, and an address already serving a
 * lock serves it out in full: a correct password proves someone real is behind
 * this address, not that a brute force is not also running through it.
 *
 * Without the repayment the per-address count only ever rises. A shared office
 * or NAT egress reaches thirty lifetime failures in ordinary use; the lock then
 * expires but the count does not, so the next single mistyped password re-locks
 * every person behind that address for another fifteen minutes, again and again,
 * with nothing they can do to clear it.
 */
async function recordLoginSuccess({ email, ipAddress }) {
  const store = getStore();
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    await store.clear('email', normalizedEmail);
  }
  if (ipAddress) {
    await store.repay('ip', ipAddress, nowMs());
  }
}

/**
 * Drops Postgres rows nobody has failed on for a day and that hold no running
 * lock. Nothing reads a row that old for anything but its lock, so pruning it
 * changes no decision. Meant for the worker's periodic prune.
 */
async function pruneAuthThrottles({ prisma = require('../config/db').prisma, olderThanMs = 24 * 60 * 60_000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const now = new Date();
  const result = await prisma.authThrottle.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
  });
  return result.count;
}

/** Test hook: forgets the in-process counts. Shared Postgres rows are left alone. */
function resetAuthAbuseState() {
  memoryStore.reset();
}

function setAuthAbuseNow(value) {
  nowOverride = value ? new Date(value) : null;
}

/** Test hook: use a specific store (null restores the configured one). */
function setAuthThrottleStore(store) {
  storeOverride = store || null;
}

module.exports = {
  assertLoginAllowed,
  createMemoryThrottleStore,
  createPostgresThrottleStore,
  pruneAuthThrottles,
  recordLoginFailure,
  recordLoginSuccess,
  resetAuthAbuseState,
  resolveAuthThrottleStoreKind,
  setAuthAbuseNow,
  setAuthThrottleStore,
};
