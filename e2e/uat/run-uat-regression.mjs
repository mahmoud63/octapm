import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const manifestPath = path.join(__dirname, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const requireFromHere = createRequire(import.meta.url);

const DEFAULT_PASSWORD = manifest.seed.password;
const DEFAULT_WEB_BASE_URL = "http://127.0.0.1:5173";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:5000/api/v1";
const REQUIRED_MODULES = new Set(manifest.requiredCoverage);

function parseArgs(argv) {
  const args = {
    validate: false,
    headless: true,
    skipBrowser: false,
    useSeededFixtures: false,
    outputDir: process.env.UAT_EVIDENCE_DIR || null,
    runId: process.env.UAT_RUN_ID || null,
  };

  for (const arg of argv) {
    if (arg === "--validate") args.validate = true;
    else if (arg === "--skip-browser") args.skipBrowser = true;
    else if (arg === "--use-seeded-fixtures") args.useSeededFixtures = true;
    else if (arg === "--headed" || arg === "--headless=false")
      args.headless = false;
    else if (arg.startsWith("--output-dir="))
      args.outputDir = arg.slice("--output-dir=".length);
    else if (arg.startsWith("--run-id="))
      args.runId = arg.slice("--run-id=".length);
    else if (arg === "--help") args.help = true;
  }

  return args;
}

function usage() {
  return [
    "Usage:",
    "  node e2e/uat/run-uat-regression.mjs --validate",
    "  node e2e/uat/run-uat-regression.mjs [--use-seeded-fixtures] [--skip-browser] [--headed]",
    "",
    "Environment:",
    "  UAT_BASE_URL       Frontend base URL, default http://127.0.0.1:5173",
    "  UAT_API_BASE_URL   API base URL, default http://127.0.0.1:5000/api/v1",
    "  UAT_PM_EMAIL       Optional seeded PM email",
    "  UAT_PM_PASSWORD    Optional seeded PM password",
    "  UAT_EVIDENCE_DIR   Evidence output directory",
  ].join("\n");
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function apiUrl(baseUrl, route) {
  return `${normalizeBaseUrl(baseUrl)}${route.startsWith("/") ? route : `/${route}`}`;
}

function webUrl(baseUrl, route) {
  return `${normalizeBaseUrl(baseUrl)}${route.startsWith("/") ? route : `/${route}`}`;
}

function compactRunId(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 24)
    .toLowerCase();
}

function toMoney(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function expectStatus(actual, expected, label) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  assert(
    statuses.includes(actual),
    `${label} expected HTTP ${statuses.join("/")} but received ${actual}`,
    { actual, expected: statuses },
  );
}

function sanitizeForEvidence(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof ApiSession) {
    return {
      label: value.label,
      user: value.user
        ? {
            id: value.user.id,
            email: value.user.email,
            role: value.user.role,
          }
        : null,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForEvidence(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (
        [
          "accessToken",
          "refreshToken",
          "password",
          "tokens",
          "Authorization",
        ].includes(key)
      ) {
        return [key, "[redacted]"];
      }
      return [key, sanitizeForEvidence(entry, seen)];
    }),
  );
}

function validateManifest() {
  const personaIds = new Set(manifest.personas.map((persona) => persona.id));
  const covered = new Set();

  for (const flow of manifest.flows) {
    assert(flow.id, "Every UAT flow must have an id");
    assert(
      personaIds.has(flow.persona),
      `Flow ${flow.id} references unknown persona ${flow.persona}`,
    );
    assert(
      Array.isArray(flow.modules) && flow.modules.length > 0,
      `Flow ${flow.id} must list modules`,
    );
    flow.modules.forEach((module) => covered.add(module));
  }

  for (const negative of manifest.permissionNegativeTests) {
    assert(negative.id, "Every permission-negative test must have an id");
    assert(
      Array.isArray(negative.expectedStatuses) &&
        negative.expectedStatuses.length > 0,
      `Permission-negative test ${negative.id} must define expectedStatuses`,
    );
  }

  for (const viewport of manifest.responsiveSmoke) {
    assert(viewport.id, "Every responsive smoke scenario must have an id");
    assert(
      viewport.width > 0 && viewport.height > 0,
      `Viewport ${viewport.id} needs dimensions`,
    );
  }

  covered.add("permission_negative");
  for (const viewport of manifest.responsiveSmoke) covered.add(viewport.id);
  covered.add("release_evidence");
  if (covered.has("ncr")) covered.add("qa");

  const missing = [...REQUIRED_MODULES].filter(
    (module) => !covered.has(module),
  );
  assert(missing.length === 0, "UAT manifest is missing required coverage", {
    missing,
  });

  return {
    taskId: manifest.taskId,
    flows: manifest.flows.length,
    personas: manifest.personas.length,
    permissionNegativeTests: manifest.permissionNegativeTests.length,
    responsiveSmoke: manifest.responsiveSmoke.length,
    covered: [...covered].sort(),
  };
}

