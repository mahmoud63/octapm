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
 * Leaf shape (the same as answers/field-controls.js, plus `ref`):
 *   { value, unit, derivation, source, assumption, planDisagrees,
 *     planValue?, today?, ref?, company?, note? }
 *   value        the expected answer (what the proof must assert)
 *   today        what HEAD does now, where the plan or the code shows it differs
 *   ref          the §5 row (or finding) a `today` waits on, e.g. 'HR-S6'; set
 *                on the leaves added for the WP-1 proof authoring (2026-10-10)
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
 *
 * The integration owner's adjudication of the WP-0 deep-company builders
 * (2026-10-09, C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md) is
 * applied on paper: WP1.T3.file (F3 as P6 exports it, item 5 of
 * 087-SCH/087-IMP; inputs.F3file), the reporting zone (WP3.setup / D2.WP3 /
 * D3.WP3 timeZone, timeZoneSource 'project', timeZoneNote; 087-EV item 5,
 * R1-15, R3-2) and the future period as a function of the run date
 * (WP3.periods.futurePeriod, rules.futurePeriodFor / ev087PeriodsFor; 087-EV
 * item 6). Entries added for it cite plan lines as numbered at f599e67 (PF);
 * their product citations keep the @886c9f1 tag, and every product file they
 * cite is unchanged at f599e67 except schedule.service.js (critical_path
 * readiness :849-866 @886c9f1 is :855-872 @f599e67, same code).
 * Its round 2 (R2-B B4) adds WP3.periods.afterLock.runDateAfterCost and
 * .runDateAfterApproval: the run-date metric sets after the back-dated cost
 * and after the new approval, one per outcome of the T5 delete probe.
 * Its round 3 (R3-2) adds WP3.periods.afterLock.cutoffAfterCost (the
 * 2026-02-28 read after the back-dated cost) and WP3.T6.before / WP3.T6.after
 * (the run-date reads around the retirement, one set per probe outcome), so
 * 087-ev.js asserts leaves and computes nothing.
 *
 * The integration owner's adjudication of the WP-1 proof authoring
 * (2026-10-10, C:\Temp\octapm-cert\scratch\wp1\author-adjudication.md,
 * BOOK-1..BOOK-7) is applied: WP1.dates.calendarChange (BOOK-1, HR-S6);
 * WP1.dates.endBeforeStartRefused (BOOK-2) and WP1.dates.zeroDurationCreate
 * (the other half of the same create check); WP1.revisions.rejectWithoutReason
 * and WP1.revisions.activate.olderRevision now carry the adjudicated
 * contracts, the plan's codes kept as planValue (BOOK-3), and
 * WP1.revisions.notCurrent takes the lifecycle code the older-revision leaf
 * named before; WP1.revisions.activate.recordTwoHandBuilt (BOOK-4); the
 * inputs WP1.T4.FSlead.inputs, WP1.mixedCalendar.inputs and
 * WP1.conversion.rangeBoundary.beyondMaxInput (BOOK-5);
 * WP1.imports.twoProjectXerStaging, WP1.imports.secondCalendarIds and the
 * HR-P5 per-surface leaves of WP1.status.A200fileFortyPercent (BOOK-6);
 * WP1.mutations.stagedImportWrites names its catcher (BOOK-7). Their product
 * citations are read at f599e67 (HF, `@f599e67`), plan lines PF. No other
 * existing value or today changed; load checks after WP1 tie the new leaves
 * to the figures they are built from.
 *
 * The integration owner's binding adjudication of the WP-2 preparation
 * (2026-10-10, C:/Temp/octapm-cert/scratch/wp2/WP2-ADJUDICATION.md Q1-Q12,
 * cited WP2ADJ(...); the preparation WP2-PREP.md beside it, PREP2(...)) is
 * applied to the answer-book gaps of WP2-PREP.md section 9: G1
 * (WP2.rules.rejectWithoutReason), G2 (WP2.quantitiesA310.entryRefusals.
 * negative and negativeService, Q4), G3 (WP2.methodStands, Q5), G4
 * (WP2.quantityView.withoutBoqRead: the reason's text, route, member,
 * itemRoute), G5 and G6 (WP2.bulk.mixedBatch.a330SubmissionsDelta and
 * choreography), G7 and G8 (WP2.dailyReport.approver, plannerApprove,
 * qsApprove, holdInstance, release), G9 (WP2.T4.probes.
 * retroactiveTemplateEdit as per-activity figures; retroactiveBeforeEdit),
 * G10 (WP2.importProgress.site.reuploadRows, pm.A110approvesPending,
 * pm.projectEvAfter), G11 (WP2.T4.siteVoid), G15 (WP2.endState087SCH), G16
 * (WP2.quantitiesA310.dailyLog.evReportPct), G17
 * (WP2.T3.withDocument.evidence), G22 (WP2.T2.siteOnA330ActivityIds and
 * siteOnA330SubmissionsDelta) and G23 (WP2.T6.methodBypass typed 30 of 100;
 * methodBypassInputs); WP2.mutations.dropMethodStands, removeNegativeGuard
 * and splitBulkTransaction name their catchers. Not here: G12 and G13 wait
 * for the HR-Q1 / HR-P1 plan review (Q2), G19 for the HR-X1 batch plan
 * review (Q3), G14 is not added (Q9), G18 (Q6) and G20 (Q8) are not needed.
 * Product citations are read at f599e67 (HF), plan lines PF (numbered at
 * f599e67), build scripts BLD (@fc29478). Every changed value keeps its old
 * value in its note; load checks after WP2 tie the new leaves to the
 * figures they are built from.
 * Changed keys: answers/CHANGES-WP0-BUILDERS.md (rounds 1-2, and the sections
 * "WP-1 proof authoring (2026-10-10)" and "WP-2 answer-book leaves
 * (2026-10-10)") and
 * answers/CHANGES-WP0-BUILDERS-r3-ev-sch-lanes-extras.md (round 3).
 */

const PLAN = "docs/certification/OCTAPM_CERT3_PLAN.md";
const HEAD = "886c9f1";
const AREA = "C:/Temp/octapm-cert/scratch/cert3-areas.json[0] (schedule area map)";
/** The integration owner's binding decisions for this section. */
const ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp0/adjudication.md §A schedule.js ${item}`;
/** The integration owner's binding adjudication of the WP-0 deep-company builders (2026-10-09). */
const BADJ = (item) => `C:/Temp/octapm-cert/scratch/wp0/builders-adjudication.md ${item}`;
const P = (...lines) => `${PLAN}:${lines.join(",")}`;
/** Plan lines as numbered at product HEAD f599e67 (entries added for the builders' adjudication use this numbering). */
const PF = (...lines) => `${PLAN}:${lines.join(",")} @f599e67`;
const H = (file, lines) => `${file}:${lines} @${HEAD}`;
/** Product lines read at f599e67 (`git show f599e67:<path>`): the WP-1 proof authoring entries (2026-10-10). */
const HF = (file, lines) => `${file}:${lines} @f599e67`;
/** The integration owner's binding adjudication of the WP-1 proof authoring (2026-10-10). */
const WADJ = (item) => `C:/Temp/octapm-cert/scratch/wp1/author-adjudication.md ${item}`;
/** The WP-1 preparation (read only, 2026-10-09), whose §7 items the adjudication settles. */
const PREP1 = (item) => `C:/Temp/octapm-cert/scratch/wp1-prep.md ${item}`;

/** The integration owner's binding adjudication of the WP-2 preparation (2026-10-10, Q1-Q12). */
const WP2ADJ = (item) => "C:/Temp/octapm-cert/scratch/wp2/WP2-ADJUDICATION.md " + item;
/** The WP-2 preparation (read only, 2026-10-10), whose section 9 book gaps G1-G23 the adjudication settles. */
const PREP2 = (item) => "C:/Temp/octapm-cert/scratch/wp2/WP2-PREP.md " + item;
/** A deep-company build script (not product code), read at fc29478. */
const BLD = (file, lines) => "backend/scripts/cert/cert3/build/" + file + ":" + lines + " @fc29478";

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
  if (opts.ref) leaf.ref = opts.ref;
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

/**
 * 087-EV's future period (builders' adjudication 087-EV item 6): the month
 * after the run month, so its cutoff is never reached on the run date
 * whenever the build runs. runDate is the company-local run date
 * (YYYY-MM-DD); December rolls into January of the next year. The cutoff is
 * the period's last day, at least 28 days (the shortest month) after the run
 * date, so no zone offset can bring it within reach on the run date.
 */
function futurePeriodFor(runDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(runDate));
  if (!m || Number.isNaN(Date.parse(`${runDate}T00:00:00.000Z`))) throw new Error(`futurePeriodFor: run date ${runDate} is not YYYY-MM-DD`);
  const year = Number(m[2]) === 12 ? Number(m[1]) + 1 : Number(m[1]);
  const month = Number(m[2]) === 12 ? 1 : Number(m[2]) + 1;
  const mm = String(month).padStart(2, "0");
  const last = String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0");
  return { code: `${year}-${mm}`, start: `${year}-${mm}-01`, end: `${year}-${mm}-${last}`, cutoff: `${year}-${mm}-${last}`, lock: "L113 probe (cutoff not reached)" };
}
const EV087_FIXED_PERIODS = [
  { code: "2026-01", start: "2026-01-01", end: "2026-01-31", cutoff: "2026-01-31", lock: "normal (finance, gate ready)" },
  { code: "2026-02", start: "2026-02-01", end: "2026-02-28", cutoff: "2026-02-28", lock: "PM with a readiness override" },
];
/** 087-EV's three reporting periods for a run date: 2026-01, 2026-02 and the future one (futurePeriodFor). */
const ev087PeriodsFor = (runDate) => [...EV087_FIXED_PERIODS.map((p) => ({ ...p })), futurePeriodFor(runDate)];

/** 087-EV (plan :386; area map workflow "Earned value" setup). */
const EV087 = {
  boq: BOQ_EV,
  allocations: Object.fromEntries(Object.entries(ALLOC).map(([a, c]) => [a, c / 100])),
  loadings: [["A110", 60_000, "2026-01-23"], ["A120", 30_000, "2026-01-28"], ["A130", 90_000, "2026-02-13"], ["A310", 135_000, "2026-03-20"], ["A320", 72_000, "2026-04-10"]],
  progress: { A110: 100, A120: 50, A130: 25 },
  directCosts: [["A110", 50_000, "2026-01-20"], ["A110", 10_000, "2026-09-30"], ["A130", 20_000, "2026-02-10"]],
  t2Cost: ["A120", 30_000, "2026-10-01"],
  budgetRevision: { amount: 13_000, changeType: "addition", effectiveDate: "2026-03-01" },
  // The reference instance for the reference run date (RUN, 2026-10-09 -> future period 2026-11);
  // a build or proof takes its own with rules.ev087PeriodsFor(runDate) (builders' adjudication 087-EV item 6).
  periods: ev087PeriodsFor("2026-10-09"),
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
if (JSON.stringify(EV087.periods) !== JSON.stringify(ev087PeriodsFor(RUN))) throw new Error("schedule answer book: EV087.periods must be ev087PeriodsFor(RUN)");
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
/**
 * F3 as P6 exports it (builders' adjudication 087-SCH/087-IMP item 5, R1-2):
 * the FILE carries P6's own late pass, which ends every path at the project
 * finish, so A (whose only successor is SS) gets LF = the finish = EF(A) and
 * TF 0, i.e. SS_CAP. The early pass and B are the same capped or not. The
 * product's own CPM after activation is a different thing (HR-S1: no cap
 * today, WP1.T3.A.*.today); build/files.js F3() writes these figures and
 * refuses to load if its model differs from them.
 */
const F3_FILE_CODES = ["A", "B"];
const F3_FILE = {
  basis: "P6 late pass: LF capped at the project finish (a path with no finish successor ends there)",
  capLf: true,
  projectFinish: SS_CAP.end,
  projectFinishDate: workingDate(START, SS_CAP.end),
  activities: Object.fromEntries(F3_FILE_CODES.map((code) => {
    const r = SS_CAP.rows[code];
    return [code, {
      ES: r.ES, EF: r.EF, LS: r.LS, LF: r.LF, TF: r.TF, totalFloatHours: r.TF * 8, critical: r.critical,
      earlyStartDate: workingDate(START, r.ES), earlyFinishDate: workingDate(START, r.EF),
      lateStartDate: workingDate(START, r.LS), lateFinishDate: workingDate(START, r.LF),
    }];
  })),
};
if (F3_FILE_CODES.some((c) => SS_CAP.rows[c].ES !== SS_TODAY.rows[c].ES || SS_CAP.rows[c].EF !== SS_TODAY.rows[c].EF) || JSON.stringify(SS_CAP.rows.B) !== JSON.stringify(SS_TODAY.rows.B) || SS_CAP.end !== SS_TODAY.end) {
  throw new Error("schedule answer book: F3's capped late pass must move only A's late dates and float");
}
/**
 * The FS-lead variant of T3 (plan :525 'FS - 8 variant', WP1.T4.FSlead.inputs): T3's A and B (F3D, plan :524) with
 * FS -8 in place of SS +2, in working days. A generated file writes them x 8 as P6 hours (A 80 h, B 24 h, lag -64 h).
 */
const FSL_IN = { A: F3D.A, B: F3D.B, lag: -8 };
const FSL_TODAY = cpm([{ id: "A", d: FSL_IN.A }, { id: "B", d: FSL_IN.B }], [{ p: "A", s: "B", t: "FS", lag: FSL_IN.lag }]);
const FSL_CAP = cpm([{ id: "A", d: FSL_IN.A }, { id: "B", d: FSL_IN.B }], [{ p: "A", s: "B", t: "FS", lag: FSL_IN.lag }], { capLf: true });
const FF_TODAY = cpm([{ id: "A", d: 10 }, { id: "B", d: 15 }], [{ p: "A", s: "B", t: "FF", lag: 0 }]);
const FF_CAP = cpm([{ id: "A", d: 10 }, { id: "B", d: 15 }], [{ p: "A", s: "B", t: "FF", lag: 0 }], { capLf: true });
const SF_TODAY = cpm([{ id: "A", d: 5 }, { id: "B", d: 4 }], [{ p: "A", s: "B", t: "SF", lag: 10 }]);
const SF_CAP = cpm([{ id: "A", d: 5 }, { id: "B", d: 4 }], [{ p: "A", s: "B", t: "SF", lag: 10 }], { capLf: true });
/** The mixed-calendar pair (plan :528, WP1.mixedCalendar.inputs): A five_day 5 d, FS 0, then B seven_day 2 d. */
const MIXED_IN = { A: { duration: 5, calendar: "five_day" }, B: { duration: 2, calendar: "seven_day" }, link: { type: "FS", lag: 0 } };
const MIXED = cpm([{ id: "A", d: MIXED_IN.A.duration }, { id: "B", d: MIXED_IN.B.duration }], [{ p: "A", s: "B", t: MIXED_IN.link.type, lag: MIXED_IN.link.lag }]);
/** The range boundary (plan :504, WP1.conversion.rangeBoundary): SCHEDULE_DAYS_MAX restated (schedule-days.js:18) and the two file inputs in hours. */
const RANGE_IN = { maxDays: 36_500, atMaxHours: 36_500 * 8, beyondMaxHours: 36_500 * 8 + 4 };
/** F4's second PROJECT (build/files.js F4() :285-301 @363651a, restated): three tasks in hours, FS B100 -> B110 -> B120. F4's first PROJECT is F1. */
const F4_FIRST = "CERT3-FIRST";
const F4_SECOND = { projectId: "CERT3-SECOND", tasks: [["B100", 16], ["B110", 40], ["B120", 0]], links: [["B100", "B110"], ["B110", "B120"]] };
const F4_ROWS = F1_TASKS.length + F4_SECOND.tasks.length;
/** F6's calendars (build/files.js :114, :160, F6() :314-326, restated): the default clndr_id '1' on every task but A300 and A330, which carry '2'. */
const F6_CAL = { default: "1", second: "2", secondName: "6 Day Night Shift", secondOn: ["A300", "A330"] };
/** A200's file percent (inputs.F1, phys_complete_pct; plan :552) and search's own status rule (search.service.js:223-228 @f599e67). */
const A200_FILE_PCT = F1_TASKS.find((t) => t[0] === "A200")[5];
const searchStatusOf = (pct) => (pct >= 100 ? "complete" : pct > 0 ? "in_progress" : "todo");
/** The hand-built activities of the WP-1 proof's W choreography (adjudication P-Q1, BOOK-4). */
const W_HAND_BUILT = ["A100", "A110"];
/** The calendar-change probe (BOOK-1, HR-S6): the project calendar five_day -> seven_day, then back. */
const CAL_CHANGE = { from: "five_day", to: "seven_day" };

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
  /**
   * The F3 FILE as P6 exports it (builders' adjudication 087-SCH/087-IMP item 5, R1-2):
   * build/files.js F3() writes exactly these figures. They are the file's
   * content, not the product's CPM: after activation the product recomputes
   * without the cap (A TF 5, LF 15 today; HR-S1 recommends A TF 0), which stays
   * the HR-S1 observation in WP1.T3.A / WP1.T3.criticalCount above.
   */
  file: (() => {
    const fa = F3_FILE.activities;
    const src = [PF(424), P(385, 485), BADJ("087-SCH/087-IMP item 5; R1-2")];
    const fileSrc = [...src, H("backend/src/parsers/xer-parser.js", "139-147"), H("backend/src/services/import.service.js", "249-253")];
    const capped = `P6's late pass ends a path that has no finish successor at the project finish ${SS_CAP.end} (= EF(A)): A's only successor is SS, so its backward candidate LS(B) ${SS_TODAY.rows.B.LS} - lag ${F3D.lag} + d ${F3D.A} = ${SS_TODAY.rows.A.LF} is capped at ${SS_CAP.end}`;
    const rowLeaves = (code) => {
      const r = fa[code];
      return {
        ES: F(r.ES, "working_days", code === "A" ? "No predecessor: ES 0 (unchanged by the cap)." : `ES = ES(A) 0 + SS lag ${F3D.lag} = ${r.ES} (unchanged by the cap).`, src),
        EF: F(r.EF, "working_days", `${r.ES} + ${code === "A" ? F3D.A : F3D.B} = ${r.EF} (unchanged by the cap).`, src),
        LS: F(r.LS, "working_days", code === "A" ? `${capped}; LS = LF ${r.LF} - d ${F3D.A} = ${r.LS}.` : `No successor: LF = project finish ${r.LF}; LS = ${r.LF} - ${F3D.B} = ${r.LS} (the same capped or not).`, src),
        LF: F(r.LF, "working_days", code === "A" ? `${capped} = A's own EF ${r.EF}.` : `No successor: the project finish ${r.LF}.`, src),
        totalFloatHours: F(r.totalFloatHours, "hours", code === "A" ? `TF = LF ${r.LF} - EF ${r.EF} = ${r.TF} days -> total_float_hr_cnt ${r.TF} x 8 = ${r.totalFloatHours} h (the uncapped pass would write ${SS_TODAY.rows.A.TF * 8} h, which P6 never exports).` : `TF = ${r.LF} - ${r.EF} = ${r.TF} days -> ${r.TF} x 8 = ${r.totalFloatHours} h (the same capped or not).`, fileSrc),
        earlyStartDate: F(r.earlyStartDate, "date", `Working day ${r.ES} from Monday ${START} (five_day).`, [...src, DATE_SRC]),
        earlyFinishDate: F(r.earlyFinishDate, "date", `Working day ${r.EF} from ${START}, exclusive finish (HR-S7).`, [...src, DATE_SRC]),
        lateStartDate: F(r.lateStartDate, "date", `Working day ${r.LS} from ${START}.`, [...src, DATE_SRC]),
        lateFinishDate: F(r.lateFinishDate, "date", `Working day ${r.LF} from ${START}, exclusive.`, [...src, DATE_SRC]),
      };
    };
    return {
      durationHours: F({ A: F3.A, B: F3.B }, "hours", `target_drtn_hr_cnt A ${F3.A} h, B ${F3.B} h (plan §3.2 087-IMP), read as ${F3D.A} and ${F3D.B} working days (WP1.T3.inputs); unchanged by the cap.`, fileSrc),
      link: F({ pred: "A", succ: "B", type: F3.rel, lagHours: F3.lagHours }, "text", `One TASKPRED row A -> B, PR_SS, lag_hr_cnt ${F3.lagHours} (= ${F3D.lag} working days); unchanged by the cap.`, [...src, H("backend/src/parsers/xer-parser.js", "46-50")]),
      projectFinish: F(F3_FILE.projectFinish, "working_days", `max EF = EF(A) ${SS_CAP.rows.A.EF}: A drives the finish (B ends at ${SS_CAP.rows.B.EF}).`, src),
      projectFinishDate: F(F3_FILE.projectFinishDate, "date", `Working day ${F3_FILE.projectFinish} from Monday ${START}, exclusive finish.`, [...src, DATE_SRC]),
      A: rowLeaves("A"),
      B: rowLeaves("B"),
      stagedCriticalCount: F(F3_FILE_CODES.filter((c) => hoursToDays(fa[c].totalFloatHours) === 0).length, "count", `The staged revision is judged on the file's own float (HR-S3; isCritical = round(file TF days) === 0): A ${fa.A.totalFloatHours} h -> ${hoursToDays(fa.A.totalFloatHours)} -> critical; B ${fa.B.totalFloatHours} h -> ${hoursToDays(fa.B.totalFloatHours)} -> not. One critical row, so critical_path passes and F3 can be approved and activated as plan §3.2 asks (with the uncapped ${SS_TODAY.rows.A.TF * 8} h on A it marks none: 400 SCHEDULE_NOT_READY, critical_path).`, [...fileSrc, H("backend/src/services/schedule.service.js", "397,849-866")]),
      stagedLate: F(Object.fromEntries(F3_FILE_CODES.map((c) => [c, { lateStart: fa[c].LS, lateFinish: fa[c].LF, totalFloat: fa[c].TF }])), "working_days", `The staged snapshot reads the file's late dates as working-day offsets from the project start ${START} and its float as hours / 8: A ${fa.A.LS}/${fa.A.LF}/${fa.A.TF}, B ${fa.B.LS}/${fa.B.LF}/${fa.B.TF} (087-IMP starts ${START}, five_day).`, fileSrc),
    };
  })(),
};

