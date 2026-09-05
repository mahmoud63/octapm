const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", name: "Tower", contractValue: 1000000 })) },
  costCode: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ id: "code-co", ...data })) },
  projectCostCode: { findMany: jest.fn(async () => []), create: jest.fn(async ({ data }) => ({ id: "pcc-1", ...data })), update: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 0 })) },
  budgetLine: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), create: jest.fn(), update: jest.fn() },
  budgetLineChange: { create: jest.fn(async ({ data }) => ({ id: "chg", ...data })), deleteMany: jest.fn(async () => ({ count: 0 })) },
  budgetLineActivityAllocation: { findMany: jest.fn(async () => []), deleteMany: jest.fn(async () => ({ count: 0 })), create: jest.fn(async ({ data }) => ({ id: "alloc", ...data })), update: jest.fn(async () => ({})) },
  activity: { findMany: jest.fn(async () => []) },
  activityBoqAllocation: { findMany: jest.fn(async () => []) },
  changeOrderActivityLink: { findMany: jest.fn(async () => []) },
  changeOrder: { findFirst: jest.fn(), update: jest.fn() },
  reportingPeriod: { findFirst: jest.fn(async () => ({ code: "P03" })) },
  budgetSnapshot: { upsert: jest.fn(async ({ create }) => ({ id: "snap-1", ...create })), create: jest.fn(), findMany: jest.fn(async () => []), findFirst: jest.fn() },
};
const mockAudit = { ENTITY_TYPES: { BUDGET_LINE: "budget_line", BUDGET_SNAPSHOT: "budget_snapshot" }, ACTIONS: { CREATED: "created", UPDATED: "updated", ARCHIVED: "archived" }, recordEvent: jest.fn(async () => ({})) };
const mockAllocationTotals = jest.fn(async () => new Map());

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../activity-boq-allocation.service", () => ({ getApprovedActivityAllocationTotals: (...args) => mockAllocationTotals(...args) }));

const service = require("../budget.service");

