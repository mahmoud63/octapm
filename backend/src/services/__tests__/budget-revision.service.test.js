/**
 * A budget revision is approved only by someone who may approve cost
 * (Phase 21D, CX21-453).
 */
let existing = null;
const mockPrisma = {
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(async () => []), // row locks (Phase 21D): the held row, when a test says so
  $executeRaw: jest.fn(async () => 0), // advisory locks (Phase 21D)
  project: { findFirst: jest.fn(async () => ({ id: "p1", orgId: "org-1", contractValue: 1000000 })) },
  budgetRevision: {
    findFirst: jest.fn(async ({ where }) => (where.id ? existing : null)),
    findMany: jest.fn(async () => []),
    create: jest.fn(async ({ data }) => ({ id: "br-1", ...data })),
    update: jest.fn(async ({ data }) => ({ ...existing, ...data })),
    delete: jest.fn(async () => ({})),
  },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../../utils/reference-number", () => ({ nextRef: jest.fn(async () => "BR-01") }));
jest.mock("../workflow-engine.service", () => ({ maybeStart: jest.fn(async () => null), assertNotLocked: jest.fn(async () => null) }));

const service = require("../budget-revision.service");
const base = { orgId: "org-1", projectId: "p1", userId: "qs-1" };

describe("Phase 21D — integrity (release challenge, fifth pass)", () => {
  beforeEach(() => { jest.clearAllMocks(); existing = null; });

  it("CX21-453: whoever cannot approve cost creates a draft, never an approved revision", async () => {
    const draft = await service.createBudgetRevision({ ...base, payload: { title: "Steel", changeType: "addition", amount: 100000 } });
    expect(draft.status).toBe("draft");
    expect(draft.approvedBy).toBeNull();
    expect(Number(draft.cumulativeBudget)).toBe(1000000);
    await expect(service.createBudgetRevision({ ...base, payload: { title: "Steel", changeType: "addition", amount: 100000, status: "approved" } })).rejects.toMatchObject({ code: "BUDGET_REVISION_APPROVAL_REQUIRED", status: 403 });
    const approved = await service.createBudgetRevision({ ...base, userId: "pm-1", canApprove: true, payload: { title: "Steel", changeType: "addition", amount: 100000 } });
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe("pm-1");
    expect(Number(approved.cumulativeBudget)).toBe(1100000);
  });

  it("CX21-453: approving, and changing the money of an approved revision, is the approver's", async () => {
    existing = { id: "br-1", projectId: "p1", status: "submitted", title: "Steel", changeType: "addition", amount: 100000, effectiveDate: new Date("2027-01-01"), approvedBy: null, approvedAt: null, notes: null, linkedChangeOrder: null };
    await expect(service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { status: "approved" } })).rejects.toMatchObject({ code: "BUDGET_REVISION_APPROVAL_REQUIRED", status: 403 });
    const approved = await service.updateBudgetRevision({ ...base, userId: "pm-1", canApprove: true, revisionId: "br-1", payload: { status: "approved" } });
    expect(approved.status).toBe("approved");
    existing = { ...existing, status: "approved", approvedBy: "pm-1", approvedAt: new Date() };
    await expect(service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { amount: 250000 } })).rejects.toMatchObject({ code: "BUDGET_REVISION_APPROVED", status: 409 });
    const retitled = await service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { title: "Steel (rev A)" } });
    expect(retitled.title).toBe("Steel (rev A)");
    const changed = await service.updateBudgetRevision({ ...base, userId: "pm-1", canApprove: true, revisionId: "br-1", payload: { amount: 250000 } });
    expect(Number(changed.amount)).toBe(250000);
  });
});

