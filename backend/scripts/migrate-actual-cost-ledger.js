/**
 * Brings pre-ledger actual cost onto the cost ledger (OCTA-FIN-MIGRATE-062).
 *
 *   node scripts/migrate-actual-cost-ledger.js            # report only
 *   node scripts/migrate-actual-cost-ledger.js --apply    # open the balances
 *   node scripts/migrate-actual-cost-ledger.js --apply --project <id>
 *   node scripts/migrate-actual-cost-ledger.js --apply --reason "..."
 *
 * Reports by default. Nothing is written without --apply, because the first
 * thing an operator should do with a financial migration is read it.
 *
 * Idempotent: each opening balance is keyed on the row it opens, not on the
 * run, so a second --apply finds the entries already there and writes nothing.
 */
const { prisma } = require("../src/config/db");
const migration = require("../src/services/cost-migration.service");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectArg = args.includes("--project") ? args[args.indexOf("--project") + 1] : null;
const reasonArg = args.includes("--reason") ? args[args.indexOf("--reason") + 1] : null;

const money = (value) =>
  Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CLASSIFICATION = {
  A: "reconstructible — the ledger already explains it",
  B: "partially reconstructible — only the remainder opens",
  C: "legacy opening balance — nothing explains it",
};

(async () => {
  const projects = await prisma.project.findMany({
    where: projectArg ? { id: projectArg } : {},
    select: { id: true, orgId: true, name: true },
    orderBy: { name: "asc" },
  });

  if (!projects.length) {
    console.log(projectArg ? `No project ${projectArg}` : "No projects.");
    await prisma.$disconnect();
    return;
  }

  console.log(`OctaPM actual-cost ledger migration — ${apply ? "APPLY" : "REPORT ONLY"}\n`);

  let totalOpened = 0;
  let totalPending = 0;

  for (const project of projects) {
    const report = await migration.analyse({ orgId: project.orgId, projectId: project.id });
    if (!report.rows.length) continue;

    console.log(`${project.name}  (${project.id})`);
    for (const row of report.rows) {
      const mark = row.alreadyOpened ? "already open" : `OPEN ${money(row.opening)}`;
      console.log(
        `   ${row.classification}  ${String(row.label).padEnd(22)} stored ${money(row.stored).padStart(14)}  explained ${money(row.explained).padStart(14)}  ${mark}`
      );
    }
    console.log(
      `   → ${report.summary.rowsNeedingOpening} to open, ${report.summary.alreadyOpened} already open, ${money(report.summary.openingTotal)} unexplained`
    );

    if (apply && report.migrationRequired) {
      const result = await migration.migrate({
        orgId: project.orgId,
        projectId: project.id,
        reason: reasonArg,
      });
      console.log(`   ✔ opened ${result.applied} balance${result.applied === 1 ? "" : "s"} as batch ${result.batchId}`);
      console.log(`     still unexplained after: ${money(result.summary.openingTotal)}`);
      totalOpened += result.applied;
    } else {
      totalPending += report.summary.rowsNeedingOpening;
    }
    console.log("");
  }

  console.log("Classification key:");
  for (const [key, text] of Object.entries(CLASSIFICATION)) console.log(`   ${key}  ${text}`);

  if (apply) {
    console.log(`\nOpened ${totalOpened} opening balance${totalOpened === 1 ? "" : "s"}.`);
  } else if (totalPending) {
    console.log(`\n${totalPending} row${totalPending === 1 ? "" : "s"} need an opening balance. Re-run with --apply to write them.`);
    console.log("Until then, reconciliation reads fine but repair/recompute refuses:");
    console.log("   ACTUAL_COST_LEDGER_MIGRATION_REQUIRED");
  } else {
    console.log("\nNothing to migrate — every stored actual is explained by the ledger.");
  }

  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
