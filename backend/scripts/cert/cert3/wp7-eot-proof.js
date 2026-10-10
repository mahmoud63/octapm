'use strict';

/**
 * WP-7 (contract time: EOT and the weather 70% rule) primary proving run: the known-answer run of plan section 4 WP-7 on
 * the cert3d population (docs/certification/OCTAPM_CERT3_PLAN.md at bde300d: section 4 WP-7 :837-871: rules :838-843,
 * evidence :845-861, mutations :863, existing evidence :865, confirm first :867-870; section 6.2 WP-7 guards :1151;
 * section 5 HR-F4 :1061, HR-C10 :1078, HR-C11 :1079; the defect-fix list :1107-1121 ("weather promotion in one
 * transaction" :1115); section 1.1 the CLAUDE.md weather row :91; section 3.2 087-COM :427, 087-FLD :430, 052-FLD :445).
 * Preparation C:\Temp\octapm-cert\scratch\wp7\WP7-PREP.md (+ wp7-checks-draft.json, wp7-mutations-draft.json,
 * derive-t7.json); the BINDING integration-owner adjudication C:\Temp\octapm-cert\scratch\wp7\WP7-ADJUDICATION.md (Q1-Q13,
 * cited WP7ADJ) with the standing rulings it lists (product routes only; no SQL fixtures, though read-only SQL and a pure
 * lock-holder connection are allowed; a value equal to HEAD's today under an undecided rule reads BLOCKED; every writing
 * check and every catcher on a throwaway; N-round concurrency probes; every expected figure a book leaf, A10; company 087
 * plus the deep read of 052-FLD only); moment map build/MOMENT-MAP.md (rows 153, 177-181, 247-249, 259-263, 277); answer
 * books answers/commercial.js (WP7.*, deep.087-COM.*, claudeMd.weather70) and answers/field-controls.js (WP8.dailyLog.*,
 * WP8.weather.*, WP8["052-FLD"].weather*) AFTER the WP-7 book patch (C:\Temp\octapm-cert\scratch\wp7\book\book-insert.js:
 * commercial ca7e84ed -> d00954da, field-controls ebc5c740 -> dcdeb343; the proof refuses to load without it).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp7-eot-proof.js [--only=W,COM] [--project=T7] [--skip=CF]
 *
 * Filters. Sections split by project, so that a partial population and a mutant both stay where they belong:
 *   S      setup (always runs, for the projects and state files the selected checks need)
 *   T1     EOT states and codes on the throwaway T7          T23  the approvals, the cumulative and the PATCH probe on T7
 *   T45    impact and LD on T7 (the claim and /eot/calculate) W    the weather boundaries and allowance 0 on T7
 *   WH     the half-day register on the throwaway T7H         PROMO  promotion from the daily log on T7 (the blocker queue)
 *   COM    087-COM: the stored eot.figures moment, live reads and POST /eot/calculate (writes nothing, WP7ADJ Q3)
 *   F87    087-FLD: the stored weather moments and live reads  F52  052-FLD: the same, read only (WP7ADJ Q7)
 *   CF     the confirm-first classifications
 * --only=<sections> keeps those sections, --project=<T7|T7H|087-COM|087-FLD|052-FLD|static> the sections that touch that
 * project, --skip=<sections> drops sections. A section or project not listed here is refused as unknown. Selecting CF
 * selects every section CF classifies from (W WH T23 T45 PROMO COM F87 F52); skipping one of those needs --skip=CF too. A
 * filtered-out check is neither registered nor recorded. The T7 choreography (T7-0 .. end) runs whole whenever one
 * selected check runs on T7 (its steps depend on each other, as WP-6's B6); T7H's whenever WH is selected. The primary
 * run, the final run and every mutation run take no flags (mutate-multi.js spawns the proof without arguments). Every
 * write is on T7 or T7H in company 087; a session in company 052 is opened only when F52 is selected, and only reads.
 *   Debug run on the partial population (087-COM and 087-FLD built by build order run 1; no 052-FLD state of a cert3d
 *   run):  --skip=F52,CF  (registers 50 checks + G.5xx; company 087 only).
 *
 * In process (CERT_INPROCESS=1, through the lock runner only) on the certification database. Every expected figure is
 * an answer-book key (A10); every figure the T7 and T7H choreographies type is read from a book leaf (WP7.T7.*,
 * WP7.T7H.*, WP7.promotion.*) or is a fixture input named in FIXTURE below (the T7H half-day rows the book's unexported
 * T7H constant holds, bound at load to every leaf that states them; names, reasons and dates). Deep projects are resolved
 * by their exact names through the API as their company's PM (exactly one live project each); build state files are read
 * only for moment answers and ids (C:\Temp\octapm-cert\state\cert3\<code>.json, steps[].out and steps[].blocked).
 *
 * WHERE EACH CHECK RUNS (the CHECKS table carries it per id):
 *   T7       the throwaway project of company 087 this run creates and archives (WP7.T7.project: completionDate
 *            2027-06-30, ldRatePerDay 1,000.00, weatherAllowanceDays 20 explicit, defaultRetentionRate 10, so WP-7 never
 *            depends on HR-C1; WP7ADJ Q1; WP7.T7.choreography T7-0 .. end): every writing check and every section 6.2
 *            catcher. Days are offsets from 087's run date R = min(today in UTC, today in the company's zone), every
 *            transaction dated R-30 .. R-1; nothing is placed on the five-day calendar, so a weekend R does not fail it.
 *   T7H      the half-day throwaway in 087 (WP7.T7H.*): 28 x 0.5 and one 1.5, so an HR-C11 fix cannot shift T7's figures.
 *   087-COM  stored: step eot.figures (MOMENT-MAP row 153); live: reads and POST /eot/calculate, which writes nothing
 *            (calculateEot reads the project and its activities); the proof asserts 087-COM's EOT claims, weather delays
 *            and audit events unchanged across that call (counts and latest ids, read-only SQL; WP7ADJ Q3).
 *   087-FLD  stored: steps weather.at13.read / weather.at14.read (MOMENT-MAP rows 178, 179); live: reads only.
 *   052-FLD  stored: the same steps (rows 247, 248); live: GET /weather-delays as 052's planner (WP7ADJ Q7).
 *   static   source scans (confirm-first evidence only).
 *
 * The PROMO-TX blocker queue (WP7ADJ Q2; the WP-2 r3 queue-behind-a-blocker design, wp2-choreography.js, and
 * d-id-1-guards-proof.js's second connection): a separate pg connection (never the app's Prisma pool) opens a
 * transaction, takes SELECT id FROM "DailyLogDelay" WHERE id = $1 FOR UPDATE on the round's entry, writes nothing and
 * ROLLBACKs. Each product request is confirmed waiting before the next is sent: a new backend whose pg_blocking_pids()
 * reaches the blocker (directly or through a request queued behind it) and whose statement names "DailyLogDelay". The
 * barrier is released within 2.5 s of the first request (WP7.promotion.barrier: inside Prisma's 5 s interactive-
 * transaction window). A barrier that does not form, a request that settles before the release, or a release later than
 * the budget is a setup error (R-SET, exit 1), never a verdict. S.T7.barrier proves the mechanism first on its own entry.
 * N=3 race rounds and N=3 failure rounds, each on a fresh entry; a known answer is green only if every round is.
 *
 * Mutation safety (section 6.2 WP-7; mutate-multi.js runs the proof without flags, so every section runs under every
 * mutant): the catchers of M-70 (W.T7.a20at14, W.T7.a30at21, W.T7.a10at7) and M-STAT (T1.T7.patchApprovedToDraft,
 * T1.T7.rejectApproved) and of the optional rule mutants (WP7ADJ Q5) all write only on T7; on the deep projects the proof
 * reads and calls /eot/calculate, which writes nothing under any WP-7 mutant.
 *
 * KNOWN ANSWERS (KA.*): judged value (pass), today (BLOCKED / known, with the ref, counted separately, never exit 2,
 * while the rule is undecided) or wrong (fail). No WP-7 rule is decided (HR-C10, HR-C11 and HR-F4 wait for the owner)
 * and the one WP-7 defect fix (PROMO-TX, plan :1115) has neither been reproduced nor landed (its severity is decided at
 * this run from the reproduction, WP7ADJ Q6). A decided rule's today fails (the WP-1 ka() rule); a build moment observed
 * before that fix commit reads STORED-PRE-FIX (the four FLD known answers: rows built before the HR-C11 fix keep their
 * truncated values until the exit rebuild, WP7ADJ Q9, MOMENT-MAP row 180). A probe whose own setup fails is a setup error
 * (exit 1), never 'wrong' (R-SET).
 * CONFIRM-FIRST (CF.*): plan :867-870 and the fix list :1115, classified from this run's observations as CONFIRMED /
 * PARTIAL / REJECTED / TEST GAP and reported (no rule decided); a landed fix turns its CF into a defect check that must
 * read REJECTED.
 *
 * Expected at HEAD on cert3d (after the WP-7 book patch, no fix commit set): 55 checks + G.5xx; 0 FAIL, exit 0, PASS
 * (harness provisional classification: none, no defect checks). Known answers BLOCKED (13): KA.T2.plannerPatchApproved,
 * KA.T4.T7, KA.T4.087COM.calculate (HR-C10); KA.W.T7.allowanceZero, KA.W.T7H.half28, KA.W.T7H.storedOneAndHalf,
 * KA.FLD.087.stored, KA.FLD.087.live, KA.FLD.052.stored, KA.FLD.052.live (HR-C11); KA.PROMO.T7.race, KA.PROMO.T7.failure
 * (PROMO-TX); KA.F4.T7.sitePromotion (HR-F4). CF reported (3): CF.HRC11, CF.HRC10 and CF.PROMOTX CONFIRMED expected.
 * Green: 11 setup + 27 HARD + 1 STORED, and G.5xx (the failure rounds answer 404 NOT_FOUND, never 500: the barrier is
 * released inside the 5 s window). Residue at HEAD (WP7ADJ Q11): 3 duplicated and 3 orphaned contractual weather rows on
 * the archived T7, listed by the cleanup.
 * Without the WP-7 book patch the proof refuses to load (the guard below).
 * After a decision or a fix (FIXES set, with its CONTRACT fields): HR-C10 -> its three KAs turn value checks, CF.HRC10
 * must read REJECTED, M-LOCK (tallied) and M-C10i join; HR-C11 -> KA.W.T7.allowanceZero and KA.W.T7H.* value, the four
 * FLD KAs read STORED-PRE-FIX until the exit rebuild, KA.W.T7H.half28 becomes a fourth M-70 catcher, M-C11z / M-C11d
 * join; PROMO-TX fixed (if P1) -> its two KAs value, CF.PROMOTX REJECTED, M-PTX; HR-F4 -> KA.F4 value, M-F4.
 *
 * Adjudication applied (WP7ADJ): Q1 T7 carries every write and every catcher, T7H the half-day register (MOMENT-MAP
 * deviation recorded by key when the proof lands: meta.deviations); Q2 the blocker queue (N=3 + N=3); Q3 /eot/calculate on
 * 087-COM a deep read with its invariance asserted; Q4 M-STAT tallied now, M-LOCK after the HR-C10 fix (FIX_CATCHERS);
 * Q5 the optional rule mutants run untallied (OPTIONAL_CATCHERS); Q6 PROMO-TX's severity from this run
 * (observations.runObservations.promoSeverityEvidence); Q7 the 052-FLD live read (the count stays 55); Q8 the site
 * engineer's promotion probed here, classified by WP-8; Q9 the stored 087-FLD / 052-FLD known answers STORED-PRE-FIX after
 * the HR-C11 fix until the exit rebuild; Q10 the leads recorded only (meta.leads); Q11 the residue listed by the cleanup;
 * Q12 the two field-controls refs (the load guard); Q13 T7 cites only its own uploaded documents (XDOC-1 never re-tested).
 * EXPECTED_CHECKS: WP7-PREP's 55 (wp7-checks-draft.json), fixed; G.5xx on top.
 *
 * Exit 0 pass / 2 a check failed / 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp7-eot-proof.json (every check with its plan reference, answer-book key, expected,
 * observed and verdict in observations.checks; the KA verdicts in observations.knownAnswers; the CF classifications in
 * observations.confirmFirst; the fix state in observations.fixes; the blocker rounds, the barrier traces and the
 * severity evidence in observations.runObservations; all written in cleanup, so a setup error still carries what was
 * observed).
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');
const COMMERCIAL = require('./answers/commercial');
const FIELD = require('./answers/field-controls');
const SCHEDULE = require('./answers/schedule');

const { WP7 } = COMMERCIAL;
const D087 = COMMERCIAL.deep['087-COM'];
const CLAUDE_MD = COMMERCIAL.claudeMd;
const { WP8 } = FIELD;

// -- the WP-7 book patch must be applied (G1-G18 as WP7ADJ Q1-Q13 rule them) ------------------------------------------
/**
 * A book node by its key. A member of the book may itself hold dots ("submitWithoutProof.noDocument",
 * "allowanceZero.T7", "087-FLD.read"): at each node the longest run of parts that names a member is taken.
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
const BOOKS = { WP7: COMMERCIAL, deep: COMMERCIAL, claudeMd: COMMERCIAL, WP8: FIELD };
const leafAt = (key) => nodeAt(BOOKS[String(key).split('.')[0]] || COMMERCIAL, key);
/** The 36 keys the WP-7 book patch adds (C:/Temp/octapm-cert/scratch/wp7/book/new-key-paths.txt). */
const WP7_PATCH_LEAVES = [
  'WP7.T1.submitWithoutProof.noDocument', 'WP7.T1.submitWithoutProof.noActivity', 'WP7.T1.rejectWithReason', 'WP7.T1.patchApprovedToDraft',
  'WP7.T1.rejectApproved', 'WP7.T1.refsNotFound', 'WP7.T4.on087COM', 'WP7.T4.storedFields', 'WP7.T5.storedFields', 'WP7.weather.allowanceZero.T7',
  'WP7.weather.087-FLD.read', 'WP7.mutations.ruleMutants', 'WP7.mutations.fixMutations', 'WP7.T7.project', 'WP7.T7.team', 'WP7.T7.network',
  'WP7.T7.claims', 'WP7.T7.weatherSequence', 'WP7.T7.entries', 'WP7.T7.residue', 'WP7.T7.choreography', 'WP7.T7H.project', 'WP7.T7H.team',
  'WP7.T7H.half28', 'WP7.T7H.choreography', 'WP7.promotion.barrier', 'WP7.promotion.feeds', 'WP7.promotion.race', 'WP7.promotion.failure',
  'WP7.promotion.sitePromotion', 'WP7.CF.HRC11', 'WP7.CF.HRC10', 'WP7.CF.PROMOTX', 'deep.087-COM.eotWeatherLink', 'deep.087-COM.completion',
  'deep.087-COM.weatherDefault',
];
/** The known answers and their refs (the book's WP7_KNOWN, and the two field-controls leaves of WP7ADJ Q12). */
const WP7_REFS = [
  ['WP7.T2.plannerPatchApproved', 'HR-C10'], ['WP7.T4.criticalPathImpactDays', 'HR-C10'], ['WP7.T4.ldApplicableDays', 'HR-C10'],
  ['WP7.T4.ldLiability', 'HR-C10'], ['WP7.T4.storedFields', 'HR-C10'], ['WP7.T4.on087COM', 'HR-C10'],
  ['WP7.weather.allowanceZero.allowance', 'HR-C11'], ['WP7.weather.allowanceZero.T7', 'HR-C11'], ['WP7.weather.fractional.28xHalf.consumedPct', 'HR-C11'],
  ['WP7.weather.fractional.28xHalf.warning', 'HR-C11'], ['WP7.T7H.half28', 'HR-C11'], ['WP7.weather.fractional.storedOneAndHalf', 'HR-C11'],
  ['WP7.weather.087-FLD.composition', 'HR-C11'], ['WP7.weather.087-FLD.read', 'HR-C11'], ['WP7.weather.052-FLD', 'HR-C11'],
  ['WP7.promotion.race', 'PROMO-TX'], ['WP7.promotion.failure', 'PROMO-TX'], ['WP7.promotion.sitePromotion', 'HR-F4'],
  ['WP8.dailyLog.promoteResponseVsStored', 'HR-C11'], ['WP8.weather.nonContractualAddsNothing', 'HR-C11'],
];
{
  const missing = WP7_PATCH_LEAVES.filter((key) => { const leaf = leafAt(key); return !leaf || typeof leaf !== 'object' || !('value' in leaf); });
  if (missing.length) throw new Error(`the answer books carry no WP-7 leaf ${missing.join(', ')}: apply the WP-7 book patch (C:/Temp/octapm-cert/scratch/wp7/book/book-insert.js) first`);
  const bad = WP7_REFS.filter(([key, ref]) => { const leaf = leafAt(key); return !leaf || leaf.ref !== ref || leaf.today === undefined || leaf.assumption !== true; });
  if (bad.length) throw new Error(`the answer books carry the pre-WP-7 form of ${bad.map(([key]) => key).join(', ')} (no today, ref or assumption: G2, WP7ADJ Q12): apply the WP-7 book patch first`);
  const g3 = WP7.T2.plannerPatchApproved.value;
  const g15 = String(WP7.mutations.seventyBoundary.value[0]).startsWith('W.T7.a20at14 red');
  const g16 = String(WP7.T2.cumulativeApprovedEotDays.source).split('; ').some((c) => c.endsWith(' @bde300d'));
  if (!('eotDaysGranted' in g3) || !g15 || !g16) throw new Error('the answer book carries the pre-WP-7 WP7.T2.plannerPatchApproved value, WP7.mutations or plan citations (G3, G15, G16): apply the WP-7 book patch first');
}

const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const REGISTER = 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md';
const STATE_DIR = 'C:/Temp/octapm-cert/state/cert3';
const REPO = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(__dirname, '..', '..', '..', 'src');

