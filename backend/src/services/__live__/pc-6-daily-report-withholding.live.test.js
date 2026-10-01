/**
 * PC-6 — the legacy daily report (/daily-reports) under the BOQ-access rule,
 * proven against a real API process and the real local Postgres.
 *
 * A daily report carries the progress submissions linked to it. A quantity
 * submission states the typed installed quantity, the planned quantity (Σ
 * approved allocations — a figure of the bill) and its unit: the figures
 * GET /activities/{id}/progress-submissions withholds from a member who may
 * not read the BOQ. Every /daily-reports answer must withhold them the same
 * way (utils/boq-figures.js withheldDailyReport / withheldDailyReports).
 *
 * In a throwaway "LiveTest <uuid>" organisation: one BOQ row (concrete, 1500
 * m3 at 100), three activities measured by quantity with 400 m3 allocated
 * and approved on each, a site engineer and a PM each on a permission
 * template with boq: none. The site engineer creates (draft), edits and
 * submits a report on the pour typing 37 m3, and creates submitted reports
 * on the kerb (41 m3) and the slab (43 m3); the no-BOQ PM lists, reads,
 * approves the pour's, rejects the kerb's and reviews the slab's. Every
 * answer is swept: no quantity key, no unit code, none of the seeded figures
 * (37, 41, 43, 400, 1500) — the percentage, method, status and source stay,
 * and `boqWithheld` names what was omitted and why. The PM who reads the
 * BOQ is given the figures (the sweep has teeth).
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run test:live -- src/services/__live__/pc-6-daily-report-withholding.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const QUANTITY_KEYS = new Set(["quantityComplete", "quantityPlanned", "quantityUnit", "quantity", "quantities", "allocatedQuantity", "unitCode"]);
const SEEDED = new Set([37, 41, 43, 400, 1500]);

/** Every quantity key and every seeded figure an answer carries, wherever it sits. */
const sweep = (value, path = "$", found = []) => {
  if (Array.isArray(value)) value.forEach((item, index) => sweep(item, `${path}[${index}]`, found));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (key === "boqWithheld") continue;
      if (QUANTITY_KEYS.has(key)) found.push(`${path}.${key}`);
      sweep(inner, `${path}.${key}`, found);
    }
  } else if (typeof value === "number" && SEEDED.has(value)) found.push(`${path}=${value}`);
  else if (typeof value === "string" && /\bm3\b/.test(value)) found.push(`${path}="${value}"`);
  return found;
};

