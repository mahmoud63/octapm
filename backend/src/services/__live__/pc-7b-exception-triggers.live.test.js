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
 *   - A progress approval and a change-order approval, each the ONLY call made
 *     through the enabled API on a project built through the disabled one, ask
 *     for exactly one job for that project (their bursts of record.changed /
 *     approval.decided events debounced); the progress job opens the two
 *     quantity rows, the change-order job clears them ('cleared').
 *   - Trigger 2: the scheduled tick, limited to the two LiveTest organisations,
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
    return { itemId: item.body.data.item.id, activityId: activity.body.data.id, allocationId: allocation.body.data.id };
  };

  // Mapped through `api`, the activity measured by quantity, and 12 m3 recorded
  // against the 10 m3 allocation in a progress submission NOT yet approved.
  const overInstallThrough = async (api, who, key) => {
    const auth = { authorization: `Bearer ${who.token}` };
    const at = (route) => `/api/v1/projects/${projects[key].id}${route}`;
    const mapped = await mapThrough(api, who, key);
    ok(`${key} method`, await api.request("PUT", at(`/activities/${mapped.activityId}/progress-method`), { body: { method: "quantity" }, headers: auth }));
    const entry = await api.post(at("/quantity-progress"), { status: "submitted", activityId: mapped.activityId, boqItemId: mapped.itemId, quantity: 12, date: "2026-09-20", clientRequestId: `trig-${key}-${Date.now()}` }, auth);
    ok(`${key} entry`, entry, 201);
    const submission = await api.post(at(`/activities/${mapped.activityId}/progress`), { method: "quantity", entryIds: [entry.body.data.entry.id] }, auth);
    ok(`${key} submission`, submission);
    return { ...mapped, approveRoute: at(`/activities/${mapped.activityId}/progress-submissions/${submission.body.data.submission.id}/approve`) };
  };
  const kindsOf = async (projectId, where = {}) =>
    (await prisma.projectException.findMany({ where: { projectId, ...where } })).map((row) => [row.kind, row.resolvedReason]).sort();
  // A job evaluates the WHOLE registry — since the merge the §7 data-quality
  // rules too (proven in pc-7b-data-quality.live.test.js), which find their
  // own rows on these bare projects. This suite is about the triggers and the
  // §1 quantity rows: it states those exactly, and holds every count the job
  // reports to the rows it actually wrote or resolved.
  const OVERRUN_KINDS = new Set(require("../exception-rules").getRules().filter((rule) => rule.file !== "data-quality.js").map((rule) => rule.kind));
  const overrunKindsOf = async (projectId) => (await kindsOf(projectId)).filter(([kind]) => OVERRUN_KINDS.has(kind));
  const tally = async (projectId) => ({
    rows: await prisma.projectException.count({ where: { projectId } }),
    resolved: await prisma.projectException.count({ where: { projectId, resolvedAt: { not: null } } }),
  });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    for (const [key, org] of [["A", live], ["B", other], ["OFF", live], ["PROG", live], ["CO", live]]) {
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
    expect(result).toMatchObject({ projectId: projects.A.id, orgId: live.org.id, trigger: "event", errors: [] });
    const rows = await prisma.projectException.findMany({ where: { orgId: { in: [live.org.id, other.org.id] } } });
    // Every row written is A's, and the job reports each of them.
    expect([...new Set(rows.map((row) => row.projectId))]).toEqual([projects.A.id]);
    expect(result.opened).toBe(rows.length);
    expect(rows.filter((row) => OVERRUN_KINDS.has(row.kind)).map((row) => [row.projectId, row.kind]).sort()).toEqual([
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

  it("a progress approval and a change-order approval through the enabled API each ask for exactly one job; the jobs open, then clear, the quantity rows", async () => {
    process.env.EXCEPTIONS_ENGINE_ENABLED = "true";
    const auth = { authorization: `Bearer ${live.token}` };
    const runJobOf = async (projectId) => {
      const jobs = await jobsOf(projectId);
      expect(jobs).toHaveLength(1);
      const [job] = jobs;
      expect([job.orgId, job.projectId, job.status, job.payloadJson.trigger]).toEqual([live.org.id, projectId, "queued", "event"]);
      return engine.runEvaluationJob({ job: { id: job.id, orgId: job.orgId, projectId: job.projectId, payload: job.payloadJson } });
    };

    // Progress: everything built through the disabled API, only the approval through the enabled one.
    const prog = await overInstallThrough(disabledApi, live, "PROG");
    expect(await jobsOf(projects.PROG.id)).toEqual([]);
    ok("PROG approve", await enabledApi.post(prog.approveRoute, {}, auth));
    await waitForJobs(projects.PROG.id, 1);
    await sleep(1500);
    const progResult = await runJobOf(projects.PROG.id);
    expect(progResult).toMatchObject({ projectId: projects.PROG.id, trigger: "event", errors: [] });
    expect(progResult.opened).toBe((await tally(projects.PROG.id)).rows);
    expect(await overrunKindsOf(projects.PROG.id)).toEqual([["quantity_over_allocation", null], ["quantity_over_boq", null]]);

    // Change order: the over-installation approved and evaluated without the trigger, then the order approved through the enabled API.
    const co = await overInstallThrough(disabledApi, live, "CO");
    ok("CO progress approve", await disabledApi.post(co.approveRoute, {}, auth));
    const seeded = await engine.evaluateProject({ orgId: live.org.id, projectId: projects.CO.id, trigger: "test", logger: { log: () => {} } });
    expect([seeded.opened, seeded.errors]).toEqual([(await tally(projects.CO.id)).rows, []]);
    expect(await overrunKindsOf(projects.CO.id)).toEqual([["quantity_over_allocation", null], ["quantity_over_boq", null]]);
    const at = (route) => `/api/v1/projects/${projects.CO.id}${route}`;
    const order = await disabledApi.post(at("/change-orders"), {
      description: "LiveTest trigger extension",
      category: "variation",
      value: 500,
      scheduleImpactSummary: "LiveTest none",
      costImpactSummary: "LiveTest priced",
      allocationLinks: [{ allocationId: co.allocationId, quantity: 5, amount: 500 }],
      activityLinks: [{ activityId: co.activityId, relationType: "affected", scheduleImpactDays: 0 }],
      attachmentRefs: [{ fileName: "LiveTest proof.pdf", fileUrl: "https://example.test/proof.pdf" }],
    }, auth);
    ok("CO create", order, 201);
    ok("CO submit", await disabledApi.post(at(`/change-orders/${order.body.data.id}/submit`), {}, auth));
    expect(await jobsOf(projects.CO.id)).toEqual([]);
    ok("CO approve", await enabledApi.post(at(`/change-orders/${order.body.data.id}/approve`), { comment: "LiveTest" }, auth));
    await waitForJobs(projects.CO.id, 1);
    await sleep(1500);
    const coBefore = await tally(projects.CO.id);
    const coResult = await runJobOf(projects.CO.id);
    expect(coResult).toMatchObject({ projectId: projects.CO.id, trigger: "event", errors: [] });
    const coAfter = await tally(projects.CO.id);
    // Resolved = cleared + not comparable (both stamp resolvedAt).
    expect([coResult.opened, coResult.resolved + coResult.notComparable]).toEqual([coAfter.rows - coBefore.rows, coAfter.resolved - coBefore.resolved]);
    expect(coResult.resolved).toBeGreaterThanOrEqual(2);
    expect(await overrunKindsOf(projects.CO.id)).toEqual([["quantity_over_allocation", "cleared"], ["quantity_over_boq", "cleared"]]);
    expect(await othersJobCount([live.org.id, other.org.id])).toBe(othersBefore);
  });

  it("the scheduled tick, limited to the LiveTest organisations: queued projects skipped, one job per other active project, nobody else touched", async () => {
    const orgIds = [live.org.id, other.org.id];
    let result = await runExceptionTick({ orgIds });
    // A, B, PROG and CO still have their event jobs queued; OFF has none.
    expect(result).toEqual({ orgs: 2, projects: 5, queued: 1, skipped: 4 });
    const offJobs = await jobsOf(projects.OFF.id);
    expect(offJobs.map((job) => [job.orgId, job.status, job.payloadJson.trigger])).toEqual([[live.org.id, "queued", "scheduled"]]);
    // Once a project's jobs have run, the tick queues it again; still one per project.
    await prisma.backgroundJob.updateMany({ where: { orgId: { in: orgIds }, type: TYPE }, data: { status: "succeeded" } });
    result = await runExceptionTick({ orgIds });
    expect(result).toEqual({ orgs: 2, projects: 5, queued: 5, skipped: 0 });
    for (const key of ["A", "B", "OFF", "PROG", "CO"])expect((await jobsOf(projects[key].id)).filter((job) => job.status === "queued")).toHaveLength(1);
    expect(await othersJobCount(orgIds)).toBe(othersBefore);
  });
});
