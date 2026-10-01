/**
 * PC-6 (core): the rules of a quantity progress entry that need no database
 * — the unit rule, three-place Decimal arithmetic, the calendar day, the
 * planned-quantity basis and the mutable/immutable rules of an edit. The
 * lifecycle itself (create, replay, list, patch, delete, submit, the tenant
 * 404, the permission refusals and the BOQ withholding over HTTP) is proven
 * live in __live__/pc-6-quantity-entries.live.test.js.
 */
const { Prisma } = require("@prisma/client");

const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  boqItem: { findFirst: jest.fn() },
  location: { findFirst: jest.fn() },
  activityAssignment: { findMany: jest.fn() },
  activityProgressMethod: { findFirst: jest.fn() },
  activityBoqAllocation: { findMany: jest.fn(), findFirst: jest.fn() },
  quantityProgressEntry: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  unitOfMeasure: { findMany: jest.fn() },
  organisation: { findUnique: jest.fn() },
};
const mockAuditService = {
  ACTIONS: { CREATED: "created", UPDATED: "updated", DELETED: "deleted", STATUS_CHANGED: "status_changed" },
  ENTITY_TYPES: {},
  recordEvent: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAuditService);

const uomService = require("../uom.service");
const service = require("../quantity-progress.service");

const project = { id: "project-1", orgId: "org-1", timezone: "UTC" };
const concrete = { id: "item-1", projectId: "project-1", isActive: true, unit: "Cu.M", unitCode: "m3" };
const untyped = { id: "item-2", projectId: "project-1", isActive: true, unit: "bucket", unitCode: null };

let index;
beforeAll(async () => {
  mockPrisma.unitOfMeasure.findMany.mockResolvedValue([]);
  index = await uomService.loadUnitIndex("org-1", mockPrisma); // the default list
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.project.findFirst.mockResolvedValue(project);
  mockPrisma.unitOfMeasure.findMany.mockResolvedValue([]);
  mockPrisma.organisation.findUnique.mockResolvedValue(null);
});

describe("the unit rule (§3: the item's unit or a registered alias, no conversions)", () => {
  it("an entry in the item's unit code is stored under it", () => {
    expect(service.resolveEntryUnit({ unit: "m3", item: concrete, index })).toBe("m3");
  });

  it("a spelling the organisation's master maps to the item's code is accepted — and stored as the code", () => {
    for (const spelling of ["cum", "Cu.M", "m³", "cubic metre", "CBM"]) {
      expect(service.resolveEntryUnit({ unit: spelling, item: concrete, index })).toBe("m3");
    }
  });

  it("an entry that names no unit is in the item's", () => {
    expect(service.resolveEntryUnit({ unit: undefined, item: concrete, index })).toBe("m3");
    expect(service.resolveEntryUnit({ unit: "", item: concrete, index })).toBe("m3");
  });

  it("another unit — even one of the same dimension — is refused, never converted", () => {
    for (const other of ["m2", "l", "litre", "nr", "tonne"]) {
      expect(() => service.resolveEntryUnit({ unit: other, item: concrete, index })).toThrow(
        expect.objectContaining({ status: 400, code: "QUANTITY_UNIT_MISMATCH", details: expect.objectContaining({ unit: other, itemUnitCode: "m3" }) }),
      );
    }
  });

  it("an item whose unit nobody recognises still has one: the same spelling is accepted, any other refused", () => {
    expect(service.resolveEntryUnit({ unit: "Bucket", item: untyped, index })).toBe("bucket");
    expect(service.resolveEntryUnit({ unit: undefined, item: untyped, index })).toBe("bucket");
    expect(() => service.resolveEntryUnit({ unit: "m3", item: untyped, index })).toThrow(expect.objectContaining({ code: "QUANTITY_UNIT_MISMATCH" }));
  });

  it("an item with no unit at all needs the entry to name one", () => {
    expect(() => service.resolveEntryUnit({ unit: null, item: { ...untyped, unit: null }, index })).toThrow(expect.objectContaining({ code: "QUANTITY_UNIT_REQUIRED" }));
  });
});

