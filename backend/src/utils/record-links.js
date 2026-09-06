/**
 * Where each record type lives in the project workspace
 * (`/projects/:id/:module[/:child]`, OCTA-FE-ROUTES-008). Used to build
 * notification and comment links that open the right module with the record
 * pre-selected (`?recordId=`). Keep in sync with
 * frontend/src/features/projects/lib/project-modules.ts.
 */
const RECORD_WORKSPACE = Object.freeze({
  risk: { module: "schedule", child: "risks" },
  activity: { module: "activities" },
  progress_submission: { module: "schedule", child: "progress" },
  daily_report: { module: "site-reporting" },
  site_diary: { module: "site-reporting" },
  daily_log: { module: "site-reporting" },
  timesheet: { module: "site-reporting" },
  ncr: { module: "quality", child: "ncr" },
  itp: { module: "quality", child: "itp" },
  defect: { module: "quality", child: "defects" },
  punch_item: { module: "quality", child: "defects" },
  observation: { module: "quality", child: "observations" },
  form_instance: { module: "quality", child: "itp" },
  form_template: { module: "quality", child: "itp" },
  material_test: { module: "quality", child: "tests" },
  safety_incident: { module: "quality", child: "safety" },
  rfi: { module: "doc-control", child: "rfi" },
  submittal: { module: "doc-control", child: "submittals" },
  drawing: { module: "doc-control", child: "drawings" },
  drawing_set: { module: "doc-control", child: "drawings" },
  sheet: { module: "doc-control", child: "drawings" },
  sheet_revision: { module: "doc-control", child: "drawings" },
  markup: { module: "doc-control", child: "drawings" },
  pin: { module: "doc-control", child: "drawings" },
  transmittal: { module: "doc-control", child: "transmittals" },
  correspondence: { module: "doc-control", child: "correspondence" },
  document: { module: "doc-control", child: "drawings" },
  document_revision: { module: "doc-control", child: "drawings" },
  spec_section: { module: "doc-control", child: "specifications" },
  change_order: { module: "commercial", child: "change-orders" },
  change_event: { module: "commercial", child: "change-events" },
  rfq: { module: "commercial", child: "change-events" },
  ipc: { module: "commercial", child: "ipc" },
  ipc_certificate: { module: "commercial", child: "ipc" },
  ipc_item: { module: "commercial", child: "ipc" },
  sub_valuation: { module: "commercial", child: "sub-valuations" },
  commitment: { module: "commercial", child: "commitments" },
  commitment_change_order: { module: "commercial", child: "commitments" },
  sub_pay_app: { module: "commercial", child: "pay-apps" },
  bid_package: { module: "commercial", child: "bids" },
  eot: { module: "commercial", child: "eot" },
  eot_claim: { module: "commercial", child: "eot" },
  weather_delay: { module: "commercial", child: "weather" },
  meeting: { module: "meetings" },
  meeting_action: { module: "meetings" },
  procurement_order: { module: "schedule", child: "longLead" },
  procurement_package: { module: "schedule", child: "longLead" },
  delivery_receipt: { module: "schedule", child: "longLead" },
  cost_record: { module: "cost", child: "activity" },
  direct_cost: { module: "cost", child: "direct-costs" },
  lookahead: { module: "schedule", child: "lookahead" },
  inbound_email: { module: "doc-control", child: "emails" },
  conversation: { path: "/messages", param: "conversationId" },
  burn_rate_entry: { module: "cost", child: "burn" },
  boq_item: { module: "boq" },
  boq_revision: { module: "boq" },
  schedule_revision: { module: "schedule", child: "revisions" },
  equipment: { module: "equipment" },
  location: { module: "locations" },
  photo: { module: "photos" },
  project: { module: "overview" },
  task: { path: "/tasks" },
});

const encode = (value) => encodeURIComponent(String(value));

/**
 * Absolute app path for a record. Unknown record types open the project root
 * so a link is never broken, only less precise.
 */
const recordWorkspacePath = ({ projectId, recordType, recordId = null }) => {
  const target = RECORD_WORKSPACE[recordType];
  if (target?.path) {
    // Org-level pages (tasks, messages) do not need a project.
    const param = target.param || "recordId";
    return recordId ? `${target.path}?${param}=${encode(recordId)}` : target.path;
  }
  if (!projectId) return null;
  const base = target
    ? `/projects/${encode(projectId)}/${target.module}${target.child ? `/${target.child}` : ""}`
    : `/projects/${encode(projectId)}`;
  return recordId ? `${base}?recordId=${encode(recordId)}` : base;
};

module.exports = {
  RECORD_WORKSPACE,
  recordWorkspacePath,
};
