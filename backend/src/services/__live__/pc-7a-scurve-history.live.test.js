/**
 * PC-7a item 3 / 3b — the S-curve's measured history, proven against a real
 * API process and the real local Postgres.
 *
 * GET /reports/ev carries `history`: one point per LOCKED reporting period,
 * read from its EvPeriodSnapshot exactly as stored at the lock — PV, EV, AC,
 * EAC and the cutoff instant PC-4's one cutoff function (utils/reporting-
 * cutoff) gave it: the end of the reporting date in Project.timezone, else
 * Organisation.defaultTimezone, else UTC, from the zone's own DST rules.
 * Nothing is recomputed or filled in: an open period has no point, a point
 * never moves after a later record, and a report shows only the points cut on
 * or before its own cutoff. The history is project-level totals, so a cost
 * reader without boq:read receives it (the activity breakdown stays
 * withheld); a member without cost:read and another organisation receive
 * nothing.
 *
 * Everything runs in throwaway "LiveTest <uuid>" organisations dropped
 * afterwards.
 *
 *   npm run test:live -- src/services/__live__/pc-7a-scurve-history.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { resolveReportingCutoff } = require("../../utils/reporting-cutoff");
const { startApi } = require("./auth-live-kit");

liveDescribe("PC-7a: locked periods draw the S-curve history", () => {
  let live;
  let other;
  let api;
  const projects = {};
  const periods = {};
  let activityId;
  let budgetLineId;

  const auth = (who = live) => ({ authorization: `Bearer ${who.token}` });
  const at = (key, route) => `/api/v1/projects/${projects[key].id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const report = async (key, query = "", headers = auth()) => {
    const answer = await api.get(at(key, `/reports/ev${query}`), headers);
    ok(answer);
    return answer.body.data;
  };

  const newProject = async (who, key, name, timezone = null) => {
    projects[key] = await prisma.project.create({
      data: { orgId: who.org.id, name: `LiveTest PC-7a ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18"), ...(timezone ? { timezone } : {}) },
    });
  };
  const newPeriod = async (who, key, code, periodStart, periodEnd) => {
    const created = await api.post(at(key, "/reports/periods"), { code, periodStart, periodEnd, cutoffDate: periodEnd }, auth(who));
    ok(created, 201);
    periods[`${key}:${code}`] = created.body.data.id || created.body.data.period?.id;
    return periods[`${key}:${code}`];
  };
  const lock = async (who, key, code) =>
    ok(await api.post(at(key, `/reports/periods/${periods[`${key}:${code}`]}/lock`), { overrideReason: "LiveTest PC-7a: lock over the setup gate" }, auth(who)));
  const loadCost = async (plannedDate, plannedValue) => {
    const created = await api.post(at("CHI", "/reports/cost-loading"), { activityId, plannedDate, plannedValue, status: "submitted" }, auth());
    ok(created, 201);
    ok(await api.post(at("CHI", `/reports/cost-loading/${created.body.data.id}/approve`), {}, auth()));
  };
  const postActual = async (costDate, amount) => {
    const cost = await api.post(at("CHI", "/direct-costs"), { description: `LiveTest cost ${costDate}`, costDate, type: "invoice", vendorName: "LiveTest supplier", lines: [{ description: "Concrete", budgetLineId, activityId, costType: "material", amount }] }, auth());
    ok(cost, 201);
    ok(await api.post(at("CHI", `/direct-costs/${cost.body.data.id}/submit`), {}, auth()));
    ok(await api.post(at("CHI", `/direct-costs/${cost.body.data.id}/approve`), {}, auth()));
  };
  // Every stored EV snapshot row of an organisation, byte for byte.
  const evRows = async (orgId) => {
    const projectIds = (await prisma.project.findMany({ where: { orgId }, select: { id: true } })).map((row) => row.id);
    return JSON.stringify(await prisma.evPeriodSnapshot.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: "asc" } }));
  };
  const chicagoEnd = (date) => resolveReportingCutoff({ value: date, timeZone: "America/Chicago", timeZoneSource: "project" }).cutoffDate.toISOString();

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    await newProject(live, "CHI", "history (America/Chicago)", "America/Chicago");
    await newProject(live, "UTC", "history (no zone)");
    await newProject(other, "OTHER", "second organisation");

    const activity = await api.post(at("CHI", "/activities"), { engineerIds: [live.user.id], name: "Pour slab", activityCode: "H7A", duration: 60, startDate: "2026-01-12", endDate: "2026-03-27" }, auth());
    ok(activity, 201);
    activityId = activity.body.data.id;
    const code = await api.post("/api/v1/company/cost-codes", { code: `LT7H-${Date.now().toString(36)}`, name: "LiveTest history", category: "material" }, auth());
    ok(code, 201);
    ok(await api.request("PUT", at("CHI", "/budget/cost-codes"), { body: { costCodeIds: [code.body.data.id] }, headers: auth() }));
    const line = await api.post(at("CHI", "/budget/lines"), { costCodeId: code.body.data.id, costType: "material", originalBudget: 10000, description: "history line" }, auth());
    ok(line, 201);
    budgetLineId = line.body.data.id;

    // January: 1,000 planned, 500 spent on the 15th. March: 2,000 more
    // planned, 700 more spent on the 10th. February stays open.
    await loadCost("2026-01-20", 1000);
    await loadCost("2026-03-15", 2000);
    await postActual("2026-01-15", 500);
    await newPeriod(live, "CHI", "P01", "2026-01-01", "2026-01-31");
    await lock(live, "CHI", "P01");
    await postActual("2026-03-10", 700);
    await newPeriod(live, "CHI", "P02", "2026-02-01", "2026-02-28");
    await newPeriod(live, "CHI", "P03", "2026-03-01", "2026-03-31");
    await lock(live, "CHI", "P03");
  }, 240_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  it("two locked periods give two distinct points, each cut at the end of its date in America/Chicago (CST, then CDT); the open period has none", async () => {
    const data = await report("CHI", `?periodId=${periods["CHI:P03"]}`);
    expect(data.reporting.isSnapshot).toBe(true);
    expect(data.history.map((point) => point.code)).toEqual(["P01", "P03"]);
    const [jan, mar] = data.history;
    // PC-4's one cutoff function, not a second one: CST ends at 05:59:59.999Z, CDT at 04:59:59.999Z.
    expect([jan.cutoffDate, mar.cutoffDate]).toEqual([chicagoEnd("2026-01-31"), chicagoEnd("2026-03-31")]);
    expect([jan.cutoffDate, mar.cutoffDate]).toEqual(["2026-02-01T05:59:59.999Z", "2026-04-01T04:59:59.999Z"]);
    expect(jan).toMatchObject({ cutoffLocalDate: "2026-01-31", timeZone: "America/Chicago", timeZoneSource: "project", timeZoneNote: null, pv: 1000, ac: 500, periodId: periods["CHI:P01"] });
    expect(mar).toMatchObject({ cutoffLocalDate: "2026-03-31", timeZone: "America/Chicago", pv: 3000, ac: 1200, periodId: periods["CHI:P03"] });
    // Each point is its snapshot as stored.
    for (const point of data.history) {
      const row = await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: point.periodId } });
      expect(point.snapshotId).toBe(row.id);
      expect(point.cutoffDate).toBe(row.cutoffDate.toISOString());
      expect([point.pv, point.ev, point.ac, point.totalBudget]).toEqual([Number(row.pv), Number(row.ev), Number(row.ac), Number(row.totalBudget)]);
      expect(point.eac).toBe(row.eac === null ? null : Number(row.eac));
    }
    // The labels and the sentence travel with it; the formula S-curve is still there.
    expect(data.historyTruth).toMatchObject({ pv: "derived", ev: "derived", ac: "derived", eac: "projection:eac_at_lock", frozenAt: "locked_period_snapshot" });
    expect(data.historyNote).toContain("Nothing is recomputed");
    expect(Array.isArray(data.sCurve)).toBe(true);
  });

  it("a report shows only the points cut on or before its own cutoff", async () => {
    expect((await report("CHI", `?periodId=${periods["CHI:P01"]}`)).history.map((p) => p.code)).toEqual(["P01"]);
    // The open February period: a live report with the January point only.
    const feb = await report("CHI", `?periodId=${periods["CHI:P02"]}`);
    expect(feb.reporting.isSnapshot).toBe(false);
    expect(feb.history.map((p) => p.code)).toEqual(["P01"]);
    expect((await report("CHI", "?cutoffDate=2026-01-30")).history).toEqual([]);
    // Default (D4): the latest period whose cutoff has passed — March.
    expect((await report("CHI")).history.map((p) => p.code)).toEqual(["P01", "P03"]);
  });

  it("a locked point never moves: back-dated cost and plan move a recomputation, not the snapshot, and re-locking returns it as stored", async () => {
    const before = await report("CHI", `?periodId=${periods["CHI:P03"]}`);
    const storedBefore = await evRows(live.org.id);
    const recomputedBefore = await report("CHI", "?cutoffDate=2026-01-31");

    await loadCost("2026-01-05", 400);
    await postActual("2026-01-10", 300);

    // An ad hoc report at January's date sees the late records...
    const recomputed = await report("CHI", "?cutoffDate=2026-01-31");
    expect(recomputed.pv).toBe(recomputedBefore.pv + 400);
    // ...the locked January point does not.
    const after = await report("CHI", `?periodId=${periods["CHI:P03"]}`);
    expect(after.history).toEqual(before.history);
    expect(after.history[0]).toMatchObject({ pv: 1000, ac: 500 });
    ok(await api.post(at("CHI", `/reports/periods/${periods["CHI:P01"]}/lock`), {}, auth()));
    expect(await evRows(live.org.id)).toBe(storedBefore);
  });

  it("a project without a zone: the point is cut at the end of the date in UTC and carries the note recorded at the lock", async () => {
    await newPeriod(live, "UTC", "P01", "2026-01-01", "2026-01-31");
    await lock(live, "UTC", "P01");
    const [point] = (await report("UTC")).history;
    expect(point).toMatchObject({ cutoffDate: "2026-01-31T23:59:59.999Z", cutoffLocalDate: "2026-01-31", timeZone: "UTC", timeZoneSource: "utc" });
    expect(point.timeZoneNote).toBe("Project timezone is not configured; UTC is being used");
  });

  it("permissions: a cost reader without boq:read gets the same history (project totals) but no breakdown; no cost:read and another organisation get nothing", async () => {
    const full = await report("CHI", `?periodId=${periods["CHI:P03"]}`);
    const grant = async (name, tools) => {
      const user = await createLiveUser(prisma, { orgId: live.org.id, name, email: `live-7h-${tools[0].module}-${Date.now()}@octapm-live.test`, role: "cost_controller" });
      await prisma.projectAssignment.create({ data: { projectId: projects.CHI.id, userId: user.id, role: "cost_controller", orgId: live.org.id } });
      const template = await prisma.permissionTemplate.create({ data: { orgId: live.org.id, name: `LiveTest ${name} ${Date.now()}`, baseRole: "cost_controller", tools: { create: tools } } });
      await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: projects.CHI.id, userId: user.id, templateId: template.id } });
      return { authorization: `Bearer ${mintAccessToken(user)}` };
    };

    const noBoq = await grant("cost reader, no BOQ", [{ module: "boq", level: "none" }]);
    const partial = await report("CHI", `?periodId=${periods["CHI:P03"]}`, noBoq);
    expect(partial.history).toEqual(full.history);
    expect(partial).not.toHaveProperty("activityBreakdown");
    expect(partial.activityBreakdownWithheld).toBe(true);

    const noCost = await grant("no cost", [{ module: "cost", level: "none" }]);
    const refused = await api.get(at("CHI", `/reports/ev?periodId=${periods["CHI:P03"]}`), noCost);
    expect(refused.status).toBe(403);
    expect(refused.body.data).toBeUndefined();

    const foreign = await api.get(at("CHI", "/reports/ev"), auth(other));
    expect(foreign.status).toBe(404);
    expect(foreign.body.data).toBeUndefined();
  });

  it("§122: a second organisation locking its own periods leaves the first organisation's snapshots byte-identical", async () => {
    const before = await evRows(live.org.id);
    await newPeriod(other, "OTHER", "P01", "2026-01-01", "2026-01-31");
    await lock(other, "OTHER", "P01");
    const theirs = await report("OTHER", "", auth(other));
    expect(theirs.history.map((p) => p.periodId)).toEqual([periods["OTHER:P01"]]);
    expect(await evRows(live.org.id)).toBe(before);
  });
});
