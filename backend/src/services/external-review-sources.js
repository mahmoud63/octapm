const { prisma } = require("../config/db");

/**
 * The records the external review engine can issue to a consultant (CONSULTANT
 * V1). One adapter per record type, all feeding the one engine:
 *
 * - `module`: the permission module the record is read under — the caller
 *   (contractor or consultant) must read it to see a submission of it;
 * - `decisions`: the shared decision classes in the order offered, with this
 *   workflow's own labels (an RFI is approved, an ITP passed, a report
 *   accepted; returned / rejected send the action back to the contractor);
 * - `load`: what is issued — reference, title, the content as label/value
 *   rows, the activity it belongs to — read from the record's own table,
 *   scoped to the project;
 * - `attachmentType`: the attachment record type its files are filed under,
 *   the only files a submission may issue.
 *
 * Owner review (Owner Portal) and other record types plug in here later.
 */

const DECISIONS = Object.freeze(["approved", "approved_with_comments", "returned", "rejected"]);
// Decisions that need the reviewer to say why or what.
const COMMENT_REQUIRED = Object.freeze(["approved_with_comments", "returned", "rejected"]);
// Decisions that hand the action back to the contractor to revise.
const RETURNING = Object.freeze(["returned", "rejected"]);

const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const row = (label, value) => (value === null || value === undefined || value === "" ? null : { label, value: String(value) });
const rows = (...items) => items.filter(Boolean);

const attachedDocuments = async ({ projectId, recordType, recordId }) => {
  const items = await prisma.attachment.findMany({
    where: { projectId, recordType, recordId, document: { status: { in: ["available", "linked"] } } },
    orderBy: { sortOrder: "asc" },
    select: { documentId: true, document: { select: { title: true, originalName: true, fileName: true } } },
  });
  return items.map((item) => ({ id: item.documentId, label: item.document?.title || item.document?.originalName || item.document?.fileName || "Document" }));
};

