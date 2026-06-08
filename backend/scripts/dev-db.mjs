/**
 * Local development database.
 *
 * Starts a self-contained Postgres cluster via `embedded-postgres` so the API
 * can run without a system-installed Postgres. Data is persisted in
 * `backend/.pgdata` (git-ignored). The cluster is a child of this process —
 * keep it running while you use the API, stop it with Ctrl+C.
 *
 * Run with:  node scripts/dev-db.mjs   (or `npm run db:dev`)
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', '.pgdata');

const PORT = 5432;
const USER = 'postgres';
const PASSWORD = 'yourpassword';
const DATABASE = 'pmcopilots';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
});

const needsInit = !existsSync(dataDir) || readdirSync(dataDir).length === 0;
if (needsInit) {
  console.log('[dev-db] initialising cluster in .pgdata ...');
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