/** The deep projects: their company, exact name and the persona that resolves them. */
const DEEP = {
  '087-COM': { company: '087', name: 'CERT3 Commercial (087-COM)', resolver: 'pm' },
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
// where: 'T7' | 'T7H' | '087-COM' | '087-FLD' | '052-FLD' | 'stored:<code>' | 'static', or a comma list for a check
// that reads several. The section is the 6th argument (the sections split by project, see the header); the setup checks
// (S.*) carry no answer-book key (WP-1 L5). The book key is the check's primary leaf; the description names the others.
// <CHECKS>
const L = (...lines) => `${PLAN_DOC}:${lines.join(',')}`;
const C = (id, planRef, bookKey, where, description, section) => ({ id, section, planRef, bookKey, where, description });
const CHECKS = [
  C('S.book', L(845), null, 'static', 'answers/commercial.js and answers/field-controls.js load with the WP-7 patch (G1-G18 as WP7ADJ Q1-Q13 rule them; the load guard above): figures() rows carry ref in both books, every known answer this proof reads carries its today, its ref (HR-C10, HR-C11, HR-F4, PROMO-TX) and is an assumption with a value unequal to its today, every key this proof reads resolves, and the FIXTURE agrees with every leaf that states it', 'S'),
  C('S.state', L(427, 430, 445), null, 'stored:087-COM,087-FLD,052-FLD', 'the build state files the selected checks read are present with their WP-7 steps: 087-COM activities, weather-delay, eot.T2, eot.T3, eot.REJECTED, eot.SUBMITTED, eot.DRAFT, eot.figures done; 087-FLD and 052-FLD weather.at13.read and weather.at14.read done, weather.at13 and weather.at14 done or BLOCKED HR-C11 (087-FLD also weather.non-contractual done); a fix commit, when set, is the one git dates', 'S'),
  C('S.projects', L(427, 430, 445), null, '087-COM,087-FLD,052-FLD', 'the deep projects the selected checks read resolve by exact name through the API as their company\'s PM (087; 052 only when F52 is selected), exactly one live each, matching the state files; the 087 personas (pm, planner, site) and, with F52, 052\'s pm and planner sign in', 'S'),
  C('S.T7.create', L('845-850'), null, 'T7', 'T7-0: T7 created by the 087 PM (WP7.T7.project: startDate 2026-01-05, endDate and completionDate 2027-06-30, five_day, EGP, ldRatePerDay 1,000.00 read back in cents, weatherAllowanceDays 20 explicit, defaultRetentionRate 10); team planning_eng and site_engineer (WP7.T7.team)', 'S'),
  C('S.T7.network', L('849-850'), null, 'T7', 'T7-1: the planner\'s T7-C1 (10 d), T7-C2 (5 d, FS after T7-C1), T7-F4 (11 d); the product\'s CPM reads back TF 0 / 0 / 4 and critical true / true / false (WP7.T7.network; R-SET for T4 and T5)', 'S'),
  C('S.T7.evidence', L(839), null, 'T7', 'E1: E-T2 and E-T3 each get their own PDF through POST /projects/T7/attachments (recordType eot, the claim) and PATCH documentIds [that document]: each claim\'s attachmentRefs name it (T7\'s own documents only; XDOC-1 is the HR-X1 batch\'s, never re-tested, WP7ADJ Q13)', 'S'),
  C('S.T7H.create', L(860), null, 'T7H', 'H0: T7H created by the 087 PM (WP7.T7H.project: weatherAllowanceDays 20 explicit, EGP); team planning_eng (WP7.T7H.team)', 'S'),
  C('S.T7.barrier', L(1115), null, 'T7', 'P0: the blocker-queue self-test (WP7.promotion.barrier; WP7ADJ Q2): a separate pg connection holds FOR UPDATE on T7\'s BAR entry; the planner\'s PATCH of its notes is seen waiting (pg_blocking_pids reaches the blocker) and the blocker rolls back within 2.5 s; the PATCH then answers 200 and BAR carries its notes. A barrier that does not form is a setup error, never a verdict', 'S'),
  C('S.087COM.chain', L(849), null, '087-COM', 'GET activities on 087-COM (planner): the build\'s A110 and A120 live, TF 0 each (schedule.js WP1.T1.A110.TF / A120.TF), A120 depends FS on A110 (R-SET for KA.T4.087COM.calculate)', 'S'),
  C('S.T7.archived', L(845), null, 'T7', 'end: T7\'s queued jobs cancelled through POST /projects/T7/jobs/:id/cancel, none left (WP7.T7.residue); T7 archived by the PM (archivedAt read back); the blocker connection holds no transaction', 'S'),
  C('S.T7H.archived', L(860), null, 'T7H', 'end: T7H\'s queued jobs cancelled, none left (WP7.T7.residue); T7H archived by the PM (archivedAt read back)', 'S'),

  C('T1.T7.createApproved', L(846), 'WP7.T1.createApproved', 'T7', 'E5, POST /eot {status: approved} otherwise valid (planner): \'400 VALIDATION_ERROR\' with error.details naming the field status; T7\'s claim count unchanged', 'T1'),
  C('T1.T7.submitWithoutProof', L(839, 846), 'WP7.T1.submitWithoutProof', 'T7', 'E5, the planner submits a draft naming T7-C1 with no document and a draft with its own document and no activity: \'400 EOT_IMPACT_PROOF_REQUIRED\' with details {activityCount 1, supportingDocumentCount 0} and {0, 1} (WP7.T1.submitWithoutProof.noDocument / noActivity); both stay draft (catcher of the optional M-PROOF)', 'T1'),
  C('T1.T7.patchStatusSubmitted', L(839, 846), 'WP7.T1.patchStatusSubmitted', 'T7', 'E5, PATCH {status: submitted} on a draft (planner): \'400 VALIDATION_ERROR\', details naming status; it stays draft', 'T1'),
  C('T1.T7.patchStatusDraftOnSubmitted', L(839, 846), 'WP7.T1.patchStatusDraftOnSubmitted', 'T7', 'E5, PATCH {status: draft} on a submitted claim (planner): \'400 EOT_WORKFLOW_ACTION_REQUIRED\', details {fromStatus submitted, toStatus draft}; it stays submitted (catcher of the optional M-WF)', 'T1'),
  C('T1.T7.rejectWithoutReason', L(840, 846), 'WP7.T1.rejectWithoutReason', 'T7', 'E5, the PM rejects that submitted claim with {}: \'400 VALIDATION_ERROR\', details naming reason; it stays submitted (catcher of the optional M-REASON)', 'T1'),
  C('T1.T7.rejectWithReason', L(840, 846), 'WP7.T1.rejectWithReason', 'T7', 'E5, the PM rejects it with a reason: 200, status rejected, rejectionReason the reason sent, rejectedBy the PM', 'T1'),
  C('T1.T7.resubmitRejected', L(839, 846), 'WP7.T1.resubmitRejected', 'T7', 'E5, the planner submits the rejected claim: 200, status submitted', 'T1'),
  C('T1.T7.approveDraft', L(839, 846), 'WP7.T1.approveDraft', 'T7', 'E5, the PM approves a draft carrying T7-C1 and its own document: \'400 EOT_WORKFLOW_ACTION_REQUIRED\'; its status and cumulative unchanged (catcher of the optional M-WF)', 'T1'),
  C('T1.T7.patchApprovedToDraft', L(839, 846, 1151), 'WP7.T1.patchApprovedToDraft', 'T7', 'E3, the planner PATCHes {status: draft} on E-LK1 (approved after the PATCH probe): \'400 EOT_WORKFLOW_ACTION_REQUIRED\', details {fromStatus approved, toStatus draft}; it stays approved (catcher of M-STAT, the E6 entry; and of the optional M-WF)', 'T1'),
  C('T1.T7.rejectApproved', L(839, 846, 1151), 'WP7.T1.rejectApproved', 'T7', 'E3, the PM rejects E-LK2 (a second claim approved last) with a reason: \'400 EOT_WORKFLOW_ACTION_REQUIRED\', details {fromStatus approved, toStatus rejected}; it stays approved (catcher of M-STAT; and of the optional M-WF)', 'T1'),
  C('T1.T7.refsNotFound', L(846), 'WP7.T1.refsNotFound', 'T7', 'E5, PATCH /eot/<a random uuid>: \'404 EOT_CLAIM_NOT_FOUND\'; POST naming a random activity uuid: \'400 EOT_ACTIVITY_NOT_FOUND\'; POST naming a random weather-delay uuid: \'400 EOT_WEATHER_DELAY_NOT_FOUND\' (inside the create transaction, rolled back); T7\'s claim count unchanged', 'T1'),

  C('T2.T7.approve', L(841, 847), 'WP7.T2.cumulativeApprovedEotDays', 'T7', 'E1, E-T2 (delay 10, eot 10, T7-C1, linked to WR-6, its document): submit 200, PM approve 200: approved, cumulativeApprovedEotDays 10, revisedCompletionRecommendation 2027-07-10 (WP7.T2.revisedCompletionRecommendation), approvedBy the PM, officialAt set, its weather link WR-6', 'T23'),
  C('T3.T7.approve', L(841, 848), 'WP7.T3.cumulativeApprovedEotDays', 'T7', 'E1, E-T3 (delay 5, eot 5, T7-C2, its document) approved: cumulativeApprovedEotDays 15, revisedCompletionRecommendation 2027-07-15 (WP7.T3.revisedCompletionRecommendation); E-T2 still 10 / 2027-07-10 (catcher of the optional M-CUM)', 'T23'),
  C('KA.T2.plannerPatchApproved', L(847, 869, 1078), 'WP7.T2.plannerPatchApproved', 'T7', 'E2, after E-T3\'s approval the planner PATCHes E-T2 {eotDaysGranted: 30}: value 409 (code the fix\'s, CONTRACT pending), E-T2 still eotDaysGranted 10, cumulative 10; today 200, eotDaysGranted 30, cumulative 10 - HR-C10', 'T23'),

  C('KA.T4.T7', L(849, 869, 1078), 'WP7.T4.storedFields', 'T7', 'E4, E-T4 (draft; delay 10, eot 10; T7-C1 and T7-C2, TF 0 on one chain; T7\'s LD rate) read back and the same body through POST /eot/calculate: value impact 10, LD-applicable 0, LD 0.00, links at float 0; today impact 20 (the links summed), LD-applicable 10, LD 10,000.00 (WP7.T4.criticalPathImpactDays / ldApplicableDays / ldLiability) - HR-C10', 'T45'),
  C('T5.T7', L(850), 'WP7.T5.storedFields', 'T7', 'E4, E-T5 (draft; delay 10, eot 0; T7-F4, TF 4) read back and through /eot/calculate: impact 6, LD-applicable 6, LD 6,000.00 (WP7.T5.criticalPathImpactDays / ldApplicableDays / ldLiability), the link\'s floatDays 4', 'T45'),

  C('W.T7.a20at13', L(842, 855), 'WP7.weather.allowance20.at13.consumedPct', 'T7', 'W1, WR-6 (6) and WR-7 (7) contractual; GET /weather-delays (planner): allowance 20, contractualUsed 13, consumedPct 65 at 2 dp, warning false, remaining 7 (WP7.T7.weatherSequence W1 = WP7.weather.allowance20.at13.*)', 'W'),
  C('W.T7.a20at14', L(842, 855, 1151), 'WP7.weather.allowance20.at14.warning', 'T7', 'W2, + WR-1 (1): contractualUsed 14, consumedPct exactly 70, warning true, remaining 6 (WP7.weather.allowance20.at14.*, claudeMd.weather70; catcher of M-70)', 'W'),
  C('W.T7.nonContractual10', L(859), 'WP7.weather.nonContractual10', 'T7', 'W3, + WN-10 (10, contractual false): contractualUsed still 14; the month of WN-10 nonContractual 10 (catcher of the optional M-NC)', 'W'),
  C('W.T7.a30at20', L(856), 'WP7.weather.allowance30.at20.consumedPct', 'T7', 'W4, the PM sets the allowance 30; + WR-6b (6): contractualUsed 20, consumedPct 66.67 at 2 dp, warning false, remaining 10', 'W'),
  C('W.T7.a30at21', L(856, 1151), 'WP7.weather.allowance30.at21.warning', 'T7', 'W4b, + WR-1b (1): contractualUsed 21, consumedPct exactly 70, warning true, remaining 9 (catcher of M-70)', 'W'),
  C('W.T7.a10at6', L(857), 'WP7.weather.allowance10.at6.warning', 'T7', 'W5, the PM sets the allowance 10; WR-7, WR-6b, WR-1b and WR-1 PATCHed contractual false: contractualUsed 6, consumedPct 60, warning false, remaining 4', 'W'),
  C('W.T7.a10at7', L(857, 1151), 'WP7.weather.allowance10.at7.warning', 'T7', 'W5b, WR-1 PATCHed contractual true: contractualUsed 7, consumedPct exactly 70, warning true, remaining 3 (catcher of M-70)', 'W'),
  C('KA.W.T7.allowanceZero', L(861, 870, 1079), 'WP7.weather.allowanceZero.T7', 'T7', 'W6, the PM sets the allowance 0 and the project reads it back 0: value summary allowance 0, consumedPct 0; today allowance 20, contractualUsed 7, consumedPct 35, warning false, remaining 13 - HR-C11 (the warning recorded for CF.HRC11, no expected value: WP7.weather.allowanceZero.warning); W7 puts 20 back', 'W'),

  C('KA.W.T7H.half28', L(860, 868, 1079), 'WP7.T7H.half28', 'T7H', 'H1, 28 contractual delays of 0.5 day (planner, four a day on R-12 .. R-6): value allowance 20, contractualUsed 14, consumedPct 70, warning true, remaining 6; today each stored 0: 0, 0, false, 20 - HR-C11', 'WH'),
  C('KA.W.T7H.storedOneAndHalf', L(860, 868, 1079), 'WP7.weather.fractional.storedOneAndHalf', 'T7H', 'H2, one 1.5-day contractual delay (R-6) read back: value 1.5 (or the refusal CONTRACT names); today 1 (the Int column) - HR-C11', 'WH'),

  C('PROMO.T7.feeds', L(843, 878), 'WP7.promotion.feeds', 'T7', 'P1, the planner adds FEED (8 h on T7-C1, R-4) and promotes it: 200, weatherDelay {delayDays 1, contractual true}; the register gains one row of 1 day, contractual, the entry\'s description, linked to T7-C1; contractualUsed +1; the entry names that row', 'PROMO'),
  C('PROMO.T7.twice', L(843, 878), 'WP8.dailyLog.promoteTwice', 'T7', 'P1, FEED promoted again: \'409 DAILY_LOG_WEATHER_DELAY_EXISTS\'; no row added', 'PROMO'),
  C('KA.PROMO.T7.race', L(843, 1115), 'WP7.promotion.race', 'T7', 'P2, N=3 rounds, each a fresh 8 h entry on R-3 behind the blocker; two planner promotions, each seen waiting; release: value one 200 and one \'409 DAILY_LOG_WEATHER_DELAY_EXISTS\', one row, contractualUsed +1, the entry naming it; today two 200s, two rows (+2, two activity links), the entry naming the second, one orphaned - PROMO-TX (green only if every round is)', 'PROMO'),
  C('KA.PROMO.T7.failure', L(843, 1115), 'WP7.promotion.failure', 'T7', 'P3, N=3 rounds, each a fresh 8 h entry on the open day R-2 behind the blocker; the entry\'s DELETE, then its promotion, each seen waiting; release: value DELETE 200, the promotion not 2xx (code the fix\'s), no row; today DELETE 200, the promotion \'404 NOT_FOUND\', one contractual row with no entry - PROMO-TX', 'PROMO'),
  C('KA.F4.T7.sitePromotion', L(843, 1061), 'WP7.promotion.sitePromotion', 'T7', 'P4, the site engineer (daily_log.update, no eot:create, no eot:read) adds SITE (8 h, R-1) and promotes it; the planner reads the register: value 2xx, contractual false, contractualUsed +0; today 200, contractual true, +1 - HR-F4 (WP7ADJ Q8: classified by WP-8)', 'PROMO'),

  C('COM.stored.eotFigures', L(847, 848), 'WP7.T2.revisedCompletionRecommendation', 'stored:087-COM', 'stored step eot.figures done: T2 cumulative 10, recommendation 2027-07-10; T3 15, 2027-07-15 (WP7.T2 / WP7.T3; MOMENT-MAP row 153)', 'COM'),
  C('COM.live.claims', L(427, '846-848'), 'deep.087-COM.stateCoverage.eotClaims', '087-COM', 'GET /eot on 087-COM (planner): the five build claims (state ids) read draft, submitted, approved x2 (deep.087-COM.eotApprovedClaims), rejected; T2 10 / 2027-07-10 and T3 15 / 2027-07-15 live; ldRatePerDay 1,000.00 on each (deep.087-COM.ldRatePerDay); T2 eventType weather with one weather link naming WD-1 of 2 days (deep.087-COM.eotWeatherLink)', 'COM'),
  C('COM.live.project', L(427, 841), 'deep.087-COM.completion', '087-COM', 'GET /projects/087-COM (PM): completionDate 2027-06-30 (deep.087-COM.completion), ldRatePerDay 1,000.00 (deep.087-COM.ldRatePerDay); revisedCompletionDate recorded for CF.HRC10', 'COM'),
  C('COM.live.weatherDefault', L(842), 'deep.087-COM.weatherDefault', '087-COM', 'GET /weather-delays on 087-COM (planner; created without weatherAllowanceDays): allowance 20 by the column default, contractualUsed 2 (WD-1), consumedPct 10, warning false, remaining 18', 'COM'),
  C('KA.T4.087COM.calculate', L(845, 849, 1078), 'WP7.T4.on087COM', '087-COM', 'POST /eot/calculate on 087-COM (planner): delay 10, eot 10, A110 + A120 (TF 0, one F1 chain), the project\'s LD rate: value impact 10, LD-applicable 0, LD 0.00; today 20, 10, 10,000.00 - HR-C10; 087-COM\'s EOT claims, weather delays and audit events unchanged across the call (else wrong: WP7ADJ Q3)', 'COM'),

  C('KA.FLD.087.stored', L(430, 855, 868), 'WP7.weather.087-FLD.read', 'stored:087-FLD', 'steps weather.at13.read / weather.at14.read: value 13 / 65 / false / 7 then 14 / 70 / true / 6; today 11 / 55 / false / 9 then 12 / 60 / false / 8 (WP8.weather.below* / at*, todayBelow / todayAt) - HR-C11 (STORED-PRE-FIX after the fix until the exit rebuild, WP7ADJ Q9)', 'F87'),
  C('KA.FLD.087.live', L(430, 845, 855, 859, 868), 'WP7.weather.087-FLD.read', '087-FLD', 'GET /weather-delays on 087-FLD (planner): value contractualUsed 14, consumedPct 70, warning true, remaining 6, the build\'s non-contractual 10 in its month (WP8.weather.nonContractualAddsNothing, monthlyNonContractual); today 12, 60, false, 8, 10 - HR-C11 (rows built before the fix: STORED-PRE-FIX until the exit rebuild, MOMENT-MAP row 180)', 'F87'),
  C('FLD.087.allowance', L(430, 842), 'WP7.weather.087-FLD.allowance', '087-FLD', 'GET /projects/087-FLD (PM): weatherAllowanceDays 20, set explicitly; the register\'s summary allowance 20 (WP8.weather.allowance)', 'F87'),
  C('KA.FLD.052.stored', L(445, 845), 'WP7.weather.052-FLD', 'stored:052-FLD', 'steps weather.at13.read / weather.at14.read of 052-FLD: value 65 false then 70 true (WP8["052-FLD"].weatherBelowPct / weatherAtPct / weatherAtWarning); today 55 false then 60 false - HR-C11 (STORED-PRE-FIX after the fix until the exit rebuild)', 'F52'),
  C('KA.FLD.052.live', L(445, 845), 'WP7.weather.052-FLD', '052-FLD', 'GET /weather-delays on 052-FLD (052\'s planner, read only; WP7ADJ Q7): value contractualUsed 14, 70, warning true; today 12, 60, false (WP8.weather.nonContractualAddsNothing, the record set both builders judge) - HR-C11', 'F52'),

  C('CF.HRC11', L('860-861', 868, 870, 1079), 'WP7.CF.HRC11', 'T7,T7H,087-FLD,052-FLD,static', 'confirm-first HR-C11: fractional days truncated (KA.W.T7H.half28, KA.W.T7H.storedOneAndHalf, E-HALF\'s delayDays 1.5 read back, KA.FLD.087.stored, KA.FLD.052.stored); allowance 0 read as 20 (KA.W.T7.allowanceZero); reported beside it, never classified (HR-C11 keeps the flag): the warning only a flag (no notification naming weather on T7 since it crossed 70%; no server reader of the register summary, static) and the zero-allowance warning (no expected value) - reported', 'CF'),
  C('CF.HRC10', L(869, 1078), 'WP7.CF.HRC10', 'T7,087-COM', 'confirm-first HR-C10: approved claims stay editable (KA.T2.plannerPatchApproved); LD summed over activities (KA.T4.T7, KA.T4.087COM.calculate); reported beside them, never classified: the project date never moves (T7\'s and 087-COM\'s revisedCompletionDate after the approvals; HEAD keeps it manual as HR-C10 recommends) and the two recommendations (EOT-REC-2) - reported', 'CF'),
  C('CF.PROMOTX', L(843, 1115), 'WP7.CF.PROMOTX', 'T7,static', 'confirm-first, the fix list\'s weather promotion in one transaction: duplicates (KA.PROMO.T7.race) and orphans (KA.PROMO.T7.failure) counted in contractualUsed and in the activity links the forecast reads; severity evidence for the integration owner (WP7ADJ Q6) - reported', 'CF'),
];
/** Fixed before the first run: the checks above (G.5xx is the harness's own, on top). WP7-PREP's draft list (wp7-checks-draft.json): 55. */
const EXPECTED_CHECKS = 55;
// </CHECKS>
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((c) => c.id)).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');

/** Which projects each section touches (the --project filter selects sections). */
const SECTION_PROJECTS = {
  S: ['T7', 'T7H', '087-COM', '087-FLD', '052-FLD', 'static'],
  T1: ['T7'], T23: ['T7'], T45: ['T7'], W: ['T7'], PROMO: ['T7'], WH: ['T7H'],
  COM: ['087-COM'], F87: ['087-FLD'], F52: ['052-FLD'],
  CF: ['T7', 'T7H', '087-COM', '087-FLD', '052-FLD', 'static'],
};
for (const c of CHECKS) if (!SECTION_PROJECTS[c.section]) throw new Error(`check ${c.id}: section ${c.section} is not in SECTION_PROJECTS`);
for (const [flag, set] of [['only', ONLY], ['skip', SKIP]]) {
  for (const section of set || []) if (!SECTION_PROJECTS[section]) throw new Error(`--${flag}: no section ${section} (sections: ${Object.keys(SECTION_PROJECTS).join(' ')})`);
}
if (PROJECT_FILTER && !Object.values(SECTION_PROJECTS).some((list) => list.includes(PROJECT_FILTER))) throw new Error(`--project: no project ${PROJECT_FILTER}`);
/** The sections CF classifies from (confirmFirstFlow reads their records, known answers and observations). */
const CF_SOURCES = ['W', 'WH', 'T23', 'T45', 'PROMO', 'COM', 'F87', 'F52'];
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
/** The throwaways: T7 for T1 / T23 / T45 / W / PROMO (and CF), T7H for WH. */
const T7_SECTIONS = ['T1', 'T23', 'T45', 'W', 'PROMO'];
const NEED_T7 = T7_SECTIONS.some(on);
const NEED_T7H = on('WH');
/** The deep projects (live or stored) the selected checks need. */
const NEED_DEEP = Object.keys(DEEP).filter((code) => runsOn(code));
/** Live reads of a deep project (stored-only checks need its state file, not the project). */
const NEED_LIVE = Object.keys(DEEP).filter((code) => ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes(code)));
/** The companies a run touches: 087 always; 052 only for the read-only F52 section (WP7ADJ Q7). */
const NEED_COMPANIES = Object.freeze(['087', ...(on('F52') ? ['052'] : [])]);
if (Object.entries(DEEP).some(([code, d]) => !['087', '052'].includes(d.company) || (d.company === '052' && code !== '052-FLD'))) throw new Error('a deep project outside company 087 and the read of 052-FLD (WP7ADJ Q7)');

// -- small helpers --------------------------------------------------------------------------------------------------
/** A list out of an answer's data: the array itself, or its items / rows / claims / ... */
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items', 'rows', 'claims', 'delays', 'activities', 'attachments', 'entries', 'data']) if (Array.isArray(data?.[key])) return data[key];
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
/** Cents as a payload amount in currency units (exact for every amount this proof sends). */
const units = (c) => Number((c / 100).toFixed(2));
/** A percentage at 2 dp (the field-controls book's adjudication F2: 20 / 30 x 100 is 66.66666666666666 in doubles). */
const pct2 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
/** The calendar day of a timestamp or a date (YYYY-MM-DD, UTC). */
const dayOf = (v) => (v ? String(typeof v === 'string' ? v : new Date(v).toISOString()).slice(0, 10) : null);
/** A book error leaf as the answer string ('409 X'); a code-null leaf as its status alone. */
const saidOf = (leaf) => (leaf.value?.code ? `${leaf.value.status} ${leaf.value.code}` : String(leaf.value?.status));
/** An answer string as { status, code } (code null when the answer carried none). */
const saidParts = (said) => { const [status, code = null] = String(said).split(' '); return { status: Number(status), code }; };
/** A book row by its key (exactly one expected). */
const oneRow = (list, pred, what) => {
  const rows = list.filter(pred);
  if (rows.length !== 1) throw new Error(`answer book: ${rows.length} rows for ${what} (exactly one expected)`);
  return rows[0];
};
/** The calendar day `n` days from an ISO day (UTC). */
const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** A day offset of the book ('R-10') as its number of days before R (10). */
const offsetOf = (label) => {
  const m = /^R-(\d+)$/.exec(String(label));
  if (!m) throw new Error(`answer book: ${label} is not a day offset R-n`);
  return Number(m[1]);
};

// -- T7, T7H and the promotions as the book types them (currency units in payloads, cents in the leaves) ------------------
const T7B = {
  project: WP7.T7.project.value,
  team: WP7.T7.team.value,
  network: WP7.T7.network.value,
  claims: WP7.T7.claims.value,
  weather: WP7.T7.weatherSequence.value,
  entries: WP7.T7.entries.value,
  residue: WP7.T7.residue.value,
  choreography: WP7.T7.choreography.value,
};
const T7HB = { project: WP7.T7H.project.value, team: WP7.T7H.team.value, choreography: WP7.T7H.choreography.value };
const PROMO = { barrier: WP7.promotion.barrier.value, feeds: WP7.promotion.feeds.value };
/** A T7 claim of the book by its key (E-T2, E-T3, E-LK1, E-LK2, E-T4, E-T5, T1-*, E-HALF). */
const claimBook = (key) => oneRow(T7B.claims.claims, (c) => c.key === key, `WP7.T7.claims ${key}`);
/** A T7 weather row of the book by its key (WR-6, WR-7, WR-1, WN-10, WR-6b, WR-1b). */
const weatherRowBook = (key) => oneRow(T7B.weather.rows, (r) => r.key === key, `WP7.T7.weatherSequence row ${key}`);
/** A T7 daily-log entry of the book by its key (BAR, FEED, RACE-n, FAIL-n, SITE). */
const entryBook = (key) => oneRow(T7B.entries, (e) => e.key === key, `WP7.T7.entries ${key}`);
/** A choreography step text by its head (T7-0, W1-W2, ..., H1). */
const stepText = (steps, head) => oneRow(steps, (s) => s.split(' ')[0] === head, `choreography step ${head}`);
/** The weather steps of the book and the check each one serves (W7 serves none: it puts the allowance back). */
const WEATHER_CHECKS = Object.freeze({ W1: 'W.T7.a20at13', W2: 'W.T7.a20at14', W3: 'W.T7.nonContractual10', W4: 'W.T7.a30at20', W4b: 'W.T7.a30at21', W5: 'W.T7.a10at6', W5b: 'W.T7.a10at7', W6: 'KA.W.T7.allowanceZero', W7: null });

/**
 * Fixture inputs that are not expected figures (WP4ADJ B8 precedent; WP-6's FIXTURE). The T7H half-day rows restate the
 * book's T7H constant (answers/commercial.js, not exported): 28 contractual rows of 0.5 day, four a day on R-12 .. R-6,
 * then one of 1.5 days on R-6; every leaf and step that states a figure of them is checked against them at load below,
 * so a book or fixture change refuses to load. The 087-COM calculation names the activities WP7.T4.on087COM names and
 * takes E-T4's delay and EOT days (T4's figures). The status probes, the reasons, the event types and the waiting
 * statement's relation are build choices.
 */
