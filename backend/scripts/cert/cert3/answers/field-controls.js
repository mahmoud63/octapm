"use strict";
/**
 * CERT-3 WP-0 answer book, section "field-controls".
 *
 * Scope (docs/certification/OCTAPM_CERT3_PLAN.md):
 *   - WP-0 stage-table rows stage1:86 and stage14:56 (plan :457)
 *   - WP-8 field, quality and documents (plan :832-899; :872-939 at HEAD 14a3db2, WP-8 G12)
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
 *               planValue?, today?, ref?, company?, note? }
 *   value          the expected answer (what the proof must assert)
 *   today          what HEAD does now, where the plan says it differs ("today X")
 *   ref            the undecided section 5 row a today is BLOCKED under (WP-7 G2)
 *                  (from WP-8 also an unlanded fix-list item: SAFE-ARCH-1, RFI-RESP-1; WP8_REFS)
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
 *
 * The WP-7 answer-book patch (2026-10-10; the integration owner's binding adjudication
 * C:/Temp/octapm-cert/scratch/wp7/WP7-ADJUDICATION.md Q12, from WP7-PREP.md section 10 G2): the two
 * leaves of this book that WP-7 reads with a today, WP8.dailyLog.promoteResponseVsStored and
 * WP8.weather.nonContractualAddsNothing, name their ref HR-C11 (WP-7's rule; the KA.I9 ruling: a leaf
 * with a today names its ref, is an assumption, and its value never equals its today), so F() takes a
 * ref and figures() emits it. Nothing else changes; WP-8's own patch chains after this one. Changed
 * keys: answers/CHANGES-WP0-BUILDERS.md, "WP-7 answer-book leaves (2026-10-10)".
 *
 * The WP-8 answer-book patch (2026-10-10; the integration owner's binding adjudication
 * C:/Temp/octapm-cert/scratch/wp8/WP8-ADJUDICATION.md Q1-Q14, cited WP8ADJ(...); the preparation
 * C:/Temp/octapm-cert/scratch/wp8/WP8-PREP.md beside it, PREP8(...)) applies the answer-book gaps G1-G23
 * of WP8-PREP.md section 10: G1 (WP8.F8 and WP8.F8V: the fresh throwaway projects F8, which carries every
 * WP-8 writing check and every section 6.2 catcher, and F8V, the 6-major clamp catcher and the probes that
 * would move F8's 21, both in 087, Q1, Q10), G2 (a ref on every WP-8 leaf with a today, from WP8_REFS:
 * HR-C11, HR-F1..F6, HR-Q3..Q5, HR-X1, HR-K1, SAFE-ARCH-1 (Q4) and RFI-RESP-1 (Q5)), G3 (the seven
 * "(recorded)" values now the section 5 recommendation, HEAD's answer their today), G4 (KA.Q3.087.score's
 * leaf WP8.quality.formItpCounted087FLD: value 6, today 21, Q3), G5-G8 (the leaves that held HEAD's figure
 * as their value: overdueHealth, rateChangeRecorded, severityDowngradeProbe and legacyItpFailedToPassedProbe;
 * the new HR-F4 and HR-F5 leaves), G9-G11 (safety, the two RFI paths, punch), G12 (every WP-8 leaf cites the
 * plan at HEAD 14a3db2, PH8, but the WP-7-owned weather leaves), G13 (the mutation leaves name their
 * catchers by check id), G14 (WP8.CF: the confirm-first observations), G15 (F8's manpower), G16 (HR-X1's
 * text-only probe: ref HR-X1, judged on the HR-X1 batch's own leaf once it lands), G17 (WP8-TRN-1), G18
 * (WP8.leads), G19-G21 (F8's submittal impact, drawings and meetings), G22 (the 052-FLD live reads) and
 * G23 (the open major NCR closed on F8, not 087-FLD). No WP-8 rule is decided and no WP-8 fix has landed:
 * every WP-8 leaf with a today names its ref, is an assumption, and its value never equals its today (the
 * KA.I9 ruling). Load checks after the WP-7 one tie the new and changed leaves to their sources. Changed
 * keys: answers/CHANGES-WP0-BUILDERS.md, "WP-8 answer-book leaves (2026-10-10)".
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
  if (opts.ref !== undefined) leaf.ref = opts.ref;
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

// --- WP-8 answer-book leaves (2026-10-10): citation helpers, the throwaway projects F8 and F8V, models ---
/** The integration owner's binding adjudication of the WP-8 preparation (2026-10-10, Q1-Q14 and the standing rulings). */
const WP8ADJ = (item) => "C:/Temp/octapm-cert/scratch/wp8/WP8-ADJUDICATION.md " + item;
/** The WP-8 preparation (read only, 2026-10-10), whose section 10 answer-book gaps G1-G23 the adjudication settles. */
const PREP8 = (item) => "C:/Temp/octapm-cert/scratch/wp8/WP8-PREP.md " + item;
/**
 * Plan lines at HEAD 14a3db2 (WP-8 G12; the plan is byte-identical to bde300d's). The book's WP-8 P(...) were numbered at
 * b0ec5b0 plus the Q-KEY line at 36; at 14a3db2 the WP-8 section (:872-939), the section 3.2 rows, the section 5 rows,
 * the fix list and section 6.2 sit 40 lines lower (P(838) = PH8(878)) and section 1.1 21 lower (P(71) = PH8(92)). Every
 * WP-8 leaf but the WP-7-owned weather leaves cites PH8, each line mapped by its content
 * (C:/Temp/octapm-cert/scratch/wp8/book/tools/plan-map.js).
 */
const PH8 = (...lines) => PLAN + ":" + lines.join(",") + " @14a3db2";
/** Product code and the builders read at HEAD 14a3db2. Since 886c9f1 only meeting.service.js and task.service.js changed among the WP-8 files (D-PAGE-1, in their list functions), so the book's @886c9f1 product citations hold line for line elsewhere. */
const HF8 = (file, lines) => file + ":" + lines + " @14a3db2";
const DERIVE_F8 = "C:/Temp/octapm-cert/scratch/wp8/derive-f8.json (F8's, F8V's and the HR-Q3 / health readings of 087-FLD and 052-FLD with independent arithmetic; 68 cross-checks against this book's leaves)";
/** 087-FLD's complete-fail form ITP instance on A120 (WP-2's hold-point fixture, state itp.failed; WP8-PREP section 0 fact 6): counted under HR-Q3's recommendation, not at HEAD. */
const FLD_FORM_FAILED = 1;
/** The legal punch pairs whose rule needs a reason (TRANSITION_RULES reasonRequired): reopen 2, dispute 2, void 4. */
const PUNCH_REASON_PAIRS = Object.values(PUNCH_TABLE).reduce((n, row) => n + Object.values(row).filter((v) => v.startsWith("ok with reason")).length, 0);
/**
 * The refs a WP-8 known answer may carry: the undecided section 5 rows WP-8 judges (HR-C11 is WP-7's, read by
 * KA.DL.*), HR-X1 (decided; its batch has not landed, FIXES['HR-X1']), and the two fix-list items WP-8 reproduces,
 * SAFE-ARCH-1 ("health excludes archived incidents", plan :1116; provisionally P2, WP8ADJ Q4) and RFI-RESP-1 ("the RFI
 * official response is frozen after closure", :1114; provisionally P1, Q5). Neither fix has landed, so every WP-8 leaf
 * with a today is BLOCKED at it, is an assumption, and its value never equals its today (the KA.I9 ruling). A refusal
 * value { refused: true, code: null, ... } reads "not 2xx and nothing changed"; its status and code are the decision's
 * or the fix's CONTRACT entry, null until filled (the WP-2 .. WP-7 pattern).
 */
const WP8_REFS = ["HR-C11", "HR-F1", "HR-F2", "HR-F3", "HR-F4", "HR-F5", "HR-F6", "HR-Q3", "HR-Q4", "HR-Q5", "HR-X1", "HR-K1", "SAFE-ARCH-1", "RFI-RESP-1"];
/** The leaves with a today that the 27 KA checks of WP8-PREP section 6 read in this book, each with its ref (checked at load). commercial.js's WP7.weather["087-FLD.promoted.days"] (HR-C11), which KA.DL.087.promoteStored also reads, is checked in that book. */
const WP8_KNOWN = [
  ["WP8.dailyLog.promoteResponseVsStored", "HR-C11"],
  ["WP8.dailyLog.approveFromOpen", "HR-F4"],
  ["WP8.dailyLog.approveEmptyDay", "HR-F4"],
  ["WP8.dailyLog.reopenWithoutReason", "HR-F4"],
  ["WP8.timesheet.rateChangeRecorded", "HR-F5"],
  ["WP8.timesheet.capAcrossSheets", "HR-F5"],
  ["WP8.timesheet.inactiveWorker", "HR-F5"],
  ["WP8.quality.formItpFailureNotCounted", "HR-Q3"],
  ["WP8.quality.formItpCounted087FLD", "HR-Q3"],
  ["WP8.quality.severityDowngradeProbe", "HR-Q5"],
  ["WP8.quality.legacyItpFailedToPassedProbe", "HR-Q4"],
  ["WP8.quality.evidenceWipedBeforeApprovalProbe", "HR-Q5"],
  ["WP8.quality.textOnlyEvidenceProbe", "HR-X1"],
  ["WP8.quality.hardDeleteProbe", "HR-Q4"],
  ["WP8.punch.finalApproverBypass", "HR-F3"],
  ["WP8.safety.health", "SAFE-ARCH-1"],
  ["WP8.052-FLD.safetyHealth", "SAFE-ARCH-1"],
  ["WP8.safety.ltiEditAfterClosure", "HR-Q5"],
  ["WP8.rfi.officialResponseAfterClose", "RFI-RESP-1"],
  ["WP8.rfi.officialResponsePaths", "RFI-RESP-1"],
  ["WP8.rfi.overdueHealth", "HR-K1"],
  ["WP8.rfi.overdueHealthF8", "HR-K1"],
  ["WP8.submittal.pmApprovalWhileStepsPending", "HR-F1"],
  ["WP8.drawing.approveWithoutReview", "HR-F2"],
  ["WP8.drawing.approveOutOfOrder", "HR-F2"],
  ["WP8.transmittal.distributeBypass", "HR-F6"],
  ["WP8.transmittal.actionItemIdentity", "HR-F6"],
  ["WP8.transmittal.createTaskTasks", "HR-F6"],
];
/** The WP-7-owned leaves of the WP8 tree (judged by the WP-7 proof; their plan citations stay as the WP-7 patch left them). */
const WP7_OWNED_WP8 = (key) => key.startsWith("WP8.weather.") || /^WP8\.052-FLD\.weather/.test(key);

/**
 * F8: the WP-8 proof's own throwaway project in company 087 (WP8ADJ Q1; WP8-PREP section 5.1), created by the PM and
 * archived by the proof, as WP-1's W ... WP-7's T7. Every WP-8 writing check and every section 6.2 catcher runs on it,
 * because the mutation runner runs the whole proof under each mutant; on 087-FLD and 052-FLD the proof only reads, plus
 * the 087-FLD party user's entry on the submitted day D5, refused 409 before any write (WP8ADJ Q2). Days are offsets from
 * 087's run date R = min(today in UTC, today in Africa/Cairo) (build/lib.js): every F8 transaction is dated R-6 .. R-1,
 * plan dates may lie after R, and nothing is placed on the five-day calendar, so a weekend R does not fail WP-8. Records as
 * sent (currency units); the leaves state cents. The figures agree with derive-f8.json.
 */
const F8_BOOK = {
  project: { name: "CERT3 WP8 field <stamp>", type: "building", contractType: "unit_rate", startDate: "R-60", endDate: "R+240", projectCalendar: "five_day", currency: "EGP" },
  team: { roles: { planning_eng: "planner", qs: "qs", cost_controller: "cost", site_engineer: "site", warehouse: "storeman" }, noProjectRole: ["quality"] },
  activities: [["F8-A1", "site"], ["F8-A2", "site"], ["F8-A3", "site"], ["F8-A4", "site"]],
  workers: { "W8-1": { trade: "Steelfixer", hourlyRate: 50, overtimeMultiplier: 1.5 }, "W8-R": { hourlyRate: 50 }, "W8-I": { hourlyRate: 50 }, crew: { code: "C8", members: ["W8-1"], defaultActivity: "F8-A1", defaultHours: 8 } },
  evidence: { upload: "POST /projects/F8/workflow/uploads by the site engineer, one per closeout", reference: "{ documentId, fileName, storageKey: documentId } of that fresh upload", why: "accepted at HEAD (normalizeAttachmentRefs keeps a storageKey) and canonical after the HR-X1 batch, so the same choreography runs before and after it" },
  days: [
    { day: "DA", date: "R-6", entries: [["Steelfixer", 5, 8, "F8-A1", "approved"], ["Carpenter", 3, 10, "F8-A2", "approved"], ["Labourer", 2, 8, "F8-A2", "rejected"]], note: "internal entries (created approved, daily-log.service.js:926); the site engineer's review rejects the Labourer, first with no reason (400), then with one" },
    { day: "DB", date: "R-5", delays: [[2, "F8-A1"], [6, "F8-A2"], [10, "F8-A3"]], note: "each delay entry promoted by the planner" },
    { day: "DC", date: "R-4", note: "a note; submitted; approved by the PM; PATCH, entry add and entry delete; then the PM's reopen with no reason" },
    { day: "DD", date: "R-3", note: "a note; the PM approves the open day" },
    { day: "DE", date: "R-2", note: "a summary PATCH creates an empty day; the PM approves it" },
  ],
  timesheets: [
    { sheet: "TS-1", date: "R-5", worker: "W8-1", activity: "F8-A1", entries: [[8, "regular"], [2, "overtime"], [1, "double"]], flow: "submitted; returned by the cost controller with no reason (400), then approved" },
    { sheet: "TS-2", date: "R-4", worker: "W8-1", entries: [[25, "regular"]], split: [16, 9], flow: "one 25 h entry; then 16 + 9 on one sheet" },
    { sheet: "TS-3", date: "R-3", crew: "C8", flow: "pre-filled, then the same crew and date again" },
    { sheet: "TS-4", date: "R-2", worker: "W8-1", acrossSheets: [16, 9], flow: "16 h on S1, then 9 h on S2 the same day" },
    { sheet: "TS-5", date: "R-1", worker: "W8-R", entries: [[8, "regular"]], rateChange: [50, 60], flow: "submitted at 50.00; the rate changed to 60.00; approved by the cost controller" },
    { sheet: "TS-6", date: "R-1", worker: "W8-I", flow: "W8-I set inactive, then a sheet naming W8-I" },
    { sheet: "TS-7", worker: "a worker at multiplier 0.5", flow: "POST /workers and POST /workers/import, both refused" },
  ],
  qualityMix: { ncrs: [["major-open", "major", "open", "F8-A1"], ["major-closed", "major", "closed", "F8-A2"], ["minor-open", "minor", "open", "F8-A3"], ["minor-submitted", "minor", "submitted", "F8-A4"], ["minor-closed", "minor", "closed", "F8-A1"]], legacyItps: ["failed", "waived", "passed"], formInstances: 0 },
  punchMix: { punch: { draft: 2, open: 2, ready_for_review: 1, in_dispute: 1, closed: 1, void: 1 }, observations: { safety: "open", environmental: "draft", quality: "closed", work_to_complete: "void", commissioning: "closed" }, finalApprover: "quality", manager: "pm" },
  safetySet: { incidents: [{ ref: "SF-NM", type: "near miss", status: "open", activity: "F8-A1" }, { ref: "SF-LTI", type: "LTI", status: "closed", lostDays: 3, activity: "F8-A2" }, { ref: "SF-ARC", type: "near miss", status: "archived", by: "the PM's DELETE" }], ltiEditTo: 5, fatality: { ref: "SF-FAT", status: "open", after: "SF-2's reads" } },
  rfis: { "RFI-C": { status: "closed", scheduleImpactFlag: true, scheduleImpact: 3, activity: "F8-A1", answeredBy: "planner", approvedBy: "pm" }, "RFI-RRB": { status: "open", responseRequiredBy: "R-3", dueDate: null }, "RFI-ANS": { status: "answered", dueDate: "R-4", responseRequiredBy: null } },
  submittals: { T8: { steps: [["qs", 3], ["planning_eng", 4]] }, "SUB-D": { template: null, requiredOnSite: "2027-01-25", leadTimeWeeks: 2 }, "SUB-T": { template: "T8", requiredOnSite: "2027-01-25", leadTimeWeeks: 2 }, "SUB-R": { template: "T8", decision: "the QS rejects revise_resubmit with a comment, then the site engineer resubmits" }, "SUB-I": { template: null, requiredOnSite: "R+5", leadTimeWeeks: 2, activity: "F8-A2" } },
  drawings: { "F8-S1": { A: { status: "superseded" }, B: { status: "approved", latest: true }, C: { status: "uploaded" }, X8: { status: "approved", latest: false, filedBy: "pm" } }, "F8-S2": { A: { status: "uploaded", then: "approved by the PM without review" }, B: { status: "uploaded", then: "reviewed; approved after C" }, C: { status: "uploaded", then: "reviewed; approved first" } } },
  meetings: { M8a: "draft; PATCH status distributed", M8b: "draft with attendees: POST distribute, then a PATCH of its minutes; its distribution rows read", M8c: { items: [{ n: 1, createTask: true, owner: "site" }, { n: 2, createTask: false }], edit: "PATCH re-sending the items without taskId" } },
  l213Template: { name: "CERT3 WP8 task update without close", baseRole: "qs", grants: ["task|action:update"], assignedOn: "F8 only", reuse: "found or created by name" },
};
const F8_STEPS = [
  "F8-0 PM: project and team (the quality engineer with no project role, RJ-12); the planner hand-builds F8-A1..A4 with engineerIds [site] -> S.F8.create",
  "F8-1 site: workers W8-1, W8-R, W8-I; crew C8 -> S.F8.workers",
  "F8-2 site: one own upload per closeout -> S.F8.evidence",
  "DA site and PM (R-6): the manpower mix; the Labourer's review without a reason, then with one; the manpower report by trade -> DL.F8.rejectWithoutReason, DL.F8.manpower",
  "DB site and planner (R-5): delays 2 h, 6 h, 10 h promoted; the register rows read back -> DL.F8.promoteEcho, KA.DL.F8.promoteStored",
  "DC site and PM (R-4): submitted, approved; PATCH, entry add, entry delete; then the reopen without a reason -> DL.F8.approvedPatch, DL.F8.approvedAdd, DL.F8.approvedDelete, KA.F4.F8.reopenNoReason",
  "DD PM (R-3): the open day approved -> KA.F4.F8.approveFromOpen",
  "DE PM (R-2): the empty day approved -> KA.F4.F8.approveEmpty",
  "TS-1 site and cost (R-5): the mixed day; returned without a reason, then approved -> TS.F8.rejectWithoutReason, TS.F8.mixed",
  "TS-2 site (R-4): one 25 h entry; 16 + 9 on one sheet -> TS.F8.hours25Single, TS.F8.hours25Split",
  "TS-3 site (R-3): C8 pre-filled, then again -> TS.F8.sameCrewDate",
  "TS-4 site (R-2): W8-1 16 h on S1, 9 h on S2 -> KA.F5.F8.capAcrossSheets",
  "TS-5 site and cost (R-1): W8-R submitted, rate 50 to 60, approved -> KA.F5.F8.rateTiming",
  "TS-6 site (R-1): W8-I inactive, a sheet naming W8-I -> KA.F5.F8.inactiveWorker",
  "TS-7 site: a worker at 0.5 by create and by import -> TS.F8.halfRefused",
  "Q-1 site and quality: the NCR mix with own evidence, the closed ones approved; legacy ITPs failed, waived, passed",
  "Q-2 PM: the quality dashboard, the health card, the workspace -> Q.F8.dashboard21, Q.F8.health21, Q.F8.workspace21",
  "Q-3 quality: the six NCR codes -> Q.F8.ncrReject, Q.F8.ncrReopen, Q.F8.ncrApproveClose",
  "Q-4 site and quality: major-open closed out and approved -> Q.F8.closeMajor",
  "Q-5 quality: major-closed downgraded, then back; the failed legacy ITP to passed, then back -> KA.Q5.F8.severityDowngrade, KA.Q4.F8.legacyItpStatus",
  "P-1 site, quality and PM: the punch and observation mix; the ready item closed by the PM (403), then by the quality engineer only while still ready_for_review -> P.F8.closeByNonApprover",
  "P-2 PM: the dashboard; the transition table -> P.F8.mix, P.F8.transitionTable",
  "P-3 site and PM: a new open item, the PM set as final approver by the site engineer, closed by the PM -> KA.F3.F8.approverBypass",
  "SF-1 site, quality and PM: near miss open, the LTI closed out and approved, a near miss archived by the PM's DELETE",
  "SF-2 PM: health, workspace, quality dashboard -> KA.SAFE.F8.health, SF.F8.workspace, SF.F8.dashboard",
  "SF-3 site: the closed LTI's lost days 3 to 5 -> KA.Q5.F8.ltiEdit",
  "SF-4 site and PM: a fatality, open -> SF.F8.fatality",
  "R-1 site, planner and PM: RFI-C answered and approved (closed) -> R.F8.scheduleImpact",
  "R-2 PM: the official answer rewritten by both paths -> KA.RFI.F8.officialAfterClose",
  "R-3 PM: reopen without a reason, then with one -> R.F8.reopenWithoutReason, R.F8.reopenRevision",
  "R-4 site, planner and PM: the baseline reads; RFI-RRB raised, read; RFI-ANS answered, read (no submittal change between) -> KA.K1.F8.rfiOverdueHealth, R.F8.overdueSurfaces",
  "SUB-1 planner and site: T8; SUB-D direct and SUB-T on T8 -> SUB.F8.submitBy",
  "SUB-2 site and PM: SUB-T submitted, step 1 active; the PM approves -> KA.F1.F8.pmApproveWhilePending",
  "SUB-3 site and QS: SUB-R submitted; revise_resubmit; resubmitted -> SUB.F8.responseCodeReset",
  "SUB-4 site and PM: SUB-I submitted and approved -> SUB.F8.impactDays",
  "D-1 planner, site, PM and storeman: F8-S1 A, B, C and X8; the warehouse register -> D.F8.storeman",
  "D-2 PM: approve A; supersede C without a reason -> D.F8.approveSuperseded, D.F8.supersedeWithoutReason",
  "D-3 planner, site and PM: F8-S2 A approved without review; B and C reviewed, C approved, then B -> KA.F2.F8.approveWithoutReview, KA.F2.F8.approveOutOfOrder",
  "T-1 planner: a transmittal and a correspondence naming F8-S1 rev B's document -> CF.TRN1",
  "T-2 planner: a plain transmittal DELETEd; its audit read -> CF.L146",
  "T-3 planner and site: a transmittal with object, number and boolean storage keys -> CF.DVAL1",
  "M-1 planner: M8a -> KA.F6.F8.patchStatus",
  "M-2 planner: M8b distributed from draft, then PATCHed; its distribution rows -> CF.HRF6",
  "M-3 planner: M8c, the items re-sent without taskId -> KA.F6.F8.actionItemIdentity, KA.F6.F8.duplicateTask",
  "L213 PM and QS: the template found or created by name; the QS's done PATCH and close action -> CF.L213",
  "CF the confirm-first classifications from the readings above -> CF.HRF4, CF.HRF5, CF.HRQ5, CF.HRQ4, CF.HRF3, CF.SAFEARCH, CF.RFIRESP, CF.HRK1rfi, CF.HRF1, CF.HRF2",
  "end PM and site: F8 archived; W8-1, W8-R and W8-I set inactive -> S.F8.archived",
];
const F8_STEP_IDS = ["F8-0", "F8-1", "F8-2", "DA", "DB", "DC", "DD", "DE", "TS-1", "TS-2", "TS-3", "TS-4", "TS-5", "TS-6", "TS-7", "Q-1", "Q-2", "Q-3", "Q-4", "Q-5", "P-1", "P-2", "P-3", "SF-1", "SF-2", "SF-3", "SF-4", "R-1", "R-2", "R-3", "R-4", "SUB-1", "SUB-2", "SUB-3", "SUB-4", "D-1", "D-2", "D-3", "T-1", "T-2", "T-3", "M-1", "M-2", "M-3", "L213", "CF", "end"];
const F8_CHECKS = ["S.F8.create", "S.F8.workers", "S.F8.evidence", "S.F8.archived", "DL.F8.promoteEcho", "KA.DL.F8.promoteStored", "DL.F8.approvedPatch", "DL.F8.approvedAdd", "DL.F8.approvedDelete", "DL.F8.manpower", "DL.F8.rejectWithoutReason", "KA.F4.F8.approveFromOpen", "KA.F4.F8.approveEmpty", "KA.F4.F8.reopenNoReason", "TS.F8.mixed", "TS.F8.halfRefused", "TS.F8.rejectWithoutReason", "TS.F8.hours25Single", "TS.F8.hours25Split", "TS.F8.sameCrewDate", "KA.F5.F8.rateTiming", "KA.F5.F8.inactiveWorker", "KA.F5.F8.capAcrossSheets", "Q.F8.dashboard21", "Q.F8.health21", "Q.F8.workspace21", "Q.F8.closeMajor", "Q.F8.ncrReject", "Q.F8.ncrReopen", "Q.F8.ncrApproveClose", "KA.Q5.F8.severityDowngrade", "KA.Q4.F8.legacyItpStatus", "P.F8.closeByNonApprover", "KA.F3.F8.approverBypass", "P.F8.mix", "P.F8.transitionTable", "KA.SAFE.F8.health", "SF.F8.workspace", "SF.F8.dashboard", "KA.Q5.F8.ltiEdit", "SF.F8.fatality", "KA.RFI.F8.officialAfterClose", "R.F8.reopenWithoutReason", "R.F8.reopenRevision", "R.F8.scheduleImpact", "KA.K1.F8.rfiOverdueHealth", "R.F8.overdueSurfaces", "SUB.F8.submitBy", "SUB.F8.impactDays", "KA.F1.F8.pmApproveWhilePending", "SUB.F8.responseCodeReset", "D.F8.storeman", "D.F8.approveSuperseded", "D.F8.supersedeWithoutReason", "KA.F2.F8.approveWithoutReview", "KA.F2.F8.approveOutOfOrder", "KA.F6.F8.patchStatus", "KA.F6.F8.actionItemIdentity", "KA.F6.F8.duplicateTask", "CF.HRF4", "CF.HRF5", "CF.HRQ5", "CF.HRQ4", "CF.HRF3", "CF.SAFEARCH", "CF.RFIRESP", "CF.HRK1rfi", "CF.HRF1", "CF.HRF2", "CF.HRF6", "CF.TRN1", "CF.L213", "CF.L146", "CF.DVAL1"];
const F8_SRC = [PH8("430, 872-939, 1152"), WP8ADJ("Q1, Q10"), PREP8("section 5.1; section 10 G1"), DERIVE_F8];
/** F8V: the second throwaway in 087 (WP8ADJ Q1; WP8-PREP section 5.2): the 6-major clamp catcher and the probes that would move F8's 21. Its score is 0 throughout (6 major alone, 5 after a delete, plus up to 3 minor: below 0 before the clamp). */
const F8V_BOOK = {
  project: { name: "CERT3 WP8 six major <stamp>", type: "building", currency: "EGP" },
  team: { roles: { site_engineer: "site" }, noProjectRole: ["quality"] },
  records: { majorNcrs: 6, raisedBy: "pm", minorNcrs: [["V-E", "own evidence; PATCH attachmentRefs []; approved"], ["V-T", "a fileName-only reference"], ["V-D", "malformed storage keys"]], legacyItp: "one pending legacy ITP made and DELETEd", deletedMajor: 1 },
};
const F8V_STEPS = [
  "V-0 PM: project, team; 6 major NCRs -> S.F8V.create",
  "V-1 PM: the quality dashboard -> Q.F8V.sixMajor",
  "V-2 site and quality: V-E closed out with its own evidence, its references PATCHed to [], approved -> KA.Q5.F8V.evidenceWiped",
  "V-3 site: V-T closed out with a fileName-only reference -> KA.X1.F8V.textOnly",
  "V-4 PM and quality: one major NCR DELETEd; a pending legacy ITP made and DELETEd -> KA.Q4.F8V.hardDelete",
  "V-5 site: V-D closed out with malformed storage keys (the NCR half of the D-VAL-1 probe, classified at T-3)",
  "end PM: F8V archived -> S.F8V.archived",
];
const F8V_CHECKS = ["S.F8V.create", "S.F8V.archived", "Q.F8V.sixMajor", "KA.Q5.F8V.evidenceWiped", "KA.X1.F8V.textOnly", "KA.Q4.F8V.hardDelete"];
const F8V_SRC = [PH8("892, 894, 931"), WP8ADJ("Q1"), PREP8("section 5.2; section 10 G1"), DERIVE_F8];

