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

// ─── structure and units: the setup readiness's own checks ────────────────
// Evidence: project-setup-readiness.service.js getSetupReadiness — the PC-4
// structure step (structureWarnings :1187 NO_WBS / NO_LOCATIONS /
// NO_PROJECT_COST_CODES / UOM_UNRESOLVED, structureAdvisories :1281
// BOQ_ITEMS_WITHOUT_WBS / ACTIVITIES_WITHOUT_WBS / BOQ_ITEMS_WITHOUT_COST_CODE),
// the BOQ step (boqAdvisories :1307 BOQ_UNIT_UNRESOLVED) and the allocation
// step (allocationAdvisories :1490 UNIT_MISMATCH_COUNT: a quantity-measured
// activity whose progress unit is not its allocated BOQ row's). The rules do
// not recompute any of it: each check the owner raises becomes one row, its
// count (the owner's uncapped `count`) the measured figure, its named records
// (the owner's capped list) the row's data. Read with the owner's full view
// (canReadBoq) — the BOQ-derived kinds are withheld whole by the reader's
// access, never by the engine.

const readiness = (ctx, { orgId, projectId }) =>
  memo(ctx, "readiness", () => require("../project-setup-readiness.service").getSetupReadiness({ orgId, projectId }));

/** code → the issue as the readiness raised it (blockers, warnings and advisories of every step). */
const readinessIssues = async (ctx, scope) => {
  const answer = await readiness(ctx, scope);
  const issues = new Map();
  for (const step of answer.steps || []) {
    for (const list of [step.blockers, step.warnings, step.advisories]) {
      for (const issue of list || []) if (issue?.code && !issues.has(issue.code)) issues.set(issue.code, { ...issue, stepKey: step.key });
    }
  }
  return issues;
};

const READINESS_BASIS = "Setup readiness check (project-setup-readiness.service getSetupReadiness)";
const issueItems = (issue) => (issue.items || []).map((item) => ({ type: item.type, id: item.id, code: item.code ?? null, label: item.label ?? null, missing: item.missing ?? null }));

/** One row per raised check: measured = what the check counts (1 for "none exists"), limit 0. */
const readinessRows = (issues, checks, { projectId }) =>
  checks
    .filter(({ code }) => issues.has(code))
    .map(({ code, absence, counts }) => {
      const issue = issues.get(code);
      return {
        subjectType: "project",
        subjectId: projectId,
        secondarySubjectType: "readiness_check",
        secondarySubjectId: code,
        measured: { value: absence ? 1 : Number(issue.count) || 0, basis: `${READINESS_BASIS} ${code}: ${absence ? "1 = none exists" : counts}` },
        limit: { value: 0, basis: absence ? `${code}: at least one is expected (0 = present)` : `${code}: none expected` },
        data: { check: code, step: issue.stepKey, message: issue.message, severity: issue.severity, itemCount: Number(issue.count) || 0, items: issueItems(issue) },
      };
    });

// structure_missing — items/activities without WBS, location or cost code.
const STRUCTURE_CHECKS = Object.freeze([
  { code: "NO_WBS", absence: true },
  { code: "NO_LOCATIONS", absence: true },
  { code: "NO_PROJECT_COST_CODES", absence: true },
  { code: "BOQ_ITEMS_WITHOUT_WBS", counts: "BOQ rows not filed under an active WBS node" },
  { code: "ACTIVITIES_WITHOUT_WBS", counts: "active activities not filed under an active WBS node" },
  { code: "BOQ_ITEMS_WITHOUT_COST_CODE", counts: "BOQ rows without a cost code" },
]);
const structureMissing = async ({ orgId, projectId, ctx }) => readinessRows(await readinessIssues(ctx, { orgId, projectId }), STRUCTURE_CHECKS, { projectId });

