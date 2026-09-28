jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { withheldForecast, forecastCostWithheld } = require("../boq-figures");

// An activity as forecast.service builds it: its cost has a basis only when
// it has a budget (an approved allocation), and a level above "low" only then.
const activity = (id, isCritical, budget, overrun = 0) => ({
  id,
  name: `Activity ${id}`,
  isCritical,
  level: "medium",
  basis: "pace",
  cost: {
    budget,
    actual: overrun ? budget + overrun : 0,
    committed: 0,
    projected: budget > 0 ? budget + overrun : null,
    basis: budget > 0 ? (overrun ? "burn" : "budget") : null,
    overrun,
    overrunPct: budget > 0 ? Math.round((overrun / budget) * 1000) / 10 : 0,
    level: budget > 0 && overrun / budget > 0.1 ? "high" : "low",
    reasons: overrun ? ["spent ahead of progress"] : [],
  },
});

// Two critical activities with no allocation (Bc, Bd) and two with one (A, D;
// A over its budget) — the reviewer's capture.
const built = () => {
  const activities = [activity("D", false, 5000), activity("Bd", true, 0), activity("A", true, 8000, 1200), activity("Bc", true, 0)];
  return {
    available: true,
    schedule: { basis: "activities", counts: { critical: 3, atRisk: { high: 0, medium: 4, low: 0 } }, topRisks: activities.slice(1) },
    cost: {
      budget: 13000,
      bac: 13000,
      eac: 13000,
      eacBasis: "budget_no_cost_performance",
      bottomUp: 14200,
      projected: 14200,
      overrun: 1200,
      overrunPct: 9.2,
      actual: 9200,
      counts: { atRisk: { high: 1, medium: 0, low: 0 }, lines: 1 },
      topRisks: [activities[2]],
      budgetLines: [{ id: "l-1", costCode: "03", name: "Concrete", costType: "material", revised: 100, committed: 150, actual: 0, forecast: 150, overrun: 50, overrunPct: 50, level: "high" }],
    },
    summary: { scheduleLevel: "medium", costLevel: "medium" },
    dataQuality: [],
    activities,
  };
};

const BOQ = { boq: true, budget: true };
const COST = { boq: false, budget: true };
const NEITHER = { boq: false, budget: false };

describe("the forecast's cost view and the mapping (owner decision, 2026-09-28)", () => {
  it("a BOQ reader receives the forecast exactly as built — the same object", () => {
    const forecast = built();
    expect(withheldForecast(forecast, BOQ)).toBe(forecast);
  });

  it("a cost reader without BOQ read keeps the project's cost and the budget lines, and no activity's budget, projection, basis or level, nor the list or tally of the activities over budget (E1)", () => {
    const forecast = built();
    const answer = withheldForecast(forecast, COST);
    for (const row of [...answer.activities, ...answer.schedule.topRisks]) {
      const own = forecast.activities.find((activity) => activity.id === row.id);
      expect([row.id, row.cost]).toEqual([
        row.id,
        { actual: own.cost.actual, committed: own.cost.committed, withheld: true, reason: "Mapping details unavailable to you" },
      ]);
    }
    const { topRisks, counts, ...projectCost } = forecast.cost;
    expect(answer.cost).toEqual({
      ...projectCost,
      counts: { lines: 1 },
      activityCostWithheld: true,
      activityCostReason: "Mapping details unavailable to you",
    });
    // Nothing tells a mapped activity from an unmapped one.
    expect(answer.activities.filter((row) => row.isCritical && "basis" in row.cost)).toEqual([]);
    expect(answer.schedule.counts).toEqual(forecast.schedule.counts);
    expect(forecastCostWithheld(answer)).toBe(false);
    expect(forecast).toEqual(built());
  });

  it("a member who reads neither is given no activity's cost basis or level — nothing that tells a mapped activity from an unmapped one", () => {
    const answer = withheldForecast(built(), NEITHER);
    for (const row of [...answer.activities, ...answer.schedule.topRisks]) {
      expect([row.id, row.cost]).toEqual([row.id, { withheld: true, reason: "Cost figures are not available to you" }]);
    }
    // The count of critical activities without an allocation cannot be read off it.
    const unmappedCritical = answer.activities.filter((row) => row.isCritical && row.cost.basis === null);
    expect(unmappedCritical).toEqual([]);
    // Criticality and the schedule's view are theirs.
    expect(answer.activities.map((row) => [row.id, row.isCritical, row.level, row.basis])).toEqual([
      ["D", false, "medium", "pace"],
      ["Bd", true, "medium", "pace"],
      ["A", true, "medium", "pace"],
      ["Bc", true, "medium", "pace"],
    ]);
    expect(answer.schedule.counts).toEqual({ critical: 3, atRisk: { high: 0, medium: 4, low: 0 } });
  });

  it("the cost block keeps no list or tally of the activities over budget and no EAC basis; it says it is withheld and why", () => {
    const answer = withheldForecast(built(), NEITHER);
    expect(answer.cost).toEqual({
      counts: { lines: 1 },
      budgetLines: [{ id: "l-1", costCode: "03", name: "Concrete", costType: "material", level: "high" }],
      withheld: true,
      reason: "Cost figures are not available to you",
    });
    expect(answer.summary).toEqual({ scheduleLevel: "medium", costLevel: "medium" });
    expect(forecastCostWithheld(answer)).toBe(true);
  });

  it("the service's object is not touched", () => {
    const forecast = built();
    withheldForecast(forecast, NEITHER);
    expect(forecast).toEqual(built());
  });
});
