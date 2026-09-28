jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { withheldActivity, withheldSchedule } = require("../boq-figures");

// An activity as GET /schedule builds it: critical, on zero float, with one
// approved allocation behind it.
const activity = (id) => ({
  id,
  name: "Pour foundations",
  isCritical: true,
  totalFloat: 0,
  budget: 21337,
  generatedBudget: 21337,
  allocatedBoqQuantity: 100,
  allocatedBoqAmount: 21337,
  allocatedBoqWeight: 29.72,
  approvedAllocationCount: 1,
});

const BOQ = { boq: true, budget: true };
const COST = { boq: false, budget: true };
const NEITHER = { boq: false, budget: false };

describe("an activity's mapping (owner decision, 2026-09-28)", () => {
  it("a BOQ reader receives the activity exactly as built — the same object", () => {
    const built = activity("a-1");
    expect(withheldActivity(built, BOQ)).toBe(built);
  });

  it("a member who may not read the BOQ receives no allocation count — its criticality stays", () => {
    for (const access of [COST, NEITHER]) {
      const answer = withheldActivity(activity("a-1"), access);
      expect(answer).not.toHaveProperty("approvedAllocationCount");
      expect(answer).toMatchObject({ id: "a-1", isCritical: true, totalFloat: 0 });
    }
    // The cost reader keeps the budget (the Cost module shows it already).
    expect(withheldActivity(activity("a-1"), COST).budget).toBe(21337);
  });

  it("the schedule's activities go the same way, and the service's object is not touched", () => {
    const built = { revision: { id: "r-1" }, activities: [activity("a-1"), activity("a-2")] };
    const answer = withheldSchedule(built, COST);
    for (const row of answer.activities) {
      expect(row).not.toHaveProperty("approvedAllocationCount");
      expect(row.isCritical).toBe(true);
    }
    expect(built.activities[0].approvedAllocationCount).toBe(1);
  });
});
