"use strict";
/**
 * CERT-3 WP-0 answer book, section "schedule".
 *
 * Scope (docs/certification/OCTAPM_CERT3_PLAN.md, working-tree numbering of
 * 2026-10-09, which carries the Q-KEY line at :36 - HEAD b0ec5b0 numbering is
 * one lower from :36 on):
 *   - WP-0 stage-table rows stage2:154 (plan :452) and stage9:135,153,218 (:456)
 *   - WP-1 schedule: import, revisions, activation, CPM, baseline, status (:460-530)
 *   - WP-2 progress: gates, ITP hold points, quantity method, bulk/import (:532-584)
 *   - WP-3 earned value, reporting periods, forecast (:586-629)
 *   - the project contents of 087-SCH (:384), 087-IMP (:385), 087-EV (:386)
 *   - the D2 lane 052-SCH-EV (:403) and the D3 lane (:408-411) that reuse them
 *   - the CLAUDE.md rule rows of §1.1 in this scope (:63-66, :68, :72)
 *
 * Every figure is derived here on paper: the pure calculators below (CPM
 * forward/backward pass, a day-by-day working-day walk, hours/8, EV in integer
 * cents, EAC as an exact rational rounded half-up at the cent, the cutoff
 * instant from the platform's Intl zone data) run when the file is loaded and
 * touch no product code, database or network. They were checked against an
 * independent scratch implementation (C:\Temp\octapm-cert\scratch\wp0\
 * schedule-calc.js, a different calendar walk and BigInt money); the load test
 * C:\Temp\octapm-cert\scratch\wp0\load-schedule.js compares the two.
 * Product rules are restated from CLAUDE.md and from the product code as it
 * stands at HEAD 886c9f1 (read with `git show HEAD:<path>`, never from the
 * working tree, which a mutation run may be rewriting).
 *
 * Leaf shape (the same as answers/field-controls.js):
 *   { value, unit, derivation, source, assumption, planDisagrees,
 *     planValue?, today?, company?, note? }
 *   value        the expected answer (what the proof must assert)
 *   today        what HEAD does now, where the plan or the code shows it differs
 *   planValue    the plan's figure, only where this derivation disagrees
 *   assumption   true where the plan marks an assumption or a choice was made here
 *
 * Units: cents (money, INTEGER cents), percent, ratio, count, working_days,
 * days (calendar), hours, m2, date (YYYY-MM-DD), instant (ISO UTC), state,
 * http ("<status> <CODE>", or a bare status number when no code is fixed),
 * text, bool, list.
 *
 * Owner decisions in force for this section (plan §0.1 :21-35):
 *   HR-S2 milestones are valid zero-duration elements (M900 never blocks
 *         approval, PATCH or baseline by itself);
 *   HR-P1 approved to fix: a downward correction is an explicit, authorised
 *         correction that keeps its history; approving an older submission
 *         after a newer approved one is refused (409, plan :997);
 *   HR-Q1 approved to fix: a hold point is released only on a completed or
 *         closed instance with the hold item passed; "na" needs the approver;
 *   HR-X1 evidence is at least one stored project document.
 * Everything that depends on an undecided §5 row (HR-S1, S3-S6, S9, P2, E1,
 * E2, ...) is marked assumption: true and names the row.
 *
 * Run-date assumption: the proofs run on or after 2026-10-01 (the latest
 * transaction date in 087-EV) and on or after 2026-04-28 (so every F1
 * activity's planned finish is past). "today" in WP-3 means the run date.
 *
 * Integration owner's adjudication (2026-10-09, C:\Temp\octapm-cert\scratch\
 * wp0\adjudication.md §A "schedule.js") is applied: S1 (052-SCH-EV order),
 * S2 (the nine added figures) and the drafter's open questions. A refusal
 * whose rule is undecided carries no error code (code null: a bare status in
 * an http leaf, `code: null` in an object); a code is never guessed.
 */

const PLAN = "docs/certification/OCTAPM_CERT3_PLAN.md";
const HEAD = "886c9f1";
const AREA = "C:/Temp/octapm-cert/scratch/cert3-areas.json[0] (schedule area map)";
/** The integration owner's binding decisions for this section. */
const ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp0/adjudication.md §A schedule.js ${item}`;
const P = (...lines) => `${PLAN}:${lines.join(",")}`;
const H = (file, lines) => `${file}:${lines} @${HEAD}`;

function F(value, unit, derivation, source, opts = {}) {
  const leaf = {
    value,
    unit,
    derivation,
    source: Array.isArray(source) ? source.join("; ") : source,
    assumption: Boolean(opts.assumption),
    planDisagrees: opts.planValue !== undefined,
  };
  if (opts.planValue !== undefined) leaf.planValue = opts.planValue;
  if (opts.today !== undefined) leaf.today = opts.today;
  if (opts.company) leaf.company = opts.company;
  if (opts.note) leaf.note = opts.note;
  return leaf;
}
/** An assumption leaf (the plan marks it, or a choice was made here). */
const FA = (value, unit, derivation, source, opts = {}) => F(value, unit, derivation, source, { ...opts, assumption: true });

// ─── money in integer cents ──────────────────────────────────────────────────
const cents = (amount) => Math.round(amount * 100);
/** 7500000 -> "75,000.00" (derivation text only). */
function fmt(c) {
  const neg = c < 0;
  const s = String(Math.abs(c)).padStart(3, "0");
  const whole = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${whole}.${s.slice(-2)}`;
}
/** round(n / d) half-up for non-negative integers, exact (BigInt). */
function divHalfUp(n, d) {
  const N = BigInt(n);
  const D = BigInt(d);
  return Number((2n * N / D + 1n) / 2n);
}
const r6 = (x) => (x === null ? null : Number(x.toFixed(6)));

// ─── pure calculators (restated rules; each cites where it comes from) ──────

/** XER/P6 XML durations and float: max(0, Math.round(h / 8)) (xer-parser.js:40-44, p6xml-parser.js:48-52). */
const hoursToDays = (h) => Math.max(0, Math.round(h / 8));
/** XER/P6 XML lags: Math.round(h / 8), no clamp (xer-parser.js:46-50, p6xml-parser.js:54-58). JS rounds .5 toward +inf. */
const lagHoursToDays = (h) => Math.round(h / 8);
/** MSPDI LinkLag/TotalSlack: Math.round(tenths / 4800), no clamp (msp-parser.js:46-52). */
const tenthsToDays = (t) => Math.round(t / 4800);
/** MSPDI duration PTnHnMnS: max(0, round(h/8 + m/480)) (msp-parser.js:19-42). */
const mspDurationDays = (hours) => Math.max(0, Math.round(hours / 8));

/**
 * Critical-path method on working-day offsets (CLAUDE.md: TF = LF - EF; TF = 0 -> critical).
 * Forward: ES = max(0, max over predecessors of FS EF+lag | SS ES+lag | FF EF+lag-d | SF ES+lag-d); EF = ES + d.
 * Backward: no successor -> LF = project end; otherwise LF = min over successors of
 * FS LS-lag | SS LS-lag+d | FF LF-lag | SF LF-lag+d; LS = LF - d (cpm.service.js:416-491).
 * capLf: HR-S1's recommendation (LF never beyond the project finish, plan :988).
 */
function cpm(activities, links, { capLf = false } = {}) {
  const ids = activities.map((a) => a.id);
  const dur = new Map(activities.map((a) => [a.id, a.d]));
  const preds = new Map(ids.map((id) => [id, []]));
  const succs = new Map(ids.map((id) => [id, []]));
  for (const l of links) {
    preds.get(l.s).push(l);
    succs.get(l.p).push(l);
  }
  const indegree = new Map(ids.map((id) => [id, preds.get(id).length]));
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const l of succs.get(id)) {
      indegree.set(l.s, indegree.get(l.s) - 1);
      if (indegree.get(l.s) === 0) queue.push(l.s);
    }
  }
  if (order.length !== ids.length) return { cycle: true };
  const ES = {};
  const EF = {};
  const LS = {};
  const LF = {};
  for (const id of order) {
    const d = dur.get(id);
    let es = 0;
    for (const l of preds.get(id)) {
      const c = { FS: EF[l.p] + l.lag, SS: ES[l.p] + l.lag, FF: EF[l.p] + l.lag - d, SF: ES[l.p] + l.lag - d }[l.t];
      if (c > es) es = c;
    }
    ES[id] = Math.max(0, es);
    EF[id] = ES[id] + d;
  }
  const end = Math.max(...Object.values(EF));
  for (const id of [...order].reverse()) {
    const d = dur.get(id);
    let lf = succs.get(id).length ? Infinity : end;
    for (const l of succs.get(id)) {
      const c = { FS: LS[l.s] - l.lag, SS: LS[l.s] - l.lag + d, FF: LF[l.s] - l.lag, SF: LF[l.s] - l.lag + d }[l.t];
      if (c < lf) lf = c;
    }
    if (capLf) lf = Math.min(lf, end);
    LF[id] = Math.max(0, lf);
    LS[id] = Math.max(0, LF[id] - d);
  }
  const rows = {};
  for (const id of ids) {
    const tf = LF[id] - EF[id];
    rows[id] = { ES: ES[id], EF: EF[id], LS: LS[id], LF: LF[id], TF: tf, critical: tf <= 0 };
  }
  return { rows, end, order };
}

const WORKING_DAYS = { five_day: new Set([1, 2, 3, 4, 5]), seven_day: new Set([0, 1, 2, 3, 4, 5, 6]) };
const DAY_MS = 86_400_000;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
/**
 * Working-day offset -> date, walked one day at a time: from the first working
 * day on or after the start, step forward counting working days. The finish
 * is exclusive (EF offset 5 = the start of the 6th working day), as the
 * product dates it (cpm.service.js:125-166, :354-385, :663-664; HR-S7 :994).
 */
