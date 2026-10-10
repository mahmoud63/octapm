"use strict";
/**
 * CERT-3 WP-0 answer book, section "field-controls".
 *
 * Scope (docs/certification/OCTAPM_CERT3_PLAN.md):
 *   - WP-0 stage-table rows stage1:86 and stage14:56 (plan :457)
 *   - WP-8 field, quality and documents (plan :832-899)
 *   - WP-9 controls and reporting (plan :901-976)
 *   - the company figures of 087-FLD (:390), 087-EXC (:391), 087-HLT (:392),
 *     087-OTH (:393) and 052-FLD (:405)
 *
 * Every figure is derived here on paper (pure arithmetic in this file; no
 * product code, database or network is touched when it is loaded). Rules are
 * restated from CLAUDE.md and from the product code as it stands at HEAD
 * 886c9f1 (read with `git show HEAD:<path>`, never from the working tree).
 *
 * Leaf shape: { value, unit, derivation, source, assumption, planDisagrees,
 *               planValue?, today?, company?, note? }
 *   value          the expected answer (what the proof must assert)
 *   today          what HEAD does now, where the plan says it differs ("today X")
 *   planValue      the plan's figure, only where this derivation disagrees
 *   assumption     true where the plan marks an assumption or a choice was made here
 *
 * Units: cents (money, INTEGER cents), percent, score (0-100), count, days
 * (calendar days), working_days, hours, man_hours, m3, ratio, date (ISO
 * YYYY-MM-DD), state (a status or an outcome), http ("<status> <CODE>"),
 * text, bool.
 *
 * Percent figures are compared at 2 dp (adjudication F2): a proof rounds the
 * measured percentage to 2 places before it compares (11/20*100 is
 * 55.00000000000001 in doubles; the figure is 55).
 *
 * A "400 VALIDATION_ERROR" figure is the request-shape contract (adjudication
 * F1): the route's express-validator chain answers before the service, through
 * middleware/validate.js, with { success: false, error: { code:
 * 'VALIDATION_ERROR', message, details: [{ field, message, location }] } }
 * (details are sent outside production). The figure's note names the field as
 * `details.field=<path>`; the proof asserts that error.details holds an entry
 * with that field, so the check stays specific.
 *
 * Owner decision in force for this section: HR-S2 (plan :30) - milestones are
 * valid zero-duration elements; M900 (duration 0) is a critical element of the
 * certified network and counts in every activity/critical total below.
 *
 * The integration owner's adjudication of the WP-0 deep-company builders
 * (2026-10-09, C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md) is
 * applied on paper: WP8.timesheet.multiplierHalf* (087-FLD item 1: the plan's
 * 0.5 crew member is served by the contract refusal), WP8.rfi.overdue* and
 * WP8.transmittal.meetingChangeEventReadBack (087-FLD item 6), and WP9.health
 * (087-EXC/HLT items 6, 7 and 8: the EV figures at the cutoff and on the card,
 * the run-date rule rules.delayedExampleDatesFor, document control 80 / 80).
 * Its round 2 (R2-B) adds two HEAD readings: WP9.export.sheetGate.today (B1,
 * the export's answer to a member denied risk:read) and
 * WP8.weather.nonContractualAddsNothing.today (B5, the truncated 12).
 * Entries added for it cite plan lines as numbered at f599e67 (PF); their
 * product citations keep the @886c9f1 tag (every product file they cite is
 * unchanged at f599e67). Changed keys: answers/CHANGES-WP0-BUILDERS.md.
 */

const PLAN = "docs/certification/OCTAPM_CERT3_PLAN.md";
const HEAD = "886c9f1";
const P = (...lines) => `${PLAN}:${lines.join(",")}`;
const H = (file, lines) => `${file}:${lines} @${HEAD}`;
/** Plan lines as numbered at product HEAD f599e67 (entries added for the builders' adjudication use this numbering). */
const PF = (...lines) => `${PLAN}:${lines.join(",")} @f599e67`;
/** The integration owner's binding adjudication of the WP-0 deep-company builders (2026-10-09). */
const BADJ = (item) => `C:/Temp/octapm-cert/scratch/wp0/builders-adjudication.md ${item}`;
/** The WP-0 answer-book adjudication (F1: VALIDATION_ERROR is the contract). */
const ADJ0 = (item) => `C:/Temp/octapm-cert/scratch/wp0/adjudication.md ${item}`;

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

// ─── pure rules (restated; each cites where it comes from) ────────────────────

/** CLAUDE.md: Quality Score = 100 - majorNCRs*20 - minorNCRs*8 - failedITPs*15; HEAD clamps to [0,100] (quality.service.js:48-51, health.js:81-83,445-447). */
function qualityScore({ major = 0, minor = 0, failedItp = 0, weights = { major: 20, minor: 8, failedItp: 15 }, clamp = true }) {
  const raw = 100 - major * weights.major - minor * weights.minor - failedItp * weights.failedItp;
  return clamp ? Math.max(0, Math.min(100, Math.round(raw))) : raw;
}

/** health.js:458-460 and workspace-dashboard.service.js:1164-1166: 100 - 100*fatalities - 20*LTIs - 5*open. */
function safetyScore({ fatalities = 0, lti = 0, open = 0 }) {
  return Math.max(0, Math.min(100, Math.round(100 - fatalities * 100 - lti * 20 - open * 5)));
}

/** health.js:85-90 (and the workspace's copy): index >= 1 -> 100, >= 0.9 -> 80, >= 0.75 -> 60, else 40. */
function scoreByIndex(index) {
  if (index >= 1) return 100;
  if (index >= 0.9) return 80;
  if (index >= 0.75) return 60;
  return 40;
}
const clampScore = (v) => Math.max(0, Math.min(100, Math.round(v)));

/** Adjudication F2: percentages are compared at 2 dp (removes the double's tail, e.g. 55.00000000000001 -> 55). */
const pct2 = (v) => Math.round(v * 100) / 100;

/** weather.service.js:161-200: allowance = weatherAllowanceDays || 20; pct = used/allowance*100; warning pct >= 70; remaining = max(allowance - used, 0). */
function weather({ allowance, contractualDays }) {
  const used = contractualDays.reduce((s, d) => s + d, 0);
  const pct = allowance > 0 ? (used / allowance) * 100 : 0;
  return { used, pct, warning: pct >= 70, remaining: Math.max(allowance - used, 0) };
}

/** daily-log.service.js:1200: delayDays = round((hoursLost / 8) * 2) / 2 (nearest half day, JS Math.round = half up). */
const promoteDays = (hours) => Math.round((hours / 8) * 2) / 2;

/** timesheet.service.js:70: overtime -> max(1, worker.overtimeMultiplier ?? 1.5); double -> 2; regular -> 1. */
const multiplierFor = (timeType, otMultiplier = 1.5) => (timeType === "overtime" ? Math.max(1, otMultiplier) : timeType === "double" ? 2 : 1);

/** timesheet.service.js:652-655: amount = round2(hours * rate * multiplier); here in integer cents. */
function labourCents(entries) {
  return entries.reduce((sum, e) => sum + Math.round(e.hours * e.rateCents * multiplierFor(e.timeType, e.otMultiplier)), 0);
}

/** _thresholds.js:43-46: critical when measured > limit * (1 + 0.1), or limit not positive; else warning. */
const overRatioSeverity = (measured, limit, ratio = 0.1) => (!(limit > 0) ? "critical" : measured > limit * (1 + ratio) ? "critical" : "warning");

const DAY_MS = 86_400_000;
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (iso, n) => isoDate(new Date(`${iso}T00:00:00.000Z`).getTime() + n * DAY_MS);

/** submittal-workflow.service.js:253-260: submitBy = requiredOnSite - leadTimeWeeks*7 - reviewDays (calendar days, UTC). */
const submitBy = ({ requiredOnSite, leadTimeWeeks, reviewDays }) => addDays(requiredOnSite, -(leadTimeWeeks * 7) - (reviewDays || 0));

/** submittal-workflow.service.js:263-269: max(0, ceil((approvedAt + leadTimeWeeks*7 days - needBy) / 1 day)). */
function submittalImpactDays({ approvedAtIso, needByIso, leadTimeWeeks }) {
  const projected = new Date(approvedAtIso).getTime() + leadTimeWeeks * 7 * DAY_MS;
  return Math.max(0, Math.ceil((projected - new Date(`${needByIso}T00:00:00.000Z`).getTime()) / DAY_MS));
}

/** Five-day calendar, exclusive finish: n working days from a Monday start. */
function addWorkingDays(iso, n) {
  let d = new Date(`${iso}T00:00:00.000Z`);
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + DAY_MS);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return isoDate(d);
}

/**
 * End of a local calendar date in a zone, as a UTC instant (the reporting cutoff,
 * utils/reporting-cutoff.js): the last millisecond before the zone's clock shows the next
 * date, found by bisection on the platform's Intl data (the same calculator as
 * answers/schedule.js rules.endOfLocalDay; restated so this file stays self-contained).
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

// The certified 14-activity network (backend/scripts/phase21/stage2-schedule.js:41-56): FS, lag 0.
const NETWORK = [
  ["A100", 5, null, "SUB"],
  ["A110", 10, "A100", "SUB"],
  ["A120", 3, "A110", "SUB"],
  ["A130", 12, "A120", "SUB"],
  ["A140", 4, "A130", "SUB"],
  ["A200", 8, "A130", "SUP"],
  ["A210", 6, "A200", "SUP"],
  ["A220", 7, "A210", "SUP"],
  ["A230", 8, "A220", "SUP"],
  ["A300", 10, "A220", "ARC"],
  ["A310", 9, "A230", "ARC"],
  ["A320", 7, "A310", "ARC"],
  ["A330", 6, "A320", "ARC"],
  ["M900", 0, "A330", "ARC"],
];

/** Forward/backward pass, finish-to-start, LF of an activity with no successor = project finish. TF = LF - EF (CLAUDE.md). */
function cpm(net) {
  const by = new Map(net.map(([code, dur, pred, wbs]) => [code, { code, dur, pred, wbs, succ: [] }]));
  for (const a of by.values()) if (a.pred) by.get(a.pred).succ.push(a.code);
  for (const [code] of net) {
    const a = by.get(code);
    a.es = a.pred ? by.get(a.pred).ef : 0;
    a.ef = a.es + a.dur;
  }
  const finish = Math.max(...[...by.values()].map((a) => a.ef));
  for (const [code] of [...net].reverse()) {
    const a = by.get(code);
    a.lf = a.succ.length ? Math.min(...a.succ.map((s) => by.get(s).lf - by.get(s).dur)) : finish;
    a.ls = a.lf - a.dur;
    a.tf = a.lf - a.ef;
  }
  return { finish, activities: by };
}

const NET = cpm(NETWORK);
const CRITICAL_CODES = [...NET.activities.values()].filter((a) => a.tf === 0).map((a) => a.code);
const wbsSummary = (wbs) => {
  const rows = NETWORK.filter((r) => r[3] === wbs);
  return { activities: rows.length, days: rows.reduce((s, r) => s + r[1], 0) };
};

// Punch transition rules at HEAD (punch.service.js:541-549).
const PUNCH_STATUSES = ["draft", "open", "ready_for_review", "closed", "in_dispute", "void"];
const PUNCH_RULES = {
  open: { from: ["draft"], reasonRequired: false },
  ready_for_review: { from: ["open"], reasonRequired: false },
  close: { from: ["ready_for_review", "open"], reasonRequired: false },
  reopen: { from: ["closed", "ready_for_review"], reasonRequired: true },
  dispute: { from: ["open", "ready_for_review"], reasonRequired: true },
  resolve_dispute: { from: ["in_dispute"], reasonRequired: false },
  void: { from: ["draft", "open", "ready_for_review", "in_dispute"], reasonRequired: true },
};
function punchTransitionTable() {
  const table = {};
  for (const [action, rule] of Object.entries(PUNCH_RULES)) {
    table[action] = {};
    for (const status of PUNCH_STATUSES) {
      if (!rule.from.includes(status)) table[action][status] = "409 PUNCH_TRANSITION_INVALID";
      else table[action][status] = rule.reasonRequired ? "ok with reason; 400 PUNCH_REASON_REQUIRED without" : "ok";
    }
  }
  return table;
}
const PUNCH_TABLE = punchTransitionTable();
const PUNCH_ILLEGAL = Object.values(PUNCH_TABLE).reduce((n, row) => n + Object.values(row).filter((v) => v.startsWith("409")).length, 0);
const PUNCH_LEGAL = Object.keys(PUNCH_RULES).length * PUNCH_STATUSES.length - PUNCH_ILLEGAL;

// ─── fixed inputs of this section ─────────────────────────────────────────────

// 087-FLD / 052-FLD quality mix (plan :390, :405, :71).
const FLD_QUALITY = { major: 2, minor: 3, failedItp: 1 };
// 087-HLT quality (plan :392): 1 major (closed), 1 minor, 1 legacy ITP failed, 1 form ITP failed.
const HLT_QUALITY = { major: 1, minor: 1, legacyFailed: 1, formFailed: 1 };
// 087-HLT EV at the cutoff (plan :392), whole currency units.
const HLT_EV = { pv: 90_000, ev: 75_000, ac: 80_000 };

// Canonical 087-FLD / 052-FLD weather record set (plan :390 "manual delays reaching exactly
// 13 and then 14 contractual days of 20, including half-days, plus one 10-day non-contractual").
const PROMOTED = [2, 6, 10].map((h) => ({ hours: h, days: promoteDays(h) }));
const MANUAL_CONTRACTUAL_TO_13 = [2.5, 7.5];
const MANUAL_CONTRACTUAL_14TH = [1.0];
const FLD_WEATHER_BELOW = weather({ allowance: 20, contractualDays: [...PROMOTED.map((p) => p.days), ...MANUAL_CONTRACTUAL_TO_13] });
const FLD_WEATHER_AT = weather({ allowance: 20, contractualDays: [...PROMOTED.map((p) => p.days), ...MANUAL_CONTRACTUAL_TO_13, ...MANUAL_CONTRACTUAL_14TH] });
// The same records under HEAD's Int column (lead: 558 driver notes "1.5 stored as 1, 0.5 as 0"; weather.service.js:217).
const trunc = (days) => days.map((d) => Math.trunc(d));
const FLD_WEATHER_BELOW_TODAY = weather({ allowance: 20, contractualDays: trunc([...PROMOTED.map((p) => p.days), ...MANUAL_CONTRACTUAL_TO_13]) });
const FLD_WEATHER_AT_TODAY = weather({ allowance: 20, contractualDays: trunc([...PROMOTED.map((p) => p.days), ...MANUAL_CONTRACTUAL_TO_13, ...MANUAL_CONTRACTUAL_14TH]) });

// Timesheet at 50.00/h (plan :845).
const RATE = 5000; // cents
const TS_MIXED = [
  { hours: 8, rateCents: RATE, timeType: "regular" },
  { hours: 2, rateCents: RATE, timeType: "overtime", otMultiplier: 1.5 },
  { hours: 1, rateCents: RATE, timeType: "double" },
];
const TS_MIXED_CENTS = labourCents(TS_MIXED);
const TS_MIXED_DOUBLE_MUTATED = TS_MIXED_CENTS - Math.round(1 * RATE * 2) + Math.round(1 * RATE * 1);
const TS_FIVE_BY_EIGHT = labourCents(Array.from({ length: 5 }, () => ({ hours: 8, rateCents: RATE, timeType: "regular" })));
const TS_FIVE_BY_SEVEN = labourCents(Array.from({ length: 5 }, () => ({ hours: 7, rateCents: RATE, timeType: "regular" })));

// Daily-log manpower mix (plan :840): [trade, workers, hours, status].
const MANPOWER = [
  ["Steelfixer", 5, 8, "approved"], // internal entries are created approved (daily-log.service.js:926)
  ["Carpenter", 3, 10, "submitted"], // party entries are created submitted (:926)
  ["Labourer", 2, 8, "rejected"],
];
const reportRows = (statuses) => MANPOWER.filter((r) => statuses.includes(r[3]));
const manHours = (rows) => rows.reduce((s, r) => s + r[1] * r[2], 0);
const workersOf = (rows) => rows.reduce((s, r) => s + r[1], 0);
const MP_COUNTED = reportRows(["approved", "submitted"]); // daily-log.service.js:1456
const MP_ALL = reportRows(["approved", "submitted", "rejected"]);

// 087-HLT health inputs.
const HLT_SPI = HLT_EV.ev / HLT_EV.pv;
const HLT_CPI = HLT_EV.ev / HLT_EV.ac;
const HLT_COS = [
  { ref: "CO1", scheduleImpact: 4, linkApprovedDays: [] },
  { ref: "CO2", scheduleImpact: 0, linkApprovedDays: [6] },
];
const healthCommercialDays = HLT_COS.reduce((s, co) => s + Math.max(0, co.scheduleImpact + co.linkApprovedDays.reduce((a, b) => a + b, 0)), 0);
const workspaceCommercialDays = HLT_COS.reduce((s, co) => s + Math.max(0, co.scheduleImpact), 0);

