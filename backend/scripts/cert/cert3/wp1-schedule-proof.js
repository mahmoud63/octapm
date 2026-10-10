'use strict';

/**
 * WP-1 (Schedule) primary proving run: the known-answer run of plan §4 WP-1
 * on the cert3d population (docs/certification/OCTAPM_CERT3_PLAN.md §4 WP-1
 * :499-569, §6.1 E3/E4, §6.2 WP-1 guards; prep C:\Temp\octapm-cert\scratch\
 * wp1-prep.md; moment map build/MOMENT-MAP.md; answer book answers/schedule.js).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp1-schedule-proof.js [--only=T1,REV] [--project=087-IMP] [--skip=LANES]
 *
 * Filters (sections are the id prefixes: S T1 T2 T3 T4 CYC CONV IMP REV BL DATES STATUS TAIL LANES CF):
 * --only=<sections> keeps those sections, --project=<code> the sections that
 * touch that project, --skip=<sections> drops sections (a partial population:
 * --skip=LANES when 052-SCH-EV and 006-LITE are not built). Selecting CF
 * selects every section CF classifies from (all but LANES). The setup checks
 * (S.*) always run, but only for the projects and state files the selected
 * checks need; a filtered-out check is neither registered nor recorded.
 *
 * In process (CERT_INPROCESS=1, through the lock runner only) on the
 * certification database. Every expected figure is an answer-book key (A10):
 * a disagreement is reported, never papered over. The proof resolves the four
 * deep projects by their exact names through the API as each company's PM
 * (exactly one live project each) and reads the build state files only for
 * moment figures (C:\Temp\octapm-cert\state\cert3\<code>.json, steps[].out).
 *
 * WHERE EACH CHECK RUNS (the CHECKS table below carries it per id):
 *   W      a throwaway project of company 087 this run creates and archives:
 *          the hand-built A100/A110 (A110 budget 60,000; A100 approved 100%),
 *          F1 imported, reviewed, activated over them (mapping by code), T1,
 *          T2, the cycle, the dates, the baseline refusal order, the lock,
 *          F1b, the second baseline, the rollback, the second import, the
 *          status surfaces, the tail, the start-date move, the concurrent
 *          activations. Archived at the end whatever happened.
 *   X      a second throwaway project of 087: the hand-built programme for
 *          L124 / HR-S8, the T4 networks (FS lead, FF, SF) staged and
 *          activated, the staged-import guard, the range boundary, the xlsx
 *          dry run, a fresh two-project XER (F4, HR-S4). Archived at the end.
 *          (T4 and the zero-rated / out-of-scope refusals run on X / W, not on
 *          087-IMP as MOMENT-MAP rows 46 / 27 say: fresh records either way,
 *          and 087-IMP's active F3 stays intact for T3.live on a re-run;
 *          adjudication L-Q3.)
 *   087-IMP  live end state (F3 active, the staged files' snapshots read
 *          through GET revision) and the F1float5 draft submitted and approved
 *          (the moment map assigns that to this proof; it is the only residue
 *          on a deep project).
 *   087-SCH  live end state (the tail, the baseline, the audit event) and
 *          the stored step outputs (moments gone: T2, the refusals, F1b).
 *   052-SCH-EV / 006-LITE  live GET /schedule and the stored lane outputs.
 *   pure   in process: calculateCpm, deriveActivityStatus, the generators.
 *
 * KNOWN ANSWERS (KA.*): a leaf with a `today` under an undecided HR rule or a
 * registered suspect is judged value (pass), today (BLOCKED / known, with the
 * ref, counted separately, never exit 2) or wrong (fail: neither the book's
 * value nor HEAD's known answer, an unexplained departure). A probe whose own
 * setup fails (the revision, programme or network it needs could not be made,
 * an in-process surface threw) is a setup error (exit 1), never 'wrong'
 * (adjudication R-SET): each such probe runs in its own section.
 * CONFIRM-FIRST (CF.*): the ten items of plan :559-569, each classified from
 * the observations of this run as CONFIRMED / PARTIAL / REJECTED / TEST GAP
 * (EXPECTED BEHAVIOUR is the owner's call at adjudication).
 *
 * The count of checks is fixed before the first run (EXPECTED_CHECKS). Exit 0
 * pass / 2 a check failed / 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp1-schedule-proof.json (every check with
 * its plan reference, answer-book key, expected, observed and verdict in
 * observations.checks; the KA verdicts in observations.knownAnswers; the CF
 * classifications in observations.confirmFirst; all four are written in
 * cleanup, so a setup error still carries what was observed).
 *
 * Integration owner's adjudication of the proof authoring (2026-10-10,
 * C:\Temp\octapm-cert\scratch\wp1\author-adjudication.md) applied: H1 (UTF-8,
 * the U+FFFD literal), H2 (allocations list), H3 (ProjectDocument), H4 (the
 * after-baseline start move right after the lock), M2 (the calendar change,
 * WP1.dates.calendarChange, folded into CF.7), M3 (REV.activate.cpmInTransaction:
 * the stored CPM figures read straight after the activation answer), M4 (F4
 * staged fresh on X), M5 (the XLSX export through the tracked path), M6 (the
 * site engineer refused on activate, rollback and baseline), L1-L10 and R-SET.
 * EXPECTED_CHECKS went 139 -> 146: +KA.DATES.calendarChange.before/.after,
 * +REV.activate.cpmInTransaction, +REV.roles.siteActivate,
 * +REV.roles.siteRollback, +BL.siteEngineer, and REV.activate.keepsCodeBudget
 * split into REV.activate.keepsCode + REV.activate.keepsBudget (L7).
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const fs = require('fs');
const path = require('path');
const XLSX = require('@e965/xlsx');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');
const files = require('./build/files');
const SCHEDULE = require('./answers/schedule');

const { WP1, D2, D3, CLAUDE } = SCHEDULE;
const R = SCHEDULE.rules;
const IN = SCHEDULE.inputs;
const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const STATE_DIR = 'C:/Temp/octapm-cert/state/cert3';
const CODES = IN.F1.tasks.map((t) => t[0]);
const START = IN.start;
const DAY_MS = 86_400_000;

const DEEP = {
  '087-SCH': { company: '087', name: 'CERT3 Programme (087-SCH)' },
  '087-IMP': { company: '087', name: 'CERT3 Import parity (087-IMP)' },
  '052-SCH-EV': { company: '052', name: 'CERT3 Programme and EV (052-SCH-EV)' },
  '006-LITE': { company: '006', name: 'CERT3 Lite (006-LITE)' },
};
const OUTSIDER = '088';

// ── CLI ───────────────────────────────────────────────────────────────────────
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const setOf = (text) => (text ? new Set(text.split(',').map((s) => s.trim()).filter(Boolean)) : null);
const ONLY = setOf(argOf('only'));
const SKIP = setOf(argOf('skip'));
const PROJECT_FILTER = argOf('project');

// ── the fixed list of checks: id, section, plan reference, answer-book key, where it runs ──
// where: 'W' | 'X' (throwaway projects of 087) | '087-SCH' | '087-IMP' | '052-SCH-EV' | '006-LITE' | 'pure' | 'stored:<code>' | 'setup'
// A known-answer check (KA.<section>.*) belongs to the section it judges; the confirm-first items form their own section (CF).
// The setup checks (S.*) carry no answer-book key (bookKey null) and where 'setup': they never decide which projects a run needs (L5).
const C = (id, planRef, bookKey, where, description) => ({ id, section: id.startsWith('KA.') ? id.split('.')[1] : id.split('.')[0], planRef, bookKey, where, description });
const T1_ROW_CHECKS = CODES.map((code) => C(`T1.row.${code}`, `${PLAN_DOC}:513-519`, `WP1.T1.${code}`, 'W', `${code} ES/EF/LS/LF/TF, critical flag and early/late dates match the table (F1 activated on W)`));
const STATUS_BOUNDARY_KEYS = Object.keys(WP1.status.boundaries);

const CHECKS = [
  C('S.companies', `${PLAN_DOC}:371-416`, null, 'setup', 'the companies the selected checks need (087 and 088; 052 / 006 for the lanes) resolve, exactly one certification organisation each; the personas sign in'),
  C('S.state', `${PLAN_DOC}:452-472`, null, 'setup', 'the build state files the selected checks read are present with their schedule steps done'),
  C('S.projects', `${PLAN_DOC}:417-451`, null, 'setup', 'the deep projects the selected checks read resolve by exact name, exactly one live each, matching the state files'),
  C('S.throwaway', `${PLAN_DOC}:559`, null, 'setup', 'the throwaway projects W and X (those the selected checks need) are created with their teams'),

  C('T1.import', `${PLAN_DOC}:500,513`, 'WP1.T1.network.activities', 'W', 'F1 XER staged on W: 201, draft, 14 activities, 13 links, 3 WBS'),
  C('T1.staged', `${PLAN_DOC}:513,521`, 'WP1.T1.stagedSnapshot', 'W', 'the staged F1 snapshot: A200 phys 40, M900 start = finish 2026-04-28, file float hours / 8, 12 staged critical'),
  C('T1.network', `${PLAN_DOC}:513`, 'WP1.T1.network', 'W', 'after activation: 14 activities, 13 dependencies, 3 WBS branches, durations per code, project end 81'),
  ...T1_ROW_CHECKS,
  C('T1.critical', `${PLAN_DOC}:521`, 'WP1.T1.criticalCount', 'W', 'exactly 12 critical, the 12 codes of the book (mutation guard: tf <= 0)'),
  C('T1.invariant', `${PLAN_DOC}:521`, 'WP1.T1.tfEqualsLfMinusEfEveryRow', 'W', 'TF = LF - EF = LS - ES on every row'),
  C('T1.dates', `${PLAN_DOC}:521`, 'WP1.T1.A100endDate', 'W', 'A100 ends 2026-01-12; M900 finishes 2026-04-28 early and late'),
  C('T1.stored', `${PLAN_DOC}:513-521`, 'WP1.T1.criticalCodes', 'stored:087-SCH', 'the build asserted T1 at cpm.F1 and cpm.T2: its stored critical codes and restored M900 are the book\'s'),
  C('T1.pure', `${PLAN_DOC}:513`, 'WP1.T1.capDoesNotChangeF1', 'pure', 'the product\'s calculateCpm on the F1 network gives the table (and the book says the LF cap changes nothing on F1)'),

  C('T2.at20', `${PLAN_DOC}:522`, 'WP1.T2', 'W', 'A110 at 20: M900 EF 91 dated 2026-05-12; A140/A300 figures; floats and ids unchanged; 12 critical'),
  C('T2.restored', `${PLAN_DOC}:522`, 'WP1.T2.restored', 'W', 'A110 back to 10: M900 81 dated 2026-04-28; the T1 table again'),
  C('T2.stored', `${PLAN_DOC}:522`, 'WP1.T2', 'stored:087-SCH', 'the build\'s cpm.T2 moment on 087-SCH carries the book\'s figures'),

  C('T3.pure', `${PLAN_DOC}:524`, 'WP1.T3.B', 'pure', 'calculateCpm A(10) SS+2 B(3): A ES 0 EF 10; B 2/5/7/10 TF 5'),
  C('T3.inputs', `${PLAN_DOC}:524`, 'WP1.T3.inputs', 'pure', 'F3 hours / 8: A 10, lag 2, B 3; files.F3() loads as the book\'s file (WP1.T3.file)'),
  C('T3.file', `${PLAN_DOC}:524`, 'WP1.T3.file.stagedLate', '087-IMP', 'the F3 revision\'s staged late dates, float and one critical row are the book\'s'),
  C('T3.live', `${PLAN_DOC}:524`, 'WP1.T3.A.ES', '087-IMP', 'F3 active on 087-IMP: A ES 0 EF 10; B ES 2 EF 5 LS 7 LF 10 TF 5'),
  C('KA.T3.live.hrS1', `${PLAN_DOC}:524,561,1029`, 'WP1.T3.A.LF', '087-IMP', 'A LS/LF/TF and the critical count: value (cap) or today (HR-S1)'),
  C('KA.T3.pure.hrS1', `${PLAN_DOC}:524,561`, 'WP1.T3.A.TF', 'pure', 'in process the same: value or today (HR-S1; mutation guard: the SS backward branch)'),

  C('T4.pure', `${PLAN_DOC}:525-527`, 'WP1.T4', 'pure', 'calculateCpm: FS-8 B ES 2 EF 5; FF B ES 0 EF 15 A LF 15 TF 5 B TF 0; SF B ES 6 EF 10 A TF 0 B TF 0'),
  C('KA.T4.pure.FSlead', `${PLAN_DOC}:525`, 'WP1.T4.FSlead.A_TF', 'pure', 'FS lead: A TF value 0 (cap) or today 5 (HR-S1)'),
  C('T4.live.FSlead', `${PLAN_DOC}:525`, 'WP1.T4.FSlead', 'X', 'FS -8 staged, approved and activated on X: B ES 2 EF 5'),
  C('KA.T4.live.FSlead', `${PLAN_DOC}:525`, 'WP1.T4.FSlead.A_TF', 'X', 'FS lead live: A TF value or today (HR-S1)'),
  C('T4.live.FF', `${PLAN_DOC}:526`, 'WP1.T4.FF', 'X', 'FF activated on X: B ES 0 EF 15, A LF 15 TF 5, B TF 0'),
  C('T4.live.SF', `${PLAN_DOC}:527`, 'WP1.T4.SF', 'X', 'SF activated on X: B ES 6 EF 10, A TF 0, B TF 0'),

  C('CYC.refusal', `${PLAN_DOC}:528`, 'WP1.cycle.refusal', 'W', 'A100 <- A110 would close a cycle: 400 CPM_DEPENDENCY_CYCLE'),
  C('CYC.rowsChanged', `${PLAN_DOC}:528`, 'WP1.cycle.rowsChanged', 'W', 'the updatedAt fingerprint of every activity is unchanged by the refusal'),
  C('CYC.selfLink', `${PLAN_DOC}:528`, 'WP1.cycle.selfLink', 'W', 'A100 <- A100: 400 INVALID_DEPENDENCY_SELF_LINK'),
  C('CYC.mixed.A', `${PLAN_DOC}:528`, 'WP1.mixedCalendar.A_finishDate', 'pure', 'A five_day 5 d from 2026-01-05 finishes 2026-01-12'),
  C('KA.CYC.mixed.B', `${PLAN_DOC}:528,567,1031`, 'WP1.mixedCalendar.B_startNoEarlierThan', 'pure', 'B seven_day after A: starts on or after 2026-01-12 (value) or Saturday 2026-01-10 (today, HR-S5)'),

  C('CONV.durations', `${PLAN_DOC}:529`, 'WP1.conversion.durations', '087-IMP', 'F2 staged: 40/80/12/20/4/3 h -> 5/10/2/3/1/0'),
  C('CONV.lags', `${PLAN_DOC}:529`, 'WP1.conversion.lags', '087-IMP', 'F2 staged lags: +16/-16/+12/-12 h -> 2/-2/2/-1'),
  C('CONV.floatMinus80', `${PLAN_DOC}:529`, 'WP1.conversion.totalFloatMinus80h', '087-IMP', 'X150 total float -80 h stages 0'),
  C('CONV.activeEqualsStaged', `${PLAN_DOC}:503`, 'WP1.conversion.activeEqualsStaged', 'W', 'after activation every active duration equals its staged value'),
  C('CONV.range.atMax', `${PLAN_DOC}:504`, 'WP1.conversion.rangeBoundary.atMax', 'X', '292,000 h (36,500 d) is staged'),
  C('CONV.range.beyond', `${PLAN_DOC}:504`, 'WP1.conversion.rangeBoundary.beyondMax', 'X', '292,004 h: 400 SCHEDULE_FIGURE_OUT_OF_RANGE, nothing staged'),
  C('CONV.parity.p6xml', `${PLAN_DOC}:530`, 'WP1.parity.p6xml', '087-IMP', 'F1 as P6 XML stages F1\'s durations, links and lags'),
  C('CONV.parity.xlsx', `${PLAN_DOC}:530`, 'WP1.parity.xlsx', '087-IMP', 'F1 as xlsx with a calendar column stages F1\'s durations, links and lags'),
  C('CONV.parity.mspdiF1', `${PLAN_DOC}:530`, 'WP1.parity.p6xml', '087-IMP', 'F1 as MSPDI stages F1\'s durations, links and lags (judged against WP1.parity.p6xml, identical to F1; MOMENT-MAP :48)'),
  C('CONV.parity.mspdiF2', `${PLAN_DOC}:530-531`, 'WP1.parity.mspdiLags', '087-IMP', 'F2 as MSPDI: durations 5/10/2/3/1/0, lags 2/-2/2/-1, X150 slack -10 days'),
  C('KA.CONV.mspNegativeSlackCritical', `${PLAN_DOC}:531,562,1030`, 'WP1.parity.mspNegativeSlackCritical', '087-IMP', 'X150 with negative slack is critical (value) or not (today, HR-S3)'),

  C('IMP.formats', `${PLAN_DOC}:500`, 'WP1.revisions.secondImport', '087-IMP', 'the ten build imports (XER, P6 XML, MSPDI, xlsx) are staged revisions in the states the build left (8 superseded, F3 active, F1float5 the draft)'),
  C('IMP.dryRun', `${PLAN_DOC}:533`, 'WP1.imports.xlsxDryRun', 'X', 'xlsx dry run: 200, nothing written (revisions and documents unchanged)'),
  C('IMP.siteEngineer', `${PLAN_DOC}:534`, 'WP1.imports.siteEngineer', 'W', 'the site engineer\'s import: 403 FORBIDDEN'),
  C('IMP.outsider', `${PLAN_DOC}:534`, 'WP1.imports.outsider', 'W', 'the PM of 088: 404 PROJECT_NOT_FOUND'),
  C('IMP.stagedNotApplied', `${PLAN_DOC}:503,555`, 'WP1.mutations.stagedImportWrites', 'X', 'a staging import leaves the active activities untouched (ids, durations, updatedAt; mutation guard: staged imports do not write)'),
  C('KA.IMP.twoProjectXer', `${PLAN_DOC}:532,568,1030`, 'WP1.imports.twoProjectXerStaging', 'X', 'F4 (two PROJECT rows) staged fresh on X: refused with nothing staged, or one project chosen (value), or 201 with both projects\' rows merged (today, HR-S4)'),
  C('KA.IMP.windows1252', `${PLAN_DOC}:568,1030`, 'WP1.imports.windows1252', '087-IMP', 'F5 names: decoded (value) or replacement characters (today, HR-S4)'),
  C('KA.IMP.secondCalendar', `${PLAN_DOC}:568,1030`, 'WP1.imports.secondCalendarIds', '087-IMP', 'F6: every staged calendar id is the file\'s (A300 / A330 \'2\', the rest \'1\'): recorded as P2 (value, HR-S4)'),

  C('REV.roles.siteSubmit', `${PLAN_DOC}:509,536`, 'WP1.revisions.roles.siteEngineerSubmit', 'W', 'the site engineer\'s submit-review: 403 FORBIDDEN'),
  C('REV.submitByPlanner', `${PLAN_DOC}:509`, 'WP1.revisions.submitByPlanner', 'W', 'the planner submits: under_review'),
  C('REV.approve.planner', `${PLAN_DOC}:536`, 'WP1.revisions.approve.planner', 'W', 'the planner\'s approval: 403 FORBIDDEN'),
  C('REV.approve.site', `${PLAN_DOC}:536`, 'WP1.revisions.approve.siteEngineer', 'W', 'the site engineer\'s approval: 403 FORBIDDEN'),
  C('REV.roles.outsider', `${PLAN_DOC}:509`, 'WP1.revisions.roles.outsider', 'W', 'the PM of 088 on a revision route: 404 PROJECT_NOT_FOUND'),
  C('REV.approve.pm', `${PLAN_DOC}:536`, 'WP1.revisions.approve.pm', 'W', 'the PM approves: approved (HR-S2 decided and fixed: M900 start = finish passes)'),
  C('REV.rejectApproved', `${PLAN_DOC}:537`, 'WP1.revisions.rejectApproved', 'W', 'rejecting an approved revision: 409 INVALID_REVISION_STATUS'),
  C('REV.roles.plannerActivate', `${PLAN_DOC}:509`, 'WP1.revisions.roles.plannerActivate', 'W', 'the planner\'s activation: 403 FORBIDDEN'),
  C('REV.roles.siteActivate', `${PLAN_DOC}:509`, 'WP1.revisions.roles.siteEngineerActivate', 'W', 'the site engineer\'s activation: refused 403 FORBIDDEN (shared/permissions.json gives revision.activate to the PM only)'),
  C('REV.activate.noMapping', `${PLAN_DOC}:538`, 'WP1.revisions.activate.noMapping', 'W', 'activation with mappings [] over active activities: 400 MAPPING_CONFIRMATION_REQUIRED'),
  C('REV.activate.unmappedNoReason', `${PLAN_DOC}:538`, 'WP1.revisions.activate.unmappedNoReason', 'W', 'one active activity left unmapped without a reason: 400 UNMAPPED_REMOVAL_REASON_REQUIRED'),
  C('REV.activate.unmappedNamed', `${PLAN_DOC}:538`, 'WP1.revisions.activate.unmappedNamed', 'W', 'the refusal names exactly the one left out (A110 in this choreography; A140 in the book\'s)'),
  C('REV.mapByCode.live', `${PLAN_DOC}:541`, 'WP1.revisions.mapByCode.matchType', 'W', 'GET mapping suggests the two hand-built A100 and A110 by activity code, confidence 1, and the other 12 as new (WP1.revisions.activate.recordTwoHandBuilt)'),
  C('REV.mapByCode.stored', `${PLAN_DOC}:541`, 'WP1.revisions.mapByCode.matchType', 'stored:087-SCH', 'the build\'s activate.F1 read 14 suggestions, every one activity_code'),
  C('REV.activate.full', `${PLAN_DOC}:539`, 'WP1.revisions.activate.recordTwoHandBuilt', 'W', 'full mapping: 200, active; the record shows updated 2, new 12, retired 0, dependency count 13 (WP1.revisions.activate.recordTwoHandBuilt)'),
  C('REV.activate.cpmInTransaction', `${PLAN_DOC}:506`, 'WP1.T1', 'W', 'CPM figures are stored when the activation answers: the stored rows read straight after the activation answer (SQL, no other request between) already carry the T1 figures (ES/EF/LS/LF/TF, isCritical). It does not prove that CPM runs inside the activation transaction (plan :506): that is a recorded TEST GAP (WP1-RUN-PLAN §13.1; mutations C4/C5 survive live)'),
  C('REV.activate.record.stored', `${PLAN_DOC}:539`, 'WP1.revisions.activate.record', 'stored:087-SCH', 'the build\'s activation record: updated 14, new 0, retired 0, dependency count 13'),
  C('REV.activate.keepsCode', `${PLAN_DOC}:541,563`, 'WP1.revisions.mapByCode.activityCodeAfterActivation', 'W', 'the mapped A100 and A110 keep their ids and their activity codes'),
  C('REV.activate.keepsBudget', `${PLAN_DOC}:541,563`, 'WP1.revisions.mapByCode.budgetAfterActivation', 'W', 'the mapped A110 keeps its budget 60,000 (the hand-built budget, BOOK-4 choreography)'),
  C('REV.activate.keepsApprovedProgress', `${PLAN_DOC}:539`, 'WP1.revisions.activate.mappedKeepApprovedProgress', 'W', 'the mapped A100 keeps its approved 100%: pct 100, status complete'),
  C('REV.activate.again', `${PLAN_DOC}:540`, 'WP1.revisions.activate.again', 'W', 'activating the active revision again: 409 REVISION_ALREADY_ACTIVE'),
  C('REV.F1b.live', `${PLAN_DOC}:423`, 'WP1.revisions.F1b', 'W', 'F1b (A110 160 h, A140 left out) activated over F1: 13 updated, 1 retired, 12 links; A110 20 d; M900 EF 91; A300 TF 20; F1 superseded'),
  C('REV.F1b.stored', `${PLAN_DOC}:423`, 'WP1.revisions.F1b.record', 'stored:087-SCH', 'the build\'s observed activate.F1b record 13/0/1/12; cpm.F1b M900 91 rests on that step\'s own live assertion (its stored figure is the book value, so it is not compared: L2)'),
  C('REV.roles.siteRollback', `${PLAN_DOC}:509`, 'WP1.revisions.roles.siteEngineerRollback', 'W', 'the site engineer\'s rollback (with a reason): refused 403 FORBIDDEN (shared/permissions.json gives revision.rollback to the PM only)'),
  C('REV.rollback.live', `${PLAN_DOC}:423`, 'WP1.revisions.rollback.M900_EF', 'W', 'rolling F1b back to F1: F1 active again, M900 EF 81, A110 10 d, 14 active'),
  C('KA.REV.rollback.A140id', `${PLAN_DOC}:423,957`, 'WP1.revisions.rollback.A140id', 'W', 'A140 comes back with the same id (value) or as a new activity (today, suspect WP1-RB-1)'),
  C('REV.activate.olderRevision', `${PLAN_DOC}:540`, 'WP1.revisions.activate.olderRevision', 'W', 'activating the superseded F1b: 409 INVALID_REVISION_STATUS (BOOK-3; the plan\'s code REVISION_NOT_CURRENT is the leaf\'s planValue)'),
  C('REV.notCurrent', `${PLAN_DOC}:505`, 'WP1.revisions.notCurrent', 'W', 'submitting the superseded F1b for review: 409 REVISION_NOT_CURRENT (the lifecycle code of plan :505)'),
  C('REV.secondImport.live', `${PLAN_DOC}:540`, 'WP1.revisions.secondImport', 'W', 'a second import supersedes only the open draft: the first upload superseded, the second the one open draft, every non-draft revision (active R1, R2) untouched'),
  C('REV.rejectWithoutReason', `${PLAN_DOC}:537`, 'WP1.revisions.rejectWithoutReason', 'W', 'reject without a reason: 400 VALIDATION_ERROR with details.field reason (BOOK-3; the plan\'s REJECTION_REASON_REQUIRED is the leaf\'s planValue); with a reason: rejected'),
  C('REV.hrS3.file', `${PLAN_DOC}:562`, 'WP1.revisions.hrS3Reproduction.file', '087-IMP', 'the F1float5 draft on 087-IMP stages the book\'s floats and no critical row'),
  C('KA.REV.hrS3.approve', `${PLAN_DOC}:562,1030`, 'WP1.revisions.hrS3Reproduction.approve', '087-IMP', 'F1float5 submitted and approved: approved (value) or 400 SCHEDULE_NOT_READY critical_path (today, HR-S3)'),
  C('KA.REV.concurrent', `${PLAN_DOC}:569`, 'WP1.revisions.activate.concurrent', 'W', 'two simultaneous activations of one approved revision: one 200 one 409 (value) or both 200 (today, low)'),

  C('BL.noBoq', `${PLAN_DOC}:543`, 'WP1.baseline.noBoq', 'W', 'no BOQ: 400 BOQ_REQUIRED_FOR_BASELINE (mutation guard: the BOQ baseline gate)'),
  C('BL.noBoq.stored', `${PLAN_DOC}:543`, 'WP1.baseline.noBoq', 'stored:087-SCH', 'the build\'s baseline.noBoq moment on 087-SCH'),
  C('BL.zeroRated', `${PLAN_DOC}:543`, 'WP1.baseline.zeroRated', 'W', 'zero-rated rows: 400 BOQ_VALUE_REQUIRED_FOR_BASELINE'),
  C('BL.allOutOfScope', `${PLAN_DOC}:543`, 'WP1.baseline.allOutOfScope', 'W', 'priced rows all optional / not applicable: 400 BOQ_SCOPE_REQUIRED_FOR_BASELINE'),
  C('BL.notActivated', `${PLAN_DOC}:543`, 'WP1.baseline.notActivated', 'W', 'an approved revision still staged: 409 REVISION_NOT_ACTIVATED (mutation guard)'),
  C('BL.notActivated.stored', `${PLAN_DOC}:543`, 'WP1.baseline.notActivated', 'stored:087-SCH', 'the build\'s baseline.notActivated moment on 087-SCH'),
  C('BL.unallocated.live', `${PLAN_DOC}:543`, 'WP1.baseline.unallocated.refusal', 'W', 'in-scope value unallocated: 400 SCHEDULE_NOT_READY naming BOQ allocations'),
  C('BL.unallocated.stored', `${PLAN_DOC}:543`, 'WP1.baseline.unallocated', 'stored:087-SCH', 'the build\'s observed unallocated moment (72,000.00 unallocated, 387,000.00 allocated) against the in-scope priced bill read live from boq.upload\'s rows (459,000.00; 84.31% covered), never from project.terms (L2)'),
  C('BL.planner', `${PLAN_DOC}:544`, 'WP1.baseline.planner', 'W', 'the planner\'s baseline: 403 FORBIDDEN'),
  C('BL.siteEngineer', `${PLAN_DOC}:509`, 'WP1.baseline.siteEngineer', 'W', 'the site engineer\'s baseline: refused 403 FORBIDDEN (shared/permissions.json gives schedule baseline and revision.baseline to the PM only)'),
  C('BL.covered.live', `${PLAN_DOC}:544`, 'WP1.baseline.covered', 'W', 'once covered: 200, 14 locked, baselined, baseline = early dates (A300 51/61, M900 81/81)'),
  C('BL.covered.audit', `${PLAN_DOC}:544`, 'WP1.baseline.covered.auditEvents', 'W', 'one BASELINE_LOCKED audit event'),
  C('BL.covered.087', `${PLAN_DOC}:544`, 'WP1.baseline.covered', '087-SCH', '087-SCH end state: 14 locked at their early dates, revision baselined, 459,000.00 allocated, one BASELINE_LOCKED event'),
  C('BL.afterA110at20', `${PLAN_DOC}:545`, 'WP1.baseline.afterA110at20', 'W', 'after A110 = 20: M900 EF 91 against the baseline 81, variance 10; restored'),
  C('BL.secondBaseline', `${PLAN_DOC}:545`, 'WP1.baseline.secondBaseline', 'W', 'a second baseline (F1b) supersedes the first: 200, R2 baselined, R1 superseded, and every active row\'s baseline now equals F1b\'s early dates (M900 baseline finish 91 = 2026-05-12)'),
  C('KA.BL.handBuilt', `${PLAN_DOC}:564,1035`, 'WP1.baseline.handBuilt', 'X', 'L124: a hand-built, fully allocated programme: a refusal that says import or generate (value) or 404 REVISION_NOT_FOUND (today, HR-S8)'),

  C('DATES.renameM900', `${PLAN_DOC}:547`, 'WP1.dates.renameM900', 'W', 'renaming M900 after CPM: 200, dates unchanged'),
  C('DATES.readiness', `${PLAN_DOC}:548`, 'WP1.dates.readinessDateSanity', 'W', 'the readiness date check passes with M900'),
  C('DATES.endBeforeStart.update', `${PLAN_DOC}:30,547`, 'WP1.dates.endBeforeStartRefused', 'W', 'HR-S2: a finish before the start is still refused on update (400 INVALID_DATES, row unchanged)'),
  C('DATES.endBeforeStart.create', `${PLAN_DOC}:30,547`, 'WP1.dates.endBeforeStartRefused', 'W', 'HR-S2: create refuses end < start (400 INVALID_DATES, nothing written) and accepts a zero-duration milestone with start = end (201, WP1.dates.zeroDurationCreate)'),
  C('KA.DATES.startMoved.before', `${PLAN_DOC}:549,566,1032`, 'WP1.dates.startMovedTo0112.beforeBaseline_M900date', 'W', 'start moved to 2026-01-12 before any baseline: M900 recalculated to 2026-05-05 (value) or endDate stays while the derived date moves (today, HR-S6); then moved back'),
  C('KA.DATES.calendarChange.before', `${PLAN_DOC}:500,566,1032`, 'WP1.dates.calendarChange', 'W', 'project calendar five_day -> seven_day before any baseline: M900 recalculated, endDate = early finish 2026-03-27 (value) or endDate stays 2026-04-28 while the derived date moves (today, HR-S6); then back'),
  C('KA.DATES.startMoved.after', `${PLAN_DOC}:549,566,1032`, 'WP1.dates.startMovedTo0112.afterBaseline', 'W', 'start moved right after the first baseline lock: 409 and the baseline kept (value) or 200 with the baseline re-dated to 2026-05-05 (today, HR-S6); then moved back'),
  C('KA.DATES.calendarChange.after', `${PLAN_DOC}:500,566,1032`, 'WP1.dates.calendarChange', 'W', 'project calendar five_day -> seven_day after the lock: 409 and nothing moves (value) or 200 with the baseline re-dated to 2026-03-27 (today, HR-S6); then back'),

  C('STATUS.pure', `${PLAN_DOC}:550`, 'WP1.status.boundaries', 'pure', `deriveActivityStatus at its ${STATUS_BOUNDARY_KEYS.length} boundaries with now 2026-06-01T00:00Z; end = now is not delayed`),
  C('STATUS.A200.hard', `${PLAN_DOC}:551-552`, 'WP1.status.A200fileFortyPercent.status', 'W', 'A200 (file 40, never approved): /activities, /schedule, the report source and the XLSX export show pct 0, status delayed'),
  C('KA.STATUS.A200.search', `${PLAN_DOC}:552,565,1041`, 'WP1.status.A200fileFortyPercent.searchStatus', 'W', 'search: delayed, as /activities derives it (value) or in_progress from the file percent (today, HR-P5)'),
  C('KA.STATUS.A200.lookahead', `${PLAN_DOC}:552,565,1041`, 'WP1.status.A200fileFortyPercent.lookaheadPct', 'W', 'lookahead item: 0 (value) or 40 (today, HR-P5)'),
  C('KA.STATUS.A200.exportXer', `${PLAN_DOC}:552,565,1041`, 'WP1.status.A200fileFortyPercent.exportXerPct', 'W', 'schedule export (XER): phys_complete_pct 0 (value) or 40 (today, HR-P5)'),
  C('KA.STATUS.A200.assistant', `${PLAN_DOC}:552,565,1041`, 'WP1.status.A200fileFortyPercent.assistantText', 'W', 'assistant retrieval: 0% complete (value) or 40% complete (today, HR-P5)'),
  C('KA.STATUS.surfacesAgree', `${PLAN_DOC}:551,1041`, 'WP1.status.surfacesAgree', 'W', 'the seven surfaces agree on A200 (value) or disagree as HEAD does (today, HR-P5)'),
  C('STATUS.A110at40', `${PLAN_DOC}:551`, 'WP1.status.live087SCH.A110at40', 'W', 'A110 approved 40 with its end past: delayed on /activities and /schedule'),
  C('STATUS.unapproved60', `${PLAN_DOC}:553`, 'WP1.status.unapproved60', 'W', 'a submitted, unapproved 60 on A110 changes neither pct nor status'),

  C('TAIL.live087', `${PLAN_DOC}:423`, 'WP1.tail', '087-SCH', '087-SCH end state: T900 ES 81 EF 281 TF 0 (2026-04-28 to 2027-02-02), M900 TF 0, A140 TF 247, A300 TF 220, 13 critical, no baseline on T900, status todo'),
  C('TAIL.liveW', `${PLAN_DOC}:423`, 'WP1.tail', 'W', 'the same tail on W, added after the lock: the derived figures and no baseline'),
  C('TAIL.progress', `${PLAN_DOC}:423,551`, 'WP1.status.live087SCH.tailAt30', 'W', 'T900 todo before progress; approved 30 -> in progress'),

  C('LANES.052', `${PLAN_DOC}:442`, 'D2.WP1', '052-SCH-EV', '052-SCH-EV: M900 EF 81 (2026-04-28), A140 TF 47, A300 TF 20, 12 critical, baselined at the early dates; the stored lane figures agree'),
  C('LANES.006', `${PLAN_DOC}:448`, 'D3.F1byPm', '006-LITE', '006-LITE: the PM imported, submitted, approved, activated and baselined (stored records); M900 EF 81; baseline = early dates live'),

  C('CF.1.milestones', `${PLAN_DOC}:560`, 'WP1.revisions.approve.pm', 'W', 'confirm-first: milestones block approval and baseline (HR-S2, decided and fixed at f599e67: must be REJECTED)'),
  C('CF.2.lfNotCapped', `${PLAN_DOC}:561`, 'WP1.T3.A.LF', '087-IMP', 'confirm-first: LF is not capped at the project finish (HR-S1)'),
  C('CF.3.stagedFloat', `${PLAN_DOC}:562`, 'WP1.revisions.hrS3Reproduction.approve', '087-IMP', 'confirm-first: a staged revision is judged on the file\'s own float (HR-S3)'),
  C('CF.4.activationCode', `${PLAN_DOC}:563`, 'WP1.revisions.mapByCode.activityCodeAfterActivation', 'W', 'confirm-first: activation nulls activityCode, budget 0, name-only mapping (defect fix at f599e67: must be REJECTED)'),
  C('CF.5.handBuilt', `${PLAN_DOC}:564`, 'WP1.baseline.handBuilt', 'X', 'confirm-first: L124 a hand-built programme cannot be baselined (HR-S8)'),
  C('CF.6.filePercent', `${PLAN_DOC}:565`, 'WP1.status.A200fileFortyPercent.pct', 'W', 'confirm-first: the imported file percent leaks out as progress (HR-P5)'),
  C('CF.7.startChange', `${PLAN_DOC}:566`, 'WP1.dates.startMovedTo0112', 'W', 'confirm-first: a start or calendar change does not recompute CPM and the baseline moves (HR-S6; WP1.dates.startMovedTo0112 and WP1.dates.calendarChange)'),
  C('CF.8.mixedCalendars', `${PLAN_DOC}:567`, 'WP1.mixedCalendar.B_startNoEarlierThan', 'pure', 'confirm-first: mixed calendars date a successor before its predecessor finishes (HR-S5)'),
  C('CF.9.twoProjectUtf8Rounding', `${PLAN_DOC}:568`, 'WP1.imports.twoProjectXer', '087-IMP', 'confirm-first: two-project files merged, UTF-8 only, half-up rounding (HR-S4)'),
  C('CF.10.concurrent', `${PLAN_DOC}:569`, 'WP1.revisions.activate.concurrent', 'W', 'confirm-first: concurrent activations are not serialised (low)'),
];
/**
 * Fixed before the first run: the checks above (G.5xx is the harness's own, on top). 139 at authoring; 146 after the
 * adjudication (2026-10-10): +KA.DATES.calendarChange.before/.after (M2), +REV.activate.cpmInTransaction (M3),
 * +REV.roles.siteActivate, +REV.roles.siteRollback, +BL.siteEngineer (M6), REV.activate.keepsCodeBudget split into
 * REV.activate.keepsCode and REV.activate.keepsBudget (L7).
 */