const CODE = { id: "code-1", code: "03-300", name: "Cast-in-place concrete", category: "material", parentId: null };
const line = (overrides = {}) => ({
  id: "line-1",
  orgId: "org-1",
  projectId: "project-1",
  costCodeId: CODE.id,
  costCode: CODE,
  costType: "material",
  description: null,
  originalBudget: 100000,
  committed: 20000,
  actual: 15000,
  forecast: null,
  status: "active",
  sortOrder: 0,
  changes: [],
  allocations: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("budget by cost code", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAllocationTotals.mockResolvedValue(new Map());
    mockPrisma.budgetLine.findMany.mockResolvedValue([]);
  });

  it("derives revised budget, forecast and variance from the ledger", () => {
    const derived = service.deriveLine(
      line({
        changes: [
          { kind: "change_order", amount: 12000 },
          { kind: "revision", amount: -2000 },
          { kind: "transfer_in", amount: 5000 },
          { kind: "transfer_out", amount: -1000 },
        ],
        allocations: [{ weight: 60, amount: 68400, activity: { isActive: true } }, { weight: 40, amount: 45600, activity: { isActive: true } }],
      })
    );
    expect(derived).toMatchObject({ original: 100000, approvedChanges: 12000, revisions: 2000, revised: 114000, committed: 20000, actual: 15000, forecast: 114000, variance: 0, allocatedWeight: 100, allocatedAmount: 114000, unallocatedAmount: 0 });
    expect(service.deriveLine(line({ forecast: 120000 })).variance).toBe(-20000);
    expect(service.deriveLine(line({ actual: 130000 })).forecast).toBe(130000);
  });

  it("totals lines by cost type and counts under-allocated lines", () => {
    const items = [service.serializeLine(line()), service.serializeLine(line({ id: "line-2", costType: "labour", originalBudget: 50000, allocations: [{ weight: 100, amount: 50000, activity: { isActive: true } }] }))];
    const summary = service.summarize(items);
    expect(summary.totals.revisedBudget).toBe(150000);
    expect(summary.byType.map((row) => row.costType)).toEqual(["material", "labour"]);
    expect(summary.underAllocated).toBe(1);
  });

  it("validates allocation weights", () => {
    expect(() => service.normalizeAllocations([{ activityId: "a", weight: 60 }, { activityId: "b", weight: 50 }])).toThrow(expect.objectContaining({ code: "BUDGET_ALLOCATION_OVER" }));
    expect(() => service.normalizeAllocations([{ activityId: "a", weight: 60 }, { activityId: "a", weight: 10 }])).toThrow(expect.objectContaining({ code: "BUDGET_ALLOCATION_DUPLICATE" }));
    expect(service.normalizeAllocations([{ activityId: "a", weight: "60" }, { activityId: "b", weight: 0 }])).toEqual([{ activityId: "a", weight: 60, source: "manual" }]);
  });

  it("creates a line, selecting its cost code for the project, and refuses duplicates", async () => {
    mockPrisma.costCode.findMany.mockResolvedValue([{ id: CODE.id }]);
    mockPrisma.budgetLine.create.mockImplementation(async ({ data }) => line({ ...data, id: "line-new" }));
    const created = await service.createBudgetLine({ orgId: "org-1", projectId: "project-1", payload: { costCodeId: CODE.id, costType: "Material", originalBudget: "250000.456" }, actor: { id: "user-1", role: "cost_controller" } });
    expect(mockPrisma.projectCostCode.create).toHaveBeenCalledWith({ data: expect.objectContaining({ costCodeId: CODE.id, projectId: "project-1" }) });
    expect(created.originalBudget).toBe(250000.46);
    expect(created.costType).toBe("material");
    mockPrisma.budgetLine.findFirst.mockResolvedValueOnce({ id: "line-1", status: "active" });
    await expect(service.createBudgetLine({ orgId: "org-1", projectId: "project-1", payload: { costCodeId: CODE.id, costType: "material" } })).rejects.toMatchObject({ code: "BUDGET_LINE_DUPLICATE" });
  });

  it("stores allocations with amounts from the revised budget", async () => {
    mockPrisma.budgetLine.findFirst.mockResolvedValue(line({ changes: [{ kind: "change_order", amount: 20000 }] }));
    mockPrisma.activity.findMany.mockResolvedValue([{ id: "act-1" }, { id: "act-2" }]);
    await service.setLineAllocations({ orgId: "org-1", projectId: "project-1", lineId: "line-1", payload: { allocations: [{ activityId: "act-1", weight: 75 }, { activityId: "act-2", weight: 25 }] } });
    expect(mockPrisma.budgetLineActivityAllocation.deleteMany).toHaveBeenCalledWith({ where: { budgetLineId: "line-1" } });
    expect(mockPrisma.budgetLineActivityAllocation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ activityId: "act-1", weight: 75, amount: 90000 }) });
    expect(mockPrisma.budgetLineActivityAllocation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ activityId: "act-2", weight: 25, amount: 30000 }) });
  });

  it("suggests weights from BOQ items matching the cost code, else evenly by approved budget", async () => {
    mockPrisma.budgetLine.findFirst.mockResolvedValue(line());
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { activityId: "act-1", amount: 30000, boqItem: { code: "03-300.1" }, activity: { id: "act-1", name: "Slab" } },
      { activityId: "act-2", amount: 10000, boqItem: { code: "03-300.2" }, activity: { id: "act-2", name: "Columns" } },
      { activityId: "act-3", amount: 99999, boqItem: { code: "09-100" }, activity: { id: "act-3", name: "Paint" } },
    ]);
    const suggestion = await service.suggestAllocations({ orgId: "org-1", projectId: "project-1", lineId: "line-1" });
    expect(suggestion.basis).toBe("boq");
    expect(suggestion.items.map((row) => [row.activityId, row.weight])).toEqual([["act-1", 75], ["act-2", 25]]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([{ activityId: "act-3", amount: 100, boqItem: { code: "09-100" }, activity: { id: "act-3", name: "Paint" } }]);
    const fallback = await service.suggestAllocations({ orgId: "org-1", projectId: "project-1", lineId: "line-1" });
    expect(fallback.basis).toBe("even");
    expect(fallback.items[0].weight).toBe(100);
  });

  it("transfers only what a line has, writing both ledger rows", async () => {
    mockPrisma.budgetLine.findFirst.mockImplementation(async ({ where }) => (where.id === "line-1" ? line() : line({ id: "line-2", costType: "labour", originalBudget: 10000 })));
    await expect(service.transferBudget({ orgId: "org-1", projectId: "project-1", payload: { fromLineId: "line-1", toLineId: "line-2", amount: 500000 } })).rejects.toMatchObject({ code: "BUDGET_TRANSFER_EXCEEDS" });
    await service.transferBudget({ orgId: "org-1", projectId: "project-1", payload: { fromLineId: "line-1", toLineId: "line-2", amount: 25000, note: "Rebar to labour" }, actor: { id: "user-1" } });
    expect(mockPrisma.budgetLineChange.create).toHaveBeenCalledWith({ data: expect.objectContaining({ budgetLineId: "line-1", kind: "transfer_out", amount: -25000, counterpartLineId: "line-2" }) });
    expect(mockPrisma.budgetLineChange.create).toHaveBeenCalledWith({ data: expect.objectContaining({ budgetLineId: "line-2", kind: "transfer_in", amount: 25000, counterpartLineId: "line-1" }) });
  });

  it("applies an approved change order to its line, the activity's lines, or the change-orders line", async () => {
    const order = { id: "co-1", ref: "VO-01", value: 10000, activityId: "act-1", category: "Subcontract", budgetLineId: null };
    // 1) explicit line
    mockPrisma.budgetLine.findFirst.mockResolvedValueOnce({ id: "line-9" });
    let applied = await service.applyChangeOrderToBudgetLines({ orgId: "org-1", projectId: "project-1", order: { ...order, budgetLineId: "line-9" } });
    expect(applied.lines).toEqual([{ lineId: "line-9", amount: 10000 }]);
    expect(mockPrisma.budgetLineChange.deleteMany).toHaveBeenCalledWith({ where: { projectId: "project-1", changeOrderId: "co-1" } });
    // 2) split across the lines allocated to the activity (60 / 40)
    jest.clearAllMocks();
    mockPrisma.budgetLineActivityAllocation.findMany.mockResolvedValueOnce([{ budgetLineId: "line-1", amount: 60 }, { budgetLineId: "line-2", amount: 40 }]);
    applied = await service.applyChangeOrderToBudgetLines({ orgId: "org-1", projectId: "project-1", order });
    expect(applied.lines).toEqual([{ lineId: "line-1", amount: 6000 }, { lineId: "line-2", amount: 4000 }]);
    // 3) nothing allocated → "CO" cost code + line for the order's cost type
    jest.clearAllMocks();
    mockPrisma.budgetLineActivityAllocation.findMany.mockResolvedValueOnce([]);
    mockPrisma.costCode.findFirst.mockResolvedValueOnce(null);
    mockPrisma.costCode.findMany.mockResolvedValueOnce([{ id: "code-co" }]);
    mockPrisma.budgetLine.findFirst.mockResolvedValueOnce(null);
    mockPrisma.budgetLine.create.mockResolvedValueOnce({ id: "line-co" });
    applied = await service.applyChangeOrderToBudgetLines({ orgId: "org-1", projectId: "project-1", order: { ...order, activityId: null } });
    expect(mockPrisma.costCode.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ code: "CO", name: "Change orders" }) }));
    expect(mockPrisma.budgetLine.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ costType: "subcontract", description: "Unassigned approved changes" }) }));
    expect(applied.lines).toEqual([{ lineId: "line-co", amount: 10000 }]);
  });

  it("reconciles activity budgets against budget lines", async () => {
    mockPrisma.activity.findMany.mockResolvedValue([{ id: "act-1", name: "Slab", activityCode: "A100", budget: 0 }, { id: "act-2", name: "Columns", activityCode: "A200", budget: 0 }]);
    mockAllocationTotals.mockResolvedValue(new Map([["act-1", { amount: 60000 }], ["act-2", { amount: 40000 }]]));
    mockPrisma.changeOrderActivityLink.findMany.mockResolvedValue([{ activityId: "act-1", approvedCostImpact: 5000 }]);
    mockPrisma.budgetLine.findMany.mockResolvedValue([
      line({ originalBudget: 100000, changes: [{ kind: "change_order", amount: 5000 }], allocations: [{ activityId: "act-1", weight: 61.9048, amount: 65000, activity: { isActive: true } }, { activityId: "act-2", weight: 38.0952, amount: 40000, activity: { isActive: true } }] }),
    ]);
    const report = await service.reconcile({ orgId: "org-1", projectId: "project-1" });
    expect(report.totals).toMatchObject({ activityBudget: 105000, budgetLines: 105000, difference: 0 });
    expect(report.balanced).toBe(true);
    mockPrisma.budgetLine.findMany.mockResolvedValue([line({ originalBudget: 90000, allocations: [{ activityId: "act-1", weight: 100, amount: 90000, activity: { isActive: true } }] })]);
    const off = await service.reconcile({ orgId: "org-1", projectId: "project-1" });
    expect(off.balanced).toBe(false);
    expect(off.totals.difference).toBe(-15000);
    expect(off.mismatches.map((row) => row.activityId)).toEqual(["act-1", "act-2"]);
    expect(off.activitiesWithoutLines.map((row) => row.activityId)).toEqual(["act-2"]);
  });

  it("freezes the budget when a reporting period locks, and skips without the model", async () => {
    mockPrisma.budgetLine.findMany.mockResolvedValue([line()]);
    const result = await service.snapshotForPeriod({ orgId: "org-1", projectId: "project-1", periodId: "period-1", userId: "user-1" });
    expect(result).toEqual({ id: "snap-1", label: "Period P03" });
    expect(mockPrisma.budgetSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { reportingPeriodId: "period-1" }, create: expect.objectContaining({ totalsJson: expect.objectContaining({ revisedBudget: 100000 }) }) }));
    expect(await service.snapshotForPeriod({ tx: {}, orgId: "org-1", projectId: "project-1", periodId: "period-1" })).toBeNull();
  });

  it("maps change-order categories to cost types", () => {
    expect(service.costTypeForOrder({ category: "Labor" })).toBe("labour");
    expect(service.costTypeForOrder({ category: "Plant" })).toBe("equipment");
    expect(service.costTypeForOrder({ category: "Design" })).toBe("other");
  });
});
