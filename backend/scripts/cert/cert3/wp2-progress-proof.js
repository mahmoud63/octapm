'use strict';

/**
 * WP-2 (Progress, PC-6) primary proving run: the known-answer run of plan
 * §4 WP-2 on the cert3d population (docs/certification/OCTAPM_CERT3_PLAN.md
 * §4 WP-2 :572-624, §3.2 087-SCH :424, 087-FLD :430, 052 :443, §5 HR-S9 and
 * HR-P1..P4 :1036-1040, HR-Q1/HR-Q2 :1047-1048, HR-X1 :1052, §0.1 :47-52,
 * §6.1 E3/E6/E8, §6.2 WP-2 guards :1146; plan lines as numbered at b75ee67).
 * Preparation C:\Temp\octapm-cert\scratch\wp2\WP2-PREP.md; the BINDING
 * integration-owner adjudication C:\Temp\octapm-cert\scratch\wp2\WP2-ADJUDICATION.md
 * (Q1-Q12); moment map build/MOMENT-MAP.md (rows 31-42, 183, 229-244); answer
 * book answers/schedule.js (WP2.*, D2.WP2.*) AFTER the WP-2 book patch
 * (C:\Temp\octapm-cert\scratch\wp2\book\book-insert.js; the proof refuses to
 * load without it).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp2-progress-proof.js [--only=T1,QTY] [--project=P] [--skip=D2]
 *
 * Filters (sections are the id prefixes: S SETUP T1 T2 T3 RULES SINGLE T4 FLD
 * DR T5 QTY Q320 T6 METHOD T7 VIEW SCH BULK IMP D2 CF): --only=<sections>
 * keeps those sections, --project=<P|087-SCH|087-FLD|052-SCH-EV|static> the
 * sections that touch that project, --skip=<sections> drops sections.
 * Selecting CF selects every section CF classifies from (T3 T4 T6 T7 Q320
 * QTY). The setup checks (S.*) always run, but only for the projects and state
 * files the selected checks need; a filtered-out check is neither registered
 * nor recorded. The P choreography runs whole whenever one selected check runs
 * on P (its steps depend on each other, as WP-1's W flow).
 *
 * In process (CERT_INPROCESS=1, through the lock runner only) on the
 * certification database. Every expected figure is an answer-book key (A10):
 * a disagreement is reported, never papered over. Deep projects are resolved
 * by their exact names through the API as each company's PM (exactly one live
 * project each); build state files are read only for moment figures
 * (C:\Temp\octapm-cert\state\cert3\<code>.json, steps[].out), with every
 * stored unit named explicitly (STORED_UNITS: 087-SCH stores the EV report's
 * currency units, 052 stores units for T1/T3/T4 and cents for the quantity
 * steps; never guessed, adjudication finding 7).
 *
 * WHERE EACH CHECK RUNS (the CHECKS table carries it per id):
 *   P        a throwaway project of company 087 this run creates and archives
 *            (WP2-PREP §5.1; the analogue of WP-1's W): F1 imported by the
 *            planner, approved and activated by the PM; the site engineer on
 *            every activity but A330; bill S-001..S-008 (QS), the five
 *            allocations (S-006 left unallocated: 387,000.00); 087-SCH's
 *            progress methods; a site photo; the form ITP T-HOLD. Run order
 *            (binding, WP2-PREP §0 fact 9, §5.1; WP2ADJ Q1, Q7 G6/G23):
 *            SETUP, T1, T2, T3 (+RULES, CF.HRX1/HRP3 probes), T4 (pending,
 *            failed, reopen-pass, HR-Q1 probes, signature, recurrence), DR,
 *            QTY (A310), Q320, BULK (before T6), T5, T6 (+HR-P2 probe),
 *            METHOD.stands, IMP (after the quantity chain), T4 void, T7 last.
 *   087-SCH  live: the six quantity figures of S-003, the withheld view
 *            (087-EXTRAS T-NOBOQ member), the installed sum, a replay that
 *            writes nothing, A130's open hold; stored: the quantity moments
 *            and the progress-file dry run.
 *   087-FLD  live: the hold points after the build's template edit (HR-Q2);
 *            stored: the before-edit moment.
 *   052-SCH-EV  stored moments only (WP2ADJ Q9; no live end state).
 *   static   the single-writer source scan.
 *
 * KNOWN ANSWERS (KA.*): a leaf with a `today` under an undecided HR rule is
 * judged value (pass), today (BLOCKED / known, with the ref, counted
 * separately, never exit 2) or wrong (fail). A decided rule's today fails.
 * A probe whose own setup fails is a setup error (exit 1), never 'wrong'
 * (R-SET): each such probe runs in its own section.
 * CONFIRM-FIRST (CF.*): the items of plan :617-624, classified from this
 * run's observations as CONFIRMED / PARTIAL / REJECTED / TEST GAP. A decided
 * rule's item (HR-Q1, HR-P1, HR-X1) must be REJECTED, so it is a defect check
 * (RED at HEAD); an undecided rule's item is reported (HR-P4 stays reported
 * until the owner decides, WP2ADJ Q11; EXPECTED BEHAVIOUR is the owner's call).
 *
 * DECIDED RULES FIXED LATER IN WP-2 (owner §0.1 :47-52; WP2ADJ Q2, Q3). Their
 * checks expect the DECIDED behaviour and are RED at HEAD until the approved
 * fix lands. Each is a 'defect' check of its rule and records FAIL (exit 2,
 * DEFECT_PRESENT), never a setup error: no flow throws on a decided answer,
 * before or after the fix. Only what the decided rule fixes is judged; every
 * field the fix plan's contract names is 'contract pending plan review'
 * (CONTRACT below, null until the adjudicated plan fills it: G12 HR-P1, G13
 * HR-Q1, G19 HR-X1; no contract is guessed, WP2ADJ Q2).
 *
 *   check                        rule   judged now (decided behaviour)                 contract pending (null)              HEAD
 *   T4.hrQ1.inProgressPass       HR-Q1  approval refused 409, A200 stays 0              refusal code (book: ITP_HOLD_POINT_OPEN)  RED: 200, A200 10% official
 *   T4.hrQ1.na                   HR-Q1  approval refused 409, A100 stays 0              refusal code; how the approver releases na  RED: 200, A100 10% official
 *   T6.olderLower.refusal        HR-P1  older s1 after newer s2: refused 409            refusal code                         RED: 200
 *   T6.olderLower.official       HR-P1  A330 stays at s2's 60                            -                                    RED: 30
 *   Q320.typed40.reasonRequired  HR-P1  plain approval of a lower figure refused (4xx),  status/code; where the reason is given  RED: 200, lowered silently
 *                                       A320 official not lowered
 *   CF.HRQ1                      HR-Q1  REJECTED                                         -                                    RED: CONFIRMED
 *   CF.HRP1                      HR-P1  REJECTED                                         -                                    RED: CONFIRMED
 *   CF.HRX1                      HR-X1  REJECTED                                         what text-only evidence answers in the  RED: CONFIRMED
 *                                                                                        transition (batch plan, G19)
 *
 * Q320.typed40.pct is judged after the decided path: at HEAD the plain
 * approval makes 6.667 official (green); after the HR-P1 fix the proof needs
 * CONTRACT['HR-P1'].lowerFigureCorrection, and until it is filled the check
 * (and the EV chain after it) fails with 'contract pending', exit 2, not 1.
 *
 * Expected at HEAD on cert3d (after the book patch): 157 checks + G.5xx;
 * 8 FAIL (the table above), exit 2; known answers BLOCKED: KA.T4.retroactive
 * (HR-Q2), KA.T6.methodBypass (HR-P2), KA.T7.retired (HR-S9); CF reported
 * CONFIRMED: HRQ2, HRP2, HRS9, HRP3, HRP4, replayPayload; harness provisional
 * classification CONFIRMED (8 of 8 defect checks).
 *
 * Adjudication applied (WP2ADJ): Q1 the live progress import runs on P after
 * T1 and the quantity chain (087-SCH keeps only the stored dry run; the
 * moment map's deviation section records it when the proof lands); Q4 the
 * negative entry is 400 VALIDATION_ERROR naming the field, plus the in-process
 * service probe QTY.entry.negative.service (QUANTITY_NEGATIVE); Q5 METHOD.stands
 * on A220 is the catcher of the method-stands mutation; Q6 no PERSONA.* checks
 * (E8 rests on the WP-0 permission probe); Q8 QTY.entry.negative.service IN,
 * CONC.approveTwice OUT (T1.approveAgain catches the idempotent-approval
 * mutation), DR.fld.openHold OUT; Q9 052 stored moments only (no D2.live);
 * Q11 HR-Q2, HR-P2, HR-S9, HR-P3, HR-P4 stay known answers / reported.
 * EXPECTED_CHECKS: WP2-PREP's 164 - 7 PERSONA.* - D2.live + QTY.entry.negative.service = 157.
 *
 * The import sends the generated progress XER (files.progressXer of the
 * book's inputs.progressFile); IMP.file proves its bytes equal to the file the
 * 087-SCH build saved (state\cert3\files\087-SCH\CERT3-087-SCH-progress.xer)
 * and to the build's stored sha256 (MOMENT-MAP row 42).
 *
 * The count of checks is fixed before the first run (EXPECTED_CHECKS). Exit 0
 * pass / 2 a check failed / 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp2-progress-proof.json (every check with
 * its plan reference, answer-book key, expected, observed and verdict in
 * observations.checks; the KA verdicts in observations.knownAnswers; the CF
 * classifications in observations.confirmFirst; the decided-rule table in
 * observations.decidedRules; all written in cleanup, so a setup error still
 * carries what was observed).
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');
const files = require('./build/files');
const SCHEDULE = require('./answers/schedule');

const { WP1, WP2, D2 } = SCHEDULE;
const IN = SCHEDULE.inputs;

// ── the WP-2 book patch must be applied (G1-G23 leaves; WP2ADJ Q7) ───────────
const leafAt = (key) => key.split('.').reduce((node, k) => (node && typeof node === 'object' ? node[k] : undefined), SCHEDULE);
const WP2_PATCH_LEAVES = [
  'WP2.T2.siteOnA330ActivityIds', 'WP2.T2.siteOnA330SubmissionsDelta', 'WP2.T3.withDocument.evidence', 'WP2.T4.probes.retroactiveBeforeEdit',
  'WP2.dailyReport.holdInstance', 'WP2.dailyReport.release', 'WP2.dailyReport.approver', 'WP2.T6.methodBypassInputs',
  'WP2.methodStands.approve', 'WP2.methodStands.detailsSubmissionId', 'WP2.methodStands.official', 'WP2.quantitiesA310.entryRefusals.negativeService',
  'WP2.quantitiesA310.dailyLog.evReportPct', 'WP2.quantityView.withoutBoqRead.itemRoute', 'WP2.bulk.mixedBatch.a330SubmissionsDelta',
  'WP2.importProgress.site.reuploadRows', 'WP2.importProgress.pm.A110approvesPending', 'WP2.importProgress.pm.projectEvAfter', 'WP2.endState087SCH.A130openHolds',
];
{
  const missing = WP2_PATCH_LEAVES.filter((key) => { const leaf = leafAt(key); return !leaf || typeof leaf !== 'object' || !('value' in leaf); });
  if (missing.length) throw new Error(`answers/schedule.js carries no WP-2 leaf ${missing.join(', ')}: apply the WP-2 book patch (C:/Temp/octapm-cert/scratch/wp2/book/book-insert.js) first`);
  if (WP2.rules.rejectWithoutReason.value !== '400 VALIDATION_ERROR' || WP2.quantitiesA310.entryRefusals.negative.value !== '400 VALIDATION_ERROR' || WP2.mutations.dropMethodStands.value !== 'METHOD.stands red') {
    throw new Error('answers/schedule.js carries the pre-WP-2 values of WP2.rules.rejectWithoutReason / entryRefusals.negative / mutations.dropMethodStands (G1, G2, G3): apply the WP-2 book patch first');
  }
}

const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const STATE_DIR = 'C:/Temp/octapm-cert/state/cert3';
const CODES = IN.F1.tasks.map((t) => t[0]);
const START = IN.start;
const DAY_MS = 86_400_000;
const METHODS = IN.methods087SCH;
const UNIT = METHODS.A310.unit; // m2 (A310 and A320 are measured in m2)
const BOQ_ROWS = files.boqRows.sch087();
const ALLOC = WP2.setup.allocations.value; // cents per activity: A110 60,000; A120 30,000; A130 90,000; A310 135,000; A320 72,000
const PROGRESS_FILE = IN.progressFile;

const DEEP = {
  '087-SCH': { company: '087', name: 'CERT3 Programme (087-SCH)' },
  '087-FLD': { company: '087', name: 'CERT3 Field & quality (087-FLD)' },
  '052-SCH-EV': { company: '052', name: 'CERT3 Programme and EV (052-SCH-EV)' },
};
const OUTSIDER = '088';

// ── CLI ───────────────────────────────────────────────────────────────────────
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const setOf = (text) => (text ? new Set(text.split(',').map((s) => s.trim()).filter(Boolean)) : null);
const ONLY = setOf(argOf('only'));
const SKIP = setOf(argOf('skip'));
const PROJECT_FILTER = argOf('project');

// ── the fixed list of checks: id, section, plan reference, answer-book key, where it runs ──
// where: 'P' (the throwaway project of 087) | '087-SCH' | '087-FLD' | 'stored:<code>' | 'static' | 'setup'
// A known-answer check (KA.<section>.*) belongs to the section it judges; the confirm-first items form their own section (CF).
// The setup checks (S.*) carry no answer-book key (bookKey null) and where 'setup' (WP-1 L5).
// <CHECKS>
const L = (...lines) => `${PLAN_DOC}:${lines.join(',')}`;
const C = (id, planRef, bookKey, where, description) => ({ id, section: id.startsWith('KA.') ? id.split('.')[1] : id.split('.')[0], planRef, bookKey, where, description });
const CHECKS = [
  C('S.companies', L('371-416'), null, 'setup', '087 and 088 (and 052 for the stored lane) resolve, exactly one certification organisation each; the personas the selected checks need sign in (087 pm, planner, qs, site, quality; 088 pm; 052 pm)'),
  C('S.state', L('453-472'), null, 'setup', 'the build state files the selected checks read are present with their WP-2 steps done (087-SCH, 087-FLD, 087-EXTRAS, 052-SCH-EV), and the 087-EXTRAS T-NOBOQ member signs in as the state names them'),
  C('S.projects', L('418-452'), null, 'setup', 'the deep projects the selected checks read resolve by exact name, exactly one live each, matching the state files'),
  C('S.throwaway', L(586), null, 'setup', 'P is created by the 087 PM (start 2026-01-05, five_day, EGP) with the planner, the QS, the site engineer and the quality engineer on its team'),
  C('S.programme', L(586), null, 'setup', 'F1 staged by the planner, submitted, approved and activated by the PM on the empty P (mappings []): 14 activities whose code is the file code; the site engineer on every activity but A330'),
  C('S.bill', L(586), null, 'setup', 'S-001..S-008 uploaded by the QS (in-scope priced 459,000.00); six allocations of the five activities created and submitted by the planner, approved by the QS; S-006 left unallocated; the progress methods configured by the planner'),
  C('S.photo', L(590), null, 'setup', 'a site photo uploaded by the site engineer (POST /site-reporting/uploads): its documentId, key and fileName read from the answer'),
  C('S.itp', L(591), null, 'setup', 'the quality engineer\'s template T-HOLD (type itp, one pass_fail hold item) and instance #1 on A130, scheduled'),
  C('S.files', L(610), null, 'setup', 'the progress XER (A110 70, A130 50, A310 30) and F1r (F1 without A140) generated from the answer book'),

  C('SETUP.allocations', L(586), 'WP2.setup.allocations', 'P', 'approved allocations per activity: A110 60,000 / A120 30,000 / A130 90,000 / A310 135,000 / A320 72,000 (387,000.00); S-006 unallocated'),
  C('SETUP.planned', L(586, 606), 'WP2.setup.A310planned', 'P', 'GET /activities/:id/quantities: A310 planned 900 m2 and A320 600 m2, method quantity, basis approved_allocations'),
  C('SETUP.methods', L(586), 'WP2.setup.methods', 'P', 'the progress methods read back (A110 percent, A120 percent + evidence, A310/A320 quantity m2, A210 weights 20/30/50, A230 inspection); A300 and A330 not configured'),
  C('SETUP.evBefore', L(586), 'WP2.setup.evBefore', 'P', 'EV report 0.00; reference hash H0 (sorted-key JSON without reporting.asOfDate)'),
  C('SETUP.openList', L(591), 'WP2.T4.openList', 'P', 'GET /forms/hold-points?activityId=A130: open 1, instance #1, its hold item pending'),

  C('T1.siteSubmit', L(588), 'WP2.T1.siteSubmit', 'P', 'the site engineer submits A110 at 40%: 200, submitted'),
  C('T1.officialAfterSubmit', L(588), 'WP2.T1.officialAfterSubmit', 'P', 'A110 official progress still 0'),
  C('T1.evByteIdentical', L(588, 576), 'WP2.T1.evReportAfterSubmit', 'P', 'the EV report hash equals H0 (single writer; EV reads approved progress only)'),
  C('T1.siteApprove', L(588), 'WP2.T1.siteApprove', 'P', 'the site engineer\'s approval: 403 FORBIDDEN; the submission still submitted'),
  C('T1.qsApprove', L(588), 'WP2.T1.qsApprove', 'P', 'the QS approves: 200 approved; A110 official 40'),
  C('T1.ev', L(588), 'WP2.T1.qsApprove.ev', 'P', 'project EV 24,000.00'),
  C('T1.approveAgain', L(588, 578), 'WP2.T1.approveAgain.http', 'P', 'the QS approves again: 200 approved (idempotent)'),
  C('T1.oneRow', L(588), 'WP2.T1.approveAgain.progressRows', 'P', 'exactly one ActivityProgress row for the submission (GET .../detail approvedHistory and the table)'),
  C('T1.rejectApproved', L(588), 'WP2.T1.rejectApproved', 'P', 'rejecting the approved submission (with a reason): 400 APPROVED_PROGRESS_LOCKED'),

  C('T2.siteOnA330', L(589, 577), 'WP2.T2.siteOnA330', 'P', 'the site engineer on A330: 403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED naming A330 alone; A330\'s submission count unchanged'),
  C('T2.plannerOverride', L(589), 'WP2.T2.plannerOverride', 'P', 'the planner on A330 at 30: 200 submitted (T6\'s older s1, left pending)'),
  C('T2.randomId', L(589), 'WP2.T2.randomId', 'P', 'a random activity id: 404 ACTIVITY_NOT_FOUND'),
  C('T2.outsider', L(589), 'WP2.T2.outsider', 'P', 'the PM of 088 on P: 404 PROJECT_NOT_FOUND'),

  C('T3.noEvidence', L(590, 579), 'WP2.T3.submittedNoEvidence', 'P', 'A120 (evidence required) submitted at 50 without evidence: 400 PROGRESS_EVIDENCE_REQUIRED'),
  C('T3.rowsWritten', L(590), 'WP2.T3.rowsWritten', 'P', 'no submission carries the refused one\'s note'),
  C('T3.draft', L(590), 'WP2.T3.draft', 'P', 'the same as a draft: 200 draft'),
  C('T3.approveDraft', L(590, 579), 'WP2.T3.approveDraft', 'P', 'the QS approves the draft: 400 PROGRESS_EVIDENCE_REQUIRED; still a draft'),
  C('T3.withDocument', L(590), 'WP2.T3.withDocument', 'P', 'A120 at 50 with evidence.photos [{ key, documentId, fileName }] of the uploaded photo, approved by the QS: official 50'),
  C('T3.ev', L(590), 'WP2.T3.withDocument.ev', 'P', 'project EV 39,000.00'),
  C('RULES.rejectWithoutReason', L(578), 'WP2.rules.rejectWithoutReason', 'P', 'the QS rejects the draft with no reason: 400 VALIDATION_ERROR with details.field reason (G1; the plan\'s REJECTION_REASON_REQUIRED is the leaf\'s planValue)'),
  C('RULES.approveRejected', L(578), 'WP2.rules.approveRejected', 'P', 'rejected with a reason, then approved: 400 PROGRESS_NOT_APPROVABLE'),
  C('SINGLE.writer', L(576), 'WP2.rules.evReadsApprovedOnly', 'static', 'source scan of backend/src (tests and live suites excluded): exactly one ActivityProgress write, progress.service.js tx.activityProgress.create (plan :576)'),

  C('T4.submit', L(591), 'WP2.T4.submit', 'P', 'the site engineer submits A130 at 25%: 200 submitted'),
  C('T4.pending.approve', L(591, 579), 'WP2.T4.approve', 'P', 'the QS approves: 409 ITP_HOLD_POINT_OPEN'),
  C('T4.pending.holdPoints', L(591), 'WP2.T4.holdPoints', 'P', 'error.details.holdPoints: exactly one, instance #1\'s hold item'),
  C('T4.pending.state', L(591), 'WP2.T4.holdState', 'P', 'that hold point is pending'),
  C('T4.pending.evUnchanged', L(591), 'WP2.T4.evUnchanged', 'P', 'the EV report hash is unchanged by the refusal; EV 39,000.00'),
  C('T4.pending.openList', L(591), 'WP2.T4.openList', 'P', '/forms/hold-points?activityId=A130 shows 1 open'),
  C('T4.failed.approve', L(592), 'WP2.T4.failed.approve', 'P', 'the site engineer starts, answers fail and completes (outcome fail); the QS approves: 409 ITP_HOLD_POINT_OPEN'),
  C('T4.failed.state', L(592), 'WP2.T4.failed.state', 'P', 'the hold point is failed'),
  C('T4.passed.approve', L(593), 'WP2.T4.reopenedPassed.approve', 'P', 'the quality engineer reopens with a reason, answers pass and completes (outcome pass); the QS approves: 200'),
  C('T4.passed.ev', L(593), 'WP2.T4.reopenedPassed.ev', 'P', 'project EV 61,500.00'),
  C('T4.void.site', L(594), 'WP2.T4.siteVoid', 'P', 'instance #2 on A130 (after the import): the site engineer\'s void with a reason: 403 FORBIDDEN'),
  C('T4.void.noReason', L(594), 'WP2.T4.voidWithoutReason', 'P', 'the quality engineer\'s void with no reason: 400 FORM_REASON_REQUIRED; the instance unchanged'),
  C('T4.void.released', L(594), 'WP2.T4.voidWithReason', 'P', 'the quality engineer\'s void with a reason: void; /forms/hold-points?activityId=A130 open 0'),
  C('T4.hrQ1.inProgressPass', L(595, 618, 1047), 'WP2.T4.probes.inProgressPass', 'P', 'HR-Q1 (decided): A200\'s instance started, its hold item answered pass, NOT completed; the QS approves A200 at 10%: refused 409, nothing official (RED at HEAD: 200)'),
  C('T4.hrQ1.na', L(595, 618, 1047), 'WP2.T4.probes.naAnswer', 'P', 'HR-Q1 (decided): A100\'s hold item answered na and the instance completed by the site engineer, no approver step; the QS approves A100 at 10%: refused 409, nothing official (RED at HEAD: 200)'),
  C('T4.signature', L(596), 'WP2.T4.probes.requiredSignature', 'P', 'template T-SIG (requireSignatures inspector), instance with no activity, answered: complete 400 FORM_INCOMPLETE naming the inspector signature; signed, then complete 200'),
  C('T4.recurrence', L(596), 'WP2.T4.probes.weeklyRecurrenceDays', 'P', 'an inspection with recurrence { every week, interval 1 } scheduled for D, completed: the next instance is scheduled for D + 7'),
  C('KA.T4.retroactive', L(596, 618, 1048), 'WP2.T4.probes.retroactiveTemplateEdit', '087-FLD', 'the live hold points after the build\'s template edit, per activity: value (instance version: A110 4, A120 1 failed, A150/A170 0) or today (current template: A110 6, A120 2, A150 1, A170 1) - HR-Q2'),
  C('FLD.beforeEdit', L(596, 430), 'WP2.T4.probes.retroactiveBeforeEdit', 'stored:087-FLD', 'itp.holds.before-edit: A100 0, A110 4 pending, A120 1 failed, A140/A150/A170 0'),

  C('DR.approveWithOpenHold', L(597), 'WP2.dailyReport.approveWithOpenHold', 'P', 'a T-HOLD instance on A320 (scheduled, 1 open); the site engineer\'s daily report on A320 { progress: quantity 40 }, submitted; the PM approves: 409 ITP_HOLD_POINT_OPEN'),
  C('DR.reportStatus', L(597), 'WP2.dailyReport.reportStatus', 'P', 'the report stays submitted'),
  C('DR.officialUnchanged', L(597), 'WP2.dailyReport.officialProgress', 'P', 'A320 official still 0; the EV report hash unchanged'),
  C('DR.afterRelease', L(597), 'WP2.dailyReport.afterRelease', 'P', 'the A320 instance started, passed and completed (0 open); the PM approves: 200 approved'),
  C('DR.official', L(597, 606), 'WP2.dailyReport.officialAfterApproval', 'P', 'A320 official 6.667 (3 dp)'),
  C('DR.evA320', L(597), 'WP2.dailyReport.evA320', 'P', 'EV(A320) 4,800.00'),
  C('DR.projectEv', L(597), 'WP2.dailyReport.projectEv', 'P', 'project EV 66,300.00'),

  C('T5.toQuantity', L(598, 579), 'WP2.T5.A110toQuantity', 'P', 'the planner sets A110 to quantity: 409 PROGRESS_METHOD_LOCKED'),
  C('T5.toPercent', L(598), 'WP2.T5.A110toPercent', 'P', 'the planner sets A110 to percent: 200'),

  C('QTY.typedZero', L(601, 581), 'WP2.quantitiesA310.typedZero', 'P', 'A310 typed 0: 400 QUANTITY_INVALID'),
  C('QTY.barePercent', L(601, 582), 'WP2.quantitiesA310.barePercent', 'P', 'A310 { method quantity, pctComplete 50 } with no entry: 400 QUANTITY_NO_ENTRIES_TO_BUNDLE'),
  C('QTY.percentMethod', L(601, 579), 'WP2.quantitiesA310.percentMethod', 'P', 'A310 { method percent }: 409 PROGRESS_METHOD_MISMATCH'),
  C('QTY.refusalsLeaveEv', L(601), 'WP2.quantitiesA310.refusalsLeaveEv', 'P', 'the EV report hash unchanged after each refusal; A310 has no submission and no entry'),
  C('QTY.typed450.pct', L(602), 'WP2.quantitiesA310.typed450.pct', 'P', 'typed 450 submitted and approved: A310 official 50'),
  C('QTY.typed450.entries', L(602), 'WP2.quantitiesA310.typed450.entriesCreated', 'P', 'exactly one approved entry, source submission, 450 m2'),
  C('QTY.typed450.ev', L(602), 'WP2.quantitiesA310.typed450.evA310', 'P', 'EV(A310) 67,500.00'),
  C('QTY.typed450.projectEv', L(602), 'WP2.quantitiesA310.typed450.projectEv', 'P', 'project EV 133,800.00'),
  C('QTY.typedAgain', L(602, 582), 'WP2.quantitiesA310.typedAgain', 'P', 'typed again: 409 QUANTITY_ENTRIES_REQUIRED'),
  C('QTY.patchBundled', L(582), 'WP2.rules.patchBundledEntry', 'P', 'while the 90 m2 bundle is pending: the site engineer\'s PATCH of the entry: 409 QUANTITY_ENTRY_BUNDLED'),
  C('QTY.bundle90.installed', L(603), 'WP2.quantitiesA310.bundle90.installed', 'P', 'the 90 m2 entry bundled and approved: installed 540'),
  C('QTY.bundle90.pct', L(603), 'WP2.quantitiesA310.bundle90.pct', 'P', 'A310 official 60'),
  C('QTY.bundle90.ev', L(603), 'WP2.quantitiesA310.bundle90.evA310', 'P', 'EV(A310) 81,000.00'),
  C('QTY.bundle90.projectEv', L(603), 'WP2.quantitiesA310.bundle90.projectEv', 'P', 'project EV 147,300.00'),
  C('QTY.entry.unitM3', L(604, 581), 'WP2.quantitiesA310.entryRefusals.unitM3', 'P', 'an entry on S-003 in m3: 400 QUANTITY_UNIT_MISMATCH, nothing written'),
  C('QTY.entry.negative', L(604, 581), 'WP2.quantitiesA310.entryRefusals.negative', 'P', 'an entry of -5: 400 VALIDATION_ERROR with details.field quantity (G2, Q4; the plan\'s QUANTITY_NEGATIVE is the leaf\'s planValue), nothing written'),
  C('QTY.entry.negative.service', L(604, 581, 1146), 'WP2.quantitiesA310.entryRefusals.negativeService', 'P', 'in process quantityProgressService.createEntries with -5 on P: HttpError 400 QUANTITY_NEGATIVE, nothing written (the only catcher of the service guard removed alone, Q4/Q8)'),
  C('QTY.entry.notAllocated', L(604, 581), 'WP2.quantitiesA310.entryRefusals.notAllocated', 'P', 'an entry of A310 on S-004: 400 QUANTITY_ITEM_NOT_ALLOCATED, nothing written'),
  C('QTY.entry.patchApproved', L(604, 582), 'WP2.quantitiesA310.entryRefusals.patchApproved', 'P', 'the site engineer\'s PATCH of the approved 90 m2 entry: 409 QUANTITY_ENTRY_LOCKED'),
  C('QTY.replay.replayed', L(604, 583), 'WP2.quantitiesA310.replay.replayed', 'P', 'the 90 m2 entry\'s request sent again with its clientRequestId: 200, entry.replayed true, created 0, replayed 1'),
  C('QTY.replay.sameId', L(604, 583), 'WP2.quantitiesA310.replay.sameId', 'P', 'the answered entry is the 90 m2 entry; exactly one entry carries the clientRequestId'),
  C('QTY.dailyLog.entries', L(605), 'WP2.quantitiesA310.dailyLog.entries', 'P', 'a daily-log quantities row of 30 m2 (site), the log submitted: exactly one entry, source daily_log, submitted'),
  C('QTY.dailyLog.installed', L(605), 'WP2.quantitiesA310.dailyLog.installed', 'P', 'bundled and approved: installed 570'),
  C('QTY.dailyLog.pct', L(605), 'WP2.quantitiesA310.dailyLog.pct', 'P', 'A310 official 63.333 (3 dp, GET /activities)'),
  C('QTY.dailyLog.ev', L(605), 'WP2.quantitiesA310.dailyLog.evA310', 'P', 'EV(A310) 85,500.00'),
  C('QTY.dailyLog.projectEv', L(605), 'WP2.quantitiesA310.dailyLog.projectEv', 'P', 'project EV 151,800.00'),
  C('QTY.rejected.entryStatus', L(424), 'WP2.quantitiesA310.rejectedState.entryStatus', 'P', 'a 10 m2 entry bundled, the QS rejects with a reason: the entry rejected (rejectedBy, rejectedAt, reason)'),
  C('QTY.rejected.unchanged', L(424), 'WP2.quantitiesA310.rejectedState.officialProgress', 'P', 'installed 570, official 63.333, EV(A310) 85,500.00 unchanged'),

  C('Q320.typed50.pct', L(606), 'WP2.quantitiesA320.typed50.pct', 'P', 'A320 typed 50 approved: official 8.333 (3 dp)'),
  C('Q320.typed50.ev', L(606), 'WP2.quantitiesA320.typed50.evA320', 'P', 'EV(A320) 6,000.00'),
  C('Q320.typed50.mintSkipped', L(606), 'WP2.quantitiesA320.typed50.mintSkipped', 'P', 'the approval answer\'s quantity.mintSkipped is set (two allocated items); no entry on A320'),
  C('Q320.typed40.warning', L(606, 583), 'WP2.quantitiesA320.typed40.warning', 'P', 'typed 40: the submission answer warns QUANTITY_BELOW_OFFICIAL (officialInstalled 50, typed 40)'),
  C('Q320.typed40.reasonRequired', L(606, 619, 1037), 'WP2.quantitiesA320.typed40.pctAfterApproval', 'P', 'HR-P1 (decided): the QS approves the typed-40 submission with no correction reason: refused, A320 not lowered (status, code and where the reason is given: contract pending plan review, G12; RED at HEAD: 200, lowered silently)'),
  C('Q320.typed40.pct', L(606, 1037), 'WP2.quantitiesA320.typed40.pctAfterApproval', 'P', 'after the decided path (HEAD: the plain approval; after the HR-P1 fix: its explicit correction, contract pending G12): A320 official 6.667'),
  C('Q320.typed40.ev', L(606), 'WP2.quantitiesA320.typed40.evA320', 'P', 'EV(A320) 4,800.00'),
  C('Q320.typed40.projectEv', L(606), 'WP2.quantitiesA320.typed40.projectEv', 'P', 'project EV 151,800.00'),

  C('T6.olderLower.refusal', L(599, 619, 1037), 'WP2.T6.olderLowerApproval.refusal', 'P', 'HR-P1 (decided): A330 s2 at 60 submitted and approved by the planner; the QS approves the older pending s1 at 30: refused 409 (code: contract pending, G12; RED at HEAD: 200)'),
  C('T6.olderLower.official', L(599, 619, 1037), 'WP2.T6.olderLowerApproval.official', 'P', 'HR-P1 (decided): A330 official stays 60 (RED at HEAD: 30)'),
  C('KA.T6.methodBypass', L(599, 620, 1038), 'WP2.T6.methodBypass', 'P', 'A300 approved at percent 20, then { progressMethod quantity, quantityComplete 30, quantityPlanned 100 } approved: value refused 409 (code not asserted) or today 200 with 30% official under quantity - HR-P2 (G23)'),
  C('METHOD.stands', L(579, 1146), 'WP2.methodStands', 'P', 'A220 unconfigured: the site engineer\'s percent 10 pending; the planner configures A220 as quantity (m2); the QS approves: 409 PROGRESS_METHOD_MISMATCH naming the submission; nothing official (G3, Q5)'),
  C('KA.T7.retired', L(599, 621, 1036), 'WP2.T7.retiredActivityApproval', 'P', 'A140 at 10% pending; F1r imported, approved and activated with A140 unmapped (retired); the QS approves: value refused 409 or today 200 with an ActivityProgress row on the inactive activity - HR-S9'),

  C('VIEW.installed', L(607, 584), 'WP2.quantityView.installed', '087-SCH', 'GET /boq/items/S-003/quantities (QS): figures.installed.value 570'),
  C('VIEW.committed', L(607, 584), 'WP2.quantityView.committed', '087-SCH', 'committed 900'),
  C('VIEW.received', L(607, 584), 'WP2.quantityView.received', '087-SCH', 'received 1,000'),
  C('VIEW.issued', L(607, 584), 'WP2.quantityView.issued', '087-SCH', 'issued 550 (600 issued, 50 returned)'),
  C('VIEW.certified', L(607, 584), 'WP2.quantityView.certified', '087-SCH', 'certified 500'),
  C('VIEW.paid', L(607, 584), 'WP2.quantityView.paid', '087-SCH', 'paid 250'),
  C('VIEW.certifiedAboveInstalled', L(607), 'WP2.quantityView.certifiedAboveInstalled', '087-SCH', 'comparisons.certifiedOverInstalled.flag false'),
  C('VIEW.withheld.http', L(607, 584), 'WP2.quantityView.withoutBoqRead.http', '087-SCH', 'the 087-EXTRAS T-NOBOQ member GET /activities/A310/quantities: 200'),
  C('VIEW.withheld.flag', L(607, 584), 'WP2.quantityView.withoutBoqRead.withheld', '087-SCH', 'withheld true; every figure value null'),
  C('VIEW.withheld.reason', L(607, 584), 'WP2.quantityView.withoutBoqRead.reason', '087-SCH', 'the reason is boq-figures\' QUANTITY_FIGURES_WITHHELD sentence (G4)'),
  C('VIEW.itemRoute', L(607, 584), 'WP2.quantityView.withoutBoqRead.itemRoute', '087-SCH', 'the same member on GET /boq/items/S-003/quantities: 403 FORBIDDEN (G4)'),

  C('SCH.stored.barePercent', L(601, 424), 'WP2.quantitiesA310.barePercent', 'stored:087-SCH', 'qty.barePercent: 400 QUANTITY_NO_ENTRIES_TO_BUNDLE at its moment'),
  C('SCH.stored.typed450', L(602, 424), 'WP2.quantitiesA310.typed450.evA310', 'stored:087-SCH', 'qty.typed450: EV(A310) 67,500.00 (stored in units)'),
  C('SCH.stored.bundle90', L(603, 424), 'WP2.quantitiesA310.bundle90.evA310', 'stored:087-SCH', 'qty.bundle90: EV(A310) 81,000.00 (stored in units)'),
  C('SCH.stored.replay', L(604, 424), 'WP2.quantitiesA310.replay.replayed', 'stored:087-SCH', 'qty.replay: replayed true, the 90 m2 entry\'s id'),
  C('SCH.stored.dailyLog', L(605, 424), 'WP2.quantitiesA310.dailyLog.evReportPct', 'stored:087-SCH', 'qty.dailylog570: EV(A310) 85,500.00 (units) and the EV report\'s percent 63.33 (2 dp, G16)'),
  C('SCH.stored.rejected', L(424), 'WP2.quantitiesA310.rejectedState.entryStatus', 'stored:087-SCH', 'qty.rejected10 and qty.pending: the entries stand in the states approved, draft, rejected and submitted'),
  C('SCH.stored.importDryRun', L(610, 424), 'WP2.importProgress.site.A310row', 'stored:087-SCH', 'progress.file\'s dry run as the site engineer: A110 submit, A130 submit, A310 refuse'),
  C('SCH.live.installed', L(605, 424), 'WP2.quantitiesA310.dailyLog.installed', '087-SCH', 'GET /quantity-progress?activityId=A310: approved entries sum 570; entries in all four states; the rejected 10 m2 entry reads rejected'),
  C('SCH.live.replay', L(604, 583), 'WP2.quantitiesA310.replay', '087-SCH', 'the build\'s 90 m2 request sent again by the site engineer (writes nothing): replayed true, the same id, created 0'),
  C('SCH.live.A130hold', L(591, 424), 'WP2.endState087SCH.A130openHolds', '087-SCH', '/forms/hold-points?activityId=A130: 1 open, pending, the build\'s instance'),

  C('BULK.mixed.refusal', L(609), 'WP2.bulk.mixedBatch.refusal', 'P', 'the planner\'s batch [A330 { pctComplete 10 }, A310 { method percent }] (before T6, G6): 409 PROGRESS_METHOD_MISMATCH'),
  C('BULK.mixed.index', L(609), 'WP2.bulk.mixedBatch.index', 'P', 'details.batch.index 1, written 0, updates 2'),
  C('BULK.mixed.count', L(609, 1146), 'WP2.bulk.mixedBatch.a330SubmissionsDelta', 'P', 'A330\'s submission count is the same before and after (the catcher of the split transaction, G5)'),
  C('BULK.random.refusal', L(609), 'WP2.bulk.randomId.refusal', 'P', 'the planner\'s batch [A330, a random id]: 404 ACTIVITY_NOT_FOUND'),
  C('BULK.random.index', L(609), 'WP2.bulk.randomId.index', 'P', 'details.batch.index 1, written 0; A330\'s count unchanged'),
  C('BULK.site.refusal', L(609), 'WP2.bulk.siteWithA330.refusal', 'P', 'the site engineer\'s batch [A110 45, A330 50]: 403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED naming A330'),
  C('BULK.site.written', L(609), 'WP2.bulk.siteWithA330.written', 'P', 'A110\'s and A330\'s submission counts unchanged'),

  C('IMP.file', L(610, 424), 'WP2.importProgress.file', 'stored:087-SCH', 'the generated progress XER states A110 70, A130 50, A310 30, and its sha256 equals the 087-SCH build\'s saved file and stored sha256'),
  C('IMP.site.delta0', L(610), 'WP2.importProgress.site.activityProgressDelta', 'P', 'the site engineer\'s upload: rows A110 and A130 submitted; no ActivityProgress row written on P'),
  C('IMP.site.ev', L(610), 'WP2.importProgress.site.ev', 'P', 'the EV report hash unchanged'),
  C('IMP.site.A310row', L(610), 'WP2.importProgress.site.A310row', 'P', 'row A310 refused, reason PROGRESS_METHOD_MISMATCH'),
  C('IMP.site.reupload', L(610), 'WP2.importProgress.site.reuploadRows', 'P', 'the same file again (site): A110 and A130 already_pending, A310 refused; nothing written'),
  C('IMP.pm.A110official', L(611), 'WP2.importProgress.pm.A110official', 'P', 'the PM\'s upload: row A110 approved, approving the site engineer\'s pending 70 (approvesPending); A110 official 70'),
  C('IMP.pm.evA110', L(611), 'WP2.importProgress.pm.evA110', 'P', 'EV(A110) 42,000.00'),
  C('IMP.pm.evDelta', L(611), 'WP2.importProgress.pm.evDelta', 'P', 'project EV +18,000.00, to 169,800.00 (WP2.importProgress.pm.projectEvAfter)'),
  C('IMP.pm.A130row', L(611), 'WP2.importProgress.pm.A130row', 'P', 'instance #2 on A130 scheduled: row A130 pending, reason ITP_HOLD_POINT_OPEN; A130 official unchanged'),

  C('D2.T1ev', L(443, 588), 'D2.WP2.T1ev', 'stored:052-SCH-EV', 'wp2.T1.ev: EV 24,000.00 (USD; stored in units)'),
  C('D2.T3ev', L(443, 590), 'D2.WP2.T3ev', 'stored:052-SCH-EV', 'wp2.T3.ev: EV 39,000.00 (stored in units)'),
  C('D2.T4ev', L(443, 593), 'D2.WP2.T4ev', 'stored:052-SCH-EV', 'wp2.T4: EV 61,500.00 (stored in units)'),
  C('D2.qtyT2', L(443, 602), 'D2.WP2.quantityT2evA310', 'stored:052-SCH-EV', 'wp2.qty.T2: EV(A310) 67,500.00 (stored in cents); typed 0 400 QUANTITY_INVALID; one entry; official 50; typed again 409 QUANTITY_ENTRIES_REQUIRED'),
  C('D2.qtyT3', L(443, 603), 'D2.WP2.quantityT3evA310', 'stored:052-SCH-EV', 'wp2.qty.T3: EV(A310) 81,000.00 (stored in cents); installed 540; official 60'),
  C('D2.gates', L(443, '588-593'), 'WP2.T1', 'stored:052-SCH-EV', 'the stored T1, T3 and T4 gate answers equal the WP2.T1/T3/T4 codes (EV unchanged at the hold: 3,900,000 cents)'),

  C('CF.HRQ1', L(618, 1047), 'WP2.T4.probes.inProgressPass', 'P', 'confirm-first: a hold point is released by the answer alone (in-progress pass; na) - HR-Q1 decided: must be REJECTED; "any scheduled ITP blocks" is kept for Phase 1 and only reported'),
  C('CF.HRQ2', L(618, 1048), 'WP2.T4.probes.retroactiveTemplateEdit', '087-FLD', 'confirm-first: template edits act retroactively (HR-Q2)'),
  C('CF.HRP1', L(619, 1037), 'WP2.T6.olderLowerApproval.refusal', 'P', 'confirm-first: approving a lower figure lowers progress silently - HR-P1 decided: must be REJECTED'),
  C('CF.HRP2', L(620, 1038), 'WP2.T6.methodBypass', 'P', 'confirm-first: the method lock is bypassed on unconfigured activities (HR-P2)'),
  C('CF.HRS9', L(621, 1036), 'WP2.T7.retiredActivityApproval', 'P', 'confirm-first: approval on an activity retired by activation (HR-S9)'),
  C('CF.HRX1', L(622, 1052), 'WP2.confirmFirst.textOnlyEvidence', 'P', 'confirm-first: text-only evidence is accepted - HR-X1 decided: must be REJECTED (what text-only evidence answers in the transition: contract pending, G19)'),
  C('CF.HRP3', L(622, 1039), 'WP2.confirmFirst.putMethodReset', 'P', 'confirm-first: a PUT on the progress method resets omitted fields (HR-P3)'),
  C('CF.HRP4', L(623, 1040), 'WP2.confirmFirst.selfApproval', 'P', 'confirm-first: the planner approves their own submission (HR-P4; reported until the owner decides)'),
  C('CF.replayPayload', L(624), 'WP2.confirmFirst.replayDifferentPayload', 'P', 'confirm-first: a replay with a different payload returns the stored entry (low)'),
];
/**
 * Fixed before the first run: the checks above (G.5xx is the harness's own, on top). WP2-PREP proposed 164 (+G.5xx); the
 * binding adjudication removed the seven PERSONA.* checks (Q6) and D2.live (Q9) and adopted QTY.entry.negative.service (Q4, Q8);
 * CONC.approveTwice and DR.fld.openHold stay out (Q8). 164 - 7 - 1 + 1 = 157.
 */
