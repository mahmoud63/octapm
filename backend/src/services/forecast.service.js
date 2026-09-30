const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const aiProvider = require("./ai-provider.service");
const assistant = require("./assistant.service");
const scheduleService = require("./schedule.service");
const evService = require("./earned-value.service");
const budgetService = require("./budget.service");
const { forecastCostWithheld, withheldForecast } = require("../utils/boq-figures");
const { EAC_BASES, EAC_BASIS_LABELS, eacBasisOf, eacIsBudgetFallback } = require("../utils/eac-basis");
const { EV_NOTES, cpiNoteFor, spiNoteFor, cutoffNotReached } = require("../utils/ev-notes");
// Source / derived / projection labels (control model §3) — labels only.
const { TRUTHS, projection, BUDGET_LABELS } = require("../utils/figure-truth");

// What each figure of the forecast's cost block is, and from what. Static
// words, the same for every project and reader: when utils/boq-figures
// withholds a figure its label says nothing about its value.
const FORECAST_COST_TRUTH = Object.freeze({
  budget: TRUTHS.DERIVED,
  bac: TRUTHS.DERIVED,
  actual: TRUTHS.DERIVED,
  eac: projection("eacBasis"),
  bottomUp: projection("activity_projections"),
  projected: projection("greater_of_eac_and_bottom_up"),
  overrun: projection("projected_minus_budget"),
  labels: { budget: BUDGET_LABELS.evBudgetAtCompletion, bac: BUDGET_LABELS.evBudgetAtCompletion },
  derivedFrom: {
    budget: "The earned-value report's budget at completion; Σ activity budgets when there is no report",
    bac: "Approved allocations + approved budget revisions (the earned-value report's totalBudget)",
    actual: "Official actual cost from the earned-value report; Σ activity actual cost when there is none",
    eac: "The earned-value report's EAC: revised budget ÷ CPI, or the revised budget when there is no CPI or CPI is 0 (eacBasis)",
    bottomUp: "Σ each activity's projection (actual ÷ progress, or the greatest of budget, commitments, actual and forecast; cost.basis) or its budget",
    projected: "The greater of the EAC and the bottom-up projection",
    overrun: "Projected cost − budget",
  },
});

/**
 * Schedule delay and cost overrun prediction (OCTA-AI-PREDICT-031).
 *
 * A statistical forecast from the project's own records — no model needed:
 * for every active activity the approved-progress history gives a velocity
 * (% per day) and a projected finish, compared with the planned finish, the
 * float and the critical path; recorded impacts (RFI / submittal schedule
 * links, risk links, weather delays) and open items on the activity (RFIs,
 * submittals, long-lead items) add to the risk; cost is projected from the
 * burn rate against approved progress and from the budget lines. The
 * project finish is the later of the EV-based and the activity-based
 * projection; the cost at completion the higher of EAC and the bottom-up
 * sum. `explain` adds a plain-language narrative with draft actions (a risk
 * on the register, a task) that the person confirms.
 */

const DAY = 86_400_000;
const HISTORY_DAYS = 45;
const STALL_DAYS = 14;
const LATE_START_DAYS = 7;
const LEVELS = Object.freeze(["high", "medium", "low"]);
const ACTION_TYPES = Object.freeze(["create_risk", "create_task", "open"]);
const IMPACT_LABELS = Object.freeze({ rfi: "RFI", submittal: "submittal", change_order: "change order", risk: "risk", weather: "weather" });

const num = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const round = (value, digits = 0) => Math.round(num(value) * 10 ** digits) / 10 ** digits;
const clampPct = (value) => Math.min(100, Math.max(0, num(value)));
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const dateOnly = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const daysBetween = (from, to) => (from && to ? (new Date(to).getTime() - new Date(from).getTime()) / DAY : null);
const later = (a, b) => (!a ? b : !b ? a : new Date(Math.max(new Date(a).getTime(), new Date(b).getTime())));
const levelFor = (score) => (score >= 60 ? "high" : score >= 30 ? "medium" : "low");
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const clip = (value, max) => {
  const text = trimOrNull(value);
  return text ? text.slice(0, max) : null;
};

const safeMany = async (model, args) => {
  try {
    return prisma[model]?.findMany ? await prisma[model].findMany(args) : [];
  } catch {
    return [];
  }
};

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    const id = row[key];
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
};

// ─── Evidence ─────────────────────────────────────────────────────────────

