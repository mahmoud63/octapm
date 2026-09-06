/**
 * OctaPM scenario test run.
 *
 *   npm run db:seed --workspace=backend    # once
 *   npm run dev --workspace=backend        # in another terminal
 *   node scripts/qa/run.js                 # here
 *
 * Writes docs/testing/qa-results.json for the report generator.
 */
const fs = require("fs");
const path = require("path");
const { prisma, Runner, BASE, green, red, yellow } = require("./harness");

const SUITES = [
  ["Security, tenancy and permissions", require("./01-security")],
  ["Authorization sweep", require("./02-authorization-sweep")],
  ["Cross-module integration chains", require("./03-integration")],
  ["Company-scoped standards", require("./04-company")],
];

(async () => {
  console.log(`OctaPM scenario tests against ${BASE}\n`);
  const runner = new Runner();

  for (const [name, suite] of SUITES) {
    console.log(`\n=== ${name} ===`);
    await suite(runner);
  }

  const summary = runner.summary();
  console.log(`\n${"=".repeat(70)}`);
  console.log(
    `${summary.total} scenarios: ${green(`${summary.pass} pass`)}, ${yellow(`${summary.partial} partial`)}, ${red(`${summary.fail} fail`)}`,
  );

  const defects = runner.scenarios.flatMap((s) =>
    s.defects.map((d) => ({ scenario: s.id, module: s.module, ...d })),
  );
  if (defects.length) {
    console.log(`\n${red(`${defects.length} defect(s):`)}`);
    const order = { Blocker: 0, Critical: 1, Major: 2, Minor: 3, Cosmetic: 4 };
    for (const d of defects.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))) {
      console.log(`  [${d.severity}] ${d.scenario} ${d.message}`);
    }
  }

  const out = path.join(__dirname, "..", "..", "..", "docs", "testing", "qa-results.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        base: BASE,
        summary,
        scenarios: runner.scenarios.map((s) => ({
          id: s.id,
          module: s.module,
          purpose: s.purpose,
          role: s.role,
          preconditions: s.preconditions,
          status: s.status,
          ms: s.ms,
          steps: s.steps,
          findings: s.findings,
          defects: s.defects,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);

  await prisma.$disconnect();
  process.exitCode = summary.fail > 0 ? 1 : 0;
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
