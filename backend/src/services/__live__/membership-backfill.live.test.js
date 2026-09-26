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
 *   - the tenant-column backfill fills the slug and the assignment orgId, and
 *     a dry run after it finds 0 changes;
 *   - the report is clean on that organisation, and on the whole database
 *     after an unscoped run;
 *   - the report stops (exit 1) when a membership carries a role outside the
 *     catalogue, and is clean again once the role is restored.
 *
 * The throwaway organisation is a LiveTest one: two people, a pm who is a
 * company administrator and a qs who is not, one project, two assignments.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { createLiveOrg, dropLiveOrg, liveDescribe, spawnNode } = require("../../__live__/helpers");
const { parseResult } = require("../../../scripts/enterprise/lib");

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
  let org;
  let admin;
  let qs;
  let project;

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

    const first = await runScript("backfill-memberships.js", ["--apply", "--org", org.id]);
    expect(first.code).toBe(0);
    expect(first.result.created).toBe(2);
    expect(first.result.after).toEqual({ users: 2, memberships: 2 });
    expect(first.result.owners).toEqual([
      expect.objectContaining({ orgId: org.id, userId: admin.id, basis: "admin" }),
    ]);

    const second = await runScript("backfill-memberships.js", ["--apply", "--org", org.id]);
    expect(second.code).toBe(0);
    expect(second.result).toMatchObject({ created: 0, updated: 0, unchanged: 2, changes: 0 });
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

  test("the report is clean on the organisation and on the whole database after an unscoped run", async () => {
    const scoped = await runScript("validate-membership-backfill.js", ["--org", org.id]);
    expect(scoped.code).toBe(0);
    expect(scoped.result).toMatchObject({ ok: true, stops: 0, warnings: 0 });
    expect(scoped.result.rows.find((row) => row.check === "users_have_membership").status).toBe("ok");
    expect(scoped.result.rows.find((row) => row.check === "assignments_have_membership").status).toBe("ok");

    // The whole database: the second unscoped apply must change nothing.
    const whole = await runScript("backfill-memberships.js", ["--apply"]);
    expect(whole.code).toBe(0);
    const wholeAgain = await runScript("backfill-memberships.js", ["--apply"]);
    expect(wholeAgain.code).toBe(0);
    expect(wholeAgain.result.changes).toBe(0);
    expect(wholeAgain.result.after).toEqual(whole.result.after);
    const columns = await runScript("backfill-tenant-columns.js", ["--apply"]);
    expect(columns.code).toBe(0);

    const report = await runScript("validate-membership-backfill.js", []);
    expect(report.code).toBe(0);
    expect(report.result.ok).toBe(true);
    expect(report.result.stops).toBe(0);
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
});
