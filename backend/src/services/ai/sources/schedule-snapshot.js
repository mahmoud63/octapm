/**
 * The schedule as OctaPM's CPM engine left it (AI-7, Schedule): critical
 * activities, delayed activities and the tightest float, read from the
 * results cpm.service stored on each activity. The AI explains these; it
 * never computes the critical path, float or dates itself.
 *
 * Read only for a caller who may read the schedule on the project (the
 * schedule routes' own permission), failing closed. Activity budgets are not
 * read at all.
 */
const { prisma } = require("../../../config/db");
const { hasPermission } = require("../../../middleware/rbac");

const LIST = 12;
const DAY = 86_400_000;

// An activity's official % complete, as the product reads it
// (schedule-export.service): its latest APPROVED progress submission, else
// the stored figure. Submitted progress never counts.
const APPROVED_PROGRESS = { progress: { where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 1, select: { pctComplete: true } } };
const officialPct = (activity) => {
  const approved = Array.isArray(activity.progress) ? activity.progress[0] : null;
  return Math.min(100, Math.max(0, Number(approved?.pctComplete ?? activity.physComplete ?? 0)));
};
const withOfficial = (activity) => ({ ...activity, physComplete: officialPct(activity) });
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "—");
const pct = (value) => `${Math.round(Number(value || 0))}%`;

const activityLine = (activity) =>
  `${activity.activityCode ? `${activity.activityCode} ` : ""}${activity.name}: ${day(activity.startDate)} to ${day(activity.endDate)}, ${pct(activity.physComplete)} complete, total float ${activity.totalFloat ?? "—"}${activity.isCritical ? ", critical" : ""}`;

/**
 * Numbered sources ([n] from `after + 1`): the schedule facts, then each
 * critical or delayed activity as a linked record. `view` is the caller as
 * the project's routes see them (requestForProject). Empty when they may
 * not read the schedule.
 */
const scheduleSources = async ({ view, projectId, today = new Date() }) => {
  if (!view?.user || !hasPermission(view, "schedule", "read")) return [];
  const [project, rows] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId }, select: { name: true, dataDate: true } }),
    prisma.activity.findMany({
      where: { projectId, isActive: true, retiredAt: null },
      select: { id: true, name: true, activityCode: true, startDate: true, endDate: true, physComplete: true, totalFloat: true, isCritical: true, isMilestone: true, duration: true, remainingDuration: true, predecessors: true, ...APPROVED_PROGRESS },
      orderBy: [{ startDate: "asc" }, { sortOrder: "asc" }],
      take: 3000,
    }),
  ]);
  const activities = rows.map(withOfficial);
  if (!activities.length) return [];
  const open = activities.filter((activity) => Number(activity.physComplete || 0) < 100);
  const critical = open.filter((activity) => activity.isCritical);
  // The product's own rule: past its finish date and under 100% is Delayed.
  const delayed = open
    .filter((activity) => activity.endDate && new Date(activity.endDate).getTime() < today.getTime())
    .map((activity) => ({ ...activity, daysLate: Math.floor((today.getTime() - new Date(activity.endDate).getTime()) / DAY) }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const tight = open
    .filter((activity) => !activity.isCritical && Number.isFinite(activity.totalFloat))
    .sort((a, b) => a.totalFloat - b.totalFloat)
    .slice(0, 5);
  const facts = [
    `FACT: ${activities.length} activities, ${open.length} not complete, data date ${day(project?.dataDate)}`,
    `FACT: ${critical.length} open activities on the critical path (total float 0, as the CPM engine computed it)`,
    `FACT: ${delayed.length} activities delayed (past their finish date and under 100%)`,
    ...critical.slice(0, LIST).map((activity) => `FACT: Critical: ${activityLine(activity)}`),
    ...delayed.slice(0, LIST).map((activity) => `FACT: Delayed ${activity.daysLate} calendar days past finish: ${activityLine(activity)}`),
    ...tight.map((activity) => `FACT: Near-critical: ${activityLine(activity)}`),
  ];
  const listed = [...new Map([...critical.slice(0, LIST), ...delayed.slice(0, LIST)].map((activity) => [activity.id, activity])).values()];
  return [
    { id: `${projectId}:schedule`, type: "schedule_facts", typeLabel: "Schedule (CPM results)", title: `${project?.name || "Project"} schedule`, ref: null, status: null, projectId, projectName: project?.name || null, url: `/projects/${projectId}?module=schedule&child=critical`, snippet: null, text: facts.join("\n") },
    ...listed.map((activity) => ({
      id: activity.id,
      type: "activity",
      typeLabel: "Activity",
      title: activity.name,
      ref: activity.activityCode || null,
      status: activity.isCritical ? "critical" : "delayed",
      projectId,
      projectName: project?.name || null,
      url: `/projects/${projectId}?module=schedule&child=activities&recordId=${activity.id}`,
      snippet: null,
      text: [activityLine(activity), activity.predecessors ? `Predecessors: ${activity.predecessors}` : null].filter(Boolean).join("\n"),
    })),
  ];
};

module.exports = { scheduleSources, APPROVED_PROGRESS, officialPct };
