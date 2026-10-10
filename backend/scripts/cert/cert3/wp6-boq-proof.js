'use strict';

/**
 * WP-6 (BOQ, allocations, budgets and cost codes) primary proving run: the known-answer run of plan section 4 WP-6 on the
 * cert3d population (docs/certification/OCTAPM_CERT3_PLAN.md at 6c5ab54, unchanged since 48db9e9: section 4 WP-6
 * :795-836: rules :796-799, evidence :801-824, mutations :826, existing evidence :828, confirm first :830-835; section 6.2
 * WP-6 guards :1150; section 5 HR-C14 :1082, HR-C15 :1083, HR-C17 :1085, HR-C18 :1086; the defect-fix list :1107-1121
 * ("budget-revision running totals" :1113); section 1.1 the CLAUDE.md BOQ row :88; section 3.2 087-COM :427). Preparation
 * C:\Temp\octapm-cert\scratch\wp6\WP6-PREP.md (+ wp6-checks-draft.json, wp6-mutations-draft.json, derive-b6.json); the
 * BINDING integration-owner adjudication C:\Temp\octapm-cert\scratch\wp6\WP6-ADJUDICATION.md (Q1-Q14, cited WP6ADJ) with
 * the standing rulings it lists (no SQL fixtures; a value equal to HEAD's today under an undecided rule reads BLOCKED;
 * every writing check and every catcher on a throwaway; N-round concurrency probes, WP-6 has none; every expected figure a
 * book leaf, A10); moment map build/MOMENT-MAP.md (087-COM rows 154 and 159); answer book answers/commercial.js (WP6.*,
 * stage3:109, deep.087-COM.boqRows / boqSections / costTypes, claudeMd.boqChunk) AFTER the WP-6 book patch
 * (C:\Temp\octapm-cert\scratch\wp6\book\book-insert.js, df544c6f -> ca7e84ed; the proof refuses to load without it).
 * Revision r2 applies the integration-owner ruling of 2026-10-10 on L121 (TEST GAP L121 below).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp6-boq-proof.js [--only=BU,COM] [--project=B6] [--skip=CF]
 *
 * Filters. Sections split by project, so that a partial population and a mutant both stay where they belong:
 *   S     setup (always runs, for the projects and state files the selected checks need)
 *   BU    the bill on the throwaway B6: dry runs, uploads, the revision lock (B2, B4, B5)
 *   BA    allocations on B6 (B3; one probe names B6X's activity X-A1)
 *   BB    budget lines, transfers, revisions, the Original lock, the register on B6 (B6)
 *   BX    the AI breakdown job on the throwaway B6X: sections, the calls, the job after the baseline (X1-X4)
 *   PURE  the chunker through AI schedule generation on B6X (WP6ADJ Q3)
 *   COM   087-COM: the stored build moments and live reads      SCH  087-SCH: a read and one PATCH refusal (WP6ADJ Q13)
 *   CF    the confirm-first classifications
 * --only=<sections> keeps those sections, --project=<B6|B6X|087-COM|087-SCH|static> the sections that touch that
 * project, --skip=<sections> drops sections. A section or project not listed here is refused as unknown (BQ and B6Q
 * included: the L121 section and its throwaway are removed). Selecting CF selects every section CF classifies from
 * (BU BA BB BX COM); skipping one of those needs --skip=CF too. A filtered-out check is neither registered nor recorded.
 * The B6 choreography B0-B6 runs whole whenever one selected check runs on B6 (its steps depend on each other, as WP-5's
 * J); B6X's X0 runs whenever B6 or B6X is needed (A1.B6.foreignActivity names X-A1), X1-X4 for BX, the generation runs
 * for PURE. The primary run, the final run and every mutation run take no flags (mutate-multi.js spawns the proof
 * without arguments). Every run touches company 087 alone.
 *   Debug run on the partial population (087-COM, 087-COM-B, 087-COM-C and 087-SCH built; 052-COM not, and WP-6 reads no
 *   052 state): no flags, as the primary run (83 checks + G.5xx).
 *
 * In process (CERT_INPROCESS=1, through the lock runner only) on the certification database. Every expected figure is
 * an answer-book key (A10); every figure the B6 choreography types is read from a book leaf (WP6.B6.*, WP6.B6X.*) or is
 * a fixture input named in FIXTURE below (the bill rows the book's unexported BOQ constant holds, bound at load to every
 * leaf that states them; the allocation probes, the bulk and the mapping file the choreography text names; dates; the
 * generation duration). Deep projects are resolved by their exact names through the API as the 087 PM (exactly one live
 * project each); build state files are read only for moment answers and ids
 * (C:\Temp\octapm-cert\state\cert3\<code>.json, steps[].out and findings): no stored money figure is read but
 * budget-lines.originalCents (B1.stored.087.original, MOMENT-MAP row 154).
 *
 * WHERE EACH CHECK RUNS (the CHECKS table carries it per id):
 *   B6         the throwaway project of company 087 this run creates (WP6.B6.project: contractValue 2,000,000.00, the
 *              register's base; explicit defaultRetentionRate 10, so WP-6 never depends on HR-C1) and archives (WP6ADJ Q1;
 *              WP6.B6.choreography B0-B6, CF, Q11, end): every writing check and every section 6.2 catcher.
 *   B6X        the AI-job throwaway in 087 (WP6.B6X.*): the 130-row 50 / 50 / 30 bill, its queued boq.parse job run in
 *              process through the recorder stub (WP6ADJ Q2), and the chunker through AI schedule generation (Q3).
 *   087-COM   stored: the build moments of steps budget-lines and boq; live: reads only.
 *   087-SCH    a read and one PATCH refused by assertBoqEditable before any write (WP6ADJ Q13; no WP-6 mutant touches it).
 *   static     source scans (confirm-first evidence only).
 *
 * The AI recorder stub (WP6ADJ Q2): inside this process only, the external AI client's message create
 * (@anthropic-ai/sdk Anthropic.Messages.prototype.create, resolved from backend/src) is replaced by a recorder that
 * answers the book's scripted responses (WP6.B6X.stub) and makes NO network call; global fetch, http(s).request and the
 * undici global dispatcher are guarded for the same window (any non-loopback request is refused and counted). The proof
 * calls the product's job functions directly (boq.service runBoqActivityJob, schedule.service runScheduleGenerationJob)
 * on jobs the product's own routes queued, read back through GET /projects/:id/jobs/:jobId; it never calls claimNextJob,
 * so no other project's queued job (087-COM's and 087-SCH's included) is touched. A window that saw an unscripted AI call
 * or an outbound request is a setup error (R-SET), never a verdict. No queued job is left behind (WP6ADJ Q11): every job
 * a throwaway queues is run through the stub where a check needs it and then cancelled through the product route
 * POST /projects/:id/jobs/:jobId/cancel (the direct call does not move the row); each end step asserts zero queued jobs.
 *
 * Mutation safety (section 6.2 WP-6; mutate-multi.js runs the proof without flags, so every section runs under every
 * mutant): the catchers of M-DRY (r, s, m), M-CAP (q, a, i), M-XFER and M-ORIG (2, 4) all run on B6; the deep probes are
 * reads and the 087-SCH PATCH refusal, which no WP-6 mutant touches. B6X carries no catcher.
 *
 * TEST GAP L121 (the integration-owner ruling of 2026-10-10, superseding WP6ADJ Q4): the L121 check on company 011 is
 * removed: the section BQ, the throwaway B6Q, the checks S.B6Q.create, S.B6Q.toLimit, S.B6Q.archived and
 * KA.U6.nonAiImportAtLimit, every 011 session and persona and every request to 011. Driving 011's AI counter to its
 * limit would change one of the 97 companies whose exit fingerprint is compared, on every no-flag run (the primary run,
 * the final run and each of the 12 mutation runs), and the plan reserves 011 for entitlement cases; on 087 (Enterprise)
 * assertAiQuota returns before it reads the counter (backend/src/middleware/subscription-gate.js:87), so L121 cannot be
 * shown there either. Left unproven by WP-6: every real upload asserts the AI quota before the file is parsed, the dry
 * run alone skipping it (backend/src/services/boq.service.js:1174, in processBoqUpload; reached by every upload without
 * dryRun, backend/src/routes/boq.js:179; assertAiQuota answers 402 AI_LIMIT_REACHED at aiGenerationsUsed >= aiLimit,
 * subscription-gate.js:79-94; lines at a80ccef, backend/src unchanged since 6c5ab54). CF.HRC14 classifies without it and
 * reads PARTIAL (L121 its gap item); the HR-C14 fix mutation M-C14q has no catcher. The book's WP6.B6Q.* and WP6.U6.*
 * leaves stay in the book for the record; the proof reads none of them (its load guard asks for none). Recorded in
 * meta.testGaps (TEST_GAPS below).
 *
 * KNOWN ANSWERS (KA.*): judged value (pass), today (BLOCKED / known, with the ref, counted separately, never exit 2,
 * while the rule is undecided) or wrong (fail). No WP-6 rule is decided (HR-C14, HR-C17, HR-C18 wait for the owner;
 * HR-C15's baseline half is CERT-5's) and no WP-6 fix has landed (BR-ORDER, the section 5 fix :1113, its severity decided
 * at this run from the reproduction, WP6ADJ Q6; C1-TOL is WP-4's, WP6ADJ Q14; L109, L110, L111 are P2 leads). A decided
 * rule's today fails (the WP-1 ka() rule); a build moment observed before that fix commit reads STORED-PRE-FIX
 * (KA.U5.087.sections, strictly at the exit rebuild). A probe whose own setup fails is a setup error (exit 1), never
 * 'wrong' (R-SET): each such probe runs in its own section.
 * CONFIRM-FIRST (CF.*): plan :830-835 and the register row WP0-BOQ-1, classified from this run's observations as
 * CONFIRMED / PARTIAL / REJECTED / TEST GAP and reported (no rule decided); a landed fix turns its CF into a defect check
 * that must read REJECTED.
 *
 * Expected at HEAD on cert3d (after the WP-6 book patch, no fix commit set): 83 checks + G.5xx; 0 FAIL, exit 0, PASS
 * (harness provisional classification: none, no defect checks). Known answers BLOCKED (10): KA.U2.omitB005,
 * KA.U5.B6X.sections, KA.U5.B6X.aiJobCalls, KA.U5.B6X.aiAfterBaseline, KA.U5.087.sections (HR-C14);
 * KA.A2.resubmitRejected (HR-C17); KA.B3.overTransfer (C1-TOL); KA.B6.registerOrder (BR-ORDER); KA.B5.afterRepoint
 * (L109); KA.B7.archivedActual (L110). CF reported (8): CONFIRMED expected for CF.BRorder, CF.L109, CF.L110, CF.L111,
 * CF.HRC17, CF.HRC18, CF.WP0BOQ1; CF.HRC14 PARTIAL expected (seven items present: L131, L130, no section read back on
 * B6X and on 087-COM, the dropped row active and unflagged, the parser and the job read statically; L121 the gap item,
 * TEST GAP above). Green: 9 setup + 54 HARD + 2 STORED, and G.5xx.
 * Without the WP-6 book patch the proof refuses to load (the guard below).
 * After HR-C14 is decided as recommended (:1082): its five KAs turn value checks (CONTRACT filled), KA.U5.087.sections
 * reads STORED-PRE-FIX until the exit rebuild, and the HR-C14 fix mutations join (FIX_CATCHERS; M-C14q has no catcher,
 * L121 being a TEST GAP), CF.HRC14 judged on its seven proven items with L121 still the gap. After a confirmed-P1
 * defect fix or the commit implementing an owner rule (FIXES set, with its CONTRACT fields): its KAs turn value checks
 * (DECIDED_RED), its CF must read REJECTED.
 *
 * Adjudication applied (WP6ADJ): Q1 B6 carries every writing check and every catcher, B6X the AI-job checks (MOMENT-MAP
 * row 159 deviation recorded by key when the proof lands; 087-COM's own queued boq.parse job is never run); Q2 the
 * recorder stub; Q3 the chunker through AI schedule generation on B6X (CHUNKER_PATH 'product'; 'vm' is the labelled
 * unit-level fallback, used only if Claude Main's debug run shows the product path unreachable in process); Q4
 * superseded by the 2026-10-10 ruling (L121 a TEST GAP, no plan-limit switch, no company but 087 touched); Q5 the
 * refused real upload keeps one rejected document (EXPECTED BEHAVIOUR
 * provisionally: U3.B6.uploadMissingColumns asserts no row, revision, job, allocation or budget figure written); Q6
 * BR-ORDER's severity from this run (observations.runObservations.brSeverityEvidence); Q7 L112 not re-probed; Q8
 * WP3-ALLOC-1 stays WP-3's (no cutoff read here); Q9 the E6 entries (CATCHERS; under M-CAP the trigger answers 500, never
 * counted as a success); Q10 the leads recorded only (the quota refusal's orphan document is no longer observed: L121 is
 * a TEST GAP); Q11 no queued job left; Q12 U7's two cases (E8 rests on the WP-0 probe); Q13 the 087-SCH refusal; Q14
 * C1-TOL reused.
 * EXPECTED_CHECKS: WP6-PREP's 84 (wp6-checks-draft.json) minus KA.U6.nonAiImportAtLimit (removed by the 2026-10-10
 * ruling; the book's three B6Q setup ids are not added): 83, fixed; G.5xx on top.
 *
 * Exit 0 pass / 2 a check failed / 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp6-boq-proof.json (every check with its plan reference, answer-book key, expected,
 * observed and verdict in observations.checks; the KA verdicts in observations.knownAnswers; the CF classifications in
 * observations.confirmFirst; the fix state in observations.fixes; the recorder windows in observations.runObservations;
 * all written in cleanup, so a setup error still carries what was observed).
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');
const COMMERCIAL = require('./answers/commercial');

const { WP6 } = COMMERCIAL;
const D087 = COMMERCIAL.deep['087-COM'];
const STAGE3 = COMMERCIAL['stage3:109'];
const CLAUDE_MD = COMMERCIAL.claudeMd;

// -- the WP-6 book patch must be applied (G1-G26 as WP6ADJ Q1-Q14 rule them) ------------------------------------------
const leafAt = (key) => key.split('.').reduce((node, k) => (node && typeof node === 'object' ? node[k] : undefined), COMMERCIAL);
const WP6_PATCH_LEAVES = [
  'WP6.U3.dryRunWrites', 'WP6.U3.realUploadWrites', 'WP6.U4.lockFlow', 'WP6.U4.liveAfterLock', 'WP6.U4.reviewComparisonOnly', 'WP6.U4.lockAgain',
  'WP6.U4.scheduleBaselineLock', 'WP6.U5.aiJobCalls', 'WP6.U5.sectionsReadBack', 'WP6.U5.aiAfterBaseline', 'WP6.A1.amountOverCapacity',
  'WP6.A1.amountOverCapacityDetails', 'WP6.A2.rejected', 'WP6.A2.approved', 'WP6.A5.report', 'WP6.B1.sevenLines', 'WP6.B5.lockedByLedger',
  'WP6.B5.lockedByLedgerConditions', 'WP6.B5.lockedAfterCo', 'WP6.B5.lockedAfterCoConditions', 'WP6.B5.afterRepoint', 'WP6.B6.project', 'WP6.B6.team',
  'WP6.B6.fixture', 'WP6.B6.workbooks', 'WP6.B6.allocations', 'WP6.B6.budgetLines', 'WP6.B6.directCost', 'WP6.B6.transfers', 'WP6.B6.lineRevisions',
  'WP6.B6.budgetProbes', 'WP6.B6.register', 'WP6.B6.changeOrder', 'WP6.B6.residue', 'WP6.B6.choreography', 'WP6.B6X.project', 'WP6.B6X.team',
  'WP6.B6X.bill', 'WP6.B6X.stub', 'WP6.B6X.choreography', 'WP6.CF.HRC14', 'WP6.CF.BRorder',
  'WP6.CF.L109', 'WP6.CF.L110', 'WP6.CF.L111', 'WP6.CF.HRC17', 'WP6.CF.HRC18', 'WP6.CF.WP0BOQ1',
];
// The L121 ruling (2026-10-10): the book's U6 and B6Q leaves stay for the record and are asked for by nothing here.
{
  const missing = WP6_PATCH_LEAVES.filter((key) => { const leaf = leafAt(key); return !leaf || typeof leaf !== 'object' || !('value' in leaf); });
  if (missing.length) throw new Error(`answers/commercial.js carries no WP-6 leaf ${missing.join(', ')}: apply the WP-6 book patch (C:/Temp/octapm-cert/scratch/wp6/book/book-insert.js) first`);
  const refs = [['WP6.U2.omitB005', 'HR-C14'], ['WP6.A2.resubmitRejected', 'HR-C17'], ['WP6.B3.overTransfer', 'C1-TOL'],
    ['WP6.B5.afterRepoint', 'L109'], ['WP6.B6.BR-B', 'BR-ORDER'], ['WP6.B6.BR-A', 'BR-ORDER'], ['WP6.B7.archivedActual', 'L110'], ['WP6.U5.aiJobCalls087', 'HR-C14']];
  const bad = refs.filter(([key, ref]) => { const leaf = leafAt(key); return !leaf || leaf.ref !== ref || leaf.today === undefined || leaf.assumption !== true; });
  if (bad.length) throw new Error(`answers/commercial.js carries the pre-WP-6 form of ${bad.map(([key]) => key).join(', ')} (no today, ref or assumption: G3, G10, G16, G18-G20): apply the WP-6 book patch first`);
  const citesChunker = String(WP6.U5.chunk130.source).split('; ').some((c) => c.startsWith('backend/src/services/schedule.service.js:1929-1956') && c.endsWith(' @6c5ab54'));
  if (!String(WP6.mutations.allocationCapacity.value[0]).startsWith('A1.B6.overCapacity red') || !citesChunker) {
    throw new Error('answers/commercial.js carries the pre-WP-6 WP6.mutations / WP6.U5.chunk130 citations (G21, G24): apply the WP-6 book patch first');
  }
}

const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const REGISTER = 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md';
const LEADS = 'docs/certification/OCTAPM_CERT_LEADS.md';
const STATE_DIR = 'C:/Temp/octapm-cert/state/cert3';
const REPO = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(__dirname, '..', '..', '..', 'src');

const DEEP = {
  '087-COM': { company: '087', name: 'CERT3 Commercial (087-COM)' },
  '087-SCH': { company: '087', name: 'CERT3 Programme (087-SCH)' },
};

// -- CLI ------------------------------------------------------------------------------------------------------------
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const setOf = (text) => (text ? new Set(text.split(',').map((s) => s.trim()).filter(Boolean)) : null);
const ONLY = setOf(argOf('only'));
const SKIP = setOf(argOf('skip'));
const PROJECT_FILTER = argOf('project');

// -- the fixed list of checks: id, section, plan reference, answer-book key, where it runs ---------------------------
// where: 'B6' | 'B6X' | '087-COM' | '087-SCH' | 'stored:<code>' | 'static' | 'setup', or a comma list for a check
// that reads several. The section is the 6th argument (the sections split by project, see the header); the setup checks
// (S.*) carry no answer-book key (WP-1 L5). The book key is the check's primary leaf; the description names the others.
// <CHECKS>
const L = (...lines) => `${PLAN_DOC}:${lines.join(',')}`;
const C = (id, planRef, bookKey, where, description, section) => ({ id, section, planRef, bookKey, where, description });
const CHECKS = [
  C('S.book', L('795-836'), null, 'setup', 'the commercial answer book loads with the WP-6 patch (G1-G26 as WP6ADJ Q1-Q14 rule them; the load guard above): its figures() rows carry ref, the known-answer leaves this proof reads (the guard\'s eight refs and the KA checks\' nine leaves; no U6 or B6Q leaf of the book, the L121 ruling) carry a today and their ref, every key this proof reads resolves, and the FIXTURE bill agrees with every leaf that states it', 'S'),
  C('S.state', L(427), null, 'setup', 'the build state files the selected checks read are present with their WP-6 steps done: 087-COM cost-codes, budget-lines, boq (the HR-C14 finding kept), allocations; 087-SCH boq.upload and baseline; a fix commit, when set, is the one git dates', 'S'),
  C('S.projects', L(427), null, 'setup', 'the deep projects the selected checks read resolve by exact name through the API as the 087 PM, exactly one live each, matching the state files; every persona signs in to company 087, the only company WP-6 touches (the L121 ruling)', 'S'),
  C('S.B6.create', L(795), null, 'B6', 'B0: B6 created by the 087 PM (WP6.B6.project: contractValue 2,000,000.00, explicit defaultRetentionRate 10, EGP, five_day); team planner, qs, cost_controller, finance, site_engineer (WP6.B6.team)', 'S'),
  C('S.B6.fixture', L(795), null, 'B6', 'B1: the eight activities (planner, activityCode as named, the site engineer assigned) and the eight 087 library cost codes put on B6 by the cost controller, each found exactly once among GET budget/cost-codes available (WP6.B6.fixture; none created, HR-A1): each creation asserted', 'S'),
  C('S.B6X.create', L(795, 807), null, 'B6X', 'X0: B6X created by the 087 PM (WP6.B6X.project, no contract value); team planner and qs; the planner\'s activity X-A1 (WP6.B6X.team), before B6\'s B3 names it', 'S'),
  C('S.B6X.bill', L(427, 807), null, 'B6X', 'X1: the QS uploads the 130-row workbook (WP6.B6X.bill: files.boqRows.filler prefix X, sections 50 / 50 / 30, the section and mapping_rule columns): 200 imported; 130 active rows read back, each code / quantity / rate / amount equal to its workbook row; one boq.parse job queued (its id kept)', 'S'),
  C('S.B6.archived', L(795), null, 'B6', 'Q11 and end: B6\'s queued boq.parse jobs (U2, rate 160, omit B-005) cancelled through POST /projects/B6/jobs/:id/cancel, zero queued jobs left on B6 (WP6ADJ Q11); B6 archived by the PM (archivedAt read back)', 'S'),
  C('S.B6X.archived', L(795), null, 'B6X', 'Q11 and end: B6X\'s queued jobs (the boq.parse job after its two runs, the schedule.generate jobs) cancelled through the product route, zero queued jobs left on B6X; B6X archived by the PM (archivedAt read back)', 'S'),

  C('U3.B6.dryRunMissingColumns', L(805, 797), 'WP6.U3.missingColumns', 'B6', 'B2, the planner\'s dry run of the stage-3 workbook without the rate column: \'400 BOQ_VALIDATION_FAILED\', details.errors[0].code MISSING_COLUMNS (WP6.U3.detailCode); B6\'s BoqItem, BoqRevision, ProjectDocument boq_upload and boq.parse job counts unchanged (WP6.U3.dryRunWrites)', 'BU'),
  C('U1.B6.dryRun', L(803), 'WP6.U1.dryRunTotal', 'B6', 'B2, the planner\'s dry run of the stage-3 workbook: 200, dryRun true, mode imported (WP6.U2.importStatus), rowCount 5 (stage3:109.boqRowCount), totalAmount 459,000.00, comparison added 5 / updated 0 / removed 0 (WP6.U1.comparison)', 'BU'),
  C('U1.B6.writes', L(803, 1150), 'WP6.U1.writes', 'B6', 'B2, around that dry run: BoqItem (all), BoqRevision, ProjectDocument boq_upload and BackgroundJob boq.parse on B6 and 087\'s Subscription.aiGenerationsUsed unchanged (read-only counts; catcher of M-DRY / M-DRYr / M-DRYs, writes only on B6)', 'BU'),
  C('U7.B6.siteUpload', L(809), 'WP6.U7.siteUpload', 'B6', 'B2, the site engineer\'s real upload: \'403 FORBIDDEN\' (requireRoles, G25), nothing written (the counters unchanged)', 'BU'),
  C('U3.B6.uploadMissingColumns', L(805), 'WP6.U3.realUploadWrites', 'B6', 'B2, the QS\'s real upload without the rate column: \'400 BOQ_VALIDATION_FAILED\' / MISSING_COLUMNS; no BoqItem, BoqRevision, boq.parse job or allocation written and no budget figure moved; the file kept as one ProjectDocument, status rejected, linkedEntityType BOQ_VALIDATION_FAILED (G2; EXPECTED BEHAVIOUR provisionally, WP6ADJ Q5)', 'BU'),
  C('U2.B6.import', L(804), 'WP6.U2.importStatus', 'B6', 'B2, the QS\'s real upload of the stage-3 workbook: 200, mode imported, comparison added 5; GET /boq: 5 active rows (stage3:109.boqRowCount), 459,000.00 (stage3:109.boqTotal), current revision imported; one boq.parse job queued', 'BU'),
  C('U2.B6.rate160', L(804), 'WP6.U2.total', 'B6', 'B4, the PM re-uploads with B-002 at 160 and B-001 not_applicable (WP6.B6.workbooks rate160): 200, comparison updated 1 (WP6.U2.comparisonUpdated) / the other rows unchanged / removed 0; B-002 128,000.00 (WP6.U2[\'B-002.amount\']); GET /boq 467,000.00', 'BU'),
  C('U7.B6.uploaders', L(809), 'WP6.U7.qsPlannerPm', 'B6', 'B4, the planner\'s dry run (U1), the QS\'s import (U2) and the PM\'s re-upload (U2.rate160) each answered 200', 'BU'),
  C('KA.U2.omitB005', L(804, 831, 1082), 'WP6.U2.omitB005', 'B6', 'B4, the QS re-uploads without B-005: value comparison removed 1, B-005 active and flagged (the flag field is the fix\'s: CONTRACT pending); today removed 1, B-005 active, no flag - HR-C14', 'BU'),
  C('U4.B6.lockFlow', L(806, 797), 'WP6.U4.lockFlow', 'B6', 'B5, the current revision (the omit-B005 upload): planner submit under_review, QS approve approved, PM lock baselined with baselineLocked true, two earlier revisions superseded, lockedRows 5; GET /boq baseline locked, source boq_revision (G8)', 'BU'),
  C('U4.B6.comparisonOnly', L(806), 'WP6.U4.uploadMode', 'B6', 'B5, the QS uploads the stage-3 workbook again: 200, mode comparison_only, baselineLocked true, its job recorded completed; GET /boq still 5 active rows, 467,000.00 (WP6.U4.liveAfterLock)', 'BU'),
  C('U4.B6.reviewComparisonOnly', L(806, 797), 'WP6.U4.reviewComparisonOnly', 'B6', 'B5, the planner submits the comparison-only revision: \'409 BOQ_REVISION_COMPARISON_ONLY\'', 'BU'),
  C('U4.B6.lockAgain', L(806, 797), 'WP6.U4.lockAgain', 'B6', 'B5, the PM locks the baselined revision again: \'409 BOQ_BASELINE_LOCKED\' (no unlock, no second lock)', 'BU'),
  C('U4.B6.patchAfterLock', L(806), 'WP6.U4.patchAfterLock', 'B6', 'B5, the QS PATCHes B-001 {description}: \'409 BOQ_BASELINE_LOCKED\', the row unchanged', 'BU'),

  C('A2.B6.approveDraft', L(812), 'WP6.A2.approveDraft', 'B6', 'B3, B-004/A310 created as a draft by the planner; the QS approves it: \'400 INVALID_ALLOCATION_STATUS\'', 'BA'),
  C('A2.B6.patchSubmitted', L(812), 'WP6.A2.patchSubmitted', 'B6', 'B3, B-004/A310 submitted; the planner PATCHes quantity 2,999: \'400 ALLOCATION_NOT_EDITABLE\'', 'BA'),
  C('A2.B6.approved', L(812, 813), 'WP6.A2.approved', 'B6', 'B3, the five stage-3 allocations created and submitted by the planner, approved by the QS: status approved, quantities and amounts WP6.A2.approved (each the stage3:109 allocation leaf: 60,000.00 / 30,000.00 / 90,000.00 / 135,000.00 / 72,000.00)', 'BA'),
  C('A2.B6.rejectNoReason', L(812), 'WP6.A2.rejectNoReason', 'B6', 'B3, B-003/A140 10 t submitted; the QS rejects it without a reason: \'400 VALIDATION_ERROR\'', 'BA'),
  C('A2.B6.rejected', L(812), 'WP6.A2.rejected', 'B6', 'B3, the QS rejects it with a reason: 200, status rejected, isActive false (G12)', 'BA'),
  C('KA.A2.resubmitRejected', L(812, 834, 1085), 'WP6.A2.resubmitRejected', 'B6', 'B3, the planner submits the rejected row and PATCHes it: value submitted again (through the fix\'s path, CONTRACT pending); today submit \'400 INVALID_ALLOCATION_STATUS\' and PATCH \'400 ALLOCATION_NOT_EDITABLE\' - HR-C17', 'BA'),
  C('A1.B6.quantityZero', L(811), 'WP6.A1.quantityZero', 'B6', 'B3, B-003/A220 quantity 0: \'400 VALIDATION_ERROR\'', 'BA'),
  C('A1.B6.overCapacity', L(811, 1150), 'WP6.A1.overCapacity', 'B6', 'B3, B-001/A120 quantity 1 (B-001 fully allocated): \'400 ALLOCATION_QUANTITY_EXCEEDED\', details boqQuantity the row\'s 5,000, allocatedQuantity 5,001; nothing written (catcher of M-CAP / M-CAPq)', 'BA'),
  C('A1.B6.amountOverCapacity', L(811, 1150), 'WP6.A1.amountOverCapacity', 'B6', 'B3, B-003/A230 10 t with amount 80,000.00 (WP6.B6.allocations amountProbe): \'400 ALLOCATION_AMOUNT_EXCEEDED\', details boqAmount 72,000.00, allocatedAmount 80,000.00 (WP6.A1.amountOverCapacityDetails); nothing written (catcher of M-CAP / M-CAPa, G11)', 'BA'),
  C('A1.B6.duplicate', L(811), 'WP6.A1.duplicate', 'B6', 'B3, B-001/A110 again: \'400 DUPLICATE_ACTIVE_ALLOCATION\'', 'BA'),
  C('A1.B6.foreignActivity', L(811), 'WP6.A1.foreignActivity', 'B6,B6X', 'B3, B-001 with B6X\'s activity X-A1: \'404 ACTIVITY_NOT_FOUND\'', 'BA'),
  C('A1.B6.notApplicable', L(811), 'WP6.A1.notApplicable', 'B6', 'B3, B-003 set not_applicable (planner PATCH mapping-rules, 200), B-003/A220 quantity 5: \'409 MAPPING_NOT_APPLICABLE\'; B-003 set back to required (200)', 'BA'),
  C('A6.B6.patchNotApplicableApproved', L(816), 'WP6.A6.patchNotApplicableApproved', 'B6', 'B3, PATCH mapping-rules not_applicable on B-001 (an approved allocation): \'409 MAPPING_RULE_HAS_APPROVED_ALLOCATION\'', 'BA'),
  C('A3.B6.coverage', L(813), 'WP6.A3.allocated', 'B6', 'B3, GET coverage: approvedAllocatedAmount 387,000.00 (WP6.A3.allocated), unallocatedAmount 72,000.00 (WP6.A3.unallocated), coveragePct 84.31 at 2 dp (WP6.A3.coveragePct), counts.complete 4 (WP6.A3.rowsComplete)', 'BA'),
  C('A4.B6.bulk', L(814, 1150), 'WP6.A4.bulk', 'B6', 'B3, the planner\'s bulk [B-003/A220 10, B-001/A130 1, B-001/A110 1]: 201, createdCount 1, failedCount 2, codes [ALLOCATION_QUANTITY_EXCEEDED, DUPLICATE_ACTIVE_ALLOCATION] (catcher of M-CAP / M-CAPq; under M-CAP the trigger answers 500)', 'BA'),
  C('A5.B6.dryRun', L(815, 1150), 'WP6.A5.report', 'B6', 'B3, the planner\'s mapping-file dry run [B-003/A140 5, B-003/A230 5, B-999/A110 1, B-001/A120 1]: matched 2, unmatched 1, existing 0, breaches 1, created 0, totalAmount 12,000.00 (WP6.A5.report dryRun); the allocation list unchanged (catcher of M-DRY / M-DRYm / M-CAPi)', 'BA'),
  C('A5.B6.apply', L(815), 'WP6.A5.report', 'B6', 'B3, the planner applies the file: 201, created 2 drafts under one importBatchId (source import, suggestedBy import), failed 0 (WP6.A5.report apply)', 'BA'),
  C('A5.B6.undo', L(815), 'WP6.A5.report', 'B6', 'B3, the QS undoes the batch: rejected 2, keptApproved 0 (WP6.A5.report undo); exactly those two rows rejected and inactive, every other allocation unchanged', 'BA'),
  C('A6.B6.uploadWarning', L(816), 'WP6.A6.uploadWarning', 'B6', 'B4, the rate-160 upload names B-001 not_applicable: mappingRuleWarnings [MAPPING_RULE_HAS_APPROVED_ALLOCATION] for B-001; B-001 keeps mappingRule required', 'BA'),

  C('B1.B6.lines', L(818), 'WP6.B1.original', 'B6', 'B6, the cost controller creates the twelve lines of WP6.B6.budgetLines (the seven typed, OTH, T1, T2, LA, LB): each 201 at its original; the seven typed originals sum to 410,000.00 (WP6.B1.original)', 'BB'),
  C('B2.B6.duplicate', L(819), 'WP6.B2.duplicate', 'B6', 'B6, POST 01-100/labour again: \'409 BUDGET_LINE_DUPLICATE\'', 'BB'),
  C('B2.B6.actualDerived', L(819), 'WP6.B2.actualDerived', 'B6', 'B6, POST CERT3-087-COM-OVH/labour with actual 5: \'400 BUDGET_ACTUAL_IS_DERIVED\'; no line written', 'BB'),
  C('B1.B6.sevenLineCost', L(818), 'WP6.B1.sevenLines', 'B6', 'B6, one expense direct cost with seven lines on the seven typed lines (WP6.B6.directCost; the cost controller creates and submits, finance approves): GET /cost/reconciliation ledger.byCostType exactly WP6.B1.sevenLines (labour 1,000.00 .. contingency 7,000.00), total 28,000.00 (WP6.B1.sevenLineTotal)', 'BB'),
  C('B1.B6.balanced', L(818), 'WP6.B1.balanced', 'B6', 'B6, GET /cost/reconciliation: balanced true, budget.recordedTotal 28,000.00', 'BB'),
  C('B2.B6.costCodeInUse', L(819), 'WP6.B2.costCodeInUse', 'B6', 'B6, PUT budget/cost-codes {removeCostCodeIds: [01-100]}: \'409 COST_CODE_IN_USE\'; 01-100 still on B6', 'BB'),
  C('B3.B6.overTransferPlus2', L(820, 1150), 'WP6.B3.overTransferPlus2', 'B6', 'B6, finance transfers 100,000.02 (WP6.B3.overPlus2) from LAB (01-100/labour) to MAT (02-100/material): \'409 BUDGET_TRANSFER_EXCEEDS\'; both lines\' revised unchanged (catcher of M-XFER)', 'BB'),
  C('B3.B6.move20000', L(820), 'WP6.B3.projectRevised', 'B6', 'B6, finance transfers 20,000.00 LAB to MAT: LAB revised 80,000.00 (WP6.B3.from01_100), MAT 120,000.00 (WP6.B3.to02_100); the seven typed lines\' revised sum 410,000.00 (WP6.B3.projectRevised)', 'BB'),
  C('KA.B3.overTransfer', L(820, 1150), 'WP6.B3.overTransfer', 'B6', 'B6, the C1-TOL pair (T1 01-100/other to T2 02-100/other, 100,000.00 each), 100,000.01 (WP6.B3.over): value \'409 BUDGET_TRANSFER_EXCEEDS\'; today 200, T1 -0.01, T2 200,000.01, the pair\'s sum 200,000.00 - C1-TOL', 'BB'),
  C('B4.B6.revision', L(821), 'WP6.B4.revisionPlus5000', 'B6', 'B6, finance adds +5,000.00 with a note on IND (09-100/indirect): 201, revisions 5,000.00, revised 25,000.00 (WP6.B6.lineRevisions plus)', 'BB'),
  C('B4.B6.amountZero', L(821), 'WP6.B4.amountZero', 'B6', 'B6, a revision of 0: \'400 BUDGET_REVISION_AMOUNT_INVALID\'', 'BB'),
  C('B5.B6.lockedByLedger', L(822, 1150), 'WP6.B5.lockedByLedger', 'B6', 'B6, the cost controller PATCHes OVH\'s originalBudget to 10,001.00 (posted 6,000.00 by B1\'s expense, no change row): \'409 BUDGET_ORIGINAL_LOCKED\', details.conditions [ledger_posting 4] (WP6.B5.lockedByLedgerConditions); original unchanged (catcher of M-ORIG / M-ORIG4)', 'BB'),
  C('KA.B6.registerOrder', L(823, 832, 1113), 'WP6.B6.BR-B', 'B6', 'B6, the PM creates BR-A (+10,000.00, the run date - 10) then BR-B (+5,000.00, - 20), both approved, before any CO approval; GET /budget-revisions rows[].cumulativeBudget: value BR-B 2,005,000.00, BR-A 2,015,000.00 (WP6.B6.BR-B / BR-A); today BR-B 2,015,000.00, BR-A 2,010,000.00 - BR-ORDER', 'BB'),
  C('B5.B6.lockedAfterCo', L(822, 1150), 'WP6.B5.lockedAfterCo', 'B6', 'B6, a 10,000.00 CO on A110 naming LA (the QS creates, attaches an instruction, summaries and activity link, submits; the PM approves); the cost controller PATCHes LA\'s originalBudget to 1.00: \'409 BUDGET_ORIGINAL_LOCKED\', details.conditions [approved_change 2] (WP6.B5.lockedAfterCoConditions) (catcher of M-ORIG / M-ORIG2)', 'BB'),
  C('KA.B5.afterRepoint', L(822, 833), 'WP6.B5.afterRepoint', 'B6', 'B6, the cost controller re-points the CO to LB (PUT /budget/change-orders/:id/line, 200) and PATCHes LA\'s original to 1.00 again: value \'409 BUDGET_ORIGINAL_LOCKED\'; today 200 with LA\'s original 1.00 - L109', 'BB'),
  C('KA.B7.archivedActual', L(824, 833), 'WP6.B7.archivedActual', 'B6', 'B6, the cost controller archives MAT (2,000.00 of actual): value GET /budget/lines summary.totals.actual = GET /cost/reconciliation budget.recordedTotal = 28,000.00; today 26,000.00 against 28,000.00 - L110', 'BB'),
  C('B3.B6.archivedLine', L(820), 'WP6.B3.archivedLine', 'B6', 'B6, finance transfers 1.00 from LAB to the archived MAT: \'409 BUDGET_LINE_ARCHIVED\'', 'BB'),

  C('KA.U5.B6X.sections', L(807, 831, 1082), 'WP6.U5.sectionsReadBack', 'B6X', 'X1, GET /boq rows by section and GET coverage?groupBy=section on B6X: value Substructure 50, Superstructure 50, Finishes 30 (WP6.U5.sectionsReadBack B6X); today no row carries a section (one Unassigned group of 130) - HR-C14', 'BX'),
  C('KA.U5.B6X.aiJobCalls', L(807, 831, 1082), 'WP6.U5.aiJobCalls', 'B6X', 'X2, runBoqActivityJob in process on B6X\'s queued job with the recorder stub (WP6.B6X.stub job): value 3 calls of 50 / 50 / 30 rows; today 1 call of 130 rows - HR-C14 (L131; WP6.U5.aiJobCalls087 its count)', 'BX'),
  C('KA.U5.B6X.aiAfterBaseline', L(807, 831, 1082), 'WP6.U5.aiAfterBaseline', 'B6X', 'X3-X4, B6X\'s bill locked (planner submit, QS approve, PM lock); the handler run again with the stub naming one activity for X1-001 (WP6.B6X.stub afterBaseline): value refused, nothing created; today one new activity and one draft allocation on the locked bill - HR-C14 (L130)', 'BX'),
  C('U5.pure.chunk130', L(807, 88), 'WP6.U5.chunk130', 'B6X', 'chunkBoqRows through AI schedule generation on B6X with the recorder stub (WP6ADJ Q3): the structuring answer supplies 130 rows with no section; the activity-generation calls carry [60, 60, 10] rows (claudeMd.boqChunk)', 'PURE'),
  C('U5.pure.chunk505030', L(807, 88), 'WP6.U5.chunkSections505030', 'B6X', 'the same with sections of 50 / 50 / 30: [50, 50, 30] (claudeMd.boqChunk)', 'PURE'),
  C('U5.pure.chunk7045', L(807, 88), 'WP6.U5.chunkSections7045', 'B6X', 'the same with sections of 70 / 45: [60, 55] (claudeMd.boqChunk)', 'PURE'),
  C('U5.pure.chunk60', L(807), 'WP6.U5.chunk60', 'B6X', 'the same with 60 rows and no section: [60]', 'PURE'),
  C('U5.pure.chunk61', L(807), 'WP6.U5.chunk61', 'B6X', 'the same with 61 rows and no section: [60, 1]', 'PURE'),

  C('U5.stored.087.bill', L(427, 807), 'deep.087-COM.boqSections', 'stored:087-COM', 'stored step boq done: rows 130 (deep.087-COM.boqRows), the workbook\'s three sections of 50 / 50 / 30 by name (deep.087-COM.boqSections); the read-back and the HR-C14 finding agree (no section read back with the finding kept, or the workbook\'s sections without it)', 'COM'),
  C('U5.live.087.rows', L(427, 807), 'deep.087-COM.boqRows', '087-COM', 'GET /boq on 087-COM: 130 active rows; the state\'s designed rows (B-001..D-005) present by id and code', 'COM'),
  C('KA.U5.087.sections', L(807, 831, 1082), 'WP6.U5.sectionsReadBack', '087-COM', 'the 087-COM rows read back by section (GET /boq and coverage?groupBy=section): value Substructure and frame 50, Envelope and services 50, Finishes and externals 30 (WP6.U5.sectionsReadBack 087-COM); today none on 130 rows - HR-C14 (a build record: STORED-PRE-FIX after the fix, strictly at the exit rebuild)', 'COM'),
  C('B1.stored.087.original', L(427, 818), 'WP6.B1.original', 'stored:087-COM', 'stored step budget-lines done: originalCents 41,000,000 = WP6.B1.original (asserted in build; MOMENT-MAP row 154)', 'COM'),
  C('B1.live.087.original', L(427, 818), 'WP6.B1.original', '087-COM', 'GET budget/lines on 087-COM: the seven typed lines\' originals sum to 410,000.00, and so do all the lines the build made (02-100/subcontract and OTH/other hold none of it)', 'COM'),
  C('B1.live.087.costTypes', L(427), 'deep.087-COM.costTypes', '087-COM', 'the lines the 087-COM build made cover the eight cost types (deep.087-COM.costTypes: plan section 3.2 "cost codes and lines for all eight cost types")', 'COM'),
  C('U4.live.087SCH.lock', L(806, 797), 'WP6.U4.scheduleBaselineLock', '087-SCH', 'GET /boq on 087-SCH: baseline locked true, source schedule_baseline (the bill locked by the schedule baseline; G9)', 'SCH'),
  C('U4.live.087SCH.patch', L(806), 'WP6.U4.scheduleBaselineLock', '087-SCH', 'the PM PATCHes S-001 with its own description: \'409 BOQ_BASELINE_LOCKED\' (assertBoqEditable precedes every write; no WP-6 mutant touches it, WP6ADJ Q13), the row unchanged', 'SCH'),

  C('CF.HRC14', L(831, 1082), 'WP6.CF.HRC14', 'B6,B6X,087-COM,static', 'confirm-first HR-C14: L131 (KA.U5.B6X.aiJobCalls), L130 (KA.U5.B6X.aiAfterBaseline), the missing section column (KA.U5.B6X.sections, KA.U5.087.sections; the parser reads none), dropped rows stay active (KA.U2.omitB005); L121 a TEST GAP item (its check removed by the 2026-10-10 ruling), so PARTIAL expected - reported', 'CF'),
  C('CF.BRorder', L(832, 1113), 'WP6.CF.BRorder', 'B6,static', 'confirm-first running totals out of order: the stored cumulativeBudget (KA.B6.registerOrder) against the same answer\'s waterfall (effective order) and the totals after the CO approval\'s recompute (healed); createBudgetRevision recomputes nothing (static) - BR-ORDER, reported until its fix lands', 'CF'),
  C('CF.L109', L(833), 'WP6.CF.L109', 'B6', 'confirm-first L109: the Original lock removed by re-pointing an approved CO (B5.B6.lockedAfterCo then KA.B5.afterRepoint) - reported', 'CF'),
  C('CF.L110', L(833), 'WP6.CF.L110', 'B6', 'confirm-first L110: archiving a line that carries actual hides it from the lines\' actual (KA.B7.archivedActual) - reported', 'CF'),
  C('CF.L111', L(833), 'WP6.CF.L111', 'B6', 'confirm-first L111: negative budgets accepted: a line CERT3-087-COM-EQP/other at -500.00 (today 201) and a revision of -999,999.00 on LAB (today 201, revised -919,999.00) - reported', 'CF'),
  C('CF.HRC17', L(834, 1085), 'WP6.CF.HRC17', 'B6', 'confirm-first HR-C17: a rejected allocation cannot be resubmitted (KA.A2.resubmitRejected) - reported', 'CF'),
  C('CF.HRC18', L(835, 1086), 'WP6.CF.HRC18', 'B6,static', 'confirm-first HR-C18: the budget register and the ledger take eight cost types (the OTH line, summary.byType, budget.service.js COST_TYPES), the activity cost record seven category fields (cost.service.js CATEGORY_FIELDS) - an observation (WP6.B1.costTypes), reported', 'CF'),
  C('CF.WP0BOQ1', `${REGISTER}:258,266`, 'WP6.CF.WP0BOQ1', 'B6', 'confirm-first WP0-BOQ-1: GET /boq/template and GET /boq/uploads/<the U2 document> as the cost controller and the site engineer: today 403 FORBIDDEN although boq:read allows them; as the QS 200 (or a 302 to storage) - reported', 'CF'),
];
/**
 * Fixed before the first run: the checks above (G.5xx is the harness's own, on top). WP6-PREP's draft list
 * (wp6-checks-draft.json): 84 checks; the integration-owner ruling of 2026-10-10 removes KA.U6.nonAiImportAtLimit (L121,
 * a TEST GAP) and the book's three B6Q setup ids are not added (book-changes.md "New setup ids" stays for the record): 83.
 */