describe("Phase 21D — integrity (release challenge, sixth pass)", () => {
  beforeEach(() => { jest.clearAllMocks(); existing = { id: "br-1", projectId: "p1", status: "approved", title: "Steel", changeType: "addition", amount: 100000, effectiveDate: new Date("2027-01-01"), approvedBy: "pm-1", approvedAt: new Date(), notes: null, linkedChangeOrder: null }; });

  it("CX21-460: whoever cannot approve cost can neither un-approve an approved revision nor delete it", async () => {
    await expect(service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { status: "draft" } })).rejects.toMatchObject({ code: "BUDGET_REVISION_APPROVAL_REQUIRED", status: 403 });
    await expect(service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { status: "rejected" } })).rejects.toMatchObject({ code: "BUDGET_REVISION_APPROVAL_REQUIRED", status: 403 });
    expect(mockPrisma.budgetRevision.update).not.toHaveBeenCalled();
    await expect(service.deleteBudgetRevision({ ...base, revisionId: "br-1" })).rejects.toMatchObject({ code: "BUDGET_REVISION_APPROVAL_REQUIRED", status: 403 });
    expect(mockPrisma.budgetRevision.delete).not.toHaveBeenCalled();
    // the approver may do both
    const back = await service.updateBudgetRevision({ ...base, userId: "pm-1", canApprove: true, revisionId: "br-1", payload: { status: "draft" } });
    expect(back.status).toBe("draft");
    await expect(service.deleteBudgetRevision({ ...base, canApprove: true, revisionId: "br-1" })).resolves.toEqual({ deleted: true });
  });
});

describe("Phase 21D — integrity (release challenge, seventh pass)", () => {
  beforeEach(() => { jest.clearAllMocks(); mockPrisma.$queryRaw.mockImplementation(async () => []); existing = { id: "br-1", projectId: "p1", status: "draft", title: "Steel", changeType: "addition", amount: 100000, effectiveDate: new Date("2027-01-01"), approvedBy: null, approvedAt: null, notes: null, linkedChangeOrder: null }; });

  it("CX21-470: an edit that started on a draft decides on the status as held — approved meanwhile, its money and status are the approver's; a delete likewise", async () => {
    mockPrisma.$queryRaw.mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "BudgetRevision"') ? [{ status: "approved" }] : []));
    // the read before the lock sees the draft; the row as held (re-read whole, CX21-480) is approved
    mockPrisma.budgetRevision.findFirst.mockResolvedValueOnce({ ...existing });
    existing = { ...existing, status: "approved", approvedBy: "pm-1", approvedAt: new Date("2027-02-01") };
    await expect(service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { amount: 250000 } })).rejects.toMatchObject({ code: "BUDGET_REVISION_APPROVED", status: 409 });
    expect(mockPrisma.budgetRevision.update).not.toHaveBeenCalled();
    // a harmless edit goes through, and writes no status of its own
    const retitled = await service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { title: "Steel (rev B)" } });
    expect(retitled.title).toBe("Steel (rev B)");
    expect(Object.prototype.hasOwnProperty.call(mockPrisma.budgetRevision.update.mock.calls.at(-1)[0].data, "status")).toBe(false);
    await expect(service.deleteBudgetRevision({ ...base, revisionId: "br-1" })).rejects.toMatchObject({ code: "BUDGET_REVISION_APPROVAL_REQUIRED", status: 403 });
    expect(mockPrisma.budgetRevision.delete).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — integrity (release challenge, eighth pass)", () => {
  beforeEach(() => { jest.clearAllMocks(); mockPrisma.$queryRaw.mockImplementation(async () => []); });

  it("CX21-480: a title-only edit that started on a draft writes neither the money nor the approval it read once the row was approved meanwhile", async () => {
    const before = { id: "br-1", projectId: "p1", status: "draft", title: "Steel", changeType: "addition", amount: 100000, effectiveDate: new Date("2027-01-01"), approvedBy: null, approvedAt: null, notes: null, linkedChangeOrder: null };
    const after = { ...before, status: "approved", amount: 250000, approvedBy: "pm-1", approvedAt: new Date("2027-02-01") };
    existing = after; // what the database holds once the row is re-read under the lock
    mockPrisma.budgetRevision.findFirst.mockResolvedValueOnce(before); // the read before the lock
    mockPrisma.$queryRaw.mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "BudgetRevision"') ? [{ status: "approved" }] : []));
    const retitled = await service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { title: "Steel (rev C)" } });
    const written = mockPrisma.budgetRevision.update.mock.calls.at(-1)[0].data;
    expect(written.title).toBe("Steel (rev C)");
    for (const key of ["amount", "changeType", "effectiveDate", "status", "approvedBy", "approvedAt"]) expect(Object.prototype.hasOwnProperty.call(written, key)).toBe(false);
    expect(retitled.status).toBe("approved");
  });
});

