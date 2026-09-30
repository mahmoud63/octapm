/**
 * Owner decision R5-2 (2026-09-30) — a cost record's default forecast, the
 * pure rules (utils/cost-forecast). The live proof is
 * src/services/__live__/r5-2-default-forecast.live.test.js.
 */
const {
  FORECAST_BASIS,
  isForecastSupplied,
  suppliedForecast,
  defaultForecast,
  forecastOnCreate,
  forecastOnUpdate,
  forecastBasisOf,
  withForecastBasis,
  forecastSourceMix,
} = require("../cost-forecast");
const {
  withheldCostRecord,
  withheldAuditHistory,
  withheldActivityDetail,
  withheldReportRow,
  reportDefaultForecastColumns,
  rowHasDefaultForecast,
  DEFAULT_FORECAST_WITHHELD,
} = require("../boq-figures");

describe("R5-2 — a supplied forecast is a forecast, falsy or not", () => {
  it("0, '0' and '' are supplied; only undefined and null are missing", () => {
    for (const value of [0, "0", "", 12.5, "12.50"]) expect(isForecastSupplied(value)).toBe(true);
    for (const value of [undefined, null]) expect(isForecastSupplied(value)).toBe(false);
  });

  it("create with 0 or '0' stores 0 as entered — never the default", () => {
    expect(forecastOnCreate({ payloadForecast: 0, budget: 10000, actual: 0 })).toEqual({ forecast: 0, forecastSource: "entered" });
    expect(forecastOnCreate({ payloadForecast: "0", budget: 10000, actual: 0 })).toEqual({ forecast: 0, forecastSource: "entered" });
    expect(forecastOnCreate({ payloadForecast: "1234.50", budget: 10000 })).toEqual({ forecast: 1234.5, forecastSource: "entered" });
  });

  it("create without a forecast stores max(0, budget, actual) as the default", () => {
    expect(forecastOnCreate({ budget: 10000, actual: 2000 })).toEqual({ forecast: 10000, forecastSource: "default" });
    expect(forecastOnCreate({ budget: 10000, actual: 15000 })).toEqual({ forecast: 15000, forecastSource: "default" });
    expect(forecastOnCreate({ payloadForecast: null, budget: 0, actual: 0 })).toEqual({ forecast: 0, forecastSource: "default" });
    expect(defaultForecast({ budget: -5, actual: -1 })).toBe(0);
  });

  it("an invalid supplied value is a business error — Number(x) || 0 would have stored 0", () => {
    for (const value of ["lots", "", "-1", -1, Number.NaN, Number.POSITIVE_INFINITY, "1.234", {}]) {
      expect(() => suppliedForecast(value)).toThrow(expect.objectContaining({ status: 400, code: "COST_RECORD_MONEY_INVALID" }));
      expect(() => forecastOnCreate({ payloadForecast: value, budget: 100 })).toThrow(expect.objectContaining({ status: 400 }));
      expect(() => forecastOnUpdate({ payloadForecast: value, existing: { forecastSource: "default", budget: 1 } })).toThrow(expect.objectContaining({ status: 400 }));
    }
    // What the former `Number(payload.forecast) || 0` made of the same values.
    expect(Number("lots") || 0).toBe(0);
    expect(Number("") || 0).toBe(0);
  });
});

describe("R5-2 — an edit without a forecast", () => {
  const entered = { budget: 1000, actual: 400, forecast: 5000, forecastSource: "entered" };
  const legacy = { budget: 1000, actual: 400, forecast: 5000, forecastSource: null };
  const byDefault = { budget: 1000, actual: 400, forecast: 1000, forecastSource: "default" };

  it("never changes an entered forecast or one whose source was not recorded, even when the budget changes", () => {
    expect(forecastOnUpdate({ existing: entered, budget: 9000 })).toEqual({});
    expect(forecastOnUpdate({ existing: legacy, budget: 9000 })).toEqual({});
    expect(forecastOnUpdate({ existing: { ...legacy, forecastSource: undefined }, budget: 9000 })).toEqual({});
  });

  it("re-derives a default only when this write changes the budget: max(0, new budget, current actual), still default", () => {
    expect(forecastOnUpdate({ existing: byDefault, budget: 3000 })).toEqual({ forecast: 3000, forecastSource: "default" });
    expect(forecastOnUpdate({ existing: { ...byDefault, actual: 7000 }, budget: 3000 })).toEqual({ forecast: 7000, forecastSource: "default" });
  });

  it("leaves a default alone on an unrelated edit or a budget echo", () => {
    expect(forecastOnUpdate({ existing: byDefault })).toEqual({});
    expect(forecastOnUpdate({ existing: byDefault, budget: undefined })).toEqual({});
    expect(forecastOnUpdate({ existing: { ...byDefault, actual: 9000 }, budget: 1000 })).toEqual({});
    expect(forecastOnUpdate({ existing: byDefault, budget: "1000.00" })).toEqual({});
  });

  it("a supplied forecast replaces any source with entered", () => {
    expect(forecastOnUpdate({ payloadForecast: 0, existing: byDefault, budget: 3000 })).toEqual({ forecast: 0, forecastSource: "entered" });
    expect(forecastOnUpdate({ payloadForecast: "0", existing: legacy })).toEqual({ forecast: 0, forecastSource: "entered" });
  });
});

