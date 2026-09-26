/**
 * The M2/M3 backfill scripts and the §50 report, driven as real child
 * processes against the real local database (enterprise wave ENT-1).
 *
 *   npm run test:live -- src/services/__live__/membership-backfill.live.test.js
 *
 * What must hold:
 *   - the membership backfill, run twice on one organisation, creates every
 *     row the first time and nothing the second time, with the owner chosen by
 *     the documented rule;
 *   - the owner decision a re-run reports is the one it writes: an
 *     organisation whose owner row was suspended by hand gets it back;
 *   - the tenant-column backfill fills the slug and the assignment orgId, and
 *     a dry run after it finds 0 changes;
 *   - the report is clean on that organisation, and unscoped dry runs of both
 *     backfills and of the report find nothing left on any durable tenant —
 *     this test never applies an unscoped write: the database is shared with
 *     the running API and the other waves, so every write here stays inside a
 *     LiveTest organisation;
 *   - the report stops (exit 1) when a membership carries a role outside the
 *     catalogue, and is clean again once the role is restored;
 *   - repairing a mismatched refresh session revokes its whole rotation
 *     family, not only the mismatched link;
 *   - a slug claimed by another process between plan and write yields the
 *     base's next free suffix, never a suffix chained onto a suffix.
 *
 * "Durable tenant" means an organisation that is not a LiveTest one and
 * existed before this test started: the other waves create and drop LiveTest
 * organisations while this runs, and their users legitimately have no
 * membership until ENT-2 creates one at sign-up, so those are tolerated.
 *
 * The throwaway organisation is a LiveTest one: two people, a pm who is a
 * company administrator and a qs who is not, one project, two assignments.
 */
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { createLiveOrg, dropLiveOrg, liveDescribe, spawnNode } = require("../../__live__/helpers");
const { parseResult, slugifyName, writeSlugs } = require("../../../scripts/enterprise/lib");

const SCRIPTS = "scripts/enterprise";

const runScript = async (name, args) => {
  const child = spawnNode(`${SCRIPTS}/${name}`, { args });
  const { code, output } = await child.exited;
  const result = parseResult(output);
  if (!result) throw new Error(`${name} ${args.join(" ")} printed no RESULT line:\n${output.slice(-3000)}`);
  return { code, output, result };
};

