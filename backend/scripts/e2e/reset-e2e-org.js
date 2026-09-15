#!/usr/bin/env node
/**
 * The dedicated E2E organisation (Phase 22B).
 *
 * Automated browser suites used to sign in to the demo organisation and leave
 * their projects, orders, items and companies behind — hundreds of them after a
 * few weeks, which the Phase 22 audit found on the client-facing workspace and
 * which a residue-archive script then had to sweep before every demo. That is
 * not a test architecture. The suites now run against their own organisation:
 *
 *   OctaPM E2E  ·  people <role>@octapm-e2e.test  ·  the same seed as the demo
 *
 * This script puts that organisation into its seeded state: it deletes the E2E
 * organisation outright (every table cascades from the organisation, its
 * projects and its people), deletes any organisation a suite registered through
 * the sign-up page (their names carry the E2E marker), and seeds afresh. So a
 * run always starts from the same rows, repeated runs cannot accumulate, and
 * nothing here can reach the demo organisation or the certified Phase 21
 * project — the script refuses to touch any organisation whose name is not an
 * E2E name.
 *
 *   node scripts/e2e/reset-e2e-org.js            # reset and seed
 *   node scripts/e2e/reset-e2e-org.js --count    # only print the row counts
 *
 * Playwright calls it from e2e/global-setup.ts before every run.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const { prisma } = require("../../src/config/db");

const E2E_ORG_NAME = process.env.E2E_ORG_NAME || "OctaPM E2E";
const E2E_EMAIL_DOMAIN = process.env.E2E_EMAIL_DOMAIN || "octapm-e2e.test";
// Organisations a suite creates itself (sign-up, isolation tests) carry this marker.
const E2E_ORG_MARKER = /\bE2E\b/;
const COUNT_ONLY = process.argv.includes("--count");

const isE2EOrganisation = (org) => org.name === E2E_ORG_NAME || E2E_ORG_MARKER.test(org.name || "");

const countRows = async (orgId) => {
  const projectIds = (await prisma.project.findMany({ where: { orgId }, select: { id: true } })).map((row) => row.id);
  const byProject = { projectId: { in: projectIds } };
  const counts = {
    projects: projectIds.length,
    users: await prisma.user.count({ where: { orgId } }),
    companies: await prisma.company.count({ where: { orgId } }),
    commitments: await prisma.commitment.count({ where: byProject }),
    purchaseOrders: await prisma.procurementOrder.count({ where: byProject }),
    inventoryItems: await prisma.inventoryItem.count({ where: { orgId } }),
    warehouses: await prisma.warehouse.count({ where: { orgId } }),
    bidPackages: await prisma.bidPackage.count({ where: byProject }).catch(() => null),
    payApps: await prisma.subPayApp.count({ where: byProject }).catch(() => null),
    timesheets: await prisma.timesheet.count({ where: byProject }).catch(() => null),
    documents: await prisma.projectDocument.count({ where: { orgId } }),
    rfis: await prisma.rfi.count({ where: byProject }).catch(() => null),
    changeOrders: await prisma.changeOrder.count({ where: byProject }),
    assignments: await prisma.projectAssignment.count({ where: byProject }),
    ncrs: await prisma.ncrRecord.count({ where: byProject }).catch(() => null),
    ledgerEntries: await prisma.costLedgerEntry.count({ where: byProject }).catch(() => null),
  };
  return counts;
};

/**
 * Most tables cascade from the organisation, its projects or its people, but a
 * few are RESTRICT-linked (a person's project assignment, a worker's
 * timesheets…). Rather than hard-code that list — which drifts as the schema
 * grows — each blocked delete is answered by clearing the table the constraint
 * names, scoped to this organisation's projects, people or the organisation
 * itself, then retried. Thirty rounds is far more than the schema needs; past
 * that, the script fails loudly with the constraint it could not clear.
 */
