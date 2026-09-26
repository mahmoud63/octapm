/**
 * PC-3 — BOQ ↔ activity mapping, proven against a real API process and the
 * real local Postgres.
 *
 *   rules: a not_applicable row refuses an allocation (409); a row with an
 *     approved allocation cannot be moved to not_applicable (409); a bulk
 *     rule by section; the mapping_rule column on a BOQ upload
 *   validation §70-§72: unit mismatch and WBS subtree are warnings in the
 *     write response; the location subtree rule blocks a new row (422)
 *   basis: what was typed is recorded and the other two figures derived
 *     (money 2 dp, quantity 3 dp); a rate change re-derives drafts and only
 *     reports approved rows
 *   coverage: BOQ total = approved allocated + unallocated + not applicable
 *     on the project, per group and in the readiness step, which ignores
 *     not_applicable rows, as does the schedule readiness check
 *   import: dry run writes nothing; apply creates import drafts under one
 *     batch; the same file again creates nothing; undo rejects the drafts
 *   suggestions: ranked with the doc's confidences, and never written
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards. The API is started on a free port with the job worker
 * off, so nothing calls a model.
 *
 *   npm run test:live -- src/services/__live__/pc-3-mapping-rules.live.test.js
 */
const XLSX = require("@e965/xlsx");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const money = (value) => Number(Number(value).toFixed(2));