const EXPECTED_CHECKS = 157;
// </CHECKS>
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((c) => c.id)).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');

/** Which sections touch which project (the --project filter selects sections). */
const SECTION_PROJECTS = {
  S: ['P', '087-SCH', '087-FLD', '052-SCH-EV', 'static'],
  SETUP: ['P'], T1: ['P'], T2: ['P'], T3: ['P'], RULES: ['P'], SINGLE: ['static'], T4: ['P', '087-FLD'], FLD: ['087-FLD'],
  DR: ['P'], T5: ['P'], QTY: ['P'], Q320: ['P'], T6: ['P'], METHOD: ['P'], T7: ['P'],
  VIEW: ['087-SCH'], SCH: ['087-SCH'], BULK: ['P'], IMP: ['P', '087-SCH'], D2: ['052-SCH-EV'],
  CF: ['P', '087-FLD'],
};
for (const [flag, set] of [['only', ONLY], ['skip', SKIP]]) {
  for (const section of set || []) if (!SECTION_PROJECTS[section]) throw new Error(`--${flag}: no section ${section} (sections: ${Object.keys(SECTION_PROJECTS).join(' ')})`);
}
if (PROJECT_FILTER && !Object.values(SECTION_PROJECTS).some((list) => list.includes(PROJECT_FILTER))) throw new Error(`--project: no project ${PROJECT_FILTER}`);
/** The sections CF classifies from (confirmFirstFlow reads their records, known answers and observations). */
const CF_SOURCES = ['T3', 'T4', 'T6', 'T7', 'Q320', 'QTY'];
const selectedSections = new Set(Object.keys(SECTION_PROJECTS).filter((section) => {
  if (ONLY && !ONLY.has(section)) return false;
  if (PROJECT_FILTER && !SECTION_PROJECTS[section].includes(PROJECT_FILTER)) return false;
  return true;
}));
if (selectedSections.has('CF')) for (const section of CF_SOURCES) selectedSections.add(section);
for (const section of SKIP || []) {
  if (section === 'S') throw new Error('--skip: the setup section S always runs');
  if (CF_SOURCES.includes(section) && selectedSections.has('CF')) throw new Error(`--skip=${section}: CF classifies from it; skip CF too`);
  selectedSections.delete(section);
}
selectedSections.add('S');
const on = (section) => selectedSections.has(section);
const ACTIVE = CHECKS.filter((c) => selectedSections.has(c.section));
const ACTIVE_IDS = new Set(ACTIVE.map((c) => c.id));
/** Where the selected (non-setup) checks run: the setup checks never pull a project in (L5). */
const runsOn = (code) => ACTIVE.some((c) => c.where === code);
const NEED_P = runsOn('P');
/** The deep projects (live) and the build state files (stored moments) the selected checks need. */
const NEED_DEEP = Object.keys(DEEP).filter((code) => runsOn(code) || runsOn(`stored:${code}`));
/** 087-EXTRAS (no project of its own): its T-NOBOQ member for the withheld view. */
const NEED_EXTRAS = on('VIEW');
const NEED_COMPANIES = [...new Set(['087', OUTSIDER, ...NEED_DEEP.map((code) => DEEP[code].company)])];