describe("certification R21 — the revisions state the contract value only to a reader of the terms", () => {
  const rows = [
    { id: "br-2", ref: "BR-02", title: "Extra steel", changeType: "addition", amount: 50000, status: "approved", cumulativeBudget: 1150000, effectiveDate: new Date("2027-02-01") },
    { id: "br-1", ref: "BR-01", title: "Steel", changeType: "addition", amount: 100000, status: "approved", cumulativeBudget: 1100000, effectiveDate: new Date("2027-01-01") },
    { id: "br-3", ref: "BR-03", title: "Omit paving", changeType: "deduction", amount: 20000, status: "draft", cumulativeBudget: 1150000, effectiveDate: new Date("2027-03-01") },
  ];
  beforeEach(() => {
    jest.clearAllMocks();
    existing = null;
    mockPrisma.budgetRevision.findMany.mockResolvedValue(rows);
  });

  it("gives the reader of the terms the original and current budget and every running total", async () => {
    const full = await service.listBudgetRevisions({ orgId: "org-1", projectId: "p1", contractValueReadable: true });
    expect(full.summary).toEqual({ originalBudget: 1000000, netChange: 150000, currentBudget: 1150000 });
    expect(full.waterfall.map((point) => [point.delta, point.cumulative])).toEqual([[100000, 1100000], [50000, 1150000]]);
    expect(full.rows.map((row) => row.cumulativeBudget)).toEqual([1150000, 1100000, 1150000]);
    // An internal reader (the data-quality rule) that does not say reads the whole.
    expect((await service.listBudgetRevisions({ orgId: "org-1", projectId: "p1" })).summary.originalBudget).toBe(1000000);
  });

  it("withholds every figure built on the contract value from anyone else, and keeps the changes", async () => {
    const withheld = await service.listBudgetRevisions({ orgId: "org-1", projectId: "p1", contractValueReadable: false });
    expect(withheld.summary).toEqual({ originalBudget: null, netChange: 150000, currentBudget: null, contractValueWithheld: true });
    expect(withheld.waterfall.map((point) => [point.ref, point.delta, point.cumulative])).toEqual([["BR-01", 100000, null], ["BR-02", 50000, null]]);
    expect(withheld.rows.map((row) => [row.ref, row.amount, row.cumulativeBudget, row.contractValueWithheld])).toEqual([["BR-02", 50000, null, true], ["BR-01", 100000, null, true], ["BR-03", 20000, null, true]]);
    expect(JSON.stringify(withheld)).not.toMatch(/1000000|1100000|1150000/);
  });

  it("answers a created or edited revision without its running total to a writer who may not read the terms", async () => {
    const created = await service.createBudgetRevision({ ...base, payload: { title: "Steel", changeType: "addition", amount: 100000 }, contractValueReadable: false });
    expect(created).toMatchObject({ cumulativeBudget: null, contractValueWithheld: true, amount: 100000 });
    expect(mockPrisma.budgetRevision.create.mock.calls[0][0].data.cumulativeBudget).toBe(1000000);
    const shown = await service.createBudgetRevision({ ...base, payload: { title: "Steel", changeType: "addition", amount: 100000 }, contractValueReadable: true });
    expect(Number(shown.cumulativeBudget)).toBe(1000000);
    existing = { id: "br-1", projectId: "p1", status: "draft", title: "Steel", changeType: "addition", amount: 100000, cumulativeBudget: 1000000, effectiveDate: new Date("2027-01-01"), approvedBy: null, approvedAt: null, notes: null, linkedChangeOrder: null };
    const edited = await service.updateBudgetRevision({ ...base, revisionId: "br-1", payload: { title: "Steel (rev A)" }, contractValueReadable: false });
    expect(edited).toMatchObject({ title: "Steel (rev A)", cumulativeBudget: null, contractValueWithheld: true });
  });
});