describe("quantities are Decimal(18,3), never floating-point sums", () => {
  it("sums to three places exactly where Number would drift", () => {
    expect(service.sumQuantities([0.1, 0.2, 0.3]).toString()).toBe("0.6");
    expect(service.sumQuantities(["1234567890.123", new Prisma.Decimal("0.001"), 0.0004]).toString()).toBe("1234567890.124");
    expect(service.quantityNumber("12.3456")).toBe(12.346);
  });

  it("refuses what is not a number, keeps nothing as null", () => {
    expect(service.quantityDecimal(null)).toBeNull();
    expect(service.quantityDecimal("")).toBeNull();
    expect(() => service.quantityDecimal("ten")).toThrow(expect.objectContaining({ code: "QUANTITY_INVALID" }));
    expect(() => service.quantityDecimal(Number.POSITIVE_INFINITY)).toThrow(expect.objectContaining({ code: "QUANTITY_INVALID" }));
  });
});

describe("the calendar day the work was done", () => {
  it("is a date, stored at UTC midnight, taken from a date-time's date part", () => {
    expect(service.parseEntryDate("2026-09-30").toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(service.parseEntryDate("2026-09-30T22:15:00-05:00").toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("is required and must exist", () => {
    expect(() => service.parseEntryDate(undefined)).toThrow(expect.objectContaining({ code: "QUANTITY_DATE_REQUIRED" }));
    expect(() => service.parseEntryDate("2026-02-30")).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
    expect(() => service.parseEntryDate("yesterday")).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
  });
});

describe("plannedQuantityFor (typed method config first, else Σ approved allocations, else none)", () => {
  const args = { orgId: "org-1", projectId: "project-1", activityId: "activity-1" };

  it("a typed planned quantity wins, with its basis", async () => {
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({ method: "quantity", plannedQuantity: 200, quantityUnit: "m3" });
    await expect(service.plannedQuantityFor(args)).resolves.toEqual({ planned: 200, unitCode: "m3", basis: "method_config", method: "quantity" });
    expect(mockPrisma.activityBoqAllocation.findMany).not.toHaveBeenCalled();
  });

  it("without one, the approved allocations are summed — in one unit", async () => {
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({ method: "quantity", plannedQuantity: null, quantityUnit: null });
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { id: "al-1", boqItemId: "item-1", quantity: 0.1, unitCode: "m3", boqItem: { unit: "m3", unitCode: "m3" } },
      { id: "al-2", boqItemId: "item-3", quantity: 0.2, unitCode: null, boqItem: { unit: "Cu.M", unitCode: "m3" } },
    ]);
    const planned = await service.plannedQuantityFor(args);
    expect(planned).toEqual({ planned: 0.3, unitCode: "m3", basis: "approved_allocations", method: "quantity", allocationIds: ["al-1", "al-2"] });
    expect(mockPrisma.activityBoqAllocation.findMany.mock.calls[0][0].where).toEqual({ projectId: "project-1", activityId: "activity-1", status: "approved", isActive: true });
  });

  it("a zero typed figure is no figure: the allocations decide", async () => {
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({ method: "quantity", plannedQuantity: 0, quantityUnit: "m3" });
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([{ id: "al-1", boqItemId: "item-1", quantity: 50, unitCode: "m3", boqItem: { unit: "m3", unitCode: "m3" } }]);
    await expect(service.plannedQuantityFor(args)).resolves.toMatchObject({ planned: 50, basis: "approved_allocations" });
  });

  it("allocations in two units are never summed: basis none, with the units named", async () => {
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { id: "al-1", boqItemId: "item-1", quantity: 10, unitCode: "m3", boqItem: { unit: "m3", unitCode: "m3" } },
      { id: "al-2", boqItemId: "item-4", quantity: 10, unitCode: "m2", boqItem: { unit: "m2", unitCode: "m2" } },
    ]);
    await expect(service.plannedQuantityFor(args)).resolves.toMatchObject({ planned: null, unitCode: null, basis: "none", units: ["m3", "m2"] });
  });

  it("no config and no allocation is none", async () => {
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    await expect(service.plannedQuantityFor(args)).resolves.toMatchObject({ planned: null, basis: "none" });
  });
});

