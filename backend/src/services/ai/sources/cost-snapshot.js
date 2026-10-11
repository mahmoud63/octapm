/**
 * Cost and finance as OctaPM's own services compute them (AI-7, Cost /
 * Finance). The AI explains these figures; it never computes actual cost,
 * budgets, EAC, commitments or cash flow itself. Each part is read through
 * its route's own path and permission, failing closed:
 *   cost summary   cost:read, getCostSummary + withheldCostSummary
 *   forecast       schedule:read, buildForecast with the forecast route's
 *                  access + withheldForecast
 *   commitments    commitment:read, listCommitments with the route's viewer
 *   cash flow      cost:read, listCashFlow
 */
const { hasPermission, getEffectiveRole } = require("../../../middleware/rbac");
const { boqFigureAccess, exceptionAccess, withheldCostSummary, withheldForecast } = require("../../../utils/boq-figures");

const LIST = 8;
const money = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const fact = (line) => `FACT: ${line}`;
const source = (projectId, key, typeLabel, title, url, lines) => ({ id: `${projectId}:${key}`, type: `${key}_facts`, typeLabel, title, ref: null, status: null, projectId, projectName: null, url, snippet: null, text: lines.join("\n") });

const costSummaryLines = async ({ view, projectId }) => {
  if (!hasPermission(view, "cost", "read")) return null;
  const costService = require("../../cost.service");
  const summary = withheldCostSummary(await costService.getCostSummary({ orgId: view.user.orgId, projectId }), boqFigureAccess(view));
  const totals = summary?.totals || {};
  const budget = summary?.budget || {};
  const eac = summary?.eac || {};
  const records = Array.isArray(summary?.records) ? summary.records : [];
  const overruns = records
    .filter((row) => Number.isFinite(Number(row.actual)) && Number.isFinite(Number(row.budget)))
    .map((row) => ({ row, over: Number(row.actual) - Number(row.budget) }))
    .sort((a, b) => b.over - a.over);
  return [
    fact(`Cost ledger totals across activities: budget ${money(totals.budget)}, committed ${money(totals.committed)}, actual ${money(totals.actual)}, forecast ${money(totals.forecast)}`),
    fact(`Budget register: original ${money(budget.originalBudget)}, approved changes ${money(budget.approvedChanges)}, revisions ${money(budget.revisions)}, revised ${money(budget.revisedBudget)}; allocated to activities ${money(budget.allocatedToActivities)}`),
    fact(`Estimate at completion range: optimistic ${money(eac.optimistic)}, most likely ${money(eac.mostLikely)}, pessimistic ${money(eac.pessimistic)}; to complete ${money(eac.toComplete)}`),
    ...overruns.slice(0, LIST).map(({ row }) => fact(`Activity ${row.activity?.wbsCode ? `${row.activity.wbsCode} ` : ""}${row.activity?.name || "?"}: budget ${money(row.budget)}, committed ${money(row.committed)}, actual ${money(row.actual)} through ${row.actualThroughDate ? String(row.actualThroughDate).slice(0, 10) : "—"}, forecast ${money(row.forecast)} (${row.forecastBasis || row.forecastSource || "—"})`)),
  ];
};

