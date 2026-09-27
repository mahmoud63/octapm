/**
 * Who receives the bill's figures (§12).
 *
 * The BOQ endpoints refuse a member who may not read the BOQ — template,
 * role and party access resolved by hasPermission, the way every module
 * decides. The schedule, the activities and the setup cards are open to
 * more people than that, and they carry the bill's figures: what each
 * activity was allocated (quantity, value, weight), what is left open, and
 * the readiness checks that state the bill's value. This is the one place
 * that decides what such a member is given instead. Nothing is recomputed:
 * a figure is either handed over exactly as the service built it or left
 * out — omitted, not zeroed, so nobody reads a "0" as a fact.
 *
 * Two readers are distinguished:
 *
 * - `boq`: may read the BOQ. Gets every payload exactly as it is built —
 *   the same object, untouched.
 * - `budget`: may read the BOQ or the cost module. The activity budget on
 *   the schedule is the approved BOQ allocation, and the revision's total is
 *   their sum; a cost reader already sees these figures in the Cost module
 *   (the budget lines, the EV basis), so the budget stays for them. Someone
 *   who holds neither has no other road to these figures, and is not given
 *   them here either.
 */
const { hasPermission } = require("../middleware/rbac");

/** Whether the caller may read the BOQ, as the BOQ endpoints decide it. */
const canReadBoq = (req) => hasPermission(req, "boq", "read");

/** What the caller may receive: the bill's figures, and the budget built from them. */
const boqFigureAccess = (req) => {
  const boq = canReadBoq(req);
  return { boq, budget: boq || hasPermission(req, "cost", "read") };
};

const FULL_ACCESS = Object.freeze({ boq: true, budget: true });

// The bill's money as readiness counts it and details it: the bill's value,
// what is allocatable, approved, pending, open, optional and not applicable
// — PC-3's coverage amounts, which the coverage endpoint refuses the same
// person. Shares, statuses and row counts are not among them.
const BOQ_FIGURE_KEYS = new Set([
  "totalBoqAmount",
  "allocatableBoqAmount",
  "approvedAllocatedAmount",
  "pendingAllocatedAmount",
  "unallocatedAmount",
  "optionalUnallocatedAmount",
  "notApplicableAmount",
]);

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const withoutKeys = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (!keys.some((key) => has(value, key))) return value;
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
};

/** An object without the bill's money (the seven coverage amounts). */
const withoutBoqFigures = (values) =>
  values && typeof values === "object"
    ? Object.fromEntries(Object.entries(values).filter(([key]) => !BOQ_FIGURE_KEYS.has(key)))
    : values;

// What an activity carries of the bill: the approved allocation's quantity,
// value and weight. The number of approved allocations stays — it is a
// count, and the schedule's mapping badges read it.
const ACTIVITY_BOQ_KEYS = ["allocatedBoqQuantity", "allocatedBoqAmount", "allocatedBoqWeight"];
// The activity's budget: on the schedule, the approved allocation's value;
// beside it the budget the generator or the import gave the activity.
const ACTIVITY_BUDGET_KEYS = ["budget", "generatedBudget"];
// The revision's totals of the same: the approved allocations' sum and the
// generated schedule's total.
const REVISION_BUDGET_KEYS = ["totalBudget", "generatedTotalBudget"];

/** An activity as this caller may receive it. */
const withheldActivity = (activity, access = FULL_ACCESS) => {
  if (access.boq || !activity || typeof activity !== "object") return activity;
  const withoutBill = withoutKeys(activity, ACTIVITY_BOQ_KEYS);
  return access.budget ? withoutBill : withoutKeys(withoutBill, ACTIVITY_BUDGET_KEYS);
};

/**
 * A schedule readiness result as this caller may receive it: every check
 * keeps its key, verdict, severity and message — so `ready` and
 * `blockingCount` are the same for everyone — and the allocations check's
 * details lose the bill's value figures.
 */
const withheldScheduleReadiness = (readiness, access = FULL_ACCESS) => {
  if (access.boq || !readiness || typeof readiness !== "object" || !Array.isArray(readiness.checks)) {
    return readiness;
  }
  return {
    ...readiness,
    checks: readiness.checks.map((check) =>
      check && check.details ? { ...check, details: withoutBoqFigures(check.details) } : check,
    ),
  };
};

// The generator's budgets: per activity, per WBS node, the project total.
const withoutGeneratedBudgets = (holder) => {
  const result = { ...holder };
  if (Array.isArray(result.activities)) {
    result.activities = result.activities.map((activity) => withoutKeys(activity, ["budget"]));
  }
  if (Array.isArray(result.wbs)) result.wbs = result.wbs.map((node) => withoutKeys(node, ["budget"]));
  if (result.projectSummary) result.projectSummary = withoutKeys(result.projectSummary, ["totalBudget"]);
  return result;
};

// A generated revision's stored snapshot carries the BOQ rows it was
// generated from, and the generator's budgets.
const withheldSnapshot = (snapshot, access) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const withoutRows = withoutKeys(snapshot, ["boqRows"]);
  return access.budget ? withoutRows : withoutGeneratedBudgets(withoutRows);
};

/** A schedule revision (as serialised for the API) as this caller may receive it. */
const withheldRevision = (revision, access = FULL_ACCESS) => {
  if (access.boq || !revision || typeof revision !== "object") return revision;
  let result = { ...withoutKeys(revision, ["unallocatedBoqAmount"]) };
  if (has(result, "readiness")) result.readiness = withheldScheduleReadiness(result.readiness, access);
  if (has(result, "snapshotJson")) result.snapshotJson = withheldSnapshot(result.snapshotJson, access);
  // GET /schedule spreads the snapshot's projectSummary and wbs onto the
  // revision; they go the way of the revision's own totals.
  if (!access.budget) result = withoutGeneratedBudgets(withoutKeys(result, REVISION_BUDGET_KEYS));
  return result;
};

/** GET /projects/:id/schedule as this caller may receive it. */
const withheldSchedule = (schedule, access = FULL_ACCESS) => {
  if (access.boq || !schedule || typeof schedule !== "object") return schedule;
  return {
    ...schedule,
    revision: withheldRevision(schedule.revision, access),
    activities: Array.isArray(schedule.activities)
      ? schedule.activities.map((activity) => withheldActivity(activity, access))
      : schedule.activities,
  };
};

module.exports = {
  BOQ_FIGURE_KEYS,
  boqFigureAccess,
  canReadBoq,
  withheldActivity,
  withheldRevision,
  withheldSchedule,
  withheldScheduleReadiness,
  withoutBoqFigures,
};
