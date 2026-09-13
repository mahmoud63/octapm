/**
 * A budget revision is approved only by someone who may approve cost
 * (Phase 21D, CX21-453).
 */
let existing = null;
const mockPrisma = {
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
