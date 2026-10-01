#!/usr/bin/env node
/**
 * Disposable-database proof for one additive migration (docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md step 4).
 *
 *   node scripts/db/verify-additive-migration.js --migration <folder name> --table <Table> [--table <Table> ...]
 *
 * It creates a throwaway database `octapm_migtest_<timestamp>` on the cluster named by DATABASE_URL, applies
 * every migration BEFORE the named one, inserts fixture rows with distinctive values into each named table
 * (foreign-key checks relaxed only inside the throwaway database), applies the named migration, compares every
 * pre-existing column of every fixture row before and after, lists the columns the migration added (each must
 * be nullable or carry a default), and drops the throwaway database whatever happened.
 *
 * It never connects to the database named in DATABASE_URL: only to the cluster's `postgres` database (to create
 * and drop the throwaway one) and to the throwaway database itself. Exit 0 = no pre-existing value changed and
 * every added column is nullable or defaulted; 2 = a difference; 1 = an error.
 */
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const backend = path.resolve(__dirname, "..", "..");
const nodeModules = [path.join(backend, "node_modules"), path.join(backend, "..", "node_modules")].find((p) => fs.existsSync(path.join(p, "pg")));
require(path.join(nodeModules, "dotenv")).config({ path: path.join(backend, ".env") });
const { Client } = require(path.join(nodeModules, "pg"));
const prismaCli = path.join(nodeModules, "prisma", "build", "index.js");

const args = process.argv.slice(2);
const opt = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const [migration] = opt("migration");
const tables = opt("table");
const perTable = Number(opt("rows")[0] || 3);
if (!migration || !tables.length) {
  console.error("usage: verify-additive-migration.js --migration <folder> --table <Table> [--table ...] [--rows 3]");
  process.exit(1);
}
const migrationsDir = path.join(backend, "prisma", "migrations");
if (!fs.existsSync(path.join(migrationsDir, migration, "migration.sql"))) {
  console.error(`no migration folder ${migration}`);
  process.exit(1);
}

const base = new URL(process.env.DATABASE_URL);
const dbName = `octapm_migtest_${Date.now()}`;
if (!/^octapm_migtest_\d+$/.test(dbName) || dbName === base.pathname.slice(1)) throw new Error("refusing: not a throwaway database name");
const urlFor = (name) => { const u = new URL(base.toString()); u.pathname = `/${name}`; u.searchParams.delete("connection_limit"); return u.toString(); };
const work = fs.mkdtempSync(path.join(os.tmpdir(), "octapm-migtest-"));

const deploy = (dir) => {
  const stage = path.join(work, `stage-${Date.now()}`);
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync(dir, path.join(stage, "migrations"), { recursive: true });
  fs.copyFileSync(path.join(backend, "prisma", "schema.prisma"), path.join(stage, "schema.prisma"));
  const out = execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(stage, "schema.prisma")], { env: { ...process.env, DATABASE_URL: urlFor(dbName) }, encoding: "utf8" });
  return out.split("\n").filter((l) => /migrations? (found|to apply)|applied|All migrations|No pending/i.test(l)).join(" | ");
};

