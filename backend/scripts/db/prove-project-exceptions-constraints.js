#!/usr/bin/env node
/**
 * Throwaway-database proof of the PC-7b schema (migrations 20261005060000_project_exceptions and
 * 20261005060100_record_ref_uniques; OCTAPM_CHANGE_INTELLIGENCE.md §1, §5, "PC-7b migrations").
 *
 *   node scripts/db/prove-project-exceptions-constraints.js
 *
 * Like verify-additive-migration.js it creates `octapm_migtest_<timestamp>` on the cluster named by
 * DATABASE_URL, deploys every migration into it, and drops it whatever happened. It never connects to
 * the database DATABASE_URL names — only to the cluster's `postgres` database and to the throwaway one.
 * Parent fixture rows are inserted with foreign-key checks relaxed; every assertion runs with them on.
 *
 * What must hold (exit 0):
 *   1. ProjectException's composite tenant key (projectId, orgId) → Project(id, orgId) refuses a row whose
 *      orgId is not its project's and a row naming no project; the master key (costCodeId, orgId) →
 *      CostCode(id, orgId) refuses another organisation's cost code;
 *   2. the hand-written partial unique index "ProjectException_open_subject_key" refuses a second OPEN row for
 *      the same (project, kind, subject, secondary subject) — also when both secondary subjects are NULL, and
 *      also when a resolved row is re-opened beside an open one — while it admits: a new open row once the
 *      first is resolved, any number of resolved rows, distinct secondary subjects, NULL beside a non-null
 *      secondary subject, another kind, and the same subject in another project;
 *   3. every new foreign key's ON DELETE, declared (pg_constraint.confdeltype, and the costCodeId-only column
 *      list of the cost-code key) and exercised: deleting each typed source of a change event (RFI, daily log,
 *      NCR, punch item, sheet revision, submittal, meeting action item, exception) nulls only that column and
 *      keeps the event; deleting a location / WBS node nulls ChangeOrder's and the exception's link; deleting a
 *      cost code nulls the exception's costCodeId and keeps its orgId; deleting a change event nulls the
 *      exception's changeEventId; deleting a change order nulls Rfi.changeOrderId; deleting the project
 *      cascades to its exceptions;
 *   4. @@unique([projectId, ref]) on ChangeOrder, Risk and NcrRecord refuses a duplicate ref in a project and
 *      admits the same ref in another project; ProcurementOrder is NOT constrained (a duplicate still goes in —
 *      its live duplicates are the owner's stop);
 *   5. the two migrations are additive and confined: 20261005060000 adds columns only to ChangeOrder
 *      (locationId, wbsNodeId) and ChangeEvent (the eight typed links), drops nothing but the constraint it
 *      created itself, and writes no row; 20261005060100 creates exactly three unique indexes.
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

const MIGRATIONS = ["20261005060000_project_exceptions", "20261005060100_record_ref_uniques"];
const migrationsDir = path.join(backend, "prisma", "migrations");
for (const m of MIGRATIONS) {
  if (!fs.existsSync(path.join(migrationsDir, m, "migration.sql"))) {
    console.error(`no migration folder ${m}`);
    process.exit(1);
  }
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
const refused = async (promise) => {
  try { await promise; return { refused: false }; } catch (e) { return { refused: true, constraint: e.constraint, code: e.code, message: e.message }; }
};
const why = (r) => (r.refused ? ` — ${r.message}` : "");

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
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];

    // ── parent fixtures, foreign keys relaxed ────────────────────────────────
    await db.query("SET session_replication_role = replica");
    const orgA = await insertRow(db, "Organisation", { name: "Proof org A" });
    const orgB = await insertRow(db, "Organisation", { name: "Proof org B" });
    const projectA = await insertRow(db, "Project", { orgId: orgA.id, name: "Proof project A" });
    const projectA2 = await insertRow(db, "Project", { orgId: orgA.id, name: "Proof project A2" });
    const projectB = await insertRow(db, "Project", { orgId: orgB.id, name: "Proof project B" });
    const location = await insertRow(db, "Location", { orgId: orgA.id, projectId: projectA.id, name: "Zone 1", code: "Z1", kind: "zone", path: crypto.randomUUID() });
    const wbsNode = await insertRow(db, "WbsNode", { orgId: orgA.id, projectId: projectA.id, code: "1.1", name: "Substructure", path: crypto.randomUUID() });
    const costCodeA = await insertRow(db, "CostCode", { orgId: orgA.id, code: "03-300", name: "Concrete" });
    const costCodeB = await insertRow(db, "CostCode", { orgId: orgB.id, code: "03-300", name: "Concrete (org B)" });
    const rfi = await insertRow(db, "Rfi", { projectId: projectA.id, ref: "RFI-001", subject: "Slab edge" });
    const dailyLog = await insertRow(db, "DailyLog", { orgId: orgA.id, projectId: projectA.id, date: new Date(Date.UTC(2026, 8, 3)) });
    const ncr = await insertRow(db, "NcrRecord", { projectId: projectA.id, ref: "NCR-001" });
    const punch = await insertRow(db, "PunchItem", { orgId: orgA.id, projectId: projectA.id, ref: "PI-001" });
    const sheetRevision = await insertRow(db, "SheetRevision", { orgId: orgA.id, projectId: projectA.id });
    const submittal = await insertRow(db, "Submittal", { projectId: projectA.id, ref: "SUB-001" });
    const actionItem = await insertRow(db, "MeetingActionItem", { orgId: orgA.id, projectId: projectA.id });
    await db.query("SET session_replication_role = origin");

    const exception = (over = {}) => ({
      id: crypto.randomUUID(), orgId: orgA.id, projectId: projectA.id, kind: "quantity_over_allocation", severity: "warning",
      subjectType: "allocation", subjectId: "alloc-1", measured: "120.000", limit: "100.000", unitCode: "m3",
      measuredBasis: "quantity-views.service installed (approved entries)", limitBasis: "activity-boq-allocation.service approved allocation quantity",
      updatedAt: new Date(), ...over,
    });
    const insertException = (over) => insertRow(db, "ProjectException", exception(over));

    // ── 1. tenant keys ───────────────────────────────────────────────────────
    const cross = await refused(insertException({ orgId: orgB.id }));
    check(cross.refused && cross.constraint === "ProjectException_projectId_orgId_fkey", `an exception naming project A with org B's orgId is refused by ${cross.constraint || "(nothing)"}`);
    const orphan = await refused(insertException({ projectId: crypto.randomUUID(), subjectId: "orphan" }));
    check(orphan.refused && orphan.constraint === "ProjectException_projectId_orgId_fkey", `an exception naming no project is refused by ${orphan.constraint || "(nothing)"}`);
    const foreignCode = await refused(insertException({ costCodeId: costCodeB.id, subjectId: "foreign-code" }));
    check(foreignCode.refused && foreignCode.constraint === "ProjectException_costCodeId_orgId_fkey", `an exception of org A naming org B's cost code is refused by ${foreignCode.constraint || "(nothing)"}`);
    const unknownOrg = await refused(insertException({ orgId: crypto.randomUUID(), subjectId: "no-org" }));
    check(unknownOrg.refused && /^ProjectException_(orgId|projectId_orgId)_fkey$/.test(unknownOrg.constraint || ""), `an exception naming no organisation is refused by ${unknownOrg.constraint || "(nothing)"}`);
    const own = await refused(insertException({ costCodeId: costCodeA.id, locationId: location.id, wbsNodeId: wbsNode.id, subjectId: "tenant-ok" }));
    check(!own.refused, `the same exception with the project's organisation and its own cost code goes in${why(own)}`);

    // ── 2. open-row uniqueness (the hand-written partial index) ──────────────
    const first = await insertException({ subjectId: "S1" });
    const second = await refused(insertException({ subjectId: "S1" }));
    check(second.refused && second.code === "23505" && second.constraint === "ProjectException_open_subject_key", `a second OPEN row for the same subject (both secondary subjects NULL) is refused by ${second.constraint || "(nothing)"}`);
    await db.query(`update "ProjectException" set "resolvedAt" = now(), "resolvedReason" = 'gap closed' where id = $1`, [first.id]);
    const reopened = await refused(insertException({ subjectId: "S1" }));
    check(!reopened.refused, `once the first row is resolved a new OPEN row for the same subject goes in${why(reopened)}`);
    await db.query(`update "ProjectException" set "resolvedAt" = now() where "subjectId" = 'S1' and "resolvedAt" is null`);
    const resolvedAgain = await refused(insertException({ subjectId: "S1", resolvedAt: new Date(), resolvedReason: "history" }));
    check(!resolvedAgain.refused, `any number of RESOLVED rows for the same subject go in (history kept)${why(resolvedAgain)}`);
    const reopenOne = await refused(insertException({ subjectId: "S1" }));
    const reopenOther = await refused(db.query(`update "ProjectException" set "resolvedAt" = null where id = $1`, [first.id]));
    check(!reopenOne.refused && reopenOther.refused && reopenOther.constraint === "ProjectException_open_subject_key", `re-opening a resolved row beside an open one is refused by ${reopenOther.constraint || "(nothing)"}`);

    const secA = await refused(insertException({ subjectId: "S2", secondarySubjectType: "activity", secondarySubjectId: "act-1" }));
    const secB = await refused(insertException({ subjectId: "S2", secondarySubjectType: "activity", secondarySubjectId: "act-2" }));
    const secNull = await refused(insertException({ subjectId: "S2" }));
    check(!secA.refused && !secB.refused && !secNull.refused, `distinct secondary subjects, and NULL beside a non-null one, are separate open rows${why(secA)}${why(secB)}${why(secNull)}`);
    const secDup = await refused(insertException({ subjectId: "S2", secondarySubjectType: "activity", secondarySubjectId: "act-1" }));
    check(secDup.refused && secDup.constraint === "ProjectException_open_subject_key", `the same non-null secondary subject collides (${secDup.constraint || "not refused"})`);
    const typeOnly = await refused(insertException({ subjectId: "S3", secondarySubjectType: "activity" }));
    const typeOnlyDup = await refused(insertException({ subjectId: "S3", secondarySubjectType: "activity" }));
    check(!typeOnly.refused && typeOnlyDup.refused && typeOnlyDup.constraint === "ProjectException_open_subject_key", `a secondary type with a NULL id collides with itself too (${typeOnlyDup.constraint || "not refused"})`);
    const otherKind = await refused(insertException({ subjectId: "S1", kind: "quantity_over_boq", subjectType: "allocation" }));
    const otherProject = await refused(insertException({ subjectId: "S1", projectId: projectA2.id }));
    check(!otherKind.refused && !otherProject.refused, `the same subject under another kind, or in another project, is a separate open row${why(otherKind)}${why(otherProject)}`);
    const indexDef = (await one(`select indexdef from pg_indexes where indexname = 'ProjectException_open_subject_key'`))?.indexdef || "";
    check(/UNIQUE INDEX/.test(indexDef) && /COALESCE\("secondarySubjectType"/.test(indexDef) && /COALESCE\("secondarySubjectId"/.test(indexDef) && /WHERE \("resolvedAt" IS NULL\)/.test(indexDef), `the partial index is declared as designed (${indexDef || "missing"})`);

    // ── 3. ON DELETE, declared ───────────────────────────────────────────────
    const expected = {
      ProjectException: { orgId: "c", "projectId,orgId": "c", wbsNodeId: "n", locationId: "n", "costCodeId,orgId": "n", changeEventId: "n" },
      ChangeEvent: { rfiId: "n", dailyLogId: "n", ncrId: "n", punchItemId: "n", drawingRevisionId: "n", submittalId: "n", meetingActionItemId: "n", exceptionId: "n" },
      ChangeOrder: { locationId: "n", wbsNodeId: "n" },
      Rfi: { changeOrderId: "n" },
    };
    const names = { c: "CASCADE", r: "RESTRICT", n: "SET NULL", a: "NO ACTION" };
    const declaredOf = async (table) => (await db.query(
      `select c.conname, c.confdeltype, c.confrelid::regclass::text as target,
              (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as cols,
              (select string_agg(a.attname, ',') from unnest(c.confdelsetcols) s(n) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = s.n) as setcols
       from pg_constraint c where c.contype = 'f' and c.conrelid = format('%I', $1::text)::regclass`, [table])).rows;
    for (const [table, keys] of Object.entries(expected)) {
      const declared = await declaredOf(table);
      for (const [cols, type] of Object.entries(keys)) {
        const fk = declared.find((d) => d.cols === cols);
        check(Boolean(fk) && fk.confdeltype === type, `${table}(${cols}) → ${fk ? fk.target : "?"}: ON DELETE ${fk ? names[fk.confdeltype] || fk.confdeltype : "missing"} (expected ${names[type]})`);
      }
      if (table === "ProjectException") {
        check(declared.length === Object.keys(keys).length, `ProjectException: exactly ${Object.keys(keys).length} foreign keys declared (${declared.length})`);
        const cc = declared.find((d) => d.cols === "costCodeId,orgId");
        check(Boolean(cc) && cc.setcols === "costCodeId", `ProjectException's cost-code key nulls costCodeId only (SET NULL column list: ${cc ? cc.setcols || "all columns" : "missing"})`);
      }
    }

    // ── 3. ON DELETE, exercised ──────────────────────────────────────────────
    const changeOrder = await insertRow(db, "ChangeOrder", { projectId: projectA.id, ref: "CO-001", description: "Slab thickening", locationId: location.id, wbsNodeId: wbsNode.id, updatedAt: new Date() });
    await db.query(`update "Rfi" set "changeOrderId" = $1 where id = $2`, [changeOrder.id, rfi.id]);
    const linkedException = await insertException({ subjectId: "linked", costCodeId: costCodeA.id, locationId: location.id, wbsNodeId: wbsNode.id });
    const event = await insertRow(db, "ChangeEvent", {
      orgId: orgA.id, projectId: projectA.id, number: 1, ref: "CE-001", title: "From the exception", origin: "other", updatedAt: new Date(),
      rfiId: rfi.id, dailyLogId: dailyLog.id, ncrId: ncr.id, punchItemId: punch.id, drawingRevisionId: sheetRevision.id,
      submittalId: submittal.id, meetingActionItemId: actionItem.id, exceptionId: linkedException.id,
      sourceRecordType: "exception", sourceRecordId: linkedException.id,
    });
    await db.query(`update "ProjectException" set "changeEventId" = $1 where id = $2`, [event.id, linkedException.id]);
    const badTyped = await refused(db.query(`update "ChangeEvent" set "ncrId" = $1 where id = $2`, [crypto.randomUUID(), event.id]));
    check(badTyped.refused && badTyped.constraint === "ChangeEvent_ncrId_fkey", `a typed link naming no record is refused by ${badTyped.constraint || "(nothing)"}`);
    const readEvent = () => one(`select * from "ChangeEvent" where id = $1`, [event.id]);
    const readException = () => one(`select * from "ProjectException" where id = $1`, [linkedException.id]);

    for (const [table, id, column] of [
      ["Rfi", rfi.id, "rfiId"], ["DailyLog", dailyLog.id, "dailyLogId"], ["NcrRecord", ncr.id, "ncrId"], ["PunchItem", punch.id, "punchItemId"],
      ["SheetRevision", sheetRevision.id, "drawingRevisionId"], ["Submittal", submittal.id, "submittalId"], ["MeetingActionItem", actionItem.id, "meetingActionItemId"],
    ]) {
      const before = await readEvent();
      await db.query(`delete from "${table}" where id = $1`, [id]);
      const after = await readEvent();
      const others = Object.keys(expected.ChangeEvent).filter((c) => c !== column);
      check(after && after[column] === null && others.every((c) => after[c] === before[c]) && after.sourceRecordType === "exception" && after.sourceRecordId === linkedException.id,
        `deleting the ${table} nulls ChangeEvent.${column} only; the event and its free-text pair stay`);
    }

    await db.query(`delete from "Location" where id = $1`, [location.id]);
    check((await one(`select "locationId" from "ChangeOrder" where id = $1`, [changeOrder.id])).locationId === null && (await readException()).locationId === null, "deleting the location nulls ChangeOrder.locationId and the exception's locationId");
    await db.query(`delete from "WbsNode" where id = $1`, [wbsNode.id]);
    check((await one(`select "wbsNodeId" from "ChangeOrder" where id = $1`, [changeOrder.id])).wbsNodeId === null && (await readException()).wbsNodeId === null, "deleting the WBS node nulls ChangeOrder.wbsNodeId and the exception's wbsNodeId");
    const codeDelete = await refused(db.query(`delete from "CostCode" where id = $1`, [costCodeA.id]));
    const afterCode = await readException();
    check(!codeDelete.refused && afterCode.costCodeId === null && afterCode.orgId === orgA.id, `deleting the cost code nulls the exception's costCodeId and keeps its orgId${why(codeDelete)}`);

    const rfiCo = await insertRow(db, "Rfi", { projectId: projectA.id, ref: "RFI-002", subject: "Linked to the order", changeOrderId: changeOrder.id });
    await db.query(`delete from "ChangeOrder" where id = $1`, [changeOrder.id]);
    check((await one(`select "changeOrderId" from "Rfi" where id = $1`, [rfiCo.id])).changeOrderId === null, "deleting the change order nulls Rfi.changeOrderId and keeps the RFI");

    await db.query(`delete from "ProjectException" where id = $1`, [linkedException.id]);
    check((await readEvent()).exceptionId === null, "deleting the exception nulls ChangeEvent.exceptionId and keeps the event");
    const handoff = await insertException({ subjectId: "handoff", changeEventId: event.id });
    await db.query(`delete from "ChangeEvent" where id = $1`, [event.id]);
    check((await one(`select "changeEventId" from "ProjectException" where id = $1`, [handoff.id])).changeEventId === null, "deleting the change event nulls the exception's changeEventId and keeps the exception");

    const inB = await refused(insertException({ orgId: orgB.id, projectId: projectB.id, subjectId: "cascade" }));
    check(!inB.refused, `an exception in org B's own project goes in${why(inB)}`);
    await db.query(`delete from "Project" where id = $1`, [projectB.id]);
    check((await one(`select count(*)::int n from "ProjectException" where "projectId" = $1`, [projectB.id])).n === 0, "deleting the project cascades to its exceptions");

    // ── 4. ref uniques ───────────────────────────────────────────────────────
    const refRow = {
      ChangeOrder: (projectId) => ({ projectId, ref: "REF-1", description: "Proof", updatedAt: new Date() }),
      Risk: (projectId) => ({ projectId, ref: "REF-1" }),
      NcrRecord: (projectId) => ({ projectId, ref: "REF-1" }),
    };
    for (const [table, make] of Object.entries(refRow)) {
      const a = await refused(insertRow(db, table, make(projectA.id)));
      const dup = await refused(insertRow(db, table, make(projectA.id)));
      const elsewhere = await refused(insertRow(db, table, make(projectA2.id)));
      check(!a.refused && dup.refused && dup.code === "23505" && dup.constraint === `${table}_projectId_ref_key`, `${table}: a duplicate ref in the same project is refused by ${dup.constraint || "(nothing)"}${why(a)}`);
      check(!elsewhere.refused, `${table}: the same ref in another project goes in${why(elsewhere)}`);
    }
    const poA = await refused(insertRow(db, "ProcurementOrder", { projectId: projectA.id, ref: "PO-DUP", updatedAt: new Date() }));
    const poB = await refused(insertRow(db, "ProcurementOrder", { projectId: projectA.id, ref: "PO-DUP", updatedAt: new Date() }));
    check(!poA.refused && !poB.refused, `ProcurementOrder is not constrained: a duplicate ref still goes in (its live duplicates are the owner's stop)${why(poA)}${why(poB)}`);
    const poIndex = await one(`select count(*)::int n from pg_indexes where tablename = 'ProcurementOrder' and indexdef ilike '%UNIQUE%' and indexdef ilike '%"ref"%'`);
    check(poIndex.n === 0, `ProcurementOrder carries no unique index on ref (${poIndex.n})`);

    // ── 5. additive and confined ─────────────────────────────────────────────
    const statementsOf = (m) => fs.readFileSync(path.join(migrationsDir, m, "migration.sql"), "utf8").replace(/\r\n/g, "\n")
      .split("\n").filter((l) => /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(l));
    const s1 = statementsOf(MIGRATIONS[0]);
    const allowed1 = [
      /^CREATE TABLE "ProjectException" \($/,
      /^CREATE (UNIQUE )?INDEX "\w+" ON "(ProjectException|ChangeEvent|ChangeOrder|Rfi)"\(/,
      /^ALTER TABLE "(ChangeOrder|ChangeEvent)" ADD COLUMN {5}"\w+" TEXT,?$/,
      /^ALTER TABLE "(ProjectException|ChangeEvent|ChangeOrder|Rfi)" ADD CONSTRAINT "\w+" FOREIGN KEY /,
      /^ALTER TABLE "ProjectException" DROP CONSTRAINT "ProjectException_costCodeId_orgId_fkey";$/,
    ];
    const stray1 = s1.filter((l) => !allowed1.some((re) => re.test(l)));
    check(stray1.length === 0, `${MIGRATIONS[0]}: every statement is a new table, index, nullable column or key (${s1.length} statements, ${stray1.length} elsewhere${stray1.length ? `: ${stray1.join(" | ")}` : ""})`);
    const sql1 = fs.readFileSync(path.join(migrationsDir, MIGRATIONS[0], "migration.sql"), "utf8");
    const addedColumns = [...sql1.matchAll(/ADD COLUMN\s+"(\w+)"/g)].map((m) => m[1]).sort();
    check(JSON.stringify(addedColumns) === JSON.stringify(["dailyLogId", "drawingRevisionId", "exceptionId", "locationId", "meetingActionItemId", "ncrId", "punchItemId", "rfiId", "submittalId", "wbsNodeId"]),
      `the only columns added to existing tables are the eight typed ChangeEvent links and ChangeOrder.locationId / wbsNodeId (${addedColumns.join(", ")})`);
    const s2 = statementsOf(MIGRATIONS[1]);
    check(s2.length === 3 && s2.every((l) => /^CREATE UNIQUE INDEX "(ChangeOrder|Risk|NcrRecord)_projectId_ref_key" ON "(ChangeOrder|Risk|NcrRecord)"\("projectId", "ref"\);$/.test(l)), `${MIGRATIONS[1]}: exactly three unique (projectId, ref) indexes (${s2.length} statements)`);

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
