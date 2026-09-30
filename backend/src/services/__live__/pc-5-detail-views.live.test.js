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
 *   cost but none of the bill's figures (E1) — a change order that reaches
 *   the activity directly AND through an allocation link is listed without
 *   the link, and the lists say what they withheld — and is refused the BOQ
 *   detail;
 * - a BOQ reader whose template refuses the schedule sees a linked activity's
 *   name on the BOQ detail and none of its dates, float, criticality or progress;
 * - a subcontractor's person (party-scoped) gets no commitment, punch or
 *   lookahead rows from either detail, and no linked RFI or submittal its
 *   register would not list to them (party routing; RFI drafts);
 * - every authorised quantity (row and allocation) is the IPC cap's
 *   approved-variation rule for its own pair, as the single-pair query
 *   stated it, though the detail asks for every pair in one query;
 * - a list's total counts what a member without BOQ read is refused over
 *   every row, not over the first page (more than 50 change orders);
 * - the activity's EV is the allocation summary's, on amounts where a second
 *   formula over the total would round differently;
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
const commitmentService = require("../commitment.service");
const progressService = require("../progress.service");
const { toMoneyNumber } = require("../../utils/money");
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
  const orders = {};
  let subParty;
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

    const addMember = async (key, role, { noBoq = false, noSchedule = false } = {}) => {
      const member = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-pc5-${key.toLowerCase()}-${tag}@octapm-live.test`,
        role,
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      if (noBoq || noSchedule) {
        const module = noBoq ? "boq" : "schedule";
        const template = await prisma.permissionTemplate.create({
          data: { orgId: live.org.id, name: `LiveTest ${key}, no ${module} ${tag}`, baseRole: role, tools: { create: [{ module, level: "none" }] } },
        });
        await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id } });
      }
      members[key] = member;
    };
    await addMember("site", "site_engineer");
    await addMember("costNoBoq", "cost_controller", { noBoq: true });
    await addMember("qsNoSchedule", "qs", { noSchedule: true });
    // A subcontractor's person: no project assignment, an active member of
    // the project's subcontractor party — party-scoped access.
    const sub = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest sub",
      email: `live-pc5-sub-${tag}@octapm-live.test`,
      role: "site_engineer",
    });
    const company = await prisma.company.create({ data: { orgId: live.org.id, name: `LiveTest PC-5 Sub Co ${tag}` } });
    const party = await prisma.projectParty.create({ data: { projectId: project.id, companyId: company.id, role: "subcontractor" } });
    await prisma.projectPartyMember.create({ data: { projectPartyId: party.id, userId: sub.id } });
    members.sub = sub;
    subParty = party;

    // Two priced rows and two activities, through the API.
    for (const [key, body] of Object.entries({
      A: { code: "P5.1", description: "PC5SECRET concrete to slabs", quantity: 100, unit: "m3", rate: 10 },
      B: { code: "P5.2", description: "PC5SECRET formwork", quantity: 50, unit: "m2", rate: 20 },
      // Three rows of 0.05 on activity Z: at 50% each allocation earns
      // multiplyMoney(0.05, 0.5) — the summary's rule — which a formula over
      // Z's total (0.15 × 0.5) rounds differently.
      C1: { code: "P5.C1", description: "PC5SECRET sealant 1", quantity: 1, unit: "nr", rate: 0.05 },
      C2: { code: "P5.C2", description: "PC5SECRET sealant 2", quantity: 1, unit: "nr", rate: 0.05 },
      C3: { code: "P5.C3", description: "PC5SECRET sealant 3", quantity: 1, unit: "nr", rate: 0.05 },
    })) {
      const created = await api.post(at("/boq/items"), body, auth());
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
      rows[key] = created.body.data.item;
    }
    for (const [key, code] of [["X", "P5X"], ["Y", "P5Y"], ["Z", "P5Z"]]) {
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
      ["C1Z", rows.C1.id, acts.Z.id, 1],
      ["C2Z", rows.C2.id, acts.Z.id, 1],
      ["C3Z", rows.C3.id, acts.Z.id, 1],
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
    await prisma.activityProgress.create({
      data: { activityId: acts.Z.id, pctComplete: 50, status: "approved", source: "manual", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
    });
    await prisma.activityDependency.create({ data: { projectId: project.id, predecessorId: acts.X.id, successorId: acts.Y.id, relationshipType: "FS", lagDays: 2 } });
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
    // The certified writer of CostRecord.committed, as an executed commitment's own transition calls it.
    await commitmentService.recomputeCommitted({ orgId: live.org.id, projectId: project.id });
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
        allocationLinks: {
          create: [
            { projectId: project.id, allocationId: allocations.AX, boqItemId: rows.A.id, quantity: 5, amount: 50 },
            // Names B's allocation to X: BX's allowance, and no one else's.
            { projectId: project.id, allocationId: allocations.BX, boqItemId: rows.B.id, quantity: 3, amount: 60 },
          ],
        },
      },
    });
    // Not approved: counts toward no allowance.
    await prisma.changeOrder.create({
      data: {
        projectId: project.id,
        ref: `CO-PC5-PENDING-${tag}`,
        description: "LiveTest PC-5 pending order",
        value: 5,
        status: "pending",
        allocationLinks: { create: [{ projectId: project.id, allocationId: allocations.C1Z, boqItemId: rows.C1.id, quantity: 100, amount: 5 }] },
      },
    });
    // Reaches X twice: directly (activityId) and through an allocation link to AX.
    orders.dual = await prisma.changeOrder.create({
      data: {
        projectId: project.id,
        activityId: acts.X.id,
        ref: `CO-PC5-DUAL-${tag}`,
        description: "LiveTest PC-5 dual-matched order",
        value: 70,
        status: "approved",
        approvedAt: new Date("2026-02-06T12:00:00.000Z"),
        allocationLinks: { create: [{ projectId: project.id, allocationId: allocations.AX, boqItemId: rows.A.id, quantity: 7, amount: 70 }] },
      },
      include: { allocationLinks: { select: { id: true } } },
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
    expect(variation.quantity).toBe(12);
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
    expect(detail.sections.changes.changeOrders.total).toBe(2);

    // The linked activities, each linked back with its schedule and progress.
    const linked = detail.sections.mapping.allocations.items;
    expect(linked.map((entry) => entry.activity.id).sort()).toEqual([acts.X.id, acts.Y.id].sort());
    const ax = linked.find((entry) => entry.allocationId === allocations.AX);
    const perAllocation = await getApprovedVariationAllowance({ tx: prisma, projectId: project.id, allocationId: allocations.AX, boqItemId: rows.A.id });
    expect(ax.authorisedQuantity.value).toBe(60 + perAllocation.quantity);
    expect(ax.activity.pctComplete.value).toBe(50);
    const xRow = await prisma.activity.findUnique({ where: { id: acts.X.id }, select: { startDate: true, endDate: true, isCritical: true } });
    expect(ax.activity).toMatchObject({ startDate: xRow.startDate.toISOString(), endDate: xRow.endDate.toISOString(), isCritical: Boolean(xRow.isCritical) });
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
    const owner = await allocationService.buildAllocationSummary({ projectId: project.id, activityIds: [acts.X.id] });
    const method = await progressService.getProgressMethod({ orgId: live.org.id, projectId: project.id, activityId: acts.X.id });

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
    // recomputeCommitted wrote X's record: the SOV line on X (540).
    expect(costRecord).not.toBeNull();
    expect(toMoneyNumber(costRecord.committed)).toBe(540);
    expect(detail.sections.cost.committed.value).toBe(540);
    expect(detail.sections.cost.actual.value).toBe(toMoneyNumber(costRecord.actual));
    expect(detail.sections.mapping.earnedValue.value).toBe(owner.earnedValue);
    expect(detail.sections.progress.method).toEqual(method);
    expect(detail.sections.constraints.successors.map((entry) => [entry.activity.id, entry.relationshipType, entry.lagDays])).toEqual([[acts.Y.id, "FS", 2]]);
    expect(detail.sections.documents).toMatchObject({ allowed: true, attachments: { items: [] }, photos: { items: [] } });
    expect(detail.sections.certification.certifiedAmount.value).toBe(300);
    expect(detail.sections.changes.changeOrders.total).toBe(2);
    const dual = detail.sections.changes.changeOrders.items.find((entry) => entry.id === orders.dual.id);
    expect(dual.allocationLinks).toEqual([expect.objectContaining({ id: orders.dual.allocationLinks[0].id, quantity: 7, amount: 70 })]);
    expect(detail.sections.quality.ncrs.items).toHaveLength(1);
    expect(detail.sections.history.events.some((event) => event.kind === "allocation_approval")).toBe(true);
    for (const { path, figure } of figuresOf(detail.sections)) {
      if (!figure.notAvailable) expect([path, TRUTHS.has(figure.truth), typeof figure.basis]).toEqual([path, true, "string"]);
    }
  });

  it("every authorised quantity is the IPC cap's approved-variation rule, per allocation, as the single-pair query stated it", async () => {
    // The rule as getApprovedVariationAllowance's single-pair query stated it
    // before the detail asked for every pair at once: approved links naming
    // the allocation or the BOQ item.
    const oracle = async (where) => {
      const links = await prisma.changeOrderAllocationLink.findMany({
        where: { projectId: project.id, OR: Object.entries(where).map(([key, value]) => ({ [key]: value })), changeOrder: { status: "approved" } },
        select: { quantity: true },
      });
      return links.reduce((sum, entry) => sum + Number(entry.quantity), 0);
    };
    const authorised = {};
    for (const [route, key] of [
      [`/boq/items/${rows.A.id}/detail`, "boq"],
      [`/boq/items/${rows.B.id}/detail`, "boq"],
      [`/boq/items/${rows.C1.id}/detail`, "boq"],
      [`/activities/${acts.X.id}/detail`, "activity"],
      [`/activities/${acts.Z.id}/detail`, "activity"],
    ]) {
      const answer = await api.get(at(route), auth());
      expect([route, answer.status, answer.body?.error]).toEqual([route, 200, undefined]);
      for (const row of answer.body.data.sections.mapping.allocations.items) {
        const boqItemId = key === "boq" ? answer.body.data.id : row.boqItem.id;
        const allocation = await prisma.activityBoqAllocation.findUnique({ where: { id: row.allocationId }, select: { quantity: true } });
        expect([route, row.allocationId, row.authorisedQuantity.value]).toEqual([
          route,
          row.allocationId,
          Number(allocation.quantity) + (await oracle({ allocationId: row.allocationId, boqItemId })),
        ]);
        authorised[row.allocationId] = row.authorisedQuantity.value;
      }
      if (key === "boq") {
        const item = await prisma.boqItem.findUnique({ where: { id: answer.body.data.id }, select: { qty: true } });
        expect([route, answer.body.data.sections.quantities.authorised.value]).toEqual([route, Number(item.qty) + (await oracle({ boqItemId: answer.body.data.id }))]);
      }
    }
    // Each pair gets its own rows: AX and AY share the links naming A (5 + 7),
    // BX has its own (3), C1Z's pending link counts for nothing.
    expect([allocations.AX, allocations.AY, allocations.BX, allocations.C1Z].map((id) => authorised[id])).toEqual([72, 52, 53, 1]);
  });

  it("the activity's EV is the allocation summary's, per allocation, where a formula over the total rounds differently", async () => {
    const answer = await api.get(at(`/activities/${acts.Z.id}/detail`), auth());
    expect([answer.status, answer.body?.error]).toEqual([200, undefined]);
    const owner = await allocationService.buildAllocationSummary({ projectId: project.id, activityIds: [acts.Z.id] });
    const totals = (await allocationService.getApprovedActivityAllocationTotals({ projectId: project.id, activityIds: [acts.Z.id] })).get(acts.Z.id);
    // The case discriminates: a formula over the total does not equal the owner.
    const overTotal = toMoneyNumber(toMoneyNumber(totals.amount) * 0.5);
    expect(owner.earnedValue).not.toBe(overTotal);
    expect(answer.body.data.sections.mapping.earnedValue).toMatchObject({ value: owner.earnedValue, truth: "derived" });
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
    // The order reaching X only through an allocation link is gone; the
    // dual-matched one stays, without its link; both lists say what they withheld.
    expect(sections.changes.changeOrders.total).toBe(1);
    expect(sections.changes.changeOrders.boqWithheld).toEqual({ reason: expect.any(String) });
    expect(sections.changes.changeOrders.items).toEqual([
      expect.objectContaining({ id: orders.dual.id, boqWithheld: { keys: ["allocationLinks"], reason: expect.any(String) } }),
    ]);
    expect(Object.prototype.hasOwnProperty.call(sections.changes.changeOrders.items[0], "allocationLinks")).toBe(false);
    expect(sections.history.boqWithheld).toEqual({ reason: expect.any(String) });
    expect(sections.history.events.some((event) => event.kind === "allocation_approval")).toBe(false);
    const dualLink = orders.dual.allocationLinks[0].id;
    for (const secret of [rows.A.id, rows.B.id, allocations.AX, allocations.BX, dualLink, "P5.1", "P5.2", "PC5SECRET", "mappedQuantity", "generatedBudget", '"quantity":7', '"amount":70']) {
      expect([secret, activity.text.includes(secret)]).toEqual([secret, false]);
    }
    const item = await api.get(at(`/boq/items/${rows.A.id}/detail`), as(members.costNoBoq));
    expect(item.status).toBe(403);
  });

  it("beyond the first page, no total tells a member without BOQ read of a change order reached only through an allocation", async () => {
    // Its own row, activity and approved allocation: 51 orders name W
    // directly (the newest), 2 more reach it only through the allocation and
    // are the oldest, so both sit beyond the 50-row page.
    const row = await api.post(at("/boq/items"), { code: "P5.W", description: "PC5SECRET wall", quantity: 10, unit: "m2", rate: 3 }, auth());
    expect([row.status, row.body?.error]).toEqual([201, undefined]);
    const created = await api.post(
      at("/activities"),
      { engineerIds: [live.user.id], name: "Pour W", activityCode: "P5W", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06" },
      auth(),
    );
    expect([created.status, created.body?.error]).toEqual([201, undefined]);
    const w = created.body.data;
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: row.body.data.item.id, activityId: w.id, quantity: 10 }, auth());
    expect([allocation.status, allocation.body?.error]).toEqual([201, undefined]);
    for (const step of ["submit", "approve"]) {
      const moved = await api.post(at(`/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, auth());
      expect([step, moved.status, moved.body?.error]).toEqual([step, 200, undefined]);
    }
    const tag = Date.now();
    await prisma.changeOrder.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        projectId: project.id,
        activityId: w.id,
        ref: `CO-PC5-W${index}-${tag}`,
        description: "LiveTest PC-5 direct order",
        value: 1,
        status: "pending",
        createdAt: new Date(Date.UTC(2026, 2, 1, 0, index)),
      })),
    });
    const hidden = [];
    for (const day of [1, 2]) {
      hidden.push(
        await prisma.changeOrder.create({
          data: {
            projectId: project.id,
            ref: `CO-PC5-WALLOC${day}-${tag}`,
            description: "LiveTest PC-5 order through the allocation only",
            value: 1,
            status: "pending",
            createdAt: new Date(Date.UTC(2026, 0, day)),
            allocationLinks: { create: [{ projectId: project.id, allocationId: allocation.body.data.id, boqItemId: row.body.data.item.id, quantity: 1, amount: 3 }] },
          },
        }),
      );
    }

    const owner = await api.get(at(`/activities/${w.id}/detail`), auth());
    expect([owner.status, owner.body?.error]).toEqual([200, undefined]);
    expect([owner.body.data.sections.changes.changeOrders.items.length, owner.body.data.sections.changes.changeOrders.total]).toEqual([50, 53]);
    const approvals = await prisma.approvalWorkflowEvent.count({ where: { recordType: "activity_boq_allocation", recordId: allocation.body.data.id } });
    expect(approvals).toBeGreaterThan(0);

    const answer = await api.get(at(`/activities/${w.id}/detail`), as(members.costNoBoq));
    expect([answer.status, answer.body?.error]).toEqual([200, undefined]);
    const { changeOrders } = answer.body.data.sections.changes;
    // 51 reach W directly: the page is full and the total counts them only.
    expect([changeOrders.items.length, changeOrders.total]).toEqual([50, 51]);
    const { history } = answer.body.data.sections;
    expect(history.total).toBe(owner.body.data.sections.history.total - approvals - hidden.length);
    expect(history.events.length).toBe(Math.min(50, history.total));
    expect(history.events.some((event) => event.kind === "allocation_approval")).toBe(false);
    for (const order of hidden) {
      expect([order.id, answer.text.includes(order.id), answer.text.includes(order.ref)]).toEqual([order.id, false, false]);
    }
  });

  it("a BOQ reader who may not read the schedule sees a linked activity's name and none of its schedule", async () => {
    const activity = await api.get(at(`/activities/${acts.X.id}/detail`), as(members.qsNoSchedule));
    expect(activity.status).toBe(403);
    const item = await api.get(at(`/boq/items/${rows.A.id}/detail`), as(members.qsNoSchedule));
    expect([item.status, item.body?.error]).toEqual([200, undefined]);
    const linked = item.body.data.sections.mapping.allocations.items.map((entry) => entry.activity);
    expect(linked.map((entry) => entry.id).sort()).toEqual([acts.X.id, acts.Y.id].sort());
    for (const entry of linked) {
      expect(entry).toEqual({
        id: entry.id,
        code: expect.any(String),
        name: expect.any(String),
        href: null,
        schedule: { allowed: false, module: "schedule", reason: expect.any(String) },
      });
    }
    const mapping = JSON.stringify(item.body.data.sections.mapping);
    const xRow = await prisma.activity.findUnique({ where: { id: acts.X.id }, select: { startDate: true } });
    for (const secret of ["startDate", "endDate", "isCritical", "totalFloat", "pctComplete", "progressSource", xRow.startDate.toISOString()]) {
      expect([secret, mapping.includes(secret)]).toEqual([secret, false]);
    }
  });

  it("a subcontractor's person gets no commitment, punch or lookahead rows from either detail", async () => {
    const item = await api.get(at(`/boq/items/${rows.A.id}/detail`), as(members.sub));
    const activity = await api.get(at(`/activities/${acts.X.id}/detail`), as(members.sub));
    expect([item.status, activity.status]).toEqual([200, 200]);
    const partyRefusal = { allowed: false, module: expect.any(String), reason: expect.stringMatching(/limited to your company's records/) };
    expect(item.body.data.sections.commitments).toEqual({ ...partyRefusal, module: "commitment" });
    expect(activity.body.data.sections.quality.punchItems).toEqual({ ...partyRefusal, module: "punch" });
    expect(activity.body.data.sections.constraints.lookahead).toEqual({ ...partyRefusal, module: "lookahead" });
    expect(item.text.includes("SC-PC5-")).toBe(false);
    expect(activity.text.includes("SC-PC5-")).toBe(false);
  });

  it("a linked RFI or submittal is listed only where its own register lists it to the viewer", async () => {
    const tag = Date.now();
    const rfi = (key, data) => prisma.rfi.create({ data: { projectId: project.id, ref: `RFI-PC5-${key}-${tag}`, subject: `LiveTest PC-5 ${key}`, status: "open", ...data } });
    const submittal = (key, data) => prisma.submittal.create({ data: { projectId: project.id, ref: `SUB-PC5-${key}-${tag}`, title: `LiveTest PC-5 ${key}`, ...data } });
    const records = {
      rfiRouted: await rfi("ROUTED", { ownerPartyId: subParty.id }),
      rfiOther: await rfi("OTHER", {}),
      // Another member's draft: its register shows it to its author and manager only.
      rfiDraft: await rfi("DRAFT", { status: "draft", createdBy: members.site.id }),
      subRouted: await submittal("ROUTED", { reviewerPartyId: subParty.id }),
      subOther: await submittal("OTHER", {}),
      punch: await prisma.punchItem.create({ data: { orgId: live.org.id, projectId: project.id, number: 9001, ref: `PI-PC5-${tag}`, title: "LiveTest PC-5 punch", status: "open" } }),
    };
    const typeOf = { rfiRouted: "rfi", rfiOther: "rfi", rfiDraft: "rfi", subRouted: "submittal", subOther: "submittal", punch: "punch_item" };
    for (const [key, record] of Object.entries(records)) {
      await prisma.workflowActivityLink.create({ data: { projectId: project.id, recordType: typeOf[key], recordId: record.id, activityId: acts.X.id } });
    }
    const ids = Object.values(records).map((record) => record.id);
    const linkedIds = (body) => body.data.sections.documents.linkedRecords.map((entry) => entry.recordId).sort();
    // What the RFI and submittal registers themselves list to the same viewer.
    const registerIds = async (headers) => {
      const [rfis, submittals] = await Promise.all([api.get(at("/rfi"), headers), api.get(at("/submittals"), headers)]);
      expect([rfis.status, submittals.status]).toEqual([200, 200]);
      return [...rfis.body.data.rows, ...submittals.body.data.rows].map((row) => row.id).filter((id) => ids.includes(id)).sort();
    };

    // The owner: every RFI and submittal but another member's draft, and the punch item.
    const owner = await api.get(at(`/activities/${acts.X.id}/detail`), auth());
    expect([owner.status, owner.body?.error]).toEqual([200, undefined]);
    expect(linkedIds(owner.body)).toEqual([records.rfiRouted.id, records.rfiOther.id, records.subRouted.id, records.subOther.id, records.punch.id].sort());
    expect(linkedIds(owner.body).filter((id) => id !== records.punch.id)).toEqual(await registerIds(auth()));

    // The subcontractor's person may read RFIs and submittals: only those routed to their company.
    const sub = await api.get(at(`/activities/${acts.X.id}/detail`), as(members.sub));
    expect([sub.status, sub.body?.error]).toEqual([200, undefined]);
    expect(linkedIds(sub.body)).toEqual([records.rfiRouted.id, records.subRouted.id].sort());
    expect(linkedIds(sub.body)).toEqual(await registerIds(as(members.sub)));
    for (const hidden of [records.rfiOther.id, records.rfiDraft.id, records.subOther.id, records.punch.id]) {
      expect([hidden, sub.text.includes(hidden)]).toEqual([hidden, false]);
    }
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