const T4 = {
  FSlead: {
    inputs: F({ ...FSL_IN }, "working_days",
      `The FS-lead variant of T3 (plan :525 'FS - 8 variant: B ES 2'): T3's A(${FSL_IN.A}) and B(${FSL_IN.B}) (WP1.T3.inputs: ${F3.A} h / 8 = ${F3D.A}, ${F3.B} h / 8 = ${F3D.B}; plan :524) with FS ${FSL_IN.lag} in place of SS +${F3D.lag}. In working days, as WP1.T4.FF.inputs and WP1.T4.SF.inputs are; a generated file writes each x 8 as P6 hours: A ${FSL_IN.A * 8} h (target_drtn_hr_cnt), B ${FSL_IN.B * 8} h, FS lag ${FSL_IN.lag * 8} h (lag_hr_cnt), which the parser reads back as ${FSL_IN.A * 8} / 8 = ${FSL_IN.A}, ${FSL_IN.B * 8} / 8 = ${FSL_IN.B} (Math.round, clamped at 0) and ${FSL_IN.lag * 8} / 8 = ${FSL_IN.lag} (Math.round, no clamp). The B_ES/B_EF/A_TF leaves below are worked on these figures (B ES = EF(A) ${FSL_IN.A} + lag ${FSL_IN.lag} = ${FSL_TODAY.rows.B.ES}).`,
      [PF(524, 525), HF("backend/src/parsers/xer-parser.js", "40-50"), WADJ("BOOK-5; L1")],
      { note: `units: working days; the file's hours are value x 8 (A ${FSL_IN.A * 8} h, B ${FSL_IN.B * 8} h, lag ${FSL_IN.lag * 8} h)` }),
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
    inputs: FA(MIXED_IN, "text",
      `A ${MIXED_IN.A.duration} working days on ${MIXED_IN.A.calendar}, ${MIXED_IN.link.type} lag ${MIXED_IN.link.lag}, then B ${MIXED_IN.B.duration} working days on ${MIXED_IN.B.calendar}, on a ${MIXED_IN.A.calendar} project starting Monday ${START}. A's ${MIXED_IN.A.duration} days follow from the plan's date (:528 'must start on or after 2026-01-12'): ${MIXED_IN.A.duration} working days on five_day from Monday ${START} end at working day ${MIXED.rows.A.EF} = ${workingDate(START, MIXED.rows.A.EF, MIXED_IN.A.calendar)} (WP1.mixedCalendar.A_finishDate). B's ${MIXED_IN.B.duration} days are a choice (the plan states no duration; any B shows the defect, which is in B's start: offset ${MIXED.rows.B.ES} dated on the seven-day calendar from ${START} = ${workingDate(START, MIXED.rows.B.ES, MIXED_IN.B.calendar)}, a ${weekday(workingDate(START, MIXED.rows.B.ES, MIXED_IN.B.calendar))}). In process: calculateCpm([{ id: 'A', duration: ${MIXED_IN.A.duration}, calendarId: '${MIXED_IN.A.calendar}' }, { id: 'B', duration: ${MIXED_IN.B.duration}, calendarId: '${MIXED_IN.B.calendar}' }], ${MIXED_IN.link.type} ${MIXED_IN.link.lag}) with projectStartDate ${START}, projectCalendar '${MIXED_IN.A.calendar}' (each activity dated on its own calendar, cpm.service.js:354-385).`,
      [PF(528, 567, 1031), HF("backend/src/services/cpm.service.js", "89-92,125-166,354-385"), WADJ("BOOK-5; L1")],
      { note: "A's duration is the plan's (through its date); B's is a choice" }),
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
      beyondMaxInput: FA(RANGE_IN.beyondMaxHours, "hours",
        `The beyond-the-bound file's one task: SCHEDULE_DAYS_MAX ${RANGE_IN.maxDays} (schedule-days.js:18) x 8 + 4 = ${RANGE_IN.beyondMaxHours} h (target_drtn_hr_cnt; remain_drtn_hr_cnt the same at 0%). It is the smallest whole-hour figure past the bound after the parser's rounding: ${RANGE_IN.atMaxHours + 1}..${RANGE_IN.atMaxHours + 3} h / 8 = ${(RANGE_IN.atMaxHours + 1) / 8}..${(RANGE_IN.atMaxHours + 3) / 8} round to ${RANGE_IN.maxDays} (staged), while ${RANGE_IN.beyondMaxHours} / 8 = ${RANGE_IN.beyondMaxHours / 8} -> Math.round (half up) -> ${hoursToDays(RANGE_IN.beyondMaxHours)} > ${RANGE_IN.maxDays}, so assertScheduleFigures refuses the whole file before anything is staged (WP1.conversion.rangeBoundary.beyondMax). The at-bound file's input is WP1.conversion.rangeBoundary.atMax x 8 = ${RANGE_IN.atMaxHours} h.`,
        [PF(504), HF("backend/src/utils/schedule-days.js", "18"), HF("backend/src/parsers/xer-parser.js", "40-44"), HF("backend/src/services/import.service.js", "170-193"), WADJ("BOOK-5; L1")],
        { note: "a choice (any whole-hour figure from 292,004 h up is refused; 292,004 h is the nearest)" }),
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
    twoProjectXerStaging: FA(
      { mergedRows: 0, rowsIfChosen: { [F4_FIRST]: F1_TASKS.length, [F4_SECOND.projectId]: F4_SECOND.tasks.length } },
      "text",
      `F4 (build/files.js F4() :285-301) is one XER with two PROJECT rows: ${F4_FIRST} = F1 (${F1_TASKS.length} TASK rows, ${NET1.links.length} TASKPRED links; WP1.T1.network) and ${F4_SECOND.projectId} (${F4_SECOND.tasks.map(([c, h]) => `${c} ${h} h`).join(", ")}; ${F4_SECOND.links.length} FS links ${F4_SECOND.links.map(([p, s]) => `${p}->${s}`).join(", ")}): ${F1_TASKS.length} + ${F4_SECOND.tasks.length} = ${F4_ROWS} TASK rows in all. `
        + `Expected (HR-S4 recommendation 'refuse two-project files without a project choice', undecided; WP1.imports.twoProjectXer): no staged revision merges the two projects, mergedRows 0. Either the file is refused (a 4xx whose status and code the fix chooses; null here, never guessed) and nothing is staged, or the user is asked which project and only that project's rows are staged: ${F4_FIRST} ${F1_TASKS.length} or ${F4_SECOND.projectId} ${F4_SECOND.tasks.length} (rowsIfChosen). `
        + `HEAD (today): the parser reads every TASK and TASKPRED row whatever its proj_id (xer-parser.js extractActivities :113-152, extractRelationships :154-163; no PROJECT filter) and persistImport stages them as one draft revision (import.service.js:366-393 -> :300-364; activityCount and imported = activities.length :330, :356; status draft :336), answered 201 (routes/import.js:93): ${F1_TASKS.length} + ${F4_SECOND.tasks.length} = ${F4_ROWS} rows merged.`,
      [PF(424, 532, 568, 1030), HF("backend/src/parsers/xer-parser.js", "113-163"), HF("backend/src/services/import.service.js", "300-364,366-393"), HF("backend/src/routes/import.js", "61-93"), WADJ("BOOK-6; M4")],
      { today: { http: 201, revisionStatus: "draft", mergedRows: F4_ROWS, imported: F4_ROWS, activityCount: F4_ROWS }, ref: "HR-S4", note: "the figures a fresh F4 staging is judged by; WP1.imports.twoProjectXer (value and its prose today) is unchanged because build/087-imp.js interpolates that today as text" },
    ),
    secondCalendarIds: F(
      Object.fromEntries(CODES.map((c) => [c, F6_CAL.secondOn.includes(c) ? F6_CAL.second : F6_CAL.default])),
      "text",
      `F6 (build/files.js F6() :314-326) is F1 with clndr_id '${F6_CAL.second}' ('${F6_CAL.secondName}') on ${F6_CAL.secondOn.join(" and ")} and the default calendar '${F6_CAL.default}' (files.js:114, :160) on the other ${CODES.length - F6_CAL.secondOn.length} tasks; the XER TASK row writes it (files.js:357, :367). The parser reads clndr_id (xer-parser.js:138) and the snapshot keeps the file's id, falling back to the project calendar only when a row names none (import.service.js:222-223), so the staged revision records every id as the file names it. `
        + `That is HR-S4's value ('calendars recorded as P2'; WP1.imports.secondCalendar, the value branch made explicit, adjudication L9), and HEAD stages the same: the difference HR-S4 records is downstream, after activation, where CPM resolves an id it does not know ('${F6_CAL.default}' and '${F6_CAL.second}' alike) to the project calendar (cpm.service.js:80-92; WP1.imports.secondCalendar's today).`,
      [PF(424, 568, 1030), HF("backend/src/parsers/xer-parser.js", "105-112,138"), HF("backend/src/services/import.service.js", "218-236"), HF("backend/src/services/cpm.service.js", "80-92"), WADJ("BOOK-6; L9")],
      { note: "the staged ids are the same under HR-S4's value and today; WP1.imports.secondCalendar keeps the judgement" },
    ),
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
      siteEngineerActivate: F("403 FORBIDDEN", "http", "POST .../revisions/:revisionId/activate by the site engineer: the route is guarded by requirePermission('schedule', 'approve', { transition: 'revision.activate' }) (routes/schedule.js:242-245); shared/permissions.json gives schedule.approve and the transition revision.activate to the PM only, so the role gate refuses before the service: 403 FORBIDDEN (middleware/rbac.js:149-153). Plan :509 'the site engineer and an outsider are refused'.", [PF(509), HF("backend/src/routes/schedule.js", "242-245"), HF("shared/permissions.json", "modules.schedule"), HF("backend/src/middleware/rbac.js", "149-153"), WADJ("M6 (verifier question 6: dedicated leaves)")]),
      siteEngineerRollback: F("403 FORBIDDEN", "http", "POST .../revisions/:revisionId/rollback (sent with a reason) by the site engineer: requirePermission('schedule', 'approve', { transition: 'revision.rollback' }) (routes/schedule.js:300-303); schedule.approve and revision.rollback are the PM's only (shared/permissions.json), so 403 FORBIDDEN before the service (middleware/rbac.js:149-153).", [PF(509), HF("backend/src/routes/schedule.js", "300-303"), HF("shared/permissions.json", "modules.schedule"), HF("backend/src/middleware/rbac.js", "149-153"), WADJ("M6 (verifier question 6: dedicated leaves)")]),
      outsider: F("404 PROJECT_NOT_FOUND", "http", "PM of 088 on any revision route.", [P(366, 470)]),
    },
    approve: {
      planner: F("403 FORBIDDEN", "http", "Approval is the PM's (role gate).", [P(470, 497)]),
      siteEngineer: F("403 FORBIDDEN", "http", "Role gate.", [P(497)]),
      pm: F("approved", "state", "under_review -> approved. HR-S2 (decided): M900's equal start and finish does not fail date_sanity.", [P(30, 497, 989)], { today: "400 SCHEDULE_NOT_READY (date_sanity: finish_date_before_start_date on M900)" }),
    },
    rejectApproved: F("409 INVALID_REVISION_STATUS", "http", "Reject is allowed from under_review only (sent with a reason, so the status guard answers).", [P(498), H("backend/src/services/schedule.service.js", "1087,3866")]),
    rejectWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST .../schedule/revisions/:revisionId/reject with no reason, on an under_review revision, by the PM: the route chain reasonRequired('A rejection reason is required.', 'The rejection reason') (routes/schedule.js:107-117, on the reject route :371-392) fails body('reason').isString() and validateWithReasons answers before the service: 400 VALIDATION_ERROR, message 'A rejection reason is required.' (the first failing check's own message), error.details holding an entry whose field is 'reason' (middleware/validate.js:7-12, :34-56; details are sent outside production). The service's REJECTION_REASON_REQUIRED (schedule.service.js:3960-3966, after the status guard :3958) is not reached through the route. "
        + "HEAD's VALIDATION_ERROR naming the field is the contract (integration owner's adjudication BOOK-3, settling WP-1 prep §7 D1; the WP-0 F1 precedent, answers/field-controls.js header). The plan's revision-state codes (:505) name REJECTION_REASON_REQUIRED, kept as planValue: no request through the API can draw it. Sent again with a reason, the revision reads rejected.",
      [PF(505, 537), HF("backend/src/routes/schedule.js", "107-117,371-392"), HF("backend/src/middleware/validate.js", "7-12,34-56"), HF("backend/src/services/schedule.service.js", "3944-3967"), WADJ("BOOK-3; L1"), PREP1("§7 D1")],
      { planValue: "400 REJECTION_REASON_REQUIRED", note: "details.field=reason. Changed 2026-10-10 (BOOK-3): the value was '400 REJECTION_REASON_REQUIRED' (schedule.service.js:3870 @886c9f1), the plan's code, which the route's validator makes unreachable" }),
    notCurrent: F("409 REVISION_NOT_CURRENT", "http",
      "A lifecycle step (submit-review here; approve, reject, the baseline lock and readiness by id answer the same) on a revision that is neither the active one nor the latest staged candidate: loadCurrentRevisionForLifecycle (schedule.service.js:965-1012; candidates are inactive draft, under_review, approved or rejected revisions, :942-958) refuses with 409 REVISION_NOT_CURRENT before any status guard (submitRevisionForReview :3778-3790). On W: F1b's revision, superseded when the rollback re-activates F1 (activateRevisionSnapshot marks the previously active revision superseded, :3454-3470), submitted for review by the planner (schedule:submit, routes/schedule.js:322-343). "
        + "This is the lifecycle code of the plan's list (:505) and the code WP1.revisions.activate.olderRevision named before BOOK-3: activation never reaches this loader (WP1.revisions.activate.olderRevision).",
      [PF(505, 540), HF("backend/src/services/schedule.service.js", "942-1012,3778-3790"), HF("backend/src/routes/schedule.js", "322-343"), WADJ("BOOK-3; L1")]),
    hrS3Reproduction: {
      file: FA({ basedOn: "F1", totalFloatHours: HR_S3_FLOAT_HOURS }, "text", `F1 with every task's total_float_hr_cnt >= 40 h (5 days): max(TF, 5) x 8 -> the 12 CPM-critical rows 5 x 8 = 40 h, A140 47 x 8 = 376 h, A300 20 x 8 = 160 h. Staged isCritical = round(file TF days) === 0 marks ${HR_S3_STAGED_CRITICAL} rows. Staged as a draft in 087-IMP (the scratch import project; a choice).`, [P(523, 990), H("backend/src/services/import.service.js", "251-253"), ADJ("S2 HR-S3 reproduction")]),
      approve: FA("approved", "state", `HR-S3 recommendation (undecided): readiness runs CPM on the snapshot, and critical means TF <= 0 for every format. Recomputed, the F1 network has ${CRITICAL1.length} rows at TF 0 (WP1.T1), so critical_path passes and PM approval succeeds (with HR-S2's decided milestone rule for M900's date_sanity).`, [P(523, 990), ADJ("S2 HR-S3 reproduction")], { today: "400 SCHEDULE_NOT_READY, exactly one blocking approval check fails: critical_path ('No critical path activities are marked.': the file's float marks none; schedule.service.js:397,849-866). date_sanity passes since f599e67 (HR-S2 decided and fixed: M900's start = finish is valid when its duration is 0)", ref: "HR-S3", note: "today corrected 2026-10-10 (verifier question 1): it read 'two blocking checks fail: critical_path and date_sanity', true at 886c9f1 before the HR-S2 fix; the WP-1 debug run 4 observed critical_path only" }),
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
      olderRevision: F("409 INVALID_REVISION_STATUS", "http",
        "POST .../schedule/revisions/:revisionId/activate on an older revision (on W: F1b's revision, superseded when the rollback re-activated F1, schedule.service.js:3454-3470), by the PM: activateRevision (schedule.service.js:3539-3564) reads the revision by id and goes straight to activateRevisionSnapshot; it never calls loadCurrentRevisionForLifecycle (:965-1012), the only source of REVISION_NOT_CURRENT. activateRevisionSnapshot (:3106) finds it not active (so not REVISION_ALREADY_ACTIVE, :3120-3128) and its status superseded outside the allowed [approved] (:3130-3137): 409 INVALID_REVISION_STATUS, details { status: 'superseded', allowed: ['approved'] }. "
          + "The plan's 'An older revision: 409' (:540) holds; the code is the adjudicated contract (BOOK-3, settling WP-1 prep §7 D2). The plan's list (:505) and the previous leaf named REVISION_NOT_CURRENT, kept as planValue: it is what the lifecycle routes answer for the same revision (WP1.revisions.notCurrent).",
        [PF(505, 540), HF("backend/src/services/schedule.service.js", "965-1012,3106-3137,3539-3564"), HF("backend/src/routes/schedule.js", "241-282"), WADJ("BOOK-3; L1"), PREP1("§7 D2")],
        { planValue: "409 REVISION_NOT_CURRENT", note: "Changed 2026-10-10 (BOOK-3): the value was '409 REVISION_NOT_CURRENT' (schedule.service.js:999 @886c9f1), which activation never answers; that code now has its own leaf, WP1.revisions.notCurrent" }),
      recordTwoHandBuilt: (() => {
        const newCount = CODES.length - W_HAND_BUILT.length;
        const src = [PF(539, 541), HF("backend/src/services/schedule.service.js", "1518-1629,3257-3303,3337-3362,3478-3492"), WADJ("BOOK-4; P-Q1")];
        const choreo = `The WP-1 proof's W choreography (adjudication P-Q1, an assumption): ${W_HAND_BUILT.length} hand-built activities, ${W_HAND_BUILT.join(" and ")} (activityCode ${W_HAND_BUILT.join(", ")}; A110 FS after A100), are active when F1 (${CODES.length} rows, WP1.T1.network) is activated with the mapping GET .../mapping suggests`;
        const pairing = "suggestActivityMappings (schedule.service.js:1518-1629): an XER row states no activityCode, its task_code is staged as its P6 id, so the file-code tier pairs each hand-built activity with the row of its code (matchType activity_code, confidence 1); the other staged rows are new and no active activity is left over";
        return {
          updated: FA(W_HAND_BUILT.length, "count", `${choreo}. ${pairing}. The mapped activities are updated in place (activateRevisionSnapshot :3263-3278): updated ${W_HAND_BUILT.length} (${W_HAND_BUILT.join(", ")}).`, src, { note: "the book's other choreography (WP1.revisions.activate.record, 14 hand-built on 087-SCH: 14/0/0) is the 087-SCH build's; this one is the proof's live record on W" }),
          new: FA(newCount, "count", `${choreo}. The unmapped staged rows are created (:3280-3287): ${CODES.length} staged - ${W_HAND_BUILT.length} mapped = ${newCount}. The mapping GET reads the same split before the activation: suggested ${W_HAND_BUILT.length}, newActivities ${newCount}, unmappedExisting 0.`, src),
          retired: FA(0, "count", `${choreo}. Every active activity is mapped, so none is retired (:3289-3303): ${W_HAND_BUILT.length} active - ${W_HAND_BUILT.length} mapped = 0.`, src),
          dependencyCount: F(NET1.links.length, "count", `The activation replaces the project's dependencies (the hand-built A100->A110 included, :3337-3339) with the revision's: F1's ${NET1.links.length} FS links (WP1.T1.network.links), dependencyCount = dependencyRows.length in the activation record (:3340-3362, :3478-3492).`, src),
        };
      })(),
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
      A140id: FA("same id as before the retirement", "state", "Rollback keeps ids (WP-9 :957).", [P(957)], { today: "a new activity: A140 comes back with a new id, activityCode null and p6ActivityId 'A140'; the retired A140 stays inactive. rollbackRevision (schedule.service.js:3609-3726) re-activates the old revision's snapshot through activateRevisionSnapshot; the retired A140 is not an active activity, so no mapping can pair it and its staged row is created new (:3280-3287, activityDataFromStaged)", ref: "WP1-RB-1", note: "today added 2026-10-10 (verifier question 2): the build observed it on every run (finding WP1-RB-1); the suspect is reproduced and classified in the WP-1 confirm-first sweep" }),
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
    siteEngineer: F("403 FORBIDDEN", "http", "POST .../revisions/:revisionId/baseline by the site engineer: requirePermission('schedule', 'baseline', { transition: 'revision.baseline' }) (routes/schedule.js:396-399; the project-level POST .../schedule/baseline, :421-424, has the same guard); schedule.baseline and revision.baseline are the PM's only (shared/permissions.json), so 403 FORBIDDEN before the BOQ gates (middleware/rbac.js:149-153). Plan :509.", [PF(505, 509), HF("backend/src/routes/schedule.js", "396-399,421-424"), HF("shared/permissions.json", "modules.schedule"), HF("backend/src/middleware/rbac.js", "149-153"), WADJ("M6 (verifier question 6: dedicated leaves)")]),
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
    calendarChange: (() => {
      const ef = CPM1.rows.M900.EF;
      const onOld = workingDate(START, ef, CAL_CHANGE.from);
      const onNew = workingDate(START, ef, CAL_CHANGE.to);
      const M = (endDate, earlyFinishDate, baselineFinishDate) => (baselineFinishDate === undefined ? { earlyFinish: ef, endDate, earlyFinishDate } : { earlyFinish: ef, endDate, earlyFinishDate, baselineFinishDate });
      return FA(
        {
          change: { ...CAL_CHANGE },
          beforeBaseline: { http: 200, projectCalendar: CAL_CHANGE.to, M900: M(onNew, onNew) },
          afterBaseline: { http: 409, code: null, projectCalendar: CAL_CHANGE.from, M900: M(onOld, onOld, onOld) },
        },
        "text",
        `HR-S6 (undecided; plan :566 'a start or calendar change does not recompute CPM, and the baseline moves with it'; recommendation :1032 'recalculate on change; refuse the change after a baseline lock (409) unless re-baselined'). The probe: the PM sends PATCH /projects/:id { projectCalendar: '${CAL_CHANGE.to}' } on W (${CAL_CHANGE.from}, start Monday ${START}, F1 active), then back to '${CAL_CHANGE.from}' (seven_day is a choice; the route accepts five_day, six_day, seven_day and custom, routes/projects.js:39,120; PATCH is the PM's or the planner's, :329-348). `
          + `Every F1 row carries the file's calendar id '${F6_CAL.default}' (build/files.js:114,160; xer-parser.js:138; kept by the snapshot, import.service.js:222-223; written by the activation on new and mapped rows alike, schedule.service.js:1631-1638,1679-1688), an id the engine does not know, so it resolves to the project calendar (cpm.service.js:80-92). CPM counts working days, so M900's early finish stays working day ${ef} on any calendar; only its date moves: working day ${ef} from ${START} is ${onOld} on ${CAL_CHANGE.from} (WP1.T1.M900earlyFinishDate) and ${onNew} on ${CAL_CHANGE.to} (${ef} calendar days: ${Math.floor(ef / 7)} weeks to ${workingDate(START, Math.floor(ef / 7) * 7, CAL_CHANGE.to)}, then ${ef % 7} more). `
          + `Expected (value): before any baseline the change recalculates, so M900's stored endDate and its derived earlyFinishDate both read ${onNew}; after a baseline lock the change is refused 409 (code null: HR-S6 names none, never guessed) and nothing moves: ${CAL_CHANGE.from}, endDate = earlyFinishDate = baselineFinishDate = ${onOld} (WP1.baseline.covered.M900). `
          + `HEAD (today): 200 either way. updateProject writes the project row only and never runs CPM (project.service.js:702-808, the write :776-799), so the stored endDate stays ${onOld}; every derived date is worked out on read from the stored working-day offsets, the project start and the now ${CAL_CHANGE.to} calendar (schedule.service.js:272-321, activity.service.js:138-187): earlyFinishDate ${onNew} and, after the lock, baselineFinishDate ${onNew} too (the baseline offsets copied at the lock, schedule.service.js:4134-4142, re-dated on the new calendar: the locked baseline moves).`,
        [PF(500, 549, 566, 1032), HF("backend/src/routes/projects.js", "39,120,329-348"), HF("backend/src/services/project.service.js", "702-808"), HF("backend/src/services/schedule.service.js", "272-321,1631-1638,1679-1688,4134-4142"), HF("backend/src/services/activity.service.js", "138-187"), HF("backend/src/services/cpm.service.js", "80-92,125-166"), WADJ("BOOK-1; M2")],
        {
          today: {
            change: { ...CAL_CHANGE },
            beforeBaseline: { http: 200, projectCalendar: CAL_CHANGE.to, M900: M(onOld, onNew) },
            afterBaseline: { http: 200, projectCalendar: CAL_CHANGE.to, M900: M(onOld, onNew, onNew) },
          },
          ref: "HR-S6",
          note: `Taken on W after the baseline lock (BL.covered.live), with the start back at ${START} (after the start-date probe), the probe judges afterBaseline; one taken before the lock judges beforeBaseline. Under today the PATCH back to '${CAL_CHANGE.from}' returns every derived date to the ${CAL_CHANGE.from} figures. CF.7 folds this leaf in with WP1.dates.startMovedTo0112.`,
        },
      );
    })(),
    endBeforeStartRefused: F("400 INVALID_DATES", "http",
      "HR-S2 (decided; fixed at f599e67): start = end is valid when the duration is 0, and a finish before the start is still refused. assertDates (activity.service.js:329-340) throws 400 INVALID_DATES when end < start, or end = start with a duration above 0. It runs on create before anything is written (createActivity :401-406) and on update on the row as it would become, the payload's dates and duration over the stored ones, before the transaction (updateActivity :502, :549-555), so a refused PATCH leaves the row (and its updatedAt) unchanged. No route validator compares the two dates (routes/activities.js:104-105, :284-285 check each date's form only), so the service answers.",
      [PF(50, 547, 1028), HF("backend/src/services/activity.service.js", "325-340,401-406,549-555"), HF("backend/src/routes/activities.js", "92-139,271-318"), WADJ("BOOK-2; P-Q5")],
      { note: "on create (POST .../activities) and on update (PATCH .../activities/:id) alike; the same code before f599e67 (whose check was end <= start)" }),
    zeroDurationCreate: F(201, "http",
      "HR-S2's other half on create: POST .../activities with duration 0 (isMilestone true) and startDate = endDate passes assertDates (end = start with duration 0 is valid, activity.service.js:329-340) and is created, 201 (routes/activities.js:139). The duration in the payload runs CPM inside the create transaction (activity.service.js:430-440, :442-487, the call :479-481), which writes the row's early dates as its start and end (toPersistedCpmUpdate, cpm.service.js:654-667), so it reads back with start = end. Before f599e67 the same request was 400 INVALID_DATES (end <= start refused).",
      [PF(50, 547, 1028), HF("backend/src/services/activity.service.js", "329-340,401-487"), HF("backend/src/routes/activities.js", "92-139"), HF("backend/src/services/cpm.service.js", "654-667"), WADJ("BOOK-2; P-Q5")]),
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
      // HR-P5 per surface (BOOK-6): the value is the plan's (:551-552), the today is worked from F1's file percent.
      ...(() => {
        const end = workingDate(START, CPM1.rows.A200.EF);
        const fileRow = `F1's A200 row carries phys_complete_pct ${A200_FILE_PCT} (inputs.F1.tasks, column 6; plan :552), staged and written to Activity.physComplete at activation (xer-parser.js:124-141; import.service.js:242; schedule.service.js:1645), and A200 has no approved progress`;
        const src = (...extra) => [PF(551, 552, 565, 1040), ...extra, WADJ("BOOK-6; L1")];
        const opts = (today) => ({ today, ref: "HR-P5" });
        return {
          searchStatus: FA(deriveStatus(0, end, `${RUN}T00:00:00.000Z`), "state",
            `Global search's activity result for A200. Expected (plan :551 'live statuses agree across ... search'; HR-P5 recommendation 'approved progress only, everywhere', undecided): the status /activities derives, approved pct 0 with the end ${end} (EF ${CPM1.rows.A200.EF}) before the run date -> delayed (WP1.status.A200fileFortyPercent.status). HEAD (today): search derives its own status from physComplete alone (search.service.js:223-228: >= 100 complete, > 0 in_progress, else todo; it has no delayed branch); ${fileRow}, so ${A200_FILE_PCT} -> ${searchStatusOf(A200_FILE_PCT)}. (Approved progress read through search's own rule would give ${searchStatusOf(0)}, which still disagrees with /activities.)`,
            src(HF("backend/src/services/search.service.js", "200-228"), HF("backend/src/utils/activity-status.js", "29-35")), opts(searchStatusOf(A200_FILE_PCT))),
          lookaheadPct: FA(0, "percent",
            `The lookahead item's pctComplete for A200. Expected (plan :552; HR-P5): approved progress only, 0. HEAD (today): pct = latest approved progress, else physComplete (lookahead.service.js:266, :273); ${fileRow}, so ${A200_FILE_PCT}.`,
            src(HF("backend/src/services/lookahead.service.js", "266-273")), opts(A200_FILE_PCT)),
          exportXerPct: FA(0, "percent",
            `The schedule export as XER (GET .../export/schedule/xer), A200's TASK phys_complete_pct. Expected (plan :552; HR-P5): 0. HEAD (today): pct = latest approved progress, else physComplete (schedule-export.service.js:140), written as phys_complete_pct (:248, :255); ${fileRow}, so ${A200_FILE_PCT}.`,
            src(HF("backend/src/services/schedule-export.service.js", "140,248-255")), opts(A200_FILE_PCT)),
          assistantText: FA(`${0}% complete`, "text",
            `The assistant's retrieval source text for A200 (retrieval.service.js retrieve, activity source). Expected (plan :551-552; HR-P5): '0% complete'. HEAD (today): the text is \`\${Number(row.physComplete || 0)}% complete\` (retrieval.service.js:43); ${fileRow}, so '${A200_FILE_PCT}% complete'.`,
            src(HF("backend/src/services/retrieval.service.js", "43")), opts(`${A200_FILE_PCT}% complete`)),
        };
      })(),
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
    stagedImportWrites: F("IMP.stagedNotApplied red", "state",
      "The guard 'staged imports do not write' (plan :504, §6.2 :1144). The mutation makes persistImport write activities as it stages: after `revisionId = revision.id;` (import.service.js:350), tx.activity.createMany of the snapshot's activities inside the staging transaction (:319-351), so every import adds active rows before any review. "
        + "Catcher: the WP-1 proof's IMP.stagedNotApplied (on X: the active activities' ids, durations, dates and updatedAt, and their count, read before and after a staging import of the T4 FF file) sees the added rows: red. The xlsx dry run (WP1.imports.xlsxDryRun) cannot catch it: the dry run answers before persistImport is called (import.service.js:587-604; persistImport at :606). Collateral, not the catch: on W the F1 staging also writes rows, so W's mapping and activation no longer meet the choreography and the W section stops at REV.activate.full (a setup error, exit 1; adjudication M1), before WP1.conversion.activeEqualsStaged is read.",
      [PF(504, 555, 1144), HF("backend/src/services/import.service.js", "300-364,563-606"), WADJ("BOOK-7; M1"), PREP1("§5, §7 D4")],
      { note: "Changed 2026-10-10 (BOOK-7): the value was 'WP1.imports.xlsxDryRun / activeEqualsStaged red'; the dry run returns before persistImport and activeEqualsStaged is not reached, so neither can catch the mutation" }),
  },
};