function workingDate(startIso, offset, calendar = "five_day") {
  let t = Date.parse(`${startIso}T00:00:00.000Z`);
  while (!WORKING_DAYS[calendar].has(new Date(t).getUTCDay())) t += DAY_MS;
  let left = offset;
  while (left > 0) {
    t += DAY_MS;
    if (WORKING_DAYS[calendar].has(new Date(t).getUTCDay())) left -= 1;
  }
  return isoDate(t);
}
const weekday = (iso) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${iso}T00:00:00Z`).getUTCDay()];

/** EV of one activity: approved allocation x approved percent / 100 (earned-value.service.js:792; CLAUDE.md activity-linked EV). */
const evOf = (allocCents, pct) => Math.round((allocCents * pct) / 100);
/** Quantity method: pct = installed / planned x 100 (progress.service.js:714-727); EV exact in cents. */
const qtyEv = (allocCents, installed, planned) => divHalfUp(allocCents * installed, planned);

/**
 * CLAUDE.md: SPI = EV/PV, CPI = EV/AC (alerts below 0.9), EAC = budget / CPI.
 * HEAD: SPI null when PV = 0; CPI null when AC = 0; EAC = BAC when CPI is 0 or null;
 * SV = EV-PV; CV = EV-AC; ETC = EAC-AC; alert = index !== null && index < 0.9
 * (earned-value.service.js:219-245, :953-956; eac-basis.js eacBasisOf).
 * EAC = BAC / (EV/AC) = BAC x AC / EV, exact, half-up at the cent.
 */
function evMetrics({ bac, pv, ev, ac }) {
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const eac = bac > 0 ? (cpi !== null && cpi > 0 ? divHalfUp(bac * ac, ev) : bac) : 0;
  const eacBasis = !(bac > 0) ? "no_budget" : cpi === null ? "budget_no_cost_performance" : cpi > 0 ? "budget_over_cpi" : "budget_cpi_zero";
  return {
    bac, pv, ev, ac, spi, cpi, eac, eacBasis,
    spiAlert: spi !== null && spi < 0.9,
    cpiAlert: cpi !== null && cpi < 0.9,
    sv: ev - pv, cv: ev - ac, etc: eac - ac,
  };
}

/**
 * End of a local calendar date in a zone, as a UTC instant (the reporting
 * cutoff, utils/reporting-cutoff.js endOfLocalDay): the last millisecond
 * before the zone's clock shows the next date. Found here by bisection on
 * the platform's Intl data, not by the product's offset arithmetic.
 */
function endOfLocalDay(dateKey, timeZone) {
  const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = dateKey.split("-").map(Number);
  let lo = Date.UTC(y, m - 1, d) - 2 * DAY_MS;
  let hi = Date.UTC(y, m - 1, d) + 3 * DAY_MS;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fmtDate.format(new Date(mid)) > dateKey) hi = mid;
    else lo = mid;
  }
  return new Date(hi - 1).toISOString();
}
/** The latest period whose cutoff instant has passed (earned-value.service.js:411-424). */
const defaultPeriod = (periods, nowIso, timeZone) =>
  periods.filter((p) => endOfLocalDay(p.cutoff, timeZone) <= nowIso).map((p) => p.code).pop() || null;

/** Forecast pace basis: projected = asOf + (100 - pct) x elapsed/pct days; slip = round(projected - finish) (forecast.service.js:379-419). */
function forecastPace({ start, finish, asOf, pct }) {
  const elapsed = (Date.parse(asOf) - Date.parse(start)) / DAY_MS;
  const addDays = (100 - pct) * (elapsed / pct);
  const projectedMs = Date.parse(asOf) + addDays * DAY_MS;
  return { elapsed, addDays, projected: isoDate(projectedMs), slip: Math.round((projectedMs - Date.parse(finish)) / DAY_MS) };
}
/** EV-based finish: asOf + remaining days / SPI when 0 < SPI < 1 (forecast.service.js:564-569). */
const forecastEvFinish = ({ asOf, plannedFinish, spi }) => isoDate(Date.parse(asOf) + ((Date.parse(plannedFinish) - Date.parse(asOf)) / DAY_MS / spi) * DAY_MS);

/** CLAUDE.md auto-status; HEAD precedence complete > delayed > in progress > todo, delayed when endDate < now (activity-status.js:29-35). */
function deriveStatus(pct, endDate, now) {
  if (pct >= 100) return "complete";
  if (endDate && new Date(endDate) < new Date(now)) return "delayed";
  if (pct > 0) return "in_progress";
  return "todo";
}

// ─── inputs (the generated files and the builders read these) ───────────────

const START = "2026-01-05"; // Monday (plan :384, :386)
const WBS = { SUB: "1 Substructure", SUP: "2 Superstructure", ARC: "3 Architectural & MEP" };

/** F1: the stage-2 network in hours (stage2-schedule.js:45-60; plan :384). code, name, wbs, target_drtn_hr_cnt, FS predecessor (lag 0 h), phys_complete_pct. */
const F1_TASKS = [
  ["A100", "Site clearance", "SUB", 40, null, 0],
  ["A110", "Bulk excavation", "SUB", 80, "A100", 0],
  ["A120", "Blinding concrete", "SUB", 24, "A110", 0],
  ["A130", "Foundation concrete", "SUB", 96, "A120", 0],
  ["A140", "Backfill and compaction", "SUB", 32, "A130", 0],
  ["A200", "Columns level 1", "SUP", 64, "A130", 40],
  ["A210", "Beams level 1", "SUP", 48, "A200", 0],
  ["A220", "Slab level 1", "SUP", 56, "A210", 0],
  ["A230", "Columns level 2", "SUP", 64, "A220", 0],
  ["A300", "MEP first fix rough-in", "ARC", 80, "A220", 0],
  ["A310", "Blockwork walls", "ARC", 72, "A230", 0],
  ["A320", "Internal plastering", "ARC", 56, "A310", 0],
  ["A330", "Painting and decoration", "ARC", 48, "A320", 0],
  ["M900", "Practical completion", "ARC", 0, "A330", 0],
];
const CODES = F1_TASKS.map((t) => t[0]);
const networkOf = (tasks, overrideDays = {}) => ({
  activities: tasks.map(([id, , , hours]) => ({ id, d: overrideDays[id] !== undefined ? overrideDays[id] : hoursToDays(hours) })),
  links: tasks.filter((t) => t[4]).map(([id, , , , pred]) => ({ p: pred, s: id, t: "FS", lag: 0 })),
});

const NET1 = networkOf(F1_TASKS);
const CPM1 = cpm(NET1.activities, NET1.links);
const CPM1_CAPPED = cpm(NET1.activities, NET1.links, { capLf: true });
const NET2 = networkOf(F1_TASKS, { A110: 20 });
const CPM2 = cpm(NET2.activities, NET2.links);
const F1B_TASKS = F1_TASKS.filter((t) => t[0] !== "A140").map((t) => (t[0] === "A110" ? [t[0], t[1], t[2], 160, t[4], t[5]] : t));
const NETB = networkOf(F1B_TASKS);
const CPMB = cpm(NETB.activities, NETB.links);
/** The 087-SCH tail activity (plan :384 "a tail activity ending in 2027"); duration and link are a choice made here. */
const TAIL = { code: "T900", name: "Defects liability close-out", durationDays: 200, predecessor: "M900", relationship: "FS", lagDays: 0, hourlyEquivalent: 1600 };
const CPMT = cpm([...NET1.activities, { id: "T900", d: TAIL.durationDays }], [...NET1.links, { p: "M900", s: "T900", t: "FS", lag: 0 }]);
const durOf = (code) => NET1.activities.find((a) => a.id === code).d;
const CRITICAL1 = CODES.filter((c) => CPM1.rows[c].critical);
/** HR-S3 reproduction file (adjudication S2): F1 with every file float >= 5 days, max(TF, 5) x 8 hours. */
const HR_S3_FLOAT_HOURS = Object.fromEntries(CODES.map((c) => [c, Math.max(CPM1.rows[c].TF, 5) * 8]));
/** HEAD stages isCritical = round(file TF days) === 0 (import.service.js:251-253). */
const HR_S3_STAGED_CRITICAL = Object.values(HR_S3_FLOAT_HOURS).filter((h) => hoursToDays(h) === 0).length;

/** 087-SCH BOQ (plan :384, read as: 5 allocated rows incl. one split row and A320's two items, plus the 72,000 row; two out-of-scope rows). */
const BOQ_087SCH = [
  { code: "S-001", description: "Bulk excavation", quantity: 5000, unit: "m3", rate: 12, mappingRule: "in_scope", allocations: [["A110", 5000, 60_000]] },
  { code: "S-002", description: "Concrete C35 (blinding and foundations)", quantity: 800, unit: "m3", rate: 150, mappingRule: "in_scope", allocations: [["A120", 200, 30_000], ["A130", 600, 90_000]] },
  { code: "S-003", description: "Blockwork walls 200 mm", quantity: 900, unit: "m2", rate: 150, mappingRule: "in_scope", allocations: [["A310", 900, 135_000]] },
  { code: "S-004", description: "Internal plaster to walls", quantity: 400, unit: "m2", rate: 120, mappingRule: "in_scope", allocations: [["A320", 400, 48_000]] },
  { code: "S-005", description: "Internal plaster to soffits", quantity: 200, unit: "m2", rate: 120, mappingRule: "in_scope", allocations: [["A320", 200, 24_000]] },
  { code: "S-006", description: "Slab screed", quantity: 1200, unit: "m2", rate: 60, mappingRule: "in_scope", allocations: [], coveredAtBaselineBy: ["A220", 1200, 72_000] },
  { code: "S-007", description: "Optional external cladding", quantity: 100, unit: "m2", rate: 50, mappingRule: "optional", allocations: [] },
  { code: "S-008", description: "Dewatering (not applicable)", quantity: 50, unit: "m3", rate: 80, mappingRule: "not_applicable", allocations: [] },
];
const ALLOC = { A110: cents(60_000), A120: cents(30_000), A130: cents(90_000), A310: cents(135_000), A320: cents(72_000) };
const ALLOCATED_FIVE = Object.values(ALLOC).reduce((s, v) => s + v, 0); // 387,000.00
const S006 = cents(72_000);
/** Adjudication (open question S-006): the drafter's reading is accepted as an assumption, and the ambiguity goes to the plan's §0 questions. */
const S006_NOTE = "S-006 reading accepted by the integration owner (assumption). Plan ambiguity for the §0 questions: plan :384 says 'one 72,000 row stays unallocated until the baseline step covers it' but names neither the activity that covers it nor whether 087-SCH's EV budget then becomes 459,000.00 (WP-2's figures use the five allocations, 387,000.00). Read here: allocated to A220 at the baseline step, EV budget after baseline 459,000.00.";
const IN_SCOPE_PRICED = BOQ_087SCH.filter((r) => r.mappingRule === "in_scope").reduce((s, r) => s + cents(r.quantity * r.rate), 0);
const A310_PLANNED = 900;
const A320_PLANNED = 400 + 200;

/**
 * 087-EV BOQ (adjudication S2): the approved allocations as explicit entries,
 * five in-scope rows each allocated whole to one activity, so coverage is
 * 100% and BAC = 387,000.00. 052-SCH-EV (D2) and the D3 lane carry the same
 * rows. Quantities and rates restate 087-SCH's rows (S-003's 900 m2 on A310
 * keeps WP-2's quantity gates valid on 052); the row codes are a choice.
 */
const BOQ_EV = [
  { code: "E-001", description: "Bulk excavation", quantity: 5000, unit: "m3", rate: 12, mappingRule: "in_scope", allocations: [["A110", 5000, 60_000]] },
  { code: "E-002", description: "Blinding concrete", quantity: 200, unit: "m3", rate: 150, mappingRule: "in_scope", allocations: [["A120", 200, 30_000]] },
  { code: "E-003", description: "Foundation concrete", quantity: 600, unit: "m3", rate: 150, mappingRule: "in_scope", allocations: [["A130", 600, 90_000]] },
  { code: "E-004", description: "Blockwork walls 200 mm", quantity: 900, unit: "m2", rate: 150, mappingRule: "in_scope", allocations: [["A310", 900, 135_000]] },
  { code: "E-005", description: "Internal plaster", quantity: 600, unit: "m2", rate: 120, mappingRule: "in_scope", allocations: [["A320", 600, 72_000]] },
];
const BOQ_EV_PRICED = BOQ_EV.reduce((s, r) => s + cents(r.quantity * r.rate), 0);
const BOQ_EV_ALLOCATED = Object.fromEntries(BOQ_EV.flatMap((r) => r.allocations.map(([a, , amt]) => [a, cents(amt)])));
if (BOQ_EV_PRICED !== ALLOCATED_FIVE || JSON.stringify(BOQ_EV_ALLOCATED) !== JSON.stringify(ALLOC)) {
  throw new Error("schedule answer book: the 087-EV BOQ does not carry the five approved allocations");
}

/** 087-EV (plan :386; area map workflow "Earned value" setup). */
const EV087 = {
  boq: BOQ_EV,
  allocations: Object.fromEntries(Object.entries(ALLOC).map(([a, c]) => [a, c / 100])),
  loadings: [["A110", 60_000, "2026-01-23"], ["A120", 30_000, "2026-01-28"], ["A130", 90_000, "2026-02-13"], ["A310", 135_000, "2026-03-20"], ["A320", 72_000, "2026-04-10"]],
  progress: { A110: 100, A120: 50, A130: 25 },
  directCosts: [["A110", 50_000, "2026-01-20"], ["A110", 10_000, "2026-09-30"], ["A130", 20_000, "2026-02-10"]],
  t2Cost: ["A120", 30_000, "2026-10-01"],
  budgetRevision: { amount: 13_000, changeType: "addition", effectiveDate: "2026-03-01" },
  periods: [
    { code: "2026-01", start: "2026-01-01", end: "2026-01-31", cutoff: "2026-01-31", lock: "normal (finance, gate ready)" },
    { code: "2026-02", start: "2026-02-01", end: "2026-02-28", cutoff: "2026-02-28", lock: "PM with a readiness override" },
    { code: "2026-11", start: "2026-11-01", end: "2026-11-30", cutoff: "2026-11-30", lock: "L113 probe (cutoff not reached)" },
  ],
  backdatedAfterLock: ["A130", 5_000, "2026-02-15"],
  approvalAfterLock: ["A120", 60],
  a140Cost: ["A140", 5_000, "run date"],
  timeZone: "Africa/Cairo",
  order: ["T1", "T2", "T3", "T4 (in process)", "T5", "T5 delete probe", "T7", "periods: create, locks, back-dated A130 cost, new approval A120 60%", "forecast (in process)", "T6: A140 cost then the retiring revision"],
};
const LOADING_CENTS = EV087.loadings.map(([a, amt, d]) => [a, cents(amt), d]);
const COSTS = EV087.directCosts.map(([a, amt, d]) => [a, cents(amt), d]);
const pvAt = (cutoffDate) => LOADING_CENTS.filter((l) => l[2] <= cutoffDate).reduce((s, l) => s + l[1], 0);
/** AC as the ledger dates it (incurredOn <= cutoff): the expected rule of HR-E1/L34. */
const acLedger = (cutoffDate, rows) => rows.filter((r) => r[2] <= cutoffDate).reduce((s, r) => s + r[1], 0);
/** AC as HEAD reads it: one cumulative CostRecord per activity, counted whole only when its through-date <= cutoff (earned-value.service.js:486-514; cost-ledger.service.js:176-240). */
function acHead(cutoffDate, rows) {
  const by = new Map();
  for (const [a, amt, d] of rows) {
    const r = by.get(a) || { amount: 0, through: "0000-00-00" };
    r.amount += amt;
    if (d > r.through) r.through = d;
    by.set(a, r);
  }
  return [...by.values()].filter((r) => r.through <= cutoffDate).reduce((s, r) => s + r.amount, 0);
}
const RUN = "2026-10-09"; // a run date satisfying the run-date assumption; every 087-EV row is dated on or before it
const EV_STAGE9 = Object.entries(EV087.progress).reduce((s, [a, p]) => s + evOf(ALLOC[a], p), 0);
const BAC = ALLOCATED_FIVE;
const ROWS_T1 = COSTS;
const ROWS_T2 = [...COSTS, [EV087.t2Cost[0], cents(EV087.t2Cost[1]), EV087.t2Cost[2]]];
const ROWS_LOCK = [...ROWS_T2, [EV087.backdatedAfterLock[0], cents(EV087.backdatedAfterLock[1]), EV087.backdatedAfterLock[2]]];
const ROWS_T6 = [...ROWS_LOCK, ["A140", cents(5_000), RUN]];
const M_T1 = evMetrics({ bac: BAC, pv: pvAt(RUN), ev: EV_STAGE9, ac: acLedger(RUN, ROWS_T1) });
const M_T2 = evMetrics({ bac: BAC, pv: pvAt(RUN), ev: EV_STAGE9, ac: acLedger(RUN, ROWS_T2) });
const M_T3 = evMetrics({ bac: BAC, pv: pvAt("2026-02-28"), ev: 0, ac: acLedger("2026-02-28", ROWS_T2) });
const M_T3_HEAD = evMetrics({ bac: BAC, pv: pvAt("2026-02-28"), ev: 0, ac: acHead("2026-02-28", ROWS_T2) });
const M_JAN = evMetrics({ bac: BAC, pv: pvAt("2026-01-31"), ev: 0, ac: acLedger("2026-01-31", ROWS_T2) });
const M_JAN_HEAD = evMetrics({ bac: BAC, pv: pvAt("2026-01-31"), ev: 0, ac: acHead("2026-01-31", ROWS_T2) });
const BAC_T5 = BAC + cents(EV087.budgetRevision.amount);
const M_T5 = evMetrics({ bac: BAC_T5, pv: pvAt(RUN), ev: EV_STAGE9, ac: acLedger(RUN, ROWS_T2) });
/** Adjudication S2: the new approval after the Feb lock (A120 50 -> 60) is stamped after every cutoff; it moves run-date EV only. */
const [LOCK_APPROVAL_ACT, LOCK_APPROVAL_PCT] = EV087.approvalAfterLock;
const EV_AFTER_LOCK = EV_STAGE9 - evOf(ALLOC[LOCK_APPROVAL_ACT], EV087.progress[LOCK_APPROVAL_ACT]) + evOf(ALLOC[LOCK_APPROVAL_ACT], LOCK_APPROVAL_PCT);
const AC_T6 = acLedger(RUN, ROWS_T6);
const AC_T6_HEAD_RETIRED = acHead(RUN, ROWS_T6.filter((r) => r[0] !== "A140"));
const EVT4 = {
  spi09: evMetrics({ bac: BAC, pv: cents(100_000), ev: cents(90_000), ac: cents(100_000) }),
  ac100001: evMetrics({ bac: BAC, pv: cents(100_000), ev: cents(90_000), ac: cents(100_001) }),
  ev0: evMetrics({ bac: BAC, pv: cents(100_000), ev: 0, ac: cents(50_000) }),
  pv0: evMetrics({ bac: BAC, pv: 0, ev: cents(90_000), ac: cents(100_000) }),
};
const CUT_0228_CAIRO = endOfLocalDay("2026-02-28", "Africa/Cairo");
const CUT_0228_CHICAGO = endOfLocalDay("2026-02-28", "America/Chicago");

/** The F2 rounding file (plan :385, :490). The network is a choice made here. */
const F2 = {
  durationHours: [40, 80, 12, 20, 4, 3],
  lagHours: [16, -16, 12, -12],
  totalFloatHours: -80,
  layout: "X100..X150 with target_drtn_hr_cnt = durationHours; X100->X110 FS +16 h, X110->X120 FS -16 h, X120->X130 FS +12 h, X130->X140 FS -12 h; X150 total_float_hr_cnt -80",
};
/** F3: SS predecessor that drives the finish (plan :385). */
const F3 = { A: 80, rel: "SS", lagHours: 16, B: 24 };
const F3D = { A: hoursToDays(F3.A), lag: lagHoursToDays(F3.lagHours), B: hoursToDays(F3.B) };
const SS_TODAY = cpm([{ id: "A", d: F3D.A }, { id: "B", d: F3D.B }], [{ p: "A", s: "B", t: "SS", lag: F3D.lag }]);
const SS_CAP = cpm([{ id: "A", d: F3D.A }, { id: "B", d: F3D.B }], [{ p: "A", s: "B", t: "SS", lag: F3D.lag }], { capLf: true });
const FSL_TODAY = cpm([{ id: "A", d: 10 }, { id: "B", d: 3 }], [{ p: "A", s: "B", t: "FS", lag: -8 }]);
const FSL_CAP = cpm([{ id: "A", d: 10 }, { id: "B", d: 3 }], [{ p: "A", s: "B", t: "FS", lag: -8 }], { capLf: true });
const FF_TODAY = cpm([{ id: "A", d: 10 }, { id: "B", d: 15 }], [{ p: "A", s: "B", t: "FF", lag: 0 }]);
const FF_CAP = cpm([{ id: "A", d: 10 }, { id: "B", d: 15 }], [{ p: "A", s: "B", t: "FF", lag: 0 }], { capLf: true });
const SF_TODAY = cpm([{ id: "A", d: 5 }, { id: "B", d: 4 }], [{ p: "A", s: "B", t: "SF", lag: 10 }]);
const SF_CAP = cpm([{ id: "A", d: 5 }, { id: "B", d: 4 }], [{ p: "A", s: "B", t: "SF", lag: 10 }], { capLf: true });
const MIXED = cpm([{ id: "A", d: 5 }, { id: "B", d: 2 }], [{ p: "A", s: "B", t: "FS", lag: 0 }]);

/** 087-SCH progress setup (plan :384). */
const METHODS_087SCH = {
  A110: { method: "percent" },
  A120: { method: "percent", evidenceRequired: true },
  A310: { method: "quantity", items: ["S-003"], plannedBasis: "approved allocations", planned: A310_PLANNED, unit: "m2" },
  A320: { method: "quantity", items: ["S-004", "S-005"], plannedBasis: "approved allocations", planned: A320_PLANNED, unit: "m2" },
  A210: { method: "weighted_milestone", weights: [20, 30, 50] },
  A230: { method: "inspection" },
  A300: null,
  A330: null,
  siteEngineerAssigned: CODES.filter((c) => c !== "A330"),
};
/** Progress file for the import test (area map workflow "Bulk progress" T2). */
const PROGRESS_FILE = { A110: 70, A130: 50, A310: 30 };

// ─── WP-0 stage-table rows ───────────────────────────────────────────────────

const STAGE2 = "backend/scripts/phase21/stage2-schedule.js";
const STAGE9 = "backend/scripts/phase21/stage9-progress-ev.js";
const fwdText = (code) => {
  const t = F1_TASKS.find((x) => x[0] === code);
  const r = CPM1.rows[code];
  return t[4] ? `ES = EF(${t[4]}) ${CPM1.rows[t[4]].EF} (FS, lag 0); EF = ${r.ES} + ${durOf(code)} = ${r.EF}` : `no predecessor: ES 0; EF = 0 + ${durOf(code)} = ${r.EF}`;
};
const bwdText = (code, rows = CPM1.rows, end = CPM1.end, d = durOf(code)) => {
  const succ = F1_TASKS.filter((t) => t[4] === code).map((t) => t[0]).filter((s) => rows[s]);
  const r = rows[code];
  return succ.length
    ? `LF = min(LS of FS successors ${succ.map((s) => `${s} ${rows[s].LS}`).join(", ")}) = ${r.LF}; LS = ${r.LF} - ${d} = ${r.LS}`
    : `no successor: LF = project end ${end}; LS = ${end} - ${d} = ${r.LS}`;
};

const WP0 = {
  "stage2:154": {
    A140: {
      TF: F(CPM1.rows.A140.TF, "working_days", `A140 is a spur: ${fwdText("A140")}; ${bwdText("A140")}; TF = LF - EF = ${CPM1.rows.A140.LF} - ${CPM1.rows.A140.EF} = ${CPM1.rows.A140.TF}. Replaces the 'float > 0' check.`, [P(452), `${STAGE2}:154 @${HEAD}`, H("backend/src/services/cpm.service.js", "459-503")]),
      EF: F(CPM1.rows.A140.EF, "working_days", fwdText("A140"), [P(452)]),
      LF: F(CPM1.rows.A140.LF, "working_days", bwdText("A140"), [P(452)]),
    },
    A300: {
      TF: F(CPM1.rows.A300.TF, "working_days", `A300 is a spur: ${fwdText("A300")}; ${bwdText("A300")}; TF = ${CPM1.rows.A300.LF} - ${CPM1.rows.A300.EF} = ${CPM1.rows.A300.TF}.`, [P(452), `${STAGE2}:154 @${HEAD}`]),
      EF: F(CPM1.rows.A300.EF, "working_days", fwdText("A300"), [P(452)]),
      LF: F(CPM1.rows.A300.LF, "working_days", bwdText("A300"), [P(452)]),
    },
    M900: {
      EF: F(CPM1.rows.M900.EF, "working_days", `Longest path 5+10+3+12+8+6+7+8+9+7+6+0 = ${CPM1.end}; M900 (duration 0) ES = EF = ${CPM1.rows.M900.EF}.`, [P(452), `${STAGE2}:12-13,166 @${HEAD}`]),
    },
    A110at20: {
      M900_EF: F(CPM2.rows.M900.EF, "working_days", `A110 10 -> 20 adds 10 days to every activity after it on the chain: 81 + 10 = ${CPM2.rows.M900.EF}.`, [P(452), `${STAGE2}:173-185 @${HEAD}`]),
      A140_TF: F(CPM2.rows.A140.TF, "working_days", `A140 (${CPM2.rows.A140.ES},${CPM2.rows.A140.EF},${CPM2.rows.A140.LS},${CPM2.rows.A140.LF}): LF 91 - EF 44 = ${CPM2.rows.A140.TF}; spurs keep their float because the finish moves with them.`, [P(452)]),
      A300_TF: F(CPM2.rows.A300.TF, "working_days", `A300 (${CPM2.rows.A300.ES},${CPM2.rows.A300.EF},${CPM2.rows.A300.LS},${CPM2.rows.A300.LF}): 91 - 71 = ${CPM2.rows.A300.TF}.`, [P(452)]),
    },
    restored: {
      M900_EF: F(CPM1.rows.M900.EF, "working_days", "A110 back to 10 days: the network is F1 again, M900 EF 81.", [P(452), `${STAGE2}:187-195 @${HEAD}`]),
    },
  },
  "stage9:135,153,218": {
    approvals: Object.fromEntries(["A110", "A120", "A130"].map((code) => [code, {
      http: F(200, "http", `PM approval of the ${code} submission answers 200 (asserted, no longer only noted).`, [P(456), `${STAGE9}:135,218 @${HEAD}`]),
      status: F("approved", "state", `The submission reads back with status 'approved'.`, [P(456)]),
    }])),
    officialProgress: {
      A110: F(100, "percent", "stage9 PROGRESS constant A110 100.", [P(456), `${STAGE9}:29 @${HEAD}`]),
      A120: F(50, "percent", "stage9 PROGRESS constant A120 50.", [P(456), `${STAGE9}:29 @${HEAD}`]),
      A130: F(25, "percent", "0 -> 25 in one clean pass (stage9:205-207).", [P(456), `${STAGE9}:205-207 @${HEAD}`]),
    },
    ev: {
      afterA110A120: F(evOf(ALLOC.A110, 100) + evOf(ALLOC.A120, 50), "cents", `From constants, not from the product's pct: 60,000.00 x 100% + 30,000.00 x 50% = ${fmt(evOf(ALLOC.A110, 100))} + ${fmt(evOf(ALLOC.A120, 50))} = ${fmt(evOf(ALLOC.A110, 100) + evOf(ALLOC.A120, 50))}.`, [P(456), `${STAGE9}:153 @${HEAD}`]),
      afterA130: F(EV_STAGE9, "cents", `75,000.00 + 90,000.00 x 25% (${fmt(evOf(ALLOC.A130, 25))}) = ${fmt(EV_STAGE9)} (= snapshot.js EXPECTED.earnedValue).`, [P(456), `${STAGE9}:227 @${HEAD}`, "backend/scripts/phase21/snapshot.js:53"]),
    },
    evReport: F(200, "http", "GET /reports/ev must answer 200; a failed report fails the stage instead of skipping its checks.", [P(456), `${STAGE9}:168,185,224 @${HEAD}`]),
  },
};

