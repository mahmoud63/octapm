const { recordWorkspacePath } = require("../utils/record-links");

/**
 * Tool adapters for the workflow engine (OCTA-PLAT-WF-024).
 *
 * Each adapter knows how to load its record, what context a template can
 * test (amount, type…), which status starts a run automatically, and how to
 * apply the outcome through the record's own service — always with
 * `viaWorkflow: true`, so the record's lock on running instances does not
 * block the engine itself.
 */

const money = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
};

const actorArgs = (actor) => ({ userId: actor?.id || null, userRole: actor?.role || null });

const pathOr = ({ projectId, recordType, recordId, fallback }) => {
  try {
    return recordWorkspacePath({ projectId, recordType, recordId }) || fallback;
  } catch {
    return fallback;
  }
};

const TOOLS = Object.freeze({
  change_order: {
    key: "change_order",
    label: "Change orders",
    module: "change_order",
    triggerStatus: "pending",
    outcomes: { success: "approved", fail: "rejected" },
    contextFields: [
      { key: "amount", label: "Value", type: "number" },
      { key: "category", label: "Category", type: "string" },
      { key: "scheduleImpact", label: "Schedule impact (days)", type: "number" },
    ],
    load: ({ tx, projectId, recordId }) => tx.changeOrder.findFirst({ where: { id: recordId, projectId } }),
    context: (row) => ({ ref: row.ref, title: row.description, status: row.status, amount: money(row.value), category: row.category || null, scheduleImpact: Number(row.scheduleImpact || 0) }),
    path: ({ projectId, recordId }) => pathOr({ projectId, recordType: "change_order", recordId, fallback: `/projects/${projectId}/commercial/change-orders?recordId=${recordId}` }),
    apply: async ({ orgId, projectId, recordId, outcome, actor, comment }) => {
      const service = require("./change-order.service");
      if (outcome === "success") return service.approveChangeOrder({ orgId, projectId, coId: recordId, comment, ...actorArgs(actor), viaWorkflow: true });
      return service.rejectChangeOrder({ orgId, projectId, coId: recordId, reason: comment || "Rejected by workflow", ...actorArgs(actor), viaWorkflow: true });
    },
  },
  commitment: {
    key: "commitment",
    label: "Commitments",
    module: "commitment",
    triggerStatus: "pending",
    outcomes: { success: "approved", fail: "draft" },
    contextFields: [
      { key: "amount", label: "Schedule of values", type: "number" },
      { key: "type", label: "Type", type: "string" },
      { key: "retentionRate", label: "Retention %", type: "number" },
    ],
    load: ({ tx, projectId, recordId }) => tx.commitment.findFirst({ where: { id: recordId, projectId }, include: { lines: { select: { amount: true } }, vendorCompany: { select: { name: true } } } }),
    context: (row) => ({ ref: row.ref, title: row.title, status: row.status, amount: money((row.lines || []).reduce((sum, line) => sum + Number(line.amount || 0), 0)), type: row.type, retentionRate: Number(row.retentionRate || 0), vendor: row.vendorCompany?.name || null }),
    path: ({ projectId, recordId }) => pathOr({ projectId, recordType: "commitment", recordId, fallback: `/projects/${projectId}/commercial/commitments?recordId=${recordId}` }),
    apply: async ({ orgId, projectId, recordId, outcome, actor, comment }) => {
      const service = require("./commitment.service");
      if (outcome === "success") return service.approveCommitment({ orgId, projectId, commitmentId: recordId, actor, viaWorkflow: true });
      return service.returnCommitment({ orgId, projectId, commitmentId: recordId, actor, reason: comment || "Returned by workflow", viaWorkflow: true });
    },
  },
  sub_pay_app: {
    key: "sub_pay_app",
    label: "Subcontractor pay applications",
    module: "sub_pay_app",
    triggerStatus: "submitted",
    outcomes: { success: "approved", fail: "rejected" },
    contextFields: [
      { key: "amount", label: "Net this period", type: "number" },
      { key: "gross", label: "Gross this period", type: "number" },
      { key: "overClaim", label: "Over-claim", type: "number" },
    ],
    load: ({ tx, projectId, recordId }) => tx.subPayApp.findFirst({ where: { id: recordId, projectId }, include: { commitment: { select: { ref: true, vendorCompany: { select: { name: true } } } } } }),
    context: (row) => ({ ref: row.ref, title: `${row.commitment?.ref || ""} ${row.periodLabel}`.trim(), status: row.status, amount: money(row.netThisPeriod), gross: money(row.grossThisPeriod), overClaim: money(row.overClaimAmount), vendor: row.commitment?.vendorCompany?.name || null }),
    path: ({ projectId, recordId }) => pathOr({ projectId, recordType: "sub_pay_app", recordId, fallback: `/projects/${projectId}/commercial/pay-apps?recordId=${recordId}` }),
    apply: async ({ orgId, projectId, recordId, outcome, actor, comment }) => {
      const service = require("./sub-pay-app.service");
      if (outcome === "success") return service.approvePayApp({ orgId, projectId, payAppId: recordId, actor, viaWorkflow: true });
      return service.rejectPayApp({ orgId, projectId, payAppId: recordId, actor, code: "OTHER", reason: comment || "Rejected by workflow", viaWorkflow: true });
    },
  },
  ipc_certificate: {
    key: "ipc_certificate",
    label: "Payment certificates (IPC)",
    module: "ipc",
    triggerStatus: "submitted",
    outcomes: { success: "certified", fail: null },
    contextFields: [
      { key: "amount", label: "Net payable", type: "number" },
      { key: "totalCert", label: "Certified", type: "number" },
    ],
    // The contract's terms come with the certificate: while its value is
    // unestablished under a retention cap, a certificate not yet certified
    // has a net payable that restates it, and the context — stored on the
    // run, routed on, and shown to every approver — leaves it out
    // (utils/boq-figures withheldCertificateContext; PC-7a review).
    load: ({ tx, projectId, recordId }) =>
      tx.ipcCertificate.findFirst({
        where: { id: recordId, projectId },
        include: { project: { select: { primeContract: { select: { originalValueSource: true, retentionCapRate: true } } } } },
      }),
    context: (row) =>
      require("../utils/boq-figures").withheldCertificateContext(
        { ref: row.period, title: `IPC ${row.period}`, status: row.status, amount: money(row.netPayable), totalCert: money(row.totalCert), period: row.period },
        row.project?.primeContract || null,
      ),
    path: ({ projectId, recordId }) => pathOr({ projectId, recordType: "ipc_certificate", recordId, fallback: `/projects/${projectId}/commercial/ipc?recordId=${recordId}` }),
    apply: async ({ orgId, projectId, record, outcome, actor, comment }) => {
      if (outcome !== "success") return null; // a failed run leaves the period submitted for the QS to rework
      const service = require("./ipc.service");
      return service.certifyIpcPeriod({ orgId, projectId, period: record.period, comment, ...actorArgs(actor), viaWorkflow: true });
    },
  },
  budget_revision: {
    key: "budget_revision",
    label: "Budget revisions",
    module: "cost",
    triggerStatus: "submitted",
    outcomes: { success: "approved", fail: "rejected" },
    contextFields: [
      { key: "amount", label: "Amount", type: "number" },
      { key: "changeType", label: "Change type", type: "string" },
    ],
    load: ({ tx, projectId, recordId }) => tx.budgetRevision.findFirst({ where: { id: recordId, projectId } }),
    context: (row) => ({ ref: row.ref, title: row.title, status: row.status, amount: money(row.amount), changeType: row.changeType }),
    path: ({ projectId }) => `/projects/${projectId}/commercial/budget-revisions`,
    apply: async ({ orgId, projectId, recordId, outcome, actor }) => {
      const service = require("./budget-revision.service");
      return service.updateBudgetRevision({ orgId, projectId, revisionId: recordId, userId: actor?.id || null, payload: { status: outcome === "success" ? "approved" : "rejected" }, viaWorkflow: true });
    },
  },
  submittal: {
    key: "submittal",
    label: "Submittals",
    module: "submittal",
    triggerStatus: null, // submittals keep their own review routes; start by hand when a generic route is wanted
    outcomes: { success: "approved", fail: "rejected" },
    contextFields: [
      { key: "discipline", label: "Discipline", type: "string" },
      { key: "leadTimeWeeks", label: "Lead time (weeks)", type: "number" },
    ],
    load: ({ tx, projectId, recordId }) => tx.submittal.findFirst({ where: { id: recordId, projectId } }),
    context: (row) => ({ ref: row.ref, title: row.title, status: row.status, discipline: row.discipline || null, leadTimeWeeks: Number(row.leadTimeWeeks || 0), amount: 0 }),
    path: ({ projectId, recordId }) => pathOr({ projectId, recordType: "submittal", recordId, fallback: `/projects/${projectId}/doc-control/submittals?recordId=${recordId}` }),
    apply: async ({ orgId, projectId, recordId, outcome, actor, comment }) => {
      const service = require("./submittal.service");
      if (outcome === "success") return service.approveSubmittal({ orgId, projectId, submittalId: recordId, comment, ...actorArgs(actor), viaWorkflow: true });
      return service.rejectSubmittal({ orgId, projectId, submittalId: recordId, reason: comment || "Rejected by workflow", ...actorArgs(actor), viaWorkflow: true });
    },
  },
  correspondence: {
    key: "correspondence",
    label: "Correspondence",
    module: "document_control",
    triggerStatus: null,
    outcomes: { success: "closed", fail: "open" },
    contextFields: [
      { key: "type", label: "Type", type: "string" },
      { key: "direction", label: "Direction", type: "string" },
      { key: "contractualNotice", label: "Contractual notice", type: "boolean" },
    ],
    load: ({ tx, projectId, recordId }) => tx.correspondence.findFirst({ where: { id: recordId, projectId } }),
    context: (row) => ({ ref: row.ref, title: row.subject, status: row.status, type: row.type, direction: row.direction, contractualNotice: Boolean(row.contractualNotice), amount: 0 }),
    path: ({ projectId, recordId }) => pathOr({ projectId, recordType: "correspondence", recordId, fallback: `/projects/${projectId}/doc-control/correspondence?recordId=${recordId}` }),
    apply: async ({ orgId, projectId, recordId, outcome, actor, comment }) => {
      const service = require("./correspondence.service");
      return service.updateCorrespondence({ orgId, projectId, correspondenceId: recordId, payload: { status: outcome === "success" ? "closed" : "open", comment: comment || null }, ...actorArgs(actor), viaWorkflow: true });
    },
  },
  document_revision: {
    key: "document_revision",
    label: "Document revisions",
    module: "document_control",
    triggerStatus: "submitted",
    outcomes: { success: "approved", fail: null },
    contextFields: [
      { key: "recordType", label: "Record type", type: "string" },
      { key: "category", label: "Category", type: "string" },
    ],
    load: ({ tx, projectId, recordId }) => tx.documentRevision.findFirst({ where: { id: recordId, projectId } }),
    context: (row) => ({ ref: row.documentNumber || row.revision, title: row.title || row.fileName || `Rev ${row.revision}`, status: row.status, recordType: row.recordType, category: row.category || null, amount: 0 }),
    path: ({ projectId, recordId }) => pathOr({ projectId, recordType: "document", recordId, fallback: `/projects/${projectId}/doc-control/documents` }),
    apply: async ({ orgId, projectId, recordId, outcome, actor, comment }) => {
      if (outcome !== "success") return null;
      const service = require("./doc-control.service");
      return service.approveDocumentRevision({ orgId, projectId, revisionId: recordId, comment, ...actorArgs(actor), viaWorkflow: true });
    },
  },
});

const TOOL_KEYS = Object.keys(TOOLS);
const getTool = (key) => TOOLS[key] || null;
const describeTool = (tool) => ({ key: tool.key, label: tool.label, module: tool.module, triggerStatus: tool.triggerStatus, outcomes: tool.outcomes, contextFields: [{ key: "ref", label: "Reference", type: "string" }, { key: "status", label: "Status", type: "string" }, ...tool.contextFields] });

module.exports = { TOOLS, TOOL_KEYS, getTool, describeTool };