const loadContext = async ({ orgId, projectId, asOf }) => {
  const since = new Date(asOf.getTime() - HISTORY_DAYS * DAY);
  const [history, costs, workflowLinks, weatherLinks, rfis, submittals, longLead] = await Promise.all([
    safeMany("activityProgress", { where: { activity: { projectId, isActive: true }, status: "approved", updatedAt: { gte: since } }, select: { activityId: true, pctComplete: true, approvedAt: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 5000 }),
    safeMany("costRecord", { where: { projectId }, select: { activityId: true, budget: true, committed: true, actual: true, forecast: true } }),
    safeMany("workflowActivityLink", { where: { projectId, scheduleImpactDays: { gt: 0 } }, select: { activityId: true, recordType: true, recordId: true, scheduleImpactDays: true, relationType: true } }),
    safeMany("weatherDelayActivityLink", { where: { projectId, delayDays: { gt: 0 } }, select: { activityId: true, delayDays: true, isCritical: true, weatherDelayId: true } }),
    safeMany("rfi", { where: { projectId, activityId: { not: null }, status: { in: ["open", "answered"] } }, select: { id: true, ref: true, subject: true, activityId: true, responseRequiredBy: true, dueDate: true, status: true } }),
    safeMany("submittal", { where: { projectId, activityId: { not: null }, status: { in: ["pending", "under_review", "resubmit"] } }, select: { id: true, ref: true, title: true, activityId: true, dueDate: true, submitBy: true, status: true } }),
    safeMany("longLeadItem", { where: { projectId, activityId: { not: null }, status: { not: "delivered" } }, select: { id: true, item: true, activityId: true, status: true, expectedDeliveryDate: true, warehouseStatus: true } }),
  ]);
  let ev = null;
  try {
    // The same EV answer the health card and the EV tab read: the latest
    // period, and when that period is locked its stored snapshot — stored
    // SPI, CPI, EAC and the cutoff instant and zone recorded at the lock —
    // never a live recomputation of a locked period.
    ev = await evService.buildOfficialEvReport({ orgId, projectId, useLockedSnapshot: true, includeReadiness: false });
  } catch {
    ev = null;
  }
  let budgetLines = [];
  try {
    budgetLines = (await budgetService.listBudgetLines({ orgId, projectId })).items || [];
  } catch {
    budgetLines = [];
  }
  return {
    history: groupBy(history.map((row) => ({ activityId: row.activityId, pct: clampPct(row.pctComplete), at: new Date(row.approvedAt || row.updatedAt) })), "activityId"),
    costs: new Map(costs.map((row) => [row.activityId, row])),
    impacts: groupBy([...workflowLinks.map((row) => ({ activityId: row.activityId, kind: row.recordType, days: num(row.scheduleImpactDays), recordId: row.recordId })), ...weatherLinks.map((row) => ({ activityId: row.activityId, kind: "weather", days: num(row.delayDays), recordId: row.weatherDelayId }))], "activityId"),
    rfis: groupBy(rfis, "activityId"),
    submittals: groupBy(submittals, "activityId"),
    longLead: groupBy(longLead, "activityId"),
    ev,
    budgetLines,
  };
};

// ─── Per activity ─────────────────────────────────────────────────────────

const blockersFor = (activity, ctx, asOf) => {
  const blockers = [];
  for (const rfi of ctx.rfis.get(activity.id) || []) {
    const due = rfi.responseRequiredBy || rfi.dueDate;
    blockers.push({ type: "rfi", id: rfi.id, ref: rfi.ref, title: rfi.subject, status: rfi.status, due: toIso(due), overdue: Boolean(due) && new Date(due) < asOf });
  }
  for (const submittal of ctx.submittals.get(activity.id) || []) {
    const due = submittal.dueDate || submittal.submitBy;
    blockers.push({ type: "submittal", id: submittal.id, ref: submittal.ref, title: submittal.title, status: submittal.status, due: toIso(due), overdue: Boolean(due) && new Date(due) < asOf });
  }
  for (const item of ctx.longLead.get(activity.id) || []) {
    const needBy = activity.startDate ? new Date(activity.startDate) : null;
    const expected = item.expectedDeliveryDate ? new Date(item.expectedDeliveryDate) : null;
    const lateDelivery = Boolean(needBy && expected && expected > needBy) || Boolean(needBy && !expected && item.status === "not_ordered" && needBy < new Date(asOf.getTime() + 28 * DAY));
    blockers.push({ type: "long_lead", id: item.id, ref: null, title: item.item, status: item.status, due: toIso(expected), overdue: lateDelivery });
  }
  return blockers;
};

const forecastActivity = (activity, ctx, asOf) => {
  const pct = clampPct(activity.pctComplete);
  const complete = pct >= 100;
  const start = activity.startDate ? new Date(activity.startDate) : null;
  const finish = activity.endDate ? new Date(activity.endDate) : null;
  const durationDays = start && finish ? Math.max(1, daysBetween(start, finish)) : Math.max(1, num(activity.duration, 1));
  const elapsedDays = start ? Math.max(0, daysBetween(start, asOf)) : 0;
  const expectedPct = start ? round(Math.min(100, (elapsedDays / durationDays) * 100), 1) : null;
  const gap = expectedPct === null ? 0 : round(expectedPct - pct, 1);

  const rows = ctx.history.get(activity.id) || [];
  const lastProgressAt = rows.length ? rows[rows.length - 1].at : null;
  let velocity = null;
  if (rows.length >= 2) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const days = Math.max(1, daysBetween(first.at, last.at));
    velocity = round((last.pct - first.pct) / days, 2);
  }

  const remaining = Math.max(0, 100 - pct);
  let projectedFinish = finish;
  let basis = complete ? "complete" : "planned";
  if (!complete) {
    if (velocity !== null && velocity > 0) {
      projectedFinish = new Date(asOf.getTime() + (remaining / velocity) * DAY);
      basis = "velocity";
    } else if (start && pct > 0 && elapsedDays > 0) {
      projectedFinish = new Date(asOf.getTime() + remaining * (elapsedDays / pct) * DAY);
      basis = "pace";
    } else if (finish && asOf > finish) {
      projectedFinish = new Date(asOf.getTime() + (remaining / 100) * durationDays * DAY);
      basis = "overdue";
    } else if (start && finish && pct === 0 && asOf > start) {
      projectedFinish = new Date(finish.getTime() + (asOf.getTime() - start.getTime()));
      basis = "late_start";
    }
  }
  const impacts = ctx.impacts.get(activity.id) || [];
  const impactDays = round(impacts.reduce((sum, row) => sum + row.days, 0));
  const slipDays = finish && projectedFinish ? Math.max(0, Math.round(daysBetween(finish, projectedFinish))) : 0;
  const float = activity.totalFloat === null || activity.totalFloat === undefined ? null : num(activity.totalFloat);
  const totalSlip = slipDays + (complete ? 0 : impactDays);
  const floatBreached = !complete && float !== null && totalSlip > float;
  const stalledDays = !complete && pct > 0 && lastProgressAt ? Math.floor(daysBetween(lastProgressAt, asOf)) : 0;
  const stalled = stalledDays > STALL_DAYS;
  const lateStartDays = !complete && pct === 0 && start && asOf > start ? Math.floor(daysBetween(start, asOf)) : 0;
  const blockers = complete ? [] : blockersFor(activity, ctx, asOf);

  const reasons = [];
  let score = 0;
  if (!complete && gap > 0) {
    score += Math.min(35, gap * 0.7);
    reasons.push(`${gap}% behind the plan (${round(pct, 1)}% done, ${expectedPct}% expected by now)`);
  }
  if (slipDays > 0) {
    score += Math.min(25, slipDays * 1.5);
    reasons.push(`Projected to finish ${plural(slipDays, "day")} late at the current ${basis === "velocity" ? "velocity" : basis === "pace" ? "pace" : basis === "late_start" ? "late start" : "state"}`);
  }
  if (impactDays > 0 && !complete) {
    score += Math.min(15, impactDays * 1.5);
    const kinds = [...new Set(impacts.map((row) => IMPACT_LABELS[row.kind] || row.kind))];
    reasons.push(`${plural(impactDays, "day")} of recorded impact from ${kinds.join(", ")}`);
  }
  if (floatBreached) {
    score += 15;
    reasons.push(float <= 0 || activity.isCritical ? "On the critical path — the slip moves the project finish" : `The slip exceeds the ${plural(float, "day")} of float`);
  } else if (activity.isCritical && (gap > 0 || slipDays > 0)) {
    score += 10;
    reasons.push("Critical path");
  }
  if (stalled) {
    score += 10;
    reasons.push(`No approved progress for ${plural(stalledDays, "day")}`);
  }
  if (lateStartDays > LATE_START_DAYS) {
    score += 10;
    reasons.push(`Should have started ${plural(lateStartDays, "day")} ago; nothing recorded yet`);
  }
  if (blockers.length) {
    score += Math.min(15, blockers.reduce((sum, blocker) => sum + (blocker.overdue ? 6 : 3), 0));
    reasons.push(`${plural(blockers.length, "open item")} on it: ${blockers.slice(0, 3).map((blocker) => `${blocker.ref || blocker.title}${blocker.overdue ? " (overdue)" : ""}`).join(", ")}${blockers.length > 3 ? "…" : ""}`);
  }
  score = complete ? 0 : Math.min(100, Math.round(score));

  const cost = ctx.costs.get(activity.id) || null;
  const budget = num(activity.budget) || num(cost?.budget);
  const actual = num(cost?.actual);
  const committed = num(cost?.committed);
  const forecastValue = num(cost?.forecast);
  let projectedCost = null;
  let costBasis = null;
  if (budget > 0) {
    if (pct >= 5 && actual > 0) {
      projectedCost = round(actual / (pct / 100), 2);
      costBasis = "burn";
    } else {
      projectedCost = round(Math.max(budget, committed, actual, forecastValue), 2);
      costBasis = forecastValue > budget ? "forecast" : committed > budget ? "commitments" : "budget";
    }
  }
  const overrun = projectedCost === null ? 0 : Math.max(0, round(projectedCost - budget, 2));
  const overrunPct = budget > 0 ? round((overrun / budget) * 100, 1) : 0;
  const costReasons = [];
  const spentPct = budget > 0 ? round((actual / budget) * 100, 1) : 0;
  if (budget > 0 && actual > 0 && spentPct - pct > 5) costReasons.push(`${spentPct}% of the budget spent at ${round(pct, 1)}% progress`);
  if (committed > budget) costReasons.push(`Commitments of ${round(committed, 2)} exceed the budget of ${round(budget, 2)}`);
  if (forecastValue > budget && costBasis === "forecast") costReasons.push(`Cost forecast ${round(forecastValue, 2)} above the budget`);
  const costLevel = overrunPct > 10 ? "high" : overrunPct > 3 ? "medium" : "low";

  return {
    id: activity.id,
    name: activity.name,
    code: activity.activityCode || activity.p6ActivityId || activity.wbsCode || null,
    isCritical: Boolean(activity.isCritical),
    isMilestone: Boolean(activity.isMilestone),
    status: complete ? "complete" : activity.status || (pct > 0 ? "in_progress" : "todo"),
    pct: round(pct, 1),
    expectedPct,
    gap,
    velocity,
    lastProgressAt: toIso(lastProgressAt),
    plannedStart: dateOnly(start),
    plannedFinish: dateOnly(finish),
    projectedFinish: dateOnly(projectedFinish),
    basis,
    slipDays,
    impactDays,
    float,
    floatBreached,
    stalledDays: stalled ? stalledDays : 0,
    blockers,
    score,
    level: levelFor(score),
    reasons,
    cost: { budget: round(budget, 2), actual: round(actual, 2), committed: round(committed, 2), projected: projectedCost, basis: costBasis, overrun, overrunPct, level: costLevel, reasons: costReasons },
  };
};