// ─── CLAUDE.md rule rows of §1.1 in this scope ───────────────────────────────

const CLAUDE = {
  TF: {
    A140: F(CPM1.rows.A140.TF, "working_days", "TF = LF - EF = 81 - 34 (WP1.T1.A140).", [P(63), "CLAUDE.md Key Business Rules"]),
    A300: F(CPM1.rows.A300.TF, "working_days", "TF = 81 - 61 (WP1.T1.A300).", [P(63)]),
    criticalOf14: F(CRITICAL1.length, "count", `TF = 0 on ${CRITICAL1.join(", ")}; the two spurs A140, A300 float.`, [P(63)]),
  },
  SPI: {
    value: F(r6(M_T1.spi), "ratio", `EV / PV = ${fmt(M_T1.ev)} / ${fmt(M_T1.pv)} = ${M_T1.spi} -> 0.251938 (6 dp).`, [P(64), "CLAUDE.md"]),
    alert: F(M_T1.spiAlert, "bool", "0.251938 < 0.9 -> alert.", [P(64)]),
  },
  CPI: {
    noAlert: F(r6(M_T1.cpi), "ratio", `EV / AC = ${fmt(M_T1.ev)} / ${fmt(M_T1.ac)} = ${M_T1.cpi}; not below 0.9 -> no alert.`, [P(65)]),
    noAlertFlag: F(M_T1.cpiAlert, "bool", "1.21875 >= 0.9.", [P(65)]),
    alert: F(r6(M_T2.cpi), "ratio", `${fmt(M_T2.ev)} / ${fmt(M_T2.ac)} = ${M_T2.cpi} -> 0.886364.`, [P(65)]),
    alertFlag: F(M_T2.cpiAlert, "bool", "0.886364 < 0.9 -> alert.", [P(65)]),
  },
  EAC: F(M_T1.eac, "cents", `Budget / CPI = 387,000.00 / 1.21875 = 387,000 x 80,000 / 97,500 = 317,538.4615... -> ${fmt(M_T1.eac)}.`, [P(66), "CLAUDE.md"]),
  XER: Object.fromEntries([40, 80, 12, 20, 4, 3].map((h) => [`h${h}`, F(hoursToDays(h), "working_days", `${h} h / 8 = ${h / 8} -> Math.round -> ${hoursToDays(h)} (half up).`, [P(68), "CLAUDE.md", H("backend/src/parsers/xer-parser.js", "40-44")])])),
  autoStatus: {
    pct0: F("todo", "state", "0% (not past its end) -> To Do.", [P(72), "CLAUDE.md"]),
    pct50: F("in_progress", "state", "1-99% (not past its end) -> In Progress.", [P(72)]),
    pct100: F("complete", "state", "100% -> Complete (outranks Delayed).", [P(72)]),
    pastEndBelow100: F("delayed", "state", "Past the end date and < 100% -> Delayed (outranks In Progress).", [P(72), H("backend/src/utils/activity-status.js", "29-35")]),
  },
};

// ─── WP-1 Schedule ───────────────────────────────────────────────────────────

const CPM_SRC = H("backend/src/services/cpm.service.js", "416-503");
const DATE_SRC = H("backend/src/services/cpm.service.js", "125-166,354-385,663-664");
function cpmRowLeaves(code) {
  const r = CPM1.rows[code];
  const src = [P(474, 478, 479, 480), CPM_SRC];
  return {
    ES: F(r.ES, "working_days", fwdText(code), src),
    EF: F(r.EF, "working_days", fwdText(code), src),
    LS: F(r.LS, "working_days", bwdText(code), src),
    LF: F(r.LF, "working_days", bwdText(code), src),
    TF: F(r.TF, "working_days", `TF = LF - EF = ${r.LF} - ${r.EF} = ${r.TF} (= LS - ES = ${r.LS} - ${r.ES}).`, [P(480), CPM_SRC, "CLAUDE.md"]),
    critical: F(r.critical, "bool", `TF ${r.TF} ${r.critical ? "<= 0 -> critical" : "> 0 -> not critical"}.`, [P(482), H("backend/src/services/cpm.service.js", "502")]),
    earlyStartDate: F(workingDate(START, r.ES), "date", `Working day ${r.ES} from Monday ${START} on five_day (${weekday(workingDate(START, r.ES))}).`, [P(474, 482), DATE_SRC]),
    earlyFinishDate: F(workingDate(START, r.EF), "date", `Working day ${r.EF} from ${START}, exclusive finish (the start of the next working day; HR-S7) (${weekday(workingDate(START, r.EF))}).`, [P(482, 994), DATE_SRC]),
    lateStartDate: F(workingDate(START, r.LS), "date", `Working day ${r.LS} from ${START}.`, [P(474), DATE_SRC]),
    lateFinishDate: F(workingDate(START, r.LF), "date", `Working day ${r.LF} from ${START}, exclusive.`, [P(474, 482), DATE_SRC]),
  };
}

const T1 = {
  network: {
    activities: F(F1_TASKS.length, "count", "F1 carries the 14 stage-2 activities.", [P(384, 474)]),
    links: F(NET1.links.length, "count", `13 FS links: ${NET1.links.map((l) => `${l.p}->${l.s}`).join(", ")}.`, [P(384, 500)]),
    wbsBranches: F(Object.keys(WBS).length, "count", "SUB, SUP, ARC.", [P(384)]),
    durations: F(Object.fromEntries(NET1.activities.map((a) => [a.id, a.d])), "working_days", "target_drtn_hr_cnt / 8: 40,80,24,96,32,64,48,56,64,80,72,56,48,0 h -> 5,10,3,12,4,8,6,7,8,10,9,7,6,0.", [P(384, 490), H("backend/src/parsers/xer-parser.js", "40-44,139")]),
    projectEnd: F(CPM1.end, "working_days", "max EF = EF(M900) = 81.", [P(482), H("backend/src/services/cpm.service.js", "449")]),
  },
  ...Object.fromEntries(CODES.map((c) => [c, cpmRowLeaves(c)])),
  criticalCount: F(CRITICAL1.length, "count", `Exactly the 11 longest-path activities plus M900: ${CRITICAL1.join(", ")}.`, [P(482), "backend/scripts/phase21/snapshot.js:116"]),
  criticalCodes: F(CRITICAL1, "list", "TF <= 0 rows.", [P(482)]),
  tfEqualsLfMinusEfEveryRow: F(CODES.every((c) => CPM1.rows[c].TF === CPM1.rows[c].LF - CPM1.rows[c].EF && CPM1.rows[c].TF === CPM1.rows[c].LS - CPM1.rows[c].ES), "bool", "Checked on all 14 rows: LF-EF = LS-ES (no clamp applies).", [P(482), H("backend/src/services/cpm.service.js", "495")]),
  capDoesNotChangeF1: F(JSON.stringify(CPM1.rows) === JSON.stringify(CPM1_CAPPED.rows), "bool", "Every F1 activity reaches the finish through FS links, so HR-S1's LF cap changes nothing here.", [P(988)]),
  A100endDate: F(workingDate(START, CPM1.rows.A100.EF), "date", "EF 5: one whole five-day week after Monday 2026-01-05 -> Monday 2026-01-12 (exclusive finish).", [P(482)]),
  M900earlyFinishDate: F(workingDate(START, CPM1.rows.M900.EF), "date", "81 = 16 weeks (80 working days, 112 calendar days -> Monday 2026-04-27) + 1 working day -> Tuesday 2026-04-28.", [P(482)]),
  M900lateFinishDate: F(workingDate(START, CPM1.rows.M900.LF), "date", "LF 81 -> 2026-04-28 (early and late agree).", [P(482)]),
  stagedSnapshot: {
    totalFloatHours: FA(Object.fromEntries(CODES.map((c) => [c, CPM1.rows[c].TF * 8]).filter(([, h]) => h !== 0)), "hours", "The generated F1 carries total_float_hr_cnt = TF x 8 (A140 47 x 8 = 376 h, A300 20 x 8 = 160 h, others 0), so the staged revision (judged on the file's float, HR-S3) reads the same critical path.", [P(384, 990), H("backend/src/services/import.service.js", "251-253")], { note: "a generation choice: the file's own float must agree with CPM until HR-S3 is decided" }),
    criticalCount: FA(CRITICAL1.length, "count", "Staged isCritical = round(file TF days) === 0: 12 rows with 0 h.", [H("backend/src/services/import.service.js", "253,331")]),
    A200physComplete: F(40, "percent", "phys_complete_pct 40 on A200 is staged (and written to Activity.physComplete at activation) but is never approved progress.", [P(384, 513), H("backend/src/services/schedule.service.js", "1607")]),
    M900startEqualsFinish: F(workingDate(START, CPM1.rows.M900.ES), "date", "F1's M900 carries early_start_date = early_end_date = 2026-04-28 (HR-S2 reproduction).", [P(384, 521)]),
  },
};

const T2 = {
  A110duration: F(20, "working_days", "PATCH A110 duration 20 (stage 2.4).", [P(483)]),
  M900_EF: F(CPM2.rows.M900.EF, "working_days", "81 + (20 - 10) = 91.", [P(483)]),
  M900date: F(workingDate(START, CPM2.rows.M900.EF), "date", "91 = 18 weeks (90 working days -> Monday 2026-05-11) + 1 -> Tuesday 2026-05-12.", [P(483)]),
  A140: { ES: F(CPM2.rows.A140.ES, "working_days", "EF(A130) 40.", [P(483)]), EF: F(CPM2.rows.A140.EF, "working_days", "40 + 4.", [P(483)]), LF: F(CPM2.rows.A140.LF, "working_days", "project end 91.", [P(483)]), TF: F(CPM2.rows.A140.TF, "working_days", "91 - 44 = 47 (unchanged).", [P(483)]) },
  A300: { ES: F(CPM2.rows.A300.ES, "working_days", "EF(A220) 61.", [P(483)]), EF: F(CPM2.rows.A300.EF, "working_days", "61 + 10.", [P(483)]), LF: F(CPM2.rows.A300.LF, "working_days", "project end 91.", [P(483)]), TF: F(CPM2.rows.A300.TF, "working_days", "91 - 71 = 20 (unchanged).", [P(483)]) },
  criticalCount: F(CODES.filter((c) => CPM2.rows[c].critical).length, "count", "The same 12 stay critical.", [P(483)]),
  idsUnchanged: F(14, "count", "The 14 activity ids are the same before and after (recalculation invents nothing).", [P(483), `${STAGE2}:180-181 @${HEAD}`]),
  restored: {
    M900_EF: F(CPM1.rows.M900.EF, "working_days", "A110 back to 10: 81.", [P(483)]),
    M900date: F(workingDate(START, CPM1.rows.M900.EF), "date", "2026-04-28 again.", [P(483)]),
  },
};

const capNote = "Expected under HR-S1's recommendation (cap LF at the project finish, plan :988), which is not yet decided; the plan states this expectation and that it fails today.";
const T3 = {
  inputs: {
    A_duration: F(F3D.A, "working_days", `F3: A ${F3.A} h / 8 = ${F3D.A}.`, [P(385, 485)]),
    SS_lag: F(F3D.lag, "working_days", `SS +${F3.lagHours} h / 8 = ${F3D.lag}.`, [P(385, 485)]),
    B_duration: F(F3D.B, "working_days", `B ${F3.B} h / 8 = ${F3D.B}.`, [P(385, 485)]),
  },
  A: {
    ES: F(SS_CAP.rows.A.ES, "working_days", "No predecessor.", [P(485)]),
    EF: F(SS_CAP.rows.A.EF, "working_days", "0 + 10; A drives the finish (project end 10).", [P(485)]),
    LS: FA(SS_CAP.rows.A.LS, "working_days", `LF 10 - 10. ${capNote}`, [P(485, 988)], { today: SS_TODAY.rows.A.LS }),
    LF: FA(SS_CAP.rows.A.LF, "working_days", `SS backward candidate = LS(B) 7 - lag 2 + d 10 = 15, capped at the project end 10. Today LF = 15 (no cap). ${capNote}`, [P(485, 988), H("backend/src/services/cpm.service.js", "471-473,485")], { today: SS_TODAY.rows.A.LF }),
    TF: FA(SS_CAP.rows.A.TF, "working_days", `TF = 10 - 10 = 0; today 15 - 10 = 5. ${capNote}`, [P(485)], { today: SS_TODAY.rows.A.TF }),
    critical: FA(SS_CAP.rows.A.critical, "bool", `TF 0 -> critical; today TF 5 -> the network has no critical activity. ${capNote}`, [P(485, 521)], { today: SS_TODAY.rows.A.critical }),
  },
  B: {
    ES: F(SS_TODAY.rows.B.ES, "working_days", "ES = ES(A) 0 + lag 2 = 2.", [P(485)]),
    EF: F(SS_TODAY.rows.B.EF, "working_days", "2 + 3 = 5.", [P(485)]),
    LS: F(SS_TODAY.rows.B.LS, "working_days", "10 - 3 = 7.", [P(485)]),
    LF: F(SS_TODAY.rows.B.LF, "working_days", "No successor: project end 10.", [P(485)]),
    TF: F(SS_TODAY.rows.B.TF, "working_days", "10 - 5 = 5 (same today and capped).", [P(485)]),
  },
  criticalCount: FA(Object.values(SS_CAP.rows).filter((r) => r.critical).length, "count", `Capped: A only. ${capNote}`, [P(485)], { today: Object.values(SS_TODAY.rows).filter((r) => r.critical).length }),
};

const T4 = {
  FSlead: {
    B_ES: F(FSL_TODAY.rows.B.ES, "working_days", "A(10) FS -8 -> B(3): ES = 10 - 8 = 2.", [P(486)]),
    B_EF: F(FSL_TODAY.rows.B.EF, "working_days", "2 + 3 = 5.", [P(486), AREA]),
    A_TF: FA(FSL_CAP.rows.A.TF, "working_days", `Backward candidate LS(B) 7 - (-8) = 15 -> capped 10, TF 0; today LF 15, TF 5. ${capNote}`, [P(486), AREA], { today: FSL_TODAY.rows.A.TF }),
  },
  FF: {
    inputs: FA({ A: 10, B: 15, lag: 0 }, "working_days", "A(10) FF+0 -> B(15): the durations come from the area map (the plan states only the result).", [P(487), AREA]),
    B_ES: F(FF_TODAY.rows.B.ES, "working_days", "Candidate EF(A) 10 + 0 - 15 = -5, clamped at 0.", [P(487), H("backend/src/services/cpm.service.js", "432-433,444")]),
    B_EF: F(FF_TODAY.rows.B.EF, "working_days", "0 + 15 = 15 (the project end).", [P(487)]),
    A_LF: F(FF_TODAY.rows.A.LF, "working_days", "FF backward: LF(B) 15 - 0 = 15 (the cap changes nothing: 15 = project end).", [P(487)]),
    A_TF: F(FF_TODAY.rows.A.TF, "working_days", "15 - 10 = 5, today and capped alike.", [P(487)]),
    B_TF: F(FF_TODAY.rows.B.TF, "working_days", "15 - 15 = 0.", [P(487)]),
  },
  SF: {
    inputs: FA({ A: 5, B: 4, lag: 10 }, "working_days", "A(5) SF+10 -> B(4) (area map; the plan states only B ES 6, EF 10).", [P(488), AREA]),
    B_ES: F(SF_TODAY.rows.B.ES, "working_days", "ES(A) 0 + 10 - 4 = 6.", [P(488)]),
    B_EF: F(SF_TODAY.rows.B.EF, "working_days", "6 + 4 = 10.", [P(488)]),
    A_TF: F(SF_TODAY.rows.A.TF, "working_days", "SF backward: LF(B) 10 - 10 + 5 = 5 = EF(A) -> TF 0 (capped alike).", [P(488)]),
    B_TF: F(SF_TODAY.rows.B.TF, "working_days", "10 - 10 = 0.", [P(488)]),
  },
};

