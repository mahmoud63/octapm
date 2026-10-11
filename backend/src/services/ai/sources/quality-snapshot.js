/**
 * Quality as OctaPM records it (AI-7, Quality): the quality dashboard
 * (score by the product's rule: 100 - majorNCRs×20 - minorNCRs×8 -
 * failedITPs×15), open NCRs, inspections (ITP points) and punch items, and
 * which activities they hold up. The AI explains; it never closes an NCR,
 * passes an inspection or changes a status.
 *
 * Each register through its route's own permission, failing closed:
 *   NCRs ncr:read (listNcrs); inspections inspection:read (listItps);
 *   punch punch:read (listPunchItems with the route's viewer); the quality
 *   dashboard (its route has no module gate) only with ncr or inspection
 *   read; activity names only with schedule:read.
 */
const { prisma } = require("../../../config/db");
const { hasPermission, getEffectiveRole } = require("../../../middleware/rbac");

const LIST = 10;
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const fact = (line) => `FACT: ${line}`;
const OPEN = (status) => !["closed", "passed", "waived", "verified", "void"].includes(String(status || "").toLowerCase());

const qualitySources = async ({ view, projectId }) => {
  if (!view?.user) return [];
  const orgId = view.user.orgId;
  const canNcr = hasPermission(view, "ncr", "read");
  const canItp = hasPermission(view, "inspection", "read");
  const canPunch = hasPermission(view, "punch", "read");
  if (!canNcr && !canItp && !canPunch) return [];
  const ncrService = require("../../ncr.service");
  const itpService = require("../../itp.service");
  const [dashboard, ncrs, itps, punch] = await Promise.all([
    canNcr || canItp ? require("../../quality.service").getQualityDashboard({ orgId, projectId }) : null,
    canNcr ? ncrService.listNcrs({ orgId, projectId }) : null,
    canItp ? itpService.listItps({ orgId, projectId }) : null,
    canPunch ? require("../../punch.service").listPunchItems({ orgId, projectId, filters: {}, viewer: { id: view.user.id, name: view.user.name || null, role: getEffectiveRole(view), projectAccess: view.projectAccess || null } }) : null,
  ]);
  const ncrRows = (ncrs?.rows || []).filter((row) => OPEN(row.status));
  const itpRows = (itps?.rows || []).filter((row) => OPEN(row.status) || row.status === "failed");
  const punchRows = (punch?.items || []).filter((row) => OPEN(row.status));
  const activityIds = [...new Set([...ncrRows, ...itpRows].map((row) => row.activityId).filter(Boolean))];
  const names = hasPermission(view, "schedule", "read") && activityIds.length
    ? new Map((await prisma.activity.findMany({ where: { projectId, id: { in: activityIds } }, select: { id: true, name: true, activityCode: true } })).map((activity) => [activity.id, `${activity.activityCode ? `${activity.activityCode} ` : ""}${activity.name}`]))
    : new Map();
  const on = (row) => (row.activityId ? ` on activity ${names.get(row.activityId) || "(activity you cannot see)"}` : "");
  const metrics = dashboard?.metrics || null;
  const lines = [
    ...(metrics ? [fact(`Quality score ${metrics.qualityScore} (rule: 100 - major NCRs x20 - minor NCRs x8 - failed ITPs x15): ${metrics.majorNcrs} major and ${metrics.minorNcrs} minor NCRs, ${metrics.failedItps} failed ITPs, ${metrics.openDefects} open defects, tests ${metrics.testsPassed} passed / ${metrics.testsFailed} failed, ${metrics.overdue} overdue`)] : []),
    ...(canNcr ? [fact(`${ncrRows.length} open NCRs`)] : []),
    ...ncrRows.slice(0, LIST).map((row) => fact(`NCR ${row.ref || ""} (${row.severity}, ${row.status})${on(row)}: ${String(row.description || "").slice(0, 200)}; responsible ${row.responsible || "—"}; due ${day(row.dueDate)}${row.dueAlert ? ` (${row.dueAlert.severity}, ${row.dueAlert.days} days)` : ""}`)),
    ...(canItp ? [fact(`${itpRows.length} inspection points pending or failed`)] : []),
    ...itpRows.slice(0, LIST).map((row) => fact(`Inspection ${row.ref || ""} ${row.title} (${row.pointType} point, ${row.status})${on(row)}; due ${day(row.dueDate)}${row.dueAlert ? ` (${row.dueAlert.severity}, ${row.dueAlert.days} days)` : ""}${row.pointType === "hold" && row.status !== "passed" ? " - a HOLD point: work may not proceed past it until released" : ""}`)),
    ...(canPunch ? [fact(`${punchRows.length} open punch items`)] : []),
    ...punchRows.slice(0, LIST).map((row) => fact(`Punch ${row.ref || row.number || ""} ${row.title || ""} (${row.status}${row.priority ? `, ${row.priority}` : ""}); due ${day(row.dueDate)}`)),
  ];
  if (!lines.length) return [];
  return [{ id: `${projectId}:quality`, type: "quality_facts", typeLabel: "Quality (NCRs, inspections, punch)", title: "Quality", ref: null, status: null, projectId, projectName: null, url: `/projects/${projectId}?module=quality`, snippet: null, text: lines.join("\n") }];
};

module.exports = { qualitySources };
