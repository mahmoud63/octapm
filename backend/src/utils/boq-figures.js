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
 *   the same object, untouched. Anyone else is given nothing derived from
 *   the mapping either (owner decision, 2026-09-28): no allocation count,
 *   no coverage share, no count of critical activities without an approved
 *   allocation — criticality itself (the flag, the float, the critical path)
 *   stays with the schedule's readers.
 * - `budget`: may read the BOQ or the cost module. The activity budget on
 *   the schedule is the approved BOQ allocation, and the revision's total is
 *   their sum; a cost reader already sees these figures in the Cost module
 *   (the budget lines, the EV basis), so the budget stays for them. Someone
 *   who holds neither has no other road to these figures, and is not given
 *   them here either.
 */
const { hasPermission } = require("../middleware/rbac");
const { HttpError } = require("./http-error");

/** Whether the caller may read the BOQ, as the BOQ endpoints decide it. */
const canReadBoq = (req) => hasPermission(req, "boq", "read");

/** What the caller may receive: the bill's figures, and the budget built from them. */
const boqFigureAccess = (req) => {
  const boq = canReadBoq(req);
  return { boq, budget: boq || hasPermission(req, "cost", "read") };
};

const FULL_ACCESS = Object.freeze({ boq: true, budget: true });
const NO_ACCESS = Object.freeze({ boq: false, budget: false });

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
// value and weight — and how many approved allocations it has. That count
// is the activity's mapping badge (mapped or not): BOQ-derived, so it goes
// the way of the figures (owner decision, 2026-09-28: no allocation count,
// per activity or in total, to a member who may not read the BOQ). The
// activity's criticality — its critical flag and float — is the schedule's
// and stays for every schedule reader.
const ACTIVITY_BOQ_KEYS = ["allocatedBoqQuantity", "allocatedBoqAmount", "allocatedBoqWeight", "approvedAllocationCount"];
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
    // A revision staged beside the active one goes the same way.
    ...(has(schedule, "candidateRevision")
      ? { candidateRevision: withheldRevision(schedule.candidateRevision, access) }
      : {}),
    activities: Array.isArray(schedule.activities)
      ? schedule.activities.map((activity) => withheldActivity(activity, access))
      : schedule.activities,
  };
};

// A gate's blockers and warnings (setup readiness's official reporting
// gate, as EV reports it and stores it): each keeps its step, code and
// message; its details lose the bill's money.
const withoutDetailFigures = (entries) =>
  Array.isArray(entries)
    ? entries.map((entry) =>
        entry && entry.details && typeof entry.details === "object"
          ? { ...entry, details: withoutBoqFigures(entry.details) }
          : entry,
      )
    : entries;

/** A readiness gate ({ ready, message, blockers, warnings }) as this caller may receive it. */
const withheldReadinessGate = (gate, access = FULL_ACCESS) => {
  if (access.boq || !gate || typeof gate !== "object" || Array.isArray(gate)) return gate;
  return {
    ...gate,
    ...(has(gate, "blockers") ? { blockers: withoutDetailFigures(gate.blockers) } : {}),
    ...(has(gate, "warnings") ? { warnings: withoutDetailFigures(gate.warnings) } : {}),
  };
};

/**
 * The official EV report (GET /reports/ev, and a locked period's report) as
 * this caller may receive it. The route admits cost readers only, so the
 * budget — the approved allocations' sum, BAC, per-activity budgets — stays;
 * a cost reader who may not read the BOQ loses the bill's open value and
 * the bill's figures in the readiness gate's details. Output only: the
 * stored snapshot's basis is not touched.
 */
const withheldEvReport = (report, access = FULL_ACCESS) => {
  if (access.boq || !report || typeof report !== "object" || Array.isArray(report)) return report;
  const result = { ...withoutKeys(report, ["unallocatedBoqAmount"]) };
  if (has(result, "readinessGate")) result.readinessGate = withheldReadinessGate(result.readinessGate, access);
  return result;
};

