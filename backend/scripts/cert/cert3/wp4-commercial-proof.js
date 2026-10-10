'use strict';

/**
 * WP-4 (Commercial core: change, commitments, IPC, pay applications, cash flow) primary proving run: the known-answer run
 * of plan section 4 WP-4 on the cert3d population (docs/certification/OCTAPM_CERT3_PLAN.md section 4 WP-4 :671-732,
 * section 0.1 HR-C1 :49, section 1.1 retention row :90, section 3.2 087-COM :427, 087-COM-B :428, 087-COM-C :429, D2
 * 052-COM :444, D3 006-LITE :449, section 5 HR-C1..C4 :1069-1072, HR-C12/C13/C16 :1080-1084, the defect-fix list
 * :1107-1118 (atomic, idempotent change-event conversion :1109; a commitment-CO approval checks that its parent is still
 * live :1111), section 6.1 E3/E6/E8, section 6.2 WP-4 guards :1148; plan lines as numbered at 48db9e9). Preparation
 * C:\Temp\octapm-cert\scratch\wp4\WP4-PREP.md (+ wp4-checks-draft.json, wp4-mutations-draft.json, derive-k.json); the
 * BINDING integration-owner adjudication C:\Temp\octapm-cert\scratch\wp4\WP4-ADJUDICATION.md (Q1-Q14); moment map
 * build/MOMENT-MAP.md (087-COM rows 106-165, 052 rows 253-254, 006 rows 272-275); answer book answers/commercial.js
 * (WP4.*, deep.087-COM / -B / -C, deep.052-COM, deep.006-LITE, claudeMd.retentionDefault) AFTER the WP-4 book patch
 * (C:\Temp\octapm-cert\scratch\wp4\book\book-insert.js; the proof refuses to load without it).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp4-commercial-proof.js [--only=HRC1,E] [--project=K] [--skip=D2,D3,CF]
 *
 * Filters. Sections split by project, so that a partial population and a mutant both stay where they belong:
 *   S     setup (always runs, for the projects and state files the selected checks need)
 *   HRC1  HR-C1 / L114 / C3 on the throwaway K and the second throwaway K2
 *   E C I P CASH   change events and prime COs, commitments, IPC, pay applications, cash flow on the throwaway K
 *   COM   087-COM: the stored build moments and the live reads and refusals (and the one idempotent rebuild)
 *   COMB  087-COM-B (read only)        COMC  087-COM-C (the one-shot I5 confirmation, WP4ADJ Q7)
 *   D2    052-COM, with every check that reads 052-COM (the mixed 087-COM + 052-COM checks included)
 *   D3    006-LITE                     CF    the confirm-first classifications
 * --only=<sections> keeps those sections, --project=<K|K2|087-COM|087-COM-B|087-COM-C|052-COM|006-LITE|static> the
 * sections that touch that project, --skip=<sections> drops sections. Selecting CF selects every section CF classifies
 * from (HRC1 E C I P CASH COM D2); skipping one of those needs --skip=CF too. A filtered-out check is neither registered
 * nor recorded. The K choreography runs whole whenever one selected check runs on K (its steps depend on each other, as
 * WP-2's P and WP-3's V), except the probes no later step needs and no selected check reads (K17, K18, K19, K25, K26,
 * K27), which a filtered run skips. The primary run, the final run and every mutation run take no flags (mutate-multi.js
 * spawns the proof without arguments).
 *   Debug run on a partial population (087-COM, 087-COM-B, 087-COM-C built; 052-COM and 006-LITE not):
 *     --skip=D2,D3,CF
 *   (COMC consumes 087-COM-C's one-shot confirmation on that population; a second debug run takes the re-run branch.)
 *
 * In process (CERT_INPROCESS=1, through the lock runner only) on the certification database. Every expected figure is
 * an answer-book key (A10); every figure the K and K2 choreographies type is read from a book leaf (WP4.K.*, WP4.K2.*,
 * WP4.I1.currentCert, WP4.DRAFTS1.*, ...). Deep projects are resolved by their exact names through the API as each
 * company's PM (exactly one live project each); build state files are read only for moment figures and ids
 * (C:\Temp\octapm-cert\state\cert3\<code>.json, steps[].out and records[].data/said), with every stored unit named
 * (STORED_UNITS).
 *
 * WHERE EACH CHECK RUNS (the CHECKS table carries it per id):
 *   K          the throwaway project of company 087 this run creates WITHOUT defaultRetentionRate or contractValue and
 *              archives (WP4ADJ Q1; WP4.K.choreography K0-K27): every writing check and every section 6.2 catcher.
 *   K2         the second throwaway (WP4ADJ Q11; WP4.K2): project default 7.5 explicit, contract 10; I2 certified there.
 *   087-COM    live, writing nothing at HEAD (refusals sent only where HEAD refuses before any write, and every one
 *              of them stays refused under every WP-4 mutant), except the one idempotent cost-controller rebuild of
 *              cash flow (CF3 / CF5). stored: every WP-4 build moment.
 *   087-COM-B  read only (C3's commitment).   087-COM-C  the one-shot I5 confirmation and certification (WP4ADJ Q7).
 *   052-COM    reads and pre-write refusals (I3 limits, I4, I8, I9, P3, P4, C2); stored moments.
 *   006-LITE   the stored IPC lane, a live read and the certifier role.   static  source scans for the CF items.
 *
 * Mutation safety (section 6.2 WP-4; mutate-multi.js runs the proof without flags, so every section runs under every
 * mutant): the catchers of M-CONV0, M-LOCK, M-OPEN, M-CEIL (and post-fix M-RET, M-CONV1, CCO-M1) run on K; M-VAR0's
 * catcher reads 052-COM. No deep-project probe turns into a write under any of these mutants: the plan's "convert again"
 * (E1.convertAgain) runs on K's K-E2 after its race, not on 087-COM's E1, which M-CONV0 would convert a second time
 * (a deviation recorded in meta.deviations). Under M-OPENa / M-OPENb the extra or reopened application is voided at
 * once (a restoration on K, recorded as a lead) so the rest of the K choreography still runs and the run exits 2.
 *
 * KNOWN ANSWERS (KA.* and the HR-C1 checks): judged value (pass), today (BLOCKED / known, with the ref, counted
 * separately, never exit 2, while the rule is undecided) or wrong (fail). A decided rule's today fails (the WP-1 ka()
 * rule): HR-C1 is decided (plan section 0.1 :49), and CONVERT-ATOMIC / CCO-PARENT become decided when their section 5
 * defect fix lands (FIXES below). A probe whose own setup fails is a setup error (exit 1), never 'wrong' (R-SET): each
 * such probe runs in its own section.
 * CONFIRM-FIRST (CF.*): plan :726-732 and the register suspects WP4-OVR-1 / WP4-DRAFTS-1, classified from this run's
 * observations as CONFIRMED / PARTIAL / REJECTED / TEST GAP. HR-C1 is decided: CF.HRC1 must be REJECTED (a defect
 * check, RED at HEAD); CF.convertAtomic and CF.CCOparent turn defect checks when their fix lands; the others are
 * reported.
 *
 * HR-C1 (DECIDED; plan section 0.1 :49; fixed in WP-4 after its Codex high-risk plan review, WP4ADJ Q2). Its checks
 * expect the DECIDED behaviour and are RED at HEAD: each is a 'defect' check of rule HR-C1 and records FAIL (exit 2,
 * DEFECT_PRESENT), never a setup error. Only what the decided rule fixes is judged; the fix's contract-visible fields
 * (WP4.HRC1.contract.*) are 'contract pending the HR-C1 plan review' and are judged once the book carries their
 * adjudicated values (CONTRACT['HR-C1'], read from those leaves).
 *
 *   check                   where            judged (decided)                               HEAD (today)
 *   HRC1.projectDisplay     fresh K          an unset default is not shown as a rate         defaultRetentionRate 5
 *   HRC1.contractFirstRead  fresh K          the first read stores no silent rate            retentionRate 5, no source
 *   I1.certifyUnconfigured  fresh K          certification refused, nothing settled          200 certified at 0 / 40,000.00
 *   I1.afterConfiguration   fresh K          after 10%: certified 4,000.00 / 36,000.00       409 IPC_INVALID_CERTIFICATION_STATE
 *   L114.newPeriodItemRate  fresh K          a new period's item takes the contract's 10     0
 *   I2.contractRate         fresh K2         certified 4,000.00 / 36,000.00 (contract 10)    3,000.00 / 37,000.00 (7.5)
 *   C3.noDefaultNoRate      fresh K          a commitment with no rate is refused            201 at 5
 *   HRC1.stored.087COM      stored 087-COM   the unconfigured moments show no silent rate    5 / 5 / items 0 (BLOCKED step)
 *   HRC1.stored.052COM      stored 052-COM   the same, in USD                                the same
 *   HRC1.stored.006LITE     stored 006-LITE  the refusal first (WP4ADJ Q4)                   project 5, contract 5, items 0
 *   CF.HRC1                 fresh K, K2      REJECTED                                        CONFIRMED
 *
 * STORED-PRE-FIX (WP4ADJ Q4; WP4.HRC1.storedPreFix). A stored build moment never changes, so after the HR-C1 fix the
 * three stored checks keep HEAD's observation until the builders are changed and rebuilt. Once the fix commit exists,
 * FIXES['HR-C1'] names it (commit and committedAt, set by the integration owner when the fix lands; the proof checks
 * the time against git) and a stored observation older than that commit that shows exactly the leaves' todays is
 * judged STORED-PRE-FIX: a pass, reported with the register link HR-C1, never a WP-4 failure. Every read on K and K2
 * is strict. The exit run's rebuild (plan section 7 step 5) judges every moment on the fixed code. While the commit is
 * empty every HR-C1 today is a failure.
 *
 * Expected at HEAD on cert3d (after the book patch, no fix commit set): 150 checks + G.5xx; 11 FAIL (the HR-C1 table
 * above), exit 2, DEFECT_PRESENT; harness provisional classification CONFIRMED (11 of 11 defect checks). Known answers
 * BLOCKED (20): KA.E2.concurrent / pendingDelta / midwayOrphans (CONVERT-ATOMIC; KA.E2.concurrent is racy: a single
 * success reads value, a pass), KA.HRC12.secondAccept / archivedCoEvent / dropsBudgetLines (HR-C12), KA.CCO.voidParent
 * / closedParent (CCO-PARENT), KA.C4.sameLine (L108), KA.I3.limits.A130 / patchA130Qty650 (HR-C2),
 * KA.I8.afterReleaseStatus, KA.I11.backToDraft, KA.HRC3.emptyPeriod (HR-C3), KA.P4.payOverNet (C1-TOL),
 * KA.CASH.CF2.advanceInflow (L115), KA.CASH.CF3.period13 (CF-PERIOD), KA.CASH.CF3.deleteSystemRow,
 * KA.CASH.CF4.concurrentRebuilds (L120; racy: a lucky serialisation reads value), KA.I9.statementVsReceivables
 * (HR-C4: CERT-5 decides, CERT-3 records; integration owner 2026-10-10: BLOCKED on HEAD's 9,750.00 disagreement, never a
 * value, since a value would pre-judge HR-C4). CF reported: CF.HRC2, CF.convertAtomic, CF.HRC12, CF.HRC3, CF.HRC4,
 * CF.CCOparent, CF.HRC13, CF.L108, CF.CERT5, CF.OVR1, CF.DRAFTS1, CF.C1TOL (CONFIRMED expected).
 * After the HR-C1 fix with FIXES['HR-C1'] set: the 7 live/fresh HR-C1 checks and CF.HRC1 turn green and the 3 stored
 * ones read STORED-PRE-FIX: exit 0 if nothing else moved. After the convert fix (FIXES['CONVERT-ATOMIC'] set): the three
 * KA.E2 checks and CF.convertAtomic are defect checks judged on their values. After the commitment-CO parent fix
 * (FIXES['CCO-PARENT'] set): the two KA.CCO checks and CF.CCOparent likewise.
 *
 * Adjudication applied (WP4ADJ): Q1 every writing check and every catcher on K (the moment map's rows 110, 114, 115,
 * 124, 136 record the deviation when the proof lands), the deep projects read or sent requests refused before any
 * write, with the named exceptions (Q7 087-COM-C, the idempotent cash-flow rebuild on 087-COM; Q11 moved I2 off
 * 087-COM-B to K2, row 127). Q2 HR-C1's contract pending (CONTRACT['HR-C1'], eight fields). Q3 HR-C1 covers commitments
 * (C3.noDefaultNoRate on K). Q4 STORED-PRE-FIX. Q6 052-COM's E2 left priced and unused. Q7 I5 one-shot with its re-run
 * rule (WP4.I5.rerunRule). Q8 the catchers named in CATCHERS / meta.catchers (M-VAR0 and M-CONV0 now; M-VAR1, M-CONV1,
 * M-RET after their decision or fix). Q9 severities are the journal's, after this run. Q11 K2. Q12 C1-TOL a known
 * answer. Q13 CF-PERIOD registered as WP4-CF-1 when confirmed. Q14 I12 asserts HEAD's 403.
 * EXPECTED_CHECKS: WP4-PREP's 149 + S.K2 (the second throwaway's setup check, adopted with Q11) = 150; G.5xx on top.
 *
 * Exit 0 pass / 2 a check failed / 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp4-commercial-proof.json (every check with its plan reference, answer-book key,
 * expected, observed and verdict in observations.checks; the KA verdicts in observations.knownAnswers; the CF
 * classifications in observations.confirmFirst; the decided-rule table in observations.decidedRules; the fix state in
 * observations.fixes; all written in cleanup, so a setup error still carries what was observed).
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');
const COMMERCIAL = require('./answers/commercial');

const { WP4 } = COMMERCIAL;
const DEEP_BOOK = COMMERCIAL.deep;
const D087 = DEEP_BOOK['087-COM'];
const D087B = DEEP_BOOK['087-COM-B'];
const D087C = DEEP_BOOK['087-COM-C'];
const D052 = DEEP_BOOK['052-COM'];
const D006 = DEEP_BOOK['006-LITE'];
const CLAUDE_MD = COMMERCIAL.claudeMd;

// -- the WP-4 book patch must be applied (G1-G29 leaves; WP4ADJ Q1-Q14) --------------------------------------------
const leafAt = (key) => key.split('.').reduce((node, k) => (node && typeof node === 'object' ? node[k] : undefined), COMMERCIAL);
const WP4_PATCH_LEAVES = [
  'WP4.E3.patchApproved', 'WP4.HRC12.dropsBudgetLines', 'WP4.mutations.commitmentCoParent', 'WP4.C5.outstandingLabel', 'WP4.I5.confirmRequest', 'WP4.I5.rerunRule',
  'WP4.I9.on087.statementInvoiced', 'WP4.I9.on087.receivablesInvoiced', 'WP4.I9.on087.difference', 'WP4.P1.reopenWhileOpen',
  'WP4.HRC1.rule', 'WP4.HRC1.contract.refusalStep', 'WP4.HRC1.contract.refusalStatusCode', 'WP4.HRC1.contract.contractUnconfiguredShape',
  'WP4.HRC1.contract.projectUnconfiguredShape', 'WP4.HRC1.contract.commitmentRefusal', 'WP4.HRC1.contract.reresolveAtCertify',
  'WP4.HRC1.contract.itemOverrideKept', 'WP4.HRC1.contract.explicitNoRetentionInput', 'WP4.HRC1.afterConfiguration.status',
  'WP4.HRC1.afterConfiguration.retention', 'WP4.HRC1.afterConfiguration.net', 'WP4.HRC1.explicitNoRetention.gross',
  'WP4.HRC1.explicitNoRetention.retention', 'WP4.HRC1.explicitNoRetention.net', 'WP4.HRC1.storedPreFix', 'WP4.L114.newPeriodItemRate',
  'WP4.L114.routeBound', 'WP4.K.project', 'WP4.K.team', 'WP4.K.budgetLines', 'WP4.K.bill', 'WP4.K.billTotal', 'WP4.K.allocations', 'WP4.K.progress',
  'WP4.K.commitments', 'WP4.K.payApps', 'WP4.K.changeEvents', 'WP4.K.choreography', 'WP4.K.ipcD.gross', 'WP4.K.ipcD.retention', 'WP4.K.ipcD.net',
  'WP4.K.ipcD.paid', 'WP4.K.ipcD.balance', 'WP4.K.ipcD.paymentStatus', 'WP4.K.ipcD.status', 'WP4.K.ipcD.cashInflow', 'WP4.K.ipcD.ledgerDelta',
  'WP4.K2.project', 'WP4.K2.choreography', 'WP4.K2.itemRetentionRate', 'WP4.CCO.parentVoid', 'WP4.CCO.parentClosed', 'WP4.CCO.parentClosedCommitted',
  'WP4.OVR1.pmWithoutReason', 'WP4.OVR1.financeWithReason', 'WP4.OVR1.review', 'WP4.DRAFTS1.earned', 'WP4.DRAFTS1.draftClaim', 'WP4.DRAFTS1.patches',
  'WP4.DRAFTS1.firstCertify', 'WP4.DRAFTS1.secondCertify', 'WP4.DRAFTS1.overEarnedAtSecond', 'WP4.HRC3.emptyPeriod', 'WP4.IPC.itemsFromAllocations',
];
{
  const missing = WP4_PATCH_LEAVES.filter((key) => { const leaf = leafAt(key); return !leaf || typeof leaf !== 'object' || !('value' in leaf); });
  if (missing.length) throw new Error(`answers/commercial.js carries no WP-4 leaf ${missing.join(', ')}: apply the WP-4 book patch (C:/Temp/octapm-cert/scratch/wp4/book/book-insert.js) first`);
  if (WP4.E2.concurrentConverts.value?.converts !== 5 || WP4.P1.noPeriod.value?.code !== 'VALIDATION_ERROR' || WP4.I1.silentContractRate.today !== 5 || WP4.P4.payOverNet.ref !== 'C1-TOL'
    || !String(WP4.mutations.convertLock.value[0]).startsWith('K.E1.convertAgain') || WP4.I2.retention.ref !== 'HR-C1') {
    throw new Error('answers/commercial.js carries the pre-WP-4 values of WP4.E2.concurrentConverts / P1.noPeriod / I1.silentContractRate / P4.payOverNet / mutations.convertLock / I2.retention (G5, G8, G2, G10, G23, G4): apply the WP-4 book patch first');
  }
}
// CLAUDE.md's "Retention default 5%" is superseded by HR-C1: its known answer is I1.certifyUnconfigured and
// I1.afterConfiguration (claudeMd.retentionDefault, G28; whether CLAUDE.md changes is the owner's, WP4ADJ Q10).
if (!/I1\.certifyUnconfigured/.test(CLAUDE_MD.retentionDefault.derivation) || !/I1\.afterConfiguration/.test(CLAUDE_MD.retentionDefault.derivation)) {
  throw new Error('answers/commercial.js: claudeMd.retentionDefault does not map onto I1.certifyUnconfigured and I1.afterConfiguration (G28)');
}

const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const STATE_DIR = 'C:/Temp/octapm-cert/state/cert3';
const REPO = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(__dirname, '..', '..', '..', 'src');
/** The book's marker for a contract-visible field of a decided fix that waits for its plan review (WP4ADJ Q2). */
const HR_C1_PENDING = 'contract pending the HR-C1 plan review';

const DEEP = {
  '087-COM': { company: '087', name: 'CERT3 Commercial (087-COM)' },
  '087-COM-B': { company: '087', name: 'CERT3 Commercial B (087-COM-B)' },
  '087-COM-C': { company: '087', name: 'CERT3 Commercial C (087-COM-C)' },
  '052-COM': { company: '052', name: 'CERT3 Commercial (052-COM)' },
  '006-LITE': { company: '006', name: 'CERT3 Lite (006-LITE)' },
};

// -- CLI ------------------------------------------------------------------------------------------------------------
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const setOf = (text) => (text ? new Set(text.split(',').map((s) => s.trim()).filter(Boolean)) : null);
const ONLY = setOf(argOf('only'));
const SKIP = setOf(argOf('skip'));
const PROJECT_FILTER = argOf('project');

