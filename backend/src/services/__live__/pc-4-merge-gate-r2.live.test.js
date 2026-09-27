/**
 * PC-4 merge gate, round 2 — the confirmed findings, proven against a real
 * API process and the real local Postgres.
 *
 *   1. Calendar-date fields (D1 date-only rule, 2026-09-27). A cost loading's
 *      plannedDate and a cost record's actualThroughDate (fed by the ledger's
 *      incurredOn — a direct cost's costDate) arrive as dates and are stored
 *      at 00:00 UTC of the date. A row counts toward a period when its date is
 *      on or before the period's cutoff date, and one dated the day after
 *      never counts — in a zone west of UTC (America/Chicago), where the next
 *      date's 00:00 UTC falls before the local end of the cutoff date, and in
 *      one east of it (Pacific/Auckland). Written through the product API.
 *   2. A locked latest period feeds the forecast its stored snapshot: the
 *      health card, the EV report and the forecast give one CPI, one EAC and
 *      one cutoff instant and zone — after a late-keyed actual and a change of
 *      the project's zone.
 *   3. A period whose cutoff has not been reached says so.
 *   4. Schedule-revision refusals a user can act on: SCHEDULE_NOT_READY names
 *      the failing check and where to fix it; INVALID_REVISION_STATUS says
 *      where the revision stands now, in the screen's words.
 *   5. BOQ-revision refusals in BOQ words (a stale Approve on a locked
 *      revision, an approval before submission), never the internal record
 *      type and raw status tokens.
 *   6. A member without BOQ read receives none of the BOQ revision's row
 *      counts in setup readiness; a BOQ reader receives them all.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; the only writes outside the API are to its own rows, one known
 * row at a time by its unique key.
 *
 *   npm run test:live -- src/services/__live__/pc-4-merge-gate-r2.live.test.js
 */
const fs = require("fs");
const path = require("path");
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const CONSTRUCTION_BOQ = path.resolve(__dirname, "..", "..", "..", "..", "docs", "Construction_BOQ.xlsx");
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Every key path in `value` whose key is in `keys`. */
const keyPaths = (value, keys, at = "") =>
  value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, inner]) => [...(keys.has(key) ? [`${at}.${key}`] : []), ...keyPaths(inner, keys, `${at}.${key}`)])
    : [];

