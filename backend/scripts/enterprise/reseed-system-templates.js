/**
 * Gives every organisation the system permission templates it lacks.
 *
 *   node scripts/enterprise/reseed-system-templates.js            # list who lacks what
 *   node scripts/enterprise/reseed-system-templates.js --apply
 *   node scripts/enterprise/reseed-system-templates.js --apply --org <id>
 *
 * Three local organisations were created before the templates were seeded at
 * registration (OctaPM E2E, PMcopilots UAT Fixtures, OctaPM Demo Contracting).
 * The write goes through the same seedDefaultTemplates the registration path
 * uses, which is idempotent by template name (findMany on the names, createMany
 * of the missing ones with skipDuplicates), so an organisation that already
 * has them is untouched and a second run creates nothing.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:reseed-system-templates");

const { prisma } = require("../../src/config/db");
const { DEFAULT_TEMPLATES, seedDefaultTemplates } = require("../../src/services/permission-template.service");
const { parseArgs, printHeader, printResult } = require("./lib");

const main = async () => {
  const args = parseArgs();
  printHeader("OctaPM system permission templates", args);
  const names = DEFAULT_TEMPLATES.map((template) => template.name);

  const orgs = await prisma.organisation.findMany({
    where: args.orgId ? { id: args.orgId } : {},
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      permissionTemplates: { where: { name: { in: names } }, select: { name: true } },
    },
  });

  const report = [];
  let totalMissing = 0;
  let totalCreated = 0;
  for (const org of orgs) {
    const present = new Set(org.permissionTemplates.map((template) => template.name));
    const missing = names.filter((name) => !present.has(name));
    if (!missing.length) continue;
    totalMissing += missing.length;
    let created = 0;
    if (args.apply) {
      ({ created } = await seedDefaultTemplates({ orgId: org.id }));
      totalCreated += created;
    }
    report.push({ orgId: org.id, name: org.name, missing: missing.length, created });
    console.log(`   ${org.name.padEnd(40)} ${org.id}  missing ${missing.length}${args.apply ? `, created ${created}` : ""}`);
  }
  if (!report.length) console.log("   every organisation has all the system templates");

  console.log(`\n${orgs.length} organisation(s) checked, ${report.length} lacking, ${totalMissing} template(s) missing${args.apply ? `, ${totalCreated} created` : ""}.`);
  printResult({ apply: args.apply, orgId: args.orgId, checked: orgs.length, orgs: report, totalMissing, totalCreated });
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