// ── small helpers ──────────────────────────────────────────────────────────────
/** A list out of an answer's data: the array itself, or its items / activities / allocations / entries / submissions / rows / files. */
const listOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'activities', 'allocations', 'entries', 'submissions', 'rows', 'files', 'events']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dayOf = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
const codeOf = (a) => a?.activityCode || a?.p6ActivityId || null;
const json = (v, max = 600) => { try { return JSON.stringify(v).slice(0, max); } catch { return String(v).slice(0, max); } };
const r3 = (x) => (x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(Number(x).toFixed(3)));
const r6 = (x) => (x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(Number(x).toFixed(6)));
/** Sorted-key JSON (052-sch-ev.js canonical, R1-20): the same object gives the same text whatever order its keys were written in. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
};
const sameJson = (a, b) => canonical(a) === canonical(b);
const sha256 = (body) => crypto.createHash('sha256').update(body).digest('hex');
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** A UTC calendar day n days before today: on or before the run date in 087's zone (Africa/Cairo is ahead of UTC). */
const daysAgo = (n) => isoDay(Date.now() - n * DAY_MS);
const addDays = (iso, n) => isoDay(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS);
/** '409 ITP_HOLD_POINT_OPEN' -> 409; 'pending (ITP_HOLD_POINT_OPEN)' -> { state, code } */
const statusPart = (said) => Number(String(said).split(' ')[0]);
const codePart = (said) => String(said).split(' ')[1] || null;
const stateAndCode = (text) => { const m = /^(\w+) \((\w+)\)$/.exec(String(text)); return m ? { state: m[1], code: m[2] } : { state: null, code: null }; };
const readState = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${code}.json`), 'utf8'));
const outOf = (state, step) => {
  const st = state?.steps?.[step];
  if (!st || st.status !== 'done') throw new Error(`build ${state?.code}: step ${step} is ${st ? st.status : 'not run'}`);
  return st.out;
};
/** TASK rows of an XER text: [{ task_code, phys_complete_pct, ... }] (as the WP-1 proof reads them). */
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

/**
 * The units the build state files store figures in, named per step field (adjudication finding 7: never guessed). 087-SCH
 * stores the EV report's figure (currency units); 052-SCH-EV stores units for T1/T3/T4 (assertEv's t.ev) and cents for the
 * T4 refusal moment and the quantity steps (lib.toCents before storing).
 */
const STORED_UNITS = {
  '087-SCH': { 'qty.typed450.evA310.ev': 'units', 'qty.bundle90.evA310.ev': 'units', 'qty.dailylog570.evA310.ev': 'units' },
  '052-SCH-EV': { 'wp2.T1.ev.ev': 'units', 'wp2.T3.ev.ev': 'units', 'wp2.T4.ev': 'units', 'wp2.T4.pending.evCents': 'cents', 'wp2.qty.T2.evA310': 'cents', 'wp2.qty.T3.evA310': 'cents' },
};

/** A 1 x 1 PNG (the site photo and the signature; scripts/cert/drivers/progress.js PNG_1X1). */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SIGNATURE_IMAGE = `data:image/png;base64,${PNG_1X1.toString('base64')}`;

/** P's progress methods: 087-SCH's (build/087-sch.js METHOD_CONFIG :737-744), from answers inputs.methods087SCH. */
const METHOD_CONFIG = {
  A110: { method: METHODS.A110.method, evidenceRequired: false },
  A120: { method: METHODS.A120.method, evidenceRequired: true },
  A310: { method: METHODS.A310.method, quantityUnit: METHODS.A310.unit },
  A320: { method: METHODS.A320.method, quantityUnit: METHODS.A320.unit },
  A210: { method: METHODS.A210.method, milestoneWeights: METHODS.A210.weights.map((weight, i) => ({ id: `m${i + 1}`, name: ['Formwork erected', 'Reinforcement fixed', 'Concrete poured'][i], weight })) },
  A230: { method: METHODS.A230.method, inspectionRequired: true },
};
/** F1r: F1 without A140 (087-ev.js PROGRAMMES.F1r :149-152), for T7. */
const F1R_MODEL = () => {
  const rows = IN.F1.tasks.filter((t) => t[0] !== 'A140');
  return files.programme({
    name: 'F1r',
    wbs: IN.wbs,
    tasks: rows.map(([code, name, wbs, hours, , pct]) => ({ code, name, wbs, hours, pct })),
    links: rows.filter((row) => row[4]).map(([code, , , , pred]) => ({ pred, succ: code, type: 'FS', lagHours: 0 })),
    note: 'WP-2 T7: F1 with A140 left out (its retirement)',
  });
};

/**
 * The figures the choreography types (inputs, not expected figures; each read from the leaf that states it).
 * T6: s1 is T2's planner override at 30 (WP2.T6.olderLowerApproval.official.today), s2 the newer 60 (.official.value).
 */
const S1_PCT = WP2.T6.olderLowerApproval.official.today;
const S2_PCT = WP2.T6.olderLowerApproval.official.value;
const Q450 = (WP2.quantitiesA310.typed450.pct.value * WP2.setup.A310planned.value) / 100; // 450
const Q90 = WP2.quantitiesA310.bundle90.installed.value - Q450; // 90
const Q30 = WP2.quantitiesA310.dailyLog.installed.value - WP2.quantitiesA310.bundle90.installed.value; // 30
const Q10 = 10; // WP2.quantitiesA310.rejectedState.choreography: 'a further 10 m2 entry'
const DR_LINE = WP2.dailyReport.progressLine.value; // { activity: 'A320', method: 'quantity', quantityComplete: 40, ... }
const Q50_A320 = WP2.quantitiesA320.typed40.officialInstalled.value; // 50
const Q40_A320 = WP2.quantitiesA320.typed40.typed.value; // 40
const MB = WP2.T6.methodBypassInputs.value; // { activity: 'A300', approvedPercent: 20, quantityComplete: 30, quantityPlanned: 100 }
const ROLE_PERSONA = { pm: 'pm', planning_eng: 'planner', qs: 'qs', site_engineer: 'site', quality_engineer: 'quality' };

// ── rules, decided-rule checks and the contracts pending their plan review ─────
const ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp2/WP2-ADJUDICATION.md ${item}`;
const RULES = {
  'HR-Q1': { status: 'decided', statement: 'Releasing a hold point: release only on a completed or closed instance with the hold item passed; "na" on a hold item needs the approver; "any open ITP blocks" is kept for Phase 1 (plan §5 HR-Q1; owner §0.1: approved to fix; fixed in WP-2 after its Codex plan review, WP2ADJ Q2).', sources: [`${PLAN_DOC}:47,1047`, ADJ('Q2')] },
  'HR-P1': { status: 'decided', statement: 'Lowering official progress: a lower figure needs a reason and returns a warning; approving an older submission after a newer approved one is refused (409); a legitimate downward correction goes through an explicit, authorised correction that keeps its history (plan §5 HR-P1, §0.1; fixed in WP-2 after its Codex plan review, WP2ADJ Q2).', sources: [`${PLAN_DOC}:48,1037`, ADJ('Q2')] },
  'HR-X1': { status: 'decided', statement: 'What counts as evidence: at least one stored project document; one batch at WP-2 over progress, NCR, safety and change-order evidence, the backend accepting both formats during the transition (plan §5 HR-X1, §0.1 :51-52; WP2ADJ Q3). What text-only evidence answers is the batch plan\'s contract (G19).', sources: [`${PLAN_DOC}:51,52,1052`, ADJ('Q3')] },
  'HR-Q2': { status: 'proposed', statement: 'Hold-point template version: gate on the instance\'s own template version (undecided).', sources: [`${PLAN_DOC}:1048`] },
  'HR-P2': { status: 'proposed', statement: 'Method-lock scope: lock the effective method once progress is approved (undecided).', sources: [`${PLAN_DOC}:1038`] },
  'HR-S9': { status: 'proposed', statement: 'Activities retired by activation: refuse approval (409); keep their AC and EV in project totals (undecided).', sources: [`${PLAN_DOC}:1036`] },
  'HR-P3': { status: 'proposed', statement: 'PUT on the progress method: partial update (undecided).', sources: [`${PLAN_DOC}:1039`] },
  'HR-P4': { status: 'proposed', statement: 'Segregation of duties: keep for Phase 1, self-approvals visible in audit (the owner\'s recommendation, undecided; reported until decided, WP2ADJ Q11).', sources: [`${PLAN_DOC}:1040`, ADJ('Q11')] },
  'REPLAY-PAYLOAD': { status: 'proposed', statement: 'A replay with a different payload returns the stored entry: an observation (plan :624, low); no expected answer is recorded.', sources: [`${PLAN_DOC}:624`] },
};
const CF_RULE = { 'CF.HRQ1': 'HR-Q1', 'CF.HRQ2': 'HR-Q2', 'CF.HRP1': 'HR-P1', 'CF.HRP2': 'HR-P2', 'CF.HRS9': 'HR-S9', 'CF.HRX1': 'HR-X1', 'CF.HRP3': 'HR-P3', 'CF.HRP4': 'HR-P4', 'CF.replayPayload': 'REPLAY-PAYLOAD' };
/** The decided-rule checks (the header table): kind 'defect', RED at HEAD until the approved fix lands (exit 2, never 1). */
const DECIDED_RED = {
  'T4.hrQ1.inProgressPass': { rule: 'HR-Q1', defect: 'HR-Q1 hold released by a pass answer on an in-progress instance', today: '200; A200 10% official' },
  'T4.hrQ1.na': { rule: 'HR-Q1', defect: 'HR-Q1 hold released by an na answer with no approver', today: '200; A100 10% official' },
  'T6.olderLower.refusal': { rule: 'HR-P1', defect: 'HR-P1 older submission approved after a newer approved one', today: '200' },
  'T6.olderLower.official': { rule: 'HR-P1', defect: 'HR-P1 official progress lowered by the older approval', today: '30' },
  'Q320.typed40.reasonRequired': { rule: 'HR-P1', defect: 'HR-P1 lower figure approved without an authorised correction', today: '200; lowered silently (the warning only)' },
  'CF.HRQ1': { rule: 'HR-Q1', defect: 'HR-Q1 hold point released by the answer alone', today: 'CONFIRMED' },
  'CF.HRP1': { rule: 'HR-P1', defect: 'HR-P1 approving a lower figure lowers progress silently', today: 'CONFIRMED' },
  'CF.HRX1': { rule: 'HR-X1', defect: 'HR-X1 text-only evidence accepted', today: 'CONFIRMED' },
};
for (const [id, d] of Object.entries(DECIDED_RED)) {
  if (!CHECKS.some((c) => c.id === id) || RULES[d.rule]?.status !== 'decided') throw new Error(`DECIDED_RED ${id}: not a check, or ${d.rule} is not decided`);
}
/**
 * The contracts of the decided rules fixed later in WP-2, filled ONLY from the adjudicated fix plan after its Codex plan review
 * (WP2ADJ Q2: no contract is guessed; G12 HR-P1, G13 HR-Q1, G19 HR-X1). null = contract pending plan review: the check judges
 * only what the decided rule fixes.
 *   HR-Q1.refusalCode          the code of the refused approval (the book states ITP_HOLD_POINT_OPEN; not judged until confirmed)
 *   HR-Q1.naRelease            how the approver releases an 'na' hold item (not exercised until known)
 *   HR-P1.olderAfterNewerCode  the code of approving an older submission after a newer approved one
 *   HR-P1.lowerFigureRefusal   '<status> <CODE>' of a plain approval of a lower figure
 *   HR-P1.lowerFigureCorrection async ({ send, P, activityId, submissionId }) => answer: the explicit, authorised correction
 *   HR-X1.textOnlyAnswer       what text-only evidence answers during the transition
 */
const CONTRACT = Object.freeze({
  'HR-Q1': Object.freeze({ refusalCode: null, naRelease: null }),
  'HR-P1': Object.freeze({ olderAfterNewerCode: null, lowerFigureRefusal: null, lowerFigureCorrection: null }),
  'HR-X1': Object.freeze({ textOnlyAnswer: null }),
});
const PENDING = 'contract pending plan review';
const contractOr = (rule, field, note) => (CONTRACT[rule][field] === null ? `${PENDING} (${note})` : CONTRACT[rule][field]);

const planEntries = ACTIVE.map((c) => [
  c.id,
  c.description,
  c.id.startsWith('S.') ? { setup: true } : DECIDED_RED[c.id] ? { defect: DECIDED_RED[c.id].defect, rule: DECIDED_RED[c.id].rule } : c.id.startsWith('CF.') ? { rule: CF_RULE[c.id] } : {},
]);

const h = harness.createHarness({
  name: 'wp2-progress-proof',
  plan: planEntries,
  rules: RULES,
  meta: {
    plan: `${PLAN_DOC} §4 WP-2 (:572-624), §6.2 WP-2 guards (:1146); plan lines as numbered at b75ee67`,
    prep: 'C:/Temp/octapm-cert/scratch/wp2/WP2-PREP.md',
    adjudication: 'C:/Temp/octapm-cert/scratch/wp2/WP2-ADJUDICATION.md (Q1-Q12 applied)',
    momentMap: 'backend/scripts/cert/cert3/build/MOMENT-MAP.md',
    answerBook: `backend/scripts/cert/cert3/answers/schedule.js @${SCHEDULE.meta.head} + the WP-2 book patch (G1-G23)`,
    expectedChecks: EXPECTED_CHECKS,
    activeChecks: ACTIVE.length,
    filter: { only: ONLY ? [...ONLY] : null, skip: SKIP ? [...SKIP] : null, project: PROJECT_FILTER, sections: [...selectedSections], deepProjects: NEED_DEEP, throwaway: { P: NEED_P }, extras: NEED_EXTRAS },
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
    decidedRed: DECIDED_RED,
    contract: Object.fromEntries(Object.entries(CONTRACT).map(([rule, fields]) => [rule, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? PENDING : typeof v === 'function' ? 'function' : v]))])),
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
 * rule: BLOCKED / known, never exit 2) or 'wrong' (neither: an unexplained departure, a failure).
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
 * R-SET: a known-answer probe in its own section. When what the probe needs cannot be set up, the probe throws: the harness
 * records a section error (a setup error, exit 1) and the check is left unrecorded ('not run'), never judged 'wrong'.
 */
const probe = (title, fn) => h.section(`probe: ${title}`, fn);
const probeSetup = (id, why) => new Error(`${id}: the probe's own setup failed (a setup error, not a verdict; R-SET): ${why}`);
/** A step the P choreography cannot go on without: a setup error, not a verdict (as WP-1's W flow). */
const need = (condition, what) => {
  if (condition !== true) throw new Error(`P: ${what}: the choreography cannot go on (a setup error, not a verdict)`);
};
/** A confirm-first item classified from this run's observations (plan §0.0: CONFIRMED / PARTIAL / REJECTED / TEST GAP). */
const cf = (id, { present, absent, gap = [], detail = '' }) => {
  const total = present.length + absent.length + gap.length;
  const classification = total === 0 || gap.length === total ? 'TEST GAP' : present.length === 0 ? 'REJECTED' : absent.length === 0 && gap.length === 0 ? 'CONFIRMED' : 'PARTIAL';
  const rule = RULES[CF_RULE[id]];
  confirmFirst[id] = { classification, rule: CF_RULE[id], ruleStatus: rule.status, present, absent, gap, note: rule.status === 'decided' ? 'a decided rule: CONFIRMED is a failure (RED until its approved fix lands)' : 'an undecided rule: CONFIRMED is reported, not failed; EXPECTED BEHAVIOUR is the owner\'s call' };
  // A decided rule must be REJECTED (the fixed behaviour holds); under an undecided rule the item is reported.
  const ok = rule.status === 'decided' ? classification === 'REJECTED' : classification !== 'TEST GAP';
  rec(id, ok, { expected: rule.status === 'decided' ? 'REJECTED (fixed)' : 'CONFIRMED or REJECTED (reported)', observed: { classification, present, absent, gap }, detail: `${classification}; ${detail}` });
  return classification;
};

// ── sessions and requests ──────────────────────────────────────────────────────
const ctx = { db: null, q: null, orgs: {}, people: {}, sessions: {}, P: null, p: null, state: {}, deep: {}, cleanup: [] };
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
/** A multipart upload (field 'file' unless named: the site photo route takes 'files'). */
const upload = (who, route, file, fields = {}, field = 'file') => send(who, 'POST', route, undefined, { form: api.multipart({ field, filename: file.filename, contentType: file.contentType, body: file.body, fields }) });
const activitiesOf = async (who, P) => listOf(await dataOf(who, `${P}/activities`)).filter((a) => a.isActive !== false);
const byCode = (rows) => new Map(rows.map((a) => [codeOf(a), a]));
const officialPct = async (P, activityId) => num((await dataOf('qs', `${P}/activities/${activityId}`))?.pctComplete);
const submissionsOf = async (P, activityId) => listOf(await dataOf('qs', `${P}/activities/${activityId}/progress-submissions`));
const statusOf = async (P, activityId, submissionId) => (await submissionsOf(P, activityId)).find((x) => x.id === submissionId)?.status ?? null;
const entriesOf = async (P, query) => listOf(await dataOf('site', `${P}/quantity-progress?${query}`));
const installedOf = async (P, activityId) => (await entriesOf(P, `activityId=${activityId}&status=approved`)).reduce((sum, e) => sum + Number(e.quantity), 0);
const holdPointsOf = async (P, activityId) => dataOf('quality', `${P}/forms/hold-points?activityId=${activityId}`);
/** A progress submission: { res, id } (the route answers 200 with { activity, submission }). */
const submit = async (who, P, activityId, body, label) => {
  const res = await send(who, 'POST', `${P}/activities/${activityId}/progress`, { status: 'submitted', source: 'manual', ...body, notes: `WP2 progress proof: ${label} ${h.STAMP}` });
  return { res, id: res.status === 200 ? res.body?.data?.submission?.id || null : null };
};
const approve = (who, P, activityId, submissionId) => send(who, 'POST', `${P}/activities/${activityId}/progress-submissions/${submissionId}/approve`, {});
const reject = (who, P, activityId, submissionId, reason) => send(who, 'POST', `${P}/activities/${activityId}/progress-submissions/${submissionId}/reject`, reason === undefined ? {} : { reason });
/** The EV report as the QS reads it: { report, hash (sorted-key JSON without reporting.asOfDate), ev (cents) }. */
const evRead = async (P) => {
  const report = await dataOf('qs', `${P}/reports/ev`);
  const copy = JSON.parse(JSON.stringify(report));
  if (copy?.reporting) delete copy.reporting.asOfDate;
  return { report, hash: sha256(canonical(copy)), ev: h.toCents(report.ev) };
};
/** One activity's EV (cents) in the report's breakdown, by its database id or its code; null unless exactly one row matches. */
const evRowCents = (report, activityId, code) => {
  const rows = (report?.activityBreakdown || []).filter((a) => a.activityDbId === activityId || a.activityId === activityId || a.activityId === code);
  return rows.length === 1 ? h.toCents(rows[0].ev) : null;
};
const storedCents = (code, field, value) => {
  const unit = STORED_UNITS[code]?.[field];
  if (!unit) throw new Error(`no stored unit recorded for ${code} ${field}: the proof never guesses a stored unit`);
  if (value === null || value === undefined) return null;
  return unit === 'cents' ? (Number.isSafeInteger(value) ? value : null) : h.toCents(value);
};
/** ActivityProgress rows of a project (the one writer's table; SQL, read only). */
const progressRowsOn = async (projectId) => Number((await ctx.q('select count(*)::int as n from "ActivityProgress" ap join "Activity" a on a.id = ap."activityId" where a."projectId" = $1', [projectId]))[0].n);
/** A form instance of T-HOLD on an activity (the quality engineer): { res, id }. */
const holdInstance = async (P, activityId, label) => {
  const res = await send('quality', 'POST', `${P}/forms`, { templateId: ctx.p.tHold.id, title: `WP2 proof ${label} ${h.STAMP}`, activityId, inspectorUserId: ctx.people.quality, clientRequestId: `CERT3-WP2-proof-${label.replace(/[^A-Za-z0-9]+/g, '-')}-${h.STAMP}` });
  return { res, id: res.status === 201 ? res.body?.data?.id || null : null };
};
const formAct = (who, P, instanceId, action, body = {}) => send(who, 'POST', `${P}/forms/${instanceId}/${action}`, body);
const formRespond = (who, P, instanceId, itemId, value) => send(who, 'PUT', `${P}/forms/${instanceId}/responses`, { responses: [{ itemId, value }] });
const itemsOf = (template) => (template?.sections || []).flatMap((s) => s.items || []);
/** A BOQ workbook uploaded by the QS: { res, revisionId }. */
const uploadBoq = async (P, rows, label) => {
  const file = files.boqWorkbook(rows, { filename: `CERT3-WP2-proof-${label}-${h.STAMP}.xlsx`, title: `WP2 progress proof ${label}` });
  const res = await upload('qs', `${P}/boq/upload`, file, { label: `WP2 progress proof ${label} ${h.STAMP}` });
  return { res, revisionId: res.body?.data?.revisionId ?? res.body?.data?.revision?.id ?? null };
};
/** An allocation of a BOQ item to an activity: planner creates and submits, QS approves (as the WP-1 proof). */
const allocate = async (P, { boqItemId, activityId, quantity, amount, label }) => {
  const created = await send('planner', 'POST', `${P}/activity-boq-allocations`, { boqItemId, activityId, quantity, amount, source: 'manual', notes: `WP2 progress proof ${label} ${h.STAMP}` });
  const id = created.body?.data?.id || null;
  const submitted = id ? await send('planner', 'POST', `${P}/activity-boq-allocations/${id}/submit`, {}) : null;
  const approved = id ? await send('qs', 'POST', `${P}/activity-boq-allocations/${id}/approve`, {}) : null;
  return { created, submitted, approved, id, ok: created.status === 201 && submitted?.status === 200 && approved?.status === 200 && approved.body?.data?.status === 'approved' };
};
const boqItemsOf = async (P) => listOf(await dataOf('qs', `${P}/boq`)).filter((i) => i.isActive !== false);
/** draft -> under_review (planner) -> approved (PM) (as the WP-1 proof's review). */
const review = async (P, revisionId, label) => {
  const RV = `${P}/schedule/revisions/${revisionId}`;
  const submitted = await send('planner', 'POST', `${RV}/submit-review`, { comment: `WP2 progress proof ${label} ${h.STAMP}` });
  const approved = await send('pm', 'POST', `${RV}/approve`, { comment: `WP2 progress proof ${label} ${h.STAMP}` });
  return { submitted, approved, ok: submitted.status === 200 && approved.status === 200 && approved.body?.data?.status === 'approved' };
};
/** Activate with GET mapping's suggestions, retiring every unmapped active activity with a reason (as the WP-1 proof). */
const activateSuggested = async (P, revisionId, label) => {
  const RV = `${P}/schedule/revisions/${revisionId}`;
  const mapping = await dataOf('pm', `${RV}/mapping`);
  const mappings = listOf(mapping.suggestedMappings).map(({ oldActivityId, newActivityKey }) => ({ oldActivityId, newActivityKey }));
  const unmappedRemovals = listOf(mapping.unmappedExisting).map((a) => ({ oldActivityId: a.id, reason: `WP2 progress proof ${label}: retired by the revision ${h.STAMP}` }));
  const res = await send('pm', 'POST', `${RV}/activate`, { mappings, unmappedRemovals, comment: `WP2 progress proof ${label} activated ${h.STAMP}` });
  return { mapping, mappings, unmappedRemovals, res, activation: res.body?.data?.activation || null };
};
/** The project of 087 this run creates (archived in cleanup): { id, P }. */
const makeProject = async (team) => {
  const name = `CERT3 WP2 progress proof P ${h.STAMP}`;
  const created = await send('pm', 'POST', '/projects', { name, startDate: START, endDate: '2027-06-30', projectCalendar: 'five_day', currency: 'EGP' });
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (!id) throw new Error(`P could not be created: ${h.said(created)} ${created.body?.error?.message || ''}`);
  ctx.cleanup.push(async () => {
    const res = await send('pm', 'DELETE', `/projects/${id}`);
    const row = (await ctx.q('select "archivedAt"::text as a from "Project" where id = $1', [id]))[0];
    return `P ${id} archive ${h.said(res)}, archivedAt ${row?.a || 'NOT SET'}`;
  });
  const members = [];
  // role null: the person keeps their company role (the team validator, routes/project-team.js:60, has no quality_engineer; as the builders' b.team does)
  for (const [key, role] of Object.entries(team)) members.push(await send('pm', 'POST', `/projects/${id}/team`, role ? { userId: ctx.people[key], role } : { userId: ctx.people[key] }));
  return { id, P: `/projects/${id}`, name, created, members };
};