const FIXTURE = Object.freeze({
  half: Object.freeze({ rows: 28, delayDays: 0.5, from: 12, to: 6, perDay: 4 }),
  oneAndHalf: Object.freeze({ delayDays: 1.5, day: 'R-6' }),
  com087: Object.freeze({ activities: Object.freeze(['A110', 'A120']), relationshipType: 'FS', claim: 'E-T4' }),
  eventTypes: Object.freeze({ 'E-T2': 'weather' }),
  defaultEventType: 'client_instruction',
  probeStatus: Object.freeze({ createApproved: 'approved', patchSubmitted: 'submitted', patchDraft: 'draft' }),
  waitingRelation: '"DailyLogDelay"',
  confirmWaitingMs: 1500,
  pollMs: 50,
  notificationWord: 'weather',
});
// The fixture and the book's own figures against every leaf that states them (a mismatch refuses to load).
{
  const problems = [];
  const W = WP7.weather;
  const leafVal = (k) => W[k].value;
  // the weather sequence reads are the boundary leaves (G8)
  const reads = Object.fromEntries(T7B.weather.steps.map((s) => [s.step, s.read]));
  const four = (r) => ({ consumedPct: r.consumedPct, warning: r.warning, remaining: r.remaining });
  if (!sameJson(four(reads.W1), { consumedPct: leafVal('allowance20.at13.consumedPct'), warning: leafVal('allowance20.at13.warning'), remaining: leafVal('allowance20.at13.remaining') })) problems.push('W1 is not WP7.weather.allowance20.at13.*');
  if (!sameJson(four(reads.W2), { consumedPct: leafVal('allowance20.at14.consumedPct'), warning: leafVal('allowance20.at14.warning'), remaining: leafVal('allowance20.at14.remaining') })) problems.push('W2 is not WP7.weather.allowance20.at14.*');
  if (!sameJson({ contractualUsed: reads.W3.contractualUsed, monthlyNonContractual: reads.W3.monthlyNonContractual }, W.nonContractual10.value)) problems.push('W3 is not WP7.weather.nonContractual10');
  if (reads.W4.consumedPct !== leafVal('allowance30.at20.consumedPct') || reads.W4.warning !== leafVal('allowance30.at20.warning')) problems.push('W4 is not WP7.weather.allowance30.at20.*');
  if (reads.W4b.consumedPct !== leafVal('allowance30.at21.consumedPct') || reads.W4b.warning !== leafVal('allowance30.at21.warning')) problems.push('W4b is not WP7.weather.allowance30.at21.*');
  if (reads.W5.consumedPct !== leafVal('allowance10.at6.consumedPct') || reads.W5.warning !== leafVal('allowance10.at6.warning')) problems.push('W5 is not WP7.weather.allowance10.at6.*');
  if (reads.W5b.consumedPct !== leafVal('allowance10.at7.consumedPct') || reads.W5b.warning !== leafVal('allowance10.at7.warning')) problems.push('W5b is not WP7.weather.allowance10.at7.*');
  if (!sameJson([reads.W1.consumedPct, reads.W1.warning], CLAUDE_MD.weather70.value['13/20']) || !sameJson([reads.W2.consumedPct, reads.W2.warning], CLAUDE_MD.weather70.value['14/20'])) problems.push('W1 / W2 are not claudeMd.weather70');
  if (typeof reads.W6 !== 'string' || !reads.W6.includes('WP7.weather.allowanceZero.T7')) problems.push('W6 does not name WP7.weather.allowanceZero.T7');
  if (!sameJson(Object.keys(reads), Object.keys(WEATHER_CHECKS))) problems.push(`the weather steps ${Object.keys(reads).join(',')} are not ${Object.keys(WEATHER_CHECKS).join(',')}`);
  const az = W['allowanceZero.T7'];
  if (!sameJson(az.today, reads.W7) && !sameJson({ ...az.today, allowance: 20 }, reads.W7)) problems.push('W7 is not allowanceZero.T7\'s today at allowance 20');
  if (az.value.allowance !== W['allowanceZero.allowance'].value || az.today.allowance !== W['allowanceZero.allowance'].today) problems.push('allowanceZero.T7 against allowanceZero.allowance');
  // T4 / T5: the stored fields and the calculation are the book's T4 / T5 figures (G6)
  const t4v = { criticalPathImpactDays: WP7.T4.criticalPathImpactDays.value, ldApplicableDays: WP7.T4.ldApplicableDays.value, ldLiability: WP7.T4.ldLiability.value };
  const t4t = { criticalPathImpactDays: WP7.T4.criticalPathImpactDays.today, ldApplicableDays: WP7.T4.ldApplicableDays.today, ldLiability: WP7.T4.ldLiability.today };
  const sf = WP7.T4.storedFields;
  const noLinks = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'linkFloatDays'));
  if (!sameJson(noLinks(sf.value), t4v) || !sameJson(noLinks(sf.today), t4t) || !sameJson(WP7.T4.on087COM.value, t4v) || !sameJson(WP7.T4.on087COM.today, t4t)) problems.push('WP7.T4.storedFields / on087COM are not WP7.T4\'s figures');
  const tf = (code) => T7B.network.cpm[code]?.TF;
  const e4 = claimBook('E-T4');
  const e5 = claimBook('E-T5');
  if (!sameJson(sf.value.linkFloatDays, e4.activities.map(tf)) || !sameJson(sf.today.linkFloatDays, e4.activities.map(tf))) problems.push('E-T4\'s link floats are not T7\'s network');
  const t5 = WP7.T5.storedFields.value;
  if (!sameJson(noLinks(t5), { criticalPathImpactDays: WP7.T5.criticalPathImpactDays.value, ldApplicableDays: WP7.T5.ldApplicableDays.value, ldLiability: WP7.T5.ldLiability.value }) || !sameJson(t5.linkFloatDays, e5.activities.map(tf))) problems.push('WP7.T5.storedFields is not WP7.T5\'s figures on T7-F4');
  if (WP7.T4.ldRatePerDay.value !== T7B.project.ldRatePerDay || T7B.claims.ldRatePerDay !== T7B.project.ldRatePerDay || D087.ldRatePerDay.value !== T7B.project.ldRatePerDay) problems.push('T7\'s LD rate is not WP7.T4.ldRatePerDay / deep.087-COM.ldRatePerDay');
  // T2 / T3: the approvals of the claims leaf are WP7.T2 / WP7.T3
  const ap = T7B.claims.approvals;
  if (ap['E-T2'].cumulativeApprovedEotDays !== WP7.T2.cumulativeApprovedEotDays.value || ap['E-T2'].revisedCompletionRecommendation !== WP7.T2.revisedCompletionRecommendation.value || ap['E-T3'].cumulativeApprovedEotDays !== WP7.T3.cumulativeApprovedEotDays.value || ap['E-T3'].revisedCompletionRecommendation !== WP7.T3.revisedCompletionRecommendation.value) problems.push('WP7.T7.claims approvals are not WP7.T2 / WP7.T3');
  if (T7B.project.completionDate !== D087.completion.value) problems.push('T7\'s completion date is not 087-COM\'s');
  if (!sameJson(T7B.claims.approvalOrder.slice(0, 3), ['E-T2', 'E-T3', 'the PATCH of E-T2'])) problems.push('the approval order is not E-T2, E-T3, then the PATCH of E-T2 (the order trap, G3)');
  for (const c of T7B.claims.claims) for (const a of c.activities) if (!T7B.network.cpm[a]) problems.push(`claim ${c.key} names ${a}, not in T7's network`);
  for (const c of T7B.claims.claims) for (const w of c.weatherDelays) if (!T7B.weather.rows.some((r) => r.key === w)) problems.push(`claim ${c.key} links ${w}, not a T7 weather row`);
  // the submission proof probes: the two sub-leaves carry the parent's answer
  for (const k of ['submitWithoutProof.noDocument', 'submitWithoutProof.noActivity']) if (WP7.T1[k].value.status !== WP7.T1.submitWithoutProof.value.status || WP7.T1[k].value.code !== WP7.T1.submitWithoutProof.value.code) problems.push(`WP7.T1.${k} is not WP7.T1.submitWithoutProof's answer`);
  // T7H: the fixture's rows against the half-day leaves and the H1 / H2 step texts (G10)
  const H = FIXTURE.half;
  const h1 = stepText(T7HB.choreography, 'H1');
  const h2 = stepText(T7HB.choreography, 'H2');
  if (!h1.includes(`${H.rows} contractual delays of ${H.delayDays} day, four a day on R-${H.from} .. R-${H.to}`) || H.perDay !== 4 || (H.from - H.to + 1) * H.perDay !== H.rows) problems.push('FIXTURE.half is not the H1 step');
  if (!h2.includes(`${FIXTURE.oneAndHalf.delayDays} days on ${FIXTURE.oneAndHalf.day}`) || W['fractional.storedOneAndHalf'].value !== FIXTURE.oneAndHalf.delayDays) problems.push('FIXTURE.oneAndHalf is not the H2 step / WP7.weather.fractional.storedOneAndHalf');
  const half = WP7.T7H.half28;
  if (half.value.contractualUsed !== H.rows * H.delayDays || half.today.contractualUsed !== H.rows * Math.trunc(H.delayDays) || half.value.allowance !== T7HB.project.weatherAllowanceDays) problems.push('WP7.T7H.half28 is not FIXTURE.half against T7H\'s allowance');
  if (half.value.consumedPct !== W['fractional.28xHalf.consumedPct'].value || half.today.consumedPct !== W['fractional.28xHalf.consumedPct'].today || half.value.warning !== W['fractional.28xHalf.warning'].value || half.today.warning !== W['fractional.28xHalf.warning'].today) problems.push('WP7.T7H.half28 against WP7.weather.fractional.28xHalf.*');
  // the promotion entries (G13)
  for (const key of ['BAR', 'FEED', 'RACE-1', 'RACE-2', 'RACE-3', 'FAIL-1', 'FAIL-2', 'FAIL-3', 'SITE']) {
    const e = T7B.entries.find((x) => x.key === key);
    if (!e || e.hoursLost !== 8 || e.promotedDays !== PROMO.feeds.echoDays || !T7B.network.cpm[e.activity]) problems.push(`entry ${key} is not an 8 h entry on a T7 activity promoted as WP7.promotion.feeds.echoDays`);
  }
  const rounds = (kind) => T7B.entries.filter((e) => e.key.startsWith(`${kind}-`)).length;
  if (rounds('RACE') !== PROMO.barrier.rounds || rounds('FAIL') !== PROMO.barrier.rounds || WP7.promotion.race.value.rounds !== PROMO.barrier.rounds || WP7.promotion.failure.value.rounds !== PROMO.barrier.rounds) problems.push('the race / failure rounds are not WP7.promotion.barrier.rounds');
  if (!(PROMO.barrier.releaseWithinMs < PROMO.barrier.interactiveTxTimeoutMs) || FIXTURE.confirmWaitingMs >= PROMO.barrier.releaseWithinMs) problems.push('the barrier budget is not inside the interactive-transaction window');
  if (entryBook('SITE').by !== 'site' || T7B.team.site_engineer !== 'site' || T7B.team.planning_eng !== 'planner') problems.push('the site engineer\'s entry or T7\'s team is not the book\'s');
  // 087-FLD / 052-FLD: WP7's reads are WP8's leaves (the two books agree, G11, G12)
  const rd = W['087-FLD.read'];
  const w8 = WP8.weather;
  const at = (p) => ({ contractualUsed: w8[`${p}ContractualUsed`].value, consumedPct: w8[`${p}ConsumedPct`].value, warning: w8[`${p}Warning`].value, remaining: w8[`${p}Remaining`].value });
  if (!sameJson(rd.value.at13, at('below')) || !sameJson(rd.value.at14, at('at')) || !sameJson(rd.value.live, { ...at('at'), monthlyNonContractual: w8.monthlyNonContractual.value })) problems.push('WP7.weather[087-FLD.read] value is not WP8.weather.below* / at* / monthlyNonContractual');
  if (rd.today.at13.consumedPct !== w8.todayBelow.value || rd.today.at14.consumedPct !== w8.todayAt.value) problems.push('WP7.weather[087-FLD.read] today is not WP8.weather.todayBelow / todayAt');
  if (rd.value.live.contractualUsed !== w8.nonContractualAddsNothing.value || rd.today.live.contractualUsed !== w8.nonContractualAddsNothing.today) problems.push('WP7.weather[087-FLD.read] live is not WP8.weather.nonContractualAddsNothing');
  if (W['087-FLD.allowance'].value !== w8.allowance.value) problems.push('WP7.weather[087-FLD.allowance] is not WP8.weather.allowance');
  const f052 = W['052-FLD'];
  const w052 = WP8['052-FLD'];
  if (!sameJson(f052.value, { first: [w052.weatherBelowPct.value, w8.belowWarning.value], then: [w052.weatherAtPct.value, w052.weatherAtWarning.value] }) || !sameJson(f052.today, { first: [rd.today.at13.consumedPct, rd.today.at13.warning], then: [rd.today.at14.consumedPct, rd.today.at14.warning] })) problems.push('WP7.weather[052-FLD] is not WP8[052-FLD] / the 087-FLD record set');
  // 087-COM (G17) and its calculation (G6)
  const link = D087.eotWeatherLink.value;
  if (!sameJson(D087.weatherDefault.value, { allowance: 20, contractualUsed: link.weatherDelayDays, consumedPct: pct2((link.weatherDelayDays / 20) * 100), warning: (link.weatherDelayDays / 20) * 100 >= 70, remaining: 20 - link.weatherDelayDays })) problems.push('deep.087-COM.weatherDefault is not WD-1 against the default 20');
  const cd = WP7.T4.on087COM.derivation;
  if (!cd.includes(`on ${FIXTURE.com087.activities.join(' and ')}`) || !cd.includes(`delay ${claimBook(FIXTURE.com087.claim).delayDays}, eot ${claimBook(FIXTURE.com087.claim).eotDaysGranted}`) || !cd.includes(`${FIXTURE.com087.activities.join(' -> ')}`)) problems.push('WP7.T4.on087COM no longer names A110 and A120, delay 10, eot 10, or the FS link');
  if (!sameJson(D087.stateCoverage.eotClaims.value, ['draft', 'submitted', 'approved', 'rejected']) || D087.eotApprovedClaims.value !== 2) problems.push('deep.087-COM.stateCoverage.eotClaims / eotApprovedClaims');
  // the promotion of 8 h is WP-8's rounding rule; promoting twice is WP-8's 409
  if (FIELD.rules.promoteDays(8) !== PROMO.feeds.echoDays || saidParts(WP8.dailyLog.promoteTwice.value).status !== 409) problems.push('WP7.promotion.feeds.echoDays is not field-controls rules.promoteDays(8), or WP8.dailyLog.promoteTwice is not a 409');
  if (problems.length) throw new Error(`FIXTURE against the WP-7 book: ${problems.join('; ')}`);
}

