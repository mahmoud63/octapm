/**
 * PC-6 quantity views: five quantities with five truths, each from its
 * owner's rows, never merged, never summed across units; the core adapter;
 * the percent-method dash; the raw certified > installed flag; module gates;
 * tenant 404s; and the BOQ withholding of the whole of it.
 */
const ORG = "org-A";
const PROJECT = "project-1";
const ITEM = "item-1";
const ITEM_2 = "item-2";
const ACT = "act-1";

const rows = {
  projects: [{ id: PROJECT, orgId: ORG }],
  items: [
    { id: ITEM, projectId: PROJECT, code: "1.1", ref: null, description: "Concrete", unit: "m3", unitCode: "m3", qty: 100, sortOrder: 1 },
    { id: ITEM_2, projectId: PROJECT, code: "1.2", ref: null, description: "Rebar", unit: "t", unitCode: null, qty: 10, sortOrder: 2 },
  ],
  ipcItems: [
    // Counted: certified and paid lines on an approved, active allocation.
    { id: "ipc-1", projectId: PROJECT, boqItemId: ITEM, allocationId: "al-1", ipcCertificateId: "cert-1", qty: 30, status: "certified", allocation: { status: "approved", isActive: true, activityId: ACT } },
    { id: "ipc-2", projectId: PROJECT, boqItemId: ITEM, allocationId: "al-1", ipcCertificateId: "cert-2", qty: 10, status: "paid", allocation: { status: "approved", isActive: true, activityId: ACT } },
    // Not counted: a draft line, a line on no allocation, a line on a rejected allocation.
    { id: "ipc-3", projectId: PROJECT, boqItemId: ITEM, allocationId: "al-1", ipcCertificateId: "cert-1", qty: 99, status: "draft", allocation: { status: "approved", isActive: true, activityId: ACT } },
    { id: "ipc-4", projectId: PROJECT, boqItemId: ITEM, allocationId: null, ipcCertificateId: "cert-1", qty: 99, status: "certified", allocation: null },
    { id: "ipc-5", projectId: PROJECT, boqItemId: ITEM, allocationId: "al-9", ipcCertificateId: "cert-1", qty: 99, status: "certified", allocation: { status: "rejected", isActive: true, activityId: ACT } },
  ],
  certificates: [
    { id: "cert-1", projectId: PROJECT, period: "IPC-1", status: "certified", paymentStatus: "partially_paid", amountPaid: 250, netPayable: 1000 },
    { id: "cert-2", projectId: PROJECT, period: "IPC-2", status: "paid", paymentStatus: "paid", amountPaid: 500, netPayable: 500 },
  ],
  stock: [
    { id: "st-1", projectId: PROJECT, boqItemId: ITEM, activityId: ACT, type: "receipt", quantity: 40, item: { id: "inv-1", unit: "M3" } },
    { id: "st-2", projectId: PROJECT, boqItemId: ITEM, activityId: ACT, type: "issue", quantity: -25, item: { id: "inv-1", unit: "M3" } },
    { id: "st-3", projectId: PROJECT, boqItemId: ITEM, activityId: ACT, type: "return", quantity: 5, item: { id: "inv-1", unit: "M3" } },
    { id: "st-4", projectId: PROJECT, boqItemId: ITEM, activityId: ACT, type: "adjust", quantity: 7, item: { id: "inv-1", unit: "M3" } },
    // Row 2's rebar is stocked in kg: a figure in kg, not in t, with unitMatch false.
    { id: "st-5", projectId: PROJECT, boqItemId: ITEM_2, activityId: ACT, type: "receipt", quantity: 1500, item: { id: "inv-2", unit: "kg" } },
  ],
  sov: [
    { id: "sov-1", projectId: PROJECT, boqItemId: ITEM, activityId: ACT, qty: 60, unit: "m3", commitmentId: "cm-1", commitment: { status: "executed" } },
    { id: "sov-2", projectId: PROJECT, boqItemId: ITEM, activityId: ACT, qty: 20, unit: "m3", commitmentId: "cm-2", commitment: { status: "closed" } },
    { id: "sov-3", projectId: PROJECT, boqItemId: ITEM, activityId: ACT, qty: 500, unit: "m3", commitmentId: "cm-3", commitment: { status: "draft" } },
  ],
  methods: [{ projectId: PROJECT, activityId: ACT, method: "quantity" }],
  allocations: [
    { id: "al-1", projectId: PROJECT, activityId: ACT, boqItemId: ITEM, status: "approved", isActive: true },
    { id: "al-2", projectId: PROJECT, activityId: ACT, boqItemId: ITEM_2, status: "approved", isActive: true },
  ],
  progress: [{ id: "ap-1", activityId: ACT, status: "approved", pctComplete: 40, approvedAt: new Date("2026-03-01T00:00:00Z"), source: "manual" }],
};

