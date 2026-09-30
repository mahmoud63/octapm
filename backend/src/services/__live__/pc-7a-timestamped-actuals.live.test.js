/**
 * PC-7a item 3c (owner decision 2026-09-28) — a cost that happens at an
 * INSTANT lands in the reporting period of the project's reporting day, the
 * same day PV/EV/AC are cut on. Proven with real calculations against a real
 * API process and the real local Postgres.
 *
 * A material issue carries the moment the stock left (StockTransaction.
 * occurredAt). The cost ledger stores incurredOn as a CALENDAR DATE, and
 * official AC selects by that date (PC-4's date-only rule). Before 3c the
 * issue's raw instant was stored: 23:30 in Chicago is 04:30/05:30 UTC the
 * next day, so the cost fell out of the period in which the progress approved
 * at the same moment was counted. Now the writer says it has an instant
 * (cost-ledger `incurredAt`), and the ledger dates it in Project.timezone →
 * Organisation.defaultTimezone → UTC — the resolution utils/reporting-cutoff
 * gives PV, EV and AC.
 *
 * Each project has three activities allocated 10,000 each. On each, one
 * progress approval (EV) and one stock issue (AC) happen at the SAME moment:
 *
 *   early — well inside the period
 *   late  — 23:30 local on the cutoff date (must count, EV and AC alike)
 *   after — 00:30 local the next day (must not count, EV and AC alike)
 *
 * The issue goes through POST /inventory/stock/issue (the real writer, the
 * real weighted average); the progress row is written directly because an
 * approval through the API is stamped "now". Three projects: UTC (no zone
 * anywhere), America/Chicago on a CDT date, America/Chicago on a CST date.
 * Then a locked period: a later back-dated issue moves a recomputation, never
 * the snapshot.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; the only writes outside the API are to its own rows.
 *
 *   npm run test:live -- src/services/__live__/pc-7a-timestamped-actuals.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const UNIT_COST = 10;
// Per activity: the percent approved (EV = 10,000 × pct) and the quantity
// issued (AC = qty × 10 at the weighted average of a single receipt).
const ROWS = {
  early: { pct: 10, qty: 10 },
  late: { pct: 40, qty: 20 },
  after: { pct: 80, qty: 40 },
};
const EV_OF = (keys) => keys.reduce((sum, key) => sum + 100 * ROWS[key].pct, 0);
const AC_OF = (keys) => keys.reduce((sum, key) => sum + ROWS[key].qty * UNIT_COST, 0);

const SCENARIOS = {
  UTC: {
    timezone: null,
    cutoff: "2026-06-15",
    next: "2026-06-16",
    early: "2026-06-10T12:00:00.000Z",
    late: "2026-06-15T23:30:00.000Z",
    after: "2026-06-16T00:30:00.000Z",
    dates: { early: "2026-06-10", late: "2026-06-15", after: "2026-06-16" },
  },
  CDT: {
    timezone: "America/Chicago",
    cutoff: "2026-06-15",
    next: "2026-06-16",
    early: "2026-06-10T17:00:00.000Z",
    late: "2026-06-16T04:30:00.000Z", // 23:30 CDT, 15 June
    after: "2026-06-16T05:30:00.000Z", // 00:30 CDT, 16 June
    dates: { early: "2026-06-10", late: "2026-06-15", after: "2026-06-16" },
  },
  CST: {
    timezone: "America/Chicago",
    cutoff: "2026-01-20",
    next: "2026-01-21",
    early: "2026-01-15T18:00:00.000Z",
    late: "2026-01-21T05:30:00.000Z", // 23:30 CST, 20 January
    after: "2026-01-21T06:30:00.000Z", // 00:30 CST, 21 January
    dates: { early: "2026-01-15", late: "2026-01-20", after: "2026-01-21" },
  },
};

liveDescribe("PC-7a 3c: timed actuals are dated on the project's reporting day, as PV/EV/AC are cut", () => {
  let live;
  let api;
  const built = {};

  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const send = async (route, body, expected = 201) => {
    const response = await api.post(route, body, auth());
    expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
    return response.body.data;
  };
  const report = async (key, query) => {
    const response = await api.get(`/api/v1/projects/${built[key].project.id}/reports/ev${query}`, auth());
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data;
  };
  const figures = (data) => ({ ev: data.ev, ac: data.ac });
  const issue = (key, activityId, qty, occurredAt) =>
    send("/api/v1/inventory/stock/issue", {
      itemId: built[key].itemId,
      warehouseId: built[key].warehouseId,
      quantity: qty,
      projectId: built[key].project.id,
      activityId,
      occurredAt,
    });
  const ledgerDates = async (key) => {
    const rows = await prisma.costLedgerEntry.findMany({ where: { projectId: built[key].project.id, sourceType: "material_issue" }, select: { activityId: true, incurredOn: true } });
    return Object.fromEntries(
      Object.entries(built[key].activities).map(([name, id]) => [name, rows.filter((row) => row.activityId === id).map((row) => row.incurredOn.toISOString())]),
    );
  };

  const buildScenario = async (key) => {
    const scenario = SCENARIOS[key];
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest PC-7a 3c ${key}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18"), ...(scenario.timezone ? { timezone: scenario.timezone } : {}) },
    });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    built[key] = { project, activities: {} };
    const stamp = `${key}${Date.now().toString(36)}`;
    const warehouse = await send("/api/v1/inventory/warehouses", { code: `W${stamp}`.slice(0, 30), name: `LiveTest store ${key}`, kind: "site", projectId: project.id });
    const item = await send("/api/v1/inventory/items", { sku: `LT3C-${stamp}`, name: "LiveTest cement", unit: "bag" });
    built[key].warehouseId = warehouse.id;
    built[key].itemId = item.id;
    await send("/api/v1/inventory/stock/receive", { itemId: item.id, warehouseId: warehouse.id, quantity: 1000, unitCost: UNIT_COST, projectId: project.id });

    const boq = await send(at("/boq/items"), { code: "1.1", description: "Concrete", quantity: 300, unit: "m3", rate: 100 });
    for (const [index, name] of Object.keys(ROWS).entries()) {
      const activity = await send(at("/activities"), { name: `Activity ${name}`, activityCode: `T${index + 1}00`, duration: 5, startDate: "2026-01-05", endDate: "2026-01-09", engineerIds: [live.user.id] });
      const allocation = await send(at("/activity-boq-allocations"), { boqItemId: boq.item.id, activityId: activity.id, quantity: 100 });
      for (const step of ["submit", "approve"]) await send(at(`/activity-boq-allocations/${allocation.id}/${step}`), {}, 200);
      built[key].activities[name] = activity.id;
    }
    for (const [name, row] of Object.entries(ROWS)) {
      const when = new Date(scenario[name]);
      // The approval moment itself (an API approval would be stamped now).
      await prisma.activityProgress.create({
        data: { activityId: built[key].activities[name], pctComplete: row.pct, status: "approved", approvedBy: live.user.id, approvedAt: when, updatedAt: when },
      });
      // The issue at the same moment, through the real writer.
      await issue(key, built[key].activities[name], row.qty, scenario[name]);
    }
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ TZ: "Asia/Kolkata", DATABASE_CONNECTION_LIMIT: "4" });
    for (const key of Object.keys(SCENARIOS)) await buildScenario(key);
  }, 300_000);

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

  for (const key of Object.keys(SCENARIOS)) {
    it(`${key}: an issue at 23:30 local on the cutoff date counts with the progress approved then; 00:30 the next local day counts with neither`, async () => {
      const scenario = SCENARIOS[key];
      // The ledger dated each issue on its local reporting day, 00:00 UTC.
      expect(await ledgerDates(key)).toEqual({
        early: [`${scenario.dates.early}T00:00:00.000Z`],
        late: [`${scenario.dates.late}T00:00:00.000Z`],
        after: [`${scenario.dates.after}T00:00:00.000Z`],
      });
      // The cutoff date: early and late for EV and AC alike, after for neither.
      const onCutoff = await report(key, `?cutoffDate=${scenario.cutoff}`);
      expect(figures(onCutoff)).toEqual({ ev: EV_OF(["early", "late"]), ac: AC_OF(["early", "late"]) });
      expect(onCutoff.reporting).toMatchObject({ cutoffLocalDate: scenario.cutoff, timeZone: scenario.timezone || "UTC" });
      if (!scenario.timezone) expect(onCutoff.reporting.timeZoneNote).toBe("Project timezone is not configured; UTC is being used");
      // The next local day: all three, for both.
      const onNext = await report(key, `?cutoffDate=${scenario.next}`);
      expect(figures(onNext)).toEqual({ ev: EV_OF(["early", "late", "after"]), ac: AC_OF(["early", "late", "after"]) });
    });
  }

  it("a locked period never moves: a later issue back-dated into it moves a recomputation, not the snapshot", async () => {
    const key = "CDT";
    const at = (route) => `/api/v1/projects/${built[key].project.id}${route}`;
    const period = await send(at("/reports/periods"), { code: "P06", periodStart: "2026-06-01", periodEnd: "2026-06-15", cutoffDate: "2026-06-15" });
    const periodId = period.id || period.period?.id;
    await send(at(`/reports/periods/${periodId}/lock`), { overrideReason: "LiveTest PC-7a 3c: lock over the setup gate" }, 200);
    const locked = await report(key, `?periodId=${periodId}`);
    expect(locked.reporting.isSnapshot).toBe(true);
    expect(figures(locked)).toEqual({ ev: EV_OF(["early", "late"]), ac: AC_OF(["early", "late"]) });
    const stored = JSON.stringify(await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: periodId } }));

    // 20:00 CDT on 15 June, keyed after the lock, onto the early activity.
    await issue(key, built[key].activities.early, 5, "2026-06-16T01:00:00.000Z");
    const recomputed = await report(key, "?cutoffDate=2026-06-15");
    expect(recomputed.ac).toBe(AC_OF(["early", "late"]) + 5 * UNIT_COST);
    const again = await report(key, `?periodId=${periodId}`);
    expect(figures(again)).toEqual(figures(locked));
    expect(JSON.stringify(await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: periodId } }))).toBe(stored);
  });

  it("an issue with a malformed time is refused before anything is written", async () => {
    const before = await prisma.costLedgerEntry.count({ where: { projectId: built.UTC.project.id } });
    const response = await api.post("/api/v1/inventory/stock/issue", { itemId: built.UTC.itemId, warehouseId: built.UTC.warehouseId, quantity: 1, projectId: built.UTC.project.id, activityId: built.UTC.activities.early, occurredAt: "not a time" }, auth());
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(await prisma.costLedgerEntry.count({ where: { projectId: built.UTC.project.id } })).toBe(before);
  });
});
