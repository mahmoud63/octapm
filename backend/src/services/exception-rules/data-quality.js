/**
 * Data-quality rules of the exception engine (PC-7b, docs/project-controls/
 * OCTAPM_CHANGE_INTELLIGENCE.md §7).
 *
 * The same engine as the overrun kinds (§6): one evaluator, these kinds are
 * `info` / `warning` only and never block anything. Each rule is a pure read
 * — it writes nothing, anywhere — and reads every figure through the service
 * that owns it (the budget register, the earned-value report, the allocation
 * summary, the setup readiness, the quantity views, the cost ledger, the
 * purchase-order register). No rule computes money: a figure is either handed
 * over as its owner built it or compared with another one, and every row says
 * where its two figures came from (measured.basis / limit.basis). Nothing here
 * feeds CostRecord.forecast, BudgetLine.forecast or an EAC, and nothing here
 * changes a record — a row is a signal for a person to review, never a fix.
 *
 * A rule (the engine's contract):
 *
 *   { kind, severity, subjectType, module, boqDerived, label, note, evaluate }
 *
 *   evaluate({ orgId, projectId, cutoff, ctx }) → [{ subjectType, subjectId,
 *     secondarySubjectType?, secondarySubjectId?, measured: { value, unitCode?,
 *     basis }, limit: { value, unitCode?, basis }, groupKeys?, data? }]
 *
 * `module` is the permission module a reader needs (boq, cost, schedule,
 * progress); `boqDerived` withholds the kind WHOLE from a member without
 * boq:read (utils/boq-figures decides; a per-activity figure read off the
 * mapping is BOQ-derived, owner decision E1 — project totals are a cost
 * reader's). A kind that mixes BOQ-derived and other rows is marked
 * BOQ-derived as a whole: withholding too much is safe, leaking is not.
 * `label` and `note(count)` are the words forecast.service shows for open
 * rows of the kind (no figure, so the note never carries money).
 *
 * The thresholds are documented constants per kind (owner rule: no settings
 * column until the owner asks for one). `measured > limit` reads as "worse"
 * for every kind, so the engine's dismissal rule (a dismissed row reopens only
 * when measured moves past the dismissed value in the adverse direction) holds.
 *
 * `ctx` is the engine's per-project context: when it is an object, owner
 * answers read by more than one rule (the readiness, the budget register, the
 * approved allocation totals, the EV report) are read once per evaluation and
 * kept in a WeakMap keyed by it — ctx itself is never written.
 */
const { prisma } = require("../../config/db");
const { addMoney, subtractMoney, toMoneyNumber } = require("../../utils/money");

// ─── thresholds (documented constants, §7) ────────────────────────────────

/** Money compared in cents: the budget register's own tolerance (budget.service.js:26 TOLERANCE). */
const MONEY_TOLERANCE = 0.01;

const DAY_MS = 86_400_000;

// ─── helpers ──────────────────────────────────────────────────────────────

const caches = new WeakMap();
const cacheOf = (ctx) => {
  if (!ctx || typeof ctx !== "object") return new Map();
  if (!caches.has(ctx)) caches.set(ctx, new Map());
  return caches.get(ctx);
};
/** One read per evaluation for an owner answer several rules use. */
const memo = (ctx, key, read) => {
  const cache = cacheOf(ctx);
  if (!cache.has(key)) cache.set(key, Promise.resolve().then(read));
  return cache.get(key);
};

const instantOf = (cutoff) => {
  const at = cutoff ? new Date(cutoff) : new Date();
  return Number.isNaN(at.getTime()) ? new Date() : at;
};
const differs = (a, b) => Math.abs(subtractMoney(toMoneyNumber(a), toMoneyNumber(b))) > MONEY_TOLERANCE;
const codeOf = (activity) => activity?.activityCode || activity?.p6ActivityId || activity?.wbsCode || null;
const activityLabel = (activity) => [codeOf(activity), activity?.name].filter(Boolean).join(" ") || null;
const groupKeysOf = (record) => {
  const keys = {};
  if (record?.wbsNodeId) keys.wbsNodeId = record.wbsNodeId;
  if (record?.locationId) keys.locationId = record.locationId;
  if (record?.costCodeId) keys.costCodeId = record.costCodeId;
  return Object.keys(keys).length ? keys : undefined;
};
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// ─── owner answers shared between rules ───────────────────────────────────

