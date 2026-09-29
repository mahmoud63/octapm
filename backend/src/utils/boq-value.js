/**
 * Where a bill stands for the schedule baseline (owner decision E2): one
 * rule, read by the schedule readiness's boq_present check, the baseline
 * lock (schedule.service assertBoqForBaseline) and the setup baseline gate
 * (NO_BOQ, BOQ_HAS_NO_VALUE, BOQ_NO_IN_SCOPE_VALUE), so the three agree on
 * every bill.
 *
 * Value is more than a cent (closure review, 2026-09-29): the money
 * tolerance the coverage check and the setup gate use. A bill whose only
 * in-scope value is one cent has none — the coverage check cannot tell it
 * covered from uncovered (its remainder is within the tolerance), so it
 * must never count as in scope.
 */
const { addMoney, toMoneyNumber } = require("./money");

// The rules that take a row out of scope for mapping.
const OUT_OF_SCOPE_MAPPING_RULES = ["not_applicable", "optional"];

const BOQ_STATE = Object.freeze({
  NONE: "none",
  UNPRICED: "unpriced",
  OUT_OF_SCOPE: "out_of_scope",
  IN_SCOPE: "in_scope",
});

// Money at or below this is no value (the cent tolerance).
const BOQ_VALUE_EPSILON = 0.01;

/** Whether a BOQ row is in scope for mapping (its rule neither not applicable nor optional). */
const isInScopeBoqRow = (item) =>
  Boolean(item) && !OUT_OF_SCOPE_MAPPING_RULES.includes(item.mappingRule || "required");

/** The value of these rows: the sum of their priced (positive) amounts, in money. */
const pricedBoqValue = (items) =>
  addMoney(...items.filter((item) => item && toMoneyNumber(item.amount) > 0).map((item) => item.amount));

/** Where a bill (its active rows: each with amount and mappingRule) stands for the baseline. */
const boqStateOf = (items) => {
  if (!Array.isArray(items) || items.length === 0) return BOQ_STATE.NONE;
  if (pricedBoqValue(items.filter(isInScopeBoqRow)) > BOQ_VALUE_EPSILON) return BOQ_STATE.IN_SCOPE;
  if (pricedBoqValue(items) <= BOQ_VALUE_EPSILON) return BOQ_STATE.UNPRICED;
  return BOQ_STATE.OUT_OF_SCOPE;
};

module.exports = {
  BOQ_STATE,
  BOQ_VALUE_EPSILON,
  OUT_OF_SCOPE_MAPPING_RULES,
  boqStateOf,
  isInScopeBoqRow,
  pricedBoqValue,
};