const deleteOrganisation = async (org) => {
  const projectIds = (await prisma.project.findMany({ where: { orgId: org.id }, select: { id: true } })).map((row) => row.id);
  const userIds = (await prisma.user.findMany({ where: { orgId: org.id }, select: { id: true } })).map((row) => row.id);
  // Prisma's model delegates are not enumerable, so the key is derived: "ProjectAssignment" → "projectAssignment".
  const modelKeyFor = (table) => {
    const key = table.charAt(0).toLowerCase() + table.slice(1);
    return prisma[key]?.deleteMany ? key : null;
  };
  // the reason sits at the end of a Prisma message; the start is a code frame
  const reasonOf = (error) => error.message.split("\n").map((line) => line.trim()).filter(Boolean).slice(-4).join(" ").slice(0, 400);
  const blockerOf = (error) => {
    const match = /constraint \\?"([A-Za-z0-9]+)_([A-Za-z0-9]+)_fkey\\?"/.exec(error.message);
    const modelKey = match ? modelKeyFor(match[1]) : null;
    return modelKey ? { table: match[1], modelKey, column: match[2] } : null;
  };
  // Delete the rows of `modelKey` where `column` is one of `ids`; when a RESTRICT
  // constraint answers, clear the blocking table's rows that point at these rows
  // first (recursively — a blocker can have blockers of its own), then retry.
  const clearRows = async (modelKey, column, ids, depth = 0) => {
    if (!ids.length) return 0;
    if (depth > 8) throw new Error(`clearing ${modelKey} nests deeper than eight tables`);
    for (let round = 0; round < 30; round += 1) {
      try {
        return (await prisma[modelKey].deleteMany({ where: { [column]: { in: ids } } })).count;
      } catch (error) {
        // a constraint named after the relation, not the column: "…_project_fkey" → projectId
        if (/Unknown argument/.test(error.message) && !column.endsWith("Id")) return clearRows(modelKey, `${column}Id`, ids, depth);
        const blocker = blockerOf(error);
        if (!blocker) throw new Error(`could not clear ${modelKey} (${column} in ${ids.length} ids): ${reasonOf(error)}`);
        const parentIds = (await prisma[modelKey].findMany({ where: { [column]: { in: ids } }, select: { id: true } })).map((row) => row.id);
        const cleared = await clearRows(blocker.modelKey, blocker.column, parentIds, depth + 1);
        console.log(`  ${"  ".repeat(depth)}cleared ${cleared} ${blocker.table} rows (${blocker.column}) that blocked ${modelKey}`);
      }
    }
    throw new Error(`could not clear ${modelKey}: still blocked after thirty rounds`);
  };
  const steps = [
    ["projects", () => prisma.project.deleteMany({ where: { orgId: org.id } }), projectIds],
    ["people", () => prisma.user.deleteMany({ where: { orgId: org.id } }), userIds],
    ["organisation", () => prisma.organisation.delete({ where: { id: org.id } }), [org.id]],
  ];
  for (const [step, run, referencedIds] of steps) {
    for (let round = 0; round < 30; round += 1) {
      try {
        await run();
        break;
      } catch (error) {
        const blocker = blockerOf(error);
        if (!blocker) throw new Error(`could not delete ${org.name} (${step}): ${reasonOf(error)}`);
        const cleared = await clearRows(blocker.modelKey, blocker.column, referencedIds);
        console.log(`  cleared ${cleared} ${blocker.table} rows (${blocker.column}) that blocked the ${step} delete`);
      }
    }
  }
};

const printCounts = (label, counts) => {
  console.log(`${label}:`);
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(16)} ${value === null ? "n/a" : value}`);
};

const main = async () => {
  const orgs = await prisma.organisation.findMany({ select: { id: true, name: true } });
  const e2eOrgs = orgs.filter(isE2EOrganisation);
  const others = orgs.filter((org) => !isE2EOrganisation(org));
  console.log(`organisations: ${orgs.length} — E2E ${e2eOrgs.length}, kept ${others.length} (${others.map((org) => org.name).slice(0, 4).join(", ")}${others.length > 4 ? ", …" : ""})`);

  if (COUNT_ONLY) {
    for (const org of e2eOrgs) printCounts(`${org.name} (${org.id.slice(0, 8)})`, await countRows(org.id));
    await prisma.$disconnect();
    return;
  }

  for (const org of e2eOrgs) {
    if (!isE2EOrganisation(org)) throw new Error(`refusing to delete ${org.name}`); // belt and braces
    const before = await countRows(org.id);
    // People are RESTRICT-linked to their organisation (an organisation is never
    // deleted from under its users in the product), so the order is: projects
    // (which cascade every transactional row), then people, then the organisation
    // (which cascades the rest). Anything that still blocks is reported by name.
    await deleteOrganisation(org);
    console.log(`deleted ${org.name} (${org.id.slice(0, 8)}): ${before.projects} projects, ${before.purchaseOrders} orders, ${before.inventoryItems} items, ${before.companies} companies`);
  }

  const seed = spawnSync(process.execPath, [path.join(__dirname, "..", "..", "prisma", "seed.js")], {
    env: { ...process.env, SEED_ORG_NAME: E2E_ORG_NAME, SEED_EMAIL_DOMAIN: E2E_EMAIL_DOMAIN },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (seed.status !== 0) {
    console.error(seed.stdout);
    console.error(seed.stderr);
    throw new Error(`seeding ${E2E_ORG_NAME} failed with exit code ${seed.status}`);
  }
  const seeded = await prisma.organisation.findFirst({ where: { name: E2E_ORG_NAME }, select: { id: true } });
  if (!seeded) throw new Error(`seed finished but ${E2E_ORG_NAME} does not exist`);
  const people = await prisma.user.count({ where: { orgId: seeded.id, email: { endsWith: `@${E2E_EMAIL_DOMAIN}` } } });
  if (people < 8) throw new Error(`expected the eight seeded people in ${E2E_ORG_NAME}, found ${people}`);
  printCounts(`${E2E_ORG_NAME} seeded (${seeded.id.slice(0, 8)})`, await countRows(seeded.id));
  await prisma.$disconnect();
};

main().catch(async (error) => {
  console.error(`FAILED: ${error.message}`);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
