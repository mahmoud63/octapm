/**
 * Which rule gave the business-rule estimate at completion.
 *
 * The EAC itself is certified and unchanged (earned-value.service
 * computeEvMetrics): revised BAC / CPI when CPI > 0, otherwise the revised
 * BAC. This names the branch that applied, so every screen labels the one
 * figure the same way (owner decision D2):
 *
 * - budget_over_cpi            revised BAC / CPI (CPI > 0);
 * - budget_cpi_zero            the revised BAC, because CPI is 0 — actual
 *                              cost recorded and nothing earned, so
 *                              BAC / CPI cannot be computed;
 * - budget_no_cost_performance the revised BAC, because there is no CPI —
 *                              no official actual cost through the cutoff;
 * - no_budget                  no revised BAC to project from.
 *
 * Not money: every reader of the EAC's screen receives it.
 */

const EAC_BASES = Object.freeze({
  BUDGET_OVER_CPI: "budget_over_cpi",
  CPI_ZERO: "budget_cpi_zero",
  NO_COST_PERFORMANCE: "budget_no_cost_performance",
  NO_BUDGET: "no_budget",
});

const eacBasisOf = ({ totalBudget, cpi }) => {
  const budget = Number(totalBudget);
  if (!(Number.isFinite(budget) && budget > 0)) return EAC_BASES.NO_BUDGET;
  if (cpi === null || cpi === undefined) return EAC_BASES.NO_COST_PERFORMANCE;
  return Number(cpi) > 0 ? EAC_BASES.BUDGET_OVER_CPI : EAC_BASES.CPI_ZERO;
};

module.exports = { EAC_BASES, eacBasisOf };
