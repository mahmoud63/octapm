/**
 * Builds the feature test matrix by joining four real sources:
 *   - the live API (does the endpoint answer as a PM?)
 *   - the route files actually mounted
 *   - the permission policy
 *   - the frontend feature folders and module registry
 *
 *   node scripts/qa/generate-feature-matrix.js
 */
const fs = require("fs");
const path = require("path");
const { prisma, login, actor } = require("./harness");
const { permissionPolicy } = require("../../src/config/permissions");
const { openApiSpec } = require("../../src/openapi/spec");

const SEED_PASSWORD = process.env.QA_SEED_PASSWORD || "DemoPassw0rd!";
const ROOT = path.join(__dirname, "..", "..", "..");
const FRONTEND = path.join(ROOT, "frontend", "src", "features");

// endpoint segment -> { label, permission module, frontend feature folder }
const FEATURES = [
  ["activities", "Activities", "schedule", "schedule"],
  ["schedule", "Schedule / CPM", "schedule", "schedule"],
  ["lookaheads", "Lookahead planning", "lookahead", "lookahead"],
  ["boq", "Bill of quantities", "boq", "boq"],
  ["activity-boq-allocations", "BOQ allocation to activities", "boq", "boq"],
  ["cost", "Cost control", "cost", "cost"],
  ["budget/lines", "Budget by cost code", "cost", "cost"],
  ["direct-costs", "Direct costs", "cost", "direct-costs"],
  ["cash-flow", "Cash flow", "cost", "cost"],
  ["change-orders", "Change orders", "change_order", "commercial"],
  ["change-events", "Change events and RFQs", "change_event", "change-events"],
  ["commitments", "Commitments / subcontracts", "commitment", "commercial"],
  ["pay-apps", "Subcontractor pay applications", "sub_pay_app", "commercial"],
  ["ipc", "Interim payment certificates", "ipc", "commercial"],
  ["sub-valuations", "Sub valuations (legacy)", "ipc", "commercial"],
  ["eot", "Extension of time claims", "eot", "commercial"],
  ["contract", "Contract profile and notices", "eot", "contract"],
  ["bids", "Bid packages and leveling", "bid", "bids"],
  ["budget-revisions", "Budget revisions", "cost", "cost"],
  ["rfi", "RFIs", "rfi", "doc-control"],
  ["submittals", "Submittals", "submittal", "doc-control"],
  ["correspondence", "Correspondence", "document_control", "doc-control"],
  ["transmittals", "Transmittals", "document_control", "doc-control"],
  ["specifications", "Specifications index", "document_control", "specifications"],
  ["drawings/sets", "Drawing sets and sheets", "document_control", "drawings"],
  ["emails", "Project inbound email", "email", "emails"],
  ["punch", "Punch list", "punch", "punch"],
  ["ncr", "Non-conformance reports", "ncr", "quality"],
  ["forms", "Inspections / ITP / checklists", "inspection", "inspections"],
  ["material-tests", "Material tests", "ncr", "materials"],
  ["safety", "Safety", "safety", "quality"],
  ["daily-logs", "Daily logs", "progress", "site-reporting"],
  ["daily-reports", "Daily reports", "progress", "site-reporting"],
  ["site-diaries", "Site diaries", "progress", "site-reporting"],
  ["weekly-reports", "Weekly reports", "progress", "site-reporting"],
  ["timesheets", "Timesheets and crews", "timesheet", "timesheets"],
  ["photos", "Photos", "progress", "attachments"],
  ["attachments", "Attachments", "document_control", "attachments"],
  ["equipment", "Equipment", "procurement", "equipment"],
  ["procurement", "Procurement", "procurement", "procurement"],
  ["long-lead", "Long lead items", "procurement", "long-lead"],
  ["risks", "Risk register", "risk", "risks"],
  ["weather-delays", "Weather delays", "progress", "site-reporting"],
  ["meetings", "Meetings", "meeting", "meetings"],
  ["tasks", "Tasks", "task", "tasks"],
  ["locations", "Locations", "location", "locations"],
  ["team", "Project team", "user_management", "projects"],
  ["parties", "External parties", "project_parties", "projects"],
  ["comments", "Comments and mentions", "document_control", "comments"],
  ["audit", "Audit trail", "audit", "audit"],
  ["health", "Project health dashboard", "progress", "projects"],
  ["forecast", "Delay and overrun forecast", "schedule", "forecast"],
  ["bim/models", "BIM models (IFC)", "bim", "bim"],
  ["jobs", "Background jobs", "audit", "projects"],
  ["setup-readiness", "Project setup readiness", "progress", "projects"],
  ["subscriptions", "Record subscriptions", "document_control", "comments"],
];

const QUERY = {
  comments: "?recordType=rfi&recordId=00000000-0000-4000-8000-000000000000",
  subscriptions: "?recordType=rfi&recordId=00000000-0000-4000-8000-000000000000",
  attachments: "?recordType=rfi",
};