const EXPECTED_CHECKS = 83;
// </CHECKS>
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((c) => c.id)).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');

/** Which projects each section touches (the --project filter selects sections). */
const SECTION_PROJECTS = {
  S: ['B6', 'B6X', '087-COM', '087-SCH', 'static'],
  BU: ['B6'], BA: ['B6', 'B6X'], BB: ['B6'], BX: ['B6X'], PURE: ['B6X'],
  COM: ['087-COM'], SCH: ['087-SCH'],
  CF: ['B6', 'B6X', '087-COM', 'static'],
};
for (const c of CHECKS) if (!SECTION_PROJECTS[c.section]) throw new Error(`check ${c.id}: section ${c.section} is not in SECTION_PROJECTS`);
for (const [flag, set] of [['only', ONLY], ['skip', SKIP]]) {
  for (const section of set || []) if (!SECTION_PROJECTS[section]) throw new Error(`--${flag}: no section ${section} (sections: ${Object.keys(SECTION_PROJECTS).join(' ')})`);
}
if (PROJECT_FILTER && !Object.values(SECTION_PROJECTS).some((list) => list.includes(PROJECT_FILTER))) throw new Error(`--project: no project ${PROJECT_FILTER}`);
/** The sections CF classifies from (confirmFirstFlow reads their records, known answers and observations). */
const CF_SOURCES = ['BU', 'BA', 'BB', 'BX', 'COM'];
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
/** The throwaways: B6 for BU / BA / BB (and CF); B6X's X0 also for B6 (X-A1), X1-X4 for BX, the generation runs for PURE. */
const NEED_B6 = on('BU') || on('BA') || on('BB');
const NEED_B6X_BILL = on('BX');
const NEED_PURE = on('PURE');
const NEED_B6X = NEED_B6 || NEED_B6X_BILL || NEED_PURE;
/** The deep projects (live or stored) the selected checks need. */
const NEED_DEEP = Object.keys(DEEP).filter((code) => runsOn(code));
/** Live reads of a deep project (stored-only checks need its state file, not the project). */
const NEED_LIVE = Object.keys(DEEP).filter((code) => ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes(code)));
/** The one company every run touches (the L121 ruling, 2026-10-10: no session, request or read of any other company). */
const NEED_COMPANIES = Object.freeze(['087']);
if (Object.values(DEEP).some((d) => !NEED_COMPANIES.includes(d.company))) throw new Error('a deep project outside company 087: the L121 ruling allows no other company');

// -- small helpers --------------------------------------------------------------------------------------------------
/** A list out of an answer's data: the array itself, or its items / rows / allocations / ... */
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items', 'rows', 'allocations', 'entries', 'lines', 'members', 'orders', 'data']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const json = (v, max = 600) => { try { return JSON.stringify(v).slice(0, max); } catch { return String(v).slice(0, max); } };
/** Sorted-key JSON text: the same object gives the same text whatever order its keys were written in. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
};
const sameJson = (a, b) => canonical(a) === canonical(b);
const readState = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${code}.json`), 'utf8'));
const outOf = (state, step) => {
  const st = state?.steps?.[step];
  if (!st || st.status !== 'done') throw new Error(`build ${state?.code}: step ${step} is ${st ? st.status : 'not run'}`);
  return st.out;
};
const stepAt = (st, step) => st?.steps?.[step]?.finishedAt || st?.steps?.[step]?.blocked?.at || null;
/** Money as integer cents (the API answers currency units); a value that is not an exact amount reads as a string, so it never matches. */
const cents = (v) => {
  if (v === null || v === undefined) return null;
  try { return harness.toCents(v); } catch { return `not cents: ${v}`; }
};
/** Cents as a payload amount in currency units (exact for every amount this proof sends: two decimals at most). */
const units = (c) => Number((c / 100).toFixed(2));
/** The calendar date n days from now (UTC; a plan date, never a transaction date). */
const dayFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
/** A book error leaf as the answer string ('409 BOQ_BASELINE_LOCKED'); a code-null leaf as its status alone. */
const saidOf = (leaf) => (leaf.value?.code ? `${leaf.value.status} ${leaf.value.code}` : String(leaf.value?.status));
/** An answer string as { status, code } (code null when the answer carried none). */
const saidParts = (said) => { const [status, code = null] = String(said).split(' '); return { status: Number(status), code }; };
/** A book row by its key (exactly one expected). */
const oneRow = (list, pred, what) => {
  const rows = list.filter(pred);
  if (rows.length !== 1) throw new Error(`answer book: ${rows.length} rows for ${what} (exactly one expected)`);
  return rows[0];
};
/** The book's not-sent marker on a create payload (WP6.B6X.project contractValue). */
const NOT_SENT = 'not sent';
const sentOnly = (payload) => Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== NOT_SENT));