describe("installedByBoqItem / installedByActivity read approved entries only, at a cutoff", () => {
  it("sums per item in Decimal and never across units", async () => {
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValue([
      { boqItemId: "item-1", unitCode: "m3", quantity: new Prisma.Decimal("0.1"), approvedAt: new Date("2026-09-01T10:00:00Z") },
      { boqItemId: "item-1", unitCode: "m3", quantity: new Prisma.Decimal("0.2"), approvedAt: new Date("2026-09-02T10:00:00Z") },
      { boqItemId: "item-9", unitCode: "m3", quantity: new Prisma.Decimal("1"), approvedAt: new Date("2026-09-02T10:00:00Z") },
      { boqItemId: "item-9", unitCode: "m2", quantity: new Prisma.Decimal("1"), approvedAt: new Date("2026-09-02T10:00:00Z") },
    ]);
    const map = await service.installedByBoqItem({ orgId: "org-1", projectId: "project-1", cutoffDate: "2026-09-30" });
    expect(map.get("item-1")).toMatchObject({ quantity: 0.3, unitCode: "m3", entries: 2, lastApprovedAt: "2026-09-02T10:00:00.000Z", asOf: "2026-09-30T23:59:59.999Z" });
    expect(map.get("item-9")).toMatchObject({ quantity: null, unitCode: null, units: ["m3", "m2"], notAvailable: expect.any(Object) });
    const where = mockPrisma.quantityProgressEntry.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ projectId: "project-1", orgId: "org-1", status: "approved", approvedAt: { lte: new Date("2026-09-30T23:59:59.999Z") } });
  });

  it("per activity: one line per item, in that item's unit", async () => {
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValue([
      { activityId: "a-1", boqItemId: "item-1", unitCode: "m3", quantity: new Prisma.Decimal("7.5"), approvedAt: new Date("2026-09-01T10:00:00Z") },
      { activityId: "a-1", boqItemId: "item-2", unitCode: "nr", quantity: new Prisma.Decimal("3"), approvedAt: new Date("2026-09-03T10:00:00Z") },
    ]);
    const map = await service.installedByActivity({ orgId: "org-1", projectId: "project-1", activityIds: ["a-1"], cutoffDate: new Date("2026-09-15T12:00:00Z") });
    expect(map.get("a-1")).toEqual({
      installed: [
        { boqItemId: "item-1", unitCode: "m3", quantity: 7.5, entries: 1 },
        { boqItemId: "item-2", unitCode: "nr", quantity: 3, entries: 1 },
      ],
      asOf: "2026-09-15T12:00:00.000Z",
      lastApprovedAt: "2026-09-03T10:00:00.000Z",
    });
    expect(mockPrisma.quantityProgressEntry.findMany.mock.calls[0][0].where).toMatchObject({ status: "approved", activityId: { in: ["a-1"] }, approvedAt: { lte: new Date("2026-09-15T12:00:00Z") } });
  });
});

