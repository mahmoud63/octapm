const { BOQ_STATE, boqStateOf } = require("../boq-value");

// One rule for the readiness check, the lock and the setup gate: value is
// the priced rows' sum above a cent (closure review, 2026-09-29).
describe("where a bill stands for the baseline", () => {
  const row = (amount, mappingRule = "required") => ({ amount, mappingRule });

  it("no rows is no bill", () => {
    expect(boqStateOf([])).toBe(BOQ_STATE.NONE);
    expect(boqStateOf(undefined)).toBe(BOQ_STATE.NONE);
  });

  it("a bill worth one cent, or nothing, has no value", () => {
    expect(boqStateOf([row(0), row(0)])).toBe(BOQ_STATE.UNPRICED);
    expect(boqStateOf([row(0.01)])).toBe(BOQ_STATE.UNPRICED);
    expect(boqStateOf([row("0.01")])).toBe(BOQ_STATE.UNPRICED);
    // A credit does not make value, nor take it away.
    expect(boqStateOf([row(-50), row(0.01)])).toBe(BOQ_STATE.UNPRICED);
  });

  it("in-scope rows worth one cent beside priced out-of-scope rows are no in-scope value", () => {
    expect(boqStateOf([row(0.01), row(250000, "not_applicable")])).toBe(BOQ_STATE.OUT_OF_SCOPE);
    expect(boqStateOf([row(100, "optional")])).toBe(BOQ_STATE.OUT_OF_SCOPE);
  });

  it("more than a cent in scope is in scope — two cents, or two rows of a cent", () => {
    expect(boqStateOf([row(0.02)])).toBe(BOQ_STATE.IN_SCOPE);
    expect(boqStateOf([row(0.01), row(0.01)])).toBe(BOQ_STATE.IN_SCOPE);
    expect(boqStateOf([{ amount: 5, mappingRule: null }])).toBe(BOQ_STATE.IN_SCOPE);
    expect(boqStateOf([row(100), row(50, "not_applicable")])).toBe(BOQ_STATE.IN_SCOPE);
  });
});