describe("R5-2 — honest basis labels", () => {
  it("names each source, and a not-recorded one as such", () => {
    expect(forecastBasisOf("entered")).toBe("Entered forecast");
    expect(forecastBasisOf("default")).toBe("Default forecast: the larger of budget and actual when it was set (no forecast was entered)");
    expect(forecastBasisOf(null)).toBe("Stored forecast (its source was not recorded)");
    expect(forecastBasisOf("typed-by-client")).toBe(FORECAST_BASIS.notRecorded);
    expect(withForecastBasis({ id: "r", forecast: 5, forecastSource: "default" })).toMatchObject({ forecastSource: "default", forecastBasis: FORECAST_BASIS.default });
    expect(withForecastBasis({ id: "r", forecast: 5 })).toMatchObject({ forecastSource: null, forecastBasis: FORECAST_BASIS.notRecorded });
  });

  it("counts the mix", () => {
    expect(forecastSourceMix([{ forecastSource: "entered" }, { forecastSource: "default" }, { forecastSource: "default" }, { forecastSource: null }, {}])).toEqual({ entered: 1, default: 2, notRecorded: 2, total: 5 });
  });
});

describe("R5-2 — a default forecast is built from the allocation: withheld from a member who may not read the BOQ", () => {
  const noBoq = { boq: false, budget: false };
  it("cost records: the default's figure is omitted with the reason; an entered or not-recorded one stays", () => {
    const record = { id: "r1", budget: 10000, generatedBudget: 10000, forecast: 10000, forecastSource: "default", forecastBasis: FORECAST_BASIS.default };
    expect(withheldCostRecord(record, noBoq)).toEqual({ id: "r1", forecastSource: "default", forecastBasis: FORECAST_BASIS.default, forecastWithheld: true, forecastWithheldReason: DEFAULT_FORECAST_WITHHELD });
    expect(withheldCostRecord({ ...record, forecastSource: "entered" }, noBoq)).toMatchObject({ forecast: 10000 });
    expect(withheldCostRecord({ ...record, forecastSource: null }, noBoq)).toMatchObject({ forecast: 10000 });
    expect(withheldCostRecord(record, { boq: true })).toBe(record);
  });

  it("history: a default forecast is stripped from the event's summaries", () => {
    const history = { events: [{ recordType: "cost_record", newSummary: { budget: 10, forecast: 10, forecastSource: "default" }, summary: { forecast: 10, forecastSource: "default" }, oldSummary: { budget: 10, forecast: 3, forecastSource: "entered" } }] };
    const [event] = withheldAuditHistory(history, noBoq).events;
    expect(event.newSummary).toEqual({ forecastSource: "default" });
    expect(event.summary).toEqual({ forecastSource: "default" });
    expect(event.oldSummary).toEqual({ forecast: 3, forecastSource: "entered" });
  });

  it("activity detail: a dash and the reason for a default; an entered one stays", () => {
    const detail = (forecastSource) => ({ sections: { cost: { allowed: true, forecast: { value: 10000, truth: "projection", basis: "x", derivedFrom: [], forecastSource } } } });
    expect(withheldActivityDetail(detail("default"), noBoq).sections.cost.forecast).toEqual({ value: null, truth: null, withheld: true, forecastSource: "default", basis: DEFAULT_FORECAST_WITHHELD, derivedFrom: [] });
    expect(withheldActivityDetail(detail("entered"), noBoq).sections.cost.forecast.value).toBe(10000);
  });

  it("report rows: the forecast column is withheld on default rows only", () => {
    expect(reportDefaultForecastColumns("cost_record")).toEqual(["forecast"]);
    expect(rowHasDefaultForecast({ forecastSource: "default" })).toBe(true);
    expect(rowHasDefaultForecast({ forecastSource: "entered" })).toBe(false);
    expect(withheldReportRow({ id: "a", forecast: 5 }, ["forecast"], noBoq)).toEqual({ id: "a", forecast: null, withheldColumns: ["forecast"] });
  });
});
