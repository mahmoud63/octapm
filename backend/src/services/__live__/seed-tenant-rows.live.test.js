/**
 * The seed writes the tenant rows M7 requires (enterprise wave ENT-3, review
 * fix): the E2E reset re-seeds its organisation before every browser run, so
 * a seed that the constrained schema or the regenerated client refuses stops
 * every Playwright and mobile suite at setup.
 *
 *   npm run test:live -- src/services/__live__/seed-tenant-rows.live.test.js
 *
 * The seed is run as the reset runs it — a child process with SEED_ORG_NAME
 * and SEED_EMAIL_DOMAIN — against a throwaway "LiveTest <uuid>" organisation
 * that the kit drops afterwards. What must hold:
 *   - the seed exits 0 against the M7 schema;
 *   - every assignment carries the project's orgId (NOT NULL since 021000,
 *     required by the client), and names a person with a membership in that
 *     organisation ((orgId, userId) → OrganizationMembership).
 */
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { BACKEND_ROOT, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");

liveDescribe("Seed writes tenant rows (M7)", () => {
  const prisma = new PrismaClient();
  const tag = crypto.randomUUID();
  const orgName = `LiveTest ${tag}`;
  let orgId;

  afterAll(async () => {
    await dropLiveOrg(prisma, orgId);
    await prisma.$disconnect();
  });

  test("the seed completes, and its assignments carry the organisation and a membership", async () => {
    const seed = spawnSync(process.execPath, [path.join(BACKEND_ROOT, "prisma", "seed.js")], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, SEED_ORG_NAME: orgName, SEED_EMAIL_DOMAIN: `${tag.slice(0, 8)}.livetest.test` },
      encoding: "utf8",
      timeout: 170_000,
    });
    const org = await prisma.organisation.findFirst({ where: { name: orgName } });
    orgId = org?.id;
    // the reason sits at the end of the seed's stderr; shown only on a failure
    const tail = seed.stderr.split("\n").filter(Boolean).slice(-6).join(" | ");
    expect({ status: seed.status, tail: seed.status === 0 ? "" : tail }).toEqual({ status: 0, tail: "" });
    expect(org).not.toBeNull();

    const projects = await prisma.project.findMany({ where: { orgId: org.id }, select: { id: true } });
    expect(projects.length).toBe(1);
    const assignments = await prisma.projectAssignment.findMany({ where: { projectId: projects[0].id } });
    expect(assignments.length).toBeGreaterThanOrEqual(8);
    expect(assignments.every((row) => row.orgId === org.id)).toBe(true);

    const members = await prisma.organizationMembership.findMany({ where: { orgId: org.id }, select: { userId: true } });
    const memberIds = new Set(members.map((row) => row.userId));
    expect(assignments.every((row) => memberIds.has(row.userId))).toBe(true);
  }, 180_000);
});
