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
  // The reporting zone: Project.timezone → Organisation.defaultTimezone → UTC.
  organisation: { findUnique: jest.fn(async () => ({ defaultTimezone: null })) },
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
  // PROGRESS SOURCE is the writer's own reading of a row (the legacy floor is
  // named there): the real one, never a stand-in.
  serializeProgressSource: (progress) => jest.requireActual("../progress.service").serializeProgressSource(progress),
}));

const service = require("../quantity-views.service");
const { withheldActivity, withheldActivityQuantities, withheldBoqItemQuantities, withheldActivityDetail, QUANTITY_FIGURES_WITHHELD } = require("../../utils/boq-figures");

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
    // A Σ over IpcItem rows is derived — the one label the certification section gives the same rows.
    expect(figures.certified).toMatchObject({ value: 40, truth: "derived", unitCode: "m3", unitMatch: true, rows: 2 });
    expect(service.TRUTH.certified).toBe("derived");
    expect(figures.paid.basis).toMatch(/share of the certificate's net payable that has been paid .*capped at 1.*a fully paid certificate projects paid = certified/);
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

  describe("the installed view names a legacy floor", () => {
    // The official row of a floored approval, as the one writer leaves it:
    // 75 of 100 (a typed 60 carried as the floor + 15 entered), the floor's
    // trace in its note. Σ approved entries (ENTRIES) is 35.
    const FLOOR_NOTE = "Legacy typed quantity carried as the floor of the installed figure (PC-6)";
    const floored = { id: "ap-floor", activityId: ACT, status: "approved", pctComplete: 75, progressMethod: "quantity", source: "manual", quantityComplete: 75, quantityPlanned: 100, quantityUnit: "m3", notes: FLOOR_NOTE, approvedAt: new Date("2026-10-01T10:00:00Z") };
    const OFFICIAL = { value: 75, unitCode: "m3", basis: "official figure of the latest approved progress, carrying a legacy typed quantity as its floor" };
    const original = rows.progress[0];
    afterEach(() => {
      rows.progress[0] = original;
    });

    it("keeps Σ approved entries, says why it is below the official installed figure, and carries that figure beside it — on the activity view and the detail's figure", async () => {
      const plain = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: allow, core: coreWith(ENTRIES) });
      expect(plain.figures.installed.officialInstalled).toBeUndefined();
      expect(plain.figures.installed.basis).toBe(service.BASIS.installed);

      rows.progress[0] = floored;
      const view = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: allow, core: coreWith(ENTRIES) });
      // Neither figure moved: Σ approved entries is 35 as before, the official % is the row's.
      expect(view.figures.installed).toMatchObject({ value: 35, unitCode: "m3", unitMatch: true, truth: "derived" });
      expect(view.figures.installed.byItem).toEqual(plain.figures.installed.byItem);
      expect(view.progress.pctComplete.value).toBe(75);
      expect(view.figures.installed.officialInstalled).toEqual({ ...OFFICIAL, installedBasis: "legacy_typed_floor", truth: "source", derivedFrom: [{ type: "activity_progress", id: "ap-floor" }], approvedAt: "2026-10-01T10:00:00.000Z" });
      expect(view.figures.installed.basis).toBe(`${service.BASIS.installed}. ${service.LEGACY_FLOOR_INSTALLED_NOTE}`);
      expect(view.figures.installed.basis).toMatch(/below the official installed figure .* because earlier progress was typed, not entered/);
      expect(service.OFFICIAL_INSTALLED_BASIS).toBe(OFFICIAL.basis);
      // Everything else of the view is what it was.
      const { installed: flooredInstalled, ...flooredRest } = view.figures;
      const { installed: plainInstalled, ...plainRest } = plain.figures;
      expect(flooredRest).toEqual(plainRest);
      expect(view.items).toEqual(plain.items);
      // The comparison takes the higher of Σ approved entries (35) and the official figure (75), and says which.
      expect(plain.comparisons.certifiedOverInstalled).toMatchObject({ flag: true, certified: 40, installed: 35, installedFigure: "approved_entries", basis: expect.stringContaining("here Σ approved entries") });
      expect(view.comparisons.certifiedOverInstalled).toMatchObject({ flag: false, certified: 40, installed: 75, installedFigure: "official_installed", unitCode: "m3", basis: expect.stringContaining("here the official installed figure (officialInstalled)") });

      const detailFigure = await service.installedForActivity({ orgId: ORG, projectId: PROJECT, activityId: ACT, method: "quantity", core: coreWith(ENTRIES) });
      expect(detailFigure).toMatchObject({ value: 35, unitCode: "m3", officialInstalled: OFFICIAL });
      expect(detailFigure.basis).toContain(service.LEGACY_FLOOR_INSTALLED_NOTE);
      // No approved entry at all behind the official figure: 0, and the official figure beside it.
      const none = await service.installedForActivity({ orgId: ORG, projectId: PROJECT, activityId: ACT, method: "quantity", core: coreWith([]) });
      expect(none).toMatchObject({ value: 0, byItem: [], officialInstalled: OFFICIAL });
    });

    it("the register's installed quantity carries the same note, its lines untouched", () => {
      const register = { installed: [{ boqItemId: ITEM, code: "1.1", description: "Concrete", unitCode: "m3", quantity: 35, entries: 2 }], asOf: "2026-10-01T10:00:00.000Z", lastApprovedAt: "2026-10-01T10:00:00.000Z", basis: "Σ approved quantity progress entries per BOQ item (only approval counts)" };
      const answer = service.withOfficialInstalled(register, floored);
      expect(answer).toMatchObject({ installed: register.installed, asOf: register.asOf, lastApprovedAt: register.lastApprovedAt, officialInstalled: OFFICIAL });
      expect(answer.basis).toBe(`${register.basis}. ${service.LEGACY_FLOOR_INSTALLED_NOTE}`);
      expect(register.officialInstalled).toBeUndefined();
      // An empty list (nothing approved) under a floored row: the official figure still stands beside it.
      expect(service.withOfficialInstalled({ ...register, installed: [] }, floored)).toMatchObject({ installed: [], officialInstalled: OFFICIAL });
    });

    it("says nothing where there is no floor, no difference to explain, or no figure to stand beside", async () => {
      const figure = { value: 35, unitCode: "m3", basis: "B", truth: "derived" };
      // No official row; a row approved from entries (its submission bundled entered ones); another method.
      // (A typed row with no floor note is a typed official figure: see the next block.)
      const fromEntries = { ...floored, notes: null, submission: { id: "s-bundle", quantityEntries: [{ id: "e-1", source: "manual" }, { id: "e-2", source: "daily_log" }] } };
      expect(service.withOfficialInstalled(figure, null)).toBe(figure);
      expect(service.withOfficialInstalled(figure, fromEntries)).toBe(figure);
      expect(service.withOfficialInstalled(figure, { ...fromEntries, notes: "poured the north bay" })).toBe(figure);
      expect(service.withOfficialInstalled(figure, { ...floored, progressMethod: "percent" })).toBe(figure);
      expect(service.withOfficialInstalled(figure, { ...floored, quantityComplete: null })).toBe(figure);
      // Σ approved entries is not below the official figure: nothing to explain.
      expect(service.withOfficialInstalled({ ...figure, value: 75 }, floored).officialInstalled).toBeUndefined();
      expect(service.withOfficialInstalled({ installed: [{ quantity: 40, unitCode: "m3" }, { quantity: 40, unitCode: "M3" }], basis: "R" }, floored).officialInstalled).toBeUndefined();
      // Lines in two units are not one figure: the official figure is stated beside them.
      expect(service.withOfficialInstalled({ installed: [{ quantity: 400, unitCode: "kg" }, { quantity: 40, unitCode: "m3" }], basis: "R" }, floored).officialInstalled).toMatchObject(OFFICIAL);
      expect(service.withOfficialInstalled(null, floored)).toBeNull();
      expect(service.officialInstalledOf(original)).toBeNull();

      rows.progress[0] = floored;
      // Not measured by quantity: the dash stays a dash.
      rows.methods[0].method = "percent";
      const percent = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: allow, core: coreWith(ENTRIES) });
      expect(percent.figures.installed).toMatchObject({ value: null, notAvailable: { reason: service.PERCENT_METHOD_REASON } });
      expect(percent.figures.installed.officialInstalled).toBeUndefined();
      rows.methods[0].method = "quantity";
      // A member who may not read progress is not given the official figure either.
      const noProgress = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: only("ipc", "inventory", "commitment"), core: coreWith(ENTRIES) });
      expect(noProgress.progress).toMatchObject({ allowed: false });
      expect(noProgress.figures.installed).toMatchObject({ value: 35 });
      expect(noProgress.figures.installed.officialInstalled).toBeUndefined();
      expect(noProgress.figures.installed.basis).toBe(service.BASIS.installed);
    });

    it("names a typed official figure above the entries (installedBasis client — typed, no entry minted behind the difference) with its own basis sentence; equal or below says nothing; a minted typed figure is the entries' own", async () => {
      // Typed 60, nothing minted (no submission, or one whose mint was skipped); Σ approved entries 35.
      const typed = { id: "ap-typed", activityId: ACT, status: "approved", pctComplete: 60, progressMethod: "quantity", source: "mobile", quantityComplete: 60, quantityPlanned: 100, quantityUnit: "m3", notes: null, approvedAt: new Date("2026-10-01T11:00:00Z") };
      const TYPED = { value: 60, unitCode: "m3", basis: "official figure of the latest approved progress, typed rather than entered", installedBasis: "client" };
      expect(service.OFFICIAL_TYPED_BASIS).toBe(TYPED.basis);
      expect(service.officialInstalledOf(typed)).toEqual({ ...TYPED, truth: "source", derivedFrom: [{ type: "activity_progress", id: "ap-typed" }], approvedAt: "2026-10-01T11:00:00.000Z" });
      expect(service.officialInstalledOf({ ...typed, submission: { id: "s-typed", quantityEntries: [] } })).toMatchObject(TYPED);
      rows.progress[0] = typed;
      const view = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: allow, core: coreWith(ENTRIES) });
      expect(view.figures.installed).toMatchObject({ value: 35, unitCode: "m3", officialInstalled: TYPED });
      expect(view.figures.installed.basis).toBe(`${service.BASIS.installed}. ${service.TYPED_INSTALLED_NOTE}`);
      expect(view.figures.installed.basis).toMatch(/typed rather than entered: no entry stands behind the difference/);
      expect(view.figures.installed.basis).not.toContain(service.LEGACY_FLOOR_INSTALLED_NOTE);
      expect(view.comparisons.certifiedOverInstalled).toMatchObject({ flag: false, certified: 40, installed: 60, installedFigure: "official_installed" });
      const detailFigure = await service.installedForActivity({ orgId: ORG, projectId: PROJECT, activityId: ACT, method: "quantity", core: coreWith(ENTRIES) });
      expect(detailFigure).toMatchObject({ value: 35, officialInstalled: TYPED });
      // Not above the entries (a typed 30 under Σ 35, or a figure whose mint brought the entries up to it): nothing to explain, the entries compared.
      const figure = { value: 35, unitCode: "m3", basis: "B", truth: "derived" };
      expect(service.withOfficialInstalled(figure, { ...typed, quantityComplete: 30 })).toBe(figure);
      expect(service.withOfficialInstalled(figure, { ...typed, quantityComplete: 35 })).toBe(figure);
      expect(service.comparisonsOf({ installed: { ...figure, officialInstalled: { ...TYPED, value: 30 } }, certified: { value: 32, unitCode: "m3" } }).certifiedOverInstalled).toMatchObject({ flag: false, installed: 35, installedFigure: "approved_entries" });
      // In another unit the official figure is stated beside, never compared.
      expect(service.comparisonsOf({ installed: { ...figure, officialInstalled: { ...TYPED, unitCode: "t" } }, certified: { value: 40, unitCode: "m3" } }).certifiedOverInstalled).toMatchObject({ flag: true, installed: 35, installedFigure: "approved_entries" });
    });

    it("is withheld with the figure from a member who may not read the BOQ — the view, the detail's figure and the register", async () => {
      rows.progress[0] = floored;
      const noBoq = { boq: false, budget: true };
      const view = await service.getActivityQuantities({ orgId: ORG, projectId: PROJECT, activityId: ACT, can: allow, core: coreWith(ENTRIES) });
      expect(view.figures.installed.officialInstalled).toMatchObject(OFFICIAL);
      const withheldView = withheldActivityQuantities(view, noBoq);
      expect(withheldView.figures.installed).toEqual({ value: null, truth: null, basis: QUANTITY_FIGURES_WITHHELD, unitCode: null, unitMatch: null, derivedFrom: [], withheld: true, notAvailable: { reason: QUANTITY_FIGURES_WITHHELD } });
      expect(withheldView.progress.pctComplete.value).toBe(75);
      expect(JSON.stringify(withheldView)).not.toMatch(/officialInstalled|typed, not entered|legacy typed quantity as its floor/);

      const detail = { kind: "activity", id: ACT, sections: { progress: { allowed: true, pctComplete: { value: 75, truth: "source", basis: "x", derivedFrom: [] }, installedQuantity: await service.installedForActivity({ orgId: ORG, projectId: PROJECT, activityId: ACT, method: "quantity", core: coreWith(ENTRIES) }) } } };
      expect(detail.sections.progress.installedQuantity.officialInstalled).toMatchObject(OFFICIAL);
      const withheldDetail = withheldActivityDetail(detail, noBoq);
      expect(withheldDetail.sections.progress.pctComplete.value).toBe(75);
      expect(JSON.stringify(withheldDetail)).not.toMatch(/officialInstalled|typed, not entered|"value":35/);

      const row = { id: ACT, pctComplete: 75, installedQuantity: service.withOfficialInstalled({ installed: [{ boqItemId: ITEM, unitCode: "m3", quantity: 35, entries: 2 }], basis: "R" }, floored), plannedQuantity: { planned: 100, unitCode: "m3", basis: "approved_allocations" } };
      expect(row.installedQuantity.officialInstalled).toMatchObject(OFFICIAL);
      const withheldRow = withheldActivity(row, noBoq);
      expect(withheldRow.pctComplete).toBe(75);
      expect(withheldRow.installedQuantity).toEqual({ withheld: { reason: expect.stringContaining("may read the BOQ") } });
      expect(JSON.stringify(withheldRow)).not.toMatch(/officialInstalled|typed, not entered/);
      expect(withheldActivity(row, { boq: true, budget: true })).toBe(row);
    });
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

  it("passes THE reporting cutoff — the end of that date in the project's zone, not the start of the day in UTC — to installed, certified and the stock movements", async () => {
    const core = coreWith(ENTRIES);
    // No zone configured: UTC, the end of the 28th.
    const utc = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, can: allow, cutoffDate: "2026-02-28", core });
    expect(utc.cutoffDate).toBe("2026-02-28T23:59:59.999Z");
    expect(utc.reportingCutoff).toMatchObject({ localDate: "2026-02-28", timeZone: "UTC", timeZoneSource: "utc" });
    // The project's zone decides: the end of the 28th in Chicago is 05:59:59.999Z on 1 March.
    rows.projects[0].timezone = "America/Chicago";
    const view = await service.getBoqItemQuantities({ orgId: ORG, projectId: PROJECT, itemId: ITEM, can: allow, cutoffDate: "2026-02-28", core });
    delete rows.projects[0].timezone;
    expect(view.cutoffDate).toBe("2026-03-01T05:59:59.999Z");
    expect(view.reportingCutoff).toEqual({ localDate: "2026-02-28", timeZone: "America/Chicago", timeZoneSource: "project", timeZoneNote: null, endOfLocalDay: "2026-03-01T05:59:59.999Z" });
    const cutoff = new Date("2026-03-01T05:59:59.999Z");
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
