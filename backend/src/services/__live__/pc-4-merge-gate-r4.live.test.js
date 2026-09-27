/**
 * PC-4 merge gate, round 4 — the confirmed findings, proven against a real
 * API process and the real local Postgres with real calculations.
 *
 *   1. Owner decision D4, the default reporting period: with no period
 *      chosen, the EV report, the health card, the forecast and the
 *      workspace home all read the LATEST PERIOD WHOSE CUTOFF INSTANT HAS
 *      PASSED — never a period whose cutoff is still ahead (a period cut at
 *      the end of today has not passed either). Its figures are those of the
 *      same period chosen explicitly. A future period chosen explicitly
 *      gives its figures as before, with the "cutoff not reached" note. A
 *      project with only a future period defaults to the ad hoc report cut
 *      at today. A locked default answers with its stored snapshot.
 *   2. A staged schedule revision (an XER import into a project with no
 *      active schedule) is judged on its own snapshot on the Schedule page —
 *      the same readiness submit and approve use — not on the (absent)
 *      active activities; the page's readiness therefore lets the approval
 *      through exactly when the server does.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; the only writes outside the API are to its own rows.
 *
 *   npm run test:live -- src/services/__live__/pc-4-merge-gate-r4.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const workspaceDashboardService = require("../workspace-dashboard.service");

const CUTOFF_NOT_REACHED = "This period's cutoff has not been reached; EV and AC are measured through today while PV runs to the cutoff.";
const CHICAGO = "America/Chicago";
const localDate = (instant, timeZone) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);

liveDescribe("PC-4 merge gate round 4: the default EV period (D4) and a staged revision's readiness", () => {
  let live;
  let api;
  const auth = () => ({ authorization: `Bearer ${live.token}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({
      TZ: CHICAGO,
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      DATABASE_CONNECTION_LIMIT: "4",
    });
  });

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  const newProject = async (name, { timezone = null } = {}) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest r4 ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17"), timezone },
    });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 201) => {
      const response = await api.post(at(route), body, auth());
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const get = async (route) => {
      const response = await api.get(at(route), auth());
      expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
      return response.body.data;
    };
    return { project, at, post, get };
  };

  /** An activity with an approved allocation of quantity × rate of a new BOQ row. */
  const activityWithBill = async (built, { code, name, quantity = 10, rate = 1000 }) => {
    const item = await built.post("/boq/items", { code, description: name, quantity, unit: "m3", rate });
    const created = await built.post("/activities", {
      name,
      activityCode: `A-${code}`,
      duration: 5,
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      engineerIds: [live.user.id],
    });
    const allocation = await built.post("/activity-boq-allocations", { boqItemId: item.item.id, activityId: created.id, quantity });
    for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {}, 200);
    return created;
  };

  const loading = (built, activityId, plannedDate, plannedValue) =>
    prisma.activityCostLoading.create({
      data: { projectId: built.project.id, activityId, status: "approved", approvedAt: new Date("2026-01-02T12:00:00Z"), plannedDate: new Date(`${plannedDate}T00:00:00Z`), plannedValue },
    });

  const approvedProgress = (activityId, pctComplete, at) =>
    prisma.activityProgress.create({
      data: { activityId, pctComplete, status: "approved", approvedBy: live.user.id, approvedAt: new Date(at), updatedAt: new Date(at) },
    });

  const period = (built, code, periodStart, cutoffDate) =>
    built.post("/reports/periods", { code, periodStart, periodEnd: cutoffDate, cutoffDate });

  const figures = (report) => ({ pv: report.pv, ev: report.ev, ac: report.ac, spi: report.spi, cpi: report.cpi, eac: report.eac });
  const scheduleDimension = (health) => health.dimensions.find((row) => row.key === "schedule");

  /**
   * Two bills of 10,000 in America/Chicago. PV: 1,000 on 10 Aug, 1,000 on
   * 10 Sep, 1,000 next January. EV: 10% of the first bill approved 20 Aug,
   * 30% on 20 Sep. AC: 500 on the first activity through 15 Aug, 700 on the
   * second through 5 Sep. Periods: August (cutoff 31 Aug, passed), one cut
   * at the end of today (not passed until today ends) and one next January.
   */
  it("1. D4: every default EV reader takes the latest period whose cutoff has passed; a future period only when chosen, with its note", async () => {
    const built = await newProject("default period", { timezone: CHICAGO });
    const first = await activityWithBill(built, { code: "1.1", name: "Frame" });
    const second = await activityWithBill(built, { code: "1.2", name: "Envelope" });
    const nextYear = new Date().getUTCFullYear() + 1;
    await loading(built, first.id, "2026-08-10", 1000);
    await loading(built, first.id, "2026-09-10", 1000);
    await loading(built, first.id, `${nextYear}-01-10`, 1000);
    await approvedProgress(first.id, 10, "2026-08-20T15:00:00Z");
    await approvedProgress(first.id, 30, "2026-09-20T15:00:00Z");
    await prisma.costRecord.create({ data: { projectId: built.project.id, activityId: first.id, actual: 500, actualThroughDate: new Date("2026-08-15T00:00:00Z") } });
    await prisma.costRecord.create({ data: { projectId: built.project.id, activityId: second.id, actual: 700, actualThroughDate: new Date("2026-09-05T00:00:00Z") } });
    const august = await period(built, "M08", "2026-08-01", "2026-08-31");
    const today = localDate(new Date(), CHICAGO);
    const endsToday = await period(built, "TODAY", `${today.slice(0, 7)}-01`, today);
    const future = await period(built, "F01", `${nextYear}-01-01`, `${nextYear}-01-25`);

    // August chosen explicitly: its own figures, cut at the end of 31 Aug in Chicago.
    const augustReport = await built.get(`/reports/ev?periodId=${august.id}`);
    expect(figures(augustReport)).toEqual({ pv: 1000, ev: 1000, ac: 500, spi: 1, cpi: 2, eac: 10000 });
    expect(augustReport.reporting).toMatchObject({ cutoffDate: "2026-09-01T04:59:59.999Z", cutoffLocalDate: "2026-08-31", timeZone: CHICAGO });

    // The default EV report: August, with August's figures — not the period
    // cut at the end of today (its instant is still ahead) and not January.
    const byDefault = await built.get("/reports/ev");
    expect(byDefault.reporting.period).toMatchObject({ id: august.id, code: "M08", isVirtual: false });
    expect(byDefault.reporting).toMatchObject({ cutoffDate: "2026-09-01T04:59:59.999Z", cutoffLocalDate: "2026-08-31" });
    expect(figures(byDefault)).toEqual(figures(augustReport));
    expect(byDefault.basisWarnings).not.toContain(CUTOFF_NOT_REACHED);

    // The health card and the forecast read the same default basis.
    const health = await built.get("/health");
    expect(health.dataFreshness).toMatchObject({ cutoffDate: "2026-09-01T04:59:59.999Z", cutoffLocalDate: "2026-08-31" });
    expect(health.dataFreshness.cutoffNotReachedNote).toBeNull();
    expect(scheduleDimension(health).detail.spi).toBe(1);
    const forecast = await built.get("/forecast");
    expect(forecast.earnedValueCutoff).toMatchObject({ cutoffDate: "2026-09-01T04:59:59.999Z", cutoffLocalDate: "2026-08-31" });
    expect([forecast.schedule.spi, forecast.schedule.cpi, forecast.cost.eac]).toEqual([1, 2, 10000]);
    expect(forecast.dataQuality).not.toContain(CUTOFF_NOT_REACHED);

    // The workspace home (web and mobile) reads the same basis per project.
    const dashboard = await workspaceDashboardService.getWorkspaceDashboard({
      orgId: live.org.id,
      userId: live.user.id,
      role: "pm",
      isCompanyAdmin: true,
      allProjects: true,
    });
    const row = dashboard.projectHealth.find((entry) => entry.id === built.project.id);
    expect({ pv: row.pv, ev: row.ev, ac: row.ac, spi: row.spi, cpi: row.cpi }).toEqual({ pv: 1000, ev: 1000, ac: 500, spi: 1, cpi: 2 });

    // The future period, chosen explicitly: PV to its cutoff, EV and AC to
    // today — as before — and said.
    const futureReport = await built.get(`/reports/ev?periodId=${future.id}`);
    expect(figures(futureReport)).toEqual({ pv: 3000, ev: 3000, ac: 1200, spi: 1, cpi: 2.5, eac: 8000 });
    expect(futureReport.reporting.cutoffLocalDate).toBe(`${nextYear}-01-25`);
    expect(futureReport.basisWarnings).toContain(CUTOFF_NOT_REACHED);
    // The period cut at the end of today stays selectable too.
    expect((await built.get(`/reports/ev?periodId=${endsToday.id}`)).reporting.period.id).toBe(endsToday.id);

    // Locked, the default August answers with its stored snapshot.
    const locked = await built.post(`/reports/periods/${august.id}/lock`, { overrideReason: "LiveTest PC-4 r4: lock August over the setup gate" }, 200);
    expect(figures(locked)).toEqual(figures(augustReport));
    const lockedDefault = await built.get("/reports/ev");
    expect(lockedDefault.reporting).toMatchObject({ isSnapshot: true, cutoffDate: "2026-09-01T04:59:59.999Z" });
    expect(lockedDefault.reporting.period.id).toBe(august.id);
    expect(figures(lockedDefault)).toEqual(figures(augustReport));
  });

  it("1b. D4: a project whose only period is still ahead defaults to the ad hoc report cut at today", async () => {
    const built = await newProject("only future", { timezone: CHICAGO });
    const act = await activityWithBill(built, { code: "1.1", name: "Frame" });
    const nextYear = new Date().getUTCFullYear() + 1;
    await loading(built, act.id, "2026-08-10", 1000);
    await loading(built, act.id, `${nextYear}-01-10`, 1000);
    await approvedProgress(act.id, 10, "2026-08-20T15:00:00Z");
    const future = await period(built, "F01", `${nextYear}-01-01`, `${nextYear}-01-25`);

    const today = localDate(new Date(), CHICAGO);
    const byDefault = await built.get("/reports/ev");
    expect(byDefault.reporting.period).toMatchObject({ id: null, isVirtual: true, code: `ADHOC-${today}` });
    expect(byDefault.reporting.cutoffLocalDate).toBe(today);
    // PV through today only: the August 1,000, never next January's.
    expect([byDefault.pv, byDefault.ev, byDefault.spi]).toEqual([1000, 1000, 1]);
    expect((await built.get("/health")).dataFreshness.cutoffLocalDate).toBe(today);
    expect((await built.get("/forecast")).earnedValueCutoff.cutoffLocalDate).toBe(today);

    // Chosen explicitly, the future period gives PV to its cutoff, as before.
    const futureReport = await built.get(`/reports/ev?periodId=${future.id}`);
    expect([futureReport.pv, futureReport.ev, futureReport.spi]).toEqual([2000, 1000, 0.5]);
    expect(futureReport.basisWarnings).toContain(CUTOFF_NOT_REACHED);
  });

  it("2. a staged XER import is judged on its own snapshot on the Schedule page, so the page's readiness matches the approval the server gives", async () => {
    const built = await newProject("staged import");
    const xer = [
      "ERMHDR\t19.12",
      "%T\tPROJWBS",
      "%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num",
      "%R\tW1\t\tCIV\tCivil\t1",
      "%T\tTASK",
      "%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct",
      "%R\tT1\tA100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0",
      "%R\tT2\tA200\tFrame\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0",
      "%T\tTASKPRED",
      "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
      "%R\tP1\tT2\tT1\tPR_FS\t0",
      "%E",
      "",
    ].join("\n");
    const form = new FormData();
    form.append("file", new Blob([xer], { type: "application/octet-stream" }), "staged.xer");
    const response = await fetch(`${api.base}${built.at("/import/xer")}`, { method: "POST", headers: auth(), body: form });
    const imported = await response.json();
    expect([response.status, imported.error]).toEqual([201, undefined]);
    expect(imported.data).toMatchObject({ staged: true, imported: 2 });
    // Nothing is active yet: activation needs the approval.
    expect(await prisma.activity.count({ where: { projectId: built.project.id, isActive: true } })).toBe(0);

    const readinessOf = (value) => ({
      ready: value.ready,
      blockingCount: value.blockingCount,
      checks: (value.checks || []).map((check) => [check.key, check.status, check.message]),
    });
    const schedule = await built.get("/schedule");
    const revisionId = schedule.revision.id;
    expect(schedule.revision.isActive).toBe(false);
    // The lifecycle's readiness for this revision — what submit and approve check.
    const lifecycle = await built.get(`/schedule/revisions/${revisionId}/readiness`);
    expect(readinessOf(schedule.revision.readiness)).toEqual(readinessOf(lifecycle));
    // Its two activities and their FS link: nothing missing.
    expect(schedule.revision.readiness.ready).toBe(true);
    expect(schedule.revision.readiness.blockingCount).toBe(0);
    const messages = schedule.revision.readiness.checks.map((check) => check.message).join(" | ");
    expect(messages).not.toContain("No schedule activities exist");
    expect(messages).not.toContain("No activities exist for CPM review");

    // And the server lets the approval through, as the page now says.
    await built.post(`/schedule/revisions/${revisionId}/submit-review`, {}, 200);
    const underReview = await built.get("/schedule");
    expect(underReview.revision).toMatchObject({ id: revisionId, status: "under_review" });
    expect(underReview.revision.readiness.ready).toBe(true);
    await built.post(`/schedule/revisions/${revisionId}/approve`, {}, 200);
  });
});
