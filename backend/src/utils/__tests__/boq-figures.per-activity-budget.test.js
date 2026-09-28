jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const {
  withheldAllocationSuggestion,
  withheldBudgetReconciliation,
  withheldAuditHistory,
  withheldBudgetSnapshot,
  withheldCostRecord,
  withheldCostRecords,
  withheldCostSummary,
  withheldEvReport,
  withheldRevision,
  withheldSchedule,
} = require("../boq-figures");

// Owner decision E1 (2026-09-28): cost read does not override the BOQ's
// withholding of a per-activity figure read off the mapping. The project's
// totals stay for a cost reader.
const BOQ = { boq: true, budget: true };
const COST = { boq: false, budget: true };
const NEITHER = { boq: false, budget: false };

// GET /reports/ev as earned-value.service builds it: the project's totals,
// and the twenty largest allocations in order of size.
const report = () => ({
  totalBudget: 41519.6,
  pv: 0,
  ev: 31428.3,
  ac: 0,
  spi: null,
  cpi: null,
  eac: 41519.6,
  eacBasis: "budget_no_cost_performance",
  approvedAllocatedAmount: 41519.6,
  unallocatedBoqAmount: 30273.9,
  sourceSummary: { budget: { approvedAllocatedAmount: 41519.6 } },
  estimates: { estimatedPv: 0 },
  sCurve: [],
  activityBreakdown: [
    { activityId: "A100", name: "Pour", budget: 21337, pv: 0, ev: 21337, ac: 0, pct: 100, isCritical: true },
    { activityId: "A110", name: "Fix", budget: 20182.6, pv: 0, ev: 10091.3, ac: 0, pct: 50, isCritical: false },
  ],
  official: true,
});

// A generated revision as GET /schedule serialises it: the snapshot's
// per-activity and per-WBS-node budgets, its project total, and the
// revision's totals.
const revision = () => ({
  id: "r-1",
  totalBudget: 41519.6,
  generatedTotalBudget: 69999.99,
  unallocatedBoqAmount: 30273.9,
  projectSummary: { name: "Rev A", totalBudget: 69999.99 },
  wbs: [{ code: "A", name: "Substructure", budget: 69999.99 }],
  snapshotJson: {
    projectSummary: { name: "Rev A", totalBudget: 69999.99 },
    wbs: [{ code: "A", name: "Substructure", budget: 69999.99 }],
    boqRows: [{ description: "Concrete", amount: 21337 }],
    activities: [
      { id: "A100", name: "Pour", budget: 21337 },
      { id: "A110", name: "Fix", budget: 48662.99 },
    ],
  },
});