// budget.service.js:257 listBudgetLines — the register; summary.totals from summarize (:214).
const budgetRegister = (ctx, { orgId, projectId }) =>
  memo(ctx, "budgetRegister", () => require("../budget.service").listBudgetLines({ orgId, projectId }));

// activity-boq-allocation.service.js getApprovedActivityAllocationTotals — the
// approved allocation per activity, the budget every read shows for it
// (cost.service.js:194 attachApprovedBudgets, schedule.service.js:2924).
const approvedAllocations = (ctx, { projectId }) =>
  memo(ctx, "approvedAllocations", () => require("../activity-boq-allocation.service").getApprovedActivityAllocationTotals({ projectId }));

// ─── budget_truths_disagree ───────────────────────────────────────────────
// Evidence: budget.service.js:257 listBudgetLines (summary.totals.revisedBudget,
// the register's revised total), earned-value.service.js:696
// buildOfficialEvReport (totalBudget = approved allocations + approved budget
// revisions in force at the cutoff, :847) and budget-revision.service.js:40
// listBudgetRevisions (summary.currentBudget = contract value + approved
// revisions, the waterfall's end, :53). Three screens state a project budget;
// a row per pair that differs by more than a cent.

const TRUTH_BASES = Object.freeze({
  register: "Budget register revised total: Σ active budget lines' original + approved changes (budget.service listBudgetLines summary.totals.revisedBudget)",
  evBac: "Budget at completion (EV basis) at the cutoff: approved BOQ allocations + approved budget revisions in force (earned-value.service buildOfficialEvReport totalBudget)",
  contract: "Contract-value waterfall: the project's contract value + approved budget revisions (budget-revision.service listBudgetRevisions summary.currentBudget)",
});
const TRUTH_PAIRS = Object.freeze([
  ["register", "evBac", "register_vs_ev_bac"],
  ["register", "contract", "register_vs_contract_waterfall"],
  ["evBac", "contract", "ev_bac_vs_contract_waterfall"],
]);

const budgetTruths = async ({ orgId, projectId, cutoff, ctx }) => {
  const at = instantOf(cutoff);
  const [register, report, waterfall, project] = await Promise.all([
    budgetRegister(ctx, { orgId, projectId }),
    require("../earned-value.service")
      .buildOfficialEvReport({ orgId, projectId, cutoffDate: at.toISOString(), useLockedSnapshot: false, includeReadiness: false })
      .catch(() => null),
    require("../budget-revision.service").listBudgetRevisions({ orgId, projectId }),
    prisma.project.findFirst({ where: { id: projectId, orgId }, select: { contractValue: true } }),
  ]);
  // A truth exists only where its owner has something to state: a register
  // with no line, a report that could not be built and a project with no
  // contract value are absent, not 0.
  const truths = {};
  if (register.items.length) truths.register = toMoneyNumber(register.summary.totals.revisedBudget);
  if (report) truths.evBac = toMoneyNumber(report.totalBudget);
  if (project && toMoneyNumber(project.contractValue) > 0) truths.contract = toMoneyNumber(waterfall.summary.currentBudget);
  const cutoffNote = report?.reporting?.cutoffLocalDate ? ` (cutoff ${report.reporting.cutoffLocalDate})` : "";
  return TRUTH_PAIRS.filter(([a, b]) => a in truths && b in truths && differs(truths[a], truths[b])).map(([a, b, pair]) => ({
    subjectType: "project",
    subjectId: projectId,
    secondarySubjectType: "budget_truth_pair",
    secondarySubjectId: pair,
    measured: { value: truths[a], basis: `${TRUTH_BASES[a]}${a === "evBac" ? cutoffNote : ""}` },
    limit: { value: truths[b], basis: `${TRUTH_BASES[b]}${b === "evBac" ? cutoffNote : ""}` },
    data: { pair, tolerance: MONEY_TOLERANCE, truths: Object.keys(truths) },
  }));
};