// -- B6 and B6X as the book types them (currency units in payloads, cents in the leaves) -----------------------------------
const B6B = {
  project: WP6.B6.project.value,
  team: WP6.B6.team.value,
  fixture: WP6.B6.fixture.value,
  workbooks: WP6.B6.workbooks.value,
  allocations: WP6.B6.allocations.value,
  budgetLines: WP6.B6.budgetLines.value,
  directCost: WP6.B6.directCost.value,
  transfers: WP6.B6.transfers.value,
  lineRevisions: WP6.B6.lineRevisions.value,
  budgetProbes: WP6.B6.budgetProbes.value,
  register: WP6.B6.register.value,
  changeOrder: WP6.B6.changeOrder.value,
  choreography: WP6.B6.choreography.value,
};
const B6XB = { project: WP6.B6X.project.value, team: WP6.B6X.team.value, bill: WP6.B6X.bill.value, stub: WP6.B6X.stub.value, choreography: WP6.B6X.choreography.value };
/** A B6 budget line of the book by its key (LAB, MAT, ..., LB). */
const lineBook = (key) => oneRow(B6B.budgetLines, (l) => l.key === key, `WP6.B6.budgetLines ${key}`);
/** The seven typed lines (every line whose cost type is one of WP6.B1.sevenLines', in the book's order). */
const TYPED_KEYS = B6B.budgetLines.filter((l) => Object.keys(WP6.B1.sevenLines.value).includes(l.costType)).map((l) => l.key);
/** The B6 choreography step text by its head (B0, B1, ...). */
const stepText = (steps, head) => oneRow(steps, (s) => s.split(' ')[0] === head, `choreography step ${head}`);

/**
 * Fixture inputs that are not expected figures (WP4ADJ B8 precedent; WP-5's FIXTURE). The bill rows restate the book's
 * BOQ constant (answers/commercial.js, not exported: the stage-3 bill, stage3-boq-budget.js:25-31); every leaf that states
 * a figure of them is checked against them at load below, so a book or fixture change refuses to load. The probes, the bulk
 * and the mapping file are the rows the choreography text and the leaves' derivations name (checked at load). Dates, the
 * direct cost's activity and unit, and the generation duration B6X needs for AI schedule generation (validateForGeneration:
 * a project duration above 0) are build choices.
 */
const FIXTURE = Object.freeze({
  bill: Object.freeze({
    'B-001': Object.freeze({ description: 'Bulk excavation to reduced level', unit: 'm3', quantity: 5000, rate: 12 }),
    'B-002': Object.freeze({ description: 'Foundation concrete C35', unit: 'm3', quantity: 800, rate: 150 }),
    'B-003': Object.freeze({ description: 'High tensile reinforcement', unit: 't', quantity: 60, rate: 1200 }),
    'B-004': Object.freeze({ description: 'Blockwork walls 200mm', unit: 'm2', quantity: 3000, rate: 45 }),
    'B-005': Object.freeze({ description: 'Internal plaster two coats', unit: 'm2', quantity: 4000, rate: 18 }),
  }),
  activityStart: '2026-02-02',
  activityEnd: '2026-06-30',
  costDate: '2026-09-25',
  costActivity: 'A110',
  costUnit: 'ls',
  probes: Object.freeze({ quantityZero: ['B-003', 'A220', 0], overCapacity: ['B-001', 'A120', 1], duplicate: ['B-001', 'A110', 1], foreignActivity: ['B-001', 'X-A1', 1], notApplicable: ['B-003', 'A220', 5] }),
  patchSubmittedQuantity: 2999,
  bulk: Object.freeze([['B-003', 'A220', 10], ['B-001', 'A130', 1], ['B-001', 'A110', 1]]),
  mappingFile: Object.freeze([['B-003', 'A140', 5], ['B-003', 'A230', 5], ['B-999', 'A110', 1], ['B-001', 'A120', 1]]),
  actualDerived: Object.freeze({ code: 'CERT3-087-COM-OVH', costType: 'labour', actual: 5 }),
  generation: Object.freeze({ duration: 18, durationUnit: 'months' }),
  sections7045: Object.freeze(['CERT3 WP6 section A', 'CERT3 WP6 section B']),
});
/** The bill row amount in cents, at a rate the workbook may override. */
const rowCents = (code, rates = {}) => Math.round(FIXTURE.bill[code].quantity * (rates[code] === undefined ? FIXTURE.bill[code].rate : rates[code]) * 100);
// The fixture against every leaf that states a figure of it (a mismatch refuses to load).
{
  const problems = [];
  const wb = B6B.workbooks;
  const codes = Object.keys(FIXTURE.bill);
  if (!sameJson(wb.stage3.rows, codes)) problems.push(`the bill codes ${codes.join(',')} are not WP6.B6.workbooks stage3 ${wb.stage3.rows.join(',')}`);
  for (const [name, w] of Object.entries(wb)) {
    if (w.totalCents === null) continue;
    const total = w.rows.reduce((s, code) => s + rowCents(code, w.rates), 0);
    if (total !== w.totalCents) problems.push(`workbook ${name}: the fixture gives ${total}, the leaf ${w.totalCents}`);
  }
  if (wb.stage3.totalCents !== STAGE3.boqTotal.value || wb.stage3.rows.length !== STAGE3.boqRowCount.value) problems.push('the stage-3 workbook is not stage3:109.boqTotal / boqRowCount');
  for (const a of WP6.A2.approved.value) if (Math.round(a.qty * FIXTURE.bill[a.row].rate * 100) !== a.amount) problems.push(`approved ${a.row}/${a.activity}: ${a.qty} x the fixture rate is not ${a.amount}`);
  const approvedQty = (row) => WP6.A2.approved.value.filter((a) => a.row === row).reduce((s, a) => s + a.qty, 0);
  if (codes.filter((code) => approvedQty(code) === FIXTURE.bill[code].quantity).length !== WP6.A3.rowsComplete.value) problems.push('the rows the approved allocations cover whole are not WP6.A3.rowsComplete');
  const rj = B6B.allocations.rejected;
  if (Math.round(rj.qty * FIXTURE.bill[rj.row].rate * 100) !== rj.amount) problems.push('the rejected allocation amount');
  const ap = B6B.allocations.amountProbe;
  if (rowCents(ap.row) !== WP6.A1.amountOverCapacityDetails.value.boqAmount || ap.amount !== WP6.A1.amountOverCapacityDetails.value.allocatedAmount) problems.push('the amount probe against WP6.A1.amountOverCapacityDetails');
  if (rowCents('B-002', wb.rate160.rates) !== WP6.U2['B-002.amount'].value) problems.push('B-002 at 160 against WP6.U2[B-002.amount]');
  const b3 = stepText(B6B.choreography, 'B3');
  for (const phrase of ['B-003/A220 quantity 0 -> A1.B6.quantityZero', 'B-001/A120 quantity 1 -> A1.B6.overCapacity', 'B-001/A110 again -> A1.B6.duplicate', 'B-001 with B6X\'s X-A1 -> A1.B6.foreignActivity', 'B-003/A220 quantity 5', 'PATCH quantity 2,999 -> A2.B6.patchSubmitted']) {
    if (!b3.includes(phrase)) problems.push(`the B3 step text no longer names "${phrase}"`);
  }
  for (const phrase of ['B-003/A140 5 t', 'B-003/A230 5 t', 'B-999', 'B-001/A120 1 m3']) if (!WP6.A5.report.derivation.includes(phrase)) problems.push(`WP6.A5.report no longer names "${phrase}"`);
  if (FIXTURE.bulk.length !== 3 || !WP6.A4.bulk.derivation.includes('Bulk of 3')) problems.push('the bulk is not WP6.A4.bulk\'s three rows');
  if (!stepText(B6B.choreography, 'B6').includes('CERT3-087-COM-OVH/labour with actual 5')) problems.push('the B6 step text no longer names the actual probe');
  if (problems.length) throw new Error(`FIXTURE against the WP-6 book: ${problems.join('; ')}`);
}