const SOURCES = Object.freeze({
  rfi: {
    label: "RFI",
    module: "rfi",
    attachmentType: "rfi",
    decisions: { approved: "Approve", approved_with_comments: "Approve with Comments", returned: "Reject / Return" },
    path: (projectId, id) => `/projects/${projectId}/doc-control/rfi?recordId=${id}`,
    load: async ({ projectId, sourceId }) => {
      const rfi = await prisma.rfi.findFirst({ where: { id: sourceId, projectId }, select: { id: true, ref: true, subject: true, question: true, discipline: true, priority: true, status: true, specSection: true, dueDate: true, responseRequiredBy: true, costImpact: true, scheduleImpactFlag: true, scheduleImpact: true, activityId: true, revision: true } });
      if (!rfi) return null;
      return {
        ref: rfi.ref,
        title: rfi.subject,
        status: rfi.status,
        activityId: rfi.activityId,
        fields: rows(row("Subject", rfi.subject), row("Question", rfi.question), row("Discipline", rfi.discipline), row("Specification section", rfi.specSection), row("Priority", rfi.priority), row("Response required by", day(rfi.responseRequiredBy || rfi.dueDate)), row("Cost impact", rfi.costImpact ? "Yes" : "No"), row("Schedule impact", rfi.scheduleImpactFlag ? `Yes${rfi.scheduleImpact ? ` (${rfi.scheduleImpact} days)` : ""}` : "No")),
      };
    },
  },
  submittal: {
    label: "Submittal",
    module: "submittal",
    attachmentType: "submittal",
    decisions: { approved: "Approved", approved_with_comments: "Approved as Noted", returned: "Revise and Resubmit", rejected: "Rejected" },
    path: (projectId, id) => `/projects/${projectId}/doc-control/submittals?recordId=${id}`,
    load: async ({ projectId, sourceId }) => {
      const sub = await prisma.submittal.findFirst({ where: { id: sourceId, projectId, archivedAt: null }, select: { id: true, ref: true, title: true, discipline: true, revision: true, specRef: true, status: true, remarks: true, requiredOnSite: true, leadTimeWeeks: true, activityId: true } });
      if (!sub) return null;
      return {
        ref: sub.ref,
        title: sub.title,
        status: sub.status,
        activityId: sub.activityId,
        fields: rows(row("Title", sub.title), row("Discipline", sub.discipline), row("Specification reference", sub.specRef), row("Submittal revision", sub.revision), row("Required on site", day(sub.requiredOnSite)), row("Lead time (weeks)", sub.leadTimeWeeks), row("Remarks", sub.remarks)),
      };
    },
  },
  progress_report: {
    label: "Progress report",
    module: "report",
    attachmentType: "progress_report",
    decisions: { approved: "Accept", approved_with_comments: "Accept with Comments", returned: "Return for Revision" },
    path: (projectId, id) => `/projects/${projectId}/reports?recordId=${id}`,
    // The report's own status and revision follow its review: issued when submitted, a new draft revision when revised.
    onIssued: ({ projectId, sourceId }) => prisma.progressReport.updateMany({ where: { id: sourceId, projectId }, data: { status: "issued" } }),
    onRevision: ({ projectId, sourceId, revision }) => prisma.progressReport.updateMany({ where: { id: sourceId, projectId }, data: { status: "draft", revision } }),
    load: async ({ projectId, sourceId }) => {
      const report = await prisma.progressReport.findFirst({ where: { id: sourceId, projectId }, select: { id: true, ref: true, title: true, kind: true, period: true, summary: true, status: true, revision: true, activityId: true } });
      if (!report) return null;
      return {
        ref: report.ref,
        title: report.title,
        status: report.status,
        activityId: report.activityId,
        fields: rows(row("Report", report.title), row("Period", report.period), row("Kind", report.kind), row("Report revision", report.revision), row("Content", report.summary)),
      };
    },
  },
  itp: {
    label: "Inspection request",
    module: "inspection",
    attachmentType: "itp",
    decisions: { approved: "Pass", approved_with_comments: "Pass with Comments", returned: "Fail / Reject" },
    path: (projectId, id) => `/projects/${projectId}/quality/itp?recordId=${id}`,
    load: async ({ projectId, sourceId }) => {
      const itp = await prisma.itpRecord.findFirst({ where: { id: sourceId, projectId }, select: { id: true, ref: true, title: true, pointType: true, status: true, dueDate: true, inspectionDate: true, notes: true, activityId: true } });
      if (!itp) return null;
      return {
        ref: itp.ref,
        title: itp.title,
        status: itp.status,
        activityId: itp.activityId,
        fields: rows(row("Inspection", itp.title), row("Point type", itp.pointType), row("Requested inspection date", day(itp.inspectionDate || itp.dueDate)), row("Notes", itp.notes)),
      };
    },
  },
  ncr: {
    label: "NCR corrective action",
    module: "ncr",
    attachmentType: "ncr",
    decisions: { approved: "Accept", approved_with_comments: "Accept with Comments", returned: "Reject / Revision Required" },
    path: (projectId, id) => `/projects/${projectId}/quality/ncr?recordId=${id}`,
    load: async ({ projectId, sourceId }) => {
      const ncr = await prisma.ncrRecord.findFirst({ where: { id: sourceId, projectId }, select: { id: true, ref: true, severity: true, description: true, disposition: true, status: true, responsible: true, closureComment: true, dueDate: true, activityId: true } });
      if (!ncr) return null;
      return {
        ref: ncr.ref,
        title: `${ncr.severity === "major" ? "Major" : "Minor"} non-conformance${ncr.description ? `: ${String(ncr.description).slice(0, 80)}` : ""}`,
        status: ncr.status,
        activityId: ncr.activityId,
        fields: rows(row("Severity", ncr.severity), row("Non-conformance", ncr.description), row("Disposition", ncr.disposition), row("Corrective action", ncr.closureComment), row("Responsible", ncr.responsible), row("Due", day(ncr.dueDate))),
      };
    },
  },
  closeout_deliverable: {
    label: "Closeout deliverable",
    module: "closeout",
    attachmentType: "closeout_deliverable",
    decisions: { approved: "Accept", approved_with_comments: "Accept with Comments", returned: "Reject / Revision Required" },
    path: (projectId, id) => `/projects/${projectId}/closeout?recordId=${id}`,
    load: async ({ projectId, sourceId }) => {
      const item = await prisma.closeoutDeliverable.findFirst({ where: { id: sourceId, projectId }, select: { id: true, ref: true, title: true, category: true, description: true, status: true, warrantyStart: true, warrantyEnd: true, dueDate: true, activityId: true } });
      if (!item) return null;
      return {
        ref: item.ref,
        title: item.title,
        status: item.status,
        activityId: item.activityId,
        fields: rows(row("Deliverable", item.title), row("Category", item.category.replace(/_/g, " ")), row("Description", item.description), row("Due", day(item.dueDate)), row("Warranty", item.warrantyStart ? `${day(item.warrantyStart)} → ${day(item.warrantyEnd) || "—"}` : null)),
      };
    },
  },
});
const SOURCE_TYPES = Object.freeze(Object.keys(SOURCES));

const sourceOf = (sourceType) => SOURCES[sourceType] || null;
const decisionsFor = (sourceType) => Object.entries(sourceOf(sourceType)?.decisions || {}).map(([value, label]) => ({ value, label, commentRequired: COMMENT_REQUIRED.includes(value) }));
const decisionLabel = (sourceType, decision) => sourceOf(sourceType)?.decisions?.[decision] || decision;

/** What a submission issues: the record's content now, and the files it has to choose from. */
const loadSource = async ({ projectId, sourceType, sourceId }) => {
  const source = sourceOf(sourceType);
  if (!source) return null;
  const content = await source.load({ projectId, sourceId });
  if (!content) return null;
  const documents = await attachedDocuments({ projectId, recordType: source.attachmentType, recordId: sourceId });
  return { ...content, documents };
};

module.exports = { SOURCES, SOURCE_TYPES, DECISIONS, COMMENT_REQUIRED, RETURNING, sourceOf, decisionsFor, decisionLabel, loadSource };