class Evidence {
  constructor({ outputDir, runId, webBaseUrl, apiBaseUrl }) {
    this.outputDir = outputDir;
    this.runId = runId;
    this.webBaseUrl = webBaseUrl;
    this.apiBaseUrl = apiBaseUrl;
    this.startedAt = new Date();
    this.steps = [];
    this.context = {};
    this.status = "running";
  }

  async ensureDirs() {
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.mkdir(path.join(this.outputDir, "screenshots"), {
      recursive: true,
    });
  }

  screenshotPath(name) {
    return path.join(this.outputDir, "screenshots", `${name}.png`);
  }

  recordContext(value) {
    this.context = { ...this.context, ...value };
  }

  async step(id, fn) {
    const startedAt = new Date();
    process.stdout.write(`[uat] ${id} ... `);
    try {
      const result = await fn();
      const finishedAt = new Date();
      this.steps.push({
        id,
        status: "passed",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        result: sanitizeForEvidence(result || {}),
      });
      process.stdout.write("passed\n");
      return result;
    } catch (error) {
      const finishedAt = new Date();
      this.steps.push({
        id,
        status: "failed",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: {
          message: error.message,
          details: error.details || null,
          stack: error.stack,
        },
      });
      process.stdout.write("failed\n");
      throw error;
    }
  }

  async write(status) {
    this.status = status;
    const finishedAt = new Date();
    const file = path.join(
      this.outputDir,
      `${manifest.releaseEvidence.artifactPrefix}-${this.runId}.json`,
    );
    const payload = {
      taskId: manifest.taskId,
      suite: manifest.suite,
      version: manifest.version,
      status,
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - this.startedAt.getTime(),
      webBaseUrl: this.webBaseUrl,
      apiBaseUrl: this.apiBaseUrl,
      manifest: {
        flows: manifest.flows.map((flow) => flow.id),
        personas: manifest.personas.map((persona) => ({
          id: persona.id,
          role: persona.role,
          required: persona.required,
        })),
        permissionNegativeTests: manifest.permissionNegativeTests.map(
          (test) => test.id,
        ),
        responsiveSmoke: manifest.responsiveSmoke.map((smoke) => smoke.id),
      },
      context: this.context,
      steps: this.steps,
    };
    await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
    return file;
  }
}

class ApiSession {
  constructor({ apiBaseUrl, label }) {
    this.apiBaseUrl = apiBaseUrl;
    this.label = label;
    this.accessToken = null;
    this.user = null;
  }

  async request(method, route, { body, expected = [200], raw = false } = {}) {
    const headers = { Accept: "application/json" };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    const init = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(apiUrl(this.apiBaseUrl, route), init);
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    expectStatus(response.status, expected, `${this.label} ${method} ${route}`);

    if (raw) {
      return { status: response.status, body: parsed, text };
    }

    if (parsed?.success === false) {
      throw new Error(
        `${this.label} ${method} ${route} returned error: ${parsed.error?.message}`,
      );
    }

    return parsed?.data ?? parsed;
  }

  get(route, options = {}) {
    return this.request("GET", route, options);
  }

  post(route, body, options = {}) {
    return this.request("POST", route, { ...options, body });
  }

  patch(route, body, options = {}) {
    return this.request("PATCH", route, { ...options, body });
  }

  async register(payload) {
    const session = await this.post("/auth/register", payload, {
      expected: [201],
    });
    this.accessToken = session.tokens.accessToken;
    this.user = session.user;
    return session;
  }

  async login(email, password) {
    const session = await this.post("/auth/login", { email, password });
    this.accessToken = session.tokens.accessToken;
    this.user = session.user;
    return session;
  }
}

async function findProjectByName(session, name) {
  const result = await session.get(
    `/projects?limit=100&search=${encodeURIComponent(name)}`,
  );
  const items = result.items || result.rows || [];
  return items.find((project) => project.name === name) || null;
}

async function loadSeededContext(pm, evidence) {
  const project = process.env.UAT_PROJECT_ID
    ? await pm.get(`/projects/${process.env.UAT_PROJECT_ID}`)
    : await findProjectByName(
        pm,
        process.env.UAT_PROJECT_NAME || manifest.seed.project,
      );
  assert(project, "Seeded UAT project was not found");

  const restrictedProject = process.env.UAT_RESTRICTED_PROJECT_ID
    ? await pm.get(`/projects/${process.env.UAT_RESTRICTED_PROJECT_ID}`)
    : await findProjectByName(
        pm,
        process.env.UAT_RESTRICTED_PROJECT_NAME ||
          manifest.seed.restrictedProject,
      );
  assert(
    restrictedProject,
    "Seeded UAT restricted project was not found for permission-negative checks",
  );

  const activities = await pm.get(`/projects/${project.id}/activities`);
  assert(
    activities.length > 0,
    "Seeded UAT project must have at least one activity",
  );
  const activity =
    activities.find((row) => row.activityCode === "UAT-001") || activities[0];

  const allocations = await pm.get(
    `/projects/${project.id}/activity-boq-allocations?status=approved`,
  );
  assert(
    allocations.length > 0,
    "Seeded UAT project must have approved BOQ allocations",
  );

  evidence.recordContext({
    projectId: project.id,
    restrictedProjectId: restrictedProject?.id || null,
    activityId: activity.id,
    seededFixtures: true,
  });

  return {
    project,
    restrictedProject,
    activity,
    allocation: allocations[0],
  };
}

