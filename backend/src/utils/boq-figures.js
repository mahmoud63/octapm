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

// PC-6 (integration): what the register carries of a quantity-measured
// activity — installed per BOQ item, the planned quantity (Σ approved
// allocations, or the method's) and the pending entries. Per-BOQ-item
// quantities: a member who may not read the BOQ gets none of them. The two
// figures are answered as a withheld marker — no value, the reason — so the
// screen draws "—" with the server's reason, never a zero and never "not
// reported"; each pending entry goes through the ledger's own withholding.
const ACTIVITY_QUANTITY_FIGURE_KEYS = ["installedQuantity", "plannedQuantity"];
const ACTIVITY_QUANTITY_WITHHELD =
  "Installed and planned quantities are worked from the BOQ's rows and their allocations, available only to members who may read the BOQ";

/** An activity as this caller may receive it. */
const withheldActivity = (activity, access = FULL_ACCESS) => {
  if (access.boq || !activity || typeof activity !== "object") return activity;
  const copy = withoutKeys(activity, [...ACTIVITY_BOQ_KEYS, ...ACTIVITY_BUDGET_KEYS]);
  for (const key of ACTIVITY_QUANTITY_FIGURE_KEYS) {
    if (has(copy, key)) copy[key] = { withheld: { reason: ACTIVITY_QUANTITY_WITHHELD } };
  }
  if (Array.isArray(copy.pendingQuantityEntries)) {
    copy.pendingQuantityEntries = copy.pendingQuantityEntries.map((entry) => withheldQuantityEntry(entry, access));
  }
  // PC-6 (core): the pending submission's quantity figures go the same way.
  if (copy.pendingProgress && typeof copy.pendingProgress === "object") {
    return { ...copy, pendingProgress: withheldProgressSubmission(copy.pendingProgress, access) };
  }
  return copy;
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

// A three-truths block (utils/figure-truth) without the labels of the
// figures withheld from this caller: a label says what a figure is and from
// what, so whoever is not given the figure is not given its label either —
// at the top level, in labels and in derivedFrom. When no figure's label is
// left, there is no truth block at all (undefined).
const TRUTH_DESCRIPTION_KEYS = ["labels", "derivedFrom"];
const truthWithout = (truth, keys) => {
  if (!truth || typeof truth !== "object" || Array.isArray(truth)) return truth;
  const withheld = new Set(keys);
  const result = {};
  for (const [key, value] of Object.entries(truth)) {
    if (withheld.has(key)) continue;
    if (TRUTH_DESCRIPTION_KEYS.includes(key) && value && typeof value === "object" && !Array.isArray(value)) {
      const kept = Object.fromEntries(Object.entries(value).filter(([figure]) => !withheld.has(figure)));
      if (Object.keys(kept).length) result[key] = kept;
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).some((key) => !TRUTH_DESCRIPTION_KEYS.includes(key)) ? result : undefined;
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
    // The cost block is withheld: no label for a figure it does not carry
    // (every figure cost.truth describes is withheld, so it goes whole).
    const truth = truthWithout(forecast.cost.truth, FORECAST_COST_KEYS);
    result.cost = {
      ...withoutKeys(forecast.cost, [...FORECAST_COST_KEYS, ...FORECAST_MAPPING_COST_KEYS, "truth"]),
      ...(truth ? { truth } : {}),
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

// A record's DEFAULT forecast (CostRecord.forecastSource 'default', owner
// decision R5-2) is max(0, budget, actual) of the budget written on the record
// — its activity's approved allocation when the record was made. With no
// actual yet it IS that allocation, so it goes the way of the budget: omitted
// for a member who may not read the BOQ, with the reason beside it. An entered
// forecast is the cost module's own figure and stays. A forecast whose source
// was not recorded (a row older than the column) is treated as entered, as
// before; see docs/finance/OCTAPM_COST_POSTING_MODEL.md §1.6.1.
const DEFAULT_FORECAST_WITHHELD =
  "A default forecast is worked from the activity's approved BOQ allocation; it is available only to members who may read the BOQ";
const isDefaultForecast = (value) => Boolean(value && typeof value === "object" && value.forecastSource === "default");

/** A cost record (GET /cost, /cost/summary, and the answer to writing one) as this caller may receive it. */
const withheldCostRecord = (record, access = FULL_ACCESS) => {
  if (access.boq) return record;
  const result = withoutKeys(record, ACTIVITY_BUDGET_KEYS);
  if (!isDefaultForecast(record)) return result;
  return { ...withoutKeys(result, ["forecast"]), forecastWithheld: true, forecastWithheldReason: DEFAULT_FORECAST_WITHHELD };
};

/** GET /projects/:id/cost ({ rows, pagination }) as this caller may receive it. */
const withheldCostRecords = (result, access = FULL_ACCESS) => {
  if (access.boq || !result || typeof result !== "object" || !Array.isArray(result.rows)) return result;
  return { ...result, rows: result.rows.map((record) => withheldCostRecord(record, access)) };
};

/**
 * The cost register's order on sortBy=forecast for a caller who may not read
 * the BOQ (GET /projects/:id/cost). A withheld figure must not be readable
 * from where its row sorts: ordered by the stored forecast in the database, a
 * default row's place among the entered forecasts bounded it, and a member who
 * may edit a forecast of their own bisected it to the cent. So the rows whose
 * forecast this caller is given (entered, or source not recorded) are ordered
 * by it, and the rows whose forecast is withheld (the default ones) tie: they
 * follow, in the order of their ids, whatever the direction — an order no
 * stored figure can move (the report builder does the same over its withheld
 * null). `keys` are { id, forecast, forecastSource }; pure.
 */
const costRecordsByVisibleForecast = (keys = [], sortDir = "asc") => {
  const dir = sortDir === "desc" ? -1 : 1;
  const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  const visible = keys.filter((key) => !isDefaultForecast(key)).sort((a, b) => (Number(a.forecast) - Number(b.forecast)) * dir || byId(a, b) * dir);
  const withheld = keys.filter(isDefaultForecast).sort(byId);
  return [...visible, ...withheld];
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
// A cost record's summary in its history: without the budget, and without a
// default forecast (which is built from it; R5-2) — the summary names its
// forecastSource from 2026-10 on, so an older event's forecast stays as before.
const withoutRecordBudget = (summary) => {
  const result = withoutKeys(summary, ACTIVITY_BUDGET_KEYS);
  return isDefaultForecast(summary) ? withoutKeys(result, ["forecast"]) : result;
};

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

// ─── PC-6: installed quantities in the history ─────────────────────────────
//
// The events of a quantity entry (quantity-progress.service auditSummary;
// progress.service settleBundledEntries and mintTypedQuantityEntry; the daily
// log's sync and retire) record, in their summaries, the entry's BOQ item,
// quantity and unit — and the mint from a typed submission also the typed
// figure and the official installed figure before it. A progress
// submission's events record the installed and planned quantity and their
// unit, the legacy floor carried at a floored approval ({ quantity, … }) and,
// where a mint was skipped, the figures it compared. These are the per-item
// installed quantities the ledger (GET /quantity-progress), the queue, the
// register and the daily log withhold from a member who may not read the
// BOQ, so GET /audit withholds them the same way: the event stays — who,
// when, the transition, the status, the source, the activity, the submission
// and daily-log links, the percentage, the method, the bases and the count
// of entries — without those keys, and `boqWithheld` names them. A skipped
// mint is answered as `{ withheld: true }`: that it was skipped, not why in
// figures. Omitted, never zeroed; the stored events are not changed.
const QUANTITY_ENTRY_EVENT = Object.freeze({
  keys: ["quantity", "unitCode", "boqItemId", "allocationId", "typed", "officialBefore"],
  marked: [],
  reason:
    "The quantity, unit, BOQ item and allocation recorded in a quantity entry's history are available only to members who may read the BOQ",
});
const PROGRESS_SUBMISSION_EVENT = Object.freeze({
  keys: ["quantityInstalled", "quantityPlanned", "quantityUnit", "legacyFloor"],
  marked: ["mintSkipped"],
  reason:
    "The quantity figures recorded in a progress submission's history are available only to members who may read the BOQ",
});

const withheldQuantityEvent = (event, { keys, marked, reason }) => {
  if (!event || typeof event !== "object") return event;
  const withheld = new Set();
  const copy = { ...event };
  for (const part of IPC_EVENT_PARTS) {
    const value = event[part];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const present = keys.filter((key) => has(value, key));
    const replaced = marked.filter((key) => value[key] && typeof value[key] === "object");
    if (!present.length && !replaced.length) continue;
    const next = { ...withoutKeys(value, present) };
    for (const key of replaced) next[key] = { withheld: true };
    copy[part] = next;
    for (const key of [...present, ...replaced]) withheld.add(key);
  }
  if (!withheld.size) return event;
  return { ...copy, boqWithheld: { keys: [...keys, ...marked].filter((key) => withheld.has(key)), reason } };
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
 * Nor are the per-BOQ-item quantities of installed progress (PC-6;
 * withheldQuantityEvent above): a quantity entry's and a progress
 * submission's events stay, without them.
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
      if (type === "quantity_progress_entry") return withheldQuantityEvent(event, QUANTITY_ENTRY_EVENT);
      if (type === "progress_submission") return withheldQuantityEvent(event, PROGRESS_SUBMISSION_EVENT);
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

// The cost record's stored forecast, where it is the DEFAULT (R5-2): built
// from the record's budget, so withheld row by row — only on the rows whose
// forecastSource is 'default' — where the caller may not read the BOQ. The
// report builder treats the column as withheld for filtering and sorting
// (in memory, over the null) on those projects.
const REPORT_DEFAULT_FORECAST_COLUMNS = Object.freeze({
  cost_record: Object.freeze(["forecast"]),
});

/** The columns of a report source withheld on a row whose forecast is the default. */
const reportDefaultForecastColumns = (sourceKey) => REPORT_DEFAULT_FORECAST_COLUMNS[sourceKey] || [];

/** Whether a source row's stored forecast is the default (the raw row, before flattening). */
const rowHasDefaultForecast = (row) => isDefaultForecast(row);

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

// ─── PC-5: the BOQ item and activity detail views ─────────────────────────
//
// GET /boq/items/:itemId/detail is admitted on boq:read, so its reader may
// have every figure: withheldBoqItemDetail hands a BOQ reader the service's
// answer untouched (the same object) and anyone else the row's id only.
//
// GET /activities/:id/detail is admitted on schedule:read. What it says of
// the bill is withheld from a member who may not read the BOQ — cost readers
// included (E1): the mapping section whole (the allocations, the mapped
// quantity, the activity's budget and generated budget, the EV worked from
// them), certification (worked from the allocations), the approval history
// of the allocations, a change order that reaches the activity only through
// an allocation link (its presence says the activity is mapped), and the BOQ
// row a change order's or a PO line's link points at. Omitted, never zeroed:
// the section is { allowed: false, module: "boq", reason }.
//
// A change order's allocation links on this view are filtered to THIS
// activity's allocations, so a link's existence, its count, its quantity and
// its amount are per-activity mapping facts: every kept order loses them
// whole, however else it reaches the activity (an order with activityId = X
// and a link to X's allocation is still listed, without the link). The
// marker is put on every order and on the list, whether or not anything was
// removed, and carries no count — its presence says nothing about a mapping.
const CHANGE_ORDERS_BY_ALLOCATION_WITHHELD =
  "Change orders reached through BOQ allocations are available only to members who may read the BOQ";
const ACTIVITY_HISTORY_BOQ_WITHHELD =
  "BOQ allocation approvals and change orders reached through them are available only to members who may read the BOQ";

// A capped list on the detail views (the first 50 rows, a total, a viewAll
// link) carries every row it was cut from under this key. What is withheld is
// decided over every row, so neither the page nor its total says anything of
// a withheld row beyond the first page. JSON never writes a symbol key (nor
// does normalizeMoneyTree copy one): the full set is never sent to anyone.
const DETAIL_ALL_ROWS = Symbol("controls-detail.allRows");
const allRowsOf = (list, pageKey) => (Array.isArray(list[DETAIL_ALL_ROWS]) ? list[DETAIL_ALL_ROWS] : list[pageKey]);
// The list as sent, without the full set it was cut from.
const pageOf = (list) => {
  const { [DETAIL_ALL_ROWS]: _allRows, ...page } = list;
  return page;
};

const withheldBoqItemDetail = (detail, access = FULL_ACCESS) => {
  if (access.boq || !detail || typeof detail !== "object") return detail;
  return { kind: detail.kind, id: detail.id, withheld: true, reason: MAPPING_DETAILS_WITHHELD };
};

const boqSectionWithheld = (reason = MAPPING_DETAILS_WITHHELD) => ({ allowed: false, module: "boq", reason });

const withheldActivityDetail = (detail, access = FULL_ACCESS) => {
  if (access.boq || !detail || typeof detail !== "object" || !detail.sections) return detail;
  const sections = { ...detail.sections };
  if (has(sections, "mapping")) sections.mapping = boqSectionWithheld();
  if (sections.certification && sections.certification.allowed) sections.certification = boqSectionWithheld(IPC_LINES_WITHHELD);
  // The cost record's default forecast is built from the allocation (R5-2):
  // a dash and the reason, never the figure.
  if (sections.cost && sections.cost.allowed && isDefaultForecast(sections.cost.forecast)) {
    sections.cost = {
      ...sections.cost,
      forecast: { value: null, truth: null, withheld: true, forecastSource: "default", basis: DEFAULT_FORECAST_WITHHELD, derivedFrom: [] },
    };
  }

  const droppedOrderIds = new Set();
  const orders = sections.changes && sections.changes.changeOrders;
  if (orders && Array.isArray(orders.items)) {
    const kept = [];
    for (const order of allRowsOf(orders, "items")) {
      const matchedBy = Array.isArray(order.matchedBy) ? order.matchedBy : [];
      if (matchedBy.length && matchedBy.every((how) => how === "allocation_link")) {
        droppedOrderIds.add(order.id);
        continue;
      }
      kept.push({
        ...withoutKeys(order, ["matchedBy", "allocationLinks"]),
        boqWithheld: { keys: ["allocationLinks"], reason: ALLOCATION_LINK_WITHHELD },
      });
    }
    sections.changes = {
      ...sections.changes,
      changeOrders: {
        ...pageOf(orders),
        // The page refills from beyond the cap as the full set allows.
        items: kept.slice(0, orders.items.length),
        total: Math.max(0, (orders.total || 0) - droppedOrderIds.size),
        boqWithheld: { reason: CHANGE_ORDERS_BY_ALLOCATION_WITHHELD },
      },
    };
  }

  if (sections.procurement && Array.isArray(sections.procurement.poLines)) {
    sections.procurement = {
      ...sections.procurement,
      poLines: sections.procurement.poLines.map((line) => withoutKeys(line, ["boqItemId", "boqItemHref"])),
    };
  }

  if (sections.history && Array.isArray(sections.history.events)) {
    const allEvents = allRowsOf(sections.history, "events");
    const events = allEvents.filter(
      (event) => event.kind !== "allocation_approval" && !(event.kind === "change_order_link" && droppedOrderIds.has(event.recordId)),
    );
    const removed = allEvents.length - events.length;
    sections.history = {
      ...pageOf(sections.history),
      events: events.slice(0, sections.history.events.length),
      total: Math.max(0, (sections.history.total || 0) - removed),
      boqWithheld: { reason: ACTIVITY_HISTORY_BOQ_WITHHELD },
    };
  }
  // PC-6: the progress section's installed quantity is Σ approved quantity
  // entries per BOQ item — the bill's figure; the approved % complete beside
  // it is progress data and stays. The submissions it lists go through the
  // submission rule (their quantity figures out, each bundled entry under
  // the ledger's rule — the list reads the entries whole), and each approved
  // row of the history loses the frozen quantities it was approved with:
  // the same figures the ledger, the queue and the register withhold.
  if (sections.progress && sections.progress.allowed) {
    const progress = { ...sections.progress };
    if (has(progress, "installedQuantity")) progress.installedQuantity = withheldQuantityFigure();
    if (progress.submissions && Array.isArray(progress.submissions.items)) {
      progress.submissions = {
        ...pageOf(progress.submissions),
        items: progress.submissions.items.map((row) => withheldProgressSubmission(row, access)),
      };
    }
    if (progress.approvedHistory && Array.isArray(progress.approvedHistory.items)) {
      progress.approvedHistory = {
        ...pageOf(progress.approvedHistory),
        items: progress.approvedHistory.items.map((row) => withheldApprovedProgress(row, access)),
      };
    }
    sections.progress = progress;
  }
  return { ...detail, sections };
};

// ─── PC-6 (core): quantity progress entries ───────────────────────────────
//
// An entry records how much of a BOQ item was installed on an activity on a
// day (quantity-progress.service). The routes under /quantity-progress are
// admitted on progress:read / progress:submit, so their reader may be unable
// to read the BOQ — and a per-item quantity is BOQ-derived (binding rule,
// PC-6): such a member is told that an entry exists for the activity, its
// status, its date, who recorded it and where it came from (PROGRESS SOURCE
// provenance is progress data), and is given no quantity, no unit, no item
// (id or row) and no allocation. Omitted, never zeroed; `boqWithheld` names
// the keys and why. A BOQ reader's entry is the same object, untouched.
//
// The warnings a write answers with (over-allocation, no approved
// allocation) compare the entry to the allocation in quantities: for such a
// member they keep their code and activity only.
const QUANTITY_ENTRY_WITHHELD =
  "The quantity, unit, BOQ item and allocation of a quantity entry are available only to members who may read the BOQ";
const QUANTITY_ENTRY_BOQ_KEYS = ["quantity", "unitCode", "boqItemId", "boqItem", "allocationId"];
const QUANTITY_WARNING_BOQ_KEYS = ["boqItemId", "allocationQuantity", "approvedQuantity", "entryQuantity", "wouldBe", "message"];

const withheldQuantityEntry = (entry, access = FULL_ACCESS) => {
  if (access.boq || !entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const keys = QUANTITY_ENTRY_BOQ_KEYS.filter((key) => has(entry, key));
  return { ...withoutKeys(entry, keys), boqWithheld: { keys, reason: QUANTITY_ENTRY_WITHHELD } };
};

const withheldQuantityWarning = (warning) => {
  if (!warning || typeof warning !== "object") return warning;
  const keys = QUANTITY_WARNING_BOQ_KEYS.filter((key) => has(warning, key));
  return { ...withoutKeys(warning, keys), boqWithheld: { keys, reason: QUANTITY_ENTRY_WITHHELD } };
};

// A progress submission's quantity figures (quantityComplete — installed, Σ
// the entries it bundles plus the approved ones; quantityPlanned — Σ the
// approved allocations when nothing is typed; the transient `quantity`
// block that says so) are worked from the bill's rows and the mapping, so
// they go to BOQ readers only. The submission's percentage, status, method,
// source, evidence and PROGRESS SOURCE provenance are progress data and stay.
const PROGRESS_SUBMISSION_BOQ_KEYS = ["quantityComplete", "quantityPlanned", "quantityUnit", "quantity"];
const PROGRESS_SUBMISSION_WITHHELD =
  "The quantity figures of a progress submission are available only to members who may read the BOQ";

// The warnings a typed figure below the official installed figure carries
// (QUANTITY_BELOW_OFFICIAL — progress.service, 2026-10-01) compare the typed
// quantity with the official installed one: for a member who may not read
// the BOQ a warning keeps its code (the approver is still told the figure is
// lower) and loses both figures and the sentence that states them.
const PROGRESS_WARNING_BOQ_KEYS = ["officialInstalled", "typed", "message"];
const PROGRESS_WARNING_WITHHELD =
  "The quantities a progress warning compares are available only to members who may read the BOQ";

const withheldProgressWarning = (warning) => {
  if (!warning || typeof warning !== "object" || Array.isArray(warning)) return warning;
  const keys = PROGRESS_WARNING_BOQ_KEYS.filter((key) => has(warning, key));
  if (!keys.length) return warning;
  return { ...withoutKeys(warning, keys), boqWithheld: { keys, reason: PROGRESS_WARNING_WITHHELD } };
};

/** A progress submission (pending, approved or rejected) as this caller may receive it. */
const withheldProgressSubmission = (submission, access = FULL_ACCESS) => {
  if (access.boq || !submission || typeof submission !== "object" || Array.isArray(submission)) return submission;
  const keys = PROGRESS_SUBMISSION_BOQ_KEYS.filter((key) => has(submission, key));
  // The entries it bundles: each under the ledger's rule (no quantity, unit,
  // item or allocation; its id, status, date and provenance stay).
  const entries = Array.isArray(submission.quantityEntries)
    ? { quantityEntries: submission.quantityEntries.map((entry) => withheldQuantityEntry(entry, access)) }
    : {};
  if (Array.isArray(submission.warnings)) entries.warnings = submission.warnings.map(withheldProgressWarning);
  if (!keys.length) return Object.keys(entries).length ? { ...submission, ...entries } : submission;
  return { ...withoutKeys(submission, keys), ...entries, boqWithheld: { keys, reason: PROGRESS_SUBMISSION_WITHHELD } };
};

// An approved progress record (an ActivityProgress row, as the activity
// detail's history lists it) carries the quantities it was approved with —
// installed, planned and their unit, frozen. The same figures as the
// submission's: BOQ readers only. Its percentage, method, source and who
// approved it when are progress data and stay.
const APPROVED_PROGRESS_BOQ_KEYS = ["quantityComplete", "quantityPlanned", "quantityUnit"];
const APPROVED_PROGRESS_WITHHELD =
  "The quantity figures of an approved progress record are available only to members who may read the BOQ";

const withheldApprovedProgress = (row, access = FULL_ACCESS) => {
  if (access.boq || !row || typeof row !== "object" || Array.isArray(row)) return row;
  const keys = APPROVED_PROGRESS_BOQ_KEYS.filter((key) => has(row, key));
  if (!keys.length) return row;
  return { ...withoutKeys(row, keys), boqWithheld: { keys, reason: APPROVED_PROGRESS_WITHHELD } };
};

const withheldProgressSubmissions = (submissions, access = FULL_ACCESS) =>
  access.boq || !Array.isArray(submissions) ? submissions : submissions.map((row) => withheldProgressSubmission(row, access));

/** A list of entries (GET /quantity-progress) as this caller may receive it. */
const withheldQuantityEntries = (entries, access = FULL_ACCESS) =>
  access.boq || !Array.isArray(entries) ? entries : entries.map((entry) => withheldQuantityEntry(entry, access));

/**
 * The answer to writing entries ({ entries, warnings, … }) or to editing one
 * ({ entry, warnings }) as this caller may receive it.
 */
const withheldQuantityEntryResult = (result, access = FULL_ACCESS) => {
  if (access.boq || !result || typeof result !== "object" || Array.isArray(result)) return result;
  const copy = { ...result };
  if (Array.isArray(copy.entries)) copy.entries = withheldQuantityEntries(copy.entries, access);
  if (copy.entry && typeof copy.entry === "object") copy.entry = withheldQuantityEntry(copy.entry, access);
  if (Array.isArray(copy.warnings)) copy.warnings = copy.warnings.map(withheldQuantityWarning);
  return copy;
};

// The daily log's quantities section (PC-6 §4) names a BOQ item per row. A
// reader of the log who may not read the BOQ (the daily log is admitted on
// progress:read) is under the quantity ledger's rule (integration item 4 —
// the same installed-quantity-per-BOQ-item figure was withheld on GET
// /quantity-progress and handed over on GET /daily-logs/{date}, on every
// write answer, on the PDF and in the per-unit totals): the row keeps the
// item's DESCRIPTION and UNIT name (so the member can see what they
// recorded), the activity, the location, the notes, the row's review state
// and the state and PROGRESS SOURCE provenance of the entry it minted (none
// of which is a figure of the bill) — and loses the quantity, the unit code
// it is in, the item's id and code and the allocation, named in
// `boqWithheld`. The section's per-unit totals are per-BOQ-item quantities
// summed and go the same way (withheldDailyLog). Omitted, never zeroed. An
// activity's allocated items (the site's picker) keep id, description and
// unit for everyone who may read progress; the code, the allocation and the
// allocated quantity are for BOQ readers.
const DAILY_LOG_QUANTITY_WITHHELD = "The quantity, unit, BOQ item and allocation of a daily-log quantity are available only to members who may read the BOQ; the item's description and unit name stay";
const DAILY_LOG_QUANTITY_BOQ_KEYS = ["quantity", "unitCode", "boqItemId", "allocationId"];
const DAILY_LOG_QUANTITY_ITEM_KEYS = ["id", "code"];
const DAILY_LOG_TOTALS_WITHHELD = "The section's per-unit quantity totals are available only to members who may read the BOQ";
const ALLOCATED_ITEM_WITHHELD = "The code, allocation and allocated quantity of an activity's BOQ items are available only to members who may read the BOQ";
const ALLOCATED_ITEM_BOQ_KEYS = ["code", "allocationId", "allocationIds", "allocatedQuantity"];

const withheldDailyLogQuantity = (row, access = FULL_ACCESS) => {
  if (access.boq || !row || typeof row !== "object" || Array.isArray(row)) return row;
  const keys = DAILY_LOG_QUANTITY_BOQ_KEYS.filter((key) => has(row, key));
  const copy = withoutKeys(row, keys);
  if (copy.boqItem && typeof copy.boqItem === "object") {
    const itemKeys = DAILY_LOG_QUANTITY_ITEM_KEYS.filter((key) => has(copy.boqItem, key));
    copy.boqItem = withoutKeys(copy.boqItem, itemKeys);
    itemKeys.forEach((key) => keys.push(`boqItem.${key}`));
  }
  return { ...copy, boqWithheld: { keys, reason: DAILY_LOG_QUANTITY_WITHHELD } };
};

/** The section's per-unit totals as this caller may receive them: withheld (never zeroed) for a member who may not read the BOQ. */
const withheldDailyLogTotals = (totals, access = FULL_ACCESS) => {
  if (access.boq || !totals || typeof totals !== "object" || !has(totals, "quantities")) return totals;
  return { ...withoutKeys(totals, ["quantities"]), boqWithheld: { keys: ["quantities"], reason: DAILY_LOG_TOTALS_WITHHELD } };
};

/** The list of days (GET /daily-logs: items with their totals) as this caller may receive it. */
const withheldDailyLogList = (list, access = FULL_ACCESS) => {
  if (access.boq || !list || typeof list !== "object" || !Array.isArray(list.items)) return list;
  return { ...list, items: list.items.map((item) => (item && typeof item === "object" && has(item, "totals") ? { ...item, totals: withheldDailyLogTotals(item.totals, access) } : item)) };
};

/** A daily log (one day, every section) as this caller may receive it. */
const withheldDailyLog = (log, access = FULL_ACCESS) => {
  if (access.boq || !log || typeof log !== "object" || !Array.isArray(log.sections?.quantities)) return log;
  return {
    ...log,
    sections: { ...log.sections, quantities: log.sections.quantities.map((row) => withheldDailyLogQuantity(row, access)) },
    ...(has(log, "totals") ? { totals: withheldDailyLogTotals(log.totals, access) } : {}),
  };
};

/** GET /activities/{id}/allocated-items as this caller may receive it. */
const withheldAllocatedItems = (result, access = FULL_ACCESS) => {
  if (access.boq || !result || typeof result !== "object" || !Array.isArray(result.items)) return result;
  const keys = new Set();
  const items = result.items.map((item) => {
    const present = ALLOCATED_ITEM_BOQ_KEYS.filter((key) => has(item, key));
    present.forEach((key) => keys.add(key));
    return withoutKeys(item, present);
  });
  return { ...result, items, boqWithheld: { keys: [...keys], reason: ALLOCATED_ITEM_WITHHELD } };
};

// ─── The legacy daily report (/daily-reports) ─────────────────────────────
//
// A daily report carries the progress submissions linked to it, serialised
// whole by the progress service — the typed quantity, the planned quantity
// (Σ approved allocations) and its unit included. Every answer of the
// /daily-reports routes (list, get, create, update, submit, approve, reject,
// review) is admitted on a progress permission, so its reader may be unable
// to read the BOQ: each linked submission goes the way of
// GET /activities/{id}/progress-submissions (withheldProgressSubmission) —
// its percentage, method, status and provenance stay, the quantities are
// omitted (never zeroed) and named in `boqWithheld`. The report's own lines
// (manpower, materials delivered, equipment, issues, photos) are site
// records, not figures of the bill, and stay.

/** One daily report as this caller may receive it. */
const withheldDailyReport = (report, access = FULL_ACCESS) => {
  if (access.boq || !report || typeof report !== "object" || !Array.isArray(report.progressSubmissions)) return report;
  return { ...report, progressSubmissions: report.progressSubmissions.map((row) => withheldProgressSubmission(row, access)) };
};

/** A list of daily reports (GET /daily-reports) as this caller may receive it. */
const withheldDailyReports = (reports, access = FULL_ACCESS) =>
  access.boq || !Array.isArray(reports) ? reports : reports.map((report) => withheldDailyReport(report, access));

// ─── PC-6: the quantity views ─────────────────────────────────────────────
//
// Installed, certified, paid, received, issued and committed quantities per
// BOQ item — and per activity, which is those per the activity's items — are
// worked from the bill's rows: a member who may not read the BOQ gets none
// of them (cost, IPC, inventory or commitment read does not unlock a BOQ
// figure). GET /boq/items/:id/quantities is admitted on boq:read, so its
// withholding hands anyone else the row's id only, as the BOQ item detail
// does; GET /activities/:id/quantities is admitted on schedule:read, so a
// non-BOQ reader keeps the activity's identity and its progress section (the
// approved % complete follows progress:read) and gets every figure, the
// comparison and the items as withheld with the reason — a dash, never zero.
const QUANTITY_FIGURES_WITHHELD =
  "Installed, certified, paid, received, issued and committed quantities are worked from the BOQ's rows, available only to members who may read the BOQ";
const QUANTITY_KEYS = ["installed", "certified", "paid", "received", "issued", "committed"];

const withheldQuantityFigure = (reason = QUANTITY_FIGURES_WITHHELD) => ({
  value: null,
  truth: null,
  basis: reason,
  unitCode: null,
  unitMatch: null,
  derivedFrom: [],
  withheld: true,
  notAvailable: { reason },
});

const withheldQuantityFigures = (figures) => {
  const keys = figures && typeof figures === "object" ? Object.keys(figures) : QUANTITY_KEYS;
  return Object.fromEntries((keys.length ? keys : QUANTITY_KEYS).map((key) => [key, withheldQuantityFigure()]));
};

const withheldBoqItemQuantities = (view, access = FULL_ACCESS) => {
  if (access.boq || !view || typeof view !== "object") return view;
  return { kind: view.kind, id: view.id, boqItemId: view.boqItemId ?? view.id, withheld: true, reason: QUANTITY_FIGURES_WITHHELD };
};

const withheldActivityQuantities = (view, access = FULL_ACCESS) => {
  if (access.boq || !view || typeof view !== "object") return view;
  const progress =
    view.progress && view.progress.allowed
      ? // The planned quantity is Σ approved allocations (or the method's
        // configured figure): the bill's. The % complete and method stay.
        { ...view.progress, ...(has(view.progress, "planned") ? { planned: withheldQuantityFigure() } : {}) }
      : view.progress;
  return {
    kind: view.kind,
    id: view.id,
    activityId: view.activityId ?? view.id,
    code: view.code ?? null,
    name: view.name ?? null,
    cutoffDate: view.cutoffDate ?? null,
    asOf: view.asOf ?? null,
    core: view.core ?? null,
    progress,
    figures: withheldQuantityFigures(view.figures),
    comparisons: { withheld: true, reason: QUANTITY_FIGURES_WITHHELD },
    items: { withheld: true, reason: QUANTITY_FIGURES_WITHHELD },
    keys: Array.isArray(view.keys) ? view.keys : QUANTITY_KEYS,
    withheld: true,
    reason: QUANTITY_FIGURES_WITHHELD,
  };
};

module.exports = {
  // PC-6 (core): quantity progress entries.
  QUANTITY_ENTRY_BOQ_KEYS,
  QUANTITY_ENTRY_WITHHELD,
  DAILY_LOG_QUANTITY_WITHHELD,
  DAILY_LOG_TOTALS_WITHHELD,
  ACTIVITY_QUANTITY_WITHHELD,
  ACTIVITY_QUANTITY_FIGURE_KEYS,
  withheldDailyLogTotals,
  withheldDailyLogList,
  ALLOCATED_ITEM_WITHHELD,
  ALLOCATED_ITEM_BOQ_KEYS,
  withheldDailyLogQuantity,
  withheldDailyLog,
  withheldDailyReport,
  withheldDailyReports,
  withheldAllocatedItems,
  withheldQuantityEntry,
  withheldQuantityEntries,
  withheldQuantityEntryResult,
  PROGRESS_SUBMISSION_BOQ_KEYS,
  PROGRESS_SUBMISSION_WITHHELD,
  withheldProgressSubmission,
  withheldProgressSubmissions,
  PROGRESS_WARNING_BOQ_KEYS,
  PROGRESS_WARNING_WITHHELD,
  withheldProgressWarning,
  APPROVED_PROGRESS_BOQ_KEYS,
  APPROVED_PROGRESS_WITHHELD,
  withheldApprovedProgress,
  // PC-6 quantity views
  QUANTITY_FIGURES_WITHHELD,
  withheldQuantityFigure,
  withheldBoqItemQuantities,
  withheldActivityQuantities,
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
  // R5-2: a cost record's default forecast, withheld row by row.
  DEFAULT_FORECAST_WITHHELD,
  REPORT_DEFAULT_FORECAST_COLUMNS,
  reportDefaultForecastColumns,
  rowHasDefaultForecast,
  costRecordsByVisibleForecast,
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
  // PC-5 detail views
  DETAIL_ALL_ROWS,
  withheldActivityDetail,
  withheldBoqItemDetail,
  CHANGE_ORDERS_BY_ALLOCATION_WITHHELD,
  ACTIVITY_HISTORY_BOQ_WITHHELD,
};