const WP1 = {
  T1,
  T2,
  T3,
  T4,
  cycle: {
    refusal: F("400 CPM_DEPENDENCY_CYCLE", "http", "A -> B -> A: no topological order exists; refused before any write.", [P(468, 489), H("backend/src/services/activity-dependency.service.js", "304"), H("backend/src/services/cpm.service.js", "343-349")]),
    rowsChanged: F(0, "count", "The updatedAt fingerprint of every activity is the same before and after.", [P(489)]),
    selfLink: F("400 INVALID_DEPENDENCY_SELF_LINK", "http", "A -> A is refused as a self link.", [H("backend/src/services/activity-dependency.service.js", "203")]),
  },
  mixedCalendar: {
    A_finishDate: F(workingDate(START, MIXED.rows.A.EF, "five_day"), "date", "A five_day 5 d from 2026-01-05: EF 5 -> 2026-01-12.", [P(489)]),
    B_startNoEarlierThan: FA(workingDate(START, MIXED.rows.A.EF, "five_day"), "date", "B (seven_day 2 d, FS) must start on or after A's finish 2026-01-12. HR-S5 (undecided) recommends refusing a calendar that differs from the project's with 400 until CPM handles calendars; either outcome passes, a date before 2026-01-12 fails.", [P(489, 992)], { today: workingDate(START, MIXED.rows.B.ES, "seven_day") }),
    todayWeekday: F(weekday(workingDate(START, MIXED.rows.B.ES, "seven_day")), "text", "Today B's offset 5 is dated on the seven-day calendar from 2026-01-05: 2026-01-10, a Saturday (the defect reproduced).", [P(489), H("backend/src/services/cpm.service.js", "354-385")]),
  },
  conversion: {
    durations: Object.fromEntries(F2.durationHours.map((h) => [`h${h}`, F(hoursToDays(h), "working_days", `${h} / 8 = ${h / 8} -> Math.round -> ${hoursToDays(h)}.`, [P(490, 464), H("backend/src/parsers/xer-parser.js", "40-44")], h === 3 ? { note: "HR-S4 recommends that a task with hours never becomes 0 days unless it is a milestone (would be 1); undecided" } : {})])),
    lags: Object.fromEntries(F2.lagHours.map((h) => [`h${h > 0 ? "+" : ""}${h}`, F(lagHoursToDays(h), "working_days", `${h} / 8 = ${h / 8} -> Math.round (half toward +inf) -> ${lagHoursToDays(h)}.`, [P(490), H("backend/src/parsers/xer-parser.js", "46-50")], h === -12 ? { note: "HR-S4 recommends symmetric rounding (-12 h -> -2); undecided" } : {})])),
    totalFloatMinus80h: F(hoursToDays(F2.totalFloatHours), "working_days", "-80 / 8 = -10 -> max(0, -10) = 0 in the staged snapshot.", [P(490), H("backend/src/parsers/xer-parser.js", "43,147")]),
    activeEqualsStaged: F("equal", "state", "After activation each duration on /activities equals the staged value.", [P(464), AREA]),
    rangeBoundary: {
      atMax: FA(hoursToDays(36_500 * 8), "working_days", "292,000 h / 8 = 36,500 = SCHEDULE_DAYS_MAX: staged.", [P(465), H("backend/src/utils/schedule-days.js", "18"), H("backend/src/services/import.service.js", "170-193")]),
      beyondMax: FA("400 SCHEDULE_FIGURE_OUT_OF_RANGE", "http", "292,004 h / 8 = 36,500.5 -> 36,501 > 36,500: the whole file is refused, nothing staged.", [P(465), H("backend/src/services/import.service.js", "186-191")]),
    },
  },
  parity: {
    p6xml: F("identical", "state", "P6 XML uses the same hours / 8 (clamp) and lag rounding: durations, links and lags equal F1's.", [P(491), H("backend/src/parsers/p6xml-parser.js", "48-58")]),
    mspdiDurations: F([40, 80, 12, 20, 4, 3].map(mspDurationDays), "working_days", "PT40H0M0S.. PT3H0M0S: hours/8 + minutes/480, Math.round, clamp -> 5,10,2,3,1,0 (same as XER).", [P(491), H("backend/src/parsers/msp-parser.js", "19-42")]),
    mspdiLags: F([9600, -9600, 7200, -7200].map(tenthsToDays), "working_days", "LinkLag in tenths of a minute: +-16 h = +-9,600, +-12 h = +-7,200; /4,800, Math.round -> 2, -2, 2, -1 (same as XER).", [P(491), H("backend/src/parsers/msp-parser.js", "46-52")]),
    mspNegativeSlackDays: F(tenthsToDays(-48_000), "working_days", "TotalSlack -80 h = -48,000 tenths -> -10 days (MSP keeps the sign; no clamp).", [P(492), H("backend/src/parsers/msp-parser.js", "48-52")]),
    mspNegativeSlackCritical: FA(true, "bool", "TF -10 <= 0 -> critical, as the engine rules (cpm.service.js:502). HR-S3 (undecided) recommends critical = TF <= 0 for every format.", [P(492, 990)], { today: false, note: "today import.service.js:253 marks isCritical only when round(TF) === 0" }),
    xlsx: F("identical", "state", "xlsx with a calendar column stages the same durations, links and lags.", [P(385, 491)]),
  },
  imports: {
    twoProjectXer: FA("refused_or_project_choice", "state", "F4 (two PROJECT rows): refused, or the user is asked which project (HR-S4 recommendation, undecided).", [P(385, 493, 991)], { today: "merged (TASK rows of both projects staged)" }),
    windows1252: FA("names_decoded", "state", "F5 Windows-1252 names (e.g. 'B\u00e9ton arm\u00e9 \u2013 niveau 1') stage as written (HR-S4: detect Windows-1252).", [P(385, 529, 991)], { today: "read as UTF-8 (replacement characters)" }),
    secondCalendar: FA("recorded (P2)", "state", "F6: a second clndr_id; HR-S4 records calendars as P2.", [P(385, 991)], { today: "an unknown clndr_id falls back to the project calendar five_day (cpm.service.js:80-92)" }),
    xlsxDryRun: {
      revisionsCreated: F(0, "count", "dryRun=true writes no revision.", [P(494), H("backend/src/services/import.service.js", "563-610")]),
      documentsCreated: F(0, "count", "dryRun=true writes no document.", [P(494)]),
    },
    siteEngineer: F("403 FORBIDDEN", "http", "POST /import/xer needs schedule:create (PM, planning engineer); RBAC refuses with FORBIDDEN.", [P(495), H("backend/src/middleware/rbac.js", "149-153")]),
    outsider: F("404 PROJECT_NOT_FOUND", "http", "Another company's member (PM of 088).", [P(366, 495)]),
  },
  revisions: {
    submitByPlanner: F("under_review", "state", "draft -> under_review.", [P(461, 496), H("backend/src/services/schedule.service.js", "3686-3762")]),
    roles: {
      siteEngineerSubmit: F("403 FORBIDDEN", "http", "schedule:submit is the PM's and the planner's; the site engineer is refused.", [P(470), H("backend/src/middleware/rbac.js", "149-153")]),
      plannerActivate: F("403 FORBIDDEN", "http", "Activation is the PM's (revision.activate).", [P(470), AREA]),
      outsider: F("404 PROJECT_NOT_FOUND", "http", "PM of 088 on any revision route.", [P(366, 470)]),
    },
    approve: {
      planner: F("403 FORBIDDEN", "http", "Approval is the PM's (role gate).", [P(470, 497)]),
      siteEngineer: F("403 FORBIDDEN", "http", "Role gate.", [P(497)]),
      pm: F("approved", "state", "under_review -> approved. HR-S2 (decided): M900's equal start and finish does not fail date_sanity.", [P(30, 497, 989)], { today: "400 SCHEDULE_NOT_READY (date_sanity: finish_date_before_start_date on M900)" }),
    },
    rejectApproved: F("409 INVALID_REVISION_STATUS", "http", "Reject is allowed from under_review only (sent with a reason, so the status guard answers).", [P(498), H("backend/src/services/schedule.service.js", "1087,3866")]),
    rejectWithoutReason: F("400 REJECTION_REASON_REQUIRED", "http", "On an under_review revision with no reason.", [P(466, 498), H("backend/src/services/schedule.service.js", "3870")]),
    hrS3Reproduction: {
      file: FA({ basedOn: "F1", totalFloatHours: HR_S3_FLOAT_HOURS }, "text", `F1 with every task's total_float_hr_cnt >= 40 h (5 days): max(TF, 5) x 8 -> the 12 CPM-critical rows 5 x 8 = 40 h, A140 47 x 8 = 376 h, A300 20 x 8 = 160 h. Staged isCritical = round(file TF days) === 0 marks ${HR_S3_STAGED_CRITICAL} rows. Staged as a draft in 087-IMP (the scratch import project; a choice).`, [P(523, 990), H("backend/src/services/import.service.js", "251-253"), ADJ("S2 HR-S3 reproduction")]),
      approve: FA("approved", "state", `HR-S3 recommendation (undecided): readiness runs CPM on the snapshot, and critical means TF <= 0 for every format. Recomputed, the F1 network has ${CRITICAL1.length} rows at TF 0 (WP1.T1), so critical_path passes and PM approval succeeds (with HR-S2's decided milestone rule for M900's date_sanity).`, [P(523, 990), ADJ("S2 HR-S3 reproduction")], { today: "400 SCHEDULE_NOT_READY, two blocking approval checks fail: critical_path ('No critical path activities are marked.': the file's float marks none; schedule.service.js:397,849-866) and date_sanity (finish_date_before_start_date on M900, whose start equals its finish; schedule.service.js:679-687)" }),
    },
    activate: {
      noMapping: F("400 MAPPING_CONFIRMATION_REQUIRED", "http", "Active activities exist and neither mappings nor removals were sent.", [P(499), H("backend/src/services/schedule.service.js", "3104-3113")]),
      unmappedNoReason: F("400 UNMAPPED_REMOVAL_REASON_REQUIRED", "http", "One active activity left unmapped without a removal reason.", [P(499), H("backend/src/services/schedule.service.js", "3149-3160")]),
      unmappedNamed: FA(1, "count", "details.unmappedExisting names exactly the one left out (A140 in this book's choreography).", [P(499)]),
      full: F("active", "state", "isActive true; the previous active revision is superseded; CPM runs inside the activation transaction.", [P(467, 500), H("backend/src/services/schedule.service.js", "3402-3436")]),
      record: {
        updated: FA(14, "count", "Choreography chosen here: F1 is activated over the hand-built stage-2 programme of 087-SCH (14 activities, codes A100..M900), all 14 mapped by code -> updated 14.", [P(500, 502), AREA, ADJ("open questions: activation choreography")], { note: "plan :500 names the counts but not the hand-built set; the choreography (14 hand-built, all mapped) is accepted by the integration owner as an assumption" }),
        new: FA(0, "count", "14 staged - 14 mapped = 0.", [P(500)]),
        retired: FA(0, "count", "14 existing - 14 mapped = 0 (the retirement is F1b's).", [P(500)]),
        dependencyCount: F(NET1.links.length, "count", "F1 carries 13 FS links (WP1.T1.network.links).", [P(500)]),
      },
      mappedKeepApprovedProgress: F("kept", "state", "Mapped ids keep their ActivityProgress rows and pct.", [P(500)]),
      again: F("409 REVISION_ALREADY_ACTIVE", "http", "Activating the active revision again.", [P(501), H("backend/src/services/schedule.service.js", "3057")]),
      olderRevision: F("409 REVISION_NOT_CURRENT", "http", "Only the active revision or the latest candidate may move.", [P(501), H("backend/src/services/schedule.service.js", "999")]),
      concurrent: FA({ succeeded: 1, refused: { status: 409, code: null } }, "text", "Observation (plan :530, low): two activations of approved revisions sent at once. Expected (assumption): serialised, one wins and the other is refused 409; the code stays null (undecided, never guessed). Recorded, not a gate.", [P(530), ADJ("S2 concurrent activations / period locks")], { today: "not serialised (plan :530); no row or advisory lock in schedule.service.js @886c9f1" }),
    },
    secondImport: {
      openDraft: F("superseded", "state", "A second import supersedes only the open draft.", [P(501), H("backend/src/services/import.service.js", "65-91")]),
      activeRevision: F("unchanged", "state", "The active revision is untouched.", [P(501)]),
    },
    mapByCode: {
      matchType: F("activity_code", "state", "XER task_code A100 is suggested onto the hand-built activityCode A100 by code.", [P(502), H("backend/src/services/schedule.service.js", "1512-1560")], { today: "not activity_code (byActivityCode is built from staged.activityCode, which XER leaves null; wbs_code or name match)" }),
      activityCodeAfterActivation: F("A100", "text", "Defect fix (plan :1068): activation keeps the activity code.", [P(524, 1068)], { today: null }),
      budgetAfterActivation: F("kept", "state", "Defect fix (plan :1068): activation keeps the budget.", [P(524, 1068), H("backend/src/services/schedule.service.js", "1613")], { today: 0 }),
    },
    F1b: {
      file: FA({ basedOn: "F1", A110_hours: 160, retired: ["A140"] }, "text", "Choice made here: F1b = F1 with A110 160 h and A140 left out (the one retirement; a spur, so the critical path is unchanged).", [P(384)]),
      A110days: F(hoursToDays(160), "working_days", "160 / 8 = 20.", [P(384)]),
      record: {
        updated: FA(13, "count", "13 F1b activities mapped onto F1's by code.", [P(384)]),
        new: FA(0, "count", "Nothing new.", [P(384)]),
        retired: FA(1, "count", "A140 with a removal reason.", [P(384)]),
        dependencyCount: FA(NETB.links.length, "count", "13 F1 links minus A130->A140 = 12.", [P(384)]),
      },
      M900_EF: FA(CPMB.rows.M900.EF, "working_days", "81 + 10 = 91.", [P(384)]),
      A300_TF: FA(CPMB.rows.A300.TF, "working_days", "91 - 71 = 20.", [P(384)]),
      previousRevision: FA("superseded", "state", "F1's revision is superseded by F1b's activation.", [P(461)]),
    },
    rollback: {
      M900_EF: FA(CPM1.rows.M900.EF, "working_days", "Rolling back from F1b to F1 restores A110 = 10 and A140: 81.", [P(461), H("backend/src/services/schedule.service.js", "3517-3600")]),
      A140id: FA("same id as before the retirement", "state", "Rollback keeps ids (WP-9 :957).", [P(957)]),
    },
  },
  baseline: {
    noBoq: F("400 BOQ_REQUIRED_FOR_BASELINE", "http", "Checked first, before the revision is read.", [P(469, 504), H("backend/src/services/schedule.service.js", "1156-1166,3936-3938")]),
    zeroRated: F("400 BOQ_VALUE_REQUIRED_FOR_BASELINE", "http", "Rows exist but the priced sum is <= one cent.", [P(504), H("backend/src/services/schedule.service.js", "1168-1178")]),
    allOutOfScope: F("400 BOQ_SCOPE_REQUIRED_FOR_BASELINE", "http", "Priced rows exist but all are optional / not_applicable.", [P(504), H("backend/src/services/schedule.service.js", "1179-1194")]),
    notActivated: F("409 REVISION_NOT_ACTIVATED", "http", "An approved revision still staged.", [P(469, 504), H("backend/src/services/schedule.service.js", "3952-3958")]),
    unallocated: {
      refusal: F("400 SCHEDULE_NOT_READY", "http", "Activated, but in-scope BOQ value is not fully allocated (the message names BOQ allocations).", [P(504), H("backend/src/services/schedule.service.js", "3964-3971")]),
      unallocatedAmount: FA(S006, "cents", `S-006 ${fmt(S006)} in scope and unallocated.`, [P(384, 504), ADJ("open questions: S-006")], { note: S006_NOTE }),
      allocatedAmount: FA(ALLOCATED_FIVE, "cents", `60,000 + 120,000 (30,000 + 90,000) + 135,000 + 48,000 + 24,000 = ${fmt(ALLOCATED_FIVE)}.`, [P(384, 546)]),
      inScopePriced: FA(IN_SCOPE_PRICED, "cents", `S-001..S-006 = ${fmt(IN_SCOPE_PRICED)} (S-007 optional 5,000.00 and S-008 not applicable 4,000.00 are out of scope).`, [P(384)]),
      coveragePercent: FA(Number(((ALLOCATED_FIVE / IN_SCOPE_PRICED) * 100).toFixed(2)), "percent", `${fmt(ALLOCATED_FIVE)} / ${fmt(IN_SCOPE_PRICED)} = ${((ALLOCATED_FIVE / IN_SCOPE_PRICED) * 100).toFixed(4)}% -> 84.31.`, [P(384, 773)]),
    },
    covered: {
      coverAllocation: FA({ row: "S-006", activity: "A220", quantity: 1200, amount: S006 }, "text", "Choice made here, accepted by the integration owner: S-006 slab screed is allocated to A220 at the baseline step (A220 carries no progress test, so no WP-2 figure moves).", [P(384), ADJ("open questions: S-006")], { note: S006_NOTE }),
      http: F(200, "http", "Every gate passes.", [P(505)]),
      locked: F(14, "count", "14 active activities get baselineStart/baselineFinish.", [P(505), H("backend/src/services/schedule.service.js", "4041-4050")]),
      status: F("baselined", "state", "Revision status baselined.", [P(505)]),
      equalsEarly: F(Object.fromEntries(CODES.map((c) => [c, [CPM1.rows[c].ES, CPM1.rows[c].EF]])), "working_days", "baselineStart = earlyStart and baselineFinish = earlyFinish on every row (WP1.T1).", [P(469, 505), H("backend/src/services/schedule.service.js", "4046")]),
      A300: F([CPM1.rows.A300.ES, CPM1.rows.A300.EF], "working_days", "A300 51/61.", [P(505)]),
      M900: F([CPM1.rows.M900.ES, CPM1.rows.M900.EF], "working_days", "M900 81/81.", [P(505)]),
      auditEvents: F(1, "count", "One BASELINE_LOCKED audit event.", [P(505), H("backend/src/services/schedule.service.js", "4069-4086")]),
      totalAllocated: FA(ALLOCATED_FIVE + S006, "cents", `${fmt(ALLOCATED_FIVE)} + ${fmt(S006)} = ${fmt(ALLOCATED_FIVE + S006)}: 087-SCH's EV budget after the baseline step.`, [P(384), ADJ("open questions: S-006")], { note: `plan :546 lists the five WP-2 allocations only; the sixth (S-006 on A220) does not move any WP-2 figure. ${S006_NOTE}` }),
    },
    planner: F("403 FORBIDDEN", "http", "Baseline is the PM's.", [P(470, 505)]),
    handBuilt: FA({ status: null, code: null, rule: "HR-S8: refused with a message that a baseline needs an import or AI generation; status and code chosen by the fix" }, "text", "L124 / HR-S8 reproduction: the baseline lock of a hand-built programme (activities created in the product, no schedule revision) on a project whose priced in-scope BOQ is fully allocated to those activities, so the BOQ gates, checked first (schedule.service.js:3937-3938), pass. Expected (HR-S8 recommendation, undecided, assumption): 'Phase 1: a baseline needs an import or AI generation, and the UI says so; an in-product revision is P2', so the lock is refused with a message that says so. HR-S8 names no status or code, so both stay null (chosen by the fix, never guessed).", [P(525, 995), H("backend/src/services/schedule.service.js", "973-978,3937-3944"), ADJ("S2 L124 / HR-S8")], { today: "404 REVISION_NOT_FOUND ('No schedule revision exists yet: import a P6/MSP schedule or generate one from the BOQ on the Schedule page.')", note: "the integration owner corrects the earlier adjudication (S2 L124 / HR-S8, which recorded a success status): HR-S8's recommendation is a refusal that says a baseline needs an import or AI generation, not a success" }),
    afterA110at20: {
      M900_EF: F(CPM2.rows.M900.EF, "working_days", "CPM moves the finish to 91.", [P(506)]),
      M900_baselineFinish: F(CPM1.rows.M900.EF, "working_days", "The locked baseline stays 81.", [P(506)]),
      variance: F(CPM2.rows.M900.EF - CPM1.rows.M900.EF, "working_days", "91 - 81 = 10.", [P(506)]),
    },
    secondBaseline: F("superseded", "state", "A second baseline supersedes the first (status superseded).", [P(506), H("backend/src/services/schedule.service.js", "3993-4039")]),
  },
  dates: {
    renameM900: F(200, "http", "PATCH M900 {name} after CPM: HR-S2 (decided) makes start = end valid for a zero-duration activity.", [P(30, 508, 989)], { today: "400 INVALID_DATES" }),
    readinessDateSanity: F(true, "bool", "date_sanity passes with M900 in the schedule.", [P(509, 989)], { today: false }),
    startMovedTo0112: {
      beforeBaseline_M900date: FA(workingDate("2026-01-12", CPM1.rows.M900.EF), "date", "HR-S6 recommendation (undecided): recalculate on change. 81 working days from Monday 2026-01-12 -> Tuesday 2026-05-05; stored endDate and derived early finish agree.", [P(510, 993), AREA], { today: "endDate stays 2026-04-28 while earlyFinishDate becomes 2026-05-05" }),
      afterBaseline: {
        http: FA(409, "http", "HR-S6 recommendation (undecided): refuse a start/calendar change after a baseline lock unless re-baselined. Code null (not named; never guessed).", [P(510, 993), ADJ("S2 WP1.dates")], { today: 200 }),
        baselineFinishDate: FA(workingDate(START, CPM1.rows.M900.EF), "date", `HR-S6 recommendation (undecided): the locked baseline does not move. M900's baselineFinish is its early finish at the lock: working day ${CPM1.rows.M900.EF} from Monday ${START} = ${workingDate(START, CPM1.rows.M900.EF)} (WP1.baseline.covered.M900). Today the start change re-dates it: working day ${CPM1.rows.M900.EF} from Monday 2026-01-12 = ${workingDate("2026-01-12", CPM1.rows.M900.EF)}.`, [P(510, 527, 993), ADJ("S2 WP1.dates")], { today: workingDate("2026-01-12", CPM1.rows.M900.EF) }),
      },
    },
  },
  status: {
    now: F("2026-06-01T00:00:00.000Z", "instant", "The injected now for the pure boundaries.", [P(511)]),
    boundaries: Object.fromEntries([
      ["pct0_future", 0, "2026-07-01"], ["pct0_5_future", 0.5, "2026-07-01"], ["pct99_99_future", 99.99, "2026-07-01"], ["pct100_past", 100, "2026-01-01"],
      ["pct40_endJustBeforeNow", 40, "2026-05-31T23:59:59.000Z"], ["pct0_past", 0, "2026-05-01"], ["pct0_endEqualsNow", 0, "2026-06-01T00:00:00.000Z"], ["pct40_endEqualsNow", 40, "2026-06-01T00:00:00.000Z"],
    ].map(([k, pct, end]) => [k, F(deriveStatus(pct, end, "2026-06-01T00:00:00.000Z"), "state", `pct ${pct}, end ${end}, now 2026-06-01T00:00Z: ${pct >= 100 ? "complete outranks" : new Date(end) < new Date("2026-06-01T00:00:00Z") ? "end < now -> delayed" : pct > 0 ? "end not before now, pct > 0 -> in progress" : "end not before now, pct 0 -> todo"}.`, [P(511), H("backend/src/utils/activity-status.js", "29-35")], k.endsWith("endEqualsNow") ? { note: "end date equal to now is not delayed (strict <)" } : {})])),
    surfacesAgree: F("agree", "state", "/activities, /schedule, the XLSX export, the report source, search, lookahead and assistant retrieval give the same status per activity.", [P(512)]),
    A200fileFortyPercent: {
      pct: F(0, "percent", "Never approved: official pct 0 on every surface (HR-P5 recommendation: approved progress only).", [P(513, 1001)], { today: "lookahead and export show 40; search shows in_progress" }),
      status: FA(deriveStatus(0, workingDate(START, CPM1.rows.A200.EF), `${RUN}T00:00:00.000Z`), "state", `pct 0 and A200's end ${workingDate(START, CPM1.rows.A200.EF)} (EF 38) is before the run date -> delayed.`, [P(513)], { today: "search: in_progress" }),
    },
    unapproved60: F("unchanged", "state", "A submitted (unapproved) 60 on A110 changes neither pct nor status anywhere.", [P(514)]),
    live087SCH: {
      A100approved100: FA(deriveStatus(100, workingDate(START, CPM1.rows.A100.EF), `${RUN}T00:00:00.000Z`), "state", "Area map T2: A100 approved 100 -> complete (complete outranks delayed).", [P(512), AREA]),
      A110at40: FA(deriveStatus(40, workingDate(START, CPM1.rows.A110.EF), `${RUN}T00:00:00.000Z`), "state", `A110 40% (WP-2 T1) and end ${workingDate(START, CPM1.rows.A110.EF)} before the run date -> delayed.`, [P(512), AREA]),
      tailBeforeProgress: FA(deriveStatus(0, workingDate(START, CPMT.rows.T900.EF), `${RUN}T00:00:00.000Z`), "state", `T900 pct 0, end ${workingDate(START, CPMT.rows.T900.EF)} after the run date -> todo.`, [P(384, 512)]),
      tailAt30: FA(deriveStatus(30, workingDate(START, CPMT.rows.T900.EF), `${RUN}T00:00:00.000Z`), "state", "T900 approved 30 -> in progress.", [P(384, 512), AREA]),
    },
  },
  tail: {
    definition: FA(TAIL, "text", "Choice made here: a hand-built T900 of 200 working days, FS after M900, added only after the CPM and baseline checks (plan :384) so it ends in 2027.", [P(384)]),
    ES: FA(CPMT.rows.T900.ES, "working_days", "ES = EF(M900) 81.", [P(384)]),
    EF: FA(CPMT.rows.T900.EF, "working_days", "81 + 200 = 281.", [P(384)]),
    TF: FA(CPMT.rows.T900.TF, "working_days", "It now ends the network: LF = project end 281; TF 0.", [P(384)]),
    earlyStartDate: FA(workingDate(START, CPMT.rows.T900.ES), "date", "Working day 81 -> 2026-04-28.", [P(384)]),
    earlyFinishDate: FA(workingDate(START, CPMT.rows.T900.EF), "date", "281 = 56 weeks (280 working days, 392 calendar days -> Monday 2027-02-01) + 1 -> Tuesday 2027-02-02 (in 2027).", [P(384)]),
    projectEnd: FA(CPMT.end, "working_days", "max EF = 281.", [P(384)]),
    M900_TF: FA(CPMT.rows.M900.TF, "working_days", "M900 now has a successor: LF = LS(T900) 81 -> TF 0 (still critical).", [P(384)]),
    A140_TF: FA(CPMT.rows.A140.TF, "working_days", "A140 LF moves to the new end 281: 281 - 34 = 247.", [P(384)]),
    A300_TF: FA(CPMT.rows.A300.TF, "working_days", "281 - 61 = 220.", [P(384)]),
    criticalCount: FA(Object.values(CPMT.rows).filter((r) => r.critical).length, "count", "The 12 plus T900 = 13.", [P(384)]),
    baseline: FA(null, "state", "Added after the lock: no baselineStart/baselineFinish until a new baseline.", [P(384)]),
  },
  mutations: {
    tfLessThanZero: F("WP1.T1 red", "state", "tf <= 0 -> tf < 0: the 12 critical rows still have TF 0 but are no longer critical; criticalCount 12 fails.", [P(516)]),
    dropSsBackward: F("WP1.T3 red", "state", "Without the SS branch, A's backward candidate falls to FS: LS(B) 7 - 2 = 5 -> TF -5; T3's A figures fail.", [P(516)]),
    dropBoqGate: F("WP1.baseline.noBoq red", "state", "Baseline without a BOQ no longer refused.", [P(516)]),
    dropRevisionNotActivated: F("WP1.baseline.notActivated red", "state", "A staged approved revision is baselined.", [P(516)]),
    stagedImportWrites: F("WP1.imports.xlsxDryRun / activeEqualsStaged red", "state", "A staged import writing activities directly changes the active schedule before approval.", [P(516)]),
  },
};

