/**
 * Local development database.
 *
 * Starts a self-contained Postgres cluster via `embedded-postgres` so the API
 * can run without a system-installed Postgres. The cluster is a child of this
 * process — keep it running while you use the API, stop it with Ctrl+C.
 *
 * Run with:  node scripts/dev-db.mjs   (or `npm run db:dev`)
 *
 * Everything is overridable, because one machine often needs more than one of
 * these — a second worktree, or a throwaway cluster beside the one holding your
 * working data:
 *
 *   DEV_DB_PORT      port to listen on            (default 5432)
 *   DEV_DB_DIR       data directory               (default backend/.pgdata)
 *   DEV_DB_NAME      database to create           (default pmcopilots)
 *   DEV_DB_USER      superuser                    (default postgres)
 *   DEV_DB_PASSWORD  superuser password           (default yourpassword)
 *
 * Keep the data directory off OneDrive, Dropbox and any other syncing folder.
 * A file sync client rewriting files underneath a running Postgres will corrupt
 * the cluster, and syncing one is slow enough to look like a hang.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.DEV_DB_PORT || 5432);
const DATA_DIR = path.resolve(process.env.DEV_DB_DIR || path.join(here, '..', '.pgdata'));
const DATABASE = process.env.DEV_DB_NAME || 'pmcopilots';
const USER = process.env.DEV_DB_USER || 'postgres';
const PASSWORD = process.env.DEV_DB_PASSWORD || 'yourpassword';

const portIsFree = (port) =>
  new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });

if (!(await portIsFree(PORT))) {
  console.error(
    `[dev-db] port ${PORT} is already in use — another Postgres is probably running.\n` +
      `[dev-db] Point this one somewhere else, for example:\n` +
      `[dev-db]   DEV_DB_PORT=55432 DEV_DB_DIR=/tmp/octapm-pgdata npm run db:dev`,
  );
  process.exit(1);
}

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  // Force UTF-8. Left to itself, initdb takes the encoding from the host locale
  // — which on an English Windows machine is WIN1252, and the migrations then
  // fail on the first non-ASCII character with SQLSTATE 22P05. The C collation
  // is what makes UTF-8 accepted alongside a non-UTF-8 host locale. Encoding is
  // fixed when the cluster is created: changing this means deleting the data
  // directory and letting it initialise again.
  initdbFlags: ['--encoding=UTF8', '--lc-collate=C', '--lc-ctype=C'],
});

const needsInit = !existsSync(DATA_DIR) || readdirSync(DATA_DIR).length === 0;
if (needsInit) {
  console.log(`[dev-db] initialising cluster in ${DATA_DIR} ...`);
  await pg.initialise();
}

await pg.start();
console.log(`[dev-db] Postgres listening on port ${PORT}`);

try {
  await pg.createDatabase(DATABASE);
  console.log(`[dev-db] created database "${DATABASE}"`);
} catch {
  console.log(`[dev-db] database "${DATABASE}" already exists`);
}

console.log(
  `[dev-db] DATABASE_URL="postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}"`,
);
console.log('[dev-db] READY — leave this process running.');

const shutdown = async () => {
  console.log('\n[dev-db] stopping Postgres ...');
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep the process (and therefore the cluster) alive.
setInterval(() => {}, 1 << 30);
