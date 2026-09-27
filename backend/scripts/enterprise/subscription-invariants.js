/**
 * Subscription invariants, as a checkpoint report. Read-only.
 *
 *   node scripts/enterprise/subscription-invariants.js                     # the standing rules
 *   node scripts/enterprise/subscription-invariants.js --expect <file>     # … and each organisation's expected plan
 *
 * The standing rules come from the code paths that can write a subscription
 * (docs/qa/OCTAPM_INCIDENT_2026-09-26_MEMBERSHIP_ROLES.md): a row is created
 * by register/provisioning (trial / incomplete) or by a seed (active, a named
 * plan) and never has its seats written; currentPeriodEnd is written only by
 * the Stripe subscribe path and the Stripe webhook. So on a durable
 * organisation — not a throwaway "LiveTest" or "Fixture Co" one, whose tests
 * activate plans directly — a subscription without a Stripe subscription must
 * have seats 1 and no period end, every organisation has exactly one
 * subscription, and the plan must exist in config/plans.js (an unknown plan
 * makes project creation answer 500 SUBSCRIPTION_PLAN_UNKNOWN).
 *
 * --expect takes a JSON array of { orgId, plan, status, seats, currentPeriodEnd }
 * (currentPeriodEnd null, or "any") — e.g. the plan of a restoration — and
 * compares each organisation against it. A row passes when everything it
 * states holds; anything else is REVIEW, never silently "fixed". Exit 1 on any
 * REVIEW.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:subscription-invariants");

const fs = require("fs");
const { prisma } = require("../../src/config/db");
const { PLANS } = require("../../src/config/plans");
const { printResult } = require("./lib");

const THROWAWAY = /^LiveTest [0-9a-f-]{36}$|^Fixture Co/;

const valueOf = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

const main = async () => {
  const expectPath = valueOf("--expect");
  const expected = expectPath ? new Map(JSON.parse(fs.readFileSync(expectPath, "utf8")).map((row) => [row.orgId, row])) : new Map();
  const orgs = (await prisma.organisation.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })).filter((org) => !THROWAWAY.test(org.name));
  const subs = await prisma.subscription.findMany({ where: { orgId: { in: orgs.map((org) => org.id) } } });
  const byOrg = new Map();
  for (const sub of subs) byOrg.set(sub.orgId, [...(byOrg.get(sub.orgId) || []), sub]);

  const rows = orgs.map((org) => {
    const found = byOrg.get(org.id) || [];
    const sub = found[0];
    const want = expected.get(org.id);
    const notes = [];
    if (found.length !== 1) notes.push(`${found.length} subscriptions (expected exactly one)`);
    if (sub) {
      const stripe = Boolean(sub.stripeSubscriptionId);
      if (!PLANS[sub.plan]) notes.push(`plan "${sub.plan}" is not in the catalogue — project creation answers SUBSCRIPTION_PLAN_UNKNOWN`);
      if (!stripe && sub.seats !== 1) notes.push(`seats ${sub.seats} without a Stripe subscription (no code path writes seats)`);
      if (!stripe && sub.currentPeriodEnd) notes.push("a period end without a Stripe subscription (only Stripe writes it)");
      if (want) {
        if (want.plan !== undefined && want.plan !== sub.plan) notes.push(`plan ${sub.plan}, expected ${want.plan}`);
        if (want.status !== undefined && want.status !== sub.status) notes.push(`status ${sub.status}, expected ${want.status}`);
        if (want.seats !== undefined && want.seats !== sub.seats) notes.push(`seats ${sub.seats}, expected ${want.seats}`);
        if (want.currentPeriodEnd === null && sub.currentPeriodEnd !== null) notes.push("period end set, expected none");
      }
    }
    // A plan outside the catalogue that the expectation names on purpose is recorded, not failed.
    const blocking = notes.filter((note) => !(want && sub && want.plan === sub.plan && note.startsWith(`plan "${sub.plan}" is not in the catalogue`)));
    return {
      organisation: org.name,
      orgId: org.id,
      expectedPlan: want?.plan ?? "—",
      actualPlan: sub?.plan ?? "(none)",
      expectedStatus: want?.status ?? "—",
      actualStatus: sub?.status ?? "(none)",
      expectedSeats: want?.seats ?? "—",
      actualSeats: sub?.seats ?? "(none)",
      currentPeriodEnd: sub?.currentPeriodEnd ? (sub.stripeSubscriptionId ? "set (Stripe)" : "SET — REVIEW / NOT INVENTED") : "none",
      verdict: blocking.length ? "REVIEW" : "PASS",
      notes,
    };
  });

  console.log(["Organisation", "Expected plan", "Actual plan", "Expected status", "Actual status", "Expected seats", "Actual seats", "currentPeriodEnd", "Verdict"].join(" | "));
  for (const r of rows) {
    console.log([`${r.organisation.slice(0, 28)} (${r.orgId.slice(0, 8)})`, r.expectedPlan, r.actualPlan, r.expectedStatus, r.actualStatus, r.expectedSeats, r.actualSeats, r.currentPeriodEnd, r.verdict].join(" | "));
    for (const note of r.notes) console.log(`    note: ${note}`);
  }
  const review = rows.filter((r) => r.verdict === "REVIEW").length;
  console.log(`\n${rows.length} durable organisations · ${rows.length - review} PASS · ${review} REVIEW${expectPath ? ` · expectations from ${expectPath}` : ""}`);
  printResult({ ok: review === 0, organisations: rows.length, pass: rows.length - review, review, rows: rows.map(({ orgId, verdict, notes }) => ({ orgId, verdict, notes })) });
  if (review) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
