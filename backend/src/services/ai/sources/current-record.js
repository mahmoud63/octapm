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

const TYPE_LABELS = { rfi: "RFI", submittal: "Submittal", correspondence: "Correspondence", change_order: "Change order", ncr: "NCR", punch_item: "Punch item", task: "Task", meeting: "Meeting", risk: "Risk", activity: "Activity", commitment: "Commitment" };
// The field each record is titled by: the first of these its loader selects.
const TITLE_FIELDS = ["subject", "title", "name", "description"];
const RECORD_TYPES = Object.keys(BODY_LOADERS);

/**
 * `view` is the caller as the project's own routes see them
 * (requestForProject): its user, projectAccess and permission decisions.
 */
const currentRecordSource = async ({ view, projectId, recordType, recordId }) => {
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
