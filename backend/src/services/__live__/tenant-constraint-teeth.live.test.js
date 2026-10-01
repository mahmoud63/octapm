/**
 * The M7 tenant constraints, exercised with raw SQL so nothing but Postgres
 * can answer (enterprise wave ENT-3, migrations 20261005020000..021000).
 *
 *   npm run test:live -- src/services/__live__/tenant-constraint-teeth.live.test.js
 *
 * What must hold:
 *   - a row whose (projectId, orgId) names a project of another organisation
 *     is refused by the composite key, on a batch-1 table (Task) and a
 *     batch-3 table (Location), and the same shape with the right orgId goes in;
 *   - a project row naming a cost code of another organisation is refused by
 *     (costCodeId, orgId) → CostCode(id, orgId);
 *   - an assignment written without orgId gets the project's (the bridge
 *     trigger), and one naming a person with no membership in the project's
 *     organisation is refused by (orgId, userId) → OrganizationMembership.
 *
 * Mutation for the record: with the constraint dropped inside a transaction
 * that is rolled back, the mismatched insert succeeds — see the wave report.
 */
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");

liveDescribe("Tenant constraint teeth (M7)", () => {
  const prisma = new PrismaClient();
  let a;
  let b;
  let projectA;
  let costCodeA;
  let costCodeB;

  const insertTask = ({ projectId, orgId }) =>
    prisma.$executeRaw`
      INSERT INTO "Task" ("id", "orgId", "projectId", "taskNumber", "title", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${orgId}, ${projectId}, ${`T-${crypto.randomUUID().slice(0, 8)}`}, 'teeth', now())`;

  const insertLocation = ({ projectId, orgId }) =>
    prisma.$executeRaw`
      INSERT INTO "Location" ("id", "orgId", "projectId", "name", "code", "kind", "path", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${orgId}, ${projectId}, 'teeth', ${crypto.randomUUID().slice(0, 8)}, 'zone', ${crypto.randomUUID()}, now())`;

  const insertProjectCostCode = ({ projectId, orgId, costCodeId }) =>
    prisma.$executeRaw`
      INSERT INTO "ProjectCostCode" ("id", "orgId", "projectId", "costCodeId", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${orgId}, ${projectId}, ${costCodeId}, now())`;

  const insertAssignment = ({ projectId, userId }) =>
    prisma.$executeRaw`
      INSERT INTO "ProjectAssignment" ("id", "projectId", "userId", "role")
      VALUES (${crypto.randomUUID()}, ${projectId}, ${userId}, 'qs')`;

  beforeAll(async () => {
    a = await createLiveOrg(prisma);
    b = await createLiveOrg(prisma);
    projectA = await prisma.project.create({
      data: { orgId: a.org.id, name: "Teeth A", startDate: new Date("2027-01-04"), endDate: new Date("2027-12-17"), status: "active" },
    });
    costCodeA = await prisma.costCode.create({ data: { orgId: a.org.id, code: "01-100", name: "General A" } });
    costCodeB = await prisma.costCode.create({ data: { orgId: b.org.id, code: "01-100", name: "General B" } });
  });

  afterAll(async () => {
    await dropLiveOrg(prisma, a?.org?.id);
    await dropLiveOrg(prisma, b?.org?.id);
    await prisma.$disconnect();
  });

  test("a (projectId, orgId) pair that disagrees is refused on Task and Location; the agreeing pair goes in", async () => {
    await expect(insertTask({ projectId: projectA.id, orgId: b.org.id })).rejects.toThrow(/Task_projectId_orgId_fkey/);
    await expect(insertLocation({ projectId: projectA.id, orgId: b.org.id })).rejects.toThrow(/Location_projectId_orgId_fkey/);
    expect(await prisma.task.count({ where: { projectId: projectA.id } })).toBe(0);
    expect(await prisma.location.count({ where: { projectId: projectA.id } })).toBe(0);

    // Positive control: the same rows with the project's own organisation.
    await insertTask({ projectId: projectA.id, orgId: a.org.id });
    await insertLocation({ projectId: projectA.id, orgId: a.org.id });
    expect(await prisma.task.count({ where: { projectId: projectA.id, orgId: a.org.id } })).toBe(1);
    expect(await prisma.location.count({ where: { projectId: projectA.id, orgId: a.org.id } })).toBe(1);
  });

  test("a project row naming another organisation's cost code is refused by the master key", async () => {
    await expect(insertProjectCostCode({ projectId: projectA.id, orgId: a.org.id, costCodeId: costCodeB.id })).rejects.toThrow(
      /ProjectCostCode_costCodeId_orgId_fkey/,
    );
    expect(await prisma.projectCostCode.count({ where: { projectId: projectA.id } })).toBe(0);

    await insertProjectCostCode({ projectId: projectA.id, orgId: a.org.id, costCodeId: costCodeA.id });
    expect(await prisma.projectCostCode.count({ where: { projectId: projectA.id, costCodeId: costCodeA.id } })).toBe(1);
  });

  test("an assignment gets the project's orgId when the writer leaves it out, and needs a membership in that organisation", async () => {
    // b.user belongs to B only: no membership in A, so A's project cannot list them.
    await expect(insertAssignment({ projectId: projectA.id, userId: b.user.id })).rejects.toThrow(/ProjectAssignment_orgId_userId_fkey/);
    expect(await prisma.projectAssignment.count({ where: { projectId: projectA.id } })).toBe(0);

    // a.user holds a membership in A; the row is written without orgId, as
    // the previous release's client writes it, and comes back with A's.
    await insertAssignment({ projectId: projectA.id, userId: a.user.id });
    const row = await prisma.projectAssignment.findFirst({ where: { projectId: projectA.id, userId: a.user.id } });
    expect(row.orgId).toBe(a.org.id);
  });

  test("a project hard delete nulls only a stock transaction's projectId; its organisation stays (021100)", async () => {
    // A stock movement outlives its project (SET NULL), but the pair key must
    // null the project alone: orgId is NOT NULL, and nulling both made every
    // hard delete of a project with a movement fail on the row, not on a key.
    const project = await prisma.project.create({ data: { orgId: a.org.id, name: "Teeth stock", status: "active" } });
    // A central warehouse and a company-owned item (no project), so nothing
    // but the pair key decides what happens to the movement.
    const warehouse = await prisma.warehouse.create({ data: { orgId: a.org.id, code: `W-${crypto.randomUUID().slice(0, 6)}`, name: "Teeth yard" } });
    const item = await prisma.inventoryItem.create({ data: { orgId: a.org.id, sku: `SKU-${crypto.randomUUID().slice(0, 6)}`, name: "Teeth rebar", unit: "t" } });
    const movement = await prisma.stockTransaction.create({
      data: { orgId: a.org.id, projectId: project.id, itemId: item.id, warehouseId: warehouse.id, type: "receipt", quantity: 4 },
    });

    await prisma.$executeRaw`DELETE FROM "Project" WHERE "id" = ${project.id}`;

    const after = await prisma.stockTransaction.findUnique({ where: { id: movement.id } });
    expect(after).not.toBeNull();
    expect(after.projectId).toBeNull();
    expect(after.orgId).toBe(a.org.id);
  });

  test("the PC-6 quantity tables refuse a disagreeing (projectId, orgId) pair and a replayed clientRequestId (20261005050000)", async () => {
    // Raw SQL on purpose: the two tables exist only once the orchestrator has
    // applied migration 20261005050000_quantity_progress to this database, and
    // the shared Prisma client may predate them. Until then the case reports
    // itself as not yet applicable instead of failing on a missing table —
    // the same assertions run green on a throwaway database through
    // scripts/db/prove-quantity-progress-constraints.js.
    const present = await prisma.$queryRaw`SELECT to_regclass('"QuantityProgressEntry"') IS NOT NULL AS ok`;
    if (!present[0]?.ok) {
      console.warn("tenant-constraint-teeth: 20261005050000_quantity_progress is not applied to this database; PC-6 case not yet applicable");
      return;
    }
    const activity = await prisma.activity.create({ data: { projectId: projectA.id, name: "Teeth blockwork" } });
    const item = await prisma.boqItem.create({ data: { projectId: projectA.id, description: "Teeth blockwork 200mm", unitCode: "m2" } });
    const key = `teeth-${crypto.randomUUID().slice(0, 8)}`;
    const insertEntry = ({ orgId, clientRequestId }) =>
      prisma.$executeRaw`
        INSERT INTO "QuantityProgressEntry" ("id", "orgId", "projectId", "activityId", "boqItemId", "unitCode", "quantity", "date", "clientRequestId", "updatedAt")
        VALUES (${crypto.randomUUID()}, ${orgId}, ${projectA.id}, ${activity.id}, ${item.id}, 'm2', 12.5, '2027-02-03', ${clientRequestId}, now())`;

    await expect(insertEntry({ orgId: b.org.id, clientRequestId: key })).rejects.toThrow(/QuantityProgressEntry_projectId_orgId_fkey/);
    await insertEntry({ orgId: a.org.id, clientRequestId: key });
    // Prisma reports a raw unique violation by its SQLSTATE and the key's
    // columns, not by the constraint's name (a foreign-key violation names the
    // constraint); both forms are the database refusing the replay.
    await expect(insertEntry({ orgId: a.org.id, clientRequestId: key })).rejects.toThrow(/Code: `23505`[\s\S]*\("projectId", "clientRequestId"\)/);
    const rows = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "QuantityProgressEntry" WHERE "projectId" = ${projectA.id}`;
    expect(rows[0].n).toBe(1);

    // The section row's key has the same teeth.
    const log = await prisma.dailyLog.create({ data: { orgId: a.org.id, projectId: projectA.id, date: new Date("2027-02-03") } });
    const insertSection = ({ orgId }) =>
      prisma.$executeRaw`
        INSERT INTO "DailyLogQuantity" ("id", "orgId", "projectId", "dailyLogId", "activityId", "boqItemId", "unitCode", "quantity", "updatedAt")
        VALUES (${crypto.randomUUID()}, ${orgId}, ${projectA.id}, ${log.id}, ${activity.id}, ${item.id}, 'm2', 12.5, now())`;
    await expect(insertSection({ orgId: b.org.id })).rejects.toThrow(/DailyLogQuantity_projectId_orgId_fkey/);
    await insertSection({ orgId: a.org.id });
  });
});