const forecastLines = async ({ view, projectId }) => {
  if (!hasPermission(view, "schedule", "read")) return null;
  const forecastService = require("../../forecast.service");
  const forecast = withheldForecast(await forecastService.buildForecast({ orgId: view.user.orgId, projectId, access: { ...boqFigureAccess(view), ...exceptionAccess(view) } }), boqFigureAccess(view));
  if (!forecast?.available) return null;
  const cost = forecast.cost || {};
  const schedule = forecast.schedule || {};
  return [
    fact(`Forecast (OctaPM's prediction service): cost EAC ${money(cost.eac)} on basis ${cost.eacBasis || "—"}, bottom-up ${money(cost.bottomUp)}, projected overrun ${money(cost.overrun)}${cost.overrunPct !== undefined && cost.overrunPct !== null ? ` (${cost.overrunPct}%)` : ""}; CPI ${schedule.cpi ?? "—"}, SPI ${schedule.spi ?? "—"}`),
    fact(`Forecast schedule: planned finish ${schedule.plannedFinish || "—"}, projected finish ${schedule.projectedFinish || "—"} (${schedule.slipDays ?? "—"} days slip, basis ${schedule.basis || "—"})`),
    ...(cost.topRisks || []).slice(0, 5).map((risk) => fact(`Cost risk ${risk.code ? `${risk.code} ` : ""}${risk.name}: ${risk.level}${risk.cost ? `, budget ${money(risk.cost.budget)}, actual ${money(risk.cost.actual)}, projected ${money(risk.cost.projected)}, overrun ${money(risk.cost.overrun)}` : ""}; ${(risk.reasons || []).slice(0, 2).join("; ")}`)),
  ];
};

const commitmentLines = async ({ view, projectId }) => {
  if (!hasPermission(view, "commitment", "read")) return null;
  const commitmentService = require("../../commitment.service");
  const result = await commitmentService.listCommitments({ orgId: view.user.orgId, projectId, query: {}, viewer: { id: view.user.id, role: getEffectiveRole(view), projectAccess: view.projectAccess } });
  const items = Array.isArray(result) ? result : result?.items || [];
  return [
    fact(`${items.length} commitments (subcontracts and purchase orders) you can see`),
    ...items.slice(0, 12).map((item) => fact(`Commitment ${item.number || item.ref || ""} ${item.title || ""} — ${item.type || ""}, ${item.status || ""}${item.vendorCompany?.name || item.vendorName ? `, vendor ${item.vendorCompany?.name || item.vendorName}` : ""}${item.totals ? `, committed ${money(item.totals.committed ?? item.totals.revisedValue ?? item.totals.originalValue)}` : item.value !== undefined ? `, value ${money(item.value)}` : ""}`)),
  ];
};

const cashFlowLines = async ({ view, projectId }) => {
  if (!hasPermission(view, "cost", "read")) return null;
  const { listCashFlow } = require("../../cash-flow.service");
  const result = await listCashFlow({ orgId: view.user.orgId, projectId });
  const monthly = Array.isArray(result?.monthly) ? result.monthly : [];
  return [
    fact(`Cash flow: inflow ${money(result?.summary?.inflow)}, outflow ${money(result?.summary?.outflow)}, net ${money(result?.summary?.net)}; ${monthly.length} month${monthly.length === 1 ? "" : "s"} recorded`),
    ...monthly.slice(-6).map((month) => fact(`Month ${month.month || month.period || "?"}: inflow ${money(month.inflow)}, outflow ${money(month.outflow)}, net ${money(month.net)}`)),
  ];
};

const build = (parts) => async ({ view, projectId }) => {
  if (!view?.user) return [];
  const out = [];
  for (const part of parts) {
    const lines = await part.read({ view, projectId });
    if (lines?.length) out.push(source(projectId, part.key, part.label, part.label, `/projects/${projectId}?module=${part.module}`, lines));
  }
  return out;
};

const COST = { key: "cost", label: "Cost (OctaPM cost ledger)", module: "cost", read: costSummaryLines };
const FORECAST = { key: "forecast", label: "Forecast (OctaPM prediction)", module: "schedule", read: forecastLines };
const COMMITMENTS = { key: "commitments", label: "Commitments", module: "commercial", read: commitmentLines };
const CASH_FLOW = { key: "cash_flow", label: "Cash flow", module: "commercial", read: cashFlowLines };

module.exports = {
  costSources: build([COST, FORECAST]),
  forecastSources: build([FORECAST, COST]),
  commitmentSources: build([COMMITMENTS, COST]),
  cashFlowSources: build([CASH_FLOW, COST]),
  commercialSources: build([COST, COMMITMENTS, CASH_FLOW]),
};
