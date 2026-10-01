/**
 * An NCR reference is one record's per project — a typed reference never
 * collides with the generated sequence (PC-7b schema, fixer finding 1).
 *
 * Migration 20261005060100_record_ref_uniques adds NcrRecord_projectId_ref_key.
 * POST /ncr takes an optional typed `ref`, and the generator (ReferenceCounter)
 * reads the register only to seed itself, then advances blindly. So a typed
 * "NCR-003" followed by the auto-numbered create that reaches 3:
 *   - before the migration, silently saved a second NCR-002;
 *   - after it, answered a generic 409 CONFLICT to a caller who typed no ref.
 *
 * What must hold, with or without the unique index:
 *   - an auto-numbered create skips a reference already taken in the project
 *     and answers 201 with the next free one — never a duplicate, never 409;
 *   - a typed reference already used in the project is refused 409
 *     NCR_REF_TAKEN (trimmed first), and nothing is written;
 *   - the same typed reference in another project, and a hand-written one,
 *     are admitted.
 *
 * Run it on the shared database (no unique index yet) and on a throwaway one
 * with every migration deployed (the index present):
 *
 *   npm run test:live -- src/services/__live__/pc-7b-ncr-ref-taken.live.test.js
 *   node scripts/db/live-on-migtest.js src/services/__live__/pc-7b-ncr-ref-taken.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("POST /ncr: a reference is never handed out twice in a project", () => {
  let live;
  let api;
  let project;
  let other;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const create = (projectId, body = {}) =>
    api.post(`/api/v1/projects/${projectId}/ncr`, { severity: "minor", description: "LiveTest NCR", ...body }, auth());
  const refsOf = async (projectId) =>
    (await prisma.ncrRecord.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { ref: true } })).map((row) => row.ref);

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "2", REQUEST_LOG_FORMAT: "off" }, { appOnly: true });
    const make = (name) =>
      prisma.project.create({ data: { orgId: live.org.id, currency: "USD", name, startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") } });
    project = await make("LiveTest NCR refs");
    other = await make("LiveTest NCR refs (other)");
  }, 120_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent", "outboundEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("an auto-numbered create skips a reference someone typed, and a typed duplicate is refused NCR_REF_TAKEN", async () => {
    const first = await create(project.id);
    expect([first.status, first.body?.error, first.body?.data?.ref]).toEqual([201, undefined, "NCR-001"]);

    // Typed in the generated shape, ahead of the counter. A typed create takes no number from the counter.
    const typed = await create(project.id, { ref: "NCR-003" });
    expect([typed.status, typed.body?.error, typed.body?.data?.ref]).toEqual([201, undefined, "NCR-003"]);

    const second = await create(project.id);
    expect([second.status, second.body?.error?.code, second.body?.data?.ref]).toEqual([201, undefined, "NCR-002"]);
    // The counter reaches 3: the caller typed nothing and gets the next free reference.
    const next = await create(project.id);
    expect([next.status, next.body?.error?.code, next.body?.data?.ref]).toEqual([201, undefined, "NCR-004"]);
    expect(await refsOf(project.id)).toEqual(["NCR-001", "NCR-003", "NCR-002", "NCR-004"]);

    // A typed reference already used here — padded with spaces — is refused by name; nothing is written.
    const taken = await create(project.id, { ref: "  NCR-004 " });
    expect([taken.status, taken.body?.success, taken.body?.error?.code]).toEqual([409, false, "NCR_REF_TAKEN"]);
    expect(taken.body.error.message).toBe("NCR-004 is already used by another NCR in this project.");
    expect(taken.text).not.toMatch(/prisma|P2002|constraint/i);
    expect(await refsOf(project.id)).toEqual(["NCR-001", "NCR-003", "NCR-002", "NCR-004"]);

    // The sequence carries on after the refusal.
    const after = await create(project.id);
    expect([after.status, after.body?.data?.ref]).toEqual([201, "NCR-005"]);
  });

  it("a run of typed references ahead of the counter is skipped as a whole", async () => {
    for (const ref of ["NCR-006", "NCR-007", "NCR-008"]) {
      const answer = await create(project.id, { ref });
      expect([answer.status, answer.body?.data?.ref]).toEqual([201, ref]);
    }
    const next = await create(project.id);
    expect([next.status, next.body?.error?.code, next.body?.data?.ref]).toEqual([201, undefined, "NCR-009"]);
    const refs = await refsOf(project.id);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("the same typed reference in another project, and a hand-written one, are admitted", async () => {
    const elsewhere = await create(other.id, { ref: "NCR-003" });
    expect([elsewhere.status, elsewhere.body?.data?.ref]).toEqual([201, "NCR-003"]);
    const handWritten = await create(project.id, { ref: "NCR-SITE-A" });
    expect([handWritten.status, handWritten.body?.data?.ref]).toEqual([201, "NCR-SITE-A"]);
    const again = await create(project.id, { ref: "NCR-SITE-A" });
    expect([again.status, again.body?.error?.code]).toEqual([409, "NCR_REF_TAKEN"]);
    // The other project's own sequence is seeded from its register, so it continues after the typed 3.
    for (const expected of ["NCR-004", "NCR-005"]) {
      const answer = await create(other.id);
      expect([answer.status, answer.body?.data?.ref]).toEqual([201, expected]);
    }
  });
});
