/**
 * §12 on the schedule and the activities — proven against a real API
 * process and the real local Postgres.
 *
 * The Overview landing asks GET /schedule for its module-bar counts, the
 * Gantt and the schedule list read the same answer, the Activities list
 * reads GET /activities, and the revision panel reads the revisions, their
 * readiness and their mapping. Every one of them carried the bill's
 * figures to every schedule reader. utils/boq-figures now decides who
 * receives them:
 *
 *   BOQ reader: exactly the service's answer, byte for byte.
 *   no BOQ read: no allocated quantity, value or weight on an activity, no
 *     open value on the revision, no BOQ value figure in any readiness
 *     check, no BOQ rows in a stored snapshot — omitted, not zeroed.
 *   neither BOQ nor cost read: nor the budgets built from the bill (the
 *     activity budget, the revision's totals, the generator's budgets).
 *
 * Everything else — statuses, codes, verdicts, counts, the approved
 * allocation count — is what the BOQ reader gets, key for key.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards. The API is started on a free port with the job worker
 * off, so nothing calls a model.
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
];
// ... and what a member who reads neither the BOQ nor the cost module must
// not receive either: the budgets built from the bill.
const BUDGET_KEYS = ["budget", "generatedBudget", "totalBudget", "generatedTotalBudget"];

const keyPaths = (value, keys, at = "") =>
  value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, inner]) => [
        ...(keys.has(key) ? [`${at}.${key}`] : []),
        ...keyPaths(inner, keys, `${at}.${key}`),
      ])
    : [];

// A BOQ reader's answer with the withheld keys taken out, wherever they sit:
// what everyone else must receive, key for key.
const without = (value, keys) =>
  Array.isArray(value)
    ? value.map((entry) => without(entry, keys))
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !keys.has(key))
            .map(([key, inner]) => [key, without(inner, keys)]),
        )
      : value;

// Readiness is stamped when it is built; nothing else in these answers moves.
const unstamped = (text) => text.replace(/"checkedAt":"[^"]*"/g, '"checkedAt":"-"');

liveDescribe("PC-4 §12: the schedule and the activities carry no BOQ figure to a member who may not read the BOQ", () => {
  let live;
  let api;
  let project;
  let activities;
  let stagedRevision;
  let activeRevision;
  let siteEngineer;
  let costController;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const post = (route, body) => api.post(route, body, auth());

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ RATE_LIMIT_AI_MAX: "1000", RATE_LIMIT_UPLOAD_MAX: "1000" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest §12 schedule", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    // Two members whose templates take the BOQ tool away: a site engineer
    // (no cost tool either) and a cost controller (who keeps the cost tool).
    siteEngineer = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest Site Engineer",
      email: `live-se-${tag}@octapm-live.test`,
      role: "site_engineer",
    });
    costController = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest Cost Controller",
      email: `live-cc-${tag}@octapm-live.test`,
      role: "cost_controller",
    });
    for (const [member, role] of [
      [siteEngineer, "site_engineer"],
      [costController, "cost_controller"],
    ]) {
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
        engineerIds: [live.user.id, siteEngineer.id],
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

    // The active revision, as a generated schedule stores it (the
    // generator's budgets and the BOQ rows it was built from), and a staged
    // one awaiting review whose readiness was stored when it was submitted.
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
        snapshotJson: generatedSnapshot("Rev B"),
      },
    });
    const readiness = await api.get(`/api/v1/projects/${project.id}/schedule/revisions/${stagedRevision.id}/readiness`, auth());
    expect([readiness.status, readiness.body?.error]).toEqual([200, undefined]);
    await prisma.scheduleRevision.update({
      where: { id: stagedRevision.id },
      data: { readinessJson: readiness.body.data, status: "under_review", submittedAt: new Date() },
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

  // Every read the Overview's module bar, the Gantt, the schedule list, the
  // revision panel and the Activities list make that carries a revision or
  // an activity — with the service call whose answer a BOQ reader receives.
  const reads = () => ({
    schedule: {
      route: `/api/v1/projects/${project.id}/schedule`,
      service: () => scheduleService.getProjectSchedule({ orgId: live.org.id, projectId: project.id }),
    },
    revisions: {
      route: `/api/v1/projects/${project.id}/schedule/revisions`,
      service: () => scheduleService.listRevisions({ orgId: live.org.id, projectId: project.id }),
    },
    activeReadiness: {
      route: `/api/v1/projects/${project.id}/schedule/revisions/${activeRevision.id}/readiness`,
      service: () => scheduleService.getScheduleReadiness({ orgId: live.org.id, projectId: project.id, revisionId: activeRevision.id }),
    },
    stagedReadiness: {
      route: `/api/v1/projects/${project.id}/schedule/revisions/${stagedRevision.id}/readiness`,
      service: () => scheduleService.getScheduleReadiness({ orgId: live.org.id, projectId: project.id, revisionId: stagedRevision.id }),
    },
    stagedRevision: {
      route: `/api/v1/projects/${project.id}/schedule/revisions/${stagedRevision.id}`,
      service: () => scheduleService.getRevision({ orgId: live.org.id, projectId: project.id, revisionId: stagedRevision.id }),
    },
    activeRevision: {
      route: `/api/v1/projects/${project.id}/schedule/revisions/${activeRevision.id}`,
      service: () => scheduleService.getRevision({ orgId: live.org.id, projectId: project.id, revisionId: activeRevision.id }),
    },
    mapping: {
      route: `/api/v1/projects/${project.id}/schedule/revisions/${stagedRevision.id}/mapping`,
      service: () => scheduleService.getRevisionMapping({ orgId: live.org.id, projectId: project.id, revisionId: stagedRevision.id }),
    },
    activities: {
      route: `/api/v1/projects/${project.id}/activities`,
      service: () => activityService.listActivities({ orgId: live.org.id, projectId: project.id }),
    },
    activity: {
      route: `/api/v1/projects/${project.id}/activities/${activities.pour.id}`,
      service: () => activityService.getActivityById({ orgId: live.org.id, projectId: project.id, activityId: activities.pour.id }),
    },
  });

  it("a BOQ reader receives exactly the service's answer — the figures, byte for byte", async () => {
    for (const [name, { route, service }] of Object.entries(reads())) {
      const response = await api.get(route, auth());
      expect([name, response.status, response.body?.error]).toEqual([name, 200, undefined]);
      const expected = JSON.stringify({ success: true, data: normalizeMoneyTree(await service()) });
      expect([name, unstamped(response.text)]).toEqual([name, unstamped(expected)]);
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
  });

  it("a member without BOQ read receives none of the bill's figures — and a member without cost read none of its budgets — and everything else unchanged", async () => {
    const viewers = {
      // Neither the BOQ nor the cost module.
      siteEngineer: { user: siteEngineer, withheld: new Set([...BOQ_KEYS, ...BUDGET_KEYS]), secrets: ["71793.5", "30273.9", "21337", "20182.6", "41519.6", "69999.99", "50456.5"] },
      // The cost module, not the BOQ: the budgets stay.
      costController: { user: costController, withheld: new Set(BOQ_KEYS), secrets: ["71793.5", "30273.9", "50456.5"] },
    };
    for (const [viewer, { user, withheld, secrets }] of Object.entries(viewers)) {
      const viewerAuth = { authorization: `Bearer ${mintAccessToken(user)}` };
      // The BOQ endpoints refuse this member — the premise of §12.
      expect([viewer, (await api.get(`/api/v1/projects/${project.id}/boq`, viewerAuth)).status]).toEqual([viewer, 403]);
      for (const [name, { route }] of Object.entries(reads())) {
        const [full, limited] = await Promise.all([api.get(route, auth()), api.get(route, viewerAuth)]);
        expect([viewer, name, limited.status, limited.body?.error]).toEqual([viewer, name, 200, undefined]);
        // Not one withheld key, anywhere in the answer.
        expect([viewer, name, keyPaths(limited.body.data, withheld)]).toEqual([viewer, name, []]);
        for (const secret of secrets) {
          expect([viewer, name, secret, limited.text.includes(secret)]).toEqual([viewer, name, secret, false]);
        }
        // Everything else is the BOQ reader's answer, key for key: statuses,
        // codes, verdicts, ready, blockingCount, counts, the allocation count.
        const expected = without(JSON.parse(unstamped(full.text)).data, withheld);
        expect([viewer, name, JSON.parse(unstamped(limited.text)).data]).toEqual([viewer, name, expected]);
      }
      const schedule = (await api.get(reads().schedule.route, viewerAuth)).body.data;
      const pour = schedule.activities.find((activity) => activity.id === activities.pour.id);
      expect(pour.approvedAllocationCount).toBe(1);
      const allocations = schedule.revision.readiness.checks.find((check) => check.key === "allocations");
      expect(allocations).toMatchObject({ key: "allocations", severity: "blocking", passed: false });
      // The budget: the cost controller reads it in the Cost module already.
      expect([viewer, "budget" in pour, pour.budget]).toEqual(
        viewer === "costController" ? [viewer, true, 21337] : [viewer, false, undefined],
      );
    }
  });

  it("the progress a site engineer submits comes back without the activity's figures", async () => {
    const viewerAuth = { authorization: `Bearer ${mintAccessToken(siteEngineer)}` };
    const submitted = await api.post(`/api/v1/projects/${project.id}/activities/${activities.fix.id}/progress`, { pctComplete: 10, status: "submitted" }, viewerAuth);
    expect([submitted.status, submitted.body?.error]).toEqual([200, undefined]);
    expect(submitted.body.data.activity.id).toBe(activities.fix.id);
    expect(submitted.body.data.submission).toBeTruthy();
    expect(keyPaths(submitted.body.data, new Set([...BOQ_KEYS, ...BUDGET_KEYS]))).toEqual([]);
  });
});