// ── setup ──────────────────────────────────────────────────────────────────────
/** The build steps whose stored outputs (moment figures) the proof reads, per state file. */
const STATE_STEPS = {
  '087-SCH': ['boq.upload', 'boq.allocations', 'itp', 'qty.barePercent', 'qty.typed450', 'qty.bundle90', 'qty.replay', 'qty.dailylog', 'qty.dailylog570', 'qty.rejected10', 'qty.pending', 'quantities.S-003', 'progress.file'],
  '087-FLD': ['itp.template', 'itp.pending', 'itp.failed', 'itp.voided', 'itp.closed', 'itp.passed', 'itp.holds.before-edit', 'itp.template-edit'],
  '087-EXTRAS': ['people', 'templates', 'members'],
  '052-SCH-EV': ['wp2.T1.before', 'wp2.T1', 'wp2.T1.ev', 'wp2.T3.gates', 'wp2.T3', 'wp2.T3.ev', 'wp2.T4.pending', 'wp2.T4.failed', 'wp2.T4.passed', 'wp2.T4', 'wp2.qty.T2', 'wp2.qty.T3'],
};
const PERSONAS = { pm: ['087', 'pm'], planner: ['087', 'planner'], qs: ['087', 'qs'], site: ['087', 'site'], quality: ['087', 'quality'], outsider: [OUTSIDER, 'pm'], pm052: ['052', 'pm'] };

const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  const specs = Object.fromEntries(h.companies(...NEED_COMPANIES).map((c) => [c.code, c]));
  ctx.specs = specs;
  const problems = [];
  // Exactly one certification organisation per company, as the WP-1 proof resolves it (L6).
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

  // The build state files the selected checks read: moment figures only (and 087-EXTRAS's T-NOBOQ member).
  const stateProblems = [];
  const needStates = [...NEED_DEEP, ...(NEED_EXTRAS ? ['087-EXTRAS'] : [])];
  for (const code of needStates) {
    try {
      ctx.state[code] = readState(code);
      for (const step of STATE_STEPS[code]) if (ctx.state[code].steps?.[step]?.status !== 'done') stateProblems.push(`${code}: step ${step} is ${ctx.state[code].steps?.[step]?.status || 'not run'}`);
    } catch (error) {
      stateProblems.push(`${code}: ${error.message}`);
    }
  }
  if (on('SCH') && ctx.state['087-SCH'] && !ctx.state['087-SCH'].records?.['entry.A310-90']?.data?.entry?.clientRequestId) stateProblems.push('087-SCH: records["entry.A310-90"] carries no entry clientRequestId (the replay key)');
  if (NEED_EXTRAS && ctx.state['087-EXTRAS']?.steps?.people?.status === 'done') {
    // The member denied boq:read (087-EXTRAS T-NOBOQ on 087-SCH): signed in as the state names them, the id and role asserted.
    const { key, userId } = ctx.state['087-EXTRAS'].steps.people.out.noBoq || {};
    const spec = ctx.specs['087'];
    const person = key ? (spec.people || []).find((x) => x.email === `${key}@${spec.domain}`) : null;
    if (!person) stateProblems.push(`087-EXTRAS people.noBoq ${key}: not a person of 087's population`);
    else {
      ctx.sessions.noBoq = api.as({ email: person.email, orgId: ctx.orgs['087'].id });
      const me = await get('noBoq', '/auth/me');
      if (me.status !== 200) stateProblems.push(`noBoq (${key}): GET /auth/me ${h.said(me)}`);
      else if (me.body?.data?.id !== userId || String(me.body?.data?.role).toLowerCase() !== 'site_engineer') stateProblems.push(`noBoq (${key}): user ${me.body?.data?.id} role ${me.body?.data?.role}; the state names ${userId} (site_engineer)`);
      else ctx.people.noBoq = userId;
    }
  }
  rec('S.state', stateProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.state).map(([c, s]) => [c, { projectId: s.projectId, runs: s.runs?.length, updatedAt: s.updatedAt }])), detail: stateProblems.join('; ') || `${needStates.length} state files (${needStates.join(', ') || 'none needed'}), every needed step done` });

  // The deep projects by their exact names, through the API as each company's PM.
  const projectProblems = [];
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

  // The throwaway project P of 087 (WP2-PREP §5.1); the PM is its creator.
  if (NEED_P) ctx.P = await makeProject({ planner: 'planning_eng', qs: 'qs', site: 'site_engineer', quality: null });
  const teamOk = !NEED_P || ctx.P.members.every((m) => [200, 201].includes(m.status));
  rec('S.throwaway', teamOk, { observed: ctx.P ? { id: ctx.P.id, team: ctx.P.members.map((m) => h.said(m)) } : null, detail: `P ${ctx.P?.id || 'not needed (no selected check runs on P)'}` });
  if (!teamOk) throw new Error('setup: P\'s team could not be set');
};

// ── P: the programme, the bill, the methods, the photo, the ITP, the files (S.programme .. S.files) ──
const pSetup = async () => {
  if (!NEED_P) {
    for (const id of ['S.programme', 'S.bill', 'S.photo', 'S.itp']) rec(id, true, { detail: 'not needed (no selected check runs on P)' });
  } else {
    const p = { P: ctx.P.P, projectId: ctx.P.id, ids: {}, items: {}, alloc: {} };
    ctx.p = p;
    const { P } = p;
    // F1 staged by the planner on the empty P, reviewed, approved and activated by the PM with mappings [] (lanes.scheduleF1)
    const f1 = await upload('planner', `${P}/import/xer`, files.xer(files.F1(), { filename: `CERT3-WP2-proof-F1-${h.STAMP}.xer` }));
    const revisionId = f1.status === 201 ? f1.body?.data?.revisionId || null : null;
    const reviewed = revisionId ? await review(P, revisionId, 'F1') : null;
    const RV = `${P}/schedule/revisions/${revisionId}`;
    const mapping = reviewed?.ok ? await dataOf('pm', `${RV}/mapping`) : null;
    const activated = mapping ? await send('pm', 'POST', `${RV}/activate`, { mappings: [], unmappedRemovals: [], comment: `WP2 progress proof F1 activated ${h.STAMP}` }) : null;
    const rows = activated?.status === 200 ? await activitiesOf('pm', P) : [];
    const by = byCode(rows);
    for (const c of CODES) p.ids[c] = by.get(c)?.id || null;
    // the site engineer on every activity but A330 (answers inputs.methods087SCH.siteEngineerAssigned)
    const assigned = [];
    for (const c of METHODS.siteEngineerAssigned) if (p.ids[c]) assigned.push([c, h.said(await send('planner', 'PATCH', `${P}/activities/${p.ids[c]}`, { engineerIds: [ctx.people.site] }))]);
    const after = byCode(activated?.status === 200 ? await activitiesOf('pm', P) : []);
    const holds = (c) => (after.get(c)?.assignedEngineers || []).some((e) => (e?.id ?? e) === ctx.people.site);
    const assignProblems = CODES.filter((c) => METHODS.siteEngineerAssigned.includes(c) !== holds(c));
    const programmeOk = Boolean(revisionId) && reviewed?.ok === true && mapping?.counts?.existing === 0 && activated?.status === 200 && activated.body?.data?.revision?.isActive === true
      && rows.length === WP1.T1.network.activities.value && CODES.every((c) => p.ids[c]) && assigned.every(([, said]) => said === '200') && assignProblems.length === 0;
    rec('S.programme', programmeOk, { expected: { activities: WP1.T1.network.activities.value, siteEngineerAssigned: METHODS.siteEngineerAssigned }, observed: { stage: h.said(f1), submit: reviewed ? h.said(reviewed.submitted) : null, approve: reviewed ? h.said(reviewed.approved) : null, existingBefore: mapping?.counts?.existing ?? null, activate: activated ? h.said(activated) : null, activities: rows.length, assigned, assignProblems } });
    if (!programmeOk) throw new Error(`P: the F1 programme could not be set up (${json({ stage: h.said(f1), activate: activated ? h.said(activated) : null, rows: rows.length, assignProblems })})`);

    // the bill (QS) and the five activities' six allocations (planner, QS); S-006 left unallocated (WP2.setup.allocations, 387,000.00)
    const bill = await uploadBoq(P, BOQ_ROWS, 'bill');
    const items = await boqItemsOf(P);
    for (const r of BOQ_ROWS) p.items[r.code] = items.find((i) => i.code === r.code)?.id || null;
    const inScope = items.filter((i) => BOQ_ROWS.some((r) => r.code === i.code && r.mappingRule === 'in_scope')).reduce((s, i) => s + h.toCents(i.amount), 0);
    const allocAnswers = [];
    for (const r of BOQ_ROWS) {
      for (const [code, quantity, amount] of r.allocations) {
        const a = await allocate(P, { boqItemId: p.items[r.code], activityId: p.ids[code], quantity, amount, label: `${r.code} to ${code}` });
        p.alloc[`${r.code}.${code}`] = a.id;
        allocAnswers.push([`${r.code}.${code}`, a.ok]);
      }
    }
    // the progress methods (087-SCH's METHOD_CONFIG), read back by SETUP.methods
    const methodAnswers = {};
    for (const [code, body] of Object.entries(METHOD_CONFIG)) methodAnswers[code] = h.said(await send('planner', 'PUT', `${P}/activities/${p.ids[code]}/progress-method`, { ...body, notes: `WP2 progress proof ${code} ${body.method} ${h.STAMP}` }));
    const billOk = bill.res.status < 300 && BOQ_ROWS.every((r) => p.items[r.code]) && inScope === WP1.baseline.unallocated.inScopePriced.value
      && allocAnswers.length === 6 && allocAnswers.every(([, ok]) => ok) && Object.values(methodAnswers).every((said) => said === '200');
    rec('S.bill', billOk, { expected: { rows: BOQ_ROWS.length, inScopePriced: WP1.baseline.unallocated.inScopePriced.value, allocations: 6, methods: Object.keys(METHOD_CONFIG) }, observed: { upload: h.said(bill.res), rows: items.length, inScopePriced: inScope, allocations: allocAnswers, methods: methodAnswers } });
    if (!billOk) throw new Error(`P: the bill, its allocations or the progress methods could not be set up (${json({ upload: h.said(bill.res), allocAnswers, methodAnswers })})`);

    // a site photo, the stored project document T3 names as evidence (HR-X1's canonical reference)
    const photoName = `CERT3-WP2-proof-site-photo-${h.STAMP}.png`;
    const up = await upload('site', `${P}/site-reporting/uploads`, { filename: photoName, contentType: 'image/png', body: PNG_1X1 }, {}, 'files');
    const stored = listOf(up.body?.data).filter((f) => f.originalName === photoName && f.documentId);
    p.photo = stored.length === 1 ? { key: stored[0].key, documentId: stored[0].documentId, fileName: stored[0].fileName } : null;
    rec('S.photo', up.status === 201 && Boolean(p.photo?.key && p.photo?.documentId && p.photo?.fileName), { observed: { said: h.said(up), photo: p.photo } });
    if (!p.photo) throw new Error(`P: the site photo could not be uploaded (${h.said(up)} ${up.body?.error?.message || ''})`);

    // the form ITP T-HOLD (087-sch.js :801-838's shape) and instance #1 on A130 (WP-2 T4 starts from it)
    const tHold = await send('quality', 'POST', `${P}/forms/templates`, { name: `CERT3 WP2 proof T-HOLD ${h.STAMP}`, type: 'itp', status: 'active', description: `WP2 progress proof hold-point template ${h.STAMP}`, sections: [{ title: 'Before the pour', items: [{ label: 'Formwork, reinforcement and cover checked and released for the pour', responseType: 'pass_fail', isHoldPoint: true }] }] });
    const holdItems = itemsOf(tHold.body?.data).filter((i) => i.isHoldPoint);
    p.tHold = { id: tHold.status === 201 ? tHold.body?.data?.id || null : null, holdItemId: holdItems.length === 1 ? holdItems[0].id : null };
    const inst1 = p.tHold.id && p.tHold.holdItemId ? await holdInstance(P, p.ids.A130, 'A130 #1') : null;
    p.inst1 = inst1?.id || null;
    const itpOk = Boolean(p.tHold.id && p.tHold.holdItemId && p.inst1) && inst1.res.body?.data?.status === 'scheduled';
    rec('S.itp', itpOk, { observed: { template: h.said(tHold), holdItems: holdItems.length, instance: inst1 ? h.said(inst1.res) : null, status: inst1?.res.body?.data?.status ?? null } });
    if (!itpOk) throw new Error(`P: the ITP template or instance #1 could not be made (${h.said(tHold)}; ${inst1 ? h.said(inst1.res) : 'no instance'})`);
  }

  // the generated files (pure): the progress XER and F1r
  const progressFile = files.progressXer(PROGRESS_FILE, { filename: `CERT3-WP2-proof-progress-${h.STAMP}.xer` });
  const f1r = F1R_MODEL();
  ctx.files = { progress: progressFile, f1r };
  const statedPcts = Object.fromEntries(xerTasks(progressFile.body).map((t) => [t.task_code, num(t.phys_complete_pct)]));
  rec('S.files', sameJson(statedPcts, PROGRESS_FILE) && !f1r.activities.some((a) => a.code === 'A140') && f1r.activities.length === CODES.length - 1, { observed: { progress: statedPcts, sha256: progressFile.sha256, f1r: f1r.activities.length } });
};