const EXPECTED_CHECKS = 146;
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((c) => c.id)).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');

/** Which sections touch which project (the --project filter selects sections). */
const SECTION_PROJECTS = {
  S: ['W', 'X', '087-SCH', '087-IMP', '052-SCH-EV', '006-LITE'],
  T1: ['W', '087-SCH'], T2: ['W', '087-SCH'], T3: ['087-IMP'], T4: ['X'], CYC: ['W'],
  CONV: ['087-IMP', 'W', 'X'], IMP: ['087-IMP', 'W', 'X'], REV: ['W', '087-SCH', '087-IMP'], BL: ['W', '087-SCH', 'X'],
  DATES: ['W'], STATUS: ['W'], TAIL: ['087-SCH', 'W'], LANES: ['052-SCH-EV', '006-LITE'],
  CF: ['W', 'X', '087-IMP'],
};
for (const [flag, set] of [['only', ONLY], ['skip', SKIP]]) {
  for (const section of set || []) if (!SECTION_PROJECTS[section]) throw new Error(`--${flag}: no section ${section} (sections: ${Object.keys(SECTION_PROJECTS).join(' ')})`);
}
if (PROJECT_FILTER && !Object.values(SECTION_PROJECTS).some((list) => list.includes(PROJECT_FILTER))) throw new Error(`--project: no project ${PROJECT_FILTER}`);
/** The sections CF classifies from (confirmFirstFlow reads their known answers and records): every section but LANES. */
const CF_SOURCES = Object.keys(SECTION_PROJECTS).filter((s) => !['S', 'LANES', 'CF'].includes(s));
const selectedSections = new Set(Object.keys(SECTION_PROJECTS).filter((section) => {
  if (ONLY && !ONLY.has(section)) return false;
  if (PROJECT_FILTER && !SECTION_PROJECTS[section].includes(PROJECT_FILTER)) return false;
  return true;
}));
// The confirm-first classifications read the other sections' observations: selecting CF selects its sources.
if (selectedSections.has('CF')) for (const section of CF_SOURCES) selectedSections.add(section);
for (const section of SKIP || []) {
  if (section === 'S') throw new Error('--skip: the setup section S always runs');
  if (CF_SOURCES.includes(section) && selectedSections.has('CF')) throw new Error(`--skip=${section}: CF classifies from it; skip CF too`);
  selectedSections.delete(section);
}
selectedSections.add('S');
const ACTIVE = CHECKS.filter((c) => selectedSections.has(c.section));
const ACTIVE_IDS = new Set(ACTIVE.map((c) => c.id));
/** Where the selected (non-setup) checks run: the setup checks never pull a project in (L5). */
const runsOn = (code) => ACTIVE.some((c) => c.where === code);
const NEED_W = runsOn('W');
const NEED_X = runsOn('X');
/** The deep projects (live) and the build state files (stored moments) the selected checks need. */
const NEED_DEEP = Object.keys({ '087-SCH': 1, '087-IMP': 1, '052-SCH-EV': 1, '006-LITE': 1 }).filter((code) => runsOn(code) || runsOn(`stored:${code}`));
const NEED_COMPANIES = [...new Set(['087', OUTSIDER, ...NEED_DEEP.map((code) => code.slice(0, 3))])];

// ── small helpers ──────────────────────────────────────────────────────────────
/** A list out of an answer's data: the array itself, or its items / activities / allocations / events (the allocation route answers { allocations, summary }). */
const listOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'activities', 'allocations', 'events']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dayOf = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
const codeOf = (a) => a?.activityCode || a?.p6ActivityId || null;
const json = (v, max = 600) => { try { return JSON.stringify(v).slice(0, max); } catch { return String(v).slice(0, max); } };
const problemsOf = (got, want) => Object.entries(want).filter(([k, v]) => got?.[k] !== v).map(([k, v]) => `${k} ${json(got?.[k])} != ${json(v)}`);
const readState = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${code}.json`), 'utf8'));
const outOf = (state, step) => {
  const st = state?.steps?.[step];
  if (!st || st.status !== 'done') throw new Error(`build ${state?.code}: step ${step} is ${st ? st.status : 'not run'}`);
  return st.out;
};
/** The figures of one CPM row as the API gives them. */
const figuresOf = (a) => ({ ES: num(a?.earlyStart), EF: num(a?.earlyFinish), LS: num(a?.lateStart), LF: num(a?.lateFinish), TF: num(a?.totalFloat), isCritical: a?.isCritical, es: dayOf(a?.earlyStartDate), ef: dayOf(a?.earlyFinishDate), ls: dayOf(a?.lateStartDate), lf: dayOf(a?.lateFinishDate) });
/** Problems of a live row against an answer-book T1-shaped node (ES/EF/LS/LF/TF/critical/dates). */
const rowProblems = (a, node) => {
  if (!a) return ['row missing'];
  const f = figuresOf(a);
  const want = { ES: node.ES.value, EF: node.EF.value, LS: node.LS.value, LF: node.LF.value, TF: node.TF.value };
  const out = problemsOf(f, want);
  if ((f.TF <= 0) !== node.critical.value) out.push(`critical by float ${f.TF <= 0} != ${node.critical.value}`);
  if (Boolean(f.isCritical) !== node.critical.value) out.push(`isCritical ${f.isCritical} != ${node.critical.value}`);
  for (const [k, key] of [['es', 'earlyStartDate'], ['ef', 'earlyFinishDate'], ['ls', 'lateStartDate'], ['lf', 'lateFinishDate']]) {
    if (node[key] && f[k] !== node[key].value) out.push(`${key} ${f[k]} != ${node[key].value}`);
  }
  return out;
};
const criticalCodesOf = (rows) => rows.filter((a) => num(a.totalFloat) !== null && num(a.totalFloat) <= 0).map(codeOf).sort();
/** TASK rows of an XER text: [{ task_code, phys_complete_pct, ... }]. */
const xerTasks = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  let fields = null;
  let inTask = false;
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('%T')) { inTask = line.split('\t')[1] === 'TASK'; fields = null; continue; }
    if (!inTask) continue;
    if (line.startsWith('%F')) { fields = line.split('\t').slice(1); continue; }
    if (line.startsWith('%R') && fields) {
      const values = line.split('\t').slice(1);
      rows.push(Object.fromEntries(fields.map((f, i) => [f, values[i]])));
    }
  }
  return rows;
};

/** The product's CPM in process (pure): activities [{ id, duration, calendarId? }], links [{ pred, succ, type, lag }]. */
const productCpm = (activities, links, { projectStartDate = null, projectCalendar = null } = {}) => {
  // eslint-disable-next-line global-require
  const cpm = require('../../../src/services/cpm.service');
  const dependencies = links.map((l) => ({ predecessorId: l.pred, successorId: l.succ, relationshipType: l.type || 'FS', lagDays: l.lag || 0 }));
  return cpm.calculateCpm(activities.map((a) => ({ ...a })), { dependencies, projectStartDate, projectCalendar });
};
const dayFromDate = (d) => (d ? dayOf(d) : null);

// ── the harness ────────────────────────────────────────────────────────────────
const RULES = {
  'HR-S1': { status: 'proposed', statement: 'Late pass when the finish is driven through SS/SF links or leads: cap LF at the project finish (plan §5 HR-S1, undecided).', sources: [`${PLAN_DOC}:1029`] },
  'HR-S2': { status: 'decided', statement: 'Zero-duration activities and milestones: start = end is valid when the duration is 0; end < start is still refused (owner decision, plan §0.1; fixed at f599e67).', sources: [`${PLAN_DOC}:30,1030`] },
  'HR-S3': { status: 'proposed', statement: 'Readiness of a staged revision: run CPM on the snapshot; critical means TF <= 0 for every format (undecided).', sources: [`${PLAN_DOC}:1031`] },
  'HR-S4': { status: 'proposed', statement: 'Schedule-file conversion: symmetric rounding, refuse two-project files without a choice, detect Windows-1252, calendars P2 (undecided).', sources: [`${PLAN_DOC}:1032`] },
  'HR-S5': { status: 'proposed', statement: 'Mixed calendars: refuse an activity calendar that differs from the project\'s until CPM handles calendars (undecided).', sources: [`${PLAN_DOC}:1033`] },
  'HR-S6': { status: 'proposed', statement: 'Changing the start date or calendar after scheduling or baseline: recalculate on change; refuse after a baseline lock unless re-baselined (undecided).', sources: [`${PLAN_DOC}:1034`] },
  'HR-S8': { status: 'proposed', statement: 'Hand-built programmes (L124): Phase 1 a baseline needs an import or AI generation, and the UI says so (undecided).', sources: [`${PLAN_DOC}:1036`] },
  'HR-P5': { status: 'proposed', statement: 'Displayed progress basis: approved progress only, everywhere (undecided).', sources: [`${PLAN_DOC}:1042`] },
  'WP1-RB-1': { status: 'proposed', statement: 'Suspect registered by the builders\' adjudication: a rollback re-creates the retired activity instead of restoring it with its id (plan WP-9 :957 keeps ids).', sources: ['C:/Temp/octapm-cert/scratch/wp0/builders-adjudication.md R1-6', `${PLAN_DOC}:957`] },
  'ACT-CODE': { status: 'decided', statement: 'Defect fix (plan §5 defect fixes, f599e67): activation keeps the activity code and budget, and the mapping suggests by code.', sources: [`${PLAN_DOC}:563,1068`] },
  'CONCURRENT': { status: 'proposed', statement: 'Concurrent activations: an observation (plan :569, low); expected serialised, code never guessed.', sources: [`${PLAN_DOC}:569`] },
};
const CF_RULE = { 'CF.1.milestones': 'HR-S2', 'CF.2.lfNotCapped': 'HR-S1', 'CF.3.stagedFloat': 'HR-S3', 'CF.4.activationCode': 'ACT-CODE', 'CF.5.handBuilt': 'HR-S8', 'CF.6.filePercent': 'HR-P5', 'CF.7.startChange': 'HR-S6', 'CF.8.mixedCalendars': 'HR-S5', 'CF.9.twoProjectUtf8Rounding': 'HR-S4', 'CF.10.concurrent': 'CONCURRENT' };
const CF_DEFECT = { 'CF.1.milestones': 'D-FUN-2 / HR-S2 milestones', 'CF.2.lfNotCapped': 'HR-S1 LF not capped', 'CF.3.stagedFloat': 'HR-S3 staged float', 'CF.4.activationCode': 'L118-related activation code loss', 'CF.5.handBuilt': 'L124 hand-built baseline', 'CF.6.filePercent': 'HR-P5 file percent leaks', 'CF.7.startChange': 'HR-S6 start change', 'CF.8.mixedCalendars': 'HR-S5 mixed calendars', 'CF.9.twoProjectUtf8Rounding': 'HR-S4 conversion', 'CF.10.concurrent': 'concurrent activations' };
const planEntries = ACTIVE.map((c) => [c.id, c.description, c.id.startsWith('S.') ? { setup: true } : c.id.startsWith('CF.') ? (RULES[CF_RULE[c.id]].status === 'decided' ? { defect: CF_DEFECT[c.id], rule: CF_RULE[c.id] } : { rule: CF_RULE[c.id] }) : {}]);

const h = harness.createHarness({
  name: 'wp1-schedule-proof',
  plan: planEntries,
  rules: RULES,
  meta: {
    plan: `${PLAN_DOC} §4 WP-1 (:499-569), §6.2 WP-1 guards`,
    prep: 'C:/Temp/octapm-cert/scratch/wp1-prep.md',
    momentMap: 'backend/scripts/cert/cert3/build/MOMENT-MAP.md',
    answerBook: `backend/scripts/cert/cert3/answers/schedule.js @${SCHEDULE.meta.head}`,
    expectedChecks: EXPECTED_CHECKS,
    activeChecks: ACTIVE.length,
    filter: { only: ONLY ? [...ONLY] : null, skip: SKIP ? [...SKIP] : null, project: PROJECT_FILTER, sections: [...selectedSections], deepProjects: NEED_DEEP, throwaway: { W: NEED_W, X: NEED_X } },
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
    adjudication: 'C:/Temp/octapm-cert/scratch/wp1/author-adjudication.md (H1-H4, M2-M6, L1-L10, R-SET applied in the proof; M1 and R-DOC are the mutation lists\' and the run plan\'s)',
    checks: CHECKS.map(({ id, section, planRef, bookKey, where }) => ({ id, section, planRef, bookKey, where })),
  },
});

// ── per-check records, known answers and confirm-first classifications ────────
const records = {};
const knownAnswers = {};
const confirmFirst = {};
const obs = {};
const BY_ID = new Map(CHECKS.map((c) => [c.id, c]));
/** The only verdict: h.check with the record kept (expected / observed per id). Ids outside the active plan are skipped. */
const rec = (id, ok, { expected = null, observed = null, detail = '' } = {}) => {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`rec(${id}): not in the CHECKS table`);
  records[id] = { planRef: c.planRef, bookKey: c.bookKey, where: c.where, expected, observed, verdict: ok === true ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 2000) };
  if (!ACTIVE_IDS.has(id)) return ok === true;
  return h.check(id, ok === true, `${detail}${expected !== null ? ` | expected ${json(expected, 300)}` : ''}${observed !== null ? ` | observed ${json(observed, 400)}` : ''}`);
};
/**
 * A known answer (A10): `verdict` is 'value' (the book's expected figure holds), 'today' (HEAD's recorded answer under an undecided
 * rule or a registered suspect: BLOCKED / known, never exit 2) or 'wrong' (neither: an unexplained departure, a failure).
 */
const ka = (id, { ref, value, today, observed, verdict, detail = '' }) => {
  const c = BY_ID.get(id);
  // Once the owner decides the rule a known answer rests on, HEAD's 'today' is no longer a known answer but the defect itself.
  const decided = RULES[ref]?.status === 'decided';
  const blocked = verdict === 'today' && !decided;
  knownAnswers[id] = { ref, bookKey: c.bookKey, value, today, observed, verdict, ruleDecided: decided, status: verdict === 'value' ? 'PASS' : blocked ? 'BLOCKED' : 'FAIL' };
  const ok = verdict === 'value' || blocked;
  const text = `${blocked ? `BLOCKED (known answer, ${ref})` : verdict === 'today' ? `FAIL: HEAD still gives the known answer of ${ref}, which is now decided` : verdict === 'value' ? 'value' : `WRONG: neither the book's value nor HEAD's known answer (${ref})`}; ${detail}`;
  rec(id, ok, { expected: { value, today }, observed, detail: text });
  records[id].verdict = blocked ? 'BLOCKED' : ok ? 'PASS' : 'FAIL';
  return verdict;
};
/** value / today / wrong from a predicate over the observation. */
const judge = (observed, isValue, isToday) => (isValue(observed) ? 'value' : isToday(observed) ? 'today' : 'wrong');
/**
 * R-SET: a known-answer probe in its own section. When what the probe needs cannot be set up (a revision, a programme, a network,
 * an in-process surface that throws), the probe throws: the harness records a section error (a setup error, exit 1) and the
 * check is left unrecorded ('not run'), never judged 'wrong'; the enclosing flow carries on.
 */
const probe = (title, fn) => h.section(`probe: ${title}`, fn);
const probeSetup = (id, why) => new Error(`${id}: the probe's own setup failed (a setup error, not a verdict; R-SET): ${why}`);
/** A confirm-first item classified from this run's observations (plan §0.0: CONFIRMED / PARTIAL / REJECTED / TEST GAP). */
const cf = (id, { present, absent, gap = [], detail = '' }) => {
  const total = present.length + absent.length + gap.length;
  const classification = total === 0 || gap.length === total ? 'TEST GAP' : present.length === 0 ? 'REJECTED' : absent.length === 0 && gap.length === 0 ? 'CONFIRMED' : 'PARTIAL';
  const rule = RULES[CF_RULE[id]];
  confirmFirst[id] = { classification, rule: CF_RULE[id], ruleStatus: rule.status, present, absent, gap, note: rule.status === 'decided' ? 'a decided rule or landed fix: CONFIRMED is a failure' : 'an undecided rule: CONFIRMED is BLOCKED (reported, not failed); EXPECTED BEHAVIOUR is the owner\'s call' };
  // A decided rule or a landed fix must be REJECTED (the fixed behaviour holds); under an undecided rule the item is reported.
  const ok = rule.status === 'decided' ? classification === 'REJECTED' : classification !== 'TEST GAP';
  rec(id, ok, { expected: rule.status === 'decided' ? 'REJECTED (fixed)' : 'CONFIRMED or REJECTED (reported)', observed: { classification, present, absent, gap }, detail: `${classification}; ${detail}` });
  return classification;
};

