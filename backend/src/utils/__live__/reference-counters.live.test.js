/**
 * Reference counters across an archive and a hard delete (enterprise wave
 * ENT-3, review fix).
 *
 *   npm run test:live -- src/utils/__live__/reference-counters.live.test.js
 *
 * What must hold:
 *   - archiving a project keeps its counters, so a reference whose row was
 *     deleted before the archive is not handed out again afterwards — the
 *     "never issued twice" rule of utils/reference-number.js survives an
 *     archive/restore;
 *   - dropping an organisation outright (the live kit, the E2E reset) purges
 *     the counters of the organisation and of each of its projects, which no
 *     foreign key cascades because the tenant sits in the scope key.
 */
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { nextReference, nextNumber } = require("../reference-number");
const projectService = require("../../services/project.service");

liveDescribe("Reference counters on archive and hard delete", () => {
  const prisma = new PrismaClient();
  let a;

  const taskSpec = (projectId) => ({ table: "Task", column: "taskNumber", scopeColumn: "projectId", scopeId: projectId, prefix: "T", pad: 3 });

  const insertTask = ({ projectId, orgId, taskNumber }) =>
    prisma.$executeRaw`
      INSERT INTO "Task" ("id", "orgId", "projectId", "taskNumber", "title", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${orgId}, ${projectId}, ${taskNumber}, 'counters', now())`;

  const countersOf = (id) =>
    prisma.$queryRaw`SELECT "scope" FROM "ReferenceCounter" WHERE "scope" LIKE ${`%${id}%`}`;

  beforeAll(async () => {
    a = await createLiveOrg(prisma);
  });

  afterAll(async () => {
    await dropLiveOrg(prisma, a?.org?.id);
    await prisma.$disconnect();
  });

  test("an archived project keeps its counters: a reference deleted before the archive is not reissued", async () => {
    const project = await prisma.project.create({ data: { orgId: a.org.id, name: "Counters", status: "active" } });
    const first = await nextReference(prisma, taskSpec(project.id));
    const second = await nextReference(prisma, taskSpec(project.id));
    expect([first.ref, second.ref]).toEqual(["T-001", "T-002"]);
    await insertTask({ projectId: project.id, orgId: a.org.id, taskNumber: first.ref });
    await insertTask({ projectId: project.id, orgId: a.org.id, taskNumber: second.ref });

    // The newest row goes; the register's highest is T-001 again.
    await prisma.task.deleteMany({ where: { projectId: project.id, taskNumber: second.ref } });

    await projectService.deleteProject({ orgId: a.org.id, projectId: project.id, userId: a.user.id, role: "pm" });
    const archived = await prisma.project.findUnique({ where: { id: project.id } });
    expect(archived.status).toBe("archived");
    expect((await countersOf(project.id)).length).toBe(1);

    // Brought back, the project continues the run: T-002 was issued once already.
    await prisma.project.update({ where: { id: project.id }, data: { status: "active", archivedAt: null, archivedBy: null } });
    const third = await nextReference(prisma, taskSpec(project.id));
    expect(third.ref).toBe("T-003");
  });

  test("dropping an organisation purges its counters and its projects' counters", async () => {
    const c = await createLiveOrg(prisma);
    const project = await prisma.project.create({ data: { orgId: c.org.id, name: "Dropped", status: "active" } });
    await nextReference(prisma, taskSpec(project.id));
    await nextNumber(prisma, { table: "Commitment", scope: { projectId: project.id, type: "subcontract" } });
    await nextReference(prisma, { table: "CostCode", column: "code", scopeColumn: "orgId", scopeId: c.org.id, prefix: "CC", pad: 3 });
    expect((await countersOf(project.id)).length).toBe(2);
    expect((await countersOf(c.org.id)).length).toBe(1);

    await dropLiveOrg(prisma, c.org.id);

    expect(await prisma.organisation.findUnique({ where: { id: c.org.id } })).toBeNull();
    expect((await countersOf(project.id)).length).toBe(0);
    expect((await countersOf(c.org.id)).length).toBe(0);
  });
});
