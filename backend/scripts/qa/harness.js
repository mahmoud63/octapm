/**
 * Scenario-test harness.
 *
 * Drives a running API over HTTP as real users would, and checks the database
 * directly with Prisma afterwards — because an HTTP 200 is not evidence that a
 * record was persisted correctly, scoped to the right organisation, or audited.
 *
 * Each scenario records what the user asked for in their QA brief: the API
 * result, the database result, the permission result, notifications raised, and
 * whether the connected module actually received the data.
 */
// The scenarios write through this client (03-integration seeds form
// templates directly), so it is a data script like the seed: refused against
// a database that is not on this machine unless ALLOW_DATA_SCRIPT names it.
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("qa");

const { PrismaClient } = require("@prisma/client");

const BASE = (process.env.QA_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const API = `${BASE}/api/v1`;
const TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || 30000);

const prisma = new PrismaClient();

const tty = process.stdout.isTTY;
const paint = (code, s) => (tty ? `[${code}m${s}[0m` : s);
const green = (s) => paint(32, s);
const red = (s) => paint(31, s);
const yellow = (s) => paint(33, s);
const dim = (s) => paint(2, s);

/** A scenario's outcome, in the shape the QA brief asks for. */
class Scenario {
  constructor(id, { module, purpose, role, preconditions }) {
    this.id = id;
    this.module = module;
    this.purpose = purpose;
    this.role = role;
    this.preconditions = preconditions || "none";
    this.steps = [];
    this.findings = { api: [], database: [], permission: [], notification: [], connected: [] };
    this.status = "pass";
    this.defects = [];
  }

  step(description, outcome) {
    this.steps.push({ description, outcome });
  }

  /** Records a passing observation against one of the brief's result axes. */
  note(axis, message) {
    this.findings[axis].push({ ok: true, message });
  }

  /** Records a failure and downgrades the scenario. */
  fail(axis, message, { severity = "Major", fix = null } = {}) {
    this.findings[axis].push({ ok: false, message });
    this.status = this.status === "fail" ? "fail" : "fail";
    this.defects.push({ axis, message, severity, fix });
  }

  /** A gap that is not a defect: the capability is absent by design or unbuilt. */
  gap(axis, message) {
    this.findings[axis].push({ ok: null, message });
    if (this.status === "pass") this.status = "partial";
  }
}

class Runner {
  constructor() {
    this.scenarios = [];
    this.context = {};
  }

  async run(id, meta, body) {
    const scenario = new Scenario(id, meta);
    this.scenarios.push(scenario);
    const started = Date.now();
    try {
      await body(scenario, this.context);
    } catch (error) {
      scenario.fail("api", `threw: ${error?.message || error}`, { severity: "Blocker" });
    }
    scenario.ms = Date.now() - started;

    const mark =
      scenario.status === "pass" ? green("PASS") : scenario.status === "partial" ? yellow("PART") : red("FAIL");
    console.log(`${mark}  ${id}  ${scenario.purpose} ${dim(`${scenario.ms}ms`)}`);
    for (const axis of Object.keys(scenario.findings)) {
      for (const finding of scenario.findings[axis]) {
        if (finding.ok === true) continue;
        const label = finding.ok === null ? yellow("gap ") : red("bug ");
        console.log(`      ${label} [${axis}] ${finding.message}`);
      }
    }
    return scenario;
  }

  summary() {
    const pass = this.scenarios.filter((s) => s.status === "pass").length;
    const partial = this.scenarios.filter((s) => s.status === "partial").length;
    const fail = this.scenarios.filter((s) => s.status === "fail").length;
    return { total: this.scenarios.length, pass, partial, fail };
  }
}

/** One HTTP call. Never throws on a non-2xx: the status is the finding. */
async function http(path, { method = "GET", body, token, raw = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { accept: "application/json" };
    if (body && !raw) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
      method,
      headers,
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body; callers inspect `text` */
    }
    return { status: response.status, json, text, data: json?.data, error: json?.error };
  } catch (error) {
    return { status: 0, json: null, text: "", error: { message: String(error?.message || error) } };
  } finally {
    clearTimeout(timer);
  }
}

/** Signs in and returns a bearer token, or null with the reason attached. */
async function login(email, password) {
  const response = await http("/auth/login", { method: "POST", body: { email, password } });
  return {
    token: response.data?.tokens?.accessToken || null,
    user: response.data?.user || null,
    status: response.status,
    error: response.error,
  };
}

/** An authenticated client bound to one user, so scenarios read like a person acting. */
function actor(token, label) {
  const call = (path, options = {}) => http(path, { ...options, token });
  return {
    label,
    token,
    get: (path) => call(path),
    post: (path, body) => call(path, { method: "POST", body }),
    patch: (path, body) => call(path, { method: "PATCH", body }),
    put: (path, body) => call(path, { method: "PUT", body }),
    del: (path) => call(path, { method: "DELETE" }),
  };
}

const money = (value) =>
  value && typeof value === "object" && typeof value.toNumber === "function"
    ? value.toNumber()
    : Number(value ?? 0);

/** Compares two amounts to the cent, so Decimal vs float never causes a false alarm. */
const sameMoney = (a, b, tolerance = 0.01) => Math.abs(money(a) - money(b)) <= tolerance;

module.exports = { prisma, Runner, Scenario, http, login, actor, money, sameMoney, API, BASE, green, red, yellow, dim };
