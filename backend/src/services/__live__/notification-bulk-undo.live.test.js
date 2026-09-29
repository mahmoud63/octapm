/**
 * A bulk workflow step inside one transaction is not slowed past its
 * timeout by the rule that a BOQ record's notice reaches only a reader of
 * the BOQ (closure review, 2026-09-28).
 *
 * Undoing a mapping-import batch rejects every row of it inside ONE
 * interactive transaction (Prisma's default 5 s timeout), recording two
 * workflow transitions per draft row — each of which fans a notice out to
 * the project's PMs. d52deae decided "may this person read the BOQ on this
 * project?" for every recipient of every transition, twice (the recipients,
 * then their words), through the principal and project-access queries; an
 * undo of 100 rows then ran past the timeout (P2028, nothing rejected),
 * where cf0cd4b's took 3.3 s and a 150-row one 4.9 s. The answer is now
 * decided once per (person, project) per fan-out, and once for the whole
 * transaction inside one:
 *
 *   a 150-row batch is undone inside the one transaction, every row
 *     rejected, within the interactive-transaction limit;
 *   each member's BOQ read is resolved at most once for the whole undo —
 *     the BOQ readers and the PM without BOQ read alike;
 *   the PMs who read the BOQ are asked to look at each row as before, and
 *     the PM without BOQ read receives none of the rows' notices.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; the services are called in-process, as the route calls them.
 *
 *   npm run test:live -- src/services/__live__/notification-bulk-undo.live.test.js
 */
const XLSX = require("@e965/xlsx");
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const membershipService = require("../membership.service");
const mappingImport = require("../mapping-import.service");

const ROWS = 150;
const TRANSACTION_LIMIT_MS = 5000;

liveDescribe("a mapping-import batch's undo notifies inside its transaction's time (BOQ read decided once per person and project)", () => {
  let live;
  let project;
  const readers = [];
  let withoutBoq;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    const org = await prisma.organisation.findUnique({ where: { id: live.org.id }, select: { name: true } });
    expect(/^LiveTest [0-9a-f-]{36}$/.test(org.name)).toBe(true);
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest bulk undo", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: live.user.id, role: "pm", orgId: live.org.id } });
    const tag = Date.now();
    // Two PMs who read the BOQ, and one whose template takes the BOQ away.
    for (let index = 0; index < 3; index += 1) {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest bulk PM ${index}`,
        email: `live-bulk-pm-${index}-${tag}@octapm-live.test`,
        role: "pm",
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role: "pm", orgId: live.org.id } });
      if (index < 2) readers.push(member);
      else withoutBoq = member;
    }
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest pm, no BOQ ${tag}`, baseRole: "pm", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectUserPermission.create({
      data: { orgId: live.org.id, projectId: project.id, userId: withoutBoq.id, templateId: template.id },
    });

    // A bill of ROWS rows and a programme of ROWS coded activities in this
    // LiveTest project, one row mapped to each by the import.
    await prisma.boqItem.createMany({
      data: Array.from({ length: ROWS }, (_, index) => ({
        projectId: project.id,
        code: `9.${index + 1}`,
        description: `Bulk item ${index + 1}`,
        unit: "m3",
        qty: 10,
        rate: 10,
        amount: 100,
      })),
    });
    await prisma.activity.createMany({
      data: Array.from({ length: ROWS }, (_, index) => ({
        projectId: project.id,
        name: `Bulk activity ${index + 1}`,
        activityCode: `B${index + 1}`,
        duration: 5,
        startDate: new Date("2026-02-02"),
        endDate: new Date("2026-02-06"),
      })),
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it(`undoes a ${ROWS}-row batch inside the one transaction, resolving each member's BOQ read once, and tells only the BOQ readers`, async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["boq_code", "activity_code", "quantity"],
      ...Array.from({ length: ROWS }, (_, index) => [`9.${index + 1}`, `B${index + 1}`, 10]),
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Mapping");
    const applied = await mappingImport.applyImport({
      orgId: live.org.id,
      projectId: project.id,
      userId: live.user.id,
      file: XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
    });
    expect([Boolean(applied.batchId), applied.created?.length ?? applied.createdCount]).toEqual([true, ROWS]);

    const resolved = jest.spyOn(membershipService, "resolveRequestPrincipal");
    const started = Date.now();
    const undone = await mappingImport.undoImportBatch({ orgId: live.org.id, projectId: project.id, userId: live.user.id, batchId: applied.batchId });
    const elapsed = Date.now() - started;
    // (Restoring the spy clears what it recorded: keep it first.)
    const resolutions = resolved.mock.calls.map(([args]) => args?.userId);
    resolved.mockRestore();
    // eslint-disable-next-line no-console
    console.log(`undo of ${ROWS} rows: ${elapsed} ms; principal resolutions: ${resolutions.length}`);

    // Every row rejected, inside the transaction's time.
    expect([undone.total, undone.rejected]).toEqual([ROWS, ROWS]);
    expect(await prisma.activityBoqAllocation.count({ where: { projectId: project.id, importBatchId: applied.batchId, status: "rejected", isActive: false } })).toBe(ROWS);
    expect(elapsed).toBeLessThan(TRANSACTION_LIMIT_MS);

    // Each member's BOQ read resolved at most once for the whole undo: no
    // person's principal is looked up twice (300 transitions, 3 recipients each).
    const perPerson = new Map();
    for (const userId of resolutions) perPerson.set(userId, (perPerson.get(userId) || 0) + 1);
    expect([...perPerson.values()].filter((count) => count > 1)).toEqual([]);
    // ... and it was resolved: the three PMs who may receive the notices.
    expect([...perPerson.keys()].sort()).toEqual([...readers.map((reader) => reader.id), withoutBoq.id].sort());

    // The BOQ readers were asked to look at each row as it was submitted for
    // the undo; the PM without BOQ read was told nothing of the bill's rows.
    const notices = async (userId) =>
      prisma.notification.count({ where: { orgId: live.org.id, recipientUserId: userId, entityType: "activity_boq_allocation", event: "workflow.submitted" } });
    for (const reader of readers) expect([reader.id, await notices(reader.id)]).toEqual([reader.id, ROWS]);
    expect(await prisma.notification.count({ where: { orgId: live.org.id, recipientUserId: withoutBoq.id, entityType: "activity_boq_allocation" } })).toBe(0);
  });
});
