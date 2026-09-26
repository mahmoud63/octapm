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
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
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
// blocker (`items`, `count`) is set aside, everything else must match; the
// base's warnings must all still be there (PC-4 only adds warnings).
const gateView = (gates) =>
  Object.fromEntries(
    Object.entries(gates).map(([name, { blockers, warnings, ...gate }]) => [
      name,
      { ...gate, blockers: blockers.map(({ items, count, ...blocker }) => blocker) },
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
    expect(warningCodes(gates[name])).toEqual(expect.arrayContaining(warningCodes(baseResult.gates[name])));
  }
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
};

liveDescribe("PC-4: setup flow — structure and BOQ approval steps, per-item detail, unchanged gates", () => {
  let live;
  let api;
  let project;
  let base;
  let segment;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
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

      // Rows without a WBS node: 1.2 and P.1 (1.1 is filed), linked into the grid.
      const withoutWbs = warning(result, "boq_upload", "BOQ_ITEMS_WITHOUT_WBS");
      expect(withoutWbs.count).toBe(2);
      expect(withoutWbs.items).toEqual([
        { type: "boq_item", id: base.items.rebar.id, code: "1.2", label: "Reinforcement to foundations", missing: "WBS node", href: href(project.id, `/boq?recordId=${base.items.rebar.id}&source=boq_item`) },
        { type: "boq_item", id: base.items.prelims.id, code: "P.1", label: "Site establishment", missing: "WBS node", href: href(project.id, `/boq?recordId=${base.items.prelims.id}&source=boq_item`) },
      ]);
      // The activity without a WBS node, linked to the activities page.
      const activitiesWithoutWbs = warning(result, "schedule_generation", "ACTIVITIES_WITHOUT_WBS");
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
        for (const issue of [...entry.blockers, ...entry.warnings]) {
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

      const allocation = await post(allocationsRoute(), { boqItemId: base.items.rebar.id, activityId: base.activities.fix.id, quantity: 50 });
      expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
      await approveFlow(allocation.body.data.id);

      const after = await compare();
      expect(after).toMatchObject({ approvedAllocatedAmount: 50000, unallocatedAmount: 20000 });
      expect(money(after.coveragePct)).toBe(money((50000 / 70000) * 100));
    });
  });

  describe("warnings appear and disappear as the data is fixed", () => {
    it("an imported calendar left unmapped, then mapped", async () => {
      await prisma.activity.update({ where: { id: base.activities.fix.id }, data: { calendarId: "1" } });
      const broken = warning(await readiness(), "schedule_generation", "IMPORTED_CALENDAR_UNMAPPED");
      expect(broken).toBeTruthy();
      expect(broken.items).toEqual([expect.objectContaining({ type: "activity", id: base.activities.fix.id, missing: 'Calendar "1" is not mapped' })]);

      await prisma.activity.update({ where: { id: base.activities.fix.id }, data: { calendarId: "five_day" } });
      expect(warning(await readiness(), "schedule_generation", "IMPORTED_CALENDAR_UNMAPPED")).toBeUndefined();
    });

    it("a unit nobody recognises, then added to the organisation's list", async () => {
      // "skidz" is nobody's spelling; "bag" would already be in the default list.
      const skids = await createItem({ code: "2.1", description: "Blocks on skids", quantity: 40, unit: "skidz", rate: 12 });
      const broken = await readiness();
      expect(warning(broken, "structure_setup", "UOM_UNRESOLVED").items).toEqual([
        expect.objectContaining({ type: "unit", code: "skidz", href: href(project.id, "/controls/structure") }),
      ]);
      expect(broken.structure.unitsUnresolved).toBe(1);
      expect(warning(broken, "boq_upload", "BOQ_UNIT_UNRESOLVED").items).toEqual([
        expect.objectContaining({ type: "boq_item", id: skids.id, code: "2.1", missing: 'Unit "skidz" is not recognised' }),
      ]);

      const unit = await post(`/api/v1/projects/${project.id}/structure/units`, { code: "SKD", name: "Skid", aliases: ["skidz"] });
      expect([unit.status, unit.body?.error]).toEqual([201, undefined]);
      const fixed = await readiness();
      expect(warning(fixed, "structure_setup", "UOM_UNRESOLVED")).toBeUndefined();
      expect(warning(fixed, "boq_upload", "BOQ_UNIT_UNRESOLVED")).toBeUndefined();
      expect(fixed.structure.unitsUnresolved).toBe(0);
    });

    it("a quantity method without a unit, then one that disagrees with the BOQ row, then one that agrees", async () => {
      const route = `/api/v1/projects/${project.id}/activities/${base.activities.pour.id}/progress-method`;
      const noUnit = await put(route, { method: "quantity", plannedQuantity: 100 });
      expect([noUnit.status, noUnit.body?.error]).toEqual([200, undefined]);
      const draft = await post(allocationsRoute(), { boqItemId: base.items.concrete.id, activityId: base.activities.pour.id, quantity: 10 });
      expect([draft.status, draft.body?.error]).toEqual([201, undefined]);

      const missingUnit = await readiness();
      expect(warning(missingUnit, "progress_method_configuration", "QUANTITY_METHOD_WITHOUT_UNIT").items).toEqual([
        expect.objectContaining({ type: "activity", id: base.activities.pour.id, href: href(project.id, `/schedule/progress?recordId=${base.activities.pour.id}&source=activity`) }),
      ]);
      expect(warning(missingUnit, "boq_allocation", "UNIT_MISMATCH_COUNT")).toBeUndefined();

      const m2 = await put(route, { method: "quantity", plannedQuantity: 100, quantityUnit: "m2" });
      expect(m2.status).toBe(200);
      const mismatch = await readiness();
      expect(warning(mismatch, "progress_method_configuration", "QUANTITY_METHOD_WITHOUT_UNIT")).toBeUndefined();
      expect(warning(mismatch, "boq_allocation", "UNIT_MISMATCH_COUNT").items).toEqual([
        expect.objectContaining({ type: "allocation", id: draft.body.data.id, label: "1.1 → 1.1", missing: 'BOQ unit "m3" vs progress unit "m2"' }),
      ]);
      expect(step(mismatch, "boq_allocation").counts.unitMismatchCount).toBe(1);
      // The draft itself is reported as pending, with its row's mapping link.
      expect(warning(mismatch, "boq_allocation", "PENDING_ALLOCATIONS").items).toEqual([
        expect.objectContaining({ type: "allocation", id: draft.body.data.id, missing: "Submit", href: href(project.id, `/controls/mapping?recordId=${base.items.concrete.id}&source=boq_item`) }),
      ]);

      const m3 = await put(route, { method: "quantity", plannedQuantity: 100, quantityUnit: "M3" });
      expect(m3.status).toBe(200);
      expect(warning(await readiness(), "boq_allocation", "UNIT_MISMATCH_COUNT")).toBeUndefined();
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

      const submitted = await post(`/api/v1/projects/${uploadProject.id}/boq/revisions/${revision.id}/submit`, {});
      expect([submitted.status, submitted.body?.error]).toEqual([200, undefined]);
      const underReview = await readiness(uploadProject.id);
      expect(step(underReview, "boq_approval").warnings.map((w) => w.code)).toEqual(["PENDING_BOQ_REVISION"]);
      expect(warning(underReview, "boq_approval", "PENDING_BOQ_REVISION").items[0]).toMatchObject({ type: "boq_revision", id: revision.id, missing: "Approval" });

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
        ["unmapped_boq", "2,000 USD"],
        ["critical_unmapped", "0"],
        ["baseline", "NOT APPROVED"],
        ["cost_loading", "INCOMPLETE"],
      ]);
      // The bill's approval is advisory: the gates before and after are the
      // same, and the same as the base service reports at every stage.
      expect(JSON.stringify(done.gates)).toBe(gatesBefore);
      await expectGatesAsBase(notApproved, live.org.id);
      await expectGatesAsBase(underReview, live.org.id);
      await expectGatesAsBase(done, live.org.id);
    });
  });
});