// The forecast's cost view is money from the budget (the approved
// allocations) and the cost ledger. Someone who may read neither the BOQ
// nor the cost module is given its levels, bases and counts, not its money:
// each activity's budget, spend, commitments, projection and overrun (and
// the reasons, which state them), the project's budget, EAC, bottom-up,
// projection, overrun and spend, and each budget line's amounts.
const FORECAST_ACTIVITY_COST_KEYS = ["budget", "actual", "committed", "projected", "overrun", "overrunPct", "reasons"];
const FORECAST_COST_KEYS = ["budget", "bac", "eac", "bottomUp", "projected", "overrun", "overrunPct", "actual"];
const FORECAST_LINE_KEYS = ["revised", "committed", "actual", "forecast", "overrun", "overrunPct"];

const withheldForecastActivity = (activity) =>
  activity && activity.cost && typeof activity.cost === "object"
    ? { ...activity, cost: withoutKeys(activity.cost, FORECAST_ACTIVITY_COST_KEYS) }
    : activity;

const mapList = (list, fn) => (Array.isArray(list) ? list.map(fn) : list);

/** GET /forecast (and the forecast inside its explanation) as this caller may receive it. */
const withheldForecast = (forecast, access = FULL_ACCESS) => {
  // The forecast carries no BOQ quantity or value of its own (its budgets
  // are the approved allocations' amounts, the cost reader's budget): a
  // cost reader receives it exactly as built.
  if (access.budget || !forecast || typeof forecast !== "object") return forecast;
  const result = { ...forecast, activities: mapList(forecast.activities, withheldForecastActivity) };
  if (forecast.schedule && typeof forecast.schedule === "object") {
    result.schedule = { ...forecast.schedule, topRisks: mapList(forecast.schedule.topRisks, withheldForecastActivity) };
  }
  if (forecast.cost && typeof forecast.cost === "object") {
    result.cost = {
      ...withoutKeys(forecast.cost, FORECAST_COST_KEYS),
      topRisks: mapList(forecast.cost.topRisks, withheldForecastActivity),
      budgetLines: mapList(forecast.cost.budgetLines, (line) => withoutKeys(line, FORECAST_LINE_KEYS)),
    };
  }
  return result;
};

/** Whether a forecast's cost figures were withheld from this caller. */
const forecastCostWithheld = (forecast) =>
  Boolean(forecast && forecast.cost && typeof forecast.cost === "object" && !has(forecast.cost, "budget"));

/**
 * An error as this caller may receive it. A lifecycle step refused because
 * the schedule is not ready (SCHEDULE_NOT_READY) states the whole readiness
 * in error.details, and a period lock refused by the reporting gate states
 * the gate: both go the way of their success answers. Status, code and
 * message stay, and so do the readiness's `ready` and `blockingCount`.
 */
const withheldError = (error, access = FULL_ACCESS) => {
  if (access.boq || !(error instanceof HttpError) || !error.details || typeof error.details !== "object") {
    return error;
  }
  let details = error.details;
  if (Array.isArray(details.checks)) details = withheldScheduleReadiness(details, access);
  else if (has(details, "gate")) details = { ...details, gate: withheldReadinessGate(details.gate, access) };
  if (details === error.details) return error;
  const withheld = new HttpError(error.status, error.code, error.message, details);
  withheld.stack = error.stack;
  return withheld;
};

// The bill's own records: its rows, its revisions and the allocations of
// its rows to activities. Their history is the bill's.
const BOQ_RECORD_TYPES = new Set(["boq_item", "boq_revision", "activity_boq_allocation"]);

const withoutRevisionTotals = (summary) => withoutKeys(summary, REVISION_BUDGET_KEYS);

/**
 * A project's history (GET /audit, which the schedule's status history
 * reads) as this caller may receive it. Someone who may not read the BOQ is
 * not given the history of the bill's records — their summaries state its
 * rates, quantities and values. Someone who reads neither the BOQ nor the
 * cost module is not given a schedule revision's total budget, which its
 * transitions record in their summaries. Everything else is as built.
 */
const withheldAuditHistory = (history, access = FULL_ACCESS) => {
  if (access.boq || !history || typeof history !== "object" || !Array.isArray(history.events)) return history;
  const events = history.events
    .filter((event) => !(event && BOQ_RECORD_TYPES.has(event.recordType || event.entityType)))
    .map((event) =>
      !access.budget && event && (event.recordType || event.entityType) === "schedule_revision"
        ? {
            ...event,
            ...(has(event, "oldSummary") ? { oldSummary: withoutRevisionTotals(event.oldSummary) } : {}),
            ...(has(event, "newSummary") ? { newSummary: withoutRevisionTotals(event.newSummary) } : {}),
            ...(has(event, "summary") ? { summary: withoutRevisionTotals(event.summary) } : {}),
          }
        : event,
    );
  return { ...history, events };
};

