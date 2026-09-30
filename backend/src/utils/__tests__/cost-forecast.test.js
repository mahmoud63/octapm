/**
 * Owner decision R5-2 (2026-09-30) — a cost record's default forecast, the
 * pure rules (utils/cost-forecast). The live proof is
 * src/services/__live__/r5-2-default-forecast.live.test.js.
 */
const {
  FORECAST_BASIS,
  isAmountShaped,
  projectedFinalCost,
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
  costRecordsByVisibleForecast,
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
    for (const value of ["lots", "", "-1", -1, Number.NaN, Number.POSITIVE_INFINITY, "1.234", {}, [7], [0], ["12.5"], [], true, false]) {
      expect(() => suppliedForecast(value)).toThrow(expect.objectContaining({ status: 400, code: "COST_RECORD_MONEY_INVALID" }));
      expect(() => forecastOnCreate({ payloadForecast: value, budget: 100 })).toThrow(expect.objectContaining({ status: 400 }));
      expect(() => forecastOnUpdate({ payloadForecast: value, existing: { forecastSource: "default", budget: 1 } })).toThrow(expect.objectContaining({ status: 400 }));
    }
    // An amount is text, a number or a Decimal — [7] reads as "7" to a text
    // check and was then stored as 0, marked entered.
    for (const value of [[7], [0], ["12.5"], {}, true]) expect(isAmountShaped(value)).toBe(false);
    for (const value of [0, "0", 12.5, "12.50"]) expect(isAmountShaped(value)).toBe(true);
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
    expect(forecastBasisOf("default")).toBe(
      "Default forecast: the larger of the budget and the actual cost as they stood when it was set; it does not follow them afterwards (no forecast was entered)",
    );
    expect(forecastBasisOf(null)).toBe("Stored forecast (its source was not recorded)");
    expect(forecastBasisOf("typed-by-client")).toBe(FORECAST_BASIS.notRecorded);
    expect(withForecastBasis({ id: "r", forecast: 5, forecastSource: "default" })).toMatchObject({ forecastSource: "default", forecastBasis: FORECAST_BASIS.default });
    expect(withForecastBasis({ id: "r", forecast: 5 })).toMatchObject({ forecastSource: null, forecastBasis: FORECAST_BASIS.notRecorded });
  });

  it("counts the mix", () => {
    expect(forecastSourceMix([{ forecastSource: "entered" }, { forecastSource: "default" }, { forecastSource: "default" }, { forecastSource: null }, {}])).toEqual({ entered: 1, default: 2, notRecorded: 2, total: 5 });
  });
});