// -- rules, the fix commits and the contracts pending their decisions or plan reviews ----------------------------------
const WP6ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp6/WP6-ADJUDICATION.md ${item}`;
/**
 * The fix commits: EMPTY until each fix lands. The integration owner sets both fields from the fix commit
 * (`git show -s --format=%cI <commit>`); the proof checks the time against git (S.state). Once set, the rule is decided,
 * its KAs and CF are judged on the value, and a build record observed before the commit reads STORED-PRE-FIX. The owner
 * rules (HR-C14, HR-C17) are undecided: their entries are set only by the commit that implements the owner's decision,
 * together with its CONTRACT fields. BR-ORDER is the section 5 defect fix (:1113), made only if it confirms as P1 at this
 * run (WP6ADJ Q6). C1-TOL is WP-4's (set with WP-4's fix). L109, L110 and L111 are P2 leads, set only if rated P1 and
 * fixed. WP0-BOQ-1 is set by the commit that implements the owner's HR-A1 choice. HR-C18 is an observation, never set.
 */
const FIXES = Object.freeze({
  'HR-C14': Object.freeze({ commit: null, committedAt: null }),
  'HR-C17': Object.freeze({ commit: null, committedAt: null }),
  'BR-ORDER': Object.freeze({ commit: null, committedAt: null }),
  'C1-TOL': Object.freeze({ commit: null, committedAt: null }),
  L109: Object.freeze({ commit: null, committedAt: null }),
  L110: Object.freeze({ commit: null, committedAt: null }),
  L111: Object.freeze({ commit: null, committedAt: null }),
  'WP0-BOQ-1': Object.freeze({ commit: null, committedAt: null }),
});
const fixed = (rule) => Boolean(FIXES[rule]?.commit);
const fixRule = (rule, statement, sources) => ({ status: fixed(rule) ? 'decided' : 'proposed', statement: `${statement}${fixed(rule) ? `; implemented in ${FIXES[rule].commit}` : '; not yet decided and implemented'}.`, sources });
const RULES = {
  'HR-C14': fixRule('HR-C14', 'BOQ import (the recommendation :1082; undecided): an optional section column parsed, written and served; the AI job in batches of at most 60 rows by section; dropped rows flagged, not deactivated; AI quota only for the AI job; the AI job refused after the baseline', [`${PLAN_DOC}:797,804,807,808,831,1082`, WP6ADJ('Q1-Q4')]),
  'HR-C17': fixRule('HR-C17', 'The allocation lifecycle (:1085; undecided): a rejected allocation returns to draft and is submitted again; an approved row is withdrawn only through a BOQ revision', [`${PLAN_DOC}:798,812,834,1085`]),
  'HR-C18': { status: 'proposed', statement: 'Seven or eight cost categories (:1086; undecided): keep eight and show other separately; which seven the 7-category breakdown reports is the owner\'s. WP-6 observes the two vocabularies and judges no value under it.', sources: [`${PLAN_DOC}:88,835,1086`] },
  'BR-ORDER': fixRule('BR-ORDER', 'Budget-revision running totals are in effective-date order at create as at update and delete (the section 5 defect fix :1113, HR-C15\'s first half; made if it confirms as P1, its severity decided at this run from the reproduction, compute on read preferred: WP6ADJ Q6)', [`${PLAN_DOC}:799,823,832,1083,1113`, WP6ADJ('Q6')]),
  'C1-TOL': fixRule('C1-TOL', 'Money ceilings allow no cent over: a transfer of 100,000.01 out of a line revised at 100,000.00 is refused (WP-0 book adjudication C1; WP-4 CF.C1TOL, WP4ADJ Q12; reused with no new confirm-first item, WP6ADJ Q14)', [`${PLAN_DOC}:799,820`, WP6ADJ('Q14')]),
  L109: fixRule('L109', 'A line whose Original Budget was locked stays locked when the approved change order that locked it is re-pointed to another line (lead L109, P2 proposed; severity an owner question, O6)', [`${PLAN_DOC}:799,822,833`, `${LEADS}:115`]),
  L110: fixRule('L110', 'Archiving a budget line that carries actual hides none of it: GET /budget/lines totals.actual equals the reconciliation\'s budget.recordedTotal (lead L110, P2 proposed; O6)', [`${PLAN_DOC}:799,824,833`, `${LEADS}:116`]),
  L111: fixRule('L111', 'Budget lines, revisions and transfers have floors: no negative original, no revision that takes a line below zero (lead L111, P2 proposed; whether a negative revision below actual is ever valid is the owner\'s, O6)', [`${PLAN_DOC}:833`, `${LEADS}:117`]),
  'WP0-BOQ-1': fixRule('WP0-BOQ-1', 'The BOQ template and the stored upload follow boq:read, which all nine roles hold (register WP0-BOQ-1, P3; the owner may narrow the policy instead, through HR-A1: O5)', [`${REGISTER}:258,266`]),
};
const CF_RULE = { 'CF.HRC14': 'HR-C14', 'CF.BRorder': 'BR-ORDER', 'CF.L109': 'L109', 'CF.L110': 'L110', 'CF.L111': 'L111', 'CF.HRC17': 'HR-C17', 'CF.HRC18': 'HR-C18', 'CF.WP0BOQ1': 'WP0-BOQ-1' };
/** The defect checks of a landed fix (none at HEAD): kind 'defect', judged on the value, today fails. */
const DECIDED_RED = {
  ...(fixed('HR-C14') ? {
    'KA.U2.omitB005': { rule: 'HR-C14', defect: 'HR-C14 a dropped row stays active with no flag', stored: false, today: 'removed 1, active, no flag' },
    'KA.U5.B6X.sections': { rule: 'HR-C14', defect: 'HR-C14 no section read back (B6X)', stored: false, today: '(none) 130' },
    'KA.U5.B6X.aiJobCalls': { rule: 'HR-C14', defect: 'HR-C14 the AI job sends every row in one prompt (L131)', stored: false, today: '1 call of 130' },
    'KA.U5.B6X.aiAfterBaseline': { rule: 'HR-C14', defect: 'HR-C14 the AI job writes on a locked bill (L130)', stored: false, today: '1 activity, 1 draft allocation' },
    'KA.U5.087.sections': { rule: 'HR-C14', defect: 'HR-C14 no section read back (087-COM build record)', stored: true, today: '(none) 130' },
    'CF.HRC14': { rule: 'HR-C14', defect: 'HR-C14 BOQ import', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-C17') ? {
    'KA.A2.resubmitRejected': { rule: 'HR-C17', defect: 'HR-C17 a rejected allocation cannot be resubmitted', stored: false, today: '400 INVALID_ALLOCATION_STATUS' },
    'CF.HRC17': { rule: 'HR-C17', defect: 'HR-C17 the allocation lifecycle', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('BR-ORDER') ? {
    'KA.B6.registerOrder': { rule: 'BR-ORDER', defect: 'BR-ORDER running totals out of effective-date order at create', stored: false, today: 'BR-B 2,015,000.00, BR-A 2,010,000.00' },
    'CF.BRorder': { rule: 'BR-ORDER', defect: 'BR-ORDER running totals out of order', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('C1-TOL') ? { 'KA.B3.overTransfer': { rule: 'C1-TOL', defect: 'C1-TOL a transfer one cent over accepted', stored: false, today: '200' } } : {}),
  ...(fixed('L109') ? {
    'KA.B5.afterRepoint': { rule: 'L109', defect: 'L109 the Original lock released by a re-point', stored: false, today: '200, original 1.00' },
    'CF.L109': { rule: 'L109', defect: 'L109 the Original lock released by a re-point', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('L110') ? {
    'KA.B7.archivedActual': { rule: 'L110', defect: 'L110 an archived line hides its actual', stored: false, today: '26,000.00 against 28,000.00' },
    'CF.L110': { rule: 'L110', defect: 'L110 an archived line hides its actual', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('L111') ? { 'CF.L111': { rule: 'L111', defect: 'L111 negative budgets accepted', stored: false, today: 'CONFIRMED' } } : {}),
  ...(fixed('WP0-BOQ-1') ? { 'CF.WP0BOQ1': { rule: 'WP0-BOQ-1', defect: 'WP0-BOQ-1 the template and the stored upload narrower than boq:read', stored: false, today: 'CONFIRMED' } } : {}),
};
for (const [id, d] of Object.entries(DECIDED_RED)) {
  if (!CHECKS.some((c) => c.id === id) || RULES[d.rule]?.status !== 'decided') throw new Error(`DECIDED_RED ${id}: not a check, or ${d.rule} is not decided`);
}

/**
 * The contracts of the undecided rules and the defect fixes, filled ONLY from the adjudicated decision or fix plan
 * (WP4ADJ Q2 precedent: no contract is guessed). While null, only what the book's value says is judged.
 *   HR-C14.droppedRowFlagField  the BOQ row field the fix sets on a row an upload leaves out (null: no flag is read)
 *   HR-C14.aiAfterBaselineAnswer '<status> <CODE>' or 'skipped' of the AI job after the baseline (null: nothing created)
 *   HR-C14.sectionField          the BOQ row field that carries the section (null: the schema's 'section')
 *   HR-C17.returnToDraftRoute    the route that returns a rejected allocation to draft (null: none sent)
 *   BR-ORDER.readOrStored        'read' (compute on read) or 'stored' (create recomputes); null: the GET rows judged
 */
const CONTRACT = Object.freeze({
  'HR-C14': Object.freeze({ droppedRowFlagField: null, aiAfterBaselineAnswer: null, sectionField: null }),
  'HR-C17': Object.freeze({ returnToDraftRoute: null }),
  'BR-ORDER': Object.freeze({ readOrStored: null }),
});
/**
 * Which chunker path judges U5.pure.* (WP6ADJ Q3): 'product' runs AI schedule generation in process on B6X with the
 * recorder stub and reads the batches off the activity-generation calls; 'vm' evaluates chunkBoqRows's own text
 * (schedule.service.js, anchor 1x) in a vm context, a unit-level check, not live evidence. 'vm' only if the product path
 * cannot be reached in process (the integration owner switches it, recorded with the reason).
 */
const CHUNKER_PATH = 'product';
/**
 * The TEST GAPS of this proof (meta.testGaps). L121, removed by the integration-owner ruling of 2026-10-10 (the header's
 * TEST GAP L121): what was removed, why, and the code path left unproven, cited at file:line. The book leaves are named
 * for the record only; the proof reads none of them.
 */
const TEST_GAPS = Object.freeze([
  Object.freeze({
    lead: 'L121',
    rule: 'HR-C14',
    classification: 'TEST GAP',
    ruling: 'integration owner, 2026-10-10 (supersedes WP6ADJ Q4)',
    removed: Object.freeze(['section BQ', 'throwaway B6Q (company 011)', 'S.B6Q.create', 'S.B6Q.toLimit', 'S.B6Q.archived', 'KA.U6.nonAiImportAtLimit', 'every 011 session, persona and request', 'fix mutation M-C14q (KA.U6.nonAiImportAtLimit was its only catcher)']),
    reason: 'Driving 011\'s AI counter to its limit would change one of the 97 companies whose exit fingerprint is compared, on every no-flag run (the primary run, the final run and each of the 12 mutation runs), and the plan reserves 011 for entitlement cases. On 087 (Enterprise, aiLimit Infinity) assertAiQuota returns before it reads the counter, so L121 cannot be shown there either; no plan-limit switch and no SQL fixture (WP6ADJ Q4 standing rulings).',
    codePath: Object.freeze([
      'backend/src/services/boq.service.js:1174 (processBoqUpload, :1160): if (!options.dryRun) await assertAiQuota(project.orgId), before the file is parsed (:1179); the quota is asserted on every real upload, the dry run alone skips it',
      'backend/src/routes/boq.js:179: every upload without dryRun calls processBoqUpload (the dry run returns at :163-171)',
      'backend/src/middleware/subscription-gate.js:79-94: assertAiQuota answers 402 AI_LIMIT_REACHED at aiGenerationsUsed >= aiLimit (:88-93) and returns at once for an unlimited plan (:87)',
    ]),
    lines: 'at a80ccef (backend/src unchanged since 6c5ab54)',
    confirmFirst: 'CF.HRC14 classifies without it: PARTIAL, L121 its gap item',
    bookLeaves: Object.freeze(['WP6.U6.nonAiImportAtLimit', 'WP6.U6.company', 'WP6.B6Q.project', 'WP6.B6Q.team', 'WP6.B6Q.choreography']),
  }),
]);

/** The setup checks. */
const SETUP_IDS = new Set(CHECKS.filter((c) => c.id.startsWith('S.')).map((c) => c.id));
/**
 * The live catchers of the section 6.2 WP-6 guards (WP6.mutations.*, WP6ADJ Q9); the variants with them. G.5xx is the
 * harness's check (the trigger's 500 under M-CAP and M-CAPa counts through it).
 */
const CATCHERS = {
  'M-DRY': ['U1.B6.writes', 'A5.B6.dryRun'], 'M-DRYr': ['U1.B6.writes'], 'M-DRYs': ['U1.B6.writes'], 'M-DRYm': ['A5.B6.dryRun'],
  'M-CAP': ['A1.B6.overCapacity', 'A1.B6.amountOverCapacity', 'A4.B6.bulk', 'G.5xx'], 'M-CAPq': ['A1.B6.overCapacity', 'A4.B6.bulk'],
  'M-CAPa': ['A1.B6.amountOverCapacity', 'G.5xx'], 'M-CAPi': ['A5.B6.dryRun'],
  'M-XFER': ['B3.B6.overTransferPlus2'],
  'M-ORIG': ['B5.B6.lockedByLedger', 'B5.B6.lockedAfterCo'], 'M-ORIG2': ['B5.B6.lockedAfterCo'], 'M-ORIG4': ['B5.B6.lockedByLedger'],
};
/** Other checks a mutant turns red (named so a mutation result is read correctly); M-DRYq is EQUIVALENT, recorded, not run. */
// Read off the simulation (tools/sim-teeth.js: the model mutated as each mutant mutates the product; not evidence).
const COLLATERAL = {
  'M-DRY': ['U3.B6.dryRunMissingColumns and U1.B6.dryRun (the dry runs take the real path)', 'U2.B6.import (the bill already imported: comparison added 0) and U4.B6.lockFlow (three revisions superseded, not two)', 'A5.B6.apply and A5.B6.undo (the dry run already created the drafts)'],
  'M-DRYr': ['U3.B6.dryRunMissingColumns, U1.B6.dryRun, U2.B6.import, U4.B6.lockFlow'],
  'M-DRYs': ['U1.B6.dryRun, U2.B6.import, U4.B6.lockFlow (an extra applied revision before U2)'],
  'M-DRYm': ['A5.B6.apply (every pair existing: created 0)', 'A5.B6.undo'],
  'M-CAP': ['none beyond G.5xx: the trigger refuses every over-capacity write (500), the bulk\'s valid row is created as at HEAD'],
  'M-CAPq': ['none: the amount branch answers 400 ALLOCATION_AMOUNT_EXCEEDED (A1.B6.overCapacity and A4.B6.bulk red on the code)'],
  'M-CAPa': ['none: the quantity branch still refuses the over-quantity rows; only the amount-over write reaches the trigger (500, G.5xx)'],
  'M-CAPi': ['A5.B6.apply (the B-001/A120 line refused at write: failed 1)', 'A5.B6.undo unchanged (2 rejected)'],
  'M-XFER': ['B3.B6.move20000 (LAB already at -0.02)', 'KA.B3.overTransfer reads today (accepted at HEAD anyway)'],
  'M-ORIG': ['KA.B5.afterRepoint reads today under it (LA accepted either way)'],
  'M-ORIG2': ['KA.B5.afterRepoint unchanged'],
  'M-ORIG4': ['none: OVH carries no other condition'],
};
/**
 * The fix mutations (plan section 1.4, wp6-mutations-draft.json fixMutations): each puts a landed fix back, so each is run
 * only once its fix is in (FIXES set); their catchers are the fix's known answers, judged on the value from then on.
 * M-C14q (HR-C14's quota-only-for-AI change reverted) has no catcher: its only one, KA.U6.nonAiImportAtLimit, is removed
 * by the L121 ruling (TEST_GAPS); it is not run by WP-6.
 */
const FIX_CATCHERS = {
  'M-BR1': ['KA.B6.registerOrder'], 'M-C14s': ['KA.U5.B6X.sections'], 'M-C14b': ['KA.U5.B6X.aiJobCalls'], 'M-C14l': ['KA.U5.B6X.aiAfterBaseline'],
  'M-C14d': ['KA.U2.omitB005'], 'M-C17': ['KA.A2.resubmitRejected'],
};
for (const id of new Set(Object.values(FIX_CATCHERS).flat())) if (!CHECKS.some((c) => c.id === id)) throw new Error(`FIX_CATCHERS names ${id}, not a check`);
// The catchers are the book's (WP6.mutations.*: each names its catchers by check id, G21).
{
  const bookText = Object.values(WP6.mutations).map((leaf) => leaf.value.join(' ')).join(' ');
  const missing = [...new Set(Object.values(CATCHERS).flat())].filter((id) => !bookText.includes(id));
  if (missing.length) throw new Error(`WP6.mutations names no catcher ${missing.join(', ')}: CATCHERS and the book disagree (G21)`);
  for (const id of new Set(Object.values(CATCHERS).flat())) if (id !== harness.FIVE_XX_CHECK && !CHECKS.some((c) => c.id === id)) throw new Error(`CATCHERS names ${id}, not a check`);
  for (const name of Object.keys(CATCHERS)) if (!bookText.includes(`(${name},`) && !bookText.includes(`(${name}:`)) throw new Error(`WP6.mutations names no mutant ${name} (G21)`);
}

const planEntries = ACTIVE.map((c) => [
  c.id,
  c.description,
  SETUP_IDS.has(c.id) ? { setup: true } : DECIDED_RED[c.id] ? { defect: DECIDED_RED[c.id].defect, rule: DECIDED_RED[c.id].rule } : c.id.startsWith('CF.') ? { rule: CF_RULE[c.id] } : {},
]);

const h = harness.createHarness({
  name: 'wp6-boq-proof',
  plan: planEntries,
  rules: RULES,
  mailPrefix: 'wp6',
  meta: {
    plan: `${PLAN_DOC} section 4 WP-6 (:795-836), section 6.2 WP-6 guards (:1150), section 5 HR-C14 :1082, HR-C15 :1083, HR-C17 :1085, HR-C18 :1086, fix list :1113; plan lines as numbered at 6c5ab54`,
    prep: 'C:/Temp/octapm-cert/scratch/wp6/WP6-PREP.md',
    adjudication: `${WP6ADJ('Q1-Q14')} and the standing rulings it lists`,
    momentMap: 'backend/scripts/cert/cert3/build/MOMENT-MAP.md (WP-6 deviation to record when the proof lands: row 159, the AI job judged on B6X; row 154 stands)',
    answerBook: `backend/scripts/cert/cert3/answers/commercial.js @${COMMERCIAL.meta.head} + the WP-6 book patch (G1-G26)`,
    expectedChecks: EXPECTED_CHECKS,
    activeChecks: ACTIVE.length,
    filter: { only: ONLY ? [...ONLY] : null, skip: SKIP ? [...SKIP] : null, project: PROJECT_FILTER, sections: [...selectedSections], deepProjects: NEED_DEEP, live: NEED_LIVE, companies: [...NEED_COMPANIES], throwaway: { B6: NEED_B6, B6X: NEED_B6X, B6Xbill: NEED_B6X_BILL, pure: NEED_PURE } },
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
    decidedRed: DECIDED_RED,
    fixes: FIXES,
    contract: Object.fromEntries(Object.entries(CONTRACT).map(([rule, fields]) => [rule, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? `pending the ${rule} decision or fix plan` : v]))])),
    chunkerPath: CHUNKER_PATH,
    fixture: FIXTURE,
    catchers: CATCHERS,
    fixCatchers: FIX_CATCHERS,
    collateral: COLLATERAL,
    deviations: [
      'Every WP-6 writing check and every section 6.2 catcher runs on B6, the WP-6 proof\'s own throwaway in 087 (WP6ADJ Q1); MOMENT-MAP row 154 stands (B1.stored.087.original plus a live read).',
      'MOMENT-MAP row 159: WP6.U5.aiJobCalls (the count WP6.U5.aiJobCalls087) and the sections read back are judged on B6X\'s own queued job of the same 130-row, 50 / 50 / 30 shape, run in process through the recorder stub; 087-COM keeps the stored workbook moment (U5.stored.087.bill) and a live read of its sections (KA.U5.087.sections); 087-COM\'s own queued boq.parse job is never run.',
      'L121 is not judged: a TEST GAP by the integration-owner ruling of 2026-10-10 (meta.testGaps); no request, session or read leaves company 087, and CF.HRC14 reads PARTIAL with L121 its gap item.',
      'The chunker (U5.pure.*) is judged through AI schedule generation on B6X with the recorder stub (WP6ADJ Q3), B6X\'s duration set by the PM first (FIXTURE.generation).',
    ],
    equivalentMutants: 'M-DRYq (the dry run\'s quota skip at boq.service.js:1174: not a write guard; equivalent on 087, where assertAiQuota returns before the counter): recorded, not run',
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
const kaStatus = ({ ref, verdict, storedAt = null }, fixes = FIXES) => {
  const decided = RULES[ref]?.status === 'decided';
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
  const text = `${blocked ? `BLOCKED (known answer, ${ref})` : preFix ? `STORED-PRE-FIX (built ${storedAt}, before the ${ref} fix ${FIXES[ref].commit} of ${FIXES[ref].committedAt}): HEAD's pre-fix answer, reported with the register link ${ref}, not a WP-6 failure` : verdict === 'today' ? `FAIL: HEAD still gives the known answer of ${ref}, which is decided${storedAt !== null ? (FIXES[ref]?.commit ? ` (stored ${storedAt}, not before the fix commit)` : ` (no ${ref} fix commit yet)`) : ''}` : verdict === 'value' ? 'value' : `WRONG: neither the book's value nor HEAD's known answer (${ref})`}; ${detail}`;
  rec(id, ok, { expected: { value, today }, observed, detail: text });
  records[id].verdict = status;
  return verdict;
};
/** value / today / wrong from a predicate over the observation. */
const judge = (observed, isValue, isToday) => (isValue(observed) ? 'value' : isToday(observed) ? 'today' : 'wrong');
/** A KA over a leaf whose value and today are compared whole (sameJson): the commonest shape. */
const kaLeaf = (id, leaf, observed, { storedAt = null, detail = '' } = {}) => ka(id, { ref: leaf.ref, value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (x) => sameJson(x, leaf.value), (x) => sameJson(x, leaf.today)), storedAt, detail });
/**
 * R-SET: a known-answer probe in its own section. When what the probe needs cannot be set up, the probe throws: the
 * harness records a section error (a setup error, exit 1) and the check is left unrecorded ('not run'), never 'wrong'.
 */
const probe = (title, fn) => h.section(`probe: ${title}`, fn);
const probeSetup = (id, why) => new Error(`${id}: the probe's own setup failed (a setup error, not a verdict; R-SET): ${why}`);
/** A step a throwaway choreography cannot go on without: a setup error, not a verdict (as WP-1's W ... WP-5's J). */
const need = (condition, what) => {
  if (condition !== true) throw new Error(`${what}: the choreography cannot go on (a setup error, not a verdict)`);
};
/** A confirm-first item classified from this run's observations (plan section 0.0: CONFIRMED / PARTIAL / REJECTED / TEST GAP). */
const cf = (id, { present, absent, gap = [], detail = '' }) => {
  const total = present.length + absent.length + gap.length;
  const classification = total === 0 || gap.length === total ? 'TEST GAP' : present.length === 0 ? 'REJECTED' : absent.length === 0 && gap.length === 0 ? 'CONFIRMED' : 'PARTIAL';
  const rule = RULES[CF_RULE[id]];
  confirmFirst[id] = { classification, rule: CF_RULE[id], ruleStatus: rule.status, present, absent, gap, note: rule.status === 'decided' ? 'a landed fix: CONFIRMED is a failure (RED until the fix holds)' : 'an undecided rule or an unlanded fix: CONFIRMED is reported, not failed; EXPECTED BEHAVIOUR is the owner\'s call' };
  const ok = rule.status === 'decided' ? classification === 'REJECTED' : classification !== 'TEST GAP';
  rec(id, ok, { expected: rule.status === 'decided' ? 'REJECTED (fixed)' : 'CONFIRMED or REJECTED (reported)', observed: { classification, present, absent, gap }, detail: `${classification}; ${detail}` });
  return classification;
};

// -- sessions and requests --------------------------------------------------------------------------------------------
const ctx = { db: null, q: null, orgs: {}, people: {}, sessions: {}, specs: {}, b6: null, b6x: null, state: {}, deep: {}, cleanup: [], deepWrites: [], jobsCancelled: [] };
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
/** A refusal probe on a deep project: an unexpected success is recorded as a deep write (cleanup reports it). */
const deepProbe = async (code, who, method, route, body, what) => {
  const res = await send(who, method, route, body);
  if (res.status >= 200 && res.status < 300) ctx.deepWrites.push(`${code}: ${what} was ACCEPTED (${h.said(res)})`);
  return res;
};
/** A minimal one-page PDF (an instruction attached to the CO; WP-4's K precedent). */
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
/** A PDF attached to a record: its project document id (the evidence a CO names). */
const attachPdf = async (who, P, recordType, recordId, label) => {
  const res = await upload(who, `${P}/attachments`, pdf(`${label} ${h.STAMP}`, `CERT3-WP6-${label.replace(/[^A-Za-z0-9]+/g, '-')}-${h.STAMP}.pdf`), { recordType, recordId, caption: `CERT3 WP6 ${label} ${h.STAMP}` }, 'files');
  const row = listOf(res.body?.data).find((r) => r?.documentId) || null;
  need(res.status === 201 && Boolean(row?.documentId), `the ${label} PDF could not be attached to ${recordType} ${recordId} (${h.said(res)} ${res.body?.error?.message || ''})`);
  return row.documentId;
};

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
 * A throwaway made by `pm` with the book's payload (stamped name, 'not sent' fields left out) and team: { id, P, ... }.
 * Its archive is pushed to cleanup at once, so a failure later still archives it.
 */
const makeThrowaway = async ({ pm, label, project, team }) => {
  const name = String(project.name).replace('<stamp>', h.STAMP);
  const created = await send(pm, 'POST', '/projects', { ...sentOnly(project), name });
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (!id) throw new Error(`${label} could not be created: ${h.said(created)} ${created.body?.error?.message || ''}`);
  const t = { id, P: `/projects/${id}`, name, label, pm, created, shown: created.body?.data || {}, members: [], acts: {}, codes: {}, lines: {}, items: {}, alloc: {}, jobs: [], archived: null };
  ctx.cleanup.push(async () => { const a = await archive(t); return `${label} ${id} archive ${a?.said ?? 'not sent'}, archivedAt ${a?.archivedAt || 'NOT SET'}`; });
  // The team leaf's members are its string-valued keys (a persona and its project role); other keys (B6X's activities) are not members.
  for (const [key, role] of Object.entries(team).filter(([, v]) => typeof v === 'string')) {
    const res = await send(pm, 'POST', `${t.P}/team`, { userId: ctx.people[key], role });
    t.members.push({ key, role, said: h.said(res), status: res.status });
  }
  return t;
};
/** Whether a throwaway was made with its whole team (each member answered 200 or 201). */
const teamOk = (t, team) => t.members.length === Object.values(team).filter((v) => typeof v === 'string').length && t.members.every((m) => [200, 201].includes(m.status));
/** A job of a throwaway read through the product route (GET /projects/:id/jobs/:jobId, as its PM). */
const jobOf = async (t, jobId) => dataOf(t.pm, `${t.P}/jobs/${jobId}`);
/** The throwaway's queued jobs (GET /projects/:id/jobs?status=queued, as its PM). */
const queuedJobs = async (t) => listOf(await dataOf(t.pm, `${t.P}/jobs?status=queued&limit=100`), 'items');
/** Cancels every queued job of a throwaway through the product route (WP6ADJ Q11); returns { cancelled, refused, left }. */
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

// -- bills and workbooks (build/files.js, read lazily) -------------------------------------------------------------------
let filesMemo = null;
// eslint-disable-next-line global-require
const FILES = () => { if (!filesMemo) filesMemo = require('./build/files'); return filesMemo; };
/** B6's bill rows for a workbook of WP6.B6.workbooks (the FIXTURE rows, the workbook's rate and mapping-rule changes). */
const billRows = (name) => {
  const w = B6B.workbooks[name];
  return w.rows.map((code) => ({ code, description: FIXTURE.bill[code].description, unit: FIXTURE.bill[code].unit, quantity: FIXTURE.bill[code].quantity, rate: w.rates[code] === undefined ? FIXTURE.bill[code].rate : w.rates[code], mappingRule: w.mappingRules[code] || 'required', section: null }));
};
/** A B6 workbook as a file (files.boqWorkbook; the columns WP6.B6.workbooks leaves out omitted). */
const workbookFile = (name, label = name) => FILES().boqWorkbook(billRows(name), { filename: `CERT3-WP6-${label}-${h.STAMP}.xlsx`, omit: B6B.workbooks[name].omit });
/** B6X's 130-row workbook (WP6.B6X.bill: files.boqRows.filler with its prefix, seed and sections). */
const b6xRows = () => FILES().boqRows.filler({ prefix: B6XB.bill.prefix, seed: B6XB.bill.seed, sections: B6XB.bill.sections.map(([name, count]) => ({ name, count })), mappingRule: B6XB.bill.mappingRule });
/** A mapping file (boq_code, activity_code, quantity) as an xlsx file, written with the product's own xlsx library. */
const mappingFile = (rows) => {
  // eslint-disable-next-line global-require
  const XLSX = require(require.resolve('@e965/xlsx', { paths: [SRC] }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['boq_code', 'activity_code', 'quantity'], ...rows.map(([row, activity, qty]) => [row, activity, qty])]), 'Mapping');
  return { filename: `CERT3-WP6-mapping-${h.STAMP}.xlsx`, body: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
};

// -- reads on a throwaway ----------------------------------------------------------------------------------------------
/** The write counters of a project (read-only counts; WP6.U1.writes, WP6.U3.dryRunWrites / realUploadWrites keys). */
const counters = async (projectId, orgId) => {
  const row = (await ctx.q(`select
      (select count(*)::int from "BoqItem" where "projectId" = $1) as "boqItems",
      (select count(*)::int from "BoqRevision" where "projectId" = $1) as "boqRevisions",
      (select count(*)::int from "ProjectDocument" where "projectId" = $1 and "documentType" = 'boq_upload') as "projectDocuments",
      (select count(*)::int from "BackgroundJob" where "projectId" = $1 and type = 'boq.parse') as "boqParseJobs",
      (select count(*)::int from "ActivityBoqAllocation" where "projectId" = $1) as "allocations",
      (select "aiGenerationsUsed" from "Subscription" where "orgId" = $2) as "aiGenerationsUsed"`, [projectId, orgId]))[0] || {};
  return row;
};
/** A company's AI generation counter (read only). */
const aiUsedOf = async (orgId) => (await ctx.q('select "aiGenerationsUsed" as n from "Subscription" where "orgId" = $1', [orgId]))[0]?.n ?? null;
/** The change of each counter between two reads, for the keys a leaf names (aiGenerationsUsedDelta for the AI counter). */
const deltaOf = (before, after, keys) => Object.fromEntries(keys.map((k) => (k === 'aiGenerationsUsedDelta' ? [k, (after.aiGenerationsUsed ?? 0) - (before.aiGenerationsUsed ?? 0)] : [k, (after[k] ?? 0) - (before[k] ?? 0)])));
/** The newest boq_upload document of a project (status, linkedEntityType). */
const newestBoqDocument = async (projectId) => (await ctx.q('select status, "linkedEntityType" from "ProjectDocument" where "projectId" = $1 and "documentType" = \'boq_upload\' order by "createdAt" desc limit 1', [projectId]))[0] || null;
/** GET /boq: { items (active rows), revisions, baseline, currentRevision }. */
const boqOf = async (who, P) => dataOf(who, `${P}/boq`);
const activeItems = (boq) => listOf(boq, 'items').filter((i) => i.isActive !== false);
const sumAmounts = (rows) => rows.reduce((s, r) => s + (cents(r.amount) ?? NaN), 0);
/** The allocations of a project (GET activity-boq-allocations?includeInactive=true), keyed by row/activity code. */
const allocationsOf = async (who, P) => listOf(await dataOf(who, `${P}/activity-boq-allocations?includeInactive=true`), 'allocations');
const allocKey = (a) => `${a.boqItem?.code ?? a.boqItemId}/${a.activity?.activityCode ?? a.activityId}`;
const allocBrief = (a) => ({ key: allocKey(a), status: a.status, isActive: a.isActive, quantity: num(a.quantity), amount: cents(a.amount), importBatchId: a.importBatchId ?? null, source: a.source ?? null, suggestedBy: a.suggestedBy ?? null });
/** The count of each section on BOQ rows ('(none)' for a row with none; the CONTRACT names the field once HR-C14 is decided). */
const sectionCounts = (rows) => {
  const field = CONTRACT['HR-C14'].sectionField || 'section';
  const out = {};
  for (const r of rows) { const s = typeof r[field] === 'string' && r[field].trim() ? r[field].trim() : '(none)'; out[s] = (out[s] || 0) + 1; }
  return out;
};
/** Coverage by section as { label: itemCount } ('Unassigned' read as '(none)', the leaf's word for no section). */
const coverageSections = (coverage) => Object.fromEntries(listOf(coverage?.groups, 'groups').map((g) => [g.key === '__none__' ? '(none)' : g.label, g.itemCount]));
/** The budget lines of a project (GET budget/lines, includeArchived when asked) as the cost controller. */
const linesOf = async (P, { includeArchived = false } = {}) => dataOf('cost', `${P}/budget/lines${includeArchived ? '?includeArchived=true' : ''}`);
const recon = async (P) => dataOf('cost', `${P}/cost/reconciliation`);
/** A 409 BUDGET_ORIGINAL_LOCKED's conditions as [{ condition, number }] (the reason is free text). */
const conditionsOf = (res) => listOf(res.body?.error?.details?.conditions).map((c) => ({ condition: c.condition, number: c.number }));

// -- the AI recorder stub (WP6ADJ Q2) -------------------------------------------------------------------------------------
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const hostOf = (target) => {
  try {
    if (typeof target === 'string') return new URL(target).hostname;
    if (target instanceof URL) return target.hostname;
    if (target && typeof target === 'object') return target.hostname || String(target.host || '').split(':')[0] || null;
  } catch {
    return '(unparsed)';
  }
  return null;
};
/** The text of a message create's body (system and user content). */
const bodyText = (body) => [body?.system, ...(body?.messages || []).map((m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content)))].filter(Boolean).join('\n');
/** Which product call a message create is, from its prompt (boq.service and schedule.service at 6c5ab54). */
const recorderKind = (body) => {
  const text = bodyText(body);
  if (text.includes('BOQ ITEMS:') && text.includes('boqActivities')) return 'boq-job';
  if (text.includes('You are a BOQ parser')) return 'schedule-structure';
  if (text.includes('Generate a CPM schedule')) return 'schedule-activities';
  if (text.includes('Generate supporting risk and procurement data')) return 'schedule-support';
  if (text.includes('construction resource planner')) return 'schedule-resources';
  return 'unknown';
};
/** The BOQ rows one BOQ AI job prompt carries (buildBoqActivityPrompt: the JSON array after "BOQ ITEMS:"). */
const boqJobRows = (body) => {
  const m = /BOQ ITEMS:\n([\s\S]*?)\n\nRespond ONLY/.exec(bodyText(body));
  if (!m) return null;
  try { const rows = JSON.parse(m[1]); return Array.isArray(rows) ? rows.length : null; } catch { return null; }
};
/** The BOQ rows one activity-generation prompt carries (generateActivities: "BOQ (n items):"). */
const scheduleBatchRows = (body) => { const m = /BOQ \((\d+) items\):/.exec(bodyText(body)); return m ? Number(m[1]) : null; };
const OUTBOUND = 'CERT3 WP6 recorder: an outbound request during the stub window was refused';
/**
 * Runs `fn` with the recorder installed: Anthropic.Messages.prototype.create answers `answers[kind]` (an object, a string
 * or a function of the body) and makes no network call; fetch, http(s).request / get and the undici global dispatcher
 * refuse and count any non-loopback request. Everything is restored in finally. Returns fn's result; the window
 * ({ calls, outbound, unknown, guards }) is kept in obs.recorder under `label`.
 */
const withRecorder = async (label, answers, fn) => {
  // eslint-disable-next-line global-require
  const sdk = require(require.resolve('@anthropic-ai/sdk', { paths: [SRC] }));
  const Messages = sdk?.Anthropic?.Messages;
  if (!Messages?.prototype || typeof Messages.prototype.create !== 'function') throw probeSetup(label, 'the AI client\'s Messages.create could not be found to replace');
  // eslint-disable-next-line global-require
  const http = require('http');
  // eslint-disable-next-line global-require
  const https = require('https');
  const win = { label, calls: [], outbound: [], unknown: 0, guards: {} };
  const note = (via, target) => { const host = hostOf(target); if (!host || !LOOPBACK.has(String(host).toLowerCase())) { win.outbound.push({ via, host }); return true; } return false; };
  const originalCreate = Messages.prototype.create;
  const saved = { fetch: globalThis.fetch, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get };
  const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')] || null;
  const savedDispatch = dispatcher && typeof dispatcher.dispatch === 'function' ? dispatcher.dispatch : null;
  Messages.prototype.create = function recordedCreate(body) {
    const kind = recorderKind(body);
    const rows = kind === 'boq-job' ? boqJobRows(body) : kind === 'schedule-activities' ? scheduleBatchRows(body) : null;
    win.calls.push({ kind, model: body?.model ?? null, maxTokens: body?.max_tokens ?? null, rows });
    if (kind === 'unknown' || answers[kind] === undefined) {
      win.unknown += 1;
      return Promise.reject(new Error(`CERT3 WP6 recorder: an AI call of kind ${kind} the proof did not script`));
    }
    const answer = typeof answers[kind] === 'function' ? answers[kind](body) : answers[kind];
    const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
    return Promise.resolve({ id: `msg_cert3_wp6_${win.calls.length}`, type: 'message', role: 'assistant', model: body?.model ?? null, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } });
  };
  globalThis.fetch = function guardedFetch(input, init) {
    if (note('fetch', typeof input === 'string' || input instanceof URL ? input : input?.url)) return Promise.reject(new Error(OUTBOUND));
    return saved.fetch.call(this, input, init);
  };
  const guard = (mod, key, via) => {
    const original = mod[key];
    mod[key] = function guardedRequest(...args) {
      if (note(via, args[0])) throw new Error(OUTBOUND);
      return original.apply(this, args);
    };
  };
  guard(http, 'request', 'http.request');
  guard(http, 'get', 'http.get');
  guard(https, 'request', 'https.request');
  guard(https, 'get', 'https.get');
  if (savedDispatch) {
    dispatcher.dispatch = function guardedDispatch(options, handler) {
      if (note('undici', options?.origin ? String(options.origin) : null)) throw new Error(OUTBOUND);
      return savedDispatch.call(this, options, handler);
    };
  }
  win.guards = { create: true, fetch: true, http: true, https: true, undici: Boolean(savedDispatch) };
  try {
    return await fn(win);
  } finally {
    Messages.prototype.create = originalCreate;
    globalThis.fetch = saved.fetch;
    http.request = saved.httpRequest;
    http.get = saved.httpGet;
    https.request = saved.httpsRequest;
    https.get = saved.httpsGet;
    if (savedDispatch) dispatcher.dispatch = savedDispatch;
    win.restored = Messages.prototype.create === originalCreate && globalThis.fetch === saved.fetch && http.request === saved.httpRequest && https.request === saved.httpsRequest;
    obs.recorder = obs.recorder || {};
    obs.recorder[label] = { calls: win.calls, outbound: win.outbound, unknown: win.unknown, guards: win.guards, restored: win.restored };
  }
};
/** The recorder was the only AI path: no unscripted call, no outbound request, restored (else a setup error, R-SET). */
const assertOnlyPath = (id, win, { kinds }) => {
  if (win.unknown || win.outbound.length || win.calls.some((c) => !kinds.includes(c.kind))) throw probeSetup(id, `the recorder saw ${win.unknown} unscripted call(s), ${win.outbound.length} outbound request(s) (${json(win.outbound)}), kinds ${json(win.calls.map((c) => c.kind))}`);
};
// eslint-disable-next-line global-require
const boqService = () => require(path.join(SRC, 'services', 'boq.service.js'));
// eslint-disable-next-line global-require
const scheduleService = () => require(path.join(SRC, 'services', 'schedule.service.js'));
/** The job as the product's job handler receives it (jobs/worker passes the row; the handlers read these fields). */
const handlerJob = (job) => ({ id: job.id, orgId: job.orgId, projectId: job.projectId, type: job.type, requestedBy: job.requestedBy ?? null });
/**
 * Runs a throwaway's queued boq.parse job through runBoqActivityJob, called directly (never claimNextJob), with the recorder
 * answering `answer` to the job's prompt(s): { result, error, calls (rows per call) }. The job must be this throwaway's
 * queued boq.parse job (else a setup error).
 */
const runBoqJob = async (id, t, jobId, answer, label) => {
  const job = await jobOf(t, jobId);
  if (!job || job.type !== 'boq.parse' || job.status !== 'queued' || job.projectId !== t.id) throw probeSetup(id, `job ${jobId} is not ${t.label}'s queued boq.parse job (${json({ type: job?.type, status: job?.status, projectId: job?.projectId })})`);
  return withRecorder(label, { 'boq-job': answer }, async (win) => {
    let result = null;
    let error = null;
    try {
      result = await boqService().runBoqActivityJob({ job: handlerJob(job), payload: job.payload });
    } catch (e) {
      error = { code: e?.code ?? null, message: String(e?.message || e).slice(0, 300) };
    }
    assertOnlyPath(id, win, { kinds: ['boq-job'] });
    return { result, error, calls: win.calls.filter((c) => c.kind === 'boq-job').map((c) => c.rows) };
  });
};