const CERTIFIED_WHERE = { projectId: PROJECT, allocationId: { not: null }, status: { in: ["certified", "paid"] }, allocation: { is: { status: "approved", isActive: true } } };
const POSTING = ["executed", "closed"];

const matchesCertifiedBasis = (row) =>
  row.allocationId != null && ["certified", "paid"].includes(row.status) && row.allocation?.status === "approved" && row.allocation?.isActive === true;

const filterIpc = (where) => {
  const parts = where.AND || [where];
  const basis = parts[0];
  expect(basis).toMatchObject(CERTIFIED_WHERE);
  const inIds = parts.find((part) => part.boqItemId)?.boqItemId?.in;
  const activityId = parts.find((part) => part.allocation?.is?.activityId)?.allocation.is.activityId;
  return rows.ipcItems.filter(
    (row) => matchesCertifiedBasis(row) && (!inIds || inIds.includes(row.boqItemId)) && (!activityId || row.allocation?.activityId === activityId),
  );
};

const mockPrisma = {
  project: { findFirst: jest.fn(async ({ where }) => rows.projects.find((row) => row.id === where.id && row.orgId === where.orgId) || null) },
  boqItem: {
    findFirst: jest.fn(async ({ where }) => rows.items.find((row) => row.id === where.id && row.projectId === where.projectId) || null),
    findMany: jest.fn(async ({ where }) => rows.items.filter((row) => where.id.in.includes(row.id) && row.projectId === where.projectId)),
  },
  ipcItem: { findMany: jest.fn(async ({ where }) => filterIpc(where)) },
  ipcCertificate: { findMany: jest.fn(async ({ where }) => rows.certificates.filter((row) => where.id.in.includes(row.id))) },
  stockTransaction: {
    findMany: jest.fn(async ({ where }) =>
      rows.stock.filter(
        (row) =>
          where.type.in.includes(row.type) &&
          (!where.boqItemId || where.boqItemId.in.includes(row.boqItemId)) &&
          (!where.activityId || row.activityId === where.activityId),
      ),
    ),
  },
  commitmentSovLine: {
    findMany: jest.fn(async ({ where }) => {
      expect(where.commitment.status.in).toEqual(POSTING);
      return rows.sov.filter(
        (row) =>
          where.commitment.status.in.includes(row.commitment.status) &&
          (!where.boqItemId || where.boqItemId.in.includes(row.boqItemId)) &&
          (!where.activityId || row.activityId === where.activityId),
      );
    }),
  },
  activity: { findFirst: jest.fn(async ({ where }) => (where.id === ACT && where.projectId === PROJECT ? { id: ACT, name: "Pour", activityCode: "A1", p6ActivityId: null } : null)) },
  activityProgressMethod: { findFirst: jest.fn(async ({ where }) => rows.methods.find((row) => row.activityId === where.activityId) || null) },
  activityBoqAllocation: { findMany: jest.fn(async ({ where }) => rows.allocations.filter((row) => row.activityId === where.activityId && row.status === "approved" && row.isActive)) },
  activityProgress: { findFirst: jest.fn(async ({ where }) => rows.progress.find((row) => row.activityId === where.activityId) || null) },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../activity-boq-allocation.service", () => ({
  certifiedIpcItemWhere: (projectId) => ({ projectId, allocationId: { not: null }, status: { in: ["certified", "paid"] }, allocation: { is: { status: "approved", isActive: true } } }),
}));
jest.mock("../commitment.service", () => ({ POSTING_STATUSES: Object.freeze(["executed", "closed"]) }));
jest.mock("../progress.service", () => ({
  normalizeMethod: (method) => ({ percent_complete: "percent", milestone: "weighted_milestone" }[String(method || "percent").toLowerCase()] || String(method || "percent").toLowerCase()),
}));