// ── P: the WP-2 choreography (WP2-PREP §5.1 order, binding) ─────────────────────
const pFlow = async () => {
  const p = ctx.p;
  const { P } = p;
  const id = p.ids;
  const A = (code) => `${P}/activities/${id[code]}`;
  const S003 = p.items['S-003'];
  const S004 = p.items['S-004'];
  const alloc310 = p.alloc['S-003.A310'];

  // ── SETUP: the known answers before any progress ──
  const allocRows = listOf(await dataOf('planner', `${P}/activity-boq-allocations?includeInactive=true`)).filter((a) => a.status === 'approved' && a.isActive !== false);
  const perActivity = {};
  for (const a of allocRows) { const code = CODES.find((c) => id[c] === a.activityId) || a.activityId; perActivity[code] = (perActivity[code] || 0) + h.toCents(a.amount); }
  rec('SETUP.allocations', sameJson(perActivity, ALLOC) && !allocRows.some((a) => a.boqItemId === p.items['S-006']), { expected: { perActivity: ALLOC, S006: 'unallocated' }, observed: { perActivity, rows: allocRows.length } });
  const plannedOf = (v) => ({ method: v?.progress?.method ?? null, planned: num(v?.progress?.planned?.value), basis: v?.progress?.planned?.plannedBasis ?? null });
  const q310 = plannedOf(await dataOf('planner', `${A('A310')}/quantities`));
  const q320 = plannedOf(await dataOf('planner', `${A('A320')}/quantities`));
  rec('SETUP.planned', q310.method === 'quantity' && q310.planned === WP2.setup.A310planned.value && q310.basis === 'approved_allocations' && q320.method === 'quantity' && q320.planned === WP2.setup.A320planned.value && q320.basis === 'approved_allocations',
    { expected: { A310: WP2.setup.A310planned.value, A320: WP2.setup.A320planned.value, basis: 'approved_allocations' }, observed: { A310: q310, A320: q320 } });
  const methodProblems = [];
  for (const [code, want] of Object.entries(METHOD_CONFIG)) {
    const m = await dataOf('planner', `${A(code)}/progress-method`);
    if (m?.method !== want.method) methodProblems.push(`${code} method ${m?.method}`);
    if (want.evidenceRequired !== undefined && m?.evidenceRequired !== want.evidenceRequired) methodProblems.push(`${code} evidenceRequired ${m?.evidenceRequired}`);
    if (want.quantityUnit && m?.quantityUnit !== want.quantityUnit) methodProblems.push(`${code} unit ${m?.quantityUnit}`);
    if (want.inspectionRequired !== undefined && m?.inspectionRequired !== want.inspectionRequired) methodProblems.push(`${code} inspectionRequired ${m?.inspectionRequired}`);
    if (want.milestoneWeights && !sameJson((m?.milestoneWeights || []).map((w) => [w.id, Number(w.weight)]), want.milestoneWeights.map((w) => [w.id, w.weight]))) methodProblems.push(`${code} weights ${json(m?.milestoneWeights)}`);
  }
  for (const code of ['A300', 'A330']) {
    const res = await get('planner', `${A(code)}/progress-method`);
    const m = res.body?.data;
    if (!(res.status === 404 || (res.status === 200 && (!m || !m.id || m.configured === false)))) methodProblems.push(`${code} is configured (${h.said(res)} ${json(m, 160)})`);
  }
  rec('SETUP.methods', methodProblems.length === 0 && METHODS.A300 === null && METHODS.A330 === null, { expected: WP2.setup.methods.value, observed: methodProblems, detail: methodProblems.join('; ') });
  const ev0 = await evRead(P);
  p.H0 = ev0.hash;
  rec('SETUP.evBefore', ev0.ev === WP2.setup.evBefore.value, { expected: WP2.setup.evBefore.value, observed: { ev: ev0.ev, hash: ev0.hash } });
  const open0 = await holdPointsOf(P, id.A130);
  const mine0 = listOf(open0?.holdPoints).filter((x) => x.instanceId === p.inst1 && x.itemId === p.tHold.holdItemId);
  rec('SETUP.openList', num(open0?.open) === WP2.T4.openList.value && mine0.length === 1 && mine0[0].state === WP2.T4.holdState.value, { expected: { open: WP2.T4.openList.value, state: WP2.T4.holdState.value }, observed: { open: open0?.open, mine: mine0 } });

  // ── T1: A110 40% (plan :588) ──
  const t1 = await submit('site', P, id.A110, { pctComplete: WP2.T1.qsApprove.official.value }, 'T1 A110');
  rec('T1.siteSubmit', t1.res.status === WP2.T1.siteSubmit.value && t1.res.body?.data?.submission?.status === 'submitted', { expected: WP2.T1.siteSubmit.value, observed: { said: h.said(t1.res), status: t1.res.body?.data?.submission?.status } });
  need(Boolean(t1.id), `the T1 submission was not made (${h.said(t1.res)} ${t1.res.body?.error?.message || ''})`);
  const pct110a = await officialPct(P, id.A110);
  rec('T1.officialAfterSubmit', pct110a === WP2.T1.officialAfterSubmit.value, { expected: WP2.T1.officialAfterSubmit.value, observed: pct110a });
  const evT1a = await evRead(P);
  rec('T1.evByteIdentical', evT1a.hash === p.H0, { expected: WP2.T1.evReportAfterSubmit.value, observed: { before: p.H0, after: evT1a.hash } });
  const siteApprove = await approve('site', P, id.A110, t1.id);
  const t1status = await statusOf(P, id.A110, t1.id);
  rec('T1.siteApprove', h.is(siteApprove, WP2.T1.siteApprove.value) && t1status === 'submitted', { expected: WP2.T1.siteApprove.value, observed: { said: h.said(siteApprove), status: t1status } });
  const qsApprove = await approve('qs', P, id.A110, t1.id);
  const pct110 = await officialPct(P, id.A110);
  rec('T1.qsApprove', qsApprove.status === WP2.T1.qsApprove.http.value && qsApprove.body?.data?.status === 'approved' && pct110 === WP2.T1.qsApprove.official.value, { expected: { http: WP2.T1.qsApprove.http.value, official: WP2.T1.qsApprove.official.value }, observed: { said: h.said(qsApprove), status: qsApprove.body?.data?.status, official: pct110 } });
  need(qsApprove.status === 200, `the T1 approval failed (${h.said(qsApprove)})`);
  const evT1 = await evRead(P);
  rec('T1.ev', evT1.ev === WP2.T1.qsApprove.ev.value, { expected: WP2.T1.qsApprove.ev.value, observed: evT1.ev });
  const again = await approve('qs', P, id.A110, t1.id);
  rec('T1.approveAgain', again.status === WP2.T1.approveAgain.http.value && again.body?.data?.status === 'approved', { expected: WP2.T1.approveAgain.http.value, observed: { said: h.said(again), status: again.body?.data?.status } });
  const history = (await dataOf('qs', `${A('A110')}/detail`))?.sections?.progress?.approvedHistory;
  const historyRows = listOf(history?.items ?? history).filter((r) => r.submissionId === t1.id);
  const tableRows = Number((await ctx.q('select count(*)::int as n from "ActivityProgress" where "submissionId" = $1', [t1.id]))[0].n);
  rec('T1.oneRow', historyRows.length === WP2.T1.approveAgain.progressRows.value && tableRows === WP2.T1.approveAgain.progressRows.value, { expected: WP2.T1.approveAgain.progressRows.value, observed: { approvedHistory: historyRows.length, table: tableRows } });
  const rejectApproved = await reject('qs', P, id.A110, t1.id, `WP2 progress proof: rejecting the approved A110 submission ${h.STAMP}`);
  rec('T1.rejectApproved', h.is(rejectApproved, WP2.T1.rejectApproved.value), { expected: WP2.T1.rejectApproved.value, observed: h.said(rejectApproved) });

  // ── T2: assignment, override, random id, outsider (plan :589) ──
  const a330before = (await submissionsOf(P, id.A330)).length;
  const siteOn330 = await submit('site', P, id.A330, { pctComplete: S1_PCT }, 'T2 site on A330');
  const a330after = (await submissionsOf(P, id.A330)).length;
  const named330 = siteOn330.res.body?.error?.details?.activityIds;
  rec('T2.siteOnA330', h.is(siteOn330.res, WP2.T2.siteOnA330.value) && sameList(named330, WP2.T2.siteOnA330ActivityIds.value.map((c) => id[c])) && a330after - a330before === WP2.T2.siteOnA330SubmissionsDelta.value,
    { expected: { said: WP2.T2.siteOnA330.value, activityIds: WP2.T2.siteOnA330ActivityIds.value, delta: WP2.T2.siteOnA330SubmissionsDelta.value }, observed: { said: h.said(siteOn330.res), activityIds: named330, delta: a330after - a330before } });
  const s1 = await submit('planner', P, id.A330, { pctComplete: S1_PCT }, 'T2 planner on A330 (T6 s1)');
  p.s1 = s1.id;
  rec('T2.plannerOverride', s1.res.status === WP2.T2.plannerOverride.value && s1.res.body?.data?.submission?.status === 'submitted', { expected: WP2.T2.plannerOverride.value, observed: { said: h.said(s1.res), status: s1.res.body?.data?.submission?.status } });
  need(Boolean(s1.id), `the planner's A330 submission (T6 s1) was not made (${h.said(s1.res)})`);
  const randomId = await submit('site', P, crypto.randomUUID(), { pctComplete: 10 }, 'T2 random id');
  rec('T2.randomId', h.is(randomId.res, WP2.T2.randomId.value), { expected: WP2.T2.randomId.value, observed: h.said(randomId.res) });
  const outsider = await submit('outsider', P, id.A330, { pctComplete: 10 }, 'T2 outsider');
  rec('T2.outsider', h.is(outsider.res, WP2.T2.outsider.value), { expected: WP2.T2.outsider.value, observed: h.said(outsider.res) });

  // ── T3: A120 with evidence required (plan :590), the rejection rules, the HR-X1 and HR-P3 observations ──
  const noEvTag = `T3 no evidence ${h.STAMP}`;
  const noEv = await submit('site', P, id.A120, { pctComplete: WP2.T3.withDocument.official.value }, noEvTag);
  rec('T3.noEvidence', h.is(noEv.res, WP2.T3.submittedNoEvidence.value), { expected: WP2.T3.submittedNoEvidence.value, observed: h.said(noEv.res) });
  const written = (await submissionsOf(P, id.A120)).filter((x) => String(x.notes || '').includes(noEvTag)).length;
  rec('T3.rowsWritten', written === WP2.T3.rowsWritten.value, { expected: WP2.T3.rowsWritten.value, observed: written });
  const draft = await submit('site', P, id.A120, { pctComplete: WP2.T3.withDocument.official.value, status: 'draft' }, 'T3 draft');
  rec('T3.draft', draft.res.status === WP2.T3.draft.value && draft.res.body?.data?.submission?.status === 'draft', { expected: WP2.T3.draft.value, observed: { said: h.said(draft.res), status: draft.res.body?.data?.submission?.status } });
  need(Boolean(draft.id), `the T3 draft was not made (${h.said(draft.res)})`);
  const approveDraft = await approve('qs', P, id.A120, draft.id);
  rec('T3.approveDraft', h.is(approveDraft, WP2.T3.approveDraft.value) && (await statusOf(P, id.A120, draft.id)) === 'draft', { expected: WP2.T3.approveDraft.value, observed: h.said(approveDraft) });
  const noReason = await reject('qs', P, id.A120, draft.id);
  const namesReason = listOf(noReason.body?.error?.details).some((d) => d?.field === 'reason');
  const RWR = WP2.rules.rejectWithoutReason;
  rec('RULES.rejectWithoutReason', h.is(noReason, RWR.value) && namesReason && (await statusOf(P, id.A120, draft.id)) === 'draft', { expected: { value: RWR.value, details: 'field reason', planValue: RWR.planValue }, observed: { said: h.said(noReason), namesReason } });
  const withReason = await reject('qs', P, id.A120, draft.id, `WP2 progress proof: no evidence attached ${h.STAMP}`);
  const approveRejected = await approve('qs', P, id.A120, draft.id);
  rec('RULES.approveRejected', withReason.status === 200 && withReason.body?.data?.status === 'rejected' && h.is(approveRejected, WP2.rules.approveRejected.value), { expected: { reject: 'rejected', approve: WP2.rules.approveRejected.value }, observed: { reject: h.said(withReason), status: withReason.body?.data?.status, approve: h.said(approveRejected) } });
  // with the uploaded photo, in the shape the clients send (G17: { photos: [{ key, documentId, fileName }] })
  const evidence = { photos: [{ key: p.photo.key, documentId: p.photo.documentId, fileName: p.photo.fileName }] };
  const shapeOk = sameList(Object.keys(evidence.photos[0]), Object.keys(WP2.T3.withDocument.evidence.value.photos[0]));
  const withDoc = await submit('site', P, id.A120, { pctComplete: WP2.T3.withDocument.official.value, evidence }, 'T3 with the uploaded document');
  const docApprove = withDoc.id ? await approve('qs', P, id.A120, withDoc.id) : null;
  const pct120 = await officialPct(P, id.A120);
  rec('T3.withDocument', withDoc.res.status === 200 && docApprove?.status === 200 && pct120 === WP2.T3.withDocument.official.value && shapeOk, { expected: { official: WP2.T3.withDocument.official.value, evidence: WP2.T3.withDocument.evidence.value }, observed: { submit: h.said(withDoc.res), approve: docApprove ? h.said(docApprove) : null, official: pct120, evidence } });
  need(docApprove?.status === 200, `the T3 approval with the document failed (${docApprove ? h.said(docApprove) : h.said(withDoc.res)})`);
  const evT3 = await evRead(P);
  rec('T3.ev', evT3.ev === WP2.T3.withDocument.ev.value, { expected: WP2.T3.withDocument.ev.value, observed: evT3.ev });
  // CF.HRX1 (decided): a text note as the only evidence, at the official figure (no figure moves); after the HR-X1 batch the
  // answer is the batch contract's (G19, CONTRACT['HR-X1'].textOnlyAnswer)
  const textOnly = await submit('site', P, id.A120, { pctComplete: WP2.T3.withDocument.official.value, evidence: { notes: `WP2 progress proof: a text note only ${h.STAMP}` } }, 'CF.HRX1 text-only evidence');
  const textApprove = textOnly.id ? await approve('qs', P, id.A120, textOnly.id) : null;
  obs.hrx1 = { submit: h.said(textOnly.res), approve: textApprove ? h.said(textApprove) : null, officialAfter: await officialPct(P, id.A120), contract: contractOr('HR-X1', 'textOnlyAnswer', 'G19') };
  // CF.HRP3: a PUT naming the method only, read back, then A120 restored (a restore that fails is the probe's setup error, R-SET)
  await probe('CF.HRP3 PUT on A120 (P)', async () => {
    const put = await send('planner', 'PUT', `${A('A120')}/progress-method`, { method: METHOD_CONFIG.A120.method });
    const read = await dataOf('planner', `${A('A120')}/progress-method`);
    obs.hrp3 = { put: h.said(put), evidenceRequiredAfter: read?.evidenceRequired ?? null };
    const restore = await send('planner', 'PUT', `${A('A120')}/progress-method`, { ...METHOD_CONFIG.A120, notes: `WP2 progress proof A120 restored ${h.STAMP}` });
    const back = await dataOf('planner', `${A('A120')}/progress-method`);
    obs.hrp3.restored = { said: h.said(restore), evidenceRequired: back?.evidenceRequired ?? null };
    if (restore.status !== 200 || back?.evidenceRequired !== true) throw probeSetup('CF.HRP3', `A120's evidence requirement could not be restored (${h.said(restore)}, evidenceRequired ${back?.evidenceRequired})`);
  });

  // ── T4: the hold point on A130 (plan :591-596) ──
  const t4 = await submit('site', P, id.A130, { pctComplete: 25 }, 'T4 A130');
  rec('T4.submit', t4.res.status === WP2.T4.submit.value && t4.res.body?.data?.submission?.status === 'submitted', { expected: WP2.T4.submit.value, observed: { said: h.said(t4.res), status: t4.res.body?.data?.submission?.status } });
  need(Boolean(t4.id), `the T4 submission was not made (${h.said(t4.res)})`);
  const evT4a = await evRead(P);
  const pendingApprove = await approve('qs', P, id.A130, t4.id);
  const namedHolds = pendingApprove.body?.error?.details?.holdPoints;
  const mineT4 = Array.isArray(namedHolds) ? namedHolds.filter((x) => x.instanceId === p.inst1 && x.itemId === p.tHold.holdItemId) : [];
  rec('T4.pending.approve', h.is(pendingApprove, WP2.T4.approve.value), { expected: WP2.T4.approve.value, observed: h.said(pendingApprove) });
  rec('T4.pending.holdPoints', Array.isArray(namedHolds) && namedHolds.length === WP2.T4.holdPoints.value && mineT4.length === 1, { expected: { count: WP2.T4.holdPoints.value, instance: p.inst1 }, observed: namedHolds });
  rec('T4.pending.state', mineT4[0]?.state === WP2.T4.holdState.value, { expected: WP2.T4.holdState.value, observed: mineT4[0]?.state ?? null });
  const evT4b = await evRead(P);
  rec('T4.pending.evUnchanged', evT4b.hash === evT4a.hash && evT4b.ev === WP2.T4.evUnchanged.value, { expected: { hash: 'unchanged', ev: WP2.T4.evUnchanged.value }, observed: { before: evT4a.hash, after: evT4b.hash, ev: evT4b.ev } });
  const openT4 = await holdPointsOf(P, id.A130);
  rec('T4.pending.openList', num(openT4?.open) === WP2.T4.openList.value, { expected: WP2.T4.openList.value, observed: openT4?.open ?? null });
  // answered fail and completed by the site engineer
  const start1 = await formAct('site', P, p.inst1, 'start');
  const fail1 = await formRespond('site', P, p.inst1, p.tHold.holdItemId, 'fail');
  const complete1 = await formAct('site', P, p.inst1, 'complete');
  need(start1.status === 200 && fail1.status === 200 && complete1.status === 200 && complete1.body?.data?.outcome === 'fail', `instance #1 could not be answered fail and completed (${h.said(start1)} / ${h.said(fail1)} / ${h.said(complete1)} ${complete1.body?.data?.outcome})`);
  const failedApprove = await approve('qs', P, id.A130, t4.id);
  rec('T4.failed.approve', h.is(failedApprove, WP2.T4.failed.approve.value), { expected: WP2.T4.failed.approve.value, observed: h.said(failedApprove) });
  const failedHold = listOf((await holdPointsOf(P, id.A130))?.holdPoints).filter((x) => x.instanceId === p.inst1 && x.itemId === p.tHold.holdItemId);
  rec('T4.failed.state', failedHold.length === 1 && failedHold[0].state === WP2.T4.failed.state.value, { expected: WP2.T4.failed.state.value, observed: failedHold });
  // the quality engineer reopens with a reason, answers pass, completes (HR-Q1: a completed instance, the hold item passed)
  const reopen1 = await formAct('quality', P, p.inst1, 'reopen', { reason: `WP2 progress proof: formwork corrected and re-inspected ${h.STAMP}` });
  const pass1 = await formRespond('quality', P, p.inst1, p.tHold.holdItemId, 'pass');
  const complete2 = await formAct('quality', P, p.inst1, 'complete');
  need(reopen1.status === 200 && pass1.status === 200 && complete2.status === 200 && complete2.body?.data?.outcome === 'pass', `instance #1 could not be reopened, passed and completed (${h.said(reopen1)} / ${h.said(pass1)} / ${h.said(complete2)})`);
  const passedApprove = await approve('qs', P, id.A130, t4.id);
  rec('T4.passed.approve', passedApprove.status === WP2.T4.reopenedPassed.approve.value && passedApprove.body?.data?.status === 'approved', { expected: WP2.T4.reopenedPassed.approve.value, observed: { said: h.said(passedApprove), status: passedApprove.body?.data?.status } });
  need(passedApprove.status === 200, `the T4 approval after the pass failed (${h.said(passedApprove)})`);
  const evT4 = await evRead(P);
  rec('T4.passed.ev', evT4.ev === WP2.T4.reopenedPassed.ev.value, { expected: WP2.T4.reopenedPassed.ev.value, observed: evT4.ev });
  // HR-Q1 (decided) probes: A200 (in progress, answered pass, not completed) and A100 (na, completed by the site engineer, no
  // approver step). Unallocated activities: EV never moves. The decided rule refuses the approval; the refusal code and the
  // approver's release of na are the fix plan's contract (G13), so only 409 and 'nothing official' are judged. Nothing here
  // throws on the approval's answer (RED at HEAD = FAIL, exit 2).
  const probeQ1 = async (code, label, answer, complete) => {
    const inst = await holdInstance(P, id[code], label);
    need(Boolean(inst.id), `the ${label} instance could not be made (${h.said(inst.res)})`);
    const steps = {};
    if (answer === 'pass') steps.start = h.said(await formAct('site', P, inst.id, 'start'));
    steps.respond = h.said(await formRespond('site', P, inst.id, p.tHold.holdItemId, answer));
    if (complete) { const c = await formAct('site', P, inst.id, 'complete'); steps.complete = h.said(c); steps.outcome = c.body?.data?.outcome ?? null; }
    steps.formStatus = (await dataOf('quality', `${P}/forms/${inst.id}`))?.status ?? null;
    const before = await officialPct(P, id[code]);
    const sub = await submit('site', P, id[code], { pctComplete: 10 }, `${label} 10%`);
    need(Boolean(sub.id), `the ${label} submission was not made (${h.said(sub.res)})`);
    const ap = await approve('qs', P, id[code], sub.id);
    return { instanceId: inst.id, steps, approve: h.said(ap), status: ap.status, code: ap.body?.error?.code || null, officialBefore: before, officialAfter: await officialPct(P, id[code]) };
  };
  const refusedQ1 = (o, leaf) => o.status === statusPart(leaf.value) && o.officialAfter === o.officialBefore && (CONTRACT['HR-Q1'].refusalCode === null || o.code === CONTRACT['HR-Q1'].refusalCode);
  const q1Pass = await probeQ1('A200', 'HR-Q1 in-progress pass on A200', 'pass', false);
  const PIP = WP2.T4.probes.inProgressPass;
  rec('T4.hrQ1.inProgressPass', refusedQ1(q1Pass, PIP), { expected: { status: statusPart(PIP.value), code: contractOr('HR-Q1', 'refusalCode', `G13; the book states ${codePart(PIP.value)}`), official: 'unchanged' }, observed: q1Pass, detail: `HR-Q1 decided (plan :47, :1047): a pass answer on an instance still in progress does not release the hold; RED at HEAD (today ${PIP.today})` });
  const q1Na = await probeQ1('A100', 'HR-Q1 na on A100', 'na', true);
  const PNA = WP2.T4.probes.naAnswer;
  rec('T4.hrQ1.na', refusedQ1(q1Na, PNA), { expected: { status: statusPart(PNA.value), code: contractOr('HR-Q1', 'refusalCode', `G13; the book states ${codePart(PNA.value)}`), naRelease: contractOr('HR-Q1', 'naRelease', 'G13'), official: 'unchanged' }, observed: q1Na, detail: `HR-Q1 decided (plan :47, :1047): an na answer alone does not release the hold (it needs the approver); RED at HEAD (today ${PNA.today})` });
  obs.hrQ1 = { inProgressPass: q1Pass, na: q1Na };
  // the required signature (an inspection template with requireSignatures inspector, an instance with no activity: no gate)
  const tSig = await send('quality', 'POST', `${P}/forms/templates`, { name: `CERT3 WP2 proof T-SIG ${h.STAMP}`, type: 'inspection', status: 'active', settings: { requireSignatures: ['inspector'] }, sections: [{ title: 'Checks', items: [{ label: 'Area clean, safe and handed over', responseType: 'pass_fail' }] }] });
  const sigItem = itemsOf(tSig.body?.data)[0]?.id || null;
  const sigInst = tSig.status === 201 && sigItem ? await send('quality', 'POST', `${P}/forms`, { templateId: tSig.body.data.id, title: `WP2 proof signature ${h.STAMP}`, inspectorUserId: ctx.people.quality }) : null;
  const sigId = sigInst?.status === 201 ? sigInst.body?.data?.id : null;
  need(Boolean(sigId), `the T-SIG template or instance could not be made (${h.said(tSig)}; ${sigInst ? h.said(sigInst) : 'no instance'})`);
  const sigAnswer = await formRespond('quality', P, sigId, sigItem, 'pass');
  const incomplete = await formAct('quality', P, sigId, 'complete');
  const problems = listOf(incomplete.body?.error?.details?.problems);
  const signed = await send('quality', 'POST', `${P}/forms/${sigId}/signatures`, { role: 'inspector', image: SIGNATURE_IMAGE, signerName: `WP2 proof inspector ${h.STAMP}` });
  const completedSig = await formAct('quality', P, sigId, 'complete');
  rec('T4.signature', sigAnswer.status === 200 && h.is(incomplete, WP2.T4.probes.requiredSignature.value) && problems.some((x) => x.role === 'inspector' && x.reason === 'signature_role') && signed.status === 201 && completedSig.status === 200 && completedSig.body?.data?.status === 'complete',
    { expected: { incomplete: WP2.T4.probes.requiredSignature.value, problem: { role: 'inspector', reason: 'signature_role' }, afterSigning: 'complete' }, observed: { answer: h.said(sigAnswer), incomplete: h.said(incomplete), problems, signed: h.said(signed), complete: h.said(completedSig), status: completedSig.body?.data?.status } });
  // the weekly recurrence (an inspection scheduled for D, every week, interval 1: the next is D + 7)
  const tRec = await send('quality', 'POST', `${P}/forms/templates`, { name: `CERT3 WP2 proof T-REC ${h.STAMP}`, type: 'inspection', status: 'active', sections: [{ title: 'Weekly walk', items: [{ label: 'Housekeeping acceptable', responseType: 'pass_fail' }] }] });
  const recItem = itemsOf(tRec.body?.data)[0]?.id || null;
  const D = daysAgo(1);
  const recInst = tRec.status === 201 && recItem ? await send('quality', 'POST', `${P}/forms`, { templateId: tRec.body.data.id, title: `WP2 proof weekly ${h.STAMP}`, scheduledFor: D, recurrence: { every: 'week', interval: 1 }, inspectorUserId: ctx.people.quality }) : null;
  const recId = recInst?.status === 201 ? recInst.body?.data?.id : null;
  need(Boolean(recId), `the T-REC template or instance could not be made (${h.said(tRec)}; ${recInst ? h.said(recInst) : 'no instance'})`);
  const recAnswer = await formRespond('quality', P, recId, recItem, 'pass');
  const recComplete = await formAct('quality', P, recId, 'complete');
  const next = recComplete.body?.data?.nextInstance || null;
  rec('T4.recurrence', recAnswer.status === 200 && recComplete.status === 200 && Boolean(next) && dayOf(next.scheduledFor) === addDays(D, WP2.T4.probes.weeklyRecurrenceDays.value),
    { expected: { scheduledFor: addDays(D, WP2.T4.probes.weeklyRecurrenceDays.value), days: WP2.T4.probes.weeklyRecurrenceDays.value }, observed: { D, complete: h.said(recComplete), next: next ? { id: next.id, scheduledFor: next.scheduledFor, status: next.status } : null } });

  // ── the daily report on A320 (plan :597; G7, G8: the approver is the PM; the hold is on A320 itself) ──
  const drInst = await holdInstance(P, id.A320, 'DR hold on A320');
  need(Boolean(drInst.id), `the A320 instance could not be made (${h.said(drInst.res)})`);
  const drOpen = await holdPointsOf(P, id.A320);
  const drPct0 = await officialPct(P, id.A320);
  const report = await send('site', 'POST', `${P}/daily-reports`, { activityId: id.A320, date: daysAgo(1), shift: 'day', status: 'submitted', notes: `WP2 progress proof: plastering ${DR_LINE.quantityComplete} ${DR_LINE.unit} ${h.STAMP}`, progress: { method: DR_LINE.method, quantityComplete: DR_LINE.quantityComplete, quantityUnit: DR_LINE.unit }, clientRequestId: `CERT3-WP2-proof-DR-A320-${h.STAMP}` });
  const reportId = report.status === 201 ? report.body?.data?.id || null : null;
  need(Boolean(reportId), `the daily report could not be made (${h.said(report)} ${report.body?.error?.message || ''})`);
  const DR_APPROVER = ROLE_PERSONA[WP2.dailyReport.approver.value];
  const evDRa = await evRead(P);
  const drApprove = await send(DR_APPROVER, 'POST', `${P}/daily-reports/${reportId}/approve`, {});
  rec('DR.approveWithOpenHold', h.is(drApprove, WP2.dailyReport.approveWithOpenHold.value) && num(drOpen?.open) === 1, { expected: { said: WP2.dailyReport.approveWithOpenHold.value, openOnA320: 1, approver: WP2.dailyReport.approver.value }, observed: { said: h.said(drApprove), openOnA320: drOpen?.open ?? null } });
  const reportNow = await dataOf('pm', `${P}/daily-reports/${reportId}`);
  rec('DR.reportStatus', reportNow?.status === WP2.dailyReport.reportStatus.value, { expected: WP2.dailyReport.reportStatus.value, observed: reportNow?.status ?? null });
  const evDRb = await evRead(P);
  const drPct1 = await officialPct(P, id.A320);
  rec('DR.officialUnchanged', drPct1 === drPct0 && evDRb.hash === evDRa.hash, { expected: { official: WP2.dailyReport.officialProgress.value, hash: 'unchanged' }, observed: { before: drPct0, after: drPct1, hashBefore: evDRa.hash, hashAfter: evDRb.hash } });
  obs.anyOpenItp = { dailyReport: h.said(drApprove) };
  // released as HR-Q1 keeps releasing (G8): started, the hold item passed, the instance completed
  const drStart = await formAct('quality', P, drInst.id, 'start');
  const drPass = await formRespond('quality', P, drInst.id, p.tHold.holdItemId, 'pass');
  const drComplete = await formAct('quality', P, drInst.id, 'complete');
  const drReleased = await holdPointsOf(P, id.A320);
  need(drStart.status === 200 && drPass.status === 200 && drComplete.status === 200 && num(drReleased?.open) === 0, `the A320 hold could not be released (${h.said(drStart)} / ${h.said(drPass)} / ${h.said(drComplete)}; open ${drReleased?.open})`);
  const drApprove2 = await send(DR_APPROVER, 'POST', `${P}/daily-reports/${reportId}/approve`, {});
  rec('DR.afterRelease', drApprove2.status === 200 && drApprove2.body?.data?.status === WP2.dailyReport.afterRelease.value, { expected: WP2.dailyReport.afterRelease.value, observed: { said: h.said(drApprove2), status: drApprove2.body?.data?.status, openOnA320: drReleased?.open } });
  const pct320dr = await officialPct(P, id.A320);
  rec('DR.official', r3(pct320dr) === r3(WP2.dailyReport.officialAfterApproval.value), { expected: r3(WP2.dailyReport.officialAfterApproval.value), observed: pct320dr });
  const evDR = await evRead(P);
  rec('DR.evA320', evRowCents(evDR.report, id.A320, 'A320') === WP2.dailyReport.evA320.value, { expected: WP2.dailyReport.evA320.value, observed: evRowCents(evDR.report, id.A320, 'A320') });
  rec('DR.projectEv', evDR.ev === WP2.dailyReport.projectEv.value, { expected: WP2.dailyReport.projectEv.value, observed: evDR.ev });

  // ── QTY: A310 (plan :600-605), refusals before any entry (typedAgain answers first once entries exist) ──
  const QA = WP2.quantitiesA310;
  const evQ0 = await evRead(P);
  const typedZero = await submit('site', P, id.A310, { method: 'quantity', quantityComplete: 0, quantityUnit: UNIT }, 'QTY typed 0');
  const evQ1 = await evRead(P);
  const bare = await submit('site', P, id.A310, { method: 'quantity', pctComplete: 50 }, 'QTY bare percent');
  const evQ2 = await evRead(P);
  const percentMethod = await submit('site', P, id.A310, { method: 'percent', pctComplete: 50 }, 'QTY percent method');
  const evQ3 = await evRead(P);
  rec('QTY.typedZero', h.is(typedZero.res, QA.typedZero.value), { expected: QA.typedZero.value, observed: h.said(typedZero.res) });
  rec('QTY.barePercent', h.is(bare.res, QA.barePercent.value), { expected: QA.barePercent.value, observed: h.said(bare.res) });
  rec('QTY.percentMethod', h.is(percentMethod.res, QA.percentMethod.value), { expected: QA.percentMethod.value, observed: h.said(percentMethod.res) });
  const subs310 = (await submissionsOf(P, id.A310)).length;
  const ents310 = (await entriesOf(P, `activityId=${id.A310}`)).length;
  rec('QTY.refusalsLeaveEv', [evQ1, evQ2, evQ3].every((e) => e.hash === evQ0.hash) && subs310 === 0 && ents310 === 0, { expected: { hash: QA.refusalsLeaveEv.value, submissions: 0, entries: 0 }, observed: { hashes: [evQ0, evQ1, evQ2, evQ3].map((e) => e.hash.slice(0, 12)), submissions: subs310, entries: ents310 } });
  // typed 450
  const typed = await submit('site', P, id.A310, { method: 'quantity', quantityComplete: Q450, quantityUnit: UNIT }, `QTY typed ${Q450}`);
  need(Boolean(typed.id), `the typed ${Q450} submission was not made (${h.said(typed.res)} ${typed.res.body?.error?.message || ''})`);
  const typedApprove = await approve('qs', P, id.A310, typed.id);
  const pct310a = await officialPct(P, id.A310);
  const approved310 = await entriesOf(P, `activityId=${id.A310}&status=approved`);
  const minted = approved310.filter((e) => e.source === 'submission' && Number(e.quantity) === Q450);
  const evTyped = await evRead(P);
  rec('QTY.typed450.pct', typedApprove.status === 200 && r3(pct310a) === r3(QA.typed450.pct.value), { expected: QA.typed450.pct.value, observed: { approve: h.said(typedApprove), official: pct310a } });
  rec('QTY.typed450.entries', approved310.length === QA.typed450.entriesCreated.value && minted.length === 1, { expected: { entries: QA.typed450.entriesCreated.value, source: 'submission', quantity: Q450 }, observed: approved310.map((e) => ({ quantity: e.quantity, source: e.source, status: e.status })) });
  rec('QTY.typed450.ev', evRowCents(evTyped.report, id.A310, 'A310') === QA.typed450.evA310.value, { expected: QA.typed450.evA310.value, observed: evRowCents(evTyped.report, id.A310, 'A310') });
  rec('QTY.typed450.projectEv', evTyped.ev === QA.typed450.projectEv.value, { expected: QA.typed450.projectEv.value, observed: evTyped.ev });
  need(typedApprove.status === 200, `the typed ${Q450} approval failed (${h.said(typedApprove)})`);
  const typedAgain = await submit('site', P, id.A310, { method: 'quantity', quantityComplete: Q450, quantityUnit: UNIT }, 'QTY typed again');
  rec('QTY.typedAgain', h.is(typedAgain.res, QA.typedAgain.value), { expected: QA.typedAgain.value, observed: h.said(typedAgain.res) });
  // a 90 m2 entry bundled (its PATCH refused while the bundle is pending), approved
  const CR90 = `CERT3-WP2-proof-QTY-A310-90-${h.STAMP}`;
  const body90 = { activityId: id.A310, boqItemId: S003, allocationId: alloc310, quantity: Q90, unitCode: UNIT, date: daysAgo(3), status: 'submitted', note: `${CR90} ${Q90} ${UNIT}`, clientRequestId: CR90 };
  const e90 = await send('site', 'POST', `${P}/quantity-progress`, body90);
  const e90id = e90.status === 201 ? e90.body?.data?.entry?.id || null : null;
  need(Boolean(e90id), `the ${Q90} m2 entry was not made (${h.said(e90)} ${e90.body?.error?.message || ''})`);
  const b90 = await submit('site', P, id.A310, { entryIds: [e90id] }, `QTY bundle ${Q90}`);
  need(Boolean(b90.id), `the ${Q90} m2 bundle was not submitted (${h.said(b90.res)})`);
  const patchBundled = await send('site', 'PATCH', `${P}/quantity-progress/${e90id}`, { quantity: Q90 + 1 });
  rec('QTY.patchBundled', h.is(patchBundled, WP2.rules.patchBundledEntry.value), { expected: WP2.rules.patchBundledEntry.value, observed: h.said(patchBundled) });
  const b90approve = await approve('qs', P, id.A310, b90.id);
  const inst540 = await installedOf(P, id.A310);
  const pct310b = await officialPct(P, id.A310);
  const evB90 = await evRead(P);
  rec('QTY.bundle90.installed', b90approve.status === 200 && inst540 === QA.bundle90.installed.value, { expected: QA.bundle90.installed.value, observed: { approve: h.said(b90approve), installed: inst540 } });
  rec('QTY.bundle90.pct', r3(pct310b) === r3(QA.bundle90.pct.value), { expected: QA.bundle90.pct.value, observed: pct310b });
  rec('QTY.bundle90.ev', evRowCents(evB90.report, id.A310, 'A310') === QA.bundle90.evA310.value, { expected: QA.bundle90.evA310.value, observed: evRowCents(evB90.report, id.A310, 'A310') });
  rec('QTY.bundle90.projectEv', evB90.ev === QA.bundle90.projectEv.value, { expected: QA.bundle90.projectEv.value, observed: evB90.ev });
  need(b90approve.status === 200, `the ${Q90} m2 bundle approval failed (${h.said(b90approve)})`);
  // entry refusals, each writing nothing
  const ER = QA.entryRefusals;
  const entriesBefore = (await entriesOf(P, `activityId=${id.A310}`)).length;
  const entryNote = `WP2 progress proof refused entry ${h.STAMP}`;
  const unitM3 = await send('site', 'POST', `${P}/quantity-progress`, { activityId: id.A310, boqItemId: S003, quantity: 5, unitCode: 'm3', date: daysAgo(2), status: 'submitted', note: entryNote });
  const negative = await send('site', 'POST', `${P}/quantity-progress`, { activityId: id.A310, boqItemId: S003, quantity: -5, unitCode: UNIT, date: daysAgo(2), status: 'submitted', note: entryNote });
  const negativeNames = listOf(negative.body?.error?.details).some((d) => /(^|\.)quantity$/.test(String(d?.field || '')));
  const notAllocated = await send('site', 'POST', `${P}/quantity-progress`, { activityId: id.A310, boqItemId: S004, quantity: 5, unitCode: UNIT, date: daysAgo(2), status: 'submitted', note: entryNote });
  const entriesAfter = (await entriesOf(P, `activityId=${id.A310}`)).length;
  rec('QTY.entry.unitM3', h.is(unitM3, ER.unitM3.value) && entriesAfter === entriesBefore, { expected: { said: ER.unitM3.value, written: 0 }, observed: { said: h.said(unitM3), written: entriesAfter - entriesBefore } });
  rec('QTY.entry.negative', h.is(negative, ER.negative.value) && negativeNames && entriesAfter === entriesBefore, { expected: { said: ER.negative.value, details: 'field quantity', planValue: ER.negative.planValue, written: 0 }, observed: { said: h.said(negative), details: negative.body?.error?.details ?? null, written: entriesAfter - entriesBefore } });
  rec('QTY.entry.notAllocated', h.is(notAllocated, ER.notAllocated.value) && entriesAfter === entriesBefore, { expected: { said: ER.notAllocated.value, written: 0 }, observed: { said: h.said(notAllocated), written: entriesAfter - entriesBefore } });
  // the service guard alone, in process (Q4 (b), Q8): only the module failing to load is the probe's setup error; any other
  // answer (a database error under mutation N2 included) is judged, and red unless 400 QUANTITY_NEGATIVE with nothing written
  await probe('QTY.entry.negative.service (P, in process)', async () => {
    let qp;
    try {
      // eslint-disable-next-line global-require
      qp = require('../../../src/services/quantity-progress.service');
    } catch (error) {
      throw new Error(`QTY.entry.negative.service: the service module could not be loaded (a setup error): ${error.message}`);
    }
    let svc;
    try {
      const result = await qp.createEntries({ orgId: ctx.orgs['087'].id, projectId: p.projectId, userId: ctx.people.site, userRole: 'site_engineer', entries: [{ activityId: id.A310, boqItemId: S003, quantity: -5, unitCode: UNIT, date: daysAgo(2), note: entryNote }], source: 'manual', status: 'draft' });
      svc = { threw: false, created: result?.created ?? null, said: 'resolved' };
    } catch (error) {
      svc = { threw: true, name: error?.name || null, said: typeof error?.status === 'number' ? `${error.status} ${error.code}` : `not an HttpError: ${String(error?.message || error).slice(0, 200)}`, field: error?.details?.field ?? null };
    }
    const entriesSvc = (await entriesOf(P, `activityId=${id.A310}`)).length;
    obs.negativeService = { ...svc, written: entriesSvc - entriesBefore };
    rec('QTY.entry.negative.service', svc.said === ER.negativeService.value && entriesSvc === entriesBefore, { expected: { said: ER.negativeService.value, written: 0 }, observed: obs.negativeService });
  });
  const patchApproved = await send('site', 'PATCH', `${P}/quantity-progress/${e90id}`, { quantity: Q90 + 1 });
  rec('QTY.entry.patchApproved', h.is(patchApproved, ER.patchApproved.value), { expected: ER.patchApproved.value, observed: h.said(patchApproved) });
  // the replay by clientRequestId (the same request again), then the CF observation with a different payload
  const replay = await send('site', 'POST', `${P}/quantity-progress`, body90);
  const sameCr = (await entriesOf(P, `activityId=${id.A310}`)).filter((e) => e.clientRequestId === CR90);
  const replayEntry = replay.body?.data?.entry || null;
  rec('QTY.replay.replayed', replay.status === 200 && replayEntry?.replayed === QA.replay.replayed.value && replay.body?.data?.created === 0 && replay.body?.data?.replayed === 1, { expected: { http: 200, replayed: QA.replay.replayed.value, created: 0 }, observed: { said: h.said(replay), replayed: replayEntry?.replayed, created: replay.body?.data?.created, replayCount: replay.body?.data?.replayed } });
  rec('QTY.replay.sameId', (replayEntry?.id === e90id) === QA.replay.sameId.value && sameCr.length === 1, { expected: { sameId: QA.replay.sameId.value, carrying: 1 }, observed: { id: replayEntry?.id, original: e90id, carrying: sameCr.length } });
  const replay95 = await send('site', 'POST', `${P}/quantity-progress`, { ...body90, quantity: 95 });
  obs.replayPayload = { said: h.said(replay95), replayed: replay95.body?.data?.entry?.replayed ?? null, id: replay95.body?.data?.entry?.id ?? null, quantity: num(replay95.body?.data?.entry?.quantity), sent: 95, stored: Q90, sameId: replay95.body?.data?.entry?.id === e90id };
  // the daily log with a 30 m2 quantities row: one entry minted at submit, bundled and approved
  const DL = daysAgo(2);
  const dlTag = `CERT3-WP2-proof-DL-A310-${h.STAMP}`;
  const dlRow = await send('site', 'POST', `${P}/daily-logs/${DL}/entries/quantities`, { activityId: id.A310, boqItemId: S003, allocationId: alloc310, quantity: Q30, unitCode: UNIT, notes: `${dlTag} blockwork laid`, clientRequestId: dlTag });
  const logId = [200, 201].includes(dlRow.status) ? dlRow.body?.data?.id || null : null;
  need(Boolean(logId), `the daily-log quantities row was not recorded (${h.said(dlRow)} ${dlRow.body?.error?.message || ''})`);
  const dlSubmit = await send('site', 'POST', `${P}/daily-logs/${DL}/submit`, {});
  need(dlSubmit.status === 200, `the daily log was not submitted (${h.said(dlSubmit)} ${dlSubmit.body?.error?.message || ''})`);
  const mintedDl = await entriesOf(P, `dailyLogId=${logId}`);
  const oneDl = mintedDl.filter((e) => e.source === 'daily_log' && e.activityId === id.A310 && Number(e.quantity) === Q30 && e.status === 'submitted');
  rec('QTY.dailyLog.entries', mintedDl.length === QA.dailyLog.entries.value && oneDl.length === 1, { expected: { entries: QA.dailyLog.entries.value, source: 'daily_log', status: 'submitted', quantity: Q30 }, observed: mintedDl.map((e) => ({ quantity: e.quantity, source: e.source, status: e.status })) });
  need(oneDl.length === 1, 'the daily log minted no single submitted entry to bundle');
  const dlBundle = await submit('site', P, id.A310, { entryIds: [oneDl[0].id] }, 'QTY daily log bundle');
  const dlApprove = dlBundle.id ? await approve('qs', P, id.A310, dlBundle.id) : null;
  const inst570 = await installedOf(P, id.A310);
  const pct310c = await officialPct(P, id.A310);
  const evDL = await evRead(P);
  rec('QTY.dailyLog.installed', dlApprove?.status === 200 && inst570 === QA.dailyLog.installed.value, { expected: QA.dailyLog.installed.value, observed: { bundle: h.said(dlBundle.res), approve: dlApprove ? h.said(dlApprove) : null, installed: inst570 } });
  rec('QTY.dailyLog.pct', r3(pct310c) === r3(QA.dailyLog.pct.value), { expected: r3(QA.dailyLog.pct.value), observed: pct310c });
  rec('QTY.dailyLog.ev', evRowCents(evDL.report, id.A310, 'A310') === QA.dailyLog.evA310.value, { expected: QA.dailyLog.evA310.value, observed: evRowCents(evDL.report, id.A310, 'A310') });
  rec('QTY.dailyLog.projectEv', evDL.ev === QA.dailyLog.projectEv.value, { expected: QA.dailyLog.projectEv.value, observed: evDL.ev });
  need(dlApprove?.status === 200, `the daily-log bundle approval failed (${dlApprove ? h.said(dlApprove) : h.said(dlBundle.res)})`);
  // the rejected state: a further 10 m2 entry bundled and rejected with a reason; nothing official moves
  const CR10 = `CERT3-WP2-proof-QTY-A310-10-${h.STAMP}`;
  const e10 = await send('site', 'POST', `${P}/quantity-progress`, { activityId: id.A310, boqItemId: S003, allocationId: alloc310, quantity: Q10, unitCode: UNIT, date: daysAgo(1), status: 'submitted', note: `${CR10} ${Q10} ${UNIT}`, clientRequestId: CR10 });
  const e10id = e10.status === 201 ? e10.body?.data?.entry?.id || null : null;
  need(Boolean(e10id), `the ${Q10} m2 entry was not made (${h.said(e10)})`);
  const b10 = await submit('site', P, id.A310, { entryIds: [e10id] }, `QTY bundle ${Q10} (rejected)`);
  need(Boolean(b10.id), `the ${Q10} m2 bundle was not submitted (${h.said(b10.res)})`);
  const r10 = await reject('qs', P, id.A310, b10.id, `WP2 progress proof: measured twice ${h.STAMP}`);
  const e10read = await dataOf('site', `${P}/quantity-progress/${e10id}`);
  rec('QTY.rejected.entryStatus', r10.status === 200 && e10read?.status === QA.rejectedState.entryStatus.value && Boolean(e10read?.rejectedBy && e10read?.rejectedAt && e10read?.rejectionReason), { expected: { status: QA.rejectedState.entryStatus.value, trail: 'rejectedBy, rejectedAt, rejectionReason' }, observed: { reject: h.said(r10), status: e10read?.status, rejectedBy: e10read?.rejectedBy ?? null, rejectedAt: e10read?.rejectedAt ?? null, reason: e10read?.rejectionReason ?? null } });
  const inst570b = await installedOf(P, id.A310);
  const pct310d = await officialPct(P, id.A310);
  const evR10 = await evRead(P);
  rec('QTY.rejected.unchanged', inst570b === QA.dailyLog.installed.value && r3(pct310d) === r3(QA.dailyLog.pct.value) && evRowCents(evR10.report, id.A310, 'A310') === QA.dailyLog.evA310.value, { expected: { official: QA.rejectedState.officialProgress.value, installed: QA.dailyLog.installed.value, pct: r3(QA.dailyLog.pct.value), evA310: QA.dailyLog.evA310.value }, observed: { installed: inst570b, pct: pct310d, evA310: evRowCents(evR10.report, id.A310, 'A310') } });

  // ── Q320: A320 typed 50, then typed 40 (plan :606; HR-P1) ──
  const QB = WP2.quantitiesA320;
  const t50 = await submit('site', P, id.A320, { method: 'quantity', quantityComplete: Q50_A320, quantityUnit: UNIT }, `Q320 typed ${Q50_A320}`);
  need(Boolean(t50.id), `the A320 typed ${Q50_A320} submission was not made (${h.said(t50.res)} ${t50.res.body?.error?.message || ''})`);
  const t50approve = await approve('qs', P, id.A320, t50.id);
  const pct320a = await officialPct(P, id.A320);
  const ev50 = await evRead(P);
  const entries320 = (await entriesOf(P, `activityId=${id.A320}`)).length;
  rec('Q320.typed50.pct', t50approve.status === 200 && r3(pct320a) === r3(QB.typed50.pct.value), { expected: r3(QB.typed50.pct.value), observed: { approve: h.said(t50approve), official: pct320a } });
  rec('Q320.typed50.ev', evRowCents(ev50.report, id.A320, 'A320') === QB.typed50.evA320.value, { expected: QB.typed50.evA320.value, observed: { evA320: evRowCents(ev50.report, id.A320, 'A320'), projectEv: ev50.ev } });
  rec('Q320.typed50.mintSkipped', Boolean(t50approve.body?.data?.quantity?.mintSkipped) === QB.typed50.mintSkipped.value && entries320 === 0, { expected: { mintSkipped: QB.typed50.mintSkipped.value, entriesOnA320: 0 }, observed: { mintSkipped: t50approve.body?.data?.quantity?.mintSkipped ?? null, entriesOnA320: entries320 } });
  const t40 = await submit('site', P, id.A320, { method: 'quantity', quantityComplete: Q40_A320, quantityUnit: UNIT }, `Q320 typed ${Q40_A320}`);
  const warning = listOf(t40.res.body?.data?.submission?.warnings).find((w) => w?.code === QB.typed40.warning.value) || null;
  rec('Q320.typed40.warning', t40.res.status === 200 && Boolean(warning) && num(warning.officialInstalled) === QB.typed40.officialInstalled.value && num(warning.typed) === QB.typed40.typed.value, { expected: { code: QB.typed40.warning.value, officialInstalled: QB.typed40.officialInstalled.value, typed: QB.typed40.typed.value }, observed: { said: h.said(t40.res), warnings: t40.res.body?.data?.submission?.warnings ?? null } });
  // HR-P1 (decided): a plain approval of the lower figure (no correction, no reason) is refused and nothing is lowered. Where the
  // reason is given and the refusal's code are the fix plan's contract (G12): judged is 'refused (4xx) and not lowered'. Never
  // throws on the answer (RED at HEAD = FAIL, exit 2); a typed-40 submission refused at submit is recorded, not thrown.
  const pct320before = await officialPct(P, id.A320);
  const plain = t40.id ? await approve('qs', P, id.A320, t40.id) : null;
  const pct320plain = await officialPct(P, id.A320);
  const refusedPlain = Boolean(plain) && plain.status >= 400 && plain.status < 500 && (CONTRACT['HR-P1'].lowerFigureRefusal === null || h.said(plain) === CONTRACT['HR-P1'].lowerFigureRefusal);
  rec('Q320.typed40.reasonRequired', refusedPlain && pct320plain === pct320before, { expected: { approval: `refused (${contractOr('HR-P1', 'lowerFigureRefusal', 'G12: status, code and where the reason is given')})`, official: 'not lowered' }, observed: { said: plain ? h.said(plain) : `not sent: the typed-${Q40_A320} submission answered ${h.said(t40.res)}`, officialBefore: pct320before, officialAfter: pct320plain }, detail: `HR-P1 decided (plan :48, :1037): a lower figure needs an explicit, authorised correction with a reason; RED at HEAD (today: 200, lowered silently, the QUANTITY_BELOW_OFFICIAL warning the only sign)` });
  let correction = null;
  if (refusedPlain && typeof CONTRACT['HR-P1'].lowerFigureCorrection === 'function') correction = await CONTRACT['HR-P1'].lowerFigureCorrection({ send, P, activityId: id.A320, submissionId: t40.id, reason: `WP2 progress proof: re-measured ${h.STAMP}` });
  const pct320 = await officialPct(P, id.A320);
  const ev40 = await evRead(P);
  const correctionNote = refusedPlain && !correction ? `the plain approval was refused and the explicit correction is ${PENDING} (G12): the proof cannot make it yet` : '';
  obs.hrp1 = { ...(obs.hrp1 || {}), lowerTyped: { submit: h.said(t40.res), plain: plain ? h.said(plain) : null, refusedPlain, correction: correction ? h.said(correction) : null, officialBefore: pct320before, officialAfter: pct320 } };
  rec('Q320.typed40.pct', r3(pct320) === r3(QB.typed40.pctAfterApproval.value), { expected: r3(QB.typed40.pctAfterApproval.value), observed: { official: pct320, path: refusedPlain ? (correction ? 'correction' : 'none') : 'plain approval (HEAD)' }, detail: correctionNote });
  rec('Q320.typed40.ev', evRowCents(ev40.report, id.A320, 'A320') === QB.typed40.evA320.value, { expected: QB.typed40.evA320.value, observed: evRowCents(ev40.report, id.A320, 'A320'), detail: correctionNote });
  rec('Q320.typed40.projectEv', ev40.ev === QB.typed40.projectEv.value, { expected: QB.typed40.projectEv.value, observed: ev40.ev, detail: correctionNote });

  // ── BULK: one transaction (plan :609), before T6 (G6: A330's official is 0, so HR-P1 cannot refuse update 0) ──
  const BK = WP2.bulk;
  const count330 = async () => (await submissionsOf(P, id.A330)).length;
  const c0 = await count330();
  const mixed = await send('planner', 'POST', `${P}/activities/bulk-progress`, { updates: [{ activityId: id.A330, pctComplete: 10, status: 'submitted', source: 'manual' }, { activityId: id.A310, method: 'percent', pctComplete: 10, status: 'submitted', source: 'manual' }] });
  const c1 = await count330();
  const mixedBatch = mixed.body?.error?.details?.batch || null;
  rec('BULK.mixed.refusal', h.is(mixed, BK.mixedBatch.refusal.value), { expected: BK.mixedBatch.refusal.value, observed: h.said(mixed) });
  rec('BULK.mixed.index', num(mixedBatch?.index) === BK.mixedBatch.index.value && num(mixedBatch?.written) === BK.mixedBatch.written.value && num(mixedBatch?.updates) === 2, { expected: { index: BK.mixedBatch.index.value, written: BK.mixedBatch.written.value, updates: 2 }, observed: mixedBatch });
  rec('BULK.mixed.count', c1 - c0 === BK.mixedBatch.a330SubmissionsDelta.value, { expected: BK.mixedBatch.a330SubmissionsDelta.value, observed: { before: c0, after: c1 } });
  const random = await send('planner', 'POST', `${P}/activities/bulk-progress`, { updates: [{ activityId: id.A330, pctComplete: 10, status: 'submitted', source: 'manual' }, { activityId: crypto.randomUUID(), pctComplete: 10, status: 'submitted', source: 'manual' }] });
  const c2 = await count330();
  const randomBatch = random.body?.error?.details?.batch || null;
  rec('BULK.random.refusal', h.is(random, BK.randomId.refusal.value), { expected: BK.randomId.refusal.value, observed: h.said(random) });
  rec('BULK.random.index', num(randomBatch?.index) === BK.randomId.index.value && num(randomBatch?.written) === 0 && c2 === c1, { expected: { index: BK.randomId.index.value, written: 0, a330: 'unchanged' }, observed: { batch: randomBatch, a330: [c1, c2] } });
  const c110 = (await submissionsOf(P, id.A110)).length;
  const siteBatch = await send('site', 'POST', `${P}/activities/bulk-progress`, { updates: [{ activityId: id.A110, pctComplete: 45, status: 'submitted', source: 'manual' }, { activityId: id.A330, pctComplete: 50, status: 'submitted', source: 'manual' }] });
  const c110b = (await submissionsOf(P, id.A110)).length;
  const c3 = await count330();
  rec('BULK.site.refusal', h.is(siteBatch, BK.siteWithA330.refusal.value) && sameList(siteBatch.body?.error?.details?.activityIds, [id.A330]), { expected: { said: BK.siteWithA330.refusal.value, activityIds: ['A330'] }, observed: { said: h.said(siteBatch), activityIds: siteBatch.body?.error?.details?.activityIds ?? null } });
  rec('BULK.site.written', c110b - c110 === BK.siteWithA330.written.value && c3 - c2 === BK.siteWithA330.written.value, { expected: BK.siteWithA330.written.value, observed: { A110: [c110, c110b], A330: [c2, c3] } });

  // ── T5: the method lock (plan :598) ──
  const toQuantity = await send('planner', 'PUT', `${A('A110')}/progress-method`, { method: 'quantity', quantityUnit: UNIT });
  rec('T5.toQuantity', h.is(toQuantity, WP2.T5.A110toQuantity.value), { expected: WP2.T5.A110toQuantity.value, observed: h.said(toQuantity) });
  const toPercent = await send('planner', 'PUT', `${A('A110')}/progress-method`, { ...METHOD_CONFIG.A110, notes: `WP2 progress proof T5 ${h.STAMP}` });
  rec('T5.toPercent', toPercent.status === WP2.T5.A110toPercent.value, { expected: WP2.T5.A110toPercent.value, observed: h.said(toPercent) });

  // ── T6: the older, lower approval (HR-P1, decided) and the method bypass (HR-P2, undecided) (plan :599) ──
  const s2 = await submit('planner', P, id.A330, { pctComplete: S2_PCT }, 'T6 s2 A330');
  need(Boolean(s2.id), `the planner's A330 s2 was not made (${h.said(s2.res)})`);
  const s2approve = await approve('planner', P, id.A330, s2.id);
  need(s2approve.status === 200, `the planner's approval of their own A330 s2 failed (${h.said(s2approve)}): T6 needs a newer approved figure`);
  const audit = await ctx.q('select action, "actorId" as actor from "AuditEvent" where "entityType" = $1 and "entityId" = $2 and action = any($3::text[]) order by "occurredAt"', ['progress_submission', s2.id, ['created', 'approved']]);
  const createdBy = audit.filter((a) => a.action === 'created').map((a) => a.actor);
  const approvedBy = audit.filter((a) => a.action === 'approved').map((a) => a.actor);
  obs.hrp4 = { approve: h.said(s2approve), createdBy, approvedBy, planner: ctx.people.planner, sameActor: createdBy.length === 1 && approvedBy.length === 1 && createdBy[0] === approvedBy[0] && approvedBy[0] === ctx.people.planner };
  const pct330a = await officialPct(P, id.A330);
  const s1approve = await approve('qs', P, id.A330, p.s1);
  const pct330 = await officialPct(P, id.A330);
  obs.hrp1 = { ...(obs.hrp1 || {}), olderLower: { s2: S2_PCT, s1: S1_PCT, officialAfterS2: pct330a, approveS1: h.said(s1approve), officialAfter: pct330 } };
  const OL = WP2.T6.olderLowerApproval;
  rec('T6.olderLower.refusal', s1approve.status === OL.refusal.value && (CONTRACT['HR-P1'].olderAfterNewerCode === null || s1approve.body?.error?.code === CONTRACT['HR-P1'].olderAfterNewerCode), { expected: { status: OL.refusal.value, code: contractOr('HR-P1', 'olderAfterNewerCode', 'G12') }, observed: { said: h.said(s1approve), officialAfterS2: pct330a }, detail: `HR-P1 decided (plan :48, :1037): approving an older submission after a newer approved one is refused; RED at HEAD (today ${OL.refusal.today})` });
  rec('T6.olderLower.official', pct330 === OL.official.value, { expected: OL.official.value, observed: pct330, detail: `HR-P1 decided: the official figure stays the newer one; RED at HEAD (today ${OL.official.today})` });
  await probe('KA.T6.methodBypass (P, A300)', async () => {
    const aid = id[MB.activity];
    const first = await submit('site', P, aid, { pctComplete: MB.approvedPercent }, `T6 ${MB.activity} percent ${MB.approvedPercent}`);
    const firstApprove = first.id ? await approve('qs', P, aid, first.id) : null;
    const pctFirst = await officialPct(P, aid);
    if (firstApprove?.status !== 200 || pctFirst !== MB.approvedPercent) throw probeSetup('KA.T6.methodBypass', `${MB.activity} could not be approved at percent ${MB.approvedPercent} (${h.said(first.res)}; ${firstApprove ? h.said(firstApprove) : 'not sent'}; official ${pctFirst})`);
    const qty = await submit('site', P, aid, { progressMethod: 'quantity', quantityComplete: MB.quantityComplete, quantityPlanned: MB.quantityPlanned }, `T6 ${MB.activity} quantity ${MB.quantityComplete} of ${MB.quantityPlanned}`);
    const qApprove = qty.id ? await approve('qs', P, aid, qty.id) : null;
    const pctAfter = await officialPct(P, aid);
    const observed = { submit: h.said(qty.res), approve: qApprove ? h.said(qApprove) : null, method: qApprove?.body?.data?.method ?? qty.res.body?.data?.submission?.method ?? null, officialBefore: pctFirst, officialAfter: pctAfter };
    obs.methodBypass = observed;
    const leaf = WP2.T6.methodBypass;
    const pctToday = (MB.quantityComplete / MB.quantityPlanned) * 100;
    ka('KA.T6.methodBypass', { ref: leaf.ref, value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (o) => (o.submit.startsWith(`${leaf.value}`) || String(o.approve || '').startsWith(`${leaf.value}`)) && o.officialAfter === MB.approvedPercent, (o) => o.approve === '200' && r3(o.officialAfter) === r3(pctToday) && o.method === 'quantity'), detail: 'the code is not asserted (HR-P2 undecided); percentages compared to 3 dp' });
  });

  // ── METHOD.stands (A220; G3, Q5): the approval-time method rule, the catcher of the method-stands mutation ──
  await h.section('METHOD.stands (P, A220)', async () => {
    const M = WP2.methodStands;
    const aid = id.A220;
    const sub = await submit('site', P, aid, { method: 'percent', pctComplete: 10 }, 'METHOD.stands A220 percent 10');
    if (!sub.id) throw new Error(`METHOD.stands: the A220 percent submission was not made (${h.said(sub.res)}): a setup error`);
    const put = await send('planner', 'PUT', `${A('A220')}/progress-method`, { method: 'quantity', quantityUnit: UNIT, notes: `WP2 progress proof METHOD.stands ${h.STAMP}` });
    if (put.status !== 200) throw new Error(`METHOD.stands: the planner could not configure A220 as quantity (${h.said(put)}): a setup error`);
    const ap = await approve('qs', P, aid, sub.id);
    const pct = await officialPct(P, aid);
    const status = await statusOf(P, aid, sub.id);
    rec('METHOD.stands', h.is(ap, M.approve.value) && (ap.body?.error?.details?.submissionId === sub.id) === M.detailsSubmissionId.value && pct === M.official.value && status === 'submitted', { expected: { said: M.approve.value, detailsSubmissionId: M.detailsSubmissionId.value, official: M.official.value, submission: 'still submitted' }, observed: { said: h.said(ap), details: ap.body?.error?.details ?? null, official: pct, status } });
  });

  // ── IMP: the progress import on P after the quantity chain (plan :610-611; WP2ADJ Q1) ──
  const IP = WP2.importProgress;
  const inst2 = await holdInstance(P, id.A130, 'A130 #2 (import)');
  need(Boolean(inst2.id), `instance #2 on A130 could not be made (${h.said(inst2.res)})`);
  p.inst2 = inst2.id;
  const file = ctx.files.progress;
  if (ctx.state['087-SCH']) {
    const pf = outOf(ctx.state['087-SCH'], 'progress.file');
    let savedSha;
    try { savedSha = sha256(fs.readFileSync(pf.path)); } catch (error) { savedSha = `unreadable: ${error.message}`; }
    const stated = Object.fromEntries(xerTasks(file.body).map((t) => [t.task_code, num(t.phys_complete_pct)]));
    rec('IMP.file', sameJson(stated, IP.file.value) && file.sha256 === pf.sha256 && savedSha === pf.sha256, { expected: { rows: IP.file.value, sha256: pf.sha256 }, observed: { rows: stated, generated: file.sha256, saved: savedSha, path: pf.path } });
  }
  const rowsOf = (res) => Object.fromEntries(listOf(res.body?.data?.rows).map((r) => [r.p6ActivityId, r]));
  const apBefore = await progressRowsOn(p.projectId);
  const evImp0 = await evRead(P);
  const siteUp = await upload('site', `${P}/import/progress`, file, { format: 'xer' });
  const sr = rowsOf(siteUp);
  const apAfter = await progressRowsOn(p.projectId);
  const evImp1 = await evRead(P);
  rec('IMP.site.delta0', siteUp.status === 200 && sr.A110?.status === 'submitted' && sr.A130?.status === 'submitted' && apAfter - apBefore === IP.site.activityProgressDelta.value, { expected: { A110: 'submitted', A130: 'submitted', delta: IP.site.activityProgressDelta.value }, observed: { said: h.said(siteUp), rows: Object.fromEntries(Object.entries(sr).map(([c, r]) => [c, r.status])), delta: apAfter - apBefore } });
  rec('IMP.site.ev', evImp1.hash === evImp0.hash, { expected: IP.site.ev.value, observed: { before: evImp0.hash, after: evImp1.hash } });
  rec('IMP.site.A310row', sr.A310?.status === 'refused' && sr.A310?.reason?.code === codePart(IP.site.A310row.value), { expected: { status: 'refused', code: codePart(IP.site.A310row.value) }, observed: sr.A310 ? { status: sr.A310.status, reason: sr.A310.reason } : null });
  const subsBefore = { A110: (await submissionsOf(P, id.A110)).length, A130: (await submissionsOf(P, id.A130)).length };
  const siteAgain = await upload('site', `${P}/import/progress`, file, { format: 'xer' });
  const ar = rowsOf(siteAgain);
  const subsAfter = { A110: (await submissionsOf(P, id.A110)).length, A130: (await submissionsOf(P, id.A130)).length };
  const apAgain = await progressRowsOn(p.projectId);
  const wantRows = IP.site.reuploadRows.value;
  rec('IMP.site.reupload', siteAgain.status === 200 && Object.entries(wantRows).every(([c, s]) => ar[c]?.status === s) && sameJson(subsBefore, subsAfter) && apAgain === apAfter, { expected: { rows: wantRows, written: 0 }, observed: { said: h.said(siteAgain), rows: Object.fromEntries(Object.entries(ar).map(([c, r]) => [c, r.status])), submissions: [subsBefore, subsAfter], progressRows: [apAfter, apAgain] } });
  const pct130before = await officialPct(P, id.A130);
  const evPm0 = await evRead(P);
  const pmUp = await upload('pm', `${P}/import/progress`, file, { format: 'xer' });
  const pr = rowsOf(pmUp);
  const pct110pm = await officialPct(P, id.A110);
  const pct130after = await officialPct(P, id.A130);
  const evPm1 = await evRead(P);
  rec('IMP.pm.A110official', pmUp.status === 200 && pr.A110?.status === 'approved' && pr.A110?.approvesPending === IP.pm.A110approvesPending.value && pct110pm === IP.pm.A110official.value, { expected: { status: 'approved', approvesPending: IP.pm.A110approvesPending.value, official: IP.pm.A110official.value }, observed: { said: h.said(pmUp), row: pr.A110 ? { status: pr.A110.status, approvesPending: pr.A110.approvesPending } : null, official: pct110pm } });
  rec('IMP.pm.evA110', evRowCents(evPm1.report, id.A110, 'A110') === IP.pm.evA110.value, { expected: IP.pm.evA110.value, observed: evRowCents(evPm1.report, id.A110, 'A110') });
  rec('IMP.pm.evDelta', evPm1.ev - evPm0.ev === IP.pm.evDelta.value && evPm1.ev === IP.pm.projectEvAfter.value, { expected: { delta: IP.pm.evDelta.value, projectEvAfter: IP.pm.projectEvAfter.value }, observed: { before: evPm0.ev, after: evPm1.ev, delta: evPm1.ev - evPm0.ev } });
  const A130row = stateAndCode(IP.pm.A130row.value);
  rec('IMP.pm.A130row', pr.A130?.status === A130row.state && pr.A130?.reason?.code === A130row.code && pct130after === pct130before, { expected: { ...A130row, official: 'unchanged' }, observed: { row: pr.A130 ? { status: pr.A130.status, reason: pr.A130.reason } : null, official: [pct130before, pct130after] } });
  obs.anyOpenItp = { ...(obs.anyOpenItp || {}), importA130: pr.A130 ? `${pr.A130.status} ${pr.A130.reason?.code || ''}`.trim() : null };

  // ── T4 void, on instance #2 (plan :594) ──
  const siteVoid = await formAct('site', P, p.inst2, 'void', { reason: `WP2 progress proof: site void ${h.STAMP}` });
  rec('T4.void.site', h.is(siteVoid, WP2.T4.siteVoid.value), { expected: WP2.T4.siteVoid.value, observed: h.said(siteVoid) });
  const voidNoReason = await formAct('quality', P, p.inst2, 'void', {});
  const inst2now = await dataOf('quality', `${P}/forms/${p.inst2}`);
  rec('T4.void.noReason', h.is(voidNoReason, WP2.T4.voidWithoutReason.value) && inst2now?.status === 'scheduled', { expected: { said: WP2.T4.voidWithoutReason.value, status: 'scheduled' }, observed: { said: h.said(voidNoReason), status: inst2now?.status } });
  const voided = await formAct('quality', P, p.inst2, 'void', { reason: `WP2 progress proof: the import's hold released ${h.STAMP}` });
  const openAfterVoid = await holdPointsOf(P, id.A130);
  rec('T4.void.released', voided.status === 200 && voided.body?.data?.status === 'void' && num(openAfterVoid?.open) === 0, { expected: { state: WP2.T4.voidWithReason.value, status: 'void', open: 0 }, observed: { said: h.said(voided), status: voided.body?.data?.status, open: openAfterVoid?.open } });

  // ── T7 last: approval on an activity retired by activation (HR-S9, undecided) ──
  await probe('KA.T7.retired (P, A140)', async () => {
    const sub = await submit('site', P, id.A140, { pctComplete: 10 }, 'T7 A140');
    if (!sub.id) throw probeSetup('KA.T7.retired', `the A140 submission could not be made (${h.said(sub.res)})`);
    const f1r = await upload('planner', `${P}/import/xer`, files.xer(ctx.files.f1r, { filename: `CERT3-WP2-proof-F1r-${h.STAMP}.xer` }));
    const revisionId = f1r.status === 201 ? f1r.body?.data?.revisionId || null : null;
    const reviewed = revisionId ? await review(P, revisionId, 'F1r') : null;
    if (!reviewed?.ok) throw probeSetup('KA.T7.retired', `F1r could not be staged and approved (${h.said(f1r)}; ${reviewed ? `${h.said(reviewed.submitted)} / ${h.said(reviewed.approved)}` : 'not reviewed'})`);
    const act = await activateSuggested(P, revisionId, 'F1r');
    const retired = listOf(act.activation?.retiredActivities).map((r) => (typeof r === 'string' ? r : r?.id));
    const a140 = (await ctx.q('select "isActive" as active from "Activity" where id = $1', [id.A140]))[0];
    if (act.res.status !== 200 || !retired.includes(id.A140) || a140?.active !== false) throw probeSetup('KA.T7.retired', `F1r did not retire A140 (${h.said(act.res)} ${act.res.body?.error?.message || ''}; retired ${json(retired)}; A140 active ${a140?.active})`);
    const ap = await approve('qs', P, id.A140, sub.id);
    const rows = Number((await ctx.q('select count(*)::int as n from "ActivityProgress" where "submissionId" = $1', [sub.id]))[0].n);
    const observed = { approve: h.said(ap), progressRows: rows, activityActive: false };
    obs.retired = observed;
    const leaf = WP2.T7.retiredActivityApproval;
    ka('KA.T7.retired', { ref: 'HR-S9', value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (o) => statusPart(o.approve) === leaf.value && o.progressRows === 0, (o) => o.approve === '200' && o.progressRows === 1) });
  });
};

