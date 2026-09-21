/**
 * Scheduler leadership: at most one process runs the periodic schedulers.
 *
 * Every process allowed to schedule competes for one Postgres session-level
 * advisory lock; whoever holds it is the leader. The lock lives on a
 * dedicated single-connection PrismaClient, never on the shared pool in
 * config/db: a session lock taken on a pooled connection belongs to whichever
 * connection happened to run the query, and the next check may run on
 * another one.
 *
 * Each heartbeat is one statement that
 *   - asks Postgres whether this session already holds the lock (pg_locks),
 *     and only if it does not, tries to take it — so the lock never stacks;
 *   - catches a silent reconnect: if Prisma replaced the connection after a
 *     failover or network blip, the new session does not hold the lock, and
 *     this process competes again instead of believing it still leads;
 *   - sets idle_session_timeout, so Postgres ends the session — and releases
 *     the lock — if a partitioned process stops heartbeating.
 * A lost lock or a failed heartbeat demotes this process before anything
 * else happens. A crash closes the connection and releases the lock at once.
 *
 * The lock uses the two-int4 form (class 918273, hashtext(key)), which cannot
 * collide with the single-bigint pg_advisory_xact_lock(hashtext(...)) locks
 * the financial services take.
 */

const LOCK_CLASS = 918273;
const DEFAULT_KEY = "octapm-schedulers";
const DEFAULT_HEARTBEAT_MS = 15_000;
const MIN_IDLE_SESSION_TIMEOUT_MS = 60_000;

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** DATABASE_URL pinned to exactly one connection, whatever pool size it asked for. */
const singleConnectionUrl = (databaseUrl) => {
  const url = new URL(databaseUrl);
  url.searchParams.set("connection_limit", "1");
  return url.toString();
};

const createSchedulerLeader = ({
  key = DEFAULT_KEY,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  databaseUrl = process.env.DATABASE_URL,
  onElected = () => {},
  onDemoted = () => {},
  logger = console,
  createClient = (datasourceUrl) => {
    const { PrismaClient } = require("@prisma/client");
    return new PrismaClient({ datasourceUrl });
  },
} = {}) => {
  // Postgres must not end a healthy leader's session: keep the timeout well
  // above the heartbeat.
  const idleSessionTimeoutMs = String(Math.max(MIN_IDLE_SESSION_TIMEOUT_MS, heartbeatMs * 4));
  let client = null;
  let timer = null;
  let leader = false;
  let stopped = false;
  let inflight = null;

  const elect = async () => {
    leader = true;
    logger.log(`[scheduler-leader] elected (key=${key}, pid=${process.pid})`);
    try {
      await onElected();
    } catch (error) {
      logger.error("[scheduler-leader] starting schedulers failed", error?.message || error);
    }
  };

  const demote = async (reason) => {
    if (!leader) return;
    leader = false;
    logger.warn(`[scheduler-leader] demoted: ${reason}`);
    try {
      await onDemoted();
    } catch (error) {
      logger.error("[scheduler-leader] stopping schedulers failed", error?.message || error);
    }
  };

  const heartbeat = async () => {
    if (stopped || !client) return;
    let held = false;
    try {
      const rows = await client.$queryRaw`
        SELECT set_config('idle_session_timeout', ${idleSessionTimeoutMs}, false) IS NOT NULL AS configured,
               CASE WHEN EXISTS (
                      SELECT 1 FROM pg_locks
                      WHERE locktype = 'advisory'
                        AND pid = pg_backend_pid()
                        AND granted
                        AND classid = ${LOCK_CLASS}::int4::oid
                        AND objid = hashtext(${key})::oid
                        AND objsubid = 2)
                    THEN true
                    ELSE pg_try_advisory_lock(${LOCK_CLASS}::int4, hashtext(${key}))
               END AS held`;
      held = rows?.[0]?.held === true;
    } catch (error) {
      if (stopped) return;
      await demote(`heartbeat failed (${error?.message || error})`);
      return;
    }
    if (stopped) return;
    if (held && !leader) await elect();
    else if (!held && leader) await demote("the lock is held by another session");
  };

  const beat = () => {
    if (inflight) return inflight;
    inflight = heartbeat().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const start = () => {
    if (client || stopped) return;
    client = createClient(singleConnectionUrl(databaseUrl));
    beat();
    timer = setInterval(beat, heartbeatMs);
    // The HTTP server (API) or the worker's keep-alive handle holds the
    // process open; leadership must not keep a finished process alive.
    timer.unref?.();
  };

  /** Stops the schedulers first, then gives the lock back so a successor can take over at once. */
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (inflight) await inflight.catch(() => {});
    const wasLeader = leader;
    await demote("stopping");
    if (!client) return;
    if (wasLeader) {
      await client.$queryRaw`SELECT pg_advisory_unlock(${LOCK_CLASS}::int4, hashtext(${key}))`.catch(() => {});
    }
    await client.$disconnect().catch(() => {});
    client = null;
    logger.log("[scheduler-leader] released");
  };

  return {
    key,
    start,
    stop,
    heartbeat: beat,
    isLeader: () => leader,
  };
};

const leaderOptionsFromEnv = (env = process.env) => ({
  key: String(env.SCHEDULER_LOCK_KEY || "").trim() || DEFAULT_KEY,
  heartbeatMs: readPositiveInt(env.SCHEDULER_LEADER_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS),
  databaseUrl: env.DATABASE_URL,
});

module.exports = {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_KEY,
  LOCK_CLASS,
  createSchedulerLeader,
  leaderOptionsFromEnv,
  singleConnectionUrl,
};
