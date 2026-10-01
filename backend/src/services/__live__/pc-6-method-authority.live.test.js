/**
 * PC-6 (integration) — the submission's method is the ACTIVITY'S, never the
 * client's, proven against a real API process and the real local Postgres.
 *
 * The review finding: the client picked the submission's method, so on a
 * quantity-configured activity a submitter could send { method: 'percent',
 * pctComplete: 90 } and bypass the whole PC-6 derivation — the approver then
 * approved a 90% row with zero entries behind it.
 *
 * In a throwaway "LiveTest <uuid>" organisation: a bill of one row, a
 * programme of two activities — the pour (configured quantity; one approved
 * allocation of 100 m3) and the wall (never configured: measured by the
 * default) — a PM and a site engineer assigned to both.
 *
 * - a percent (or milestone) submission on the pour is 409
 *   PROGRESS_METHOD_MISMATCH naming both methods, on POST
 *   /activities/{id}/progress, on bulk-progress and on the daily report's
 *   legacy path; nothing is written and the EV report is byte-identical;
 * - a submission naming no method takes the activity's (quantity, derived
 *   from its entries); one naming the configured method is accepted;
 * - the wall, with no configured method, accepts the client's method as
 *   before.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run test:live -- src/services/__live__/pc-6-method-authority.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("PC-6: the submission's method is the activity's effective method", () => {
  let live;
  let api;
  let project;
  let concrete;
  let pour;
  let wall;
  let site;
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const refused = (answer, status, code) => expect([answer.status, answer.body?.error?.code]).toEqual([status, code]);

  const submit = async (activityId, payload, token = live.token) => api.post(at(`/activities/${activityId}/progress`), payload, bearer(token));
  const approve = async (activityId, submissionId, token = live.token) => api.post(at(`/activities/${activityId}/progress-submissions/${submissionId}/approve`), {}, bearer(token));
  const entry = async (payload, token = site.token) => {
    const answer = await api.post(at("/quantity-progress"), { status: "submitted", ...payload }, bearer(token));
    ok(answer, 201);
    return answer.body.data.entry;
  };
  const progressRows = async (activityId) => prisma.activityProgress.findMany({ where: { activityId }, orderBy: { updatedAt: "asc" } });
  const evReport = async () => {
    const answer = await api.get(at("/reports/ev"), bearer(live.token));
    ok(answer);
    const { reporting, ...rest } = answer.body.data;
    return JSON.stringify(rest);
  };
  const footprint = async () =>
    JSON.stringify({
      submissions: await prisma.progressSubmission.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
      progress: await prisma.activityProgress.findMany({ where: { activityId: { in: [pour.id, wall.id] } }, orderBy: { updatedAt: "asc" } }),
      reports: await prisma.dailyReport.count({ where: { projectId: project.id } }),
      entries: await prisma.quantityProgressEntry.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "4" }, { appOnly: true });
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-6 method authority", timezone: "America/Chicago", startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const tag = live.org.id.slice(0, 8);
    site = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest site", email: `live-site-ma-${tag}@octapm-live.test`, role: "site_engineer" });
    site.token = mintAccessToken(site);
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: site.id, role: "site_engineer", orgId: live.org.id } });

    const item = await api.post(at("/boq/items"), { code: "1.1", description: "Concrete in strip footings", quantity: 300, unit: "m3", rate: 100 }, bearer(live.token));
    ok(item, 201);
    concrete = item.body.data.item;
    const activity = async (payload) => {
      const created = await api.post(at("/activities"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data;
    };
    pour = await activity({ name: "Pour foundations", activityCode: "A100", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [live.user.id, site.id] });
    wall = await activity({ name: "Blockwork", activityCode: "A120", duration: 10, startDate: "2026-02-09", endDate: "2026-02-20", engineerIds: [live.user.id, site.id] });
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: concrete.id, activityId: pour.id, quantity: 100 }, bearer(live.token));
    ok(allocation, 201);
    for (const step of ["submit", "approve"]) ok(await api.post(at(`/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, bearer(live.token)));
    ok(await api.request("PUT", at(`/activities/${pour.id}/progress-method`), { body: { method: "quantity", quantityUnit: "m3" }, headers: bearer(live.token) }));
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  const ids = {};

  it("a percent submission on a quantity-configured activity is 409 PROGRESS_METHOD_MISMATCH on every path; nothing is written and EV is byte-identical", async () => {
    const evBefore = await evReport();
    const before = await footprint();
    const direct = await submit(pour.id, { method: "percent", pctComplete: 90 }, site.token);
    refused(direct, 409, "PROGRESS_METHOD_MISMATCH");
    expect(direct.body.error.details).toEqual({ activityId: pour.id, effectiveMethod: "quantity", effectiveMethodBasis: "method_config", requestedMethod: "percent" });
    expect(direct.body.error.message).toMatch(/measured by quantity; a percent submission is not recorded against it/);
    refused(await submit(pour.id, { progressMethod: "percent", pctComplete: 90 }), 409, "PROGRESS_METHOD_MISMATCH");
    refused(await submit(pour.id, { method: "weighted_milestone", milestones: [{ id: "a", weight: 100, complete: true }] }), 409, "PROGRESS_METHOD_MISMATCH");
    refused(await submit(pour.id, { method: "manual", pctComplete: 50, notes: "typed" }), 409, "PROGRESS_METHOD_MISMATCH");
    // bulk-progress: the same writer, the same answer.
    refused(await api.post(at("/activities/bulk-progress"), { updates: [{ activityId: pour.id, method: "percent", pctComplete: 90 }] }, bearer(site.token)), 409, "PROGRESS_METHOD_MISMATCH");
    // The daily report's legacy path names percent for its pctProgress: refused on the pour, the report not kept either.
    const report = await api.post(at("/daily-reports"), { activityId: pour.id, date: "2026-02-03", pctProgress: 90, notes: "LiveTest" }, bearer(site.token));
    refused(report, 409, "PROGRESS_METHOD_MISMATCH");
    expect(await footprint()).toBe(before);
    expect(await evReport()).toBe(evBefore);
    expect(await prisma.progressSubmission.count({ where: { projectId: project.id } })).toBe(0);
    expect(await progressRows(pour.id)).toHaveLength(0);
  });

  it("a submission naming no method takes the activity's (quantity, derived from its entries); naming the configured method is accepted", async () => {
    ids.e1 = (await entry({ activityId: pour.id, boqItemId: concrete.id, quantity: 25, date: "2026-02-03", clientRequestId: "ma-1" })).id;
    const unnamed = await submit(pour.id, { entryIds: [ids.e1], pctComplete: 90 }, site.token);
    ok(unnamed, 200);
    expect(unnamed.body.data.submission).toMatchObject({ method: "quantity", pctComplete: 25, quantityComplete: 25, quantityPlanned: 100, quantity: { plannedBasis: "approved_allocations", installedBasis: "approved_entries" } });
    ids.s1 = unnamed.body.data.submission.id;
    ok(await approve(pour.id, ids.s1));
    expect(await progressRows(pour.id)).toHaveLength(1);
    expect((await progressRows(pour.id))[0]).toMatchObject({ progressMethod: "quantity", pctComplete: 25, quantityComplete: 25 });
    ids.e2 = (await entry({ activityId: pour.id, boqItemId: concrete.id, quantity: 15, date: "2026-02-04", clientRequestId: "ma-2" })).id;
    const named = await submit(pour.id, { method: "quantity", entryIds: [ids.e2] }, site.token);
    ok(named, 200);
    expect(named.body.data.submission).toMatchObject({ method: "quantity", pctComplete: 40, quantityComplete: 40 });
    // Still refused after official progress exists: the configured method, not the client's.
    refused(await submit(pour.id, { method: "percent", pctComplete: 90 }), 409, "PROGRESS_METHOD_MISMATCH");
    expect(await progressRows(pour.id)).toHaveLength(1);
  });

  it("an activity with no configured method accepts the client's method as before", async () => {
    expect(await prisma.activityProgressMethod.findFirst({ where: { activityId: wall.id } })).toBeNull();
    const pct = await submit(wall.id, { method: "percent", pctComplete: 40 }, site.token);
    ok(pct, 200);
    expect(pct.body.data.submission).toMatchObject({ method: "percent", pctComplete: 40 });
    const manual = await submit(wall.id, { method: "manual", pctComplete: 45, notes: "typed with reason" }, site.token);
    ok(manual, 200);
    expect(manual.body.data.submission).toMatchObject({ method: "manual", pctComplete: 45 });
    const bulk = await api.post(at("/activities/bulk-progress"), { updates: [{ activityId: wall.id, pctComplete: 50 }] }, bearer(site.token));
    ok(bulk, 200);
    expect(bulk.body.data.submissions[0]).toMatchObject({ method: "percent", pctComplete: 50 });
    // The legacy daily report on the wall: a percent submission linked to it, as before.
    const report = await api.post(at("/daily-reports"), { activityId: wall.id, date: "2026-02-10", pctProgress: 55, notes: "LiveTest" }, bearer(site.token));
    ok(report, 201);
    expect(await prisma.progressSubmission.findFirst({ where: { dailyReportId: report.body.data.id } })).toMatchObject({ method: "percent", pctComplete: 55, source: "daily_report" });
  });
});