// ── sessions and requests ──────────────────────────────────────────────────────
const ctx = { db: null, q: null, orgs: {}, people: {}, sessions: {}, W: null, X: null, cleanup: [] };
const RETRY_429 = 6;
/** One request as a persona; a 429 waits and asks again; every answer is kept for the 5xx sweep. */
const send = async (who, method, route, body, options = {}) => {
  const session = ctx.sessions[who];
  if (!session) throw new Error(`no session for ${who}`);
  for (let attempt = 0; ; attempt += 1) {
    const res = await session.send(method, route, body, options);
    h.keep(`${who} ${method} ${route}`, res);
    if (res.status === 429 && attempt < RETRY_429) {
      const after = Number(res.headers?.get?.('retry-after'));
      await h.sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30_000) : 3000);
      continue;
    }
    return res;
  }
};
const get = (who, route) => send(who, 'GET', route);
const dataOf = async (who, route) => {
  const res = await get(who, route);
  if (res.status !== 200) throw new Error(`${who} GET ${route} answered ${h.said(res)}: ${res.body?.error?.message || ''}`);
  return res.body?.data;
};
const upload = (who, route, file, fields = {}) => send(who, 'POST', route, undefined, { form: api.multipart({ filename: file.filename, contentType: file.contentType, body: file.body, fields }) });
const activitiesOf = async (who, P) => listOf(await dataOf(who, `${P}/activities`)).filter((a) => a.isActive !== false);
const byCode = (rows) => new Map(rows.map((a) => [codeOf(a), a]));
const scheduleOf = (who, P) => dataOf(who, `${P}/schedule`);
const revisionOf = (who, P, id) => dataOf(who, `${P}/schedule/revisions/${id}`);
const stagedOf = (rev) => listOf(rev?.snapshotJson?.activities);
const depsOf = (rev) => (Array.isArray(rev?.snapshotJson?.dependencies) ? rev.snapshotJson.dependencies : []);
/** The stored rows (text, no driver time-zone reading) of a project's active activities: what a refusal must leave alone. */
const fingerprintOf = async (projectId) => ctx.q('select id, duration, "updatedAt"::text as u, "startDate"::text as s, "endDate"::text as e from "Activity" where "projectId" = $1 and "isActive" = true order by id', [projectId]);
const countOf = async (table, projectId) => Number((await ctx.q(`select count(*)::int as n from "${table}" where "projectId" = $1`, [projectId]))[0].n);

/**
 * The BASELINE_LOCKED events of one revision. WP1.baseline.covered.auditEvents counts the audit log's event (the book cites the
 * audit write, schedule.service.js auditRevisionTransition), so the count is read with source=audit; the merged timeline
 * (source=all, the route's default: audit, approval, status and comment) is kept beside it as an observation.
 */
const baselineLockEvents = async (P, revisionId) => {
  const route = `${P}/audit?entityType=schedule_revision&entityId=${revisionId}&action=baseline_locked`;
  const audit = await get('pm', `${route}&source=audit`);
  const all = await get('pm', route);
  const events = listOf(audit.body?.data?.events || audit.body?.data);
  const merged = listOf(all.body?.data?.events || all.body?.data);
  return { said: h.said(audit), count: events.length, allSaid: h.said(all), all: merged.map((e) => ({ source: e.source ?? null, action: e.action ?? null, type: e.type ?? e.kind ?? null })) };
};

/** Stage a generated file on a project: { res, revisionId }. */
const stage = async (who, P, kind, file) => {
  const res = await upload(who, `${P}/import/${kind}`, file);
  return { res, revisionId: res.status === 201 ? res.body?.data?.revisionId || null : null };
};
/** draft -> under_review -> approved by the given personas; returns the answers. */
const review = async (P, revisionId, { submitter = 'planner', approver = 'pm', label = '' } = {}) => {
  const RV = `${P}/schedule/revisions/${revisionId}`;
  const submitted = await send(submitter, 'POST', `${RV}/submit-review`, { comment: `WP1 schedule proof ${label} ${h.STAMP}` });
  const approved = await send(approver, 'POST', `${RV}/approve`, { comment: `WP1 schedule proof ${label} ${h.STAMP}` });
  return { submitted, approved, ok: submitted.status === 200 && approved.status === 200 && approved.body?.data?.status === 'approved' };
};
/** Activate with GET mapping's suggestions, retiring every unmapped active activity with a reason; returns { mapping, res, activation }. */
const activateSuggested = async (P, revisionId, { label = '', extraRemovals = [] } = {}) => {
  const RV = `${P}/schedule/revisions/${revisionId}`;
  const mapping = await dataOf('pm', `${RV}/mapping`);
  const mappings = listOf(mapping.suggestedMappings).map(({ oldActivityId, newActivityKey }) => ({ oldActivityId, newActivityKey }));
  const unmappedRemovals = [...listOf(mapping.unmappedExisting).map((a) => ({ oldActivityId: a.id, reason: `WP1 schedule proof ${label}: retired by the revision ${h.STAMP}` })), ...extraRemovals];
  const res = await send('pm', 'POST', `${RV}/activate`, { mappings, unmappedRemovals, comment: `WP1 schedule proof ${label} activated ${h.STAMP}` });
  return { mapping, mappings, unmappedRemovals, res, activation: res.body?.data?.activation || null };
};
/** A progress claim submitted by `submitter` and approved by `approver`; returns { submitted, approved, submissionId }. */
const claim = async (P, activityId, pct, { submitter = 'site', approver = 'qs', approve = true, note = '' } = {}) => {
  const submitted = await send(submitter, 'POST', `${P}/activities/${activityId}/progress`, { pctComplete: pct, status: 'submitted', source: 'manual', notes: `WP1 schedule proof ${note} ${pct}% ${h.STAMP}` });
  const submissionId = submitted.body?.data?.submission?.id || null;
  const approved = approve && submissionId ? await send(approver, 'POST', `${P}/activities/${activityId}/progress-submissions/${submissionId}/approve`, {}) : null;
  return { submitted, approved, submissionId };
};
/** A BOQ workbook uploaded by the QS: { res, revisionId }. */
const uploadBoq = async (P, rows, label) => {
  const file = files.boqWorkbook(rows, { filename: `CERT3-WP1-proof-${label}-${h.STAMP}.xlsx`, title: `WP1 schedule proof ${label}` });
  const res = await upload('qs', `${P}/boq/upload`, file, { label: `WP1 schedule proof ${label} ${h.STAMP}` });
  return { res, revisionId: res.body?.data?.revisionId ?? res.body?.data?.revision?.id ?? null };
};
/** An allocation of a BOQ item to an activity: planner creates and submits, QS approves. */
const allocate = async (P, { boqItemId, activityId, quantity, amount, label }) => {
  const created = await send('planner', 'POST', `${P}/activity-boq-allocations`, { boqItemId, activityId, quantity, amount, source: 'manual', notes: `WP1 schedule proof ${label} ${h.STAMP}` });
  const id = created.body?.data?.id || null;
  const submitted = id ? await send('planner', 'POST', `${P}/activity-boq-allocations/${id}/submit`, {}) : null;
  const approved = id ? await send('qs', 'POST', `${P}/activity-boq-allocations/${id}/approve`, {}) : null;
  return { created, submitted, approved, id, ok: created.status === 201 && submitted?.status === 200 && approved?.status === 200 && approved.body?.data?.status === 'approved' };
};
const boqItemsOf = async (P) => listOf(await dataOf('qs', `${P}/boq`)).filter((i) => i.isActive !== false);
/** A project of 087 this run creates (archived in cleanup): { id, P }. */
const makeProject = async (title, team) => {
  const name = `CERT3 WP1 schedule proof ${title} ${h.STAMP}`;
  const created = await send('pm', 'POST', '/projects', { name, startDate: START, endDate: '2027-06-30', projectCalendar: 'five_day', currency: 'EGP' });
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (!id) throw new Error(`the ${title} project could not be created: ${h.said(created)} ${created.body?.error?.message || ''}`);
  ctx.cleanup.push(async () => {
    const res = await send('pm', 'DELETE', `/projects/${id}`);
    const row = (await ctx.q('select "archivedAt"::text as a from "Project" where id = $1', [id]))[0];
    return `${title} ${id} archive ${h.said(res)}, archivedAt ${row?.a || 'NOT SET'}`;
  });
  const members = [];
  for (const [key, role] of Object.entries(team)) members.push(await send('pm', 'POST', `/projects/${id}/team`, { userId: ctx.people[key], role }));
  return { id, P: `/projects/${id}`, name, created, members };
};

// ── setup ──────────────────────────────────────────────────────────────────────
/** The build steps whose stored outputs (moment figures) the proof reads, per deep project. */
const STATE_STEPS = {
  '087-SCH': ['import.F1', 'activate.F1', 'cpm.F1', 'baseline.noBoq', 'boq.upload', 'baseline.notActivated', 'activate.F1b', 'cpm.F1b', 'rollback.F1b', 'cpm.T2', 'baseline.unallocated', 'baseline', 'project.terms', 'tail'],
  '087-IMP': ['import.F3', 'activate.F3', 'import.F2', 'import.F4', 'import.F5', 'import.F6', 'import.F1.p6xml', 'import.F1.mspdi', 'import.F1.xlsx', 'import.F2.mspdi', 'import.F1float5', 'revisions.read'],
  '052-SCH-EV': ['schedule.activate.F1', 'schedule.cpm.F1', 'schedule.baseline.F1'],
  '006-LITE': ['schedule.import.F1', 'schedule.submit.F1', 'schedule.approve.F1', 'schedule.activate.F1', 'schedule.cpm.F1', 'schedule.baseline.F1'],
};
const PERSONAS = { pm: ['087', 'pm'], planner: ['087', 'planner'], site: ['087', 'site'], qs: ['087', 'qs'], outsider: [OUTSIDER, 'pm'], pm052: ['052', 'pm'], pm006: ['006', 'pm'] };

const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  const specs = Object.fromEntries(h.companies(...NEED_COMPANIES).map((c) => [c.code, c]));
  const problems = [];
  // Exactly one certification organisation per company, as the model reproduction resolves it (L6).
  for (const code of NEED_COMPANIES) {
    const rows = await ctx.q('select id, slug, name from "Organisation" where slug like $1', [`cert-${code}-%`]);
    if (rows.length !== 1) { problems.push(`company ${code}: ${rows.length} organisations, exactly one expected`); continue; }
    try {
      ctx.orgs[code] = certEnv.assertCertOrganisation(rows[0]) || rows[0];
    } catch (error) {
      problems.push(`company ${code}: ${error.message}`);
    }
  }
  for (const [key, [code, who]] of Object.entries(PERSONAS)) {
    if (!NEED_COMPANIES.includes(code) || !ctx.orgs[code]) continue;
    const email = `${who}@${specs[code].domain}`;
    ctx.sessions[key] = api.as({ email, orgId: ctx.orgs[code].id });
    const me = await get(key, '/auth/me');
    if (me.status !== 200) problems.push(`${key} (${email}): GET /auth/me ${h.said(me)}`);
    else {
      ctx.people[key] = me.body?.data?.id;
      ctx[`me_${key}`] = me.body?.data;
      if ((me.body?.data?.active?.orgId ?? me.body?.data?.orgId) !== ctx.orgs[code].id) problems.push(`${key}: session in another org`);
    }
  }
  rec('S.companies', problems.length === 0, { observed: { orgs: Object.fromEntries(Object.entries(ctx.orgs).map(([c, o]) => [c, { id: o.id, slug: o.slug }])), people: Object.keys(ctx.people) }, detail: problems.join('; ') || `${NEED_COMPANIES.length} companies (${NEED_COMPANIES.join(', ')}), ${Object.keys(ctx.people).length} sessions` });
  if (problems.length) throw new Error(`setup: ${problems.join('; ')}`);

  // The build state files the selected checks read: moment figures only.
  const stateProblems = [];
  ctx.state = {};
  for (const code of NEED_DEEP) {
    try {
      ctx.state[code] = readState(code);
      for (const step of STATE_STEPS[code]) if (ctx.state[code].steps?.[step]?.status !== 'done') stateProblems.push(`${code}: step ${step} is ${ctx.state[code].steps?.[step]?.status || 'not run'}`);
    } catch (error) {
      stateProblems.push(`${code}: ${error.message}`);
    }
  }
  rec('S.state', stateProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.state).map(([c, s]) => [c, { projectId: s.projectId, runs: s.runs?.length, updatedAt: s.updatedAt }])), detail: stateProblems.join('; ') || `${NEED_DEEP.length} state files (${NEED_DEEP.join(', ') || 'none needed'}), every needed step done` });

  // The deep projects by their exact names, through the API as each company's PM.
  const projectProblems = [];
  ctx.deep = {};
  for (const [code, { company, name }] of Object.entries(DEEP).filter(([code]) => NEED_DEEP.includes(code))) {
    const who = company === '087' ? 'pm' : `pm${company}`;
    const page = await get(who, `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(name)}`);
    const live = listOf(page.body?.data).filter((p) => p.name === name && !p.archivedAt);
    if (page.status !== 200) projectProblems.push(`${code}: GET /projects ${h.said(page)}`);
    else if (live.length !== 1) projectProblems.push(`${code}: ${live.length} live projects named "${name}" (${live.map((p) => p.id).join(', ')})`);
    else {
      ctx.deep[code] = { id: live[0].id, P: `/projects/${live[0].id}`, who };
      if (ctx.state[code] && ctx.state[code].projectId !== live[0].id) projectProblems.push(`${code}: the live project ${live[0].id} is not the state file's ${ctx.state[code].projectId} (restore and rebuild, or stale state)`);
    }
  }
  rec('S.projects', projectProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.deep).map(([c, d]) => [c, d.id])), detail: projectProblems.join('; ') || `${NEED_DEEP.length} deep projects (${NEED_DEEP.join(', ') || 'none needed'}), one live each, matching the state` });
  if (projectProblems.length) throw new Error(`setup: ${projectProblems.join('; ')}`);

  // The throwaway projects of 087.
  const made = {};
  if (NEED_W) { ctx.W = await makeProject('W', { planner: 'planning_eng', site: 'site_engineer', qs: 'qs' }); made.W = ctx.W; }
  if (NEED_X) { ctx.X = await makeProject('X', { planner: 'planning_eng', qs: 'qs' }); made.X = ctx.X; }
  const teamOk = Object.values(made).every((p) => p.members.every((m) => [200, 201].includes(m.status)));
  rec('S.throwaway', Object.keys(made).length === (NEED_W ? 1 : 0) + (NEED_X ? 1 : 0) && teamOk, { observed: Object.fromEntries(Object.entries(made).map(([k, p]) => [k, { id: p.id, team: p.members.map((m) => h.said(m)) }])), detail: `W ${made.W?.id || 'not needed'}; X ${made.X?.id || 'not needed'}` });
  if (!teamOk) throw new Error('setup: a throwaway project team could not be set');
};

// ── W: the F1 programme over a hand-built A100/A110 (T1, T2, revisions, cycle, dates, baseline, F1b, rollback, status, tail) ──
/** The W choreography (adjudication P-Q1, the book's WP1.revisions.activate.recordTwoHandBuilt): A100 and A110 hand-built, F1 mapped over them. */
const HAND_BUILT = ['A100', 'A110'];
/** The hand-built A110's budget: the proof's input (the model repro's 60,000), kept through activation (ACT-CODE). */
const BUDGET_A110 = 60_000;
/** The one hand-built activity the unmapped-activation probe leaves out (the book's choreography leaves out A140). */
const LEFT_OUT = 'A110';
const WBS = IN.wbs;
/** Does the permission policy grant a role a schedule transition? (shared/permissions.json through src/config/permissions.can) */
const policyAllows = (role, action, transition) => {
  // eslint-disable-next-line global-require
  const permissions = require('../../../src/config/permissions');
  return permissions.can({ role, module: 'schedule', action, transition });
};
/** M900 (and the project calendar) as GET /schedule and GET /projects/:id give them: the observation of the HR-S6 probes. */
const m900Now = async (P) => {
  const m = byCode(listOf((await scheduleOf('pm', P))?.activities)).get('M900');
  const data = await dataOf('pm', P);
  const project = data?.project ?? data;
  return { projectCalendar: project?.projectCalendar ?? null, startDate: dayOf(project?.startDate), M900: { earlyFinish: num(m?.earlyFinish), endDate: dayOf(m?.endDate), earlyFinishDate: dayOf(m?.earlyFinishDate), baselineFinishDate: dayOf(m?.baselineFinishDate) } };
};
/** PATCH the project back (start date / calendar) after an HR-S6 probe and require the restored figures; a failure is a setup error. */
const restoreProject = async (P, body, want, label) => {
  const res = await send('pm', 'PATCH', P, body);
  const now = await m900Now(P);
  const problems = problemsOf(now.M900, want);
  if (res.status !== 200 || problems.length) throw new Error(`W: ${label} could not be restored (${h.said(res)}; ${problems.join('; ')})`);
  return now;
};
const T1_DUR = WP1.T1.network.durations.value;
const F1_FILE = () => files.xer(files.F1(), { filename: `CERT3-WP1-proof-F1-${h.STAMP}.xer` });
const F1B_FILE = () => files.xer(files.F1b(), { filename: `CERT3-WP1-proof-F1b-${h.STAMP}.xer` });

