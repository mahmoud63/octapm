/**
 * PC-4, owner decision D1 and the owner's correction (2026-09-27) — the EV
 * reporting cutoff, proven with real calculations against a real API process
 * and the real local Postgres.
 *
 * A reporting period's cutoff is a calendar date, kept as entered. It ends at
 * the END OF THAT DATE in Project.timezone, else the workspace's
 * Organisation.defaultTimezone, else UTC — computed for that date from the
 * zone's own rules, daylight saving included, never a fixed offset. PV, EV
 * and AC are all selected against that one instant. When the project has no
 * zone of its own the server says so ("Project timezone is not configured;
 * UTC is being used", or the organisation default it used). A locked period
 * answers with its stored snapshot, never recomputed.
 *
 * The server's own zone plays no part: the API here runs in Asia/Kolkata
 * (TZ), a zone no project or organisation below uses, so the old server-local
 * end of day gives a different instant in every case.
 *
 * Each project has three activities with a 10,000 approved allocation each.
 * Every activity carries one approved cost loading (PV), one approved
 * progress row (EV) and one cost record (AC), all dated at the SAME instant:
 *
 *   early  — well inside the period
 *   late   — just inside: 23:30 local on the cutoff date (must count)
 *   after  — just outside: shortly after local midnight (must not)
 *
 * so PV, EV and AC each move together only if they share the cutoff. The
 * expected figures are recomputed here from those rows and the expected
 * cutoff instant, never read off the report.
 *
 * Everything lives in throwaway "LiveTest <uuid>" organisations dropped
 * afterwards; the only writes outside the API are to their own rows, one
 * known row at a time by its unique key.
 *
 *   npm run test:live -- src/services/__live__/pc-4-ev-cutoff.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const SERVER_TZ = "Asia/Kolkata";
const BUDGET_PER_ACTIVITY = 10000;
const UTC_NOTE = "Project timezone is not configured; UTC is being used";
const orgNote = (zone) => `Project timezone is not configured; the organisation default ${zone} is being used`;

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

// The late rows count for all three figures, the after-midnight rows for none.
const LATE_IN_AFTER_OUT = { pv: 3000, ev: 5000, ac: 300 };

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

  /** This test's own project, one known row by its unique key. */
  const setProjectZone = (project, timezone) => prisma.project.update({ where: { id: project.id }, data: { timezone } });

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
    const activities = {};
    if (instants) {
      const item = await post(at("/boq/items"), { code: "1.1", description: "Concrete", quantity: 300, unit: "m3", rate: 100 });
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
    }
    return { project, at, auth, activities, live };
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
  const periodsOf = async (built) => {
    const response = await api.get(built.at("/reports/periods"), built.auth);
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data;
  };
  const periodByCode = async (built, code) => (await periodsOf(built)).periods.find((row) => row.code === code);
  const figures = (data) => ({ pv: data.pv, ev: data.ev, ac: data.ac });
  /** The instant each figure's rows were selected against, and the report's. */
  const instantsUsed = (data) => ({
    reported: data.reporting.cutoffDate,
    pv: data.sourceSummary.pv.selectedThrough,
    ev: data.sourceSummary.ev.selectedThrough,
    ac: data.sourceSummary.ac.selectedThrough,
  });

  // 1 November 2026: the day daylight saving ends in Chicago (a 25-hour
  // day, CDT until 02:00 then CST). It ends at 2026-11-02T05:59:59.999Z.
  const CHICAGO_NOV1 = {
    early: "2026-10-15T17:00:00.000Z",
    late: "2026-11-02T05:30:00.000Z", // 23:30 CST, 1 November
    after: "2026-11-02T06:00:30.000Z", // 00:00:30 CST, 2 November
  };

  let chicago;
  let tokyoOrg;

  it("(d) Project.timezone overrides a different Organisation.defaultTimezone: PV, EV and AC are cut at the end of the date in the project's zone", async () => {
    // The organisation's default is Tokyo; the project's own zone, Chicago, wins.
    tokyoOrg = await newOrg("Asia/Tokyo");
    chicago = await buildProject(tokyoOrg, { name: "Chicago", timezone: "America/Chicago", instants: CHICAGO_NOV1 });
    const period = await createPeriod(chicago, "P11", "2026-11-01");
    const data = await report(chicago, `?periodId=${period.id}`);
    // The figures first: the late rows count for all three, the
    // after-midnight rows for none. In Tokyo, 1 November would have ended at
    // 2026-11-01T14:59:59.999Z and counted only the early rows.
    expect(figures(data)).toEqual(expectedAt(CHICAGO_NOV1, "2026-11-02T05:59:59.999Z"));
    expect(figures(data)).toEqual(LATE_IN_AFTER_OUT);
    // ... then what the report says the instant was, and the created period.
    expect(data.reporting).toMatchObject({
      cutoffDate: "2026-11-02T05:59:59.999Z",
      cutoffLocalDate: "2026-11-01",
      timeZone: "America/Chicago",
      timeZoneSource: "project",
      timeZoneNote: null,
    });
    expect(data.basisWarnings.filter((warning) => warning.startsWith("Project timezone"))).toEqual([]);
    expect(period).toMatchObject({ cutoffDate: "2026-11-02T05:59:59.999Z", cutoffLocalDate: "2026-11-01", timeZone: "America/Chicago" });
    // ... and the figures built from them follow: SPI = EV / PV, CPI = EV / AC.
    expect(data.spi).toBeCloseTo(5000 / 3000, 6);
    expect(data.cpi).toBeCloseTo(5000 / 300, 6);

    // An ad hoc report for the same calendar date reads the same instant.
    const adHoc = await report(chicago, "?cutoffDate=2026-11-01");
    expect(adHoc.reporting.cutoffDate).toBe("2026-11-02T05:59:59.999Z");
    expect(figures(adHoc)).toEqual(figures(data));
  });

  it("(c) an approval at 23:30 local on the cutoff date stays in that period; one just after local midnight falls in the next (America/Chicago, the day DST ends)", async () => {
    const next = await createPeriod(chicago, "P11b", "2026-11-02");
    const nov1 = await report(chicago, "?cutoffDate=2026-11-01");
    const nov2 = await report(chicago, `?periodId=${next.id}`);
    // The 23:30 approval (40%) is in 1 November's figures, the 00:00:30 one
    // (80%) only in 2 November's.
    expect([nov1.ev, nov2.ev]).toEqual([1000 + 4000, 1000 + 4000 + 8000]);
    expect(figures(nov2)).toEqual(expectedAt(CHICAGO_NOV1, "2026-11-03T05:59:59.999Z"));
    expect(figures(nov2)).toEqual({ pv: 7000, ev: 13000, ac: 700 });
    expect(next.cutoffDate).toBe("2026-11-03T05:59:59.999Z");
    const periods = await periodsOf(chicago);
    const byCode = Object.fromEntries(periods.periods.map((row) => [row.code, row]));
    expect([byCode.P11.cutoffLocalDate, byCode.P11b.cutoffLocalDate, byCode.P11.timeZone]).toEqual(["2026-11-01", "2026-11-02", "America/Chicago"]);
    expect([byCode.P11.cutoffDate, byCode.P11b.cutoffDate]).toEqual(["2026-11-02T05:59:59.999Z", "2026-11-03T05:59:59.999Z"]);
    expect(periods).toMatchObject({ timeZone: "America/Chicago", timeZoneSource: "project", timeZoneNote: null });
  });

  it("(c) an approval at 23:30 project-local time on the cutoff day is counted; one at 00:30 the next local day is in the next period (Asia/Dubai, a zone other than the server's)", async () => {
    // Dubai (+04:00, no DST): 31 July ends at 2026-07-31T19:59:59.999Z.
    const instants = {
      early: "2026-07-10T08:00:00.000Z",
      late: "2026-07-31T19:30:00.000Z", // 23:30 GST, 31 July
      after: "2026-07-31T20:30:00.000Z", // 00:30 GST, 1 August
    };
    const built = await buildProject(tokyoOrg, { name: "Dubai", timezone: "Asia/Dubai", instants });
    const july = await createPeriod(built, "P07", "2026-07-31");
    const august = await createPeriod(built, "P08", "2026-08-01");
    const julyReport = await report(built, `?periodId=${july.id}`);
    const augustReport = await report(built, `?periodId=${august.id}`);
    expect(julyReport.reporting).toMatchObject({ cutoffDate: "2026-07-31T19:59:59.999Z", cutoffLocalDate: "2026-07-31", timeZone: "Asia/Dubai" });
    expect(figures(julyReport)).toEqual(expectedAt(instants, "2026-07-31T19:59:59.999Z"));
    expect(figures(julyReport)).toEqual(LATE_IN_AFTER_OUT);
    // The 00:30 approval (80% of 10,000) is August's, not July's.
    expect(augustReport.reporting.cutoffDate).toBe("2026-08-01T19:59:59.999Z");
    expect(augustReport.ev - julyReport.ev).toBe(8000);
    expect(figures(augustReport)).toEqual({ pv: 7000, ev: 13000, ac: 700 });
  });

  it("(e) Organisation.defaultTimezone is used when the project has none, and the report says so", async () => {
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
    expect(figures(data)).toEqual(LATE_IN_AFTER_OUT);
    expect(data.reporting).toMatchObject({
      cutoffDate: "2026-11-01T14:59:59.999Z",
      cutoffLocalDate: "2026-11-01",
      timeZone: "Asia/Tokyo",
      timeZoneSource: "organisation",
      timeZoneNote: orgNote("Asia/Tokyo"),
    });
    expect(data.basisWarnings).toContain(orgNote("Asia/Tokyo"));
  });

  it("(f) UTC is the final fallback when neither the project nor the organisation has a zone, and every surface stating the cutoff carries the note \"Project timezone is not configured; UTC is being used\"", async () => {
    const plain = await newOrg(null);
    const instants = {
      early: "2026-10-15T12:00:00.000Z",
      late: "2026-11-01T23:30:00.000Z",
      after: "2026-11-02T00:00:30.000Z",
    };
    const built = await buildProject(plain, { name: "no zone anywhere", timezone: null, instants });
    const period = await createPeriod(built, "P11", "2026-11-01");
    expect(period).toMatchObject({ cutoffDate: "2026-11-01T23:59:59.999Z", timeZone: "UTC", timeZoneSource: "utc", timeZoneNote: UTC_NOTE });
    const data = await report(built, `?periodId=${period.id}`);
    expect(figures(data)).toEqual(expectedAt(instants, "2026-11-01T23:59:59.999Z"));
    expect(figures(data)).toEqual(LATE_IN_AFTER_OUT);
    expect(data.reporting).toMatchObject({
      cutoffDate: "2026-11-01T23:59:59.999Z",
      cutoffLocalDate: "2026-11-01",
      timeZone: "UTC",
      timeZoneSource: "utc",
      timeZoneNote: UTC_NOTE,
    });
    // The EV report's basis warnings ...
    expect(data.basisWarnings).toContain(UTC_NOTE);
    // ... the reporting periods, the list and each period ...
    const periods = await periodsOf(built);
    expect(periods).toMatchObject({ timeZone: "UTC", timeZoneSource: "utc", timeZoneNote: UTC_NOTE });
    expect(periods.periods.find((row) => row.code === "P11")).toMatchObject({ cutoffDate: "2026-11-01T23:59:59.999Z", timeZoneNote: UTC_NOTE });
    // ... the Overview's health card ...
    const health = await api.get(built.at("/health"), built.auth);
    expect([health.status, health.body?.error]).toEqual([200, undefined]);
    expect(health.body.data.dataFreshness).toMatchObject({ cutoffTimeZone: "UTC", cutoffTimeZoneSource: "utc", cutoffTimeZoneNote: UTC_NOTE });
    // ... the forecast, beside its cutoff and in its data quality ...
    const forecast = await api.get(built.at("/forecast"), built.auth);
    expect([forecast.status, forecast.body?.error]).toEqual([200, undefined]);
    expect(forecast.body.data.earnedValueCutoff).toMatchObject({ timeZone: "UTC", timeZoneNote: UTC_NOTE });
    expect(forecast.body.data.dataQuality).toContain(UTC_NOTE);
    // ... and the workspace home's official cutoff (this organisation's one project).
    const home = await api.get("/api/v1/projects/workspace-dashboard", built.auth);
    expect([home.status, home.body?.error]).toEqual([200, undefined]);
    expect(home.body.data.dataFreshness).toMatchObject({
      cutoffDate: "2026-11-01T23:59:59.999Z",
      cutoffLocalDate: "2026-11-01",
      cutoffTimeZone: "UTC",
      cutoffTimeZoneSource: "utc",
      cutoffTimeZoneNote: UTC_NOTE,
    });
  });

  it("(a) a cutoff date during daylight saving time (America/Chicago, 31 July 2026, CDT) ends at 2026-08-01T04:59:59.999Z: a row at 23:30 CDT counts, one at 00:30 CDT the next day does not", async () => {
    const instants = {
      early: "2026-07-15T17:00:00.000Z",
      late: "2026-08-01T04:30:00.000Z", // 23:30 CDT, 31 July
      after: "2026-08-01T05:30:00.000Z", // 00:30 CDT, 1 August
    };
    const built = await buildProject(tokyoOrg, { name: "Chicago summer", timezone: "America/Chicago", instants });
    const period = await createPeriod(built, "P07", "2026-07-31");
    const data = await report(built, `?periodId=${period.id}`);
    expect(data.reporting).toMatchObject({ cutoffDate: "2026-08-01T04:59:59.999Z", cutoffLocalDate: "2026-07-31" });
    expect(figures(data)).toEqual(expectedAt(instants, "2026-08-01T04:59:59.999Z"));
    expect(figures(data)).toEqual(LATE_IN_AFTER_OUT);
  });

  it("(b) a cutoff date outside daylight saving time (America/Chicago, 31 January 2026, CST) ends at 2026-02-01T05:59:59.999Z: a row at 05:30Z (23:30 CST) counts, one at 06:30Z does not", async () => {
    const instants = {
      early: "2026-01-15T18:00:00.000Z",
      late: "2026-02-01T05:30:00.000Z", // 23:30 CST, 31 January
      after: "2026-02-01T06:30:00.000Z", // 00:30 CST, 1 February
    };
    const built = await buildProject(tokyoOrg, { name: "Chicago winter", timezone: "America/Chicago", instants });
    const period = await createPeriod(built, "P01", "2026-01-31");
    const data = await report(built, `?periodId=${period.id}`);
    expect(data.reporting).toMatchObject({ cutoffDate: "2026-02-01T05:59:59.999Z", cutoffLocalDate: "2026-01-31" });
    expect(figures(data)).toEqual(expectedAt(instants, "2026-02-01T05:59:59.999Z"));
    expect(figures(data)).toEqual(LATE_IN_AFTER_OUT);
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
    expect(figures(data)).toEqual(LATE_IN_AFTER_OUT);
    expect(data.reporting.cutoffDate).toBe("2026-03-09T04:59:59.999Z");
    expect(period.cutoffDate).toBe("2026-03-09T04:59:59.999Z");
  });

  it("(g) PV, EV and AC are selected against the identical cutoff instant (Pacific/Auckland, 31 July 2026 — NZST, ends 2026-07-31T11:59:59.999Z)", async () => {
    const instants = {
      early: "2026-07-10T00:00:00.000Z",
      late: "2026-07-31T11:30:00.000Z", // 23:30 NZST, 31 July
      after: "2026-07-31T12:30:00.000Z", // 00:30 NZST, 1 August
    };
    const built = await buildProject(tokyoOrg, { name: "Auckland", timezone: "Pacific/Auckland", instants });
    const period = await createPeriod(built, "P07", "2026-07-31");
    for (const data of [await report(built, `?periodId=${period.id}`), await report(built, "?cutoffDate=2026-07-31")]) {
      // The instant each figure was selected against — one and the same ...
      expect(instantsUsed(data)).toEqual({
        reported: "2026-07-31T11:59:59.999Z",
        pv: "2026-07-31T11:59:59.999Z",
        ev: "2026-07-31T11:59:59.999Z",
        ac: "2026-07-31T11:59:59.999Z",
      });
      // ... and the figures prove it: each of PV, EV and AC has its late row
      // in and its after-midnight row out.
      expect(figures(data)).toEqual(expectedAt(instants, "2026-07-31T11:59:59.999Z"));
      expect(figures(data)).toEqual(LATE_IN_AFTER_OUT);
    }
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
      cutoffTimeZoneNote: null,
    });
    const forecast = await api.get(chicago.at("/forecast"), chicago.auth);
    expect([forecast.status, forecast.body?.error]).toEqual([200, undefined]);
    expect(forecast.body.data.earnedValueCutoff).toEqual({
      cutoffDate: "2026-11-03T05:59:59.999Z",
      cutoffLocalDate: "2026-11-02",
      timeZone: "America/Chicago",
      timeZoneSource: "project",
      timeZoneNote: null,
    });
  });

  it("(h) a locked period's stored snapshot is returned unchanged after the zone changes and after rows are added around its cutoff", async () => {
    const period = await createPeriod(chicago, "P10", "2026-10-31");
    const locked = await api.post(chicago.at(`/reports/periods/${period.id}/lock`), { overrideReason: "LiveTest D1: lock over the setup gate" }, chicago.auth);
    expect([locked.status, locked.body?.error]).toEqual([200, undefined]);
    // 31 October ends at 2026-11-01T04:59:59.999Z (CDT): only the early rows.
    expect(locked.body.data.reporting.cutoffDate).toBe("2026-11-01T04:59:59.999Z");
    expect(figures(locked.body.data)).toEqual({ pv: 1000, ev: 1000, ac: 100 });
    const before = await report(chicago, `?periodId=${period.id}`);
    const listedBefore = await periodByCode(chicago, "P10");
    const storedBefore = await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: period.id } });

    // Afterwards: rows land just inside and just outside its cutoff in
    // Chicago — a cost loading at 23:30 CDT on 31 October and one at 00:30
    // CDT on 1 November; the late activity's cost record (one per activity,
    // this test's own row by its unique key) now runs through 23:30 CDT on
    // 31 October, the after activity's through 00:30 CDT on 1 November —
    // and a progress approval is backdated well inside it ...
    const inside = new Date("2026-11-01T04:30:00.000Z");
    const outside = new Date("2026-11-01T05:30:00.000Z");
    for (const when of [inside, outside]) {
      await prisma.activityCostLoading.create({
        data: { projectId: chicago.project.id, activityId: chicago.activities.early, plannedDate: when, plannedValue: 500, status: "approved", approvedAt: when },
      });
    }
    await prisma.costRecord.update({
      where: { projectId_activityId: { projectId: chicago.project.id, activityId: chicago.activities.late } },
      data: { actual: 250, actualThroughDate: inside },
    });
    await prisma.costRecord.update({
      where: { projectId_activityId: { projectId: chicago.project.id, activityId: chicago.activities.after } },
      data: { actualThroughDate: outside },
    });
    await prisma.activityProgress.create({
      data: { activityId: chicago.activities.early, pctComplete: 60, status: "approved", approvedAt: new Date("2026-10-20T12:00:00Z"), updatedAt: new Date("2026-10-20T12:00:00Z") },
    });
    // ... an open calculation for the same date moves with them ...
    const openChicago = await report(chicago, "?cutoffDate=2026-10-31");
    expect(openChicago.reporting.cutoffDate).toBe("2026-11-01T04:59:59.999Z");
    expect(figures(openChicago)).toEqual({ pv: 1000 + 500, ev: 6000, ac: 100 + 250 });

    // ... and the project's zone changes to Tokyo, then is cleared (UTC).
    for (const zone of ["Asia/Tokyo", null]) {
      await setProjectZone(chicago.project, zone);
      const open = await report(chicago, "?cutoffDate=2026-10-31");
      expect(open.reporting.timeZone).toBe(zone === null ? "Asia/Tokyo" : zone); // the organisation's default is Tokyo
      const after = await report(chicago, `?periodId=${period.id}`);
      expect(after).toEqual(before);
      expect(after.reporting.isSnapshot).toBe(true);
      expect(figures(after)).toEqual({ pv: 1000, ev: 1000, ac: 100 });
      expect(after.reporting).toMatchObject({ cutoffDate: "2026-11-01T04:59:59.999Z", cutoffLocalDate: "2026-10-31", timeZone: "America/Chicago" });
      // The list states the snapshot's instant and zone, not today's.
      expect(await periodByCode(chicago, "P10")).toEqual(listedBefore);
      const storedAfter = await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: period.id } });
      expect(storedAfter).toEqual(storedBefore);
    }
    await setProjectZone(chicago.project, "America/Chicago");
  });

  it("(1b) a legacy-shaped period — stored at 04:59:59.999Z (a CDT date) or 05:59:59.999Z (a CST date) on the typed date — reads back as the typed date and ends at the end of that date in UTC, America/Chicago and Asia/Dubai", async () => {
    const legacyOrg = await newOrg(null);
    const built = await buildProject(legacyOrg, { name: "legacy periods", timezone: null });
    // As the base code stored them (a date-only value parsed as UTC
    // midnight, then 23:59:59.999 in the server's America/Chicago zone):
    // typed 2026-08-31 -> 2026-08-31T04:59:59.999Z, typed 2026-01-31 ->
    // 2026-01-31T05:59:59.999Z. This test's own rows.
    await prisma.reportingPeriod.create({
      data: { projectId: built.project.id, code: "L08", label: "L08", periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"), cutoffDate: new Date("2026-08-31T04:59:59.999Z") },
    });
    await prisma.reportingPeriod.create({
      data: { projectId: built.project.id, code: "L01", label: "L01", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31"), cutoffDate: new Date("2026-01-31T05:59:59.999Z") },
    });
    const expected = {
      UTC: { L08: "2026-08-31T23:59:59.999Z", L01: "2026-01-31T23:59:59.999Z" },
      "America/Chicago": { L08: "2026-09-01T04:59:59.999Z", L01: "2026-02-01T05:59:59.999Z" },
      "Asia/Dubai": { L08: "2026-08-31T19:59:59.999Z", L01: "2026-01-31T19:59:59.999Z" },
    };
    const typed = { L08: "2026-08-31", L01: "2026-01-31" };
    for (const zone of ["UTC", "America/Chicago", "Asia/Dubai"]) {
      await setProjectZone(built.project, zone === "UTC" ? null : zone);
      const listed = await periodsOf(built);
      for (const code of ["L08", "L01"]) {
        const row = listed.periods.find((entry) => entry.code === code);
        expect([zone, code, row.cutoffLocalDate, row.cutoffDate, row.timeZone]).toEqual([zone, code, typed[code], expected[zone][code], zone]);
        const data = await report(built, `?periodId=${row.id}`);
        expect([zone, code, data.reporting.cutoffLocalDate, data.reporting.cutoffDate]).toEqual([zone, code, typed[code], expected[zone][code]]);
      }
    }
  });

  it("(1b) a period keeps the date it was entered with when the project's zone changes: created under UTC, read under America/Chicago and Pacific/Auckland; created under America/Chicago, read under UTC", async () => {
    const zoneOrg = await newOrg(null);
    const built = await buildProject(zoneOrg, { name: "zone changes", timezone: null });
    const underUtc = await createPeriod(built, "U08", "2026-08-31");
    expect(underUtc).toMatchObject({ cutoffLocalDate: "2026-08-31", cutoffDate: "2026-08-31T23:59:59.999Z", timeZone: "UTC" });
    const readings = [
      ["America/Chicago", "2026-09-01T04:59:59.999Z"], // CDT, -05:00
      ["Pacific/Auckland", "2026-08-31T11:59:59.999Z"], // NZST, +12:00
    ];
    for (const [zone, instant] of readings) {
      await setProjectZone(built.project, zone);
      const row = await periodByCode(built, "U08");
      expect([zone, row.cutoffLocalDate, row.cutoffDate]).toEqual([zone, "2026-08-31", instant]);
    }
    await setProjectZone(built.project, "America/Chicago");
    const underChicago = await createPeriod(built, "C08", "2026-08-31");
    expect(underChicago).toMatchObject({ cutoffLocalDate: "2026-08-31", cutoffDate: "2026-09-01T04:59:59.999Z", timeZone: "America/Chicago" });
    await setProjectZone(built.project, null);
    const back = await periodByCode(built, "C08");
    expect([back.cutoffLocalDate, back.cutoffDate, back.timeZone]).toEqual(["2026-08-31", "2026-08-31T23:59:59.999Z", "UTC"]);
  });
});