const service = require("../quantity-views.service");
const { withheldActivityQuantities, withheldBoqItemQuantities, withheldActivityDetail, QUANTITY_FIGURES_WITHHELD } = require("../../utils/boq-figures");

// A stand-in for the core track's contract: Σ approved entries, as the live
// test seeds them. The service never sums entries itself.
const coreWith = (entries) => ({
  installedByBoqItem: jest.fn(async ({ boqItemIds }) => {
    const map = new Map();
    for (const entry of entries.filter((row) => row.status === "approved" && boqItemIds.includes(row.boqItemId))) {
      const bucket = map.get(entry.boqItemId) || { quantity: 0, unitCode: entry.unitCode, entries: [], lastApprovedAt: null };
      bucket.quantity += entry.quantity;
      bucket.entries.push(entry);
      map.set(entry.boqItemId, bucket);
    }
    return map;
  }),
  installedByActivity: jest.fn(async ({ activityIds }) => {
    const map = new Map();
    for (const activityId of activityIds) {
      const mine = entries.filter((row) => row.status === "approved" && row.activityId === activityId);
      const byItem = new Map();
      for (const entry of mine) byItem.set(entry.boqItemId, { boqItemId: entry.boqItemId, unitCode: entry.unitCode, quantity: (byItem.get(entry.boqItemId)?.quantity || 0) + entry.quantity });
      map.set(activityId, { installed: [...byItem.values()], asOf: new Date("2026-03-02T00:00:00Z") });
    }
    return map;
  }),
  plannedQuantityFor: jest.fn(async () => ({ planned: 100, unitCode: "m3", basis: "approved_allocations" })),
});

const ENTRIES = [
  { boqItemId: ITEM, activityId: ACT, unitCode: "m3", quantity: 25, status: "approved" },
  { boqItemId: ITEM, activityId: ACT, unitCode: "m3", quantity: 10, status: "approved" },
  { boqItemId: ITEM, activityId: ACT, unitCode: "m3", quantity: 500, status: "submitted" },
];

const allow = () => true;
const only = (...modules) => (name) => modules.includes(name);