// ─── Project level ────────────────────────────────────────────────────────

const budgetLineRisks = (lines) =>
  lines
    .map((line) => {
      const revised = num(line.revised);
      const forecast = num(line.forecast);
      const committed = num(line.committed);
      const actual = num(line.actual);
      const exposure = Math.max(forecast, committed + Math.max(0, actual - committed));
      const overrun = round(exposure - revised, 2);
      return { id: line.id, costCode: line.costCode?.code || null, name: line.costCode?.name || line.description || "Budget line", costType: line.costType || null, revised: round(revised, 2), committed: round(committed, 2), actual: round(actual, 2), forecast: round(forecast, 2), overrun, overrunPct: revised > 0 ? round((overrun / revised) * 100, 1) : null, level: revised > 0 && overrun / revised > 0.1 ? "high" : overrun > 0 ? "medium" : "low" };
    })
    .filter((line) => line.overrun > 0)
    .sort((a, b) => b.overrun - a.overrun)
    .slice(0, 10);

/** The forecast for one project; `asOf` defaults to now. */
const buildForecast = async ({ orgId, projectId, asOf = new Date() }) => {
  const schedule = await scheduleService.getProjectSchedule({ orgId, projectId });
  if (!schedule) return { available: false, reason: "No schedule yet — generate or import one first.", asOf: asOf.toISOString(), activities: [], schedule: null, cost: null, summary: null, dataQuality: [] };
  const ctx = await loadContext({ orgId, projectId, asOf });
  const activities = (schedule.activities || []).filter((activity) => activity.isActive !== false).map((activity) => forecastActivity(activity, ctx, asOf));
  const open = activities.filter((activity) => activity.status !== "complete");

  const plannedFinish = activities.reduce((latest, activity) => later(latest, activity.plannedFinish ? new Date(activity.plannedFinish) : null), null);
  const drivers = open.filter((activity) => activity.isCritical || activity.floatBreached);
  const activityBased = (drivers.length ? drivers : open).reduce((latest, activity) => later(latest, activity.projectedFinish ? new Date(new Date(activity.projectedFinish).getTime() + activity.impactDays * DAY) : null), null);
  const ev = ctx.ev;
  const spi = ev && ev.spi !== null && ev.spi !== undefined ? round(ev.spi, 3) : null;
  const cpi = ev && ev.cpi !== null && ev.cpi !== undefined ? round(ev.cpi, 3) : null;
  let evBased = null;
  if (plannedFinish && spi !== null && spi > 0 && spi < 1) {
    const remainingDays = Math.max(0, daysBetween(asOf, plannedFinish));
    evBased = new Date(asOf.getTime() + (remainingDays / spi) * DAY);
  }
  const projectedFinish = later(evBased, activityBased) || plannedFinish;
  const projectSlip = plannedFinish && projectedFinish ? Math.max(0, Math.round(daysBetween(plannedFinish, projectedFinish))) : 0;
  const criticalDriver = drivers.slice().sort((a, b) => b.slipDays + b.impactDays - (a.slipDays + a.impactDays))[0] || null;

  const bac = ev ? num(ev.totalBudget ?? ev.bac) : 0;
  const totalBudget = bac || activities.reduce((sum, activity) => sum + activity.cost.budget, 0);
  const eac = ev && ev.eac !== null && ev.eac !== undefined ? round(ev.eac, 2) : null;
  const bottomUp = round(activities.reduce((sum, activity) => sum + (activity.cost.projected ?? activity.cost.budget), 0), 2);
  const projectedCost = round(Math.max(eac ?? 0, bottomUp), 2);
  const costOverrun = round(projectedCost - totalBudget, 2);
  const lines = budgetLineRisks(ctx.budgetLines);
  // Which rule gave the EAC (the EV report's, unchanged): revised BAC / CPI
  // when there is cost performance, the revised BAC itself when there is
  // none — said, so no screen presents the budget as a projection.
  const eacBasis = !ev || eac === null ? null : eacBasisOf({ totalBudget: bac, cpi: ev.cpi });
  const earnedValueCutoff = ev && ev.reporting
    ? { cutoffDate: ev.reporting.cutoffDate || null, cutoffLocalDate: ev.reporting.cutoffLocalDate || null, timeZone: ev.reporting.timeZone || null, timeZoneSource: ev.reporting.timeZoneSource || null, timeZoneNote: ev.reporting.timeZoneNote ?? null }
    : null;

  const scheduleRisks = open.filter((activity) => activity.score > 0).sort((a, b) => b.score - a.score || b.slipDays - a.slipDays).slice(0, 15);
  const costRisks = activities.filter((activity) => activity.cost.overrun > 0).sort((a, b) => b.cost.overrun - a.cost.overrun).slice(0, 10);
  const levels = (rows, key) => ({ high: rows.filter((row) => (key ? row[key].level : row.level) === "high").length, medium: rows.filter((row) => (key ? row[key].level : row.level) === "medium").length, low: rows.filter((row) => (key ? row[key].level : row.level) === "low").length });

  const dataQuality = [];
  const undated = open.filter((activity) => !activity.plannedFinish).length;
  if (undated) dataQuality.push(`${plural(undated, "open activity", "open activities")} without planned dates are not projected.`);
  const noHistory = open.filter((activity) => activity.pct > 0 && activity.velocity === null).length;
  if (noHistory) dataQuality.push(`${plural(noHistory, "activity", "activities")} in progress ${noHistory === 1 ? "has" : "have"} fewer than two approved progress updates in the last ${HISTORY_DAYS} days; the pace is estimated from time used.`);
  if (!ev) dataQuality.push("Official earned value could not be computed; the finish and cost projections use activity data only.");
  else {
    // One note per missing index, each with its own cause: SPI is EV / PV
    // and PV is the approved time-phased cost loading; CPI is EV / AC and AC
    // is the official cost-record actuals. Messages only — no figure moves.
    // CPI 0 has two causes: cost spent with nothing earned against a
    // budget, or no approved budget to earn against at all (no_budget).
    const spiNote = spiNoteFor({ spi });
    const cpiNote = cpiNoteFor({ cpi, eacBasis });
    if (spiNote) dataQuality.push(spiNote);
    if (cpiNote) dataQuality.push(cpiNote);
    // The latest period's cutoff still ahead: PV runs to it while EV and AC
    // stop at today, so SPI (and the EV-based finish) compare a future plan
    // with to-date work. Said beside them, never changed.
    if (cutoffNotReached(earnedValueCutoff?.cutoffDate, asOf)) dataQuality.push(EV_NOTES.CUTOFF_NOT_REACHED);
    // The EV report's own sentence when the project has no zone of its own.
    if (earnedValueCutoff?.timeZoneNote) dataQuality.push(earnedValueCutoff.timeZoneNote);
  }
  if (!ctx.budgetLines.length) dataQuality.push("No budget lines by cost code; the cost view uses activity budgets only.");

  return {
    available: true,
    asOf: asOf.toISOString(),
    schedule: {
      plannedFinish: dateOnly(plannedFinish),
      projectedFinish: dateOnly(projectedFinish),
      slipDays: projectSlip,
      basis: evBased && activityBased ? (evBased >= activityBased ? "earned_value" : "activities") : evBased ? "earned_value" : activityBased ? "activities" : "planned",
      evBasedFinish: dateOnly(evBased),
      activityBasedFinish: dateOnly(activityBased),
      spi,
      cpi,
      criticalDriver: criticalDriver ? { id: criticalDriver.id, name: criticalDriver.name, slipDays: criticalDriver.slipDays + criticalDriver.impactDays } : null,
      counts: { activities: activities.length, open: open.length, complete: activities.length - open.length, critical: open.filter((activity) => activity.isCritical).length, atRisk: levels(scheduleRisks) },
      topRisks: scheduleRisks,
    },
    // The earned-value cutoff the SPI, CPI and EAC above were measured
    // through: the end of this calendar date in this time zone.
    earnedValueCutoff,
    cost: {
      budget: round(totalBudget, 2),
      // The revised BAC the EAC was computed from (the EV report's
      // totalBudget: approved allocations plus approved budget revisions).
      bac: ev ? round(bac, 2) : null,
      eac,
      eacBasis,
      bottomUp,
      projected: projectedCost,
      overrun: costOverrun,
      overrunPct: totalBudget > 0 ? round((costOverrun / totalBudget) * 100, 1) : null,
      actual: ev ? round(num(ev.ac), 2) : round(activities.reduce((sum, activity) => sum + activity.cost.actual, 0), 2),
      counts: { atRisk: levels(costRisks, "cost"), lines: lines.length },
      topRisks: costRisks,
      budgetLines: lines,
      truth: FORECAST_COST_TRUTH,
    },
    summary: { scheduleLevel: projectSlip > 14 || scheduleRisks.some((row) => row.level === "high") ? "high" : projectSlip > 0 || scheduleRisks.length ? "medium" : "low", costLevel: totalBudget > 0 && costOverrun / totalBudget > 0.05 ? "high" : costOverrun > 0 ? "medium" : "low" },
    dataQuality,
    activities,
  };
};