const wFlow = async () => {
  const { P, id: projectId } = ctx.W;
  const w = { P, projectId, ids: {}, revisions: {} };
  ctx.w = w;

  // 1. the hand-built A100 (approved 100%) and A110 (budget 60,000), the site engineer on both
  const makeA100 = await send('planner', 'POST', `${P}/activities`, { name: `Hand-built site clearance ${h.STAMP}`, activityCode: 'A100', wbsCode: WBS.SUB, category: 'civil', duration: T1_DUR.A100, sortOrder: 0, engineerIds: [ctx.people.site] });
  w.ids.A100 = makeA100.body?.data?.id || null;
  const makeA110 = w.ids.A100 ? await send('planner', 'POST', `${P}/activities`, { name: `Hand-built bulk excavation ${h.STAMP}`, activityCode: 'A110', wbsCode: WBS.SUB, category: 'civil', duration: T1_DUR.A110, budget: BUDGET_A110, sortOrder: 1, engineerIds: [ctx.people.site], dependencies: [{ predecessorId: w.ids.A100, relationshipType: 'FS', lagDays: 0 }] }) : null;
  w.ids.A110 = makeA110?.body?.data?.id || null;
  if (!w.ids.A100 || !w.ids.A110) throw new Error(`W: the hand-built activities were not made (A100 ${h.said(makeA100)} ${makeA100.body?.error?.message || ''}; A110 ${makeA110 ? h.said(makeA110) : 'not sent'} ${makeA110?.body?.error?.message || ''})`);
  const a100progress = await claim(P, w.ids.A100, 100, { note: 'hand-built A100' });
  const a100 = await dataOf('pm', `${P}/activities/${w.ids.A100}`);
  if (a100progress.approved?.status !== 200 || num(a100.pctComplete) !== 100) throw new Error(`W: A100 was not approved at 100% (submit ${h.said(a100progress.submitted)}, approve ${h.said(a100progress.approved)}, pct ${a100.pctComplete})`);
  obs.wPre = { A100: { id: w.ids.A100, pct: num(a100.pctComplete), status: a100.status, budget: a100.budget }, A110: { id: w.ids.A110, budget: makeA110.body?.data?.budget } };

  // 2. imports: the site engineer, the outsider, then the planner's F1
  const bySite = await upload('site', `${P}/import/xer`, F1_FILE());
  rec('IMP.siteEngineer', h.is(bySite, WP1.imports.siteEngineer.value), { expected: WP1.imports.siteEngineer.value, observed: h.said(bySite) });
  const byOutsider = await upload('outsider', `${P}/import/xer`, F1_FILE());
  rec('IMP.outsider', h.is(byOutsider, WP1.imports.outsider.value), { expected: WP1.imports.outsider.value, observed: h.said(byOutsider) });
  const f1 = await stage('planner', P, 'xer', F1_FILE());
  w.revisions.R1 = f1.revisionId;
  const R1 = `${P}/schedule/revisions/${f1.revisionId}`;
  const rev1 = f1.revisionId ? await revisionOf('planner', P, f1.revisionId) : null;
  const staged1 = stagedOf(rev1);
  const d1 = f1.res.body?.data || {};
  rec('T1.import', f1.res.status === 201 && Boolean(f1.revisionId) && rev1?.status === 'draft' && rev1?.source === 'xer' && rev1?.isActive === false && Number(d1.imported) === WP1.T1.network.activities.value && Number(d1.dependencyCount) === WP1.T1.network.links.value && Number(d1.wbsNodes) === WP1.T1.network.wbsBranches.value && staged1.length === CODES.length,
    { expected: { status: 201, imported: WP1.T1.network.activities.value, dependencyCount: WP1.T1.network.links.value, wbsNodes: WP1.T1.network.wbsBranches.value }, observed: { said: h.said(f1.res), imported: d1.imported, dependencyCount: d1.dependencyCount, wbsNodes: d1.wbsNodes, status: rev1?.status, staged: staged1.length } });
  if (!f1.revisionId) throw new Error(`W: F1 was not staged (${h.said(f1.res)} ${f1.res.body?.error?.message || ''})`);
  const stagedBy = new Map(staged1.map((a) => [a.p6ActivityId, a]));
  const stagedFloats = Object.fromEntries(CODES.map((c) => [c, num(stagedBy.get(c)?.totalFloat)]));
  const wantFloats = Object.fromEntries(CODES.map((c) => [c, R.hoursToDays(IN.F1.totalFloatHours[c])]));
  const stagedCritical = staged1.filter((a) => a.isCritical === true).length;
  const m900s = stagedBy.get('M900');
  rec('T1.staged', num(stagedBy.get('A200')?.physComplete) === WP1.T1.stagedSnapshot.A200physComplete.value && dayOf(m900s?.startDate) === WP1.T1.stagedSnapshot.M900startEqualsFinish.value && dayOf(m900s?.endDate) === WP1.T1.stagedSnapshot.M900startEqualsFinish.value && JSON.stringify(stagedFloats) === JSON.stringify(wantFloats) && stagedCritical === WP1.T1.stagedSnapshot.criticalCount.value,
    { expected: { A200phys: WP1.T1.stagedSnapshot.A200physComplete.value, M900: WP1.T1.stagedSnapshot.M900startEqualsFinish.value, floats: wantFloats, critical: WP1.T1.stagedSnapshot.criticalCount.value }, observed: { A200phys: stagedBy.get('A200')?.physComplete, M900start: dayOf(m900s?.startDate), M900end: dayOf(m900s?.endDate), floats: stagedFloats, critical: stagedCritical } });
  w.keys = Object.fromEntries(staged1.map((a) => [a.p6ActivityId, a.draftKey]));

  // 3. review: the site engineer cannot submit; the planner submits; the planner and the site engineer cannot approve; the outsider is not found; the PM approves
  const siteSubmit = await send('site', 'POST', `${R1}/submit-review`, { comment: `WP1 proof ${h.STAMP}` });
  rec('REV.roles.siteSubmit', h.is(siteSubmit, WP1.revisions.roles.siteEngineerSubmit.value), { expected: WP1.revisions.roles.siteEngineerSubmit.value, observed: h.said(siteSubmit) });
  const submitted = await send('planner', 'POST', `${R1}/submit-review`, { comment: `WP1 proof F1 for review ${h.STAMP}` });
  rec('REV.submitByPlanner', submitted.status === 200 && submitted.body?.data?.status === WP1.revisions.submitByPlanner.value, { expected: WP1.revisions.submitByPlanner.value, observed: { said: h.said(submitted), status: submitted.body?.data?.status } });
  const plannerApprove = await send('planner', 'POST', `${R1}/approve`, { comment: 'x' });
  rec('REV.approve.planner', h.is(plannerApprove, WP1.revisions.approve.planner.value), { expected: WP1.revisions.approve.planner.value, observed: h.said(plannerApprove) });
  const siteApprove = await send('site', 'POST', `${R1}/approve`, { comment: 'x' });
  rec('REV.approve.site', h.is(siteApprove, WP1.revisions.approve.siteEngineer.value), { expected: WP1.revisions.approve.siteEngineer.value, observed: h.said(siteApprove) });
  const outsiderRead = await get('outsider', R1);
  const outsiderApprove = await send('outsider', 'POST', `${R1}/approve`, { comment: 'x' });
  rec('REV.roles.outsider', h.is(outsiderRead, WP1.revisions.roles.outsider.value) && h.is(outsiderApprove, WP1.revisions.roles.outsider.value), { expected: WP1.revisions.roles.outsider.value, observed: { read: h.said(outsiderRead), approve: h.said(outsiderApprove) } });
  const approved = await send('pm', 'POST', `${R1}/approve`, { comment: `WP1 proof F1 approved ${h.STAMP}` });
  const sanity = (approved.body?.error?.details?.checks || []).find((c) => c.key === 'date_sanity') || null;
  obs.approveF1 = { said: h.said(approved), status: approved.body?.data?.status, dateSanity: sanity ? { passed: sanity.passed, invalidRows: sanity.details?.invalidRows } : null };
  rec('REV.approve.pm', approved.status === 200 && approved.body?.data?.status === WP1.revisions.approve.pm.value, { expected: WP1.revisions.approve.pm.value, observed: obs.approveF1, detail: `HR-S2 fixed at f599e67 (today was ${WP1.revisions.approve.pm.today})` });
  if (approved.status !== 200) throw new Error(`W: F1 could not be approved (${h.said(approved)} ${approved.body?.error?.message || ''})`);
  const rejectApproved = await send('pm', 'POST', `${R1}/reject`, { reason: `WP1 proof: rejecting an approved revision ${h.STAMP}` });
  rec('REV.rejectApproved', h.is(rejectApproved, WP1.revisions.rejectApproved.value), { expected: WP1.revisions.rejectApproved.value, observed: h.said(rejectApproved) });

  // 4. activation: refusals, the mapping by code, the full activation
  const plannerActivate = await send('planner', 'POST', `${R1}/activate`, { mappings: [] });
  rec('REV.roles.plannerActivate', h.is(plannerActivate, WP1.revisions.roles.plannerActivate.value), { expected: WP1.revisions.roles.plannerActivate.value, observed: h.said(plannerActivate) });
  // M6: the site engineer is refused on activation (the code is the book's role refusal; the policy grants it no schedule transition)
  const siteMayActivate = policyAllows('site_engineer', 'approve', 'revision.activate');
  const siteActivate = await send('site', 'POST', `${R1}/activate`, { mappings: [] });
  rec('REV.roles.siteActivate', !siteMayActivate && h.is(siteActivate, WP1.revisions.roles.siteEngineerActivate.value), { expected: { said: WP1.revisions.roles.siteEngineerActivate.value, policyAllows: false }, observed: { said: h.said(siteActivate), policyAllows: siteMayActivate } });
  const noMapping = await send('pm', 'POST', `${R1}/activate`, { mappings: [] });
  rec('REV.activate.noMapping', h.is(noMapping, WP1.revisions.activate.noMapping.value), { expected: WP1.revisions.activate.noMapping.value, observed: h.said(noMapping), detail: 'sent { mappings: [] } with two active activities (adjudication D3)' });
  const mappedOnly = HAND_BUILT.filter((c) => c !== LEFT_OUT);
  const unmapped = await send('pm', 'POST', `${R1}/activate`, { mappings: mappedOnly.map((c) => ({ oldActivityId: w.ids[c], newActivityKey: w.keys[c] })) });
  const named = listOf(unmapped.body?.error?.details?.unmappedExisting);
  rec('REV.activate.unmappedNoReason', h.is(unmapped, WP1.revisions.activate.unmappedNoReason.value), { expected: WP1.revisions.activate.unmappedNoReason.value, observed: h.said(unmapped) });
  rec('REV.activate.unmappedNamed', h.is(unmapped, WP1.revisions.activate.unmappedNoReason.value) && named.length === WP1.revisions.activate.unmappedNamed.value && named.some((a) => a.id === w.ids[LEFT_OUT] || a.activityCode === LEFT_OUT), { expected: { count: WP1.revisions.activate.unmappedNamed.value, names: `${LEFT_OUT} (the one this choreography leaves out; the book's choreography leaves out A140)` }, observed: named.map((a) => a.activityCode || a.id) });
  // BOOK-4: F1 over the two hand-built activities: the hand-built ones mapped by code, the rest new
  const TWO = WP1.revisions.activate.recordTwoHandBuilt;
  const mapping = await dataOf('pm', `${R1}/mapping`);
  const suggested = listOf(mapping.suggestedMappings);
  const pairOf = (code) => suggested.find((s) => s.oldActivityId === w.ids[code]) || null;
  const byCodeOk = HAND_BUILT.every((c) => pairOf(c)?.matchType === WP1.revisions.mapByCode.matchType.value && Number(pairOf(c)?.confidence) === 1 && pairOf(c)?.newActivityKey === w.keys[c]);
  rec('REV.mapByCode.live', suggested.length === TWO.updated.value && byCodeOk && listOf(mapping.unmappedExisting).length === TWO.retired.value && listOf(mapping.newActivities).length === TWO.new.value, { expected: { matchType: WP1.revisions.mapByCode.matchType.value, confidence: 1, suggested: TWO.updated.value, unmapped: TWO.retired.value, new: TWO.new.value }, observed: { suggested: suggested.map((s) => ({ old: s.oldActivity?.activityCode, key: s.newActivityKey, matchType: s.matchType, confidence: s.confidence })), unmapped: listOf(mapping.unmappedExisting).length, new: listOf(mapping.newActivities).length } });
  obs.mapByCodeLive = byCodeOk;
  const activated = await send('pm', 'POST', `${R1}/activate`, { mappings: suggested.map(({ oldActivityId, newActivityKey }) => ({ oldActivityId, newActivityKey })), comment: `WP1 proof F1 activated ${h.STAMP}` });
  // M3: CPM runs inside the activation transaction. Straight after the answer, before any other request (none of which could
  // recalculate), the stored rows already carry the T1 figures: the activation committed them with the rows.
  const storedAfter = activated.status === 200 ? await ctx.q('select coalesce("activityCode", "p6ActivityId") as code, "earlyStart" as es, "earlyFinish" as ef, "lateStart" as ls, "lateFinish" as lf, "totalFloat" as tf, "isCritical" as crit from "Activity" where "projectId" = $1 and "isActive" = true', [projectId]) : [];
  const act = activated.body?.data?.activation || {};
  const activeOk = activated.status === 200 && activated.body?.data?.revision?.isActive === true;
  rec('REV.activate.full', activeOk && sameSet(listOf(act.updatedActivities), HAND_BUILT.map((c) => w.ids[c])) && listOf(act.updatedActivities).length === TWO.updated.value && listOf(act.newActivities).length === TWO.new.value && listOf(act.retiredActivities).length === TWO.retired.value && Number(act.dependencyCount) === TWO.dependencyCount.value,
    { expected: { status: WP1.revisions.activate.full.value, updated: TWO.updated.value, new: TWO.new.value, retired: TWO.retired.value, dependencyCount: TWO.dependencyCount.value }, observed: { said: h.said(activated), active: activated.body?.data?.revision?.isActive, updated: listOf(act.updatedActivities).length, new: listOf(act.newActivities).length, retired: listOf(act.retiredActivities).length, dependencyCount: act.dependencyCount } });
  const storedBy = new Map(storedAfter.map((r) => [r.code, r]));
  const cpmTxProblems = CODES.flatMap((c) => {
    const r = storedBy.get(c);
    const t = WP1.T1[c];
    if (!r) return [`${c} missing`];
    return problemsOf({ ES: num(r.es), EF: num(r.ef), LS: num(r.ls), LF: num(r.lf), TF: num(r.tf), isCritical: r.crit }, { ES: t.ES.value, EF: t.EF.value, LS: t.LS.value, LF: t.LF.value, TF: t.TF.value, isCritical: t.critical.value }).map((p) => `${c} ${p}`);
  });
  rec('REV.activate.cpmInTransaction', activeOk && storedAfter.length === CODES.length && cpmTxProblems.length === 0, { expected: { rows: CODES.length, figures: 'WP1.T1.<code>.ES/EF/LS/LF/TF/critical, stored when the activation answers' }, observed: { said: h.said(activated), rows: storedAfter.length, problems: cpmTxProblems.slice(0, 8) }, detail: cpmTxProblems.join('; ') });
  if (!activeOk) throw new Error(`W: F1 could not be activated (${h.said(activated)} ${activated.body?.error?.message || ''})`);
  let rows = await activitiesOf('pm', P);
  let by = byCode(rows);
  for (const c of CODES) w.ids[c] = by.get(c)?.id || w.ids[c] || null;
  const post = { A100: by.get('A100'), A110: by.get('A110') };
  obs.activationKept = { A100: { id: post.A100?.id, code: post.A100?.activityCode, budget: post.A100?.budget, pct: post.A100?.pctComplete, status: post.A100?.status }, A110: { id: post.A110?.id, code: post.A110?.activityCode, budget: post.A110?.budget } };
  // L7: the code and the budget are judged apart, so a budget-only regression is told apart in CF.4
  rec('REV.activate.keepsCode', HAND_BUILT.every((c) => post[c]?.id === obs.wPre[c].id && post[c]?.activityCode === c) && post.A100?.activityCode === WP1.revisions.mapByCode.activityCodeAfterActivation.value,
    { expected: { ids: 'kept', A100code: WP1.revisions.mapByCode.activityCodeAfterActivation.value, A110code: 'A110' }, observed: obs.activationKept });
  rec('REV.activate.keepsBudget', post.A110?.id === obs.wPre.A110.id && num(post.A110?.budget) === BUDGET_A110,
    { expected: { A110budget: BUDGET_A110, rule: WP1.revisions.mapByCode.budgetAfterActivation.value }, observed: { A110: obs.activationKept.A110, before: obs.wPre.A110 } });
  rec('REV.activate.keepsApprovedProgress', num(post.A100?.pctComplete) === 100 && post.A100?.status === WP1.status.live087SCH.A100approved100.value, { expected: { pct: 100, status: WP1.status.live087SCH.A100approved100.value, kept: WP1.revisions.activate.mappedKeepApprovedProgress.value }, observed: { pct: post.A100?.pctComplete, status: post.A100?.status } });
  const again = await send('pm', 'POST', `${R1}/activate`, { mappings: [] });
  rec('REV.activate.again', h.is(again, WP1.revisions.activate.again.value), { expected: WP1.revisions.activate.again.value, observed: h.said(again) });

  // 5. T1 on the activated programme
  const sched = await scheduleOf('pm', P);
  const wbsCodes = new Set(rows.map((a) => a.wbsCode));
  const durations = Object.fromEntries(CODES.map((c) => [c, num(by.get(c)?.duration)]));
  const projectEnd = Math.max(...rows.map((a) => num(a.earlyFinish) || 0));
  rec('T1.network', rows.length === WP1.T1.network.activities.value && rows.reduce((n, a) => n + listOf(a.dependencies).length, 0) === WP1.T1.network.links.value && wbsCodes.size === WP1.T1.network.wbsBranches.value && JSON.stringify(durations) === JSON.stringify(T1_DUR) && projectEnd === WP1.T1.network.projectEnd.value,
    { expected: { activities: WP1.T1.network.activities.value, links: WP1.T1.network.links.value, wbs: WP1.T1.network.wbsBranches.value, durations: T1_DUR, projectEnd: WP1.T1.network.projectEnd.value }, observed: { activities: rows.length, links: rows.reduce((n, a) => n + listOf(a.dependencies).length, 0), wbs: [...wbsCodes], durations, projectEnd } });
  for (const c of CODES) {
    const problems = rowProblems(by.get(c), WP1.T1[c]);
    rec(`T1.row.${c}`, problems.length === 0, { expected: { ES: WP1.T1[c].ES.value, EF: WP1.T1[c].EF.value, LS: WP1.T1[c].LS.value, LF: WP1.T1[c].LF.value, TF: WP1.T1[c].TF.value, critical: WP1.T1[c].critical.value, ef: WP1.T1[c].earlyFinishDate.value }, observed: figuresOf(by.get(c)), detail: problems.join('; ') });
  }
  const critical = criticalCodesOf(rows);
  rec('T1.critical', critical.length === WP1.T1.criticalCount.value && sameSet(critical, WP1.T1.criticalCodes.value) && rows.filter((a) => a.isCritical).length === CLAUDE.TF.criticalOf14.value, { expected: { count: WP1.T1.criticalCount.value, codes: WP1.T1.criticalCodes.value }, observed: { count: critical.length, codes: critical, flagged: rows.filter((a) => a.isCritical).length } });
  const invariant = rows.every((a) => num(a.totalFloat) === num(a.lateFinish) - num(a.earlyFinish) && num(a.totalFloat) === num(a.lateStart) - num(a.earlyStart));
  rec('T1.invariant', invariant === WP1.T1.tfEqualsLfMinusEfEveryRow.value, { expected: WP1.T1.tfEqualsLfMinusEfEveryRow.value, observed: invariant });
  const schedBy = byCode(listOf(sched?.activities));
  rec('T1.dates', dayOf(by.get('A100')?.earlyFinishDate) === WP1.T1.A100endDate.value && dayOf(by.get('M900')?.earlyFinishDate) === WP1.T1.M900earlyFinishDate.value && dayOf(by.get('M900')?.lateFinishDate) === WP1.T1.M900lateFinishDate.value && dayOf(by.get('M900')?.endDate) === WP1.T1.M900earlyFinishDate.value && dayOf(schedBy.get('M900')?.earlyFinishDate) === WP1.T1.M900earlyFinishDate.value,
    { expected: { A100end: WP1.T1.A100endDate.value, M900early: WP1.T1.M900earlyFinishDate.value, M900late: WP1.T1.M900lateFinishDate.value }, observed: { A100end: dayOf(by.get('A100')?.earlyFinishDate), M900early: dayOf(by.get('M900')?.earlyFinishDate), M900late: dayOf(by.get('M900')?.lateFinishDate), M900endDate: dayOf(by.get('M900')?.endDate), schedule: dayOf(schedBy.get('M900')?.earlyFinishDate) } });
  // the active durations are the staged ones (plan :503 "imports are staged, never applied" and WP1.conversion.activeEqualsStaged)
  const stagedDur = Object.fromEntries(CODES.map((c) => [c, num(stagedBy.get(c)?.duration)]));
  rec('CONV.activeEqualsStaged', JSON.stringify(stagedDur) === JSON.stringify(durations), { expected: WP1.conversion.activeEqualsStaged.value, observed: { staged: stagedDur, active: durations } });

  // 6. T2: A110 at 20, then restored
  const idsBefore = rows.map((a) => a.id).sort();
  const at20 = await send('planner', 'PATCH', `${P}/activities/${w.ids.A110}`, { duration: WP1.T2.A110duration.value });
  rows = await activitiesOf('pm', P);
  by = byCode(rows);
  const m900at20 = by.get('M900');
  const t2Problems = [];
  if (at20.status !== 200) t2Problems.push(`PATCH ${h.said(at20)}`);
  if (num(m900at20?.earlyFinish) !== WP1.T2.M900_EF.value) t2Problems.push(`M900 EF ${m900at20?.earlyFinish}`);
  if (dayOf(m900at20?.earlyFinishDate) !== WP1.T2.M900date.value) t2Problems.push(`M900 date ${dayOf(m900at20?.earlyFinishDate)}`);
  for (const c of ['A140', 'A300']) t2Problems.push(...problemsOf(figuresOf(by.get(c)), { ES: WP1.T2[c].ES.value, EF: WP1.T2[c].EF.value, LF: WP1.T2[c].LF.value, TF: WP1.T2[c].TF.value }).map((p) => `${c} ${p}`));
  for (const c of CODES) if (num(by.get(c)?.totalFloat) !== WP1.T1[c].TF.value) t2Problems.push(`${c} float ${by.get(c)?.totalFloat} != ${WP1.T1[c].TF.value}`);
  const critical20 = criticalCodesOf(rows);
  if (critical20.length !== WP1.T2.criticalCount.value) t2Problems.push(`critical ${critical20.length}`);
  const idsAfter = rows.map((a) => a.id).sort();
  if (idsAfter.length !== WP1.T2.idsUnchanged.value || JSON.stringify(idsAfter) !== JSON.stringify(idsBefore)) t2Problems.push('ids changed');
  rec('T2.at20', t2Problems.length === 0, { expected: { M900_EF: WP1.T2.M900_EF.value, M900date: WP1.T2.M900date.value, A140_TF: WP1.T2.A140.TF.value, A300_TF: WP1.T2.A300.TF.value, critical: WP1.T2.criticalCount.value, ids: WP1.T2.idsUnchanged.value }, observed: { said: h.said(at20), M900: figuresOf(m900at20), A140: figuresOf(by.get('A140')), A300: figuresOf(by.get('A300')), critical: critical20.length, ids: idsAfter.length }, detail: t2Problems.join('; ') });
  const restored = await send('planner', 'PATCH', `${P}/activities/${w.ids.A110}`, { duration: T1_DUR.A110 });
  rows = await activitiesOf('pm', P);
  by = byCode(rows);
  const restoreProblems = restored.status === 200 ? CODES.flatMap((c) => rowProblems(by.get(c), WP1.T1[c]).map((p) => `${c} ${p}`)) : [`PATCH ${h.said(restored)}`];
  rec('T2.restored', restoreProblems.length === 0 && num(by.get('M900')?.earlyFinish) === WP1.T2.restored.M900_EF.value && dayOf(by.get('M900')?.earlyFinishDate) === WP1.T2.restored.M900date.value, { expected: { M900_EF: WP1.T2.restored.M900_EF.value, M900date: WP1.T2.restored.M900date.value }, observed: { said: h.said(restored), M900: figuresOf(by.get('M900')) }, detail: restoreProblems.join('; ') });

  // 7. the cycle and the self link: refused, nothing written
  const fpBefore = await fingerprintOf(projectId);
  const cycle = await send('planner', 'PATCH', `${P}/activities/${w.ids.A100}`, { dependencies: [{ predecessorId: w.ids.A110, relationshipType: 'FS', lagDays: 0 }] });
  const fpAfter = await fingerprintOf(projectId);
  rec('CYC.refusal', h.is(cycle, WP1.cycle.refusal.value), { expected: WP1.cycle.refusal.value, observed: h.said(cycle) });
  const changed = fpAfter.filter((r) => JSON.stringify(r) !== JSON.stringify(fpBefore.find((b) => b.id === r.id))).length + (fpAfter.length !== fpBefore.length ? 1 : 0);
  rec('CYC.rowsChanged', changed === WP1.cycle.rowsChanged.value && fpBefore.length === rows.length, { expected: WP1.cycle.rowsChanged.value, observed: { rowsChanged: changed, rows: fpBefore.length } });
  const self = await send('planner', 'PATCH', `${P}/activities/${w.ids.A100}`, { dependencies: [{ predecessorId: w.ids.A100, relationshipType: 'FS', lagDays: 0 }] });
  rec('CYC.selfLink', h.is(self, WP1.cycle.selfLink.value), { expected: WP1.cycle.selfLink.value, observed: h.said(self) });

  // 8. dates: HR-S2 (rename, readiness, end < start on update); the start moved before any baseline (HR-S6)
  const m900Before = by.get('M900');
  const renamed = await send('planner', 'PATCH', `${P}/activities/${w.ids.M900}`, { name: `Practical completion (renamed) ${h.STAMP}` });
  const m900After = await dataOf('pm', `${P}/activities/${w.ids.M900}`);
  rec('DATES.renameM900', renamed.status === WP1.dates.renameM900.value && m900After?.name === `Practical completion (renamed) ${h.STAMP}` && dayOf(m900After?.startDate) === dayOf(m900Before?.startDate) && dayOf(m900After?.endDate) === dayOf(m900Before?.endDate) && dayOf(m900After?.startDate) === dayOf(m900After?.endDate), { expected: WP1.dates.renameM900.value, observed: { said: h.said(renamed), start: dayOf(m900After?.startDate), end: dayOf(m900After?.endDate) }, detail: `today was ${WP1.dates.renameM900.today} before f599e67` });
  obs.rename = { said: h.said(renamed) };
  const readiness = await get('pm', `${R1}/readiness`);
  const ds = (readiness.body?.data?.checks || []).find((c) => c.key === 'date_sanity') || null;
  obs.readiness = { said: h.said(readiness), passed: ds?.passed, invalidRows: ds?.details?.invalidRows };
  rec('DATES.readiness', readiness.status === 200 && ds?.passed === WP1.dates.readinessDateSanity.value && Array.isArray(ds?.details?.invalidRows) && ds.details.invalidRows.length === 0, { expected: WP1.dates.readinessDateSanity.value, observed: obs.readiness });
  const rowBefore = (await ctx.q('select name, duration, "startDate"::text as s, "endDate"::text as e, "updatedAt"::text as u from "Activity" where id = $1', [w.ids.M900]))[0];
  const g1 = await send('planner', 'PATCH', `${P}/activities/${w.ids.M900}`, { endDate: new Date(Date.parse(m900After.startDate) - DAY_MS).toISOString() });
  const rowAfter = (await ctx.q('select name, duration, "startDate"::text as s, "endDate"::text as e, "updatedAt"::text as u from "Activity" where id = $1', [w.ids.M900]))[0];
  rec('DATES.endBeforeStart.update', h.is(g1, WP1.dates.endBeforeStartRefused.value) && JSON.stringify(rowBefore) === JSON.stringify(rowAfter), { expected: `${WP1.dates.endBeforeStartRefused.value}, row unchanged`, observed: { said: h.said(g1), unchanged: JSON.stringify(rowBefore) === JSON.stringify(rowAfter) } });
  // HR-S6 before any baseline: the start moved to 2026-01-12 and back
  const T1_M900 = WP1.T1.M900earlyFinishDate.value;
  const moved = await send('pm', 'PATCH', P, { startDate: '2026-01-12' });
  const m900moved = (await scheduleOf('pm', P));
  const mm = byCode(listOf(m900moved?.activities)).get('M900');
  const movedObs = { said: h.said(moved), endDate: dayOf(mm?.endDate), earlyFinishDate: dayOf(mm?.earlyFinishDate) };
  const leafB = WP1.dates.startMovedTo0112.beforeBaseline_M900date;
  ka('KA.DATES.startMoved.before', { ref: 'HR-S6', value: leafB.value, today: leafB.today, observed: movedObs, verdict: judge(movedObs, (o) => o.said === '200' && o.endDate === leafB.value && o.earlyFinishDate === leafB.value, (o) => o.said === '200' && o.endDate === T1_M900 && o.earlyFinishDate === leafB.value) });
  obs.startMovedBefore = movedObs;
  await restoreProject(P, { startDate: START }, { endDate: T1_M900, earlyFinishDate: T1_M900 }, 'the start (before the baseline)');
  // M2 / BOOK-1: the project calendar changed before any baseline (five_day -> seven_day), then back
  const CC = WP1.dates.calendarChange;
  const calBefore = await send('pm', 'PATCH', P, { projectCalendar: CC.value.change.to });
  const calBeforeNow = await m900Now(P);
  const calBeforeObs = { http: calBefore.status, said: h.said(calBefore), projectCalendar: calBeforeNow.projectCalendar, M900: { earlyFinish: calBeforeNow.M900.earlyFinish, endDate: calBeforeNow.M900.endDate, earlyFinishDate: calBeforeNow.M900.earlyFinishDate } };
  const sameBranch = (o, branch) => o.http === branch.http && o.projectCalendar === branch.projectCalendar && problemsOf(o.M900, branch.M900).length === 0;
  ka('KA.DATES.calendarChange.before', { ref: CC.ref, value: CC.value.beforeBaseline, today: CC.today.beforeBaseline, observed: calBeforeObs, verdict: judge(calBeforeObs, (o) => sameBranch(o, CC.value.beforeBaseline), (o) => sameBranch(o, CC.today.beforeBaseline)), detail: 'PATCH /projects/:id { projectCalendar } on W, F1 active, no baseline yet' });
  obs.calendarChangeBefore = calBeforeObs;
  await restoreProject(P, { projectCalendar: CC.value.change.from }, { endDate: T1_M900, earlyFinishDate: T1_M900 }, 'the project calendar (before the baseline)');

  // 9. the baseline refusal order: no BOQ, zero-rated, all out of scope, not activated, unallocated; then covered
  const noBoq = await send('pm', 'POST', `${R1}/baseline`, { comment: 'before any bill' });
  rec('BL.noBoq', h.is(noBoq, WP1.baseline.noBoq.value), { expected: WP1.baseline.noBoq.value, observed: h.said(noBoq) });
  const zero = await uploadBoq(P, [{ code: 'Z-001', description: 'Zero-rated row', quantity: 10, unit: 'm3', rate: 0, mappingRule: 'in_scope' }], 'zero-rated');
  const zeroRated = await send('pm', 'POST', `${R1}/baseline`, { comment: 'zero-rated bill' });
  rec('BL.zeroRated', zero.res.status < 300 && h.is(zeroRated, WP1.baseline.zeroRated.value), { expected: WP1.baseline.zeroRated.value, observed: { upload: h.said(zero.res), baseline: h.said(zeroRated) } });
  const outOfScope = await uploadBoq(P, [{ code: 'O-001', description: 'Optional cladding', quantity: 100, unit: 'm2', rate: 50, mappingRule: 'optional' }, { code: 'O-002', description: 'Dewatering (not applicable)', quantity: 50, unit: 'm3', rate: 80, mappingRule: 'not_applicable' }], 'out-of-scope');
  const allOut = await send('pm', 'POST', `${R1}/baseline`, { comment: 'out-of-scope bill' });
  rec('BL.allOutOfScope', outOfScope.res.status < 300 && h.is(allOut, WP1.baseline.allOutOfScope.value), { expected: WP1.baseline.allOutOfScope.value, observed: { upload: h.said(outOfScope.res), baseline: h.said(allOut) } });
  const inScope = await uploadBoq(P, [{ code: 'W-001', description: 'Site clearance (in scope)', quantity: 100, unit: 'm2', rate: 10, mappingRule: 'in_scope' }], 'in-scope');
  const items = await boqItemsOf(P);
  const w001 = items.find((i) => i.code === 'W-001') || null;
  if (inScope.res.status >= 300 || !w001) throw new Error(`W: the in-scope bill was not uploaded (${h.said(inScope.res)} ${inScope.res.body?.error?.message || ''})`);
  // F1b staged and approved, not activated
  const f1b = await stage('planner', P, 'xer', F1B_FILE());
  w.revisions.R2 = f1b.revisionId;
  const R2 = `${P}/schedule/revisions/${f1b.revisionId}`;
  const r2review = f1b.revisionId ? await review(P, f1b.revisionId, { label: 'F1b' }) : null;
  if (!r2review?.ok) throw new Error(`W: F1b was not approved (${h.said(f1b.res)}; submit ${h.said(r2review?.submitted)}; approve ${h.said(r2review?.approved)} ${r2review?.approved?.body?.error?.message || ''})`);
  const notActivated = await send('pm', 'POST', `${R2}/baseline`, { comment: 'F1b before its activation' });
  rec('BL.notActivated', h.is(notActivated, WP1.baseline.notActivated.value), { expected: WP1.baseline.notActivated.value, observed: h.said(notActivated) });
  const unallocated = await send('pm', 'POST', `${R1}/baseline`, { comment: 'W-001 unallocated' });
  const failing = (unallocated.body?.error?.details?.checks || []).filter((c) => c.severity === 'blocking' && !c.passed && (!Array.isArray(c.requiredFor) || c.requiredFor.includes('baseline'))).map((c) => c.key);
  rec('BL.unallocated.live', h.is(unallocated, WP1.baseline.unallocated.refusal.value) && String(unallocated.body?.error?.message || '').includes('BOQ allocations') && failing.length === 1 && failing[0] === 'allocations', { expected: `${WP1.baseline.unallocated.refusal.value} naming BOQ allocations`, observed: { said: h.said(unallocated), failing, message: String(unallocated.body?.error?.message || '').slice(0, 200) } });
  const alloc = await allocate(P, { boqItemId: w001.id, activityId: w.ids.A100, quantity: 100, amount: 1000, label: 'W-001 to A100' });
  if (!alloc.ok) throw new Error(`W: the W-001 allocation was not approved (create ${h.said(alloc.created)} ${alloc.created.body?.error?.message || ''}; submit ${h.said(alloc.submitted)}; approve ${h.said(alloc.approved)})`);
  const plannerLock = await send('planner', 'POST', `${R1}/baseline`, { comment: 'planner' });
  rec('BL.planner', h.is(plannerLock, WP1.baseline.planner.value), { expected: WP1.baseline.planner.value, observed: h.said(plannerLock) });
  // M6: the site engineer is refused on the baseline (the book's baseline role refusal; the policy grants it no baseline)
  const siteMayBaseline = policyAllows('site_engineer', 'baseline', 'revision.baseline');
  const siteLock = await send('site', 'POST', `${R1}/baseline`, { comment: 'site engineer' });
  rec('BL.siteEngineer', !siteMayBaseline && h.is(siteLock, WP1.baseline.siteEngineer.value), { expected: { said: WP1.baseline.siteEngineer.value, policyAllows: false }, observed: { said: h.said(siteLock), policyAllows: siteMayBaseline } });
  const locked = await send('pm', 'POST', `${R1}/baseline`, { comment: `WP1 proof F1 baseline ${h.STAMP}` });
  rows = await activitiesOf('pm', P);
  by = byCode(rows);
  const lockedRows = rows.filter((a) => a.baselineStartDate && a.baselineFinishDate);
  const equalsEarly = CODES.every((c) => {
    const a = by.get(c);
    const [es, ef] = WP1.baseline.covered.equalsEarly.value[c];
    return a && num(a.earlyStart) === es && num(a.earlyFinish) === ef && dayOf(a.baselineStartDate) === dayOf(a.earlyStartDate) && dayOf(a.baselineFinishDate) === dayOf(a.earlyFinishDate);
  });
  const rev1locked = await revisionOf('pm', P, f1.revisionId);
  rec('BL.covered.live', locked.status === WP1.baseline.covered.http.value && Number(locked.body?.data?.locked) === WP1.baseline.covered.locked.value && lockedRows.length === WP1.baseline.covered.locked.value && rev1locked?.status === WP1.baseline.covered.status.value && equalsEarly && JSON.stringify([num(by.get('A300')?.earlyStart), num(by.get('A300')?.earlyFinish)]) === JSON.stringify(WP1.baseline.covered.A300.value) && JSON.stringify([num(by.get('M900')?.earlyStart), num(by.get('M900')?.earlyFinish)]) === JSON.stringify(WP1.baseline.covered.M900.value),
    { expected: { http: WP1.baseline.covered.http.value, locked: WP1.baseline.covered.locked.value, status: WP1.baseline.covered.status.value, A300: WP1.baseline.covered.A300.value, M900: WP1.baseline.covered.M900.value }, observed: { said: h.said(locked), locked: locked.body?.data?.locked, rows: lockedRows.length, status: rev1locked?.status, equalsEarly, M900baseline: dayOf(by.get('M900')?.baselineFinishDate) } });
  if (locked.status !== 200) throw new Error(`W: the baseline was not locked (${h.said(locked)} ${locked.body?.error?.message || ''})`);
  const lockEvents = await baselineLockEvents(P, f1.revisionId);
  rec('BL.covered.audit', lockEvents.said === '200' && lockEvents.count === WP1.baseline.covered.auditEvents.value, { expected: { auditLog: WP1.baseline.covered.auditEvents.value }, observed: lockEvents });

  // 9b. HR-S6 right after the first lock (H4: F1's baseline of 81, before F1b's second baseline and the rollback):
  // the start moved to 2026-01-12, then back; then the project calendar (BOOK-1), then back
  const leafA = WP1.dates.startMovedTo0112.afterBaseline;
  const movedAfter = await send('pm', 'PATCH', P, { startDate: '2026-01-12' });
  const ma = await m900Now(P);
  const afterObs = { said: h.said(movedAfter), status: movedAfter.status, startDate: ma.startDate, endDate: ma.M900.endDate, earlyFinishDate: ma.M900.earlyFinishDate, baselineFinishDate: ma.M900.baselineFinishDate };
  ka('KA.DATES.startMoved.after', { ref: 'HR-S6', value: { http: leafA.http.value, baselineFinishDate: leafA.baselineFinishDate.value }, today: { http: leafA.http.today, baselineFinishDate: leafA.baselineFinishDate.today }, observed: afterObs, verdict: judge(afterObs, (o) => o.status === leafA.http.value && o.baselineFinishDate === leafA.baselineFinishDate.value, (o) => o.status === leafA.http.today && o.baselineFinishDate === leafA.baselineFinishDate.today), detail: 'taken right after the first lock (F1 baseline, M900 81), before F1b' });
  obs.startMovedAfter = afterObs;
  if (movedAfter.status === 200) await restoreProject(P, { startDate: START }, { endDate: T1_M900, earlyFinishDate: T1_M900, baselineFinishDate: T1_M900 }, 'the start (after the lock)');
  const calAfter = await send('pm', 'PATCH', P, { projectCalendar: CC.value.change.to });
  const calAfterNow = await m900Now(P);
  const calAfterObs = { http: calAfter.status, said: h.said(calAfter), projectCalendar: calAfterNow.projectCalendar, M900: calAfterNow.M900 };
  ka('KA.DATES.calendarChange.after', { ref: CC.ref, value: CC.value.afterBaseline, today: CC.today.afterBaseline, observed: calAfterObs, verdict: judge(calAfterObs, (o) => sameBranch(o, CC.value.afterBaseline), (o) => sameBranch(o, CC.today.afterBaseline)), detail: 'PATCH /projects/:id { projectCalendar } on W right after the first lock (value: any 409, code null: never guessed)' });
  obs.calendarChangeAfter = calAfterObs;
  if (calAfter.status === 200) await restoreProject(P, { projectCalendar: CC.value.change.from }, { endDate: T1_M900, earlyFinishDate: T1_M900, baselineFinishDate: T1_M900 }, 'the project calendar (after the lock)');

  // 10. after the lock: A110 = 20 against the baseline, restored
  const at20b = await send('planner', 'PATCH', `${P}/activities/${w.ids.A110}`, { duration: WP1.T2.A110duration.value });
  const m900b = byCode(await activitiesOf('pm', P)).get('M900');
  const baselineFinishOffset = m900b ? R.workingDate(START, WP1.baseline.afterA110at20.M900_baselineFinish.value) : null;
  rec('BL.afterA110at20', at20b.status === 200 && num(m900b?.earlyFinish) === WP1.baseline.afterA110at20.M900_EF.value && dayOf(m900b?.baselineFinishDate) === baselineFinishOffset && dayOf(m900b?.earlyFinishDate) === WP1.T2.M900date.value && WP1.baseline.afterA110at20.M900_EF.value - WP1.baseline.afterA110at20.M900_baselineFinish.value === WP1.baseline.afterA110at20.variance.value,
    { expected: { EF: WP1.baseline.afterA110at20.M900_EF.value, baselineFinish: WP1.baseline.afterA110at20.M900_baselineFinish.value, baselineFinishDate: baselineFinishOffset, variance: WP1.baseline.afterA110at20.variance.value }, observed: { said: h.said(at20b), EF: m900b?.earlyFinish, earlyFinishDate: dayOf(m900b?.earlyFinishDate), baselineFinishDate: dayOf(m900b?.baselineFinishDate) } });
  const restoredB = await send('planner', 'PATCH', `${P}/activities/${w.ids.A110}`, { duration: T1_DUR.A110 });
  if (restoredB.status !== 200) throw new Error(`W: A110 could not be restored after the lock (${h.said(restoredB)})`);

  // 11. F1b activated over F1 (13 mapped, A140 retired), the second baseline, the rollback
  const f1bAct = await activateSuggested(P, f1b.revisionId, { label: 'F1b' });
  const a2 = f1bAct.activation || {};
  rows = await activitiesOf('pm', P);
  by = byCode(rows);
  const rev1after = await revisionOf('pm', P, f1.revisionId);
  const F1B = WP1.revisions.F1b;
  rec('REV.F1b.live', f1bAct.res.status === 200 && listOf(a2.updatedActivities).length === F1B.record.updated.value && listOf(a2.newActivities).length === F1B.record.new.value && listOf(a2.retiredActivities).length === F1B.record.retired.value && Number(a2.dependencyCount) === F1B.record.dependencyCount.value && num(by.get('A110')?.duration) === F1B.A110days.value && num(by.get('M900')?.earlyFinish) === F1B.M900_EF.value && num(by.get('A300')?.totalFloat) === F1B.A300_TF.value && !by.has('A140') && rev1after?.status === F1B.previousRevision.value,
    { expected: { updated: F1B.record.updated.value, new: F1B.record.new.value, retired: F1B.record.retired.value, dependencyCount: F1B.record.dependencyCount.value, A110days: F1B.A110days.value, M900_EF: F1B.M900_EF.value, A300_TF: F1B.A300_TF.value, previous: F1B.previousRevision.value }, observed: { said: h.said(f1bAct.res), updated: listOf(a2.updatedActivities).length, new: listOf(a2.newActivities).length, retired: listOf(a2.retiredActivities).length, dependencyCount: a2.dependencyCount, A110: by.get('A110')?.duration, M900_EF: by.get('M900')?.earlyFinish, A300_TF: by.get('A300')?.totalFloat, A140active: by.has('A140'), previous: rev1after?.status, mappings: f1bAct.mappings.length, removals: f1bAct.unmappedRemovals.length } });
  if (f1bAct.res.status !== 200) throw new Error(`W: F1b was not activated (${h.said(f1bAct.res)} ${f1bAct.res.body?.error?.message || ''})`);
  const second = await send('pm', 'POST', `${R2}/baseline`, { comment: `WP1 proof F1b baseline ${h.STAMP}` });
  const rev1second = await revisionOf('pm', P, f1.revisionId);
  const rev2second = await revisionOf('pm', P, f1b.revisionId);
  // L3: the second baseline itself: every active row's baseline is now F1b's early dates (M900 91 = 2026-05-12, not F1's 81)
  const rowsSecond = await activitiesOf('pm', P);
  const bySecond = byCode(rowsSecond);
  const secondDates = rowsSecond.every((a) => a.baselineStartDate && a.baselineFinishDate && dayOf(a.baselineStartDate) === dayOf(a.earlyStartDate) && dayOf(a.baselineFinishDate) === dayOf(a.earlyFinishDate));
  const m900SecondBaseline = dayOf(bySecond.get('M900')?.baselineFinishDate);
  const m900SecondWant = R.workingDate(START, F1B.M900_EF.value);
  rec('BL.secondBaseline', second.status === WP1.baseline.covered.http.value && rev2second?.status === WP1.baseline.covered.status.value && rev1second?.status === WP1.baseline.secondBaseline.value && rowsSecond.length === CODES.length - F1B.file.value.retired.length && secondDates && m900SecondBaseline === m900SecondWant,
    { expected: { second: WP1.baseline.covered.http.value, secondStatus: WP1.baseline.covered.status.value, first: WP1.baseline.secondBaseline.value, rows: CODES.length - F1B.file.value.retired.length, baselineEqualsEarly: true, M900baselineFinish: m900SecondWant }, observed: { said: h.said(second), first: rev1second?.status, second: rev2second?.status, rows: rowsSecond.length, baselineEqualsEarly: secondDates, M900baselineFinish: m900SecondBaseline } });
  // M6: the site engineer is refused on the rollback (with a reason, so only the role can refuse it)
  const siteMayRollback = policyAllows('site_engineer', 'approve', 'revision.rollback');
  const siteRollback = await send('site', 'POST', `${R2}/rollback`, { reason: `WP1 proof: the site engineer's rollback ${h.STAMP}` });
  rec('REV.roles.siteRollback', !siteMayRollback && h.is(siteRollback, WP1.revisions.roles.siteEngineerRollback.value), { expected: { said: WP1.revisions.roles.siteEngineerRollback.value, policyAllows: false }, observed: { said: h.said(siteRollback), policyAllows: siteMayRollback } });
  const a140Before = w.ids.A140;
  const rolled = await send('pm', 'POST', `${R2}/rollback`, { reason: `WP1 proof F1b rolled back to F1 ${h.STAMP}` });
  rows = await activitiesOf('pm', P);
  by = byCode(rows);
  const rev1rolled = await revisionOf('pm', P, f1.revisionId);
  rec('REV.rollback.live', rolled.status === 200 && rev1rolled?.isActive === true && num(by.get('M900')?.earlyFinish) === WP1.revisions.rollback.M900_EF.value && num(by.get('A110')?.duration) === T1_DUR.A110 && rows.length === CODES.length, { expected: { M900_EF: WP1.revisions.rollback.M900_EF.value, active: 14 }, observed: { said: h.said(rolled), active: rev1rolled?.isActive, status: rev1rolled?.status, M900_EF: by.get('M900')?.earlyFinish, A110: by.get('A110')?.duration, rows: rows.length } });
  if (rolled.status !== 200) throw new Error(`W: the rollback failed (${h.said(rolled)} ${rolled.body?.error?.message || ''})`);
  const a140 = by.get('A140') || null;
  const rbObs = { before: a140Before, after: a140?.id || null, sameId: Boolean(a140) && a140.id === a140Before, activityCode: a140?.activityCode ?? null, p6ActivityId: a140?.p6ActivityId ?? null };
  const rbStored = ctx.state['087-SCH'] ? outOf(ctx.state['087-SCH'], 'rollback.F1b')?.a140 || null : 'not read (087-SCH not selected)';
  ka('KA.REV.rollback.A140id', { ref: 'WP1-RB-1', value: WP1.revisions.rollback.A140id.value, today: WP1.revisions.rollback.A140id.today, observed: { live: rbObs, stored: rbStored }, verdict: judge(rbObs, (o) => o.sameId === true, (o) => o.after && !o.sameId && o.p6ActivityId === 'A140') });
  obs.rollback = rbObs;
  w.ids.A140 = a140?.id || null;

  // 12. the older revision: activate -> WP1.revisions.activate.olderRevision (BOOK-3); submit -> WP1.revisions.notCurrent
  const OLDER = WP1.revisions.activate.olderRevision;
  const older = await send('pm', 'POST', `${R2}/activate`, { mappings: [] });
  rec('REV.activate.olderRevision', h.is(older, OLDER.value), { expected: { value: OLDER.value, planValue: OLDER.planValue }, observed: h.said(older) });
  const notCurrent = await send('planner', 'POST', `${R2}/submit-review`, { comment: 'older' });
  rec('REV.notCurrent', h.is(notCurrent, WP1.revisions.notCurrent.value), { expected: WP1.revisions.notCurrent.value, observed: h.said(notCurrent) });

  // 13. a second import supersedes only the open draft (L4: the second upload is the one open draft; every non-draft revision,
  // the active R1 and the baselined-then-superseded R2, untouched); reject without a reason
  const revisionsList = async () => listOf(await dataOf('pm', `${P}/schedule/revisions`)).map((r) => ({ id: r.id, status: r.status, isActive: r.isActive === true }));
  const listBefore = await revisionsList();
  const r3 = await stage('planner', P, 'xer', F1_FILE());
  const r4 = await stage('planner', P, 'xer', F1_FILE());
  const listAfter = await revisionsList();
  const after = new Map(listAfter.map((r) => [r.id, r]));
  const nonDraftMoved = listBefore.filter((r) => r.status !== 'draft').filter((r) => JSON.stringify(after.get(r.id)) !== JSON.stringify(r)).map((r) => `${r.id} ${r.status}/${r.isActive} -> ${after.get(r.id)?.status}/${after.get(r.id)?.isActive}`);
  const drafts = listAfter.filter((r) => r.status === 'draft').map((r) => r.id);
  const SECOND = WP1.revisions.secondImport;
  rec('REV.secondImport.live', r3.res.status === 201 && r4.res.status === 201 && after.get(r3.revisionId)?.status === SECOND.openDraft.value && drafts.length === 1 && drafts[0] === r4.revisionId && nonDraftMoved.length === 0 && after.get(f1.revisionId)?.isActive === true && listBefore.filter((r) => r.status !== 'draft').length >= 2,
    { expected: { firstUpload: SECOND.openDraft.value, openDrafts: ['the second upload'], nonDraft: SECOND.activeRevision.value }, observed: { stage: [h.said(r3.res), h.said(r4.res)], r3: after.get(r3.revisionId)?.status, drafts: drafts.map((id) => (id === r4.revisionId ? 'r4' : id)), nonDraftBefore: listBefore.filter((r) => r.status !== 'draft').map((r) => `${r.status}/${r.isActive}`), nonDraftMoved, r1: after.get(f1.revisionId) } });
  const R4 = `${P}/schedule/revisions/${r4.revisionId}`;
  const sub4 = await send('planner', 'POST', `${R4}/submit-review`, { comment: `WP1 proof R4 ${h.STAMP}` });
  const noReason = await send('pm', 'POST', `${R4}/reject`, {});
  const namesReason = listOf(noReason.body?.error?.details).some((d) => d?.field === 'reason');
  const withReason = await send('pm', 'POST', `${R4}/reject`, { reason: `WP1 proof: logic missing ${h.STAMP}` });
  const RWR = WP1.revisions.rejectWithoutReason;
  rec('REV.rejectWithoutReason', sub4.status === 200 && h.is(noReason, RWR.value) && namesReason && withReason.status === 200 && withReason.body?.data?.status === 'rejected', { expected: { value: RWR.value, details: 'field reason', planValue: RWR.planValue, then: 'rejected' }, observed: { submit: h.said(sub4), noReason: h.said(noReason), namesReason, withReason: h.said(withReason), status: withReason.body?.data?.status } });
  w.revisions.R4 = r4.revisionId;

  // 14. status: A200's file percent on every surface; A110 approved 40 then an unapproved 60
  await wStatus(w);

  // 15. the tail T900 after the lock; progress on it
  await wTail(w);

  // 16. concurrent activations of one approved revision (low): the last thing W does (the start-date probe after the
  // baseline moved to 9b, right after the first lock: H4)
  await probe('KA.REV.concurrent (W)', () => wConcurrent(w));
};

