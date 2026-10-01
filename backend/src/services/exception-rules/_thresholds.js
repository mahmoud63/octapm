/**
 * The documented thresholds of the PC-7b exception rules (owner rule: one
 * constant per kind until the owner asks for settings; no column, no project
 * JSON). docs/project-controls/OCTAPM_CHANGE_INTELLIGENCE.md §6 lists the same
 * figures; a change here is a change there.
 *
 * A tolerance says when two figures differ at all (a measured figure must
 * exceed its limit by more than the tolerance); a critical ratio says when an
 * exceedance is large enough to be `critical` instead of the kind's default.
 */

// A quantity is Decimal(18,3): anything inside half a thousandth is the same figure.
const QUANTITY_TOLERANCE = 0.0005;
// Money is stored to the cent; the budget register's own tolerance (budget.service TOLERANCE).
const MONEY_TOLERANCE = 0.01;
// An exceedance more than 10 % above its limit is critical.
const CRITICAL_OVER_RATIO = 0.1;
// The business rule's CPI alert (CPI below 0.9 triggers an alert): an official
// EAC whose CPI is below 0.9 is critical.
const CPI_ALERT = 0.9;
// A finish more than 5 working days behind its baseline is a slip; 20 or more,
// or any slip on a critical activity, is critical.
const SCHEDULE_SLIP_THRESHOLD_DAYS = 5;
const SCHEDULE_SLIP_CRITICAL_DAYS = 20;

const THRESHOLDS = Object.freeze({
  quantity_over_allocation: { tolerance: QUANTITY_TOLERANCE, criticalOverRatio: CRITICAL_OVER_RATIO },
  quantity_over_boq: { tolerance: QUANTITY_TOLERANCE, criticalOverRatio: CRITICAL_OVER_RATIO },
  certified_over_installed: { tolerance: QUANTITY_TOLERANCE },
  certified_over_earned: { tolerance: MONEY_TOLERANCE },
  committed_over_budget: { tolerance: MONEY_TOLERANCE, criticalOverRatio: CRITICAL_OVER_RATIO },
  actual_over_committed: { tolerance: MONEY_TOLERANCE, criticalOverRatio: CRITICAL_OVER_RATIO },
  forecast_over_revised: { tolerance: MONEY_TOLERANCE, criticalOverRatio: CRITICAL_OVER_RATIO, cpiAlert: CPI_ALERT },
  allocation_over_capacity: { quantityTolerance: QUANTITY_TOLERANCE, moneyTolerance: MONEY_TOLERANCE },
  schedule_slip_on_mapped_item: {
    thresholdDays: SCHEDULE_SLIP_THRESHOLD_DAYS,
    criticalDays: SCHEDULE_SLIP_CRITICAL_DAYS,
    pendingCertificationTolerance: MONEY_TOLERANCE,
  },
});

/** `critical` when measured exceeds limit by more than `ratio` of the limit (or the limit is not positive). */
const overRatioSeverity = ({ measured, limit, ratio, otherwise = "warning" }) => {
  if (!(Number(limit) > 0)) return "critical";
  return Number(measured) > Number(limit) * (1 + ratio) ? "critical" : otherwise;
};

const round3 = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

module.exports = {
  QUANTITY_TOLERANCE,
  MONEY_TOLERANCE,
  CRITICAL_OVER_RATIO,
  CPI_ALERT,
  SCHEDULE_SLIP_THRESHOLD_DAYS,
  SCHEDULE_SLIP_CRITICAL_DAYS,
  THRESHOLDS,
  overRatioSeverity,
  round2,
  round3,
};
