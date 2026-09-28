/**
 * §12 on the Overview and the Schedule module — proven against a real API
 * process and the real local Postgres.
 *
 * "A member without BOQ read permission must not receive BOQ figures
 * through Project Controls Overview, Setup Readiness, boq_approval, related
 * cards, API response backing those cards." Every request the Overview
 * landing (controls strip, health card, setup wizard, needs-you panel,
 * module bar) and every tab of the Schedule module (Gantt, Activities,
 * Progress, Lookahead, Critical Path, Earned Value, Forecast, Milestones,
 * Resources, Risks, Long Lead, WBS, Revisions) make is listed below — read
 * off the frontend's hooks and checked against what the browser actually
 * asks for (e2e/52, which fails if the list and the browser disagree) — and
 * swept for four members whose permission template sets the BOQ tool to
 * none. utils/boq-figures decides what each receives:
 *
 *   BOQ reader: exactly the service's answer, byte for byte.
 *   no BOQ read: no allocated quantity, value or weight on an activity, no
 *     open or total bill value, no BOQ value figure in any readiness check,
 *     reporting gate or not-ready refusal, no BOQ rows in a stored
 *     snapshot, no history of the bill's records — omitted, not zeroed.
 *   neither BOQ nor cost read: nor the budgets built from the bill (the
 *     activity budget, the revision's totals, the generator's budgets, the
 *     forecast's money, a revision's total in its history).
 *
 * Nor anything read off the mapping (owner decision, 2026-09-28): no
 * approved allocation count on an activity, no count of critical activities
 * without an approved allocation, no coverage share. Their criticality —
 * the critical flag, the float, the count of critical activities — stays.
 *
 * Everything else — statuses, codes, verdicts, counts, the forecast's
 * levels — is what the BOQ reader gets.
 *
 * The workspace home the browser opens right after sign-in, before the
 * Overview, is swept with them: each project's row there states the
 * project's budget (bac, the approved allocations' sum) and the EAC built
 * from it, which go the way of the schedule's budgets.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards. The API is started on a free port with no model
 * provider, so the forecast's explanation is the deterministic one.
 *
 *   npm run test:live -- src/services/__live__/pc-4-boq-withholding.live.test.js
 */
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { normalizeMoneyTree } = require("../../utils/money");
const scheduleService = require("../schedule.service");
const activityService = require("../activity.service");
const forecastService = require("../forecast.service");
const evService = require("../earned-value.service");
const workspaceDashboardService = require("../workspace-dashboard.service");
const { startApi } = require("./auth-live-kit");

// What a member without BOQ read must never receive, wherever it sits.
const BOQ_KEYS = [
  "allocatedBoqAmount",
  "allocatedBoqQuantity",
  "allocatedBoqWeight",
  "unallocatedBoqAmount",
  "totalBoqAmount",
  "allocatableBoqAmount",
  "approvedAllocatedAmount",
  "pendingAllocatedAmount",
  "unallocatedAmount",
  "optionalUnallocatedAmount",
  "notApplicableAmount",
  "boqRows",
  // Counts derived from the bill (the owner's rule: no mapping percentage
  // and no BOQ-derived count): the mapping share and counts, and the number
  // of BOQ rows, of rows without a WBS node or a cost code, of rows and unit
  // spellings with an unknown unit, and a revision's row counts.
  ...[
    "coveragePct",
    "itemsWithoutMappingRule",
    "suggestionsPending",
    "unitMismatchCount",
    "locationMismatchCount",
    "boqItems",
    "itemsWithoutWbs",
    "itemsWithoutCostCode",
    "itemsWithUnresolvedUnit",
    "unitsUnresolved",
    "revisionItems",
    "revisionChanges",
    "revisionBlockedRows",
  ],
  // Read off the mapping (owner decision, 2026-09-28): an activity's
  // approved allocation count (its mapping badge), and how many critical
  // activities have no approved allocation.
  "approvedAllocationCount",
  "criticalUnmappedActivities",
];
// ... and what a member who reads neither the BOQ nor the cost module must
// not receive either: the budgets built from the bill, and the forecast's
// money built from them.
const BUDGET_KEYS = ["budget", "generatedBudget", "totalBudget", "generatedTotalBudget", "eac", "bottomUp", "bac"];
// The forecast's money, where it sits (the cost block, each activity's cost,
// each budget line).
const FORECAST_COST_KEYS = ["budget", "bac", "eac", "bottomUp", "projected", "overrun", "overrunPct", "actual"];
const FORECAST_ACTIVITY_COST_KEYS = ["budget", "actual", "committed", "projected", "overrun", "overrunPct", "reasons"];
const FORECAST_LINE_KEYS = ["revised", "committed", "actual", "forecast", "overrun", "overrunPct"];
// What a WBS node's outline carries (owner decision D3).
const WBS_OUTLINE_KEYS = ["id", "projectId", "parentId", "code", "name", "path", "pathNames", "fullName", "depth", "sortOrder", "isPackage", "status", "archivedAt", "childCount", "activityCount"];
// The bill's own records, whose history is the bill's.
const BOQ_RECORD_TYPES = ["boq_item", "boq_revision", "activity_boq_allocation"];

const keyPaths = (value, keys, at = "") =>
  value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, inner]) => [
        ...(keys.has(key) ? [`${at}.${key}`] : []),
        ...keyPaths(inner, keys, `${at}.${key}`),
      ])
    : [];

// A BOQ reader's answer with the withheld keys taken out, wherever they sit
// (except at the paths kept): what everyone else must receive, key for key.
const without = (value, keys, keep = new Set(), at = "") =>
  Array.isArray(value)
    ? value.map((entry, index) => without(entry, keys, keep, `${at}[${index}]`))
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !keys.has(key) || keep.has(`${at}.${key}`))
            .map(([key, inner]) => [key, without(inner, keys, keep, `${at}.${key}`)]),
        )
      : value;

const clone = (value) => JSON.parse(JSON.stringify(value));
const drop = (object, keys) => {
  if (object && typeof object === "object") for (const key of keys) delete object[key];
};

// Readiness is stamped when it is built, the forecast and the EV report when
// they are computed, an error with its request id; nothing else moves.
const unstamped = (text) =>
  text
    .replace(/"checkedAt":"[^"]*"/g, '"checkedAt":"-"')
    .replace(/"asOf":"[^"]*"/g, '"asOf":"-"')
    .replace(/"asOfDate":"[^"]*"/g, '"asOfDate":"-"')
    .replace(/"requestId":"[^"]*"/g, '"requestId":"-"');
