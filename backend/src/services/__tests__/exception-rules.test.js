/**
 * PC-7b exception rules, one kind at a time, with the owner services mocked
 * at the rule boundary: a rule is thin — it asks the owner for two figures,
 * compares them with its documented threshold, and states both with their
 * basis. Nothing here proves a figure (the live suite does); it proves each
 * rule's comparison, threshold, unit rule, scope and severity.
 */
jest.mock("../../config/db", () => ({
  prisma: {
    boqItem: { findMany: jest.fn() },
    activity: { findMany: jest.fn() },
    activityProgress: { findMany: jest.fn() },
    project: { findFirst: jest.fn() },
    activityProgressMethod: { findMany: jest.fn() },
    ipcCertificate: { findMany: jest.fn() },
  },
}));
jest.mock("../activity-boq-allocation.service", () => ({ listAllocations: jest.fn(), buildAllocationSummary: jest.fn() }));
jest.mock("../quantity-progress.service", () => ({ installedByActivity: jest.fn(), installedByBoqItem: jest.fn() }));
jest.mock("../quantity-views.service", () => ({
  quantityBlocks: jest.fn(),
  BASIS: { installed: "INSTALLED-BASIS", certified: "CERTIFIED-BASIS" },
}));
jest.mock("../ipc.service", () => ({ getApprovedVariationAllowances: jest.fn() }));
jest.mock("../progress.service", () => ({ normalizeMethod: (method) => (method === "milestone" ? "manual" : method) }));
jest.mock("../uom.service", () => ({ unitKey: (unit) => String(unit || "").trim().toLowerCase() }));
jest.mock("../budget.service", () => ({ listBudgetLines: jest.fn() }));
jest.mock("../commitment.service", () => ({ listCommitments: jest.fn(), POSTING_STATUSES: ["executed", "closed"] }));
jest.mock("../cost-ledger.service", () => ({ certifiedAgainstCommitment: jest.fn() }));
jest.mock("../earned-value.service", () => ({ buildOfficialEvReport: jest.fn() }));

const { prisma } = require("../../config/db");
const allocationService = require("../activity-boq-allocation.service");
const quantityCore = require("../quantity-progress.service");
const quantityViews = require("../quantity-views.service");
const ipcService = require("../ipc.service");
const budgetService = require("../budget.service");
const commitmentService = require("../commitment.service");
const costLedger = require("../cost-ledger.service");
const evService = require("../earned-value.service");
const registry = require("../exception-rules");
const { THRESHOLDS } = require("../exception-rules/_thresholds");

const ORG = "org-1";
const PROJECT = "project-1";
const rule = (kind) => registry.ruleFor(kind);
const context = (extra = {}) => {
  const cache = new Map();
  const notes = [];
  return {
    orgId: ORG,
    projectId: PROJECT,
    projectName: "Riverside",
    currency: "USD",
    cutoff: null,
    // The evaluation's own time: a week after the project's start (index 5), before every planned finish below.
    now: new Date("2026-01-12T15:00:00.000Z"),
    memo(key, read) {
      if (!cache.has(key)) cache.set(key, Promise.resolve().then(read));
      return cache.get(key);
    },
    note: (message) => notes.push(message),
    notes,
    ...extra,
  };
};
const run = (kind, ctx = context()) => rule(kind).evaluate({ orgId: ORG, projectId: PROJECT, cutoff: ctx.cutoff, ctx });

const allocation = (overrides = {}) => ({
  id: "alloc-1",
  activityId: "act-1",
  boqItemId: "item-1",
  quantity: 60,
  unitCode: "m3",
  locationId: null,
  boqItem: { id: "item-1", code: "1.1", description: "Concrete", unitCode: "m3", wbsNodeId: "wbs-1", locationId: "loc-1", costCodeId: "cc-1" },
  ...overrides,
});
const activityRow = (overrides = {}) => ({ id: "act-1", name: "Pour", activityCode: "A1", isActive: true, isCritical: false, earlyFinish: null, baselineFinish: null, totalFloat: 3, wbsNodeId: null, locationId: null, ...overrides });

