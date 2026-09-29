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
 *     And, cost readers included (owner decision E1, 2026-09-28), no
 *     per-activity figure an allocation gives: no activity budget (nor the
 *     generator's per-activity or per-WBS-node budget), no forecast cost per
 *     activity (budget, projection, basis, level) and no list or tally of
 *     the activities over budget, no EV breakdown per activity, no
 *     allocation on a cost record or in the budget reconciliation — nor
 *     through the report builder (an activity's budget; a cost record's
 *     budget, variance and CPI: null, and said so, as cells, filters, sorts,
 *     groupings, aggregates, exports and saved reports' runs).
 *   neither BOQ nor cost read: nor the project totals built from the bill
 *     (the revision's totals, the generator's total, the forecast's money,
 *     EV, PV, AC, BAC and EAC, a revision's total in its history).
 *
 * Nor anything read off the mapping (owner decision, 2026-09-28): no
 * approved allocation count on an activity, no count of critical activities
 * without an approved allocation, no coverage share. Their criticality —
 * the critical flag, the float, the count of critical activities — stays.
 * The last case is the reviewer's differential test: one approved
 * allocation moved from a critical to a non-critical activity changes
 * nothing in any answer a member without BOQ read receives.
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
const costService = require("../cost.service");
const budgetService = require("../budget.service");
const { startApi } = require("./auth-live-kit");
const ExcelJS = require("exceljs");

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
  // The BOQ row that created an activity (POST /boq/items with an activity
  // name), which GET /schedule carried off the activity's row: a
  // per-activity link to the bill, a mapping badge by another name.
  "mintedByBoqItemId",
];
// ... and what a member who reads neither the BOQ nor the cost module must
// not receive either: the budgets built from the bill, and the forecast's
// money built from them.
const BUDGET_KEYS = ["budget", "generatedBudget", "totalBudget", "generatedTotalBudget", "eac", "bottomUp", "bac"];
// A per-activity budget read off the mapping, withheld from a cost reader
// without BOQ read too (owner decision E1): on every answer but the cost
// module's own and the forecast's and EV report's (whose project cost is
// also called "budget"; they are compared shape for shape below).
const ACTIVITY_BUDGET_KEYS = ["budget", "generatedBudget"];
const MAPPING_WITHHELD = "Mapping details unavailable to you";
// The forecast's money, where it sits (the cost block, each budget line) —
// and each activity's whole cost, whose basis and level say whether it has
// an approved allocation (owner decision, 2026-09-28), with the list and
// tally of the activities over budget and the EAC's basis.
const FORECAST_COST_KEYS = ["budget", "bac", "eac", "bottomUp", "projected", "overrun", "overrunPct", "actual"];
const FORECAST_LINE_KEYS = ["revised", "committed", "actual", "forecast", "overrun", "overrunPct"];
const FORECAST_COST_WITHHELD = "Cost figures are not available to you";
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
  let pourMintedBy;
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
      DATABASE_CONNECTION_LIMIT: "4",
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
    // The pour stands for an activity its BOQ row created (POST /boq/items
    // with an activity name mints the activity and allocates the whole row
    // to it — which is what the concrete is to the pour here): it carries the
    // row's id, so the sweep below looks for mintedByBoqItemId on every
    // schedule answer. One known row of this LiveTest organisation; the last
    // case mints one through the API.
    await prisma.activity.update({ where: { id: activities.pour.id }, data: { mintedByBoqItemId: concrete.id } });
    pourMintedBy = concrete.id;

    // The pour is complete and the fixing half done, both approved inside
    // the open period (P02, 1–28 February): the pour's earned value is its
    // whole allocation (21337, its budget) and the fixing's half of its
    // (10091.3), so EV on the health card and the workspace home — 31428.3,
    // a project total — is a figure the sweep can find (§12: EV that equals
    // allocation × % complete), and no activity's own figure is the total.
    for (const [activity, pctComplete] of [[activities.pour, 100], [activities.fix, 50]]) {
      await prisma.activityProgress.create({
        data: {
          activityId: activity.id,
          pctComplete,
          status: "approved",
          approvedBy: live.user.id,
          approvedAt: new Date("2026-02-15T12:00:00.000Z"),
          updatedAt: new Date("2026-02-15T12:00:00.000Z"),
        },
      });
    }

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
      secrets: ["71793.5", "30273.9", "21337", "20182.6", "10091.3", "48662.99", "31428", "41519.6", "69999.99", "50456.5", "213.37", "1009.13"],
    },
    // The cost module, not the BOQ: the project's totals stay — and no
    // activity's own figure, whichever answer carries it (owner decision
    // E1): the pour's allocation and EV (21337), the fixing's allocation
    // (20182.6) and EV (10091.3), the generator's budget for the fixing
    // (48662.99).
    ...Object.fromEntries(
      ["costController", "planningEngineer", "pm"].map((key) => [
        key,
        {
          user: members[key],
          readsCost: true,
          withheld: new Set(BOQ_KEYS),
          secrets: ["71793.5", "30273.9", "50456.5", "213.37", "1009.13", "21337", "20182.6", "10091.3", "48662.99"],
        },
      ]),
    ),
  });
  // What a viewer may not receive on one answer: a cost reader's
  // per-activity budgets are withheld everywhere but the cost module's own
  // answers and the forecast's and EV report's (compared shape for shape).
  const withheldOn = ({ withheld, readsCost }, { kind, cost }) =>
    readsCost && !cost && kind !== "forecast" && kind !== "ev" ? new Set([...withheld, ...ACTIVITY_BUDGET_KEYS]) : withheld;

  // The EV report is a cost reader's, and so is its budget: the approved
  // allocations' sum it states (top level and in its source summary) stays.
  const EV_BUDGET_PATHS = new Set([".approvedAllocatedAmount", ".sourceSummary.budget.approvedAllocatedAmount"]);

  // The forecast without its money, where the money sits, and without
  // anything of the cost view read off the mapping: each activity's cost is
  // withheld whole, the activities over budget and their tally and the
  // EAC's basis are left out, and the cost block says it is withheld.
  const forecastWithoutMoney = (forecast) => {
    const copy = clone(forecast);
    const activityCost = (activity) => {
      if (activity?.cost) activity.cost = { withheld: true, reason: FORECAST_COST_WITHHELD };
    };
    (copy.activities || []).forEach(activityCost);
    (copy.schedule?.topRisks || []).forEach(activityCost);
    if (copy.cost) {
      drop(copy.cost, [...FORECAST_COST_KEYS, "eacBasis", "topRisks"]);
      drop(copy.cost.counts, ["atRisk"]);
      (copy.cost.budgetLines || []).forEach((line) => drop(line, FORECAST_LINE_KEYS));
      Object.assign(copy.cost, { withheld: true, reason: FORECAST_COST_WITHHELD });
    }
    return copy;
  };

  // A cost reader's forecast without the BOQ (owner decision E1): the
  // project's cost and the budget lines stay; each activity's cost keeps its
  // spend and commitments (the cost ledger's) and says the rest is withheld;
  // the activities over budget and their tally go.
  const forecastWithoutMapping = (forecast) => {
    const copy = clone(forecast);
    const activityCost = (activity) => {
      if (activity?.cost) {
        activity.cost = { actual: activity.cost.actual, committed: activity.cost.committed, withheld: true, reason: MAPPING_WITHHELD };
      }
    };
    (copy.activities || []).forEach(activityCost);
    (copy.schedule?.topRisks || []).forEach(activityCost);
    if (copy.cost) {
      drop(copy.cost, ["topRisks"]);
      drop(copy.cost.counts, ["atRisk"]);
      Object.assign(copy.cost, { activityCostWithheld: true, activityCostReason: MAPPING_WITHHELD });
    }
    return copy;
  };

  // The EV report without the bill's figures, where they sit — and without
  // its per-activity breakdown (owner decision E1), which it says is withheld.
  const evWithoutBill = (report) => {
    const copy = clone(report);
    delete copy.unallocatedBoqAmount;
    for (const list of ["blockers", "warnings"]) {
      for (const entry of copy.readinessGate?.[list] || []) {
        if (entry.details) drop(entry.details, BOQ_KEYS);
      }
    }
    delete copy.activityBreakdown;
    copy.activityBreakdownWithheld = true;
    copy.activityBreakdownReason = MAPPING_WITHHELD;
    return copy;
  };

  // Every answer the owner's differential (E1) names, as each member
  // receives it — and the project's history, where a cost record's budget
  // would sit. The EV report is also asked at an ad hoc cutoff after both
  // periods (both are locked by the time the differentials run, and a locked
  // period answers with its stored snapshot).
  const differentialAnswers = () => [
    ["schedule", "get", at("/schedule")],
    ["activities", "get", at("/activities")],
    ["forecast", "get", at("/forecast")],
    ["forecast/explain", "post", at("/forecast/explain")],
    ["EV report", "get", at("/reports/ev")],
    ["EV report (ad hoc cutoff)", "get", at("/reports/ev?cutoffDate=2026-06-30")],
    ["health", "get", at("/health")],
    ["setup-readiness", "get", at("/setup-readiness")],
    ["workspace home", "get", "/api/v1/projects/workspace-dashboard"],
    // ... and the Cost module's own answers that state an activity's
    // allocation, or add allocations up over the activities that have a
    // cost record: each record's budget, the summary, the reconciliation.
    ["cost records", "get", at("/cost")],
    ["cost summary", "get", at("/cost/summary")],
    ["budget reconciliation", "get", at("/budget/reconciliation")],
    ["history", "get", at("/audit?limit=100")],
  ];
  const captureAnswers = async (answers, headers) => {
    const result = {};
    for (const [name, method, route] of answers) {
      const response = method === "post" ? await api.post(route, {}, headers) : await api.get(route, headers);
      result[name] = { status: response.status, text: response.text, body: JSON.parse(unstampedDashboard(response.text)) };
    }
    return result;
  };
  const withoutText = (captured) => Object.fromEntries(Object.entries(captured).map(([name, { status, body }]) => [name, { status, body }]));
  // The Cost module's answers as the service builds them: what a BOQ reader
  // receives, byte for byte.
  const costServiceAnswers = async () => ({
    "cost records": await costService.getCostRecords({ ...ids(), query: {} }),
    "cost summary": await costService.getCostSummary(ids()),
    "budget reconciliation": await budgetService.reconcile(ids()),
  });
  const expectServiceAnswers = async (captured, label) => {
    for (const [name, answer] of Object.entries(await costServiceAnswers())) {
      expect([label, name, captured[name].status]).toEqual([label, name, 200]);
      expect([label, name, unstampedDashboard(captured[name].text)]).toEqual([
        label,
        name,
        unstampedDashboard(JSON.stringify({ success: true, data: normalizeMoneyTree(answer) })),
      ]);
    }
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
    expect(pour).toMatchObject({ allocatedBoqAmount: 21337, allocatedBoqQuantity: 100, budget: 21337, approvedAllocationCount: 1, mintedByBoqItemId: pourMintedBy });
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
    expect(home.projectHealth.find((row) => row.id === project.id)).toMatchObject({ bac: 41519.6, eac: 41519.6, ev: 31428.3 });
    // The health card: EV is the complete pour's whole allocation and half
    // the fixing's.
    const health = (await api.get(reads().health.route, auth())).body.data;
    expect(health.dimensions.find((dimension) => dimension.key === "cost").detail).toMatchObject({ ev: 31428, ac: 0 });
    // The EV report's breakdown: each activity's allocation and EV.
    const ev = (await api.get(reads().ev.route, auth())).body.data;
    expect(ev.activityBreakdown.map((row) => [row.activityId, row.budget, row.ev])).toEqual([
      ["A100", 21337, 21337],
      ["A110", 20182.6, 10091.3],
    ]);
  });

  it("the site engineer, the cost controller, the planning engineer and a PM, all without BOQ read, receive none of the bill's figures from any request of the Overview or the Schedule module — and everything else unchanged", async () => {
    for (const [viewer, who] of Object.entries(viewers())) {
      const { user, readsCost, secrets } = who;
      const viewerAuth = as(user);
      // The BOQ endpoints refuse this member — the premise of §12.
      expect([viewer, (await api.get(at("/boq"), viewerAuth)).status]).toEqual([viewer, 403]);
      for (const [name, read] of Object.entries(reads())) {
        const { route, kind, cost, boq } = read;
        const withheld = withheldOn(who, read);
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
          expect([viewer, name, mine]).toEqual([viewer, name, readsCost ? forecastWithoutMapping(theirs) : forecastWithoutMoney(theirs)]);
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
        readsCost ? 31428.3 : undefined,
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
        readsCost ? 31428 : undefined,
        readsCost,
      ]);
      const schedule = (await api.get(reads().schedule.route, viewerAuth)).body.data;
      const pour = schedule.activities.find((activity) => activity.id === activities.pour.id);
      // Its mapping badge is the bill's; its criticality is the schedule's.
      expect([viewer, "approvedAllocationCount" in pour, "mintedByBoqItemId" in pour, typeof pour.isCritical]).toEqual([viewer, false, false, "boolean"]);
      const allocations = schedule.revision.readiness.checks.find((check) => check.key === "allocations");
      expect(allocations).toMatchObject({ key: "allocations", severity: "blocking", passed: false });
      // The activity's budget is its approved allocation: withheld from every
      // member without BOQ read, cost readers included (owner decision E1).
      // The revision's total — the project's — stays for a cost reader.
      expect([viewer, "budget" in pour, "generatedBudget" in pour]).toEqual([viewer, false, false]);
      expect([viewer, schedule.revision.totalBudget]).toEqual([viewer, readsCost ? 41519.6 : undefined]);
      // The forecast: the schedule's levels and counts and the project's cost
      // verdict stay; the project's money only for a cost reader — and, for
      // everyone without BOQ read, no activity's budget, projection, cost
      // basis or level (each says whether the activity has an approved
      // allocation), no list or tally of the activities over budget; for a
      // reader of neither, no EAC basis either.
      const forecast = (await api.get(reads().forecast.route, viewerAuth)).body.data;
      expect([viewer, forecast.cost.budget, typeof forecast.cost.counts.lines, typeof forecast.summary.costLevel]).toEqual([
        viewer,
        readsCost ? 41519.6 : undefined,
        "number",
        "string",
      ]);
      expect([
        viewer,
        "eacBasis" in forecast.cost,
        "topRisks" in forecast.cost,
        "atRisk" in forecast.cost.counts,
        forecast.cost.withheld,
        forecast.cost.reason,
        forecast.cost.activityCostWithheld,
        forecast.cost.activityCostReason,
      ]).toEqual(
        readsCost
          ? [viewer, true, false, false, undefined, undefined, true, MAPPING_WITHHELD]
          : [viewer, false, false, false, true, FORECAST_COST_WITHHELD, undefined, undefined],
      );
      for (const activity of [...forecast.activities, ...forecast.schedule.topRisks]) {
        expect([viewer, Object.keys(activity.cost).sort(), activity.cost.reason]).toEqual([
          viewer,
          readsCost ? ["actual", "committed", "reason", "withheld"] : ["reason", "withheld"],
          readsCost ? MAPPING_WITHHELD : FORECAST_COST_WITHHELD,
        ]);
      }
      // The EV report (a cost reader's): the totals, and no per-activity
      // breakdown — it says it is withheld and why.
      if (readsCost) {
        const ev = (await api.get(reads().ev.route, viewerAuth)).body.data;
        expect([viewer, ev.totalBudget, ev.ev, "activityBreakdown" in ev, ev.activityBreakdownWithheld, ev.activityBreakdownReason]).toEqual([
          viewer,
          41519.6,
          31428.3,
          false,
          true,
          MAPPING_WITHHELD,
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
        // The forecast without its per-activity cost (E1); the narrative the
        // BOQ reader's, except that its cost paragraph says which activities
        // are over budget is not available — never "no activity is".
        expect([viewer, mine.forecast]).toEqual([viewer, forecastWithoutMapping(theirs.forecast)]);
        expect([viewer, { ...mine.narrative, cost: undefined }]).toEqual([viewer, { ...theirs.narrative, cost: undefined }]);
        expect([viewer, mine.narrative.cost]).toEqual([
          viewer,
          `${theirs.narrative.cost} Which activities are over budget is not available to you (mapping details).`,
        ]);
        expect([viewer, mine.degraded, mine.reason, mine.message]).toEqual([viewer, theirs.degraded, theirs.reason, theirs.message]);
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
    // The forecast gives the reader the same badge in another form: an
    // activity's cost has a basis only when it has a budget (an approved
    // allocation) — so the critical activities whose basis is null are the
    // critical unmapped ones, counted exactly.
    const readerForecast = (await api.get(at("/forecast"), auth())).body.data;
    const unmappedOffForecast = (forecast) =>
      forecast.activities.filter((activity) => activity.isCritical && activity.cost && "basis" in activity.cost && activity.cost.basis === null).length;
    expect(readerForecast.activities.find((activity) => activity.id === stripId)).toMatchObject({ isCritical: true, cost: { basis: null } });
    expect(readerForecast.activities.find((activity) => activity.id === activities.pour.id).cost.basis).not.toBeNull();
    expect(unmappedOffForecast(readerForecast)).toBe(unmapped);

    for (const [viewer, { user, readsCost }] of Object.entries(viewers())) {
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
      // The forecast: the same critical path; for every member without BOQ
      // read — cost readers included (owner decision E1) — no activity's
      // budget, cost basis or level and no list or tally of the activities
      // over budget: nothing the count could be read off. A reader of
      // neither the BOQ nor the cost module loses the EAC basis too.
      const forecast = (await api.get(at("/forecast"), viewerAuth)).body.data;
      expect([viewer, criticalIds(forecast.activities)]).toEqual([viewer, criticalIds(readerForecast.activities)]);
      const costs = [...forecast.activities, ...forecast.schedule.topRisks].map((activity) => activity.cost);
      expect([viewer, keyPaths(costs, new Set(["basis", "level", "budget", "projected", "overrun"]))]).toEqual([viewer, []]);
      const reason = readsCost ? MAPPING_WITHHELD : FORECAST_COST_WITHHELD;
      expect([viewer, costs.every((cost) => cost.withheld === true && cost.reason === reason)]).toEqual([viewer, true]);
      expect([viewer, keyPaths(forecast.cost, new Set(readsCost ? ["topRisks", "atRisk"] : ["topRisks", "eacBasis", "atRisk"]))]).toEqual([viewer, []]);
      expect([viewer, unmappedOffForecast(forecast)]).toEqual([viewer, 0]);
      expect([viewer, forecast.cost.withheld, forecast.cost.reason, forecast.cost.activityCostWithheld]).toEqual(
        readsCost ? [viewer, undefined, undefined, true] : [viewer, true, FORECAST_COST_WITHHELD, undefined],
      );
      // Nor the schedule's per-activity budget, which is as good a badge.
      expect([viewer, keyPaths(schedule.activities, new Set(ACTIVITY_BUDGET_KEYS))]).toEqual([viewer, []]);
    }
  });

  it("the reviewer's differential: one approved allocation moved from a critical to a non-critical activity changes nothing in any answer a member without BOQ read receives — cost readers included — while the BOQ reader sees it move (E1)", async () => {
    // Last in this file. Two activities alike in everything but their
    // criticality — the same dates, duration, progress (none), engineers and
    // cost-ledger row (committed 12000, nothing spent) — so no project total
    // depends on which of them carries the allocation.
    const twin = async (name, activityCode) => {
      const created = await post(at("/activities"), {
        name,
        activityCode,
        duration: 5,
        startDate: "2026-03-02",
        endDate: "2026-03-06",
        engineerIds: [live.user.id, members.siteEngineer.id],
      });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data.id;
    };
    const critical = await twin("Pour slab west", "A130");
    const floating = await twin("Pour slab east", "A140");
    // Criticality set by key on these two rows of this LiveTest organisation.
    await prisma.activity.update({ where: { id: critical }, data: { isCritical: true, totalFloat: 0 } });
    await prisma.activity.update({ where: { id: floating }, data: { isCritical: false, totalFloat: 5 } });
    for (const activityId of [critical, floating]) {
      await prisma.costRecord.create({ data: { projectId: project.id, activityId, committed: 12000, budget: 0, forecast: 0 } });
    }
    // One approved allocation of a new row (40 m3 at 250 = 10000) to the
    // critical activity: under the commitments, so it is also over budget.
    const slab = await post(at("/boq/items"), { code: "1.3", description: "Concrete in slab", quantity: 40, unit: "m3", rate: 250 });
    expect([slab.status, slab.body?.error]).toEqual([201, undefined]);
    const allocationsRoute = at("/activity-boq-allocations");
    const allocation = await post(allocationsRoute, { boqItemId: slab.body.data.item.id, activityId: critical, quantity: 40 });
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    for (const step of ["submit", "approve"]) {
      const moved = await post(`${allocationsRoute}/${allocation.body.data.id}/${step}`, {});
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }

    // Every answer the owner names, as each member receives it (and the
    // two activities' own answers).
    const answers = [
      ...differentialAnswers(),
      ["activity (critical)", "get", at(`/activities/${critical}`)],
      ["activity (non-critical)", "get", at(`/activities/${floating}`)],
    ];
    const capture = async (headers) => withoutText(await captureAnswers(answers, headers));
    const everyone = { reader: auth(), ...Object.fromEntries(Object.entries(viewers()).map(([viewer, { user }]) => [viewer, as(user)])) };
    const before = {};
    for (const [viewer, headers] of Object.entries(everyone)) before[viewer] = await capture(headers);

    // The move: the one allocation, by its key, after proving it is this
    // LiveTest organisation's (its project's organisation, by name).
    const row = await prisma.activityBoqAllocation.findUnique({
      where: { id: allocation.body.data.id },
      select: { id: true, activityId: true, status: true, project: { select: { orgId: true, org: { select: { name: true } } } } },
    });
    expect([row.activityId, row.status, row.project.orgId, /^LiveTest [0-9a-f-]{36}$/.test(row.project.org.name)]).toEqual([
      critical,
      "approved",
      live.org.id,
      true,
    ]);
    await prisma.activityBoqAllocation.update({ where: { id: row.id }, data: { activityId: floating } });

    const after = {};
    for (const [viewer, headers] of Object.entries(everyone)) after[viewer] = await capture(headers);

    // The BOQ reader sees the allocation move: the budget changes activity,
    // and so does the activity over budget.
    const budgetOf = (capture, id) => capture.schedule.body.data.activities.find((activity) => activity.id === id).budget;
    expect([budgetOf(before.reader, critical), budgetOf(before.reader, floating)]).toEqual([10000, 0]);
    expect([budgetOf(after.reader, critical), budgetOf(after.reader, floating)]).toEqual([0, 10000]);
    const overBudget = (capture) => capture.forecast.body.data.cost.topRisks.map((activity) => activity.id);
    expect([overBudget(before.reader), overBudget(after.reader)]).toEqual([[critical], [floating]]);
    expect(before.reader["EV report (ad hoc cutoff)"].body).not.toEqual(after.reader["EV report (ad hoc cutoff)"].body);
    const recordBudgetOf = (capture, id) => capture["cost records"].body.data.rows.find((record) => record.activityId === id).budget;
    expect([recordBudgetOf(before.reader, critical), recordBudgetOf(after.reader, critical), recordBudgetOf(after.reader, floating)]).toEqual([10000, 0, 10000]);
    const reconciledOf = (capture, id) => capture["budget reconciliation"].body.data.activities.find((row) => row.activityId === id).boqBudget;
    expect([reconciledOf(before.reader, critical), reconciledOf(after.reader, floating)]).toEqual([10000, 10000]);

    // Everyone without BOQ read: not one byte of any answer moves.
    for (const viewer of Object.keys(viewers())) {
      for (const [name] of answers) {
        expect([viewer, name, after[viewer][name]]).toEqual([viewer, name, before[viewer][name]]);
      }
      // (and the answers were answers: the cost reader's EV report included)
      expect([viewer, before[viewer].schedule.status, before[viewer].forecast.status]).toEqual([viewer, 200, 200]);
    }
    expect(before.costController["EV report (ad hoc cutoff)"].status).toBe(200);
    expect(before.siteEngineer["EV report (ad hoc cutoff)"].status).toBe(403);
    // The Cost module's answers to a cost reader without BOQ read: the
    // records without their budget, the reconciliation without any
    // activity's allocation — and saying so.
    for (const viewer of ["costController", "planningEngineer", "pm"]) {
      const { rows } = before[viewer]["cost records"].body.data;
      expect([viewer, rows.length > 0, rows.filter((record) => "budget" in record || "generatedBudget" in record)]).toEqual([viewer, true, []]);
      expect([viewer, before[viewer]["cost summary"].body.data.records.filter((record) => "budget" in record)]).toEqual([viewer, []]);
      const reconciliation = before[viewer]["budget reconciliation"].body.data;
      expect([viewer, reconciliation.activityBudgetsWithheld, reconciliation.activityBudgetsReason, "mismatches" in reconciliation]).toEqual([viewer, true, MAPPING_WITHHELD, false]);
      expect([viewer, reconciliation.activities.filter((row) => "boqBudget" in row || "activityBudget" in row || "difference" in row)]).toEqual([viewer, []]);
    }
    expect(before.siteEngineer["cost records"].status).toBe(403);
  });

  it("the owner's differential in the Cost module: twins in different categories, only one with a cost record the cost controller wrote through the API — moving the allocation between them changes nothing a member without BOQ read receives, the cost-record write answers and the history included; the BOQ reader's cost answers are the service's, byte for byte (E1)", async () => {
    // Last in this file. Two activities alike in dates, duration and
    // progress (none), in different categories, each alone in its category:
    // the civil twin has a cost record, the electrical twin none.
    const twin = async (name, activityCode, category) => {
      const created = await post(at("/activities"), {
        name,
        activityCode,
        category,
        duration: 5,
        startDate: "2026-04-06",
        endDate: "2026-04-10",
        engineerIds: [live.user.id],
      });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data.id;
    };
    const withRecord = await twin("Break out north wall", "A150", "civil");
    const withoutRecord = await twin("Light the south yard", "A160", "electrical");
    // One approved allocation of a new row (37 m3 at 271.13 = 10031.81, a
    // figure nothing else here states) to the twin that will have a record.
    const SECRET = "10031.81";
    const row = await post(at("/boq/items"), { code: "1.4", description: "Break out walls", quantity: 37, unit: "m3", rate: 271.13 });
    expect([row.status, row.body?.error]).toEqual([201, undefined]);
    const allocationsRoute = at("/activity-boq-allocations");
    const allocation = await post(allocationsRoute, { boqItemId: row.body.data.item.id, activityId: withRecord, quantity: 37 });
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    for (const step of ["submit", "approve"]) {
      const moved = await post(`${allocationsRoute}/${allocation.body.data.id}/${step}`, {});
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }

    // The cost controller (no BOQ read) writes the record through the API:
    // made with its activity's approved allocation as its budget, then
    // edited. No forecast is set, so its estimate at completion is that
    // budget — in the summary's category, its totals and its EAC.
    const controller = as(members.costController);
    const upsert = () => api.post(at(`/cost/activity/${withRecord}`), { committed: 0, forecast: 0 }, controller);
    const firstUpsert = await upsert();
    expect([firstUpsert.status, firstUpsert.body?.error]).toEqual([201, undefined]);
    const recordId = firstUpsert.body.data.id;
    const stored = await prisma.costRecord.findUnique({ where: { id: recordId }, select: { budget: true, activityId: true } });
    expect([Number(stored.budget), stored.activityId]).toEqual([10031.81, withRecord]);
    const patch = () => api.request("PATCH", at(`/cost/${recordId}`), { body: { forecast: 0 }, headers: controller });
    const firstPatch = await patch();
    expect([firstPatch.status, firstPatch.body?.error]).toEqual([200, undefined]);
    // A BOQ reader's write is answered with the record exactly as written.
    const readerPatch = await api.request("PATCH", at(`/cost/${recordId}`), { body: { forecast: 0 }, headers: auth() });
    expect([readerPatch.status, readerPatch.body?.error, readerPatch.body.data.budget]).toEqual([200, undefined, 10031.81]);

    const answers = [
      ...differentialAnswers(),
      ["activity (with a record)", "get", at(`/activities/${withRecord}`)],
      ["activity (without a record)", "get", at(`/activities/${withoutRecord}`)],
    ];
    const everyone = { reader: auth(), ...Object.fromEntries(Object.entries(viewers()).map(([viewer, { user }]) => [viewer, as(user)])) };
    const before = {};
    for (const [viewer, headers] of Object.entries(everyone)) before[viewer] = await captureAnswers(answers, headers);
    // The BOQ reader's cost answers are the service's own, byte for byte.
    await expectServiceAnswers(before.reader, "before");

    // The move: the one allocation, by its key, after proving it is this
    // LiveTest organisation's (its project's organisation, by name).
    const allocationRow = await prisma.activityBoqAllocation.findUnique({
      where: { id: allocation.body.data.id },
      select: { id: true, activityId: true, status: true, project: { select: { orgId: true, org: { select: { name: true } } } } },
    });
    expect([allocationRow.activityId, allocationRow.status, allocationRow.project.orgId, /^LiveTest [0-9a-f-]{36}$/.test(allocationRow.project.org.name)]).toEqual([
      withRecord,
      "approved",
      live.org.id,
      true,
    ]);
    await prisma.activityBoqAllocation.update({ where: { id: allocationRow.id }, data: { activityId: withoutRecord } });

    const after = {};
    for (const [viewer, headers] of Object.entries(everyone)) after[viewer] = await captureAnswers(answers, headers);
    await expectServiceAnswers(after.reader, "after");
    // The same writes again, after the move: the record is updated, not made.
    const secondUpsert = await upsert();
    const secondPatch = await patch();
    expect([secondUpsert.status, secondPatch.status]).toEqual([201, 200]);
    const finalHistory = await api.get(at("/audit?limit=100"), controller);
    expect(finalHistory.status).toBe(200);

    // The BOQ reader sees the move where it lands: the record's budget, its
    // category's budget and forecast, the records' totals and the EAC.
    const summaryOf = (capture) => capture["cost summary"].body.data;
    const phase = (capture, name) => summaryOf(capture).byPhase.find((entry) => entry.phase === name);
    expect([phase(before.reader, "civil").budget, phase(before.reader, "civil").forecast]).toEqual([10031.81, 10031.81]);
    expect([phase(after.reader, "civil").budget, phase(after.reader, "civil").forecast]).toEqual([0, 0]);
    expect(summaryOf(after.reader).totals.budget).toBeCloseTo(summaryOf(before.reader).totals.budget - 10031.81, 2);
    expect(summaryOf(after.reader).eac.mostLikely).not.toBe(summaryOf(before.reader).eac.mostLikely);
    const recordOf = (capture) => capture["cost records"].body.data.rows.find((record) => record.id === recordId);
    expect([recordOf(before.reader).budget, recordOf(after.reader).budget, recordOf(after.reader).generatedBudget]).toEqual([10031.81, 0, 10031.81]);

    // Awaiting the owner's decision (closure review, 2026-09-28), and so
    // left as they are here: whether the forecast's bottom-up projection
    // counts as a project total for a cost reader. It adds each activity's
    // projection — its budget where no cost record projects it — so this
    // move changes it, and with it the forecast's projected cost, overrun,
    // the project's cost level and the narrative sentences that state them.
    // Everything else in the forecast is held to the rule below.
    const PENDING_FORECAST_COST = ["bottomUp", "projected", "overrun", "overrunPct"];
    const heldToTheRule = (name, body) => {
      const copy = clone(body);
      const forecast = name === "forecast" ? copy.data : name === "forecast/explain" ? copy.data?.forecast : null;
      if (forecast) {
        drop(forecast.cost, PENDING_FORECAST_COST);
        drop(forecast.summary, ["costLevel"]);
      }
      if (name === "forecast/explain") drop(copy.data?.narrative, ["headline", "cost"]);
      return copy;
    };
    // Everyone without BOQ read: not one byte of any answer moves, and the
    // allocation's figure (nor the row's rate) is nowhere in any of them.
    for (const viewer of Object.keys(viewers())) {
      for (const [name] of answers) {
        expect([viewer, name, after[viewer][name].status, heldToTheRule(name, after[viewer][name].body)]).toEqual([
          viewer,
          name,
          before[viewer][name].status,
          heldToTheRule(name, before[viewer][name].body),
        ]);
        for (const capture of [before, after]) {
          const text = JSON.stringify(heldToTheRule(name, capture[viewer][name].body));
          expect([viewer, name, text.includes(SECRET), text.includes("271.13")]).toEqual([viewer, name, false, false]);
        }
      }
    }
    // The cost controller's writes: answered with the record as written,
    // without the budget it was written with; the same before and after the
    // move (the same record; only when it was last written differs).
    const unstampedWrite = (response) => JSON.parse(unstampedDashboard(response.text).replace(/"updatedAt":"[^"]*"/g, '"updatedAt":"-"'));
    for (const [name, response] of [
      ["upsert (made)", firstUpsert],
      ["patch", firstPatch],
      ["upsert (after the move)", secondUpsert],
      ["patch (after the move)", secondPatch],
    ]) {
      expect([name, response.text.includes(SECRET), keyPaths(response.body.data, new Set(["budget", "generatedBudget"]))]).toEqual([name, false, []]);
    }
    expect(unstampedWrite(secondUpsert)).toEqual(unstampedWrite(firstUpsert));
    expect(unstampedWrite(secondPatch)).toEqual(unstampedWrite(firstPatch));
    // The history has the record's four events, none with its budget.
    expect(finalHistory.text.includes(SECRET)).toBe(false);
    const costEvents = (events) => events.filter((event) => (event.recordType || event.entityType) === "cost_record" && event.entityId === recordId);
    const controllerEvents = costEvents(finalHistory.body.data.events);
    expect(controllerEvents.length).toBeGreaterThanOrEqual(4);
    for (const event of controllerEvents) {
      for (const summary of ["oldSummary", "newSummary", "summary"]) {
        const held = event[summary];
        expect([event.id, summary, Boolean(held && typeof held === "object" && ("budget" in held || "generatedBudget" in held))]).toEqual([event.id, summary, false]);
      }
    }
    // ... while the BOQ reader's history keeps it as stored.
    const readerEvents = costEvents((await api.get(at("/audit?limit=100"), auth())).body.data.events);
    expect(readerEvents.some((event) => event.newSummary && Number(event.newSummary.budget) === 10031.81)).toBe(true);
    // The cost summary says what it withholds and why.
    for (const viewer of ["costController", "planningEngineer", "pm"]) {
      const summary = summaryOf(before[viewer]);
      expect([
        viewer,
        summary.activityBudgetsWithheld,
        summary.activityBudgetsReason,
        "budget" in summary.totals,
        "forecast" in summary.totals,
        "mostLikely" in summary.eac,
        "allocatedToActivities" in summary.budget,
      ]).toEqual([viewer, true, MAPPING_WITHHELD, false, false, false, false]);
      expect([viewer, summary.byPhase.map((entry) => Object.keys(entry).sort())]).toEqual([viewer, summary.byPhase.map(() => ["actual", "committed", "phase"])]);
    }
  });

  // Last, because it adds a row to the bill: an activity minted through the
  // API, as the reviewer's probe made it (POST /boq/items with an activity
  // name creates the activity and allocates the row to it in one step).
  it("an activity a BOQ row created through the API: the BOQ reader's schedule names the row; no member without BOQ read receives its id, key or value", async () => {
    const minted = await post(at("/boq/items"), { code: "9.1", description: "Minted pour slab", quantity: 3, unit: "m3", rate: 77.77, activityName: "Minted pour" });
    expect([minted.status, minted.body?.error]).toEqual([201, undefined]);
    const rowId = minted.body.data.item.id;
    const full = (await api.get(at("/schedule"), auth())).body.data;
    const mintedActivity = full.activities.find((activity) => activity.name === "Minted pour");
    expect(mintedActivity).toMatchObject({ mintedByBoqItemId: rowId });
    // An activity made by hand names no row, to anyone.
    expect(full.activities.find((activity) => activity.id === activities.fix.id)).toMatchObject({ mintedByBoqItemId: null });
    for (const [viewer, { user }] of Object.entries(viewers())) {
      const limited = await api.get(at("/schedule"), as(user));
      expect([viewer, limited.status, limited.body?.error]).toEqual([viewer, 200, undefined]);
      expect([viewer, keyPaths(limited.body.data, new Set(["mintedByBoqItemId"]))]).toEqual([viewer, []]);
      expect([viewer, limited.text.includes(rowId)]).toEqual([viewer, false]);
      // The activity itself — its name, its criticality — is every schedule reader's.
      const theirs = limited.body.data.activities.find((activity) => activity.id === mintedActivity.id);
      expect([viewer, theirs?.name, typeof theirs?.isCritical]).toEqual([viewer, "Minted pour", "boolean"]);
    }
  });

  // The report builder reads the same records straight from the database:
  // an activity's stored budget (a BOQ row's amount for the activity the row
  // created, the generator's per-activity budget) and a cost record's stored
  // budget (its activity's approved allocation when the record was made),
  // with the variance and CPI computed from it (E1).
  const reportDefinitions = () => ({
    "activity budgets": { source: "activity", columns: ["name", "isCritical", "budget"], sort: { field: "name", dir: "asc" } },
    "activity budget by criticality": { source: "activity", columns: ["name", "isCritical"], groupBy: "isCritical", aggregates: [{ fn: "count" }, { fn: "sum", field: "budget" }, { fn: "max", field: "budget" }] },
    "activities with a budget": { source: "activity", columns: ["name", "isCritical"], filters: [{ field: "budget", op: "gt", value: 0 }], sort: { field: "name", dir: "asc" } },
    "activities by budget": { source: "activity", columns: ["name", "isCritical"], sort: { field: "budget", dir: "desc" } },
    "cost records": { source: "cost_record", columns: ["activity.name", "budget", "forecast", "variance", "cpi"], sort: { field: "activity.name", dir: "asc" } },
    "cost records by budget": { source: "cost_record", columns: ["activity.name", "forecast"], sort: { field: "budget", dir: "desc" }, filters: [{ field: "variance", op: "not_empty" }], groupBy: "activity.name", aggregates: [{ fn: "count" }, { fn: "sum", field: "variance" }, { fn: "max", field: "budget" }, { fn: "avg", field: "cpi" }] },
  });
  const runReports = async (headers) => {
    const result = {};
    for (const [name, definition] of Object.entries(reportDefinitions())) {
      const response = await api.post("/api/v1/reports/preview", { ...definition, projectId: project.id }, headers);
      const body = JSON.parse(response.text.replace(/"generatedAt":"[^"]*"/g, '"generatedAt":"-"'));
      result[name] = { status: response.status, text: response.text, body };
    }
    return result;
  };
  // An export's cells, read back from the workbook.
  const exportedCells = async (definition, headers) => {
    const response = await fetch(`${api.base}/api/v1/reports/export`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ ...definition, projectId: project.id, format: "xlsx", name: "LiveTest export" }),
    });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const cells = [];
    workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value)))));
    return cells;
  };

  it("the report builder gives no member without BOQ read an activity's budget, nor a cost record's budget, variance or CPI — not as a column, a filter, a sort, a grouping, an aggregate, an export or a saved report's run — and the BOQ reader's reports carry them (E1)", async () => {
    // An activity a BOQ row creates through the API (29 m3 at 313.37 =
    // 9087.73, a figure nothing else here states), and its cost record
    // written by the cost controller (no BOQ read) — made with that budget.
    const SECRET = "9087.73";
    const minted = await post(at("/boq/items"), { code: "9.2", description: "Report probe slab", quantity: 29, unit: "m3", rate: 313.37, activityName: "Report probe pour" });
    expect([minted.status, minted.body?.error]).toEqual([201, undefined]);
    const activity = await prisma.activity.findFirst({ where: { projectId: project.id, mintedByBoqItemId: minted.body.data.item.id }, select: { id: true, budget: true } });
    expect(Number(activity.budget)).toBe(9087.73);
    // The allocation the row made, approved: the record is made with it as its budget.
    const mintedAllocation = await prisma.activityBoqAllocation.findFirst({ where: { boqItemId: minted.body.data.item.id, activityId: activity.id }, select: { id: true } });
    for (const step of ["submit", "approve"]) {
      const moved = await post(at(`/activity-boq-allocations/${mintedAllocation.id}/${step}`), {});
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }
    const written = await api.post(at(`/cost/activity/${activity.id}`), { committed: 0, forecast: 1000 }, as(members.costController));
    expect([written.status, written.body?.error]).toEqual([201, undefined]);
    const stored = await prisma.costRecord.findUnique({ where: { id: written.body.data.id }, select: { budget: true, actual: true } });
    expect(Number(stored.budget)).toBeGreaterThan(0);
    const recordBudget = String(Number(stored.budget));
    const variance = String(Math.round((Number(stored.budget) - 1000) * 100) / 100);

    // The BOQ reader's reports state them.
    const reader = await runReports(auth());
    const readerActivity = reader["activity budgets"].body.data.rows.find((row) => row.id === activity.id);
    expect([reader["activity budgets"].status, readerActivity.budget, "withheldColumns" in readerActivity, "withheld" in reader["activity budgets"].body.data]).toEqual([200, 9087.73, false, false]);
    expect(reader["activities with a budget"].body.data.rows.map((row) => row.id)).toContain(activity.id);
    const readerRecord = reader["cost records"].body.data.rows.find((row) => row["activity.name"] === "Report probe pour");
    expect([readerRecord.budget, readerRecord.variance]).toEqual([Number(stored.budget), Number(variance)]);
    expect(reader["cost records"].text.includes(recordBudget)).toBe(true);

    for (const [viewer, { user, readsCost }] of Object.entries(viewers())) {
      const headers = as(user);
      const mine = await runReports(headers);
      for (const [name, { status, text, body }] of Object.entries(mine)) {
        expect([viewer, name, status, body.error]).toEqual([viewer, name, 200, undefined]);
        // Not the activity's budget, the record's, nor its variance, anywhere.
        for (const secret of [SECRET, recordBudget, variance, "233.31"]) {
          expect([viewer, name, secret, text.includes(secret)]).toEqual([viewer, name, secret, false]);
        }
        const data = body.data;
        const costSource = reportDefinitions()[name].source === "cost_record";
        if (costSource && !readsCost) {
          // The site engineer does not read the cost module: no project, no rows.
          expect([viewer, name, data.projects.denied, data.rows]).toEqual([viewer, name, 1, []]);
          continue;
        }
        // Each row names the withheld columns and carries null for them; the
        // answer says which and why.
        expect([viewer, name, data.withheld?.reason, data.withheld?.projects]).toEqual([viewer, name, MAPPING_WITHHELD, 1]);
        const keys = costSource ? ["budget", "variance", "cpi"] : ["budget"];
        for (const row of data.rows) {
          for (const key of keys.filter((key) => key in row)) expect([viewer, name, key, row[key]]).toEqual([viewer, name, key, null]);
        }
        for (const column of data.columns.filter((column) => keys.includes(column.key))) {
          expect([viewer, name, column.key, column.withheld, column.withheldReason]).toEqual([viewer, name, column.key, true, MAPPING_WITHHELD]);
        }
        for (const group of [...(data.groups || []), data.totals]) {
          for (const [key, value] of Object.entries(group)) {
            if (keys.some((withheld) => key.endsWith(`_${withheld}`))) expect([viewer, name, key, value]).toEqual([viewer, name, key, null]);
          }
        }
      }
      // A budget filter is no mapping badge: it matches none of the rows.
      expect([viewer, mine["activities with a budget"].body.data.rows]).toEqual([viewer, []]);
      // The export and a saved report's run go the same way.
      const cells = await exportedCells(reportDefinitions()["cost records"], headers);
      for (const secret of [recordBudget, variance]) expect([viewer, secret, cells.includes(secret)]).toEqual([viewer, secret, false]);
      const saved = await api.post("/api/v1/reports", { ...reportDefinitions()["activity budgets"], projectId: project.id, name: `LiveTest ${viewer} budgets` }, headers);
      if (saved.status === 201) {
        const run = await api.post(`/api/v1/reports/${saved.body.data.id}/run`, {}, headers);
        expect([viewer, run.status, run.text.includes(SECRET)]).toEqual([viewer, 200, false]);
      } else {
        expect([viewer, saved.status]).toEqual([viewer, 403]);
      }
    }
    // The BOQ reader's export states the record's budget.
    expect((await exportedCells(reportDefinitions()["cost records"], auth())).includes(recordBudget)).toBe(true);
  });

  it("the reviewer's differential on the report builder: one approved allocation moved from a critical to a non-critical activity — with the stored budgets it gives — changes nothing in any report a member without BOQ read runs, while the BOQ reader's reports move (E1)", async () => {
    // Last in this file. Two activities alike in everything but their
    // criticality, and one approved allocation (40 m3 at 263.19 = 10527.6).
    const twin = async (name, activityCode) => {
      const created = await post(at("/activities"), { name, activityCode, duration: 5, startDate: "2026-05-04", endDate: "2026-05-08", engineerIds: [live.user.id] });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      return created.body.data.id;
    };
    const critical = await twin("Report twin critical", "A170");
    const floating = await twin("Report twin floating", "A180");
    await prisma.activity.update({ where: { id: critical }, data: { isCritical: true, totalFloat: 0 } });
    await prisma.activity.update({ where: { id: floating }, data: { isCritical: false, totalFloat: 5 } });
    const item = await post(at("/boq/items"), { code: "9.3", description: "Report twin slab", quantity: 40, unit: "m3", rate: 263.19 });
    expect([item.status, item.body?.error]).toEqual([201, undefined]);
    const allocationsRoute = at("/activity-boq-allocations");
    const allocation = await post(allocationsRoute, { boqItemId: item.body.data.item.id, activityId: critical, quantity: 40 });
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    for (const step of ["submit", "approve"]) {
      const moved = await post(`${allocationsRoute}/${allocation.body.data.id}/${step}`, {});
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }
    // Each twin's cost record, written through the API by the cost
    // controller: the critical one's made with the allocation as its budget.
    const records = {};
    for (const activityId of [critical, floating]) {
      const written = await api.post(at(`/cost/activity/${activityId}`), { committed: 0, forecast: 500 }, as(members.costController));
      expect([written.status, written.body?.error]).toEqual([201, undefined]);
      records[activityId] = written.body.data.id;
    }
    // The activity's stored budget as a mint or the generator writes it:
    // the allocation's amount (by key, on this LiveTest organisation's row).
    await prisma.activity.update({ where: { id: critical }, data: { budget: 10527.6 } });
    const storedBudgets = async () =>
      Promise.all([critical, floating].map(async (id) => [
        Number((await prisma.activity.findUnique({ where: { id }, select: { budget: true } })).budget),
        Number((await prisma.costRecord.findUnique({ where: { id: records[id] }, select: { budget: true } })).budget),
      ]));
    expect(await storedBudgets()).toEqual([[10527.6, 10527.6], [0, 0]]);

    const everyone = { reader: auth(), ...Object.fromEntries(Object.entries(viewers()).map(([viewer, { user }]) => [viewer, as(user)])) };
    const capture = async () => {
      const result = {};
      for (const [viewer, headers] of Object.entries(everyone)) {
        result[viewer] = Object.fromEntries(Object.entries(await runReports(headers)).map(([name, { status, body }]) => [name, { status, body }]));
      }
      return result;
    };
    const before = await capture();

    // The move: the allocation, by its key, after proving it is this
    // LiveTest organisation's — and the stored budgets it gives, moved with
    // it (each row by its key): the activity's budget, and the cost record's
    // budget as the record would have been made with the allocation there.
    const row = await prisma.activityBoqAllocation.findUnique({
      where: { id: allocation.body.data.id },
      select: { id: true, activityId: true, status: true, project: { select: { orgId: true, org: { select: { name: true } } } } },
    });
    expect([row.activityId, row.status, row.project.orgId, /^LiveTest [0-9a-f-]{36}$/.test(row.project.org.name)]).toEqual([critical, "approved", live.org.id, true]);
    await prisma.activityBoqAllocation.update({ where: { id: row.id }, data: { activityId: floating } });
    await prisma.activity.update({ where: { id: critical }, data: { budget: 0 } });
    await prisma.activity.update({ where: { id: floating }, data: { budget: 10527.6 } });
    await prisma.costRecord.update({ where: { id: records[critical] }, data: { budget: 0 } });
    await prisma.costRecord.update({ where: { id: records[floating] }, data: { budget: 10527.6 } });
    expect(await storedBudgets()).toEqual([[0, 0], [10527.6, 10527.6]]);

    const after = await capture();

    // The BOQ reader's reports move with it.
    const budgetOf = (captured, id) => captured.reader["activity budgets"].body.data.rows.find((entry) => entry.id === id).budget;
    expect([budgetOf(before, critical), budgetOf(before, floating), budgetOf(after, critical), budgetOf(after, floating)]).toEqual([10527.6, 0, 0, 10527.6]);
    for (const name of Object.keys(reportDefinitions())) {
      expect([name, after.reader[name].body]).not.toEqual([name, before.reader[name].body]);
    }
    // Everyone without BOQ read: not one byte of any report moves.
    for (const viewer of Object.keys(viewers())) {
      for (const name of Object.keys(reportDefinitions())) {
        expect([viewer, name, after[viewer][name]]).toEqual([viewer, name, before[viewer][name]]);
        expect([viewer, name, before[viewer][name].status]).toEqual([viewer, name, 200]);
        expect([viewer, name, JSON.stringify(before[viewer][name].body).includes("10527.6")]).toEqual([viewer, name, false]);
      }
    }
  });

  // The Schedule module's generation job keeps the uploaded bill as its
  // input (payload.rawText, which Pass 1 structures), and the upload itself
  // is stored as the generation's source — both under schedule:read. The
  // review of the Round-4 closure patch read a bill's rows off GET /jobs as
  // a site engineer and a planning engineer who were refused GET /boq.
  it("the Schedule module's generation job and its stored source: a member without BOQ read is given the job without the uploaded bill — listed, read, cancelled and retried alike — and is refused the source file; the BOQ reader gets both", async () => {
    const secrets = ["SECRETGROUT", "4321.87", "30253.09"];
    const bill = ["Item,Description,Qty,Unit,Rate,Amount", "9.1,SECRETGROUT under baseplates,7,m3,4321.87,30253.09", ""].join("\n");
    const form = new FormData();
    form.append("file", new Blob([bill], { type: "text/csv" }), "generation-bill.csv");
    form.append("label", "LiveTest generation");
    const response = await fetch(`${api.base}${at("/schedule/generate")}`, { method: "POST", headers: auth(), body: form });
    const started = await response.json();
    expect([response.status, started.error]).toEqual([202, undefined]);
    const { jobId } = started.data;
    // This API runs no job worker, but another process on the shared
    // database may: the job is held out of every worker's reach (runAfter
    // far ahead) so it stays queued with its input while it is read. One
    // known row of this LiveTest organisation, proven before the write.
    const holdJob = async () => {
      const row = await prisma.backgroundJob.findUnique({ where: { id: jobId }, select: { id: true, orgId: true, projectId: true } });
      const org = await prisma.organisation.findUnique({ where: { id: row.orgId }, select: { name: true } });
      expect([row.orgId, row.projectId, /^LiveTest [0-9a-f-]{36}$/.test(org.name)]).toEqual([live.org.id, project.id, true]);
      const held = await prisma.backgroundJob.update({ where: { id: row.id }, data: { runAfter: new Date("2099-01-01T00:00:00.000Z") } });
      expect(held.status).toBe("queued");
    };
    await holdJob();
    const documentId = started.data.document.documentId;
    const jobRoute = at(`/jobs/${jobId}`);
    const listRoute = at("/jobs?type=schedule.generate");
    const sourceRoute = at(`/schedule/uploads/${documentId}`);

    // The BOQ reader: the job with the bill, and the bill's file.
    const readerJob = await api.get(jobRoute, auth());
    expect([readerJob.status, readerJob.body.data.payload.rawText.includes("SECRETGROUT"), "payloadWithheld" in readerJob.body.data]).toEqual([200, true, false]);
    expect(readerJob.body.data.payload).toMatchObject({ label: "LiveTest generation", fileName: "generation-bill.csv" });
    const readerList = await api.get(listRoute, auth());
    expect(readerList.body.data.items.find((job) => job.id === jobId)).toEqual(readerJob.body.data);
    const readerSource = await api.get(sourceRoute, auth());
    expect([readerSource.status, readerSource.text.includes("SECRETGROUT")]).toEqual([200, true]);

    // Everyone without BOQ read: the same job, without the bill, and said so.
    const { rawText, ...withoutBill } = readerJob.body.data.payload;
    expect(rawText).toContain("30253.09");
    const expected = {
      ...readerJob.body.data,
      payload: withoutBill,
      payloadWithheld: { keys: ["rawText"], reason: "The uploaded bill is available only to members who may read the BOQ" },
    };
    for (const [viewer, { user }] of Object.entries(viewers())) {
      const viewerAuth = as(user);
      expect([viewer, (await api.get(at("/boq"), viewerAuth)).status]).toEqual([viewer, 403]);
      const job = await api.get(jobRoute, viewerAuth);
      expect([viewer, job.status, job.body.data]).toEqual([viewer, 200, expected]);
      const list = await api.get(listRoute, viewerAuth);
      expect([viewer, list.status, list.body.data.items.find((entry) => entry.id === jobId)]).toEqual([viewer, 200, expected]);
      const source = await api.get(sourceRoute, viewerAuth);
      expect([viewer, source.status, source.body?.error?.code, source.body?.error?.details?.module]).toEqual([viewer, 403, "FORBIDDEN", "boq"]);
      for (const [name, answer] of [["job", job], ["list", list], ["source", source]]) {
        for (const secret of secrets) expect([viewer, name, secret, answer.text.includes(secret)]).toEqual([viewer, name, secret, false]);
      }
    }

    // A PM without BOQ read manages the job (schedule:update): the answers
    // to cancelling and retrying it carry no bill either.
    const pmAuth = as(members.pm);
    const cancelled = await api.post(`${jobRoute}/cancel`, {}, pmAuth);
    const retried = await api.post(`${jobRoute}/retry`, {}, pmAuth);
    await holdJob();
    for (const [name, answer, status] of [["cancel", cancelled, 200], ["retry", retried, 202]]) {
      expect([name, answer.status, answer.body?.error]).toEqual([name, status, undefined]);
      expect([name, answer.body.data.payload, answer.body.data.payloadWithheld]).toEqual([name, withoutBill, expected.payloadWithheld]);
      for (const secret of secrets) expect([name, secret, answer.text.includes(secret)]).toEqual([name, secret, false]);
    }
    // Withheld from the answer, not from the job: the BOQ reader still reads the bill.
    const after = await api.get(jobRoute, auth());
    expect([after.status, after.body.data.payload.rawText]).toEqual([200, rawText]);
  });
});
