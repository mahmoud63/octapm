/**
 * Audit Decimal-internals census — READ ONLY by construction.
 *
 * Until 2026-09-30 the audit serialiser walked a Prisma Decimal field by
 * field, so an amount handed to it as a Decimal was stored as the Decimal's
 * internals — { d: [...], e, s, constructor: "function …" } — instead of a
 * number. The writer is fixed and the read path decodes the old shape; the
 * stored rows are history and are NOT rewritten. This script only counts them
 * so the owner knows how many carry the old shape, where and since when.
 *
 *   node scripts/project-controls/audit-decimal-internals-census.js            (durable organisations)
 *   node scripts/project-controls/audit-decimal-internals-census.js --all      (LiveTest organisations too)
 *   node scripts/project-controls/audit-decimal-internals-census.js --json
 *
 * Read-only guarantees: one connection (DATABASE_CONNECTION_LIMIT=1, set
 * before the client is loaded); the session is
 * `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` before anything else
 * runs, and `SHOW transaction_read_only` must read `on` before and after —
 * otherwise the script stops (exit 2). Only SELECTs are issued.
 */
const path = require("path");

const backendDir = path.resolve(__dirname, "..", "..");
process.chdir(backendDir);
require("dotenv").config({ path: path.join(backendDir, ".env") });
process.env.DATABASE_CONNECTION_LIMIT = "1";

const { prisma } = require(path.join(backendDir, "src", "config", "db"));

const flags = new Set(process.argv.slice(2));
const includeLive = flags.has("--all");
const asJson = flags.has("--json");

// jsonb prints an object's keys shortest first, so a stored Decimal reads
// {"d": [...], "e": n, "s": ±1, "constructor": "function …"} — or without the
// constructor where a serialiser dropped the function, or with the digits
// truncated where the Decimal sat at the serialiser's depth limit.
const SHAPE = String.raw`\{"d": (\[[0-9, ]*\]|"\[truncated\]"), "e": -?[0-9]+, "s": -?1(, "constructor": "|\})`;

const COLUMNS = {
  AuditEvent: { at: "occurredAt", kind: "entityType", columns: ["oldSummaryJson", "newSummaryJson", "summaryJson", "attachmentsJson", "metadataJson"] },
  RecordHistorySnapshot: { at: "occurredAt", kind: "entityType", columns: ["previousSnapshotJson", "snapshotJson", "changeSetJson", "metadataJson"] },
  OutboundEvent: { at: "createdAt", kind: "entityType", columns: ["payloadJson"] },
  ApprovalWorkflowEvent: { at: "createdAt", kind: "recordType", columns: ["metadataJson"] },
  Notification: { at: "createdAt", kind: "category", columns: ["metadataJson"] },
};

const readOnly = async (when) => {
  const [{ transaction_read_only: value }] = await prisma.$queryRawUnsafe("SHOW transaction_read_only");
  if (value !== "on") {
    console.error(`the session is not read-only ${when} (transaction_read_only = ${value}); stopping`);
    process.exit(2);
  }
  return value;
};

(async () => {
  await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  const before = await readOnly("before the run");
  const scope = includeLive ? "" : `AND o."name" NOT LIKE 'LiveTest %'`;
  const report = { scope: includeLive ? "every organisation" : "durable organisations (LiveTest excluded)", readOnly: { before }, tables: {} };

  for (const [table, { at, kind, columns }] of Object.entries(COLUMNS)) {
    const match = columns.map((column) => `t."${column}"::text ~ $1`).join(" OR ");
    const from = `FROM "${table}" t JOIN "Organisation" o ON o."id" = t."orgId" WHERE (${match}) ${scope}`;
    const [total] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS rows, count(DISTINCT t."orgId")::int AS organisations, min(t."${at}") AS first, max(t."${at}") AS last ${from}`, SHAPE);
    const [scanned] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS rows FROM "${table}" t JOIN "Organisation" o ON o."id" = t."orgId" WHERE true ${scope}`);
    const byKind = await prisma.$queryRawUnsafe(`SELECT t."${kind}" AS kind, count(*)::int AS rows ${from} GROUP BY 1 ORDER BY 2 DESC`, SHAPE);
    const byDay = await prisma.$queryRawUnsafe(`SELECT to_char(t."${at}", 'YYYY-MM-DD') AS day, count(*)::int AS rows ${from} GROUP BY 1 ORDER BY 1`, SHAPE);
    const byOrg = await prisma.$queryRawUnsafe(`SELECT o."name" AS organisation, count(*)::int AS rows ${from} GROUP BY 1 ORDER BY 2 DESC`, SHAPE);
    const byColumn = {};
    for (const column of columns) {
      const [row] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS rows FROM "${table}" t JOIN "Organisation" o ON o."id" = t."orgId" WHERE t."${column}"::text ~ $1 ${scope}`, SHAPE);
      byColumn[column] = row.rows;
    }
    report.tables[table] = { scanned: scanned.rows, affected: total.rows, organisations: total.organisations, first: total.first, last: total.last, byColumn, byKind, byDay, byOrg };
  }
  report.readOnly.after = await readOnly("after the run");

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`# Audit Decimal-internals census — ${report.scope}`);
    console.log(`session read-only: before ${report.readOnly.before}, after ${report.readOnly.after}`);
    for (const [table, found] of Object.entries(report.tables)) {
      console.log(`\n## ${table}: ${found.affected} of ${found.scanned} rows carry a stored Decimal's internals (${found.organisations} organisations)`);
      if (!found.affected) continue;
      console.log(`first ${new Date(found.first).toISOString()}, last ${new Date(found.last).toISOString()}`);
      console.log(`by column: ${Object.entries(found.byColumn).map(([column, rows]) => `${column} ${rows}`).join(", ")}`);
      console.log(`by kind: ${found.byKind.map((row) => `${row.kind} ${row.rows}`).join(", ")}`);
      console.log(`by day: ${found.byDay.map((row) => `${row.day} ${row.rows}`).join(", ")}`);
      console.log(`by organisation: ${found.byOrg.map((row) => `${row.organisation} ${row.rows}`).join(", ")}`);
    }
  }
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