// ── 087-SCH: the quantity view, the stored moments, the live end state ─────────
const schFlow = async () => {
  const { P } = ctx.deep['087-SCH'];
  const st = ctx.state['087-SCH'];
  const out = (step) => outOf(st, step);
  const by = byCode(await activitiesOf('pm', P));
  const A310 = by.get('A310')?.id || null;
  const A130 = by.get('A130')?.id || null;
  const S003 = out('boq.upload').items?.['S-003'] || null;
  if (!A310 || !A130 || !S003) throw new Error(`087-SCH: A310 ${A310}, A130 ${A130} or S-003 ${S003} not found (a setup error)`);
  const Q = WP2.quantityView;
  if (on('VIEW')) {
    const view = await get('qs', `${P}/boq/items/${S003}/quantities`);
    const v = view.body?.data;
    const fig = (k) => num(v?.figures?.[k]?.value);
    const figureOk = (key) => view.status === 200 && fig(key) === Q[key].value;
    const figureRecord = (key) => ({ expected: Q[key].value, observed: { said: h.said(view), value: fig(key), unit: v?.figures?.[key]?.unitCode ?? null } });
    rec('VIEW.installed', figureOk('installed'), figureRecord('installed'));
    rec('VIEW.committed', figureOk('committed'), figureRecord('committed'));
    rec('VIEW.received', figureOk('received'), figureRecord('received'));
    rec('VIEW.issued', figureOk('issued'), figureRecord('issued'));
    rec('VIEW.certified', figureOk('certified'), figureRecord('certified'));
    rec('VIEW.paid', figureOk('paid'), figureRecord('paid'));
    rec('VIEW.certifiedAboveInstalled', view.status === 200 && v?.comparisons?.certifiedOverInstalled?.flag === Q.certifiedAboveInstalled.value, { expected: Q.certifiedAboveInstalled.value, observed: v?.comparisons?.certifiedOverInstalled ?? null });
    const W = Q.withoutBoqRead;
    const withheld = await get('noBoq', `${P}/activities/${A310}/quantities`);
    const w = withheld.body?.data;
    const figures = Object.values(w?.figures || {});
    // eslint-disable-next-line global-require
    const WITHHELD = require('../../../src/utils/boq-figures').QUANTITY_FIGURES_WITHHELD;
    rec('VIEW.withheld.http', withheld.status === W.http.value, { expected: W.http.value, observed: h.said(withheld) });
    rec('VIEW.withheld.flag', w?.withheld === W.withheld.value && figures.length > 0 && figures.every((f) => f?.value === null), { expected: { withheld: W.withheld.value, figures: 'every value null' }, observed: { withheld: w?.withheld, values: figures.map((f) => f?.value) } });
    rec('VIEW.withheld.reason', w?.reason === W.reason.value && W.reason.value === WITHHELD, { expected: { reason: W.reason.value, constant: 'boq-figures QUANTITY_FIGURES_WITHHELD' }, observed: { reason: w?.reason ?? null, constantMatchesBook: W.reason.value === WITHHELD } });
    const itemRoute = await get('noBoq', `${P}/boq/items/${S003}/quantities`);
    rec('VIEW.itemRoute', h.is(itemRoute, W.itemRoute.value), { expected: W.itemRoute.value, observed: h.said(itemRoute) });
  }
  if (on('SCH')) {
    const QA = WP2.quantitiesA310;
    rec('SCH.stored.barePercent', out('qty.barePercent').said === QA.barePercent.value, { expected: QA.barePercent.value, observed: out('qty.barePercent').said });
    const ev450 = storedCents('087-SCH', 'qty.typed450.evA310.ev', out('qty.typed450').evA310?.ev);
    rec('SCH.stored.typed450', ev450 === QA.typed450.evA310.value, { expected: QA.typed450.evA310.value, observed: { stored: out('qty.typed450').evA310?.ev, unit: 'units', cents: ev450 } });
    const ev540 = storedCents('087-SCH', 'qty.bundle90.evA310.ev', out('qty.bundle90').evA310?.ev);
    rec('SCH.stored.bundle90', ev540 === QA.bundle90.evA310.value, { expected: QA.bundle90.evA310.value, observed: { stored: out('qty.bundle90').evA310?.ev, unit: 'units', cents: ev540 } });
    rec('SCH.stored.replay', out('qty.replay').replayed === QA.replay.replayed.value && out('qty.replay').entryId === out('qty.bundle90').entryId, { expected: { replayed: QA.replay.replayed.value, entryId: out('qty.bundle90').entryId }, observed: out('qty.replay') });
    const ev570 = storedCents('087-SCH', 'qty.dailylog570.evA310.ev', out('qty.dailylog570').evA310?.ev);
    rec('SCH.stored.dailyLog', ev570 === QA.dailyLog.evA310.value && num(out('qty.dailylog570').evA310?.pct) === QA.dailyLog.evReportPct.value, { expected: { evA310: QA.dailyLog.evA310.value, evReportPct: QA.dailyLog.evReportPct.value }, observed: { stored: out('qty.dailylog570').evA310?.ev, unit: 'units', cents: ev570, pct: out('qty.dailylog570').evA310?.pct } });
    const states = out('qty.pending').states || [];
    rec('SCH.stored.rejected', Boolean(out('qty.rejected10').entryId) && ['approved', 'draft', QA.rejectedState.entryStatus.value, 'submitted'].every((s) => states.includes(s)), { expected: { states: ['approved', 'draft', 'rejected', 'submitted'] }, observed: { states, rejected10: out('qty.rejected10') } });
    const dry = Object.fromEntries(out('progress.file').rows || []);
    rec('SCH.stored.importDryRun', dry.A110 === 'submit' && dry.A130 === 'submit' && dry.A310 === 'refuse', { expected: { A110: 'submit', A130: 'submit', A310: `refuse (${WP2.importProgress.site.A310row.value})` }, observed: dry });
    // live (writes nothing): the entries on A310, the build's replay, A130's open hold
    const all = listOf(await dataOf('site', `${P}/quantity-progress?activityId=${A310}`));
    const installed = all.filter((e) => e.status === 'approved').reduce((s, e) => s + Number(e.quantity), 0);
    const liveStates = [...new Set(all.map((e) => e.status))].sort();
    const rejectedNow = all.find((e) => e.id === out('qty.rejected10').entryId)?.status ?? null;
    rec('SCH.live.installed', installed === QA.dailyLog.installed.value && ['approved', 'draft', 'rejected', 'submitted'].every((s) => liveStates.includes(s)) && rejectedNow === QA.rejectedState.entryStatus.value, { expected: { installed: QA.dailyLog.installed.value, states: ['approved', 'draft', 'rejected', 'submitted'], rejected10: QA.rejectedState.entryStatus.value }, observed: { installed, states: liveStates, rejected10: rejectedNow } });
    const original = st.records?.['entry.A310-90']?.data?.entry || {};
    const carrying = all.filter((e) => e.clientRequestId === original.clientRequestId);
    let replay = null;
    // A replay writes nothing: it is sent only when exactly the build's entry carries the clientRequestId (else a POST would create one)
    if (carrying.length === 1 && carrying[0].id === out('qty.bundle90').entryId) {
      replay = await send('site', 'POST', `${P}/quantity-progress`, { activityId: A310, boqItemId: S003, allocationId: out('boq.allocations')['S-003.A310'], quantity: num(original.quantity), unitCode: original.unitCode || UNIT, date: String(original.date || '').slice(0, 10), status: 'submitted', note: `${original.clientRequestId} replayed by the WP-2 proof`, clientRequestId: original.clientRequestId });
    }
    const re = replay?.body?.data;
    const carryingAfter = listOf(await dataOf('site', `${P}/quantity-progress?activityId=${A310}`)).filter((e) => e.clientRequestId === original.clientRequestId).length;
    rec('SCH.live.replay', Boolean(replay) && replay.status === 200 && re?.entry?.replayed === QA.replay.replayed.value && re?.entry?.id === out('qty.bundle90').entryId && re?.created === 0 && carryingAfter === 1, { expected: { replayed: QA.replay.replayed.value, id: out('qty.bundle90').entryId, created: 0 }, observed: replay ? { said: h.said(replay), replayed: re?.entry?.replayed, id: re?.entry?.id, created: re?.created, carryingAfter } : { sent: false, carrying: carrying.map((e) => e.id) } });
    ctx.schReplaySent = Boolean(replay);
    const hp = await dataOf('quality', `${P}/forms/hold-points?activityId=${A130}`);
    const mine = listOf(hp?.holdPoints).filter((x) => x.instanceId === out('itp').instanceId);
    rec('SCH.live.A130hold', num(hp?.open) === WP2.endState087SCH.A130openHolds.value && mine.length === 1 && mine[0].state === WP2.T4.holdState.value, { expected: { open: WP2.endState087SCH.A130openHolds.value, state: WP2.T4.holdState.value, instance: out('itp').instanceId }, observed: { open: hp?.open, mine } });
  }
};

