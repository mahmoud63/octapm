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

// A cost record's stored forecast when its writer gives none (cost.service
// resolveForecast). Named here so the label and the rule are read together.
const COST_RECORD_FORECAST_DEFAULT_BASIS = "budget_plus_1.1x_actual_minus_budget";
const COST_RECORD_FORECAST_DEFAULT_RULE = "budget + 1.1 × (actual − budget)";

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

module.exports = {
  TRUTHS,
  projection,
  BUDGET_LABELS,
  BUDGET_LINE_FORECAST_DEFAULT_BASIS,
  budgetLineTruth,
  COST_RECORD_FORECAST_DEFAULT_BASIS,
  COST_RECORD_FORECAST_DEFAULT_RULE,
  EV_REPORT_TRUTH,
};
