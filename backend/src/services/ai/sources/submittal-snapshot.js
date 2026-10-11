/**
 * Submittals as OctaPM records them (AI-7, Submittals): the register's
 * status counts and each open submittal's review state, ball in court, due
 * date and response. The AI summarises and may draft a cover note; it never
 * returns a review or changes a status.
 *
 * Read through the register route's own path: submittal:read and
 * listSubmittals with the caller's projectAccess, which applies the party
 * routing rules (a party-scoped person sees only submittals routed to them).
 */
const { hasPermission } = require("../../../middleware/rbac");

const LIST = 15;
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const fact = (line) => `FACT: ${line}`;

const submittalSources = async ({ view, projectId, today = new Date() }) => {
  if (!view?.user || !hasPermission(view, "submittal", "read")) return [];
  const { listSubmittals } = require("../../submittal.service");
  const data = await listSubmittals({ orgId: view.user.orgId, projectId, query: { limit: 100 }, projectAccess: view.projectAccess });
  const rows = data?.rows || [];
  const summary = data?.summary || {};
  const open = rows.filter((row) => ["pending", "under_review", "resubmit"].includes(row.status));
  const overdue = open.filter((row) => row.isOverdue || (row.dueDate && new Date(row.dueDate).getTime() < today.getTime()));
  const name = (user) => user?.name || user?.fullName || null;
  const lines = [
    fact(`Submittals you can see: ${summary.pending ?? 0} pending, ${summary.underReview ?? 0} under review, ${summary.resubmit ?? 0} to resubmit, ${summary.approved ?? 0} approved, ${summary.rejected ?? 0} rejected`),
    fact(`${overdue.length} open submittals are past their due date`),
    ...open.slice(0, LIST).map((row) => fact(`Submittal ${row.ref || ""} ${row.title || ""} — ${row.status}${row.responseCodeLabel ? `, response ${row.responseCodeLabel}` : ""}; due ${day(row.dueDate)}${overdue.includes(row) ? " (OVERDUE)" : ""}; ball in court ${name(row.ballInCourtUser) || "—"}${row.specRef ? `; spec ${row.specRef}` : ""}${row.revision ? `; revision ${row.revision}` : ""}`)),
  ];
  return [
    { id: `${projectId}:submittals`, type: "submittal_facts", typeLabel: "Submittal register", title: "Submittals", ref: null, status: null, projectId, projectName: null, url: `/projects/${projectId}?module=docControl&child=submittals`, snippet: null, text: lines.join("\n") },
    ...overdue.slice(0, 8).map((row) => ({ id: row.id, type: "submittal", typeLabel: "Submittal", title: row.title || row.ref || "Submittal", ref: row.ref || null, status: row.status, projectId, projectName: null, url: `/projects/${projectId}?module=docControl&child=submittals&recordId=${row.id}`, snippet: null, text: `Status ${row.status}, due ${day(row.dueDate)} (overdue), ball in court ${name(row.ballInCourtUser) || "—"}` })),
  ];
};

module.exports = { submittalSources };
