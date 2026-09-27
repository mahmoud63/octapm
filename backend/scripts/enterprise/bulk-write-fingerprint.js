/**
 * Did an unscoped bulk write hit the database? Read-only.
 *
 *   node scripts/enterprise/bulk-write-fingerprint.js --since "2026-09-26 22:00:00"   # UTC, the database's clock
 *
 * One Prisma updateMany stamps every row it touches with the same @updatedAt.
 * A group of rows sharing one updatedAt across several organisations, one of
 * them durable (not a throwaway "LiveTest" or "Fixture Co" organisation), is
 * the fingerprint of a write whose filter came out empty — how the 2026-09-26
 * incident rewrote every membership and every subscription within ten
 * seconds. The integration checkpoints run this from the previous checkpoint
 * onward and stop on any hit; the membership sentinel watches memberships
 * closely, this watches every table coarsely.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:bulk-write-fingerprint");

const { prisma } = require("../../src/config/db");
const { printResult } = require("./lib");

const valueOf = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};
const THROWAWAY = `o."name" ~ '^LiveTest [0-9a-f-]{36}$' OR o."name" LIKE 'Fixture Co%'`;

const main = async () => {
  const since = valueOf("--since") || new Date(Date.now() - 24 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name
    HAVING bool_or(column_name = 'updatedAt') AND bool_or(column_name = 'orgId')`);
  const hits = [];
  for (const { table_name: table } of tables) {
    const groups = await prisma.$queryRawUnsafe(
      `SELECT t."updatedAt", count(*)::int AS rows, count(DISTINCT t."orgId")::int AS organisations,
              count(DISTINCT t."orgId") FILTER (WHERE NOT (${THROWAWAY}))::int AS durable
       FROM "${table}" t LEFT JOIN "Organisation" o ON o."id" = t."orgId"
       WHERE t."updatedAt" >= $1::timestamp
       GROUP BY t."updatedAt"
       HAVING count(DISTINCT t."orgId") >= 3 AND count(DISTINCT t."orgId") FILTER (WHERE NOT (${THROWAWAY})) >= 1`,
      since,
    );
    for (const g of groups) hits.push({ table, updatedAt: g.updatedAt.toISOString(), rows: g.rows, organisations: g.organisations, durable: g.durable });
  }
  console.log(`Bulk-write fingerprint since ${since} UTC — ${tables.length} tenant tables scanned`);
  for (const h of hits) console.log(`HIT ${h.table} ${h.updatedAt}: ${h.rows} rows across ${h.organisations} organisations (${h.durable} durable)`);
  console.log(hits.length ? `\n${hits.length} fingerprint(s): an unscoped bulk write touched several organisations` : "\nPASS — no write touched several organisations at once");
  printResult({ ok: hits.length === 0, since, hits });
  if (hits.length) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