const wStatus = async (w) => {
  const { P, projectId } = w;
  const A200 = w.ids.A200;
  const act = await dataOf('pm', `${P}/activities/${A200}`);
  const schedRow = byCode(listOf((await scheduleOf('pm', P))?.activities)).get('A200');
  // the report source, in process (report-sources.js: approved progress + deriveActivityStatus)
  let report = { pct: null, status: null, error: null };
  try {
    // eslint-disable-next-line global-require
    const { prisma } = require('../../../src/config/db');
    // eslint-disable-next-line global-require
    const sources = require('../../../src/services/report-sources');
    const source = sources.SOURCES.activity;
    const row = await prisma.activity.findFirst({ where: { id: A200 }, include: source.include });
    const col = (key) => source.columns.find((c) => c.key === key);
    report = { pct: col('pctComplete').compute(row), status: col('status').compute(row), error: null };
  } catch (error) {
    report.error = error.message;
  }
  // the XLSX export (export.service: approved pct + deriveActivityStatus), fetched through the tracked request path (M5): the
  // answer's status is kept for the 5xx sweep and reported as it was
  const exportedXlsx = await send('pm', 'GET', `${P}/export/xlsx`, undefined, { binary: true });
  let xlsx = { said: h.said(exportedXlsx), pct: null, status: null, error: null };
  if (exportedXlsx.status === 200 && exportedXlsx.buffer) {
    const book = XLSX.read(exportedXlsx.buffer, { type: 'buffer' });
    const sheet = book.Sheets['Master Schedule'];
    const rowsX = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: null }) : [];
    const a200 = rowsX.find((r) => r.ID === 'A200') || null;
    xlsx = { ...xlsx, pct: a200 ? a200['% Complete'] : null, status: a200 ? a200.Status : null, error: sheet ? (a200 ? null : 'A200 row not found') : `no 'Master Schedule' sheet (${book.SheetNames.join(', ')})` };
  } else {
    xlsx.error = `GET export/xlsx answered ${h.said(exportedXlsx)}`;
  }
  const A200F = WP1.status.A200fileFortyPercent;
  const wantStatus = A200F.status.value;
  const wantPct = A200F.pct.value;
  const hard = { activities: { pct: num(act?.pctComplete), status: act?.status }, schedule: { pct: num(schedRow?.pctComplete), status: schedRow?.status }, report, xlsx };
  rec('STATUS.A200.hard', hard.activities.pct === wantPct && hard.activities.status === wantStatus && hard.schedule.pct === wantPct && hard.schedule.status === wantStatus && Number(report.pct) === wantPct && report.status === wantStatus && String(xlsx.pct) === `${wantPct}%` && xlsx.status === wantStatus,
    { expected: { pct: wantPct, status: wantStatus }, observed: hard });
  // search (HR-P5, WP1.status.A200fileFortyPercent.searchStatus: the value is the status /activities derives)
  const NAME_A200 = IN.F1.tasks.find((t) => t[0] === 'A200')[1];
  const search = await get('pm', `/search?q=${encodeURIComponent(NAME_A200)}&projectId=${projectId}`);
  const hit = listOf(search.body?.data?.items).find((i) => i.type === 'activity' && i.id === A200) || null;
  const searchObs = { said: h.said(search), status: hit?.status ?? null, found: Boolean(hit) };
  ka('KA.STATUS.A200.search', { ref: A200F.searchStatus.ref, value: A200F.searchStatus.value, today: A200F.searchStatus.today, observed: searchObs, verdict: judge(searchObs, (o) => o.found && o.status === A200F.searchStatus.value, (o) => o.found && o.status === A200F.searchStatus.today) });
  // lookahead (WP1.status.A200fileFortyPercent.lookaheadPct); a lookahead that cannot be made is the probe's setup error (R-SET)
  let lookObs = null;
  await probe('KA.STATUS.A200.lookahead (W)', async () => {
    const lookahead = await send('pm', 'POST', `${P}/lookaheads`, { startDate: R.workingDate(START, WP1.T1.A200.ES.value), weeks: 3, title: `WP1 proof lookahead ${h.STAMP}` });
    const lookId = lookahead.body?.data?.id || null;
    if (lookId) ctx.cleanup.push(async () => `lookahead ${lookId} delete ${h.said(await send('pm', 'DELETE', `${P}/lookaheads/${lookId}`))}`);
    const detail = lookId ? await get('pm', `${P}/lookaheads/${lookId}`) : null;
    if (!lookId || detail?.status !== 200) throw probeSetup('KA.STATUS.A200.lookahead', `the lookahead could not be made or read (${h.said(lookahead)} ${lookahead.body?.error?.message || ''}; ${detail ? h.said(detail) : 'no read'})`);
    const item = listOf(detail?.body?.data?.items).find((i) => i.activityId === A200) || null;
    lookObs = { said: h.said(lookahead), detail: h.said(detail), found: Boolean(item), pct: item ? num(item.pctComplete) : null, status: item?.status ?? null };
    ka('KA.STATUS.A200.lookahead', { ref: A200F.lookaheadPct.ref, value: A200F.lookaheadPct.value, today: A200F.lookaheadPct.today, observed: lookObs, verdict: judge(lookObs, (o) => o.found && o.pct === A200F.lookaheadPct.value, (o) => o.found && o.pct === A200F.lookaheadPct.today) });
  });
  // the schedule export as XER (WP1.status.A200fileFortyPercent.exportXerPct)
  // the route answers application/octet-stream, so the text is read from the buffer (a JSON-shaped read sees no text)
  const exported = await send('pm', 'GET', `${P}/export/schedule/xer`, undefined, { binary: true });
  const task = exported.status === 200 && exported.buffer ? xerTasks(Buffer.from(exported.buffer).toString('utf8')).find((t) => t.task_code === 'A200') || null : null;
  const xerObs = { said: h.said(exported), found: Boolean(task), pct: task ? num(task.phys_complete_pct) : null };
  ka('KA.STATUS.A200.exportXer', { ref: A200F.exportXerPct.ref, value: A200F.exportXerPct.value, today: A200F.exportXerPct.today, observed: xerObs, verdict: judge(xerObs, (o) => o.found && o.pct === A200F.exportXerPct.value, (o) => o.found && o.pct === A200F.exportXerPct.today) });
  // the assistant's retrieval, in process (WP1.status.A200fileFortyPercent.assistantText); a throw there is the probe's setup
  // error (R-SET), and the agreement of the seven surfaces is judged only when every surface was read
  await probe('KA.STATUS.A200.assistant + KA.STATUS.surfacesAgree (W)', async () => {
    let retrieved;
    try {
      // eslint-disable-next-line global-require
      const retrieval = require('../../../src/services/retrieval.service');
      const me = ctx.me_pm || {};
      retrieved = await retrieval.retrieve({ orgId: ctx.orgs['087'].id, user: { id: ctx.people.pm, role: me.role || 'pm', isCompanyAdmin: Boolean(me.isCompanyAdmin) }, projectId, query: NAME_A200 });
    } catch (error) {
      throw probeSetup('KA.STATUS.A200.assistant', `retrieval.retrieve threw: ${error.message}`);
    }
    const source = (retrieved?.sources || []).find((s) => s.type === 'activity' && s.id === A200) || null;
    const assistantObs = { found: Boolean(source), text: source?.text || source?.snippet || null, sources: (retrieved?.sources || []).length };
    const textOf = (pct) => new RegExp(`(^|[^0-9])${String(pct).replace('.', '\\.')}% complete`);
    const A = A200F.assistantText;
    ka('KA.STATUS.A200.assistant', { ref: A.ref, value: A.value, today: A.today, observed: assistantObs, verdict: judge(assistantObs, (o) => o.found && textOf(A.value.split('%')[0]).test(o.text || ''), (o) => o.found && textOf(A.today.split('%')[0]).test(o.text || '')) });
    if (!lookObs) throw probeSetup('KA.STATUS.surfacesAgree', 'the lookahead surface was not read');
    const agree = hard.activities.pct === wantPct && hard.activities.status === wantStatus && hard.schedule.pct === wantPct && Number(report.pct) === wantPct && String(xlsx.pct) === `${wantPct}%` && searchObs.status === A200F.searchStatus.value && lookObs.pct === A200F.lookaheadPct.value && xerObs.pct === A200F.exportXerPct.value && textOf(wantPct).test(assistantObs.text || '');
    const disagreeToday = searchObs.status === A200F.searchStatus.today && lookObs.pct === A200F.lookaheadPct.today && xerObs.pct === A200F.exportXerPct.today && textOf(A.today.split('%')[0]).test(assistantObs.text || '') && hard.activities.pct === wantPct && hard.schedule.pct === wantPct;
    ka('KA.STATUS.surfacesAgree', { ref: 'HR-P5', value: WP1.status.surfacesAgree.value, today: `disagree: search ${A200F.searchStatus.today}, lookahead ${A200F.lookaheadPct.today}, the XER export ${A200F.exportXerPct.today}, assistant '${A.today}' (the file percent); /activities, /schedule, the report source and the XLSX export ${wantPct} ${wantStatus}`, observed: { hard, search: searchObs, lookahead: lookObs, xer: xerObs, assistant: assistantObs }, verdict: agree ? 'value' : disagreeToday ? 'today' : 'wrong' });
    obs.surfaces = { hard, search: searchObs, lookahead: lookObs, xer: xerObs, assistant: assistantObs, agree };
  });
  // A110: approved 40 -> delayed; an unapproved 60 changes nothing
  const assign = await send('planner', 'PATCH', `${P}/activities/${w.ids.A110}`, { engineerIds: [ctx.people.site] });
  const forty = await claim(P, w.ids.A110, 40, { note: 'A110' });
  const a110 = await dataOf('pm', `${P}/activities/${w.ids.A110}`);
  const s110 = byCode(listOf((await scheduleOf('pm', P))?.activities)).get('A110');
  rec('STATUS.A110at40', assign.status === 200 && forty.approved?.status === 200 && num(a110?.pctComplete) === 40 && a110?.status === WP1.status.live087SCH.A110at40.value && s110?.status === WP1.status.live087SCH.A110at40.value, { expected: { pct: 40, status: WP1.status.live087SCH.A110at40.value }, observed: { assign: h.said(assign), submit: h.said(forty.submitted), approve: h.said(forty.approved), pct: a110?.pctComplete, status: a110?.status, schedule: s110?.status } });
  const sixty = await claim(P, w.ids.A110, 60, { approve: false, note: 'A110 unapproved' });
  const a110b = await dataOf('pm', `${P}/activities/${w.ids.A110}`);
  const s110b = byCode(listOf((await scheduleOf('pm', P))?.activities)).get('A110');
  rec('STATUS.unapproved60', sixty.submitted.status === 200 && sixty.submitted.body?.data?.submission?.status === 'submitted' && num(a110b?.pctComplete) === 40 && a110b?.status === a110?.status && num(s110b?.pctComplete) === 40 && s110b?.status === s110?.status, { expected: WP1.status.unapproved60.value, observed: { submit: h.said(sixty.submitted), pct: a110b?.pctComplete, status: a110b?.status, schedulePct: s110b?.pctComplete, scheduleStatus: s110b?.status } });
};