describe("per-activity figures read off the mapping and cost read (owner decision E1)", () => {
  it("a BOQ reader receives the EV report exactly as built — the same object", () => {
    const built = report();
    expect(withheldEvReport(built, BOQ)).toBe(built);
  });

  it("a cost reader without BOQ read keeps the report's totals and receives no per-activity breakdown — it is said to be withheld and why", () => {
    const built = report();
    const answer = withheldEvReport(built, COST);
    expect(answer).not.toHaveProperty("activityBreakdown");
    expect([answer.activityBreakdownWithheld, answer.activityBreakdownReason]).toEqual([true, "Mapping details unavailable to you"]);
    const { activityBreakdown, unallocatedBoqAmount, ...totals } = built;
    expect(answer).toEqual({ ...totals, activityBreakdownWithheld: true, activityBreakdownReason: "Mapping details unavailable to you" });
    // The service's object is untouched.
    expect(built).toEqual(report());
  });

  it("a cost reader keeps the revision's totals and the generated project total, and no per-activity or per-WBS-node budget", () => {
    const answer = withheldRevision(revision(), COST);
    expect([answer.totalBudget, answer.generatedTotalBudget, answer.projectSummary.totalBudget, answer.snapshotJson.projectSummary.totalBudget]).toEqual([
      41519.6, 69999.99, 69999.99, 69999.99,
    ]);
    expect(answer.wbs).toEqual([{ code: "A", name: "Substructure" }]);
    expect(answer.snapshotJson.wbs).toEqual([{ code: "A", name: "Substructure" }]);
    expect(answer.snapshotJson.activities).toEqual([{ id: "A100", name: "Pour" }, { id: "A110", name: "Fix" }]);
    expect(answer.snapshotJson).not.toHaveProperty("boqRows");
    expect(answer).not.toHaveProperty("unallocatedBoqAmount");
  });

  it("a reader of neither loses the totals too; a BOQ reader keeps everything", () => {
    const neither = withheldRevision(revision(), NEITHER);
    expect(["totalBudget", "generatedTotalBudget"].filter((key) => key in neither)).toEqual([]);
    expect(neither.projectSummary).toEqual({ name: "Rev A" });
    const built = revision();
    expect(withheldRevision(built, BOQ)).toBe(built);
  });

  it("the schedule's activities carry no budget for a cost reader without BOQ read", () => {
    const schedule = {
      revision: revision(),
      activities: [{ id: "a-1", isCritical: true, budget: 21337, generatedBudget: 21337, allocatedBoqAmount: 21337 }],
    };
    const answer = withheldSchedule(schedule, COST);
    expect(answer.activities).toEqual([{ id: "a-1", isCritical: true }]);
    expect(answer.revision.totalBudget).toBe(41519.6);
  });
});
describe("the Cost module's per-activity allocation (owner decision E1)", () => {
  // A cost record as cost.service attaches it: budget is the activity's
  // approved allocation, generatedBudget the budget first written on it.
  const record = (activityId, budget) => ({ id: `c-${activityId}`, activityId, budget, generatedBudget: budget, committed: 12000, actual: 0, forecast: 0, labour: 0 });
  const reconciliation = () => ({
    generatedAt: "2026-09-28T00:00:00.000Z",
    balanced: false,
    totals: { activityBudget: 41519.6, budgetLines: 40000, allocatedToActivities: 40000, unallocatedLines: 0, difference: -1519.6 },
    activities: [
      { activityId: "a-1", name: "Pour", code: "A100", boqBudget: 21337, approvedChanges: 0, activityBudget: 21337, budgetFromLines: 20000, difference: -1337 },
      { activityId: "a-2", name: "Fix", code: "A110", boqBudget: 20182.6, approvedChanges: 500, activityBudget: 20682.6, budgetFromLines: 20000, difference: -682.6 },
    ],
    mismatches: [{ activityId: "a-1", name: "Pour", difference: -1337 }],
    underAllocatedLines: [],
    activitiesWithoutLines: [{ activityId: "a-2", name: "Fix", code: "A110", activityBudget: 20682.6 }],
  });

  it("a BOQ reader receives every answer exactly as built — the same object", () => {
    const rows = { rows: [record("a-1", 21337)], pagination: { nextCursor: null } };
    const summary = { records: [record("a-1", 21337)], totals: { budget: 21337 } };
    const built = reconciliation();
    const suggestion = { lineId: "l-1", basis: "boq", items: [{ activityId: "a-1", basisAmount: 21337, weight: 100, source: "boq" }] };
    expect(withheldCostRecords(rows, BOQ)).toBe(rows);
    expect(withheldCostSummary(summary, BOQ)).toBe(summary);
    expect(withheldBudgetReconciliation(built, BOQ)).toBe(built);
    expect(withheldAllocationSuggestion(suggestion, BOQ)).toBe(suggestion);
  });

  it("a cost reader without BOQ read keeps each record's ledger figures and the project totals, and no record's budget", () => {
    const rows = withheldCostRecords({ rows: [record("a-1", 21337), record("a-2", 0)], pagination: { nextCursor: null } }, COST);
    expect(rows.rows).toEqual([
      { id: "c-a-1", activityId: "a-1", committed: 12000, actual: 0, forecast: 0, labour: 0 },
      { id: "c-a-2", activityId: "a-2", committed: 12000, actual: 0, forecast: 0, labour: 0 },
    ]);
    expect(rows.pagination).toEqual({ nextCursor: null });
    // The answer to writing a record (POST /cost/activity/:id, PATCH
    // /cost/:id): the record as written, without the budget it was written
    // with (its activity's allocation).
    const written = { id: "c-a-1", activityId: "a-1", budget: 21337, committed: 0, actual: 0, forecast: 0 };
    expect(withheldCostRecord(written, COST)).toEqual({ id: "c-a-1", activityId: "a-1", committed: 0, actual: 0, forecast: 0 });
    expect(withheldCostRecord(written, NEITHER)).toEqual({ id: "c-a-1", activityId: "a-1", committed: 0, actual: 0, forecast: 0 });
    expect(withheldCostRecord(written, BOQ)).toBe(written);
  });

  // GET /cost/summary as cost.service builds it: one record, on the only
  // activity of its category, so the category's budget, forecast and
  // variance, the records' totals and the EAC are that activity's allocation.
  const costSummary = () => ({
    records: [record("a-1", 21337)],
    byPhase: [{ phase: "demolition", budget: 21337, committed: 12000, actual: 0, forecast: 21337, variance: 0, variancePct: 0 }],
    totals: { budget: 21337, committed: 12000, actual: 0, forecast: 21337 },
    eac: { basis: "estimate_at_completion", actual: 0, toComplete: 21337, optimistic: 19203.3, mostLikely: 21337, pessimistic: 24537.55 },
    budget: { originalBudget: 40000, approvedChanges: 0, revisions: 0, revisedBudget: 40000, source: "budget_register", allocatedToActivities: 21337 },
  });

  it("the cost summary gives a cost reader without BOQ read nothing built from the records' budgets — per category, in total, the forecast and EAC that fall back to them — and keeps the ledger, the commitments and the register", () => {
    const built = costSummary();
    const expected = {
      records: [{ id: "c-a-1", activityId: "a-1", committed: 12000, actual: 0, forecast: 0, labour: 0 }],
      byPhase: [{ phase: "demolition", committed: 12000, actual: 0 }],
      totals: { committed: 12000, actual: 0 },
      eac: { basis: "estimate_at_completion", actual: 0 },
      budget: { originalBudget: 40000, approvedChanges: 0, revisions: 0, revisedBudget: 40000, source: "budget_register" },
      activityBudgetsWithheld: true,
      activityBudgetsReason: "Mapping details unavailable to you",
    };
    expect(withheldCostSummary(built, COST)).toEqual(expected);
    expect(withheldCostSummary(built, NEITHER)).toEqual(expected);
    expect(JSON.stringify(withheldCostSummary(built, COST))).not.toContain("21337");
    // Output only: the service's answer is not changed.
    expect(built).toEqual(costSummary());
  });

  it("the project history gives a member without BOQ read no cost record's budget — before, after, or in the event's own summary — and everything else as stored", () => {
    const summary = (budget) => ({ activityId: "a-1", budget, committed: 0, actual: 0, forecast: 0 });
    const history = () => ({
      events: [
        { id: "e-1", recordType: "cost_record", action: "created", oldSummary: null, newSummary: summary(43210.9), summary: { activityId: "a-1", forecast: 0 } },
        { id: "e-2", recordType: "cost_record", action: "updated", oldSummary: summary(43210.9), newSummary: summary(43210.9), summary: { activityId: "a-1", budget: 43210.9 } },
        { id: "e-3", recordType: "schedule_revision", action: "approved", newSummary: { status: "approved", totalBudget: 41519.6 } },
      ],
      nextCursor: null,
    });
    const built = history();
    expect(withheldAuditHistory(built, BOQ)).toBe(built);
    const withoutBudget = { activityId: "a-1", committed: 0, actual: 0, forecast: 0 };
    for (const access of [COST, NEITHER]) {
      const answer = withheldAuditHistory(built, access);
      expect(answer.events.slice(0, 2)).toEqual([
        { id: "e-1", recordType: "cost_record", action: "created", oldSummary: null, newSummary: withoutBudget, summary: { activityId: "a-1", forecast: 0 } },
        { id: "e-2", recordType: "cost_record", action: "updated", oldSummary: withoutBudget, newSummary: withoutBudget, summary: { activityId: "a-1" } },
      ]);
      expect(JSON.stringify(answer)).not.toContain("43210.9");
    }
    // The revision's total stays for a cost reader, and goes for a reader of neither.
    expect(withheldAuditHistory(built, COST).events[2]).toEqual(built.events[2]);
    expect(withheldAuditHistory(built, NEITHER).events[2].newSummary).toEqual({ status: "approved" });
    expect(built).toEqual(history());
  });

  it("the reconciliation keeps its totals and verdict and each activity's lines and changes, and no activity's allocation — it says so", () => {
    const built = reconciliation();
    const answer = withheldBudgetReconciliation(built, COST);
    expect(answer).toEqual({
      generatedAt: built.generatedAt,
      balanced: false,
      totals: built.totals,
      activities: [
        { activityId: "a-1", name: "Pour", code: "A100", approvedChanges: 0, budgetFromLines: 20000 },
        { activityId: "a-2", name: "Fix", code: "A110", approvedChanges: 500, budgetFromLines: 20000 },
      ],
      underAllocatedLines: [],
      activityBudgetsWithheld: true,
      activityBudgetsReason: "Mapping details unavailable to you",
    });
    expect(built).toEqual(reconciliation());
    // A snapshot's stored reconciliation goes the same way; the note a
    // period lock stores (no activity rows) is left as it is.
    const note = { note: "Taken at period lock", budgetLines: 40000 };
    const listed = withheldBudgetSnapshot({ items: [{ id: "s-1", reconciliation: built }, { id: "s-2", reconciliation: note }] }, COST);
    expect(listed.items[0].reconciliation).toEqual(answer);
    expect(listed.items[1].reconciliation).toBe(note);
    expect(withheldBudgetSnapshot({ id: "s-1", reconciliation: built, lines: [] }, COST).reconciliation).toEqual(answer);
  });

  it("a budget line's spread suggested from the allocations is not given — no items, and why", () => {
    const suggestion = { lineId: "l-1", basis: "boq", items: [{ activityId: "a-1", basisAmount: 21337, weight: 100, source: "boq" }] };
    expect(withheldAllocationSuggestion(suggestion, COST)).toEqual({ lineId: "l-1", items: [], withheld: true, reason: "Mapping details unavailable to you" });
    expect(withheldAllocationSuggestion(suggestion, NEITHER)).toEqual({ lineId: "l-1", items: [], withheld: true, reason: "Mapping details unavailable to you" });
  });
});