// -- rules, the fix commits and the contracts pending their decisions or plan reviews ----------------------------------
const WP7ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp7/WP7-ADJUDICATION.md ${item}`;
/**
 * The fix commits: EMPTY until each fix lands. The integration owner sets both fields from the fix commit
 * (`git show -s --format=%cI <commit>`); the proof checks the time against git (S.state). Once set, the rule is decided,
 * its KAs and CF are judged on the value, and a build record observed before the commit reads STORED-PRE-FIX. The owner
 * rules (HR-C10, HR-C11, HR-F4) are undecided: their entries are set only by the commit that implements the owner's
 * decision, together with its CONTRACT fields. PROMO-TX is the section 5 defect fix (:1115), made only if it confirms
 * as P1 at this run (WP7ADJ Q6).
 */
const FIXES = Object.freeze({
  'HR-C10': Object.freeze({ commit: null, committedAt: null }),
  'HR-C11': Object.freeze({ commit: null, committedAt: null }),
  'HR-F4': Object.freeze({ commit: null, committedAt: null }),
  'PROMO-TX': Object.freeze({ commit: null, committedAt: null }),
});
const fixed = (rule) => Boolean(FIXES[rule]?.commit);
const fixRule = (rule, statement, sources) => ({ status: fixed(rule) ? 'decided' : 'proposed', statement: `${statement}${fixed(rule) ? `; implemented in ${FIXES[rule].commit}` : '; not yet decided and implemented'}.`, sources });
const RULES = {
  'HR-C10': fixRule('HR-C10', 'EOT (the recommendation :1078; undecided): lock approved claims (409); impact = delay - the least float along the named activities; keep the project date manual', [`${PLAN_DOC}:847,849,869,1078`, WP7ADJ('Q4')]),
  'HR-C11': fixRule('HR-C11', 'Fractional days, a zero allowance and the 70% warning (the recommendation :1079; undecided): store half-days (decimal weather and EOT days) or refuse non-integers; 0 means 0; keep the flag (a notice is the owner\'s call)', [`${PLAN_DOC}:860,861,868,870,1079`, WP7ADJ('Q9, Q12')]),
  'HR-F4': fixRule('HR-F4', 'Daily log (the recommendation :1061; undecided): a promotion is contractual only when the actor holds eot:create; otherwise it creates a non-contractual delay', [`${PLAN_DOC}:843,1061`, WP7ADJ('Q8')]),
  'PROMO-TX': fixRule('PROMO-TX', 'Weather promotion in one transaction (the section 5 defect fix :1115; made if it confirms as P1, its severity decided at this run from the reproduction, WP7ADJ Q6): the entry locked or claimed first, re-checked under the lock, the weather delay created and the entry linked in one transaction', [`${PLAN_DOC}:843,1107,1115`, WP7ADJ('Q2, Q6')]),
};
const CF_RULE = { 'CF.HRC11': 'HR-C11', 'CF.HRC10': 'HR-C10', 'CF.PROMOTX': 'PROMO-TX' };
/** The defect checks of a landed fix (none at HEAD): kind 'defect', judged on the value, today fails. */
const DECIDED_RED = {
  ...(fixed('HR-C10') ? {
    'KA.T2.plannerPatchApproved': { rule: 'HR-C10', defect: 'HR-C10 an approved claim editable by PATCH', stored: false, today: '200, eotDaysGranted 30' },
    'KA.T4.T7': { rule: 'HR-C10', defect: 'HR-C10 impact summed over activities (T7)', stored: false, today: 'impact 20, LD 10,000.00' },
    'KA.T4.087COM.calculate': { rule: 'HR-C10', defect: 'HR-C10 impact summed over activities (087-COM /calculate)', stored: false, today: 'impact 20, LD 10,000.00' },
    'CF.HRC10': { rule: 'HR-C10', defect: 'HR-C10 EOT', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-C11') ? {
    'KA.W.T7.allowanceZero': { rule: 'HR-C11', defect: 'HR-C11 an allowance of 0 read as 20', stored: false, today: 'allowance 20, 35%' },
    'KA.W.T7H.half28': { rule: 'HR-C11', defect: 'HR-C11 half-days stored as 0', stored: false, today: '0, 0%, no warning' },
    'KA.W.T7H.storedOneAndHalf': { rule: 'HR-C11', defect: 'HR-C11 1.5 stored as 1', stored: false, today: '1' },
    'KA.FLD.087.stored': { rule: 'HR-C11', defect: 'HR-C11 truncated (087-FLD build record)', stored: true, today: '11 / 55%, 12 / 60%' },
    'KA.FLD.087.live': { rule: 'HR-C11', defect: 'HR-C11 truncated (087-FLD rows built before the fix)', stored: true, today: '12, 60%, no warning' },
    'KA.FLD.052.stored': { rule: 'HR-C11', defect: 'HR-C11 truncated (052-FLD build record)', stored: true, today: '55 then 60, no warning' },
    'KA.FLD.052.live': { rule: 'HR-C11', defect: 'HR-C11 truncated (052-FLD rows built before the fix)', stored: true, today: '12, 60%, no warning' },
    'CF.HRC11': { rule: 'HR-C11', defect: 'HR-C11 fractional days, zero allowance', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-F4') ? {
    'KA.F4.T7.sitePromotion': { rule: 'HR-F4', defect: 'HR-F4 site staff create contractual weather delays', stored: false, today: '200, contractual, +1' },
  } : {}),
  ...(fixed('PROMO-TX') ? {
    'KA.PROMO.T7.race': { rule: 'PROMO-TX', defect: 'PROMO-TX a promotion race duplicates the weather row', stored: false, today: 'two 200s, two rows, one orphaned' },
    'KA.PROMO.T7.failure': { rule: 'PROMO-TX', defect: 'PROMO-TX a promotion racing a delete leaves an orphaned row', stored: false, today: 'DELETE 200, 404 NOT_FOUND, one orphan' },
    'CF.PROMOTX': { rule: 'PROMO-TX', defect: 'PROMO-TX weather promotion in two writes', stored: false, today: 'CONFIRMED' },
  } : {}),
};
for (const [id, d] of Object.entries(DECIDED_RED)) {
  if (!CHECKS.some((c) => c.id === id) || RULES[d.rule]?.status !== 'decided') throw new Error(`DECIDED_RED ${id}: not a check, or ${d.rule} is not decided`);
}

/**
 * The contracts of the undecided rules and the defect fix, filled ONLY from the adjudicated decision or fix plan (WP4ADJ
 * Q2 precedent: no contract is guessed). While null, only what the book's value says is judged.
 *   HR-C10.lockedAnswer       '<status> <CODE>' of the PATCH of an approved claim (null: any 409)
 *   HR-C11.fractionalMode     'decimal' (the row reads 1.5) or 'refuse' (null: the book's value, decimal)
 *   HR-C11.refusalAnswer      '<status> <CODE>' of a non-integer refused at the route (null: none)
 *   HR-F4.siteAnswer          'non-contractual' or '<status> <CODE>' of the site engineer's promotion (null: non-contractual)
 *   PROMO-TX.failureCode      '<status> <CODE>' of the promotion that lost its entry (null: any status not 2xx)
 */
const CONTRACT = Object.freeze({
  'HR-C10': Object.freeze({ lockedAnswer: null }),
  'HR-C11': Object.freeze({ fractionalMode: null, refusalAnswer: null }),
  'HR-F4': Object.freeze({ siteAnswer: null }),
  'PROMO-TX': Object.freeze({ failureCode: null }),
});
/** The TEST GAPS of this proof (meta.testGaps): none. What WP-7 does not probe is recorded as leads (WP7ADJ Q10) and owner questions. */
const TEST_GAPS = Object.freeze([]);
/** The leads recorded with the WP-7 proof commit, not probed (WP7ADJ Q10), and the rows not re-probed. */
const LEADS = Object.freeze([
  'EOT-CONC-1 (P2): two approvals at once may each miss the other\'s days (buildApprovedCompletionRecommendation reads the other approved claims with no lock, eot.service.js:303-318)',
  'DST-1 (P3): the recommendation adds calendar days with setDate in the server\'s zone (eot.service.js:91-97); no WP-7 figure crosses a DST change',
  'EOT-REC-2 (P3): two recommendations, the calculation\'s (this claim\'s days, :426-428) and the approval\'s (the cumulative, :288-327): E-T3 2027-07-05 against 2027-07-15 (recorded by CF.HRC10)',
  'WX-DEL-1 (P2): a weather delay is hard-deleted under eot:update (weather.service.js:407, HR-A2) and its link to an approved claim cascades',
  'EOT-APPLY-1 (P3): the contract assistant\'s apply edits any claim through updateEotClaim (contract.service.js:542-549), inside HR-C10\'s lock scope',
  'not re-probed: R22 (the LD rate through GET /eot; register :125), HR-A2 (weather delete permission, owner question O5)',
]);

/** The setup checks. */
const SETUP_IDS = new Set(CHECKS.filter((c) => c.id.startsWith('S.')).map((c) => c.id));
/** The live catchers of the section 6.2 WP-7 guards (WP7.mutations.seventyBoundary / approvedEotLock; WP7ADJ Q4): E6. */
const CATCHERS = {
  'M-70': ['W.T7.a20at14', 'W.T7.a30at21', 'W.T7.a10at7'],
  'M-STAT': ['T1.T7.patchApprovedToDraft', 'T1.T7.rejectApproved'],
};
/** The optional rule mutants (WP7.mutations.ruleMutants; WP7ADJ Q5): run, never tallied, recorded with the proof. */
const OPTIONAL_CATCHERS = {
  'M-WF': ['T1.T7.approveDraft', 'T1.T7.patchStatusDraftOnSubmitted', 'T1.T7.patchApprovedToDraft', 'T1.T7.rejectApproved'],
  'M-PROOF': ['T1.T7.submitWithoutProof'],
  'M-CUM': ['T3.T7.approve'],
  'M-ALLOW': ['W.T7.a30at20', 'W.T7.a30at21', 'W.T7.a10at6', 'W.T7.a10at7'],
  'M-NC': ['W.T7.nonContractual10', 'W.T7.a30at20', 'W.T7.a30at21', 'W.T7.a10at6', 'W.T7.a10at7'],
  'M-REASON': ['T1.T7.rejectWithoutReason'],
};
/** Other checks a mutant turns red (named so a mutation result is read correctly); M-70b is not run (the same line and catchers). */
const COLLATERAL = {
  'M-70': ['none at HEAD: every other reading is below or above 70 (W3 is judged on WP7.weather.nonContractual10\'s two fields); KA.W.T7H.half28 and KA.FLD.*.live read today (0%, 60%) either way and turn catchers only after the HR-C11 fix (half28) or the exit rebuild (the FLD live reads)'],
  'M-STAT': ['none: E-LK1 and E-LK2 are approved last and judged only by these two checks; KA.T2.plannerPatchApproved sends no status'],
  'M-WF': ['the T1 claims move (approveDraft approves T1-C, which carries its activity and document); T1 runs after every cumulative read'],
  'M-PROOF': ['none'],
  'M-CUM': ['none (087-COM\'s cumulatives are stored, not recomputed; E-T2 is approved first)'],
  'M-ALLOW': ['KA.W.T7.allowanceZero reads today either way'],
  'M-NC': ['KA.W.T7.allowanceZero wrong (the non-contractual rows counted)', 'KA.FLD.087.live and KA.FLD.052.live wrong (22 = 12 + 10): reads only, nothing written'],
  'M-REASON': ['T1.T7.rejectWithReason re-rejects a rejected claim (a same-state no-op, 200): it stays green'],
};
/**
 * The fix mutations (plan section 1.4, wp7-mutations-draft.json fixMutations; WP7.mutations.fixMutations and
 * approvedEotLock's M-LOCK): each puts a landed fix back, so each is run only once its fix is in (FIXES set); their
 * catchers are the fix's known answers, judged on the value from then on. M-LOCK is then tallied for E6 (WP7ADJ Q4).
 */
const FIX_CATCHERS = {
  'M-LOCK': ['KA.T2.plannerPatchApproved'], 'M-C10i': ['KA.T4.T7', 'KA.T4.087COM.calculate'], 'M-C11z': ['KA.W.T7.allowanceZero'],
  'M-C11d': ['KA.W.T7H.half28', 'KA.W.T7H.storedOneAndHalf'], 'M-PTX': ['KA.PROMO.T7.race', 'KA.PROMO.T7.failure'], 'M-F4': ['KA.F4.T7.sitePromotion'],
};
for (const id of new Set([...Object.values(FIX_CATCHERS), ...Object.values(OPTIONAL_CATCHERS)].flat())) if (!CHECKS.some((c) => c.id === id)) throw new Error(`FIX_CATCHERS / OPTIONAL_CATCHERS name ${id}, not a check`);
// The catchers are the book's (WP7.mutations.*: each names its catchers by check id, G15).
{
  const bookText = Object.values(WP7.mutations).map((leaf) => leaf.value.join(' ')).join(' ');
  const all = { ...CATCHERS, ...OPTIONAL_CATCHERS, ...FIX_CATCHERS };
  const missing = [...new Set(Object.values(all).flat())].filter((id) => !bookText.includes(id));
  if (missing.length) throw new Error(`WP7.mutations names no catcher ${missing.join(', ')}: the catchers and the book disagree (G15)`);
  for (const id of new Set(Object.values(CATCHERS).flat())) if (id !== harness.FIVE_XX_CHECK && !CHECKS.some((c) => c.id === id)) throw new Error(`CATCHERS names ${id}, not a check`);
  for (const name of Object.keys(all)) if (!bookText.includes(`(${name},`) && !bookText.includes(`(${name}:`)) throw new Error(`WP7.mutations names no mutant ${name} (G15)`);
}

const planEntries = ACTIVE.map((c) => [
  c.id,
  c.description,
  SETUP_IDS.has(c.id) ? { setup: true } : DECIDED_RED[c.id] ? { defect: DECIDED_RED[c.id].defect, rule: DECIDED_RED[c.id].rule } : c.id.startsWith('CF.') ? { rule: CF_RULE[c.id] } : {},
]);

/** The moment-map deviation, by key (WP7ADJ Q1), recorded in meta.deviations and in MOMENT-MAP.md when the proof lands. */
const DEVIATIONS = Object.freeze([
  'Every WP-7 writing check and every section 6.2 catcher runs on T7, the WP-7 proof\'s own throwaway in 087 (completionDate 2027-06-30, ldRatePerDay 1,000.00, weatherAllowanceDays 20 explicit, defaultRetentionRate 10, archived at the end); the half-day register runs on a second throwaway, T7H (WP7ADJ Q1).',
  'Row 153 stands: the 087-COM eot.figures moment is judged as stored (COM.stored.eotFigures) and read live (COM.live.claims, COM.live.project).',
  'Rows 177 and 263 move: the HR-F4 site-engineer promotion "on fresh records on 087-FLD / 052-FLD" runs on T7 (KA.F4.T7.sitePromotion); no write reaches 087-FLD or 052-FLD.',
  'Row 180 ("the 13 -> 14 boundary after the HR-C11 fix, on fresh records") is met on T7 with whole days (W.T7.a20at13 / a20at14, HARD at HEAD) and on T7H with half days (KA.W.T7H.half28).',
  'Rows 178, 179, 247 and 248 stand as stored moments (KA.FLD.087.stored, KA.FLD.052.stored: BLOCKED HR-C11; STORED-PRE-FIX after its fix, judged on the value strictly at the exit rebuild) plus live reads (KA.FLD.087.live, KA.FLD.052.live).',
  'T4 (no row): POST /eot/calculate on 087-COM, which writes nothing (its EOT claims, weather delays and audit events asserted unchanged, WP7ADJ Q3), plus T7; T5 on T7 only (087-COM has no float-4 activity).',
]);

const h = harness.createHarness({
  name: 'wp7-eot-proof',
  plan: planEntries,
  rules: RULES,
  mailPrefix: 'wp7',
  meta: {
    plan: `${PLAN_DOC} section 4 WP-7 (:837-871), section 6.2 WP-7 guards (:1151), section 5 HR-F4 :1061, HR-C10 :1078, HR-C11 :1079, fix list :1115; plan lines as numbered at bde300d`,
    prep: 'C:/Temp/octapm-cert/scratch/wp7/WP7-PREP.md',
    adjudication: `${WP7ADJ('Q1-Q13')} and the standing rulings it lists`,
    momentMap: 'backend/scripts/cert/cert3/build/MOMENT-MAP.md (the WP-7 deviation to record when the proof lands: meta.deviations)',
    answerBook: `backend/scripts/cert/cert3/answers/commercial.js @${COMMERCIAL.meta.head} and answers/field-controls.js @${FIELD.meta.head} + the WP-7 book patch (G1-G18)`,
    expectedChecks: EXPECTED_CHECKS,
    activeChecks: ACTIVE.length,
    filter: { only: ONLY ? [...ONLY] : null, skip: SKIP ? [...SKIP] : null, project: PROJECT_FILTER, sections: [...selectedSections], deepProjects: NEED_DEEP, live: NEED_LIVE, companies: [...NEED_COMPANIES], throwaway: { T7: NEED_T7, T7H: NEED_T7H } },
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
    notRunMutants: 'M-70b (">= 70" -> ">= 70.01": the same line and the same catchers); the sequential promotion guard (daily-log.service.js:1198: WP-8\'s, PROMO.T7.twice would catch it)',
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
 * A known answer (A10): `verdict` is 'value' (the book's expected figure holds), 'today' (HEAD's recorded answer under
 * an undecided rule: BLOCKED / known, never exit 2) or 'wrong' (neither: an unexplained departure, a failure). Under a
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
  const text = `${blocked ? `BLOCKED (known answer, ${ref})` : preFix ? `STORED-PRE-FIX (built ${storedAt}, before the ${ref} fix ${FIXES[ref].commit} of ${FIXES[ref].committedAt}): HEAD's pre-fix answer, reported with the register link ${ref}, not a WP-7 failure` : verdict === 'today' ? `FAIL: HEAD still gives the known answer of ${ref}, which is decided${storedAt !== null ? (FIXES[ref]?.commit ? ` (stored ${storedAt}, not before the fix commit)` : ` (no ${ref} fix commit yet)`) : ''}` : verdict === 'value' ? 'value' : `WRONG: neither the book's value nor HEAD's known answer (${ref})`}; ${detail}`;
  rec(id, ok, { expected: { value, today }, observed, detail: text });
  records[id].verdict = status;
  return verdict;
};
/** value / today / wrong from a predicate over the observation. */
const judge = (observed, isValue, isToday) => (isValue(observed) ? 'value' : isToday(observed) ? 'today' : 'wrong');
/** A KA over a leaf whose value and today are compared whole (sameJson): the commonest shape. */
const kaLeaf = (id, leaf, observed, { storedAt = null, detail = '' } = {}) => ka(id, { ref: leaf.ref, value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (x) => sameJson(x, leaf.value), (x) => sameJson(x, leaf.today)), storedAt, detail });
/** N rounds judged together (binding ruling 4): value only if every round is the value, today only if every round is today. */
const roundsVerdict = (verdicts) => (verdicts.length && verdicts.every((v) => v === 'value') ? 'value' : verdicts.length && verdicts.every((v) => v === 'today') ? 'today' : 'wrong');
/**
 * R-SET: a known-answer probe in its own section. When what the probe needs cannot be set up, the probe throws: the
 * harness records a section error (a setup error, exit 1) and the check is left unrecorded ('not run'), never 'wrong'.
 */
const probe = (title, fn) => h.section(`probe: ${title}`, fn);
const probeSetup = (id, why) => new Error(`${id}: the probe's own setup failed (a setup error, not a verdict; R-SET): ${why}`);
/** A step a throwaway choreography cannot go on without: a setup error, not a verdict (as WP-1's W ... WP-6's B6). */
const need = (condition, what) => {
  if (condition !== true) throw new Error(`${what}: the choreography cannot go on (a setup error, not a verdict)`);
};
/** A confirm-first item classified from this run's observations (plan section 0.0: CONFIRMED / PARTIAL / REJECTED / TEST GAP). */
const classifyItems = ({ present, absent, gap = [] }) => {
  const total = present.length + absent.length + gap.length;
  return total === 0 || gap.length === total ? 'TEST GAP' : present.length === 0 ? 'REJECTED' : absent.length === 0 && gap.length === 0 ? 'CONFIRMED' : 'PARTIAL';
};
/**
 * `observations` are what the plan asks to be confirmed where the rule's own recommendation equals HEAD (HR-C10 keeps the
 * project date manual; HR-C11 keeps the warning a flag): reported beside the classification, never classified, so a
 * landed fix that keeps them is not read as a defect (binding ruling 3; WP7-PREP fact 7).
 */
const cf = (id, { present, absent, gap = [], observations = [], detail = '' }) => {
  const classification = classifyItems({ present, absent, gap });
  const rule = RULES[CF_RULE[id]];
  confirmFirst[id] = { classification, rule: CF_RULE[id], ruleStatus: rule.status, present, absent, gap, observations, note: rule.status === 'decided' ? 'a landed fix: CONFIRMED is a failure (RED until the fix holds)' : 'an undecided rule or an unlanded fix: CONFIRMED is reported, not failed; EXPECTED BEHAVIOUR is the owner\'s call' };
  const ok = rule.status === 'decided' ? classification === 'REJECTED' : classification !== 'TEST GAP';
  rec(id, ok, { expected: rule.status === 'decided' ? 'REJECTED (fixed)' : 'CONFIRMED or REJECTED (reported)', observed: { classification, present, absent, gap }, detail: `${classification}; ${detail}` });
  return classification;
};

// -- sessions and requests --------------------------------------------------------------------------------------------
const ctx = { db: null, q: null, orgs: {}, people: {}, sessions: {}, specs: {}, R: null, zone: null, t7: null, t7h: null, state: {}, deep: {}, cleanup: [], deepWrites: [], jobsCancelled: [], blockerDb: null, probeDb: null, blockerOpen: false };
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
/** A minimal one-page PDF (a claim's evidence; WP-4's K and WP-6's B6 precedent). */
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
/** A PDF attached to a record of T7 by `who`: its project document id (the evidence a claim names). */
const attachPdf = async (who, P, recordType, recordId, label) => {
  const res = await upload(who, `${P}/attachments`, pdf(`${label} ${h.STAMP}`, `CERT3-WP7-${label.replace(/[^A-Za-z0-9]+/g, '-')}-${h.STAMP}.pdf`), { recordType, recordId, caption: `CERT3 WP7 ${label} ${h.STAMP}` }, 'files');
  const row = listOf(res.body?.data).find((r) => r?.documentId) || null;
  need(res.status === 201 && Boolean(row?.documentId), `the ${label} PDF could not be attached to ${recordType} ${recordId} (${h.said(res)} ${res.body?.error?.message || ''})`);
  return row.documentId;
};
/** A stamped name or description of this run. */
const label = (what) => `CERT3 WP7 ${what} ${h.STAMP}`;

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
/**
 * A throwaway made by `pm` with the book's payload (stamped name; the LD rate in cents sent in currency units) and team
 * (the book's { projectRole: persona }): { id, P, ... }. Its archive is pushed to cleanup at once, so a failure later
 * still archives it.
 */
const makeThrowaway = async ({ pm, label: tag, project, team }) => {
  const name = String(project.name).replace('<stamp>', h.STAMP);
  const payload = { ...project, name, ...(project.ldRatePerDay !== undefined ? { ldRatePerDay: units(project.ldRatePerDay) } : {}) };
  const created = await send(pm, 'POST', '/projects', payload);
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (!id) throw new Error(`${tag} could not be created: ${h.said(created)} ${created.body?.error?.message || ''}`);
  const t = { id, P: `/projects/${id}`, name, label: tag, pm, created, members: [], acts: {}, actCode: {}, weather: {}, claims: {}, entries: {}, archived: null };
  ctx.cleanup.push(async () => { const a = await archive(t); return `${tag} ${id} archive ${a?.said ?? 'not sent'}, archivedAt ${a?.archivedAt || 'NOT SET'}`; });
  for (const [role, persona] of Object.entries(team)) {
    const res = await send(pm, 'POST', `${t.P}/team`, { userId: ctx.people[persona], role });
    t.members.push({ persona, role, said: h.said(res), status: res.status });
  }
  t.shown = await dataOf(pm, t.P);
  return t;
};
/** Whether a throwaway was made with its whole team (each member answered 200 or 201). */
const teamOk = (t, team) => t.members.length === Object.keys(team).length && t.members.every((m) => [200, 201].includes(m.status));
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
/** The run date R and a day of the book ('R-10') as YYYY-MM-DD. */
const ymdIn = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const runDay = (offsetLabel) => addDaysIso(ctx.R, -offsetOf(offsetLabel));
/** GET /weather-delays as `who`: { rows, summary, monthly }. */
const registerOf = async (P, who = 'planner') => dataOf(who, `${P}/weather-delays`);
/** The register summary as the boundary leaves read it (the percentage at 2 dp). */
const summaryRead = (reg) => {
  const s = reg?.summary || {};
  return { allowance: s.allowance ?? null, contractualUsed: s.contractualUsed ?? null, consumedPct: pct2(s.consumedPct), warning: s.warning ?? null, remaining: s.remaining ?? null };
};
/** The monthly non-contractual days of the month of `day` (YYYY-MM-DD). */
const monthNonContractual = (reg, day) => listOf(reg?.monthly).find((m) => m.month === String(day).slice(0, 7))?.nonContractual ?? null;
/** The weather rows of a register whose description is `description`. */
const rowsNamed = (reg, description) => listOf(reg?.rows).filter((r) => r.description === description);
/** GET /eot as the planner: the claims of a project. */
const claimsOf = async (P, who = 'planner') => listOf(await dataOf(who, `${P}/eot`), 'claims');
const claimOf = async (P, id) => (await claimsOf(P)).find((c) => c.id === id) || null;
/** A daily-log delay entry's weatherDelayId, or 'gone' when the entry no longer exists (read-only SQL). */
const entryWeatherOf = async (entryId) => {
  const row = (await ctx.q('select "weatherDelayId" as w from "DailyLogDelay" where id = $1', [entryId]))[0];
  return row ? row.w ?? null : 'gone';
};
/** 087-COM's EOT claims, weather delays and audit events: counts and latest ids (read-only SQL; WP7ADJ Q3). */
const comFingerprint = async (projectId) => (await ctx.q(`select
    (select count(*)::int from "EotClaim" where "projectId" = $1) as "eotClaims",
    (select id from "EotClaim" where "projectId" = $1 order by "updatedAt" desc, id desc limit 1) as "latestEotClaim",
    (select max("updatedAt")::text from "EotClaim" where "projectId" = $1) as "eotUpdatedAt",
    (select count(*)::int from "WeatherDelay" where "projectId" = $1) as "weatherDelays",
    (select id from "WeatherDelay" where "projectId" = $1 order by "updatedAt" desc, id desc limit 1) as "latestWeatherDelay",
    (select count(*)::int from "AuditEvent" where "projectId" = $1) as "auditEvents",
    (select id from "AuditEvent" where "projectId" = $1 order by "occurredAt" desc, id desc limit 1) as "latestAuditEvent"`, [projectId]))[0] || null;
/** The notifications of a project created since `since` whose title, message or event names weather (read-only SQL). */
const weatherNotifications = async (projectId, since) => (await ctx.q(`select count(*)::int as n from "Notification" where "projectId" = $1 and "createdAt" >= ($2::timestamptz at time zone 'utc')
    and (title ilike $3 or message ilike $3 or event ilike $3)`, [projectId, since, `%${FIXTURE.notificationWord}%`]))[0]?.n ?? null;

// -- the PROMO-TX blocker queue (WP7ADJ Q2; the WP-2 r3 design, wp2-choreography.js) ----------------------------------------
// A waiter counts only if pg_blocking_pids() names the blocker or a request already queued behind it (QP-R2-T3).
const WAITERS_SQL = `select a.pid, a.wait_event_type, a.wait_event, left(a.query, 400) as query, pg_blocking_pids(a.pid) as blockers
    from pg_stat_activity a
   where a.datname = current_database() and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock' and pg_blocking_pids(a.pid) && $1::int[]`;
const BLOCKER_NAME = 'cert-wp7-blocker';
const PROBE_NAME = 'cert-wp7-probe';
/** The blocker and the probe: two pg connections of their own (h.connect, the cert guard), opened once per run. */
const queueConnections = async () => {
  if (!ctx.blockerDb) {
    ctx.blockerDb = await h.connect();
    await ctx.blockerDb.query(`set application_name = '${BLOCKER_NAME}'`);
    ctx.blockerPid = (await ctx.blockerDb.query('select pg_backend_pid() as pid')).rows[0].pid;
  }
  if (!ctx.probeDb) {
    ctx.probeDb = await h.connect();
    await ctx.probeDb.query(`set application_name = '${PROBE_NAME}'`);
  }
};
/** Rolls the blocker's transaction back (it read and locked one row and wrote nothing). */
const releaseBlocker = async () => {
  if (!ctx.blockerOpen) return;
  ctx.blockerOpen = false;
  await ctx.blockerDb.query('rollback');
};
/** The blocker takes FOR UPDATE on one daily-log delay entry: a read and a lock, nothing written. */
const holdEntry = async (id, entryId) => {
  await queueConnections();
  await ctx.blockerDb.query('begin');
  ctx.blockerOpen = true;
  const held = await ctx.blockerDb.query('select id from "DailyLogDelay" where id = $1 for update', [entryId]);
  if (held.rowCount !== 1) { await releaseBlocker(); throw probeSetup(id, `the blocker found no DailyLogDelay row ${entryId}`); }
};
const confirmWaiting = async (id, { label: what, behind, known, deadline }) => {
  for (;;) {
    const rows = (await ctx.probeDb.query(WAITERS_SQL, [behind])).rows.filter((row) => !known.has(row.pid) && String(row.query || '').includes(FIXTURE.waitingRelation));
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) throw probeSetup(id, `${what}: more than one new waiter matched (${json(rows)})`);
    if (Date.now() >= deadline) throw probeSetup(id, `${what}: never seen waiting behind the blocker (the barrier did not form)`);
    await h.sleep(FIXTURE.pollMs);
  }
};
/** The first of `promises` already settled, or null (a request that did not wait for the release). */
const settledEarly = async (promises) => {
  const marker = Symbol('pending');
  for (const p of promises) {
    // eslint-disable-next-line no-await-in-loop
    const first = await Promise.race([p, Promise.resolve(marker)]);
    if (first !== marker) return first;
  }
  return null;
};
/**
 * Holds the blocker on `entryId`, sends calls[i].start() in order, each confirmed waiting before the next, then releases
 * the blocker (ROLLBACK) and awaits every call. The release must come within the book's budget of the first send
 * (WP7.promotion.barrier.releaseWithinMs, inside Prisma's 5 s interactive-transaction window). Returns { results,
 * waiters, heldMs } (results[i] the answer). Any departure is R-SET.
 */
const queueBehindBlocker = async (id, entryId, calls) => {
  await holdEntry(id, entryId);
  const started = Date.now();
  const deadline = started + PROMO.barrier.releaseWithinMs;
  const behind = [ctx.blockerPid];
  const known = new Set([ctx.blockerPid]);
  const pending = [];
  const waiters = [];
  try {
    for (const call of calls) {
      pending.push(call.start());
      // eslint-disable-next-line no-await-in-loop
      const w = await confirmWaiting(id, { label: call.label, behind, known, deadline: Math.min(deadline, Date.now() + FIXTURE.confirmWaitingMs) });
      known.add(w.pid);
      behind.push(w.pid);
      waiters.push({ label: call.label, pid: w.pid, blockers: w.blockers, waitEvent: w.wait_event, query: String(w.query || '').slice(0, 160), atMs: Date.now() - started });
    }
    const early = await settledEarly(pending);
    if (early) throw probeSetup(id, `a request settled before the release (${h.said(early)}): it did not queue`);
    if (Date.now() - started > PROMO.barrier.releaseWithinMs) throw probeSetup(id, `the queue took ${Date.now() - started} ms, over the ${PROMO.barrier.releaseWithinMs} ms budget`);
  } catch (error) {
    await releaseBlocker();
    await Promise.allSettled(pending);
    throw error;
  }
  const heldMs = Date.now() - started;
  await releaseBlocker();
  const results = await Promise.all(pending);
  return { results, waiters, heldMs };
};

// -- static scans of backend/src (read only; tests, live suites and mocks excluded) ------------------------------------
const srcText = (rel) => { try { return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const stripComments = (text) => String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** The .js files under backend/src, tests, live suites, mocks and the OpenAPI spec excluded. */
const srcFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['__tests__', '__live__', '__mocks__', 'openapi'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.js')) out.push(full);
    }
  };
  try { walk(SRC); } catch { return null; }
  return out;
};
/** The confirm-first items read from the source: null where a file is not found (a gap, never a guess). */
const staticScan = () => {
  const files = srcFiles();
  const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');
  const texts = files ? files.map((f) => [rel(f), stripComments(fs.readFileSync(f, 'utf8'))]) : null;
  const weather = srcText('services/weather.service.js');
  const promote = srcText('services/daily-log.service.js');
  const contract = srcText('services/contract.service.js');
  const forecast = srcText('services/forecast.service.js');
  return {
    // the 70% flag: one writer, and no server code reads the register summary (only its route answers it)
    warningWriters: texts ? texts.filter(([, t]) => /warning:\s*consumedPct\s*>=\s*70/.test(t)).map(([f]) => f) : null,
    serverReadersOfSummaryWarning: texts ? texts.filter(([f, t]) => /listWeatherDelays\(/.test(t) && !['services/weather.service.js', 'routes/weather-delays.js'].includes(f)).length : null,
    allowanceOrTwenty: weather === null ? null : /const allowance = Number\(project\.weatherAllowanceDays\) \|\| 20;/.test(weather),
    weatherDaysIntoInt: weather === null ? null : /delayDays: Number\(payload\.delayDays\) \|\| 0,/.test(weather),
    // the promotion: an unlocked check, the weather delay in its own transaction, the entry linked after it
    promotionUnlockedCheck: promote === null ? null : /const \{ row, entry \} = await findEntry\(\{ tx: prisma, config: SECTIONS\.delays/.test(promote),
    promotionTwoWrites: promote === null ? null : /const created = await weatherService\.createWeatherDelay\(\{/.test(promote) && /await prisma\.dailyLogDelay\.update\(\{ where: \{ id: entry\.id \}, data: \{ weatherDelayId: created\.id/.test(promote),
    promotionContractualDefault: promote === null ? null : /contractual: payload\.contractual !== undefined \? Boolean\(payload\.contractual\) : true,/.test(promote),
    // the severity evidence (WP7ADJ Q6): who reads the weather rows the duplicates and orphans add to
    noticeMonitorReadsWeather: contract === null ? null : /safeMany\("weatherDelay"/.test(contract),
    forecastReadsWeatherLinks: forecast === null ? null : /weatherDelayActivityLink/.test(forecast),
  };
};

// -- stored moments (pure over a state file and the book; exported for the registration check) -------------------------
/** 087-COM's WP-7 build moments: eot.figures (row 153) and the ids the live reads need. */
const storedCom087 = (st) => {
  const fig = st?.steps?.['eot.figures'];
  const o = { step: fig?.status ?? 'not run', t2: { cumulative: fig?.out?.t2?.cumulative ?? null, recommendation: dayOf(fig?.out?.t2?.recommendation) }, t3: { cumulative: fig?.out?.t3?.cumulative ?? null, recommendation: dayOf(fig?.out?.t3?.recommendation) } };
  const e = { step: 'done', t2: { cumulative: WP7.T2.cumulativeApprovedEotDays.value, recommendation: WP7.T2.revisedCompletionRecommendation.value }, t3: { cumulative: WP7.T3.cumulativeApprovedEotDays.value, recommendation: WP7.T3.revisedCompletionRecommendation.value } };
  const claims = Object.fromEntries(['T2', 'T3', 'REJECTED', 'SUBMITTED', 'DRAFT'].map((k) => [k, { id: st?.steps?.[`eot.${k}`]?.out?.id ?? null, status: st?.steps?.[`eot.${k}`]?.out?.status ?? null }]));
  return {
    'COM.stored.eotFigures': { ok: sameJson(o, e), expected: e, observed: o, detail: 'the step done means the build asserted T2 and T3 against WP7.T2 / WP7.T3 (build/087-com.js step eot.figures; MOMENT-MAP row 153)' },
    storedAt: stepAt(st, 'eot.figures'),
    claims,
    weatherDelayId: st?.steps?.['weather-delay']?.out?.id ?? null,
    activities: { A110: st?.steps?.activities?.out?.ids?.A110 ?? null, A120: st?.steps?.activities?.out?.ids?.A120 ?? null },
  };
};
/** A summary at the four fields the book's reads state (the percentage at 2 dp). */
const four = (s) => ({ contractualUsed: s?.contractualUsed ?? null, consumedPct: pct2(s?.consumedPct), warning: s?.warning ?? null, remaining: s?.remaining ?? null });
/** 087-FLD's or 052-FLD's stored weather moments (steps weather.at13.read / weather.at14.read; rows 178, 179, 247, 248). */
const storedFld = (st, code) => {
  const r13 = st?.steps?.['weather.at13.read'];
  const r14 = st?.steps?.['weather.at14.read'];
  const stored = r14?.out?.stored || {};
  const nc = st?.steps?.['weather.non-contractual']?.out;
  return {
    code,
    steps: { at13Read: r13?.status ?? 'not run', at14Read: r14?.status ?? 'not run', at13: st?.steps?.['weather.at13']?.status ?? 'not run', at14: st?.steps?.['weather.at14']?.status ?? 'not run' },
    at13: four(r13?.out?.summary),
    at14: four(r14?.out?.summary),
    storedRows: [...(stored.promoted || []), ...(stored.manual13 || []), ...(stored.manual14 || [])],
    storedAt: stepAt(st, 'weather.at14.read'),
    nonContractualDay: code === '087-FLD' ? nc?.day ?? null : null,
    nonContractualMonth: code === '087-FLD' ? nc?.month?.month ?? null : null,
  };
};
/** The stored known answer of 087-FLD: { at13, at14 } against WP7.weather['087-FLD.read'] value / today. */
const fld087Verdict = (s) => {
  const rd = WP7.weather['087-FLD.read'];
  const o = { at13: s.at13, at14: s.at14 };
  return judge(o, (x) => sameJson(x, { at13: rd.value.at13, at14: rd.value.at14 }), (x) => sameJson(x, { at13: rd.today.at13, at14: rd.today.at14 }));
};
/** The stored known answer of 052-FLD: { first, then } as [pct, warning] against WP7.weather['052-FLD']. */
const fld052Observed = (s) => ({ first: [s.at13.consumedPct, s.at13.warning], then: [s.at14.consumedPct, s.at14.warning] });
const fld052Verdict = (s) => { const L52 = WP7.weather['052-FLD']; return judge(fld052Observed(s), (x) => sameJson(x, L52.value), (x) => sameJson(x, L52.today)); };

/** One race round's observation projected on the leaf's value and today (WP7.promotion.race.perRound). */
const raceRoundVerdict = (o) => {
  const R = WP7.promotion.race;
  return judge(o, (x) => sameJson(pick(x, R.value.perRound), R.value.perRound), (x) => sameJson(pick(x, R.today.perRound), R.today.perRound));
};
/** One failure round's observation (WP7.promotion.failure.perRound): value with the fix's code (CONTRACT failureCode) or any status not 2xx. */
const failureRoundVerdict = (o) => {
  const F = WP7.promotion.failure;
  const code = CONTRACT['PROMO-TX'].failureCode;
  const isValue = (x) => x.deleteStatus === F.value.perRound.deleteStatus && x.promotionIs2xx === F.value.perRound.promotionIs2xx && (code ? x.promotionSaid === code : true)
    && x.rowsAdded === F.value.perRound.rowsAdded && x.contractualUsedDelta === F.value.perRound.contractualUsedDelta;
  return judge(o, isValue, (x) => sameJson(pick(x, F.today.perRound), F.today.perRound));
};

// -- setup --------------------------------------------------------------------------------------------------------------
/** The build steps whose stored outputs (moment answers and ids) the proof reads, per state file; `blocked` a step that may be BLOCKED with that ref. */
const STATE_STEPS = {
  '087-COM': { done: ['activities', 'weather-delay', 'eot.T2', 'eot.T3', 'eot.REJECTED', 'eot.SUBMITTED', 'eot.DRAFT', 'eot.figures'], blocked: {} },
  '087-FLD': { done: ['weather.at13.read', 'weather.at14.read', 'weather.non-contractual'], blocked: { 'weather.at13': 'HR-C11', 'weather.at14': 'HR-C11' } },
  '052-FLD': { done: ['weather.at13.read', 'weather.at14.read'], blocked: { 'weather.at13': 'HR-C11', 'weather.at14': 'HR-C11' } },
};
/** The personas: 087's, and 052's two readers only when F52 is selected (WP7ADJ Q7). */
const PERSONAS = {
  pm: ['087', 'pm'], planner: ['087', 'planner'], site: ['087', 'site'], pm052: ['052', 'pm'], planner052: ['052', 'planner'],
};
if (Object.values(PERSONAS).some(([code]) => !['087', '052'].includes(code))) throw new Error('a persona outside company 087 and 052\'s read of 052-FLD');
/** The leaves the 13 KA checks read (their book keys): each must carry a today and a ref and be an assumption (KA.I9 ruling). */
const KA_KEYS = [...new Set(CHECKS.filter((c) => c.id.startsWith('KA.')).map((c) => c.bookKey))];

const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  // S.book: the load guard above passed (the WP-7 leaves exist with their patched values); figures() carries ref in both books.
  const rowsC = COMMERCIAL.figures();
  const rowsF = FIELD.figures();
  const withRef = (rows) => rows.filter((row) => Object.prototype.hasOwnProperty.call(row, 'ref') && row.ref).length;
  const kaBad = KA_KEYS.filter((key) => { const leaf = leafAt(key); return !leaf || !leaf.ref || leaf.today === undefined || leaf.assumption !== true || sameJson(leaf.value, leaf.today); });
  const fcRefs = ['WP8.dailyLog.promoteResponseVsStored', 'WP8.weather.nonContractualAddsNothing'].filter((key) => rowsF.find((r) => r.key === key)?.ref !== 'HR-C11');
  rec('S.book', rowsC.length > 0 && withRef(rowsC) > 0 && withRef(rowsF) >= 2 && WP7_PATCH_LEAVES.every((key) => leafAt(key)) && kaBad.length === 0 && fcRefs.length === 0, { observed: { commercial: { head: COMMERCIAL.meta.head, figures: rowsC.length, withRef: withRef(rowsC) }, fieldControls: { head: FIELD.meta.head, figures: rowsF.length, withRef: withRef(rowsF) }, patchLeaves: WP7_PATCH_LEAVES.length, kaLeaves: KA_KEYS.length, kaBad, fieldControlsRefsMissing: fcRefs }, detail: 'the WP-7 patch: 36 new keys, the known answers\' refs (HR-C10, HR-C11, HR-F4, PROMO-TX), the two field-controls refs of WP7ADJ Q12; the FIXTURE agreed with every leaf at load' });

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
    // 087's run date R = min(today in UTC, today in the company's zone) (build/lib.js:879): every T7 / T7H day is R-n.
    const now = new Date();
    ctx.zone = ctx.orgs['087'].timezone || null;
    const utc = ymdIn(now, 'UTC');
    const local = ymdIn(now, ctx.zone || 'UTC');
    ctx.R = utc < local ? utc : local;
    obs.runDate = { R: ctx.R, utc, local, zone: ctx.zone };
  }
  for (const [key, [code, who]] of Object.entries(PERSONAS)) {
    if (!NEED_COMPANIES.includes(code) || !ctx.orgs[code]) continue;
    const email = `${who}@${specs[code].domain}`;
    ctx.sessions[key] = api.as({ email, orgId: ctx.orgs[code].id });
    const me = await get(key, '/auth/me');
    if (me.status !== 200) problems.push(`${key} (${email}): GET /auth/me ${h.said(me)}`);
    else {
      ctx.people[key] = me.body?.data?.id;
      if ((me.body?.data?.active?.orgId ?? me.body?.data?.orgId) !== ctx.orgs[code].id) problems.push(`${key}: session in another org`);
    }
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
      for (const [step, ref] of Object.entries(want.blocked)) {
        const st = ctx.state[code].steps?.[step];
        const fine = st?.status === 'done' || (st?.status === 'blocked' && st.blocked?.ref === ref);
        if (!fine) stateProblems.push(`${code}: step ${step} is ${st?.status || 'not run'}${st?.status === 'blocked' ? ` (${st.blocked?.ref}; allowed ${ref})` : ''}`);
      }
    } catch (error) {
      stateProblems.push(`${code}: ${error.message}`);
    }
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
  rec('S.state', stateProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.state).map(([c, s]) => [c, { projectId: s.projectId, runs: s.runs?.length, runDates: (s.runs || []).map((r) => r.runDate), updatedAt: s.updatedAt }])), detail: stateProblems.join('; ') || `${NEED_DEEP.length} state files (${NEED_DEEP.join(', ') || 'none needed'}), every needed step done (or BLOCKED HR-C11 where allowed); fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}` });

  // S.projects: the deep projects by their exact names, through the API as their company's PM.
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
  rec('S.projects', projectProblems.length === 0, { observed: { orgs: Object.fromEntries(Object.entries(ctx.orgs).map(([c, o]) => [c, { id: o.id, slug: o.slug, timezone: o.timezone }])), people: Object.keys(ctx.people), projects: Object.fromEntries(Object.entries(ctx.deep).map(([c, d]) => [c, d.id])), runDate: obs.runDate || null }, detail: projectProblems.join('; ') || `${NEED_COMPANIES.length} companies (${NEED_COMPANIES.join(', ')}), ${Object.keys(ctx.people).length} sessions, ${NEED_DEEP.length} deep projects (${NEED_DEEP.join(', ') || 'none needed'}), one live each, matching the state; run date ${ctx.R} (${ctx.zone})` });
  if (projectProblems.length || stateProblems.length) throw new Error(`setup: ${[...stateProblems, ...projectProblems].join('; ')}`);
};

// -- T7: T7-0 and T7-1, the project, its team and its network (S.T7.create, S.T7.network) --------------------------------
const nullableNumber = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const t7Create = async () => {
  const t = await makeThrowaway({ pm: 'pm', label: 'T7', project: T7B.project, team: T7B.team });
  ctx.t7 = t;
  const s = t.shown || {};
  const P0 = T7B.project;
  const o = { said: h.said(t.created), startDate: dayOf(s.startDate), endDate: dayOf(s.endDate), completionDate: dayOf(s.completionDate), projectCalendar: s.projectCalendar ?? null, currency: s.currency ?? null, ldRatePerDay: cents(s.ldRatePerDay), weatherAllowanceDays: nullableNumber(s.weatherAllowanceDays), defaultRetentionRate: nullableNumber(s.defaultRetentionRate) };
  const e = { said: '201', startDate: P0.startDate, endDate: P0.endDate, completionDate: P0.completionDate, projectCalendar: P0.projectCalendar, currency: P0.currency, ldRatePerDay: P0.ldRatePerDay, weatherAllowanceDays: P0.weatherAllowanceDays, defaultRetentionRate: P0.defaultRetentionRate };
  const ok = sameJson(o, e) && teamOk(t, T7B.team);
  rec('S.T7.create', ok, { expected: { project: e, team: T7B.team }, observed: { id: t.id, ...o, team: t.members }, detail: 'completionDate 2027-06-30 is T2\'s base (deep.087-COM.completion); the LD rate read back in cents; explicit defaultRetentionRate 10, so WP-7 never depends on HR-C1' });
  need(ok, 'T7-0: T7 or its team could not be made');
};
const t7Network = async () => {
  const t = ctx.t7;
  const N = T7B.network;
  const made = [];
  for (const [i, [code, days]] of N.activities.entries()) {
    const preds = N.links.filter(([, to]) => to === code);
    // engineerIds is required by the route (routes/activities.js:125-127, at least one); the site engineer on T7's team
    // (WP7.T7.team), as WP-6's B6 fixture does. Debug run 1: without it every create answered 400 VALIDATION_ERROR.
    const res = await send('planner', 'POST', `${t.P}/activities`, { name: label(`activity ${code}`), activityCode: code, wbsCode: 'WP7-T7', duration: days, sortOrder: i, engineerIds: [ctx.people.site], ...(preds.length ? { dependencies: preds.map(([from, , type, lag]) => ({ predecessorId: t.acts[from], relationshipType: type, lagDays: lag })) } : {}) });
    t.acts[code] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push([code, h.said(res)]);
  }
  for (const [code, id] of Object.entries(t.acts)) if (id) t.actCode[id] = code;
  const rows = listOf(await dataOf('planner', `${t.P}/activities`));
  const rowOf = (code) => rows.find((r) => r.id === t.acts[code]) || null;
  const read = Object.fromEntries(N.activities.map(([code]) => { const r = rowOf(code); return [code, { TF: nullableNumber(r?.totalFloat), critical: r ? r.isCritical === true : null }]; }));
  const expect = Object.fromEntries(N.activities.map(([code]) => [code, { TF: N.cpm[code].TF, critical: N.cpm[code].critical }]));
  const linksRead = N.links.map(([from, to, type]) => ({ from, to, type, found: listOf(rowOf(to)?.dependencies).some((d) => d.predecessorId === t.acts[from] && d.relationshipType === type) }));
  const ok = made.every(([, said]) => said === '201') && sameJson(read, expect) && linksRead.every((l) => l.found);
  rec('S.T7.network', ok, { expected: { cpm: expect, links: N.links }, observed: { made, cpm: read, links: linksRead }, detail: 'the product\'s CPM (cpm.service.js:449-485) on the planner\'s network: T7-C1 -> T7-C2 one chain at TF 0, T7-F4 TF 4 (WP7.T7.network)' });
  need(ok, 'T7-1: T7\'s network could not be built as the book has it');
};

// -- T7: W1-W7, the weather boundaries and allowance 0 (W.T7.*, KA.W.T7.allowanceZero; CF.HRC11's notification read) ------
const t7Weather = async () => {
  const t = ctx.t7;
  const { P } = t;
  let allowance = T7B.project.weatherAllowanceDays;
  const setAllowance = async (n) => {
    if (n === allowance) return;
    const r = await send('pm', 'PATCH', P, { weatherAllowanceDays: n });
    need(r.status === 200, `the PM could not set T7's weather allowance to ${n} (${h.said(r)} ${r.body?.error?.message || ''})`);
    allowance = n;
  };
  const postRow = async (key) => {
    const b = weatherRowBook(key);
    const date = runDay(b.day);
    const res = await send('planner', 'POST', `${P}/weather-delays`, { description: label(`weather ${key}`), date, delayDays: b.delayDays, contractual: b.contractual });
    const id = res.status === 201 ? res.body?.data?.id || null : null;
    need(Boolean(id), `T7's weather row ${key} could not be posted (${h.said(res)} ${res.body?.error?.message || ''})`);
    t.weather[key] = { ...b, id, date };
  };
  const patchRow = async (key, contractual) => {
    const r = await send('planner', 'PATCH', `${P}/weather-delays/${t.weather[key].id}`, { contractual });
    need(r.status === 200, `T7's weather row ${key} could not be PATCHed contractual ${contractual} (${h.said(r)})`);
  };
  obs.weatherSteps = [];
  for (const step of T7B.weather.steps) {
    // The flag's moment: notifications are counted from just before the register first reaches 70% (W2).
    if (step.step === 'W2') obs.notificationsSince = new Date(Date.now() - 1000).toISOString();
    await setAllowance(step.allowance);
    for (const key of step.post) await postRow(key);
    for (const key of step.contractualFalse) await patchRow(key, false);
    for (const key of step.contractualTrue) await patchRow(key, true);
    const reg = await registerOf(P);
    const o = summaryRead(reg);
    obs.weatherSteps.push({ step: step.step, allowance, read: o, rawConsumedPct: reg?.summary?.consumedPct ?? null });
    const id = WEATHER_CHECKS[step.step];
    if (step.step === 'W6') {
      await probe('KA.W.T7.allowanceZero (W6: the allowance set to 0)', async () => {
        const shown = await dataOf('pm', P);
        if (shown?.weatherAllowanceDays === null || shown?.weatherAllowanceDays === undefined || Number(shown.weatherAllowanceDays) !== 0) throw probeSetup('KA.W.T7.allowanceZero', `the project reads weatherAllowanceDays ${shown?.weatherAllowanceDays}, not 0`);
        const leaf = WP7.weather['allowanceZero.T7'];
        obs.allowanceZero = { projectReads: Number(shown.weatherAllowanceDays), summary: o, warning: reg?.summary?.warning ?? null, warningLeaf: { value: WP7.weather['allowanceZero.warning'].value, today: WP7.weather['allowanceZero.warning'].today, note: 'no expected value (adjudication C6): recorded for CF.HRC11, never judged' } };
        ka('KA.W.T7.allowanceZero', { ref: leaf.ref, value: leaf.value, today: leaf.today, observed: o, verdict: judge(o, (x) => sameJson(pick(x, leaf.value), leaf.value), (x) => sameJson(x, leaf.today)), detail: 'the project stores 0 (project.service.js:351) and the register reads Number(0) || 20 (weather.service.js:161); the warning is recorded for CF.HRC11 (WP7.weather.allowanceZero.warning: no expected value)' });
      });
      obs.notificationsNamingWeather = await weatherNotifications(t.id, obs.notificationsSince);
    } else if (step.step === 'W7') {
      obs.w7 = { read: o, book: step.read, same: sameJson(o, step.read) };
    } else if (id === 'W.T7.nonContractual10') {
      const nc = WP7.weather.nonContractual10.value;
      const oo = { contractualUsed: o.contractualUsed, monthlyNonContractual: monthNonContractual(reg, t.weather['WN-10'].date) };
      rec(id, sameJson(oo, nc), { expected: nc, observed: { ...oo, month: String(t.weather['WN-10'].date).slice(0, 7), monthly: reg?.monthly ?? null }, detail: 'a non-contractual row is skipped in contractualUsed (weather.service.js:162-165) and booked in its month (:169-185); judged on WP7.weather.nonContractual10\'s two fields' });
    } else {
      rec(id, sameJson(o, step.read), { expected: step.read, observed: { ...o, rawConsumedPct: reg?.summary?.consumedPct ?? null }, detail: `WP7.T7.weatherSequence ${step.step} at allowance ${allowance} (listWeatherDelays, weather.service.js:161-200; the percentage at 2 dp, F2)` });
    }
  }
};

// -- T7: E1-E3, the approvals, the PATCH probe and the approved-state probes ---------------------------------------------
/** The E2 PATCH as the step text names it ({eotDaysGranted: 30}), which must be the known answer's today. */
const PATCH_TO = Number((/\{eotDaysGranted: (\d+)\}/.exec(stepText(T7B.choreography, 'E2')) || [])[1]);
if (PATCH_TO !== WP7.T2.plannerPatchApproved.today.eotDaysGranted) throw new Error('FIXTURE against the WP-7 book: the E2 step does not PATCH E-T2 to WP7.T2.plannerPatchApproved.today.eotDaysGranted');
/** A claim body of the book (WP7.T7.claims) for claim `key`, sent by the planner; the activity links start on R-30. */
const claimBody = (t, key, tag, { status = null, activities = null, weatherDelays = null } = {}) => {
  const b = claimBook(key);
  const acts = activities ?? b.activities;
  const wds = weatherDelays ?? b.weatherDelays;
  return {
    eventName: label(`claim ${tag}`),
    eventType: FIXTURE.eventTypes[key] || FIXTURE.defaultEventType,
    delayDays: b.delayDays,
    eotDaysGranted: b.eotDaysGranted,
    ...(acts.length ? { activityLinks: acts.map((code) => ({ activityId: t.acts[code], delayStart: runDay(T7B.claims.delayStart) })) } : {}),
    ...(wds.length ? { weatherDelayIds: wds.map((w) => t.weather[w]?.id) } : {}),
    ...(status ? { status } : {}),
  };
};
const createClaim = async (t, key, tag, opts = {}) => {
  const body = claimBody(t, key, tag, opts);
  const res = await send('planner', 'POST', `${t.P}/eot`, body);
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  if (id) t.claims[tag] = id;
  return { res, body, id };
};
/** A claim's own PDF attached and PATCHed in as documentIds: whether the claim's attachmentRefs name it. */
const evidenceFor = async (t, id, tag) => {
  const documentId = await attachPdf('planner', t.P, 'eot', id, `evidence ${tag}`);
  const pa = await send('planner', 'PATCH', `${t.P}/eot/${id}`, { documentIds: [documentId] });
  const row = await claimOf(t.P, id);
  return { documentId, patch: h.said(pa), named: listOf(row?.attachmentRefs).some((r) => r.documentId === documentId) };
};
/** A draft with its activity and its own document (the proof a submission needs). */
const draftWithProof = async (t, key, tag, opts = {}) => {
  const c = await createClaim(t, key, tag, opts);
  need(Boolean(c.id), `claim ${tag} could not be drafted (${h.said(c.res)} ${c.res.body?.error?.message || ''})`);
  const ev = await evidenceFor(t, c.id, tag);
  need(ev.patch === '200' && ev.named, `claim ${tag}'s document could not be named (${json(ev)})`);
  return { ...c, ev };
};
const submitAndApprove = async (t, id) => {
  const s = await send('planner', 'POST', `${t.P}/eot/${id}/submit`, { comment: label('submitted with particulars') });
  const a = s.status === 200 ? await send('pm', 'POST', `${t.P}/eot/${id}/approve`, { comment: label('entitlement agreed') }) : null;
  return { submit: h.said(s), approve: a ? h.said(a) : 'not sent' };
};
/** A claim as the approval checks read it: status, cumulative, recommendation day, approver, officialAt, weather links by key. */
const approvalRead = (t, row) => ({
  status: row?.status ?? null,
  cumulativeApprovedEotDays: row?.cumulativeApprovedEotDays ?? null,
  revisedCompletionRecommendation: dayOf(row?.revisedCompletionRecommendation),
  approvedBy: row?.approvedBy === ctx.people.pm ? 'pm' : row?.approvedBy ?? null,
  officialAt: Boolean(row?.officialAt),
  weatherDelayLinks: listOf(row?.weatherDelayLinks).map((l) => Object.entries(t.weather).find(([, w]) => w.id === l.weatherDelayId)?.[0] || l.weatherDelayId),
});
const t7Approvals = async () => {
  const t = ctx.t7;
  // E1: E-T2 (WR-6 linked) and E-T3, each with its own document (S.T7.evidence), then approved in that order
  const e2 = await createClaim(t, 'E-T2', 'E-T2');
  const e3 = await createClaim(t, 'E-T3', 'E-T3');
  need(Boolean(e2.id) && Boolean(e3.id), `E1: E-T2 / E-T3 could not be drafted (${h.said(e2.res)}, ${h.said(e3.res)})`);
  const ev2 = await evidenceFor(t, e2.id, 'E-T2');
  const ev3 = await evidenceFor(t, e3.id, 'E-T3');
  const evOk = [ev2, ev3].every((ev) => ev.patch === '200' && ev.named);
  rec('S.T7.evidence', evOk, { expected: { 'E-T2': { patch: '200', named: true }, 'E-T3': { patch: '200', named: true } }, observed: { 'E-T2': ev2, 'E-T3': ev3 }, detail: 'POST /projects/T7/attachments (recordType eot, the claim; the planner\'s own upload) then PATCH documentIds: the claim\'s attachmentRefs name it (commercial-traceability syncEvidenceReferences)' });
  need(evOk, 'E1: the claims\' documents could not be named');
  obs.eotRec2 = { eT3CalcAtCreate: dayOf(e3.res.body?.data?.entitlementSummaryJson?.revisedCompletionRecommendation), book: T7B.claims.approvals['E-T3'].calcRecommendationAtCreate };
  const f2 = await submitAndApprove(t, e2.id);
  const r2 = approvalRead(t, await claimOf(t.P, e2.id));
  const x2 = { submit: '200', approve: '200', status: 'approved', cumulativeApprovedEotDays: WP7.T2.cumulativeApprovedEotDays.value, revisedCompletionRecommendation: WP7.T2.revisedCompletionRecommendation.value, approvedBy: 'pm', officialAt: true, weatherDelayLinks: claimBook('E-T2').weatherDelays };
  rec('T2.T7.approve', sameJson({ ...f2, ...r2 }, x2), { expected: x2, observed: { ...f2, ...r2 }, detail: 'buildApprovedCompletionRecommendation (eot.service.js:288-327): 0 prior + 10; completion 2027-06-30 + 10 calendar days' });
  const f3 = await submitAndApprove(t, e3.id);
  const r3 = approvalRead(t, await claimOf(t.P, e3.id));
  const r2b = approvalRead(t, await claimOf(t.P, e2.id));
  obs.eotRec2.approvalColumn = r3.revisedCompletionRecommendation;
  const o3 = { ...f3, status: r3.status, cumulativeApprovedEotDays: r3.cumulativeApprovedEotDays, revisedCompletionRecommendation: r3.revisedCompletionRecommendation, eT2: { cumulativeApprovedEotDays: r2b.cumulativeApprovedEotDays, revisedCompletionRecommendation: r2b.revisedCompletionRecommendation } };
  const x3 = { submit: '200', approve: '200', status: 'approved', cumulativeApprovedEotDays: WP7.T3.cumulativeApprovedEotDays.value, revisedCompletionRecommendation: WP7.T3.revisedCompletionRecommendation.value, eT2: { cumulativeApprovedEotDays: WP7.T2.cumulativeApprovedEotDays.value, revisedCompletionRecommendation: WP7.T2.revisedCompletionRecommendation.value } };
  rec('T3.T7.approve', sameJson(o3, x3), { expected: x3, observed: o3, detail: 'the other approved claims summed (eot.service.js:303-318): 10 + 5; the calculation\'s own recommendation at create (this claim\'s days only) is recorded for CF.HRC10, never judged (EOT-REC-2)' });
  // E2: the PATCH of E-T2 after E-T3's approval (the order trap, G3)
  await probe('KA.T2.plannerPatchApproved (E2: the planner PATCHes the approved E-T2)', async () => {
    const before = await claimOf(t.P, e2.id);
    if (before?.status !== 'approved' || r3.status !== 'approved') throw probeSetup('KA.T2.plannerPatchApproved', `E-T2 is ${before?.status}, E-T3 ${r3.status}: the probe needs both approved first`);
    const pa = await send('planner', 'PATCH', `${t.P}/eot/${e2.id}`, { eotDaysGranted: PATCH_TO });
    const after = await claimOf(t.P, e2.id);
    const e3After = await claimOf(t.P, e3.id);
    const sp = saidParts(h.said(pa));
    const o = { status: sp.status, code: sp.code, eotDaysGranted: after?.eotDaysGranted ?? null, cumulativeApprovedEotDays: after?.cumulativeApprovedEotDays ?? null };
    const L = WP7.T2.plannerPatchApproved;
    const locked = CONTRACT['HR-C10'].lockedAnswer;
    obs.plannerPatch = { ...o, eT3After: { cumulativeApprovedEotDays: e3After?.cumulativeApprovedEotDays ?? null, revisedCompletionRecommendation: dayOf(e3After?.revisedCompletionRecommendation) } };
    ka('KA.T2.plannerPatchApproved', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => x.status === L.value.status && (locked ? `${x.status} ${x.code}` === locked : true) && x.eotDaysGranted === L.value.eotDaysGranted && x.cumulativeApprovedEotDays === L.value.cumulativeApprovedEotDays, (x) => sameJson(pick(x, L.today), L.today)), detail: `updateEotClaim has no status check (eot.service.js:805-842); the code of the refusal is the fix's (CONTRACT ${locked || 'pending'}); E-T3 after: ${json(obs.plannerPatch.eT3After)}` });
  });
  // E3: E-LK1 and E-LK2 approved last, one approved-state probe each (M-STAT's catchers)
  const lk1 = await draftWithProof(t, 'E-LK1', 'E-LK1');
  const lk2 = await draftWithProof(t, 'E-LK2', 'E-LK2');
  const a1 = await submitAndApprove(t, lk1.id);
  const a2 = await submitAndApprove(t, lk2.id);
  need(a1.approve === '200' && a2.approve === '200', `E3: E-LK1 / E-LK2 could not be approved (${json([a1, a2])})`);
  obs.lockClaims = { 'E-LK1': approvalRead(t, await claimOf(t.P, lk1.id)), 'E-LK2': approvalRead(t, await claimOf(t.P, lk2.id)), note: 'their cumulatives are not judged (WP7.T7.claims: 36 / 37 at HEAD after the PATCH, 16 / 17 under the lock)' };
  const refusal = async (res, id) => { const sp = saidParts(h.said(res)); const row = await claimOf(t.P, id); const d = res.body?.error?.details || {}; return { status: sp.status, code: sp.code, details: { fromStatus: d.fromStatus ?? null, toStatus: d.toStatus ?? null }, claimStatus: row?.status ?? null }; };
  const pd = await send('planner', 'PATCH', `${t.P}/eot/${lk1.id}`, { status: FIXTURE.probeStatus.patchDraft });
  const od = await refusal(pd, lk1.id);
  rec('T1.T7.patchApprovedToDraft', sameJson(od, WP7.T1.patchApprovedToDraft.value), { expected: WP7.T1.patchApprovedToDraft.value, observed: od, detail: 'the route allows status draft (routes/eot.js:261-263); assertEotWorkflowTransition finds no action for approved -> draft (eot.service.js:259-286); M-STAT\'s catcher' });
  const rj = await send('pm', 'POST', `${t.P}/eot/${lk2.id}/reject`, { reason: label('approved claim rejected') });
  const orj = await refusal(rj, lk2.id);
  rec('T1.T7.rejectApproved', sameJson(orj, WP7.T1.rejectApproved.value), { expected: WP7.T1.rejectApproved.value, observed: orj, detail: 'approved -> rejected has no workflow action (the map allows submitted -> rejected only, eot.service.js:267-272); M-STAT\'s catcher, on its own claim' });
};

// -- T7: E4, impact and LD on the claim and through /eot/calculate (KA.T4.T7, T5.T7) ------------------------------------
const withoutLinks = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'linkFloatDays'));
/** A draft claim read back (the stored fields of G6) and the same body through POST /eot/calculate. */
const impactRead = async (id, t, key) => {
  const c = await createClaim(t, key, key);
  if (!c.id) throw probeSetup(id, `${key} could not be drafted (${h.said(c.res)} ${c.res.body?.error?.message || ''})`);
  const row = await claimOf(t.P, c.id);
  const esj = row?.entitlementSummaryJson || {};
  const links = listOf(row?.activityLinks);
  const stored = { criticalPathImpactDays: esj.criticalPathImpactDays ?? null, ldApplicableDays: esj.ldApplicableDays ?? null, ldLiability: cents(row?.ldLiability), linkFloatDays: claimBook(key).activities.map((code) => { const l = links.find((x) => x.activityId === t.acts[code]); return l ? Number(l.floatDays) : null; }) };
  const calc = await send('planner', 'POST', `${t.P}/eot/calculate`, { eventName: c.body.eventName, eventType: c.body.eventType, delayDays: c.body.delayDays, eotDaysGranted: c.body.eotDaysGranted, activityLinks: c.body.activityLinks });
  if (calc.status !== 200) throw probeSetup(id, `POST /eot/calculate answered ${h.said(calc)}`);
  const cd = calc.body?.data || {};
  const calculate = { criticalPathImpactDays: cd.criticalPathImpactDays ?? null, ldApplicableDays: cd.ldApplicableDays ?? null, ldLiability: cents(cd.ldLiability) };
  return { claimId: c.id, stored, calculate, linksImpactSum: links.reduce((s, l) => s + (Number(l.criticalPathImpactDays) || 0), 0), ldRatePerDay: cents(row?.ldRatePerDay) };
};
const t7Impact = async () => {
  const t = ctx.t7;
  await probe('KA.T4.T7 (E4: E-T4 on two zero-float activities of one chain)', async () => {
    const r = await impactRead('KA.T4.T7', t, 'E-T4');
    obs.t4 = r;
    const L = WP7.T4.storedFields;
    const o = { stored: r.stored, calculate: r.calculate };
    ka('KA.T4.T7', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => sameJson(x.stored, L.value) && sameJson(x.calculate, withoutLinks(L.value)), (x) => sameJson(x.stored, L.today) && sameJson(x.calculate, withoutLinks(L.today))), detail: `calculateEot sums the per-activity impact (eot.service.js:404-407); the claim stores it (entitlementSummaryJson, ldLiability) and the links their float; T7's LD rate ${r.ldRatePerDay} cents` });
  });
  // A setup failure here (the draft or the calculation refused) throws: a section error (exit 1), never a FAIL.
  const r5 = await impactRead('T5.T7', t, 'E-T5');
  obs.t5 = r5;
  const L5 = WP7.T5.storedFields.value;
  const o5 = { stored: r5.stored, calculate: r5.calculate };
  rec('T5.T7', sameJson(o5.stored, L5) && sameJson(o5.calculate, withoutLinks(L5)), { expected: { stored: L5, calculate: withoutLinks(L5) }, observed: o5, detail: 'one activity, float 4: max(0, 10 - 4) = 6 (eot.service.js:381); the summed and the least-float impact agree, so no today' });
};