liveDescribe("PC-4 merge gate round 2: date-only cutoff, locked forecast, refusals, BOQ revision counts", () => {
  let live;
  let api;
  let siteEngineer;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const seAuth = () => ({ authorization: `Bearer ${mintAccessToken(siteEngineer)}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    // The server's own zone is one no project below uses.
    api = await startApi({
      TZ: "Asia/Kolkata",
      RATE_LIMIT_AI_MAX: "1000",
      RATE_LIMIT_UPLOAD_MAX: "1000",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      DATABASE_CONNECTION_LIMIT: "4",
    });
    siteEngineer = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest Site Engineer",
      email: `live-se-r2-${Date.now()}@octapm-live.test`,
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

  /** A project in the LiveTest organisation, with the site engineer on it under a no-BOQ template. */
  const newProject = async (name, { timezone = null } = {}) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest r2 ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18"), timezone },
    });
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest r2 no BOQ ${name} ${Date.now()}`, baseRole: "site_engineer", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: siteEngineer.id, role: "site_engineer", orgId: live.org.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: siteEngineer.id, templateId: template.id } });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 201) => {
      const response = await api.post(at(route), body, auth());
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const refused = async (route, body, status) => {
      const response = await api.post(at(route), body, auth());
      expect([route, response.status]).toEqual([route, status]);
      return response.body.error;
    };
    const get = async (route, headers = auth()) => {
      const response = await api.get(at(route), headers);
      expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
      return response.body.data;
    };
    return { project, at, post, refused, get };
  };

  /** An activity with an approved allocation of `quantity` × `rate` of a new BOQ row. */
  const activityWithBill = async (built, { code, name, quantity = 100, rate = 1000 }) => {
    const item = await built.post("/boq/items", { code, description: name, quantity, unit: "m3", rate });
    const activity = await built.post("/activities", {
      name,
      activityCode: `A-${code}`,
      duration: 5,
      startDate: "2026-02-02",
      endDate: "2026-02-06",
      engineerIds: [live.user.id, siteEngineer.id],
    });
    const allocation = await built.post("/activity-boq-allocations", { boqItemId: item.item.id, activityId: activity.id, quantity });
    for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {}, 200);
    return activity;
  };

  const period = (built, code, cutoffDate) =>
    built.post("/reports/periods", { code, periodStart: `${cutoffDate.slice(0, 7)}-01`, periodEnd: cutoffDate, cutoffDate });

  describe("1. calendar-date fields count by their date, never the day after, in any zone", () => {
    // 10 March 2026: after DST began in Chicago (CDT, -05:00), ends there at
    // 2026-03-11T04:59:59.999Z; in Auckland (NZDT, +13:00) at
    // 2026-03-10T10:59:59.999Z. 11 March's 00:00 UTC is before the first and
    // after the second.
    const cases = [
      { zone: "America/Chicago", cutoffD: "2026-03-11T04:59:59.999Z", cutoffD1: "2026-03-12T04:59:59.999Z" },
      { zone: "Pacific/Auckland", cutoffD: "2026-03-10T10:59:59.999Z", cutoffD1: "2026-03-11T10:59:59.999Z" },
    ];
    for (const { zone, cutoffD, cutoffD1 } of cases) {
      it(`${zone}: a cost loading and a direct cost dated the cutoff date count; ones dated the next day do not`, async () => {
        const built = await newProject(`date-only ${zone}`, { timezone: zone });
        const onTheDay = await activityWithBill(built, { code: "1.1", name: "Dated the cutoff date" });
        const nextDay = await activityWithBill(built, { code: "1.2", name: "Dated the day after" });

        // PV: approved cost loadings, planned through the product API.
        for (const [activity, plannedDate, plannedValue] of [
          [onTheDay, "2026-03-10", 700],
          [nextDay, "2026-03-11", 900],
        ]) {
          const loading = await built.post("/reports/cost-loading", { activityId: activity.id, plannedDate, plannedValue });
          for (const step of ["submit", "approve"]) await built.post(`/reports/cost-loading/${loading.id}/${step}`, {}, 200);
        }
        // AC: approved direct costs, posted through the ledger (incurredOn =
        // costDate, which becomes the cost record's actualThroughDate). A
        // line must be coded before approval: this organisation's own code.
        const costCode = await prisma.costCode.create({ data: { orgId: live.org.id, code: `LT-${zone}-${Date.now()}`, name: "LiveTest labour" } });
        await prisma.projectCostCode.create({ data: { orgId: live.org.id, projectId: built.project.id, costCodeId: costCode.id } });
        for (const [activity, costDate, amount] of [
          [onTheDay, "2026-03-10", 300],
          [nextDay, "2026-03-11", 500],
        ]) {
          const cost = await built.post("/direct-costs", {
            description: `LiveTest cost ${costDate}`,
            costDate,
            lines: [{ description: "Labour", activityId: activity.id, costCodeId: costCode.id, amount }],
          });
          for (const step of ["submit", "approve"]) await built.post(`/direct-costs/${cost.id}/${step}`, {}, 200);
        }
        // The dates are stored as a date input stores them: 00:00 UTC.
        const loadings = await prisma.activityCostLoading.findMany({ where: { projectId: built.project.id }, orderBy: { plannedDate: "asc" } });
        const records = await prisma.costRecord.findMany({ where: { projectId: built.project.id }, orderBy: { actualThroughDate: "asc" } });
        expect(loadings.map((row) => row.plannedDate.toISOString())).toEqual(["2026-03-10T00:00:00.000Z", "2026-03-11T00:00:00.000Z"]);
        expect(records.map((row) => [row.actualThroughDate.toISOString(), Number(row.actual)])).toEqual([
          ["2026-03-10T00:00:00.000Z", 300],
          ["2026-03-11T00:00:00.000Z", 500],
        ]);

        const d = await period(built, "D", "2026-03-10");
        const d1 = await period(built, "D1", "2026-03-11");
        const onD = await built.get(`/reports/ev?periodId=${d.id}`);
        const onD1 = await built.get(`/reports/ev?periodId=${d1.id}`);
        // The cutoff is the end of the date in the project's zone ...
        expect([onD.reporting.cutoffDate, onD.reporting.cutoffLocalDate, onD.reporting.timeZone]).toEqual([cutoffD, "2026-03-10", zone]);
        expect(onD1.reporting.cutoffDate).toBe(cutoffD1);
        // ... and the dated rows count by their date: the cutoff date's in,
        // the next day's out — then in on the next day.
        expect({ pv: onD.pv, ac: onD.ac }).toEqual({ pv: 700, ac: 300 });
        expect({ pv: onD1.pv, ac: onD1.ac }).toEqual({ pv: 1600, ac: 800 });
        // An ad hoc report for the date reads the same.
        const adHoc = await built.get("/reports/ev?cutoffDate=2026-03-10");
        expect({ pv: adHoc.pv, ac: adHoc.ac, cutoff: adHoc.reporting.cutoffDate }).toEqual({ pv: 700, ac: 300, cutoff: cutoffD });
      });
    }
  });

  describe("2. a locked latest period feeds the forecast its stored snapshot", () => {
    it("health, the EV report and the forecast give one CPI, one EAC and one cutoff instant and zone after a late-keyed actual and a zone change", async () => {
      const built = await newProject("locked forecast", { timezone: "America/Chicago" });
      const activity = await activityWithBill(built, { code: "1.1", name: "Frame" });
      await prisma.activityProgress.create({
        data: { activityId: activity.id, pctComplete: 50, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-04-10T15:00:00Z"), updatedAt: new Date("2026-04-10T15:00:00Z") },
      });
      await prisma.costRecord.create({ data: { projectId: built.project.id, activityId: activity.id, actual: 3000, actualThroughDate: new Date("2026-04-15T00:00:00Z") } });
      const a04 = await period(built, "A04", "2026-04-30");
      await built.post(`/reports/periods/${a04.id}/lock`, { overrideReason: "LiveTest r2: lock over the setup gate" }, 200);

      // Afterwards: an actual keyed late, dated inside the locked period
      // (this test's own row by its unique key), and the zone changes.
      await prisma.costRecord.update({
        where: { projectId_activityId: { projectId: built.project.id, activityId: activity.id } },
        data: { actual: 52000, actualThroughDate: new Date("2026-04-20T00:00:00Z") },
      });
      await prisma.project.update({ where: { id: built.project.id }, data: { timezone: "Asia/Tokyo" } });

      const ev = await built.get("/reports/ev");
      const health = await built.get("/health");
      const forecast = await built.get("/forecast");

      // The EV report: the locked snapshot — EV 50,000 / AC 3,000.
      expect(ev.reporting.isSnapshot).toBe(true);
      expect([ev.ev, ev.ac, ev.totalBudget]).toEqual([50000, 3000, 100000]);
      expect(ev.cpi).toBeCloseTo(50000 / 3000, 6);
      expect(ev.eac).toBeCloseTo(100000 / (50000 / 3000), 2);
      expect(ev.reporting).toMatchObject({ cutoffDate: "2026-05-01T04:59:59.999Z", cutoffLocalDate: "2026-04-30", timeZone: "America/Chicago" });

      // The health card: the same CPI and cutoff.
      const cost = health.dimensions.find((dimension) => dimension.key === "cost");
      expect(cost.detail.cpi).toBe(Number(ev.cpi.toFixed(2)));
      expect(health.dataFreshness).toMatchObject({ cutoffDate: "2026-05-01T04:59:59.999Z", cutoffLocalDate: "2026-04-30", cutoffTimeZone: "America/Chicago" });

      // The forecast: the same CPI, EAC, actual and cutoff — not a live
      // recomputation of the locked period (which would give CPI 0.96 and
      // EAC ~104,000 in Chicago, or other figures cut in Tokyo).
      expect(forecast.schedule.cpi).toBe(Math.round(ev.cpi * 1000) / 1000);
      expect(forecast.cost).toMatchObject({ eac: Math.round(ev.eac * 100) / 100, bac: 100000, actual: 3000, eacBasis: "budget_over_cpi" });
      expect(forecast.earnedValueCutoff).toMatchObject({ cutoffDate: "2026-05-01T04:59:59.999Z", cutoffLocalDate: "2026-04-30", timeZone: "America/Chicago" });
    });
  });

  describe("3. a cutoff not yet reached", () => {
    it("an open period whose cutoff is in the future says EV and AC run to today while PV runs to the cutoff; a past one does not", async () => {
      const built = await newProject("future cutoff");
      await activityWithBill(built, { code: "1.1", name: "Frame" });
      const FUTURE_NOTE = "This period's cutoff has not been reached; EV and AC are measured through today while PV runs to the cutoff.";
      const past = await period(built, "P01", "2026-01-31");
      const future = await period(built, "F12", `${new Date().getUTCFullYear() + 1}-12-31`);
      expect((await built.get(`/reports/ev?periodId=${future.id}`)).basisWarnings).toContain(FUTURE_NOTE);
      // The default basis is the latest period, the future one: said there too.
      expect((await built.get("/reports/ev")).basisWarnings).toContain(FUTURE_NOTE);
      expect((await built.get(`/reports/ev?periodId=${past.id}`)).basisWarnings).not.toContain(FUTURE_NOTE);
    });
  });

  describe("4. schedule-revision refusals a user can act on", () => {
    it("SCHEDULE_NOT_READY names the failing check and where to fix it; INVALID_REVISION_STATUS names where the revision stands now", async () => {
      const built = await newProject("schedule refusals");
      // A staged revision whose two activities have no predecessor link.
      const revision = await prisma.scheduleRevision.create({
        data: {
          projectId: built.project.id,
          label: "Rev A",
          source: "ai",
          status: "draft",
          isActive: false,
          activityCount: 2,
          criticalCount: 2,
          snapshotJson: {
            projectSummary: { name: "Rev A", startDate: "2026-01-05", endDate: "2026-12-18" },
            activities: [
              { id: "A100", activityCode: "A100", name: "Excavate", duration: 5, earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
              { id: "A110", activityCode: "A110", name: "Pour", duration: 6, earlyStart: 5, earlyFinish: 11, lateStart: 5, lateFinish: 11, totalFloat: 0, isCritical: true },
            ],
            source: "ai",
          },
        },
      });
      const route = (step) => `/schedule/revisions/${revision.id}/${step}`;
      await built.post(route("submit-review"), {}, 200);

      const notReady = await built.refused(route("approve"), {}, 400);
      expect(notReady.code).toBe("SCHEDULE_NOT_READY");
      expect(notReady.message).toBe(
        "Schedule readiness checks must pass before approval: Predecessor logic — at least one predecessor relationship is required (Schedule › Gantt).",
      );

      await built.post(route("reject"), { reason: "LiveTest r2: needs logic" }, 200);
      const stale = await built.refused(route("reject"), { reason: "again" }, 409);
      expect(stale.code).toBe("INVALID_REVISION_STATUS");
      expect(stale.message).toBe(
        "This schedule revision is now Rejected; it must be Under review before it can be rejected. Refresh to see its current status.",
      );
      const staleApprove = await built.refused(route("approve"), {}, 409);
      expect(staleApprove.message).toBe(
        "This schedule revision is now Rejected; it must be Under review before it can be approved. Refresh to see its current status.",
      );
      for (const message of [notReady.message, stale.message, staleApprove.message]) {
        expect(message).not.toMatch(/under_review|schedule_revision|\bdraft or rejected\b/);
      }
    });
  });

  describe("5 and 6. BOQ revisions: refusals in BOQ words, and row counts only for BOQ readers", () => {
    let built;
    let revisionId;

    const uploadBoq = async () => {
      const form = new FormData();
      form.append("file", new Blob([fs.readFileSync(CONSTRUCTION_BOQ)], { type: XLSX_MIME }), path.basename(CONSTRUCTION_BOQ));
      form.append("label", "Tender bill");
      const response = await fetch(`${api.base}${built.at("/boq/upload")}`, { method: "POST", headers: auth(), body: form });
      const body = await response.json();
      expect([response.status, body?.error]).toEqual([200, undefined]);
      return body.data;
    };

    it("5. an approval before submission, a repeated submission and a stale Approve on an approved or locked revision are refused in BOQ words", async () => {
      built = await newProject("boq refusals");
      const uploaded = await uploadBoq();
      revisionId = uploaded.revisionId;
      const route = (step) => `/boq/revisions/${revisionId}/${step}`;
      const words = async (step, expected) => {
        const error = await built.refused(route(step), {}, 409);
        expect([step, error.code, error.message]).toEqual([step, "APPROVAL_WORKFLOW_INVALID_TRANSITION", expected]);
        expect(error.message).not.toMatch(/boq_revision|workflow transition|\bimported\b|\bbaselined\b/);
      };

      await words("approve", "Submit BOQ revision 1 for review before approving it.");
      await built.post(route("submit"), {}, 200);
      await words("submit", "BOQ revision 1 is already under review; refresh the BOQ page to see it.");
      await built.post(route("approve"), {}, 200);
      await words("approve", "BOQ revision 1 is already approved; refresh the BOQ page — the next step is to lock it as the baseline.");
      await built.post(route("lock"), {}, 200);
      await words("approve", "BOQ revision 1 is already approved and locked as the baseline; refresh the BOQ page to see it.");
      await words("submit", "BOQ revision 1 is already approved and locked as the baseline; refresh the BOQ page to see it.");
    });

    it("6. setup readiness gives a BOQ reader the revision's row counts and a member without BOQ read none of them", async () => {
      const COUNT_KEYS = new Set(["itemCount", "blockedCount", "revisionItems", "revisionChanges", "revisionBlockedRows"]);
      const full = await built.get("/setup-readiness");
      expect(full.context.boqRevision).toMatchObject({ id: revisionId, revisionNumber: 1, itemCount: 10, changes: { added: 10 } });
      expect(keyPaths(full, COUNT_KEYS).length).toBeGreaterThan(0);

      const limited = await built.get("/setup-readiness", seAuth());
      expect(limited.context.boqRevision).toMatchObject({ id: revisionId, revisionNumber: 1, countsWithheld: true });
      expect(["itemCount" in limited.context.boqRevision, "changes" in limited.context.boqRevision]).toEqual([false, false]);
      expect(limited.context.boqRevision.validation).toEqual({ blocked: [] });
      expect(keyPaths(limited, COUNT_KEYS)).toEqual([]);
    });
  });
});