beforeEach(() => {
  jest.resetAllMocks();
  prisma.activity.findMany.mockResolvedValue([activityRow()]);
  prisma.activityProgressMethod.findMany.mockResolvedValue([{ activityId: "act-1", method: "quantity" }]);
  prisma.activityProgress.findMany.mockResolvedValue([]);
  // The CPM index's anchor: a Monday start on the five-day calendar.
  prisma.project.findFirst.mockResolvedValue({ startDate: new Date("2026-01-05T00:00:00.000Z"), projectCalendar: null, timezone: "UTC", org: { defaultTimezone: null } });
  prisma.boqItem.findMany.mockResolvedValue([{ id: "item-1", code: "1.1", description: "Concrete", unit: "m3", unitCode: "m3", qty: 100, amount: 10000, wbsNodeId: "wbs-1", locationId: null, costCodeId: "cc-1" }]);
  allocationService.listAllocations.mockResolvedValue({ allocations: [allocation()], summary: { items: [] } });
  ipcService.getApprovedVariationAllowances.mockImplementation(async ({ pairs }) => pairs.map(() => ({ quantity: 0, amount: 0 })));
});

describe("the registry", () => {
  // Every kind the folder states, by name: [file, module, boqDerived]. The §1
  // overrun kinds (quantity.js, money.js, schedule.js) and the §7
  // data-quality kinds (data-quality.js) are rules of the one registry.
  const OVERRUN_KINDS = Object.freeze({
    quantity_over_allocation: ["quantity.js", "boq", true],
    quantity_over_boq: ["quantity.js", "boq", true],
    certified_over_installed: ["quantity.js", "boq", true],
    allocation_over_capacity: ["quantity.js", "boq", true],
    certified_over_earned: ["money.js", "cost", true],
    committed_over_budget: ["money.js", "cost", false],
    actual_over_committed: ["money.js", "cost", false],
    forecast_over_revised: ["money.js", "cost", false],
    schedule_slip_on_mapped_item: ["schedule.js", "schedule", false],
  });
  const DATA_QUALITY_KINDS = Object.freeze({
    budget_truths_disagree: ["data-quality.js", "cost", false],
    forecast_without_provenance: ["data-quality.js", "cost", true],
    activity_budget_mismatch: ["data-quality.js", "cost", true],
    committed_definition_mixed: ["data-quality.js", "cost", false],
    equipment_cost_unposted: ["data-quality.js", "cost", false],
    unit_unresolved: ["data-quality.js", "boq", true],
    unit_mismatch: ["data-quality.js", "boq", true],
    structure_missing: ["data-quality.js", "boq", true],
    progress_stale: ["data-quality.js", "progress", false],
    period_not_locked: ["data-quality.js", "cost", false],
    ev_basis_divergence: ["data-quality.js", "cost", true],
    readiness_override_active: ["data-quality.js", "cost", true],
    orphan_change_link: ["data-quality.js", "cost", false],
    change_order_possible_duplicate: ["data-quality.js", "cost", false],
  });

  it("loads the §1 overrun kinds and the §7 data-quality kinds by name, each from its file with its module and BOQ flag — and nothing else", () => {
    const meta = registry.kindMeta();
    const expected = { ...OVERRUN_KINDS, ...DATA_QUALITY_KINDS };
    expect(Object.keys(meta).sort()).toEqual(Object.keys(expected).sort());
    const files = Object.fromEntries(registry.getRules().map((rule) => [rule.kind, rule.file]));
    for (const [kind, [file, module, boqDerived]] of Object.entries(expected)) {
      expect([kind, files[kind], meta[kind].module, meta[kind].boqDerived]).toEqual([kind, file, module, boqDerived]);
    }
    // The data-quality file states exactly the §7 kinds (its own list agrees).
    expect([...require("../exception-rules/data-quality").DATA_QUALITY_KINDS].sort()).toEqual(Object.keys(DATA_QUALITY_KINDS).sort());
  });

  it("refuses the real rule files when a kind is defined twice across them", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-real-"));
    try {
      const real = path.join(__dirname, "..", "exception-rules");
      for (const file of ["quantity.js", "money.js", "schedule.js", "data-quality.js"]) {
        fs.writeFileSync(path.join(dir, file), `module.exports = require(${JSON.stringify(path.join(real, file))});`);
      }
      expect(registry.loadRules(dir).length).toBe(Object.keys(OVERRUN_KINDS).length + Object.keys(DATA_QUALITY_KINDS).length);
      // A second definition of a data-quality kind, beside the real files.
      fs.writeFileSync(path.join(dir, "zz-duplicate.js"), "module.exports = [{ kind: 'progress_stale', severity: 'info', subjectType: 'activity', module: 'progress', boqDerived: false, evaluate: async () => [] }];");
      expect(() => registry.loadRules(dir)).toThrow(/exception rule progress_stale is defined in data-quality\.js and zz-duplicate\.js/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a rule file that is not an array, a malformed rule and a kind defined twice", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
    const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
    const valid = "{ kind: 'x_kind', severity: 'info', subjectType: 'project', module: 'cost', boqDerived: false, evaluate: async () => [] }";
    write("a.js", `module.exports = [${valid}];`);
    write("_helper.js", "module.exports = { not: 'a rule file' };");
    expect(registry.loadRules(dir).map((r) => r.kind)).toEqual(["x_kind"]);
    write("b.js", `module.exports = [${valid}];`);
    expect(() => registry.loadRules(dir)).toThrow(/defined in a\.js and b\.js/);
    fs.unlinkSync(path.join(dir, "b.js"));
    write("c.js", "module.exports = { kind: 'y' };");
    expect(() => registry.loadRules(dir)).toThrow(/must export an array/);
    fs.unlinkSync(path.join(dir, "c.js"));
    write("d.js", "module.exports = [{ kind: 'y_kind', severity: 'loud', subjectType: 'project', module: 'cost', boqDerived: false, evaluate: async () => [] }];");
    expect(() => registry.loadRules(dir)).toThrow(/severity/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("quantity_over_allocation", () => {
  const installed = (quantity, unitCode = "m3") => new Map([["act-1", { installed: [{ boqItemId: "item-1", unitCode, quantity, entries: 3 }], asOf: "x" }]]);

  it("raises installed above the authorised quantity (allocation + approved variation), from the core's installed and the IPC cap's variation", async () => {
    quantityCore.installedByActivity.mockResolvedValue(installed(70));
    const rows = await run("quantity_over_allocation");
    expect(quantityCore.installedByActivity).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT, activityIds: ["act-1"], cutoffDate: null });
    expect(ipcService.getApprovedVariationAllowances).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT, pairs: [{ allocationId: "alloc-1", boqItemId: "item-1" }] }));
    expect(rows).toEqual([
      expect.objectContaining({
        subjectType: "allocation",
        subjectId: "alloc-1",
        severity: "critical",
        measured: expect.objectContaining({ value: 70, unitCode: "m3", basis: expect.stringContaining("installedByActivity") }),
        limit: expect.objectContaining({ value: 60, unitCode: "m3", basis: expect.stringContaining("getApprovedVariationAllowances") }),
        groupKeys: { wbsNodeId: "wbs-1", locationId: "loc-1", costCodeId: "cc-1" },
      }),
    ]);
    expect(rows[0].data).toMatchObject({ allocationQuantity: 60, approvedVariationQuantity: 0, exceedance: 10 });
  });

  it("an approved variation raises the limit: 70 against 60 + 15 is no exception; 65 against 60 is a warning (within 10 %)", async () => {
    quantityCore.installedByActivity.mockResolvedValue(installed(70));
    ipcService.getApprovedVariationAllowances.mockResolvedValue([{ quantity: 15, amount: 0 }]);
    expect(await run("quantity_over_allocation")).toEqual([]);
    ipcService.getApprovedVariationAllowances.mockResolvedValue([{ quantity: 0, amount: 0 }]);
    quantityCore.installedByActivity.mockResolvedValue(installed(65));
    expect((await run("quantity_over_allocation"))[0].severity).toBe("warning");
  });

  it("equal or within the tolerance is not an exception", async () => {
    quantityCore.installedByActivity.mockResolvedValue(installed(60 + THRESHOLDS.quantity_over_allocation.tolerance / 2));
    expect(await run("quantity_over_allocation")).toEqual([]);
  });

  it("an activity not measured by quantity, or inactive, is not read; another unit is never compared", async () => {
    prisma.activityProgressMethod.findMany.mockResolvedValue([{ activityId: "act-1", method: "percent" }]);
    expect(await run("quantity_over_allocation")).toEqual([]);
    expect(quantityCore.installedByActivity).not.toHaveBeenCalled();
    prisma.activityProgressMethod.findMany.mockResolvedValue([{ activityId: "act-1", method: "quantity" }]);
    prisma.activity.findMany.mockResolvedValue([activityRow({ isActive: false })]);
    expect(await run("quantity_over_allocation")).toEqual([]);
    prisma.activity.findMany.mockResolvedValue([activityRow()]);
    quantityCore.installedByActivity.mockResolvedValue(installed(900, "t"));
    const ctx = context();
    expect(await run("quantity_over_allocation", ctx)).toEqual([]);
    expect(ctx.notes.join(" ")).toMatch(/not in the allocation's unit/);
  });
});

describe("quantity_over_boq and certified_over_installed (the quantity views' figures)", () => {
  const block = ({ installed = 0, certified = 0, flag = false, unitMatch = true, installedValue } = {}) =>
    new Map([
      [
        "item-1",
        {
          unitCode: "m3",
          figures: { installed: { value: installedValue === undefined ? installed : installedValue, unitCode: "m3", unitMatch, entries: 4 } },
          comparisons: { certifiedOverInstalled: { flag, certified, installed, unitCode: "m3", installedFigure: "approved_entries", basis: "RAW-COMPARISON" } },
        },
      ],
    ]);

  it("quantity_over_boq: Σ installed above the BOQ quantity + approved variation naming the item", async () => {
    quantityViews.quantityBlocks.mockResolvedValue({ blocks: block({ installed: 110 }) });
    const rows = await run("quantity_over_boq");
    expect(quantityViews.quantityBlocks).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, projectId: PROJECT, cutoffDate: null }));
    expect(ipcService.getApprovedVariationAllowances).toHaveBeenCalledWith(expect.objectContaining({ pairs: [{ boqItemId: "item-1" }] }));
    expect(rows).toEqual([
      expect.objectContaining({
        subjectType: "boq_item",
        subjectId: "item-1",
        severity: "warning",
        measured: { value: 110, unitCode: "m3", basis: "INSTALLED-BASIS" },
        limit: expect.objectContaining({ value: 100, basis: expect.stringContaining("BoqItem.qty") }),
      }),
    ]);
    ipcService.getApprovedVariationAllowances.mockResolvedValue([{ quantity: 10, amount: 0 }]);
    expect(await run("quantity_over_boq")).toEqual([]);
  });

  it("quantity_over_boq: an installed figure that is not available, or not in the row's unit, is never compared", async () => {
    quantityViews.quantityBlocks.mockResolvedValue({ blocks: block({ installedValue: null }) });
    expect(await run("quantity_over_boq")).toEqual([]);
    quantityViews.quantityBlocks.mockResolvedValue({ blocks: block({ installed: 500, unitMatch: false }) });
    expect(await run("quantity_over_boq")).toEqual([]);
  });

  it("certified_over_installed: the views' raw comparison, raised only when every approved allocation of the item is on a quantity-method activity", async () => {
    quantityViews.quantityBlocks.mockResolvedValue({ blocks: block({ installed: 10, certified: 20, flag: true }) });
    const rows = await run("certified_over_installed");
    expect(rows).toEqual([
      expect.objectContaining({
        subjectId: "item-1",
        measured: { value: 20, unitCode: "m3", basis: "CERTIFIED-BASIS" },
        limit: { value: 10, unitCode: "m3", basis: "INSTALLED-BASIS — RAW-COMPARISON" },
      }),
    ]);
    expect(rows[0].severity).toBeUndefined();
    expect(rule("certified_over_installed").severity).toBe("critical");
    prisma.activityProgressMethod.findMany.mockResolvedValue([{ activityId: "act-1", method: "percent" }]);
    expect(await run("certified_over_installed")).toEqual([]);
    prisma.activityProgressMethod.findMany.mockResolvedValue([{ activityId: "act-1", method: "quantity" }]);
    quantityViews.quantityBlocks.mockResolvedValue({ blocks: block({ installed: 10, certified: 20, flag: false }) });
    expect(await run("certified_over_installed")).toEqual([]);
  });
});

