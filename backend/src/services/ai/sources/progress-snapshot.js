/**
 * Progress as OctaPM records it (AI-7, Progress), keeping the three states
 * apart so the AI can never present pending progress as official:
 *   OFFICIAL   each activity's % complete, which only an approval sets;
 *   SUBMITTED  submissions awaiting approval: not official;
 *   APPROVED / REJECTED  the recent decisions.
 * Read through the progress routes' own path: progress:read on the project,
 * listProgressSubmissions, and the BOQ figures withheld as
 * GET /activities/progress-submissions withholds them. Drafts (a person's
 * unsent work) and costs are not read.
 */
const { prisma } = require("../../../config/db");
const { hasPermission } = require("../../../middleware/rbac");
const { boqFigureAccess, withheldProgressSubmissions } = require("../../../utils/boq-figures");
const { APPROVED_PROGRESS, officialPct } = require("./schedule-snapshot");

const LIST = 12;
const RECENT_DAYS = 14;
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "—");
const pct = (value) => (value === null || value === undefined ? "—" : `${Math.round(Number(value))}%`);
const nameOf = (row) => `${row.activity?.p6ActivityId ? `${row.activity.p6ActivityId} ` : ""}${row.activity?.name || "Activity"}`;

const progressSources = async ({ view, projectId, today = new Date() }) => {
  if (!view?.user || !hasPermission(view, "progress", "read")) return [];
  const progressService = require("../../progress.service");
  const [project, activities, submissions] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId }, select: { name: true } }),
    prisma.activity.findMany({ where: { projectId, isActive: true, retiredAt: null }, select: { id: true, physComplete: true, isMilestone: true, ...APPROVED_PROGRESS } }),
    progressService.listProgressSubmissions({ orgId: view.user.orgId, projectId }),
  ]);
  const rows = (withheldProgressSubmissions(submissions, boqFigureAccess(view)) || []).filter((row) => row.status !== "draft");
  const official = new Map(activities.map((activity) => [activity.id, officialPct(activity)]));
  const complete = [...official.values()].filter((value) => value >= 100).length;
  const started = [...official.values()].filter((value) => value > 0 && value < 100).length;
  const pending = rows.filter((row) => row.status === "submitted");
  const since = today.getTime() - RECENT_DAYS * 86_400_000;
  const decided = (status) => rows.filter((row) => row.status === status && row.reviewedAt && new Date(row.reviewedAt).getTime() >= since);
  const approved = decided("approved");
  const rejected = decided("rejected");
  const facts = [
    "FACT: OFFICIAL progress is each activity's approved % complete; SUBMITTED progress is awaiting approval and is NOT official.",
    `FACT: OFFICIAL: ${activities.length} activities: ${complete} complete, ${started} in progress, ${activities.length - complete - started} not started`,
    `FACT: SUBMITTED, awaiting approval (not official): ${pending.length} submission${pending.length === 1 ? "" : "s"}`,
    ...pending.slice(0, LIST).map((row) => `FACT: SUBMITTED (not official): ${nameOf(row)} — ${pct(row.pctComplete)} submitted ${day(row.submittedAt)}; official now ${pct(official.get(row.activityId))}`),
    `FACT: APPROVED in the last ${RECENT_DAYS} days: ${approved.length}; REJECTED: ${rejected.length}`,
    ...approved.slice(0, LIST).map((row) => `FACT: APPROVED (official): ${nameOf(row)} — ${pct(row.pctComplete)} approved ${day(row.reviewedAt)}`),
    ...rejected.slice(0, 6).map((row) => `FACT: REJECTED: ${nameOf(row)} — ${pct(row.pctComplete)} rejected ${day(row.reviewedAt)}${row.rejectionReason ? `: ${String(row.rejectionReason).slice(0, 160)}` : ""}`),
  ];
  return [
    { id: `${projectId}:progress`, type: "progress_facts", typeLabel: "Progress (official and pending)", title: `${project?.name || "Project"} progress`, ref: null, status: null, projectId, projectName: project?.name || null, url: `/projects/${projectId}?module=schedule&child=progress`, snippet: null, text: facts.join("\n") },
    ...pending.slice(0, LIST).map((row) => ({ id: row.id, type: "progress_submission", typeLabel: "Progress submission awaiting approval", title: nameOf(row), ref: null, status: "submitted", projectId, projectName: project?.name || null, url: `/projects/${projectId}?module=schedule&child=progress&recordId=${row.id}`, snippet: null, text: `SUBMITTED, not official: ${pct(row.pctComplete)} on ${day(row.submittedAt)}; official now ${pct(official.get(row.activityId))}${row.notes ? `\nNotes: ${String(row.notes).slice(0, 300)}` : ""}` })),
  ];
};

module.exports = { progressSources };