// -- static scans of backend/src (read only; tests, live suites and mocks excluded) ------------------------------------
const srcText = (rel) => { try { return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
/** The text of a top-level function or const declaration, up to the next top-level declaration (null when not found). */
const declOf = (rel, name) => {
  const text = srcText(rel);
  if (text === null) return null;
  const lines = text.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^(?:async function ${name}\\(|function ${name}\\(|const ${name}\\s*=)`).test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j += 1) if (/^(?:const|let|function|async function|module\.exports)\b/.test(lines[j])) { end = j; break; }
  return lines.slice(start, end).join('\n');
};
const stripComments = (text) => String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** The array literal of a `const NAME = [...]` or `Object.freeze([...])` on one line (null when not found). */
const constList = (rel, name) => {
  const text = srcText(rel);
  const m = text === null ? null : new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(text);
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : null;
};
/** The confirm-first items read from the source: null where the file or the declaration is not found (a gap, never a guess). */
const staticScan = () => {
  const parser = srcText('services/boq/excel-parser.js');
  const optional = parser === null ? null : (/const OPTIONAL_HEADERS = \{([\s\S]*?)\};/.exec(parser) || [])[1] ?? null;
  const required = parser === null ? null : (/const REQUIRED_HEADERS = \[([^\]]*)\]/.exec(parser) || [])[1] ?? null;
  const job = declOf('services/boq.service.js', 'runBoqActivityJob');
  const create = declOf('services/budget-revision.service.js', 'createBudgetRevision');
  const boqRoutes = srcText('routes/boq.js');
  return {
    parserReadsSection: optional === null || required === null ? null : /section/i.test(optional) || /section/i.test(required),
    boqJobCreateCalls: job === null ? null : (stripComments(job).match(/messages\.create\(/g) || []).length,
    boqJobBatches: job === null ? null : /chunkBoqRows|for \([^)]*batch/i.test(stripComments(job)),
    createRevisionRecomputes: create === null ? null : /recomputeCumulative|\$transaction/.test(stripComments(create)),
    budgetCostTypes: constList('services/budget.service.js', 'COST_TYPES'),
    costRecordCategoryFields: constList('services/cost.service.js', 'CATEGORY_FIELDS'),
    templateGuard: boqRoutes === null ? null : /'\/template',\s*\n\s*authenticate,\s*\n\s*CAN_MODIFY,/.test(boqRoutes) && /const CAN_MODIFY = requireRoles\('pm', 'planning_eng', 'qs'\)/.test(boqRoutes),
  };
};
/** chunkBoqRows's own text evaluated in a vm context (WP6ADJ Q3's fallback: a unit-level check, not live evidence). */
const vmChunker = () => {
  const text = srcText('services/schedule.service.js');
  if (text === null) throw new Error('schedule.service.js not found');
  const anchor = 'function chunkBoqRows(';
  if (text.split(anchor).length - 1 !== 1) throw new Error(`the chunkBoqRows anchor is found ${text.split(anchor).length - 1} times (1x expected)`);
  const start = text.indexOf(anchor);
  let depth = 0;
  let end = -1;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('the chunkBoqRows body has no closing brace');
  return vm.runInNewContext(`${text.slice(start, end)}\n;chunkBoqRows`, {});
};

// -- the chunker scenarios (WP6.U5.chunk*, claudeMd.boqChunk; WP6ADJ Q3) ---------------------------------------------------
/** Each U5.pure check's input, read from the book: the row count or the sections, and the expected batch sizes. */
const CHUNK_SCENARIOS = (() => {
  const keys = Object.keys(CLAUDE_MD.boqChunk.value);
  const bare = (leaf) => Number((/^(\d+) rows/.exec(leaf.derivation) || [])[1]);
  const sectioned = (key) => key.split('/').map(Number);
  const plain = keys.find((k) => /^\d+$/.test(k));
  const b6xNames = B6XB.bill.sections.map(([name]) => name);
  const s505030 = sectioned('50/50/30');
  const s7045 = sectioned('70/45');
  const scenarios = {
    'U5.pure.chunk130': { leaf: WP6.U5.chunk130, rows: Number(plain), sections: null, claudeMd: CLAUDE_MD.boqChunk.value[plain] },
    'U5.pure.chunk505030': { leaf: WP6.U5.chunkSections505030, rows: null, sections: s505030.map((n, i) => [b6xNames[i], n]), claudeMd: CLAUDE_MD.boqChunk.value['50/50/30'] },
    'U5.pure.chunk7045': { leaf: WP6.U5.chunkSections7045, rows: null, sections: s7045.map((n, i) => [FIXTURE.sections7045[i], n]), claudeMd: CLAUDE_MD.boqChunk.value['70/45'] },
    'U5.pure.chunk60': { leaf: WP6.U5.chunk60, rows: bare(WP6.U5.chunk60), sections: null, claudeMd: null },
    'U5.pure.chunk61': { leaf: WP6.U5.chunk61, rows: bare(WP6.U5.chunk61), sections: null, claudeMd: null },
  };
  for (const [id, s] of Object.entries(scenarios)) {
    const total = s.rows ?? s.sections.reduce((t, [, n]) => t + n, 0);
    if (!Number.isInteger(total) || total <= 0 || (s.sections && s.sections.some(([name]) => !name))) throw new Error(`answer book: ${id} names no input (rows ${s.rows}, sections ${json(s.sections)})`);
    if (s.claudeMd && !sameJson(s.claudeMd, s.leaf.value)) throw new Error(`answer book: ${id} disagrees with claudeMd.boqChunk`);
  }
  return scenarios;
})();
/** A scenario's rows as the structuring answer supplies them (no section: the product files them under one default section). */
const scenarioRows = (s) => {
  const make = (i, section) => ({ ref: `P-${String(i).padStart(3, '0')}`, description: `CERT3 WP6 chunk row ${i}`, unit: 'm2', qty: 1, rate: 1, amount: 1, ...(section ? { section } : {}) });
  if (s.sections) { let i = 0; return s.sections.flatMap(([name, n]) => Array.from({ length: n }, () => { i += 1; return make(i, name); })); }
  return Array.from({ length: s.rows }, (_, k) => make(k + 1, null));
};
/** The batch sizes a list of rows gives through the vm-evaluated chunker (the fallback path). */
const vmBatches = (fn, rows) => fn(rows.map((r) => ({ ...r, section: r.section || undefined })), 60).map((b) => b.length);

// -- stored moments (pure over a state file and the book; exported for the static simulation) ------------------------
const findingsOf = (st) => (Array.isArray(st?.findings) ? st.findings : []);
/** 087-COM's WP-6 build moments: the bill (row 159's workbook moment) and the budget lines' original (row 154). */
const storedCom087 = (st) => {
  const out = {};
  const boq = st?.steps?.boq;
  const workbook = boq?.out?.sections?.workbook || {};
  const readBack = boq?.out?.sections?.readBack || {};
  const rows = boq?.out?.rows ?? null;
  const hrc14 = findingsOf(st).some((f) => f.ref === 'HR-C14' && f.step === 'boq');
  // Either no section read back with the HR-C14 finding kept (today), or the workbook's sections read back without it
  // (after the fix): the stored check asserts the workbook moment and that pair's coherence, never which of the two holds.
  const coherent = (sameJson(readBack, { '(none)': rows }) && hrc14) || (sameJson(readBack, workbook) && !hrc14);
  const bo = { step: boq?.status ?? 'not run', rows, workbookSizes: Object.values(workbook), workbookSections: Object.keys(workbook).length, readBackAndFindingCoherent: coherent };
  const be = { step: 'done', rows: D087.boqRows.value, workbookSizes: D087.boqSections.value.sizes, workbookSections: D087.boqSections.value.count, readBackAndFindingCoherent: true };
  out['U5.stored.087.bill'] = { ok: sameJson(bo, be), expected: be, observed: { ...bo, workbook, readBack, hrc14Finding: hrc14 }, detail: 'the step done means the build asserted the generated workbook\'s three sections of 50 / 50 / 30 and the 130 rows read back (build/087-com.js step boq; MOMENT-MAP row 159)' };
  const bl = st?.steps?.['budget-lines'];
  const lo = { step: bl?.status ?? 'not run', originalCents: bl?.out?.originalCents ?? null };
  const le = { step: 'done', originalCents: WP6.B1.original.value };
  out['B1.stored.087.original'] = { ok: sameJson(lo, le), expected: le, observed: lo, detail: 'the build asserted the budget\'s original against WP6.B1.original (MOMENT-MAP row 154)' };
  out.boqStoredAt = stepAt(st, 'boq');
  out.hrc14Finding = hrc14;
  return out;
};

// -- setup --------------------------------------------------------------------------------------------------------------
/** The build steps whose stored outputs (moment answers and ids) the proof reads, per state file. */
const STATE_STEPS = {
  '087-COM': ['cost-codes', 'budget-lines', 'boq', 'allocations'],
  '087-SCH': ['boq.upload', 'baseline'],
};
/** The personas: 087's alone (the L121 ruling, 2026-10-10: no session in any other company). */
const PERSONAS = {
  pm: ['087', 'pm'], planner: ['087', 'planner'], qs: ['087', 'qs'], cost: ['087', 'cost'], finance: ['087', 'finance'], site: ['087', 'site'],
};
if (Object.values(PERSONAS).some(([code]) => !NEED_COMPANIES.includes(code))) throw new Error('a persona outside company 087: the L121 ruling allows no other company');
/** The leaves the 10 KA checks read (their book keys): each must carry a today and a ref and be an assumption (KA.I9 ruling). */
const KA_KEYS = [...new Set(CHECKS.filter((c) => c.id.startsWith('KA.')).map((c) => c.bookKey))];

const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  // S.book: the load guard above passed (the WP-6 leaves exist with their patched values); figures() carries ref.
  const rows = COMMERCIAL.figures();
  const withRef = rows.filter((row) => Object.prototype.hasOwnProperty.call(row, 'ref') && row.ref).length;
  const kaBad = KA_KEYS.filter((key) => { const leaf = leafAt(key); return !leaf || !leaf.ref || leaf.today === undefined || leaf.assumption !== true || sameJson(leaf.value, leaf.today); });
  rec('S.book', rows.length > 0 && withRef > 0 && WP6_PATCH_LEAVES.every((key) => leafAt(key)) && kaBad.length === 0, { observed: { head: COMMERCIAL.meta.head, figures: rows.length, withRef, patchLeaves: WP6_PATCH_LEAVES.length, kaLeaves: KA_KEYS.length, kaBad }, detail: `answers/commercial.js @${COMMERCIAL.meta.head} + the WP-6 patch: ${rows.length} figures, ${withRef} with a ref; the FIXTURE bill agreed with every leaf at load` });

  // companies and personas
  const specs = Object.fromEntries(h.companies(...NEED_COMPANIES).map((c) => [c.code, c]));
  ctx.specs = specs;
  const problems = [];
  for (const code of NEED_COMPANIES) {
    const found = await ctx.q('select id, slug, name from "Organisation" where slug like $1', [`cert-${code}-%`]);
    if (found.length !== 1) { problems.push(`company ${code}: ${found.length} organisations, exactly one expected`); continue; }
    try { ctx.orgs[code] = certEnv.assertCertOrganisation(found[0]) || found[0]; } catch (error) { problems.push(`company ${code}: ${error.message}`); }
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
      for (const step of STATE_STEPS[code]) {
        const st = ctx.state[code].steps?.[step];
        if (st?.status !== 'done') stateProblems.push(`${code}: step ${step} is ${st?.status || 'not run'}`);
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
  rec('S.state', stateProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.state).map(([c, s]) => [c, { projectId: s.projectId, runs: s.runs?.length, updatedAt: s.updatedAt, findings: findingsOf(s).map((f) => `${f.ref}@${f.step}`) }])), detail: stateProblems.join('; ') || `${NEED_DEEP.length} state files (${NEED_DEEP.join(', ') || 'none needed'}), every needed step done; fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}` });

  // S.projects: the deep projects by their exact names, through the API as the 087 PM.
  const projectProblems = [...problems];
  for (const [code, { name }] of Object.entries(DEEP).filter(([code]) => NEED_DEEP.includes(code))) {
    if (!ctx.sessions.pm) { projectProblems.push(`${code}: no session for pm`); continue; }
    const page = await get('pm', `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(name)}`);
    const live = listOf(page.body?.data).filter((p) => p.name === name && !p.archivedAt);
    if (page.status !== 200) projectProblems.push(`${code}: GET /projects ${h.said(page)}`);
    else if (live.length !== 1) projectProblems.push(`${code}: ${live.length} live projects named "${name}" (${live.map((p) => p.id).join(', ')})`);
    else {
      ctx.deep[code] = { id: live[0].id, P: `/projects/${live[0].id}` };
      if (ctx.state[code] && ctx.state[code].projectId !== live[0].id) projectProblems.push(`${code}: the live project ${live[0].id} is not the state file's ${ctx.state[code].projectId} (restore and rebuild, or stale state)`);
    }
  }
  rec('S.projects', projectProblems.length === 0, { observed: { orgs: Object.fromEntries(Object.entries(ctx.orgs).map(([c, o]) => [c, { id: o.id, slug: o.slug }])), people: Object.keys(ctx.people), projects: Object.fromEntries(Object.entries(ctx.deep).map(([c, d]) => [c, d.id])) }, detail: projectProblems.join('; ') || `${NEED_COMPANIES.length} companies (${NEED_COMPANIES.join(', ')}), ${Object.keys(ctx.people).length} sessions, ${NEED_DEEP.length} deep projects (${NEED_DEEP.join(', ') || 'none needed'}), one live each, matching the state` });
  if (projectProblems.length || stateProblems.length) throw new Error(`setup: ${[...stateProblems, ...projectProblems].join('; ')}`);
  // 087's AI counter before the run (Q11's recorded residue: B6X's two handler runs add 2).
  obs.ai087 = { before: await aiUsedOf(ctx.orgs['087'].id) };
};

// -- B6: B0-B1, the project, its team, activities and cost codes (S.B6.create, S.B6.fixture) ----------------------------
const b6Setup = async () => {
  const t = await makeThrowaway({ pm: 'pm', label: 'B6', project: B6B.project, team: B6B.team });
  ctx.b6 = t;
  const createdOk = t.created.status === 201 && teamOk(t, B6B.team) && cents(t.shown.contractValue) === cents(B6B.project.contractValue)
    && Number(t.shown.defaultRetentionRate) === B6B.project.defaultRetentionRate && t.shown.currency === B6B.project.currency;
  rec('S.B6.create', createdOk, { expected: { project: B6B.project, team: B6B.team }, observed: { id: t.id, said: h.said(t.created), contractValue: t.shown.contractValue ?? null, defaultRetentionRate: t.shown.defaultRetentionRate ?? null, currency: t.shown.currency ?? null, team: t.members }, detail: 'contractValue 2,000,000.00 is the register\'s base (WP6.B6.BR-B); explicit defaultRetentionRate 10, so WP-6 never depends on HR-C1' });
  need(createdOk, 'B0: B6 or its team could not be made');
  const made = [];
  for (const [i, code] of B6B.fixture.activities.entries()) {
    const res = await send('planner', 'POST', `${t.P}/activities`, { name: `CERT3 WP6 ${code} ${h.STAMP}`, activityCode: code, wbsCode: 'WP6-B6', category: 'civil', startDate: FIXTURE.activityStart, endDate: FIXTURE.activityEnd, sortOrder: i, engineerIds: [ctx.people.site] });
    t.acts[code] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push([code, h.said(res)]);
  }
  const library = await dataOf('cost', `${t.P}/budget/cost-codes`);
  const found = {};
  for (const code of B6B.fixture.costCodes) {
    const hits = listOf(library?.available).filter((c) => c.code === code);
    found[code] = hits.length;
    t.codes[code] = hits.length === 1 ? hits[0].id : null;
  }
  const select = B6B.fixture.costCodes.every((code) => t.codes[code]) ? await send('cost', 'PUT', `${t.P}/budget/cost-codes`, { costCodeIds: B6B.fixture.costCodes.map((code) => t.codes[code]) }) : null;
  const onB6 = select?.status === 200 ? listOf(select.body?.data, 'items').filter((r) => r.status === 'active').map((r) => r.code).sort() : [];
  const fixtureOk = made.every(([, said]) => said === '201') && Object.values(found).every((n) => n === 1) && select?.status === 200 && sameJson(onB6, [...B6B.fixture.costCodes].sort());
  rec('S.B6.fixture', fixtureOk, { expected: B6B.fixture, observed: { activities: made, found, select: select ? h.said(select) : 'not sent', onB6 }, detail: 'company codes are the company administrator\'s (HR-A1): B6 selects the 087 library codes the 087-COM build found or made and creates none' });
  need(fixtureOk, 'B1: B6\'s activities or cost codes could not be set up');
};

// -- B6: B2, the dry runs, the refused uploads, the import (U1, U3, U7, U2) ----------------------------------------------
const uploadLabel = (what) => `CERT3 WP6 ${what} ${h.STAMP}`;
const b6Bill = async () => {
  const t = ctx.b6;
  const org = ctx.orgs['087'].id;
  const read = () => counters(t.id, org);
  const c0 = await read();
  // U3: the planner's dry run without the rate column
  const md = await upload('planner', `${t.P}/boq/upload?dryRun=true`, workbookFile('missingRate', 'missing-rate-dry'), { label: uploadLabel('missing rate dry run') });
  const c1 = await read();
  const mdCode = md.body?.error?.details?.errors?.[0]?.code ?? null;
  const d1 = deltaOf(c0, c1, Object.keys(WP6.U3.dryRunWrites.value));
  rec('U3.B6.dryRunMissingColumns', h.is(md, saidOf(WP6.U3.missingColumns)) && mdCode === WP6.U3.detailCode.value && sameJson(d1, WP6.U3.dryRunWrites.value), { expected: { said: saidOf(WP6.U3.missingColumns), detailCode: WP6.U3.detailCode.value, writes: WP6.U3.dryRunWrites.value }, observed: { said: h.said(md), detailCode: mdCode, writes: d1 }, detail: 'refused in the parse-and-validate step, before the dry-run return and any write (boq.service.js:1177-1228)' });
  // U1: the planner's dry run of the stage-3 workbook, and the counters around it
  const dry = await upload('planner', `${t.P}/boq/upload?dryRun=true`, workbookFile('stage3', 'stage3-dry'), { label: uploadLabel('stage-3 dry run') });
  const c2 = await read();
  const dd = dry.body?.data || {};
  const ds = dd.comparison?.summary || {};
  const u1o = { status: dry.status, dryRun: dd.dryRun === true, mode: dd.mode ?? null, rowCount: dd.rowCount ?? null, totalAmount: cents(dd.totalAmount), comparison: { added: ds.added ?? null, updated: ds.updated ?? null, removed: ds.removed ?? null } };
  const u1e = { status: 200, dryRun: true, mode: WP6.U2.importStatus.value, rowCount: STAGE3.boqRowCount.value, totalAmount: WP6.U1.dryRunTotal.value, comparison: WP6.U1.comparison.value };
  rec('U1.B6.dryRun', sameJson(u1o, u1e), { expected: u1e, observed: u1o, detail: 'the dry run reports the mode the real upload would take on an empty bill (WP6.U2.importStatus)' });
  const d2 = deltaOf(c1, c2, Object.keys(WP6.U1.writes.value));
  rec('U1.B6.writes', sameJson(d2, WP6.U1.writes.value), { expected: WP6.U1.writes.value, observed: { writes: d2, before: c1, after: c2 }, detail: 'read-only counts on B6 and 087\'s Subscription.aiGenerationsUsed; the catcher of M-DRY / M-DRYr / M-DRYs (writes only on B6)' });
  obs.uploaders = { planner: h.said(dry) };
  // U7: the site engineer's real upload
  const su = await upload('site', `${t.P}/boq/upload`, workbookFile('stage3', 'stage3-site'), { label: uploadLabel('site engineer upload') });
  const c3 = await read();
  const d3 = deltaOf(c2, c3, Object.keys(WP6.U3.dryRunWrites.value));
  rec('U7.B6.siteUpload', h.is(su, saidOf(WP6.U7.siteUpload)) && sameJson(d3, WP6.U3.dryRunWrites.value), { expected: { said: saidOf(WP6.U7.siteUpload), writes: WP6.U3.dryRunWrites.value }, observed: { said: h.said(su), writes: d3 }, detail: 'requireRoles(pm, planning_eng, qs) refuses before the file is read (routes/boq.js:72; G25); nothing written, judged on WP6.U3.dryRunWrites\' write vector' });
  // U3: the QS's real upload without the rate column (the kept rejected document, WP6ADJ Q5)
  const linesBefore = await linesOf(t.P, { includeArchived: true });
  const mu = await upload('qs', `${t.P}/boq/upload`, workbookFile('missingRate', 'missing-rate-real'), { label: uploadLabel('missing rate upload') });
  const c4 = await read();
  const linesAfter = await linesOf(t.P, { includeArchived: true });
  const doc = await newestBoqDocument(t.id);
  const d4 = deltaOf(c3, c4, ['boqItems', 'boqRevisions', 'boqParseJobs', 'allocations', 'projectDocuments']);
  const ruo = { boqItems: d4.boqItems, boqRevisions: d4.boqRevisions, boqParseJobs: d4.boqParseJobs, allocations: d4.allocations, budgetSummaryChanged: !sameJson(linesBefore?.summary ?? null, linesAfter?.summary ?? null), projectDocuments: d4.projectDocuments, document: { status: doc?.status ?? null, linkedEntityType: doc?.linkedEntityType ?? null } };
  const muCode = mu.body?.error?.details?.errors?.[0]?.code ?? null;
  rec('U3.B6.uploadMissingColumns', h.is(mu, saidOf(WP6.U3.missingColumns)) && muCode === WP6.U3.detailCode.value && sameJson(ruo, WP6.U3.realUploadWrites.value), { expected: { said: saidOf(WP6.U3.missingColumns), detailCode: WP6.U3.detailCode.value, writes: WP6.U3.realUploadWrites.value }, observed: { said: h.said(mu), detailCode: muCode, writes: ruo }, detail: 'the route stores the file before parsing (routes/boq.js:173-178) and the refusal marks it rejected with the error code (boq.service.js:1217-1228): EXPECTED BEHAVIOUR provisionally (WP6ADJ Q5); no BOQ row, revision, job or allocation written and no budget figure moved' });
  // U2: the QS's import of the stage-3 workbook
  const im = await upload('qs', `${t.P}/boq/upload`, workbookFile('stage3', 'stage3-import'), { label: uploadLabel('stage-3 import') });
  const c5 = await read();
  const id = im.body?.data || {};
  t.jobs.push(id.jobId || null);
  t.u2Document = id.document?.documentId || null;
  const boq = await boqOf('qs', t.P);
  const items = activeItems(boq);
  for (const i of items) t.items[i.code] = i.id;
  const job = id.jobId ? await jobOf(t, id.jobId) : null;
  const ic = id.comparison || {};
  const u2o = { status: im.status, mode: id.mode ?? null, comparison: { added: ic.added ?? null, updated: ic.updated ?? null, removed: ic.removed ?? null }, rows: items.length, total: sumAmounts(items), currentRevision: boq?.currentRevision?.status ?? null, jobStatus: job?.status ?? null, jobsQueued: c5.boqParseJobs - c4.boqParseJobs, document: Boolean(t.u2Document) };
  const u2e = { status: 200, mode: WP6.U2.importStatus.value, comparison: WP6.U1.comparison.value, rows: STAGE3.boqRowCount.value, total: STAGE3.boqTotal.value, currentRevision: WP6.U2.importStatus.value, jobStatus: 'queued', jobsQueued: 1, document: true };
  rec('U2.B6.import', sameJson(u2o, u2e), { expected: u2e, observed: u2o, detail: 'a fresh bill: five rows added (WP6.U1.comparison); the boq.parse job stays queued (no worker in process) until Q11 cancels it' });
  obs.uploaders.qs = h.said(im);
  need(im.status === 200 && items.length === STAGE3.boqRowCount.value, 'B2: the stage-3 bill could not be imported on B6');
};