describe("allocation_over_capacity (the allocation summary)", () => {
  it("raises approved allocations above the item's quantity, else its amount; nothing when within", async () => {
    allocationService.buildAllocationSummary.mockResolvedValue({
      items: [
        { boqItemId: "q", code: "Q", quantity: 10, amount: 100, approvedAllocatedQuantity: 12, approvedAllocatedAmount: 100, unitCode: "m", mappingState: "complete" },
        { boqItemId: "a", code: "A", quantity: 10, amount: 100, approvedAllocatedQuantity: 10, approvedAllocatedAmount: 150, unitCode: "m", mappingState: "over" },
        { boqItemId: "ok", code: "OK", quantity: 10, amount: 100, approvedAllocatedQuantity: 10, approvedAllocatedAmount: 100.005, unitCode: "m", mappingState: "complete" },
      ],
    });
    const rows = await run("allocation_over_capacity");
    expect(allocationService.buildAllocationSummary).toHaveBeenCalledWith({ projectId: PROJECT });
    expect(rows.map((row) => [row.subjectId, row.measured.value, row.limit.value, row.measured.unitCode, row.data.measure])).toEqual([
      ["q", 12, 10, "m", "quantity"],
      ["a", 150, 100, "USD", "amount"],
    ]);
  });
});

describe("money kinds", () => {
  const line = (overrides) => ({ id: "line-1", status: "active", costCodeId: "cc-1", costType: "material", costCode: { code: "03", name: "Concrete" }, committed: 0, revisedBudget: 1000, forecast: 1000, forecastIsManual: false, actual: 0, committedFromCommitments: 0, committedManual: 0, ...overrides });

  it("committed_over_budget: the register's committed above its revised budget", async () => {
    budgetService.listBudgetLines.mockResolvedValue({ items: [line({ committed: 1050 }), line({ id: "line-2", committed: 1000.005 }), line({ id: "line-3", committed: 1500, status: "archived" })] });
    const rows = await run("committed_over_budget");
    expect(budgetService.listBudgetLines).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT });
    expect(rows).toEqual([
      expect.objectContaining({ subjectType: "budget_line", subjectId: "line-1", severity: "warning", measured: expect.objectContaining({ value: 1050, unitCode: "USD" }), limit: expect.objectContaining({ value: 1000 }), groupKeys: { costCodeId: "cc-1" } }),
    ]);
    budgetService.listBudgetLines.mockResolvedValue({ items: [line({ committed: 1200 })] });
    expect((await run("committed_over_budget"))[0].severity).toBe("critical");
  });

  it("actual_over_committed: the ledger total on an executed commitment above its revised value; a draft commitment is not read", async () => {
    commitmentService.listCommitments.mockResolvedValue({
      items: [
        { id: "c-1", ref: "SC-1", title: "Formwork", status: "executed", currency: "USD", revised: 1000, original: 900, approvedChanges: 100 },
        { id: "c-2", ref: "SC-2", status: "draft", revised: 10 },
      ],
    });
    costLedger.certifiedAgainstCommitment.mockResolvedValue(1080);
    const rows = await run("actual_over_committed");
    expect(commitmentService.listCommitments).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT, query: {}, viewer: null });
    expect(costLedger.certifiedAgainstCommitment).toHaveBeenCalledTimes(1);
    expect(costLedger.certifiedAgainstCommitment).toHaveBeenCalledWith({ projectId: PROJECT, commitmentId: "c-1" });
    expect(rows).toEqual([expect.objectContaining({ subjectId: "c-1", severity: "warning", measured: expect.objectContaining({ value: 1080, basis: expect.stringContaining("certifiedAgainstCommitment") }), limit: expect.objectContaining({ value: 1000, basis: expect.stringContaining("totalsFor") }) })]);
    costLedger.certifiedAgainstCommitment.mockResolvedValue(1000);
    expect(await run("actual_over_committed")).toEqual([]);
  });

  it("forecast_over_revised: the official EAC above revised BAC (critical below the CPI alert) and a line forecast above revised", async () => {
    evService.buildOfficialEvReport.mockResolvedValue({ eac: 1250, totalBudget: 1000, cpi: 0.8, spi: 1, eacBasis: "revised_bac_over_cpi", reporting: { cutoffLocalDate: "2026-09-30", isSnapshot: false } });
    budgetService.listBudgetLines.mockResolvedValue({
      items: [
        line({ forecast: 1100, forecastIsManual: true }),
        line({ id: "line-2", forecast: 1000 }),
        // An archived line is no longer budgeted: its forecast above its revised raises nothing.
        line({ id: "line-3", status: "archived", forecast: 1800, forecastIsManual: true }),
      ],
    });
    const rows = await run("forecast_over_revised");
    expect(evService.buildOfficialEvReport).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT, useLockedSnapshot: true, includeReadiness: false });
    expect(rows.map((row) => [row.subjectType, row.subjectId, row.severity, row.measured.value, row.limit.value])).toEqual([
      ["project", PROJECT, "critical", 1250, 1000],
      ["budget_line", "line-1", "warning", 1100, 1000],
    ]);
    expect(rows[1].measured.basis).toMatch(/typed forecast/);
    evService.buildOfficialEvReport.mockResolvedValue({ eac: 1050, totalBudget: 1000, cpi: 0.95 });
    budgetService.listBudgetLines.mockResolvedValue({ items: [] });
    expect((await run("forecast_over_revised"))[0].severity).toBe("warning");
    evService.buildOfficialEvReport.mockResolvedValue({ eac: 1000, totalBudget: 1000, cpi: 1 });
    expect(await run("forecast_over_revised")).toEqual([]);
  });

  it("forecast_over_revised at an asked cutoff recomputes the period (never the stored snapshot)", async () => {
    const cutoff = new Date("2026-09-30T04:59:59.999Z");
    evService.buildOfficialEvReport.mockResolvedValue({ eac: 0, totalBudget: 0 });
    budgetService.listBudgetLines.mockResolvedValue({ items: [] });
    await run("forecast_over_revised", context({ cutoff }));
    expect(evService.buildOfficialEvReport).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT, cutoffDate: cutoff, useLockedSnapshot: false, includeReadiness: false });
  });

  it("certified_over_earned: the certificate's stored over-certification, read as stored", async () => {
    prisma.ipcCertificate.findMany.mockResolvedValue([
      { id: "ipc-1", period: "IPC-03", status: "certified", certifiedAt: new Date("2026-09-01T00:00:00Z"), overCertificationAmount: "450.50", earnedValueAtCertification: "1000", approvedLimitAtCertification: "1200", certificationOverrideReason: "client instruction" },
    ]);
    const rows = await run("certified_over_earned");
    expect(prisma.ipcCertificate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: PROJECT, status: { in: ["certified", "paid"] } }) }));
    expect(rows).toEqual([
      expect.objectContaining({
        subjectType: "ipc_certificate",
        subjectId: "ipc-1",
        measured: expect.objectContaining({ value: 450.5, unitCode: "USD", basis: expect.stringContaining("overCertificationAmount") }),
        limit: expect.objectContaining({ value: 0 }),
        data: expect.objectContaining({ earnedValueAtCertification: 1000, overrideRecorded: true }),
      }),
    ]);
  });
});