// ─── Narrative and actions ────────────────────────────────────────────────

const EXPLAIN_PROMPT = `You are the planning and cost lead's analyst on a construction project. You are given a forecast computed from the project's own records: projected finish versus plan, SPI / CPI, the activities most at risk with the reasons, the cost projection and the budget lines over.
Explain it in plain language for the project manager. Use ONLY the figures given; name activities exactly as given; do not invent causes. Prioritise: what moves the finish date, what moves the cost, what to do this week.
Suggest at most five actions: "create_risk" (put it on the risk register: title, description, probability low|medium|high, impact low|medium|high, mitigation, activityId from the list), "create_task" (a concrete chase: title, description, activityId) or "open" (look at an activity: activityId).
Return ONLY a JSON object:
{"headline": "one sentence", "schedule": "2–4 sentences", "cost": "2–4 sentences", "watch": ["short items to watch"], "actions": [{"type": "create_risk", "label": "…", "activityId": "…", "title": "…", "description": "…", "probability": "high", "impact": "medium", "mitigation": "…"}, {"type": "create_task", "label": "…", "activityId": "…", "title": "…", "description": "…"}, {"type": "open", "label": "…", "activityId": "…"}]}`;

const money = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 }));

/**
 * The cost outlook in words when the EAC is not a projection — the budget
 * handed back (no CPI, or CPI 0), or no approved budget at all; null when
 * it is one (revised BAC ÷ CPI). The basis is the EV report's.
 */