const wTail = async (w) => {
  const { P } = w;
  const TAIL = IN.tail087SCH;
  const made = await send('planner', 'POST', `${P}/activities`, { name: TAIL.name, activityCode: TAIL.code, wbsCode: WBS.ARC, duration: TAIL.durationDays, isMilestone: false, sortOrder: CODES.length, engineerIds: [ctx.people.site], dependencies: [{ predecessorId: w.ids[TAIL.predecessor], relationshipType: TAIL.relationship, lagDays: TAIL.lagDays }] });
  const rows = await activitiesOf('pm', P);
  const by = byCode(rows);
  const t = by.get(TAIL.code);
  w.ids.T900 = t?.id || null;
  const T = WP1.tail;
  const problems = made.status === 201 ? [...problemsOf(figuresOf(t), { ES: T.ES.value, EF: T.EF.value, TF: T.TF.value, es: T.earlyStartDate.value, ef: T.earlyFinishDate.value })] : [`POST ${h.said(made)} ${made.body?.error?.message || ''}`];
  if (num(by.get('M900')?.totalFloat) !== T.M900_TF.value) problems.push(`M900 TF ${by.get('M900')?.totalFloat}`);
  if (num(by.get('A140')?.totalFloat) !== T.A140_TF.value) problems.push(`A140 TF ${by.get('A140')?.totalFloat}`);
  if (num(by.get('A300')?.totalFloat) !== T.A300_TF.value) problems.push(`A300 TF ${by.get('A300')?.totalFloat}`);
  if (criticalCodesOf(rows).length !== T.criticalCount.value) problems.push(`critical ${criticalCodesOf(rows).length}`);
  if (Math.max(...rows.map((a) => num(a.earlyFinish) || 0)) !== T.projectEnd.value) problems.push('project end');
  if (t && (t.baselineStartDate || t.baselineFinishDate)) problems.push('T900 carries a baseline');
  rec('TAIL.liveW', problems.length === 0, { expected: { ES: T.ES.value, EF: T.EF.value, TF: T.TF.value, finish: T.earlyFinishDate.value, M900_TF: T.M900_TF.value, A140_TF: T.A140_TF.value, A300_TF: T.A300_TF.value, critical: T.criticalCount.value, baseline: T.baseline.value }, observed: { said: h.said(made), T900: figuresOf(t), M900_TF: by.get('M900')?.totalFloat, A140_TF: by.get('A140')?.totalFloat, A300_TF: by.get('A300')?.totalFloat, critical: criticalCodesOf(rows).length, baseline: t ? [t.baselineStartDate, t.baselineFinishDate] : null }, detail: problems.join('; ') });
  const before = t?.status;
  const thirty = t ? await claim(P, t.id, 30, { note: 'T900' }) : null;
  const after = t ? await dataOf('pm', `${P}/activities/${t.id}`) : null;
  rec('TAIL.progress', before === WP1.status.live087SCH.tailBeforeProgress.value && thirty?.approved?.status === 200 && after?.status === WP1.status.live087SCH.tailAt30.value && num(after?.pctComplete) === 30, { expected: { before: WP1.status.live087SCH.tailBeforeProgress.value, at30: WP1.status.live087SCH.tailAt30.value }, observed: { before, approve: thirty ? h.said(thirty.approved) : 'no T900', after: after?.status, pct: after?.pctComplete } });
  // the create-side date rules (HR-S2), after the tail so the activity counts above are untouched
  const fpBefore = await fingerprintOf(w.projectId);
  const bad = await send('planner', 'POST', `${P}/activities`, { name: `WP1 proof end before start ${h.STAMP}`, activityCode: 'BAD1', duration: 2, startDate: '2026-06-02', endDate: '2026-06-01', engineerIds: [ctx.people.site] });
  const fpAfter = await fingerprintOf(w.projectId);
  const ms = await send('planner', 'POST', `${P}/activities`, { name: `WP1 proof milestone ${h.STAMP}`, activityCode: 'MS1', duration: 0, isMilestone: true, startDate: '2026-06-01', endDate: '2026-06-01', sortOrder: CODES.length + 1, engineerIds: [ctx.people.site] });
  rec('DATES.endBeforeStart.create', h.is(bad, WP1.dates.endBeforeStartRefused.value) && fpAfter.length === fpBefore.length && ms.status === WP1.dates.zeroDurationCreate.value && dayOf(ms.body?.data?.startDate) === dayOf(ms.body?.data?.endDate), { expected: { endBeforeStart: WP1.dates.endBeforeStartRefused.value, rowsAdded: 0, milestone: WP1.dates.zeroDurationCreate.value, startEqualsEnd: true }, observed: { bad: h.said(bad), rowsAdded: fpAfter.length - fpBefore.length, milestone: h.said(ms), start: dayOf(ms.body?.data?.startDate), end: dayOf(ms.body?.data?.endDate) } });
};

const wConcurrent = async (w) => {
  const { P } = w;
  const r5 = await stage('planner', P, 'xer', F1_FILE());
  const okStage = r5.res.status === 201;
  const reviewed = okStage ? await review(P, r5.revisionId, { label: 'R5' }) : null;
  const leaf = WP1.revisions.activate.concurrent;
  if (!okStage || !reviewed?.ok) {
    obs.concurrent = { gap: true, stage: h.said(r5.res), submit: reviewed ? h.said(reviewed.submitted) : null, approve: reviewed ? h.said(reviewed.approved) : null };
    throw probeSetup('KA.REV.concurrent', `the revision for the probe could not be staged and approved (stage ${h.said(r5.res)}; submit ${reviewed ? h.said(reviewed.submitted) : '-'}; approve ${reviewed ? h.said(reviewed.approved) : '-'} ${reviewed?.approved?.body?.error?.message || ''})`);
  }
  const RV = `${P}/schedule/revisions/${r5.revisionId}`;
  const mapping = await dataOf('pm', `${RV}/mapping`);
  const body = {
    mappings: listOf(mapping.suggestedMappings).map(({ oldActivityId, newActivityKey }) => ({ oldActivityId, newActivityKey })),
    unmappedRemovals: listOf(mapping.unmappedExisting).map((a) => ({ oldActivityId: a.id, reason: `WP1 proof concurrent probe: retired ${h.STAMP}` })),
    comment: `WP1 proof concurrent activation ${h.STAMP}`,
  };
  const [one, two] = await Promise.all([send('pm', 'POST', `${RV}/activate`, body), send('pm', 'POST', `${RV}/activate`, body)]);
  const answers = [one, two].map((r) => h.said(r)).sort();
  const rows = await activitiesOf('pm', P);
  const dup = rows.length - new Set(rows.map(codeOf)).size;
  const observed = { answers, activeRows: rows.length, duplicateCodes: dup };
  obs.concurrent = observed;
  ka('KA.REV.concurrent', { ref: 'CONCURRENT', value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (o) => o.answers.filter((a) => a === '200').length === 1 && o.answers.some((a) => a.startsWith('409')) && o.duplicateCodes === 0, (o) => o.answers.every((a) => a === '200')) });
};

// ── X: the hand-built programme (L124), the T4 networks live, the staged-import guard, the range boundary, the dry run ──
const T4_FILES = {
  // Written as P6 exports it (the late pass capped at the project finish, as files.F3 is; prep §0.2): A's file float 0 h is the
  // critical row the approval needs; the product's own CPM after activation is the HR-S1 observation (A TF 5 today, 0 capped).
  // WP1.T4.FSlead.inputs is in working days (BOOK-5): the file writes them x 8 as P6 hours (A 80 h, B 24 h, lag -64 h).
  FSlead: () => files.programme({ name: 'WP1-T4-FS-lead', wbs: { N: 'T4 FS lead' }, tasks: [{ code: 'A', name: `T4 FS lead A ${h.STAMP}`, wbs: 'N', hours: WP1.T4.FSlead.inputs.value.A * 8 }, { code: 'B', name: `T4 FS lead B ${h.STAMP}`, wbs: 'N', hours: WP1.T4.FSlead.inputs.value.B * 8 }], links: [{ pred: 'A', succ: 'B', type: 'FS', lagHours: WP1.T4.FSlead.inputs.value.lag * 8 }], capLf: true, note: 'plan :525 FS -8 variant, as P6 exports it (A float 0 h)' }),
  FF: () => files.programme({ name: 'WP1-T4-FF', wbs: { N: 'T4 FF' }, tasks: [{ code: 'A', name: `T4 FF A ${h.STAMP}`, wbs: 'N', hours: WP1.T4.FF.inputs.value.A * 8 }, { code: 'B', name: `T4 FF B ${h.STAMP}`, wbs: 'N', hours: WP1.T4.FF.inputs.value.B * 8 }], links: [{ pred: 'A', succ: 'B', type: 'FF', lagHours: WP1.T4.FF.inputs.value.lag * 8 }], note: 'plan :526' }),
  SF: () => files.programme({ name: 'WP1-T4-SF', wbs: { N: 'T4 SF' }, tasks: [{ code: 'A', name: `T4 SF A ${h.STAMP}`, wbs: 'N', hours: WP1.T4.SF.inputs.value.A * 8 }, { code: 'B', name: `T4 SF B ${h.STAMP}`, wbs: 'N', hours: WP1.T4.SF.inputs.value.B * 8 }], links: [{ pred: 'A', succ: 'B', type: 'SF', lagHours: WP1.T4.SF.inputs.value.lag * 8 }], note: 'plan :527' }),
};

/** Stage, review and activate one generated network on X; returns the active rows by code and the answers. */
const activateNetwork = async (P, model, label) => {
  const staged = await stage('planner', P, 'xer', files.xer(model, { filename: `CERT3-WP1-proof-${label}-${h.STAMP}.xer` }));
  const reviewed = staged.revisionId ? await review(P, staged.revisionId, { label }) : null;
  const act = reviewed?.ok ? await activateSuggested(P, staged.revisionId, { label }) : null;
  const rows = act?.res?.status === 200 ? await activitiesOf('pm', P) : [];
  return { staged, reviewed, act, rows, by: byCode(rows), said: { stage: h.said(staged.res), submit: reviewed ? h.said(reviewed.submitted) : null, approve: reviewed ? h.said(reviewed.approved) : null, activate: act ? h.said(act.res) : null } };
};

const xFlow = async () => {
  const { P, id: projectId } = ctx.X;
  // 1. L124 / HR-S8: a hand-built programme, priced in-scope bill fully allocated, then the baseline lock. A programme or bill
  // that cannot be set up is the probe's setup error (R-SET), never 'wrong'.
  await probe('KA.BL.handBuilt (X)', async () => {
    const a = await send('planner', 'POST', `${P}/activities`, { name: `Hand-built A ${h.STAMP}`, activityCode: 'A', wbsCode: 'T4', duration: 5, sortOrder: 0, engineerIds: [ctx.people.planner] });
    const b = a.body?.data?.id ? await send('planner', 'POST', `${P}/activities`, { name: `Hand-built B ${h.STAMP}`, activityCode: 'B', wbsCode: 'T4', duration: 3, sortOrder: 1, engineerIds: [ctx.people.planner], dependencies: [{ predecessorId: a.body.data.id, relationshipType: 'FS', lagDays: 0 }] }) : null;
    const bill = await uploadBoq(P, [{ code: 'X-001', description: 'Hand-built scope', quantity: 50, unit: 'm3', rate: 20, mappingRule: 'in_scope' }], 'hand-built');
    const x001 = (await boqItemsOf(P)).find((i) => i.code === 'X-001') || null;
    const alloc = a.body?.data?.id && x001 ? await allocate(P, { boqItemId: x001.id, activityId: a.body.data.id, quantity: 50, amount: 1000, label: 'X-001 to A' }) : null;
    const setup = { A: h.said(a), B: b ? h.said(b) : null, bill: h.said(bill.res), allocation: alloc ? `${h.said(alloc.created)} / ${h.said(alloc.submitted)} / ${h.said(alloc.approved)}` : null };
    if (!(a.status === 201 && b?.status === 201 && bill.res.status < 300 && alloc?.ok)) {
      obs.handBuilt = { setup };
      throw probeSetup('KA.BL.handBuilt', `the hand-built programme or its allocated bill could not be set up (${json(setup)})`);
    }
    const handBuilt = await send('pm', 'POST', `${P}/schedule/baseline`, {});
    const hbObs = { setup, baseline: h.said(handBuilt), message: String(handBuilt.body?.error?.message || '').slice(0, 200) };
    const hbLeaf = WP1.baseline.handBuilt;
    ka('KA.BL.handBuilt', { ref: 'HR-S8', value: hbLeaf.value, today: hbLeaf.today, observed: hbObs, verdict: judge(hbObs, (o) => o.baseline.startsWith('4') && /import|generat/i.test(o.message) && !o.baseline.endsWith('REVISION_NOT_FOUND'), (o) => o.baseline === '404 REVISION_NOT_FOUND') });
    obs.handBuilt = hbObs;
  });

  // 2. T4 live: FS lead, FF, SF, each staged, approved and activated (the previous network retired by the mapping)
  const fs8 = await activateNetwork(P, T4_FILES.FSlead(), 'T4-FS-lead');
  const B1 = fs8.by.get('B');
  const A1 = fs8.by.get('A');
  rec('T4.live.FSlead', fs8.act?.res?.status === 200 && num(B1?.earlyStart) === WP1.T4.FSlead.B_ES.value && num(B1?.earlyFinish) === WP1.T4.FSlead.B_EF.value, { expected: { B_ES: WP1.T4.FSlead.B_ES.value, B_EF: WP1.T4.FSlead.B_EF.value }, observed: { ...fs8.said, B: figuresOf(B1), A: figuresOf(A1) } });
  await probe('KA.T4.live.FSlead (X)', async () => {
    const fsObs = { A_TF: num(A1?.totalFloat), A_LF: num(A1?.lateFinish), activated: fs8.act?.res?.status === 200 };
    obs.fsLead = fsObs;
    if (!fsObs.activated) throw probeSetup('KA.T4.live.FSlead', `the FS-lead network did not activate (${json(fs8.said)} ${fs8.act?.res?.body?.error?.message || fs8.reviewed?.approved?.body?.error?.message || ''})`);
    ka('KA.T4.live.FSlead', { ref: 'HR-S1', value: WP1.T4.FSlead.A_TF.value, today: WP1.T4.FSlead.A_TF.today, observed: fsObs, verdict: judge(fsObs, (o) => o.A_TF === WP1.T4.FSlead.A_TF.value, (o) => o.A_TF === WP1.T4.FSlead.A_TF.today) });
  });
  // the staged-import guard: a staging import leaves the active activities untouched
  const fpBefore = await fingerprintOf(projectId);
  const countBefore = (await activitiesOf('pm', P)).length;
  const ffStaged = await stage('planner', P, 'xer', files.xer(T4_FILES.FF(), { filename: `CERT3-WP1-proof-T4-FF-${h.STAMP}.xer` }));
  const fpAfter = await fingerprintOf(projectId);
  const countAfter = (await activitiesOf('pm', P)).length;
  rec('IMP.stagedNotApplied', ffStaged.res.status === 201 && JSON.stringify(fpBefore) === JSON.stringify(fpAfter) && countBefore === countAfter && fpBefore.length === countBefore, { expected: 'staged (201); the active activities\' ids, durations, dates and updatedAt unchanged', observed: { stage: h.said(ffStaged.res), rowsBefore: fpBefore.length, rowsAfter: fpAfter.length, unchanged: JSON.stringify(fpBefore) === JSON.stringify(fpAfter), activeBefore: countBefore, activeAfter: countAfter } });
  const ffReview = ffStaged.revisionId ? await review(P, ffStaged.revisionId, { label: 'T4-FF' }) : null;
  const ffAct = ffReview?.ok ? await activateSuggested(P, ffStaged.revisionId, { label: 'T4-FF' }) : null;
  const ffRows = ffAct?.res?.status === 200 ? byCode(await activitiesOf('pm', P)) : new Map();
  const ffProblems = problemsOf({ B_ES: num(ffRows.get('B')?.earlyStart), B_EF: num(ffRows.get('B')?.earlyFinish), A_LF: num(ffRows.get('A')?.lateFinish), A_TF: num(ffRows.get('A')?.totalFloat), B_TF: num(ffRows.get('B')?.totalFloat) }, { B_ES: WP1.T4.FF.B_ES.value, B_EF: WP1.T4.FF.B_EF.value, A_LF: WP1.T4.FF.A_LF.value, A_TF: WP1.T4.FF.A_TF.value, B_TF: WP1.T4.FF.B_TF.value });
  rec('T4.live.FF', ffAct?.res?.status === 200 && ffProblems.length === 0, { expected: { B_ES: WP1.T4.FF.B_ES.value, B_EF: WP1.T4.FF.B_EF.value, A_LF: WP1.T4.FF.A_LF.value, A_TF: WP1.T4.FF.A_TF.value, B_TF: WP1.T4.FF.B_TF.value }, observed: { stage: h.said(ffStaged.res), submit: ffReview ? h.said(ffReview.submitted) : null, approve: ffReview ? h.said(ffReview.approved) : null, activate: ffAct ? h.said(ffAct.res) : null, A: figuresOf(ffRows.get('A')), B: figuresOf(ffRows.get('B')) }, detail: ffProblems.join('; ') });
  const sf = await activateNetwork(P, T4_FILES.SF(), 'T4-SF');
  const sfProblems = problemsOf({ B_ES: num(sf.by.get('B')?.earlyStart), B_EF: num(sf.by.get('B')?.earlyFinish), A_TF: num(sf.by.get('A')?.totalFloat), B_TF: num(sf.by.get('B')?.totalFloat) }, { B_ES: WP1.T4.SF.B_ES.value, B_EF: WP1.T4.SF.B_EF.value, A_TF: WP1.T4.SF.A_TF.value, B_TF: WP1.T4.SF.B_TF.value });
  rec('T4.live.SF', sf.act?.res?.status === 200 && sfProblems.length === 0, { expected: { B_ES: WP1.T4.SF.B_ES.value, B_EF: WP1.T4.SF.B_EF.value, A_TF: WP1.T4.SF.A_TF.value, B_TF: WP1.T4.SF.B_TF.value }, observed: { ...sf.said, A: figuresOf(sf.by.get('A')), B: figuresOf(sf.by.get('B')) }, detail: sfProblems.join('; ') });

  // 3. the range boundary (BOOK-5): the bound itself staged (atMax days x 8 hours), the first whole hour past it refused whole
  const RANGE = WP1.conversion.rangeBoundary;
  const revsBefore = listOf(await dataOf('pm', `${P}/schedule/revisions`)).length;
  const atMaxModel = files.programme({ name: 'WP1-range-max', wbs: { N: 'Range' }, tasks: [{ code: 'R1', name: `Range at max ${h.STAMP}`, wbs: 'N', hours: RANGE.atMax.value * 8 }], links: [], note: 'plan :504 at the bound' });
  const atMax = await stage('planner', P, 'xer', files.xer(atMaxModel, { filename: `CERT3-WP1-proof-range-max-${h.STAMP}.xer` }));
  const atMaxRev = atMax.revisionId ? await revisionOf('pm', P, atMax.revisionId) : null;
  rec('CONV.range.atMax', atMax.res.status === 201 && num(stagedOf(atMaxRev)[0]?.duration) === WP1.conversion.rangeBoundary.atMax.value, { expected: { status: 201, duration: WP1.conversion.rangeBoundary.atMax.value }, observed: { said: h.said(atMax.res), duration: stagedOf(atMaxRev)[0]?.duration } });
  const revsMid = listOf(await dataOf('pm', `${P}/schedule/revisions`)).length;
  const beyondModel = files.programme({ name: 'WP1-range-beyond', wbs: { N: 'Range' }, tasks: [{ code: 'R2', name: `Range beyond ${h.STAMP}`, wbs: 'N', hours: RANGE.beyondMaxInput.value }], links: [], note: 'plan :504 beyond the bound' });
  const beyond = await stage('planner', P, 'xer', files.xer(beyondModel, { filename: `CERT3-WP1-proof-range-beyond-${h.STAMP}.xer` }));
  const revsAfter = listOf(await dataOf('pm', `${P}/schedule/revisions`)).length;
  rec('CONV.range.beyond', h.is(beyond.res, WP1.conversion.rangeBoundary.beyondMax.value) && revsAfter === revsMid && revsMid === revsBefore + 1, { expected: WP1.conversion.rangeBoundary.beyondMax.value, observed: { said: h.said(beyond.res), revisions: { before: revsBefore, afterAtMax: revsMid, afterBeyond: revsAfter }, problems: beyond.res.body?.error?.details?.problems } });

  // 4. the xlsx dry run writes nothing (no revision, no stored document: schedule-import uploads are ProjectDocument rows, H3)
  const docsBefore = await countOf('ProjectDocument', projectId);
  const revsDryBefore = listOf(await dataOf('pm', `${P}/schedule/revisions`)).length;
  const dry = await upload('planner', `${P}/import/xlsx?dryRun=true`, files.scheduleXlsx(files.F1(), { filename: `CERT3-WP1-proof-F1-dry-${h.STAMP}.xlsx`, calendar: 'five_day' }));
  const docsAfter = await countOf('ProjectDocument', projectId);
  const revsDryAfter = listOf(await dataOf('pm', `${P}/schedule/revisions`)).length;
  rec('IMP.dryRun', dry.status === 200 && dry.body?.data?.dryRun === true && dry.body?.data?.staged === false && Number(dry.body?.data?.activityCount) === CODES.length && revsDryAfter - revsDryBefore === WP1.imports.xlsxDryRun.revisionsCreated.value && docsAfter - docsBefore === WP1.imports.xlsxDryRun.documentsCreated.value, { expected: { revisionsCreated: WP1.imports.xlsxDryRun.revisionsCreated.value, documentsCreated: WP1.imports.xlsxDryRun.documentsCreated.value }, observed: { said: h.said(dry), dryRun: dry.body?.data?.dryRun, staged: dry.body?.data?.staged, activityCount: dry.body?.data?.activityCount, revisionsCreated: revsDryAfter - revsDryBefore, documentsCreated: docsAfter - docsBefore } });

  // 5. M4 / HR-S4: F4 (an XER with two PROJECT rows) staged fresh. Value: refused with nothing staged (4xx, no revision, no
  // merged rows) or one project chosen (only that project's rows); today: 201, a draft with both projects' rows merged
  // (WP1.imports.twoProjectXerStaging, counts from files.F4()'s two models).
  const TP = WP1.imports.twoProjectXerStaging;
  const F4 = files.F4();
  const revsF4Before = listOf(await dataOf('pm', `${P}/schedule/revisions`)).length;
  const f4 = await stage('planner', P, 'xer', files.xer(F4, { filename: `CERT3-WP1-proof-F4-${h.STAMP}.xer` }));
  const f4rev = f4.revisionId ? await revisionOf('pm', P, f4.revisionId) : null;
  const revsF4After = listOf(await dataOf('pm', `${P}/schedule/revisions`)).length;
  const f4staged = stagedOf(f4rev);
  const fromEach = Object.fromEntries(F4.map((m) => [m.projectId, f4staged.filter((x) => m.activities.some((a) => a.code === x.p6ActivityId)).length]));
  const f4Obs = { http: f4.res.status, said: h.said(f4.res), revisionStatus: f4rev?.status ?? null, imported: num(f4.res.body?.data?.imported), activityCount: num(f4rev?.activityCount), staged: f4staged.length, fromEach, revisionsCreated: revsF4After - revsF4Before, models: Object.fromEntries(F4.map((m) => [m.projectId, m.activities.length])) };
  const modelRows = F4.reduce((n, m) => n + m.activities.length, 0);
  const chosenOne = (o) => o.http === 201 && Object.entries(TP.value.rowsIfChosen).some(([pid, n]) => o.staged === n && o.fromEach[pid] === n);
  ka('KA.IMP.twoProjectXer', { ref: TP.ref, value: TP.value, today: TP.today, observed: f4Obs, verdict: judge(f4Obs, (o) => (o.http >= 400 && o.http < 500 && o.revisionsCreated === 0) || chosenOne(o), (o) => o.http === TP.today.http && o.revisionStatus === TP.today.revisionStatus && o.staged === TP.today.mergedRows && o.imported === TP.today.imported && o.activityCount === TP.today.activityCount && o.staged === modelRows), detail: `files.F4(): ${F4.map((m) => `${m.projectId} ${m.activities.length}`).join(', ')} = ${modelRows} rows` });
  obs.f4 = f4Obs;
};

