#!/usr/bin/env node
/**
 * Throwaway-database proof of the PC-6 tables' constraints (migration
 * 20261005050000_quantity_progress): QuantityProgressEntry and DailyLogQuantity.
 *
 *   node scripts/db/prove-quantity-progress-constraints.js
 *
 * Like verify-additive-migration.js it creates `octapm_migtest_<timestamp>` on the cluster named by
 * DATABASE_URL, deploys every migration into it, and drops it whatever happened. It never connects to
 * the database DATABASE_URL names — only to the cluster's `postgres` database and to the throwaway one.
 * Parent fixture rows (organisations, project, activity, BOQ item, allocation, location, daily log,
 * submission) are inserted with foreign-key checks relaxed; every assertion below runs with them on.
 *
 * What must hold (exit 0), on both tables unless said otherwise:
 *   1. the composite tenant key (projectId, orgId) → Project(id, orgId) refuses a row whose orgId is
 *      not its project's, and the same row with the project's organisation goes in;
 *   2. @@unique(projectId, clientRequestId) refuses a replayed clientRequestId in the same project and
 *      admits the same id in another project (and any number of NULL ids);
 *   3. the hand-written CHECK constraints (the tail of the migration, after the migrate-diff body):
 *      a negative quantity is refused on both tables (23514) while 0 and a positive quantity go in — a
 *      correction is a rejection plus a new entry, never a negative entry; on QuantityProgressEntry a
 *      status outside draft | submitted | approved | rejected and a source outside submission |
 *      daily_log | manual | import are refused while every listed value goes in; and exactly these
 *      four CHECKs are declared (DailyLogQuantity.status deliberately carries none, like its siblings);
 *   4. the chosen ON DELETE behaviours, declared (pg_constraint.confdeltype) and, where a parent can be
 *      deleted in a throwaway, exercised (RESTRICT raises 23001, NO ACTION 23503): allocation / location / submission SET NULL, daily log
 *      CASCADE on the section row and SET NULL on the entry, activity and BOQ item RESTRICT;
 *   5. nothing "installed" was added to BoqItem, Activity, ActivityBoqAllocation, ActivityProgress,
 *      ProgressSubmission, IpcItem or StockTransaction — the migration adds two tables and no column.
 * Exit 2 = an assertion failed; 1 = an error.
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

const MIGRATION = "20261005050000_quantity_progress";
const migrationsDir = path.join(backend, "prisma", "migrations");
if (!fs.existsSync(path.join(migrationsDir, MIGRATION, "migration.sql"))) {
  console.error(`no migration folder ${MIGRATION}`);
  process.exit(1);
}

const base = new URL(process.env.DATABASE_URL);
const dbName = `octapm_migtest_${Date.now()}`;
if (!/^octapm_migtest_\d+$/.test(dbName) || dbName === base.pathname.slice(1)) throw new Error("refusing: not a throwaway database name");
const urlFor = (name) => { const u = new URL(base.toString()); u.pathname = `/${name}`; u.searchParams.delete("connection_limit"); return u.toString(); };
const work = fs.mkdtempSync(path.join(os.tmpdir(), "octapm-migtest-"));

const deploy = () => {
  const stage = path.join(work, "stage");
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync(migrationsDir, path.join(stage, "migrations"), { recursive: true });
  fs.copyFileSync(path.join(backend, "prisma", "schema.prisma"), path.join(stage, "schema.prisma"));
  const out = execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(stage, "schema.prisma")], { env: { ...process.env, DATABASE_URL: urlFor(dbName) }, encoding: "utf8" });
  return out.split("\n").filter((l) => /migrations? (found|to apply)|All migrations|No pending/i.test(l)).join(" | ");
};

const columnsOf = async (db, table) => (await db.query(
  `select column_name, is_nullable, column_default, data_type from information_schema.columns
   where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table])).rows;

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

/** Insert one row: every NOT NULL column without a default gets a plausible value, `given` wins. */
const insertRow = async (db, table, given) => {
  const cols = await columnsOf(db, table);
  const allowed = await allowedValuesOf(db, table);
  const row = { ...given };
  cols.forEach((c, i) => {
    if (row[c.column_name] !== undefined) return;
    if (c.is_nullable === "YES" || c.column_default !== null) return;
    if (allowed[c.column_name]) row[c.column_name] = allowed[c.column_name][0];
    else if (/numeric|double|real/.test(c.data_type)) row[c.column_name] = 1 + i;
    else if (/int/.test(c.data_type)) row[c.column_name] = 1 + i;
    else if (/timestamp|date/.test(c.data_type)) row[c.column_name] = new Date(Date.UTC(2026, 8, 1));
    else if (c.data_type === "boolean") row[c.column_name] = false;
    else if (c.data_type === "jsonb" || c.data_type === "json") row[c.column_name] = "{}";
    else if (c.data_type === "ARRAY") row[c.column_name] = [];
    else if (c.data_type === "USER-DEFINED") return;
    else row[c.column_name] = c.column_name === "id" ? crypto.randomUUID() : `fx-${c.column_name}-${crypto.randomUUID().slice(0, 8)}`;
  });
  if (row.id === undefined && cols.some((c) => c.column_name === "id")) row.id = crypto.randomUUID();
  const keys = Object.keys(row);
  await db.query(`insert into "${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((_, k) => `$${k + 1}`).join(",")})`, keys.map((k) => row[k]));
  return row;
};

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures += 1; };
const refused = async (promise, constraint) => {
  try { await promise; return { refused: false }; } catch (e) { return { refused: true, constraint: e.constraint, code: e.code, message: e.message }; }
};

