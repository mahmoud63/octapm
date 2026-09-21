const fs = require("fs");
const path = require("path");

/**
 * The socket.io adapter: which processes a room broadcast reaches.
 *
 * With one API process the default in-memory adapter is enough, and it is what
 * development keeps (REALTIME_ADAPTER defaults to `memory` outside
 * production). With several API tasks behind a load balancer, a person's
 * socket may live on any of them, so `io.to(room).emit` and
 * `disconnectSockets` must cross processes: the Postgres adapter does that
 * over LISTEN/NOTIFY, parking packets above NOTIFY's 8000-byte limit in the
 * `socket_io_attachments` table. Production defaults to it.
 *
 * Only the socket fan-out crosses processes. The domain bus stays local, so a
 * side effect (a webhook delivery, a record follow) still runs once, in the
 * process that published the event.
 */

const DEFAULT_TABLE_NAME = "socket_io_attachments";
const DEFAULT_POOL_MAX = 3;
const MODES = Object.freeze(["memory", "postgres"]);

// Query parameters Prisma reads from DATABASE_URL that mean nothing — or
// something else — to node-postgres. `sslcert` is the sharp one: Prisma reads
// it as the CA that signs the server certificate, node-postgres as a client
// certificate, so a production Prisma URL handed to pg.Pool as-is breaks TLS.
// The adapter only logs its errors, so realtime would quietly fall back to
// reaching the local task alone.
const PRISMA_ONLY_PARAMS = new Set([
  "connection_limit",
  "pool_timeout",
  "socket_timeout",
  "connect_timeout",
  "sslmode",
  "sslcert",
  "sslidentity",
  "sslpassword",
  "sslaccept",
  "schema",
  "pgbouncer",
  "statement_cache_size",
]);

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** `memory` or `postgres`: an explicit REALTIME_ADAPTER wins, otherwise production means postgres. */
const resolveRealtimeAdapterMode = (env = process.env) => {
  const requested = trimOrNull(env.REALTIME_ADAPTER);
  if (requested) {
    const mode = requested.toLowerCase();
    if (!MODES.includes(mode)) {
      throw new Error(`REALTIME_ADAPTER must be one of ${MODES.join(", ")} (got "${requested}")`);
    }
    return mode;
  }
  return env.NODE_ENV === "production" ? "postgres" : "memory";
};

// Prisma resolves a relative sslcert against the folder holding schema.prisma.
const PRISMA_SCHEMA_DIR = path.resolve(__dirname, "..", "..", "prisma");

/**
 * node-postgres settings for a Prisma-style connection URL.
 *
 * sslmode=require (and the verify-* spellings) means an encrypted connection
 * whose certificate is checked: against the `sslcert` CA bundle when the URL
 * names one, otherwise against Node's trust store. The host name is checked
 * too. Without sslmode, or with disable/prefer, the connection is plain, as
 * Prisma's own is locally. A client certificate is never sent.
 */
const buildPgConfig = (connectionString, { readFile = fs.readFileSync } = {}) => {
  if (!connectionString) throw new Error("The realtime adapter needs DATABASE_URL (or REALTIME_DATABASE_URL)");
  const url = new URL(connectionString);
  const params = url.searchParams;
  const host = decodeURIComponent(url.hostname).replace(/^\[(.*)\]$/, "$1");

  const config = {
    host,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };

  const connectTimeout = readPositiveInt(params.get("connect_timeout"), null);
  if (connectTimeout) config.connectionTimeoutMillis = connectTimeout * 1000;

  // Prisma's `schema` sets the search path; the attachment table lives there.
  const schema = trimOrNull(params.get("schema"));
  if (schema && schema !== "public") config.options = `-c search_path=${schema}`;

  const sslmode = (trimOrNull(params.get("sslmode")) || "").toLowerCase();
  if (["require", "verify-ca", "verify-full"].includes(sslmode)) {
    const ssl = { rejectUnauthorized: true, servername: host };
    const caPath = trimOrNull(params.get("sslcert"));
    if (caPath) ssl.ca = readFile(path.isAbsolute(caPath) ? caPath : path.resolve(PRISMA_SCHEMA_DIR, caPath), "utf8");
    config.ssl = ssl;
  } else {
    config.ssl = false;
  }

  // Every other query parameter (the Prisma-only ones above, and anything
  // else) is dropped rather than guessed at: none is needed for LISTEN/NOTIFY,
  // and the config is built field by field so none can leak through.
  return config;
};

/**
 * Builds the adapter for this process, or null to keep socket.io's in-memory
 * one. The pool is small: one client stays pinned to LISTEN, the others carry
 * pg_notify, attachment inserts and the attachment cleanup.
 */
const createRealtimeAdapter = (env = process.env, { logger = console } = {}) => {
  const mode = resolveRealtimeAdapterMode(env);
  if (mode === "memory") return null;

  // Required lazily so development never loads either package.
  const { Pool } = require("pg");
  const { createAdapter } = require("@socket.io/postgres-adapter");

  const pool = new Pool({
    ...buildPgConfig(env.REALTIME_DATABASE_URL || env.DATABASE_URL),
    max: Math.max(2, readPositiveInt(env.REALTIME_POOL_MAX, DEFAULT_POOL_MAX)),
    keepAlive: true,
    application_name: "octapm-realtime",
  });
  const report = (label) => (error) => logger.error(`[realtime-adapter] ${label}`, error?.message || error);
  // An idle client that loses its connection emits 'error' on the pool; with
  // no listener that is an uncaught exception and the process dies.
  pool.on("error", report("pool"));
  // The LISTEN client is checked out for the life of the process, so the
  // pool's idle listener does not cover it: a terminated backend emits
  // 'error' on the client itself, which must be heard. The adapter then
  // reconnects on 'end' — but never gives the dead client back, and the pool
  // keeps counting it: with a pool of 3, two lost connections (a failover, a
  // restart) leave no client for pg_notify, and every broadcast from this
  // process waits forever. Releasing the dead client frees its slot.
  pool.on("connect", (client) => {
    client.on("error", report("client"));
    client.on("end", () => {
      try {
        client.release?.(new Error("connection ended"));
      } catch {
        // Idle in the pool (or already given back): the pool removes it itself.
      }
    });
  });

  const adapter = createAdapter(pool, {
    channelPrefix: trimOrNull(env.REALTIME_CHANNEL_PREFIX) || "socket.io",
    tableName: DEFAULT_TABLE_NAME,
    errorHandler: report("adapter"),
  });

  let closed = null;
  return {
    mode,
    adapter,
    pool,
    close: () => {
      if (!closed) closed = pool.end().catch(report("close"));
      return closed;
    },
  };
};

module.exports = {
  DEFAULT_TABLE_NAME,
  PRISMA_ONLY_PARAMS,
  buildPgConfig,
  createRealtimeAdapter,
  resolveRealtimeAdapterMode,
};
