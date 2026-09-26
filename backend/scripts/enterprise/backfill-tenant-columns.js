/**
 * M3 — fill the tenant columns M1 added (enterprise programme).
 *
 *   node scripts/enterprise/backfill-tenant-columns.js                 # report only
 *   node scripts/enterprise/backfill-tenant-columns.js --apply
 *   node scripts/enterprise/backfill-tenant-columns.js --apply --org <id>
 *
 * Four fills, each touching only rows where the column is still NULL:
 *
 *   - Organisation.slug from the name (lib.slugifyName), with a numeric
 *     suffix when the base is taken — 13 local organisations share the name
 *     "Other Corp Contracting", so the order is fixed (createdAt, id) and a
 *     re-run reproduces the same handles (the write is lib.writeSlugs, which
 *     re-plans from the base when another process wins the race for a slug);
 *   - ProjectAssignment.orgId = Project.orgId (denormalised for the M7 FK);
 *   - RefreshSession.membershipId, ApiClient.membershipId from (orgId, userId);
 *   - InvitationToken.membershipId from (orgId, acceptedById) on accepted rows.
 *
 * Runs after backfill-memberships.js: a session or key whose person has no
 * membership in that organisation is left NULL and counted as unresolvable.
 * Reversal: set the columns back to NULL.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:backfill-tenant-columns");

const { Prisma } = require("@prisma/client");
const { prisma } = require("../../src/config/db");
const { nextFreeSlug, parseArgs, printCounts, printHeader, printResult, slugifyName, takenSlugs, writeSlugs } = require("./lib");

const count = async (sql) => Number((await prisma.$queryRaw(sql))[0].count);

const orgFilter = (column, orgId) => (orgId ? Prisma.sql`AND ${column} = ${orgId}` : Prisma.empty);

/** Slugs: which organisations still lack one and what each would get. */
const planSlugs = async (orgId) => {
  const taken = await takenSlugs(prisma);
  const pending = await prisma.organisation.findMany({
    where: { slug: null, ...(orgId ? { id: orgId } : {}) },
    select: { id: true, name: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const assignments = [];
  let collisions = 0;
  for (const org of pending) {
    const base = slugifyName(org.name);
    const slug = nextFreeSlug(base, taken);
    if (slug !== base) collisions += 1;
    taken.add(slug);
    assignments.push({ orgId: org.id, name: org.name, slug });
  }
  return { assignments, collisions, alreadyFilled: taken.size - assignments.length };
};

const main = async () => {
  const args = parseArgs();
  printHeader("OctaPM tenant column backfill (M3)", args);
  const { orgId } = args;

  // ── Organisation.slug ────────────────────────────────────────────────────
  const slugs = await planSlugs(orgId);
  printCounts("Organisation.slug before", {
    filled: slugs.alreadyFilled,
    missing: slugs.assignments.length,
    collisions: slugs.collisions,
  });
  for (const row of slugs.assignments) console.log(`   ${row.name.padEnd(40)} → ${row.slug}`);
  if (args.apply) await writeSlugs(prisma, slugs.assignments);

  // ── ProjectAssignment.orgId ─────────────────────────────────────────────
  const assignmentsMissing = await count(Prisma.sql`
    SELECT count(*)::int AS count FROM "ProjectAssignment" pa
    JOIN "Project" p ON p."id" = pa."projectId"
    WHERE pa."orgId" IS NULL ${orgFilter(Prisma.sql`p."orgId"`, orgId)}`);
  let assignmentsFilled = 0;
  if (args.apply && assignmentsMissing) {
    assignmentsFilled = await prisma.$executeRaw(Prisma.sql`
      UPDATE "ProjectAssignment" pa SET "orgId" = p."orgId"
      FROM "Project" p
      WHERE p."id" = pa."projectId" AND pa."orgId" IS NULL ${orgFilter(Prisma.sql`p."orgId"`, orgId)}`);
  }

  // ── membershipId on RefreshSession / ApiClient / InvitationToken ────────
  const fills = [
    {
      key: "refreshSessions",
      table: Prisma.sql`"RefreshSession"`,
      userColumn: Prisma.sql`"userId"`,
      extra: Prisma.empty,
    },
    {
      key: "apiClients",
      table: Prisma.sql`"ApiClient"`,
      userColumn: Prisma.sql`"userId"`,
      extra: Prisma.empty,
    },
    {
      key: "invitations",
      table: Prisma.sql`"InvitationToken"`,
      userColumn: Prisma.sql`"acceptedById"`,
      extra: Prisma.sql`AND t."acceptedById" IS NOT NULL`,
    },
  ];
  const membership = {};
  for (const fill of fills) {
    const missing = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM ${fill.table} t
      WHERE t."membershipId" IS NULL ${fill.extra} ${orgFilter(Prisma.sql`t."orgId"`, orgId)}`);
    const resolvable = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM ${fill.table} t
      JOIN "OrganizationMembership" m ON m."orgId" = t."orgId" AND m."userId" = t.${fill.userColumn}
      WHERE t."membershipId" IS NULL ${fill.extra} ${orgFilter(Prisma.sql`t."orgId"`, orgId)}`);
    let filled = 0;
    if (args.apply && resolvable) {
      filled = await prisma.$executeRaw(Prisma.sql`
        UPDATE ${fill.table} t SET "membershipId" = m."id"
        FROM "OrganizationMembership" m
        WHERE m."orgId" = t."orgId" AND m."userId" = t.${fill.userColumn}
          AND t."membershipId" IS NULL ${fill.extra} ${orgFilter(Prisma.sql`t."orgId"`, orgId)}`);
    }
    membership[fill.key] = { missing, resolvable, unresolvable: missing - resolvable, filled };
  }

  console.log("");
  printCounts("ProjectAssignment.orgId", { missing: assignmentsMissing, filled: assignmentsFilled });
  for (const [key, row] of Object.entries(membership)) printCounts(`${key}.membershipId`, row);

  const changes =
    slugs.assignments.length +
    assignmentsMissing +
    Object.values(membership).reduce((sum, row) => sum + row.resolvable, 0);
  console.log(`\n${args.apply ? "Applied" : "Would apply"} ${changes.toLocaleString("en-US")} change(s).`);

  printResult({
    apply: args.apply,
    orgId,
    slugs: { assigned: slugs.assignments, collisions: slugs.collisions, alreadyFilled: slugs.alreadyFilled },
    assignments: { missing: assignmentsMissing, filled: assignmentsFilled },
    membership,
    changes,
  });
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
