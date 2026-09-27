/**
 * PC-4, owner decision D1 — the EV reporting cutoff, proven with real
 * calculations against a real API process and the real local Postgres.
 *
 * A reporting period's cutoff date ends at the END OF THAT CALENDAR DATE in
 * Project.timezone, else the workspace's Organisation.defaultTimezone, else
 * UTC; PV, EV and AC are all selected against that one instant. The server's
 * own zone plays no part: the API here runs in Asia/Kolkata (TZ), a zone no
 * project or organisation below uses, so the old server-local end of day
 * gives a different instant in every case.
 *
 * Each project has three activities with a 10,000 approved allocation each.
 * Every activity carries one approved cost loading (PV), one approved
 * progress row (EV) and one cost record (AC), all dated at the SAME instant:
 *
 *   early  — well inside the period
 *   late   — 23:30 local on the cutoff date (must count)
 *   after  — 00:00:30 local the next day (must not)
 *
 * so PV, EV and AC each move together only if they share the cutoff. The
 * expected figures are recomputed here from those rows and the expected
 * cutoff instant, never read off the report.
 *
 * Everything lives in throwaway "LiveTest <uuid>" organisations dropped
 * afterwards; the only writes outside the API are to their own rows.
 *
 *   npm run test:live -- src/services/__live__/pc-4-ev-cutoff.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const SERVER_TZ = "Asia/Kolkata";
const BUDGET_PER_ACTIVITY = 10000;

// What each activity's three rows carry: the planned value loaded, the
// percent approved (EV = allocation × pct), the actual cost recorded.
const ROWS = {
  early: { pv: 1000, pct: 10, ac: 100 },
  late: { pv: 2000, pct: 40, ac: 200 },
  after: { pv: 4000, pct: 80, ac: 400 },
};

/** PV, EV and AC recomputed from the rows for a cutoff instant. */
const expectedAt = (instants, cutoffIso) => {
  const cutoff = new Date(cutoffIso).getTime();
  const counted = Object.entries(ROWS).filter(([key]) => new Date(instants[key]).getTime() <= cutoff);
  return {
    pv: counted.reduce((sum, [, row]) => sum + row.pv, 0),
    ev: counted.reduce((sum, [, row]) => sum + (BUDGET_PER_ACTIVITY * row.pct) / 100, 0),
    ac: counted.reduce((sum, [, row]) => sum + row.ac, 0),
  };
};

