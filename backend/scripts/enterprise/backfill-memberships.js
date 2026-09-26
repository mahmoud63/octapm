/**
 * M2 — one OrganizationMembership per User (enterprise programme).
 *
 *   node scripts/enterprise/backfill-memberships.js                 # report only
 *   node scripts/enterprise/backfill-memberships.js --apply         # write the rows
 *   node scripts/enterprise/backfill-memberships.js --apply --org <id>
 *
 * Every User row still carries orgId, role and isCompanyAdmin; this script
 * mirrors them into a membership row keyed on (orgId, userId), following the
 * membership doc §7 exactly: kind member, isAdmin from the flag, status active
 * or suspended, joinedAt = the user's createdAt, and one owner per
 * organisation chosen by the documented owner rule (earliest active
 * administrator; else the earliest active pm, promoted; else the earliest
 * active user, flagged).
 *
 * Idempotent: an existing row is updated only where a mirrored value differs,
 * and an organisation that already has an active owner keeps it — ownership
 * is never moved by a re-run. The User columns are never written.
 * Reversal: DELETE FROM "OrganizationMembership".
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:backfill-memberships");

const { prisma } = require("../../src/config/db");
const { membershipFromUser, ownerRule } = require("../../src/services/membership.service");
const { parseArgs, printCounts, printHeader, printResult } = require("./lib");

const MIRRORED = ["role", "kind", "isAdmin", "isOwner", "status"];

const differs = (existing, desired) => MIRRORED.some((field) => existing[field] !== desired[field]);

const counts = async (orgId) => {
  const where = orgId ? { orgId } : {};
  const [users, memberships] = await Promise.all([
    prisma.user.count({ where }),
    prisma.organizationMembership.count({ where }),
  ]);
  return { users, memberships };
};

/** What this run would write for one organisation, without writing it. */
const planOrganisation = (org) => {
  const existingByUser = new Map(org.memberships.map((row) => [row.userId, row]));
  const existingOwner = org.memberships.find((row) => row.isOwner && row.status === "active");
  const decision = existingOwner ? null : ownerRule(org.users);

  const creates = [];
  const updates = [];
  let unchanged = 0;
  for (const user of org.users) {
    const existing = existingByUser.get(user.id);
    // Ownership already held is kept (a re-run never moves it); the decision
    // this run reports lands on its chosen person whether their row is being
    // created or already exists — an organisation whose only owner row was
    // suspended or un-owned by hand gets its owner back on the next run.
    const isOwner = Boolean(existing?.isOwner) || decision?.ownerUserId === user.id;
    const desired = membershipFromUser(user, { isOwner });
    if (!existing) {
      creates.push(desired);
    } else if (differs(existing, desired)) {
      updates.push({ id: existing.id, data: { ...desired, joinedAt: existing.joinedAt ?? desired.joinedAt } });
    } else {
      unchanged += 1;
    }
  }
  return { creates, updates, unchanged, decision };
};

const main = async () => {
  const args = parseArgs();
  printHeader("OctaPM membership backfill (M2)", args);

  const before = await counts(args.orgId);
  printCounts("Before", before);

  const orgs = await prisma.organisation.findMany({
    where: args.orgId ? { id: args.orgId } : {},
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      users: {
        select: { id: true, orgId: true, role: true, isCompanyAdmin: true, status: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
      memberships: true,
    },
  });
  if (args.orgId && !orgs.length) {
    console.error(`No organisation ${args.orgId}`);
    process.exitCode = 2;
    return;
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const owners = [];
  const ownerless = [];
  const pending = [];

  for (const org of orgs) {
    const plan = planOrganisation(org);
    if (plan.decision) {
      if (plan.decision.ownerUserId) {
        const owner = org.users.find((user) => user.id === plan.decision.ownerUserId);
        owners.push({ orgId: org.id, orgName: org.name, userId: owner.id, role: owner.role, basis: plan.decision.basis });
      } else {
        ownerless.push({ orgId: org.id, orgName: org.name });
      }
    }
    if (plan.creates.length || plan.updates.length) {
      console.log(
        `${org.name}  (${org.id}): ${plan.creates.length} to create, ${plan.updates.length} to update, ${plan.unchanged} unchanged`,
      );
      pending.push({ orgId: org.id, orgName: org.name, creates: plan.creates.length, updates: plan.updates.length });
    }
    if (args.apply && (plan.creates.length || plan.updates.length)) {
      // One transaction per organisation: its owner and its members land together.
      await prisma.$transaction(async (tx) => {
        for (const data of plan.creates) {
          await tx.organizationMembership.create({ data });
        }
        for (const { id, data } of plan.updates) {
          await tx.organizationMembership.update({ where: { id }, data });
        }
      });
    }
    created += plan.creates.length;
    updated += plan.updates.length;
    unchanged += plan.unchanged;
  }

  console.log("");
  for (const owner of owners) {
    const note =
      owner.basis === "admin"
        ? "owner = existing administrator"
        : owner.basis === "pm_promoted"
          ? "owner = pm PROMOTED to administrator (no administrator existed)"
          : "owner = earliest active user, FLAGGED for review (no administrator or pm)";
    console.log(`   ${owner.orgName.padEnd(40)} ${owner.userId}  ${note}`);
  }
  for (const org of ownerless) {
    console.log(`   ${org.orgName.padEnd(40)} NO ACTIVE USER — no owner assigned`);
  }

  const after = await counts(args.orgId);
  console.log("");
  printCounts(args.apply ? "After" : "After (unchanged: dry run)", after);
  printCounts("This run", { created, updated, unchanged });

  printResult({
    apply: args.apply,
    orgId: args.orgId,
    before,
    after,
    created,
    updated,
    unchanged,
    changes: created + updated,
    pending,
    owners,
    ownerless,
  });
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