const costOutlook = (c) => {
  if (c.eacBasis === EAC_BASES.NO_BUDGET) {
    return {
      headline: "there is no approved budget yet, so the cost cannot be projected",
      cost: "There is no approved budget to project the cost from: no estimate at completion yet.",
    };
  }
  if (eacIsBudgetFallback(c.eacBasis)) {
    const label = EAC_BASIS_LABELS[c.eacBasis];
    return {
      headline: `the cost outlook is ${label}, not a projection`,
      cost: `The estimate at completion is ${label}: the budget handed back because there is no cost performance to project from, so it says nothing yet about whether the cost will stay within the budget.`,
    };
  }
  return null;
};

// The EAC's rule goes to the model with the figure: a budget handed back is
// never offered to it as a projection "within budget".
const costLines = (c) => [
  `Cost: budget ${money(c.budget)}, EAC ${money(c.eac)} (${EAC_BASIS_LABELS[c.eacBasis] || "no earned-value report"}), bottom-up ${money(c.bottomUp)}, projected ${money(c.projected)} (${c.overrun > 0 ? `${money(c.overrun)} over` : costOutlook(c) ? `not a projection: ${costOutlook(c).headline}; do not call it within budget` : "within budget"}); actual to date ${money(c.actual)}.`,
  "Activities over budget:",
  ...(!Array.isArray(c.topRisks) ? [ACTIVITY_COST_WITHHELD_LINE] : c.topRisks.length ? c.topRisks.slice(0, 6).map((row) => `- [${row.id}] ${row.name} · budget ${money(row.cost.budget)} · actual ${money(row.cost.actual)} · projected ${money(row.cost.projected)} (${money(row.cost.overrun)} over, ${row.cost.overrunPct}%) · ${row.cost.reasons.join("; ") || row.cost.basis}`) : ["- none"]),
  "Budget lines over:",
  ...(c.budgetLines.length ? c.budgetLines.slice(0, 6).map((row) => `- ${row.costCode || ""} ${row.name} · revised ${money(row.revised)} · forecast ${money(row.forecast)} · committed ${money(row.committed)} · ${money(row.overrun)} over`) : ["- none"]),
];