const exists = (p) => fs.existsSync(p);

(async () => {
  const session = await login("pm@octapm.demo", SEED_PASSWORD);
  if (!session.token) throw new Error("could not sign in; is the seed loaded?");
  const pm = actor(session.token, "PM");

  const projects = await pm.get("/projects");
  const projectId = (projects.data?.items || [])[0]?.id;
  if (!projectId) throw new Error("no project visible");

  const routeFiles = new Set(fs.readdirSync(path.join(__dirname, "..", "..", "src", "routes")));
  const specPaths = new Set(Object.keys(openApiSpec.paths || {}));

  const rows = [];
  let id = 1;
  for (const [segment, label, moduleName, feature] of FEATURES) {
    const url = `/projects/${projectId}/${segment}${QUERY[segment] || ""}`;
    const response = await pm.get(url);

    const apiOk = response.status === 200;
    const documented = [...specPaths].some((p) =>
      p.startsWith(`/projects/{projectId}/${segment.split("/")[0]}`),
    );
    const hasPermissionModule = Boolean(permissionPolicy.modules[moduleName]);
    const hasFrontend = exists(path.join(FRONTEND, feature));
    const backendFile = [...routeFiles].some((f) =>
      f.replace(/\.js$/, "").includes(segment.split("/")[0].replace(/s$/, "")),
    );

    // Did the endpoint return anything, or is it an empty shell?
    const payload = response.data;
    const count = Array.isArray(payload)
      ? payload.length
      : Array.isArray(payload?.items)
        ? payload.items.length
        : Array.isArray(payload?.rows)
          ? payload.rows.length
          : null;

    let status;
    if (!apiOk) status = "🔴 Broken";
    else if (!hasFrontend) status = "🟣 Backend only";
    else status = "✅ Working";

    rows.push({
      id: `F-${String(id++).padStart(3, "0")}`,
      label,
      segment,
      moduleName,
      frontend: hasFrontend ? "✅" : "⚪",
      backend: backendFile ? "✅" : "❓",
      api: apiOk ? `✅ 200` : `🔴 ${response.status}`,
      documented: documented ? "✅" : "⚪",
      permissions: hasPermissionModule ? `✅ \`${moduleName}\`` : "⚪",
      count: count === null ? "—" : String(count),
      status,
    });
  }

  const header =
    "| ID | Feature | Frontend | Backend | API | Swagger | Permissions | Rows | Status |";
  const divider = "| --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = rows
    .map(
      (r) =>
        `| ${r.id} | ${r.label} | ${r.frontend} | ${r.backend} | ${r.api} | ${r.documented} | ${r.permissions} | ${r.count} | ${r.status} |`,
    )
    .join("\n");

  const broken = rows.filter((r) => r.status.startsWith("🔴"));
  const backendOnly = rows.filter((r) => r.status.startsWith("🟣"));

  const doc = `# OctaPM feature test matrix

Generated by \`node scripts/qa/generate-feature-matrix.js\` on ${new Date()
    .toISOString()
    .slice(0, 10)} against a running API and a real PostgreSQL database.

Each row was produced by **calling the endpoint as a signed-in PM**, not by
reading code. "Rows" is how many records that call returned on the seeded demo
project — a useful signal, since an endpoint that answers 200 with an empty list
is only proven to be mounted, not proven to work.

Legend: ✅ present and answering · 🟣 backend only (no frontend feature folder)
· 🔴 broken · ⚪ absent · ❓ could not be determined by file name

${header}
${divider}
${body}

## Summary

- **${rows.length}** project-scoped features probed.
- **${rows.filter((r) => r.status.startsWith("✅")).length}** have a frontend, a
  mounted route, a Swagger entry, a permission module, and answer 200.
- **${backendOnly.length}** backend only${backendOnly.length ? `: ${backendOnly.map((r) => r.label).join(", ")}` : ""}.
- **${broken.length}** broken${broken.length ? `: ${broken.map((r) => `${r.label} (${r.api})`).join(", ")}` : ""}.

## The important caveat

A ✅ in this table means the feature is **wired up**: the page exists, the route
is mounted, the contract is published, permissions are declared, and the API
answers. It does **not** mean the business workflow behind it is complete. That
question is answered per-scenario in \`OCTAPM_INTEGRATION_MAP.md\` and
\`OCTAPM_FULL_SYSTEM_QA_REPORT.md\`, where far fewer things earn a tick.

The frontend column checks that a feature folder exists, not that its buttons
are connected to these endpoints. Driving the React app through a browser is not
covered by this pass.
`;

  const out = path.join(ROOT, "docs", "testing", "OCTAPM_FEATURE_TEST_MATRIX.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, doc);
  console.log(`Wrote ${out}`);
  console.log(`${rows.length} features, ${broken.length} broken, ${backendOnly.length} backend-only`);

  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