// unit_unresolved — BOQ units not in the organisation's unit list.
const unitUnresolved = async ({ orgId, projectId, ctx }) => {
  const issues = await readinessIssues(ctx, { orgId, projectId });
  const rows = readinessRows(issues, [{ code: "BOQ_UNIT_UNRESOLVED", counts: "BOQ rows whose unit spelling the organisation's unit list does not resolve" }], { projectId });
  const spellings = issues.get("UOM_UNRESOLVED");
  for (const row of rows) {
    row.data.units = spellings ? issueItems(spellings).map((item) => ({ unit: item.code, label: item.label })) : [];
    row.data.unitCount = spellings ? Number(spellings.count) || 0 : 0;
  }
  return rows;
};

// unit_mismatch — allocation ↔ progress method (the readiness check above)
// and BOQ row ↔ the quantities recorded against it in another unit: the
// quantity views (quantity-views.service.js quantityBlocks; each figure's
// unitMatch, perUnitFigure :212) say when the approved quantity entries
// (installed) or the commitment SOV lines (committed) are in a unit other
// than the row's. Received / issued are inventory units, never converted to
// the BOQ unit by design (quantity-views BASIS), and are not compared.
const UNIT_COMPARED_FIGURES = Object.freeze(["installed", "committed"]);
const figureMismatches = (key, figure) => {
  if (!figure) return [];
  if (figure.unitMatch === false) return [{ figure: key, unitCode: figure.unitCode }];
  if (Array.isArray(figure.byUnit)) return figure.byUnit.filter((entry) => entry.unitMatch === false).map((entry) => ({ figure: key, unitCode: entry.unitCode }));
  return [];
};

