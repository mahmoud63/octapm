/**
 * Procurement as OctaPM records it (AI-7, Procurement): the procurement
 * risks the dashboard flags, purchase orders and suppliers, lead-time
 * alerts, long-lead items and bid leveling. The AI compares and explains;
 * it never awards, orders or changes a status.
 *
 * Each part through its own route's path and permission, failing closed:
 *   risks          the caller's own dashboard procurement-risk queue
 *                  (sources/workspace-snapshot, decided per module)
 *   overview, lead-time alerts, long-lead items   procurement:read (the
 *                  long-lead route has no module gate of its own; the AI
 *                  holds it to procurement:read)
 *   bids           bid:read, listPackages + leveling
 */
const { hasPermission } = require("../../../middleware/rbac");
const { authorizedWorkspaceDashboard } = require("./workspace-snapshot");

const LIST = 10;
const money = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const fact = (line) => `FACT: ${line}`;

const riskLines = async ({ view, projectId }) => {
  const snapshot = await authorizedWorkspaceDashboard(view, { projectId });
  const queue = (snapshot.workflowQueues || []).find((item) => item.key === "procurementRisks");
  if (!queue) return [];
  return [
    fact(`${queue.count} procurement items at risk (dashboard rule: ${queue.description || "long-lead and order-by dates"})`),
    ...(queue.items || []).filter((item) => item.projectId === projectId).map((item) => fact(`At risk (${item.severity}): ${item.title} — ${item.meta || ""}; due ${day(item.dueDate)}`)),
  ];
};

const procurementLines = async ({ view, projectId }) => {
  if (!hasPermission(view, "procurement", "read")) return [];
  const procurementService = require("../../procurement.service");
  const longLeadService = require("../../long-lead.service");
  const orgId = view.user.orgId;
  const [overview, alerts, longLead] = await Promise.all([
    procurementService.getProcurementOverview({ orgId, projectId }),
    procurementService.listLeadTimeAlerts({ orgId, projectId, status: null }),
    longLeadService.listLongLeadItems({ orgId, projectId }),
  ]);
  const orders = overview?.orders || [];
  const suppliers = overview?.suppliers || [];
  const alertRows = Array.isArray(alerts) ? alerts : alerts?.items || [];
  const longLeadRows = Array.isArray(longLead) ? longLead : longLead?.items || [];
  return [
    fact(`${orders.length} purchase orders, ${suppliers.length} suppliers, ${(overview?.packages || []).length} packages, ${alertRows.length} lead-time alerts, ${longLeadRows.length} long-lead items`),
    ...orders.slice(0, LIST).map((order) => fact(`PO ${order.ref || ""} ${order.item || ""} — supplier ${order.supplier || "—"}, status ${order.status}, invoice ${order.invoiceStatus || "—"}, value ${money(order.total ?? order.subtotal)}, required ${day(order.requiredDate || order.requiredBy)}, expected ${day(order.expectedDate || order.expectedDelivery)}`)),
    ...suppliers.slice(0, LIST).map((supplier) => fact(`Supplier ${supplier.name}: status ${supplier.status}${supplier.leadTimeReliability !== null && supplier.leadTimeReliability !== undefined ? `, lead-time reliability ${supplier.leadTimeReliability}` : ""}${supplier.tradeCategories?.length ? `, trades ${supplier.tradeCategories.join("/")}` : ""}`)),
    ...alertRows.slice(0, LIST).map((alert) => fact(`Lead-time alert (${alert.status || "open"}): ${alert.item || alert.title || alert.message || ""} — ${alert.severity || ""} ${alert.message && alert.item ? alert.message : ""}`)),
    ...longLeadRows.slice(0, LIST).map((item) => fact(`Long-lead: ${item.item || item.name || ""} — status ${item.status || "—"}, lead time ${item.leadTimeWeeks ?? item.leadTimeDays ?? "—"}, order by ${day(item.orderByDate || item.orderBy)}, required on site ${day(item.requiredOnSite || item.requiredDate)}`)),
  ];
};

const bidLines = async ({ view, projectId }) => {
  if (!hasPermission(view, "bid", "read")) return [];
  const bidService = require("../../bid.service");
  const scope = { orgId: view.user.orgId, projectId };
  const packages = (await bidService.listPackages({ ...scope, status: null })) || [];
  const lines = [fact(`${packages.length} bid packages`)];
  for (const pkg of packages.slice(0, 3)) {
    const leveling = await bidService.leveling({ ...scope, packageId: pkg.id }).catch(() => null);
    const bidders = leveling?.bidders || [];
    lines.push(fact(`Bid package ${pkg.ref || ""} ${pkg.title || ""} (${pkg.status}): ${bidders.length} bids; estimate ${money(leveling?.estimateTotal)} (leveling: unpriced or excluded lines are plugged with the other bidders' average)`));
    for (const bidder of bidders.slice(0, 6)) lines.push(fact(`Bid from ${bidder.companyName || "bidder"}${bidder.rank ? ` (rank ${bidder.rank})` : ""}: total ${money(bidder.total)}, normalised ${money(bidder.normalizedTotal)}, ${bidder.pluggedLines} plugged lines, lead time ${bidder.leadTimeDays ?? "—"} days, validity ${bidder.validityDays ?? "—"} days, ${bidder.status}${bidder.isAwarded ? ", AWARDED" : bidder.isSoftAward ? ", soft award" : ""}${bidder.exclusions ? `; exclusions: ${String(bidder.exclusions).slice(0, 160)}` : ""}${bidder.inclusions ? `; inclusions: ${String(bidder.inclusions).slice(0, 120)}` : ""}`));
  }
  return lines;
};

const procurementSources = async ({ view, projectId }) => {
  if (!view?.user) return [];
  const [risks, procurement, bids] = await Promise.all([riskLines({ view, projectId }), procurementLines({ view, projectId }), bidLines({ view, projectId })]);
  const lines = [...risks, ...procurement, ...bids];
  if (!lines.length) return [];
  return [{ id: `${projectId}:procurement`, type: "procurement_facts", typeLabel: "Procurement (orders, risks, long-lead, bids)", title: "Procurement", ref: null, status: null, projectId, projectName: null, url: `/projects/${projectId}?module=procurement`, snippet: null, text: lines.join("\n") }];
};

module.exports = { procurementSources };
