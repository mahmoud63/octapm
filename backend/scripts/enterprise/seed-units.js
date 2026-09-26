/**
 * PC-1 — the default units of measure for every organisation.
 *
 *   node scripts/enterprise/seed-units.js                 # report only
 *   node scripts/enterprise/seed-units.js --apply         # write the rows
 *   node scripts/enterprise/seed-units.js --apply --org <id>
 *
 * Every organisation gets the control-model list (m, m2, m3, nr, kg, t, hr,
 * day, ls, sum, item, l, bag, sheet, roll, load, pcs) with the spellings that
 * map to each. A code the organisation already has is left exactly as it is
 * — an operator may have renamed it or added aliases — and only the missing
 * codes are written, so a second --apply finds nothing left to do.
 *
 * Nothing else is touched: BoqItem.unit keeps what was typed and
 * BoqItem.unitCode is filled by the next upload or edit, never here.
 * Reversal: DELETE FROM "UnitOfMeasure" WHERE "isSystem".
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:seed-units");

const { prisma } = require("../../src/config/db");
const { DEFAULT_UNITS, seedDefaultUnits } = require("../../src/services/uom.service");
const { parseArgs, printCounts, printHeader, printResult } = require("./lib");

const counts = async (orgId) => {
  const where = orgId ? { id: orgId } : {};
  const organisations = await prisma.organisation.count({ where });
  const units = await prisma.unitOfMeasure.count({ where: orgId ? { orgId } : {} });
  const seeded = await prisma.unitOfMeasure.groupBy({
    by: ["orgId"],
    where: orgId ? { orgId } : {},
    _count: { _all: true },
  });
  return {
    organisations,
    units,
    organisationsWithUnits: seeded.length,
    organisationsComplete: seeded.filter((row) => row._count._all >= DEFAULT_UNITS.length).length,
  };
};

const main = async () => {
  const args = parseArgs();
  if (args.help) {
    console.log("usage: node scripts/enterprise/seed-units.js [--apply] [--org <id>]");
    return;
  }
  printHeader("PC-1 seed-units: default units of measure per organisation", args);

  const before = await counts(args.orgId);
  printCounts("Before", before);

  const organisations = await prisma.organisation.findMany({
    where: args.orgId ? { id: args.orgId } : {},
    select: { id: true, name: true, unitsOfMeasure: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  });
  const plan = organisations.map((org) => {
    const present = new Set(org.unitsOfMeasure.map((row) => row.code));
    const missing = DEFAULT_UNITS.map((unit) => unit.code).filter((code) => !present.has(code));
    return { orgId: org.id, name: org.name, present: present.size, missing };
  });
  const toWrite = plan.filter((row) => row.missing.length);

  console.log(`\n${plan.length.toLocaleString("en-US")} organisation(s); ${toWrite.length.toLocaleString("en-US")} need units.`);
  for (const row of toWrite.slice(0, 20)) {
    console.log(`   ${row.orgId}  ${String(row.name).slice(0, 40).padEnd(40)}  +${row.missing.length}`);
  }
  if (toWrite.length > 20) console.log(`   … and ${toWrite.length - 20} more`);

  let created = 0;
  if (args.apply) {
    for (const row of toWrite) {
      const result = await seedDefaultUnits({ orgId: row.orgId });
      created += result.created;
    }
  }

  const after = args.apply ? await counts(args.orgId) : before;
  printCounts(args.apply ? "\nAfter" : "\nAfter (unchanged, dry run)", after);
  printResult({
    apply: args.apply,
    orgId: args.orgId,
    organisations: plan.length,
    organisationsNeedingUnits: toWrite.length,
    unitsPlanned: toWrite.reduce((sum, row) => sum + row.missing.length, 0),
    unitsCreated: created,
    before,
    after,
  });
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