// Load checks for the WP-1 proof authoring leaves (2026-10-10): each new leaf agrees with the figures it is built from.
(() => {
  const fail = (what) => {
    throw new Error(`schedule answer book: ${what}`);
  };
  // BOOK-5 inputs
  const fsIn = WP1.T4.FSlead.inputs.value;
  if (fsIn.A !== WP1.T3.inputs.A_duration.value || fsIn.B !== WP1.T3.inputs.B_duration.value || fsIn.A * 8 !== F3.A || fsIn.B * 8 !== F3.B || fsIn.lag * 8 !== -64) fail("WP1.T4.FSlead.inputs must be T3's A and B (80 h, 24 h) with FS -8 (-64 h)");
  if (fsIn.A + fsIn.lag !== WP1.T4.FSlead.B_ES.value || WP1.T4.FSlead.B_ES.value + fsIn.B !== WP1.T4.FSlead.B_EF.value) fail("WP1.T4.FSlead.B_ES/B_EF must follow from WP1.T4.FSlead.inputs");
  const mix = WP1.mixedCalendar.inputs.value;
  if (workingDate(START, mix.A.duration, mix.A.calendar) !== WP1.mixedCalendar.A_finishDate.value) fail("WP1.mixedCalendar.inputs A must finish on WP1.mixedCalendar.A_finishDate");
  if (workingDate(START, MIXED.rows.B.ES, mix.B.calendar) !== WP1.mixedCalendar.B_startNoEarlierThan.today) fail("WP1.mixedCalendar.inputs B must give WP1.mixedCalendar.B_startNoEarlierThan's today");
  const range = WP1.conversion.rangeBoundary;
  if (range.atMax.value !== RANGE_IN.maxDays || hoursToDays(range.atMax.value * 8) !== RANGE_IN.maxDays || hoursToDays(range.beyondMaxInput.value - 1) !== RANGE_IN.maxDays || !(hoursToDays(range.beyondMaxInput.value) > RANGE_IN.maxDays)) fail("WP1.conversion.rangeBoundary.beyondMaxInput must be the first whole hour past the bound");
  // BOOK-6
  const tp = WP1.imports.twoProjectXerStaging;
  const chosen = Object.values(tp.value.rowsIfChosen);
  if (tp.value.rowsIfChosen[F4_FIRST] !== WP1.T1.network.activities.value || chosen.reduce((s, n) => s + n, 0) !== F4_ROWS || tp.today.mergedRows !== F4_ROWS || tp.today.activityCount !== F4_ROWS || tp.today.imported !== F4_ROWS || tp.value.mergedRows !== 0) fail("WP1.imports.twoProjectXerStaging must count F4's two projects (F1 + the second)");
  const ids = WP1.imports.secondCalendarIds.value;
  if (Object.keys(ids).length !== CODES.length || CODES.filter((c) => ids[c] === F6_CAL.second).join() !== F6_CAL.secondOn.join() || CODES.some((c) => ![F6_CAL.default, F6_CAL.second].includes(ids[c]))) fail("WP1.imports.secondCalendarIds must name '2' on A300 and A330 and '1' elsewhere");
  const a200 = WP1.status.A200fileFortyPercent;
  if (a200.searchStatus.value !== a200.status.value || a200.lookaheadPct.value !== a200.pct.value || a200.exportXerPct.value !== a200.pct.value || a200.assistantText.value !== `${a200.pct.value}% complete`) fail("the HR-P5 surface leaves must expect WP1.status.A200fileFortyPercent.pct / .status");
  if (a200.lookaheadPct.today !== A200_FILE_PCT || a200.exportXerPct.today !== A200_FILE_PCT || a200.searchStatus.today !== "in_progress" || a200.assistantText.today !== `${A200_FILE_PCT}% complete` || A200_FILE_PCT !== WP1.T1.stagedSnapshot.A200physComplete.value) fail("the HR-P5 surface leaves' today must be F1's A200 file percent");
  // BOOK-4
  const two = WP1.revisions.activate.recordTwoHandBuilt;
  if (two.updated.value !== W_HAND_BUILT.length || two.updated.value + two.new.value !== WP1.T1.network.activities.value || two.retired.value !== 0 || two.dependencyCount.value !== WP1.T1.network.links.value || two.dependencyCount.value !== WP1.revisions.activate.record.dependencyCount.value) fail("WP1.revisions.activate.recordTwoHandBuilt must split F1's 14 rows over the 2 hand-built activities, with F1's 13 links");
  // BOOK-3
  const rw = WP1.revisions.rejectWithoutReason;
  const older = WP1.revisions.activate.olderRevision;
  if (rw.value !== "400 VALIDATION_ERROR" || rw.planValue !== "400 REJECTION_REASON_REQUIRED" || !rw.planDisagrees || !/details\.field=reason/.test(rw.note || "")) fail("WP1.revisions.rejectWithoutReason must carry the adjudicated contract, the field, and the plan's code as planValue");
  if (older.value !== "409 INVALID_REVISION_STATUS" || older.planValue !== WP1.revisions.notCurrent.value || !older.planDisagrees || WP1.revisions.notCurrent.value !== "409 REVISION_NOT_CURRENT") fail("WP1.revisions.activate.olderRevision must carry the adjudicated contract, the plan's code (WP1.revisions.notCurrent) as planValue");
  // BOOK-1
  const cc = WP1.dates.calendarChange;
  const efOld = workingDate(START, WP1.T1.M900.EF.value, CAL_CHANGE.from);
  const efNew = workingDate(START, WP1.T1.M900.EF.value, CAL_CHANGE.to);
  if (efOld !== WP1.T1.M900earlyFinishDate.value || efOld !== workingDate(START, WP1.baseline.covered.M900.value[1]) || efNew === efOld) fail("WP1.dates.calendarChange: M900's dates on the two calendars");
  if (cc.value.afterBaseline.http !== WP1.dates.startMovedTo0112.afterBaseline.http.value || cc.today.afterBaseline.http !== WP1.dates.startMovedTo0112.afterBaseline.http.today || cc.value.afterBaseline.code !== null) fail("WP1.dates.calendarChange.afterBaseline must answer as the start-date change does (HR-S6: 409, code null; today 200)");
  if (cc.value.afterBaseline.M900.baselineFinishDate !== efOld || cc.today.afterBaseline.M900.baselineFinishDate !== efNew || cc.today.afterBaseline.M900.endDate !== efOld || cc.today.beforeBaseline.M900.endDate !== efOld || cc.value.beforeBaseline.M900.endDate !== efNew || cc.value.beforeBaseline.M900.earlyFinishDate !== efNew || cc.today.beforeBaseline.M900.earlyFinishDate !== efNew) fail("WP1.dates.calendarChange: the value and today figures");
  // BOOK-2
  if (WP1.dates.endBeforeStartRefused.value !== WP1.dates.renameM900.today || WP1.dates.zeroDurationCreate.value !== 201) fail("WP1.dates.endBeforeStartRefused / zeroDurationCreate");
  // BOOK-7
  if (WP1.mutations.stagedImportWrites.value !== "IMP.stagedNotApplied red") fail("WP1.mutations.stagedImportWrites must name IMP.stagedNotApplied");
  // every leaf added with a today names the row it waits on
  for (const [key, leaf] of [["dates.calendarChange", cc], ["imports.twoProjectXerStaging", tp], ...["searchStatus", "lookaheadPct", "exportXerPct", "assistantText"].map((k) => [`status.A200fileFortyPercent.${k}`, a200[k]])]) {
    if (leaf.today === undefined || !leaf.ref || !leaf.assumption) fail(`WP1.${key} carries a today without its ref, or is not marked an assumption`);
  }
})();

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
/**
 * WP-2 answer-book leaves (2026-10-10; WP2ADJ Q4, Q5, Q7): the inputs and the
 * small models the added leaves are worked from, restated here.
 *
 * 087-FLD's form ITP as the build makes it (build/087-fld.js:1100-1131,
 * :1186-1233, :1267-1290 @fc29478): template version 1 holds two hold items
 * (hold1, hold2; 'check' and 'witness' are not hold points); the template edit
 * adds hold3 (version 2, the same template id). The answers per instance are
 * the builder's.
 */