// -- B6: B3, the allocations (A1-A6) -------------------------------------------------------------------------------------
const b6Allocations = async () => {
  const t = ctx.b6;
  const org = ctx.orgs['087'].id;
  const AP = `${t.P}/activity-boq-allocations`;
  const MR = `${AP}/mapping-rules`;
  const item = (code) => t.items[code] || null;
  const act = (code) => (code === 'X-A1' ? ctx.b6x?.acts?.['X-A1'] || null : t.acts[code] || null);
  const create = (who, row, activity, qty, extra = {}) => send(who, 'POST', AP, { boqItemId: item(row), activityId: act(activity), quantity: qty, ...extra });
  const verb = (who, id, v, body = {}) => send(who, 'POST', `${AP}/${id}/${v}`, body);
  const allocations = async () => (await counters(t.id, org)).allocations;
  const approved = WP6.A2.approved.value;
  const key = (a) => `${a.row}/${a.activity}`;
  // A2: B-004/A310 approved as a draft, then PATCHed once submitted
  const first = oneRow(approved, (a) => key(a) === 'B-004/A310', 'WP6.A2.approved B-004/A310');
  const r4 = await create('planner', first.row, first.activity, first.qty);
  t.alloc[key(first)] = r4.status === 201 ? r4.body?.data?.id || null : null;
  need(Boolean(t.alloc[key(first)]), `B3: ${key(first)} could not be created (${h.said(r4)})`);
  const ad = await verb('qs', t.alloc[key(first)], 'approve');
  rec('A2.B6.approveDraft', h.is(ad, saidOf(WP6.A2.approveDraft)), { expected: saidOf(WP6.A2.approveDraft), observed: h.said(ad), detail: 'approve accepts submitted rows only (activity-boq-allocation.service.js:1499-1505)' });
  const s4 = await verb('planner', t.alloc[key(first)], 'submit');
  need(s4.status === 200, `B3: ${key(first)}'s submit answered ${h.said(s4)}`);
  const ps = await send('planner', 'PATCH', `${AP}/${t.alloc[key(first)]}`, { quantity: FIXTURE.patchSubmittedQuantity });
  rec('A2.B6.patchSubmitted', h.is(ps, saidOf(WP6.A2.patchSubmitted)), { expected: saidOf(WP6.A2.patchSubmitted), observed: h.said(ps) });
  // A2: the other four created and submitted; the five approved by the QS
  for (const a of approved) {
    if (t.alloc[key(a)]) continue;
    const r = await create('planner', a.row, a.activity, a.qty);
    t.alloc[key(a)] = r.status === 201 ? r.body?.data?.id || null : null;
    need(Boolean(t.alloc[key(a)]), `B3: ${key(a)} could not be created (${h.said(r)})`);
    const s = await verb('planner', t.alloc[key(a)], 'submit');
    need(s.status === 200, `B3: ${key(a)}'s submit answered ${h.said(s)}`);
  }
  const answers = [];
  for (const a of approved) answers.push([key(a), h.said(await verb('qs', t.alloc[key(a)], 'approve'))]);
  const listed = await allocationsOf('qs', t.P);
  const ao = approved.map((a) => { const row = listed.find((x) => x.id === t.alloc[key(a)]); return { row: a.row, activity: a.activity, status: row?.status ?? null, qty: num(row?.quantity), amount: cents(row?.amount) }; });
  const ae = approved.map((a) => ({ row: a.row, activity: a.activity, status: 'approved', qty: a.qty, amount: a.amount }));
  const stage3Ok = approved.every((a) => STAGE3[`allocation.${key(a)}`]?.value === a.amount);
  rec('A2.B6.approved', answers.every(([, said]) => said === '200') && sameJson(ao, ae) && stage3Ok, { expected: ae, observed: { answers, rows: ao, stage3Leaves: stage3Ok }, detail: 'each amount is its stage3:109 allocation leaf' });
  // A2: B-003/A140 submitted, rejected without and with a reason
  const rj = B6B.allocations.rejected;
  const rr = await create('planner', rj.row, rj.activity, rj.qty);
  const idr = rr.status === 201 ? rr.body?.data?.id || null : null;
  need(Boolean(idr), `B3: ${rj.row}/${rj.activity} could not be created (${h.said(rr)})`);
  t.alloc[`${rj.row}/${rj.activity}`] = idr;
  const sr = await verb('planner', idr, 'submit');
  need(sr.status === 200, `B3: ${rj.row}/${rj.activity}'s submit answered ${h.said(sr)}`);
  const nr = await verb('qs', idr, 'reject', {});
  rec('A2.B6.rejectNoReason', h.is(nr, saidOf(WP6.A2.rejectNoReason)), { expected: saidOf(WP6.A2.rejectNoReason), observed: h.said(nr), detail: 'the route\'s reason notEmpty answers before REJECT_REASON_REQUIRED (routes/activity-boq-allocations.js:304)' });
  const wr = await verb('qs', idr, 'reject', { reason: `CERT3 WP6 ${rj.row} belongs to another activity ${h.STAMP}` });
  const rjo = { said: h.said(wr), status: wr.body?.data?.status ?? null, isActive: wr.body?.data?.isActive ?? null };
  rec('A2.B6.rejected', rjo.said === '200' && sameJson({ status: rjo.status, isActive: rjo.isActive }, WP6.A2.rejected.value), { expected: { said: '200', ...WP6.A2.rejected.value }, observed: rjo });
  // KA.A2.resubmitRejected (HR-C17)
  await probe('KA.A2.resubmitRejected (B3: the rejected row submitted again)', async () => {
    const RS = WP6.A2.resubmitRejected;
    const route = CONTRACT['HR-C17'].returnToDraftRoute;
    const back = route ? await send('planner', 'POST', `${AP}/${idr}/${route}`, {}) : null;
    const sb = await verb('planner', idr, 'submit');
    const pa = await send('planner', 'PATCH', `${AP}/${idr}`, { quantity: rj.qty });
    const after = (await allocationsOf('planner', t.P)).find((x) => x.id === idr);
    if (!after) throw probeSetup('KA.A2.resubmitRejected', 'the rejected row could not be read back');
    const o = { submit: saidParts(h.said(sb)), patch: saidParts(h.said(pa)), status: after.status, isActive: after.isActive, ...(back ? { returnToDraft: h.said(back) } : {}) };
    obs.hrc17 = o;
    ka('KA.A2.resubmitRejected', { ref: RS.ref, value: RS.value, today: RS.today, observed: o, verdict: judge(o, (x) => x.status === RS.value, (x) => sameJson({ submit: x.submit, patch: x.patch }, RS.today)), detail: `submit accepts drafts only (:1445-1451) and PATCH edits drafts only (:1291-1297); the return-to-draft route is the fix's (CONTRACT ${route || 'pending'})` });
  });
  // A1: the probes the choreography names (each refused before any write)
  const PR = FIXTURE.probes;
  const q0 = await create('planner', ...PR.quantityZero);
  rec('A1.B6.quantityZero', h.is(q0, saidOf(WP6.A1.quantityZero)), { expected: saidOf(WP6.A1.quantityZero), observed: h.said(q0), detail: 'the route\'s quantity gt 0 (routes/activity-boq-allocations.js:50)' });
  const [ocRow, ocAct, ocQty] = PR.overCapacity;
  const n0 = await allocations();
  const oc = await create('planner', ocRow, ocAct, ocQty);
  const n1 = await allocations();
  const ocd = oc.body?.error?.details || {};
  const onRow = approved.filter((a) => a.row === ocRow).reduce((s, a) => s + a.qty, 0);
  const oco = { said: h.said(oc), boqQuantity: num(ocd.boqQuantity), allocatedQuantity: num(ocd.allocatedQuantity), written: n1 - n0 };
  const oce = { said: saidOf(WP6.A1.overCapacity), boqQuantity: FIXTURE.bill[ocRow].quantity, allocatedQuantity: onRow + ocQty, written: 0 };
  rec('A1.B6.overCapacity', h.is(oc, saidOf(WP6.A1.overCapacity)) && sameJson(oco, oce), { expected: oce, observed: oco, detail: `${ocRow} fully allocated by its approved rows (WP6.A2.approved); the catcher of M-CAP / M-CAPq (under M-CAP the trigger answers 500, never counted as a success: WP6ADJ Q9)` });
  const ap = B6B.allocations.amountProbe;
  const m0 = await allocations();
  const ao2 = await create('planner', ap.row, ap.activity, ap.qty, { amount: units(ap.amount) });
  const m1 = await allocations();
  const aod = ao2.body?.error?.details || {};
  const aoo = { said: h.said(ao2), boqAmount: cents(aod.boqAmount), allocatedAmount: cents(aod.allocatedAmount), written: m1 - m0 };
  const aoe = { said: saidOf(WP6.A1.amountOverCapacity), ...WP6.A1.amountOverCapacityDetails.value, written: 0 };
  rec('A1.B6.amountOverCapacity', h.is(ao2, saidOf(WP6.A1.amountOverCapacity)) && sameJson(aoo, aoe), { expected: aoe, observed: aoo, detail: `${ap.row} carries no active allocation (the rejected one is inactive: activeBefore ${ap.activeBefore}); the quantity branch passes and the amount branch refuses (G11; the catcher of M-CAP / M-CAPa)` });
  const du = await create('planner', ...PR.duplicate);
  rec('A1.B6.duplicate', h.is(du, saidOf(WP6.A1.duplicate)), { expected: saidOf(WP6.A1.duplicate), observed: h.said(du), detail: 'the duplicate check precedes capacity (createAllocationInTx)' });
  need(Boolean(act(PR.foreignActivity[1])), 'B3: B6X\'s activity X-A1 is not there (B6X\'s X0 runs before B6\'s B3)');
  const fa = await create('planner', ...PR.foreignActivity);
  rec('A1.B6.foreignActivity', h.is(fa, saidOf(WP6.A1.foreignActivity)), { expected: saidOf(WP6.A1.foreignActivity), observed: h.said(fa), detail: 'an activity of B6X, another project of the same company' });
  const [naRow, naAct, naQty] = PR.notApplicable;
  const na1 = await send('planner', 'PATCH', MR, { rule: 'not_applicable', itemIds: [item(naRow)] });
  const na2 = await create('planner', naRow, naAct, naQty);
  const na3 = await send('planner', 'PATCH', MR, { rule: 'required', itemIds: [item(naRow)] });
  rec('A1.B6.notApplicable', h.said(na1) === '200' && h.is(na2, saidOf(WP6.A1.notApplicable)) && h.said(na3) === '200', { expected: { rule: '200', allocate: saidOf(WP6.A1.notApplicable), back: '200' }, observed: { rule: h.said(na1), allocate: h.said(na2), back: h.said(na3) } });
  need(h.said(na3) === '200', `B3: ${naRow} could not be set back to required`);
  // A6: not_applicable on a row with an approved allocation
  const pa6 = await send('planner', 'PATCH', MR, { rule: 'not_applicable', itemIds: [item(ocRow)] });
  rec('A6.B6.patchNotApplicableApproved', h.is(pa6, saidOf(WP6.A6.patchNotApplicableApproved)), { expected: saidOf(WP6.A6.patchNotApplicableApproved), observed: h.said(pa6), detail: `${ocRow} carries the approved ${ocRow}/A110` });
  // A3: coverage after the rejection, before the bulk's and the mapping file's drafts (no cutoff: WP6ADJ Q8)
  const cov = await dataOf('planner', `${AP}/coverage`);
  const co = { allocated: cents(cov?.approvedAllocatedAmount), unallocated: cents(cov?.unallocatedAmount), coveragePct: Math.round(Number(cov?.coveragePct) * 100) / 100, complete: cov?.counts?.complete ?? null };
  const ce = { allocated: WP6.A3.allocated.value, unallocated: WP6.A3.unallocated.value, coveragePct: WP6.A3.coveragePct.value, complete: WP6.A3.rowsComplete.value };
  rec('A3.B6.coverage', sameJson(co, ce), { expected: ce, observed: { ...co, rawCoveragePct: cov?.coveragePct ?? null }, detail: 'coveragePct compared at 2 dp (WP6.A3.coveragePct); no cutoff read (WP3-ALLOC-1 stays WP-3\'s)' });
  // A4: the bulk
  const bulk = await send('planner', 'POST', `${AP}/bulk`, { allocations: FIXTURE.bulk.map(([row, activity, qty]) => ({ boqItemId: item(row), activityId: act(activity), quantity: qty })) });
  const bd = bulk.body?.data || {};
  const bo = { said: h.said(bulk), createdCount: bd.createdCount ?? null, failedCount: bd.failedCount ?? null, codes: listOf(bd.failed).map((f) => f.code) };
  const be = { said: WP6.A4.bulk.value.createdCount > 0 ? '201' : '200', ...WP6.A4.bulk.value };
  rec('A4.B6.bulk', sameJson(bo, be), { expected: be, observed: bo, detail: 'the route answers 201 when a row was created (routes/activity-boq-allocations.js:180); the catcher of M-CAP / M-CAPq (under M-CAP the trigger answers 500 after the valid row)' });
  // A5: the mapping file, dry run, apply, undo
  const R = WP6.A5.report.value;
  const file = mappingFile(FIXTURE.mappingFile);
  const listBefore = (await allocationsOf('planner', t.P)).map(allocBrief);
  const dr = await upload('planner', `${AP}/import?dryRun=true`, file);
  const listAfterDry = (await allocationsOf('planner', t.P)).map(allocBrief);
  const sm = dr.body?.data?.summary || {};
  const dro = { said: h.said(dr), dryRun: dr.body?.data?.dryRun === true, matched: sm.matched ?? null, unmatched: sm.unmatched ?? null, existing: sm.existing ?? null, breaches: sm.breaches ?? null, created: sm.created ?? null, totalAmount: cents(sm.totalAmount), listUnchanged: sameJson(listBefore, listAfterDry) };
  const dre = { said: '200', dryRun: true, ...R.dryRun, listUnchanged: true };
  rec('A5.B6.dryRun', sameJson(dro, dre), { expected: dre, observed: dro, detail: 'the catcher of M-DRY / M-DRYm (the dry run writes drafts) and M-CAPi (the B-001 line planned)' });
  const apl = await upload('planner', `${AP}/import`, file);
  const pd = apl.body?.data || {};
  const batch = pd.batchId || null;
  const listApplied = await allocationsOf('planner', t.P);
  const batchRows = listApplied.filter((a) => batch && a.importBatchId === batch);
  const apo = { status: apl.status, created: pd.summary?.created ?? null, failed: pd.summary?.failed ?? null, oneBatch: Boolean(batch) && batchRows.length === (pd.summary?.created ?? -1), allocationStatus: [...new Set(batchRows.map((a) => a.status))].join(',') || null };
  rec('A5.B6.apply', sameJson(apo, R.apply), { expected: R.apply, observed: { ...apo, provenance: [...new Set(batchRows.map((a) => `${a.source}/${a.suggestedBy}`))] }, detail: 'one draft per matched row under one importBatchId (mapping-import.service.js:377-422)' });
  const others = listApplied.filter((a) => a.importBatchId !== batch || !batch).map(allocBrief);
  const un = batch ? await send('qs', 'POST', `${AP}/import/${batch}/undo`, {}) : null;
  const ud = un?.body?.data || {};
  const listUndone = await allocationsOf('qs', t.P);
  const undone = listUndone.filter((a) => batch && a.importBatchId === batch);
  const uo = { said: un ? h.said(un) : 'not sent', rejected: ud.rejected ?? null, keptApproved: ud.keptApproved ?? null, rowsRejectedInactive: undone.length === R.apply.created && undone.every((a) => a.status === 'rejected' && a.isActive === false), othersUnchanged: sameJson(listUndone.filter((a) => a.importBatchId !== batch || !batch).map(allocBrief), others) };
  const ue = { said: '200', ...R.undo, rowsRejectedInactive: true, othersUnchanged: true };
  rec('A5.B6.undo', sameJson(uo, ue), { expected: ue, observed: uo, detail: 'the drafts are submitted then rejected in one transaction (mapping-import.service.js:434-522)' });
};

// -- B6: B4, the re-uploads (U2.rate160, A6.uploadWarning, U7.uploaders, KA.U2.omitB005) ---------------------------------
const b6Reupload = async () => {
  const t = ctx.b6;
  const W = B6B.workbooks;
  const re = await upload('pm', `${t.P}/boq/upload`, workbookFile('rate160'), { label: uploadLabel('B-002 at 160') });
  const rd = re.body?.data || {};
  t.jobs.push(rd.jobId || null);
  const items = activeItems(await boqOf('qs', t.P));
  const at = (code) => items.find((i) => i.code === code) || null;
  const changed = Object.keys(W.rate160.rates);
  const s = rd.comparison || {};
  const ro = { status: re.status, mode: rd.mode ?? null, updated: s.updated ?? null, unchanged: s.unchanged ?? null, removed: s.removed ?? null, [`${changed[0]}.amount`]: cents(at(changed[0])?.amount), total: sumAmounts(items) };
  const rx = { status: 200, mode: WP6.U2.importStatus.value, updated: WP6.U2.comparisonUpdated.value, unchanged: W.rate160.rows.length - WP6.U2.comparisonUpdated.value, removed: W.stage3.rows.filter((c) => !W.rate160.rows.includes(c)).length, [`${changed[0]}.amount`]: WP6.U2['B-002.amount'].value, total: WP6.U2.total.value };
  rec('U2.B6.rate160', sameJson(ro, rx), { expected: rx, observed: ro, detail: 'a mapping rule is no row change (rowChanged compares code, description, unit, quantity, rate and amount: boq.service.js:336-345)' });
  const naCodes = Object.entries(W.rate160.mappingRules).filter(([, rule]) => rule === 'not_applicable').map(([code]) => code);
  const warns = listOf(rd.mappingRuleWarnings);
  const wo = { codes: warns.map((w) => w.code), itemCodes: warns.map((w) => w.itemCode), rulesKept: naCodes.map((code) => at(code)?.mappingRule ?? null) };
  const wx = { codes: naCodes.map(() => WP6.A6.uploadWarning.value), itemCodes: naCodes, rulesKept: naCodes.map(() => 'required') };
  rec('A6.B6.uploadWarning', sameJson(wo, wx), { expected: wx, observed: wo, detail: 'the row keeps its rule while its approved allocation stands (boq.service.js:1416-1427); every bill row is required unless a workbook names another rule (WP6.B6.workbooks)' });
  obs.uploaders.pm = h.said(re);
  const want = String(WP6.U7.qsPlannerPm.value);
  rec('U7.B6.uploaders', ['planner', 'qs', 'pm'].every((who) => obs.uploaders[who] === want), { expected: { planner: want, qs: want, pm: want }, observed: obs.uploaders, detail: 'the planner\'s dry run (U1), the QS\'s import (U2), the PM\'s re-upload (U2.rate160)' });
  await probe('KA.U2.omitB005 (B4: the QS re-uploads without B-005)', async () => {
    const om = await upload('qs', `${t.P}/boq/upload`, workbookFile('omitB005'), { label: uploadLabel('without B-005') });
    if (om.status !== 200) throw probeSetup('KA.U2.omitB005', `the upload answered ${h.said(om)}`);
    const od = om.body?.data || {};
    t.jobs.push(od.jobId || null);
    const dropped = W.stage3.rows.filter((code) => !W.omitB005.rows.includes(code));
    if (dropped.length !== 1) throw probeSetup('KA.U2.omitB005', `the omit workbook leaves out ${dropped.length} rows`);
    const live = activeItems(await boqOf('qs', t.P));
    const row = live.find((i) => i.code === dropped[0]) || null;
    const flagField = CONTRACT['HR-C14'].droppedRowFlagField;
    const o = { comparisonRemoved: od.comparison?.removed ?? null, [`${dropped[0]}.active`]: Boolean(row) && row.isActive !== false, [`${dropped[0]}.flagged`]: flagField ? Boolean(row?.[flagField]) : false };
    obs.omitB005 = { ...o, dropped: dropped[0], flagField, liveRows: live.length, liveTotal: sumAmounts(live) };
    kaLeaf('KA.U2.omitB005', WP6.U2.omitB005, o, { detail: `the comparison reports ${dropped[0]} removed and the persist loop touches incoming rows only (boq.service.js:395-400, 1413-1454); the flag field is the fix's (CONTRACT ${flagField || 'pending'}: no flag read until then)` });
  });
};

// -- B6: B5, the lock, the comparison-only upload and the refusals after it (U4) -----------------------------------------
const b6Lock = async () => {
  const t = ctx.b6;
  const RV = (id) => `${t.P}/boq/revisions/${id}`;
  const comment = (what) => ({ comment: `CERT3 WP6 ${what} ${h.STAMP}` });
  const cur = (await boqOf('qs', t.P))?.currentRevision || null;
  need(Boolean(cur?.id), 'B5: B6 has no current BOQ revision to lock');
  const sub = await send('planner', 'POST', `${RV(cur.id)}/submit`, comment('submit for the lock'));
  const app = await send('qs', 'POST', `${RV(cur.id)}/approve`, comment('approve for the lock'));
  const lock = await send('pm', 'POST', `${RV(cur.id)}/lock`, comment('lock the bill'));
  const ld = lock.body?.data || {};
  const after = await boqOf('qs', t.P);
  const lo = {
    submit: sub.body?.data?.status ?? h.said(sub),
    approve: app.body?.data?.status ?? h.said(app),
    lock: ld.revision?.status ?? h.said(lock),
    baselineLocked: ld.revision?.baselineLocked === true,
    supersededRevisions: listOf(after?.revisions, 'revisions').filter((r) => r.status === 'superseded').length,
    lockedRows: ld.lockedRows ?? null,
    baseline: { locked: after?.baseline?.locked === true, source: after?.baseline?.source ?? null },
  };
  rec('U4.B6.lockFlow', sameJson(lo, WP6.U4.lockFlow.value), { expected: WP6.U4.lockFlow.value, observed: { ...lo, locked: cur.revisionNumber ?? null }, detail: 'the current revision is the omit-B005 upload; the U2 import and the rate-160 re-upload are superseded (boq.service.js:1086-1105)' });
  need(lock.status === 200, `B5: B6's bill could not be locked (${h.said(lock)})`);
  const co = await upload('qs', `${t.P}/boq/upload`, workbookFile('afterLock'), { label: uploadLabel('upload after the lock') });
  const cd = co.body?.data || {};
  const cjob = cd.jobId ? await jobOf(t, cd.jobId) : null;
  const live = activeItems(await boqOf('qs', t.P));
  const coo = { status: co.status, mode: cd.mode ?? null, baselineLocked: cd.baselineLocked === true, job: cjob?.status ?? null, rows: live.length, total: sumAmounts(live) };
  const coe = { status: 200, mode: WP6.U4.uploadMode.value, baselineLocked: true, job: 'succeeded', rows: WP6.U4.liveAfterLock.value.rows, total: WP6.U4.liveAfterLock.value.total };
  rec('U4.B6.comparisonOnly', sameJson(coo, coe), { expected: coe, observed: coo, detail: 'a comparison-only upload records a completed job and changes no live row (boq.service.js:1347-1411, 1536-1558)' });
  const rv = cd.revisionId ? await send('planner', 'POST', `${RV(cd.revisionId)}/submit`, comment('submit a comparison')) : null;
  rec('U4.B6.reviewComparisonOnly', Boolean(rv) && h.is(rv, saidOf(WP6.U4.reviewComparisonOnly)), { expected: saidOf(WP6.U4.reviewComparisonOnly), observed: rv ? h.said(rv) : 'not sent (no comparison revision)' });
  const la = await send('pm', 'POST', `${RV(cur.id)}/lock`, comment('lock again'));
  rec('U4.B6.lockAgain', h.is(la, saidOf(WP6.U4.lockAgain)), { expected: saidOf(WP6.U4.lockAgain), observed: h.said(la), detail: 'no unlock and no second lock (boq.service.js:1060-1071)' });
  const row = live.find((i) => i.code === FIXTURE.probes.overCapacity[0]) || null;
  const pt = row ? await send('qs', 'PATCH', `${t.P}/boq/items/${row.id}`, { description: `CERT3 WP6 an edit after the lock ${h.STAMP}` }) : null;
  const rowAfter = activeItems(await boqOf('qs', t.P)).find((i) => i.id === row?.id) || null;
  rec('U4.B6.patchAfterLock', Boolean(pt) && h.is(pt, saidOf(WP6.U4.patchAfterLock)) && rowAfter?.description === row?.description, { expected: { said: saidOf(WP6.U4.patchAfterLock), unchanged: true }, observed: { said: pt ? h.said(pt) : 'not sent', unchanged: rowAfter?.description === row?.description } });
};

