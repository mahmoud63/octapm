/**
 * PC-5: the BOQ item detail and the activity detail, proven against a real
 * API process and the real local Postgres.
 *
 * A LiveTest project is built through the API where the API builds it (the
 * BOQ rows, the activities, the allocations and their approval) and by
 * single-row writes where the flow is not what is being measured (approved
 * progress, an executed commitment with SOV lines, a certified IPC line, an
 * approved change order with an allocation link, an NCR). Then:
 *
 * - every figure the two detail endpoints state equals what the service that
 *   owns it returns (allocation summary, ipc.service
 *   getApprovedVariationAllowance, the cost record, the source rows), and
 *   carries its truth and basis;
 * - a site engineer gets no cost or IPC section ({ allowed: false });
 * - a cost controller whose template refuses the BOQ gets the activity's
 *   cost but none of the bill's figures (E1), and is refused the BOQ detail;
 * - another organisation's ids answer exactly as a random id does (404).
 *
 * Everything lives in throwaway "LiveTest <uuid>" organisations, dropped
 * afterwards.
 *
 *   npm run test:live -- src/services/__live__/pc-5-detail-views.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const allocationService = require("../activity-boq-allocation.service");
const { getApprovedVariationAllowance } = require("../ipc.service");
const { startApi } = require("./auth-live-kit");

const TRUTHS = new Set(["source", "derived", "projection"]);

// Every { value, truth, basis } in a payload: a stated figure carries a
// known truth and a basis; a figure not available says so and names its wave.
const figuresOf = (node, path = "", out = []) => {
  if (!node || typeof node !== "object") return out;
  if (Object.prototype.hasOwnProperty.call(node, "truth") && Object.prototype.hasOwnProperty.call(node, "value")) {
    out.push({ path, figure: node });
    return out;
  }
  for (const [key, value] of Object.entries(node)) figuresOf(value, `${path}.${key}`, out);
  return out;
};

liveDescribe("PC-5 BOQ item and activity detail", () => {
  let live;
  let other;
  let api;
  let project;
  let otherProject;
  const rows = {};
  const acts = {};
  const allocations = {};
  const members = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route, projectId = project.id) => `/api/v1/projects/${projectId}${route}`;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest PC-5 detail", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    otherProject = await prisma.project.create({
      data: { orgId: other.org.id, name: "LiveTest PC-5 other", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    const addMember = async (key, role, { noBoq = false } = {}) => {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-pc5-${key.toLowerCase()}-${tag}@octapm-live.test`,
        role,
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      if (noBoq) {
        const template = await prisma.permissionTemplate.create({
          data: { orgId: live.org.id, name: `LiveTest ${key}, no BOQ ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } },
        });
        await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id } });
      }
      members[key] = member;
    };
    await addMember("site", "site_engineer");
    await addMember("costNoBoq", "cost_controller", { noBoq: true });

    // Two priced rows and two activities, through the API.
    for (const [key, body] of Object.entries({
      A: { code: "P5.1", description: "PC5SECRET concrete to slabs", quantity: 100, unit: "m3", rate: 10 },
      B: { code: "P5.2", description: "PC5SECRET formwork", quantity: 50, unit: "m2", rate: 20 },
    })) {
      const created = await api.post(at("/boq/items"), body, auth());
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
      rows[key] = created.body.data.item;
    }
    for (const [key, code] of [["X", "P5X"], ["Y", "P5Y"]]) {
      const created = await api.post(
        at("/activities"),
        { engineerIds: [live.user.id], name: `Pour ${key}`, activityCode: code, duration: 5, startDate: "2026-02-02", endDate: "2026-02-06" },
        auth(),
      );
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
      acts[key] = created.body.data;
    }
    // A to two activities, X carrying two rows; each submitted and approved.
    for (const [key, boqItemId, activityId, quantity] of [
      ["AX", rows.A.id, acts.X.id, 60],
      ["AY", rows.A.id, acts.Y.id, 40],
      ["BX", rows.B.id, acts.X.id, 50],
    ]) {
      const created = await api.post(at("/activity-boq-allocations"), { boqItemId, activityId, quantity }, auth());
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
      allocations[key] = created.body.data.id;
      for (const step of ["submit", "approve"]) {
        const moved = await api.post(at(`/activity-boq-allocations/${allocations[key]}/${step}`), {}, auth());
        expect([key, step, moved.status, moved.body?.error]).toEqual([key, step, 200, undefined]);
      }
    }

    // Approved progress on X; an executed commitment with SOV lines; a
    // certified IPC line; an approved change order linked to A→X; an NCR on X.
    await prisma.activityProgress.create({
      data: { activityId: acts.X.id, pctComplete: 50, status: "approved", source: "manual", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
    });
    await prisma.commitment.create({
      data: {
        orgId: live.org.id,
        projectId: project.id,
        number: 1,
        ref: `SC-PC5-${tag}`,
        title: "LiveTest PC-5 subcontract",
        status: "executed",
        lines: {
          create: [
            { orgId: live.org.id, projectId: project.id, lineNumber: 1, description: "Slabs", boqItemId: rows.A.id, activityId: acts.X.id, qty: 60, rate: 9, amount: 540 },
            { orgId: live.org.id, projectId: project.id, lineNumber: 2, description: "Slabs Y", boqItemId: rows.A.id, activityId: acts.Y.id, qty: 40, rate: 9, amount: 360 },
          ],
        },
      },
    });
    await prisma.ipcItem.create({
      data: { projectId: project.id, boqItemId: rows.A.id, allocationId: allocations.AX, ipcPeriod: "P01", qty: 30, rate: 10, currentCert: 300, cumulativeCert: 300, status: "certified" },
    });
    await prisma.changeOrder.create({
      data: {
        projectId: project.id,
        ref: `CO-PC5-${tag}`,
        description: "LiveTest PC-5 extra slab",
        value: 50,
        status: "approved",
        approvedAt: new Date("2026-02-05T12:00:00.000Z"),
        allocationLinks: { create: [{ projectId: project.id, allocationId: allocations.AX, boqItemId: rows.A.id, quantity: 5, amount: 50 }] },
      },
    });
    await prisma.ncrRecord.create({ data: { projectId: project.id, activityId: acts.X.id, ref: `NCR-PC5-${tag}`, severity: "minor", description: "Honeycombing" } });
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  it("the BOQ item detail states each figure as the service that owns it does", async () => {
    const answer = await api.get(at(`/boq/items/${rows.A.id}/detail`), auth());
    expect([answer.status, answer.body?.error]).toEqual([200, undefined]);
    const detail = answer.body.data;
    const { summary } = await allocationService.listAllocations({ orgId: live.org.id, projectId: project.id, boqItemId: rows.A.id });
    const item = summary.items.find((entry) => entry.boqItemId === rows.A.id);
    const variation = await getApprovedVariationAllowance({ tx: prisma, projectId: project.id, boqItemId: rows.A.id });

    expect(detail.header).toMatchObject({ id: rows.A.id, code: "P5.1", unit: "m3" });
    expect(detail.sections.quantities.current).toMatchObject({ value: 100, truth: "source" });
    expect(detail.sections.quantities.original).toMatchObject({ value: 100, truth: "source" });
    expect(variation.quantity).toBe(5);
    expect(detail.sections.quantities.authorised).toMatchObject({ value: 100 + variation.quantity, truth: "derived" });
    expect(detail.sections.quantities.mapped.value).toBe(item.approvedAllocatedQuantity);
    expect(detail.sections.quantities.installed).toMatchObject({ value: null, notAvailable: true, wave: "PC-6" });
    expect(detail.sections.money.amount.value).toBe(1000);
    expect(detail.sections.money.approvedAllocated.value).toBe(item.approvedAllocatedAmount);
    expect(detail.sections.money.earnedValue.value).toBe(item.earnedValue);
    expect(detail.sections.money.earnedValue.basis).toMatch(/not the official reporting-cutoff EV/);
    expect(detail.sections.certification.certifiedQuantity.value).toBe(30);
    expect(detail.sections.certification.certifiedAmount.value).toBe(item.certifiedValue);
    expect(detail.sections.commitments.committed.value).toBe(900);
    expect(detail.sections.commitments.committed.basis).toMatch(/excludes variations/);
    expect(detail.sections.changes.changeOrders.total).toBe(1);

    // The linked activities, each linked back with its schedule and progress.
    const linked = detail.sections.mapping.allocations.items;
    expect(linked.map((entry) => entry.activity.id).sort()).toEqual([acts.X.id, acts.Y.id].sort());
    const ax = linked.find((entry) => entry.allocationId === allocations.AX);
    const perAllocation = await getApprovedVariationAllowance({ tx: prisma, projectId: project.id, allocationId: allocations.AX, boqItemId: rows.A.id });
    expect(ax.authorisedQuantity.value).toBe(60 + perAllocation.quantity);
    expect(ax.activity.pctComplete.value).toBe(50);
    expect(ax.activity.href).toBe(`/o/${live.org.slug || live.org.id}/projects/${project.id}/activities?recordId=${acts.X.id}&source=activity`);

    for (const { path, figure } of figuresOf(detail.sections)) {
      if (figure.notAvailable) expect([path, figure.wave]).toEqual([path, expect.stringMatching(/^PC-\d$/)]);
      else expect([path, TRUTHS.has(figure.truth), typeof figure.basis]).toEqual([path, true, "string"]);
    }
  });

  it("the activity detail states its allocations, budget and cost as their owners do", async () => {
    const answer = await api.get(at(`/activities/${acts.X.id}/detail`), auth());
    expect([answer.status, answer.body?.error]).toEqual([200, undefined]);
    const detail = answer.body.data;
    const totals = (await allocationService.getApprovedActivityAllocationTotals({ projectId: project.id, activityIds: [acts.X.id] })).get(acts.X.id);
    const activityRow = await prisma.activity.findUnique({ where: { id: acts.X.id }, select: { budget: true } });
    const costRecord = await prisma.costRecord.findFirst({ where: { projectId: project.id, activityId: acts.X.id } });

    expect(detail.header).toMatchObject({ id: acts.X.id, code: "P5X", name: "Pour X" });
    expect(detail.sections.mapping.mappedQuantity).toMatchObject({ value: 110, truth: "derived" });
    expect(detail.sections.mapping.mappedQuantity.value).toBe(totals.quantity);
    expect(detail.sections.mapping.budget.value).toBe(totals.amount);
    expect(detail.sections.mapping.generatedBudget).toMatchObject({ value: Number(activityRow.budget), truth: "projection" });
    expect(detail.sections.mapping.allocations.items.map((entry) => entry.boqItem.id).sort()).toEqual([rows.A.id, rows.B.id].sort());
    const ax = detail.sections.mapping.allocations.items.find((entry) => entry.allocationId === allocations.AX);
    const perAllocation = await getApprovedVariationAllowance({ tx: prisma, projectId: project.id, allocationId: allocations.AX, boqItemId: rows.A.id });
    expect(ax.authorisedQuantity.value).toBe(60 + perAllocation.quantity);
    expect(ax.boqItem.href).toBe(`/o/${live.org.slug || live.org.id}/projects/${project.id}/boq?recordId=${rows.A.id}&source=boq_item`);
    expect(detail.sections.progress.pctComplete).toMatchObject({ value: 50, truth: "source" });
    expect(detail.sections.cost.committed.value).toBe(costRecord ? Number(costRecord.committed) : 0);
    expect(detail.sections.cost.actual.value).toBe(costRecord ? Number(costRecord.actual) : 0);
    expect(detail.sections.certification.certifiedAmount.value).toBe(300);
    expect(detail.sections.changes.changeOrders.total).toBe(1);
    expect(detail.sections.quality.ncrs.items).toHaveLength(1);
    expect(detail.sections.history.events.some((event) => event.kind === "allocation_approval")).toBe(true);
    for (const { path, figure } of figuresOf(detail.sections)) {
      if (!figure.notAvailable) expect([path, TRUTHS.has(figure.truth), typeof figure.basis]).toEqual([path, true, "string"]);
    }
  });

  it("a site engineer gets no cost or IPC section", async () => {
    const activity = await api.get(at(`/activities/${acts.X.id}/detail`), as(members.site));
    expect([activity.status, activity.body?.error]).toEqual([200, undefined]);
    expect(activity.body.data.sections.cost).toEqual({ allowed: false, module: "cost", reason: expect.any(String) });
    expect(activity.body.data.sections.certification).toEqual({ allowed: false, module: "ipc", reason: expect.any(String) });
    const item = await api.get(at(`/boq/items/${rows.A.id}/detail`), as(members.site));
    expect([item.status, item.body?.error]).toEqual([200, undefined]);
    expect(item.body.data.sections.certification).toEqual({ allowed: false, module: "ipc", reason: expect.any(String) });
    expect(item.body.data.sections.commitments).toMatchObject({ allowed: false });
    expect(item.text.includes('"certifiedQuantity"')).toBe(false);
    expect(item.text.includes('"committed"')).toBe(false);
  });

  it("a cost controller without BOQ read gets the activity's cost and none of the bill (E1), and no BOQ detail", async () => {
    const activity = await api.get(at(`/activities/${acts.X.id}/detail`), as(members.costNoBoq));
    expect([activity.status, activity.body?.error]).toEqual([200, undefined]);
    const { sections } = activity.body.data;
    expect(sections.mapping).toEqual({ allowed: false, module: "boq", reason: expect.any(String) });
    expect(sections.certification).toEqual({ allowed: false, module: "boq", reason: expect.any(String) });
    expect(sections.cost.allowed).toBe(true);
    // The change order reached the activity only through an allocation link.
    expect(sections.changes.changeOrders).toMatchObject({ items: [], total: 0 });
    expect(sections.history.events.some((event) => event.kind === "allocation_approval")).toBe(false);
    for (const secret of [rows.A.id, rows.B.id, allocations.AX, allocations.BX, "P5.1", "P5.2", "PC5SECRET", "mappedQuantity", "generatedBudget"]) {
      expect([secret, activity.text.includes(secret)]).toEqual([secret, false]);
    }
    const item = await api.get(at(`/boq/items/${rows.A.id}/detail`), as(members.costNoBoq));
    expect(item.status).toBe(403);
  });

  it("another organisation's ids answer exactly as a random id does", async () => {
    const strip = (body) => ({ ...body, error: { ...body.error, requestId: undefined } });
    const outsider = { authorization: `Bearer ${other.token}` };
    for (const [route, code] of [
      [(id) => `/boq/items/${id}/detail`, "BOQ_ITEM_NOT_FOUND"],
      [(id) => `/activities/${id}/detail`, "ACTIVITY_NOT_FOUND"],
    ]) {
      const foreignId = code === "BOQ_ITEM_NOT_FOUND" ? rows.A.id : acts.X.id;
      const foreign = await api.get(at(route(foreignId), otherProject.id), outsider);
      const random = await api.get(at(route(crypto.randomUUID()), otherProject.id), outsider);
      expect([code, foreign.status, foreign.body.error.code]).toEqual([code, 404, code]);
      expect(strip(foreign.body)).toEqual(strip(random.body));
      // The owner's project is not reachable from the other organisation at all.
      const direct = await api.get(at(route(foreignId)), outsider);
      expect([code, direct.status]).toEqual([code, direct.status === 403 ? 403 : 404]);
      expect(direct.text.includes("PC5SECRET")).toBe(false);
    }
  });
});
