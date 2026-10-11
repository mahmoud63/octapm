#!/usr/bin/env node
/**
 * Read-only: lists every INVALID or not-ready index in the database DATABASE_URL names.
 *
 *   node scripts/db/check-invalid-indexes.js
 *
 * A CREATE INDEX CONCURRENTLY that is cancelled or fails (e.g. migration
 * 20261005070100_audit_event_occurred_at_idx) leaves its index behind marked
 * INVALID: it is not used by queries, still costs every write, and blocks a
 * retry ("relation already exists"). Run this after any deploy that builds an
 * index concurrently. Exit 0 = none; 2 = at least one (listed with the
 * recovery statement); 1 = error.
 * Recovery: DROP INDEX CONCURRENTLY "<name>";  then
 *           npx prisma migrate resolve --rolled-back <migration>;  then
 *           npx prisma migrate deploy
 */
const fs = require("fs");
const path = require("path");

const backend = path.resolve(__dirname, "..", "..");
const nodeModules = [path.join(backend, "node_modules"), path.join(backend, "..", "node_modules")].find((p) => fs.existsSync(path.join(p, "pg")));
require(path.join(nodeModules, "dotenv")).config({ path: path.join(backend, ".env") });
const { Client } = require(path.join(nodeModules, "pg"));

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, application_name: "check-invalid-indexes (read-only)" });
  await c.connect();
  try {
    await c.query("BEGIN TRANSACTION READ ONLY");
    const { rows } = await c.query(`
      select n.nspname as schema, t.relname as table_name, i.relname as index_name, x.indisvalid as valid, x.indisready as ready
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = i.relnamespace
      where (not x.indisvalid or not x.indisready) and n.nspname not in ('pg_catalog', 'information_schema')
      order by 1, 2, 3`);
    await c.query("ROLLBACK");
    if (!rows.length) {
      console.log("No invalid indexes.");
      return;
    }
    for (const r of rows) {
      console.log(`INVALID ${r.schema}.${r.index_name} on ${r.table_name} (valid=${r.valid}, ready=${r.ready}) — recover: DROP INDEX CONCURRENTLY "${r.index_name}";`);
    }
    process.exitCode = 2;
  } finally {
    await c.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