// -- the fixed list of checks: id, section, plan reference, answer-book key, where it runs ---------------------------
// where: 'K' | 'K2' | '087-COM' | '087-COM-B' | '087-COM-C' | '052-COM' | '006-LITE' | 'stored:<code>' | 'static' | 'setup',
// or a comma list for a check that reads several. The section is the 6th argument (the sections split by project, see
// the header); the setup checks (S.*) carry no answer-book key (WP-1 L5).
// <CHECKS>
const L = (...lines) => `${PLAN_DOC}:${lines.join(',')}`;
const C = (id, planRef, bookKey, where, description, section) => ({ id, section, planRef, bookKey, where, description });
const CHECKS = [
  C('S.book', L('476-480'), null, 'setup', 'the commercial answer book loads with the WP-4 patch (G1-G29; the load guard above) and its figures() rows carry ref: meta.head, the figure count and every key this proof reads', 'S'),
  C('S.state', L('452-472'), null, 'setup', 'the build state files the selected checks read are present with their WP-4 steps done, or BLOCKED only with their moment-map ref (087-COM ipc.I1.certify-unconfigured, 052-COM ipc.I1.certify-unconfigured, 006-LITE retention.unconfigured: HR-C1); 087-COM\'s directory names the vendors K uses; a fix commit, when set, is the one git dates', 'S'),
  C('S.projects', L('427-429', 444, 449), null, 'setup', 'the deep projects the selected checks read resolve by exact name through the API, exactly one live each, matching the state files', 'S'),
  C('S.K.create', L(427), null, 'K', 'K0: K created by the 087 PM WITHOUT defaultRetentionRate or contractValue (WP4.K.project: start 2026-01-05, end 2027-06-30, five_day, EGP, building, remeasurement); team planner, qs, cost_controller, procurement, site_engineer, finance (WP4.K.team)', 'S'),
  C('S.K.fixture', L(427), null, 'K', 'K1-K4: eight activities with the site engineer; cost codes 02-100 and 03-100 with the two budget lines (WP4.K.budgetLines); the bill C-001, B-002, D-001, E-001, F-001 (WP4.K.billTotal 337,500.00); the six approved allocations (WP4.K.allocations); approved progress (WP4.K.progress); each creation asserted', 'S'),
  C('S.K.archived', L(452), null, 'K', 'end: K archived by the PM (archivedAt read back)', 'S'),
  C('S.K2', L(428, 697), null, 'K2', 'K2-0..K2-2 and end: K2 created with defaultRetentionRate 7.5 explicit (WP4.K2.project), the I1-shaped row C-001 at 40%, the contract first read copying 7.5 then PATCHed to 2,000,000.00 at 10; archived at the end (WP4ADJ Q11)', 'S'),

  C('HRC1.projectDisplay', L(49, 692), 'WP4.HRC1.contract.projectUnconfiguredShape', 'K', 'K5, the PM GET /projects/K: an unset default is not shown as a rate (contract pending: the not-configured shape); HEAD shows defaultRetentionRate 5 (project.service.js:281) - HR-C1 decided', 'HRC1'),
  C('HRC1.contractFirstRead', L(49, 696), 'WP4.I1.silentContractRate', 'K', 'K5, the QS GET /prime-contract (the first read creates the row): no silent rate stored (contract pending: WP4.HRC1.contract.contractUnconfiguredShape); HEAD stores and serves 5 with no source (prime-contract.service.js:264-266) - HR-C1 decided', 'HRC1'),
  C('I1.certifyUnconfigured', L(49, 90, 696), 'WP4.I1.certifyUnconfigured', 'K', 'K7, K-IPC-01 (C-001/K-A220 400 m3 = WP4.I1.currentCert 40,000.00, no rate sent), value established (K6), submitted; the PM certifies: refused 4xx (code: contract pending), still submitted, nothing settled; HEAD 200 certified at item rate 0, retention 0.00, net 40,000.00 - HR-C1 decided', 'HRC1'),
  C('I1.explicitNoRetention', L(49, 696), 'WP4.HRC1.explicitNoRetention', 'K', 'K9, the contract configured with an explicit "no retention" (WP4.HRC1.contract.explicitNoRetentionInput; HEAD {retentionRate: 0}); K-IPC-NR F-001/K-A240 1,000 m3 certified: 10,000.00 / 0.00 / 10,000.00 (green before and after the fix)', 'HRC1'),
  C('I1.afterConfiguration', L(90, '696-697'), 'WP4.HRC1.afterConfiguration', 'K', 'K10, the contract PATCHed to 10; the PM certifies K-IPC-01 again (a new period with the same claim if the contract says certification does not re-resolve): certified 4,000.00 / 36,000.00; HEAD 409 IPC_INVALID_CERTIFICATION_STATE (K7 settled it at 0) - HR-C1 decided', 'HRC1'),
  C('L114.newPeriodItemRate', L(726), 'WP4.L114.newPeriodItemRate', 'K', 'K11, K-IPC-D opened after K10: its D-001/K-A200 item reads retentionRate 10 before any claim; HEAD 0 (the project default, never the contract) - HR-C1 decided (L114 folded in)', 'HRC1'),
  C('L114.routeBound', L(726), 'WP4.L114.routeBound', 'K', 'K11, PATCH a K-IPC-D item {retentionRate: 150}: \'400 VALIDATION_ERROR\' (routes/ipc.js:95; L114\'s "no upper bound" REJECTED)', 'HRC1'),
  C('I2.contractRate', L(428, 697), 'WP4.I2.retention', 'K2', 'K2-3/K2-4, K2-IPC-01 C-001 400 m3 claimed WITHOUT retentionRate, submitted, certified by the PM: retention 4,000.00, net 36,000.00 (WP4.I2.retention / net; the draft item rate recorded as WP4.K2.itemRetentionRate); HEAD 3,000.00 / 37,000.00 - HR-C1 decided', 'HRC1'),
  C('C3.noDefaultNoRate', L(692), 'WP4.C3.noDefaultNoRate', 'K', 'K8, the QS POST /commitments K-SC-NR with no retentionRate on K (no default): refused 4xx (code: contract pending, WP4.HRC1.contract.commitmentRefusal); HEAD 201 draft at 5 (commitment.service.js:381) - HR-C1 decided (WP4ADJ Q3)', 'HRC1'),
  C('C3.projectDefault', L(428, 692), 'WP4.C3.projectDefault', 'stored:087-COM-B,087-COM-B', 'stored commitment.C3 and the live GET of 087-COM-B\'s commitment C3 (no rate of its own): retentionRate 7.5 = the explicit project default (deep.087-COM-B.projectRetention); the contract 10 (primeContractRetention)', 'COMB'),
  C('HRC1.stored.087COM', L(427, 696), 'WP4.HRC1.storedPreFix', 'stored:087-COM', 'stored 087-COM moments: project.retention-unset (shows 5), contract.value first read (stores 5), ipc.I1 (items at 0, 40,000.00 / 0.00 / 40,000.00) with the BLOCKED HR-C1 step, ipc.02 (item rate before the claim 0): the leaves\' todays (WP4.HRC1.storedPreFix); FAIL before the fix, STORED-PRE-FIX after it - HR-C1 decided', 'COM'),
  C('HRC1.stored.052COM', L(444, 696), 'WP4.HRC1.storedPreFix', 'stored:052-COM', 'the same on 052-COM, in USD (deep.052-COM.I1.*; ipc.I8 item rate before the claim 0)', 'D2'),
  C('HRC1.stored.006LITE', L(449), 'deep.006-LITE.retentionDefaultCase', 'stored:006-LITE', 'stored retention.unconfigured, BLOCKED HR-C1 with the observed project 5 / contract 5 / items 0, no certificate (deep.006-LITE.retentionDefaultCase.today)', 'D3'),

  C('E1.stored', L(683), 'WP4.E1', 'stored:087-COM', 'ce.E1 records: lines 6,000.00 + 4,000.00 (WP4.E1.romTotal), pricing after the RFQ, priced after the accept (quoted 5,700.00 + 3,800.00 = WP4.E1.quoteA), converted to a draft CO of 9,500.00 (convertedValue, coStatus, eventStatus)', 'COM'),
  C('E1.convertAgain', L(683), 'WP4.E1.convertAgain', 'K', 'K17, after the race: the QS converts K-E2 once more: \'409 CHANGE_EVENT_CONVERTED\', no new CO (a deviation from 087-COM\'s E1: M-CONV0 would convert it a second time; collateral catcher of M-CONV0)', 'E'),
  C('E1.patchConverted', L(683), 'WP4.E1.patchConverted', '087-COM', 'the QS PATCH 087-COM\'s converted E1 {notes}: \'409 CHANGE_EVENT_LOCKED\'', 'COM'),
  C('E1.voidConverted', L(683), 'WP4.E1.voidConverted', '087-COM', 'the PM voids E1 with a reason: \'409 CHANGE_EVENT_CONVERTED\'', 'COM'),
  C('E1.voidWithoutReason', L(683), 'WP4.E1.voidWithoutReason', '087-COM', 'the PM voids 087-COM\'s open event (ce.states open) with no reason: \'400 VALIDATION_ERROR\' (the route answers first; the service would refuse too)', 'COM'),
  C('E1.deleteWithRfqs', L(683), 'WP4.E1.deleteWithRfqs', '087-COM', 'the PM DELETE 087-COM\'s pricing event (an RFQ out): \'409 CHANGE_EVENT_LOCKED\'', 'COM'),
  C('K.E1.converted', L(683), 'WP4.E1', 'K', 'K16, K-E1: lines 6,000.00 + 4,000.00, the RFQ to vendor A quoted 5,700.00 + 3,800.00 through the portal, accepted (priced), converted: a draft CO of 9,500.00, the event converted', 'E'),
  C('K.E1.convertAgain', L(683, 1148), 'WP4.E1.convertAgain', 'K', 'K16, the QS converts K-E1 again: \'409 CHANGE_EVENT_CONVERTED\', the CO register unchanged (catcher of M-CONV0, writes only on K)', 'E'),
  C('KA.E2.concurrent', L(684, 1109), 'WP4.E2.concurrentConverts', 'K', 'K17, K-E2 priced; five concurrent QS converts: value one 2xx, four \'409 CHANGE_EVENT_CONVERTED\', one CO; today k >= 2 succeed (racy) - CONVERT-ATOMIC', 'E'),
  C('KA.E2.pendingDelta', L(684), 'WP4.E2.pendingDelta', 'K', 'K17, pendingChangesValue across the converts: value +9,500.00; today k x 9,500.00 (k >= 2) - CONVERT-ATOMIC', 'E'),
  C('KA.E2.midwayOrphans', L(684, 1109), 'WP4.E2.midwayRefusalOrphans', 'K', 'K18, K-E3 (the RFQ carries K-SC-V, accepted without createCommitmentChangeOrder), K-SC-V voided, convert: value 0 orphan prime COs and the event not converted; today \'409 COMMITMENT_LOCKED\', 1 orphan draft CO, event priced - CONVERT-ATOMIC', 'E'),
  C('D2.E1.stored', L(444, 683), 'deep.052-COM.E1', 'stored:052-COM', '052-COM ce.E1 records in USD (deep.052-COM.E1.*); ce.E2 left priced (WP4ADJ Q6)', 'D2'),
  C('E3.createWithStatusPending', L(685), 'WP4.E3.createWithStatusPending', 'K', 'K15, the QS POST /change-orders {status: \'pending\'}: \'400 VALIDATION_ERROR\'; nothing created', 'E'),
  C('E3.submitWithoutSummaries', L(685), 'WP4.E3.submitWithoutSummaries', 'K', 'K15, a K draft CO with no impact summaries submitted: \'400 CHANGE_ORDER_IMPACT_SUMMARY_REQUIRED\'', 'E'),
  C('E3.submitWithoutDocument', L(685), 'WP4.E3.submitWithoutDocument', 'K', 'K15, the same CO with both summaries and an activity link, no document: \'400 CHANGE_ORDER_IMPACT_PROOF_REQUIRED\'', 'E'),
  C('E3.rejectWithoutReason', L(685), 'WP4.E3.rejectWithoutReason', 'K', 'K15, the PM rejects the pending K-CO-B with no reason: \'400 VALIDATION_ERROR\'', 'E'),
  C('E3.reopenRejected', L(685), 'WP4.E3.reopenRejected', 'K', 'K15, K-CO-B rejected with a reason, then reopened: draft', 'E'),
  C('E3.archivePendingDelta', L(685), 'WP4.E3.archivePendingDelta', 'K', 'K15, the PM archives the pending K-CO-40 (40,000.00): pendingChangesValue -40,000.00 (a deviation from 087-COM\'s CO-40, MOMENT-MAP row 114)', 'E'),
  C('E3.patchApproved', L(674, 685, 1148), 'WP4.E3.patchApproved', 'K', 'K14, the QS PATCH the approved K-CO-I3 {value 8000}: \'409 CHANGE_ORDER_APPROVED_LOCKED\', value unchanged (catcher of M-LOCK / M-LOCKa, writes only on K)', 'E'),
  C('E3.archiveApproved', L(674, 685, 1148), 'WP4.E3.archiveApproved', 'K', 'K14, the PM DELETE the approved K-CO-I3: \'409 CHANGE_ORDER_APPROVED_LOCKED\', not archived (catcher of M-LOCK / M-LOCKb)', 'E'),
  C('E4.split', L(674, 686), 'WP4.E4', '087-COM', 'GET 087-COM\'s budget lines 01-100/labour and 02-100/material: CO-SPLIT\'s change_order rows 6,000.00 and 4,000.00 (+10,000.00)', 'COM'),
  C('E4.splitMismatch', L(686), 'WP4.E4.splitMismatch', 'K', 'K15, the QS POST a 10,000.00 CO split 6,000.00 + 3,000.00: \'400 CHANGE_ORDER_ALLOCATION_MISMATCH\'; nothing created', 'E'),
  C('E5.stored', L(687), 'WP4.E5', 'stored:087-COM', 'contract.after-CO-125: pending 40,000.00, approved 125,000.00, revised 2,125,000.00 (WP4.E5.*)', 'COM'),
  C('E5.contractEnd', L(427, 687), 'deep.087-COM.contractEnd', '087-COM', 'GET /prime-contract and the CO register now: approved 147,000.00, pending 49,500.00, revised 2,147,000.00, each listed CO in its book state', 'COM'),
  C('E5.budgetRevision', L(674), 'WP4.E5.budgetRevision', '087-COM', 'GET /budget-revisions: BR-<CO-125 ref> approved, 125,000.00, linked to CO-125', 'COM'),
  C('E6.deductiveCo', L(688), 'WP4.E6.deductiveCo', 'K', 'K15, the QS POST a CO of value -1,000.00: \'400 VALIDATION_ERROR\' (today\'s answer; HR-C13 undecided, CF.HRC13 reports)', 'E'),
  C('KA.HRC12.secondAccept', L(728, 1080), 'WP4.HRC12.secondAcceptOnSameLine', 'K', 'K19, K-TWO: one line, RFQs to vendors A and B, both quoted, A accepted; accept B: value 409 (code not asserted); today 200, both accepted - HR-C12', 'E'),
  C('KA.HRC12.archivedCoEvent', L(728, 1080), 'WP4.HRC12.archivedCoEvent', 'K', 'K19, K-ARC converted, its draft CO archived by the PM: value the event back to priced; today converted and stuck (convert and void both refused) - HR-C12', 'E'),
  C('KA.HRC12.dropsBudgetLines', L(1080), 'WP4.HRC12.dropsBudgetLines', 'K', 'K16, K-E1\'s CO carries its lines\' budget line (value); today no budgetLineId and no budget allocations - HR-C12', 'E'),
  C('RFI.stored', L(427), 'WP4.rfiCo', 'stored:087-COM', 'co.RFI: the RFI converted to a draft CO of 4,500.00, approved; its 4,500.00 in the approved changes (WP4.rfiCo.*)', 'COM'),
  C('RFI.convertTwice', L(427), 'WP4.rfiCo.convertTwice', '087-COM', 'the PM POST /rfi/<RFI>/convert-to-change again: \'409 RFI_ALREADY_CONVERTED\'', 'COM'),

  C('C1.submitNoLines', L(690), 'WP4.C1.submitNoLines', 'K', 'K20, a K draft commitment with no lines submitted: \'409 COMMITMENT_LINES_REQUIRED\'', 'C'),
  C('C1.submitNoVendor', L(690), 'WP4.C1.submitNoVendor', 'K', 'K20, with lines and no vendor: \'409 COMMITMENT_VENDOR_REQUIRED\'', 'C'),
  C('C1.qsApprove', L(690), 'WP4.C1.qsApprove', 'K', 'K20, the QS approves the pending K-SC-C1: \'403 FORBIDDEN\'', 'C'),
  C('C1.returnWithoutReason', L(690), 'WP4.C1.returnWithoutReason', 'K', 'K20, the PM returns K-SC-C1 with no reason: \'400 VALIDATION_ERROR\'', 'C'),
  C('C1.executeWithoutDocument', L(690), 'WP4.C1.executeWithoutDocument', 'K', 'K20, the PM executes the approved K-SC-C1 with no document: \'400 COMMITMENT_DOCUMENT_REQUIRED\'', 'C'),
  C('C1.stored.insurance', L(690), 'WP4.C1.insuranceMissing', 'stored:087-COM,stored:052-COM', 'SC-002 refusals at the build: \'409 COMMITMENT_INSURANCE_MISSING\' and \'400 COMMITMENT_OVERRIDE_REASON_REQUIRED\' on both companies (WP4.C1.*, deep.052-COM.C1.*)', 'D2'),
  C('C1.linesAfterApproval', L(675, 690), 'WP4.C1.linesAfterApproval', 'K', 'K20, the QS PUT /lines on the approved K-SC-C1: \'409 COMMITMENT_LOCKED\'', 'C'),
  C('C1.voidExecuted', L(690), 'WP4.C1.voidExecuted', '087-COM', 'the PM DELETE 087-COM\'s executed SC-001 WITH a reason: \'409 COMMITMENT_TRANSITION_INVALID\' (G7)', 'COM'),
  C('C2.stored', L(691), 'WP4.C2', 'stored:087-COM,stored:052-COM', 'SC-001 executed at 100,000.00 and its change-order step done on both companies (the book\'s committed figures asserted at each moment by the build), the CO states as the book lists them', 'D2'),
  C('C2.live', L(691), 'WP4.C2.committedCoApproved', '087-COM,052-COM', 'GET SC-001 now on both companies: revised 110,000.00 (WP4.C2.committedCoApproved, deep.052-COM.C2.committedCoApproved)', 'D2'),
  C('C2.approvedNotExecuted', L(675), 'WP4.C2.approvedNotExecuted', 'K', 'K20, the PM approves K-SC-C1 (10,000.00 on 03-100): committed on its budget line moves by 0.00', 'C'),
  C('C2.coOnClosed', L(675), 'WP4.C2.coOnClosed', 'K', 'K18 and K21, a commitment CO POSTed on the void K-SC-V and on the closed K-PC-CL: \'409 COMMITMENT_LOCKED\' each', 'C'),
  C('KA.CCO.voidParent', L(731, 1111), 'WP4.CCO.parentVoid', 'K', 'K18, a pending CO on K-SC-V, the parent voided, the PM approves the CO: value refused (409; code chosen by the fix); today 200 approved, nothing posted - CCO-PARENT', 'C'),
  C('KA.CCO.closedParent', L(731, 1111), 'WP4.CCO.parentClosed', 'K', 'K21, a pending +1,000.00 CO on K-PC-CL (purchase order, executed, then closed), the PM approves: value refused and committed stays 5,000.00 (WP4.CCO.parentClosedCommitted); today 200 and committed 6,000.00 after closeout - CCO-PARENT', 'C'),
  C('KA.C4.sameLine', L(693, 732), 'WP4.C4.sameLine', '087-COM', 'PC-001\'s committed and PA-PC1\'s actual (GET /budget/lines, /cost/reconciliation/explain): value the same budget line; today committed 02-100/material, actual 02-100/subcontract - L108', 'COM'),
  C('C4.actualPosted', L(693), 'WP4.C4.actualPosted', '087-COM', 'PA-PC1\'s ledger entries (sub_pay_app) total +1,000.00', 'COM'),
  C('C5.closeWithRetentionHeld', L(694), 'WP4.C5.closeWithRetentionHeld', 'K', 'K24, K-SC5\'s final PA-K5 approved on the closeout gate\'s override and paid 9,000.00; the PM closes K-SC5 without an override: \'409 CLOSEOUT_OUTSTANDING\', error.details.outstanding naming \'Retention released\' (WP4.C5.outstandingLabel; HR-C13 undecided)', 'C'),

  C('I3.limits.A120', L(698), 'WP4.I3.A120LimitQuantity', '052-COM', 'GET 052-COM IPC-01 (draft): the B-002/A120 item\'s certificationReview approvedLimitQuantity 250, approvedLimitAmount 37,500.00 (catcher of M-VAR0, read only)', 'D2'),
  C('KA.I3.limits.A130', L(698, 727), 'WP4.I3.A130LimitQuantity', '052-COM', 'the B-002/A130 item: value 600 / 90,000.00; today 650 / 97,500.00 - HR-C2', 'D2'),
  C('KA.I3.patchA130Qty650', L(698), 'WP4.I3.patchA130Qty650', 'K', 'K13, K-IPC-I3 (a draft after K-CO-I3 is approved): PATCH the B-002/K-A130 item qty 650: value \'400 IPC_ALLOCATION_QTY_EXCEEDED\'; today 200 (limit 650) - HR-C2', 'I'),
  C('I4.patchItemStatus', L(699), 'WP4.I4.patchItemStatus', '052-COM', 'the QS PATCH an IPC-01 item {status: \'certified\'}: \'400 IPC_ITEM_STATUS_DIRECT_UPDATE_FORBIDDEN\'', 'D2'),
  C('I4.submitTwice', L(699), 'WP4.I4.submitTwice', '052-COM', 'the QS submit IPC-03 (submitted): \'409 IPC_INVALID_SUBMISSION_STATE\'', 'D2'),
  C('I4.patchAfterSubmit', L(699), 'WP4.I4.patchAfterSubmit', '052-COM', 'the QS PATCH an IPC-03 item: \'409 IPC_PERIOD_NOT_EDITABLE\'', 'D2'),
  C('I4.certifyDraft', L(699), 'WP4.I4.certifyDraft', '052-COM', 'the PM certify IPC-01 (draft): \'409 IPC_INVALID_CERTIFICATION_STATE\'', 'D2'),
  C('I4.invoiceBeforeCertify', L(699), 'WP4.I4.invoiceBeforeCertify', '052-COM', 'the PM issue an invoice on IPC-03 (submitted): \'409 IPC_CERTIFICATE_NOT_CERTIFIED\'', 'D2'),
  C('I4.paymentBeforeInvoice', L(699), 'WP4.I4.paymentBeforeInvoice', '087-COM', 'finance pays 087-COM IPC-07 (certified, no invoice): \'409 IPC_INVOICE_REQUIRED\'', 'COM'),
  C('I4.secondInvoice', L(699), 'WP4.I4.secondInvoice', '052-COM', 'the PM issue a second invoice on IPC-02: \'409 IPC_INVOICE_ALREADY_ISSUED\'', 'D2'),
  C('I4.periodTwice', L(699), 'WP4.I4.periodTwice', '052-COM', 'the QS POST /ipc {period: <IPC-01\'s label>}: \'400 IPC_PERIOD_EXISTS\'', 'D2'),
  C('D2.stored.ipc03', L(444, 699), 'deep.052-COM.ipc03', 'stored:052-COM', 'ipc.I4-submitted: IPC-03 submitted, 12,000.00 / 1,200.00 / 10,800.00 (deep.052-COM.ipc03.*)', 'D2'),
  C('I5.stored', L(429, 700), 'WP4.I5.certifyOnBoqFallback', 'stored:087-COM-C', 'contract.fallback (boq_fallback, 76,000.00, rate 10) and ipc.01 (60,000.00 / 6,000.00 / 54,000.00, submitted) refused \'409 CONTRACT_VALUE_NOT_ESTABLISHED\' at the build', 'COMC'),
  C('I5.gateLive', L(700), 'WP4.I5.certifyOnBoqFallback', '087-COM-C', 'the PM certify IPC-01 now: \'409 CONTRACT_VALUE_NOT_ESTABLISHED\', still submitted; on a re-run (IPC-01 certified, WP4.I5.rerunRule) the gate is judged on the record: the build\'s refusal and the certification after the confirmation\'s audit event', 'COMC'),
  C('I5.afterValueEntered', L(700), 'WP4.I5.afterValueEntered', '087-COM-C', 'the PM PATCH /prime-contract {confirmOriginalValue: true} (WP4.I5.confirmRequest): 200, 76,000.00, contract_entry, the contract.manage audit event \'confirmed\'; the PM certify: certified 60,000.00 / 6,000.00 / 54,000.00 (one-shot, WP4ADJ Q7)', 'COMC'),
  C('I6.stored', L(701), 'WP4.I6', 'stored:087-COM', 'ipc.04: \'400 IPC_PM_OVERRIDE_REASON_REQUIRED\', finance \'403 IPC_PM_OVERRIDE_REQUIRED\', the PM with a reason certified, overage 7,500.00, net 6,000.00 (deep.087-COM.ipc04.*)', 'COM'),
  C('I6.qsCertify', L(701), 'WP4.I6.qsCertify', '087-COM', 'the QS certify 087-COM IPC-09: \'403 FORBIDDEN\'', 'COM'),
  C('I6.setupObstacle', L(701), 'WP4.I6.setupObstacle', '087-COM', 'the QS PATCH IPC-10\'s B-002/A130 item qty 200: \'400 IPC_APPROVED_PROGRESS_EXCEEDED\'', 'COM'),
  C('I7.stored', L(702), 'WP4.I7', 'stored:087-COM', 'ipc.02 cap 8,500.00 / net 89,000.00; ipc.05 tax 4,387.50 / 92,137.50; ipc.08 recovery 9,750.00 / 78,000.00; the contract terms (deep.087-COM.retentionCapRate / advance)', 'COM'),
  C('I7.live', L(702), 'WP4.I7', '087-COM', 'GET 087-COM IPC-02, IPC-05, IPC-08 now: the certified figures unchanged', 'COM'),
  C('I7.deductionWithoutNote', L(702), 'WP4.I7.deductionWithoutNote', '087-COM', 'the QS PATCH IPC-10 adjustments {deductions: 1000} with no note: \'400 IPC_DEDUCTION_REASON_REQUIRED\'', 'COM'),
  C('I8.stored', L(703), 'WP4.I8', 'stored:087-COM,stored:052-COM', 'ipc.03 / ipc.I8 records: over-balance 400, paid, over-held release 400, release (partially_paid, 9,750.00 due), second payment (paid, amountPaid 97,500.00)', 'D2'),
  C('I8.live', L(703), 'WP4.I8.paySecond', '087-COM,052-COM', '087-COM IPC-03 and 052-COM IPC-02 now: paid / paid, retention released, amountPaid 97,500.00, balanceDue 0.00', 'D2'),
  C('I8.cashInflowWithoutRebuild', L(678, 703), 'WP4.I8.cashInflowWithoutRebuild', '087-COM,052-COM', 'GET /cash-flow before this run\'s rebuild: 087-COM 2026-05 inflow 87,750.00 and 052-COM 2026-08 inflow 87,750.00', 'D2'),
  C('KA.I8.afterReleaseStatus', L(703, 729), 'WP4.I8.afterReleaseStatus', 'stored:087-COM,stored:052-COM', 'the release answers\' certificates: value status certified with paymentStatus partially_paid; today paid - HR-C3', 'D2'),
  C('KA.I9.statementVsReceivables', L(704, 730), 'WP4.I9', '052-COM,087-COM', 'statement.invoiced vs receivables.invoiced: 052-COM 87,750.00 vs 97,500.00 (WP4.I9.*), 087-COM 356,637.50 vs 366,387.50 (WP4.I9.on087.*); the disagreement 9,750.00 recorded (HR-C4: CERT-5 decides, CERT-3 records)', 'D2'),
  C('I10.live', L(705), 'WP4.I10', 'stored:087-COM,087-COM', 'IPC-07 stored and now: grossThisPeriod 102,500.00, materialsOnSite 5,000.00, totalRet 9,750.00, advanceRecovery 0, deductions 0, taxAmount 0, netPayable 92,750.00', 'COM'),
  C('KA.I11.backToDraft', L(706, 729), 'WP4.I11.submittedBackToDraft', '087-COM,static', 'a route back to draft for a submitted certificate: value one exists; today none (no such route in routes/ipc.js; the QS PATCH an IPC-09 item: \'409 IPC_PERIOD_NOT_EDITABLE\') - HR-C3', 'COM'),
  C('I12.pmPayment', L(707), 'WP4.I12.pmRecordsPayment', '087-COM', 'the PM POST /ipc/IPC-06/payments {amount 1}: \'403 FORBIDDEN\' (payment.record is finance only; L211, owner question HR-A3, WP4ADJ Q14)', 'COM'),
  C('KA.HRC3.emptyPeriod', L(729, 1071), 'WP4.HRC3.emptyPeriod', 'K', 'K26, K-IPC-E with nothing claimed, submitted, the PM certifies: value refused (409, code not asserted); today 200 certified at 0.00, retention released - HR-C3', 'I'),
  C('IPC.itemsFromAllocations', L(676), 'WP4.IPC.itemsFromAllocations', '087-COM', '087-COM IPC-10\'s items are exactly the 11 approved allocations, one each, none without one', 'COM'),
  C('K.IPC.D', L(676, 703), 'WP4.K.ipcD', 'K', 'K12, K-IPC-D (D-001 1,000 m3 at the explicit 10%): certified 97,500.00 / 9,750.00 / 87,750.00, invoiced, 80,000.00 paid on 2026-09-15: certified, partially_paid, balance 7,750.00 (= WP4.existing stage10.*)', 'I'),
  C('IPC.noCost', L(676), 'WP4.K.ipcD.ledgerDelta', 'K', 'K12, K\'s ledger total (GET /cost/reconciliation) unchanged across K-IPC-D\'s certify, invoice and payment: client money is not cost', 'I'),
  C('K.cashInflow', L(678), 'WP4.K.ipcD.cashInflow', 'K', 'K12, K\'s 2026-09 inflow 80,000.00 right after the payment, no rebuild', 'I'),
  C('D3.stored.ipc', L(449), 'deep.006-LITE.ipcAfterConfiguration', 'stored:006-LITE', 'retention.configure (10) and the IPC lane: certified 97,500.00 / 9,750.00 / 87,750.00, paid 87,750.00; submitted by the QS, certified by the PM, paid by finance', 'D3'),
  C('D3.live.ipc', L(449), 'deep.006-LITE.ipcAfterConfiguration.endState', '006-LITE', '006-LITE\'s IPC now: paid / paid, retention held, balance 0.00, the certified figures', 'D3'),
  C('D3.certifierRole', L(449), 'deep.006-LITE.certifierRole', '006-LITE', 'the 006 QS certifies the IPC: \'403 FORBIDDEN\'', 'D3'),

  C('P1.notExecuted', L(709), 'WP4.P1.notExecuted', 'K', 'K20, the QS POST /pay-apps against the approved, never executed K-SC-C1: \'409 SUB_PAY_APP_COMMITMENT_NOT_EXECUTED\'', 'P'),
  C('P1.noPeriod', L(709), 'WP4.P1.noPeriod', 'K', 'K22, with no periodLabel: \'400 VALIDATION_ERROR\' (G8: the route answers before the service\'s SUB_PAY_APP_PERIOD_REQUIRED)', 'P'),
  C('P1.secondOpen', L(677, 709, 1148), 'WP4.P1.secondOpen', 'K', 'K22, PA-K1 a draft on K-SC1; a second POST: \'409 SUB_PAY_APP_OPEN_EXISTS\', details.reasonCode DUPLICATE_PERIOD, nothing created (catcher of M-OPEN / M-OPENa)', 'P'),
  C('P1.reopenWhileOpen', L(677, 1148), 'WP4.P1.reopenWhileOpen', 'K', 'K23, PA-K3a approved and unpaid, PA-K3b a draft on K-SC3; the PM reopens PA-K3a with a reason: \'409 SUB_PAY_APP_OPEN_EXISTS\', still approved (catcher of M-OPEN / M-OPENb)', 'P'),
  C('P1.submitEmpty', L(709), 'WP4.P1.submitEmpty', 'K', 'K22, submit PA-K1 with nothing claimed: \'409 SUB_PAY_APP_EMPTY\'', 'P'),
  C('P2.exceedsSchedule', L(710), 'WP4.P2.exceedsSchedule', 'K', 'K22, PATCH PA-K1\'s line 120,000.00 (scheduled 100,000.00): \'400 SUB_PAY_APP_EXCEEDS_SCHEDULED\'', 'P'),
  C('P2.overClaim', L(710), 'WP4.P2.overClaimRefusal', 'K', 'K22, 60,000.00 claimed at 50% (cap WP4.P2.progressCap 50,000.00), submit: \'400 SUB_PAY_APP_OVER_CLAIM\', details.overClaimAmount 10,000.00', 'P'),
  C('P3.stored', L(711), 'WP4.P3', 'stored:087-COM,stored:052-COM', 'PA-01 on both companies: approved 50,000.00 / 5,000.00 / 45,000.00 (revision 0), revoked to draft (revision 1), re-approved', 'D2'),
  C('P3.ledger.087', L(677, 711), 'WP4.P3.approvePosts', '087-COM', 'GET 087-COM /cost/reconciliation/explain?activityId=A310: PA-01\'s entries +50,000.00, -50,000.00 (reversal), +50,000.00; source total 50,000.00', 'COM'),
  C('P3.ledger.052', L(711), 'deep.052-COM.P3', '052-COM', 'the same on 052-COM\'s PA-01, in USD', 'D2'),
  C('P3.qsRevoke', L(711), 'WP4.P3.qsRevoke', '087-COM', 'the QS reopen 087-COM PA-03 (approved, unpaid) with a reason: \'403 SUB_PAY_APP_REVOKE_FORBIDDEN\'', 'COM'),
  C('P3.revokeWithoutReason', L(711), 'WP4.P3.revokeWithoutReason', '087-COM', 'the PM reopen PA-03 with no reason: \'400 SUB_PAY_APP_REASON_REQUIRED\'', 'COM'),
  C('P4.stored', L(712), 'WP4.P4', 'stored:087-COM,stored:052-COM', '087-COM PA-01: 20,000.00 paid (approved), 25,000.00 more (paid); 052-COM PA-01: 20,000.00 paid (approved)', 'D2'),
  C('P4.payOverNetPlus2', L(677, 712, 1148), 'WP4.P4.payOverNetPlus2', 'K', 'K22, PA-K1 approved (net 45,000.00, nothing paid); finance pays 45,000.02: \'400 SUB_PAY_APP_PAYMENT_EXCEEDS\', nothing paid (catcher of M-CEIL, writes only on K)', 'P'),
  C('KA.P4.payOverNet', L(712), 'WP4.P4.payOverNet', 'K', 'K22, then 45,000.01: value refused; today 201, paid in full, 45,000.01 booked out - C1-TOL', 'P'),
  C('P4.revokeAfterPayment', L(712), 'WP4.P4.revokeAfterPayment', '052-COM', 'the PM reopen 052-COM PA-01 (approved, 20,000.00 paid) with a reason: \'409 SUB_PAY_APP_ALREADY_PAID\'', 'D2'),
  C('P4.cashOutflowWithoutRebuild', L(712), 'WP4.P4.cashOutflowWithoutRebuild', '052-COM', '052-COM\'s 2026-07 outflow 20,000.00 (the PA-01 payment), no rebuild', 'D2'),
  C('P5.complianceMissing', L(713), 'WP4.P5.complianceMissing', 'K', 'K23, PA-K3b (waiverRequired, no waiver) submitted; the PM approves: \'409 SUB_PAY_APP_COMPLIANCE\', details.reasonCode MISSING_COMPLIANCE', 'P'),
  C('P5.complianceOverride', L(713), 'WP4.P5.complianceOverride', 'K', 'K23, the PM approves with a complianceOverrideReason: approved, the reason stored', 'P'),
  C('P6.stored', L(713), 'WP4.P6.finalCloseoutGate', 'stored:087-COM', 'payapp.08-final: \'409 CLOSEOUT_OUTSTANDING\' at the build', 'COM'),
  C('P6.live', L(713), 'WP4.P6.finalCloseoutGate', '087-COM', 'the PM approve 087-COM PA-08 now: \'409 CLOSEOUT_OUTSTANDING\', still submitted', 'COM'),
  C('P7.rejectWithoutReason', L(713), 'WP4.P7.rejectWithoutReason', '087-COM', 'the PM reject 087-COM PA-04 (under review) with no reason: \'400 VALIDATION_ERROR\'', 'COM'),
  C('P7.rejectedReopen', L(713), 'WP4.P7.rejectedReopen', 'K', 'K23, PA-K3c submitted, rejected with a reason, reopened: draft; submitted again (a deviation: K; 087-COM PA-05 cannot reopen while PA-07 is open)', 'P'),

  C('CASH.CF1.stored', L(715), 'WP4.CF1', 'stored:087-COM', 'cash-flow.months: 2026-08 outflow 8,500.00; 2026-09 inflow 80,000.00, outflow 54,000.00; the window net 17,500.00', 'COM'),
  C('CASH.CF1.live', L(715), 'WP4.CF1', '087-COM', 'GET 087-COM /cash-flow now (before this run\'s rebuild): the same months and the 2026-08..2026-09 window (WP4.CF1.summary.*, G14)', 'COM'),
  C('KA.CASH.CF2.advanceInflow', L(716, 732), 'WP4.CF2.advanceInflow', '087-COM', '087-COM\'s 2026-07 inflow: value 200,000.00 (the advance received 2026-07-01); today 0.00 - L115 (CERT-5)', 'COM'),
  C('CASH.CF3.manualSurvivesRebuild', L(717), 'WP4.CF3.manualSurvivesRebuild', '087-COM', 'the cost controller\'s one rebuild of 087-COM: the manual 2026-10 +1,000.00 row survives; the system months unchanged', 'COM'),
  C('KA.CASH.CF3.period13', L(717), 'WP4.CF3.period2026_13', 'K', 'K27, the cost controller POST /cash-flow {period \'2026-13\'}: value 400; today 201 - CF-PERIOD (WP4-CF-1 when confirmed)', 'CASH'),
  C('KA.CASH.CF3.deleteSystemRow', L(717, 732), 'WP4.CF3.deleteSystemRow', 'K', 'K27, the cost controller DELETE one K system row: value 409; today 200 (then one rebuild restores it) - L120', 'CASH'),
  C('KA.CASH.CF4.concurrentRebuilds', L(718, 732), 'WP4.CF4.concurrentRebuilds', 'K', 'K27, five concurrent K rebuilds: value one set of system rows whose totals equal a single rebuild\'s; today duplicates possible - L120 (racy)', 'CASH'),
  C('CASH.CF5.financeRebuild', L(719), 'WP4.CF5.financeRebuild', '087-COM', 'finance POST 087-COM /cash-flow/rebuild: \'403 FORBIDDEN\'', 'COM'),
  C('CASH.CF5.costControllerRebuild', L(719), 'WP4.CF5.costControllerRebuild', '087-COM', 'the cost controller POST 087-COM /cash-flow/rebuild: 200 (the one idempotent deep write, WP4ADJ Q1)', 'COM'),

  C('CF.HRC1', L(726), 'WP4.HRC1.rule', 'K,K2', 'confirm-first: retention null -> 0% and L114 (a silent project 5, a silent contract 5, items at 0 certified, a new period ignoring the contract, K2 certified at the project rate, a commitment at 5) - HR-C1 decided: must be REJECTED; classified from the fresh K and K2 checks only', 'CF'),
  C('CF.HRC2', L(727), 'WP4.I3', '052-COM,K,static', 'confirm-first: the variation allowance leaks to the sibling allocation (KA.I3.limits.A130, KA.I3.patchA130Qty650; variationLinkNames matches the BOQ item) - HR-C2, reported', 'CF'),
  C('CF.convertAtomic', L(728, 1109), 'WP4.E2', 'K,static', 'confirm-first: the non-atomic convert (L199): duplicate COs and pending (KA.E2.concurrent, KA.E2.pendingDelta), an orphan CO after a refusal midway (KA.E2.midwayOrphans), no transaction in convertToChangeOrder - CONVERT-ATOMIC, reported until its fix lands (then must be REJECTED)', 'CF'),
  C('CF.HRC12', L(728), 'WP4.HRC12', 'K', 'confirm-first: two accepted quotes on one line, the event stuck after its CO is archived, the lines\' budget lines dropped (KA.HRC12.*) - HR-C12, reported', 'CF'),
  C('CF.HRC3', L(729), 'WP4.I8.afterReleaseStatus', 'stored:087-COM,stored:052-COM,087-COM,K,static', 'confirm-first: \'paid\' one-way (KA.I8.afterReleaseStatus), no route back from submitted (KA.I11.backToDraft), empty periods certifiable (KA.HRC3.emptyPeriod) - HR-C3, reported', 'CF'),
  C('CF.HRC4', L(730), 'WP4.I9', '052-COM,087-COM', 'confirm-first: the statement and the receivables disagree by the released retention (KA.I9.statementVsReceivables on both companies) - HR-C4 (CERT-5 decides, CERT-3 records), reported', 'CF'),
  C('CF.CCOparent', L(731, 1111), 'WP4.CCO', 'K,static', 'confirm-first: a commitment CO on a void or closed parent can still be approved (KA.CCO.*; transitionChangeOrder checks only the CO\'s status) - CCO-PARENT, reported until its fix lands (then must be REJECTED)', 'CF'),
  C('CF.HRC13', L(732), 'WP4.E6.deductiveCo', 'K,static', 'confirm-first: no deductive prime CO (E6.deductiveCo), no route releases subcontractor retention, the close refused with retention held (C5.closeWithRetentionHeld) - HR-C13, reported', 'CF'),
  C('CF.L108', L(732), 'WP4.C4.sameLine', '087-COM', 'confirm-first: a purchase-order commitment\'s committed and actual land on different budget lines (KA.C4.sameLine) - L108, reported', 'CF'),
  C('CF.CERT5', L(732), 'WP4.CF2.advanceInflow', '087-COM,K', 'confirm-first: L115 and L120 (the advance never reaches cash flow; any row deletable; rebuilds unlocked: KA.CASH.CF2, KA.CASH.CF3.deleteSystemRow, KA.CASH.CF4) - recorded and deferred to CERT-5', 'CF'),
  C('CF.OVR1', L(701), 'WP4.OVR1', 'stored:087-COM,087-COM', 'confirm-first WP4-OVR-1: IPC-09 (nothing on A130) needs a PM override: the stored and live reviews, the PM without a reason \'400 IPC_PM_OVERRIDE_REASON_REQUIRED\', finance with one \'403 IPC_PM_OVERRIDE_REQUIRED\' (sent only while the live review requires the override, so nothing is written) - reported', 'CF'),
  C('CF.DRAFTS1', L(701), 'WP4.DRAFTS1', 'K', 'confirm-first WP4-DRAFTS-1 (K25 on E-001, earned 5,000.00): two 4,000.00 drafts both PATCH 200, the first certifies, the second \'400 IPC_PM_OVERRIDE_REASON_REQUIRED\' over by 3,000.00 (the gate catches) - reported', 'CF'),
  C('CF.C1TOL', L(712), 'WP4.P4.payOverNet', 'K', 'confirm-first (adjudication C1): money ceilings allow one cent over (KA.P4.payOverNet) - reported', 'CF'),
];
/**
 * Fixed before the first run: the checks above (G.5xx is the harness's own, on top). WP4-PREP proposed 149 fixed
 * checks; the binding adjudication moved I2 to a second throwaway (Q11), whose own setup check S.K2 joins the fixed
 * count. 149 + 1 = 150.
 */
const EXPECTED_CHECKS = 150;
// </CHECKS>
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((c) => c.id)).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');

/** Which projects each section touches (the --project filter selects sections). */
const SECTION_PROJECTS = {
  S: ['K', 'K2', '087-COM', '087-COM-B', '087-COM-C', '052-COM', '006-LITE', 'static'],
  HRC1: ['K', 'K2'], E: ['K'], C: ['K'], I: ['K'], P: ['K'], CASH: ['K'],
  COM: ['087-COM'], COMB: ['087-COM-B'], COMC: ['087-COM-C'], D2: ['052-COM', '087-COM'], D3: ['006-LITE'],
  CF: ['K', 'K2', '087-COM', '052-COM', 'static'],
};
for (const c of CHECKS) if (!SECTION_PROJECTS[c.section]) throw new Error(`check ${c.id}: section ${c.section} is not in SECTION_PROJECTS`);
for (const [flag, set] of [['only', ONLY], ['skip', SKIP]]) {
  for (const section of set || []) if (!SECTION_PROJECTS[section]) throw new Error(`--${flag}: no section ${section} (sections: ${Object.keys(SECTION_PROJECTS).join(' ')})`);
}
if (PROJECT_FILTER && !Object.values(SECTION_PROJECTS).some((list) => list.includes(PROJECT_FILTER))) throw new Error(`--project: no project ${PROJECT_FILTER}`);
/** The sections CF classifies from (confirmFirstFlow reads their records, known answers and observations). */
const CF_SOURCES = ['HRC1', 'E', 'C', 'I', 'P', 'CASH', 'COM', 'D2'];
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
const NEED_K = ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes('K'));
const NEED_K2 = ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes('K2'));
/** Whether a selected check reads a step's result: K probes nothing selected reads are skipped in a filtered run. */
const wants = (...ids) => ids.some((id) => ACTIVE_IDS.has(id));
/** The deep projects (live or stored) the selected checks need. */
const NEED_DEEP = Object.keys(DEEP).filter((code) => runsOn(code));
/** Live reads of a deep project (stored-only checks need its state file, not the project). */
const NEED_LIVE = Object.keys(DEEP).filter((code) => ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes(code)));
const NEED_COMPANIES = [...new Set(['087', ...NEED_DEEP.map((code) => DEEP[code].company)])];

// -- small helpers --------------------------------------------------------------------------------------------------
/** A list out of an answer's data: the array itself, or its items / orders / rows / entries / invoices / revisions / events. */
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items', 'orders', 'rows', 'entries', 'revisions', 'events', 'members', 'lines', 'data']) if (Array.isArray(data?.[key])) return data[key];
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
const statusPart = (said) => Number(String(said).split(' ')[0]);
const readState = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${code}.json`), 'utf8'));
const outOf = (state, step) => {
  const st = state?.steps?.[step];
  if (!st || st.status !== 'done') throw new Error(`build ${state?.code}: step ${step} is ${st ? st.status : 'not run'}`);
  return st.out;
};
const recordOf = (state, name) => state?.records?.[name] || null;
/** Money as integer cents (the API answers currency units); a value that is not an exact amount reads as a string, so it never matches. */
const cents = (v) => {
  if (v === null || v === undefined) return null;
  try { return harness.toCents(v); } catch { return `not cents: ${v}`; }
};
/** Cents as a payload amount in currency units (exact for every amount this proof sends: two decimals at most). */
const units = (c) => Number((c / 100).toFixed(2));
/** The calendar date n days from now (UTC; RFQ due dates and quote validity, never a transaction date). */
const dayFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
/** A one-page PDF (the shape build/_commercial.js pdf() makes) for an upload. */
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
/** The first word of a book today that is a sentence ('paid (one-way, ...)' -> 'paid'). */
const firstWord = (text) => String(text).split(/[\s(]/)[0];

/**
 * The units the build state files store figures in, named per step or record group (WP-2 adjudication finding 7:
 * never guessed). Every commercial builder stores the API's answers and its own outs in currency units, except the
 * fields named ...Cents (budget-lines.originalCents, boq.totalCents) and 006-LITE's ev.T1 (book units; not read here).
 */
const STORED_UNITS = {
  '087-COM': { 'records.data': 'units', 'contract.after-CO-125': 'units', 'contract.after-cos': 'units', 'contract.value': 'units', 'contract.retention': 'units', 'ipc.out': 'units', 'ipc.I1.observed': 'units', 'co.out': 'units', 'commitment.out': 'units', 'cash-flow.months': 'units' },
  '087-COM-B': { 'commitment.C3': 'units', contract: 'units' },
  '087-COM-C': { 'records.data': 'units', 'contract.fallback': 'units', 'ipc.out': 'units' },
  '052-COM': { 'records.data': 'units', 'contract.value': 'units', 'ipc.out': 'units', 'ipc.I1.observed': 'units', 'commitment.out': 'units' },
  '006-LITE': { 'records.data': 'units', 'ipc.out': 'units', 'retention.configure': 'units' },
};
/** A stored money figure in cents, by the unit STORED_UNITS names for it (never guessed: an unnamed field throws). */
const storedCents = (code, field, value) => {
  const unit = STORED_UNITS[code]?.[field];
  if (!unit) throw new Error(`no stored unit recorded for ${code} ${field}: the proof never guesses a stored unit`);
  if (value === null || value === undefined) return null;
  return unit === 'units' ? cents(value) : value;
};
/** A book error leaf as the answer string ('409 CHANGE_EVENT_CONVERTED'); a code-null leaf as its status alone. */
const saidOf = (leaf) => (leaf.value?.code ? `${leaf.value.status} ${leaf.value.code}` : String(leaf.value?.status));
/** A K book row by its key. */
const kRow = (list, key, value) => {
  const rows = list.filter((row) => row[key] === value);
  if (rows.length !== 1) throw new Error(`answer book: ${rows.length} rows with ${key} ${value} (exactly one expected)`);
  return rows[0];
};

// -- K and K2 as the book types them (currency units in payloads, cents in the leaves) -------------------------------
const KB = {
  project: WP4.K.project.value,
  team: WP4.K.team.value,
  budgetLines: WP4.K.budgetLines.value,
  bill: WP4.K.bill.value,
  allocations: WP4.K.allocations.value,
  progress: WP4.K.progress.value,
  commitments: WP4.K.commitments.value,
  payApps: WP4.K.payApps.value,
  changeEvents: WP4.K.changeEvents.value,
};
const K2B = { project: WP4.K2.project.value };
const NOT_SENT = 'not sent';
/** A book payload without the fields the book marks 'not sent'. */
const sentOnly = (payload) => Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== NOT_SENT));
/** K's activity codes (every activity WP4.K.progress names; the book's K-A110 ... K-A310). */
const K_ACTIVITIES = Object.keys(KB.progress);
/** The contract value K and K2 enter (deep.087-COM.contractOriginal 2,000,000.00: K6, K2-2). */
const CONTRACT_VALUE = units(D087.contractOriginal.value);
/** The claim quantity of a row from a claimed amount (cents) and the row's rate. */
const qtyOf = (amountCents, rowCode) => amountCents / Math.round(kRow(KB.bill, 'code', rowCode).rate * 100);
/** The payment and invoice dates the K choreography uses (K12's 2026-09-15 is WP4.K.ipcD.paid's; the others are choices). */
const DATES = { invoice: '2026-09-01', invoiceDue: '2026-10-01', ipcPayment: '2026-09-15', paK1: '2026-09-30', paK5: '2026-10-01', periodStart: '2026-09-01', periodEnd: '2026-09-30', activityStart: '2026-02-02', activityEnd: '2026-06-30' };
/** The 087 directory the 087-COM build made (build/087-com.js DIRECTORY): key -> the label its name carries. */
const DIRECTORY_087 = { subA: 'Blockwork Subcontractor', subB: 'MEP Subcontractor', subC: 'Finishing Subcontractor', supplier: 'Cement Supplier', vendorA: 'Groundworks Vendor A', vendorB: 'Groundworks Vendor B' };

// -- rules, decided-rule checks, the fix commits and the contracts pending their plan reviews ------------------------
const ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp4/WP4-ADJUDICATION.md ${item}`;
/**
 * The fix commits (WP4ADJ Q4, Q9): EMPTY until each fix lands. The integration owner sets both fields from the fix
 * commit (`git show -s --format=%cI <commit>`); the proof checks the time against git (S.state).
 *   HR-C1           while empty every HR-C1 today is a failure; once set, a stored observation older than committedAt
 *                   that shows exactly the leaves' todays is STORED-PRE-FIX.
 *   CONVERT-ATOMIC  the section 5 defect fix "atomic, idempotent change-event conversion" (:1109), made in WP-4 if it
 *                   confirms as P1: once set, the rule is decided, the KA.E2 checks and CF.convertAtomic are defect
 *                   checks and their today fails.
 *   CCO-PARENT      the section 5 defect fix "a commitment-CO approval checks that its parent is still live" (:1111):
 *                   the same for KA.CCO.* and CF.CCOparent.
 */
