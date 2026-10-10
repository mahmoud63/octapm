/**
 * "Marina Bay Residences" — the project OctaPM is filmed on.
 *
 * The landing page hero is a screen recording of the real web app, so the
 * screens behind it have to look like a well-run job rather than a fixture: a
 * schedule with a proper critical path, a Setup Readiness card with nothing
 * red on it, earned value that moves, and registers that are not empty. The
 * seeded demo project cannot do that — it opens on blockers — and the only
 * richly driven project on this machine is the Phase 21 certification job,
 * whose name can never appear on camera.
 *
 * So this script builds one more project in the demo organisation, through
 * the public REST API, exactly as a team would:
 *
 *   the planner imports the programme from MS Project, it is reviewed,
 *   approved and activated; the QS loads the bill and maps it onto the
 *   programme; the PM approves the allocations; the cost controller loads the
 *   budget and the time-phased cost curve; the baseline is locked; the site
 *   engineer books progress and the PM approves it; the subcontract
 *   valuations, orders, variations, RFIs, inspections and daily logs that a
 *   job this far in would have are recorded behind it.
 *
 * Nothing here is a business rule: every figure is produced by the product's
 * own arithmetic from data posted through its own endpoints. The script only
 * decides what the job looks like.
 *
 *   node backend/scripts/demo/seed-showcase-project.js
 *
 * Safe to run again. The project is found by its name, and every record below
 * is found by a deterministic key before it is created, so a second run
 * advances the job by a reporting period rather than duplicating it. It never
 * touches another project.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("demo:showcase");

// ── the API, and the people who use it ──────────────────────────────────────
const API = process.env.SHOWCASE_API || "http://127.0.0.1:5000/api/v1";
const PASSWORD = process.env.SHOWCASE_PASSWORD || "DemoPassw0rd!";

const PEOPLE = {
  pm: "pm@octapm.demo",
  planner: "planner@octapm.demo",
  qs: "qs@octapm.demo",
  cost: "cost@octapm.demo",
  procurement: "procurement@octapm.demo",
  warehouse: "warehouse@octapm.demo",
  site: "site@octapm.demo",
  quality: "quality@octapm.demo",
  finance: "finance@octapm.demo",
};

/**
 * The project role each colleague holds on this job. The quality engineer has
 * no project-level role of her own — the API takes her company role, which is
 * the right answer rather than a gap.
 */
const TEAM = {
  planner: "planning_eng",
  qs: "qs",
  cost: "cost_controller",
  procurement: "procurement",
  warehouse: "warehouse",
  site: "site_engineer",
  quality: null,
  finance: "finance",
};

// ── the job ─────────────────────────────────────────────────────────────────
const PROJECT_NAME = "Marina Bay Residences";
const PROJECT_START = "2025-09-01";
const PROJECT_END = "2027-08-31";

/**
 * Everything is reported as at the end of the month the script runs in. That
 * is what makes a re-run meaningful rather than merely idempotent: next month
 * it opens the next reporting period, books the next valuation and moves the
 * curve, which is how the project would actually age between recordings.
 */
const AS_OF = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
})();

// The EV reads below use today's cutoff (UTC date): AS_OF is the end of the month, in the future.
const EV_CUTOFF = new Date().toISOString().slice(0, 10);

const CLIENT = "Marina Bay Development Partners";
const CONSULTANT = "Calder & Vance Architects";
const CONTRACTOR = "OctaPM Demo Contracting";
const FACADE_SUB = "Northline Facade Systems";
const MEP_SUB = "Arcadia Mechanical & Electrical";
const CONCRETE_SUB = "Delta Concrete Works";
const LIFT_SUPPLIER = "Vantage Vertical Transport";

/**
 * The company cost breakdown this job is run on. Thirteen codes so the cost
 * screen shows all seven cost categories rather than three.
 *
 * A cost code belongs to the company, not to one project: the script finds
 * each by its code and reuses whatever the library already holds, and never
 * renames somebody else's. That is why these codes avoid the plain
 * `NN-100` series — another project's codes sit there under other names, and
 * reusing them would label this job's piling budget "Blockwork".
 *
 *   code, name, cost type
 */
const COST_CODES = [
  ["01-110", "Preliminaries and site establishment", "indirect"],
  ["02-110", "Enabling works and demolition", "subcontract"],
  ["03-110", "Piling and substructure", "subcontract"],
  ["04-110", "Structural concrete and formwork", "material"],
  ["05-110", "Facade and envelope", "subcontract"],
  ["06-110", "MEP installation", "subcontract"],
  ["07-110", "Architectural fit-out", "subcontract"],
  ["08-110", "External works and landscaping", "subcontract"],
  ["09-110", "Site labour", "labour"],
  ["10-110", "Plant and equipment hire", "equipment"],
  ["11-110", "Head office overhead", "overhead"],
  ["12-110", "Risk contingency", "contingency"],
  ["13-110", "Testing, commissioning and handover", "other"],
];

/** What each budget line is for. The money on it is derived, below. */
const BUDGET_DESCRIPTION = {
  "01-110": "Site establishment, supervision and welfare",
  "02-110": "Enabling works and demolition subcontract",
  "03-110": "Piling, pile caps and basement subcontract",
  "04-110": "Concrete, reinforcement and formwork supply",
  "05-110": "Curtain wall and roofing subcontract",
  "06-110": "Mechanical, electrical and plumbing subcontract",
  "07-110": "Blockwork, finishes, joinery and lifts",
  "08-110": "Hardstanding, drainage and landscaping",
  "09-110": "Direct site labour and staff",
  "10-110": "Tower cranes, hoists and small plant",
  "11-110": "Head office recovery",
  "12-110": "Contract risk allowance",
  "13-110": "Commissioning, handover and defects",
};

/** The code that carries the risk allowance; nothing is ever booked to it. */
const CONTINGENCY_CODE = "12-110";
const CONTINGENCY_BUDGET = 450_000;
/** What a budget keeps over the cost it expects to incur. */
const BUDGET_HEADROOM = 0.02;

/**
 * The programme. One row per activity:
 *
 *   code, name, WBS branch, duration (working days), predecessors,
 *   category, cost code, and the bill item the activity carries.
 *
 * The network is a real building sequence, and its longest path runs
 * enabling -> substructure -> core and slabs -> MEP first fix -> fit-out ->
 * commissioning -> handover, so the Gantt shows a critical path through the
 * middle of the job with the facade, lift and external-works spurs carrying
 * float.
 */
const WBS = {
  EW: "1 Enabling works",
  SU: "2 Substructure",
  ST: "3 Superstructure",
  EN: "4 Envelope",
  ME: "5 MEP first fix",
  FO: "6 Fit-out",
  EX: "7 External works",
  HO: "8 Testing and handover",
};