// For a cost reader who may not read the BOQ (E1, utils/boq-figures): the
// project's cost is theirs, but which activities are over budget is read off
// the mapping and is not in their forecast; the model is told not to say.
const ACTIVITY_COST_WITHHELD_LINE =
  "- not available to this reader (mapping details): do not say which activities are over budget or state any activity's budget or cost";
const ACTIVITY_COST_WITHHELD_SENTENCE = "Which activities are over budget is not available to you (mapping details).";

// For a reader whose forecast carries no cost figure (§12, utils/boq-figures):
// the budget lines' names and levels, no amount for the model to repeat, and
// nothing per activity — which activities are over budget, or at which cost
// level, is read off the mapping and is not in this reader's forecast.
const withheldCostLines = (c) => [
  `Cost: the cost figures are not available to this reader; do not state or estimate any cost amount, and do not say which activities are over budget. ${c.counts.lines} budget lines over.`,
  "Budget lines over:",
  ...(c.budgetLines.length ? c.budgetLines.slice(0, 6).map((row) => `- ${row.costCode || ""} ${row.name} · ${row.level}`) : ["- none"]),
];

const forecastBlock = (forecast, projectName) => {
  const s = forecast.schedule;
  const c = forecast.cost;
  const lines = [
    `Project: ${projectName}`,
    `As of: ${forecast.asOf.slice(0, 10)}`,
    "",
    `Schedule: planned finish ${s.plannedFinish || "—"}, projected ${s.projectedFinish || "—"} (${s.slipDays ? `${s.slipDays} days late` : "on time"}, basis ${s.basis}); SPI ${s.spi ?? "—"}, CPI ${s.cpi ?? "—"}; ${s.counts.open} open activities, ${s.counts.critical} critical.`,
    s.criticalDriver ? `Main driver: ${s.criticalDriver.name} (${s.criticalDriver.slipDays} days).` : null,
    "",
    "Activities most at risk:",
    ...(s.topRisks.length ? s.topRisks.slice(0, 8).map((row) => `- [${row.id}] ${row.name}${row.code ? ` (${row.code})` : ""} · score ${row.score} ${row.level} · ${row.pct}% done vs ${row.expectedPct ?? "—"}% expected · velocity ${row.velocity ?? "—"}%/day · planned ${row.plannedFinish || "—"} → projected ${row.projectedFinish || "—"} (${row.slipDays} days${row.impactDays ? ` + ${row.impactDays} impact` : ""}) · float ${row.float ?? "—"}${row.isCritical ? " · critical" : ""}\n  ${row.reasons.join("; ")}`) : ["- none"]),
    "",
    ...(forecastCostWithheld(forecast) ? withheldCostLines(c) : costLines(c)),
    forecast.dataQuality.length ? `\nData notes: ${forecast.dataQuality.join(" ")}` : null,
  ];
  return lines.filter((line) => line !== null).join("\n");
};

