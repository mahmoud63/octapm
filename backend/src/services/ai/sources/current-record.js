/**
 * The record on the caller's screen as an Ask OctaPM source (AI UX
 * correction, 2026-10-11): opened from RFI-102, the drawer answers about
 * RFI-102.
 *
 * Authorisation before retrieval, failing closed: the record is read only
 * when it belongs to the project, its module is readable by the caller on
 * that project and — for a party-scoped person — its own rule admits them
 * (document-text recordVisibleToViewer, with a viewer always built from the
 * caller's access). Otherwise there is no record source, and nothing says
 * whether the record exists.
 */
const { prisma } = require("../../../config/db");
const { hasPermission } = require("../../../middleware/rbac");
const { BODY_LOADERS } = require("../../retrieval.service");
const documentText = require("../../document-text.service");

/**
 * A day's site report, read through the daily-log route's own path: progress
 * read on the project, the service's own viewer rules, and the BOQ figures
 * withheld as GET /daily-logs/:date withholds them; rendered as the
 * service's own text (status included, so a draft is never read as approved).
 */
const dailyLogSource = async ({ view, projectId, recordId }) => {
  if (!hasPermission(view, "progress", "read")) return null;
  const row = await prisma.dailyLog.findFirst({ where: { id: recordId, projectId }, select: { date: true } });
  if (!row) return null;
  const dailyLogs = require("../../daily-log.service");
  const { boqFigureAccess, withheldDailyLog } = require("../../../utils/boq-figures");
  const date = new Date(row.date).toISOString().slice(0, 10);
  const log = await dailyLogs.getLog({ orgId: view.user.orgId, projectId, date, viewer: { id: view.user.id, projectAccess: view.projectAccess } });
  if (!log) return null;
  const project = await prisma.project.findFirst({ where: { id: projectId }, select: { name: true } });
  const shown = withheldDailyLog(log, boqFigureAccess(view));
  return { id: recordId, type: "daily_log", typeLabel: "Daily report on your screen", module: "daily_log", title: `Daily report ${date}`, ref: date, status: shown.status || null, projectId, projectName: project?.name || null, url: `/projects/${projectId}/site-reporting?date=${date}`, snippet: null, text: dailyLogs.renderText({ project: project || { name: "Project" }, log: shown }).slice(0, 4000) };
};

const TYPE_LABELS = { rfi: "RFI", submittal: "Submittal", correspondence: "Correspondence", change_order: "Change order", ncr: "NCR", punch_item: "Punch item", task: "Task", meeting: "Meeting", risk: "Risk", activity: "Activity", commitment: "Commitment" };
// The field each record is titled by: the first of these its loader selects.
const TITLE_FIELDS = ["subject", "title", "name", "description"];
const RECORD_TYPES = [...Object.keys(BODY_LOADERS), "daily_log"];

/**
 * `view` is the caller as the project's own routes see them
 * (requestForProject): its user, projectAccess and permission decisions.
 */
const currentRecordSource = async ({ view, projectId, recordType, recordId }) => {
  if (recordType === "daily_log") return view?.user && recordId ? dailyLogSource({ view, projectId, recordId }) : null;
  const loader = BODY_LOADERS[recordType];
  if (!loader || !recordId || !view?.user || !prisma[loader.model]?.findFirst) return null;
  const viewer = documentText.documentViewer({ userId: view.user.id, projectAccess: view.projectAccess, canRead: (moduleName) => hasPermission(view, moduleName, "read") });
  if (!(await documentText.recordVisibleToViewer({ recordType, recordId, viewer }))) return null;
  const row = await prisma[loader.model].findFirst({ where: { id: recordId, projectId }, select: { id: true, ...loader.select } }).catch(() => null);
  if (!row) return null;
  const titleField = TITLE_FIELDS.find((field) => loader.select[field] && row[field]);
  const title = titleField ? String(row[titleField]).slice(0, 200) : TYPE_LABELS[recordType] || recordType;
  const params = new URLSearchParams({ recordId });
  return {
    id: row.id,
    type: recordType,
    typeLabel: `${TYPE_LABELS[recordType] || recordType} on your screen`,
    module: recordType,
    title,
    ref: null,
    status: row.status || null,
    projectId,
    projectName: null,
    url: `/projects/${projectId}?${params}`,
    snippet: null,
    text: String(loader.text(row) || "").slice(0, 1500),
  };
};

module.exports = { currentRecordSource, RECORD_TYPES };
