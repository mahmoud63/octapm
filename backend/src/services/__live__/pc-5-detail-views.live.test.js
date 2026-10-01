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
 * - a member who may read the schedule but not progress is refused an
 *   activity's approved % complete and its source on both details alike;
 * - a subcontractor's person (party-scoped) gets no commitment, punch or
 *   lookahead rows from either detail, and no linked RFI or submittal its
 *   register would not list to them (party routing; RFI drafts);
 * - the certified quantity and the certified amount on a BOQ item count the
 *   same rows: the allocation summary's certified basis, which the activity's
 *   certified amount stands on too (no line on a draft or inactive allocation);
 * - every authorised quantity (row and allocation) is the IPC cap's
 *   approved-variation rule for its own pair, as the single-pair query
 *   stated it, though the detail asks for every pair in one query;
 * - a list's total counts what a member without BOQ read is refused over
 *   every row, not over the first page (more than 50 change orders);
 * - the activity's EV is the allocation summary's, on amounts where a second
 *   formula over the total would round differently;
 * - the BOQ item's base-only commitment figure is baseCommitmentValue, "Base
 *   commitment value (excluding approved variations)" (R5-3): an approved
 *   commitment change order moves the activity's canonical committed cost
 *   (recomputeCommitted, unchanged) and never that figure; an SOV line on a
 *   commitment that is not executed or closed (a draft, a void one) is in
 *   neither — not in the figure, not in its list;
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
// known truth and a basis; a figure not available says so and names its wave
// (PC-5's shape) or the reason (PC-6's quantity figures: notAvailable: { reason }).
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
    // Reads the BOQ and the schedule, not progress.
    await addMember("procurement", "procurement");
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
    // Commitments that post nothing: a draft and a void one, each with an SOV
    // line naming row A and activity X. Neither is "on executed/closed
    // commitments", so neither may reach the base commitment value, its list
    // or X's committed cost.
    for (const [number, status, amount] of [[2, "draft", 70], [3, "void", 110]]) {
      await prisma.commitment.create({
        data: {
          orgId: live.org.id,
          projectId: project.id,
          number,
          ref: `SC-PC5-${tag}-${status}`,
          title: `LiveTest PC-5 ${status} subcontract`,
          status,
          lines: {
            create: [
              { orgId: live.org.id, projectId: project.id, lineNumber: 1, description: `Slabs (${status})`, boqItemId: rows.A.id, activityId: acts.X.id, qty: 10, rate: amount / 10, amount },
            ],
          },
        },
      });
    }
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
    // PC-6: the installed quantity is the quantity view's figure (Σ approved
    // quantity entries, none here); until the core track's module is merged
    // it is not available and says so — never a wave, never a zero in its place.
    const { installed } = detail.sections.quantities;
    expect([installed.truth, installed.unitCode]).toEqual(["derived", "m3"]);
    if (installed.value === null) expect(installed.notAvailable).toEqual({ reason: "PC-6 core pending" });
    else expect(installed).toMatchObject({ value: 0, unitMatch: null });
    expect(detail.sections.quantities.paid).toMatchObject({ truth: "projection", unitCode: "m3" });
    expect(detail.sections.quantities.certifiedQuantity).toMatchObject({ value: 30, truth: "source", unitCode: "m3", unitMatch: true });
    expect(detail.sections.quantities.committedQuantity).toMatchObject({ value: 100, truth: "derived", unitCode: "m3", label: "Committed quantity (excludes variations)" });
    expect(detail.sections.quantities.forecast).toMatchObject({ value: null, notAvailable: true, wave: "PC-7" });
    expect(detail.sections.money.amount.value).toBe(1000);
    expect(detail.sections.money.approvedAllocated.value).toBe(item.approvedAllocatedAmount);
    expect(detail.sections.money.earnedValue.value).toBe(item.earnedValue);
    expect(detail.sections.money.earnedValue.basis).toMatch(/not the official reporting-cutoff EV/);
    expect(detail.sections.certification.certifiedQuantity.value).toBe(30);
    expect(detail.sections.certification.certifiedAmount.value).toBe(item.certifiedValue);
    // R5-3: the base-only figure has its own name and key — no "committed" on the BOQ item.
    expect(detail.sections.commitments.baseCommitmentValue).toMatchObject({ value: 900, truth: "derived" });
    expect(detail.sections.commitments.baseCommitmentValue.basis).toMatch(/^Base commitment value \(excluding approved variations\): /);
    expect(detail.sections.commitments.baseCommitmentValue.basis).toMatch(/approved commitment change orders are not included/);
    expect(detail.sections.commitments).not.toHaveProperty("committed");
    // "…on executed/closed commitments": the draft (70) and the void (110)
    // commitments' lines name this row too, and count for nothing — 900, not
    // 970, 1,010 or 1,080 — and are not listed.
    const namingRowA = await prisma.commitmentSovLine.findMany({
      where: { projectId: project.id, boqItemId: rows.A.id },
      select: { amount: true, commitment: { select: { status: true } } },
    });
    expect(namingRowA.map((line) => [line.commitment.status, toMoneyNumber(line.amount)]).sort((a, b) => a[1] - b[1])).toEqual([
      ["draft", 70],
      ["void", 110],
      ["executed", 360],
      ["executed", 540],
    ]);
    expect(commitmentService.POSTING_STATUSES).toEqual(["executed", "closed"]);
    expect(detail.sections.commitments.lines.total).toBe(2);
    expect(detail.sections.commitments.lines.items.map((line) => [line.commitment.status, line.amount]).sort((a, b) => a[1] - b[1])).toEqual([
      ["executed", 360],
      ["executed", 540],
    ]);
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
      // PC-5's placeholders name a wave; PC-6's quantity figures say why (notAvailable: { reason }).
      if (figure.notAvailable) expect([path, figure.wave ?? figure.notAvailable?.reason]).toEqual([path, expect.stringMatching(/^PC-\d$|\S/)]);
      else expect([path, TRUTHS.has(figure.truth), typeof figure.basis]).toEqual([path, true, "string"]);
    }
  });

  it("the two certified figures on a BOQ item stand on the allocation summary's one basis", async () => {
    // A certified line on row A with no allocation: listed, and counted by neither figure.
    const unallocated = await prisma.ipcItem.create({
      data: { projectId: project.id, boqItemId: rows.A.id, ipcPeriod: "P02", qty: 4, rate: 10, currentCert: 40, cumulativeCert: 40, status: "certified" },
    });
    const answer = await api.get(at(`/boq/items/${rows.A.id}/detail`), auth());
    expect([answer.status, answer.body?.error]).toEqual([200, undefined]);
    const { certification } = answer.body.data.sections;
    const onBasis = await prisma.ipcItem.findMany({
      where: { ...allocationService.certifiedIpcItemWhere(project.id), boqItemId: rows.A.id },
      select: { qty: true, currentCert: true },
    });
    const { summary } = await allocationService.listAllocations({ orgId: live.org.id, projectId: project.id, boqItemId: rows.A.id });
    const item = summary.items.find((entry) => entry.boqItemId === rows.A.id);
    expect(certification.certifiedQuantity.value).toBe(onBasis.reduce((sum, entry) => sum + entry.qty, 0));
    expect(certification.certifiedAmount.value).toBe(item.certifiedValue);
    expect(onBasis.reduce((sum, entry) => sum + toMoneyNumber(entry.currentCert), 0)).toBe(item.certifiedValue);
    expect([certification.certifiedQuantity.value, certification.certifiedAmount.value]).toEqual([30, 300]);
    for (const figure of [certification.certifiedQuantity, certification.certifiedAmount]) {
      expect(figure.basis).toMatch(/allocation summary's certified basis/);
    }
    expect(certification.lines.items.map((line) => line.id)).toContain(unallocated.id);
    expect(certification.note).toEqual(expect.any(String));
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

  it("R5-3: an approved commitment change order moves the activity's committed cost, never the BOQ item's base commitment value", async () => {
    const readBoth = async () => {
      const [activity, item] = await Promise.all([api.get(at(`/activities/${acts.X.id}/detail`), auth()), api.get(at(`/boq/items/${rows.A.id}/detail`), auth())]);
      expect([activity.status, activity.body?.error, item.status, item.body?.error]).toEqual([200, undefined, 200, undefined]);
      const record = await prisma.costRecord.findFirst({ where: { projectId: project.id, activityId: acts.X.id }, select: { committed: true } });
      return { activityCommitted: activity.body.data.sections.cost.committed, base: item.body.data.sections.commitments.baseCommitmentValue, record: toMoneyNumber(record.committed) };
    };
    // The canonical total the certified writer keeps: SOV lines and approved CCO lines naming X on executed/closed commitments.
    const canonicalOnX = async () => {
      const sov = await prisma.commitmentSovLine.findMany({ where: { activityId: acts.X.id, commitment: { projectId: project.id, status: { in: commitmentService.POSTING_STATUSES } } }, select: { amount: true } });
      const ccos = await prisma.commitmentChangeOrder.findMany({ where: { projectId: project.id, status: "approved", commitment: { status: { in: commitmentService.POSTING_STATUSES } } }, select: { linesJson: true } });
      const ccoLines = ccos.flatMap((order) => (Array.isArray(order.linesJson) ? order.linesJson : [])).filter((line) => line?.activityId === acts.X.id);
      return [...sov.map((line) => toMoneyNumber(line.amount)), ...ccoLines.map((line) => Number(line.amount))].reduce((sum, amount) => Math.round((sum + amount) * 100) / 100, 0);
    };

    // Before: the activity's committed is the canonical 540 it always was (unchanged by R5-3).
    const before = await readBoth();
    expect(before.activityCommitted).toMatchObject({ value: 540, truth: "derived" });
    expect(before.activityCommitted.value).toBe(before.record);
    expect(before.activityCommitted.value).toBe(await canonicalOnX());
    expect(before.base.value).toBe(900);

    const commitment = await prisma.commitment.findFirst({ where: { projectId: project.id, number: 1 }, select: { id: true } });
    const cco = await prisma.commitmentChangeOrder.create({
      data: {
        orgId: live.org.id,
        projectId: project.id,
        commitmentId: commitment.id,
        number: 1,
        ref: `CCO-PC5-R53-${Date.now()}`,
        title: "LiveTest R5-3 approved variation",
        status: "approved",
        value: 25,
        approvedAt: new Date("2026-02-07T12:00:00.000Z"),
        linesJson: [{ description: "Extra slab edge", activityId: acts.X.id, amount: 25 }],
      },
    });
    try {
      await commitmentService.recomputeCommitted({ orgId: live.org.id, projectId: project.id });
      // After: the canonical total includes the approved variation; the BOQ item's base value does not move.
      const after = await readBoth();
      expect(after.activityCommitted.value).toBe(565);
      expect(after.activityCommitted.value).toBe(after.record);
      expect(after.activityCommitted.value).toBe(await canonicalOnX());
      expect(after.base).toEqual(before.base);
    } finally {
      await prisma.commitmentChangeOrder.delete({ where: { id: cco.id } });
      await commitmentService.recomputeCommitted({ orgId: live.org.id, projectId: project.id });
    }
    expect((await readBoth()).activityCommitted.value).toBe(540);
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

  it("a member who may read the schedule but not progress is refused an activity's progress on both details alike", async () => {
    const activity = await api.get(at(`/activities/${acts.X.id}/detail`), as(members.procurement));
    expect([activity.status, activity.body?.error]).toEqual([200, undefined]);
    const refused = activity.body.data.sections.progress;
    expect(refused).toEqual({ allowed: false, module: "progress", reason: expect.any(String) });
    const item = await api.get(at(`/boq/items/${rows.A.id}/detail`), as(members.procurement));
    expect([item.status, item.body?.error]).toEqual([200, undefined]);
    const linked = item.body.data.sections.mapping.allocations.items.map((entry) => entry.activity);
    expect(linked.map((entry) => entry.id).sort()).toEqual([acts.X.id, acts.Y.id].sort());
    for (const entry of linked) {
      // The schedule is theirs; the approved % complete and its source are not.
      expect(entry.startDate).toEqual(expect.any(String));
      expect(entry.progress).toEqual(refused);
      expect([entry.id, "pctComplete" in entry, "progressSource" in entry]).toEqual([entry.id, false, false]);
    }
    // A progress reader gets the figure on both.
    const owner = await api.get(at(`/boq/items/${rows.A.id}/detail`), auth());
    const ownerX = owner.body.data.sections.mapping.allocations.items.find((entry) => entry.activity.id === acts.X.id).activity;
    const ownerActivity = await api.get(at(`/activities/${acts.X.id}/detail`), auth());
    expect([ownerX.pctComplete.value, ownerX.progressSource, "progress" in ownerX]).toEqual([
      ownerActivity.body.data.sections.progress.pctComplete.value,
      ownerActivity.body.data.sections.progress.progressSource,
      false,
    ]);
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

  // Last in the file: its rows and lines move no figure an earlier test states.
  it("the activity's certified amount stands on the BOQ item's basis: no line on a draft or inactive allocation", async () => {
    const allocationTo = {};
    for (const [key, step] of [["E1", "approve"], ["E2", null], ["E3", "approve"]]) {
      const row = await api.post(at("/boq/items"), { code: `P5.${key}`, description: `PC5SECRET ${key}`, quantity: 10, unit: "nr", rate: 10 }, auth());
      expect([key, row.status, row.body?.error]).toEqual([key, 201, undefined]);
      const created = await api.post(at("/activity-boq-allocations"), { boqItemId: row.body.data.item.id, activityId: acts.Y.id, quantity: 5 }, auth());
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
      if (step) {
        for (const move of ["submit", step]) {
          const moved = await api.post(at(`/activity-boq-allocations/${created.body.data.id}/${move}`), {}, auth());
          expect([key, move, moved.status, moved.body?.error]).toEqual([key, move, 200, undefined]);
        }
      }
      allocationTo[key] = { id: created.body.data.id, boqItemId: row.body.data.item.id };
    }
    // E1 approved and active; E2 still a draft; E3 approved, then withdrawn.
    await prisma.activityBoqAllocation.update({ where: { id: allocationTo.E3.id }, data: { isActive: false } });
    const lines = {};
    for (const [key, cert] of [["E1", 40], ["E2", 30], ["E3", 20]]) {
      lines[key] = await prisma.ipcItem.create({
        data: { projectId: project.id, boqItemId: allocationTo[key].boqItemId, allocationId: allocationTo[key].id, ipcPeriod: "P03", qty: cert / 10, rate: 10, currentCert: cert, cumulativeCert: cert, status: "certified" },
      });
    }

    const answer = await api.get(at(`/activities/${acts.Y.id}/detail`), auth());
    expect([answer.status, answer.body?.error]).toEqual([200, undefined]);
    const { certification } = answer.body.data.sections;
    expect(certification.certifiedAmount.value).toBe(40);
    expect(certification.certifiedAmount.basis).toMatch(/allocation summary's certified basis/);
    expect(certification.lines.items.map((line) => line.id)).toEqual([lines.E1.id]);
    // The owner's rows, read with the owner's filter, for this activity.
    const onBasis = await prisma.ipcItem.findMany({
      where: { AND: [allocationService.certifiedIpcItemWhere(project.id), { allocation: { is: { activityId: acts.Y.id } } }] },
      select: { currentCert: true },
    });
    expect(onBasis.reduce((sum, entry) => sum + toMoneyNumber(entry.currentCert), 0)).toBe(40);
    // The BOQ item drawer agrees, row by row.
    for (const [key, expected] of [["E1", 40], ["E2", 0], ["E3", 0]]) {
      const item = await api.get(at(`/boq/items/${allocationTo[key].boqItemId}/detail`), auth());
      expect([key, item.status, item.body.data.sections.certification.certifiedAmount.value]).toEqual([key, 200, expected]);
    }
  });
});