liveDescribe("PC-4 D1: the EV cutoff is the end of the cutoff date in the project's time zone, for PV, EV and AC alike", () => {
  let api;
  const orgs = [];

  beforeAll(async () => {
    api = await startApi({
      TZ: SERVER_TZ,
      RATE_LIMIT_AI_MAX: "1000",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      DATABASE_CONNECTION_LIMIT: "4",
    });
  });

  afterAll(async () => {
    if (api) await api.stop();
    for (const live of orgs) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  /** A LiveTest organisation with this default zone (null: none chosen). */
  const newOrg = async (defaultTimezone) => {
    const live = await createLiveOrg(prisma);
    orgs.push(live);
    // One known row, by its unique key: this test's own organisation.
    await prisma.organisation.update({ where: { id: live.org.id }, data: { defaultTimezone } });
    return live;
  };

  /**
   * A project in `live`'s organisation with `timezone`, three activities
   * allocated 10,000 each, and each activity's PV / EV / AC rows at one of
   * the three instants.
   */
  const buildProject = async (live, { name, timezone, instants }) => {
    const auth = { authorization: `Bearer ${live.token}` };
    const post = async (route, body, expected = 201) => {
      const response = await api.post(route, body, auth);
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest D1 ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18"), timezone },
    });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const item = await post(at("/boq/items"), { code: "1.1", description: "Concrete", quantity: 300, unit: "m3", rate: 100 });
    const activities = {};
    for (const [index, key] of Object.keys(ROWS).entries()) {
      const activity = await post(at("/activities"), {
        name: `Activity ${key}`,
        activityCode: `A${index + 1}00`,
        duration: 5,
        startDate: "2026-02-02",
        endDate: "2026-02-06",
        engineerIds: [live.user.id],
      });
      const allocation = await post(at("/activity-boq-allocations"), { boqItemId: item.item.id, activityId: activity.id, quantity: 100 });
      for (const step of ["submit", "approve"]) await post(at(`/activity-boq-allocations/${allocation.id}/${step}`), {}, 200);
      activities[key] = activity.id;
    }
    for (const [key, row] of Object.entries(ROWS)) {
      const when = new Date(instants[key]);
      await prisma.activityCostLoading.create({
        data: { projectId: project.id, activityId: activities[key], plannedDate: when, plannedValue: row.pv, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-01-10T12:00:00Z") },
      });
      await prisma.activityProgress.create({
        data: { activityId: activities[key], pctComplete: row.pct, status: "approved", approvedBy: live.user.id, approvedAt: when, updatedAt: when },
      });
      await prisma.costRecord.create({
        data: { projectId: project.id, activityId: activities[key], actual: row.ac, actualThroughDate: when },
      });
    }
    return { project, at, auth, activities };
  };

  const createPeriod = async (built, code, cutoffDate) => {
    const created = await api.post(built.at("/reports/periods"), { code, periodStart: "2026-01-01", periodEnd: cutoffDate, cutoffDate }, built.auth);
    expect([code, created.status, created.body?.error]).toEqual([code, 201, undefined]);
    return created.body.data;
  };
  const report = async (built, query) => {
    const response = await api.get(built.at(`/reports/ev${query}`), built.auth);
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data;
  };
  const figures = (data) => ({ pv: data.pv, ev: data.ev, ac: data.ac });

  // 1 November 2026: the day daylight saving ends in Chicago (a 25-hour
  // day, CDT until 02:00 then CST). It ends at 2026-11-02T05:59:59.999Z.
  const CHICAGO_NOV1 = {
    early: "2026-10-15T17:00:00.000Z",
    late: "2026-11-02T05:30:00.000Z", // 23:30 CST, 1 November
    after: "2026-11-02T06:00:30.000Z", // 00:00:30 CST, 2 November
  };

  let chicago;
  let tokyoOrg;

  it("PV, EV and AC are selected against one instant — the end of the cutoff date in the project's zone, which comes first", async () => {
    // The organisation's default is Tokyo; the project's own zone, Chicago, wins.
    tokyoOrg = await newOrg("Asia/Tokyo");
    chicago = await buildProject(tokyoOrg, { name: "Chicago", timezone: "America/Chicago", instants: CHICAGO_NOV1 });
    const period = await createPeriod(chicago, "P11", "2026-11-01");
    const data = await report(chicago, `?periodId=${period.id}`);
    // The figures first: the late rows count for all three, the
    // after-midnight rows for none.
    expect(figures(data)).toEqual(expectedAt(CHICAGO_NOV1, "2026-11-02T05:59:59.999Z"));
    expect(figures(data)).toEqual({ pv: 3000, ev: 5000, ac: 300 });
    // ... then what the report says the instant was, and the stored cutoff.
    expect(data.reporting).toMatchObject({
      cutoffDate: "2026-11-02T05:59:59.999Z",
      cutoffLocalDate: "2026-11-01",
      timeZone: "America/Chicago",
      timeZoneSource: "project",
    });
    expect(period.cutoffDate).toBe("2026-11-02T05:59:59.999Z");
    // ... and the figures built from them follow: SPI = EV / PV, CPI = EV / AC.
    expect(data.spi).toBeCloseTo(5000 / 3000, 6);
    expect(data.cpi).toBeCloseTo(5000 / 300, 6);

    // An ad hoc report for the same calendar date reads the same instant.
    const adHoc = await report(chicago, "?cutoffDate=2026-11-01");
    expect(adHoc.reporting.cutoffDate).toBe("2026-11-02T05:59:59.999Z");
    expect(figures(adHoc)).toEqual(figures(data));
  });

  it("an approval at 23:30 local on the cutoff date stays in that period; one just after local midnight falls in the next", async () => {
    const next = await createPeriod(chicago, "P11b", "2026-11-02");
    const nov1 = await report(chicago, "?cutoffDate=2026-11-01");
    const nov2 = await report(chicago, `?periodId=${next.id}`);
    // The 23:30 approval (40%) is in 1 November's figures, the 00:00:30 one
    // (80%) only in 2 November's.
    expect([nov1.ev, nov2.ev]).toEqual([1000 + 4000, 1000 + 4000 + 8000]);
    expect(figures(nov2)).toEqual(expectedAt(CHICAGO_NOV1, "2026-11-03T05:59:59.999Z"));
    expect(figures(nov2)).toEqual({ pv: 7000, ev: 13000, ac: 700 });
    expect(next.cutoffDate).toBe("2026-11-03T05:59:59.999Z");
    // The after-midnight approval is what moved: 80% of 10,000 on top of the 1 November figures.
    const periods = await api.get(chicago.at("/reports/periods"), chicago.auth);
    const byCode = Object.fromEntries(periods.body.data.periods.map((row) => [row.code, row]));
    expect([byCode.P11.cutoffLocalDate, byCode.P11b.cutoffLocalDate, byCode.P11.timeZone]).toEqual(["2026-11-01", "2026-11-02", "America/Chicago"]);
  });

  it("the organisation's default zone is the fallback when the project has none", async () => {
    // Tokyo: 1 November ends at 2026-11-01T14:59:59.999Z.
    const instants = {
      early: "2026-10-15T03:00:00.000Z",
      late: "2026-11-01T14:30:00.000Z", // 23:30 JST
      after: "2026-11-01T15:00:30.000Z", // 00:00:30 JST, 2 November
    };
    const built = await buildProject(tokyoOrg, { name: "no zone, Tokyo org", timezone: null, instants });
    const period = await createPeriod(built, "P11", "2026-11-01");
    const data = await report(built, `?periodId=${period.id}`);
    expect(figures(data)).toEqual(expectedAt(instants, "2026-11-01T14:59:59.999Z"));
    expect(figures(data)).toEqual({ pv: 3000, ev: 5000, ac: 300 });
    expect(data.reporting).toMatchObject({
      cutoffDate: "2026-11-01T14:59:59.999Z",
      cutoffLocalDate: "2026-11-01",
      timeZone: "Asia/Tokyo",
      timeZoneSource: "organisation",
    });
  });

  it("UTC is the last fallback: no project zone and no organisation default", async () => {
    const plain = await newOrg(null);
    const instants = {
      early: "2026-10-15T12:00:00.000Z",
      late: "2026-11-01T23:30:00.000Z",
      after: "2026-11-02T00:00:30.000Z",
    };
    const built = await buildProject(plain, { name: "no zone anywhere", timezone: null, instants });
    const period = await createPeriod(built, "P11", "2026-11-01");
    const data = await report(built, `?periodId=${period.id}`);
    expect(figures(data)).toEqual(expectedAt(instants, "2026-11-01T23:59:59.999Z"));
    expect(figures(data)).toEqual({ pv: 3000, ev: 5000, ac: 300 });
    expect(data.reporting).toMatchObject({
      cutoffDate: "2026-11-01T23:59:59.999Z",
      cutoffLocalDate: "2026-11-01",
      timeZone: "UTC",
      timeZoneSource: "utc",
    });
  });

  it("the end of the day is right on the day daylight saving begins (America/Chicago, 8 March 2026 — a 23-hour day ending in CDT)", async () => {
    const instants = {
      early: "2026-02-20T18:00:00.000Z",
      late: "2026-03-09T04:30:00.000Z", // 23:30 CDT, 8 March
      after: "2026-03-09T05:00:30.000Z", // 00:00:30 CDT, 9 March
    };
    const built = await buildProject(tokyoOrg, { name: "Chicago spring", timezone: "America/Chicago", instants });
    const period = await createPeriod(built, "P03", "2026-03-08");
    const data = await report(built, `?periodId=${period.id}`);
    expect(figures(data)).toEqual(expectedAt(instants, "2026-03-09T04:59:59.999Z"));
    expect(figures(data)).toEqual({ pv: 3000, ev: 5000, ac: 300 });
    expect(data.reporting.cutoffDate).toBe("2026-03-09T04:59:59.999Z");
    expect(period.cutoffDate).toBe("2026-03-09T04:59:59.999Z");
  });

  it("the Overview's health card and the forecast state and use the same cutoff", async () => {
    const health = await api.get(chicago.at("/health"), chicago.auth);
    expect([health.status, health.body?.error]).toEqual([200, undefined]);
    // The latest period (P11b, 2 November) is the health card's.
    expect(health.body.data.dataFreshness).toMatchObject({
      cutoffDate: "2026-11-03T05:59:59.999Z",
      cutoffLocalDate: "2026-11-02",
      cutoffTimeZone: "America/Chicago",
      cutoffTimeZoneSource: "project",
    });
    const forecast = await api.get(chicago.at("/forecast"), chicago.auth);
    expect([forecast.status, forecast.body?.error]).toEqual([200, undefined]);
    expect(forecast.body.data.earnedValueCutoff).toEqual({
      cutoffDate: "2026-11-03T05:59:59.999Z",
      cutoffLocalDate: "2026-11-02",
      timeZone: "America/Chicago",
      timeZoneSource: "project",
    });
  });

  it("a locked period keeps its stored figures and cutoff: never recomputed, whatever changes after", async () => {
    const period = await createPeriod(chicago, "P10", "2026-10-31");
    const locked = await api.post(chicago.at(`/reports/periods/${period.id}/lock`), { overrideReason: "LiveTest D1: lock over the setup gate" }, chicago.auth);
    expect([locked.status, locked.body?.error]).toEqual([200, undefined]);
    // 31 October ends at 2026-11-01T04:59:59.999Z (CDT): only the early rows.
    expect(locked.body.data.reporting.cutoffDate).toBe("2026-11-01T04:59:59.999Z");
    expect(figures(locked.body.data)).toEqual({ pv: 1000, ev: 1000, ac: 100 });
    const before = await report(chicago, `?periodId=${period.id}`);
    const storedBefore = await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: period.id } });

    // Afterwards: the project moves to Tokyo, and a progress approval is
    // backdated into the period. An open period for the same date would move.
    await prisma.project.update({ where: { id: chicago.project.id }, data: { timezone: "Asia/Tokyo" } });
    await prisma.activityProgress.create({
      data: { activityId: chicago.activities.early, pctComplete: 60, status: "approved", approvedAt: new Date("2026-10-20T12:00:00Z"), updatedAt: new Date("2026-10-20T12:00:00Z") },
    });
    const open = await report(chicago, "?cutoffDate=2026-10-31");
    expect(open.reporting).toMatchObject({ cutoffDate: "2026-10-31T14:59:59.999Z", timeZone: "Asia/Tokyo" });
    expect(open.ev).toBe(6000);

    const after = await report(chicago, `?periodId=${period.id}`);
    expect(after).toEqual(before);
    expect(after.reporting.isSnapshot).toBe(true);
    expect(figures(after)).toEqual({ pv: 1000, ev: 1000, ac: 100 });
    const storedAfter = await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: period.id } });
    expect(storedAfter).toEqual(storedBefore);
    await prisma.project.update({ where: { id: chicago.project.id }, data: { timezone: "America/Chicago" } });
  });
});