// ─── forecast_without_provenance ──────────────────────────────────────────
// Evidence: utils/cost-forecast.js:32 FORECAST_BASIS and :130
// projectedFinalCost (owner decision R5-2). A cost record's stored forecast
// whose source was never recorded (forecastSource NULL — "Stored forecast (its
// source was not recorded)") is counted as entered though nobody can say it
// was; a DEFAULT (max(budget, actual) when it was set, :76 defaultForecast)
// that the actual has since passed is a placeholder below what the activity
// already cost. Read from CostRecord as stored; the "default now" beside a
// NULL-source figure is the owner's own defaultForecast over the approved
// allocation (the budget every cost read shows, cost.service.js:194) and the
// actual. A NULL-source record whose stored forecast is 0 states no forecast
// (projectedFinalCost ignores it) and is not reported.

const forecastProvenance = async ({ orgId, projectId, ctx }) => {
  const { defaultForecast, FORECAST_SOURCES } = require("../../utils/cost-forecast");
  const [records, allocations] = await Promise.all([
    prisma.costRecord.findMany({
      where: { projectId, project: { orgId }, activity: { isActive: true } },
      select: { id: true, activityId: true, forecast: true, forecastSource: true, actual: true, activity: { select: { name: true, activityCode: true, p6ActivityId: true, wbsCode: true, wbsNodeId: true, locationId: true } } },
      orderBy: { id: "asc" },
    }),
    approvedAllocations(ctx, { projectId }),
  ]);
  const rows = [];
  for (const record of records) {
    const forecast = toMoneyNumber(record.forecast);
    const actual = toMoneyNumber(record.actual);
    const base = { subjectType: "cost_record", subjectId: record.id, groupKeys: groupKeysOf(record.activity) };
    if (record.forecastSource !== FORECAST_SOURCES.ENTERED && record.forecastSource !== FORECAST_SOURCES.DEFAULT) {
      if (!(forecast > 0)) continue;
      const budget = allocations.get(record.activityId)?.amount || 0;
      rows.push({
        ...base,
        measured: { value: forecast, basis: "CostRecord.forecast as stored; its source was not recorded (forecastSource NULL — utils/cost-forecast FORECAST_BASIS.notRecorded): entered or an older default, unknown" },
        limit: { value: defaultForecast({ budget, actual }), basis: "What the R5-2 default would be now: max(0, approved allocation, actual) (utils/cost-forecast defaultForecast over activity-boq-allocation getApprovedActivityAllocationTotals and CostRecord.actual)" },
        data: { reason: "source_not_recorded", activityId: record.activityId, label: activityLabel(record.activity) },
      });
    } else if (record.forecastSource === FORECAST_SOURCES.DEFAULT && differs(actual, forecast) && actual > forecast) {
      rows.push({
        ...base,
        measured: { value: actual, basis: "CostRecord.actual: the cost ledger's projection on the record (cost-ledger.service post)" },
        limit: { value: forecast, basis: "CostRecord.forecast, a DEFAULT (forecastSource 'default': max(budget, actual) as they stood when it was set, utils/cost-forecast FORECAST_BASIS.default); nobody entered a forecast" },
        data: { reason: "default_below_actual", activityId: record.activityId, label: activityLabel(record.activity) },
      });
    }
  }
  return rows;
};

// ─── activity_budget_mismatch ─────────────────────────────────────────────
// Evidence: schedule.service.js:2924 and cost.service.js:209 — every read
// shows an activity's budget as its approved allocation and the stored
// Activity.budget / CostRecord.budget beside it as `generatedBudget`. Where the
// stored figure differs from the approved allocations
// (activity-boq-allocation getApprovedActivityAllocationTotals) the two
// columns disagree. Per activity, so BOQ-derived (E1).