const FLD_ITP = {
  activities: ["A100", "A110", "A120", "A140", "A150", "A170"],
  holdItems: { v1: ["hold1", "hold2"], v2: ["hold1", "hold2", "hold3"] },
  instances: [
    { activity: "A110", status: "scheduled", answers: {} },
    { activity: "A110", status: "in_progress", answers: { check: "pass", witness: "yes" } },
    { activity: "A120", status: "complete", answers: { hold1: "fail", hold2: "pass", check: "pass", witness: "yes" } },
    { activity: "A140", status: "void", answers: { check: "pass" } },
    { activity: "A150", status: "closed", answers: { hold1: "pass", hold2: "pass", check: "pass", witness: "yes" } },
    { activity: "A170", status: "complete", answers: { hold1: "pass", hold2: "pass", check: "pass", witness: "yes" } },
  ],
};
/**
 * The open hold points per activity as GET /forms/hold-points reads them
 * (form.service.js openHoldPoints :1416-1431, holdPointsFor :808-825,
 * PASSING_VALUES / DEFICIENT_VALUES :34-35 @f599e67), in the builder's holdsOn
 * shape { open, states (sorted) }: every non-void ITP instance of the
 * activity, each hold item of the template it is read against; an item
 * answered pass / na / yes / checked has passed and is not open, fail / no is
 * failed, anything else (no answer) pending.
 */
const fldHoldsOn = (holdItems) =>
  Object.fromEntries(FLD_ITP.activities.map((code) => {
    const states = [];
    for (const instance of FLD_ITP.instances.filter((i) => i.activity === code && i.status !== "void")) {
      for (const item of holdItems) {
        const answer = instance.answers[item];
        if (["pass", "na", "yes", "checked"].includes(answer)) continue;
        states.push(["fail", "no"].includes(answer) ? "failed" : "pending");
      }
    }
    return [code, { open: states.length, states: states.sort() }];
  }));