// ── 087-FLD: the stored before-edit moment and the live after-edit hold points (HR-Q2) ─────
const fldFlow = async () => {
  const st = ctx.state['087-FLD'];
  const before = outOf(st, 'itp.holds.before-edit');
  rec('FLD.beforeEdit', sameJson(before, WP2.T4.probes.retroactiveBeforeEdit.value), { expected: WP2.T4.probes.retroactiveBeforeEdit.value, observed: before });
  await probe('KA.T4.retroactive (087-FLD)', async () => {
    const { P } = ctx.deep['087-FLD'];
    const leaf = WP2.T4.probes.retroactiveTemplateEdit;
    const by = byCode(await activitiesOf('pm', P));
    const codes = Object.keys(leaf.value);
    const missing = codes.filter((c) => !by.get(c));
    if (missing.length) throw probeSetup('KA.T4.retroactive', `087-FLD activities ${missing.join(', ')} not found`);
    const observed = {};
    for (const code of codes) {
      const res = await get('quality', `${P}/forms/hold-points?activityId=${by.get(code).id}`);
      if (res.status !== 200) throw probeSetup('KA.T4.retroactive', `hold points of ${code} answered ${h.said(res)}`);
      observed[code] = { open: num(res.body?.data?.open), states: listOf(res.body?.data?.holdPoints).map((x) => x.state).sort() };
    }
    obs.retroactive = observed;
    ka('KA.T4.retroactive', { ref: leaf.ref, value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (o) => sameJson(o, leaf.value), (o) => sameJson(o, leaf.today)) });
  });
};

