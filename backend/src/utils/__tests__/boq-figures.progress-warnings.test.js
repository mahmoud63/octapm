jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { PROGRESS_WARNING_WITHHELD, withheldProgressSubmission, withheldProgressSubmissions } = require("../boq-figures");

// A typed submission's answer (progress.service) when the typed figure is
// below the official installed figure: the transient warnings beside the figures.
const answer = () => ({
  id: "s-1",
  method: "quantity",
  pctComplete: 50,
  status: "submitted",
  quantityComplete: 50,
  quantityPlanned: 100,
  quantityUnit: "m3",
  quantity: { installed: 50, installedBasis: "client" },
  warnings: [{ code: "QUANTITY_BELOW_OFFICIAL", officialInstalled: 75, typed: 50, message: "The typed installed quantity (50) is below the official installed figure (75); approving it lowers the official installed figure to the typed one" }],
});

const BOQ = { boq: true, budget: true };
const COST = { boq: false, budget: true };

describe("QUANTITY_BELOW_OFFICIAL for a member who may not read the BOQ (binding BOQ-access rule)", () => {
  it("a BOQ reader's answer is the same object, warning whole", () => {
    const row = answer();
    expect(withheldProgressSubmission(row, BOQ)).toBe(row);
  });

  it("the warning keeps its code and loses both figures and the sentence that states them; the submission's figures go as before", () => {
    const out = withheldProgressSubmission(answer(), COST);
    expect(out.warnings).toEqual([{ code: "QUANTITY_BELOW_OFFICIAL", boqWithheld: { keys: ["officialInstalled", "typed", "message"], reason: PROGRESS_WARNING_WITHHELD } }]);
    expect(out).not.toHaveProperty("quantityComplete");
    expect(JSON.stringify(out)).not.toMatch(/\b75\b|\b100\b|m3/);
    expect(withheldProgressSubmissions([answer()], COST)[0].warnings[0]).not.toHaveProperty("typed");
  });
});