// -- T7: E5, the T1 claims and E-HALF (T1.T7.*, CF.HRC11's EOT half day) -------------------------------------------------
const t7States = async () => {
  const t = ctx.t7;
  const count = async () => (await claimsOf(t.P)).length;
  const fieldsOf = (res) => listOf(res.body?.error?.details).map((d) => d.field);
  const statusOf = async (id) => (await claimOf(t.P, id))?.status ?? null;
  // createApproved: POST with status approved, otherwise valid
  const n0 = await count();
  const ca = await send('planner', 'POST', `${t.P}/eot`, claimBody(t, 'T1-*', 'T1 create approved', { status: FIXTURE.probeStatus.createApproved }));
  const n1 = await count();
  rec('T1.T7.createApproved', h.is(ca, saidOf(WP7.T1.createApproved)) && fieldsOf(ca).includes('status') && n1 === n0, { expected: { said: saidOf(WP7.T1.createApproved), field: 'status', written: 0 }, observed: { said: h.said(ca), fields: fieldsOf(ca), written: n1 - n0 }, detail: 'the route allows draft or submitted only (routes/eot.js:156)' });
  // submitWithoutProof: no document, then no activity
  const nd = await createClaim(t, 'T1-*', 'T1 no document');
  need(Boolean(nd.id), `E5: the no-document draft could not be made (${h.said(nd.res)})`);
  const s1 = await send('planner', 'POST', `${t.P}/eot/${nd.id}/submit`, {});
  const na = await createClaim(t, 'T1-*', 'T1 no activity', { activities: [] });
  need(Boolean(na.id), `E5: the no-activity draft could not be made (${h.said(na.res)})`);
  const evNa = await evidenceFor(t, na.id, 'T1 no activity');
  need(evNa.patch === '200' && evNa.named, `E5: the no-activity draft's document could not be named (${json(evNa)})`);
  const s2 = await send('planner', 'POST', `${t.P}/eot/${na.id}/submit`, {});
  const proofOf = async (res, id) => { const sp = saidParts(h.said(res)); const d = res.body?.error?.details || {}; return { status: sp.status, code: sp.code, details: { activityCount: d.activityCount ?? null, supportingDocumentCount: d.supportingDocumentCount ?? null }, claimStatus: await statusOf(id) }; };
  const op = { noDocument: await proofOf(s1, nd.id), noActivity: await proofOf(s2, na.id) };
  const xp = { noDocument: WP7.T1['submitWithoutProof.noDocument'].value, noActivity: WP7.T1['submitWithoutProof.noActivity'].value };
  rec('T1.T7.submitWithoutProof', sameJson(op, xp), { expected: xp, observed: op, detail: 'assertSubmissionProof counts the links and the attachment refs and refuses before any write (eot.service.js:214-257, reached from submitEotClaim through updateEotClaim :925-935)' });
  // patchStatusSubmitted: PATCH {status: submitted} on a draft
  const ps = await send('planner', 'PATCH', `${t.P}/eot/${nd.id}`, { status: FIXTURE.probeStatus.patchSubmitted });
  const psAfter = await statusOf(nd.id);
  rec('T1.T7.patchStatusSubmitted', h.is(ps, saidOf(WP7.T1.patchStatusSubmitted)) && fieldsOf(ps).includes('status') && psAfter === 'draft', { expected: { said: saidOf(WP7.T1.patchStatusSubmitted), field: 'status', claimStatus: 'draft' }, observed: { said: h.said(ps), fields: fieldsOf(ps), claimStatus: psAfter }, detail: 'the route allows status draft only (routes/eot.js:261-263)' });
  // a submitted claim T1-B (its activity and its own document): PATCH to draft, reject without and with a reason, resubmit
  const tb = await draftWithProof(t, 'T1-*', 'T1-B');
  const sb = await send('planner', 'POST', `${t.P}/eot/${tb.id}/submit`, {});
  need(sb.status === 200, `E5: T1-B could not be submitted (${h.said(sb)})`);
  const pdr = await send('planner', 'PATCH', `${t.P}/eot/${tb.id}`, { status: FIXTURE.probeStatus.patchDraft });
  const pdrAfter = await statusOf(tb.id);
  const pdrDetails = { fromStatus: pdr.body?.error?.details?.fromStatus ?? null, toStatus: pdr.body?.error?.details?.toStatus ?? null };
  rec('T1.T7.patchStatusDraftOnSubmitted', h.is(pdr, saidOf(WP7.T1.patchStatusDraftOnSubmitted)) && sameJson(pdrDetails, { fromStatus: 'submitted', toStatus: FIXTURE.probeStatus.patchDraft }) && pdrAfter === 'submitted', { expected: { said: saidOf(WP7.T1.patchStatusDraftOnSubmitted), details: { fromStatus: 'submitted', toStatus: FIXTURE.probeStatus.patchDraft }, claimStatus: 'submitted' }, observed: { said: h.said(pdr), details: pdrDetails, claimStatus: pdrAfter }, detail: 'submitted -> draft has no workflow action (eot.service.js:259-286)' });
  const rn = await send('pm', 'POST', `${t.P}/eot/${tb.id}/reject`, {});
  const rnAfter = await statusOf(tb.id);
  rec('T1.T7.rejectWithoutReason', h.is(rn, saidOf(WP7.T1.rejectWithoutReason)) && fieldsOf(rn).includes('reason') && rnAfter === 'submitted', { expected: { said: saidOf(WP7.T1.rejectWithoutReason), field: 'reason', claimStatus: 'submitted' }, observed: { said: h.said(rn), fields: fieldsOf(rn), claimStatus: rnAfter }, detail: 'the route\'s reason notEmpty (routes/eot.js:235) answers before the service\'s APPROVAL_WORKFLOW_REASON_REQUIRED' });
  const reason = label('the rejection reason');
  const rw = await send('pm', 'POST', `${t.P}/eot/${tb.id}/reject`, { reason });
  const rwRow = await claimOf(t.P, tb.id);
  const orw = { status: rw.status, claimStatus: rwRow?.status ?? null, rejectionReason: rwRow?.rejectionReason === reason ? 'the reason sent' : rwRow?.rejectionReason ?? null, rejectedBy: rwRow?.rejectedBy === ctx.people.pm ? 'pm' : rwRow?.rejectedBy ?? null };
  rec('T1.T7.rejectWithReason', sameJson(orw, WP7.T1.rejectWithReason.value), { expected: WP7.T1.rejectWithReason.value, observed: orw, detail: 'rejectEotClaim stores the reason (eot.service.js:1094-1126)' });
  const rs = await send('planner', 'POST', `${t.P}/eot/${tb.id}/submit`, {});
  const rsAfter = await statusOf(tb.id);
  rec('T1.T7.resubmitRejected', h.said(rs) === '200' && rsAfter === WP7.T1.resubmitRejected.value, { expected: { said: '200', claimStatus: WP7.T1.resubmitRejected.value }, observed: { said: h.said(rs), claimStatus: rsAfter }, detail: 'rejected -> submitted is the submit action (eot.service.js:269)' });
  // approveDraft: a draft with its activity and document, approved by the PM
  const tc = await draftWithProof(t, 'T1-*', 'T1-C');
  const before = await claimOf(t.P, tc.id);
  const ad = await send('pm', 'POST', `${t.P}/eot/${tc.id}/approve`, {});
  const after = await claimOf(t.P, tc.id);
  const keep = (r) => ({ status: r?.status ?? null, cumulativeApprovedEotDays: r?.cumulativeApprovedEotDays ?? null });
  rec('T1.T7.approveDraft', h.is(ad, saidOf(WP7.T1.approveDraft)) && sameJson(keep(after), keep(before)) && before?.status === 'draft', { expected: { said: saidOf(WP7.T1.approveDraft), unchanged: keep(before) }, observed: { said: h.said(ad), after: keep(after) }, detail: 'draft -> approved has no workflow action (eot.service.js:267-285, :1048-1061)' });
  // refsNotFound: an unknown claim, an unknown activity, an unknown weather delay
  const m0 = await count();
  const uc = await send('planner', 'PATCH', `${t.P}/eot/${crypto.randomUUID()}`, { eventName: label('unknown claim') });
  const ua = await send('planner', 'POST', `${t.P}/eot`, { ...claimBody(t, 'T1-*', 'T1 unknown activity'), activityLinks: [{ activityId: crypto.randomUUID(), delayStart: runDay(T7B.claims.delayStart) }] });
  const uw = await send('planner', 'POST', `${t.P}/eot`, { ...claimBody(t, 'T1-*', 'T1 unknown weather delay'), weatherDelayIds: [crypto.randomUUID()] });
  const m1 = await count();
  const orf = { unknownClaim: saidParts(h.said(uc)), unknownActivity: saidParts(h.said(ua)), unknownWeatherDelay: saidParts(h.said(uw)), claimsWritten: m1 - m0 };
  rec('T1.T7.refsNotFound', sameJson(orf, WP7.T1.refsNotFound.value), { expected: WP7.T1.refsNotFound.value, observed: orf, detail: '404 EOT_CLAIM_NOT_FOUND (eot.service.js:801-803); 400 EOT_ACTIVITY_NOT_FOUND before the create (:356-362); 400 EOT_WEATHER_DELAY_NOT_FOUND inside the create transaction, rolled back (:585-591)' });
  // E-HALF: a draft with delayDays 1.5 read back (CF.HRC11's EOT evidence; EotClaim.delayDays is an Int)
  const eh = await createClaim(t, 'E-HALF', 'E-HALF');
  const ehRow = eh.id ? await claimOf(t.P, eh.id) : null;
  obs.eHalf = { said: h.said(eh.res), sent: eh.body.delayDays, readBack: ehRow ? Number(ehRow.delayDays) : null };
};

