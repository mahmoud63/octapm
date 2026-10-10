'use strict';

/**
 * WP-8 (field, quality and documents) primary proving run: the known-answer run of plan section 4 WP-8 on the cert3d
 * population (docs/certification/OCTAPM_CERT3_PLAN.md at 14a3db2: section 4 WP-8 :872-939: workflows :873, evidence
 * :875-920 (daily logs :877-883, timesheets :884-890, quality :891-894, punch :895-898, safety :899-902, RFIs :903-907,
 * submittals :908-912, drawings :913-915, transmittals / correspondence / meetings / tasks :916-920), mutations :922,
 * existing evidence :924, confirm first :926-939; section 6.2 WP-8 guards :1152; section 5 HR-Q3 :1049, HR-Q4 :1050,
 * HR-Q5 :1051, HR-X1 :1052 (decided, section 0.1 :51-52), HR-F1..F6 :1058-1063, HR-C11 :1079, HR-K1 :1096; the
 * defect-fix list :1107-1119 ("the RFI official response is frozen after closure" :1114, "health excludes archived
 * incidents" :1116); section 1.1 the CLAUDE.md quality row :92; section 3.2 087-FLD :430, 052-FLD :445).
 * Preparation C:\Temp\octapm-cert\scratch\wp8\WP8-PREP.md (+ wp8-checks-draft.json, wp8-mutations-draft.json,
 * derive-f8.json); the BINDING integration-owner adjudication C:\Temp\octapm-cert\scratch\wp8\WP8-ADJUDICATION.md (Q1-Q14,
 * cited WP8ADJ) with the standing rulings it lists (product routes only; a value equal to HEAD's today under an undecided
 * rule reads BLOCKED; every writing check and every catcher on the throwaway; N-round concurrency probes; every figure a
 * book leaf; company 087 only, plus read-only reads of 052); moment map build/MOMENT-MAP.md (rows 171-177, 182, 184-186,
 * 246, 250, 251, 262, 277); answer books answers/field-controls.js (WP8.*) AFTER the WP-8 book patch
 * (C:\Temp\octapm-cert\scratch\wp8\book\book-insert.js: field-controls dcdeb343 -> b96dfefe; the proof refuses to load
 * without it) and answers/commercial.js d00954da (WP7.weather["087-FLD.promoted.days"], WP7.promotion.sitePromotion).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp8-field-proof.js [--only=DL,TS] [--project=F8] [--skip=CF]
 *
 * Filters. Sections split by domain on the throwaways and by project on the deep reads, so that a partial population and
 * a mutant both stay where they belong:
 *   S      setup (always runs, for the projects and state files the selected checks need)
 *   DL     daily logs on F8          TS   timesheets on F8 (and the in-process multiplier)   Q   quality on F8 and F8V
 *   P      punch on F8               SF   safety on F8         R    RFIs on F8               SUB submittals on F8
 *   D      drawings on F8            T    meetings on F8
 *   F87    087-FLD: the stored build moments, live reads and the one request refused before any write (WP8ADJ Q2)
 *   F52    052-FLD: the stored build moments and the 052 PM's reads, read only (WP8ADJ Q9)
 *   CF     the confirm-first classifications (and the lead probes T-1 .. T-3, M-2's distribution rows, L213 on F8)
 * --only=<sections> keeps those sections, --project=<F8|F8V|087-FLD|052-FLD|static> the sections that touch that
 * project, --skip=<sections> drops sections. A section or project not listed here is refused as unknown. Selecting CF
 * selects every section CF classifies from (DL TS Q P SF R SUB D T F87 F52); skipping one of those needs --skip=CF too.
 * A filtered-out check is neither registered nor recorded. The F8 choreography (F8-0 .. end) runs whole whenever one
 * selected check runs on F8 (its steps depend on each other, as WP-7's T7); F8V's whenever Q or CF is selected. The
 * primary run, the final run and every mutation run take no flags (mutate-multi.js spawns the proof without arguments).
 * Every write is on F8 or F8V in company 087; the one request sent to 087-FLD is the party user's entry on the submitted
 * day D5, refused 409 DAILY_LOG_SUBMITTED before any write (WP8ADJ Q2); a session in company 052 is opened only when F52 is
 * selected, and only reads.
 *   Debug run on the partial population (087-FLD built by build order run 1; no 052-FLD state of a cert3d run):
 *   --skip=F52,CF  (registers 92 checks + G.5xx; company 087 only).
 *
 * In process (CERT_INPROCESS=1, through the lock runner only) on the certification database. Every expected figure is
 * an answer-book key; every figure the F8 and F8V choreographies type is read from a book leaf (WP8.F8.*, WP8.F8V.*) or
 * is a fixture input named in FIXTURE below (texts, reasons, times, the malformed storage keys of the D-VAL-1 probe).
 * Deep projects are resolved by their exact names through the API as their company's PM (exactly one live project
 * each); build state files are read only for moment answers and ids (C:\Temp\octapm-cert\state\cert3\<code>.json,
 * steps[].out and steps[].blocked). Read-only SQL is used only to read: the invariance fingerprint of 087-FLD, stored
 * columns the API presents otherwise (an RFI's dueDate, the workflow activity links), audit rows, tasks by title.
 *
 * WHERE EACH CHECK RUNS (the CHECKS table carries it per id):
 *   F8       the throwaway project of company 087 this run creates and archives (WP8.F8.*; WP8ADJ Q1): every writing
 *            check and every section 6.2 catcher but the clamp. Days are offsets from 087's run date R = min(today in
 *            UTC, today in the company's zone), every transaction dated R-6 .. R-1; plan dates (requiredOnSite, due
 *            dates) may lie after R; nothing is placed on the five-day calendar, so a weekend R does not fail it.
 *   F8V      the second throwaway in 087 (WP8.F8V.*): 6 major NCRs (the clamp catcher) and the probes that would move
 *            F8's 21 (HR-Q5 evidence wiped, HR-X1 text-only, HR-Q4 hard deletes), and the NCR half of D-VAL-1.
 *   087-FLD  stored: the build steps (MOMENT-MAP rows 171-176, 182, 184-186); live: reads only, plus DL.087.partyLock;
 *            S.087FLD.unchanged asserts 087-FLD unchanged across the run (read-only SQL fingerprint, WP7ADJ Q3 pattern).
 *   052-FLD  stored: the build steps (rows 246, 250, 251, 262); live: the 052 PM's reads (WP8ADJ Q9).
 *   static   in-process pure calls and source scans (confirm-first evidence).
 *
 * Mutation safety (section 6.2 WP-8; mutate-multi.js runs the proof without flags, so every section runs under every
 * mutant): the catchers of M-QW (Q.F8.dashboard21), M-CLAMP (Q.F8V.sixMajor), M-MP (DL.F8.manpower), M-DT (TS.F8.mixed),
 * M-PFA (P.F8.closeByNonApprover), M-LAT (D.F8.storeman), M-RD (SUB.F8.submitBy) and M-ARCH (SF.F8.dashboard) and of the
 * optional M-QWh, M-QWw, M-OTF (WP8ADJ Q7) all write only on F8 or F8V (TS.pure.multiplierHalf is in process). need()
 * preconditions assert states only (a status, a row, an id), never a figure a WP-8 mutant moves; the quality engineer's
 * punch close is sent only while the item is still ready_for_review (M-PFA: under the mutant the PM's close has closed
 * it). On the deep projects the proof reads and sends the one party entry refused before any write.
 *
 * KNOWN ANSWERS (KA.*): judged value (pass), today (BLOCKED / known, with the ref, counted separately, never exit 2,
 * while the rule is undecided) or wrong (fail). No WP-8 rule is decided (HR-C11, HR-F1..F6, HR-Q3..Q5, HR-K1 wait for the
 * owner); HR-X1 is decided but its batch lands in WP-2 (FIXES['HR-X1'] empty until it does, binding ruling 7); the two
 * fix-list items (RFI-RESP-1 :1114, SAFE-ARCH-1 :1116) are made only if each confirms as P1 at this run (WP8ADJ Q4, Q5).
 * A decided rule's today fails (the WP-1 ka() rule); a build moment observed before that fix commit reads STORED-PRE-FIX
 * (KA.DL.087.promoteStored, KA.SAFE.052.health: rows built before the fix keep their answer until the exit rebuild). A
 * probe whose own setup fails is a setup error (exit 1), never 'wrong' (R-SET). While a CONTRACT field is null, a
 * refusal value reads "not 2xx and nothing changed".
 * CONFIRM-FIRST (CF.*): plan :926-939 and the fix list :1114, :1116, classified from this run's observations as
 * CONFIRMED / PARTIAL / REJECTED / TEST GAP and reported (no rule decided); a landed fix turns its CF into a defect check
 * that must read REJECTED.
 *
 * Expected at HEAD on cert3d (after the WP-8 book patch, no fix commit set): 112 checks + G.5xx; 0 FAIL, exit 0, PASS
 * (harness provisional classification: none, no defect checks). Known answers BLOCKED (27): KA.DL.F8.promoteStored,
 * KA.DL.087.promoteStored (HR-C11); KA.F4.F8.approveFromOpen, KA.F4.F8.approveEmpty, KA.F4.F8.reopenNoReason (HR-F4);
 * KA.F5.F8.rateTiming, KA.F5.F8.inactiveWorker, KA.F5.F8.capAcrossSheets (HR-F5); KA.Q3.087.score (HR-Q3);
 * KA.Q5.F8.severityDowngrade, KA.Q5.F8V.evidenceWiped, KA.Q5.F8.ltiEdit (HR-Q5); KA.Q4.F8.legacyItpStatus,
 * KA.Q4.F8V.hardDelete (HR-Q4); KA.X1.F8V.textOnly (HR-X1, until its batch); KA.F3.F8.approverBypass (HR-F3);
 * KA.SAFE.F8.health, KA.SAFE.087.health, KA.SAFE.052.health (SAFE-ARCH-1); KA.RFI.F8.officialAfterClose (RFI-RESP-1);
 * KA.K1.F8.rfiOverdueHealth (HR-K1); KA.F1.F8.pmApproveWhilePending (HR-F1); KA.F2.F8.approveWithoutReview,
 * KA.F2.F8.approveOutOfOrder (HR-F2); KA.F6.F8.patchStatus, KA.F6.F8.actionItemIdentity, KA.F6.F8.duplicateTask (HR-F6).
 * CF reported (16): CF.HRF4, CF.HRF5, CF.HRQ5, CF.HRQ4, CF.HRF3, CF.SAFEARCH, CF.RFIRESP, CF.HRK1rfi, CF.HRF1, CF.HRF2,
 * CF.HRF6, CF.TRN1, CF.L213, CF.L146, CF.DVAL1, CF.LDETAILS, all CONFIRMED expected (CF.HRF4's site-staff item read from
 * WP-7's result file, WP8ADJ Q8; a gap of that item when the file is absent).
 * Green: 10 setup + 57 HARD + 2 STORED, and G.5xx (every refusal is a 4xx). Residue at HEAD (WP8ADJ Q10): F8 and F8V
 * archived with their records; three workers per run set inactive in 087's roster; one permission template found or
 * created by name and reused.
 * Without the WP-8 book patch the proof refuses to load (the guard below).
 * After the WP-2 batches (binding ruling 7): FIXES['HR-X1'] set with CONTRACT['HR-X1'] -> KA.X1.F8V.textOnly judged on the
 * batch's contract (26 BLOCKED, 70 green); CF.TRN1 and CF.DVAL1 re-run. After a decision or a fix (FIXES set, with its
 * CONTRACT fields): that rule's KAs turn value checks, its CF must read REJECTED, and its fix mutation joins
 * (FIX_CATCHERS); RFI-RESP-1 or SAFE-ARCH-1 fixed (if P1) -> their KAs value (KA.SAFE.052.health STORED-PRE-FIX until the
 * exit rebuild), and WP-9's WP9.health.safetyExpected turns value.
 *
 * Adjudication applied (WP8ADJ): Q1 F8 carries every write and every catcher, F8V the clamp and the score-moving probes
 * (MOMENT-MAP deviation recorded by key: meta.deviations), the close of 087-FLD's open major NCR moves to F8; Q2 the
 * party request on 087-FLD's D5 kept (409 before any write); Q3 KA.Q3.087.score (value 6, today 21) and the CLAUDE.md
 * quality rule HARD on F8 and 052-FLD; Q4 SAFE-ARCH-1 the ref of the three safety KAs (the builds' BLOCKED HR-K1 moment
 * accepted under it); Q5 RFI-RESP-1 provisional P1, settled at the run (observations.runObservations.rfiRespSeverity);
 * Q6 the 8 mutants for the 7 guards (CATCHERS); Q7 the optional mutants run untallied (OPTIONAL_CATCHERS); Q8 CF.HRF4's
 * site-staff item classified from WP-7's result file; Q9 the 052-FLD live reads; Q10 the residue listed by the cleanup;
 * Q11 D-ID-3/7/8/9 recorded only (meta.leads); Q12 L213 probed on F8 with the one company template of Q10; Q13 WP-8 runs
 * after the WP-2 batches and WP-7's fix, anchors re-scanned then (meta.rescanAfterBatches), checks that depend on the
 * batch read its FIXES entry; Q14 DL-REPLAY-1, SUB-LINK-1, MTG-SENT-1 recorded only (meta.leads).
 * EXPECTED_CHECKS: WP8-PREP's 112 (wp8-checks-draft.json), fixed; G.5xx on top.
 *
 * Exit 0 pass / 2 a check failed / 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp8-field-proof.json (every check with its plan reference, answer-book key, expected,
 * observed and verdict in observations.checks; the KA verdicts in observations.knownAnswers; the CF classifications in
 * observations.confirmFirst; the fix state in observations.fixes; the 087-FLD fingerprints, the F8 / F8V ids and the
 * residue in observations.runObservations; all written in cleanup, so a setup error still carries what was observed).
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');
const FIELD = require('./answers/field-controls');
const COMMERCIAL = require('./answers/commercial');

const { WP8 } = FIELD;
const RULESET = FIELD.rules;

// -- the WP-8 book patch must be applied (G1-G23 as WP8ADJ Q1-Q14 rule them) ------------------------------------------
/**
 * A book node by its key. A member of the book may itself hold dots ("087-FLD.promoted.days"): at each node the longest
 * run of parts that names a member is taken.
 */
const nodeAt = (root, key) => {
  const parts = String(key).split('.');
  let node = root;
  let i = 0;
  while (i < parts.length) {
    if (!node || typeof node !== 'object') return undefined;
    let j = parts.length;
    for (; j > i; j -= 1) if (Object.prototype.hasOwnProperty.call(node, parts.slice(i, j).join('.'))) break;
    if (j === i) return undefined;
    node = node[parts.slice(i, j).join('.')];
    i = j;
  }
  return node;
};
const BOOKS = { WP8: FIELD, WP7: COMMERCIAL };
const leafAt = (key) => nodeAt(BOOKS[String(key).split('.')[0]] || FIELD, key);
/** The 54 keys the WP-8 book patch adds (C:/Temp/octapm-cert/scratch/wp8/book/new-key-paths.txt). */
const WP8_PATCH_LEAVES = [
  'WP8.dailyLog.approveEmptyDay', 'WP8.dailyLog.reopenWithoutReason', 'WP8.timesheet.capAcrossSheets', 'WP8.timesheet.inactiveWorker',
  'WP8.quality.formItpCounted087FLD', 'WP8.punch.reasonRequiredPairs', 'WP8.rfi.officialResponsePaths', 'WP8.rfi.overdueHealthF8',
  'WP8.rfi.overdueWorkspaceF8', 'WP8.transmittal.createCitesFiled', 'WP8.transmittal.draftDistributed', 'WP8.transmittal.editAfterDistribution',
  'WP8.052-FLD.reads', 'WP8.mutations.optionalMutants', 'WP8.mutations.fixMutations', 'WP8.mutations.notRun', 'WP8.F8.project', 'WP8.F8.team',
  'WP8.F8.activities', 'WP8.F8.workers', 'WP8.F8.evidence', 'WP8.F8.days', 'WP8.F8.timesheets', 'WP8.F8.qualityMix', 'WP8.F8.punchMix',
  'WP8.F8.safetySet', 'WP8.F8.rfis', 'WP8.F8.submittals', 'WP8.F8.l213Template', 'WP8.F8.manpower', 'WP8.F8.submittalImpact', 'WP8.F8.drawings',
  'WP8.F8.meetings', 'WP8.F8.residue', 'WP8.F8.choreography', 'WP8.F8V.project', 'WP8.F8V.team', 'WP8.F8V.records', 'WP8.F8V.choreography',
  'WP8.CF.HRF4', 'WP8.CF.HRF5', 'WP8.CF.HRQ5', 'WP8.CF.HRQ4', 'WP8.CF.HRF3', 'WP8.CF.SAFEARCH', 'WP8.CF.RFIRESP', 'WP8.CF.HRK1rfi', 'WP8.CF.HRF1',
  'WP8.CF.HRF2', 'WP8.CF.HRF6', 'WP8.leads.L213', 'WP8.leads.L146', 'WP8.leads.DVAL1', 'WP8.leads.LDETAILS',
];
/** The known answers and their refs (the book's WP8_KNOWN, 28, and the commercial leaf KA.DL.087.promoteStored also reads). */
const WP8_REFS = [
  ['WP8.dailyLog.promoteResponseVsStored', 'HR-C11'], ['WP8.dailyLog.approveFromOpen', 'HR-F4'], ['WP8.dailyLog.approveEmptyDay', 'HR-F4'],
  ['WP8.dailyLog.reopenWithoutReason', 'HR-F4'], ['WP8.timesheet.rateChangeRecorded', 'HR-F5'], ['WP8.timesheet.capAcrossSheets', 'HR-F5'],
  ['WP8.timesheet.inactiveWorker', 'HR-F5'], ['WP8.quality.formItpFailureNotCounted', 'HR-Q3'], ['WP8.quality.formItpCounted087FLD', 'HR-Q3'],
  ['WP8.quality.severityDowngradeProbe', 'HR-Q5'], ['WP8.quality.legacyItpFailedToPassedProbe', 'HR-Q4'], ['WP8.quality.evidenceWipedBeforeApprovalProbe', 'HR-Q5'],
  ['WP8.quality.textOnlyEvidenceProbe', 'HR-X1'], ['WP8.quality.hardDeleteProbe', 'HR-Q4'], ['WP8.punch.finalApproverBypass', 'HR-F3'],
  ['WP8.safety.health', 'SAFE-ARCH-1'], ['WP8.052-FLD.safetyHealth', 'SAFE-ARCH-1'], ['WP8.safety.ltiEditAfterClosure', 'HR-Q5'],
  ['WP8.rfi.officialResponseAfterClose', 'RFI-RESP-1'], ['WP8.rfi.officialResponsePaths', 'RFI-RESP-1'], ['WP8.rfi.overdueHealth', 'HR-K1'],
  ['WP8.rfi.overdueHealthF8', 'HR-K1'], ['WP8.submittal.pmApprovalWhileStepsPending', 'HR-F1'], ['WP8.drawing.approveWithoutReview', 'HR-F2'],
  ['WP8.drawing.approveOutOfOrder', 'HR-F2'], ['WP8.transmittal.distributeBypass', 'HR-F6'], ['WP8.transmittal.actionItemIdentity', 'HR-F6'],
  ['WP8.transmittal.createTaskTasks', 'HR-F6'], ['WP7.weather.087-FLD.promoted.days', 'HR-C11'],
];
/** Every value of the WP8 tree as text (a "(recorded)" value restates HEAD: G3). */
const valuesOf = (node, out = []) => {
  if (node && typeof node === 'object' && !Array.isArray(node) && 'value' in node && 'derivation' in node) { out.push(JSON.stringify(node.value)); return out; }
  if (node && typeof node === 'object' && !Array.isArray(node)) for (const k of Object.keys(node)) valuesOf(node[k], out);
  return out;
};
{
  const missing = WP8_PATCH_LEAVES.filter((key) => { const leaf = leafAt(key); return !leaf || typeof leaf !== 'object' || !('value' in leaf); });
  if (missing.length) throw new Error(`the answer book carries no WP-8 leaf ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` (+${missing.length - 6})` : ''}: apply the WP-8 book patch (C:/Temp/octapm-cert/scratch/wp8/book/book-insert.js) first`);
  const bad = WP8_REFS.filter(([key, ref]) => { const leaf = leafAt(key); return !leaf || leaf.ref !== ref || leaf.today === undefined || JSON.stringify(leaf.value) === JSON.stringify(leaf.today); });
  if (bad.length) throw new Error(`the answer book carries the pre-WP-8 form of ${bad.map(([key]) => key).join(', ')} (no today, no ref, or a value equal to its today: G2, G3): apply the WP-8 book patch first`);
  const notAssumed = WP8_REFS.filter(([key]) => key.startsWith('WP8.') && leafAt(key).assumption !== true);
  if (notAssumed.length) throw new Error(`the WP-8 known answers ${notAssumed.map(([key]) => key).join(', ')} are not assumptions (the KA.I9 ruling): apply the WP-8 book patch first`);
  const recorded = valuesOf(WP8).filter((text) => text.includes('(recorded)'));
  if (recorded.length) throw new Error(`the answer book still restates HEAD as "(recorded)" in ${recorded.length} WP-8 values (G3): apply the WP-8 book patch first`);
  if (!String(WP8.mutations.qualityWeightMinor10.note || '').includes('Q.F8.dashboard21 red (M-QW,')) throw new Error('the answer book names the WP-8 mutation catchers by book key, not check id (G13): apply the WP-8 book patch first');
}

const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const REGISTER = 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md';
const STATE_DIR = 'C:/Temp/octapm-cert/state/cert3';
const WP7_RESULT = 'C:/Temp/octapm-cert/results/cert3/wp7-eot-proof.json';
const REPO = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(__dirname, '..', '..', '..', 'src');

/** The deep projects: their company, exact name and the persona that resolves them. */
const DEEP = {
  '087-FLD': { company: '087', name: 'CERT3 Field & quality (087-FLD)', resolver: 'pm' },
  '052-FLD': { company: '052', name: 'CERT3 Field & quality (052-FLD)', resolver: 'pm052' },
};

// -- CLI ------------------------------------------------------------------------------------------------------------
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const setOf = (text) => (text ? new Set(text.split(',').map((s) => s.trim()).filter(Boolean)) : null);
const ONLY = setOf(argOf('only'));
const SKIP = setOf(argOf('skip'));
const PROJECT_FILTER = argOf('project');

// -- the fixed list of checks: id, section, plan reference, answer-book key, where it runs ---------------------------
// where: 'F8' | 'F8V' | '087-FLD' | '052-FLD' | 'stored:<code>' | 'static', or a comma list for a check that reads
// several. The section is the 6th argument; WP8-PREP's domain sections keep their F8 / F8V checks, and the deep checks
// move by project to F87 (087-FLD and its stored moments only) and F52 (anything reading 052-FLD), as WP-7 split its FLD
// section. The setup checks (S.*) carry no answer-book key (WP-1 L5). The book key is the check's primary leaf; the
// description names the others.
// <CHECKS>
const L = (...lines) => `${PLAN_DOC}:${lines.join(',')}`;
const C = (id, planRef, bookKey, where, description, section) => ({ id, section, planRef, bookKey, where, description });
const CHECKS = [
  C('S.book', L(875), null, 'static', 'answers/field-controls.js loads with the WP-8 patch (G1-G23 as WP8ADJ Q1-Q14 rule them; the load guard above) and answers/commercial.js at d00954da: the 54 new keys resolve, every known answer this proof reads carries its today and its ref (HR-C11, HR-F1..F6, HR-Q3..Q5, HR-X1, HR-K1, SAFE-ARCH-1, RFI-RESP-1), is an assumption and its value is not its today, no WP-8 value restates HEAD as "(recorded)", and the FIXTURE agrees with every leaf that states it', 'S'),
  C('S.state', L(430, 445, 875), null, 'stored:087-FLD,stored:052-FLD', 'the build state files the selected checks read are present with their WP-8 steps: 087-FLD calendar .. quality.inputs done, rfi.draft BLOCKED RFI-DRAFT and the weather comparisons BLOCKED HR-C11 where allowed, finding WP8-TRN-1 persisted; 052-FLD calendar, team, timesheet.mixed, dailylog.D1-D3 and quality.score done, safety.score done or BLOCKED HR-K1 / SAFE-ARCH-1; a fix commit, when set, is the one git dates', 'S'),
  C('S.projects', L(430, 445, 875), null, '087-FLD,052-FLD', 'the deep projects the selected checks read (087-FLD, its 6-major variant by the state\'s id, and, with F52, 052-FLD) resolve by exact name through the API as their company\'s PM, exactly one live each, matching the state files; the 087 personas (pm, planner, qs, cost, site, quality, warehouse) and, with F87, the 087-FLD party user sign in; with F52, 052\'s PM', 'S'),
  C('S.F8.create', L('875-920'), null, 'F8', 'F8-0: F8 created by the 087 PM (WP8.F8.project: building, unit_rate, five_day, EGP, start R-60, end R+240); team planning_eng, qs, cost_controller, site_engineer, warehouse, and the quality engineer with no project role (RJ-12; WP8.F8.team); the planner hand-builds F8-A1..A4 with engineerIds [site] (WP8.F8.activities)', 'S'),
  C('S.F8.workers', L('885-890'), null, 'F8', 'F8-1: the site engineer creates W8-1 (Steelfixer, 50.00, OT 1.5), W8-R and W8-I (50.00) through POST /projects/F8/timesheets/workers (company-level rows: residue, set inactive at the end) and the crew C8 (W8-1, default activity F8-A1) (WP8.F8.workers)', 'S'),
  C('S.F8.evidence', L('892-894', 900), null, 'F8', 'F8-2: the site engineer\'s own upload through POST /projects/F8/workflow/uploads answers a stored document; every closeout cites its own fresh upload as { documentId, fileName, storageKey: documentId } (WP8.F8.evidence: F8\'s own documents only; XDOC-1 / 1b / 1c / UPB are the HR-X1 batch\'s, never re-tested)', 'S'),
  C('S.F8V.create', L(892), null, 'F8V', 'V-0: F8V created by the 087 PM (WP8.F8V.project), team site_engineer and the quality engineer with no role (WP8.F8V.team); exactly 6 major NCRs raised by the PM, nothing else, read back (WP8.F8V.records)', 'S'),
  C('S.087FLD.unchanged', L(875), null, '087-FLD', 'the deep probes write nothing: 087-FLD\'s fingerprint (day D5\'s status, updatedAt and entry count; the counts and latest ids of its NCRs, punch items, safety incidents, RFIs, document revisions, timesheets, weather delays and audit events; read-only SQL) is identical before the first deep read and after the last (WP8ADJ Q2; the WP7ADJ Q3 pattern)', 'S'),
  C('S.F8.archived', L(875), null, 'F8', 'end: F8\'s queued jobs cancelled through the product route, none left; F8 archived by the PM (archivedAt read back); W8-1, W8-R and W8-I set inactive (WP8.F8.residue; WP8ADJ Q10)', 'S'),
  C('S.F8V.archived', L(892), null, 'F8V', 'end: F8V\'s queued jobs cancelled, none left; F8V archived by the PM (archivedAt read back)', 'S'),

  C('DL.stored.promoteEcho', L(878), 'WP8.dailyLog.promote2h', 'stored:087-FLD,stored:052-FLD', 'stored: 087-FLD steps dailylog.D1 / D2 / D3 out.promotedEcho 0.5 / 1 / 1.5 and 052-FLD dailylog.D1-D3 out.delayDaysEcho 0.5 / 1 / 1.5 (WP8.dailyLog.promote2h / 6h / 10h; MOMENT-MAP rows 175, 246, 262); an adopted promotion (echo null) is a gap served by DL.F8.promoteEcho', 'F52'),
  C('DL.F8.promoteEcho', L(878), 'WP8.dailyLog.promote6h', 'F8', 'DB (R-5): the site engineer adds weather delays of 2 h, 6 h and 10 h on F8-A1 / A2 / A3; the planner (eot:create) promotes each: 200, weatherDelay.delayDays 0.5 / 1.0 / 1.5 (rules.promoteDays; WP8.dailyLog.promote2h / 6h / 10h), contractual true; each entry then names its weather delay', 'DL'),
  C('KA.DL.F8.promoteStored', L(878, 927, 1079), 'WP8.dailyLog.promoteResponseVsStored', 'F8', 'DB: the three promoted rows read back on F8\'s register (planner GET /weather-delays): value delayDays 0.5 / 1.0 / 1.5; today 0 / 1 / 1 (the Int column) - HR-C11', 'DL'),
  C('KA.DL.087.promoteStored', L(430, 878, 927, 1079), 'WP7.weather.087-FLD.promoted.days', 'stored:087-FLD,087-FLD', 'stored step weather.at13.read out.stored.promoted and the live register rows of D1-D3\'s promotions (state weatherDelayIds): value [0.5, 1, 1.5]; today [0, 1, 1] (WP8.dailyLog.promoteResponseVsStored) - HR-C11; STORED-PRE-FIX after its fix, judged on the value strictly at the exit rebuild (MOMENT-MAP row 176)', 'F87'),
  C('DL.F8.approvedPatch', L(879), 'WP8.dailyLog.approvedDayPatch', 'F8', 'DC (R-4; one note, submitted by the site engineer, approved by the PM): the site engineer\'s PATCH /daily-logs/DC {summary}: \'409 DAILY_LOG_APPROVED\'; the summary unchanged', 'DL'),
  C('DL.F8.approvedAdd', L(879), 'WP8.dailyLog.approvedDayEntryAdd', 'F8', 'DC: POST /daily-logs/DC/entries/notes (no clientRequestId, so no replay, DL-REPLAY-1): \'409 DAILY_LOG_APPROVED\'; the entry count unchanged', 'DL'),
  C('DL.F8.approvedDelete', L(879), 'WP8.dailyLog.approvedDayEntryDelete', 'F8', 'DC: DELETE /daily-logs/DC/entries/notes/<the note>: \'409 DAILY_LOG_APPROVED\'; the note still there', 'DL'),
  C('DL.F8.manpower', L(880, 922, 1152), 'WP8.dailyLog.manpowerTotal', 'F8', 'DA (R-6): internal Steelfixer 5 x 8 (F8-A1) and Carpenter 3 x 10 (F8-A2), created approved; Labourer 2 x 8 (F8-A2) rejected by the site engineer with a reason; GET manpower-report?from=DA&to=DA&groupBy=trade (PM): Steelfixer 40, Carpenter 30, no Labourer group, totals.manHours 70, totals.workers 8 (WP8.dailyLog.manpower*, WP8.F8.manpower; catcher of M-MP: 86 / 10)', 'DL'),
  C('DL.087.manpower', L(430, 880), 'WP8.dailyLog.manpowerSteelfixer', '087-FLD', '087-FLD (PM read) manpower-report?from=D4&to=D4&groupBy=trade: Steelfixer 40 (internal, approved), Carpenter 30 (the party\'s, submitted), no Labourer (rejected), totals 70 / 8 (WP8.dailyLog.manpower*)', 'F87'),
  C('DL.087.partyLock', L(430, 881), 'WP8.dailyLog.partyLock', '087-FLD', 'the 087-FLD party user POSTs a note to D5 (submitted): \'409 DAILY_LOG_SUBMITTED\' (assertEditable, before any write); D5 unchanged (S.087FLD.unchanged)', 'F87'),
  C('DL.F8.rejectWithoutReason', L(881), 'WP8.dailyLog.rejectWithoutReason', 'F8', 'DA: review { decision: reject } of the Labourer entry with no reason (site engineer): \'400 DAILY_LOG_REASON_REQUIRED\' (before the transaction); the entry still approved', 'DL'),
  C('DL.087.a130', L(430, 882), 'WP8.dailyLog.weekSummaryA130', '087-FLD', '087-FLD timesheets/week?weekStart=D4: the A130 row 40 hours; manpower-report?from=D4&to=D4&groupBy=activity: A130 40 man-hours (WP8.dailyLog.weekSummaryA130 / manpowerReportA130; the party carpenter is on A160)', 'F87'),
  C('KA.F4.F8.approveFromOpen', L(883, 928, 1061), 'WP8.dailyLog.approveFromOpen', 'F8', 'DD (R-3; open, one note): the PM approves: value refused (code the fix\'s, CONTRACT), DD stays open; today 200 approved - HR-F4', 'DL'),
  C('KA.F4.F8.approveEmpty', L(928, 1061), 'WP8.dailyLog.approveEmptyDay', 'F8', 'DE (R-2) created empty by a summary PATCH (no entry): the PM approves: value refused, the day open; today 200 approved - HR-F4', 'DL'),
  C('KA.F4.F8.reopenNoReason', L(928, 1061), 'WP8.dailyLog.reopenWithoutReason', 'F8', 'DC (approved; after the DL.F8.approved* probes) reopened by the PM with no reason: value 400 (code the fix\'s), DC stays approved; today 200 open - HR-F4', 'DL'),

  C('TS.F8.mixed', L(885, 922, 1152), 'WP8.timesheet.mixedDay', 'F8', 'TS-1 (R-5): W8-1 8 h regular + 2 h overtime + 1 h double on F8-A1, submitted by the site engineer, approved by the cost controller: totalCost 650.00; cost/reconciliation/explain?activityId=F8-A1: exactly 3 rows of this sheet, sourceType timesheet, costType labour, 400.00 / 150.00 / 100.00 (WP8.timesheet.mixedDay / mixedDayLedger; catcher of M-DT: 600.00)', 'TS'),
  C('TS.087.mixed', L(430, 885), 'WP8.timesheet.mixedDayLedger', '087-FLD', '087-FLD timesheet.mixed (state id): approved, totalCost 650.00; its 3 ledger rows (explain A100, sourceId the sheet): labour / timesheet, sum 650.00', 'F87'),
  C('TS.pure.multiplierHalf', L(886), 'WP8.timesheet.multiplierHalf', 'static', 'in process (the service\'s exported rule; no 0.5 worker can exist, builders\' adjudication 087-FLD item 1): multiplierFor("overtime", { overtimeMultiplier: 0.5 }) = 1 and 2 h x 50.00 x it = 100.00 (catcher of the optional M-OTF: 50.00)', 'TS'),
  C('TS.F8.halfRefused', L(886), 'WP8.timesheet.multiplierHalfCreate', 'F8', 'TS-7: POST workers { overtimeMultiplier 0.5 }: \'400 VALIDATION_ERROR\' with error.details naming overtimeMultiplier; POST workers/import one row at 0.5: 200 { created 0, updated 0, skipped 0, errors [row 1, "The overtime multiplier must be between 1 and 5"] } (WP8.timesheet.multiplierHalfImport); no 0.5 worker listed', 'TS'),
  C('TS.stored.half', L(430, 886), 'WP8.timesheet.multiplierHalfImport', 'stored:087-FLD', 'stored step worker.multiplier-half out: create said 400 VALIDATION_ERROR field overtimeMultiplier; import created 0 / updated 0 / skipped 0 / errors [row 1] (MOMENT-MAP rows 171, 172)', 'F87'),
  C('TS.087.reopen', L(430, 887), 'WP8.timesheet.reopenMirrorCount', '087-FLD,stored:087-FLD', 'stored step timesheet.2000 out.reopenNetCents 0 (the moment) and reapprovedCents 2,000.00; live: the sheet approved, totalCost 2,000.00; explain A130 rows of the sheet: 15 = 5 x +400.00, 5 mirrors x -400.00 (isReversal), 5 x +400.00; mirrors sum -2,000.00; net 2,000.00 (WP8.timesheet.reopen* / reapproved*; MOMENT-MAP row 174)', 'F87'),
  C('TS.F8.rejectWithoutReason', L(888), 'WP8.timesheet.rejectWithoutReason', 'F8', 'TS-1, once submitted, returned by the cost controller with no reason: \'400 VALIDATION_ERROR\' (details naming reason); still submitted (it is approved next: TS.F8.mixed)', 'TS'),
  C('TS.087.rejectEditApprove', L(430, 888), 'WP8.timesheet.rejectEditApprove', '087-FLD', '087-FLD timesheet.rejected-edited (state id): approved, regularHours 35, totalCost 1,750.00 (MOMENT-MAP row 186)', 'F87'),
  C('TS.F8.hours25Single', L(889), 'WP8.timesheet.hours25SingleEntry', 'F8', 'TS-2 (R-4): POST a sheet with one 25 h entry: \'400 VALIDATION_ERROR\', error.details naming entries[0].hours; no sheet written', 'TS'),
  C('TS.F8.hours25Split', L(889), 'WP8.timesheet.hours25SplitEntries', 'F8', 'TS-2: POST a sheet with W8-1 16 h + 9 h on one day: \'400 TIMESHEET_HOURS_EXCEEDED\'; no sheet written', 'TS'),
  C('TS.087.crewPrefill', L(430, 889), 'WP8.timesheet.crewPrefillEntries', '087-FLD', '087-FLD timesheet.crew-prefill (state id): entryCount 3, regularHours 24 (WP8.timesheet.crewPrefillEntries / crewPrefillHours)', 'F87'),
  C('TS.F8.sameCrewDate', L(889), 'WP8.timesheet.sameCrewSameDate', 'F8', 'TS-3 (R-3): C8 pre-filled (201, 1 x 8 h); a second sheet for C8 on R-3: \'409 TIMESHEET_EXISTS\'; one sheet for the crew that day', 'TS'),
  C('KA.F5.F8.rateTiming', L(890, 930, 1062), 'WP8.timesheet.rateChangeRecorded', 'F8', 'TS-5 (R-1): W8-R 8 h regular submitted; W8-R hourlyRate PATCHed 50 -> 60 before approval; approved: value 400.00 (the rate at submission); today 480.00 - HR-F5', 'TS'),
  C('KA.F5.F8.inactiveWorker', L(930, 1062), 'WP8.timesheet.inactiveWorker', 'F8', 'TS-6 (R-1): W8-I PATCHed status inactive, then a sheet naming W8-I: value refused (code the fix\'s), no sheet; today 201, one sheet - HR-F5', 'TS'),
  C('KA.F5.F8.capAcrossSheets', L(889, 930, 1062), 'WP8.timesheet.capAcrossSheets', 'F8', 'TS-4 (R-2): W8-1 sheet S1 16 h (201), sheet S2 9 h: value refused, one sheet; today 201, two sheets, 25 h on the day - HR-F5', 'TS'),
  C('TS.052.labour', L(445, 885), 'WP8.052-FLD.labour', '052-FLD,stored:052-FLD', '052-FLD timesheet.mixed (state id, the 052 PM\'s read): approved, totalCost 650.00 (MOMENT-MAP row 250)', 'F52'),

  C('Q.F8.dashboard21', L(92, 892, 922, 1152), 'WP8.quality.dashboard087FLD', 'F8', 'Q-2: F8\'s quality mix (NCRs major open, major closed, minor open, minor submitted, minor closed; legacy ITPs failed, waived, passed; no form ITP: WP8.F8.qualityMix): GET /quality/dashboard metrics.qualityScore 21, majorNcrs 2, minorNcrs 3, failedItps 1 (the CLAUDE.md rule, HR-Q3-neutral; catcher of M-QW: 15)', 'Q'),
  C('Q.F8.health21', L(92, 892), 'WP8.quality.health087FLD', 'F8', 'Q-2: GET /projects/F8/health: the quality dimension 21, detail 2 / 3 / 1 (catcher of the optional M-QWh)', 'Q'),
  C('Q.F8.workspace21', L(92, 892), 'WP8.quality.workspace087FLD', 'F8', 'Q-2: GET /projects/workspace-dashboard: F8\'s row dimensions.quality 21 (catcher of the optional M-QWw)', 'Q'),
  C('Q.F8.closeMajor', L(892), 'WP8.quality.closeMajorLeaves', 'F8', 'Q-4: F8\'s major-open NCR closed out by the site engineer (own evidence) and approved by the quality engineer (closed): the dashboard still 21 (closed NCRs count: the CLAUDE.md literal rule, HR-Q4 keeps it; the deviation WP8ADJ Q1 moves this close off 087-FLD)', 'Q'),
  C('Q.F8V.sixMajor', L(892, 922, 1152), 'WP8.quality.sixMajor', 'F8V', 'V-1: F8V\'s dashboard qualityScore 0 (100 - 6 x 20 = -20, clamped), majorNcrs 6 (catcher of M-CLAMP: -20)', 'Q'),
  C('Q.087.variant', L(430, 892), 'WP8.quality.sixMajor', '087-FLD', '087-FLD\'s 6-major variant project (state variant.six-major): dashboard qualityScore 0 (WP8.quality.sixMajor), majorNcrs 6', 'F87'),
  C('KA.Q3.087.score', L(92, 430, 892, 1049), 'WP8.quality.formItpCounted087FLD', '087-FLD', '087-FLD\'s quality dashboard, health card and workspace row: value 6 (form ITPs counted: its A120 complete-fail form instance, WP-2\'s) on all three; today 21 on all three (the legacy register only; WP8.quality.dashboard087FLD / health087FLD / workspace087FLD) - HR-Q3', 'F87'),
  C('Q.052.score', L(445, 892), 'WP8.052-FLD.qualityScore', '052-FLD,stored:052-FLD', 'stored step quality.score out 21 / 2 / 3 / 1; live 052-FLD dashboard qualityScore 21 (the 052 PM; 052-FLD has no form ITP: HR-Q3-neutral; MOMENT-MAP row 250)', 'F52'),
  C('Q.F8.ncrReject', L(893), 'WP8.quality.ncrRejectWithoutReason', 'F8', 'Q-3 (quality engineer): reject of minor-submitted with no reason: \'400 VALIDATION_ERROR\' (details naming reason); reject of minor-open with a reason: \'409 NCR_NOT_READY_FOR_REJECTION\' (WP8.quality.ncrRejectNotSubmitted); both unchanged', 'Q'),
  C('Q.F8.ncrReopen', L(893), 'WP8.quality.ncrReopenWithoutReason', 'F8', 'Q-3: reopen of minor-closed with no reason: \'400 VALIDATION_ERROR\'; reopen of minor-open with a reason: \'409 NCR_NOT_READY_FOR_REOPEN\' (WP8.quality.ncrReopenNotClosed); both unchanged', 'Q'),
  C('Q.F8.ncrApproveClose', L(893), 'WP8.quality.ncrApproveNotSubmitted', 'F8', 'Q-3: approve of minor-open: \'409 NCR_NOT_READY_FOR_APPROVAL\'; the site engineer\'s closeout of minor-closed (full payload, own evidence): \'409 NCR_NOT_READY_FOR_CLOSEOUT\' (WP8.quality.ncrCloseNotOpen); both unchanged', 'Q'),
  C('KA.Q5.F8.severityDowngrade', L(894, 931, 1051), 'WP8.quality.severityDowngradeProbe', 'F8', 'Q-5: the quality engineer PATCHes the closed major { severity: minor }: value refused (code the fix\'s), dashboard 21; today 200, dashboard 33 (then PATCHed back to major) - HR-Q5', 'Q'),
  C('KA.Q4.F8.legacyItpStatus', L(894, 931, 1050), 'WP8.quality.legacyItpFailedToPassedProbe', 'F8', 'Q-5: the quality engineer PATCHes the failed legacy ITP { status: passed } with no reason: value refused, dashboard 21; today 200, dashboard 36 (then PATCHed back to failed) - HR-Q4', 'Q'),
  C('KA.Q5.F8V.evidenceWiped', L(894, 931, 1051), 'WP8.quality.evidenceWipedBeforeApprovalProbe', 'F8V', 'V-2: minor NCR V-E closed out with its own evidence (submitted); PATCH { attachmentRefs: [] }; the quality engineer approves: value not approved, V-E stays submitted; today 200 closed - HR-Q5', 'Q'),
  C('KA.X1.F8V.textOnly', L(894, 931, 1052), 'WP8.quality.textOnlyEvidenceProbe', 'F8V', 'V-3: minor NCR V-T closed out with attachmentRefs [{ fileName only }]: value the HR-X1 batch\'s contract for a reference naming no stored document (CONTRACT HR-X1: mode, answer, ncrStatus; filled from the batch, O10); today 200 submitted, the text-only reference counted as evidence - HR-X1 (BLOCKED while FIXES[\'HR-X1\'].commit is null)', 'Q'),
  C('KA.Q4.F8V.hardDelete', L(894, 931, 1050), 'WP8.quality.hardDeleteProbe', 'F8V', 'V-4: the PM DELETEs one of F8V\'s major NCRs and a pending legacy ITP made for it: value each row reads back archived (archivedAt set); today 200 { deleted: true } and each row gone (F8V\'s score stays 0 either way) - HR-Q4', 'Q'),

  C('P.F8.closeByNonApprover', L(896, 922, 1152), 'WP8.punch.closeByNonApprover', 'F8', 'P-1: the item destined closed (final approver the quality engineer) walked open -> ready_for_review by the site engineer; the PM\'s close: \'403 PUNCH_FINAL_APPROVER_ONLY\', still ready_for_review; the quality engineer\'s close (sent only while it is still ready_for_review): 200 closed (catcher of M-PFA: the PM\'s close 200)', 'P'),
  C('KA.F3.F8.approverBypass', L(896, 932, 1060), 'WP8.punch.finalApproverBypass', 'F8', 'P-3 (after P.F8.mix): a further open item (approver the quality engineer); the site engineer PATCHes finalApproverUserId to the PM, then the PM closes: value the PATCH refused (code the fix\'s) and the close \'403 PUNCH_FINAL_APPROVER_ONLY\'; today PATCH 200 and the close 200 closed - HR-F3', 'P'),
  C('P.F8.mix', L(897), 'WP8.punch.openDefects', 'F8', 'P-2: F8\'s punch draft 2, open 2, ready 1, dispute 1, closed 1, void 1 and observations safety open, environmental draft, quality closed, work_to_complete void, commissioning closed (WP8.F8.punchMix): dashboard openDefects 6 (4 without the drafts), observationsOpen 2, safetyObservationsOpen 1 (WP8.punch.*)', 'P'),
  C('P.087.mix', L(430, 897), 'WP8.punch.openObservations', '087-FLD', '087-FLD dashboard: openDefects 6, observationsOpen 2, safetyObservationsOpen 1', 'F87'),
  C('P.F8.transitionTable', L(898), 'WP8.punch.transitionTable', 'F8', 'P-2: as the PM, on F8\'s items in each of the 6 states: every one of the 29 pairs outside TRANSITION_RULES answers \'409 PUNCH_TRANSITION_INVALID\' and the 8 reason-required legal pairs sent without a reason answer \'400 PUNCH_REASON_REQUIRED\' (WP8.punch.illegalTransitions, reasonRequiredPairs); no item changes state (the 5 other legal pairs are not sent)', 'P'),

  C('KA.SAFE.F8.health', L(900, 933, 1116), 'WP8.safety.health', 'F8', 'SF-2: F8\'s open near miss, closed LTI (lost days 3, own evidence) and archived near miss (WP8.F8.safetySet): health safety value 75 (archived excluded), detail.openInvestigations 1; today 70 and 2 (the archived one counted open) - SAFE-ARCH-1', 'SF'),
  C('SF.F8.workspace', L(900), 'WP8.safety.workspace', 'F8', 'SF-2: workspace-dashboard F8 row dimensions.safety 75 (archivedAt null filter)', 'SF'),
  C('SF.F8.dashboard', L(900, 922, 1152), 'WP8.safety.dashboardIncidents', 'F8', 'SF-2: F8\'s quality dashboard metrics.safetyIncidents 2, safetyOpen 1 (live() drops archived and void; WP8.safety.dashboardOpen; catcher of M-ARCH: 3 / 2)', 'SF'),
  C('KA.SAFE.087.health', L(430, 900, 933, 1116), 'WP8.safety.health', '087-FLD', '087-FLD health safety: value 75; today 70 - SAFE-ARCH-1', 'F87'),
  C('SF.087.workspaceDashboard', L(430, 900), 'WP8.safety.workspace', '087-FLD', '087-FLD workspace row safety 75; quality dashboard safetyIncidents 2, safetyOpen 1 (WP8.safety.dashboardIncidents / dashboardOpen)', 'F87'),
  C('KA.SAFE.052.health', L(445, 900, 933, 1116), 'WP8.052-FLD.safetyHealth', '052-FLD,stored:052-FLD', 'step safety.score (BLOCKED HR-K1 in the build, observed 70) and the live 052-FLD health safety (052 PM): value 75; today 70 - SAFE-ARCH-1 (STORED-PRE-FIX after its fix until the exit rebuild; MOMENT-MAP row 251)', 'F52'),
  C('KA.Q5.F8.ltiEdit', L(902, 931, 1051), 'WP8.safety.ltiEditAfterClosure', 'F8', 'SF-3 (after the SF-2 reads): the site engineer PATCHes the closed LTI { lostDays: 5 }: value refused (code the fix\'s), lostDays 3; today 200, lostDays 5 - HR-Q5', 'SF'),
  C('SF.F8.fatality', L(901), 'WP8.safety.fatality', 'F8', 'SF-4: a fatality (incidentType fatality, open) added on F8: health safety 0 (clamped; 0 under either archived reading)', 'SF'),

  C('KA.RFI.F8.officialAfterClose', L(904, 934, 1114), 'WP8.rfi.officialResponseAfterClose', 'F8', 'R-2: RFI-C closed (answered by the planner, approved by the PM): the PM PATCHes /rfi/C/responses/<official> { body }, then /rfi/C { response }: value 409 each (code the fix\'s; the book assumes RFI_ALREADY_CLOSED, CONTRACT), the answer unchanged; today 200 each, the answer rewritten and the previous text kept nowhere (WP8.rfi.officialResponsePaths) - RFI-RESP-1', 'R'),
  C('R.F8.reopenWithoutReason', L(905), 'WP8.rfi.reopenWithoutReason', 'F8', 'R-3: the PM\'s reopen of RFI-C with no reason: \'400 VALIDATION_ERROR\' (details naming reason); still closed', 'R'),
  C('R.F8.reopenRevision', L(905), 'WP8.rfi.reopenRevision', 'F8', 'R-3: the PM\'s reopen of RFI-C with a reason: 200 open, revision 0 -> 1 (+1)', 'R'),
  C('R.F8.scheduleImpact', L(907), 'WP8.rfi.scheduleImpactLink', 'F8', 'R-1: RFI-C (scheduleImpactFlag true, scheduleImpact 3, on F8-A1) on its close: a workflow activity link on F8-A1, relationType schedule_impact, scheduleImpactDays 3 (read-only SQL)', 'R'),
  C('R.087.scheduleImpact', L(430, 907), 'WP8.rfi.scheduleImpactLink', '087-FLD', '087-FLD\'s closed RFI (state rfi.closed): its schedule_impact link on A180 carries 3 days (read-only SQL)', 'F87'),
  C('R.087.overdueApi', L(430, 906), 'WP8.rfi.overdueApiDueDate', '087-FLD,stored:087-FLD', 'GET /rfi/<RRB>: dueDate its responseRequiredBy, isOverdue true; GET /rfi/<ANS>: its own dueDate, isOverdue true; ?overdue=true lists both (WP8.rfi.overdueDetail / overdueListFilter; MOMENT-MAP row 184)', 'F87'),
  C('R.087.overdueStored', L(430, 906), 'WP8.rfi.overdueStoredDueDate', '087-FLD', 'read-only SQL: RRB\'s stored dueDate null; ANS\'s its past day (MOMENT-MAP row 185)', 'F87'),
  C('KA.K1.F8.rfiOverdueHealth', L(906, 935, 1096), 'WP8.rfi.overdueHealthF8', 'F8', 'R-4: F8\'s health docControl detail.overdueRfis after RFI-RRB (open, responseRequiredBy R-3, dueDate null) and after RFI-ANS (dueDate R-4, answered by the planner): value deltas +1 / +0 (the workspace basis, WP8.rfi.overdueHealth); today +0 / +1 - HR-K1', 'R'),
  C('R.F8.overdueSurfaces', L(906), 'WP8.rfi.overdueWorkspaceF8', 'F8', 'R-4: GET /rfi/<RRB> and /rfi/<ANS> isOverdue true; ?overdue=true lists both; the workspace F8 docControl falls by 10 with RRB and by 0 with ANS (no submittal change between the three reads; WP8.rfi.overdueDetail / overdueListFilter / overdueWorkspace)', 'R'),

  C('SUB.F8.submitBy', L(909, 922, 1152), 'WP8.submittal.submitByTemplated', 'F8', 'SUB-1: template T8 (QS 3 days, planner 4 days: WP8.submittal.template); SUB-T on T8 and SUB-D direct, both requiredOnSite 2027-01-25, lead 2 weeks: submitBy 2027-01-04 and 2027-01-11 (WP8.submittal.submitByDirect; catcher of M-RD: 2027-01-11)', 'SUB'),
  C('SUB.087.submitBy', L(430, 909), 'WP8.submittal.submitByDirect', '087-FLD', '087-FLD submittals (state ids): templated 2027-01-04, direct 2027-01-11 (stored at create; no mutant moves them)', 'F87'),
  C('SUB.F8.impactDays', L(910), 'WP8.F8.submittalImpact', 'F8', 'SUB-4: SUB-I direct, requiredOnSite R+5, lead 2 weeks, on F8-A2, submitted and approved by the PM: scheduleImpactDays = rules.submittalImpactDays over its observed reviewedOn (10 when approved on day R; WP8.submittal.impactDaysRule / impactDaysExample); the submittal_lead_time link on F8-A2 carries the same days', 'SUB'),
  C('KA.F1.F8.pmApproveWhilePending', L(911, 936, 1058), 'WP8.submittal.pmApprovalWhileStepsPending', 'F8', 'SUB-2: SUB-T submitted (T8 step 1 active): the PM approves: value 409 (code the fix\'s), not approved; today 200 approved, the 2 steps left undecided - HR-F1', 'SUB'),
  C('SUB.F8.responseCodeReset', L(912), 'WP8.submittal.responseCodeResetOnNewCycle', 'F8', 'SUB-3: SUB-R on T8 submitted; the QS decides reject revise_resubmit with a comment (status resubmit, responseCode revise_resubmit); the site engineer resubmits: revisionNumber +1, responseCode null, responseCodeLabel null', 'SUB'),

  C('D.F8.storeman', L(914, 922, 1152), 'WP8.drawing.storemanRevisions', 'F8', 'D-1: F8-S1 A approved then superseded by B (both via submit-review and the PM\'s approve), C uploaded, X8 filed approved and not latest by the PM (WP8.F8.drawings, WP8.drawing.currentOnlyFixture): the warehouse keeper\'s register revisions exactly ["B"] (catcher of M-LAT: ["B", "X8"])', 'D'),
  C('D.087.storeman', L(430, 914), 'WP8.drawing.storemanRevisions', '087-FLD', '087-FLD S-1 as the warehouse keeper reads it: exactly ["B"] (X1 present, approved, not latest)', 'F87'),
  C('D.F8.approveSuperseded', L(915), 'WP8.drawing.approveSuperseded', 'F8', 'D-2: the PM approves F8-S1 rev A (superseded): \'409 DOCUMENT_REVISION_SUPERSEDED_READ_ONLY\'; nothing changes', 'D'),
  C('D.F8.supersedeWithoutReason', L(915), 'WP8.drawing.supersedeWithoutReason', 'F8', 'D-2: the PM supersedes F8-S1 rev C with no reason: \'400 VALIDATION_ERROR\' (details naming reason); C unchanged', 'D'),
  C('KA.F2.F8.approveWithoutReview', L(915, 937, 1059), 'WP8.drawing.approveWithoutReview', 'F8', 'D-3: F8-S2 rev A uploaded (never submitted for review): the PM approves: value refused (code the fix\'s), still uploaded; today 200 approved, latest - HR-F2', 'D'),
  C('KA.F2.F8.approveOutOfOrder', L(915, 937, 1059), 'WP8.drawing.approveOutOfOrder', 'F8', 'D-3: F8-S2 revs B and C uploaded and reviewed; C approved (latest); then B approved: value refused, C stays the latest approved; today 200, B latest and C superseded - HR-F2', 'D'),

  C('T.087.transmittal', L(430, 917), 'WP8.transmittal.activityAndRevision', '087-FLD', '087-FLD transmittal (state id): its activity links include A180; its revisions include S-1 rev B by the state\'s revision id and stored document', 'F87'),
  C('T.087.noticeLetter', L(430), 'WP8.transmittal.noticeLetterReadBack', '087-FLD', '087-FLD weather delay (state notice-letter.weatherDelayId): correspondenceLinks exactly 1, the notice letter, contractualNotice true; the correspondence register summary.notices 1 (WP8.transmittal.noticeRegisterCount)', 'F87'),
  C('T.087.meetingChangeEvent', L(430), 'WP8.transmittal.meetingChangeEventReadBack', '087-FLD', '087-FLD change event (state meeting.changeEventId): origin meeting, sourceRecordType meeting_action, sourceRecordId and the single sourceLinks entry = action item 1, title "Meeting action: <its title>", activityId A160, type other, romAmount 0, scheduleImpactDays 0', 'F87'),
  C('KA.F6.F8.patchStatus', L(918, 938, 1063), 'WP8.transmittal.distributeBypass', 'F8', 'M-1: meeting M8a (draft): the planner PATCHes { status: distributed }: value refused (code the fix\'s), still draft; today 200 distributed - HR-F6', 'T'),
  C('KA.F6.F8.actionItemIdentity', L(919, 938, 1063), 'WP8.transmittal.actionItemIdentity', 'F8', 'M-3: meeting M8c with action item 1 (createTask, owner the site engineer) and 2 (no task): the planner PATCHes actionItems re-sending item 1 without its id and taskId: value item 1 keeps its id; today a new id - HR-F6', 'T'),
  C('KA.F6.F8.duplicateTask', L(919, 938, 1063), 'WP8.transmittal.createTaskTasks', 'F8', 'M-3: after the same PATCH, F8\'s tasks titled as item 1 (read-only SQL): value 1; today 2 - HR-F6', 'T'),

  C('CF.HRF4', L(883, 928, 1061), 'WP8.CF.HRF4', 'F8,stored:087-FLD,static', 'confirm-first HR-F4: approval from open (KA.F4.F8.approveFromOpen), an empty day approved (KA.F4.F8.approveEmpty), reopen without a reason (KA.F4.F8.reopenNoReason), contractual weather delays by site staff (WP-7\'s KA.F4.T7.sitePromotion observation read from results/cert3/wp7-eot-proof.json, WP8ADJ Q8); reported beside them: 087-FLD\'s D1 approved straight from open (stored) - reported', 'CF'),
  C('CF.HRF5', L(889, 890, 930, 1062), 'WP8.CF.HRF5', 'F8', 'confirm-first HR-F5: the 24 h cap per sheet only (KA.F5.F8.capAcrossSheets), the rate read at approval (KA.F5.F8.rateTiming), inactive workers accepted (KA.F5.F8.inactiveWorker) - reported', 'CF'),
  C('CF.HRQ5', L(894, 902, 931, 1051), 'WP8.CF.HRQ5', 'F8,F8V', 'confirm-first HR-Q5: NCR severity editable after closure (KA.Q5.F8.severityDowngrade), safety lost days editable after closure (KA.Q5.F8.ltiEdit), approval does not re-check evidence (KA.Q5.F8V.evidenceWiped) - reported', 'CF'),
  C('CF.HRQ4', L(894, 931, 1050), 'WP8.CF.HRQ4', 'F8,F8V,static', 'confirm-first HR-Q4: NCR and legacy ITP hard delete (KA.Q4.F8V.hardDelete), a legacy ITP status changed freely with no reason (KA.Q4.F8.legacyItpStatus); reported beside them, never classified: closed NCRs keep counting (Q.F8.closeMajor, equal to HR-Q4\'s recommendation) - reported', 'CF'),
  C('CF.HRF3', L(896, 932, 1060), 'WP8.CF.HRF3', 'F8', 'confirm-first HR-F3: the punch final approver reassigned by a site engineer on an open item, and the close that follows (KA.F3.F8.approverBypass) - reported', 'CF'),
  C('CF.SAFEARCH', L(900, 933, 1116), 'WP8.CF.SAFEARCH', 'F8,087-FLD,052-FLD,static', 'confirm-first, the fix list\'s health excludes archived incidents (SAFE-ARCH-1): the health card counts the archived incident on F8, 087-FLD and 052-FLD (KA.SAFE.*), every other surface excludes it (SF.F8.workspace, SF.F8.dashboard; static: health.js reads every incident); severity evidence for the integration owner (P2 provisional, WP8ADJ Q4) - reported', 'CF'),
  C('CF.RFIRESP', L(904, 934, 1114), 'WP8.CF.RFIRESP', 'F8,static', 'confirm-first, the fix list\'s RFI official response frozen after closure (RFI-RESP-1): the official answer of a closed RFI rewritten through either path, the previous text kept nowhere (KA.RFI.F8.officialAfterClose); severity evidence (P1 provisional, WP8ADJ Q5: the first-party clients never send it, static) - reported', 'CF'),
  C('CF.HRK1rfi', L(906, 935, 1096), 'WP8.CF.HRK1rfi', 'F8,087-FLD', 'confirm-first HR-K1 (RFIs): health\'s overdue basis (dueDate only, answered counted, responseRequiredBy ignored) against the workspace\'s (KA.K1.F8.rfiOverdueHealth, R.F8.overdueSurfaces, R.087.overdueStored) - reported', 'CF'),
  C('CF.HRF1', L(911, 936, 1058), 'WP8.CF.HRF1', 'F8,static', 'confirm-first HR-F1: the PM\'s approval while review steps pend (KA.F1.F8.pmApproveWhilePending); reported beside it: the stale lead-time link (static: the link upserted only when days > 0; SUB-LINK-1, P2, recorded) - reported', 'CF'),
  C('CF.HRF2', L(915, 937, 1059), 'WP8.CF.HRF2', 'F8', 'confirm-first HR-F2: drawing approval without review and out of order (KA.F2.F8.*) - reported', 'CF'),
  C('CF.HRF6', L(918, 919, 938, 1063), 'WP8.CF.HRF6', 'F8,static', 'confirm-first HR-F6: status set by PATCH (KA.F6.F8.patchStatus); a draft distributed (M8b: POST distribute on a draft); minutes editable after distribution (M8b PATCH after distribute); action items re-created (KA.F6.F8.actionItemIdentity / duplicateTask); reported beside them: distribution rows always "sent" (M8b\'s rows; MTG-SENT-1, P2) and a transmittal acknowledged through PATCH (static; no rule names it) - reported', 'CF'),
  C('CF.TRN1', L(917), 'WP8.transmittal.createCitesFiled', 'F8', 'WP8-TRN-1 (P3): T-1, the planner\'s POST /transmittals and POST /correspondence naming F8-S1 rev B\'s stored document in revisions: \'404 FILE_NOT_FOUND\' "Revision source file not found", nothing written (recordDocumentRevisions with no writer); expected unchanged after the HR-X1 batch (r3b IQ-3): re-run then - reported', 'CF'),
  C('CF.L213', L(920, 939), 'WP8.leads.L213', 'F8', 'L213 (P3): a QS whose F8 template ("CERT3 WP8 task update without close", base qs, grant task|action:update, found or created by name: WP8.F8.l213Template) grants task:update but not task.close PATCHes an F8 task { status: done }: today 200, the task closed (closedAt set); the close action itself answers 403 FORBIDDEN to that member - reported', 'CF'),
  C('CF.L146', L(939), 'WP8.leads.L146', 'F8', 'L146 (P3 in the plan, P2 in the leads table): T-2, the planner (document_control:update) DELETEs an F8 transmittal: 200 { deleted: true }, the row gone, no audit event for it (read-only SQL); HR-A2 is the owner question (O7) - reported', 'CF'),
  C('CF.DVAL1', L(939), 'WP8.leads.DVAL1', 'F8', 'D-VAL-1 (P3): T-3 and V-5, POST /transmittals and the F8V NCR closeout with attachmentRefs[].storageKey an object, a number, a boolean: 201 / 200 with the key dropped; nothing naming another company; classified after the HR-X1 batch too (it rewrites normalizeAttachmentRefs\' judge, FIXES[\'HR-X1\']) - reported', 'CF'),
  C('CF.LDETAILS', L(939), 'WP8.leads.LDETAILS', 'static', 'L-DETAILS (register :303): production drops error.details (error-handler.js includeDetails, api-response.js); a source scan of frontend/src and mobile (app, src; tests excluded) lists every client reader of an error\'s details and the set equals the seven of WP8.leads.LDETAILS (a new reader is a sweep gap); each degrades to an empty list, a null id or the generic sentence - reported', 'CF'),
];
/** Fixed before the first run: the checks above (G.5xx is the harness's own, on top). WP8-PREP's draft list (wp8-checks-draft.json): 112. */
const EXPECTED_CHECKS = 112;
// </CHECKS>
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((c) => c.id)).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');

/** Which projects each section touches (the --project filter selects sections). */
const SECTION_PROJECTS = {
  S: ['F8', 'F8V', '087-FLD', '052-FLD', 'static'],
  DL: ['F8'], TS: ['F8', 'static'], Q: ['F8', 'F8V'], P: ['F8'], SF: ['F8'], R: ['F8'], SUB: ['F8'], D: ['F8'], T: ['F8'],
  F87: ['087-FLD'], F52: ['052-FLD'],
  CF: ['F8', 'F8V', '087-FLD', '052-FLD', 'static'],
};
for (const c of CHECKS) if (!SECTION_PROJECTS[c.section]) throw new Error(`check ${c.id}: section ${c.section} is not in SECTION_PROJECTS`);
for (const [flag, set] of [['only', ONLY], ['skip', SKIP]]) {
  for (const section of set || []) if (!SECTION_PROJECTS[section]) throw new Error(`--${flag}: no section ${section} (sections: ${Object.keys(SECTION_PROJECTS).join(' ')})`);
}
if (PROJECT_FILTER && !Object.values(SECTION_PROJECTS).some((list) => list.includes(PROJECT_FILTER))) throw new Error(`--project: no project ${PROJECT_FILTER}`);
/** The sections CF classifies from (confirmFirstFlow reads their records, known answers and observations). */
const CF_SOURCES = ['DL', 'TS', 'Q', 'P', 'SF', 'R', 'SUB', 'D', 'T', 'F87', 'F52'];
const selectedSections = new Set(Object.keys(SECTION_PROJECTS).filter((section) => {
  if (ONLY && !ONLY.has(section)) return false;
  if (PROJECT_FILTER && !SECTION_PROJECTS[section].includes(PROJECT_FILTER)) return false;
  return true;
}));
if (SKIP?.has('CF')) selectedSections.delete('CF');
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
const wheresOf = (c) => String(c.where).split(',');
/** Where the selected (non-setup) checks run: the setup checks never pull a project in (L5). */
const runsOn = (code) => ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).some((w) => w === code || w === `stored:${code}`));
/** The throwaways: F8 for DL / TS / Q / P / SF / R / SUB / D / T (and CF), F8V for Q (and CF). */
const F8_SECTIONS = ['DL', 'TS', 'Q', 'P', 'SF', 'R', 'SUB', 'D', 'T', 'CF'];
const NEED_F8 = F8_SECTIONS.some(on);
const NEED_F8V = on('Q') || on('CF');
/** The deep projects (live or stored) the selected checks need. */
const NEED_DEEP = Object.keys(DEEP).filter((code) => runsOn(code));
/** Live reads of a deep project (stored-only checks need its state file, not the project). */
const NEED_LIVE = Object.keys(DEEP).filter((code) => ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes(code)));
/** The companies a run touches: 087 always; 052 only for the read-only F52 section (WP8ADJ Q9). */
const NEED_COMPANIES = Object.freeze(['087', ...(on('F52') ? ['052'] : [])]);
if (Object.entries(DEEP).some(([code, d]) => !['087', '052'].includes(d.company) || (d.company === '052' && code !== '052-FLD'))) throw new Error('a deep project outside company 087 and the read of 052-FLD (WP8ADJ Q9)');

// -- small helpers --------------------------------------------------------------------------------------------------
/** A list out of an answer's data: the array itself, or its items / rows / ... */
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items', 'rows', 'entries', 'revisions', 'data']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const json = (v, max = 600) => { try { return JSON.stringify(v).slice(0, max); } catch { return String(v).slice(0, max); } };
/** Sorted-key JSON text: the same object gives the same text whatever order its keys were written in. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
};
const sameJson = (a, b) => canonical(a) === canonical(b);
/** The fields of `obj` that `shape` names (a known answer judged on the fields its leaf states). */
const pick = (obj, shape) => Object.fromEntries(Object.keys(shape).map((k) => [k, obj?.[k] === undefined ? null : obj[k]]));
const readState = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${code}.json`), 'utf8'));
const stepAt = (st, step) => st?.steps?.[step]?.finishedAt || st?.steps?.[step]?.blocked?.at || st?.steps?.[step]?.out?.readAt || null;
/** Money as integer cents (the API answers currency units); a value that is not an exact amount reads as a string, so it never matches. */
const cents = (v) => {
  if (v === null || v === undefined) return null;
  try { return harness.toCents(v); } catch { return `not cents: ${v}`; }
};
/** The calendar day of a timestamp or a date (YYYY-MM-DD, UTC). */
const dayOf = (v) => (v ? String(typeof v === 'string' ? v : new Date(v).toISOString()).slice(0, 10) : null);
/** An answer string as { status, code } (code null when the answer carried none). */
const saidParts = (said) => { const [status, code = null] = String(said).split(' '); return { status: Number(status), code }; };
const is2xx = (status) => Number(status) >= 200 && Number(status) < 300;
/** The calendar day `n` days from an ISO day (UTC). */
const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** A day of the book ('R-6', 'R+5', 'R') as its offset from R in days. */
const offsetOf = (label) => {
  const m = /^R([+-]\d+)?$/.exec(String(label));
  if (!m) throw new Error(`answer book: ${label} is not a day offset R+n / R-n`);
  return m[1] ? Number(m[1]) : 0;
};
/** A book row by its key (exactly one expected). */
const oneRow = (list, pred, what) => {
  const rows = list.filter(pred);
  if (rows.length !== 1) throw new Error(`answer book: ${rows.length} rows for ${what} (exactly one expected)`);
  return rows[0];
};
/** The numbers of a book text ("stored 0 / 1 / 1" -> [0, 1, 1]). */
const numbersIn = (text) => (String(text).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
/** A choreography step text by its head (F8-0, DA, TS-1, ..., end). */
const stepText = (steps, head) => oneRow(steps, (s) => s.split(' ')[0] === head, `choreography step ${head}`);

// -- F8, F8V and their figures as the book types them (currency units in payloads, cents in the leaves) ---------------
const F8B = {
  project: WP8.F8.project.value, team: WP8.F8.team.value, activities: WP8.F8.activities.value, workers: WP8.F8.workers.value,
  evidence: WP8.F8.evidence.value, days: WP8.F8.days.value, timesheets: WP8.F8.timesheets.value, qualityMix: WP8.F8.qualityMix.value,
  punchMix: WP8.F8.punchMix.value, safetySet: WP8.F8.safetySet.value, rfis: WP8.F8.rfis.value, submittals: WP8.F8.submittals.value,
  l213: WP8.F8.l213Template.value, manpower: WP8.F8.manpower.value, submittalImpact: WP8.F8.submittalImpact.value, drawings: WP8.F8.drawings.value,
  meetings: WP8.F8.meetings.value, residue: WP8.F8.residue.value, choreography: WP8.F8.choreography.value,
};
const F8VB = { project: WP8.F8V.project.value, team: WP8.F8V.team.value, records: WP8.F8V.records.value, choreography: WP8.F8V.choreography.value };
/** A day of F8 by its book key (DA .. DE). */
const dayBook = (key) => oneRow(F8B.days, (d) => d.day === key, `WP8.F8.days ${key}`);
/** A timesheet of F8 by its book key (TS-1 .. TS-7). */
const sheetBook = (key) => oneRow(F8B.timesheets, (s) => s.sheet === key, `WP8.F8.timesheets ${key}`);
/** A safety record of F8 by its book ref (SF-NM, SF-LTI, SF-ARC). */
const incidentBook = (ref) => oneRow(F8B.safetySet.incidents, (i) => i.ref === ref, `WP8.F8.safetySet ${ref}`);
/** The punch-table rows of the book (action -> from-state -> answer). */
const PUNCH_TABLE = WP8.punch.transitionTable.value;
const PUNCH_STATES = ['draft', 'open', 'ready_for_review', 'closed', 'in_dispute', 'void'];

/**
 * Fixture inputs that are not expected figures (WP4ADJ B8 precedent; WP-6's and WP-7's FIXTURE): texts, times, the
 * product codes of the book's incident labels, the malformed storage keys of the D-VAL-1 probe, and build choices
 * (RFI-C carries no due date so that F8's overdue baseline is RFI-RRB and RFI-ANS alone). Every leaf that states a
 * figure of the choreography is checked against the book's own rules below, so a book or fixture change refuses to load.
 */
const FIXTURE = Object.freeze({
  manpowerCompany: 'Own labour',
  delayType: 'weather',
  entryTimes: Object.freeze({ regular: ['07:00', '15:00'], overtime: ['15:00', '17:00'], double: ['17:00', '18:00'] }),
  halfWorker: Object.freeze({ trade: 'Labourer', hourlyRate: 50, overtimeMultiplier: 0.5, hours: 2 }),
  incidentType: Object.freeze({ 'near miss': 'near_miss', LTI: 'lti', fatality: 'fatality' }),
  rfiC: Object.freeze({ dueDate: null }),
  submittalRevision: '0',
  drawingFixtureLabel: 'X8',
  meetingType: 'coordination',
  malformedKeys: Object.freeze([Object.freeze({ kind: 'object', value: Object.freeze({ nested: 'x' }) }), Object.freeze({ kind: 'number', value: 42 }), Object.freeze({ kind: 'boolean', value: true })]),
  rewrittenAnswerA: 'Answer rewritten through the responses path after closure',
  rewrittenAnswerB: 'Answer rewritten through the record path after closure',
  // the workspace row is asked of these in turn (each reads the quality, safety, RFI and submittal modules, so its row is not narrowed)
  pollWorkspacePersonas: Object.freeze(['pm', 'site', 'quality']),
});
// The fixture and the book's own figures against every leaf that states them (a mismatch refuses to load).
{
  const problems = [];
  const v = (leaf) => leaf.value;
  // daily logs: the manpower of DA (G15) and the promotions of DB
  const da = dayBook('DA');
  const counted = da.entries.filter((e) => e[4] === 'approved');
  const byTrade = Object.fromEntries(counted.map((e) => [e[0], e[1] * e[2]]));
  const total = counted.reduce((s, e) => s + e[1] * e[2], 0);
  const workers = counted.reduce((s, e) => s + e[1], 0);
  const all = da.entries.reduce((s, e) => s + e[1] * e[2], 0);
  const allWorkers = da.entries.reduce((s, e) => s + e[1], 0);
  const mp = F8B.manpower;
  if (byTrade.Steelfixer !== mp.Steelfixer || byTrade.Carpenter !== mp.Carpenter || 'Labourer' in byTrade || mp.Labourer !== 'absent' || total !== mp.total || workers !== mp.workers) problems.push('WP8.F8.manpower is not DA\'s approved entries');
  if (mp.Steelfixer !== v(WP8.dailyLog.manpowerSteelfixer) || mp.Carpenter !== v(WP8.dailyLog.manpowerCarpenter) || mp.total !== v(WP8.dailyLog.manpowerTotal) || mp.workers !== v(WP8.dailyLog.manpowerWorkers) || v(WP8.dailyLog.manpowerLabourer) !== 'absent') problems.push('WP8.F8.manpower is not WP8.dailyLog.manpower*');
  if (all !== v(WP8.mutations.manpowerStatusFilter) || allWorkers !== v(WP8.mutations.manpowerStatusFilterWorkers)) problems.push('DA\'s entries counted whatever their status are not WP8.mutations.manpowerStatusFilter / Workers');
  const db = dayBook('DB');
  if (!sameJson(db.delays.map(([hours]) => RULESET.promoteDays(hours)), [v(WP8.dailyLog.promote2h), v(WP8.dailyLog.promote6h), v(WP8.dailyLog.promote10h)])) problems.push('DB\'s delays promoted are not WP8.dailyLog.promote2h / 6h / 10h');
  const pvs = WP8.dailyLog.promoteResponseVsStored;
  if (!sameJson(numbersIn(pvs.value), db.delays.map(([hours]) => RULESET.promoteDays(hours))) || !sameJson(numbersIn(pvs.today), db.delays.map(([hours]) => Math.trunc(RULESET.promoteDays(hours))))) problems.push('WP8.dailyLog.promoteResponseVsStored is not DB\'s promotions and their Int truncation');
  const c11 = COMMERCIAL.WP7.weather['087-FLD.promoted.days'];
  if (!sameJson(c11.value, numbersIn(pvs.value)) || !sameJson(c11.today, numbersIn(pvs.today))) problems.push('WP7.weather[087-FLD.promoted.days] is not WP8.dailyLog.promoteResponseVsStored');
  // timesheets
  const w81 = F8B.workers['W8-1'];
  const rateCents = Math.round(w81.hourlyRate * 100);
  const ts1 = sheetBook('TS-1');
  const priced = RULESET.labourCents(ts1.entries.map(([hours, timeType]) => ({ hours, rateCents, timeType, otMultiplier: w81.overtimeMultiplier })));
  if (priced !== v(WP8.timesheet.mixedDay)) problems.push('TS-1 priced by rules.labourCents is not WP8.timesheet.mixedDay');
  const dtMutant = ts1.entries.reduce((s, [hours, timeType]) => s + Math.round(hours * rateCents * (timeType === 'overtime' ? Math.max(1, w81.overtimeMultiplier) : 1)), 0);
  if (dtMutant !== v(WP8.mutations.doubleTimeMultiplier)) problems.push('TS-1 with double time at 1 is not WP8.mutations.doubleTimeMultiplier');
  const ts5 = sheetBook('TS-5');
  const rateLeaf = WP8.timesheet.rateChangeRecorded;
  if (ts5.entries[0][0] * ts5.rateChange[0] * 100 !== rateLeaf.value || ts5.entries[0][0] * ts5.rateChange[1] * 100 !== rateLeaf.today) problems.push('TS-5 is not WP8.timesheet.rateChangeRecorded (value at the submission rate, today at the approval rate)');
  const ts4 = sheetBook('TS-4');
  if (ts4.acrossSheets.reduce((s, x) => s + x, 0) !== WP8.timesheet.capAcrossSheets.today.hoursOnTheDay || ts4.acrossSheets.length !== WP8.timesheet.capAcrossSheets.today.sheetsCreated) problems.push('TS-4 is not WP8.timesheet.capAcrossSheets today');
  const ts2 = sheetBook('TS-2');
  if (ts2.entries[0][0] <= 24 || ts2.split.reduce((s, x) => s + x, 0) <= 24 || ts2.split.some((x) => x > 24)) problems.push('TS-2 does not exceed 24 h in one entry and in a split');
  const H = FIXTURE.halfWorker;
  if (Math.round(H.hours * H.hourlyRate * 100 * RULESET.multiplierFor('overtime', H.overtimeMultiplier)) !== v(WP8.timesheet.multiplierHalf)) problems.push('FIXTURE.halfWorker is not WP8.timesheet.multiplierHalf');
  if (F8B.workers.crew.members.length !== 1 || F8B.workers.crew.defaultHours !== 8) problems.push('C8 is not W8-1 alone at 8 h (TS-3)');
  // quality
  const Q = F8B.qualityMix;
  const majors = Q.ncrs.filter((n) => n[1] === 'major').length;
  const minors = Q.ncrs.filter((n) => n[1] === 'minor').length;
  const failed = Q.legacyItps.filter((s) => s === 'failed').length;
  const qs = (major, minor, failedItp, extra = {}) => RULESET.qualityScore({ major, minor, failedItp, ...extra });
  if (qs(majors, minors, failed) !== v(WP8.quality.dashboard087FLD) || v(WP8.quality.dashboard087FLD) !== v(WP8.quality.health087FLD) || v(WP8.quality.health087FLD) !== v(WP8.quality.workspace087FLD) || qs(majors, minors, failed) !== v(WP8.quality.closeMajorLeaves) || Q.formInstances !== 0) problems.push('WP8.F8.qualityMix is not WP8.quality.dashboard087FLD / health / workspace / closeMajorLeaves (no form instance)');
  if (qs(majors - 1, minors + 1, failed) !== WP8.quality.severityDowngradeProbe.today.score || qs(majors, minors, failed) !== WP8.quality.severityDowngradeProbe.value.score) problems.push('the severity probe is not WP8.quality.severityDowngradeProbe');
  if (qs(majors, minors, failed - 1) !== WP8.quality.legacyItpFailedToPassedProbe.today.score || qs(majors, minors, failed) !== WP8.quality.legacyItpFailedToPassedProbe.value.score) problems.push('the legacy ITP probe is not WP8.quality.legacyItpFailedToPassedProbe');
  if (qs(majors, minors, failed, { weights: { major: 20, minor: 10, failedItp: 15 } }) !== v(WP8.mutations.qualityWeightMinor10)) problems.push('M-QW is not WP8.mutations.qualityWeightMinor10');
  if (qs(F8VB.records.majorNcrs, 0, 0) !== v(WP8.quality.sixMajor) || qs(F8VB.records.majorNcrs, 0, 0, { clamp: false }) !== v(WP8.mutations.dropClamp)) problems.push('F8V\'s majors are not WP8.quality.sixMajor / WP8.mutations.dropClamp');
  if (WP8.quality.formItpCounted087FLD.today !== v(WP8.quality.dashboard087FLD)) problems.push('WP8.quality.formItpCounted087FLD today is not 087-FLD\'s legacy reading');
  // punch
  const pm = F8B.punchMix;
  const openP = ['draft', 'open', 'ready_for_review', 'in_dispute'].reduce((s, k) => s + (pm.punch[k] || 0), 0);
  const obsOpen = Object.values(pm.observations).filter((s) => !['closed', 'void'].includes(s)).length;
  if (openP !== v(WP8.punch.openDefects) || openP - pm.punch.draft !== v(WP8.punch.openDefectsWithoutDrafts) || obsOpen !== v(WP8.punch.openObservations) || (pm.observations.safety === 'open' ? 1 : 0) !== v(WP8.punch.safetyObservationsOpen)) problems.push('WP8.F8.punchMix is not WP8.punch.openDefects / openDefectsWithoutDrafts / openObservations / safetyObservationsOpen');
  const cells = Object.values(PUNCH_TABLE).flatMap((row) => Object.values(row));
  if (cells.filter((x) => x.startsWith('409')).length !== v(WP8.punch.illegalTransitions) || cells.filter((x) => x.startsWith('ok with reason')).length !== v(WP8.punch.reasonRequiredPairs) || cells.filter((x) => x.startsWith('ok')).length !== v(WP8.punch.legalTransitions)) problems.push('WP8.punch.transitionTable is not illegalTransitions / reasonRequiredPairs / legalTransitions');
  if (!sameJson(Object.keys(pm.punch).sort(), [...PUNCH_STATES].sort()) || Object.keys(PUNCH_TABLE).some((a) => !sameJson(Object.keys(PUNCH_TABLE[a]).sort(), [...PUNCH_STATES].sort()))) problems.push('the punch mix or table does not cover the six states');
  // safety
  const ss = F8B.safetySet;
  const live = ss.incidents.filter((i) => i.status !== 'archived');
  const lti = live.filter((i) => i.type === 'LTI').length;
  const openLive = live.filter((i) => i.status !== 'closed').length;
  const openAll = ss.incidents.filter((i) => i.status !== 'closed').length;
  if (RULESET.safetyScore({ lti, open: openLive }) !== WP8.safety.health.value || RULESET.safetyScore({ lti, open: openAll }) !== WP8.safety.health.today || RULESET.safetyScore({ lti, open: openLive }) !== v(WP8.safety.workspace)) problems.push('WP8.F8.safetySet is not WP8.safety.health / workspace');
  if (live.length !== v(WP8.safety.dashboardIncidents) || openLive !== v(WP8.safety.dashboardOpen) || ss.incidents.length !== v(WP8.mutations.archivedFilterDashboardIncidents) || openAll !== v(WP8.mutations.archivedFilterDashboardOpen)) problems.push('WP8.F8.safetySet is not WP8.safety.dashboard* / WP8.mutations.archivedFilter*');
  if (RULESET.safetyScore({ fatalities: 1, lti, open: openLive + 1 }) !== v(WP8.safety.fatality)) problems.push('the fatality is not WP8.safety.fatality');
  if (incidentBook('SF-LTI').lostDays !== WP8.safety.ltiEditAfterClosure.value.lostDays || ss.ltiEditTo !== WP8.safety.ltiEditAfterClosure.today.lostDays) problems.push('SF-3 is not WP8.safety.ltiEditAfterClosure');
  for (const i of ss.incidents) if (!FIXTURE.incidentType[i.type]) problems.push(`FIXTURE.incidentType has no code for ${i.type}`);
  if (WP8.CF.SAFEARCH.value.F8 !== WP8.safety.health.value || WP8.CF.SAFEARCH.today.F8 !== WP8.safety.health.today || WP8['052-FLD'].safetyHealth.value !== WP8.safety.health.value) problems.push('WP8.CF.SAFEARCH is not WP8.safety.health');
  // RFIs
  if (F8B.rfis['RFI-C'].scheduleImpact !== v(WP8.rfi.scheduleImpactLink) || F8B.rfis['RFI-RRB'].dueDate !== null || F8B.rfis['RFI-ANS'].responseRequiredBy !== null) problems.push('WP8.F8.rfis is not WP8.rfi.scheduleImpactLink / overdueRecords');
  const oh = WP8.rfi.overdueHealthF8;
  if (oh.value.afterRRB !== (WP8.rfi.overdueHealth.value['RFI-RRB'] ? 1 : 0) || oh.value.afterANS !== (WP8.rfi.overdueHealth.value['RFI-ANS'] ? 1 : 0) || oh.today.afterRRB !== (WP8.rfi.overdueHealth.today['RFI-RRB'] ? 1 : 0) || oh.today.afterANS !== (WP8.rfi.overdueHealth.today['RFI-ANS'] ? 1 : 0)) problems.push('WP8.rfi.overdueHealthF8 is not WP8.rfi.overdueHealth as deltas');
  const ow = v(WP8.rfi.overdueWorkspaceF8);
  if (ow.afterRRB !== (v(WP8.rfi.overdueWorkspace)['RFI-RRB'] ? -10 : 0) || ow.afterANS !== (v(WP8.rfi.overdueWorkspace)['RFI-ANS'] ? -10 : 0)) problems.push('WP8.rfi.overdueWorkspaceF8 is not WP8.rfi.overdueWorkspace at -10 per overdue RFI');
  // submittals
  const sb = F8B.submittals;
  const reviewDays = sb.T8.steps.reduce((s, [, days]) => s + days, 0);
  const subBy = (template) => dayOf(RULESET.submitBy({ requiredOnSite: sb[template].requiredOnSite, leadTimeWeeks: sb[template].leadTimeWeeks, reviewDays: sb[template].template ? reviewDays : 0 }));
  if (subBy('SUB-T') !== v(WP8.submittal.submitByTemplated) || subBy('SUB-D') !== v(WP8.submittal.submitByDirect) || dayOf(RULESET.submitBy({ requiredOnSite: sb['SUB-T'].requiredOnSite, leadTimeWeeks: sb['SUB-T'].leadTimeWeeks, reviewDays: 0 })) !== v(WP8.mutations.reviewDaysInSubmitBy)) problems.push('T8, SUB-T and SUB-D are not WP8.submittal.submitBy* / WP8.mutations.reviewDaysInSubmitBy');
  const si = F8B.submittalImpact;
  for (const s of si.samples) if (RULESET.submittalImpactDays({ approvedAtIso: s.approvedAt, needByIso: s.needBy, leadTimeWeeks: si.leadTimeWeeks }) !== s.impactDays) problems.push(`WP8.F8.submittalImpact sample ${s.approvedAt} is not rules.submittalImpactDays`);
  if (si.samples[0].impactDays !== v(WP8.submittal.impactDaysExample) || si.needBy !== sb['SUB-I'].requiredOnSite || si.leadTimeWeeks !== sb['SUB-I'].leadTimeWeeks) problems.push('WP8.F8.submittalImpact is not SUB-I / WP8.submittal.impactDaysExample');
  // drawings
  const s1 = F8B.drawings['F8-S1'];
  const current = Object.entries(s1).filter(([, r]) => r.status === 'approved' && r.latest === true).map(([k]) => k).sort();
  const approvedAny = Object.entries(s1).filter(([, r]) => r.status === 'approved').map(([k]) => k).sort();
  if (!sameJson(current, v(WP8.drawing.storemanRevisions)) || !approvedAny.includes(FIXTURE.drawingFixtureLabel) || s1[FIXTURE.drawingFixtureLabel].latest !== false) problems.push('WP8.F8.drawings F8-S1 is not WP8.drawing.storemanRevisions with the X8 fixture');
  // meetings
  const m8c = F8B.meetings.M8c;
  if (m8c.items.filter((i) => i.createTask).length !== v(WP8.transmittal.createTaskTasks) || m8c.items.filter((i) => i.createTask).length * 2 !== WP8.transmittal.createTaskTasks.today) problems.push('M8c is not WP8.transmittal.createTaskTasks');
  // F8V and the CF leaves tie to the known answers they classify
  if (F8VB.records.minorNcrs.length !== 3 || F8VB.records.deletedMajor !== 1) problems.push('WP8.F8V.records is not V-E, V-T, V-D and one deleted major');
  if (!sameJson(WP8.CF.HRF4.value.approveFromOpen, WP8.dailyLog.approveFromOpen.value) || !sameJson(WP8.CF.HRF4.today.sitePromotion, COMMERCIAL.WP7.promotion.sitePromotion.today) || !sameJson(WP8.CF.HRF4.value.sitePromotion, COMMERCIAL.WP7.promotion.sitePromotion.value)) problems.push('WP8.CF.HRF4 is not the HR-F4 known answers and WP7.promotion.sitePromotion');
  if (WP8.CF.HRF5.value.rateTiming !== rateLeaf.value || WP8.CF.HRF5.today.rateTiming !== rateLeaf.today) problems.push('WP8.CF.HRF5 is not WP8.timesheet.rateChangeRecorded');
  // the F8 step heads against the proof's functions are the validator's; here, the step count and the M-PFA safety
  if (F8B.choreography.length !== 47 || F8VB.choreography.length !== 7) problems.push(`the F8 / F8V choreographies have ${F8B.choreography.length} / ${F8VB.choreography.length} steps, not 47 / 7`);
  if (!stepText(F8B.choreography, 'P-1').includes('only while still ready_for_review')) problems.push('the book\'s P-1 step no longer sends the quality engineer\'s close only while the item is ready_for_review (M-PFA safety)');
  if (problems.length) throw new Error(`FIXTURE against the WP-8 book: ${problems.join('; ')}`);
}

// -- rules, the fix commits and the contracts pending their decisions or plan reviews ----------------------------------
const WP8ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp8/WP8-ADJUDICATION.md ${item}`;
/**
 * The fix commits: EMPTY until each fix lands. The integration owner sets both fields from the fix commit
 * (`git show -s --format=%cI <commit>`); the proof checks the time against git (S.state). Once set, the rule is decided,
 * its KAs and CF are judged on the value, and a build record observed before the commit reads STORED-PRE-FIX. The owner
 * rules are undecided: their entries are set only by the commit that implements the owner's decision, together with
 * its CONTRACT fields. HR-X1 is decided (plan section 0.1); its entry is set by the WP-2 batch commit (binding ruling 7).
 * RFI-RESP-1 and SAFE-ARCH-1 are the section 5 defect fixes (:1114, :1116), made only if each confirms as P1 at this run.
 */
const FIXES = Object.freeze({
  'HR-C11': Object.freeze({ commit: null, committedAt: null }),
  'HR-F1': Object.freeze({ commit: null, committedAt: null }),
  'HR-F2': Object.freeze({ commit: null, committedAt: null }),
  'HR-F3': Object.freeze({ commit: null, committedAt: null }),
  'HR-F4': Object.freeze({ commit: null, committedAt: null }),
  'HR-F5': Object.freeze({ commit: null, committedAt: null }),
  'HR-F6': Object.freeze({ commit: null, committedAt: null }),
  'HR-Q3': Object.freeze({ commit: null, committedAt: null }),
  'HR-Q4': Object.freeze({ commit: null, committedAt: null }),
  'HR-Q5': Object.freeze({ commit: null, committedAt: null }),
  'HR-X1': Object.freeze({ commit: null, committedAt: null }),
  'HR-K1': Object.freeze({ commit: null, committedAt: null }),
  'SAFE-ARCH-1': Object.freeze({ commit: null, committedAt: null }),
  'RFI-RESP-1': Object.freeze({ commit: null, committedAt: null }),
});
const fixed = (rule) => Boolean(FIXES[rule]?.commit);
const fixRule = (rule, statement, sources) => ({ status: fixed(rule) ? 'decided' : 'proposed', statement: `${statement}${fixed(rule) ? `; implemented in ${FIXES[rule].commit}` : '; not yet decided and implemented'}.`, sources });
const leadRule = (statement, sources) => ({ status: 'proposed', statement: `${statement}; a lead, recorded with its observation, no fix in WP-8.`, sources });
const RULES = {
  'HR-C11': fixRule('HR-C11', 'Fractional days (the recommendation :1079; undecided, WP-7\'s rule): store half-days or refuse non-integers; a promotion\'s stored row equals its answer', [`${PLAN_DOC}:878,927,1079`]),
  'HR-F1': fixRule('HR-F1', 'Submittals (the recommendation :1058; undecided): the PM\'s approval refused while a step of the current revision pends, unless a PM override with a reason', [`${PLAN_DOC}:911,936,1058`]),
  'HR-F2': fixRule('HR-F2', 'Drawings (the recommendation :1059; undecided): approve only from review; an older revision refused unless it supersedes with a reason', [`${PLAN_DOC}:915,937,1059`]),
  'HR-F3': fixRule('HR-F3', 'Punch (the recommendation :1060; undecided): only the PM or the current approver may change the final approver of an open item', [`${PLAN_DOC}:896,932,1060`]),
  'HR-F4': fixRule('HR-F4', 'Daily log (the recommendation :1061; undecided): approve only submitted days (an empty one refused); reopen needs a reason', [`${PLAN_DOC}:883,928,1061`, WP8ADJ('Q8')]),
  'HR-F5': fixRule('HR-F5', 'Timesheets (the recommendation :1062; undecided): a cap per worker per day across sheets; the rate at submission; inactive workers refused', [`${PLAN_DOC}:889,890,930,1062`]),
  'HR-F6': fixRule('HR-F6', 'Meetings (the recommendation :1063; undecided): status only through finalize / distribute, distribute needs finalized, edits refused after distribution, action items updated in place', [`${PLAN_DOC}:918,919,938,1063`]),
  'HR-Q3': fixRule('HR-Q3', 'The quality score (the recommendation :1049; undecided, WP-9\'s main row): form ITPs counted in the score as in the gate', [`${PLAN_DOC}:92,892,1049`, WP8ADJ('Q3')]),
  'HR-Q4': fixRule('HR-Q4', 'NCR and ITP records (the recommendation :1050; undecided): delete becomes archive (excluded from every score); a legacy ITP status change needs a reason and an audit event; closed NCRs keep counting', [`${PLAN_DOC}:894,931,1050`]),
  'HR-Q5': fixRule('HR-Q5', 'Closure integrity (the recommendation :1051; undecided): severity, safety type and lost days frozen after submit; approval re-counts the evidence', [`${PLAN_DOC}:894,902,931,1051`]),
  'HR-X1': fixRule('HR-X1', 'Evidence references (decided, plan section 0.1 :51-52; its batch lands in WP-2): canonical OctaPM document references; a reference naming no stored document stops counting under the batch\'s contract (O10)', [`${PLAN_DOC}:51,52,894,931,1052`, WP8ADJ('Q13')]),
  'HR-K1': fixRule('HR-K1', 'One health service (the recommendation :1096; undecided, WP-9\'s main row): the card\'s RFI overdue basis is the workspace\'s (responseRequiredBy || dueDate, answered not overdue)', [`${PLAN_DOC}:906,935,1096`]),
  'SAFE-ARCH-1': fixRule('SAFE-ARCH-1', 'Health excludes archived incidents (the section 5 defect fix :1116; provisionally P2, made only if it confirms as P1, WP8ADJ Q4): the card reads archivedAt null as the workspace and the quality dashboard do', [`${PLAN_DOC}:900,933,1107,1116`, WP8ADJ('Q4')]),
  'RFI-RESP-1': fixRule('RFI-RESP-1', 'The RFI official response frozen after closure (the section 5 defect fix :1114; provisionally P1, settled at this run, WP8ADJ Q5): both API paths refuse a closed RFI\'s answer (409 RFI_ALREADY_CLOSED assumed)', [`${PLAN_DOC}:904,934,1107,1114`, WP8ADJ('Q5')]),
  'WP8-TRN-1': leadRule('WP8-TRN-1 (P3): a transmittal or a correspondence create naming a filed document is refused 404 FILE_NOT_FOUND', [`${REGISTER} WP8-TRN-1`, `${PLAN_DOC}:917`]),
  L213: leadRule('L213 (P3): task:update closes a task without task.close', [`${PLAN_DOC}:920,939`, WP8ADJ('Q12')]),
  L146: leadRule('L146 (P3 / P2): a transmittal hard-deleted under document_control:update with no audit (HR-A2, owner question O7)', [`${PLAN_DOC}:939`]),
  'D-VAL-1': leadRule('D-VAL-1 (P3): a malformed attachment storage key dropped silently', [`${REGISTER} D-VAL-1`, `${PLAN_DOC}:939`]),
  'L-DETAILS': leadRule('L-DETAILS: production drops error.details that seven client readers fall back from', [`${REGISTER} L-DETAILS`]),
};
const CF_RULE = {
  'CF.HRF4': 'HR-F4', 'CF.HRF5': 'HR-F5', 'CF.HRQ5': 'HR-Q5', 'CF.HRQ4': 'HR-Q4', 'CF.HRF3': 'HR-F3', 'CF.SAFEARCH': 'SAFE-ARCH-1', 'CF.RFIRESP': 'RFI-RESP-1',
  'CF.HRK1rfi': 'HR-K1', 'CF.HRF1': 'HR-F1', 'CF.HRF2': 'HR-F2', 'CF.HRF6': 'HR-F6', 'CF.TRN1': 'WP8-TRN-1', 'CF.L213': 'L213', 'CF.L146': 'L146', 'CF.DVAL1': 'D-VAL-1', 'CF.LDETAILS': 'L-DETAILS',
};
/** The defect checks of a landed fix (none at HEAD): kind 'defect', judged on the value, today fails. */
const DECIDED_RED = {
  ...(fixed('HR-C11') ? {
    'KA.DL.F8.promoteStored': { rule: 'HR-C11', defect: 'HR-C11 promoted half-days stored truncated (F8)', stored: false, today: '0 / 1 / 1' },
    'KA.DL.087.promoteStored': { rule: 'HR-C11', defect: 'HR-C11 promoted half-days stored truncated (087-FLD build rows)', stored: true, today: '0 / 1 / 1' },
  } : {}),
  ...(fixed('HR-F4') ? {
    'KA.F4.F8.approveFromOpen': { rule: 'HR-F4', defect: 'HR-F4 an open day approved', stored: false, today: '200 approved' },
    'KA.F4.F8.approveEmpty': { rule: 'HR-F4', defect: 'HR-F4 an empty day approved', stored: false, today: '200 approved' },
    'KA.F4.F8.reopenNoReason': { rule: 'HR-F4', defect: 'HR-F4 reopen without a reason', stored: false, today: '200 open' },
    'CF.HRF4': { rule: 'HR-F4', defect: 'HR-F4 daily log approval and promotion', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-F5') ? {
    'KA.F5.F8.rateTiming': { rule: 'HR-F5', defect: 'HR-F5 the rate read at approval', stored: false, today: '480.00' },
    'KA.F5.F8.inactiveWorker': { rule: 'HR-F5', defect: 'HR-F5 an inactive worker accepted', stored: false, today: '201' },
    'KA.F5.F8.capAcrossSheets': { rule: 'HR-F5', defect: 'HR-F5 25 h across sheets', stored: false, today: '201, 25 h' },
    'CF.HRF5': { rule: 'HR-F5', defect: 'HR-F5 timesheet limits', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-Q3') ? {
    'KA.Q3.087.score': { rule: 'HR-Q3', defect: 'HR-Q3 form ITPs not counted (087-FLD)', stored: false, today: '21' },
  } : {}),
  ...(fixed('HR-Q5') ? {
    'KA.Q5.F8.severityDowngrade': { rule: 'HR-Q5', defect: 'HR-Q5 severity edited after closure', stored: false, today: '200, 33' },
    'KA.Q5.F8V.evidenceWiped': { rule: 'HR-Q5', defect: 'HR-Q5 approval without evidence', stored: false, today: '200 closed' },
    'KA.Q5.F8.ltiEdit': { rule: 'HR-Q5', defect: 'HR-Q5 lost days edited after closure', stored: false, today: '200, 5' },
    'CF.HRQ5': { rule: 'HR-Q5', defect: 'HR-Q5 closure integrity', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-Q4') ? {
    'KA.Q4.F8.legacyItpStatus': { rule: 'HR-Q4', defect: 'HR-Q4 a legacy ITP status changed without a reason', stored: false, today: '200, 36' },
    'KA.Q4.F8V.hardDelete': { rule: 'HR-Q4', defect: 'HR-Q4 NCR and ITP hard delete', stored: false, today: 'rows gone' },
    'CF.HRQ4': { rule: 'HR-Q4', defect: 'HR-Q4 deletes and ITP status', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-X1') ? {
    'KA.X1.F8V.textOnly': { rule: 'HR-X1', defect: 'HR-X1 a text-only reference counted as evidence', stored: false, today: '200 submitted' },
  } : {}),
  ...(fixed('HR-F3') ? {
    'KA.F3.F8.approverBypass': { rule: 'HR-F3', defect: 'HR-F3 the final approver reassigned by a site engineer', stored: false, today: '200, 200 closed' },
    'CF.HRF3': { rule: 'HR-F3', defect: 'HR-F3 the punch final approver', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('SAFE-ARCH-1') ? {
    'KA.SAFE.F8.health': { rule: 'SAFE-ARCH-1', defect: 'SAFE-ARCH-1 health counts archived incidents (F8)', stored: false, today: '70' },
    'KA.SAFE.087.health': { rule: 'SAFE-ARCH-1', defect: 'SAFE-ARCH-1 health counts archived incidents (087-FLD)', stored: false, today: '70' },
    'KA.SAFE.052.health': { rule: 'SAFE-ARCH-1', defect: 'SAFE-ARCH-1 health counts archived incidents (052-FLD build record and card)', stored: true, today: '70' },
    'CF.SAFEARCH': { rule: 'SAFE-ARCH-1', defect: 'SAFE-ARCH-1 health and archived incidents', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('RFI-RESP-1') ? {
    'KA.RFI.F8.officialAfterClose': { rule: 'RFI-RESP-1', defect: 'RFI-RESP-1 a closed RFI\'s official answer rewritten', stored: false, today: '200, 200' },
    'CF.RFIRESP': { rule: 'RFI-RESP-1', defect: 'RFI-RESP-1 the official response after closure', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-K1') ? {
    'KA.K1.F8.rfiOverdueHealth': { rule: 'HR-K1', defect: 'HR-K1 health\'s RFI overdue basis', stored: false, today: '+0 / +1' },
    'CF.HRK1rfi': { rule: 'HR-K1', defect: 'HR-K1 RFI overdue bases', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-F1') ? {
    'KA.F1.F8.pmApproveWhilePending': { rule: 'HR-F1', defect: 'HR-F1 approval while steps pend', stored: false, today: '200, 2 steps undecided' },
    'CF.HRF1': { rule: 'HR-F1', defect: 'HR-F1 submittal steps', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-F2') ? {
    'KA.F2.F8.approveWithoutReview': { rule: 'HR-F2', defect: 'HR-F2 approval without review', stored: false, today: '200 approved' },
    'KA.F2.F8.approveOutOfOrder': { rule: 'HR-F2', defect: 'HR-F2 approval out of order', stored: false, today: '200, C superseded' },
    'CF.HRF2': { rule: 'HR-F2', defect: 'HR-F2 drawing approval', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-F6') ? {
    'KA.F6.F8.patchStatus': { rule: 'HR-F6', defect: 'HR-F6 status set by PATCH', stored: false, today: '200 distributed' },
    'KA.F6.F8.actionItemIdentity': { rule: 'HR-F6', defect: 'HR-F6 action items re-created', stored: false, today: 'a new id' },
    'KA.F6.F8.duplicateTask': { rule: 'HR-F6', defect: 'HR-F6 a duplicate task', stored: false, today: '2' },
    'CF.HRF6': { rule: 'HR-F6', defect: 'HR-F6 meetings', stored: false, today: 'CONFIRMED' },
  } : {}),
};
for (const [id, d] of Object.entries(DECIDED_RED)) {
  if (!CHECKS.some((c) => c.id === id) || RULES[d.rule]?.status !== 'decided') throw new Error(`DECIDED_RED ${id}: not a check, or ${d.rule} is not decided`);
}

/**
 * The contracts of the undecided rules and the defect fixes, filled ONLY from the adjudicated decision or fix plan
 * (WP4ADJ Q2 precedent: no contract is guessed). While a field is null, only what the book's value says is judged: a
 * refusal is "not 2xx and nothing changed".
 *   HR-F4.openApproveAnswer / emptyApproveAnswer / reopenReasonAnswer   '<status> <CODE>' of each refusal
 *   HR-F5.inactiveAnswer / capAnswer                                     '<status> <CODE>' of each refusal
 *   HR-F3.reassignAnswer                                                 '<status> <CODE>' of the PATCH refused
 *   HR-F1.pendingApproveAnswer                                           '<status> <CODE>' (the book's value: a 409)
 *   HR-F2.noReviewAnswer / outOfOrderAnswer                              '<status> <CODE>' of each refusal
 *   HR-F6.patchStatusAnswer / distributeDraftAnswer / editAfterDistributionAnswer
 *   HR-Q4.itpStatusAnswer                                                '<status> <CODE>' of the status change refused
 *   HR-Q5.severityAnswer / lostDaysAnswer / evidenceAnswer               '<status> <CODE>' of each refusal
 *   HR-X1.mode ('transition' | 'documentRequired'), answer ('<status>' or '<status> <CODE>' of the text-only closeout)
 *        and ncrStatus (the NCR's status after it): from the batch and the owner's O10
 *   RFI-RESP-1.frozenAnswer                                               '<status> <CODE>' (the book assumes 409 RFI_ALREADY_CLOSED)
 */
const CONTRACT = Object.freeze({
  'HR-F4': Object.freeze({ openApproveAnswer: null, emptyApproveAnswer: null, reopenReasonAnswer: null }),
  'HR-F5': Object.freeze({ inactiveAnswer: null, capAnswer: null }),
  'HR-F3': Object.freeze({ reassignAnswer: null }),
  'HR-F1': Object.freeze({ pendingApproveAnswer: null }),
  'HR-F2': Object.freeze({ noReviewAnswer: null, outOfOrderAnswer: null }),
  'HR-F6': Object.freeze({ patchStatusAnswer: null, distributeDraftAnswer: null, editAfterDistributionAnswer: null }),
  'HR-Q4': Object.freeze({ itpStatusAnswer: null }),
  'HR-Q5': Object.freeze({ severityAnswer: null, lostDaysAnswer: null, evidenceAnswer: null }),
  'HR-X1': Object.freeze({ mode: null, answer: null, ncrStatus: null }),
  'RFI-RESP-1': Object.freeze({ frozenAnswer: null }),
});
/** The TEST GAPS of this proof (meta.testGaps). */
const TEST_GAPS = Object.freeze([
  'CF.HRF4\'s site-staff item is read from WP-7\'s result file (WP8ADJ Q8): when the file or its KA.F4.T7.sitePromotion observation is absent, that item is a gap of the classification',
  'KA.X1.F8V.textOnly\'s value needs the HR-X1 batch\'s contract (CONTRACT[\'HR-X1\'], O10) and its book leaf WP8.quality.hrX1.storedNowhere (added by the batch\'s book patch, book choice 3): until both land, the KA reads BLOCKED at its today',
]);
/** The leads recorded with the WP-8 proof commit, not probed (WP8ADJ Q11, Q14), and the rows not re-probed. */
const LEADS = Object.freeze([
  'DL-REPLAY-1 (P3): a daily-log entry POST carrying an already-used clientRequestId answers 201 with the stored entry before assertEditable (daily-log.service.js:915-918), so a replay on an approved or party-locked day answers 201, writing nothing; the DL.F8.approved* probes send no clientRequestId',
  'SUB-LINK-1 (P2, the plan\'s): the submittal lead-time link is upserted only when days > 0 (submittal-workflow.service.js:422), so a link stays stale once the days fall to 0 (recorded by CF.HRF1)',
  'MTG-SENT-1 (P2, the plan\'s): distribution rows are always "sent" with channel email whatever is delivered (meeting.service.js:1530-1531; recorded by CF.HRF6)',
  'D-ID-3, D-ID-7, D-ID-8, D-ID-9 (register "deferred to WP-8"): not in the plan\'s WP-8 items; recorded only, they stay with the identity follow-ups (WP8ADJ Q11)',
  'L-DETAILS (register :303): the register row gains mobile app/(app)/commercial/pay-apps/[id].tsx:68-69 (WP-4) and the two WP-8 readers (WP8ADJ Q14; CF.LDETAILS)',
  'WP9.health.safetyExpected (087-HLT, today 70) is the same defect as SAFE-ARCH-1 and is WP-9\'s leaf: its ref is WP-9\'s patch\'s (open point of the WP-8 book patch)',
  'not re-probed: XDOC-1 / 1b / 1c / UPB, XDOC-ISS, XDOC-CP (the HR-X1 batch\'s; F8 sends no foreign reference, no URL, no uploadedBy, no issuedBy, no contract-profile documentIds); PROMO-TX and the weather registers (WP-7\'s); HR-Q1 / HR-P1 (WP-2\'s)',
]);
/** The anchors of the section 6.2 mutants to re-scan when the WP-2 batches and WP-7's fix land (WP8ADJ Q13). */
const RESCAN_AFTER_BATCHES = Object.freeze([
  'backend/src/services/timesheet.service.js (M-DT, M-OTF :70; QP r3 RD12)', 'backend/src/routes/health.js (M-QWh :446; RD18)', 'backend/src/services/workspace-dashboard.service.js (M-QWw :1152; RD20)',
  'backend/src/services/punch.service.js (M-PFA :562; HR-X1 r3b section 12)', 'backend/src/services/daily-log.service.js (M-MP :1456; WP-7\'s PROMO-TX fix)',
  'backend/src/services/ncr.service.js, safety.service.js, rfi-workflow.service.js, rfi.service.js, workflow-support.service.js, transmittal.service.js (fix-mutation loci)',
]);

/** The setup checks. */
const SETUP_IDS = new Set(CHECKS.filter((c) => c.id.startsWith('S.')).map((c) => c.id));
/** The live catchers of the section 6.2 WP-8 guards (WP8.mutations.*; WP8ADJ Q6): E6, 8 mutants for 7 guards. */
const CATCHERS = {
  'M-QW': ['Q.F8.dashboard21'],
  'M-CLAMP': ['Q.F8V.sixMajor'],
  'M-MP': ['DL.F8.manpower'],
  'M-DT': ['TS.F8.mixed'],
  'M-PFA': ['P.F8.closeByNonApprover'],
  'M-LAT': ['D.F8.storeman'],
  'M-RD': ['SUB.F8.submitBy'],
  'M-ARCH': ['SF.F8.dashboard'],
};
/** The optional mutants (WP8.mutations.optionalMutants; WP8ADJ Q7): run, never tallied, recorded with the proof. */
const OPTIONAL_CATCHERS = {
  'M-QWh': ['Q.F8.health21'],
  'M-QWw': ['Q.F8.workspace21'],
  'M-OTF': ['TS.pure.multiplierHalf'],
};
/** Other checks a mutant turns red (named so a mutation result is read correctly; wp8-mutations-draft.json collateral). */
const COLLATERAL = {
  'M-QW': ['Q.F8.closeMajor (15)', 'KA.Q5.F8.severityDowngrade and KA.Q4.F8.legacyItpStatus wrong (25 / 30)', 'reads only: KA.Q3.087.score (the dashboard part 15: wrong) and Q.052.score (15)', 'Q.F8V.sixMajor and Q.087.variant stay 0 (clamped)'],
  'M-CLAMP': ['a read only: Q.087.variant reads -20', 'KA.Q4.F8V.hardDelete reads rows, not the score'],
  'M-MP': ['a read only: DL.087.manpower reads 86 / 10', 'DL.087.a130 unchanged (the rejected labourer is on A160)'],
  'M-DT': ['none: 087-FLD\'s and 052-FLD\'s sheets were priced at their build approvals; the HR-F5 probes use regular hours only'],
  'M-PFA': ['none: P-1 sends the quality engineer\'s close only while the item is still ready_for_review; P.F8.mix is unchanged; KA.F3.F8.approverBypass reads today either way at HEAD'],
  'M-LAT': ['a read only: D.087.storeman reads ["B", "X1"]'],
  'M-RD': ['none: SUB.087.submitBy reads the dates stored at the build; SUB.F8.impactDays does not read submitBy'],
  'M-ARCH': ['a read only: SF.087.workspaceDashboard (the dashboard part) reads 3 / 2', 'no F8 NCR or legacy ITP is archived or void, so the Q.* figures are unchanged'],
  'M-QWh': ['a read only: KA.Q3.087.score (the health part 15: wrong)'],
  'M-QWw': ['a read only: KA.Q3.087.score (the workspace part 15: wrong)'],
  'M-OTF': ['none (no built worker is below 1)'],
};
/**
 * The fix mutations (WP8.mutations.fixMutations; wp8-mutations-draft.json fixMutations and WP-7's M-C11d): each puts a
 * landed fix back, so each is run only once its fix is in (FIXES set); their catchers are the fix's known answers,
 * judged on the value from then on.
 */
const FIX_CATCHERS = {
  'M-RFIRESP': ['KA.RFI.F8.officialAfterClose'],
  'M-SAFEARCH': ['KA.SAFE.F8.health', 'KA.SAFE.087.health', 'KA.SAFE.052.health'],
  'M-F4a': ['KA.F4.F8.approveFromOpen', 'KA.F4.F8.approveEmpty'],
  'M-F4r': ['KA.F4.F8.reopenNoReason'],
  'M-F5': ['KA.F5.F8.inactiveWorker', 'KA.F5.F8.capAcrossSheets', 'KA.F5.F8.rateTiming'],
  'M-F3': ['KA.F3.F8.approverBypass'],
  'M-F1': ['KA.F1.F8.pmApproveWhilePending'],
  'M-F2': ['KA.F2.F8.approveWithoutReview', 'KA.F2.F8.approveOutOfOrder'],
  'M-F6': ['KA.F6.F8.patchStatus', 'KA.F6.F8.actionItemIdentity', 'KA.F6.F8.duplicateTask'],
  'M-Q5': ['KA.Q5.F8.severityDowngrade', 'KA.Q5.F8V.evidenceWiped', 'KA.Q5.F8.ltiEdit'],
  'M-Q4': ['KA.Q4.F8V.hardDelete', 'KA.Q4.F8.legacyItpStatus'],
  'M-Q3': ['KA.Q3.087.score'],
  'M-K1': ['KA.K1.F8.rfiOverdueHealth'],
  'M-C11d': ['KA.DL.F8.promoteStored'],
};
for (const id of new Set([...Object.values(CATCHERS), ...Object.values(FIX_CATCHERS), ...Object.values(OPTIONAL_CATCHERS)].flat())) if (!CHECKS.some((c) => c.id === id)) throw new Error(`CATCHERS / FIX_CATCHERS / OPTIONAL_CATCHERS name ${id}, not a check`);
// The catchers are the book's (WP8.mutations.*: each names its catchers by check id, G13).
{
  const bookText = Object.values(WP8.mutations).map((leaf) => `${leaf.note || ''} ${Array.isArray(leaf.value) ? leaf.value.join(' ') : ''}`).join(' ');
  const all = { ...CATCHERS, ...OPTIONAL_CATCHERS, ...FIX_CATCHERS };
  const missing = [...new Set(Object.values(all).flat())].filter((id) => !bookText.includes(`${id} red`));
  if (missing.length) throw new Error(`WP8.mutations names no catcher ${missing.join(', ')}: the catchers and the book disagree (G13)`);
  for (const name of Object.keys(all)) if (!bookText.includes(`(${name},`) && !bookText.includes(`(${name}:`)) throw new Error(`WP8.mutations names no mutant ${name} (G13)`);
}

const planEntries = ACTIVE.map((c) => [
  c.id,
  c.description,
  SETUP_IDS.has(c.id) ? { setup: true } : DECIDED_RED[c.id] ? { defect: DECIDED_RED[c.id].defect, rule: DECIDED_RED[c.id].rule } : c.id.startsWith('CF.') ? { rule: CF_RULE[c.id] } : {},
]);

/** The moment-map deviation, by key (WP8ADJ Q1), recorded in meta.deviations and in MOMENT-MAP.md when the proof lands. */
const DEVIATIONS = Object.freeze([
  'Every WP-8 writing check and every section 6.2 catcher runs on F8, the WP-8 proof\'s own throwaway in 087 (archived at the end); the 6-major clamp catcher and the probes that would move F8\'s 21 (HR-Q5 evidence wiped, HR-X1 text-only, HR-Q4 hard deletes) run on a second throwaway, F8V (WP8ADJ Q1).',
  'The close of 087-FLD\'s open major NCR ("closed by the WP-8 proof", 087-fld.js:1384) moves to F8 (Q.F8.closeMajor); no WP-8 write reaches 087-FLD or 052-FLD, and the one request sent to 087-FLD is the party user\'s entry on the submitted D5, refused 409 before any write (WP8ADJ Q2; S.087FLD.unchanged).',
  'Rows 171, 172, 174, 175, 184 and 186 stand as stored moments plus live reads (TS.stored.half, TS.087.reopen, DL.stored.promoteEcho, R.087.overdueApi, TS.087.rejectEditApprove).',
  'Row 176 stands as KA.DL.087.promoteStored (BLOCKED HR-C11; STORED-PRE-FIX after its fix, judged on the value strictly at the exit rebuild).',
  'Row 173 is TS.pure.multiplierHalf (in process); row 185 is R.087.overdueStored (read-only SQL); row 182 is read into CF.HRF4 (approve from open, BLOCKED HR-F4 as KA.F4.F8.approveFromOpen on F8).',
  'Rows 246, 250 and 262 stand (DL.stored.promoteEcho, Q.052.score, TS.052.labour) with live 052 reads (WP8ADJ Q9); row 251 is re-judged under SAFE-ARCH-1 (KA.SAFE.052.health; the build\'s BLOCKED HR-K1 is the same known answer, 70; WP8ADJ Q4).',
  'Rows 177 and 263 stay WP-7\'s (the site engineer\'s promotion on T7), classified by WP-8\'s CF.HRF4 from WP-7\'s result file (WP8ADJ Q8).',
]);

const h = harness.createHarness({
  name: 'wp8-field-proof',
  plan: planEntries,
  rules: RULES,
  mailPrefix: 'wp8',
  meta: {
    plan: `${PLAN_DOC} section 4 WP-8 (:872-939), section 6.2 WP-8 guards (:1152), section 5 HR-Q3..Q5 :1049-1051, HR-X1 :1052, HR-F1..F6 :1058-1063, HR-C11 :1079, HR-K1 :1096, fix list :1114, :1116; plan lines as numbered at 14a3db2`,
    prep: 'C:/Temp/octapm-cert/scratch/wp8/WP8-PREP.md',
    adjudication: `${WP8ADJ('Q1-Q14')} and the standing rulings it lists`,
    momentMap: 'backend/scripts/cert/cert3/build/MOMENT-MAP.md (the WP-8 deviation to record when the proof lands: meta.deviations)',
    answerBook: `backend/scripts/cert/cert3/answers/field-controls.js @${FIELD.meta.head} + the WP-8 book patch (G1-G23) and answers/commercial.js @${COMMERCIAL.meta.head}`,
    expectedChecks: EXPECTED_CHECKS,
    activeChecks: ACTIVE.length,
    filter: { only: ONLY ? [...ONLY] : null, skip: SKIP ? [...SKIP] : null, project: PROJECT_FILTER, sections: [...selectedSections], deepProjects: NEED_DEEP, live: NEED_LIVE, companies: [...NEED_COMPANIES], throwaway: { F8: NEED_F8, F8V: NEED_F8V } },
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
    decidedRed: DECIDED_RED,
    fixes: FIXES,
    contract: Object.fromEntries(Object.entries(CONTRACT).map(([rule, fields]) => [rule, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? `pending the ${rule} decision or fix plan` : v]))])),
    fixture: FIXTURE,
    catchers: CATCHERS,
    optionalCatchers: OPTIONAL_CATCHERS,
    fixCatchers: FIX_CATCHERS,
    collateral: COLLATERAL,
    deviations: DEVIATIONS,
    leads: LEADS,
    rescanAfterBatches: RESCAN_AFTER_BATCHES,
    notRunMutants: WP8.mutations.notRun.value,
    testGaps: TEST_GAPS,
    checks: CHECKS.map(({ id, section, planRef, bookKey, where }) => ({ id, section, planRef, bookKey, where })),
  },
});

// -- per-check records, known answers and confirm-first classifications -----------------------------------------------
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
 * A known answer's status: PASS (the value), BLOCKED (the today of an undecided rule), STORED-PRE-FIX (the today of a
 * decided rule seen on a build record made before that rule's fix commit), else FAIL. Never STORED-PRE-FIX while the fix
 * commit is not set.
 */
const kaStatus = ({ ref, verdict, storedAt = null }, fixes = FIXES, rules = RULES) => {
  const decided = rules[ref]?.status === 'decided';
  if (verdict === 'value') return 'PASS';
  if (verdict === 'today' && !decided) return 'BLOCKED';
  const fix = fixes[ref] || {};
  const predates = storedAt !== null && Boolean(fix.committedAt) && Number.isFinite(Date.parse(storedAt)) && Date.parse(storedAt) < Date.parse(fix.committedAt);
  if (verdict === 'today' && predates) return 'STORED-PRE-FIX';
  return 'FAIL';
};
/**
 * A known answer: `verdict` is 'value' (the book's expected figure holds), 'today' (HEAD's recorded answer under an
 * undecided rule: BLOCKED / known, never exit 2) or 'wrong' (neither: an unexplained departure, a failure). Under a
 * decided rule (a landed fix) a today fails, except a build record (`storedAt`) older than the fix commit.
 */
const ka = (id, { ref, value, today, observed, verdict, storedAt = null, detail = '' }) => {
  const c = BY_ID.get(id);
  const decided = RULES[ref]?.status === 'decided';
  const status = kaStatus({ ref, verdict, storedAt });
  const blocked = status === 'BLOCKED';
  const preFix = status === 'STORED-PRE-FIX';
  knownAnswers[id] = { ref, bookKey: c.bookKey, value, today, observed, verdict, ruleDecided: decided, storedAt, status, ...(preFix ? { register: `${REGISTER} ${ref}`, fix: FIXES[ref] } : {}) };
  const ok = verdict === 'value' || blocked || preFix;
  const text = `${blocked ? `BLOCKED (known answer, ${ref})` : preFix ? `STORED-PRE-FIX (built ${storedAt}, before the ${ref} fix ${FIXES[ref].commit} of ${FIXES[ref].committedAt}): HEAD's pre-fix answer, reported with the register link ${ref}, not a WP-8 failure` : verdict === 'today' ? `FAIL: HEAD still gives the known answer of ${ref}, which is decided${storedAt !== null ? (FIXES[ref]?.commit ? ` (stored ${storedAt}, not before the fix commit)` : ` (no ${ref} fix commit yet)`) : ''}` : verdict === 'value' ? 'value' : `WRONG: neither the book's value nor HEAD's known answer (${ref})`}; ${detail}`;
  rec(id, ok, { expected: { value, today }, observed, detail: text });
  records[id].verdict = status;
  return verdict;
};
/** value / today / wrong from a predicate over the observation. */
const judge = (observed, isValue, isToday) => (isValue(observed) ? 'value' : isToday(observed) ? 'today' : 'wrong');
/** A KA over a leaf whose value and today are compared whole (sameJson): the commonest shape. */
const kaLeaf = (id, leaf, observed, { storedAt = null, detail = '' } = {}) => ka(id, { ref: leaf.ref, value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (x) => sameJson(x, leaf.value), (x) => sameJson(x, leaf.today)), storedAt, detail });
/** Several readings judged together: value only if every one is the value, today only if every one is today. */
const allVerdict = (verdicts) => (verdicts.length && verdicts.every((v) => v === 'value') ? 'value' : verdicts.length && verdicts.every((v) => v === 'today') ? 'today' : 'wrong');
/**
 * A refusal value of the book ({ refused: true, code: null, ...state }): not 2xx, the contract's answer when the decision
 * named one, and the record's state as the leaf states it. `observed` carries said and the state fields.
 */
/** An answer that refuses for another reason than the rule (a guard, a lost session, a missing record, a 5xx): never the rule's refusal. */
const NOT_THE_RULE = /^(401|403 (FORBIDDEN|PROJECT_ACCESS_DENIED)|404 [A-Z_]*NOT_FOUND|5\d\d)/;
const isRefusal = (observed, leafValue, answer = null) => {
  const { refused, code, status, ...state } = leafValue;
  const sp = saidParts(observed.said);
  if (is2xx(sp.status)) return false;
  if (!answer && NOT_THE_RULE.test(String(observed.said))) return false;
  if (status !== undefined && status !== null && sp.status !== status) return false;
  if (answer && observed.said !== answer) return false;
  return sameJson(pick(observed, state), state);
};
/**
 * R-SET: a known-answer probe in its own section. When what the probe needs cannot be set up, the probe throws: the
 * harness records a section error (a setup error, exit 1) and the check is left unrecorded ('not run'), never 'wrong'.
 */
const probe = (title, fn) => h.section(`probe: ${title}`, fn);
const probeSetup = (id, why) => new Error(`${id}: the probe's own setup failed (a setup error, not a verdict; R-SET): ${why}`);
/** A step a throwaway choreography cannot go on without: a setup error, not a verdict (as WP-1's W ... WP-7's T7). */
const need = (condition, what) => {
  if (condition !== true) throw new Error(`${what}: the choreography cannot go on (a setup error, not a verdict)`);
};
/** A confirm-first item classified from this run's observations (plan section 0.0: CONFIRMED / PARTIAL / REJECTED / TEST GAP). */
const classifyItems = ({ present, absent, gap = [] }) => {
  const total = present.length + absent.length + gap.length;
  return total === 0 || gap.length === total ? 'TEST GAP' : present.length === 0 ? 'REJECTED' : absent.length === 0 && gap.length === 0 ? 'CONFIRMED' : 'PARTIAL';
};
/**
 * `observations` are what the plan asks to be confirmed where the rule's own recommendation equals HEAD (HR-Q4 keeps
 * closed NCRs counting; no rule names a transmittal acknowledged through PATCH; the stale lead-time link and the "sent"
 * rows are the plan's P2 leads): reported beside the classification, never classified (WP8-PREP fact 11).
 */
const cf = (id, { present, absent, gap = [], observations = [], detail = '' }) => {
  const classification = classifyItems({ present, absent, gap });
  const rule = RULES[CF_RULE[id]];
  confirmFirst[id] = { classification, rule: CF_RULE[id], ruleStatus: rule.status, present, absent, gap, observations, note: rule.status === 'decided' ? 'a landed fix: CONFIRMED is a failure (RED until the fix holds)' : 'an undecided rule, a lead or an unlanded fix: CONFIRMED is reported, not failed; EXPECTED BEHAVIOUR is the owner\'s call' };
  const ok = rule.status === 'decided' ? classification === 'REJECTED' : classification !== 'TEST GAP';
  rec(id, ok, { expected: rule.status === 'decided' ? 'REJECTED (fixed)' : 'CONFIRMED or REJECTED (reported)', observed: { classification, present, absent, gap }, detail: `${classification}; ${detail}` });
  return classification;
};

// -- sessions and requests --------------------------------------------------------------------------------------------
const ctx = { db: null, q: null, orgs: {}, people: {}, sessions: {}, specs: {}, R: null, zone: null, f8: null, f8v: null, state: {}, deep: {}, cleanup: [], deepWrites: [], jobsCancelled: [], fingerprints: {} };
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
/** A multipart upload as a persona (`field` the form field the route reads; `fields` the other form fields). */
const upload = (who, route, file, fields = {}, field = 'file') => send(who, 'POST', route, undefined, { form: api.multipart({ field, filename: file.filename, contentType: file.contentType, body: file.body, fields }) });
/** A minimal one-page PDF (evidence and revisions; WP-4's K, WP-6's B6 and WP-7's T7 precedent). */
const pdf = (text, filename) => {
  const safe = String(text).replace(/[()\\]/g, ' ');
  const stream = `BT /F1 11 Tf 40 760 Td (${safe}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { filename, body: Buffer.from(out, 'latin1'), contentType: 'application/pdf' };
};
/** A stamped name or description of this run. */
const label = (what) => `CERT3 WP8 ${what} ${h.STAMP}`;
const fileName = (what) => `CERT3-WP8-${String(what).replace(/[^A-Za-z0-9]+/g, '-')}-${h.STAMP}.pdf`;
/** The site engineer's own fresh upload on a throwaway, as the closeout dialogs send it (WP8.F8.evidence). */
const evidence = async (t, tag, who = 'site') => {
  const name = fileName(`evidence ${tag}`);
  const res = await upload(who, `${t.P}/workflow/uploads`, pdf(`${tag} ${h.STAMP}`, name), {}, 'files');
  const row = listOf(res.body?.data, 'files', 'uploads').find((r) => r?.documentId && r?.fileName === name) || listOf(res.body?.data, 'files', 'uploads').find((r) => r?.documentId) || null;
  need(res.status === 201 && Boolean(row?.documentId), `the ${tag} evidence could not be uploaded on ${t.label} (${h.said(res)} ${res.body?.error?.message || ''})`);
  return { documentId: row.documentId, fileName: row.fileName || name, storageKey: row.documentId };
};
/** The run date R and a day of the book ('R-6', 'R+5') as YYYY-MM-DD. */
const ymdIn = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const runDay = (offsetLabel) => addDaysIso(ctx.R, offsetOf(offsetLabel));

// -- the throwaways: create, archive, jobs ------------------------------------------------------------------------------
const archivedAtOf = async (id) => (await ctx.q('select "archivedAt"::text as a from "Project" where id = $1', [id]))[0]?.a || null;
/** Archives a throwaway once (its end step or cleanup), as its PM (087's): the answer and archivedAt read back. */
const archive = async (t) => {
  if (!t || t.archived) return t?.archived || null;
  const res = await send(t.pm, 'DELETE', `/projects/${t.id}`);
  const at = await archivedAtOf(t.id);
  t.archived = { said: h.said(res), status: res.status, archivedAt: at, label: t.label };
  return t.archived;
};
/** The book's project payload with its day offsets turned into dates and its stamp filled in. */
const projectPayload = (project) => Object.fromEntries(Object.entries(project).map(([k, v]) => [k, k === 'name' ? String(v).replace('<stamp>', h.STAMP) : /^R([+-]\d+)?$/.test(String(v)) ? runDay(v) : v]));
/**
 * A throwaway made by `pm` with the book's payload and team (the book's { roles: { projectRole: persona }, noProjectRole:
 * [persona] }: a member with no project role is added with { userId } alone, as build/lib.js:1222 does, RJ-12): { id, P,
 * ... }. Its archive is pushed to cleanup at once, so a failure later still archives it.
 */
const makeThrowaway = async ({ pm, label: tag, project, team }) => {
  const payload = projectPayload(project);
  const created = await send(pm, 'POST', '/projects', payload);
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (!id) throw new Error(`${tag} could not be created: ${h.said(created)} ${created.body?.error?.message || ''}`);
  const t = { id, P: `/projects/${id}`, name: payload.name, label: tag, pm, created, payload, members: [], acts: {}, archived: null };
  ctx.cleanup.push(async () => { const a = await archive(t); return `${tag} ${id} archive ${a?.said ?? 'not sent'}, archivedAt ${a?.archivedAt || 'NOT SET'}`; });
  for (const [role, persona] of Object.entries(team.roles || {})) {
    const res = await send(pm, 'POST', `${t.P}/team`, { userId: ctx.people[persona], role });
    t.members.push({ persona, role, said: h.said(res), status: res.status });
  }
  for (const persona of team.noProjectRole || []) {
    const res = await send(pm, 'POST', `${t.P}/team`, { userId: ctx.people[persona] });
    t.members.push({ persona, role: null, said: h.said(res), status: res.status });
  }
  t.shown = await dataOf(pm, t.P);
  return t;
};
/** Whether a throwaway was made with its whole team (each member answered 200 or 201). */
const teamOk = (t, team) => t.members.length === Object.keys(team.roles || {}).length + (team.noProjectRole || []).length && t.members.every((m) => [200, 201].includes(m.status));
/** The throwaway's queued jobs (GET /projects/:id/jobs?status=queued, as its PM). */
const queuedJobs = async (t) => listOf(await dataOf(t.pm, `${t.P}/jobs?status=queued&limit=100`), 'items');
/** Cancels every queued job of a throwaway through the product route; returns { cancelled, refused, left }. */
const cancelQueued = async (t) => {
  const cancelled = [];
  const refused = [];
  for (const job of await queuedJobs(t)) {
    const res = await send(t.pm, 'POST', `${t.P}/jobs/${job.id}/cancel`, {});
    (res.status === 200 && res.body?.data?.status === 'cancelled' ? cancelled : refused).push({ id: job.id, type: job.type, said: h.said(res) });
  }
  ctx.jobsCancelled.push({ project: t.label, cancelled: cancelled.length, refused });
  const left = (await queuedJobs(t)).length;
  return { cancelled, refused, left };
};

// -- reads ----------------------------------------------------------------------------------------------------------------
/** GET /projects/:id/health as `who`: the dimension of `key` ({ score, detail }) or null. */
const healthDim = async (P, key, who = 'pm') => {
  const card = await dataOf(who, `${P}/health`);
  const dims = listOf(card?.dimensions).filter((d) => d.key === key);
  return dims.length === 1 ? { score: dims[0].score ?? null, detail: dims[0].detail || {} } : null;
};
/** GET /quality/dashboard as `who`: its metrics. */
const dashboardOf = async (P, who = 'pm') => (await dataOf(who, `${P}/quality/dashboard`))?.metrics || {};
/**
 * A project's row of GET /projects/workspace-dashboard: the dashboard answers only the six projects most at risk unless
 * the caller sees fewer (workspace-dashboard.service.js:1734-1741, :2094), so the row is asked of the PM, then of the
 * project's site engineer and quality engineer (who see only the projects they are on); { row, persona } or null (a
 * read the probe cannot make: R-SET for the check that needs it, never a verdict).
 */
const workspaceRow = async (projectId) => {
  const tried = [];
  for (const who of FIXTURE.pollWorkspacePersonas) {
    if (!ctx.sessions[who]) continue;
    const data = await dataOf(who, '/projects/workspace-dashboard');
    const rows = listOf(data?.projectHealth);
    tried.push({ who, rows: rows.length });
    const row = rows.find((r) => r.id === projectId);
    if (row) return { row, persona: who, tried };
  }
  obs.workspaceMisses = [...(obs.workspaceMisses || []), { projectId, tried }];
  return null;
};
/** GET /daily-logs/:date as `who`. */
const dayLog = (t, day, who = 'pm') => dataOf(who, `${t.P}/daily-logs/${day}`);
/** An entry of a day by id, in its section. */
const entryIn = (log, section, id) => listOf(log?.sections?.[section]).find((row) => row.id === id) || null;
/** The weather register as the planner reads it. */
const registerOf = async (P, who = 'planner') => dataOf(who, `${P}/weather-delays`);
/** A workflow activity link (read-only SQL): the days a record carries on an activity for a relation type. */
const linkOf = async (recordType, recordId, relationType) => (await ctx.q('select "activityId", "relationType", "scheduleImpactDays" as days from "WorkflowActivityLink" where "recordType" = $1 and "recordId" = $2 and "relationType" = $3', [recordType, recordId, relationType]));
/** An RFI's stored due dates (read-only SQL; the API presents dueDate || responseRequiredBy). */
const rfiStored = async (id) => (await ctx.q('select to_char("dueDate", \'YYYY-MM-DD\') as "dueDate", to_char("responseRequiredBy", \'YYYY-MM-DD\') as "responseRequiredBy" from "Rfi" where id = $1', [id]))[0] || null;
/** The audit rows of one entity (read-only SQL). */
const auditCount = async (entityId) => (await ctx.q('select count(*)::int as n from "AuditEvent" where "entityId" = $1', [entityId]))[0]?.n ?? null;
/** A project's tasks of one title (read-only SQL). */
const tasksTitled = async (projectId, title) => (await ctx.q('select count(*)::int as n from "Task" where "projectId" = $1 and title = $2', [projectId, title]))[0]?.n ?? null;
/**
 * 087-FLD's fingerprint (read-only SQL; WP8ADJ Q2, the WP7ADJ Q3 pattern): day D5 (status, updatedAt, its entries in
 * every section), and the counts and latest ids of its NCRs, punch items, safety incidents, RFIs, document revisions,
 * timesheets, weather delays and audit events.
 */
const fingerprint087 = async (projectId, d5) => (await ctx.q(`select
    (select status from "DailyLog" where "projectId" = $1 and date = $2::date) as "d5Status",
    (select to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') from "DailyLog" where "projectId" = $1 and date = $2::date) as "d5UpdatedAt",
    (select (select count(*) from "DailyLogNote" n where n."dailyLogId" = l.id) + (select count(*) from "DailyLogManpower" m where m."dailyLogId" = l.id)
       + (select count(*) from "DailyLogDelivery" d where d."dailyLogId" = l.id) + (select count(*) from "DailyLogVisitor" v where v."dailyLogId" = l.id)
       + (select count(*) from "DailyLogQuantity" q where q."dailyLogId" = l.id) from "DailyLog" l where l."projectId" = $1 and l.date = $2::date)::int as "d5Entries",
    (select count(*)::int from "NcrRecord" where "projectId" = $1) as ncrs,
    (select count(*)::int from "PunchItem" where "projectId" = $1) as punch,
    (select count(*)::int from "SafetyIncident" where "projectId" = $1) as safety,
    (select count(*)::int from "Rfi" where "projectId" = $1) as rfis,
    (select count(*)::int from "DocumentRevision" where "projectId" = $1) as revisions,
    (select count(*)::int from "Timesheet" where "projectId" = $1) as timesheets,
    (select count(*)::int from "WeatherDelay" where "projectId" = $1) as "weatherDelays",
    (select count(*)::int from "AuditEvent" where "projectId" = $1) as "auditEvents",
    (select id from "AuditEvent" where "projectId" = $1 order by "occurredAt" desc, id desc limit 1) as "latestAuditEvent"`, [projectId, d5]))[0] || null;

// -- static scans of backend/src and the clients (read only; tests, live suites and mocks excluded) --------------------
const srcText = (rel) => { try { return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const stripComments = (text) => String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** The client source files under `roots` (relative to the repository): .ts, .tsx, .js; tests and node_modules excluded. */
const clientFiles = (roots) => {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__tests__', '__mocks__', '.expo', 'dist', 'build'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js)$/.test(ent.name) && !/\.(test|spec)\.(ts|tsx|js)$/.test(ent.name)) out.push(full);
    }
  };
  try { for (const root of roots) walk(path.join(REPO, root)); } catch { return null; }
  return out;
};
/** A client reading an error's details (L-DETAILS): error.details, err.details, .error?.details, details.details, firstDetail(details). */
const DETAILS_READER = /\b(?:error|err)\s*\??\.\s*details\b|\.error\s*\??\.\s*details\b|\bdetails\s*\??\.\s*details\b|\bfirstDetail\s*\(\s*details\s*\)/;
/** The seven readers of WP8.leads.LDETAILS (each file's name appears in the leaf's readers). */
const LDETAILS_READERS = Object.freeze([
  'frontend/src/features/inspections/hooks/use-forms.ts', 'frontend/src/features/schedule/components/bulk-progress-update.tsx',
  'mobile/app/(app)/quality/inspections/[id].tsx', 'mobile/app/(app)/commercial/pay-apps/[id].tsx', 'mobile/src/api/inventory-hooks.ts',
  'mobile/src/offline/senders.ts', 'mobile/src/api/errors.ts',
]);
{
  const readers = WP8.leads.LDETAILS.value.readers;
  const text = readers.join(' ');
  if (readers.length !== LDETAILS_READERS.length || LDETAILS_READERS.some((f) => !text.includes(path.posix.basename(f)))) throw new Error('FIXTURE against the WP-8 book: LDETAILS_READERS is not WP8.leads.LDETAILS.value.readers');
}
/** The confirm-first items read from the source: null where a file is not found (a gap, never a guess). */
const staticScan = () => {
  const health = srcText('routes/health.js');
  const workspace = srcText('services/workspace-dashboard.service.js');
  const quality = srcText('services/quality.service.js');
  const rfiWf = srcText('services/rfi-workflow.service.js');
  const submittalWf = srcText('services/submittal-workflow.service.js');
  const transmittalRoutes = srcText('routes/transmittals.js');
  const dailyLogRoutes = srcText('routes/daily-logs.js');
  const itpService = srcText('services/itp.service.js');
  const ncrService = srcText('services/ncr.service.js');
  const errorHandler = srcText('middleware/error-handler.js');
  const apiResponse = srcText('utils/api-response.js');
  const updateResponseBody = rfiWf === null ? null : (rfiWf.split('const updateResponse = async')[1] || '').split('const deleteResponse = async')[0];
  const files = clientFiles(['frontend/src', 'mobile/app', 'mobile/src']);
  const rel = (f) => path.relative(REPO, f).replace(/\\/g, '/');
  const readers = files ? files.filter((f) => DETAILS_READER.test(stripComments(fs.readFileSync(f, 'utf8')))).map(rel).sort() : null;
  const webFiles = files ? files.filter((f) => rel(f).startsWith('frontend/')) : null;
  const callersOfUpdateRfiResponse = webFiles ? webFiles.filter((f) => /useUpdateRfiResponse\b/.test(stripComments(fs.readFileSync(f, 'utf8')))).map(rel) : null;
  return {
    // SAFE-ARCH-1: the card reads every incident and counts status != closed as open; the workspace and the dashboard exclude archived
    healthReadsEveryIncident: health === null ? null : /prisma\.safetyIncident\.findMany\(\{\n\s*where: \{ projectId: req\.params\.projectId \},\n\s*\}\)/.test(health),
    healthOpenIsNotClosed: health === null ? null : /const openInvestigations = incidents\.filter\(\s*\(row\) => row\.status !== "closed",?\s*\)\.length;/.test(health),
    workspaceExcludesArchived: workspace === null ? null : /where: \{ projectId: inModule\("safety"\), archivedAt: null \}/.test(workspace),
    dashboardExcludesArchived: quality === null ? null : /const live = \(rows\) => rows\.filter\(\(row\) => row\.status !== 'archived' && row\.status !== 'void'\);/.test(quality),
    // RFI-RESP-1: updateResponse checks no status and writes the RFI's answer for the official response; the audit keeps no text
    updateResponseNoStatusCheck: updateResponseBody === null ? null : !/closed|archived/.test(updateResponseBody),
    updateResponseWritesAnswer: updateResponseBody === null ? null : /if \(existing\.isOfficial\) await tx\.rfi\.update\(\{ where: \{ id: rfiId \}, data: \{ response: body\.slice\(0, 20000\) \} \}\);/.test(updateResponseBody),
    updateResponseAuditKeepsNoText: updateResponseBody === null ? null : /response: "edited"/.test(updateResponseBody) && !/previous|oldBody|before:/.test(updateResponseBody),
    webCallersOfUpdateRfiResponse: callersOfUpdateRfiResponse,
    // HR-K1: the card counts by dueDate only; the workspace by responseRequiredBy || dueDate
    healthOverdueByDueDateOnly: health === null ? null : /const overdueRfis = rfis\.filter\(\(row\) => \{\n\s*if \(!row\.dueDate\) return false;/.test(health),
    workspaceOverdueBasis: workspace === null ? null : /const dueDate = row\.responseRequiredBy \|\| row\.dueDate;/.test(workspace),
    // HR-F1 / SUB-LINK-1: the lead-time link upserted only when days > 0
    leadTimeLinkOnlyWhenLate: submittalWf === null ? null : /if \(days > 0 && submittal\.activityId && tx\.workflowActivityLink\?\.upsert\)/.test(submittalWf),
    // HR-F6: a transmittal acknowledged through PATCH (the route takes status acknowledged)
    transmittalPatchTakesAcknowledged: transmittalRoutes === null ? null : (transmittalRoutes.match(/body\("status"\)\.optional\(\)\.isIn\(\["pending_ack", "acknowledged"\]\)/g) || []).length === 2,
    // HR-F4: reopen's reason optional at the route
    reopenReasonOptional: dailyLogRoutes === null ? null : /"\/:date\/reopen",[\s\S]{0,240}?optionalText\("reason", 1000\)/.test(dailyLogRoutes),
    // HR-Q4: hard deletes
    ncrHardDelete: ncrService === null ? null : /await prisma\.ncrRecord\.delete\(\{ where: \{ id: ncrId \} \}\);/.test(ncrService),
    itpHardDelete: itpService === null ? null : /await prisma\.itpRecord\.delete\(\{ where: \{ id: itpId \} \}\);/.test(itpService),
    // L-DETAILS: production drops error.details; the client readers
    productionDropsDetails: errorHandler === null || apiResponse === null ? null : /includeDetails: process\.env\.NODE_ENV !== "production",/.test(errorHandler) && /if \(includeDetails && details !== undefined\) \{/.test(apiResponse),
    detailsReaders: readers,
  };
};

// -- stored moments (pure over a state file and the book; exported for the registration check) -------------------------
/** The days of a promotion echo, as numbers (null stays null: an adopted promotion). */
const echoes = (list) => list.map((x) => (x === null || x === undefined ? null : Number(x)));
/** 087-FLD's WP-8 build moments and the ids the live reads need. */
const storedFld087 = (st) => {
  const out = (step) => st?.steps?.[step]?.out || null;
  const promoted = echoes(['dailylog.D1', 'dailylog.D2', 'dailylog.D3'].map((s) => out(s)?.promotedEcho));
  const book = [WP8.dailyLog.promote2h.value, WP8.dailyLog.promote6h.value, WP8.dailyLog.promote10h.value];
  const at13 = out('weather.at13.read');
  const promotedStored = at13?.stored?.promoted ? at13.stored.promoted.map(Number) : null;
  const c11 = COMMERCIAL.WP7.weather['087-FLD.promoted.days'];
  const half = out('worker.multiplier-half');
  const HC = WP8.timesheet.multiplierHalfCreate;
  const halfField = /details\.field=([A-Za-z0-9_[\]]+(?:\.[A-Za-z0-9_[\]]+)*)/.exec(HC.note || '')?.[1] || null;
  const HI = WP8.timesheet.multiplierHalfImport.value;
  const halfObserved = { createSaid: half?.create?.said ?? null, createField: half?.create?.field ?? null, import: half?.import ? { created: half.import.created, updated: half.import.updated, skipped: half.import.skipped, errors: half.import.errors } : null };
  const halfExpected = { createSaid: HC.value, createField: halfField, import: { created: HI.created, updated: HI.updated, skipped: HI.skipped, errors: HI.errors } };
  const t2000 = out('timesheet.2000');
  const d = (k) => out(`dailylog.${k}`);
  const ids = {
    projectId: st?.projectId ?? null,
    days: Object.fromEntries(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'].map((k) => [k, d(k)?.day ?? null])),
    d1Status: d('D1')?.status ?? null,
    activities: Object.fromEntries(['A100', 'A120', 'A130', 'A160', 'A180'].map((k) => [k, out('activities')?.[k]?.id ?? null])),
    party: out('invite.party') ? { userId: out('invite.party').userId, email: out('invite.party').email } : null,
    promotedWeatherDelays: ['D1', 'D2', 'D3'].map((k) => d(k)?.weatherDelayId ?? null),
    timesheets: { t2000: t2000?.timesheetId ?? null, mixed: out('timesheet.mixed')?.timesheetId ?? null, rejectedEdited: out('timesheet.rejected-edited')?.timesheetId ?? null, crewPrefill: out('timesheet.crew-prefill')?.timesheetId ?? null },
    rfi: out('rfi'),
    submittals: out('submittals') ? { direct: out('submittals').direct?.id ?? null, templated: out('submittals').templated?.id ?? null } : null,
    drawing: out('drawing.S-1') ? { drawingId: out('drawing.S-1').drawingId, revisionB: out('drawing.S-1').revisions?.B ?? null } : null,
    transmittal: out('transmittal'),
    letter: out('notice-letter'),
    meeting: out('meeting') ? { actionItem1: (out('meeting').actionItems || []).find((a) => String(a.itemNumber) === '1') || null, changeEventId: out('meeting').changeEventId ?? null } : null,
    variant: out('variant.six-major')?.projectId ?? null,
  };
  return {
    'DL.stored.promoteEcho': { ok: sameJson(promoted, book), expected: book, observed: promoted, gap: promoted.some((x) => x === null) },
    'TS.stored.half': { ok: sameJson(halfObserved, halfExpected) && st?.steps?.['worker.multiplier-half']?.status === 'done', expected: halfExpected, observed: halfObserved },
    'TS.087.reopen.stored': { ok: t2000?.reopenNetCents === WP8.timesheet.reopenNet.value && t2000?.reapprovedCents === WP8.timesheet.reapprovedNet.value, expected: { reopenNetCents: WP8.timesheet.reopenNet.value, reapprovedCents: WP8.timesheet.reapprovedNet.value }, observed: { reopenNetCents: t2000?.reopenNetCents ?? null, reapprovedCents: t2000?.reapprovedCents ?? null } },
    promoteStored: { observed: promotedStored, verdict: judge(promotedStored, (x) => sameJson(x, c11.value), (x) => sameJson(x, c11.today)), storedAt: stepAt(st, 'weather.at13.read') },
    d1ApprovedFromOpen: { step: st?.steps?.['dailylog.D1']?.status ?? 'not run', status: ids.d1Status, storedAt: stepAt(st, 'dailylog.D1') },
    ids,
  };
};
/** 052-FLD's WP-8 build moments (rows 246, 250, 251, 262) and the ids the live reads need. */
const storedFld052 = (st) => {
  const out = (step) => st?.steps?.[step]?.out || null;
  const echo = echoes(['dailylog.D1', 'dailylog.D2', 'dailylog.D3'].map((s) => out(s)?.delayDaysEcho));
  const book = [WP8.dailyLog.promote2h.value, WP8.dailyLog.promote6h.value, WP8.dailyLog.promote10h.value];
  const qsOut = out('quality.score');
  const Q = F8B.qualityMix;
  const qExpected = { qualityScore: WP8['052-FLD'].qualityScore.value, majorNcrs: Q.ncrs.filter((n) => n[1] === 'major').length, minorNcrs: Q.ncrs.filter((n) => n[1] === 'minor').length, failedItps: Q.legacyItps.filter((s) => s === 'failed').length };
  const qObserved = qsOut ? { qualityScore: qsOut.qualityScore ?? null, majorNcrs: qsOut.majorNcrs ?? null, minorNcrs: qsOut.minorNcrs ?? null, failedItps: qsOut.failedItps ?? null } : null;
  const ss = st?.steps?.['safety.score'];
  const score = ss?.status === 'blocked' ? ss.blocked?.observed?.score ?? null : ss?.out?.score ?? ss?.out?.safetyScore ?? null;
  const L = WP8['052-FLD'].safetyHealth;
  return {
    'DL.stored.promoteEcho': { ok: sameJson(echo, book), expected: book, observed: echo, gap: echo.some((x) => x === null) },
    'Q.052.score': { ok: sameJson(qObserved, qExpected) && st?.steps?.['quality.score']?.status === 'done', expected: qExpected, observed: qObserved },
    safety: { step: ss?.status ?? 'not run', ref: ss?.blocked?.ref ?? null, observed: score === null ? null : Number(score), verdict: judge(score === null ? null : Number(score), (x) => x === L.value, (x) => x === L.today), storedAt: stepAt(st, 'safety.score') },
    ids: { projectId: st?.projectId ?? null, mixed: out('timesheet.mixed')?.timesheetId ?? null },
  };
};

// -- setup --------------------------------------------------------------------------------------------------------------
/** The build steps whose stored outputs (moment answers and ids) the proof reads, per state file; `blocked` a step that may be BLOCKED with one of those refs. */
const STATE_STEPS = {
  '087-FLD': {
    done: ['calendar', 'team', 'activities', 'invite.party', 'worker.multiplier-half', 'timesheet.2000', 'timesheet.mixed', 'timesheet.rejected-edited', 'timesheet.crew-prefill',
      'dailylog.D1', 'dailylog.D2', 'dailylog.D3', 'dailylog.D4', 'dailylog.D5', 'weather.at13.read', 'legacy-itp', 'ncr', 'punch', 'observations', 'safety', 'rfi', 'submittals',
      'drawing.S-1', 'transmittal', 'notice-letter', 'meeting', 'variant.six-major', 'quality.inputs'],
    blocked: { 'rfi.draft': ['RFI-DRAFT'], 'weather.at13': ['HR-C11'], 'weather.at14': ['HR-C11'], 'weather.non-contractual.adds-nothing': ['HR-C11'] },
    findings: ['WP8-TRN-1'],
  },
  '052-FLD': {
    done: ['calendar', 'team', 'timesheet.mixed', 'dailylog.D1', 'dailylog.D2', 'dailylog.D3', 'quality.score'],
    blocked: { 'safety.score': ['HR-K1', 'SAFE-ARCH-1'] },
    findings: [],
  },
};
/** The personas: 087's (the warehouse keeper is the storeman), and 052's PM only when F52 is selected (WP8ADJ Q9). */
const PERSONAS = {
  pm: ['087', 'pm'], planner: ['087', 'planner'], qs: ['087', 'qs'], cost: ['087', 'cost'], site: ['087', 'site'], quality: ['087', 'quality'], storeman: ['087', 'warehouse'],
  pm052: ['052', 'pm'],
};
if (Object.values(PERSONAS).some(([code]) => !['087', '052'].includes(code))) throw new Error('a persona outside company 087 and 052\'s read of 052-FLD');
/** The leaves the KA checks read (their book keys): each must carry a today and a ref and be an assumption (KA.I9 ruling). */
const KA_KEYS = [...new Set(CHECKS.filter((c) => c.id.startsWith('KA.')).map((c) => c.bookKey))];

/** S.book (pure; exported for the registration check): the books' figures() rows carry the refs the known answers read. */
const bookCheck = () => {
  const rowsF = FIELD.figures();
  const rowsC = COMMERCIAL.figures();
  const wp8Rows = rowsF.filter((row) => String(row.key).startsWith('WP8.'));
  const withRef = wp8Rows.filter((row) => row.ref).length;
  const kaBad = KA_KEYS.filter((key) => { const leaf = leafAt(key); return !leaf || !leaf.ref || leaf.today === undefined || leaf.assumption !== true || sameJson(leaf.value, leaf.today); });
  const refsBad = WP8_REFS.filter(([key, ref]) => rowsF.concat(rowsC).find((r) => r.key === key)?.ref !== ref);
  const ok = WP8_PATCH_LEAVES.every((key) => leafAt(key)) && kaBad.length === 0 && refsBad.length === 0 && withRef >= WP8_REFS.length - 1 && COMMERCIAL.meta.head !== undefined;
  return { ok, observed: { fieldControls: { head: FIELD.meta.head, figures: rowsF.length, wp8: wp8Rows.length, wp8WithRef: withRef }, commercial: { head: COMMERCIAL.meta.head, figures: rowsC.length }, patchLeaves: WP8_PATCH_LEAVES.length, kaLeaves: KA_KEYS.length, kaBad, refsBad: refsBad.map(([k]) => k) } };
};

const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  // S.book: the load guard above passed (the WP-8 leaves exist with their patched values); figures() carries ref.
  const book = bookCheck();
  rec('S.book', book.ok, { observed: book.observed, detail: 'the WP-8 patch: 54 new keys, the known answers\' refs (WP8_REFS: the book\'s WP8_KNOWN and the commercial HR-C11 leaf), no "(recorded)" value; the FIXTURE agreed with every leaf at load' });

  // companies, the run date, personas
  const specs = Object.fromEntries(h.companies(...NEED_COMPANIES).map((c) => [c.code, c]));
  ctx.specs = specs;
  const problems = [];
  for (const code of NEED_COMPANIES) {
    const found = await ctx.q('select id, slug, name, "defaultTimezone" as timezone from "Organisation" where slug like $1', [`cert-${code}-%`]);
    if (found.length !== 1) { problems.push(`company ${code}: ${found.length} organisations, exactly one expected`); continue; }
    try { ctx.orgs[code] = certEnv.assertCertOrganisation(found[0]) || found[0]; } catch (error) { problems.push(`company ${code}: ${error.message}`); }
  }
  if (ctx.orgs['087']) {
    // 087's run date R = min(today in UTC, today in the company's zone) (build/lib.js): every F8 / F8V day is R-n.
    const now = new Date();
    ctx.zone = ctx.orgs['087'].timezone || null;
    const utc = ymdIn(now, 'UTC');
    const local = ymdIn(now, ctx.zone || 'UTC');
    ctx.R = utc < local ? utc : local;
    obs.runDate = { R: ctx.R, utc, local, zone: ctx.zone, at: now.toISOString() };
  }
  const signIn = async (key, code, email) => {
    ctx.sessions[key] = api.as({ email, orgId: ctx.orgs[code].id });
    const me = await get(key, '/auth/me');
    if (me.status !== 200) { problems.push(`${key} (${email}): GET /auth/me ${h.said(me)}`); return; }
    ctx.people[key] = me.body?.data?.id;
    if ((me.body?.data?.active?.orgId ?? me.body?.data?.orgId) !== ctx.orgs[code].id) problems.push(`${key}: session in another org`);
  };
  for (const [key, [code, who]] of Object.entries(PERSONAS)) {
    if (!NEED_COMPANIES.includes(code) || !ctx.orgs[code]) continue;
    await signIn(key, code, `${who}@${specs[code].domain}`);
  }

  // S.state: the build state files the selected checks read: moment answers and ids only.
  const stateProblems = [];
  for (const code of NEED_DEEP) {
    try {
      ctx.state[code] = readState(code);
      const want = STATE_STEPS[code];
      for (const step of want.done) {
        const st = ctx.state[code].steps?.[step];
        if (st?.status !== 'done') stateProblems.push(`${code}: step ${step} is ${st?.status || 'not run'}`);
      }
      for (const [step, refs] of Object.entries(want.blocked)) {
        const st = ctx.state[code].steps?.[step];
        const fine = st?.status === 'done' || (st?.status === 'blocked' && refs.includes(st.blocked?.ref));
        if (!fine) stateProblems.push(`${code}: step ${step} is ${st?.status || 'not run'}${st?.status === 'blocked' ? ` (${st.blocked?.ref}; allowed ${refs.join(' / ')})` : ''}`);
      }
      for (const ref of want.findings) if (!(ctx.state[code].findings || []).some((f) => f.ref === ref)) stateProblems.push(`${code}: finding ${ref} not persisted`);
    } catch (error) {
      stateProblems.push(`${code}: ${error.message}`);
    }
  }
  // The party user of 087-FLD (DL.087.partyLock): signed in only when F87 is selected.
  if (NEED_LIVE.includes('087-FLD') && ctx.state['087-FLD'] && ctx.orgs['087']) {
    const party = storedFld087(ctx.state['087-FLD']).ids.party;
    if (!party?.email) stateProblems.push('087-FLD: no invite.party e-mail in the state');
    else await signIn('party', '087', party.email);
  }
  // Each fix commit, when set, is the one git dates.
  obs.fixesGit = {};
  for (const [rule, fix] of Object.entries(FIXES)) {
    if (!fix.commit && !fix.committedAt) continue;
    const shown = spawnSync('git', ['-C', REPO, 'show', '-s', '--format=%cI', String(fix.commit)], { encoding: 'utf8' });
    const gitAt = shown.status === 0 ? shown.stdout.trim() : null;
    obs.fixesGit[rule] = { commit: fix.commit, committedAt: fix.committedAt, git: gitAt, error: shown.status === 0 ? null : String(shown.stderr || shown.error || '').slice(0, 300) };
    if (!fix.commit || !fix.committedAt || !gitAt || Date.parse(gitAt) !== Date.parse(fix.committedAt)) stateProblems.push(`FIXES['${rule}'] ${json(fix)}: git dates the commit ${gitAt || 'not at all'}; set both fields from git show -s --format=%cI <commit>`);
  }
  rec('S.state', stateProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.state).map(([c, s]) => [c, { projectId: s.projectId, runs: s.runs?.length, runDates: (s.runs || []).map((r) => r.runDate), updatedAt: s.updatedAt }])), detail: stateProblems.join('; ') || `${NEED_DEEP.length} state files (${NEED_DEEP.join(', ') || 'none needed'}), every needed step done (or BLOCKED with an allowed ref); fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}` });

  // S.projects: the deep projects by their exact names, through the API as their company's PM; 087-FLD's variant by the state's id.
  const projectProblems = [...problems];
  if (!ctx.R) projectProblems.push('no run date: company 087 was not resolved');
  for (const [code, { name, resolver }] of Object.entries(DEEP).filter(([code]) => NEED_DEEP.includes(code))) {
    if (!ctx.sessions[resolver]) { projectProblems.push(`${code}: no session for ${resolver}`); continue; }
    const page = await get(resolver, `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(name)}`);
    const live = listOf(page.body?.data).filter((p) => p.name === name && !p.archivedAt);
    if (page.status !== 200) projectProblems.push(`${code}: GET /projects ${h.said(page)}`);
    else if (live.length !== 1) projectProblems.push(`${code}: ${live.length} live projects named "${name}" (${live.map((p) => p.id).join(', ')})`);
    else {
      ctx.deep[code] = { id: live[0].id, P: `/projects/${live[0].id}` };
      if (ctx.state[code] && ctx.state[code].projectId !== live[0].id) projectProblems.push(`${code}: the live project ${live[0].id} is not the state file's ${ctx.state[code].projectId} (restore and rebuild, or stale state)`);
    }
  }
  if (NEED_LIVE.includes('087-FLD') && ctx.state['087-FLD'] && ctx.sessions.pm) {
    const vid = storedFld087(ctx.state['087-FLD']).ids.variant;
    const shown = vid ? await get('pm', `/projects/${vid}`) : null;
    if (!vid || shown?.status !== 200 || shown.body?.data?.archivedAt) projectProblems.push(`087-FLD's 6-major variant ${vid || '(no id)'} is not a live project (${shown ? h.said(shown) : 'not asked'})`);
    else ctx.deep.variant = { id: vid, P: `/projects/${vid}` };
  }
  rec('S.projects', projectProblems.length === 0, { observed: { orgs: Object.fromEntries(Object.entries(ctx.orgs).map(([c, o]) => [c, { id: o.id, slug: o.slug, timezone: o.timezone }])), people: Object.keys(ctx.people), projects: Object.fromEntries(Object.entries(ctx.deep).map(([c, d]) => [c, d.id])), runDate: obs.runDate || null }, detail: projectProblems.join('; ') || `${NEED_COMPANIES.length} companies (${NEED_COMPANIES.join(', ')}), ${Object.keys(ctx.people).length} sessions, ${NEED_DEEP.length} deep projects (${NEED_DEEP.join(', ') || 'none needed'}), one live each, matching the state; run date ${ctx.R} (${ctx.zone})` });
  if (projectProblems.length || stateProblems.length) throw new Error(`setup: ${[...stateProblems, ...projectProblems].join('; ')}`);
  // 087-FLD's fingerprint before the first deep read (S.087FLD.unchanged compares it with the one after the last).
  if (NEED_LIVE.includes('087-FLD')) ctx.fingerprints.before = await fingerprint087(ctx.deep['087-FLD'].id, storedFld087(ctx.state['087-FLD']).ids.days.D5);
};

// -- F8: F8-0 .. F8-2, the project, its team, activities, workers and evidence (S.F8.create, S.F8.workers, S.F8.evidence) --
const nullableNumber = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const fieldsOf = (res) => listOf(res.body?.error?.details).map((d) => d.field);
const f8Create = async () => {
  const t = await makeThrowaway({ pm: 'pm', label: 'F8', project: F8B.project, team: F8B.team });
  ctx.f8 = t;
  const made = [];
  for (const [i, [code, engineer]] of F8B.activities.entries()) {
    // engineerIds is required by the route (routes/activities.js:125-127, at least one): the book's engineer, F8's site engineer.
    const res = await send('planner', 'POST', `${t.P}/activities`, { name: label(`activity ${code}`), activityCode: code, wbsCode: 'WP8-F8', duration: 10, sortOrder: i, engineerIds: [ctx.people[engineer]] });
    t.acts[code] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push([code, h.said(res)]);
  }
  const s = t.shown || {};
  const p = t.payload;
  const o = { said: h.said(t.created), type: s.type ?? null, contractType: s.contractType ?? null, startDate: dayOf(s.startDate), endDate: dayOf(s.endDate), projectCalendar: s.projectCalendar ?? null, currency: s.currency ?? null };
  const e = { said: '201', type: p.type, contractType: p.contractType, startDate: p.startDate, endDate: p.endDate, projectCalendar: p.projectCalendar, currency: p.currency };
  const ok = sameJson(o, e) && teamOk(t, F8B.team) && made.every(([, said]) => said === '201');
  rec('S.F8.create', ok, { expected: { project: e, team: F8B.team, activities: F8B.activities.map(([code]) => code) }, observed: { id: t.id, ...o, team: t.members, activities: made }, detail: 'the quality engineer joins with no project role (POST /team refuses quality_engineer as a role, RJ-12; build/lib.js:1222); activities with engineerIds (WP-7 run 1\'s lesson)' });
  need(ok, 'F8-0: F8, its team or its activities could not be made');
};
const workerBody = (key) => {
  const w = F8B.workers[key];
  return { name: label(`worker ${key}`), employeeNumber: `WP8-${h.STAMP}-${key}`, trade: w.trade || 'General', classification: 'skilled', hourlyRate: w.hourlyRate, ...(w.overtimeMultiplier !== undefined ? { overtimeMultiplier: w.overtimeMultiplier } : {}), status: 'active', notes: label('field proof worker') };
};
const f8Workers = async () => {
  const t = ctx.f8;
  t.workers = {};
  const made = [];
  for (const key of ['W8-1', 'W8-R', 'W8-I']) {
    const res = await send('site', 'POST', `${t.P}/timesheets/workers`, workerBody(key));
    t.workers[key] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push({ key, said: h.said(res), rate: res.body?.data?.hourlyRate ?? null, overtimeMultiplier: res.body?.data?.overtimeMultiplier ?? null });
  }
  const crew = F8B.workers.crew;
  const cr = await send('site', 'POST', `${t.P}/timesheets/crews`, { name: label(`crew ${crew.code}`), workerIds: crew.members.map((k) => t.workers[k]), defaultActivityId: t.acts[crew.defaultActivity], foremanUserId: ctx.people.site, status: 'active' });
  t.crew = cr.status === 201 ? cr.body?.data?.id || null : null;
  const o = { workers: made.map((m) => [m.key, m.said, nullableNumber(m.rate)]), crew: h.said(cr), crewMembers: cr.body?.data?.memberCount ?? listOf(cr.body?.data?.members).length };
  const e = { workers: ['W8-1', 'W8-R', 'W8-I'].map((k) => [k, '201', F8B.workers[k].hourlyRate]), crew: '201', crewMembers: crew.members.length };
  const ok = sameJson(o, e);
  rec('S.F8.workers', ok, { expected: e, observed: o, detail: 'company-level worker rows (residue, set inactive at the end, WP8ADJ Q10); the crew pre-fills its members at defaultHours (TS-3)' });
  need(ok, 'F8-1: F8\'s workers or crew could not be made');
};
const f8Evidence = async () => {
  const t = ctx.f8;
  const ref = await evidence(t, 'self-test');
  const ok = Boolean(ref.documentId) && ref.storageKey === ref.documentId && typeof ref.fileName === 'string';
  rec('S.F8.evidence', ok, { expected: { documentId: true, storageKey: 'the documentId', fileName: true }, observed: ref, detail: `${F8B.evidence.upload}; sent as ${F8B.evidence.reference}` });
  need(ok, 'F8-2: an own upload could not be made');
};

// -- F8: DA .. DE, the daily logs (DL.F8.*, KA.DL.F8.promoteStored, KA.F4.F8.*) -----------------------------------------
const addEntry = async (t, who, day, section, payload) => {
  const res = await send(who, 'POST', `${t.P}/daily-logs/${day}/entries/${section}`, payload);
  return { res, id: res.status === 201 ? res.body?.data?.entryId || null : null };
};
const dayStatus = async (t, day) => (await get('pm', `${t.P}/daily-logs/${day}`)).body?.data?.status ?? null;
const f8Days = async () => {
  const t = ctx.f8;
  t.days = {};
  // DA: the manpower mix, the Labourer's review without a reason then with one, the manpower report by trade
  const da = dayBook('DA');
  const DA = runDay(da.date);
  const ids = {};
  for (const [trade, workers, hours, act] of da.entries) {
    const e = await addEntry(t, 'site', DA, 'manpower', { trade, workers, hours, companyName: FIXTURE.manpowerCompany, activityId: t.acts[act], notes: label(`${trade} on ${act}`) });
    need(Boolean(e.id), `DA: the ${trade} entry could not be added (${h.said(e.res)} ${e.res.body?.error?.message || ''})`);
    ids[trade] = e.id;
  }
  const rejected = da.entries.find((e) => e[4] === 'rejected')[0];
  const rv = await send('site', 'POST', `${t.P}/daily-logs/${DA}/entries/manpower/${ids[rejected]}/review`, { decision: 'reject' });
  const afterNo = entryIn(await dayLog(t, DA), 'manpower', ids[rejected])?.status ?? null;
  rec('DL.F8.rejectWithoutReason', h.is(rv, WP8.dailyLog.rejectWithoutReason.value) && afterNo === 'approved', { expected: { said: WP8.dailyLog.rejectWithoutReason.value, entryStatus: 'approved' }, observed: { said: h.said(rv), entryStatus: afterNo }, detail: 'reviewEntry refuses before the transaction (daily-log.service.js:1036); the route takes the reason as optional' });
  const rr = await send('site', 'POST', `${t.P}/daily-logs/${DA}/entries/manpower/${ids[rejected]}/review`, { decision: 'reject', reason: label('not on the gate log') });
  need(rr.status === 200 && entryIn(await dayLog(t, DA), 'manpower', ids[rejected])?.status === 'rejected', `DA: the ${rejected} entry could not be rejected with a reason (${h.said(rr)})`);
  const report = await dataOf('pm', `${t.P}/daily-logs/manpower-report?from=${DA}&to=${DA}&groupBy=trade`);
  const items = listOf(report?.items);
  const byKey = (k) => items.find((i) => i.key === k) || null;
  const om = { Steelfixer: byKey('Steelfixer')?.manHours ?? null, Carpenter: byKey('Carpenter')?.manHours ?? null, Labourer: byKey('Labourer') ? byKey('Labourer').manHours : 'absent', total: report?.totals?.manHours ?? null, workers: report?.totals?.workers ?? null };
  rec('DL.F8.manpower', sameJson(om, F8B.manpower), { expected: F8B.manpower, observed: { ...om, items: items.map((i) => [i.key, i.manHours, i.workers]) }, detail: 'manpowerReport counts approved and submitted entries only (daily-log.service.js:1456): the rejected Labourer is left out (M-MP: 86 / 10)' });
  t.days.DA = DA;

  // DB: delays of 2 h, 6 h and 10 h promoted by the planner; the register rows read back
  const db = dayBook('DB');
  const DB = runDay(db.date);
  const promos = [];
  for (const [hours, act] of db.delays) {
    const e = await addEntry(t, 'site', DB, 'delays', { type: FIXTURE.delayType, description: label(`weather delay ${hours} h`), hoursLost: hours, activityId: t.acts[act] });
    need(Boolean(e.id), `DB: the ${hours} h delay could not be added (${h.said(e.res)} ${e.res.body?.error?.message || ''})`);
    const pr = await send('planner', 'POST', `${t.P}/daily-logs/${DB}/entries/delays/${e.id}/weather-delay`, {});
    const wd = pr.body?.data?.weatherDelay || {};
    const named = entryIn(await dayLog(t, DB, 'planner'), 'delays', e.id)?.weatherDelayId ?? null;
    promos.push({ hours, entryId: e.id, said: h.said(pr), echo: wd.delayDays === undefined ? null : Number(wd.delayDays), contractual: wd.contractual ?? null, weatherDelayId: wd.id ?? null, named: Boolean(wd.id) && named === wd.id });
  }
  const op = { said: promos.map((p) => p.said), echo: promos.map((p) => p.echo), contractual: promos.map((p) => p.contractual), named: promos.map((p) => p.named) };
  const ep = { said: promos.map(() => '200'), echo: [WP8.dailyLog.promote2h.value, WP8.dailyLog.promote6h.value, WP8.dailyLog.promote10h.value], contractual: promos.map(() => true), named: promos.map(() => true) };
  rec('DL.F8.promoteEcho', sameJson(op, ep), { expected: ep, observed: op, detail: 'logWeatherDelay: round((h / 8) x 2) / 2, contractual by default (daily-log.service.js:1200, 1209); the entry names the row after it is created' });
  obs.f8Promotions = promos;
  await probe('KA.DL.F8.promoteStored (DB: the promoted rows read back)', async () => {
    if (promos.some((p) => !p.weatherDelayId)) throw probeSetup('KA.DL.F8.promoteStored', `a promotion made no row (${json(promos.map((p) => p.said))})`);
    const rows = listOf((await registerOf(t.P))?.rows);
    const stored = promos.map((p) => { const r = rows.find((x) => x.id === p.weatherDelayId); return r ? Number(r.delayDays) : null; });
    const L = WP8.dailyLog.promoteResponseVsStored;
    obs.f8PromotedStored = stored;
    ka('KA.DL.F8.promoteStored', { ref: L.ref, value: numbersIn(L.value), today: numbersIn(L.today), observed: stored, verdict: judge(stored, (x) => sameJson(x, numbersIn(L.value)), (x) => sameJson(x, numbersIn(L.today))), detail: 'WeatherDelay.delayDays is an Int (weather.service.js:217, schema.prisma:2958): 0.5 -> 0, 1.5 -> 1' });
  });
  t.days.DB = DB;

  // DC: a note, submitted and approved; PATCH, entry add, entry delete; then the PM's reopen with no reason
  const DC = runDay(dayBook('DC').date);
  const note = await addEntry(t, 'site', DC, 'notes', { kind: 'general', text: label('DC note') });
  need(Boolean(note.id), `DC: the note could not be added (${h.said(note.res)})`);
  const sub = await send('site', 'POST', `${t.P}/daily-logs/${DC}/submit`, {});
  const apr = sub.status === 200 ? await send('pm', 'POST', `${t.P}/daily-logs/${DC}/approve`, {}) : null;
  need(apr?.status === 200 && (await dayStatus(t, DC)) === 'approved', `DC could not be submitted and approved (${h.said(sub)}, ${apr ? h.said(apr) : 'not sent'})`);
  const before = await dayLog(t, DC);
  const pa = await send('site', 'PATCH', `${t.P}/daily-logs/${DC}`, { summary: label('a summary on an approved day') });
  const afterPa = await dayLog(t, DC);
  rec('DL.F8.approvedPatch', h.is(pa, WP8.dailyLog.approvedDayPatch.value) && afterPa?.summary === before?.summary, { expected: { said: WP8.dailyLog.approvedDayPatch.value, summaryUnchanged: true }, observed: { said: h.said(pa), summaryUnchanged: afterPa?.summary === before?.summary }, detail: 'assertEditable (daily-log.service.js:657-661)' });
  const notesBefore = listOf(afterPa?.sections?.notes).length;
  const ad = await send('site', 'POST', `${t.P}/daily-logs/${DC}/entries/notes`, { kind: 'general', text: label('a note on an approved day') });
  const notesAfter = listOf((await dayLog(t, DC))?.sections?.notes).length;
  rec('DL.F8.approvedAdd', h.is(ad, WP8.dailyLog.approvedDayEntryAdd.value) && notesAfter === notesBefore, { expected: { said: WP8.dailyLog.approvedDayEntryAdd.value, notesAdded: 0 }, observed: { said: h.said(ad), notesAdded: notesAfter - notesBefore }, detail: 'no clientRequestId, so the replay branch (DL-REPLAY-1) is not reached' });
  const dl = await send('site', 'DELETE', `${t.P}/daily-logs/${DC}/entries/notes/${note.id}`);
  const still = Boolean(entryIn(await dayLog(t, DC), 'notes', note.id));
  rec('DL.F8.approvedDelete', h.is(dl, WP8.dailyLog.approvedDayEntryDelete.value) && still, { expected: { said: WP8.dailyLog.approvedDayEntryDelete.value, noteStillThere: true }, observed: { said: h.said(dl), noteStillThere: still }, detail: 'deleteEntry runs assertEditable in its transaction' });
  await probe('KA.F4.F8.reopenNoReason (DC: the PM reopens an approved day with no reason)', async () => {
    if ((await dayStatus(t, DC)) !== 'approved') throw probeSetup('KA.F4.F8.reopenNoReason', 'DC is not approved');
    const ro = await send('pm', 'POST', `${t.P}/daily-logs/${DC}/reopen`, {});
    const o = { said: h.said(ro), status: ro.status, dayStatus: await dayStatus(t, DC) };
    const L = WP8.dailyLog.reopenWithoutReason;
    ka('KA.F4.F8.reopenNoReason', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F4'].reopenReasonAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'the route\'s reason is optional (routes/daily-logs.js:176); reopenLog needs none (:833-847)' });
  });
  t.days.DC = DC;

  // DD: an open day with a note, approved by the PM
  const DD = runDay(dayBook('DD').date);
  const nd = await addEntry(t, 'site', DD, 'notes', { kind: 'general', text: label('DD note') });
  need(Boolean(nd.id) && (await dayStatus(t, DD)) === 'open', `DD: the note could not be added or the day is not open (${h.said(nd.res)})`);
  await probe('KA.F4.F8.approveFromOpen (DD: the PM approves an open day)', async () => {
    const ap = await send('pm', 'POST', `${t.P}/daily-logs/${DD}/approve`, {});
    const o = { said: h.said(ap), status: ap.status, dayStatus: await dayStatus(t, DD) };
    const L = WP8.dailyLog.approveFromOpen;
    ka('KA.F4.F8.approveFromOpen', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F4'].openApproveAnswer), (x) => `${x.status} ${x.dayStatus}` === L.today), detail: 'approveLog has no submitted check (daily-log.service.js:790-831)' });
  });
  t.days.DD = DD;

  // DE: an empty day made by a summary PATCH, approved by the PM
  const DE = runDay(dayBook('DE').date);
  const pe = await send('site', 'PATCH', `${t.P}/daily-logs/${DE}`, { summary: label('DE summary only') });
  const de = await dayLog(t, DE);
  const entries = Object.values(de?.sections || {}).reduce((s, rows) => s + listOf(rows).length, 0);
  need(pe.status === 200 && de?.status === 'open' && entries === 0, `DE: the summary PATCH did not leave an open empty day (${h.said(pe)}, ${de?.status}, ${entries} entries)`);
  await probe('KA.F4.F8.approveEmpty (DE: the PM approves an empty day)', async () => {
    const ap = await send('pm', 'POST', `${t.P}/daily-logs/${DE}/approve`, {});
    const o = { said: h.said(ap), status: ap.status, dayStatus: await dayStatus(t, DE) };
    const L = WP8.dailyLog.approveEmptyDay;
    ka('KA.F4.F8.approveEmpty', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F4'].emptyApproveAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'approveLog does not count entries; submitLog alone refuses an empty day (:752)' });
  });
  t.days.DE = DE;
};

// -- F8: TS-1 .. TS-7, the timesheets (TS.F8.*, KA.F5.F8.*) ------------------------------------------------------------
const sheetEntries = (t, rows) => rows.map(([worker, act, timeType, hours]) => ({ workerId: t.workers[worker], activityId: t.acts[act], timeType, hours, startTime: FIXTURE.entryTimes[timeType][0], endTime: FIXTURE.entryTimes[timeType][1] }));
const sheetsOn = async (t, day) => listOf(await dataOf('site', `${t.P}/timesheets?from=${day}&to=${day}`), 'items');
const sheetOf = async (t, id, who = 'cost') => dataOf(who, `${t.P}/timesheets/${id}`);
const postSheet = (t, day, rows, extra = {}) => send('site', 'POST', `${t.P}/timesheets`, { date: day, notes: label(`sheet ${day}`), ...(rows ? { entries: sheetEntries(t, rows) } : {}), ...extra });
const f8Timesheets = async () => {
  const t = ctx.f8;
  // TS-1: the mixed day, returned without a reason, then approved; its ledger rows
  const s1 = sheetBook('TS-1');
  const d1 = runDay(s1.date);
  const c1 = await postSheet(t, d1, s1.entries.map(([hours, timeType]) => [s1.worker, s1.activity, timeType, hours]));
  const id1 = c1.status === 201 ? c1.body?.data?.id : null;
  const sb1 = id1 ? await send('site', 'POST', `${t.P}/timesheets/${id1}/submit`, {}) : null;
  need(sb1?.status === 200, `TS-1 could not be made and submitted (${h.said(c1)}, ${sb1 ? h.said(sb1) : 'not sent'})`);
  const rj = await send('cost', 'POST', `${t.P}/timesheets/${id1}/reject`, {});
  const stRj = (await sheetOf(t, id1))?.status ?? null;
  rec('TS.F8.rejectWithoutReason', h.is(rj, WP8.timesheet.rejectWithoutReason.value) && fieldsOf(rj).includes('reason') && stRj === 'submitted', { expected: { said: WP8.timesheet.rejectWithoutReason.value, field: 'reason', status: 'submitted' }, observed: { said: h.said(rj), fields: fieldsOf(rj), status: stRj }, detail: 'the route\'s reason is required (routes/timesheets.js:98) before the service\'s TIMESHEET_REASON_REQUIRED' });
  const ap1 = await send('cost', 'POST', `${t.P}/timesheets/${id1}/approve`, {});
  need(ap1.status === 200, `TS-1 could not be approved (${h.said(ap1)})`);
  const read1 = await sheetOf(t, id1);
  const explain = listOf((await dataOf('pm', `${t.P}/cost/reconciliation/explain?activityId=${t.acts[s1.activity]}`))?.entries).filter((r) => r.sourceId === id1);
  const [costType, sourceType] = (/costType (\w+), sourceType (\w+)/.exec(WP8.timesheet.mixedDayLedger.value) || []).slice(1);
  const w81 = F8B.workers[s1.worker];
  const each = s1.entries.map(([hours, timeType]) => RULESET.labourCents([{ hours, rateCents: Math.round(w81.hourlyRate * 100), timeType, otMultiplier: w81.overtimeMultiplier }])).sort((a, b) => a - b);
  const om = { totalCost: cents(read1?.totalCost), rows: explain.length, costTypes: [...new Set(explain.map((r) => r.costType))], sourceTypes: [...new Set(explain.map((r) => r.sourceType))], amounts: explain.map((r) => cents(r.amount)).sort((a, b) => a - b) };
  const em = { totalCost: WP8.timesheet.mixedDay.value, rows: s1.entries.length, costTypes: [costType], sourceTypes: [sourceType], amounts: each };
  rec('TS.F8.mixed', sameJson(om, em), { expected: em, observed: om, detail: 'approveTimesheet prices each entry at the worker\'s rate x multiplierFor (timesheet.service.js:70, :652-655) and posts it through the cost ledger (M-DT: 600.00)' });

  // TS-2: one 25 h entry; then 16 + 9 on one sheet
  const s2 = sheetBook('TS-2');
  const d2 = runDay(s2.date);
  const n2 = (await sheetsOn(t, d2)).length;
  const big = await postSheet(t, d2, [[s2.worker, 'F8-A1', 'regular', s2.entries[0][0]]]);
  const n2b = (await sheetsOn(t, d2)).length;
  rec('TS.F8.hours25Single', h.is(big, WP8.timesheet.hours25SingleEntry.value) && fieldsOf(big).includes('entries[0].hours') && n2b === n2, { expected: { said: WP8.timesheet.hours25SingleEntry.value, field: 'entries[0].hours', written: 0 }, observed: { said: h.said(big), fields: fieldsOf(big), written: n2b - n2 }, detail: 'entries.*.hours isFloat 0-24 at the route (routes/timesheets.js:56)' });
  const split = await postSheet(t, d2, s2.split.map((hours) => [s2.worker, 'F8-A1', 'regular', hours]));
  const n2c = (await sheetsOn(t, d2)).length;
  rec('TS.F8.hours25Split', h.is(split, WP8.timesheet.hours25SplitEntries.value) && n2c === n2, { expected: { said: WP8.timesheet.hours25SplitEntries.value, written: 0 }, observed: { said: h.said(split), written: n2c - n2 }, detail: 'normalizeEntries sums a worker\'s hours on the sheet (timesheet.service.js:486-487)' });

  // TS-3: the crew pre-filled, then again on the same date
  const s3 = sheetBook('TS-3');
  const d3 = runDay(s3.date);
  const c3 = await send('site', 'POST', `${t.P}/timesheets`, { date: d3, crewId: t.crew, defaultHours: F8B.workers.crew.defaultHours, notes: label('crew prefill') });
  const again = await send('site', 'POST', `${t.P}/timesheets`, { date: d3, crewId: t.crew, defaultHours: F8B.workers.crew.defaultHours, notes: label('crew prefill again') });
  const crewSheets = (await sheetsOn(t, d3)).filter((s) => (s.crewId ?? s.crew?.id) === t.crew).length;
  const o3 = { first: h.said(c3), entryCount: c3.body?.data?.entryCount ?? listOf(c3.body?.data?.entries).length, regularHours: nullableNumber(c3.body?.data?.regularHours), second: h.said(again), crewSheets };
  const e3 = { first: '201', entryCount: F8B.workers.crew.members.length, regularHours: F8B.workers.crew.members.length * F8B.workers.crew.defaultHours, second: WP8.timesheet.sameCrewSameDate.value, crewSheets: 1 };
  rec('TS.F8.sameCrewDate', sameJson(o3, e3), { expected: e3, observed: o3, detail: 'createTimesheet pre-fills a crew\'s members (:551) and refuses a second sheet for the crew and date (:546-549)' });

  // TS-4: W8-1 16 h on one sheet, 9 h on another, the same day (HR-F5)
  const s4 = sheetBook('TS-4');
  const d4 = runDay(s4.date);
  await probe('KA.F5.F8.capAcrossSheets (TS-4: 16 h then 9 h on two sheets)', async () => {
    const a = await postSheet(t, d4, [[s4.worker, 'F8-A1', 'regular', s4.acrossSheets[0]]]);
    if (a.status !== 201) throw probeSetup('KA.F5.F8.capAcrossSheets', `the first sheet answered ${h.said(a)}`);
    const b = await postSheet(t, d4, [[s4.worker, 'F8-A1', 'regular', s4.acrossSheets[1]]]);
    const sheets = await sheetsOn(t, d4);
    const o = { said: h.said(b), status: b.status, sheetsCreated: sheets.length, hoursOnTheDay: sheets.reduce((s, x) => s + Number(x.regularHours || 0) + Number(x.overtimeHours || 0), 0) };
    const L = WP8.timesheet.capAcrossSheets;
    ka('KA.F5.F8.capAcrossSheets', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F5'].capAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'the 24 h cap counts one sheet only (timesheet.service.js:486-487)' });
  });

  // TS-5: W8-R submitted at 50.00, the rate changed to 60.00, approved (HR-F5)
  const s5 = sheetBook('TS-5');
  const d5 = runDay(s5.date);
  await probe('KA.F5.F8.rateTiming (TS-5: the rate changed between submission and approval)', async () => {
    const c = await postSheet(t, d5, s5.entries.map(([hours, timeType]) => [s5.worker, 'F8-A1', timeType, hours]));
    const id = c.status === 201 ? c.body?.data?.id : null;
    const sb = id ? await send('site', 'POST', `${t.P}/timesheets/${id}/submit`, {}) : null;
    if (sb?.status !== 200) throw probeSetup('KA.F5.F8.rateTiming', `the sheet could not be made and submitted (${h.said(c)}, ${sb ? h.said(sb) : 'not sent'})`);
    const pr = await send('site', 'PATCH', `${t.P}/timesheets/workers/${t.workers[s5.worker]}`, { hourlyRate: s5.rateChange[1] });
    if (pr.status !== 200) throw probeSetup('KA.F5.F8.rateTiming', `the rate could not be changed (${h.said(pr)})`);
    const ap = await send('cost', 'POST', `${t.P}/timesheets/${id}/approve`, {});
    if (ap.status !== 200) throw probeSetup('KA.F5.F8.rateTiming', `the sheet could not be approved (${h.said(ap)})`);
    const total = cents((await sheetOf(t, id))?.totalCost);
    kaLeaf('KA.F5.F8.rateTiming', WP8.timesheet.rateChangeRecorded, total, { detail: 'an entry stores no rate until approval; approveTimesheet reads the worker\'s current rate (:653)' });
  });

  // TS-6: W8-I set inactive, then a sheet naming W8-I (HR-F5)
  const s6 = sheetBook('TS-6');
  const d6 = runDay(s6.date);
  await probe('KA.F5.F8.inactiveWorker (TS-6: a sheet naming an inactive worker)', async () => {
    const pi = await send('site', 'PATCH', `${t.P}/timesheets/workers/${t.workers[s6.worker]}`, { status: 'inactive' });
    if (pi.status !== 200 || pi.body?.data?.status !== 'inactive') throw probeSetup('KA.F5.F8.inactiveWorker', `${s6.worker} could not be set inactive (${h.said(pi)})`);
    const c = await postSheet(t, d6, [[s6.worker, 'F8-A1', 'regular', 8]]);
    const made = c.status === 201 ? await get('site', `${t.P}/timesheets/${c.body?.data?.id}`) : null;
    const o = { said: h.said(c), status: c.status, sheetsCreated: made?.status === 200 ? 1 : 0 };
    const L = WP8.timesheet.inactiveWorker;
    ka('KA.F5.F8.inactiveWorker', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F5'].inactiveAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'assertWorkersUsable checks existence and party scope, not status (timesheet.service.js:375-385)' });
  });

  // TS-7: a worker at 0.5 by create and by import, both refused
  const H = FIXTURE.halfWorker;
  const halfName = label('worker at multiplier 0.5');
  const hc = await send('site', 'POST', `${t.P}/timesheets/workers`, { name: halfName, employeeNumber: `WP8-${h.STAMP}-W0`, trade: H.trade, hourlyRate: H.hourlyRate, overtimeMultiplier: H.overtimeMultiplier, status: 'active' });
  const importName = label('worker imported at multiplier 0.5');
  const hi = await send('site', 'POST', `${t.P}/timesheets/workers/import`, { rows: [{ name: importName, hourlyRate: H.hourlyRate, overtimeMultiplier: H.overtimeMultiplier }] });
  const listed = listOf(await dataOf('site', `${t.P}/timesheets/workers?q=${encodeURIComponent('multiplier 0.5')}`)).filter((w) => [halfName, importName].includes(w.name));
  const HI = WP8.timesheet.multiplierHalfImport.value;
  const halfField = /details\.field=([A-Za-z0-9_[\]]+(?:\.[A-Za-z0-9_[\]]+)*)/.exec(WP8.timesheet.multiplierHalfCreate.note || '')?.[1] || null;
  const oh = { create: h.said(hc), createField: fieldsOf(hc).includes(halfField) ? halfField : fieldsOf(hc), import: { status: hi.status, created: hi.body?.data?.created ?? null, updated: hi.body?.data?.updated ?? null, skipped: hi.body?.data?.skipped ?? null, errors: hi.body?.data?.errors ?? null }, listed: listed.length };
  const eh = { create: WP8.timesheet.multiplierHalfCreate.value, createField: halfField, import: HI, listed: 0 };
  rec('TS.F8.halfRefused', sameJson(oh, eh), { expected: eh, observed: oh, detail: 'overtimeMultiplier isFloat 1-5 at the route (routes/timesheets.js:32) and in importWorkers\' row check; no 0.5 worker exists (builders\' adjudication 087-FLD item 1)' });
};
/** TS.pure.multiplierHalf: the service's exported rule, in process (no 0.5 worker can exist). */
const pureMultiplier = () => {
  // eslint-disable-next-line global-require
  const timesheetService = require(path.join(SRC, 'services', 'timesheet.service'));
  const H = FIXTURE.halfWorker;
  const multiplier = timesheetService.multiplierFor('overtime', { overtimeMultiplier: H.overtimeMultiplier });
  const amount = Math.round(H.hours * H.hourlyRate * multiplier * 100);
  rec('TS.pure.multiplierHalf', amount === WP8.timesheet.multiplierHalf.value, { expected: WP8.timesheet.multiplierHalf.value, observed: { multiplier, amount }, detail: 'multiplierFor floors overtime at 1 (timesheet.service.js:70; M-OTF removes the floor: 5000)' });
};

// -- F8: Q-1 .. Q-5, NCRs, legacy ITPs and the quality score (Q.F8.*, KA.Q5.F8.severityDowngrade, KA.Q4.F8.legacyItpStatus) --
const ncrsOf = async (t, who = 'quality') => listOf(await dataOf(who, `${t.P}/ncr`));
const ncrRow = async (t, id) => (await ncrsOf(t)).find((r) => r.id === id) || null;
const raiseNcr = async (t, who, key, severity, act) => {
  const res = await send(who, 'POST', `${t.P}/ncr`, { severity, description: label(`NCR ${key}`), disposition: label('repair to the method statement'), responsible: label('site foreman'), assigneeUserId: ctx.people.site, ...(act ? { activityId: t.acts[act] } : {}), dueDate: runDay('R+10'), comment: label('raised after inspection') });
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  need(Boolean(id), `NCR ${key} could not be raised on ${t.label} (${h.said(res)} ${res.body?.error?.message || ''})`);
  return id;
};
const closeoutBody = (refs) => ({ closureComment: label('made good and re-inspected'), responsible: label('site foreman'), dueDate: runDay('R+10'), attachmentRefs: refs });
const closeout = async (t, id, refs) => send('site', 'POST', `${t.P}/ncr/${id}/close`, closeoutBody(refs));
const f8Quality = async () => {
  const t = ctx.f8;
  t.ncrs = {};
  t.itps = {};
  // Q-1: the NCR mix with own evidence, the closed ones approved; legacy ITPs failed, waived, passed
  for (const [key, severity, target, act] of F8B.qualityMix.ncrs) {
    const id = await raiseNcr(t, 'site', key, severity, act);
    t.ncrs[key] = id;
    if (target !== 'open') {
      const co = await closeout(t, id, [await evidence(t, `ncr ${key}`)]);
      need(co.status === 200, `NCR ${key}: the closeout answered ${h.said(co)}`);
    }
    if (target === 'closed') {
      const ap = await send('quality', 'POST', `${t.P}/ncr/${id}/approve`, { comment: label('repair accepted') });
      need(ap.status === 200, `NCR ${key}: the approval answered ${h.said(ap)}`);
    }
    need((await ncrRow(t, id))?.status === target, `NCR ${key} is not ${target}`);
  }
  for (const target of F8B.qualityMix.legacyItps) {
    const c = await send('quality', 'POST', `${t.P}/itp`, { title: label(`legacy ITP ${target}`), pointType: 'hold', status: 'pending', activityId: t.acts['F8-A1'], dueDate: runDay('R-1'), inspectionDate: runDay('R-2'), inspector: label('quality inspector') });
    const id = c.status === 201 ? c.body?.data?.id || null : null;
    const p = id ? await send('quality', 'PATCH', `${t.P}/itp/${id}`, { status: target, inspectionDate: runDay('R-1'), comment: label(`recorded ${target}`) }) : null;
    need(p?.status === 200, `the legacy ITP ${target} could not be made (${h.said(c)}, ${p ? h.said(p) : 'not sent'})`);
    t.itps[target] = id;
  }
  // Q-2: the dashboard, the health card and the workspace
  const m = await dashboardOf(t.P);
  const od = { qualityScore: m.qualityScore ?? null, majorNcrs: m.majorNcrs ?? null, minorNcrs: m.minorNcrs ?? null, failedItps: m.failedItps ?? null };
  const counts = { majorNcrs: F8B.qualityMix.ncrs.filter((n) => n[1] === 'major').length, minorNcrs: F8B.qualityMix.ncrs.filter((n) => n[1] === 'minor').length, failedItps: F8B.qualityMix.legacyItps.filter((s) => s === 'failed').length };
  const ed = { qualityScore: WP8.quality.dashboard087FLD.value, ...counts };
  rec('Q.F8.dashboard21', sameJson(od, ed), { expected: ed, observed: od, detail: '100 - 2 x 20 - 3 x 8 - 1 x 15 (quality.service.js:44-51); closed NCRs count; F8 has no form ITP (HR-Q3-neutral; M-QW: 15)' });
  const hq = await healthDim(t.P, 'quality');
  const oh = { score: hq?.score ?? null, majorNCRs: hq?.detail?.majorNCRs ?? null, minorNCRs: hq?.detail?.minorNCRs ?? null, failedITPs: hq?.detail?.failedITPs ?? null };
  const eh = { score: WP8.quality.health087FLD.value, majorNCRs: counts.majorNcrs, minorNCRs: counts.minorNcrs, failedITPs: counts.failedItps };
  rec('Q.F8.health21', sameJson(oh, eh), { expected: eh, observed: oh, detail: 'routes/health.js:442-447 (clampScore; M-QWh: 15)' });
  await probe('Q.F8.workspace21 (the workspace row of F8)', async () => {
    const w = await workspaceRow(t.id);
    if (!w) throw probeSetup('Q.F8.workspace21', 'F8 is not among the rows GET /projects/workspace-dashboard answers the PM or the site engineer (the six most at risk)');
    rec('Q.F8.workspace21', w.row.dimensions?.quality === WP8.quality.workspace087FLD.value, { expected: WP8.quality.workspace087FLD.value, observed: { quality: w.row.dimensions?.quality ?? null, persona: w.persona }, detail: 'workspace-dashboard.service.js:1142-1153 (M-QWw: 15)' });
  });
  // Q-3: the six NCR codes, by the quality engineer (the closeout by the site engineer)
  const st = async (key) => (await ncrRow(t, t.ncrs[key]))?.status ?? null;
  const r1 = await send('quality', 'POST', `${t.P}/ncr/${t.ncrs['minor-submitted']}/reject`, {});
  const r2 = await send('quality', 'POST', `${t.P}/ncr/${t.ncrs['minor-open']}/reject`, { reason: label('not ready') });
  const or = { noReason: h.said(r1), field: fieldsOf(r1).includes('reason'), notSubmitted: h.said(r2), statuses: [await st('minor-submitted'), await st('minor-open')] };
  const er = { noReason: WP8.quality.ncrRejectWithoutReason.value, field: true, notSubmitted: WP8.quality.ncrRejectNotSubmitted.value, statuses: ['submitted', 'open'] };
  rec('Q.F8.ncrReject', sameJson(or, er), { expected: er, observed: or, detail: 'the route\'s reason notEmpty (routes/ncr.js:187); rejectNcr refuses a record that is not submitted' });
  const o1 = await send('quality', 'POST', `${t.P}/ncr/${t.ncrs['minor-closed']}/reopen`, {});
  const o2 = await send('quality', 'POST', `${t.P}/ncr/${t.ncrs['minor-open']}/reopen`, { reason: label('reopen probe') });
  const oo = { noReason: h.said(o1), field: fieldsOf(o1).includes('reason'), notClosed: h.said(o2), statuses: [await st('minor-closed'), await st('minor-open')] };
  const eo = { noReason: WP8.quality.ncrReopenWithoutReason.value, field: true, notClosed: WP8.quality.ncrReopenNotClosed.value, statuses: ['closed', 'open'] };
  rec('Q.F8.ncrReopen', sameJson(oo, eo), { expected: eo, observed: oo, detail: 'routes/ncr.js:252; reopenNcr refuses a record that is not closed' });
  const a1 = await send('quality', 'POST', `${t.P}/ncr/${t.ncrs['minor-open']}/approve`, { comment: label('approve probe') });
  const a2 = await closeout(t, t.ncrs['minor-closed'], [await evidence(t, 'ncr closeout probe')]);
  const oa = { approveOpen: h.said(a1), closeoutClosed: h.said(a2), statuses: [await st('minor-open'), await st('minor-closed')] };
  const ea = { approveOpen: WP8.quality.ncrApproveNotSubmitted.value, closeoutClosed: WP8.quality.ncrCloseNotOpen.value, statuses: ['open', 'closed'] };
  rec('Q.F8.ncrApproveClose', sameJson(oa, ea), { expected: ea, observed: oa, detail: 'approveNcr (ncr.service.js:565-571) and submitNcrCloseout (:458-464) refuse the wrong state' });
  // Q-4: the open major closed out and approved (the deviation of WP8ADJ Q1)
  const cm = await closeout(t, t.ncrs['major-open'], [await evidence(t, 'ncr major-open')]);
  const am = cm.status === 200 ? await send('quality', 'POST', `${t.P}/ncr/${t.ncrs['major-open']}/approve`, { comment: label('major repair accepted') }) : null;
  need(am?.status === 200 && (await st('major-open')) === 'closed', `Q-4: the open major could not be closed (${h.said(cm)}, ${am ? h.said(am) : 'not sent'})`);
  const after = (await dashboardOf(t.P)).qualityScore ?? null;
  rec('Q.F8.closeMajor', after === WP8.quality.closeMajorLeaves.value, { expected: WP8.quality.closeMajorLeaves.value, observed: after, detail: 'closed NCRs keep counting (the CLAUDE.md literal rule; HR-Q4 keeps it): reported beside CF.HRQ4, never classified' });
  obs.closeMajor = { score: after };
  // Q-5: the closed major downgraded then back; the failed legacy ITP to passed then back
  await probe('KA.Q5.F8.severityDowngrade (Q-5: a closed major PATCHed minor)', async () => {
    const id = t.ncrs['major-closed'];
    if ((await ncrRow(t, id))?.status !== 'closed') throw probeSetup('KA.Q5.F8.severityDowngrade', 'major-closed is not closed');
    const pa = await send('quality', 'PATCH', `${t.P}/ncr/${id}`, { severity: 'minor' });
    const score = (await dashboardOf(t.P)).qualityScore ?? null;
    const sev = (await ncrRow(t, id))?.severity ?? null;
    if (sev === 'minor') {
      const back = await send('quality', 'PATCH', `${t.P}/ncr/${id}`, { severity: 'major' });
      if (back.status !== 200) throw probeSetup('KA.Q5.F8.severityDowngrade', `the severity could not be put back (${h.said(back)})`);
    }
    const o = { said: h.said(pa), status: pa.status, score };
    const L = WP8.quality.severityDowngradeProbe;
    obs.severityDowngrade = { ...o, severityAfterPatch: sev };
    ka('KA.Q5.F8.severityDowngrade', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-Q5'].severityAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'updateNcr leaves severity editable while the status is unchanged (ncr.service.js:348-362)' });
  });
  await probe('KA.Q4.F8.legacyItpStatus (Q-5: the failed legacy ITP PATCHed passed)', async () => {
    const id = t.itps.failed;
    const pa = await send('quality', 'PATCH', `${t.P}/itp/${id}`, { status: 'passed' });
    const score = (await dashboardOf(t.P)).qualityScore ?? null;
    const row = listOf(await dataOf('quality', `${t.P}/itp`)).find((r) => r.id === id);
    if (row?.status === 'passed') {
      const back = await send('quality', 'PATCH', `${t.P}/itp/${id}`, { status: 'failed', comment: label('restored after the probe') });
      if (back.status !== 200) throw probeSetup('KA.Q4.F8.legacyItpStatus', `the status could not be put back (${h.said(back)})`);
    }
    const o = { said: h.said(pa), status: pa.status, score };
    const L = WP8.quality.legacyItpFailedToPassedProbe;
    obs.legacyItpStatus = { ...o, statusAfterPatch: row?.status ?? null };
    ka('KA.Q4.F8.legacyItpStatus', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-Q4'].itpStatusAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'the legacy ITP route takes any status with no reason (routes/itp.js status isIn; itp.service.js:120-138)' });
  });
};

// -- F8: P-1 .. P-3, punch items and observations (P.F8.*, KA.F3.F8.approverBypass) --------------------------------------
const punchOf = async (t, id) => (await dataOf('pm', `${t.P}/punch/${id}`)) || null;
const transition = (t, who, id, action, reason = null) => send(who, 'POST', `${t.P}/punch/${id}/transition`, { action, ...(reason ? { reason: label(reason) } : {}) });
const createPunch = async (t, key, kind, extra = {}) => {
  const res = await send(kind === 'observation' ? 'quality' : 'site', 'POST', `${t.P}/punch`, { title: label(`${kind} ${key}`), description: label('found on the walk-round'), kind, priority: 'normal', activityId: t.acts['F8-A1'], assigneeUserId: ctx.people.site, managerUserId: ctx.people[F8B.punchMix.manager], ...(kind === 'punch' ? { finalApproverUserId: ctx.people[F8B.punchMix.finalApprover], trade: 'Finishes' } : {}), dueDate: runDay('R+14'), ...extra });
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  need(Boolean(id), `${kind} ${key} could not be created (${h.said(res)} ${res.body?.error?.message || ''})`);
  return id;
};
const step = async (t, who, id, action, target, reason = null) => {
  const res = await transition(t, who, id, action, reason);
  need(res.status === 200 && (await punchOf(t, id))?.status === target, `punch ${id}: ${action} by ${who} did not reach ${target} (${h.said(res)})`);
};
const f8Punch = async () => {
  const t = ctx.f8;
  t.punch = {};
  // P-1: the punch mix (the closed one through the final-approver gate) and the observation mix
  for (const [state, n] of Object.entries(F8B.punchMix.punch)) {
    for (let i = 1; i <= n; i += 1) {
      const key = `${state}-${i}`;
      const id = await createPunch(t, key, 'punch');
      t.punch[key] = id;
      if (state === 'draft') continue;
      await step(t, 'site', id, 'open', 'open');
      if (state === 'open') continue;
      if (state === 'void') { await step(t, 'quality', id, 'void', 'void', 'duplicate'); continue; }
      if (state === 'in_dispute') { await step(t, 'site', id, 'dispute', 'in_dispute', 'outside the subcontract'); continue; }
      await step(t, 'site', id, 'ready_for_review', 'ready_for_review');
      if (state === 'ready_for_review') continue;
      // closed: the PM is not the final approver (P.F8.closeByNonApprover); the quality engineer closes only while it is still ready
      const pmClose = await transition(t, 'pm', id, 'close');
      const afterPm = (await punchOf(t, id))?.status ?? null;
      let qualityClose = 'not sent (no longer ready_for_review)';
      if (afterPm === 'ready_for_review') {
        const qc = await transition(t, 'quality', id, 'close');
        qualityClose = h.said(qc);
      }
      const finalStatus = (await punchOf(t, id))?.status ?? null;
      const o = { pmClose: h.said(pmClose), afterPm, qualityClose, finalStatus };
      const e = { pmClose: WP8.punch.closeByNonApprover.value, afterPm: 'ready_for_review', qualityClose: '200', finalStatus: 'closed' };
      rec('P.F8.closeByNonApprover', sameJson(o, e), { expected: e, observed: o, detail: 'transitionPunchItem refuses a close by anyone but the final approver (punch.service.js:562-564; M-PFA: the PM\'s close 200)' });
      need(finalStatus === 'closed', 'P-1: the item destined closed is not closed');
    }
  }
  t.observations = {};
  for (const [type, target] of Object.entries(F8B.punchMix.observations)) {
    const id = await createPunch(t, type, 'observation', { observationType: type, priority: type === 'safety' ? 'urgent' : 'normal' });
    t.observations[type] = id;
    if (target === 'draft') continue;
    await step(t, 'site', id, 'open', 'open');
    if (target === 'void') await step(t, 'pm', id, 'void', 'void', 'raised twice');
    if (target === 'closed') await step(t, 'pm', id, 'close', 'closed', 'made safe');
  }
  // P-2: the dashboard, the open items without drafts, and the transition table as the PM
  const m = await dashboardOf(t.P);
  const states = await Promise.all(Object.values(t.punch).map(async (id) => (await punchOf(t, id))?.status ?? null));
  const om = { openDefects: m.openDefects ?? null, openDefectsWithoutDrafts: states.filter((s) => ['open', 'ready_for_review', 'in_dispute'].includes(s)).length, observationsOpen: m.observationsOpen ?? null, safetyObservationsOpen: m.safetyObservationsOpen ?? null };
  const em = { openDefects: WP8.punch.openDefects.value, openDefectsWithoutDrafts: WP8.punch.openDefectsWithoutDrafts.value, observationsOpen: WP8.punch.openObservations.value, safetyObservationsOpen: WP8.punch.safetyObservationsOpen.value };
  rec('P.F8.mix', sameJson(om, em), { expected: em, observed: { ...om, states }, detail: 'the dashboard counts punch items not closed or void, drafts included (quality.service.js:27-31, :53-65)' });
  const itemIn = Object.fromEntries(PUNCH_STATES.map((s) => [s, Object.entries(t.punch).find(([k]) => k.startsWith(`${s}-`))?.[1] || null]));
  const answers = [];
  for (const [action, row] of Object.entries(PUNCH_TABLE)) {
    for (const [from, cell] of Object.entries(row)) {
      if (cell === 'ok') continue;
      const res = await transition(t, 'pm', itemIn[from], action);
      const want = cell.startsWith('409') ? cell : cell.split('; ')[1].replace(' without', '');
      answers.push({ action, from, said: h.said(res), want });
    }
  }
  const after = await Promise.all(PUNCH_STATES.map(async (s) => (await punchOf(t, itemIn[s]))?.status ?? null));
  const wrong = answers.filter((a) => a.said !== a.want);
  const ot = { sent: answers.length, illegal409: answers.filter((a) => a.want.startsWith('409') && a.said === a.want).length, reason400: answers.filter((a) => a.want.startsWith('400') && a.said === a.want).length, statesUnchanged: sameJson(after, PUNCH_STATES), wrong };
  const et = { sent: WP8.punch.illegalTransitions.value + WP8.punch.reasonRequiredPairs.value, illegal409: WP8.punch.illegalTransitions.value, reason400: WP8.punch.reasonRequiredPairs.value, statesUnchanged: true, wrong: [] };
  rec('P.F8.transitionTable', sameJson(ot, et), { expected: et, observed: ot, detail: 'TRANSITION_RULES (punch.service.js:541-549): 409 before the reason check (:557-561); the PM holds every punch transition (RJ-10)' });
  // P-3: a new open item, the PM set as final approver by the site engineer, closed by the PM (HR-F3)
  await probe('KA.F3.F8.approverBypass (P-3: the final approver reassigned by the site engineer)', async () => {
    const id = await createPunch(t, 'bypass', 'punch');
    await step(t, 'site', id, 'open', 'open');
    const pa = await send('site', 'PATCH', `${t.P}/punch/${id}`, { finalApproverUserId: ctx.people.pm });
    const close = await transition(t, 'pm', id, 'close');
    const row = await punchOf(t, id);
    const o = { patch: is2xx(pa.status) ? pa.status : { refused: true, said: h.said(pa) }, close: close.status === 200 ? `200 ${row?.status}` : h.said(close) };
    const L = WP8.punch.finalApproverBypass;
    const answer = CONTRACT['HR-F3'].reassignAnswer;
    const isValue = (x) => typeof x.patch === 'object' && x.patch.refused === true && (answer ? x.patch.said === answer : !NOT_THE_RULE.test(x.patch.said)) && x.close === L.value.close;
    obs.approverBypass = { ...o, finalApprover: row?.finalApproverUserId === ctx.people.pm ? 'pm' : row?.finalApproverUserId === ctx.people.quality ? 'quality' : row?.finalApproverUserId ?? null };
    ka('KA.F3.F8.approverBypass', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, isValue, (x) => sameJson(x, L.today)), detail: 'updatePunchItem locks closed and void items only (punch.service.js:497-499): finalApproverUserId is editable on an open item' });
  });
};

// -- F8: SF-1 .. SF-4, safety (KA.SAFE.F8.health, SF.F8.*, KA.Q5.F8.ltiEdit) ---------------------------------------------
const safetyRows = async (t) => listOf(await dataOf('quality', `${t.P}/safety?includeArchived=true`));
const raiseIncident = async (t, ref, b, extra = {}) => {
  const res = await send('site', 'POST', `${t.P}/safety`, { incidentType: FIXTURE.incidentType[b.type], title: label(`${b.type} ${ref}`), date: runDay('R-4'), ...(b.activity ? { activityId: t.acts[b.activity] } : {}), responsible: label('site supervisor'), investigation: label('statements taken'), severity: 'medium', dueDate: runDay('R+7'), lostDays: b.lostDays || 0, status: 'open', comment: label('reported the same shift'), ...extra });
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  need(Boolean(id), `safety ${ref} could not be raised (${h.said(res)} ${res.body?.error?.message || ''})`);
  return id;
};
const f8Safety = async () => {
  const t = ctx.f8;
  t.safety = {};
  // SF-1: the near miss open, the LTI closed out and approved, a near miss archived by the PM's DELETE
  for (const b of F8B.safetySet.incidents) {
    const id = await raiseIncident(t, b.ref, b);
    t.safety[b.ref] = id;
    if (b.status === 'closed') {
      const co = await send('site', 'POST', `${t.P}/safety/${id}/close`, { closureComment: label('corrective actions in place'), responsible: label('site supervisor'), dueDate: runDay('R+7'), attachmentRefs: [await evidence(t, `safety ${b.ref}`)] });
      const ap = co.status === 200 ? await send('quality', 'POST', `${t.P}/safety/${id}/approve`, { comment: label('closed out') }) : null;
      need(ap?.status === 200, `${b.ref} could not be closed (${h.said(co)}, ${ap ? h.said(ap) : 'not sent'})`);
    }
    if (b.status === 'archived') {
      const del = await send('pm', 'DELETE', `${t.P}/safety/${id}`);
      need(del.status === 200, `${b.ref} could not be archived (${h.said(del)})`);
    }
    need((await safetyRows(t)).find((r) => r.id === id)?.status === b.status, `${b.ref} is not ${b.status}`);
  }
  // SF-2: the health card, the workspace and the dashboard
  await probe('KA.SAFE.F8.health (SF-2: the health card with an archived incident)', async () => {
    const d = await healthDim(t.P, 'safety');
    if (!d) throw probeSetup('KA.SAFE.F8.health', 'the health card has no safety dimension');
    const L = WP8.safety.health;
    const o = { score: d.score, openInvestigations: d.detail.openInvestigations ?? null };
    const live = F8B.safetySet.incidents.filter((i) => i.status !== 'archived' && i.status !== 'closed').length;
    const all = F8B.safetySet.incidents.filter((i) => i.status !== 'closed').length;
    obs.safetyF8 = o;
    ka('KA.SAFE.F8.health', { ref: L.ref, value: { score: L.value, openInvestigations: live }, today: { score: L.today, openInvestigations: all }, observed: o, verdict: judge(o, (x) => sameJson(x, { score: L.value, openInvestigations: live }), (x) => sameJson(x, { score: L.today, openInvestigations: all })), detail: 'health.js reads every incident (:171-173) and counts status != closed as open (:455-457)' });
  });
  await probe('SF.F8.workspace (SF-2: the workspace row of F8)', async () => {
    const w = await workspaceRow(t.id);
    if (!w) throw probeSetup('SF.F8.workspace', 'F8 is not among the rows the workspace dashboard answers the PM or the site engineer');
    rec('SF.F8.workspace', w.row.dimensions?.safety === WP8.safety.workspace.value, { expected: WP8.safety.workspace.value, observed: { safety: w.row.dimensions?.safety ?? null, persona: w.persona }, detail: 'archivedAt: null (workspace-dashboard.service.js:830, :1155-1166)' });
    obs.safetyWorkspaceF8 = w.row.dimensions?.safety ?? null;
  });
  const m = await dashboardOf(t.P);
  const om = { safetyIncidents: m.safetyIncidents ?? null, safetyOpen: m.safetyOpen ?? null };
  const em = { safetyIncidents: WP8.safety.dashboardIncidents.value, safetyOpen: WP8.safety.dashboardOpen.value };
  rec('SF.F8.dashboard', sameJson(om, em), { expected: em, observed: om, detail: 'live() drops archived and void (quality.service.js:38; M-ARCH: 3 / 2)' });
  obs.safetyDashboardF8 = om;
  // SF-3: the closed LTI's lost days 3 -> 5 (HR-Q5)
  await probe('KA.Q5.F8.ltiEdit (SF-3: lost days edited after closure)', async () => {
    const id = t.safety['SF-LTI'];
    const before = (await safetyRows(t)).find((r) => r.id === id);
    if (before?.status !== 'closed') throw probeSetup('KA.Q5.F8.ltiEdit', 'the LTI is not closed');
    const pa = await send('site', 'PATCH', `${t.P}/safety/${id}`, { lostDays: F8B.safetySet.ltiEditTo });
    const after = (await safetyRows(t)).find((r) => r.id === id);
    const o = { said: h.said(pa), status: pa.status, lostDays: nullableNumber(after?.lostDays) };
    const L = WP8.safety.ltiEditAfterClosure;
    ka('KA.Q5.F8.ltiEdit', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-Q5'].lostDaysAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'updateSafetyIncident keeps lostDays editable after closure (safety.service.js:387-390); lost days enter no score' });
  });
  // SF-4: a fatality, open
  const fat = F8B.safetySet.fatality;
  await raiseIncident(t, fat.ref, { type: 'fatality', activity: 'F8-A3' });
  const d = await healthDim(t.P, 'safety');
  rec('SF.F8.fatality', d?.score === WP8.safety.fatality.value, { expected: WP8.safety.fatality.value, observed: d ? { score: d.score, detail: d.detail } : null, detail: 'any fatality: 100 - 100 - ... clamped to 0 (health.js:458-460), under either archived reading' });
};

// -- F8: R-1 .. R-4, RFIs (KA.RFI.F8.officialAfterClose, R.F8.*, KA.K1.F8.rfiOverdueHealth) -----------------------------------
const rfiOf = async (t, id, who = 'pm') => dataOf(who, `${t.P}/rfi/${id}`);
const raiseRfi = async (t, key, extra) => {
  const res = await send('site', 'POST', `${t.P}/rfi`, { subject: label(`RFI ${key}`), question: label(`please confirm ${key}`), priority: 'normal', discipline: 'structural', managerUserId: ctx.people.pm, assigneeUserIds: [ctx.people.planner], status: 'open', raisedDate: runDay('R-10'), ...extra });
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  need(Boolean(id), `${key} could not be raised (${h.said(res)} ${res.body?.error?.message || ''})`);
  return id;
};
const f8Rfis = async () => {
  const t = ctx.f8;
  t.rfis = {};
  const B = F8B.rfis;
  // R-1: RFI-C answered by the planner and approved by the PM (closed); its schedule-impact link
  const c = B['RFI-C'];
  const idC = await raiseRfi(t, 'RFI-C', { activityId: t.acts[c.activity], scheduleImpactFlag: c.scheduleImpactFlag, scheduleImpact: c.scheduleImpact, dueDate: FIXTURE.rfiC.dueDate });
  t.rfis['RFI-C'] = idC;
  const an = await send(c.answeredBy, 'POST', `${t.P}/rfi/${idC}/answer`, { response: label('the official answer'), answeredDate: runDay('R-2') });
  const ap = an.status === 200 ? await send(c.approvedBy, 'POST', `${t.P}/rfi/${idC}/approve`, { comment: label('answer accepted') }) : null;
  need(ap?.status === 200 && (await rfiOf(t, idC))?.status === c.status, `RFI-C could not be closed (${h.said(an)}, ${ap ? h.said(ap) : 'not sent'})`);
  const links = await linkOf('rfi', idC, 'schedule_impact');
  const ol = { links: links.length, activity: links[0]?.activityId === t.acts[c.activity] ? c.activity : links[0]?.activityId ?? null, days: links[0] ? Number(links[0].days) : null };
  const el = { links: 1, activity: c.activity, days: WP8.rfi.scheduleImpactLink.value };
  rec('R.F8.scheduleImpact', sameJson(ol, el), { expected: el, observed: ol, detail: 'applyScheduleImpact on the approval (rfi-workflow.service.js:415-426)' });
  // R-2: the official answer rewritten by both paths (RFI-RESP-1)
  await probe('KA.RFI.F8.officialAfterClose (R-2: a closed RFI\'s official answer rewritten)', async () => {
    const before = await rfiOf(t, idC);
    const official = before?.officialResponse;
    if (before?.status !== 'closed' || !official?.id) throw probeSetup('KA.RFI.F8.officialAfterClose', `RFI-C is ${before?.status} with official response ${official?.id || 'none'}`);
    const original = before.response;
    const pa = await send('pm', 'PATCH', `${t.P}/rfi/${idC}/responses/${official.id}`, { body: label(FIXTURE.rewrittenAnswerA) });
    const mid = await rfiOf(t, idC);
    const pb = await send('pm', 'PATCH', `${t.P}/rfi/${idC}`, { response: label(FIXTURE.rewrittenAnswerB) });
    const after = await rfiOf(t, idC);
    const kept = (after?.responses || []).some((r) => r.body === original) || after?.response === original;
    const o = { responsesPath: is2xx(pa.status) ? pa.status : h.said(pa), recordPath: is2xx(pb.status) ? pb.status : h.said(pb), officialAnswer: after?.response === original && after?.status === 'closed' ? 'unchanged' : kept ? 'rewritten, the previous text kept' : 'rewritten, the previous text kept nowhere' };
    const L = WP8.rfi.officialResponsePaths;
    const frozen = CONTRACT['RFI-RESP-1'].frozenAnswer;
    const isValue = (x) => [x.responsesPath, x.recordPath].every((s) => typeof s === 'string' && !is2xx(saidParts(s).status) && (frozen ? s === frozen : saidParts(s).status === saidParts(L.value.responsesPath).status && !NOT_THE_RULE.test(s))) && x.officialAnswer === L.value.officialAnswer;
    obs.rfiResp = { ...o, original: original ? 'set' : null, midResponse: mid?.response === original ? 'unchanged' : 'rewritten', audit: 'response: "edited" only (static)' };
    ka('KA.RFI.F8.officialAfterClose', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, isValue, (x) => sameJson(x, L.today)), detail: `updateResponse checks no status (rfi-workflow.service.js:324-348); assertDirectRfiChange guards only the impact fields on a closed RFI (rfi.service.js:265-270); CONTRACT ${frozen || 'pending (the book assumes 409 RFI_ALREADY_CLOSED)'}` });
  });
  // R-3: reopen with no reason, then with one
  const r0 = (await rfiOf(t, idC))?.revision ?? null;
  const rn = await send('pm', 'POST', `${t.P}/rfi/${idC}/reopen`, {});
  const stn = (await rfiOf(t, idC))?.status ?? null;
  rec('R.F8.reopenWithoutReason', h.is(rn, WP8.rfi.reopenWithoutReason.value) && fieldsOf(rn).includes('reason') && stn === 'closed', { expected: { said: WP8.rfi.reopenWithoutReason.value, field: 'reason', status: 'closed' }, observed: { said: h.said(rn), fields: fieldsOf(rn), status: stn }, detail: 'the route\'s reason notEmpty (routes/rfi.js:437)' });
  const rr = await send('pm', 'POST', `${t.P}/rfi/${idC}/reopen`, { reason: label('the answer needs revisiting') });
  const after = await rfiOf(t, idC);
  const orr = { said: h.said(rr), status: after?.status ?? null, revisionDelta: after?.revision !== undefined && r0 !== null ? Number(after.revision) - Number(r0) : null };
  rec('R.F8.reopenRevision', sameJson(orr, { said: '200', status: 'open', revisionDelta: numbersIn(WP8.rfi.reopenRevision.value)[0] }), { expected: { said: '200', status: 'open', revision: WP8.rfi.reopenRevision.value }, observed: { ...orr, from: r0, to: after?.revision ?? null }, detail: 'reopenRfi bumps the revision (rfi.service.js:864-894)' });
  // R-4: the overdue bases: the baseline, RFI-RRB, then RFI-ANS (no submittal change between the reads)
  await probe('KA.K1.F8.rfiOverdueHealth and R.F8.overdueSurfaces (R-4: the overdue bases)', async () => {
    const read = async () => {
      const d = await healthDim(t.P, 'docControl');
      const w = await workspaceRow(t.id);
      if (!d) throw probeSetup('KA.K1.F8.rfiOverdueHealth', 'the health card has no docControl dimension');
      if (!w) throw probeSetup('R.F8.overdueSurfaces', 'F8 is not among the rows the workspace dashboard answers the PM or the site engineer');
      return { health: d.detail.overdueRfis ?? null, workspace: w.row.dimensions?.docControl ?? null };
    };
    const base = await read();
    const rb = B['RFI-RRB'];
    t.rfis['RFI-RRB'] = await raiseRfi(t, 'RFI-RRB', { responseRequiredBy: runDay(rb.responseRequiredBy), dueDate: rb.dueDate });
    const afterRrb = await read();
    const ab = B['RFI-ANS'];
    t.rfis['RFI-ANS'] = await raiseRfi(t, 'RFI-ANS', { dueDate: runDay(ab.dueDate), responseRequiredBy: ab.responseRequiredBy });
    const ansAnswer = await send('planner', 'POST', `${t.P}/rfi/${t.rfis['RFI-ANS']}/answer`, { response: label('answered late'), answeredDate: runDay('R-1') });
    if (ansAnswer.status !== 200 || (await rfiOf(t, t.rfis['RFI-ANS']))?.status !== ab.status) throw probeSetup('KA.K1.F8.rfiOverdueHealth', `RFI-ANS could not be answered (${h.said(ansAnswer)})`);
    const afterAns = await read();
    const deltas = { afterRRB: afterRrb.health - base.health, afterANS: afterAns.health - afterRrb.health };
    obs.overdueF8 = { base, afterRrb, afterAns, deltas };
    kaLeaf('KA.K1.F8.rfiOverdueHealth', WP8.rfi.overdueHealthF8, deltas, { detail: `health counts by dueDate only, answered included (health.js:462-465); readings ${json({ base, afterRrb, afterAns })}` });
    const detail = { 'RFI-RRB': (await rfiOf(t, t.rfis['RFI-RRB']))?.isOverdue ?? null, 'RFI-ANS': (await rfiOf(t, t.rfis['RFI-ANS']))?.isOverdue ?? null };
    const listed = listOf(await dataOf('pm', `${t.P}/rfi?overdue=true&limit=100`)).map((r) => r.id);
    const list = { 'RFI-RRB': listed.includes(t.rfis['RFI-RRB']), 'RFI-ANS': listed.includes(t.rfis['RFI-ANS']) };
    const os = { detail, list, workspace: { afterRRB: afterRrb.workspace - base.workspace, afterANS: afterAns.workspace - afterRrb.workspace } };
    const es = { detail: WP8.rfi.overdueDetail.value, list: WP8.rfi.overdueListFilter.value, workspace: WP8.rfi.overdueWorkspaceF8.value };
    rec('R.F8.overdueSurfaces', sameJson(os, es), { expected: es, observed: os, detail: 'the detail and the list read responseRequiredBy || dueDate (rfi-workflow.service.js:196-200); the workspace does too, answered not overdue (workspace-dashboard.service.js:1168-1175)' });
  });
};

// -- F8: SUB-1 .. SUB-4, submittals (SUB.F8.*, KA.F1.F8.pmApproveWhilePending) -------------------------------------------
const submittalOf = async (t, id, who = 'pm') => dataOf(who, `${t.P}/submittals/${id}`);
const roleToPersona = (role) => F8B.team.roles[role] || null;
const uploadRevision = async (t, who, recordType, recordId, revision, fields = {}) => {
  const res = await upload(who, `${t.P}/doc-control/${recordType}/${recordId}/revisions/upload`, pdf(`${recordType} ${revision} ${h.STAMP}`, fileName(`${recordType} rev ${revision}`)), { revision, title: label(`${recordType} rev ${revision}`), ...fields });
  const rev = res.body?.data?.revision || null;
  need(res.status === 201 && Boolean(rev?.id), `${recordType} ${recordId}: revision ${revision} could not be uploaded by ${who} (${h.said(res)} ${res.body?.error?.message || ''})`);
  return { id: rev.id, documentId: rev.projectDocumentId || res.body?.data?.document?.documentId || null, isLatest: rev.isLatest ?? null, status: rev.status ?? null };
};
const makeSubmittal = async (t, key, b, extra = {}) => {
  const res = await send('site', 'POST', `${t.P}/submittals`, { title: label(`submittal ${key}`), specRef: '03 30 00', discipline: 'structural', activityId: t.acts[b.activity || 'F8-A1'], managerUserId: ctx.people.pm, distributionUserIds: [ctx.people.qs], ...(b.leadTimeWeeks !== undefined ? { leadTimeWeeks: b.leadTimeWeeks } : {}), ...(b.requiredOnSite ? { requiredOnSite: /^R/.test(b.requiredOnSite) ? runDay(b.requiredOnSite) : b.requiredOnSite } : {}), ...(b.template ? { workflowTemplateId: t.template } : {}), comment: label('for approval'), ...extra });
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  need(Boolean(id), `submittal ${key} could not be created (${h.said(res)} ${res.body?.error?.message || ''})`);
  return { id, data: res.body.data };
};
const submitSubmittal = async (t, s, key) => {
  await uploadRevision(t, 'site', 'submittal', s.id, FIXTURE.submittalRevision);
  const sb = await send('site', 'POST', `${t.P}/submittals/${s.id}/submit`, { comment: label(`${key} submitted for review`) });
  need(sb.status === 200 && (await submittalOf(t, s.id))?.status === 'under_review', `submittal ${key} could not be submitted (${h.said(sb)})`);
};
const f8Submittals = async () => {
  const t = ctx.f8;
  const B = F8B.submittals;
  t.submittals = {};
  // SUB-1: T8, SUB-D direct and SUB-T on T8
  const tpl = await send('planner', 'POST', `${t.P}/submittals/workflow-templates`, { name: label('T8 QS then planner'), description: label('two sequential steps'), isDefault: false, steps: B.T8.steps.map(([role, days], i) => ({ name: label(`step ${i + 1} ${role}`), mode: 'sequential', days, assignees: [{ type: 'user', userId: ctx.people[roleToPersona(role)] }] })) });
  t.template = tpl.status === 201 ? tpl.body?.data?.id || null : null;
  need(Boolean(t.template), `T8 could not be created (${h.said(tpl)} ${tpl.body?.error?.message || ''})`);
  const sd = await makeSubmittal(t, 'SUB-D', B['SUB-D']);
  const st = await makeSubmittal(t, 'SUB-T', B['SUB-T']);
  t.submittals['SUB-D'] = sd.id;
  t.submittals['SUB-T'] = st.id;
  const ob = { templated: dayOf((await submittalOf(t, st.id))?.submitBy), direct: dayOf((await submittalOf(t, sd.id))?.submitBy) };
  const eb = { templated: WP8.submittal.submitByTemplated.value, direct: WP8.submittal.submitByDirect.value };
  rec('SUB.F8.submitBy', sameJson(ob, eb), { expected: eb, observed: ob, detail: `computeSubmitBy = requiredOnSite - lead x 7 - review days (submittal-workflow.service.js:253-260); ${WP8.submittal.template.value} (M-RD: 2027-01-11)` });
  // SUB-2: SUB-T submitted (step 1 active); the PM approves (HR-F1)
  await probe('KA.F1.F8.pmApproveWhilePending (SUB-2: the PM approves while steps pend)', async () => {
    await submitSubmittal(t, { id: st.id }, 'SUB-T');
    const before = await submittalOf(t, st.id);
    const revision = before?.revisionNumber || 0;
    const active = listOf(before?.reviewSteps).filter((s) => (s.revisionNumber || 0) === revision && s.status === 'active');
    if (active.length !== 1) throw probeSetup('KA.F1.F8.pmApproveWhilePending', `SUB-T has ${active.length} active steps after its submission`);
    const ap = await send('pm', 'POST', `${t.P}/submittals/${st.id}/approve`, { comment: label('approved by the PM') });
    const after = await submittalOf(t, st.id);
    const undecided = listOf(after?.reviewSteps).filter((s) => (s.revisionNumber || 0) === revision && !['approved', 'rejected'].includes(s.status)).length;
    const o = { said: h.said(ap), status: ap.status, submittalApproved: after?.status === 'approved', stepsLeftUndecided: undecided };
    const L = WP8.submittal.pmApprovalWhileStepsPending;
    obs.pmApproveWhilePending = { ...o, steps: listOf(after?.reviewSteps).map((s) => [s.sortOrder, s.status]) };
    ka('KA.F1.F8.pmApproveWhilePending', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F1'].pendingApproveAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'approveSubmittal checks the status only (submittal.service.js:925-966); onStatusChange skips the pending and active steps (submittal-workflow.service.js:471-472)' });
  });
  // SUB-3: SUB-R on T8, returned revise_resubmit by the QS, resubmitted
  const sr = await makeSubmittal(t, 'SUB-R', B['SUB-R'], { workflowTemplateId: t.template });
  t.submittals['SUB-R'] = sr.id;
  await submitSubmittal(t, sr, 'SUB-R');
  const r0 = (await submittalOf(t, sr.id))?.revisionNumber || 0;
  const dc = await send('qs', 'POST', `${t.P}/submittals/${sr.id}/decide`, { decision: 'reject', responseCode: 'revise_resubmit', comment: label('revise the mix design and resubmit') });
  const mid = await submittalOf(t, sr.id);
  need(dc.status === 200 && mid?.status === 'resubmit' && mid?.responseCode === 'revise_resubmit', `SUB-R could not be returned revise_resubmit (${h.said(dc)}, ${mid?.status}, ${mid?.responseCode})`);
  const rs = await send('site', 'POST', `${t.P}/submittals/${sr.id}/resubmit`, { comment: label('resubmitted with the revised mix') });
  const after = await submittalOf(t, sr.id);
  const orc = { said: h.said(rs), status: after?.status ?? null, revisionDelta: (after?.revisionNumber || 0) - r0, responseCode: after?.responseCode ?? null, responseCodeLabel: after?.responseCodeLabel ?? null };
  const erc = { said: '200', status: 'under_review', revisionDelta: 1, responseCode: WP8.submittal.responseCodeResetOnNewCycle.value, responseCodeLabel: WP8.submittal.responseCodeResetOnNewCycle.value };
  rec('SUB.F8.responseCodeReset', sameJson(orc, erc), { expected: erc, observed: orc, detail: 'onStatusChange opens a new cycle with no outcome (submittal-workflow.service.js:447-453, :466-470)' });
  // SUB-4: SUB-I direct, approved by the PM; the impact over its observed reviewedOn and the lead-time link
  const si = await makeSubmittal(t, 'SUB-I', B['SUB-I']);
  t.submittals['SUB-I'] = si.id;
  await submitSubmittal(t, si, 'SUB-I');
  const ai = await send('pm', 'POST', `${t.P}/submittals/${si.id}/approve`, { comment: label('approved') });
  const ri = await submittalOf(t, si.id);
  need(ai.status === 200 && ri?.status === 'approved' && Boolean(ri?.reviewedOn), `SUB-I could not be approved (${h.said(ai)}, ${ri?.status})`);
  const I = F8B.submittalImpact;
  const reviewedOn = new Date(ri.reviewedOn).toISOString();
  const expectedDays = RULESET.submittalImpactDays({ approvedAtIso: reviewedOn, needByIso: runDay(I.needBy), leadTimeWeeks: I.leadTimeWeeks });
  const links = await linkOf('submittal', si.id, 'submittal_lead_time');
  const oi = { scheduleImpactDays: ri.scheduleImpactDays ?? null, link: links.length ? { activity: links[0].activityId === t.acts[B['SUB-I'].activity] ? B['SUB-I'].activity : links[0].activityId, days: Number(links[0].days) } : null };
  const ei = { scheduleImpactDays: expectedDays, link: expectedDays > 0 ? { activity: B['SUB-I'].activity, days: expectedDays } : null };
  obs.submittalImpact = { reviewedOn, needBy: runDay(I.needBy), expectedDays, bookExample: WP8.submittal.impactDaysExample.value };
  rec('SUB.F8.impactDays', sameJson(oi, ei), { expected: ei, observed: { ...oi, reviewedOn }, detail: `${WP8.submittal.impactDaysRule.value} over the observed reviewedOn (submittal-workflow.service.js:263-270, :419-430); ${I.link}` });
};

// -- F8: D-1 .. D-3, drawings (D.F8.*, KA.F2.F8.*) -------------------------------------------------------------------------
const registerRow = async (t, recordType, recordId, who = 'pm') => listOf(await dataOf(who, `${t.P}/doc-control/register?recordType=${recordType}`)).find((row) => row.recordId === recordId) || null;
const revisionsOf = async (t, drawingId, who = 'pm') => listOf((await registerRow(t, 'drawing', drawingId, who))?.revisions);
const revByLabel = (revs, code) => revs.find((r) => r.revision === code) || null;
const makeDrawing = async (t, number) => {
  const res = await send('planner', 'POST', `${t.P}/drawings`, { drawingNumber: number, title: label(`drawing ${number}`), status: 'active', activityId: t.acts['F8-A1'], activityIds: [t.acts['F8-A1']], issueDate: runDay('R-20'), comment: label('registered') });
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  need(Boolean(id), `drawing ${number} could not be registered (${h.said(res)} ${res.body?.error?.message || ''})`);
  return id;
};
const review = async (t, revId) => { const r = await send('site', 'POST', `${t.P}/doc-control/revisions/${revId}/submit-review`, { comment: label('for review') }); need(r.status === 200, `revision ${revId}: submit-review answered ${h.said(r)}`); };
const approveRev = (t, revId) => send('pm', 'POST', `${t.P}/doc-control/revisions/${revId}/approve`, { comment: label('approved for construction') });
const f8Drawings = async () => {
  const t = ctx.f8;
  t.drawings = {};
  // D-1: F8-S1 A, B, C and X8; the storeman's register
  const s1 = await makeDrawing(t, 'F8-S1');
  t.drawings['F8-S1'] = { id: s1, revs: {} };
  for (const code of ['A', 'B', 'C']) t.drawings['F8-S1'].revs[code] = await uploadRevision(t, 'site', 'drawing', s1, code, { documentNumber: 'F8-S1' });
  for (const code of ['A', 'B']) {
    await review(t, t.drawings['F8-S1'].revs[code].id);
    const ap = await approveRev(t, t.drawings['F8-S1'].revs[code].id);
    need(ap.status === 200, `F8-S1 rev ${code} could not be approved (${h.said(ap)})`);
  }
  const X = FIXTURE.drawingFixtureLabel;
  t.drawings['F8-S1'].revs[X] = await uploadRevision(t, F8B.drawings['F8-S1'][X].filedBy, 'drawing', s1, X, { status: 'approved', documentNumber: 'F8-S1', notes: label('current-only fixture (adjudication F4)') });
  const revs = await revisionsOf(t, s1);
  const state = Object.fromEntries(['A', 'B', 'C', X].map((code) => { const r = revByLabel(revs, code); return [code, r ? { status: r.status === 'superseded' || r.supersededAt ? 'superseded' : r.status, latest: Boolean(r.isLatest) } : null]; }));
  const want = Object.fromEntries(Object.entries(F8B.drawings['F8-S1']).map(([code, r]) => [code, { status: r.status, latest: r.latest === true }]));
  need(sameJson(state, want), `F8-S1 is not as the book has it before the storeman's read (${json(state)})`);
  const storeman = (await revisionsOf(t, s1, 'storeman')).map((r) => r.revision).sort();
  rec('D.F8.storeman', sameJson(storeman, WP8.drawing.storemanRevisions.value), { expected: WP8.drawing.storemanRevisions.value, observed: { storeman, pmView: state }, detail: `visibleRevisionsForRole: current-only roles see approved and latest (doc-control.service.js:99-108); ${WP8.drawing.currentOnlyFixture.value} (M-LAT: ["B", "X8"])` });
  // D-2: approve the superseded A; supersede C without a reason
  const aA = await approveRev(t, t.drawings['F8-S1'].revs.A.id);
  const revsA = await revisionsOf(t, s1);
  const aState = revByLabel(revsA, 'A');
  rec('D.F8.approveSuperseded', h.is(aA, WP8.drawing.approveSuperseded.value) && (aState?.status === 'superseded' || Boolean(aState?.supersededAt)) && !aState?.isLatest, { expected: { said: WP8.drawing.approveSuperseded.value, A: 'superseded, not latest' }, observed: { said: h.said(aA), A: aState ? { status: aState.status, isLatest: aState.isLatest } : null }, detail: 'approveDocumentRevision refuses a superseded revision (doc-control.service.js:1015-1021)' });
  const sc = await send('pm', 'POST', `${t.P}/doc-control/revisions/${t.drawings['F8-S1'].revs.C.id}/supersede`, {});
  const cState = revByLabel(await revisionsOf(t, s1), 'C');
  rec('D.F8.supersedeWithoutReason', h.is(sc, WP8.drawing.supersedeWithoutReason.value) && fieldsOf(sc).includes('reason') && cState?.status === F8B.drawings['F8-S1'].C.status, { expected: { said: WP8.drawing.supersedeWithoutReason.value, field: 'reason', C: F8B.drawings['F8-S1'].C.status }, observed: { said: h.said(sc), fields: fieldsOf(sc), C: cState?.status ?? null }, detail: 'the supersede route requires a reason (routes/doc-control.js:365-372)' });
  // D-3: F8-S2 A approved without review; B and C reviewed, C approved, then B (HR-F2)
  const s2 = await makeDrawing(t, 'F8-S2');
  t.drawings['F8-S2'] = { id: s2, revs: {} };
  t.drawings['F8-S2'].revs.A = await uploadRevision(t, 'site', 'drawing', s2, 'A', { documentNumber: 'F8-S2' });
  await probe('KA.F2.F8.approveWithoutReview (D-3: F8-S2 rev A approved from upload)', async () => {
    const ap = await approveRev(t, t.drawings['F8-S2'].revs.A.id);
    const r = revByLabel(await revisionsOf(t, s2), 'A');
    if (!r) throw probeSetup('KA.F2.F8.approveWithoutReview', 'F8-S2 rev A is not on the register');
    const o = { said: h.said(ap), status: ap.status, revisionStatus: r.status, latest: Boolean(r.isLatest) };
    const L = WP8.drawing.approveWithoutReview;
    ka('KA.F2.F8.approveWithoutReview', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F2'].noReviewAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'approveDocumentRevision does not require a review (doc-control.service.js:991-1112)' });
  });
  for (const code of ['B', 'C']) {
    t.drawings['F8-S2'].revs[code] = await uploadRevision(t, 'site', 'drawing', s2, code, { documentNumber: 'F8-S2' });
    await review(t, t.drawings['F8-S2'].revs[code].id);
  }
  const apC = await approveRev(t, t.drawings['F8-S2'].revs.C.id);
  need(apC.status === 200 && Boolean(revByLabel(await revisionsOf(t, s2), 'C')?.isLatest), `F8-S2 rev C could not be approved as the latest (${h.said(apC)})`);
  await probe('KA.F2.F8.approveOutOfOrder (D-3: F8-S2 rev B approved after C)', async () => {
    const ap = await approveRev(t, t.drawings['F8-S2'].revs.B.id);
    const revs2 = await revisionsOf(t, s2);
    const latest = revs2.filter((r) => r.status === 'approved' && r.isLatest).map((r) => r.revision);
    const superseded = ['B', 'C'].filter((code) => { const r = revByLabel(revs2, code); return r && (r.status === 'superseded' || Boolean(r.supersededAt)); });
    const o = { said: h.said(ap), status: ap.status, latestApproved: latest.length === 1 ? latest[0] : latest, superseded };
    const L = WP8.drawing.approveOutOfOrder;
    ka('KA.F2.F8.approveOutOfOrder', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F2'].outOfOrderAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'approveDocumentRevision supersedes whatever is latest (doc-control.service.js:1033-1047)' });
  });
};

// -- F8: T-1 .. T-3, the transmittal and correspondence probes (CF.TRN1, CF.L146, CF.DVAL1's transmittal half) -------------
const transmittalsOf = async (t) => listOf(await dataOf('planner', `${t.P}/transmittals`));
const correspondenceOf = async (t) => listOf(await dataOf('planner', `${t.P}/correspondence`));
const transmittalBody = (subject, extra = {}) => ({ subject, sender: label('site office'), recipient: label('subcontractor'), method: 'email', status: 'pending_ack', transmittedOn: runDay('R-2'), comment: label('issued'), ...extra });
/** Whether a stored reference list still carries a malformed storage key (an object, a number or a boolean). */
const malformedKept = (refs) => listOf(refs).some((r) => r && r.storageKey !== undefined && r.storageKey !== null && typeof r.storageKey !== 'string');
/** Whether a reference list names a document of another project (read-only SQL over its document ids). */
const namesForeign = async (projectId, refs) => {
  const ids = listOf(refs).map((r) => r?.documentId).filter((x) => typeof x === 'string');
  if (!ids.length) return false;
  return ((await ctx.q('select count(*)::int as n from "ProjectDocument" where id = any($1::text[]) and "projectId" <> $2', [ids, projectId]))[0]?.n ?? 0) > 0;
};
const f8Transmittals = async () => {
  const t = ctx.f8;
  // T-1: a transmittal and a correspondence citing F8-S1 rev B's stored document (WP8-TRN-1)
  const docB = t.drawings?.['F8-S1']?.revs?.B?.documentId || null;
  need(Boolean(docB), 'T-1: F8-S1 rev B names no stored document');
  const subjT = label('transmittal citing a filed revision');
  const subjC = label('letter citing a filed revision');
  const cite = [{ revision: 'B', projectDocumentId: docB }];
  const tr = await send('planner', 'POST', `${t.P}/transmittals`, transmittalBody(subjT, { revisions: cite }));
  const co = await send('planner', 'POST', `${t.P}/correspondence`, { direction: 'outgoing', type: 'letter', subject: subjC, date: runDay('R-2'), status: 'open', body: label('letter body'), revisions: cite });
  const written = (await transmittalsOf(t)).filter((r) => r.subject === subjT).length + (await correspondenceOf(t)).filter((r) => r.subject === subjC).length;
  obs.trn1 = { transmittal: h.said(tr), correspondence: h.said(co), messages: [tr.body?.error?.message ?? null, co.body?.error?.message ?? null], recordsWritten: written };
  // T-2: a plain transmittal DELETEd; its audit rows (L146)
  const plain = await send('planner', 'POST', `${t.P}/transmittals`, transmittalBody(label('plain transmittal to delete')));
  const pid = plain.status === 201 ? plain.body?.data?.id || null : null;
  need(Boolean(pid), `T-2: the plain transmittal could not be made (${h.said(plain)})`);
  const del = await send('planner', 'DELETE', `${t.P}/transmittals/${pid}`);
  const gone = !(await transmittalsOf(t)).some((r) => r.id === pid) && ((await ctx.q('select count(*)::int as n from "Transmittal" where id = $1', [pid]))[0]?.n ?? 1) === 0;
  obs.l146 = { deleteAnswer: `${h.said(del)}${del.body?.data?.deleted === true ? ' { deleted: true }' : ''}`, rowGone: gone, auditEvents: await auditCount(pid) };
  // T-3: a transmittal with object, number and boolean storage keys (D-VAL-1)
  const refs = FIXTURE.malformedKeys.map((k) => ({ fileName: fileName(`malformed ${k.kind}`), storageKey: k.value }));
  const dv = await send('planner', 'POST', `${t.P}/transmittals`, transmittalBody(label('transmittal with malformed storage keys'), { attachmentRefs: refs }));
  const dvRow = dv.status === 201 ? (await transmittalsOf(t)).find((r) => r.id === dv.body?.data?.id) || dv.body?.data : null;
  obs.dval1 = { ...(obs.dval1 || {}), transmittal: { said: h.said(dv), keptMalformed: dvRow ? malformedKept(dvRow.attachmentRefs || dvRow.attachments) : null, namesForeign: dvRow ? await namesForeign(t.id, dvRow.attachmentRefs || dvRow.attachments) : null } };
};

// -- F8: M-1 .. M-3, meetings (KA.F6.F8.*, CF.HRF6's draft distributed and edit after distribution) -------------------------
const meetingOf = async (t, id) => dataOf('planner', `${t.P}/meetings/${id}`);
const makeMeeting = async (t, key, extra = {}) => {
  const res = await send('planner', 'POST', `${t.P}/meetings`, { title: label(`meeting ${key}`), meetingType: FIXTURE.meetingType, status: 'draft', chairId: ctx.people.pm, scheduledAt: `${runDay('R-3')}T08:00:00.000Z`, location: label('site office'), objective: label('coordination'), attendees: [{ userId: ctx.people.pm, role: 'Chair', attendanceStatus: 'attended', distributionRequired: true }, { userId: ctx.people.planner, role: 'Minutes', attendanceStatus: 'attended', distributionRequired: true }, { userId: ctx.people.site, role: 'Attendee', attendanceStatus: 'attended', distributionRequired: true }], ...extra });
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  need(Boolean(id), `meeting ${key} could not be created (${h.said(res)} ${res.body?.error?.message || ''})`);
  return id;
};
const f8Meetings = async () => {
  const t = ctx.f8;
  t.meetings = {};
  // M-1: M8a PATCHed status distributed (HR-F6)
  t.meetings.M8a = await makeMeeting(t, 'M8a');
  await probe('KA.F6.F8.patchStatus (M-1: a draft meeting PATCHed distributed)', async () => {
    const pa = await send('planner', 'PATCH', `${t.P}/meetings/${t.meetings.M8a}`, { status: 'distributed' });
    const o = { said: h.said(pa), status: pa.status, meetingStatus: (await meetingOf(t, t.meetings.M8a))?.status ?? null };
    const L = WP8.transmittal.distributeBypass;
    ka('KA.F6.F8.patchStatus', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => isRefusal(x, L.value, CONTRACT['HR-F6'].patchStatusAnswer), (x) => sameJson(pick(x, L.today), L.today)), detail: 'the PATCH route takes any status but archived (routes/meetings.js:43-46); updateMeeting has no status check (meeting.service.js:1224-1319)' });
  });
  // M-2: M8b distributed from draft, then PATCHed; its distribution rows
  t.meetings.M8b = await makeMeeting(t, 'M8b');
  const ds = await send('planner', 'POST', `${t.P}/meetings/${t.meetings.M8b}/distribute`, { message: label('minutes attached') });
  const m2 = await meetingOf(t, t.meetings.M8b);
  const rows = listOf(m2?.distributions);
  obs.draftDistributed = { said: h.said(ds), status: ds.status, meetingStatus: m2?.status ?? null, rowsStatus: [...new Set(rows.map((r) => r.status))].join(',') || null, channels: [...new Set(rows.map((r) => r.channel))], rows: rows.length };
  const before = m2?.minutesText ?? null;
  const ed = await send('planner', 'PATCH', `${t.P}/meetings/${t.meetings.M8b}`, { minutesText: label('minutes edited after distribution') });
  const m2b = await meetingOf(t, t.meetings.M8b);
  obs.editAfterDistribution = { said: h.said(ed), status: ed.status, minutesChanged: (m2b?.minutesText ?? null) !== before };
  // M-3: M8c's action items re-sent without their ids (HR-F6)
  const items = F8B.meetings.M8c.items.map((i) => ({ itemNumber: String(i.n), title: label(`action item ${i.n}`), description: label('raised in the meeting'), ownerId: ctx.people[i.owner || 'planner'], priority: 'medium', activityId: t.acts['F8-A1'], dueDate: runDay('R+7'), status: 'open', createTask: i.createTask }));
  t.meetings.M8c = await makeMeeting(t, 'M8c', { actionItems: items });
  await probe('KA.F6.F8.actionItemIdentity and KA.F6.F8.duplicateTask (M-3: items re-sent without ids)', async () => {
    const m3 = await meetingOf(t, t.meetings.M8c);
    const one = listOf(m3?.actionItems).find((a) => String(a.itemNumber) === '1');
    if (!one?.id || !one.taskId) throw probeSetup('KA.F6.F8.actionItemIdentity', `M8c's item 1 has id ${one?.id || 'none'} and task ${one?.taskId || 'none'}`);
    const pa = await send('planner', 'PATCH', `${t.P}/meetings/${t.meetings.M8c}`, { actionItems: items });
    const m3b = await meetingOf(t, t.meetings.M8c);
    const oneAfter = listOf(m3b?.actionItems).find((a) => String(a.itemNumber) === '1');
    const identity = oneAfter?.id === one.id ? WP8.transmittal.actionItemIdentity.value : oneAfter?.id ? WP8.transmittal.actionItemIdentity.today : `no item 1 after the PATCH (${h.said(pa)})`;
    obs.actionItems = { patch: h.said(pa), before: one.id, after: oneAfter?.id ?? null, taskBefore: one.taskId, taskAfter: oneAfter?.taskId ?? null };
    kaLeaf('KA.F6.F8.actionItemIdentity', WP8.transmittal.actionItemIdentity, identity, { detail: 'replaceChildren deletes and re-creates the action items (meeting.service.js:937)' });
    const tasks = await tasksTitled(t.id, items[0].title);
    kaLeaf('KA.F6.F8.duplicateTask', WP8.transmittal.createTaskTasks, tasks, { detail: 'linkActionItemTasks creates a task for every re-created createTask item with no taskId (meeting.service.js:955-997)' });
  });
};

// -- F8: L213, a member's task closed through PATCH without task.close (CF.L213) -----------------------------------------------
const f8L213 = async () => {
  const t = ctx.f8;
  const T = F8B.l213;
  const list = listOf(await dataOf('pm', '/permissions/templates?includeArchived=true'));
  let template = list.find((x) => x.name === T.name && !x.archivedAt) || null;
  let made = false;
  if (!template) {
    const grants = T.grants.map((g) => { const [module, rest] = g.split('|'); const [kind, value] = rest.split(':'); return { module, [kind]: value }; });
    const c = await send('pm', 'POST', '/permissions/templates', { name: T.name, description: 'CERT3 WP8 L213 probe: task:update without task.close (reused across runs, WP8ADJ Q10)', kind: 'internal', baseRole: T.baseRole, grants });
    template = c.status === 201 ? c.body?.data : null;
    made = true;
    need(Boolean(template?.id), `L213: the template could not be created (${h.said(c)} ${c.body?.error?.message || ''})`);
  }
  const qsId = ctx.people.qs;
  const as = await send('pm', 'PUT', `${t.P}/team/${qsId}/permissions`, { templateId: template.id });
  need(as.status === 200, `L213: the template could not be assigned to the QS on F8 (${h.said(as)})`);
  const tk = await send('pm', 'POST', `${t.P}/tasks`, { title: label('L213 task'), description: label('closed through PATCH'), status: 'todo', priority: 'medium', assigneeId: qsId });
  const tid = tk.status === 201 ? tk.body?.data?.id || null : null;
  need(Boolean(tid), `L213: the task could not be created (${h.said(tk)})`);
  const pd = await send('qs', 'PATCH', `${t.P}/tasks/${tid}`, { status: 'done' });
  const read = await dataOf('pm', `${t.P}/tasks/${tid}`);
  const cl = await send('qs', 'POST', `${t.P}/tasks/${tid}/close`, {});
  obs.l213 = { template: { id: template.id, made }, patchDone: `${h.said(pd)}${read?.status === 'done' && read?.closedAt ? ', the task closed (closedAt set)' : `, status ${read?.status}, closedAt ${read?.closedAt ?? null}`}`, closeAction: h.said(cl) };
};

// -- F8: the end (S.F8.archived) --------------------------------------------------------------------------------------------
const f8End = async () => {
  const t = ctx.f8;
  t.cancel = await cancelQueued(t);
  const inactive = [];
  for (const key of F8B.residue.workersSetInactive) {
    if (!t.workers?.[key]) continue;
    const res = await send('site', 'PATCH', `${t.P}/timesheets/workers/${t.workers[key]}`, { status: 'inactive' });
    inactive.push([key, res.body?.data?.status ?? h.said(res)]);
  }
  const a = await archive(t);
  const ok = a?.status === 200 && Boolean(a?.archivedAt) && t.cancel.left === 0 && inactive.length === F8B.residue.workersSetInactive.length && inactive.every(([, s]) => s === 'inactive');
  rec('S.F8.archived', ok, { expected: { archive: 200, archivedAt: true, queuedJobsLeft: 0, workersInactive: F8B.residue.workersSetInactive }, observed: { archive: a, queuedLeft: t.cancel.left, cancelled: t.cancel.cancelled.length, refused: t.cancel.refused, inactive }, detail: `F8 ${t.id}: archived with its records; the L213 template stays company-level and reused (WP8ADJ Q10)` });
};

// -- F8V: V-0 .. V-5 and the end (S.F8V.create, Q.F8V.sixMajor, KA.Q5.F8V.evidenceWiped, KA.X1.F8V.textOnly, KA.Q4.F8V.hardDelete) --
const rowJson = async (table, id) => (await ctx.q(`select to_jsonb(x) as row from "${table}" x where id = $1`, [id]))[0]?.row || null;
const f8vCreate = async () => {
  const t = await makeThrowaway({ pm: 'pm', label: 'F8V', project: F8VB.project, team: F8VB.team });
  ctx.f8v = t;
  t.majors = [];
  for (let i = 1; i <= F8VB.records.majorNcrs; i += 1) t.majors.push(await raiseNcr(t, F8VB.records.raisedBy, `major ${i} of ${F8VB.records.majorNcrs}`, 'major', null));
  const rows = await ncrsOf(t, 'pm');
  const o = { said: h.said(t.created), majors: rows.filter((r) => r.severity === 'major').length, total: rows.length };
  const e = { said: '201', majors: F8VB.records.majorNcrs, total: F8VB.records.majorNcrs };
  const ok = sameJson(o, e) && teamOk(t, F8VB.team);
  rec('S.F8V.create', ok, { expected: { ...e, team: F8VB.team }, observed: { id: t.id, ...o, team: t.members }, detail: 'nothing else on F8V before V-1: its score is 0 throughout' });
  need(ok, 'V-0: F8V, its team or its 6 major NCRs could not be made');
};
const f8vProbes = async () => {
  const t = ctx.f8v;
  // V-1: the clamp
  const m = await dashboardOf(t.P);
  const o1 = { qualityScore: m.qualityScore ?? null, majorNcrs: m.majorNcrs ?? null };
  const e1 = { qualityScore: WP8.quality.sixMajor.value, majorNcrs: F8VB.records.majorNcrs };
  rec('Q.F8V.sixMajor', sameJson(o1, e1), { expected: e1, observed: o1, detail: 'Math.max(0, 100 - 6 x 20) (quality.service.js:48-51; M-CLAMP: -20)' });
  // V-2: V-E closed out with its own evidence, its references wiped, approved (HR-Q5)
  await probe('KA.Q5.F8V.evidenceWiped (V-2: approval after the evidence was wiped)', async () => {
    const id = await raiseNcr(t, 'site', 'V-E', 'minor', null);
    const co = await closeout(t, id, [await evidence(t, 'V-E')]);
    if (co.status !== 200 || (await ncrRow(t, id))?.status !== 'submitted') throw probeSetup('KA.Q5.F8V.evidenceWiped', `V-E could not be closed out (${h.said(co)})`);
    const pw = await send('site', 'PATCH', `${t.P}/ncr/${id}`, { attachmentRefs: [] });
    const wiped = listOf((await ncrRow(t, id))?.attachmentRefs || (await ncrRow(t, id))?.attachments).length;
    if (pw.status !== 200 || wiped !== 0) throw probeSetup('KA.Q5.F8V.evidenceWiped', `V-E's references could not be wiped (${h.said(pw)}, ${wiped} left)`);
    const ap = await send('quality', 'POST', `${t.P}/ncr/${id}/approve`, { comment: label('approved') });
    const o = { said: h.said(ap), status: ap.status, ncrStatus: (await ncrRow(t, id))?.status ?? null };
    const L = WP8.quality.evidenceWipedBeforeApprovalProbe;
    const answer = CONTRACT['HR-Q5'].evidenceAnswer;
    const isValue = (x) => !is2xx(x.status) && (answer ? x.said === answer : !NOT_THE_RULE.test(x.said)) && x.ncrStatus === L.value.ncrStatus && L.value.approved === false;
    ka('KA.Q5.F8V.evidenceWiped', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, isValue, (x) => sameJson(pick(x, L.today), L.today)), detail: 'approveNcr does not re-check the evidence (ncr.service.js:547-614)' });
  });
  // V-3: V-T closed out with a fileName-only reference (HR-X1; FIXES['HR-X1'] from the WP-2 batch)
  await probe('KA.X1.F8V.textOnly (V-3: a text-only evidence reference)', async () => {
    const L = WP8.quality.textOnlyEvidenceProbe;
    const C = CONTRACT['HR-X1'];
    if (fixed('HR-X1') && (!C.mode || !C.answer || !C.ncrStatus || !nodeAt(FIELD, 'WP8.quality.hrX1.storedNowhere'))) throw probeSetup('KA.X1.F8V.textOnly', 'FIXES[\'HR-X1\'] is set but CONTRACT[\'HR-X1\'] (mode, answer, ncrStatus) or the batch\'s book leaf is not filled');
    const id = await raiseNcr(t, 'site', 'V-T', 'minor', null);
    const name = fileName('text only reference');
    const co = await closeout(t, id, [{ fileName: name }]);
    const row = await ncrRow(t, id);
    const o = { said: h.said(co), status: co.status, ncrStatus: row?.status ?? null, refCounted: listOf(row?.attachmentRefs || row?.attachments).some((r) => r.fileName === name) };
    obs.textOnly = { ...o, contract: C };
    const isToday = (x) => x.status === numbersIn(L.today)[0] && x.ncrStatus === 'submitted' && x.refCounted === true;
    const isValue = (x) => fixed('HR-X1') && x.said === C.answer && x.ncrStatus === C.ncrStatus;
    ka('KA.X1.F8V.textOnly', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, isValue, isToday), detail: `normalizeAttachmentRefs keeps a fileName-only reference and the closeout counts it (workflow-support.service.js:406-424); the batch's contract: ${C.mode ? `${C.mode} / ${C.answer} / ${C.ncrStatus}` : 'pending (O10)'}` });
  });
  // V-4: one major NCR and a pending legacy ITP DELETEd (HR-Q4)
  await probe('KA.Q4.F8V.hardDelete (V-4: an NCR and a legacy ITP deleted)', async () => {
    const L = WP8.quality.hardDeleteProbe;
    /** HEAD's reading (200 { deleted: true }, the row gone) is the leaf's today; an archived row read back its value. */
    const reading = async (table, id, res, key) => {
      const row = await rowJson(table, id);
      if (!row && res.status === 200 && res.body?.data?.deleted === true) return L.today[key];
      if (row && is2xx(res.status) && (row.archivedAt || row.status === 'archived')) return L.value[key];
      return `${h.said(res)}; the row ${row ? `reads back ${row.status}` : 'is gone'}`;
    };
    const nid = t.majors[0];
    const dn = await send('pm', 'DELETE', `${t.P}/ncr/${nid}`);
    const ncr = await reading('NcrRecord', nid, dn, 'ncr');
    const ic = await send('quality', 'POST', `${t.P}/itp`, { title: label('legacy ITP to delete'), pointType: 'hold', status: 'pending', dueDate: runDay('R-1') });
    const iid = ic.status === 201 ? ic.body?.data?.id || null : null;
    if (!iid) throw probeSetup('KA.Q4.F8V.hardDelete', `the legacy ITP could not be made (${h.said(ic)})`);
    const di = await send('pm', 'DELETE', `${t.P}/itp/${iid}`);
    const legacyItp = await reading('ItpRecord', iid, di, 'legacyItp');
    const o = { ncr, legacyItp };
    obs.hardDelete = { ncr: { said: h.said(dn), body: dn.body?.data ?? null }, legacyItp: { said: h.said(di), body: di.body?.data ?? null } };
    kaLeaf('KA.Q4.F8V.hardDelete', L, o, { detail: 'deleteNcr and deleteItp hard-delete (ncr.service.js:786, itp.service.js:204); F8V\'s score stays 0 either way' });
  });
  // V-5: V-D closed out with malformed storage keys (the NCR half of D-VAL-1)
  const vd = await raiseNcr(t, 'site', 'V-D', 'minor', null);
  const refs = FIXTURE.malformedKeys.map((k) => ({ fileName: fileName(`V-D malformed ${k.kind}`), storageKey: k.value }));
  const cv = await closeout(t, vd, refs);
  const rv = await ncrRow(t, vd);
  obs.dval1 = { ...(obs.dval1 || {}), ncrCloseout: { said: h.said(cv), keptMalformed: rv ? malformedKept(rv.attachmentRefs || rv.attachments) : null, namesForeign: rv ? await namesForeign(t.id, rv.attachmentRefs || rv.attachments) : null } };
};
const f8vEnd = async () => {
  const t = ctx.f8v;
  t.cancel = await cancelQueued(t);
  const a = await archive(t);
  rec('S.F8V.archived', a?.status === 200 && Boolean(a?.archivedAt) && t.cancel.left === 0, { expected: { archive: 200, archivedAt: true, queuedJobsLeft: 0 }, observed: { archive: a, queuedLeft: t.cancel.left, cancelled: t.cancel.cancelled.length, refused: t.cancel.refused }, detail: `F8V ${t.id}: archived with its NCRs` });
};

// -- 087-FLD and 052-FLD: the stored moments, the live reads and the one refused party request (F87, F52) -------------------
/** A build record and its live reading judged together: equal verdicts stand; a stored today beside a live value is the stored record's today. */
const storedLive = (stored, live) => (stored === live ? stored : stored === 'today' && live === 'value' ? 'today' : 'wrong');
const fld087Flow = async () => {
  const st = ctx.state['087-FLD'];
  const s = storedFld087(st);
  const { P, id: projectId } = ctx.deep['087-FLD'];
  const ids = s.ids;
  const A = ids.activities;
  obs.fld087 = { promoteStored: s.promoteStored, d1: s.d1ApprovedFromOpen, days: ids.days };
  // KA.DL.087.promoteStored: the stored moment (row 176) and the rows now
  const rows = listOf((await registerOf(P))?.rows);
  const live = ids.promotedWeatherDelays.map((id) => { const r = rows.find((x) => x.id === id); return r ? Number(r.delayDays) : null; });
  const c11 = COMMERCIAL.WP7.weather['087-FLD.promoted.days'];
  const liveVerdict = judge(live, (x) => sameJson(x, c11.value), (x) => sameJson(x, c11.today));
  ka('KA.DL.087.promoteStored', { ref: c11.ref, value: c11.value, today: c11.today, observed: { stored: s.promoteStored.observed, live }, verdict: storedLive(s.promoteStored.verdict, liveVerdict), storedAt: s.promoteStored.storedAt, detail: `step weather.at13.read (${s.promoteStored.storedAt}) and the register rows of D1-D3's promotions now; rows built before the HR-C11 fix keep their truncated days until the exit rebuild (MOMENT-MAP row 176)` });
  // DL.087.manpower and DL.087.a130 (the manpower day D4)
  const D4 = ids.days.D4;
  const report = await dataOf('pm', `${P}/daily-logs/manpower-report?from=${D4}&to=${D4}&groupBy=trade`);
  const items = listOf(report?.items);
  const byKey = (k) => items.find((i) => i.key === k) || null;
  const om = { Steelfixer: byKey('Steelfixer')?.manHours ?? null, Carpenter: byKey('Carpenter')?.manHours ?? null, Labourer: byKey('Labourer') ? byKey('Labourer').manHours : 'absent', total: report?.totals?.manHours ?? null, workers: report?.totals?.workers ?? null };
  const em = { Steelfixer: WP8.dailyLog.manpowerSteelfixer.value, Carpenter: WP8.dailyLog.manpowerCarpenter.value, Labourer: WP8.dailyLog.manpowerLabourer.value, total: WP8.dailyLog.manpowerTotal.value, workers: WP8.dailyLog.manpowerWorkers.value };
  rec('DL.087.manpower', sameJson(om, em), { expected: em, observed: om, detail: 'the internal Steelfixer approved, the party\'s Carpenter submitted (counted), the Labourer rejected (left out): daily-log.service.js:1456' });
  const week = await dataOf('pm', `${P}/timesheets/week?weekStart=${D4}`);
  const byAct = await dataOf('pm', `${P}/daily-logs/manpower-report?from=${D4}&to=${D4}&groupBy=activity`);
  const oa = { weekSummaryA130: listOf(week?.activities).find((r) => r.activityId === A.A130)?.hours ?? null, manpowerReportA130: listOf(byAct?.items).find((i) => i.key === A.A130)?.manHours ?? null };
  const ea = { weekSummaryA130: WP8.dailyLog.weekSummaryA130.value, manpowerReportA130: WP8.dailyLog.manpowerReportA130.value };
  rec('DL.087.a130', sameJson(oa, ea), { expected: ea, observed: oa, detail: 'the week summary counts every sheet of the week (timesheet.service.js:784); the manpower report groups D4 by activity' });
  // DL.087.partyLock: the one request sent to 087-FLD, refused before any write
  const pl = await send('party', 'POST', `${P}/daily-logs/${ids.days.D5}/entries/notes`, { kind: 'general', text: label('a party note on a submitted day') });
  rec('DL.087.partyLock', h.is(pl, WP8.dailyLog.partyLock.value), { expected: WP8.dailyLog.partyLock.value, observed: h.said(pl), detail: 'assertEditable answers inside the transaction before the insert (daily-log.service.js:921); D5 unchanged is S.087FLD.unchanged\'s' });
  // timesheets: the stored moments and the sheets now
  const sheet = async (id) => dataOf('cost', `${P}/timesheets/${id}`);
  const explainRows = async (act, sheetId) => listOf((await dataOf('pm', `${P}/cost/reconciliation/explain?activityId=${act}`))?.entries).filter((r) => r.sourceId === sheetId);
  const [costType, sourceType] = (/costType (\w+), sourceType (\w+)/.exec(WP8.timesheet.mixedDayLedger.value) || []).slice(1);
  const mixed = await sheet(ids.timesheets.mixed);
  const mx = await explainRows(A.A100, ids.timesheets.mixed);
  const omx = { status: mixed?.status ?? null, totalCost: cents(mixed?.totalCost), rows: mx.length, costTypes: [...new Set(mx.map((r) => r.costType))], sourceTypes: [...new Set(mx.map((r) => r.sourceType))], sum: mx.reduce((sum, r) => sum + cents(r.amount), 0) };
  const emx = { status: 'approved', totalCost: WP8.timesheet.mixedDay.value, rows: 3, costTypes: [costType], sourceTypes: [sourceType], sum: WP8.timesheet.mixedDay.value };
  rec('TS.087.mixed', sameJson(omx, emx), { expected: emx, observed: omx, detail: 'priced at the build approval and posted through the cost ledger; read, never re-priced' });
  const half = s['TS.stored.half'];
  rec('TS.stored.half', half.ok, { expected: half.expected, observed: half.observed, detail: 'step worker.multiplier-half (MOMENT-MAP rows 171, 172): the create refused with the field named, the import\'s row in errors[]' });
  const t2000 = await sheet(ids.timesheets.t2000);
  const tx = await explainRows(A.A130, ids.timesheets.t2000);
  const mirrors = tx.filter((r) => r.isReversal);
  const positive = tx.filter((r) => !r.isReversal);
  const per = WP8.timesheet.reopenTwoThousand.value / WP8.timesheet.reopenMirrorCount.value;
  const orp = { stored: s['TS.087.reopen.stored'].ok, status: t2000?.status ?? null, totalCost: cents(t2000?.totalCost), rows: tx.length, mirrors: mirrors.length, mirrorSum: mirrors.reduce((sum, r) => sum + cents(r.amount), 0), positive: positive.length, positiveEach: [...new Set(positive.map((r) => cents(r.amount)))], net: tx.reduce((sum, r) => sum + cents(r.amount), 0) };
  const erp = { stored: true, status: 'approved', totalCost: WP8.timesheet.reapprovedNet.value, rows: WP8.timesheet.reapprovedEntryCount.value, mirrors: WP8.timesheet.reopenMirrorCount.value, mirrorSum: WP8.timesheet.reopenMirrorSum.value, positive: 2 * WP8.timesheet.reopenMirrorCount.value, positiveEach: [per], net: WP8.timesheet.reapprovedNet.value };
  rec('TS.087.reopen', sameJson(orp, erp), { expected: erp, observed: { ...orp, storedMoment: s['TS.087.reopen.stored'].observed }, detail: 'reopenTimesheet reverses with negative mirrors (timesheet.service.js:716-731); the reopened sheet stood at 0.00 between reopen and re-approval (the stored moment, MOMENT-MAP row 174)' });
  const rej = await sheet(ids.timesheets.rejectedEdited);
  const ore = { status: rej?.status ?? null, regularHours: nullableNumber(rej?.regularHours), totalCost: cents(rej?.totalCost) };
  const ere = { status: 'approved', regularHours: WP8.timesheet.rejectEditApprove.value / (F8B.workers['W8-1'].hourlyRate * 100), totalCost: WP8.timesheet.rejectEditApprove.value };
  rec('TS.087.rejectEditApprove', sameJson(ore, ere), { expected: ere, observed: ore, detail: 'returned with a reason, edited to 5 x 7 h, resubmitted and approved at the build (MOMENT-MAP row 186)' });
  const crew = await sheet(ids.timesheets.crewPrefill);
  const ocp = { entryCount: crew?.entryCount ?? listOf(crew?.entries).length, regularHours: nullableNumber(crew?.regularHours) };
  const ecp = { entryCount: WP8.timesheet.crewPrefillEntries.value, regularHours: WP8.timesheet.crewPrefillHours.value };
  rec('TS.087.crewPrefill', sameJson(ocp, ecp), { expected: ecp, observed: ocp, detail: 'the mixed crew pre-filled 3 x 8 h on its default activity' });
  // quality: the variant, the HR-Q3 reading, the punch mix
  const vm = await dashboardOf(ctx.deep.variant.P);
  const ov = { qualityScore: vm.qualityScore ?? null, majorNcrs: vm.majorNcrs ?? null };
  const ev = { qualityScore: WP8.quality.sixMajor.value, majorNcrs: F8VB.records.majorNcrs };
  rec('Q.087.variant', sameJson(ov, ev), { expected: ev, observed: ov, detail: 'the 6-major variant project of 087-FLD (state variant.six-major), read only' });
  const dq = await dashboardOf(P);
  await probe('KA.Q3.087.score (087-FLD on the three surfaces)', async () => {
    const hq = await healthDim(P, 'quality');
    const w = await workspaceRow(projectId);
    if (!hq || !w) throw probeSetup('KA.Q3.087.score', `${!hq ? 'the health card has no quality dimension' : '087-FLD is not among the rows the workspace dashboard answers the PM or the site engineer'}`);
    const L = WP8.quality.formItpCounted087FLD;
    const o = { dashboard: dq.qualityScore ?? null, health: hq.score, workspace: w.row.dimensions?.quality ?? null };
    const each = Object.values(o).map((x) => judge(x, (y) => y === L.value, (y) => y === L.today));
    ka('KA.Q3.087.score', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: allVerdict(each), detail: `the legacy register only (quality.service.js:46, health.js:444, workspace-dashboard.service.js:1148); 087-FLD's A120 complete-fail form instance is WP-2's fixture; workspace read as ${w.persona}` });
  });
  const op = { openDefects: dq.openDefects ?? null, observationsOpen: dq.observationsOpen ?? null, safetyObservationsOpen: dq.safetyObservationsOpen ?? null };
  const ep = { openDefects: WP8.punch.openDefects.value, observationsOpen: WP8.punch.openObservations.value, safetyObservationsOpen: WP8.punch.safetyObservationsOpen.value };
  rec('P.087.mix', sameJson(op, ep), { expected: ep, observed: op, detail: 'the build\'s punch and observation mix (WP8.punch.mix)' });
  // safety: the card, the workspace and the dashboard
  const sd = await healthDim(P, 'safety');
  obs.safety087 = sd;
  kaLeaf('KA.SAFE.087.health', WP8.safety.health, sd?.score ?? null, { detail: `the card counts the archived near miss open (health.js:171-173, :455-457); detail ${json(sd?.detail)}` });
  await probe('SF.087.workspaceDashboard (087-FLD workspace safety and dashboard counts)', async () => {
    const w = await workspaceRow(projectId);
    if (!w) throw probeSetup('SF.087.workspaceDashboard', '087-FLD is not among the rows the workspace dashboard answers the PM or the site engineer');
    const os = { workspace: w.row.dimensions?.safety ?? null, safetyIncidents: dq.safetyIncidents ?? null, safetyOpen: dq.safetyOpen ?? null };
    const es = { workspace: WP8.safety.workspace.value, safetyIncidents: WP8.safety.dashboardIncidents.value, safetyOpen: WP8.safety.dashboardOpen.value };
    obs.safetyWorkspace087 = os.workspace;
    rec('SF.087.workspaceDashboard', sameJson(os, es), { expected: es, observed: { ...os, persona: w.persona }, detail: 'the workspace (archivedAt null) and the dashboard (live()) exclude the archived incident' });
  });
  // RFIs: the link, the API's overdue reading, the stored column
  const rl = await linkOf('rfi', ids.rfi?.closed, 'schedule_impact');
  const orl = { links: rl.length, activity: rl[0]?.activityId === A.A180 ? 'A180' : rl[0]?.activityId ?? null, days: rl[0] ? Number(rl[0].days) : null };
  rec('R.087.scheduleImpact', sameJson(orl, { links: 1, activity: 'A180', days: WP8.rfi.scheduleImpactLink.value }), { expected: { links: 1, activity: 'A180', days: WP8.rfi.scheduleImpactLink.value }, observed: orl, detail: 'the build\'s closed RFI (state rfi.closed), read-only SQL' });
  const rrb = await dataOf('pm', `${P}/rfi/${ids.rfi?.rrb}`);
  const ans = await dataOf('pm', `${P}/rfi/${ids.rfi?.ans}`);
  const listed = listOf(await dataOf('pm', `${P}/rfi?overdue=true&limit=100`)).map((r) => r.id);
  const V = WP8.rfi.overdueApiDueDate.value;
  const oo = {
    dueDate: { 'RFI-RRB': dayOf(rrb?.dueDate) && dayOf(rrb?.dueDate) === dayOf(rrb?.responseRequiredBy) ? V['RFI-RRB'] : `dueDate ${dayOf(rrb?.dueDate)}`, 'RFI-ANS': dayOf(ans?.dueDate) && !ans?.responseRequiredBy ? V['RFI-ANS'] : `dueDate ${dayOf(ans?.dueDate)}` },
    detail: { 'RFI-RRB': rrb?.isOverdue ?? null, 'RFI-ANS': ans?.isOverdue ?? null },
    list: { 'RFI-RRB': listed.includes(ids.rfi?.rrb), 'RFI-ANS': listed.includes(ids.rfi?.ans) },
  };
  const eo = { dueDate: V, detail: WP8.rfi.overdueDetail.value, list: WP8.rfi.overdueListFilter.value };
  rec('R.087.overdueApi', sameJson(oo, eo), { expected: eo, observed: oo, detail: 'dueDateForRecord presents dueDate || responseRequiredBy; isOverdue reads responseRequiredBy || dueDate (rfi-workflow.service.js:196-200) (MOMENT-MAP row 184)' });
  const srr = await rfiStored(ids.rfi?.rrb);
  const san = await rfiStored(ids.rfi?.ans);
  const os2 = { 'RFI-RRB': srr ? srr.dueDate : 'no row', 'RFI-ANS': san?.dueDate && san.dueDate < ctx.R ? WP8.rfi.overdueStoredDueDate.value['RFI-ANS'] : san?.dueDate ?? 'no row' };
  obs.fld087Overdue = { stored: { rrb: srr, ans: san } };
  rec('R.087.overdueStored', sameJson(os2, WP8.rfi.overdueStoredDueDate.value), { expected: WP8.rfi.overdueStoredDueDate.value, observed: { ...os2, raw: { rrb: srr, ans: san } }, detail: 'read-only SQL of the stored columns (MOMENT-MAP row 185): health reads this dueDate only (HR-K1)' });
  // submittals, the storeman's register, the transmittal, the notice letter, the change event
  const sd087 = await dataOf('pm', `${P}/submittals/${ids.submittals?.templated}`);
  const sdd = await dataOf('pm', `${P}/submittals/${ids.submittals?.direct}`);
  const osb = { templated: dayOf(sd087?.submitBy), direct: dayOf(sdd?.submitBy) };
  const esb = { templated: WP8.submittal.submitByTemplated.value, direct: WP8.submittal.submitByDirect.value };
  rec('SUB.087.submitBy', sameJson(osb, esb), { expected: esb, observed: osb, detail: 'stored at the build\'s create; no WP-8 mutant moves them' });
  const reg = listOf(await dataOf('storeman', `${P}/doc-control/register?recordType=drawing`)).find((row) => row.recordId === ids.drawing?.drawingId) || null;
  const s1 = listOf(reg?.revisions).map((r) => r.revision).sort();
  rec('D.087.storeman', sameJson(s1, WP8.drawing.storemanRevisions.value), { expected: WP8.drawing.storemanRevisions.value, observed: s1, detail: 'X1 approved and not latest is hidden from the current-only role (doc-control.service.js:99-108)' });
  const trow = listOf(await dataOf('planner', `${P}/transmittals`)).find((r) => r.id === ids.transmittal?.transmittalId) || null;
  const linked = [trow?.activityId, ...listOf(trow?.activityLinks).map((l) => l.activityId || l.activity?.id), ...listOf(trow?.activityIds)].filter(Boolean);
  const revB = ids.drawing?.revisionB;
  const cites = listOf(trow?.revisions).some((r) => r.id === ids.transmittal?.revisionId && r.revision === 'B' && (r.projectDocumentId === revB?.documentId || r.storageKey === revB?.documentId));
  rec('T.087.transmittal', Boolean(trow) && linked.includes(A.A180) && cites, { expected: WP8.transmittal.activityAndRevision.value, observed: { found: Boolean(trow), activityLinked: linked.includes(A.A180), citesRevisionB: cites }, detail: 'the build filed rev B through document control (finding WP8-TRN-1; builders\' adjudication 087-FLD item 5)' });
  const letterId = ids.letter?.letterId;
  const wd = rows.find((r) => r.id === ids.letter?.weatherDelayId) || null;
  const corr = await dataOf('pm', `${P}/correspondence`);
  const letter = listOf(corr).find((r) => r.id === letterId) || null;
  const links = listOf(wd?.correspondenceLinks);
  const NL = WP8.transmittal.noticeLetterReadBack.value;
  const onl = { correspondenceLinks: links.length, linkedCorrespondence: links.length === 1 && (links[0].correspondence?.id || links[0].correspondenceId) === letterId ? NL.linkedCorrespondence : links.map((l) => l.correspondence?.id || l.correspondenceId), contractualNotice: letter?.contractualNotice ?? null, notices: corr?.summary?.notices ?? null };
  const enl = { ...NL, notices: WP8.transmittal.noticeRegisterCount.value };
  rec('T.087.noticeLetter', sameJson(onl, enl), { expected: enl, observed: onl, detail: 'the 7.5-day manual delay linked to the notice letter at the build (state notice-letter)' });
  const meeting = await dataOf('planner', `${P}/meetings/${st.steps.meeting.out.meetingId}`);
  const item = listOf(meeting?.actionItems).find((a) => a.id === ids.meeting?.actionItem1?.id) || null;
  const ce = await dataOf('qs', `${P}/change-events/${ids.meeting?.changeEventId}`);
  const CE = WP8.transmittal.meetingChangeEventReadBack.value;
  const oce = {
    origin: ce?.origin ?? null,
    sourceRecordType: ce?.sourceRecordType ?? null,
    sourceRecordId: item && ce?.sourceRecordId === item.id ? CE.sourceRecordId : ce?.sourceRecordId ?? null,
    sourceLinks: listOf(ce?.sourceLinks).map((l) => ({ type: l.type, id: item && l.id === item.id ? CE.sourceLinks[0].id : l.id })),
    title: item && ce?.title === `${String(CE.title).split('<')[0]}${item.title}` ? CE.title : ce?.title ?? null,
    activityId: item && ce?.activityId === (item.activityId ?? null) && item.activityId === A.A160 ? CE.activityId : ce?.activityId ?? null,
    type: ce?.type ?? null,
    romAmount: ce?.romAmount === null || ce?.romAmount === undefined ? null : Number(ce.romAmount),
    scheduleImpactDays: ce?.scheduleImpactDays === null || ce?.scheduleImpactDays === undefined ? null : Number(ce.scheduleImpactDays),
  };
  rec('T.087.meetingChangeEvent', sameJson(oce, CE), { expected: CE, observed: oce, detail: 'raised from action item 1 at the build; romAmount and scheduleImpactDays compared as numbers (R2-F)' });
};
const fld052Flow = async () => {
  const s87 = storedFld087(ctx.state['087-FLD']);
  const s = storedFld052(ctx.state['052-FLD']);
  const { P } = ctx.deep['052-FLD'];
  // DL.stored.promoteEcho: 087-FLD's and 052-FLD's stored echoes
  const ok = s87['DL.stored.promoteEcho'].ok && s['DL.stored.promoteEcho'].ok;
  rec('DL.stored.promoteEcho', ok, { expected: { '087-FLD': s87['DL.stored.promoteEcho'].expected, '052-FLD': s['DL.stored.promoteEcho'].expected }, observed: { '087-FLD': s87['DL.stored.promoteEcho'].observed, '052-FLD': s['DL.stored.promoteEcho'].observed }, detail: `the builds asserted each echo at the promotion (087-fld.js promote(), 052-fld.js; MOMENT-MAP rows 175, 246, 262)${s87['DL.stored.promoteEcho'].gap || s['DL.stored.promoteEcho'].gap ? '; an adopted promotion left an echo null: DL.F8.promoteEcho serves it on fresh records' : ''}` });
  // Q.052.score: the stored moment and the dashboard now
  const m = await dashboardOf(P, 'pm052');
  const q = s['Q.052.score'];
  rec('Q.052.score', q.ok && m.qualityScore === WP8['052-FLD'].qualityScore.value, { expected: { stored: q.expected, live: WP8['052-FLD'].qualityScore.value }, observed: { stored: q.observed, live: m.qualityScore ?? null }, detail: 'the CLAUDE.md rule on 052-FLD (no form ITP: HR-Q3-neutral; MOMENT-MAP row 250)' });
  // TS.052.labour: the mixed sheet as the 052 PM reads it
  const sh = await dataOf('pm052', `${P}/timesheets/${s.ids.mixed}`);
  const ol = { status: sh?.status ?? null, totalCost: cents(sh?.totalCost) };
  const el = { status: 'approved', totalCost: WP8['052-FLD'].labour.value };
  rec('TS.052.labour', sameJson(ol, el), { expected: el, observed: ol, detail: 'read only by 052\'s PM (WP8ADJ Q9; MOMENT-MAP row 250)' });
  // KA.SAFE.052.health: the stored moment (row 251) and the card now
  const d = await healthDim(P, 'safety', 'pm052');
  const L = WP8['052-FLD'].safetyHealth;
  const liveVerdict = judge(d?.score ?? null, (x) => x === L.value, (x) => x === L.today);
  obs.safety052 = { stored: s.safety, live: d };
  ka('KA.SAFE.052.health', { ref: L.ref, value: L.value, today: L.today, observed: { stored: s.safety.observed, live: d?.score ?? null, storedStep: `${s.safety.step}${s.safety.ref ? ` ${s.safety.ref}` : ''}` }, verdict: storedLive(s.safety.verdict, liveVerdict), storedAt: s.safety.storedAt, detail: 'the build persisted the moment BLOCKED HR-K1; WP8ADJ Q4 files it under SAFE-ARCH-1 (the same known answer, 70); STORED-PRE-FIX after its fix until the exit rebuild' });
};
/** S.087FLD.unchanged: 087-FLD's fingerprint after the last deep read against the one before the first. */
const deepUnchanged = async () => {
  const needed = NEED_LIVE.includes('087-FLD') && Boolean(ctx.fingerprints.before);
  if (needed) ctx.fingerprints.after = await fingerprint087(ctx.deep['087-FLD'].id, storedFld087(ctx.state['087-FLD']).ids.days.D5);
  const same = needed ? sameJson(ctx.fingerprints.before, ctx.fingerprints.after) : true;
  if (needed && !same) ctx.deepWrites.push(`087-FLD changed across the run: ${json(ctx.fingerprints)}`);
  rec('S.087FLD.unchanged', same, { expected: needed ? ctx.fingerprints.before : null, observed: needed ? ctx.fingerprints.after : null, detail: needed ? 'read-only SQL fingerprint before the first deep read and after the last (WP8ADJ Q2)' : 'not needed (no selected check reads 087-FLD live)' });
};

// -- confirm-first classification from this run's observations -----------------------------------------------------------------
/** WP-7's observation of the site engineer's promotion (KA.F4.T7.sitePromotion), read from its result file (WP8ADJ Q8), or null. */
const wp7SitePromotion = (file = WP7_RESULT) => {
  try {
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    const k = result?.observations?.knownAnswers?.['KA.F4.T7.sitePromotion'];
    return k?.observed ? { observed: k.observed, status: k.status, finishedAt: result.finishedAt ?? null, verdict: result.verdict ?? null } : null;
  } catch {
    return null;
  }
};
/**
 * The confirm-first items (pure over the run's observations, the known answers' verdicts, the static scan and WP-7's
 * observation; exported for the registration check): each item 'present' (HEAD's behaviour, as the CF leaf's today or
 * the lead leaf states it), 'absent' (the leaf's value, or the lead closed) or 'gap' (not observed, or neither).
 */
const confirmFirstItems = ({ o, verdictOf, scan, wp7 }) => {
  const kaState = (id) => (verdictOf(id) === 'today' ? 'present' : verdictOf(id) === 'value' ? 'absent' : 'gap');
  const flag = (x) => (x === true ? 'present' : x === false ? 'absent' : 'gap');
  const vs = (seen, today, value) => (seen === null || seen === undefined ? 'gap' : sameJson(pick(seen, today), today) ? 'present' : sameJson(pick(seen, value), value) ? 'absent' : 'gap');
  const refusedState = (seen, value) => (seen && !is2xx(seen.status) && !NOT_THE_RULE.test(String(seen.said)) && sameJson(pick(seen, (({ refused, code, ...rest }) => rest)(value)), (({ refused, code, ...rest }) => rest)(value)) ? 'absent' : null);
  const F6 = WP8.CF.HRF6;
  const site = WP8.CF.HRF4;
  const trn = WP8.transmittal.createCitesFiled.value;
  const lead = (x, today, refusedWhen) => (x === null || x === undefined ? 'gap' : today(x) ? 'present' : refusedWhen(x) ? 'absent' : 'gap');
  return {
    'CF.HRF4': [
      ['an open day approved (KA.F4.F8.approveFromOpen)', kaState('KA.F4.F8.approveFromOpen')],
      ['an empty day approved (KA.F4.F8.approveEmpty)', kaState('KA.F4.F8.approveEmpty')],
      ['an approved day reopened without a reason (KA.F4.F8.reopenNoReason)', kaState('KA.F4.F8.reopenNoReason')],
      ['site staff create contractual weather delays (WP-7\'s KA.F4.T7.sitePromotion, its result file)', wp7 ? (sameJson(pick(wp7.observed, site.today.sitePromotion), site.today.sitePromotion) ? 'present' : wp7.observed.contractual === false && wp7.observed.contractualUsedDelta === 0 && is2xx(wp7.observed.status) ? 'absent' : 'gap') : 'gap'],
    ],
    'CF.HRF5': [
      ['the 24 h cap counts one sheet only (KA.F5.F8.capAcrossSheets)', kaState('KA.F5.F8.capAcrossSheets')],
      ['the rate read at approval (KA.F5.F8.rateTiming)', kaState('KA.F5.F8.rateTiming')],
      ['an inactive worker accepted (KA.F5.F8.inactiveWorker)', kaState('KA.F5.F8.inactiveWorker')],
    ],
    'CF.HRQ5': [
      ['NCR severity editable after closure (KA.Q5.F8.severityDowngrade)', kaState('KA.Q5.F8.severityDowngrade')],
      ['safety lost days editable after closure (KA.Q5.F8.ltiEdit)', kaState('KA.Q5.F8.ltiEdit')],
      ['approval does not re-check the evidence (KA.Q5.F8V.evidenceWiped)', kaState('KA.Q5.F8V.evidenceWiped')],
    ],
    'CF.HRQ4': [
      ['NCRs and legacy ITPs hard-deleted (KA.Q4.F8V.hardDelete)', kaState('KA.Q4.F8V.hardDelete')],
      ['a legacy ITP status changed with no reason (KA.Q4.F8.legacyItpStatus)', kaState('KA.Q4.F8.legacyItpStatus')],
      ['static: deleteNcr and deleteItp hard-delete (ncr.service.js:786, itp.service.js:204)', scan ? flag(scan.ncrHardDelete === null || scan.itpHardDelete === null ? null : scan.ncrHardDelete && scan.itpHardDelete) : 'gap'],
    ],
    'CF.HRF3': [
      ['the final approver reassigned by a site engineer and the close that follows (KA.F3.F8.approverBypass)', kaState('KA.F3.F8.approverBypass')],
    ],
    'CF.SAFEARCH': [
      ['F8\'s card counts its archived incident (KA.SAFE.F8.health)', kaState('KA.SAFE.F8.health')],
      ['087-FLD\'s card counts its archived incident (KA.SAFE.087.health)', kaState('KA.SAFE.087.health')],
      ['052-FLD\'s card counts its archived incident (KA.SAFE.052.health)', kaState('KA.SAFE.052.health')],
      ['static: the card reads every incident and counts status != closed open (health.js:171-173, :455-457)', scan ? flag(scan.healthReadsEveryIncident === null || scan.healthOpenIsNotClosed === null ? null : scan.healthReadsEveryIncident && scan.healthOpenIsNotClosed) : 'gap'],
    ],
    'CF.RFIRESP': [
      ['a closed RFI\'s official answer rewritten through either path, the previous text kept nowhere (KA.RFI.F8.officialAfterClose)', kaState('KA.RFI.F8.officialAfterClose')],
      ['static: updateResponse checks no status and writes the RFI\'s answer for the official response (rfi-workflow.service.js:324-348)', scan ? flag(scan.updateResponseNoStatusCheck === null || scan.updateResponseWritesAnswer === null ? null : scan.updateResponseNoStatusCheck && scan.updateResponseWritesAnswer) : 'gap'],
    ],
    'CF.HRK1rfi': [
      ['the card counts by dueDate only, answered included (KA.K1.F8.rfiOverdueHealth)', kaState('KA.K1.F8.rfiOverdueHealth')],
      ['static: health.js:462-465 against the workspace\'s responseRequiredBy || dueDate (workspace-dashboard.service.js:1168-1175)', scan ? flag(scan.healthOverdueByDueDateOnly === null || scan.workspaceOverdueBasis === null ? null : scan.healthOverdueByDueDateOnly && scan.workspaceOverdueBasis) : 'gap'],
    ],
    'CF.HRF1': [
      ['the PM\'s approval while review steps pend (KA.F1.F8.pmApproveWhilePending)', kaState('KA.F1.F8.pmApproveWhilePending')],
    ],
    'CF.HRF2': [
      ['a drawing revision approved without review (KA.F2.F8.approveWithoutReview)', kaState('KA.F2.F8.approveWithoutReview')],
      ['an older revision approved after a newer one (KA.F2.F8.approveOutOfOrder)', kaState('KA.F2.F8.approveOutOfOrder')],
    ],
    'CF.HRF6': [
      ['a meeting\'s status set by PATCH (KA.F6.F8.patchStatus)', kaState('KA.F6.F8.patchStatus')],
      ['a draft meeting distributed (M8b)', o.draftDistributed ? (vs(o.draftDistributed, F6.today.draftDistributed, {}) === 'present' ? 'present' : refusedState(o.draftDistributed, F6.value.draftDistributed) || 'gap') : 'gap'],
      ['minutes editable after distribution (M8b)', o.editAfterDistribution ? (vs(o.editAfterDistribution, F6.today.editAfterDistribution, {}) === 'present' ? 'present' : refusedState(o.editAfterDistribution, F6.value.editAfterDistribution) || 'gap') : 'gap'],
      ['action items re-created with a new id (KA.F6.F8.actionItemIdentity)', kaState('KA.F6.F8.actionItemIdentity')],
      ['a duplicate task from a re-created item (KA.F6.F8.duplicateTask)', kaState('KA.F6.F8.duplicateTask')],
    ],
    'CF.TRN1': [
      ['a transmittal create citing a filed document refused 404 FILE_NOT_FOUND, nothing written (T-1)', lead(o.trn1, (x) => x.transmittal === trn.transmittal && x.messages[0] === trn.message && x.recordsWritten === trn.recordsWritten, (x) => is2xx(saidParts(x.transmittal).status))],
      ['a correspondence create citing a filed document refused 404 FILE_NOT_FOUND, nothing written (T-1)', lead(o.trn1, (x) => x.correspondence === trn.correspondence && x.messages[1] === trn.message && x.recordsWritten === trn.recordsWritten, (x) => is2xx(saidParts(x.correspondence).status))],
    ],
    'CF.L213': [
      ['a member without task.close closes a task through PATCH { status: done } (L213)', lead(o.l213, (x) => x.patchDone === WP8.leads.L213.value.patchDone, (x) => !is2xx(numbersIn(x.patchDone)[0]))],
    ],
    'CF.L146': [
      ['a transmittal hard-deleted under document_control:update with no audit row (T-2)', lead(o.l146, (x) => sameJson(x, WP8.leads.L146.value), (x) => !is2xx(saidParts(x.deleteAnswer).status) || x.rowGone === false || x.auditEvents > 0)],
    ],
    'CF.DVAL1': [
      ['a transmittal\'s malformed storage keys dropped silently (T-3)', lead(o.dval1?.transmittal, (x) => saidParts(x.said).status === numbersIn(WP8.leads.DVAL1.value.transmittal)[0] && x.keptMalformed === false && x.namesForeign === WP8.leads.DVAL1.value.namesAnotherCompany, (x) => saidParts(x.said).status === 400)],
      ['an NCR closeout\'s malformed storage keys dropped silently (V-5)', lead(o.dval1?.ncrCloseout, (x) => saidParts(x.said).status === numbersIn(WP8.leads.DVAL1.value.ncrCloseout)[0] && x.keptMalformed === false && x.namesForeign === WP8.leads.DVAL1.value.namesAnotherCompany, (x) => saidParts(x.said).status === 400)],
    ],
    'CF.LDETAILS': [
      ['production drops error.details (error-handler.js includeDetails, api-response.js)', scan ? flag(scan.productionDropsDetails) : 'gap'],
      ['the client readers of an error\'s details are the seven of WP8.leads.LDETAILS (a new reader is a sweep gap)', scan?.detailsReaders ? (sameJson(scan.detailsReaders, [...LDETAILS_READERS].sort()) ? 'present' : 'gap') : 'gap'],
    ],
  };
};
/**
 * The confirm-first observations (pure; exported): what the plan asks to be confirmed where the rule's own
 * recommendation equals HEAD, or a plan lead beside the rule: reported, never classified.
 */
const confirmFirstObservations = ({ o, scan }) => {
  const seen = (x, expected) => (x === null || x === undefined ? 'not observed' : sameJson(x, expected) ? 'seen' : 'not seen');
  return {
    'CF.HRF4': [['087-FLD\'s D1 approved straight from open at the build (stored, MOMENT-MAP row 182)', o.fld087?.d1 ? (o.fld087.d1.step === 'done' && o.fld087.d1.status === 'approved' ? 'seen' : 'not seen') : 'not observed', o.fld087?.d1 ?? null]],
    'CF.HRF5': [],
    'CF.HRQ5': [['a safety type change moves the LTI count (static, not probed: WP8.safety.ltiEditAfterClosure probes lost days only)', 'recorded', null]],
    'CF.HRQ4': [['closed NCRs keep counting (Q.F8.closeMajor; HR-Q4 keeps the literal rule)', seen(o.closeMajor?.score, WP8.quality.closeMajorLeaves.value), o.closeMajor ?? null]],
    'CF.HRF3': [],
    'CF.SAFEARCH': [
      ['the workspace excludes F8\'s archived incident (SF.F8.workspace)', seen(o.safetyWorkspaceF8, WP8.safety.workspace.value), o.safetyWorkspaceF8 ?? null],
      ['the quality dashboard excludes it (SF.F8.dashboard)', seen(o.safetyDashboardF8, { safetyIncidents: WP8.safety.dashboardIncidents.value, safetyOpen: WP8.safety.dashboardOpen.value }), o.safetyDashboardF8 ?? null],
      ['static: the workspace and the dashboard filter archived rows', scan ? (scan.workspaceExcludesArchived && scan.dashboardExcludesArchived ? 'seen' : 'not seen') : 'not observed', scan ? { workspace: scan.workspaceExcludesArchived, dashboard: scan.dashboardExcludesArchived } : null],
    ],
    'CF.RFIRESP': [
      ['the first-party web never calls the responses PATCH (useUpdateRfiResponse has no caller)', scan?.webCallersOfUpdateRfiResponse ? (scan.webCallersOfUpdateRfiResponse.length <= 1 ? 'seen' : 'not seen') : 'not observed', scan?.webCallersOfUpdateRfiResponse ?? null],
      ['the audit records "edited" only, no text', scan ? (scan.updateResponseAuditKeepsNoText ? 'seen' : 'not seen') : 'not observed', null],
    ],
    'CF.HRK1rfi': [['087-FLD\'s RRB stored with no dueDate (R.087.overdueStored), invisible to the card', o.fld087Overdue ? (o.fld087Overdue.stored?.rrb?.dueDate === null ? 'seen' : 'not seen') : 'not observed', o.fld087Overdue ?? null]],
    'CF.HRF1': [['SUB-LINK-1 (P2): the lead-time link upserted only when days > 0, so it stays stale (static)', scan ? (scan.leadTimeLinkOnlyWhenLate ? 'seen' : 'not seen') : 'not observed', null]],
    'CF.HRF2': [],
    'CF.HRF6': [
      ['MTG-SENT-1 (P2): every distribution row "sent", channel email (M8b)', o.draftDistributed ? (o.draftDistributed.rowsStatus === 'sent' && sameJson(o.draftDistributed.channels, ['email']) ? 'seen' : 'not seen') : 'not observed', o.draftDistributed ?? null],
      ['a transmittal acknowledged through PATCH (static: the route takes status acknowledged; no rule names it)', scan ? (scan.transmittalPatchTakesAcknowledged ? 'seen' : 'not seen') : 'not observed', null],
    ],
    'CF.TRN1': [['expected unchanged after the HR-X1 batch (r3b IQ-3): re-run then', fixed('HR-X1') ? 'the batch has landed: this run is the re-run' : 'the batch has not landed', null]],
    'CF.L213': [['the close action itself refused to that member', seen(o.l213?.closeAction, WP8.leads.L213.value.closeAction), o.l213 ?? null]],
    'CF.L146': [['HR-A2 (owner question O7): transmittals, correspondence and drawings deleted under document_control:update', 'recorded', null]],
    'CF.DVAL1': [['classified after the HR-X1 batch too (it rewrites normalizeAttachmentRefs\' judge)', fixed('HR-X1') ? 'the batch has landed' : 'the batch has not landed', null]],
    'CF.LDETAILS': [['the readers found by the scan', scan?.detailsReaders ? 'recorded' : 'not observed', scan?.detailsReaders ?? null]],
  };
};
const confirmFirstFlow = () => {
  const scan = obs.static || staticScan();
  obs.static = scan;
  const wp7 = wp7SitePromotion();
  obs.wp7SitePromotion = wp7 || { file: WP7_RESULT, note: 'absent: CF.HRF4\'s site-staff item is a gap (WP8ADJ Q8)' };
  const items = confirmFirstItems({ o: obs, verdictOf: (id) => knownAnswers[id]?.verdict ?? null, scan, wp7 });
  const seenOf = confirmFirstObservations({ o: obs, scan });
  const observationsOf = (id) => seenOf[id].map(([name, state, value]) => ({ name, state, value }));
  const split = (pairs) => {
    const present = []; const absent = []; const gap = [];
    for (const [name, state] of pairs) (state === 'present' ? present : state === 'absent' ? absent : gap).push(name);
    return { present, absent, gap };
  };
  // The severity evidence the integration owner decides from (WP8ADJ Q4, Q5).
  obs.safeArchSeverity = { F8: obs.safetyF8 ?? null, '087-FLD': obs.safety087?.score ?? null, '052-FLD': obs.safety052 ?? null, otherSurfacesExclude: { workspace: obs.safetyWorkspaceF8 ?? null, dashboard: obs.safetyDashboardF8 ?? null }, rule: 'P2 provisional (a dashboard figure, 5 per archived incident, no workflow, money or data effect); P1 only if the run shows more (WP8ADJ Q4)' };
  obs.rfiRespSeverity = { observed: obs.rfiResp ?? null, firstPartyCallers: scan.webCallersOfUpdateRfiResponse, rule: 'P1 provisional: an official answer of a closed record rewritten with no history breaks record integrity; the API is a supported surface (the mobile team consumes it); not lowered unless the rewrite is visible nowhere (WP8ADJ Q5)' };
  const details = {
    'CF.HRF4': json({ wp7, d1: obs.fld087?.d1 }, 800), 'CF.HRF5': 'HR-F5 undecided (O2)', 'CF.HRQ5': 'HR-Q5 undecided (O4)', 'CF.HRQ4': `${json(obs.hardDelete, 600)}; HR-Q4 undecided (O4)`,
    'CF.HRF3': `${json(obs.approverBypass, 400)}; HR-F3 undecided (O5)`, 'CF.SAFEARCH': `${json(obs.safeArchSeverity, 1000)}`, 'CF.RFIRESP': `${json(obs.rfiRespSeverity, 1000)}`,
    'CF.HRK1rfi': `${json(obs.overdueF8, 600)}; HR-K1 undecided (WP-9's main row)`, 'CF.HRF1': `${json(obs.pmApproveWhilePending, 600)}; HR-F1 undecided (O5)`, 'CF.HRF2': 'HR-F2 undecided (O5)',
    'CF.HRF6': `${json({ draftDistributed: obs.draftDistributed, editAfterDistribution: obs.editAfterDistribution, actionItems: obs.actionItems }, 1000)}; HR-F6 undecided (O5)`,
    'CF.TRN1': `${json(obs.trn1, 600)}; WP8-TRN-1 P3`, 'CF.L213': `${json(obs.l213, 600)}; L213 P3`, 'CF.L146': `${json(obs.l146, 400)}; L146 P3 / P2; HR-A2 is O7`, 'CF.DVAL1': `${json(obs.dval1, 800)}; D-VAL-1 P3`,
    'CF.LDETAILS': `${json({ production: scan.productionDropsDetails, readers: scan.detailsReaders }, 1000)}; L-DETAILS P3 proposed (information lost in production, nothing written)`,
  };
  for (const id of Object.keys(items)) cf(id, { ...split(items[id]), observations: observationsOf(id), detail: details[id] });
};

// -- the run ------------------------------------------------------------------------------------------------------------------
const main = async () => {
  console.log(`wp8-field-proof: ${ACTIVE.length} of ${EXPECTED_CHECKS} checks active${ONLY ? ` (--only=${[...ONLY].join(',')})` : ''}${SKIP ? ` (--skip=${[...SKIP].join(',')})` : ''}${PROJECT_FILTER ? ` (--project=${PROJECT_FILTER})` : ''}; sections ${[...selectedSections].join(' ')}; deep projects ${NEED_DEEP.join(', ') || 'none'}; throwaways F8 ${NEED_F8 ? 'yes' : 'no'}, F8V ${NEED_F8V ? 'yes' : 'no'}; companies ${NEED_COMPANIES.join(', ')} only; fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}; in process\n`);
  if (ACTIVE.length !== CHECKS.length) console.log(`not exercised in this run (filtered out): ${CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id).join(', ')}\n`);
  await setup();
  // The deep projects first: reads and the one refused request, before any throwaway exists.
  if (on('F87')) await h.section('087-FLD: the stored moments, reads and the party request refused before any write', fld087Flow);
  if (on('F52')) await h.section('052-FLD: the stored moments and the 052 PM\'s reads', fld052Flow);
  if (on('TS')) await h.section('in process: the overtime multiplier', async () => pureMultiplier());
  // F8: each step in its own section, so a failed one is a setup error; the order is the book's (WP8.F8.choreography).
  if (NEED_F8) {
    await h.section('F8: F8-0 the project, its team and activities', async () => { await f8Create(); ctx.f8Ready = true; });
    if (ctx.f8Ready) await h.section('F8: F8-1 workers and crew', async () => { await f8Workers(); ctx.f8Workers = true; });
    if (ctx.f8Ready) await h.section('F8: F8-2 an own upload', async () => { await f8Evidence(); ctx.f8Evidence = true; });
    if (ctx.f8Ready) await h.section('F8: DA-DE the daily logs', f8Days);
    if (ctx.f8Workers) await h.section('F8: TS-1 .. TS-7 the timesheets', f8Timesheets);
    if (ctx.f8Evidence) await h.section('F8: Q-1 .. Q-5 NCRs, legacy ITPs and the score', f8Quality);
    if (ctx.f8Ready) await h.section('F8: P-1 .. P-3 punch and observations', f8Punch);
    if (ctx.f8Evidence) await h.section('F8: SF-1 .. SF-4 safety', f8Safety);
    if (ctx.f8Ready) await h.section('F8: R-1 .. R-4 RFIs', f8Rfis);
    if (ctx.f8Ready) await h.section('F8: SUB-1 .. SUB-4 submittals', f8Submittals);
    if (ctx.f8Ready) await h.section('F8: D-1 .. D-3 drawings', async () => { await f8Drawings(); ctx.f8Drawings = true; });
    if (ctx.f8Drawings) await h.section('F8: T-1 .. T-3 the transmittal and correspondence probes', f8Transmittals);
    if (ctx.f8Ready) await h.section('F8: M-1 .. M-3 meetings', f8Meetings);
    if (ctx.f8Ready) await h.section('F8: L213 a task closed through PATCH', f8L213);
  } else {
    for (const id of ['S.F8.create', 'S.F8.workers', 'S.F8.evidence', 'S.F8.archived']) rec(id, true, { detail: 'not needed (no selected check runs on F8)' });
  }
  if (ctx.f8) await h.section('F8: the end (jobs, workers, archive)', f8End);
  if (NEED_F8V) {
    await h.section('F8V: V-0 the project, its team and 6 major NCRs', async () => { await f8vCreate(); ctx.f8vReady = true; });
    if (ctx.f8vReady) await h.section('F8V: V-1 .. V-5 the clamp and the score-moving probes', f8vProbes);
  } else {
    for (const id of ['S.F8V.create', 'S.F8V.archived']) rec(id, true, { detail: 'not needed (no selected check runs on F8V)' });
  }
  if (ctx.f8v) await h.section('F8V: the end (jobs, archive)', f8vEnd);
  await h.section('087-FLD: unchanged across the run', deepUnchanged);
  if (on('CF')) await h.section('confirm-first classification', async () => confirmFirstFlow());
};

/** The per-check records, the known answers, the confirm-first classifications and the tally, written in cleanup (always). */
const recordObservations = () => {
  for (const [id, r] of Object.entries(records)) r.registered = ACTIVE_IDS.has(id);
  for (const [id, k] of Object.entries(knownAnswers)) k.registered = ACTIVE_IDS.has(id);
  h.observe('checks', records);
  h.observe('knownAnswers', knownAnswers);
  h.observe('confirmFirst', confirmFirst);
  h.observe('fixes', { ...FIXES, git: obs.fixesGit ?? null, contract: CONTRACT });
  h.observe('runObservations', { ...obs, f8: ctx.f8 ? { id: ctx.f8.id, workers: ctx.f8.workers, acts: ctx.f8.acts } : null, f8v: ctx.f8v ? { id: ctx.f8v.id } : null, fingerprints: ctx.fingerprints });
  h.observe('jobsCancelled', ctx.jobsCancelled);
  const known = Object.entries(knownAnswers).filter(([id]) => ACTIVE_IDS.has(id)).map(([, k]) => k);
  const tally = {
    expectedChecks: EXPECTED_CHECKS,
    active: ACTIVE.length,
    recorded: Object.keys(records).length,
    activeRecorded: Object.keys(records).filter((id) => ACTIVE_IDS.has(id)).length,
    pass: Object.entries(records).filter(([id, r]) => ACTIVE_IDS.has(id) && ['PASS', 'BLOCKED', 'STORED-PRE-FIX'].includes(r.verdict)).length,
    fail: Object.entries(records).filter(([id, r]) => ACTIVE_IDS.has(id) && r.verdict === 'FAIL').length,
    decidedRedFailing: Object.keys(DECIDED_RED).filter((id) => ACTIVE_IDS.has(id) && records[id]?.verdict === 'FAIL'),
    otherFailing: Object.entries(records).filter(([id, r]) => ACTIVE_IDS.has(id) && r.verdict === 'FAIL' && !DECIDED_RED[id]).map(([id]) => id),
    knownAnswers: { value: known.filter((k) => k.status === 'PASS').length, blocked: known.filter((k) => k.status === 'BLOCKED').length, storedPreFix: known.filter((k) => k.status === 'STORED-PRE-FIX').length, fail: known.filter((k) => k.status === 'FAIL').length, wrong: known.filter((k) => k.verdict === 'wrong').length },
    confirmFirst: Object.fromEntries(Object.entries(confirmFirst).map(([id, c]) => [id, c.classification])),
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
  };
  h.observe('tally', tally);
  console.log(`\ntally: ${tally.pass} pass, ${tally.fail} fail of ${tally.activeRecorded} recorded (${tally.active} active); failures: ${tally.otherFailing.join(', ') || 'none'}; known answers: ${tally.knownAnswers.value} value, ${tally.knownAnswers.blocked} BLOCKED, ${tally.knownAnswers.storedPreFix} STORED-PRE-FIX, ${tally.knownAnswers.fail} fail (${tally.knownAnswers.wrong} wrong)`);
  console.log(`confirm-first: ${Object.entries(confirmFirst).map(([id, c]) => `${id} ${c.classification}`).join('; ') || 'not classified'}`);
};

/** The throwaway name prefixes and the PM who lists them (no live throwaway of any run may be left). */
const THROWAWAY_NAMES = [[F8B.project.name, 'pm'], [F8VB.project.name, 'pm']];
const cleanup = async () => {
  const notes = [];
  for (const stepFn of ctx.cleanup.reverse()) {
    try { notes.push(String(await stepFn())); } catch (error) { notes.push(`cleanup failed: ${error.message}`); }
  }
  if (!ctx.cleanup.length) notes.push('nothing to remove');
  const throwaways = {};
  for (const [pattern, who] of THROWAWAY_NAMES) {
    if (!ctx.sessions[who]) continue;
    try {
      const prefix = String(pattern).replace('<stamp>', '').trim();
      const page = await get(who, `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(prefix)}`);
      const found = listOf(page.body?.data).filter((p) => String(p.name || '').startsWith(prefix));
      const live = found.filter((p) => !p.archivedAt);
      throwaways[prefix] = { total: found.length, live: live.map((p) => ({ id: p.id, name: p.name })) };
      notes.push(`throwaway check (GET /projects as ${who}, ${h.said(page)}): ${found.length} '${prefix}' projects, ${live.length} live${live.length ? ` (${live.map((p) => `${p.name} ${p.id}`).join(', ')})` : ''}`);
    } catch (error) {
      notes.push(`throwaway check failed: ${error.message}`);
    }
  }
  try { h.observe('throwawayCheck', throwaways); } catch { /* recorded once */ }
  notes.push(`companies touched: ${Object.keys(ctx.orgs).join(', ') || 'none'} (087 for every write; 052 read only, and only with F52: WP8ADJ Q9)`);
  notes.push(`queued jobs cancelled through the product route: ${ctx.jobsCancelled.map((j) => `${j.project} ${j.cancelled}${j.refused.length ? ` (refused ${j.refused.length})` : ''}`).join(', ') || 'none'}`);
  if (ctx.f8 || ctx.f8v) notes.push(`residue (stamp ${h.STAMP}; WP8ADJ Q10): F8 and F8V archived with their records; workers ${Object.keys(ctx.f8?.workers || {}).join(', ') || 'none'} set inactive in 087's roster; the permission template "${F8B.l213.name}" ${obs.l213?.template?.made ? 'created' : 'reused'} by name`);
  notes.push(`deep projects: ${ctx.deepWrites.length ? `UNEXPECTED WRITES: ${ctx.deepWrites.join('; ')}` : 'nothing written (087-FLD\'s fingerprint unchanged; the party\'s request refused before any write)'}`);
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

module.exports = { __wp8: { bookCheck, kaStatus, judge, allVerdict, isRefusal, storedLive, storedFld087, storedFld052, staticScan, classifyItems, confirmFirstItems, confirmFirstObservations, wp7SitePromotion, nodeAt, CHECKS, EXPECTED_CHECKS, SECTION_PROJECTS, CF_SOURCES, CATCHERS, OPTIONAL_CATCHERS, FIX_CATCHERS, COLLATERAL, DECIDED_RED, CONTRACT, FIXES, RULES, FIXTURE, STATE_STEPS, PERSONAS, NEED_COMPANIES, TEST_GAPS, DEVIATIONS, LEADS, RESCAN_AFTER_BATCHES, WP8_PATCH_LEAVES, WP8_REFS, LDETAILS_READERS, PUNCH_TABLE } };

h.run({ main, cleanup });