const WP8 = {
  dailyLog: {
    promote2h: F(PROMOTED[0].days, "days", "round((2/8)*2)/2 = round(0.5)/2 = 1/2 = 0.5", [PH8(878), H("backend/src/services/daily-log.service.js", "1200")], { company: C_FLD }),
    promote6h: F(PROMOTED[1].days, "days", "round((6/8)*2)/2 = round(1.5)/2 = 2/2 = 1.0", [PH8(878), H("backend/src/services/daily-log.service.js", "1200")], { company: C_FLD }),
    promote10h: F(PROMOTED[2].days, "days", "round((10/8)*2)/2 = round(2.5)/2 = 3/2 = 1.5", [PH8(878), H("backend/src/services/daily-log.service.js", "1200")], { company: C_FLD }),
    promoteResponseVsStored: F("response 0.5 / 1.0 / 1.5", "state",
      "The promotion answer echoes the computed delayDays (daily-log.service.js:1216) while the WeatherDelay row stores Number(delayDays) into an Int column (weather.service.js:217); the read-back of the register row is the figure that must equal 0.5/1.0/1.5 (today 0/1/1 per the 558 driver notes) -> HR-C11.",
      [PH8(878, 927, 1079), H("backend/src/services/weather.service.js", "217"), H("backend/src/services/daily-log.service.js", "1200-1216"), PLAN + ":878, 1079 @bde300d", "C:/Temp/octapm-cert/scratch/wp7/WP7-ADJUDICATION.md Q12", "C:/Temp/octapm-cert/scratch/wp7/WP7-PREP.md section 10 G2"], { assumption: true, today: "stored 0 / 1 / 1", ref: "HR-C11", company: C_FLD, note: "WP-7 G2 (2026-10-10, WP7ADJ Q12): ref HR-C11, the undecided row this today is BLOCKED under (the KA.I9 ruling: a leaf with a today names its ref). WP-7 reads the stored rows only as CF.HRC11's evidence (commercial.js WP7.CF.HRC11); WP-8 judges the leaf. Added by WP-7's book patch because HR-C11 is WP-7's rule; WP-8's patch chains after it." }),
    promoteTwice: F("409 DAILY_LOG_WEATHER_DELAY_EXISTS", "http", "A delay entry that already carries weatherDelayId is refused.", [PH8(878), H("backend/src/services/daily-log.service.js", "1198")], { company: C_FLD }),
    approvedDayPatch: F("409 DAILY_LOG_APPROVED", "http", "PATCH of an approved day: updateLog calls assertEditable, which refuses an approved log.", [PH8(879), H("backend/src/services/daily-log.service.js", "657-661,684-689")], { company: C_FLD }),
    approvedDayEntryAdd: F("409 DAILY_LOG_APPROVED", "http", "Entry add on an approved day: addEntry calls the same guard.", [PH8(879), H("backend/src/services/daily-log.service.js", "659,910-921")], { company: C_FLD }),
    approvedDayEntryDelete: F("409 DAILY_LOG_APPROVED", "http", "Entry delete on an approved day: deleteEntry calls the same guard.", [PH8(879), H("backend/src/services/daily-log.service.js", "659,1011-1017")], { company: C_FLD }),
    manpowerSteelfixer: F(5 * 8, "man_hours", "Internal entry 5 workers x 8 h = 40 (status approved, counted).", [PH8(880), H("backend/src/services/daily-log.service.js", "926,1456,1470")], { company: C_FLD }),
    manpowerCarpenter: F(3 * 10, "man_hours", "Party entry 3 workers x 10 h = 30 (status submitted, counted).", [PH8(880), H("backend/src/services/daily-log.service.js", "926,1456,1470")], { company: C_FLD }),
    manpowerLabourer: F("absent", "state", "The 2 x 8 Labourer entry is rejected; the report reads status in [approved, submitted] only, so no Labourer row exists.", [PH8(880), H("backend/src/services/daily-log.service.js", "1456")], { company: C_FLD }),
    manpowerTotal: F(manHours(MP_COUNTED), "man_hours", "40 + 30 = 70 (rejected 16 excluded).", [PH8(880), H("backend/src/services/daily-log.service.js", "1485")], { company: C_FLD }),
    manpowerWorkers: F(workersOf(MP_COUNTED), "count", "5 + 3 = 8 workers (rejected 2 excluded). The day's own totals use the same filter (counted = not rejected, not draft; :521, :544-545).", [PH8(880), H("backend/src/services/daily-log.service.js", "521,544-545,1485")], { company: C_FLD }),
    partyLock: F("409 DAILY_LOG_SUBMITTED", "http", "A party viewer writing to a submitted day (assertEditable, reached from updateLog / addEntry / updateEntry / deleteEntry).", [PH8(881), H("backend/src/services/daily-log.service.js", "660,689,921,982,1017")], { company: C_FLD }),
    rejectWithoutReason: F("400 DAILY_LOG_REASON_REQUIRED", "http", "Entry review with decision reject and no reason.", [PH8(881), H("backend/src/services/daily-log.service.js", "1036")], { company: C_FLD }),
    weekSummaryA130: F(5 * 8, "hours", "Timesheet week summary, activity row A130: 5 workers x 8 h regular = 40 h (weekSummary sums entry hours per activity; timesheet.service.js:736-772).", [PH8(882), H("backend/src/services/timesheet.service.js", "736-772")], { company: C_FLD }),
    manpowerReportA130: F(5 * 8, "man_hours",
      "Manpower report for A130 (groupBy activity) = the internal Steelfixer row 5 x 8 = 40. Agreement at 40 needs the party Carpenter entry on another activity (else A130 reads 70).",
      [PH8(882), H("backend/src/services/daily-log.service.js", "1465-1486")], { assumption: true, company: C_FLD }),
    approveFromOpen: F({ refused: true, code: null, dayStatus: "open" }, "state", "approveLog has no submitted-status check: an open day approves (200); recorded, the rule is HR-F4.", [PH8(883, 928, 1061), H("backend/src/services/daily-log.service.js", "790-812"), HF8("backend/src/services/daily-log.service.js", "790-831"), WP8ADJ("standing rulings"), PREP8("section 0 fact 11; section 10 G2, G3")], { assumption: true, today: "200 approved", ref: "HR-F4", company: C_FLD, note: "WP-8 G2, G3 (2026-10-10): the value was 'approved (recorded)', which restated HEAD; it is now HR-F4's recommendation (approve only submitted days): the PM's approve of F8's open day DD (R-3) is refused and the day stays open; the status and code are CONTRACT['HR-F4'].openApproveAnswer, filled by the decision (while null a refusal is 'not 2xx and nothing changed'). Ref HR-F4, undecided (O1): BLOCKED at the today (KA.F4.F8.approveFromOpen), an assumption. 087-FLD's D1, approved straight from open by its build, is the stored reading of the same today (CF.HRF4)." }),
    approveEmptyDay: F({ refused: true, code: null, dayStatus: "open" }, "state", "HR-F4 (approve only submitted days, and refuse an empty one): F8's DE (R-2) is created empty by a summary PATCH (updateLog's ensureLog creates the day) and the PM approves it: refused, and the day stays open; the status and code are CONTRACT['HR-F4'].emptyApproveAnswer. Today approveLog checks neither the day's status nor its entries (daily-log.service.js:790-831): 200, the empty day approved.", [PH8(883, 928, 1061), HF8("backend/src/services/daily-log.service.js", "684-732, 790-831"), WP8ADJ("standing rulings"), PREP8("section 5.1 DE; section 10 G7")], { assumption: true, today: { status: 200, dayStatus: "approved" }, ref: "HR-F4", company: C_FLD, note: "WP-8 G7 (2026-10-10): new. KA.F4.F8.approveEmpty; BLOCKED at the today while HR-F4 is undecided (O1)." }),
    reopenWithoutReason: F({ status: 400, code: null, dayStatus: "approved" }, "state", "HR-F4 (reopen needs a reason): the PM's reopen of F8's approved day DC (R-4) with no reason is refused 400 and the day stays approved; the code is CONTRACT['HR-F4'].reopenReasonAnswer. Today the route's reason is optional (routes/daily-logs.js:176, optionalText) and reopenLog reopens the day (daily-log.service.js:833-847): 200, the day open.", [PH8(928, 1061), HF8("backend/src/routes/daily-logs.js", "173-178"), HF8("backend/src/services/daily-log.service.js", "833-847"), WP8ADJ("standing rulings"), PREP8("section 5.1 DC; section 10 G7")], { assumption: true, today: { status: 200, dayStatus: "open" }, ref: "HR-F4", company: C_FLD, note: "WP-8 G7 (2026-10-10): new. KA.F4.F8.reopenNoReason; BLOCKED at the today while HR-F4 is undecided (O1). Sent after DC's approved-day probes (DL.F8.approvedPatch / Add / Delete), so that those read the approved day first." }),
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
      [P(390, 819), H("backend/src/services/weather.service.js", "162-165,217"), PF(429, 444, 858, 867, 1078), BADJ("Round 2 R2-B (B5)"), PLAN + ":430, 859, 1079 @bde300d", "C:/Temp/octapm-cert/scratch/wp7/WP7-ADJUDICATION.md Q9, Q12", "C:/Temp/octapm-cert/scratch/wp7/WP7-PREP.md section 10 G2"],
      { company: C_FLD, assumption: true, today: FLD_WEATHER_AT_TODAY.used, ref: "HR-C11", note: `HR-C11 known answer (truncation): observed by the round-1 builds at the 14 point (087-FLD weather.at14: 12, 60%). 052-FLD runs the same record set (plan :444 @f599e67; WP8["052-FLD"].weather* use FLD_WEATHER_*), and the book carries no separate 052-FLD non-contractual figure, so this leaf (value ${FLD_WEATHER_AT.used}, today ${FLD_WEATHER_AT_TODAY.used}) is the one both builders judge against. WP-7 G2 (2026-10-10, WP7ADJ Q12): ref HR-C11, the undecided row this today is BLOCKED under (the KA.I9 ruling), and an assumption: the value 14 holds under HR-C11's decimal days; under a refusal of non-integers the half-day record set itself changes (owner question O2). KA.FLD.087.live reads it (STORED-PRE-FIX after the fix until the exit rebuild, WP7ADJ Q9); the builders read its value and today only (BLD 087-fld.js, 052-fld.js), both unchanged.` }),
    monthlyNonContractual: F(10, "days", "The monthly split books the 10 days under nonContractual of its month.", [P(390, 819), H("backend/src/services/weather.service.js", "178-182")], { assumption: true, company: C_FLD, note: "assumes no other non-contractual delay in that month" }),
    todayBelow: F(pct2(FLD_WEATHER_BELOW_TODAY.pct), "percent",
      "The same records under the Int column: trunc(0.5,1.0,1.5,2.5,7.5) = 0+1+1+2+7 = 11 -> 11/20 x 100 = 55%, no warning (the double is 55.00000000000001; compared at 2 dp the figure is 55, F2). The proof is red at 13 until HR-C11 is decided.",
      [P(70, 820, 828, 1039), H("backend/src/services/weather.service.js", "217")], { assumption: true, company: C_FLD, note: "truncation taken from the 558 driver notes, not executed here" }),
    todayAt: F(pct2(FLD_WEATHER_AT_TODAY.pct), "percent", "11 + 1 = 12 -> 60% (compared at 2 dp, F2), warning false (red at the 70% line until HR-C11).", [P(70, 828, 1039), H("backend/src/services/weather.service.js", "217")], { assumption: true, company: C_FLD }),
  },
  timesheet: {
    mixedDay: F(TS_MIXED_CENTS, "cents",
      "8 h x 50.00 x 1 = 400.00; 2 h x 50.00 x 1.5 (default overtime multiplier) = 150.00; 1 h x 50.00 x 2 (double) = 100.00; 400 + 150 + 100 = 650.00",
      [PH8(445, 885), H("backend/src/services/timesheet.service.js", "70,652-655")], { company: C_FLD }),
    mixedDayLedger: F("costType labour, sourceType timesheet", "state", "Approval posts each entry through the cost ledger with sourceType 'timesheet' and costType 'labour'.", [PH8(885), H("backend/src/services/timesheet.service.js", "669-686")], { company: C_FLD }),
    multiplierHalf: F(2 * RATE * multiplierFor("overtime", 0.5), "cents",
      "2 h overtime at 50.00 with multiplier 0.5: max(1, 0.5) = 1 -> 2 x 50.00 x 1 = 100.00 (the floor; unfloored it would be 50.00). Plan WP-8: 'A multiplier of 0.5 gives 100.00 for 2 h of overtime' (:885 @f599e67). NOT on a built crew: no 0.5 worker can be created through the API (multiplierHalfCreate: 400 VALIDATION_ERROR; multiplierHalfImport: 200 with the row in errors[]; adjudication F1), so 087-FLD holds none and this figure is checked in process, against the service's exported rule multiplierFor('overtime', { overtimeMultiplier: 0.5 }) = 1 (timesheet.service.js:70) and the amount round2(hours x rate x multiplier) (:652-655), never read off a built timesheet.",
      [PH8(430, 886), PF(429, 885), H("backend/src/services/timesheet.service.js", "70,652-655"), ADJ0("F1"), BADJ("087-FLD item 1")], { assumption: true, company: C_FLD, note: "rate 50.00 assumed for that worker; the plan gives only the result. In process only (builders' adjudication 087-FLD item 1)." }),
    multiplierHalfCreate: F("400 VALIDATION_ERROR", "http",
      "POST /workers (and PATCH /workers/:workerId) with overtimeMultiplier 0.5: the route's workerValidators chain body('overtimeMultiplier').isFloat({ min: 1, max: 5 }) refuses it before the service (validate: message 'Validation failed', error.details holds field 'overtimeMultiplier'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); the service's own WORKER_MULTIPLIER_INVALID (:194) is not reached through these routes. So a 0.5 crew member cannot be built through the API (the import refuses the row too: multiplierHalfImport). The plan's 'one of them 0.5' crew member (087-FLD row) is SERVED BY THIS CONTRACT REFUSAL (builders' adjudication 087-FLD item 1): the build step that tries it is DONE, not BLOCKED, when it observes 400 VALIDATION_ERROR with an error.details entry whose field is 'overtimeMultiplier' and no worker created; MOMENT-MAP records the plan item as served by the refusal. The 100.00 figure (multiplierHalf) is checked in process.",
      [PH8(430, 886, 120), PF(429), H("backend/src/routes/timesheets.js", "32,64,66"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/timesheet.service.js", "193-194"), ADJ0("F1"), BADJ("087-FLD item 1")], { planValue: "a crew member with multiplier 0.5 built by the driver (plan :390; :429 @f599e67)", company: C_FLD, note: "details.field=overtimeMultiplier. Plan item served by the contract refusal (builders' adjudication 087-FLD item 1): the plan's 0.5 crew member does not exist on 087-FLD, by contract." }),
    multiplierHalfImport: F({ status: 200, created: 0, updated: 0, skipped: 0, errors: [{ row: 1, message: "The overtime multiplier must be between 1 and 5" }] }, "state",
      "POST /workers/import with one row { name, hourlyRate 50, overtimeMultiplier 0.5 }: the import route validates only rows / rows.*.userId / rows.*.companyId, so the request is accepted (200); normalizeWorker refuses the row (WORKER_MULTIPLIER_INVALID) and importWorkers records the refusal's own message against the 1-based row number; no worker is created (adjudication F1: 200 with the row in errors[], the message asserted). Part of the contract refusal that serves the plan's 0.5 crew member (builders' adjudication 087-FLD item 1).",
      [PH8(430, 886), PF(429), H("backend/src/routes/timesheets.js", "65"), H("backend/src/services/timesheet.service.js", "191,194,282-313"), ADJ0("F1"), BADJ("087-FLD item 1")], { company: C_FLD, note: "the row carries a name (else WORKER_NAME_REQUIRED's message comes first, :191)" }),
    reopenTwoThousand: F(TS_FIVE_BY_EIGHT, "cents", "The sheet: 5 workers x 8 h x 50.00 = 2,000.00 (stage 13 shape).", [PH8(887), "backend/scripts/phase21/stage13-labour.js:30-35"], { company: C_FLD }),
    reopenMirrorCount: F(5, "count", "reopen -> costLedger.reverse writes one negative mirror per un-reversed entry: 5 entries -> 5 mirrors.", [PH8(887), H("backend/src/services/cost-ledger.service.js", "386-428"), H("backend/src/services/timesheet.service.js", "716-731")], { company: C_FLD }),
    reopenMirrorSum: F(-TS_FIVE_BY_EIGHT, "cents", "5 x -400.00 = -2,000.00, exactly the posting.", [PH8(887), H("backend/src/services/cost-ledger.service.js", "411")], { company: C_FLD }),
    reopenNet: F(0, "cents", "2,000.00 - 2,000.00 = 0.00 after reopen.", [PH8(887)], { company: C_FLD }),
    reapprovedNet: F(TS_FIVE_BY_EIGHT, "cents", "Re-approval re-posts under a new key because the old one was reversed: 2,000 - 2,000 + 2,000 = 2,000.00 (one posting in force, not two).", [PH8(887), H("backend/src/services/cost-ledger.service.js", "318-330")], { company: C_FLD }),
    reapprovedEntryCount: F(15, "count", "5 originals + 5 mirrors + 5 re-posts = 15 ledger rows for the sheet (history kept).", [PH8(887), H("backend/src/services/cost-ledger.service.js", "312-330,399-418")], { assumption: true, company: C_FLD }),
    rejectEditApprove: F(TS_FIVE_BY_SEVEN, "cents",
      "Rejected (nothing posted), edited to 5 workers x 7 h, resubmitted, approved: 35 h x 50.00 = 1,750.00. The plan states only the total; any edit that leaves 35 regular hours at 50.00 gives it.",
      [PH8(888), H("backend/src/services/timesheet.service.js", "573,589-604,699-713")], { assumption: true, company: C_FLD }),
    rejectWithoutReason: F("400 VALIDATION_ERROR", "http",
      "Return (POST /:timesheetId/reject) without a reason: the route chain body('reason').isString().trim().isLength({ min: 1, max: 1000 }) refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); the service's TIMESHEET_REASON_REQUIRED (:703) is not reached through the route.",
      [H("backend/src/routes/timesheets.js", "98"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/timesheet.service.js", "703")], { company: C_FLD, note: "details.field=reason" }),
    hours25SingleEntry: F("400 VALIDATION_ERROR", "http",
      "One entry of 25 h on POST / (or PATCH /:timesheetId): the route's entryValidators chain body('entries.*.hours').isFloat({ min: 0, max: 24 }) refuses it before the service (validate: 'Validation failed'; express-validator 7 names a wildcard path with its index, so a one-entry sheet reports field 'entries[0].hours'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); the service's TIMESHEET_ENTRY_HOURS (:485) is not reached through the route.",
      [PH8(889), H("backend/src/routes/timesheets.js", "56,92,94"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/timesheet.service.js", "485")], { company: C_FLD, note: "details.field=entries[0].hours (entries[i].hours for the i-th entry)" }),
    hours25SplitEntries: F("400 TIMESHEET_HOURS_EXCEEDED", "http", "Two entries for one worker, 16 h + 9 h = 25 h > 24 (per sheet only; HR-F5).", [PH8(889, 1062), H("backend/src/services/timesheet.service.js", "486-487")], { assumption: true, company: C_FLD }),
    crewPrefillEntries: F(3, "count", "A crew of 3 with no entries is pre-filled one regular entry per member.", [PH8(889), H("backend/src/services/timesheet.service.js", "551")], { company: C_FLD }),
    crewPrefillHours: F(3 * 8, "hours", "3 entries x defaultHours 8 = 24 h regular.", [PH8(889), H("backend/src/services/timesheet.service.js", "551")], { company: C_FLD }),
    sameCrewSameDate: F("409 TIMESHEET_EXISTS", "http", "A second sheet for the same crew and date.", [PH8(889), H("backend/src/services/timesheet.service.js", "547-548")], { company: C_FLD }),
    rateChangeRecorded: F(8 * RATE, "cents",
      "Recorded only: the rate is read at approval (entry.rate ?? worker.hourlyRate). 8 h submitted at 50.00, rate changed to 60.00 before approval -> 480.00 posted; HR-F5 would take the submission rate (400.00).",
      [PH8(890, 1062), H("backend/src/services/timesheet.service.js", "652-654"), HF8("backend/src/services/timesheet.service.js", "643-697"), WP8ADJ("standing rulings"), PREP8("section 5.1 TS-5; section 10 G2, G6"), DERIVE_F8], { assumption: true, today: 8 * 6000, ref: "HR-F5", company: C_FLD, note: "WP-8 G2, G6 (2026-10-10): the value was 48,000 (480.00, HEAD's figure under the undecided HR-F5); it is now HR-F5's recommendation, the rate at submission: 8 h x 50.00 = 400.00, and HEAD's 480.00 (the rate read at approval, timesheet.service.js:653) is the today. On F8: TS-5 (R-1), W8-R's 8 h submitted at 50.00, the rate changed to 60.00, then approved by the cost controller (KA.F5.F8.rateTiming). Ref HR-F5, undecided (O2): BLOCKED at the today, an assumption." }),
    capAcrossSheets: F({ refused: true, code: null, sheetsCreated: 1 }, "state", "HR-F5 (a cap per worker per day across all sheets): F8's TS-4 (R-2): W8-1's 16 h on sheet S1, then 9 h on sheet S2 the same day: 16 + 9 = 25 h > 24, so S2 is refused (the status and code CONTRACT['HR-F5'].capAnswer) and only S1 exists. Today the cap is per sheet only (timesheet.service.js:486-487): S2 201, 25 h on one day across the two sheets.", [PH8(889, 930, 1062), HF8("backend/src/services/timesheet.service.js", "457-500, 537-587"), WP8ADJ("standing rulings"), PREP8("section 5.1 TS-4; section 10 G6"), DERIVE_F8], { assumption: true, today: { status: 201, sheetsCreated: 2, hoursOnTheDay: 16 + 9 }, ref: "HR-F5", company: C_FLD, note: "WP-8 G6 (2026-10-10): new. KA.F5.F8.capAcrossSheets; BLOCKED at the today while HR-F5 is undecided (O2). 25 h on one sheet (hours25SplitEntries, 400 TIMESHEET_HOURS_EXCEEDED) is HEAD's answer and HR-F5's alike." }),
    inactiveWorker: F({ refused: true, code: null, sheetsCreated: 0 }, "state", "HR-F5 (refuse inactive workers): F8's TS-6 (R-1): W8-I set inactive by the site engineer, then a sheet naming W8-I: refused (the status and code CONTRACT['HR-F5'].inactiveAnswer), no sheet. Today assertWorkersUsable checks no status (timesheet.service.js:375-385): 201, the sheet created.", [PH8(930, 1062), HF8("backend/src/services/timesheet.service.js", "375-385"), WP8ADJ("standing rulings"), PREP8("section 5.1 TS-6; section 10 G6")], { assumption: true, today: { status: 201, sheetsCreated: 1 }, ref: "HR-F5", company: C_FLD, note: "WP-8 G6 (2026-10-10): new. KA.F5.F8.inactiveWorker; BLOCKED at the today while HR-F5 is undecided (O2)." }),
  },
  quality: {
    inputs087FLD: F("major 2, minor 3, legacy ITP failed 1 (waived 1, passed 1 not counted); form ITPs not counted", "text",
      "NCR states are only open / submitted / closed (no archive or void), so all 5 NCRs count in any state. The pending/failed/voided/retroactive holds on 087-FLD are form-ITP hold points (WP-2), which do not count (HR-Q3 undecided).",
      [PH8(430, 1049), H("backend/src/services/ncr.service.js", "34-38"), H("backend/src/services/quality.service.js", "37-45")], { assumption: true, company: C_FLD, note: "WP-8 G4 (2026-10-10, WP8ADJ Q3): 'form ITPs not counted' is HEAD's model under the undecided HR-Q3; under its recommendation the A120 complete-fail form ITP instance counts (WP8.quality.formItpCounted087FLD: 6). F8 holds no form ITP (WP8.F8.qualityMix), so on F8 these inputs give 21 under either model." }),
    dashboard087FLD: F(qualityScore(FLD_QUALITY), "score", "100 - 2x20 - 3x8 - 1x15 = 100 - 40 - 24 - 15 = 21", [PH8(92, 430, 892), H("backend/src/services/quality.service.js", "43-51")], { company: C_FLD, note: "WP-8 G4 (2026-10-10, WP8ADJ Q3): on 087-FLD this reads 21 only under HEAD's model, the legacy register (quality.service.js:46, health.js:444, workspace-dashboard.service.js:1148): 087-FLD's complete-fail form ITP instance on A120 makes it 6 under HR-Q3's recommendation (KA.Q3.087.score, BLOCKED at 21; WP8.quality.formItpCounted087FLD). F8 and 052-FLD hold no form ITP, so the CLAUDE.md quality rule is a firm check there (Q.F8.dashboard21, Q.F8.health21, Q.F8.workspace21, Q.052.score)." }),
    health087FLD: F(qualityScore(FLD_QUALITY), "score", "Same inputs on the project health card (no archive filter needed: NCRs cannot be archived): 21", [PH8(892), H("backend/src/routes/health.js", "442-447")], { company: C_FLD, note: "WP-8 G4 (2026-10-10, WP8ADJ Q3): on 087-FLD this reads 21 only under HEAD's model, the legacy register (quality.service.js:46, health.js:444, workspace-dashboard.service.js:1148): 087-FLD's complete-fail form ITP instance on A120 makes it 6 under HR-Q3's recommendation (KA.Q3.087.score, BLOCKED at 21; WP8.quality.formItpCounted087FLD). F8 and 052-FLD hold no form ITP, so the CLAUDE.md quality rule is a firm check there (Q.F8.dashboard21, Q.F8.health21, Q.F8.workspace21, Q.052.score)." }),
    workspace087FLD: F(qualityScore(FLD_QUALITY), "score", "Same inputs on the workspace dashboard: 21", [PH8(892), H("backend/src/services/workspace-dashboard.service.js", "1142-1153")], { company: C_FLD, note: "WP-8 G4 (2026-10-10, WP8ADJ Q3): on 087-FLD this reads 21 only under HEAD's model, the legacy register (quality.service.js:46, health.js:444, workspace-dashboard.service.js:1148): 087-FLD's complete-fail form ITP instance on A120 makes it 6 under HR-Q3's recommendation (KA.Q3.087.score, BLOCKED at 21; WP8.quality.formItpCounted087FLD). F8 and 052-FLD hold no form ITP, so the CLAUDE.md quality rule is a firm check there (Q.F8.dashboard21, Q.F8.health21, Q.F8.workspace21, Q.052.score)." }),
    sixMajor: F(qualityScore({ major: 6 }), "score", "100 - 6x20 = -20, clamped to 0", [PH8(92, 892), H("backend/src/services/quality.service.js", "48-51")], { assumption: true, company: C_FLD, note: "the 6-major variant holds only 6 major NCRs (no minor, no failed ITP), as the clamp mutation's -20 implies" }),
    closeMajorLeaves: F(qualityScore(FLD_QUALITY), "score", "Closed NCRs keep counting (HR-Q4 keeps the literal rule): still 21 after a major NCR is closed.", [PH8(892, 1050), "backend/scripts/phase21/stage16-quality.js:177-179", HF8("backend/scripts/cert/cert3/build/087-fld.js", "1384"), WP8ADJ("Q1"), PREP8("section 0 fact 3; section 5.4; section 10 G23")], { company: C_FLD, note: "WP-8 G23 (2026-10-10, WP8ADJ Q1): closed on F8 (Q.F8.closeMajor: F8's major-open NCR closed out by the site engineer and approved by the quality engineer), not on 087-FLD. The builder's comment (087-fld.js:1384) leaves 087-FLD's open major NCR to 'the WP-8 proof'; under binding ruling 1 that write runs on the throwaway, a moment-map deviation recorded by key when the proof lands. HEAD equals HR-Q4's recommendation here (closed NCRs keep counting), so the leaf is HARD, never a known answer; CF.HRQ4 reports it as an observation." }),
    severityDowngradeProbe: F({ refused: true, code: null, score: qualityScore(FLD_QUALITY) }, "state", "Recorded probe: a closed major edited to minor -> 100 - 20 - 4x8 - 15 = 33 (HR-Q5).", [PH8(894, 1051), HF8("backend/src/services/ncr.service.js", "330-438"), WP8ADJ("standing rulings"), PREP8("section 5.1 Q-5; section 10 G2, G8"), DERIVE_F8], { assumption: true, today: { status: 200, score: qualityScore({ major: 1, minor: 4, failedItp: 1 }) }, ref: "HR-Q5", company: C_FLD, note: "WP-8 G2, G8 (2026-10-10): the value was 33 (unit score), HEAD's figure under the undecided HR-Q5; it is now HR-Q5's recommendation (severity frozen after submit): on F8 (Q-5, after Q-2 and Q-4) the quality engineer's PATCH of the closed major-closed NCR to minor is refused (CONTRACT['HR-Q5'].severityAnswer) and the score stays 21; HEAD's 200 and 33 (updateNcr keeps the severity editable, ncr.service.js:362) are the today. Q-5 sets the NCR back at once. Ref HR-Q5 (O4): BLOCKED at the today (KA.Q5.F8.severityDowngrade), an assumption." }),
    legacyItpFailedToPassedProbe: F({ refused: true, code: null, score: qualityScore(FLD_QUALITY) }, "state", "Recorded probe: the failed legacy ITP PATCHed to passed -> 100 - 40 - 24 = 36 (+15; itp.service.js:120 takes any status, HR-Q4).", [PH8(894, 1050), H("backend/src/services/itp.service.js", "120-138"), WP8ADJ("standing rulings"), PREP8("section 5.1 Q-5; section 10 G2, G8"), DERIVE_F8], { assumption: true, today: { status: 200, score: qualityScore({ major: 2, minor: 3, failedItp: 0 }) }, ref: "HR-Q4", company: C_FLD, note: "WP-8 G2, G8 (2026-10-10): the value was 36 (unit score), HEAD's figure under the undecided HR-Q4; it is now HR-Q4's recommendation (an ITP status change needs a reason and is audited): on F8 (Q-5) the quality engineer's PATCH of the failed legacy ITP to passed, sent with no reason, is refused (CONTRACT['HR-Q4'].itpStatusAnswer) and the score stays 21; HEAD's 200 and 36 are the today. Q-5 sets the ITP back at once. Ref HR-Q4 (O4): BLOCKED at the today (KA.Q4.F8.legacyItpStatus), an assumption." }),
    formItpFailureNotCounted: F(qualityScore({ ...FLD_QUALITY, failedItp: FLD_QUALITY.failedItp + FLD_FORM_FAILED }), "score", "A failed form-ITP instance on 087-FLD leaves 21 (only ItpRecord.status 'failed' is read). If HR-Q3 is approved, each failed form instance would take 15 more.", [PH8(92, 1049), H("backend/src/services/quality.service.js", "21-23,45"), WP8ADJ("Q3"), PREP8("section 0 fact 6; section 10 G4"), DERIVE_F8], { assumption: true, today: qualityScore(FLD_QUALITY), ref: "HR-Q3", company: C_FLD, note: "WP-8 G4 (2026-10-10, WP8ADJ Q3): restated as its today: the value was 21, HEAD's reading (the legacy register only) under the undecided HR-Q3; it is now HR-Q3's recommendation (form ITPs count): the complete-fail form instance on 087-FLD's A120 takes 15 more, 100 - 40 - 24 - 2 x 15 = 6, and 21 is the today. Read with formItpCounted087FLD by KA.Q3.087.score (O3)." }),
    formItpCounted087FLD: F(qualityScore({ ...FLD_QUALITY, failedItp: FLD_QUALITY.failedItp + FLD_FORM_FAILED }), "score", "087-FLD's quality score on the quality dashboard, the health card and the workspace dashboard under HR-Q3's recommendation (form ITPs count in the score as in the gate): 2 major, 3 minor, the failed legacy ITP and the one complete-fail form ITP instance on A120 (WP-2's hold-point fixture, 087-FLD's state itp.failed): 100 - 2x20 - 3x8 - 2x15 = 100 - 40 - 24 - 30 = 6. Today the three surfaces read the legacy register only (quality.service.js:46, health.js:444, workspace-dashboard.service.js:1148): 21. The WP-9 twin on 087-HLT is WP9.health.qualityByRule (42 against 57).", [PH8(92, 430, 892, 1049), HF8("backend/src/services/quality.service.js", "46"), HF8("backend/src/routes/health.js", "444"), HF8("backend/src/services/workspace-dashboard.service.js", "1148"), WP8ADJ("Q3"), PREP8("section 0 fact 6; section 10 G4"), DERIVE_F8], { assumption: true, today: qualityScore(FLD_QUALITY), ref: "HR-Q3", company: C_FLD, note: "WP-8 G4 (2026-10-10, WP8ADJ Q3): new. KA.Q3.087.score, one known answer for the three 087-FLD readings: value 6 (HR-Q3's recommendation, an assumption), today 21; BLOCKED while HR-Q3 is undecided (O3). The CLAUDE.md quality rule is a firm check on F8 and 052-FLD, which have no form ITP." }),
    ncrRejectWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST /:ncrId/reject (or /disapprove) without a reason: rejectNcrValidators body('reason').isString().trim().notEmpty() refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); rejectNcr's APPROVAL_WORKFLOW_REASON_REQUIRED (:628) is not reached through the route.",
      [PH8(893), H("backend/src/routes/ncr.js", "185-188,192,199"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/ncr.service.js", "624-631")], { company: C_FLD, note: "details.field=reason" }),
    ncrRejectNotSubmitted: F("409 NCR_NOT_READY_FOR_REJECTION", "http", "Only a submitted closeout can be rejected.", [PH8(893), H("backend/src/services/ncr.service.js", "643-649")], { company: C_FLD, note: "sent with a reason (without one the route's 400 VALIDATION_ERROR answers first)" }),
    ncrReopenWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST /:ncrId/reopen without a reason: the route chain body('reason').isString().trim().notEmpty() refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); reopenNcr's NCR_REOPEN_REASON_REQUIRED (:708) is not reached through the route.",
      [PH8(893), H("backend/src/routes/ncr.js", "250-252"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/ncr.service.js", "706-710")], { company: C_FLD, note: "details.field=reason" }),
    ncrReopenNotClosed: F("409 NCR_NOT_READY_FOR_REOPEN", "http", "Only a closed NCR can be reopened.", [PH8(893), H("backend/src/services/ncr.service.js", "722-728")], { company: C_FLD, note: "sent with a reason (without one the route's 400 VALIDATION_ERROR answers first)" }),
    ncrApproveNotSubmitted: F("409 NCR_NOT_READY_FOR_APPROVAL", "http", "Only a submitted closeout can be approved.", [H("backend/src/services/ncr.service.js", "565-571")], { company: C_FLD }),
    ncrCloseNotOpen: F("409 NCR_NOT_READY_FOR_CLOSEOUT", "http", "Only an open NCR can be submitted for closeout.", [H("backend/src/services/ncr.service.js", "458-464")], { company: C_FLD }),
    // Quality probes recorded as observations (adjudication F6; plan :854): the
    // recommendation is the value, HEAD's behaviour is `today`; no figure is invented.
    evidenceWipedBeforeApprovalProbe: F({ approved: false, code: null, ncrStatus: "submitted" }, "state",
      "Observation: an NCR closeout submitted with one evidence attachment, the attachment then removed, then approved. approveNcr checks only that the NCR is submitted; the evidence count is checked at submit (assertCloseoutRequirements), not at approval.",
      [PH8(894, 931, 1051), H("backend/src/services/ncr.service.js", "40,79-84,115-129,547-571"), HF8("backend/src/services/ncr.service.js", "547-614"), WP8ADJ("Q1"), PREP8("section 5.2 V-2; section 10 G2, G8")], { assumption: true, today: { status: 200, ncrStatus: "closed" }, ref: "HR-Q5", company: C_FLD, note: "observation (recorded, not gating); HR-Q5 undecided. WP-8 G2, G8 (2026-10-10): now a known answer, no longer an observation. The value was { status: null, code: null, rule: HR-Q5's recommendation, the refusing step and code the fix's }; it is now that recommendation as the judged outcome (approval re-checks evidence): on F8V (V-2) the minor NCR V-E is closed out with its own evidence, its attachmentRefs PATCHed to [], and the quality engineer's approve does not approve it (CONTRACT['HR-Q5'].evidenceAnswer): the NCR stays submitted. The today was '200 approved (no evidence re-check)'; it is now { status 200, ncrStatus closed }, the same reading. Ref HR-Q5 (O4): BLOCKED at the today (KA.Q5.F8V.evidenceWiped), an assumption." }),
    textOnlyEvidenceProbe: F({ status: null, code: null, rule: "HR-X1 (decided, plan §0.1): evidence moves to canonical OctaPM document references, coordinated with the clients and without abruptly breaking mobile; a ref that names no stored project document stops counting under that change; the refusing step, code and timing are the fix's" }, "state",
      "Observation: an NCR closeout submitted with one attachment ref carrying only a fileName (or only a URL), no stored project document. normalizeAttachmentRefs keeps any entry with a fileUrl, storageKey or fileName, and that count satisfies the closeout's evidence requirement.",
      [PH8(894, 931, 1052), H("backend/src/services/workflow-support.service.js", "406-423"), H("backend/src/services/ncr.service.js", "69-77,115-129"), "C:/Temp/octapm-cert/scratch/wp2/fixplan-hrx1/r3b/HRX1-FIX-PLAN.r3b.md section 8", WP8ADJ("standing rulings"), PREP8("section 0 fact 9; section 5.2 V-3; section 10 G2, G16")], { assumption: true, today: "200 submitted (the text-only ref counts as evidence)", ref: "HR-X1", company: C_FLD, note: "observation (recorded, not gating). WP-8 G2, G16 (2026-10-10): now a known answer. Ref HR-X1 (decided, plan section 0.1; its batch lands in WP-2: FIXES['HR-X1']): BLOCKED at the today until the batch lands (KA.X1.F8V.textOnly: on F8V, V-3, the minor NCR V-T closed out with a fileName-only reference). Then it is judged on the batch's contract for a reference naming no stored document, WP8.quality.hrX1.storedNowhere, which the HR-X1 batch's own book patch adds (HRX1-FIX-PLAN.r3b.md section 8: transition mode '200 legacy', documentRequired mode '400'; CONTRACT['HR-X1'].mode from owner question O10). This patch does not add that leaf." }),
    hardDeleteProbe: F({ ncr: "archived, not deleted: the row reads back with archivedAt set and is excluded from the score", legacyItp: "archived, not deleted: the row reads back with archivedAt set and is excluded from the score" }, "state",
      "Observation (HR-Q4 recommendation: delete becomes archive; archived and void records are excluded). Today DELETE /ncr/:ncrId and DELETE /itp/:itpId remove the row (200 { deleted: true }). Run on throwaway records, not on 087-FLD's scored set: under either reading a deleted major NCR moves the score by +20 and a deleted failed ITP by +15, so the check reads the row back rather than the score.",
      [PH8(894, 931, 1050), H("backend/src/services/ncr.service.js", "775-787"), H("backend/src/services/itp.service.js", "193-205"), H("backend/src/routes/ncr.js", "267-279"), HF8("backend/src/services/ncr.service.js", "786"), HF8("backend/src/services/itp.service.js", "204"), WP8ADJ("Q1"), PREP8("section 5.2 V-4; section 10 G2, G8")], { assumption: true, today: { ncr: "200 { deleted: true }; the row is gone", legacyItp: "200 { deleted: true }; the row is gone" }, ref: "HR-Q4", company: C_FLD, note: "observation (recorded, not gating); HR-Q4 undecided. WP-8 G2, G8 (2026-10-10): now a known answer, split NCR / legacy ITP with the row read back. The value was 'archived, not deleted: the row reads back with archivedAt set and is excluded from the score' for both; the today was '200 { deleted: true }; the row is gone (hard delete)'. On F8V (V-4) the PM DELETEs one major NCR and a pending legacy ITP made for the probe, each row then read back. Ref HR-Q4 (O4): BLOCKED at the today (KA.Q4.F8V.hardDelete), an assumption." }),
  },
  punch: {
    mix: F("punch: draft 2, open 2, ready_for_review 1, in_dispute 1, closed 1, void 1; observations: one per type (5), safety open + environmental draft, the other 3 closed or void", "text",
      "A mix that gives the plan's 6 and 2; one item per state would give 4 open defects.",
      [PH8(430, 897), H("backend/src/services/punch.service.js", "31-42,53")], { assumption: true, company: C_FLD }),
    openDefects: F(2 + 2 + 1 + 1, "count", "Quality dashboard counts punch (kind != observation) whose status is not closed/void: draft 2 + open 2 + ready 1 + dispute 1 = 6 (drafts counted).", [PH8(897), H("backend/src/services/quality.service.js", "27-31,53-55,64-65")], { assumption: true, company: C_FLD }),
    openDefectsWithoutDrafts: F(2 + 1 + 1, "count", "The same mix without drafts: 4 - the figure that proves drafts are counted.", [PH8(897)], { assumption: true, company: C_FLD }),
    openObservations: F(2, "count", "Observations not closed/void: safety (open) + environmental (draft) = 2.", [PH8(897), H("backend/src/services/quality.service.js", "56-58")], { assumption: true, company: C_FLD }),
    safetyObservationsOpen: F(1, "count", "observationsByType.safety = 1 in this mix.", [H("backend/src/services/quality.service.js", "59-63,85")], { assumption: true, company: C_FLD }),
    closeByNonApprover: F("403 PUNCH_FINAL_APPROVER_ONLY", "http", "close by anyone other than finalApproverUserId.", [PH8(896), H("backend/src/services/punch.service.js", "562-564")], { company: C_FLD }),
    finalApproverBypass: F({ patch: { refused: true, code: null }, close: "403 PUNCH_FINAL_APPROVER_ONLY" }, "state", "HR-F3 (only the PM or the current final approver may change the final approver once the item is open): on F8 (P-3, after P-2) a new open item whose final approver is the quality engineer; the site engineer PATCHes finalApproverUserId to the PM, then the PM closes it. Under HR-F3 the PATCH is refused (CONTRACT['HR-F3'].reassignAnswer) and the PM's close then meets the gate, 403 PUNCH_FINAL_APPROVER_ONLY (closeByNonApprover). Today updatePunchItem locks only closed and void items (punch.service.js:497-499): the PATCH 200, then the PM's close 200, the item closed.", [PH8(896, 932, 1060), H("backend/src/services/punch.service.js", "339,497-498"), HF8("backend/src/services/punch.service.js", "497-499, 562"), WP8ADJ("standing rulings"), PREP8("section 5.1 P-3; section 10 G2, G3, G11")], { assumption: true, today: { patch: 200, close: "200 closed" }, ref: "HR-F3", company: C_FLD, note: "WP-8 G2, G3, G11 (2026-10-10): the value was '200 (recorded)', which restated HEAD; it is now HR-F3's recommendation. The derivation was 'Recorded: PATCH finalApproverUserId to oneself on an open item is accepted (only closed/void are locked), and the close then succeeds; HR-F3 would refuse the PATCH.': no one closes 'to oneself' on F8 (the closers are the PM and the quality engineer, punch.close), so the bypass is the site engineer naming the PM. The today was '200, then close 200'. Ref HR-F3 (O5): BLOCKED at the today (KA.F3.F8.approverBypass), an assumption." }),
    transitionTable: F(PUNCH_TABLE, "state", "7 actions x 6 statuses from TRANSITION_RULES; every pair outside rule.from answers 409 before the reason check.", [PH8(898), H("backend/src/services/punch.service.js", "541-561")], { company: C_FLD }),
    illegalTransitions: F(PUNCH_ILLEGAL, "count", "42 pairs - 13 legal (open 1, ready 1, close 2, reopen 2, dispute 2, resolve 1, void 4) = 29 answering 409 PUNCH_TRANSITION_INVALID.", [PH8(898), H("backend/src/services/punch.service.js", "541-559")], { company: C_FLD }),
    legalTransitions: F(PUNCH_LEGAL, "count", "1 + 1 + 2 + 2 + 2 + 1 + 4 = 13; reopen, dispute and void without a reason answer 400 PUNCH_REASON_REQUIRED.", [PH8(898), H("backend/src/services/punch.service.js", "541-561")], { company: C_FLD }),
    reasonRequiredPairs: F(PUNCH_REASON_PAIRS, "count", "The legal pairs whose rule needs a reason (TRANSITION_RULES reasonRequired): reopen 2 (closed, ready_for_review) + dispute 2 (open, ready_for_review) + void 4 (draft, open, ready_for_review, in_dispute) = 8; each sent without a reason answers 400 PUNCH_REASON_REQUIRED and changes nothing (P.F8.transitionTable, as the PM, who holds every punch transition). The other 5 legal pairs are not sent.", [PH8(898), HF8("backend/src/services/punch.service.js", "541-561"), PREP8("section 5.1 P-2; section 10 G11"), DERIVE_F8], { company: C_FLD, note: "WP-8 G11 (2026-10-10): new. HEAD's table is the expected one: no today." }),
  },
  safety: {
    inputs: F("open near_miss; closed LTI (lost days > 0); archived near_miss (archive sets status 'archived' and archivedAt)", "text", "087-FLD safety set.", [PH8(430), H("backend/src/services/safety.service.js", "847-852")], { company: C_FLD }),
    health: F(safetyScore({ lti: 1, open: 1 }), "score",
      "Expected (archived excluded): 100 - 20x1 LTI - 5x1 open = 75. Today health.js counts status != 'closed' as open, so the archived near miss counts: 100 - 20 - 5x2 = 70.",
      [PH8(900, 933, 1116), H("backend/src/routes/health.js", "449-460"), HF8("backend/src/routes/health.js", "171-173, 455-460"), HF8("backend/src/services/workspace-dashboard.service.js", "830"), HF8("backend/src/services/quality.service.js", "38"), WP8ADJ("Q4"), PREP8("section 0 fact 7; section 9 F-2; section 10 G2, G9")], { assumption: true, today: safetyScore({ lti: 1, open: 2 }), ref: "SAFE-ARCH-1", company: C_FLD, note: "WP-8 G2, G9 (2026-10-10, WP8ADJ Q4): ref SAFE-ARCH-1, the plan's fix-list item 'health excludes archived incidents' (:1116, a defect fix, not a rule change), an assumption: BLOCKED at the today until the fix lands (KA.SAFE.F8.health on F8's set, WP8.F8.safetySet; KA.SAFE.087.health on 087-FLD's). Provisionally P2; the severity is decided at the run, and the fix lands in WP-8 only if it confirms as P1. The builds' BLOCKED HR-K1 moments of the same defect (052-FLD safety.score, 087-HLT health.safety) read STORED-PRE-FIX after the fix." }),
    workspace: F(safetyScore({ lti: 1, open: 1 }), "score", "Workspace reads archivedAt: null and isOpenStatus (closed set closed/complete/completed/paid): LTI 1, open 1 -> 75.", [PH8(900), H("backend/src/services/workspace-dashboard.service.js", "830,1155-1166")], { company: C_FLD }),
    dashboardIncidents: F(2, "count", "Quality dashboard filters status archived/void: open near miss + closed LTI = 2.", [PH8(900), H("backend/src/services/quality.service.js", "37-42,81")], { company: C_FLD }),
    dashboardOpen: F(1, "count", "Of those 2, status != closed: the open near miss = 1.", [PH8(900), H("backend/src/services/quality.service.js", "82")], { company: C_FLD }),
    fatality: F(safetyScore({ fatalities: 1, lti: 1, open: 1 }), "score", "Any fatality: 100 - 100 - ... <= 0, clamped to 0.", [PH8(901), H("backend/src/routes/health.js", "458-460")], { company: C_FLD }),
    ltiEditAfterClosure: F({ refused: true, code: null, lostDays: 3 }, "state", "Recorded: incidentType/lostDays stay editable after closure (HR-Q5).", [PH8(902, 931, 1051), HF8("backend/src/services/safety.service.js", "375, 387-390"), WP8ADJ("standing rulings"), PREP8("section 5.1 SF-3; section 10 G2, G3, G9")], { assumption: true, today: { status: 200, lostDays: 5 }, ref: "HR-Q5", company: C_FLD, note: "WP-8 G2, G3, G9 (2026-10-10): the value was '200 (recorded)', which restated HEAD; it is now HR-Q5's recommendation (lost days frozen after submit): on F8 (SF-3, after SF-2's reads) the site engineer's PATCH of the closed LTI's lost days 3 -> 5 is refused (CONTRACT['HR-Q5'].lostDaysAnswer) and they stay 3. The today was '200'. The probe changes lost days only (they enter no score); a type change would move the LTI count, so it is a static observation (safety.service.js:375). Ref HR-Q5 (O4): BLOCKED at the today (KA.Q5.F8.ltiEdit), an assumption." }),
  },
  rfi: {
    officialResponseAfterClose: F("409 RFI_ALREADY_CLOSED", "http",
      "Expected: rewriting the official response of a closed RFI is refused. Today updateResponse has no status check and writes rfi.response (200). The code name is assumed from the sibling guards (:284, :377).",
      [PH8(904, 934, 1114), H("backend/src/services/rfi-workflow.service.js", "284,324-333,377"), HF8("backend/src/services/rfi-workflow.service.js", "284, 324-348, 377"), HF8("backend/src/services/rfi.service.js", "248-271"), WP8ADJ("Q5"), PREP8("section 0 fact 8; section 9 F-1; section 10 G2, G10")], { assumption: true, today: "200", ref: "RFI-RESP-1", company: C_FLD, note: "WP-8 G2, G10 (2026-10-10, WP8ADJ Q5): ref RFI-RESP-1, the plan's fix-list item 'the RFI official response is frozen after closure' (:1114), an assumption: BLOCKED at the today until the fix lands (KA.RFI.F8.officialAfterClose; both paths in officialResponsePaths). Provisionally P1, settled at the run: the API is a supported product surface (the mobile team consumes it), and an official answer rewritten after closure with no history breaks record integrity; being API-only does not lower it below P1 unless the run shows the rewrite is visible nowhere. The code RFI_ALREADY_CLOSED stays an assumption, CONTRACT['RFI-RESP-1'].frozenAnswer filled by the fix." }),
    officialResponsePaths: F({ responsesPath: "409 RFI_ALREADY_CLOSED", recordPath: "409 RFI_ALREADY_CLOSED", officialAnswer: "unchanged" }, "state", "The two API paths that rewrite a closed RFI's official answer at HEAD, each sent by F8's PM on RFI-C after its close (R-2): PATCH /rfi/:id/responses/:responseId on the official response (updateResponse, rfi-workflow.service.js:324-348: no status check; :333 writes rfi.response) and PATCH /rfi/:id { response } (updateRfi: assertDirectRfiChange guards only the impact fields on a closed RFI, rfi.service.js:265-270). Under the fix (RFI-RESP-1) each is refused and the official answer is unchanged; the code RFI_ALREADY_CLOSED is assumed from the sibling guards (rfi-workflow.service.js:284, :377). Today each answers 200 and overwrites the text, keeping the previous answer nowhere (the audit event records response 'edited' only, :343). The first-party clients never send either (the web hides every action on a closed RFI; mobile only POSTs responses, which a closed RFI refuses).", [PH8(904, 934, 1114), HF8("backend/src/services/rfi-workflow.service.js", "284, 324-348, 377"), HF8("backend/src/services/rfi.service.js", "248-271"), WP8ADJ("Q5"), PREP8("section 0 fact 8; section 2; section 9 F-1; section 10 G10")], { assumption: true, today: { responsesPath: 200, recordPath: 200, officialAnswer: "rewritten, the previous text kept nowhere" }, ref: "RFI-RESP-1", company: C_FLD, note: "WP-8 G10 (2026-10-10, WP8ADJ Q5): new. KA.RFI.F8.officialAfterClose with officialResponseAfterClose; CONTRACT['RFI-RESP-1'].frozenAnswer filled by the fix, which goes ahead if RFI-RESP-1 confirms as P1 (the plan's fix list :1114 covers it; owner item O6 informational)." }),
    reopenRevision: F("+1", "state", "reopenRfi passes bumpRevision when the RFI was not a draft -> revision = revision + 1 (e.g. 0 -> 1).", [PH8(905), H("backend/src/services/rfi.service.js", "70-71,893-894")], { company: C_FLD }),
    reopenWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST /:rfiId/reopen without a reason: the route chain body('reason').isString().trim().notEmpty() refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); reopenRfi's requireDecisionText (RFI_REOPEN_REASON_REQUIRED, :875) is not reached through the route.",
      [H("backend/src/routes/rfi.js", "435-437"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/rfi.service.js", "873-877")], { company: C_FLD, note: "details.field=reason" }),
    scheduleImpactLink: F(3, "days", "On close, an RFI with scheduleImpactFlag and scheduleImpact 3 upserts a workflow activity link relationType 'schedule_impact' with scheduleImpactDays 3.", [PH8(907), H("backend/src/services/rfi.service.js", "703-705"), H("backend/src/services/rfi-workflow.service.js", "415-426")], { company: C_FLD }),
    overdueRecords: F("RFI-RRB: open, responseRequiredBy past, dueDate null; RFI-ANS: answered, dueDate past, responseRequiredBy null", "text",
      "The two overdue-basis records of 087-FLD. 'dueDate null' is a fact of the STORED row (the Rfi.dueDate column), not of the API: every RFI answer the API gives is enriched with dueDate = dueDateForRecord(row) = row.dueDate || row.responseRequiredBy || row.targetCloseBy || row.inspectionDate (workflow-support.service.js:840-845, applied at :955 and :1103-1107 by attachWorkflowDetailsToRecords, which listRfis, createRfi and updateRfi call: rfi.service.js:317, :476, :717; and the workflow detail: rfi-workflow.service.js:239). So GET /rfi/:id and the list show RFI-RRB with dueDate = its responseRequiredBy (overdueApiDueDate). The null column is read from the stored row in process, read only (overdueStoredDueDate), which is the basis the health card reads (prisma.rfi.findMany, health.js:174, :462-465). Builders' adjudication 087-FLD item 6.",
      [PH8(430, 906), PF(429), H("backend/src/services/workflow-support.service.js", "840-845,955,1103-1107"), H("backend/src/services/rfi.service.js", "317,476,717"), H("backend/src/services/rfi-workflow.service.js", "239"), H("backend/src/routes/health.js", "174,462-465"), BADJ("087-FLD item 6")], { assumption: true, company: C_FLD }),
    overdueApiDueDate: F({ "RFI-RRB": "its responseRequiredBy (the dueDate column is null)", "RFI-ANS": "its dueDate" }, "state",
      "What the API presents as dueDate (GET /rfi/:id, the list, and the create / update answers): dueDateForRecord(row) = dueDate || responseRequiredBy || ... (workflow-support.service.js:840-845). RFI-RRB (column null) reads its responseRequiredBy day; RFI-ANS (column set, responseRequiredBy null) reads its own dueDate. Observed on the 087-FLD debug build (the RFI created with dueDate null and responseRequiredBy D read back dueDate = D).",
      [H("backend/src/services/workflow-support.service.js", "840-845,955,1103-1107"), H("backend/src/services/rfi.service.js", "317,476,717"), BADJ("087-FLD item 6")], { company: C_FLD }),
    overdueStoredDueDate: F({ "RFI-RRB": null, "RFI-ANS": "its dueDate (past)" }, "state",
      "The stored Rfi.dueDate column, read in process and read only (e.g. prisma.rfi.findUnique({ where: { id }, select: { dueDate: true, responseRequiredBy: true } }) by the WP-8 proof; never a write, never through the API, which substitutes responseRequiredBy for a null column). RFI-RRB: null (created without a dueDate); RFI-ANS: its past dueDate. This is the column health.js reads for overdueHealth (:462-465).",
      [H("backend/src/routes/health.js", "174,462-465"), H("backend/src/services/workflow-support.service.js", "840-845"), BADJ("087-FLD item 6")], { company: C_FLD, note: "read only, in process: the one place the 'dueDate null' premise of overdueRecords is observable" }),
    overdueDetail: F({ "RFI-RRB": true, "RFI-ANS": true }, "state", "isOverdue: status in [draft, open, answered] and (responseRequiredBy || dueDate) < now -> both.", [PH8(906), H("backend/src/services/rfi-workflow.service.js", "19,196-200")], { assumption: true, company: C_FLD }),
    overdueListFilter: F({ "RFI-RRB": true, "RFI-ANS": true }, "state", "?overdue=true: status in [draft, open, answered] and (rrb < now or (rrb null and dueDate < now)) -> both.", [PH8(906), H("backend/src/services/rfi.service.js", "50,163-169")], { assumption: true, company: C_FLD }),
    overdueHealth: F({ "RFI-RRB": true, "RFI-ANS": false }, "state", "health.js: dueDate < today and status != closed -> only RFI-ANS (rrb ignored, answered counted). HR-K1 recommends the workspace basis.", [PH8(906, 935, 1096), H("backend/src/routes/health.js", "462-465"), WP8ADJ("standing rulings"), PREP8("section 10 G2, G5")], { assumption: true, today: { "RFI-RRB": false, "RFI-ANS": true }, ref: "HR-K1", company: C_FLD, note: "WP-8 G2, G5 (2026-10-10): the value was { RFI-RRB false, RFI-ANS true }, HEAD's card basis under the undecided HR-K1; it is now HR-K1's recommendation, the workspace basis (responseRequiredBy first, answered RFIs not overdue: overdueWorkspace), and HEAD's basis is the today. Ref HR-K1 (WP-9's main row): BLOCKED at the today (KA.K1.F8.rfiOverdueHealth with overdueHealthF8), an assumption." }),
    overdueWorkspace: F({ "RFI-RRB": true, "RFI-ANS": false }, "state", "workspace: (rrb || dueDate) < today and status not in [answered, closed] -> only RFI-RRB.", [PH8(906), H("backend/src/services/workspace-dashboard.service.js", "30,1168-1175")], { assumption: true, company: C_FLD }),
    overdueHealthF8: F({ afterRRB: 1, afterANS: 0 }, "state", "F8's health card detail.overdueRfis (health.js:649) read three times with no submittal change between them (R-4): a baseline; after RFI-RRB (open, responseRequiredBy R-3, dueDate null) is raised; after RFI-ANS (dueDate R-4) is answered. Each figure is the change from the read before. Under HR-K1 (the workspace basis, overdueHealth's value) RRB adds 1 and ANS adds 0; today the card counts a stored dueDate < today with status != closed (health.js:462-465): RRB adds 0 (its dueDate column is null) and ANS adds 1 (answered still counted).", [PH8(906, 935, 1096), HF8("backend/src/routes/health.js", "462-465, 649"), WP8ADJ("standing rulings"), PREP8("section 5.1 R-4; section 10 G5"), DERIVE_F8], { assumption: true, today: { afterRRB: 0, afterANS: 1 }, ref: "HR-K1", company: C_FLD, note: "WP-8 G5 (2026-10-10): new. KA.K1.F8.rfiOverdueHealth; BLOCKED at the today while HR-K1 is undecided." }),
    overdueWorkspaceF8: F({ afterRRB: -10, afterANS: 0 }, "score", "F8's workspace dashboard docControl score read at the same three points (R-4): it falls by 10 with RFI-RRB (overdue by responseRequiredBy, -10 per overdue RFI) and by 0 with RFI-ANS (an answered RFI is not overdue on the workspace, workspace-dashboard.service.js:30, :1168-1175).", [PH8(906, 1096), HF8("backend/src/services/workspace-dashboard.service.js", "30, 1168-1190"), PREP8("section 5.1 R-4; section 10 G5"), DERIVE_F8], { company: C_FLD, note: "WP-8 G5 (2026-10-10): new; HARD (R.F8.overdueSurfaces): HEAD's workspace basis is HR-K1's recommendation, so no today." }),
  },
  submittal: {
    template: F("2 steps: QS 3 days, Planner 4 days -> reviewDays 7", "text", "reviewDaysFor sums step days: 3 + 4 = 7.", [PH8(430), H("backend/src/services/submittal-workflow.service.js", "94")], { company: C_FLD }),
    submitByTemplated: F(submitBy({ requiredOnSite: "2027-01-25", leadTimeWeeks: 2, reviewDays: 7 }), "date",
      "requiredOnSite 2027-01-25 - 2 weeks x 7 - 7 review days = 2027-01-25 - 21 days = 2027-01-04.",
      [PH8(909), H("backend/src/services/submittal-workflow.service.js", "253-260"), H("backend/src/services/submittal.service.js", "86-98")], { assumption: true, company: C_FLD, note: "requiredOnSite 2027-01-25 and lead time 2 weeks (stage 15's own values) for both submittals" }),
    submitByDirect: F(submitBy({ requiredOnSite: "2027-01-25", leadTimeWeeks: 2, reviewDays: 0 }), "date",
      "The direct submittal (no template, reviewDays null -> 0): 2027-01-25 - 14 days = 2027-01-11.",
      [PH8(909), H("backend/src/services/submittal.service.js", "86-98")], { assumption: true, company: C_FLD }),
    impactDaysRule: F("max(0, ceil((reviewedOn + leadTimeWeeks x 7 days - needBy) / 1 day))", "text", "computeScheduleImpactDays with approvedAt = reviewedOn; lead time 2 weeks gives the plan's +14 days.", [PH8(910), H("backend/src/services/submittal-workflow.service.js", "263-269,477")], { company: C_FLD }),
    impactDaysExample: F(submittalImpactDays({ approvedAtIso: "2027-01-20T10:00:00.000Z", needByIso: "2027-01-25", leadTimeWeeks: 2 }), "days",
      "Worked example: reviewed 2027-01-20 10:00Z, need-by 2027-01-25: (2027-02-03 10:00 - 2027-01-25 00:00) = 9.42 days -> ceil = 10 (a real approval timestamp adds a day against a midnight reviewedOn, which would give 9).",
      [PH8(910)], { assumption: true, company: C_FLD }),
    responseCodeResetOnNewCycle: F(null, "state", "A new cycle (revisionNumber + 1) clears responseCode and responseCodeLabel to null.", [PH8(912), H("backend/src/services/submittal-workflow.service.js", "447-452")], { company: C_FLD }),
    pmApprovalWhileStepsPending: F({ status: 409, code: null, submittalApproved: false }, "state", "Recorded: the PM's direct approve is not blocked by pending steps (HR-F1).", [PH8(911, 936, 1058), HF8("backend/src/services/submittal.service.js", "925-966"), WP8ADJ("standing rulings"), PREP8("section 5.1 SUB-2; section 10 G2, G3")], { assumption: true, today: { status: 200, submittalApproved: true, stepsLeftUndecided: 2 }, ref: "HR-F1", company: C_FLD, note: "WP-8 G2, G3 (2026-10-10): the value was '200 (recorded)', which restated HEAD; it is now HR-F1's recommendation (refuse, 409, unless a PM override with a reason; none is sent): on F8 (SUB-2) SUB-T on T8 is submitted (step 1 active) and the PM's approve is refused, the code CONTRACT['HR-F1'].pendingApproveAnswer. The today was '200': approveSubmittal does not check the steps (submittal.service.js:925-966), so the submittal is approved with T8's two steps undecided. Ref HR-F1 (O5): BLOCKED at the today (KA.F1.F8.pmApproveWhilePending), an assumption." }),
  },
  drawing: {
    storemanRevisions: F(["B"], "state",
      "warehouse is a current-only role: it sees only revisions with isLatest && status approved. At the probe point B is the current approved revision of S-1 (A superseded, C-F not approved), and the currentOnlyFixture revision (approved, not latest, not superseded) is present and excluded by the isLatest term: still ['B'].",
      [PH8(914), H("backend/src/services/doc-control.service.js", "53,99-108"), "backend/scripts/phase21/stage15-document-control.js:136-147"], { assumption: true, company: C_FLD }),
    currentOnlyFixture: F("one extra S-1 revision with status approved, isLatest false, supersededAt null, in place before the storeman probe", "state",
      "Adjudication F4: the S-1 A-F data cannot catch removal of the isLatest term (no approved revision there is non-latest), so a fixture adds one: an approved revision that is not latest and not superseded. PRIMARY (product path, no SQL): file the revision directly as approved - POST /doc-control/:recordType/:recordId/revisions on the S-1 drawing (routes/doc-control.js:146) with status 'approved', which the route's body('status').optional().isIn(['uploaded', 'submitted', 'approved']) admits (:194), sent by a member who may approve revisions (document_control approve, document.revision.approve; anyone else 403 FORBIDDEN, doc-control.service.js:704) and naming a clean stored project document that member can read (projectDocumentId / documentId, :424-460) - or the same filing through the multipart POST .../revisions/upload that stage 15 uses (routes/doc-control.js:225,242-249,262-274: a status field 'approved', checked by the service's own filing check, :694-716). uploadDocumentRevision files it with status approved and isLatest false and touches no other revision (REVISION_FILING_STATUSES :672; the create :762-804), so B stays the latest approved revision and nothing is superseded. FALLBACK (only if the product path is refused or no longer yields that state at build time): the same revision made legacy-style by SQL and documented as a fixture (plan §1.4 guarded fixtures). The approve path cannot produce it at HEAD: approveDocumentRevision supersedes every other isLatest revision of the record and sets isLatest on the one it approves, so approving an older revision after a newer one leaves the older one latest.",
      [PH8(914, 922), H("backend/src/services/doc-control.service.js", "102-108,424-460,672,694-716,762-804,1033-1058"), H("backend/src/routes/doc-control.js", "146,194,225,242-249,262-274")], { assumption: true, company: C_FLD, note: "the fixture's revision code is the build's choice; it must not be A-F" }),
    approveSuperseded: F("409 DOCUMENT_REVISION_SUPERSEDED_READ_ONLY", "http", "Approving a superseded revision.", [PH8(915), H("backend/src/services/doc-control.service.js", "1015-1021")], { company: C_FLD }),
    supersedeWithoutReason: F("400 VALIDATION_ERROR", "http",
      "POST /revisions/:revisionId/supersede without a reason: the route chain body('reason').isString().trim().notEmpty().isLength({ max: 2000 }) refuses it before the service (validate: 'Validation failed', error.details holds field 'reason'). HEAD's VALIDATION_ERROR is the contract (adjudication F1); the service's DOCUMENT_REVISION_SUPERSEDE_REASON_REQUIRED (:1127) is not reached through the route.",
      [PH8(915), H("backend/src/routes/doc-control.js", "365-372"), H("backend/src/middleware/validate.js", "7-25"), H("backend/src/services/doc-control.service.js", "1123-1130")], { company: C_FLD, note: "details.field=reason" }),
    approveWithoutReview: F({ refused: true, code: null, revisionStatus: "uploaded" }, "state", "Recorded: approve does not require the in-review status (HR-F2).", [PH8(915, 937, 1059), H("backend/src/services/doc-control.service.js", "1015-1058"), HF8("backend/src/services/doc-control.service.js", "991-1112"), WP8ADJ("standing rulings"), PREP8("section 5.1 D-3; section 10 G2, G3, G20")], { assumption: true, today: { status: 200, revisionStatus: "approved", latest: true }, ref: "HR-F2", company: C_FLD, note: "WP-8 G2, G3 (2026-10-10): the value was '200 (recorded)', which restated HEAD; it is now HR-F2's recommendation (approve only from review): on F8 (D-3) F8-S2 rev A, uploaded and never submitted for review, is approved by the PM: refused (CONTRACT['HR-F2'].noReviewAnswer), still uploaded. The today was '200'. Ref HR-F2 (O5): BLOCKED at the today (KA.F2.F8.approveWithoutReview), an assumption." }),
    approveOutOfOrder: F({ refused: true, code: null, latestApproved: "C" }, "state", "Recorded: approving an older-lettered revision supersedes whatever isLatest is (HR-F2).", [PH8(915, 937, 1059), H("backend/src/services/doc-control.service.js", "1033-1058"), HF8("backend/src/services/doc-control.service.js", "1033-1047"), WP8ADJ("standing rulings"), PREP8("section 5.1 D-3; section 10 G2, G3, G20")], { assumption: true, today: { status: 200, latestApproved: "B", superseded: ["C"] }, ref: "HR-F2", company: C_FLD, note: "WP-8 G2, G3 (2026-10-10): the value was '200 (recorded)', which restated HEAD; it is now HR-F2's recommendation (refuse a revision older than the current approved one unless it supersedes with a reason; none is sent): on F8 (D-3) F8-S2's B and C are reviewed, C approved, then B approved by the PM: refused (CONTRACT['HR-F2'].outOfOrderAnswer), and C stays the latest approved. The today was '200': approveDocumentRevision supersedes whatever isLatest is (doc-control.service.js:1033-1047), so B becomes the latest and the newer C is superseded. Ref HR-F2 (O5): BLOCKED at the today (KA.F2.F8.approveOutOfOrder), an assumption." }),
  },
  transmittal: {
    activityAndRevision: F("activityIds contains the cited activity; the cited S-1 revision reads back", "state", "The transmittal carries its activity link and the drawing revision it issues.", [PH8(430, 917), "backend/scripts/phase21/stage15-document-control.js:229-238"], { company: C_FLD }),
    distributeBypass: F({ refused: true, code: null, meetingStatus: "draft" }, "state", "Recorded: status set to distributed/acknowledged through PATCH.", [PH8(918, 938), PH8(1063), HF8("backend/src/services/meeting.service.js", "1224-1319"), WP8ADJ("standing rulings"), PREP8("section 5.1 M-1; section 10 G2, G3, G21")], { assumption: true, today: { status: 200, meetingStatus: "distributed" }, ref: "HR-F6", company: C_FLD, note: "WP-8 G2, G3 (2026-10-10): the value was '200 (recorded)', which restated HEAD; it is now HR-F6's recommendation (status changes only through finalize and distribute), for the meeting's bypass: on F8 (M-1) the planner's PATCH of the draft M8a to status distributed is refused (CONTRACT['HR-F6'].patchStatusAnswer) and M8a stays a draft. The today was '200': updateMeeting checks no status (meeting.service.js:1224-1319). A transmittal acknowledged through PATCH is an observation (no rule names it; CF.HRF6). Ref HR-F6 (O5): BLOCKED at the today (KA.F6.F8.patchStatus), an assumption." }),
    actionItemIdentity: F("same id across edits", "state", "Meeting action items keep their ids across an edit (HR-F6 recommendation: update action items in place).", [PH8(919, 938, 1063), HF8("backend/src/services/meeting.service.js", "937"), WP8ADJ("standing rulings"), PREP8("section 5.1 M-3; section 10 G2, G3, G21")], { assumption: true, today: "a new id", ref: "HR-F6", company: C_FLD, note: "WP-8 G2, G3 (2026-10-10): the value was 'same id across edits (recorded; today re-created)'; HEAD's re-creation is now the today, 'a new id' (replaceChildren deletes and re-creates the action items on every edit, meeting.service.js:937). On F8 (M-3) M8c's items are re-sent by PATCH without their taskId. Ref HR-F6 (O5): BLOCKED at the today (KA.F6.F8.actionItemIdentity), an assumption." }),
    createTaskTasks: F(1, "count", "One createTask action item yields exactly 1 task, also after the minutes are edited (the plan probes a duplicate task; today an edit that re-creates the action item can create a second).", [PH8(430, 919, 1063), HF8("backend/src/services/meeting.service.js", "937, 955-997"), WP8ADJ("standing rulings"), PREP8("section 5.1 M-3; section 10 G2, G21")], { assumption: true, today: 2, ref: "HR-F6", company: C_FLD, note: "WP-8 G2 (2026-10-10): the today was '2 after an edit (recorded)'; it is now the count, 2: on F8 (M-3) M8c's createTask item (owner the site engineer) yields one task, and the PATCH re-sending the items without taskId yields a second. Ref HR-F6 (O5): BLOCKED at the today (KA.F6.F8.duplicateTask), an assumption." }),
    createCitesFiled: F({ transmittal: "404 FILE_NOT_FOUND", correspondence: "404 FILE_NOT_FOUND", message: "Revision source file not found", recordsWritten: 0 }, "state", "WP8-TRN-1 (register :294, P3): POST /transmittals and POST /correspondence naming F8-S1 rev B's stored document in revisions are refused 404 FILE_NOT_FOUND 'Revision source file not found' and write nothing, because recordDocumentRevisions runs with no writer on create (workflow-support.service.js:798; transmittal.service.js:99-105; correspondence.service.js:109). The 087-FLD build persisted the same finding. Unchanged after the HR-X1 batch, whose plan keeps the no-writer rule (r3b IQ-3): CF.TRN1 is re-run then.", [PH8(917), HF8("backend/src/services/workflow-support.service.js", "760-805"), HF8("backend/src/services/transmittal.service.js", "99-105"), HF8("backend/src/services/correspondence.service.js", "109"), "docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:294 @14a3db2", PREP8("section 4; section 5.1 T-1; section 10 G17")], { assumption: true, company: C_FLD, note: "WP-8 G17 (2026-10-10): new; an observation (CF.TRN1 confirms it, P3): no section 5 row names it, so no today and no ref." }),
    draftDistributed: F({ refused: true, code: null, meetingStatus: "draft" }, "state", "HR-F6 (distribution needs a finalized meeting): on F8 (M-2) the planner distributes the draft M8b, which has attendees: refused (the status and code are HR-F6's decision), M8b stays a draft and no distribution row is written. Today distributeMeeting checks no status (meeting.service.js:1481-1608): 200, distributed, a row per attendee, each 'sent' with channel email whatever was delivered (:1530-1531; MTG-SENT-1, P2, recorded).", [PH8(918, 938, 1063), HF8("backend/src/services/meeting.service.js", "1481-1608"), WP8ADJ("Q14"), PREP8("section 4; section 5.1 M-2; section 10 G21")], { assumption: true, today: { status: 200, meetingStatus: "distributed", rowsStatus: "sent" }, ref: "HR-F6", company: C_FLD, note: "WP-8 G21 (2026-10-10): new; a confirm-first item of CF.HRF6 (O5). Under HR-F6 M8b is never distributed, so editAfterDistribution is read on the meeting the today distributed." }),
    editAfterDistribution: F({ refused: true, code: null, minutesChanged: false }, "state", "HR-F6 (lock after distribution): on F8 (M-2) the planner PATCHes the minutes of the distributed M8b: refused (HR-F6's decision), the minutes unchanged. Today updateMeeting checks no status (meeting.service.js:1224-1319): 200, the minutes changed.", [PH8(919, 938, 1063), HF8("backend/src/services/meeting.service.js", "1224-1319"), PREP8("section 5.1 M-2; section 10 G21")], { assumption: true, today: { status: 200, minutesChanged: true }, ref: "HR-F6", company: C_FLD, note: "WP-8 G21 (2026-10-10): new; a confirm-first item of CF.HRF6 (O5)." }),
    noticeLetterReadBack: F({ correspondenceLinks: 1, linkedCorrespondence: "the notice letter's id", contractualNotice: true }, "state",
      "Adjudication F6. The contractual notice letter (a correspondence created with contractualNotice true) is linked to its weather delay through the delay's correspondenceIds / correspondenceLinks (create or PATCH). The weather delay read back carries correspondenceLinks with exactly 1 entry whose correspondence.id is the letter and correspondence.contractualNotice is true (attachEvidenceToRecords reads the commercial correspondence links with the correspondence's ref, type, subject, contractualNotice, date and status).",
      [PH8(430), H("backend/src/routes/weather-delays.js", "46-49,80-83"), H("backend/src/services/weather.service.js", "231-237"), H("backend/src/services/commercial-traceability.service.js", "183-255,327-418"), H("backend/src/services/correspondence.service.js", "74")], { assumption: true, company: C_FLD, note: "one notice letter linked to one weather delay" }),
    noticeRegisterCount: F(1, "count", "The correspondence register's summary.notices counts correspondence with contractualNotice true: the one notice letter of 087-FLD.", [PH8(430), H("backend/src/services/correspondence.service.js", "41-48")], { assumption: true, company: C_FLD, note: "assumes no other contractual notice on 087-FLD" }),
    meetingChangeEventReadBack: F({ origin: "meeting", sourceRecordType: "meeting_action", sourceRecordId: "the action item's id", sourceLinks: [{ type: "meeting_action", id: "the action item's id" }], title: "Meeting action: <the action item's title>", activityId: "the action item's activityId (or null)", type: "other", romAmount: 0, scheduleImpactDays: 0 }, "state",
      "Adjudication F6, wording settled by the builders' adjudication (087-FLD item 6). A change event raised from a meeting action item (record source meeting_action, change-event.service.js:467-471) is created with the typed link in its meetingActionItemId column and, because it carries exactly one typed link, the free-text pair sourcePairOf writes from it: sourceRecordType 'meeting_action', sourceRecordId = the action item's id (:88-92, written at :379). The serializer eventOut does NOT expose the meetingActionItemId column; it exposes the pair (sourceRecordType / sourceRecordId, :203-204) and sourceLinks, one entry { type: 'meeting_action', id: the action item's id, path } per typed link (:72-77, :207). So the read-back (GET .../change-events/:changeEventId, getChangeEvent -> eventOut, :355; routes/change-events.js:65) asserts sourceRecordType 'meeting_action', sourceRecordId = the action item and sourceLinks of length 1 with that type and id, plus origin 'meeting' (:490, :531). Its prefill takes the title 'Meeting action: <title>' (:470), the item's activity, type 'other', ROM 0 and schedule impact 0 (:487-496). Origin and the typed link are the endpoint's; the raise body may override every field of PREFILL_OVERRIDABLE (:515): title, description, type, notes, activityId, locationId, scheduleImpactDays, ownerChange, romAmount and lines (the comment above it at :512-514 omits ROM and ownerChange, the list includes both). The figures above assume the raise body sends none of them - in particular neither romAmount (else ROM reads the body's figure, not 0) nor ownerChange.",
      [PH8(430), PF(429), H("backend/src/services/change-event.service.js", "40-49,72-77,88-92,191-216,355,369-379,467-471,487-496,503-510,512-520,528-533"), H("backend/src/routes/change-events.js", "65"), BADJ("087-FLD item 6")], { assumption: true, company: C_FLD, note: "the raise body sends neither romAmount nor ownerChange (nor any other PREFILL_OVERRIDABLE field); sourceLinks entries also carry a path (recordWorkspacePath), not asserted here" }),
  },
  existing: {
    snapshotQuality: F(qualityScore({ major: 1, minor: 0, failedItp: 1 }), "score",
      "Adjudication F6 (plan's existing evidence, the certified project): 100 - 20 x 1 major (NCR-01) - 8 x 0 minor - 15 x 1 failed ITP (ITP-02) = 65. DEF-01 is a minor punch defect, not an NCR, so it does not count.",
      [PH8(924, 1001), H("backend/scripts/phase21/snapshot.js", "212-214"), "backend/scripts/phase21/stage16-quality.js:8,85-96,119,263"]),
    snapshotManHours: F(5 * 8, "man_hours",
      "Adjudication F6 (plan's existing evidence): stage 13's crew day, 5 steelfixers x 8 h regular on A130 = 40 h (the same day posts 40 x 50.00 = 2,000.00: reopenTwoThousand).",
      [PH8(924), "backend/scripts/phase21/stage13-labour.js:4-7,30-35,99"]),
  },
  "052-FLD": {
    qualityScore: F(qualityScore(FLD_QUALITY), "score", "Same mix as 087-FLD: 100 - 40 - 24 - 15 = 21", [PH8(445, 92)], { company: C_052, note: "WP-8 G22 (2026-10-10, WP8ADJ Q9): judged on 052-FLD's stored build step and a live read by 052's PM (read only, as WP7ADJ Q7); 052-FLD holds no form ITP, so its quality 21 holds under either HR-Q3 model (WP8[\"052-FLD\"].reads)." }),
    safetyHealth: F(safetyScore({ lti: 1, open: 1 }), "score", "Same safety set: 100 - 20 - 5 = 75 (today 70: archived counted open)", [PH8(445, 900), PH8(933, 1116), HF8("backend/scripts/cert/cert3/build/052-fld.js", "632-645"), WP8ADJ("Q4, Q9"), PREP8("section 0 facts 1, 7; section 10 G2, G22")], { assumption: true, today: safetyScore({ lti: 1, open: 2 }), ref: "SAFE-ARCH-1", company: C_052, note: "WP-8 G2, G22 (2026-10-10, WP8ADJ Q4, Q9): ref SAFE-ARCH-1 (the fix-list item :1116), an assumption: BLOCKED at the today (KA.SAFE.052.health). The build's step safety.score observed the today and recorded BLOCKED HR-K1 (052-fld.js:641-643, which reads this leaf's value and today, both unchanged); it is the same known answer and reads STORED-PRE-FIX after the fix. Live: the health card read by 052's PM, read only." }),
    weatherBelowPct: F(pct2(FLD_WEATHER_BELOW.pct), "percent", "13 / 20 x 100 = 65 (compared at 2 dp, F2), no warning, 7 remaining", [P(405, 815)], { company: C_052 }),
    weatherAtPct: F(pct2(FLD_WEATHER_AT.pct), "percent", "14 / 20 x 100 = 70 (compared at 2 dp, F2), warning, 6 remaining", [P(405, 815)], { company: C_052 }),
    weatherAtWarning: F(FLD_WEATHER_AT.warning, "bool", "70 >= 70", [P(405, 815)], { company: C_052 }),
    labour: F(TS_MIXED_CENTS, "cents", "8x50x1 + 2x50x1.5 + 1x50x2 = 400 + 150 + 100 = 650.00 USD", [PH8(445, 885)], { company: C_052, note: "WP-8 G22 (2026-10-10, WP8ADJ Q9): judged on 052-FLD's stored build step and a live read by 052's PM (read only, as WP7ADJ Q7); 052-FLD holds no form ITP, so its quality 21 holds under either HR-Q3 model (WP8[\"052-FLD\"].reads)." }),
    reads: F({ by: "052's PM, read only", live: ["GET /projects/052-FLD/quality/dashboard (qualityScore)", "GET /projects/052-FLD/health (safety)", "GET the mixed timesheet (labour)"], stored: ["dailylog.D1-D3 (the promotions' delayDays echo)", "quality.score", "timesheet.mixed", "safety.score (BLOCKED HR-K1 at the build; SAFE-ARCH-1's known answer, STORED-PRE-FIX after its fix)"], writes: 0 }, "state", "What WP-8 reads on 052-FLD: three live reads by 052's PM and four stored build steps from 052-FLD's state file (C:/Temp/octapm-cert/state/cert3/052-FLD.json on cert3d); no request writes. The weather register is WP-7's (KA.FLD.052.*).", [PH8(445), WP8ADJ("Q9"), PREP8("section 5.3; section 10 G22")], { assumption: true, company: C_052, note: "WP-8 G22 (2026-10-10, WP8ADJ Q9): new." }),
  },
  mutations: {
    qualityWeightMinor10: F(qualityScore({ ...FLD_QUALITY, weights: { major: 20, minor: 10, failedItp: 15 } }), "score", "8 -> 10: 100 - 40 - 30 - 15 = 15", [PH8(922)], { company: C_FLD, note: "WP-8 G13 (2026-10-10, WP8ADJ Q6): Q.F8.dashboard21 red (M-QW, tallied, E6: the minor weight 8 -> 10 in quality.service.js:50; F8's 21 reads 15). Collateral, reads only: Q.F8.closeMajor 15; KA.Q5.F8.severityDowngrade and KA.Q4.F8.legacyItpStatus read 25 and 30; the deep reads KA.Q3.087.score (dashboard part) and Q.052.score read 15; Q.F8V.sixMajor and Q.087.variant stay 0 (clamped)." }),
    dropClamp: F(qualityScore({ major: 6, clamp: false }), "score", "6 major without the clamp: 100 - 120 = -20", [PH8(922)], { assumption: true, company: C_FLD, note: "WP-8 G13 (2026-10-10, WP8ADJ Q6): Q.F8V.sixMajor red (M-CLAMP, tallied, E6: the clamp of quality.service.js:48 removed; F8V's 6 major read -20). Collateral, a read only: Q.087.variant reads -20." }),
    manpowerStatusFilter: F(manHours(MP_ALL), "man_hours", "Filter removed: 40 + 30 + 2x8 = 86", [PH8(922), H("backend/src/services/daily-log.service.js", "1456")], { company: C_FLD, note: "WP-8 G13 (2026-10-10, WP8ADJ Q6): DL.F8.manpower red (M-MP, tallied, E6: the status filter of daily-log.service.js:1456 removed; F8's DA reads 86 man-hours and 10 workers). Collateral, a read only: DL.087.manpower reads 86 / 10." }),
    manpowerStatusFilterWorkers: F(workersOf(MP_ALL), "count", "Filter removed: 5 + 3 + 2 = 10 workers", [PH8(922)], { company: C_FLD, note: "WP-8 G13 (2026-10-10): DL.F8.manpower red (M-MP, the same mutant as manpowerStatusFilter: the workers' figure)." }),
    doubleTimeMultiplier: F(TS_MIXED_DOUBLE_MUTATED, "cents", "double -> 1: 400 + 150 + 50 = 600.00", [PH8(922), H("backend/src/services/timesheet.service.js", "70")], { company: C_FLD, note: "WP-8 G13 (2026-10-10, WP8ADJ Q6): TS.F8.mixed red (M-DT, tallied, E6 'overtime multipliers': double -> 1 in timesheet.service.js:70; TS-1 posts 600.00). No collateral: 087-FLD's and 052-FLD's sheets were priced at their build approvals." }),
    punchFinalApprover: F("200 closed", "state", "Check removed: the non-approver's close succeeds instead of 403.", [PH8(922), H("backend/src/services/punch.service.js", "562-564")], { company: C_FLD, note: "WP-8 G13 (2026-10-10, WP8ADJ Q6): P.F8.closeByNonApprover red (M-PFA, tallied, E6: the final-approver check of punch.service.js:562 removed; the PM's close of the ready item succeeds). No collateral, provided P-1 sends the quality engineer's close only while the item is still ready_for_review (an unconditional second close would answer 409 under the mutant and stop the choreography as a setup error)." }),
    currentOnlyFilter: F("storeman sees ['B', the currentOnlyFixture revision], not ['B']", "state",
      "The isLatest term removed (isCurrentApprovedRevision reads status approved only): the storeman sees every approved S-1 revision - B and the currentOnlyFixture revision (A superseded, C-F not approved), so the check that the storeman sees only the latest approved one goes red. Removing the whole current-only filter (visibleRevisionsForRole returns all) shows every S-1 revision, A-F and the fixture. Without the fixture, dropping only the isLatest term changed nothing (adjudication F4).",
      [PH8(914, 922), H("backend/src/services/doc-control.service.js", "102-108")], { assumption: true, company: C_FLD, note: "WP-8 G13 (2026-10-10, WP8ADJ Q6): D.F8.storeman red (M-LAT, tallied, E6: the isLatest term of doc-control.service.js:103 removed; F8-S1's register reads [B, X8], X8 being F8's currentOnlyFixture revision). Collateral, a read only: D.087.storeman." }),
    reviewDaysInSubmitBy: F(submitBy({ requiredOnSite: "2027-01-25", leadTimeWeeks: 2, reviewDays: 0 }), "date", "Review-days term removed: the templated submittal moves from 2027-01-04 to 2027-01-11.", [PH8(922), H("backend/src/services/submittal-workflow.service.js", "258")], { assumption: true, company: C_FLD, note: "WP-8 G13 (2026-10-10, WP8ADJ Q6): SUB.F8.submitBy red (M-RD, tallied, E6: the review-days term of submittal-workflow.service.js:258 removed; SUB-T reads 2027-01-11). No collateral: SUB.087.submitBy reads the dates stored at the build." }),
    archivedFilterDashboardIncidents: F(3, "count", "live() removed: the archived near miss is back -> safetyIncidents 3 (and safetyOpen 2).", [PH8(922), H("backend/src/services/quality.service.js", "37-42")], { company: C_FLD, note: "WP-8 G13 (2026-10-10, WP8ADJ Q6): SF.F8.dashboard red (M-ARCH, tallied, E6: live() of quality.service.js:38 returns every row; F8's archived near miss is back). Collateral, a read only: SF.087.workspaceDashboard (dashboard part) reads 3 / 2." }),
    archivedFilterDashboardOpen: F(2, "count", "live() removed: safetyOpen = open near miss + archived near miss = 2.", [PH8(922)], { company: C_FLD, note: "WP-8 G13 (2026-10-10): SF.F8.dashboard red (M-ARCH, the same mutant as archivedFilterDashboardIncidents: the open count)." }),
    optionalMutants: F(["Q.F8.health21 red (M-QWh: the minor weight 8 -> 10 on the health card, routes/health.js:446)", "Q.F8.workspace21 red (M-QWw: the minor weight 8 -> 10 on the workspace dashboard, workspace-dashboard.service.js:1152)", "TS.pure.multiplierHalf red (M-OTF: the overtime floor max(1, multiplier) removed, timesheet.service.js:70; in process)"], "mutation", "The OPTIONAL mutants of WP-8 (WP8ADJ Q7): run, never tallied, recorded with the WP-8 proof (the WP7ADJ Q5 precedent; plan section 0.0 item 5: no widening of section 6.2). M-QWh and M-QWw put the weights mutant on the other two surfaces of plan :892; M-OTF is the overtime floor beside the tallied M-DT. Collateral: the health and workspace parts of KA.Q3.087.score read 15 (reads only).", [PH8(892, 922, 1152), HF8("backend/src/routes/health.js", "446"), HF8("backend/src/services/workspace-dashboard.service.js", "1152"), HF8("backend/src/services/timesheet.service.js", "70"), WP8ADJ("Q6, Q7"), PREP8("section 7; section 10 G13"), "C:/Temp/octapm-cert/scratch/wp8/wp8-mutations-draft.json"], { company: C_FLD, note: "WP-8 G13, Q7 (2026-10-10): new." }),
    fixMutations: F(["KA.RFI.F8.officialAfterClose red (M-RFIRESP: the RFI-RESP-1 fix reverted in updateResponse and in assertDirectRfiChange, once it lands, if it confirms as P1)", "KA.SAFE.F8.health red, KA.SAFE.087.health red and KA.SAFE.052.health red (M-SAFEARCH: the SAFE-ARCH-1 filter removed from routes/health.js, once it lands, if it confirms as P1)", "KA.F4.F8.approveFromOpen red and KA.F4.F8.approveEmpty red (M-F4a: HR-F4's submitted-only approve reverted, once it lands)", "KA.F4.F8.reopenNoReason red (M-F4r: HR-F4's reopen reason reverted, once it lands)", "KA.F5.F8.inactiveWorker red, KA.F5.F8.capAcrossSheets red and KA.F5.F8.rateTiming red (M-F5: HR-F5's three fix sites reverted, once they land)", "KA.F3.F8.approverBypass red (M-F3: HR-F3's reassignment guard reverted, once it lands)", "KA.F1.F8.pmApproveWhilePending red (M-F1: HR-F1's pending-steps guard reverted, once it lands)", "KA.F2.F8.approveWithoutReview red and KA.F2.F8.approveOutOfOrder red (M-F2: HR-F2's review and order guards reverted, once they land)", "KA.F6.F8.patchStatus red, KA.F6.F8.actionItemIdentity red and KA.F6.F8.duplicateTask red (M-F6: HR-F6's status, lock and in-place items reverted, once they land)", "KA.Q5.F8.severityDowngrade red, KA.Q5.F8V.evidenceWiped red and KA.Q5.F8.ltiEdit red (M-Q5: HR-Q5's freeze and evidence re-check reverted, once they land)", "KA.Q4.F8V.hardDelete red and KA.Q4.F8.legacyItpStatus red (M-Q4: HR-Q4's archive and audited status change reverted, once they land)", "KA.Q3.087.score red (M-Q3: HR-Q3's form ITPs in the score reverted, once it lands)", "KA.K1.F8.rfiOverdueHealth red (M-K1: HR-K1's single health service reverted, once it lands)", "KA.DL.F8.promoteStored red (M-C11d: WP-7's HR-C11 decimal-days fix mutation, WP7.mutations.fixMutations, once it lands)"], "mutation", "The fix mutations (plan section 1.4): each reverts a fix once it has landed, so that the known answer it turns into a value check has a catcher; none exists at HEAD, so none runs now. The two fix-list items (M-RFIRESP, M-SAFEARCH) join the list 'wp8-fix' only if their fixes land in WP-8.", [PH8(1049, 1050, 1051, 1058, 1059, 1060, 1061, 1062, 1063, 1079, 1096, 1114, 1116), WP8ADJ("Q4, Q5, Q6"), PREP8("section 7; section 9; section 10 G13"), "C:/Temp/octapm-cert/scratch/wp8/wp8-mutations-draft.json"], { company: C_FLD, note: "WP-8 G13 (2026-10-10): new." }),
    notRun: F(["M-QWmajor / M-QWitp (the 20 and 15 weights): the same line and catcher as M-QW, not run", "the sequential promotion guard (daily-log.service.js:1198): WP-7's PROMO.T7.twice, not run here", "the approved-day lock (daily-log.service.js:659): not a section 6.2 guard, not run"], "mutation", "Mutants considered and not run (WP8-PREP section 7), recorded so that the E6 tally of 7 guards and 8 mutants is complete.", [PH8(922, 1152), PREP8("section 7; section 10 G13"), "C:/Temp/octapm-cert/scratch/wp8/wp8-mutations-draft.json"], { company: C_FLD, note: "WP-8 G13 (2026-10-10): new." }),
  },
  F8: {
    project: F(F8_BOOK.project, "state", "F8-0: the throwaway's create payload, by the PM (company admin in 087). Created and archived by the proof (WP8ADJ Q1), as WP-1's W ... WP-7's T7.", F8_SRC, { assumption: true, note: "WP-8 G1 (2026-10-10): build choices; <stamp> is the run's, R the run date." }),
    team: F(F8_BOOK.team, "state", "F8-0: the members assigned on F8 and their project roles; the quality engineer is added with no project role (POST /projects/:id/team refuses quality_engineer as a role, RJ-12; as build/lib.js:1222 does). Each step is driven by the persona the policy names (WP8-PREP section 8; E8 rests on the WP-0 probe, 77 WP8.* entries, 0 failures).", F8_SRC, { assumption: true }),
    activities: F(F8_BOOK.activities, "state", "F8-0: F8-A1..A4, hand-built by the planner with engineerIds [the site engineer] (WP-7 run 1's lesson), so that the site engineer may log, raise and close out on them.", F8_SRC, { assumption: true }),
    workers: F(F8_BOOK.workers, "state", "F8-1: three own workers at 50.00 / h (WP8.timesheet's rate), W8-1 a steelfixer with overtime multiplier 1.5 (the mixed day's), W8-R for the rate change and W8-I for the inactive probe; the crew C8 of W8-1 (default activity F8-A1, 8 h), so the crew prefill gives 1 x 8. Company-level rows in 087's roster, set inactive at the end (WP8ADJ Q10). Money in currency units, as sent.", [...F8_SRC, HF8("backend/src/routes/timesheets.js", "24-35, 64-66")], { assumption: true }),
    evidence: F(F8_BOOK.evidence, "state", "F8-2: F8's own closeout evidence: an upload of the site engineer per closeout, sent as a reference to that stored document. workflow-support.service.js:406-424 keeps a storageKey; after the HR-X1 batch it is a canonical stored reference, so the choreography is the same before and after (WP8-PREP fact 9).", [...F8_SRC, HF8("backend/src/services/workflow-support.service.js", "406-424")], { assumption: true }),
    days: F(F8_BOOK.days, "state", "DA-DE (R-6 .. R-2): the daily-log days. DA holds the manpower mix as internal entries (each created approved), the Labourer rejected by review: the report reads Steelfixer 40, Carpenter 30, Labourer absent (WP8.F8.manpower). DB's delays of 2, 6 and 10 h are promoted to 0.5 / 1.0 / 1.5 days (rules.promoteDays). DC is approved for the approved-day probes, then reopened without a reason (HR-F4); DD is approved from open and DE approved empty (HR-F4).", [...F8_SRC, HF8("backend/src/services/daily-log.service.js", "926, 1194-1217, 1456")], { assumption: true }),
    timesheets: F(F8_BOOK.timesheets, "state", "TS-1 .. TS-7: the timesheet probes on F8. TS-1 is the mixed day (8 regular + 2 overtime + 1 double at 50.00 = 650.00); TS-2 the 25 h refusals; TS-3 the crew prefill and the second sheet of the same crew and date; TS-4, TS-5 and TS-6 HR-F5's three known answers; TS-7 the 0.5 worker refused by create and by import.", [...F8_SRC, HF8("backend/src/services/timesheet.service.js", "70, 375-385, 457-500, 537-587, 643-697")], { assumption: true }),
    qualityMix: F(F8_BOOK.qualityMix, "state", "Q-1: F8's NCRs and legacy ITPs: major-open (closed at Q-4), major-closed, minor-open, minor-submitted and minor-closed, each with its own closeout evidence, the closed ones approved by the quality engineer; legacy ITPs created pending and PATCHed failed, waived and passed with a comment; no form ITP. Score 100 - 2x20 - 3x8 - 1x15 = 21 on the three surfaces under either HR-Q3 model, and still 21 after the close (closed NCRs count).", [...F8_SRC, HF8("backend/src/services/quality.service.js", "38-51")], { assumption: true }),
    punchMix: F(F8_BOOK.punchMix, "state", "P-1: the punch and observation mix of WP8.punch.mix on F8: punch draft 2, open 2, ready_for_review 1, in_dispute 1, closed 1 (via ready: the PM's close 403, then the quality engineer's 200), void 1, final approver the quality engineer, manager the PM; observations safety open, environmental draft, quality closed, work_to_complete void, commissioning closed. Open defects 6 (drafts counted), 4 without drafts, observations open 2, safety observations 1.", [...F8_SRC, HF8("backend/src/services/quality.service.js", "27-31, 53-65")], { assumption: true }),
    safetySet: F(F8_BOOK.safetySet, "state", "SF-1: F8's safety set, WP8.safety.inputs on a fresh project: a near miss open, an LTI with 3 lost days closed out with its own evidence and approved by the quality engineer, a near miss archived by the PM's DELETE (archive sets status archived and archivedAt). Health 75 under SAFE-ARCH-1's fix (today 70: the archived one counted open), workspace 75, quality dashboard 2 incidents with 1 open (3 / 2 under M-ARCH). SF-3 edits the LTI's lost days 3 -> 5 (HR-Q5); SF-4 adds a fatality, open (health 0 under either reading).", [...F8_SRC, HF8("backend/src/routes/health.js", "171-173, 449-460"), HF8("backend/src/services/safety.service.js", "816-905")], { assumption: true, note: "WP-8 G9 (2026-10-10): the incident types are written as labels; the build sends the product's own type codes." }),
    rfis: F(F8_BOOK.rfis, "state", "R-1 and R-4: RFI-C (open, scheduleImpactFlag, scheduleImpact 3 on F8-A1) answered by the planner and approved by the PM (closed: the schedule-impact link of 3 days); RFI-RRB (open, responseRequiredBy R-3, the dueDate column null); RFI-ANS (dueDate R-4, answered), the two overdue-basis records of WP8.rfi.overdueRecords on F8.", [...F8_SRC, HF8("backend/src/services/rfi-workflow.service.js", "196-200, 415-426")], { assumption: true }),
    submittals: F(F8_BOOK.submittals, "state", "SUB-1 .. SUB-4: the template T8 (QS 3 days, planner 4: reviewDays 7); SUB-D direct and SUB-T on T8, both requiredOnSite 2027-01-25 with a lead of 2 weeks (submit-by 2027-01-11 and 2027-01-04); SUB-R on T8 for the response-code reset; SUB-I direct, requiredOnSite R+5, lead 2 weeks, on F8-A2, for the impact days (WP8.F8.submittalImpact).", [...F8_SRC, HF8("backend/src/services/submittal-workflow.service.js", "94, 253-269")], { assumption: true }),
    l213Template: F(F8_BOOK.l213Template, "state", "L213: the permission template of the L213 probe, base role QS plus task|action:update and without task.close, found or created by name in 087 and reused on later runs (WP8ADJ Q10, Q12: the one company-level template); the QS on F8's team holds it on F8 only.", [...F8_SRC, HF8("backend/src/services/task.service.js", "896-900"), HF8("backend/src/routes/tasks.js", "198-242")], { assumption: true }),
    manpower: F({ Steelfixer: 5 * 8, Carpenter: 3 * 10, Labourer: "absent", total: manHours(MP_COUNTED), workers: workersOf(MP_COUNTED) }, "state", "DA's manpower report on F8 (GET daily-logs/manpower-report, groupBy trade): the Steelfixer 5 x 8 and the Carpenter 3 x 10 are internal entries, created approved (daily-log.service.js:926), the Labourer 2 x 8 rejected by review; the report reads status in [approved, submitted] (:1456): Steelfixer 40, Carpenter 30, Labourer absent, total 70 man-hours, 8 workers. The same figures as WP8.dailyLog.manpower*, whose Carpenter is 087-FLD's submitted party entry (DL.087.manpower).", [PH8(880), HF8("backend/src/services/daily-log.service.js", "926, 1448-1488"), PREP8("section 5.1 DA; section 10 G15"), DERIVE_F8], { note: "WP-8 G15 (2026-10-10): new. On F8 the carpenter entry is internal (approved); the submitted party semantics stay 087-FLD's." }),
    submittalImpact: F({ submittal: "SUB-I", needBy: "R+5", leadTimeWeeks: 2, expected: "rules.submittalImpactDays({ approvedAtIso: SUB-I's observed reviewedOn, needByIso: R+5, leadTimeWeeks: 2 })", samples: [{ runDateR: "2026-10-12", approvedAt: "2026-10-12T14:30:00.000Z", needBy: "2026-10-17", impactDays: 10 }, { runDateR: "2026-10-12", approvedAt: "2026-10-12T00:00:01.000Z", needBy: "2026-10-17", impactDays: 10 }, { runDateR: "2026-10-12", approvedAt: "2026-10-13T00:05:00.000Z", needBy: "2026-10-17", impactDays: 11 }], link: "the submittal_lead_time link on F8-A2 carries the same days (only when days > 0)" }, "state", "SUB-4: the impact days are the book's rule (impactDaysRule) applied to the observed reviewedOn of the PM's approval: 10 when the approval lands on day R (UTC), 11 if it crosses midnight UTC after R was fixed (the samples, for run 2's R 2026-10-12). The lead-time link carries them (submittal-workflow.service.js:419-430, :422).", [PH8(910), HF8("backend/src/services/submittal-workflow.service.js", "263-269, 419-430, 471-483"), PREP8("section 0 fact 12; section 5.1 SUB-4; section 10 G19"), DERIVE_F8], { assumption: true, note: "WP-8 G19 (2026-10-10): new; each sample is recomputed at load with rules.submittalImpactDays." }),
    drawings: F(F8_BOOK.drawings, "state", "D-1 and D-3: F8-S1's revisions A (approved by review, then superseded by B), B (approved by review, the latest), C (uploaded) and X8 (filed approved by the PM, not latest and not superseded: the currentOnlyFixture of adjudication F4 on F8's product path); the warehouse register shows the storeman B only (['B']; ['B', 'X8'] under M-LAT). F8-S2's A, B and C serve HR-F2: A approved without review; B and C reviewed, C approved before B.", [PH8(914, 915, 937, 1059), HF8("backend/src/services/doc-control.service.js", "53, 99-108, 991-1112"), PREP8("section 5.1 D-1, D-3; section 10 G20"), DERIVE_F8], { assumption: true, note: "WP-8 G20 (2026-10-10): new." }),
    meetings: F(F8_BOOK.meetings, "state", "M-1 .. M-3: M8a for the PATCH status bypass (HR-F6, KA.F6.F8.patchStatus); M8b, a draft with attendees, distributed, then PATCHed, and its distribution rows read (CF.HRF6's items draftDistributed and editAfterDistribution; the rows 'sent'); M8c with two action items, the first with createTask (owner the site engineer), re-sent by PATCH without taskId (action-item identity and the duplicate task).", [PH8(918, 919, 938, 1063), HF8("backend/src/services/meeting.service.js", "937, 955-997, 1224-1319, 1481-1608"), PREP8("section 5.1 M-1 .. M-3; section 10 G21")], { assumption: true, note: "WP-8 G21 (2026-10-10): new." }),
    residue: F({ archived: ["F8", "F8V"], workersSetInactive: ["W8-1", "W8-R", "W8-I"], companyLevel: { inactiveWorkersPerRun: 3, permissionTemplates: 1 }, deepWrites: 0, deepRequestsRefusedBeforeAnyWrite: 1 }, "state", "What the WP-8 proof leaves: F8 and F8V archived; F8's three workers set inactive in 087's roster (three per run) and the one L213 permission template (found or created by name, reused): recorded residue in 087, a deep company outside the 97 (WP8ADJ Q10). No write reaches 087-FLD or 052-FLD: the one request sent to 087-FLD, the party user's entry on the submitted D5, is refused 409 DAILY_LOG_SUBMITTED before any write (WP8ADJ Q2; S.087FLD.unchanged).", [...F8_SRC, WP8ADJ("Q2, Q10")], { assumption: true, note: "WP-8 G1 (2026-10-10, WP8ADJ Q2, Q10)." }),
    choreography: F(F8_STEPS, "list", "F8's run order (WP8-PREP section 5.1): each step with the check ids it serves; each F8 check id is served by exactly one step (checked at load). Order: every score read before the probe that moves it (Q-2 and Q-4 before Q-5; SF-2 before SF-3 and SF-4; P-2 before P-3); the Q-5 probes restored at once; the R-4 reads with no submittal change between them; T-1 after D-1; the deep reads before and after the F8 block (S.087FLD.unchanged).", F8_SRC, { assumption: true, note: "WP-8 G1 (2026-10-10): the moment-map deviation recorded by key when the proof lands (WP8-PREP section 5.4; WP8ADJ Q1): every WP-8 writing check and catcher on F8 / F8V; 087-FLD's open major NCR closed on F8 (Q.F8.closeMajor), not 087-FLD." }),
  },
  F8V: {
    project: F(F8V_BOOK.project, "state", "V-0: the second throwaway, by the PM, created and archived by the proof (WP8ADJ Q1).", F8V_SRC, { assumption: true, note: "WP-8 G1 (2026-10-10): build choices; <stamp> is the run's." }),
    team: F(F8V_BOOK.team, "state", "V-0: the site engineer, and the quality engineer with no project role (RJ-12).", F8V_SRC, { assumption: true }),
    records: F(F8V_BOOK.records, "state", "V-0 .. V-5: 6 major NCRs by the PM (score 100 - 120 = -20, clamped to 0: Q.F8V.sixMajor; M-CLAMP reads -20); the minor NCRs V-E (evidence wiped, HR-Q5), V-T (text-only, HR-X1) and V-D (malformed keys, D-VAL-1's NCR half); one major NCR and a pending legacy ITP DELETEd (HR-Q4). The score stays 0 throughout: 5 or 6 major and up to 3 minor are below 0 before the clamp.", F8V_SRC, { assumption: true }),
    choreography: F(F8V_STEPS, "list", "F8V's run order (WP8-PREP section 5.2): each step with the check ids it serves; each F8V check id is served by exactly one step (checked at load).", F8V_SRC, { assumption: true }),
  },
  CF: {
    HRF4: F({ approveFromOpen: { refused: true, code: null, dayStatus: "open" }, approveEmptyDay: { refused: true, code: null, dayStatus: "open" }, reopenWithoutReason: { status: 400, code: null, dayStatus: "approved" }, sitePromotion: { status: "2xx", contractual: false, contractualUsedDelta: 0 } }, "state", "CF.HRF4, the plan's confirm-first 'approval from open or of an empty day; reopen without a reason; contractual weather delays created by site staff -> HR-F4' (:928 PH8): its items as HR-F4's recommendation answers them (the known answers' values) and as HEAD does (their todays): F8's DD, DE and DC (WP8.dailyLog.approveFromOpen, approveEmptyDay, reopenWithoutReason; 087-FLD's D1 approved straight from open, stored), and the site engineer's promotion read from WP-7's result file (commercial.js WP7.promotion.sitePromotion, KA.F4.T7.sitePromotion; WP7ADJ Q8, WP8ADJ Q8: classified here, no duplicate write).", [PH8(883, 928, 1061), WP8ADJ("Q8"), PREP8("section 4; section 10 G14"), "C:/Temp/octapm-cert/results/cert3/wp7-eot-proof.json (KA.F4.T7.sitePromotion)"], { assumption: true, today: { approveFromOpen: "200 approved", approveEmptyDay: { status: 200, dayStatus: "approved" }, reopenWithoutReason: { status: 200, dayStatus: "open" }, sitePromotion: { status: 200, contractual: true, contractualUsedDelta: 1 } }, ref: "HR-F4", note: "WP-8 G14 (2026-10-10): CONFIRMED expected (the site-staff item CONFIRMED by WP-7's debug run 2); TEST GAP for that item if WP-7's result file is absent (WP8ADJ Q8). HR-F4 is the owner's (O1). Ref HR-F4, an assumption." }),
    HRF5: F({ rateTiming: 8 * RATE, inactiveWorker: { refused: true, code: null, sheetsCreated: 0 }, capAcrossSheets: { refused: true, code: null, sheetsCreated: 1 } }, "state", "CF.HRF5, the plan's confirm-first 'timesheet hour cap, rate timing, inactive workers -> HR-F5' (:930 PH8): its three items as HR-F5's recommendation answers them and as HEAD does (WP8.timesheet.rateChangeRecorded, inactiveWorker, capAcrossSheets).", [PH8(930, 1062), PREP8("section 4; section 10 G14")], { assumption: true, today: { rateTiming: 8 * 6000, inactiveWorker: { status: 201, sheetsCreated: 1 }, capAcrossSheets: { status: 201, sheetsCreated: 2, hoursOnTheDay: 16 + 9 } }, ref: "HR-F5", note: "WP-8 G14 (2026-10-10): CONFIRMED expected from code reading (timesheet.service.js:375-385, :486-487, :653); HR-F5 is the owner's (O2). TS-RATE-1 is HR-F5's rate timing itself, no separate defect. Ref HR-F5, an assumption." }),
    HRQ5: F({ severityDowngrade: { refused: true, code: null, score: qualityScore(FLD_QUALITY) }, evidenceWiped: { approved: false, code: null, ncrStatus: "submitted" }, ltiEdit: { refused: true, code: null, lostDays: 3 } }, "state", "CF.HRQ5, the plan's confirm-first 'NCR and safety edits after closure -> HR-Q5' (:931 PH8): its items as HR-Q5's recommendation answers them and as HEAD does (WP8.quality.severityDowngradeProbe, evidenceWipedBeforeApprovalProbe, WP8.safety.ltiEditAfterClosure).", [PH8(931, 1051), PREP8("section 4; section 10 G14")], { assumption: true, today: { severityDowngrade: { status: 200, score: qualityScore({ major: 1, minor: 4, failedItp: 1 }) }, evidenceWiped: { status: 200, ncrStatus: "closed" }, ltiEdit: { status: 200, lostDays: 5 } }, ref: "HR-Q5", note: "WP-8 G14 (2026-10-10): CONFIRMED expected (ncr.service.js:348-352, :362; safety.service.js:361-390); r3b leaves the approval gates unchanged. HR-Q5 is the owner's (O4). Ref HR-Q5, an assumption." }),
    HRQ4: F({ hardDelete: { ncr: "archived, not deleted: the row reads back with archivedAt set and is excluded from the score", legacyItp: "archived, not deleted: the row reads back with archivedAt set and is excluded from the score" }, legacyItpStatus: { refused: true, code: null, score: qualityScore(FLD_QUALITY) } }, "state", "CF.HRQ4, the plan's confirm-first 'hard deletes and legacy ITP status -> HR-Q4' (:931 PH8): its items as HR-Q4's recommendation answers them and as HEAD does (WP8.quality.hardDeleteProbe, legacyItpFailedToPassedProbe).", [PH8(931, 1050), PREP8("section 4; section 10 G14")], { assumption: true, today: { hardDelete: { ncr: "200 { deleted: true }; the row is gone", legacyItp: "200 { deleted: true }; the row is gone" }, legacyItpStatus: { status: 200, score: qualityScore({ major: 2, minor: 3, failedItp: 0 }) } }, ref: "HR-Q4", note: "WP-8 G14 (2026-10-10): CONFIRMED expected (ncr.service.js:786, itp.service.js:204, itp.js:80). Observation, reported and not classified: closed NCRs keep counting (Q.F8.closeMajor, 21), which is HR-Q4's own recommendation. HR-Q4 is the owner's (O4). Ref HR-Q4, an assumption." }),
    HRF3: F({ approverBypass: { patch: { refused: true, code: null }, close: "403 PUNCH_FINAL_APPROVER_ONLY" } }, "state", "CF.HRF3, the plan's confirm-first 'punch final-approver bypass -> HR-F3' (:932 PH8): WP8.punch.finalApproverBypass as HR-F3's recommendation answers it and as HEAD does.", [PH8(932, 1060), PREP8("section 4; section 10 G14")], { assumption: true, today: { approverBypass: { patch: 200, close: "200 closed" } }, ref: "HR-F3", note: "WP-8 G14 (2026-10-10): CONFIRMED expected (punch.service.js:497-499); HR-F3 is the owner's (O5). Ref HR-F3, an assumption." }),
    SAFEARCH: F({ F8: safetyScore({ lti: 1, open: 1 }), "087-FLD": safetyScore({ lti: 1, open: 1 }), "052-FLD": safetyScore({ lti: 1, open: 1 }) }, "score", "CF.SAFEARCH, the plan's confirm-first 'health counts archived incidents: a metric aligned with the other dashboards, not a rule change' (:933 PH8; fix list :1116): the health card's safety on F8, 087-FLD and 052-FLD as the fix answers it (archived excluded, the workspace's and the quality dashboard's definition) and as HEAD does (every incident read at health.js:171-173, open = status != closed at :455-457): WP8.safety.health, WP8[\"052-FLD\"].safetyHealth.", [PH8(900, 933, 1116), HF8("backend/src/routes/health.js", "171-173, 455-457"), WP8ADJ("Q4"), PREP8("section 0 fact 7; section 4; section 10 G14")], { assumption: true, today: { F8: safetyScore({ lti: 1, open: 2 }), "087-FLD": safetyScore({ lti: 1, open: 2 }), "052-FLD": safetyScore({ lti: 1, open: 2 }) }, ref: "SAFE-ARCH-1", note: "WP-8 G14 (2026-10-10, WP8ADJ Q4): CONFIRMED expected (052-FLD's and 087-HLT's builds observed 70). Provisionally P2 (a dashboard figure, wrong by 5 per archived incident, no workflow, money or data effect); the severity is decided at the run; the fix lands in WP-8 only if it confirms as P1, and WP-9's WP9.health.safetyExpected then turns value. Ref SAFE-ARCH-1, an assumption." }),
    RFIRESP: F({ responsesPath: "409 RFI_ALREADY_CLOSED", recordPath: "409 RFI_ALREADY_CLOSED", officialAnswer: "unchanged" }, "state", "CF.RFIRESP, the plan's confirm-first 'RFI official response editable after closure: defect' (:934 PH8; fix list :1114): WP8.rfi.officialResponsePaths as the fix answers it and as HEAD does.", [PH8(904, 934, 1114), WP8ADJ("Q5"), PREP8("section 0 fact 8; section 4; section 10 G14")], { assumption: true, today: { responsesPath: 200, recordPath: 200, officialAnswer: "rewritten, the previous text kept nowhere" }, ref: "RFI-RESP-1", note: "WP-8 G14 (2026-10-10, WP8ADJ Q5): CONFIRMED expected; provisionally P1, settled at the run (P1 unless the run shows the rewrite is visible nowhere). On the fix list (:1114): REJECTED once the fix lands. Ref RFI-RESP-1, an assumption." }),
    HRK1rfi: F({ health: { "RFI-RRB": true, "RFI-ANS": false }, healthF8: { afterRRB: 1, afterANS: 0 } }, "state", "CF.HRK1rfi, the plan's confirm-first 'health's RFI overdue basis -> HR-K1' (:935 PH8): the card's basis (WP8.rfi.overdueHealth) and F8's card deltas (overdueHealthF8) as HR-K1's recommendation (the workspace basis) answers them and as HEAD does; the workspace (overdueWorkspace, overdueWorkspaceF8) and the API (overdueDetail, overdueListFilter) are observations, HEAD's answers.", [PH8(906, 935, 1096), PREP8("section 4; section 10 G14")], { assumption: true, today: { health: { "RFI-RRB": false, "RFI-ANS": true }, healthF8: { afterRRB: 0, afterANS: 1 } }, ref: "HR-K1", note: "WP-8 G14 (2026-10-10): CONFIRMED expected (health.js:462-465 against workspace-dashboard.service.js:1168-1175); HR-K1 is WP-9's main row. Ref HR-K1, an assumption." }),
    HRF1: F({ pmApproveWhilePending: { status: 409, code: null, submittalApproved: false } }, "state", "CF.HRF1, the plan's confirm-first 'submittal step bypass -> HR-F1; a stale lead-time link: defect (P2)' (:936 PH8): WP8.submittal.pmApprovalWhileStepsPending as HR-F1's recommendation answers it and as HEAD does.", [PH8(936, 1058), HF8("backend/src/services/submittal-workflow.service.js", "422"), WP8ADJ("Q14"), PREP8("section 4; section 10 G14")], { assumption: true, today: { pmApproveWhilePending: { status: 200, submittalApproved: true, stepsLeftUndecided: 2 } }, ref: "HR-F1", note: "WP-8 G14 (2026-10-10): CONFIRMED expected (submittal.service.js:925-966). The stale lead-time link (SUB-LINK-1, P2, recorded only, WP8ADJ Q14) CONFIRMED by code reading: no live path re-approves a submittal once approved (submittal-workflow.service.js:422). HR-F1 is the owner's (O5). Ref HR-F1, an assumption." }),
    HRF2: F({ approveWithoutReview: { refused: true, code: null, revisionStatus: "uploaded" }, approveOutOfOrder: { refused: true, code: null, latestApproved: "C" } }, "state", "CF.HRF2, the plan's confirm-first 'drawing order -> HR-F2' (:937 PH8): WP8.drawing.approveWithoutReview and approveOutOfOrder as HR-F2's recommendation answers them and as HEAD does.", [PH8(937, 1059), PREP8("section 4; section 10 G14")], { assumption: true, today: { approveWithoutReview: { status: 200, revisionStatus: "approved", latest: true }, approveOutOfOrder: { status: 200, latestApproved: "B", superseded: ["C"] } }, ref: "HR-F2", note: "WP-8 G14 (2026-10-10): CONFIRMED expected (doc-control.service.js:1015-1047); HR-F2 is the owner's (O5). Ref HR-F2, an assumption." }),
    HRF6: F({ patchStatus: { refused: true, code: null, meetingStatus: "draft" }, draftDistributed: { refused: true, code: null, meetingStatus: "draft" }, editAfterDistribution: { refused: true, code: null, minutesChanged: false }, actionItemIdentity: "same id across edits", duplicateTask: 1 }, "state", "CF.HRF6, the plan's confirm-first 'meetings -> HR-F6; distribution rows always say sent: P2' (:938 PH8): its items as HR-F6's recommendation answers them and as HEAD does (WP8.transmittal.distributeBypass, draftDistributed, editAfterDistribution, actionItemIdentity, createTaskTasks).", [PH8(938, 1063), HF8("backend/src/services/meeting.service.js", "937, 1224-1319, 1481-1608"), WP8ADJ("Q14"), PREP8("section 4; section 10 G14, G21")], { assumption: true, today: { patchStatus: { status: 200, meetingStatus: "distributed" }, draftDistributed: { status: 200, meetingStatus: "distributed", rowsStatus: "sent" }, editAfterDistribution: { status: 200, minutesChanged: true }, actionItemIdentity: "a new id", duplicateTask: 2 }, ref: "HR-F6", note: "WP-8 G14 (2026-10-10): CONFIRMED expected. Recorded only (WP8ADJ Q14): the distribution rows always 'sent' with channel email whatever is delivered (MTG-SENT-1, P2, meeting.service.js:1530-1531). Observation, not classified: a transmittal acknowledged through PATCH (no rule names it). HR-F6 is the owner's (O5). Ref HR-F6, an assumption." }),
  },
  leads: {
    L213: F({ patchDone: "200, the task closed (closedAt set)", closeAction: "403 FORBIDDEN" }, "state", "L213 (leads :219, P3; plan :920, :939): a member whose template grants task:update but not task.close (WP8.F8.l213Template, the QS on F8) PATCHes an F8 task { status: done }: 200 and the task is closed (updateTask stamps closedAt for done or canceled, task.service.js:896-900), while the close action itself answers that member 403 FORBIDDEN (routes/tasks.js:217-242).", [PH8(920, 939), HF8("backend/src/services/task.service.js", "896-900"), HF8("backend/src/routes/tasks.js", "198-242"), "docs/certification/OCTAPM_CERT_LEADS.md:219 @14a3db2", WP8ADJ("Q12"), PREP8("section 4; section 10 G18")], { assumption: true, note: "WP-8 G18 (2026-10-10, WP8ADJ Q12): new; an observation for CF.L213 (CONFIRMED expected, P3). The live probe runs with the one company-level template of Q10." }),
    L146: F({ deleteAnswer: "200 { deleted: true }", rowGone: true, auditEvents: 0 }, "state", "L146 (leads :152, P2 there; P3 in the plan :939): the planner (document_control:update) DELETEs a plain F8 transmittal: 200 { deleted: true }, the row gone (a hard delete, transmittal.service.js:232) and no audit event for it (GET /projects/F8/audit?entityType=transmittal&entityId=<id>: 0). Weather delays the same (WP-7's WX-DEL-1, not re-probed). HR-A2, the delete permission, is the owner's question (O7).", [PH8(939), HF8("backend/src/services/transmittal.service.js", "221-234"), "docs/certification/OCTAPM_CERT_LEADS.md:152 @14a3db2", PREP8("section 4; section 10 G18")], { assumption: true, note: "WP-8 G18 (2026-10-10): new; an observation for CF.L146 (CONFIRMED expected)." }),
    DVAL1: F({ transmittal: "201, the malformed storage key dropped", ncrCloseout: "200, the malformed storage key dropped", namesAnotherCompany: false }, "state", "D-VAL-1 (register :199, P3; plan :939): POST /transmittals (F8, T-3) and an NCR closeout (F8V, V-5) with attachmentRefs[].storageKey an object, a number or a boolean: today 201 / 200, the key dropped by normalizeAttachmentRefs (workflow-support.service.js:406-424); nothing names another company. Classified after the HR-X1 batch, which rewrites that judge (FIXES['HR-X1']).", [PH8(939), HF8("backend/src/services/workflow-support.service.js", "406-424"), "docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:199 @14a3db2", PREP8("section 4; section 10 G18")], { assumption: true, note: "WP-8 G18 (2026-10-10): new; an observation for CF.DVAL1 (P3), read at HEAD and again after the batch." }),
    LDETAILS: F({ production: "no error.details (error-handler.js:303-306 includeDetails, api-response.js:37)", readers: ["web features/inspections use-forms.ts:789-800 (FORM_INCOMPLETE problems)", "web bulk-progress-update.tsx:83 (WP-2)", "mobile app/(app)/quality/inspections/[id].tsx:130-131 (FORM_INCOMPLETE problems)", "mobile app/(app)/commercial/pay-apps/[id].tsx:68-69 (WP-4 over-claim lines; not in the register row)", "mobile src/api/inventory-hooks.ts:124 (WP-5 receipt ids)", "mobile src/offline/senders.ts:80 (WP-5 receipt ids)", "mobile src/api/errors.ts:67-99 (the first field message of a VALIDATION error; SRV-04)"], productionFallback: "an empty list, a null id or a generic sentence; none writes" }, "state", "L-DETAILS (register :303, lead, 'for the WP-8 client sweep'; r3-rulings N-R3-1): production sends no error.details, and a source scan of the web and mobile clients finds seven readers of an error's details, each falling back in production. The ITP hold-point list is the API's ITP_HOLD_POINT_OPEN details.holdPoints, read by WP-2's proof and by no client.", [HF8("backend/src/middleware/error-handler.js", "303-306"), "docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:303 @14a3db2", "C:/Temp/octapm-cert/scratch/wp2/r3-rulings.md N-R3-1", WP8ADJ("Q14"), PREP8("section 0 fact 15; section 4; section 10 G18")], { assumption: true, note: "WP-8 G18 (2026-10-10, WP8ADJ Q14): new; an observation for CF.LDETAILS (P3 proposed). The register row gains mobile pay-apps/[id].tsx:68-69 (WP-4) and the two WP-8 readers." }),
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

/** company code -> figure keys (087-FLD, 052-FLD, 087-EXC, 087-HLT, 087-OTH). */
function byCompany() {
  const map = {};
  for (const f of figures()) if (f.company) (map[f.company] = map[f.company] || []).push(f.key);
  return map;
}

// Load check of the WP-7 answer-book patch (2026-10-10, C:/Temp/octapm-cert/scratch/wp7/WP7-ADJUDICATION.md Q12; WP7-PREP.md
// section 10 G2): the two HR-C11 known answers of this book that WP-7 reads carry their ref; figures() emits it; a ref names its today.
(() => {
  const fail = (what) => {
    throw new Error("field-controls answer book: " + what);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const known = [
    ["WP8.dailyLog.promoteResponseVsStored", WP8.dailyLog.promoteResponseVsStored],
    ["WP8.weather.nonContractualAddsNothing", WP8.weather.nonContractualAddsNothing],
  ];
  for (const [key, leaf] of known) {
    if (!leaf || leaf.ref !== "HR-C11" || leaf.today === undefined || leaf.assumption !== true || same(leaf.today, leaf.value)) fail(key + ": an HR-C11 known answer with its today and ref HR-C11, an assumption, its value never its today (WP-7 G2, KA.I9 ruling)");
  }
  // the two leaves are the record set's: the promotions' echo and their truncated rows; the sum at 14 and its truncation
  const echo = "response " + PROMOTED.map((p) => p.days.toFixed(1)).join(" / ");
  const storedRows = "stored " + trunc(PROMOTED.map((p) => p.days)).join(" / ");
  if (WP8.dailyLog.promoteResponseVsStored.value !== echo || WP8.dailyLog.promoteResponseVsStored.today !== storedRows) fail("WP8.dailyLog.promoteResponseVsStored: the promotions' echo and their stored rows (WP-7 G2)");
  if (WP8.weather.nonContractualAddsNothing.value !== FLD_WEATHER_AT.used || WP8.weather.nonContractualAddsNothing.today !== FLD_WEATHER_AT_TODAY.used) fail("WP8.weather.nonContractualAddsNothing: the contractual sum at 14 and its truncated reading (WP-7 G2)");
  // figures() emits the ref of both
  const rows = figures();
  for (const [key] of known) {
    const row = rows.find((r) => r.key === key);
    if (!row || row.ref !== "HR-C11") fail("figures() must emit the ref of " + key + " (WP-7 G2)");
  }
  // a ref always names its today (a today without a ref stays this book's convention until its owners add refs)
  for (const row of rows) if (row.ref !== undefined && (row.today === undefined || typeof row.ref !== "string" || !row.ref)) fail(row.key + ": a ref without its today (WP-7 G2)");
})();

// Load checks of the WP-8 answer-book patch (2026-10-10, C:/Temp/octapm-cert/scratch/wp8/WP8-ADJUDICATION.md Q1-Q14;
// WP8-PREP.md section 10 G1-G23): each added or changed leaf agrees with the figures it is built from; the WP-8 leaf contract.
(() => {
  const fail = (what) => {
    throw new Error("field-controls answer book: " + what);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const leafAt = (key) => key.split(".").reduce((node, k) => (node && typeof node === "object" ? node[k] : undefined), { WP8, WP9 });
  const F8 = WP8.F8;
  const F8V = WP8.F8V;
  const Q = WP8.quality;
  // G1: F8's project, team and activities
  const team = F8.team.value;
  if (!same(Object.keys(team.roles).sort(), ["cost_controller", "planning_eng", "qs", "site_engineer", "warehouse"]) || !same(team.noProjectRole, ["quality"]) || F8.project.value.currency !== "EGP" || F8.project.value.projectCalendar !== "five_day" || !same(F8V.team.value.noProjectRole, ["quality"])) fail("WP8.F8.project and team: the planner, QS, cost controller, site engineer and storeman with their roles, the quality engineer with none (RJ-12), EGP, five-day (G1)");
  if (F8.activities.value.length !== 4 || F8.activities.value.some(([code, engineer], i) => code !== "F8-A" + (i + 1) || engineer !== "site")) fail("WP8.F8.activities: F8-A1..A4, each with the site engineer as its engineer (G1)");
  // G1: the workers at WP8.timesheet's rate; the crew of one, so the prefill is 1 x 8
  const w = F8.workers.value;
  if (["W8-1", "W8-R", "W8-I"].some((k) => Math.round(w[k].hourlyRate * 100) !== RATE) || w["W8-1"].overtimeMultiplier !== TS_MIXED[1].otMultiplier || !same(w.crew.members, ["W8-1"]) || w.crew.defaultHours !== 8) fail("WP8.F8.workers: W8-1, W8-R and W8-I at 50.00, W8-1's overtime 1.5, the crew C8 of W8-1 at 8 h (G1)");
  // G1, G15: DA is the manpower mix; the report reads the approved and submitted entries
  const da = F8.days.value.find((d) => d.day === "DA");
  if (!da || !same(da.entries.map(([t, n, h]) => [t, n, h]), MANPOWER.map(([t, n, h]) => [t, n, h])) || !same(da.entries.map((e) => e[4]), ["approved", "approved", "rejected"])) fail("WP8.F8.days: DA holds the manpower mix as internal entries, the Labourer rejected (G1, G15)");
  const counted = da.entries.filter((e) => e[4] === "approved" || e[4] === "submitted");
  const byTrade = (t) => counted.filter((e) => e[0] === t).reduce((s, e) => s + e[1] * e[2], 0);
  const mp = F8.manpower.value;
  const D = WP8.dailyLog;
  if (mp.Steelfixer !== byTrade("Steelfixer") || mp.Carpenter !== byTrade("Carpenter") || byTrade("Labourer") !== 0 || mp.Labourer !== "absent" || mp.total !== counted.reduce((s, e) => s + e[1] * e[2], 0) || mp.workers !== counted.reduce((s, e) => s + e[1], 0) || mp.Steelfixer !== D.manpowerSteelfixer.value || mp.Carpenter !== D.manpowerCarpenter.value || mp.Labourer !== D.manpowerLabourer.value || mp.total !== D.manpowerTotal.value || mp.workers !== D.manpowerWorkers.value || WP8.mutations.manpowerStatusFilter.value !== da.entries.reduce((s, e) => s + e[1] * e[2], 0)) fail("WP8.F8.manpower: DA's report is WP8.dailyLog.manpower*, 86 under M-MP (G15)");
  const db = F8.days.value.find((d) => d.day === "DB");
  if (!db || !same(db.delays.map(([h]) => promoteDays(h)), [D.promote2h.value, D.promote6h.value, D.promote10h.value])) fail("WP8.F8.days: DB's 2, 6 and 10 h delays promote to WP8.dailyLog.promote2h / 6h / 10h (G1)");
  // G1, G6: the timesheets
  const ts = (k) => F8.timesheets.value.find((t) => t.sheet === k);
  const priced = labourCents(ts("TS-1").entries.map(([hours, timeType]) => ({ hours, rateCents: Math.round(w["W8-1"].hourlyRate * 100), timeType, otMultiplier: w["W8-1"].overtimeMultiplier })));
  if (priced !== WP8.timesheet.mixedDay.value || priced - Math.round(1 * RATE * 2) + Math.round(1 * RATE) !== WP8.mutations.doubleTimeMultiplier.value) fail("WP8.F8.timesheets: TS-1 prices to WP8.timesheet.mixedDay (650.00; 600.00 under M-DT) (G1)");
  const rc = WP8.timesheet.rateChangeRecorded;
  const t5 = ts("TS-5");
  const t5hours = t5.entries.reduce((s, [h]) => s + h, 0);
  if (rc.value !== Math.round(t5hours * t5.rateChange[0] * 100) || rc.today !== Math.round(t5hours * t5.rateChange[1] * 100) || rc.ref !== "HR-F5") fail("WP8.timesheet.rateChangeRecorded: value 8 h at the submission rate 50.00, today at the approval rate 60.00, ref HR-F5 (G6)");
  const t4 = ts("TS-4").acrossSheets;
  const cap = WP8.timesheet.capAcrossSheets;
  if (!(t4.reduce((a, b) => a + b, 0) > 24) || t4.some((h) => h > 24) || cap.today.hoursOnTheDay !== t4.reduce((a, b) => a + b, 0) || cap.value.sheetsCreated !== 1 || cap.today.sheetsCreated !== 2 || ts("TS-2").split.reduce((a, b) => a + b, 0) !== ts("TS-2").entries[0][0]) fail("WP8.timesheet.capAcrossSheets: TS-4's 16 + 9 h across two sheets, 25 > 24 on one day: one sheet under HR-F5, two today (G6)");
  // G1, G4, G8, G23: F8's quality mix and the probes on it
  const qm = F8.qualityMix.value;
  const mix = { major: qm.ncrs.filter((n) => n[1] === "major").length, minor: qm.ncrs.filter((n) => n[1] === "minor").length, failedItp: qm.legacyItps.filter((s) => s === "failed").length };
  const score = qualityScore(mix);
  if (!same(mix, FLD_QUALITY) || qm.formInstances !== 0 || [Q.dashboard087FLD, Q.health087FLD, Q.workspace087FLD, Q.closeMajorLeaves].some((l) => l.value !== score) || WP8.mutations.qualityWeightMinor10.value !== qualityScore({ ...mix, weights: { major: 20, minor: 10, failedItp: 15 } })) fail("WP8.F8.qualityMix: 2 major, 3 minor, 1 failed legacy ITP and no form ITP give 21 on the three surfaces and after the close; 15 under M-QW (G1, G23)");
  const sd = Q.severityDowngradeProbe;
  if (!same(sd.value, { refused: true, code: null, score }) || !same(sd.today, { status: 200, score: qualityScore({ ...mix, major: mix.major - 1, minor: mix.minor + 1 }) })) fail("WP8.quality.severityDowngradeProbe: value refused and 21, today 200 and 33 (a closed major read as minor) (G8)");
  const li = Q.legacyItpFailedToPassedProbe;
  if (!same(li.value, { refused: true, code: null, score }) || !same(li.today, { status: 200, score: qualityScore({ ...mix, failedItp: mix.failedItp - 1 }) })) fail("WP8.quality.legacyItpFailedToPassedProbe: value refused and 21, today 200 and 36 (+15) (G8)");
  for (const leaf of [Q.formItpCounted087FLD, Q.formItpFailureNotCounted]) if (leaf.value !== qualityScore({ ...FLD_QUALITY, failedItp: FLD_QUALITY.failedItp + FLD_FORM_FAILED }) || leaf.today !== Q.dashboard087FLD.value || leaf.ref !== "HR-Q3") fail("WP8.quality.formItpCounted087FLD and formItpFailureNotCounted: value 6 (the A120 form instance counted), today 21, ref HR-Q3 (G4, WP8ADJ Q3)");
  for (const k of ["dashboard087FLD", "health087FLD", "workspace087FLD", "inputs087FLD"]) if ((Q[k].note || "").indexOf("HEAD's model") < 0) fail("WP8.quality." + k + ": the note must say that 087-FLD reads 21 only under HEAD's model (G4)");
  if ((Q.closeMajorLeaves.note || "").indexOf("closed on F8") < 0 || Q.closeMajorLeaves.source.indexOf("087-fld.js:1384") < 0) fail("WP8.quality.closeMajorLeaves: closed on F8, not 087-FLD (087-fld.js:1384) (G23)");
  const sv = F8V.records.value;
  if (qualityScore({ major: sv.majorNcrs }) !== WP8.quality.sixMajor.value || qualityScore({ major: sv.majorNcrs, clamp: false }) !== WP8.mutations.dropClamp.value || 100 - (sv.majorNcrs - sv.deletedMajor) * 20 - sv.minorNcrs.length * 8 >= 0) fail("WP8.F8V.records: 6 major give 0 (-20 under M-CLAMP), and the score stays 0 after the delete and the three minor NCRs (G1)");
  // G1, G11, G3: the punch mix, the reason-required pairs, the bypass
  const pmix = F8.punchMix.value;
  const openD = Object.entries(pmix.punch).filter(([s]) => s !== "closed" && s !== "void").reduce((n, [, c]) => n + c, 0);
  const isOpen = (s) => s !== "closed" && s !== "void";
  if (openD !== WP8.punch.openDefects.value || openD - pmix.punch.draft !== WP8.punch.openDefectsWithoutDrafts.value || Object.values(pmix.observations).filter(isOpen).length !== WP8.punch.openObservations.value || (isOpen(pmix.observations.safety) ? 1 : 0) !== WP8.punch.safetyObservationsOpen.value || Object.keys(pmix.observations).length !== 5) fail("WP8.F8.punchMix: open defects 6 (4 without drafts), observations open 2, safety 1 (G1)");
  const byAction = {};
  for (const [action, row] of Object.entries(PUNCH_TABLE)) {
    const n = Object.values(row).filter((v) => v.startsWith("ok with reason")).length;
    if (n) byAction[action] = n;
  }
  if (!same(byAction, { reopen: 2, dispute: 2, void: 4 }) || WP8.punch.reasonRequiredPairs.value !== 8 || PUNCH_REASON_PAIRS !== 8) fail("WP8.punch.reasonRequiredPairs: reopen 2 + dispute 2 + void 4 = 8 reason-required legal pairs (G11)");
  const fb = WP8.punch.finalApproverBypass;
  if (!same(fb.value, { patch: { refused: true, code: null }, close: WP8.punch.closeByNonApprover.value }) || !same(fb.today, { patch: 200, close: "200 closed" }) || fb.derivation.indexOf("oneself") >= 0 || pmix.finalApprover !== "quality") fail("WP8.punch.finalApproverBypass: the site engineer names the PM, who closes; value the PATCH refused and the gate's 403, today 200 and 200 closed (G3, G11)");
  // G9, Q4: the safety set
  const ss = F8.safetySet.value;
  const lti = ss.incidents.filter((i) => i.type === "LTI").length;
  const live = ss.incidents.filter((i) => i.status !== "archived");
  const openLive = live.filter((i) => i.status !== "closed").length;
  const openAll = ss.incidents.filter((i) => i.status !== "closed").length;
  const S = WP8.safety;
  if (safetyScore({ lti, open: openLive }) !== S.health.value || safetyScore({ lti, open: openAll }) !== S.health.today || S.workspace.value !== S.health.value || live.length !== S.dashboardIncidents.value || openLive !== S.dashboardOpen.value || ss.incidents.length !== WP8.mutations.archivedFilterDashboardIncidents.value || openAll !== WP8.mutations.archivedFilterDashboardOpen.value || safetyScore({ fatalities: 1, lti, open: openLive + 1 }) !== S.fatality.value || safetyScore({ fatalities: 1, lti, open: openAll + 1 }) !== S.fatality.value) fail("WP8.F8.safetySet: health 75 (today 70), workspace 75, dashboard 2 / 1 (3 / 2 under M-ARCH), a fatality 0 under either reading (G9)");
  const s052 = WP8["052-FLD"].safetyHealth;
  if (s052.value !== S.health.value || s052.today !== S.health.today || s052.ref !== "SAFE-ARCH-1" || S.health.ref !== "SAFE-ARCH-1") fail("WP8.052-FLD.safetyHealth and WP8.safety.health: the same set, ref SAFE-ARCH-1 (G2, G22, WP8ADJ Q4)");
  const le = S.ltiEditAfterClosure;
  const ltiRow = ss.incidents.find((i) => i.type === "LTI");
  if (!same(le.value, { refused: true, code: null, lostDays: ltiRow.lostDays }) || !same(le.today, { status: 200, lostDays: ss.ltiEditTo })) fail("WP8.safety.ltiEditAfterClosure: lost days 3 kept under HR-Q5, today 200 and 5 (G3, G9)");
  // G1, G5, G10: the RFIs
  const rf = F8.rfis.value;
  const R = WP8.rfi;
  if (rf["RFI-C"].scheduleImpact !== R.scheduleImpactLink.value || rf["RFI-RRB"].dueDate !== null || rf["RFI-RRB"].status !== "open" || rf["RFI-ANS"].responseRequiredBy !== null || rf["RFI-ANS"].status !== "answered") fail("WP8.F8.rfis: RFI-C's 3 days; RFI-RRB open with no dueDate, RFI-ANS answered with no responseRequiredBy (G1)");
  const oh = R.overdueHealth;
  const ow = R.overdueWorkspace.value;
  const n = (b) => (b ? 1 : 0);
  if (!same(oh.value, ow) || !same(oh.today, { "RFI-RRB": false, "RFI-ANS": true })) fail("WP8.rfi.overdueHealth: value HR-K1's workspace basis (overdueWorkspace), today HEAD's card basis (G5)");
  if (!same(R.overdueHealthF8.value, { afterRRB: n(oh.value["RFI-RRB"]), afterANS: n(oh.value["RFI-ANS"]) }) || !same(R.overdueHealthF8.today, { afterRRB: n(oh.today["RFI-RRB"]), afterANS: n(oh.today["RFI-ANS"]) }) || !same(R.overdueWorkspaceF8.value, { afterRRB: -10 * n(ow["RFI-RRB"]), afterANS: -10 * n(ow["RFI-ANS"]) })) fail("WP8.rfi.overdueHealthF8 and overdueWorkspaceF8: F8's deltas follow the two bases (G5)");
  const op = R.officialResponsePaths;
  if (op.value.responsesPath !== R.officialResponseAfterClose.value || op.value.recordPath !== R.officialResponseAfterClose.value || op.today.responsesPath !== 200 || op.today.recordPath !== 200 || R.officialResponseAfterClose.ref !== "RFI-RESP-1") fail("WP8.rfi.officialResponsePaths: both paths refused as officialResponseAfterClose, 200 today, ref RFI-RESP-1 (G10, WP8ADJ Q5)");
  // G1, G19: the submittals and the impact days
  const sb = F8.submittals.value;
  const reviewDays = sb.T8.steps.reduce((s, [, d]) => s + d, 0);
  const SUB = WP8.submittal;
  if (reviewDays !== 7 || submitBy({ ...sb["SUB-T"], reviewDays }) !== SUB.submitByTemplated.value || submitBy({ ...sb["SUB-D"], reviewDays: 0 }) !== SUB.submitByDirect.value || submitBy({ ...sb["SUB-T"], reviewDays: 0 }) !== WP8.mutations.reviewDaysInSubmitBy.value) fail("WP8.F8.submittals: T8's 3 + 4 review days; SUB-T 2027-01-04, SUB-D 2027-01-11 (and SUB-T under M-RD) (G1)");
  const si = F8.submittalImpact.value;
  if (si.leadTimeWeeks !== sb["SUB-I"].leadTimeWeeks || si.needBy !== sb["SUB-I"].requiredOnSite || si.samples.length !== 3) fail("WP8.F8.submittalImpact: SUB-I's need-by R+5 and lead 2 weeks (G19)");
  for (const smp of si.samples) if (smp.needBy !== addDays(smp.runDateR, 5) || submittalImpactDays({ approvedAtIso: smp.approvedAt, needByIso: smp.needBy, leadTimeWeeks: si.leadTimeWeeks }) !== smp.impactDays) fail("WP8.F8.submittalImpact: the sample approved at " + smp.approvedAt + " must read rules.submittalImpactDays over need-by R+5 (G19)");
  // G20: the storeman's register is the latest approved revision only
  const s1 = F8.drawings.value["F8-S1"];
  const latestApproved = Object.keys(s1).filter((k) => s1[k].status === "approved" && s1[k].latest === true);
  const approvedAny = Object.keys(s1).filter((k) => s1[k].status === "approved");
  if (!same(latestApproved, WP8.drawing.storemanRevisions.value) || !same(approvedAny, ["B", "X8"]) || s1.X8.latest !== false || s1.X8.filedBy !== "pm") fail("WP8.F8.drawings: the storeman sees ['B']; under M-LAT ['B', 'X8'], X8 filed approved and not latest by the PM (G20)");
  // G21, G3: the meetings
  const items = F8.meetings.value.M8c.items;
  const tasks = WP8.transmittal.createTaskTasks;
  if (items.filter((i) => i.createTask).length !== tasks.value || tasks.today !== 2 * tasks.value || WP8.transmittal.actionItemIdentity.value !== "same id across edits" || WP8.transmittal.actionItemIdentity.today !== "a new id") fail("WP8.F8.meetings: M8c's one createTask item yields 1 task (2 today, after the PATCH); the items keep their ids (a new id today) (G3, G21)");
  // G14: each confirm-first leaf restates the known answers it classifies
  const tie = (cfKey, items2) => {
    const c = WP8.CF[cfKey];
    for (const [item, key] of items2) {
      const l = leafAt(key);
      if (!c || !l || !same(c.value[item], l.value) || !same(c.today[item], l.today) || c.ref !== l.ref) fail("WP8.CF." + cfKey + ": its item " + item + " must be " + key + "'s value, today and ref (G14)");
    }
  };
  tie("HRF4", [["approveFromOpen", "WP8.dailyLog.approveFromOpen"], ["approveEmptyDay", "WP8.dailyLog.approveEmptyDay"], ["reopenWithoutReason", "WP8.dailyLog.reopenWithoutReason"]]);
  tie("HRF5", [["rateTiming", "WP8.timesheet.rateChangeRecorded"], ["inactiveWorker", "WP8.timesheet.inactiveWorker"], ["capAcrossSheets", "WP8.timesheet.capAcrossSheets"]]);
  tie("HRQ5", [["severityDowngrade", "WP8.quality.severityDowngradeProbe"], ["evidenceWiped", "WP8.quality.evidenceWipedBeforeApprovalProbe"], ["ltiEdit", "WP8.safety.ltiEditAfterClosure"]]);
  tie("HRQ4", [["hardDelete", "WP8.quality.hardDeleteProbe"], ["legacyItpStatus", "WP8.quality.legacyItpFailedToPassedProbe"]]);
  tie("HRF3", [["approverBypass", "WP8.punch.finalApproverBypass"]]);
  tie("SAFEARCH", [["F8", "WP8.safety.health"], ["087-FLD", "WP8.safety.health"], ["052-FLD", "WP8.052-FLD.safetyHealth"]]);
  if (!same(WP8.CF.RFIRESP.value, op.value) || !same(WP8.CF.RFIRESP.today, op.today) || WP8.CF.RFIRESP.ref !== op.ref) fail("WP8.CF.RFIRESP: its items must be WP8.rfi.officialResponsePaths's value, today and ref (G14)");
  tie("HRK1rfi", [["health", "WP8.rfi.overdueHealth"], ["healthF8", "WP8.rfi.overdueHealthF8"]]);
  tie("HRF1", [["pmApproveWhilePending", "WP8.submittal.pmApprovalWhileStepsPending"]]);
  tie("HRF2", [["approveWithoutReview", "WP8.drawing.approveWithoutReview"], ["approveOutOfOrder", "WP8.drawing.approveOutOfOrder"]]);
  tie("HRF6", [["patchStatus", "WP8.transmittal.distributeBypass"], ["draftDistributed", "WP8.transmittal.draftDistributed"], ["editAfterDistribution", "WP8.transmittal.editAfterDistribution"], ["actionItemIdentity", "WP8.transmittal.actionItemIdentity"], ["duplicateTask", "WP8.transmittal.createTaskTasks"]]);
  const hf4 = WP8.CF.HRF4;
  if (!same(hf4.value.sitePromotion, { status: "2xx", contractual: false, contractualUsedDelta: 0 }) || !same(hf4.today.sitePromotion, { status: 200, contractual: true, contractualUsedDelta: 1 }) || hf4.source.indexOf("wp7-eot-proof.json") < 0) fail("WP8.CF.HRF4: the site engineer's promotion as WP-7's KA.F4.T7.sitePromotion reads it, from WP-7's result file (G14, WP8ADJ Q8)");
  if ((WP8.CF.HRQ4.note || "").indexOf("closed NCRs keep counting") < 0 || (WP8.CF.HRF1.note || "").indexOf("SUB-LINK-1") < 0 || (WP8.CF.HRF6.note || "").indexOf("MTG-SENT-1") < 0) fail("WP8.CF: HRQ4 records the closed-NCR observation, HRF1 SUB-LINK-1 and HRF6 MTG-SENT-1 (G14, WP8ADJ Q14)");
  // G13 (Q6, Q7): the mutation leaves name their catchers by check id
  const mtext = Object.values(WP8.mutations).map((l) => (Array.isArray(l.value) ? l.value.join(" | ") : "") + " | " + (l.note || "")).join(" | ");
  for (const need of ["Q.F8.dashboard21 red (M-QW,", "Q.F8V.sixMajor red (M-CLAMP,", "DL.F8.manpower red (M-MP,", "TS.F8.mixed red (M-DT,", "P.F8.closeByNonApprover red (M-PFA,", "D.F8.storeman red (M-LAT,", "SUB.F8.submitBy red (M-RD,", "SF.F8.dashboard red (M-ARCH,", "Q.F8.health21 red (M-QWh:", "Q.F8.workspace21 red (M-QWw:", "TS.pure.multiplierHalf red (M-OTF:", "KA.RFI.F8.officialAfterClose red (M-RFIRESP:", "KA.SAFE.052.health red (M-SAFEARCH:", "KA.F4.F8.approveEmpty red (M-F4a:", "KA.F4.F8.reopenNoReason red (M-F4r:", "KA.F5.F8.rateTiming red (M-F5:", "KA.F3.F8.approverBypass red (M-F3:", "KA.F1.F8.pmApproveWhilePending red (M-F1:", "KA.F2.F8.approveOutOfOrder red (M-F2:", "KA.F6.F8.duplicateTask red (M-F6:", "KA.Q5.F8.ltiEdit red (M-Q5:", "KA.Q4.F8.legacyItpStatus red (M-Q4:", "KA.Q3.087.score red (M-Q3:", "KA.K1.F8.rfiOverdueHealth red (M-K1:", "KA.DL.F8.promoteStored red (M-C11d:"]) {
    if (mtext.indexOf(need) < 0) fail("WP8.mutations: a leaf must name '" + need + "' (G13)");
  }
  // G1 (Q1, Q10): the choreographies and the residue
  const heads = (steps) => steps.map((s) => s.split(" ")[0]);
  if (!same(heads(F8.choreography.value), F8_STEP_IDS) || !same(heads(F8V.choreography.value), ["V-0", "V-1", "V-2", "V-3", "V-4", "V-5", "end"])) fail("WP8.F8 and WP8.F8V choreographies must list their steps F8-0 .. L213 and CF, V-0 .. V-5, then the end (G1)");
  if (F8_CHECKS.length !== 74 || F8V_CHECKS.length !== 6 || new Set([...F8_CHECKS, ...F8V_CHECKS]).size !== 80) fail("WP8: the 74 F8 and 6 F8V check ids, each once (G1)");
  const allSteps = [...F8.choreography.value, ...F8V.choreography.value];
  for (const id of [...F8_CHECKS, ...F8V_CHECKS]) {
    const served = allSteps.filter((s) => s.split(/[ ,;()]+/).includes(id)).length;
    if (served !== 1) fail("WP8 choreographies: the check " + id + " must be served by exactly one step (G1)");
  }
  const res = F8.residue.value;
  if (!same(res.archived, ["F8", "F8V"]) || !same(res.workersSetInactive, Object.keys(w).filter((k) => k !== "crew")) || !same(res.companyLevel, { inactiveWorkersPerRun: 3, permissionTemplates: 1 }) || res.deepWrites !== 0 || res.deepRequestsRefusedBeforeAnyWrite !== 1) fail("WP8.F8.residue: F8 and F8V archived, the three workers inactive, one template, no deep write, one deep request refused before any write (Q2, Q10)");
  // G22: the 052-FLD reads
  const r052 = WP8["052-FLD"].reads.value;
  if (r052.live.length !== 3 || r052.stored.length !== 4 || r052.writes !== 0) fail("WP8.052-FLD.reads: three live reads by 052's PM and four stored steps, no write (G22, WP8ADJ Q9)");
  // the known answers carry their today and ref, as assumptions (the KA.I9 ruling)
  for (const [key, ref] of WP8_KNOWN) {
    const leaf = leafAt(key);
    if (!leaf || leaf.today === undefined || leaf.ref !== ref || leaf.assumption !== true || same(leaf.value, leaf.today)) fail(key + ": a known answer with its today and ref " + ref + ", an assumption, its value never its today (KA.I9 ruling)");
  }
  if (WP8_KNOWN.length !== 28 || new Set(WP8_KNOWN.map(([k]) => k)).size !== WP8_KNOWN.length) fail("WP8_KNOWN: the 28 leaves the 27 known answers read in this book, each once (KA.I9 ruling)");
  const rows = figures();
  for (const [key, ref] of WP8_KNOWN) if ((rows.find((r) => r.key === key) || {}).ref !== ref) fail("figures() must emit the ref of " + key + " (G2)");
  // the leaf contract of the WP-8 leaves: a today names its ref and a ref its today, from WP8_REFS; every such leaf is an
  // assumption, its value never equals its today and no value restates HEAD as "(recorded)"; every plan citation of a
  // WP-8 leaf carries its HEAD (G12), but the WP-7-owned weather leaves'
  const walk = (node, key) => {
    if (isLeaf(node)) {
      if (node.today !== undefined && !node.ref) fail(key + " carries a today without its ref (G2)");
      if (node.ref !== undefined && node.today === undefined) fail(key + ": a ref without its today (G2)");
      if (node.ref !== undefined && !WP8_REFS.includes(node.ref)) fail(key + ": unknown ref " + node.ref + " (G2)");
      if (node.today !== undefined && node.assumption !== true) fail(key + ": a today under an undecided row must be an assumption (G2)");
      if (node.today !== undefined && same(node.today, node.value)) fail(key + ": a value equal to its today would pre-judge " + node.ref + " (KA.I9 ruling)");
      if (/\(recorded/.test(JSON.stringify(node.value))) fail(key + ": a value that restates HEAD as '(recorded)' (G3)");
      if (!WP7_OWNED_WP8(key) && node.source.split("; ").some((c) => c.startsWith(PLAN + ":") && c.indexOf(" @") < 0)) fail(key + " cites the plan without its HEAD (G12)");
      return;
    }
    if (node && typeof node === "object" && !Array.isArray(node)) for (const [k, v] of Object.entries(node)) walk(v, key + "." + k);
  };
  walk(WP8, "WP8");
})();

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