const activityBudgets = async ({ orgId, projectId, ctx }) => {
  const [activities, allocations] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId, project: { orgId }, isActive: true },
      select: { id: true, name: true, activityCode: true, p6ActivityId: true, wbsCode: true, wbsNodeId: true, locationId: true, budget: true, costRecords: { where: { projectId }, select: { id: true, budget: true } } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    approvedAllocations(ctx, { projectId }),
  ]);
  const rows = [];
  for (const activity of activities) {
    const allocated = allocations.get(activity.id)?.amount || 0;
    const stored = toMoneyNumber(activity.budget);
    const record = activity.costRecords[0] || null;
    const recordBudget = record ? toMoneyNumber(record.budget) : null;
    const recordDiffers = record !== null && differs(recordBudget, allocated);
    const activityDiffers = differs(stored, allocated);
    if (!recordDiffers && !activityDiffers) continue;
    const field = recordDiffers ? "cost_record.budget" : "activity.budget";
    rows.push({
      subjectType: "activity",
      subjectId: activity.id,
      measured: {
        value: recordDiffers ? recordBudget : stored,
        basis: recordDiffers
          ? "CostRecord.budget as stored (shown as generatedBudget beside the approved allocation, cost.service attachApprovedBudgets)"
          : "Activity.budget as stored (shown as generatedBudget beside the approved allocation, schedule.service)",
      },
      limit: { value: allocated, basis: "Σ approved, active BOQ allocations to the activity (activity-boq-allocation.service getApprovedActivityAllocationTotals) — the budget every read shows" },
      groupKeys: groupKeysOf(activity),
      data: { field, activityBudget: stored, costRecordBudget: recordBudget, approvedAllocation: allocated, label: activityLabel(activity) },
    });
  }
  return rows;
};

// ─── committed_definition_mixed ───────────────────────────────────────────
// Evidence: purchase-order.service.js:346-350 — the purchase-order register's
// summary still answers `committed`, a deprecated alias of orderValue ("Order
// value — not committed cost"), beside the budget register's committed cost
// (budget.service.js:134 deriveLine: executed commitments, or the manual
// figure while nothing is committed). Two figures named "committed" on one
// project that differ.

const committedDefinitions = async ({ orgId, projectId, ctx }) => {
  const [orders, register] = await Promise.all([
    require("../purchase-order.service").listOrders({ orgId, projectId }),
    budgetRegister(ctx, { orgId, projectId }),
  ]);
  if (!orders.items.length || !Object.prototype.hasOwnProperty.call(orders.summary, "committed")) return [];
  const poCommitted = toMoneyNumber(orders.summary.committed);
  const registerCommitted = toMoneyNumber(register.summary.totals.committed);
  if (!differs(poCommitted, registerCommitted)) return [];
  return [{
    subjectType: "project",
    subjectId: projectId,
    measured: { value: poCommitted, basis: "Purchase-order summary `committed`: a deprecated alias of orderValue — the value of orders neither planned nor cancelled, NOT committed cost (purchase-order.service listOrders)" },
    limit: { value: registerCommitted, basis: "Budget register committed: executed commitments + approved commitment change orders, or the manual figure while nothing is committed (budget.service listBudgetLines summary.totals.committed)" },
    data: { orders: orders.items.length, field: "summary.committed", alias: "orderValue" },
  }];
};

// ─── equipment_cost_unposted ──────────────────────────────────────────────
// Evidence: cost-ledger.service.js:32 SOURCE_TYPES lists 'equipment'; its
// poster is equipment.service.js:255 postEquipmentCostImpact (sourceType
// 'equipment', sourceId = the daily report, :278), called when a daily report
// is approved. §7 recorded the source without a poster; the poster now
// exists, so the gap left is usage that carries cost with no (or less) ledger
// posting for its report — usage written before the ledger, or a posting
// reversed. Per daily report: Σ ActivityEquipmentUsage.costAmount against the
// net Σ CostLedgerEntry.amount of source 'equipment' for that report.

