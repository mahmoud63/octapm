/**
 * PC-4 — the setup flow, proven against a real API process and the real
 * local Postgres.
 *
 *   sequence: the two new steps (structure_setup, boq_approval) sit where
 *     §89 puts them, are advisory, and the three gates are exactly what the
 *     ten original steps say — re-derived here from those ten alone, and
 *     shown on a fixture that passes the baseline gate with its structure
 *     and BOQ approval both still open
 *   detail: every issue names the offending BOQ rows, activities and
 *     revisions with the route that fixes each one, under the project's
 *     workspace, capped with a count
 *   coverage: the readiness figures are PC-3's coverage summary, key for
 *     key, before and after an approval — never a second computation
 *   warnings: unmapped calendar, unknown unit, quantity method without a
 *     unit, unit mismatch, missing mapping rule and the bill's approval each
 *     appear when the data is wrong and disappear when it is fixed
 *   access: a member whose template takes the BOQ away (the BOQ and
 *     coverage endpoints refuse them) gets the same steps, codes and gates
 *     from readiness, without the bill's rows, values, quantities or trail
 *   lock: the bill's lock is named as GET /boq names it
 *   validation: a row an upload could not apply reads as PC-2's sentence
 *   frozen gate: a period locked over the reporting gate stores it in the
 *     shape it had before PC-4 (no records, links or counts)
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards. The API is started on a free port with the job worker
 * off, so nothing calls a model.
 *
 *   npm run test:live -- src/services/__live__/pc-4-setup-flow.live.test.js
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const XLSX = require("@e965/xlsx");
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

// The readiness service as the base built it, read out of git and loaded
// beside the current one: its relative requires resolve from the services
// directory through this test's own module registry, so it reads the same
// database through the same client. The gates it returns for a project are
// what "unchanged" is measured against — not a restatement of the rules.
const BASE_REF = "cb14ff4";
const loadBaseReadiness = () => {
  const source = execFileSync(
    "git",
    ["show", `${BASE_REF}:backend/src/services/project-setup-readiness.service.js`],
    { cwd: __dirname, encoding: "utf8" },
  );
  const servicesDir = path.join(__dirname, "..");
  const baseRequire = (request) =>
    require(request.startsWith(".") ? path.join(servicesDir, request) : request);
  const loaded = { exports: {} };
  new Function("require", "module", "exports", source)(baseRequire, loaded, loaded.exports);
  return loaded.exports;
};
// A gate as the base shaped it: the per-item detail PC-4 adds to each
// blocker and warning (`items`, `count`) is set aside, everything else
// must match — the warnings too: PC-4's own checks are advisories, which
// never enter a gate (the product owner's default b), so the reporting
// gate EV freezes carries exactly the warnings it carried at cb14ff4.
const withoutDetail = ({ items, count, itemsWithheld, ...entry }) => entry;
const gateView = (gates) =>
  Object.fromEntries(
    Object.entries(gates).map(([name, { blockers, warnings, ...gate }]) => [
      name,
      {
        ...gate,
        blockers: blockers.map(withoutDetail),
        ...(warnings ? { warnings: warnings.map(withoutDetail) } : {}),
      },
    ]),
  );
const warningCodes = (gate) => (gate.warnings || []).map((warning) => warning.code);

const money = (value) => Number(Number(value).toFixed(2));

// The ten steps the base built (project-setup-readiness.service.js at
// cb14ff4) and how it derived each gate: a gate's blockers are the blockers
// of the steps whose requiredFor names the gate, in step order. Each gate
// is re-derived from these ten alone and must equal what the API says —
// the two steps PC-4 adds may never enter one.
const BASE_STEPS = [
  "project_profile",
  "boq_upload",
  "schedule_generation",
  "boq_allocation",
  "cost_loading_review",
  "engineer_assignment",
  "progress_method_configuration",
  "schedule_approval",
  "baseline_readiness",
  "progress_readiness",
];
const EXPECTED_ORDER = [
  "project_profile",
  "structure_setup",
  "boq_upload",
  "boq_approval",
  "schedule_generation",
  "boq_allocation",
  "cost_loading_review",
  "engineer_assignment",
  "progress_method_configuration",
  "schedule_approval",
  "baseline_readiness",
  "progress_readiness",
];
const baseGateBlockers = (readiness, gate) =>
  readiness.steps
    .filter((step) => BASE_STEPS.includes(step.key) && step.requiredFor.includes(gate))
    .flatMap((step) => step.blockers.map((blocker) => blocker.code));
let baseReadinessService = null;
const expectGatesAsBase = async (readiness, orgId) => {
  const { gates, context } = readiness;
  // The base service, run on the same rows: the same gates, blocker for
  // blocker, with its message, readiness and mode.
  baseReadinessService = baseReadinessService || loadBaseReadiness();
  const baseResult = await baseReadinessService.getSetupReadiness({ orgId, projectId: readiness.projectId });
  expect(baseResult.steps).toHaveLength(10);
  expect(gateView(gates)).toEqual(gateView(baseResult.gates));
  for (const name of Object.keys(baseResult.gates)) {
    expect([name, warningCodes(gates[name])]).toEqual([name, warningCodes(baseResult.gates[name])]);
  }
  // The ten original steps: the status and the warnings the base derived,
  // step for step — PC-4's advisories never move them.
  const originalSteps = (result) =>
    result.steps
      .filter((entry) => BASE_STEPS.includes(entry.key))
      .map((entry) => [entry.key, entry.status, entry.message, entry.warnings.map((warning) => warning.code)]);
  expect(originalSteps(readiness)).toEqual(originalSteps(baseResult));
  expect(readiness.summary).toMatchObject({
    status: baseResult.summary.status,
    readyForBaseline: baseResult.summary.readyForBaseline,
    readyForProgress: baseResult.summary.readyForProgress,
    readyForReporting: baseResult.summary.readyForReporting,
  });
  expect(gates.baseline.blockers.map((b) => b.code)).toEqual(baseGateBlockers(readiness, "baseline"));
  expect(gates.progress.blockers.map((b) => b.code)).toEqual(baseGateBlockers(readiness, "progress"));
  expect(gates.reporting.blockers.map((b) => b.code)).toEqual(baseGateBlockers(readiness, "reporting"));
  expect(gates.baseline.ready).toBe(
    context.currentRevision?.status === "approved" && baseGateBlockers(readiness, "baseline").length === 0,
  );
  expect(gates.progress.ready).toBe(baseGateBlockers(readiness, "progress").length === 0);
  expect(gates.reporting.ready).toBe(baseGateBlockers(readiness, "reporting").length === 0);
  expect(gates.baseline.mode).toBe("block");
  expect(gates.progress.mode).toBe("warn");
  expect(gates.reporting).toMatchObject({ mode: "block", overrideAllowedRoles: ["pm"] });
  for (const gate of Object.values(gates)) {
    expect(gate.blockers.map((b) => b.stepKey)).not.toContain("structure_setup");
    expect(gate.blockers.map((b) => b.stepKey)).not.toContain("boq_approval");
  }
  // §3: nextAction unchanged — the two advisory steps never take it.
  expect(readiness.summary.nextAction).toEqual(baseResult.summary.nextAction);
  return baseResult;
};

liveDescribe("PC-4: setup flow — structure and BOQ approval steps, per-item detail, unchanged gates", () => {
  let live;
  let api;
  let project;
  let base;
  let segment;
  // The uploaded, approved bill from the §22 test, for the tests after it.
  let uploaded1 = null;
  // The project that passes the baseline gate: an approved schedule
  // revision (so readiness carries the schedule's own checks) and approved
  // allocations (so the bill's money is on its activities).
  let passingProjectId = null;
  const auth =() => ({ authorization: `Bearer ${live.token}` });
  const post = (route, body) => api.post(route, body, auth());
  const get = (route) => api.get(route, auth());
  const patch = (route, body) => api.request("PATCH", route, { body, headers: auth() });
  const put = (route, body) => api.request("PUT", route, { body, headers: auth() });
  const readiness = async (projectId = project.id) => {
    const response = await get(`/api/v1/projects/${projectId}/setup-readiness`);
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data;
  };
  const step = (result, key) => result.steps.find((entry) => entry.key === key);
  const warning = (result, key, code) => step(result, key).warnings.find((entry) => entry.code === code);
  const advisory = (result, key, code) => step(result, key).advisories.find((entry) => entry.code === code);
  const href = (projectId, path) => `/o/${segment}/projects/${projectId}${path}`;

  const createItem = async (payload, projectId = project.id) => {
    const created = await post(`/api/v1/projects/${projectId}/boq/items`, payload);
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    return created.body.data.item;
  };
  const createActivity = async (payload, projectId = project.id) => {
    const created = await post(`/api/v1/projects/${projectId}/activities`, { engineerIds: [live.user.id], ...payload });
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    return created.body.data;
  };
  const allocationsRoute = (projectId = project.id) => `/api/v1/projects/${projectId}/activity-boq-allocations`;
  const approveFlow = async (allocationId, projectId = project.id) => {
    const submitted = await post(`${allocationsRoute(projectId)}/${allocationId}/submit`, {});
    expect([submitted.status, submitted.body?.error]).toEqual([200, undefined]);
    const approved = await post(`${allocationsRoute(projectId)}/${allocationId}/approve`, {});
    expect([approved.status, approved.body?.error]).toEqual([200, undefined]);
    return approved.body.data;
  };
  const uploadWorkbook = async (route, rows) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "boq.xlsx");
    const response = await fetch(`${api.base}${route}`, { method: "POST", headers: auth(), body: form });
    return { status: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    segment = live.org.slug || live.org.id;
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest PC-4 setup", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    api = await startApi({ RATE_LIMIT_AI_MAX: "1000", RATE_LIMIT_UPLOAD_MAX: "1000" });

    // A bill of two priced rows and a preliminaries row (n/a), a programme
    // of two activities, and one WBS node that only the first row and the
    // first activity are filed under — so the filing warnings have rows to
    // name.
    const wbsA = (await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "A", name: "Substructure" })).body.data;
    expect(wbsA?.id).toBeTruthy();
    const items = {
      concrete: await createItem({ code: "1.1", description: "Concrete in foundations", quantity: 100, unit: "m3", rate: 200 }),
      rebar: await createItem({ code: "1.2", description: "Reinforcement to foundations", quantity: 50, unit: "t", rate: 1000 }),
      prelims: await createItem({ code: "P.1", description: "Site establishment", quantity: 1, unit: "sum", rate: 30000 }),
    };
    const activities = {
      pour: await createActivity({ name: "Pour foundations", activityCode: "1.1", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06" }),
      fix: await createActivity({ name: "Fix reinforcement", activityCode: "A130", duration: 6, startDate: "2026-01-26", endDate: "2026-02-01" }),
    };
    await prisma.boqItem.update({ where: { id: items.concrete.id }, data: { wbsNodeId: wbsA.id } });
    await prisma.activity.update({ where: { id: activities.pour.id }, data: { wbsNodeId: wbsA.id } });
    const ruled = await patch(`${allocationsRoute()}/mapping-rules`, { rule: "not_applicable", itemIds: [items.prelims.id] });
    expect([ruled.status, ruled.body?.data?.updated]).toEqual([200, 1]);
    base = { wbsA, items, activities };
  });

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      // The BOQ upload files a ProjectDocument whose composite (projectId,
      // orgId) key RESTRICTs the project delete; it goes first, as do the
      // event tables that carry no foreign key to the organisation.
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  describe("the §89 sequence and the gates (§90-§91)", () => {
    it("adds structure_setup after the profile and boq_approval after the upload, both advisory, with the gates as the ten original steps derive them", async () => {
      const result = await readiness();
      expect(result.steps.map((entry) => entry.key)).toEqual(EXPECTED_ORDER);
      expect(result.summary.totalSteps).toBe(12);
      for (const key of ["structure_setup", "boq_approval"]) {
        expect(step(result, key)).toMatchObject({ requiredFor: [], critical: false, blockers: [] });
      }
      // Structure: one WBS node, no locations, no cost codes; the bill has
      // rows but no revision to approve.
      expect(result.structure).toEqual({ wbsNodes: 1, locations: 0, projectCostCodes: 0, unitsUnresolved: 0 });
      expect(step(result, "structure_setup").warnings.map((w) => w.code)).toEqual(["NO_LOCATIONS", "NO_PROJECT_COST_CODES"]);
      expect(step(result, "boq_approval").status).toBe("attention");
      expect(step(result, "boq_approval").warnings.map((w) => w.code)).toEqual(["BOQ_REVISION_NOT_APPROVED"]);
      // A bill entered by hand has no revision to review: the card names
      // what approves it — the schedule baseline lock — and sends there.
      expect(warning(result, "boq_approval", "BOQ_REVISION_NOT_APPROVED").message).toBe(
        "The bill was entered by hand; it is approved when the schedule baseline is locked (Schedule → Lock Baseline).",
      );
      expect(step(result, "boq_approval").action).toEqual({
        label: "Lock schedule baseline",
        target: { module: "schedule", child: "revisions" },
      });
      expect(result.summary.advisoryAction).toMatchObject({ stepKey: "structure_setup" });
      await expectGatesAsBase(result, live.org.id);
      // The existing steps keep their codes: nothing hard became soft either.
      expect(step(result, "boq_allocation").blockers.map((b) => b.code)).toEqual(["NO_APPROVED_ALLOCATIONS", "UNALLOCATED_BOQ"]);
      expect(result.gates.baseline.blockers.map((b) => b.code)).toContain("UNALLOCATED_BOQ");
    });

    it("a fixture that passes the baseline gate still passes with its structure and BOQ approval open", async () => {
      // One row fully allocated and approved, one critical activity with no
      // float, an approved schedule revision — what the base needed for
      // gates.baseline.ready. Nothing about structure or the bill's review.
      const passing = await prisma.project.create({
        data: { orgId: live.org.id, name: "LiveTest PC-4 passing", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18"), contractValue: 20000, duration: 12, clientName: "Client", contractorName: "Contractor" },
      });
      const item = await createItem({ code: "1.1", description: "Concrete", quantity: 100, unit: "m3", rate: 200 }, passing.id);
      const activity = await createActivity({ name: "Pour", activityCode: "1.1", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06" }, passing.id);
      await prisma.activity.update({ where: { id: activity.id }, data: { isCritical: true, totalFloat: 0 } });
      const allocation = await post(allocationsRoute(passing.id), { boqItemId: item.id, activityId: activity.id, quantity: 100 });
      expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
      await approveFlow(allocation.body.data.id, passing.id);
      await prisma.scheduleRevision.create({
        data: { projectId: passing.id, label: "Rev A", status: "approved", isActive: true, activityCount: 1, approvedAt: new Date(), activatedAt: new Date() },
      });

      passingProjectId = passing.id;
      const result = await readiness(passing.id);
      expect(result.gates.baseline.blockers).toEqual([]);
      expect(result.gates.baseline.ready).toBe(true);
      expect(result.summary.readyForBaseline).toBe(true);
      // ... while the two advisory steps are not done: no WBS at all, and a
      // hand-entered bill with no revision under review.
      expect(step(result, "structure_setup").status).toBe("attention");
      expect(step(result, "structure_setup").warnings.map((w) => w.code)).toEqual(["NO_WBS", "NO_LOCATIONS", "NO_PROJECT_COST_CODES"]);
      expect(step(result, "boq_approval").status).toBe("attention");
      expect(warning(result, "boq_approval", "BOQ_REVISION_NOT_APPROVED")).toBeTruthy();
      await expectGatesAsBase(result, live.org.id);
    });
  });

  describe("per-item detail (§2)", () => {
    it("names the BOQ rows and activities behind each issue with the route that fixes them", async () => {
      const result = await readiness();

      // Rows without a WBS node: 1.2 and P.1 (1.1 is filed), linked into the
      // grid — reported on the Structure step as information: nothing in the
      // product files a row yet, so it holds no step (the BOQ upload is
      // complete, as the base had it).
      expect(step(result, "boq_upload")).toMatchObject({ status: "complete", warnings: [] });
      expect(step(result, "schedule_generation").warnings.map((w) => w.code)).not.toContain("ACTIVITIES_WITHOUT_WBS");
      const withoutWbs = advisory(result, "structure_setup", "BOQ_ITEMS_WITHOUT_WBS");
      expect(withoutWbs.severity).toBe("advisory");
      expect(withoutWbs.count).toBe(2);
      expect(withoutWbs.items).toEqual([
        { type: "boq_item", id: base.items.rebar.id, code: "1.2", label: "Reinforcement to foundations", missing: "WBS node", href: href(project.id, `/boq?recordId=${base.items.rebar.id}&source=boq_item`) },
        { type: "boq_item", id: base.items.prelims.id, code: "P.1", label: "Site establishment", missing: "WBS node", href: href(project.id, `/boq?recordId=${base.items.prelims.id}&source=boq_item`) },
      ]);
      // The activity without a WBS node, linked to the activities page.
      const activitiesWithoutWbs = advisory(result, "structure_setup", "ACTIVITIES_WITHOUT_WBS");
      expect(activitiesWithoutWbs.count).toBe(1);
      expect(activitiesWithoutWbs.items).toEqual([
        { type: "activity", id: base.activities.fix.id, code: "A130", label: "Fix reinforcement", missing: "WBS node", href: href(project.id, `/activities?recordId=${base.activities.fix.id}&source=activity`) },
      ]);
      // The unallocated rows, linked into the mapping matrix; the n/a row is
      // not among them (PC-3's summary keeps it out).
      const unallocated = step(result, "boq_allocation").blockers.find((b) => b.code === "UNALLOCATED_BOQ");
      expect(unallocated.count).toBe(2);
      expect(unallocated.items.map((item) => [item.type, item.id, item.code, item.href])).toEqual([
        ["boq_item", base.items.concrete.id, "1.1", href(project.id, `/controls/mapping?recordId=${base.items.concrete.id}&source=boq_item`)],
        ["boq_item", base.items.rebar.id, "1.2", href(project.id, `/controls/mapping?recordId=${base.items.rebar.id}&source=boq_item`)],
      ]);
      expect(unallocated.items[0].missing).toBe("20000.00 unallocated");
      // The structure warnings point at the pages where the structure is made.
      expect(warning(result, "structure_setup", "NO_LOCATIONS").items[0].href).toBe(href(project.id, "/locations"));
      expect(warning(result, "structure_setup", "NO_PROJECT_COST_CODES").items[0].href).toBe(href(project.id, "/cost/budget"));
      // Every issue on every step carries the two fields, whatever it is about.
      for (const entry of result.steps) {
        for (const issue of [...entry.blockers, ...entry.warnings, ...entry.advisories]) {
          expect(Array.isArray(issue.items)).toBe(true);
          expect(issue.count).toBeGreaterThanOrEqual(issue.items.length);
          for (const item of issue.items) expect(item.href.startsWith(`/o/${segment}/projects/${project.id}/`)).toBe(true);
        }
      }
    });
  });

  describe("coverage figures (§69)", () => {
    it("the readiness coverage is PC-3's summary, key for key, before and after an approval", async () => {
      const compare = async () => {
        const [result, coverage] = await Promise.all([readiness(), get(`${allocationsRoute()}/coverage`)]);
        expect(coverage.status).toBe(200);
        const { items, groups, ...totals } = coverage.body.data;
        expect(items.length).toBe(3);
        expect(groups).toEqual([]);
        expect(result.coverage).toEqual(totals);
        expect(step(result, "boq_allocation").counts).toMatchObject({
          totalBoqAmount: totals.totalBoqAmount,
          allocatableBoqAmount: totals.allocatableBoqAmount,
          approvedAllocatedAmount: totals.approvedAllocatedAmount,
          pendingAllocatedAmount: totals.pendingAllocatedAmount,
          unallocatedAmount: totals.unallocatedAmount,
          notApplicableAmount: totals.notApplicableAmount,
        });
        expect(money(totals.approvedAllocatedAmount + totals.unallocatedAmount + totals.notApplicableAmount)).toBe(money(totals.totalBoqAmount));
        return totals;
      };
      const before = await compare();
      expect(before).toMatchObject({ totalBoqAmount: 100000, notApplicableAmount: 30000, allocatableBoqAmount: 70000, coveragePct: 0 });
      // §33 "Unmapped BOQ quantity": the rows' open quantities by unit —
      // 50 t (50,000 open) before 100 m3 (20,000 open); the n/a row's "sum"
      // is not unmapped, and m3 and t are never added together.
      const headlineOf = (result) => Object.fromEntries(result.summary.headline.map((entry) => [entry.key, entry.value]));
      expect(headlineOf(await readiness())).toMatchObject({ unmapped_quantity: "50 t · 100 m3", unmapped_boq: "70,000 USD" });

      const allocation = await post(allocationsRoute(), { boqItemId: base.items.rebar.id, activityId: base.activities.fix.id, quantity: 50 });
      expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
      await approveFlow(allocation.body.data.id);

      const after = await compare();
      expect(after).toMatchObject({ approvedAllocatedAmount: 50000, unallocatedAmount: 20000 });
      expect(money(after.coveragePct)).toBe(money((50000 / 70000) * 100));
      expect(headlineOf(await readiness())).toMatchObject({ unmapped_quantity: "100 m3", unmapped_boq: "20,000 USD" });
    });
  });

  describe("warnings appear and disappear as the data is fixed", () => {
    it("an imported calendar left unmapped, then mapped", async () => {
      await prisma.activity.update({ where: { id: base.activities.fix.id }, data: { calendarId: "1" } });
      const broken = advisory(await readiness(), "schedule_generation", "IMPORTED_CALENDAR_UNMAPPED");
      expect(broken).toBeTruthy();
      expect(broken.items).toEqual([expect.objectContaining({ type: "activity", id: base.activities.fix.id, missing: 'Calendar "1" is not mapped' })]);

      await prisma.activity.update({ where: { id: base.activities.fix.id }, data: { calendarId: "five_day" } });
      expect(advisory(await readiness(), "schedule_generation", "IMPORTED_CALENDAR_UNMAPPED")).toBeUndefined();
    });

    it("a unit nobody recognises, then added to the organisation's list", async () => {
      // "skidz" is nobody's spelling; "bag" would already be in the default list.
      const skids = await createItem({ code: "2.1", description: "Blocks on skids", quantity: 40, unit: "skidz", rate: 12 });
      const broken = await readiness();
      expect(warning(broken, "structure_setup", "UOM_UNRESOLVED").items).toEqual([
        expect.objectContaining({ type: "unit", code: "skidz", href: href(project.id, "/controls/structure") }),
      ]);
      expect(broken.structure.unitsUnresolved).toBe(1);
      expect(advisory(broken, "boq_upload", "BOQ_UNIT_UNRESOLVED").items).toEqual([
        expect.objectContaining({ type: "boq_item", id: skids.id, code: "2.1", missing: 'Unit "skidz" is not recognised' }),
      ]);

      const unit = await post(`/api/v1/projects/${project.id}/structure/units`, { code: "SKD", name: "Skid", aliases: ["skidz"] });
      expect([unit.status, unit.body?.error]).toEqual([201, undefined]);
      const fixed = await readiness();
      expect(warning(fixed, "structure_setup", "UOM_UNRESOLVED")).toBeUndefined();
      expect(advisory(fixed, "boq_upload", "BOQ_UNIT_UNRESOLVED")).toBeUndefined();
      expect(fixed.structure.unitsUnresolved).toBe(0);
    });

    it("a quantity method without a unit, then one that disagrees with the BOQ row, then one that agrees", async () => {
      const route = `/api/v1/projects/${project.id}/activities/${base.activities.pour.id}/progress-method`;
      const noUnit = await put(route, { method: "quantity", plannedQuantity: 100 });
      expect([noUnit.status, noUnit.body?.error]).toEqual([200, undefined]);
      const draft = await post(allocationsRoute(), { boqItemId: base.items.concrete.id, activityId: base.activities.pour.id, quantity: 10 });
      expect([draft.status, draft.body?.error]).toEqual([201, undefined]);

      const missingUnit = await readiness();
      expect(advisory(missingUnit, "progress_method_configuration", "QUANTITY_METHOD_WITHOUT_UNIT").items).toEqual([
        expect.objectContaining({ type: "activity", id: base.activities.pour.id, href: href(project.id, `/schedule/progress?recordId=${base.activities.pour.id}&source=activity`) }),
      ]);
      expect(advisory(missingUnit, "boq_allocation", "UNIT_MISMATCH_COUNT")).toBeUndefined();

      const m2 = await put(route, { method: "quantity", plannedQuantity: 100, quantityUnit: "m2" });
      expect(m2.status).toBe(200);
      const mismatch = await readiness();
      expect(advisory(mismatch, "progress_method_configuration", "QUANTITY_METHOD_WITHOUT_UNIT")).toBeUndefined();
      expect(advisory(mismatch, "boq_allocation", "UNIT_MISMATCH_COUNT").items).toEqual([
        expect.objectContaining({ type: "allocation", id: draft.body.data.id, label: "1.1 → 1.1", missing: 'BOQ unit "m3" vs progress unit "m2"' }),
      ]);
      expect(step(mismatch, "boq_allocation").counts.unitMismatchCount).toBe(1);
      // The draft itself is reported as pending, with its row's mapping link.
      expect(warning(mismatch, "boq_allocation", "PENDING_ALLOCATIONS").items).toEqual([
        expect.objectContaining({ type: "allocation", id: draft.body.data.id, missing: "Submit", href: href(project.id, `/controls/mapping?recordId=${base.items.concrete.id}&source=boq_item`) }),
      ]);

      const m3 = await put(route, { method: "quantity", plannedQuantity: 100, quantityUnit: "M3" });
      expect(m3.status).toBe(200);
      expect(advisory(await readiness(), "boq_allocation", "UNIT_MISMATCH_COUNT")).toBeUndefined();
    });

    it("a row whose mapping rule is unset, then set", async () => {
      await prisma.boqItem.update({ where: { id: base.items.rebar.id }, data: { mappingRule: "" } });
      const broken = warning(await readiness(), "boq_approval", "BOQ_MAPPING_RULE_UNSET");
      expect(broken.count).toBe(1);
      expect(broken.items).toEqual([
        expect.objectContaining({ type: "boq_item", id: base.items.rebar.id, code: "1.2", missing: "Mapping rule", href: href(project.id, `/controls/mapping?recordId=${base.items.rebar.id}&source=boq_item`) }),
      ]);
      await prisma.boqItem.update({ where: { id: base.items.rebar.id }, data: { mappingRule: "required" } });
      expect(warning(await readiness(), "boq_approval", "BOQ_MAPPING_RULE_UNSET")).toBeUndefined();
    });

    it("an uploaded bill: not approved, then awaiting approval, then approved — and the gates never move", async () => {
      const uploadProject = await prisma.project.create({ data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-4 upload", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });
      const uploaded = await uploadWorkbook(`/api/v1/projects/${uploadProject.id}/boq/upload`, [
        ["Item No", "Description", "Qty", "Unit", "Rate"],
        ["1.1", "Concrete", 10, "m3", 100],
        ["1.2", "Formwork", 20, "m2", 50],
      ]);
      expect([uploaded.status, uploaded.body?.error, uploaded.body?.data?.mode]).toEqual([200, undefined, "imported"]);
      const revision = await prisma.boqRevision.findUnique({ where: { id: uploaded.body.data.revisionId }, select: { id: true, revisionNumber: true, label: true } });
      expect(revision?.id).toBeTruthy();

      const notApproved = await readiness(uploadProject.id);
      expect(step(notApproved, "boq_approval").status).toBe("attention");
      const pendingWarning = warning(notApproved, "boq_approval", "BOQ_REVISION_NOT_APPROVED");
      expect(pendingWarning.items).toEqual([
        { type: "boq_revision", id: revision.id, code: `Rev ${revision.revisionNumber}`, label: revision.label, missing: "Submit and approve", href: href(uploadProject.id, `/boq?recordId=${revision.id}&source=boq_revision`) },
      ]);
      expect(notApproved.context.boqRevision).toMatchObject({ id: revision.id, status: "imported", baselineLocked: false });
      const gatesBefore = JSON.stringify(notApproved.gates);
      // Each stage against the base service run on the rows as they stand
      // at that stage, before the next change.
      await expectGatesAsBase(notApproved, live.org.id);

      const submitted = await post(`/api/v1/projects/${uploadProject.id}/boq/revisions/${revision.id}/submit`, {});
      expect([submitted.status, submitted.body?.error]).toEqual([200, undefined]);
      const underReview = await readiness(uploadProject.id);
      expect(step(underReview, "boq_approval").warnings.map((w) => w.code)).toEqual(["PENDING_BOQ_REVISION"]);
      expect(warning(underReview, "boq_approval", "PENDING_BOQ_REVISION").items[0]).toMatchObject({ type: "boq_revision", id: revision.id, missing: "Approval" });
      await expectGatesAsBase(underReview, live.org.id);

      const approved = await post(`/api/v1/projects/${uploadProject.id}/boq/revisions/${revision.id}/approve`, {});
      expect([approved.status, approved.body?.error]).toEqual([200, undefined]);
      const done = await readiness(uploadProject.id);
      expect(step(done, "boq_approval")).toMatchObject({ status: "complete", warnings: [], message: "BOQ revision is approved." });
      expect(done.context.boqRevision).toMatchObject({ id: revision.id, status: "approved" });
      // §22: the revision's own record — scope, value, the upload's changes
      // and the review trail PC-2's workflow kept, with the actor named.
      const actor = await prisma.user.findUnique({ where: { id: live.user.id }, select: { name: true } });
      expect(done.context.boqRevision).toMatchObject({
        revisionNumber: revision.revisionNumber,
        itemCount: 2,
        totalAmount: 2000,
        changes: { added: 2, updated: 0, removed: 0, blocked: 0 },
        validation: { blockedCount: 0, blocked: [] },
      });
      const trail = done.context.boqRevision.history;
      expect(trail.slice(-2).map((entry) => [entry.action, entry.fromStatus, entry.toStatus, entry.actorId, entry.actorName])).toEqual([
        ["submitted", "imported", "under_review", live.user.id, actor.name],
        ["approved", "under_review", "approved", live.user.id, actor.name],
      ]);
      // §33: the status line reads the same figures the steps derive.
      expect(done.summary.headline.map((entry) => [entry.key, entry.value])).toEqual([
        ["boq_imported", "PASS"],
        ["schedule_imported", "FAIL"],
        ["mapping", "0%"],
        // Equal value open in each unit: the rows keep the bill's order.
        ["unmapped_quantity", "10 m3 · 20 m2"],
        ["unmapped_boq", "2,000 USD"],
        ["critical_unmapped", "0"],
        ["baseline", "NOT APPROVED"],
        ["cost_loading", "INCOMPLETE"],
      ]);
      // The bill's approval is advisory: the gates before and after are the
      // same, and the same as the base service reports at every stage.
      expect(JSON.stringify(done.gates)).toBe(gatesBefore);
      await expectGatesAsBase(done, live.org.id);
      uploaded1 = { projectId: uploadProject.id, revisionId: revision.id };
    });
  });
  describe("issues nobody can resolve yet hold no step (default b)", () => {
    it("a bill uploaded through the product, with value and no other issue, completes the BOQ upload — its rows unfiled under the project's WBS are information on the Structure step", async () => {
      const filedProject = await prisma.project.create({
        data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-4 upload filed", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
      });
      const node = await post(`/api/v1/projects/${filedProject.id}/structure/wbs`, { code: "A", name: "Substructure" });
      expect([node.status, node.body?.error]).toEqual([201, undefined]);
      const uploaded = await uploadWorkbook(`/api/v1/projects/${filedProject.id}/boq/upload`, [
        ["Item No", "Description", "Qty", "Unit", "Rate"],
        ["1.1", "Concrete", 10, "m3", 100],
        ["1.2", "Formwork", 20, "m2", 50],
      ]);
      expect([uploaded.status, uploaded.body?.error, uploaded.body?.data?.mode]).toEqual([200, undefined, "imported"]);
      // The product offers no way to file an uploaded row under a node: a
      // PATCH that names one is answered, and the row stays unfiled.
      const rows = await prisma.boqItem.findMany({ where: { projectId: filedProject.id, isActive: true }, select: { id: true, wbsNodeId: true } });
      expect(rows).toHaveLength(2);
      await patch(`/api/v1/projects/${filedProject.id}/boq/items/${rows[0].id}`, { wbsNodeId: node.body.data.id });
      expect((await prisma.boqItem.findUnique({ where: { id: rows[0].id }, select: { wbsNodeId: true } })).wbsNodeId).toBeNull();

      const result = await readiness(filedProject.id);
      expect(step(result, "boq_upload")).toMatchObject({ status: "complete", blockers: [], warnings: [], message: "BOQ is loaded." });
      expect(advisory(result, "structure_setup", "BOQ_ITEMS_WITHOUT_WBS")).toMatchObject({ severity: "advisory", count: 2 });
      // Not in any gate, and the base service agrees on every original step.
      for (const gate of Object.values(result.gates)) {
        expect((gate.warnings || []).map((entry) => entry.code)).not.toContain("BOQ_ITEMS_WITHOUT_WBS");
      }
      await expectGatesAsBase(result, live.org.id);
    });

    it("a row or an activity filed under an archived WBS node counts as unfiled, and says why", async () => {
      const retired = (await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "X", name: "Retired scope" })).body.data;
      expect(retired?.id).toBeTruthy();
      await prisma.boqItem.update({ where: { id: base.items.rebar.id }, data: { wbsNodeId: retired.id } });
      await prisma.activity.update({ where: { id: base.activities.fix.id }, data: { wbsNodeId: retired.id } });
      try {
        const filed = await readiness();
        expect(advisory(filed, "structure_setup", "BOQ_ITEMS_WITHOUT_WBS").items.map((item) => item.id)).not.toContain(base.items.rebar.id);
        expect(advisory(filed, "structure_setup", "ACTIVITIES_WITHOUT_WBS")).toBeUndefined();

        const archived = await post(`/api/v1/projects/${project.id}/structure/wbs/${retired.id}/archive`, { reason: "LiveTest: scope retired" });
        expect([archived.status, archived.body?.error]).toEqual([200, undefined]);
        const result = await readiness();
        const rows = advisory(result, "structure_setup", "BOQ_ITEMS_WITHOUT_WBS");
        expect(rows.items.find((item) => item.id === base.items.rebar.id)).toMatchObject({ missing: "Filed under an archived WBS node" });
        expect(rows.message).toMatch(/\(1 filed under an archived node\)/);
        const activities = advisory(result, "structure_setup", "ACTIVITIES_WITHOUT_WBS");
        expect(activities.items).toEqual([expect.objectContaining({ id: base.activities.fix.id, missing: "Filed under an archived WBS node" })]);
        expect(step(result, "structure_setup").guides.find((guide) => guide.key === "schedule_structure").detail).not.toBe("Every activity is filed");
      } finally {
        await prisma.boqItem.update({ where: { id: base.items.rebar.id }, data: { wbsNodeId: null } });
        await prisma.activity.update({ where: { id: base.activities.fix.id }, data: { wbsNodeId: null } });
      }
    });
  });

  describe("what readiness tells a member who may not read the BOQ", () => {
    it("the same steps, statuses, codes and gates — without the bill's rows, values, quantities or review trail", async () => {
      expect(uploaded1).toBeTruthy();
      // A site engineer on both projects whose permission template takes the
      // BOQ away: the BOQ and coverage endpoints refuse them.
      const tag = Date.now();
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: "LiveTest Site Engineer",
        email: `live-se-${tag}@octapm-live.test`,
        role: "site_engineer",
      });
      const template = await prisma.permissionTemplate.create({
        data: {
          orgId: live.org.id,
          name: `LiveTest no BOQ ${tag}`,
          baseRole: "site_engineer",
          tools: { create: [{ module: "boq", level: "none" }] },
        },
      });
      const projectIds = [project.id, uploaded1.projectId];
      for (const projectId of projectIds) {
        await prisma.projectAssignment.create({
          data: { projectId, userId: member.id, role: "site_engineer", orgId: live.org.id },
        });
        await prisma.projectUserPermission.create({
          data: { orgId: live.org.id, projectId, userId: member.id, templateId: template.id },
        });
      }
      const memberAuth = { authorization: `Bearer ${mintAccessToken(member)}` };
      // How many rows or allocations a mapping issue concerns is the bill's
      // (owner decision C), and so is how many BOQ rows a filing or unit
      // issue concerns (the owner's rule on BOQ-derived counts): the limited
      // answer leaves those counts out.
      const MAPPING_CODES = new Set([
        "BOQ_MAPPING_RULE_UNSET",
        "NO_APPROVED_ALLOCATIONS",
        "UNALLOCATED_BOQ",
        "OPTIONAL_UNALLOCATED",
        "PENDING_ALLOCATIONS",
        "SUGGESTIONS_PENDING",
        "UNIT_MISMATCH_COUNT",
        "LOCATION_MISMATCH_COUNT",
        "BOQ_ITEMS_WITHOUT_WBS",
        "BOQ_ITEMS_WITHOUT_COST_CODE",
        "BOQ_UNIT_UNRESOLVED",
        "UOM_UNRESOLVED",
      ]);
      const shape = (result, { mappingCounts = true } = {}) => {
        const entryOf = (issue) => [issue.code, !mappingCounts && MAPPING_CODES.has(issue.code) ? undefined : issue.count];
        return result.steps.map((entry) => [
          entry.key,
          entry.status,
          entry.blockers.map(entryOf),
          entry.warnings.map(entryOf),
          entry.advisories.map(entryOf),
        ]);
      };
      const boqTypes = new Set(["boq_item", "allocation", "boq_revision", "unit"]);
      const issuesOf = (result) => result.steps.flatMap((entry) => [...entry.blockers, ...entry.warnings, ...entry.advisories]);

      // What the bill says that only a BOQ reader may see, per project: a
      // row's description on the main project, the approver's name and the
      // rows on the uploaded one.
      const secrets = { [project.id]: ["Concrete in foundations"], [uploaded1.projectId]: ["Formwork", "Live Test Admin"] };

      for (const projectId of projectIds) {
        expect((await api.get(`/api/v1/projects/${projectId}/boq`, memberAuth)).status).toBe(403);
        expect((await api.get(`${allocationsRoute(projectId)}/coverage`, memberAuth)).status).toBe(403);

        const full = await readiness(projectId);
        const response = await api.get(`/api/v1/projects/${projectId}/setup-readiness`, memberAuth);
        expect([response.status, response.body?.error]).toEqual([200, undefined]);
        const limited = response.body.data;

        // Everything that decides anything is the same for both callers.
        expect(shape(limited)).toEqual(shape(full, { mappingCounts: false }));
        for (const name of ["baseline", "progress", "reporting"]) {
          expect(limited.gates[name].ready).toBe(full.gates[name].ready);
          expect(limited.gates[name].blockers.map((b) => b.code)).toEqual(full.gates[name].blockers.map((b) => b.code));
        }
        expect(limited.summary.nextAction).toEqual(full.summary.nextAction);

        // The full answer names BOQ records; the limited one names none.
        expect(issuesOf(full).some((issue) => issue.items.some((item) => boqTypes.has(item.type)))).toBe(true);
        for (const issue of issuesOf(limited)) {
          for (const item of issue.items) expect(boqTypes.has(item.type)).toBe(false);
        }
        // No share — rounded or not — and no row counts (owner decision C,
        // which replaced round 1's whole percent).
        expect(limited.coverage).toEqual({ withheld: true, reason: "Mapping details unavailable to you" });
        expect(JSON.stringify(limited)).not.toMatch(/"coveragePct"/);
        expect(limited.summary.headline.find((entry) => entry.key === "mapping")).toMatchObject({ value: "—", raw: null, withheld: true });
        const limitedHeadline = limited.summary.headline.map((entry) => entry.key);
        expect(limitedHeadline).not.toContain("unmapped_boq");
        expect(limitedHeadline).not.toContain("unmapped_quantity");
        const fullText = JSON.stringify(full);
        const limitedText = JSON.stringify(limited);
        for (const secret of secrets[projectId]) {
          expect(fullText).toContain(secret);
          expect(limitedText).not.toContain(secret);
        }
      }
      // The bill's revision: its number and status, not its row counts
      // (BOQ-derived: the owner's rule), value or trail.
      const revision = (await api.get(`/api/v1/projects/${uploaded1.projectId}/setup-readiness`, memberAuth)).body.data.context.boqRevision;
      expect(revision).toMatchObject({
        id: uploaded1.revisionId,
        status: "approved",
        countsWithheld: true,
        reason: "BOQ details unavailable to you",
        validation: { blocked: [] },
      });
      for (const key of ["itemCount", "changes", "totalAmount", "history"]) expect([key, key in revision]).toEqual([key, false]);
      expect(revision.validation).not.toHaveProperty("blockedCount");
      expect((await readiness(uploaded1.projectId)).context.boqRevision).toMatchObject({ itemCount: 2, changes: { added: 2 } });

      // §12: no BOQ figure reaches a member without BOQ read from anything
      // the Overview landing asks for — the controls strip, the setup cards
      // (the step count chips, the issues and the gates built from them, the
      // schedule's own checks), the health cards — while a BOQ reader gets
      // the same answers with the figures in. Two such members: this site
      // engineer (no cost tool, so the strip's cost figures are refused),
      // and a cost controller whose template takes only the BOQ away (so the
      // cost summary and the forecast answer). The project that passes the
      // baseline gate joins the sweep: it has an approved schedule revision
      // and approved allocations, so every figure has somewhere to be.
      // GET /schedule, which the landing reads for its module-bar counts,
      // joins the sweep too: it no longer hands a member without BOQ read
      // the approved allocation per activity, the revision's open value or
      // its readiness figures (pc-4-boq-withholding.live.test.js proves that
      // endpoint and the schedule's other reads in full).
      expect(passingProjectId).toBeTruthy();
      const costController = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: "LiveTest Cost Controller",
        email: `live-cc-${tag}@octapm-live.test`,
        role: "cost_controller",
      });
      const costTemplate = await prisma.permissionTemplate.create({
        data: {
          orgId: live.org.id,
          name: `LiveTest cost, no BOQ ${tag}`,
          baseRole: "cost_controller",
          tools: { create: [{ module: "boq", level: "none" }] },
        },
      });
      const sweepProjectIds = [...projectIds, passingProjectId];
      await prisma.projectAssignment.create({
        data: { projectId: passingProjectId, userId: member.id, role: "site_engineer", orgId: live.org.id },
      });
      await prisma.projectUserPermission.create({
        data: { orgId: live.org.id, projectId: passingProjectId, userId: member.id, templateId: template.id },
      });
      for (const projectId of sweepProjectIds) {
        await prisma.projectAssignment.create({
          data: { projectId, userId: costController.id, role: "cost_controller", orgId: live.org.id },
        });
        await prisma.projectUserPermission.create({
          data: { orgId: live.org.id, projectId, userId: costController.id, templateId: costTemplate.id },
        });
      }
      const costAuth = { authorization: `Bearer ${mintAccessToken(costController)}` };
      const viewers = { siteEngineer: memberAuth, costController: costAuth };

      const BOQ_FIGURE_KEYS = new Set([
        "totalBoqAmount",
        "allocatableBoqAmount",
        "approvedAllocatedAmount",
        "pendingAllocatedAmount",
        "unallocatedAmount",
        "optionalUnallocatedAmount",
        "notApplicableAmount",
        "unallocatedBoqAmount",
        "allocatedBoqAmount",
        "allocatedBoqQuantity",
        "allocatedBoqWeight",
        "unallocatedQuantity",
        "allocationSummary",
        "totalAmount",
        "rate",
      ]);
      const figurePaths = (value, at = "") =>
        value && typeof value === "object"
          ? Object.entries(value).flatMap(([key, inner]) => [
              ...(BOQ_FIGURE_KEYS.has(key) ? [`${at}.${key}`] : []),
              ...figurePaths(inner, `${at}.${key}`),
            ])
          : [];
      const overviewRoutes = (projectId) => ({
        project: `/api/v1/projects/${projectId}`,
        parties: `/api/v1/projects/${projectId}/parties`,
        permissions: `/api/v1/auth/me/permissions?projectId=${projectId}`,
        readiness: `/api/v1/projects/${projectId}/setup-readiness`,
        costSummary: `/api/v1/projects/${projectId}/cost/summary`,
        forecast: `/api/v1/projects/${projectId}/forecast`,
        assignments: `/api/v1/projects/${projectId}/assignments/mine`,
        health: `/api/v1/projects/${projectId}/health`,
        schedule: `/api/v1/projects/${projectId}/schedule`,
      });
      // What each viewer is answered: the site engineer has no cost tool;
      // the cost controller is answered everywhere, so nothing is skipped.
      const expectedStatus = { siteEngineer: { costSummary: 403 }, costController: {} };
      const costDetail = (health) => health.dimensions.find((dimension) => dimension.key === "cost").detail;
      const checkView = (result) =>
        (result.context.scheduleReadiness?.checks || []).map((check) => [check.key, check.passed, check.message]);
      for (const [viewer, viewerAuth] of Object.entries(viewers)) {
        for (const projectId of sweepProjectIds) {
          for (const [name, route] of Object.entries(overviewRoutes(projectId))) {
            const response = await api.get(route, viewerAuth);
            expect([viewer, name, response.status]).toEqual([viewer, name, expectedStatus[viewer][name] ?? 200]);
            if (response.status !== 200) continue;
            expect([viewer, name, figurePaths(response.body.data)]).toEqual([viewer, name, []]);
            for (const secret of secrets[projectId] || []) {
              expect([viewer, name, response.text.includes(secret)]).toEqual([viewer, name, false]);
            }
          }
          // Withholding the figures moves no status, gate, check or issue
          // count — except the counts of a mapping issue, the bill's (decision C).
          const fullReadiness = await readiness(projectId);
          const viewerReadiness = (await api.get(`/api/v1/projects/${projectId}/setup-readiness`, viewerAuth)).body.data;
          expect(shape(viewerReadiness)).toEqual(shape(fullReadiness, { mappingCounts: false }));
          for (const name of ["baseline", "progress", "reporting"]) {
            expect(viewerReadiness.gates[name].ready).toBe(fullReadiness.gates[name].ready);
          }
          expect(checkView(viewerReadiness)).toEqual(checkView(fullReadiness));
          const fullHealth = (await get(`/api/v1/projects/${projectId}/health`)).body.data;
          const viewerHealth = (await api.get(`/api/v1/projects/${projectId}/health`, viewerAuth)).body.data;
          // The score and CPI are everyone's; earned value and actual cost
          // only a reader of the BOQ or the cost module's.
          expect(costDetail(viewerHealth)).toMatchObject({ cpi: costDetail(fullHealth).cpi });
          if (viewer === "costController") {
            expect(costDetail(viewerHealth)).toMatchObject({ ev: costDetail(fullHealth).ev, ac: costDetail(fullHealth).ac });
          } else {
            expect([viewer, "ev" in costDetail(viewerHealth), "ac" in costDetail(viewerHealth)]).toEqual([viewer, false, false]);
          }
        }
      }
      // The same answers for a BOQ reader carry the figures the members are
      // spared — so the sweep above is looking where they would be.
      for (const projectId of sweepProjectIds) {
        const fullReadiness = await readiness(projectId);
        expect(step(fullReadiness, "boq_upload").counts).toHaveProperty("totalBoqAmount");
        expect(step(fullReadiness, "boq_allocation").counts).toHaveProperty("unallocatedAmount");
        expect(fullReadiness.context).toHaveProperty("allocationSummary");
        const fullHealth = (await get(`/api/v1/projects/${projectId}/health`)).body.data;
        expect(costDetail(fullHealth)).toHaveProperty("unallocatedBoqAmount");
      }
      const passingChecks = (await readiness(passingProjectId)).context.scheduleReadiness.checks;
      expect(passingChecks.find((check) => check.key === "allocations").details).toMatchObject({
        totalBoqAmount: 20000,
        approvedAllocatedAmount: 20000,
      });
    });
  });

  describe("the bill's lock, as the BOQ page names it", () => {
    it("the locked revision, then the schedule baseline once one exists — the same answer GET /boq gives", async () => {
      expect(uploaded1).toBeTruthy();
      const { projectId, revisionId } = uploaded1;
      const locked = await post(`/api/v1/projects/${projectId}/boq/revisions/${revisionId}/lock`, {});
      expect([locked.status, locked.body?.error]).toEqual([200, undefined]);
      const compareLock = async () => {
        const [result, boq] = await Promise.all([readiness(projectId), get(`/api/v1/projects/${projectId}/boq`)]);
        expect([boq.status, boq.body?.error]).toEqual([200, undefined]);
        const page = boq.body.data.baseline;
        expect(result.context.boqBaseline).toEqual({ locked: page.locked, source: page.source, boqRevisionId: page.boqRevisionId });
        return result.context.boqBaseline;
      };
      expect(await compareLock()).toEqual({ locked: true, source: "boq_revision", boqRevisionId: revisionId });

      await prisma.scheduleRevision.create({
        data: { projectId, label: "Rev B", status: "baselined", isActive: true, activityCount: 0, approvedAt: new Date(), activatedAt: new Date(), baselinedAt: new Date() },
      });
      expect(await compareLock()).toEqual({ locked: true, source: "schedule_baseline", boqRevisionId: revisionId });
    });
  });

  describe("the rows an upload could not apply (§22 validation)", () => {
    it("read as the sentence PC-2 wrote, with its code beside it", async () => {
      const blockedProject = await prisma.project.create({
        data: { orgId: live.org.id, name: "LiveTest PC-4 blocked rows", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
      });
      await createItem({ code: "9.1", description: "Hand-entered row", quantity: 1, unit: "m3", rate: 10 }, blockedProject.id);
      // PC-2's own comparison of a bill whose row 9.1 was entered by hand:
      // the dry run reports the row it cannot apply.
      const dry = await uploadWorkbook(`/api/v1/projects/${blockedProject.id}/boq/upload?dryRun=true`, [
        ["Item No", "Description", "Qty", "Unit", "Rate"],
        ["9.1", "Uploaded row", 2, "m3", 10],
        ["9.2", "Another row", 3, "m3", 10],
      ]);
      expect([dry.status, dry.body?.error]).toEqual([200, undefined]);
      const blocked = dry.body.data.comparison.blocked;
      expect(blocked).toEqual([expect.objectContaining({ code: "9.1", reason: "DUPLICATE_BOQ_ITEM_CODE", message: expect.any(String) })]);
      // A revision carrying that comparison, as PC-2 stores one.
      await prisma.boqRevision.create({
        data: {
          projectId: blockedProject.id,
          revisionNumber: 1,
          label: "LiveTest blocked",
          status: "imported",
          baselineLocked: false,
          itemCount: 1,
          addedCount: 1,
          blockedCount: 1,
          totalAmount: 30,
          compareJson: { added: [], updated: [], removed: [], unchanged: [], blocked },
        },
      });
      const result = await readiness(blockedProject.id);
      expect(result.context.boqRevision.validation).toEqual({
        blockedCount: 1,
        blocked: [{ code: "9.1", description: null, reason: "DUPLICATE_BOQ_ITEM_CODE", message: blocked[0].message }],
      });
      expect(result.context.boqRevision.validation.blocked[0].message).toMatch(/hand-entered/);
    });
  });

  describe("the official reporting gate EV freezes (§121: the snapshot keeps its shape)", () => {
    it("a period locked over the gate stores the blockers and warnings without records, links or counts", async () => {
      const period = await post(`/api/v1/projects/${project.id}/reports/periods`, {
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        cutoffDate: "2026-01-31",
      });
      expect([period.status, period.body?.error]).toEqual([201, undefined]);
      // The gate as it stands when the period is locked.
      const reporting = (await readiness()).gates.reporting;
      expect(reporting.ready).toBe(false);
      // The interactive answer carries the per-item detail ...
      expect(reporting.blockers.some((blocker) => blocker.items.length > 0)).toBe(true);
      const lock = await post(`/api/v1/projects/${project.id}/reports/periods/${period.body.data.id}/lock`, {
        overrideReason: "LiveTest PC-4: the stored gate keeps its shape",
      });
      expect([lock.status, lock.body?.error]).toEqual([200, undefined]);

      // ... the frozen copies do not: the snapshot basis and the override's audit row.
      const snapshot = await prisma.evPeriodSnapshot.findUnique({ where: { reportingPeriodId: period.body.data.id } });
      const audit = await prisma.auditEvent.findFirst({
        where: { orgId: live.org.id, projectId: project.id, entityType: "project_setup_readiness", action: "overridden" },
        orderBy: { createdAt: "desc" },
      });
      for (const stored of [snapshot.basisJson.readinessGate, audit.metadataJson.readinessGate]) {
        expect(stored.blockers.map((blocker) => blocker.code)).toEqual(reporting.blockers.map((blocker) => blocker.code));
        expect(stored.warnings.map((warning) => warning.code)).toEqual(reporting.warnings.map((warning) => warning.code));
        for (const entry of [...stored.blockers, ...stored.warnings]) {
          expect(Object.keys(entry)).not.toEqual(expect.arrayContaining(["items"]));
          expect(entry).not.toHaveProperty("count");
          expect(entry).toEqual(expect.objectContaining({ code: expect.any(String), stepKey: expect.any(String), message: expect.any(String) }));
        }
        expect(JSON.stringify(stored)).not.toContain(`/o/${segment}/`);
      }
    });
  });
});