(async () => {
  const admin = new Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  console.log("created throwaway", dbName);
  let db;
  try {
    console.log("deploy:", deploy());
    db = new Client({ connectionString: urlFor(dbName) });
    await db.connect();

    // ── parent fixtures, foreign keys relaxed ────────────────────────────────
    await db.query("SET session_replication_role = replica");
    const orgA = await insertRow(db, "Organisation", { name: "Proof org A" });
    const orgB = await insertRow(db, "Organisation", { name: "Proof org B" });
    const projectA = await insertRow(db, "Project", { orgId: orgA.id, name: "Proof project A" });
    const projectA2 = await insertRow(db, "Project", { orgId: orgA.id, name: "Proof project A2" });
    const activity = await insertRow(db, "Activity", { projectId: projectA.id, name: "Blockwork" });
    const activity2 = await insertRow(db, "Activity", { projectId: projectA2.id, name: "Blockwork 2" });
    const boqItem = await insertRow(db, "BoqItem", { projectId: projectA.id, description: "Blockwork 200mm", unitCode: "m2" });
    const allocation = await insertRow(db, "ActivityBoqAllocation", { projectId: projectA.id, boqItemId: boqItem.id, activityId: activity.id, quantity: 100, amount: 1000, weight: 1 });
    const location = await insertRow(db, "Location", { orgId: orgA.id, projectId: projectA.id, name: "Zone 1", code: "Z1", kind: "zone", path: crypto.randomUUID() });
    const dailyLog = await insertRow(db, "DailyLog", { orgId: orgA.id, projectId: projectA.id, date: new Date(Date.UTC(2026, 8, 3)) });
    const submission = await insertRow(db, "ProgressSubmission", { projectId: projectA.id, activityId: activity.id, method: "quantity", status: "submitted" });
    await db.query("SET session_replication_role = origin");

    const entry = (over = {}) => ({
      id: crypto.randomUUID(), orgId: orgA.id, projectId: projectA.id, activityId: activity.id, boqItemId: boqItem.id,
      unitCode: "m2", quantity: "12.500", date: new Date(Date.UTC(2026, 8, 3)), source: "manual", status: "draft", updatedAt: new Date(), ...over,
    });
    const section = (over = {}) => ({
      id: crypto.randomUUID(), orgId: orgA.id, projectId: projectA.id, dailyLogId: dailyLog.id, activityId: activity.id, boqItemId: boqItem.id,
      unitCode: "m2", quantity: "12.500", updatedAt: new Date(), ...over,
    });
    const insert = (table, row) => insertRow(db, table, row);

    // ── 1. composite tenant key ──────────────────────────────────────────────
    for (const [table, make] of [["QuantityProgressEntry", entry], ["DailyLogQuantity", section]]) {
      const cross = await refused(insert(table, make({ orgId: orgB.id })));
      check(cross.refused && cross.constraint === `${table}_projectId_orgId_fkey`, `${table}: a row naming project A with org B's orgId is refused by ${cross.constraint || "(nothing)"}`);
      // Row 0 in the verifier's sense: the same row with the project's own organisation.
      const own = await refused(insert(table, make()));
      check(!own.refused, `${table}: the same row with the project's organisation goes in${own.refused ? ` — ${own.message}` : ""}`);
      const orphan = await refused(insert(table, make({ projectId: crypto.randomUUID() })));
      check(orphan.refused && orphan.constraint === `${table}_projectId_orgId_fkey`, `${table}: a row naming no project is refused (${orphan.constraint || "not refused"})`);
    }

    // ── 2. idempotency key ───────────────────────────────────────────────────
    for (const [table, make] of [["QuantityProgressEntry", entry], ["DailyLogQuantity", section]]) {
      const key = `outbox-${crypto.randomUUID().slice(0, 8)}`;
      const first = await refused(insert(table, make({ clientRequestId: key })));
      const replay = await refused(insert(table, make({ clientRequestId: key })));
      check(!first.refused && replay.refused && replay.constraint === `${table}_projectId_clientRequestId_key`, `${table}: a replayed clientRequestId is refused by ${replay.constraint || "(nothing)"}`);
      if (table === "QuantityProgressEntry") {
        const elsewhere = await refused(insert(table, make({ clientRequestId: key, projectId: projectA2.id, activityId: activity2.id })));
        check(!elsewhere.refused, `${table}: the same clientRequestId in another project is admitted${elsewhere.refused ? ` — ${elsewhere.message}` : ""}`);
      }
      const nullA = await refused(insert(table, make({ clientRequestId: null })));
      const nullB = await refused(insert(table, make({ clientRequestId: null })));
      check(!nullA.refused && !nullB.refused, `${table}: rows without a clientRequestId do not collide`);
    }

    // ── 3. CHECK constraints (the hand-written tail of the migration) ───────
    // A correction is a rejection plus a new entry, never a negative entry: installed is Σ approved
    // entries, so a negative row would lower an official figure with no rejection trail.
    for (const [table, make] of [["QuantityProgressEntry", entry], ["DailyLogQuantity", section]]) {
      const negative = await refused(insert(table, make({ quantity: "-0.001" })));
      check(negative.refused && negative.code === "23514" && negative.constraint === `${table}_quantity_nonnegative`, `${table}: a negative quantity is refused by ${negative.constraint || "(nothing)"}`);
      const zero = await refused(insert(table, make({ quantity: "0.000" })));
      const positive = await refused(insert(table, make({ quantity: "12.500" })));
      check(!zero.refused && !positive.refused, `${table}: quantity 0 and a positive quantity go in${zero.refused ? ` — ${zero.message}` : ""}${positive.refused ? ` — ${positive.message}` : ""}`);
    }
    const vocab = {
      status: { allowed: ["draft", "submitted", "approved", "rejected"], bad: "pending" },
      source: { allowed: ["submission", "daily_log", "manual", "import"], bad: "mobile" },
    };
    for (const [column, { allowed, bad }] of Object.entries(vocab)) {
      const refusedBad = await refused(insert("QuantityProgressEntry", entry({ [column]: bad })));
      check(refusedBad.refused && refusedBad.code === "23514" && refusedBad.constraint === `QuantityProgressEntry_${column}_check`, `QuantityProgressEntry: ${column} '${bad}' is refused by ${refusedBad.constraint || "(nothing)"}`);
      const admitted = [];
      for (const value of allowed) {
        const r = await refused(insert("QuantityProgressEntry", entry({ [column]: value })));
        if (!r.refused) admitted.push(value);
      }
      check(admitted.length === allowed.length, `QuantityProgressEntry: every ${column} in {${allowed.join(", ")}} goes in (${admitted.length}/${allowed.length})`);
    }
    // DailyLogQuantity.status is deliberately unconstrained (none of its six siblings constrain theirs;
    // daily-log.service drives it), so the declared set is exactly these four and no more.
    const declaredChecks = {};
    for (const table of ["QuantityProgressEntry", "DailyLogQuantity"]) {
      declaredChecks[table] = (await db.query(
        `select c.conname from pg_constraint c where c.contype = 'c' and c.conrelid = format('%I', $1::text)::regclass order by c.conname`, [table])).rows.map((r) => r.conname);
    }
    check(JSON.stringify(declaredChecks.QuantityProgressEntry) === JSON.stringify(["QuantityProgressEntry_quantity_nonnegative", "QuantityProgressEntry_source_check", "QuantityProgressEntry_status_check"]), `QuantityProgressEntry declares exactly its three CHECKs (${declaredChecks.QuantityProgressEntry.join(", ") || "none"})`);
    check(JSON.stringify(declaredChecks.DailyLogQuantity) === JSON.stringify(["DailyLogQuantity_quantity_nonnegative"]), `DailyLogQuantity declares exactly quantity_nonnegative and no status CHECK (${declaredChecks.DailyLogQuantity.join(", ") || "none"})`);

    // ── 4. ON DELETE, declared ───────────────────────────────────────────────
    const expected = {
      QuantityProgressEntry: { orgId: "c", "projectId,orgId": "c", activityId: "r", boqItemId: "r", allocationId: "n", locationId: "n", submissionId: "n", dailyLogId: "n", dailyLogQuantityId: "n" },
      DailyLogQuantity: { dailyLogId: "c", orgId: "c", "projectId,orgId": "c", activityId: "r", boqItemId: "r", allocationId: "n", locationId: "n" },
    };
    const names = { c: "CASCADE", r: "RESTRICT", n: "SET NULL" };
    for (const [table, keys] of Object.entries(expected)) {
      const declared = (await db.query(
        `select c.conname, c.confdeltype, c.confrelid::regclass::text as target,
                (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as cols
         from pg_constraint c where c.contype = 'f' and c.conrelid = format('%I', $1::text)::regclass`, [table])).rows;
      for (const [cols, type] of Object.entries(keys)) {
        const fk = declared.find((d) => d.cols === cols);
        check(Boolean(fk) && fk.confdeltype === type, `${table}(${cols}) → ${fk ? fk.target : "?"}: ON DELETE ${fk ? names[fk.confdeltype] || fk.confdeltype : "missing"} (expected ${names[type]})`);
      }
      check(declared.length === Object.keys(keys).length, `${table}: exactly ${Object.keys(keys).length} foreign keys declared (${declared.length})`);
    }

    // ── 4. ON DELETE, exercised ──────────────────────────────────────────────
    const sectionRow = await insert("DailyLogQuantity", section({ allocationId: allocation.id, locationId: location.id, clientRequestId: `dl-${crypto.randomUUID().slice(0, 8)}` }));
    const linked = await insert("QuantityProgressEntry", entry({
      allocationId: allocation.id, locationId: location.id, submissionId: submission.id, dailyLogId: dailyLog.id, dailyLogQuantityId: sectionRow.id,
      source: "daily_log", status: "approved", approvedBy: "proof", approvedAt: new Date(),
    }));
    const read = async () => (await db.query(`select * from "QuantityProgressEntry" where id = $1`, [linked.id])).rows[0];

    await db.query(`delete from "ActivityBoqAllocation" where id = $1`, [allocation.id]);
    let now = await read();
    check(now && now.allocationId === null, "deleting the allocation nulls entry.allocationId and keeps the entry");
    check((await db.query(`select "allocationId" from "DailyLogQuantity" where id = $1`, [sectionRow.id])).rows[0].allocationId === null, "deleting the allocation nulls the section row's allocationId");

    await db.query(`delete from "Location" where id = $1`, [location.id]);
    now = await read();
    check(now && now.locationId === null, "deleting the location nulls entry.locationId and keeps the entry");

    await db.query(`delete from "ProgressSubmission" where id = $1`, [submission.id]);
    now = await read();
    check(now && now.submissionId === null && now.status === "approved" && String(now.quantity) === "12.500", "deleting the bundling submission nulls entry.submissionId; the approved figure stands");

    const activityDelete = await refused(db.query(`delete from "Activity" where id = $1`, [activity.id]));
    check(activityDelete.refused && /^2300[13]$/.test(activityDelete.code) && /QuantityProgressEntry|DailyLogQuantity/.test(activityDelete.constraint || ""), `deleting the activity is refused by ${activityDelete.constraint || "(nothing)"} (RESTRICT)`);
    const itemDelete = await refused(db.query(`delete from "BoqItem" where id = $1`, [boqItem.id]));
    check(itemDelete.refused && /^2300[13]$/.test(itemDelete.code) && /QuantityProgressEntry|DailyLogQuantity/.test(itemDelete.constraint || ""), `deleting the BOQ item is refused by ${itemDelete.constraint || "(nothing)"} (RESTRICT)`);

    await db.query(`delete from "DailyLog" where id = $1`, [dailyLog.id]);
    const sectionsLeft = (await db.query(`select count(*)::int n from "DailyLogQuantity" where "dailyLogId" = $1`, [dailyLog.id])).rows[0].n;
    now = await read();
    check(sectionsLeft === 0, "deleting the daily log cascades to its quantity section rows");
    check(now && now.dailyLogId === null && now.dailyLogQuantityId === null && now.status === "approved" && now.source === "daily_log", "…and only nulls the approved entry's dailyLogId / dailyLogQuantityId (source + date keep the provenance)");

    // ── 5. no column on the five-truth tables ────────────────────────────────
    const sql = fs.readFileSync(path.join(migrationsDir, MIGRATION, "migration.sql"), "utf8");
    const statements = sql.split("\n").filter((l) => /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(l));
    const foreign = statements.filter((l) => !/^(CREATE TABLE "(QuantityProgressEntry|DailyLogQuantity)"|CREATE (UNIQUE )?INDEX "\w+" ON "(QuantityProgressEntry|DailyLogQuantity)"|ALTER TABLE "(QuantityProgressEntry|DailyLogQuantity)" ADD CONSTRAINT)/.test(l));
    check(foreign.length === 0, `the migration touches only the two new tables (${statements.length} statements, ${foreign.length} elsewhere)`);
    for (const table of ["BoqItem", "Activity", "ActivityBoqAllocation", "ActivityProgress", "ProgressSubmission", "IpcItem", "StockTransaction"]) {
      const cols = (await columnsOf(db, table)).map((c) => c.column_name);
      check(!cols.some((c) => /installed/i.test(c)), `${table} carries no "installed" column (${cols.length} columns)`);
    }

    console.log(`result: ${failures} failure(s)`);
    await db.end(); db = null;
  } finally {
    if (db) await db.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    const left = await admin.query("select count(*)::int n from pg_database where datname like 'octapm_migtest_%'");
    console.log("dropped", dbName, "octapm_migtest_* remaining", left.rows[0].n);
    await admin.end();
    fs.rmSync(work, { recursive: true, force: true });
  }
  process.exitCode = failures ? 2 : 0;
})().catch((e) => { console.error("ERROR", e.message); process.exitCode = 1; });