const ACTIVITIES = [
  // code    name                                       wbs   dur  preds                 category      cost code  bill: code, description, qty, unit, rate
  ["A1000", "Site mobilisation and hoarding", "EW", 15, [], "civil", "01-110", ["01.010", "Site mobilisation, hoarding and temporary access", 1, "item", 480_000]],
  ["A1010", "Site clearance and demolition", "EW", 20, ["A1000"], "demolition", "02-110", ["01.020", "Clearance and demolition of existing slabs and structures", 12_500, "m2", 44]],
  ["A1020", "Temporary works and site accommodation", "EW", 12, ["A1000"], "civil", "01-110", ["01.030", "Site accommodation, temporary power and water", 1, "item", 320_000]],

  ["A1100", "Piling works", "SU", 40, ["A1010"], "civil", "03-110", ["02.010", "600mm CFA piles including cut-down and testing", 9_600, "m", 320]],
  ["A1110", "Pile caps and ground beams", "SU", 25, ["A1100"], "structural", "03-110", ["02.020", "Reinforced concrete pile caps and ground beams", 3_100, "m3", 520]],
  ["A1120", "Basement raft slab", "SU", 20, ["A1110"], "structural", "03-110", ["02.030", "Reinforced concrete raft slab to basement", 2_400, "m3", 545]],
  ["A1130", "Basement walls and waterproofing", "SU", 25, ["A1120"], "structural", "03-110", ["02.040", "Basement retaining walls with tanked waterproofing", 6_800, "m2", 310]],
  ["A1140", "Backfill and compaction", "SU", 12, ["A1130"], "civil", "03-110", ["02.050", "Imported granular fill placed and compacted in layers", 8_500, "m3", 62]],

  ["A1200", "Ground floor slab", "ST", 18, ["A1130"], "structural", "04-110", ["03.010", "Ground floor suspended slab and podium deck", 2_600, "m2", 295]],
  ["A1210", "Tower core levels 1 to 8", "ST", 35, ["A1200"], "structural", "04-110", ["03.020", "Slipformed reinforced concrete core, levels 1 to 8", 2_950, "m3", 610]],
  ["A1220", "Tower core levels 9 to 16", "ST", 35, ["A1210"], "structural", "04-110", ["03.030", "Slipformed reinforced concrete core, levels 9 to 16", 2_850, "m3", 615]],
  ["A1230", "Post-tensioned slabs levels 1 to 8", "ST", 40, ["A1210"], "structural", "04-110", ["03.040", "Post-tensioned floor slabs, levels 1 to 8", 12_800, "m2", 290]],
  ["A1240", "Post-tensioned slabs levels 9 to 16", "ST", 40, ["A1230", "A1220"], "structural", "04-110", ["03.050", "Post-tensioned floor slabs, levels 9 to 16", 12_400, "m2", 292]],
  ["A1250", "Roof slab and parapets", "ST", 18, ["A1240"], "structural", "04-110", ["03.060", "Roof slab, upstands and parapet walls", 1_650, "m2", 305]],

  ["A1300", "Curtain wall mock-up and approval", "EN", 25, ["A1230"], "finishing", "05-110", ["04.010", "Visual and performance mock-up of unitised curtain wall", 1, "item", 385_000]],
  ["A1310", "Facade installation levels 1 to 8", "EN", 45, ["A1300"], "finishing", "05-110", ["04.020", "Unitised curtain wall to levels 1 to 8", 8_600, "m2", 405]],
  ["A1320", "Facade installation levels 9 to 16", "EN", 45, ["A1310", "A1250"], "finishing", "05-110", ["04.030", "Unitised curtain wall to levels 9 to 16", 8_200, "m2", 408]],
  ["A1330", "Roofing and waterproofing", "EN", 20, ["A1250"], "finishing", "05-110", ["04.040", "Inverted warm roof with paving and edge detail", 1_850, "m2", 185]],

  ["A1400", "MEP builders work and sleeves", "ME", 25, ["A1230"], "mechanical", "06-110", ["05.010", "Builders work in connection with MEP, sleeves and penetrations", 1, "item", 640_000]],
  ["A1410", "MEP first fix levels 1 to 8", "ME", 45, ["A1400"], "mechanical", "06-110", ["05.020", "Mechanical, electrical and plumbing first fix, levels 1 to 8", 17_800, "m2", 152]],
  ["A1420", "MEP first fix levels 9 to 16", "ME", 45, ["A1410"], "mechanical", "06-110", ["05.030", "Mechanical, electrical and plumbing first fix, levels 9 to 16", 17_200, "m2", 154]],
  ["A1430", "Plant room equipment installation", "ME", 30, ["A1420"], "mechanical", "06-110", ["05.040", "Chillers, pumps, switchgear and generator installation", 1, "item", 1_180_000]],

  ["A1500", "Blockwork and partitions", "FO", 40, ["A1410"], "finishing", "07-110", ["06.010", "Blockwork and metal stud partitions to apartments", 24_500, "m2", 58]],
  ["A1510", "Plastering and screeds", "FO", 35, ["A1500"], "finishing", "07-110", ["06.020", "Internal plaster, render and floor screeds", 31_000, "m2", 34]],
  ["A1520", "Joinery and internal doors", "FO", 30, ["A1510"], "finishing", "07-110", ["06.030", "Apartment joinery, wardrobes and internal door sets", 620, "nr", 1_250]],
  ["A1530", "Painting and final finishes", "FO", 35, ["A1520"], "finishing", "07-110", ["06.040", "Decoration, floor finishes and sanitaryware", 46_000, "m2", 27]],
  ["A1540", "Lifts installation and commissioning", "FO", 40, ["A1430"], "electrical", "07-110", ["06.050", "Passenger and service lifts installed and commissioned", 6, "nr", 395_000]],

  ["A1600", "External works and hardstanding", "EX", 30, ["A1140"], "civil", "08-110", ["07.010", "External paving, kerbs, drainage and car park deck", 7_400, "m2", 115]],
  ["A1610", "Landscaping and soft works", "EX", 20, ["A1600"], "landscaping", "08-110", ["07.020", "Soft landscaping, irrigation and street furniture", 4_200, "m2", 105]],

  ["A1700", "Testing and commissioning", "HO", 25, ["A1530", "A1540", "A1320"], "inspection", "13-110", ["08.010", "Integrated systems testing and commissioning", 1, "item", 560_000]],
  ["A1710", "Snagging and de-snagging", "HO", 20, ["A1700"], "inspection", "13-110", ["08.020", "Snagging, de-snagging and client witness inspections", 1, "item", 240_000]],
  ["A1720", "Client handover and practical completion", "HO", 10, ["A1710"], "inspection", "13-110", ["08.030", "Operation manuals, training and handover documentation", 1, "item", 185_000]],
];

/**
 * Handover is the contract milestone the whole programme is measured to. It
 * keeps its ten-day duration — a milestone with no duration would give the
 * CPM a finish date equal to its start and fail the schedule's own date
 * sanity check — and is simply flagged as the key date, the way a planner
 * flags practical completion.
 */
const MILESTONES = new Set(["A1720"]);

const CONTRACT_VALUE = ACTIVITIES.reduce(
  (sum, row) => sum + row[7][2] * row[7][4],
  0,
);

/**
 * The cost budget, derived from the bill rather than typed.
 *
 * Each code carries the cost of the work mapped to it — the bill value less
 * the margin the tender carried on that package — plus its share of the
 * running costs, plus a little headroom. A budget typed independently of the
 * bill it pays for drifts the moment either changes, and a cost screen where
 * every package reads as overspent is worse than no cost screen at all.
 */
function packageCostByCode() {
  const packages = new Map();
  for (const [, , wbs, , , , costCode, bill] of ACTIVITIES) {
    const cost = bill[2] * bill[4] * PACKAGE_COST_FACTOR[wbs];
    packages.set(costCode, round2((packages.get(costCode) || 0) + cost));
  }
  return packages;
}

/** What the trade packages cost between them when the job is finished. */
function packageCostAtCompletion() {
  return [...packageCostByCode().values()].reduce((sum, value) => round2(sum + value), 0);
}

function buildBudget() {
  const packages = packageCostByCode();
  const packageTotal = packageCostAtCompletion();
  const runningCosts = round2(CONTRACT_VALUE / TARGET_CPI - packageTotal);
  if (runningCosts <= 0) {
    throw new Error(
      `the package cost factors leave nothing for preliminaries: ${money(packageTotal)} against ` +
        `${money(CONTRACT_VALUE / TARGET_CPI)} of expected cost`,
    );
  }

  const budget = new Map();
  for (const [code, cost] of packages) budget.set(code, round2(cost * (1 + BUDGET_HEADROOM)));
  for (const [code, , , , share] of OVERHEAD_SPLIT) {
    budget.set(code, round2((budget.get(code) || 0) + runningCosts * share));
  }
  budget.set(CONTINGENCY_CODE, CONTINGENCY_BUDGET);
  return budget;
}

/**
 * A job is never exactly on programme, and a demo that claims it is looks
 * fake. Two packages are behind the curve and one is a little ahead; every
 * other activity is progressed to exactly where the approved cost curve says
 * it should be, so SPI sits just under one for a reason that can be pointed
 * at on screen.
 */
const PROGRESS_VARIANCE = {
  A1310: -10, // facade: unitised panel deliveries ran late
  A1410: -6, // MEP first fix following the facade
  A1250: +5, // roof slab pulled forward to release the facade
};

/**
 * What each package costs as a share of the bill value it earns — the margin
 * the tender carried on that trade. These are the deliberate part of the cost
 * picture; the running costs below carry whatever is left over to bring the
 * project to TARGET_CPI, which is how a commercial manager reads a job
 * anyway: the packages are where the story is, and overhead absorbs the rest.
 *
 * CPI here is earned value over actual cost, and earned value is measured
 * against the bill — so a CPI above one is a job realising the margin it
 * tendered, not a job with a surplus. A showcase built at CPI 0.99 would be
 * quietly telling the viewer this contractor is losing money.
 */
const PACKAGE_COST_FACTOR = {
  EW: 0.88,
  SU: 0.85,
  ST: 0.86,
  EN: 0.9,
  ME: 0.88,
  FO: 0.85,
  EX: 0.84,
  HO: 0.86,
};
const TARGET_CPI = 1.08;

/**
 * The balance that preliminaries, labour, plant and overhead carry, split the
 * way a monthly cost report would split it: code, the activity it is posted
 * against, cost type, narrative, share.
 */
const OVERHEAD_SPLIT = [
  ["01-110", "A1000", "indirect", "Site establishment, supervision and welfare to date", 0.4],
  ["09-110", "A1210", "labour", "Direct site labour and staff to date", 0.25],
  ["10-110", "A1230", "equipment", "Tower crane, hoist and small plant hire to date", 0.2],
  ["11-110", "A1000", "overhead", "Head office recovery to date", 0.15],
];

// ── a small, loud API client ────────────────────────────────────────────────
/**
 * The Phase 21 harness taught this: a failed call has to say METHOD, PATH,
 * STATUS, the server's error code and the field errors behind "Validation
 * failed", or a seed fails twenty lines later with "cannot read property of
 * undefined" and the real cause is gone. Nothing is swallowed anywhere.
 */
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
    this.status = status;
    this.code = code;
    this.serverMessage = message;
    this.details = body?.error?.details ?? null;
  }
}

/** Well under the 15-minute access-token expiry: a long run never serves a stale one. */
const TOKEN_TTL_MS = 8 * 60_000;
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
  if (!token) throw new Error(`login ${email}: 200 but no access token came back`);
  tokens.set(email, { minted: Date.now(), token });
  return token;
}

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

/** The same request where the status is the answer, for "does this exist yet". */
async function probe(who, method, path, payload) {
  try {
    return { ok: true, status: 200, data: await call(who, method, path, payload) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, status: error.status, code: error.code, message: error.serverMessage, details: error.details };
    }
    throw error;
  }
}

const GET = (who, path) => call(who, "GET", path);
const POST = (who, path, payload = {}) => call(who, "POST", path, payload);
const PATCH = (who, path, payload = {}) => call(who, "PATCH", path, payload);
const PUT = (who, path, payload = {}) => call(who, "PUT", path, payload);

/** A binary body — the generated subcontract agreement, for countersignature. */
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

