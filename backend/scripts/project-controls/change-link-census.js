#!/usr/bin/env node
/**
 * Change-link census — READ ONLY by construction (PC-7b, OCTAPM_CHANGE_INTELLIGENCE.md §5).
 *
 *   node scripts/project-controls/change-link-census.js [--json <file>]
 *
 * Before `Rfi.changeOrderId` (a bare string today) may become a real foreign
 * key → ChangeOrder, every non-null value must name an existing change order
 * OF THE SAME PROJECT. A foreign key can only refuse a missing row; a link to
 * another project's order is invisible to it, so that case is counted here.
 * This script counts, over every organisation:
 *
 *   Rfi.changeOrderId    non-null values, resolved in the same project,
 *                        resolved in ANOTHER project (cross-project), orphaned
 *                        (no such change order);
 *   ChangeEvent source   the free-text sourceRecordType / sourceRecordId pairs
 *                        by type, and how many of them would resolve to the
 *                        typed column PC-7b adds (rfi, daily_log, ncr, punch,
 *                        drawing revision, submittal, meeting action) in the
 *                        same project — informational: the free-text pair is
 *                        kept, nothing is backfilled by the migration.
 *
 * Exit 0 = every Rfi.changeOrderId resolves in its own project (the relation
 * may be declared); 2 = at least one cross-project or orphaned value (the
 * column stays a string and the rows are reported — who owns them is the
 * owner's decision, never a migration's); 1 = an error.
 *
 * Read-only guarantees: one connection to the database DATABASE_URL names;
 * `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` runs first and
 * `SHOW transaction_read_only` must read `on` before and after the reads, or
 * the script stops (exit 1) — PostgreSQL refuses any write on that session.
 * Run it under the cross-wave database lock (C:/Temp/octapm-dblock.js).
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

/** The typed ChangeEvent columns PC-7b adds, with the free-text sourceRecordType values that would map to each. */
const TYPED_SOURCES = [
  { column: "rfiId", table: "Rfi", types: ["rfi"] },
  { column: "dailyLogId", table: "DailyLog", types: ["daily_log", "dailylog", "daily-log"] },
  { column: "ncrId", table: "NcrRecord", types: ["ncr", "ncr_record", "observation"] },
  { column: "punchItemId", table: "PunchItem", types: ["punch", "punch_item", "observation"] },
  { column: "drawingRevisionId", table: "SheetRevision", types: ["drawing", "drawing_revision", "sheet_revision"] },
  { column: "submittalId", table: "Submittal", types: ["submittal"] },
  { column: "meetingActionItemId", table: "MeetingActionItem", types: ["meeting", "meeting_action", "meeting_action_item"] },
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
    await assertReadOnly(db, "before the census");
    console.log(`change-link census on ${url.pathname.slice(1)} (read-only session verified)`);

    // ── Rfi.changeOrderId ────────────────────────────────────────────────────
    const rfi = (await db.query(`
      SELECT count(*) FILTER (WHERE r."changeOrderId" IS NOT NULL)::int AS "nonNull",
             count(*) FILTER (WHERE co."id" IS NOT NULL AND co."projectId" = r."projectId")::int AS "sameProject",
             count(*) FILTER (WHERE co."id" IS NOT NULL AND co."projectId" <> r."projectId")::int AS "crossProject",
             count(*) FILTER (WHERE r."changeOrderId" IS NOT NULL AND co."id" IS NULL)::int AS "orphaned",
             count(*)::int AS "rfis"
      FROM "Rfi" r LEFT JOIN "ChangeOrder" co ON co."id" = r."changeOrderId"`)).rows[0];
    const badRows = (await db.query(`
      SELECT r."id", r."projectId", r."ref", r."changeOrderId", co."projectId" AS "changeOrderProjectId"
      FROM "Rfi" r LEFT JOIN "ChangeOrder" co ON co."id" = r."changeOrderId"
      WHERE r."changeOrderId" IS NOT NULL AND (co."id" IS NULL OR co."projectId" <> r."projectId")
      ORDER BY r."projectId", r."ref"`)).rows;
    console.log(`Rfi: ${rfi.rfis} rows, changeOrderId non-null ${rfi.nonNull}, same project ${rfi.sameProject}, cross-project ${rfi.crossProject}, orphaned ${rfi.orphaned}`);
    for (const row of badRows) console.log(`  ${row.changeOrderProjectId ? "CROSS " : "ORPHAN"} Rfi ${row.id} (${row.ref}, project ${row.projectId}) → ${row.changeOrderId}${row.changeOrderProjectId ? ` in project ${row.changeOrderProjectId}` : ""}`);

    // ── ChangeEvent free-text source pairs (informational) ───────────────────
    const events = (await db.query(`
      SELECT coalesce(ce."sourceRecordType", '(none)') AS "type", count(*)::int AS "events",
             count(*) FILTER (WHERE ce."sourceRecordId" IS NOT NULL)::int AS "withId"
      FROM "ChangeEvent" ce GROUP BY 1 ORDER BY 1`)).rows;
    console.log(`ChangeEvent source pairs: ${events.length ? events.map((e) => `${e.type} ${e.events} (${e.withId} with an id)`).join(", ") : "no change events"}`);
    const typed = [];
    for (const source of TYPED_SOURCES) {
      const found = (await db.query(`
        SELECT count(*)::int AS "candidates",
               count(t."id") FILTER (WHERE t."projectId" = ce."projectId")::int AS "resolvable"
        FROM "ChangeEvent" ce LEFT JOIN "${source.table}" t ON t."id" = ce."sourceRecordId"
        WHERE lower(ce."sourceRecordType") = ANY($1::text[]) AND ce."sourceRecordId" IS NOT NULL`, [source.types])).rows[0];
      typed.push({ ...source, ...found });
      console.log(`  → ${source.column.padEnd(20)} (${source.table}): ${found.candidates} candidate pair(s), ${found.resolvable} resolvable in the same project`);
    }

    await assertReadOnly(db, "after the census");
    const ok = rfi.crossProject === 0 && rfi.orphaned === 0;
    console.log(ok
      ? `\nresult: every non-null Rfi.changeOrderId (${rfi.nonNull}) names a change order of its own project — the relation may be declared`
      : `\nresult: STOP — ${rfi.crossProject} cross-project and ${rfi.orphaned} orphaned Rfi.changeOrderId value(s); the column stays a string`);
    if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), database: url.pathname.slice(1), ok, rfi, badRows, events, typed }, null, 2));
    process.exitCode = ok ? 0 : 2;
  } finally {
    await db.end();
  }
})().catch((error) => {
  console.error("ERROR", error.message);
  process.exitCode = 1;
});