const columnsOf = async (db, table) => (await db.query(
  `select column_name, is_nullable, column_default, data_type, udt_name from information_schema.columns
   where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table])).rows;

/**
 * Columns guarded by a CHECK ("col" IN ('a', 'b', …)) constraint — PostgreSQL
 * renders it as "col" = ANY (ARRAY['a'::text, …]) — mapped to their allowed
 * values, so a fixture row satisfies the constraint instead of writing
 * `fx-col-N` into it (ProgressSubmission.method, ActivityBoqAllocation.status …).
 */
const allowedValuesOf = async (db, table) => {
  const found = await db.query(
    `select pg_get_constraintdef(c.oid) as def from pg_constraint c
     where c.contype = 'c' and c.conrelid = format('%I', $1::text)::regclass`, [table]);
  const allowed = {};
  for (const { def } of found.rows) {
    const m = /^CHECK \(\(?"?(\w+)"?(?:::text)?\s*=\s*ANY \(\(?ARRAY\[(.*?)\]/.exec(def);
    if (!m) continue;
    const values = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'"));
    if (values.length) allowed[m[1]] = values;
  }
  return allowed;
};

const fixtureValue = (c, row, col, allowed = {}) => {
  if (c.is_nullable === "YES" && row % 2 === 1) return undefined; // odd rows leave optional columns to their default
  if (c.column_default !== null && c.is_nullable === "NO" && row === 0) return undefined; // row 0 exercises defaults
  if (allowed[c.column_name]) return allowed[c.column_name][row % allowed[c.column_name].length];
  if (/numeric|double|real/.test(c.data_type)) return (1000 + row * 7919.37 + col * 13.01).toFixed(2);
  if (/int/.test(c.data_type)) return row * 10 + col + 1;
  if (/timestamp|date/.test(c.data_type)) return new Date(Date.UTC(2026, 8, 1 + row, col % 24));
  if (c.data_type === "boolean") return row % 2 === 0;
  if (c.data_type === "jsonb" || c.data_type === "json") return JSON.stringify({ row, col, fixture: true });
  if (c.data_type === "ARRAY") return [];
  if (c.data_type === "USER-DEFINED") return undefined;
  if (c.data_type === "uuid") return crypto.randomUUID();
  return c.column_name === "id" || /Id$/.test(c.column_name) ? crypto.randomUUID() : `fx-${c.column_name}-${row}`;
};

(async () => {
  const admin = new Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  console.log("created throwaway", dbName);
  let db;
  let failed = false;
  try {
    const before = path.join(work, "before");
    fs.cpSync(migrationsDir, before, { recursive: true });
    const later = fs.readdirSync(before).filter((d) => d >= migration && fs.statSync(path.join(before, d)).isDirectory());
    for (const d of later) fs.rmSync(path.join(before, d), { recursive: true, force: true });
    console.log("deploy before:", deploy(before));

    db = new Client({ connectionString: urlFor(dbName) });
    await db.connect();
    const pre = {};
    const colsBefore = {};
    await db.query("SET session_replication_role = replica");
    for (const table of tables) {
      colsBefore[table] = await columnsOf(db, table);
      if (!colsBefore[table].length) throw new Error(`table ${table} does not exist before the migration`);
      const allowed = await allowedValuesOf(db, table);
      for (let row = 0; row < perTable; row += 1) {
        const keys = []; const vals = [];
        colsBefore[table].forEach((c, col) => {
          const v = fixtureValue(c, row, col, allowed);
          if (v !== undefined) { keys.push(`"${c.column_name}"`); vals.push(v); }
        });
        if (!keys.length) await db.query(`insert into "${table}" default values`);
        else await db.query(`insert into "${table}" (${keys.join(",")}) values (${vals.map((_, k) => `$${k + 1}`).join(",")})`, vals);
      }
    }
    await db.query("SET session_replication_role = origin");
    for (const table of tables) pre[table] = (await db.query(`select * from "${table}" order by 1`)).rows;
    await db.end(); db = null;

    console.log("deploy with the new migration:", deploy(migrationsDir));
    db = new Client({ connectionString: urlFor(dbName) });
    await db.connect();
    let diffs = 0;
    for (const table of tables) {
      const post = (await db.query(`select * from "${table}" order by 1`)).rows;
      const colsAfter = await columnsOf(db, table);
      const had = new Set(colsBefore[table].map((c) => c.column_name));
      const added = colsAfter.filter((c) => !had.has(c.column_name));
      const removed = colsBefore[table].filter((c) => !colsAfter.some((a) => a.column_name === c.column_name));
      for (const c of removed) { diffs += 1; console.log(`DIFF ${table}: column ${c.column_name} removed`); }
      for (const c of added) {
        if (c.is_nullable !== "YES" && c.column_default === null) { diffs += 1; console.log(`DIFF ${table}: added ${c.column_name} is NOT NULL without a default`); }
      }
      if (post.length !== pre[table].length) { diffs += 1; console.log(`DIFF ${table}: ${pre[table].length} rows before, ${post.length} after`); }
      let compared = 0;
      pre[table].forEach((row, i) => {
        for (const [k, v] of Object.entries(row)) {
          compared += 1;
          const a = JSON.stringify(v); const b = JSON.stringify(post[i] && post[i][k]);
          if (a !== b) { diffs += 1; console.log(`DIFF ${table} row ${i} ${k}: ${a} -> ${b}`); }
        }
      });
      console.log(`${table}: ${pre[table].length} rows, ${compared} values compared, added ${JSON.stringify(added.map((c) => ({ column: c.column_name, type: c.data_type, nullable: c.is_nullable, default: c.column_default })))}, values of added columns ${JSON.stringify(post.map((r) => Object.fromEntries(added.map((c) => [c.column_name, r[c.column_name]]))))}`);
    }
    console.log(`result: ${diffs} difference(s)`);
    failed = diffs > 0;
    await db.end(); db = null;
  } finally {
    if (db) await db.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    const left = await admin.query("select count(*)::int n from pg_database where datname = $1", [dbName]);
    console.log("dropped", dbName, "remaining", left.rows[0].n);
    await admin.end();
    fs.rmSync(work, { recursive: true, force: true });
  }
  process.exitCode = failed ? 2 : 0;
})().catch((e) => { console.error("ERROR", e.message); process.exitCode = 1; });