const scheduleRiskActions = (top) =>
  top.filter((row) => row.level === "high").slice(0, 2).map((row) => ({ type: "create_risk", label: `Register the risk on ${row.name}`, activityId: row.id, title: `Delay risk: ${row.name}`, description: row.reasons.join("; "), probability: "high", impact: row.isCritical ? "high" : "medium", mitigation: null }));

const deterministicNarrative = (forecast) => {
  const s = forecast.schedule;
  const c = forecast.cost;
  const top = s.topRisks.slice(0, 3);
  if (forecastCostWithheld(forecast)) {
    return {
      headline: s.slipDays ? `The project is projected to finish ${plural(s.slipDays, "day")} late.` : "The project is projected to finish on time.",
      schedule: top.length ? `${top.map((row) => `${row.name}: ${row.reasons[0] || `${row.level} risk`}`).join(". ")}.` : "No activity shows a schedule risk from the records.",
      cost: "The cost figures are not available to you on this project.",
      watch: [...top.map((row) => row.name), ...c.budgetLines.slice(0, 2).map((row) => `${row.costCode || ""} ${row.name}`.trim())].slice(0, 5),
      actions: scheduleRiskActions(top),
    };
  }
  // When nothing projects the cost (the budget handed back, or no budget),
  // the narrative says so — never "within budget", as if a projection had
  // cleared it. An overrun from the bottom-up is a projection and says so.
  const outlook = c.overrun > 0 ? null : costOutlook(c);
  const finish = s.slipDays ? `The project is projected to finish ${plural(s.slipDays, "day")} late` : "The project is projected to finish on time";
  // A cost reader who may not read the BOQ has the project's cost but not
  // which activities are over budget (E1): the narrative says so, never "no
  // activity is over budget".
  const activityRisks = !Array.isArray(c.topRisks) ? ACTIVITY_COST_WITHHELD_SENTENCE : c.topRisks.length ? `${c.topRisks.slice(0, 3).map((row) => `${row.name} projected ${money(row.cost.overrun)} over (${row.cost.reasons[0] || row.cost.basis})`).join("; ")}.` : null;
  return {
    headline: outlook
      ? `${finish}; ${outlook.headline}.`
      : s.slipDays ? `${finish}${c.overrun > 0 ? ` and ${money(c.overrun)} over budget` : ""}.` : c.overrun > 0 ? `The finish holds but the cost is projected ${money(c.overrun)} over budget.` : "The project is projected on time and within budget.",
    schedule: top.length ? `${top.map((row) => `${row.name}: ${row.reasons[0] || `${row.level} risk`}`).join(". ")}.` : "No activity shows a schedule risk from the records.",
    cost: outlook ? [outlook.cost, activityRisks].filter(Boolean).join(" ") : activityRisks || "No activity or budget line is projected over budget.",
    watch: [...top.map((row) => row.name), ...c.budgetLines.slice(0, 2).map((row) => `${row.costCode || ""} ${row.name}`.trim())].slice(0, 5),
    actions: scheduleRiskActions(top),
  };
};