describe("an edit never moves an entry to another activity, item or status", () => {
  const entry = { id: "e-1", projectId: "project-1", orgId: "org-1", activityId: "a-1", boqItemId: "item-1", status: "draft", createdBy: "u-1", quantity: new Prisma.Decimal("1"), unitCode: "m3", date: new Date("2026-09-01T00:00:00Z"), source: "manual", submissionId: null, submission: null };
  beforeEach(() => mockPrisma.quantityProgressEntry.findFirst.mockResolvedValue(entry));

  it.each([
    ["activityId", "a-2"],
    ["boqItemId", "item-2"],
    ["status", "approved"],
  ])("%s is immutable", async (field, value) => {
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", entryId: "e-1", userId: "u-1", payload: { [field]: value } })).rejects.toMatchObject({
      status: 400,
      code: "QUANTITY_ENTRY_IMMUTABLE_FIELD",
      details: { field },
    });
    expect(mockPrisma.quantityProgressEntry.update).not.toHaveBeenCalled();
  });

  it("someone else's entry is refused unless the caller may approve progress", async () => {
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", entryId: "e-1", userId: "u-2", payload: { note: "x" } })).rejects.toMatchObject({ status: 403, code: "QUANTITY_ENTRY_FORBIDDEN" });
    mockPrisma.quantityProgressEntry.update.mockResolvedValue({ ...entry, note: "x" });
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", entryId: "e-1", userId: "u-2", canApprove: true, payload: { note: "x" } })).resolves.toMatchObject({ entry: { note: "x" } });
  });

  it("an approved entry is history: not edited, not removed", async () => {
    mockPrisma.quantityProgressEntry.findFirst.mockResolvedValue({ ...entry, status: "approved" });
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", entryId: "e-1", userId: "u-1", payload: { quantity: 2 } })).rejects.toMatchObject({ status: 409, code: "QUANTITY_ENTRY_LOCKED" });
    await expect(service.deleteEntry({ orgId: "org-1", projectId: "project-1", entryId: "e-1", userId: "u-1" })).rejects.toMatchObject({ status: 409, code: "QUANTITY_ENTRY_LOCKED" });
    expect(mockPrisma.quantityProgressEntry.delete).not.toHaveBeenCalled();
  });

  it("an entry bundled into a pending submission is not changed under it", async () => {
    mockPrisma.quantityProgressEntry.findFirst.mockResolvedValue({ ...entry, status: "submitted", submissionId: "s-1", submission: { id: "s-1", status: "submitted" } });
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", entryId: "e-1", userId: "u-1", payload: { quantity: 2 } })).rejects.toMatchObject({ status: 409, code: "QUANTITY_ENTRY_BUNDLED" });
  });

  it("a negative correction is refused: a correction is a rejection plus a new entry", async () => {
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", entryId: "e-1", userId: "u-1", payload: { quantity: -1 } })).rejects.toMatchObject({ status: 400, code: "QUANTITY_NEGATIVE" });
  });
});