async function bootstrapViaApi({ apiBaseUrl, runId, evidence }) {
  const suffix = compactRunId(runId);
  const password = process.env.UAT_PM_PASSWORD || DEFAULT_PASSWORD;
  const pm = new ApiSession({ apiBaseUrl, label: "pm" });
  const pmEmail =
    process.env.UAT_PM_EMAIL || `uat.pm+${suffix}@pmcopilots.test`;

  if (process.env.UAT_PM_EMAIL) {
    await pm.login(pmEmail, password);
  } else {
    const registered = await pm.register({
      orgName: `PMcopilots UAT ${suffix}`,
      name: "UAT Project Manager",
      email: pmEmail,
      password,
    });
    // Sign-up makes a personal workspace, which seats nobody but its owner
    // (ENT-6); the regression adds a team below, so the workspace is
    // converted to a company through the product's own route first.
    await pm.post(
      `/organisations/${registered.organisation?.id || pm.user.orgId}/convert`,
      {},
      { expected: [200] },
    );
  }

  const project = await pm.post(
    "/projects",
    {
      name: `UAT Regression ${suffix}`,
      type: "High-rise",
      location: "Baton Rouge, LA",
      clientName: "UAT Owner",
      consultantName: "UAT Consultant",
      contractorName: "UAT Contractor",
      contractType: "lump_sum",
      contractNumber: `UAT-${suffix}`,
      startDate: "2026-01-05",
      endDate: "2026-12-18",
      completionDate: "2026-12-18",
      baselineDate: "2026-01-05",
      dataDate: "2026-02-15",
      duration: 248,
      durationUnit: "days",
      contractValue: 150000,
      defaultRetentionRate: 5,
      ldRatePerDay: 2500,
      weatherAllowanceDays: 20,
      projectCalendar: "five_day",
      reportingCutoffDay: 25,
      currency: "USD",
    },
    { expected: [201] },
  );

  await pm.post(
    `/projects/${project.id}/boq/items`,
    {
      code: `UAT-${suffix}`,
      description: "UAT concrete package",
      quantity: 100,
      unit: "m3",
      rate: 1500,
      activityName: "UAT concrete pour",
    },
    { expected: [201] },
  );

  const allocations = await pm.get(
    `/projects/${project.id}/activity-boq-allocations`,
  );
  assert(
    allocations.length > 0,
    "Manual BOQ creation should create an allocation",
  );
  const allocation = allocations[0];
  await pm.post(
    `/projects/${project.id}/activity-boq-allocations/${allocation.id}/submit`,
    {},
  );
  const approvedAllocation = await pm.post(
    `/projects/${project.id}/activity-boq-allocations/${allocation.id}/approve`,
    {},
  );

  const activities = await pm.get(`/projects/${project.id}/activities`);
  assert(
    activities.length > 0,
    "Manual BOQ creation should create an activity",
  );
  const activity = activities[0];

  const siteEmail = `uat.site+${suffix}@pmcopilots.test`;
  await pm.post(
    "/users",
    {
      name: "UAT Unassigned Site Engineer",
      email: siteEmail,
      password,
      role: "site_engineer",
    },
    { expected: [201] },
  );
  const unassigned = new ApiSession({
    apiBaseUrl,
    label: "unassignedSiteEngineer",
  });
  await unassigned.login(siteEmail, password);

  const external = new ApiSession({ apiBaseUrl, label: "externalPm" });
  await external.register({
    orgName: `External UAT ${suffix}`,
    name: "External UAT PM",
    email: `external.pm+${suffix}@pmcopilots.test`,
    password,
  });

  evidence.recordContext({
    projectId: project.id,
    activityId: activity.id,
    allocationId: approvedAllocation.id,
    seededFixtures: false,
    generatedPmEmail: pmEmail,
  });

  return {
    pm,
    password,
    pmEmail,
    project,
    restrictedProject: null,
    activity,
    allocation: approvedAllocation,
    unassigned,
    external,
  };
}

