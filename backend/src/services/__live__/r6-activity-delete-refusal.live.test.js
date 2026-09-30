/**
 * DELETE /projects/:id/activities/:activityId never answers 500 — proven
 * against a real API process and the real local Postgres (Round 6 residual,
 * api item 2).
 *
 * A reviewer reported the delete answering 500 INTERNAL_ERROR for an activity
 * of an imported, approved and activated revision. Reproduced: activation
 * writes a CostRecord per activated activity, and CostRecord.activityId is
 * ON DELETE RESTRICT (as are ActivityProgress and DailyReport), so the raw
 * delete hit the constraint (Prisma P2003) and the error handler had no
 * answer but 500.
 *
 * In a throwaway "LiveTest <uuid>" organisation, a two-activity P6 XER is
 * imported, submitted, approved and activated. Two API processes: one under
 * NODE_ENV=production, so an unhandled error is exactly what a client would
 * see (500 INTERNAL_ERROR) and the refusal is what production answers (code
 * and message; production drops details by design), and one in development,
 * where the details are answered too.
 *
 * - An activity of the active schedule: 409 ACTIVITY_IN_USE, naming the cost
 *   record that keeps it and the schedule revision as the way out; the
 *   activity, its cost record and its logic tie are exactly as they were.
 * - A manually created activity with nothing linked: deleted (200), as
 *   before.
 * - A manually created activity with a daily report: 409 ACTIVITY_IN_USE
 *   naming the daily report; the report stays.
 *
 *   npm run test:live -- src/services/__live__/r6-activity-delete-refusal.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const XER = [
  "ERMHDR\t19.12",
  "%T\tPROJWBS",
  "%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num",
  "%R\tW1\t\tCIV\tCivil\t1",
  "%T\tTASK",
  "%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct",
  "%R\tT1\tG100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0",
  "%R\tT2\tG200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0",
  "%T\tTASKPRED",
  "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
  "%R\tP1\tT2\tT1\tPR_FS\t0",
  "%E",
  "",
].join("\n");

const CODE = "ACTIVITY_IN_USE";

liveDescribe("DELETE /activities/:id answers a structured refusal, never 500, for an activity that records keep", () => {
  let live;
  let api;
  let dev;
  let project;
  let revisionId;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const remove = (activityId, server = api) => server.request("DELETE", at(`/activities/${activityId}`), { headers: auth() });
  const footprint = async (activityId) =>
    JSON.stringify({
      activity: await prisma.activity.findUnique({ where: { id: activityId } }),
      costRecords: await prisma.costRecord.findMany({ where: { activityId }, orderBy: { id: "asc" } }),
      dependencies: await prisma.activityDependency.count({ where: { OR: [{ predecessorId: activityId }, { successorId: activityId }] } }),
      dailyReports: await prisma.dailyReport.count({ where: { activityId } }),
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    // Production error handling: an unhandled error is 500 INTERNAL_ERROR
    // to the client, exactly what the reviewer saw.
    api = await startApi(
      {
        NODE_ENV: "production",
        CORS_ALLOWED_ORIGINS: "https://app.octapm-live.test",
        REQUEST_LOG_FORMAT: "off",
        CLOUDFRONT_SHARED_SECRET: "",
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        RATE_LIMIT_UPLOAD_MAX: "1000",
        DATABASE_CONNECTION_LIMIT: "4",
      },
      { appOnly: true },
    );
    dev = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "2" }, { appOnly: true });
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest activity delete", startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const form = new FormData();
    form.append("file", new Blob([XER], { type: "application/octet-stream" }), "schedule.xer");
    const imported = await fetch(`${api.base}${at("/import/xer")}`, { method: "POST", headers: auth(), body: form });
    const body = await imported.json();
    expect([imported.status, body?.error, body?.data?.staged]).toEqual([201, undefined, true]);
    revisionId = body.data.revisionId;
    for (const step of ["submit-review", "approve"]) ok(await api.post(at(`/schedule/revisions/${revisionId}/${step}`), {}, auth()));
    ok(await api.post(at(`/schedule/revisions/${revisionId}/activate`), { mappings: [] }, auth()));
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (dev) await dev.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("an activity of the imported, approved and activated revision: 409 ACTIVITY_IN_USE naming the cost record, nothing changed", async () => {
    const active = await prisma.activity.findMany({ where: { projectId: project.id, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, p6ActivityId: true } });
    expect(active.map((row) => row.p6ActivityId)).toEqual(["G100", "G200"]);
    const [excavate] = active;
    // What activation wrote: one cost record per activated activity.
    expect(await prisma.costRecord.count({ where: { activityId: excavate.id } })).toBe(1);
    const before = await footprint(excavate.id);

    const answer = await remove(excavate.id);
    const { requestId, ...error } = answer.body?.error || {};
    expect([answer.status, answer.body?.success]).toEqual([409, false]);
    const message = "Activity G100 cannot be deleted: 1 cost record is linked to it. Records stay on their activity; take it out of the programme through a schedule revision instead.";
    // Production: the code and the message; details are dropped by design.
    expect(error).toEqual({ code: CODE, message });
    expect(await footprint(excavate.id)).toBe(before);
    // Development: the details name what keeps it.
    const detailed = await remove(excavate.id, dev);
    expect([detailed.status, detailed.body?.error?.code, detailed.body?.error?.message, detailed.body?.error?.details]).toEqual([
      409,
      CODE,
      message,
      { activityId: excavate.id, activityCode: "G100", partOfActiveSchedule: true, keptBy: { costRecords: 1, progress: 0, dailyReports: 0 } },
    ]);
    expect(await footprint(excavate.id)).toBe(before);
    expect(await prisma.activity.count({ where: { projectId: project.id, isActive: true } })).toBe(2);
    // No Prisma text reached the client, and no 500 was logged.
    expect(answer.text).not.toMatch(/prisma|P2003|constraint/i);
    expect(api.proc.output()).not.toMatch(/P2003|INTERNAL_ERROR/);
  });

  it("a manually created activity with nothing linked is deleted; one with a daily report is refused naming the report", async () => {
    const create = async (activityCode, name) => {
      const answer = await api.post(at("/activities"), { engineerIds: [live.user.id], name, activityCode, duration: 2, startDate: "2026-03-02", endDate: "2026-03-03" }, auth());
      ok(answer, 201);
      return answer.body.data.id;
    };
    const free = await create("M100", "Snag list");
    const kept = await create("M200", "Site clearance");
    await prisma.dailyReport.create({
      data: { projectId: project.id, activityId: kept, engineerId: live.user.id, date: new Date("2026-03-02"), notes: "LiveTest daily report" },
    });

    const deleted = await remove(free);
    ok(deleted);
    expect(deleted.body.data).toEqual({ deleted: true });
    expect(await prisma.activity.findUnique({ where: { id: free } })).toBeNull();

    const before = await footprint(kept);
    const refused = await remove(kept, dev);
    const { requestId, ...error } = refused.body?.error || {};
    expect([refused.status, error.code, error.details]).toEqual([
      409,
      CODE,
      { activityId: kept, activityCode: "M200", partOfActiveSchedule: true, keptBy: { costRecords: 0, progress: 0, dailyReports: 1 } },
    ]);
    expect(error.message).toBe("Activity M200 cannot be deleted: 1 daily report is linked to it. Records stay on their activity; take it out of the programme through a schedule revision instead.");
    expect(await footprint(kept)).toBe(before);
  });
});