/** Read against version 1 (before the edit, and HR-Q2's recommendation after it) / against the current template, version 2 (HEAD after the edit). */
const FLD_HOLDS_V1 = fldHoldsOn(FLD_ITP.holdItems.v1);
const FLD_HOLDS_V2 = fldHoldsOn(FLD_ITP.holdItems.v2);
/** METHOD.stands on P (WP2ADJ Q5): an activity with no method row (METHODS_087SCH names none), no allocation on P and the site engineer assigned. */
const METHOD_STANDS = { activity: "A220", submittedPct: 10, configuredMethod: "quantity", quantityUnit: "m2" };
/** The HR-P2 probe on P (WP2ADJ Q7, G23): A300 approved at percent 20, then a typed quantity 30 of 100 (30% > 20%). */
const METHOD_BYPASS = { activity: "A300", approvedPercent: 20, quantityComplete: 30, quantityPlanned: 100 };
const METHOD_BYPASS_PCT = (METHOD_BYPASS.quantityComplete / METHOD_BYPASS.quantityPlanned) * 100;
/** Project EV on P after the PM's progress import, in the order of WP2-PREP section 5.1 (WP2ADJ Q1). */
const EV_AFTER_IMPORT = EV_AFTER_QTY + IMPORT_DELTA;

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
    rejectWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST .../activities/:id/progress-submissions/:submissionId/reject with no reason (on P: T3's A120 draft, by the QS): the route chain body('reason').isString().trim().notEmpty() (routes/activities.js:492) fails and validate (:493; middleware/validate.js:14-25) answers before the service: 400 VALIDATION_ERROR, message 'Validation failed', error.details holding an entry whose field is 'reason' (message 'Invalid value'; details are sent outside production, middleware/error-handler.js:304-307). The service's REJECTION_REASON_REQUIRED (progress.service.js:2288-2295, after APPROVED_PROGRESS_LOCKED :2280-2286) is not reached through the route. "
        + "Corrected as WP1.revisions.rejectWithoutReason was (BOOK-3, the WP-0 F1 precedent): HEAD's VALIDATION_ERROR naming the field is the contract, and the book's earlier code, the service's, is kept as planValue (WP2-PREP G1). Sent with a reason, the same request is answered by the service.",
      [PF(572, 577), HF("backend/src/routes/activities.js", "484-506"), HF("backend/src/middleware/validate.js", "7-25"), HF("backend/src/middleware/error-handler.js", "304-307"), HF("backend/src/services/progress.service.js", "2257-2295"), WP2ADJ("Q7 (G1)"), PREP2("section 0 fact 3; section 9 G1")],
      { planValue: "400 REJECTION_REASON_REQUIRED", note: "details.field=reason. Changed 2026-10-10 (WP-2 G1): the value was '400 REJECTION_REASON_REQUIRED' (progress.service.js:2290 @886c9f1), which the route's validator makes unreachable" }),
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
    siteOnA330ActivityIds: F(["A330"], "list", "The refusal names the activity the site engineer is not assigned to: assertProgressSubmitAllowed answers 403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED with details { activityIds: the requested ids that carry no assignment of the user } (progress.service.js:917-959, the refusal :951-958), here A330's id alone (METHODS_087SCH.siteEngineerAssigned leaves A330 out; the check maps the code to the id).", [PF(576, 588), HF("backend/src/services/progress.service.js", "917-959"), WP2ADJ("Q7 (G22)"), PREP2("section 9 G22")]),
    siteOnA330SubmissionsDelta: F(0, "count", "Nothing is written: createProgressSubmission asks the assignment rule (progress.service.js:1871-1877) before the submission row is created (:1889), inside one transaction, so A330's submission count read before and after the refusal is the same.", [PF(588), HF("backend/src/services/progress.service.js", "1847-1890"), WP2ADJ("Q7 (G22)"), PREP2("section 9 G22")]),
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
      evidence: F({ photos: [{ key: "<upload.key>", documentId: "<upload.documentId>", fileName: "<upload.fileName>" }] }, "text",
        "The T3 evidence is the photo the site engineer uploaded on P (POST .../site-reporting/uploads), named in the shape the clients send: the upload's answer (file-storage.service.js serializeUploadedDocument :696-717: documentId, key = the document id, fileName) put into evidence.photos[]. The writer accepts the photo fields key, documentId and fileName (progress.service.js EVIDENCE_PHOTO_FIELDS :168-175) and matches key and documentId against this project's documents before anything is written (prepareEvidence :585-650; another project's document or none: 400 INVALID_SITE_PHOTO_REFERENCE); hasEvidence counts the one photo (:112-117). "
          + "HR-X1 (decided, plan :51): evidence is at least one stored project document; the owner's batch decision (WP2ADJ Q3) keeps the current references accepted during the transition, so this canonical shape is valid before and after the HR-X1 fix. Text-only evidence is WP2.confirmFirst.textOnlyEvidence.",
        [PF(51, 589, 1051), HF("backend/src/services/file-storage.service.js", "696-717"), HF("backend/src/services/progress.service.js", "100-117,168-175,585-650"), WP2ADJ("Q3, Q7 (G17)"), PREP2("section 5.1 site photo; section 9 G17")]),
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
    siteVoid: F("403 FORBIDDEN", "http",
      "The site engineer may not void: POST .../forms/:instanceId/void is guarded by requirePermission('inspection', 'approve', { transition: 'inspection.void' }) (routes/forms.js:183-188); shared/permissions.json gives inspection.approve to pm, planning_eng and quality_engineer and the transition inspection.void to pm and quality_engineer, so the site engineer is refused before the service: 403 FORBIDDEN (middleware/rbac.js:138-165). The WP-0 permission probe observed it (WP2.form.void: site_engineer 403 FORBIDDEN).",
      [PF(593), HF("backend/src/routes/forms.js", "183-188"), HF("shared/permissions.json", "modules.inspection"), HF("backend/src/middleware/rbac.js", "138-165"), "C:/Temp/octapm-cert/results/cert3/permission-probe.json WP2.form.void (WP-0, 2026-10-09)", WP2ADJ("Q7 (G11)"), PREP2("section 9 G11")],
      { note: "Changed 2026-10-10 (WP-2 G11): the value was 403, a bare status ('code not fixed by the plan'); the route's guard fixes FORBIDDEN" }),
    probes: {
      inProgressPass: F("409 ITP_HOLD_POINT_OPEN", "http", "HR-Q1 (decided): 'pass' on an instance still in progress does not release the hold.", [P(27, 555, 1007)], { today: 200 }),
      naAnswer: F("409 ITP_HOLD_POINT_OPEN", "http", "HR-Q1 (decided): 'na' on a hold item needs the approver; an 'na' alone does not release it.", [P(27, 555, 1007)], { today: 200 }),
      retroactiveTemplateEdit: FA(FLD_HOLDS_V1, "state",
        "087-FLD's open hold points per activity after the build's template edit (a third hold item added, version 2, the same template id), read live at WP-2 with GET /forms/hold-points?activityId=<code>, in the builder's holdsOn shape { open, states (sorted) } (FLD_ITP, fldHoldsOn). HR-Q2 (undecided) recommends gating on the instance's own template version: every instance was made on version 1 (two hold items), so the figures stay those before the edit (retroactiveBeforeEdit): A110 " + FLD_HOLDS_V1.A110.open + " pending (two unanswered instances x 2), A120 " + FLD_HOLDS_V1.A120.open + " failed (hold 1 'fail', hold 2 'pass'), and 0 on A100 (no instance), A140 (void), A150 (closed, both passed) and A170 (complete, both passed). "
          + "Today the gate reads the current template's hold items by templateId (form.service.js:1416-1431), so the added item is open, unanswered, on every non-void instance: A110 " + FLD_HOLDS_V2.A110.open + " pending, A120 " + FLD_HOLDS_V2.A120.open + " (failed + pending), A150 " + FLD_HOLDS_V2.A150.open + " pending, A170 " + FLD_HOLDS_V2.A170.open + " pending, A100 and A140 0.",
        [P(556, 1008), PF(595, 617, 1047), HF("backend/src/services/form.service.js", "34-35,808-825,1416-1431"), BLD("087-fld.js", "1100-1131,1186-1233,1250-1290"), WP2ADJ("Q7 (G9), Q11"), PREP2("section 4 confirm-first; section 9 G9")],
        { today: FLD_HOLDS_V2, ref: "HR-Q2", note: "Changed 2026-10-10 (WP-2 G9): the value was 'gate reads the instance's own template version' and today 'gates read the current template'; both are now the per-activity figures they mean. The 2026-10-10 build run stored exactly today's figures (state/cert3/087-FLD.json, itp.template-edit out afterEdit): corroboration, not evidence" }),
      retroactiveBeforeEdit: F(FLD_HOLDS_V1, "state",
        "087-FLD's open hold points per activity before the template edit, as the build stores them (step itp.holds.before-edit, asserted at its moment: build/087-fld.js:1250-1259): A100 0; A110 " + FLD_HOLDS_V1.A110.open + " pending; A120 " + FLD_HOLDS_V1.A120.open + " failed; A140, A150 and A170 0. Worked from the build's instances (FLD_ITP) through form.service's rule as restated in fldHoldsOn.",
        [PF(595), HF("backend/src/services/form.service.js", "34-35,808-825,1416-1431"), BLD("087-fld.js", "1186-1259"), WP2ADJ("Q7 (G9)"), PREP2("section 1.2 T4; section 9 G9")]),
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
    holdInstance: FA("an instance of the T-HOLD form ITP template (type itp, one pass_fail hold item) on A320, created scheduled by the quality engineer before the report: GET /forms/hold-points?activityId=A320 shows 1 open, pending", "text",
      "Promoted from the progressLine note (WP2ADJ Q7, G8): daily-report approval runs the one writer on the report's own activity (daily-report.service.js:994-1005 -> progress.service.js:2084-2098), so the 409 needs an open hold point on A320 itself; A130's instance does not block an A320 line. openHoldPoints counts every non-void ITP instance of the activity, a scheduled one too (form.service.js:1416-1431; HR-Q1 keeps 'any open ITP blocks' for Phase 1). The template is P's T-HOLD (087-SCH's shape, build/087-sch.js:801-838).",
      [PF(596, 1046), HF("backend/src/services/daily-report.service.js", "955-1054"), HF("backend/src/services/form.service.js", "808-825,851-860,1416-1431"), BLD("087-sch.js", "801-838"), WP2ADJ("Q7 (G8)"), PREP2("section 5.1; section 9 G8")]),
    release: F("the A320 instance started, its hold item answered 'pass' and the instance completed (status complete, the hold item passed): GET /forms/hold-points?activityId=A320 shows 0 open", "text",
      "The release before the approval (plan :596 'After the hold is released: approved'), in the form HR-Q1 (decided) keeps releasing: a completed instance with the hold item passed (plan :47, :1046), so the step holds before and after the HR-Q1 fix. start (form.service.js:1120-1131), respond (:1067-1118), complete (:1156-1247; T-HOLD asks no signature); holdPointsFor then reads the item passed (:808-825).",
      [PF(47, 596, 1046), HF("backend/src/services/form.service.js", "808-825,1067-1131,1156-1247"), WP2ADJ("Q7 (G8)"), PREP2("section 9 G8")]),
    approver: F("pm", "text",
      "Daily-report approval is the PM's alone: the route is guarded by requirePermission('progress', 'approve', { transition: 'daily_report.approve' }) (routes/daily-reports.js:252-268); shared/permissions.json gives progress.approve to pm, planning_eng and qs but the transition daily_report.approve to pm only. The WP-0 permission probe observed it (WP2.dailyReport.approve: pm allowed, every other persona 403 FORBIDDEN).",
      [PF(596), HF("backend/src/routes/daily-reports.js", "252-268"), HF("shared/permissions.json", "modules.progress.transitions"), "C:/Temp/octapm-cert/results/cert3/permission-probe.json WP2.dailyReport.approve (WP-0, 2026-10-09)", WP2ADJ("Q7 (G7)"), PREP2("section 0 fact 7; section 9 G7")]),
    plannerApprove: F("403 FORBIDDEN", "http", "The planning engineer holds progress.approve but not daily_report.approve: requirePermission refuses before the service, 403 FORBIDDEN, details { module: 'progress', action: 'approve', transition: 'daily_report.approve', source: 'role' } (middleware/rbac.js:138-165).", [PF(596), HF("backend/src/routes/daily-reports.js", "252-256"), HF("backend/src/middleware/rbac.js", "138-165"), WP2ADJ("Q7 (G7)"), PREP2("section 9 G7")]),
    qsApprove: F("403 FORBIDDEN", "http", "The QS holds progress.approve but not daily_report.approve: 403 FORBIDDEN, as the planning engineer (middleware/rbac.js:138-165).", [PF(596), HF("backend/src/routes/daily-reports.js", "252-256"), HF("backend/src/middleware/rbac.js", "138-165"), WP2ADJ("Q7 (G7)"), PREP2("section 9 G7")]),
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
    methodBypass: FA(409, "http", "HR-P2 (undecided) recommends locking the effective method once progress is approved. Probe: " + METHOD_BYPASS.activity + " approved percent " + METHOD_BYPASS.approvedPercent + ", then a quantity submission " + METHOD_BYPASS.quantityComplete + " of " + METHOD_BYPASS.quantityPlanned + " (WP2.T6.methodBypassInputs; " + METHOD_BYPASS_PCT + "% is above the approved " + METHOD_BYPASS.approvedPercent + "%, so HR-P1's lower-figure rule, once fixed, cannot answer first and mask HR-P2). Code null: the rule is undecided, so no code is asserted (PROGRESS_METHOD_LOCKED, the configured-method code, is not assumed).", [P(559, 998), AREA, ADJ("open questions: codes for undecided refusals"), PF(598, 619, 1037), WP2ADJ("Q7 (G23), Q11"), PREP2("section 0 fact 9; section 9 G23")], { today: "200; approval makes " + METHOD_BYPASS_PCT + "% official under quantity (A300's official figure moves " + METHOD_BYPASS.approvedPercent + " -> " + METHOD_BYPASS_PCT + " and its method from percent to quantity)", ref: "HR-P2", note: "Changed 2026-10-10 (WP-2 G23): the probe typed 10 of 100 and today read '200; approval makes 10% official under quantity'; 10% is below A300's approved 20%, which HR-P1's fix (a lower figure needs a reason) would refuse first, masking HR-P2" }),
    methodBypassInputs: FA(METHOD_BYPASS, "text", "The HR-P2 probe's inputs on P (WP2ADJ Q7, G23): " + METHOD_BYPASS.activity + " is unconfigured (METHODS_087SCH.A300 null) and unallocated, the site engineer assigned. First percent " + METHOD_BYPASS.approvedPercent + " submitted and approved; then { progressMethod: 'quantity', quantityComplete: " + METHOD_BYPASS.quantityComplete + ", quantityPlanned: " + METHOD_BYPASS.quantityPlanned + " } submitted and approved. With no method row the client's method is taken (progress.service.js:1516-1518) and the approval asks nothing of it (:1545-1546); with no allocation the planned figure is the client's (deriveQuantityFigures :1422-1450, basis 'client'): " + METHOD_BYPASS.quantityComplete + " / " + METHOD_BYPASS.quantityPlanned + " x 100 = " + METHOD_BYPASS_PCT + "%.", [PF(598, 619, 1037), HF("backend/src/services/progress.service.js", "1422-1450,1516-1518,1545-1546"), WP2ADJ("Q7 (G23)"), PREP2("section 0 fact 9; section 9 G23")]),
  },
  T7: {
    retiredActivityApproval: FA(409, "http", "HR-S9 (undecided) recommends refusing approval on an activity retired by activation.", [P(559, 996)], { today: "200; an ActivityProgress row on an inactive activity" }),
  },
  methodStands: {
    choreography: FA("On P (WP2ADJ Q5): " + METHOD_STANDS.activity + " unconfigured; the site engineer (assigned) submits percent " + METHOD_STANDS.submittedPct + " (submitted, pending); the planner PUTs " + METHOD_STANDS.activity + "'s progress method { method: '" + METHOD_STANDS.configuredMethod + "', quantityUnit: '" + METHOD_STANDS.quantityUnit + "' } (200: no approved progress yet); the QS approves the pending percent submission", "text",
      "The approval-time half of the method rule (plan :578 gates; section 6.2 'the method-stands check', :1145), reached only by a submission made before its activity was configured another way: A220 has no ActivityProgressMethod row on P (METHODS_087SCH names none), no allocation (S-006 stays unallocated on P) and no ITP instance, so nothing else answers first. The submit-time rule (WP2.quantitiesA310.percentMethod, resolveSubmissionMethod) takes the client's percent while no row exists (progress.service.js:1516-1518); the PUT is allowed because assertMethodChangeAllowed reads approved progress only (:1023-1036) and upsertProgressMethod asks nothing else (:1038-1085; routes/activities.js:353-383, method.configure is the PM's and the planner's).",
      [PF(578, 598, 1145), HF("backend/src/services/progress.service.js", "1023-1085,1505-1529"), HF("backend/src/routes/activities.js", "353-383"), WP2ADJ("Q5"), PREP2("section 0 fact 4; section 9 G3")]),
    approve: F("409 PROGRESS_METHOD_MISMATCH", "http",
      "approveProgressSubmissionWithClient reads the method row again where the figure would become official (progress.service.js:2063-2064) and assertSubmissionMethodStands (:2065 -> :1545-1561) refuses a submission whose method (percent) is not the configured one (quantity): 409 PROGRESS_METHOD_MISMATCH, before the evidence, hold-point and quantity steps (:2076-2147) and before the one writer (:2171). The same code as the submit-time rule (WP2.quantitiesA310.percentMethod).",
      [PF(578, 1145), HF("backend/src/services/progress.service.js", "1531-1561,2020-2065,2171"), WP2ADJ("Q5"), PREP2("section 9 G3")]),
    detailsSubmissionId: F(true, "bool",
      "The refusal's details name the submission and both methods: { activityId: A220's id, effectiveMethod: 'quantity', effectiveMethodBasis: 'method_config', requestedMethod: 'percent', submissionId: the pending A220 submission's id } (progress.service.js:1555-1560); the check compares details.submissionId with that id.",
      [PF(578), HF("backend/src/services/progress.service.js", "1545-1561"), WP2ADJ("Q5"), PREP2("section 9 G3")]),
    official: F(0, "percent", "Nothing official is written: the refusal rolls the approval's transaction back (approveProgressSubmission, progress.service.js:2254-2255), A220 keeps no ActivityProgress row and its submission stays submitted; GET /activities/A220 reads pctComplete 0.", [PF(575, 578), HF("backend/src/services/progress.service.js", "2020-2065,2254-2255"), WP2ADJ("Q5"), PREP2("section 9 G3")]),
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
      negative: F("400 VALIDATION_ERROR", "http",
        "POST .../quantity-progress with quantity -5 (on P: the site engineer, A310, S-003, one entry as the request body): the route's entry validator refuses it before the service, custom check 'must be zero or more' (routes/quantity-progress.js:48-53, :51; the POST chain :105-116, validate :115): 400 VALIDATION_ERROR, message 'Validation failed', error.details holding an entry whose field is 'quantity' (message 'must be zero or more'; under entries[] the field is 'entries[0].quantity', express-validator's wildcard path). Nothing is written. The service's QUANTITY_NEGATIVE (quantity-progress.service.js:489-491) is not reached over HTTP; it is the in-process probe's answer (entryRefusals.negativeService). "
          + "Integration owner's decision Q4 (a): the API-reachable guard is the route validator, as WP-0 F1 and WP-1 BOOK-3 settled; no product contract changes without a rule. The plan's code list (:580) and the book's earlier value are kept as planValue.",
        [PF(580, 603), HF("backend/src/routes/quantity-progress.js", "43-64,105-133"), HF("backend/src/middleware/validate.js", "7-25"), HF("backend/src/services/quantity-progress.service.js", "489-491"), WP2ADJ("Q4 (a), Q7 (G2)"), PREP2("section 0 fact 2; section 7 N1-N3; section 9 G2")],
        { planValue: "400 QUANTITY_NEGATIVE", note: "details.field=quantity (entries[0].quantity under entries[]). Changed 2026-10-10 (WP-2 G2, Q4): the value was '400 QUANTITY_NEGATIVE' (quantity-progress.service.js:490 @886c9f1), which the route's validator makes unreachable over HTTP" }),
      negativeService: F("400 QUANTITY_NEGATIVE", "http",
        "In process (WP2ADJ Q4 (b) and Q8, the check QTY.entry.negative.service): quantityProgressService.createEntries({ orgId, projectId: P, userId: the site engineer, userRole: 'site_engineer', entries: [{ activityId: A310, boqItemId: S-003, quantity: -5, date }] }) (quantity-progress.service.js:588-600 -> createEntriesWithClient :430-574): after the replay lookup, the assignment rule (A310 is assigned), ensureActivity and ensureBoqItem, quantityDecimal(-5) (:72-87) is negative and the service throws HttpError 400 QUANTITY_NEGATIVE, details { field: 'entries[0].quantity' } (:489-491), before any write; the transaction rolls back and nothing is written. "
          + "It is the only catcher of the service guard removed alone (mutation N2): over HTTP the route validator answers first. Behind both application layers the database keeps a third, CHECK QuantityProgressEntry_quantity_nonnegative (prisma/migrations/20261005050000_quantity_progress/migration.sql:205), which refuses the insert itself.",
        [PF(580, 603, 1145), HF("backend/src/services/quantity-progress.service.js", "72-87,430-500,588-600"), HF("backend/prisma/migrations/20261005050000_quantity_progress/migration.sql", "205"), WP2ADJ("Q4 (b), Q8"), PREP2("section 7 N2; section 9 G2")]),
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
      evReportPct: F(Number(((570 / A310_PLANNED) * 100).toFixed(2)), "percent",
        "The EV report's activity row rounds the percent to 2 dp (earned-value.service.js:827, pct: Number(pct.toFixed(2)); the breakdown copies it, :1023) while EV is worked from the unrounded figure (:790-792): 63.333... -> " + Number(((570 / A310_PLANNED) * 100).toFixed(2)) + ". WP2.quantitiesA310.dailyLog.pct (63.333..., to 3 dp) is read on GET /activities/<A310> pctComplete, as the builder does (build/087-sch.js:1014-1015); a stored EV-report percent (087-SCH qty.dailylog570 out evA310.pct) is compared with this leaf.",
        [PF(604), HF("backend/src/services/earned-value.service.js", "785-792,827,1023"), BLD("087-sch.js", "1010-1019"), WP2ADJ("Q7 (G16)"), PREP2("section 9 G16")]),
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
      reason: F("Installed, certified, paid, received, issued and committed quantities are worked from the BOQ's rows, available only to members who may read the BOQ", "text",
        "The reason is the sentence held by the constant QUANTITY_FIGURES_WITHHELD (utils/boq-figures.js:1834-1835, exported :2333), not its identifier: withheldActivityQuantities answers { ..., figures: each { value: null, withheld: true, notAvailable: { reason } }, comparisons and items { withheld: true, reason }, withheld: true, reason } (:1859-1884). The proof compares by importing the constant; the text is restated here for the reader.",
        [PF(583, 606), HF("backend/src/utils/boq-figures.js", "1825-1884,2333"), WP2ADJ("Q7 (G4)"), PREP2("section 0 fact 6; section 9 G4")],
        { note: "Changed 2026-10-10 (WP-2 G4): the value was 'QUANTITY_FIGURES_WITHHELD', the constant's identifier (the plan's word, :606, which names the constant); the answer carries the constant's text" }),
      route: F("GET /projects/:projectId/activities/<A310>/quantities", "text",
        "Where the plan's 'gets QUANTITY_FIGURES_WITHHELD' (:606) is answered: the activity view is admitted on schedule:read (routes/activities.js:253-269) and withholds every BOQ-derived figure from a member without boq:read (withheldActivityQuantities, boq-figures.js:1859-1884; boqFigureAccess :169-172), so it answers 200 with withheld: true (withoutBoqRead.http). The BOQ item's own view is admitted on boq:read and refuses the same member (itemRoute).",
        [PF(583, 606), HF("backend/src/routes/activities.js", "253-269"), HF("backend/src/utils/boq-figures.js", "169-172,1859-1884"), WP2ADJ("Q7 (G4)"), PREP2("section 0 fact 6; section 9 G4")]),
      member: F("087-EXTRAS T-NOBOQ member on 087-SCH (people.noBoq: the staff site engineer tariq.okafor.2, on the team with the T-NOBOQ template)", "text",
        "The member denied boq:read: 087-EXTRAS makes the internal template T-NOBOQ (site_engineer base, the boq tool at 'none'), puts the staff site engineer on 087-SCH's team with it and asserts that GET /boq answers 403 there (build/087-extras.js:79, :139-159, :184-195). The template decides before the role (middleware/rbac.js:50-68).",
        [PF(606), BLD("087-extras.js", "79,139-159,184-195"), HF("backend/src/middleware/rbac.js", "50-68"), WP2ADJ("Q7 (G4)"), PREP2("section 5.2; section 9 G4")]),
      itemRoute: F("403 FORBIDDEN", "http",
        "The same member on GET /projects/:projectId/boq/items/<S-003>/quantities: the route is guarded by requirePermission('boq', 'read') (routes/boq.js:318-339); the T-NOBOQ template refuses boq:read, so the guard answers 403 FORBIDDEN, details { module: 'boq', action: 'read', transition: null, source: 'template' } (middleware/rbac.js:138-165), before the view.",
        [PF(583, 606), HF("backend/src/routes/boq.js", "318-339"), HF("backend/src/middleware/rbac.js", "50-68,138-165"), WP2ADJ("Q7 (G4)"), PREP2("section 0 fact 6; section 9 G4")]),
    },
  },
  bulk: {
    mixedBatch: {
      refusal: FA("409 PROGRESS_METHOD_MISMATCH", "http", "Batch [A330 {pct 10} by the planner, A310 {method percent}]: the second update is refused (batch chosen from the area map).", [P(569), AREA, H("backend/src/services/activity.service.js", "738-822")]),
      index: F(1, "count", "details.batch.index 1.", [P(569)]),
      written: F(0, "count", "details.batch.written 0; A330's submission count unchanged.", [P(569)], { note: "details.batch.written is the constant 0 in every bulk refusal (activity.service.js:783, :819 @f599e67), whatever was written: a split transaction shows only in A330's submission count (WP2.bulk.mixedBatch.a330SubmissionsDelta, the catcher of WP2.mutations.splitBulkTransaction). Note added 2026-10-10 (WP-2 G5); value, derivation and source unchanged" }),
      a330SubmissionsDelta: F(0, "count",
        "A330's progress submissions read before and after the refused batch (GET .../activities/<A330>/progress-submissions): the same count. bulkUpdateProgress writes the batch in one transaction (activity.service.js:797-826, BULK_PROGRESS_TRANSACTION :746); the writer refuses update 1 (A310 percent, 409 PROGRESS_METHOD_MISMATCH: resolveSubmissionMethod, progress.service.js:1516-1529, from buildSubmissionData :1576) and the throw rolls update 0 (A330) back. The refusal body cannot show a split (details.batch.written is the constant 0, :819), so this count is the catcher of the split-transaction mutation (BULK.mixed.count).",
        [PF(572, 608, 1145), HF("backend/src/services/activity.service.js", "746,758-829"), HF("backend/src/services/progress.service.js", "1516-1529,1563-1576"), WP2ADJ("Q7 (G5)"), PREP2("section 0 fact 5; section 7 P8; section 9 G5")]),
      choreography: FA("On P, before T6 (after Q320): the planner sends [A330 { pctComplete: 10 }, A310 { method: 'percent', pctComplete: 10 }]; A330's official progress is then 0 (T2's planner submission at 30 is still pending)", "text",
        "The order binds once HR-P1 is fixed (WP2ADJ Q7, G6): update 0 must not be a figure lower than A330's official progress, or HR-P1's rule could refuse it at index 0 and hide the method refusal at index 1. Before T6, A330 has no approved progress (official 0), so 10 is not lower. The planner may submit on A330 without an assignment (override, progress.service.js:17, :925).",
        [PF(48, 608, 1036), HF("backend/src/services/progress.service.js", "17,917-959"), WP2ADJ("Q7 (G6)"), PREP2("section 0 fact 9; section 5.1 order; section 9 G6")]),
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
      reuploadRows: F({ A110: "already_pending", A130: "already_pending", A310: "refused" }, "state",
        "The site engineer's second upload of the same file, per row (import.service.js importProgress :715): A110 70 and A130 50 each find the submission of the first upload waiting at the same figure (:768-770) and the site engineer cannot approve, so each row is already_pending with no second submission (:847-862); A310's percent row is refused by the writer's method rule first (:786-796, :828-833: PROGRESS_METHOD_MISMATCH). Nothing is written.",
        [PF(609), HF("backend/src/services/import.service.js", "715-883,1033-1101"), WP2ADJ("Q1, Q7 (G10)"), PREP2("section 9 G10")]),
    },
    pm: {
      A110official: FA(PROGRESS_FILE.A110, "percent", "Approved through the writer.", [P(571)]),
      evA110: FA(evOf(ALLOC.A110, PROGRESS_FILE.A110), "cents", `60,000.00 x 70% = ${fmt(evOf(ALLOC.A110, PROGRESS_FILE.A110))}.`, [P(571)]),
      evDelta: FA(IMPORT_DELTA, "cents", `A110 official 40 -> 70: +${fmt(IMPORT_DELTA)}.`, [P(571), AREA]),
      A130row: FA("pending (ITP_HOLD_POINT_OPEN)", "state", "An open hold point keeps A130's row pending (a second, scheduled ITP instance on A130).", [P(571)]),
      A110approvesPending: F(true, "bool",
        "The PM's upload finds the site engineer's A110 submission at 70 still waiting and, holding submission.approve (canApprove, routes/import.js:292-294), approves that one rather than making a second (row.approvesPending, import.service.js:834-846, :1045-1049); the approval goes through the one writer (:1079-1092). A130's row does the same and is left pending by the hold point (:1093-1100).",
        [PF(610), HF("backend/src/services/import.service.js", "834-846,1045-1049,1079-1101"), HF("backend/src/routes/import.js", "265-337"), WP2ADJ("Q1, Q7 (G10)"), PREP2("section 9 G10")]),
      projectEvAfter: FA(EV_AFTER_IMPORT, "cents",
        "Project EV after the PM's import on P, in the order of WP2-PREP section 5.1 (WP2ADJ Q1: the import runs on P after the quantity steps): " + fmt(EV_AFTER_QTY) + " (WP2.quantitiesA320.typed40.projectEv; BULK, T5, T6 and METHOD.stands move no allocated activity) + A110 40 -> 70 (" + fmt(IMPORT_DELTA) + ", WP2.importProgress.pm.evDelta) = " + fmt(EV_AFTER_IMPORT) + ". A130's row stays pending (hold point) and A310's is refused, so neither moves EV.",
        [PF(610), HF("backend/src/services/earned-value.service.js", "785-792"), WP2ADJ("Q1, Q7 (G10)"), PREP2("section 5.1 order; section 9 G10")]),
    },
  },
  endState087SCH: {
    projectEv: F(EV310.dailyLog570, "cents", "087-SCH as the build leaves it (MOMENT-MAP row 40): the one approved figure on an allocated activity is A310 at 570 m2 (WP2.quantitiesA310.dailyLog.evA310), so project EV = 135,000.00 x 570 / 900 = " + fmt(EV310.dailyLog570) + ". The rejected 10 m2 and the draft and submitted 5 m2 entries do not count (approved entries only; steps qty.rejected10, qty.pending), and the build approves nothing on any other activity (build/087-sch.js:801-1043: every claim is on A310). Optional (WP2-PREP G15): the live end-state read, which no fixed check depends on.", [PF(423, 604), BLD("087-sch.js", "801-1043"), BLD("MOMENT-MAP.md", "row 40"), WP2ADJ("Q7 (G15)"), PREP2("section 9 G15")]),
    A320official: F(0, "percent", "The 087-SCH build makes no progress submission on A320 (build/087-sch.js:801-1043), so GET /activities/<A320> reads pctComplete 0. Optional (WP2-PREP G15).", [PF(423), BLD("087-sch.js", "801-1043"), WP2ADJ("Q7 (G15)"), PREP2("section 9 G15")]),
    A130openHolds: F(1, "count", "The build's A130 instance (step itp, build/087-sch.js:801-838: scheduled, its one hold item unanswered) is never answered or voided, so GET /forms/hold-points?activityId=<A130> still shows 1 open, pending (= WP2.T4.openList, read live by SCH.live.A130hold). Optional (WP2-PREP G15).", [PF(423, 590), BLD("087-sch.js", "801-838"), HF("backend/src/services/form.service.js", "1416-1431"), WP2ADJ("Q7 (G15)"), PREP2("section 9 G15")]),
  },
  mutations: {
    removeHoldPointCheck: F("WP2.T4.approve red", "state", "progress.service.js:2086-2098 removed: approval 200 with the hold open.", [P(573)]),
    removeApprovalEvidence: F("WP2.T3.approveDraft red", "state", "Evidence check at approval removed.", [P(573)]),
    submitPermissionEarlyReturn: F("WP2.T2.siteOnA330 red", "state", "assertProgressSubmitAllowed returns early.", [P(573)]),
    dropIdempotentApprove: F("WP2.T1.approveAgain red", "state", "A second approval writes a second row or refuses.", [P(573)]),
    dropMethodStands: F("METHOD.stands red", "state",
      "The method-stands check (plan :612, section 6.2 :1145) dropped: assertSubmissionMethodStands({ submission, configRow }) at progress.service.js:2065 replaced by 'void configRow;' (WP2-PREP section 7 P5). The pending A220 percent submission of WP2.methodStands is then approved after the planner configured A220 as quantity (200, official 10%: the approval's quantity steps follow the submission's own method, :2111-2147), so METHOD.stands (WP2.methodStands.approve) is red. The submit-time rule is not touched: QTY.percentMethod (WP2.quantitiesA310.percentMethod, resolveSubmissionMethod :1516-1529) stays green and remains its own check (WP2ADJ Q5).",
      [P(573), PF(612, 1145), HF("backend/src/services/progress.service.js", "1516-1561,2063-2065,2111-2147"), WP2ADJ("Q5"), PREP2("section 0 fact 4; section 7 P5")],
      { note: "Changed 2026-10-10 (WP-2 G3, Q5): the value was 'WP2.quantitiesA310.percentMethod red', the submit-time rule, which this mutation leaves green" }),
    openHoldPointsEmpty: F("WP2.T4.approve red", "state", "openHoldPoints returns [].", [P(573)]),
    removeNegativeGuard: F("QTY.entry.negative red (N3, the E6 entry: the route validator and the service guard removed together; N1, the validator alone, too); QTY.entry.negative.service red (N2: the service guard alone)", "state",
      "The negative-quantity guard has two application layers (WP2ADJ Q4): the POST route's validator 'must be zero or more' (routes/quantity-progress.js:51), which answers first over HTTP, and the service's QUANTITY_NEGATIVE (quantity-progress.service.js:489-491). N3 removes both: -5 is no longer refused 400 VALIDATION_ERROR, so QTY.entry.negative (WP2.quantitiesA310.entryRefusals.negative) is red. N1 removes the validator only: the service answers 400 QUANTITY_NEGATIVE, not VALIDATION_ERROR: red. N2 removes the service guard only: over HTTP nothing changes, so only the in-process probe QTY.entry.negative.service (WP2.quantitiesA310.entryRefusals.negativeService) sees it: red. "
        + "Expected observation, not a stored entry: past both layers the insert meets the database CHECK QuantityProgressEntry_quantity_nonnegative (migration 20261005050000_quantity_progress:205), so N3 is expected to answer a 5xx (the error handler maps an unlisted database error to 500 INTERNAL_ERROR, middleware/error-handler.js:244-255) and N2's probe a database error; each is red all the same.",
      [P(573), PF(603, 612, 1135, 1145), HF("backend/src/routes/quantity-progress.js", "48-53"), HF("backend/src/services/quantity-progress.service.js", "489-491"), HF("backend/prisma/migrations/20261005050000_quantity_progress/migration.sql", "205"), HF("backend/src/middleware/error-handler.js", "41-65,244-255"), WP2ADJ("Q4, Q8"), PREP2("section 7 N1-N3")],
      { note: "Changed 2026-10-10 (WP-2 G2, Q4): the value was 'WP2.quantitiesA310.entryRefusals.negative red'; with the service guard alone removed (the book's citation) every HTTP check stays green" }),
    splitBulkTransaction: F("BULK.mixed.count red", "state",
      "The bulk transaction split (WP2-PREP section 7 P8: prisma.$transaction(async (tx) => ...) at activity.service.js:797 run as a plain call on the client, :826): update 0 (A330, the planner's 10%) is written before update 1 (A310) is refused, so A330's submission count rises by one and BULK.mixed.count (WP2.bulk.mixedBatch.a330SubmissionsDelta) is red. The refusal body is the same either way (details.batch.written is the constant 0, :819), so WP2.bulk.mixedBatch.written cannot catch it.",
      [P(573), PF(608, 612, 1145), HF("backend/src/services/activity.service.js", "797-826"), WP2ADJ("Q7 (G5)"), PREP2("section 0 fact 5; section 7 P8")],
      { note: "Changed 2026-10-10 (WP-2 G5): the value was 'WP2.bulk.mixedBatch.written red'; details.batch.written is the constant 0 (activity.service.js:819), so the refusal body cannot show the split" }),
  },
};

