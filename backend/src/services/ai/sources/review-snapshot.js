/**
 * Consultant reviews for Ask OctaPM (CONSULTANT V1): the caller's own review
 * queue and one review on their screen, read through the external review
 * engine as the caller — a consultant sees only their party's submissions and
 * never an internal contractor note. The AI summarises, explains and drafts;
 * it never approves, returns, acknowledges, submits or changes a due date.
 */
const { hasPermission } = require("../../../middleware/rbac");

const fact = (line) => `FACT: ${line}`;
const dur = (ms) => {
  if (ms === null || ms === undefined) return "—";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
const day = (value) => (value ? String(value).slice(0, 16).replace("T", " ") + " UTC" : "—");

const reviewSources = async ({ view, projectId }) => {
  if (!view?.user || !hasPermission(view, "external_review", "read")) return [];
  const service = require("../../external-review.service");
  const viewer = service.viewerOf(view);
  const orgId = view.user.orgId;
  const open = await service.list({ orgId, projectId, viewer, query: { status: "open", sort: "priority" } });
  const recent = await service.list({ orgId, projectId, viewer, query: { status: "responded", sort: "newest" } });
  const s = open.summary;
  const lines = [
    fact(`Viewing as the ${viewer.side}${viewer.side === "consultant" ? " (only this consultant party's submissions and those addressed to them)" : ""}.`),
    fact(`Awaiting consultant ${s.awaitingConsultant}; due today ${s.dueToday}; due this week ${s.dueThisWeek}; overdue ${s.overdue}; returned to contractor ${s.returnedToContractor}; responses awaiting acknowledgement ${s.responseReceived}; responded in the last 7 days ${s.respondedThisWeek}; average response ${dur(s.averageResponseMs)}; on time ${s.onTimePct ?? "—"}%${s.oldestOpen ? `; oldest open ${s.oldestOpen.ref} ${dur(s.oldestOpen.openMs)}` : ""}`),
    fact("Open time runs from the formal submission (submittedAt) in calendar time, not contract working days."),
    ...open.items.slice(0, 40).map((row) => fact(`${row.sourceLabel} ${row.sourceRef} "${row.title}" (review ${row.ref}, revision ${row.revision}, cycle ${row.cycle}) — consultant ${row.party.name}, reviewer ${row.responsible.name || "—"}; submitted ${day(row.submittedAt)}; due ${day(row.dueAt)}; ${row.awaitingConsultant ? `open for ${dur(row.openMs)}` : `answered in ${dur(row.responseMs)}`}${row.overdue ? `; OVERDUE by ${dur(row.overdueMs)}` : ""}; status ${row.statusLabel}; action with ${row.actionWith.label}${row.decisionLabel ? `; decision ${row.decisionLabel}` : ""}`)),
    ...recent.items.slice(0, 15).map((row) => fact(`Response: ${row.sourceLabel} ${row.sourceRef} "${row.title}" — ${row.decisionLabel || "—"} by ${row.party.name} on ${day(row.respondedAt)} after ${dur(row.responseMs)}${row.respondedLate ? " (late)" : ""}`)),
  ];
  if (viewer.side === "contractor") {
    const perf = await service.performance({ orgId, projectId, viewer });
    for (const party of perf.byParty) lines.push(fact(`Consultant ${party.label}: open ${party.open}, overdue ${party.overdue}, completed ${party.completed}, returned ${party.returned}, average response ${dur(party.averageResponseMs)}, on time ${party.onTimePct ?? "—"}%`));
  }
  return [{ id: `${projectId}:reviews`, type: "review_facts", typeLabel: "Consultant reviews (OctaPM)", title: "Consultant reviews", ref: null, status: null, projectId, projectName: null, url: `/projects/${projectId}/reviews`, snippet: null, text: lines.join("\n") }];
};

/** One review on the caller's screen: what was issued in each cycle, the responses and the shared correspondence. */
const reviewRecordSource = async ({ view, projectId, recordId }) => {
  if (!view?.user || !hasPermission(view, "external_review", "read")) return null;
  const service = require("../../external-review.service");
  const viewer = service.viewerOf(view);
  const d = await service.detail({ orgId: view.user.orgId, projectId, viewer, id: recordId, markOpened: false }).catch(() => null);
  if (!d) return null;
  const lines = [
    `${d.sourceLabel} ${d.sourceRef} "${d.title}" — review ${d.ref}; consultant ${d.party.name}; responsible reviewer ${d.responsible.name || "—"}; status ${d.statusLabel}; action with ${d.actionWith.label}; revision ${d.revision}, cycle ${d.cycle}; due ${day(d.dueAt)}${d.overdue ? `; OVERDUE by ${dur(d.overdueMs)}` : ""}`,
    ...d.cycles.flatMap((cycle) => [
      `Cycle ${cycle.cycle} (revision ${cycle.revision}): submitted ${day(cycle.submittedAt)} by ${cycle.submittedBy || "—"}, due ${day(cycle.dueAt)}; first opened ${day(cycle.firstOpenedAt)}; ${cycle.respondedAt ? `answered ${day(cycle.respondedAt)} after ${dur(cycle.responseMs)}: ${cycle.decisionLabel}${cycle.responseComment ? ` — "${cycle.responseComment}"` : ""}` : cycle.withdrawnAt ? `withdrawn: ${cycle.withdrawReason}` : `open for ${dur(cycle.openMs)}`}`,
      `  Issued content: ${(cycle.snapshot.fields || []).map((field) => `${field.label}: ${String(field.value).slice(0, 600)}`).join(" | ")}`,
      `  Issued files: ${cycle.issuedFiles.map((file) => file.label).join(", ") || "none"}; response files: ${cycle.responseFiles.map((file) => file.label).join(", ") || "none"}`,
      ...(cycle.coverNote ? [`  Cover note: ${cycle.coverNote}`] : []),
    ]),
    ...d.messages.map((message) => `${message.visibility === "internal" ? "Internal contractor note" : "Correspondence"} (${message.side}, ${message.author || "—"}, ${day(message.at)}): ${message.body}`),
  ];
  return { id: d.id, type: "external_submission", typeLabel: "Review on your screen", module: "reviews", title: `${d.sourceRef} ${d.title}`, ref: d.sourceRef, status: d.status, projectId, projectName: null, url: `/projects/${projectId}/reviews?recordId=${d.id}`, snippet: null, text: lines.join("\n").slice(0, 9000) };
};

module.exports = { reviewSources, reviewRecordSource };
