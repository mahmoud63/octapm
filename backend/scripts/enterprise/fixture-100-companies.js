/**
 * The §52 scale fixture: 100 organisations × 3 projects × 4 members
 * (enterprise programme, wave ENT-3).
 *
 *   node scripts/enterprise/fixture-100-companies.js               # report: what exists, what would be made
 *   node scripts/enterprise/fixture-100-companies.js --apply       # create what is missing
 *   node scripts/enterprise/fixture-100-companies.js --remove      # delete only the rows this script makes
 *   node scripts/enterprise/fixture-100-companies.js --apply --count 10
 *
 * Every id is deterministic (a UUID derived from the row's fixture name), so
 * a second --apply finds every row present and creates nothing, and --remove
 * deletes exactly the ids this script would create — never a row it did not
 * make, whatever else shares the database. Names are prefixed "Fixture Co":
 * organisation "Fixture Co 001" with slug "fixture-co-001", members
 * owner/qs/site/finance at fixture-co-001-<role>@octapm-fixture.test, and
 * projects "Fixture Co 001 — Project 1..3". The password is one known value
 * (FIXTURE_PASSWORD) so the tenant leak matrix can sign in as any of them.
 *
 * Each member holds an OrganizationMembership (the owner isAdmin/isOwner) and
 * an assignment on every project of their organisation, with orgId set, so
 * the fixture satisfies the M7 keys. Each organisation has an active business
 * subscription so its writes are not stopped by the plan gate.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:fixture-100-companies");

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma } = require("../../src/config/db");
const { parseArgs, printCounts, printHeader, printResult } = require("./lib");

const PREFIX = "Fixture Co";
const EMAIL_DOMAIN = "octapm-fixture.test";
const FIXTURE_PASSWORD = "Fixture-Pass-2026!";
const MEMBERS = [
  { key: "owner", name: "Owner", role: "pm", isAdmin: true, isOwner: true },
  { key: "qs", name: "Quantity Surveyor", role: "qs", isAdmin: false, isOwner: false },
  { key: "site", name: "Site Engineer", role: "site_engineer", isAdmin: false, isOwner: false },
  { key: "finance", name: "Finance", role: "finance", isAdmin: false, isOwner: false },
];
const PROJECTS_PER_ORG = 3;

/** A UUID (version 5 layout) from a fixture name: the same name always gives the same id. */
const idFor = (name) => {
  const hash = crypto.createHash("sha1").update(`octapm-fixture:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const pad = (n) => String(n).padStart(3, "0");

/** The whole fixture as plain rows, before anything touches the database. */
const plan = (count) => {
  const orgs = [];
  for (let n = 1; n <= count; n += 1) {
    const orgName = `${PREFIX} ${pad(n)}`;
    const slug = `fixture-co-${pad(n)}`;
    const orgId = idFor(`org:${orgName}`);
    const users = MEMBERS.map((member) => ({
      id: idFor(`user:${orgName}:${member.key}`),
      orgId,
      name: `${orgName} ${member.name}`,
      email: `${slug}-${member.key}@${EMAIL_DOMAIN}`,
      role: member.role,
      isCompanyAdmin: member.isAdmin,
      membership: { id: idFor(`membership:${orgName}:${member.key}`), role: member.role, isAdmin: member.isAdmin, isOwner: member.isOwner },
    }));
    const projects = Array.from({ length: PROJECTS_PER_ORG }, (_, i) => ({
      id: idFor(`project:${orgName}:${i + 1}`),
      orgId,
      name: `${orgName} — Project ${i + 1}`,
      status: "active",
    }));
    orgs.push({ id: orgId, name: orgName, slug, subscriptionId: idFor(`subscription:${orgName}`), users, projects });
  }
  return orgs;
};

const existingCounts = async (orgs) => {
  const orgIds = orgs.map((org) => org.id);
  const [organisations, users, memberships, projects, assignments] = await Promise.all([
    prisma.organisation.count({ where: { id: { in: orgIds } } }),
    prisma.user.count({ where: { id: { in: orgs.flatMap((org) => org.users.map((u) => u.id)) } } }),
    prisma.organizationMembership.count({ where: { id: { in: orgs.flatMap((org) => org.users.map((u) => u.membership.id)) } } }),
    prisma.project.count({ where: { id: { in: orgs.flatMap((org) => org.projects.map((p) => p.id)) } } }),
    prisma.projectAssignment.count({ where: { projectId: { in: orgs.flatMap((org) => org.projects.map((p) => p.id)) } } }),
  ]);
  return { organisations, users, memberships, projects, assignments };
};

const expectedCounts = (orgs) => ({
  organisations: orgs.length,
  users: orgs.length * MEMBERS.length,
  memberships: orgs.length * MEMBERS.length,
  projects: orgs.length * PROJECTS_PER_ORG,
  assignments: orgs.length * PROJECTS_PER_ORG * MEMBERS.length,
});

const apply = async (orgs) => {
  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 4);
  const periodEnd = new Date(Date.now() + 365 * 86_400_000);
  let created = 0;
  for (const org of orgs) {
    // createMany with skipDuplicates on every table: a row already there is left alone.
    const r1 = await prisma.organisation.createMany({ data: [{ id: org.id, name: org.name, slug: org.slug, kind: "company" }], skipDuplicates: true });
    const r2 = await prisma.subscription.createMany({
      data: [{ id: org.subscriptionId, orgId: org.id, plan: "business", status: "active", seats: 25, currentPeriodEnd: periodEnd }],
      skipDuplicates: true,
    });
    const r3 = await prisma.user.createMany({
      data: org.users.map((u) => ({ id: u.id, orgId: org.id, name: u.name, email: u.email, passwordHash, role: u.role, isCompanyAdmin: u.isCompanyAdmin, status: "active" })),
      skipDuplicates: true,
    });
    const r4 = await prisma.organizationMembership.createMany({
      data: org.users.map((u) => ({ id: u.membership.id, orgId: org.id, userId: u.id, role: u.membership.role, kind: "member", isAdmin: u.membership.isAdmin, isOwner: u.membership.isOwner, status: "active", joinedAt: new Date() })),
      skipDuplicates: true,
    });
    const r5 = await prisma.project.createMany({ data: org.projects.map((p) => ({ id: p.id, orgId: org.id, name: p.name, status: p.status })), skipDuplicates: true });
    const r6 = await prisma.projectAssignment.createMany({
      data: org.projects.flatMap((p) => org.users.map((u) => ({ id: idFor(`assignment:${p.id}:${u.id}`), orgId: org.id, projectId: p.id, userId: u.id, role: u.role }))),
      skipDuplicates: true,
    });
    created += r1.count + r2.count + r3.count + r4.count + r5.count + r6.count;
  }
  return created;
};

/** Deletes only the fixture's own ids, children first, so nothing else is reached. */
const remove = async (orgs) => {
  const orgIds = orgs.map((org) => org.id);
  const projectIds = orgs.flatMap((org) => org.projects.map((p) => p.id));
  const userIds = orgs.flatMap((org) => org.users.map((u) => u.id));
  let removed = 0;
  removed += (await prisma.projectAssignment.deleteMany({ where: { projectId: { in: projectIds }, orgId: { in: orgIds } } })).count;
  removed += (await prisma.project.deleteMany({ where: { id: { in: projectIds }, orgId: { in: orgIds } } })).count;
  removed += (await prisma.organizationMembership.deleteMany({ where: { orgId: { in: orgIds }, userId: { in: userIds } } })).count;
  removed += (await prisma.user.deleteMany({ where: { id: { in: userIds }, orgId: { in: orgIds } } })).count;
  removed += (await prisma.subscription.deleteMany({ where: { orgId: { in: orgIds } } })).count;
  removed += (await prisma.organisation.deleteMany({ where: { id: { in: orgIds }, name: { startsWith: `${PREFIX} ` } } })).count;
  return removed;
};

const main = async () => {
  const args = parseArgs();
  const argv = process.argv.slice(2);
  const countFlag = argv.indexOf("--count");
  const count = countFlag === -1 ? 100 : Math.max(1, Math.min(100, Number.parseInt(argv[countFlag + 1], 10) || 100));
  const removing = argv.includes("--remove");
  printHeader(`OctaPM ${count}-company fixture (§52)`, { apply: args.apply || removing, orgId: null });

  const orgs = plan(count);
  const before = await existingCounts(orgs);
  printCounts("Present before", before);
  printCounts("Expected when complete", expectedCounts(orgs));

  let created = 0;
  let removed = 0;
  if (removing) {
    removed = await remove(orgs);
  } else if (args.apply) {
    created = await apply(orgs);
  }

  const after = removing || args.apply ? await existingCounts(orgs) : before;
  if (removing || args.apply) printCounts("Present after", after);
  const complete = Object.entries(expectedCounts(orgs)).every(([key, value]) => after[key] === value);

  printResult({
    ok: true,
    mode: removing ? "remove" : args.apply ? "apply" : "dry-run",
    count,
    created,
    removed,
    complete: removing ? false : complete,
    after,
    sample: { orgId: orgs[0].id, slug: orgs[0].slug, ownerEmail: orgs[0].users[0].email, projectId: orgs[0].projects[0].id },
  });
};

module.exports = { FIXTURE_PASSWORD, MEMBERS, PREFIX, PROJECTS_PER_ORG, idFor, plan };

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