/** A multipart upload — the schedule import and the variation's instruction. */
async function upload(who, method, path, { field = "file", filename, contentType, body, fields = {} }) {
  const token = await login(who);
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append(field, new Blob([body], { type: contentType }), filename);

  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}` }, body: form });
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

// ── small helpers ───────────────────────────────────────────────────────────
const rows = (payload) =>
  Array.isArray(payload)
    ? payload
    : payload?.items ||
      payload?.rows ||
      payload?.orders ||
      payload?.records ||
      payload?.allocations ||
      payload?.periods ||
      payload?.lines ||
      payload?.entries ||
      [];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const iso = (date) => new Date(date).toISOString().slice(0, 10);
const money = (value) =>
  Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthEndOf = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
const monthStartOf = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const addMonth = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

let stepNumber = 0;
const step = (title) => {
  stepNumber += 1;
  console.log(`\n${"─".repeat(76)}\n${String(stepNumber).padStart(2, "0")}  ${title}\n${"─".repeat(76)}`);
};
const say = (label, value) =>
  console.log(`    ${label}${value === undefined ? "" : `: ${typeof value === "object" ? JSON.stringify(value) : value}`}`);

/**
 * Splits an activity's value across the months it is planned in, weighted by
 * the calendar days it occupies in each, and dated on the month end so it
 * lands in exactly one reporting period. The last month carries the rounding
 * so the spread adds back to the activity's value to the cent.
 */
function monthlySpread(start, finish, amount) {
  const buckets = [];
  let cursor = monthStartOf(start);
  while (cursor <= finish) {
    const end = monthEndOf(cursor);
    const from = cursor > start ? cursor : start;
    const to = end < finish ? end : finish;
    const days = Math.round((to - from) / 86_400_000) + 1;
    if (days > 0) buckets.push({ plannedDate: end, days });
    cursor = addMonth(cursor);
  }
  if (buckets.length === 0) return [{ plannedDate: monthEndOf(finish), plannedValue: round2(amount) }];

  const totalDays = buckets.reduce((sum, bucket) => sum + bucket.days, 0);
  let assigned = 0;
  buckets.forEach((bucket, index) => {
    if (index === buckets.length - 1) {
      bucket.plannedValue = round2(amount - assigned);
    } else {
      bucket.plannedValue = round2((amount * bucket.days) / totalDays);
      assigned = round2(assigned + bucket.plannedValue);
    }
    delete bucket.days;
  });
  return buckets;
}

/**
 * Total float per activity, in working days, from a forward and backward pass
 * over the finish-to-start network above.
 *
 * The product recalculates all of this itself the moment the revision is
 * activated and its answer is the one every screen reads. This pass exists
 * only so the exported file carries the float a real MS Project export would
 * carry: without it every task reads as zero float, and the schedule header —
 * which reports the revision's own count — would claim all thirty-two
 * activities are critical.
 */
function computeTotalFloat() {
  const byCode = new Map(ACTIVITIES.map((row) => [row[0], row]));
  const successors = new Map(ACTIVITIES.map((row) => [row[0], []]));
  for (const [code, , , , preds] of ACTIVITIES) {
    for (const pred of preds) successors.get(pred).push(code);
  }

  const earlyStart = new Map();
  const earlyFinish = new Map();
  for (const [code, , , duration, preds] of ACTIVITIES) {
    const start = preds.reduce((latest, pred) => Math.max(latest, earlyFinish.get(pred) ?? 0), 0);
    earlyStart.set(code, start);
    earlyFinish.set(code, start + duration);
  }
  const projectFinish = Math.max(...earlyFinish.values());

  const lateFinish = new Map();
  const lateStart = new Map();
  for (let index = ACTIVITIES.length - 1; index >= 0; index -= 1) {
    const [code, , , duration] = ACTIVITIES[index];
    const finish = successors
      .get(code)
      .reduce((earliest, succ) => Math.min(earliest, lateStart.get(succ) ?? projectFinish), projectFinish);
    lateFinish.set(code, finish);
    lateStart.set(code, finish - duration);
  }

  return new Map(
    ACTIVITIES.map(([code]) => [code, Math.max(0, lateStart.get(code) - earlyStart.get(code))]),
  );
}

/** MSPDI expresses slack in tenths of a minute; one eight-hour day is 4800. */
const TENTHS_OF_MINUTES_PER_DAY = 4800;

/**
 * The programme as an MSPDI file — the same thing the planner would export
 * from MS Project and drop on the import screen. Durations are working days
 * expressed in hours and slack in tenths of a minute, which is what the
 * parser reads. The dates are deliberately absent: the CPM engine works those
 * out from the project calendar when the revision is activated, and a file's
 * own dates should never be trusted over the product's.
 */
function buildProgrammeXml() {
  const uidOf = (code) => ACTIVITIES.findIndex((row) => row[0] === code) + 1;
  const totalFloat = computeTotalFloat();
  const tasks = ACTIVITIES.map(([code, name, wbs, duration, preds], index) => {
    const links = preds
      .map(
        (pred) =>
          `      <PredecessorLink><PredecessorUID>${uidOf(pred)}</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>`,
      )
      .join("\n");
    return [
      "    <Task>",
      `      <UID>${index + 1}</UID>`,
      `      <ID>${index + 1}</ID>`,
      `      <Name>${code} ${name}</Name>`,
      "      <Summary>0</Summary>",
      "      <Milestone>0</Milestone>",
      "      <OutlineLevel>2</OutlineLevel>",
      `      <WBS>${WBS[wbs]}</WBS>`,
      `      <Duration>PT${duration * 8}H0M0S</Duration>`,
      `      <TotalSlack>${totalFloat.get(code) * TENTHS_OF_MINUTES_PER_DAY}</TotalSlack>`,
      "      <PercentComplete>0</PercentComplete>",
      links,
    ]
      .filter(Boolean)
      .join("\n")
      .concat("\n    </Task>");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    `  <Name>${PROJECT_NAME}</Name>`,
    "  <Tasks>",
    ...tasks,
    "  </Tasks>",
    "</Project>",
    "",
  ].join("\n");
}

// ── the run ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${PROJECT_NAME} — showcase seed`);
  console.log(`API ${API}   reporting as at ${iso(AS_OF)}`);

  const { pm, planner, qs, cost, procurement, site, quality } = PEOPLE;

  // ── who everyone is ───────────────────────────────────────────────────────
  step("The organisation and its people");
  const userIds = {};
  let orgId = null;
  for (const [role, email] of Object.entries(PEOPLE)) {
    const me = await GET(email, "/auth/me");
    userIds[role] = me.id;
    if (role === "pm") orgId = me.orgId;
  }
  say("organisation", orgId);
  say("signed in", Object.keys(PEOPLE).join(", "));

  // ── the project ───────────────────────────────────────────────────────────
  step("The project");
  const portfolio = await GET(pm, `/projects?limit=100&search=${encodeURIComponent(PROJECT_NAME)}`);
  let project = rows(portfolio).find((row) => row.name === PROJECT_NAME) || null;

  if (project) {
    say("already exists, reusing", `${project.name} (${project.id})`);
  } else {
    project = await POST(pm, "/projects", {
      name: PROJECT_NAME,
      type: "Residential high-rise",
      location: "Marina Bay, Tampa, Florida",
      clientName: CLIENT,
      consultantName: CONSULTANT,
      contractorName: CONTRACTOR,
      contractType: "unit_rate",
      contractNumber: "MBR-2025-014",
      startDate: PROJECT_START,
      endDate: PROJECT_END,
      duration: 24,
      durationUnit: "months",
      currency: "USD",
      contractValue: CONTRACT_VALUE,
      defaultRetentionRate: 5,
      weatherAllowanceDays: 18,
      reportingCutoffDay: 25,
      projectCalendar: "five_day",
      status: "active",
    });
    say("created", `${project.name} (${project.id})`);
  }
  const P = project.id;
  say("contract value", money(CONTRACT_VALUE));

  // The data date is what the Gantt draws its progress line against.
  await PATCH(pm, `/projects/${P}`, { dataDate: iso(AS_OF) });

  // ── the team ──────────────────────────────────────────────────────────────
  step("The project team");
  const team = rows(await GET(pm, `/projects/${P}/team`));
  const onTeam = new Set(team.map((member) => member.userId));
  const assignable = rows(await GET(pm, `/projects/${P}/team/assignable`));
  const byEmail = new Map(assignable.map((user) => [user.email, user]));

  for (const [role, projectRole] of Object.entries(TEAM)) {
    const candidate = byEmail.get(PEOPLE[role]);
    if (!candidate) throw new Error(`${PEOPLE[role]} is not offered by /team/assignable`);
    if (onTeam.has(candidate.userId)) continue;
    await POST(pm, `/projects/${P}/team`, {
      userId: candidate.userId,
      ...(projectRole ? { role: projectRole } : {}),
    });
    say("added", `${PEOPLE[role]} as ${projectRole || "their company role"}`);
  }
  say("team size", rows(await GET(pm, `/projects/${P}/team`)).length);

  // ── the companies this job works with ─────────────────────────────────────
  step("The company directory");
  // The directory is company-wide and already holds other projects' parties,
  // so each name is looked for by name rather than paged through.
  const companies = {};
  const findCompany = async (name) =>
    rows(await GET(pm, `/companies?limit=100&search=${encodeURIComponent(name)}`)).find(
      (company) => company.name === name,
    ) || null;

  for (const name of [CLIENT, CONSULTANT, FACADE_SUB, MEP_SUB, CONCRETE_SUB, LIFT_SUPPLIER]) {
    let company = await findCompany(name);
    if (!company) {
      const created = await probe(pm, "POST", "/companies", {
        name,
        type: "external",
        email: `contact@${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example`,
        phone: "+1 813 555 0100",
        address: "Marina Bay, Tampa, Florida",
        status: "active",
      });
      // A name the directory search did not surface can still be taken.
      if (created.ok) company = created.data;
      else if (created.code === "COMPANY_EXISTS") company = await findCompany(name);
      else throw new Error(`company ${name}: ${created.status} ${created.code} ${created.message}`);
    }
    if (!company) throw new Error(`company ${name} exists but cannot be found in the directory`);
    companies[name] = company.id;
  }
  say("companies", Object.keys(companies).length);

  // ── cost codes ────────────────────────────────────────────────────────────
  step("Cost codes");
  const library = rows(await GET(pm, "/company/cost-codes?includeArchived=false"));
  const existingCodes = new Map(library.map((code) => [code.code, code]));
  const costCodeIds = {};
  for (const [code, name, category] of COST_CODES) {
    const found = existingCodes.get(code);
    costCodeIds[code] = found
      ? found.id
      : (await POST(pm, "/company/cost-codes", { code, name, category, status: "active" })).id;
  }
  await PUT(pm, `/projects/${P}/budget/cost-codes`, { costCodeIds: Object.values(costCodeIds) });
  say("selected onto the project", Object.keys(costCodeIds).length);

  // ── the programme ─────────────────────────────────────────────────────────
  step("The programme — imported, reviewed, approved, activated");
  let activityRows = rows(await GET(planner, `/projects/${P}/activities`));

  if (activityRows.length === 0) {
    const xml = Buffer.from(buildProgrammeXml(), "utf8");
    const imported = await upload(planner, "POST", `/projects/${P}/import/msp`, {
      filename: "marina-bay-residences-programme.xml",
      contentType: "application/xml",
      body: xml,
    });
    say("staged from MS Project", `${imported.imported} activities, ${imported.dependencyCount} links`);

    const revisionId = imported.revisionId;
    await POST(planner, `/projects/${P}/schedule/revisions/${revisionId}/submit-review`, {
      comment: "Tender programme rev 0 for review",
    });
    await POST(pm, `/projects/${P}/schedule/revisions/${revisionId}/approve`, {
      comment: "Approved as the contract programme",
    });
    await POST(pm, `/projects/${P}/schedule/revisions/${revisionId}/activate`, {
      mappings: [],
      unmappedRemovals: [],
      comment: "Contract programme activated",
    });
    say("activated", revisionId);
    activityRows = rows(await GET(planner, `/projects/${P}/activities`));
  } else {
    say("already on the project, reusing", `${activityRows.length} activities`);
  }

  // The import carries names, durations and logic; the codes, disciplines and
  // the engineer responsible for each activity are the planner's to add.
  const byName = new Map(activityRows.map((row) => [row.name, row]));
  const activityIds = {};
  for (const [code, name, , , , category] of ACTIVITIES) {
    const found = byName.get(`${code} ${name}`) || activityRows.find((row) => row.activityCode === code);
    if (!found) throw new Error(`the programme has no activity for ${code} ${name}`);
    activityIds[code] = found.id;
    if (
      found.activityCode === code &&
      found.category === category &&
      found.isMilestone === MILESTONES.has(code) &&
      found.assignments?.length
    ) {
      continue;
    }
    await PATCH(planner, `/projects/${P}/activities/${found.id}`, {
      name,
      activityCode: code,
      category,
      isMilestone: MILESTONES.has(code),
      engineerIds: [userIds.site],
    });
  }
  say("coded and assigned", Object.keys(activityIds).length);

  // ── how progress is measured ──────────────────────────────────────────────
  step("Progress methods");
  // Reading the method back is no test of whether one was configured: the
  // endpoint answers with the default an activity falls back to, while
  // official reporting counts only activities that have a method row of their
  // own. So every activity is upserted, which is idempotent anyway.
  for (const [code] of ACTIVITIES) {
    await PUT(planner, `/projects/${P}/activities/${activityIds[code]}/progress-method`, {
      method: "percent",
      evidenceRequired: false,
      inspectionRequired: false,
      notes: "Measured as a percentage of the bill value allocated to the activity.",
    });
  }
  say("configured", `${ACTIVITIES.length} activities measured on percent complete`);

  // ── the bill, and the money on the programme ──────────────────────────────
  step("The bill of quantities, mapped onto the programme");
  const existingBoq = rows(await GET(qs, `/projects/${P}/boq`));
  const boqByCode = new Map(existingBoq.map((item) => [item.code, item]));

  for (const [code, , , , , , , bill] of ACTIVITIES) {
    const [billCode, description, quantity, unit, rate] = bill;
    if (boqByCode.has(billCode)) continue;
    // Naming the activity on the row creates the allocation with it, which is
    // how a QS actually bills measured work: the quantity and the piece of
    // programme it belongs to are the same decision.
    await POST(qs, `/projects/${P}/boq/items`, {
      code: billCode,
      description,
      quantity,
      unit,
      rate,
      activityId: activityIds[code],
    });
  }
  const boqNow = rows(await GET(qs, `/projects/${P}/boq`));
  const boqIds = Object.fromEntries(boqNow.map((item) => [item.code, item.id]));
  const boqTotal = boqNow.reduce((sum, item) => round2(sum + Number(item.amount || 0)), 0);
  say("bill items", boqNow.length);
  say("bill total", money(boqTotal));
  if (Math.abs(boqTotal - CONTRACT_VALUE) > 0.01) {
    throw new Error(`the bill totals ${money(boqTotal)} but the contract is ${money(CONTRACT_VALUE)}`);
  }

  // Only an approved allocation carries earned value: a draft one is a
  // proposal about where the money sits, not a fact.
  step("Allocations approved");
  let approved = 0;
  for (const allocation of rows(await GET(planner, `/projects/${P}/activity-boq-allocations`))) {
    if (allocation.status === "approved") continue;
    if (allocation.status !== "submitted") {
      await POST(planner, `/projects/${P}/activity-boq-allocations/${allocation.id}/submit`, {});
    }
    await POST(pm, `/projects/${P}/activity-boq-allocations/${allocation.id}/approve`, {});
    approved += 1;
  }
  say("approved this run", approved);

  // ── the cost budget ───────────────────────────────────────────────────────
  step("The cost budget");
  const budgetLines = rows(await GET(cost, `/projects/${P}/budget/lines`));
  const budgetLineIds = {};
  for (const line of budgetLines) {
    const code = Object.entries(costCodeIds).find(([, id]) => id === line.costCodeId)?.[0];
    if (code) budgetLineIds[code] = line.id;
  }
  const budget = buildBudget();
  for (const [code, , costType] of COST_CODES) {
    if (budgetLineIds[code]) continue;
    const originalBudget = budget.get(code);
    if (originalBudget === undefined) throw new Error(`no budget was derived for cost code ${code}`);
    const created = await POST(cost, `/projects/${P}/budget/lines`, {
      costCodeId: costCodeIds[code],
      costType,
      description: BUDGET_DESCRIPTION[code],
      originalBudget,
      status: "active",
    });
    budgetLineIds[code] = created.id;
  }
  const budgetTotal = [...budget.values()].reduce((sum, value) => round2(sum + value), 0);
  say("budget lines", Object.keys(budgetLineIds).length);
  say(
    "cost budget",
    `${money(budgetTotal)} against a contract of ${money(CONTRACT_VALUE)} — ` +
      `${(((CONTRACT_VALUE - budgetTotal) / CONTRACT_VALUE) * 100).toFixed(1)}% margin`,
  );

  // ── the baseline ──────────────────────────────────────────────────────────
  step("The baseline");
  const revisions = rows(await GET(planner, `/projects/${P}/schedule/revisions`));
  const baselined = revisions.find((revision) => revision.status === "baselined");
  if (baselined) {
    say("already locked", baselined.id);
  } else {
    const current = revisions.find((revision) => revision.status === "approved" || revision.isActive);
    if (!current) throw new Error("no approved schedule revision to baseline");
    await POST(pm, `/projects/${P}/schedule/revisions/${current.id}/baseline`, {
      comment: "Contract baseline locked after bill allocation and budget load",
    });
    say("locked", current.id);
  }

  // ── the time-phased cost curve ────────────────────────────────────────────
  step("Reporting periods and the approved cost curve");
  const scheduled = rows(await GET(planner, `/projects/${P}/activities`));
  const scheduleByCode = new Map(scheduled.map((row) => [row.activityCode, row]));

  const periodsExisting = rows(await GET(cost, `/projects/${P}/reports/periods`));
  const periodByCode = new Map(periodsExisting.map((period) => [period.code, period]));
  let cursor = monthStartOf(new Date(`${PROJECT_START}T00:00:00.000Z`));
  const periods = [];
  while (cursor <= AS_OF) {
    const end = monthEndOf(cursor);
    const code = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}`;
    let period = periodByCode.get(code);
    if (!period) {
      period = await POST(cost, `/projects/${P}/reports/periods`, {
        code,
        label: end.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
        periodStart: iso(cursor),
        periodEnd: iso(end),
        cutoffDate: iso(end),
      });
    }
    periods.push(period);
    cursor = addMonth(cursor);
  }
  say("reporting periods", `${periods.length}, latest ${periods[periods.length - 1].code}`);

  const periodIdByCode = new Map(periods.map((period) => [period.code, period.id]));
  const existingLoadings = rows(await GET(cost, `/projects/${P}/reports/cost-loading`));
  const loadedActivities = new Set(existingLoadings.map((row) => row.activityId));

  const allocationAmount = new Map();
  for (const allocation of rows(await GET(planner, `/projects/${P}/activity-boq-allocations`))) {
    if (allocation.status !== "approved") continue;
    allocationAmount.set(
      allocation.activityId,
      round2((allocationAmount.get(allocation.activityId) || 0) + Number(allocation.amount || 0)),
    );
  }

  let loadingRows = 0;
  const plannedToDate = new Map();
  const plannedTotal = new Map();
  for (const [code] of ACTIVITIES) {
    const activity = scheduleByCode.get(code);
    const activityId = activityIds[code];
    const amount = allocationAmount.get(activityId) || 0;
    if (!activity?.startDate || !activity?.endDate || !amount) continue;

    const spread = monthlySpread(new Date(activity.startDate), new Date(activity.endDate), amount);
    plannedTotal.set(code, amount);
    plannedToDate.set(
      code,
      spread.filter((bucket) => bucket.plannedDate <= AS_OF).reduce((sum, bucket) => round2(sum + bucket.plannedValue), 0),
    );

    if (loadedActivities.has(activityId)) continue;
    for (const bucket of spread) {
      if (bucket.plannedValue <= 0) continue;
      const periodCode = `${bucket.plannedDate.getUTCFullYear()}-${String(bucket.plannedDate.getUTCMonth() + 1).padStart(2, "0")}`;
      const created = await POST(cost, `/projects/${P}/reports/cost-loading`, {
        activityId,
        reportingPeriodId: periodIdByCode.get(periodCode) || null,
        plannedDate: iso(bucket.plannedDate),
        plannedValue: bucket.plannedValue,
        status: "submitted",
        source: "manual",
        baselineVersion: "Contract baseline",
      });
      await POST(pm, `/projects/${P}/reports/cost-loading/${created.id}/approve`, {});
      loadingRows += 1;
    }
  }
  say("cost loading rows created and approved", loadingRows);

  // ── progress ──────────────────────────────────────────────────────────────
  step("Progress booked by site and approved by the PM");
  const currentPct = new Map(scheduled.map((row) => [row.activityCode, Number(row.pctComplete || 0)]));
  let booked = 0;
  const behind = [];
  for (const [code] of ACTIVITIES) {
    const total = plannedTotal.get(code) || 0;
    if (!total) continue;
    const planned = ((plannedToDate.get(code) || 0) / total) * 100;
    const variance = PROGRESS_VARIANCE[code] || 0;
    const target = Math.max(0, Math.min(100, Math.round(planned) + variance));
    if (variance < 0 && target > 0) behind.push(`${code} ${target}% against ${Math.round(planned)}% planned`);
    if (target <= 0 || target === currentPct.get(code)) continue;

    await POST(site, `/projects/${P}/activities/${activityIds[code]}/progress`, {
      pctComplete: target,
      progressMethod: "percent",
      status: "submitted",
      source: "manual",
      notes: `Measured on site for the period to ${iso(AS_OF)}`,
    });
    const submissions = rows(await GET(pm, `/projects/${P}/activities/${activityIds[code]}/progress-submissions`));
    const open = submissions.find((row) => row.status === "submitted" || row.status === "pending");
    if (open) {
      await POST(pm, `/projects/${P}/activities/${activityIds[code]}/progress-submissions/${open.id}/approve`, {});
    }
    booked += 1;
  }
  say("activities progressed this run", booked);
  for (const line of behind) say("  behind programme", line);

  // ── actual cost ───────────────────────────────────────────────────────────
  step("Subcontract valuations and the cost to date");
  // What each activity has earned, by the rule the EV report states for
  // itself: approved allocation value times approved percent complete. The
  // report's own activity breakdown is a top-twenty view and would quietly
  // leave the smaller packages out of the costing below, so the figures are
  // worked out per activity here and then checked against the report's total.
  const progressed = rows(await GET(planner, `/projects/${P}/activities`));
  const earnedByActivity = new Map();
  for (const activity of progressed) {
    const allocated = allocationAmount.get(activity.id) || 0;
    if (!allocated) continue;
    earnedByActivity.set(activity.activityCode, round2((allocated * Number(activity.pctComplete || 0)) / 100));
  }
  // Read EV at today's cutoff: the report's default period is the last closed month, whose cutoff
  // is before today's approvals, so its EV is 0 until the month closes.
  const evNow = await GET(cost, `/projects/${P}/reports/ev?cutoffDate=${EV_CUTOFF}`);
  const earnedTotal = round2(Number(evNow.ev || 0));
  const earnedHere = [...earnedByActivity.values()].reduce((sum, value) => round2(sum + value), 0);
  if (Math.abs(earnedHere - earnedTotal) > 1) {
    throw new Error(
      `earned value worked out here is ${money(earnedHere)} but the product reports ${money(earnedTotal)}`,
    );
  }

  const bookedSoFar = new Map(
    rows(await GET(cost, `/projects/${P}/cost/summary`)).map((row) => [row.activityId, Number(row.actual || 0)]),
  );

  // What each package should have cost by now, and what preliminaries,
  // labour, plant and overhead have to carry for the project to read at the
  // cost performance this showcase is set to.
  const targetByActivity = new Map();
  let packageTarget = 0;
  for (const [code, , wbs] of ACTIVITIES) {
    const earned = earnedByActivity.get(code) || 0;
    if (earned <= 0) continue;
    const target = round2(earned * PACKAGE_COST_FACTOR[wbs]);
    targetByActivity.set(code, target);
    packageTarget = round2(packageTarget + target);
  }
  const overheadTarget = round2(earnedTotal / TARGET_CPI - packageTarget);
  if (earnedTotal > 0 && (overheadTarget < earnedTotal * 0.02 || overheadTarget > earnedTotal * 0.12)) {
    throw new Error(
      `preliminaries would have to carry ${money(overheadTarget)} against ${money(earnedTotal)} earned — ` +
        "adjust PACKAGE_COST_FACTOR rather than letting the overhead absorb an implausible balance",
    );
  }

  const invoiceMonth = `${AS_OF.getUTCFullYear()}-${String(AS_OF.getUTCMonth() + 1).padStart(2, "0")}`;
  const packageLines = new Map();
  for (const [code, name, wbs, , , , costCode] of ACTIVITIES) {
    const target = targetByActivity.get(code);
    if (target === undefined) continue;
    const already = bookedSoFar.get(activityIds[code]) || 0;
    const due = round2(target - already);
    if (due <= 0.5) continue;
    const list = packageLines.get(wbs) || [];
    list.push({
      description: `${code} ${name} — value of work to ${iso(AS_OF)}`,
      costCodeId: costCodeIds[costCode],
      budgetLineId: budgetLineIds[costCode],
      activityId: activityIds[code],
      costType: COST_CODES.find((row) => row[0] === costCode)[2],
      quantity: 1,
      unit: "sum",
      unitCost: due,
      amount: due,
    });
    packageLines.set(wbs, list);
  }

  // The balance, split across the running costs that do not belong to any one
  // package but are still posted against the activity they were spent on.
  //
  // These cannot be measured against the activity's booked cost the way a
  // package can — preliminaries sit on the same activity as the enabling
  // works — so what has already been booked is read back from the expenses
  // themselves, which carry a reference of their own. Without that, a second
  // month would re-post the whole running cost instead of the month's share.
  const expenses = rows(await GET(cost, `/projects/${P}/direct-costs?limit=100`));
  const bookedOverhead = new Map();
  for (const row of expenses) {
    const reference = String(row.invoiceNumber || "");
    const code = OVERHEAD_SPLIT.map(([costCode]) => costCode).find((costCode) =>
      reference.startsWith(`MBR-${costCode}-`),
    );
    if (!code || row.status === "rejected" || row.status === "void") continue;
    bookedOverhead.set(code, round2((bookedOverhead.get(code) || 0) + Number(row.total ?? 0)));
  }

  for (const [costCode, activityCode, costType, description, share] of OVERHEAD_SPLIT) {
    const target = round2(overheadTarget * share);
    const key = `OH:${costCode}`;
    const already = bookedOverhead.get(costCode) || 0;
    const due = round2(target - already);
    if (due <= 0.5) continue;
    packageLines.set(key, [
      {
        description,
        costCodeId: costCodeIds[costCode],
        budgetLineId: budgetLineIds[costCode],
        activityId: activityIds[activityCode],
        costType,
        quantity: 1,
        unit: "sum",
        unitCost: due,
        amount: due,
      },
    ]);
  }

  const PACKAGE_LABEL = {
    EW: ["Enabling works", CONCRETE_SUB],
    SU: ["Substructure", CONCRETE_SUB],
    ST: ["Superstructure", CONCRETE_SUB],
    EN: ["Envelope", FACADE_SUB],
    ME: ["MEP first fix", MEP_SUB],
    FO: ["Fit-out", LIFT_SUPPLIER],
    EX: ["External works", CONCRETE_SUB],
    HO: ["Testing and handover", MEP_SUB],
  };

  let invoices = 0;
  for (const [key, lines] of packageLines) {
    if (lines.length === 0) continue;
    const overhead = key.startsWith("OH:");
    const costCode = key.slice(3);
    const [label, vendor] = overhead
      ? [BUDGET_DESCRIPTION[costCode], null]
      : PACKAGE_LABEL[key];
    const invoiceNumber = `MBR-${overhead ? costCode : key}-${invoiceMonth}`;
    const attempt = await probe(cost, "POST", `/projects/${P}/direct-costs`, {
      type: overhead ? "expense" : "invoice",
      description: `${label} — ${overhead ? "cost" : "valuation"} for the period to ${iso(AS_OF)}`,
      vendorCompanyId: overhead ? null : companies[vendor],
      vendorName: overhead ? CONTRACTOR : undefined,
      invoiceNumber,
      costDate: iso(AS_OF),
      lines,
    });
    if (!attempt.ok) {
      if (attempt.code === "DIRECT_COST_DUPLICATE_INVOICE") continue;
      throw new Error(`${invoiceNumber}: ${attempt.status} ${attempt.code} ${attempt.message}`);
    }
    await POST(cost, `/projects/${P}/direct-costs/${attempt.data.id}/submit`, {});
    await POST(pm, `/projects/${P}/direct-costs/${attempt.data.id}/approve`, {});
    invoices += 1;
  }
  say("valuations posted this run", invoices);

  /**
   * The cost controller's forecast of what each activity finishes at.
   *
   * Without one, the cost screen falls back to the greater of an activity's
   * budget and what it has spent — and an activity's budget there is the bill
   * value allocated to it, which is revenue, not cost. The project would then
   * forecast itself at the contract sum and read as overspent against its own
   * cost budget for the whole job. The forecast is the package cost of the
   * work, plus the running costs the activity carries.
   */
  const runningAtCompletion = new Map();
  for (const [, activityCode, , , share] of OVERHEAD_SPLIT) {
    const atCompletion = round2((CONTRACT_VALUE / TARGET_CPI - packageCostAtCompletion()) * share);
    runningAtCompletion.set(
      activityCode,
      round2((runningAtCompletion.get(activityCode) || 0) + atCompletion),
    );
  }

  let forecasts = 0;
  const recorded = new Map(
    rows(await GET(cost, `/projects/${P}/cost/summary`)).map((row) => [row.activityId, Number(row.forecast || 0)]),
  );
  for (const [code, , wbs, , , , , bill] of ACTIVITIES) {
    const forecast = round2(
      bill[2] * bill[4] * PACKAGE_COST_FACTOR[wbs] + (runningAtCompletion.get(code) || 0),
    );
    if (Math.abs((recorded.get(activityIds[code]) || 0) - forecast) < 0.5) continue;
    await POST(cost, `/projects/${P}/cost/activity/${activityIds[code]}`, { forecast });
    forecasts += 1;
  }
  say("forecasts set this run", forecasts);

  // ── the registers behind the numbers ──────────────────────────────────────
  await seedProcurement({ P, companies, activityIds, costCodeIds });
  await seedCommitments({ P, companies, activityIds, costCodeIds, budgetLineIds, boqIds });
  await seedCommercial({ P, activityIds, budgetLineIds, userIds });
  await seedCorrespondence({ P, activityIds, userIds });
  await seedQuality({ P, activityIds, userIds });
  await seedField({ P, activityIds, companies });
  await seedRisks({ P, activityIds });

  // ── what a stranger sees ──────────────────────────────────────────────────
  step("What the screens will show");
  const readiness = await GET(pm, `/projects/${P}/setup-readiness`);
  for (const stepRow of readiness.steps) {
    say(`${stepRow.label.padEnd(30)} ${stepRow.status.padEnd(10)}`, stepRow.message);
  }
  const ev = await GET(cost, `/projects/${P}/reports/ev?cutoffDate=${EV_CUTOFF}`);
  say("reporting period", ev.reporting?.period?.code ?? `cutoff ${EV_CUTOFF}`);
  say("BAC", money(ev.totalBudget ?? 0));
  say("PV ", money(ev.pv ?? 0));
  say("EV ", money(ev.ev ?? 0));
  say("AC ", money(ev.ac ?? 0));
  say("SPI", Number(ev.spi ?? 0).toFixed(3));
  say("CPI", Number(ev.cpi ?? 0).toFixed(3));
  say("EAC", money(ev.eac ?? 0));

  console.log(`\n${PROJECT_NAME}`);
  console.log(`  project id   ${P}`);
  console.log(`  overview     /projects/${P}/overview`);
  console.log(`  schedule     /projects/${P}/schedule/gantt`);
  console.log(`  cost         /projects/${P}/cost/overview`);
  console.log(`  commercial   /projects/${P}/commercial/change-orders`);
  console.log(`  procurement  /projects/${P}/procurement/purchase-orders`);
  console.log("");
  return readiness.summary.blockedSteps;
}

// ── the registers ───────────────────────────────────────────────────────────
/** Three orders in the states a job this far in would have them. */
async function seedProcurement({ P, companies, activityIds, costCodeIds }) {
  step("Procurement");
  const { pm, procurement } = PEOPLE;
  const existing = rows(await GET(procurement, `/projects/${P}/purchase-orders?limit=100`));
  const byRef = new Map(existing.map((order) => [order.ref, order]));

  // An order names a supplier on this project, not a company in the
  // directory: the two are deliberately different records, so each trade
  // contractor is registered on the job before it can be ordered from.
  const registered = rows(await GET(procurement, `/projects/${P}/procurement/suppliers`));
  const supplierIds = {};
  for (const [name, trade] of [
    [FACADE_SUB, "facade"],
    [MEP_SUB, "mep"],
    [LIFT_SUPPLIER, "lifts"],
  ]) {
    const found = registered.find((supplier) => supplier.name === name);
    supplierIds[name] = found
      ? found.id
      : (
          await POST(procurement, `/projects/${P}/procurement/suppliers`, {
            companyId: companies[name],
            name,
            status: "approved",
            tradeCategories: [trade],
            leadTimeReliability: 92,
          })
        ).id;
  }

  const ORDERS = [
    {
      ref: "MBR-PO-0014",
      supplier: FACADE_SUB,
      activity: "A1320",
      costCode: "05-110",
      orderDate: "2026-05-18",
      requiredBy: "2026-11-30",
      line: ["Unitised curtain wall panels, levels 9 to 16", "m2", 8_200, 268],
      issue: true,
    },
    {
      ref: "MBR-PO-0021",
      supplier: MEP_SUB,
      activity: "A1430",
      costCode: "06-110",
      orderDate: "2026-07-02",
      requiredBy: "2027-01-15",
      line: ["Chillers, pumps and switchgear for the main plant room", "set", 1, 742_000],
      issue: true,
    },
    {
      ref: "MBR-PO-0026",
      supplier: LIFT_SUPPLIER,
      activity: "A1540",
      costCode: "07-110",
      orderDate: "2026-09-08",
      requiredBy: "2027-02-28",
      line: ["Passenger and service lift cars, machines and controllers", "nr", 6, 268_000],
      issue: false,
    },
  ];

  let created = 0;
  for (const order of ORDERS) {
    if (byRef.has(order.ref)) continue;
    const [description, unit, orderedQty, unitCost] = order.line;
    const raised = await POST(procurement, `/projects/${P}/procurement/purchase-orders`, {
      ref: order.ref,
      supplierId: supplierIds[order.supplier],
      status: "draft",
      currency: "USD",
      orderDate: order.orderDate,
      requiredBy: order.requiredBy,
      lines: [
        {
          lineNumber: 1,
          activityId: activityIds[order.activity],
          costCodeId: costCodeIds[order.costCode],
          description,
          unit,
          orderedQty,
          unitCost,
        },
      ],
    });
    await POST(procurement, `/projects/${P}/purchase-orders/${raised.id}/submit`, {});
    await POST(pm, `/projects/${P}/purchase-orders/${raised.id}/approve`, {});
    if (order.issue) await POST(procurement, `/projects/${P}/purchase-orders/${raised.id}/issue`, {});
    created += 1;
  }
  say("purchase orders", `${created} raised this run, ${rows(await GET(procurement, `/projects/${P}/purchase-orders?limit=100`)).length} on the register`);
}

/**
 * The two trade packages that are let as subcontracts. They are executed but
 * not yet certified, which is what the cost screen's committed figure means:
 * money the project is contractually obliged to spend and has not spent.
 */
async function seedCommitments({ P, companies, activityIds, costCodeIds, budgetLineIds, boqIds }) {
  step("Subcontracts");
  const { pm, qs } = PEOPLE;
  const existing = rows(await GET(qs, `/projects/${P}/commitments?limit=100`));

  const PACKAGES = [
    {
      title: "Facade and envelope subcontract",
      description: "Supply and install the unitised curtain wall and roofing package",
      vendor: FACADE_SUB,
      costCode: "05-110",
      startDate: "2026-04-01",
      endDate: "2027-04-30",
      lines: [
        ["Unitised curtain wall, levels 1 to 8", "A1310", "04.020", "m2", 8_600, 355],
        ["Unitised curtain wall, levels 9 to 16", "A1320", "04.030", "m2", 8_200, 358],
      ],
    },
    {
      title: "Mechanical, electrical and plumbing subcontract",
      description: "MEP first and second fix, plant room installation and commissioning",
      vendor: MEP_SUB,
      costCode: "06-110",
      startDate: "2026-06-01",
      endDate: "2027-06-30",
      lines: [
        ["MEP first fix, levels 1 to 8", "A1410", "05.020", "m2", 17_800, 133],
        ["MEP first fix, levels 9 to 16", "A1420", "05.030", "m2", 17_200, 135],
      ],
    },
  ];

  let executed = 0;
  for (const item of PACKAGES) {
    let commitment = existing.find((row) => row.title === item.title) || null;
    if (!commitment) {
      commitment = await POST(qs, `/projects/${P}/commitments`, {
        type: "subcontract",
        title: item.title,
        description: item.description,
        vendorCompanyId: companies[item.vendor],
        retentionRate: 5,
        currency: "USD",
        startDate: item.startDate,
        endDate: item.endDate,
        lines: item.lines.map(([description, activity, billCode, unit, qty, rate], index) => ({
          lineNumber: index + 1,
          description,
          costCodeId: costCodeIds[item.costCode],
          budgetLineId: budgetLineIds[item.costCode],
          boqItemId: boqIds[billCode],
          activityId: activityIds[activity],
          unit,
          qty,
          rate,
          amount: qty * rate,
        })),
      });
    }
    if (commitment.status === "executed" || commitment.status === "closed") continue;

    for (const [transition, who] of [["submit", qs], ["approve", pm]]) {
      const res = await probe(who, "POST", `/projects/${P}/commitments/${commitment.id}/${transition}`, {});
      if (!res.ok && res.status !== 409) {
        throw new Error(`${item.title} ${transition}: ${res.status} ${res.code} ${res.message}`);
      }
    }

    // Execution takes the signed agreement itself, not a tickbox saying it
    // was signed, so the assembled agreement goes back up countersigned.
    const agreement = await download(qs, `/projects/${P}/commitments/${commitment.id}/agreement.pdf`);
    await upload(pm, "POST", `/projects/${P}/commitments/${commitment.id}/execute`, {
      field: "file",
      filename: `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-signed.pdf`,
      contentType: "application/pdf",
      body: agreement,
      fields: { note: "Countersigned by both parties" },
    });
    executed += 1;
  }

  const register = rows(await GET(qs, `/projects/${P}/commitments?limit=100`));
  const committed = register
    .filter((row) => row.status === "executed")
    .reduce((sum, row) => round2(sum + Number(row.revised ?? row.original ?? 0)), 0);
  say("subcontracts", `${executed} executed this run, ${register.length} on the register`);
  say("executed commitment value", money(committed));
}

/** One variation instructed and agreed, one still with the client. */
async function seedCommercial({ P, activityIds, budgetLineIds }) {
  step("Commercial");
  const { pm, qs } = PEOPLE;
  const register = rows(await GET(qs, `/projects/${P}/change-orders?limit=100`));

  const APPROVED = "Client instruction 12: upgrade apartment glazing to acoustic double-glazed units, levels 9 to 16";
  const PENDING = "Additional basement drainage and sump pumps following the revised groundwater survey";
  const found = (description) => register.find((order) => order.description === description) || null;

  // A variation is looked up by what it is for, then driven to the state it
  // should be in: a half-finished record from an interrupted run is finished
  // rather than skipped over as if it were done.
  let change = found(APPROVED);
  if (change?.status !== "approved") {
    change = change || (await POST(qs, `/projects/${P}/change-orders`, {
      description: APPROVED,
      activityId: activityIds.A1320,
      budgetLineId: budgetLineIds["05-110"],
      value: 185_000,
      scheduleImpact: 5,
    }));
    await PATCH(qs, `/projects/${P}/change-orders/${change.id}`, {
      scheduleImpactSummary:
        "Five working days on facade installation to levels 9 to 16 (A1320). The package holds float against testing and commissioning, so the completion date does not move.",
      costImpactSummary:
        "185,000.00 for the acoustic upgrade: 8,200 m2 of unitised curtain wall at an agreed uplift of 22.56 per m2.",
      activityLinks: [
        {
          activityId: activityIds.A1320,
          relationType: "impacted",
          scheduleImpactDays: 5,
          costImpact: 185_000,
          notes: "Acoustic glazing upgrade to the upper levels",
        },
      ],
    });
    const instruction = Buffer.from(
      "CLIENT INSTRUCTION 12\n\n" +
        `Project: ${PROJECT_NAME}\n` +
        "Upgrade apartment glazing to acoustic double-glazed units, levels 9 to 16.\n" +
        "Agreed uplift 22.56 per m2 over 8,200 m2 = 185,000.00\n" +
        "Programme effect: 5 working days, absorbed in facade float.\n",
      "utf8",
    );
    const attached = await upload(qs, "POST", `/projects/${P}/attachments`, {
      field: "files",
      filename: "client-instruction-12.txt",
      contentType: "text/plain",
      body: instruction,
      fields: { recordType: "change_order", recordId: change.id, caption: "Client instruction 12" },
    });
    const documentId = rows(attached)[0]?.documentId ?? rows(attached)[0]?.id ?? null;
    if (!documentId) throw new Error("the instruction uploaded but no document id came back");
    await PATCH(qs, `/projects/${P}/change-orders/${change.id}`, { documentIds: [documentId] });
    await POST(qs, `/projects/${P}/change-orders/${change.id}/submit`, { comment: "For the client's approval" });
    await POST(pm, `/projects/${P}/change-orders/${change.id}/approve`, { comment: "Instructed under CI-12" });
    say("approved variation", "185,000.00 acoustic glazing upgrade");
  }

  let pending = found(PENDING);
  if (!pending || pending.status === "draft") {
    pending = pending || (await POST(qs, `/projects/${P}/change-orders`, {
      description: PENDING,
      activityId: activityIds.A1130,
      budgetLineId: budgetLineIds["03-110"],
      value: 96_500,
      scheduleImpact: 0,
    }));
    await PATCH(qs, `/projects/${P}/change-orders/${pending.id}`, {
      scheduleImpactSummary: "No programme effect: the work is carried out within the basement fit-out window.",
      costImpactSummary: "96,500.00 for additional sump pumps, chambers and drainage runs to the lower basement.",
      activityLinks: [
        {
          activityId: activityIds.A1130,
          relationType: "impacted",
          scheduleImpactDays: 0,
          costImpact: 96_500,
          notes: "Additional drainage to the lower basement",
        },
      ],
    });
    // A variation may not even be put to the client without the evidence it is
    // argued from — the same rule that governs approval.
    const survey = Buffer.from(
      "GROUNDWATER SURVEY ADDENDUM\n\n" +
        `Project: ${PROJECT_NAME}\n` +
        "Standing water level recorded 1.4m above the level assumed at tender across boreholes BH-4 to BH-7.\n" +
        "Recommendation: two additional sump chambers and duty/standby pumps to the lower basement.\n" +
        "Estimated cost effect: 96,500.00\n",
      "utf8",
    );
    const surveyAttachment = await upload(qs, "POST", `/projects/${P}/attachments`, {
      field: "files",
      filename: "groundwater-survey-addendum.txt",
      contentType: "text/plain",
      body: survey,
      fields: { recordType: "change_order", recordId: pending.id, caption: "Groundwater survey addendum" },
    });
    const surveyId = rows(surveyAttachment)[0]?.documentId ?? rows(surveyAttachment)[0]?.id ?? null;
    if (!surveyId) throw new Error("the survey uploaded but no document id came back");
    await PATCH(qs, `/projects/${P}/change-orders/${pending.id}`, { documentIds: [surveyId] });
    await POST(qs, `/projects/${P}/change-orders/${pending.id}/submit`, { comment: "For the client's consideration" });
    say("variation with the client", "96,500.00 basement drainage");
  }
}

/** A short RFI register: one answered and closed, one answered, one still open. */
async function seedCorrespondence({ P, activityIds, userIds }) {
  step("RFIs");
  const { pm, planner, qs, site } = PEOPLE;
  const existing = rows(await GET(site, `/projects/${P}/rfi?limit=100&includeArchived=true`));
  const bySubject = new Map(existing.map((rfi) => [rfi.subject, rfi]));

  const RFIS = [
    {
      subject: "Curtain wall bracket fixing at the level 9 slab edge",
      question:
        "The slab edge at level 9 is 40mm out of tolerance against drawing A-204 rev C. Confirm whether the facade bracket is to be shimmed or the slab edge ground back before the panels are set.",
      discipline: "structural",
      activity: "A1320",
      raisedDate: "2026-08-11",
      responseRequiredBy: "2026-08-20",
      answer:
        "Shim the bracket with stainless packers to a maximum of 45mm and record each location on the as-built survey. Do not grind the slab edge; the post-tensioning anchorage sits within 120mm.",
      answeredDate: "2026-08-18",
      close: true,
    },
    {
      subject: "Riser penetration sizes for the level 5 to 8 MEP first fix",
      question:
        "Coordinated services in the east riser exceed the penetration sizes shown on S-310. Confirm the revised opening sizes and any additional trimming steel required.",
      discipline: "mechanical",
      activity: "A1410",
      raisedDate: "2026-09-07",
      responseRequiredBy: "2026-09-18",
      answer:
        "Openings may be increased to 600 x 400mm with 100 x 100 x 10 trimming angle all round, as detailed on S-310 rev D issued with this response.",
      answeredDate: "2026-09-15",
      close: false,
    },
    {
      subject: "Acoustic rating of the apartment separating walls at level 6",
      question:
        "The specification calls for 54dB DnT,w between apartments. Confirm whether the current blockwork build-up with a single resilient layer achieves this, or whether an independent lining is required.",
      discipline: "architectural",
      activity: "A1500",
      raisedDate: "2026-09-21",
      responseRequiredBy: "2026-10-02",
      answer: null,
      close: false,
    },
  ];

  let raised = 0;
  for (const item of RFIS) {
    let rfi = bySubject.get(item.subject);
    if (!rfi) {
      rfi = await POST(site, `/projects/${P}/rfi`, {
        subject: item.subject,
        question: item.question,
        priority: item.close ? "high" : "normal",
        discipline: item.discipline,
        managerUserId: userIds.pm,
        assigneeUserIds: [userIds.planner],
        distributionUserIds: [userIds.qs],
        activityId: activityIds[item.activity],
        raisedDate: item.raisedDate,
        responseRequiredBy: item.responseRequiredBy,
      });
      raised += 1;
    }
    let current = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
    if (current.status === "draft") {
      await POST(site, `/projects/${P}/rfi/${rfi.id}/submit`, {});
      current = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
    }
    if (item.answer && current.status === "open") {
      await POST(planner, `/projects/${P}/rfi/${rfi.id}/answer`, {
        response: item.answer,
        answeredDate: item.answeredDate,
      });
      current = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
    }
    if (item.close && current.status === "answered") {
      await POST(pm, `/projects/${P}/rfi/${rfi.id}/close`, { comment: "Answered and taken into the works" });
    }
  }
  const register = rows(await GET(qs, `/projects/${P}/rfi?limit=100`));
  say("RFIs", `${raised} raised this run, ${register.length} on the register, ${register.filter((r) => r.status === "open").length} open`);
}

/** Inspections that passed, one minor non-conformance still being worked. */
async function seedQuality({ P, activityIds, userIds }) {
  step("Quality");
  const { pm, qs, quality, site } = PEOPLE;

  const itps = rows(await GET(qs, `/projects/${P}/itp?limit=100`));
  const ITPS = [
    ["Pre-pour inspection: post-tensioned slab level 12", "hold", "A1240", "2026-07-22", "passed"],
    ["Facade bracket survey and setting out, levels 1 to 8", "witness", "A1310", "2026-08-27", "passed"],
    ["Riser first fix inspection, levels 5 to 8", "witness", "A1410", "2026-10-06", "pending"],
  ];
  for (const [title, pointType, activity, inspectionDate, status] of ITPS) {
    let itp = itps.find((row) => row.title === title);
    if (!itp) {
      itp = await POST(qs, `/projects/${P}/itp`, {
        title,
        pointType,
        status: "pending",
        activityId: activityIds[activity],
        inspectionDate,
        dueDate: inspectionDate,
      });
    }
    if (status !== "pending" && itp.status !== status) {
      await PATCH(quality, `/projects/${P}/itp/${itp.id}`, {
        status,
        inspectionDate,
        comment: "Checked against the approved drawings and specification.",
      });
    }
  }

  const NCR_DESCRIPTION =
    "Cover to the reinforcement at the level 11 slab soffit measured at 18mm against the specified 25mm over an area of about 4 m2.";
  const ncrs = rows(await GET(quality, `/projects/${P}/ncr?limit=100`));
  if (!ncrs.some((row) => row.description === NCR_DESCRIPTION)) {
    await POST(site, `/projects/${P}/ncr`, {
      title: "Reinforcement cover at the level 11 slab soffit",
      description: NCR_DESCRIPTION,
      severity: "minor",
      activityId: activityIds.A1240,
      responsible: "Concrete subcontractor site foreman",
      assigneeUserId: userIds.site,
      dueDate: iso(new Date(AS_OF.getTime() + 12 * 86_400_000)),
      comment: "Raised after the cover meter survey of the level 11 pour.",
    });
  }

  const DEFECT = "Chipped reveal to the apartment 804 window head";
  const defects = rows(await GET(qs, `/projects/${P}/defects?limit=100`));
  let defect = defects.find((row) => row.title === DEFECT);
  if (!defect) {
    defect = await POST(qs, `/projects/${P}/defects`, {
      title: DEFECT,
      severity: "minor",
      status: "open",
      activityId: activityIds.A1310,
      dueDate: "2026-09-12",
      comment: "Noted during the level 8 facade walk-round.",
    });
  }
  if (defect.status === "open") defect = await PATCH(site, `/projects/${P}/defects/${defect.id}`, { status: "in_progress", comment: "Made good and re-sealed" });
  if (defect.status === "in_progress") await PATCH(pm, `/projects/${P}/defects/${defect.id}`, { status: "closed", comment: "Accepted on re-inspection" });

  const score = await probe(quality, "GET", `/projects/${P}/quality/score`);
  say("quality", score.ok ? JSON.stringify(score.data).slice(0, 160) : "inspections and one open minor NCR recorded");
}

/** Two days on site, so the field screens and the manpower report have data. */
async function seedField({ P, activityIds, companies }) {
  step("Daily logs");
  const { pm, site } = PEOPLE;
  // Three days, counted back from today rather than from the reporting
  // cutoff: the cutoff is the month end and may still be ahead, and nobody
  // writes tomorrow's daily log. Today's day is left open — site reporting
  // opens on today, and a job in progress has a day still being filled in,
  // not a blank page.
  const today = new Date();
  const DAYS = [
    {
      day: iso(new Date(today.getTime() - 4 * 86_400_000)),
      approve: true,
      entries: [
        ["manpower", { companyId: companies[MEP_SUB], trade: "MEP fitter", workers: 18, hours: 9, activity: "A1410", notes: "First fix containment and pipework, levels 5 to 7" }],
        ["manpower", { companyId: companies[FACADE_SUB], trade: "Facade installer", workers: 12, hours: 9, activity: "A1310", notes: "Panel setting, level 8 north elevation" }],
        ["equipment", { name: "Tower crane TC-01", count: 1, hoursOperated: 9, hoursIdle: 1, activity: "A1310" }],
        ["notes", { kind: "safety", text: "Toolbox talk on working at height and panel lifting held at 06:45; 34 attended.", activity: "A1310" }],
      ],
    },
    {
      day: iso(new Date(today.getTime() - 1 * 86_400_000)),
      approve: true,
      entries: [
        ["manpower", { companyId: companies[CONCRETE_SUB], trade: "Steelfixer", workers: 22, hours: 9, activity: "A1250", notes: "Roof slab reinforcement, bay 3" }],
        ["deliveries", { supplierName: FACADE_SUB, description: "Unitised curtain wall panels, levels 9 and 10", quantity: 48, unit: "nr", poRef: "MBR-PO-0014", receivedBy: "Site storeman", deliveredAt: "07:40", activity: "A1320" }],
        ["delays", { type: "weather", description: "High wind stopped crane lifts between 13:00 and 15:00", hoursLost: 2, activity: "A1310" }],
      ],
    },
    {
      day: iso(today),
      approve: false,
      entries: [
        ["manpower", { companyId: companies[MEP_SUB], trade: "Electrician", workers: 16, hours: 9, activity: "A1410", notes: "Containment and cable pulling, levels 6 and 7" }],
        ["manpower", { companyId: companies[FACADE_SUB], trade: "Facade installer", workers: 14, hours: 9, activity: "A1310", notes: "Panel setting, level 8 east elevation" }],
        ["equipment", { name: "Mast climber MC-02", count: 2, hoursOperated: 8, hoursIdle: 1, activity: "A1310" }],
        ["visitors", { name: "Client representative walk-round", company: CLIENT, purpose: "Monthly progress inspection of levels 6 to 8", arrivedAt: "10:00", leftAt: "12:15", activity: "A1310" }],
        ["notes", { kind: "general", text: "Level 8 east elevation closed in; commissioning access agreed with the MEP subcontractor for next week.", activity: "A1310" }],
      ],
    },
  ];

  // A photograph on the day, so the gallery and the field screens are not
  // empty: the project's photos are the attachments on its field records.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );

  let written = 0;
  for (const { day, approve, entries } of DAYS) {
    const log = await GET(site, `/projects/${P}/daily-logs/${day}`);
    // An approved day is closed to new entries, but its photographs are
    // attachments on the record rather than entries in it, so the gallery is
    // still topped up below.
    for (const [section, body] of log.status === "approved" ? [] : entries) {
      const clientRequestId = `MBR-${day}-${section}-${body.trade || body.name || body.type || body.kind || body.description || "1"}`
        .replace(/[^A-Za-z0-9-]+/g, "-")
        .slice(0, 80);
      const existing = rows(log.sections?.[section] ?? log[section] ?? []);
      if (existing.some((entry) => entry.clientRequestId === clientRequestId)) continue;
      const { activity, ...rest } = body;
      const posted = await probe(site, "POST", `/projects/${P}/daily-logs/${day}/entries/${section}`, {
        ...rest,
        clientRequestId,
        activityId: activityIds[activity],
      });
      if (!posted.ok) {
        throw new Error(
          `daily log ${day} ${section}: ${posted.status} ${posted.code} ${posted.message}${describeDetails(posted.details)}`,
        );
      }
      written += 1;
    }

    // The photograph hangs off the day's record id, not off its date: the
    // day panel asks for evidence by the log's id, and a photo filed under
    // the date reaches the project gallery but never that day's evidence.
    const saved = await GET(site, `/projects/${P}/daily-logs/${day}`);
    if (saved.id) {
      const evidence = rows(
        await GET(site, `/projects/${P}/attachments?recordType=daily_log&recordId=${saved.id}`),
      );
      if (evidence.length === 0) {
        await upload(site, "POST", `/projects/${P}/attachments`, {
          field: "files",
          filename: `site-progress-${day}.png`,
          contentType: "image/png",
          body: png,
          fields: { recordType: "daily_log", recordId: saved.id, caption: `Progress photograph, ${day}` },
        });
      }
    }

    if (approve && log.status !== "approved") {
      await probe(pm, "POST", `/projects/${P}/daily-logs/${day}/approve`, { comment: "Reviewed and approved" });
    }
  }
  say("daily log entries written this run", written);
  say("photographs in the gallery", rows(await GET(site, `/projects/${P}/photos?limit=100`)).length);
}

/** A risk register with live items, because an empty one reads as a new job. */
async function seedRisks({ P, activityIds }) {
  step("Risks");
  const { pm } = PEOPLE;
  const existing = rows(await GET(pm, `/projects/${P}/risks?limit=100`));
  const RISKS = [
    {
      description: "Unitised facade panel deliveries from the fabricator continue to run two weeks behind the agreed schedule.",
      probability: "high",
      impact: "medium",
      mitigation: "Weekly production call with the fabricator; second shift agreed for levels 9 to 12; float in the facade package monitored monthly.",
      owner: "Procurement manager",
      activity: "A1320",
      status: "monitoring",
    },
    {
      description: "Groundwater levels in the lower basement are higher than the pre-contract survey assumed.",
      probability: "medium",
      impact: "medium",
      mitigation: "Additional sump pumps priced as a variation and monitored weekly; permanent drainage design under review by the consultant.",
      owner: "Site manager",
      activity: "A1130",
      status: "open",
    },
    {
      description: "Long-lead lift equipment could be delayed by the supplier's shipping schedule, affecting commissioning.",
      probability: "medium",
      impact: "high",
      mitigation: "Order placed early with milestone payments tied to shipping dates; commissioning window protected in the programme.",
      owner: "Project manager",
      activity: "A1540",
      status: "monitoring",
    },
    {
      description: "Hurricane season may close the site and stop crane operations during the facade installation window.",
      probability: "medium",
      impact: "medium",
      mitigation: "Eighteen days of weather allowance in the contract, tracked against the daily log; storm securing procedure rehearsed.",
      owner: "Site manager",
      activity: "A1310",
      status: "monitoring",
    },
  ];

  let raised = 0;
  for (const risk of RISKS) {
    if (existing.some((row) => row.description === risk.description)) continue;
    const { activity, ...rest } = risk;
    await POST(pm, `/projects/${P}/risks`, { ...rest, activityId: activityIds[activity] });
    raised += 1;
  }
  say("risks", `${raised} raised this run, ${rows(await GET(pm, `/projects/${P}/risks?limit=100`)).length} on the register`);
}

main()
  .then((blocked) => {
    if (blocked > 0) {
      console.error(`Setup readiness still reports ${blocked} blocked step(s) — the overview will show red chips.`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nSHOWCASE SEED ABORTED");
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  });
