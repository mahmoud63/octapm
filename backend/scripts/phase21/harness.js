/**
 * Phase 21 harness.
 *
 * Every lesson from Phase 20 is enforced here rather than remembered:
 *
 *   - a failed call throws with METHOD, PATH, STATUS and the server's error
 *     code and message, so a business assertion never fails first with
 *     "cannot read property of undefined" when the real cause was an HTTP error
 *   - tokens are cached but re-minted well before the 15-minute access-token
 *     expiry, so a long run cannot start serving an expired credential
 *   - nothing is swallowed: there is no `.catch(() => {})` anywhere, and
 *     cleanup failures are collected and reported loudly
 *   - money is compared as integer minor units, never as floats
 */

// The API under test: the local stack on :5000 unless P21_API_BASE names
// another origin (a wave's own API on a free port, so the stages can be
// re-run against code the running API does not have yet).
const API = `${(process.env.P21_API_BASE || "http://127.0.0.1:5000").replace(/\/$/, "")}/api/v1`;
const PASSWORD = process.env.P21_PASSWORD || "DemoPassw0rd!";

/** Well under the 15-minute JWT_EXPIRY. */
const TOKEN_TTL_MS = 8 * 60_000;

/** "Validation failed" on its own says nothing; the field errors say everything. */
const describeDetails = (details) => {
  if (!details) return "";
  const list = Array.isArray(details) ? details : details.errors || details.fields;
  if (Array.isArray(list)) {
    return (
      " :: " +
      list
        .map((d) => `${d.path ?? d.param ?? d.field ?? "?"}=${JSON.stringify(d.value)} (${d.msg ?? d.message ?? "invalid"})`)
        .join("; ")
    );
  }
  return " :: " + JSON.stringify(details).slice(0, 400);
};

class ApiError extends Error {
  constructor(method, path, status, body) {
    const code = body?.error?.code ?? "(no code)";
    const message = body?.error?.message ?? "(no message)";
    super(`${method} ${path} -> ${status} ${code}: ${message}${describeDetails(body?.error?.details)}`);
    this.name = "ApiError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.code = code;
    this.serverMessage = message;
    this.details = body?.error?.details ?? null;
  }
}

const tokens = new Map();

async function login(email) {
  const cached = tokens.get(email);
  if (cached && Date.now() - cached.minted < TOKEN_TTL_MS) return cached.token;

  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError("POST", "/auth/login", res.status, body);

  const token = body?.data?.tokens?.accessToken;
  if (!token) throw new Error(`login ${email}: 200 but no access token in the response`);
  tokens.set(email, { minted: Date.now(), token });
  return token;
}

/**
 * One request. Returns the unwrapped `data` on success and throws ApiError
 * otherwise — the caller never has to check a status by hand.
 */
async function call(who, method, path, payload) {
  const token = await login(who);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });

  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} -> ${res.status} but the body was not JSON: ${text.slice(0, 200)}`);
    }
  }

  if (!res.ok) throw new ApiError(method, path, res.status, body);
  return body?.data;
}

/** The same request, but the status is the answer — for permission probes. */
async function probe(who, method, path, payload) {
  try {
    const data = await call(who, method, path, payload);
    return { status: 200, ok: true, code: null, data };
  } catch (err) {
    if (err instanceof ApiError) {
      return { status: err.status, ok: false, code: err.code, message: err.serverMessage, details: err.details };
    }
    throw err;
  }
}

const GET = (who, path) => call(who, "GET", path);
const POST = (who, path, payload = {}) => call(who, "POST", path, payload);
const PATCH = (who, path, payload = {}) => call(who, "PATCH", path, payload);
const PUT = (who, path, payload = {}) => call(who, "PUT", path, payload);
const DELETE = (who, path) => call(who, "DELETE", path);

/**
 * A multipart upload — for the endpoints that take a real file, such as
 * executing a subcontract, which wants the signed agreement rather than a
 * flag saying it was signed.
 */
async function upload(who, method, path, { field = "file", filename, contentType, body, fields = {} }) {
  const token = await login(who);
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append(field, new Blob([body], { type: contentType }), filename);

  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} -> ${res.status}, body was not JSON: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) throw new ApiError(method, path, res.status, parsed);
  return parsed?.data;
}

/** Fetches a binary body (a generated PDF) rather than JSON. */
async function download(who, path) {
  const token = await login(who);
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    throw new ApiError("GET", path, res.status, parsed);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ── money ──────────────────────────────────────────────────────────────────
/** Money as integer cents. Floats are never compared directly. */
const cents = (value) => Math.round(Number(value ?? 0) * 100);
const money = (c) => (c / 100).toFixed(2);

/**
 * The authoritative actual cost, and where it came from.
 *
 * `/cost/reconciliation` is the only place that answers this without guessing:
 * `ledger.total` is the CostLedgerEntry sum, `budget.*` and `activity.*` are
 * the materialised projections, and the service says itself whether the three
 * agree. Reading a dashboard number and calling it proof would be taking the
 * system's word for its own arithmetic.
 */
const readLedger = (recon) => ({
  ledgerCents: cents(recon?.ledger?.total ?? 0),
  transactionalCents: cents(recon?.ledger?.transactionalActual ?? 0),
  legacyOpeningCents: cents(recon?.ledger?.legacyOpeningActual ?? 0),
  entries: Number(recon?.ledger?.entries ?? 0),
  bySource: Object.fromEntries(
    Object.entries(recon?.ledger?.bySource ?? {}).map(([k, v]) => [k, cents(v)]),
  ),
  byCostType: Object.fromEntries(
    Object.entries(recon?.ledger?.byCostType ?? {}).map(([k, v]) => [k, cents(v)]),
  ),
  budgetProjectionCents: cents(recon?.budget?.recordedTotal ?? 0),
  budgetDerivedCents: cents(recon?.budget?.derivedTotal ?? 0),
  activityProjectionCents: cents(recon?.activity?.recordedTotal ?? 0),
  activityDerivedCents: cents(recon?.activity?.derivedTotal ?? 0),
  balanced: Boolean(recon?.balanced),
});

// ── reporting ──────────────────────────────────────────────────────────────
const checks = [];

function check(label, expected, actual, { tolerance = 0 } = {}) {
  const pass =
    typeof expected === "number" && typeof actual === "number"
      ? Math.abs(expected - actual) <= tolerance
      : JSON.stringify(expected) === JSON.stringify(actual);
  checks.push({ label, expected, actual, pass });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${label}  expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  return pass;
}

function note(label, value) {
  console.log(`  ---- ${label}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
}

function section(title) {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

function summary() {
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${"=".repeat(78)}`);
  console.log(`CHECKS: ${checks.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log("\nFAILURES:");
    for (const f of failed) {
      console.log(`  ${f.label}\n      expected ${JSON.stringify(f.expected)}\n      actual   ${JSON.stringify(f.actual)}`);
    }
  }
  return failed.length;
}

module.exports = {
  API,
  ApiError,
  login,
  call,
  probe,
  GET,
  POST,
  PATCH,
  PUT,
  DELETE,
  cents,
  money,
  check,
  note,
  section,
  summary,
  checks,
  readLedger,
  upload,
  download,
};