liveDescribe("membership backfill (M2, M3) and the §50 report", () => {
  const prisma = new PrismaClient();
  const startedAt = new Date();
  let org;
  let admin;
  let qs;
  let project;

  /** The organisations among `orgIds` that are durable: neither LiveTest nor born during this test. */
  const durableAmong = async (orgIds) => {
    if (!orgIds.length) return [];
    const orgs = await prisma.organisation.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true, createdAt: true },
    });
    return orgs.filter((row) => !/^LiveTest /.test(row.name) && row.createdAt <= startedAt);
  };

  /** Rows of a tenant-column fill still pending on a durable tenant (the SQL the M3 script runs, restricted). */
  const pendingOnDurable = async (sql) => {
    const [{ count }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS count FROM (${sql}) pending
       JOIN "Organisation" o ON o."id" = pending."orgId"
       WHERE o."name" NOT LIKE 'LiveTest %' AND o."createdAt" <= $1`,
      startedAt,
    );
    return Number(count);
  };

  beforeAll(async () => {
    const live = await createLiveOrg(prisma, { role: "pm", isCompanyAdmin: true });
    org = live.org;
    admin = live.user;
    qs = await prisma.user.create({
      data: {
        orgId: org.id,
        name: "Live Quantity Surveyor",
        email: `live-qs-${org.id}@octapm-live.test`,
        passwordHash: await bcrypt.hash("not-used-here", 4),
        role: "qs",
        isCompanyAdmin: false,
      },
    });
    project = await prisma.project.create({ data: { orgId: org.id, name: "Backfill Project", status: "active" } });
    await prisma.projectAssignment.createMany({
      data: [
        { projectId: project.id, userId: admin.id, role: "pm" },
        { projectId: project.id, userId: qs.id, role: "qs" },
      ],
    });
  });

  afterAll(async () => {
    await dropLiveOrg(prisma, org?.id);
    await prisma.$disconnect();
  });

  test("the membership backfill run twice yields identical counts and the documented owner", async () => {
    const dry = await runScript("backfill-memberships.js", ["--org", org.id]);
    expect(dry.code).toBe(0);
    expect(dry.result.apply).toBe(false);
    expect(dry.result.created).toBe(2);
    expect(dry.result.after.memberships).toBe(0); // a dry run writes nothing
    expect(dry.result.pending).toEqual([expect.objectContaining({ orgId: org.id, creates: 2, updates: 0 })]);

    const first = await runScript("backfill-memberships.js", ["--apply", "--org", org.id]);
    expect(first.code).toBe(0);
    expect(first.result.created).toBe(2);
    expect(first.result.after).toEqual({ users: 2, memberships: 2 });
    expect(first.result.owners).toEqual([
      expect.objectContaining({ orgId: org.id, userId: admin.id, basis: "admin" }),
    ]);

    const second = await runScript("backfill-memberships.js", ["--apply", "--org", org.id]);
    expect(second.code).toBe(0);
    expect(second.result).toMatchObject({ created: 0, updated: 0, unchanged: 2, changes: 0, pending: [] });
    expect(second.result.after).toEqual(first.result.after);
    expect(second.result.owners).toEqual([]); // ownership is never re-decided

    const memberships = await prisma.organizationMembership.findMany({ where: { orgId: org.id }, orderBy: { role: "asc" } });
    expect(memberships).toHaveLength(2);
    expect(memberships.find((row) => row.userId === admin.id)).toMatchObject({
      role: "pm", kind: "member", isAdmin: true, isOwner: true, status: "active", joinedAt: admin.createdAt,
    });
    expect(memberships.find((row) => row.userId === qs.id)).toMatchObject({
      role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active",
    });
  });

  test("the owner decision a re-run reports is the one it writes, even onto an existing row", async () => {
    const ownerRow = await prisma.organizationMembership.findFirstOrThrow({ where: { orgId: org.id, userId: admin.id } });
    // Raw, as an operator's hand-edit would be: the organisation now has no active owner.
    await prisma.$executeRaw`UPDATE "OrganizationMembership" SET "status" = 'suspended', "isOwner" = false WHERE "id" = ${ownerRow.id}`;

    const rerun = await runScript("backfill-memberships.js", ["--apply", "--org", org.id]);
    expect(rerun.code).toBe(0);
    expect(rerun.result.owners).toEqual([expect.objectContaining({ orgId: org.id, userId: admin.id, basis: "admin" })]);
    expect(rerun.result).toMatchObject({ created: 0, updated: 1, changes: 1 });

    // What was reported is what is on the row: owned again, and active again because the User row is.
    const reloaded = await prisma.organizationMembership.findUniqueOrThrow({ where: { id: ownerRow.id } });
    expect(reloaded).toMatchObject({ isOwner: true, isAdmin: true, status: "active" });

    const settled = await runScript("backfill-memberships.js", ["--apply", "--org", org.id]);
    expect(settled.result).toMatchObject({ changes: 0, owners: [] });
    const report = await runScript("validate-membership-backfill.js", ["--org", org.id]);
    expect(report.result.rows.find((row) => row.check === "org_has_active_owner").status).toBe("ok");
  });

  test("the tenant-column backfill fills slug and assignment orgId, then finds nothing to do", async () => {
    const applied = await runScript("backfill-tenant-columns.js", ["--apply", "--org", org.id]);
    expect(applied.code).toBe(0);
    expect(applied.result.slugs.assigned).toEqual([expect.objectContaining({ orgId: org.id, slug: expect.stringMatching(/^livetest-[0-9a-f]/) })]);
    expect(applied.result.assignments).toEqual({ missing: 2, filled: 2 });

    const reloaded = await prisma.organisation.findUnique({ where: { id: org.id }, select: { slug: true } });
    expect(reloaded.slug).toBe(applied.result.slugs.assigned[0].slug);
    const assignments = await prisma.projectAssignment.findMany({ where: { projectId: project.id }, select: { orgId: true } });
    expect(assignments.map((row) => row.orgId)).toEqual([org.id, org.id]);

    const again = await runScript("backfill-tenant-columns.js", ["--org", org.id]);
    expect(again.code).toBe(0);
    expect(again.result.changes).toBe(0);
    expect(again.result.slugs.assigned).toEqual([]);
    expect(again.result.assignments.missing).toBe(0);
  });

  test("the report is clean on the organisation, and unscoped dry runs find nothing left on any durable tenant", async () => {
    const scoped = await runScript("validate-membership-backfill.js", ["--org", org.id]);
    expect(scoped.code).toBe(0);
    expect(scoped.result).toMatchObject({ ok: true, stops: 0, warnings: 0 });
    expect(scoped.result.rows.find((row) => row.check === "users_have_membership").status).toBe("ok");
    expect(scoped.result.rows.find((row) => row.check === "assignments_have_membership").status).toBe("ok");

    // The whole database, read only: whatever M2 still wants to write belongs
    // to a tenant another process is creating right now, never to a durable one.
    const memberships = await runScript("backfill-memberships.js", []);
    expect(memberships.code).toBe(0);
    expect(memberships.result.apply).toBe(false);
    expect(await durableAmong(memberships.result.pending.map((row) => row.orgId))).toEqual([]);

    const columns = await runScript("backfill-tenant-columns.js", []);
    expect(columns.code).toBe(0);
    expect(columns.result.apply).toBe(false);
    expect(await durableAmong(columns.result.slugs.assigned.map((row) => row.orgId))).toEqual([]);
    expect(await pendingOnDurable(`
      SELECT p."orgId" FROM "ProjectAssignment" pa JOIN "Project" p ON p."id" = pa."projectId" WHERE pa."orgId" IS NULL`)).toBe(0);
    expect(await pendingOnDurable(`
      SELECT t."orgId" FROM "RefreshSession" t JOIN "OrganizationMembership" m ON m."orgId" = t."orgId" AND m."userId" = t."userId"
      WHERE t."membershipId" IS NULL`)).toBe(0);
    expect(await pendingOnDurable(`
      SELECT t."orgId" FROM "ApiClient" t JOIN "OrganizationMembership" m ON m."orgId" = t."orgId" AND m."userId" = t."userId"
      WHERE t."membershipId" IS NULL`)).toBe(0);
    expect(await pendingOnDurable(`
      SELECT t."orgId" FROM "InvitationToken" t JOIN "OrganizationMembership" m ON m."orgId" = t."orgId" AND m."userId" = t."acceptedById"
      WHERE t."membershipId" IS NULL AND t."acceptedById" IS NOT NULL`)).toBe(0);

    // The unscoped report: a stop row may name only transient tenants.
    const report = await runScript("validate-membership-backfill.js", []);
    const stops = report.result.rows.filter((row) => row.status === "stop");
    const stopDetails = JSON.parse(require("fs").readFileSync(report.result.jsonPath, "utf8")).rows
      .filter((row) => row.status === "stop")
      .flatMap((row) => row.details);
    // Every stop detail must name an organisation (a duplicate e-mail names none, so it can never be excused).
    expect(stopDetails.filter((detail) => !detail.orgId)).toEqual([]);
    expect(await durableAmong(stopDetails.map((detail) => detail.orgId))).toEqual([]);
    if (!stops.length) expect(report.code).toBe(0);
  });

  test("the report stops when a membership role leaves the catalogue, and is clean once restored", async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { orgId: org.id, userId: qs.id } });
    // Raw: nothing in the service would write this value, which is the point.
    await prisma.$executeRaw`UPDATE "OrganizationMembership" SET "role" = 'super_admin' WHERE "id" = ${membership.id}`;
    try {
      const failing = await runScript("validate-membership-backfill.js", ["--org", org.id]);
      expect(failing.code).toBe(1);
      expect(failing.result.ok).toBe(false);
      expect(failing.result.stops).toBe(1);
      const rolesRow = failing.result.rows.find((row) => row.check === "roles_in_catalogue");
      expect(rolesRow.status).toBe("stop");
      expect(failing.output).toContain(membership.id);
    } finally {
      await prisma.organizationMembership.update({ where: { id: membership.id }, data: { role: "qs" } });
    }

    const restored = await runScript("validate-membership-backfill.js", ["--org", org.id]);
    expect(restored.code).toBe(0);
    expect(restored.result.ok).toBe(true);
  });

  test("repairing a mismatched refresh session revokes its whole rotation family, in both directions", async () => {
    // A second workspace the qs does not belong to; the chain crosses it in the middle.
    const elsewhere = await prisma.organisation.create({ data: { name: `LiveTest ${crypto.randomUUID()}` } });
    const session = (id, orgId, replacedBySessionId = null) => ({
      id,
      orgId,
      userId: qs.id,
      tokenHash: crypto.randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 86_400_000),
      replacedBySessionId,
    });
    const [first, mismatched, last, unrelated] = [1, 2, 3, 4].map(() => crypto.randomUUID());
    try {
      await prisma.refreshSession.createMany({
        data: [
          session(first, org.id, mismatched), // predecessor: fine on its own
          session(mismatched, elsewhere.id, last), // the link with no membership behind it
          session(last, org.id), // successor: fine on its own
          session(unrelated, org.id), // another sign-in of the same person, must survive
        ],
      });

      const repaired = await runScript("validate-membership-backfill.js", ["--apply", "--org", elsewhere.id]);
      const sessionsRow = repaired.result.rows.find((row) => row.check === "refresh_sessions_match_membership");
      expect(sessionsRow).toMatchObject({ status: "warn", actual: "1 mismatches, 3 revoked (families)" });

      const after = await prisma.refreshSession.findMany({ where: { id: { in: [first, mismatched, last, unrelated] } } });
      const revokedIds = after.filter((row) => row.revokedAt).map((row) => row.id).sort();
      expect(revokedIds).toEqual([first, mismatched, last].sort());
      expect(after.find((row) => row.id === unrelated).revokedAt).toBeNull();

      const clean = await runScript("validate-membership-backfill.js", ["--org", elsewhere.id]);
      expect(clean.result.rows.find((row) => row.check === "refresh_sessions_match_membership")).toMatchObject({ status: "ok", actual: "0 mismatches" });
    } finally {
      await prisma.refreshSession.deleteMany({ where: { id: { in: [first, mismatched, last, unrelated] } } });
      await dropLiveOrg(prisma, elsewhere.id);
    }
  });

  test("a slug claimed by another process between plan and write yields the base's next free suffix", async () => {
    const name = `LiveTest ${crypto.randomUUID()}`;
    const base = slugifyName(name);
    // The base and its first suffix are already held, as if the planner lost
    // the race for "-2" to another run that planned the same handle.
    const holder = await prisma.organisation.create({ data: { name, slug: base } });
    const racer = await prisma.organisation.create({ data: { name, slug: `${base}-2` } });
    const late = await prisma.organisation.create({ data: { name } });
    try {
      const [written] = await writeSlugs(prisma, [{ orgId: late.id, name, slug: `${base}-2` }]);
      expect(written.skipped).toBeUndefined();
      expect(written.slug).toBe(`${base}-3`);
      const reloaded = await prisma.organisation.findUniqueOrThrow({ where: { id: late.id }, select: { slug: true } });
      expect(reloaded.slug).toBe(`${base}-3`);
    } finally {
      for (const row of [late, racer, holder]) await dropLiveOrg(prisma, row.id);
    }
  });
});
