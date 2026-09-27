/**
 * PC-4 merge gate, round 3 — the confirmed findings, proven against a real
 * API process and the real local Postgres.
 *
 *   1. No approved budget and money spent: CPI is 0 because there is nothing
 *      to earn against — the forecast and the health card say so (the CPI-0
 *      sentence used to be written only for budget_cpi_zero).
 *   2. The Explain narrative never calls the budget handed back "within
 *      budget" (no CPI, or CPI 0), and the prompt block gives the model the
 *      EAC's rule instead of "(within budget)".
 *   3. The health card's missing index: SPI / CPI null carry the server's
 *      reason and scoreBasis neutral_no_index (the score stays the frozen
 *      60), and the AC source says there are no official actual rows.
 *   4. A period whose cutoff is still ahead, chosen explicitly, carries the
 *      server's caveat (PV to the cutoff, EV and AC to today) beside an SPI
 *      left exactly as computed; the health card and the forecast default
 *      to the latest period whose cutoff has passed (owner decision D4,
 *      round 4) and carry none.
 *   5. The EV report's S-curve gives EV only at the month of its cutoff, with
 *      the instant and the PV through that instant — never the report's EV
 *      written into earlier months — and a period locked afterwards stores
 *      that shape.
 *   6. A member whose template takes the schedule away is given no activity
 *      or schedule revision under a readiness issue (the count stays); a
 *      schedule reader still gets them.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; the only writes outside the API are to its own rows.
 *
 *   npm run test:live -- src/services/__live__/pc-4-merge-gate-r3.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { forecastBlock } = require("../forecast.service");

const NOTES = {
  SPI_UNAVAILABLE: "SPI is not available yet: no approved time-phased cost loading through the cutoff, so there is no planned value to measure progress against.",
  CPI_UNAVAILABLE: "CPI is not available yet: no official cost-record actuals through the cutoff, so the earned-value estimate at completion falls back to the budget.",
  CPI_ZERO_NO_BUDGET:
    "CPI is 0 because there is no approved budget to earn against: actual cost has been recorded, but with no approved allocation nothing can be earned, so there is no estimate at completion.",
  CUTOFF_NOT_REACHED: "This period's cutoff has not been reached; EV and AC are measured through today while PV runs to the cutoff.",
};

liveDescribe("PC-4 merge gate round 3: EV notes, narrative, health basis, future cutoff, S-curve, schedule items", () => {
  let live;
  let api;
  let member;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const memberAuth = () => ({ authorization: `Bearer ${mintAccessToken(member)}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({
      TZ: "America/Chicago",
      RATE_LIMIT_AI_MAX: "1000",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      DATABASE_CONNECTION_LIMIT: "4",
    });
    member = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest Site Engineer",
      email: `live-se-r3-${Date.now()}@octapm-live.test`,
      role: "site_engineer",
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
      data: { orgId: live.org.id, name: `LiveTest r3 ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18"), timezone },
    });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 201, headers = auth()) => {
      const response = await api.post(at(route), body, headers);
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const get = async (route, headers = auth(), expected = 200) => {
      const response = await api.get(at(route), headers);
      expect([route, response.status]).toEqual([route, expected]);
      return expected === 200 ? response.body.data : response.body.error;
    };
    return { project, at, post, get };
  };

  const activity = (built, code, name) =>
    built.post("/activities", { name, activityCode: code, duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [live.user.id] });

  /** An activity with an approved allocation of quantity × rate of a new BOQ row. */
  const activityWithBill = async (built, { code, name, quantity = 100, rate = 1000 }) => {
    const item = await built.post("/boq/items", { code, description: name, quantity, unit: "m3", rate });
    const created = await activity(built, `A-${code}`, name);
    const allocation = await built.post("/activity-boq-allocations", { boqItemId: item.item.id, activityId: created.id, quantity });
    for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {}, 200);
    return created;
  };

  const approvedProgress = (activityId, pctComplete, at) =>
    prisma.activityProgress.create({
      data: { activityId, pctComplete, status: "approved", approvedBy: live.user.id, approvedAt: new Date(at), updatedAt: new Date(at) },
    });

  const loading = (built, activityId, plannedDate, plannedValue) =>
    prisma.activityCostLoading.create({
      data: { projectId: built.project.id, activityId, status: "approved", approvedAt: new Date("2026-01-02T12:00:00Z"), plannedDate: new Date(`${plannedDate}T00:00:00Z`), plannedValue },
    });

  const period = (built, code, cutoffDate) =>
    built.post("/reports/periods", { code, periodStart: `${cutoffDate.slice(0, 7)}-01`, periodEnd: cutoffDate, cutoffDate });

  const costDimension = (health) => health.dimensions.find((row) => row.key === "cost");
  const scheduleDimension = (health) => health.dimensions.find((row) => row.key === "schedule");

  it("1. no approved budget and money spent: CPI 0 is explained as nothing to earn against, on the forecast and the health card", async () => {
    const built = await newProject("no budget");
    const act = await activity(built, "A100", "Unbudgeted works");
    await prisma.costRecord.create({ data: { projectId: built.project.id, activityId: act.id, actual: 20000, actualThroughDate: new Date("2026-02-05T00:00:00Z") } });

    const forecast = await built.get("/forecast");
    // The premise, unchanged: no budget, CPI 0 (EV 0 / AC 20,000).
    expect([forecast.cost.eacBasis, forecast.cost.bac, forecast.schedule.cpi, forecast.cost.actual]).toEqual(["no_budget", 0, 0, 20000]);
    expect(forecast.dataQuality).toContain(NOTES.CPI_ZERO_NO_BUDGET);

    const health = await built.get("/health");
    expect(costDimension(health).detail).toMatchObject({ cpi: 0, cpiNote: NOTES.CPI_ZERO_NO_BUDGET, scoreBasis: "cpi" });
  });

  it("2. the narrative and the prompt never call the budget handed back 'within budget'", async () => {
    // No CPI: a bill, no progress, no actual — the EAC is the revised BAC.
    const noCpi = await newProject("narrative no cpi");
    await activityWithBill(noCpi, { code: "1.1", name: "Frame" });
    const explained = await noCpi.post("/forecast/explain", {}, 200);
    expect(explained.degraded).toBe(true);
    expect(explained.forecast.cost).toMatchObject({ eacBasis: "budget_no_cost_performance", eac: 100000, overrun: 0 });
    // (The activity is late — nothing recorded — so the finish slips; the
    // cost clause is the point.)
    expect(explained.narrative.headline).toMatch(
      /^The project is projected to finish [^;]+; the cost outlook is the budget — no cost performance yet, not a projection.$/,
    );
    expect(explained.narrative.cost).toMatch(/^The estimate at completion is the budget — no cost performance yet: the budget handed back/);
    for (const text of [explained.narrative.headline, explained.narrative.cost]) expect(text).not.toMatch(/within budget/i);
    const prompt = forecastBlock(explained.forecast, "LiveTest");
    expect(prompt).toContain("EAC 100,000 (the budget — no cost performance yet)");
    expect(prompt).toContain("not a projection: the cost outlook is the budget — no cost performance yet, not a projection; do not call it within budget");
    expect(prompt).not.toMatch(/\(within budget\)/);

    // CPI 0: actual cost, nothing earned — the same, in its own words.
    const cpiZero = await newProject("narrative cpi zero");
    const act = await activityWithBill(cpiZero, { code: "1.1", name: "Frame" });
    await prisma.costRecord.create({ data: { projectId: cpiZero.project.id, activityId: act.id, actual: 30000, actualThroughDate: new Date("2026-02-05T00:00:00Z") } });
    const zero = await cpiZero.post("/forecast/explain", {}, 200);
    expect(zero.forecast.cost.eacBasis).toBe("budget_cpi_zero");
    expect(zero.narrative.headline).toContain("the cost outlook is the budget — nothing earned against the cost spent (CPI 0), not a projection");
    expect(zero.narrative.headline).not.toMatch(/within budget/i);
  });

  it("3. a missing index on the health card carries the server's reason and a neutral score basis; AC says there are no official rows", async () => {
    const built = await newProject("health basis");
    await activityWithBill(built, { code: "1.1", name: "Frame" });
    const health = await built.get("/health");
    const schedule = scheduleDimension(health);
    const cost = costDimension(health);
    // The frozen rule: no index gives 60 — unchanged, and now said to be neutral.
    expect([schedule.score, schedule.detail.spi, schedule.detail.spiNote, schedule.detail.scoreBasis]).toEqual([60, null, NOTES.SPI_UNAVAILABLE, "neutral_no_index"]);
    expect([cost.score, cost.detail.cpi, cost.detail.cpiNote, cost.detail.scoreBasis]).toEqual([60, null, NOTES.CPI_UNAVAILABLE, "neutral_no_index"]);
    expect(cost.detail.acSource.officialActualActivities).toBe(0);
    // Schedule and cost are through the EV cutoff; the rest as of today.
    expect(Object.fromEntries(health.dimensions.map((row) => [row.key, row.measuredThrough]))).toEqual({
      schedule: "ev_cutoff",
      cost: "ev_cutoff",
      commercial: "today",
      supplyChain: "today",
      quality: "today",
      safety: "today",
      docControl: "today",
    });
    expect(health.pendingReview.metrics.every((row) => row.measuredThrough === "today")).toBe(true);
  });

  it("4. a future period chosen explicitly keeps its SPI and says PV runs to the cutoff; the health card and the forecast default to the latest passed period and carry no caveat (D4)", async () => {
    const built = await newProject("future cutoff", { timezone: "America/Chicago" });
    const act = await activityWithBill(built, { code: "1.1", name: "Frame", quantity: 10 });
    const nextYear = new Date().getUTCFullYear() + 1;
    await loading(built, act.id, "2026-01-10", 1000);
    await loading(built, act.id, `${nextYear}-01-10`, 1000);
    await approvedProgress(act.id, 10, "2026-02-20T15:00:00Z");
    const january = await period(built, "P01", "2026-01-31");
    const future = await period(built, "F01", `${nextYear}-01-25`);

    const report = await built.get(`/reports/ev?periodId=${future.id}`);
    // Chosen explicitly, the figures are the report's, unchanged: PV 2,000
    // to the cutoff, EV 1,000 — and said.
    expect([report.pv, report.ev, report.spi]).toEqual([2000, 1000, 0.5]);
    expect(report.basisWarnings).toContain(NOTES.CUTOFF_NOT_REACHED);

    // Owner decision D4: the health card and the forecast default to the
    // latest period whose cutoff has passed — January — never the future
    // one, so they carry January's SPI and no such caveat.
    const januaryReport = await built.get(`/reports/ev?periodId=${january.id}`);
    const health = await built.get("/health");
    const forecast = await built.get("/forecast");
    expect(health.dataFreshness.cutoffLocalDate).toBe("2026-01-31");
    expect(scheduleDimension(health).detail.spi).toBe(januaryReport.spi);
    expect(forecast.schedule.spi).toBe(januaryReport.spi);
    expect(health.dataFreshness.cutoffNotReachedNote).toBeNull();
    expect(scheduleDimension(health).detail.cutoffNotReachedNote).toBeNull();
    expect(costDimension(health).detail.cutoffNotReachedNote).toBeNull();
    expect(forecast.dataQuality).not.toContain(NOTES.CUTOFF_NOT_REACHED);

    // A project whose latest cutoff has passed carries no such note.
    const past = await newProject("past cutoff", { timezone: "America/Chicago" });
    await activityWithBill(past, { code: "1.1", name: "Frame" });
    await period(past, "P01", "2026-01-31");
    const pastHealth = await past.get("/health");
    expect(pastHealth.dataFreshness.cutoffNotReachedNote).toBeNull();
    expect(scheduleDimension(pastHealth).detail.cutoffNotReachedNote).toBeNull();
    expect((await past.get("/forecast")).dataQuality).not.toContain(NOTES.CUTOFF_NOT_REACHED);
  });

  it("5. the S-curve gives EV only at the month of the cutoff, with its instant and the PV through it; a period locked afterwards stores that shape", async () => {
    const built = await newProject("s-curve", { timezone: "America/Chicago" });
    const act = await activityWithBill(built, { code: "1.1", name: "Frame", quantity: 10 });
    for (const month of ["01", "02", "03", "04", "05", "06"]) await loading(built, act.id, `2026-${month}-10`, 1000);
    await loading(built, act.id, "2026-03-25", 500);
    await loading(built, act.id, "2026-05-28", 700);
    await approvedProgress(act.id, 30, "2026-03-12T15:00:00Z");
    await approvedProgress(act.id, 60, "2026-05-12T15:00:00Z");
    const march = await period(built, "M03", "2026-03-15");
    const may = await period(built, "M05", "2026-05-15");

    const report = await built.get(`/reports/ev?periodId=${may.id}`);
    expect([report.pv, report.ev]).toEqual([5500, 6000]);
    expect(report.reporting).toMatchObject({ cutoffDate: "2026-05-16T04:59:59.999Z", cutoffLocalDate: "2026-05-15" });
    expect(report.sCurve).toEqual([
      { label: "Jan 26", pv: 1000, ev: null },
      { label: "Feb 26", pv: 2000, ev: null },
      { label: "Mar 26", pv: 3500, ev: null },
      { label: "Apr 26", pv: 4500, ev: null },
      { label: "May 26", pv: 5500, ev: 6000, evMeasuredAt: "2026-05-16T04:59:59.999Z", pvAtCutoff: 5500 },
    ]);
    expect(report.sCurveNote).toMatch(/^EV is given only in the month of this report's cutoff/);

    // March locked now: its stored series is the same shape, EV 3,000 at March.
    const locked = await built.post(`/reports/periods/${march.id}/lock`, { overrideReason: "LiveTest r3: lock over the setup gate" }, 200);
    expect([locked.pv, locked.ev]).toEqual([3000, 3000]);
    const stored = await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: march.id } });
    expect(stored.sCurveJson).toEqual([
      { label: "Jan 26", pv: 1000, ev: null },
      { label: "Feb 26", pv: 2000, ev: null },
      { label: "Mar 26", pv: 3000, ev: 3000, evMeasuredAt: "2026-03-16T04:59:59.999Z", pvAtCutoff: 3000 },
    ]);
    const snapshotReport = await built.get(`/reports/ev?periodId=${march.id}`);
    expect(snapshotReport.reporting.isSnapshot).toBe(true);
    expect(snapshotReport.sCurveNote).toMatch(/^EV is given only in the month of this report's cutoff/);
  });

  it("6. a member without schedule read is given no activity under a readiness issue; the count stays; a schedule reader gets them", async () => {
    const built = await newProject("schedule items");
    await built.post("/structure/wbs", { code: "W1", name: "Works" });
    const unfiled = await activity(built, "A200", "Unfiled activity");
    const template = await prisma.permissionTemplate.create({
      data: {
        orgId: live.org.id,
        name: `LiveTest r3 no schedule ${Date.now()}`,
        baseRole: "site_engineer",
        tools: { create: [{ module: "boq", level: "none" }, { module: "schedule", level: "none" }] },
      },
    });
    await prisma.projectAssignment.create({ data: { projectId: built.project.id, userId: member.id, role: "site_engineer", orgId: live.org.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: built.project.id, userId: member.id, templateId: template.id } });
    // The premise: the member is refused the schedule and the WBS.
    await built.get("/schedule", memberAuth(), 403);
    await built.get("/structure/wbs", memberAuth(), 403);

    const issueOf = (readiness, code) =>
      readiness.steps.flatMap((step) => [...step.blockers, ...step.warnings, ...step.advisories]).find((entry) => entry.code === code);
    const activityItems = (readiness) =>
      readiness.steps.flatMap((step) => [...step.blockers, ...step.warnings, ...step.advisories]).flatMap((entry) => entry.items || []).filter((item) => item.type === "activity" || item.type === "schedule_revision");

    const pm = await built.get("/setup-readiness");
    const pmIssue = issueOf(pm, "ACTIVITIES_WITHOUT_WBS");
    expect(pmIssue.items.map((item) => [item.type, item.id])).toEqual([["activity", unfiled.id]]);
    expect(pmIssue.scheduleItemsWithheld).toBeUndefined();

    const limited = await built.get("/setup-readiness", memberAuth());
    const limitedIssue = issueOf(limited, "ACTIVITIES_WITHOUT_WBS");
    expect([limitedIssue.count, limitedIssue.items, limitedIssue.scheduleItemsWithheld]).toEqual([1, [], true]);
    expect(limitedIssue.scheduleReason).toBe("Schedule records are listed for people who can open the schedule");
    expect(activityItems(limited)).toEqual([]);
    expect(JSON.stringify(limited)).not.toContain(unfiled.id);
    // Every gate is the same for both.
    expect(limited.gates.baseline.ready).toBe(pm.gates.baseline.ready);
    expect(limited.gates.reporting.blockers.map((row) => row.code)).toEqual(pm.gates.reporting.blockers.map((row) => row.code));
  });
});