// Load checks for the WP-2 answer-book leaves (2026-10-10, WP2ADJ Q4, Q5, Q7): each added or changed leaf agrees with the figures it is built from.
(() => {
  const fail = (what) => {
    throw new Error("schedule answer book: " + what);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // G1, G2: the route's contracts, the field in error.details, the earlier codes as planValue
  const rw = WP2.rules.rejectWithoutReason;
  if (rw.value !== "400 VALIDATION_ERROR" || rw.planValue !== "400 REJECTION_REASON_REQUIRED" || !rw.planDisagrees || !/details\.field=reason/.test(rw.note || "")) fail("WP2.rules.rejectWithoutReason must carry the route's contract, the field, and the service's code as planValue (G1)");
  const er = WP2.quantitiesA310.entryRefusals;
  if (er.negative.value !== "400 VALIDATION_ERROR" || er.negative.planValue !== er.negativeService.value || er.negativeService.value !== "400 QUANTITY_NEGATIVE" || !er.negative.planDisagrees || !/details\.field=quantity/.test(er.negative.note || "")) fail("WP2.quantitiesA310.entryRefusals.negative / negativeService: the route's VALIDATION_ERROR over HTTP, the service's QUANTITY_NEGATIVE in process and as planValue (G2, Q4)");
  // G3, Q5: METHOD.stands
  const ms = WP2.methodStands;
  if (ms.approve.value !== WP2.quantitiesA310.percentMethod.value || ms.detailsSubmissionId.value !== true || ms.official.value !== 0) fail("WP2.methodStands: 409 PROGRESS_METHOD_MISMATCH (the submit-time rule's code), details.submissionId, nothing official (G3)");
  if (METHODS_087SCH[METHOD_STANDS.activity] !== undefined || ALLOC[METHOD_STANDS.activity] !== undefined || !METHODS_087SCH.siteEngineerAssigned.includes(METHOD_STANDS.activity)) fail("METHOD.stands needs an activity with no method row, no allocation on P and the site engineer assigned (G3)");
  // G4: the reason's text, the routes
  const wb = WP2.quantityView.withoutBoqRead;
  if (!/^[\x20-\x7e]+$/.test(wb.reason.value) || wb.reason.value === "QUANTITY_FIGURES_WITHHELD" || !/QUANTITY_FIGURES_WITHHELD/.test(wb.reason.note || "") || wb.http.value !== 200 || wb.withheld.value !== true || wb.itemRoute.value !== WP2.T1.siteApprove.value || wb.route.value.indexOf("/activities/") < 0) fail("WP2.quantityView.withoutBoqRead: the constant's text, 200 withheld on the activity route, 403 FORBIDDEN on the item route (G4)");
  // G5, G6 and the mutation leaves' catchers
  const mx = WP2.bulk.mixedBatch;
  if (mx.written.value !== 0 || mx.a330SubmissionsDelta.value !== 0 || WP2.mutations.splitBulkTransaction.value !== "BULK.mixed.count red") fail("the split bulk transaction is caught by A330's submission count, not by details.batch.written (G5)");
  if (WP2.mutations.dropMethodStands.value !== "METHOD.stands red") fail("WP2.mutations.dropMethodStands must name METHOD.stands (G3, Q5)");
  const ng = WP2.mutations.removeNegativeGuard.value;
  if (!/QTY\.entry\.negative red/.test(ng) || !/QTY\.entry\.negative\.service red/.test(ng)) fail("WP2.mutations.removeNegativeGuard must name QTY.entry.negative (N3) and QTY.entry.negative.service (N2) (G2, Q4)");
  // G7: the daily-report approver
  const dr = WP2.dailyReport;
  if (dr.approver.value !== "pm" || dr.plannerApprove.value !== WP2.T1.siteApprove.value || dr.qsApprove.value !== WP2.T1.siteApprove.value) fail("WP2.dailyReport: the PM approves, the planner and the QS are refused 403 FORBIDDEN (G7)");
  // G9: 087-FLD's hold points, the build's own before-edit assertions (087-fld.js:1254-1257) and HEAD's after-edit reading
  const rt = WP2.T4.probes.retroactiveTemplateEdit;
  if (!same(rt.value, FLD_HOLDS_V1) || !same(rt.today, FLD_HOLDS_V2) || !same(WP2.T4.probes.retroactiveBeforeEdit.value, rt.value) || rt.ref !== "HR-Q2") fail("WP2.T4.probes.retroactiveTemplateEdit: version-1 figures as value (and before the edit), version-2 figures as today (G9)");
  if (FLD_HOLDS_V1.A100.open !== 0 || FLD_HOLDS_V1.A110.open !== 4 || !FLD_HOLDS_V1.A110.states.every((s) => s === "pending") || !same(FLD_HOLDS_V1.A120.states, ["failed"]) || FLD_HOLDS_V1.A140.open + FLD_HOLDS_V1.A150.open + FLD_HOLDS_V1.A170.open !== 0) fail("FLD_HOLDS_V1 must be the build's before-edit reading (087-fld.js:1254-1257)");
  if (FLD_HOLDS_V2.A110.open !== 2 * FLD_ITP.holdItems.v2.length || !same(FLD_HOLDS_V2.A120.states, ["failed", "pending"]) || FLD_HOLDS_V2.A150.open !== 1 || FLD_HOLDS_V2.A170.open !== 1 || FLD_HOLDS_V2.A100.open + FLD_HOLDS_V2.A140.open !== 0) fail("FLD_HOLDS_V2: the added hold item open on every non-void instance");
  // G10: the import on P
  const ip = WP2.importProgress;
  if (ip.pm.projectEvAfter.value !== WP2.quantitiesA320.typed40.projectEv.value + ip.pm.evDelta.value || ip.pm.projectEvAfter.value !== EV_AFTER_IMPORT || ip.pm.A110approvesPending.value !== true) fail("WP2.importProgress.pm.projectEvAfter must be the EV after Q320 plus the import's delta (G10)");
  if (!same(Object.keys(ip.site.reuploadRows.value), Object.keys(PROGRESS_FILE)) || ip.site.reuploadRows.value.A110 !== ip.site.reupload.value || ip.site.reuploadRows.value.A130 !== ip.site.reupload.value || ip.site.reuploadRows.value.A310 !== "refused") fail("WP2.importProgress.site.reuploadRows must name the progress file's rows (G10)");
  // G11, G15, G16, G17, G22, G23
  if (WP2.T4.siteVoid.value !== WP2.T1.siteApprove.value) fail("WP2.T4.siteVoid must be the role gate's 403 FORBIDDEN (G11)");
  const es = WP2.endState087SCH;
  if (es.projectEv.value !== WP2.quantitiesA310.dailyLog.evA310.value || es.A130openHolds.value !== WP2.T4.openList.value || es.A320official.value !== 0) fail("WP2.endState087SCH must be A310's EV alone, A320 at 0, A130's one open hold (G15)");
  if (WP2.quantitiesA310.dailyLog.evReportPct.value !== Number(WP2.quantitiesA310.dailyLog.pct.value.toFixed(2))) fail("WP2.quantitiesA310.dailyLog.evReportPct must be pct to 2 dp (G16)");
  const evd = WP2.T3.withDocument.evidence.value;
  if (!evd || !Array.isArray(evd.photos) || evd.photos.length !== 1 || !same(Object.keys(evd.photos[0]), ["key", "documentId", "fileName"])) fail("WP2.T3.withDocument.evidence must name one uploaded photo by key, documentId and fileName (G17)");
  if (!same(WP2.T2.siteOnA330ActivityIds.value, ["A330"]) || METHODS_087SCH.siteEngineerAssigned.includes("A330") || WP2.T2.siteOnA330SubmissionsDelta.value !== 0) fail("WP2.T2.siteOnA330 details name A330 alone, nothing written (G22)");
  const mb = WP2.T6.methodBypass;
  const mi = WP2.T6.methodBypassInputs.value;
  if (mb.value !== 409 || !(METHOD_BYPASS_PCT > mi.approvedPercent) || mi.quantityComplete / mi.quantityPlanned * 100 !== METHOD_BYPASS_PCT || mb.today.indexOf(METHOD_BYPASS_PCT + "% official") < 0 || METHODS_087SCH[mi.activity] !== null || ALLOC[mi.activity] !== undefined) fail("WP2.T6.methodBypass: typed above the approved percent, on an unconfigured, unallocated activity (G23)");
  // every leaf with a today added or changed here names its ref and is an assumption
  for (const [key, leaf] of [["T4.probes.retroactiveTemplateEdit", rt], ["T6.methodBypass", mb]]) {
    if (leaf.today === undefined || !leaf.ref || !leaf.assumption) fail("WP2." + key + " carries a today without its ref, or is not marked an assumption");
  }
})();

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

// ─── reporting zone (builders' adjudication 087-EV item 5, 087-OTH/052/006 item 2, R1-15, R3-2) ───
const zoneSources = (...extra) => [
  ...extra,
  H("backend/src/services/project.service.js", "441-459"),
  H("backend/src/utils/reporting-cutoff.js", "23-27,145-156"),
  H("backend/src/services/earned-value.service.js", "100-105,966-978,1065"),
  BADJ("087-EV item 5; 087-OTH/052/006 item 2; R1-15; R3-2"),
];
const zoneDerivation = (company, zone) =>
  `Company ${company}'s workspace zone is ${zone} (plan §3.1; lib DEEP asserts the company's facts before a build). createProject copies the workspace defaultTimezone onto Project.timezone when the creator names none (ENT-6, project.service.js:441-459), and the project API has no timezone field (buildProjectData never sets one; L117/L126), so a build-created project holds Project.timezone = ${zone}. The reporting zone is therefore the project's own, ${zone} (reporting-cutoff.js:145-149, reached through earned-value.service.js:100-105), equal to the company zone: asserted through the API as reporting.timeZone (GET /reports/ev, earned-value.service.js:966-978) and on the period answers.`;
const sourceDerivation = (company, zone) =>
  `'project': resolveReportingTimeZone labels a valid Project.timezone TIME_ZONE_SOURCES.PROJECT = 'project' (reporting-cutoff.js:23-27, 145-149), and the EV report and the period answers carry that label as reporting.timeZoneSource (earned-value.service.js:966-978, 1065). The project's zone is the workspace's ${zone} copied at creation (timeZone), so the label is 'project' while the zone is the company's: a proof asserts both, through the API (source 'project' AND timeZone ${zone}). Observed on the builders' debug runs (087-EV, 052-SCH-EV answered 'project').`;
const A8_NOTE =
  "Plan premise A8 (:1213 @f599e67: 'a project's own time zone cannot be set ... the reporting zone is the company's and is asserted through reporting.timeZoneSource') is wrong for the label: since ENT-6 a new project holds a copy of the workspace zone, so the source reads 'project' while the figures are the company zone's. Whether a later change of the company zone reaches existing projects is suspect WP3-TZ-1 (WP-3 confirm-first, P3); the creation code says it does not (project.service.js:443-444: 'an existing project is never rewritten when the workspace's defaults change').";
const ZONE_NOTE_DERIVATION =
  "reportingTimeZoneNote answers null when the source is 'project' (reporting-cutoff.js:201-202), so reporting.timeZoneNote is null: no 'Project timezone is not configured; the organisation default ... is being used' sentence (that sentence belongs to the 'organisation' source, :203-204).";

// ─── run-date reads after the February lock (builders' adjudication round 2, R2-B B4) ───
// 087-EV reads the EV report cut at the run date twice after the locks: after the back-dated A130
// cost (WP3.periods.afterLock.backdatedCost) and after the new approval (A120 50 -> 60%,
// WP3.periods.afterLock.newApproval). BAC follows the T5 delete probe (WP3.T5.deleteProbe), which
// runs before them: refused -> the +13,000 revision stays approved (WP3.T5.bac); deleted, with an
// audit event or (HEAD, L112) silently -> WP3.T1.bac. Each branch is a full metric set; a build or
// proof takes the branch its probe produced. Every row and loading is dated on or before 2026-10-01,
// so the figures hold for every run date on or after it (the run-date assumption).
const AC_AFTER_LOCK = acLedger(RUN, ROWS_LOCK);
if (AC_AFTER_LOCK !== M_T2.ac + cents(EV087.backdatedAfterLock[1])) throw new Error("schedule answer book: the after-lock run-date AC must be WP3.T2.ac + backdatedCost");
if (acHead(RUN, ROWS_LOCK) !== AC_AFTER_LOCK) throw new Error("schedule answer book: at the run date HEAD's cumulative AC must agree with the ledger");
const M_AFTER_LOCK = {
  afterCost: {
    revisionKept: evMetrics({ bac: BAC_T5, pv: pvAt(RUN), ev: EV_STAGE9, ac: AC_AFTER_LOCK }),
    revisionDeleted: evMetrics({ bac: BAC, pv: pvAt(RUN), ev: EV_STAGE9, ac: AC_AFTER_LOCK }),
  },
  afterApproval: {
    revisionKept: evMetrics({ bac: BAC_T5, pv: pvAt(RUN), ev: EV_AFTER_LOCK, ac: AC_AFTER_LOCK }),
    revisionDeleted: evMetrics({ bac: BAC, pv: pvAt(RUN), ev: EV_AFTER_LOCK, ac: AC_AFTER_LOCK }),
  },
};
const AFTER_LOCK_SRC = [PF(425, 632, 638, 641, 647), P(386, 602, 608), ADJ("S2 WP3.periods.afterLock"), BADJ("Round 2 R2-B (B4); 087-EV item 1; R1-1")];
const AFTER_LOCK_BRANCH = {
  revisionKept: "Branch revisionKept: the T5 delete probe was refused (WP3.T5.deleteProbe 'refused'), so the +13,000.00 budget revision stays approved and BAC is WP3.T5.bac.",
  revisionDeleted: "Branch revisionDeleted: the T5 revision is gone, deleted with an audit event (WP3.T5.deleteProbe 'audited') or, at HEAD, silently (L112: the probe's own BLOCKED today), so BAC is back to WP3.T1.bac. After HEAD's silent delete these are the figures HEAD answers; the L112 departure is recorded at the probe, not at these reads.",
};
/** The thirteen metric leaves of one after-lock run-date read (stage afterCost | afterApproval; branch revisionKept | revisionDeleted). */
function afterLockLeaves(stage, branch) {
  const m = M_AFTER_LOCK[stage][branch];
  const leaves = metricLeaves(m, AFTER_LOCK_SRC, { assumption: true, extra: { note: AFTER_LOCK_BRANCH[branch] } });
  const evDerivation = stage === "afterCost"
    ? `WP3.T2.ev, unchanged by the back-dated cost (it moves AC only): A110 60,000.00 x 100% + A120 30,000.00 x 50% + A130 90,000.00 x 25% = ${fmt(m.ev)}.`
    : `WP3.periods.afterLock.runDateEv: ${fmt(EV_STAGE9)} + 30,000.00 x (60% - 50%) = ${fmt(m.ev)}; the approval is stamped at the run date, so the run-date read sees it (the 2026-02-28 read does not: cutoffReportEv 0).`;
  return {
    ...leaves,
    bac: { ...leaves.bac, derivation: branch === "revisionKept" ? `WP3.T5.bac: approved allocations ${fmt(BAC)} + the approved +${fmt(BAC_T5 - BAC)} budget revision = ${fmt(m.bac)}.` : `WP3.T1.bac: approved allocations ${fmt(BAC)}; the +${fmt(BAC_T5 - BAC)} revision was deleted by the T5 probe = ${fmt(m.bac)}.` },
    pv: { ...leaves.pv, derivation: `WP3.T2.pv: approved loadings with plannedDate on or before the run date (the last is 2026-04-10) = ${fmt(m.pv)}.` },
    ev: { ...leaves.ev, derivation: evDerivation },
    ac: { ...leaves.ac, derivation: `WP3.T2.ac ${fmt(M_T2.ac)} + WP3.periods.afterLock.backdatedCost ${fmt(cents(EV087.backdatedAfterLock[1]))} (A130, incurredOn ${EV087.backdatedAfterLock[2]}, on or before the run date) = ${fmt(m.ac)}: ledger postings dated on or before the run date${stage === "afterApproval" ? " (the new approval moves no cost)" : ""}. HEAD agrees, so there is no L34 today at the run date: one cumulative CostRecord per activity, each through-date on or before the run date (A110 60,000.00 through 2026-09-30, A120 30,000.00 through 2026-10-01, A130 25,000.00 through 2026-02-15; earned-value.service.js:486-514).` },
  };
}

// ─── the 2026-02-28 read after the back-dated cost, and T6 before / after the retirement (round 3, R3-2) ───
// Under A10 a builder asserts book leaves and computes no figure: these are the metric sets 087-ev.js used to
// derive in its own code (rules.evMetrics over book leaves), now derived here, on paper, from the same leaves.
//
// (a) GET /reports/ev?cutoffDate=2026-02-28 after the back-dated A130 cost (WP3.periods.afterLock.backdatedCost):
// 087-EV reads it at checkpoint.afterLock.afterCost and again at checkpoint.afterLock.afterApproval (the new
// approval is stamped after the cutoff instant, so the read is the same: cutoffReportEv 0). One metric set serves
// both outcomes of the T5 delete probe: the +13,000.00 revision is effective 2026-03-01, after this cutoff, and the
// report adjusts BAC only by approved revisions effective on or before the cutoff (earned-value.service.js:428-437),
// so BAC is WP3.T3.bac whether the revision stayed approved or was deleted.
const M_CUTOFF_AFTER_COST = evMetrics({ bac: BAC, pv: pvAt("2026-02-28"), ev: 0, ac: acLedger("2026-02-28", ROWS_LOCK) });
const M_CUTOFF_AFTER_COST_HEAD = evMetrics({ bac: BAC, pv: pvAt("2026-02-28"), ev: 0, ac: acHead("2026-02-28", ROWS_LOCK) });
if (M_CUTOFF_AFTER_COST.ac !== M_T3.ac + cents(EV087.backdatedAfterLock[1])) throw new Error("schedule answer book: the 2026-02-28 AC after the back-dated cost must be WP3.T3.ac + backdatedCost");
if (!(EV087.budgetRevision.effectiveDate > "2026-02-28")) throw new Error("schedule answer book: the T5 revision must be effective after the 2026-02-28 cutoff for one cutoffAfterCost set to serve both T5 probe branches");
const CUTOFF_AFTER_COST_SRC = [PF(425, 632, 639, 647), H("backend/src/services/earned-value.service.js", "428-437,486-514,737-753"), ADJ("S2 WP3.periods.afterLock"), BADJ("Round 3 R3-2; 087-EV item 1; R1-1")];
/**
 * HEAD's figures of a metric set `h`, derived on paper, one sentence per metric, under `heading`
 * (the defect and its leaf): appended to the derivation of every leaf that carries a today.
 */
const headTexts = (h, heading, acFormula) => ({
  ac: `${heading} ${acFormula} = ${fmt(h.ac)}.`,
  spi: `${heading} ${fmt(h.ev)} / ${fmt(h.pv)} = ${h.spi === null ? "null" : r6(h.spi)}.`,
  spiAlert: `${heading} SPI ${h.spi === null ? "null" : r6(h.spi)} ${h.spiAlert ? "< 0.9 -> alert" : "-> no alert"}.`,
  cpi: `${heading} ${fmt(h.ev)} / ${fmt(h.ac)} = ${h.cpi === null ? "null" : r6(h.cpi)}.`,
  cpiAlert: `${heading} CPI ${h.cpi === null ? "null" : r6(h.cpi)} ${h.cpiAlert ? "< 0.9 -> alert" : "-> no alert"}.`,
  eac: `${heading} ${h.eacBasis === "budget_over_cpi" ? `BAC / CPI = ${fmt(h.bac)} x ${fmt(h.ac)} / ${fmt(h.ev)} -> ${fmt(h.eac)} (half up)` : `CPI ${h.cpi === null ? "null" : 0} -> EAC = BAC ${fmt(h.bac)}`}.`,
  eacBasis: `${heading} eacBasisOf(totalBudget, cpi) = ${h.eacBasis}.`,
  cv: `${heading} EV - AC = ${fmt(h.ev)} - ${fmt(h.ac)} = ${fmt(h.cv)}.`,
  etc: `${heading} EAC - AC = ${fmt(h.eac)} - ${fmt(h.ac)} = ${fmt(h.etc)}.`,
});
/**
 * Each leaf that carries a today (metricLeaves' headM) gets HEAD's on-paper derivation appended
 * (texts[key]); a ratio's today is stated to six places, as every ratio leaf states its value.
 */
const headDerivations = (leaves, texts) => Object.fromEntries(Object.entries(leaves).map(([key, leaf]) => {
  if (leaf.today === undefined) return [key, leaf];
  if (!texts[key]) throw new Error(`schedule answer book: ${key} carries a today with no derivation of it`);
  return [key, { ...leaf, today: leaf.unit === "ratio" ? r6(leaf.today) : leaf.today, derivation: `${leaf.derivation} ${texts[key]}` }];
}));
/** The thirteen metric leaves of the 2026-02-28 read after the back-dated cost (both T5 branches, both after-lock reads). */
function cutoffAfterCostLeaves() {
  const m = M_CUTOFF_AFTER_COST;
  const h = M_CUTOFF_AFTER_COST_HEAD;
  const note = "One set for both outcomes of the T5 delete probe: the +13,000.00 revision (effective 2026-03-01) is after this cutoff. Read at checkpoint.afterLock.afterCost and at checkpoint.afterLock.afterApproval alike: the new approval is stamped after the cutoff instant, so it changes nothing here.";
  const leaves = metricLeaves(m, CUTOFF_AFTER_COST_SRC, { headM: h, assumption: true, extra: { note } });
  const heading = "HEAD (L34, the today of WP3.periods.afterLock.cutoffReportAc):";
  return headDerivations({
    ...leaves,
    bac: { ...leaves.bac, derivation: `WP3.T3.bac: approved allocations ${fmt(BAC)}. The +${fmt(BAC_T5 - BAC)} budget revision of T5 is effective ${EV087.budgetRevision.effectiveDate}, after this cutoff, and only approved revisions effective on or before the cutoff adjust BAC (earned-value.service.js:428-437), so BAC is ${fmt(m.bac)} whether the T5 probe left the revision approved or deleted.` },
    pv: { ...leaves.pv, derivation: `WP3.T3.pv: approved loadings with plannedDate on or before 2026-02-28 = 60,000.00 (01-23) + 30,000.00 (01-28) + 90,000.00 (02-13) = ${fmt(m.pv)}.` },
    ev: { ...leaves.ev, derivation: `WP3.periods.afterLock.cutoffReportEv: ${fmt(m.ev)}. EV reads progress approved by the cutoff instant (${CUT_0228_CAIRO}); every approval, the new A120 60% included, is stamped after it.` },
    ac: { ...leaves.ac, derivation: `WP3.periods.afterLock.cutoffReportAc: WP3.T3.ac ${fmt(M_T3.ac)} (A110 50,000.00 on 01-20 + A130 20,000.00 on 02-10) + the back-dated A130 ${fmt(cents(EV087.backdatedAfterLock[1]))} on ${EV087.backdatedAfterLock[2]} = ${fmt(m.ac)}: ledger postings dated on or before the cutoff.` },
  }, headTexts(h, heading, `one cumulative CostRecord per activity, counted whole only when its through-date is on or before the cutoff (earned-value.service.js:486-514): A130 25,000.00 through ${EV087.backdatedAfterLock[2]} stays, A110 60,000.00 through 2026-09-30 and A120 30,000.00 through 2026-10-01 drop out`));
}

// (b) T6: the run-date reads before and after the revision that retires A140 (WP3.T6), one metric set per outcome
// of the T5 probe (BAC WP3.T5.bac while the revision stays approved, WP3.T1.bac once it is deleted). EV is the
// run-date EV after the periods step's new approval (WP3.periods.afterLock.runDateEv; A140 holds no allocation,
// so the retirement moves no EV). AC before the retirement is WP3.T6.acBeforeRetirement and, by HR-S9's
// recommendation, the same after it (WP3.T6.acAfterRetirement), where HEAD drops A140's 5,000.00 (L118 -> HR-S9,
// the leaf's today). The after set's cpi equals WP3.T6.cpiAfterRetirement (value and today; checked at load).
const M_T6 = {
  value: {
    revisionKept: evMetrics({ bac: BAC_T5, pv: pvAt(RUN), ev: EV_AFTER_LOCK, ac: AC_T6 }),
    revisionDeleted: evMetrics({ bac: BAC, pv: pvAt(RUN), ev: EV_AFTER_LOCK, ac: AC_T6 }),
  },
  afterHead: {
    revisionKept: evMetrics({ bac: BAC_T5, pv: pvAt(RUN), ev: EV_AFTER_LOCK, ac: AC_T6_HEAD_RETIRED }),
    revisionDeleted: evMetrics({ bac: BAC, pv: pvAt(RUN), ev: EV_AFTER_LOCK, ac: AC_T6_HEAD_RETIRED }),
  },
};
if (AC_T6 !== AC_AFTER_LOCK + cents(EV087.a140Cost[1])) throw new Error("schedule answer book: T6's AC before the retirement must be the after-lock run-date AC + the A140 cost");
if (AC_T6_HEAD_RETIRED !== AC_AFTER_LOCK) throw new Error("schedule answer book: HEAD's AC after the retirement must be the after-lock run-date AC (A140's cost dropped out)");
const T6_SRC = [PF(425, 632, 642, 662, 1035), ADJ("S2 WP3.periods.afterLock"), BADJ("Round 3 R3-2; 087-EV item 1; R1-1")];
/** The thirteen metric leaves of one T6 run-date read (stage before | after the retirement; branch revisionKept | revisionDeleted). */
function t6Leaves(stage, branch) {
  const m = M_T6.value[branch]; // after the retirement the value is the same set: HR-S9's recommendation keeps A140's AC
  const h = stage === "after" ? M_T6.afterHead[branch] : null;
  const note = `${AFTER_LOCK_BRANCH[branch]}${stage === "after" ? " After the retirement HR-S9 is undecided (AC itself is CERT-5): the value keeps A140's AC, its recommendation; the today is HEAD's reading, which drops it (L118)." : ""}`;
  const leaves = metricLeaves(m, T6_SRC, { headM: h, assumption: true, extra: { note } });
  const a140 = cents(EV087.a140Cost[1]);
  const bac = branch === "revisionKept"
    ? `WP3.T5.bac: approved allocations ${fmt(BAC)} + the approved +${fmt(BAC_T5 - BAC)} budget revision (effective ${EV087.budgetRevision.effectiveDate}, on or before the run date) = ${fmt(m.bac)}; the T5 delete probe was refused, so the revision stays.`
    : `WP3.T1.bac: approved allocations ${fmt(BAC)}; the +${fmt(BAC_T5 - BAC)} revision was deleted by the T5 probe (with an audit event, or at HEAD silently: L112) = ${fmt(m.bac)}.`;
  const ac = stage === "after"
    ? `WP3.T6.acAfterRetirement: ${fmt(m.ac)}, as before the retirement (WP3.T6.acBeforeRetirement). HR-S9's recommendation (undecided; AC itself is CERT-5) keeps a retired activity's AC in the project totals, and A140's ${fmt(a140)} stays in the ledger.`
    : `WP3.T6.acBeforeRetirement: WP3.T2.ac ${fmt(M_T2.ac)} + the back-dated A130 ${fmt(cents(EV087.backdatedAfterLock[1]))} (WP3.periods.afterLock.backdatedCost) + the A140 ${fmt(a140)} dated the run date (WP3.T6.ledgerDelta) = ${fmt(m.ac)}: ledger postings dated on or before the run date. HEAD agrees: every cumulative CostRecord's through-date is on or before the run date.`;
  const withValues = {
    ...leaves,
    bac: { ...leaves.bac, derivation: bac },
    pv: { ...leaves.pv, derivation: `WP3.T2.pv: approved loadings with plannedDate on or before the run date (the last is 2026-04-10) = ${fmt(m.pv)}.` },
    ev: { ...leaves.ev, derivation: `WP3.periods.afterLock.runDateEv: ${fmt(EV_STAGE9)} + 30,000.00 x (60% - 50%) = ${fmt(m.ev)} (A110 60,000.00 + A120 18,000.00 + A130 22,500.00); A140 holds no allocation, so the retirement moves no EV.` },
    ac: { ...leaves.ac, derivation: ac },
  };
  if (!h) return withValues;
  return headDerivations(withValues, headTexts(h, "HEAD (HR-S9 / L118, the today of WP3.T6.acAfterRetirement: A140's cumulative CostRecord drops out with the retired activity):", `${fmt(m.ac)} - ${fmt(a140)}`));
}

const WP3 = {
  setup: {
    boq: FA(BOQ_EV, "text", `087-EV's BOQ: five in-scope rows, each allocated whole to one activity (E-001 5,000 m3 x 12 = 60,000 -> A110; E-002 200 m3 x 150 = 30,000 -> A120; E-003 600 m3 x 150 = 90,000 -> A130; E-004 900 m2 x 150 = 135,000 -> A310; E-005 600 m2 x 120 = 72,000 -> A320): priced ${fmt(BOQ_EV_PRICED)}, allocated ${fmt(ALLOCATED_FIVE)}, coverage 100%. Row codes and the one-row-per-activity split are a choice; 052-SCH-EV and D3 carry the same rows.`, [P(386, 409, 546), ADJ("S2 087-EV inputs")]),
    allocations: F(ALLOC, "cents", `Approved allocations as explicit entries: A110 60,000; A120 30,000; A130 90,000; A310 135,000; A320 72,000. EV 97,500 = 60,000 x 100% + 30,000 x 50% + 90,000 x 25% fixes the first three; BAC 387,000 - 180,000 = 207,000 = A310 135,000 + A320 72,000 (plan :546).`, [P(386, 546, 598), ADJ("S2 087-EV inputs")]),
    allocatedTotal: F(ALLOCATED_FIVE, "cents", `60,000 + 30,000 + 90,000 + 135,000 + 72,000 = ${fmt(ALLOCATED_FIVE)} = BAC (WP3.T1.bac).`, [P(386, 598), ADJ("S2 087-EV inputs")]),
    loadings: F(EV087.loadings, "text", "Approved cost loadings (activity, amount, plannedDate).", [P(386)]),
    progress: F(EV087.progress, "percent", "Approved progress A110 100, A120 50, A130 25.", [P(386)]),
    directCosts: F(EV087.directCosts, "text", "Approved direct costs (activity, amount, incurredOn); later 30,000 on A120 dated 2026-10-01.", [P(386)]),
    timeZone: F("Africa/Cairo", "text", zoneDerivation("087", "Africa/Cairo"), zoneSources(PF(400), PF(425))),
    timeZoneSource: F("project", "state", sourceDerivation("087", "Africa/Cairo"), zoneSources(PF(425, 1213)), { planValue: "organisation", note: A8_NOTE }),
    timeZoneNote: F(null, "state", ZONE_NOTE_DERIVATION, [H("backend/src/utils/reporting-cutoff.js", "201-205"), H("backend/src/services/earned-value.service.js", "976-978"), BADJ("087-EV item 5; R1-15")]),
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
    // The run-date reads before and after the retirement (round 3, R3-2): thirteen leaves each, by the T5 probe's branch.
    before: { revisionKept: t6Leaves("before", "revisionKept"), revisionDeleted: t6Leaves("before", "revisionDeleted") },
    after: { revisionKept: t6Leaves("after", "revisionKept"), revisionDeleted: t6Leaves("after", "revisionDeleted") },
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
      // The run-date reads after the back-dated cost and after the new approval (round 2, R2-B B4), by the T5 probe's branch.
      runDateAfterCost: { revisionKept: afterLockLeaves("afterCost", "revisionKept"), revisionDeleted: afterLockLeaves("afterCost", "revisionDeleted") },
      runDateAfterApproval: { revisionKept: afterLockLeaves("afterApproval", "revisionKept"), revisionDeleted: afterLockLeaves("afterApproval", "revisionDeleted") },
      // The 2026-02-28 read after the back-dated cost (round 3, R3-2): thirteen leaves, one set for both probe branches and both after-lock reads.
      cutoffAfterCost: cutoffAfterCostLeaves(),
      relockSameSnapshotId: F(true, "bool", "Locking again returns the stored snapshot: same id.", [P(608), H("backend/src/services/earned-value.service.js", "1708-1710")]),
      relockSameLockedAt: F(true, "bool", "Same lockedAt.", [P(608)]),
      loadingInLockedPeriod: F("409 REPORTING_PERIOD_LOCKED", "http", "A cost loading in the locked period.", [P(594, 608), H("backend/src/services/earned-value.service.js", "1231-1239")]),
    },
    jan: {
      cutoff: F(endOfLocalDay("2026-01-31", "Africa/Cairo"), "instant", "Period 2026-01 cutoff 2026-01-31, Africa/Cairo.", [P(386)]),
      lock: FA("normal", "state", "Locked without an override, by finance, once 087-EV's reporting gate is ready (the plan says only 'one locked normally').", [P(386)]),
      snapshot: metricLeaves(M_JAN, [P(386)], { headM: M_JAN_HEAD, assumption: true }),
    },
    futurePeriod: F(futurePeriodFor(RUN), "text",
      `The plan's "one with a future cutoff" (087-EV row), made a function of the run date (builders' adjudication 087-EV item 6): rules.futurePeriodFor(runDate) = the month after the run month (December rolls into January of the next year), start its 1st, end and cutoff its last day. The run date R is the company-local date of the build (Africa/Cairo for 087). The cutoff is >= R + 28 days (the next month's last day is at least 28 days after any day of the run month), so the cutoff instant (the end of that day in the reporting zone) is after every instant of the run date in any zone: the lock is always one "before the cutoff" (L113 / HR-E2, futureCutoffLock). Reference run date ${RUN} -> ${futurePeriodFor(RUN).code} (${futurePeriodFor(RUN).start}..${futurePeriodFor(RUN).end}), the period the book fixed before; a build on 2026-11-05 takes 2026-12, one on 2026-12-03 takes 2027-01. The three periods for a run date: rules.ev087PeriodsFor(runDate) (inputs.ev087.periods = ev087PeriodsFor(${RUN})).`,
      [PF(425, 649), P(386, 610), BADJ("087-EV item 6")]),
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

// Round 3 (R3-2): the added metric sets agree with the leaves they are built from (checked at load).
for (const branch of ["revisionKept", "revisionDeleted"]) {
  const before = WP3.T6.before[branch];
  const after = WP3.T6.after[branch];
  const bacLeaf = branch === "revisionKept" ? WP3.T5.bac : WP3.T1.bac;
  if (before.bac.value !== bacLeaf.value || after.bac.value !== bacLeaf.value) throw new Error(`schedule answer book: WP3.T6.before/after.${branch}.bac must be ${branch === "revisionKept" ? "WP3.T5.bac" : "WP3.T1.bac"}`);
  if (before.pv.value !== WP3.T2.pv.value || before.ev.value !== WP3.periods.afterLock.runDateEv.value) throw new Error(`schedule answer book: WP3.T6.before.${branch} must run on WP3.T2.pv and WP3.periods.afterLock.runDateEv`);
  if (before.ac.value !== WP3.T6.acBeforeRetirement.value || before.ac.today !== undefined) throw new Error(`schedule answer book: WP3.T6.before.${branch}.ac must be WP3.T6.acBeforeRetirement, with no today`);
  if (after.ac.value !== WP3.T6.acAfterRetirement.value || after.ac.today !== WP3.T6.acAfterRetirement.today) throw new Error(`schedule answer book: WP3.T6.after.${branch}.ac must be WP3.T6.acAfterRetirement (value and today)`);
  if (after.cpi.value !== WP3.T6.cpiAfterRetirement.value || after.cpi.today !== WP3.T6.cpiAfterRetirement.today) throw new Error(`schedule answer book: WP3.T6.after.${branch}.cpi must be WP3.T6.cpiAfterRetirement (value and today)`);
}
{
  const cac = WP3.periods.afterLock.cutoffAfterCost;
  const acLeaf = WP3.periods.afterLock.cutoffReportAc;
  if (cac.ac.value !== acLeaf.value || cac.ac.today !== acLeaf.today) throw new Error("schedule answer book: WP3.periods.afterLock.cutoffAfterCost.ac must be cutoffReportAc (value and today)");
  if (cac.ev.value !== WP3.periods.afterLock.cutoffReportEv.value || cac.ev.today !== undefined) throw new Error("schedule answer book: WP3.periods.afterLock.cutoffAfterCost.ev must be cutoffReportEv");
  if (cac.bac.value !== WP3.T3.bac.value || cac.pv.value !== WP3.T3.pv.value) throw new Error("schedule answer book: WP3.periods.afterLock.cutoffAfterCost runs on WP3.T3.bac and WP3.T3.pv");
}

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
    timeZone: F("America/Chicago", "text", zoneDerivation("052", "America/Chicago"), zoneSources(PF(400), PF(442)), { company: "052" }),
    timeZoneSource: F("project", "state", sourceDerivation("052", "America/Chicago"), zoneSources(PF(442, 1213)), { planValue: "organisation", note: A8_NOTE, company: "052" }),
    timeZoneNote: F(null, "state", ZONE_NOTE_DERIVATION, [H("backend/src/utils/reporting-cutoff.js", "201-205"), H("backend/src/services/earned-value.service.js", "976-978"), BADJ("087-OTH/052/006 item 2; R3-2")], { company: "052" }),
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
    // D3 is company 006 Atlas Infrastructure (plan §3.1 'WP-0 choice of D3', :375-378 @f599e67: AED, Asia/Dubai).
    timeZone: F("Asia/Dubai", "text", zoneDerivation("006", "Asia/Dubai"), zoneSources(PF(375, 378, 447, 448)), { company: "006" }),
    timeZoneSource: F("project", "state", sourceDerivation("006", "Asia/Dubai"), zoneSources(PF(448, 1213), BADJ("R3-8")), { planValue: "organisation", note: A8_NOTE, company: "006" }),
    timeZoneNote: F(null, "state", ZONE_NOTE_DERIVATION, [H("backend/src/utils/reporting-cutoff.js", "201-205"), H("backend/src/services/earned-value.service.js", "976-978"), BADJ("087-OTH/052/006 item 2; R3-8")], { company: "006" }),
  },
};