// -- T7: P0-P4, the daily-log promotions (S.T7.barrier, PROMO.T7.*, KA.PROMO.T7.*, KA.F4.T7.sitePromotion) ----------------
/** A delay entry of the book (8 h on its activity, its day) added by its author: { id, day, description }. */
const addEntry = async (t, key, tag = key) => {
  const b = entryBook(key);
  const day = runDay(b.day);
  const description = label(`delay ${tag}`);
  const res = await send(b.by, 'POST', `${t.P}/daily-logs/${day}/entries/delays`, { type: 'weather', description, hoursLost: b.hoursLost, activityId: t.acts[b.activity] });
  const id = res.status === 201 ? res.body?.data?.entryId || null : null;
  need(Boolean(id), `the delay entry ${tag} could not be added on ${day} (${h.said(res)} ${res.body?.error?.message || ''})`);
  t.entries[tag] = { id, day, description, by: b.by };
  return t.entries[tag];
};
const promoteRoute = (t, e) => `${t.P}/daily-logs/${e.day}/entries/delays/${e.id}/weather-delay`;
/** The register as one promotion probe reads it: contractualUsed, and the rows of an entry's description. */
const promoRead = async (t, e) => {
  const reg = await registerOf(t.P);
  return { used: reg?.summary?.contractualUsed ?? null, rows: rowsNamed(reg, e.description).map((r) => ({ id: r.id, delayDays: Number(r.delayDays), contractual: r.contractual, links: listOf(r.activityLinks).map((l) => t.actCode[l.activityId] || l.activityId) })) };
};
const t7Barrier = async () => {
  const t = ctx.t7;
  const bar = await addEntry(t, 'BAR');
  const notes = label('barrier self-test');
  let q = null;
  let failure = null;
  try {
    q = await queueBehindBlocker('S.T7.barrier', bar.id, [{ label: 'the planner\'s PATCH of BAR', start: () => send('planner', 'PATCH', `${t.P}/daily-logs/${bar.day}/entries/delays/${bar.id}`, { notes }) }]);
  } catch (error) {
    failure = error.message;
  }
  const stored = (await ctx.q('select notes from "DailyLogDelay" where id = $1', [bar.id]))[0]?.notes ?? null;
  const o = { formed: Boolean(q), waiters: q ? q.waiters.length : 0, heldMs: q ? q.heldMs : null, said: q ? h.said(q.results[0]) : null, notesStored: stored === notes, blockerOpen: ctx.blockerOpen, failure };
  const ok = Boolean(q) && o.waiters === 1 && o.heldMs <= PROMO.barrier.releaseWithinMs && o.said === '200' && o.notesStored && !ctx.blockerOpen;
  obs.barrier = { ...o, trace: q ? q.waiters : null };
  ctx.barrierOk = ok;
  rec('S.T7.barrier', ok, { expected: { formed: true, waiters: 1, heldMsAtMost: PROMO.barrier.releaseWithinMs, said: '200', notesStored: true, blockerOpen: false }, observed: o, detail: `the blocker read and locked BAR and rolled back (writes nothing); ${PROMO.barrier.selfTest}` });
};
const t7Promotion = async () => {
  const t = ctx.t7;
  // P1: FEED promoted, then promoted again
  const feed = await addEntry(t, 'FEED');
  const b0 = await promoRead(t, feed);
  const pr = await send('planner', 'POST', promoteRoute(t, feed), {});
  const b1 = await promoRead(t, feed);
  const wd = pr.body?.data?.weatherDelay || {};
  const named = await entryWeatherOf(feed.id);
  const row = b1.rows.length === 1 ? b1.rows[0] : null;
  const of = { status: pr.status, echoDays: wd.delayDays ?? null, storedDays: row ? row.delayDays : null, contractual: row ? row.contractual : null, rowsAdded: b1.rows.length - b0.rows.length, contractualUsedDelta: b1.used - b0.used, activityLinks: row ? row.links : null, entryNamesTheRow: Boolean(row) && named === row.id && wd.id === row.id };
  rec('PROMO.T7.feeds', sameJson(of, PROMO.feeds), { expected: PROMO.feeds, observed: { ...of, echoContractual: wd.contractual ?? null }, detail: 'logWeatherDelay: 8 h -> Math.round((8 / 8) x 2) / 2 = 1.0 day, contractual by default (daily-log.service.js:1200, 1209), the entry linked after the weather delay is created (:1213)' });
  const tw = await send('planner', 'POST', promoteRoute(t, feed), {});
  const b2 = await promoRead(t, feed);
  rec('PROMO.T7.twice', h.is(tw, WP8.dailyLog.promoteTwice.value) && b2.rows.length === b1.rows.length, { expected: { said: WP8.dailyLog.promoteTwice.value, rowsAdded: 0 }, observed: { said: h.said(tw), rowsAdded: b2.rows.length - b1.rows.length }, detail: 'the sequential guard (daily-log.service.js:1198): the entry already names a weather delay' });
  // P2: N=3 race rounds, each on its own entry behind the blocker
  await probe('KA.PROMO.T7.race (P2: two promotions behind the blocker, N=3)', async () => {
    if (!ctx.barrierOk) throw probeSetup('KA.PROMO.T7.race', 'the barrier self-test S.T7.barrier did not pass');
    const rounds = [];
    for (let n = 1; n <= PROMO.barrier.rounds; n += 1) {
      const e = await addEntry(t, `RACE-${n}`);
      const before = await promoRead(t, e);
      const q = await queueBehindBlocker('KA.PROMO.T7.race', e.id, [
        { label: `race ${n} promotion 1`, start: () => send('planner', 'POST', promoteRoute(t, e), {}) },
        { label: `race ${n} promotion 2`, start: () => send('planner', 'POST', promoteRoute(t, e), {}) },
      ]);
      const after = await promoRead(t, e);
      const named2 = await entryWeatherOf(e.id);
      const saids = q.results.map((r) => h.said(r));
      const added = after.rows.filter((r) => !before.rows.some((x) => x.id === r.id));
      const second = q.results[1]?.body?.data?.weatherDelay?.id ?? null;
      const conflict = saids.find((s) => s.startsWith('409')) || null;
      const o = {
        promotions: q.results.length,
        ok: saids.filter((s) => s === '200').length,
        conflict409: saids.filter((s) => s.startsWith('409')).length,
        conflictCode: conflict ? saidParts(conflict).code : null,
        rowsAdded: added.length,
        contractualUsedDelta: after.used - before.used,
        activityLinksAdded: added.reduce((s, r) => s + r.links.length, 0),
        orphanRows: added.filter((r) => r.id !== named2).length,
        entryNamesTheRow: added.length === 1 && named2 === added[0].id,
        entryNamesTheRowWhoseUpdateRanLast: Boolean(second) && named2 === second,
      };
      rounds.push({ round: n, entry: e.id, saids, ...o, verdict: raceRoundVerdict(o), waiters: q.waiters, heldMs: q.heldMs });
    }
    obs.race = rounds;
    const L = WP7.promotion.race;
    const verdict = roundsVerdict(rounds.map((r) => r.verdict));
    ka('KA.PROMO.T7.race', { ref: L.ref, value: L.value, today: L.today, observed: { rounds: rounds.length, perRound: rounds.map(({ waiters, ...r }) => r) }, verdict: rounds.length === L.value.rounds ? verdict : 'wrong', detail: `each request seen waiting behind the blocker (pg_blocking_pids) before the next; held ${rounds.map((r) => r.heldMs).join(' / ')} ms; the second promotion queued is the one whose entry update runs last (the tuple lock is granted in queue order)` });
  });
  // P3: N=3 failure rounds on the open day: the DELETE, then the promotion, behind the blocker
  await probe('KA.PROMO.T7.failure (P3: a promotion racing the entry\'s DELETE, N=3)', async () => {
    if (!ctx.barrierOk) throw probeSetup('KA.PROMO.T7.failure', 'the barrier self-test S.T7.barrier did not pass');
    const rounds = [];
    for (let n = 1; n <= PROMO.barrier.rounds; n += 1) {
      const e = await addEntry(t, `FAIL-${n}`);
      const before = await promoRead(t, e);
      const q = await queueBehindBlocker('KA.PROMO.T7.failure', e.id, [
        { label: `failure ${n} DELETE`, start: () => send('planner', 'DELETE', `${t.P}/daily-logs/${e.day}/entries/delays/${e.id}`) },
        { label: `failure ${n} promotion`, start: () => send('planner', 'POST', promoteRoute(t, e), {}) },
      ]);
      const after = await promoRead(t, e);
      const named2 = await entryWeatherOf(e.id);
      const [del, prom] = q.results;
      const added = after.rows.filter((r) => !before.rows.some((x) => x.id === r.id));
      const ps = saidParts(h.said(prom));
      const o = {
        deleteStatus: del.status,
        promotionIs2xx: prom.status >= 200 && prom.status < 300,
        promotionSaid: h.said(prom),
        promotion: { status: ps.status, code: ps.code },
        rowsAdded: added.length,
        contractualUsedDelta: after.used - before.used,
        orphanRows: added.filter((r) => r.id !== named2).length,
        entry: named2 === 'gone' ? 'gone' : 'present',
      };
      rounds.push({ round: n, entry: e.id, ...o, verdict: failureRoundVerdict(o), waiters: q.waiters, heldMs: q.heldMs });
    }
    obs.failure = rounds;
    const L = WP7.promotion.failure;
    const verdict = roundsVerdict(rounds.map((r) => r.verdict));
    ka('KA.PROMO.T7.failure', { ref: L.ref, value: L.value, today: L.today, observed: { rounds: rounds.length, perRound: rounds.map(({ waiters, ...r }) => r) }, verdict: rounds.length === L.value.rounds ? verdict : 'wrong', detail: `the DELETE queued first commits first; the promotion's weather delay was committed before it waited at the entry update (P2025 -> 404 NOT_FOUND, error-handler.js:246); the fix's code is CONTRACT ${CONTRACT['PROMO-TX'].failureCode || 'pending'}; held ${rounds.map((r) => r.heldMs).join(' / ')} ms` });
  });
  // P4: the site engineer's promotion (HR-F4), read by the planner
  await probe('KA.F4.T7.sitePromotion (P4: the site engineer promotes a delay)', async () => {
    const e = await addEntry(t, 'SITE');
    const before = await promoRead(t, e);
    const sp = await send('site', 'POST', promoteRoute(t, e), {});
    const after = await promoRead(t, e);
    const added = after.rows.filter((r) => !before.rows.some((x) => x.id === r.id));
    const contractual = added.length === 1 ? added[0].contractual : sp.body?.data?.weatherDelay?.contractual ?? null;
    const o = { status: sp.status, contractual, contractualUsedDelta: after.used - before.used };
    obs.sitePromotion = { said: h.said(sp), ...o, rowsAdded: added.length, echo: sp.body?.data?.weatherDelay ?? null };
    const L = WP7.promotion.sitePromotion;
    const answer = CONTRACT['HR-F4'].siteAnswer;
    const isValue = (x) => (answer && answer !== 'non-contractual'
      ? h.said(sp) === answer && x.contractualUsedDelta === 0
      : x.status >= 200 && x.status < 300 && x.contractual === L.value.contractual && x.contractualUsedDelta === L.value.contractualUsedDelta);
    ka('KA.F4.T7.sitePromotion', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, isValue, (x) => sameJson(x, L.today)), detail: `the route lets daily_log.update in (routes/daily-logs.js:238-245) and the promotion is contractual by default (daily-log.service.js:1209); the site engineer holds no eot:read, so the planner reads the register; WP-8 classifies (WP7ADJ Q8); CONTRACT ${answer || 'pending'}` });
  });
};
/** CF: the project date after the approvals (CF.HRC10's observation; HEAD keeps it manual, HR-C10's recommendation). */
const t7Cf = async () => {
  const t = ctx.t7;
  const shown = await dataOf('pm', t.P);
  obs.projectDate = { ...(obs.projectDate || {}), T7: shown?.revisedCompletionDate ?? null };
};
const t7End = async () => {
  const t = ctx.t7;
  await releaseBlocker();
  t.cancel = await cancelQueued(t);
  const a = await archive(t);
  const R0 = T7B.residue;
  rec('S.T7.archived', a?.status === 200 && Boolean(a?.archivedAt) && t.cancel.left === R0.queuedJobsLeft.T7 && !ctx.blockerOpen, { expected: { archive: 200, archivedAt: true, queuedJobsLeft: R0.queuedJobsLeft.T7, blockerOpen: false }, observed: { archive: a, queuedLeft: t.cancel.left, cancelled: t.cancel.cancelled.length, refused: t.cancel.refused, blockerOpen: ctx.blockerOpen }, detail: `T7 ${t.id}: archived with its claims, weather rows, daily logs and notifications (WP7ADJ Q11)` });
};

