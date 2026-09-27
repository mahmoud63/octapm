/**
 * Which rule gave the business-rule estimate at completion, as the server
 * names it (backend utils/eac-basis: the EV report's and the forecast's
 * eacBasis), and the one wording every screen gives it (owner decision D2):
 * the Overview's "Forecast at completion", the Forecast tab's EAC card and
 * the EV tab's EAC card say the same thing about the same figure.
 *
 * The EAC is certified and unchanged: revised BAC / CPI when CPI > 0,
 * otherwise the revised BAC. Nothing is computed here.
 */
export type EacBasis =
  | 'budget_over_cpi'
  | 'budget_cpi_zero'
  | 'budget_no_cost_performance'
  | 'no_budget'

export const EAC_OVER_CPI = 'revised budget ÷ CPI'
/** The label the budget carries when there is no CPI (Phase 22A). */
export const EAC_NO_COST_PERFORMANCE = 'the budget — no cost performance yet'
/** The label the budget carries when CPI is 0: cost spent, nothing earned. */
export const EAC_CPI_ZERO =
  'the budget — nothing earned against the cost spent (CPI 0)'

/**
 * The basis for a report that predates the field: the server's own rule
 * (CPI > 0 → budget ÷ CPI; CPI 0 → the budget; no CPI → the budget).
 */
export function eacBasisFrom(
  basis: EacBasis | string | null | undefined,
  cpi: number | null | undefined,
  totalBudget?: number | null
): EacBasis | null {
  if (
    basis === 'budget_over_cpi' ||
    basis === 'budget_cpi_zero' ||
    basis === 'budget_no_cost_performance' ||
    basis === 'no_budget'
  ) {
    return basis
  }
  if (totalBudget !== undefined && totalBudget !== null && !(totalBudget > 0)) {
    return 'no_budget'
  }
  if (cpi === null || cpi === undefined) return 'budget_no_cost_performance'
  return cpi > 0 ? 'budget_over_cpi' : 'budget_cpi_zero'
}

/** The words for a basis; null for no_budget (there is no EAC to label). */
export function eacBasisLabel(basis: EacBasis | null | undefined): string | null {
  switch (basis) {
    case 'budget_over_cpi':
      return EAC_OVER_CPI
    case 'budget_cpi_zero':
      return EAC_CPI_ZERO
    case 'budget_no_cost_performance':
      return EAC_NO_COST_PERFORMANCE
    default:
      return null
  }
}

/** Whether the EAC is the revised budget handed back, not a projection. */
export const eacIsBudgetFallback = (basis: EacBasis | null | undefined) =>
  basis === 'budget_cpi_zero' || basis === 'budget_no_cost_performance'

/** A label at the start of a card's line: its first letter capitalised. */
export const capitalise = (text: string) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text
