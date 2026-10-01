/**
 * PC-7b — the exception engine's two triggers, against real API processes
 * and the real local Postgres (OCTAPM_CHANGE_INTELLIGENCE.md §6).
 *
 *   - Trigger 1: an API started from src/index.js with
 *     EXCEPTIONS_ENGINE_ENABLED=true subscribes to the domain events. An
 *     allocation approved through it (approval.decided) asks for ONE
 *     'exceptions.evaluate' job for that project — the burst of create /
 *     submit / approve is debounced into one queued job, due 30 s later — and
 *     a job for the second organisation's project carries that organisation.
 *     An API started with EXCEPTIONS_ENGINE_ENABLED=false queues nothing.
 *   - The job handler evaluates the job's own project and writes that
 *     project's rows only.
 *   - Trigger 2: the nightly tick, limited to the two LiveTest organisations,
 *     skips a project whose evaluation is queued and otherwise queues one per
 *     active project; no other organisation's job count moves.
 *
 * Neither trigger is ever run against a durable organisation: the APIs
 * started here run no scheduler and no job worker (the live kit's defaults),
 * the tick is given the LiveTest organisations only, and the handler is
 * called with the jobs this test made.
 *
 *   npm run test:live -- src/services/__live__/pc-7b-exception-triggers.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe, sleep } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const engine = require("../exception-engine.service");
const { runExceptionTick } = require("../../jobs/exception-scheduler");

const TYPE = "exceptions.evaluate";

liveDescribe("PC-7b: domain events and the nightly tick ask for debounced evaluations of the right project only", () => {
  let live;
  let other;
  let enabledApi;
  let disabledApi;
  const projects = {};
  const savedFlag = process.env.EXCEPTIONS_ENGINE_ENABLED;
  const ok = (label, answer, status = 200) => expect([label, answer.status, answer.body?.error]).toEqual([label, status, undefined]);

  const jobsOf = (projectId) => prisma.backgroundJob.findMany({ where: { projectId, type: TYPE }, orderBy: { createdAt: "asc" } });
  const waitForJobs = async (projectId, count, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await jobsOf(projectId);
      if (rows.length >= count || Date.now() > deadline) return rows;
      await sleep(200);
    }
  };
  const othersJobCount = (orgIds) => prisma.backgroundJob.count({ where: { type: TYPE, orgId: { notIn: orgIds } } });

  // A mapped, over-installed-free BOQ row and activity, its allocation approved through `api`.
  const mapThrough = async (api, who, key) => {
    const auth = { authorization: `Bearer ${who.token}` };
    const at = (route) => `/api/v1/projects/${projects[key].id}${route}`;
    const item = await api.post(at("/boq/items"), { code: `T.${key}`, description: `LiveTest ${key}`, quantity: 10, unit: "m3", rate: 100 }, auth);
    ok(`${key} item`, item, 201);
    const activity = await api.post(at("/activities"), { engineerIds: [who.user.id], name: `LiveTest ${key}`, activityCode: `T${key}`, duration: 3, startDate: "2026-02-02", endDate: "2026-02-04" }, auth);
    ok(`${key} activity`, activity, 201);
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: item.body.data.item.id, activityId: activity.body.data.id, quantity: 10 }, auth);
    ok(`${key} allocation`, allocation, 201);
    for (const step of ["submit", "approve"]) ok(`${key} ${step}`, await api.post(at(`/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, auth));
    return { itemId: item.body.data.item.id, activityId: activity.body.data.id };
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    for (const [key, org] of [["A", live], ["B", other], ["OFF", live]]) {
      projects[key] = await prisma.project.create({ data: { orgId: org.org.id, currency: "USD", name: `LiveTest PC-7b triggers ${key}`, startDate: new Date("2026-01-05") } });
    }
    // Scheduler and worker stay off (the kit's defaults); only the subscriber differs.
    enabledApi = await startApi({ DATABASE_CONNECTION_LIMIT: "4", EXCEPTIONS_ENGINE_ENABLED: "true" });
    disabledApi = await startApi({ DATABASE_CONNECTION_LIMIT: "4", EXCEPTIONS_ENGINE_ENABLED: "false" });
  }, 180_000);

  afterAll(async () => {
    for (const api of [enabledApi, disabledApi]) if (api) await api.stop();
    if (savedFlag === undefined) delete process.env.EXCEPTIONS_ENGINE_ENABLED;
    else process.env.EXCEPTIONS_ENGINE_ENABLED = savedFlag;
    for (const org of [live, other]) {
      if (!org) continue;
      await prisma.projectException.deleteMany({ where: { orgId: org.org.id } }).catch(() => {});
      for (const model of ["backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  let othersBefore;

  it("the enabled API debounces a burst of allocation events into ONE queued job per project, each with its own organisation; the disabled API queues nothing", async () => {
    othersBefore = await othersJobCount([live.org.id, other.org.id]);
    expect(enabledApi.proc.output()).not.toMatch(/exception-triggers\] disabled/);
    expect(disabledApi.proc.output()).toMatch(/exception-triggers\] disabled by EXCEPTIONS_ENGINE_ENABLED=false/);

    const before = Date.now();
    await mapThrough(enabledApi, live, "A");
    await mapThrough(enabledApi, other, "B");
    await mapThrough(disabledApi, live, "OFF");

    const jobsA = await waitForJobs(projects.A.id, 1);
    const jobsB = await waitForJobs(projects.B.id, 1);
    // Let any late event land before counting.
    await sleep(1500);
    expect((await jobsOf(projects.A.id)).length).toBe(1);
    expect((await jobsOf(projects.B.id)).length).toBe(1);
    expect(await jobsOf(projects.OFF.id)).toEqual([]);
    const [jobA] = jobsA;
    const [jobB] = jobsB;
    expect([jobA.orgId, jobA.projectId, jobA.status, jobA.payloadJson.trigger]).toEqual([live.org.id, projects.A.id, "queued", "event"]);
    expect([jobB.orgId, jobB.projectId, jobB.status]).toEqual([other.org.id, projects.B.id, "queued"]);
    expect(jobA.payloadJson.reason).toMatch(/^(approval\.decided|record\.changed):/);
    // Due DEBOUNCE_MS after the first request asked for it.
    expect(jobA.runAfter.getTime() - jobA.createdAt.getTime()).toBeGreaterThanOrEqual(engine.DEBOUNCE_MS - 1000);
    expect(jobA.runAfter.getTime()).toBeGreaterThan(before);
    expect(await othersJobCount([live.org.id, other.org.id])).toBe(othersBefore);
  });

  it("the job handler evaluates the job's own project and writes that project's rows only", async () => {
    process.env.EXCEPTIONS_ENGINE_ENABLED = "true";
    const [job] = await jobsOf(projects.A.id);
    // An over-installation makes the evaluation find something: approved entries seeded on A (LiveTest).
    const allocation = await prisma.activityBoqAllocation.findFirst({ where: { projectId: projects.A.id } });
    await prisma.activityProgressMethod.create({ data: { projectId: projects.A.id, activityId: allocation.activityId, method: "quantity" } });
    await prisma.quantityProgressEntry.create({
      data: { orgId: live.org.id, projectId: projects.A.id, activityId: allocation.activityId, boqItemId: allocation.boqItemId, allocationId: allocation.id, unitCode: "m3", quantity: 12, date: new Date("2026-09-20T00:00:00.000Z"), source: "manual", status: "approved", approvedBy: live.user.id, approvedAt: new Date(), createdBy: live.user.id, clientRequestId: `trig-${Date.now()}` },
    });
    const result = await engine.runEvaluationJob({ job: { id: job.id, orgId: job.orgId, projectId: job.projectId, payload: job.payloadJson } });
    expect(result).toMatchObject({ projectId: projects.A.id, orgId: live.org.id, trigger: "event", opened: 2, errors: [] });
    const rows = await prisma.projectException.findMany({ where: { orgId: { in: [live.org.id, other.org.id] } } });
    expect(rows.map((row) => [row.projectId, row.kind]).sort()).toEqual([
      [projects.A.id, "quantity_over_allocation"],
      [projects.A.id, "quantity_over_boq"],
    ]);
    // A job naming a project with another organisation is refused, nothing written.
    await expect(engine.runEvaluationJob({ job: { orgId: live.org.id, projectId: projects.B.id, payload: {} } })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.projectException.count({ where: { projectId: projects.B.id } })).toBe(0);
    // Disabled, the handler stands down.
    process.env.EXCEPTIONS_ENGINE_ENABLED = "false";
    expect(await engine.runEvaluationJob({ job })).toEqual({ skipped: "EXCEPTIONS_ENGINE_ENABLED=false" });
  });

  it("the nightly tick, limited to the LiveTest organisations: queued projects skipped, one job per other active project, nobody else touched", async () => {
    const orgIds = [live.org.id, other.org.id];
    let result = await runExceptionTick({ orgIds });
    expect(result).toEqual({ orgs: 2, projects: 3, queued: 1, skipped: 2 });
    const offJobs = await jobsOf(projects.OFF.id);
    expect(offJobs.map((job) => [job.orgId, job.status, job.payloadJson.trigger])).toEqual([[live.org.id, "queued", "nightly"]]);
    // Once a project's jobs have run, the tick queues it again; still one per project.
    await prisma.backgroundJob.updateMany({ where: { orgId: { in: orgIds }, type: TYPE }, data: { status: "succeeded" } });
    result = await runExceptionTick({ orgIds });
    expect(result).toEqual({ orgs: 2, projects: 3, queued: 3, skipped: 0 });
    for (const key of ["A", "B", "OFF"]) expect((await jobsOf(projects[key].id)).filter((job) => job.status === "queued")).toHaveLength(1);
    expect(await othersJobCount(orgIds)).toBe(othersBefore);
  });
});