// ─── WP-2 Progress ───────────────────────────────────────────────────────────

const PROG = H("backend/src/services/progress.service.js", "2020-2252");
const EV_T1 = evOf(ALLOC.A110, 40);
const EV_T3 = EV_T1 + evOf(ALLOC.A120, 50);
const EV_T4 = EV_T3 + evOf(ALLOC.A130, 25);
const EV310 = { typed450: qtyEv(ALLOC.A310, 450, A310_PLANNED), bundle540: qtyEv(ALLOC.A310, 540, A310_PLANNED), dailyLog570: qtyEv(ALLOC.A310, 570, A310_PLANNED) };
const EV320 = { typed50: qtyEv(ALLOC.A320, 50, A320_PLANNED), typed40: qtyEv(ALLOC.A320, 40, A320_PLANNED) };
/**
 * Adjudication S2: the daily report's progress line is A320 at the plan's
 * typed value, 40 of 600 m2 = 6.667%. A320 is a quantity activity, so the
 * line is a typed quantity (a percent line would be refused
 * PROGRESS_METHOD_MISMATCH); approved after the hold is released, it is in
 * every later projectEv.
 */
const DR_LINE = { activity: "A320", method: "quantity", quantityComplete: 40, quantityPlanned: A320_PLANNED, unit: "m2" };
const EV_DR_A320 = qtyEv(ALLOC.A320, DR_LINE.quantityComplete, A320_PLANNED);
const EV_DR = EV_T4 + EV_DR_A320;
const EV_TYPED50_PROJECT = EV_T4 + EV310.dailyLog570 + EV320.typed50;
const EV_AFTER_QTY = EV_T4 + EV310.dailyLog570 + EV320.typed40;
const IMPORT_DELTA = evOf(ALLOC.A110, PROGRESS_FILE.A110) - evOf(ALLOC.A110, 40);

