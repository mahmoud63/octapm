#!/usr/bin/env node
/**
 * Record-ref duplicates dry run — READ ONLY by construction (PC-7b, migration
 * 20261005060100_record_ref_uniques; OCTAPM_CHANGE_INTELLIGENCE.md "PC-7b migrations").
 *
 *   node scripts/project-controls/record-ref-duplicates.js [--json <file>]
 *
 * @@unique([projectId, ref]) already holds on ten project registers. The
 * migration adds it to three more — ChangeOrder, Risk, NcrRecord — and a
 * unique index cannot be created while two rows share a key, so this script
 * counts the duplicate (projectId, ref) groups on those three, and on
 * ProcurementOrder, which carries the same gap but is NOT constrained by the
 * migration (its live duplicates are a §134 stop for the owner).
 *
 * For every duplicate group it prints the rows (id, projectId, ref, createdAt)
 * so the owner can decide which record keeps the reference. It never changes
 * a row: renumbering a commercial or quality record is a product decision.
 *
 * Exit 0 = no duplicates on any table the migration constrains (ProcurementOrder
 * is reported, never decisive); 2 = at least one of ChangeOrder, Risk,
 * NcrRecord has a duplicate group — do not apply 20261005060100; 1 = an error.
 *
 * Read-only guarantees: one connection; `SET SESSION CHARACTERISTICS AS
 * TRANSACTION READ ONLY` runs first and `SHOW transaction_read_only` must read
 * `on` before and after the reads. Run it under the cross-wave database lock.
 */
const fs = require("fs");
const path = require("path");

const backend = path.resolve(__dirname, "..", "..");
const nodeModules = [path.join(backend, "node_modules"), path.join(backend, "..", "node_modules")].find((p) => fs.existsSync(path.join(p, "pg")));
require(path.join(nodeModules, "dotenv")).config({ path: path.join(backend, ".env") });
const { Client } = require(path.join(nodeModules, "pg"));

const argv = process.argv.slice(2);
const jsonFlag = argv.indexOf("--json");
const jsonPath = jsonFlag === -1 ? null : argv[jsonFlag + 1];

/** `constrained` = the migration adds @@unique([projectId, ref]) to the table. */
const TABLES = [
  { table: "ChangeOrder", constrained: true },
  { table: "Risk", constrained: true },
  { table: "NcrRecord", constrained: true },
  { table: "ProcurementOrder", constrained: false },
];

const assertReadOnly = async (db, when) => {
  const { rows } = await db.query("SHOW transaction_read_only");
  if (rows[0].transaction_read_only !== "on") throw new Error(`the session is not read-only ${when}; stopping`);
};

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("connection_limit");
  url.searchParams.delete("schema");
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await assertReadOnly(db, "before the dry run");
    console.log(`record-ref duplicates dry run on ${url.pathname.slice(1)} (read-only session verified)`);
    const results = [];
    for (const { table, constrained } of TABLES) {
      const total = (await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
      const nullRefs = (await db.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "ref" IS NULL`)).rows[0].n;
      const rows = (await db.query(`
        SELECT t."id", t."projectId", t."ref", t."createdAt"
        FROM "${table}" t
        JOIN (SELECT "projectId", "ref" FROM "${table}" GROUP BY 1, 2 HAVING count(*) > 1) d
          ON d."projectId" = t."projectId" AND d."ref" = t."ref"
        ORDER BY t."projectId", t."ref", t."createdAt", t."id"`)).rows;
      const groups = new Set(rows.map((r) => `${r.projectId}\u0000${r.ref}`)).size;
      results.push({ table, constrained, total, nullRefs, groups, rows });
      const verdict = groups === 0 ? "ok  " : constrained ? "STOP" : "OWNER";
      console.log(`${verdict} ${table.padEnd(16)} rows ${String(total).padStart(6)}  duplicate (projectId, ref) groups ${groups} (${rows.length} rows)${constrained ? "" : "  — not constrained by 20261005060100"}`);
      for (const r of rows) console.log(`       ${r.id}  project ${r.projectId}  ref ${JSON.stringify(r.ref)}  created ${new Date(r.createdAt).toISOString()}`);
    }
    await assertReadOnly(db, "after the dry run");
    const stops = results.filter((r) => r.constrained && r.groups > 0).map((r) => r.table);
    console.log(stops.length
      ? `\nresult: STOP — duplicates on ${stops.join(", ")}; do not apply 20261005060100_record_ref_uniques`
      : "\nresult: no duplicate (projectId, ref) on ChangeOrder, Risk or NcrRecord — 20261005060100_record_ref_uniques can be applied");
    if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), database: url.pathname.slice(1), ok: !stops.length, stops, results }, null, 2));
    process.exitCode = stops.length ? 2 : 0;
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error("ERROR", error.message);
  process.exitCode = 1;
});