async function loginSessions({ apiBaseUrl, args, evidence }) {
  const password = process.env.UAT_PM_PASSWORD || DEFAULT_PASSWORD;
  const pmEmail =
    process.env.UAT_PM_EMAIL ||
    (args.useSeededFixtures
      ? manifest.personas.find((persona) => persona.id === "pm").email
      : null);

  if (!pmEmail && !args.useSeededFixtures) {
    return bootstrapViaApi({ apiBaseUrl, runId: evidence.runId, evidence });
  }

  const pm = new ApiSession({ apiBaseUrl, label: "pm" });
  await pm.login(pmEmail, password);

  const context = await loadSeededContext(pm, evidence);
  const sitePersona = manifest.personas.find(
    (persona) => persona.id === "siteEngineer",
  );
  const unassigned = new ApiSession({ apiBaseUrl, label: "siteEngineer" });
  await unassigned.login(
    process.env.UAT_SITE_EMAIL || sitePersona.email,
    process.env.UAT_SITE_PASSWORD || password,
  );

  const external = new ApiSession({ apiBaseUrl, label: "externalPm" });
  const externalEmail = process.env.UAT_EXTERNAL_PM_EMAIL;
  const externalPassword = process.env.UAT_EXTERNAL_PM_PASSWORD || password;
  if (externalEmail) {
    await external.login(externalEmail, externalPassword);
  } else {
    const suffix = compactRunId(evidence.runId);
    await external.register({
      orgName: `External UAT ${suffix}`,
      name: "External UAT PM",
      email: `external.pm+${suffix}@pmcopilots.test`,
      password: externalPassword,
    });
  }

  return {
    pm,
    password,
    pmEmail,
    unassigned,
    external,
    ...context,
  };
}

function evidenceAttachment(runId) {
  return [
    {
      fileName: `uat-evidence-${runId}.jpg`,
      fileUrl: "https://example.com/uat-evidence.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      description: "Synthetic UAT evidence reference",
    },
  ];
}

async function runDocumentRfiSubmittalFlow({ pm, project, activity, runId }) {
  const rfi = await pm.post(
    `/projects/${project.id}/rfi`,
    {
      subject: `UAT RFI ${runId}`,
      priority: "high",
      activityId: activity.id,
      owner: "UAT Contractor",
      reviewer: "UAT Consultant",
      approver: "UAT PM",
      dueDate: "2026-02-20",
      comment: "Clarify embedded plate detail.",
    },
    { expected: [201] },
  );
  await pm.post(`/projects/${project.id}/rfi/${rfi.id}/submit`, {
    comment: "Submitted for consultant response.",
  });
  await pm.post(`/projects/${project.id}/rfi/${rfi.id}/answer`, {
    response: "Use revised detail UAT-S-101.",
    answeredBy: "UAT Consultant",
    activityId: activity.id,
    attachmentRefs: evidenceAttachment(runId),
  });
  await pm.post(`/projects/${project.id}/rfi/${rfi.id}/approve`, {
    comment: "Accepted by PM.",
  });
  const closedRfi = await pm.post(
    `/projects/${project.id}/rfi/${rfi.id}/close`,
    {
      comment: "RFI response implemented.",
    },
  );
  assert(closedRfi.status === "closed", "RFI should close through workflow", {
    status: closedRfi.status,
  });

  const revision = await pm.post(
    `/projects/${project.id}/doc-control/rfi/${rfi.id}/revisions`,
    {
      revision: "A",
      title: `UAT RFI revision ${runId}`,
      fileName: "uat-rfi-response.pdf",
      documentNumber: `UAT-RFI-${runId}`,
      category: "RFI",
      folderPath: "/RFI",
      discipline: "Structural",
      confidentiality: "project",
      reviewDueAt: "2026-02-22",
      status: "uploaded",
      issuedBy: "UAT Consultant",
      issuedAt: "2026-02-16",
      notes: "Metadata-only revision for UAT automation.",
    },
    { expected: [201] },
  );
  await pm.post(
    `/projects/${project.id}/doc-control/revisions/${revision.id}/submit-review`,
    {
      comment: "Ready for PM review.",
    },
  );
  const approvedRevision = await pm.post(
    `/projects/${project.id}/doc-control/revisions/${revision.id}/approve`,
    { comment: "Approved for construction." },
  );
  assert(
    approvedRevision.status === "approved",
    "Document revision should be approved",
    { status: approvedRevision.status },
  );

  const submittal = await pm.post(
    `/projects/${project.id}/submittals`,
    {
      title: `UAT rebar shop drawing ${runId}`,
      activityId: activity.id,
      owner: "UAT Contractor",
      reviewer: "UAT Consultant",
      approver: "UAT PM",
      dueDate: "2026-02-24",
      comment: "Initial submittal package.",
    },
    { expected: [201] },
  );
  await pm.post(`/projects/${project.id}/submittals/${submittal.id}/submit`, {
    comment: "Submitted for technical review.",
    attachmentRefs: evidenceAttachment(runId),
  });
  await pm.post(`/projects/${project.id}/submittals/${submittal.id}/review`, {
    comment: "Reviewed without exceptions.",
  });
  const approvedSubmittal = await pm.post(
    `/projects/${project.id}/submittals/${submittal.id}/approve`,
    { comment: "Approved." },
  );
  assert(
    approvedSubmittal.status === "approved",
    "Submittal should be approved",
    { status: approvedSubmittal.status },
  );

  const register = await pm.get(
    `/projects/${project.id}/doc-control/register?recordType=rfi`,
  );
  assert(
    Array.isArray(register.rows || register.items || register),
    "Document register should return rows/items",
  );

  return {
    rfiId: rfi.id,
    documentRevisionId: revision.id,
    submittalId: submittal.id,
  };
}