const FIXES = Object.freeze({
  'HR-C1': Object.freeze({ commit: null, committedAt: null }),
  'CONVERT-ATOMIC': Object.freeze({ commit: null, committedAt: null }),
  'CCO-PARENT': Object.freeze({ commit: null, committedAt: null }),
});
const fixed = (rule) => Boolean(FIXES[rule]?.commit);
const RULES = {
  'HR-C1': { status: 'decided', statement: 'No silent 5% fallback: retention comes from authoritative contract configuration (the contract rate, else an explicitly configured project default) or an explicitly configured "no retention"; otherwise configuration is required and certification is refused (owner decision, plan section 0.1 :49; WP4.HRC1.rule). L114 is folded in (:726). HR-C1 covers commitments (WP4ADJ Q3). The refusing step, status and code and the unconfigured shapes are the fix\'s contract, pending the HR-C1 plan review (WP4ADJ Q2). Stored moments built before the fix commit read STORED-PRE-FIX (WP4ADJ Q4).', sources: [`${PLAN_DOC}:49,90,692,696-697,726,1069`, ADJ('Q2, Q3, Q4')] },
  'HR-C2': { status: 'proposed', statement: 'Variation scope: an approved CO\'s allocation link raises only the linked allocation\'s limit, not its BOQ item\'s other allocations (the recommendation; undecided; P1 proposed, the owner\'s call).', sources: [`${PLAN_DOC}:727,1070`, ADJ('Q8, Q9')] },
  'HR-C3': { status: 'proposed', statement: 'Certificate status follows payment (paid only when nothing is due), a submitted certificate has a route back to draft, empty periods are refused (the recommendation; undecided; codes never guessed).', sources: [`${PLAN_DOC}:729,1071`] },
  'HR-C4': { status: 'proposed', statement: 'The statement\'s and the receivables\' "invoiced" agree; the invoice gross includes materials (CERT-5 decides, CERT-3 records).', sources: [`${PLAN_DOC}:730,1072`] },
  'HR-C12': { status: 'proposed', statement: 'One accepted quote per change-event line; archiving a converted event\'s CO returns the event to priced; the CO carries each line\'s budget line and cost code (the recommendation; undecided).', sources: [`${PLAN_DOC}:728,1080`] },
  'HR-C13': { status: 'proposed', statement: 'Deductive prime COs and a subcontractor retention release (L199, L116): the owner\'s call; this run records today\'s answers.', sources: [`${PLAN_DOC}:732,1081`] },
  'CONVERT-ATOMIC': { status: fixed('CONVERT-ATOMIC') ? 'decided' : 'proposed', statement: `Converting a change event is atomic and idempotent: concurrent converts make one CO and one +9,500.00, a refusal midway leaves no orphan CO and the event unconverted (the section 5 defect fix :1109, made in WP-4 if it confirms as P1, WP4ADJ Q9)${fixed('CONVERT-ATOMIC') ? `; fixed in ${FIXES['CONVERT-ATOMIC'].commit}` : '; not yet fixed'}.`, sources: [`${PLAN_DOC}:684,728,1109`, ADJ('Q8, Q9')] },
  'CCO-PARENT': { status: fixed('CCO-PARENT') ? 'decided' : 'proposed', statement: `A commitment-CO approval checks that its parent is still live: refused on a void or closed parent (409, the code the fix's; the section 5 defect fix :1111, WP4ADJ Q9)${fixed('CCO-PARENT') ? `; fixed in ${FIXES['CCO-PARENT'].commit}` : '; not yet fixed'}.`, sources: [`${PLAN_DOC}:731,1111`, ADJ('Q9')] },
  L108: { status: 'proposed', statement: 'A purchase-order commitment\'s committed and actual cost land on the same budget line (lead L108; P2 proposed; severity after reproduction).', sources: [`${PLAN_DOC}:693,732`] },
  L115: { status: 'proposed', statement: 'An advance receipt reaches cash flow as an inflow in its month (lead L115; CERT-5 decides, HR-C16).', sources: [`${PLAN_DOC}:716,732,1084`] },
  L120: { status: 'proposed', statement: 'Cash flow: system rows are not deletable and rebuilds are serialised (lead L120; CERT-5 decides, HR-C16).', sources: [`${PLAN_DOC}:717-718,732,1084`] },
  'CERT-5': { status: 'proposed', statement: 'L115, L120 and the legacy valuations are recorded in CERT-3 and decided in CERT-5 (plan :732).', sources: [`${PLAN_DOC}:732`] },
  'C1-TOL': { status: 'proposed', statement: 'Money ceilings allow no cent over: a tolerance only absorbs floating-point noise (< 0.005) (book adjudication C1 suspect; P3 proposed; a known answer, WP4ADJ Q12).', sources: [`${PLAN_DOC}:712`, ADJ('Q12')] },
  'CF-PERIOD': { status: 'proposed', statement: 'A cash-flow month 13 is refused (a new suspect, P3 proposed; registered as WP4-CF-1 when confirmed, WP4ADJ Q13). The code is never guessed.', sources: [`${PLAN_DOC}:717`, ADJ('Q13')] },
  'WP4-OVR-1': { status: 'proposed', statement: 'Register WP4-OVR-1 (P2): a certificate that claims nothing on an over-certified allocation needs a PM override; an observation, the expected behaviour undecided.', sources: ['docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:290'] },
  'WP4-DRAFTS-1': { status: 'proposed', statement: 'Register WP4-DRAFTS-1 (P3): the item PATCH ignores other drafts; the certify gate catches (EXPECTED BEHAVIOUR proposed).', sources: ['docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:291', ADJ('Q9')] },
};
const CF_RULE = {
  'CF.HRC1': 'HR-C1', 'CF.HRC2': 'HR-C2', 'CF.convertAtomic': 'CONVERT-ATOMIC', 'CF.HRC12': 'HR-C12', 'CF.HRC3': 'HR-C3', 'CF.HRC4': 'HR-C4',
  'CF.CCOparent': 'CCO-PARENT', 'CF.HRC13': 'HR-C13', 'CF.L108': 'L108', 'CF.CERT5': 'CERT-5', 'CF.OVR1': 'WP4-OVR-1', 'CF.DRAFTS1': 'WP4-DRAFTS-1', 'CF.C1TOL': 'C1-TOL',
};
/** The decided-rule checks (the header table): kind 'defect', RED at HEAD until the fix (exit 2, never 1). stored: a build moment (STORED-PRE-FIX applies). */
const DECIDED_RED = {
  'HRC1.projectDisplay': { rule: 'HR-C1', defect: 'HR-C1 an unset project default reads as a silent 5 (K)', stored: false, today: 'defaultRetentionRate 5' },
  'HRC1.contractFirstRead': { rule: 'HR-C1', defect: 'HR-C1 the contract\'s first read stores a silent 5 (K)', stored: false, today: 'retentionRate 5, no source' },
  'I1.certifyUnconfigured': { rule: 'HR-C1', defect: 'HR-C1 an unconfigured certificate settles at the silent 0 (K)', stored: false, today: '200 certified, retention 0.00, net 40,000.00' },
  'I1.afterConfiguration': { rule: 'HR-C1', defect: 'HR-C1 the contract rate never reaches the refused certificate (K)', stored: false, today: '409 IPC_INVALID_CERTIFICATION_STATE (K-IPC-01 kept at 0)' },
  'L114.newPeriodItemRate': { rule: 'HR-C1', defect: 'HR-C1 / L114 a new period\'s items ignore the contract rate (K)', stored: false, today: 'item rate 0' },
  'I2.contractRate': { rule: 'HR-C1', defect: 'HR-C1 / L114 certification takes the project rate over the contract\'s (K2)', stored: false, today: 'retention 3,000.00, net 37,000.00' },
  'C3.noDefaultNoRate': { rule: 'HR-C1', defect: 'HR-C1 a commitment with no rate takes a silent 5 (K)', stored: false, today: '201 at 5' },
  'HRC1.stored.087COM': { rule: 'HR-C1', defect: 'HR-C1 the 087-COM build\'s unconfigured moments (stored)', stored: true, today: 'project 5, contract 5, items 0' },
  'HRC1.stored.052COM': { rule: 'HR-C1', defect: 'HR-C1 the 052-COM build\'s unconfigured moments (stored)', stored: true, today: 'project 5, contract 5, items 0' },
  'HRC1.stored.006LITE': { rule: 'HR-C1', defect: 'HR-C1 the 006-LITE build\'s unconfigured moment (stored)', stored: true, today: 'project 5, contract 5, items 0, no refusal' },
  'CF.HRC1': { rule: 'HR-C1', defect: 'HR-C1 retention null -> 0% and L114', stored: false, today: 'CONFIRMED' },
  ...(fixed('CONVERT-ATOMIC') ? {
    'KA.E2.concurrent': { rule: 'CONVERT-ATOMIC', defect: 'CONVERT-ATOMIC concurrent converts make more than one CO', stored: false, today: 'k >= 2 COs' },
    'KA.E2.pendingDelta': { rule: 'CONVERT-ATOMIC', defect: 'CONVERT-ATOMIC pending rises by k x 9,500.00', stored: false, today: 'k x 9,500.00' },
    'KA.E2.midwayOrphans': { rule: 'CONVERT-ATOMIC', defect: 'CONVERT-ATOMIC a refusal midway leaves an orphan CO', stored: false, today: '1 orphan per attempt' },
    'CF.convertAtomic': { rule: 'CONVERT-ATOMIC', defect: 'CONVERT-ATOMIC the non-atomic convert', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('CCO-PARENT') ? {
    'KA.CCO.voidParent': { rule: 'CCO-PARENT', defect: 'CCO-PARENT a CO approved on a void parent', stored: false, today: '200 approved' },
    'KA.CCO.closedParent': { rule: 'CCO-PARENT', defect: 'CCO-PARENT a CO approved on a closed parent raises committed', stored: false, today: '200, committed 6,000.00' },
    'CF.CCOparent': { rule: 'CCO-PARENT', defect: 'CCO-PARENT a commitment CO on a dead parent', stored: false, today: 'CONFIRMED' },
  } : {}),
};
for (const [id, d] of Object.entries(DECIDED_RED)) {
  if (!CHECKS.some((c) => c.id === id) || RULES[d.rule]?.status !== 'decided') throw new Error(`DECIDED_RED ${id}: not a check, or ${d.rule} is not decided`);
}
// The stored HR-C1 checks judge exactly the leaves the book's STORED-PRE-FIX rule lists (WP4.HRC1.storedPreFix, Q4).
{
  const listed = new Set(WP4.HRC1.storedPreFix.value.leaves);
  const judged = ['WP4.I1.certifyUnconfigured', 'WP4.I1.silentContractRate', 'WP4.HRC1.contract.projectUnconfiguredShape', 'WP4.L114.newPeriodItemRate', 'deep.052-COM.I1.certifyUnconfigured', 'deep.052-COM.I1.silentContractRate', 'deep.006-LITE.retentionDefaultCase'];
  const missing = judged.filter((key) => !listed.has(key));
  if (missing.length) throw new Error(`WP4.HRC1.storedPreFix does not list ${missing.join(', ')}: the stored HR-C1 checks and the book disagree (Q4)`);
}

/**
 * The contracts of the decided rules and of the defect fixes, filled ONLY from the adjudicated fix plans after their
 * Codex plan reviews (WP4ADJ Q2: no contract is guessed). HR-C1's eight fields are read from the book
 * (WP4.HRC1.contract.*): null while the leaf's value is 'contract pending the HR-C1 plan review'.
 *   refusalStep               where certification refuses (informational here)
 *   refusalStatusCode         '<status> <CODE>' of the refused certification (else: any 4xx, nothing settled)
 *   contractUnconfiguredShape the fields GET /prime-contract shows when nobody configured retention ({ field: value })
 *   projectUnconfiguredShape  the fields GET /projects/:id shows for an unset default ({ field: value })
 *   commitmentRefusal         '<status> <CODE>' of a commitment created with no rate and no explicit default
 *   reresolveAtCertify        true / false: whether certification re-reads the then-authoritative rate (K10's path)
 *   itemOverrideKept          informational (an explicit item rate is kept and recorded)
 *   explicitNoRetentionInput  the PATCH /prime-contract body that configures "no retention" (K9)
 * CONVERT-ATOMIC.midwayRollback: '<status> <CODE>' of the refused convert after the fix (else: any 4xx).
 * CCO-PARENT.refusalStatusCode: '<status> <CODE>' of the refused approval after the fix (else: 409, code not asserted).
 */
const contractField = (leaf) => (leaf.value === HR_C1_PENDING ? null : leaf.value);
const CONTRACT = Object.freeze({
  'HR-C1': Object.freeze(Object.fromEntries(['refusalStep', 'refusalStatusCode', 'contractUnconfiguredShape', 'projectUnconfiguredShape', 'commitmentRefusal', 'reresolveAtCertify', 'itemOverrideKept', 'explicitNoRetentionInput'].map((field) => [field, contractField(WP4.HRC1.contract[field])]))),
  'CONVERT-ATOMIC': Object.freeze({ midwayRollback: null }),
  'CCO-PARENT': Object.freeze({ refusalStatusCode: null }),
});
const PENDING_NOTE = (rule) => (Object.values(CONTRACT[rule]).every((v) => v === null) ? `contract pending the ${rule} plan review: only what the decided rule fixes is judged` : `contract judged: ${json(CONTRACT[rule], 300)}`);
/** HEAD's "no retention" input until the contract names one (WP4.HRC1.contract.explicitNoRetentionInput.today). */
const EXPLICIT_NO_RETENTION = CONTRACT['HR-C1'].explicitNoRetentionInput && typeof CONTRACT['HR-C1'].explicitNoRetentionInput === 'object' ? CONTRACT['HR-C1'].explicitNoRetentionInput : { retentionRate: 0 };
/** A shape the contract names, compared field by field on an answer. */
const shapeHolds = (shape, data) => Object.entries(shape).every(([k, v]) => sameJson(data?.[k] ?? null, v));

/** The setup checks. */
const SETUP_IDS = new Set(CHECKS.filter((c) => c.id.startsWith('S.')).map((c) => c.id));
/**
 * The live catchers of the section 6.2 WP-4 guards (WP4.mutations.*, WP4ADJ Q8); the variants and the post-fix
 * mutants with them. collateral: other checks a mutant turns red (named so a mutation result is read correctly).
 */
const CATCHERS = {
  'M-VAR0': ['I3.limits.A120'], 'M-VAR1': ['KA.I3.limits.A130', 'KA.I3.patchA130Qty650'],
  'M-CONV0': ['K.E1.convertAgain'], 'M-CONV1': ['KA.E2.concurrent', 'KA.E2.pendingDelta', 'KA.E2.midwayOrphans'],
  'M-OPEN': ['P1.secondOpen', 'P1.reopenWhileOpen'], 'M-OPENa': ['P1.secondOpen'], 'M-OPENb': ['P1.reopenWhileOpen'],
  'M-CEIL': ['P4.payOverNetPlus2'],
  'M-LOCK': ['E3.patchApproved', 'E3.archiveApproved'], 'M-LOCKa': ['E3.patchApproved'], 'M-LOCKb': ['E3.archiveApproved'],
  'M-RET': ['I1.certifyUnconfigured'], 'M-RET-c': ['C3.noDefaultNoRate'], 'M-RET-d': ['HRC1.contractFirstRead'], 'M-RET-l': ['L114.newPeriodItemRate', 'I2.contractRate'],
  'CCO-M1': ['KA.CCO.voidParent', 'KA.CCO.closedParent'],
};
const COLLATERAL = {
  'M-CONV0': ['E1.convertAgain (K-E2 converted a sixth time)', 'KA.E2.concurrent / pendingDelta read today (BLOCKED) or wrong'],
  'M-CEIL': ['KA.P4.payOverNet wrong (45,000.02 already paid)', 'CF.C1TOL TEST GAP'],
  'M-VAR0': ['KA.I3.patchA130Qty650 reads value (a pass)', 'CF.HRC2 PARTIAL (a pass)'],
  'M-OPENa': ['none: the extra application is voided at once (a restoration on K)'],
  'M-OPENb': ['none: PA-K3a, reopened by the mutant, is voided at once (a restoration on K)'],
};
// The catchers are the book's (WP4.mutations.*: each names its catcher by check id, G23).
{
  const bookText = Object.values(WP4.mutations).map((leaf) => leaf.value.join(' ')).join(' ');
  const missing = [...new Set(Object.values(CATCHERS).flat())].filter((id) => !bookText.includes(id));
  if (missing.length) throw new Error(`WP4.mutations names no catcher ${missing.join(', ')}: CATCHERS and the book disagree (G23)`);
  for (const id of new Set(Object.values(CATCHERS).flat())) if (!CHECKS.some((c) => c.id === id)) throw new Error(`CATCHERS names ${id}, not a check`);
}

const planEntries = ACTIVE.map((c) => [
  c.id,
  c.description,
  SETUP_IDS.has(c.id) ? { setup: true } : DECIDED_RED[c.id] ? { defect: DECIDED_RED[c.id].defect, rule: DECIDED_RED[c.id].rule } : c.id.startsWith('CF.') ? { rule: CF_RULE[c.id] } : {},
]);

const h = harness.createHarness({
  name: 'wp4-commercial-proof',
  plan: planEntries,
  rules: RULES,
  meta: {
    plan: `${PLAN_DOC} section 4 WP-4 (:671-732), section 6.2 WP-4 guards (:1148); plan lines as numbered at 48db9e9`,
    prep: 'C:/Temp/octapm-cert/scratch/wp4/WP4-PREP.md',
    adjudication: 'C:/Temp/octapm-cert/scratch/wp4/WP4-ADJUDICATION.md (Q1-Q14 applied)',
    momentMap: 'backend/scripts/cert/cert3/build/MOMENT-MAP.md (deviations to record when the proof lands: rows 110, 114, 115, 124, 136 per WP4ADJ Q1; row 127 per Q11)',
    answerBook: `backend/scripts/cert/cert3/answers/commercial.js @${COMMERCIAL.meta.head} + the WP-4 book patch (G1-G29)`,
    expectedChecks: EXPECTED_CHECKS,
    activeChecks: ACTIVE.length,
    filter: { only: ONLY ? [...ONLY] : null, skip: SKIP ? [...SKIP] : null, project: PROJECT_FILTER, sections: [...selectedSections], deepProjects: NEED_DEEP, live: NEED_LIVE, throwaway: { K: NEED_K, K2: NEED_K2 } },
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
    decidedRed: DECIDED_RED,
    fixes: FIXES,
    contract: Object.fromEntries(Object.entries(CONTRACT).map(([rule, fields]) => [rule, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? `contract pending the ${rule} plan review` : v]))])),
    catchers: CATCHERS,
    collateral: COLLATERAL,
    deviations: [
      'E1.convertAgain runs on K (K-E2 after its race), not on 087-COM\'s E1: mutate-multi.js runs the proof without flags, and M-CONV0 would convert 087-COM\'s E1 a second time (a deep write).',
      'I2 runs on the second throwaway K2, not on a draft left on 087-COM-B (WP4ADJ Q11; MOMENT-MAP row 127).',
      'I1\'s refusal, E3\'s archive, E2, I3\'s PATCH and P4\'s probes run on K (WP4ADJ Q1; MOMENT-MAP rows 110, 114, 115, 124, 136).',
    ],
    equivalentMutants: 'M-CEILa / M-CEILb (each single removal of the payment ceiling: the other check answers the same code) and the variation allocation-leg mutant (a CO link stores its allocation\'s boqItemId): recorded, not run (book adjudication C1; WP4.mutations.*)',
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
 * decided rule seen in a stored moment whose build, storedAt, predates that rule's fix commit; WP4ADJ Q4), else FAIL.
 * Never STORED-PRE-FIX while the fix commit is not set.
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
 * decided rule (HR-C1; CONVERT-ATOMIC / CCO-PARENT once fixed) a today fails, except a STORED observation (`storedAt`,
 * its build time) older than the rule's fix commit: STORED-PRE-FIX, a pass reported with the register link.
 */
const ka = (id, { ref, value, today, observed, verdict, storedAt = null, detail = '' }) => {
  const c = BY_ID.get(id);
  const decided = RULES[ref]?.status === 'decided';
  const status = kaStatus({ ref, verdict, storedAt });
  const blocked = status === 'BLOCKED';
  const preFix = status === 'STORED-PRE-FIX';
  knownAnswers[id] = { ref, bookKey: c.bookKey, value, today, observed, verdict, ruleDecided: decided, storedAt, status, ...(preFix ? { register: `docs/certification/OCTAPM_LAUNCH_BLOCKERS.md ${ref}`, fix: FIXES[ref] } : {}) };
  const ok = verdict === 'value' || blocked || preFix;
  const text = `${blocked ? `BLOCKED (known answer, ${ref})` : preFix ? `STORED-PRE-FIX (built ${storedAt}, before the ${ref} fix ${FIXES[ref].commit} of ${FIXES[ref].committedAt}): HEAD's pre-fix answers, reported with the register link ${ref}, not a WP-4 failure` : verdict === 'today' ? `FAIL: HEAD still gives the known answer of ${ref}, which is decided${storedAt !== null ? (FIXES[ref]?.commit ? ` (stored ${storedAt}, not before the fix commit)` : ` (no ${ref} fix commit yet)`) : ''}` : verdict === 'value' ? 'value' : `WRONG: neither the book's value nor HEAD's known answer (${ref})`}; ${detail}`;
  rec(id, ok, { expected: { value, today }, observed, detail: text });
  records[id].verdict = status;
  return verdict;
};
/** value / today / wrong from a predicate over the observation. */
const judge = (observed, isValue, isToday) => (isValue(observed) ? 'value' : isToday(observed) ? 'today' : 'wrong');
/**
 * R-SET: a known-answer probe in its own section. When what the probe needs cannot be set up, the probe throws: the
 * harness records a section error (a setup error, exit 1) and the check is left unrecorded ('not run'), never 'wrong'.
 */
const probe = (title, fn) => h.section(`probe: ${title}`, fn);
const probeSetup = (id, why) => new Error(`${id}: the probe's own setup failed (a setup error, not a verdict; R-SET): ${why}`);
/** A step a throwaway choreography cannot go on without: a setup error, not a verdict (as WP-1's W, WP-2's P, WP-3's V). */
const need = (condition, what) => {
  if (condition !== true) throw new Error(`${what}: the choreography cannot go on (a setup error, not a verdict)`);
};
/** A confirm-first item classified from this run's observations (plan section 0.0: CONFIRMED / PARTIAL / REJECTED / TEST GAP). */
const cf = (id, { present, absent, gap = [], detail = '' }) => {
  const total = present.length + absent.length + gap.length;
  const classification = total === 0 || gap.length === total ? 'TEST GAP' : present.length === 0 ? 'REJECTED' : absent.length === 0 && gap.length === 0 ? 'CONFIRMED' : 'PARTIAL';
  const rule = RULES[CF_RULE[id]];
  confirmFirst[id] = { classification, rule: CF_RULE[id], ruleStatus: rule.status, present, absent, gap, note: rule.status === 'decided' ? 'a decided rule (or a landed fix): CONFIRMED is a failure (RED until its fix lands)' : 'an undecided rule: CONFIRMED is reported, not failed; EXPECTED BEHAVIOUR is the owner\'s call' };
  const ok = rule.status === 'decided' ? classification === 'REJECTED' : classification !== 'TEST GAP';
  rec(id, ok, { expected: rule.status === 'decided' ? 'REJECTED (fixed)' : 'CONFIRMED or REJECTED (reported)', observed: { classification, present, absent, gap }, detail: `${classification}; ${detail}` });
  return classification;
};

// -- sessions and requests --------------------------------------------------------------------------------------------
const ctx = { db: null, q: null, orgs: {}, people: {}, sessions: {}, specs: {}, k: null, k2: null, state: {}, deep: {}, cleanup: [], deepWrites: [], restorations: [], dir: {} };
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
/** A multipart upload as a persona (the attachments route takes the field 'files'). */
const upload = (who, route, file, fields = {}, field = 'files') => send(who, 'POST', route, undefined, { form: api.multipart({ field, filename: file.filename, contentType: file.contentType, body: file.body, fields }) });
/** A PDF attached to a record: its project document id (the evidence a CO or an execution names). */
const attachPdf = async (who, P, recordType, recordId, label) => {
  const res = await upload(who, `${P}/attachments`, pdf(`${label} ${h.STAMP}`, `CERT3-WP4-${label.replace(/[^A-Za-z0-9]+/g, '-')}-${h.STAMP}.pdf`), { recordType, recordId, caption: `CERT3 WP4 ${label} ${h.STAMP}` });
  const row = listOf(res.body?.data).find((r) => r?.documentId) || null;
  need(res.status === 201 && Boolean(row?.documentId), `the ${label} PDF could not be attached to ${recordType} ${recordId} (${h.said(res)} ${res.body?.error?.message || ''})`);
  return row.documentId;
};
/** A public token route (the vendor portal): no session; the label never carries the token. */
const portal = async (method, route, json, label) => {
  const res = await api.raw(method, route, { json });
  h.keep(label, res);
  return res;
};
/** Every audit event of a project the filter selects, read to the end of the cursor (as the PM of `who`'s company). */
const auditEvents = async (who, P, query) => {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const data = await dataOf(who, `${P}/audit?${query}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    rows.push(...listOf(data?.events));
    cursor = data?.nextCursor || null;
    if (!cursor) break;
  }
  return rows;
};
/** A refusal probe on a deep project: an unexpected success is recorded as a deep write (cleanup reports it). */
const deepProbe = async (code, who, method, route, body, what) => {
  const res = await send(who, method, route, body);
  if (res.status >= 200 && res.status < 300) ctx.deepWrites.push(`${code}: ${what} was ACCEPTED (${h.said(res)})`);
  return res;
};

// -- stored moments (pure over a state file and the book; exported for the static simulation) ------------------------
const saidRec = (st, name) => recordOf(st, name)?.said ?? null;
const dataRec = (st, name) => recordOf(st, name)?.data ?? null;
const latest = (...stamps) => stamps.filter(Boolean).sort().pop() || null;
const stepAt = (st, step) => st?.steps?.[step]?.finishedAt || st?.steps?.[step]?.blocked?.at || null;

/**
 * HR-C1's unconfigured moments of 087-COM or 052-COM (WP4.HRC1.storedPreFix.moments): the project read, the contract's
 * first read, IPC-01's draft and its BLOCKED certify step, the first configured period's item rate before its claim.
 * today: each shows HEAD's silent rate (the leaves' todays); value: none does (the decided part only: the shapes
 * themselves are the fix's contract, so a null rate is what is required of them here); anything else is wrong.
 */
const storedHrc1Com = (st, code, { certifyLeaf, silentLeaf, newPeriodStep }) => {
  const u = (field, v) => storedCents(code, field, v);
  const projectStep = st?.steps?.['project.retention-unset'];
  const contractStep = st?.steps?.['contract.value'];
  const i1 = st?.steps?.['ipc.I1'];
  const blocked = st?.steps?.['ipc.I1.certify-unconfigured'];
  const np = st?.steps?.[newPeriodStep];
  const o = i1?.out?.observed || {};
  const observed = {
    projectShows: projectStep?.out?.apiShows ?? null,
    contractFirstRead: contractStep?.out?.firstRead?.retentionRate ?? null,
    itemRetentionRates: Array.isArray(o.itemRetentionRates) ? o.itemRetentionRates : null,
    draft: { retention: u('ipc.I1.observed', o.draftTotals?.totalRet), net: u('ipc.I1.observed', o.draftTotals?.netPayable) },
    certifyStep: { status: blocked?.status ?? 'absent', ref: blocked?.blocked?.ref ?? null },
    newPeriodItemRate: np?.out?.itemRateBeforeClaim ?? null,
    steps: { project: projectStep?.status ?? null, contract: contractStep?.status ?? null, ipcI1: i1?.status ?? null, newPeriod: np?.status ?? null },
  };
  const projectToday = WP4.HRC1.contract.projectUnconfiguredShape.today.defaultRetentionRate;
  const certToday = certifyLeaf.today;
  const isToday = (x) => Number(x.projectShows) === projectToday && Number(x.contractFirstRead) === silentLeaf.today
    && sameJson(x.itemRetentionRates, [certToday.itemRetentionRate]) && x.draft.retention === certToday.retention && x.draft.net === certToday.net
    && x.certifyStep.status === 'blocked' && x.certifyStep.ref === 'HR-C1' && Number(x.newPeriodItemRate) === WP4.L114.newPeriodItemRate.today;
  const isValue = (x) => x.projectShows === null && x.contractFirstRead === null && Array.isArray(x.itemRetentionRates) && x.itemRetentionRates.every((r) => r === null)
    && x.certifyStep.status !== 'blocked' && Number(x.newPeriodItemRate) === WP4.L114.newPeriodItemRate.value;
  const doneAll = Object.values(observed.steps).every((s) => s === 'done');
  return {
    verdict: !doneAll ? 'wrong' : judge(observed, isValue, isToday),
    value: { projectShows: null, contractFirstRead: null, itemRetentionRates: 'no silent rate', certify: certifyLeaf.value, newPeriodItemRate: WP4.L114.newPeriodItemRate.value },
    today: { projectShows: projectToday, contractFirstRead: silentLeaf.today, certify: certToday, newPeriodItemRate: WP4.L114.newPeriodItemRate.today, certifyStep: 'BLOCKED HR-C1' },
    observed,
    storedAt: latest(stepAt(st, 'project.retention-unset'), stepAt(st, 'contract.value'), stepAt(st, 'ipc.I1'), stepAt(st, 'ipc.I1.certify-unconfigured'), stepAt(st, newPeriodStep)),
  };
};

/** A change event's E1 records (087-COM or 052-COM): the book node is WP4.E1 or deep.052-COM.E1. */
const storedE1 = (st, code, E) => {
  const u = (v) => storedCents(code, 'records.data', v);
  const made = dataRec(st, 'ce.E1');
  const sent = dataRec(st, 'ce.E1.rfqs');
  const accepted = dataRec(st, 'ce.E1.accept');
  const converted = dataRec(st, 'ce.E1.convert');
  const sum = (lines, key) => (Array.isArray(lines) ? lines.reduce((s, l) => s + (u(l[key]) ?? NaN), 0) : null);
  const observed = {
    romTotal: sum(made?.lines, 'romAmount'),
    afterRfqSend: sent?.changeEvent?.status ?? null,
    quoteA: sum(accepted?.changeEvent?.lines, 'quotedAmount'),
    afterAccept: accepted?.changeEvent?.status ?? null,
    convertedValue: u(converted?.changeOrder?.value),
    coStatus: converted?.changeOrder?.status ?? null,
    eventStatus: converted?.changeEvent?.status ?? null,
  };
  const expected = { romTotal: E.romTotal.value, afterRfqSend: E.afterRfqSend.value, quoteA: E.quoteA.value, afterAccept: E.afterAccept.value, convertedValue: E.convertedValue.value, coStatus: E.coStatus.value, eventStatus: E.eventStatus.value };
  return { ok: sameJson(observed, expected), expected, observed };
};

/** SC-002's insurance refusals at the build (087-COM or 052-COM). */
const storedInsurance = (st, C1) => {
  const observed = { insuranceMissing: saidRec(st, 'commitment.SC-002.execute.no-override'), overrideWithoutReason: saidRec(st, 'commitment.SC-002.execute.no-reason') };
  const expected = { insuranceMissing: saidOf(C1.insuranceMissing), overrideWithoutReason: saidOf(C1.overrideWithoutReason) };
  return { ok: sameJson(observed, expected), expected, observed };
};

/** SC-001's committed moments: executed at 100,000.00 (the step out where it carries revised), the change-order step done. */
const storedC2 = (st, code, C2, expectStates) => {
  const exec = st?.steps?.['commitment.SC-001.execute'];
  const cos = st?.steps?.['commitment.SC-001.change-orders'];
  const approved = dataRec(st, 'cco.APPROVED.approve');
  const u = (field, v) => storedCents(code, field, v);
  const observed = {
    executed: exec?.out?.status ?? null,
    revisedAtExecution: exec?.out?.revised === undefined ? 'not stored' : u('commitment.out', exec.out.revised),
    changeOrdersStep: cos?.status ?? null,
    states: cos?.out?.states ?? null,
    approvedCo: { status: approved?.status ?? null, value: u('records.data', approved?.value) },
  };
  const expected = {
    executed: 'executed',
    revisedAtExecution: observed.revisedAtExecution === 'not stored' ? 'not stored' : C2.committedExecuted.value,
    changeOrdersStep: 'done',
    states: expectStates,
    approvedCo: { status: 'approved', value: C2.committedCoApproved.value - C2.committedExecuted.value },
  };
  return { ok: sameJson(observed, expected), expected, observed, detail: 'the step done means the build asserted SC-001\'s committed (revised) at each moment against the book (draft / pending 100,000.00, approved 110,000.00, after a rejected one 110,000.00)' };
};

/** A certificate's payment lane at the build (087-COM IPC-03 'ipc.03.*' or 052-COM IPC-02 'ipc.I8.*'). */
const storedI8 = (st, code, prefix, I8) => {
  const u = (v) => storedCents(code, 'records.data', v);
  const pay1 = dataRec(st, `${prefix}.pay.1`)?.certificate;
  const release = dataRec(st, `${prefix}.release`)?.certificate;
  const pay2 = dataRec(st, `${prefix}.pay.2`)?.certificate;
  const observed = {
    payOverBalance: saidRec(st, `${prefix}.pay.over`),
    payFull: pay1 ? `${pay1.status}/${pay1.paymentStatus}` : null,
    balanceDueAfterPay: u(pay1?.balanceDue),
    releaseOverHeld: saidRec(st, `${prefix}.release.over`),
    afterReleasePaymentStatus: release?.paymentStatus ?? null,
    afterReleaseBalanceDue: u(release?.balanceDue),
    paySecond: pay2 ? `${pay2.status}/${pay2.paymentStatus}` : null,
    amountPaidTotal: u(pay2?.amountPaid),
    retentionStatus: pay2?.retentionStatus ?? null,
  };
  const expected = {
    payOverBalance: saidOf(I8.payOverBalance),
    payFull: `${I8.payFull.value}/${I8.payFull.value}`,
    balanceDueAfterPay: I8.balanceDueAfterPay.value,
    releaseOverHeld: saidOf(I8.releaseOverHeld),
    afterReleasePaymentStatus: I8.afterReleasePaymentStatus.value,
    afterReleaseBalanceDue: I8.afterReleaseBalanceDue.value,
    paySecond: `${I8.paySecond.value}/${I8.paySecond.value}`,
    amountPaidTotal: I8.amountPaidTotal.value,
    retentionStatus: 'released',
  };
  return { ok: sameJson(observed, expected), expected, observed, storedAt: latest(...['pay.over', 'pay.1', 'release.over', 'release', 'pay.2'].map((n) => recordOf(st, `${prefix}.${n}`)?.at)) };
};

/** The status of the certificate in the release's own answer (HR-C3): the step out's afterRelease. */
const storedAfterRelease = (st, step) => {
  const a = st?.steps?.[step]?.out?.afterRelease || null;
  return { status: a?.status ?? null, paymentStatus: a?.paymentStatus ?? null, balanceDue: a?.balanceDue ?? null };
};

/** PA-01's P3 lane (approve r0, revoke to draft r1, re-approve) and its P4 payments, as the build recorded them. */
const storedP3 = (st, code, P3) => {
  const u = (v) => storedCents(code, 'records.data', v);
  const a = dataRec(st, 'payapp.01.approve');
  const r = dataRec(st, 'payapp.01.reopen');
  const ra = dataRec(st, 'payapp.01.reapprove');
  const observed = {
    approve: a ? { status: a.status, revision: a.certificationRevision, gross: u(a.grossThisPeriod), retention: u(a.retentionThisPeriod), net: u(a.netThisPeriod) } : null,
    reopen: r ? { status: r.status, revision: r.certificationRevision } : null,
    reapprove: ra ? { status: ra.status, revision: ra.certificationRevision, net: u(ra.netThisPeriod) } : null,
  };
  const expected = {
    approve: { status: 'approved', revision: 0, gross: P3.gross.value, retention: P3.retention.value, net: P3.net.value },
    reopen: { status: 'draft', revision: 1 },
    reapprove: { status: 'approved', revision: 1, net: P3.net.value },
  };
  return { ok: sameJson(observed, expected), expected, observed };
};
const storedP4 = (st, code, P4, { second }) => {
  const u = (v) => storedCents(code, 'records.data', v);
  const p1 = dataRec(st, 'payapp.01.pay.1');
  const p2 = second ? dataRec(st, 'payapp.01.pay.2') : null;
  const observed = { first: p1 ? { status: p1.status, paidAmount: u(p1.paidAmount) } : null, ...(second ? { second: p2 ? { status: p2.status, paidAmount: u(p2.paidAmount) } : null } : {}) };
  const expected = { first: { status: P4.payPartStatus.value, paidAmount: P4.paidAmount.value }, ...(second ? { second: { status: P4.paySecond.value, paidAmount: WP4.P3.net.value } } : {}) };
  return { ok: sameJson(observed, expected), expected, observed };
};

/** 087-COM's stored WP-4 moments judged against the book: { id: { ok | verdict, expected, observed, ... } }. */
const storedCom087 = (st) => {
  const r = {};
  const u = (field, v) => storedCents('087-COM', field, v);
  r['HRC1.stored.087COM'] = storedHrc1Com(st, '087-COM', { certifyLeaf: WP4.I1.certifyUnconfigured, silentLeaf: WP4.I1.silentContractRate, newPeriodStep: 'ipc.02' });
  r['E1.stored'] = storedE1(st, '087-COM', WP4.E1);
  // E5 at its moment (contract.after-CO-125)
  const e5 = outOf(st, 'contract.after-CO-125');
  const e5o = { pendingChangesValue: u('contract.after-CO-125', e5.pendingChangesValue), approvedChangesValue: u('contract.after-CO-125', e5.approvedChangesValue), revisedValue: u('contract.after-CO-125', e5.revisedValue) };
  const e5e = { pendingChangesValue: WP4.E5.pendingChangesValue.value, approvedChangesValue: WP4.E5.approvedChangesValue.value, revisedValue: WP4.E5.revisedValue.value };
  r['E5.stored'] = { ok: sameJson(e5o, e5e), expected: e5e, observed: e5o };
  // the RFI CO: converted as a draft of 4,500.00, approved; its share of the approved changes once every CO exists
  const conv = dataRec(st, 'rfi.convert');
  const appr = dataRec(st, 'co.RFI.approve');
  const after = outOf(st, 'contract.after-cos');
  const others = ['co.CO-125', 'co.CO-SPLIT', 'co.CO-I3'].map((step) => u('co.out', outOf(st, step).value));
  const rfiShare = u('contract.after-cos', after.approvedChangesValue) - others.reduce((s, x) => s + x, 0);
  const rfio = { createdAs: conv?.changeOrder?.status ?? null, value: u('records.data', conv?.changeOrder?.value), approved: appr?.status ?? null, revisedDeltaOnApproval: rfiShare };
  const rfie = { createdAs: WP4.rfiCo.createdAs.value, value: WP4.rfiCo.value.value, approved: 'approved', revisedDeltaOnApproval: WP4.rfiCo.revisedDeltaOnApproval.value };
  r['RFI.stored'] = { ok: sameJson(rfio, rfie), expected: rfie, observed: rfio, detail: 'revisedDeltaOnApproval: contract.after-cos approvedChangesValue less CO-125, CO-SPLIT and CO-I3 (deep.087-COM.contractEnd.approvedChanges)' };
  // I6 / IPC-04
  const c4 = recordOf(st, 'ipc.04.certify');
  const X = D087.ipc04;
  const i6o = {
    noReason: saidRec(st, 'ipc.04.certify.no-reason'), financeWithReason: saidRec(st, 'ipc.04.certify.finance'),
    pm: c4 ? { persona: c4.persona, status: c4.data?.status ?? null, reason: Boolean(c4.data?.certificationOverrideReason) } : null,
    overCertificationAmount: u('records.data', c4?.data?.overCertificationAmount), gross: u('records.data', c4?.data?.totalCert), retention: u('records.data', c4?.data?.totalRet), advanceRecovery: u('records.data', c4?.data?.advanceRecovery), net: u('records.data', c4?.data?.netPayable),
  };
  const i6e = {
    noReason: saidOf(WP4.I6.noReason), financeWithReason: saidOf(WP4.I6.financeWithReason),
    pm: { persona: 'pm', status: WP4.I6.pmWithReason.value, reason: true },
    overCertificationAmount: WP4.I6.overCertificationAmount.value, gross: X.gross.value, retention: X.retention.value, advanceRecovery: X.advanceRecovery.value, net: X.net.value,
  };
  r['I6.stored'] = { ok: sameJson(i6o, i6e) && X.overCertificationAmount.value === WP4.I6.overCertificationAmount.value, expected: i6e, observed: i6o };
  // I7: the cap (IPC-02), the tax (IPC-05), the advance recovery (IPC-08), the contract terms
  const ipc02 = outOf(st, 'ipc.02');
  const ipc05 = outOf(st, 'ipc.05');
  const ipc08 = outOf(st, 'ipc.08');
  const terms = outOf(st, 'contract.retention');
  const i7o = {
    totalRetCapped: u('ipc.out', ipc02.totalRet), netCapped: u('ipc.out', ipc02.netPayable),
    taxAmount: u('ipc.out', ipc05.taxAmount), netWithTax: u('ipc.out', ipc05.netPayable),
    advanceRecovery: u('ipc.out', ipc08.advanceRecovery), netWithAdvance: u('records.data', dataRec(st, 'ipc.08.certify')?.netPayable),
    retentionCapRate: Number(terms.retentionCapRate), advance: u('contract.retention', terms.advanceAmount), contractRetentionRate: Number(terms.retentionRate),
  };
  const i7e = {
    totalRetCapped: WP4.I7.totalRetCapped.value, netCapped: WP4.I7.netCapped.value, taxAmount: WP4.I7.taxAmount.value, netWithTax: WP4.I7.netWithTax.value,
    advanceRecovery: WP4.I7.advanceRecovery.value, netWithAdvance: WP4.I7.netWithAdvance.value, retentionCapRate: D087.retentionCapRate.value, advance: D087.advance.value, contractRetentionRate: D087.contractRetentionRate.value,
  };
  r['I7.stored'] = { ok: sameJson(i7o, i7e), expected: i7e, observed: i7o };
  // I10's stored half (IPC-07)
  const ipc07 = outOf(st, 'ipc.07');
  r.i10Stored = { grossThisPeriod: u('ipc.out', ipc07.grossThisPeriod), netPayable: u('ipc.out', ipc07.netPayable) };
  // P6
  r['P6.stored'] = { ok: saidRec(st, 'payapp.08.approve.closeout') === saidOf(WP4.P6.finalCloseoutGate), expected: saidOf(WP4.P6.finalCloseoutGate), observed: saidRec(st, 'payapp.08.approve.closeout') };
  // CF1's months as the build read them (no manual rebuild before)
  const months = outOf(st, 'cash-flow.months').monthly || [];
  const month = (p) => months.find((m) => m.period === p) || { inflow: 0, outflow: 0 };
  const aug = month('2026-08');
  const sep = month('2026-09');
  const cfo = { '2026-08.inflow': u('cash-flow.months', aug.inflow), '2026-08.outflow': u('cash-flow.months', aug.outflow), '2026-09.inflow': u('cash-flow.months', sep.inflow), '2026-09.outflow': u('cash-flow.months', sep.outflow) };
  cfo['summary.inflow'] = cfo['2026-08.inflow'] + cfo['2026-09.inflow'];
  cfo['summary.outflow'] = cfo['2026-08.outflow'] + cfo['2026-09.outflow'];
  cfo['summary.net'] = cfo['summary.inflow'] - cfo['summary.outflow'];
  const cfe = { '2026-08.inflow': 0, '2026-08.outflow': WP4.CF1['2026-08.outflow'].value, '2026-09.inflow': WP4.CF1['2026-09.inflow'].value, '2026-09.outflow': WP4.CF1['2026-09.outflow'].value, 'summary.inflow': WP4.CF1['summary.inflow'].value, 'summary.outflow': WP4.CF1['summary.outflow'].value, 'summary.net': WP4.CF1['summary.net'].value };
  r['CASH.CF1.stored'] = { ok: sameJson(cfo, cfe), expected: cfe, observed: cfo, detail: 'the 2026-08..2026-09 window (G14)' };
  // halves of the mixed checks (judged in D2 with 052-COM's)
  r.insurance = storedInsurance(st, WP4.C1);
  r.c2 = storedC2(st, '087-COM', WP4.C2, { approved: 'approved', pending: 'pending', rejected: 'rejected', draft: 'draft', void: 'void' });
  r.i8 = storedI8(st, '087-COM', 'ipc.03', WP4.I8);
  r.afterRelease = { ...storedAfterRelease(st, 'ipc.03'), storedAt: recordOf(st, 'ipc.03.release')?.at ?? null };
  r.p3 = storedP3(st, '087-COM', WP4.P3);
  r.p4 = storedP4(st, '087-COM', WP4.P4, { second: true });
  // WP4-OVR-1's stored review (IPC-09)
  const rv = outOf(st, 'ipc.09').overrideReview || {};
  r.ovr1 = { requiresPmOverride: rv.requiresPmOverride ?? null, overEarnedAmount: u('ipc.out', rv.overEarnedAmount), a130OverEarned: u('ipc.out', rv.a130?.overEarnedAmount), currentClaimed: u('ipc.out', rv.a130?.currentClaimedAmount) };
  return r;
};

/** 052-COM's stored WP-4 moments. */
const storedCom052 = (st) => {
  const r = {};
  const u = (field, v) => storedCents('052-COM', field, v);
  r['HRC1.stored.052COM'] = storedHrc1Com(st, '052-COM', { certifyLeaf: D052.I1.certifyUnconfigured, silentLeaf: D052.I1.silentContractRate, newPeriodStep: 'ipc.I8' });
  r['D2.E1.stored'] = storedE1(st, '052-COM', D052.E1);
  const ipc03 = outOf(st, 'ipc.I4-submitted');
  const sub = dataRec(st, 'ipc.I4.submit');
  const X = D052.ipc03;
  const io = { status: ipc03.status, net: u('ipc.out', ipc03.netPayable), gross: u('records.data', sub?.totalCert), retention: u('records.data', sub?.totalRet) };
  const ie = { status: X.status.value, net: X.net.value, gross: X.gross.value, retention: X.retention.value };
  r['D2.stored.ipc03'] = { ok: sameJson(io, ie), expected: ie, observed: io };
  r.insurance = storedInsurance(st, D052.C1);
  r.c2 = storedC2(st, '052-COM', D052.C2, { approved: 'approved', pending: 'pending' });
  r.i8 = storedI8(st, '052-COM', 'ipc.I8', D052.I8);
  r.afterRelease = { ...storedAfterRelease(st, 'ipc.I8'), storedAt: recordOf(st, 'ipc.I8.release')?.at ?? null };
  r.p3 = storedP3(st, '052-COM', D052.P3);
  r.p4 = storedP4(st, '052-COM', D052.P4, { second: false });
  return r;
};

/** 006-LITE's stored WP-4 moments (D3). */
const stored006 = (st) => {
  const r = {};
  const u = (field, v) => storedCents('006-LITE', field, v);
  const step = st?.steps?.['retention.unconfigured'];
  const text = typeof step?.blocked?.observed === 'string' ? step.blocked.observed : json(step?.blocked?.observed ?? step?.out ?? null, 2000);
  const T = D006.retentionDefaultCase.today;
  const observed = {
    status: step?.status ?? 'absent', ref: step?.blocked?.ref ?? null,
    projectDefaultRetentionRate: /defaultRetentionRate 5\b/.test(text) ? 5 : null,
    contractRetentionRate: /prime-contract retentionRate 5\b/.test(text) ? 5 : null,
    itemRetentionRateIfCreated: /Number\(null\) = 0/.test(text) ? 0 : null,
    certificateRefused: step?.status === 'done' ? (step.out?.certificateRefused === true || /^4\d\d /.test(String(step.out?.refusal?.said ?? ''))) : /No certificate was made/.test(text) ? false : null,
  };
  const isToday = (o) => o.status === 'blocked' && o.ref === 'HR-C1' && o.projectDefaultRetentionRate === T.projectDefaultRetentionRate && o.contractRetentionRate === T.contractRetentionRate && o.itemRetentionRateIfCreated === T.itemRetentionRateIfCreated && o.certificateRefused === T.certificateRefused;
  const isValue = (o) => o.status === 'done' && o.certificateRefused === true;
  r['HRC1.stored.006LITE'] = { verdict: judge(observed, isValue, isToday), value: D006.retentionDefaultCase.value, today: T, observed, storedAt: stepAt(st, 'retention.unconfigured') };
  const conf = outOf(st, 'retention.configure');
  const cert = outOf(st, 'ipc.certify');
  const pay = outOf(st, 'ipc.payment');
  const payRec = dataRec(st, 'ipc.payment')?.certificate || {};
  const A = D006.ipcAfterConfiguration;
  const o = {
    retentionRate: Number(conf.retentionRate), gross: u('ipc.out', cert.totalCert), retention: u('ipc.out', cert.totalRet), net: u('ipc.out', cert.netPayable), amountPaid: u('ipc.out', pay.amountPaid),
    endState: { status: payRec.status ?? pay.status ?? null, paymentStatus: payRec.paymentStatus ?? null, retentionStatus: payRec.retentionStatus ?? null, balanceDue: u('records.data', payRec.balanceDue), submittedBy: recordOf(st, 'ipc.submit')?.persona ?? null, certifiedBy: recordOf(st, 'ipc.certify')?.persona ?? null, paidBy: recordOf(st, 'ipc.payment')?.persona ?? null },
  };
  const e = { retentionRate: A.retentionRate.value, gross: A.gross.value, retention: A.retention.value, net: A.net.value, amountPaid: A.amountPaid.value, endState: { ...A.endState.value, balanceDue: cents(A.endState.value.balanceDue) } };
  r['D3.stored.ipc'] = { ok: sameJson(o, e), expected: e, observed: o };
  return r;
};

/** 087-COM-C's stored I5 moments. */
const storedComC = (st) => {
  const u = (field, v) => storedCents('087-COM-C', field, v);
  const fb = outOf(st, 'contract.fallback');
  const ipc = outOf(st, 'ipc.01');
  const sub = dataRec(st, 'ipc.01.submit');
  const X = D087C.ipc01;
  const o = { valueSource: fb.originalValueSource, originalValue: u('contract.fallback', fb.originalValue), retentionRate: Number(fb.retentionRate), gate: saidRec(st, 'ipc.01.certify.gate'), status: ipc.status, gross: u('records.data', sub?.totalCert), retention: u('records.data', sub?.totalRet), net: u('ipc.out', ipc.netPayable) };
  const e = { valueSource: WP4.I5.valueSourceBefore.value, originalValue: D087C.billTotal.value, retentionRate: X.retentionRate.value, gate: saidOf(WP4.I5.certifyOnBoqFallback), status: 'submitted', gross: X.gross.value, retention: X.retention.value, net: X.net.value };
  return { 'I5.stored': { ok: sameJson(o, e) && D087C.valueSource.value === WP4.I5.valueSourceBefore.value && saidOf(D087C.certifyGate) === saidOf(WP4.I5.certifyOnBoqFallback), expected: e, observed: o, label: ipc.label, gateAt: recordOf(st, 'ipc.01.certify.gate')?.at ?? null } };
};

/** 087-COM-B's stored C3 moment. */
const storedComB = (st) => {
  const c3 = outOf(st, 'commitment.C3');
  const contract = outOf(st, 'contract');
  const o = { commitmentRate: Number(c3.retentionRate), projectDefault: Number(contract.projectDefault), firstRead: Number(contract.firstRead?.retentionRate), contractRate: Number(contract.retentionRate) };
  const e = { commitmentRate: WP4.C3.projectDefault.value, projectDefault: D087B.projectRetention.value, firstRead: D087B.projectRetention.value, contractRate: D087B.primeContractRetention.value };
  return { c3: { ok: sameJson(o, e), expected: e, observed: o, commitmentId: c3.id } };
};

// -- static scans of backend/src (read only; tests, live suites and mocks excluded) ------------------------------------
let srcMemo = null;
const srcFiles = () => {
  if (srcMemo) return srcMemo;
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (['__tests__', '__live__', '__mocks__', 'node_modules', 'openapi'].includes(ent.name)) continue;
        walk(full);
      } else if (/\.(c|m)?js$/.test(ent.name) && !/\.test\.(c|m)?js$/.test(ent.name)) {
        files.push({ rel: path.relative(SRC, full).replace(/\\/g, '/'), lines: fs.readFileSync(full, 'utf8').split(/\r?\n/) });
      }
    }
  };
  walk(SRC);
  srcMemo = files;
  return files;
};
const fileOf = (rel) => srcFiles().find((f) => f.rel === rel) || null;
/** The text of a top-level `const <name> =` declaration, up to the next top-level declaration. */
const bodyOf = (rel, name) => {
  const f = fileOf(rel);
  if (!f) return null;
  const start = f.lines.findIndex((line) => new RegExp(`^const ${name}\\s*=`).test(line));
  if (start < 0) return null;
  let end = f.lines.length;
  for (let j = start + 1; j < f.lines.length; j += 1) if (/^(?:const|let|function|async function|module\.exports)\b/.test(f.lines[j])) { end = j; break; }
  return f.lines.slice(start, end).join('\n');
};
/** The CF items read from the source: null where the file or the declaration is not found (a gap, never a guess). */
const staticScan = () => {
  const convert = bodyOf('services/change-event.service.js', 'convertToChangeOrder');
  const variation = bodyOf('services/ipc.service.js', 'variationLinkNames');
  const ccoTransition = bodyOf('services/commitment.service.js', 'transitionChangeOrder');
  const ipcRoutes = fileOf('routes/ipc.js');
  const payRoutes = fileOf('routes/sub-pay-apps.js');
  const routePaths = (f) => (f ? f.lines.map((line) => /^\s*["'`](\/[^"'`]*)["'`]\s*,?\s*$/.exec(line)?.[1] || /router\.\w+\(\s*["'`](\/[^"'`]*)["'`]/.exec(line)?.[1]).filter(Boolean) : null);
  const ipcPaths = routePaths(ipcRoutes);
  const payPaths = routePaths(payRoutes);
  return {
    convertWithoutTransaction: convert === null ? null : !/\$transaction/.test(convert),
    variationMatchesBoqItem: variation === null ? null : /boqItemId\s*&&\s*row\.boqItemId\s*===\s*boqItemId/.test(variation),
    // A parent check refuses on the COMMITMENT's status (STATUS.VOID / STATUS.CLOSED, or COMMITMENT_LOCKED as the create
    // path does); the CO's own statuses are CO_STATUS.* and do not count.
    ccoApprovalChecksParent: ccoTransition === null ? null : /COMMITMENT_LOCKED|(?<!CO_)STATUS\.(VOID|CLOSED)/.test(ccoTransition),
    ipcBackToDraftRoute: ipcPaths === null ? null : ipcPaths.filter((p) => /reopen|return|revert|withdraw|unsubmit|back/i.test(p)),
    ipcPaths,
    subRetentionReleaseRoute: payPaths === null ? null : payPaths.filter((p) => /retention/i.test(p)),
  };
};

// -- setup --------------------------------------------------------------------------------------------------------------
/** The build steps whose stored outputs (moment figures and ids) the proof reads, per state file, and the BLOCKED refs allowed. */
const STATE_STEPS = {
  '087-COM': ['project', 'project.retention-unset', 'directory', 'budget-lines', 'activities', 'allocations', 'contract.value', 'co.CO-125', 'co.CO-40', 'co.CO-REJ', 'co.CO-ARC',
    'contract.after-CO-125', 'ce.E1', 'ce.states', 'ipc.I1', 'ipc.I1.certify-unconfigured', 'contract.retention', 'ipc.02', 'ipc.03', 'ipc.05', 'ipc.06', 'ipc.07', 'ipc.08', 'ipc.04', 'ipc.09', 'ipc.10',
    'co.CO-SPLIT', 'co.CO-I3', 'co.RFI', 'contract.after-cos', 'commitment.SC-001', 'commitment.SC-001.execute', 'commitment.SC-002.execute', 'commitment.PC-001', 'commitment.PC-001.execute',
    'commitment.SC-001.change-orders', 'payapp.01', 'payapp.02', 'payapp.03-04', 'payapp.05-07', 'payapp.08-final', 'payapp.PC-001', 'cash-flow.manual', 'cash-flow.months'],
  '087-COM-B': ['project', 'contract', 'commitment.C3'],
  '087-COM-C': ['project', 'contract.fallback', 'ipc.01'],
  '052-COM': ['project', 'project.retention-unset', 'activities', 'allocations', 'contract.value', 'ce.E1', 'ipc.I1', 'ipc.I1.certify-unconfigured', 'contract.retention', 'ipc.I8', 'ipc.I4-submitted',
    'commitment.SC-001', 'commitment.SC-001.execute', 'commitment.SC-002.execute', 'commitment.SC-001.change-orders', 'payapp.P3', 'payapp.P4'],
  '006-LITE': ['project', 'retention.unconfigured', 'retention.configure', 'ipc.create', 'ipc.submit', 'ipc.certify', 'ipc.invoice', 'ipc.payment'],
};
/** K reads only 087-COM's directory (the vendors it uses): the steps when no 087-COM check is selected. */
const STATE_STEPS_K_ONLY = { '087-COM': ['directory'] };
const ALLOWED_BLOCKED = {
  '087-COM': { 'ipc.I1.certify-unconfigured': 'HR-C1' },
  '052-COM': { 'ipc.I1.certify-unconfigured': 'HR-C1' },
  '006-LITE': { 'retention.unconfigured': 'HR-C1' },
};
const PERSONAS = {
  pm: ['087', 'pm'], planner: ['087', 'planner'], qs: ['087', 'qs'], cost: ['087', 'cost'], procurement: ['087', 'procurement'], site: ['087', 'site'], finance: ['087', 'finance'],
  pm052: ['052', 'pm'], qs052: ['052', 'qs'], cost052: ['052', 'cost'], pm006: ['006', 'pm'], qs006: ['006', 'qs'],
};

const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  // S.book: the load guard above passed (the WP-4 leaves exist with their patched values); figures() carries ref.
  const rows = COMMERCIAL.figures();
  const withRef = rows.filter((row) => Object.prototype.hasOwnProperty.call(row, 'ref') && row.ref).length;
  rec('S.book', rows.length > 0 && withRef > 0 && WP4_PATCH_LEAVES.every((key) => leafAt(key)), { observed: { head: COMMERCIAL.meta.head, figures: rows.length, withRef, patchLeaves: WP4_PATCH_LEAVES.length, contractHrC1: CONTRACT['HR-C1'] }, detail: `answers/commercial.js @${COMMERCIAL.meta.head} + the WP-4 patch: ${rows.length} figures, ${withRef} with a ref` });

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

  // S.state: the build state files the selected checks read: moment figures and ids only.
  const stateProblems = [];
  const needStates = [...new Set([...NEED_DEEP, ...(NEED_K ? ['087-COM'] : [])])];
  for (const code of needStates) {
    const steps = NEED_DEEP.includes(code) ? STATE_STEPS[code] : STATE_STEPS_K_ONLY[code];
    try {
      ctx.state[code] = readState(code);
      for (const step of steps) {
        const st = ctx.state[code].steps?.[step];
        const allowed = ALLOWED_BLOCKED[code]?.[step];
        if (st?.status === 'done') continue;
        if (st?.status === 'blocked' && allowed && st.blocked?.ref === allowed) continue;
        stateProblems.push(`${code}: step ${step} is ${st?.status || 'not run'}${st?.status === 'blocked' ? ` (${st.blocked?.ref}; allowed ${allowed || 'none'})` : ''}`);
      }
    } catch (error) {
      stateProblems.push(`${code}: ${error.message}`);
    }
  }
  // Each fix commit, when set, is the one git dates (WP4ADJ Q4, Q9).
  obs.fixesGit = {};
  for (const [rule, fix] of Object.entries(FIXES)) {
    if (!fix.commit && !fix.committedAt) continue;
    const shown = spawnSync('git', ['-C', REPO, 'show', '-s', '--format=%cI', String(fix.commit)], { encoding: 'utf8' });
    const gitAt = shown.status === 0 ? shown.stdout.trim() : null;
    obs.fixesGit[rule] = { commit: fix.commit, committedAt: fix.committedAt, git: gitAt, error: shown.status === 0 ? null : String(shown.stderr || shown.error || '').slice(0, 300) };
    if (!fix.commit || !fix.committedAt || !gitAt || Date.parse(gitAt) !== Date.parse(fix.committedAt)) stateProblems.push(`FIXES['${rule}'] ${json(fix)}: git dates the commit ${gitAt || 'not at all'}; set both fields from git show -s --format=%cI <commit>`);
  }
  rec('S.state', stateProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.state).map(([c, s]) => [c, { projectId: s.projectId, runs: s.runs?.length, updatedAt: s.updatedAt }])), detail: stateProblems.join('; ') || `${needStates.length} state files (${needStates.join(', ') || 'none needed'}), every needed step done or BLOCKED with its moment-map ref; fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}` });

  // S.projects: the deep projects by their exact names, through the API as each company's PM (live reads only need them).
  const projectProblems = [...problems];
  for (const [code, { company, name }] of Object.entries(DEEP).filter(([code]) => NEED_DEEP.includes(code))) {
    const who = company === '087' ? 'pm' : `pm${company}`;
    if (!ctx.sessions[who]) { projectProblems.push(`${code}: no session for ${who}`); continue; }
    const page = await get(who, `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(name)}`);
    const live = listOf(page.body?.data).filter((p) => p.name === name && !p.archivedAt);
    if (page.status !== 200) projectProblems.push(`${code}: GET /projects ${h.said(page)}`);
    else if (live.length !== 1) projectProblems.push(`${code}: ${live.length} live projects named "${name}" (${live.map((p) => p.id).join(', ')})`);
    else {
      ctx.deep[code] = { id: live[0].id, P: `/projects/${live[0].id}`, who };
      if (ctx.state[code] && ctx.state[code].projectId !== live[0].id) projectProblems.push(`${code}: the live project ${live[0].id} is not the state file's ${ctx.state[code].projectId} (restore and rebuild, or stale state)`);
    }
  }
  rec('S.projects', projectProblems.length === 0, { observed: { orgs: Object.fromEntries(Object.entries(ctx.orgs).map(([c, o]) => [c, { id: o.id, slug: o.slug }])), people: Object.keys(ctx.people), projects: Object.fromEntries(Object.entries(ctx.deep).map(([c, d]) => [c, d.id])) }, detail: projectProblems.join('; ') || `${NEED_COMPANIES.length} companies, ${Object.keys(ctx.people).length} sessions, ${NEED_DEEP.length} deep projects (${NEED_DEEP.join(', ') || 'none needed'}), one live each, matching the state` });
  if (projectProblems.length || stateProblems.length) throw new Error(`setup: ${[...stateProblems, ...projectProblems].join('; ')}`);

  // K's vendors: 087's directory companies the 087-COM build made, by the ids its state names, each read back by name.
  if (NEED_K) {
    const ids = outOf(ctx.state['087-COM'], 'directory').ids || {};
    const dirProblems = [];
    for (const [key, label] of Object.entries(DIRECTORY_087)) {
      const name = `CERT3 ${label} (087-COM)`;
      const page = await get('pm', `/companies?limit=100&search=${encodeURIComponent(name)}`);
      const row = listOf(page.body?.data).find((c) => c.id === ids[key] && c.name === name) || null;
      if (!row) dirProblems.push(`${key}: no company ${ids[key]} named "${name}" (${h.said(page)})`);
      else ctx.dir[key] = { id: row.id, name: row.name, email: row.email || `${key.toLowerCase()}.087com@parties.c087.octapm-cert.test` };
    }
    if (dirProblems.length) throw new Error(`setup: K's vendors: ${dirProblems.join('; ')}`);
  }
};

