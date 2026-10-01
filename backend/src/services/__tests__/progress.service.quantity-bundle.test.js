/**
 * PC-6 (core): approval bundling in the one writer — the rules a mocked
 * Prisma can state (the live proof is pc-6-quantity-approval.live.test.js):
 * derived figures, the client's quantityPlanned ignored, the bundle's
 * refusals, approve/reject settling the entries, and the method lock.
 */
const { Prisma } = require("@prisma/client");

const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(async () => []),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  activityAssignment: { findMany: jest.fn() },
  activityProgressMethod: { findFirst: jest.fn(), upsert: jest.fn() },
  activityBoqAllocation: { findMany: jest.fn() },
  progressSubmission: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  activityProgress: { create: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
  quantityProgressEntry: { findMany: jest.fn(), updateMany: jest.fn() },
  organisation: { findUnique: jest.fn() },
};
const mockAuditService = {
  ACTIONS: { APPROVED: "approved", CREATED: "created", REJECTED: "rejected", UPDATED: "updated", STATUS_CHANGED: "status_changed", DELETED: "deleted" },
  ENTITY_TYPES: { PROGRESS_SUBMISSION: "progress_submission" },
  recordEvent: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAuditService);
jest.mock("../form.service", () => ({ openHoldPoints: jest.fn(async () => []) }));

const progressService = require("../progress.service");

const D = (value) => new Prisma.Decimal(value);
const project = { id: "project-1", orgId: "org-1" };
const activity = { id: "activity-1", projectId: "project-1", isActive: true };
const entry = (id, quantity, extra = {}) => ({
  id,
  activityId: "activity-1",
  boqItemId: "item-1",
  quantity: D(quantity),
  unitCode: "m3",
  date: new Date("2026-09-01T00:00:00Z"),
  source: "manual",
  status: "submitted",
  submissionId: null,
  submission: null,
  dailyLogId: null,
  createdBy: "site-1",
  ...extra,
});
const allocations = [
  { id: "al-1", boqItemId: "item-1", quantity: D(100), unitCode: "m3", boqItem: { unit: "m3", unitCode: "m3" } },
  { id: "al-2", boqItemId: "item-2", quantity: D(60), unitCode: "m3", boqItem: { unit: "m3", unitCode: "m3" } },
];

const create = (payload, extra = {}) =>
  progressService.createProgressSubmission({ orgId: "org-1", projectId: "project-1", activityId: "activity-1", userId: "pm-1", userRole: "pm", payload, ...extra });