async function runScheduleCostIpcFlow({ pm, project, activity, runId }) {
  const progress = await pm.post(
    `/projects/${project.id}/activities/bulk-progress`,
    {
      updates: [
        {
          activityId: activity.id,
          pctComplete: 80,
          actualCost: 82000,
          progressMethod: "percent",
          status: "submitted",
          source: "manual",
          notes: "UAT progress update.",
          evidence: { photos: evidenceAttachment(runId) },
        },
      ],
    },
  );
  assert(
    progress.submitted >= 1,
    "Progress submission should be created",
    progress,
  );
  const submission = progress.submissions[0];
  const approvedProgress = await pm.post(
    `/projects/${project.id}/activities/${activity.id}/progress-submissions/${submission.id}/approve`,
    {},
  );
  assert(
    approvedProgress.status === "approved",
    "Progress submission should be approved",
    { status: approvedProgress.status },
  );

  const report = await pm.post(
    `/projects/${project.id}/daily-reports`,
    {
      activityId: activity.id,
      date: "2026-02-15",
      shift: "day",
      pctProgress: 80,
      weather: {
        summary: "Clear",
        condition: "clear",
        temperatureC: 22,
        delayImpact: false,
      },
      manpower: [{ trade: "Concrete", workers: 8, hours: 8 }],
      materials: [{ name: "Concrete", qty: 35, unit: "m3" }],
      equipment: [{ name: "Pump", hours: 6 }],
      issues: [
        { title: "Access coordination", severity: "low", status: "closed" },
      ],
      photos: evidenceAttachment(runId),
      notes: "UAT daily report.",
      clientRequestId: `uat-${runId}`,
      clientCreatedAt: "2026-02-15T08:00:00.000Z",
      deviceId: "uat-tablet-01",
      status: "submitted",
    },
    { expected: [201] },
  );
  const approvedReport = await pm.post(
    `/projects/${project.id}/daily-reports/${report.id}/approve`,
    {},
  );
  assert(
    approvedReport.status === "approved",
    "Daily report should be approved",
    { status: approvedReport.status },
  );

  const costRecord = await pm.post(
    `/projects/${project.id}/cost/activity/${activity.id}`,
    {
      labour: 25000,
      material: 48000,
      equipment: 9000,
      indirect: 2000,
      overhead: 3000,
      contingency: 1000,
      budget: 150000,
      committed: 110000,
      actual: 87000,
      actualThroughDate: "2026-02-15",
      forecast: 152000,
    },
    { expected: [201] },
  );
  assert(costRecord.id, "Cost record should be created or updated");

  const period = `IPC-${compactRunId(runId).slice(0, 10)}`;
  const ipc = await pm.post(
    `/projects/${project.id}/ipc`,
    { period },
    { expected: [201] },
  );
  assert(
    ipc.items?.length > 0,
    "IPC period should include allocation-backed items",
  );
  const item = ipc.items[0];
  await pm.patch(`/projects/${project.id}/ipc/${period}/items/${item.id}`, {
    qty: 50,
    rate: toMoney(item.rate, 1500),
    retentionRate: 5,
  });
  await pm.post(`/projects/${project.id}/ipc/${period}/submit`, {});
  const certified = await pm.post(
    `/projects/${project.id}/ipc/${period}/certify`,
    {
      comment: "UAT certification accepted.",
    },
  );
  assert(
    ["certified", "paid"].includes(certified.status),
    "IPC period should be certified",
    { status: certified.status },
  );
  await pm.post(`/projects/${project.id}/ipc/${period}/invoice/issue`, {
    invoiceNumber: `INV-${compactRunId(runId).slice(0, 10)}`,
    invoiceDate: "2026-02-25",
    dueDate: "2026-03-25",
  });
  const payable = toMoney(certified.netPayable, 1);
  const payment = await pm.post(
    `/projects/${project.id}/ipc/${period}/payments`,
    {
      amount: payable,
      paymentReference: `PAY-${compactRunId(runId).slice(0, 10)}`,
      paymentDate: "2026-03-01",
      paymentMethod: "ACH",
      notes: "UAT payment receipt.",
    },
    { expected: [201] },
  );
  assert(payment.id, "IPC payment should be recorded");

  return {
    progressSubmissionId: submission.id,
    dailyReportId: report.id,
    costRecordId: costRecord.id,
    ipcPeriod: period,
    paymentId: payment.id,
  };
}