const unitMismatch = async ({ orgId, projectId, cutoff, ctx }) => {
  const issues = await readinessIssues(ctx, { orgId, projectId });
  const rows = readinessRows(issues, [{ code: "UNIT_MISMATCH_COUNT", counts: "approved/pending allocations whose quantity-measured activity uses another unit than the BOQ row" }], { projectId });
  const items = await prisma.boqItem.findMany({
    where: { projectId, project: { orgId }, isActive: true },
    select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true, wbsNodeId: true, locationId: true, costCodeId: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  if (!items.length) return rows;
  const { blocks } = await require("../quantity-views.service").quantityBlocks({ orgId, projectId, items, cutoffDate: instantOf(cutoff) });
  for (const item of items) {
    const block = blocks.get(item.id);
    if (!block) continue;
    const columns = UNIT_COMPARED_FIGURES.flatMap((key) => figureMismatches(key, block.figures[key]));
    if (!columns.length) continue;
    rows.push({
      subjectType: "boq_item",
      subjectId: item.id,
      measured: { value: columns.length, unitCode: block.unitCode || null, basis: "Quantity columns recorded against the BOQ row in another unit: approved quantity entries (installed) and commitment SOV lines (committed) whose unitMatch is false (quantity-views.service quantityBlocks)" },
      limit: { value: 0, unitCode: block.unitCode || null, basis: "Every quantity in the BOQ row's own unit (BoqItem.unitCode, or its spelling resolved through the organisation's unit list)" },
      groupKeys: groupKeysOf(item),
      data: { columns, itemUnit: block.unitCode || null, label: [item.code || item.ref, item.description].filter(Boolean).join(" ") || null },
    });
  }
  return rows;
};

// ─── progress and reporting ───────────────────────────────────────────────

/** A rule that reads by projectId alone first proves the project is this organisation's. */
const assertProject = (ctx, { orgId, projectId }) =>
  memo(ctx, `project:${orgId}`, async () => {
    const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
    if (!project) {
      const { HttpError } = require("../../utils/http-error");
      throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    return project;
  });

// progress_stale — no approved progress in N days on an active activity.
// Evidence: earned-value.service.js:150 progressEffectiveDate and :153
// selectApprovedProgressForCutoff — the official progress of an activity is
// its latest APPROVED ActivityProgress at or before the cutoff, dated by
// approvedAt (updatedAt for a legacy row without one). EV reads
// ActivityProgress only, so the same rows and the same rule are read here.
// "Active" = begun (latest approved progress above 0 %, or an actual start
// recorded) and not complete; a milestone has no duration to progress over.
// A planned start that passed with nothing recorded is a schedule risk the
// forecast reports (late start), not a data gap, and is not counted here.
// N is the forecast's own stall threshold (forecast.service.js STALL_DAYS).
const PROGRESS_STALE_DAYS = 14;

const progressStale = async ({ orgId, projectId, cutoff }) => {
  const at = instantOf(cutoff);
  const activities = await prisma.activity.findMany({
    where: { projectId, project: { orgId }, isActive: true, isMilestone: false },
    select: {
      id: true, name: true, activityCode: true, p6ActivityId: true, wbsCode: true, wbsNodeId: true, locationId: true,
      progress: { where: { status: "approved" }, select: { id: true, status: true, pctComplete: true, approvedAt: true, updatedAt: true, actualStart: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const rows = [];
  for (const activity of activities) {
    // selectApprovedProgressForCutoff, the same filter and order.
    const candidates = activity.progress
      .filter((row) => (row.approvedAt ? row.approvedAt <= at : row.updatedAt && row.updatedAt <= at))
      .sort((a, b) => new Date(b.approvedAt || b.updatedAt || 0).getTime() - new Date(a.approvedAt || a.updatedAt || 0).getTime());
    const latest = candidates[0];
    if (!latest) continue;
    const pct = Number(latest.pctComplete) || 0;
    const begun = pct > 0 || candidates.some((row) => row.actualStart);
    if (!begun || pct >= 100) continue;
    const since = latest.approvedAt || latest.updatedAt;
    const days = Math.floor((at.getTime() - new Date(since).getTime()) / DAY_MS);
    if (!(days > PROGRESS_STALE_DAYS)) continue;
    rows.push({
      subjectType: "activity",
      subjectId: activity.id,
      measured: { value: days, unitCode: "day", basis: "Whole days from the activity's latest approved progress (ActivityProgress approvedAt, updatedAt for a legacy row; the earned-value report's own selection, earned-value.service selectApprovedProgressForCutoff) to the cutoff" },
      limit: { value: PROGRESS_STALE_DAYS, unitCode: "day", basis: "Stale after 14 days without approved progress on a begun, incomplete activity (the forecast's stall threshold, forecast.service STALL_DAYS)" },
      groupKeys: groupKeysOf(activity),
      data: { lastApprovedAt: new Date(since).toISOString(), legacyDate: !latest.approvedAt, pctComplete: pct, progressId: latest.id, label: activityLabel(activity) },
    });
  }
  return rows;
};

// period_not_locked — a reporting cutoff passed with no EvPeriodSnapshot.
// Evidence: earned-value.service.js:1034 listReportingPeriods (each period's
// cutoff instant as the reports cut it, its status and its snapshot) and
// :1681 lockReportingPeriod (the only writer of a period's snapshot). An open
// period whose cutoff passed has no measured history point (the S-curve
// history is the locked snapshots only, EV_HISTORY_NOTE). A grace of 7 days
// after the cutoff is allowed for the period's review before it is reported.
const PERIOD_LOCK_GRACE_DAYS = 7;

const periodNotLocked = async ({ orgId, projectId, cutoff }) => {
  const at = instantOf(cutoff);
  const { periods } = await require("../earned-value.service").listReportingPeriods({ orgId, projectId });
  const rows = [];
  for (const period of periods) {
    if (period.status === "locked" && period.snapshot) continue;
    if (!period.cutoffDate) continue;
    const days = Math.floor((at.getTime() - new Date(period.cutoffDate).getTime()) / DAY_MS);
    if (!(days > PERIOD_LOCK_GRACE_DAYS)) continue;
    rows.push({
      subjectType: "reporting_period",
      subjectId: period.id,
      measured: { value: days, unitCode: "day", basis: "Whole days since the period's cutoff instant as the EV reports cut it (earned-value.service listReportingPeriods), with no locked EvPeriodSnapshot" },
      limit: { value: PERIOD_LOCK_GRACE_DAYS, unitCode: "day", basis: "A period is expected to be locked (earned-value.service lockReportingPeriod) within 7 days of its cutoff" },
      data: { code: period.code, status: period.status, cutoffDate: period.cutoffDate, cutoffLocalDate: period.cutoffLocalDate || null, lockedWithoutSnapshot: period.status === "locked", label: period.label || period.code },
    });
  }
  return rows;
};

// ev_basis_divergence — official EV (cutoff) vs summary EV (latest).
// Evidence: earned-value.service.js:696 buildOfficialEvReport (`ev`: approved
// allocations × the latest approved progress AT THE CUTOFF, the default
// period every EV screen reads — a locked period answers with its snapshot)
// against activity-boq-allocation.service.js:767 buildAllocationSummary
// (`earnedValue`: approved allocations × the latest approved progress, no
// cutoff, :851-857) shown on the mapping coverage. Two earned values on one
// project that differ by more than a cent.
const evBasisDivergence = async ({ orgId, projectId, ctx }) => {
  await assertProject(ctx, { orgId, projectId });
  const [report, summary] = await Promise.all([
    require("../earned-value.service").buildOfficialEvReport({ orgId, projectId, useLockedSnapshot: true, includeReadiness: false }).catch(() => null),
    require("../activity-boq-allocation.service").buildAllocationSummary({ projectId }),
  ]);
  if (!report) return [];
  const official = toMoneyNumber(report.ev);
  const latest = toMoneyNumber(summary.earnedValue);
  if (!differs(latest, official)) return [];
  const reporting = report.reporting || {};
  return [{
    subjectType: "project",
    subjectId: projectId,
    measured: { value: latest, basis: "Summary EV on the mapping coverage: Σ approved allocation × the latest approved progress, no cutoff (activity-boq-allocation.service buildAllocationSummary earnedValue)" },
    limit: { value: official, basis: `Official EV at the reporting cutoff${reporting.cutoffLocalDate ? ` ${reporting.cutoffLocalDate}` : ""}${reporting.isSnapshot ? " (the locked period's snapshot)" : ""} (earned-value.service buildOfficialEvReport ev)` },
    data: { cutoffDate: reporting.cutoffDate || null, period: reporting.period?.code || null, isSnapshot: Boolean(reporting.isSnapshot) },
  }];
};

// readiness_override_active — a PM override on the reporting gate still in
// force. Evidence: earned-value.service.js:1642 resolveReportingReadinessOverride
// and :1729-1741 (lockReportingPeriod stores readinessOverride in the
// snapshot's basisJson and audits it, :1807); the gate is
// project-setup-readiness.service getSetupReadiness gates.reporting (what
// getOfficialReportingGate freezes). Active = the latest locked period was
// locked over an override and the gate is still not ready today. The row
// carries the blockers' codes only — never their details or amounts.
const readinessOverrideActive = async ({ orgId, projectId, ctx }) => {
  const [snapshot, answer] = await Promise.all([
    prisma.evPeriodSnapshot.findFirst({
      where: { projectId, reportingPeriod: { projectId, status: "locked", project: { orgId } } },
      orderBy: [{ cutoffDate: "desc" }, { lockedAt: "desc" }, { id: "desc" }],
      select: { id: true, cutoffDate: true, lockedAt: true, basisJson: true, reportingPeriod: { select: { id: true, code: true, label: true } } },
    }),
    readiness(ctx, { orgId, projectId }),
  ]);
  const override = snapshot?.basisJson?.readinessOverride || null;
  const gate = answer?.gates?.reporting;
  if (!snapshot || !override || !gate || gate.ready) return [];
  const codes = (gate.blockers || []).map((blocker) => blocker.code).filter(Boolean);
  return [{
    subjectType: "reporting_period",
    subjectId: snapshot.reportingPeriod.id,
    measured: { value: codes.length, basis: "Blockers on the official reporting gate today (project-setup-readiness.service getSetupReadiness gates.reporting)" },
    limit: { value: 0, basis: "A gate overridden at the lock (EvPeriodSnapshot.basisJson.readinessOverride, earned-value.service lockReportingPeriod) is expected to be cleared afterwards" },
    data: { code: snapshot.reportingPeriod.code, overriddenAt: override.overriddenAt || null, overriddenByRole: override.actorRole || null, blockerCodes: codes, label: snapshot.reportingPeriod.label || snapshot.reportingPeriod.code },
  }];
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
  {
    kind: "unit_unresolved",
    severity: "warning",
    subjectType: "project",
    module: "boq",
    boqDerived: true,
    label: "Units",
    note: () => "BOQ rows carry unit spellings the organisation's unit list does not recognise.",
    evaluate: unitUnresolved,
  },
  {
    kind: "unit_mismatch",
    severity: "info",
    subjectType: "boq_item",
    module: "boq",
    boqDerived: true,
    label: "Units",
    note: (count) => `${plural(count, "unit mismatch", "unit mismatches")} between BOQ rows, their allocations' progress methods and the quantities recorded against them.`,
    evaluate: unitMismatch,
  },
  {
    kind: "structure_missing",
    severity: "info",
    subjectType: "project",
    module: "boq",
    // BOQ rows not filed (a BOQ-derived count) sit beside activities and the
    // structure's own absence in this kind: withheld whole.
    boqDerived: true,
    label: "Structure",
    note: (count) => `${plural(count, "structure check")} open: records not filed under a WBS node or cost code, or no WBS, locations or project cost codes yet.`,
    evaluate: structureMissing,
  },
  {
    kind: "progress_stale",
    severity: "warning",
    subjectType: "activity",
    module: "progress",
    boqDerived: false,
    label: "Progress",
    note: (count) => `${plural(count, "activity", "activities")} in progress ${count === 1 ? "has" : "have"} had no approved progress for more than two weeks.`,
    evaluate: progressStale,
  },
  {
    kind: "period_not_locked",
    severity: "warning",
    subjectType: "reporting_period",
    module: "cost",
    boqDerived: false,
    label: "Reporting periods",
    note: (count) => `${plural(count, "reporting period")} passed ${count === 1 ? "its" : "their"} cutoff more than a week ago and ${count === 1 ? "is" : "are"} not locked.`,
    evaluate: periodNotLocked,
  },
  {
    kind: "ev_basis_divergence",
    severity: "info",
    subjectType: "project",
    module: "cost",
    // The summary EV is the mapping coverage's (a BOQ endpoint's) figure.
    boqDerived: true,
    label: "Earned value",
    note: () => "The official earned value at the reporting cutoff and the mapping summary's latest earned value differ.",
    evaluate: evBasisDivergence,
  },
  {
    kind: "readiness_override_active",
    severity: "warning",
    subjectType: "reporting_period",
    module: "cost",
    // The gate's blockers include the bill's coverage checks.
    boqDerived: true,
    label: "Reporting readiness",
    note: () => "The last period was locked over a PM override of the reporting gate, and the gate is still not ready.",
    evaluate: readinessOverrideActive,
  },
];

const DATA_QUALITY_KINDS = Object.freeze(RULES.map((rule) => rule.kind));

module.exports = RULES;
// Non-index properties: an array consumer (exception-rules/index.js) sees the rules only.
Object.defineProperty(module.exports, "DATA_QUALITY_KINDS", { value: DATA_QUALITY_KINDS, enumerable: false });
Object.defineProperty(module.exports, "THRESHOLDS", { value: Object.freeze({ MONEY_TOLERANCE, DAY_MS, PROGRESS_STALE_DAYS, PERIOD_LOCK_GRACE_DAYS }), enumerable: false });
