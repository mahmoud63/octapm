/**
 * Closeout / Turnover for Ask OctaPM: the closeout overview as the caller
 * reads it — milestones, the readiness checks for the modules they may read,
 * the turnover deliverables (a party sees only its own) and warranties. The
 * AI explains what blocks handover; it never records a milestone, accepts a
 * deliverable or waives anything.
 */
const { hasPermission } = require("../../../middleware/rbac");

const fact = (line) => `FACT: ${line}`;
const day = (value) => (value ? String(value).slice(0, 10) : "—");

const closeoutSources = async ({ view, projectId }) => {
  if (!view?.user || !hasPermission(view, "closeout", "read")) return [];
  const service = require("../../project-closeout.service");
  const viewer = service.viewerOf(view);
  const orgId = view.user.orgId;
  const overview = await service.overview({ orgId, projectId, viewer });
  const { items } = await service.listDeliverables({ orgId, projectId, viewer });
  const d = overview.deliverables;
  const lines = [
    fact(`Closeout status: ${overview.status.replace(/_/g, " ")}`),
    ...overview.milestones.map((m) => fact(`Milestone ${m.label}: ${m.at ? `recorded ${day(m.at)} by ${m.by || "—"}${m.note ? ` (${m.note})` : ""}` : "not recorded"}`)),
    ...overview.readiness.checks.map((c) => fact(`Readiness check ${c.label}: ${c.status}${c.visible ? ` — ${c.detail}${c.refs?.length ? ` (${c.refs.join(", ")})` : ""}` : ""}${c.waiver ? `; waived: ${c.waiver.reason}` : ""}`)),
    fact(`Turnover deliverables: ${d.total} (${d.required} required, ${d.requiredSettled} of them settled = ${d.settledPct}%); by status ${Object.entries(d.byStatus).map(([status, count]) => `${status.replace("_", " ")} ${count}`).join(", ")}; overdue ${d.overdue}`),
    ...items.map((row) => fact(`Deliverable ${row.ref} ${row.title} (${row.categoryLabel}${row.required ? "" : ", optional"}): ${row.status.replace("_", " ")}; responsible ${row.responsibleCompany || row.responsibleUser || "not assigned"}; due ${day(row.dueDate)}${row.overdue ? " (overdue)" : ""}; evidence ${row.documents.length} file(s)${row.reviewComment ? `; review comment: ${row.reviewComment}` : ""}${row.waivedReason ? `; reason: ${row.waivedReason}` : ""}${row.warranty ? `; warranty ${day(row.warrantyStart)} to ${day(row.warrantyEnd)} (${row.warranty.state.replace("_", " ")})` : ""}`)),
    fact(`Warranties: ${overview.warranties.total} (active ${overview.warranties.active}, expiring within ${overview.warranties.expiringDays} days ${overview.warranties.expiring}, expired ${overview.warranties.expired}, not started ${overview.warranties.notStarted})`),
    ...(overview.gates ? Object.entries(overview.gates).filter(([key]) => key !== "substantial_completion").map(([key, gate]) => fact(`Gate ${key.replace("_", " ")}: ${gate.recorded ? "recorded" : gate.ready ? "ready to record" : `blocked by ${gate.outstanding.length}: ${gate.outstanding.slice(0, 60).join("; ")}${gate.outstanding.length > 60 ? `; and ${gate.outstanding.length - 60} more` : ""}`}`)) : []),
    ...(overview.readiness.note ? [fact(overview.readiness.note)] : []),
  ];
  return [{ id: `${projectId}:closeout`, type: "closeout_facts", typeLabel: "Closeout / Turnover (OctaPM)", title: "Closeout / Turnover", ref: null, status: overview.status, projectId, projectName: null, url: `/projects/${projectId}/closeout`, snippet: null, text: lines.join("\n") }];
};

module.exports = { closeoutSources };