// -- the throwaway projects: create, archive ----------------------------------------------------------------------------
const archivedAtOf = async (id) => (await ctx.q('select "archivedAt"::text as a from "Project" where id = $1', [id]))[0]?.a || null;
/** Archives a throwaway once (the end step or cleanup): the answer and archivedAt read back. */
const archive = async (t, label) => {
  if (!t || t.archived) return t?.archived || null;
  const res = await send('pm', 'DELETE', `/projects/${t.id}`);
  const at = await archivedAtOf(t.id);
  t.archived = { said: h.said(res), status: res.status, archivedAt: at };
  return t.archived;
};
const makeThrowaway = async (book, team, label) => {
  const name = String(book.name).replace('<stamp>', h.STAMP);
  const created = await send('pm', 'POST', '/projects', { ...sentOnly(book), name });
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (!id) throw new Error(`${label} could not be created: ${h.said(created)} ${created.body?.error?.message || ''}`);
  const t = { id, P: `/projects/${id}`, name, label, created, shown: created.body?.data || {}, members: [], ids: {}, items: {}, alloc: {}, codes: {}, lines: {}, archived: null };
  ctx.cleanup.push(async () => { const a = await archive(t, label); return `${label} ${id} archive ${a?.said ?? 'not sent'}, archivedAt ${a?.archivedAt || 'NOT SET'}`; });
  for (const [key, role] of Object.entries(team)) {
    const res = await send('pm', 'POST', `${t.P}/team`, { userId: ctx.people[key], role });
    t.members.push({ key, role, said: h.said(res), status: res.status });
  }
  return t;
};

/** Hand-built activities with the site engineer assigned (no duration: no CPM rewrites the dates). */
const makeActivities = async (t, codes, wbs) => {
  const made = [];
  for (const [i, code] of codes.entries()) {
    const res = await send('planner', 'POST', `${t.P}/activities`, { name: `CERT3 WP4 ${code} ${h.STAMP}`, activityCode: code, wbsCode: wbs, category: 'civil', startDate: DATES.activityStart, endDate: DATES.activityEnd, sortOrder: i, engineerIds: [ctx.people.site] });
    t.ids[code] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push([code, h.said(res)]);
  }
  return made;
};
/** A bill row (POST /boq/items): its item id. */
const makeBillRow = async (t, row) => {
  const res = await send('qs', 'POST', `${t.P}/boq/items`, { code: row.code, description: `CERT3 WP4 ${row.code} ${h.STAMP}`, quantity: row.qty, unit: row.unit, rate: row.rate });
  t.items[row.code] = res.status === 201 ? res.body?.data?.item?.id ?? res.body?.data?.id ?? null : null;
  return [row.code, h.said(res)];
};
/** An allocation created and submitted by the planner, approved by the QS. */
const makeAllocation = async (t, { row, activity, qty, amount }) => {
  const created = await send('planner', 'POST', `${t.P}/activity-boq-allocations`, { boqItemId: t.items[row], activityId: t.ids[activity], quantity: qty, amount: units(amount), source: 'manual', notes: `CERT3 WP4 ${row} to ${activity} ${h.STAMP}` });
  const aid = created.body?.data?.id || null;
  const submitted = aid ? await send('planner', 'POST', `${t.P}/activity-boq-allocations/${aid}/submit`, {}) : null;
  const approved = aid ? await send('qs', 'POST', `${t.P}/activity-boq-allocations/${aid}/approve`, {}) : null;
  t.alloc[`${row}/${activity}`] = aid;
  return [`${row}/${activity}`, h.said(created), submitted ? h.said(submitted) : null, approved ? h.said(approved) : null, approved?.body?.data?.status ?? null];
};
/** Approved percent progress: submitted by the site engineer, approved by the QS; the official figure read back. */
const makeProgress = async (t, code, pct) => {
  const A = `${t.P}/activities/${t.ids[code]}`;
  const sub = await send('site', 'POST', `${A}/progress`, { pctComplete: pct, progressMethod: 'percent', status: 'submitted', source: 'manual', notes: `CERT3 WP4 ${code} ${pct} ${h.STAMP}` });
  const sid = sub.status === 200 ? sub.body?.data?.submission?.id || null : null;
  const ap = sid ? await send('qs', 'POST', `${A}/progress-submissions/${sid}/approve`, {}) : null;
  const now = await get('qs', A);
  return [code, h.said(sub), ap ? h.said(ap) : null, Number(now.body?.data?.pctComplete)];
};

// -- the IPC helpers (any project) --------------------------------------------------------------------------------------
const enc = encodeURIComponent;
const ipcRoute = (P, label) => `${P}/ipc/${enc(label)}`;
const readPeriod = async (who, P, label) => dataOf(who, ipcRoute(P, label));
/** The certificate's item of an allocation (identity: allocationId). */
const itemOf = (certificate, allocationId) => {
  const rows = (certificate?.items || []).filter((row) => row.allocationId === allocationId);
  if (rows.length !== 1) throw new Error(`${certificate?.period}: ${rows.length} items of allocation ${allocationId} (exactly one expected)`);
  return rows[0];
};
const openPeriod = async (t, label) => {
  const res = await send('qs', 'POST', `${t.P}/ipc`, { period: label });
  need(res.status === 201, `${t.label}: IPC ${label} could not be opened (${h.said(res)} ${res.body?.error?.message || ''})`);
  return readPeriod('qs', t.P, label);
};
const patchItem = (t, label, itemId, body) => send('qs', 'PATCH', `${ipcRoute(t.P, label)}/items/${itemId}`, body);
const ipcAct = (who, t, label, verb, body = {}) => send(who, 'POST', `${ipcRoute(t.P, label)}/${verb}`, body);
const figuresOfCert = (c) => ({ status: c?.status ?? null, paymentStatus: c?.paymentStatus ?? null, gross: cents(c?.totalCert), retention: cents(c?.totalRet), net: cents(c?.netPayable), paid: cents(c?.amountPaid), balance: cents(c?.balanceDue), retentionStatus: c?.retentionStatus ?? null });
const monthOf = (flow, period) => (flow?.monthly || []).find((m) => m.period === period) || { inflow: 0, outflow: 0 };
const committedOn = async (t, key) => cents(listOf(await dataOf('cost', `${t.P}/budget/lines`), 'lines').find((l) => l.id === t.lines[key])?.committed);

