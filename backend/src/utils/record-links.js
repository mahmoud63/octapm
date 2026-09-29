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
  // Purchase orders now have a home of their own (OCTA-COM-PO-053); packages
  // are still planned against the schedule's long-lead view.
  procurement_order: { module: "procurement", child: "purchase-orders" },
  procurement_package: { module: "schedule", child: "longLead" },
  delivery_receipt: { module: "schedule", child: "longLead" },
  cost_record: { module: "cost", child: "activity" },
  direct_cost: { module: "cost", child: "direct-costs" },
  lookahead: { module: "schedule", child: "lookahead" },
  inbound_email: { module: "doc-control", child: "emails" },
  bim_model: { module: "bim" },
  bim_element: { module: "bim" },
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
  // A BOQ allocation and a cost loading are left out on purpose: every link
  // stored for them names the project root with the record's type and id,
  // and a stored link is never rewritten, so new ones keep that shape. The
  // web project route opens them (RECORD_SOURCE_VIEWS, project-modules.ts):
  // an allocation on Project Controls › Mapping, a cost loading on Schedule ›
  // Earned Value, each with its row selected.
});

const encode = (value) => encodeURIComponent(String(value));

/**
 * The URL segment that names a workspace (workspace switching doc §5): the
 * organisation's slug, or its id for an organisation that has none yet — the
 * web client accepts either under `/o/`, so a link never waits on a slug.
 */
const workspaceSegment = (org) => {
  if (!org) return null;
  if (typeof org === "string") return org;
  return org.slug || org.id || null;
};

/**
 * Puts an app path inside its workspace: `/projects/…` becomes
 * `/o/{slug}/projects/…`. A path that already names a workspace, an absolute
 * URL, or a path with no workspace to name is returned as it is. Every
 * notification actionUrl and email link goes through here once, so the web
 * client's legacy redirect is only for links minted before this wave.
 */
const workspacePath = (path, org) => {
  const segment = workspaceSegment(org);
  if (!path || !segment) return path ?? null;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/o/")) return path;
  return `/o/${encode(segment)}${path}`;
};

/**
 * Absolute app path for a record. Unknown record types open the project root
 * so a link is never broken, only less precise.
 *
 * `source` carries the record type alongside the id because that is what the
 * module dashboards key on when deciding which record to open — a link with
 * only `?recordId=` lands on the right tab and opens nothing, which is what
 * every notification and comment link did.
 *
 * With `orgSlug` (a slug, or an organisation row) the path carries its
 * workspace. Without it the legacy shape is kept for the callers that only
 * know the project; `createNotifications` adds the workspace before a link
 * is stored, and the web client redirects a legacy link it meets.
 */
const recordWorkspacePath = ({ projectId, recordType, recordId = null, orgSlug = null }) => {
  const target = RECORD_WORKSPACE[recordType];
  let path;
  if (target?.path) {
    // Org-level pages (tasks, messages) do not need a project.
    const param = target.param || "recordId";
    path = recordId ? `${target.path}?${param}=${encode(recordId)}` : target.path;
  } else {
    if (!projectId) return null;
    const base = target
      ? `/projects/${encode(projectId)}/${target.module}${target.child ? `/${target.child}` : ""}`
      : `/projects/${encode(projectId)}`;
    path = recordId
      ? `${base}?recordId=${encode(recordId)}&source=${encode(recordType)}`
      : base;
  }
  return workspacePath(path, orgSlug);
};

module.exports = {
  RECORD_WORKSPACE,
  recordWorkspacePath,
  workspacePath,
  workspaceSegment,
};