// ── 087-IMP: the live end state and the staged snapshots ──────────────────────
const impFlow = async () => {
  const { P } = ctx.deep['087-IMP'];
  const st = ctx.state['087-IMP'];
  const revIdOf = (step) => outOf(st, step).revisionId;
  const snapshot = async (step) => revisionOf('planner', P, revIdOf(step));
  const rowOf = (staged, code, by = 'code') => staged.find((x) => (by === 'name' ? x.name === code : x.p6ActivityId === code)) || null;
  const linkOf = (deps, pred, succ) => deps.find((d) => d.predecessorRef === pred?.draftKey && d.successorRef === succ?.draftKey) || null;

  // T3: F3 active, its staged file figures, the product's CPM after activation (HR-S1)
  const f3rev = await snapshot('import.F3');
  const f3staged = stagedOf(f3rev);
  const T3F = WP1.T3.file;
  const lateProblems = ['A', 'B'].flatMap((c) => { const r = rowOf(f3staged, c); const w = T3F.stagedLate.value[c]; return problemsOf({ lateStart: num(r?.lateStart), lateFinish: num(r?.lateFinish), totalFloat: num(r?.totalFloat) }, w).map((p) => `${c} ${p}`); });
  const f3critical = f3staged.filter((x) => x.isCritical === true).map((x) => x.p6ActivityId);
  rec('T3.file', f3rev?.isActive === true && lateProblems.length === 0 && f3critical.length === T3F.stagedCriticalCount.value && f3critical[0] === 'A', { expected: { stagedLate: T3F.stagedLate.value, critical: T3F.stagedCriticalCount.value }, observed: { active: f3rev?.isActive, status: f3rev?.status, rows: ['A', 'B'].map((c) => { const r = rowOf(f3staged, c); return [c, r?.lateStart, r?.lateFinish, r?.totalFloat, r?.isCritical]; }), critical: f3critical }, detail: lateProblems.join('; ') });
  const rows = await activitiesOf('planner', P);
  const by = byCode(rows);
  const A = by.get('A');
  const B = by.get('B');
  const firmProblems = [...problemsOf(figuresOf(A), { ES: WP1.T3.A.ES.value, EF: WP1.T3.A.EF.value }).map((p) => `A ${p}`), ...problemsOf(figuresOf(B), { ES: WP1.T3.B.ES.value, EF: WP1.T3.B.EF.value, LS: WP1.T3.B.LS.value, LF: WP1.T3.B.LF.value, TF: WP1.T3.B.TF.value }).map((p) => `B ${p}`)];
  rec('T3.live', rows.length === 2 && firmProblems.length === 0, { expected: { A: { ES: WP1.T3.A.ES.value, EF: WP1.T3.A.EF.value }, B: { ES: WP1.T3.B.ES.value, EF: WP1.T3.B.EF.value, LS: WP1.T3.B.LS.value, LF: WP1.T3.B.LF.value, TF: WP1.T3.B.TF.value } }, observed: { rows: rows.length, A: figuresOf(A), B: figuresOf(B) }, detail: firmProblems.join('; ') });
  const got = { LS: num(A?.lateStart), LF: num(A?.lateFinish), TF: num(A?.totalFloat), criticalCount: criticalCodesOf(rows).length };
  const want = { LS: WP1.T3.A.LS.value, LF: WP1.T3.A.LF.value, TF: WP1.T3.A.TF.value, criticalCount: WP1.T3.criticalCount.value };
  const today = { LS: WP1.T3.A.LS.today, LF: WP1.T3.A.LF.today, TF: WP1.T3.A.TF.today, criticalCount: WP1.T3.criticalCount.today };
  const storedHrS1 = outOf(st, 'activate.F3')?.hrS1 || null;
  const liveVerdict = judge(got, (o) => JSON.stringify(o) === JSON.stringify(want), (o) => JSON.stringify(o) === JSON.stringify(today));
  ka('KA.T3.live.hrS1', { ref: 'HR-S1', value: want, today, observed: { live: got, storedVerdict: storedHrS1?.verdict ?? null }, verdict: liveVerdict, detail: `the build recorded ${storedHrS1?.verdict ?? 'no verdict'} at activate.F3` });
  obs.hrS1Live = { got, verdict: liveVerdict };

  // conversion and parity from the staged snapshots (read through GET revision)
  const F2 = files.F2();
  const f2rev = await snapshot('import.F2');
  const f2staged = stagedOf(f2rev);
  const f2deps = depsOf(f2rev);
  const durKeys = Object.keys(WP1.conversion.durations);
  const f2dur = Object.fromEntries(F2.activities.map((a, i) => [durKeys[i], num(rowOf(f2staged, a.code)?.duration)]));
  const wantDur = Object.fromEntries(durKeys.map((k) => [k, WP1.conversion.durations[k].value]));
  rec('CONV.durations', JSON.stringify(f2dur) === JSON.stringify(wantDur) && durKeys.every((k, i) => WP1.conversion.durations[k].value === CLAUDE.XER[`h${F2.activities[i].hours}`].value), { expected: wantDur, observed: f2dur });
  const lagKeys = Object.keys(WP1.conversion.lags);
  const f2lags = Object.fromEntries(F2.links.map((l, i) => [lagKeys[i], num(linkOf(f2deps, rowOf(f2staged, l.pred), rowOf(f2staged, l.succ))?.lagDays)]));
  const wantLags = Object.fromEntries(lagKeys.map((k) => [k, WP1.conversion.lags[k].value]));
  rec('CONV.lags', JSON.stringify(f2lags) === JSON.stringify(wantLags), { expected: wantLags, observed: f2lags });
  const x150 = rowOf(f2staged, 'X150');
  rec('CONV.floatMinus80', num(x150?.totalFloat) === WP1.conversion.totalFloatMinus80h.value, { expected: WP1.conversion.totalFloatMinus80h.value, observed: x150?.totalFloat });
  obs.rounding = { lagMinus12: f2lags['h-12'], h3: f2dur.h3 };
  const F1 = files.F1();
  const identical = (rev, by) => {
    const staged = stagedOf(rev);
    const deps = depsOf(rev);
    const problems = [];
    for (const a of F1.activities) {
      const r = rowOf(staged, by === 'name' ? a.name : a.code, by);
      if (!r) { problems.push(`${a.code} missing`); continue; }
      if (num(r.duration) !== a.days) problems.push(`${a.code} duration ${r.duration} != ${a.days}`);
    }
    for (const l of F1.links) {
      const d = linkOf(deps, rowOf(staged, by === 'name' ? F1.activities.find((a) => a.code === l.pred).name : l.pred, by), rowOf(staged, by === 'name' ? F1.activities.find((a) => a.code === l.succ).name : l.succ, by));
      if (!d) problems.push(`${l.pred}->${l.succ} missing`);
      else if (d.relationshipType !== l.type || num(d.lagDays) !== l.lagDays) problems.push(`${l.pred}->${l.succ} ${d.relationshipType} lag ${d.lagDays}`);
    }
    if (staged.length !== F1.activities.length || deps.length !== F1.links.length) problems.push(`${staged.length} rows, ${deps.length} links`);
    return problems;
  };
  for (const [id, step, by, key] of [['CONV.parity.p6xml', 'import.F1.p6xml', 'code', WP1.parity.p6xml], ['CONV.parity.xlsx', 'import.F1.xlsx', 'code', WP1.parity.xlsx], ['CONV.parity.mspdiF1', 'import.F1.mspdi', 'name', WP1.parity.p6xml]]) {
    const rev = await snapshot(step);
    const problems = identical(rev, by);
    rec(id, problems.length === 0 && rev?.source === outOf(st, step).source, { expected: key.value, observed: { source: rev?.source, status: rev?.status, problems: problems.slice(0, 6) } });
  }
  const f2m = await snapshot('import.F2.mspdi');
  const f2mStaged = stagedOf(f2m);
  const f2mDeps = depsOf(f2m);
  const mDur = F2.activities.map((a) => num(rowOf(f2mStaged, a.name, 'name')?.duration));
  const mLags = F2.links.map((l) => num(linkOf(f2mDeps, rowOf(f2mStaged, F2.activities.find((a) => a.code === l.pred).name, 'name'), rowOf(f2mStaged, F2.activities.find((a) => a.code === l.succ).name, 'name'))?.lagDays));
  const mX150 = rowOf(f2mStaged, F2.activities.find((a) => a.code === 'X150').name, 'name');
  rec('CONV.parity.mspdiF2', JSON.stringify(mDur) === JSON.stringify(WP1.parity.mspdiDurations.value) && JSON.stringify(mLags) === JSON.stringify(WP1.parity.mspdiLags.value) && num(mX150?.totalFloat) === WP1.parity.mspNegativeSlackDays.value, { expected: { durations: WP1.parity.mspdiDurations.value, lags: WP1.parity.mspdiLags.value, X150: WP1.parity.mspNegativeSlackDays.value }, observed: { durations: mDur, lags: mLags, X150: mX150?.totalFloat } });
  const mspObs = { isCritical: mX150?.isCritical ?? null, totalFloat: num(mX150?.totalFloat) };
  ka('KA.CONV.mspNegativeSlackCritical', { ref: 'HR-S3', value: WP1.parity.mspNegativeSlackCritical.value, today: WP1.parity.mspNegativeSlackCritical.today, observed: mspObs, verdict: judge(mspObs, (o) => o.isCritical === WP1.parity.mspNegativeSlackCritical.value, (o) => o.isCritical === WP1.parity.mspNegativeSlackCritical.today) });
  obs.mspCritical = mspObs;

  // the Windows-1252 names and the second calendar ids (HR-S4); the two-project file is staged fresh on X (M4)
  const f5rev = await snapshot('import.F5');
  const f5names = Object.fromEntries(Object.keys(files.F5_NAMES).map((c) => [c, rowOf(stagedOf(f5rev), c)?.name ?? null]));
  // U+FFFD, the replacement character a UTF-8 read leaves for each undecodable Windows-1252 byte (written escaped: H1)
  const f5Obs = { names: f5names, decoded: Object.entries(files.F5_NAMES).every(([c, n]) => f5names[c] === n), replacement: Object.values(f5names).every((n) => typeof n === 'string' && n.includes('\uFFFD')) };
  ka('KA.IMP.windows1252', { ref: 'HR-S4', value: WP1.imports.windows1252.value, today: WP1.imports.windows1252.today, observed: f5Obs, verdict: judge(f5Obs, (o) => o.decoded, (o) => o.replacement) });
  obs.f5 = f5Obs;
  // L9: every staged id as the file names it (WP1.imports.secondCalendarIds) is the value ('recorded (P2)'); the leaf's today
  // (the unknown id falls back to the project calendar) is CPM's, not the snapshot's, so the snapshot cannot show it
  const f6rev = await snapshot('import.F6');
  const f6cal = Object.fromEntries(CODES.map((c) => [c, rowOf(stagedOf(f6rev), c)?.calendarId ?? null]));
  const IDS = WP1.imports.secondCalendarIds.value;
  const f6Obs = { calendars: f6cal, asTheFile: CODES.every((c) => f6cal[c] === IDS[c]) };
  ka('KA.IMP.secondCalendar', { ref: 'HR-S4', value: { judgement: WP1.imports.secondCalendar.value, ids: IDS }, today: WP1.imports.secondCalendar.today, observed: f6Obs, verdict: judge(f6Obs, (o) => o.asTheFile, () => false), detail: 'the staged ids are the same under HR-S4\'s value and today (WP1.imports.secondCalendarIds note); a staged id other than the file\'s is wrong' });

  // the build's imports in the states it left them (every format staged; each later staging supersedes the open draft)
  const list = listOf(await dataOf('planner', `${P}/schedule/revisions`));
  const states = outOf(st, 'revisions.read').states;
  /** plan :500: XER, P6 XML, MSPDI and xlsx, as the API names the sources */
  const PLAN_FORMATS = ['xer', 'p6xml', 'msp', 'xlsx'];
  // the drafts the build staged after F3, in its order (revisions.read): each supersedes the one before (secondImport.openDraft),
  // so all but the last are superseded: drafts - 1 (8 of 9); the last, F1float5, is this proof's to submit and approve
  const drafts = Object.keys(states).filter((step) => step !== 'import.F3');
  const lastDraft = drafts[drafts.length - 1];
  const stateProblems = [];
  const sources = new Set();
  let superseded = 0;
  for (const step of Object.keys(states)) {
    const r = list.find((x) => x.id === revIdOf(step));
    if (!r) { stateProblems.push(`${step} missing`); continue; }
    sources.add(r.source);
    if (r.source !== outOf(st, step).source) stateProblems.push(`${step} source ${r.source} != the build's ${outOf(st, step).source}`);
    if (step === 'import.F3') { if (!r.isActive) stateProblems.push('import.F3 not active'); continue; }
    if (step === lastDraft) { if (!['draft', 'under_review', 'approved'].includes(r.status)) stateProblems.push(`${step} ${r.status}`); continue; }
    if (r.status === WP1.revisions.secondImport.openDraft.value) superseded += 1; else stateProblems.push(`${step} ${r.status} != ${WP1.revisions.secondImport.openDraft.value}`);
  }
  const active = list.filter((r) => r.isActive);
  rec('IMP.formats', stateProblems.length === 0 && PLAN_FORMATS.every((s) => sources.has(s)) && active.length === 1 && active[0].id === revIdOf('import.F3') && superseded === drafts.length - 1, { expected: { formats: PLAN_FORMATS, superseded: drafts.length - 1, active: 'F3', lastDraft, rule: WP1.revisions.secondImport.openDraft.value }, observed: { sources: [...sources], superseded, active: active.map((r) => r.id), problems: stateProblems } });

  // HR-S3: the F1float5 draft submitted for review and sent for approval (refused at HEAD under HR-S3)
  const f15rev = await snapshot('import.F1float5');
  const floats = Object.fromEntries(CODES.map((c) => [c, num(rowOf(stagedOf(f15rev), c)?.totalFloat)]));
  const wantFloat = Object.fromEntries(CODES.map((c) => [c, R.hoursToDays(WP1.revisions.hrS3Reproduction.file.value.totalFloatHours[c])]));
  rec('REV.hrS3.file', JSON.stringify(floats) === JSON.stringify(wantFloat) && stagedOf(f15rev).filter((x) => x.isCritical === true).length === 0, { expected: { floats: wantFloat, critical: 0 }, observed: { floats, critical: stagedOf(f15rev).filter((x) => x.isCritical === true).length, status: f15rev?.status } });
  // the submit and approval are this proof's only write on a deep project: made only when the check is selected
  if (!ACTIVE_IDS.has('KA.REV.hrS3.approve')) return;
  ctx.hrS3Written = true;
  const R15 = `${P}/schedule/revisions/${revIdOf('import.F1float5')}`;
  let hrs3Obs = { statusBefore: f15rev?.status, submit: null, approve: null, failing: null, statusAfter: null };
  if (f15rev?.status === 'draft') hrs3Obs.submit = h.said(await send('planner', 'POST', `${R15}/submit-review`, { comment: `WP1 proof HR-S3 reproduction ${h.STAMP}` }));
  if (f15rev?.status === 'draft' || f15rev?.status === 'under_review') {
    const approved = await send('pm', 'POST', `${R15}/approve`, { comment: `WP1 proof HR-S3 reproduction ${h.STAMP}` });
    hrs3Obs.approve = h.said(approved);
    hrs3Obs.failing = (approved.body?.error?.details?.checks || []).filter((c) => c.severity === 'blocking' && !c.passed && (!Array.isArray(c.requiredFor) || c.requiredFor.includes('approval'))).map((c) => c.key);
  }
  hrs3Obs.statusAfter = (await revisionOf('planner', P, revIdOf('import.F1float5')))?.status ?? null;
  ka('KA.REV.hrS3.approve', { ref: 'HR-S3', value: WP1.revisions.hrS3Reproduction.approve.value, today: WP1.revisions.hrS3Reproduction.approve.today, observed: hrs3Obs, verdict: judge(hrs3Obs, (o) => o.statusAfter === 'approved', (o) => o.approve === '400 SCHEDULE_NOT_READY' && Array.isArray(o.failing) && o.failing.length === 1 && o.failing[0] === 'critical_path') });
  obs.hrS3 = hrs3Obs;
};

// ── 087-SCH: the live end state and the stored moments ────────────────────────
const schFlow = async () => {
  const { P } = ctx.deep['087-SCH'];
  const st = ctx.state['087-SCH'];
  const rows = await activitiesOf('pm', P);
  const by = byCode(rows);
  const T = WP1.tail;
  const t = by.get(IN.tail087SCH.code);
  const tailProblems = problemsOf(figuresOf(t), { ES: T.ES.value, EF: T.EF.value, TF: T.TF.value, es: T.earlyStartDate.value, ef: T.earlyFinishDate.value });
  if (num(by.get('M900')?.totalFloat) !== T.M900_TF.value) tailProblems.push(`M900 TF ${by.get('M900')?.totalFloat}`);
  if (num(by.get('A140')?.totalFloat) !== T.A140_TF.value) tailProblems.push(`A140 TF ${by.get('A140')?.totalFloat}`);
  if (num(by.get('A300')?.totalFloat) !== T.A300_TF.value) tailProblems.push(`A300 TF ${by.get('A300')?.totalFloat}`);
  if (criticalCodesOf(rows).length !== T.criticalCount.value) tailProblems.push(`critical ${criticalCodesOf(rows).length}`);
  if (t && (t.baselineStartDate || t.baselineFinishDate)) tailProblems.push('T900 carries a baseline');
  if (t?.status !== WP1.status.live087SCH.tailBeforeProgress.value) tailProblems.push(`T900 status ${t?.status}`);
  rec('TAIL.live087', rows.length === CODES.length + 1 && tailProblems.length === 0, { expected: { ES: T.ES.value, EF: T.EF.value, TF: T.TF.value, finish: T.earlyFinishDate.value, M900_TF: T.M900_TF.value, A140_TF: T.A140_TF.value, A300_TF: T.A300_TF.value, critical: T.criticalCount.value, status: WP1.status.live087SCH.tailBeforeProgress.value }, observed: { rows: rows.length, T900: figuresOf(t), status: t?.status, M900_TF: by.get('M900')?.totalFloat, A140_TF: by.get('A140')?.totalFloat, A300_TF: by.get('A300')?.totalFloat, critical: criticalCodesOf(rows).length }, detail: tailProblems.join('; ') });
  // the baseline as locked: 14 rows at their early dates, the revision baselined, 459,000.00 allocated, one audit event
  const f1Id = outOf(st, 'import.F1').revisionId;
  const rev = await revisionOf('pm', P, f1Id);
  const locked = rows.filter((a) => a.baselineStartDate && a.baselineFinishDate);
  const equalsEarly = CODES.every((c) => { const a = by.get(c); const [es, ef] = WP1.baseline.covered.equalsEarly.value[c]; return a && num(a.earlyStart) === es && num(a.earlyFinish) === ef && dayOf(a.baselineStartDate) === dayOf(a.earlyStartDate) && dayOf(a.baselineFinishDate) === dayOf(a.earlyFinishDate); });
  const allocations = listOf(await dataOf('pm', `${P}/activity-boq-allocations?includeInactive=true`)).filter((a) => a.status === 'approved' && a.isActive !== false);
  const totalAllocated = allocations.reduce((s, a) => s + h.toCents(a.amount), 0);
  const lockEvents = await baselineLockEvents(P, f1Id);
  rec('BL.covered.087', rev?.status === WP1.baseline.covered.status.value && rev?.isActive === true && locked.length === WP1.baseline.covered.locked.value && equalsEarly && totalAllocated === WP1.baseline.covered.totalAllocated.value && lockEvents.said === '200' && lockEvents.count === WP1.baseline.covered.auditEvents.value, { expected: { status: WP1.baseline.covered.status.value, locked: WP1.baseline.covered.locked.value, totalAllocated: WP1.baseline.covered.totalAllocated.value, auditEvents: WP1.baseline.covered.auditEvents.value }, observed: { status: rev?.status, active: rev?.isActive, locked: locked.length, equalsEarly, totalAllocated, auditEvents: lockEvents } });
  // the stored moments
  const cpmF1 = outOf(st, 'cpm.F1');
  const cpmT2 = outOf(st, 'cpm.T2');
  rec('T1.stored', sameSet(cpmF1.critical || [], WP1.T1.criticalCodes.value) && cpmT2.restored?.M900?.EF === WP1.T2.restored.M900_EF.value && cpmT2.restored?.M900?.date === WP1.T2.restored.M900date.value, { expected: { critical: WP1.T1.criticalCodes.value, restored: { EF: WP1.T2.restored.M900_EF.value, date: WP1.T2.restored.M900date.value } }, observed: { critical: cpmF1.critical, restored: cpmT2.restored } });
  const at20 = typeof cpmT2.at20 === 'object' ? cpmT2.at20 : null;
  rec('T2.stored', Boolean(at20) && at20.M900?.EF === WP1.T2.M900_EF.value && at20.M900?.date === WP1.T2.M900date.value && at20.A140?.TF === WP1.T2.A140.TF.value && at20.A300?.TF === WP1.T2.A300.TF.value && at20.critical === WP1.T2.criticalCount.value && at20.ids === WP1.T2.idsUnchanged.value, { expected: { M900_EF: WP1.T2.M900_EF.value, M900date: WP1.T2.M900date.value, A140_TF: WP1.T2.A140.TF.value, A300_TF: WP1.T2.A300.TF.value, critical: WP1.T2.criticalCount.value, ids: WP1.T2.idsUnchanged.value }, observed: cpmT2.at20, detail: at20 ? '' : 'the build asserted T2 in an earlier attempt and kept the figures in its note only' });
  const actF1 = outOf(st, 'activate.F1');
  rec('REV.mapByCode.stored', Boolean(actF1.suggestion) && CODES.every((c) => actF1.suggestion.matchTypes?.[c] === WP1.revisions.mapByCode.matchType.value) && actF1.suggestion.counts?.suggestedMappings === CODES.length, { expected: { matchType: WP1.revisions.mapByCode.matchType.value, suggested: CODES.length }, observed: actF1.suggestion });
  const ACT = WP1.revisions.activate.record;
  rec('REV.activate.record.stored', actF1.activation?.updated === ACT.updated.value && actF1.activation?.new === ACT.new.value && actF1.activation?.retired === ACT.retired.value && actF1.activation?.dependencyCount === ACT.dependencyCount.value, { expected: { updated: ACT.updated.value, new: ACT.new.value, retired: ACT.retired.value, dependencyCount: ACT.dependencyCount.value }, observed: actF1.activation });
  const actF1b = outOf(st, 'activate.F1b');
  const F1B = WP1.revisions.F1b;
  // L2: the activation record is the build's observation (087-sch.js counts the answer's lists); cpm.F1b's out.M900 is NOT an
  // observation (the step stores the book's F1B.M900_EF after asserting the live earlyFinish), so for M900 the evidence is the
  // step's done status, and the live F1b figures are REV.F1b.live on W. The book is never compared with itself here.
  const cpmF1bDone = st.steps?.['cpm.F1b']?.status === 'done';
  rec('REV.F1b.stored', actF1b.activation?.updated === F1B.record.updated.value && actF1b.activation?.new === F1B.record.new.value && actF1b.activation?.retired === F1B.record.retired.value && actF1b.activation?.dependencyCount === F1B.record.dependencyCount.value && cpmF1bDone, { expected: { record: { updated: F1B.record.updated.value, new: F1B.record.new.value, retired: F1B.record.retired.value, dependencyCount: F1B.record.dependencyCount.value }, cpmF1b: 'done (the build asserted M900 EF 91 live)' }, observed: { activation: actF1b.activation, cpmF1b: st.steps?.['cpm.F1b']?.status }, detail: 'the record is observed; cpm.F1b M900 91 rests on the build step\'s own assertion (its stored figure is the book value, so it is not compared)' });
  rec('BL.noBoq.stored', outOf(st, 'baseline.noBoq').said === WP1.baseline.noBoq.value, { expected: WP1.baseline.noBoq.value, observed: outOf(st, 'baseline.noBoq').said });
  rec('BL.notActivated.stored', outOf(st, 'baseline.notActivated').said === WP1.baseline.notActivated.value, { expected: WP1.baseline.notActivated.value, observed: outOf(st, 'baseline.notActivated').said });
  // L2: the refusal and the unallocated / allocated cents are the build's observations (baseline.unallocated read the refusal's
  // details); the in-scope priced sum is read live from the bill the build uploaded (boq.upload.items: the rows' ids), never from
  // project.terms.contractValue (which 087-sch.js derives from the book). Coverage = allocated / in-scope priced.
  const un = outOf(st, 'baseline.unallocated');
  const U = WP1.baseline.unallocated;
  const billIds = new Set(Object.values(outOf(st, 'boq.upload').items || {}));
  const billRows = listOf(await dataOf('qs', `${P}/boq`)).filter((i) => billIds.has(i.id));
  const inScopeRows = billRows.filter((i) => i.mappingRule === files.MAPPING_RULE_CELL.in_scope && i.isActive !== false);
  const inScopePriced = inScopeRows.reduce((s, i) => s + h.toCents(i.amount), 0);
  const coverage = inScopePriced ? Number(((un.approvedAllocatedCents / inScopePriced) * 100).toFixed(2)) : null;
  rec('BL.unallocated.stored', un.said === U.refusal.value && String(un.message || '').includes('BOQ allocations') && un.inScopeUnallocatedCents === U.unallocatedAmount.value && un.approvedAllocatedCents === U.allocatedAmount.value && billRows.length === billIds.size && inScopePriced === U.inScopePriced.value && coverage === U.coveragePercent.value, { expected: { refusal: U.refusal.value, unallocated: U.unallocatedAmount.value, allocated: U.allocatedAmount.value, inScopePriced: U.inScopePriced.value, coverage: U.coveragePercent.value }, observed: { said: un.said, unallocated: un.inScopeUnallocatedCents, allocated: un.approvedAllocatedCents, billRows: `${billRows.length} of ${billIds.size}`, inScopeRows: inScopeRows.map((i) => i.code), inScopePriced, coverage }, detail: 'refusal and allocation figures: the build\'s observation at its moment; in-scope priced: the live bill (rows of boq.upload, mapping rule required)' });
};