// ─── tree, flattening, exports ───────────────────────────────────────────────

const TREE = { WP0, CLAUDE, WP1, WP2, WP3, D2, D3 };

function isLeaf(node) {
  return node && typeof node === "object" && !Array.isArray(node) && "value" in node && "unit" in node && "derivation" in node;
}

/** Flattens the tree to [{ key, value, unit, derivation, source, assumption, planDisagrees, planValue?, today?, ref?, company?, note? }]. */
function figures() {
  const out = [];
  const walk = (node, path) => {
    if (isLeaf(node)) {
      const row = { key: path.join("."), value: node.value, unit: node.unit, derivation: node.derivation, source: node.source, assumption: node.assumption, planDisagrees: node.planDisagrees };
      for (const extra of ["planValue", "today", "ref", "company", "note"]) if (node[extra] !== undefined) row[extra] = node[extra];
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
    /** F3's file content as P6 exports it (WP1.T3.file; builders' adjudication 087-SCH/087-IMP item 5): build/files.js F3() writes and checks it. */
    F3file: F3_FILE,
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
  rules: { hoursToDays, lagHoursToDays, tenthsToDays, mspDurationDays, cpm, workingDate, evOf, qtyEv, evMetrics, endOfLocalDay, defaultPeriod, forecastPace, forecastEvFinish, deriveStatus, acLedger, acHead, futurePeriodFor, ev087PeriodsFor },
  figures,
};
