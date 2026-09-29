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
 *   the mapping either (owner decisions, 2026-09-28): no allocation count,
 *   no coverage share, no count of critical activities without an approved
 *   allocation, and no figure an allocation gives one activity — its budget
 *   on the schedule and the activities (the approved allocation, and the
 *   generator's budget beside it), its forecast cost (budget, projection,
 *   basis, level) and the forecast's list and tally of the activities over
 *   budget, its row of the EV report's breakdown (budget, PV, EV, in an
 *   order set by the budget), its budget on the Cost module's records and in
 *   the budget reconciliation (in the answer to writing a record and in its
 *   history too), what the cost summary adds up from those budgets over the
 *   activities that have a record (per category and in total, with the
 *   forecast and EAC that fall back to them), and a budget line's spread
 *   suggested from the allocations. Reading the cost module does not change this
 *   (E1): a cost controller, a planning engineer or a PM without boq:read is
 *   given none of it either. Criticality itself (the flag, the float, the
 *   critical path) stays with the schedule's readers.
 * - `budget`: may read the BOQ or the cost module. What the approved
 *   allocations add up to for the whole project — the revision's total
 *   budget, the EV report's and the health card's BAC, PV, EV, AC, SPI, CPI
 *   and EAC, the forecast's project cost, the workspace home's row — is the
 *   Cost module's own figure (the budget register, the cost ledger, the
 *   commitments), so these totals stay for a cost reader. Someone who holds
 *   neither has no other road to them, and is not given them here either.
 */
const { hasPermission } = require("../middleware/rbac");
const { HttpError } = require("./http-error");

/** Whether the caller may read the BOQ, as the BOQ endpoints decide it. */
const canReadBoq = (req) => hasPermission(req, "boq", "read");

/**
 * What the caller may receive: the bill's figures and every per-activity
 * figure read off the mapping (`boq`), and the project's totals built from
 * the approved allocations (`budget`).
 */
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
// and stays for every schedule reader. mintedByBoqItemId — the BOQ row
// that created the activity (POST /boq/items with an activity name creates
// the activity and its allocation together), which GET /schedule carries off
// the activity's row — is a per-activity link to the bill: beside the
// critical flag it says which critical activities the bill is allocated to,
// so it goes the same way.
const ACTIVITY_BOQ_KEYS = ["allocatedBoqQuantity", "allocatedBoqAmount", "allocatedBoqWeight", "approvedAllocationCount", "mintedByBoqItemId"];
// The activity's budget: on the schedule, the approved allocation's value;
// beside it the budget the generator or the import gave the activity (the
// bill spread over the programme). Per activity, so read off the mapping:
// withheld from everyone who may not read the BOQ, cost readers included
// (owner decision E1, 2026-09-28) — which activity carries money says which
// activity is mapped.
const ACTIVITY_BUDGET_KEYS = ["budget", "generatedBudget"];
// The revision's totals of the same: the approved allocations' sum and the
// generated schedule's total. Project totals: a cost reader's.
const REVISION_BUDGET_KEYS = ["totalBudget", "generatedTotalBudget"];

/** The server's reason beside a per-activity figure it withholds. */
const MAPPING_DETAILS_WITHHELD = "Mapping details unavailable to you";

/** An activity as this caller may receive it. */
const withheldActivity = (activity, access = FULL_ACCESS) => {
  if (access.boq || !activity || typeof activity !== "object") return activity;
  return withoutKeys(activity, [...ACTIVITY_BOQ_KEYS, ...ACTIVITY_BUDGET_KEYS]);
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

// The generator's budgets per activity and per WBS node: the bill spread
// over the programme, one package or activity at a time (a node with one
// activity states that activity's budget). Withheld from everyone who may
// not read the BOQ (E1).
const withoutGeneratedActivityBudgets = (holder) => {
  const result = { ...holder };
  if (Array.isArray(result.activities)) {
    result.activities = result.activities.map((activity) => withoutKeys(activity, ["budget"]));
  }
  if (Array.isArray(result.wbs)) result.wbs = result.wbs.map((node) => withoutKeys(node, ["budget"]));
  return result;
};

// ... and the generated project total, a total: withheld only from someone
// who reads neither the BOQ nor the cost module.
const withoutGeneratedBudgets = (holder) => {
  const result = withoutGeneratedActivityBudgets(holder);
  if (result.projectSummary) result.projectSummary = withoutKeys(result.projectSummary, ["totalBudget"]);
  return result;
};

// A generated revision's stored snapshot carries the BOQ rows it was
// generated from, and the generator's budgets.
const withheldSnapshot = (snapshot, access) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const withoutRows = withoutKeys(snapshot, ["boqRows"]);
  return access.budget ? withoutGeneratedActivityBudgets(withoutRows) : withoutGeneratedBudgets(withoutRows);
};