const WP2 = {
  setup: {
    allocations: F(Object.fromEntries(Object.entries(ALLOC)), "cents", "A110 60,000; A120 30,000; A130 90,000; A310 135,000 (900 m2); A320 72,000 (400 + 200 m2).", [P(384, 546)]),
    A310planned: F(A310_PLANNED, "m2", "Planned = sum of approved allocation quantity on A310's one item (S-003 900 m2).", [P(546), H("backend/src/services/quantity-progress.service.js", "860-917")]),
    A320planned: FA(A320_PLANNED, "m2", "Two items S-004 400 + S-005 200 = 600 m2 (the split is a choice; the plan fixes only 600).", [P(566)]),
    evBefore: F(0, "cents", "No approved progress yet.", [P(546)]),
    methods: FA(METHODS_087SCH, "text", "087-SCH progress methods and assignments (A330 unassigned).", [P(384)]),
  },
  rules: {
    approveRejected: F("400 PROGRESS_NOT_APPROVABLE", "http", "Only draft or submitted submissions are approvable.", [P(538), H("backend/src/services/progress.service.js", "2055-2061")]),
    rejectWithoutReason: F("400 REJECTION_REASON_REQUIRED", "http", "A progress rejection needs a reason.", [P(533), H("backend/src/services/progress.service.js", "2290")]),
    patchBundledEntry: F("409 QUANTITY_ENTRY_BUNDLED", "http", "An entry bundled into a pending submission is not edited.", [P(542), H("backend/src/services/quantity-progress.service.js", "404")]),
    evReadsApprovedOnly: F("approved ActivityProgress only", "state", "EV reads approved progress approved on or before the cutoff instant.", [P(536, 591), H("backend/src/services/earned-value.service.js", "737-753")]),
  },
  T1: {
    siteSubmit: F(200, "http", "Site engineer (assigned) submits A110 40% -> submitted.", [P(548, 537)]),
    officialAfterSubmit: F(0, "percent", "Only approval writes official progress (single writer).", [P(536, 548), H("backend/src/services/progress.service.js", "2171")]),
    evReportAfterSubmit: F("byte_identical", "state", "Hash of the EV JSON without asOfDate unchanged.", [P(548)]),
    siteApprove: F("403 FORBIDDEN", "http", "progress:approve is PM, planning engineer, QS.", [P(538, 548), H("backend/src/middleware/rbac.js", "149-153")]),
    qsApprove: {
      http: F(200, "http", "QS approves.", [P(548)]),
      official: F(40, "percent", "40.", [P(548)]),
      ev: F(EV_T1, "cents", `60,000.00 x 40% = ${fmt(EV_T1)}.`, [P(548)]),
    },
    approveAgain: {
      http: F(200, "http", "Idempotent for an already-approved submission.", [P(538, 548), H("backend/src/services/progress.service.js", "2052-2054")]),
      progressRows: F(1, "count", "Still one ActivityProgress row for the submission.", [P(548)]),
    },
    rejectApproved: F("400 APPROVED_PROGRESS_LOCKED", "http", "An approved submission cannot be rejected.", [P(548), H("backend/src/services/progress.service.js", "2280-2286")]),
  },
  T2: {
    siteOnA330: F("403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED", "http", "The site engineer is not assigned to A330.", [P(537, 549), H("backend/src/services/progress.service.js", "930")]),
    plannerOverride: F(200, "http", "pm / planning_eng skip the assignment rule.", [P(549), H("backend/src/services/progress.service.js", "17")]),
    randomId: F("404 ACTIVITY_NOT_FOUND", "http", "A random activity uuid.", [P(549), H("backend/src/services/progress.service.js", "909")]),
    outsider: F("404 PROJECT_NOT_FOUND", "http", "PM of 088.", [P(366, 549)]),
  },
  T3: {
    submittedNoEvidence: F("400 PROGRESS_EVIDENCE_REQUIRED", "http", "A120 evidenceRequired; nothing written.", [P(550), H("backend/src/services/progress.service.js", "1590-1598")]),
    rowsWritten: F(0, "count", "No submission row.", [P(550)]),
    draft: F(200, "http", "Drafts skip the submit-time gate.", [P(550)]),
    approveDraft: F("400 PROGRESS_EVIDENCE_REQUIRED", "http", "The gate applies again at approval.", [P(550), H("backend/src/services/progress.service.js", "2076-2082")]),
    withDocument: {
      official: FA(50, "percent", "A120 at 50% (area map; the plan gives only the EV).", [P(550), AREA]),
      ev: F(EV_T3, "cents", `${fmt(EV_T1)} + 30,000.00 x 50% (${fmt(evOf(ALLOC.A120, 50))}) = ${fmt(EV_T3)}. HR-X1 (decided): the evidence is an uploaded project document.`, [P(31, 550)]),
    },
  },
  T4: {
    submit: F(200, "http", "Site engineer submits A130 25%.", [P(551)]),
    approve: F("409 ITP_HOLD_POINT_OPEN", "http", "The form ITP instance on A130 has an unpassed hold item.", [P(539, 551), H("backend/src/services/progress.service.js", "2086-2098")]),
    holdPoints: F(1, "count", "One hold point in the refusal.", [P(551)]),
    holdState: F("pending", "state", "Unanswered hold item -> pending.", [P(551), H("backend/src/services/form.service.js", "821")]),
    evUnchanged: F(EV_T3, "cents", "EV byte-identical: still 39,000.00.", [P(551)]),
    openList: F(1, "count", "/forms/hold-points?activityId=A130 shows 1 open.", [P(551), H("backend/src/services/form.service.js", "1416-1431")]),
    failed: {
      approve: F("409 ITP_HOLD_POINT_OPEN", "http", "Answered 'fail' and completed.", [P(552)]),
      state: F("failed", "state", "A deficient value -> failed.", [P(552), H("backend/src/services/form.service.js", "821")]),
    },
    reopenedPassed: {
      approve: F(200, "http", "The quality engineer reopens with a reason, answers 'pass', completes (HR-Q1: completed instance, hold item passed).", [P(27, 553, 1007)]),
      ev: F(EV_T4, "cents", `${fmt(EV_T3)} + 90,000.00 x 25% (${fmt(evOf(ALLOC.A130, 25))}) = ${fmt(EV_T4)}.`, [P(553)]),
    },
    voidWithReason: F("released", "state", "A voided instance is excluded from openHoldPoints.", [P(554), H("backend/src/services/form.service.js", "1419")]),
    voidWithoutReason: F("400 FORM_REASON_REQUIRED", "http", "Void needs a reason.", [P(554), H("backend/src/services/form.service.js", "1260")]),
    siteVoid: F(403, "http", "The site engineer may not void (code not fixed by the plan).", [P(554)]),
    probes: {
      inProgressPass: F("409 ITP_HOLD_POINT_OPEN", "http", "HR-Q1 (decided): 'pass' on an instance still in progress does not release the hold.", [P(27, 555, 1007)], { today: 200 }),
      naAnswer: F("409 ITP_HOLD_POINT_OPEN", "http", "HR-Q1 (decided): 'na' on a hold item needs the approver; an 'na' alone does not release it.", [P(27, 555, 1007)], { today: 200 }),
      retroactiveTemplateEdit: FA("gate reads the instance's own template version", "state", "HR-Q2 (undecided) recommendation; recorded.", [P(556, 1008)], { today: "gates read the current template" }),
      requiredSignature: F("400 FORM_INCOMPLETE", "http", "Completing without the required signature.", [P(556), H("backend/src/services/form.service.js", "1167")]),
      weeklyRecurrenceDays: F(7, "days", "Next instance scheduled D + 7 (every week, interval 1).", [P(556), H("backend/src/services/form.service.js", "774")]),
    },
  },
  dailyReport: {
    progressLine: FA(DR_LINE, "text", `The daily report's progress line (adjudication S2): A320 at the plan's typed value, 40 of 600 m2 = ${(40 / A320_PLANNED * 100).toFixed(3)}%. A320 is a quantity activity with two items, so the line is sent as payload.progress {method 'quantity', quantityComplete 40} (a percent line is refused PROGRESS_METHOD_MISMATCH); no entry is minted.`, [P(557, 566), H("backend/src/services/daily-report.service.js", "570-625,679,747"), ADJ("S2 WP2.dailyReport")], { note: "choreography consequence for the owner: approval gates the hold points of the report's own activity (daily-report.service.js:1000 -> progress.service.js:2086-2089), so the 409 needs an open hold point on A320 itself, e.g. a second instance of the form ITP template on A320, released (completed with the hold item passed, HR-Q1) before the approval; A130's instance does not block an A320 line" }),
    approveWithOpenHold: F("409 ITP_HOLD_POINT_OPEN", "http", "Daily-report approval runs the progress gates (the same writer).", [P(557), H("backend/src/services/daily-report.service.js", "996")]),
    reportStatus: F("submitted", "state", "The report stays submitted.", [P(557)]),
    officialProgress: F("unchanged", "state", "Official progress unchanged.", [P(557)]),
    afterRelease: F("approved", "state", "After the hold is released.", [P(557)]),
    officialAfterApproval: FA((DR_LINE.quantityComplete / A320_PLANNED) * 100, "percent", "After the hold is released and the report approved: A320 official = 40 / 600 x 100 = 6.666... (plan 6.667%); compare to 3 dp.", [P(557, 566), ADJ("S2 WP2.dailyReport")]),
    evA320: FA(EV_DR_A320, "cents", `72,000.00 x 40 / 600 = ${fmt(EV_DR_A320)} (exact).`, [P(557), H("backend/src/services/earned-value.service.js", "792"), ADJ("S2 WP2.dailyReport")]),
    projectEv: FA(EV_DR, "cents", `After T4 ${fmt(EV_T4)} + A320 ${fmt(EV_DR_A320)} = ${fmt(EV_DR)}; every later projectEv carries the A320 figure until A320's own quantity steps replace it.`, [P(557), ADJ("S2 WP2.dailyReport")]),
  },
  confirmFirst: {
    textOnlyEvidence: F("not evidence: at least one stored project document is required (HR-X1)", "text", "Observation (plan :582): A120 (evidenceRequired) submitted with a text note as its only evidence. HR-X1 (decided: canonical evidence references, at least one stored project document, phased without abruptly breaking mobile clients) says a text note is not evidence. No status or code is asserted (none named).", [P(31, 582, 1012), ADJ("S2 WP-2 confirm-first probes")], { today: "accepted: evidenceOf turns a string into {notes} and hasEvidence counts any key, so the note passes the gate at submit and at approval (progress.service.js:105-117,1589-1599,2076-2082)" }),
    putMethodReset: FA("partial update: omitted fields keep their values (A120's evidenceRequired stays true)", "text", "Observation (plan :582): PUT /activities/A120/progress-method with {method: 'percent'} only. HR-P3 recommendation (undecided): partial update.", [P(582, 999), ADJ("S2 WP-2 confirm-first probes")], { today: "omitted fields reset: evidenceRequired false, inspectionRequired false, plannedQuantity/quantityUnit/milestoneWeights null (progress.service.js:1069-1081; routes/activities.js:354)" }),
    selfApproval: FA("allowed for Phase 1; the self-approval is visible in audit", "text", "Observation (plan :583): the PM (and the planner) approve a submission they made themselves. HR-P4 recommendation (undecided): keep for Phase 1 (CLAUDE.md: PM has all access); self-approvals visible in audit.", [P(583, 1000), ADJ("S2 WP-2 confirm-first probes")], { today: "200: approval does not compare submittedBy with the approver (progress.service.js:2020-2100)" }),
    replayDifferentPayload: FA(null, "text", "Observation (plan :584, low): a quantity entry replayed with the same clientRequestId and a different quantity. The plan names no recommendation, so no expected answer is recorded; classified after reproduction.", [P(584), ADJ("S2 WP-2 confirm-first probes")], { today: "replayed:true with the stored entry; the new payload is ignored (quantity-progress.service.js:451-478)" }),
  },
  T5: {
    A110toQuantity: F("409 PROGRESS_METHOD_LOCKED", "http", "A110 has approved progress under percent.", [P(558), H("backend/src/services/progress.service.js", "1023-1036")]),
    A110toPercent: F(200, "http", "Same method: allowed.", [P(558)]),
  },
  T6: {
    olderLowerApproval: {
      refusal: F(409, "http", "HR-P1 (approved to fix): approving an older submission after a newer approved one is refused (code to be named by the fix). Probe: A330 approved 60 (s2), then the older pending 30 (s1).", [P(28, 559, 997), AREA], { today: "200; official 30, no warning" }),
      official: F(60, "percent", "A330 stays at 60.", [P(997)], { today: 30 }),
    },
    methodBypass: FA(409, "http", "HR-P2 (undecided) recommends locking the effective method once progress is approved. Probe: A300 approved percent 20, then a quantity submission 10 of 100. Code null: the rule is undecided, so no code is asserted (PROGRESS_METHOD_LOCKED, the configured-method code, is not assumed).", [P(559, 998), AREA, ADJ("open questions: codes for undecided refusals")], { today: "200; approval makes 10% official under quantity" }),
  },
  T7: {
    retiredActivityApproval: FA(409, "http", "HR-S9 (undecided) recommends refusing approval on an activity retired by activation.", [P(559, 996)], { today: "200; an ActivityProgress row on an inactive activity" }),
  },
  quantitiesA310: {
    typedZero: F("400 QUANTITY_INVALID", "http", "quantityComplete 0.", [P(561), H("backend/src/services/progress.service.js", "1247-1258")]),
    barePercent: F("400 QUANTITY_NO_ENTRIES_TO_BUNDLE", "http", "pctComplete without entries on a quantity activity.", [P(561), H("backend/src/services/progress.service.js", "1210-1236")]),
    percentMethod: F("409 PROGRESS_METHOD_MISMATCH", "http", "method 'percent' against the configured quantity method.", [P(561), H("backend/src/services/progress.service.js", "1516-1529")]),
    refusalsLeaveEv: F("byte_identical", "state", "Each refusal leaves the EV report byte-identical.", [P(561)]),
    typed450: {
      pct: F((450 / A310_PLANNED) * 100, "percent", "450 / 900 x 100 = 50.", [P(562)]),
      entriesCreated: F(1, "count", "One approved entry minted (single allocated item; source 'submission').", [P(562), H("backend/src/services/progress.service.js", "1758-1845")]),
      evA310: F(EV310.typed450, "cents", `135,000.00 x 450 / 900 = ${fmt(EV310.typed450)}.`, [P(562)]),
      projectEv: FA(EV_DR + EV310.typed450, "cents", `${fmt(EV_T4)} + A320 from the daily report ${fmt(EV_DR_A320)} (WP2.dailyReport, ${fmt(EV_DR)}) + A310 ${fmt(EV310.typed450)} = ${fmt(EV_DR + EV310.typed450)} (order of this book).`, [P(562), ADJ("S2 WP2.dailyReport")]),
    },
    typedAgain: F("409 QUANTITY_ENTRIES_REQUIRED", "http", "A typed quantity once entries exist.", [P(562), H("backend/src/services/progress.service.js", "1187-1198")]),
    bundle90: {
      installed: F(450 + 90, "m2", "450 (minted) + 90 = 540.", [P(563)]),
      pct: F((540 / A310_PLANNED) * 100, "percent", "540 / 900 x 100 = 60.", [P(563)]),
      evA310: F(EV310.bundle540, "cents", `135,000.00 x 540 / 900 = ${fmt(EV310.bundle540)}.`, [P(563)]),
      projectEv: FA(EV_DR + EV310.bundle540, "cents", `${fmt(EV_T4)} + A320 from the daily report ${fmt(EV_DR_A320)} + A310 ${fmt(EV310.bundle540)} = ${fmt(EV_DR + EV310.bundle540)}.`, [P(563), ADJ("S2 WP2.dailyReport")]),
    },
    entryRefusals: {
      unitM3: F("400 QUANTITY_UNIT_MISMATCH", "http", "S-003 is in m2.", [P(564, 541), H("backend/src/services/quantity-progress.service.js", "217")]),
      negative: F("400 QUANTITY_NEGATIVE", "http", "-5.", [P(564), H("backend/src/services/quantity-progress.service.js", "490")]),
      notAllocated: F("400 QUANTITY_ITEM_NOT_ALLOCATED", "http", "An item with no approved allocation on A310 (e.g. S-004).", [P(564), H("backend/src/services/quantity-progress.service.js", "316")]),
      patchApproved: F("409 QUANTITY_ENTRY_LOCKED", "http", "An approved entry is not edited.", [P(564), H("backend/src/services/quantity-progress.service.js", "398")]),
    },
    replay: {
      replayed: F(true, "bool", "Same clientRequestId -> replayed:true.", [P(564), H("backend/src/services/quantity-progress.service.js", "458-480")]),
      sameId: F(true, "bool", "The stored entry's id comes back; created 0.", [P(564)]),
    },
    dailyLog: {
      entries: F(1, "count", "A daily log quantities row of 30 m2 mints exactly one submitted entry.", [P(565), H("backend/src/services/daily-log.service.js", "233-257")]),
      installed: F(540 + 30, "m2", "540 + 30 = 570.", [P(565)]),
      pct: F((570 / A310_PLANNED) * 100, "percent", "570 / 900 x 100 = 63.333... (plan 63.333%); compare to 3 dp.", [P(565)]),
      evA310: F(EV310.dailyLog570, "cents", `135,000.00 x 570 / 900 = ${fmt(EV310.dailyLog570)} (exact; HEAD's float pct 63.33333333333333 also rounds to 85,500.00).`, [P(565), H("backend/src/services/earned-value.service.js", "792")]),
      projectEv: FA(EV_DR + EV310.dailyLog570, "cents", `${fmt(EV_T4)} + A320 from the daily report ${fmt(EV_DR_A320)} (WP2.dailyReport) + A310 ${fmt(EV310.dailyLog570)} = ${fmt(EV_DR + EV310.dailyLog570)}.`, [P(565), ADJ("S2 WP2.dailyReport")]),
    },
    rejectedState: {
      choreography: FA("a further 10 m2 entry on S-003, bundled into a submission that the QS rejects with a reason", "text", "The quantity 'rejected' state (plan :384 'quantity entries in every state'); run after the daily-log step. The 10 m2 is a choice made here.", [P(384, 541), ADJ("S2 quantity rejected state")]),
      entryStatus: F("rejected", "state", "Rejecting a submission rejects the entries it bundles, with rejectedBy, rejectedAt and the reason; the trail is the only way an entered quantity stops counting.", [P(384), H("backend/src/services/progress.service.js", "2298-2314"), ADJ("S2 quantity rejected state")]),
      officialProgress: F("unchanged", "state", `Nothing official is written: A310 stays 570 m2 (63.333%), EV(A310) ${fmt(EV310.dailyLog570)}; the quantity view's installed stays 570 (approved entries only).`, [P(384, 567), H("backend/src/services/progress.service.js", "2297-2325"), ADJ("S2 quantity rejected state")]),
    },
  },
  quantitiesA320: {
    typed50: {
      pct: F((50 / A320_PLANNED) * 100, "percent", "50 / 600 x 100 = 8.333...", [P(566)]),
      evA320: F(EV320.typed50, "cents", `72,000.00 x 50 / 600 = ${fmt(EV320.typed50)}.`, [P(566)]),
      mintSkipped: F(true, "bool", "Two allocated items: no entry is minted.", [P(566), AREA]),
    },
    typed40: {
      warning: F("QUANTITY_BELOW_OFFICIAL", "state", "Typed 40 below the official 50: the answer carries the warning.", [P(566), H("backend/src/services/progress.service.js", "1270-1313")]),
      officialInstalled: F(50, "m2", "official 50.", [P(566)]),
      typed: F(40, "m2", "typed 40.", [P(566)]),
      pctAfterApproval: FA((40 / A320_PLANNED) * 100, "percent", "40 / 600 x 100 = 6.667. HR-P1 (approved to fix): the downward correction goes through the explicit, authorised correction path, which the proof must use.", [P(28, 566, 997)]),
      evA320: FA(EV320.typed40, "cents", `72,000.00 x 40 / 600 = ${fmt(EV320.typed40)}.`, [P(566)]),
      projectEv: FA(EV_AFTER_QTY, "cents", `A320 moves 40 m2 (daily report, ${fmt(EV_DR_A320)}) -> 50 m2 (typed 50, ${fmt(EV320.typed50)}; project ${fmt(EV_TYPED50_PROJECT)}) -> 40 m2 (${fmt(EV320.typed40)}): ${fmt(EV_T4)} + ${fmt(EV310.dailyLog570)} + ${fmt(EV320.typed40)} = ${fmt(EV_AFTER_QTY)}.`, [P(566), ADJ("S2 WP2.dailyReport")]),
    },
  },
  quantityView: {
    installed: F(570, "m2", "Sum of approved entries: 450 + 90 + 30.", [P(567), H("backend/src/services/quantity-views.service.js", "5-6,337-351")]),
    committed: F(900, "m2", "Commitment SOV qty 900 on an executed commitment (excludes variations).", [P(567), H("backend/src/services/quantity-views.service.js", "20-21")]),
    received: F(1000, "m2", "Stock receipt 1,000 tagged with S-003.", [P(567)]),
    issued: F(600 - 50, "m2", "Issues net of returns: 600 - 50 = 550.", [P(567), H("backend/src/services/quantity-views.service.js", "17-19")]),
    certified: F(500, "m2", "IPC item qty 500 certified.", [P(567)]),
    paid: F(500 * 0.5, "m2", "certified 500 x paid share (amountPaid / netPayable = 0.5) = 250.", [P(567), H("backend/src/services/quantity-views.service.js", "367-407")]),
    certifiedAboveInstalled: F(false, "bool", "500 > 570 is false.", [P(567), AREA]),
    withoutBoqRead: {
      http: F(200, "http", "QUANTITY_FIGURES_WITHHELD is a reason, not an error: 200 with withheld:true and no figure.", [P(544, 567), H("backend/src/utils/boq-figures.js", "1834-1857")]),
      withheld: F(true, "bool", "withheld: true; every figure value null.", [P(567)]),
      reason: F("QUANTITY_FIGURES_WITHHELD", "text", "The reason constant.", [P(567)]),
    },
  },
  bulk: {
    mixedBatch: {
      refusal: FA("409 PROGRESS_METHOD_MISMATCH", "http", "Batch [A330 {pct 10} by the planner, A310 {method percent}]: the second update is refused (batch chosen from the area map).", [P(569), AREA, H("backend/src/services/activity.service.js", "738-822")]),
      index: F(1, "count", "details.batch.index 1.", [P(569)]),
      written: F(0, "count", "details.batch.written 0; A330's submission count unchanged.", [P(569)]),
    },
    randomId: {
      refusal: F("404 ACTIVITY_NOT_FOUND", "http", "Unknown activity, named before anything is written.", [P(569), H("backend/src/services/activity.service.js", "774")]),
      index: FA(1, "count", "Its index in the batch [A330, <random uuid>].", [P(569)]),
    },
    siteWithA330: {
      refusal: F("403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED", "http", "A batch from the site engineer naming unassigned A330.", [P(569)]),
      written: F(0, "count", "Nothing written.", [P(569)]),
    },
  },
  importProgress: {
    file: FA(PROGRESS_FILE, "percent", "Progress XER phys_complete_pct (area map).", [P(384, 570), AREA]),
    site: {
      activityProgressDelta: F(0, "count", "Submissions only, under the importer's own authority.", [P(570), H("backend/src/services/import.service.js", "715-1122")]),
      ev: F("byte_identical", "state", "EV byte-identical.", [P(570)]),
      A310row: F("409 PROGRESS_METHOD_MISMATCH", "http", "A310 is quantity; the file states a percent.", [P(570), AREA]),
      reupload: F("already_pending", "state", "Uploaded again.", [P(570)]),
    },
    pm: {
      A110official: FA(PROGRESS_FILE.A110, "percent", "Approved through the writer.", [P(571)]),
      evA110: FA(evOf(ALLOC.A110, PROGRESS_FILE.A110), "cents", `60,000.00 x 70% = ${fmt(evOf(ALLOC.A110, PROGRESS_FILE.A110))}.`, [P(571)]),
      evDelta: FA(IMPORT_DELTA, "cents", `A110 official 40 -> 70: +${fmt(IMPORT_DELTA)}.`, [P(571), AREA]),
      A130row: FA("pending (ITP_HOLD_POINT_OPEN)", "state", "An open hold point keeps A130's row pending (a second, scheduled ITP instance on A130).", [P(571)]),
    },
  },
  mutations: {
    removeHoldPointCheck: F("WP2.T4.approve red", "state", "progress.service.js:2086-2098 removed: approval 200 with the hold open.", [P(573)]),
    removeApprovalEvidence: F("WP2.T3.approveDraft red", "state", "Evidence check at approval removed.", [P(573)]),
    submitPermissionEarlyReturn: F("WP2.T2.siteOnA330 red", "state", "assertProgressSubmitAllowed returns early.", [P(573)]),
    dropIdempotentApprove: F("WP2.T1.approveAgain red", "state", "A second approval writes a second row or refuses.", [P(573)]),
    dropMethodStands: F("WP2.quantitiesA310.percentMethod red", "state", "assertSubmissionMethodStands dropped.", [P(573)]),
    openHoldPointsEmpty: F("WP2.T4.approve red", "state", "openHoldPoints returns [].", [P(573)]),
    removeNegativeGuard: F("WP2.quantitiesA310.entryRefusals.negative red", "state", "-5 accepted.", [P(573)]),
    splitBulkTransaction: F("WP2.bulk.mixedBatch.written red", "state", "The first update is written.", [P(573)]),
  },
};

