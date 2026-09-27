/**
 * The OrganizationMembership constraints, exercised with raw SQL so nothing
 * but Postgres can answer (enterprise wave ENT-1, migration
 * 20261004090000_organisation_membership).
 *
 *   npm run test:live -- src/services/__live__/membership-schema-teeth.live.test.js
 *
 * What must hold:
 *   - a guest row may carry only external_party and never admin or ownership
 *     (the hand-written CHECK, which Prisma cannot express);
 *   - a second row for the same (orgId, userId) is refused;
 *   - a well-formed guest row and a member row insert normally, so the
 *     refusals above are the constraints and not a broken table.
 */
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");

liveDescribe("OrganizationMembership schema teeth", () => {
  const prisma = new PrismaClient();
  let org;
  let user;

  const insert = ({ id = crypto.randomUUID(), role, kind, isAdmin = false, isOwner = false }) =>
    prisma.$executeRaw`
      INSERT INTO "OrganizationMembership" ("id", "orgId", "userId", "role", "kind", "isAdmin", "isOwner", "status", "updatedAt")
      VALUES (${id}, ${org.id}, ${user.id}, ${role}, ${kind}, ${isAdmin}, ${isOwner}, 'active', now())`;

  beforeAll(async () => {
    // A person without a membership row: every row this test needs it writes
    // by hand, so the constraints alone decide what goes in.
    ({ org, user } = await createLiveOrg(prisma, { legacy: true }));
  });

  afterAll(async () => {
    await dropLiveOrg(prisma, org?.id);
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.organizationMembership.deleteMany({ where: { orgId: org.id } });
  });

  test("a guest row that is not external_party, or that administers or owns, is refused by Postgres", async () => {
    await expect(insert({ role: "pm", kind: "guest" })).rejects.toThrow(/OrganizationMembership_guest_check/);
    await expect(insert({ role: "external_party", kind: "guest", isAdmin: true })).rejects.toThrow(/OrganizationMembership_guest_check/);
    await expect(insert({ role: "external_party", kind: "guest", isOwner: true })).rejects.toThrow(/OrganizationMembership_guest_check/);
    expect(await prisma.organizationMembership.count({ where: { orgId: org.id } })).toBe(0);

    // Positive control: the well-formed guest row goes in.
    await insert({ role: "external_party", kind: "guest" });
    expect(await prisma.organizationMembership.count({ where: { orgId: org.id, kind: "guest" } })).toBe(1);
  });

  test("a second membership for the same person in the same organisation is refused", async () => {
    await insert({ role: "pm", kind: "member", isAdmin: true, isOwner: true });
    // Postgres reports a unique violation by SQLSTATE 23505 and the key, not by the index name.
    await expect(insert({ role: "qs", kind: "member" })).rejects.toThrow(/23505.*\("orgId", "userId"\).*already exists/s);
    expect(await prisma.organizationMembership.count({ where: { orgId: org.id, userId: user.id } })).toBe(1);
  });
});