describe("R5-2 — the projected final cost counts an entered forecast as entered, 0 included", () => {
  it("an entered 0 counts as 0 — it used to be replaced by the budget; a default or not-recorded 0 still falls back", () => {
    expect(projectedFinalCost({ forecast: 0, forecastSource: "entered", budget: 10000, actual: 0 })).toBe(0);
    expect(projectedFinalCost({ forecast: "0", forecastSource: "entered", budget: 10000, actual: 0 })).toBe(0);
    expect(projectedFinalCost({ forecast: 0, forecastSource: "default", budget: 10000, actual: 0 })).toBe(10000);
    expect(projectedFinalCost({ forecast: 0, forecastSource: null, budget: 10000, actual: 0 })).toBe(10000);
    expect(projectedFinalCost({ forecast: 0, budget: 10000, actual: 0 })).toBe(10000);
  });

  it("an entered forecast is never counted below what the record has cost: the actual counts, not the budget", () => {
    expect(projectedFinalCost({ forecast: 0, forecastSource: "entered", budget: 10000, actual: 2000 })).toBe(2000);
    expect(projectedFinalCost({ forecast: 5000, forecastSource: "entered", budget: 10000, actual: 6000 })).toBe(6000);
    expect(projectedFinalCost({ forecast: 5000, forecastSource: "entered", budget: 10000, actual: 1000 })).toBe(5000);
    expect(projectedFinalCost({ forecast: 25000, forecastSource: "entered", budget: 10000, actual: 1000 })).toBe(25000);
  });

  it("a DEFAULT is not counted as a forecast: the record counts the larger of its budget and actual as they are now, whatever the stored default says", () => {
    // Set when the allocation was 10,000; the allocation has since moved away.
    expect(projectedFinalCost({ forecast: 10000, forecastSource: "default", budget: 0, actual: 0 })).toBe(0);
    // Set by a first posting of 500 worked from a budget of 0 (before the creators read the allocation).
    expect(projectedFinalCost({ forecast: 500, forecastSource: "default", budget: 10000, actual: 500 })).toBe(10000);
    expect(projectedFinalCost({ forecast: 500, forecastSource: "default", budget: 10000, actual: 800 })).toBe(10000);
    // Set at 0 by an import, the allocation approved afterwards.
    expect(projectedFinalCost({ forecast: 0, forecastSource: "default", budget: 10000, actual: 0 })).toBe(10000);
    // Never below what it has cost.
    expect(projectedFinalCost({ forecast: 10000, forecastSource: "default", budget: 10000, actual: 12000 })).toBe(12000);
    expect(projectedFinalCost({ forecast: 55555, forecastSource: "default", budget: 10000, actual: 2000 })).toBe(10000);
  });

  it("a not-recorded forecast counts exactly as before R5-2 — every existing row has a NULL source, so no existing project's total moves", () => {
    // Number(x) > 0 && >= actual ? x : max(budget, actual) — the rule at 1f27e04.
    const before = ({ forecast, budget, actual }) => (forecast > 0 && forecast >= actual ? forecast : Math.max(budget, actual));
    for (const forecastSource of [null, undefined, "typed-by-client"]) {
      for (const figures of [
        { forecast: 0, budget: 10000, actual: 0 },
        { forecast: 500, budget: 10000, actual: 500 },
        { forecast: 500, budget: 10000, actual: 800 },
        { forecast: 12000, budget: 10000, actual: 3000 },
        { forecast: 7777, budget: 0, actual: 0 },
        { forecast: 0, budget: 0, actual: 450 },
      ]) {
        expect([forecastSource, figures, projectedFinalCost({ ...figures, forecastSource })]).toEqual([forecastSource, figures, before(figures)]);
      }
    }
  });
});

describe("R5-2 — the register's order on sortBy=forecast for a member who may not read the BOQ", () => {
  const keys = (hidden) => [
    { id: "d1", forecast: hidden, forecastSource: "default" },
    { id: "e2", forecast: 40000, forecastSource: "entered" },
    { id: "b-default", forecast: 1, forecastSource: "default" },
    { id: "e1", forecast: 20000, forecastSource: "entered" },
    { id: "legacy", forecast: 500, forecastSource: null },
    { id: "e0", forecast: 0, forecastSource: "entered" },
    { id: "e1-twin", forecast: 20000, forecastSource: "entered" },
  ];
  const ids = (rows) => rows.map((row) => row.id);

  it("orders the visible forecasts by figure and puts the withheld (default) rows after them, by id — in both directions", () => {
    expect(ids(costRecordsByVisibleForecast(keys(31337.77), "asc"))).toEqual(["e0", "legacy", "e1", "e1-twin", "e2", "b-default", "d1"]);
    expect(ids(costRecordsByVisibleForecast(keys(31337.77), "desc"))).toEqual(["e2", "e1-twin", "e1", "legacy", "e0", "b-default", "d1"]);
    expect(costRecordsByVisibleForecast([], "asc")).toEqual([]);
  });

  it("no stored default moves the order: the same ids come back whatever the hidden figure is", () => {
    for (const dir of ["asc", "desc"]) {
      const reference = ids(costRecordsByVisibleForecast(keys(31337.77), dir));
      for (const hidden of [0, 0.01, 19999.99, 20000, 20000.01, 39999, 40000.01, 9e9]) {
        expect([dir, hidden, ids(costRecordsByVisibleForecast(keys(hidden), dir))]).toEqual([dir, hidden, reference]);
      }
    }
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