// ─── WP-3 Earned value, periods, forecast ────────────────────────────────────

const EVS = H("backend/src/services/earned-value.service.js", "219-245,953-956");
function metricLeaves(m, src, { headM = null, assumption = false, extra = {} } = {}) {
  const mk = assumption ? FA : F;
  const t = (key) => (headM && headM[key] !== m[key] ? { today: headM[key] } : {});
  return {
    bac: mk(m.bac, "cents", `Approved allocations ${fmt(BAC)}${m.bac !== BAC ? ` + approved budget revisions ${fmt(m.bac - BAC)}` : ""} = ${fmt(m.bac)}.`, src, extra),
    pv: mk(m.pv, "cents", `Approved loadings with plannedDate <= the cutoff date = ${fmt(m.pv)}.`, [src, H("backend/src/services/earned-value.service.js", "439-451")].flat(), extra),
    ev: mk(m.ev, "cents", `${m.ev === 0 ? "0: every approval is stamped after this cutoff" : "60,000 x 100% + 30,000 x 50% + 90,000 x 25%"} = ${fmt(m.ev)}.`, [src, H("backend/src/services/earned-value.service.js", "737-753,792")].flat(), extra),
    ac: mk(m.ac, "cents", `Ledger postings dated <= the cutoff = ${fmt(m.ac)}${headM && headM.ac !== m.ac ? ` (HEAD: whole cumulative CostRecord per activity with through-date <= cutoff = ${fmt(headM.ac)}; L34)` : ""}.`, [src, H("backend/src/services/earned-value.service.js", "486-514")].flat(), { ...extra, ...t("ac") }),
    spi: mk(r6(m.spi), "ratio", m.spi === null ? "PV 0 -> null." : `${fmt(m.ev)} / ${fmt(m.pv)} = ${m.spi}.`, [src, EVS].flat(), extra),
    spiAlert: mk(m.spiAlert, "bool", `SPI ${m.spi === null ? "null" : r6(m.spi)} ${m.spiAlert ? "< 0.9 -> alert" : "-> no alert"}.`, [src, EVS].flat(), extra),
    cpi: mk(r6(m.cpi), "ratio", m.cpi === null ? "AC 0 -> null." : `${fmt(m.ev)} / ${fmt(m.ac)} = ${m.cpi}.`, [src, EVS].flat(), { ...extra, ...t("cpi") }),
    cpiAlert: mk(m.cpiAlert, "bool", `CPI ${m.cpi === null ? "null" : r6(m.cpi)} ${m.cpiAlert ? "< 0.9 -> alert" : "-> no alert"}.`, [src, EVS].flat(), { ...extra, ...t("cpiAlert") }),
    eac: mk(m.eac, "cents", m.eacBasis === "budget_over_cpi" ? `BAC / CPI = ${fmt(m.bac)} x ${fmt(m.ac)} / ${fmt(m.ev)} -> ${fmt(m.eac)} (half up).` : `CPI ${m.cpi === null ? "null" : 0} -> EAC = BAC ${fmt(m.bac)} (HR-E3).`, [src, EVS].flat(), { ...extra, ...t("eac") }),
    eacBasis: mk(m.eacBasis, "state", "eacBasisOf(totalBudget, cpi).", [src, H("backend/src/utils/eac-basis.js", "29-34")].flat(), { ...extra, ...t("eacBasis") }),
    sv: mk(m.sv, "cents", `EV - PV = ${fmt(m.ev)} - ${fmt(m.pv)} = ${fmt(m.sv)}.`, src, extra),
    cv: mk(m.cv, "cents", `EV - AC = ${fmt(m.ev)} - ${fmt(m.ac)} = ${fmt(m.cv)}.`, src, { ...extra, ...t("cv") }),
    etc: mk(m.etc, "cents", `EAC - AC = ${fmt(m.eac)} - ${fmt(m.ac)} = ${fmt(m.etc)}.`, src, { ...extra, ...t("etc") }),
  };
}

const WP3 = {
  setup: {
    boq: FA(BOQ_EV, "text", `087-EV's BOQ: five in-scope rows, each allocated whole to one activity (E-001 5,000 m3 x 12 = 60,000 -> A110; E-002 200 m3 x 150 = 30,000 -> A120; E-003 600 m3 x 150 = 90,000 -> A130; E-004 900 m2 x 150 = 135,000 -> A310; E-005 600 m2 x 120 = 72,000 -> A320): priced ${fmt(BOQ_EV_PRICED)}, allocated ${fmt(ALLOCATED_FIVE)}, coverage 100%. Row codes and the one-row-per-activity split are a choice; 052-SCH-EV and D3 carry the same rows.`, [P(386, 409, 546), ADJ("S2 087-EV inputs")]),
    allocations: F(ALLOC, "cents", `Approved allocations as explicit entries: A110 60,000; A120 30,000; A130 90,000; A310 135,000; A320 72,000. EV 97,500 = 60,000 x 100% + 30,000 x 50% + 90,000 x 25% fixes the first three; BAC 387,000 - 180,000 = 207,000 = A310 135,000 + A320 72,000 (plan :546).`, [P(386, 546, 598), ADJ("S2 087-EV inputs")]),
    allocatedTotal: F(ALLOCATED_FIVE, "cents", `60,000 + 30,000 + 90,000 + 135,000 + 72,000 = ${fmt(ALLOCATED_FIVE)} = BAC (WP3.T1.bac).`, [P(386, 598), ADJ("S2 087-EV inputs")]),
    loadings: F(EV087.loadings, "text", "Approved cost loadings (activity, amount, plannedDate).", [P(386)]),
    progress: F(EV087.progress, "percent", "Approved progress A110 100, A120 50, A130 25.", [P(386)]),
    directCosts: F(EV087.directCosts, "text", "Approved direct costs (activity, amount, incurredOn); later 30,000 on A120 dated 2026-10-01.", [P(386)]),
    timeZone: F("Africa/Cairo", "text", "087 reports in its organisation zone (a project zone cannot be set: L117/L126).", [P(361, 1174)]),
    timeZoneSource: F("organisation", "state", "reporting.timeZoneSource.", [P(1174), H("backend/src/utils/reporting-cutoff.js", "145-156")]),
    order: FA(EV087.order, "list", "Answer-book order (plan :386 'Steps run in answer-book order'); T6 runs last ('Finally').", [P(386)]),
  },
  T1: metricLeaves(M_T1, [P(598)]),
  T2: {
    addedCost: F(cents(30_000), "cents", "30,000 on A120 incurredOn 2026-10-01 (on or before the run date).", [P(599)]),
    ...metricLeaves(M_T2, [P(599)]),
  },
  T3: {
    cutoff: F(CUT_0228_CAIRO, "instant", "End of 2026-02-28 in Africa/Cairo (UTC+2; Egypt keeps DST only from late April).", [P(593, 600), H("backend/src/utils/reporting-cutoff.js", "134-138")]),
    ...metricLeaves(M_T3, [P(600)], { headM: M_T3_HEAD }),
    acNote: F("L34", "text", `Expected AC = A110 50,000 (01-20) + A130 20,000 (02-10) = ${fmt(M_T3.ac)}. HEAD keeps one cumulative CostRecord per activity: A110 60,000 through 09-30 drops out whole, A130 20,000 through 02-10 stays, A120 through 10-01 drops -> ${fmt(M_T3_HEAD.ac)}. Red until L34 is fixed.`, [P(600, 622, 1052), H("backend/src/services/earned-value.service.js", "486-514")], { today: M_T3_HEAD.ac }),
  },
  T4: {
    spi09: {
      spi: F(r6(EVT4.spi09.spi), "ratio", "EV 90,000 / PV 100,000 = 0.9.", [P(601)]),
      spiAlert: F(EVT4.spi09.spiAlert, "bool", "0.9 is not below 0.9 -> no alert.", [P(601), EVS]),
    },
    cpi09: {
      cpi: F(r6(EVT4.spi09.cpi), "ratio", "EV 90,000 / AC 100,000 = 0.9.", [P(601)]),
      cpiAlert: F(EVT4.spi09.cpiAlert, "bool", "No alert at exactly 0.9.", [P(601)]),
      eac: F(EVT4.spi09.eac, "cents", `387,000.00 / 0.9 = 387,000 x 100,000 / 90,000 = ${fmt(EVT4.spi09.eac)}.`, [P(601)]),
    },
    ac100001: {
      cpi: F(r6(EVT4.ac100001.cpi), "ratio", `90,000 / 100,001 = ${EVT4.ac100001.cpi}.`, [P(601)]),
      cpiAlert: F(EVT4.ac100001.cpiAlert, "bool", "Below 0.9 -> alert.", [P(601)]),
      eac: F(EVT4.ac100001.eac, "cents", `387,000 x 100,001 / 90,000 = 430,004.30 -> ${fmt(EVT4.ac100001.eac)}.`, [P(601)]),
    },
    ev0: {
      cpi: F(EVT4.ev0.cpi, "ratio", "EV 0 / AC 50,000 = 0.", [P(601)]),
      cpiAlert: F(EVT4.ev0.cpiAlert, "bool", "0 < 0.9 -> alert.", [P(601)]),
      eac: F(EVT4.ev0.eac, "cents", "CPI 0 -> EAC = BAC 387,000.00 (HR-E3: keep BAC, labelled).", [P(601, 1054)]),
      eacBasis: F(EVT4.ev0.eacBasis, "state", "The basis is stated.", [P(601), H("backend/src/utils/eac-basis.js", "29-34")]),
    },
    pv0: {
      spi: F(EVT4.pv0.spi, "ratio", "PV 0 -> SPI null.", [P(601)]),
      spiAlert: F(EVT4.pv0.spiAlert, "bool", "null -> no alert.", [P(601)]),
    },
  },
  T5: {
    budgetRevision: F(cents(EV087.budgetRevision.amount), "cents", "+13,000 effective 2026-03-01 (on or before the cutoff).", [P(602)]),
    bac: F(M_T5.bac, "cents", `${fmt(BAC)} + ${fmt(cents(13_000))} = ${fmt(M_T5.bac)}.`, [P(602)]),
    eac: FA(M_T5.eac, "cents", `400,000 / CPI (T2 state, AC 110,000) = 400,000 x 110,000 / 97,500 = 451,282.0512... -> ${fmt(M_T5.eac)}.`, [P(602), AREA]),
    etc: FA(M_T5.etc, "cents", `${fmt(M_T5.eac)} - ${fmt(M_T5.ac)} = ${fmt(M_T5.etc)}.`, [P(602)]),
    deleteProbe: FA("refused_or_audited", "state", "L112: deleting an approved budget revision is refused, or audited.", [P(602, 624)], { today: "silent delete; BAC back to 387,000.00" }),
  },
  T6: {
    ledgerDelta: F(cents(5_000), "cents", "A 5,000 cost on A140 adds 5,000.00 to the ledger, which keeps it after the retirement.", [P(386, 603)]),
    acBeforeRetirement: FA(acLedger(RUN, ROWS_T6), "cents", `T2's 110,000 + the back-dated A130 5,000 (periods step) + A140 5,000 = ${fmt(acLedger(RUN, ROWS_T6))} (HEAD agrees: every through-date is on or before the run date).`, [P(386, 603)]),
    acAfterRetirement: FA(AC_T6, "cents", "HR-S9 recommendation (undecided; AC itself is CERT-5): retired activities keep their AC in project totals.", [P(603, 996)], { today: AC_T6_HEAD_RETIRED }),
    cpiAfterRetirement: FA(r6(EV_AFTER_LOCK / AC_T6), "ratio", `EV at T6 is the run-date EV after the periods step's new approval (A120 50 -> 60%, WP3.periods.afterLock.runDateEv): ${fmt(EV_AFTER_LOCK)}. CPI = ${fmt(EV_AFTER_LOCK)} / ${fmt(AC_T6)} = ${EV_AFTER_LOCK / AC_T6} (A140 carries no EV, so EV is the same before and after the retirement). Today A140's AC drops out: ${fmt(EV_AFTER_LOCK)} / ${fmt(AC_T6_HEAD_RETIRED)} = ${r6(EV_AFTER_LOCK / AC_T6_HEAD_RETIRED)}.`, [P(603), ADJ("S2 WP3.periods.afterLock")], { today: r6(EV_AFTER_LOCK / AC_T6_HEAD_RETIRED) }),
  },
  T7: F("byte_identical", "state", "Draft, submitted and rejected submissions leave the EV report byte-identical (sha of the JSON without asOfDate).", [P(604)]),
  periods: {
    duplicateCode: F("409 CONFLICT", "http", "Unique code per project (P2002).", [P(606), H("backend/src/middleware/error-handler.js", "245")]),
    endBeforeStart: F("400 INVALID_REPORTING_PERIOD_DATES", "http", "periodEnd < periodStart.", [P(606), H("backend/src/services/earned-value.service.js", "1198-1203")]),
    lockAsPlanner: F("403 FORBIDDEN", "http", "reporting_period.lock is PM and finance.", [P(594, 607)]),
    financeWhileBlocked: F("409 REPORTING_READINESS_BLOCKED", "http", "Gate blocked, no override reason.", [P(607), H("backend/src/services/earned-value.service.js", "1654-1658")]),
    financeWithOverride: F("403 REPORTING_READINESS_OVERRIDE_FORBIDDEN", "http", "Only the PM may override.", [P(607), H("backend/src/services/earned-value.service.js", "1661-1666")]),
    feb: {
      cutoff: F(CUT_0228_CAIRO, "instant", "Period 2026-02, cutoff 2026-02-28 in Africa/Cairo.", [P(607)]),
      lockByPmWithReason: F(200, "http", "PM override with a reason.", [P(607)]),
      snapshot: metricLeaves(M_T3, [P(607)], { headM: M_T3_HEAD }),
      overriddenAuditEvents: F(1, "count", "One OVERRIDDEN audit event.", [P(594, 607)]),
    },
    afterLock: {
      backdatedCost: FA(EV087.backdatedAfterLock, "text", "5,000 on A130 incurredOn 2026-02-15 (A130 chosen so HEAD's through-date stays inside the cutoff and the change is visible today too; A110 would hide the effect behind L34). Accepted by the integration owner.", [P(608), AREA, ADJ("open questions: back-dated after-lock cost")]),
      newApproval: FA({ activity: LOCK_APPROVAL_ACT, from: EV087.progress[LOCK_APPROVAL_ACT], to: LOCK_APPROVAL_PCT }, "text", "The plan's 'new approval' after the lock (plan :608): A120 approved 50 -> 60% (an upward figure, so HR-P1's correction path is not involved). Stamped at the run date, after every period cutoff.", [P(608), ADJ("S2 WP3.periods.afterLock")]),
      periodReport: F("byte_identical", "state", "GET /reports/ev?periodId= serves the snapshot, never recomputed: neither the back-dated cost nor the new approval changes it.", [P(594, 608), H("backend/src/services/earned-value.service.js", "714-716")]),
      cutoffReportAc: FA(acLedger("2026-02-28", ROWS_LOCK), "cents", `?cutoffDate=2026-02-28: ${fmt(M_T3.ac)} + 5,000 = ${fmt(acLedger("2026-02-28", ROWS_LOCK))}.`, [P(608)], { today: acHead("2026-02-28", ROWS_LOCK) }),
      cutoffReportEv: F(0, "cents", `?cutoffDate=2026-02-28: EV stays 0.00. EV reads progress approved by the cutoff instant (${CUT_0228_CAIRO}); the new approval is stamped after it, as every earlier approval is.`, [P(591, 608), H("backend/src/services/earned-value.service.js", "737-753"), ADJ("S2 WP3.periods.afterLock")]),
      runDateEv: FA(EV_AFTER_LOCK, "cents", `Run-date EV after the approval: ${fmt(EV_STAGE9)} + 30,000.00 x (60% - 50%) = ${fmt(EV_STAGE9)} + ${fmt(evOf(ALLOC.A120, LOCK_APPROVAL_PCT) - evOf(ALLOC.A120, EV087.progress.A120))} = ${fmt(EV_AFTER_LOCK)} (A110 60,000.00 + A120 18,000.00 + A130 22,500.00). WP3.T6 runs on it.`, [P(608), ADJ("S2 WP3.periods.afterLock")]),
      relockSameSnapshotId: F(true, "bool", "Locking again returns the stored snapshot: same id.", [P(608), H("backend/src/services/earned-value.service.js", "1708-1710")]),
      relockSameLockedAt: F(true, "bool", "Same lockedAt.", [P(608)]),
      loadingInLockedPeriod: F("409 REPORTING_PERIOD_LOCKED", "http", "A cost loading in the locked period.", [P(594, 608), H("backend/src/services/earned-value.service.js", "1231-1239")]),
    },
    jan: {
      cutoff: F(endOfLocalDay("2026-01-31", "Africa/Cairo"), "instant", "Period 2026-01 cutoff 2026-01-31, Africa/Cairo.", [P(386)]),
      lock: FA("normal", "state", "Locked without an override, by finance, once 087-EV's reporting gate is ready (the plan says only 'one locked normally').", [P(386)]),
      snapshot: metricLeaves(M_JAN, [P(386)], { headM: M_JAN_HEAD, assumption: true }),
    },
    futureCutoffLock: FA(409, "http", "L113 / HR-E2 (undecided) recommendation: refuse a lock before the cutoff; recorded. Code null until HR-E2 is decided (the plan's row proposes CUTOFF_NOT_REACHED, which exists at HEAD only as a report basis note, not as an error code).", [P(610, 625, 1053), H("backend/src/routes/health.js", "335"), ADJ("open questions: codes for undecided refusals")], { today: 200 }),
    concurrentLocks: FA({ succeeded: 1, refused: { status: 409, code: null } }, "text", "Observation (plan :627, low): two locks of the same open period sent at once. Expected (assumption): serialised, one wins and the other is refused 409; the code stays null (undecided, never guessed). Recorded, not a gate.", [P(627), ADJ("S2 concurrent activations / period locks")], { today: "not established: no row lock at HEAD; the lock reads the period, then upserts its snapshot by reportingPeriodId (earned-value.service.js:1690-1745); reproduce" }),
    defaultPeriod: {
      on20260305: F(defaultPeriod(EV087.periods, "2026-03-05T00:00:00.000Z", "Africa/Cairo"), "state", "Latest period whose cutoff instant has passed: 2026-02 (2026-03 not yet).", [P(609), H("backend/src/services/earned-value.service.js", "411-424")]),
      on20260401: F(defaultPeriod([...EV087.periods.slice(0, 2), { code: "2026-03", cutoff: "2026-03-31" }], "2026-04-01T00:00:00.000Z", "Africa/Cairo"), "state", `With periods 2026-01, 2026-02 and 2026-03 (cutoff 03-31; the in-process fixture of the area map): 2026-03's cutoff ${endOfLocalDay("2026-03-31", "Africa/Cairo")} (Cairo) has passed at 2026-04-01T00:00Z.`, [P(609), AREA]),
      chicagoCaution: F(defaultPeriod([...EV087.periods.slice(0, 2), { code: "2026-03", cutoff: "2026-03-31" }], "2026-04-01T00:00:00.000Z", "America/Chicago"), "state", `For a 052 project (America/Chicago) an injected now of 2026-04-01T00:00Z is still 03-31 locally (cutoff ${endOfLocalDay("2026-03-31", "America/Chicago")}): the default is 2026-02. Inject a now after that instant (e.g. 2026-04-01T12:00Z) to get 2026-03.`, [P(609, 1174)], { company: "052" }),
    },
  },
  forecast: (() => {
    const pace = forecastPace({ start: "2026-05-01T00:00:00Z", finish: "2026-05-31T00:00:00Z", asOf: "2026-06-01T00:00:00Z", pct: 20 });
    return {
      pace: {
        inputs: FA({ start: "2026-05-01", end: "2026-05-31", asOf: "2026-06-01", approvals: 1, pct: 20 }, "text", "Area map's activity (the plan gives only the answer).", [P(612), AREA]),
        basis: F("pace", "state", "One approval in 45 days -> no velocity; pct > 0 and time elapsed -> pace.", [P(612), H("backend/src/services/forecast.service.js", "389-408")]),
        addDays: F(pace.addDays, "days", `elapsed ${pace.elapsed} days; remaining 80 x ${pace.elapsed} / 20 = ${pace.addDays}.`, [P(612)]),
        projectedFinish: F(pace.projected, "date", `2026-06-01 + ${pace.addDays} days.`, [P(612)]),
        slipDays: F(pace.slip, "days", `2026-10-03 - 2026-05-31 = ${pace.slip}.`, [P(612), H("backend/src/services/forecast.service.js", "419")]),
      },
      evBasedFinish: F(forecastEvFinish({ asOf: "2026-06-01T00:00:00Z", plannedFinish: "2026-07-01T00:00:00Z", spi: 0.5 }), "date", "2026-06-01 + 30 / 0.5 = 60 days -> 2026-07-31.", [P(613), H("backend/src/services/forecast.service.js", "564-569")]),
      L106budgetLines: F(0, "count", "One budget line originalBudget 100,000 with no cost: cost.budgetLines [] (not overrun).", [P(614, 626), H("backend/src/services/forecast.service.js", "527-540")], { today: "1 line {revised: 0, forecast: 100,000, overrun: 100,000.00} (reads line.revised)" }),
      siteEngineerMoney: F("no money fields", "state", "Levels and counts only.", [P(615)]),
    };
  })(),
  mutations: {
    alertBoundary: F("WP3.T4.spi09.spiAlert red", "state", "< 0.9 -> <= 0.9: 0.9 alerts.", [P(617)]),
    lockedRecomputed: F("WP3.periods.afterLock.periodReport red", "state", "A locked period recomputed shows the back-dated cost.", [P(617)]),
    readinessSkipped: F("WP3.periods.financeWhileBlocked red", "state", "Lock while blocked succeeds.", [P(617)]),
    evNonApproved: F("WP3.T7 red", "state", "A submitted figure moves EV.", [P(617)]),
  },
};