// -- K: K0-K4 (S.K.create, S.K.fixture) ---------------------------------------------------------------------------------
const kSetup = async () => {
  ctx.k = await makeThrowaway(KB.project, KB.team, 'K');
  const k = ctx.k;
  const createdOk = k.created.status === 201 && k.members.length === Object.keys(KB.team).length && k.members.every((m) => [200, 201].includes(m.status))
    && !('defaultRetentionRate' in sentOnly(KB.project)) && !('contractValue' in sentOnly(KB.project)) && (k.shown.contractValue === null || k.shown.contractValue === undefined || Number(k.shown.contractValue) === 0);
  rec('S.K.create', createdOk, { expected: { project: KB.project, team: KB.team }, observed: { id: k.id, said: h.said(k.created), contractValue: k.shown.contractValue ?? null, team: k.members }, detail: 'no defaultRetentionRate and no contractValue sent (WP4.K.project: "not sent")' });
  need(createdOk, 'K0: K or its team could not be made');
  // K1: activities, cost codes, budget lines
  const made = await makeActivities(k, K_ACTIVITIES, 'WP4-K');
  const library = await dataOf('cost', `${k.P}/budget/cost-codes`);
  const codes = [...new Set(KB.budgetLines.map((l) => l.costCode))];
  for (const code of codes) { const hits = listOf(library?.available).filter((c) => c.code === code); k.codes[code] = hits.length === 1 ? hits[0].id : null; }
  const select = codes.every((code) => k.codes[code]) ? await send('cost', 'PUT', `${k.P}/budget/cost-codes`, { costCodeIds: codes.map((code) => k.codes[code]) }) : null;
  const lineAnswers = [];
  for (const l of KB.budgetLines) {
    const res = k.codes[l.costCode] ? await send('cost', 'POST', `${k.P}/budget/lines`, { costCodeId: k.codes[l.costCode], costType: l.costType, description: `CERT3 WP4 ${l.costCode} ${l.costType} ${h.STAMP}`, originalBudget: units(l.originalBudget), status: 'active' }) : null;
    k.lines[`${l.costCode}:${l.costType}`] = res?.status === 201 ? res.body?.data?.id || null : null;
    lineAnswers.push([`${l.costCode}:${l.costType}`, res ? h.said(res) : 'no cost code']);
  }
  const lines = listOf(await dataOf('cost', `${k.P}/budget/lines`), 'lines');
  const linesOk = KB.budgetLines.every((l) => { const row = lines.find((x) => x.id === k.lines[`${l.costCode}:${l.costType}`]); return row && cents(row.originalBudget) === l.originalBudget; });
  // K2: the bill
  const billAnswers = [];
  for (const row of KB.bill) billAnswers.push(await makeBillRow(k, row));
  const boq = await dataOf('qs', `${k.P}/boq`);
  const items = listOf(boq, 'boqItems').filter((i) => i.isActive !== false);
  const billTotal = items.reduce((s, i) => s + (cents(i.amount) ?? NaN), 0);
  // K3: the six allocations
  const allocAnswers = [];
  for (const a of KB.allocations) allocAnswers.push(await makeAllocation(k, a));
  const allocRows = listOf(await dataOf('planner', `${k.P}/activity-boq-allocations`), 'allocations');
  const allocOk = KB.allocations.every((a) => { const row = allocRows.find((x) => x.id === k.alloc[`${a.row}/${a.activity}`]); return row && row.status === 'approved' && cents(row.amount) === a.amount; });
  // K4: approved progress
  const progressAnswers = [];
  for (const [code, pct] of Object.entries(KB.progress)) progressAnswers.push(await makeProgress(k, code, pct));
  const progressOk = progressAnswers.every(([code, , ap, pct]) => ap === '200' && pct === KB.progress[code]);
  const fixture = { made, codes: k.codes, select: select ? h.said(select) : null, lines: lineAnswers, bill: billAnswers, billTotal, allocations: allocAnswers, progress: progressAnswers };
  obs.kFixture = fixture;
  const ok = made.every(([, s]) => s === '201') && select?.status === 200 && linesOk && billAnswers.every(([, s]) => s === '201') && items.length === KB.bill.length && billTotal === WP4.K.billTotal.value && allocOk && progressOk;
  rec('S.K.fixture', ok, { expected: { activities: K_ACTIVITIES, budgetLines: KB.budgetLines, billTotal: WP4.K.billTotal.value, allocations: KB.allocations.length, progress: KB.progress }, observed: fixture });
  need(ok, `K1-K4: the fixture could not be set up (${json(fixture, 900)})`);
};

/** A K prime CO, made approvable (summaries, an activity link, an instruction uploaded on K) and driven on: { id, ref }. */
const primeCo = async (k, key, { value, activity, budgetLine = null, extra = {}, to = 'draft' }) => {
  const description = `CERT3 WP4 ${key} ${h.STAMP}: instructed scope`;
  const made = await send('qs', 'POST', `${k.P}/change-orders`, { description, category: 'client_variation', value, activityId: k.ids[activity], ...(budgetLine ? { budgetLineId: budgetLine } : {}), scheduleImpact: 0, raisedBy: `QS CERT3 WP4 ${key}`, ...extra });
  const id = made.status === 201 ? made.body?.data?.id || null : null;
  need(Boolean(id), `${key}: the CO could not be created (${h.said(made)} ${made.body?.error?.message || ''})`);
  const documentId = await attachPdf('qs', k.P, 'change_order', id, `${key} instruction`);
  const ready = await send('qs', 'PATCH', `${k.P}/change-orders/${id}`, { scheduleImpactSummary: `No programme effect (CERT3 WP4 ${key})`, costImpactSummary: `${value} at contract rates (CERT3 WP4 ${key})`, activityLinks: [{ activityId: k.ids[activity], relationType: 'impacted', scheduleImpactDays: 0, costImpact: value, notes: `CERT3 WP4 ${key}` }], documentIds: [documentId] });
  need(ready.status === 200, `${key}: the CO could not be made approvable (${h.said(ready)} ${ready.body?.error?.message || ''})`);
  if (['pending', 'approved', 'rejected'].includes(to)) {
    const s = await send('qs', 'POST', `${k.P}/change-orders/${id}/submit`, { comment: `CERT3 WP4 ${key} for approval` });
    need(s.status === 200 && s.body?.data?.status === 'pending', `${key}: submit answered ${h.said(s)}`);
  }
  if (to === 'approved') {
    const a = await send('pm', 'POST', `${k.P}/change-orders/${id}/approve`, { comment: `CERT3 WP4 ${key} approved` });
    need(a.status === 200 && a.body?.data?.status === 'approved', `${key}: approve answered ${h.said(a)} ${a.body?.error?.message || ''}`);
  }
  return { id, ref: made.body?.data?.ref ?? null };
};
const coRegister = async (t) => listOf(await dataOf('qs', `${t.P}/change-orders?includeArchived=true`), 'orders');
const pendingOf = async (t) => cents((await dataOf('qs', `${t.P}/prime-contract`))?.pendingChangesValue);

/** A K commitment as the book types it (WP4.K.commitments): every one but K-SC-NR names its rate (G1). */
const commitmentBody = (k, ref, { title = ref, omitVendor = false, noLines = false } = {}) => {
  const def = kRow(KB.commitments, 'ref', ref);
  return {
    type: def.type,
    title: `CERT3 WP4 ${title} ${h.STAMP}`,
    description: `CERT3 WP4 ${title} (${def.serves})`.slice(0, 4000),
    ...(omitVendor ? {} : { vendorCompanyId: ctx.dir[def.vendor].id }),
    ...(def.retentionRate === NOT_SENT ? {} : { retentionRate: def.retentionRate }),
    paymentTerms: `30 days from certification (CERT3 WP4 ${title})`,
    startDate: '2026-02-02',
    endDate: '2027-05-28',
    lines: noLines ? [] : [{ description: `CERT3 WP4 ${title} line 1 ${h.STAMP}`, costCodeId: k.codes[def.line.costCode], budgetLineId: k.lines[`${def.line.costCode}:${def.line.costType}`], activityId: k.ids[def.line.activity], unit: 'ls', qty: 1, amount: units(def.line.amount) }],
  };
};
const commitmentOf = async (k, id) => dataOf('qs', `${k.P}/commitments/${id}`);
/** Created, submitted (QS), approved (PM), its signed agreement attached and executed (PM): the commitment as read back. */
const executedCommitment = async (k, ref) => {
  const made = await send('qs', 'POST', `${k.P}/commitments`, commitmentBody(k, ref));
  const id = made.status === 201 ? made.body?.data?.id || null : null;
  need(Boolean(id), `${ref}: the commitment could not be created (${h.said(made)} ${made.body?.error?.message || ''})`);
  const s = await send('qs', 'POST', `${k.P}/commitments/${id}/submit`, {});
  const a = await send('pm', 'POST', `${k.P}/commitments/${id}/approve`, {});
  need(s.status === 200 && a.status === 200, `${ref}: submit ${h.said(s)}, approve ${h.said(a)}`);
  const documentId = await attachPdf('pm', k.P, 'commitment', id, `${ref} signed agreement`);
  const x = await send('pm', 'POST', `${k.P}/commitments/${id}/execute`, { documentId });
  need(x.status === 200 && x.body?.data?.status === 'executed', `${ref}: execute answered ${h.said(x)} ${x.body?.error?.message || ''}`);
  return commitmentOf(k, id);
};
const commitmentCo = (k, commitment, key, amountCents) => send('qs', 'POST', `${k.P}/commitments/${commitment.id}/change-orders`, {
  title: `CERT3 WP4 ${key} ${h.STAMP}`,
  description: `CERT3 WP4 ${key}`,
  lines: [{ amount: units(amountCents), sovLineId: commitment.lines[0].id, description: `CERT3 WP4 ${key} line 1`, costCodeId: commitment.lines[0].costCodeId ?? null, budgetLineId: commitment.lines[0].budgetLineId ?? null, activityId: commitment.lines[0].activityId ?? null }],
});
/** A pay application on a K commitment (one SOV line); `claim` in cents is PATCHed on when given. */
const newPayApp = (k, commitmentId, key, extra = {}) => send('qs', 'POST', `${k.P}/pay-apps`, { commitmentId, periodLabel: `CERT3-WP4-${key}-${h.STAMP}`, periodStart: DATES.periodStart, periodEnd: DATES.periodEnd, notes: `CERT3 WP4 ${key}`, ...extra });
const claimPayApp = (k, app, sovLineId, claimCents) => send('qs', 'PATCH', `${k.P}/pay-apps/${app.id}`, { lines: [{ sovLineId, thisPeriodAmount: units(claimCents), notes: `CERT3 WP4 ${app.ref || ''}` }] });
const payAppOf = async (k, id) => dataOf('qs', `${k.P}/pay-apps/${id}`);
/** A pay application raised, claimed, submitted and (optionally) approved by the PM: the application as read back. */
const payAppTo = async (k, commitment, key, claimCents, { approve = true, approveBody = {}, extra = {} } = {}) => {
  const made = await newPayApp(k, commitment.id, key, extra);
  need(made.status === 201, `${key}: the application could not be raised (${h.said(made)} ${made.body?.error?.message || ''})`);
  const app = made.body.data;
  const c = await claimPayApp(k, app, commitment.lines[0].id, claimCents);
  const s = await send('qs', 'POST', `${k.P}/pay-apps/${app.id}/submit`, {});
  need(c.status === 200 && s.status === 200 && s.body?.data?.status === 'submitted', `${key}: claim ${h.said(c)}, submit ${h.said(s)} ${s.body?.error?.message || ''}`);
  if (approve) {
    const a = await send('pm', 'POST', `${k.P}/pay-apps/${app.id}/approve`, approveBody);
    need(a.status === 200 && a.body?.data?.status === 'approved', `${key}: approve answered ${h.said(a)} ${a.body?.error?.message || ''}`);
  }
  return payAppOf(k, app.id);
};

// -- K: K5-K12, HR-C1, L114 and the paid certificate --------------------------------------------------------------------
const kHrc1 = async () => {
  const k = ctx.k;
  const { P } = k;
  const HC = CONTRACT['HR-C1'];
  // K5: the project as shown, the contract's first read
  const proj = await get('pm', P);
  need(proj.status === 200, `K5: GET /projects/K answered ${h.said(proj)}`);
  const pShown = proj.body.data;
  const pToday = WP4.HRC1.contract.projectUnconfiguredShape.today;
  const pObserved = { defaultRetentionRate: pShown.defaultRetentionRate ?? null, retentionConfigured: pShown.retentionConfigured ?? null };
  ka('HRC1.projectDisplay', {
    ref: 'HR-C1', value: HC.projectUnconfiguredShape ?? 'no rate shown for an unset default (contract pending)', today: pToday, observed: pObserved,
    verdict: judge(pShown, (d) => (HC.projectUnconfiguredShape && typeof HC.projectUnconfiguredShape === 'object' ? shapeHolds(HC.projectUnconfiguredShape, d) : (d.defaultRetentionRate === null || d.defaultRetentionRate === undefined || d.retentionConfigured === false) && Number(d.defaultRetentionRate) !== pToday.defaultRetentionRate), (d) => Number(d.defaultRetentionRate) === pToday.defaultRetentionRate),
    detail: PENDING_NOTE('HR-C1'),
  });
  const first = await get('qs', `${P}/prime-contract`);
  need(first.status === 200, `K5: the contract's first read answered ${h.said(first)}`);
  const c0 = first.body.data;
  const cObserved = { retentionRate: c0.retentionRate ?? null, retentionRateSource: Object.prototype.hasOwnProperty.call(c0, 'retentionRateSource') ? c0.retentionRateSource : 'absent', retentionConfigured: c0.retentionConfigured ?? null, originalValueSource: c0.originalValueSource ?? null };
  ka('HRC1.contractFirstRead', {
    ref: 'HR-C1', value: { silentContractRate: WP4.I1.silentContractRate.value, shape: HC.contractUnconfiguredShape ?? 'contract pending' }, today: WP4.HRC1.contract.contractUnconfiguredShape.today, observed: cObserved,
    verdict: judge(c0, (d) => (HC.contractUnconfiguredShape && typeof HC.contractUnconfiguredShape === 'object' ? shapeHolds(HC.contractUnconfiguredShape, d) : (d.retentionRate === null || d.retentionRate === undefined || d.retentionConfigured === false || (Object.prototype.hasOwnProperty.call(d, 'retentionRateSource') && d.retentionRateSource === null)) && Number(d.retentionRate) !== WP4.I1.silentContractRate.today), (d) => Number(d.retentionRate) === WP4.I1.silentContractRate.today && !Object.prototype.hasOwnProperty.call(d, 'retentionRateSource')),
    detail: PENDING_NOTE('HR-C1'),
  });
  // K5: K-IPC-01, C-001/K-A220 claimed WITHOUT retentionRate, submitted
  const L01 = `CERT3-WP4-K-IPC-01-${h.STAMP}`;
  const c01 = await openPeriod(k, L01);
  const item01 = itemOf(c01, k.alloc['C-001/K-A220']);
  const claim01 = qtyOf(WP4.I1.currentCert.value, 'C-001');
  const p01 = await patchItem(k, L01, item01.id, { qty: claim01 });
  need(p01.status === 200 && cents(p01.body?.data?.currentCert) === WP4.I1.currentCert.value, `K5: the C-001 claim answered ${h.said(p01)} (currentCert ${p01.body?.data?.currentCert})`);
  const draft01 = await readPeriod('qs', P, L01);
  obs.kIpc01Draft = { itemRates: [...new Set((draft01.items || []).map((i) => i.retentionRate))], ...figuresOfCert(draft01) };
  const s01 = await ipcAct('qs', k, L01, 'submit');
  need(s01.status === 200 && s01.body?.data?.status === 'submitted', `K5: submit answered ${h.said(s01)}`);
  // K6: the contract value entered (the certify gate passes)
  const k6 = await send('qs', 'PATCH', `${P}/prime-contract`, { title: `CERT3 WP4 client contract ${h.STAMP}`, originalValue: CONTRACT_VALUE, paymentTermsDays: 30, status: 'active', notes: `CERT3 WP4 K6 ${h.STAMP}` });
  need(k6.status === 200 && k6.body?.data?.originalValueSource === WP4.I5.valueSourceAfter.value, `K6: the contract value answered ${h.said(k6)} (${k6.body?.data?.originalValueSource})`);
  // K7: certify the unconfigured K-IPC-01
  const k7 = await ipcAct('pm', k, L01, 'certify', { comment: `CERT3 WP4 K7 ${h.STAMP}` });
  const after7 = await readPeriod('qs', P, L01);
  const rate7 = Number(itemOf(after7, k.alloc['C-001/K-A220']).retentionRate);
  const o7 = { said: h.said(k7), ...figuresOfCert(after7), itemRetentionRate: rate7 };
  const today7 = WP4.I1.certifyUnconfigured.today;
  ka('I1.certifyUnconfigured', {
    ref: 'HR-C1', value: WP4.I1.certifyUnconfigured.value, today: today7, observed: o7,
    verdict: judge(o7, (o) => statusPart(o.said) >= 400 && statusPart(o.said) < 500 && (HC.refusalStatusCode ? o.said === HC.refusalStatusCode : true) && o.status === 'submitted', (o) => o.said === '200' && o.status === 'certified' && o.itemRetentionRate === today7.itemRetentionRate && o.retention === today7.retention && o.net === today7.net),
    detail: `${PENDING_NOTE('HR-C1')}; the refusing step and code are the fix's (WP4.HRC1.contract.refusalStep / refusalStatusCode)`,
  });
  // K8: a commitment with no rate on a project with no default
  const k8 = await send('qs', 'POST', `${P}/commitments`, commitmentBody(k, 'K-SC-NR'));
  const o8 = { said: h.said(k8), retentionRate: k8.body?.data?.retentionRate ?? null, status: k8.body?.data?.status ?? null };
  ka('C3.noDefaultNoRate', {
    ref: 'HR-C1', value: WP4.C3.noDefaultNoRate.value, today: WP4.HRC1.contract.commitmentRefusal.today, observed: o8,
    verdict: judge(o8, (o) => statusPart(o.said) >= 400 && statusPart(o.said) < 500 && (HC.commitmentRefusal ? o.said === HC.commitmentRefusal : true), (o) => statusPart(o.said) === WP4.HRC1.contract.commitmentRefusal.today.status && Number(o.retentionRate) === WP4.C3.noDefaultNoRate.today),
    detail: `${PENDING_NOTE('HR-C1')}; WP4ADJ Q3 (HR-C1 covers commitments; the owner sees it in the decision list)`,
  });
  // K9: explicit "no retention", K-IPC-NR certified
  const k9 = await send('qs', 'PATCH', `${P}/prime-contract`, EXPLICIT_NO_RETENTION);
  need(k9.status === 200, `K9: the explicit "no retention" answered ${h.said(k9)} ${k9.body?.error?.message || ''}`);
  const LNR = `CERT3-WP4-K-IPC-NR-${h.STAMP}`;
  const cNR = await openPeriod(k, LNR);
  const pNR = await patchItem(k, LNR, itemOf(cNR, k.alloc['F-001/K-A240']).id, { qty: qtyOf(WP4.HRC1.explicitNoRetention.gross.value, 'F-001') });
  const sNR = await ipcAct('qs', k, LNR, 'submit');
  need(pNR.status === 200 && sNR.status === 200, `K9: K-IPC-NR claim ${h.said(pNR)}, submit ${h.said(sNR)}`);
  const xNR = await ipcAct('pm', k, LNR, 'certify', { comment: `CERT3 WP4 K9 ${h.STAMP}` });
  const fNR = figuresOfCert(await readPeriod('qs', P, LNR));
  const NR = WP4.HRC1.explicitNoRetention;
  rec('I1.explicitNoRetention', xNR.status === 200 && fNR.status === 'certified' && fNR.gross === NR.gross.value && fNR.retention === NR.retention.value && fNR.net === NR.net.value, { expected: { gross: NR.gross.value, retention: NR.retention.value, net: NR.net.value, status: 'certified' }, observed: { said: h.said(xNR), ...fNR, input: EXPLICIT_NO_RETENTION } });
  // K10: the contract at 10; K-IPC-01 certified again (or a new period with the same claim if certification does not re-resolve)
  const rate10 = Math.round((WP4.HRC1.afterConfiguration.retention.value * 100) / WP4.I1.currentCert.value);
  const k10 = await send('qs', 'PATCH', `${P}/prime-contract`, { retentionRate: rate10 });
  need(k10.status === 200 && Number(k10.body?.data?.retentionRate) === rate10, `K10: the contract at ${rate10} answered ${h.said(k10)}`);
  let target = L01;
  if (HC.reresolveAtCertify === false) {
    target = `CERT3-WP4-K-IPC-01b-${h.STAMP}`;
    const cB = await openPeriod(k, target);
    const pB = await patchItem(k, target, itemOf(cB, k.alloc['C-001/K-A220']).id, { qty: claim01 });
    const sB = await ipcAct('qs', k, target, 'submit');
    need(pB.status === 200 && sB.status === 200, `K10: the new period's claim ${h.said(pB)}, submit ${h.said(sB)}`);
  }
  const x10 = await ipcAct('pm', k, target, 'certify', { comment: `CERT3 WP4 K10 ${h.STAMP}` });
  const f10 = figuresOfCert(await readPeriod('qs', P, target));
  const AC = WP4.HRC1.afterConfiguration;
  const o10 = { target, said: h.said(x10), ...f10 };
  ka('I1.afterConfiguration', {
    ref: 'HR-C1', value: { status: AC.status.value, retention: AC.retention.value, net: AC.net.value }, today: { said: `${AC.status.today.status} ${AC.status.today.code}`, retention: AC.retention.today, net: AC.net.today }, observed: o10,
    verdict: judge(o10, (o) => o.said === '200' && o.status === AC.status.value && o.retention === AC.retention.value && o.net === AC.net.value, (o) => o.said === `${AC.status.today.status} ${AC.status.today.code}` && o.retention === AC.retention.today && o.net === AC.net.today),
    detail: `contract retentionRate ${rate10}; reresolveAtCertify ${HC.reresolveAtCertify === null ? HR_C1_PENDING : HC.reresolveAtCertify}`,
  });
  // K11: K-IPC-D opened after the configuration; its item rate before any claim; the route's upper bound; the claim
  const LD = `CERT3-WP4-K-IPC-D-${h.STAMP}`;
  const cD = await openPeriod(k, LD);
  const itemD = itemOf(cD, k.alloc['D-001/K-A200']);
  const NP = WP4.L114.newPeriodItemRate;
  ka('L114.newPeriodItemRate', { ref: NP.ref, value: NP.value, today: NP.today, observed: { itemRetentionRate: Number(itemD.retentionRate) }, verdict: judge(Number(itemD.retentionRate), (r) => r === NP.value, (r) => r === NP.today), detail: 'read before any claim; an assumption: if the HR-C1 contract settles the rate only at certification, this read moves to the certified item' });
  const bound = await patchItem(k, LD, itemD.id, { retentionRate: 150 });
  const itemAfterBound = itemOf(await readPeriod('qs', P, LD), k.alloc['D-001/K-A200']);
  rec('L114.routeBound', h.is(bound, saidOf(WP4.L114.routeBound)) && Number(itemAfterBound.retentionRate) === Number(itemD.retentionRate), { expected: saidOf(WP4.L114.routeBound), observed: { said: h.said(bound), rateAfter: itemAfterBound.retentionRate } });
  const rateD = Math.round((WP4.K.ipcD.retention.value * 100) / WP4.K.ipcD.gross.value);
  const claimD = await patchItem(k, LD, itemD.id, { qty: qtyOf(WP4.K.ipcD.gross.value, 'D-001'), retentionRate: rateD });
  need(claimD.status === 200 && Number(claimD.body?.data?.retentionRate) === rateD, `K11: the D-001 claim answered ${h.said(claimD)} (rate ${claimD.body?.data?.retentionRate})`);
  // K12: certified, invoiced, part paid; the ledger before and after; the cash inflow without a rebuild
  const ledger = async () => cents((await dataOf('cost', `${P}/cost/reconciliation`))?.ledger?.total ?? 0);
  const t0 = await ledger();
  const sD = await ipcAct('qs', k, LD, 'submit');
  const xD = await ipcAct('pm', k, LD, 'certify', { comment: `CERT3 WP4 K12 ${h.STAMP}` });
  need(sD.status === 200 && xD.status === 200 && xD.body?.data?.status === 'certified', `K12: submit ${h.said(sD)}, certify ${h.said(xD)} ${xD.body?.error?.message || ''}`);
  const inv = await send('finance', 'POST', `${ipcRoute(P, LD)}/invoice/issue`, { invoiceNumber: `CERT3-WP4-INV-K-${h.STAMP}`, invoiceDate: DATES.invoice, dueDate: DATES.invoiceDue });
  const pay = await send('finance', 'POST', `${ipcRoute(P, LD)}/payments`, { amount: units(WP4.K.ipcD.paid.value), paymentReference: `CERT3-WP4-PAY-K-${h.STAMP}`, paymentDate: DATES.ipcPayment, paymentMethod: 'bank_transfer', notes: `CERT3 WP4 K12 ${h.STAMP}` });
  need(inv.status === 201 && pay.status === 201, `K12: invoice ${h.said(inv)}, payment ${h.said(pay)} ${pay.body?.error?.message || ''}`);
  const fD = figuresOfCert(await readPeriod('qs', P, LD));
  const D = WP4.K.ipcD;
  const eD = { status: D.status.value, paymentStatus: D.paymentStatus.value, gross: D.gross.value, retention: D.retention.value, net: D.net.value, paid: D.paid.value, balance: D.balance.value };
  const oD = { status: fD.status, paymentStatus: fD.paymentStatus, gross: fD.gross, retention: fD.retention, net: fD.net, paid: fD.paid, balance: fD.balance };
  rec('K.IPC.D', sameJson(oD, eD), { expected: eD, observed: oD, detail: 'WP4.K.ipcD = WP4.existing stage10.* (checked at book load, G26)' });
  const flowD = await dataOf('cost', `${P}/cash-flow`);
  const inflowD = cents(monthOf(flowD, DATES.ipcPayment.slice(0, 7)).inflow);
  rec('K.cashInflow', inflowD === D.cashInflow.value, { expected: D.cashInflow.value, observed: { month: DATES.ipcPayment.slice(0, 7), inflow: inflowD, summary: flowD?.summary ?? null }, detail: 'GET /cash-flow right after the payment, no manual rebuild (the payment path rebuilds)' });
  const t1 = await ledger();
  rec('IPC.noCost', typeof t0 === 'number' && typeof t1 === 'number' && t1 - t0 === D.ledgerDelta.value, { expected: D.ledgerDelta.value, observed: { before: t0, after: t1, delta: typeof t0 === 'number' && typeof t1 === 'number' ? t1 - t0 : null } });
};

// -- K: K13-K14, the variation and the approved-CO lock -------------------------------------------------------------------
const kVariation = async () => {
  const k = ctx.k;
  const { P } = k;
  const a120 = KB.allocations.find((a) => a.row === 'B-002' && a.activity === 'K-A120');
  const coValue = WP4.I3.A120LimitAmount.value - a120.amount;
  const linkQty = WP4.I3.A120LimitQuantity.value - a120.qty;
  const coI3 = await primeCo(k, 'K-CO-I3', { value: units(coValue), activity: 'K-A120', budgetLine: k.lines['02-100:material'], extra: { allocationLinks: [{ allocationId: k.alloc['B-002/K-A120'], quantity: linkQty, amount: units(coValue), notes: `CERT3 WP4 K-CO-I3 ${h.STAMP}` }] }, to: 'approved' });
  // K13: K-IPC-I3, the A130 item PATCHed to qty 650
  const LI3 = `CERT3-WP4-K-IPC-I3-${h.STAMP}`;
  const cI3 = await openPeriod(k, LI3);
  const a130 = itemOf(cI3, k.alloc['B-002/K-A130']);
  const review = a130.certificationReview || {};
  obs.kI3Limits = { approvedLimitQuantity: num(review.approvedLimitQuantity), approvedLimitAmount: cents(review.approvedLimitAmount) };
  const leaf = WP4.I3.patchA130Qty650;
  const qty = WP4.I3.A130LimitQuantity.today;
  if (wants('KA.I3.patchA130Qty650', 'CF.HRC2')) await probe('KA.I3.patchA130Qty650 (K13)', async () => {
    const res = await patchItem(k, LI3, a130.id, { qty, retentionRate: Math.round((WP4.K.ipcD.retention.value * 100) / WP4.K.ipcD.gross.value) });
    const o = { said: h.said(res), qty, limits: obs.kI3Limits };
    ka('KA.I3.patchA130Qty650', { ref: leaf.ref, value: leaf.value, today: leaf.today, observed: o, verdict: judge(o, (x) => x.said === saidOf(leaf), (x) => x.said === '200'), detail: `K-CO-I3 (${units(coValue)}) links B-002/K-A120 for ${linkQty}; HEAD's variation scope also matches the BOQ item (HR-C2)` });
  });
  // K14: the approved K-CO-I3 cannot be PATCHed nor archived
  const patched = await send('qs', 'PATCH', `${P}/change-orders/${coI3.id}`, { value: 8000 });
  const rowP = (await coRegister(k)).find((r) => r.id === coI3.id);
  rec('E3.patchApproved', h.is(patched, saidOf(WP4.E3.patchApproved)) && cents(rowP?.value) === coValue, { expected: { said: saidOf(WP4.E3.patchApproved), value: coValue }, observed: { said: h.said(patched), value: cents(rowP?.value), status: rowP?.status ?? null }, detail: 'the catcher of M-LOCK / M-LOCKa' });
  const archived = await send('pm', 'DELETE', `${P}/change-orders/${coI3.id}`);
  const rowA = (await coRegister(k)).find((r) => r.id === coI3.id);
  rec('E3.archiveApproved', h.is(archived, saidOf(WP4.E3.archiveApproved)) && !rowA?.archivedAt, { expected: { said: saidOf(WP4.E3.archiveApproved), archivedAt: null }, observed: { said: h.said(archived), archivedAt: rowA?.archivedAt ?? null }, detail: 'the catcher of M-LOCK / M-LOCKb' });
};

// -- K: K15, the prime-CO refusals, reject / reopen, the pending archive, the split, the deductive CO ---------------------
const kPrimeCos = async () => {
  const k = ctx.k;
  const { P } = k;
  const base = (key, value) => ({ description: `CERT3 WP4 ${key} ${h.STAMP}`, category: 'client_variation', value, activityId: k.ids['K-A130'], budgetLineId: k.lines['02-100:material'], scheduleImpact: 0, raisedBy: `QS CERT3 WP4 ${key}` });
  // E3.createWithStatusPending
  const n0 = (await coRegister(k)).length;
  const pend = await send('qs', 'POST', `${P}/change-orders`, { ...base('K-CO-P', 1000), status: 'pending' });
  const n1 = (await coRegister(k)).length;
  rec('E3.createWithStatusPending', h.is(pend, saidOf(WP4.E3.createWithStatusPending)) && n1 === n0, { expected: { said: saidOf(WP4.E3.createWithStatusPending), created: 0 }, observed: { said: h.said(pend), created: n1 - n0 } });
  // E3.submitWithoutSummaries / submitWithoutDocument on K-CO-S
  const made = await send('qs', 'POST', `${P}/change-orders`, base('K-CO-S', 1000));
  const sId = made.status === 201 ? made.body?.data?.id : null;
  need(Boolean(sId), `K15: K-CO-S could not be created (${h.said(made)})`);
  const s1 = await send('qs', 'POST', `${P}/change-orders/${sId}/submit`, { comment: 'CERT3 WP4 K-CO-S' });
  rec('E3.submitWithoutSummaries', h.is(s1, saidOf(WP4.E3.submitWithoutSummaries)), { expected: saidOf(WP4.E3.submitWithoutSummaries), observed: h.said(s1) });
  const sum = await send('qs', 'PATCH', `${P}/change-orders/${sId}`, { scheduleImpactSummary: 'No programme effect (CERT3 WP4 K-CO-S)', costImpactSummary: '1000 at contract rates (CERT3 WP4 K-CO-S)', activityLinks: [{ activityId: k.ids['K-A130'], relationType: 'impacted', scheduleImpactDays: 0, costImpact: 1000, notes: 'CERT3 WP4 K-CO-S' }] });
  need(sum.status === 200, `K15: K-CO-S summaries answered ${h.said(sum)}`);
  const s2 = await send('qs', 'POST', `${P}/change-orders/${sId}/submit`, { comment: 'CERT3 WP4 K-CO-S' });
  rec('E3.submitWithoutDocument', h.is(s2, saidOf(WP4.E3.submitWithoutDocument)), { expected: saidOf(WP4.E3.submitWithoutDocument), observed: h.said(s2) });
  // reject without and with a reason, reopen (K-CO-B)
  const coB = await primeCo(k, 'K-CO-B', { value: 2000, activity: 'K-A130', budgetLine: k.lines['02-100:material'], to: 'pending' });
  const rj0 = await send('pm', 'POST', `${P}/change-orders/${coB.id}/reject`, {});
  rec('E3.rejectWithoutReason', h.is(rj0, saidOf(WP4.E3.rejectWithoutReason)), { expected: saidOf(WP4.E3.rejectWithoutReason), observed: h.said(rj0) });
  const rj1 = await send('pm', 'POST', `${P}/change-orders/${coB.id}/reject`, { reason: `CERT3 WP4 not substantiated ${h.STAMP}` });
  need(rj1.status === 200 && rj1.body?.data?.status === 'rejected', `K15: K-CO-B reject answered ${h.said(rj1)}`);
  const ro = await send('qs', 'POST', `${P}/change-orders/${coB.id}/reopen`, { comment: `CERT3 WP4 reopened ${h.STAMP}` });
  rec('E3.reopenRejected', ro.status === 200 && ro.body?.data?.status === WP4.E3.reopenRejected.value, { expected: WP4.E3.reopenRejected.value, observed: { said: h.said(ro), status: ro.body?.data?.status ?? null } });
  // the pending K-CO-40 archived by the PM
  const co40 = await primeCo(k, 'K-CO-40', { value: units(-WP4.E3.archivePendingDelta.value), activity: 'K-A130', budgetLine: k.lines['02-100:material'], to: 'pending' });
  const p0 = await pendingOf(k);
  const ar = await send('pm', 'DELETE', `${P}/change-orders/${co40.id}`);
  const p1 = await pendingOf(k);
  rec('E3.archivePendingDelta', ar.status === 200 && typeof p0 === 'number' && typeof p1 === 'number' && p1 - p0 === WP4.E3.archivePendingDelta.value, { expected: WP4.E3.archivePendingDelta.value, observed: { said: h.said(ar), before: p0, after: p1, delta: typeof p0 === 'number' && typeof p1 === 'number' ? p1 - p0 : null } });
  // a split that does not sum to its CO; a deductive CO
  const m0 = (await coRegister(k)).length;
  const split = await send('qs', 'POST', `${P}/change-orders`, { ...base('K-CO-SPLIT', units(WP4.E4.revisedDelta.value)), budgetAllocations: [{ budgetLineId: k.lines['02-100:material'], amount: units(WP4.E4.split01_100.value) }, { budgetLineId: k.lines['03-100:subcontract'], amount: units(WP4.E4.split02_100.value - 100000) }] });
  const m1 = (await coRegister(k)).length;
  rec('E4.splitMismatch', h.is(split, saidOf(WP4.E4.splitMismatch)) && m1 === m0, { expected: { said: saidOf(WP4.E4.splitMismatch), created: 0 }, observed: { said: h.said(split), created: m1 - m0 }, detail: `a ${units(WP4.E4.revisedDelta.value)} CO split ${units(WP4.E4.split01_100.value)} + ${units(WP4.E4.split02_100.value - 100000)}` });
  const ded = await send('qs', 'POST', `${P}/change-orders`, base('K-CO-DED', -1000));
  rec('E6.deductiveCo', h.is(ded, saidOf(WP4.E6.deductiveCo)), { expected: saidOf(WP4.E6.deductiveCo), observed: h.said(ded), detail: 'today\'s answer; HR-C13 undecided (CF.HRC13)' });
};