/** A schedule revision (as serialised for the API) as this caller may receive it. */
const withheldRevision = (revision, access = FULL_ACCESS) => {
  if (access.boq || !revision || typeof revision !== "object") return revision;
  let result = { ...withoutKeys(revision, ["unallocatedBoqAmount"]) };
  if (has(result, "readiness")) result.readiness = withheldScheduleReadiness(result.readiness, access);
  if (has(result, "snapshotJson")) result.snapshotJson = withheldSnapshot(result.snapshotJson, access);
  // GET /schedule spreads the snapshot's projectSummary and wbs onto the
  // revision: the per-node budgets go for everyone without BOQ read, the
  // totals the way of the revision's own totals.
  result = access.budget
    ? withoutGeneratedActivityBudgets(result)
    : withoutGeneratedBudgets(withoutKeys(result, REVISION_BUDGET_KEYS));
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
 * project's totals — the approved allocations' sum, BAC, PV, EV, AC, SPI,
 * CPI, EAC, the S-curve — stay; a cost reader who may not read the BOQ
 * loses the bill's open value, the bill's figures in the readiness gate's
 * details, and the per-activity breakdown (E1): each row's budget is its
 * approved allocation, its EV that allocation × % complete, and the rows are
 * the twenty largest allocations in the order of their size — which activity
 * carries which share of the bill. The breakdown is left out, and the
 * report says it is withheld and why. Output only: the stored snapshot's
 * basis and breakdown are not touched.
 */
const withheldEvReport = (report, access = FULL_ACCESS) => {
  if (access.boq || !report || typeof report !== "object" || Array.isArray(report)) return report;
  const result = { ...withoutKeys(report, ["unallocatedBoqAmount"]) };
  if (has(result, "readinessGate")) result.readinessGate = withheldReadinessGate(result.readinessGate, access);
  if (has(result, "activityBreakdown")) {
    delete result.activityBreakdown;
    result.activityBreakdownWithheld = true;
    result.activityBreakdownReason = MAPPING_DETAILS_WITHHELD;
  }
  return result;
};

// The forecast's cost view is money from the budget (the approved
// allocations) and the cost ledger. Someone who may read neither the BOQ
// nor the cost module is not given its money: each activity's budget,
// spend, commitments, projection and overrun (and the reasons, which state
// them), the project's budget, EAC, bottom-up, projection, overrun and
// spend, and each budget line's amounts.
const FORECAST_COST_KEYS = ["budget", "bac", "eac", "bottomUp", "projected", "overrun", "overrunPct", "actual"];
const FORECAST_LINE_KEYS = ["revised", "committed", "actual", "forecast", "overrun", "overrunPct"];
// Nor anything of the cost view that is read off the mapping (owner
// decision, 2026-09-28). An activity's cost has a basis only when it has a
// budget — an approved allocation — and a cost level above "low" only then
// (nothing can be over a budget it does not have), so the basis, the level,
// and a place among the activities over budget (and their tally by level)
// are each the activity's mapping badge: beside its critical flag they count
// the critical activities without an allocation. The EAC's basis says only
// which rule gave a figure this reader is not given. Each is left out; an
// activity's cost says it is withheld and why. Criticality, the schedule's
// levels and bases, the budget lines' names and levels (the cost module's,
// not the bill's), the project's cost verdict (summary.costLevel) and the
// dataQuality sentences stay: none is per activity. (A cost reader who may
// not read the BOQ loses the per-activity part of this too, and keeps the
// money and the EAC's basis — withheldMappedForecast below.)
const FORECAST_MAPPING_COST_KEYS = ["eacBasis", "topRisks"];
const FORECAST_COST_WITHHELD_REASON = "Cost figures are not available to you";
const WITHHELD_ACTIVITY_COST = Object.freeze({ withheld: true, reason: FORECAST_COST_WITHHELD_REASON });

const withheldForecastActivity = (activity) =>
  activity && activity.cost && typeof activity.cost === "object"
    ? { ...activity, cost: { ...WITHHELD_ACTIVITY_COST } }
    : activity;

// A cost reader who may not read the BOQ (E1): an activity's budget in the
// forecast is its approved allocation, and its projection, overrun, basis,
// level and reasons are each built from that budget — per activity, so read
// off the mapping. What the cost ledger says of the activity (its spend and
// commitments) is the Cost module's own, and stays. The activities over
// budget (only an activity with a budget can be one) and their tally by
// level go; the project's cost — budget, BAC, EAC and its basis, bottom-up,
// projection, overrun, spend — and the budget lines (the budget register)
// stay.
const mappedActivityCost = (activity) =>
  activity && activity.cost && typeof activity.cost === "object"
    ? {
        ...activity,
        cost: {
          ...(has(activity.cost, "actual") ? { actual: activity.cost.actual } : {}),
          ...(has(activity.cost, "committed") ? { committed: activity.cost.committed } : {}),
          withheld: true,
          reason: MAPPING_DETAILS_WITHHELD,
        },
      }
    : activity;

const mapList = (list, fn) => (Array.isArray(list) ? list.map(fn) : list);

/** A cost reader's forecast when they may not read the BOQ: nothing per activity read off the mapping. */
const withheldMappedForecast = (forecast) => {
  const result = { ...forecast, activities: mapList(forecast.activities, mappedActivityCost) };
  if (forecast.schedule && typeof forecast.schedule === "object") {
    result.schedule = { ...forecast.schedule, topRisks: mapList(forecast.schedule.topRisks, mappedActivityCost) };
  }
  if (forecast.cost && typeof forecast.cost === "object") {
    result.cost = {
      ...withoutKeys(forecast.cost, ["topRisks"]),
      ...(has(forecast.cost, "counts") ? { counts: withoutKeys(forecast.cost.counts, ["atRisk"]) } : {}),
      activityCostWithheld: true,
      activityCostReason: MAPPING_DETAILS_WITHHELD,
    };
  }
  return result;
};

/** GET /forecast (and the forecast inside its explanation) as this caller may receive it. */
const withheldForecast = (forecast, access = FULL_ACCESS) => {
  // A BOQ reader receives the forecast exactly as built.
  if (access.boq || !forecast || typeof forecast !== "object") return forecast;
  // A cost reader keeps the project's cost, and nothing per activity that
  // an allocation gives (E1).
  if (access.budget) return withheldMappedForecast(forecast);
  const result = { ...forecast, activities: mapList(forecast.activities, withheldForecastActivity) };
  if (forecast.schedule && typeof forecast.schedule === "object") {
    result.schedule = { ...forecast.schedule, topRisks: mapList(forecast.schedule.topRisks, withheldForecastActivity) };
  }
  if (forecast.cost && typeof forecast.cost === "object") {
    result.cost = {
      ...withoutKeys(forecast.cost, [...FORECAST_COST_KEYS, ...FORECAST_MAPPING_COST_KEYS]),
      ...(has(forecast.cost, "counts") ? { counts: withoutKeys(forecast.cost.counts, ["atRisk"]) } : {}),
      budgetLines: mapList(forecast.cost.budgetLines, (line) => withoutKeys(line, FORECAST_LINE_KEYS)),
      withheld: true,
      reason: FORECAST_COST_WITHHELD_REASON,
    };
  }
  return result;
};

// The Cost module's own answers state an activity's approved allocation too
// (E1): a cost record's budget is that activity's approved allocation, and
// beside it the budget first written on the record (the allocation when the
// record was made, or the figure its writer gave); the budget reconciliation
// sets each activity's allocation against the budget lines. A cost reader
// who may not read the BOQ keeps the cost ledger's own figures on each record
// (the cost categories, committed, actual, the stored forecast) and every
// true project total (the budget register, the ledger's actual, the
// commitments, the reconciliation's totals and verdict), and is given no
// activity's allocation: the record's budget is omitted — on the lists, in
// the answer to writing a record, and in the record's history — and the
// reconciliation's per-activity rows keep only what the budget lines and the
// approved change orders say of the activity.
//
// The test is the owner's differential: moving one approved allocation
// between any two activities changes nothing such a reader receives. The
// cost summary's budget, forecast and EAC are sums over the activities that
// have a cost record, split by the activity's category — a record's
// estimate at completion falls back to its budget (its allocation) where no
// forecast is set — so moving an allocation onto or off an activity with a
// record, or between categories, moves them, and a category or a project
// with one such activity states that activity's allocation exactly. They are
// not the project's totals (the EV report's, the forecast's and the budget
// register's are, and stay); each is omitted, and the summary says why.

/** A cost record (GET /cost, /cost/summary, and the answer to writing one) as this caller may receive it. */
const withheldCostRecord = (record, access = FULL_ACCESS) =>
  access.boq ? record : withoutKeys(record, ACTIVITY_BUDGET_KEYS);

/** GET /projects/:id/cost ({ rows, pagination }) as this caller may receive it. */
const withheldCostRecords = (result, access = FULL_ACCESS) => {
  if (access.boq || !result || typeof result !== "object" || !Array.isArray(result.rows)) return result;
  return { ...result, rows: result.rows.map((record) => withheldCostRecord(record, access)) };
};

// What the cost summary builds from the records' budgets (the approved
// allocations of the activities with a record): each category's budget,
// forecast (a record without a forecast counts its budget) and variance;
// the records' budget and forecast totals; the EAC scenarios built from that
// forecast; and the "allocated to activities" beside the register.
const COST_SUMMARY_PHASE_KEYS = ["budget", "forecast", "variance", "variancePct"];
const COST_SUMMARY_TOTAL_KEYS = ["budget", "forecast"];
const COST_SUMMARY_EAC_KEYS = ["toComplete", "optimistic", "mostLikely", "pessimistic"];

/**
 * GET /projects/:id/cost/summary as this caller may receive it. A BOQ reader
 * receives the service's answer untouched (the same object). Anyone else
 * keeps each record without its allocation, each category's and the
 * records' committed and actual, the EAC's basis and actual, and the budget
 * register's figures; everything built from the records' budgets is
 * omitted, and the answer says so and why (activityBudgetsWithheld).
 */
const withheldCostSummary = (summary, access = FULL_ACCESS) => {
  if (access.boq || !summary || typeof summary !== "object" || Array.isArray(summary)) return summary;
  const result = { ...summary };
  if (Array.isArray(summary.records)) result.records = summary.records.map((record) => withheldCostRecord(record, access));
  if (has(summary, "byPhase")) result.byPhase = mapList(summary.byPhase, (row) => withoutKeys(row, COST_SUMMARY_PHASE_KEYS));
  if (has(summary, "totals")) result.totals = withoutKeys(summary.totals, COST_SUMMARY_TOTAL_KEYS);
  if (has(summary, "eac")) result.eac = withoutKeys(summary.eac, COST_SUMMARY_EAC_KEYS);
  if (has(summary, "budget")) result.budget = withoutKeys(summary.budget, ["allocatedToActivities"]);
  result.activityBudgetsWithheld = true;
  result.activityBudgetsReason = MAPPING_DETAILS_WITHHELD;
  return result;
};

// A reconciliation row's figures that are the activity's approved
// allocation, or are built from it.
const RECONCILIATION_ACTIVITY_KEYS = ["boqBudget", "activityBudget", "difference"];

/**
 * The budget reconciliation (GET /budget/reconciliation, and the one a
 * budget snapshot stored) as this caller may receive it: for a caller who
 * may not read the BOQ each activity keeps its name and what the budget
 * lines and the approved change orders give it; the lists of activities
 * that differ, or have a budget and no line, are omitted; the answer says
 * the activity figures are withheld and why. The totals and the verdict are
 * the project's and stay. Output only: a stored snapshot is not changed.
 */
const withheldBudgetReconciliation = (reconciliation, access = FULL_ACCESS) => {
  if (access.boq || !reconciliation || typeof reconciliation !== "object" || Array.isArray(reconciliation)) {
    return reconciliation;
  }
  if (!["activities", "mismatches", "activitiesWithoutLines"].some((key) => has(reconciliation, key))) return reconciliation;
  const result = withoutKeys(reconciliation, ["mismatches", "activitiesWithoutLines"]);
  return {
    ...result,
    ...(has(reconciliation, "activities")
      ? { activities: mapList(reconciliation.activities, (row) => withoutKeys(row, RECONCILIATION_ACTIVITY_KEYS)) }
      : {}),
    activityBudgetsWithheld: true,
    activityBudgetsReason: MAPPING_DETAILS_WITHHELD,
  };
};

/** A budget snapshot (or GET /budget/snapshots' { items }) as this caller may receive it. */
const withheldBudgetSnapshot = (snapshot, access = FULL_ACCESS) => {
  if (access.boq || !snapshot || typeof snapshot !== "object") return snapshot;
  if (Array.isArray(snapshot.items)) return { ...snapshot, items: snapshot.items.map((item) => withheldBudgetSnapshot(item, access)) };
  if (!has(snapshot, "reconciliation")) return snapshot;
  const reconciliation = withheldBudgetReconciliation(snapshot.reconciliation, access);
  return reconciliation === snapshot.reconciliation ? snapshot : { ...snapshot, reconciliation };
};

/**
 * A budget line's suggested spread over the activities
 * (GET /budget/lines/:lineId/allocations/suggest). Its basis is the approved
 * BOQ allocations — each activity's amount and its share of them, and which
 * activities have any — so a caller who may not read the BOQ is given no
 * suggestion: no items, and the reason.
 */
const withheldAllocationSuggestion = (suggestion, access = FULL_ACCESS) => {
  if (access.boq || !suggestion || typeof suggestion !== "object") return suggestion;
  return {
    ...withoutKeys(suggestion, ["basis"]),
    items: [],
    withheld: true,
    reason: MAPPING_DETAILS_WITHHELD,
  };
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
const withoutRecordBudget = (summary) => withoutKeys(summary, ACTIVITY_BUDGET_KEYS);

// An event's summaries (before, after, and the event's own) with `strip`
// applied to each one the event carries.
const withSummaries = (event, strip) => ({
  ...event,
  ...(has(event, "oldSummary") ? { oldSummary: strip(event.oldSummary) } : {}),
  ...(has(event, "newSummary") ? { newSummary: strip(event.newSummary) } : {}),
  ...(has(event, "summary") ? { summary: strip(event.summary) } : {}),
});

/**
 * A project's history (GET /audit, which the schedule's status history
 * reads) as this caller may receive it. Someone who may not read the BOQ is
 * not given the history of the bill's records — their summaries state its
 * rates, quantities and values — nor a cost record's budget in its history:
 * the budget written on a record is its activity's approved allocation when
 * the record was made (E1), withheld here as it is on GET /cost. Someone who
 * reads neither the BOQ nor the cost module is not given a schedule
 * revision's total budget, which its transitions record in their summaries.
 * Everything else is as built; the stored events are not changed.
 */
const withheldAuditHistory = (history, access = FULL_ACCESS) => {
  if (access.boq || !history || typeof history !== "object" || !Array.isArray(history.events)) return history;
  const events = history.events
    .filter((event) => !(event && BOQ_RECORD_TYPES.has(event.recordType || event.entityType)))
    .map((event) => {
      const type = event && (event.recordType || event.entityType);
      if (type === "cost_record") return withSummaries(event, withoutRecordBudget);
      if (!access.budget && type === "schedule_revision") return withSummaries(event, withoutRevisionTotals);
      return event;
    });
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
  MAPPING_DETAILS_WITHHELD,
  WBS_OUTLINE_KEYS,
  boqFigureAccess,
  canReadBoq,
  forecastCostWithheld,
  withheldActivity,
  withheldAllocationSuggestion,
  withheldAuditHistory,
  withheldBudgetReconciliation,
  withheldBudgetSnapshot,
  withheldCostRecord,
  withheldCostRecords,
  withheldCostSummary,
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