const equipmentUnposted = async ({ orgId, projectId }) => {
  const [usage, ledger] = await Promise.all([
    prisma.activityEquipmentUsage.findMany({
      where: { projectId, project: { orgId }, costAmount: { gt: 0 } },
      select: { dailyReportId: true, activityId: true, costAmount: true },
    }),
    prisma.costLedgerEntry.findMany({
      where: { orgId, projectId, sourceType: "equipment" },
      select: { sourceId: true, amount: true },
    }),
  ]);
  const posted = new Map();
  for (const entry of ledger) posted.set(entry.sourceId, addMoney(posted.get(entry.sourceId) || 0, entry.amount));
  const byReport = new Map();
  for (const row of usage) {
    const key = row.dailyReportId || null;
    const bucket = byReport.get(key) || { cost: 0, rows: 0, activityIds: new Set() };
    bucket.cost = addMoney(bucket.cost, row.costAmount);
    bucket.rows += 1;
    if (row.activityId) bucket.activityIds.add(row.activityId);
    byReport.set(key, bucket);
  }
  const rows = [];
  for (const [reportId, bucket] of [...byReport.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    const net = reportId ? posted.get(reportId) || 0 : 0;
    if (!(bucket.cost > net) || !differs(bucket.cost, net)) continue;
    rows.push({
      subjectType: reportId ? "daily_report" : "project",
      subjectId: reportId || projectId,
      ...(reportId ? {} : { secondarySubjectType: "equipment_usage", secondarySubjectId: "without_daily_report" }),
      measured: { value: bucket.cost, basis: "Σ ActivityEquipmentUsage.costAmount recorded for the daily report (equipment.service postDailyReportEquipmentUsage)" },
      limit: { value: net, basis: "Net Σ CostLedgerEntry.amount of source 'equipment' for the daily report (cost-ledger.service post, called by equipment.service postEquipmentCostImpact)" },
      data: { usageRows: bucket.rows, activityIds: [...bucket.activityIds].sort() },
    });
  }
  return rows;
};

// ─── the rules ────────────────────────────────────────────────────────────

const RULES = [
  {
    kind: "budget_truths_disagree",
    severity: "warning",
    subjectType: "project",
    module: "cost",
    boqDerived: false,
    label: "Budget figures",
    note: (count) => `The budget register, the earned-value budget at completion and the contract-value waterfall do not agree (${plural(count, "pair")} differ${count === 1 ? "s" : ""}).`,
    evaluate: budgetTruths,
  },
  {
    kind: "forecast_without_provenance",
    severity: "info",
    subjectType: "cost_record",
    module: "cost",
    // The NULL-source comparison is the default over the approved
    // allocation, and a default forecast is withheld from a member without
    // boq:read (utils/boq-figures isDefaultForecast): BOQ-derived.
    boqDerived: true,
    label: "Cost forecasts",
    note: (count) => `${plural(count, "cost record")} carr${count === 1 ? "ies" : "y"} a forecast nobody is known to have entered (source not recorded, or a default the actual cost has passed).`,
    evaluate: forecastProvenance,
  },
  {
    kind: "activity_budget_mismatch",
    severity: "info",
    subjectType: "activity",
    module: "cost",
    boqDerived: true,
    label: "Activity budgets",
    note: (count) => `${plural(count, "activity", "activities")} carr${count === 1 ? "ies" : "y"} a stored budget that differs from the approved allocations.`,
    evaluate: activityBudgets,
  },
  {
    kind: "committed_definition_mixed",
    severity: "info",
    subjectType: "project",
    module: "cost",
    boqDerived: false,
    label: "Committed cost",
    note: () => "The purchase-order register's `committed` (order value) differs from the budget register's committed cost; they are different figures.",
    evaluate: committedDefinitions,
  },
  {
    kind: "equipment_cost_unposted",
    severity: "warning",
    subjectType: "daily_report",
    module: "cost",
    boqDerived: false,
    label: "Equipment cost",
    note: (count) => `${plural(count, "daily report")} carr${count === 1 ? "ies" : "y"} equipment usage cost that the cost ledger has not posted.`,
    evaluate: equipmentUnposted,
  },
];

const DATA_QUALITY_KINDS = Object.freeze(RULES.map((rule) => rule.kind));

module.exports = RULES;
// Non-index properties: an array consumer (exception-rules/index.js) sees the rules only.
Object.defineProperty(module.exports, "DATA_QUALITY_KINDS", { value: DATA_QUALITY_KINDS, enumerable: false });
Object.defineProperty(module.exports, "THRESHOLDS", { value: Object.freeze({ MONEY_TOLERANCE, DAY_MS }), enumerable: false });
