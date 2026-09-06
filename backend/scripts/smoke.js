/**
 * End-to-end smoke test against a running API.
 *
 * The unit suite proves the services behave; this proves the thing actually
 * boots and answers — routes mounted, middleware ordered, permissions wired,
 * Prisma talking to a real Postgres. It signs in as the seeded PM, reads every
 * project module, writes one record and reads it back, and checks that a role
 * without permission is refused.
 *
 *   npm run db:seed --workspace=backend     # once, on an empty database
 *   npm run dev --workspace=backend         # in another terminal
 *   npm run smoke --workspace=backend
 *
 * Environment:
 *   SMOKE_BASE_URL   default http://localhost:5000
 *   SMOKE_EMAIL      default pm@octapm.demo        (from prisma/seed.js)
 *   SMOKE_PASSWORD   default DemoPassw0rd!
 *   SMOKE_DENY_EMAIL default warehouse@octapm.demo (the negative check)
 *   SMOKE_TIMEOUT_MS default 20000
 */
const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const API = `${BASE}/api/v1`;
const EMAIL = process.env.SMOKE_EMAIL || "pm@octapm.demo";
const PASSWORD = process.env.SMOKE_PASSWORD || "DemoPassw0rd!";
const DENY_EMAIL = process.env.SMOKE_DENY_EMAIL || "warehouse@octapm.demo";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

// Every project module's list endpoint. If a module is mounted and its
// permissions are right, each of these answers 200 with the success envelope.
// A second element is the query string the route's validator insists on.
const PROJECT_MODULES = [
  "activities", "activity-boq-allocations",
  ["attachments", "recordType=rfi"],
  "audit", "bids", "boq", "budget-revisions", "cash-flow", "change-events", "change-orders",
  ["comments", "recordType=rfi&recordId=00000000-0000-4000-8000-000000000000"],
  "commitments", "contract", "correspondence", "cost", "daily-logs", "daily-reports",
  "defects", "direct-costs", "drawings", "emails", "eot", "equipment", "forecast",
  "forms", "health", "ipc", "itp", "jobs", "locations", "long-lead", "lookaheads",
  "material-tests", "meetings", "ncr", "parties", "pay-apps", "photos", "procurement",
  "punch", "rfi", "risks", "safety", "schedule", "setup-readiness", "site-diaries",
  "specifications", "sub-valuations", "submittals",
  ["subscriptions", "recordType=rfi&recordId=00000000-0000-4000-8000-000000000000"],
  "tasks", "team", "timesheets", "transmittals", "weather-delays", "weekly-reports",
];

const ORG_ENDPOINTS = [
  "/projects", "/notifications", "/conversations", "/reports", "/portfolio",
  "/company/cost-codes", "/company/vendors", "/workflows/my-steps",
];

const results = [];
let token = null;

const colour = process.stdout.isTTY;
const green = (s) => (colour ? `[32m${s}[0m` : s);
const red = (s) => (colour ? `[31m${s}[0m` : s);
const dim = (s) => (colour ? `[2m${s}[0m` : s);