describe("quantity views (PC-6)", () => {
  beforeEach(() => {
    rows.methods[0].method = "quantity";
  });

  it("states five separate figures from their owners' rows, each with truth, basis, unit and unit match", async () => {
    const view = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, can: allow, core: coreWith(ENTRIES) });
    expect(view).toMatchObject({ kind: "boq_item", id: ITEM, unitCode: "m3", core: "present", keys: ["installed", "certified", "paid", "received", "issued", "committed"] });
    const { figures } = view;
    // installed: Σ approved entries only (25 + 10; the submitted 500 never counts)
    expect(figures.installed).toMatchObject({ value: 35, truth: "derived", unitCode: "m3", unitMatch: true, entries: 2 });
    // certified: the two lines on the certified basis (30 + 10); draft, unallocated and rejected-allocation lines are not counted
    expect(figures.certified).toMatchObject({ value: 40, truth: "source", unitCode: "m3", unitMatch: true, rows: 2 });
    expect(figures.certified.subcontract).toMatchObject({ value: null, notAvailable: { reason: service.SUBCONTRACT_CERTIFIED_REASON } });
    // paid: per certificate — 30 × (250 ÷ 1000) + 10 × (500 ÷ 500) = 7.5 + 10
    expect(figures.paid).toMatchObject({ value: 17.5, truth: "projection", unitCode: "m3", unitMatch: true });
    expect(figures.paid.certificates).toEqual([
      expect.objectContaining({ certificateId: "cert-1", period: "IPC-1", certifiedQuantity: 30, paidShare: 0.25, paidQuantity: 7.5 }),
      expect.objectContaining({ certificateId: "cert-2", period: "IPC-2", certifiedQuantity: 10, paidShare: 1, paidQuantity: 10 }),
    ]);
    expect(figures.paid.basis).toMatch(/^Projection/);
    // received: the receipt (40), in the inventory unit "M3" which normalises to m3; the adjust is not a receipt
    expect(figures.received).toMatchObject({ value: 40, truth: "derived", unitCode: "m3", unitMatch: true, rows: 1 });
    // issued: |−25| net of the 5 returned, both parts stated
    expect(figures.issued).toMatchObject({ value: 20, truth: "derived", unitCode: "m3", unitMatch: true, components: { issued: 25, returned: 5 } });
    // committed: the executed and the closed commitments' lines (60 + 20), the draft's 500 excluded, labelled
    expect(figures.committed).toMatchObject({ value: 80, truth: "derived", unitCode: "m3", unitMatch: true, label: "Committed quantity (excludes variations)", commitments: 2 });
    expect(figures.committed.basis).toMatch(/excludes variations|variations are excluded/);
    // Nothing is netted against another column: received − issued is nowhere, certified − installed is only a flag.
    expect(Object.keys(figures).sort()).toEqual(["certified", "committed", "installed", "issued", "paid", "received"]);
    expect(view.comparisons.certifiedOverInstalled).toMatchObject({ flag: true, certified: 40, installed: 35, unitCode: "m3" });
    expect(view.comparisons.certifiedOverInstalled.basis).toMatch(/PC-7b/);
    for (const figure of Object.values(figures)) {
      expect(["source", "derived", "projection"]).toContain(figure.truth);
      expect(typeof figure.basis).toBe("string");
      expect(figure).toHaveProperty("unitCode");
      expect(figure).toHaveProperty("unitMatch");
    }
  });

  it("a figure in another unit is stated in that unit with unitMatch false, never converted; two units are never summed", async () => {
    const view = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM_2, can: allow, core: coreWith([]) });
    // Row 2 has no unitCode of its own: its typed unit "t" is the row's unit.
    expect(view.unitCode).toBe("t");
    expect(view.figures.received).toMatchObject({ value: 1500, unitCode: "kg", unitMatch: false });
    expect(view.figures.installed).toMatchObject({ value: 0, unitMatch: null });

    rows.stock.push({ id: "st-6", projectId: PROJECT, boqItemId: ITEM_2, activityId: ACT, type: "receipt", quantity: 2, item: { id: "inv-3", unit: "t" } });
    try {
      const mixed = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM_2, can: allow, core: coreWith([]) });
      expect(mixed.figures.received).toMatchObject({ value: null, notAvailable: { reason: service.MIXED_UNITS_REASON } });
      expect(mixed.figures.received.byUnit).toEqual(
        expect.arrayContaining([
          { unitCode: "kg", value: 1500, unitMatch: false },
          { unitCode: "t", value: 2, unitMatch: true },
        ]),
      );
    } finally {
      rows.stock.pop();
    }
  });

  it("without the core track's module every installed figure is not available and says so; nothing else is", async () => {
    const view = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, can: allow, core: null });
    expect(view.core).toBe("pending");
    expect(view.figures.installed).toMatchObject({ value: null, truth: "derived", unitCode: "m3", notAvailable: { reason: "PC-6 core pending" } });
    expect(view.figures.certified.value).toBe(40);
    expect(view.comparisons.certifiedOverInstalled).toMatchObject({ flag: null, reason: "PC-6 core pending" });
  });

  it("an activity not measured by quantity has no installed figure — a dash, never % complete × quantity", async () => {
    rows.methods[0].method = "percent";
    const core = coreWith(ENTRIES);
    const view = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: allow, core });
    expect(view.progress).toMatchObject({ allowed: true, method: "percent", pctComplete: { value: 40, truth: "source" } });
    expect(view.figures.installed).toMatchObject({ value: null, notAvailable: { reason: service.PERCENT_METHOD_REASON }, method: "percent" });
    expect(view.items.find((block) => block.boqItemId === ITEM).figures.installed).toMatchObject({ value: null, notAvailable: { reason: service.PERCENT_METHOD_REASON } });
    expect(view.progress.planned).toMatchObject({ value: null, notAvailable: { reason: service.PERCENT_METHOD_REASON } });
    expect(core.installedByActivity).not.toHaveBeenCalled();
    expect(view.comparisons.certifiedOverInstalled.flag).toBeNull();
    // The other figures are the activity's: certified 40 on its allocation's lines, committed 80.
    expect(view.figures.certified).toMatchObject({ value: 40, unitCode: "m3" });
    expect(view.figures.committed).toMatchObject({ value: 80, label: "Committed quantity (excludes variations)" });
  });

  it("a quantity-method activity folds its items' figures into one unit and lists each item's own", async () => {
    const core = coreWith(ENTRIES);
    const view = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: allow, core });
    expect(view.figures.installed).toMatchObject({ value: 35, unitCode: "m3", unitMatch: true });
    expect(view.figures.installed.byItem.map((entry) => [entry.boqItemId, entry.value])).toEqual([[ITEM, 35], [ITEM_2, 0]]);
    expect(view.progress.planned).toMatchObject({ value: 100, truth: "derived", unitCode: "m3", plannedBasis: "approved_allocations" });
    // received is in m3 on row 1 and in kg on row 2: not summed across units.
    expect(view.figures.received).toMatchObject({ value: null, notAvailable: { reason: service.MIXED_UNITS_REASON } });
    expect(view.figures.received.byUnit).toEqual(expect.arrayContaining([{ unitCode: "m3", value: 40 }, { unitCode: "kg", value: 1500 }]));
    expect(view.comparisons.certifiedOverInstalled).toMatchObject({ flag: true, certified: 40, installed: 35 });
    expect(core.installedByActivity).toHaveBeenCalledTimes(1);
    expect(view.items.map((block) => block.boqItemId)).toEqual([ITEM, ITEM_2]);
  });

  it("a figure whose module the viewer may not read says so; a party-scoped member gets no committed quantity", async () => {
    const view = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, can: only("inventory"), core: coreWith(ENTRIES) });
    expect(view.figures.certified).toMatchObject({ value: null, notAvailable: { reason: expect.stringMatching(/ipc module/) }, module: "ipc" });
    expect(view.figures.paid).toMatchObject({ value: null, module: "ipc" });
    expect(view.figures.committed).toMatchObject({ value: null, module: "commitment", label: "Committed quantity (excludes variations)" });
    expect(view.figures.received.value).toBe(40);
    expect(view.figures.installed.value).toBe(35);
    const party = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, can: allow, partyScoped: true, core: coreWith(ENTRIES) });
    expect(party.figures.committed).toMatchObject({ value: null, module: "commitment" });
    expect(party.figures.certified.value).toBe(40);
    const noProgress = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: only("ipc", "inventory", "commitment"), core: coreWith(ENTRIES) });
    expect(noProgress.progress).toMatchObject({ allowed: false, module: "progress" });
    expect(noProgress.figures.installed.value).toBe(35);
  });

  it("another organisation's project, item or activity answers as a missing one does", async () => {
    await expect(service.getBoqItemQuantities({ orgId: "org-B", projectId: PROJECT, itemId: ITEM, can: allow })).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    await expect(service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: "item-9", can: allow })).rejects.toMatchObject({ status: 404, code: "BOQ_ITEM_NOT_FOUND" });
    await expect(service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: "act-9", can: allow })).rejects.toMatchObject({ status: 404, code: "ACTIVITY_NOT_FOUND" });
    await expect(service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, cutoffDate: "not-a-date", can: allow })).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
  });

  it("passes the cutoff to installed, certified and the stock movements", async () => {
    const core = coreWith(ENTRIES);
    await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, can: allow, cutoffDate: "2026-02-28", core });
    const cutoff = new Date("2026-02-28");
    expect(core.installedByBoqItem).toHaveBeenCalledWith(expect.objectContaining({ cutoffDate: cutoff }));
    expect(mockPrisma.ipcItem.findMany.mock.calls.at(-1)[0].where.AND[0]).toMatchObject({ OR: [{ certDate: { lte: cutoff } }, expect.objectContaining({ certDate: null })] });
    expect(mockPrisma.stockTransaction.findMany.mock.calls.at(-1)[0].where).toMatchObject({ occurredAt: { lte: cutoff } });
  });

  it("the paid share is the certificate's own payment state, capped at 1", () => {
    expect(service.paidShareOf({ amountPaid: 250, netPayable: 1000 })).toBe(0.25);
    expect(service.paidShareOf({ amountPaid: 1200, netPayable: 1000 })).toBe(1);
    expect(service.paidShareOf({ amountPaid: 0, netPayable: 0, status: "paid" })).toBe(1);
    expect(service.paidShareOf({ amountPaid: 0, netPayable: 0, status: "certified", paymentStatus: "unpaid" })).toBe(0);
    expect(service.paidShareOf(null)).toBe(0);
  });

  describe("utils/boq-figures withholding", () => {
    it("hands a member without BOQ read the BOQ item view's id only, and the activity view with every figure withheld", async () => {
      const item = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, can: allow, core: coreWith(ENTRIES) });
      expect(withheldBoqItemQuantities(item, { boq: true, budget: true })).toBe(item);
      expect(withheldBoqItemQuantities(item, { boq: false, budget: true })).toEqual({ kind: "boq_item", id: ITEM, boqItemId: ITEM, withheld: true, reason: QUANTITY_FIGURES_WITHHELD });

      const activity = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: allow, core: coreWith(ENTRIES) });
      expect(withheldActivityQuantities(activity, { boq: true, budget: true })).toBe(activity);
      const withheld = withheldActivityQuantities(activity, { boq: false, budget: true });
      expect(withheld).toMatchObject({ kind: "activity", id: ACT, withheld: true, reason: QUANTITY_FIGURES_WITHHELD });
      // The approved % complete is progress data and stays; the planned quantity is the bill's and goes.
      expect(withheld.progress).toMatchObject({ allowed: true, method: "quantity", pctComplete: { value: 40 } });
      expect(withheld.progress.planned).toMatchObject({ value: null, withheld: true, notAvailable: { reason: QUANTITY_FIGURES_WITHHELD } });
      for (const key of ["installed", "certified", "paid", "received", "issued", "committed"]) {
        expect(withheld.figures[key]).toMatchObject({ value: null, truth: null, withheld: true, unitCode: null, unitMatch: null, notAvailable: { reason: QUANTITY_FIGURES_WITHHELD } });
      }
      expect(withheld.items).toEqual({ withheld: true, reason: QUANTITY_FIGURES_WITHHELD });
      expect(withheld.comparisons).toEqual({ withheld: true, reason: QUANTITY_FIGURES_WITHHELD });
      expect(JSON.stringify(withheld)).not.toMatch(/"value":(35|17\.5|80|1500|100)\b/);
      expect(JSON.stringify(withheld)).not.toMatch(/byItem|byUnit|certificates|components/);
    });

    it("the activity detail's progress section loses its installed quantity, not its % complete", () => {
      const detail = {
        kind: "activity",
        id: ACT,
        sections: {
          progress: { allowed: true, pctComplete: { value: 40, truth: "source", basis: "x", derivedFrom: [] }, installedQuantity: { value: 35, truth: "derived", unitCode: "m3", unitMatch: true } },
          cost: { allowed: true, forecast: null },
        },
      };
      const withheld = withheldActivityDetail(detail, { boq: false, budget: true });
      expect(withheld.sections.progress.pctComplete.value).toBe(40);
      expect(withheld.sections.progress.installedQuantity).toMatchObject({ value: null, withheld: true, notAvailable: { reason: QUANTITY_FIGURES_WITHHELD } });
      expect(withheldActivityDetail(detail, { boq: true, budget: true })).toBe(detail);
    });
  });
});
