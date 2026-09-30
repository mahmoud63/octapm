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
 *   forecast and EAC that fall back to them), a budget line's spread
 *   suggested from the allocations, and the report builder's columns that
 *   state any of these (an activity's budget; a cost record's budget,
 *   variance and CPI). Reading the cost module does not change this
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
 *
 * The specification check (GET /specifications/scope-gaps, POST
 * /scope-gaps/explain, GET /specifications/:sectionId and POST
 * /:sectionId/conflicts — admitted on document_control:read) was a road
 * round the BOQ endpoints (owner check, 2026-09-29): it read the bill's
 * rows to match them to the sections and handed every specification
 * reader the row count (summary.boqItems), the rows no section covers
 * (uncoveredBoq[] — id, code, description, unit, quantity) and their count,
 * the sections with no row (summary.noBoq, the "no_boq" gap, counts.boq),
 * and each section's related rows (related.boqItems); /explain put the
 * uncovered rows and the counts in the model's prompt, so the answer could
 * repeat them. None of it is the specification's own — it is the BOQ's.
 * For a member who may not read the BOQ the service does not load the bill
 * at all: the check runs against the sheets and the schedule only, every
 * BOQ key above is left out (not zeroed), `boqWithheld` /
 * `boqItemsWithheld` says why, and the prompt carries no row and no count.
 * The sections, their text, keywords, sheets, activities and RFIs are the
 * specification reader's and stay.
 *
 * Not withheld, and not a gap in the EV breakdown's withholding: activity
 * cost loadings (ActivityCostLoading, GET/POST /reports/cost-loading), per
 * activity though they are (orchestrator ruling G1, 2026-09-29). A cost
 * loading is the Cost module's own record — its planned value typed in by
 * the person who creates it (source "manual" by default; the source is a
 * label, never a calculation), not a figure derived from an allocation.
 * E1's own test holds for it: moving an approved allocation between
 * activities changes no cost loading. It stays visible to cost readers, and
 * this module does not touch it; reviewers do not report it as an E1 leak.
 *
 * The client billing statement (GET /prime-contract/statement, admitted on
 * ipc:read — a QS, a cost controller, finance, a PM) is withheld in part
 * (owner check, 2026-09-29). Its schedule of values is not a record the
 * commercial module keeps: each line is a live BoqItem row — its id, code,
 * section, description, unit, quantity, rate and amount (as contractAmount)
 * — read off the bill when the statement is built, beside what the period's
 * IPC items certified against that row, with the remaining value and the
 * share complete worked from the row's amount. So a member who may not read
 * the BOQ is given no line at all (the rows, their count and their total go
 * together): `lines` is omitted and `linesWithheld` says why. What stays is
 * the commercial module's own: the client contract (PrimeContract — its
 * value and terms, maintained under ipc:update contract.manage and moved by
 * approved change orders), the certificates' totals (IpcCertificate), the
 * invoices, receipts and the advance. The contract, receivables and
 * advances reads carry no BOQ row and are not touched. (The contract's
 * original value is seeded once, when the contract is first read, from the
 * project's contract value or else the bill's total. Owner decisions 1-3,
 * 2026-09-29: while it is that unconfirmed BOQ total, or its source is not
 * established, it is withheld from a member who may not read the BOQ — the
 * contract, the statement and the contract.manage history alike; see
 * withheldPrimeContract.)
 *
 * The payment certificate beside it (GET /ipc/:period, admitted on the same
 * ipc:read) listed the same rows: each certificate line carried its BoqItem
 * row (id, code, ref, description, unit, quantity, rate), its allocation
 * (id, quantity, amount, weight, activity) and its progress link, and the
 * certification review worked over them (earned value, approved limit,
 * over-certification, lines needing an override) — stamped on the
 * certificate as earnedValueAtCertification, approvedLimitAtCertification
 * and overCertificationAmount when it is certified. For a member who may
 * not read the BOQ those keys are left out of every certificate the IPC
 * routes answer with (the period read, the list, create, adjustments,
 * submit, certify, and the certificate returned with a payment or a
 * retention release), and `boqWithheld` names them; the answer to editing a
 * line names the line and nothing of it (`itemWithheld`). The certificate's
 * own totals, invoices, payments and releases stay.
 *
 * Nor does the review reach such a member through a refusal (owner check,
 * 2026-09-29). When certifying needs a PM override — the period claims more
 * than approved progress earned, or more than the approved allocation or
 * its quantity — POST /ipc/:period/certify (ipc:certify: the PM, finance)
 * refuses with 400 IPC_PM_OVERRIDE_REASON_REQUIRED or 403
 * IPC_PM_OVERRIDE_REQUIRED and the whole review as error.details
 * (currentClaimedAmount, earnedAmount, approvedLimitAmount — the
 * allocation's amount —, overEarnedAmount, overApprovedQuantity,
 * overrideLineCount …), which every non-production API sends. The IPC
 * router passes each refusal through withheldError: for a caller who may
 * not read the BOQ those two refusals carry `boqWithheld` in place of the
 * review; status, code and message — the business reason, and so what to do
 * next — stay. The other details these routes and their services refuse
 * with are not the BOQ's and stay: the certificate's own balance due and
 * retained balance (a payment or a release over them), a running workflow's
 * ids, a refused transition's statuses, the permission refused and the
 * request fields that failed validation. The billing routes
 * (prime-contract) refuse with no details at all.
 *
 * Nor does the bill reach anyone through a stored AI run (owner check,
 * 2026-09-29). A run keeps its prompt and answer, served back to the person
 * who made it: GET /assistant/conversations/:id (under a project too), the
 * answer to POST /messages/:id/feedback, and the history a follow-up
 * question sends the model — the web and the mobile app read the same
 * routes; runs have no export. Three kinds are built from the bill: the
 * scope-gap review (scope_gap: the uncovered rows' codes and descriptions
 * and the BOQ counts, stored for every member before 6468eb0), the forecast
 * narrative (forecast: each activity's budget, its approved allocation) and
 * the report narrative over a source with mapping columns (report_narrative
 * titled after the Activities or cost-record source). Owning the run is no
 * exemption: when the reader may not read the BOQ on the run's project now
 * (decided per request, as that project's routes decide it), the content —
 * prompt, answer, citations, sources, actions — is left out and
 * `contentWithheld` says why; the metadata (id, title, kind, when, provider,
 * model, rating) stays. Nothing stored is rewritten or deleted. A run built
 * without the bill (a member without boq:read, since this check) is marked
 * so on its prompt message and served as it is; a run with no project
 * cannot be decided per project and is withheld unless so marked. The
 * specification conflict check (spec_conflict) never sent the model a BOQ
 * row — the section, the sheets' text and the RFIs — and is not withheld.
 *
 * A change order's and a sub valuation's allocation links (change_order:read,
 * sub_pay_app:read) point at a BoqItem row and its allocation, which the
 * links carried nested — the row's code, description, quantity, rate and
 * amount, the allocation's quantity, amount and weight. For a caller who
 * may not read the BOQ the links keep their own figures and lose those
 * (withheldAllocationLinks); the change order and the valuation are the
 * commercial module's own records and are not withheld.
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

/**
 * The server's reason beside the specification check's BOQ coverage, which
 * specification.service leaves out for a member who may not read the BOQ
 * (it runs the check without loading the bill; see the header).
 */
const SPEC_BOQ_WITHHELD = "BOQ coverage is worked from the BOQ's rows, available only to members who may read the BOQ";

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

// The refusals of an IPC certification that needs a PM override: their
// details are the certification review (ipc.service certifyIpcPeriod).
const IPC_REVIEW_REFUSALS = new Set(["IPC_PM_OVERRIDE_REASON_REQUIRED", "IPC_PM_OVERRIDE_REQUIRED"]);
const IPC_REVIEW_WITHHELD =
  "The certification review is worked from the BOQ's rows and their allocations, available only to members who may read the BOQ";

/**
 * An error as this caller may receive it. A lifecycle step refused because
 * the schedule is not ready (SCHEDULE_NOT_READY) states the whole readiness
 * in error.details, and a period lock refused by the reporting gate states
 * the gate: both go the way of their success answers. Status, code and
 * message stay, and so do the readiness's `ready` and `blockingCount`. An
 * IPC certification refused for want of a PM override states the
 * certification review, worked from the BOQ's rows and their allocations:
 * it is left out whole, and `boqWithheld` says why.
 */
const withheldError = (error, access = FULL_ACCESS) => {
  if (access.boq || !(error instanceof HttpError) || !error.details || typeof error.details !== "object") {
    return error;
  }
  let details = error.details;
  if (IPC_REVIEW_REFUSALS.has(error.code)) details = { boqWithheld: { keys: ["certificationReview"], reason: IPC_REVIEW_WITHHELD } };
  else if (Array.isArray(details.checks)) details = withheldScheduleReadiness(details, access);
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

// A payment certificate's certification (ipc.service certifyIpcPeriod)
// records, in its audit event's summary and its approval event's metadata,
// the certification review worked over the certificate's lines — the BOQ's
// rows and their allocations: the approved limit (the allocations' amount),
// earned value, the amounts over earned and over the limit, the quantity
// over the allocation, the lines needing an override and those missing
// progress evidence — and the count of those lines linked to progress
// evidence. Who certified, when, the status, the certificate's own totals
// and the override reason stay.
const IPC_EVENT_BOQ_KEYS = ["certificationReview", "progressLinks"];
const IPC_EVENT_PARTS = ["oldSummary", "newSummary", "summary", "metadata"];

// ─── the client contract's original value (owner decisions 1-3, 2026-09-29) ──
//
// ensureContract seeds a contract's original value from the project's own
// contract value or, when the project has none, from the active BOQ's total
// (prime-contract.service; PrimeContract.originalValueSource says which). A
// project value, and a value a contract manager entered or confirmed
// (contract_entry), are the commercial module's own, established amounts:
// every IPC / contract reader receives them. A BOQ fallback nobody has
// confirmed is the bill's total under another name, and a value whose source
// is not established (NULL: written before the column) may be; for a caller
// who may not read the BOQ on the project the amount is left out — the
// original value, the revised value (original + approved changes, which
// stay), the remaining to certify (revised − certified), and the agreed
// advance when it is a rate of the value (advanceRate > 0) — never zeroed,
// and `valueWithheld: { keys, source, reason }` says why. Certificates,
// invoices, payments, retention, the advance received and recovered, and the
// change orders' totals are independently authorized and stay.
const CONTRACT_VALUE_ESTABLISHED = new Set(["project_value", "contract_entry"]);
const CONTRACT_VALUE_WITHHELD = Object.freeze({
  boq_fallback:
    "The original value is the BOQ's total, not yet confirmed as the contract value: it is available only to members who may read the BOQ until a contract manager enters or confirms it",
  unestablished:
    "Where the original value came from is not established: it is available only to members who may read the BOQ until a contract manager enters or confirms it",
});
const CONTRACT_EVENT_VALUE_WITHHELD =
  "The original value recorded here was not an established contract value: it is available only to members who may read the BOQ";
const CONTRACT_VALUE_KEYS = ["originalValue", "revisedValue"];
const STATEMENT_VALUE_KEYS = ["originalValue", "revisedValue", "remainingToCertify"];

const contractValueSourceOf = (source) => source || "unestablished";

/** Whether this caller is refused a contract's original value from `source`. */
const contractValueWithheld = (source, access = FULL_ACCESS) =>
  !access.boq && !CONTRACT_VALUE_ESTABLISHED.has(contractValueSourceOf(source));

const contractValueReason = (source) =>
  CONTRACT_VALUE_WITHHELD[source] || CONTRACT_VALUE_WITHHELD.unestablished;

// The keys of `holder` that state the amount: `base`, and the agreed advance
// when it is a rate of the value.
const contractValueKeys = (holder, base, advanceRate) =>
  [...base, ...(Number(advanceRate) > 0 ? ["advanceAmount"] : [])].filter((key) => has(holder, key));

const withoutContractValue = (holder, base, source, advanceRate) => {
  const keys = contractValueKeys(holder, base, advanceRate);
  if (!keys.length) return holder;
  return { ...withoutKeys(holder, keys), valueWithheld: { keys, source, reason: contractValueReason(source) } };
};

/**
 * A client contract (prime-contract.service serializeContract — GET, PATCH
 * and POST /advances on /prime-contract answer with it) as this caller may
 * receive it. A BOQ reader's contract, and one whose value is established,
 * is returned untouched (the same object).
 */
const withheldPrimeContract = (contract, access = FULL_ACCESS) => {
  if (access.boq || !contract || typeof contract !== "object" || Array.isArray(contract)) return contract;
  if (!contractValueWithheld(contract.originalValueSource, access)) return contract;
  const source = contractValueSourceOf(contract.originalValueSource);
  return withoutContractValue(contract, CONTRACT_VALUE_KEYS, source, contract.advanceRate);
};

// ─── retention against the cap (PC-7a item 2, owner 2026-09-29) ─────────────
//
// A certificate's retention stops at the cap, a rate of the revised value
// (prime-contract.service certificateFinancials): on a certificate the cap
// limits, its retention is the cap less what earlier certificates hold, and
// its net payable, tax and balance follow from it — the revised value
// restated. While the contract's value is withheld from the caller, those
// figures of a certificate not yet certified are withheld with it: the draft
// and submitted certificates' totals, the statement's retention, tax and
// total due for such a period, and the same totals as the history recorded
// them. Decided on what the caller already sees — the value's source, the cap
// rate (a term) and the certificate's status — never on whether the cap bit,
// so the answer says nothing about the amount. The retention a certified
// certificate holds, its net payable, invoices, payments and releases are
// the certificate's own record and stay; so do certified work, gross,
// materials, deductions and the advance recovered.
const RETENTION_HELD_STATUSES = new Set(["certified", "paid"]);
const CERTIFICATE_CAP_KEYS = ["totalRet", "netPayable", "taxAmount", "balanceDue"];
const STATEMENT_CAP_KEYS = ["retentionThisPeriod", "taxAmount", "totalDue"];
const RETENTION_CAP_WITHHELD =
  "Retention on a certificate not yet certified is limited by the retention cap, a rate of the contract value, which is not established: it and the figures that follow from it are available only to members who may read the BOQ until a contract manager enters or confirms the value";

/**
 * Whether this caller is refused the cap-limited figures of certificates not
 * yet certified. `terms` is the project's contract as
 * prime-contract.service contractValueTerms reads it ({ originalValueSource,
 * retentionCapRate }), or null when the project has no contract row — then no
 * cap was applied and nothing is withheld.
 */
const retentionCapWithheld = (terms, access = FULL_ACCESS) =>
  Boolean(
    terms &&
      Number(terms.retentionCapRate) > 0 &&
      contractValueWithheld(terms.originalValueSource, access),
  );

const retentionHeld = (status) => RETENTION_HELD_STATUSES.has(status);

// `row` without the keys of `keys` it carries, and `valueWithheld` naming
// them; `row` itself when it carries none.
const withoutCapFigures = (row, keys, terms) => {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const present = keys.filter((key) => has(row, key));
  if (!present.length) return row;
  return {
    ...withoutKeys(row, present),
    valueWithheld: {
      keys: present,
      source: contractValueSourceOf(terms && terms.originalValueSource),
      reason: RETENTION_CAP_WITHHELD,
    },
  };
};

/** A certificate row (status + totals) as this caller may receive it. */
const withheldCertificateTotals = (row, terms, access = FULL_ACCESS) => {
  if (!retentionCapWithheld(terms, access) || !row || typeof row !== "object" || retentionHeld(row.status)) return row;
  return withoutCapFigures(row, CERTIFICATE_CAP_KEYS, terms);
};

// The report builder's payment-certificate source (report-sources
// ipc_certificate) states the same cap-limited totals as columns. A row of a
// certificate not yet certified, on a project where the caller is refused
// them (retentionCapWithheld), has each such column null — the same row, the
// same place, as withheldReportRow does for a mapping column — and
// `withheldColumns` names them. `status` is the certificate's own, read from
// the record whether or not the run shows the status column.
const REPORT_CERTIFICATE_CAP_COLUMNS = Object.freeze({
  ipc_certificate: Object.freeze(["totalRet", "netPayable", "taxAmount", "balanceDue"]),
});

/** The columns of a report source that a retention cap on an unestablished contract value limits. */
const reportCertificateCapColumns = (sourceKey) => REPORT_CERTIFICATE_CAP_COLUMNS[sourceKey] || [];

const withheldReportCertificateRow = (row, { status, keys, terms, access = FULL_ACCESS }) => {
  if (!row || typeof row !== "object" || retentionHeld(status) || !retentionCapWithheld(terms, access)) return row;
  const present = (keys || []).filter((key) => has(row, key));
  if (!present.length) return row;
  const result = { ...row };
  for (const key of present) result[key] = null;
  result.withheldColumns = [...new Set([...(Array.isArray(row.withheldColumns) ? row.withheldColumns : []), ...present])];
  return result;
};

// A workflow run on a payment certificate (workflow-tools ipc_certificate)
// keeps the certificate's net payable as its context's `amount`, taken when
// the run started (on submission). While the cap limits it (see
// retentionCapWithheld) that amount restates the unestablished value, so:
// the engine leaves it out of the context it stores and routes on — decided
// for a reader who may not read the BOQ (NO_ACCESS), since every approver
// and every reader of the run sees the same stored context and the template
// it chose — and a run stored before that rule loses it on the way out to
// such a reader. `valueWithheld` names it. The context's status is the
// certificate's when the run started.
const WORKFLOW_CERTIFICATE_CAP_KEYS = ["amount"];
const withheldCertificateContext = (context, terms, access = NO_ACCESS) => {
  if (!context || typeof context !== "object" || retentionHeld(context.status) || !retentionCapWithheld(terms, access)) return context;
  return withoutCapFigures(context, WORKFLOW_CERTIFICATE_CAP_KEYS, terms);
};

/** A serialized workflow instance as this caller may receive it (only an ipc_certificate run can change). */
const withheldWorkflowInstance = (instance, terms, access = FULL_ACCESS) => {
  if (!instance || typeof instance !== "object" || instance.tool !== "ipc_certificate") return instance;
  const context = withheldCertificateContext(instance.context, terms, access);
  return context === instance.context ? instance : { ...instance, context };
};

const isContractManageEvent = (event) =>
  Boolean(
    event &&
      (event.recordType || event.entityType) === "project" &&
      event.summary &&
      typeof event.summary === "object" &&
      event.summary.transition === "contract.manage",
  );

/**
 * A contract.manage event (prime-contract.service updateContract) records the
 * original value before and after. Each summary states its own source (since
 * owner decisions 1-3); one written earlier states none, and is taken as a
 * project value only when the contract's source now is project_value — a
 * contract whose original value was never entered — and otherwise as
 * unestablished. An amount that is not established is left out of that
 * summary, and `valueWithheld` names the summaries. The rest of the event —
 * who, when, the rates — stays.
 */
const withheldContractManageEvent = (event, contractValueSource) => {
  const legacySource = contractValueSource === "project_value" ? "project_value" : "unestablished";
  const parts = [];
  const copy = { ...event };
  for (const part of ["oldSummary", "newSummary", "summary"]) {
    const value = event[part];
    if (!value || typeof value !== "object" || !has(value, "originalValue")) continue;
    const source = has(value, "originalValueSource") ? contractValueSourceOf(value.originalValueSource) : legacySource;
    if (CONTRACT_VALUE_ESTABLISHED.has(source)) continue;
    copy[part] = withoutKeys(value, ["originalValue"]);
    parts.push(part);
  }
  if (!parts.length) return event;
  return { ...copy, valueWithheld: { parts, keys: ["originalValue"], reason: CONTRACT_EVENT_VALUE_WITHHELD } };
};

const withheldIpcCertificateEvent = (event) => {
  const strip = (value) => withoutKeys(value, IPC_EVENT_BOQ_KEYS);
  const stripped = withSummaries(event, strip);
  if (has(event, "metadata")) stripped.metadata = strip(event.metadata);
  if (IPC_EVENT_PARTS.every((key) => stripped[key] === event[key])) return event;
  return { ...stripped, boqWithheld: { keys: IPC_EVENT_BOQ_KEYS, reason: IPC_REVIEW_WITHHELD } };
};

// A certificate event's totals as recorded (submission, certification: the
// before and after summaries, the event's own summary and the approval
// metadata), where the cap-limited figures are withheld (see
// retentionCapWithheld): each part recorded for a certificate not yet
// certified — a before/after summary by its own status, the summary and the
// metadata by the status the event moved to (draft or submitted) — loses
// them, and `valueWithheld` names the parts. A certification's after-state
// is the certificate's held retention and stays, and so do the invoice,
// payment and release events, which only a certified certificate has (their
// statuses are the invoice's, the payment's and the retention's).
const PRE_CERTIFICATION_STATUSES = new Set(["draft", "submitted"]);
const withheldIpcCertificateEventTotals = (event, terms) => {
  const toStatus = event.newStatus ?? event.toStatus ?? null;
  const parts = [];
  const copy = { ...event };
  for (const part of IPC_EVENT_PARTS) {
    const value = event[part];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const status = part === "oldSummary" || part === "newSummary" ? value.status : toStatus;
    if (!PRE_CERTIFICATION_STATUSES.has(status)) continue;
    const present = CERTIFICATE_CAP_KEYS.filter((key) => has(value, key));
    if (!present.length) continue;
    copy[part] = withoutKeys(value, present);
    parts.push(part);
  }
  if (!parts.length) return event;
  return {
    ...copy,
    valueWithheld: {
      parts,
      keys: CERTIFICATE_CAP_KEYS,
      source: contractValueSourceOf(terms && terms.originalValueSource),
      reason: RETENTION_CAP_WITHHELD,
    },
  };
};

/**
 * A project's history (GET /audit, which the schedule's status history
 * reads) as this caller may receive it. Someone who may not read the BOQ is
 * not given the history of the bill's records — their summaries state its
 * rates, quantities and values — nor a cost record's budget in its history:
 * the budget written on a record is its activity's approved allocation when
 * the record was made (E1), withheld here as it is on GET /cost. Someone who
 * reads neither the BOQ nor the cost module is not given a schedule
 * revision's total budget, which its transitions record in their summaries.
 * Nor is a payment certificate's certification review, which its
 * certification records in the audit summary and the approval metadata:
 * the event stays, without it, and `boqWithheld` says why.
 * Nor is the client contract's original value where it is not established
 * (withheldContractManageEvent below): `contractValueSource` is the project's
 * contract's source now (prime-contract.service contractValueSource).
 * Nor, where the contract's value is withheld and a retention cap is set
 * (`contractTerms`: prime-contract.service contractValueTerms), are the
 * cap-limited totals recorded for a certificate not yet certified
 * (withheldIpcCertificateEventTotals).
 * Everything else is as built; the stored events are not changed.
 */
const withheldAuditHistory = (
  history,
  access = FULL_ACCESS,
  { contractValueSource = null, contractTerms = null } = {},
) => {
  if (access.boq || !history || typeof history !== "object" || !Array.isArray(history.events)) return history;
  const capWithheld = retentionCapWithheld(contractTerms, access);
  const events = history.events
    .filter((event) => !(event && BOQ_RECORD_TYPES.has(event.recordType || event.entityType)))
    .map((event) => {
      const type = event && (event.recordType || event.entityType);
      if (isContractManageEvent(event)) return withheldContractManageEvent(event, contractValueSource);
      if (type === "cost_record") return withSummaries(event, withoutRecordBudget);
      if (type === "ipc_certificate") {
        const withoutReview = withheldIpcCertificateEvent(event);
        return capWithheld ? withheldIpcCertificateEventTotals(withoutReview, contractTerms) : withoutReview;
      }
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

// The report builder (POST /reports/preview, /export, /ask, /narrate, a
// saved report's run and export, and a scheduled run — every one of them
// services/report-builder.service's runQuery) reads the same records
// straight from the database, so its columns go the same way (E1). A
// source's columns that state a figure an allocation gives one activity:
// - activity.budget: the activity's stored budget — the BOQ row's amount
//   for an activity the row created (POST /boq/items with an activity
//   name), the generator's per-activity budget for a generated schedule —
//   withheld on the schedule and the activities as `budget` and
//   `generatedBudget`.
// - cost_record.budget: the budget written on the record, its activity's
//   approved allocation when the record was made — withheld on GET /cost,
//   the write answers and /audit — and the two figures computed from it,
//   variance (budget − forecast) and cpi (budget ÷ actual).
// No other source states one: the budget lines are the budget register
// (the Cost module's own, a cost reader's), the other money columns are
// their own registers', and no source reads an allocation, a coverage share
// or a mapped count. For a row of a project where the caller may not read
// the BOQ each such column is null — the same row, the same place — and the
// row names the columns withheld from it; a filter, sort, grouping or
// aggregate over the column sees that null, never the figure.
const REPORT_MAPPING_COLUMNS = Object.freeze({
  activity: Object.freeze(["budget"]),
  cost_record: Object.freeze(["budget", "variance", "cpi"]),
});

/** The columns of a report source that state a figure an allocation gives one activity. */
const reportMappingColumns = (sourceKey) => REPORT_MAPPING_COLUMNS[sourceKey] || [];

/**
 * A report row (flattened: { id, projectId, projectName, <column>: value })
 * as this caller may receive it on the row's project: for a caller who may
 * not read the BOQ each of `keys` the row carries is null, and
 * `withheldColumns` names them. A BOQ reader's row is returned untouched
 * (the same object).
 */
const withheldReportRow = (row, keys, access = FULL_ACCESS) => {
  if (access.boq || !row || typeof row !== "object") return row;
  const present = (keys || []).filter((key) => has(row, key));
  if (!present.length) return row;
  const result = { ...row };
  for (const key of present) result[key] = null;
  result.withheldColumns = present;
  return result;
};

// A background job whose input is the bill itself. The Schedule module's
// generation job (schedule.generate) keeps the uploaded bill's text as
// `rawText` — every row's description, quantity, rate and amount — which
// Pass 1, "Structuring BOQ", reads. The job is the schedule's, read under
// schedule:read on /jobs; the bill is the BOQ's, the same rows a stored
// revision snapshot withholds as `boqRows`. The review of the Round-4
// closure patch read the rows off GET /jobs as a site engineer and a
// planning engineer who were refused GET /boq.
const JOB_BILL_PAYLOAD_KEYS = Object.freeze({
  "schedule.generate": Object.freeze(["rawText"]),
});
const JOB_BILL_WITHHELD = "The uploaded bill is available only to members who may read the BOQ";

/**
 * A serialized background job (jobs/job.service serializeJob) as this caller
 * may receive it: for a caller who may not read the BOQ, the job's input
 * without the bill — its label and file name stay — and `payloadWithheld`
 * names the keys left out and why. A BOQ reader's job, and every job whose
 * input carries no bill, is returned untouched (the same object).
 */
const withheldJob = (job, access = FULL_ACCESS) => {
  if (access.boq || !job || typeof job !== "object") return job;
  const payload = job.payload;
  if (!payload || typeof payload !== "object") return job;
  const present = (JOB_BILL_PAYLOAD_KEYS[job.type] || []).filter((key) => has(payload, key));
  if (!present.length) return job;
  const kept = { ...payload };
  for (const key of present) delete kept[key];
  return { ...job, payload: kept, payloadWithheld: { keys: present, reason: JOB_BILL_WITHHELD } };
};

const BILLING_LINES_WITHHELD =
  "The schedule of values is the BOQ's rows, available only to members who may read the BOQ";

/**
 * The client billing statement (prime-contract.service buildStatement) as
 * this caller may receive it: for a caller who may not read the BOQ — cost
 * readers included — the statement without its schedule of values (`lines`,
 * the BOQ rows), and `linesWithheld` says why. The contract, the summary,
 * the current certificate and the periods are the commercial module's own
 * and stay as built — except the contract's original value where it is not
 * established (see withheldPrimeContract): the contract and the summary then
 * lose the amount and every figure stating it, each with `valueWithheld`;
 * where a retention cap is set too, so do the cap-limited figures of a
 * period not yet certified (retentionCapWithheld): the summary's retention,
 * tax and total due when the current period is one, and the totals of each
 * such period in `current` and `periods`. A BOQ reader's statement is
 * returned untouched (the same object).
 */
const withheldBillingStatement = (statement, access = FULL_ACCESS) => {
  if (access.boq || !statement || typeof statement !== "object" || Array.isArray(statement)) return statement;
  let answer = statement;
  if (has(statement, "lines")) {
    answer = { ...withoutKeys(statement, ["lines"]), linesWithheld: { reason: BILLING_LINES_WITHHELD } };
  }
  const contract = statement.contract;
  if (contract && typeof contract === "object" && contractValueWithheld(contract.originalValueSource, access)) {
    const source = contractValueSourceOf(contract.originalValueSource);
    const withheldContract = withheldPrimeContract(contract, access);
    // The contract row is the terms: its source and its cap rate.
    const capWithheld = retentionCapWithheld(contract, access);
    const current = statement.current;
    const currentUncertified = capWithheld && current && typeof current === "object" && !retentionHeld(current.status);
    const summaryKeys = currentUncertified ? [...STATEMENT_VALUE_KEYS, ...STATEMENT_CAP_KEYS] : STATEMENT_VALUE_KEYS;
    const summary =
      statement.summary && typeof statement.summary === "object"
        ? withoutContractValue(statement.summary, summaryKeys, source, contract.advanceRate)
        : statement.summary;
    if (withheldContract !== contract || summary !== statement.summary) {
      answer = { ...answer, contract: withheldContract, summary };
    }
    if (capWithheld) {
      const withheldCurrent = withheldCertificateTotals(current, contract, access);
      const periods = mapList(statement.periods, (row) => withheldCertificateTotals(row, contract, access));
      const periodsChanged = Array.isArray(periods) && periods.some((row, index) => row !== statement.periods[index]);
      if (withheldCurrent !== current || periodsChanged) {
        answer = { ...answer, current: withheldCurrent, periods: periodsChanged ? periods : statement.periods };
      }
    }
  }
  return answer;
};

const IPC_LINES_WITHHELD =
  "The certificate's lines are the BOQ's rows and their allocations, available only to members who may read the BOQ";

// What a payment certificate (IpcCertificate) carries that is worked from
// the BOQ's rows and their allocations rather than kept by the certificate:
// its lines (`items` — each one a BoqItem row with its allocation and the
// progress behind it), the certification review worked over those lines
// (earned value, approved limit, over-certification, the count of lines
// needing an override), and that review as stamped on the certificate when
// it was certified.
const IPC_BOQ_KEYS = [
  "items",
  "certificationReview",
  "earnedValueAtCertification",
  "approvedLimitAtCertification",
  "overCertificationAmount",
];

/**
 * A payment certificate (ipc.service — the period read, the list's rows,
 * and the certificate every IPC write answers with) as this caller may
 * receive it: for a caller who may not read the BOQ, the certificate without
 * the keys above, and `boqWithheld` names those left out and why. The
 * certificate's own record — period, status, totals certified, retained and
 * payable, invoices, payments, retention releases — stays, except that a
 * certificate not yet certified loses its cap-limited totals while the
 * contract's value is withheld and a retention cap is set (`contractTerms`:
 * prime-contract.service contractValueTerms; see retentionCapWithheld), with
 * `valueWithheld` saying why. A BOQ reader's certificate, and one that
 * carries none of the keys, is returned untouched (the same object).
 */
const withheldIpcCertificate = (certificate, access = FULL_ACCESS, { contractTerms = null } = {}) => {
  if (access.boq || !certificate || typeof certificate !== "object" || Array.isArray(certificate)) {
    return certificate;
  }
  const keys = IPC_BOQ_KEYS.filter((key) => has(certificate, key));
  const withoutLines = keys.length
    ? { ...withoutKeys(certificate, keys), boqWithheld: { keys, reason: IPC_LINES_WITHHELD } }
    : certificate;
  return withheldCertificateTotals(withoutLines, contractTerms, access);
};

/**
 * One certificate line (ipc.service updateIpcItem — the answer to editing
 * it) as this caller may receive it. A line is a BoqItem row certified: its
 * row (code, description, unit, quantity, rate), its allocation and its
 * progress link, and its own quantity, rate and money worked from them. A
 * caller who may not read the BOQ is told which line was written (its id)
 * and nothing of it — `itemWithheld` says why. A BOQ reader's line is
 * returned untouched (the same object).
 */
const withheldIpcItem = (item, access = FULL_ACCESS) => {
  if (access.boq || !item || typeof item !== "object" || Array.isArray(item)) return item;
  return { id: item.id, itemWithheld: { reason: IPC_LINES_WITHHELD } };
};

const ALLOCATION_LINK_WITHHELD =
  "The linked BOQ row and its allocation are available only to members who may read the BOQ";

// What a change order's or a sub valuation's allocation link
// (ChangeOrderAllocationLink, SubValuationAllocationLink) carries of the
// bill rather than of itself: the BoqItem row it points at (id, code, ref,
// description, unit, qty, rate, amount) and the allocation (id, quantity,
// amount, weight, status, with that row again and its activity) — nested,
// and as the ids beside them.
const ALLOCATION_LINK_BOQ_KEYS = ["allocationId", "boqItemId", "allocation", "boqItem"];

const withheldAllocationLink = (link) => {
  if (!link || typeof link !== "object" || Array.isArray(link)) return link;
  const keys = ALLOCATION_LINK_BOQ_KEYS.filter((key) => has(link, key));
  if (!keys.length) return link;
  return { ...withoutKeys(link, keys), boqWithheld: { keys, reason: ALLOCATION_LINK_WITHHELD } };
};

/**
 * A change order or a sub valuation (change-order.service — the register's
 * rows and the order every write and transition answers with;
 * sub-valuation.service — the list's rows and the answer to editing one) as
 * this caller may receive it: for a caller who may not read the BOQ, each
 * allocation link without the BOQ row and the allocation it points at, and
 * `boqWithheld: { keys, reason }` on the link names those left out and why.
 * The link's own figures — a change order's quantity and amount, a
 * valuation's quantity, work done, materials on site and retention — its
 * notes, and every figure of the record itself stay. Nothing about the
 * workflow depends on it. A BOQ reader's record, and one without allocation
 * links, is returned untouched (the same object).
 */
const withheldAllocationLinks = (record, access = FULL_ACCESS) => {
  if (access.boq || !record || typeof record !== "object" || Array.isArray(record)) return record;
  if (!Array.isArray(record.allocationLinks) || !record.allocationLinks.length) return record;
  return { ...record, allocationLinks: record.allocationLinks.map(withheldAllocationLink) };
};

module.exports = {
  ALLOCATION_LINK_BOQ_KEYS,
  ALLOCATION_LINK_WITHHELD,
  withheldAllocationLinks,
  BILLING_LINES_WITHHELD,
  withheldBillingStatement,
  CONTRACT_EVENT_VALUE_WITHHELD,
  CONTRACT_VALUE_WITHHELD,
  contractValueWithheld,
  withheldPrimeContract,
  IPC_BOQ_KEYS,
  IPC_LINES_WITHHELD,
  IPC_REVIEW_REFUSALS,
  IPC_REVIEW_WITHHELD,
  withheldIpcCertificate,
  withheldIpcItem,
  // The workspace home's IPC queue (a submitted certificate's net payable).
  withheldCertificateTotals,
  // PC-7a review: the report builder's certificate columns and a workflow run's context.
  REPORT_CERTIFICATE_CAP_COLUMNS,
  RETENTION_CAP_WITHHELD,
  retentionCapWithheld,
  reportCertificateCapColumns,
  withheldReportCertificateRow,
  withheldCertificateContext,
  withheldWorkflowInstance,
  JOB_BILL_WITHHELD,
  withheldJob,
  BOQ_FIGURE_KEYS,
  MAPPING_DETAILS_WITHHELD,
  REPORT_MAPPING_COLUMNS,
  SPEC_BOQ_WITHHELD,
  reportMappingColumns,
  withheldReportRow,
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
