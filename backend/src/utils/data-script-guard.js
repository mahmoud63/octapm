/**
 * The one check every data script makes before it writes a row.
 *
 * The seed, the E2E reset, the UAT fixtures, the residue archiver and the QA
 * harness were all written for the database on this machine. They create
 * people with published passwords, and the E2E reset deletes every
 * organisation whose name carries the word "E2E" — on a customer database that
 * is a real company. Nothing stopped any of them from running against RDS: the
 * production image ships prisma/seed.js and scripts/e2e, and an operator's
 * shell can point DATABASE_URL anywhere.
 *
 * So a data script refuses when NODE_ENV is production, or when the database
 * is not on this machine, unless ALLOW_DATA_SCRIPT names that database exactly
 * as `<host>/<database>`. The host is part of the key because staging and
 * production run the same image with NODE_ENV=production and will likely both
 * call the database `octapm`; a database name alone would unlock both, while
 * an RDS endpoint is unique to one instance. A boolean switch would unlock
 * every database the shell can see.
 *
 * It lives in src/ rather than scripts/ because prisma/seed.js ships in the
 * image and must still be able to load it.
 *
 * Locally nothing needs setting: backend/.env points at localhost with
 * NODE_ENV=development, and that passes.
 */
const path = require("path");

const BACKEND_ENV_FILE = path.resolve(__dirname, "..", "..", ".env");

// Hostnames as WHATWG URL reports them: an IPv6 literal keeps its brackets.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

class DataScriptRefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataScriptRefusedError";
    this.code = "DATA_SCRIPT_REFUSED";
  }
}

/**
 * Prisma, not the scripts, reads backend/.env — and only when a client is
 * constructed. A guard that looked at process.env first would see no
 * DATABASE_URL on a developer's machine and refuse everything, so it loads
 * the file itself. dotenv never overrides a variable that is already set, so
 * an operator's explicit DATABASE_URL still wins.
 */
const loadBackendEnv = (env) => {
  require("dotenv").config({ path: BACKEND_ENV_FILE, processEnv: env, quiet: true });
};

/**
 * Where a connection string points, without connecting to it.
 *
 * @returns {{ host: string|null, database: string|null, target: string, local: boolean }}
 *   `target` is the `<host>/<database>` string ALLOW_DATA_SCRIPT must equal.
 *   A string that does not parse, or a socket-path form (`?host=/var/run/…`),
 *   counts as not local: when in doubt the guard refuses.
 */
const describeDatabaseTarget = (url) => {
  const text = String(url ?? "").trim();
  if (!text) return { host: null, database: null, target: "(DATABASE_URL is not set)", local: false };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { host: null, database: null, target: "(DATABASE_URL does not parse)", local: false };
  }
  const host = parsed.hostname.toLowerCase();
  let database = parsed.pathname.replace(/^\/+/, "");
  try {
    database = decodeURIComponent(database);
  } catch {
    // keep the raw path; it only feeds the comparison and the message
  }
  const socketHost = parsed.searchParams.get("host");
  const local = LOCAL_HOSTS.has(host) && !socketHost;
  return { host, database, target: `${host}/${database}`, local };
};

/**
 * Throws DataScriptRefusedError (code DATA_SCRIPT_REFUSED) unless this script
 * may write to the configured database. Call it before the first query.
 *
 * @param {string} scriptName shown in the refusal, e.g. "db:seed"
 * @param {{ env?: NodeJS.ProcessEnv }} [options] defaults to process.env,
 *   into which backend/.env is loaded first.
 * @returns {{ target: string, local: boolean, overridden: boolean }}
 */
const assertDataScriptAllowed = (scriptName, { env = process.env } = {}) => {
  loadBackendEnv(env);
  const nodeEnv = env.NODE_ENV || "(unset)";
  const description = describeDatabaseTarget(env.DATABASE_URL);
  const production = env.NODE_ENV === "production";

  if (!production && description.local) {
    return { target: description.target, local: true, overridden: false };
  }

  // Exact match only: trimming or case-folding would make a near miss count.
  if (description.host && env.ALLOW_DATA_SCRIPT === description.target) {
    return { target: description.target, local: description.local, overridden: true };
  }

  const reason = production ? "NODE_ENV=production" : `the database is not on this machine; NODE_ENV=${nodeEnv}`;
  const override = description.host
    ? `Set ALLOW_DATA_SCRIPT=${description.target} to run it against this database deliberately.`
    : "Point DATABASE_URL at a database this script may write to.";
  throw new DataScriptRefusedError(
    `DATA_SCRIPT_REFUSED: ${scriptName} will not write to ${description.target} (${reason}). ${override}`,
  );
};

/**
 * The same check for a script's top level: prints the refusal and exits 1
 * instead of throwing a stack trace at the operator.
 */
const exitUnlessDataScriptAllowed = (scriptName, options) => {
  try {
    return assertDataScriptAllowed(scriptName, options);
  } catch (error) {
    if (error.code !== "DATA_SCRIPT_REFUSED") throw error;
    console.error(error.message);
    process.exit(1);
  }
};

module.exports = {
  DataScriptRefusedError,
  assertDataScriptAllowed,
  describeDatabaseTarget,
  exitUnlessDataScriptAllowed,
};
