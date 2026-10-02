/**
 * PC-7b third fixer, item 3 — a raise records its prefill provenance as the
 * prefill STATES it (exception.service buildExceptionPrefill's field list),
 * never guessed from the values.
 */
const { changeEventPrefillProvenance } = require("../boq-figures");

const created = { activityId: null, lines: [{ id: "line-1", activityId: null, costCodeId: "cc-1", quantity: 1, unit: null }] };
const prefill = { activityId: null, lines: [{ description: "Raised from a project controls exception", costCodeId: "cc-1", quantity: 1, unit: null, unitCost: 0, romAmount: 0 }] };

describe("changeEventPrefillProvenance", () => {
  it("records a quantity delta of exactly 1 with no unit when the prefill says it filled it", () => {
    expect(changeEventPrefillProvenance({ prefill, fields: { event: [], line: ["costCodeId", "quantity", "unit"] } }, created)).toEqual({
      lines: [{ id: "line-1", costCodeId: "cc-1", quantity: 1, unit: null }],
    });
  });

  it("does not record the line's default quantity when the prefill did not fill it", () => {
    expect(changeEventPrefillProvenance({ prefill, fields: { event: [], line: ["costCodeId"] } }, created)).toEqual({ lines: [{ id: "line-1", costCodeId: "cc-1" }] });
  });

  it("records nothing known (null — fail closed) for a prefill that does not state its fields", () => {
    expect(changeEventPrefillProvenance(prefill, created)).toBeNull();
    expect(changeEventPrefillProvenance({ prefill }, created)).toBeNull();
  });
});
