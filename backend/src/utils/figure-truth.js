/**
 * The three truths (docs/project-controls/OCTAPM_PROJECT_CONTROL_MODEL.md §3).
 *
 * Every figure the product shows is a source fact (approved, executed,
 * certified or posted), derived from source rows (rebuildable at any time),
 * or a projection (an estimate about the future). Payloads say which, and
 * from what, so a screen never presents a projection as a fact.
 *
 * These are labels only. No figure is computed from them, and they are the
 * same words for every project and every reader: they describe keys, never
 * values, so they carry nothing a reader may not see (utils/boq-figures
 * still decides which figures a reader receives).
 */

const TRUTHS = Object.freeze({ SOURCE: "source", DERIVED: "derived", PROJECTION: "projection" });

/** "projection:<basis>" — a projection always names its basis. */
const projection = (basis) => `${TRUTHS.PROJECTION}:${basis}`;

// The three budget figures that coexist (control model §3, consequence 1).
// Each is derived, each has its own source set; the product says which one
// a screen shows.
const BUDGET_LABELS = Object.freeze({
  register: "Budget",
  evBudgetAtCompletion: "Budget at completion (EV basis)",
  contractWaterfall: "Contract value + approved changes",
});

// Budget register lines (budget.service serializeLine).
const BUDGET_LINE_FORECAST_DEFAULT_BASIS = "greatest_of_revised_actual_committed";
const BUDGET_LINE_DERIVED_FROM = Object.freeze({
  originalBudget:
    "The budget line as entered; fixed once changes, postings or a locked period stand on it (budget revisions move Revised, never Original)",
  revised: "Original budget + approved change orders + approved revisions and transfers on the line",
  committed:
    "Executed commitments and approved commitment change orders against the line; the manual figure only while none exist",
  actual: "Cost ledger postings on the line",
});
const BUDGET_LINE_FORECAST_FROM = Object.freeze({
  typed: "Typed on the budget line",
  default: "No forecast typed: the greatest of revised budget, actual and committed",
});

const budgetLineTruth = (typed) => ({
  originalBudget: TRUTHS.SOURCE,
  revised: TRUTHS.DERIVED,
  committed: TRUTHS.DERIVED,
  actual: TRUTHS.DERIVED,
  forecast: typed ? projection("typed") : projection(BUDGET_LINE_FORECAST_DEFAULT_BASIS),
  derivedFrom: {
    ...BUDGET_LINE_DERIVED_FROM,
    forecast: typed ? BUDGET_LINE_FORECAST_FROM.typed : BUDGET_LINE_FORECAST_FROM.default,
  },
});

// A cost record's stored forecast when its writer gives none (utils/cost-forecast
// defaultForecast). Named here so the label and the rule are read together.
// PC-7a 3d (owner, 2026-09-29): it is the cost summary's own estimate at
// completion for a record without a forecast — the larger of its budget and
// its actual. The former default, budget + 1.1 × (actual − budget), was −10%
// of the budget on a record with no actual yet (a 500 on every cost record
// created without a forecast on an allocated activity) and fell below actual
// whenever actual was under budget.
//
// R5-2 (owner, 2026-09-30): that rule is only the INITIAL default for a
// genuinely missing forecast. Each record now says whether its forecast was
// entered, is that default, or was not recorded (CostRecord.forecastSource;
// utils/cost-forecast), so the cost summary no longer presents every
// record's forecast as the default rule: its records' forecast is labelled
// per record (COST_RECORD_FORECAST_BASIS_PER_RECORD) and the mix is counted.
const COST_RECORD_FORECAST_DEFAULT_BASIS = "greater_of_budget_and_actual";
const COST_RECORD_FORECAST_DEFAULT_RULE = "the larger of the record's budget and its actual (never negative, never below actual)";
const COST_RECORD_FORECAST_BASIS_PER_RECORD = "entered_or_default_per_record";
// The cost summary's Σ of the records' estimates at completion and its
// scenarios: the cost module's own projection, never called the EAC — the
// EAC is the earned-value report's revised budget ÷ CPI (owner decision D2).
const COST_RECORD_PROJECTED_FINAL_COST_LABEL = "Projected final cost (cost records)";

// The earned-value report's figures (earned-value.service). The EAC's
// basis is the report's own eacBasis key (utils/eac-basis).
const EV_REPORT_TRUTH = Object.freeze({
  pv: TRUTHS.DERIVED,
  ev: TRUTHS.DERIVED,
  ac: TRUTHS.DERIVED,
  totalBudget: TRUTHS.DERIVED,
  spi: TRUTHS.DERIVED,
  cpi: TRUTHS.DERIVED,
  sv: TRUTHS.DERIVED,
  cv: TRUTHS.DERIVED,
  eac: projection("eacBasis"),
  etc: projection("eac_minus_ac"),
  labels: Object.freeze({ totalBudget: BUDGET_LABELS.evBudgetAtCompletion }),
  derivedFrom: Object.freeze({
    pv: "Approved time-phased cost loading through the cutoff",
    ev: "Approved progress × approved BOQ allocations through the cutoff",
    ac: "Official actual cost on cost records through the cutoff",
    totalBudget: "Approved allocations + approved budget revisions (sourceSummary.budget)",
    eac: "Revised budget ÷ CPI; the revised budget when there is no CPI or CPI is 0 — the rule that applied is eacBasis",
    etc: "EAC − actual cost",
  }),
});

// The EV report's history points (earned-value.service listLockedEvHistory):
// each is a locked period's EvPeriodSnapshot as it was stored at the lock.
// PV, EV and AC were derived at that period's cutoff and are frozen since;
// the EAC was the projection made at the lock. Nothing here is recomputed.
const EV_HISTORY_TRUTH = Object.freeze({
  pv: TRUTHS.DERIVED,
  ev: TRUTHS.DERIVED,
  ac: TRUTHS.DERIVED,
  totalBudget: TRUTHS.DERIVED,
  spi: TRUTHS.DERIVED,
  cpi: TRUTHS.DERIVED,
  eac: projection("eac_at_lock"),
  frozenAt: "locked_period_snapshot",
  derivedFrom: Object.freeze({
    pv: "Stored at the lock: approved time-phased cost loading through that period's cutoff",
    ev: "Stored at the lock: approved progress × approved BOQ allocations through that period's cutoff",
    ac: "Stored at the lock: official actual cost on cost records through that period's cutoff",
    totalBudget: "Stored at the lock: approved allocations + approved budget revisions at that cutoff",
    eac: "The EAC projected at the lock (revised budget ÷ CPI, or the revised budget without a CPI); later records never move it",
  }),
});

module.exports = {
  TRUTHS,
  projection,
  BUDGET_LABELS,
  BUDGET_LINE_FORECAST_DEFAULT_BASIS,
  budgetLineTruth,
  COST_RECORD_FORECAST_DEFAULT_BASIS,
  COST_RECORD_FORECAST_DEFAULT_RULE,
  COST_RECORD_FORECAST_BASIS_PER_RECORD,
  COST_RECORD_PROJECTED_FINAL_COST_LABEL,
  EV_REPORT_TRUTH,
  EV_HISTORY_TRUTH,
};