// ── the lanes: 052-SCH-EV and 006-LITE ────────────────────────────────────────
const lanesFlow = async () => {
  const lane = async (code, who, node) => {
    const { P } = ctx.deep[code];
    const sched = await scheduleOf(who, P);
    const rows = listOf(sched?.activities);
    const by = byCode(rows);
    const m900 = by.get('M900');
    const equalsEarly = CODES.every((c) => { const a = by.get(c); return a && a.baselineStartDate && dayOf(a.baselineStartDate) === dayOf(a.earlyStartDate) && dayOf(a.baselineFinishDate) === dayOf(a.earlyFinishDate); });
    return { rows: rows.length, M900_EF: num(m900?.earlyFinish), M900date: dayOf(m900?.earlyFinishDate), A140_TF: num(by.get('A140')?.totalFloat), A300_TF: num(by.get('A300')?.totalFloat), critical: criticalCodesOf(rows).length, status: sched?.revision?.status, equalsEarly, node };
  };
  const l52 = await lane('052-SCH-EV', 'pm052', D2.WP1);
  const s52 = outOf(ctx.state['052-SCH-EV'], 'schedule.cpm.F1');
  const b52 = outOf(ctx.state['052-SCH-EV'], 'schedule.baseline.F1');
  rec('LANES.052', l52.rows === CODES.length && l52.M900_EF === D2.WP1.M900_EF.value && l52.M900date === D2.WP1.M900date.value && l52.A140_TF === D2.WP1.A140_TF.value && l52.A300_TF === D2.WP1.A300_TF.value && l52.critical === D2.WP1.criticalCount.value && l52.status === D2.WP1.baseline.value && l52.equalsEarly && s52.M900EF === D2.WP1.M900_EF.value && s52.A140 === D2.WP1.A140_TF.value && s52.A300 === D2.WP1.A300_TF.value && (s52.critical || []).length === D2.WP1.criticalCount.value && b52.status === D2.WP1.baseline.value,
    { expected: { M900_EF: D2.WP1.M900_EF.value, M900date: D2.WP1.M900date.value, A140_TF: D2.WP1.A140_TF.value, A300_TF: D2.WP1.A300_TF.value, critical: D2.WP1.criticalCount.value, status: D2.WP1.baseline.value }, observed: { live: { ...l52, node: undefined }, stored: { cpm: s52, baseline: b52 } } });
  const l06 = await lane('006-LITE', 'pm006', D3.F1byPm);
  const st06 = ctx.state['006-LITE'];
  const byPm = ['schedule.import.F1', 'schedule.submit.F1', 'schedule.approve.F1', 'schedule.activate.F1', 'schedule.baseline.F1'].map((r) => [r, st06.records?.[r]?.persona, st06.records?.[r]?.status]);
  const stepsOk = byPm.every(([, persona, status]) => persona === 'pm' && status === 'done') && outOf(st06, 'schedule.submit.F1').status === 'under_review' && outOf(st06, 'schedule.approve.F1').status === 'approved' && outOf(st06, 'schedule.baseline.F1').status === 'baselined';
  rec('LANES.006', stepsOk && l06.rows === CODES.length && l06.M900_EF === D3.F1byPm.M900_EF.value && l06.status === 'baselined' && l06.equalsEarly === D3.F1byPm.baselineEqualsEarly.value && outOf(st06, 'schedule.cpm.F1').M900EF === D3.F1byPm.M900_EF.value,
    { expected: { steps: D3.F1byPm.steps.value, M900_EF: D3.F1byPm.M900_EF.value, baselineEqualsEarly: D3.F1byPm.baselineEqualsEarly.value }, observed: { records: byPm, live: { ...l06, node: undefined } } });
};

// ── pure, in process ───────────────────────────────────────────────────────────
const pureFlow = async () => {
  // T1 through the product's own CPM on the F1 network
  const f1 = files.F1();
  const cpm = productCpm(f1.activities.map((a) => ({ id: a.code, duration: a.days })), f1.links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lagDays })), { projectStartDate: START, projectCalendar: 'five_day' });
  const pureProblems = CODES.flatMap((c) => { const u = cpm.updates[c]; const w = WP1.T1[c]; return problemsOf({ ES: u?.earlyStart, EF: u?.earlyFinish, LS: u?.lateStart, LF: u?.lateFinish, TF: u?.totalFloat, isCritical: u?.isCritical, ef: dayFromDate(u?.earlyFinishDate) }, { ES: w.ES.value, EF: w.EF.value, LS: w.LS.value, LF: w.LF.value, TF: w.TF.value, isCritical: w.critical.value, ef: w.earlyFinishDate.value }).map((p) => `${c} ${p}`); });
  rec('T1.pure', pureProblems.length === 0 && cpm.projectEnd === WP1.T1.network.projectEnd.value && WP1.T1.capDoesNotChangeF1.value === true, { expected: { projectEnd: WP1.T1.network.projectEnd.value, capDoesNotChangeF1: WP1.T1.capDoesNotChangeF1.value }, observed: { projectEnd: cpm.projectEnd, critical: Object.values(cpm.updates).filter((u) => u.isCritical).length }, detail: pureProblems.join('; ') });
  // T3 pure
  const t3 = productCpm([{ id: 'A', duration: WP1.T3.inputs.A_duration.value }, { id: 'B', duration: WP1.T3.inputs.B_duration.value }], [{ pred: 'A', succ: 'B', type: 'SS', lag: WP1.T3.inputs.SS_lag.value }]);
  const tA = t3.updates.A;
  const tB = t3.updates.B;
  const t3Problems = [...problemsOf({ ES: tA?.earlyStart, EF: tA?.earlyFinish }, { ES: WP1.T3.A.ES.value, EF: WP1.T3.A.EF.value }).map((p) => `A ${p}`), ...problemsOf({ ES: tB?.earlyStart, EF: tB?.earlyFinish, LS: tB?.lateStart, LF: tB?.lateFinish, TF: tB?.totalFloat }, { ES: WP1.T3.B.ES.value, EF: WP1.T3.B.EF.value, LS: WP1.T3.B.LS.value, LF: WP1.T3.B.LF.value, TF: WP1.T3.B.TF.value }).map((p) => `B ${p}`)];
  rec('T3.pure', t3Problems.length === 0, { expected: { A: { ES: WP1.T3.A.ES.value, EF: WP1.T3.A.EF.value }, B: { ES: WP1.T3.B.ES.value, EF: WP1.T3.B.EF.value, LS: WP1.T3.B.LS.value, LF: WP1.T3.B.LF.value, TF: WP1.T3.B.TF.value } }, observed: { A: tA, B: tB }, detail: t3Problems.join('; ') });
  const got = { LS: tA?.lateStart, LF: tA?.lateFinish, TF: tA?.totalFloat, criticalCount: Object.values(t3.updates).filter((u) => u.isCritical).length };
  const want = { LS: WP1.T3.A.LS.value, LF: WP1.T3.A.LF.value, TF: WP1.T3.A.TF.value, criticalCount: WP1.T3.criticalCount.value };
  const today = { LS: WP1.T3.A.LS.today, LF: WP1.T3.A.LF.today, TF: WP1.T3.A.TF.today, criticalCount: WP1.T3.criticalCount.today };
  ka('KA.T3.pure.hrS1', { ref: 'HR-S1', value: want, today, observed: got, verdict: judge(got, (o) => JSON.stringify(o) === JSON.stringify(want), (o) => JSON.stringify(o) === JSON.stringify(today)), detail: 'the SS backward branch dropped would give LF 5 (neither value nor today)' });
  obs.hrS1Pure = got;
  const F3model = files.F3();
  rec('T3.inputs', R.hoursToDays(IN.F3.A) === WP1.T3.inputs.A_duration.value && R.lagHoursToDays(IN.F3.lagHours) === WP1.T3.inputs.SS_lag.value && R.hoursToDays(IN.F3.B) === WP1.T3.inputs.B_duration.value && F3model.activities.find((a) => a.code === 'A')?.tfHours === WP1.T3.file.A.totalFloatHours.value && F3model.activities.find((a) => a.code === 'B')?.tfHours === WP1.T3.file.B.totalFloatHours.value && F3model.end === WP1.T3.file.projectFinish.value, { expected: { A: WP1.T3.inputs.A_duration.value, lag: WP1.T3.inputs.SS_lag.value, B: WP1.T3.inputs.B_duration.value, fileFloatA: WP1.T3.file.A.totalFloatHours.value, fileFloatB: WP1.T3.file.B.totalFloatHours.value, finish: WP1.T3.file.projectFinish.value }, observed: { A: R.hoursToDays(IN.F3.A), lag: R.lagHoursToDays(IN.F3.lagHours), B: R.hoursToDays(IN.F3.B), fileFloatA: F3model.activities.find((a) => a.code === 'A')?.tfHours, fileFloatB: F3model.activities.find((a) => a.code === 'B')?.tfHours, finish: F3model.end } });
  // T4 pure
  const FSL = WP1.T4.FSlead.inputs.value;
  const fs8 = productCpm([{ id: 'A', duration: FSL.A }, { id: 'B', duration: FSL.B }], [{ pred: 'A', succ: 'B', type: 'FS', lag: FSL.lag }]);
  const ff = productCpm([{ id: 'A', duration: WP1.T4.FF.inputs.value.A }, { id: 'B', duration: WP1.T4.FF.inputs.value.B }], [{ pred: 'A', succ: 'B', type: 'FF', lag: WP1.T4.FF.inputs.value.lag }]);
  const sf = productCpm([{ id: 'A', duration: WP1.T4.SF.inputs.value.A }, { id: 'B', duration: WP1.T4.SF.inputs.value.B }], [{ pred: 'A', succ: 'B', type: 'SF', lag: WP1.T4.SF.inputs.value.lag }]);
  const t4got = { FSlead: { B_ES: fs8.updates.B.earlyStart, B_EF: fs8.updates.B.earlyFinish }, FF: { B_ES: ff.updates.B.earlyStart, B_EF: ff.updates.B.earlyFinish, A_LF: ff.updates.A.lateFinish, A_TF: ff.updates.A.totalFloat, B_TF: ff.updates.B.totalFloat }, SF: { B_ES: sf.updates.B.earlyStart, B_EF: sf.updates.B.earlyFinish, A_TF: sf.updates.A.totalFloat, B_TF: sf.updates.B.totalFloat } };
  const t4want = { FSlead: { B_ES: WP1.T4.FSlead.B_ES.value, B_EF: WP1.T4.FSlead.B_EF.value }, FF: { B_ES: WP1.T4.FF.B_ES.value, B_EF: WP1.T4.FF.B_EF.value, A_LF: WP1.T4.FF.A_LF.value, A_TF: WP1.T4.FF.A_TF.value, B_TF: WP1.T4.FF.B_TF.value }, SF: { B_ES: WP1.T4.SF.B_ES.value, B_EF: WP1.T4.SF.B_EF.value, A_TF: WP1.T4.SF.A_TF.value, B_TF: WP1.T4.SF.B_TF.value } };
  rec('T4.pure', JSON.stringify(t4got) === JSON.stringify(t4want), { expected: t4want, observed: t4got });
  const fsTf = { A_TF: fs8.updates.A.totalFloat };
  ka('KA.T4.pure.FSlead', { ref: 'HR-S1', value: WP1.T4.FSlead.A_TF.value, today: WP1.T4.FSlead.A_TF.today, observed: fsTf, verdict: judge(fsTf, (o) => o.A_TF === WP1.T4.FSlead.A_TF.value, (o) => o.A_TF === WP1.T4.FSlead.A_TF.today) });
  // the mixed calendar
  const MIX = WP1.mixedCalendar.inputs.value;
  const mixed = productCpm([{ id: 'A', duration: MIX.A.duration, calendarId: MIX.A.calendar }, { id: 'B', duration: MIX.B.duration, calendarId: MIX.B.calendar }], [{ pred: 'A', succ: 'B', type: MIX.link.type, lag: MIX.link.lag }], { projectStartDate: START, projectCalendar: MIX.A.calendar });
  const aFinish = dayFromDate(mixed.updates.A.earlyFinishDate);
  const bStart = dayFromDate(mixed.updates.B.earlyStartDate);
  rec('CYC.mixed.A', aFinish === WP1.mixedCalendar.A_finishDate.value, { expected: WP1.mixedCalendar.A_finishDate.value, observed: aFinish });
  const bObs = { bStart, weekday: bStart ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${bStart}T00:00:00Z`).getUTCDay()] : null };
  ka('KA.CYC.mixed.B', { ref: 'HR-S5', value: `on or after ${WP1.mixedCalendar.B_startNoEarlierThan.value} (or a 400 refusal of the differing calendar)`, today: `${WP1.mixedCalendar.B_startNoEarlierThan.today} (${WP1.mixedCalendar.todayWeekday.value})`, observed: bObs, verdict: judge(bObs, (o) => Boolean(o.bStart) && o.bStart >= WP1.mixedCalendar.B_startNoEarlierThan.value, (o) => o.bStart === WP1.mixedCalendar.B_startNoEarlierThan.today && o.weekday === WP1.mixedCalendar.todayWeekday.value) });
  obs.mixed = bObs;
  // the status boundaries
  // eslint-disable-next-line global-require
  const { deriveActivityStatus } = require('../../../src/utils/activity-status');
  const now = new Date(WP1.status.now.value);
  const cases = { pct0_future: [0, '2026-07-01'], pct0_5_future: [0.5, '2026-07-01'], pct99_99_future: [99.99, '2026-07-01'], pct100_past: [100, '2026-01-01'], pct40_endJustBeforeNow: [40, '2026-05-31T23:59:59.000Z'], pct0_past: [0, '2026-05-01'], pct0_endEqualsNow: [0, '2026-06-01T00:00:00.000Z'], pct40_endEqualsNow: [40, '2026-06-01T00:00:00.000Z'] };
  const statusGot = Object.fromEntries(STATUS_BOUNDARY_KEYS.map((k) => [k, cases[k] ? deriveActivityStatus(cases[k][0], cases[k][1], now) : 'no case']));
  const statusWant = Object.fromEntries(STATUS_BOUNDARY_KEYS.map((k) => [k, WP1.status.boundaries[k].value]));
  const claudeOk = deriveActivityStatus(0, '2026-07-01', now) === CLAUDE.autoStatus.pct0.value && deriveActivityStatus(50, '2026-07-01', now) === CLAUDE.autoStatus.pct50.value && deriveActivityStatus(100, '2026-01-01', now) === CLAUDE.autoStatus.pct100.value && deriveActivityStatus(40, '2026-05-01', now) === CLAUDE.autoStatus.pastEndBelow100.value;
  rec('STATUS.pure', JSON.stringify(statusGot) === JSON.stringify(statusWant) && claudeOk, { expected: statusWant, observed: statusGot });
};

// ── confirm-first classification from this run's observations ─────────────────
const confirmFirstFlow = () => {
  const v = (id) => knownAnswers[id]?.verdict ?? null;
  const r = (id) => records[id]?.verdict ?? null;
  const split = (pairs) => {
    const present = []; const absent = []; const gap = [];
    for (const [name, state] of pairs) (state === 'present' ? present : state === 'absent' ? absent : gap).push(name);
    return { present, absent, gap };
  };
  const kaState = (id) => (v(id) === 'today' ? 'present' : v(id) === 'value' ? 'absent' : 'gap');
  const recState = (id, fixedWhen = 'PASS') => (r(id) === null ? 'gap' : r(id) === fixedWhen ? 'absent' : 'present');
  cf('CF.1.milestones', { ...split([['approval with M900 start = finish', recState('REV.approve.pm')], ['readiness date_sanity', recState('DATES.readiness')], ['PATCH M900 name', recState('DATES.renameM900')], ['baseline with M900', recState('BL.covered.live')]]), detail: `approve ${obs.approveF1?.said}; rename ${obs.rename?.said}; readiness ${json(obs.readiness)}` });
  cf('CF.2.lfNotCapped', { ...split([['live 087-IMP F3 A LF/TF', kaState('KA.T3.live.hrS1')], ['in process SS', kaState('KA.T3.pure.hrS1')], ['FS lead A TF (pure)', kaState('KA.T4.pure.FSlead')], ['FS lead A TF (live X)', kaState('KA.T4.live.FSlead')]]), detail: `live ${json(obs.hrS1Live)}; pure ${json(obs.hrS1Pure)}` });
  cf('CF.3.stagedFloat', { ...split([['F1float5 approval', kaState('KA.REV.hrS3.approve')], ['MSP negative slack not critical', kaState('KA.CONV.mspNegativeSlackCritical')]]), detail: `${json(obs.hrS3)}; ${json(obs.mspCritical)}` });
  cf('CF.4.activationCode', { ...split([['mapping by code', recState('REV.mapByCode.live')], ['activityCode kept', recState('REV.activate.keepsCode')], ['budget kept', recState('REV.activate.keepsBudget')]]), detail: json(obs.activationKept) });
  cf('CF.5.handBuilt', { ...split([['hand-built baseline', kaState('KA.BL.handBuilt')]]), detail: json(obs.handBuilt) });
  cf('CF.6.filePercent', { ...split([['search', kaState('KA.STATUS.A200.search')], ['lookahead', kaState('KA.STATUS.A200.lookahead')], ['schedule export XER', kaState('KA.STATUS.A200.exportXer')], ['assistant retrieval', kaState('KA.STATUS.A200.assistant')]]), detail: json(obs.surfaces, 900) });
  cf('CF.7.startChange', { ...split([['start moved before the baseline: no recalculation', kaState('KA.DATES.startMoved.before')], ['start moved after the baseline: accepted and the baseline re-dated', kaState('KA.DATES.startMoved.after')], ['calendar changed before the baseline: no recalculation', kaState('KA.DATES.calendarChange.before')], ['calendar changed after the baseline: accepted and the baseline re-dated', kaState('KA.DATES.calendarChange.after')]]), detail: `start ${json(obs.startMovedBefore)}; ${json(obs.startMovedAfter)}; calendar ${json(obs.calendarChangeBefore)}; ${json(obs.calendarChangeAfter)}` });
  cf('CF.8.mixedCalendars', { ...split([['seven-day successor dated before the five-day finish', kaState('KA.CYC.mixed.B')]]), detail: json(obs.mixed) });
  cf('CF.9.twoProjectUtf8Rounding', { ...split([['two-project XER merged', kaState('KA.IMP.twoProjectXer')], ['Windows-1252 read as UTF-8', kaState('KA.IMP.windows1252')], ['rounding -12 h -> -1, 3 h -> 0 (HARD as the plan states it; HR-S4 would change it)', obs.rounding ? (obs.rounding.lagMinus12 === -1 && obs.rounding.h3 === 0 ? 'present' : 'absent') : 'gap']]), detail: `${json(obs.f4)}; ${json(obs.f5)}; rounding ${json(obs.rounding)}` });
  cf('CF.10.concurrent', { ...split([['two activations both accepted', obs.concurrent?.gap ? 'gap' : kaState('KA.REV.concurrent')]]), detail: json(obs.concurrent) });
};

// ── the run ────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log(`wp1-schedule-proof: ${ACTIVE.length} of ${EXPECTED_CHECKS} checks active${ONLY ? ` (--only=${[...ONLY].join(',')})` : ''}${SKIP ? ` (--skip=${[...SKIP].join(',')})` : ''}${PROJECT_FILTER ? ` (--project=${PROJECT_FILTER})` : ''}; sections ${[...selectedSections].join(' ')}; deep projects ${NEED_DEEP.join(', ') || 'none'}; in process\n`);
  if (ACTIVE.length !== CHECKS.length) console.log(`not exercised in this run (filtered out): ${CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id).join(', ')}\n`);
  await setup();
  const on = (section) => selectedSections.has(section);
  if (NEED_W) await h.section('W: the F1 programme over a hand-built A100/A110', wFlow);
  if (NEED_X) await h.section('X: L124, the T4 networks, the staged-import guard, the range boundary, the dry run, F4', xFlow);
  if (runsOn('087-IMP')) await h.section('087-IMP: the live end state and the staged snapshots', impFlow);
  if (runsOn('087-SCH') || runsOn('stored:087-SCH')) await h.section('087-SCH: the live end state and the stored moments', schFlow);
  if (on('LANES')) await h.section('052-SCH-EV and 006-LITE', lanesFlow);
  if (runsOn('pure')) await h.section('in process: calculateCpm, the generators, deriveActivityStatus', pureFlow);
  if (on('CF')) await h.section('confirm-first classification', async () => confirmFirstFlow());
};

/** L8: the per-check records, the known answers, the confirm-first classifications and the tally, written in cleanup (always). */
const recordObservations = () => {
  // a record of a filtered-out check (its flow ran for another selected check) is kept, marked unregistered, and never tallied
  for (const [id, r] of Object.entries(records)) r.registered = ACTIVE_IDS.has(id);
  for (const [id, k] of Object.entries(knownAnswers)) k.registered = ACTIVE_IDS.has(id);
  h.observe('checks', records);
  h.observe('knownAnswers', knownAnswers);
  h.observe('confirmFirst', confirmFirst);
  const known = Object.entries(knownAnswers).filter(([id]) => ACTIVE_IDS.has(id)).map(([, k]) => k);
  const tally = {
    expectedChecks: EXPECTED_CHECKS,
    active: ACTIVE.length,
    recorded: Object.keys(records).length,
    activeRecorded: Object.keys(records).filter((id) => ACTIVE_IDS.has(id)).length,
    pass: Object.entries(records).filter(([id, r]) => ACTIVE_IDS.has(id) && r.verdict === 'PASS').length,
    fail: Object.entries(records).filter(([id, r]) => ACTIVE_IDS.has(id) && r.verdict === 'FAIL').length,
    knownAnswers: { value: known.filter((k) => k.verdict === 'value').length, today: known.filter((k) => k.verdict === 'today').length, wrong: known.filter((k) => k.verdict === 'wrong').length },
    confirmFirst: Object.fromEntries(Object.entries(confirmFirst).map(([id, c]) => [id, c.classification])),
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
  };
  h.observe('tally', tally);
  console.log(`\ntally: ${tally.pass} pass, ${tally.fail} fail of ${tally.activeRecorded} recorded (${tally.active} active); known answers: ${tally.knownAnswers.value} value, ${tally.knownAnswers.today} today (BLOCKED), ${tally.knownAnswers.wrong} wrong`);
  console.log(`confirm-first: ${Object.entries(confirmFirst).map(([id, c]) => `${id} ${c.classification}`).join('; ') || 'not classified'}`);
};

const cleanup = async () => {
  const notes = [];
  for (const step of ctx.cleanup.reverse()) {
    try { notes.push(String(await step())); } catch (error) { notes.push(`cleanup failed: ${error.message}`); }
  }
  if (!ctx.cleanup.length) notes.push('nothing to remove');
  // Verify through the API listing as 087's PM: no live throwaway of any run of this proof is left.
  if (ctx.sessions.pm) {
    try {
      const page = await get('pm', `/projects?limit=100&includeArchived=true&search=${encodeURIComponent('CERT3 WP1 schedule proof')}`);
      const mine = listOf(page.body?.data).filter((p) => String(p.name || '').startsWith('CERT3 WP1 schedule proof'));
      const live = mine.filter((p) => !p.archivedAt);
      notes.push(`throwaway check (GET /projects as 087 PM, ${h.said(page)}): ${mine.length} 'CERT3 WP1 schedule proof' projects, ${live.length} live${live.length ? ` (${live.map((p) => `${p.name} ${p.id}`).join(', ')})` : ''}`);
      h.observe('throwawayCheck', { said: h.said(page), total: mine.length, live: live.map((p) => ({ id: p.id, name: p.name })) });
    } catch (error) {
      notes.push(`throwaway check failed: ${error.message}`);
    }
  }
  if (ctx.hrS3Written) notes.push('087-IMP residue: the F1float5 draft submitted for review and sent for approval by this proof (refused 400 SCHEDULE_NOT_READY at HEAD under HR-S3, so it stays under_review; approved after an HR-S3 fix; moment map: WP1.revisions.hrS3Reproduction.approve)');
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

h.run({ main, cleanup });