// -- K: K16-K19, the change events --------------------------------------------------------------------------------------
const ceRoute = (k, id) => `${k.P}/change-events/${id}`;
const newEvent = async (k, def) => {
  const res = await send('qs', 'POST', `${k.P}/change-events`, {
    title: `CERT3 WP4 ${def.ref} ${h.STAMP}`, description: `CERT3 WP4 ${def.ref}`, type: 'owner_change', origin: 'manual', activityId: k.ids[def.lines[0].activity], scheduleImpactDays: 0, notes: `CERT3 WP4 ${def.ref}`,
    lines: def.lines.map((l, i) => ({ description: `CERT3 WP4 ${def.ref} line ${i + 1} ${h.STAMP}`, costCodeId: k.codes[l.costCode], budgetLineId: k.lines[`${l.costCode}:${l.costType}`], activityId: k.ids[l.activity], quantity: 1, unit: 'ls', unitCost: units(l.rom), romAmount: units(l.rom) })),
  });
  const id = res.status === 201 ? res.body?.data?.id || null : null;
  need(Boolean(id), `${def.ref}: the change event could not be created (${h.said(res)} ${res.body?.error?.message || ''})`);
  const event = await dataOf('qs', ceRoute(k, id));
  const lineIds = def.lines.map((l, i) => (event.lines || []).find((x) => String(x.description).startsWith(`CERT3 WP4 ${def.ref} line ${i + 1} `))?.id);
  need(lineIds.every(Boolean), `${def.ref}: its lines could not be read back`);
  return { id, event, lineIds };
};
/** RFQs sent by procurement; each vendor's portal token is kept in memory only (never logged, never stored). */
const sendRfqs = async (k, ev, def, recipients) => {
  const res = await send('procurement', 'POST', `${ceRoute(k, ev.id)}/rfqs`, {
    recipients: recipients.map((r) => ({ ...(r.commitmentId ? { commitmentId: r.commitmentId } : {}), vendorCompanyId: ctx.dir[r.vendor].id, companyName: ctx.dir[r.vendor].name, contactName: `Estimating CERT3 WP4 ${r.vendor}`, contactEmail: ctx.dir[r.vendor].email })),
    dueDate: dayFromNow(14), instructions: `CERT3 WP4 price the lines ${def.ref} ${h.STAMP}`, lineIds: ev.lineIds,
  });
  need(res.status === 201, `${def.ref}: the RFQs answered ${h.said(res)} ${res.body?.error?.message || ''}`);
  const out = {};
  for (const r of recipients) {
    const rfq = listOf(res.body?.data?.rfqs).find((x) => x.vendorCompanyId === ctx.dir[r.vendor].id) || null;
    const token = String(rfq?.portalUrl || '').split('/rfq/')[1]?.split(/[?#]/)[0] || null;
    need(Boolean(rfq?.id && token), `${def.ref}: no RFQ (or no portal link) for ${r.vendor}`);
    out[r.vendor] = { id: rfq.id, token };
  }
  return out;
};
const quote = async (ev, rfq, amountsCents, ref) => {
  const res = await portal('PUT', `/public/rfqs/${rfq.token}/quote`, { lines: ev.lineIds.map((lineId, i) => ({ lineId, amount: units(amountsCents[i]), note: `CERT3 WP4 ${ref}` })), notes: `CERT3 WP4 quotation ${ref}`, validUntil: dayFromNow(30), leadTimeDays: 10, quotedBy: `Estimator CERT3 WP4 ${ref}` }, 'portal PUT /public/rfqs/<token>/quote');
  need(res.status === 200, `${ref}: the vendor's quote answered ${h.said(res)}`);
};
const accept = (k, rfq) => send('qs', 'POST', `${k.P}/change-events/rfqs/${rfq.id}/accept`, { createCommitmentChangeOrder: false });
const convert = (k, ev, n = 1) => send('qs', 'POST', `${ceRoute(k, ev.id)}/convert`, { description: `CERT3 WP4 convert ${n} ${h.STAMP}` });
/** An event priced: created, its RFQs sent, quoted through the portal, the first vendor's quote accepted. */
const pricedEvent = async (k, ref, { commitmentId = null } = {}) => {
  const def = kRow(KB.changeEvents, 'ref', ref);
  const ev = await newEvent(k, def);
  const rfqs = await sendRfqs(k, ev, def, def.rfqs.map((r, i) => ({ vendor: r.vendor, ...(i === 0 && commitmentId ? { commitmentId } : {}) })));
  for (const r of def.rfqs) await quote(ev, rfqs[r.vendor], r.quotes, `${ref}-${r.vendor}`);
  const afterRfq = (await dataOf('qs', ceRoute(k, ev.id))).status;
  const acc = await accept(k, rfqs[def.rfqs[0].vendor]);
  need(acc.status === 200 && acc.body?.data?.changeEvent?.status === 'priced', `${ref}: accept answered ${h.said(acc)} ${acc.body?.error?.message || ''}`);
  return { def, ev, rfqs, afterRfq, accepted: acc.body.data.changeEvent };
};

const kEvents = async () => {
  const k = ctx.k;
  // K16: K-E1 priced, converted, converted again; the CO's budget line (HR-C12)
  const e1 = await pricedEvent(k, 'K-E1');
  const quoteSum = (e1.accepted.lines || []).reduce((s, l) => s + (cents(l.quotedAmount) ?? NaN), 0);
  const conv = await convert(k, e1.ev);
  const regMid = await coRegister(k);
  const co = conv.body?.data?.changeOrder || {};
  const o1 = { said: h.said(conv), romTotal: (e1.ev.event.lines || []).reduce((s, l) => s + (cents(l.romAmount) ?? NaN), 0), afterRfqSend: e1.afterRfq, quoteA: quoteSum, afterAccept: e1.accepted.status, convertedValue: cents(co.value), coStatus: co.status ?? null, eventStatus: conv.body?.data?.changeEvent?.status ?? null };
  const E = WP4.E1;
  const e1e = { said: '201', romTotal: E.romTotal.value, afterRfqSend: E.afterRfqSend.value, quoteA: E.quoteA.value, afterAccept: E.afterAccept.value, convertedValue: E.convertedValue.value, coStatus: E.coStatus.value, eventStatus: E.eventStatus.value };
  rec('K.E1.converted', sameJson(o1, e1e), { expected: e1e, observed: o1 });
  const coRow = regMid.find((r) => r.id === co.id) || {};
  const allocations = Array.isArray(coRow.budgetAllocationsJson) ? coRow.budgetAllocationsJson : Array.isArray(coRow.budgetAllocations) ? coRow.budgetAllocations : [];
  const db = { budgetLineId: coRow.budgetLineId ?? null, budgetAllocations: allocations };
  const DB = WP4.HRC12.dropsBudgetLines;
  ka('KA.HRC12.dropsBudgetLines', { ref: DB.ref, value: DB.value, today: DB.today, observed: db, verdict: judge(db, (x) => x.budgetLineId === k.lines['02-100:material'] || (x.budgetAllocations.length > 0 && x.budgetAllocations.every((a) => a.budgetLineId === k.lines['02-100:material'])), (x) => x.budgetLineId === DB.today.budgetLineId && sameJson(x.budgetAllocations, DB.today.budgetAllocations)), detail: 'K-E1\'s lines name 02-100 and its material budget line' });
  const again = await convert(k, e1.ev, 2);
  const regAfter = await coRegister(k);
  rec('K.E1.convertAgain', h.is(again, saidOf(WP4.E1.convertAgain)) && regAfter.length === regMid.length, { expected: { said: saidOf(WP4.E1.convertAgain), newCos: 0 }, observed: { said: h.said(again), newCos: regAfter.length - regMid.length }, detail: 'the catcher of M-CONV0 (writes only on K)' });

  // K17: five concurrent converts of K-E2; then once more (E1.convertAgain, moved off 087-COM)
  if (wants('KA.E2.concurrent', 'KA.E2.pendingDelta', 'E1.convertAgain', 'CF.convertAtomic')) await probe('KA.E2.concurrent / pendingDelta, E1.convertAgain (K17)', async () => {
    let e2;
    try { e2 = await pricedEvent(k, 'K-E2'); } catch (error) { throw probeSetup('KA.E2.concurrent', error.message); }
    const p0 = await pendingOf(k);
    const before = new Set((await coRegister(k)).map((r) => r.id));
    const answers = await Promise.all([1, 2, 3, 4, 5].map((n) => convert(k, e2.ev, n)));
    const p1 = await pendingOf(k);
    const reg = await coRegister(k);
    const created = reg.filter((r) => !before.has(r.id));
    const ok2xx = answers.filter((a) => a.status === 201).length;
    const conflict409 = answers.filter((a) => h.said(a) === saidOf(WP4.E1.convertAgain)).length;
    // registerDelta: what the created rows themselves add to pending (draft and pending count, WP4.E2.pendingDelta);
    // pendingDelta: the contract's STORED total, which concurrent recomputes can leave short (suspect WP4-AGG-1).
    const registerDelta = created.filter((r) => ['draft', 'pending'].includes(r.status) && !r.archivedAt).reduce((s, r) => s + (cents(r.value) ?? NaN), 0);
    const o = { converts: answers.length, ok2xx, conflict409, changeOrders: created.length, pendingDelta: typeof p0 === 'number' && typeof p1 === 'number' ? p1 - p0 : null, registerDelta, answers: answers.map((a) => h.said(a)) };
    obs.e2Concurrent = o;
    const C2L = WP4.E2.concurrentConverts;
    ka('KA.E2.concurrent', { ref: C2L.ref, value: C2L.value, today: C2L.today, observed: o, verdict: judge(o, (x) => sameJson({ converts: x.converts, ok2xx: x.ok2xx, conflict409: x.conflict409, changeOrders: x.changeOrders }, C2L.value), (x) => x.ok2xx >= 2 && x.ok2xx + x.conflict409 === x.converts && x.changeOrders === x.ok2xx), detail: 'racy: a single success at HEAD reads value (KA.E2.midwayOrphans carries the deterministic reproduction)' });
    const PD = WP4.E2.pendingDelta;
    const per = PD.today.perSuccessfulConvert;
    const storedLag = typeof o.pendingDelta === 'number' && o.pendingDelta < o.registerDelta;
    ka('KA.E2.pendingDelta', { ref: PD.ref, value: PD.value, today: PD.today, observed: { pendingDelta: o.pendingDelta, registerDelta: o.registerDelta, ok2xx, storedLag }, verdict: judge(o, (x) => x.pendingDelta === PD.value && x.registerDelta === PD.value && x.changeOrders === 1, (x) => x.ok2xx >= 2 && x.registerDelta === x.ok2xx * per && typeof x.pendingDelta === 'number' && x.pendingDelta % per === 0 && x.pendingDelta >= per && x.pendingDelta <= x.registerDelta), detail: `GET /prime-contract pendingChangesValue (stored) and the created rows (register) across the five converts${storedLag ? '; the stored total is short of the register: WP4-AGG-1 (a lost update in recomputeChangeValues under concurrent writes)' : ''}` });
    const once = await convert(k, e2.ev, 6);
    const reg2 = await coRegister(k);
    rec('E1.convertAgain', h.is(once, saidOf(WP4.E1.convertAgain)) && reg2.length === reg.length, { expected: { said: saidOf(WP4.E1.convertAgain), newCos: 0 }, observed: { said: h.said(once), newCos: reg2.length - reg.length }, detail: 'K-E2, converted by the race, converted once more (a deviation from 087-COM\'s E1: M-CONV0 would write there)' });
  });

  // K18: K-SC-V with a pending CO; K-E3's RFQ carries it; voided; the convert refused midway; the CO approved on the void parent
  if (wants('KA.E2.midwayOrphans', 'KA.CCO.voidParent', 'C2.coOnClosed', 'CF.convertAtomic', 'CF.CCOparent')) {
    const made = await send('qs', 'POST', `${k.P}/commitments`, commitmentBody(k, 'K-SC-V'));
    const scvId = made.status === 201 ? made.body?.data?.id : null;
    need(Boolean(scvId), `K18: K-SC-V could not be created (${h.said(made)})`);
    const scv = await commitmentOf(k, scvId);
    const ccoRes = await commitmentCo(k, scv, 'K-SC-V-CO', kRow(KB.commitments, 'ref', 'K-SC-V').line.amount);
    const ccoId = ccoRes.status === 201 ? ccoRes.body?.data?.id : null;
    const ccoSub = ccoId ? await send('qs', 'POST', `${k.P}/commitments/change-orders/${ccoId}/submit`, {}) : null;
    need(ccoSub?.status === 200 && ccoSub.body?.data?.status === 'pending', `K18: K-SC-V's CO ${h.said(ccoRes)} / submit ${ccoSub ? h.said(ccoSub) : '-'}`);
    const e3 = await pricedEvent(k, 'K-E3', { commitmentId: scvId });
    const voided = await send('pm', 'DELETE', `${k.P}/commitments/${scvId}`, { reason: `CERT3 WP4 K18 the subcontract is withdrawn ${h.STAMP}` });
    need(voided.status === 200 && (await commitmentOf(k, scvId)).status === 'void', `K18: K-SC-V's void answered ${h.said(voided)} ${voided.body?.error?.message || ''}`);
    if (wants('KA.E2.midwayOrphans', 'CF.convertAtomic')) await probe('KA.E2.midwayOrphans (K18)', async () => {
      const reg0 = await coRegister(k);
      const res = await convert(k, e3.ev);
      const reg1 = await coRegister(k);
      const evNow = await dataOf('qs', ceRoute(k, e3.ev.id));
      const o = { said: h.said(res), orphans: reg1.length - reg0.length, eventStatus: evNow.status };
      obs.e2Midway = o;
      const ML = WP4.E2.midwayRefusalOrphans;
      const rb = CONTRACT['CONVERT-ATOMIC'].midwayRollback;
      ka('KA.E2.midwayOrphans', { ref: ML.ref, value: ML.value, today: ML.today, observed: o, verdict: judge(o, (x) => x.orphans === ML.value && x.eventStatus !== 'converted' && statusPart(x.said) >= 400 && statusPart(x.said) < 500 && (rb ? x.said === rb : true), (x) => x.said === `${ML.today.status} ${ML.today.code}` && x.orphans === ML.today.orphanPrimeCosPerAttempt && x.eventStatus === ML.today.eventStatus), detail: PENDING_NOTE('CONVERT-ATOMIC') });
    });
    if (wants('KA.CCO.voidParent', 'CF.CCOparent')) await probe('KA.CCO.voidParent (K18)', async () => {
      const k0 = await committedOn(k, '03-100:subcontract');
      const res = await send('pm', 'POST', `${k.P}/commitments/change-orders/${ccoId}/approve`, {});
      const k1 = await committedOn(k, '03-100:subcontract');
      const coNow = ((await commitmentOf(k, scvId)).changeOrders || []).find((x) => x.id === ccoId);
      const o = { said: h.said(res), coStatus: coNow?.status ?? null, committedDelta: typeof k0 === 'number' && typeof k1 === 'number' ? k1 - k0 : null };
      obs.ccoVoid = o;
      const VL = WP4.CCO.parentVoid;
      const rc = CONTRACT['CCO-PARENT'].refusalStatusCode;
      ka('KA.CCO.voidParent', { ref: VL.ref, value: VL.value, today: VL.today, observed: o, verdict: judge(o, (x) => statusPart(x.said) === VL.value.status && (rc ? x.said === rc : true) && x.coStatus === 'pending', (x) => x.said === String(VL.today.status) && x.coStatus === VL.today.coStatus && x.committedDelta === VL.today.committedDelta), detail: PENDING_NOTE('CCO-PARENT') });
    });
    obs.coOnVoid = h.said(await commitmentCo(k, scv, 'K-SC-V-CO2', 100000));
  }

  // K19: two accepted quotes on one line; an event whose CO is archived
  if (wants('KA.HRC12.secondAccept', 'CF.HRC12')) await probe('KA.HRC12.secondAccept (K19)', async () => {
    let two;
    try { two = await pricedEvent(k, 'K-TWO'); } catch (error) { throw probeSetup('KA.HRC12.secondAccept', error.message); }
    const second = await accept(k, two.rfqs[two.def.rfqs[1].vendor]);
    const now = await dataOf('qs', ceRoute(k, two.ev.id));
    const states = Object.fromEntries(two.def.rfqs.map((r) => [r.vendor, (now.rfqs || []).find((x) => x.id === two.rfqs[r.vendor].id)?.status ?? null]));
    const o = { said: h.said(second), states, lineQuoted: cents((now.lines || [])[0]?.quotedAmount) };
    obs.hrc12Two = o;
    const SL = WP4.HRC12.secondAcceptOnSameLine;
    ka('KA.HRC12.secondAccept', { ref: SL.ref, value: SL.value, today: SL.today, observed: o, verdict: judge(o, (x) => statusPart(x.said) === SL.value.status, (x) => x.said === '200' && Object.values(x.states).every((s) => s === 'accepted')), detail: 'the refusal\'s code is not asserted (HR-C12 undecided)' });
  });
  if (wants('KA.HRC12.archivedCoEvent', 'CF.HRC12')) await probe('KA.HRC12.archivedCoEvent (K19)', async () => {
    let arc;
    try { arc = await pricedEvent(k, 'K-ARC'); } catch (error) { throw probeSetup('KA.HRC12.archivedCoEvent', error.message); }
    const conv2 = await convert(k, arc.ev);
    const coId = conv2.body?.data?.changeOrder?.id || null;
    if (conv2.status !== 201 || !coId) throw probeSetup('KA.HRC12.archivedCoEvent', `K-ARC's convert answered ${h.said(conv2)}`);
    const del = await send('pm', 'DELETE', `${k.P}/change-orders/${coId}`);
    if (del.status !== 200) throw probeSetup('KA.HRC12.archivedCoEvent', `the archive of K-ARC's CO answered ${h.said(del)}`);
    const ev = await dataOf('qs', ceRoute(k, arc.ev.id));
    const reconvert = await convert(k, arc.ev, 2);
    const revoid = await send('pm', 'POST', `${ceRoute(k, arc.ev.id)}/void`, { reason: `CERT3 WP4 K-ARC ${h.STAMP}` });
    const o = { eventStatus: ev.status, reconvert: h.said(reconvert), revoid: h.said(revoid) };
    obs.hrc12Arc = o;
    const AL = WP4.HRC12.archivedCoEvent;
    ka('KA.HRC12.archivedCoEvent', { ref: AL.ref, value: AL.value, today: AL.today, observed: o, verdict: judge(o, (x) => x.eventStatus === AL.value, (x) => x.eventStatus === 'converted' && x.reconvert === saidOf(WP4.E1.convertAgain) && x.revoid === saidOf(WP4.E1.voidConverted)), detail: 'today: neither re-convertible nor voidable' });
  });
};

// -- K: K20-K21, commitments ---------------------------------------------------------------------------------------------
const kCommitments = async () => {
  const k = ctx.k;
  const { P } = k;
  // K20: the C1 refusals on three commitments
  const mL = await send('qs', 'POST', `${P}/commitments`, commitmentBody(k, 'K-SC-C1', { title: 'K-SC-L', noLines: true }));
  need(mL.status === 201, `K20: the commitment with no lines could not be created (${h.said(mL)})`);
  const sL = await send('qs', 'POST', `${P}/commitments/${mL.body.data.id}/submit`, {});
  rec('C1.submitNoLines', h.is(sL, saidOf(WP4.C1.submitNoLines)), { expected: saidOf(WP4.C1.submitNoLines), observed: h.said(sL) });
  const mN = await send('qs', 'POST', `${P}/commitments`, commitmentBody(k, 'K-SC-C1', { title: 'K-SC-N', omitVendor: true }));
  need(mN.status === 201, `K20: the commitment with no vendor could not be created (${h.said(mN)})`);
  const sN = await send('qs', 'POST', `${P}/commitments/${mN.body.data.id}/submit`, {});
  rec('C1.submitNoVendor', h.is(sN, saidOf(WP4.C1.submitNoVendor)), { expected: saidOf(WP4.C1.submitNoVendor), observed: h.said(sN) });
  const m1 = await send('qs', 'POST', `${P}/commitments`, commitmentBody(k, 'K-SC-C1'));
  const c1 = m1.status === 201 ? m1.body.data.id : null;
  need(Boolean(c1), `K20: K-SC-C1 could not be created (${h.said(m1)})`);
  const s1 = await send('qs', 'POST', `${P}/commitments/${c1}/submit`, {});
  need(s1.status === 200, `K20: K-SC-C1's submit answered ${h.said(s1)}`);
  const qa = await send('qs', 'POST', `${P}/commitments/${c1}/approve`, {});
  rec('C1.qsApprove', h.is(qa, saidOf(WP4.C1.qsApprove)) && (await commitmentOf(k, c1)).status === 'pending', { expected: saidOf(WP4.C1.qsApprove), observed: h.said(qa) });
  const rt = await send('pm', 'POST', `${P}/commitments/${c1}/return`, {});
  rec('C1.returnWithoutReason', h.is(rt, saidOf(WP4.C1.returnWithoutReason)), { expected: saidOf(WP4.C1.returnWithoutReason), observed: h.said(rt) });
  const k0 = await committedOn(k, '03-100:subcontract');
  const ap = await send('pm', 'POST', `${P}/commitments/${c1}/approve`, {});
  need(ap.status === 200 && ap.body?.data?.status === 'approved', `K20: the PM's approval answered ${h.said(ap)}`);
  const k1 = await committedOn(k, '03-100:subcontract');
  rec('C2.approvedNotExecuted', typeof k0 === 'number' && typeof k1 === 'number' && k1 - k0 === WP4.C2.approvedNotExecuted.value, { expected: WP4.C2.approvedNotExecuted.value, observed: { before: k0, after: k1 } });
  const pl = await send('qs', 'PUT', `${P}/commitments/${c1}/lines`, { lines: commitmentBody(k, 'K-SC-C1').lines });
  rec('C1.linesAfterApproval', h.is(pl, saidOf(WP4.C1.linesAfterApproval)), { expected: saidOf(WP4.C1.linesAfterApproval), observed: h.said(pl) });
  const ex = await send('pm', 'POST', `${P}/commitments/${c1}/execute`, {});
  rec('C1.executeWithoutDocument', h.is(ex, saidOf(WP4.C1.executeWithoutDocument)) && (await commitmentOf(k, c1)).status === 'approved', { expected: saidOf(WP4.C1.executeWithoutDocument), observed: h.said(ex) });
  const pa = await newPayApp(k, c1, 'PA-K-NE');
  rec('P1.notExecuted', h.is(pa, saidOf(WP4.P1.notExecuted)), { expected: saidOf(WP4.P1.notExecuted), observed: h.said(pa) });
  // K21: K-PC-CL executed, a pending CO, closed; the CO approved on the closed parent; a CO on the closed parent
  const pc = await executedCommitment(k, 'K-PC-CL');
  const ccoAmount = WP4.CCO.parentClosedCommitted.today - WP4.CCO.parentClosedCommitted.value;
  const cco = await commitmentCo(k, pc, 'K-PC-CL-CO', ccoAmount);
  const ccoId = cco.status === 201 ? cco.body?.data?.id : null;
  const ccoSub = ccoId ? await send('qs', 'POST', `${P}/commitments/change-orders/${ccoId}/submit`, {}) : null;
  need(ccoSub?.status === 200, `K21: K-PC-CL's CO ${h.said(cco)} / submit ${ccoSub ? h.said(ccoSub) : '-'}`);
  const cl = await send('pm', 'POST', `${P}/commitments/${pc.id}/close`, {});
  need(cl.status === 200 && cl.body?.data?.status === 'closed', `K21: K-PC-CL's close answered ${h.said(cl)} ${cl.body?.error?.message || ''}`);
  if (wants('KA.CCO.closedParent', 'CF.CCOparent')) await probe('KA.CCO.closedParent (K21)', async () => {
    const before = await committedOn(k, '02-100:material');
    const res = await send('pm', 'POST', `${P}/commitments/change-orders/${ccoId}/approve`, {});
    const after = await committedOn(k, '02-100:material');
    const coNow = ((await commitmentOf(k, pc.id)).changeOrders || []).find((x) => x.id === ccoId);
    const o = { said: h.said(res), coStatus: coNow?.status ?? null, committedBefore: before, committedAfter: after };
    obs.ccoClosed = o;
    const CL = WP4.CCO.parentClosed;
    const CC = WP4.CCO.parentClosedCommitted;
    const rc = CONTRACT['CCO-PARENT'].refusalStatusCode;
    ka('KA.CCO.closedParent', { ref: CL.ref, value: { refusal: CL.value, committed: CC.value }, today: { answer: CL.today, committed: CC.today }, observed: o, verdict: judge(o, (x) => statusPart(x.said) === CL.value.status && (rc ? x.said === rc : true) && x.committedAfter === CC.value, (x) => x.said === String(CL.today.status) && x.coStatus === CL.today.coStatus && x.committedAfter > x.committedBefore && x.committedAfter === CC.today), detail: PENDING_NOTE('CCO-PARENT') });
  });
  const onClosed = h.said(await commitmentCo(k, pc, 'K-PC-CL-CO2', 100000));
  need(obs.coOnVoid !== undefined, 'K21: C2.coOnClosed needs K18\'s probe on the void K-SC-V');
  rec('C2.coOnClosed', obs.coOnVoid === saidOf(WP4.C2.coOnClosed) && onClosed === saidOf(WP4.C2.coOnClosed), { expected: { void: saidOf(WP4.C2.coOnClosed), closed: saidOf(WP4.C2.coOnClosed) }, observed: { void: obs.coOnVoid, closed: onClosed } });
};

// -- K: K22-K24, pay applications and the subcontract closeout -------------------------------------------------------------
const kPayApps = async () => {
  const k = ctx.k;
  const { P } = k;
  const restore = (what, fn) => async () => { const res = await fn(); ctx.restorations.push(`${what}: ${h.said(res)}`); h.lead(`K restoration (a guard let a write through; a mutant is the likely cause): ${what} ${h.said(res)}`); };
  // K22: K-SC1
  const sc1 = await executedCommitment(k, 'K-SC1');
  const line1 = sc1.lines[0];
  const np = await send('qs', 'POST', `${P}/pay-apps`, { commitmentId: sc1.id, periodStart: DATES.periodStart, periodEnd: DATES.periodEnd });
  rec('P1.noPeriod', h.is(np, saidOf(WP4.P1.noPeriod)), { expected: saidOf(WP4.P1.noPeriod), observed: h.said(np), detail: 'G8: the route answers first' });
  const made = await newPayApp(k, sc1.id, 'PA-K1');
  need(made.status === 201, `K22: PA-K1 could not be raised (${h.said(made)})`);
  const pa1 = made.body.data;
  const count = async () => listOf(await dataOf('qs', `${P}/pay-apps?includeVoid=true&commitmentId=${sc1.id}`)).filter((a) => a.status !== 'void').length;
  const c0 = await count();
  const second = await newPayApp(k, sc1.id, 'PA-K1b');
  if (second.status >= 200 && second.status < 300) await restore(`PA-K1b ${second.body?.data?.id} voided`, () => send('pm', 'DELETE', `${P}/pay-apps/${second.body.data.id}`, { reason: `CERT3 WP4 restoration ${h.STAMP}` }))();
  const c1 = await count();
  rec('P1.secondOpen', h.is(second, saidOf(WP4.P1.secondOpen)) && second.body?.error?.details?.reasonCode === 'DUPLICATE_PERIOD' && c1 === c0, { expected: { said: saidOf(WP4.P1.secondOpen), reasonCode: 'DUPLICATE_PERIOD', created: 0 }, observed: { said: h.said(second), reasonCode: second.body?.error?.details?.reasonCode ?? null, open: [c0, c1] }, detail: 'the catcher of M-OPEN / M-OPENa' });
  const se = await send('qs', 'POST', `${P}/pay-apps/${pa1.id}/submit`, {});
  rec('P1.submitEmpty', h.is(se, saidOf(WP4.P1.submitEmpty)), { expected: saidOf(WP4.P1.submitEmpty), observed: h.said(se) });
  const lineAmount = kRow(KB.commitments, 'ref', 'K-SC1').line.amount;
  const ex = await claimPayApp(k, pa1, line1.id, lineAmount + 2000000);
  rec('P2.exceedsSchedule', h.is(ex, saidOf(WP4.P2.exceedsSchedule)), { expected: saidOf(WP4.P2.exceedsSchedule), observed: h.said(ex), detail: `the line ${units(lineAmount)} claimed ${units(lineAmount + 2000000)} (K22)` });
  const over = await claimPayApp(k, pa1, line1.id, WP4.P2.progressCap.value + WP4.P2.overClaimAmount.value);
  need(over.status === 200, `K22: the 60,000.00 claim answered ${h.said(over)}`);
  const oc = await send('qs', 'POST', `${P}/pay-apps/${pa1.id}/submit`, {});
  const d = oc.body?.error?.details || {};
  rec('P2.overClaim', h.is(oc, saidOf(WP4.P2.overClaimRefusal)) && cents(d.overClaimAmount) === WP4.P2.overClaimAmount.value && cents(listOf(d.lines)[0]?.capAmount) === WP4.P2.progressCap.value, { expected: { said: saidOf(WP4.P2.overClaimRefusal), overClaimAmount: WP4.P2.overClaimAmount.value, capAmount: WP4.P2.progressCap.value }, observed: { said: h.said(oc), overClaimAmount: cents(d.overClaimAmount), capAmount: cents(listOf(d.lines)[0]?.capAmount) } });
  const K1 = kRow(KB.payApps, 'app', 'PA-K1');
  const fit = await claimPayApp(k, pa1, line1.id, K1.gross);
  const fs1 = await send('qs', 'POST', `${P}/pay-apps/${pa1.id}/submit`, {});
  const fa = await send('pm', 'POST', `${P}/pay-apps/${pa1.id}/approve`, {});
  need(fit.status === 200 && fs1.status === 200 && fa.status === 200 && cents(fa.body?.data?.netThisPeriod) === K1.net, `K22: PA-K1 ${h.said(fit)} / ${h.said(fs1)} / ${h.said(fa)} (net ${fa.body?.data?.netThisPeriod})`);
  const pay2 = await send('finance', 'POST', `${P}/pay-apps/${pa1.id}/payments`, { amount: units(K1.net + 2), paidAt: DATES.paK1, method: 'bank_transfer', reference: `CERT3-WP4-PA-K1-P2-${h.STAMP}`, note: 'CERT3 WP4 +0.02' });
  const afterP2 = await payAppOf(k, pa1.id);
  rec('P4.payOverNetPlus2', h.is(pay2, saidOf(WP4.P4.payOverNetPlus2)) && cents(afterP2.paidAmount) === 0, { expected: { said: saidOf(WP4.P4.payOverNetPlus2), paidAmount: 0 }, observed: { said: h.said(pay2), paidAmount: cents(afterP2.paidAmount) }, detail: 'the catcher of M-CEIL (writes only on K)' });
  await probe('KA.P4.payOverNet (K22)', async () => {
    const pay1 = await send('finance', 'POST', `${P}/pay-apps/${pa1.id}/payments`, { amount: units(K1.net + 1), paidAt: DATES.paK1, method: 'bank_transfer', reference: `CERT3-WP4-PA-K1-P1-${h.STAMP}`, note: 'CERT3 WP4 +0.01' });
    const now = await payAppOf(k, pa1.id);
    const flow = await dataOf('cost', `${P}/cash-flow`);
    const o = { status: pay1.status, said: h.said(pay1), paidAmount: cents(now.paidAmount), payAppStatus: now.status, cashOutflow: cents(monthOf(flow, DATES.paK1.slice(0, 7)).outflow) };
    obs.c1tol = o;
    const leaf = WP4.P4.payOverNet;
    ka('KA.P4.payOverNet', { ref: leaf.ref, value: leaf.value, today: leaf.today, observed: o, verdict: judge(o, (x) => x.said === saidOf(leaf) && x.paidAmount === 0, (x) => sameJson({ status: x.status, paidAmount: x.paidAmount, payAppStatus: x.payAppStatus, cashOutflow: x.cashOutflow }, leaf.today)), detail: 'on K\'s own PA-K1 (net 45,000.00, nothing paid), after the +0.02 probe' });
  });
  // K23: K-SC3: the reopen while another is open, the compliance gate, reject and reopen
  const sc3 = await executedCommitment(k, 'K-SC3');
  const line3 = sc3.lines[0];
  const a = await payAppTo(k, sc3, 'PA-K3a', kRow(KB.payApps, 'app', 'PA-K3a').gross);
  const bMade = await newPayApp(k, sc3.id, 'PA-K3b', { waiverRequired: true });
  need(bMade.status === 201 && bMade.body?.data?.waiverRequired === true, `K23: PA-K3b answered ${h.said(bMade)}`);
  const b = bMade.body.data;
  const ro = await send('pm', 'POST', `${P}/pay-apps/${a.id}/reopen`, { reason: `CERT3 WP4 K23 revoke while PA-K3b is open ${h.STAMP}` });
  const aNow = (await payAppOf(k, a.id)).status;
  if (ro.status >= 200 && ro.status < 300) await restore(`PA-K3a ${a.id} voided`, () => send('pm', 'DELETE', `${P}/pay-apps/${a.id}`, { reason: `CERT3 WP4 restoration ${h.STAMP}` }))();
  rec('P1.reopenWhileOpen', h.is(ro, saidOf(WP4.P1.reopenWhileOpen)) && ro.body?.error?.details?.reasonCode === 'DUPLICATE_PERIOD' && aNow === 'approved', { expected: { said: saidOf(WP4.P1.reopenWhileOpen), reasonCode: 'DUPLICATE_PERIOD', status: 'approved' }, observed: { said: h.said(ro), reasonCode: ro.body?.error?.details?.reasonCode ?? null, status: aNow }, detail: 'the catcher of M-OPEN / M-OPENb' });
  const bc = await claimPayApp(k, b, line3.id, kRow(KB.payApps, 'app', 'PA-K3b').gross);
  const bs = await send('qs', 'POST', `${P}/pay-apps/${b.id}/submit`, {});
  need(bc.status === 200 && bs.status === 200, `K23: PA-K3b claim ${h.said(bc)}, submit ${h.said(bs)}`);
  const ap0 = await send('pm', 'POST', `${P}/pay-apps/${b.id}/approve`, {});
  rec('P5.complianceMissing', h.is(ap0, saidOf(WP4.P5.complianceMissing)) && ap0.body?.error?.details?.reasonCode === 'MISSING_COMPLIANCE', { expected: { said: saidOf(WP4.P5.complianceMissing), reasonCode: 'MISSING_COMPLIANCE' }, observed: { said: h.said(ap0), reasonCode: ap0.body?.error?.details?.reasonCode ?? null } });
  const reason = `CERT3 WP4 waiver to follow ${h.STAMP}`;
  const ap1 = await send('pm', 'POST', `${P}/pay-apps/${b.id}/approve`, { complianceOverrideReason: reason });
  rec('P5.complianceOverride', ap1.status === 200 && ap1.body?.data?.status === WP4.P5.complianceOverride.value && ap1.body?.data?.complianceOverrideReason === reason, { expected: { status: WP4.P5.complianceOverride.value, reason }, observed: { said: h.said(ap1), status: ap1.body?.data?.status ?? null, reason: ap1.body?.data?.complianceOverrideReason ?? null } });
  const c = await payAppTo(k, sc3, 'PA-K3c', kRow(KB.payApps, 'app', 'PA-K3c').gross, { approve: false });
  const rj = await send('pm', 'POST', `${P}/pay-apps/${c.id}/reject`, { code: 'INCORRECT_QUANTITIES', reason: `CERT3 WP4 re-measure ${h.STAMP}` });
  need(rj.status === 200 && rj.body?.data?.status === 'rejected', `K23: PA-K3c's reject answered ${h.said(rj)}`);
  const rop = await send('qs', 'POST', `${P}/pay-apps/${c.id}/reopen`, {});
  const rs = await send('qs', 'POST', `${P}/pay-apps/${c.id}/submit`, {});
  rec('P7.rejectedReopen', rop.status === 200 && rop.body?.data?.status === WP4.P7.rejectedReopen.value && rs.status === 200 && rs.body?.data?.status === 'submitted', { expected: { reopen: WP4.P7.rejectedReopen.value, resubmit: 'submitted' }, observed: { reopen: `${h.said(rop)} ${rop.body?.data?.status ?? ''}`.trim(), resubmit: `${h.said(rs)} ${rs.body?.data?.status ?? ''}`.trim() } });
  // K24: K-SC5's final application approved on the closeout gate's override, paid; the close refused with retention held
  const sc5 = await executedCommitment(k, 'K-SC5');
  const K5 = kRow(KB.payApps, 'app', 'PA-K5');
  const p5 = await payAppTo(k, sc5, 'PA-K5', K5.gross, { approveBody: { complianceOverrideReason: `CERT3 WP4 final application, closeout to follow ${h.STAMP}` } });
  const pay5 = await send('finance', 'POST', `${P}/pay-apps/${p5.id}/payments`, { amount: units(K5.paid), paidAt: DATES.paK5, method: 'bank_transfer', reference: `CERT3-WP4-PA-K5-${h.STAMP}`, note: 'CERT3 WP4 K24' });
  need(pay5.status === 201 && pay5.body?.data?.status === 'paid', `K24: PA-K5's payment answered ${h.said(pay5)} (${pay5.body?.data?.status})`);
  const close = await send('pm', 'POST', `${P}/commitments/${sc5.id}/close`, {});
  const labels = listOf(close.body?.error?.details?.outstanding).map((x) => (typeof x === 'string' ? x : x?.label ?? x?.key ?? null));
  rec('C5.closeWithRetentionHeld', h.is(close, saidOf(WP4.C5.closeWithRetentionHeld)) && labels.includes(WP4.C5.outstandingLabel.value), { expected: { said: saidOf(WP4.C5.closeWithRetentionHeld), outstanding: WP4.C5.outstandingLabel.value }, observed: { said: h.said(close), outstanding: labels }, detail: 'today\'s refusal; HR-C13 undecided (CF.HRC13)' });
};

// -- K: K25-K26, two drafts and the empty period ---------------------------------------------------------------------------
const kDrafts = async () => {
  const k = ctx.k;
  const { P } = k;
  const contract = await dataOf('qs', `${P}/prime-contract`);
  need(contract.originalValueSource === WP4.I5.valueSourceAfter.value, `K25: K's contract value is ${contract.originalValueSource}; K6 must have entered it`);
  if (wants('CF.DRAFTS1')) await probe('CF.DRAFTS1 observation (K25)', async () => {
    const LX = `CERT3-WP4-K-IPC-X-${h.STAMP}`;
    const LY = `CERT3-WP4-K-IPC-Y-${h.STAMP}`;
    const cx = await openPeriod(k, LX);
    const cy = await openPeriod(k, LY);
    const qty = qtyOf(WP4.DRAFTS1.draftClaim.value, 'E-001');
    const px = await patchItem(k, LX, itemOf(cx, k.alloc['E-001/K-A230']).id, { qty });
    const py = await patchItem(k, LY, itemOf(cy, k.alloc['E-001/K-A230']).id, { qty });
    const sx = await ipcAct('qs', k, LX, 'submit');
    const sy = await ipcAct('qs', k, LY, 'submit');
    if (sx.status !== 200 || sy.status !== 200) throw probeSetup('CF.DRAFTS1', `the two drafts' submits answered ${h.said(sx)} / ${h.said(sy)}`);
    const x = await ipcAct('pm', k, LX, 'certify', { comment: `CERT3 WP4 K25 X ${h.STAMP}` });
    const y = await ipcAct('pm', k, LY, 'certify', { comment: `CERT3 WP4 K25 Y ${h.STAMP}` });
    obs.drafts1 = { patches: { first: px.status, second: py.status }, firstCertify: { said: h.said(x), status: x.body?.data?.status ?? null }, secondCertify: h.said(y), overEarned: cents(y.body?.error?.details?.overEarnedAmount), claim: cents(px.body?.data?.currentCert) };
  });
  if (wants('KA.HRC3.emptyPeriod', 'CF.HRC3')) await probe('KA.HRC3.emptyPeriod (K26)', async () => {
    const LE = `CERT3-WP4-K-IPC-E-${h.STAMP}`;
    await openPeriod(k, LE);
    const se = await ipcAct('qs', k, LE, 'submit');
    if (se.status !== 200) throw probeSetup('KA.HRC3.emptyPeriod', `the empty period's submit answered ${h.said(se)}`);
    const ce = await ipcAct('pm', k, LE, 'certify', { comment: `CERT3 WP4 K26 ${h.STAMP}` });
    const f = figuresOfCert(await readPeriod('qs', P, LE));
    const o = { said: h.said(ce), certificateStatus: f.status, totalCert: f.gross, netPayable: f.net, retentionStatus: f.retentionStatus };
    obs.emptyPeriod = o;
    const leaf = WP4.HRC3.emptyPeriod;
    ka('KA.HRC3.emptyPeriod', { ref: leaf.ref, value: leaf.value, today: leaf.today, observed: o, verdict: judge(o, (x) => statusPart(x.said) === leaf.value.status, (x) => sameJson({ status: statusPart(x.said), certificateStatus: x.certificateStatus, totalCert: x.totalCert, netPayable: x.netPayable, retentionStatus: x.retentionStatus }, { ...leaf.today, totalCert: cents(leaf.today.totalCert), netPayable: cents(leaf.today.netPayable) })), detail: 'the refusal\'s code is not asserted (HR-C3 undecided)' });
  });
};

// -- K: K27, cash flow ---------------------------------------------------------------------------------------------------
const kCash = async () => {
  const k = ctx.k;
  const { P } = k;
  if (!wants('KA.CASH.CF4.concurrentRebuilds', 'KA.CASH.CF3.deleteSystemRow', 'KA.CASH.CF3.period13', 'CF.CERT5')) return;
  await probe('KA.CASH.CF4 / CF3 (K27)', async () => {
    const rebuild = () => send('cost', 'POST', `${P}/cash-flow/rebuild`, {});
    const systemRows = (flow) => listOf(flow?.rows).filter((r) => r.source === 'system');
    const sets = (flow) => { const byPeriod = {}; for (const r of systemRows(flow)) byPeriod[r.period] = (byPeriod[r.period] || 0) + 1; return Object.values(byPeriod).reduce((m, x) => Math.max(m, x), 0); };
    const totals = (flow) => ({ inflow: cents(flow?.summary?.inflow), outflow: cents(flow?.summary?.outflow), net: cents(flow?.summary?.net) });
    const r0 = await rebuild();
    if (r0.status !== 200) throw probeSetup('KA.CASH.CF4.concurrentRebuilds', `the first rebuild answered ${h.said(r0)}`);
    const flow0 = await dataOf('cost', `${P}/cash-flow`);
    if (!systemRows(flow0).length) throw probeSetup('KA.CASH.CF4.concurrentRebuilds', 'K has no system cash-flow row (K12, K22, K24 pay)');
    const answers = await Promise.all([1, 2, 3, 4, 5].map(() => rebuild()));
    const flow1 = await dataOf('cost', `${P}/cash-flow`);
    const o4 = { answers: answers.map((a) => h.said(a)), systemRows: [systemRows(flow0).length, systemRows(flow1).length], systemRowSets: sets(flow1), totalsEqualCF1: sameJson(totals(flow1), totals(flow0)), totals: [totals(flow0), totals(flow1)] };
    obs.cf4 = o4;
    const L4 = WP4.CF4.concurrentRebuilds;
    ka('KA.CASH.CF4.concurrentRebuilds', { ref: L4.ref, value: L4.value, today: L4.today, observed: o4, verdict: judge(o4, (x) => x.systemRowSets === L4.value.systemRowSets && x.totalsEqualCF1 === L4.value.totalsEqualCF1, (x) => x.systemRowSets > 1), detail: 'on K, totalsEqualCF1 reads: the summary equals the one rebuild\'s read before them (WP4.CF4 note); racy' });
    const r1 = await rebuild();
    if (r1.status !== 200) throw probeSetup('KA.CASH.CF3.deleteSystemRow', `the normalising rebuild answered ${h.said(r1)}`);
    const row = systemRows(await dataOf('cost', `${P}/cash-flow`))[0];
    const del = await send('cost', 'DELETE', `${P}/cash-flow/${row.id}`);
    const stillThere = systemRows(await dataOf('cost', `${P}/cash-flow`)).some((r) => r.id === row.id);
    const o3 = { said: h.said(del), period: row.period, stillThere };
    obs.cf3Delete = o3;
    const L3 = WP4.CF3.deleteSystemRow;
    ka('KA.CASH.CF3.deleteSystemRow', { ref: L3.ref, value: L3.value, today: L3.today, observed: o3, verdict: judge(o3, (x) => statusPart(x.said) === L3.value && x.stillThere, (x) => statusPart(x.said) === L3.today && !x.stillThere), detail: 'the code is not asserted (L120: CERT-5)' });
    await rebuild();
    const p13 = await send('cost', 'POST', `${P}/cash-flow`, { period: '2026-13', inflow: 1, outflow: 0, note: `CERT3 WP4 K27 month 13 ${h.STAMP}` });
    const o13 = { said: h.said(p13) };
    obs.cf3Period13 = o13;
    const L13 = WP4.CF3.period2026_13;
    ka('KA.CASH.CF3.period13', { ref: L13.ref, value: L13.value, today: L13.today, observed: o13, verdict: judge(o13, (x) => statusPart(x.said) === L13.value, (x) => statusPart(x.said) === L13.today), detail: 'the code is not asserted (VALIDATION_ERROR or INVALID_PERIOD; WP4-CF-1 when confirmed, WP4ADJ Q13)' });
  });
};

/** The K choreography's end: K archived, archivedAt read back (S.K.archived). */
const kEnd = async () => {
  const a = await archive(ctx.k, 'K');
  rec('S.K.archived', a?.status === 200 && Boolean(a?.archivedAt), { observed: a, detail: `K ${ctx.k.id}` });
};

// -- K2: I2 certified on the second throwaway (WP4ADJ Q11; WP4.K2) --------------------------------------------------------
const k2Flow = async () => {
  ctx.k2 = await makeThrowaway(K2B.project, { planner: 'planning_eng', qs: 'qs', site: 'site_engineer', finance: 'finance' }, 'K2');
  const t = ctx.k2;
  const { P } = t;
  // K2-1: one activity, the I1-shaped row C-001, allocated whole and approved, the activity at its 40%
  const row = kRow(KB.bill, 'code', 'C-001');
  const alloc = KB.allocations.find((a) => a.row === 'C-001');
  const made = await makeActivities(t, ['K2-A110'], 'WP4-K2');
  const bill = await makeBillRow(t, row);
  const al = await makeAllocation(t, { row: 'C-001', activity: 'K2-A110', qty: alloc.qty, amount: alloc.amount });
  const pr = await makeProgress(t, 'K2-A110', alloc.approvedPct);
  // K2-2: the first read copies the explicit 7.5; the contract PATCHed to its value at 10
  const first = await dataOf('qs', `${P}/prime-contract`);
  const cfg = await send('qs', 'PATCH', `${P}/prime-contract`, { title: `CERT3 WP4 K2 client contract ${h.STAMP}`, originalValue: CONTRACT_VALUE, retentionRate: D087B.primeContractRetention.value, paymentTermsDays: 30, status: 'active', notes: `CERT3 WP4 K2-2 ${h.STAMP}` });
  const fixture = { created: h.said(t.created), team: t.members, made, bill, allocation: al, progress: pr, firstRead: first?.retentionRate ?? null, contract: { said: h.said(cfg), retentionRate: cfg.body?.data?.retentionRate ?? null, source: cfg.body?.data?.originalValueSource ?? null } };
  obs.k2Fixture = fixture;
  const fixtureOk = t.created.status === 201 && t.members.every((m) => [200, 201].includes(m.status)) && made.every(([, s]) => s === '201') && bill[1] === '201' && al[3] === '200' && al[4] === 'approved' && pr[2] === '200' && pr[3] === alloc.approvedPct
    && Number(t.shown.defaultRetentionRate) === D087B.projectRetention.value && Number(first?.retentionRate) === D087B.projectRetention.value
    && cfg.status === 200 && Number(cfg.body?.data?.retentionRate) === D087B.primeContractRetention.value && cfg.body?.data?.originalValueSource === WP4.I5.valueSourceAfter.value;
  need(fixtureOk, `K2-0..K2-2: the fixture could not be set up (${json(fixture, 900)})`);
  // K2-3: the draft; the item's rate before any claim (recorded: WP4.K2.itemRetentionRate); 400 m3 claimed WITHOUT a rate
  const label = `CERT3-WP4-K2-IPC-01-${h.STAMP}`;
  const c0 = await openPeriod(t, label);
  const item = itemOf(c0, t.alloc['C-001/K2-A110']);
  const itemRate = Number(item.retentionRate);
  const claim = await patchItem(t, label, item.id, { qty: qtyOf(WP4.I1.currentCert.value, 'C-001') });
  need(claim.status === 200, `K2-3: the claim answered ${h.said(claim)}`);
  const draft = figuresOfCert(await readPeriod('qs', P, label));
  // K2-4: submitted and certified by the PM; I2 judged on the certified certificate
  const sub = await ipcAct('qs', t, label, 'submit');
  need(sub.status === 200, `K2-4: submit answered ${h.said(sub)}`);
  const cert = await ipcAct('pm', t, label, 'certify', { comment: `CERT3 WP4 K2-4 ${h.STAMP}` });
  const f = figuresOfCert(await readPeriod('qs', P, label));
  const IR = WP4.K2.itemRetentionRate;
  const o = { said: h.said(cert), status: f.status, retention: f.retention, net: f.net, draft: { itemRetentionRate: itemRate, retention: draft.retention, net: draft.net } };
  obs.k2I2 = o;
  ka('I2.contractRate', {
    ref: WP4.I2.retention.ref, value: { status: 'certified', retention: WP4.I2.retention.value, net: WP4.I2.net.value }, today: { status: 'certified', retention: WP4.I2.retention.today, net: WP4.I2.net.today }, observed: o,
    verdict: judge(o, (x) => x.said === '200' && x.status === 'certified' && x.retention === WP4.I2.retention.value && x.net === WP4.I2.net.value, (x) => x.said === '200' && x.status === 'certified' && x.retention === WP4.I2.retention.today && x.net === WP4.I2.net.today),
    detail: `judged on the certified certificate (G4); the draft item rate ${itemRate} recorded (WP4.K2.itemRetentionRate value ${IR.value}, today ${IR.today}: whether a draft shows the contract's rate before certification is the HR-C1 contract)`,
  });
  const a = await archive(t, 'K2');
  rec('S.K2', fixtureOk && a?.status === 200 && Boolean(a?.archivedAt), { expected: { project: K2B.project, firstRead: D087B.projectRetention.value, contract: D087B.primeContractRetention.value, archived: true }, observed: { ...fixture, archive: a } });
};

// -- 052-COM, with the 087-COM halves of the mixed checks (before 087-COM's rebuild) ------------------------------------
/** The months the build's payments fall in (build/087-com.js:776, 052-com.js:523 and :809: dates of the builders; UTC months). */
const CASH_MONTHS = { i8087: '2026-05', i8052: '2026-08', p4052: '2026-07', advance087: '2026-07', cf1: ['2026-08', '2026-09'] };
const explainEntries = async (who, P, activityId, sourceId) => listOf((await dataOf(who, `${P}/cost/reconciliation/explain?activityId=${activityId}&limit=500`))?.entries)
  .filter((e) => e.sourceId === sourceId).sort((x, y) => String(x.postedAt).localeCompare(String(y.postedAt)));
const p3Ledger = (entries, P3) => {
  const o = { amounts: entries.map((e) => cents(e.amount)), reversals: entries.map((e) => e.isReversal === true), total: entries.reduce((s, e) => s + (cents(e.amount) ?? NaN), 0) };
  const e = { amounts: [P3.approvePosts.value, P3.revokeMirror.value, P3.reapprovePosts.value], reversals: [false, true, false], total: P3.sourceTotalAfter.value };
  return { ok: sameJson(o, e), expected: e, observed: o };
};

const d2Flow = async () => {
  const st052 = ctx.state['052-COM'];
  const st087 = ctx.state['087-COM'];
  const s52 = storedCom052(st052);
  const s87 = storedCom087(st087);
  const P52 = ctx.deep['052-COM'].P;
  const P87 = ctx.deep['087-COM'].P;
  const pickKa = (j) => ({ value: j.value, today: j.today, observed: j.observed, verdict: j.verdict, storedAt: j.storedAt ?? null });
  ka('HRC1.stored.052COM', { ref: 'HR-C1', ...pickKa(s52['HRC1.stored.052COM']), detail: 'stored at the build (052-COM project.retention-unset, contract.value, ipc.I1, ipc.I8)' });
  rec('D2.E1.stored', s52['D2.E1.stored'].ok === true, { expected: s52['D2.E1.stored'].expected, observed: s52['D2.E1.stored'].observed, detail: '052-COM\'s E2 left priced and unused (WP4ADJ Q6)' });
  rec('C1.stored.insurance', s87.insurance.ok && s52.insurance.ok, { expected: { '087-COM': s87.insurance.expected, '052-COM': s52.insurance.expected }, observed: { '087-COM': s87.insurance.observed, '052-COM': s52.insurance.observed } });
  rec('C2.stored', s87.c2.ok && s52.c2.ok, { expected: { '087-COM': s87.c2.expected, '052-COM': s52.c2.expected }, observed: { '087-COM': s87.c2.observed, '052-COM': s52.c2.observed }, detail: s87.c2.detail });
  rec('D2.stored.ipc03', s52['D2.stored.ipc03'].ok === true, { expected: s52['D2.stored.ipc03'].expected, observed: s52['D2.stored.ipc03'].observed });
  rec('I8.stored', s87.i8.ok && s52.i8.ok, { expected: { '087-COM': s87.i8.expected, '052-COM': s52.i8.expected }, observed: { '087-COM': s87.i8.observed, '052-COM': s52.i8.observed } });
  const AR = WP4.I8.afterReleaseStatus;
  const ar = { '087-COM': s87.afterRelease, '052-COM': s52.afterRelease };
  const arPaid = (x) => x.paymentStatus === WP4.I8.afterReleasePaymentStatus.value;
  ka('KA.I8.afterReleaseStatus', { ref: AR.ref, value: AR.value, today: AR.today, observed: ar, verdict: judge(Object.values(ar), (xs) => xs.every((x) => x.status === AR.value && arPaid(x)), (xs) => xs.every((x) => x.status === firstWord(AR.today) && arPaid(x))), detail: 'the certificate in each release answer (ipc.03 / ipc.I8 afterRelease)' });
  rec('P3.stored', s87.p3.ok && s52.p3.ok, { expected: { '087-COM': s87.p3.expected, '052-COM': s52.p3.expected }, observed: { '087-COM': s87.p3.observed, '052-COM': s52.p3.observed } });
  rec('P4.stored', s87.p4.ok && s52.p4.ok, { expected: { '087-COM': s87.p4.expected, '052-COM': s52.p4.expected }, observed: { '087-COM': s87.p4.observed, '052-COM': s52.p4.observed } });

  // live 052-COM: I3's limits (read only), I4's refusals, the C2 / I8 / I9 / P3 / P4 reads
  const alloc52 = outOf(st052, 'allocations').ids;
  const L1 = outOf(st052, 'ipc.I1').label;
  const L2 = outOf(st052, 'ipc.I8').label;
  const L3 = outOf(st052, 'ipc.I4-submitted').label;
  const ipc01 = await dataOf('qs052', ipcRoute(P52, L1));
  const lim = (allocationId) => { const r = itemOf(ipc01, allocationId).certificationReview || {}; return { quantity: num(r.approvedLimitQuantity), amount: cents(r.approvedLimitAmount) }; };
  const a120 = lim(alloc52['B-002.A120']);
  const a130 = lim(alloc52['B-002.A130']);
  obs.i3Limits = { A120: a120, A130: a130 };
  rec('I3.limits.A120', a120.quantity === WP4.I3.A120LimitQuantity.value && a120.amount === WP4.I3.A120LimitAmount.value && D052.I3.A120LimitQuantity.value === WP4.I3.A120LimitQuantity.value, { expected: { quantity: WP4.I3.A120LimitQuantity.value, amount: WP4.I3.A120LimitAmount.value }, observed: a120, detail: 'the catcher of M-VAR0 (read only)' });
  const QL = WP4.I3.A130LimitQuantity;
  const AL = WP4.I3.A130LimitAmount;
  ka('KA.I3.limits.A130', { ref: QL.ref, value: { quantity: QL.value, amount: AL.value }, today: { quantity: QL.today, amount: AL.today }, observed: a130, verdict: judge(a130, (x) => x.quantity === QL.value && x.amount === AL.value, (x) => x.quantity === QL.today && x.amount === AL.today), detail: 'CO-I3 names B-002/A120 only (HR-C2)' });
  const i4 = async (id, who, method, route, body, leaf, what) => {
    const res = await deepProbe('052-COM', who, method, route, body, what);
    rec(id, h.is(res, saidOf(leaf)), { expected: saidOf(leaf), observed: h.said(res) });
  };
  const c001 = itemOf(ipc01, alloc52['C-001.A220']);
  await i4('I4.patchItemStatus', 'qs052', 'PATCH', `${ipcRoute(P52, L1)}/items/${c001.id}`, { status: 'certified' }, WP4.I4.patchItemStatus, 'a direct item status PATCH on IPC-01');
  await i4('I4.submitTwice', 'qs052', 'POST', `${ipcRoute(P52, L3)}/submit`, {}, WP4.I4.submitTwice, 'a second submit of IPC-03');
  const ipc03 = await dataOf('qs052', ipcRoute(P52, L3));
  await i4('I4.patchAfterSubmit', 'qs052', 'PATCH', `${ipcRoute(P52, L3)}/items/${itemOf(ipc03, alloc52['B-001.A110']).id}`, { qty: D052.ipc03.quantity.value }, WP4.I4.patchAfterSubmit, 'an item PATCH on the submitted IPC-03');
  await i4('I4.certifyDraft', 'pm052', 'POST', `${ipcRoute(P52, L1)}/certify`, { comment: `CERT3 WP4 proof ${h.STAMP}` }, WP4.I4.certifyDraft, 'a certify of the draft IPC-01');
  const invoiceBody = (n) => ({ invoiceNumber: `CERT3-WP4-PROBE-${n}-${h.STAMP}`, invoiceDate: DATES.invoice, dueDate: DATES.invoiceDue });
  await i4('I4.invoiceBeforeCertify', 'pm052', 'POST', `${ipcRoute(P52, L3)}/invoice/issue`, invoiceBody('I3'), WP4.I4.invoiceBeforeCertify, 'an invoice on the submitted IPC-03');
  await i4('I4.secondInvoice', 'pm052', 'POST', `${ipcRoute(P52, L2)}/invoice/issue`, invoiceBody('I2'), WP4.I4.secondInvoice, 'a second invoice on IPC-02');
  await i4('I4.periodTwice', 'qs052', 'POST', `${P52}/ipc`, { period: L1 }, WP4.I4.periodTwice, 'a second period with IPC-01\'s label');
  // I8 live on both, before 087-COM's rebuild
  const I8 = WP4.I8;
  const live = (c) => ({ status: c.status, paymentStatus: c.paymentStatus, retentionStatus: c.retentionStatus, amountPaid: cents(c.amountPaid), balanceDue: cents(c.balanceDue) });
  const l87 = live(await dataOf('qs', ipcRoute(P87, outOf(st087, 'ipc.03').label)));
  const l52 = live(await dataOf('qs052', ipcRoute(P52, L2)));
  const eI8 = { status: I8.paySecond.value, paymentStatus: I8.paySecond.value, retentionStatus: 'released', amountPaid: I8.amountPaidTotal.value, balanceDue: 0 };
  rec('I8.live', sameJson(l87, eI8) && sameJson(l52, { ...eI8, amountPaid: D052.I8.amountPaidTotal.value }), { expected: eI8, observed: { '087-COM': l87, '052-COM': l52 } });
  const flow87 = await dataOf('cost', `${P87}/cash-flow`);
  const flow52 = await dataOf('cost052', `${P52}/cash-flow`);
  const in87 = cents(monthOf(flow87, CASH_MONTHS.i8087).inflow);
  const in52 = cents(monthOf(flow52, CASH_MONTHS.i8052).inflow);
  rec('I8.cashInflowWithoutRebuild', in87 === I8.cashInflowWithoutRebuild.value && in52 === D052.I8.cashInflowWithoutRebuild.value, { expected: { '087-COM': I8.cashInflowWithoutRebuild.value, '052-COM': D052.I8.cashInflowWithoutRebuild.value }, observed: { '087-COM': { month: CASH_MONTHS.i8087, inflow: in87 }, '052-COM': { month: CASH_MONTHS.i8052, inflow: in52 } }, detail: 'read before this run\'s own rebuild of 087-COM (the D2 section runs before COM)' });
  // I9: the statement and the receivables on both companies
  const i9of = async (who, P) => { const s = await dataOf(who, `${P}/prime-contract/statement`); const r = await dataOf(who, `${P}/prime-contract/receivables`); const statement = cents(s?.summary?.invoiced); const receivables = cents(r?.invoiced); return { statement, receivables, difference: typeof statement === 'number' && typeof receivables === 'number' ? receivables - statement : null }; };
  const i9 = { '052-COM': await i9of('pm052', P52), '087-COM': await i9of('pm', P87) };
  obs.i9 = i9;
  const I9 = WP4.I9;
  ka('KA.I9.statementVsReceivables', {
    ref: I9.disagreement.ref, value: { '052-COM': { statement: I9.statementInvoiced.value, receivables: I9.receivablesInvoiced.value, difference: I9.disagreement.value }, '087-COM': { statement: I9.on087.statementInvoiced.value, receivables: I9.on087.receivablesInvoiced.value, difference: I9.on087.difference.value } }, today: { '052-COM': I9.disagreement.today, '087-COM': I9.on087.difference.today }, observed: i9,
    // Integration owner (2026-10-10): HR-C4 is undecided (CERT-5 decides), so this answer has no value yet and reads
    // BLOCKED on HEAD's figures; a "value" reading here would pre-judge HR-C4. The book's numbers are kept for the record.
    verdict: judge(i9, () => false, (x) => sameJson(x['052-COM'], { statement: I9.statementInvoiced.value, receivables: I9.receivablesInvoiced.value, difference: I9.disagreement.today }) && sameJson(x['087-COM'], { statement: I9.on087.statementInvoiced.value, receivables: I9.on087.receivablesInvoiced.value, difference: I9.on087.difference.today })),
    detail: 'HEAD\'s statement and receivables figures, which disagree by the released retention (9,750.00 on each company); HR-C4 undecided (CERT-5 decides, CERT-3 records), so BLOCKED, never a value',
  });
  // P3 on 052-COM's PA-01 ledger; P4's revocation refused; P4's outflow
  const act52 = outOf(st052, 'activities').ids;
  const pa52 = outOf(st052, 'payapp.P3').id;
  const led52 = p3Ledger(await explainEntries('cost052', P52, act52.A310, pa52), D052.P3);
  rec('P3.ledger.052', led52.ok, { expected: led52.expected, observed: led52.observed });
  const rv = await deepProbe('052-COM', 'pm052', 'POST', `${P52}/pay-apps/${pa52}/reopen`, { reason: `CERT3 WP4 proof: revoke a part-paid application ${h.STAMP}` }, 'a revocation of the part-paid PA-01');
  rec('P4.revokeAfterPayment', h.is(rv, saidOf(WP4.P4.revokeAfterPayment)), { expected: saidOf(WP4.P4.revokeAfterPayment), observed: h.said(rv) });
  const out52 = cents(monthOf(flow52, CASH_MONTHS.p4052).outflow);
  rec('P4.cashOutflowWithoutRebuild', out52 === WP4.P4.cashOutflowWithoutRebuild.value, { expected: WP4.P4.cashOutflowWithoutRebuild.value, observed: { month: CASH_MONTHS.p4052, outflow: out52 } });
  // C2 live on both
  const r87 = cents((await dataOf('qs', `${P87}/commitments/${outOf(st087, 'commitment.SC-001').id}`)).revised);
  const r52 = cents((await dataOf('qs052', `${P52}/commitments/${outOf(st052, 'commitment.SC-001').id}`)).revised);
  rec('C2.live', r87 === WP4.C2.committedCoApproved.value && r52 === D052.C2.committedCoApproved.value, { expected: { '087-COM': WP4.C2.committedCoApproved.value, '052-COM': D052.C2.committedCoApproved.value }, observed: { '087-COM': r87, '052-COM': r52 } });
};

// -- 087-COM: the stored moments, the reads and refusals, the one idempotent rebuild ---------------------------------------
const comFlow = async () => {
  const st = ctx.state['087-COM'];
  const s = storedCom087(st);
  const { P } = ctx.deep['087-COM'];
  const pickKa = (j) => ({ value: j.value, today: j.today, observed: j.observed, verdict: j.verdict, storedAt: j.storedAt ?? null });
  const stored = (id) => rec(id, s[id].ok === true, { expected: s[id].expected, observed: s[id].observed, detail: s[id].detail || '' });
  ka('HRC1.stored.087COM', { ref: 'HR-C1', ...pickKa(s['HRC1.stored.087COM']), detail: 'stored at the build (087-COM project.retention-unset, contract.value, ipc.I1 and its BLOCKED step, ipc.02)' });
  stored('E1.stored');
  stored('E5.stored');
  stored('RFI.stored');
  stored('I6.stored');
  stored('I7.stored');
  stored('P6.stored');
  stored('CASH.CF1.stored');
  const lines = outOf(st, 'budget-lines').ids;
  const acts = outOf(st, 'activities').ids;
  const allocs = outOf(st, 'allocations').ids;
  const cos = outOf(st, 'contract.after-cos').changeOrders;
  const label = (step) => outOf(st, step).label;
  // E1's refusals on the converted E1, the open and the pricing events
  const e1 = outOf(st, 'ce.E1').eventId;
  const states = outOf(st, 'ce.states').ids;
  const pc = await deepProbe('087-COM', 'qs', 'PATCH', `${P}/change-events/${e1}`, { notes: `CERT3 WP4 proof: an edit after conversion ${h.STAMP}` }, 'a PATCH of the converted E1');
  rec('E1.patchConverted', h.is(pc, saidOf(WP4.E1.patchConverted)), { expected: saidOf(WP4.E1.patchConverted), observed: h.said(pc) });
  const vc = await deepProbe('087-COM', 'pm', 'POST', `${P}/change-events/${e1}/void`, { reason: `CERT3 WP4 proof ${h.STAMP}` }, 'a void of the converted E1');
  rec('E1.voidConverted', h.is(vc, saidOf(WP4.E1.voidConverted)), { expected: saidOf(WP4.E1.voidConverted), observed: h.said(vc) });
  const vw = await deepProbe('087-COM', 'pm', 'POST', `${P}/change-events/${states.open}/void`, {}, 'a void of the open event without a reason');
  rec('E1.voidWithoutReason', h.is(vw, saidOf(WP4.E1.voidWithoutReason)), { expected: saidOf(WP4.E1.voidWithoutReason), observed: h.said(vw) });
  const dl = await deepProbe('087-COM', 'pm', 'DELETE', `${P}/change-events/${states.pricing}`, undefined, 'a DELETE of the pricing event');
  rec('E1.deleteWithRfqs', h.is(dl, saidOf(WP4.E1.deleteWithRfqs)), { expected: saidOf(WP4.E1.deleteWithRfqs), observed: h.said(dl) });
  // E4: CO-SPLIT's budget-line change rows
  const changeRows = async (lineId) => listOf((await dataOf('cost', `${P}/budget/lines/${lineId}`))?.changes).filter((c) => c.kind === 'change_order' && c.changeOrderId === cos['CO-SPLIT']).reduce((sum, c) => sum + (cents(c.amount) ?? NaN), 0);
  const e4 = { split01_100: await changeRows(lines['01-100:labour']), split02_100: await changeRows(lines['02-100:material']) };
  e4.revisedDelta = e4.split01_100 + e4.split02_100;
  const e4e = { split01_100: WP4.E4.split01_100.value, split02_100: WP4.E4.split02_100.value, revisedDelta: WP4.E4.revisedDelta.value };
  rec('E4.split', sameJson(e4, e4e), { expected: e4e, observed: e4 });
  // E5: the contract and the CO register now; BR-<CO-125 ref>
  const contract = await dataOf('qs', `${P}/prime-contract`);
  const register = await coRegister(ctx.deep['087-COM']);
  const X = D087.contractEnd;
  const listed = [...X.approvedChanges.value, ...X.pendingChanges.value, ...X.notCounted.value].map((entry) => { const row = register.find((r) => r.id === cos[entry.co]); return { co: entry.co, expected: [entry.status, entry.amount], observed: row ? [row.archivedAt ? 'archived' : row.status, cents(row.value)] : null }; });
  const e5o = { approved: cents(contract.approvedChangesValue), pending: cents(contract.pendingChangesValue), revised: cents(contract.revisedValue), listed };
  const e5ok = e5o.approved === X.approvedChangesValue.value && e5o.pending === X.pendingChangesValue.value && e5o.revised === X.revisedValue.value && listed.every((l) => sameJson(l.expected, l.observed));
  rec('E5.contractEnd', e5ok, { expected: { approved: X.approvedChangesValue.value, pending: X.pendingChangesValue.value, revised: X.revisedValue.value }, observed: e5o });
  const co125 = outOf(st, 'co.CO-125');
  const br = listOf(await dataOf('cost', `${P}/budget-revisions`), 'revisions').find((r) => r.linkedChangeOrder === co125.id || r.ref === `BR-${co125.ref}`) || null;
  rec('E5.budgetRevision', Boolean(br) && br.ref === `BR-${co125.ref}` && br.status === 'approved' && cents(br.amount) === WP4.E5.budgetRevision.value, { expected: { ref: `BR-${co125.ref}`, status: 'approved', amount: WP4.E5.budgetRevision.value }, observed: br ? { ref: br.ref, status: br.status, amount: cents(br.amount), linkedChangeOrder: br.linkedChangeOrder ?? null } : null });
  // RFI: converted twice; C1: the executed SC-001 voided with a reason
  const rfi = outOf(st, 'co.RFI').rfiId;
  const rf = await deepProbe('087-COM', 'pm', 'POST', `${P}/rfi/${rfi}/convert-to-change`, { description: `CERT3 WP4 proof: convert again ${h.STAMP}`, category: 'client_instruction', value: units(WP4.rfiCo.value.value) }, 'a second conversion of the RFI');
  rec('RFI.convertTwice', h.is(rf, saidOf(WP4.rfiCo.convertTwice)), { expected: saidOf(WP4.rfiCo.convertTwice), observed: h.said(rf) });
  const sc1 = outOf(st, 'commitment.SC-001').id;
  const vx = await deepProbe('087-COM', 'pm', 'DELETE', `${P}/commitments/${sc1}`, { reason: `CERT3 WP4 proof: void an executed commitment ${h.STAMP}` }, 'a void of the executed SC-001');
  rec('C1.voidExecuted', h.is(vx, saidOf(WP4.C1.voidExecuted)), { expected: saidOf(WP4.C1.voidExecuted), observed: h.said(vx), detail: 'sent with a reason (G7)' });
  // C4 (L108): PC-001's committed line and PA-PC1's actual line
  const paPc1 = outOf(st, 'payapp.PC-001').id;
  const pcOriginal = cents(outOf(st, 'commitment.PC-001').sovLines?.[0]?.amount);
  const budgetRows = listOf(await dataOf('cost', `${P}/budget/lines`), 'lines');
  const c4Lines = { material: lines['02-100:material'], subcontract: lines['02-100:subcontract'] };
  const committedLines = Object.entries(c4Lines).filter(([, id]) => (cents(budgetRows.find((r) => r.id === id)?.committedFromCommitments) ?? 0) >= pcOriginal).map(([name]) => name);
  const actualByLine = {};
  for (const [name, id] of Object.entries(c4Lines)) actualByLine[name] = listOf((await dataOf('cost', `${P}/cost/reconciliation/explain?budgetLineId=${id}&limit=500`))?.entries).filter((e) => e.sourceId === paPc1).reduce((sum, e) => sum + (cents(e.amount) ?? NaN), 0);
  const actualLines = Object.entries(actualByLine).filter(([, v]) => v !== 0).map(([name]) => name);
  const c4 = { committedLines, actualLines, actualByLine, pcOriginal };
  obs.c4 = c4;
  const SL = WP4.C4.sameLine;
  ka('KA.C4.sameLine', { ref: SL.ref, value: SL.value, today: SL.today, observed: c4, verdict: judge(c4, (x) => x.committedLines.length === 1 && x.actualLines.length === 1 && x.committedLines[0] === x.actualLines[0], (x) => sameJson(x.committedLines, ['material']) && sameJson(x.actualLines, ['subcontract'])), detail: 'PC-001 names cost code 02-100 only; 02-100 holds a material and a subcontract line (L108)' });
  const actualTotal = Object.values(actualByLine).reduce((sum, v) => sum + v, 0);
  rec('C4.actualPosted', actualTotal === WP4.C4.actualPosted.value, { expected: WP4.C4.actualPosted.value, observed: { actualByLine, total: actualTotal } });
  // IPC reads and refusals
  const L02 = label('ipc.02');
  const L05 = label('ipc.05');
  const L06 = label('ipc.06');
  const L07 = label('ipc.07');
  const L08 = label('ipc.08');
  const L09 = label('ipc.09');
  const L10 = label('ipc.10');
  const pb = await deepProbe('087-COM', 'finance', 'POST', `${ipcRoute(P, L07)}/payments`, { amount: 1, paymentReference: `CERT3-WP4-PROBE-${h.STAMP}`, paymentDate: DATES.paK5, paymentMethod: 'bank_transfer' }, 'a payment on the uninvoiced IPC-07');
  rec('I4.paymentBeforeInvoice', h.is(pb, saidOf(WP4.I4.paymentBeforeInvoice)), { expected: saidOf(WP4.I4.paymentBeforeInvoice), observed: h.said(pb) });
  const qc = await deepProbe('087-COM', 'qs', 'POST', `${ipcRoute(P, L09)}/certify`, { comment: `CERT3 WP4 proof ${h.STAMP}` }, 'a QS certify of IPC-09');
  rec('I6.qsCertify', h.is(qc, saidOf(WP4.I6.qsCertify)), { expected: saidOf(WP4.I6.qsCertify), observed: h.said(qc) });
  const ipc10 = await dataOf('qs', ipcRoute(P, L10));
  const a130 = itemOf(ipc10, allocs['B-002.A130']);
  const qty200 = WP4.I6.claimed.value / Math.round(Number(a130.rate) * 100);
  const so = await deepProbe('087-COM', 'qs', 'PATCH', `${ipcRoute(P, L10)}/items/${a130.id}`, { qty: qty200 }, 'a 200 m3 claim on IPC-10\'s A130');
  if (so.status >= 200 && so.status < 300) ctx.restorations.push(`087-COM IPC-10 A130 put back to qty ${a130.qty}: ${h.said(await send('qs', 'PATCH', `${ipcRoute(P, L10)}/items/${a130.id}`, { qty: Number(a130.qty) }))}`);
  rec('I6.setupObstacle', h.is(so, saidOf(WP4.I6.setupObstacle)), { expected: saidOf(WP4.I6.setupObstacle), observed: { said: h.said(so), qty: qty200 } });
  const fig = (c) => ({ totalRet: cents(c.totalRet), netPayable: cents(c.netPayable), taxAmount: cents(c.taxAmount), advanceRecovery: cents(c.advanceRecovery) });
  const c02 = fig(await dataOf('qs', ipcRoute(P, L02)));
  const c05 = fig(await dataOf('qs', ipcRoute(P, L05)));
  const c08 = fig(await dataOf('qs', ipcRoute(P, L08)));
  const i7o = { totalRetCapped: c02.totalRet, netCapped: c02.netPayable, taxAmount: c05.taxAmount, netWithTax: c05.netPayable, advanceRecovery: c08.advanceRecovery, netWithAdvance: c08.netPayable };
  const i7e = { totalRetCapped: WP4.I7.totalRetCapped.value, netCapped: WP4.I7.netCapped.value, taxAmount: WP4.I7.taxAmount.value, netWithTax: WP4.I7.netWithTax.value, advanceRecovery: WP4.I7.advanceRecovery.value, netWithAdvance: WP4.I7.netWithAdvance.value };
  rec('I7.live', sameJson(i7o, i7e), { expected: i7e, observed: i7o });
  const dn = await deepProbe('087-COM', 'qs', 'PATCH', `${ipcRoute(P, L10)}/adjustments`, { deductions: units(D087.ipc09.deductions.value) }, 'a deduction without a note on IPC-10');
  rec('I7.deductionWithoutNote', h.is(dn, saidOf(WP4.I7.deductionWithoutNote)), { expected: saidOf(WP4.I7.deductionWithoutNote), observed: h.said(dn) });
  const c07 = await dataOf('qs', ipcRoute(P, L07));
  const I10 = WP4.I10;
  const i10o = { grossThisPeriod: cents(c07.grossThisPeriod), materialsOnSite: cents(c07.materialsOnSite), totalRet: cents(c07.totalRet), advanceRecovery: cents(c07.advanceRecovery), deductions: cents(c07.deductions), taxAmount: cents(c07.taxAmount), netPayable: cents(c07.netPayable), stored: s.i10Stored };
  const i10e = { grossThisPeriod: I10.gross.value, materialsOnSite: I10.materialsOnSite.value, totalRet: I10.retentionHeld.value, advanceRecovery: I10.preconditions.value.advanceRecovery, deductions: I10.preconditions.value.deductions, taxAmount: 0, netPayable: I10.net.value, stored: { grossThisPeriod: I10.gross.value, netPayable: I10.net.value } };
  rec('I10.live', sameJson(i10o, i10e), { expected: i10e, observed: i10o, detail: 'the certificate\'s gross (the leaf\'s value); WP4.I10.gross.today is the invoice gross (HR-C4), not read here' });
  obs.static = staticScan();
  const ipc09 = await dataOf('qs', ipcRoute(P, L09));
  const a310 = itemOf(ipc09, allocs['B-004.A310']);
  const bp = await deepProbe('087-COM', 'qs', 'PATCH', `${ipcRoute(P, L09)}/items/${a310.id}`, { qty: D087.ipc09.quantity.value }, 'an item PATCH on the submitted IPC-09');
  const BD = WP4.I11.submittedBackToDraft;
  const i11 = { patch: h.said(bp), backRoutes: obs.static.ipcBackToDraftRoute };
  ka('KA.I11.backToDraft', { ref: BD.ref, value: BD.value, today: BD.today, observed: i11, verdict: judge(i11, (x) => Array.isArray(x.backRoutes) && x.backRoutes.length > 0, (x) => x.patch === saidOf(WP4.I4.patchAfterSubmit) && Array.isArray(x.backRoutes) && x.backRoutes.length === 0), detail: 'routes/ipc.js scanned for a submitted -> draft route' });
  const pp = await deepProbe('087-COM', 'pm', 'POST', `${ipcRoute(P, L06)}/payments`, { amount: 1, paymentReference: `CERT3-WP4-PROBE-PM-${h.STAMP}`, paymentDate: DATES.paK5, paymentMethod: 'bank_transfer' }, 'a PM payment on IPC-06');
  rec('I12.pmPayment', h.is(pp, saidOf(WP4.I12.pmRecordsPayment)), { expected: saidOf(WP4.I12.pmRecordsPayment), observed: h.said(pp), detail: 'L211; owner question HR-A3 (WP4ADJ Q14)' });
  const items10 = ipc10.items || [];
  const allocIds = Object.values(allocs);
  rec('IPC.itemsFromAllocations', items10.length === WP4.IPC.itemsFromAllocations.value && allocIds.length === WP4.IPC.itemsFromAllocations.value && items10.every((i) => allocIds.includes(i.allocationId)) && new Set(items10.map((i) => i.allocationId)).size === items10.length, { expected: WP4.IPC.itemsFromAllocations.value, observed: { items: items10.length, allocations: allocIds.length, withoutAllocation: items10.filter((i) => !allocIds.includes(i.allocationId)).length } });
  // WP4-OVR-1 (CF.OVR1): the live review; the refusals sent only while the override is required (else they would certify)
  const review = ipc09.certificationReview || {};
  const a130rev = (itemOf(ipc09, allocs['B-002.A130']).certificationReview) || {};
  const ovr = { stored: s.ovr1, live: { requiresPmOverride: review.requiresPmOverride ?? null, overEarned: cents(review.overEarnedAmount), a130OverEarned: cents(a130rev.overEarnedAmount) }, pmWithoutReason: null, financeWithReason: null };
  if (review.requiresPmOverride === true) {
    ovr.pmWithoutReason = h.said(await deepProbe('087-COM', 'pm', 'POST', `${ipcRoute(P, L09)}/certify`, { comment: `CERT3 WP4 proof ${h.STAMP}` }, 'a PM certify of IPC-09 without a reason'));
    ovr.financeWithReason = h.said(await deepProbe('087-COM', 'finance', 'POST', `${ipcRoute(P, L09)}/certify`, { comment: `CERT3 WP4 proof ${h.STAMP}`, overrideReason: `CERT3 WP4 proof: finance tries the override ${h.STAMP}` }, 'a finance certify of IPC-09 with a reason'));
  }
  obs.ovr1 = ovr;
  // P3: the ledger of PA-01; the revocation refusals on PA-03; P6 on PA-08; P7 on PA-04
  const pa01 = outOf(st, 'payapp.01').id;
  const led = p3Ledger(await explainEntries('cost', P, acts.A310, pa01), WP4.P3);
  rec('P3.ledger.087', led.ok, { expected: led.expected, observed: led.observed });
  const pa34 = outOf(st, 'payapp.03-04').ids;
  const qr = await deepProbe('087-COM', 'qs', 'POST', `${P}/pay-apps/${pa34.approved}/reopen`, { reason: `CERT3 WP4 proof ${h.STAMP}` }, 'a QS revocation of PA-03');
  rec('P3.qsRevoke', h.is(qr, saidOf(WP4.P3.qsRevoke)), { expected: saidOf(WP4.P3.qsRevoke), observed: h.said(qr) });
  const pr = await deepProbe('087-COM', 'pm', 'POST', `${P}/pay-apps/${pa34.approved}/reopen`, {}, 'a PM revocation of PA-03 without a reason');
  rec('P3.revokeWithoutReason', h.is(pr, saidOf(WP4.P3.revokeWithoutReason)), { expected: saidOf(WP4.P3.revokeWithoutReason), observed: h.said(pr) });
  const pa08 = outOf(st, 'payapp.08-final').id;
  const p6 = await deepProbe('087-COM', 'pm', 'POST', `${P}/pay-apps/${pa08}/approve`, {}, 'a PM approval of the final PA-08');
  const pa08Now = (await dataOf('qs', `${P}/pay-apps/${pa08}`)).status;
  rec('P6.live', h.is(p6, saidOf(WP4.P6.finalCloseoutGate)) && pa08Now === 'submitted', { expected: { said: saidOf(WP4.P6.finalCloseoutGate), status: 'submitted' }, observed: { said: h.said(p6), status: pa08Now } });
  const p7 = await deepProbe('087-COM', 'pm', 'POST', `${P}/pay-apps/${pa34.underReview}/reject`, {}, 'a reject of PA-04 without a reason');
  rec('P7.rejectWithoutReason', h.is(p7, saidOf(WP4.P7.rejectWithoutReason)), { expected: saidOf(WP4.P7.rejectWithoutReason), observed: h.said(p7) });
  // cash flow: CF1 and CF2 read before the rebuild; finance refused; the cost controller's one rebuild
  const flow0 = await dataOf('cost', `${P}/cash-flow`);
  const m = (flow, p) => ({ inflow: cents(monthOf(flow, p).inflow), outflow: cents(monthOf(flow, p).outflow) });
  const [aug, sep] = CASH_MONTHS.cf1.map((p) => m(flow0, p));
  const cf1 = { '2026-08.outflow': aug.outflow, '2026-09.inflow': sep.inflow, '2026-09.outflow': sep.outflow, 'summary.inflow': aug.inflow + sep.inflow, 'summary.outflow': aug.outflow + sep.outflow, 'summary.net': (aug.inflow - aug.outflow) + (sep.inflow - sep.outflow) };
  const cf1e = Object.fromEntries(Object.keys(cf1).map((key) => [key, WP4.CF1[key].value]));
  rec('CASH.CF1.live', sameJson(cf1, cf1e), { expected: cf1e, observed: cf1, detail: 'the 2026-08..2026-09 window (G14), before this run\'s rebuild' });
  const CF2 = WP4.CF2.advanceInflow;
  const adv = m(flow0, CASH_MONTHS.advance087).inflow;
  ka('KA.CASH.CF2.advanceInflow', { ref: CF2.ref, value: CF2.value, today: CF2.today, observed: { month: CASH_MONTHS.advance087, inflow: adv }, verdict: judge(adv, (x) => x === CF2.value, (x) => x === CF2.today), detail: 'the advance received 2026-07-01 (L115: CERT-5)' });
  const fr = await deepProbe('087-COM', 'finance', 'POST', `${P}/cash-flow/rebuild`, {}, 'a finance rebuild');
  rec('CASH.CF5.financeRebuild', h.is(fr, saidOf(WP4.CF5.financeRebuild)), { expected: saidOf(WP4.CF5.financeRebuild), observed: h.said(fr) });
  const manualId = outOf(st, 'cash-flow.manual').ids['2026-10'];
  const m0 = listOf(flow0?.rows).find((r) => r.id === manualId) || null;
  const cr = await send('cost', 'POST', `${P}/cash-flow/rebuild`, {});
  const flow1 = await dataOf('cost', `${P}/cash-flow`);
  const m1 = listOf(flow1?.rows).find((r) => r.id === manualId) || null;
  rec('CASH.CF5.costControllerRebuild', cr.status === WP4.CF5.costControllerRebuild.value, { expected: WP4.CF5.costControllerRebuild.value, observed: h.said(cr), detail: 'the one deep write of the run (idempotent; WP4ADJ Q1)' });
  const sys = (flow) => (flow?.monthly || []).map((x) => [x.period, cents(x.inflow), cents(x.outflow)]);
  rec('CASH.CF3.manualSurvivesRebuild', Boolean(m0) && Boolean(m1) && m1.source === 'manual' && cents(m1.inflow) === WP4.CF3.manualSurvivesRebuild.value && sameJson(sys(flow0), sys(flow1)), { expected: { manual: WP4.CF3.manualSurvivesRebuild.value, months: 'unchanged' }, observed: { before: m0 ? { source: m0.source, inflow: cents(m0.inflow) } : null, after: m1 ? { source: m1.source, inflow: cents(m1.inflow) } : null, monthsUnchanged: sameJson(sys(flow0), sys(flow1)) } });
};

// -- 087-COM-B: C3 (read only) -----------------------------------------------------------------------------------------
const combFlow = async () => {
  const s = storedComB(ctx.state['087-COM-B']).c3;
  const live = await dataOf('qs', `${ctx.deep['087-COM-B'].P}/commitments/${s.commitmentId}`);
  rec('C3.projectDefault', s.ok && Number(live.retentionRate) === WP4.C3.projectDefault.value, { expected: { ...s.expected, live: WP4.C3.projectDefault.value }, observed: { ...s.observed, live: live.retentionRate } });
};

// -- 087-COM-C: I5, one-shot (WP4ADJ Q7; WP4.I5.rerunRule) --------------------------------------------------------------
const comcFlow = async () => {
  const s = storedComC(ctx.state['087-COM-C'])['I5.stored'];
  rec('I5.stored', s.ok === true, { expected: s.expected, observed: s.observed });
  const { id, P } = ctx.deep['087-COM-C'];
  const route = ipcRoute(P, s.label);
  const X = D087C.ipc01;
  const CR = WP4.I5.confirmRequest.value;
  const now = await dataOf('pm', route);
  const contract = await dataOf('pm', `${P}/prime-contract`);
  const confirmations = async () => (await auditEvents('pm', P, `entityType=project&entityId=${id}&action=updated&source=audit`))
    .filter((e) => e.summary?.transition === CR.audit.transition && e.summary?.originalValueConfirmation === CR.audit.originalValueConfirmation);
  const certified = (c) => ({ status: c.status, gross: cents(c.totalCert), retention: cents(c.totalRet), net: cents(c.netPayable) });
  const eCert = { status: WP4.I5.afterValueEntered.value, gross: X.gross.value, retention: X.retention.value, net: X.net.value };
  const auditOk = (events) => events.length === 1 && events[0].oldSummary?.originalValueSource === CR.sourceBefore && events[0].newSummary?.originalValueSource === CR.sourceAfter && cents(events[0].newSummary?.originalValue) === CR.originalValue;
  if (now.status === 'submitted' && contract.originalValueSource === CR.sourceBefore) {
    // the first run: the gate live, the confirmation, the certification
    const gate = await send('pm', 'POST', `${route}/certify`, { comment: `CERT3 WP4 proof: the gate ${h.STAMP}` });
    const afterGate = (await dataOf('pm', route)).status;
    rec('I5.gateLive', h.is(gate, saidOf(WP4.I5.certifyOnBoqFallback)) && afterGate === 'submitted', { expected: { said: saidOf(WP4.I5.certifyOnBoqFallback), status: 'submitted' }, observed: { said: h.said(gate), status: afterGate } });
    const conf = await send(CR.by, 'PATCH', `${P}/prime-contract`, CR.body);
    const events = await confirmations();
    const cert = await send('pm', 'POST', `${route}/certify`, { comment: `CERT3 WP4 proof: after the confirmation ${h.STAMP}` });
    const end = certified(await dataOf('pm', route));
    const o = { confirm: { said: h.said(conf), originalValue: cents(conf.body?.data?.originalValue), source: conf.body?.data?.originalValueSource ?? null }, audit: events.map((e) => ({ at: e.occurredAt, old: e.oldSummary?.originalValueSource, new: e.newSummary?.originalValueSource })), certify: h.said(cert), ...end };
    obs.i5 = { run: 'first', ...o };
    rec('I5.afterValueEntered', conf.status === CR.status && o.confirm.originalValue === CR.originalValue && o.confirm.source === CR.sourceAfter && auditOk(events) && cert.status === 200 && sameJson(end, eCert), { expected: { confirm: CR, certified: eCert }, observed: o, detail: 'one-shot (WP4ADJ Q7)' });
  } else if (['certified', 'paid'].includes(now.status) && contract.originalValueSource === CR.sourceAfter) {
    // a re-run (WP4.I5.rerunRule): the certified figures and the confirmation's audit event; the gate on the record
    const events = await confirmations();
    const end = certified(now);
    const at = events[0]?.occurredAt ?? null;
    const gateOk = s.observed.gate === saidOf(WP4.I5.certifyOnBoqFallback) && auditOk(events) && Boolean(at) && Boolean(now.certifiedAt) && Date.parse(at) <= Date.parse(now.certifiedAt);
    obs.i5 = { run: 're-run', certifiedAt: now.certifiedAt ?? null, confirmationAt: at, ...end };
    rec('I5.gateLive', gateOk, { expected: { buildRefusal: saidOf(WP4.I5.certifyOnBoqFallback), confirmationBeforeCertification: true }, observed: obs.i5, detail: `re-run (WP4.I5.rerunRule): ${WP4.I5.rerunRule.value}` });
    rec('I5.afterValueEntered', auditOk(events) && sameJson(end, eCert), { expected: { certified: eCert, audit: CR.audit }, observed: obs.i5, detail: 're-run: judged on the certified figures and the contract.manage audit event' });
  } else {
    throw new Error(`087-COM-C: IPC-01 is ${now.status} and the contract value ${contract.originalValueSource}: neither the first run's state nor a re-run's (WP4.I5.rerunRule); a partial earlier run is resolved by hand`);
  }
};

// -- 006-LITE (D3) ---------------------------------------------------------------------------------------------------
const d3Flow = async () => {
  const st = ctx.state['006-LITE'];
  const s = stored006(st);
  const pickKa = (j) => ({ value: j.value, today: j.today, observed: j.observed, verdict: j.verdict, storedAt: j.storedAt ?? null });
  ka('HRC1.stored.006LITE', { ref: 'HR-C1', ...pickKa(s['HRC1.stored.006LITE']), detail: 'stored at the build (retention.unconfigured; WP4ADJ Q4: 006-LITE keeps the plan\'s order after the fix)' });
  rec('D3.stored.ipc', s['D3.stored.ipc'].ok === true, { expected: s['D3.stored.ipc'].expected, observed: s['D3.stored.ipc'].observed });
  const { P } = ctx.deep['006-LITE'];
  const label = outOf(st, 'ipc.create').period;
  const c = await dataOf('pm006', ipcRoute(P, label));
  const A = D006.ipcAfterConfiguration;
  const o = { status: c.status, paymentStatus: c.paymentStatus, retentionStatus: c.retentionStatus, balanceDue: cents(c.balanceDue), gross: cents(c.totalCert), retention: cents(c.totalRet), net: cents(c.netPayable), amountPaid: cents(c.amountPaid) };
  const e = { status: A.endState.value.status, paymentStatus: A.endState.value.paymentStatus, retentionStatus: A.endState.value.retentionStatus, balanceDue: cents(A.endState.value.balanceDue), gross: A.gross.value, retention: A.retention.value, net: A.net.value, amountPaid: A.amountPaid.value };
  rec('D3.live.ipc', sameJson(o, e), { expected: e, observed: o });
  const q = await deepProbe('006-LITE', 'qs006', 'POST', `${ipcRoute(P, label)}/certify`, { comment: `CERT3 WP4 proof ${h.STAMP}` }, 'a QS certify of the paid IPC');
  rec('D3.certifierRole', h.is(q, saidOf(D006.certifierRole)), { expected: saidOf(D006.certifierRole), observed: h.said(q) });
};

// -- confirm-first classification from this run's observations -----------------------------------------------------------
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
  cf('CF.HRC1', { ...split([
    ['K: an unset project default reads as 5', kaState('HRC1.projectDisplay')],
    ['K: the contract\'s first read stores 5', kaState('HRC1.contractFirstRead')],
    ['K: an unconfigured certificate settles at 0', kaState('I1.certifyUnconfigured')],
    ['K: the configured rate never reaches the refused certificate', kaState('I1.afterConfiguration')],
    ['K: a new period ignores the contract rate (L114)', kaState('L114.newPeriodItemRate')],
    ['K2: certification takes the project rate over the contract\'s', kaState('I2.contractRate')],
    ['K: a commitment with no rate takes 5', kaState('C3.noDefaultNoRate')],
  ]), detail: `the stored moments are judged in their own checks (STORED-PRE-FIX after the fix, WP4ADJ Q4); HR-C1 fix ${FIXES['HR-C1'].commit || 'not yet'}` });
  cf('CF.HRC2', { ...split([['052-COM: A130\'s limit carries the A120-only variation', kaState('KA.I3.limits.A130')], ['K: the A130 PATCH to 650 is accepted', kaState('KA.I3.patchA130Qty650')], ['variationLinkNames matches the BOQ item', yes(scan.variationMatchesBoqItem)]]), detail: json({ limits052: obs.i3Limits, limitsK: obs.kI3Limits }) });
  cf('CF.convertAtomic', { ...split([['K: concurrent converts make more than one CO', kaState('KA.E2.concurrent')], ['K: pending rises by more than one CO', kaState('KA.E2.pendingDelta')], ['K: a refusal midway leaves an orphan CO', kaState('KA.E2.midwayOrphans')], ['convertToChangeOrder runs outside a transaction', yes(scan.convertWithoutTransaction)]]), detail: `${json({ concurrent: obs.e2Concurrent, midway: obs.e2Midway })}; fix ${FIXES['CONVERT-ATOMIC'].commit || 'not yet'}` });
  cf('CF.HRC12', { ...split([['two accepted quotes on one line', kaState('KA.HRC12.secondAccept')], ['an event stuck after its CO is archived', kaState('KA.HRC12.archivedCoEvent')], ['the CO drops the lines\' budget line', kaState('KA.HRC12.dropsBudgetLines')]]), detail: json({ two: obs.hrc12Two, arc: obs.hrc12Arc }) });
  cf('CF.HRC3', { ...split([['\'paid\' one-way after a retention release', kaState('KA.I8.afterReleaseStatus')], ['no route back from submitted', kaState('KA.I11.backToDraft')], ['an empty period certifies', kaState('KA.HRC3.emptyPeriod')]]), detail: json({ empty: obs.emptyPeriod, backRoutes: scan.ipcBackToDraftRoute }) });
  const i9 = obs.i9;
  cf('CF.HRC4', { ...split([['052-COM: the statement and the receivables disagree', !i9 ? 'gap' : yes(i9['052-COM'].difference !== 0)], ['087-COM: they disagree by the released retention', !i9 ? 'gap' : yes(i9['087-COM'].difference !== 0)]]), detail: `${json(i9)}; CERT-5 decides, CERT-3 records` });
  cf('CF.CCOparent', { ...split([['a CO approved on a void parent', kaState('KA.CCO.voidParent')], ['a CO approved on a closed parent raises committed', kaState('KA.CCO.closedParent')], ['transitionChangeOrder checks only the CO\'s own status', scan.ccoApprovalChecksParent === null ? 'gap' : yes(!scan.ccoApprovalChecksParent)]]), detail: `${json({ void: obs.ccoVoid, closed: obs.ccoClosed })}; fix ${FIXES['CCO-PARENT'].commit || 'not yet'}` });
  cf('CF.HRC13', { ...split([['no deductive prime CO (a -1,000.00 value refused)', passed('E6.deductiveCo')], ['no route releases subcontractor retention', scan.subRetentionReleaseRoute === null ? 'gap' : yes(scan.subRetentionReleaseRoute.length === 0)], ['the close refused with retention held', passed('C5.closeWithRetentionHeld')]]), detail: 'the owner\'s call (HR-C13)' });
  cf('CF.L108', { ...split([['committed and actual on different budget lines', kaState('KA.C4.sameLine')]]), detail: json(obs.c4) });
  cf('CF.CERT5', { ...split([['the advance never reaches cash flow (L115)', kaState('KA.CASH.CF2.advanceInflow')], ['a system row is deletable (L120)', kaState('KA.CASH.CF3.deleteSystemRow')], ['concurrent rebuilds duplicate rows (L120)', kaState('KA.CASH.CF4.concurrentRebuilds')]]), detail: json({ cf4: obs.cf4, delete: obs.cf3Delete }) });
  const o1 = obs.ovr1;
  cf('CF.OVR1', { ...split([
    ['stored: IPC-09 needed a PM override with nothing claimed on A130', !o1?.stored ? 'gap' : yes(o1.stored.requiresPmOverride === true && o1.stored.currentClaimed === 0)],
    ['live: IPC-09 still needs a PM override', !o1?.live ? 'gap' : yes(o1.live.requiresPmOverride === true)],
    ['the PM without a reason is refused', !o1 || o1.pmWithoutReason === null ? 'gap' : yes(o1.pmWithoutReason === saidOf(WP4.OVR1.pmWithoutReason))],
    ['finance with a reason is refused', !o1 || o1.financeWithReason === null ? 'gap' : yes(o1.financeWithReason === saidOf(WP4.OVR1.financeWithReason))],
  ]), detail: `${json(o1)}; the book's review ${json(WP4.OVR1.review.value)} (WP4.OVR1.review: the end-state figure follows HR-C2)` });
  const dr = obs.drafts1;
  cf('CF.DRAFTS1', { ...split([
    ['both drafts PATCH 200 (each blind to the other)', !dr ? 'gap' : yes(dr.patches.first === WP4.DRAFTS1.patches.value.first && dr.patches.second === WP4.DRAFTS1.patches.value.second)],
    ['the first certifies', !dr ? 'gap' : yes(dr.firstCertify.said === '200' && dr.firstCertify.status === WP4.DRAFTS1.firstCertify.value)],
    ['the second is refused at certification, over earned by 3,000.00', !dr ? 'gap' : yes(dr.secondCertify === saidOf(WP4.DRAFTS1.secondCertify) && dr.overEarned === WP4.DRAFTS1.overEarnedAtSecond.value)],
  ]), detail: `${json(dr)}; EXPECTED BEHAVIOUR proposed (the certify gate is the control, P3)` });
  cf('CF.C1TOL', { ...split([['a payment one cent over the net is accepted', kaState('KA.P4.payOverNet')]]), detail: json(obs.c1tol) });
};

// -- the run ----------------------------------------------------------------------------------------------------------
const main = async () => {
  console.log(`wp4-commercial-proof: ${ACTIVE.length} of ${EXPECTED_CHECKS} checks active${ONLY ? ` (--only=${[...ONLY].join(',')})` : ''}${SKIP ? ` (--skip=${[...SKIP].join(',')})` : ''}${PROJECT_FILTER ? ` (--project=${PROJECT_FILTER})` : ''}; sections ${[...selectedSections].join(' ')}; deep projects ${NEED_DEEP.join(', ') || 'none'}; K ${NEED_K ? 'yes' : 'no'}; K2 ${NEED_K2 ? 'yes' : 'no'}; fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}; in process\n`);
  if (ACTIVE.length !== CHECKS.length) console.log(`not exercised in this run (filtered out): ${CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id).join(', ')}\n`);
  await setup();
  if (NEED_K) {
    // K's fixture in its own section: when it cannot be set up the run is a setup error, and the other sections still run.
    await h.section('K: the fixture (K0-K4)', async () => { await kSetup(); ctx.kReady = true; });
    if (ctx.kReady) {
      await h.section('K: K5-K12 HR-C1, L114 and the paid certificate', kHrc1);
      await h.section('K: K13-K14 the variation and the approved-CO lock', kVariation);
      await h.section('K: K15 prime change orders', kPrimeCos);
      await h.section('K: K16-K19 change events', kEvents);
      await h.section('K: K20-K21 commitments', kCommitments);
      await h.section('K: K22-K24 pay applications and closeout', kPayApps);
      await h.section('K: K25-K26 two drafts and the empty period', kDrafts);
      await h.section('K: K27 cash flow', kCash);
    }
    if (ctx.k) await h.section('K: the end (archive)', kEnd);
  } else {
    rec('S.K.create', true, { detail: 'not needed (no selected check runs on K)' });
    rec('S.K.fixture', true, { detail: 'not needed (no selected check runs on K)' });
    rec('S.K.archived', true, { detail: 'not needed (no selected check runs on K)' });
  }
  if (NEED_K2) await h.section('K2: I2 on the second throwaway', k2Flow);
  else rec('S.K2', true, { detail: 'not needed (no selected check runs on K2)' });
  // D2 reads 087-COM's cash flow before COM's rebuild.
  if (on('D2')) await h.section('052-COM and the mixed 087-COM halves: stored moments, reads and refusals', d2Flow);
  if (on('COM')) await h.section('087-COM: stored moments, reads and refusals, the one rebuild', comFlow);
  if (on('COMB')) await h.section('087-COM-B: C3 (read only)', combFlow);
  if (on('COMC')) await h.section('087-COM-C: I5 (one-shot)', comcFlow);
  if (on('D3')) await h.section('006-LITE: D3', d3Flow);
  if (on('CF')) await h.section('confirm-first classification', async () => confirmFirstFlow());
};

/** The per-check records, the known answers, the confirm-first classifications, the decided-rule table and the tally, written in cleanup (always). */
const recordObservations = () => {
  for (const [id, r] of Object.entries(records)) r.registered = ACTIVE_IDS.has(id);
  for (const [id, k] of Object.entries(knownAnswers)) k.registered = ACTIVE_IDS.has(id);
  h.observe('checks', records);
  h.observe('knownAnswers', knownAnswers);
  h.observe('confirmFirst', confirmFirst);
  h.observe('decidedRules', Object.fromEntries(Object.entries(DECIDED_RED).map(([id, d]) => [id, { ...d, verdict: records[id]?.verdict ?? 'not run', expectedAtHead: d.rule === 'HR-C1' ? 'FAIL (RED until the HR-C1 fix lands; STORED-PRE-FIX for a stored moment once FIXES[\'HR-C1\'] is set)' : 'judged on the value since the fix landed' }])));
  h.observe('fixes', { ...FIXES, git: obs.fixesGit ?? null, contract: CONTRACT });
  h.observe('runObservations', obs);
  h.observe('restorations', ctx.restorations);
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
  console.log(`\ntally: ${tally.pass} pass, ${tally.fail} fail of ${tally.activeRecorded} recorded (${tally.active} active); decided-rule RED: ${tally.decidedRedFailing.join(', ') || 'none'}; other failures: ${tally.otherFailing.join(', ') || 'none'}; known answers: ${tally.knownAnswers.value} value, ${tally.knownAnswers.blocked} BLOCKED, ${tally.knownAnswers.storedPreFix} STORED-PRE-FIX, ${tally.knownAnswers.fail} fail (${tally.knownAnswers.wrong} wrong)`);
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
      const prefixes = [KB.project.name, K2B.project.name].map((n) => String(n).replace('<stamp>', '').trim());
      const found = [];
      let said = null;
      for (const prefix of prefixes) {
        const page = await get('pm', `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(prefix)}`);
        said = h.said(page);
        found.push(...listOf(page.body?.data).filter((p) => String(p.name || '').startsWith(prefix)));
      }
      const live = found.filter((p) => !p.archivedAt);
      notes.push(`throwaway check (GET /projects as 087 PM, ${said}): ${found.length} '${prefixes.join("' / '")}' projects, ${live.length} live${live.length ? ` (${live.map((p) => `${p.name} ${p.id}`).join(', ')})` : ''}`);
      h.observe('throwawayCheck', { total: found.length, live: live.map((p) => ({ id: p.id, name: p.name })) });
    } catch (error) {
      notes.push(`throwaway check failed: ${error.message}`);
    }
  }
  notes.push(`deep projects: ${ctx.deepWrites.length ? `UNEXPECTED WRITES: ${ctx.deepWrites.join('; ')}` : 'nothing written but the named exceptions (087-COM-C\'s one-shot I5, 087-COM\'s idempotent rebuild); every refusal probe was refused'}`);
  if (ctx.restorations.length) notes.push(`restorations: ${ctx.restorations.join('; ')}`);
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

module.exports = { __wp4: { kaStatus, judge, storedHrc1Com, storedCom087, storedCom052, stored006, storedComC, storedComB, staticScan, CHECKS, EXPECTED_CHECKS, SECTION_PROJECTS, CATCHERS, COLLATERAL, DECIDED_RED, CONTRACT, FIXES, RULES } };

h.run({ main, cleanup });