// 087-HLT document control - two readings (see WP9.health.docControl*).
const docHealth = ({ overdueByDueDateNotClosed, pendingSubmittals, drawings, ifc }) =>
  clampScore(100 - overdueByDueDateNotClosed * 10 - pendingSubmittals * 5 + (drawings > 0 ? ifc / drawings : 1) * 10);
const docWorkspace = ({ overdueOpenRrbFirst, overdueSubmittals, pendingSubmittals }) =>
  clampScore(100 - overdueOpenRrbFirst * 10 - overdueSubmittals * 10 - pendingSubmittals * 5);
const HLT_DOC_LITERAL = {
  health: docHealth({ overdueByDueDateNotClosed: 2, pendingSubmittals: 2, drawings: 0, ifc: 0 }),
  rule: docWorkspace({ overdueOpenRrbFirst: 1, overdueSubmittals: 0, pendingSubmittals: 2 }),
};
const HLT_DOC_PLAN_READING = {
  health: docHealth({ overdueByDueDateNotClosed: 1, pendingSubmittals: 0, drawings: 0, ifc: 0 }),
  rule: docWorkspace({ overdueOpenRrbFirst: 1, overdueSubmittals: 0, pendingSubmittals: 0 }),
};

// 087-HLT delayed activity (plan §3.2 087-HLT, :431 @f599e67: "A 50-working-day activity whose
// calendar-day and working-day finishes fall on either side of today"; past-dated, cutoff
// 2026-08-31). Settled on paper (builders' adjudication 087-EXC/HLT item 7, R3-10):
//   - the health card and the workspace date the finish as start + earlyFinish CALENDAR days
//     (health.js:349-361, workspace-dashboard.service.js:167-185) and count it delayed when that
//     instant is before now and pct < 100; HR-K2 dates it by the working-day finish, which for a
//     start on a working day is start + 70 calendar days (50 working days = 10 whole weeks,
//     exclusive finish), so "either side of today" holds for every today with
//     start + 50 <= today <= start + 69;
//   - "today" is the WP-9 proof's read, which comes after the build, so the rule takes the latest
//     Monday whose calendar finish is already past on the run date in every zone (start + 50 <=
//     run date - 1): start = the Monday on or before (run date - 51). That leaves the proof
//     run date .. start + 69, i.e. at least 13 days (run date - 51 a Sunday) and at most 19;
//   - the plan's cutoff: the activities start on or before 2026-08-31, so their loadings and
//     costs can be dated between the start and the cutoff (true for run dates up to
//     HLT_LATEST_RUN_DATE).
// The book's former fixed example (start 2026-08-10 = run date - 60, the window's midpoint, for
// run date 2026-10-09) satisfied the window on the run date but came from no stated rule and
// left the proof only until 2026-10-18; it is replaced by this rule (CHANGES-WP0-BUILDERS.md).
const HLT_CUTOFF = "2026-08-31";
const HLT_WD = 50;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const mondayOnOrBefore = (iso) => addDays(iso, -((new Date(`${iso}T00:00:00.000Z`).getUTCDay() + 6) % 7));
/** 087-HLT's H50 dates for a run date (the build's company-local date, YYYY-MM-DD). */
function delayedExampleDatesFor(runDate) {
  if (!ISO_DAY.test(String(runDate)) || Number.isNaN(Date.parse(`${runDate}T00:00:00.000Z`))) throw new Error(`delayedExampleDatesFor: run date ${runDate} is not YYYY-MM-DD`);
  const start = mondayOnOrBefore(addDays(runDate, -(HLT_WD + 1)));
  const calendarFinish = addDays(start, HLT_WD);
  const workingFinish = addWorkingDays(start, HLT_WD);
  return {
    runDate,
    start,
    calendarFinish,
    workingFinish,
    windowFrom: calendarFinish,
    windowThrough: addDays(workingFinish, -1),
    cutoff: HLT_CUTOFF,
    startOnOrBeforeCutoff: start <= HLT_CUTOFF,
  };
}
const HLT_EXAMPLE = delayedExampleDatesFor("2026-10-09");
const HLT_CAL_FINISH = HLT_EXAMPLE.calendarFinish;
const HLT_WD_FINISH = HLT_EXAMPLE.workingFinish;
/** The last run date whose start is on or before the cutoff (found by walking forward from the reference run date). */
const HLT_LATEST_RUN_DATE = (() => {
  let d = HLT_EXAMPLE.runDate;
  while (delayedExampleDatesFor(addDays(d, 1)).startOnOrBeforeCutoff) d = addDays(d, 1);
  return d;
})();
for (let d = "2026-10-01"; d <= HLT_LATEST_RUN_DATE; d = addDays(d, 1)) {
  const x = delayedExampleDatesFor(d);
  if (!(x.calendarFinish <= addDays(d, -1) && x.workingFinish > addDays(d, 12) && addWorkingDays(x.start, HLT_WD) === addDays(x.start, 70))) {
    throw new Error(`field-controls answer book: the 087-HLT rule fails for run date ${d}`);
  }
}

// 087-EXC quantity (plan :391, :918): Q1 100 m3 allocated to X10.
const Q_LIMIT = 100;
const Q_CO = 10;
const Q_FIRST = 60 + 45;
const Q_LATER = 113;

// Budget truths on each certified project (plan :912-914; backend/scripts/phase21/snapshot.js:42-51 @HEAD 886c9f1).
const T_ORIGINAL = 1_700_000;
const T_APPROVED_CHANGES = 125_000 + 4_500;
const T_ALLOCATIONS = 60_000 + 30_000 + 90_000 + 135_000 + 72_000;
const T_CONTRACT = 2_000_000;
const TRUTHS = {
  register: T_ORIGINAL + T_APPROVED_CHANGES,
  evBac: T_ALLOCATIONS + T_APPROVED_CHANGES,
  contract: T_CONTRACT + T_APPROVED_CHANGES,
};
const cents = (units) => Math.round(units * 100);

// 087-HLT EV "at the cutoff" (builders' adjudication 087-EXC/HLT item 6, R3-4). The plan's
// "PV 90,000, EV 75,000 and AC 80,000 at the cutoff" contradicts its own §3.3 ("Approvals
// carry real timestamps. A cutoff before the run date therefore sees no approval"): settled
// on paper as PV and AC at 2026-08-31, EV 0 at that cutoff, and EV 75,000 on the health
// card's default basis. Inputs: the record set the build makes (build/087-hlt.js), adopted
// here; the plan fixes only the three totals.
const HLT_ZONE = "Africa/Cairo";
const HLT_RECORDS = [
  // code, working days from the project start, BOQ allocation (approved, whole row), approved
  // cost loading dated on or before the cutoff, approved direct cost dated on or before the
  // cutoff, approved percent (stamped at the build's real time).
  { code: "H10", workingDays: 10, allocation: 60_000, loading: 60_000, cost: 50_000, pct: 100 },
  { code: "H50", workingDays: HLT_WD, allocation: 30_000, loading: 30_000, cost: 30_000, pct: 50 },
];
const HLT_CUTOFF_INSTANT = endOfLocalDay(HLT_CUTOFF, HLT_ZONE);
const HLT_PV_CUTOFF = cents(HLT_RECORDS.reduce((s, r) => s + r.loading, 0));
const HLT_AC_CUTOFF = cents(HLT_RECORDS.reduce((s, r) => s + r.cost, 0));
const HLT_EV_CUTOFF = 0; // every approval is stamped at the build's run, after HLT_CUTOFF_INSTANT
const HLT_EV_CARD = HLT_RECORDS.reduce((s, r) => s + Math.round((cents(r.allocation) * r.pct) / 100), 0);
if (HLT_PV_CUTOFF !== cents(HLT_EV.pv) || HLT_AC_CUTOFF !== cents(HLT_EV.ac) || HLT_EV_CARD !== cents(HLT_EV.ev)) {
  throw new Error("field-controls answer book: the 087-HLT record set must give the plan's PV 90,000, AC 80,000 and (card) EV 75,000");
}
if (!(HLT_RECORDS.find((r) => r.code === "H50").pct < 100)) throw new Error("field-controls answer book: H50 must stay below 100% to count as delayed");

// The project XLSX export at HEAD (builders' adjudication round 2, R2-B B1): the worksheets
// generateProjectExport adds, unconditionally and in this order (export.service.js:179, 209, 234,
// 259, 270, 316); the route's only permission check is cost:export (export.js:19).
const EXPORT_SHEETS_HEAD = ["Master Schedule", "Critical Path", "Risks", "Assumptions", "Long Lead Items", "WBS"];
const EXPORT_RISK_SHEET_HEAD = "Risks";
if (!EXPORT_SHEETS_HEAD.includes(EXPORT_RISK_SHEET_HEAD)) throw new Error("field-controls answer book: HEAD's export carries its risk sheet");

// ─── the answer tree ─────────────────────────────────────────────────────────

const WP0 = {
  "stage1:86": {
    companyCount: F(4, "count",
      "Stage 1 creates exactly 4 directory companies (client, supplier, subcontractor, consultant; stage1-foundation.js:69-74); the strengthened check asserts 4 created and 4 found by the TAG search.",
      [P(457), "backend/scripts/phase21/stage1-foundation.js:69-92"]),
    nameClient: F("${TAG} Meridian Property Group", "text", "created.name must equal the payload name; TAG = `P21-${STAMP}` (stage1-foundation.js:44-45, :70).", [P(457), "backend/scripts/phase21/stage1-foundation.js:70,86"]),
    nameSupplier: F("${TAG} Gulf Steel & Cement Supply", "text", "created.name must equal the payload name (stage1-foundation.js:71).", [P(457), "backend/scripts/phase21/stage1-foundation.js:71,86"]),
    nameSubcontractor: F("${TAG} Delta Concrete Works", "text", "created.name must equal the payload name (stage1-foundation.js:72).", [P(457), "backend/scripts/phase21/stage1-foundation.js:72,86"]),
    nameConsultant: F("${TAG} Aziz Consulting Engineers", "text", "created.name must equal the payload name (stage1-foundation.js:73).", [P(457), "backend/scripts/phase21/stage1-foundation.js:73,86"]),
    companyType: F("external", "state", "All 4 payloads carry type 'external' (stage1-foundation.js:70-73); each created record must read back type 'external'.", [P(457), "backend/scripts/phase21/stage1-foundation.js:70-73"]),
    directorySameIds: F(true, "bool",
      "set(ctx.companies[*].id) === set(directory.items filtered by name.startsWith(TAG)).id; both sets have 4 members (today :86 checks only Boolean(created.id) and :92 only the count).",
      [P(457), "backend/scripts/phase21/stage1-foundation.js:86,90-92"]),
  },
  "stage14:56": {
    locationCode: F("${ctx.stamp}-GRID-AD", "text", "The location is found or created with code `${ctx.stamp}-GRID-AD` (stage14-rfi.js:46,50); the strengthened check asserts location.code equals it (today :56 checks only Boolean(location.id)).", [P(457), "backend/scripts/phase21/stage14-rfi.js:46,50,56"]),
    locationKind: F("zone", "state", "Created with kind 'zone' (stage14-rfi.js:51); location.kind must read 'zone'.", [P(457), "backend/scripts/phase21/stage14-rfi.js:51"]),
    rfiPointsToLocation: F(true, "bool", "The RFI is raised with locationId = location.id (stage14-rfi.js:76) and read back: cur.locationId === location.id (:93).", [P(457), "backend/scripts/phase21/stage14-rfi.js:76,93"]),
  },
};

const C_FLD = "087-FLD";
const C_052 = "052-FLD";
const C_EXC = "087-EXC";
const C_HLT = "087-HLT";
const C_OTH = "087-OTH";

