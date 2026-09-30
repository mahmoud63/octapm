/**
 * The initial default forecast of a cost record made by a creator that is not
 * the cost API: a ledger's first posting, a commitment recompute, an equipment
 * posting, the post-import seed (owner decision R5-2).
 *
 * The cost API's creator works the default from the activity's approved
 * allocation — the figure every read shows as the record's Budget. These
 * creators wrote it from a budget of 0 instead, so the default was just the
 * first posting's amount (or 0): "Default 500" beside a Budget of 10,000, with
 * a basis — the larger of budget and actual — that was untrue against the
 * budget on the screen, and a projected final cost that counted 500 for the
 * activity until the next posting. One rule, one input: every creator now
 * reads the same approved allocation, in its own transaction.
 *
 * Only the forecast and its source are decided here. The record's stored
 * budget stays what each creator always wrote (0): no stored amount of an
 * existing project changes, and no existing row is touched.
 */
const { forecastOnCreate } = require("../utils/cost-forecast");

/** The approved allocation of each of these activities, by activity id (0 where there is none). */
const approvedBudgets = async ({ tx, projectId, activityIds }) => {
  // Required here, not at the top: the allocation service reaches the approval
  // workflow, which reaches back to services that post to the ledger.
  const { getApprovedActivityAllocationTotals } = require("./activity-boq-allocation.service");
  const totals = await getApprovedActivityAllocationTotals({ projectId, activityIds }, tx);
  return new Map(activityIds.map((activityId) => [activityId, totals.get(activityId)?.amount || 0]));
};

/** `{ forecast, forecastSource: 'default' }` for one record created without a forecast. */
const defaultForecastOnCreate = async ({ tx, projectId, activityId, actual = 0 }) => {
  const budgets = await approvedBudgets({ tx, projectId, activityIds: [activityId] });
  return forecastOnCreate({ budget: budgets.get(activityId), actual });
};

/** The same for many records at once (the post-import seed): a Map of activity id → `{ forecast, forecastSource }`. */
const defaultForecastsOnCreate = async ({ tx, projectId, activityIds, actual = 0 }) => {
  if (!activityIds.length) return new Map();
  const budgets = await approvedBudgets({ tx, projectId, activityIds });
  return new Map(activityIds.map((activityId) => [activityId, forecastOnCreate({ budget: budgets.get(activityId), actual })]));
};

module.exports = { defaultForecastOnCreate, defaultForecastsOnCreate };