const parsed = (text) => JSON.parse(unstamped(text));
// The workspace home is also stamped with when it was built, and dates its
// sources by the newest record it read.
const unstampedDashboard = (text) =>
  unstamped(text)
    .replace(/"generatedAt":"[^"]*"/g, '"generatedAt":"-"')
    .replace(/"cutoffDate":"[^"]*"/g, '"cutoffDate":"-"')
    .replace(/"sourceUpdatedAt":"[^"]*"/g, '"sourceUpdatedAt":"-"');

liveDescribe("PC-4 §12: the Overview and the Schedule module carry no BOQ figure to a member who may not read the BOQ", () => {
  let live;
  let api;
  let project;
  let activities;
  let stagedRevision;
  let activeRevision;
  let lockedPeriod;
  let openPeriod;
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const post = (route, body) => api.post(route, body, auth());
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    // No model provider: the forecast's explanation is built from the forecast.
    api = await startApi({
      RATE_LIMIT_AI_MAX: "1000",
      RATE_LIMIT_UPLOAD_MAX: "1000",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
    });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest §12 schedule", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    // Four members whose templates take the BOQ tool away: a site engineer
    // (no cost tool either), a cost controller, a planning engineer and a
    // project manager (who keep the cost tool; the PM approves, baselines
    // and locks periods).
    for (const [key, role] of [
      ["siteEngineer", "site_engineer"],
      ["costController", "cost_controller"],
      ["planningEngineer", "planning_eng"],
      ["pm", "pm"],
    ]) {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-${key.toLowerCase()}-${tag}@octapm-live.test`,
        role,
      });
      const template = await prisma.permissionTemplate.create({
        data: {
          orgId: live.org.id,
          name: `LiveTest ${role}, no BOQ ${tag}`,
          baseRole: role,
          tools: { create: [{ module: "boq", level: "none" }] },
        },
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      await prisma.projectUserPermission.create({
        data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id },
      });
      members[key] = member;
    }

    // A bill of two priced rows with figures nothing else in these answers
    // could produce, and a programme of two activities.
    const createItem = async (payload) => {
      const created = await post(`/api/v1/projects/${project.id}/boq/items`, payload);
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data.item;
    };
    const createActivity = async (payload) => {
      const created = await post(`/api/v1/projects/${project.id}/activities`, {
        engineerIds: [live.user.id, members.siteEngineer.id],
        ...payload,
      });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data;
    };
    const concrete = await createItem({ code: "1.1", description: "Concrete in foundations", quantity: 100, unit: "m3", rate: 213.37 });
    const rebar = await createItem({ code: "1.2", description: "Reinforcement to foundations", quantity: 50, unit: "t", rate: 1009.13 });
    activities = {
      pour: await createActivity({ name: "Pour foundations", activityCode: "A100", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06" }),
      fix: await createActivity({ name: "Fix reinforcement", activityCode: "A110", duration: 6, startDate: "2026-01-26", endDate: "2026-02-01" }),
    };
    // Approved allocations: all the concrete to the pour, two fifths of the
    // steel to the fixing — so the bill has money on its activities and money open.
    const allocationsRoute = `/api/v1/projects/${project.id}/activity-boq-allocations`;
    for (const [boqItemId, activityId, quantity] of [
      [concrete.id, activities.pour.id, 100],
      [rebar.id, activities.fix.id, 20],
    ]) {
      const allocation = await post(allocationsRoute, { boqItemId, activityId, quantity });
      expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
      for (const step of ["submit", "approve"]) {
        const moved = await post(`${allocationsRoute}/${allocation.body.data.id}/${step}`, {});
        expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
      }
    }

    // The pour is complete, approved inside the open period (P02, 1–28
    // February): its earned value is its whole allocation — 21337, the
    // budget itself — so EV on the health card and the workspace home is a
    // figure the sweep can find (§12: EV that equals allocation × % complete).
    await prisma.activityProgress.create({
      data: {
        activityId: activities.pour.id,
        pctComplete: 100,
        status: "approved",
        approvedBy: live.user.id,
        approvedAt: new Date("2026-02-15T12:00:00.000Z"),
        updatedAt: new Date("2026-02-15T12:00:00.000Z"),
      },
    });

    // The active revision, as a generated schedule stores it (the
    // generator's budgets and the BOQ rows it was built from), and a staged
    // one submitted for review through the API — which stores its readiness
    // and records the transition, with the revision's total, in its history.
    const generatedSnapshot = (label) => ({
      projectSummary: { name: label, startDate: "2026-01-05", endDate: "2026-12-18", totalBudget: 69999.99 },
      wbs: [{ code: "A", level: 1, name: "Substructure", budget: 69999.99 }],
      boqRows: [
        { description: "Concrete in foundations", qty: 100, unit: "m3", rate: 213.37, amount: 21337 },
        { description: "Reinforcement to foundations", qty: 50, unit: "t", rate: 1009.13, amount: 50456.5 },
      ],
      activities: [
        { id: "A100", activityCode: "A100", name: "Pour foundations", duration: 5, earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true, budget: 21337 },
        { id: "A110", activityCode: "A110", name: "Fix reinforcement", duration: 6, earlyStart: 5, earlyFinish: 11, lateStart: 5, lateFinish: 11, totalFloat: 0, isCritical: true, predecessors: "A100", budget: 48662.99 },
      ],
      source: "ai",
    });
    activeRevision = await prisma.scheduleRevision.create({
      data: {
        projectId: project.id,
        label: "Rev A",
        source: "ai",
        status: "approved",
        isActive: true,
        activityCount: 2,
        criticalCount: 2,
        totalBudget: 69999.99,
        snapshotJson: generatedSnapshot("Rev A"),
        approvedAt: new Date(),
        activatedAt: new Date(),
      },
    });
    stagedRevision = await prisma.scheduleRevision.create({
      data: {
        projectId: project.id,
        label: "Rev B",
        source: "ai",
        status: "draft",
        isActive: false,
        activityCount: 2,
        criticalCount: 2,
        totalBudget: 69999.99,
        // Its pour has lost its predecessor: since owner decision D5 the
        // approval judges the revision's own logic (BOQ coverage is a
        // baseline-lock check), so this is what refuses its approval below
        // — with the bill's figures still in the readiness it carries.
        snapshotJson: (() => {
          const snapshot = generatedSnapshot("Rev B");
          snapshot.activities = snapshot.activities.map(({ predecessors, ...activity }) => activity);
          return snapshot;
        })(),
      },
    });
    const submitted = await post(`/api/v1/projects/${project.id}/schedule/revisions/${stagedRevision.id}/submit-review`, {});
    expect([submitted.status, submitted.body?.error]).toEqual([200, undefined]);
    expect(submitted.body.data.status).toBe("under_review");

    // Two reporting periods: one locked by the (BOQ-reading) PM over the
    // readiness gate with a reason — its snapshot stores the gate with the
    // bill's figures — and one left open.
    const createPeriod = async (code, periodStart, periodEnd) => {
      const created = await post(`/api/v1/projects/${project.id}/reports/periods`, { code, periodStart, periodEnd, cutoffDate: periodEnd });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data;
    };
    lockedPeriod = await createPeriod("P01", "2026-01-01", "2026-01-31");
    openPeriod = await createPeriod("P02", "2026-02-01", "2026-02-28");
    const locked = await post(`/api/v1/projects/${project.id}/reports/periods/${lockedPeriod.id}/lock`, {
      overrideReason: "LiveTest: lock over the readiness gate",
    });
    expect([locked.status, locked.body?.error]).toEqual([200, undefined]);
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

  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ids = () => ({ orgId: live.org.id, projectId: project.id });

  // Every request the Overview landing and the Schedule module's tabs make
  // (e2e/52 asserts the browser makes exactly these), with the service call
  // whose answer a BOQ reader receives where this change touches the route.
  //   kind "keys": the rest of the answer is the BOQ reader's, key for key.
  //   kind "forecast" / "ev" / "audit": the rest is the BOQ reader's, with
  //     the withheld figures taken out where they sit.
  //   kind "sweep": the answer is per person (who is asking, what they may
  //     do); it is swept, not compared.
  //   kind "workspace": per person too; compared with that member's own
  //     dashboard as the service builds it, the budget taken out of each
  //     project's row for a reader of neither the BOQ nor the cost module.
  //   kind "wbs": the outline of the BOQ reader's answer (owner decision D3).
  //   cost: a cost reader's request, refused (403) to the site engineer.
  const reads = () => ({
    // The workspace home, which the browser loads right after sign-in and
    // before the Overview (features/home and features/dashboard). Its answer
    // is per person (their projects, their queues); the service call is the
    // BOQ reader's.
    workspaceDashboard: {
      route: "/api/v1/projects/workspace-dashboard",
      kind: "workspace",
      service: () =>
        workspaceDashboardService.getWorkspaceDashboard({ orgId: live.org.id, userId: live.user.id, role: "pm", isCompanyAdmin: true }),
    },
    // The Overview: identity, strip, wizard, health card, needs-you panel.
    project: { route: at(""), kind: "sweep" },
    parties: { route: at("/parties"), kind: "sweep" },
    permissions: { route: `/api/v1/auth/me/permissions?projectId=${project.id}`, kind: "sweep" },
    setupReadiness: { route: at("/setup-readiness"), kind: "sweep" },
    health: { route: at("/health"), kind: "sweep" },
    assignments: { route: at("/assignments/mine"), kind: "sweep" },
    costSummary: { route: at("/cost/summary"), kind: "sweep", cost: true },
    forecast: {
      route: at("/forecast"),
      kind: "forecast",
      service: () => forecastService.buildForecast(ids()),
    },
    // The Schedule module: the dashboard, its tabs, and their panels.
    schedule: {
      route: at("/schedule"),
      kind: "keys",
      service: () => scheduleService.getProjectSchedule(ids()),
    },
    layouts: { route: at("/schedule/layouts"), kind: "sweep" },
    activities: {
      route: at("/activities"),
      kind: "keys",
      service: () => activityService.listActivities(ids()),
    },
    activity: {
      route: at(`/activities/${activities.pour.id}`),
      kind: "keys",
      service: () => activityService.getActivityById({ ...ids(), activityId: activities.pour.id }),
    },
    progressSubmissions: { route: at("/activities/progress-submissions?status=submitted"), kind: "sweep" },
    lookaheads: { route: at("/lookaheads"), kind: "sweep" },
    lookaheadConstraints: { route: at("/lookaheads/constraints"), kind: "sweep" },
    periods: { route: at("/reports/periods"), kind: "sweep", cost: true },
    ev: {
      route: at("/reports/ev"),
      kind: "ev",
      cost: true,
      service: () => evService.buildOfficialEvReport(ids()),
    },
    lockedEv: {
      route: at(`/reports/ev?periodId=${lockedPeriod.id}`),
      kind: "ev",
      cost: true,
      service: () => evService.buildOfficialEvReport({ ...ids(), periodId: lockedPeriod.id }),
    },
    resources: { route: at("/schedule/resources"), kind: "sweep" },
    risks: { route: at("/risks"), kind: "sweep" },
    longLead: { route: at("/long-lead"), kind: "sweep" },
    // The project's WBS outline (owner decision D3): every schedule reader
    // reads it; a member without BOQ read receives the outline only.
    wbs: { route: at("/structure/wbs"), kind: "wbs" },
    history: {
      route: at(`/audit?entityType=schedule_revision&entityId=${stagedRevision.id}&limit=20&order=desc`),
      kind: "audit",
    },
    // The same endpoint, asked for everything: the bill's history is not
    // reached by leaving the filter off.
    fullHistory: { route: at("/audit?limit=100"), kind: "audit" },
    revisions: {
      route: at("/schedule/revisions"),
      kind: "keys",
      service: () => scheduleService.listRevisions(ids()),
    },
    activeReadiness: {
      route: at(`/schedule/revisions/${activeRevision.id}/readiness`),
      kind: "keys",
      service: () => scheduleService.getScheduleReadiness({ ...ids(), revisionId: activeRevision.id }),
    },
    stagedReadiness: {
      route: at(`/schedule/revisions/${stagedRevision.id}/readiness`),
      kind: "keys",
      service: () => scheduleService.getScheduleReadiness({ ...ids(), revisionId: stagedRevision.id }),
    },
    stagedRevision: {
      route: at(`/schedule/revisions/${stagedRevision.id}`),
      kind: "keys",
      service: () => scheduleService.getRevision({ ...ids(), revisionId: stagedRevision.id }),
    },
    activeRevision: {
      route: at(`/schedule/revisions/${activeRevision.id}`),
      kind: "keys",
      service: () => scheduleService.getRevision({ ...ids(), revisionId: activeRevision.id }),
    },
    mapping: {
      route: at(`/schedule/revisions/${stagedRevision.id}/mapping`),
      kind: "keys",
      service: () => scheduleService.getRevisionMapping({ ...ids(), revisionId: stagedRevision.id }),
    },
  });

  // Who is swept, and what each may not receive.
  const viewers = () => ({
    // Neither the BOQ nor the cost module.
    siteEngineer: {
      user: members.siteEngineer,
      readsCost: false,
      withheld: new Set([...BOQ_KEYS, ...BUDGET_KEYS]),
      secrets: ["71793.5", "30273.9", "21337", "20182.6", "41519.6", "69999.99", "50456.5", "213.37", "1009.13"],
    },
    // The cost module, not the BOQ: the budgets stay.
    costController: { user: members.costController, readsCost: true, withheld: new Set(BOQ_KEYS), secrets: ["71793.5", "30273.9", "50456.5", "213.37", "1009.13"] },
    planningEngineer: { user: members.planningEngineer, readsCost: true, withheld: new Set(BOQ_KEYS), secrets: ["71793.5", "30273.9", "50456.5", "213.37", "1009.13"] },
    pm: { user: members.pm, readsCost: true, withheld: new Set(BOQ_KEYS), secrets: ["71793.5", "30273.9", "50456.5", "213.37", "1009.13"] },
  });

  // The EV report is a cost reader's, and so is its budget: the approved
  // allocations' sum it states (top level and in its source summary) stays.
  const EV_BUDGET_PATHS = new Set([".approvedAllocatedAmount", ".sourceSummary.budget.approvedAllocatedAmount"]);

  // The forecast without its money, where the money sits.
  const forecastWithoutMoney = (forecast) => {
    const copy = clone(forecast);
    const activityCost = (activity) => drop(activity?.cost, FORECAST_ACTIVITY_COST_KEYS);
    (copy.activities || []).forEach(activityCost);
    (copy.schedule?.topRisks || []).forEach(activityCost);
    if (copy.cost) {
      drop(copy.cost, FORECAST_COST_KEYS);
      (copy.cost.topRisks || []).forEach(activityCost);
      (copy.cost.budgetLines || []).forEach((line) => drop(line, FORECAST_LINE_KEYS));
    }
    return copy;
  };

  // The EV report without the bill's figures, where they sit.
  const evWithoutBill = (report) => {
    const copy = clone(report);
    delete copy.unallocatedBoqAmount;
    for (const list of ["blockers", "warnings"]) {
      for (const entry of copy.readinessGate?.[list] || []) {
        if (entry.details) drop(entry.details, BOQ_KEYS);
      }
    }
    return copy;
  };

  // The history without the bill's records, and (for a reader of neither
  // the BOQ nor the cost module) without a revision's totals.
  const historyWithoutBill = (history, readsCost) => {
    const copy = clone(history);
    copy.events = copy.events.filter((event) => !BOQ_RECORD_TYPES.includes(event.recordType || event.entityType));
    if (!readsCost) {
      for (const event of copy.events) {
        if ((event.recordType || event.entityType) !== "schedule_revision") continue;
        for (const summary of ["oldSummary", "newSummary", "summary"]) drop(event[summary], ["totalBudget", "generatedTotalBudget"]);
      }
    }
    return copy;
  };

  it("a BOQ reader receives exactly the service's answer — the figures, byte for byte", async () => {
    for (const [name, { route, kind, service }] of Object.entries(reads())) {
      if (!service) continue;
      const stampless = kind === "workspace" ? unstampedDashboard : unstamped;
      const response = await api.get(route, auth());
      expect([name, response.status, response.body?.error]).toEqual([name, 200, undefined]);
      const expected = JSON.stringify({ success: true, data: normalizeMoneyTree(await service()) });
      expect([name, stampless(response.text)]).toEqual([name, stampless(expected)]);
    }
    // ... and the figures are there to be withheld: the sweep below looks
    // where they are.
    const schedule = (await api.get(reads().schedule.route, auth())).body.data;
    const pour = schedule.activities.find((activity) => activity.id === activities.pour.id);
    expect(pour).toMatchObject({ allocatedBoqAmount: 21337, allocatedBoqQuantity: 100, budget: 21337, approvedAllocationCount: 1 });
    expect(schedule.revision).toMatchObject({ unallocatedBoqAmount: 30273.9, totalBudget: 41519.6, generatedTotalBudget: 69999.99 });
    expect(schedule.revision.readiness.checks.find((check) => check.key === "allocations").details).toMatchObject({
      totalBoqAmount: 71793.5,
      unallocatedAmount: 30273.9,
    });
    const staged = (await api.get(reads().stagedRevision.route, auth())).body.data;
    expect(staged.snapshotJson.boqRows).toHaveLength(2);
    expect(staged.readiness.checks.find((check) => check.key === "allocations").details).toHaveProperty("totalBoqAmount");
    // The forecast's money: the approved allocations as the activity budgets.
    const forecast = (await api.get(reads().forecast.route, auth())).body.data;
    expect(forecast.cost.budget).toBe(41519.6);
    expect(forecast.activities.find((activity) => activity.id === activities.pour.id).cost.budget).toBe(21337);
    // The EV report's open bill value and the readiness gate's bill figures,
    // live and as the locked period stored them.
    for (const name of ["ev", "lockedEv"]) {
      const report = (await api.get(reads()[name].route, auth())).body.data;
      expect([name, report.unallocatedBoqAmount]).toEqual([name, 30273.9]);
      expect([name, keyPaths(report.readinessGate, new Set(["unallocatedAmount"])).length > 0]).toEqual([name, true]);
    }
    // The staged revision's history records its total; the bill's records have history.
    const history = (await api.get(reads().history.route, auth())).body.data;
    // (The summary stores the total as the Decimal it was, not as a number:
    // the key is what is swept for.)
    expect(history.events.some((event) => event.newSummary && "totalBudget" in event.newSummary)).toBe(true);
    const fullHistory = (await api.get(reads().fullHistory.route, auth())).body.data;
    expect(fullHistory.events.some((event) => BOQ_RECORD_TYPES.includes(event.recordType))).toBe(true);
    // The workspace home: the project's budget, the approved allocations' sum.
    const home = (await api.get(reads().workspaceDashboard.route, auth())).body.data;
    expect(home.projectHealth.find((row) => row.id === project.id)).toMatchObject({ bac: 41519.6, eac: 41519.6, ev: 21337 });
    // The health card: EV is the complete pour's whole allocation.
    const health = (await api.get(reads().health.route, auth())).body.data;
    expect(health.dimensions.find((dimension) => dimension.key === "cost").detail).toMatchObject({ ev: 21337, ac: 0 });
  });

  it("the site engineer, the cost controller, the planning engineer and a PM, all without BOQ read, receive none of the bill's figures from any request of the Overview or the Schedule module — and everything else unchanged", async () => {
    for (const [viewer, { user, readsCost, withheld, secrets }] of Object.entries(viewers())) {
      const viewerAuth = as(user);
      // The BOQ endpoints refuse this member — the premise of §12.
      expect([viewer, (await api.get(at("/boq"), viewerAuth)).status]).toEqual([viewer, 403]);
      for (const [name, { route, kind, cost, boq }] of Object.entries(reads())) {
        const [full, limited] = await Promise.all([api.get(route, auth()), api.get(route, viewerAuth)]);
        expect([viewer, name, full.status]).toEqual([viewer, name, 200]);
        if (boq || (cost && !readsCost)) {
          // A cost reader's request: refused outright, in the envelope.
          expect([viewer, name, limited.status, limited.body?.success, limited.body?.error?.code]).toEqual([viewer, name, 403, false, "FORBIDDEN"]);
          continue;
        }
        expect([viewer, name, limited.status, limited.body?.error]).toEqual([viewer, name, 200, undefined]);
        // Not one withheld key, anywhere in the answer (the EV report's
        // budget excepted for its cost reader) ...
        const kept = kind === "ev" ? EV_BUDGET_PATHS : new Set();
        const found = keyPaths(limited.body.data, withheld).filter((path) => !kept.has(path));
        expect([viewer, name, found]).toEqual([viewer, name, []]);
        // ... and not one of the bill's figures, whatever it is called.
        for (const secret of secrets) {
          expect([viewer, name, secret, limited.text.includes(secret)]).toEqual([viewer, name, secret, false]);
        }
        // Everything else is the BOQ reader's answer.
        const mine = parsed(limited.text).data;
        const theirs = parsed(full.text).data;
        if (kind === "keys") {
          expect([viewer, name, mine]).toEqual([viewer, name, without(theirs, withheld)]);
        } else if (kind === "forecast") {
          expect([viewer, name, mine]).toEqual([viewer, name, readsCost ? theirs : forecastWithoutMoney(theirs)]);
        } else if (kind === "ev") {
          expect([viewer, name, mine]).toEqual([viewer, name, evWithoutBill(theirs)]);
        } else if (kind === "wbs") {
          const outlineNode = (node) => ({
            ...Object.fromEntries(Object.entries(node).filter(([key]) => WBS_OUTLINE_KEYS.includes(key))),
            ...(node.children ? { children: node.children.map(outlineNode) } : {}),
          });
          expect([viewer, name, mine]).toEqual([
            viewer,
            name,
            {
              view: "outline",
              items: theirs.items.map(outlineNode),
              tree: theirs.tree.map(outlineNode),
              summary: Object.fromEntries(Object.entries(theirs.summary).filter(([key]) => key !== "linkedBoqItems")),
            },
          ]);
        } else if (kind === "audit") {
          expect([viewer, name, mine]).toEqual([viewer, name, historyWithoutBill(theirs, readsCost)]);
        } else if (kind === "workspace") {
          // Per person: this member's own dashboard as the service builds
          // it, each project's row without the budget unless they read cost.
          const own = normalizeMoneyTree(
            await workspaceDashboardService.getWorkspaceDashboard({ orgId: live.org.id, userId: user.id, role: user.role, isCompanyAdmin: false }),
          );
          if (!readsCost) own.projectHealth = own.projectHealth.map((row) => without(row, new Set(["bac", "eac", "ev", "pv", "ac"])));
          expect([viewer, name, JSON.parse(unstampedDashboard(limited.text)).data]).toEqual([
            viewer,
            name,
            JSON.parse(unstampedDashboard(JSON.stringify(own))),
          ]);
        }
      }
      // The workspace home: the project is there with its scores and indices;
      // its budget only for a cost reader.
      const home = (await api.get(reads().workspaceDashboard.route, viewerAuth)).body.data;
      const row = home.projectHealth.find((entry) => entry.id === project.id);
      expect([viewer, typeof row.overallScore, "spi" in row, "cpi" in row, "bac" in row, "eac" in row, row.bac, row.ev, "pv" in row, "ac" in row]).toEqual([
        viewer,
        "number",
        true,
        true,
        readsCost,
        readsCost,
        readsCost ? 41519.6 : undefined,
        readsCost ? 21337 : undefined,
        readsCost,
        readsCost,
      ]);
      // The health card's cost dimension: the score and CPI for everyone,
      // earned value and actual cost only for a reader of the BOQ or cost.
      const health = (await api.get(reads().health.route, viewerAuth)).body.data;
      const cost = health.dimensions.find((dimension) => dimension.key === "cost");
      expect([viewer, typeof cost.score, "cpi" in cost.detail, cost.detail.ev, "ac" in cost.detail]).toEqual([
        viewer,
        "number",
        true,
        readsCost ? 21337 : undefined,
        readsCost,
      ]);
      const schedule = (await api.get(reads().schedule.route, viewerAuth)).body.data;
      const pour = schedule.activities.find((activity) => activity.id === activities.pour.id);
      // Its mapping badge is the bill's; its criticality is the schedule's.
      expect([viewer, "approvedAllocationCount" in pour, typeof pour.isCritical]).toEqual([viewer, false, "boolean"]);
      const allocations = schedule.revision.readiness.checks.find((check) => check.key === "allocations");
      expect(allocations).toMatchObject({ key: "allocations", severity: "blocking", passed: false });
      // The budget: a cost reader reads it in the Cost module already.
      expect([viewer, "budget" in pour, pour.budget]).toEqual(readsCost ? [viewer, true, 21337] : [viewer, false, undefined]);
      // The forecast: the levels and counts stay; the money only for a cost reader.
      const forecast = (await api.get(reads().forecast.route, viewerAuth)).body.data;
      expect([viewer, forecast.cost.budget, typeof forecast.cost.counts.lines, typeof forecast.summary.costLevel]).toEqual([
        viewer,
        readsCost ? 41519.6 : undefined,
        "number",
        "string",
      ]);
      for (const activity of forecast.activities) {
        expect([viewer, Object.keys(activity.cost).sort()]).toEqual([
          viewer,
          readsCost ? ["actual", "basis", "budget", "committed", "level", "overrun", "overrunPct", "projected", "reasons"] : ["basis", "level"],
        ]);
      }
    }
  });

  it("the forecast's explanation is written from the forecast its reader receives", async () => {
    const full = await post(at("/forecast/explain"), {});
    expect([full.status, full.body?.error, full.body.data.degraded]).toEqual([200, undefined, true]);
    // A BOQ reader: the service's answer, byte for byte.
    const service = await forecastService.explain({ ...ids(), user: { ...live.user, role: "pm" } });
    expect(unstamped(full.text)).toBe(unstamped(JSON.stringify({ success: true, data: normalizeMoneyTree(service) })));
    expect(full.body.data.narrative.cost).not.toMatch(/not available/);
    for (const [viewer, { user, readsCost, secrets }] of Object.entries(viewers())) {
      const explained = await api.post(at("/forecast/explain"), {}, as(user));
      expect([viewer, explained.status, explained.body?.error]).toEqual([viewer, 200, undefined]);
      for (const secret of secrets) {
        expect([viewer, secret, explained.text.includes(secret)]).toEqual([viewer, secret, false]);
      }
      const mine = parsed(explained.text).data;
      const theirs = parsed(full.text).data;
      if (readsCost) {
        expect([viewer, mine]).toEqual([viewer, theirs]);
      } else {
        expect(mine.forecast).toEqual(forecastWithoutMoney(theirs.forecast));
        expect(mine.narrative.cost).toBe("The cost figures are not available to you on this project.");
        expect(mine.narrative.headline).not.toMatch(/over budget/);
      }
    }
  });

  it("a PM without BOQ read, refused a lifecycle step or a period lock over readiness, is told why without the bill's figures", async () => {
    const pmAuth = as(members.pm);
    const refusals = {
      approve: { route: at(`/schedule/revisions/${stagedRevision.id}/approve`), code: "SCHEDULE_NOT_READY", status: 400 },
      baselineRevision: { route: at(`/schedule/revisions/${activeRevision.id}/baseline`), code: "SCHEDULE_NOT_READY", status: 400 },
      baselineCurrent: { route: at("/schedule/baseline"), body: { revisionId: activeRevision.id }, code: "SCHEDULE_NOT_READY", status: 400 },
      lock: { route: at(`/reports/periods/${openPeriod.id}/lock`), code: "REPORTING_READINESS_BLOCKED", status: 409 },
    };
    for (const [name, { route, body = {}, code, status }] of Object.entries(refusals)) {
      const [full, limited] = [await api.post(route, body, auth()), await api.post(route, body, pmAuth)];
      // The same refusal for both: status, code, message, and the verdicts —
      // except that where the refusal names mapping the BOQ as the fix, the
      // PM who may not map it is told who can (the D5 sweep); no figure.
      expect([name, full.status, full.body?.error?.code]).toEqual([name, status, code]);
      const whoCan = full.body.error.message.includes("(Project Controls › Mapping)") && code === "SCHEDULE_NOT_READY"
        ? " The step on Project Controls › Mapping needs a member who can map the BOQ to activities; ask one of them."
        : "";
      expect([name, limited.status, limited.body?.success, limited.body?.error?.code, limited.body?.error?.message]).toEqual([
        name,
        status,
        false,
        code,
        `${full.body.error.message}${whoCan}`,
      ]);
      // The BOQ reader is told the bill's figures ...
      expect([name, keyPaths(full.body.error.details, new Set(BOQ_KEYS)).length > 0]).toEqual([name, true]);
      // ... the PM without BOQ read is not, and is told everything else.
      expect([name, keyPaths(limited.body.error.details, new Set(BOQ_KEYS))]).toEqual([name, []]);
      for (const secret of ["71793.5", "30273.9", "50456.5"]) {
        expect([name, secret, limited.text.includes(secret)]).toEqual([name, secret, false]);
      }
      expect([name, parsed(limited.text).error.details]).toEqual([name, without(parsed(full.text).error.details, new Set(BOQ_KEYS))]);
      if (code === "SCHEDULE_NOT_READY") {
        expect([name, limited.body.error.details.ready, limited.body.error.details.blockingCount]).toEqual([
          name,
          false,
          full.body.error.details.blockingCount,
        ]);
      }
    }
    // The BOQ reader's refusal is the service's own, byte for byte.
    const thrown = await scheduleService
      .approveRevision({ ...ids(), revisionId: stagedRevision.id, userId: live.user.id, userRole: "pm" })
      .then(() => null, (error) => error);
    expect(thrown?.code).toBe("SCHEDULE_NOT_READY");
    const approveFull = await api.post(refusals.approve.route, {}, auth());
    expect(unstamped(JSON.stringify(approveFull.body.error.details))).toBe(unstamped(JSON.stringify(normalizeMoneyTree(thrown.details))));
    // Nothing moved: the revisions and the period are as they were.
    const [staged, active, period] = await Promise.all([
      prisma.scheduleRevision.findUnique({ where: { id: stagedRevision.id }, select: { status: true } }),
      prisma.scheduleRevision.findUnique({ where: { id: activeRevision.id }, select: { status: true } }),
      prisma.reportingPeriod.findUnique({ where: { id: openPeriod.id }, include: { evSnapshot: { select: { id: true } } } }),
    ]);
    expect([staged.status, active.status, period.evSnapshot]).toEqual(["under_review", "approved", null]);
  });

  it("a PM without BOQ read who locks a period over the gate is answered with the report without the bill's figures", async () => {
    const locked = await api.post(at(`/reports/periods/${openPeriod.id}/lock`), { overrideReason: "LiveTest: PM without BOQ read" }, as(members.pm));
    expect([locked.status, locked.body?.error]).toEqual([200, undefined]);
    expect(keyPaths(locked.body.data, new Set(BOQ_KEYS)).filter((path) => !EV_BUDGET_PATHS.has(path))).toEqual([]);
    for (const secret of ["71793.5", "30273.9", "50456.5"]) expect([secret, locked.text.includes(secret)]).toEqual([secret, false]);
    // The same report the BOQ reader now reads for that period, without the bill.
    const full = await api.get(at(`/reports/ev?periodId=${openPeriod.id}`), auth());
    expect(full.body.data.unallocatedBoqAmount).toBe(30273.9);
    expect(parsed(locked.text).data).toEqual(evWithoutBill(parsed(full.text).data));
    // ... and the snapshot it stored is the whole one (output only).
    const snapshot = await prisma.evPeriodSnapshot.findFirst({ where: { reportingPeriodId: openPeriod.id } });
    expect(snapshot.basisJson.unallocatedBoqAmount).toBe(30273.9);
  });

  it("output only: the locked period's stored snapshot keeps the gate as it was frozen", async () => {
    const snapshot = await prisma.evPeriodSnapshot.findFirst({ where: { reportingPeriodId: lockedPeriod.id } });
    expect(snapshot).toBeTruthy();
    expect(snapshot.basisJson.unallocatedBoqAmount).toBe(30273.9);
    expect(keyPaths(snapshot.basisJson.readinessGate, new Set(["unallocatedAmount"])).length > 0).toBe(true);
  });

  it("the progress a site engineer submits comes back without the activity's figures", async () => {
    const viewerAuth = as(members.siteEngineer);
    const submitted = await api.post(at(`/activities/${activities.fix.id}/progress`), { pctComplete: 10, status: "submitted" }, viewerAuth);
    expect([submitted.status, submitted.body?.error]).toEqual([200, undefined]);
    expect(submitted.body.data.activity.id).toBe(activities.fix.id);
    expect(submitted.body.data.submission).toBeTruthy();
    expect(keyPaths(submitted.body.data, new Set([...BOQ_KEYS, ...BUDGET_KEYS]))).toEqual([]);
    // ... and the Progress tab's list of submissions carries none either.
    const listed = await api.get(at("/activities/progress-submissions?status=submitted"), viewerAuth);
    expect([listed.status, listed.body.data.length > 0]).toEqual([200, true]);
    expect(keyPaths(listed.body.data, new Set([...BOQ_KEYS, ...BUDGET_KEYS]))).toEqual([]);
  });

  it("setup readiness gives a member without BOQ read no count of BOQ rows — each issue keeps its code, severity and verdict, the number is replaced by the withheld wording — and the BOQ reader's answer is the service's", async () => {
    const BOQ_ROW_CODES = ["BOQ_ITEMS_WITHOUT_WBS", "BOQ_ITEMS_WITHOUT_COST_CODE", "BOQ_UNIT_UNRESOLVED", "UOM_UNRESOLVED"];
    const issuesOf = (readiness) => readiness.steps.flatMap((step) => [...step.blockers, ...step.warnings, ...step.advisories].map((issue) => ({ step: step.key, issue })));
    // Last in this file, so no earlier answer moves: give the bill rows the
    // filing and unit checks can count — a WBS node (both rows now unfiled),
    // a project cost code (both rows without one) and the steel row's unit
    // respelt as one nobody recognises (its quantity and value unchanged).
    const node = await post(at("/structure/wbs"), { code: "SUB", name: "Substructure" });
    expect([node.status, node.body?.error]).toEqual([201, undefined]);
    const costCode = await prisma.costCode.create({ data: { orgId: live.org.id, code: `LT-${Date.now()}`, name: "LiveTest concrete" } });
    await prisma.projectCostCode.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: costCode.id } });
    const steel = await prisma.boqItem.findFirst({ where: { projectId: project.id, code: "1.2" }, select: { id: true } });
    await prisma.boqItem.update({ where: { id: steel.id }, data: { unit: "tonz-x", unitCode: null } });

    const full = await api.get(at("/setup-readiness"), auth());
    expect([full.status, full.body?.error]).toEqual([200, undefined]);
    const reader = parsed(full.text).data;
    // The BOQ reader's answer is the service's, byte for byte ...
    const service = await require("../project-setup-readiness.service").getSetupReadiness({ ...ids(), canReadBoq: true });
    expect(unstamped(full.text)).toBe(unstamped(JSON.stringify({ success: true, data: normalizeMoneyTree(service) })));
    // ... and it counts the rows: two BOQ rows, neither filed under the WBS
    // node or a cost code, one with an unknown unit.
    const readerCounts = reader.steps.find((step) => step.key === "boq_upload").counts;
    expect(readerCounts).toMatchObject({ boqItems: 2, itemsWithoutWbs: 2, itemsWithoutCostCode: 2, itemsWithUnresolvedUnit: 1 });
    expect(reader.structure.unitsUnresolved).toBe(1);
    const readerRowIssues = issuesOf(reader).filter(({ issue }) => BOQ_ROW_CODES.includes(issue.code));
    expect(readerRowIssues.map(({ issue }) => [issue.code, issue.count]).sort()).toEqual([
      ["BOQ_ITEMS_WITHOUT_COST_CODE", 2],
      ["BOQ_ITEMS_WITHOUT_WBS", 2],
      ["BOQ_UNIT_UNRESOLVED", 1],
      ["UOM_UNRESOLVED", 1],
    ]);
    for (const [viewer, { user }] of Object.entries(viewers())) {
      const limited = await api.get(at("/setup-readiness"), as(user));
      expect([viewer, limited.status]).toEqual([viewer, 200]);
      const mine = parsed(limited.text).data;
      // Not one BOQ-derived count key anywhere in the answer.
      expect([viewer, keyPaths(mine, new Set(BOQ_KEYS))]).toEqual([viewer, []]);
      // Every BOQ row issue the reader sees, with its code, severity and step — no number.
      const rowIssues = issuesOf(mine).filter(({ issue }) => BOQ_ROW_CODES.includes(issue.code));
      expect([viewer, rowIssues.map(({ step, issue }) => [step, issue.code, issue.severity])]).toEqual([
        viewer,
        readerRowIssues.map(({ step, issue }) => [step, issue.code, issue.severity]),
      ]);
      for (const { issue } of rowIssues) {
        expect([viewer, issue.code, "count" in issue, /\d/.test(issue.message), issue.boqDetailsWithheld, issue.reason]).toEqual([
          viewer,
          issue.code,
          false,
          false,
          true,
          "BOQ details unavailable to you",
        ]);
      }
      // The statuses and gates are everyone's.
      expect([viewer, mine.steps.map((step) => [step.key, step.status])]).toEqual([viewer, reader.steps.map((step) => [step.key, step.status])]);
      expect([viewer, mine.gates.reporting.ready, mine.gates.baseline.ready]).toEqual([viewer, reader.gates.reporting.ready, reader.gates.baseline.ready]);
      // No row count in the structure summary or the BOQ-structure guide.
      expect([viewer, mine.structure.unitsUnresolved, mine.structure.unitsUnresolvedWithheld]).toEqual([viewer, undefined, true]);
      const guide = mine.steps.find((step) => step.key === "structure_setup").guides.find((entry) => entry.key === "boq_structure");
      expect([viewer, guide.count, guide.detail]).toEqual([viewer, null, "BOQ details unavailable to you"]);
    }
  });

  it("a critical activity without an approved allocation: the BOQ reader is told how many; a member without BOQ read is told the mapping details are withheld — no count, no tone, no badge — and sees the same critical path", async () => {
    // Last in this file, so no earlier answer moves: a third activity with
    // no allocation, on the critical path. It is flagged critical on zero
    // float by its key (one known row in this LiveTest organisation), so the
    // count does not rest on how CPM ranks three unlinked activities.
    const created = await post(at("/activities"), {
      name: "Strip formwork",
      activityCode: "A120",
      duration: 3,
      startDate: "2026-02-09",
      endDate: "2026-02-11",
      engineerIds: [live.user.id],
    });
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    const stripId = created.body.data.id;
    await prisma.activity.update({ where: { id: stripId }, data: { isCritical: true, totalFloat: 0 } });

    const MAPPING_KEYS = new Set(["criticalUnmappedActivities", "approvedAllocationCount", "coveragePct"]);
    const MAPPING_HEADLINE = ["mapping", "unmapped_quantity", "unmapped_boq", "critical_unmapped"];
    const criticalOf = (readiness) => readiness.steps.find((step) => step.key === "schedule_generation").counts.criticalActivities;
    const criticalIds = (list) => list.filter((activity) => activity.isCritical).map((activity) => activity.id).sort();

    // The BOQ reader: the count, in the summary and the headline, and the
    // activity's mapping badge (no approved allocation).
    const reader = parsed((await api.get(at("/setup-readiness"), auth())).text).data;
    const unmapped = reader.summary.criticalUnmappedActivities;
    expect(unmapped).toBeGreaterThanOrEqual(1);
    expect(reader.summary.headline.find((entry) => entry.key === "critical_unmapped")).toMatchObject({
      value: String(unmapped),
      tone: "review",
      raw: unmapped,
    });
    expect(reader.summary).not.toHaveProperty("criticalUnmappedWithheld");
    const readerSchedule = (await api.get(at("/schedule"), auth())).body.data;
    expect(readerSchedule.activities.find((activity) => activity.id === stripId)).toMatchObject({
      isCritical: true,
      totalFloat: 0,
      approvedAllocationCount: 0,
    });
    const readerActivities = (await api.get(at("/activities"), auth())).body.data;
    const readerList = Array.isArray(readerActivities) ? readerActivities : readerActivities.items;
    expect(readerList.find((activity) => activity.id === stripId)).toMatchObject({ isCritical: true, approvedAllocationCount: 0 });

    for (const [viewer, { user }] of Object.entries(viewers())) {
      const viewerAuth = as(user);
      const limited = await api.get(at("/setup-readiness"), viewerAuth);
      expect([viewer, limited.status]).toEqual([viewer, 200]);
      const mine = parsed(limited.text).data;
      // Not one mapping-derived key anywhere in the answer ...
      expect([viewer, keyPaths(mine, MAPPING_KEYS)]).toEqual([viewer, []]);
      // ... the summary says the count is withheld, and why ...
      expect([viewer, mine.summary.criticalUnmappedWithheld, mine.summary.criticalUnmappedReason]).toEqual([
        viewer,
        true,
        "Mapping details unavailable to you",
      ]);
      // ... and so does the headline entry: a dash, a neutral tone, no raw figure.
      expect([viewer, mine.summary.headline.find((entry) => entry.key === "critical_unmapped")]).toEqual([
        viewer,
        {
          key: "critical_unmapped",
          label: "Critical unmapped activities",
          value: "—",
          tone: "neutral",
          raw: null,
          withheld: true,
          reason: "Mapping details unavailable to you",
        },
      ]);
      // Every other entry of the status line, and the rest of the summary, is the reader's.
      expect([viewer, mine.summary.headline.filter((entry) => !MAPPING_HEADLINE.includes(entry.key))]).toEqual([
        viewer,
        reader.summary.headline.filter((entry) => !MAPPING_HEADLINE.includes(entry.key)),
      ]);
      const summaryWithout = (summary, keys) => Object.fromEntries(Object.entries(summary).filter(([key]) => !keys.includes(key)));
      expect([viewer, summaryWithout(mine.summary, ["headline", "criticalUnmappedWithheld", "criticalUnmappedReason"])]).toEqual([
        viewer,
        summaryWithout(reader.summary, ["headline", "criticalUnmappedActivities"]),
      ]);
      // The critical path is theirs: the same critical activities, counted
      // the same, flagged the same on the schedule and the activities list.
      expect([viewer, criticalOf(mine)]).toEqual([viewer, criticalOf(reader)]);
      const schedule = (await api.get(at("/schedule"), viewerAuth)).body.data;
      expect([viewer, criticalIds(schedule.activities)]).toEqual([viewer, criticalIds(readerSchedule.activities)]);
      const strip = schedule.activities.find((activity) => activity.id === stripId);
      expect([viewer, strip.isCritical, strip.totalFloat, "approvedAllocationCount" in strip]).toEqual([viewer, true, 0, false]);
      const listed = (await api.get(at("/activities"), viewerAuth)).body.data;
      const list = Array.isArray(listed) ? listed : listed.items;
      expect([viewer, criticalIds(list)]).toEqual([viewer, criticalIds(readerList)]);
      expect([viewer, keyPaths(list, MAPPING_KEYS)]).toEqual([viewer, []]);
    }
  });
});
