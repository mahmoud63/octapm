/**
 * Change management as OctaPM records it (AI-7, Change): change events and
 * change orders with their status, value and stated cost and schedule
 * impact. The AI explains and summarises them, and may draft wording; it
 * never approves, rejects or changes contractual state.
 *
 * Each register is read through its route's own path and permission,
 * failing closed:
 *   change events   change_event:read, listChangeEvents, then the route's
 *                   changeEventAnswerFor (BOQ-derived exceptions withheld)
 *   change orders   change_order:read, listChangeOrders, allocation links
 *                   withheld as GET /change-orders withholds them
 */
const { hasPermission } = require("../../../middleware/rbac");
const { boqFigureAccess, withheldAllocationLinks } = require("../../../utils/boq-figures");

const LIST = 10;
const money = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const day = (value) => (value ? String(value).slice(0, 10) : "—");

const changeOrderParts = async ({ view, projectId }) => {
  if (!hasPermission(view, "change_order", "read")) return null;
  const changeOrderService = require("../../change-order.service");
  const result = await changeOrderService.listChangeOrders({ orgId: view.user.orgId, projectId, query: {} });
  const access = boqFigureAccess(view);
  const orders = (result?.orders || []).map((order) => withheldAllocationLinks(order, access));
  const byStatus = orders.reduce((acc, order) => ({ ...acc, [order.status]: (acc[order.status] || 0) + 1 }), {});
  const open = orders.filter((order) => ["draft", "pending"].includes(order.status));
  const facts = [
    `FACT: ${orders.length} change orders: ${Object.entries(byStatus).map(([status, count]) => `${count} ${status}`).join(", ") || "none"}`,
    ...orders.slice(0, LIST).map((order) => `FACT: Change order ${order.ref || ""} (${order.status}) — ${String(order.description || "").slice(0, 160)}; value ${money(order.value)}; schedule impact ${order.scheduleImpact ?? "—"} days${order.activity ? `; activity ${order.activity.activityCode || ""} ${order.activity.name}` : ""}; submitted ${day(order.submittedDate)}${order.approvedDate ? `, approved ${day(order.approvedDate)}` : ""}`),
  ];
  const records = open.slice(0, LIST).map((order) => ({ id: order.id, type: "change_order", typeLabel: "Change order", title: String(order.description || order.ref || "Change order").slice(0, 160), ref: order.ref || null, status: order.status, projectId, projectName: null, url: `/projects/${projectId}?module=commercial&child=change-orders&recordId=${order.id}`, snippet: null, text: [`Status: ${order.status} (not approved)`, `Value: ${money(order.value)}`, order.costImpactSummary ? `Cost impact: ${order.costImpactSummary}` : null, `Schedule impact: ${order.scheduleImpact ?? "—"} days${order.scheduleImpactSummary ? ` - ${order.scheduleImpactSummary}` : ""}`, order.approvalComment ? `Comment: ${order.approvalComment}` : null].filter(Boolean).join("\n") }));
  return { facts, records };
};

const changeEventParts = async ({ view, projectId }) => {
  if (!hasPermission(view, "change_event", "read")) return null;
  const changeEventService = require("../../change-event.service");
  const exceptionService = require("../../exception.service");
  const answer = await changeEventService.listChangeEvents({ orgId: view.user.orgId, projectId, query: {} });
  const shown = await exceptionService.changeEventAnswerFor({ orgId: view.user.orgId, projectId, access: boqFigureAccess(view), answer });
  const items = shown?.items || [];
  const summary = shown?.summary || {};
  const facts = [
    `FACT: ${summary.count ?? items.length} change events: ${Object.entries(summary.byStatus || {}).filter(([, count]) => count).map(([status, count]) => `${count} ${status}`).join(", ") || "none open"}; ROM total ${money(summary.romTotal)}, quoted ${money(summary.quotedTotal)}, converted ${money(summary.convertedValue)}; open RFQs ${summary.openRfqs ?? 0}, quotes waiting ${summary.quotesWaiting ?? 0}`,
    ...items.slice(0, LIST).map((event) => `FACT: Change event ${event.number || event.ref || ""} ${event.title || ""} (${event.status}, ${event.type || "—"}, origin ${event.origin || "—"}) — ROM ${money(event.romAmount ?? event.romTotal)}, quoted ${money(event.quotedAmount ?? event.quotedTotal)}`),
  ];
  return { facts, records: [] };
};

const changeSources = async ({ view, projectId }) => {
  if (!view?.user) return [];
  const [orders, events] = await Promise.all([changeOrderParts({ view, projectId }), changeEventParts({ view, projectId })]);
  const facts = [...(events?.facts || []), ...(orders?.facts || [])];
  if (!facts.length) return [];
  return [
    { id: `${projectId}:change`, type: "change_facts", typeLabel: "Change management (events and orders)", title: "Change register", ref: null, status: null, projectId, projectName: null, url: `/projects/${projectId}?module=commercial&child=change-orders`, snippet: null, text: ["FACT: Only an approved change order changes the contract; pending and draft ones do not.", ...facts].join("\n") },
    ...(orders?.records || []),
  ];
};

module.exports = { changeSources };
