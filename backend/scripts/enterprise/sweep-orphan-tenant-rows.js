/**
 * The orphan-row retention sweep for the tables that keep no organisation
 * key by design (enterprise programme, architecture doc §4; wave ENT-3).
 *
 *   node scripts/enterprise/sweep-orphan-tenant-rows.js                       # report only
 *   node scripts/enterprise/sweep-orphan-tenant-rows.js --json <path>
 *   SWEEP_CONFIRM=<retention days> node scripts/enterprise/sweep-orphan-tenant-rows.js --apply
 *
 * BackgroundJob, OutboundEvent, AuditEvent and RecordHistorySnapshot carry an
 * orgId with no foreign key, and rows of organisations deleted long ago sit
 * in them (431 / 7,205 / 7,335 on the local database when the architecture
 * was written). A key would force those rows out, so none is added; instead
 * this script counts them, per table and per missing organisation, so the
 * product owner can decide what to keep (PO decision 2).
 *
 * The dry run is the whole of this wave. --apply exists so the decision has
 * somewhere to land, but it refuses unless SWEEP_CONFIRM names the retention
 * window in days — and then deletes only orphan rows older than that window,
 * oldest organisation first, in batches, printing what it removed. It never
 * touches a row whose organisation still exists. RecordHistorySnapshot goes
 * with its AuditEvent (auditEventId → AuditEvent, CASCADE), so the audit
 * table is swept last and its snapshots are counted under it.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:sweep-orphan-tenant-rows");

const fs = require("fs");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../src/config/db");
const { defaultReportPath, parseArgs, printHeader, printResult } = require("./lib");

/** Table, its timestamp column, and how its rows are removed. */
const TABLES = [
  { name: "BackgroundJob", timeColumn: "createdAt" },
  { name: "OutboundEvent", timeColumn: "createdAt" },
  { name: "RecordHistorySnapshot", timeColumn: "createdAt", via: "AuditEvent" },
  { name: "AuditEvent", timeColumn: "createdAt" },
];
const BATCH = 5_000;
const MAX_LISTED = 25;

const rows = (sql) => prisma.$queryRaw(sql);
const count = async (sql) => Number((await rows(sql))[0].count);
const ident = (name) => Prisma.raw(`"${String(name).replace(/"/g, '""')}"`);

/** Orphans: rows whose orgId names no organisation. NULL orgIds are not orphans (pre-login audit rows are unowned by design). */
const orphanCounts = async ({ name, timeColumn }, retentionDays) => {
  const t = ident(name);
  const time = ident(timeColumn);
  const total = await count(Prisma.sql`SELECT count(*)::int AS count FROM ${t} t`);
  const orphaned = await count(Prisma.sql`
    SELECT count(*)::int AS count FROM ${t} t
    WHERE t."orgId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organisation" o WHERE o."id" = t."orgId")`);
  const beyondRetention =
    retentionDays == null
      ? null
      : await count(Prisma.sql`
          SELECT count(*)::int AS count FROM ${t} t
          WHERE t."orgId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organisation" o WHERE o."id" = t."orgId")
            AND t.${time} < now() - make_interval(days => ${retentionDays})`);
  const byOrg = await rows(Prisma.sql`
    SELECT t."orgId", count(*)::int AS "rows", min(t.${time}) AS "oldest", max(t.${time}) AS "newest" FROM ${t} t
    WHERE t."orgId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organisation" o WHERE o."id" = t."orgId")
    GROUP BY t."orgId" ORDER BY min(t.${time}), t."orgId"`);
  return { table: name, total, orphaned, beyondRetention, missingOrganisations: byOrg.length, byOrg };
};

const sweep = async ({ name, timeColumn }, retentionDays) => {
  const t = ident(name);
  const time = ident(timeColumn);
  let removed = 0;
  for (;;) {
    const batch = await prisma.$executeRaw(Prisma.sql`
      DELETE FROM ${t} WHERE "id" IN (
        SELECT t."id" FROM ${t} t
        WHERE t."orgId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organisation" o WHERE o."id" = t."orgId")
          AND t.${time} < now() - make_interval(days => ${retentionDays})
        ORDER BY t.${time} LIMIT ${BATCH})`);
    removed += batch;
    if (batch < BATCH) break;
  }
  return removed;
};

const main = async () => {
  const args = parseArgs();
  printHeader("OctaPM orphan tenant row sweep", args);

  const confirm = process.env.SWEEP_CONFIRM;
  const retentionDays = confirm == null || confirm === "" ? null : Number.parseInt(confirm, 10);
  if (args.apply && (!Number.isInteger(retentionDays) || retentionDays < 0)) {
    console.error("REFUSED: --apply deletes rows and needs SWEEP_CONFIRM=<retention days> (PO decision 2). Nothing was deleted.");
    printResult({ ok: false, refused: "SWEEP_CONFIRM missing", applied: false });
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const table of TABLES) {
    const counts = await orphanCounts(table, retentionDays);
    let removed = 0;
    if (args.apply && !table.via) removed = await sweep(table, retentionDays);
    results.push({ ...counts, removed, cascadedWith: table.via || null });
  }

  const width = Math.max(...results.map((item) => item.table.length));
  for (const item of results) {
    console.log(
      `${item.table.padEnd(width)}  rows ${String(item.total).padStart(8)}  orphaned ${String(item.orphaned).padStart(7)}  in ${String(item.missingOrganisations).padStart(3)} missing org(s)` +
        (item.beyondRetention == null ? "" : `  beyond ${retentionDays} days ${String(item.beyondRetention).padStart(7)}`) +
        (args.apply ? `  removed ${item.cascadedWith ? `(with ${item.cascadedWith})` : item.removed}` : ""),
    );
    for (const org of item.byOrg.slice(0, MAX_LISTED)) {
      console.log(`      ${org.orgId}  ${String(org.rows).padStart(7)} rows  ${new Date(org.oldest).toISOString().slice(0, 10)} … ${new Date(org.newest).toISOString().slice(0, 10)}`);
    }
    if (item.byOrg.length > MAX_LISTED) console.log(`      … ${item.byOrg.length - MAX_LISTED} more organisation(s)`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply: args.apply,
    retentionDays,
    tables: results.map(({ byOrg, ...rest }) => ({ ...rest, byOrg: byOrg.slice(0, 200) })),
  };
  const jsonPath = args.jsonPath || defaultReportPath("orphan-tenant-rows");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const orphaned = results.reduce((sum, item) => sum + item.orphaned, 0);
  console.log(`\n${orphaned.toLocaleString("en-US")} orphan row(s) across ${results.length} tables${args.apply ? "" : " — dry run, nothing deleted"}. Report written to ${jsonPath}`);

  printResult({ ok: true, apply: args.apply, retentionDays, orphaned, jsonPath, tables: results.map(({ table, orphaned: o, missingOrganisations, removed }) => ({ table, orphaned: o, missingOrganisations, removed })) });
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