// -- B6: B6, budget lines, the seven-line cost, transfers, revisions, the Original lock, the register (B1-B7) ----------------
const b6Budget = async () => {
  const t = ctx.b6;
  const LP = `${t.P}/budget/lines`;
  const BL = B6B.budgetLines;
  const BP = B6B.budgetProbes;
  const TR = B6B.transfers;
  const LR = B6B.lineRevisions;
  const lineItems = async () => listOf(await linesOf(t.P, { includeArchived: true }), 'items');
  const revisedOf = async (keys) => { const items = await lineItems(); return Object.fromEntries(keys.map((k) => [k, cents(items.find((i) => i.id === t.lines[k])?.revisedBudget)])); };
  const originalOf = async (key) => cents((await dataOf('cost', `${LP}/${t.lines[key]}`))?.originalBudget);
  const patchOriginal = (key, amount) => send('cost', 'PATCH', `${LP}/${t.lines[key]}`, { originalBudget: units(amount) });
  const transfer = (tr) => send('finance', 'POST', `${t.P}/budget/transfers`, { fromLineId: t.lines[tr.from], toLineId: t.lines[tr.to], amount: units(tr.amount), note: `CERT3 WP6 ${tr.from} to ${tr.to} ${h.STAMP}` });
  // B1: the twelve lines (the cost controller)
  const made = [];
  for (const l of BL) {
    const res = await send('cost', 'POST', LP, { costCodeId: t.codes[l.code], costType: l.costType, description: `CERT3 WP6 ${l.key} ${h.STAMP}`, originalBudget: units(l.original) });
    t.lines[l.key] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push({ key: l.key, said: h.said(res), original: cents(res.body?.data?.originalBudget) });
  }
  const typedSum = made.filter((m) => TYPED_KEYS.includes(m.key)).reduce((s, m) => s + (Number.isInteger(m.original) ? m.original : NaN), 0);
  const linesOk = made.every((m, i) => m.said === '201' && m.original === BL[i].original);
  rec('B1.B6.lines', linesOk && typedSum === WP6.B1.original.value, { expected: { lines: BL.map((l) => [l.key, l.original]), typedSum: WP6.B1.original.value }, observed: { made, typed: TYPED_KEYS, typedSum } });
  need(linesOk, 'B6: B6\'s budget lines could not be made');
  // B2: a duplicate; an actual typed onto a line
  const lab = lineBook(TR.move.from);
  const dup = await send('cost', 'POST', LP, { costCodeId: t.codes[lab.code], costType: lab.costType, description: `CERT3 WP6 duplicate ${h.STAMP}`, originalBudget: units(lab.original) });
  rec('B2.B6.duplicate', h.is(dup, saidOf(WP6.B2.duplicate)), { expected: saidOf(WP6.B2.duplicate), observed: h.said(dup), detail: `${lab.code}/${lab.costType} again` });
  const countBefore = (await lineItems()).length;
  const AD = FIXTURE.actualDerived;
  const adr = await send('cost', 'POST', LP, { costCodeId: t.codes[AD.code], costType: AD.costType, description: `CERT3 WP6 actual typed ${h.STAMP}`, originalBudget: 0, actual: AD.actual });
  const countAfter = (await lineItems()).length;
  rec('B2.B6.actualDerived', h.is(adr, saidOf(WP6.B2.actualDerived)) && countAfter === countBefore, { expected: { said: saidOf(WP6.B2.actualDerived), written: 0 }, observed: { said: h.said(adr), written: countAfter - countBefore } });
  // B1: the seven-line expense (the cost controller makes and submits it, finance approves)
  const DC = B6B.directCost;
  const body = {
    type: DC.type,
    description: `CERT3 WP6 seven-line ${DC.type} ${h.STAMP}`,
    costDate: FIXTURE.costDate,
    vendorName: `CERT3 WP6 payee ${h.STAMP}`,
    notes: 'CERT3 WP6 B1',
    lines: DC.lines.map((l) => ({ description: `${l.line} (CERT3 WP6)`, budgetLineId: t.lines[l.line], activityId: t.acts[FIXTURE.costActivity], quantity: 1, unit: FIXTURE.costUnit, unitCost: units(l.amount), amount: units(l.amount) })),
  };
  const mk = await send('cost', 'POST', `${t.P}/direct-costs`, body);
  const dcId = mk.status === 201 ? mk.body?.data?.id || null : null;
  need(Boolean(dcId), `B6: the seven-line ${DC.type} could not be made (${h.said(mk)} ${mk.body?.error?.message || ''})`);
  const sb = await send('cost', 'POST', `${t.P}/direct-costs/${dcId}/submit`, {});
  need(sb.status === 200 && sb.body?.data?.status === 'pending', `B6: the expense's submit answered ${h.said(sb)}`);
  const apv = await send('finance', 'POST', `${t.P}/direct-costs/${dcId}/approve`, {});
  need(apv.status === 200, `B6: the expense's approval answered ${h.said(apv)}`);
  const rc1 = await recon(t.P);
  const byType = Object.fromEntries(Object.entries(rc1?.ledger?.byCostType || {}).map(([k, v]) => [k, cents(v)]));
  const so = { byCostType: byType, total: cents(rc1?.ledger?.total) };
  const se = { byCostType: WP6.B1.sevenLines.value, total: WP6.B1.sevenLineTotal.value };
  rec('B1.B6.sevenLineCost', sameJson(so, se) && DC.total === WP6.B1.sevenLineTotal.value, { expected: se, observed: so, detail: 'each line takes its budget line\'s cost type (direct-cost.service.js:215) and posts to the ledger on approval (:488-516)' });
  const bo = { balanced: rc1?.balanced === true, recordedTotal: cents(rc1?.budget?.recordedTotal) };
  const bx = { balanced: WP6.B1.balanced.value, recordedTotal: WP6.B1.sevenLineTotal.value };
  rec('B1.B6.balanced', sameJson(bo, bx), { expected: bx, observed: { ...bo, budgetVariances: listOf(rc1?.budget?.variances).length, activityVariances: listOf(rc1?.activity?.variances).length } });
  // B2: a cost code with an active line cannot leave the project
  const ci = await send('cost', 'PUT', `${t.P}/budget/cost-codes`, { removeCostCodeIds: [t.codes[lab.code]] });
  const codesNow = listOf(await dataOf('cost', `${t.P}/budget/cost-codes`), 'items').filter((r) => r.status === 'active').map((r) => r.code);
  rec('B2.B6.costCodeInUse', h.is(ci, saidOf(WP6.B2.costCodeInUse)) && codesNow.includes(lab.code), { expected: { said: saidOf(WP6.B2.costCodeInUse), stillOnB6: true }, observed: { said: h.said(ci), stillOnB6: codesNow.includes(lab.code) }, detail: 'refused inside the transaction (budget.service.js:115-120)' });
  // B3: the +0.02 probe (M-XFER's catcher), the 20,000 move, the C1-TOL pair
  const p2 = await transfer(TR.plus2);
  const r1 = await revisedOf([TR.plus2.from, TR.plus2.to]);
  const rx1 = { [TR.plus2.from]: lineBook(TR.plus2.from).original, [TR.plus2.to]: lineBook(TR.plus2.to).original };
  rec('B3.B6.overTransferPlus2', h.is(p2, saidOf(WP6.B3.overTransferPlus2)) && TR.plus2.amount === WP6.B3.overPlus2.value && sameJson(r1, rx1), { expected: { said: saidOf(WP6.B3.overTransferPlus2), amount: WP6.B3.overPlus2.value, revised: rx1 }, observed: { said: h.said(p2), amount: TR.plus2.amount, revised: r1 }, detail: '100,000.02 > 100,000.00 + the 0.01 tolerance (budget.service.js:678); the catcher of M-XFER' });
  const mv = await transfer(TR.move);
  const typedRevised = await revisedOf(TYPED_KEYS);
  const mo = { said: h.said(mv), from: typedRevised[TR.move.from], to: typedRevised[TR.move.to], typedSum: Object.values(typedRevised).reduce((s, v) => s + (Number.isInteger(v) ? v : NaN), 0) };
  const me = { said: '200', from: WP6.B3.from01_100.value, to: WP6.B3.to02_100.value, typedSum: WP6.B3.projectRevised.value };
  rec('B3.B6.move20000', sameJson(mo, me) && TR.move.fromAfter === me.from && TR.move.toAfter === me.to, { expected: me, observed: mo, detail: 'the route answers 200 (budget.js:97); the seven typed lines\' revised sum (G17)' });
  await probe('KA.B3.overTransfer (B6: the C1-TOL pair T1 / T2)', async () => {
    const OT = WP6.B3.overTransfer;
    if (TR.c1tol.amount !== WP6.B3.over.value) throw probeSetup('KA.B3.overTransfer', 'the pair\'s transfer is not WP6.B3.over');
    const res = await transfer(TR.c1tol);
    const rv = await revisedOf([TR.c1tol.from, TR.c1tol.to]);
    const o = { status: res.status, code: res.body?.error?.code ?? null, [TR.c1tol.from]: rv[TR.c1tol.from], [TR.c1tol.to]: rv[TR.c1tol.to], pairSum: (rv[TR.c1tol.from] ?? NaN) + (rv[TR.c1tol.to] ?? NaN) };
    obs.c1tol = o;
    ka('KA.B3.overTransfer', { ref: OT.ref, value: OT.value, today: OT.today, observed: o, verdict: judge(o, (x) => `${x.status} ${x.code}` === saidOf(OT), (x) => sameJson({ status: x.status, [TR.c1tol.from]: x[TR.c1tol.from], [TR.c1tol.to]: x[TR.c1tol.to], pairSum: x.pairSum }, OT.today)), detail: '100,000.01 > 100,000.00 + 0.01 is false in doubles (budget.service.js:26, :678); on the dedicated pair, so the 20,000 move still found 100,000.00 (G16; WP4ADJ Q12, WP6ADJ Q14)' });
  });
  // B4: a line revision; a revision of 0
  const rev = await send('finance', 'POST', `${LP}/${t.lines[LR.plus.line]}/revisions`, { amount: units(LR.plus.amount), note: `CERT3 WP6 ${LR.plus.line} revised ${h.STAMP}` });
  const rvd = rev.body?.data || {};
  const ro = { said: h.said(rev), revisions: cents(rvd.revisions), revised: cents(rvd.revisedBudget) };
  const rx = { said: '201', revisions: WP6.B4.revisionPlus5000.value, revised: LR.plus.revisedAfter };
  rec('B4.B6.revision', sameJson(ro, rx) && LR.plus.amount === WP6.B4.revisionPlus5000.value, { expected: rx, observed: ro });
  const z = await send('finance', 'POST', `${LP}/${t.lines[LR.zero.line]}/revisions`, { amount: units(LR.zero.amount), note: `CERT3 WP6 a zero revision ${h.STAMP}` });
  rec('B4.B6.amountZero', h.is(z, saidOf(WP6.B4.amountZero)), { expected: saidOf(WP6.B4.amountZero), observed: h.said(z) });
  // B5: OVH locked by the ledger alone (M-ORIG / M-ORIG4's catcher)
  const ov = await patchOriginal(BP.byLedger.line, BP.byLedger.amount);
  const lo = { said: h.said(ov), conditions: conditionsOf(ov), original: await originalOf(BP.byLedger.line) };
  const lx = { said: saidOf(WP6.B5.lockedByLedger), conditions: WP6.B5.lockedByLedgerConditions.value, original: lineBook(BP.byLedger.line).original };
  rec('B5.B6.lockedByLedger', h.is(ov, saidOf(WP6.B5.lockedByLedger)) && sameJson(lo, lx), { expected: lx, observed: lo, detail: `${BP.byLedger.line} carries B1's posting and no change row: condition 4 alone (budget.service.js:373-378)` });
  // B6 register (BR-ORDER), read before any CO approval
  const RG = B6B.register;
  const brRoute = `${t.P}/budget-revisions`;
  const brTitle = (ref) => `CERT3 WP6 ${ref} ${h.STAMP}`;
  const registerRead = async () => { const d = await dataOf('pm', brRoute); return { rows: listOf(d, 'rows'), waterfall: listOf(d?.waterfall), summary: d?.summary || null }; };
  const byBook = (rows) => Object.fromEntries(RG.rows.map((r) => [r.ref, cents(rows.find((x) => x.title === brTitle(r.ref))?.cumulativeBudget)]));
  const productRefs = {};
  await probe('KA.B6.registerOrder (B6: BR-A, then BR-B back-dated before it)', async () => {
    for (const r of RG.rows) {
      const res = await send('pm', 'POST', brRoute, { title: brTitle(r.ref), changeType: 'addition', amount: units(r.amount), effectiveDate: dayFromNow(r.offset), status: 'approved', notes: `CERT3 WP6 register ${r.ref}` });
      if (res.status !== 201) throw probeSetup('KA.B6.registerOrder', `${r.ref} answered ${h.said(res)} ${res.body?.error?.message || ''}`);
      productRefs[res.body?.data?.ref] = r.ref;
    }
    const reg = await registerRead();
    const o = byBook(reg.rows);
    const value = Object.fromEntries(RG.rows.map((r) => [r.ref, WP6.B6[r.ref].value]));
    const today = Object.fromEntries(RG.rows.map((r) => [r.ref, WP6.B6[r.ref].today]));
    obs.register = { stored: o, waterfall: reg.waterfall.filter((p) => productRefs[p.ref]).map((p) => cents(p.cumulative)), waterfallRefs: reg.waterfall.map((p) => productRefs[p.ref] || p.ref), summary: { currentBudget: cents(reg.summary?.currentBudget), netChange: cents(reg.summary?.netChange) } };
    ka('KA.B6.registerOrder', { ref: WP6.B6['BR-B'].ref, value, today, observed: o, verdict: judge(o, (x) => sameJson(x, value), (x) => sameJson(x, today)), detail: 'createBudgetRevision stores the latest-effective approved row\'s total + delta with no recompute (budget-revision.service.js:125-130, 154); read before the CO approval, which recomputes (change-order.service.js:822-847)' });
  });
  // B5: the CO on LA (the QS makes it approvable and submits it, the PM approves), then LA's Original refused
  const CO = B6B.changeOrder;
  const made2 = await send('qs', 'POST', `${t.P}/change-orders`, { description: `CERT3 WP6 CO on ${CO.activity} ${h.STAMP}: instructed scope`, category: 'client_variation', value: CO.value, activityId: t.acts[CO.activity], budgetLineId: t.lines[CO.line], scheduleImpact: 0, raisedBy: `QS CERT3 WP6 ${h.STAMP}` });
  const coId = made2.status === 201 ? made2.body?.data?.id || null : null;
  need(Boolean(coId), `B6: the CO could not be created (${h.said(made2)} ${made2.body?.error?.message || ''})`);
  t.coId = coId;
  const documentId = await attachPdf('qs', t.P, 'change_order', coId, 'CO instruction');
  const ready = await send('qs', 'PATCH', `${t.P}/change-orders/${coId}`, { scheduleImpactSummary: `No programme effect (CERT3 WP6 ${h.STAMP})`, costImpactSummary: `${CO.value} at contract rates (CERT3 WP6 ${h.STAMP})`, activityLinks: [{ activityId: t.acts[CO.activity], relationType: 'impacted', scheduleImpactDays: 0, costImpact: CO.value, notes: 'CERT3 WP6' }], documentIds: [documentId] });
  need(ready.status === 200, `B6: the CO could not be made approvable (${h.said(ready)} ${ready.body?.error?.message || ''})`);
  const sc = await send('qs', 'POST', `${t.P}/change-orders/${coId}/submit`, { comment: `CERT3 WP6 for approval ${h.STAMP}` });
  need(sc.status === 200 && sc.body?.data?.status === 'pending', `B6: the CO's submit answered ${h.said(sc)}`);
  const ac = await send('pm', 'POST', `${t.P}/change-orders/${coId}/approve`, { comment: `CERT3 WP6 approved ${h.STAMP}` });
  need(ac.status === 200 && ac.body?.data?.status === 'approved', `B6: the CO's approval answered ${h.said(ac)} ${ac.body?.error?.message || ''}`);
  const la = await patchOriginal(BP.afterCo.line, BP.afterCo.amount);
  const lao = { said: h.said(la), conditions: conditionsOf(la), original: await originalOf(BP.afterCo.line) };
  const lax = { said: saidOf(WP6.B5.lockedAfterCo), conditions: WP6.B5.lockedAfterCoConditions.value, original: lineBook(BP.afterCo.line).original };
  rec('B5.B6.lockedAfterCo', h.is(la, saidOf(WP6.B5.lockedAfterCo)) && sameJson(lao, lax), { expected: lax, observed: lao, detail: `the approved CO's change row on ${BP.afterCo.line}: condition 2 alone (budget.service.js:349-351); the catcher of M-ORIG / M-ORIG2` });
  // the register after the approval's generated revision recomputed it (CF.BRorder; the severity evidence, WP6ADJ Q6)
  const regAfter = await registerRead();
  const coRow = regAfter.rows.find((r) => r.linkedChangeOrder === coId) || null;
  obs.registerAfterCo = { ...byBook(regAfter.rows), CO: cents(coRow?.cumulativeBudget) };
  // KA.B5.afterRepoint (L109)
  await probe('KA.B5.afterRepoint (B6: the CO re-pointed from LA to LB)', async () => {
    const AR = WP6.B5.afterRepoint;
    const rp = await send('cost', 'PUT', `${t.P}/budget/change-orders/${coId}/line`, { lineId: t.lines[CO.repointTo] });
    if (rp.status !== 200) throw probeSetup('KA.B5.afterRepoint', `the re-point answered ${h.said(rp)}`);
    const pr = await patchOriginal(BP.afterRepoint.line, BP.afterRepoint.amount);
    const o = { status: pr.status, code: pr.body?.error?.code ?? null, originalBudget: await originalOf(BP.afterRepoint.line), conditions: conditionsOf(pr) };
    obs.l109 = o;
    ka('KA.B5.afterRepoint', { ref: AR.ref, value: AR.value, today: AR.today, observed: o, verdict: judge(o, (x) => `${x.status} ${x.code}` === saidOf(AR), (x) => x.status === AR.today.status && x.originalBudget === AR.today.originalBudget), detail: 'the lock is derived from current conditions (budget.service.js:338-389); the re-point re-applies the CO (:784) and deletes its change row on LA (:731)' });
  });
  // CF.HRC18: the eighth type on the register and the ledger
  const summaryNow = (await linesOf(t.P))?.summary || {};
  // the eighth type's own line is WP6.B6.budgetLines OTH (its code's category is other; the C1-TOL and L109 lines borrow other)
  obs.hrc18 = { othLine: made.find((m) => m.key === 'OTH')?.said ?? null, byTypeCostTypes: listOf(summaryNow.byType).map((b) => b.costType).sort(), ledgerCostTypes: Object.keys(rc1?.ledger?.byCostType || {}).sort() };
  // CF.L111: a negative line, a revision below zero
  const L1 = BP.l111Line;
  const nl = await send('cost', 'POST', LP, { costCodeId: t.codes[L1.code], costType: L1.costType, description: `CERT3 WP6 L111 ${h.STAMP}`, originalBudget: units(L1.original) });
  const nr = await send('finance', 'POST', `${LP}/${t.lines[LR.l111.line]}/revisions`, { amount: units(LR.l111.amount), note: `CERT3 WP6 L111 ${h.STAMP}` });
  obs.l111 = {
    negativeOriginal: nl.status >= 400 ? { status: nl.status, code: nl.body?.error?.code ?? null } : { status: nl.status, originalBudget: cents(nl.body?.data?.originalBudget) },
    revisionBelowZero: nr.status >= 400 ? { status: nr.status, code: nr.body?.error?.code ?? null } : { status: nr.status, revised: cents(nr.body?.data?.revisedBudget) },
  };
  // KA.B7.archivedActual (L110)
  await probe('KA.B7.archivedActual (B6: MAT archived with actual)', async () => {
    const del = await send('cost', 'DELETE', `${LP}/${t.lines[BP.archive]}`);
    if (del.status !== 200) throw probeSetup('KA.B7.archivedActual', `the archive answered ${h.said(del)}`);
    const linesNow = await linesOf(t.P);
    const rc = await recon(t.P);
    const o = { linesActual: cents(linesNow?.summary?.totals?.actual), recordedTotal: cents(rc?.budget?.recordedTotal) };
    obs.l110 = { ...o, archivedStatus: del.body?.data?.status ?? null, archivedActual: cents(del.body?.data?.actual) };
    kaLeaf('KA.B7.archivedActual', WP6.B7.archivedActual, o, { detail: 'GET /budget/lines lists active lines only by default (budget.service.js:226-231); the reconciliation sums every line, archived included (cost-reconciliation.service.js:200)' });
  });
  // B3: a transfer to the archived line
  const ar = await transfer(TR.toArchived);
  rec('B3.B6.archivedLine', h.is(ar, saidOf(WP6.B3.archivedLine)), { expected: saidOf(WP6.B3.archivedLine), observed: h.said(ar), detail: 'checked before the amount (budget.service.js:676)' });
  // BR-ORDER's severity evidence (WP6ADJ Q6): who else reads the stored running total
  obs.brSeverityEvidence = { storedReaders: staticReaders('cumulativeBudget'), summaryUsesDeltas: obs.register ? obs.register.summary.currentBudget === WP6.B6['BR-A'].value : null, healedByApproval: obs.registerAfterCo ? sameJson({ 'BR-B': obs.registerAfterCo['BR-B'], 'BR-A': obs.registerAfterCo['BR-A'] }, { 'BR-B': WP6.B6['BR-B'].value, 'BR-A': WP6.B6['BR-A'].value }) : null };
};

/** The source files (backend/src, tests and live suites excluded) that name `word`: the readers of a stored figure. */
const staticReaders = (word) => {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!['__tests__', '__live__', '__mocks__', 'node_modules'].includes(ent.name)) walk(full);
      } else if (/\.(c|m)?js$/.test(ent.name) && !/\.test\.(c|m)?js$/.test(ent.name)) {
        try { if (fs.readFileSync(full, 'utf8').includes(word)) out.push(path.relative(SRC, full).replace(/\\/g, '/')); } catch { /* unreadable */ }
      }
    }
  };
  walk(SRC);
  return out.sort();
};

// -- B6: the CF step (WP0-BOQ-1 reads), Q11 and the end -------------------------------------------------------------------
const b6CfReads = async () => {
  const t = ctx.b6;
  const roles = { cost_controller: 'cost', site_engineer: 'site', qs: 'qs' };
  const template = {};
  const stored = {};
  for (const [role, who] of Object.entries(roles)) {
    template[role] = (await get(who, `${t.P}/boq/template`)).status;
    stored[role] = t.u2Document ? (await get(who, `${t.P}/boq/uploads/${t.u2Document}`)).status : null;
  }
  obs.wp0boq1 = { template, upload: stored, document: t.u2Document || null };
};
const b6Jobs = async () => { ctx.b6.cancel = await cancelQueued(ctx.b6); };
const b6End = async () => {
  const t = ctx.b6;
  if (!t.cancel) t.cancel = await cancelQueued(t);
  const a = await archive(t);
  rec('S.B6.archived', a?.status === 200 && Boolean(a?.archivedAt) && t.cancel.left === 0, { observed: { archive: a, queuedLeft: t.cancel.left, cancelled: t.cancel.cancelled.length, refused: t.cancel.refused }, detail: `B6 ${t.id}: no queued job left (WP6ADJ Q11)` });
};

// -- B6X: X0, the project, its team, X-A1 (S.B6X.create) -----------------------------------------------------------------
const b6xSetup = async () => {
  const t = await makeThrowaway({ pm: 'pm', label: 'B6X', project: B6XB.project, team: B6XB.team });
  ctx.b6x = t;
  const made = [];
  for (const [i, code] of (B6XB.team.activities || []).entries()) {
    const res = await send('planner', 'POST', `${t.P}/activities`, { name: `CERT3 WP6 ${code} ${h.STAMP}`, activityCode: code, wbsCode: 'WP6-B6X', category: 'civil', startDate: FIXTURE.activityStart, endDate: FIXTURE.activityEnd, sortOrder: i, engineerIds: [ctx.people.site] });
    t.acts[code] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push([code, h.said(res)]);
  }
  const createdOk = t.created.status === 201 && teamOk(t, B6XB.team) && !('contractValue' in sentOnly(B6XB.project)) && made.length === (B6XB.team.activities || []).length && made.every(([, said]) => said === '201');
  rec('S.B6X.create', createdOk, { expected: { project: B6XB.project, team: B6XB.team }, observed: { id: t.id, said: h.said(t.created), contractValue: t.shown.contractValue ?? null, team: t.members, activities: made }, detail: 'no contract value sent (WP6.B6X.project); X-A1 is named by B6\'s A1.B6.foreignActivity' });
  need(createdOk, 'X0: B6X, its team or X-A1 could not be made');
};

// -- B6X: X1, the 130-row bill (S.B6X.bill, KA.U5.B6X.sections) -----------------------------------------------------------
const b6xBill = async () => {
  const t = ctx.b6x;
  const rows = b6xRows();
  const file = FILES().boqWorkbook(rows, { filename: `CERT3-WP6-B6X-${h.STAMP}.xlsx`, title: `CERT3 WP6 B6X bill ${h.STAMP}` });
  const up = await upload('qs', `${t.P}/boq/upload`, file, { label: uploadLabel('B6X bill') });
  const ud = up.body?.data || {};
  t.boqJob = ud.jobId || null;
  t.jobs.push(t.boqJob);
  const items = activeItems(await boqOf('qs', t.P));
  const byCode = new Map(items.map((i) => [i.code, i]));
  const mismatched = rows.filter((r) => { const i = byCode.get(r.code); return !i || num(i.quantity) !== r.quantity || cents(i.rate) !== cents(r.rate) || cents(i.amount) !== Math.round(r.quantity * r.rate * 100); }).map((r) => r.code);
  const job = t.boqJob ? await jobOf(t, t.boqJob) : null;
  const sizes = B6XB.bill.sections.map(([, n]) => n);
  const bo = { said: h.said(up), mode: ud.mode ?? null, rows: rows.length, readBack: items.length, mismatched, job: job?.status ?? null, columns: file.columns, sizes };
  const bx = { said: '200', mode: WP6.U2.importStatus.value, rows: D087.boqRows.value, readBack: D087.boqRows.value, mismatched: [], job: 'queued', columns: B6XB.bill.columns, sizes: D087.boqSections.value.sizes };
  rec('S.B6X.bill', sameJson(bo, bx), { expected: bx, observed: { ...bo, mismatched: mismatched.slice(0, 10) }, detail: '087-COM\'s 130-row, 50 / 50 / 30 shape (deep.087-COM.boqRows / boqSections); each row read back against its workbook row; the total is the generator\'s (identity, not a derived figure)' });
  need(sameJson(bo, bx), 'X1: B6X\'s bill could not be set up');
  await probe('KA.U5.B6X.sections (X1: the rows and the coverage by section)', async () => {
    const SR = WP6.U5.sectionsReadBack;
    const cov = await dataOf('qs', `${t.P}/activity-boq-allocations/coverage?groupBy=section`);
    const o = { rows: sectionCounts(items), coverage: coverageSections(cov) };
    obs.sectionsB6X = o;
    ka('KA.U5.B6X.sections', { ref: SR.ref, value: SR.value.B6X, today: SR.today.B6X, observed: o, verdict: judge(o, (x) => sameJson(x.rows, SR.value.B6X) && sameJson(x.coverage, SR.value.B6X), (x) => sameJson(x.rows, SR.today.B6X) && sameJson(x.coverage, SR.today.B6X)), detail: `the parser reads no section, boqItemData writes none and mapBoqItem serves none (excel-parser.js:6, 43-48; boq.service.js:463-483, 1967-2012); the row field read is ${CONTRACT['HR-C14'].sectionField || 'section (the schema\'s; CONTRACT pending)'}` });
  });
};

// -- B6X: X2, the queued job through the recorder stub (KA.U5.B6X.aiJobCalls) --------------------------------------------
const b6xJob = async () => {
  const t = ctx.b6x;
  await probe('KA.U5.B6X.aiJobCalls (X2: B6X\'s queued job through the recorder stub)', async () => {
    if (!t.boqJob) throw probeSetup('KA.U5.B6X.aiJobCalls', 'B6X has no queued boq.parse job');
    const run = await runBoqJob('KA.U5.B6X.aiJobCalls', t, t.boqJob, B6XB.stub.job, 'B6X X2');
    if (run.error) throw probeSetup('KA.U5.B6X.aiJobCalls', `the handler failed on the stub's answer: ${json(run.error)}`);
    const o = { calls: run.calls.length, sizes: run.calls };
    obs.l131 = { ...o, result: run.result, aiJobCalls087: { value: WP6.U5.aiJobCalls087.value, today: WP6.U5.aiJobCalls087.today, observed: run.calls.length } };
    kaLeaf('KA.U5.B6X.aiJobCalls', WP6.U5.aiJobCalls, o, { detail: 'runBoqActivityJob sends every row in one prompt (boq.service.js:1647-1653, max_tokens 8192: L131); the job function called directly, never claimNextJob (WP6ADJ Q2)' });
  });
};

// -- B6X: X3, the bill locked ---------------------------------------------------------------------------------------------
const b6xLock = async () => {
  const t = ctx.b6x;
  const cur = (await boqOf('qs', t.P))?.currentRevision || null;
  need(Boolean(cur?.id), 'X3: B6X has no current BOQ revision');
  const RV = `${t.P}/boq/revisions/${cur.id}`;
  const sub = await send('planner', 'POST', `${RV}/submit`, { comment: `CERT3 WP6 B6X ${h.STAMP}` });
  const app = await send('qs', 'POST', `${RV}/approve`, { comment: `CERT3 WP6 B6X ${h.STAMP}` });
  const lock = await send('pm', 'POST', `${RV}/lock`, { comment: `CERT3 WP6 B6X ${h.STAMP}` });
  obs.b6xLock = { submit: h.said(sub), approve: h.said(app), lock: h.said(lock) };
  need(sub.status === 200 && app.status === 200 && lock.status === 200, `X3: B6X's bill could not be locked (${json(obs.b6xLock)})`);
};