// A project's row on the workspace dashboard states the official EV
// report's budget (bac: the approved allocations' sum), the estimate at
// completion built from it (eac: bac / CPI), and the report's money: earned
// value (the allocations × % complete — a finished activity's budget),
// planned value (the approved cost loading) and actual cost (the cost
// ledger). The scores, SPI and CPI stay.
const PROJECT_HEALTH_BUDGET_KEYS = ["bac", "eac", "ev", "pv", "ac"];

/** A project's row on the workspace dashboard as this caller may receive it on that project. */
const withheldProjectHealth = (row, access = FULL_ACCESS) =>
  access.budget ? row : withoutKeys(row, PROJECT_HEALTH_BUDGET_KEYS);

/**
 * GET /projects/workspace-dashboard as this caller may receive it: each
 * project's row as the caller's access on that project allows —
 * `accessFor(projectId)` is boqFigureAccess resolved as that project's own
 * routes resolve it. The rest of the answer is scores, counts and other
 * modules' records, as built. A row whose project's access is not known
 * loses the budget.
 */
const withheldWorkspaceDashboard = (dashboard, accessFor) => {
  if (!dashboard || typeof dashboard !== "object" || !Array.isArray(dashboard.projectHealth)) return dashboard;
  const rows = dashboard.projectHealth.map((row) =>
    withheldProjectHealth(row, accessFor(row && row.id) || NO_ACCESS),
  );
  return rows.every((row, index) => row === dashboard.projectHealth[index])
    ? dashboard
    : { ...dashboard, projectHealth: rows };
};

// The WBS outline (owner decision D3): anyone who can read the schedule may
// read the tree the programme is filed under — each node's id, code, name,
// parent, depth, place, status and its own counts of children and
// activities. The rest of a node belongs to the bill and the commercial
// side: how many BOQ rows are filed under it, the package's owner party and
// commitment, and its import provenance. A WBS node carries no money today;
// should one ever carry a budget, it is not in this list and so is withheld.
const WBS_OUTLINE_KEYS = [
  "id",
  "projectId",
  "parentId",
  "code",
  "name",
  "path",
  "pathNames",
  "fullName",
  "depth",
  "sortOrder",
  "isPackage",
  "status",
  "archivedAt",
  "childCount",
  "activityCount",
];
const WBS_OUTLINE_SUMMARY_KEYS = ["total", "active", "archived", "packages", "roots", "maxDepth", "linkedActivities"];

const pick = (value, keys) =>
  value && typeof value === "object"
    ? Object.fromEntries(keys.filter((key) => has(value, key)).map((key) => [key, value[key]]))
    : value;

const outlineNode = (node) => {
  const outlined = pick(node, WBS_OUTLINE_KEYS);
  if (node && Array.isArray(node.children)) outlined.children = node.children.map(outlineNode);
  return outlined;
};

/**
 * GET /projects/:id/structure/wbs as this caller may receive it. A BOQ
 * reader receives the service's answer untouched (the same object); anyone
 * else — admitted as a schedule reader — receives the outline, marked
 * `view: "outline"`.
 */
const withheldWbsList = (list, access = FULL_ACCESS) => {
  if (access.boq || !list || typeof list !== "object") return list;
  return {
    view: "outline",
    items: mapList(list.items, outlineNode),
    tree: mapList(list.tree, outlineNode),
    summary: pick(list.summary, WBS_OUTLINE_SUMMARY_KEYS),
  };
};

module.exports = {
  BOQ_FIGURE_KEYS,
  WBS_OUTLINE_KEYS,
  boqFigureAccess,
  canReadBoq,
  forecastCostWithheld,
  withheldActivity,
  withheldAuditHistory,
  withheldError,
  withheldEvReport,
  withheldForecast,
  withheldProjectHealth,
  withheldReadinessGate,
  withheldRevision,
  withheldSchedule,
  withheldScheduleReadiness,
  withheldWbsList,
  withheldWorkspaceDashboard,
  withoutBoqFigures,
};