async function runQaSafetyFlow({ pm, project, activity, runId }) {
  const attachments = evidenceAttachment(runId);
  const ncr = await pm.post(
    `/projects/${project.id}/ncr`,
    {
      severity: "major",
      description: `UAT NCR ${runId}`,
      responsible: "UAT Contractor",
      owner: "UAT QA",
      reviewer: "UAT Consultant",
      approver: "UAT PM",
      activityId: activity.id,
      dueDate: "2026-02-28",
      comment: "NCR opened for UAT.",
    },
    { expected: [201] },
  );
  await pm.post(`/projects/${project.id}/ncr/${ncr.id}/submit`, {
    responsible: "UAT Contractor",
    dueDate: "2026-02-28",
    closureComment: "Corrective action complete.",
    attachmentRefs: attachments,
  });
  const approvedNcr = await pm.post(
    `/projects/${project.id}/ncr/${ncr.id}/approve`,
    {
      comment: "QA closeout approved.",
    },
  );
  assert(approvedNcr.status === "closed", "NCR should close after approval", {
    status: approvedNcr.status,
  });

  const safety = await pm.post(
    `/projects/${project.id}/safety`,
    {
      incidentType: "near_miss",
      severity: "low",
      title: `UAT safety observation ${runId}`,
      date: "2026-02-16",
      lostDays: 0,
      owner: "UAT HSE",
      reviewer: "UAT PM",
      approver: "UAT PM",
      responsible: "UAT Contractor",
      activityId: activity.id,
      dueDate: "2026-02-28",
      comment: "Near miss captured for UAT.",
    },
    { expected: [201] },
  );
  await pm.post(`/projects/${project.id}/safety/${safety.id}/submit`, {
    responsible: "UAT Contractor",
    dueDate: "2026-02-28",
    closureComment: "Toolbox talk completed.",
    attachmentRefs: attachments,
  });
  const approvedSafety = await pm.post(
    `/projects/${project.id}/safety/${safety.id}/approve`,
    { comment: "Safety closeout approved." },
  );
  assert(
    approvedSafety.status === "closed",
    "Safety incident should close after approval",
    {
      status: approvedSafety.status,
    },
  );

  return { ncrId: ncr.id, safetyIncidentId: safety.id };
}

