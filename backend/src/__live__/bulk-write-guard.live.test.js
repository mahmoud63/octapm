const { PrismaClient } = require("@prisma/client");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe } = require("./helpers");
const { prisma: servicePrisma } = require("../config/db");

/**
 * The guard enable-live.js installs. Every refused write below runs inside an
 * interactive transaction that always rolls back, so if the guard is removed
 * the statement reaches Postgres, touches the whole table, and is undone —
 * the test then fails on the missing refusal, never on damaged data.
 */
const ROLLBACK = Symbol("rollback");
const inRolledBackTransaction = (client, work) =>
  client
    .$transaction(async (tx) => {
      await work(tx);
      throw ROLLBACK;
    })
    .then(
      () => ({ error: null }),
      (error) => ({ error: error === ROLLBACK ? null : error }),
    );

liveDescribe("an unscoped bulk write in a live test refuses to run", () => {
  const prisma = new PrismaClient();
  let live;
  let colleague;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    colleague = await createLiveUser(prisma, { orgId: live.org.id, name: "Guard Colleague", email: `guard-${live.org.id}@octapm-live.test`, role: "qs", isCompanyAdmin: false });
  });

  afterAll(async () => {
    await dropLiveOrg(prisma, live?.org?.id);
    await prisma.$disconnect();
  });

  test("the incident's statement — every filter value undefined — is refused before it reaches the database", async () => {
    const fixture = {}; // what a failed fixture step leaves behind
    const { error } = await inRolledBackTransaction(prisma, (tx) =>
      tx.organizationMembership.updateMany({ where: { orgId: fixture.orgId, userId: fixture.id }, data: { role: "pm" } }),
    );
    expect(error?.name).toBe("UnscopedBulkWriteError");
    expect(error.message).toMatch(/OrganizationMembership\.updateMany/);
  });

  test("an empty or missing where is refused for deletes too, on the client the services use as well", async () => {
    for (const client of [prisma, servicePrisma]) {
      const empty = await inRolledBackTransaction(client, (tx) => tx.authThrottle.deleteMany({ where: {} }));
      expect(empty.error?.name).toBe("UnscopedBulkWriteError");
      const missing = await inRolledBackTransaction(client, (tx) => tx.authThrottle.deleteMany());
      expect(missing.error?.name).toBe("UnscopedBulkWriteError");
    }
  });

  test("a scoped bulk write still runs, and changes only the rows it names", async () => {
    const others = await prisma.organizationMembership.count({ where: { orgId: { not: live.org.id } } });
    const changed = await prisma.organizationMembership.updateMany({ where: { orgId: live.org.id, userId: colleague.id }, data: { role: "site_engineer" } });
    expect(changed.count).toBe(1);
    expect(await prisma.organizationMembership.findUnique({ where: { orgId_userId: { orgId: live.org.id, userId: colleague.id } } })).toMatchObject({ role: "site_engineer" });
    expect(await prisma.organizationMembership.count({ where: { orgId: { not: live.org.id } } })).toBe(others);
  });
});