// -- T7H: H0-H2 and the end (S.T7H.create, KA.W.T7H.half28, KA.W.T7H.storedOneAndHalf, S.T7H.archived) -------------------
const t7hCreate = async () => {
  const t = await makeThrowaway({ pm: 'pm', label: 'T7H', project: T7HB.project, team: T7HB.team });
  ctx.t7h = t;
  const s = t.shown || {};
  const o = { said: h.said(t.created), weatherAllowanceDays: nullableNumber(s.weatherAllowanceDays), currency: s.currency ?? null };
  const e = { said: '201', weatherAllowanceDays: T7HB.project.weatherAllowanceDays, currency: T7HB.project.currency };
  const ok = sameJson(o, e) && teamOk(t, T7HB.team);
  rec('S.T7H.create', ok, { expected: { project: e, team: T7HB.team }, observed: { id: t.id, ...o, team: t.members }, detail: 'T7\'s settings without its LD rate; the planner posts the rows and reads the register' });
  need(ok, 'H0: T7H or its team could not be made');
};
const t7hHalf = async () => {
  const t = ctx.t7h;
  await probe('KA.W.T7H.half28 (H1: 28 delays of 0.5 day)', async () => {
    const H = FIXTURE.half;
    const made = [];
    for (let d = H.from; d >= H.to; d -= 1) {
      for (let k = 1; k <= H.perDay; k += 1) {
        const res = await send('planner', 'POST', `${t.P}/weather-delays`, { description: label(`half day R-${d} ${k}`), date: runDay(`R-${d}`), delayDays: H.delayDays, contractual: true });
        made.push(h.said(res));
      }
    }
    if (made.length !== H.rows || made.some((s) => s !== '201')) throw probeSetup('KA.W.T7H.half28', `the ${H.rows} half-day rows answered ${json(made)}`);
    const reg = await registerOf(t.P);
    const o = summaryRead(reg);
    obs.half28 = { read: o, raw: reg?.summary ?? null, stored: [...new Set(listOf(reg?.rows).map((r) => Number(r.delayDays)))] };
    kaLeaf('KA.W.T7H.half28', WP7.T7H.half28, o, { detail: 'Number(0.5) into the Int column WeatherDelay.delayDays (weather.service.js:217, schema.prisma:2958): each row stored 0' });
  });
  await probe('KA.W.T7H.storedOneAndHalf (H2: one delay of 1.5 days)', async () => {
    const res = await send('planner', 'POST', `${t.P}/weather-delays`, { description: label('one and a half days'), date: runDay(FIXTURE.oneAndHalf.day), delayDays: FIXTURE.oneAndHalf.delayDays, contractual: true });
    const L = WP7.weather['fractional.storedOneAndHalf'];
    const mode = CONTRACT['HR-C11'].fractionalMode;
    let o;
    if (res.status === 201) {
      const id = res.body?.data?.id;
      const row = listOf((await registerOf(t.P))?.rows).find((r) => r.id === id) || null;
      if (!row) throw probeSetup('KA.W.T7H.storedOneAndHalf', 'the 1.5-day row is not on the register');
      o = Number(row.delayDays);
    } else if (res.status >= 500 || mode !== 'refuse') {
      throw probeSetup('KA.W.T7H.storedOneAndHalf', `the 1.5-day row answered ${h.said(res)}`);
    } else {
      o = h.said(res);
    }
    obs.oneAndHalf = { said: h.said(res), readBack: o };
    const refusal = CONTRACT['HR-C11'].refusalAnswer;
    ka('KA.W.T7H.storedOneAndHalf', { ref: L.ref, value: L.value, today: L.today, observed: o, verdict: judge(o, (x) => (mode === 'refuse' ? x === refusal : x === L.value), (x) => x === L.today), detail: `the Int column stores 1 (weather.service.js:217); CONTRACT fractionalMode ${mode || 'pending'} (decimal: 1.5; refuse: ${refusal || 'the fix\'s refusal'})` });
  });
};
const t7hEnd = async () => {
  const t = ctx.t7h;
  t.cancel = await cancelQueued(t);
  const a = await archive(t);
  rec('S.T7H.archived', a?.status === 200 && Boolean(a?.archivedAt) && t.cancel.left === T7B.residue.queuedJobsLeft.T7H, { expected: { archive: 200, archivedAt: true, queuedJobsLeft: T7B.residue.queuedJobsLeft.T7H }, observed: { archive: a, queuedLeft: t.cancel.left, cancelled: t.cancel.cancelled.length, refused: t.cancel.refused }, detail: `T7H ${t.id}: archived with its weather rows (WP7ADJ Q11)` });
};

// -- 087-COM: the stored moment, live reads and POST /eot/calculate (COM.*, S.087COM.chain, KA.T4.087COM.calculate) --------
let scheduleTfMemo = null;
/** schedule.js's WP1.T1.<code>.TF (the F1 network's floats; read once). */
const scheduleTf = (code) => {
  if (!scheduleTfMemo) scheduleTfMemo = new Map(SCHEDULE.figures().filter((r) => /^WP1\.T1\.[A-Z0-9]+\.TF$/.test(r.key)).map((r) => [r.key, r.value]));
  return scheduleTfMemo.get(`WP1.T1.${code}.TF`);
};
const comFlow = async () => {
  const st = ctx.state['087-COM'];
  const s = storedCom087(st);
  const { P, id: projectId } = ctx.deep['087-COM'];
  const sc = s['COM.stored.eotFigures'];
  rec('COM.stored.eotFigures', sc.ok === true, { expected: sc.expected, observed: { ...sc.observed, storedAt: s.storedAt }, detail: sc.detail });
  // the build's five claims, live
  const rows = await claimsOf(P);
  const byKey = Object.fromEntries(Object.entries(s.claims).map(([k, c]) => [k, rows.find((r) => r.id === c.id) || null]));
  const statuses = Object.values(byKey).map((r) => r?.status ?? null);
  const t2 = byKey.T2;
  const t3 = byKey.T3;
  const t2Links = listOf(t2?.weatherDelayLinks);
  const link = D087.eotWeatherLink.value;
  const oc = {
    found: Object.values(byKey).every(Boolean),
    unchangedSinceBuild: Object.entries(s.claims).every(([k, c]) => byKey[k]?.status === c.status),
    states: [...new Set(statuses)].sort(),
    approved: statuses.filter((x) => x === 'approved').length,
    t2: { cumulativeApprovedEotDays: t2?.cumulativeApprovedEotDays ?? null, revisedCompletionRecommendation: dayOf(t2?.revisedCompletionRecommendation) },
    t3: { cumulativeApprovedEotDays: t3?.cumulativeApprovedEotDays ?? null, revisedCompletionRecommendation: dayOf(t3?.revisedCompletionRecommendation) },
    ldRatePerDay: [...new Set(Object.values(byKey).map((r) => cents(r?.ldRatePerDay)))],
    t2WeatherLink: { claim: 'T2', eventType: t2?.eventType ?? null, weatherDelayLinks: t2Links.length, weatherDelay: t2Links[0]?.weatherDelayId === s.weatherDelayId ? 'WD-1' : t2Links[0]?.weatherDelayId ?? null, weatherDelayDays: t2Links[0]?.weatherDelay ? Number(t2Links[0].weatherDelay.delayDays) : null },
  };
  const xc = {
    found: true, unchangedSinceBuild: true, states: [...D087.stateCoverage.eotClaims.value].sort(), approved: D087.eotApprovedClaims.value,
    t2: { cumulativeApprovedEotDays: WP7.T2.cumulativeApprovedEotDays.value, revisedCompletionRecommendation: WP7.T2.revisedCompletionRecommendation.value },
    t3: { cumulativeApprovedEotDays: WP7.T3.cumulativeApprovedEotDays.value, revisedCompletionRecommendation: WP7.T3.revisedCompletionRecommendation.value },
    ldRatePerDay: [D087.ldRatePerDay.value],
    t2WeatherLink: link,
  };
  rec('COM.live.claims', sameJson(oc, xc), { expected: xc, observed: oc, detail: 'the claims the build recorded (steps eot.T2 .. eot.DRAFT), read by id; WD-1 is the build\'s step weather-delay' });
  // the project and the default allowance
  const shown = await dataOf('pm', P);
  obs.projectDate = { ...(obs.projectDate || {}), '087-COM': shown?.revisedCompletionDate ?? null };
  const op = { completionDate: dayOf(shown?.completionDate), ldRatePerDay: cents(shown?.ldRatePerDay) };
  const xp = { completionDate: D087.completion.value, ldRatePerDay: D087.ldRatePerDay.value };
  rec('COM.live.project', sameJson(op, xp), { expected: xp, observed: { ...op, revisedCompletionDate: shown?.revisedCompletionDate ?? null }, detail: 'the PM reads the LD rate (a commercial reader, project.service.js:283)' });
  const reg = await registerOf(P);
  const ow = summaryRead(reg);
  rec('COM.live.weatherDefault', sameJson(ow, D087.weatherDefault.value), { expected: D087.weatherDefault.value, observed: { ...ow, weatherAllowanceDays: shown?.weatherAllowanceDays ?? null }, detail: 'created without weatherAllowanceDays: the column default 20 (schema.prisma:496); WD-1\'s 2 days' });
  // S.087COM.chain: A110 -> A120, TF 0 each (the setup of the calculation)
  const acts = listOf(await dataOf('planner', `${P}/activities`));
  const [from, to] = FIXTURE.com087.activities;
  const rowOf = (code) => acts.find((a) => a.id === s.activities[code]) || null;
  const chain = {
    ids: FIXTURE.com087.activities.map((code) => Boolean(rowOf(code))),
    tf: FIXTURE.com087.activities.map((code) => nullableNumber(rowOf(code)?.totalFloat)),
    link: listOf(rowOf(to)?.dependencies).some((d) => d.predecessorId === s.activities[from] && d.relationshipType === FIXTURE.com087.relationshipType),
  };
  const xchain = { ids: [true, true], tf: FIXTURE.com087.activities.map(scheduleTf), link: true };
  ctx.chainOk = sameJson(chain, xchain);
  rec('S.087COM.chain', ctx.chainOk, { expected: xchain, observed: chain, detail: 'the build hand-built F1 (_commercial.js:211-247): A110 -> A120 FS, both on the critical path' });
  // KA: /eot/calculate on 087-COM, which writes nothing (its invariance asserted, WP7ADJ Q3)
  await probe('KA.T4.087COM.calculate (POST /eot/calculate on 087-COM)', async () => {
    if (!ctx.chainOk) throw probeSetup('KA.T4.087COM.calculate', 'S.087COM.chain did not hold');
    const cl = claimBook(FIXTURE.com087.claim);
    const before = await comFingerprint(projectId);
    const res = await send('planner', 'POST', `${P}/eot/calculate`, { eventName: label('calculation on 087-COM'), delayDays: cl.delayDays, eotDaysGranted: cl.eotDaysGranted, affectedActivityIds: FIXTURE.com087.activities.map((code) => s.activities[code]) });
    const after = await comFingerprint(projectId);
    if (res.status !== 200) throw probeSetup('KA.T4.087COM.calculate', `POST /eot/calculate answered ${h.said(res)}`);
    const unchanged = sameJson(before, after);
    if (!unchanged) ctx.deepWrites.push(`087-COM: POST /eot/calculate changed ${json({ before, after })}`);
    const cd = res.body?.data || {};
    const o = { criticalPathImpactDays: cd.criticalPathImpactDays ?? null, ldApplicableDays: cd.ldApplicableDays ?? null, ldLiability: cents(cd.ldLiability) };
    obs.calc087 = { ...o, ldRatePerDay: cents(cd.ldRatePerDay), unchanged, before, after };
    const L = WP7.T4.on087COM;
    ka('KA.T4.087COM.calculate', { ref: L.ref, value: L.value, today: L.today, observed: { ...o, unchanged }, verdict: unchanged ? judge(o, (x) => sameJson(x, L.value), (x) => sameJson(x, L.today)) : 'wrong', detail: `calculateEot sums the per-activity impact (eot.service.js:404-407) at 087-COM's rate ${obs.calc087.ldRatePerDay} cents; 087-COM's EOT claims, weather delays and audit events ${unchanged ? 'unchanged across the call' : 'CHANGED across the call (a deep write: wrong)'}` });
  });
};