async function runMeetingMinutesFlow({ pm, project, activity, runId }) {
  const suffix = compactRunId(runId).slice(0, 10);
  const meeting = await pm.post(
    `/projects/${project.id}/meetings`,
    {
      title: `UAT coordination minutes ${suffix}`,
      meetingType: "coordination",
      status: "draft",
      activityId: activity.id,
      scheduledAt: "2026-02-18T15:00:00.000Z",
      startedAt: "2026-02-18T15:05:00.000Z",
      endedAt: "2026-02-18T15:45:00.000Z",
      location: "Site conference room",
      objective: "Coordinate concrete access and decision traceability.",
      minutesText: "Reviewed pour access, approvals, and owner distribution.",
      attendees: [
        {
          userId: pm.user?.id,
          name: "UAT Project Manager",
          role: "chair",
          attendanceStatus: "attended",
          distributionRequired: true,
          activityId: activity.id,
        },
        {
          name: "UAT Consultant",
          email: `consultant.${suffix}@pmcopilots.test`,
          companyName: "UAT Consultant",
          role: "consultant",
          attendanceStatus: "attended",
          distributionRequired: true,
          activityId: activity.id,
        },
      ],
      agendaItems: [
        {
          title: "Concrete pour access",
          notes: "Review gate sequence and pump location.",
          // The meeting API's words (meeting.service ATTENDANCE_STATUSES,
          // AGENDA_STATUSES), as the web meetings page sends them: 'present' and
          // 'closed' were never taken, and the meeting was refused (CERT-2 evidence-6).
          status: "covered",
          activityId: activity.id,
        },
      ],
      decisions: [
        {
          title: "Access gate sequence approved",
          decision:
            "Use south gate for concrete pump staging during the UAT pour.",
          impact:
            "Keeps concrete pour aligned with approved schedule activity.",
          activityId: activity.id,
        },
      ],
      actionItems: [
        {
          title: "Issue gate access sketch",
          description: "Send the agreed staging sketch to the field crew.",
          ownerName: "UAT Site Engineer",
          ownerEmail: `site.${suffix}@pmcopilots.test`,
          dueDate: "2026-02-21",
          priority: "high",
          activityId: activity.id,
          createTask: true,
        },
      ],
    },
    { expected: [201] },
  );

  assert(meeting.id, "Meeting minutes should be created");
  assert(meeting.meetingNumber, "Meeting should receive a meeting number");
  assert(
    meeting.agendaItems?.length === 1,
    "Meeting agenda item should persist",
  );
  assert(meeting.decisions?.length === 1, "Meeting decision should persist");
  assert(
    meeting.actionItems?.length === 1,
    "Meeting action item should persist",
  );

  const actionItem = meeting.actionItems[0];
  assert(actionItem.taskId, "Meeting action item should link to a task");
  assert(
    actionItem.task?.taskNumber,
    "Linked task should be returned with a task number",
  );
  assert(actionItem.dueDate, "Meeting action item should keep its due date");

  const distribution = await pm.post(
    `/projects/${project.id}/meetings/${meeting.id}/distribute`,
    {
      includeAttendees: true,
      message: "UAT minutes distributed for contractual record.",
      recipients: [
        {
          name: "UAT Owner",
          email: `owner.${suffix}@pmcopilots.test`,
          companyName: "UAT Owner",
        },
      ],
    },
  );
  assert(
    distribution.distributionCount >= 1,
    "Meeting distribution should create distribution history rows",
    distribution,
  );
  assert(
    distribution.meeting?.status === "distributed",
    "Meeting should move to distributed after distribution",
    { status: distribution.meeting?.status },
  );
  assert(
    distribution.meeting?.distributions?.length >= 1,
    "Distributed meeting should include distribution history",
  );

  const comment = await pm.post(
    `/projects/${project.id}/meetings/${meeting.id}/comments`,
    {
      body: "UAT owner distribution acknowledged.",
      activityId: activity.id,
    },
    { expected: [201] },
  );
  assert(comment.id, "Meeting comment should be created");

  const refreshed = await pm.get(
    `/projects/${project.id}/meetings/${meeting.id}`,
  );
  assert(
    refreshed.comments?.some((row) => row.id === comment.id),
    "Meeting detail should include persisted comment",
  );
  assert(
    refreshed.distributions?.length >= distribution.distributionCount,
    "Meeting detail should retain distribution history",
  );

  const audit = await pm.get(
    `/projects/${project.id}/audit?entityType=meeting&entityId=${meeting.id}&source=all&limit=20`,
  );
  assert(
    audit.events?.some((event) => event.action === "status_changed"),
    "Meeting distribution should be visible in audit history",
    audit,
  );

  return {
    meetingId: meeting.id,
    meetingNumber: meeting.meetingNumber,
    taskId: actionItem.taskId,
    distributionCount: distribution.distributionCount,
    commentId: comment.id,
  };
}

async function runPermissionNegativeFlow({
  apiBaseUrl,
  pm,
  unassigned,
  external,
  project,
  restrictedProject,
}) {
  const anonymous = new ApiSession({ apiBaseUrl, label: "anonymous" });
  const anonymousResult = await anonymous.request(
    "GET",
    `/projects/${project.id}`,
    {
      expected: [401],
      raw: true,
    },
  );

  const denialProjectId = restrictedProject?.id || project.id;
  const unassignedResult = await unassigned.request(
    "GET",
    `/projects/${denialProjectId}`,
    {
      expected: [403],
      raw: true,
    },
  );

  const externalResult = await external.request(
    "GET",
    `/projects/${project.id}`,
    {
      expected: [403, 404],
      raw: true,
    },
  );

  const ownProject = await pm.get(`/projects/${project.id}`);
  assert(
    ownProject.id === project.id,
    "PM should still access the UAT project",
  );

  return {
    anonymousStatus: anonymousResult.status,
    unassignedStatus: unassignedResult.status,
    externalStatus: externalResult.status,
  };
}

