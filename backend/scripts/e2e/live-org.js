#!/usr/bin/env node
/**
 * Throwaway organisations for browser suites that bring their own data
 * (enterprise waves, ENT-4 onwards).
 *
 * The workspace-switching suites register their organisations through the
 * product's own sign-up, so they need nothing seeded — except that a
 * brand-new organisation is on a trial with no allowance and its first write
 * stops at the subscription gate (402). This script gives such an
 * organisation the plan the live-test kit gives its own, and drops it again
 * afterwards. It touches only organisations named `LiveTest <uuid>` — the
 * name every throwaway organisation carries — and refuses every other name,
 * so it cannot reach the demo organisation, the E2E organisation or the
 * certified Phase 21 project.
 *
 *   node scripts/e2e/live-org.js activate <orgId>   # business plan, 25 seats
 *   node scripts/e2e/live-org.js drop <orgId>       # delete it and its rows
 *   node scripts/e2e/live-org.js plan <orgId> <plan> # set its one subscription's plan
 *
 * `plan` writes one row by its unique orgId; any plain token is accepted, so
 * a suite can put its own workspace on a plan outside the catalogue and see
 * the configuration fault the product shows for it.
 *
 * Like the E2E reset, it runs only against a database on this machine unless
 * ALLOW_DATA_SCRIPT names another.
 */
const path = require("path");

require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("e2e:live-org");

const [command, orgId, planArg] = process.argv.slice(2);
const PLAN_TOKEN = /^[a-z0-9_-]{1,32}$/;
if (!["activate", "drop", "plan"].includes(command) || !orgId || (command === "plan" && !PLAN_TOKEN.test(planArg || ""))) {
  process.stderr.write("usage: node scripts/e2e/live-org.js <activate|drop> <orgId> | plan <orgId> <plan>\n");
  process.exit(2);
}

const { prisma } = require(path.join("..", "..", "src", "config", "db"));
const { dropLiveOrg } = require(path.join("..", "..", "src", "__live__", "helpers"));

const LIVE_NAME = /^LiveTest [0-9a-f-]{36}$/;

const main = async () => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) throw new Error(`no organisation ${orgId}`);
  if (!LIVE_NAME.test(org.name)) throw new Error(`refusing "${org.name}": not a LiveTest organisation`);

  if (command === "activate") {
    const currentPeriodEnd = new Date(Date.now() + 30 * 86_400_000);
    const updated = await prisma.subscription.updateMany({
      where: { orgId },
      data: { plan: "business", status: "active", seats: 25, currentPeriodEnd },
    });
    if (!updated.count) {
      await prisma.subscription.create({ data: { orgId, plan: "business", status: "active", seats: 25, currentPeriodEnd } });
    }
    process.stdout.write(`${org.name}: subscription active\n`);
    return;
  }
  if (command === "plan") {
    await prisma.subscription.update({ where: { orgId: org.id }, data: { plan: planArg } });
    process.stdout.write(`${org.name}: subscription plan ${planArg}\n`);
    return;
  }
  await dropLiveOrg(prisma, orgId);
  process.stdout.write(`${org.name}: dropped\n`);
};

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
