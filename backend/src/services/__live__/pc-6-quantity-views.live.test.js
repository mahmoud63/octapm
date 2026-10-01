/**
 * PC-6 quantity views, proven against a real API process and the real local
 * Postgres: five separate quantities per BOQ item and per activity, each
 * from its owner's rows, never merged, never summed across units.
 *
 * A LiveTest project is built through the API where the API builds it (the
 * BOQ rows, the activities, the allocations and their approval, the
 * quantity method) and by single-row writes where the flow is not what is
 * measured: QuantityProgressEntry rows seeded DIRECTLY in status approved
 * (and one submitted, which must never count), a certified IPC line and a
 * paid one on two certificates — one partially paid —, a receipt, an issue
 * and a return of stock, an executed commitment's SOV lines beside a draft
 * one's. Then:
 *
 * - installed = Σ approved entries only (35, not 535), in the row's unit;
 * - certified = Σ IpcItem.qty on the allocation summary's certified basis
 *   (the rows the certified amount sums), and the subcontract side "—";
 * - paid = certified × amountPaid ÷ netPayable per certificate — 30 × 0.25 +
 *   10 × 1 — labelled a projection, equal to the owner's payment state;
 * - received 40 and issued 25 − 5 = 20, in the inventory unit, unitMatch
 *   true for an "M3" item on an m3 row and false for rebar stocked in kg
 *   against a row in tonnes — stated in kg, never converted, never summed;
 * - committed = the executed commitment's lines only (100), labelled
 *   "Committed quantity (excludes variations)";
 * - a percent-method activity shows installed "—" (its approved entries
 *   notwithstanding), never % × quantity;
 * - certified > installed is a raw flag;
 * - a cost controller whose template refuses the BOQ gets no figure, with
 *   the reason, from either endpoint (and keeps the % complete); a site
 *   engineer (no IPC read) gets certified and paid as "—" with the module;
 * - another organisation's ids answer as a random id does (404);
 * - the BOQ item detail and the activity detail state the same figures.
 *
 * The core track's module (quantity-progress.service) may not be on this
 * branch yet: the API process then answers every installed figure "PC-6
 * core pending" and the in-process assertions hand the service a stand-in
 * that reads the seeded rows by the contract (Σ approved per item / per
 * activity). Once it is merged the real module answers both ways.
 *
 *   npm run test:live -- src/services/__live__/pc-6-quantity-views.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const allocationService = require("../activity-boq-allocation.service");
const commitmentService = require("../commitment.service");
const quantityViews = require("../quantity-views.service");
const { QUANTITY_FIGURES_WITHHELD } = require("../../utils/boq-figures");
const { toMoneyNumber } = require("../../utils/money");
const { startApi } = require("./auth-live-kit");

const num = (value) => Number(value);

let realCore = null;
try {
  // eslint-disable-next-line global-require
  realCore = require("../quantity-progress.service");
} catch (error) {
  if (!(error.code === "MODULE_NOT_FOUND" && /quantity-progress\.service/.test(error.message))) throw error;
}

// The contract, read from the seeded rows: Σ approved entries per item and
// per activity in the entry's unit. Used only while the real module is absent.
const standInCore = {
  installedByBoqItem: async ({ orgId, projectId, boqItemIds, cutoffDate = null }) => {
    const rows = await prisma.quantityProgressEntry.findMany({
      where: { orgId, projectId, status: "approved", boqItemId: { in: boqItemIds }, ...(cutoffDate ? { approvedAt: { lte: cutoffDate } } : {}) },
      select: { id: true, boqItemId: true, unitCode: true, quantity: true, approvedAt: true },
    });
    const map = new Map();
    for (const row of rows) {
      const bucket = map.get(row.boqItemId) || { quantity: 0, unitCode: row.unitCode, entries: [], lastApprovedAt: null };
      bucket.quantity += num(row.quantity);
      bucket.entries.push(row.id);
      if (!bucket.lastApprovedAt || row.approvedAt > bucket.lastApprovedAt) bucket.lastApprovedAt = row.approvedAt;
      map.set(row.boqItemId, bucket);
    }
    return map;
  },
  installedByActivity: async ({ orgId, projectId, activityIds, cutoffDate = null }) => {
    const rows = await prisma.quantityProgressEntry.findMany({
      where: { orgId, projectId, status: "approved", activityId: { in: activityIds }, ...(cutoffDate ? { approvedAt: { lte: cutoffDate } } : {}) },
      select: { activityId: true, boqItemId: true, unitCode: true, quantity: true },
    });
    const map = new Map();
    for (const activityId of activityIds) {
      const byItem = new Map();
      for (const row of rows.filter((entry) => entry.activityId === activityId)) {
        const bucket = byItem.get(row.boqItemId) || { boqItemId: row.boqItemId, unitCode: row.unitCode, quantity: 0 };
        bucket.quantity += num(row.quantity);
        byItem.set(row.boqItemId, bucket);
      }
      map.set(activityId, { installed: [...byItem.values()], asOf: new Date() });
    }
    return map;
  },
  plannedQuantityFor: async ({ projectId, activityId }) => {
    const rows = await prisma.activityBoqAllocation.findMany({
      where: { projectId, activityId, status: "approved", isActive: true },
      select: { quantity: true, boqItem: { select: { unitCode: true } } },
    });
    return rows.length
      ? { planned: rows.reduce((sum, row) => sum + num(row.quantity), 0), unitCode: rows[0].boqItem?.unitCode ?? null, basis: "approved_allocations" }
      : { planned: null, unitCode: null, basis: "none" };
  },
};
const core = realCore || standInCore;

liveDescribe("PC-6 quantity views", () => {
  let live;
  let other;
  let api;
  let project;
  let otherProject;
  const rows = {};
  const acts = {};
  const allocations = {};
  const members = {};
  const certs = {};
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const at = (route, projectId = project.id) => `/api/v1/projects/${projectId}${route}`;
  const can = () => true;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    const tag = Date.now();
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest PC-6 quantity views", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    otherProject = await prisma.project.create({
      data: { orgId: other.org.id, name: "LiveTest PC-6 other", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });

    const addMember = async (key, role, { noBoq = false } = {}) => {
      const member = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-pc6v-${key.toLowerCase()}-${tag}@octapm-live.test`, role });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      if (noBoq) {
        const template = await prisma.permissionTemplate.create({
          data: { orgId: live.org.id, name: `LiveTest ${key}, no boq ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } },
        });
        await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id } });
      }
      members[key] = member;
    };
    await addMember("site", "site_engineer");
    await addMember("costNoBoq", "cost_controller", { noBoq: true });

    for (const [key, body] of Object.entries({
      A: { code: "P6.1", description: "PC6SECRET concrete to slabs", quantity: 100, unit: "m3", rate: 10 },
      B: { code: "P6.2", description: "PC6SECRET rebar", quantity: 10, unit: "t", rate: 900 },
      C: { code: "P6.3", description: "PC6SECRET paint", quantity: 200, unit: "m2", rate: 3 },
    })) {
      const created = await api.post(at("/boq/items"), body, auth());
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
      rows[key] = created.body.data.item;
    }
    for (const [key, code] of [["X", "P6X"], ["Y", "P6Y"], ["P", "P6P"]]) {
      const created = await api.post(
        at("/activities"),
        { engineerIds: [live.user.id], name: `Pour ${key}`, activityCode: code, duration: 5, startDate: "2026-02-02", endDate: "2026-02-06" },
        auth(),
      );
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
      acts[key] = created.body.data;
    }
    // Row A to two activities; B to X; C to the percent-method activity P.
    for (const [key, boqItemId, activityId, quantity] of [
      ["AX", rows.A.id, acts.X.id, 60],
      ["AY", rows.A.id, acts.Y.id, 40],
      ["BX", rows.B.id, acts.X.id, 10],
      ["CP", rows.C.id, acts.P.id, 200],
    ]) {
      const created = await api.post(at("/activity-boq-allocations"), { boqItemId, activityId, quantity }, auth());
      expect([key, created.status, created.body?.error]).toEqual([key, 201, undefined]);
      allocations[key] = created.body.data.id;
      for (const step of ["submit", "approve"]) {
        const moved = await api.post(at(`/activity-boq-allocations/${allocations[key]}/${step}`), {}, auth());
        expect([key, step, moved.status, moved.body?.error]).toEqual([key, step, 200, undefined]);
      }
    }
    // X and Y are measured by quantity; P by percent (the default) with approved progress.
    for (const activity of [acts.X, acts.Y]) {
      const set = await api.request("PUT", at(`/activities/${activity.id}/progress-method`), { body: { method: "quantity" }, headers: auth() });
      expect([set.status, set.body?.error]).toEqual([200, undefined]);
    }
    await prisma.activityProgress.create({
      data: { activityId: acts.P.id, pctComplete: 50, status: "approved", source: "manual", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00.000Z") },
    });

    // Quantity progress entries, seeded directly: approved rows count, a submitted one never.
    const entry = (activityId, boqItemId, allocationId, quantity, unitCode, status, date) => ({
      orgId: live.org.id,
      projectId: project.id,
      activityId,
      boqItemId,
      allocationId,
      unitCode,
      quantity,
      date: new Date(date),
      source: "manual",
      status,
      clientRequestId: crypto.randomUUID(),
      createdBy: live.user.id,
      ...(status === "approved" ? { approvedBy: live.user.id, approvedAt: new Date(`${date}T12:00:00.000Z`) } : {}),
    });
    await prisma.quantityProgressEntry.createMany({
      data: [
        entry(acts.X.id, rows.A.id, allocations.AX, 25, "m3", "approved", "2026-02-03"),
        entry(acts.X.id, rows.A.id, allocations.AX, 10, "m3", "approved", "2026-02-05"),
        entry(acts.X.id, rows.A.id, allocations.AX, 500, "m3", "submitted", "2026-02-06"),
        entry(acts.Y.id, rows.A.id, allocations.AY, 20, "m3", "approved", "2026-02-04"),
        entry(acts.X.id, rows.B.id, allocations.BX, 3, "t", "approved", "2026-02-04"),
        // Approved entries on the percent-method activity: never an installed figure there.
        entry(acts.P.id, rows.C.id, allocations.CP, 5, "m2", "approved", "2026-02-04"),
      ],
    });

    // Two certificates: IPC-1 certified and a quarter paid, IPC-2 paid in full.
    certs.one = await prisma.ipcCertificate.create({
      data: { projectId: project.id, period: "IPC-1", status: "certified", totalCert: 1100, netPayable: 1000, amountPaid: 250, balanceDue: 750, paymentStatus: "partially_paid", certifiedAt: new Date("2026-02-10T12:00:00.000Z") },
    });
    certs.two = await prisma.ipcCertificate.create({
      data: { projectId: project.id, period: "IPC-2", status: "paid", totalCert: 550, netPayable: 500, amountPaid: 500, balanceDue: 0, paymentStatus: "paid", certifiedAt: new Date("2026-02-20T12:00:00.000Z") },
    });
    await prisma.ipcPayment.createMany({
      data: [
        { projectId: project.id, ipcCertificateId: certs.one.id, paymentReference: `PAY-PC6-1-${tag}`, paymentDate: new Date("2026-02-15"), amount: 250 },
        { projectId: project.id, ipcCertificateId: certs.two.id, paymentReference: `PAY-PC6-2-${tag}`, paymentDate: new Date("2026-02-25"), amount: 500 },
      ],
    });
    await prisma.ipcItem.createMany({
      data: [
        { projectId: project.id, boqItemId: rows.A.id, allocationId: allocations.AX, ipcCertificateId: certs.one.id, ipcPeriod: "IPC-1", qty: 30, rate: 10, currentCert: 300, cumulativeCert: 300, status: "certified", certDate: new Date("2026-02-10T12:00:00.000Z") },
        { projectId: project.id, boqItemId: rows.A.id, allocationId: allocations.AY, ipcCertificateId: certs.two.id, ipcPeriod: "IPC-2", qty: 10, rate: 10, currentCert: 100, cumulativeCert: 400, status: "paid", certDate: new Date("2026-02-20T12:00:00.000Z") },
        // Counted by neither: a draft line, and a certified line on no allocation.
        { projectId: project.id, boqItemId: rows.A.id, allocationId: allocations.AX, ipcCertificateId: certs.one.id, ipcPeriod: "IPC-1", qty: 99, rate: 10, currentCert: 990, cumulativeCert: 990, status: "draft" },
        { projectId: project.id, boqItemId: rows.A.id, allocationId: null, ipcCertificateId: certs.one.id, ipcPeriod: "IPC-1", qty: 4, rate: 10, currentCert: 40, cumulativeCert: 40, status: "certified", certDate: new Date("2026-02-10T12:00:00.000Z") },
      ],
    });

    // Stock: concrete in "M3" (the row's unit, spelt otherwise); rebar in kg against a row in tonnes.
    const warehouse = await prisma.warehouse.create({ data: { orgId: live.org.id, projectId: project.id, code: `W-PC6-${tag}`, name: "LiveTest PC-6 yard" } });
    const concrete = await prisma.inventoryItem.create({ data: { orgId: live.org.id, projectId: project.id, sku: `CONC-${tag}`, name: "Ready-mix", unit: "M3" } });
    const rebar = await prisma.inventoryItem.create({ data: { orgId: live.org.id, projectId: project.id, sku: `REBAR-${tag}`, name: "Rebar", unit: "kg" } });
    const movement = (item, type, quantity, boqItemId, activityId, occurredAt) => ({
      orgId: live.org.id, projectId: project.id, itemId: item.id, warehouseId: warehouse.id, type, quantity, boqItemId, activityId, performedBy: live.user.id, occurredAt: new Date(occurredAt),
    });
    await prisma.stockTransaction.createMany({
      data: [
        movement(concrete, "receipt", 40, rows.A.id, acts.X.id, "2026-02-01T08:00:00.000Z"),
        movement(concrete, "issue", -25, rows.A.id, acts.X.id, "2026-02-03T08:00:00.000Z"),
        movement(concrete, "return", 5, rows.A.id, acts.X.id, "2026-02-05T08:00:00.000Z"),
        // An adjustment is not a receipt, an issue or a return.
        movement(concrete, "adjust", 7, rows.A.id, acts.X.id, "2026-02-05T09:00:00.000Z"),
        movement(rebar, "receipt", 1500, rows.B.id, acts.X.id, "2026-02-02T08:00:00.000Z"),
      ],
    });

    // An executed commitment naming row A on X and on Y; a draft one naming it too.
    await prisma.commitment.create({
      data: {
        orgId: live.org.id, projectId: project.id, number: 1, ref: `SC-PC6-${tag}`, title: "LiveTest PC-6 subcontract", status: "executed",
        lines: {
          create: [
            { orgId: live.org.id, projectId: project.id, lineNumber: 1, description: "Slabs X", boqItemId: rows.A.id, activityId: acts.X.id, unit: "m3", qty: 60, rate: 9, amount: 540 },
            { orgId: live.org.id, projectId: project.id, lineNumber: 2, description: "Slabs Y", boqItemId: rows.A.id, activityId: acts.Y.id, unit: "m3", qty: 40, rate: 9, amount: 360 },
          ],
        },
      },
    });
    await prisma.commitment.create({
      data: {
        orgId: live.org.id, projectId: project.id, number: 2, ref: `SC-PC6-${tag}-draft`, title: "LiveTest PC-6 draft", status: "draft",
        lines: { create: [{ orgId: live.org.id, projectId: project.id, lineNumber: 1, description: "Slabs (draft)", boqItemId: rows.A.id, activityId: acts.X.id, unit: "m3", qty: 500, rate: 1, amount: 500 }] },
      },
    });
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

  it("states six separate figures for row A, each as its owner's rows say", async () => {
    const view = await quantityViews.getBoqItemQuantities({ orgId: live.org.id, projectId: project.id, itemId: rows.A.id, can, core });
    expect(view).toMatchObject({ kind: "boq_item", id: rows.A.id, unitCode: "m3", core: "present" });
    const { figures } = view;

    // installed: the approved entries on row A (25 + 10 on X, 20 on Y); the submitted 500 never counts.
    const approved = await prisma.quantityProgressEntry.findMany({ where: { projectId: project.id, boqItemId: rows.A.id, status: "approved" }, select: { quantity: true } });
    expect(approved.reduce((sum, row) => sum + num(row.quantity), 0)).toBe(55);
    expect(figures.installed).toMatchObject({ value: 55, truth: "derived", unitCode: "m3", unitMatch: true, entries: 3 });
    expect(figures.installed.basis).toMatch(/approved QuantityProgressEntry/);

    // certified: the allocation summary's certified basis — 30 + 10; not the draft 99, not the unallocated 4.
    const onBasis = await prisma.ipcItem.findMany({ where: { ...allocationService.certifiedIpcItemWhere(project.id), boqItemId: rows.A.id }, select: { qty: true } });
    expect(onBasis.reduce((sum, row) => sum + row.qty, 0)).toBe(40);
    expect(figures.certified).toMatchObject({ value: 40, truth: "source", unitCode: "m3", unitMatch: true, rows: 2 });
    expect(figures.certified.subcontract).toMatchObject({ value: null, notAvailable: { reason: expect.stringMatching(/SubPayAppLine/) } });

    // paid: per certificate, the owner's payment state — 30 × 250/1000 + 10 × 500/500.
    const one = await prisma.ipcCertificate.findUnique({ where: { id: certs.one.id }, select: { amountPaid: true, netPayable: true } });
    const paymentsOne = await prisma.ipcPayment.aggregate({ where: { ipcCertificateId: certs.one.id }, _sum: { amount: true } });
    expect(toMoneyNumber(paymentsOne._sum.amount)).toBe(toMoneyNumber(one.amountPaid));
    expect(figures.paid).toMatchObject({ value: 17.5, truth: "projection", unitCode: "m3", unitMatch: true });
    expect(figures.paid.certificates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ certificateId: certs.one.id, period: "IPC-1", certifiedQuantity: 30, amountPaid: toMoneyNumber(one.amountPaid), netPayable: toMoneyNumber(one.netPayable), paidShare: 0.25, paidQuantity: 7.5 }),
        expect.objectContaining({ certificateId: certs.two.id, period: "IPC-2", certifiedQuantity: 10, paidShare: 1, paidQuantity: 10 }),
      ]),
    );
    expect(figures.paid.basis).toMatch(/^Projection/);

    // received and issued: the receipt; the issue net of the return; the adjustment nowhere.
    expect(figures.received).toMatchObject({ value: 40, truth: "derived", unitCode: "m3", unitMatch: true, rows: 1 });
    expect(figures.issued).toMatchObject({ value: 20, truth: "derived", unitCode: "m3", unitMatch: true, components: { issued: 25, returned: 5 } });

    // committed: the executed commitment's lines (60 + 40), the draft's 500 excluded, labelled.
    expect(commitmentService.POSTING_STATUSES).toEqual(["executed", "closed"]);
    expect(figures.committed).toMatchObject({ value: 100, truth: "derived", unitCode: "m3", unitMatch: true, label: "Committed quantity (excludes variations)", commitments: 1 });

    // Five figures with five truths, kept apart; no sixth that nets two of them.
    expect(Object.keys(figures).sort()).toEqual(["certified", "committed", "installed", "issued", "paid", "received"]);
    expect(new Set([figures.installed.truth, figures.certified.truth, figures.paid.truth])).toEqual(new Set(["derived", "source", "projection"]));
    // installed 55 ≥ certified 40: no over-certification.
    expect(view.comparisons.certifiedOverInstalled).toMatchObject({ flag: false, certified: 40, installed: 55, unitCode: "m3" });
  });

  it("row B's rebar is stocked in kg: stated in kg with unitMatch false, never converted into tonnes", async () => {
    const view = await quantityViews.getBoqItemQuantities({ orgId: live.org.id, projectId: project.id, itemId: rows.B.id, can, core });
    expect(view.unitCode).toBe("t");
    expect(view.figures.received).toMatchObject({ value: 1500, unitCode: "kg", unitMatch: false });
    expect(view.figures.installed).toMatchObject({ value: 3, unitCode: "t", unitMatch: true });
    expect(view.figures.certified).toMatchObject({ value: 0, unitMatch: null });
  });

  it("the activity view folds X's items per unit and never across units; certified > installed is a raw flag", async () => {
    const view = await quantityViews.getActivityQuantities({ orgId: live.org.id, projectId: project.id, activityId: acts.X.id, can, core });
    expect(view).toMatchObject({ kind: "activity", id: acts.X.id, progress: { allowed: true, method: "quantity" } });
    expect(view.items.map((block) => block.boqItemId).sort()).toEqual([rows.A.id, rows.B.id].sort());
    const a = view.items.find((block) => block.boqItemId === rows.A.id);
    const b = view.items.find((block) => block.boqItemId === rows.B.id);
    // Scoped to X: A's installed is 35 (not Y's 20), its certified 30 (IPC-1 on AX, not AY's 10), its paid 7.5, committed 60.
    expect(a.figures.installed).toMatchObject({ value: 35, unitCode: "m3", unitMatch: true });
    expect(a.figures.certified).toMatchObject({ value: 30, unitCode: "m3" });
    expect(a.figures.paid).toMatchObject({ value: 7.5 });
    expect(a.figures.received).toMatchObject({ value: 40, unitCode: "m3" });
    expect(a.figures.issued).toMatchObject({ value: 20, components: { issued: 25, returned: 5 } });
    expect(a.figures.committed).toMatchObject({ value: 60, label: "Committed quantity (excludes variations)" });
    expect(a.comparisons.certifiedOverInstalled).toMatchObject({ flag: false, certified: 30, installed: 35 });
    expect(b.figures.installed).toMatchObject({ value: 3, unitCode: "t" });
    expect(b.figures.received).toMatchObject({ value: 1500, unitCode: "kg", unitMatch: false });
    // Activity level: installed is in m3 and t → not summed; received in m3 and kg → not summed.
    expect(view.figures.installed).toMatchObject({ value: null, notAvailable: { reason: quantityViews.MIXED_UNITS_REASON } });
    expect(view.figures.installed.byUnit).toEqual(expect.arrayContaining([{ unitCode: "m3", value: 35 }, { unitCode: "t", value: 3 }]));
    expect(view.figures.received.byUnit).toEqual(expect.arrayContaining([{ unitCode: "m3", value: 40 }, { unitCode: "kg", value: 1500 }]));
    expect(view.figures.committed).toMatchObject({ value: 60, unitCode: "m3" });
    expect(view.progress.planned).toMatchObject({ value: 70, truth: "derived", plannedBasis: "approved_allocations" });

    // Y: installed 20 against certified 10 (AY) — and, with a certified line pushed past it, the raw flag flips.
    const y = await quantityViews.getActivityQuantities({ orgId: live.org.id, projectId: project.id, activityId: acts.Y.id, can, core });
    expect(y.figures.installed).toMatchObject({ value: 20, unitCode: "m3" });
    expect(y.figures.certified).toMatchObject({ value: 10, unitCode: "m3" });
    expect(y.comparisons.certifiedOverInstalled).toMatchObject({ flag: false, certified: 10, installed: 20 });
    const extra = await prisma.ipcItem.create({
      data: { projectId: project.id, boqItemId: rows.A.id, allocationId: allocations.AY, ipcCertificateId: certs.two.id, ipcPeriod: "IPC-2", qty: 15, rate: 10, currentCert: 150, cumulativeCert: 550, status: "paid", certDate: new Date("2026-02-20T12:00:00.000Z") },
    });
    try {
      const over = await quantityViews.getActivityQuantities({ orgId: live.org.id, projectId: project.id, activityId: acts.Y.id, can, core });
      expect(over.comparisons.certifiedOverInstalled).toMatchObject({ flag: true, certified: 25, installed: 20, unitCode: "m3" });
      // A flag only: nothing else in the answer names an exception or a change event.
      expect(over.comparisons.certifiedOverInstalled.basis).toMatch(/PC-7b/);
      expect(Object.keys(over)).toEqual(expect.not.arrayContaining(["exceptions", "changeEvents", "forecastQuantity"]));
      expect(Object.keys(over.comparisons)).toEqual(["certifiedOverInstalled"]);
    } finally {
      await prisma.ipcItem.delete({ where: { id: extra.id } });
    }
  });

  it("a percent-method activity shows installed as a dash, its approved entries notwithstanding, never % × quantity", async () => {
    const view = await quantityViews.getActivityQuantities({ orgId: live.org.id, projectId: project.id, activityId: acts.P.id, can, core });
    expect(view.progress).toMatchObject({ method: "percent", pctComplete: { value: 50 } });
    expect(view.figures.installed).toMatchObject({ value: null, notAvailable: { reason: quantityViews.PERCENT_METHOD_REASON } });
    const c = view.items.find((block) => block.boqItemId === rows.C.id);
    expect(c.figures.installed).toMatchObject({ value: null, notAvailable: { reason: quantityViews.PERCENT_METHOD_REASON } });
    expect(c.figures.installed.value).not.toBe(100);
    expect(view.progress.planned).toMatchObject({ value: null, notAvailable: { reason: quantityViews.PERCENT_METHOD_REASON } });
    expect(view.comparisons.certifiedOverInstalled.flag).toBeNull();
  });

  it("cutoffDate bounds installed, certified and the stock movements", async () => {
    const view = await quantityViews.getBoqItemQuantities({ orgId: live.org.id, projectId: project.id, itemId: rows.A.id, can, core, cutoffDate: "2026-02-04T23:59:59.000Z" });
    expect(view.cutoffDate).toBe("2026-02-04T23:59:59.000Z");
    // Entries approved on or before the 4th: 25 (X, 3rd) + 20 (Y, 4th); the 10 of the 5th is after.
    expect(view.figures.installed).toMatchObject({ value: 45 });
    // No certificate is certified by then.
    expect(view.figures.certified).toMatchObject({ value: 0 });
    // The receipt (1st) and the issue (3rd), not the return (5th).
    expect(view.figures.received).toMatchObject({ value: 40 });
    expect(view.figures.issued).toMatchObject({ value: 25, components: { issued: 25, returned: 0 } });
  });

  it("the two endpoints answer a BOQ reader the service's figures, and a member without BOQ read none of them", async () => {
    const item = await api.get(at(`/boq/items/${rows.A.id}/quantities`), auth());
    expect([item.status, item.body?.error]).toEqual([200, undefined]);
    expect(item.body.data).toMatchObject({ kind: "boq_item", id: rows.A.id, unitCode: "m3" });
    expect(item.body.data.figures.certified).toMatchObject({ value: 40, truth: "source" });
    expect(item.body.data.figures.paid).toMatchObject({ value: 17.5, truth: "projection" });
    expect(item.body.data.figures.received).toMatchObject({ value: 40 });
    expect(item.body.data.figures.issued).toMatchObject({ value: 20 });
    expect(item.body.data.figures.committed).toMatchObject({ value: 100 });
    if (realCore) expect(item.body.data.figures.installed).toMatchObject({ value: 55, unitCode: "m3" });
    else expect(item.body.data.figures.installed).toMatchObject({ value: null, notAvailable: { reason: "PC-6 core pending" } });

    const activity = await api.get(at(`/activities/${acts.X.id}/quantities?cutoffDate=2026-12-31`), auth());
    expect([activity.status, activity.body?.error]).toEqual([200, undefined]);
    expect(activity.body.data).toMatchObject({ kind: "activity", id: acts.X.id, cutoffDate: "2026-12-31T00:00:00.000Z" });
    expect(activity.body.data.items.find((block) => block.boqItemId === rows.A.id).figures.certified).toMatchObject({ value: 30 });
    const bad = await api.get(at(`/activities/${acts.X.id}/quantities?cutoffDate=yesterday`), auth());
    expect(bad.status).toBe(400);

    // A cost controller whose template refuses the BOQ: the item view is the id only; the
    // activity view keeps its identity and % complete and withholds every figure, with the reason.
    const noBoqItem = await api.get(at(`/boq/items/${rows.A.id}/quantities`), as(members.costNoBoq));
    expect(noBoqItem.status).toBe(403);
    const noBoqActivity = await api.get(at(`/activities/${acts.P.id}/quantities`), as(members.costNoBoq));
    expect([noBoqActivity.status, noBoqActivity.body?.error]).toEqual([200, undefined]);
    const withheld = noBoqActivity.body.data;
    expect(withheld).toMatchObject({ kind: "activity", id: acts.P.id, withheld: true, reason: QUANTITY_FIGURES_WITHHELD });
    expect(withheld.progress).toMatchObject({ allowed: true, method: "percent", pctComplete: { value: 50 } });
    for (const key of ["installed", "certified", "paid", "received", "issued", "committed"]) {
      expect(withheld.figures[key]).toMatchObject({ value: null, truth: null, withheld: true, notAvailable: { reason: QUANTITY_FIGURES_WITHHELD } });
    }
    expect(withheld.items).toEqual({ withheld: true, reason: QUANTITY_FIGURES_WITHHELD });
    expect(noBoqActivity.text).not.toMatch(/PC6SECRET|byItem|"value":(40|17\.5|100|200)\b/);

    // A site engineer reads the BOQ and the schedule, not IPC or commitments: those figures say so.
    const site = await api.get(at(`/boq/items/${rows.A.id}/quantities`), as(members.site));
    expect([site.status, site.body?.error]).toEqual([200, undefined]);
    expect(site.body.data.figures.certified).toMatchObject({ value: null, module: "ipc", notAvailable: { reason: expect.stringMatching(/permission/) } });
    expect(site.body.data.figures.paid).toMatchObject({ value: null, module: "ipc" });
    expect(site.body.data.figures.committed).toMatchObject({ value: null, module: "commitment", label: "Committed quantity (excludes variations)" });
    expect(site.body.data.figures.received).toMatchObject({ value: 40 });
  });

  it("the BOQ item detail and the activity detail state the same figures", async () => {
    const detail = await api.get(at(`/boq/items/${rows.A.id}/detail`), auth());
    expect([detail.status, detail.body?.error]).toEqual([200, undefined]);
    const { quantities, certification } = detail.body.data.sections;
    expect(quantities.certifiedQuantity).toMatchObject({ value: 40, truth: "source", unitCode: "m3", unitMatch: true });
    expect(certification.certifiedQuantity.value).toBe(quantities.certifiedQuantity.value);
    expect(quantities.paid).toMatchObject({ value: 17.5, truth: "projection" });
    expect(quantities.received).toMatchObject({ value: 40 });
    expect(quantities.issued).toMatchObject({ value: 20 });
    expect(quantities.committedQuantity).toMatchObject({ value: 100, label: "Committed quantity (excludes variations)" });
    expect(quantities.forecast).toMatchObject({ value: null, notAvailable: true, wave: "PC-7" });
    if (realCore) expect(quantities.installed).toMatchObject({ value: 55, unitCode: "m3" });
    else expect(quantities.installed).toMatchObject({ value: null, notAvailable: { reason: "PC-6 core pending" } });

    const activity = await api.get(at(`/activities/${acts.P.id}/detail`), auth());
    expect([activity.status, activity.body?.error]).toEqual([200, undefined]);
    expect(activity.body.data.sections.progress.installedQuantity).toMatchObject({ value: null, notAvailable: { reason: quantityViews.PERCENT_METHOD_REASON } });
    const x = await api.get(at(`/activities/${acts.X.id}/detail`), auth());
    if (realCore) expect(x.body.data.sections.progress.installedQuantity).toMatchObject({ value: null, notAvailable: { reason: quantityViews.MIXED_UNITS_REASON } });
    else expect(x.body.data.sections.progress.installedQuantity).toMatchObject({ value: null, notAvailable: { reason: "PC-6 core pending" } });
    const xNoBoq = await api.get(at(`/activities/${acts.X.id}/detail`), as(members.costNoBoq));
    expect(xNoBoq.body.data.sections.progress.installedQuantity).toMatchObject({ value: null, withheld: true, notAvailable: { reason: QUANTITY_FIGURES_WITHHELD } });
  });

  it("another organisation's ids answer exactly as a random id does", async () => {
    const random = crypto.randomUUID();
    for (const [route, headers] of [
      [at(`/boq/items/${rows.A.id}/quantities`, otherProject.id), { authorization: `Bearer ${other.token}` }],
      [at(`/boq/items/${random}/quantities`), auth()],
      [at(`/activities/${acts.X.id}/quantities`, otherProject.id), { authorization: `Bearer ${other.token}` }],
      [at(`/activities/${random}/quantities`), auth()],
    ]) {
      const answer = await api.get(route, headers);
      expect([route, answer.status]).toEqual([route, 404]);
    }
    await expect(quantityViews.getBoqItemQuantities({ orgId: other.org.id, projectId: project.id, itemId: rows.A.id, can, core })).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
  });
});