// -- B6X: X4, the job again on the locked bill (KA.U5.B6X.aiAfterBaseline) -----------------------------------------------
const b6xAfterBaseline = async () => {
  const t = ctx.b6x;
  await probe('KA.U5.B6X.aiAfterBaseline (X4: the job again on the locked bill)', async () => {
    if ((await boqOf('qs', t.P))?.baseline?.locked !== true) throw probeSetup('KA.U5.B6X.aiAfterBaseline', 'B6X\'s bill is not locked');
    const activeActs = async () => listOf(await dataOf('planner', `${t.P}/activities`)).filter((a) => a.isActive !== false).map((a) => a.id);
    const actsBefore = await activeActs();
    const allocBefore = (await allocationsOf('planner', t.P)).map((a) => a.id);
    const run = await runBoqJob('KA.U5.B6X.aiAfterBaseline', t, t.boqJob, B6XB.stub.afterBaseline, 'B6X X4');
    const actsAfter = await activeActs();
    const allocAfter = await allocationsOf('planner', t.P);
    const newAllocs = allocAfter.filter((a) => !allocBefore.includes(a.id));
    const AB = WP6.U5.aiAfterBaseline;
    const answer = CONTRACT['HR-C14'].aiAfterBaselineAnswer;
    const o = { refused: Boolean(run.error), activitiesCreated: actsAfter.filter((id) => !actsBefore.includes(id)).length, allocationsCreated: newAllocs.length, allocationStatus: [...new Set(newAllocs.map((a) => a.status))].join(',') || null, ...(run.error ? { error: run.error } : {}) };
    obs.l130 = { ...o, newAllocations: newAllocs.map(allocBrief), result: run.result };
    const isValue = (x) => x.activitiesCreated === AB.value.activitiesCreated && x.allocationsCreated === AB.value.allocationsCreated && (!answer || (answer === 'skipped' ? !x.refused : `${x.error?.code}` === answer));
    const isToday = (x) => x.activitiesCreated === AB.today.activitiesCreated && x.allocationsCreated === AB.today.allocationsCreated && x.allocationStatus === AB.today.allocationStatus;
    ka('KA.U5.B6X.aiAfterBaseline', { ref: AB.ref, value: AB.value, today: AB.today, observed: o, verdict: judge(o, isValue, isToday), detail: `the job checks no BOQ or schedule lock before createOfficialBoqActivityAllocation (boq.service.js:651-770: L130); how the fix refuses is its choice (CONTRACT ${answer || 'pending'})` });
  });
};

// -- B6X: U5, the chunker through AI schedule generation (U5.pure.*; WP6ADJ Q3) ---------------------------------------------
/** The recorder's answers to AI schedule generation: the scenario's rows, then one activity per batch. */
const generationAnswers = (rows) => ({
  'schedule-structure': rows,
  'schedule-activities': () => ({ projectSummary: { name: 'CERT3 WP6', startDate: '', endDate: '', totalDuration: '', totalBudget: 0, totalActivities: 1, criticalActivities: 1, totalMilestones: 0 }, activities: [{ id: 'ACT-01', wbs: '1', name: 'CERT3 WP6 chunk probe', phase: 'General', duration: 1, earlyStart: 0, earlyFinish: 1, lateStart: 0, lateFinish: 1, totalFloat: 0, critical: true, isMilestone: false, predecessors: '', budget: 0 }], criticalPath: [], wbs: [], milestones: [] }),
  'schedule-support': { risks: [], longLeadItems: [], assumptions: [], resourceSummary: [] },
  'schedule-resources': [],
});
const b6xPure = async () => {
  const t = ctx.b6x;
  obs.chunker = { path: CHUNKER_PATH, label: CHUNKER_PATH === 'product' ? 'live: AI schedule generation in process on B6X with the recorder stub (WP6ADJ Q3)' : 'unit-level: chunkBoqRows\'s own text evaluated in a vm context, not live evidence (WP6ADJ Q3 fallback)', runs: {} };
  if (CHUNKER_PATH === 'vm') {
    const fn = vmChunker();
    for (const [id, s] of Object.entries(CHUNK_SCENARIOS)) {
      const sizes = vmBatches(fn, scenarioRows(s));
      obs.chunker.runs[id] = { sizes };
      rec(id, sameJson(sizes, s.leaf.value), { expected: s.leaf.value, observed: sizes, detail: 'UNIT-LEVEL (vm): chunkBoqRows evaluated from schedule.service.js, not live evidence (WP6ADJ Q3)' });
    }
    return;
  }
  const pd = await send('pm', 'PATCH', `/projects/${t.id}`, FIXTURE.generation);
  obs.chunker.duration = h.said(pd);
  need(pd.status === 200, `U5: B6X's duration could not be set for AI schedule generation (${h.said(pd)})`);
  for (const [id, s] of Object.entries(CHUNK_SCENARIOS)) {
    await probe(`${id} (B6X: AI schedule generation through the recorder stub)`, async () => {
      const gen = await upload('planner', `${t.P}/schedule/generate`, workbookFile('stage3', `generate-${id}`), { label: `CERT3 WP6 ${id} ${h.STAMP}` });
      const jobId = gen.body?.data?.jobId || null;
      if (gen.status !== 202 || !jobId) throw probeSetup(id, `POST schedule/generate answered ${h.said(gen)} ${gen.body?.error?.message || ''}`);
      t.jobs.push(jobId);
      const job = await jobOf(t, jobId);
      if (job?.type !== 'schedule.generate' || job?.status !== 'queued' || job?.projectId !== t.id) throw probeSetup(id, `job ${jobId} is not B6X's queued schedule.generate job`);
      const out = await withRecorder(`B6X ${id}`, generationAnswers(scenarioRows(s)), async (win) => {
        let result = null;
        let error = null;
        try {
          result = await scheduleService().runScheduleGenerationJob({ job: handlerJob(job), payload: job.payload });
        } catch (e) {
          error = { code: e?.code ?? null, message: String(e?.message || e).slice(0, 300) };
        }
        assertOnlyPath(id, win, { kinds: ['schedule-structure', 'schedule-activities', 'schedule-support', 'schedule-resources'] });
        return { result, error, sizes: win.calls.filter((c) => c.kind === 'schedule-activities').map((c) => c.rows), structureCalls: win.calls.filter((c) => c.kind === 'schedule-structure').length };
      });
      // Completion is judged on the staged revision itself, not on the job's returned revisionId: at HEAD that return
      // is always null because schedule.service.js:2580 re-declares `let stagedRevisionId` inside the block, shadowing
      // :2481 (the progress update at :2618 carries the right id). Finding SCHED-RET-1 (P3), WP-6 debug run 1.
      const label = `CERT3 WP6 ${id} ${h.STAMP}`;
      const staged = out.error ? [] : await ctx.q('select id from "ScheduleRevision" where "projectId" = $1 and label = $2 and source = \'ai\' and status = \'draft\'', [t.id, label]);
      if (out.error || !out.result || staged.length !== 1) throw probeSetup(id, `the generation did not complete: ${json(out.error || { result: out.result, stagedRevisions: staged.length })}`);
      obs.chunker.runs[id] = { sizes: out.sizes, structureCalls: out.structureCalls, stagedRevision: staged[0].id, returnedRevisionId: out.result.revisionId ?? null };
      rec(id, sameJson(out.sizes, s.leaf.value), { expected: s.leaf.value, observed: out.sizes, detail: `live (product path): one activity-generation call per chunkBoqRows batch (schedule.service.js:1929-1956, 2252-2391); input ${s.rows ? `${s.rows} rows, no section` : `sections ${json(s.sections)}`}${s.claudeMd ? '; claudeMd.boqChunk agrees' : ''}` });
    });
  }
};

// -- B6X: Q11 and the end --------------------------------------------------------------------------------------------------
const b6xJobs = async () => { ctx.b6x.cancel = await cancelQueued(ctx.b6x); };
const b6xEnd = async () => {
  const t = ctx.b6x;
  if (!t.cancel) t.cancel = await cancelQueued(t);
  const a = await archive(t);
  rec('S.B6X.archived', a?.status === 200 && Boolean(a?.archivedAt) && t.cancel.left === 0, { observed: { archive: a, queuedLeft: t.cancel.left, cancelled: t.cancel.cancelled.length, refused: t.cancel.refused }, detail: `B6X ${t.id}: no queued job left (WP6ADJ Q11)` });
};

// -- 087-COM: the stored moments and the live reads -----------------------------------------------------------------------
const comFlow = async () => {
  const st = ctx.state['087-COM'];
  const s = storedCom087(st);
  const { P } = ctx.deep['087-COM'];
  const stored = (id) => rec(id, s[id].ok === true, { expected: s[id].expected, observed: s[id].observed, detail: s[id].detail || '' });
  stored('U5.stored.087.bill');
  stored('B1.stored.087.original');
  // U5: the bill now, its designed rows by id and code
  const ids = outOf(st, 'boq').ids || {};
  const items = activeItems(await boqOf('qs', P));
  const missing = Object.entries(ids).filter(([code, id]) => !items.some((i) => i.id === id && i.code === code)).map(([code]) => code);
  const ro = { rows: items.length, designed: Object.keys(ids).length, missing };
  const rx = { rows: D087.boqRows.value, designed: Object.keys(ids).length, missing: [] };
  rec('U5.live.087.rows', sameJson(ro, rx) && ro.designed > 0, { expected: rx, observed: ro, detail: 'the designed rows the build recorded (step boq out.ids); 087-COM\'s own queued boq.parse job is never run (WP6ADJ Q1)' });
  // KA: the rows and the coverage by section (a build record: storedAt the build's boq step)
  const SR = WP6.U5.sectionsReadBack;
  const cov = await dataOf('qs', `${P}/activity-boq-allocations/coverage?groupBy=section`);
  const o = { rows: sectionCounts(items), coverage: coverageSections(cov) };
  obs.sections087 = o;
  ka('KA.U5.087.sections', { ref: SR.ref, value: SR.value['087-COM'], today: SR.today['087-COM'], observed: o, verdict: judge(o, (x) => sameJson(x.rows, SR.value['087-COM']) && sameJson(x.coverage, SR.value['087-COM']), (x) => sameJson(x.rows, SR.today['087-COM']) && sameJson(x.coverage, SR.today['087-COM'])), storedAt: s.boqStoredAt, detail: `rows uploaded by the build at its step boq (${s.boqStoredAt}); the HR-C14 finding ${s.hrc14Finding ? 'kept' : 'absent'}; STORED-PRE-FIX after the HR-C14 fix, strictly at the exit rebuild` });
  // B1: the build's lines, read live
  const lineIds = outOf(st, 'budget-lines').ids || {};
  const all = listOf(await dataOf('cost', `${P}/budget/lines?includeArchived=true`), 'items');
  const read = Object.fromEntries(Object.entries(lineIds).map(([k, id]) => [k, all.find((l) => l.id === id) || null]));
  const typed = B6B.budgetLines.filter((l) => TYPED_KEYS.includes(l.key)).map((l) => `${l.code}:${l.costType}`);
  const sumOf = (keys) => keys.reduce((s2, k) => s2 + (Number.isInteger(cents(read[k]?.originalBudget)) ? cents(read[k].originalBudget) : NaN), 0);
  const oo = { typedFound: typed.every((k) => read[k]), typedSum: sumOf(typed), buildLinesSum: sumOf(Object.keys(read)) };
  const ox = { typedFound: true, typedSum: WP6.B1.original.value, buildLinesSum: WP6.B1.original.value };
  rec('B1.live.087.original', sameJson(oo, ox), { expected: ox, observed: { ...oo, lines: Object.fromEntries(Object.entries(read).map(([k, l]) => [k, cents(l?.originalBudget)])) }, detail: 'the seven typed lines are the cost code and type pairs WP6.B6.budgetLines types (the same seven); the other build lines hold no original' });
  const types = [...new Set(Object.values(read).filter(Boolean).map((l) => l.costType))].sort();
  rec('B1.live.087.costTypes', Object.values(read).every(Boolean) && types.length === D087.costTypes.value, { expected: { costTypes: D087.costTypes.value }, observed: { costTypes: types.length, types, lines: Object.keys(read).length }, detail: 'plan section 3.2: "cost codes and lines for all eight cost types"' });
  obs.static = staticScan();
};

// -- 087-SCH: a read and one PATCH refusal (WP6ADJ Q13) -------------------------------------------------------------------
const schFlow = async () => {
  const st = ctx.state['087-SCH'];
  const { P } = ctx.deep['087-SCH'];
  const SB = WP6.U4.scheduleBaselineLock.value;
  const boq = await boqOf('pm', P);
  const bo = { locked: boq?.baseline?.locked === true, source: boq?.baseline?.source ?? null };
  rec('U4.live.087SCH.lock', sameJson(bo, SB.baseline), { expected: SB.baseline, observed: bo, detail: 'a baselined schedule revision locks the bill (getBoqBaselineLock, boq.service.js:285-301)' });
  const target = outOf(st, 'boq.upload').items?.['S-001'] || null;
  const row = activeItems(boq).find((i) => i.id === target) || null;
  const pt = row ? await deepProbe('087-SCH', 'pm', 'PATCH', `${P}/boq/items/${row.id}`, { description: row.description }, 'a PATCH of S-001 (its own description)') : null;
  const after = row ? activeItems(await boqOf('pm', P)).find((i) => i.id === row.id) || null : null;
  const po = { said: pt ? h.said(pt) : 'not sent (S-001 not found)', unchanged: Boolean(row) && after?.description === row.description && after?.updatedAt === row.updatedAt };
  rec('U4.live.087SCH.patch', Boolean(pt) && h.is(pt, `${SB.patch.status} ${SB.patch.code}`) && po.unchanged, { expected: { said: `${SB.patch.status} ${SB.patch.code}`, unchanged: true }, observed: po, detail: 'the row\'s own description is sent, so even an unexpected acceptance would change no content; assertBoqEditable precedes every write (boq.service.js:2044)' });
};

// -- confirm-first classification from this run's observations -----------------------------------------------------------------
const confirmFirstFlow = () => {
  const v = (id) => knownAnswers[id]?.verdict ?? null;
  const split = (pairs) => {
    const present = []; const absent = []; const gap = [];
    for (const [name, state] of pairs) (state === 'present' ? present : state === 'absent' ? absent : gap).push(name);
    return { present, absent, gap };
  };
  /** A known answer: today (HEAD's recorded behaviour) present, value absent, wrong or not run a gap. */
  const kaState = (id) => (v(id) === 'today' ? 'present' : v(id) === 'value' ? 'absent' : 'gap');
  const yes = (cond) => (cond === null || cond === undefined ? 'gap' : cond ? 'present' : 'absent');
  const passed = (id) => (records[id]?.verdict === 'PASS' ? 'present' : records[id]?.verdict === 'FAIL' ? 'absent' : 'gap');
  const scan = obs.static || staticScan();
  const W = WP6.CF;
  cf('CF.HRC14', { ...split([
    ['L131: the AI job sends every row in one prompt (B6X)', kaState('KA.U5.B6X.aiJobCalls')],
    // L121: no check (TEST_GAPS, the 2026-10-10 ruling): the item is a gap by ruling, so CF.HRC14 reads PARTIAL at best.
    ['L121: a non-AI import refused at the AI limit (TEST GAP: its check removed by the 2026-10-10 ruling)', 'gap'],
    ['L130: the AI job adds an activity and a draft allocation on a locked bill (B6X)', kaState('KA.U5.B6X.aiAfterBaseline')],
    ['no section read back (B6X)', kaState('KA.U5.B6X.sections')],
    ['no section read back (087-COM)', kaState('KA.U5.087.sections')],
    ['a dropped row stays active with no flag (B6)', kaState('KA.U2.omitB005')],
    ['the parser reads no section column (static)', scan.parserReadsSection === null ? 'gap' : yes(scan.parserReadsSection === false)],
    ['the AI job makes one call and batches nothing (static)', scan.boqJobCreateCalls === null ? 'gap' : yes(scan.boqJobCreateCalls === 1 && scan.boqJobBatches === false)],
  ]), detail: `${json({ l131: obs.l131, l130: obs.l130, sections: { B6X: obs.sectionsB6X, '087-COM': obs.sections087 }, dropped: obs.omitB005 }, 1500)}; L121 a TEST GAP (meta.testGaps: ${TEST_GAPS[0].ruling}); HR-C14 undecided (O1)` });
  const reg = obs.register;
  const BR = W.BRorder;
  cf('CF.BRorder', { ...split([
    ['the stored running totals are out of effective-date order', kaState('KA.B6.registerOrder')],
    ['the same answer\'s waterfall is already in effective-date order', !reg ? 'gap' : yes(sameJson(reg.waterfall, BR.today.waterfall) && !sameJson(reg.stored, BR.value.stored))],
    ['createBudgetRevision recomputes nothing (static)', scan.createRevisionRecomputes === null ? 'gap' : yes(scan.createRevisionRecomputes === false)],
  ]), detail: `${json({ register: reg, afterCoApproval: obs.registerAfterCo, healedAsTheBookSays: obs.registerAfterCo ? sameJson(obs.registerAfterCo, BR.today.afterCoApproval) : null, severityEvidence: obs.brSeverityEvidence }, 1500)}; severity decided at this run from the reproduction (WP6ADJ Q6: P1 if the stored figure reaches a calculation, export, report or forecast; P2 if display-only and healed by the next write)` });
  cf('CF.L109', { ...split([
    ['LA locked by the approved CO first', passed('B5.B6.lockedAfterCo')],
    ['the re-point releases LA\'s Original lock', kaState('KA.B5.afterRepoint')],
  ]), detail: `${json(obs.l109)}; P2 proposed (O6)` });
  cf('CF.L110', { ...split([['the archived line\'s actual is missing from the lines\' actual', kaState('KA.B7.archivedActual')]]), detail: `${json(obs.l110)}; P2 proposed (O6)` });
  const l111 = obs.l111;
  const l111Item = (key) => (!l111 ? 'gap' : sameJson(l111[key], W.L111.today[key]) ? 'present' : l111[key]?.status === W.L111.value[key].status ? 'absent' : 'gap');
  cf('CF.L111', { ...split([['a line created at a negative original', l111Item('negativeOriginal')], ['a revision that takes a line below zero accepted', l111Item('revisionBelowZero')]]), detail: `${json(l111)}; P2 proposed (O6)` });
  cf('CF.HRC17', { ...split([['a rejected allocation cannot be submitted again', kaState('KA.A2.resubmitRejected')]]), detail: `${json(obs.hrc17)}; HR-C17 undecided (O3)` });
  const H18 = W.HRC18.value;
  const eighth = H18.budgetCostTypes.filter((type) => !H18.costRecordCategoryFields.includes(type));
  const h18 = obs.hrc18;
  cf('CF.HRC18', { ...split([
    ['the budget register and the ledger take eight cost types, the eighth among them on B6', !h18 || !scan.budgetCostTypes ? 'gap' : yes(sameJson(scan.budgetCostTypes, H18.budgetCostTypes) && h18.othLine === '201' && eighth.every((type) => h18.byTypeCostTypes.includes(type)))],
    ['the activity cost record carries seven category fields, the eighth not among them (static)', !scan.costRecordCategoryFields ? 'gap' : yes(sameJson(scan.costRecordCategoryFields, H18.costRecordCategoryFields))],
  ]), detail: `${json({ observed: h18, budgetCostTypes: scan.budgetCostTypes, costRecordCategoryFields: scan.costRecordCategoryFields, bookCostTypes: WP6.B1.costTypes.value })}; an observation of two vocabularies, no value judged (HR-C18 undecided, O4)` });
  const w0 = obs.wp0boq1;
  const T0 = W.WP0BOQ1;
  const roleItem = (kind, role) => { const got = w0?.[kind]?.[role]; return got === null || got === undefined ? 'gap' : got === T0.today[kind][role] ? 'present' : got === T0.value[kind][role] ? 'absent' : 'gap'; };
  cf('CF.WP0BOQ1', { ...split([
    ['the template refused to the cost controller', roleItem('template', 'cost_controller')],
    ['the template refused to the site engineer', roleItem('template', 'site_engineer')],
    ['the stored upload refused to the cost controller', roleItem('upload', 'cost_controller')],
    ['the stored upload refused to the site engineer', roleItem('upload', 'site_engineer')],
  ]), detail: `${json({ observed: w0, routeGuard: scan.templateGuard })}; the QS reads both (template ${w0?.template?.qs ?? '-'}, upload ${w0?.upload?.qs ?? '-'}); P3 registered, the owner's through HR-A1 (O5)` });
};

// -- the run ------------------------------------------------------------------------------------------------------------------
const main = async () => {
  console.log(`wp6-boq-proof: ${ACTIVE.length} of ${EXPECTED_CHECKS} checks active${ONLY ? ` (--only=${[...ONLY].join(',')})` : ''}${SKIP ? ` (--skip=${[...SKIP].join(',')})` : ''}${PROJECT_FILTER ? ` (--project=${PROJECT_FILTER})` : ''}; sections ${[...selectedSections].join(' ')}; deep projects ${NEED_DEEP.join(', ') || 'none'}; throwaways B6 ${NEED_B6 ? 'yes' : 'no'}, B6X ${NEED_B6X ? `yes (bill ${NEED_B6X_BILL ? 'yes' : 'no'}, chunker ${NEED_PURE ? CHUNKER_PATH : 'no'})` : 'no'}; companies ${NEED_COMPANIES.join(', ')} only; TEST GAP ${TEST_GAPS.map((g) => g.lead).join(', ')}; fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}; in process\n`);
  if (ACTIVE.length !== CHECKS.length) console.log(`not exercised in this run (filtered out): ${CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id).join(', ')}\n`);
  await setup();
  // The deep projects first: reads and the one pre-write refusal, before any throwaway exists.
  if (on('COM')) await h.section('087-COM: stored moments and reads', comFlow);
  if (on('SCH')) await h.section('087-SCH: a read and one PATCH refusal', schFlow);
  // B6X's X0 before B6's B3 (A1.B6.foreignActivity names X-A1); each step in its own section, so a failed one is a setup error.
  if (NEED_B6X) await h.section('B6X: X0 the project, its team and X-A1', async () => { await b6xSetup(); ctx.b6xReady = true; });
  if (NEED_B6) {
    await h.section('B6: B0-B1 the project, activities and cost codes', async () => { await b6Setup(); ctx.b6Ready = true; });
    if (ctx.b6Ready) await h.section('B6: B2 the dry runs, the refused uploads and the import', async () => { await b6Bill(); ctx.b6Billed = true; });
    if (ctx.b6Billed) await h.section('B6: B3 the allocations', async () => { await b6Allocations(); ctx.b6Allocated = true; });
    if (ctx.b6Allocated) await h.section('B6: B4 the re-uploads', async () => { await b6Reupload(); ctx.b6Reuploaded = true; });
    if (ctx.b6Reuploaded) await h.section('B6: B5 the lock and after it', b6Lock);
    if (ctx.b6Ready) await h.section('B6: B6 the budget, the cost, the register', b6Budget);
    if (ctx.b6Billed) await h.section('B6: CF the template and the stored upload', b6CfReads);
  } else {
    for (const id of ['S.B6.create', 'S.B6.fixture', 'S.B6.archived']) rec(id, true, { detail: 'not needed (no selected check runs on B6)' });
  }
  if (ctx.b6) {
    await h.section('B6: Q11 no queued job left', b6Jobs);
    await h.section('B6: the end (archive)', b6End);
  }
  if (NEED_B6X && ctx.b6xReady) {
    if (NEED_B6X_BILL) {
      await h.section('B6X: X1 the 130-row bill', async () => { await b6xBill(); ctx.b6xBilled = true; });
      if (ctx.b6xBilled) {
        await h.section('B6X: X2 the job through the recorder stub', b6xJob);
        await h.section('B6X: X3 the bill locked', async () => { await b6xLock(); ctx.b6xLocked = true; });
        if (ctx.b6xLocked) await h.section('B6X: X4 the job after the baseline', b6xAfterBaseline);
      }
    } else {
      rec('S.B6X.bill', true, { detail: 'not needed (no selected check reads B6X\'s bill)' });
    }
    if (NEED_PURE) await h.section(`B6X: U5 the chunker (${CHUNKER_PATH})`, b6xPure);
  }
  if (ctx.b6x) {
    await h.section('B6X: Q11 no queued job left', b6xJobs);
    await h.section('B6X: the end (archive)', b6xEnd);
  }
  if (!NEED_B6X) for (const id of ['S.B6X.create', 'S.B6X.bill', 'S.B6X.archived']) rec(id, true, { detail: 'not needed (no selected check runs on B6X)' });
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
const THROWAWAY_NAMES = [[B6B.project.name, 'pm'], [B6XB.project.name, 'pm']];
const cleanup = async () => {
  const notes = [];
  for (const step of ctx.cleanup.reverse()) {
    try { notes.push(String(await step())); } catch (error) { notes.push(`cleanup failed: ${error.message}`); }
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
  try {
    if (ctx.q && ctx.orgs['087'] && obs.ai087) obs.ai087.after = await aiUsedOf(ctx.orgs['087'].id);
  } catch (error) { notes.push(`AI counter: ${error.message}`); }
  if (obs.ai087) notes.push(`087's AI counter ${obs.ai087.before} -> ${obs.ai087.after ?? '?'} (recorded residue, WP6ADJ Q11: B6X's handler runs add one each; B6's queued jobs are cancelled, not run)`);
  notes.push(`companies touched: ${Object.keys(ctx.orgs).join(', ') || 'none'} (the L121 ruling: 087 only; L121 a TEST GAP, meta.testGaps)`);
  notes.push(`queued jobs cancelled through the product route: ${ctx.jobsCancelled.map((j) => `${j.project} ${j.cancelled}${j.refused.length ? ` (refused ${j.refused.length})` : ''}`).join(', ') || 'none'}`);
  if (ctx.b6 || ctx.b6x) notes.push(`company-level residue (stamp ${h.STAMP}): the throwaways' documents, revisions and cancelled jobs stay with their archived projects; nothing written on 087-COM or 087-SCH`);
  notes.push(`deep projects: ${ctx.deepWrites.length ? `UNEXPECTED WRITES: ${ctx.deepWrites.join('; ')}` : 'nothing written; the 087-SCH refusal was refused'}`);
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

module.exports = { __wp6: { kaStatus, judge, storedCom087, staticScan, vmChunker, vmBatches, scenarioRows, recorderKind, boqJobRows, scheduleBatchRows, CHECKS, EXPECTED_CHECKS, SECTION_PROJECTS, CF_SOURCES, CATCHERS, FIX_CATCHERS, COLLATERAL, DECIDED_RED, CONTRACT, FIXES, RULES, FIXTURE, CHUNK_SCENARIOS, CHUNKER_PATH, TYPED_KEYS, STATE_STEPS, PERSONAS, NEED_COMPANIES, TEST_GAPS } };

h.run({ main, cleanup });