describe("PC-6 quantity bundles in the one writer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue(project);
    mockPrisma.activity.findFirst.mockResolvedValue(activity);
    mockPrisma.activityAssignment.findMany.mockResolvedValue([{ activityId: "activity-1" }]);
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({ method: "quantity", plannedQuantity: null, quantityUnit: "m3", evidenceRequired: false });
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue(allocations);
    mockPrisma.quantityProgressEntry.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.progressSubmission.create.mockImplementation(({ data }) => Promise.resolve({ id: "sub-1", createdAt: new Date(), updatedAt: new Date(), ...data }));
    mockPrisma.activityProgress.count.mockResolvedValue(0);
  });

  it("derives installed (Σ bundled + Σ approved) and planned (Σ approved allocations); the client's figures are ignored and the answer says so", async () => {
    mockPrisma.quantityProgressEntry.findMany
      .mockResolvedValueOnce([entry("e-1", "40.5"), entry("e-2", "20")]) // the bundle
      .mockResolvedValueOnce([{ id: "e-0", quantity: D("19.5"), unitCode: "m3" }]); // already approved
    const answer = await create({ method: "quantity", entryIds: ["e-1", "e-2"], quantityPlanned: 999, quantityComplete: 5 });
    expect(answer).toMatchObject({
      status: "submitted",
      pctComplete: 50,
      quantityComplete: 80,
      quantityPlanned: 160,
      quantityUnit: "m3",
      quantityEntryIds: ["e-1", "e-2"],
      quantity: { installed: 80, planned: 160, plannedBasis: "approved_allocations", installedBasis: "approved_entries", approvedBefore: 19.5, bundledEntries: 2, clientQuantityPlannedIgnored: true },
      progressSource: { source: "manual", submissionId: "sub-1", submittedBy: "pm-1", approvedBy: null, entries: 2 },
    });
    expect(mockPrisma.quantityProgressEntry.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["e-1", "e-2"] } }, data: { submissionId: "sub-1", status: "submitted" } });
    expect(mockPrisma.activityProgress.create).not.toHaveBeenCalled();
  });

  it("a typed planned quantity on the method configuration wins (basis method_config)", async () => {
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({ method: "quantity", plannedQuantity: 50, quantityUnit: "m3", evidenceRequired: false });
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([entry("e-1", 10)]).mockResolvedValueOnce([]);
    const answer = await create({ method: "quantity", entryIds: ["e-1"], quantityPlanned: 75 });
    expect(answer).toMatchObject({ pctComplete: 20, quantityPlanned: 50, quantity: { plannedBasis: "method_config", clientQuantityPlannedIgnored: true } });
    expect(mockPrisma.activityBoqAllocation.findMany).not.toHaveBeenCalled();
  });

  it("only with nothing typed and nothing mapped does the client's quantityPlanned count (basis client), as before PC-6", async () => {
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    const answer = await create({ method: "quantity", quantityComplete: 30, quantityPlanned: 120 });
    expect(answer).toMatchObject({ pctComplete: 25, quantityComplete: 30, quantityPlanned: 120, quantity: { plannedBasis: "client", installedBasis: "client", bundledEntries: 0, clientQuantityPlannedIgnored: false } });
    await expect(create({ method: "quantity", quantityComplete: 30 })).rejects.toMatchObject({ code: "PLANNED_QUANTITY_REQUIRED" });
  });

  it("the submission's method is the activity's: a client naming another method on a configured activity is 409 PROGRESS_METHOD_MISMATCH, never coerced; the configured method applies when none is named; without a row the client's method stands", async () => {
    // Configured quantity: a percent submission is refused, naming both methods.
    await expect(create({ method: "percent", pctComplete: 90 })).rejects.toMatchObject({
      status: 409,
      code: "PROGRESS_METHOD_MISMATCH",
      details: { activityId: "activity-1", effectiveMethod: "quantity", effectiveMethodBasis: "method_config", requestedMethod: "percent" },
    });
    await expect(create({ progressMethod: "milestone", pctComplete: 90 })).rejects.toMatchObject({ code: "PROGRESS_METHOD_MISMATCH", details: { requestedMethod: "weighted_milestone" } });
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    // No method named: the activity's applies (quantity → derived).
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([entry("e-1", 16)]).mockResolvedValueOnce([]);
    expect(await create({ entryIds: ["e-1"], pctComplete: 90 })).toMatchObject({ method: "quantity", pctComplete: 10, quantityComplete: 16 });
    // An alias of the configured method is that method.
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({ method: "percent", plannedQuantity: null, quantityUnit: null, evidenceRequired: false });
    expect(await create({ method: "physical_percent", pctComplete: 40 })).toMatchObject({ method: "percent", pctComplete: 40 });
    // Without a configured row the client's method is accepted as before.
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
    expect(await create({ method: "percent", pctComplete: 90 })).toMatchObject({ method: "percent", pctComplete: 90 });
    expect(await create({ pctComplete: 20 })).toMatchObject({ method: "percent", pctComplete: 20 });
  });

  it("refuses an entry of another activity, an approved one, one held by an open submission, a foreign unit, and a bundle on a percent submission", async () => {
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([entry("e-1", 1, { activityId: "activity-9" })]);
    await expect(create({ method: "quantity", entryIds: ["e-1"] })).rejects.toMatchObject({ status: 400, code: "QUANTITY_ENTRY_ACTIVITY_MISMATCH" });
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([entry("e-1", 1, { status: "approved" })]);
    await expect(create({ method: "quantity", entryIds: ["e-1"] })).rejects.toMatchObject({ status: 409, code: "QUANTITY_ENTRY_LOCKED" });
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([entry("e-1", 1, { submissionId: "sub-0", submission: { id: "sub-0", status: "submitted" } })]);
    await expect(create({ method: "quantity", entryIds: ["e-1"] })).rejects.toMatchObject({ status: 409, code: "QUANTITY_ENTRY_BUNDLED" });
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([]);
    await expect(create({ method: "quantity", entryIds: ["e-1"] })).rejects.toMatchObject({ status: 404, code: "QUANTITY_ENTRY_NOT_FOUND", details: { entryIds: ["e-1"] } });
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([entry("e-1", 1, { unitCode: "t" })]).mockResolvedValueOnce([]);
    await expect(create({ method: "quantity", entryIds: ["e-1"] })).rejects.toMatchObject({ status: 400, code: "QUANTITY_UNIT_MISMATCH" });
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([]);
    await expect(create({ method: "quantity", bundleSubmittedThrough: "2026-09-30" })).rejects.toMatchObject({ status: 400, code: "QUANTITY_NO_ENTRIES_TO_BUNDLE" });
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
    await expect(create({ method: "percent", pctComplete: 10, entryIds: ["e-1"] })).rejects.toMatchObject({ status: 400, code: "QUANTITY_BUNDLE_METHOD_MISMATCH" });
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    expect(mockPrisma.quantityProgressEntry.updateMany).not.toHaveBeenCalled();
  });

  const submitted = (quantityEntries) => ({
    id: "sub-1",
    projectId: "project-1",
    activityId: "activity-1",
    method: "quantity",
    source: "manual",
    status: "submitted",
    pctComplete: 37.5,
    quantityComplete: 60,
    quantityPlanned: 160,
    quantityUnit: "m3",
    evidenceJson: null,
    submittedBy: "site-1",
    submittedAt: new Date("2026-09-10T00:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    activity,
    quantityEntries,
  });

  it("approve re-reads the figures, approves exactly the bundled entries and writes ONE ActivityProgress row at installed ÷ planned", async () => {
    const bundle = [entry("e-1", 40, { submissionId: "sub-1" }), entry("e-2", 20, { submissionId: "sub-1" }), entry("e-x", 5, { status: "rejected", submissionId: "sub-1" })];
    mockPrisma.progressSubmission.findFirst.mockResolvedValue(submitted(bundle));
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([{ id: "e-0", quantity: D(20), unitCode: "m3" }]); // approved since
    mockPrisma.progressSubmission.update.mockImplementation(({ data }) => Promise.resolve({ ...submitted(bundle), ...data }));
    mockPrisma.activityProgress.create.mockResolvedValue({ id: "progress-1" });
    const answer = await progressService.approveProgressSubmission({ orgId: "org-1", projectId: "project-1", activityId: "activity-1", submissionId: "sub-1", userId: "pm-1" });
    expect(answer).toMatchObject({ status: "approved", pctComplete: 50, quantityComplete: 80, quantityPlanned: 160, approvedProgressId: "progress-1", quantity: { installed: 80, approvedBefore: 20, bundledEntries: 2 }, progressSource: { approvedBy: "pm-1", entries: 3 } });
    expect(mockPrisma.quantityProgressEntry.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.quantityProgressEntry.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["e-1", "e-2"] } }, data: { status: "approved", approvedBy: "pm-1", submissionId: "sub-1" } });
    expect(mockPrisma.activityProgress.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.activityProgress.create.mock.calls[0][0].data).toMatchObject({ activityId: "activity-1", submissionId: "sub-1", pctComplete: 50, quantityComplete: 80, quantityPlanned: 160, quantityUnit: "m3", progressMethod: "quantity", status: "approved", approvedBy: "pm-1" });
    const entryEvents = mockAuditService.recordEvent.mock.calls.map(([event]) => event).filter((event) => event.entityType === "quantity_progress_entry");
    expect(entryEvents.map((event) => [event.entityId, event.action, event.newStatus])).toEqual([["e-1", "approved", "approved"], ["e-2", "approved", "approved"]]);
    // Approvals are serialised per activity: the activity row is held and the submission read again under the hold, before the figures are derived.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$queryRaw.mock.calls[0].slice(1)).toEqual(["activity-1"]);
    expect(mockPrisma.progressSubmission.findFirst).toHaveBeenCalledTimes(2);
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.quantityProgressEntry.findMany.mock.invocationCallOrder[0]);
    expect(mockPrisma.progressSubmission.findFirst.mock.invocationCallOrder[1]).toBeGreaterThan(mockPrisma.$queryRaw.mock.invocationCallOrder[0]);
  });

  it("a submission approved twice at once answers idempotently: the second reads 'approved' under the hold and writes nothing", async () => {
    mockPrisma.progressSubmission.findFirst.mockResolvedValueOnce(submitted([])).mockResolvedValueOnce({ ...submitted([]), status: "approved" });
    const answer = await progressService.approveProgressSubmission({ orgId: "org-1", projectId: "project-1", activityId: "activity-1", submissionId: "sub-1", userId: "pm-1" });
    expect(answer).toMatchObject({ id: "sub-1", status: "approved" });
    expect(mockPrisma.activityProgress.create).not.toHaveBeenCalled();
    expect(mockPrisma.progressSubmission.update).not.toHaveBeenCalled();
  });

  it("a bundle planned by the client (nothing typed, nothing mapped) is approved with the figure it was put forward with (basis submission), never stuck pending", async () => {
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    const bundle = [entry("e-1", 5, { submissionId: "sub-1" })];
    const frozen = { ...submitted(bundle), pctComplete: 25, quantityComplete: 5, quantityPlanned: 20 };
    mockPrisma.progressSubmission.findFirst.mockResolvedValue(frozen);
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([]);
    mockPrisma.progressSubmission.update.mockImplementation(({ data }) => Promise.resolve({ ...frozen, ...data }));
    mockPrisma.activityProgress.create.mockResolvedValue({ id: "progress-1" });
    const answer = await progressService.approveProgressSubmission({ orgId: "org-1", projectId: "project-1", activityId: "activity-1", submissionId: "sub-1", userId: "pm-1" });
    expect(answer).toMatchObject({ status: "approved", pctComplete: 25, quantityComplete: 5, quantityPlanned: 20, quantityUnit: "m3", quantity: { installed: 5, planned: 20, plannedBasis: "submission", installedBasis: "approved_entries", bundledEntries: 1 } });
    expect(mockPrisma.activityProgress.create.mock.calls[0][0].data).toMatchObject({ pctComplete: 25, quantityComplete: 5, quantityPlanned: 20, quantityUnit: "m3" });
    expect(mockPrisma.quantityProgressEntry.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["e-1"] } }, data: { status: "approved" } });
    // A typed or mapped figure found at approval still wins over the frozen one.
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue(allocations);
    mockPrisma.quantityProgressEntry.findMany.mockResolvedValueOnce([]);
    const mapped = await progressService.approveProgressSubmission({ orgId: "org-1", projectId: "project-1", activityId: "activity-1", submissionId: "sub-1", userId: "pm-1" });
    expect(mapped).toMatchObject({ quantityPlanned: 160, pctComplete: 3.125, quantity: { plannedBasis: "approved_allocations" } });
  });

  it("reject marks the bundled entries rejected with the reason and writes nothing official", async () => {
    const bundle = [entry("e-1", 40, { submissionId: "sub-1" })];
    mockPrisma.progressSubmission.findFirst.mockResolvedValue(submitted(bundle));
    mockPrisma.progressSubmission.update.mockImplementation(({ data }) => Promise.resolve({ ...submitted(bundle), ...data }));
    const answer = await progressService.rejectProgressSubmission({ orgId: "org-1", projectId: "project-1", activityId: "activity-1", submissionId: "sub-1", userId: "pm-1", reason: "measured twice" });
    expect(answer).toMatchObject({ status: "rejected", rejectionReason: "measured twice", quantityEntryIds: ["e-1"] });
    expect(mockPrisma.quantityProgressEntry.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["e-1"] } }, data: { status: "rejected", rejectedBy: "pm-1", rejectionReason: "measured twice" } });
    expect(mockPrisma.activityProgress.create).not.toHaveBeenCalled();
    expect(mockPrisma.quantityProgressEntry.findMany).not.toHaveBeenCalled();
  });

  it("a quantity submission typed the old way (no entries) is approved as it stands", async () => {
    mockPrisma.progressSubmission.findFirst.mockResolvedValue(submitted([]));
    mockPrisma.progressSubmission.update.mockImplementation(({ data }) => Promise.resolve({ ...submitted([]), ...data }));
    mockPrisma.activityProgress.create.mockResolvedValue({ id: "progress-1" });
    const answer = await progressService.approveProgressSubmission({ orgId: "org-1", projectId: "project-1", activityId: "activity-1", submissionId: "sub-1", userId: "pm-1" });
    expect(answer).toMatchObject({ status: "approved", pctComplete: 37.5 });
    expect(answer.quantity).toBeUndefined();
    expect(mockPrisma.quantityProgressEntry.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.activityProgress.create.mock.calls[0][0].data).toMatchObject({ pctComplete: 37.5, quantityComplete: 60, quantityPlanned: 160 });
  });

  describe("the method lock", () => {
    const upsert = (payload) => progressService.upsertProgressMethod({ orgId: "org-1", projectId: "project-1", activityId: "activity-1", userId: "pm-1", payload });

    it("without approved progress any method is written", async () => {
      mockPrisma.activityProgressMethod.upsert.mockResolvedValue({ method: "percent" });
      await expect(upsert({ method: "percent" })).resolves.toMatchObject({ method: "percent" });
      expect(mockPrisma.activityProgressMethod.upsert).toHaveBeenCalledTimes(1);
    });

    it("with approved progress another method is 409 PROGRESS_METHOD_LOCKED, naming the effective one", async () => {
      mockPrisma.activityProgress.count.mockResolvedValue(2);
      await expect(upsert({ method: "percent" })).rejects.toMatchObject({ status: 409, code: "PROGRESS_METHOD_LOCKED", details: { effectiveMethod: "quantity", effectiveMethodBasis: "method_config", requestedMethod: "percent", approvedProgressCount: 2 } });
      expect(mockPrisma.activityProgressMethod.upsert).not.toHaveBeenCalled();
    });

    it("a row naming the effective method is still written — the typed figure, unit and flags with it", async () => {
      mockPrisma.activityProgress.count.mockResolvedValue(2);
      mockPrisma.activityProgressMethod.upsert.mockImplementation(({ update }) => Promise.resolve({ ...update }));
      await expect(upsert({ method: "quantity", plannedQuantity: 200, quantityUnit: "m3" })).resolves.toMatchObject({ method: "quantity", plannedQuantity: 200, quantityUnit: "m3" });
    });

    it("without a configured method the method of the latest official figure is the effective one (an alias normalised); a row equal to it clears readiness", async () => {
      mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
      mockPrisma.activityProgress.count.mockResolvedValue(1);
      mockPrisma.activityProgress.findFirst.mockResolvedValue({ progressMethod: "percent_complete" });
      await expect(upsert({ method: "quantity" })).rejects.toMatchObject({ code: "PROGRESS_METHOD_LOCKED", details: { effectiveMethod: "percent", effectiveMethodBasis: "approved_progress" } });
      mockPrisma.activityProgressMethod.upsert.mockImplementation(({ create: data }) => Promise.resolve(data));
      await expect(upsert({ method: "percent" })).resolves.toMatchObject({ method: "percent" });
      expect(mockPrisma.activityProgressMethod.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