describe("createEntries validates before it writes", () => {
  const base = { orgId: "org-1", projectId: "project-1", userId: "u-1", userRole: "pm" };
  beforeEach(() => {
    mockPrisma.activity.findFirst.mockResolvedValue({ id: "a-1", projectId: "project-1", isActive: true });
    mockPrisma.boqItem.findFirst.mockResolvedValue(concrete);
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValue([]);
  });

  it("refuses a negative quantity, a missing date, a foreign unit, a source or status outside the vocabulary, and a duplicated clientRequestId — writing nothing", async () => {
    const cases = [
      [{ entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: -5, date: "2026-09-01" }] }, "QUANTITY_NEGATIVE"],
      [{ entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: 5 }] }, "QUANTITY_DATE_REQUIRED"],
      [{ entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: 5, date: "2026-09-01", unit: "m2" }] }, "QUANTITY_UNIT_MISMATCH"],
      [{ entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: 5, date: "2026-09-01" }], source: "mobile" }, "QUANTITY_ENTRY_SOURCE_INVALID"],
      [{ entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: 5, date: "2026-09-01" }], status: "approved" }, "QUANTITY_ENTRY_STATUS_INVALID"],
      [{ entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: 5, date: "2026-09-01", clientRequestId: "k" }, { activityId: "a-1", boqItemId: "item-1", quantity: 5, date: "2026-09-01", clientRequestId: "k" }] }, "QUANTITY_CLIENT_REQUEST_DUPLICATE"],
    ];
    for (const [input, code] of cases) {
      await expect(service.createEntries({ ...base, ...input })).rejects.toMatchObject({ status: 400, code });
    }
    expect(mockPrisma.quantityProgressEntry.create).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
  });

  it("writes the entry under the item's unit code, as a draft by default, with the recorder as provenance — and never an ActivityProgress row", async () => {
    mockPrisma.quantityProgressEntry.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "e-1",
      createdAt: new Date("2026-09-01T08:00:00Z"),
      updatedAt: new Date("2026-09-01T08:00:00Z"),
      activity: { id: "a-1", name: "Pour", activityCode: "A100" },
      boqItem: { id: "item-1", code: "1.1", description: "Concrete", unit: "Cu.M", unitCode: "m3" },
      location: null,
      submission: null,
    }));
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([{ id: "al-1", quantity: 100, unitCode: "m3" }]);
    const result = await service.createEntries({ ...base, entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: "12.3456", date: "2026-09-01", unit: "cum", clientRequestId: "cr-1" }] });
    expect(mockPrisma.quantityProgressEntry.create.mock.calls[0][0].data).toMatchObject({ orgId: "org-1", projectId: "project-1", unitCode: "m3", status: "draft", source: "manual", clientRequestId: "cr-1", createdBy: "u-1" });
    expect(mockPrisma.quantityProgressEntry.create.mock.calls[0][0].data.quantity.toString()).toBe("12.346");
    expect(result).toMatchObject({ created: 1, replayed: 0, warnings: [] });
    expect(result.entries[0]).toMatchObject({ quantity: 12.346, unitCode: "m3", status: "draft", replayed: false, provenance: { source: "manual", recordedBy: "u-1", official: false, approvedBy: null } });
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ entityType: "quantity_progress_entry", action: "created", newStatus: "draft" }));
    expect(mockPrisma.activityProgress).toBeUndefined();
  });

  it("an entry past the approved allocation is accepted with a raw-comparison warning, not blocked", async () => {
    mockPrisma.quantityProgressEntry.create.mockImplementation(async ({ data }) => ({ ...data, id: "e-2", createdAt: new Date(), updatedAt: new Date() }));
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([{ id: "al-1", quantity: 100, unitCode: "m3" }]);
    // No clientRequestId, so no replay lookup: the one read is the approved entries so far.
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValue([{ quantity: new Prisma.Decimal("95") }]);
    const result = await service.createEntries({ ...base, entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: 10, date: "2026-09-01" }] });
    expect(result.created).toBe(1);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "QUANTITY_OVER_ALLOCATION", entryId: "e-2", allocationQuantity: 100, approvedQuantity: 95, entryQuantity: 10, wouldBe: 105 })]);
  });

  it("the site-engineer assignment rule is the progress submission's own", async () => {
    mockPrisma.activityAssignment.findMany.mockResolvedValue([]);
    await expect(service.createEntries({ ...base, userRole: "site_engineer", entries: [{ activityId: "a-1", boqItemId: "item-1", quantity: 5, date: "2026-09-01" }] })).rejects.toMatchObject({
      status: 403,
      code: "ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED",
      details: { activityIds: ["a-1"] },
    });
    expect(mockPrisma.quantityProgressEntry.create).not.toHaveBeenCalled();
  });

  it("PROGRESS SOURCE links are the server's: a client-sent submissionId, dailyLogId, dailyLogQuantityId or createdBy is ignored; the daily log's own minting (internal) carries them", async () => {
    mockPrisma.quantityProgressEntry.create.mockImplementation(async ({ data }) => ({ ...data, id: "e-9", createdAt: new Date(), updatedAt: new Date(), activity: null, boqItem: null, location: null, submission: null }));
    const smuggled = { activityId: "a-1", boqItemId: "item-1", quantity: 5, date: "2026-09-01", submissionId: "sub-pending", dailyLogId: "log-x", dailyLogQuantityId: "row-x", createdBy: "someone-else" };
    await service.createEntries({ ...base, entries: [smuggled] });
    expect(mockPrisma.quantityProgressEntry.create.mock.calls[0][0].data).toMatchObject({ submissionId: null, dailyLogId: null, dailyLogQuantityId: null, createdBy: "u-1" });

    mockPrisma.activityAssignment.findMany.mockResolvedValue([]);
    await service.createEntries({ ...base, userRole: "site_engineer", entries: [smuggled], source: "daily_log", status: "submitted", internal: true, assignmentRule: false });
    expect(mockPrisma.quantityProgressEntry.create.mock.calls[1][0].data).toMatchObject({ submissionId: "sub-pending", dailyLogId: "log-x", dailyLogQuantityId: "row-x", createdBy: "someone-else", source: "daily_log", status: "submitted" });
  });
});