// -- 087-FLD and 052-FLD: the stored weather moments and the live reads (F87, F52) -----------------------------------------
const fld087Flow = async () => {
  const st = ctx.state['087-FLD'];
  const s = storedFld(st, '087-FLD');
  const { P } = ctx.deep['087-FLD'];
  const rd = WP7.weather['087-FLD.read'];
  obs.fld087 = { steps: s.steps, storedRows: s.storedRows, storedAt: s.storedAt };
  ka('KA.FLD.087.stored', { ref: rd.ref, value: { at13: rd.value.at13, at14: rd.value.at14 }, today: { at13: rd.today.at13, at14: rd.today.at14 }, observed: { at13: s.at13, at14: s.at14 }, verdict: fld087Verdict(s), storedAt: s.storedAt, detail: `the build's readings before the 1.0-day row and after it (steps weather.at13.read / weather.at14.read, ${s.storedAt}); stored rows ${json(s.storedRows)}; STORED-PRE-FIX after the HR-C11 fix, strictly at the exit rebuild (WP7ADJ Q9)` });
  const reg = await registerOf(P);
  const month = listOf(reg?.monthly).find((m) => m.month === s.nonContractualMonth);
  const shown = await dataOf('pm', P);
  await probe('KA.FLD.087.live (087-FLD\'s register now)', async () => {
    if (!s.nonContractualMonth || !month) throw probeSetup('KA.FLD.087.live', `no month ${s.nonContractualMonth} on 087-FLD's register (the build's non-contractual row)`);
    const o = { ...four(reg.summary), monthlyNonContractual: month.nonContractual };
    ka('KA.FLD.087.live', { ref: rd.ref, value: rd.value.live, today: rd.today.live, observed: o, verdict: judge(o, (x) => sameJson(x, rd.value.live), (x) => sameJson(x, rd.today.live)), storedAt: s.storedAt, detail: `the rows the build wrote (${s.storedAt}); rows written before the fix keep their truncated values (MOMENT-MAP row 180)` });
  });
  const oa = { weatherAllowanceDays: nullableNumber(shown?.weatherAllowanceDays), registerAllowance: reg?.summary?.allowance ?? null };
  const xa = { weatherAllowanceDays: WP7.weather['087-FLD.allowance'].value, registerAllowance: WP8.weather.allowance.value };
  rec('FLD.087.allowance', sameJson(oa, xa), { expected: xa, observed: oa, detail: 'set explicitly (not the || 20 default)' });
};
const fld052Flow = async () => {
  const st = ctx.state['052-FLD'];
  const s = storedFld(st, '052-FLD');
  const { P } = ctx.deep['052-FLD'];
  const L52 = WP7.weather['052-FLD'];
  obs.fld052 = { steps: s.steps, storedRows: s.storedRows, storedAt: s.storedAt };
  ka('KA.FLD.052.stored', { ref: L52.ref, value: L52.value, today: L52.today, observed: fld052Observed(s), verdict: fld052Verdict(s), storedAt: s.storedAt, detail: `052-FLD's readings at 13 and 14 (${s.storedAt}); stored rows ${json(s.storedRows)}; STORED-PRE-FIX after the HR-C11 fix, strictly at the exit rebuild` });
  const reg = await registerOf(P, 'planner052');
  const nc = WP8.weather.nonContractualAddsNothing;
  const o = { contractualUsed: reg?.summary?.contractualUsed ?? null, consumedPct: pct2(reg?.summary?.consumedPct), warning: reg?.summary?.warning ?? null };
  const value = { contractualUsed: nc.value, consumedPct: L52.value.then[0], warning: L52.value.then[1] };
  const today = { contractualUsed: nc.today, consumedPct: L52.today.then[0], warning: L52.today.then[1] };
  ka('KA.FLD.052.live', { ref: L52.ref, value, today, observed: o, verdict: judge(o, (x) => sameJson(x, value), (x) => sameJson(x, today)), storedAt: s.storedAt, detail: `GET /weather-delays as 052's planner, read only (WP7ADJ Q7); remaining ${reg?.summary?.remaining ?? '?'}; the record set both builders judge (WP8.weather.nonContractualAddsNothing)` });
};

// -- confirm-first classification from this run's observations -----------------------------------------------------------------
/**
 * The confirm-first items (pure over the run's observations, the known answers' verdicts and the static scan; exported
 * for the registration check): each item 'present' (HEAD's behaviour, as the CF leaf's today states it), 'absent' (the
 * leaf's value) or 'gap' (not observed, or neither).
 */
const confirmFirstItems = ({ o, verdictOf, scan, fixes = FIXES }) => {
  // A build record stored before the HR-C11 fix commit keeps its truncated rows until the exit rebuild (WP7ADJ Q9):
  // after the fix it is a gap of this classification (STORED-PRE-FIX), never a sign the fix failed.
  const preFix = (storedAt) => Boolean(fixes['HR-C11']?.committedAt) && Boolean(storedAt) && Date.parse(storedAt) < Date.parse(fixes['HR-C11'].committedAt);
  const kaState = (id) => (verdictOf(id) === 'today' ? 'present' : verdictOf(id) === 'value' ? 'absent' : 'gap');
  const vs = (seen, today, value) => (seen === null || seen === undefined ? 'gap' : sameJson(seen, today) ? 'present' : sameJson(seen, value) ? 'absent' : 'gap');
  const C11 = WP7.CF.HRC11;
  const C10 = WP7.CF.HRC10;
  const PX = WP7.CF.PROMOTX;
  const f11t = C11.today.fractional;
  const f11v = C11.value.fractional;
  const impactOf = (x) => (x ? { criticalPathImpactDays: x.criticalPathImpactDays, ldApplicableDays: x.ldApplicableDays, ldLiability: x.ldLiability } : null);
  /** Every round on the leaf's today (present) or every round on its value (absent), each read at the fields that side states. */
  const everyRound = (rounds, today, value, map = (r) => r) => {
    if (!Array.isArray(rounds) || !rounds.length) return 'gap';
    const states = rounds.map((r0) => { const r = map(r0); return sameJson(pick(r, today), today) ? 'present' : sameJson(pick(r, value), value) ? 'absent' : 'gap'; });
    return states.every((x) => x === 'present') ? 'present' : states.every((x) => x === 'absent') ? 'absent' : 'gap';
  };
  return {
    'CF.HRC11': [
      ['28 delays of 0.5 day stored 0 on T7H (KA.W.T7H.half28)', vs(o.half28?.read?.contractualUsed, f11t.T7Hhalf28Used, f11v.T7Hhalf28Used)],
      ['a 1.5-day delay stored 1 on T7H (KA.W.T7H.storedOneAndHalf)', vs(o.oneAndHalf?.readBack, f11t.oneAndHalf, f11v.oneAndHalf)],
      ['an EOT draft of 1.5 days reads 1 on T7 (E-HALF; EotClaim.delayDays is an Int)', vs(o.eHalf?.readBack, f11t.eotDraftDelayDays, f11v.eotDraftDelayDays)],
      ['087-FLD\'s record set stored truncated (KA.FLD.087.stored; a gap when stored before the HR-C11 fix)', preFix(o.fld087?.storedAt) ? 'gap' : vs(o.fld087?.storedRows, f11t.fld087Stored, f11v.fld087Stored)],
      ['052-FLD\'s record set stored truncated (KA.FLD.052.stored; a gap when stored before the HR-C11 fix)', preFix(o.fld052?.storedAt) ? 'gap' : vs(o.fld052?.storedRows, f11t.fld052Stored, f11v.fld052Stored)],
      ['an allowance of 0 read as 20 on T7 (KA.W.T7.allowanceZero)', vs(o.allowanceZero?.summary ? { allowance: o.allowanceZero.summary.allowance } : null, C11.today.zeroAllowance, C11.value.zeroAllowance)],
    ],
    'CF.HRC10': [
      ['an approved claim stays editable (KA.T2.plannerPatchApproved)', o.plannerPatch ? vs({ status: o.plannerPatch.status, eotDaysGranted: o.plannerPatch.eotDaysGranted }, C10.today.approvedClaimPatch, C10.value.approvedClaimPatch) : 'gap'],
      ['LD summed over the activities on T7 (KA.T4.T7)', vs(impactOf(o.t4?.stored), C10.today.impact, C10.value.impact)],
      ['LD summed over the activities on 087-COM (KA.T4.087COM.calculate)', o.calc087?.unchanged === true ? vs(impactOf(o.calc087), C10.today.impact, C10.value.impact) : 'gap'],
    ],
    'CF.PROMOTX': [
      ['two promotions at once both create a weather row, one orphaned (KA.PROMO.T7.race)', kaState('KA.PROMO.T7.race') === 'gap' ? 'gap' : everyRound(o.race, PX.today.race, PX.value.race)],
      ['a promotion racing the entry\'s DELETE leaves a contractual row with no entry (KA.PROMO.T7.failure)', kaState('KA.PROMO.T7.failure') === 'gap' ? 'gap' : everyRound(o.failure, PX.today.failure, PX.value.failure, (r) => ({ ...r, promotion: r.promotion?.status ?? null }))],
    ],
  };
};
/**
 * The confirm-first observations (pure; exported): what the plan asks to be confirmed where the rule's recommendation
 * equals HEAD, so it is reported, never classified (cf()'s observations): HR-C11 keeps the warning a flag (a notice is
 * the owner's call, O2); HR-C10 keeps the project date manual (WP7-PREP fact 7). Each 'seen' (as HEAD does it),
 * 'not seen' or 'not observed'.
 */
const confirmFirstObservations = ({ o, scan }) => {
  const C11 = WP7.CF.HRC11;
  const C10 = WP7.CF.HRC10;
  const seen = (x, expected) => (x === null || x === undefined ? 'not observed' : x === expected ? 'seen' : 'not seen');
  return {
    'CF.HRC11': [
      ['the warning only a flag: no notification names weather on T7 after it crossed 70%', seen(o.notificationsNamingWeather, C11.today.warning.notificationsNamingWeather), o.notificationsNamingWeather ?? null],
      ['the warning only a flag: no server code reads the register summary (static: listWeatherDelays answered by its route only, weather.service.js:200 its one writer)', seen(scan?.serverReadersOfSummaryWarning === null || scan?.serverReadersOfSummaryWarning === undefined ? null : scan.serverReadersOfSummaryWarning + Math.abs((scan.warningWriters || []).length - 1), C11.today.warning.serverReadersOfSummaryWarning), { readers: scan?.serverReadersOfSummaryWarning ?? null, writers: scan?.warningWriters ?? null }],
      ['the zero-allowance warning (no expected value: adjudication C6, O2)', o.allowanceZero ? 'recorded' : 'not observed', o.allowanceZero?.warning ?? null],
    ],
    'CF.HRC10': [
      ['T7\'s project date not moved by the approvals (HR-C10 keeps it manual)', o.projectDate && 'T7' in o.projectDate ? (o.projectDate.T7 === C10.today.projectDate.T7 ? 'seen' : 'not seen') : 'not observed', o.projectDate?.T7 ?? null],
      ['087-COM\'s project date not moved by its approvals', o.projectDate && '087-COM' in o.projectDate ? (o.projectDate['087-COM'] === C10.today.projectDate['087-COM'] ? 'seen' : 'not seen') : 'not observed', o.projectDate?.['087-COM'] ?? null],
      ['two recommended completion dates (lead EOT-REC-2): the calculation\'s for E-T3 at create against the approval\'s', o.eotRec2 ? 'recorded' : 'not observed', o.eotRec2 ?? null],
    ],
    'CF.PROMOTX': [],
  };
};
const confirmFirstFlow = () => {
  const scan = obs.static || staticScan();
  obs.static = scan;
  const items = confirmFirstItems({ o: obs, verdictOf: (id) => knownAnswers[id]?.verdict ?? null, scan });
  const seenOf = confirmFirstObservations({ o: obs, scan });
  const observationsOf = (id) => seenOf[id].map(([name, state, value]) => ({ name, state, value }));
  const split = (pairs) => {
    const present = []; const absent = []; const gap = [];
    for (const [name, state] of pairs) (state === 'present' ? present : state === 'absent' ? absent : gap).push(name);
    return { present, absent, gap };
  };
  cf('CF.HRC11', { ...split(items['CF.HRC11']), observations: observationsOf('CF.HRC11'), detail: `${json({ half28: obs.half28?.read, oneAndHalf: obs.oneAndHalf, eHalf: obs.eHalf, fld087: obs.fld087?.storedRows, fld052: obs.fld052?.storedRows, allowanceZero: obs.allowanceZero, notifications: obs.notificationsNamingWeather, warningWriters: scan.warningWriters }, 1500)}; the zero-allowance warning recorded, no expected value (adjudication C6); truncation P1 proposed; HR-C11 undecided (O2)` });
  cf('CF.HRC10', { ...split(items['CF.HRC10']), observations: observationsOf('CF.HRC10'), detail: `${json({ plannerPatch: obs.plannerPatch, t4: obs.t4?.stored, calc087: obs.calc087, projectDate: obs.projectDate, eotRec2: obs.eotRec2 }, 1500)}; two recommended completion dates (lead EOT-REC-2, P3, recorded only): the calculation's ${obs.eotRec2?.eT3CalcAtCreate || '?'} for E-T3 at create against the approval's ${obs.eotRec2?.approvalColumn || '?'}; HR-C10 undecided (O1)` });
  // The severity evidence of PROMO-TX (WP7ADJ Q6): what the duplicates and orphans reach.
  const extraRace = (obs.race || []).reduce((s, r) => s + Math.max(0, r.contractualUsedDelta - PROMO.feeds.contractualUsedDelta), 0);
  const extraFailure = (obs.failure || []).reduce((s, r) => s + Math.max(0, r.contractualUsedDelta), 0);
  obs.promoSeverityEvidence = {
    extraContractualDaysFromDuplicates: extraRace,
    extraContractualDaysFromOrphans: extraFailure,
    seventyFlagReadsThem: scan.warningWriters ? scan.warningWriters.includes('services/weather.service.js') : null,
    noticeMonitorReadsWeatherRows: scan.noticeMonitorReadsWeather,
    forecastReadsWeatherActivityLinks: scan.forecastReadsWeatherLinks,
    twoWritesUnlockedCheck: scan.promotionUnlockedCheck === true && scan.promotionTwoWrites === true,
    heals: 'nothing recomputes or removes the extra rows (no later write was observed to heal them; they stay on archived T7 as residue, WP7ADJ Q11)',
    rule: 'P1 if duplicates or orphans reproduce and reach contractual days, the 70% flag, notices or the forecast (WP7ADJ Q6); decided by the integration owner from this evidence',
  };
  cf('CF.PROMOTX', { ...split(items['CF.PROMOTX']), observations: observationsOf('CF.PROMOTX'), detail: `${json({ race: (obs.race || []).map((r) => ({ round: r.round, saids: r.saids, rowsAdded: r.rowsAdded, orphanRows: r.orphanRows })), failure: (obs.failure || []).map((r) => ({ round: r.round, deleteStatus: r.deleteStatus, promotion: r.promotionSaid, rowsAdded: r.rowsAdded })), severity: obs.promoSeverityEvidence }, 1500)}; severity decided at this run from the reproduction (WP7ADJ Q6)` });
};

// -- the run ------------------------------------------------------------------------------------------------------------------
const main = async () => {
  console.log(`wp7-eot-proof: ${ACTIVE.length} of ${EXPECTED_CHECKS} checks active${ONLY ? ` (--only=${[...ONLY].join(',')})` : ''}${SKIP ? ` (--skip=${[...SKIP].join(',')})` : ''}${PROJECT_FILTER ? ` (--project=${PROJECT_FILTER})` : ''}; sections ${[...selectedSections].join(' ')}; deep projects ${NEED_DEEP.join(', ') || 'none'}; throwaways T7 ${NEED_T7 ? 'yes' : 'no'}, T7H ${NEED_T7H ? 'yes' : 'no'}; companies ${NEED_COMPANIES.join(', ')} only; fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}; in process\n`);
  if (ACTIVE.length !== CHECKS.length) console.log(`not exercised in this run (filtered out): ${CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id).join(', ')}\n`);
  await setup();
  // The deep projects first: reads and the calculation, before any throwaway exists.
  if (on('COM')) await h.section('087-COM: the stored moment, reads and /eot/calculate', comFlow);
  else rec('S.087COM.chain', true, { detail: 'not needed (no selected check runs on 087-COM)' });
  if (on('F87')) await h.section('087-FLD: the stored weather moments and reads', fld087Flow);
  if (on('F52')) await h.section('052-FLD: the stored weather moments and the 052 planner\'s read', fld052Flow);
  // T7: each step in its own section, so a failed one is a setup error; the order is the book's (WP7.T7.choreography).
  if (NEED_T7) {
    await h.section('T7: T7-0 the project and its team', async () => { await t7Create(); ctx.t7Ready = true; });
    if (ctx.t7Ready) await h.section('T7: T7-1 the network', async () => { await t7Network(); ctx.t7Net = true; });
    if (ctx.t7Net) await h.section('T7: W1-W7 the weather boundaries and allowance 0', async () => { await t7Weather(); ctx.t7Weathered = true; });
    if (ctx.t7Weathered) await h.section('T7: E1-E3 the approvals, the PATCH probe and the approved-state probes', t7Approvals);
    if (ctx.t7Net) await h.section('T7: E4 impact and LD', t7Impact);
    if (ctx.t7Net) await h.section('T7: E5 the T1 claims and E-HALF', t7States);
    if (ctx.t7Weathered) await h.section('T7: P0 the blocker-queue self-test', t7Barrier);
    if (ctx.t7Weathered) await h.section('T7: P1-P4 the promotions', t7Promotion);
    if (ctx.t7Ready) await h.section('T7: CF the project date after the approvals', t7Cf);
  } else {
    for (const id of ['S.T7.create', 'S.T7.network', 'S.T7.evidence', 'S.T7.barrier', 'S.T7.archived']) rec(id, true, { detail: 'not needed (no selected check runs on T7)' });
  }
  if (ctx.t7) await h.section('T7: the end (jobs, archive)', t7End);
  if (NEED_T7H) {
    await h.section('T7H: H0 the project and its team', async () => { await t7hCreate(); ctx.t7hReady = true; });
    if (ctx.t7hReady) await h.section('T7H: H1-H2 the half days', t7hHalf);
  } else {
    for (const id of ['S.T7H.create', 'S.T7H.archived']) rec(id, true, { detail: 'not needed (no selected check runs on T7H)' });
  }
  if (ctx.t7h) await h.section('T7H: the end (jobs, archive)', t7hEnd);
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
  h.observe('runObservations', obs);
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
const THROWAWAY_NAMES = [[T7B.project.name, 'pm'], [T7HB.project.name, 'pm']];
const cleanup = async () => {
  const notes = [];
  try { if (ctx.blockerOpen) { await releaseBlocker(); notes.push('the blocker was open at cleanup and was rolled back (it wrote nothing)'); } } catch (error) { notes.push(`blocker rollback: ${error.message}`); }
  for (const step of ctx.cleanup.reverse()) {
    try { notes.push(String(await step())); } catch (error) { notes.push(`cleanup failed: ${error.message}`); }
  }
  if (!ctx.cleanup.length) notes.push('nothing to remove');
  // WP7ADJ Q11: the weather rows on T7 that no delay entry names (the race duplicates and the failure orphans at HEAD).
  try {
    if (ctx.q && ctx.t7) {
      const descriptions = Object.values(ctx.t7.entries).map((e) => e.description);
      const rows = await ctx.q(`select w.id, w.description, w."delayDays" as days, w.contractual from "WeatherDelay" w
          where w."projectId" = $1 and w.description = any($2::text[]) and not exists (select 1 from "DailyLogDelay" d where d."weatherDelayId" = w.id)`, [ctx.t7.id, descriptions]);
      obs.residue = { unnamedWeatherRows: rows.length, rows, expectedAtHead: T7B.residue.extraWeatherRowsListedByTheCleanup ? 'the race duplicates (3) and the failure orphans (3), WP7ADJ Q11' : null };
      notes.push(`T7 residue (WP7ADJ Q11): ${rows.length} weather rows no delay entry names (${rows.map((r) => `${r.description} ${r.days}${r.contractual ? ' contractual' : ''}`).join('; ') || 'none'})`);
    }
  } catch (error) { notes.push(`residue listing: ${error.message}`); }
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
  notes.push(`companies touched: ${Object.keys(ctx.orgs).join(', ') || 'none'} (087 for every write; 052 read only, and only with F52: WP7ADJ Q7)`);
  notes.push(`queued jobs cancelled through the product route: ${ctx.jobsCancelled.map((j) => `${j.project} ${j.cancelled}${j.refused.length ? ` (refused ${j.refused.length})` : ''}`).join(', ') || 'none'}`);
  notes.push(`blocker: ${ctx.blockerDb ? 'a separate pg connection that only read, locked and rolled back' : 'not opened'}`);
  if (ctx.t7 || ctx.t7h) notes.push(`company-level residue (stamp ${h.STAMP}): the throwaways' claims, documents, weather rows, daily logs and notifications stay with their archived projects; nothing written on 087-COM, 087-FLD or 052-FLD`);
  notes.push(`deep projects: ${ctx.deepWrites.length ? `UNEXPECTED WRITES: ${ctx.deepWrites.join('; ')}` : 'nothing written (POST /eot/calculate on 087-COM left its claims, weather delays and audit events unchanged)'}`);
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

module.exports = { __wp7: { kaStatus, judge, roundsVerdict, raceRoundVerdict, failureRoundVerdict, storedCom087, storedFld, fld087Verdict, fld052Verdict, fld052Observed, staticScan, classifyItems, confirmFirstItems, confirmFirstObservations, nodeAt, CHECKS, EXPECTED_CHECKS, SECTION_PROJECTS, CF_SOURCES, CATCHERS, OPTIONAL_CATCHERS, FIX_CATCHERS, COLLATERAL, DECIDED_RED, CONTRACT, FIXES, RULES, FIXTURE, STATE_STEPS, PERSONAS, NEED_COMPANIES, TEST_GAPS, DEVIATIONS, LEADS, WEATHER_CHECKS, WP7_PATCH_LEAVES, WP7_REFS, PATCH_TO } };

h.run({ main, cleanup });