async function loadPlaywright() {
  try {
    return requireFromHere("playwright");
  } catch (error) {
    throw new Error(
      `Playwright is required for browser UAT smoke. Install playwright or run with NODE_PATH pointing to the bundled runtime. ${error.message}`,
    );
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  assert(
    overflow.scrollWidth <= overflow.clientWidth + 2,
    `${label} has horizontal overflow`,
    overflow,
  );
}

async function runBrowserSmoke({
  webBaseUrl,
  evidence,
  pmEmail,
  password,
  project,
  headless,
}) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  try {
    await page.goto(webUrl(webBaseUrl, "/sign-in"), {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-testid="uat-sign-in-email"]').fill(pmEmail);
    await page.locator('[data-testid="uat-sign-in-password"]').fill(password);
    await page.locator('[data-testid="uat-sign-in-submit"]').click();
    await page
      .locator('[data-testid="workspace-dashboard"]')
      .waitFor({ timeout: 20000 });
    await page.screenshot({
      path: evidence.screenshotPath("desktop-dashboard"),
      fullPage: true,
    });
    await assertNoHorizontalOverflow(page, "desktop dashboard");

    await page.goto(webUrl(webBaseUrl, "/projects"), {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="uat-projects-page"]')
      .waitFor({ timeout: 20000 });
    await page.getByText(project.name).first().waitFor({ timeout: 20000 });
    await page.screenshot({
      path: evidence.screenshotPath("desktop-projects"),
      fullPage: true,
    });
    await assertNoHorizontalOverflow(page, "desktop projects");

    await page.goto(webUrl(webBaseUrl, `/projects/${project.id}`), {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="uat-project-detail"]')
      .waitFor({ timeout: 20000 });
    await page.getByText(project.name).first().waitFor({ timeout: 20000 });
    await page.screenshot({
      path: evidence.screenshotPath("desktop-project-detail"),
      fullPage: true,
    });
    await assertNoHorizontalOverflow(page, "desktop project detail");

    const responsiveResults = [];
    for (const viewport of manifest.responsiveSmoke.filter(
      (item) => item.id !== "desktop",
    )) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      for (const routeTemplate of viewport.routes) {
        const route = routeTemplate.replace("{projectId}", project.id);
        await page.goto(webUrl(webBaseUrl, route), {
          waitUntil: "domcontentloaded",
        });
        const target =
          route.includes("/projects/") && route !== "/projects"
            ? '[data-testid="uat-project-detail"]'
            : route === "/projects"
              ? '[data-testid="uat-projects-page"]'
              : '[data-testid="workspace-dashboard"]';
        await page.locator(target).waitFor({ timeout: 20000 });
        await assertNoHorizontalOverflow(page, `${viewport.id} ${route}`);
      }
      const screenshotName = `${viewport.id}-project-detail`;
      await page.screenshot({
        path: evidence.screenshotPath(screenshotName),
        fullPage: true,
      });
      responsiveResults.push({
        id: viewport.id,
        width: viewport.width,
        height: viewport.height,
        screenshot: `screenshots/${screenshotName}.png`,
      });
    }

    return {
      screenshots: [
        "screenshots/desktop-dashboard.png",
        "screenshots/desktop-projects.png",
        "screenshots/desktop-project-detail.png",
        ...responsiveResults.map((result) => result.screenshot),
      ],
      responsiveResults,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runSuite(args) {
  const validation = validateManifest();
  const runId =
    args.runId ||
    new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "z");
  const outputDir = path.resolve(
    repoRoot,
    args.outputDir || manifest.releaseEvidence.defaultDirectory,
  );
  const webBaseUrl = normalizeBaseUrl(
    process.env.UAT_BASE_URL || DEFAULT_WEB_BASE_URL,
  );
  const apiBaseUrl = normalizeBaseUrl(
    process.env.UAT_API_BASE_URL || DEFAULT_API_BASE_URL,
  );
  const evidence = new Evidence({ outputDir, runId, webBaseUrl, apiBaseUrl });
  await evidence.ensureDirs();
  evidence.recordContext({ validation });

  let status = "failed";
  try {
    const sessions = await evidence.step("auth-and-project-fixture", () =>
      loginSessions({ apiBaseUrl, args, evidence }),
    );

    const apiContext = {
      ...sessions,
      runId,
    };

    await evidence.step("document-rfi-submittal-flow", () =>
      runDocumentRfiSubmittalFlow(apiContext),
    );
    await evidence.step("schedule-progress-cost-ipc-flow", () =>
      runScheduleCostIpcFlow(apiContext),
    );
    await evidence.step("qa-safety-closeout-flow", () =>
      runQaSafetyFlow(apiContext),
    );
    await evidence.step("meeting-minutes-flow", () =>
      runMeetingMinutesFlow(apiContext),
    );
    await evidence.step("permission-negative-flow", () =>
      runPermissionNegativeFlow({ ...apiContext, apiBaseUrl }),
    );
    await evidence.step("dashboard-api-smoke", async () => {
      const dashboard = await sessions.pm.get("/projects/workspace-dashboard");
      assert(dashboard.summary, "Workspace dashboard should include summary");
      return {
        totalProjects: dashboard.summary.totalProjects,
        approvalQueueCount: dashboard.summary.approvalQueueCount,
      };
    });

    if (args.skipBrowser) {
      evidence.recordContext({ browserSmokeSkipped: true });
    } else {
      await evidence.step("browser-desktop-tablet-mobile-smoke", () =>
        runBrowserSmoke({
          webBaseUrl,
          evidence,
          pmEmail: sessions.pmEmail,
          password: sessions.password,
          project: sessions.project,
          headless: args.headless,
        }),
      );
    }

    status = "passed";
    return { evidence, status };
  } finally {
    const file = await evidence.write(status);
    process.stdout.write(
      `[uat] evidence written to ${path.relative(repoRoot, file)}\n`,
    );
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(usage());
  process.exit(0);
}

if (args.validate) {
  const summary = validateManifest();
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

try {
  await runSuite(args);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