liveDescribe("PC-3: BOQ ↔ activity mapping rules, coverage, import and suggestions", () => {
  let live;
  let api;
  let project;
  let base;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const post = (route, body) => api.post(route, body, auth());
  const get = (route) => api.get(route, auth());
  const patch = (route, body) => api.request("PATCH", route, { body, headers: auth() });
  const allocationsRoute = () => `/api/v1/projects/${project.id}/activity-boq-allocations`;

  const createItem = async (payload) => {
    const created = await post(`/api/v1/projects/${project.id}/boq/items`, payload);
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    return created.body.data.item;
  };
  // An activity needs an engineer; the live admin stands in.
  const activityPayload = (payload) => ({ engineerIds: [live.user.id], ...payload });
  const createActivity = async (payload, projectId = project.id) => {
    const created = await post(`/api/v1/projects/${projectId}/activities`, activityPayload(payload));
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    return created.body.data;
  };
  const allocate = (payload) => post(allocationsRoute(), payload);
  const approveFlow = async (allocationId) => {
    const submitted = await post(`${allocationsRoute()}/${allocationId}/submit`, {});
    expect([submitted.status, submitted.body?.error]).toEqual([200, undefined]);
    const approved = await post(`${allocationsRoute()}/${allocationId}/approve`, {});
    expect([approved.status, approved.body?.error]).toEqual([200, undefined]);
    return approved.body.data;
  };
  const uploadWorkbook = async (route, rows, filename = "file.xlsx") => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
    const response = await fetch(`${api.base}${route}`, { method: "POST", headers: auth(), body: form });
    return { status: response.status, body: await response.json() };
  };
  const coverage = async (query = "") => {
    const response = await get(`${allocationsRoute()}/coverage${query}`);
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data;
  };
  const expectInvariant = (summary) => {
    expect(money(summary.approvedAllocatedAmount + summary.unallocatedAmount + summary.notApplicableAmount)).toBe(money(summary.totalBoqAmount));
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest PC-3 mapping", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    api = await startApi({ RATE_LIMIT_AI_MAX: "1000", RATE_LIMIT_UPLOAD_MAX: "1000" });

    // The bill and the programme every block builds on. Items carry their
    // structure keys directly (the grid's structure editor is a later wave):
    // a WBS tree A > A.1 and B; locations Site > Block A > Level 1, and a
    // second root Block B.
    const wbsA = (await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "A", name: "Substructure" })).body.data;
    const wbsA1 = (await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "A.1", name: "Foundations", parentId: wbsA.id })).body.data;
    const wbsB = (await post(`/api/v1/projects/${project.id}/structure/wbs`, { code: "B", name: "Superstructure" })).body.data;
    const site = (await post(`/api/v1/projects/${project.id}/locations`, { name: "Site", kind: "site" })).body.data;
    const blockA = (await post(`/api/v1/projects/${project.id}/locations`, { name: "Block A", kind: "building", parentId: site.id })).body.data;
    const levelA1 = (await post(`/api/v1/projects/${project.id}/locations`, { name: "Level 1", kind: "level", parentId: blockA.id })).body.data;
    const blockB = (await post(`/api/v1/projects/${project.id}/locations`, { name: "Block B", kind: "building" })).body.data;
    expect([wbsA?.id, wbsA1?.id, wbsB?.id, site?.id, blockA?.id, levelA1?.id, blockB?.id].every(Boolean)).toBe(true);

    const items = {
      concrete: await createItem({ code: "1.1", description: "Concrete in foundations", quantity: 100, unit: "m3", rate: 200 }),
      rebar: await createItem({ code: "1.2", description: "Reinforcement to foundations", quantity: 50, unit: "t", rate: 1000 }),
      prelims: await createItem({ code: "P.1", description: "Site establishment", quantity: 1, unit: "sum", rate: 30000 }),
      dayworks: await createItem({ code: "P.2", description: "Dayworks provisional sum", quantity: 1, unit: "sum", rate: 5000 }),
      columns: await createItem({ code: "2.1", description: "Concrete columns", quantity: 40, unit: "m3", rate: 250 }),
    };
    await prisma.boqItem.update({ where: { id: items.concrete.id }, data: { wbsNodeId: wbsA1.id, locationId: blockA.id, section: "Substructure" } });
    await prisma.boqItem.update({ where: { id: items.rebar.id }, data: { wbsNodeId: wbsA1.id, section: "Substructure" } });
    await prisma.boqItem.update({ where: { id: items.prelims.id }, data: { section: "Preliminaries" } });
    await prisma.boqItem.update({ where: { id: items.dayworks.id }, data: { section: "Preliminaries" } });
    await prisma.boqItem.update({ where: { id: items.columns.id }, data: { wbsNodeId: wbsB.id, section: "Superstructure" } });

    const activities = {
      pour: await createActivity({ name: "Pour foundations", activityCode: "1.1", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06" }),
      fix: await createActivity({ name: "Reinforcement to foundations", activityCode: "A130", duration: 6, startDate: "2026-01-26", endDate: "2026-02-01" }),
      columns: await createActivity({ name: "Cast columns", activityCode: "B100", duration: 8, startDate: "2026-03-02", endDate: "2026-03-11" }),
    };
    await prisma.activity.update({ where: { id: activities.pour.id }, data: { wbsNodeId: wbsA1.id, locationId: blockA.id } });
    await prisma.activity.update({ where: { id: activities.fix.id }, data: { wbsNodeId: wbsA1.id } });
    await prisma.activity.update({ where: { id: activities.columns.id }, data: { wbsNodeId: wbsB.id, locationId: blockB.id } });

    base = { wbsA, wbsA1, wbsB, site, blockA, levelA1, blockB, items, activities };
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

  describe("mapping rules (§66-§68)", () => {
    it("a bulk rule by section marks the preliminaries not applicable, and an allocation to one is refused", async () => {
      const ruled = await patch(`${allocationsRoute()}/mapping-rules`, { rule: "not_applicable", section: "preliminaries" });
      expect([ruled.status, ruled.body?.error]).toEqual([200, undefined]);
      expect(ruled.body.data).toMatchObject({ rule: "not_applicable", matched: 2, updated: 2 });
      const rows = await prisma.boqItem.findMany({ where: { id: { in: [base.items.prelims.id, base.items.dayworks.id] } }, select: { mappingRule: true } });
      expect(rows.map((r) => r.mappingRule)).toEqual(["not_applicable", "not_applicable"]);

      const refused = await allocate({ boqItemId: base.items.prelims.id, activityId: base.activities.pour.id, amount: 1000 });
      expect([refused.status, refused.body?.error?.code]).toEqual([409, "MAPPING_NOT_APPLICABLE"]);
      expect(await prisma.activityBoqAllocation.count({ where: { boqItemId: base.items.prelims.id } })).toBe(0);

      // The same rule again changes nothing and says so.
      const again = await patch(`${allocationsRoute()}/mapping-rules`, { rule: "not_applicable", itemIds: [base.items.prelims.id] });
      expect(again.body.data).toMatchObject({ matched: 1, updated: 0 });
      const invalid = await patch(`${allocationsRoute()}/mapping-rules`, { rule: "sometimes", itemIds: [base.items.prelims.id] });
      expect(invalid.status).toBe(400);
    });

    it("an item with an approved allocation cannot be moved to not_applicable until the allocation is rejected", async () => {
      const created = await allocate({ boqItemId: base.items.columns.id, activityId: base.activities.columns.id, quantity: 10 });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      await approveFlow(created.body.data.id);

      const refused = await patch(`${allocationsRoute()}/mapping-rules`, { rule: "not_applicable", itemIds: [base.items.columns.id] });
      expect([refused.status, refused.body?.error?.code]).toEqual([409, "MAPPING_RULE_HAS_APPROVED_ALLOCATION"]);
      expect(refused.body.error.details.boqItemIds).toEqual([base.items.columns.id]);
      expect((await prisma.boqItem.findUnique({ where: { id: base.items.columns.id } })).mappingRule).toBe("required");

      // optional is allowed with an approved row — only n/a is refused.
      const optional = await patch(`${allocationsRoute()}/mapping-rules`, { rule: "optional", itemIds: [base.items.columns.id] });
      expect([optional.status, optional.body.data.updated]).toEqual([200, 1]);
      const back = await patch(`${allocationsRoute()}/mapping-rules`, { rule: "required", itemIds: [base.items.columns.id] });
      expect(back.body.data.updated).toBe(1);
    });

    it("a BOQ upload reads the mapping_rule column: the dry run counts it, the upload applies it, and an approved item keeps its rule", async () => {
      const uploadProject = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-3 upload" } });
      const route = `/api/v1/projects/${uploadProject.id}/boq/upload`;
      const rows = [
        ["Item No", "Description", "Qty", "Unit", "Rate", "Mapping Rule"],
        ["1.1", "Concrete", 10, "m3", 100, ""],
        ["1.2", "Formwork", 20, "m2", 50, "optional"],
        ["P.1", "Preliminaries", 1, "sum", 5000, "N/A"],
      ];
      const preview = await uploadWorkbook(`${route}?dryRun=true`, rows);
      expect([preview.status, preview.body?.error]).toEqual([200, undefined]);
      expect(preview.body.data.mappingRules).toEqual({ required: 0, optional: 1, notApplicable: 1, unspecified: 1 });
      expect(await prisma.boqItem.count({ where: { projectId: uploadProject.id } })).toBe(0);

      const uploaded = await uploadWorkbook(route, rows);
      expect([uploaded.status, uploaded.body?.error]).toEqual([200, undefined]);
      expect(uploaded.body.data.mappingRuleWarnings).toEqual([]);
      const items = await prisma.boqItem.findMany({ where: { projectId: uploadProject.id, isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, mappingRule: true } });
      expect(items.map((i) => [i.code, i.mappingRule])).toEqual([["1.1", "required"], ["1.2", "optional"], ["P.1", "not_applicable"]]);

      const bad = await uploadWorkbook(`${route}?dryRun=true`, [rows[0], ["1.1", "Concrete", 10, "m3", 100, "sometimes"]]);
      expect([bad.status, bad.body?.error?.code]).toEqual([400, "BOQ_VALIDATION_FAILED"]);
      expect(bad.body.error.details.errors[0]).toMatchObject({ field: "mapping_rule" });

      // Approve an allocation on 1.1, then re-upload marking it n/a: the row
      // keeps "required" and the upload names it.
      const concrete = await prisma.boqItem.findFirst({ where: { projectId: uploadProject.id, code: "1.1" } });
      const activity = await createActivity({ name: "Pour", activityCode: "U1", duration: 2 }, uploadProject.id);
      const created = await post(`/api/v1/projects/${uploadProject.id}/activity-boq-allocations`, { boqItemId: concrete.id, activityId: activity.id, quantity: 10 });
      expect(created.status).toBe(201);
      await post(`/api/v1/projects/${uploadProject.id}/activity-boq-allocations/${created.body.data.id}/submit`, {});
      const approved = await post(`/api/v1/projects/${uploadProject.id}/activity-boq-allocations/${created.body.data.id}/approve`, {});
      expect(approved.status).toBe(200);
      const second = await uploadWorkbook(route, [rows[0], ["1.1", "Concrete", 10, "m3", 100, "not applicable"], rows[2], rows[3]]);
      expect([second.status, second.body?.error]).toEqual([200, undefined]);
      expect(second.body.data.mappingRuleWarnings).toEqual([expect.objectContaining({ code: "MAPPING_RULE_HAS_APPROVED_ALLOCATION", itemCode: "1.1", boqItemId: concrete.id })]);
      expect((await prisma.boqItem.findUnique({ where: { id: concrete.id } })).mappingRule).toBe("required");
    });
  });

  describe("validation (§70-§72)", () => {
    it("a unit mismatch and an activity outside the item's WBS subtree are warnings in the write response", async () => {
      // 1.1 is m3; the activity measures progress in m2.
      const method = await api.request("PUT", `/api/v1/projects/${project.id}/activities/${base.activities.columns.id}/progress-method`, {
        body: { method: "quantity", plannedQuantity: 100, quantityUnit: "m2" },
        headers: auth(),
      });
      expect([method.status, method.body?.error]).toEqual([200, undefined]);

      const created = await allocate({ boqItemId: base.items.concrete.id, activityId: base.activities.columns.id, quantity: 5 });
      expect([created.status, created.body?.error]).toEqual([201, undefined]);
      expect(created.body.data.warnings.map((w) => w.code).sort()).toEqual(["UNIT_MISMATCH", "WBS_OUTSIDE_SUBTREE"]);
      expect(created.body.data.warnings.find((w) => w.code === "UNIT_MISMATCH").details).toEqual({ itemUnit: "m3", activityUnit: "m2" });

      // The row inside the subtree, same unit family, has no warnings.
      const clean = await allocate({ boqItemId: base.items.concrete.id, activityId: base.activities.pour.id, quantity: 5 });
      expect([clean.status, clean.body?.error]).toEqual([201, undefined]);
      expect(clean.body.data.warnings).toEqual([]);
      // The warning row is a draft on a required item; reject it so the
      // coverage figures below are the ones the rules made.
      await post(`${allocationsRoute()}/${created.body.data.id}/submit`, {});
      const rejected = await post(`${allocationsRoute()}/${created.body.data.id}/reject`, { reason: "Wrong block" });
      expect(rejected.status).toBe(200);
      const cleanRejected = await post(`${allocationsRoute()}/${clean.body.data.id}/submit`, {});
      expect(cleanRejected.status).toBe(200);
      await post(`${allocationsRoute()}/${clean.body.data.id}/reject`, { reason: "Re-entered below" });
    });

    it("the location rule blocks a new row outside the item's location subtree and accepts a descendant", async () => {
      const outside = await allocate({ boqItemId: base.items.concrete.id, activityId: base.activities.pour.id, quantity: 5, locationId: base.blockB.id });
      expect([outside.status, outside.body?.error?.code]).toEqual([422, "LOCATION_OUTSIDE_SUBTREE"]);
      expect(await prisma.activityBoqAllocation.count({ where: { boqItemId: base.items.concrete.id, isActive: true } })).toBe(0);

      const inside = await allocate({ boqItemId: base.items.concrete.id, activityId: base.activities.pour.id, quantity: 5, locationId: base.levelA1.id });
      expect([inside.status, inside.body?.error]).toEqual([201, undefined]);
      expect(inside.body.data).toMatchObject({ locationId: base.levelA1.id, unitCode: "m3", warnings: [] });
      await post(`${allocationsRoute()}/${inside.body.data.id}/submit`, {});
      await post(`${allocationsRoute()}/${inside.body.data.id}/reject`, { reason: "Fixture only" });
    });
  });

  describe("basis derivation (§4)", () => {
    let draftByQuantity;
    let approvedByAmount;

    it("records what was typed and derives the other two figures: money 2 dp, quantity 3 dp", async () => {
      // 1.1: 100 m3 at 200.00 = 20,000.00.
      // Money arrives at two decimals (the API refuses a third); the
      // quantity it implies is kept to three.
      const byAmount = await allocate({ boqItemId: base.items.concrete.id, activityId: base.activities.pour.id, amount: 1234.56 });
      expect([byAmount.status, byAmount.body?.error]).toEqual([201, undefined]);
      expect(byAmount.body.data).toMatchObject({ basis: "amount", amount: 1234.56, quantity: 6.173, weight: expect.closeTo(6.1728, 4) });
      approvedByAmount = byAmount.body.data;

      const byQuantity = await allocate({ boqItemId: base.items.concrete.id, activityId: base.activities.fix.id, quantity: 12.3456 });
      expect([byQuantity.status, byQuantity.body?.error]).toEqual([201, undefined]);
      expect(byQuantity.body.data).toMatchObject({ basis: "quantity", quantity: 12.346, amount: 2469.2, weight: expect.closeTo(12.346, 3) });
      draftByQuantity = byQuantity.body.data;

      const byWeight = await allocate({ boqItemId: base.items.rebar.id, activityId: base.activities.fix.id, weight: 25 });
      expect([byWeight.status, byWeight.body?.error]).toEqual([201, undefined]);
      expect(byWeight.body.data).toMatchObject({ basis: "weight", weight: 25, quantity: 12.5, amount: 12500 });

      const nothing = await allocate({ boqItemId: base.items.rebar.id, activityId: base.activities.pour.id });
      expect([nothing.status, nothing.body?.error?.code]).toEqual([400, "INVALID_ALLOCATION_VALUES"]);
      const badBasis = await allocate({ boqItemId: base.items.rebar.id, activityId: base.activities.pour.id, amount: 10, basis: "guess" });
      expect(badBasis.status).toBe(400);

      // Editing one figure moves the basis to it and re-derives the rest.
      const edited = await patch(`${allocationsRoute()}/${byWeight.body.data.id}`, { amount: 10000 });
      expect([edited.status, edited.body?.error]).toEqual([200, undefined]);
      expect(edited.body.data).toMatchObject({ basis: "amount", amount: 10000, quantity: 10, weight: 20 });
    });

    it("a rate change re-derives draft rows and reports approved rows without rewriting them", async () => {
      await approveFlow(approvedByAmount.id);
      const before = await prisma.activityBoqAllocation.findUnique({ where: { id: approvedByAmount.id } });

      // 200.00 → 250.00 on the unlocked item.
      const changed = await patch(`/api/v1/projects/${project.id}/boq/items/${base.items.concrete.id}`, { rate: 250 });
      expect([changed.status, changed.body?.error]).toEqual([200, undefined]);
      expect(changed.body.data.item.rate).toBe(250);

      // The draft typed as a quantity keeps its quantity and gets the new amount.
      const draft = await prisma.activityBoqAllocation.findUnique({ where: { id: draftByQuantity.id } });
      expect([draft.status, draft.basis, draft.quantity, Number(draft.amount)]).toEqual(["draft", "quantity", 12.346, 3086.5]);
      expect(changed.body.data.rederivedAllocations).toEqual([expect.objectContaining({ allocationId: draftByQuantity.id, basis: "quantity" })]);

      // The approved row typed as an amount keeps its amount, and its quantity
      // now disagrees with the rate: reported, not rewritten.
      const approved = await prisma.activityBoqAllocation.findUnique({ where: { id: approvedByAmount.id } });
      expect([approved.status, Number(approved.amount), approved.quantity]).toEqual(["approved", Number(before.amount), before.quantity]);
      expect(changed.body.data.allocationWarnings).toEqual([
        expect.objectContaining({ code: "ALLOCATION_RATE_DRIFT", details: expect.objectContaining({ allocationId: approvedByAmount.id, status: "approved", expected: { quantity: 4.938, amount: 1234.56 } }) }),
      ]);
    });
  });

  describe("coverage (§69) and readiness", () => {
    it("BOQ total = approved allocated + unallocated + not applicable, per group and in total; readiness ignores n/a rows", async () => {
      const summary = await coverage();
      // 1.1 is now 100 × 250 = 25,000; 1.2 50,000; 2.1 10,000; prelims 30,000 + 5,000 n/a.
      expect(money(summary.totalBoqAmount)).toBe(120000);
      expect(money(summary.notApplicableAmount)).toBe(35000);
      expect(money(summary.allocatableBoqAmount)).toBe(85000);
      // Approved: 1,234.56 on 1.1 and 2,500 (10 m3 × 250) on 2.1.
      expect(money(summary.approvedAllocatedAmount)).toBe(3734.56);
      expect(money(summary.unallocatedAmount)).toBe(money(85000 - 3734.56));
      expectInvariant(summary);
      // 1.1 and 2.1 carry approved rows; 1.2 carries the weight-typed draft.
      expect(summary.counts).toEqual({ unmapped: 0, partial: 3, complete: 0, over: 0, notApplicable: 2 });
      expect(summary.items.find((i) => i.boqItemId === base.items.prelims.id)).toMatchObject({ mappingRule: "not_applicable", mappingState: "not_applicable", unallocatedAmount: 0, notApplicableAmount: 30000 });

      const bySection = await coverage("?groupBy=section");
      expect(bySection.groups.map((g) => g.label).sort()).toEqual(["Preliminaries", "Substructure", "Superstructure"]);
      for (const group of bySection.groups) expectInvariant(group);
      expect(bySection.groups.find((g) => g.label === "Preliminaries")).toMatchObject({ itemCount: 2, notApplicableAmount: 35000, unallocatedAmount: 0, coveragePct: 100 });
      expect(money(bySection.groups.reduce((sum, g) => sum + g.totalBoqAmount, 0))).toBe(120000);

      const byWbs = await coverage("?groupBy=wbs");
      expect(byWbs.groups.map((g) => g.label).sort()).toEqual(["A.1 · Foundations", "B · Superstructure", "Unassigned"]);
      const byLocation = await coverage("?groupBy=location");
      expect(byLocation.groups.find((g) => g.key === base.blockA.id)).toMatchObject({ itemCount: 1 });
      const badGroup = await get(`${allocationsRoute()}/coverage?groupBy=colour`);
      expect(badGroup.status).toBe(400);

      // Before the approvals existed nothing was allocated: the cutoff reads
      // the rows as they stood then.
      const dawn = await coverage(`?cutoffDate=${encodeURIComponent(new Date(project.createdAt.getTime() - 1000).toISOString())}`);
      expect([money(dawn.approvedAllocatedAmount), money(dawn.unallocatedAmount)]).toEqual([0, 85000]);
      expectInvariant(dawn);

      // Readiness: the allocation step reports the n/a bucket and judges the
      // allocatable value only.
      const readiness = await get(`/api/v1/projects/${project.id}/setup-readiness`);
      expect(readiness.status).toBe(200);
      const step = readiness.body.data.steps.find((s) => s.key === "boq_allocation");
      expect(step.counts).toMatchObject({ totalBoqAmount: 120000, notApplicableAmount: 35000, allocatableBoqAmount: 85000 });
      expect(step.blockers.map((b) => b.code)).toEqual(["UNALLOCATED_BOQ"]);
      expect(money(step.blockers[0].details.unallocatedAmount)).toBe(money(85000 - 3734.56));
    });

    it("a project whose only value is not applicable has nothing to allocate: the readiness step and the schedule check both pass", async () => {
      const naProject = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-3 n/a only", startDate: new Date("2026-01-05"), endDate: new Date("2026-06-30") } });
      const item = (await post(`/api/v1/projects/${naProject.id}/boq/items`, { code: "P.1", description: "Preliminaries", quantity: 1, unit: "sum", rate: 8000 })).body.data.item;
      const activity = await createActivity({ name: "Mobilise", activityCode: "M1", duration: 3 }, naProject.id);
      expect([item?.id, activity?.id].every(Boolean)).toBe(true);

      const blockedBefore = await get(`/api/v1/projects/${naProject.id}/setup-readiness`);
      const stepBefore = blockedBefore.body.data.steps.find((s) => s.key === "boq_allocation");
      expect(stepBefore.blockers.map((b) => b.code).sort()).toEqual(["NO_APPROVED_ALLOCATIONS", "UNALLOCATED_BOQ"]);

      const ruled = await patch(`/api/v1/projects/${naProject.id}/activity-boq-allocations/mapping-rules`, { rule: "not_applicable", itemIds: [item.id] });
      expect(ruled.status).toBe(200);
      // The schedule checks are only computed once a revision exists; a bare
      // draft revision is enough for the allocations check to be judged.
      await prisma.scheduleRevision.create({ data: { projectId: naProject.id, status: "draft", activityCount: 1 } });
      const after = await get(`/api/v1/projects/${naProject.id}/setup-readiness`);
      const stepAfter = after.body.data.steps.find((s) => s.key === "boq_allocation");
      expect(stepAfter.blockers).toEqual([]);
      expect(stepAfter.status).toBe("complete");
      const allocationsCheck = after.body.data.context?.scheduleReadiness?.checks?.find((c) => c.key === "allocations");
      expect(allocationsCheck).toMatchObject({ passed: true, details: expect.objectContaining({ notApplicableAmount: 8000, totalBoqAmount: 0 }) });
    });
  });

  describe("mapping import (§5)", () => {
    // 1.2/1.1 is free; 2.1/B100 is approved; 9.9 is nobody; P.1 is n/a;
    // 1,000 m3 of columns is far past the 40 m3 the item has.
    const rows = () => [
      ["boq_code", "activity_code", "quantity", "amount", "notes"],
      ["1.2", "1.1", 10, "", "ten tonnes"],
      ["2.1", "B100", "", 2500, ""],
      ["9.9", "B100", 1, "", "no such item"],
      ["P.1", "1.1", "", 100, "n/a item"],
      ["2.1", "1.1", 1000, "", "over capacity"],
    ];
    let batchId;

    it("the dry run reports matched, unmatched, not-applicable and breaching rows and writes nothing", async () => {
      const countBefore = await prisma.activityBoqAllocation.count({ where: { projectId: project.id } });
      const preview = await uploadWorkbook(`${allocationsRoute()}/import?dryRun=true`, rows());
      expect([preview.status, preview.body?.error]).toEqual([200, undefined]);
      expect(preview.body.data.dryRun).toBe(true);
      // 2.1/B100 already has an active (approved) row.
      expect(preview.body.data.summary).toMatchObject({ matched: 1, unmatched: 1, existing: 1, breaches: 1, notApplicable: 1, invalid: 0, created: 0 });
      expect(preview.body.data.matched[0]).toMatchObject({ boqCode: "1.2", activityCode: "1.1", basis: "quantity", quantity: 10, amount: 10000 });
      expect(preview.body.data.unmatched[0]).toMatchObject({ boqCode: "9.9", reason: "BOQ_ITEM_NOT_FOUND" });
      expect(preview.body.data.breaches[0]).toMatchObject({ boqCode: "2.1", reason: "ALLOCATION_QUANTITY_EXCEEDED" });
      expect(await prisma.activityBoqAllocation.count({ where: { projectId: project.id } })).toBe(countBefore);

      const ambiguous = await uploadWorkbook(`${allocationsRoute()}/import?dryRun=true`, [["boq_code", "activity_code", "quantity", "amount"], ["1.2", "A130", 1, 100]]);
      expect(ambiguous.body.data.invalid[0]).toMatchObject({ reason: "AMBIGUOUS_BASIS" });
      const headless = await uploadWorkbook(`${allocationsRoute()}/import?dryRun=true`, [["code", "qty"], ["1.2", 1]]);
      expect([headless.status, headless.body?.error?.code]).toEqual([400, "MAPPING_IMPORT_INVALID"]);
    });

    it("apply creates import drafts under one batch; the same file again creates nothing; undo rejects the drafts", async () => {
      const applied = await uploadWorkbook(`${allocationsRoute()}/import`, rows());
      expect([applied.status, applied.body?.error]).toEqual([201, undefined]);
      expect(applied.body.data.summary).toMatchObject({ matched: 1, created: 1, failed: 0 });
      batchId = applied.body.data.batchId;
      expect(batchId).toMatch(/^[0-9a-f-]{36}$/);
      const created = await prisma.activityBoqAllocation.findMany({ where: { importBatchId: batchId } });
      expect(created.map((r) => [r.status, r.source, r.suggestedBy, r.basis, r.quantity, Number(r.amount), r.notes])).toEqual([["draft", "import", "import", "quantity", 10, 10000, "ten tonnes"]]);

      const again = await uploadWorkbook(`${allocationsRoute()}/import`, rows());
      expect([again.status, again.body?.error]).toEqual([200, undefined]);
      expect(again.body.data.summary).toMatchObject({ matched: 0, existing: 2, created: 0 });
      expect(again.body.data.batchId).toBeNull();
      expect(await prisma.activityBoqAllocation.count({ where: { importBatchId: { not: null }, projectId: project.id } })).toBe(1);

      const undone = await post(`${allocationsRoute()}/import/${batchId}/undo`, {});
      expect([undone.status, undone.body?.error]).toEqual([200, undefined]);
      expect(undone.body.data).toMatchObject({ batchId, total: 1, rejected: 1, keptApproved: 0 });
      const rejected = await prisma.activityBoqAllocation.findMany({ where: { importBatchId: batchId } });
      expect(rejected.map((r) => [r.status, r.isActive, r.rejectedReason])).toEqual([["rejected", false, "Import batch undone"]]);
      const twice = await post(`${allocationsRoute()}/import/${batchId}/undo`, {});
      expect(twice.body.data).toMatchObject({ rejected: 0, alreadyRejected: 1 });
      const unknown = await post(`${allocationsRoute()}/import/00000000-0000-4000-8000-000000000000/undo`, {});
      expect([unknown.status, unknown.body?.error?.code]).toEqual([404, "MAPPING_IMPORT_BATCH_NOT_FOUND"]);

      // With the import gone the pair is free again: the file applies once more.
      const third = await uploadWorkbook(`${allocationsRoute()}/import`, rows());
      expect(third.body.data.summary.created).toBe(1);
      expect(third.body.data.batchId).not.toBe(batchId);
    });
  });

  describe("suggestions (§94-§95)", () => {
    it("ranks candidates by rule with the doc's confidences and never writes a row", async () => {
      // A commitment whose SOV line names a cost code and the columns
      // activity; the columns item carries that cost code.
      const costCode = await prisma.costCode.create({ data: { orgId: live.org.id, code: "03-30", name: "Cast-in-place concrete" } });
      const commitment = await prisma.commitment.create({ data: { orgId: live.org.id, projectId: project.id, number: 1, ref: "SC-001", title: "Concrete works", type: "subcontract" } });
      await prisma.commitmentSovLine.create({ data: { orgId: live.org.id, projectId: project.id, commitmentId: commitment.id, lineNumber: 1, description: "Columns", costCodeId: costCode.id, activityId: base.activities.columns.id } });
      await prisma.boqItem.update({ where: { id: base.items.columns.id }, data: { costCodeId: costCode.id } });
      // Two fresh items nothing is allocated to yet: a slab in Block A like
      // the pour, and a row whose code is the columns activity's code and
      // whose cost code is on the commitment's SOV line.
      const slab = await createItem({ code: "1.3", description: "Pour foundations", quantity: 10, unit: "m3", rate: 100 });
      await prisma.boqItem.update({ where: { id: slab.id }, data: { wbsNodeId: base.wbsA1.id, locationId: base.levelA1.id } });
      const coded = await createItem({ code: "B100", description: "Column concrete", quantity: 5, unit: "m3", rate: 100 });
      await prisma.boqItem.update({ where: { id: coded.id }, data: { costCodeId: costCode.id } });

      const countBefore = await prisma.activityBoqAllocation.count({ where: { projectId: project.id } });
      const response = await get(`${allocationsRoute()}/suggestions`);
      expect([response.status, response.body?.error]).toEqual([200, undefined]);
      const { byItem, suggestions } = response.body.data;
      expect(await prisma.activityBoqAllocation.count({ where: { projectId: project.id } })).toBe(countBefore);

      // 1.1 ↔ "1.1" (code) is approved and 1.1 ↔ A130 (same WBS node) holds
      // the quantity-typed draft: every candidate of the row is taken.
      const concrete = byItem.find((row) => row.boqItemId === base.items.concrete.id);
      expect(concrete.candidates).toEqual([]);

      // 1.3 "Pour foundations": WBS (0.8) beats the name (0.6); the location
      // bonus takes the pour to 0.85 over A130 by WBS alone at 0.8.
      const slabRow = byItem.find((row) => row.boqItemId === slab.id);
      expect(slabRow.candidates.map((c) => [c.activityCode, c.suggestedBy, c.confidence, c.reasons.sort()])).toEqual([
        ["1.1", "rule:wbs", 0.85, ["rule:location", "rule:name", "rule:wbs"]],
        ["A130", "rule:wbs", 0.8, ["rule:wbs"]],
      ]);

      // B100 ↔ B100: the code (0.9) names it, the cost code (0.7) agrees; no
      // WBS node on the item and no location on either side, so no more.
      const codedRow = byItem.find((row) => row.boqItemId === coded.id);
      expect(codedRow.candidates.map((c) => [c.activityCode, c.suggestedBy, c.confidence, c.reasons.sort()])).toEqual([
        ["B100", "rule:code", 0.9, ["rule:code", "rule:costcode"]],
      ]);

      // Rebar 1.2: A130 (name and WBS) holds the weight-typed draft and 1.1
      // (WBS) the import draft — nothing is left to suggest.
      const rebar = byItem.find((row) => row.boqItemId === base.items.rebar.id);
      expect(rebar.candidates).toEqual([]);
      // n/a rows get no candidates.
      expect(byItem.find((row) => row.boqItemId === base.items.prelims.id)).toMatchObject({ candidates: [], skipped: "not_applicable" });
      expect(suggestions.every((s) => s.confidence <= 0.99 && s.confidence > 0)).toBe(true);

      // Accepting one is an ordinary create carrying the provenance.
      const accepted = await allocate({ boqItemId: slab.id, activityId: base.activities.pour.id, quantity: 10, suggestedBy: "rule:wbs", confidence: 0.85 });
      expect([accepted.status, accepted.body?.error]).toEqual([201, undefined]);
      expect(accepted.body.data).toMatchObject({ suggestedBy: "rule:wbs", confidence: 0.85, source: "manual" });
      const gone = await get(`${allocationsRoute()}/suggestions?boqItemId=${slab.id}`);
      expect(gone.body.data.byItem[0].candidates.map((c) => c.activityCode)).toEqual(["A130"]);
      const badSource = await allocate({ boqItemId: slab.id, activityId: base.activities.fix.id, quantity: 1, suggestedBy: "guess" });
      expect(badSource.status).toBe(400);
    });
  });
});
