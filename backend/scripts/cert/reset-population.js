'use strict';

/**
 * Empties the certification database: every application table, the stored
 * files of the certification API, nothing else.
 *
 *   node scripts/cert/reset-population.js               # report what would be emptied
 *   node scripts/cert/reset-population.js --apply       # empty it
 *
 * This is the one destructive certification script, so it is the one that
 * goes through the destructive guard (lib/cert-env.js):
 *
 *   - the address is CERT_DATABASE_URL and nothing else;
 *   - the database is named octapm_cert, and says so itself once connected;
 *   - the marker row is the one in CERT_ENVIRONMENT_ID;
 *   - the database holds no user and no company without the certification
 *     naming rule. One durable-looking row and the reset refuses.
 *
 * The file store is emptied only when its path is the one recorded for the
 * certification environment and lies outside any repository.
 *
 * The migration history and the marker are kept: after a reset the database
 * is a freshly migrated, empty certification database.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const guard = require('./lib/cert-env');

const APPLY = process.argv.includes('--apply');
const KEEP = new Set(['_prisma_migrations']);

/** The certification file store, or a refusal. Never a path inside a working tree. */
const certFileStore = (env = process.env) => {
  const dir = env.FILE_STORAGE_LOCAL_DIR;
  if (typeof dir !== 'string' || dir.trim() === '') return null;
  const resolved = path.resolve(dir);
  const normal = resolved.replace(/\\/g, '/').toLowerCase();
  if (!/\/octapm-cert\/files$/.test(normal)) {
    throw new guard.CertGuardError('file-store', `FILE_STORAGE_LOCAL_DIR "${resolved}" is not the certification file store (…/octapm-cert/files).`);
  }
  let probe = resolved;
  for (;;) {
    if (fs.existsSync(path.join(probe, '.git'))) {
      throw new guard.CertGuardError('file-store', `the certification file store "${resolved}" lies inside a repository.`);
    }
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  return resolved;
};

const main = async () => {
  const store = certFileStore();
  const client = await guard.connectCert({ destructive: true });
  try {
    const tables = (
      await client.query("select tablename from pg_tables where schemaname = 'public' order by tablename")
    ).rows
      .map((row) => row.tablename)
      .filter((name) => !KEEP.has(name));
    const counts = (
      await client.query('select count(*)::int as organisations, (select count(*)::int from "User") as users, (select count(*)::int from "Project") as projects from "Organisation"')
    ).rows[0];
    console.log(`certification database: ${tables.length} tables; ${counts.organisations} organisations, ${counts.users} users, ${counts.projects} projects`);
    console.log(`certification file store: ${store || '(none configured)'}`);
    if (!APPLY) {
      console.log('\nreport only — nothing emptied. Add --apply to empty the certification database.');
      return;
    }
    // One statement, one transaction: either every table is emptied or none is.
    await client.query('begin');
    // The guard again, inside the transaction that deletes: nothing may have changed in between.
    await guard.assertCertEnvironment(async (sql, params) => (await client.query(sql, params)).rows, { destructive: true });
    await client.query(`truncate table ${tables.map((name) => `"${name}"`).join(', ')} restart identity cascade`);
    await client.query('commit');
    if (store && fs.existsSync(store)) {
      for (const entry of fs.readdirSync(store)) fs.rmSync(path.join(store, entry), { recursive: true, force: true });
    }
    const left = (await client.query('select (select count(*)::int from "Organisation") as organisations, (select count(*)::int from "User") as users')).rows[0];
    console.log(`emptied. organisations ${left.organisations}, users ${left.users}`);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
};

module.exports = { certFileStore };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