const normalizeActions = (actions, forecast) => {
  const ids = new Set(forecast.activities.map((activity) => activity.id));
  return (Array.isArray(actions) ? actions : [])
    .filter((action) => action && ACTION_TYPES.includes(action.type))
    .map((action) => {
      const activityId = ids.has(action.activityId) ? action.activityId : null;
      const activity = activityId ? forecast.activities.find((row) => row.id === activityId) : null;
      const base = { type: action.type, label: clip(action.label, 120) || (action.type === "create_risk" ? "Add to the risk register" : action.type === "create_task" ? "Create a task" : "Open"), activityId, activityName: activity?.name || null };
      if (action.type === "create_risk") return { ...base, title: clip(action.title, 200) || base.label, description: clip(action.description, 4000) || null, probability: LEVELS.includes(action.probability) ? action.probability : "medium", impact: LEVELS.includes(action.impact) ? action.impact : "medium", mitigation: clip(action.mitigation, 2000) };
      if (action.type === "create_task") return { ...base, title: clip(action.title, 200) || base.label, description: clip(action.description, 4000) || null };
      return activityId ? base : null;
    })
    .filter(Boolean)
    .slice(0, 5);
};

const runMessage = (stored) => (stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null);

/** Plain-language narrative with draft actions; stored on the project as an assistant run. */
const explain = async ({ orgId, projectId, user, transport = null, asOf = new Date(), access }) => {
  // Written from the forecast this caller may receive (§12): a reader of
  // neither the BOQ nor the cost module gives the model no cost figure and
  // gets none back.
  const forecast = withheldForecast(await buildForecast({ orgId, projectId, asOf }), access);
  if (!forecast.available) throw new HttpError(409, "FORECAST_UNAVAILABLE", forecast.reason);
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { name: true } });
  const text = forecastBlock(forecast, project?.name || "Project");
  const fallback = () => ({ ...deterministicNarrative(forecast), actions: normalizeActions(deterministicNarrative(forecast).actions, forecast) });
  if (!aiProvider.isEnabled() && !transport) return { degraded: true, reason: "AI narratives are not configured on this server; this summary was built from the forecast itself.", forecast, narrative: fallback(), message: null };
  let completion;
  try {
    completion = await aiProvider.complete({ system: EXPLAIN_PROMPT, messages: [{ role: "user", content: text }], maxTokens: 1500, temperature: 0.2, transport });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { degraded: true, reason: `${error.message} This summary was built from the forecast itself.`, forecast, narrative: fallback(), message: null };
  }
  const parsed = aiProvider.parseJsonAnswer(completion.text);
  const plain = deterministicNarrative(forecast);
  const narrative = { headline: clip(parsed?.headline, 300) || plain.headline, schedule: clip(parsed?.schedule, 2000) || plain.schedule, cost: clip(parsed?.cost, 2000) || plain.cost, watch: (Array.isArray(parsed?.watch) ? parsed.watch : plain.watch).map((item) => clip(item, 200)).filter(Boolean).slice(0, 6), actions: normalizeActions(parsed?.actions, forecast) };
  const stored = await assistant.storeRun({ orgId, user, projectId, kind: "forecast", recordType: "project", recordId: projectId, title: `Forecast ${forecast.asOf.slice(0, 10)}`, prompt: text, answer: JSON.stringify(narrative), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null, builtWithoutBoq: access?.boq === false }).catch(() => null);
  return { degraded: false, forecast, narrative, message: runMessage(stored) };
};

/** Runs a confirmed action through the record's own service (the route checks the module permission). */
const executeAction = async ({ orgId, user, projectId, action = {}, projectAccess = null }) => {
  const type = trimOrNull(action.type);
  const activityId = trimOrNull(action.activityId);
  if (type === "create_risk") {
    const riskService = require("./risk.service");
    const description = clip(action.description, 4000) || clip(action.title, 200);
    if (!description) throw new HttpError(400, "FORECAST_ACTION_DESCRIPTION", "The risk needs a description");
    const created = await riskService.createRisk({ orgId, projectId, payload: { description: clip(action.title, 200) && description !== clip(action.title, 200) ? `${clip(action.title, 200)}: ${description}` : description, probability: LEVELS.includes(action.probability) ? action.probability : "medium", impact: LEVELS.includes(action.impact) ? action.impact : "medium", mitigation: clip(action.mitigation, 2000), status: "open", ...(activityId ? { activityIds: [activityId] } : {}) }, userId: user.id, userRole: user.role });
    return { type, record: { id: created.id, ref: created.ref, status: created.status }, url: `/projects/${projectId}/schedule/risks?recordId=${created.id}` };
  }
  if (type === "create_task") {
    const taskService = require("./task.service");
    const title = clip(action.title, 200);
    if (!title) throw new HttpError(400, "FORECAST_ACTION_TITLE", "The task needs a title");
    const created = await taskService.createTask({ orgId, projectId, payload: { title, description: clip(action.description, 4000), ...(activityId ? { activityId } : {}) }, userId: user.id, userRole: user.role, projectAccess });
    return { type, record: { id: created.id, ref: created.taskNumber ? `T-${created.taskNumber}` : null, status: created.status }, url: `/tasks?taskId=${created.id}` };
  }
  throw new HttpError(400, "FORECAST_ACTION_UNKNOWN", "Unknown action");
};

module.exports = { ACTION_TYPES, EXPLAIN_PROMPT, HISTORY_DAYS, STALL_DAYS, buildForecast, forecastActivity, budgetLineRisks, explain, executeAction, normalizeActions, deterministicNarrative, forecastBlock };