const WP8 = {
  dailyLog: {
    promote2h: F(PROMOTED[0].days, "days", "round((2/8)*2)/2 = round(0.5)/2 = 1/2 = 0.5", [P(838), H("backend/src/services/daily-log.service.js", "1200")], { company: C_FLD }),
    promote6h: F(PROMOTED[1].days, "days", "round((6/8)*2)/2 = round(1.5)/2 = 2/2 = 1.0", [P(838), H("backend/src/services/daily-log.service.js", "1200")], { company: C_FLD }),
    promote10h: F(PROMOTED[2].days, "days", "round((10/8)*2)/2 = round(2.5)/2 = 3/2 = 1.5", [P(838), H("backend/src/services/daily-log.service.js", "1200")], { company: C_FLD }),
    promoteResponseVsStored: F("response 0.5 / 1.0 / 1.5", "state",
      "The promotion answer echoes the computed delayDays (daily-log.service.js:1216) while the WeatherDelay row stores Number(delayDays) into an Int column (weather.service.js:217); the read-back of the register row is the figure that must equal 0.5/1.0/1.5 (today 0/1/1 per the 558 driver notes) -> HR-C11.",
      [P(838, 887, 1039), H("backend/src/services/weather.service.js", "217"), H("backend/src/services/daily-log.service.js", "1200-1216")], { assumption: true, today: "stored 0 / 1 / 1", company: C_FLD }),
    promoteTwice: F("409 DAILY_LOG_WEATHER_DELAY_EXISTS", "http", "A delay entry that already carries weatherDelayId is refused.", [P(838), H("backend/src/services/daily-log.service.js", "1198")], { company: C_FLD }),
    approvedDayPatch: F("409 DAILY_LOG_APPROVED", "http", "PATCH of an approved day: updateLog calls assertEditable, which refuses an approved log.", [P(839), H("backend/src/services/daily-log.service.js", "657-661,684-689")], { company: C_FLD }),
    approvedDayEntryAdd: F("409 DAILY_LOG_APPROVED", "http", "Entry add on an approved day: addEntry calls the same guard.", [P(839), H("backend/src/services/daily-log.service.js", "659,910-921")], { company: C_FLD }),
    approvedDayEntryDelete: F("409 DAILY_LOG_APPROVED", "http", "Entry delete on an approved day: deleteEntry calls the same guard.", [P(839), H("backend/src/services/daily-log.service.js", "659,1011-1017")], { company: C_FLD }),
    manpowerSteelfixer: F(5 * 8, "man_hours", "Internal entry 5 workers x 8 h = 40 (status approved, counted).", [P(840), H("backend/src/services/daily-log.service.js", "926,1456,1470")], { company: C_FLD }),
    manpowerCarpenter: F(3 * 10, "man_hours", "Party entry 3 workers x 10 h = 30 (status submitted, counted).", [P(840), H("backend/src/services/daily-log.service.js", "926,1456,1470")], { company: C_FLD }),
    manpowerLabourer: F("absent", "state", "The 2 x 8 Labourer entry is rejected; the report reads status in [approved, submitted] only, so no Labourer row exists.", [P(840), H("backend/src/services/daily-log.service.js", "1456")], { company: C_FLD }),
    manpowerTotal: F(manHours(MP_COUNTED), "man_hours", "40 + 30 = 70 (rejected 16 excluded).", [P(840), H("backend/src/services/daily-log.service.js", "1485")], { company: C_FLD }),
    manpowerWorkers: F(workersOf(MP_COUNTED), "count", "5 + 3 = 8 workers (rejected 2 excluded). The day's own totals use the same filter (counted = not rejected, not draft; :521, :544-545).", [P(840), H("backend/src/services/daily-log.service.js", "521,544-545,1485")], { company: C_FLD }),
    partyLock: F("409 DAILY_LOG_SUBMITTED", "http", "A party viewer writing to a submitted day (assertEditable, reached from updateLog / addEntry / updateEntry / deleteEntry).", [P(841), H("backend/src/services/daily-log.service.js", "660,689,921,982,1017")], { company: C_FLD }),
    rejectWithoutReason: F("400 DAILY_LOG_REASON_REQUIRED", "http", "Entry review with decision reject and no reason.", [P(841), H("backend/src/services/daily-log.service.js", "1036")], { company: C_FLD }),
    weekSummaryA130: F(5 * 8, "hours", "Timesheet week summary, activity row A130: 5 workers x 8 h regular = 40 h (weekSummary sums entry hours per activity; timesheet.service.js:736-772).", [P(842), H("backend/src/services/timesheet.service.js", "736-772")], { company: C_FLD }),
    manpowerReportA130: F(5 * 8, "man_hours",
      "Manpower report for A130 (groupBy activity) = the internal Steelfixer row 5 x 8 = 40. Agreement at 40 needs the party Carpenter entry on another activity (else A130 reads 70).",
      [P(842), H("backend/src/services/daily-log.service.js", "1465-1486")], { assumption: true, company: C_FLD }),
    approveFromOpen: F("approved (recorded)", "state", "approveLog has no submitted-status check: an open day approves (200); recorded, the rule is HR-F4.", [P(843, 888, 1021), H("backend/src/services/daily-log.service.js", "790-812")], { today: "200 approved", company: C_FLD }),
  },
  weather: {
    allowance: F(20, "days", "087-FLD sets weatherAllowanceDays 20 explicitly; allowance = Number(weatherAllowanceDays) || 20.", [P(390, 802), H("backend/src/services/weather.service.js", "161")], { company: C_FLD }),
    recordSet: F("promoted 0.5 + 1.0 + 1.5; manual contractual 2.5 + 7.5; then manual 1.0; non-contractual 10", "text",
      "One record set that hits exactly 13 and then 14 contractual days including half-days. Any set summing to 13.0 / 14.0 is equally valid.",
      [P(390)], { assumption: true, company: C_FLD }),
    belowContractualUsed: F(FLD_WEATHER_BELOW.used, "days", "0.5 + 1.0 + 1.5 + 2.5 + 7.5 = 13.0", [P(390, 815)], { company: C_FLD }),
    belowConsumedPct: F(pct2(FLD_WEATHER_BELOW.pct), "percent", "13 / 20 x 100 = 65 (compared at 2 dp, F2)",[P(70, 390, 815), H("backend/src/services/weather.service.js", "167")], { company: C_FLD }),
    belowWarning: F(FLD_WEATHER_BELOW.warning, "bool", "65 >= 70 is false", [P(815), H("backend/src/services/weather.service.js", "200")], { company: C_FLD }),
    belowRemaining: F(FLD_WEATHER_BELOW.remaining, "days", "max(20 - 13, 0) = 7", [P(815), H("backend/src/services/weather.service.js", "198")], { company: C_FLD }),
    atContractualUsed: F(FLD_WEATHER_AT.used, "days", "13.0 + 1.0 = 14.0", [P(390, 815)], { company: C_FLD }),
    atConsumedPct: F(pct2(FLD_WEATHER_AT.pct), "percent", "14 / 20 x 100 = 70 (in IEEE doubles (14/20)*100 is exactly 70; compared at 2 dp, F2)",[P(70, 390, 815), H("backend/src/services/weather.service.js", "167")], { company: C_FLD }),
    atWarning: F(FLD_WEATHER_AT.warning, "bool", "70 >= 70 is true", [P(815), H("backend/src/services/weather.service.js", "200")], { company: C_FLD }),
    atRemaining: F(FLD_WEATHER_AT.remaining, "days", "max(20 - 14, 0) = 6", [P(815), H("backend/src/services/weather.service.js", "198")], { company: C_FLD }),
    nonContractualAddsNothing: F(FLD_WEATHER_AT.used, "days",
      `A contractual:false 10-day delay is skipped in contractualUsed: still 14.0 after it is added. Today ${FLD_WEATHER_AT_TODAY.used} (HR-C11): every row goes to the Int column WeatherDelay.delayDays (weather.service.js:217) and is stored truncated, so the contractual rows read trunc(0.5, 1.0, 1.5, 2.5, 7.5, 1.0) = 0 + 1 + 1 + 2 + 7 + 1 = ${FLD_WEATHER_AT_TODAY.used} (WP8.weather.todayAt: ${FLD_WEATHER_AT_TODAY.used} / 20 = ${pct2(FLD_WEATHER_AT_TODAY.pct)}%), and the non-contractual 10 adds nothing to that either (weather.service.js:162-165 skips contractual false): still ${FLD_WEATHER_AT_TODAY.used} after it is added. The non-contractual invariance holds at HEAD; only the figure it holds at is HR-C11's.`,
      [P(390, 819), H("backend/src/services/weather.service.js", "162-165,217"), PF(429, 444, 858, 867, 1078), BADJ("Round 2 R2-B (B5)")],
      { company: C_FLD, today: FLD_WEATHER_AT_TODAY.used, note: `HR-C11 known answer (truncation): observed by the round-1 builds at the 14 point (087-FLD weather.at14: 12, 60%). 052-FLD runs the same record set (plan :444 @f599e67; WP8["052-FLD"].weather* use FLD_WEATHER_*), and the book carries no separate 052-FLD non-contractual figure, so this leaf (value ${FLD_WEATHER_AT.used}, today ${FLD_WEATHER_AT_TODAY.used}) is the one both builders judge against.` }),
    monthlyNonContractual: F(10, "days", "The monthly split books the 10 days under nonContractual of its month.", [P(390, 819), H("backend/src/services/weather.service.js", "178-182")], { assumption: true, company: C_FLD, note: "assumes no other non-contractual delay in that month" }),
    todayBelow: F(pct2(FLD_WEATHER_BELOW_TODAY.pct), "percent",
      "The same records under the Int column: trunc(0.5,1.0,1.5,2.5,7.5) = 0+1+1+2+7 = 11 -> 11/20 x 100 = 55%, no warning (the double is 55.00000000000001; compared at 2 dp the figure is 55, F2). The proof is red at 13 until HR-C11 is decided.",
      [P(70, 820, 828, 1039), H("backend/src/services/weather.service.js", "217")], { assumption: true, company: C_FLD, note: "truncation taken from the 558 driver notes, not executed here" }),
    todayAt: F(pct2(FLD_WEATHER_AT_TODAY.pct), "percent", "11 + 1 = 12 -> 60% (compared at 2 dp, F2), warning false (red at the 70% line until HR-C11).", [P(70, 828, 1039), H("backend/src/services/weather.service.js", "217")], { assumption: true, company: C_FLD }),
  },
  timesheet: {
    mixedDay: F(TS_MIXED_CENTS, "cents",
      "8 h x 50.00 x 1 = 400.00; 2 h x 50.00 x 1.5 (default overtime multiplier) = 150.00; 1 h x 50.00 x 2 (double) = 100.00; 400 + 150 + 100 = 650.00",
      [P(405, 845), H("backend/src/services/timesheet.service.js", "70,652-655")], { company: C_FLD }),
    mixedDayLedger: F("costType labour, sourceType timesheet", "state", "Approval posts each entry through the cost ledger with sourceType 'timesheet' and costType 'labour'.", [P(845), H("backend/src/services/timesheet.service.js", "669-686")], { company: C_FLD }),
    multiplierHalf: F(2 * RATE * multiplierFor("overtime", 0.5), "cents",
      "2 h overtime at 50.00 with multiplier 0.5: max(1, 0.5) = 1 -> 2 x 50.00 x 1 = 100.00 (the floor; unfloored it would be 50.00). Plan WP-8: 'A multiplier of 0.5 gives 100.00 for 2 h of overtime' (:885 @f599e67). NOT on a built crew: no 0.5 worker can be created through the API (multiplierHalfCreate: 400 VALIDATION_ERROR; multiplierHalfImport: 200 with the row in errors[]; adjudication F1), so 087-FLD holds none and this figure is checked in process, against the service's exported rule multiplierFor('overtime', { overtimeMultiplier: 0.5 }) = 1 (timesheet.service.js:70) and the amount round2(hours x rate x multiplier) (:652-655), never read off a built timesheet.",
      [P(390, 846), PF(429, 885), H("backend/src/services/timesheet.service.js", "70,652-655"), ADJ0("F1"), BADJ("087-FLD item 1")], { assumption: true, company: C_FLD, note: "rate 50.00 assumed for that worker; the plan gives only the result. In process only (builders' adjudication 087-FLD item 1)." }),
    multiplierHalfCreate: F("400 VALIDATION_ERROR", "http",
      "POST /workers (and PATCH /workers/:workerId) with overtimeMultiplier 0.5: the route's workerValidators chain body('overtimeMultiplier').isFloat({ min: 1, max: 5 }) refuses it before the service (validate: message 'Validation failed', error.details holds field 'overtimeMultiplier'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); the service's own WORKER_MULTIPLIER_INVALID (:194) is not reached through these routes. So a 0.5 crew member cannot be built through the API (the import refuses the row too: multiplierHalfImport). The plan's 'one of them 0.5' crew member (087-FLD row) is SERVED BY THIS CONTRACT REFUSAL (builders' adjudication 087-FLD item 1): the build step that tries it is DONE, not BLOCKED, when it observes 400 VALIDATION_ERROR with an error.details entry whose field is 'overtimeMultiplier' and no worker created; MOMENT-MAP records the plan item as served by the refusal. The 100.00 figure (multiplierHalf) is checked in process.",
      [P(390, 846, 99), PF(429), H("backend/src/routes/timesheets.js", "32,64,66"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/timesheet.service.js", "193-194"), ADJ0("F1"), BADJ("087-FLD item 1")], { planValue: "a crew member with multiplier 0.5 built by the driver (plan :390; :429 @f599e67)", company: C_FLD, note: "details.field=overtimeMultiplier. Plan item served by the contract refusal (builders' adjudication 087-FLD item 1): the plan's 0.5 crew member does not exist on 087-FLD, by contract." }),
    multiplierHalfImport: F({ status: 200, created: 0, updated: 0, skipped: 0, errors: [{ row: 1, message: "The overtime multiplier must be between 1 and 5" }] }, "state",
      "POST /workers/import with one row { name, hourlyRate 50, overtimeMultiplier 0.5 }: the import route validates only rows / rows.*.userId / rows.*.companyId, so the request is accepted (200); normalizeWorker refuses the row (WORKER_MULTIPLIER_INVALID) and importWorkers records the refusal's own message against the 1-based row number; no worker is created (adjudication F1: 200 with the row in errors[], the message asserted). Part of the contract refusal that serves the plan's 0.5 crew member (builders' adjudication 087-FLD item 1).",
      [P(390, 846), PF(429), H("backend/src/routes/timesheets.js", "65"), H("backend/src/services/timesheet.service.js", "191,194,282-313"), ADJ0("F1"), BADJ("087-FLD item 1")], { company: C_FLD, note: "the row carries a name (else WORKER_NAME_REQUIRED's message comes first, :191)" }),
    reopenTwoThousand: F(TS_FIVE_BY_EIGHT, "cents", "The sheet: 5 workers x 8 h x 50.00 = 2,000.00 (stage 13 shape).", [P(847), "backend/scripts/phase21/stage13-labour.js:30-35"], { company: C_FLD }),
    reopenMirrorCount: F(5, "count", "reopen -> costLedger.reverse writes one negative mirror per un-reversed entry: 5 entries -> 5 mirrors.", [P(847), H("backend/src/services/cost-ledger.service.js", "386-428"), H("backend/src/services/timesheet.service.js", "716-731")], { company: C_FLD }),
    reopenMirrorSum: F(-TS_FIVE_BY_EIGHT, "cents", "5 x -400.00 = -2,000.00, exactly the posting.", [P(847), H("backend/src/services/cost-ledger.service.js", "411")], { company: C_FLD }),
    reopenNet: F(0, "cents", "2,000.00 - 2,000.00 = 0.00 after reopen.", [P(847)], { company: C_FLD }),
    reapprovedNet: F(TS_FIVE_BY_EIGHT, "cents", "Re-approval re-posts under a new key because the old one was reversed: 2,000 - 2,000 + 2,000 = 2,000.00 (one posting in force, not two).", [P(847), H("backend/src/services/cost-ledger.service.js", "318-330")], { company: C_FLD }),
    reapprovedEntryCount: F(15, "count", "5 originals + 5 mirrors + 5 re-posts = 15 ledger rows for the sheet (history kept).", [P(847), H("backend/src/services/cost-ledger.service.js", "312-330,399-418")], { assumption: true, company: C_FLD }),
    rejectEditApprove: F(TS_FIVE_BY_SEVEN, "cents",
      "Rejected (nothing posted), edited to 5 workers x 7 h, resubmitted, approved: 35 h x 50.00 = 1,750.00. The plan states only the total; any edit that leaves 35 regular hours at 50.00 gives it.",
      [P(848), H("backend/src/services/timesheet.service.js", "573,589-604,699-713")], { assumption: true, company: C_FLD }),
    rejectWithoutReason: F("400 VALIDATION_ERROR", "http",
      "Return (POST /:timesheetId/reject) without a reason: the route chain body('reason').isString().trim().isLength({ min: 1, max: 1000 }) refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); the service's TIMESHEET_REASON_REQUIRED (:703) is not reached through the route.",
      [H("backend/src/routes/timesheets.js", "98"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/timesheet.service.js", "703")], { company: C_FLD, note: "details.field=reason" }),
    hours25SingleEntry: F("400 VALIDATION_ERROR", "http",
      "One entry of 25 h on POST / (or PATCH /:timesheetId): the route's entryValidators chain body('entries.*.hours').isFloat({ min: 0, max: 24 }) refuses it before the service (validate: 'Validation failed'; express-validator 7 names a wildcard path with its index, so a one-entry sheet reports field 'entries[0].hours'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); the service's TIMESHEET_ENTRY_HOURS (:485) is not reached through the route.",
      [P(849), H("backend/src/routes/timesheets.js", "56,92,94"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/timesheet.service.js", "485")], { company: C_FLD, note: "details.field=entries[0].hours (entries[i].hours for the i-th entry)" }),
    hours25SplitEntries: F("400 TIMESHEET_HOURS_EXCEEDED", "http", "Two entries for one worker, 16 h + 9 h = 25 h > 24 (per sheet only; HR-F5).", [P(849, 1022), H("backend/src/services/timesheet.service.js", "486-487")], { assumption: true, company: C_FLD }),
    crewPrefillEntries: F(3, "count", "A crew of 3 with no entries is pre-filled one regular entry per member.", [P(849), H("backend/src/services/timesheet.service.js", "551")], { company: C_FLD }),
    crewPrefillHours: F(3 * 8, "hours", "3 entries x defaultHours 8 = 24 h regular.", [P(849), H("backend/src/services/timesheet.service.js", "551")], { company: C_FLD }),
    sameCrewSameDate: F("409 TIMESHEET_EXISTS", "http", "A second sheet for the same crew and date.", [P(849), H("backend/src/services/timesheet.service.js", "547-548")], { company: C_FLD }),
    rateChangeRecorded: F(8 * 6000, "cents",
      "Recorded only: the rate is read at approval (entry.rate ?? worker.hourlyRate). 8 h submitted at 50.00, rate changed to 60.00 before approval -> 480.00 posted; HR-F5 would take the submission rate (400.00).",
      [P(850, 1022), H("backend/src/services/timesheet.service.js", "652-654")], { assumption: true, company: C_FLD }),
  },
  quality: {
    inputs087FLD: F("major 2, minor 3, legacy ITP failed 1 (waived 1, passed 1 not counted); form ITPs not counted", "text",
      "NCR states are only open / submitted / closed (no archive or void), so all 5 NCRs count in any state. The pending/failed/voided/retroactive holds on 087-FLD are form-ITP hold points (WP-2), which do not count (HR-Q3 undecided).",
      [P(390, 1009), H("backend/src/services/ncr.service.js", "34-38"), H("backend/src/services/quality.service.js", "37-45")], { assumption: true, company: C_FLD }),
    dashboard087FLD: F(qualityScore(FLD_QUALITY), "score", "100 - 2x20 - 3x8 - 1x15 = 100 - 40 - 24 - 15 = 21", [P(71, 390, 852), H("backend/src/services/quality.service.js", "43-51")], { company: C_FLD }),
    health087FLD: F(qualityScore(FLD_QUALITY), "score", "Same inputs on the project health card (no archive filter needed: NCRs cannot be archived): 21", [P(852), H("backend/src/routes/health.js", "442-447")], { company: C_FLD }),
    workspace087FLD: F(qualityScore(FLD_QUALITY), "score", "Same inputs on the workspace dashboard: 21", [P(852), H("backend/src/services/workspace-dashboard.service.js", "1142-1153")], { company: C_FLD }),
    sixMajor: F(qualityScore({ major: 6 }), "score", "100 - 6x20 = -20, clamped to 0", [P(71, 852), H("backend/src/services/quality.service.js", "48-51")], { assumption: true, company: C_FLD, note: "the 6-major variant holds only 6 major NCRs (no minor, no failed ITP), as the clamp mutation's -20 implies" }),
    closeMajorLeaves: F(qualityScore(FLD_QUALITY), "score", "Closed NCRs keep counting (HR-Q4 keeps the literal rule): still 21 after a major NCR is closed.", [P(852, 1010), "backend/scripts/phase21/stage16-quality.js:177-179"], { company: C_FLD }),
    severityDowngradeProbe: F(qualityScore({ major: 1, minor: 4, failedItp: 1 }), "score", "Recorded probe: a closed major edited to minor -> 100 - 20 - 4x8 - 15 = 33 (HR-Q5).", [P(854, 1011)], { company: C_FLD }),
    legacyItpFailedToPassedProbe: F(qualityScore({ major: 2, minor: 3, failedItp: 0 }), "score", "Recorded probe: the failed legacy ITP PATCHed to passed -> 100 - 40 - 24 = 36 (+15; itp.service.js:120 takes any status, HR-Q4).", [P(854, 1010), H("backend/src/services/itp.service.js", "120-138")], { company: C_FLD }),
    formItpFailureNotCounted: F(qualityScore(FLD_QUALITY), "score", "A failed form-ITP instance on 087-FLD leaves 21 (only ItpRecord.status 'failed' is read). If HR-Q3 is approved, each failed form instance would take 15 more.", [P(71, 1009), H("backend/src/services/quality.service.js", "21-23,45")], { company: C_FLD }),
    ncrRejectWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST /:ncrId/reject (or /disapprove) without a reason: rejectNcrValidators body('reason').isString().trim().notEmpty() refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); rejectNcr's APPROVAL_WORKFLOW_REASON_REQUIRED (:628) is not reached through the route.",
      [P(853), H("backend/src/routes/ncr.js", "185-188,192,199"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/ncr.service.js", "624-631")], { company: C_FLD, note: "details.field=reason" }),
    ncrRejectNotSubmitted: F("409 NCR_NOT_READY_FOR_REJECTION", "http", "Only a submitted closeout can be rejected.", [P(853), H("backend/src/services/ncr.service.js", "643-649")], { company: C_FLD, note: "sent with a reason (without one the route's 400 VALIDATION_ERROR answers first)" }),
    ncrReopenWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST /:ncrId/reopen without a reason: the route chain body('reason').isString().trim().notEmpty() refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); reopenNcr's NCR_REOPEN_REASON_REQUIRED (:708) is not reached through the route.",
      [P(853), H("backend/src/routes/ncr.js", "250-252"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/ncr.service.js", "706-710")], { company: C_FLD, note: "details.field=reason" }),
    ncrReopenNotClosed: F("409 NCR_NOT_READY_FOR_REOPEN", "http", "Only a closed NCR can be reopened.", [P(853), H("backend/src/services/ncr.service.js", "722-728")], { company: C_FLD, note: "sent with a reason (without one the route's 400 VALIDATION_ERROR answers first)" }),
    ncrApproveNotSubmitted: F("409 NCR_NOT_READY_FOR_APPROVAL", "http", "Only a submitted closeout can be approved.", [H("backend/src/services/ncr.service.js", "565-571")], { company: C_FLD }),
    ncrCloseNotOpen: F("409 NCR_NOT_READY_FOR_CLOSEOUT", "http", "Only an open NCR can be submitted for closeout.", [H("backend/src/services/ncr.service.js", "458-464")], { company: C_FLD }),
    // Quality probes recorded as observations (adjudication F6; plan :854): the
    // recommendation is the value, HEAD's behaviour is `today`; no figure is invented.
    evidenceWipedBeforeApprovalProbe: F({ status: null, code: null, rule: "HR-Q5 recommendation: approval re-checks evidence, so a closeout whose evidence was removed after submit is not approved; the refusing step and code are chosen by the fix" }, "state",
      "Observation: an NCR closeout submitted with one evidence attachment, the attachment then removed, then approved. approveNcr checks only that the NCR is submitted; the evidence count is checked at submit (assertCloseoutRequirements), not at approval.",
      [P(854, 891, 1011), H("backend/src/services/ncr.service.js", "40,79-84,115-129,547-571")], { assumption: true, today: "200 approved (no evidence re-check)", company: C_FLD, note: "observation (recorded, not gating); HR-Q5 undecided" }),
    textOnlyEvidenceProbe: F({ status: null, code: null, rule: "HR-X1 (decided, plan §0.1): evidence moves to canonical OctaPM document references, coordinated with the clients and without abruptly breaking mobile; a ref that names no stored project document stops counting under that change; the refusing step, code and timing are the fix's" }, "state",
      "Observation: an NCR closeout submitted with one attachment ref carrying only a fileName (or only a URL), no stored project document. normalizeAttachmentRefs keeps any entry with a fileUrl, storageKey or fileName, and that count satisfies the closeout's evidence requirement.",
      [P(854, 891, 1012), H("backend/src/services/workflow-support.service.js", "406-423"), H("backend/src/services/ncr.service.js", "69-77,115-129")], { assumption: true, today: "200 submitted (the text-only ref counts as evidence)", company: C_FLD, note: "observation (recorded, not gating)" }),
    hardDeleteProbe: F("archived, not deleted: the row reads back with archivedAt set and is excluded from the score", "state",
      "Observation (HR-Q4 recommendation: delete becomes archive; archived and void records are excluded). Today DELETE /ncr/:ncrId and DELETE /itp/:itpId remove the row (200 { deleted: true }). Run on throwaway records, not on 087-FLD's scored set: under either reading a deleted major NCR moves the score by +20 and a deleted failed ITP by +15, so the check reads the row back rather than the score.",
      [P(854, 891, 1010), H("backend/src/services/ncr.service.js", "775-787"), H("backend/src/services/itp.service.js", "193-205"), H("backend/src/routes/ncr.js", "267-279")], { assumption: true, today: "200 { deleted: true }; the row is gone (hard delete)", company: C_FLD, note: "observation (recorded, not gating); HR-Q4 undecided" }),
  },
  punch: {
    mix: F("punch: draft 2, open 2, ready_for_review 1, in_dispute 1, closed 1, void 1; observations: one per type (5), safety open + environmental draft, the other 3 closed or void", "text",
      "A mix that gives the plan's 6 and 2; one item per state would give 4 open defects.",
      [P(390, 857), H("backend/src/services/punch.service.js", "31-42,53")], { assumption: true, company: C_FLD }),
    openDefects: F(2 + 2 + 1 + 1, "count", "Quality dashboard counts punch (kind != observation) whose status is not closed/void: draft 2 + open 2 + ready 1 + dispute 1 = 6 (drafts counted).", [P(857), H("backend/src/services/quality.service.js", "27-31,53-55,64-65")], { assumption: true, company: C_FLD }),
    openDefectsWithoutDrafts: F(2 + 1 + 1, "count", "The same mix without drafts: 4 - the figure that proves drafts are counted.", [P(857)], { assumption: true, company: C_FLD }),
    openObservations: F(2, "count", "Observations not closed/void: safety (open) + environmental (draft) = 2.", [P(857), H("backend/src/services/quality.service.js", "56-58")], { assumption: true, company: C_FLD }),
    safetyObservationsOpen: F(1, "count", "observationsByType.safety = 1 in this mix.", [H("backend/src/services/quality.service.js", "59-63,85")], { assumption: true, company: C_FLD }),
    closeByNonApprover: F("403 PUNCH_FINAL_APPROVER_ONLY", "http", "close by anyone other than finalApproverUserId.", [P(856), H("backend/src/services/punch.service.js", "562-564")], { company: C_FLD }),
    finalApproverBypass: F("200 (recorded)", "state", "Recorded: PATCH finalApproverUserId to oneself on an open item is accepted (only closed/void are locked), and the close then succeeds; HR-F3 would refuse the PATCH.", [P(856, 892, 1020), H("backend/src/services/punch.service.js", "339,497-498")], { today: "200, then close 200", company: C_FLD }),
    transitionTable: F(PUNCH_TABLE, "state", "7 actions x 6 statuses from TRANSITION_RULES; every pair outside rule.from answers 409 before the reason check.", [P(858), H("backend/src/services/punch.service.js", "541-561")], { company: C_FLD }),
    illegalTransitions: F(PUNCH_ILLEGAL, "count", "42 pairs - 13 legal (open 1, ready 1, close 2, reopen 2, dispute 2, resolve 1, void 4) = 29 answering 409 PUNCH_TRANSITION_INVALID.", [P(858), H("backend/src/services/punch.service.js", "541-559")], { company: C_FLD }),
    legalTransitions: F(PUNCH_LEGAL, "count", "1 + 1 + 2 + 2 + 2 + 1 + 4 = 13; reopen, dispute and void without a reason answer 400 PUNCH_REASON_REQUIRED.", [P(858), H("backend/src/services/punch.service.js", "541-561")], { company: C_FLD }),
  },
  safety: {
    inputs: F("open near_miss; closed LTI (lost days > 0); archived near_miss (archive sets status 'archived' and archivedAt)", "text", "087-FLD safety set.", [P(390), H("backend/src/services/safety.service.js", "847-852")], { company: C_FLD }),
    health: F(safetyScore({ lti: 1, open: 1 }), "score",
      "Expected (archived excluded): 100 - 20x1 LTI - 5x1 open = 75. Today health.js counts status != 'closed' as open, so the archived near miss counts: 100 - 20 - 5x2 = 70.",
      [P(860, 893, 1076), H("backend/src/routes/health.js", "449-460")], { today: safetyScore({ lti: 1, open: 2 }), company: C_FLD }),
    workspace: F(safetyScore({ lti: 1, open: 1 }), "score", "Workspace reads archivedAt: null and isOpenStatus (closed set closed/complete/completed/paid): LTI 1, open 1 -> 75.", [P(860), H("backend/src/services/workspace-dashboard.service.js", "830,1155-1166")], { company: C_FLD }),
    dashboardIncidents: F(2, "count", "Quality dashboard filters status archived/void: open near miss + closed LTI = 2.", [P(860), H("backend/src/services/quality.service.js", "37-42,81")], { company: C_FLD }),
    dashboardOpen: F(1, "count", "Of those 2, status != closed: the open near miss = 1.", [P(860), H("backend/src/services/quality.service.js", "82")], { company: C_FLD }),
    fatality: F(safetyScore({ fatalities: 1, lti: 1, open: 1 }), "score", "Any fatality: 100 - 100 - ... <= 0, clamped to 0.", [P(861), H("backend/src/routes/health.js", "458-460")], { company: C_FLD }),
    ltiEditAfterClosure: F("200 (recorded)", "state", "Recorded: incidentType/lostDays stay editable after closure (HR-Q5).", [P(862, 891, 1011)], { today: "200", company: C_FLD }),
  },
  rfi: {
    officialResponseAfterClose: F("409 RFI_ALREADY_CLOSED", "http",
      "Expected: rewriting the official response of a closed RFI is refused. Today updateResponse has no status check and writes rfi.response (200). The code name is assumed from the sibling guards (:284, :377).",
      [P(864, 894, 1074), H("backend/src/services/rfi-workflow.service.js", "284,324-333,377")], { assumption: true, today: "200", company: C_FLD }),
    reopenRevision: F("+1", "state", "reopenRfi passes bumpRevision when the RFI was not a draft -> revision = revision + 1 (e.g. 0 -> 1).", [P(865), H("backend/src/services/rfi.service.js", "70-71,893-894")], { company: C_FLD }),
    reopenWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST /:rfiId/reopen without a reason: the route chain body('reason').isString().trim().notEmpty() refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); reopenRfi's requireDecisionText (RFI_REOPEN_REASON_REQUIRED, :875) is not reached through the route.",
      [H("backend/src/routes/rfi.js", "435-437"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/rfi.service.js", "873-877")], { company: C_FLD, note: "details.field=reason" }),
    scheduleImpactLink: F(3, "days", "On close, an RFI with scheduleImpactFlag and scheduleImpact 3 upserts a workflow activity link relationType 'schedule_impact' with scheduleImpactDays 3.", [P(867), H("backend/src/services/rfi.service.js", "703-705"), H("backend/src/services/rfi-workflow.service.js", "415-426")], { company: C_FLD }),
    overdueRecords: F("RFI-RRB: open, responseRequiredBy past, dueDate null; RFI-ANS: answered, dueDate past, responseRequiredBy null", "text",
      "The two overdue-basis records of 087-FLD. 'dueDate null' is a fact of the STORED row (the Rfi.dueDate column), not of the API: every RFI answer the API gives is enriched with dueDate = dueDateForRecord(row) = row.dueDate || row.responseRequiredBy || row.targetCloseBy || row.inspectionDate (workflow-support.service.js:840-845, applied at :955 and :1103-1107 by attachWorkflowDetailsToRecords, which listRfis, createRfi and updateRfi call: rfi.service.js:317, :476, :717; and the workflow detail: rfi-workflow.service.js:239). So GET /rfi/:id and the list show RFI-RRB with dueDate = its responseRequiredBy (overdueApiDueDate). The null column is read from the stored row in process, read only (overdueStoredDueDate), which is the basis the health card reads (prisma.rfi.findMany, health.js:174, :462-465). Builders' adjudication 087-FLD item 6.",
      [P(390, 866), PF(429), H("backend/src/services/workflow-support.service.js", "840-845,955,1103-1107"), H("backend/src/services/rfi.service.js", "317,476,717"), H("backend/src/services/rfi-workflow.service.js", "239"), H("backend/src/routes/health.js", "174,462-465"), BADJ("087-FLD item 6")], { assumption: true, company: C_FLD }),
    overdueApiDueDate: F({ "RFI-RRB": "its responseRequiredBy (the dueDate column is null)", "RFI-ANS": "its dueDate" }, "state",
      "What the API presents as dueDate (GET /rfi/:id, the list, and the create / update answers): dueDateForRecord(row) = dueDate || responseRequiredBy || ... (workflow-support.service.js:840-845). RFI-RRB (column null) reads its responseRequiredBy day; RFI-ANS (column set, responseRequiredBy null) reads its own dueDate. Observed on the 087-FLD debug build (the RFI created with dueDate null and responseRequiredBy D read back dueDate = D).",
      [H("backend/src/services/workflow-support.service.js", "840-845,955,1103-1107"), H("backend/src/services/rfi.service.js", "317,476,717"), BADJ("087-FLD item 6")], { company: C_FLD }),
    overdueStoredDueDate: F({ "RFI-RRB": null, "RFI-ANS": "its dueDate (past)" }, "state",
      "The stored Rfi.dueDate column, read in process and read only (e.g. prisma.rfi.findUnique({ where: { id }, select: { dueDate: true, responseRequiredBy: true } }) by the WP-8 proof; never a write, never through the API, which substitutes responseRequiredBy for a null column). RFI-RRB: null (created without a dueDate); RFI-ANS: its past dueDate. This is the column health.js reads for overdueHealth (:462-465).",
      [H("backend/src/routes/health.js", "174,462-465"), H("backend/src/services/workflow-support.service.js", "840-845"), BADJ("087-FLD item 6")], { company: C_FLD, note: "read only, in process: the one place the 'dueDate null' premise of overdueRecords is observable" }),
    overdueDetail: F({ "RFI-RRB": true, "RFI-ANS": true }, "state", "isOverdue: status in [draft, open, answered] and (responseRequiredBy || dueDate) < now -> both.", [P(866), H("backend/src/services/rfi-workflow.service.js", "19,196-200")], { assumption: true, company: C_FLD }),
    overdueListFilter: F({ "RFI-RRB": true, "RFI-ANS": true }, "state", "?overdue=true: status in [draft, open, answered] and (rrb < now or (rrb null and dueDate < now)) -> both.", [P(866), H("backend/src/services/rfi.service.js", "50,163-169")], { assumption: true, company: C_FLD }),
    overdueHealth: F({ "RFI-RRB": false, "RFI-ANS": true }, "state", "health.js: dueDate < today and status != closed -> only RFI-ANS (rrb ignored, answered counted). HR-K1 recommends the workspace basis.", [P(866, 895, 1056), H("backend/src/routes/health.js", "462-465")], { assumption: true, company: C_FLD }),
    overdueWorkspace: F({ "RFI-RRB": true, "RFI-ANS": false }, "state", "workspace: (rrb || dueDate) < today and status not in [answered, closed] -> only RFI-RRB.", [P(866), H("backend/src/services/workspace-dashboard.service.js", "30,1168-1175")], { assumption: true, company: C_FLD }),
  },
  submittal: {
    template: F("2 steps: QS 3 days, Planner 4 days -> reviewDays 7", "text", "reviewDaysFor sums step days: 3 + 4 = 7.", [P(390), H("backend/src/services/submittal-workflow.service.js", "94")], { company: C_FLD }),
    submitByTemplated: F(submitBy({ requiredOnSite: "2027-01-25", leadTimeWeeks: 2, reviewDays: 7 }), "date",
      "requiredOnSite 2027-01-25 - 2 weeks x 7 - 7 review days = 2027-01-25 - 21 days = 2027-01-04.",
      [P(869), H("backend/src/services/submittal-workflow.service.js", "253-260"), H("backend/src/services/submittal.service.js", "86-98")], { assumption: true, company: C_FLD, note: "requiredOnSite 2027-01-25 and lead time 2 weeks (stage 15's own values) for both submittals" }),
    submitByDirect: F(submitBy({ requiredOnSite: "2027-01-25", leadTimeWeeks: 2, reviewDays: 0 }), "date",
      "The direct submittal (no template, reviewDays null -> 0): 2027-01-25 - 14 days = 2027-01-11.",
      [P(869), H("backend/src/services/submittal.service.js", "86-98")], { assumption: true, company: C_FLD }),
    impactDaysRule: F("max(0, ceil((reviewedOn + leadTimeWeeks x 7 days - needBy) / 1 day))", "text", "computeScheduleImpactDays with approvedAt = reviewedOn; lead time 2 weeks gives the plan's +14 days.", [P(870), H("backend/src/services/submittal-workflow.service.js", "263-269,477")], { company: C_FLD }),
    impactDaysExample: F(submittalImpactDays({ approvedAtIso: "2027-01-20T10:00:00.000Z", needByIso: "2027-01-25", leadTimeWeeks: 2 }), "days",
      "Worked example: reviewed 2027-01-20 10:00Z, need-by 2027-01-25: (2027-02-03 10:00 - 2027-01-25 00:00) = 9.42 days -> ceil = 10 (a real approval timestamp adds a day against a midnight reviewedOn, which would give 9).",
      [P(870)], { assumption: true, company: C_FLD }),
    responseCodeResetOnNewCycle: F(null, "state", "A new cycle (revisionNumber + 1) clears responseCode and responseCodeLabel to null.", [P(872), H("backend/src/services/submittal-workflow.service.js", "447-452")], { company: C_FLD }),
    pmApprovalWhileStepsPending: F("200 (recorded)", "state", "Recorded: the PM's direct approve is not blocked by pending steps (HR-F1).", [P(871, 896, 1018)], { today: "200", company: C_FLD }),
  },
  drawing: {
    storemanRevisions: F(["B"], "state",
      "warehouse is a current-only role: it sees only revisions with isLatest && status approved. At the probe point B is the current approved revision of S-1 (A superseded, C-F not approved), and the currentOnlyFixture revision (approved, not latest, not superseded) is present and excluded by the isLatest term: still ['B'].",
      [P(874), H("backend/src/services/doc-control.service.js", "53,99-108"), "backend/scripts/phase21/stage15-document-control.js:136-147"], { assumption: true, company: C_FLD }),
    currentOnlyFixture: F("one extra S-1 revision with status approved, isLatest false, supersededAt null, in place before the storeman probe", "state",
      "Adjudication F4: the S-1 A-F data cannot catch removal of the isLatest term (no approved revision there is non-latest), so a fixture adds one: an approved revision that is not latest and not superseded. PRIMARY (product path, no SQL): file the revision directly as approved - POST /doc-control/:recordType/:recordId/revisions on the S-1 drawing (routes/doc-control.js:146) with status 'approved', which the route's body('status').optional().isIn(['uploaded', 'submitted', 'approved']) admits (:194), sent by a member who may approve revisions (document_control approve, document.revision.approve; anyone else 403 FORBIDDEN, doc-control.service.js:704) and naming a clean stored project document that member can read (projectDocumentId / documentId, :424-460) - or the same filing through the multipart POST .../revisions/upload that stage 15 uses (routes/doc-control.js:225,242-249,262-274: a status field 'approved', checked by the service's own filing check, :694-716). uploadDocumentRevision files it with status approved and isLatest false and touches no other revision (REVISION_FILING_STATUSES :672; the create :762-804), so B stays the latest approved revision and nothing is superseded. FALLBACK (only if the product path is refused or no longer yields that state at build time): the same revision made legacy-style by SQL and documented as a fixture (plan §1.4 guarded fixtures). The approve path cannot produce it at HEAD: approveDocumentRevision supersedes every other isLatest revision of the record and sets isLatest on the one it approves, so approving an older revision after a newer one leaves the older one latest.",
      [P(874, 882), H("backend/src/services/doc-control.service.js", "102-108,424-460,672,694-716,762-804,1033-1058"), H("backend/src/routes/doc-control.js", "146,194,225,242-249,262-274")], { assumption: true, company: C_FLD, note: "the fixture's revision code is the build's choice; it must not be A-F" }),
    approveSuperseded: F("409 DOCUMENT_REVISION_SUPERSEDED_READ_ONLY", "http", "Approving a superseded revision.", [P(875), H("backend/src/services/doc-control.service.js", "1015-1021")], { company: C_FLD }),
    supersedeWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST /revisions/:revisionId/supersede without a reason: the route chain body('reason').isString().trim().notEmpty().isLength({ max: 2000 }) refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); the service's DOCUMENT_REVISION_SUPERSEDE_REASON_REQUIRED (:1127) is not reached through the route.",
      [P(875), H("backend/src/routes/doc-control.js", "365-372"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/doc-control.service.js", "1123-1130")], { company: C_FLD, note: "details.field=reason" }),
    approveWithoutReview: F("200 (recorded)", "state", "Recorded: approve does not require the in-review status (HR-F2).", [P(875, 897, 1019), H("backend/src/services/doc-control.service.js", "1015-1058")], { today: "200", company: C_FLD }),
    approveOutOfOrder: F("200 (recorded)", "state", "Recorded: approving an older-lettered revision supersedes whatever isLatest is (HR-F2).", [P(875, 897, 1019), H("backend/src/services/doc-control.service.js", "1033-1058")], { today: "200", company: C_FLD }),
  },
  transmittal: {
    activityAndRevision: F("activityIds contains the cited activity; the cited S-1 revision reads back", "state", "The transmittal carries its activity link and the drawing revision it issues.", [P(390, 877), "backend/scripts/phase21/stage15-document-control.js:229-238"], { company: C_FLD }),
    distributeBypass: F("200 (recorded)", "state", "Recorded: status set to distributed/acknowledged through PATCH.", [P(878, 898)], { today: "200", company: C_FLD }),
    actionItemIdentity: F("same id across edits (recorded; today re-created)", "state", "Meeting action items keep their ids across an edit (HR-F6 recommendation: update action items in place).", [P(879, 898, 1023)], { assumption: true, company: C_FLD }),
    createTaskTasks: F(1, "count", "One createTask action item yields exactly 1 task, also after the minutes are edited (the plan probes a duplicate task; today an edit that re-creates the action item can create a second).", [P(390, 879, 1023)], { assumption: true, today: "2 after an edit (recorded)", company: C_FLD }),
    noticeLetterReadBack: F({ correspondenceLinks: 1, linkedCorrespondence: "the notice letter's id", contractualNotice: true }, "state",
      "Adjudication F6. The contractual notice letter (a correspondence created with contractualNotice true) is linked to its weather delay through the delay's correspondenceIds / correspondenceLinks (create or PATCH). The weather delay read back carries correspondenceLinks with exactly 1 entry whose correspondence.id is the letter and correspondence.contractualNotice is true (attachEvidenceToRecords reads the commercial correspondence links with the correspondence's ref, type, subject, contractualNotice, date and status).",
      [P(390), H("backend/src/routes/weather-delays.js", "46-49,80-83"), H("backend/src/services/weather.service.js", "231-237"), H("backend/src/services/commercial-traceability.service.js", "183-255,327-418"), H("backend/src/services/correspondence.service.js", "74")], { assumption: true, company: C_FLD, note: "one notice letter linked to one weather delay" }),
    noticeRegisterCount: F(1, "count", "The correspondence register's summary.notices counts correspondence with contractualNotice true: the one notice letter of 087-FLD.", [P(390), H("backend/src/services/correspondence.service.js", "41-48")], { assumption: true, company: C_FLD, note: "assumes no other contractual notice on 087-FLD" }),
    meetingChangeEventReadBack: F({ origin: "meeting", sourceRecordType: "meeting_action", sourceRecordId: "the action item's id", sourceLinks: [{ type: "meeting_action", id: "the action item's id" }], title: "Meeting action: <the action item's title>", activityId: "the action item's activityId (or null)", type: "other", romAmount: 0, scheduleImpactDays: 0 }, "state",
      "Adjudication F6, wording settled by the builders' adjudication (087-FLD item 6). A change event raised from a meeting action item (record source meeting_action, change-event.service.js:467-471) is created with the typed link in its meetingActionItemId column and, because it carries exactly one typed link, the free-text pair sourcePairOf writes from it: sourceRecordType 'meeting_action', sourceRecordId = the action item's id (:88-92, written at :379). The serializer eventOut does NOT expose the meetingActionItemId column; it exposes the pair (sourceRecordType / sourceRecordId, :203-204) and sourceLinks, one entry { type: 'meeting_action', id: the action item's id, path } per typed link (:72-77, :207). So the read-back (GET .../change-events/:changeEventId, getChangeEvent -> eventOut, :355; routes/change-events.js:65) asserts sourceRecordType 'meeting_action', sourceRecordId = the action item and sourceLinks of length 1 with that type and id, plus origin 'meeting' (:490, :531). Its prefill takes the title 'Meeting action: <title>' (:470), the item's activity, type 'other', ROM 0 and schedule impact 0 (:487-496). Origin and the typed link are the endpoint's; the raise body may override every field of PREFILL_OVERRIDABLE (:515): title, description, type, notes, activityId, locationId, scheduleImpactDays, ownerChange, romAmount and lines (the comment above it at :512-514 omits ROM and ownerChange, the list includes both). The figures above assume the raise body sends none of them - in particular neither romAmount (else ROM reads the body's figure, not 0) nor ownerChange.",
      [P(390), PF(429), H("backend/src/services/change-event.service.js", "40-49,72-77,88-92,191-216,355,369-379,467-471,487-496,503-510,512-520,528-533"), H("backend/src/routes/change-events.js", "65"), BADJ("087-FLD item 6")], { assumption: true, company: C_FLD, note: "the raise body sends neither romAmount nor ownerChange (nor any other PREFILL_OVERRIDABLE field); sourceLinks entries also carry a path (recordWorkspacePath), not asserted here" }),
  },
  existing: {
    snapshotQuality: F(qualityScore({ major: 1, minor: 0, failedItp: 1 }), "score",
      "Adjudication F6 (plan's existing evidence, the certified project): 100 - 20 x 1 major (NCR-01) - 8 x 0 minor - 15 x 1 failed ITP (ITP-02) = 65. DEF-01 is a minor punch defect, not an NCR, so it does not count.",
      [P(884, 961), H("backend/scripts/phase21/snapshot.js", "212-214"), "backend/scripts/phase21/stage16-quality.js:8,85-96,119,263"]),
    snapshotManHours: F(5 * 8, "man_hours",
      "Adjudication F6 (plan's existing evidence): stage 13's crew day, 5 steelfixers x 8 h regular on A130 = 40 h (the same day posts 40 x 50.00 = 2,000.00: reopenTwoThousand).",
      [P(884), "backend/scripts/phase21/stage13-labour.js:4-7,30-35,99"]),
  },
  "052-FLD": {
    qualityScore: F(qualityScore(FLD_QUALITY), "score", "Same mix as 087-FLD: 100 - 40 - 24 - 15 = 21", [P(405, 71)], { company: C_052 }),
    safetyHealth: F(safetyScore({ lti: 1, open: 1 }), "score", "Same safety set: 100 - 20 - 5 = 75 (today 70: archived counted open)", [P(405, 860)], { today: safetyScore({ lti: 1, open: 2 }), company: C_052 }),
    weatherBelowPct: F(pct2(FLD_WEATHER_BELOW.pct), "percent", "13 / 20 x 100 = 65 (compared at 2 dp, F2), no warning, 7 remaining", [P(405, 815)], { company: C_052 }),
    weatherAtPct: F(pct2(FLD_WEATHER_AT.pct), "percent", "14 / 20 x 100 = 70 (compared at 2 dp, F2), warning, 6 remaining", [P(405, 815)], { company: C_052 }),
    weatherAtWarning: F(FLD_WEATHER_AT.warning, "bool", "70 >= 70", [P(405, 815)], { company: C_052 }),
    labour: F(TS_MIXED_CENTS, "cents", "8x50x1 + 2x50x1.5 + 1x50x2 = 400 + 150 + 100 = 650.00 USD", [P(405, 845)], { company: C_052 }),
  },
  mutations: {
    qualityWeightMinor10: F(qualityScore({ ...FLD_QUALITY, weights: { major: 20, minor: 10, failedItp: 15 } }), "score", "8 -> 10: 100 - 40 - 30 - 15 = 15", [P(882)], { company: C_FLD }),
    dropClamp: F(qualityScore({ major: 6, clamp: false }), "score", "6 major without the clamp: 100 - 120 = -20", [P(882)], { assumption: true, company: C_FLD }),
    manpowerStatusFilter: F(manHours(MP_ALL), "man_hours", "Filter removed: 40 + 30 + 2x8 = 86", [P(882), H("backend/src/services/daily-log.service.js", "1456")], { company: C_FLD }),
    manpowerStatusFilterWorkers: F(workersOf(MP_ALL), "count", "Filter removed: 5 + 3 + 2 = 10 workers", [P(882)], { company: C_FLD }),
    doubleTimeMultiplier: F(TS_MIXED_DOUBLE_MUTATED, "cents", "double -> 1: 400 + 150 + 50 = 600.00", [P(882), H("backend/src/services/timesheet.service.js", "70")], { company: C_FLD }),
    punchFinalApprover: F("200 closed", "state", "Check removed: the non-approver's close succeeds instead of 403.", [P(882), H("backend/src/services/punch.service.js", "562-564")], { company: C_FLD }),
    currentOnlyFilter: F("storeman sees ['B', the currentOnlyFixture revision], not ['B']", "state",
      "The isLatest term removed (isCurrentApprovedRevision reads status approved only): the storeman sees every approved S-1 revision - B and the currentOnlyFixture revision (A superseded, C-F not approved), so the check that the storeman sees only the latest approved one goes red. Removing the whole current-only filter (visibleRevisionsForRole returns all) shows every S-1 revision, A-F and the fixture. Without the fixture, dropping only the isLatest term changed nothing (adjudication F4).",
      [P(874, 882), H("backend/src/services/doc-control.service.js", "102-108")], { assumption: true, company: C_FLD }),
    reviewDaysInSubmitBy: F(submitBy({ requiredOnSite: "2027-01-25", leadTimeWeeks: 2, reviewDays: 0 }), "date", "Review-days term removed: the templated submittal moves from 2027-01-04 to 2027-01-11.", [P(882), H("backend/src/services/submittal-workflow.service.js", "258")], { assumption: true, company: C_FLD }),
    archivedFilterDashboardIncidents: F(3, "count", "live() removed: the archived near miss is back -> safetyIncidents 3 (and safetyOpen 2).", [P(882), H("backend/src/services/quality.service.js", "37-42")], { company: C_FLD }),
    archivedFilterDashboardOpen: F(2, "count", "live() removed: safetyOpen = open near miss + archived near miss = 2.", [P(882)], { company: C_FLD }),
  },
};

const WP9 = {
  T1: {
    errors: F(0, "count", "Dry run over the 14 certified projects: errors [] (length 0).", [P(907)]),
    skipped: F(0, "count", "skipped [] (length 0).", [P(907)]),
    quantityKindRows: F(0, "count", "quantity_over_allocation / quantity_over_boq / certified_over_installed / allocation_over_capacity: 0 rows on the certified projects.", [P(907)]),
    budgetTruthRowsPerProject: F(3, "count", "All three pairs differ by more than 0.01 on each certified project (register_vs_ev_bac, register_vs_contract_waterfall, ev_bac_vs_contract_waterfall).", [P(908), H("backend/src/services/exception-rules/data-quality.js", "146-150,170")]),
    budgetTruthRowsAllProjects: F(3 * 14, "count", "3 per plan x 14 identical plans = 42 (if the dry run is read as one combined list).", [P(908, 916)], { assumption: true }),
    registerRevised: F(cents(TRUTHS.register), "cents", "1,700,000 + 125,000 + 4,500 = 1,829,500.00", [P(912), H("backend/scripts/phase21/snapshot.js", "42-48")]),
    evBac: F(cents(TRUTHS.evBac), "cents", "Allocations 60,000 + 30,000 + 90,000 + 135,000 + 72,000 = 387,000; + approved revisions 129,500 = 516,500.00", [P(453, 912)]),
    contractWaterfall: F(cents(TRUTHS.contract), "cents", "2,000,000 + 129,500 = 2,129,500.00", [P(913), H("backend/scripts/phase21/snapshot.js", "50-51")]),
    gapRegisterVsEvBac: F(cents(Math.abs(TRUTHS.register - TRUTHS.evBac)), "cents", "|1,829,500 - 516,500| = 1,313,000.00 (data.higher = register)", [P(912), H("backend/src/services/exception-rules/data-quality.js", "106-117")]),
    gapRegisterVsContract: F(cents(Math.abs(TRUTHS.register - TRUTHS.contract)), "cents", "|1,829,500 - 2,129,500| = 300,000.00 (data.higher = contract)", [P(913), H("backend/src/services/exception-rules/data-quality.js", "106-117")]),
    gapEvBacVsContract: F(cents(Math.abs(TRUTHS.evBac - TRUTHS.contract)), "cents", "|516,500 - 2,129,500| = 1,613,000.00 (data.higher = contract)", [P(914), H("backend/src/services/exception-rules/data-quality.js", "106-117")]),
    plansIdentical: F(14, "count", "The 14 plans are identical apart from ids.", [P(916)]),
  },
  "T2/T2b": {
    quantityFirst: F(Q_FIRST, "m3", "Approved entries 60 + 45 = 105 installed on X10 / Q1.", [P(391, 918)], { company: C_EXC }),
    quantityFirstSeverity: F(overRatioSeverity(Q_FIRST, Q_LIMIT), "state", "105 > 100 + 0.0005 opens a row; 105 <= 100 x 1.1 = 110 -> warning (exceedance 5.000).", [P(918), H("backend/src/services/exception-rules/quantity.js", "116-126"), H("backend/src/services/exception-rules/_thresholds.js", "13,17,43-46")], { company: C_EXC }),
    quantityFirstExceedance: F(Q_FIRST - Q_LIMIT, "m3", "105 - 100 = 5", [P(918), H("backend/src/services/exception-rules/quantity.js", "141")], { company: C_EXC }),
    quantityLaterSeverity: F(overRatioSeverity(Q_LATER, Q_LIMIT), "state", "113 > 110 -> critical (exceedance 13).", [P(918)], { company: C_EXC }),
    quantityLaterExceedance: F(Q_LATER - Q_LIMIT, "m3", "113 - 100 = 13", [P(918)], { company: C_EXC }),
    quantityWithCoLimit: F(Q_LIMIT + Q_CO, "m3", "Authorised = allocation 100 + approved CO link +10 = 110.", [P(391, 918), H("backend/src/services/exception-rules/quantity.js", "117-119")], { company: C_EXC }),
    quantityWithCoSeverity: F(overRatioSeverity(Q_LATER, Q_LIMIT + Q_CO), "state", "113 vs 110: 113 <= 121 -> back to warning (exceedance 3).", [P(918)], { company: C_EXC }),
    quantityWithCoExceedance: F(Q_LATER - (Q_LIMIT + Q_CO), "m3", "113 - 110 = 3", [P(918)], { company: C_EXC }),
    quantityKindsRaised: F(["quantity_over_allocation", "quantity_over_boq"], "state", "Q1 (qty 100) is wholly allocated to X10 (quantity method), so both quantity kinds measure 105/113 against 100 (and 110 after the CO link naming the allocation and the item).", [H("backend/src/services/exception-rules/quantity.js", "62-147,151-206")], { assumption: true, company: C_EXC }),
    committedOverBudgetSeverity: F(overRatioSeverity(10_500, 10_000), "state", "SC-1 10,500 against L1 10,000: 10,500 <= 11,000 -> warning.", [P(919), H("backend/src/services/exception-rules/money.js", "94-110")], { company: C_EXC }),
    committedOverBudgetExceedance: F(cents(10_500 - 10_000), "cents", "10,500.00 - 10,000.00 = 500.00", [P(919)], { company: C_EXC }),
    forecastOverRevisedSeverity: F(overRatioSeverity(23_000, 20_000), "state", "L2 typed forecast 23,000 is critical iff L2's revised budget < 23,000 / 1.1 = 20,909.09; with revised 20,000: 23,000 > 22,000 -> critical.", [P(391, 919), H("backend/src/services/exception-rules/money.js", "216-223")], { assumption: true, company: C_EXC, note: "L2 revised budget 20,000 assumed; the plan gives only the forecast" }),
    forecastOverRevisedExceedance: F("forecast 23,000.00 - L2's revised budget at build time", "text",
      "Adjudication F5: not derivable from the plan (it gives L2's typed forecast, 23,000, and not L2's revised budget). The row's data.exceedance is round2(forecast - revisedBudget). Recorded as the expression; the build fixes the figure (integer cents: 2,300,000 - L2's revised budget in cents) when it writes L2's budget. With the 20,000 the severity figure assumes, it would be 3,000.00.",
      [P(391, 919), H("backend/src/services/exception-rules/money.js", "216-238")], { assumption: true, company: C_EXC, note: "unit becomes cents once the build writes L2's revised budget" }),
    certifiedOverEarnedSeverity: F("critical", "state",
      "Adjudication F6: the IPC certified above earned value on an override (plan :391) opens one certified_over_earned row on its ipc_certificate. The kind is always critical (no ratio), subject ipc_certificate, module cost, BOQ-derived (withheld whole from a non-BOQ reader). Measured = the certificate's stored overCertificationAmount (read as stored, never recomputed; the build's figure), counted only for certified/paid certificates whose stored amount exceeds the 0.01 money tolerance; data.overrideRecorded true.",
      [P(391, 919), H("backend/src/services/exception-rules/money.js", "33-80"), H("backend/src/services/exception-rules/_thresholds.js", "15,30"), H("backend/src/utils/boq-figures.js", "1911")], { company: C_EXC }),
    certifiedOverEarnedLimit: F(0, "cents", "limit.value 0: nothing is certified beyond earned value, so any stored over-certification is the exception.", [P(391), H("backend/src/services/exception-rules/money.js", "65-69")], { company: C_EXC }),
    duplicateCoMeasured: F(2, "count", "Two approved COs with the same description and activity impact: measured 2.", [P(391, 920), H("backend/src/services/exception-rules/data-quality.js", "749")], { company: C_EXC }),
    duplicateCoLimit: F(1, "count", "Limit 1 order per instruction.", [P(920), H("backend/src/services/exception-rules/data-quality.js", "750")], { company: C_EXC }),
    duplicateCoRows: F(1, "count", "One duplicate-CO row.", [P(920)], { company: C_EXC }),
    orphanLinkRows: F(1, "count", "The budget revision linked to VO-999 (no such CO): one orphan_change_link row.", [P(391, 920)], { company: C_EXC }),
    secondRunOpens: F(0, "count", "A second evaluation with nothing changed opens nothing.", [P(921)], { company: C_EXC }),
    methodSwitch: F("not_comparable", "state", "X10 switched off the quantity method: its quantity_over_allocation row resolves with resolvedReason 'not_comparable', never 'cleared'.", [P(921), H("backend/src/services/exception-rules/quantity.js", "78-80"), H("backend/src/services/exception-engine.service.js", "56")], { company: C_EXC }),
  },
  T2c: {
    staleMeasured: F(15, "days", "floor((at - latest approvedAt) / 1 day) = 15", [P(922), H("backend/src/services/exception-rules/data-quality.js", "484,508-514")], { company: C_EXC }),
    staleLimit: F(14, "days", "PROGRESS_STALE_DAYS 14; 15 > 14 opens progress_stale (warning).", [P(922), H("backend/src/services/exception-rules/data-quality.js", "484,509")], { company: C_EXC }),
    periodUnlockedMeasured: F(8, "days", "floor((at - cutoff) / 1 day) = 8 for the past, unlocked period", [P(391, 922), H("backend/src/services/exception-rules/data-quality.js", "541-546")], { company: C_EXC }),
    periodUnlockedLimit: F(7, "days", "PERIOD_LOCK_GRACE_DAYS 7; 8 > 7 opens period_not_locked (warning).", [P(922), H("backend/src/services/exception-rules/data-quality.js", "532,542")], { company: C_EXC }),
  },
  T3: {
    slipMeasured: F(7, "working_days", "Slip from the data date = 7 working days.", [P(923)], { company: C_EXC }),
    slipLimit: F(5, "working_days", "SCHEDULE_SLIP_THRESHOLD_DAYS 5; 7 > 5 opens a row.", [P(923), H("backend/src/services/exception-rules/_thresholds.js", "23"), H("backend/src/services/exception-rules/schedule.js", "110")], { company: C_EXC }),
    slipSeverity: F("warning", "state", "7 < 20 and the activity is not critical -> warning (critical if the activity is critical).", [H("backend/src/services/exception-rules/schedule.js", "118")], { assumption: true, company: C_EXC }),
    dismissalHolds: F("dismissed", "state", "Expected: an API dismissal holds on re-evaluation; today the row reopens (HR-K3).", [P(923, 973, 1058)], { today: "open", company: C_EXC }),
  },
  T4: {
    concurrentEvaluations: F(0, "count", "Two concurrent evaluations of one project leave 0 duplicate rows (one row per subject and kind).", [P(924, 974)], { assumption: true, company: C_EXC }),
  },
  engineSwitch: {
    exactTrue: F("on", "state", "EXCEPTIONS_ENGINE_ENABLED='true' -> enabled.", [P(925), H("backend/src/services/exception-engine.service.js", "71")]),
    otherValues: F("off", "state", "'1', 'yes', 'on', 'false', '' and unset -> disabled.", [P(925), H("backend/src/services/exception-engine.service.js", "71")]),
    caseAndSpace: F("on", "state",
      "engineEnabled is String(v).trim().toLowerCase() === 'true', so 'TRUE' and ' true ' also switch it on. A proof that reads the plan's 'exactly true' literally would expect off.",
      [P(925), H("backend/src/services/exception-engine.service.js", "65-71")], { planValue: "off (only the exact string 'true')" }),
  },
  mustNot: {
    fingerprintDelta: F(0, "count", "COs, budget lines, reconciliation, CPM figures, progress counts, change events, audit, history, outbound events, notifications and jobs: 0 changes; only exception rows change.", [P(926)], { company: C_EXC }),
  },
  handling: {
    raise: F("201", "http", "Raise a change event from an open exception.", [P(927)], { company: C_EXC }),
    raiseAgain: F("409 EXCEPTION_IN_CHANGE", "http", "A second raise on an exception carried by a live change event.", [P(927), H("backend/src/services/exception.service.js", "458")], { company: C_EXC }),
    snoozeBeyond365: F("400 EXCEPTION_SNOOZE_INVALID", "http", "until <= now or > now + 365 days.", [P(927), H("backend/src/services/exception.service.js", "39,510-511")], { company: C_EXC, note: "sent with a reason (without one the route's 400 VALIDATION_ERROR answers first)" }),
    snoozeWithoutReason: F("400 VALIDATION_ERROR", "http", "A snooze needs a reason: the route chain body('reason').isString().trim().isLength({ min: 1, max: 500 }) answers first (validate: 'Validation failed', error.details holds field 'reason'); the service's own check (:514) is the backstop.", [H("backend/src/routes/exceptions.js", "104"), H("backend/src/services/exception.service.js", "514")], { company: C_EXC, note: "details.field=reason" }),
    dismissWithoutReason: F("400 VALIDATION_ERROR", "http", "A dismissal needs a reason: the route chain body('reason').isString().trim().isLength({ min: 1, max: 500 }) answers first (validate: 'Validation failed', error.details holds field 'reason'); the service's own check (:541) is the backstop.", [H("backend/src/routes/exceptions.js", "109"), H("backend/src/services/exception.service.js", "541")], { company: C_EXC, note: "details.field=reason" }),
    reviewWithoutNote: F("400 VALIDATION_ERROR", "http",
      "POST /:exceptionId/review without a note: the route chain body('note').isString().trim().isLength({ min: 1, max: 2000 }) refuses it before the service (validate: 'Validation failed', error.details holds field 'note'); reviewException's own 'A review needs a note' (:490) is the backstop (adjudication F6).",
      [P(927), H("backend/src/routes/exceptions.js", "98-99"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/exception.service.js", "484-490")], { company: C_EXC, note: "details.field=note" }),
    boqWithheldRead: F("404 EXCEPTION_NOT_FOUND", "http",
      "BOQ withholding (adjudication F6): the 087 member denied boq:read (plan :396) asks for a BOQ-derived 087-EXC row by id (GET /controls/exceptions/:id; review, snooze and dismiss with a valid note/reason answer the same). The BOQ-derived kinds on 087-EXC are quantity_over_allocation, quantity_over_boq, certified_over_earned and schedule_slip_on_mapped_item (the T3 slip row: module schedule, boqDerived true at boq-figures.js:1918 - its presence says the activity is mapped to a BOQ item with certification pending) (boq-figures EXCEPTION_KIND_POLICY; the rules state the same, exception-rules/schedule.js:81-83 for the slip). loadReadable answers 404 EXCEPTION_NOT_FOUND because exceptionReadable needs access.boq for a BOQ-derived row: an unreadable exception is not said to exist. The same member's list omits those rows and carries the withheld marker, never a count.",
      [P(396, 927), H("backend/src/services/exception.service.js", "423-425"), H("backend/src/utils/boq-figures.js", "1908-1911,1916-1918,1956-1959,1972-1977"), H("backend/src/services/exception-rules/schedule.js", "34-39,77-83"), H("backend/src/routes/exceptions.js", "95")],{ company: C_EXC, note: "the member has the kind's module read (cost / boq / schedule); without it the row is unreadable for that reason too" }),
    concurrentConverts: F(1, "count", "Two concurrent converts: exactly 1 succeeds.", [P(927)], { company: C_EXC }),
    voidReleases: F("open", "state", "Voiding the change event releases the exception back to open.", [P(927)], { company: C_EXC }),
    reopenedFrom: F("present", "state", "A dismissal reopened carries reopenedFrom.", [P(927)], { company: C_EXC }),
  },
  notices: {
    criticalOpeningRecipients: F(["assigned PM", "assigned QS"], "state", "notifyOpenedCritical takes project assignments with role pm or qs that may read the exception.", [P(929), H("backend/src/services/exception.service.js", "882-912")], { company: C_EXC }),
    criticalOpeningCount: F(">= 4", "count",
      "Adjudication F3: derived from the rows 087-EXC actually has at its first evaluation, fixed at the build. notifyOpenedCritical sends one notice per open, critical, unsnoozed row to each assigned PM and QS who may read it (dedupe key: the row and its detectedAt). Critical at the first evaluation on the plan's records: forecast_over_revised on L2 (critical, plan :919; a typed-forecast line row is critical when forecast > revised x 1.1, F5) and certified_over_earned on the IPC certified above earned value on an override (always critical, limit 0; BOQ-derived, so the PM and QS need boq:read). The quantity rows are warnings at 105 (they turn critical only at 113: escalationCount), committed_over_budget is a warning, the data-quality rows orphan link, stale progress and unlocked period are warnings (data-quality.js:844-845, :854-855, :886-887), the duplicate-CO row (change_order_possible_duplicate) is info (:901-902), and a slip on a non-critical activity is a warning. Lower bound: 2 critical rows x {PM, QS} = 4. Each further critical row the build produces adds 2 (e.g. the project-level forecast_over_revised row when the official EAC exceeds the revised BAC with CPI < 0.9, or a slip on a critical activity). Until the build: '>= 4'; then the exact count from the rows opened.",
      [P(391, 919, 929), H("backend/src/services/exception.service.js", "872-950"), H("backend/src/services/exception-rules/money.js", "33-80,161-240"), H("backend/src/services/exception-rules/_thresholds.js", "29-35,43-46"), H("backend/src/services/exception-rules/data-quality.js", "844-845,854-855,886-887,901-902")],
      { assumption: true, company: C_EXC, note: "assumes the QS with the commercial category off (plan :398) is not 087-EXC's assigned QS: exception.opened is category commercial, so that QS would get 0 and each row would notify the PM only" }),
    escalationCount: F(2 * 2, "count", "105 -> 113 escalates the 2 quantity rows to critical: 2 rows x {PM, QS} = 4.", [P(930), H("backend/src/services/exception.service.js", "899-933")], { assumption: true, company: C_EXC }),
    siteEngineerWithoutBoqRead: F(0, "count", "Not a pm/qs candidate and no boq:read for a BOQ-derived row: 0.", [P(930), H("backend/src/services/exception.service.js", "901-912")], { company: C_EXC }),
    escalatedWhileSnoozed: F(0, "count", "Recorded: a row that escalates while snoozed notifies 0 (HR-K5).", [P(931, 1060), H("backend/src/services/exception.service.js", "894")], { company: C_EXC }),
  },
  workflowNotifications: {
    commitmentExecutedRecipients: F(["creating QS", "assigned cost controller", "assigned finance"], "state", "Exactly these three on the commitment's project.", [P(934)]),
    commitmentExecutedCount: F(3, "count", "3 distinct people.", [P(934)], { assumption: true }),
    otherProjectStaff: F(0, "count", "QS, cost controller, finance, site engineer and procurement assigned only to 087-OTH: 0 each, 0 in total (today they are notified; HR-K4).", [P(393, 934, 964, 1059)], { today: "notified", company: C_OTH }),
    otherProjectStaffHeadcount: F(5, "count", "QS, cost controller, finance officer, site engineer and procurement officer (assumption A1: 087 has staff in these roles).", [P(393, 1167)], { assumption: true, company: C_OTH }),
    payAppAndDrawingSetScope: F("project members only; 087-OTH staff 0", "state", "Pay-application and drawing-set notices follow the same project scope as commitment.executed.", [P(935, 964, 1059)], { company: C_OTH }),
    commercialOptOut: F(0, "count",
      "Adjudication F6 (preference opt-out, plan :398, :936): the QS with the commercial category switched off (in-app and e-mail both off) receives 0 notices of category commercial - commitment.executed and exception.opened are both commercial. createNotifications skips a recipient whose category preference has neither in-app nor e-mail; the other recipients of the same notice are unchanged.",
      [P(398, 936), H("backend/src/services/notification.service.js", "26-38,318-327,424-441,779-781"), H("backend/src/services/commitment.service.js", "694"), H("backend/src/services/exception.service.js", "921")],
      { assumption: true, note: "with in-app off but e-mail on, a row is still written (inAppVisible false): the in-app feed shows 0 but the table does not; the probe switches both off. That QS must not be the creating QS of the commitmentExecuted probe, or that count drops to 2" }),
  },
  health: {
    // EV figures (builders' adjudication 087-EXC/HLT item 6, R3-4): PV and AC at the 2026-08-31 cutoff,
    // EV 0 at that cutoff (plan §3.3), EV 75,000 on the health card's default basis.
    evRecords: F(HLT_RECORDS, "text",
      "The record set the build makes (build/087-hlt.js), adopted here as the inputs of the EV figures; the plan gives only the totals. Two activities from the project start (H10 10 working days, H50 the 50-working-day activity of delayedExampleDates), each with one BOQ row allocated whole and approved (60,000 + 30,000), one approved cost loading and one approved direct cost each, every one dated on or before the cutoff 2026-08-31 and nothing after it (so the cutoff and today read the same PV and AC), and approved progress H10 100% and H50 50% (H50 below 100% so it can count as delayed). Approvals carry the build's real timestamps (plan §3.3).",
      [P(392), PF(431, 467), BADJ("087-EXC/HLT item 6; R3-4")], { assumption: true, company: C_HLT, note: "money in whole currency units here (EGP); the figures below are cents" }),
    cutoffInstant: F(HLT_CUTOFF_INSTANT, "instant",
      `End of ${HLT_CUTOFF} in ${HLT_ZONE}, the project's reporting zone (Project.timezone copied from company 087 at creation; schedule.js WP3.setup.timeZone): Egypt keeps daylight saving from the last Friday of April to the last Thursday of October, so 2026-08-31 is UTC+3 and ends at ${HLT_CUTOFF_INSTANT} (bisection on the platform's Intl data).`,
      [P(392), PF(431), H("backend/src/utils/reporting-cutoff.js", "1-17,145-156"), BADJ("087-EXC/HLT item 6")], { company: C_HLT }),
    pvAtCutoff: F(HLT_PV_CUTOFF, "cents",
      "GET /reports/ev?cutoffDate=2026-08-31: PV = approved cost loadings whose plannedDate is on or before the cutoff date (selected by calendar date: earned-value.service.js:439-451, 724-726, 759): H10 60,000.00 + H50 30,000.00 = 90,000.00.",
      [P(392), PF(431), H("backend/src/services/earned-value.service.js", "439-451,724-726,759"), BADJ("087-EXC/HLT item 6")], { company: C_HLT }),
    acAtCutoff: F(HLT_AC_CUTOFF, "cents",
      "AC at the cutoff = the official actual cost of each activity whose cost record runs through a date on or before 2026-08-31 (earned-value.service.js:486-514, 760): H10 50,000.00 + H50 30,000.00 = 80,000.00. Each activity has one direct cost, dated on or before the cutoff, so HEAD's one-cumulative-record reading (L34) and the ledger reading agree here.",
      [P(392), PF(431), H("backend/src/services/earned-value.service.js", "486-514,760"), BADJ("087-EXC/HLT item 6")], { company: C_HLT }),
    evAtCutoff: F(HLT_EV_CUTOFF, "cents",
      `EV at the cutoff reads progress approved by the cutoff instant (approvedAt <= ${HLT_CUTOFF_INSTANT}; earned-value.service.js:737-753, 786-792). Plan §3.3: 'Approvals carry real timestamps. A cutoff before the run date therefore sees no approval' (:467 @f599e67): the build approves H10 100% and H50 50% at its run (2026-10-09 or later), so no approval counts: EV 0.00. Plan figure correction (builders' adjudication 087-EXC/HLT item 6, a plan execution note, not BLOCKED): the plan's 'EV 75,000 at the cutoff' is the card's default basis (evOnCardBasis), not the cutoff.`,
      [P(392), PF(431, 467), H("backend/src/services/earned-value.service.js", "737-753,786-792"), BADJ("087-EXC/HLT item 6; R3-4")], { planValue: cents(HLT_EV.ev), company: C_HLT, note: "the plan's own §3.3 rule gives 0 at a past cutoff; WP-3 T3 relies on the same rule" }),
    cardBasis: F("ad hoc report cut at today (no reporting period on 087-HLT)", "state",
      "The health card asks evService.buildOfficialEvReport with no period and no cutoff (health.js:316-319). resolveReportingPeriod then takes the latest period whose cutoff has passed (pickDefaultReportingPeriod) and, with none, cuts a virtual period at new Date(), i.e. the end of today's date in the reporting zone (earned-value.service.js:386-395, 398-424). 087-HLT has no reporting period, so the card's basis is today.",
      [P(392, 938), PF(431, 976), H("backend/src/routes/health.js", "316-327"), H("backend/src/services/earned-value.service.js", "359-424,696-722"), BADJ("087-EXC/HLT item 6")], { assumption: true, company: C_HLT, note: "assumes no reporting period is created on 087-HLT" }),
    pvOnCardBasis: F(HLT_PV_CUTOFF, "cents", "Every loading is dated on or before 2026-08-31, before today, and none after it: 90,000.00, the same as at the cutoff.", [P(392), PF(431), H("backend/src/services/earned-value.service.js", "439-451"), BADJ("087-EXC/HLT item 6")], { company: C_HLT }),
    acOnCardBasis: F(HLT_AC_CUTOFF, "cents", "Every direct cost is dated on or before 2026-08-31 and none after it: 80,000.00, the same as at the cutoff.", [P(392), PF(431), H("backend/src/services/earned-value.service.js", "486-514"), BADJ("087-EXC/HLT item 6")], { company: C_HLT }),
    evOnCardBasis: F(HLT_EV_CARD, "cents", "Every approval is stamped before the card's cutoff (the end of today): EV = 60,000.00 x 100% + 30,000.00 x 50% = 60,000.00 + 15,000.00 = 75,000.00 (allocation x approved percent, earned-value.service.js:786-792). This is the plan's 'EV 75,000'.", [P(392), PF(431), H("backend/src/services/earned-value.service.js", "737-753,786-792"), BADJ("087-EXC/HLT item 6")], { company: C_HLT }),
    spi: F(HLT_SPI, "ratio", "On the card's default basis (evOnCardBasis / pvOnCardBasis): EV / PV = 75,000 / 90,000 = 0.833333", [P(392, 938), BADJ("087-EXC/HLT item 6")], { company: C_HLT }),
    spiDetail: F(Number(HLT_SPI.toFixed(2)), "ratio", "Card detail rounds to 2 places: 0.83", [H("backend/src/routes/health.js", "498")], { company: C_HLT }),
    scheduleScore: F(scoreByIndex(HLT_SPI), "score", "0.75 <= 0.8333 < 0.9 -> 60", [P(938), H("backend/src/routes/health.js", "85-90,363-364")], { company: C_HLT }),
    cpi: F(HLT_CPI, "ratio", "On the card's default basis (evOnCardBasis / acOnCardBasis): EV / AC = 75,000 / 80,000 = 0.9375", [P(392, 938), BADJ("087-EXC/HLT item 6")], { company: C_HLT }),
    cpiDetail: F(Number(HLT_CPI.toFixed(2)), "ratio", "0.9375 to 2 places = 0.94", [H("backend/src/routes/health.js", "521")], { company: C_HLT }),
    costScore: F(scoreByIndex(HLT_CPI), "score", "0.9 <= 0.9375 < 1 -> 80", [P(938), H("backend/src/routes/health.js", "365")], { company: C_HLT }),
    commercialCard: F(clampScore(100 - HLT_COS.length * 2 - healthCommercialDays * 0.5), "score", "Card: days = CO1 4 + CO2 (0 + link 6) = 10; 100 - 2x2 - 10x0.5 = 91", [P(939), H("backend/src/routes/health.js", "367-383")], { assumption: true, company: C_HLT, note: "CO2's link carries approvedScheduleImpactDays 6 and CO2.scheduleImpact is 0" }),
    commercialWorkspace: F(clampScore(100 - HLT_COS.length * 2 - workspaceCommercialDays * 0.5), "score", "Workspace reads scheduleImpact only: days 4; 100 - 4 - 2 = 94", [P(939), H("backend/src/services/workspace-dashboard.service.js", "1129-1137")], { company: C_HLT }),
    qualityByRule: F(qualityScore({ major: HLT_QUALITY.major, minor: HLT_QUALITY.minor, failedItp: HLT_QUALITY.legacyFailed + HLT_QUALITY.formFailed }), "score", "Form ITPs counted (HR-Q3 recommendation): 100 - 20 - 8 - 2x15 = 42", [P(940, 1009)], { company: C_HLT }),
    qualityInCode: F(qualityScore({ major: HLT_QUALITY.major, minor: HLT_QUALITY.minor, failedItp: HLT_QUALITY.legacyFailed }), "score", "Legacy register only: 100 - 20 - 8 - 15 = 57 (card, workspace and quality dashboard alike)", [P(940), H("backend/src/routes/health.js", "442-447")], { company: C_HLT }),
    safetyExpected: F(safetyScore({ lti: 1, open: 1 }), "score", "LTI (closed) -20; the open incident -5; the incident archived while open excluded: 75", [P(392, 941)], { today: safetyScore({ lti: 1, open: 2 }), assumption: true, company: C_HLT, note: "the open and the archived incidents are not LTI or fatality" }),
    safetyWorkspace: F(safetyScore({ lti: 1, open: 1 }), "score", "archivedAt: null filter: 75", [H("backend/src/services/workspace-dashboard.service.js", "830,1155-1166")], { assumption: true, company: C_HLT }),
    docControlRecords: F("open RFI overdue by dueDate and responseRequiredBy; answered RFI with dueDate past; 2 pending submittals not yet due; no drawings", "text",
      "The literal contents of plan §3.2 087-HLT: 'An overdue open RFI, an overdue answered RFI, pending submittals, and no drawings' (:431 @f599e67), decided by the builders' adjudication (087-EXC/HLT item 8). Made concrete as: the open RFI with its stored dueDate and its responseRequiredBy both past; the answered RFI with its stored dueDate past (responseRequiredBy null); 2 submittals in pending / under_review / resubmit whose dueDate is not past; no drawing record. These are the records docControlExpected / docControlCard are derived on (the plan's 90 / 100 belong to docControlPlanReading's records).",
      [P(392), PF(431), BADJ("087-EXC/HLT item 8")], { assumption: true, company: C_HLT, note: "two pending submittals is this book's count for 'pending submittals'; each further one moves both scores by -5" }),
    docControlExpected: F(HLT_DOC_LITERAL.rule, "score",
      "Rule basis (HR-K1 recommendation: the workspace definitions, workspace-dashboard.service.js:1168-1190): overdue RFIs = (responseRequiredBy || dueDate) < today and status not in [answered, closed] -> the open RFI only = 1 (-10 x 1); overdue submittals (dueDate past and pending / under_review / resubmit) = 0; pending submittals 2 (-5 x 2 = -10); no IFC offset: clampScore(100 - 10 - 0 - 10) = 80. Plan figure correction (builders' adjudication 087-EXC/HLT item 8): the plan's 'Document control: 90 against 100' (:980 @f599e67) belongs to another record set, docControlPlanReading's (no counted pending submittal, the open RFI overdue only by responseRequiredBy).",
      [P(941, 1056), PF(431, 980, 1095), H("backend/src/services/workspace-dashboard.service.js", "30,1168-1190"), BADJ("087-EXC/HLT item 8")], { assumption: true, planValue: 90, company: C_HLT, note: "plan figure correction: 90 is docControlPlanReading.rule; on the plan's literal contents the rule gives 80" }),
    docControlCard: F(HLT_DOC_LITERAL.health, "score",
      "Card today, the health service's doc-control formula (health.js:462-478, on the stored rows read at :174-178): overdueRfis = stored dueDate < today and status != closed -> the open RFI and the answered RFI = 2 (-10 x 2 = -20); pendingSubmittals (pending / under_review / resubmit) = 2 (-5 x 2 = -10); ifcRatio = 1 with no drawings (+10 x 1 = +10): clampScore(100 - 20 - 10 + 10) = 80. The +10 IFC offset cancels the answered RFI's -10, so card and rule agree, 80 / 80, on these records. Plan figure correction (builders' adjudication 087-EXC/HLT item 8): the plan's 100 belongs to docControlPlanReading's records.",
      [P(941), PF(431, 980), H("backend/src/routes/health.js", "174-178,462-478"), BADJ("087-EXC/HLT item 8")], { assumption: true, planValue: 100, company: C_HLT, note: "plan figure correction: 100 is docControlPlanReading.card; on the plan's literal contents the card gives 80" }),
    docControlPlanReading: F({ rule: HLT_DOC_PLAN_READING.rule, card: HLT_DOC_PLAN_READING.health }, "score",
      "Records that reproduce the plan's 90 vs 100: open RFI overdue only by responseRequiredBy (dueDate null), answered RFI overdue by dueDate, and NO submittal in pending/under_review/resubmit: rule 100 - 10 = 90; card 100 - 10 (answered) + 10 (IFC) = 100.",
      [P(392, 941), H("backend/src/routes/health.js", "462-478"), H("backend/src/services/workspace-dashboard.service.js", "1168-1190")], { assumption: true, company: C_HLT }),
    docControlIfcVariant: F(docHealth({ overdueByDueDateNotClosed: 2, pendingSubmittals: 2, drawings: 2, ifc: 1 }), "score", "Variant: 1 IFC of 2 drawings -> ifcRatio 0.5 (+5): 100 - 20 - 10 + 5 = 75 on the card (the rule basis has no offset: 80).", [P(392), H("backend/src/routes/health.js", "471-478")], { assumption: true, company: C_HLT }),
    delayedExpected: F(0, "count", "HR-K2: the 50-working-day activity's working-day finish is after today -> 0 delayed.", [P(941, 966, 1057)], { today: 1, company: C_HLT }),
    delayedExampleDates: F({ start: HLT_EXAMPLE.start, calendarFinish: HLT_CAL_FINISH, workingFinish: HLT_WD_FINISH, runDate: HLT_EXAMPLE.runDate }, "date",
      `A function of the run date, rules.delayedExampleDatesFor(runDate) (builders' adjudication 087-EXC/HLT item 7, R3-10); the value is its result for the reference run date ${HLT_EXAMPLE.runDate}. Rule: start = the Monday on or before (run date - 51) = ${HLT_EXAMPLE.start}; H50 (50 working days, ES 0, EF 50 from the project start) has its calendar finish start + 50 = ${HLT_CAL_FINISH} (card and workspace add earlyFinish as calendar days: before today -> delayed 1) and its working-day finish ${HLT_WD_FINISH} (50 working days = 10 whole weeks on the five-day calendar, exclusive finish = start + 70: after today -> 0 under HR-K2). The plan's window: the two finishes fall on either side of today for every today from ${HLT_EXAMPLE.windowFrom} through ${HLT_EXAMPLE.windowThrough} (start + 50 <= today <= start + 69). The rule puts the calendar finish on or before run date - 1, so it is already past at any instant of the run date in any zone, and leaves the WP-9 proof the longest window after the build (13 to 19 days; here ${HLT_EXAMPLE.runDate}..${HLT_EXAMPLE.windowThrough}). The start is on or before the plan's cutoff ${HLT_CUTOFF} (startOnOrBeforeCutoff) for run dates through ${HLT_LATEST_RUN_DATE}. The book's former example (start 2026-08-10, finishes 2026-09-29 / 2026-10-19 = run date - 60, the window's midpoint) agreed with the window inequality but came from no stated rule and left the proof only until 2026-10-18; it is replaced on paper by this rule, which the builder calls instead of its own.`,
      [P(392), PF(431), H("backend/src/routes/health.js", "349-361"), H("backend/src/services/workspace-dashboard.service.js", "167-185"), H("backend/src/utils/activity-status.js", "29-35"), BADJ("087-EXC/HLT item 7; R3-10")], { assumption: true, company: C_HLT, note: "the WP-9 proof reads the card on a date in [windowFrom, windowThrough] of the build's run date (rules.delayedExampleDatesFor(buildRunDate)); outside it the two readings agree (both 0 before windowFrom, both 1 after windowThrough), so delayedExpected / today would not discriminate" }),
    workspaceScheduleWithOverdueRisk: F(clampScore(scoreByIndex(HLT_SPI) - 1 * 5), "score", "60 - 5 x 1 overdue risk mitigation = 55", [P(941), H("backend/src/services/workspace-dashboard.service.js", "1115-1124")], { assumption: true, company: C_HLT, note: "one risk open/monitoring with dueDate past" }),
    partyGuestTopRisks: F("visible (recorded)", "state", "Recorded: the party guest sees supply-chain topRisks on the health card.", [P(942)], { assumption: true, company: C_HLT, note: "the party guest is defined on 087-EXC (plan :397); the probe needs a party guest on the project whose card is read" }),
    supplyChainRecord: F("one long-lead item, criticality 'critical', linked to an activity, status not_ordered, order-by date (need date - leadWeeks x 7 - bufferDays) passed; no other procurement row on 087-HLT", "text",
      "Adjudication F6 (the 087-HLT supply-chain dimension): the plan says only 'an at-risk long-lead item' (plan :392). This record makes it critical (reason order_by_missed: not ordered, order-by slack < 0, schedule-critical by its criticality). Measured through today, not the EV cutoff; only official statuses count (draft, rejected, cancelled, void excluded).",
      [P(392), H("backend/src/services/procurement-risk.service.js", "68-78,191-212,342-359"), H("backend/src/routes/health.js", "22-27,98-100,413-440")], { assumption: true, company: C_HLT }),
    supplyChainCard: F(clampScore(100 - (25 * 1 + 15 * 0 + 8 * 0 + 3 * 0)), "score",
      "Project card: 100 - (25 x critical + 15 x high + 8 x medium + 3 x low) = 100 - 25 x 1 = 75; detail atRiskItems 1 (critical + high + medium), criticalRisks 1, the item in topRisks.",
      [P(392, 941), H("backend/src/services/procurement-risk.service.js", "447-475"), H("backend/src/routes/health.js", "436-440,568-590")],{ assumption: true, company: C_HLT, note: "a high item would give 85, a medium one 92 on the card" }),
    supplyChainWorkspace: F(clampScore(100 - 1 * 12), "score",
      "Workspace dashboard: 100 - 12 x (rows at risk: severity medium or above) = 100 - 12 = 88. The two surfaces disagree (75 against 88) on the same record: the card weights by severity, the workspace counts at-risk rows (the same two-formula pattern as HR-K1).",
      [P(392, 941), H("backend/src/services/workspace-dashboard.service.js", "1010-1020,1138-1140")], { assumption: true, company: C_HLT }),
  },
  risk: {
    states: F(["open", "monitoring", "submitted", "closed", "archived"], "state", "Adjudication F6 (the risk state machine, plan :956): RISK_STATUSES at HEAD.", [P(956), H("backend/src/services/risk.service.js", "23-29")], { company: C_EXC }),
    transitions: F({
      create: "open or monitoring (default open); a body status of submitted / closed / archived -> 400 VALIDATION_ERROR (details.field=status; the route's isIn(['open','monitoring']) answers before the service, so createRisk's RISK_WORKFLOW_ACTION_REQUIRED is not reached through the route)",
      patch: "open <-> monitoring only. A body status of submitted / closed / archived, on a risk in any state -> 400 VALIDATION_ERROR (details.field=status, the same route check, before the service); any other PATCH of an archived risk (no status, or open / monitoring) -> 409 RISK_ARCHIVED (assertNotArchived runs before the status guard); a PATCH moving a submitted or closed risk to open or monitoring -> 400 RISK_WORKFLOW_ACTION_REQUIRED (the only PATCH that reaches it; a PATCH with no status keeps the existing status, which the guard lets through)",
      submit: "open | monitoring -> submitted (POST /:id/submit or /:id/close); other states 409 RISK_NOT_READY_FOR_CLOSEOUT; then 400 RISK_CLOSEOUT_COMMENT_REQUIRED / RISK_RESPONSE_PLAN_REQUIRED / RISK_DUE_DATE_REQUIRED",
      approve: "submitted -> closed; other states 409 RISK_NOT_READY_FOR_APPROVAL",
      reject: "submitted -> monitoring (POST /:id/reject or /:id/disapprove); other states 409 RISK_NOT_READY_FOR_REJECTION; without a reason 400 VALIDATION_ERROR (details.field=reason)",
      reopen: "closed -> monitoring; other states 409 RISK_NOT_READY_FOR_REOPEN; without a reason 400 VALIDATION_ERROR (details.field=reason)",
      archive: "DELETE /:id: any state -> archived (archivedAt set); an archived risk again -> 200, unchanged",
    }, "state",
      "The risk state machine at HEAD. The create / patch status refusals, re-derived from HEAD: POST / and PATCH /:id share riskPayloadValidators, whose body('status').optional().isIn(['open','monitoring']) (routes/risks.js:39) answers a body status of submitted, closed or archived with 400 VALIDATION_ERROR (details.field=status) through validate, before the service (adjudication F1 convention), so createRisk's own RISK_WORKFLOW_ACTION_REQUIRED (:629-636) is not reached through the route. updateRisk then runs assertNotArchived (409 RISK_ARCHIVED, :722-726; archive-policy.service.js:19-25 reads status archived or archivedAt) before assertDirectStatusUpdateAllowed (:730-734, :588-600), so 400 RISK_WORKFLOW_ACTION_REQUIRED is reached only by a PATCH that moves a submitted or closed risk to open or monitoring. The reject / reopen reason refusals are the route's (body('reason').isString().trim().notEmpty() with validate), so the services' APPROVAL_WORKFLOW_REASON_REQUIRED / RISK_REOPEN_REASON_REQUIRED are not reached through the routes (adjudication F1 convention). submit checks the state before the comment, plan and due date.",
      [P(956), H("backend/src/services/risk.service.js", "34-38,128-134,574-576,588-600,620-636,712-734,797-860,919-945,996-1032,1089-1125,1178-1205"), H("backend/src/routes/risks.js", "18-53,54-62,85-99,101-205,207-222,224-237"), H("backend/src/services/archive-policy.service.js", "19-25"), H("backend/src/middleware/validate.js", "7-25")], { company: C_EXC }),
    mix: F("one risk per state: R-OPEN (open, mitigation due date past), R-MON (monitoring, due in the future), R-SUB (submitted), R-CLO (closed), R-ARC (archived), each linked to the same 087-EXC activity", "text",
      "The plan asks for risks in every state, including overdue and archived, with activity links (plan :391); this mix is the one the counts below assume.", [P(391, 956)], { assumption: true, company: C_EXC }),
    registerDefault: F(4, "count", "GET /risks hides archived rows by default (archivedAt null): open + monitoring + submitted + closed = 4.", [P(956), H("backend/src/services/risk.service.js", "602-617"), H("backend/src/services/archive-policy.service.js", "12-17")], { assumption: true, company: C_EXC }),
    registerWithArchived: F(5, "count", "?includeArchived=true: 5 (and ?status=archived: 1).", [P(956), H("backend/src/services/archive-policy.service.js", "12-17")], { assumption: true, company: C_EXC }),
    activitySummary: F({ count: 3, openCount: 1, monitoringCount: 1, submittedCount: 1, overdueCount: 1 }, "state",
      "The activity's projectRiskSummary (activity detail and schedule rows): closed and archived links are left out -> 3 active links; overdue = due date before today and status not submitted / closed -> R-OPEN only = 1.",
      [P(956), H("backend/src/services/risk.service.js", "343-407"), H("backend/src/services/activity.service.js", "249"), H("backend/src/services/schedule.service.js", "2931")], { assumption: true, company: C_EXC }),
  },
  export: {
    sheets: F(6, "count", "Project XLSX: 6 sheets.", [P(944)]),
    rows: F(NETWORK.length, "count", "14 activity rows (M900 included: HR-S2).", [P(944, 30)]),
    critical: F(CRITICAL_CODES.length, "count",
      `CPM forward/backward (FS, lag 0): finish ${NET.finish}; TF A140 = ${NET.activities.get("A140").lf} - ${NET.activities.get("A140").ef} = ${NET.activities.get("A140").tf}, A300 = ${NET.activities.get("A300").lf} - ${NET.activities.get("A300").ef} = ${NET.activities.get("A300").tf}; the other 12 (milestone M900 included, HR-S2) have TF 0. The workspace dashboard's critical list excludes milestones (11).`,
      [P(944, 30), "backend/scripts/phase21/stage2-schedule.js:41-62"]),
    wbsSUB: F(`${wbsSummary("SUB").activities} / ${wbsSummary("SUB").days}`, "text", "A100 5 + A110 10 + A120 3 + A130 12 + A140 4 = 5 activities / 34 days", [P(944)]),
    wbsSUP: F(`${wbsSummary("SUP").activities} / ${wbsSummary("SUP").days}`, "text", "A200 8 + A210 6 + A220 7 + A230 8 = 4 / 29", [P(944)]),
    wbsARC: F(`${wbsSummary("ARC").activities} / ${wbsSummary("ARC").days}`, "text", "A300 10 + A310 9 + A320 7 + A330 6 + M900 0 = 5 / 32", [P(944)]),
    retiredActivityRows: F(0, "count", "A retired activity is excluded (today it appears).", [P(945, 1062)], { today: 1 }),
    archivedRiskRows: F(0, "count", "An archived risk is excluded (today it appears).", [P(945, 1062)], { today: 1 }),
    xerA110: F(80 / 8, "working_days", "80 h / 8 = 10 working days on the round trip.", [P(68, 947)]),
    sheetGate: F("one permission per sheet", "state",
      `Each sheet is gated by its own module permission (HR-K7); a member denied risk:read gets no risk sheet. For the plan's 087 member with cost:export but denied risk:read (plan :435 @f599e67; 087-EXTRAS gives that member a template on 087-EXC): GET /projects/:projectId/export/xlsx answers 200 with no sheet named "${EXPORT_RISK_SHEET_HEAD}" (R3-9); which other sheets that member receives is the HR-K7 fix's choice of per-sheet gates. Today (HEAD), from the route guard and the export service: the route passes nestedProjectAccess (project access only: param check, validate, requireProjectAccess; projects.js:55-59, mounted at :468), then requirePermission('cost', 'export') (export.js:17-19), its only permission check (rbac.js:138-163 -> hasPermission :50-66; the member's template grants cost|action:export, so it passes). generateProjectExport({ projectId, orgId }) (export.js:21-24) is given no user and checks no permission; it reads the project's risks with no filter (export.service.js:90-93) and adds the same ${EXPORT_SHEETS_HEAD.length} worksheets unconditionally, in this order: ${EXPORT_SHEETS_HEAD.join(", ")} (export.service.js:179, 209, 234, 259, 270, 316; ${EXPORT_SHEETS_HEAD.length} = WP9.export.sheets). So the member denied risk:read gets 200 and all ${EXPORT_SHEETS_HEAD.length} sheets, "${EXPORT_RISK_SHEET_HEAD}" included: HR-K7's known answer, as the round-1 087-EXTRAS build observed (200, 6 sheets, Risks included).`,
      [P(396, 946, 1062), PF(435, 983, 985, 1008, 1101), H("backend/src/routes/export.js", "15-24,41"), H("backend/src/routes/projects.js", "55-59,468"), H("backend/src/middleware/rbac.js", "50-66,138-163"), H("backend/src/services/export.service.js", "69-93,179,209,234,259,270,316"), BADJ("Round 2 R2-B (B1); R3-9")],
      { assumption: true, today: { answer: "200", sheets: EXPORT_SHEETS_HEAD }, note: "today is the answer in the 087-EXTRAS step's terms: { answer: said(res) ('200': no error code), sheets: the workbook's sheet names in order }. The proof's value check: answer '200' and no sheet named Risks. Every product file cited here is unchanged at f599e67." }),
  },
  reportBuilder: {
    activities: F(NETWORK.length, "count", "Certified project: 14 activities.", [P(949)]),
    complete: F(1, "count", "A110 approved 100% -> complete.", [P(949), H("backend/scripts/phase21/snapshot.js", "28")]),
    inProgress: F(2, "count", "A120 50% and A130 25% -> in progress.", [P(949)]),
    todo: F(NETWORK.length - 3, "count", "14 - 1 - 2 = 11 at 0% and not past their end (the certified project starts 2027-01-04; valid while the run date is before the first open activity's end, A100 ~2027-01-09).", [P(949)], { assumption: true }),
    totalDuration: F(NETWORK.reduce((s, r) => s + r[1], 0), "working_days", "34 + 29 + 32 = 95", [P(949)]),
    original: F(cents(T_ORIGINAL), "cents", "1,700,000.00", [P(950), H("backend/scripts/phase21/snapshot.js", "42")]),
    actual: F(cents(660 + 60_000 + 8_500 + 2_000), "cents", "660 + 60,000 + 8,500 + 2,000 = 71,160.00", [P(950), H("backend/scripts/phase21/snapshot.js", "61-62")]),
    committed: F(cents(100_000), "cents", "100,000.00", [P(950), H("backend/scripts/phase21/snapshot.js", "60")]),
    xlsxEqualsPreview: F(true, "bool", "XLSX totals equal the preview totals.", [P(951)]),
    pdfRowsLine: F("Rows 14", "text", "The PDF states 'Rows 14'.", [P(951)]),
    scheduledRecipientDownload: F("200", "http", "The scheduled recipient's download answers 200 (today 403; HR-K6).", [P(952, 970, 1061)], { today: "403" }),
  },
  audit: {
    periodLockEvents: F(1, "count", "A period lock writes 1 audit event (today 0).", [P(955)], { today: 0 }),
  },
  history: {
    activationKeepsIds: F(true, "bool", "Activation and rollback keep activity ids (schedule history).", [P(957)], { company: C_EXC }),
    rollbackRefusals: F({
      noReason: "400 VALIDATION_ERROR (details.field=reason; message 'A rollback reason is required.')",
      unknownRevision: "404 REVISION_NOT_FOUND",
      notActive: "409 REVISION_NOT_ACTIVE",
      noPreviousActive: "409 ROLLBACK_TARGET_NOT_FOUND",
      targetWithoutActivities: "409 ROLLBACK_TARGET_HAS_NO_ACTIVITIES",
    }, "state",
      "Adjudication F6 (rollback refusal codes, `today` from HEAD; no §5 rule changes them, so the expected codes are HEAD's). POST /schedule/revisions/:revisionId/rollback: the route's reasonRequired chain answers a missing or blank reason first through validateWithReasons (the message is the chain's own text; the service's ROLLBACK_REASON_REQUIRED is not reached through the route); then the service: an unknown revision 404 REVISION_NOT_FOUND; a revision that is not the active one (e.g. 087-EXC's superseded baseline revision) 409 REVISION_NOT_ACTIVE; the first activated revision, which has no previous active one, 409 ROLLBACK_TARGET_NOT_FOUND; a previous revision stored without activities (recorded by hand) 409 ROLLBACK_TARGET_HAS_NO_ACTIVITIES. A baselined target also meets the BOQ lock's refusals (BOQ_REQUIRED_FOR_BASELINE / BOQ_VALUE_REQUIRED_FOR_BASELINE / BOQ_SCOPE_REQUIRED_FOR_BASELINE) before any write.",
      [P(391, 957), H("backend/src/routes/schedule.js", "107-118,298-307"), H("backend/src/middleware/validate.js", "34-56"), H("backend/src/services/schedule.service.js", "3517-3592")],
      { today: { noReason: "400 VALIDATION_ERROR", unknownRevision: "404 REVISION_NOT_FOUND", notActive: "409 REVISION_NOT_ACTIVE", noPreviousActive: "409 ROLLBACK_TARGET_NOT_FOUND", targetWithoutActivities: "409 ROLLBACK_TARGET_HAS_NO_ACTIVITIES" }, company: C_EXC }),
  },
  mutations: {
    engineSwitch: F("evaluation runs with the switch not 'true'", "state", "The switch removed: the shared API would evaluate; the proof must go red.", [P(959)]),
    mustNot: F("fingerprint delta > 0", "state", "A budget-line write inside the plan breaks the must-not fingerprint.", [P(926, 959)]),
    notificationScope: F("087-OTH staff notified (> 0)", "state", "Project scope removed after its fix: role-addressed notices reach 087-OTH again.", [P(959)], { company: C_OTH }),
    reportDownloadRule: F("403", "http", "Download rule reverted: the scheduled recipient gets 403 again.", [P(959)]),
  },
};

const TREE = { WP0, WP8, WP9 };

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

/** company code -> figure keys (087-FLD, 052-FLD, 087-EXC, 087-HLT, 087-OTH). */
function byCompany() {
  const map = {};
  for (const f of figures()) if (f.company) (map[f.company] = map[f.company] || []).push(f.key);
  return map;
}

module.exports = {
  meta: {
    section: "field-controls",
    head: HEAD,
    plan: PLAN,
    scope: ["WP0 stage1:86", "WP0 stage14:56", "WP8", "WP9", "087-FLD", "087-EXC", "087-HLT", "087-OTH", "052-FLD"],
    ownerDecisions: { "HR-S2": "milestones are valid zero-duration elements (plan :30)" },
  },
  WP0,
  WP8,
  WP9,
  rules: { qualityScore, safetyScore, scoreByIndex, weather, promoteDays, multiplierFor, labourCents, overRatioSeverity, submitBy, submittalImpactDays, addWorkingDays, cpm, delayedExampleDatesFor, endOfLocalDay },
  figures,
  byCompany,
};