async function call(path, { method = "GET", body, auth = true, bearer } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { accept: "application/json" };
    if (body) headers["content-type"] = "application/json";
    const useToken = bearer !== undefined ? bearer : auth ? token : null;
    if (useToken) headers.authorization = `Bearer ${useToken}`;

    const response = await fetch(`${path.startsWith("http") ? "" : API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Left as null; the step's check reports the raw body.
    }
    return { status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs one check. `fn` throws or returns a failure string; anything else passes. */
async function step(name, fn) {
  const started = Date.now();
  try {
    const problem = await fn();
    const ms = Date.now() - started;
    if (problem) {
      results.push({ name, ok: false, ms, problem });
      console.log(`${red("FAIL")}  ${name} ${dim(`${ms}ms`)}\n      ${problem}`);
    } else {
      results.push({ name, ok: true, ms });
      console.log(`${green("ok")}    ${name} ${dim(`${ms}ms`)}`);
    }
  } catch (error) {
    const ms = Date.now() - started;
    const problem = error?.name === "AbortError" ? `timed out after ${TIMEOUT_MS}ms` : String(error?.message || error);
    results.push({ name, ok: false, ms, problem });
    console.log(`${red("FAIL")}  ${name} ${dim(`${ms}ms`)}\n      ${problem}`);
  }
}

/** Fails the step unless the response is 200 with `success: true`. */
const expectOk = (response, label) => {
  if (response.status !== 200) {
    const detail = response.json?.error?.message || response.text?.slice(0, 200) || "";
    return `${label}: HTTP ${response.status} ${detail}`;
  }
  if (response.json?.success !== true) {
    return `${label}: envelope missing success:true (got ${response.text?.slice(0, 120)})`;
  }
  return null;
};

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  await step("health endpoint answers", async () => {
    const response = await call(`${BASE}/api/health`, { auth: false });
    if (response.status !== 200) return `HTTP ${response.status}`;
    return null;
  });

  await step("OpenAPI document serves", async () => {
    const response = await call(`${BASE}/api/v1/openapi.json`, { auth: false });
    if (response.status !== 200) return `HTTP ${response.status}`;
    const count = Object.keys(response.json?.paths || {}).length;
    if (count < 100) return `only ${count} paths documented`;
    console.log(dim(`      ${count} documented paths`));
    return null;
  });

  await step("unauthenticated request is refused", async () => {
    const response = await call("/projects", { auth: false });
    if (response.status !== 401) return `expected 401, got ${response.status}`;
    if (response.json?.success !== false) return "error envelope missing success:false";
    return null;
  });

  await step(`sign in as ${EMAIL}`, async () => {
    const response = await call("/auth/login", {
      method: "POST",
      auth: false,
      body: { email: EMAIL, password: PASSWORD },
    });
    const problem = expectOk(response, "login");
    if (problem) return problem;
    token = response.json?.data?.tokens?.accessToken;
    if (!token) return "no access token in the response";
    return null;
  });

  if (!token) {
    console.log(`\n${red("Cannot continue without a session.")} Has the database been seeded?`);
    return report();
  }

  await step("session identifies the signed-in user", async () => {
    const response = await call("/auth/me");
    const problem = expectOk(response, "me");
    if (problem) return problem;
    if (response.json?.data?.email !== EMAIL) {
      return `expected ${EMAIL}, got ${response.json?.data?.email}`;
    }
    return null;
  });

  await step("permission resolution answers", async () => {
    const response = await call("/auth/me/permissions");
    const problem = expectOk(response, "permissions");
    if (problem) return problem;
    const modules = response.json?.data?.modules;
    if (!modules || Object.keys(modules).length === 0) return "no permission modules resolved";
    console.log(dim(`      ${Object.keys(modules).length} permission modules`));
    return null;
  });

  let projectId = null;

  await step("project list returns the seeded project", async () => {
    const response = await call("/projects");
    const problem = expectOk(response, "projects");
    if (problem) return problem;
    const items = response.json?.data?.items || [];
    if (items.length === 0) return "no projects visible to this user";
    projectId = items[0].id;
    console.log(dim(`      ${items.length} project(s), using ${items[0].name}`));
    return null;
  });

  for (const path of ORG_ENDPOINTS) {
    await step(`GET ${path}`, async () => expectOk(await call(path), path));
  }

  if (projectId) {
    for (const entry of PROJECT_MODULES) {
      const [module, query] = Array.isArray(entry) ? entry : [entry, null];
      const path = `/projects/${projectId}/${module}${query ? `?${query}` : ""}`;
      await step(`GET /projects/:id/${module}`, async () => expectOk(await call(path), module));
    }

    let createdRfiId = null;

    await step("create an RFI", async () => {
      const response = await call(`/projects/${projectId}/rfi`, {
        method: "POST",
        body: {
          subject: `Smoke test RFI ${new Date().toISOString()}`,
          question: "Raised by the smoke test to prove the write path works.",
          priority: "normal",
        },
      });
      if (response.status !== 200 && response.status !== 201) {
        const detail = response.json?.error?.message || response.text?.slice(0, 300);
        return `HTTP ${response.status} ${detail}`;
      }
      createdRfiId = response.json?.data?.rfi?.id || response.json?.data?.id;
      if (!createdRfiId) return `created but no id in the response: ${response.text?.slice(0, 200)}`;
      return null;
    });

    await step("read the RFI back", async () => {
      if (!createdRfiId) return "skipped — nothing was created";
      const response = await call(`/projects/${projectId}/rfi/${createdRfiId}`);
      return expectOk(response, "rfi detail");
    });

    await step("a role without permission is refused", async () => {
      const login = await call("/auth/login", {
        method: "POST",
        auth: false,
        body: { email: DENY_EMAIL, password: PASSWORD },
      });
      const denyToken = login.json?.data?.tokens?.accessToken;
      if (!denyToken) return `could not sign in as ${DENY_EMAIL}: HTTP ${login.status}`;

      const response = await call(`/projects/${projectId}/rfi`, {
        method: "POST",
        bearer: denyToken,
        body: { subject: "Should be refused", question: "Should be refused", discipline: "structural" },
      });
      if (response.status !== 403) return `expected 403 for ${DENY_EMAIL}, got ${response.status}`;
      return null;
    });
  }

  return report();
}

function report() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const total = results.length;
  const ms = results.reduce((sum, r) => sum + r.ms, 0);

  console.log(`\n${"-".repeat(60)}`);
  console.log(`${passed}/${total} passed in ${ms}ms`);

  if (failed.length) {
    console.log(`\n${red(`${failed.length} failed:`)}`);
    for (const failure of failed) console.log(`  ${failure.name}\n    ${failure.problem}`);
    process.exitCode = 1;
  } else {
    console.log(green("Smoke test passed."));
  }
}

main().catch((error) => {
  console.error(`\nSmoke test could not run: ${error?.message || error}`);
  console.error(`Is the API running at ${BASE}?`);
  process.exitCode = 1;
});