liveDescribe("PC-6: the legacy daily report withholds its submissions' quantities from a member who may not read the BOQ", () => {
  let live;
  let api;
  let project;
  let concrete;
  let pour;
  let kerb;
  let slab;
  const members = {};
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);

  /** One answer as a member without boq:read receives it: linked submissions present, no figure of the bill. */
  const withheld = (answer, status = 200) => {
    ok(answer, status);
    const reports = Array.isArray(answer.body.data) ? answer.body.data : [answer.body.data];
    expect(reports.length).toBeGreaterThan(0);
    for (const report of reports) {
      expect(report.progressSubmissions.length).toBeGreaterThan(0);
      for (const submission of report.progressSubmissions) {
        expect(submission).toMatchObject({ method: "quantity", source: "daily_report", pctComplete: expect.any(Number) });
        expect(submission.boqWithheld).toEqual({ keys: expect.arrayContaining(["quantityComplete", "quantityPlanned", "quantityUnit"]), reason: expect.stringContaining("only to members who may read the BOQ") });
      }
    }
    expect(sweep(answer.body.data)).toEqual([]);
    return answer.body.data;
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "4" }, { appOnly: true });
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-6 daily-report withholding", timezone: "America/Chicago", startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const tag = live.org.id.slice(0, 8);
    for (const [key, role] of [["site", "site_engineer"], ["pm", "pm"]]) {
      const member = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}, no BOQ`, email: `live-drw-${key}-${tag}@octapm-live.test`, role });
      member.token = mintAccessToken(member);
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      const template = await prisma.permissionTemplate.create({
        data: { orgId: live.org.id, name: `LiveTest ${role}, no BOQ ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } },
      });
      await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id } });
      members[key] = member;
    }
    const item = await api.post(at("/boq/items"), { code: "1.1", description: "Concrete in strip footings", quantity: 1500, unit: "m3", rate: 100 }, bearer(live.token));
    ok(item, 201);
    concrete = item.body.data.item;
    const activity = async (payload) => {
      const created = await api.post(at("/activities"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data;
    };
    const engineerIds = [live.user.id, members.site.id, members.pm.id];
    pour = await activity({ name: "Pour foundations", activityCode: "A100", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds });
    kerb = await activity({ name: "Kerbs", activityCode: "A110", duration: 2, startDate: "2026-02-09", endDate: "2026-02-10", engineerIds });
    slab = await activity({ name: "Ground slab", activityCode: "A120", duration: 4, startDate: "2026-02-16", endDate: "2026-02-19", engineerIds });
    for (const row of [pour, kerb, slab]) {
      const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: concrete.id, activityId: row.id, quantity: 400 }, bearer(live.token));
      ok(allocation, 201);
      for (const step of ["submit", "approve"]) ok(await api.post(at(`/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, bearer(live.token)));
      ok(await api.request("PUT", at(`/activities/${row.id}/progress-method`), { body: { method: "quantity", quantityUnit: "m3" }, headers: bearer(live.token) }));
    }
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
  const report = (activityId, typed, status, token = members.site.token) =>
    api.post(at("/daily-reports"), { activityId, date: "2026-02-03", status, notes: "LiveTest", progress: { method: "quantity", quantityComplete: typed } }, bearer(token));

  it("create, update and submit: the site engineer without boq:read is answered with the linked submission's percentage and method, never its typed, planned or unit figures", async () => {
    const created = withheld(await report(pour.id, 37, "draft"), 201);
    ids.pour = created.id;
    expect(created.progressSubmissions[0]).toMatchObject({ status: "draft", pctComplete: 9.25 });
    // The database holds the figures: the answer omitted them, nothing zeroed them.
    expect(await prisma.progressSubmission.findFirst({ where: { dailyReportId: ids.pour } })).toMatchObject({ quantityComplete: 37, quantityPlanned: 400, quantityUnit: "m3" });
    withheld(await api.request("PATCH", at(`/daily-reports/${ids.pour}`), { body: { notes: "LiveTest edited" }, headers: bearer(members.site.token) }));
    withheld(await api.post(at(`/daily-reports/${ids.pour}/submit`), {}, bearer(members.site.token)));
    ids.kerb = withheld(await report(kerb.id, 41, "submitted"), 201).id;
    ids.slab = withheld(await report(slab.id, 43, "submitted"), 201).id;
  });

  it("list and get: neither the site engineer nor the PM without boq:read receives a quantity; the PM who reads the BOQ receives them all", async () => {
    for (const member of [members.site, members.pm]) {
      expect(withheld(await api.get(at("/daily-reports"), bearer(member.token)))).toHaveLength(3);
      withheld(await api.get(at(`/daily-reports?activityId=${pour.id}`), bearer(member.token)));
      for (const id of [ids.pour, ids.kerb, ids.slab]) withheld(await api.get(at(`/daily-reports/${id}`), bearer(member.token)));
    }
    // The sweep has teeth: the BOQ reader's answer carries every seeded figure.
    const full = await api.get(at("/daily-reports"), bearer(live.token));
    ok(full);
    expect(sweep(full.body.data).length).toBeGreaterThan(0);
    const pourReport = full.body.data.find((row) => row.id === ids.pour);
    expect(pourReport.progressSubmissions[0]).toMatchObject({ quantityComplete: 37, quantityPlanned: 400, quantityUnit: "m3" });
    expect(pourReport.progressSubmissions[0].boqWithheld).toBeUndefined();
    const one = await api.get(at(`/daily-reports/${ids.kerb}`), bearer(live.token));
    ok(one);
    expect(one.body.data.progressSubmissions[0]).toMatchObject({ quantityComplete: 41, quantityPlanned: 400 });
  });

  it("approve, reject and review: the PM without boq:read is answered without the figures; the approval is official through the one writer", async () => {
    const approved = withheld(await api.post(at(`/daily-reports/${ids.pour}/approve`), {}, bearer(members.pm.token)));
    expect(approved.status).toBe("approved");
    expect(approved.progressSubmissions[0]).toMatchObject({ status: "approved", pctComplete: 9.25 });
    expect(await prisma.activityProgress.findFirst({ where: { activityId: pour.id } })).toMatchObject({ pctComplete: 9.25, quantityComplete: 37, status: "approved" });
    // Approving an approved report answers the same way (the idempotent path).
    withheld(await api.post(at(`/daily-reports/${ids.pour}/approve`), {}, bearer(members.pm.token)));
    const rejected = withheld(await api.post(at(`/daily-reports/${ids.kerb}/reject`), { reason: "LiveTest wrong pour" }, bearer(members.pm.token)));
    expect(rejected.status).toBe("rejected");
    const reviewed = withheld(await api.post(at(`/daily-reports/${ids.slab}/review`), {}, bearer(members.pm.token)));
    expect(reviewed.status).toBe("approved");
    // And once more on the list after the reviews.
    withheld(await api.get(at("/daily-reports"), bearer(members.pm.token)));
  });
});
