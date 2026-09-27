jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { withheldWorkspaceDashboard } = require("../boq-figures");

const row = (id) => ({ id, overallScore: 71, spi: 0.95, cpi: 1.02, ev: 10, pv: 11, ac: 9, eac: 41214.4, bac: 41214.4 });
const dashboard = () => ({ summary: { totalProjects: 3 }, projectHealth: [row("p-boq"), row("p-cost"), row("p-none")] });
const access = {
  "p-boq": { boq: true, budget: true },
  "p-cost": { boq: false, budget: true },
  "p-none": { boq: false, budget: false },
};

describe("withheldWorkspaceDashboard (§12)", () => {
  it("hands a reader of the BOQ or the cost module every row exactly as built", () => {
    const built = { summary: {}, projectHealth: [row("p-boq"), row("p-cost")] };
    expect(withheldWorkspaceDashboard(built, (id) => access[id])).toBe(built);
  });

  it("omits bac, eac, ev, pv and ac, per project, for a reader of neither — the scores and indices stay", () => {
    const built = dashboard();
    const answer = withheldWorkspaceDashboard(built, (id) => access[id]);
    expect(answer.projectHealth[0]).toBe(built.projectHealth[0]);
    expect(answer.projectHealth[1]).toBe(built.projectHealth[1]);
    expect(answer.projectHealth[2]).toEqual({ id: "p-none", overallScore: 71, spi: 0.95, cpi: 1.02 });
    expect(answer.summary).toBe(built.summary);
    // Output only: the service's object is not touched.
    expect(built.projectHealth[2].bac).toBe(41214.4);
  });

  it("withholds the budget from a row whose project's access is unknown", () => {
    const answer = withheldWorkspaceDashboard({ projectHealth: [row("p-other")] }, () => undefined);
    expect(answer.projectHealth[0]).not.toHaveProperty("bac");
    expect(answer.projectHealth[0]).not.toHaveProperty("eac");
    for (const key of ["ev", "pv", "ac"]) expect(answer.projectHealth[0]).not.toHaveProperty(key);
  });
});