describe("schedule_slip_on_mapped_item", () => {
  const summary = (certifiedValue) => ({ items: [{ boqItemId: "item-1", amount: 6000, certifiedValue }] });

  it("a finish behind its baseline by more than the threshold, on an item with certification pending", async () => {
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 30, baselineFinish: 22 })]);
    allocationService.buildAllocationSummary.mockResolvedValue(summary(1000));
    const rows = await run("schedule_slip_on_mapped_item");
    expect(rows).toEqual([
      expect.objectContaining({
        subjectType: "activity",
        subjectId: "act-1",
        severity: "warning",
        measured: expect.objectContaining({ value: 8, unitCode: "working_day", basis: expect.stringContaining("earlyFinish − Activity.baselineFinish") }),
        limit: expect.objectContaining({ value: THRESHOLDS.schedule_slip_on_mapped_item.thresholdDays }),
      }),
    ]);
    expect(rows[0].measured.basis).toMatch(/change-order impacts are not read/);
    expect(rows[0].data.boq.pendingItems).toEqual([{ boqItemId: "item-1", certifiedValue: 1000, amount: 6000 }]);
  });

  it("nothing when the slip is within the threshold, the item is fully certified, or a date is missing; critical on a critical activity", async () => {
    allocationService.buildAllocationSummary.mockResolvedValue(summary(1000));
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 27, baselineFinish: 22 })]);
    expect(await run("schedule_slip_on_mapped_item")).toEqual([]);
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 40, baselineFinish: 22 })]);
    allocationService.buildAllocationSummary.mockResolvedValue(summary(6000));
    expect(await run("schedule_slip_on_mapped_item")).toEqual([]);
    allocationService.buildAllocationSummary.mockResolvedValue(summary(0));
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 40, baselineFinish: null })]);
    expect(await run("schedule_slip_on_mapped_item")).toEqual([]);
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 29, baselineFinish: 22, isCritical: true })]);
    expect((await run("schedule_slip_on_mapped_item"))[0].severity).toBe("critical");
  });

  it("nothing for a retired (inactive) activity, however far its finish has slipped", async () => {
    allocationService.buildAllocationSummary.mockResolvedValue(summary(0));
    prisma.activity.findMany.mockResolvedValue([activityRow({ isActive: false, earlyFinish: 60, baselineFinish: 22 })]);
    expect(await run("schedule_slip_on_mapped_item")).toEqual([]);
  });

  // Working-day indices from the Monday 2026-01-05 start on the five-day
  // calendar: 2026-01-30 → 19, 2026-02-06 → 24, 2026-03-31 → 61,
  // 2026-07-01 → 127, 2026-10-01 → 193.
  const approved = (overrides) => ({ activityId: "act-1", status: "approved", pctComplete: 100, actualStart: null, actualFinish: null, approvedAt: new Date("2026-07-02T10:00:00Z"), updatedAt: new Date("2026-07-02T10:00:00Z"), ...overrides });
  const slipOf = async (ctx) => {
    const rows = await run("schedule_slip_on_mapped_item", ctx);
    return rows.map((row) => [row.measured.value, row.severity, row.data.finishBasis, row.data.finishDate]);
  };

  it("a late actual finish: the approved progress's actualFinish against the baseline, though the CPM's early finish has not moved", async () => {
    allocationService.buildAllocationSummary.mockResolvedValue(summary(0));
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 20, baselineFinish: 20 })]);
    prisma.activityProgress.findMany.mockResolvedValue([approved({ actualFinish: new Date("2026-07-01T00:00:00Z") })]);
    const rows = await run("schedule_slip_on_mapped_item", context({ now: new Date("2026-10-01T15:00:00Z") }));
    expect(rows.map((row) => [row.measured.value, row.severity, row.data.finishBasis, row.data.finishDate, row.data.actualFinish])).toEqual([[107, "critical", "actual_finish", "2026-07-01", "2026-07-01"]]);
    expect(rows[0].measured.basis).toMatch(/actual finish \(latest approved ActivityProgress\.actualFinish/);
    expect(rows[0].measured.basis).toMatch(/change-order impacts are not read/);
    // An actual finish ahead of the baseline is no slip, however late the early finish reads.
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 40, baselineFinish: 20 })]);
    prisma.activityProgress.findMany.mockResolvedValue([approved({ actualFinish: new Date("2026-01-30T00:00:00Z") })]);
    expect(await slipOf(context({ now: new Date("2026-10-01T15:00:00Z") }))).toEqual([]);
    // Finished (100 %) with no actual finish recorded: when it finished is unknown, so its
    // early finish stands — the data date is never charged to a finished activity.
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 30, baselineFinish: 22 })]);
    prisma.activityProgress.findMany.mockResolvedValue([approved({ pctComplete: 100, actualFinish: null })]);
    expect(await slipOf(context({ now: new Date("2026-10-01T15:00:00Z") }))).toEqual([[8, "warning", "early_finish", null]]);
  });

  it("an overdue, incomplete activity: the data date against the baseline, with or without approved progress", async () => {
    allocationService.buildAllocationSummary.mockResolvedValue(summary(0));
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 20, baselineFinish: 20 })]);
    const october = context({ now: new Date("2026-10-01T15:00:00Z") });
    expect(await slipOf(october)).toEqual([[173, "critical", "data_date", "2026-10-01"]]);
    prisma.activityProgress.findMany.mockResolvedValue([approved({ pctComplete: 40 })]);
    const rows = await run("schedule_slip_on_mapped_item", context({ now: new Date("2026-10-01T15:00:00Z") }));
    expect(rows.map((row) => [row.measured.value, row.data.finishBasis, row.data.pctComplete])).toEqual([[173, "data_date", 40]]);
    expect(rows[0].measured.basis).toMatch(/the data date/);
    // Before its planned finish an incomplete activity stands at its early finish.
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 30, baselineFinish: 22 })]);
    expect(await slipOf(context())).toEqual([[8, "warning", "early_finish", null]]);
  });

  it("the latest approved progress decides (EV's selection: approvedAt, else updatedAt), at the evaluation's cutoff", async () => {
    allocationService.buildAllocationSummary.mockResolvedValue(summary(0));
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 20, baselineFinish: 20 })]);
    // A finish reported in July, then corrected back to 60 % in August: the activity is not finished.
    prisma.activityProgress.findMany.mockResolvedValue([
      approved({ pctComplete: 60, approvedAt: new Date("2026-08-01T10:00:00Z") }),
      approved({ actualFinish: new Date("2026-07-01T00:00:00Z") }),
    ]);
    expect(await slipOf(context({ now: new Date("2026-10-01T15:00:00Z") }))).toEqual([[173, "critical", "data_date", "2026-10-01"]]);
    // A row without approvedAt counts by its updatedAt.
    prisma.activityProgress.findMany.mockResolvedValue([
      approved({ pctComplete: 60, approvedAt: new Date("2026-06-01T10:00:00Z"), updatedAt: new Date("2026-06-01T10:00:00Z") }),
      approved({ actualFinish: new Date("2026-07-01T00:00:00Z"), approvedAt: null, updatedAt: new Date("2026-07-05T10:00:00Z") }),
    ]);
    expect(await slipOf(context({ now: new Date("2026-10-01T15:00:00Z") }))).toEqual([[107, "critical", "actual_finish", "2026-07-01"]]);

    // At an asked cutoff: progress approved by then, and the cutoff's date is the data date.
    prisma.activityProgress.findMany.mockResolvedValue([]);
    const cutoff = new Date("2026-03-31T23:59:59.999Z");
    expect(await slipOf(context({ cutoff, now: new Date("2026-10-01T15:00:00Z") }))).toEqual([[41, "critical", "data_date", "2026-03-31"]]);
    expect(prisma.activityProgress.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "approved",
          activity: { projectId: PROJECT },
          OR: [{ approvedAt: { lte: cutoff } }, { approvedAt: null, updatedAt: { lte: cutoff } }],
        }),
      }),
    );
  });

  it("without a CPM early finish the planned end date is placed in the index; without a project start no date can be placed", async () => {
    allocationService.buildAllocationSummary.mockResolvedValue(summary(0));
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: null, endDate: new Date("2026-02-06T00:00:00Z"), baselineFinish: 12 })]);
    expect(await slipOf(context())).toEqual([[12, "warning", "early_finish", null]]);
    prisma.project.findFirst.mockResolvedValue({ startDate: null, projectCalendar: null, timezone: "UTC", org: null });
    prisma.activity.findMany.mockResolvedValue([activityRow({ earlyFinish: 30, baselineFinish: 22 })]);
    prisma.activityProgress.findMany.mockResolvedValue([approved({ actualFinish: new Date("2026-07-01T00:00:00Z") })]);
    expect(await slipOf(context({ now: new Date("2026-10-01T15:00:00Z") }))).toEqual([[8, "warning", "early_finish", null]]);
  });
});
