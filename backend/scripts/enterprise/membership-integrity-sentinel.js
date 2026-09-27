/**
 * The membership integrity sentinel, from the command line.
 *
 *   node scripts/enterprise/membership-integrity-sentinel.js                     # invariants now
 *   node scripts/enterprise/membership-integrity-sentinel.js --snapshot <file>   # invariants + save the state
 *   node scripts/enterprise/membership-integrity-sentinel.js --compare <file>    # invariants + compare with a saved state
 *
 * Read-only. Prints the summary (organisations, memberships, owners, admins,
 * role distribution per durable organisation) and every violation, ends with
 * the RESULT line, and exits 1 when any invariant or comparison fails — the
 * integration checkpoints and the live-test teardown stop on it. See
 * membership-integrity.js for what is checked and why.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:membership-integrity-sentinel");

const fs = require("fs");
const { prisma } = require("../../src/config/db");
const { captureState, checkInvariants, compareStates, summarise } = require("./membership-integrity");
const { printResult } = require("./lib");

const valueOf = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

const main = async () => {
  const snapshotPath = valueOf("--snapshot");
  const comparePath = valueOf("--compare");
  const state = await captureState(prisma);
  const summary = summarise(state);
  const violations = checkInvariants(state);
  let comparison = null;
  if (comparePath) comparison = compareStates(JSON.parse(fs.readFileSync(comparePath, "utf8")), state);
  if (snapshotPath) fs.writeFileSync(snapshotPath, JSON.stringify(state));

  console.log(`Membership integrity sentinel — ${state.capturedAt}\n`);
  console.log(`durable organisations ${summary.organisations} · memberships ${summary.memberships} · owners ${summary.owners} · admins ${summary.admins} · throwaway organisations ${summary.ephemeralOrganisations}`);
  for (const org of Object.values(summary.perOrg).sort((a, b) => b.memberships - a.memberships).slice(0, 12)) {
    const roles = Object.entries(org.roles).map(([role, n]) => `${role}:${n}`).join(" ");
    console.log(`  ${org.name.slice(0, 32).padEnd(32)} ${org.kind.padEnd(8)} owners ${org.owners} admins ${org.admins}  ${roles}`);
  }
  const all = [...violations, ...(comparison?.violations || [])];
  if (comparison) console.log(`\ncompared with ${comparePath}: ${comparison.violations.length} change(s) to existing memberships, ${comparison.created} membership(s) created`);
  if (comparison?.broad.length) console.log(`BROAD CHANGE: ${JSON.stringify(comparison.broad)}`);
  for (const v of all) console.log(`VIOLATION ${JSON.stringify(v)}`);
  console.log(`\n${all.length ? `${all.length} violation(s)` : "PASS — no violations"}`);
  printResult({
    ok: all.length === 0,
    summary: { organisations: summary.organisations, memberships: summary.memberships, owners: summary.owners, admins: summary.admins },
    violations: all,
    created: comparison?.created ?? null,
    broad: comparison?.broad ?? [],
  });
  if (all.length) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