// ─── D2: 052-SCH-EV ──────────────────────────────────────────────────────────

/**
 * Adjudication S1, the decided 052-SCH-EV order (the 052 lane choreography):
 * F1 through to baseline; WP-2 T1, T3, T4 (hold point); A110 raised to 100;
 * WP-3 T1-T4; then WP-2 quantity T2/T3, which assert EV(A310) only. WP-3
 * therefore reads 087-EV's progress state (A110 100, A120 50, A130 25, A310
 * not started) and its figures are 087's, in USD (plan :403 "the same figures").
 */
const D2_ORDER = [
  "WP-1: F1 imported, approved, activated and baselined (BOQ = WP3.setup.boq, fully allocated)",
  "WP-2 T1: A110 40% (EV 24,000.00)",
  "WP-2 T3: A120 50% with a document (EV 39,000.00)",
  "WP-2 T4: A130 25% through the hold point (EV 61,500.00)",
  "A110 raised to 100% and approved (EV 97,500.00)",
  "WP-3 T1 (cutoff today; 087-EV's loadings and direct costs)",
  "WP-3 T2 (+30,000.00 on A120 dated 2026-10-01)",
  "WP-3 T3 (cutoff 2026-02-28, America/Chicago)",
  "WP-3 T4 (in process)",
  "WP-2 quantity T2: A310 typed 450 (EV(A310) 67,500.00)",
  "WP-2 quantity T3: A310 +90 m2 bundled (EV(A310) 81,000.00)",
];
const EV_052_AT_WP3 = evOf(ALLOC.A110, 100) + evOf(ALLOC.A120, 50) + evOf(ALLOC.A130, 25);
if (EV_052_AT_WP3 !== M_T1.ev) throw new Error("schedule answer book: 052-SCH-EV's EV at WP-3 must equal 087-EV's");
const why052 = `Decided order (adjudication S1): WP-2 T1, T3, T4 -> A110 raised to 100 -> WP-3 T1-T4 -> WP-2 quantity T2/T3. At WP-3, EV = 60,000.00 x 100% + 30,000.00 x 50% + 90,000.00 x 25% = ${fmt(EV_052_AT_WP3)} (A310 not yet started), so 087's figures hold in USD.`;
const D2 = {
  company: F("052 Summit General Contractors", "text", "Approved deep company D2 (USD, America/Chicago).", [P(22, 356, 361)], { company: "052" }),
  order: F(D2_ORDER, "list", `The 052-SCH-EV lane choreography, decided by the integration owner. Running the quantity gates before WP-3 would add A310's ${fmt(EV310.bundle540)} and give EV ${fmt(EV_052_AT_WP3 + EV310.bundle540)}, which the plan does not intend.`, [P(403), ADJ("S1")], { company: "052" }),
  WP1: {
    M900_EF: FA(CPM1.rows.M900.EF, "working_days", "F1 through baseline, the same network (start assumed Monday 2026-01-05, five_day).", [P(403)], { company: "052" }),
    M900date: FA(workingDate(START, CPM1.rows.M900.EF), "date", "Same start and calendar as 087-SCH.", [P(403)], { company: "052" }),
    A140_TF: F(CPM1.rows.A140.TF, "working_days", "47.", [P(403)], { company: "052" }),
    A300_TF: F(CPM1.rows.A300.TF, "working_days", "20.", [P(403)], { company: "052" }),
    criticalCount: F(CRITICAL1.length, "count", "12.", [P(403)], { company: "052" }),
    baseline: F("baselined", "state", "F1 through to baseline.", [P(403)], { company: "052" }),
  },
  WP2: {
    T1ev: F(EV_T1, "cents", "USD 24,000.00.", [P(403, 548)], { company: "052" }),
    T3ev: F(EV_T3, "cents", "USD 39,000.00.", [P(403, 550)], { company: "052" }),
    T4ev: F(EV_T4, "cents", "USD 61,500.00 (hold point).", [P(403, 553)], { company: "052" }),
    quantityT2evA310: F(EV310.typed450, "cents", `USD 67,500.00 = 135,000.00 x 450 / 900. Run after WP-3 (adjudication S1); the check asserts EV(A310) only (project EV then ${fmt(EV_052_AT_WP3)} + ${fmt(EV310.typed450)} = ${fmt(EV_052_AT_WP3 + EV310.typed450)}, not asserted).`, [P(403, 562), ADJ("S1")], { company: "052" }),
    quantityT3evA310: F(EV310.bundle540, "cents", `USD 81,000.00 = 135,000.00 x 540 / 900. EV(A310) only (project EV ${fmt(EV_052_AT_WP3 + EV310.bundle540)}, not asserted).`, [P(403, 563), ADJ("S1")], { company: "052" }),
  },
  WP3: {
    setup: {
      boq: FA(BOQ_EV, "text", "The 087-EV BOQ (WP3.setup.boq): five in-scope rows, each allocated whole; coverage 100%, so F1's baseline passes. E-004's single 900 m2 item keeps WP-2's A310 quantity gates valid.", [P(403), ADJ("S2 087-EV inputs")], { company: "052" }),
      allocations: F(ALLOC, "cents", `The 087-EV allocations (WP3.setup.allocations), in USD: total ${fmt(ALLOCATED_FIVE)} = BAC. 087-EV's loadings and direct costs (WP3.setup.loadings, WP3.setup.directCosts, WP3.T2.addedCost) carry over unchanged, so PV and AC are 087's.`, [P(403, 546, 598), ADJ("S2 087-EV inputs")], { company: "052" }),
    },
    timeZone: F("America/Chicago", "text", "Reporting zone asserted through reporting.timeZoneSource.", [P(403, 1174)], { company: "052" }),
    timeZoneSource: F("organisation", "state", "The organisation default (no project zone, L117/L126).", [P(403, 1174)], { company: "052" }),
    T1: {
      ev: F(M_T1.ev, "cents", why052, [P(403, 598), ADJ("S1")], { company: "052" }),
      spi: F(r6(M_T1.spi), "ratio", `EV / PV = ${fmt(M_T1.ev)} / ${fmt(M_T1.pv)} = ${M_T1.spi} -> 0.251938 (6 dp).`, [P(403, 598), ADJ("S1")], { company: "052" }),
      cpi: F(r6(M_T1.cpi), "ratio", `EV / AC = ${fmt(M_T1.ev)} / ${fmt(M_T1.ac)} = ${M_T1.cpi}.`, [P(403, 598), ADJ("S1")], { company: "052" }),
      eac: F(M_T1.eac, "cents", `BAC / CPI = 387,000.00 x 80,000.00 / 97,500.00 = 317,538.4615... -> ${fmt(M_T1.eac)} (half up).`, [P(403, 598), ADJ("S1")], { company: "052" }),
      sv: F(M_T1.sv, "cents", `EV - PV = ${fmt(M_T1.ev)} - ${fmt(M_T1.pv)} = ${fmt(M_T1.sv)}.`, [P(403, 598), ADJ("S1")], { company: "052" }),
      cv: F(M_T1.cv, "cents", `EV - AC = ${fmt(M_T1.ev)} - ${fmt(M_T1.ac)} = ${fmt(M_T1.cv)}.`, [P(403, 598), ADJ("S1")], { company: "052" }),
      etc: F(M_T1.etc, "cents", `EAC - AC = ${fmt(M_T1.eac)} - ${fmt(M_T1.ac)} = ${fmt(M_T1.etc)}.`, [P(403, 598), ADJ("S1")], { company: "052" }),
      pv: F(M_T1.pv, "cents", `Every 087-EV loading is dated on or before the run date: ${fmt(M_T1.pv)}.`, [P(403, 598)], { company: "052" }),
      ac: F(M_T1.ac, "cents", `A110 50,000 + 10,000 and A130 20,000 = ${fmt(M_T1.ac)}.`, [P(403, 598)], { company: "052" }),
    },
    T2: {
      cpi: F(r6(M_T2.cpi), "ratio", `${fmt(M_T2.ev)} / ${fmt(M_T2.ac)} = ${M_T2.cpi} -> 0.886364. ${why052}`, [P(403, 599), ADJ("S1")], { company: "052" }),
      cpiAlert: F(M_T2.cpiAlert, "bool", "0.886364 < 0.9 -> the alert fires (as in 087).", [P(403, 599), ADJ("S1")], { company: "052" }),
      eac: F(M_T2.eac, "cents", `387,000.00 x 110,000.00 / 97,500.00 = 436,615.3846... -> ${fmt(M_T2.eac)} (half up).`, [P(403, 599), ADJ("S1")], { company: "052" }),
      ac: F(M_T2.ac, "cents", `${fmt(M_T1.ac)} + 30,000.00 on A120 dated 2026-10-01 = ${fmt(M_T2.ac)}.`, [P(403, 599)], { company: "052" }),
    },
    T3: {
      cutoff: F(CUT_0228_CHICAGO, "instant", "End of 2026-02-28 in America/Chicago (CST, UTC-6).", [P(403, 600)], { company: "052" }),
      pv: F(M_T3.pv, "cents", "Calendar-date rows compare by date: 180,000.00 as in 087.", [P(403, 600), H("backend/src/services/earned-value.service.js", "142,726")], { company: "052" }),
      ev: F(0, "cents", "Approvals stamped after the cutoff.", [P(403, 600)], { company: "052" }),
      ac: F(M_T3.ac, "cents", "70,000.00 (L34).", [P(403, 600)], { today: M_T3_HEAD.ac, company: "052" }),
    },
    T4: F("as WP3.T4", "state", "In process, currency- and zone-independent: the same figures.", [P(403, 601)], { company: "052" }),
  },
};

// ─── D3: the small Business/Trial lane ───────────────────────────────────────

const D3 = {
  company: FA("chosen in WP-0 (small Business or Trial, 2-5 people)", "text", "011 is Individual-plan and is not the D3 company (owner decision); the lane keeps 011-LITE's content.", [P(24, 25, 353, 409)]),
  F1byPm: {
    steps: F(["imported", "under_review", "approved", "active", "baselined"], "list", "The PM takes every step (there is no planner).", [P(409, 410)]),
    M900_EF: FA(CPM1.rows.M900.EF, "working_days", "The F1 network (start assumed Monday 2026-01-05).", [P(409)]),
    baselineEqualsEarly: F(true, "bool", "As WP1.baseline.covered.", [P(409)]),
  },
  boq: {
    rows: FA(BOQ_EV.length, "count", "The 087-EV BOQ (WP3.setup.boq, rows E-001..E-005): five rows, each allocated whole so coverage is full for the baseline: 60,000 (A110), 30,000 (A120), 90,000 (A130), 135,000 (A310), 72,000 (A320).", [P(409), ADJ("S2 087-EV inputs")]),
    allocated: FA(ALLOCATED_FIVE, "cents", `The 087-EV allocations (WP3.setup.allocations): sum ${fmt(ALLOCATED_FIVE)}; coverage 100%.`, [P(409), ADJ("S2 087-EV inputs")]),
  },
  progress: {
    submitter: F("site engineer", "text", "Submits.", [P(409)]),
    approver: F("QS", "text", "Approves.", [P(409)]),
  },
  WP3: {
    T1: metricLeaves(M_T1, [P(409, 598)], { assumption: true, extra: { note: "assumes the D3 lane carries 087-EV's loadings, direct costs and approvals (A110 100, A120 50, A130 25), in the company's two-decimal minor units" } }),
  },
};

// ─── tree, flattening, exports ───────────────────────────────────────────────

const TREE = { WP0, CLAUDE, WP1, WP2, WP3, D2, D3 };

function isLeaf(node) {
  return node && typeof node === "object" && !Array.isArray(node) && "value" in node && "unit" in node && "derivation" in node;
}

/** Flattens the tree to [{ key, value, unit, derivation, source, assumption, planDisagrees, planValue?, today?, company?, note? }]. */
function figures() {
  const out = [];
  const walk = (node, path) => {
    if (isLeaf(node)) {
      const row = { key: path.join("."), value: node.value, unit: node.unit, derivation: node.derivation, source: node.source, assumption: node.assumption, planDisagrees: node.planDisagrees };
      for (const extra of ["planValue", "today", "company", "note"]) if (node[extra] !== undefined) row[extra] = node[extra];
      out.push(row);
      return;
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") walk(v, [...path, k]);
  };
  walk(TREE, []);
  return out;
}

module.exports = {
  meta: {
    section: "schedule",
    head: HEAD,
    plan: PLAN,
    planNumbering: "working tree 2026-10-09 (Q-KEY line at :36); HEAD b0ec5b0 numbering is one lower from :36 on",
    scope: ["WP0 stage2:154", "WP0 stage9:135,153,218", "WP1", "WP2", "WP3", "087-SCH", "087-IMP", "087-EV", "052-SCH-EV", "D3 lane"],
    ownerDecisions: { "HR-S2": "plan :30", "HR-P1": "plan :28", "HR-Q1": "plan :27", "HR-X1": "plan :31" },
    runDateAssumption: "on or after 2026-10-01 (087-EV's latest dated transaction); T1/T2 'cutoff today' include every 087-EV row",
    scratch: "C:/Temp/octapm-cert/scratch/wp0/schedule-calc.js (independent recomputation), load-schedule.js (load test)",
  },
  inputs: {
    start: START,
    calendar: "five_day",
    wbs: WBS,
    F1: { tasks: F1_TASKS, columns: ["task_code", "task_name", "wbs", "target_drtn_hr_cnt", "FS predecessor (lag 0 h)", "phys_complete_pct"], totalFloatHours: Object.fromEntries(CODES.map((c) => [c, CPM1.rows[c].TF * 8])), M900EarlyStartAndFinish: workingDate(START, CPM1.rows.M900.EF) },
    F1b: { tasks: F1B_TASKS, note: "A110 160 h; A140 left out (the one retirement)" },
    tail087SCH: TAIL,
    F2,
    F3,
    boq087SCH: BOQ_087SCH,
    methods087SCH: METHODS_087SCH,
    ev087: EV087,
    progressFile: PROGRESS_FILE,
  },
  WP0,
  CLAUDE,
  WP1,
  WP2,
  WP3,
  D2,
  D3,
  rules: { hoursToDays, lagHoursToDays, tenthsToDays, mspDurationDays, cpm, workingDate, evOf, qtyEv, evMetrics, endOfLocalDay, defaultPeriod, forecastPace, forecastEvFinish, deriveStatus, acLedger, acHead },
  figures,
};
