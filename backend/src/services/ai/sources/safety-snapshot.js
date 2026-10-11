/**
 * Safety as OctaPM records it (AI-7, Safety): incidents by type, status and
 * month, open incidents with their owner and due date, lost days, and the
 * investigation notes. The AI summarises and drafts a briefing; it never
 * closes an incident or changes a status.
 *
 * Read through the safety route's own path: safety:read and
 * listSafetyIncidents, failing closed.
 */
const { hasPermission } = require("../../../middleware/rbac");

const LIST = 12;
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const fact = (line) => `FACT: ${line}`;

const safetySources = async ({ view, projectId }) => {
  if (!view?.user || !hasPermission(view, "safety", "read")) return [];
  const { listSafetyIncidents } = require("../../safety.service");
  const data = await listSafetyIncidents({ orgId: view.user.orgId, projectId, query: {} });
  const rows = data?.rows || [];
  const summary = data?.summary || {};
  const open = rows.filter((row) => !["closed", "archived"].includes(row.status));
  const byType = rows.reduce((acc, row) => ({ ...acc, [row.incidentType]: (acc[row.incidentType] || 0) + 1 }), {});
  const byMonth = rows.reduce((acc, row) => {
    const month = day(row.date).slice(0, 7);
    return { ...acc, [month]: (acc[month] || 0) + 1 };
  }, {});
  const lostDays = rows.reduce((sum, row) => sum + (Number(row.lostDays) || 0), 0);
  const lines = [
    fact(`${rows.length} safety incidents recorded: ${summary.open ?? 0} open, ${summary.investigating ?? 0} investigating, ${summary.submitted ?? 0} awaiting close-out approval, ${summary.closed ?? 0} closed`),
    fact(`By type: ${Object.entries(byType).map(([type, count]) => `${count} ${type.replace(/_/g, " ")}`).join(", ") || "none"}; ${lostDays} lost days in all`),
    fact(`By month: ${Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => `${month}: ${count}`).join(", ") || "none"}`),
    ...open.slice(0, LIST).map((row) => fact(`Open incident ${row.ref} ${row.title} — ${row.incidentType.replace(/_/g, " ")}${row.severity ? `, ${row.severity}` : ""}, ${row.status}, on ${day(row.date)}; responsible ${row.responsible || row.owner || "—"}; due ${day(row.dueDate)}${row.lostDays ? `; ${row.lostDays} lost days` : ""}${row.investigation ? `; investigation: ${String(row.investigation).slice(0, 200)}` : ""}`)),
  ];
  return [{ id: `${projectId}:safety`, type: "safety_facts", typeLabel: "Safety incidents", title: "Safety", ref: null, status: null, projectId, projectName: null, url: `/projects/${projectId}?module=quality&child=safety`, snippet: null, text: lines.join("\n") }];
};

module.exports = { safetySources };