// ── 052-SCH-EV: the stored WP-2 moments (WP2ADJ Q9) ───────────────────────────
const d2Flow = async () => {
  const st = ctx.state['052-SCH-EV'];
  const o = (step) => outOf(st, step);
  const t1 = storedCents('052-SCH-EV', 'wp2.T1.ev.ev', o('wp2.T1.ev').ev);
  rec('D2.T1ev', t1 === D2.WP2.T1ev.value, { expected: D2.WP2.T1ev.value, observed: { stored: o('wp2.T1.ev').ev, unit: 'units', cents: t1 } });
  const t3 = storedCents('052-SCH-EV', 'wp2.T3.ev.ev', o('wp2.T3.ev').ev);
  rec('D2.T3ev', t3 === D2.WP2.T3ev.value, { expected: D2.WP2.T3ev.value, observed: { stored: o('wp2.T3.ev').ev, unit: 'units', cents: t3 } });
  const t4 = storedCents('052-SCH-EV', 'wp2.T4.ev', o('wp2.T4').ev);
  rec('D2.T4ev', t4 === D2.WP2.T4ev.value, { expected: D2.WP2.T4ev.value, observed: { stored: o('wp2.T4').ev, unit: 'units', cents: t4 } });
  const q2 = o('wp2.qty.T2');
  const QA = WP2.quantitiesA310;
  rec('D2.qtyT2', storedCents('052-SCH-EV', 'wp2.qty.T2.evA310', q2.evA310) === D2.WP2.quantityT2evA310.value && q2.typedZero === QA.typedZero.value && q2.typedAgain === QA.typedAgain.value && q2.entries === QA.typed450.entriesCreated.value && num(q2.official) === QA.typed450.pct.value,
    { expected: { evA310: D2.WP2.quantityT2evA310.value, typedZero: QA.typedZero.value, typedAgain: QA.typedAgain.value, entries: QA.typed450.entriesCreated.value, official: QA.typed450.pct.value }, observed: { ...q2, unit: 'cents' } });
  const q3 = o('wp2.qty.T3');
  rec('D2.qtyT3', storedCents('052-SCH-EV', 'wp2.qty.T3.evA310', q3.evA310) === D2.WP2.quantityT3evA310.value && num(q3.installed) === QA.bundle90.installed.value && r6(q3.official) === r6(QA.bundle90.pct.value),
    { expected: { evA310: D2.WP2.quantityT3evA310.value, installed: QA.bundle90.installed.value, official: QA.bundle90.pct.value }, observed: { ...q3, unit: 'cents' } });
  const T1o = o('wp2.T1');
  const gates = o('wp2.T3.gates');
  const pend = o('wp2.T4.pending');
  const fail = o('wp2.T4.failed');
  const pass = o('wp2.T4.passed');
  const problems = [];
  const want = (label, got, value) => { if (!sameJson(got, value)) problems.push(`${label} ${json(got, 120)} != ${json(value, 120)}`); };
  want('T1.officialAfterSubmit', T1o.beforeApprove?.officialAfterSubmit, WP2.T1.officialAfterSubmit.value);
  want('T1.evReportAfterSubmit', T1o.beforeApprove?.evReportAfterSubmit, WP2.T1.evReportAfterSubmit.value);
  want('T1.siteApprove', T1o.beforeApprove?.siteApprove, WP2.T1.siteApprove.value);
  want('T1.approveAgain', T1o.afterApprove?.approveAgain, WP2.T1.approveAgain.http.value);
  want('T1.progressRows', T1o.afterApprove?.progressRows, WP2.T1.approveAgain.progressRows.value);
  want('T1.rejectApproved', T1o.afterApprove?.rejectApproved, WP2.T1.rejectApproved.value);
  want('T3.submittedNoEvidence', gates.submittedNoEvidence, WP2.T3.submittedNoEvidence.value);
  want('T3.rowsWritten', gates.rowsWritten, WP2.T3.rowsWritten.value);
  want('T3.draft', gates.draft, WP2.T3.draft.value);
  want('T3.approveDraft', gates.approveDraft, WP2.T3.approveDraft.value);
  want('T4.approve', pend.approve, WP2.T4.approve.value);
  want('T4.holdState', pend.holdState, WP2.T4.holdState.value);
  want('T4.openList', pend.open, WP2.T4.openList.value);
  want('T4.evUnchanged (cents)', storedCents('052-SCH-EV', 'wp2.T4.pending.evCents', pend.evCents), WP2.T4.evUnchanged.value);
  if (pend.refusalHoldPoints !== undefined) want('T4.holdPoints', pend.refusalHoldPoints, WP2.T4.holdPoints.value);
  want('T4.failed.approve', fail.approve, WP2.T4.failed.approve.value);
  want('T4.failed.state', fail.holdState, WP2.T4.failed.state.value);
  want('T4.passed (complete, pass, 0 open)', [pass.status, pass.outcome, pass.open], ['complete', 'pass', 0]);
  rec('D2.gates', problems.length === 0, { expected: 'the WP2.T1/T3/T4 codes and states at their moments', observed: { T1: T1o, T3gates: gates, T4: { pending: pend, failed: fail, passed: pass } }, detail: problems.join('; ') });
};

// ── static: the single writer (plan :576) ──────────────────────────────────────
const staticFlow = async () => {
  const SRC = path.join(__dirname, '..', '..', '..', 'src');
  const WRITE = /\bactivityProgress\s*\.\s*(create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/;
  const RAW = /(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+"ActivityProgress"/;
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (['__tests__', '__live__', '__mocks__', 'node_modules'].includes(ent.name)) continue;
        walk(full);
      } else if (/\.(c|m)?js$/.test(ent.name) && !/\.test\.(c|m)?js$/.test(ent.name)) {
        fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (WRITE.test(line) || RAW.test(line)) hits.push({ file: path.relative(SRC, full).replace(/\\/g, '/'), line: i + 1, text: line.trim().slice(0, 160) });
        });
      }
    }
  };
  walk(SRC);
  rec('SINGLE.writer', hits.length === 1 && hits[0].file === 'services/progress.service.js' && /tx\.activityProgress\.create\(/.test(hits[0].text), { expected: { writes: 1, file: 'services/progress.service.js', call: 'tx.activityProgress.create (plan :576 names :2171 at f599e67)', rule: WP2.rules.evReadsApprovedOnly.value }, observed: hits });
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
  /** A decided-rule check: FAIL = the defect behaviour present, PASS = absent (fixed), not recorded = gap. */
  const recState = (id) => (r(id) === null ? 'gap' : r(id) === 'PASS' ? 'absent' : 'present');
  const accepted = (said) => (!said ? 'gap' : said === '200' ? 'present' : /^4\d\d/.test(said) ? 'absent' : 'gap');
  cf('CF.HRQ1', { ...split([['a pass answer on an in-progress instance releases the hold', recState('T4.hrQ1.inProgressPass')], ['an na answer alone releases the hold', recState('T4.hrQ1.na')]]), detail: `${json(obs.hrQ1, 700)}; reported, not classified (kept for Phase 1 by the owner's decision, plan :1047): any open ITP blocks the activity - the scheduled A320 instance refused the daily report (${obs.anyOpenItp?.dailyReport}) and the scheduled A130 #2 left the import row ${obs.anyOpenItp?.importA130}` });
  cf('CF.HRQ2', { ...split([['the template edit acts on existing instances', kaState('KA.T4.retroactive')]]), detail: json(obs.retroactive, 700) });
  cf('CF.HRP1', { ...split([['an older, lower submission approved after a newer one lowers the official figure', recState('T6.olderLower.official')], ['a lower typed figure approved without an authorised correction', recState('Q320.typed40.reasonRequired')]]), detail: json(obs.hrp1, 700) });
  cf('CF.HRP2', { ...split([['a quantity submission on an unconfigured activity with approved percent progress is approved', kaState('KA.T6.methodBypass')]]), detail: json(obs.methodBypass) });
  cf('CF.HRS9', { ...split([['approval on an activity retired by activation', kaState('KA.T7.retired')]]), detail: json(obs.retired) });
  cf('CF.HRX1', { ...split([['text-only evidence accepted at submit', accepted(obs.hrx1?.submit)], ['text-only evidence accepted at approval', obs.hrx1?.submit === '200' ? accepted(obs.hrx1?.approve) : obs.hrx1?.submit ? 'absent' : 'gap']]), detail: `${json(obs.hrx1)}; the transition's answer for text-only evidence: ${contractOr('HR-X1', 'textOnlyAnswer', 'G19')}` });
  cf('CF.HRP3', { ...split([['a PUT naming the method only switches evidenceRequired off', !obs.hrp3 ? 'gap' : obs.hrp3.evidenceRequiredAfter === false ? 'present' : obs.hrp3.evidenceRequiredAfter === true ? 'absent' : 'gap']]), detail: json(obs.hrp3) });
  cf('CF.HRP4', { ...split([['the planner approves their own submission', !obs.hrp4 ? 'gap' : obs.hrp4.approve === '200' ? 'present' : 'absent']]), detail: `${json(obs.hrp4)}; the audit shows ${obs.hrp4?.sameActor ? 'one actor (the planner) creating and approving' : 'no single actor'} (the owner's recommendation: self-approvals visible in audit)` });
  cf('CF.replayPayload', { ...split([['a replay with a different payload answers the stored entry', !obs.replayPayload ? 'gap' : obs.replayPayload.replayed === true && obs.replayPayload.sameId && obs.replayPayload.quantity === obs.replayPayload.stored ? 'present' : 'absent']]), detail: json(obs.replayPayload) });
};

// ── the run ────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log(`wp2-progress-proof: ${ACTIVE.length} of ${EXPECTED_CHECKS} checks active${ONLY ? ` (--only=${[...ONLY].join(',')})` : ''}${SKIP ? ` (--skip=${[...SKIP].join(',')})` : ''}${PROJECT_FILTER ? ` (--project=${PROJECT_FILTER})` : ''}; sections ${[...selectedSections].join(' ')}; deep projects ${NEED_DEEP.join(', ') || 'none'}; P ${NEED_P ? 'yes' : 'no'}; in process\n`);
  if (ACTIVE.length !== CHECKS.length) console.log(`not exercised in this run (filtered out): ${CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id).join(', ')}\n`);
  await setup();
  await pSetup();
  if (NEED_P) await h.section('P: the WP-2 choreography on the throwaway project', pFlow);
  if (on('VIEW') || on('SCH')) await h.section('087-SCH: the quantity view, the stored moments, the live end state', schFlow);
  if (on('T4') || on('FLD')) await h.section('087-FLD: the before-edit moment and the hold points after the template edit (HR-Q2)', fldFlow);
  if (on('D2')) await h.section('052-SCH-EV: the stored WP-2 moments', d2Flow);
  if (on('SINGLE')) await h.section('static: the single writer', staticFlow);
  if (on('CF')) await h.section('confirm-first classification', async () => confirmFirstFlow());
};

/** The per-check records, the known answers, the confirm-first classifications, the decided-rule table and the tally, written in cleanup (always). */
const recordObservations = () => {
  for (const [id, r] of Object.entries(records)) r.registered = ACTIVE_IDS.has(id);
  for (const [id, k] of Object.entries(knownAnswers)) k.registered = ACTIVE_IDS.has(id);
  h.observe('checks', records);
  h.observe('knownAnswers', knownAnswers);
  h.observe('confirmFirst', confirmFirst);
  h.observe('decidedRules', Object.fromEntries(Object.entries(DECIDED_RED).map(([id, d]) => [id, { ...d, verdict: records[id]?.verdict ?? 'not run', expectedAtHead: 'FAIL (RED until the approved fix lands)' }])));
  h.observe('runObservations', obs);
  const known = Object.entries(knownAnswers).filter(([id]) => ACTIVE_IDS.has(id)).map(([, k]) => k);
  const tally = {
    expectedChecks: EXPECTED_CHECKS,
    active: ACTIVE.length,
    recorded: Object.keys(records).length,
    activeRecorded: Object.keys(records).filter((id) => ACTIVE_IDS.has(id)).length,
    pass: Object.entries(records).filter(([id, r]) => ACTIVE_IDS.has(id) && r.verdict === 'PASS').length,
    fail: Object.entries(records).filter(([id, r]) => ACTIVE_IDS.has(id) && r.verdict === 'FAIL').length,
    decidedRedFailing: Object.keys(DECIDED_RED).filter((id) => ACTIVE_IDS.has(id) && records[id]?.verdict === 'FAIL'),
    otherFailing: Object.entries(records).filter(([id, r]) => ACTIVE_IDS.has(id) && r.verdict === 'FAIL' && !DECIDED_RED[id]).map(([id]) => id),
    knownAnswers: { value: known.filter((k) => k.verdict === 'value').length, today: known.filter((k) => k.verdict === 'today').length, wrong: known.filter((k) => k.verdict === 'wrong').length },
    confirmFirst: Object.fromEntries(Object.entries(confirmFirst).map(([id, c]) => [id, c.classification])),
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
  };
  h.observe('tally', tally);
  console.log(`\ntally: ${tally.pass} pass, ${tally.fail} fail of ${tally.activeRecorded} recorded (${tally.active} active); decided-rule RED: ${tally.decidedRedFailing.join(', ') || 'none'}; other failures: ${tally.otherFailing.join(', ') || 'none'}; known answers: ${tally.knownAnswers.value} value, ${tally.knownAnswers.today} today (BLOCKED), ${tally.knownAnswers.wrong} wrong`);
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
      const page = await get('pm', `/projects?limit=100&includeArchived=true&search=${encodeURIComponent('CERT3 WP2 progress proof')}`);
      const mine = listOf(page.body?.data).filter((p) => String(p.name || '').startsWith('CERT3 WP2 progress proof'));
      const live = mine.filter((p) => !p.archivedAt);
      notes.push(`throwaway check (GET /projects as 087 PM, ${h.said(page)}): ${mine.length} 'CERT3 WP2 progress proof' projects, ${live.length} live${live.length ? ` (${live.map((p) => `${p.name} ${p.id}`).join(', ')})` : ''}`);
      h.observe('throwawayCheck', { said: h.said(page), total: mine.length, live: live.map((p) => ({ id: p.id, name: p.name })) });
    } catch (error) {
      notes.push(`throwaway check failed: ${error.message}`);
    }
  }
  notes.push(`deep projects: read only, except one replay POST on 087-SCH ${ctx.schReplaySent ? 'sent (a replay of the build\'s 90 m2 request: writes nothing)' : 'not sent'}`);
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

h.run({ main, cleanup });
