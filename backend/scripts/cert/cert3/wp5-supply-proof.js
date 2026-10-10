'use strict';

/**
 * WP-5 (Supply chain: bids and award, orders and receipts, inventory, direct costs, the three-way match) primary proving
 * run: the known-answer run of plan section 4 WP-5 on the cert3d population (docs/certification/OCTAPM_CERT3_PLAN.md
 * section 4 WP-5 :734-793: rules :736-744, evidence :746-775, mutations :777, existing evidence :779, confirm first
 * :781-793; section 6.2 WP-5 guards :1149; section 5 HR-C5..HR-C9 :1073-1077; the defect-fix list :1107-1121 (atomic
 * award confirmation, one order per award, award orders keep their coding :1110; the receivable PO list :1112); section
 * 3.2 087-COM :427, 087-COM-B :428, D2 052-COM :444; plan lines as numbered at 48db9e9). Preparation
 * C:\Temp\octapm-cert\scratch\wp5\WP5-PREP.md (+ wp5-checks-draft.json, wp5-mutations-draft.json, derive-j.json); the
 * BINDING integration-owner adjudication C:\Temp\octapm-cert\scratch\wp4\PREP4-ADJUDICATION.md section D (Q1-Q12,
 * cited WP5ADJ); moment map build/MOMENT-MAP.md (087-COM rows 140-152, 155); answer book answers/commercial.js (WP5.*,
 * stage4:167 / stage4:170, deep.087-COM / -B, deep.052-COM's O2 mirror) AFTER the WP-5 book patch
 * (C:\Temp\octapm-cert\scratch\wp5\book\book-insert.js: BOOK-G3 first, then G1-G23; the proof refuses to load without it).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp5-supply-proof.js [--only=JO,COM] [--project=J] [--skip=D2]
 *
 * Filters. Sections split by project, so that a partial population and a mutant both stay where they belong:
 *   S     setup (always runs, for the projects and state files the selected checks need)
 *   JO    the throwaway J: J0-J8, purchase orders, receipts, the closes, the activity delete (O on J)
 *   JN    J9, inventory on J (N on J)          JR    J10, bids and the award on J (R on J)
 *   JD    J11, direct costs and the match on J (D on J)
 *   COM   087-COM: the stored build moments, the live reads and the refusals no WP-5 mutant can turn into a write
 *   COMB  087-COM-B with 087-COM: the PO-00001 collision and the keeper's reference scan
 *   D2    052-COM: PO-O2 stored, read, and its two close refusals (WP5ADJ Q2)
 *   CF    the confirm-first classifications
 * --only=<sections> keeps those sections, --project=<J|087-COM|087-COM-B|052-COM|static> the sections that touch that
 * project, --skip=<sections> drops sections. Selecting CF selects every section CF classifies from (JO JN JR JD COM COMB);
 * skipping one of those needs --skip=CF too. A filtered-out check is neither registered nor recorded. The J
 * choreography J0-J8 runs whole whenever one selected check runs on J (its steps depend on each other, as WP-2's P,
 * WP-3's V and WP-4's K); J9, J10 and J11 run when a selected check (or CF) reads them. The primary run, the final run and
 * every mutation run take no flags (mutate-multi.js spawns the proof without arguments).
 *   Debug run on the partial population (087-COM, 087-COM-B, 087-COM-C built; 052-COM not):  --skip=D2
 *   (registers 138 checks + G.5xx; 052-COM's four O2 checks are the only ones that read 052-COM).
 *
 * In process (CERT_INPROCESS=1, through the lock runner only) on the certification database. Every expected figure is
 * an answer-book key (A10); every figure the J choreography types is read from a book leaf (WP5.J.*, WP5.O2, WP5.N*,
 * stage4:170, ...) or is a fixture input named in FIXTURE below (dates, budget amounts, the round count). Deep projects
 * are resolved by their exact names through the API as each company's PM (exactly one live project each); build state
 * files are read only for moment answers and ids (C:\Temp\octapm-cert\state\cert3\<code>.json, steps[].out, steps[].blocked
 * and records[].said): no stored money figure is read.
 *
 * WHERE EACH CHECK RUNS (the CHECKS table carries it per id):
 *   J          the throwaway project of company 087 this run creates (WP5.J.project: explicit defaultRetentionRate 10, so
 *              WP-5 never depends on HR-C1; every award confirm sends retentionRate 0) and archives (WP5ADJ Q1;
 *              WP5.J.choreography J0-J11): every writing check and every section 6.2 catcher.
 *   087-COM    live reads, and refusals sent only where HEAD refuses before any write and no WP-5 mutant turns the refusal
 *              into a write: the cancel of the awarded package (cancelPackage :415) and PO-C's two close refusals (they
 *              precede the transition; under the HEAD-only complement M-PCLg they reach assertTransition, which refuses a
 *              partial order). stored: every WP-5 build moment.
 *   087-COM-B  read only (PO-00001).   052-COM  PO-O2 read and its two close refusals (WP5ADJ Q2).   static  source scans.
 *
 * Mutation safety (section 6.2 WP-5; mutate-multi.js runs the proof without flags, so every section runs under every
 * mutant): the catchers of M-PCL0, M-AWD0, M-OVER, M-AVL, M-DCL, M-DCK (and post-fix M-PCL1, M-AWD1) run on J; the
 * close-guard complement M-PCLg (HEAD only) is also caught on 087-COM PO-C and 052-COM PO-O2, where it writes nothing
 * at HEAD. Book moments moved to J for this reason (WP5ADJ Q1; the moment map's rows 144, 148, 150 and 151 record the
 * deviation when the proof lands): the O2 closes and the receipt after a close (row 144), N1's issue 41 / 40 / release 51
 * (row 148), N6's usage (row 150), the D5 approvals and the over-invoicing ledger (row 151).
 *
 * KNOWN ANSWERS (KA.*): judged value (pass), today (BLOCKED / known, with the ref, counted separately, never exit 2,
 * while the rule is undecided) or wrong (fail). No WP-5 rule is decided (HR-C5, HR-C7, HR-C8, HR-C9 wait for the owner;
 * HR-C6 with L35 / L36 / X-FINANCE-1 is CERT-5's). A decided rule's today fails (the WP-1 ka() rule): AWARD-ATOMIC,
 * AWARD-ONE-ORDER, AWARD-CODING and RCV-LIST become decided when their section 5 defect fix lands (FIXES below); a build
 * moment observed before that fix commit reads STORED-PRE-FIX (KA.R4.lineCoding.087, KA.D4.087 are live reads of build
 * records). A probe whose own setup fails is a setup error (exit 1), never 'wrong' (R-SET): each such probe runs in its
 * own section. Racy known answers are one shot, never retried (PREP4-ADJUDICATION B5): a lucky single success on
 * KA.R2.concurrentConfirms reads value and is recorded. The direct-cost concurrency catcher D2.J.concurrentApprove runs
 * FIXTURE.d2Rounds rounds, each on a fresh pending J-DC3, green only if every round is green, the same code at baseline
 * and under M-DCL (WP5ADJ Q8).
 * CONFIRM-FIRST (CF.*): plan :781-793 and the register rows WP5-SVC-1, WP5-AWD-1, WP0-INV-1, classified from this run's
 * observations as CONFIRMED / PARTIAL / REJECTED / TEST GAP and reported (no rule decided); a landed fix turns its CF
 * into a defect check that must read REJECTED.
 *
 * Expected at HEAD on cert3d (after the WP-5 book patch with BOOK-G3, no fix commit set): 142 checks + G.5xx; 0 FAIL,
 * exit 0, PASS (harness provisional classification: none, no defect checks). Known answers BLOCKED (27):
 * KA.O2.stored.closeShort, KA.O2.stored.closeReceived, KA.O3.cancelAfterDelivery, KA.O2.forceWithReason,
 * KA.O2.receiveAfterClose (not sent: J-C stays partial), KA.O2.fullyReceivedClose (HR-C8); KA.R4.lineCoding.087,
 * KA.R4.lineCoding.J (AWARD-CODING); KA.R2.concurrentConfirms (AWARD-ATOMIC; racy, a lucky single success reads value, a
 * pass); KA.R3.secondOrder (AWARD-ONE-ORDER); KA.O5.receivableList.087 / .J (RCV-LIST); KA.O6.refCollision (HR-C9);
 * KA.N2.returnNeverIssued / stockAfterRefusal / projectCostAfterRefusal / return30After10 (L36); KA.N3.credit / activity /
 * stock (X-FINANCE-1); KA.N6.issuedQty / usage50 (HR-C7); KA.D4.087, KA.D4.J.invoiceBeforeReceipt (L35);
 * KA.D5.priceVarianceApproval, KA.D5.overInvoicedLedger (BOOK-G3: today 0.00, WP5-SVC-1), KA.D6.invoiceSideVerdict (HR-C5).
 * CF reported (16, CONFIRMED expected): CF.awardAtomic, CF.awardSecondOrder, CF.awardCoding, CF.HRC8,
 * CF.receivableList, CF.HRC9, CF.HRC7, CF.HRC6, CF.L199issue, CF.HRC5, CF.L107, CF.L119, CF.DFUN1delete, CF.SVC1,
 * CF.AWD1, CF.INV1. Green: 6 setup + 89 HARD + 4 STORED, and G.5xx.
 * Without BOOK-G3 the proof refuses to load (the guard below); applied by hand otherwise, KA.D5.overInvoicedLedger would
 * be the one FAIL (0.00 matches neither 600.00 nor the old today 1,200.00).
 * After HR-C8 is decided as recommended (:1076): the four live HR-C8 KAs turn value checks (receiveAfterClose is then
 * sent), the two stored ones read STORED-PRE-FIX until the builder changes and the exit rebuild, and M-PCL1 joins E6.
 * After a confirmed-P1 defect fix or the commit implementing an owner rule (FIXES set, with its CONTRACT fields): its KAs
 * turn value checks (DECIDED_RED), its CF must read REJECTED.
 *
 * Adjudication applied (WP5ADJ): Q1 every writing check and every catcher on J (moment-map deviations rows 144, 148,
 * 150, 151); Q2 052-COM a read and two close refusals, forceWithReason / receiveAfterClose / fullyReceivedClose judged on
 * J; Q3 severities are the journal's, after this run; Q4 the 27 known answers BLOCKED; Q6 the two stamped directory
 * vendors are company-level residue in 087; Q7 the E6 entries (CATCHERS); Q8 N rounds for the direct-cost probe, the
 * award race one shot; Q10 R5.expired keeps its 30 s lapse; Q12 BOOK-G3 applied first.
 * EXPECTED_CHECKS: WP5-PREP's 142 (wp5-checks-draft.json), fixed; G.5xx on top.
 *
 * Exit 0 pass / 2 a check failed / 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp5-supply-proof.json (every check with its plan reference, answer-book key,
 * expected, observed and verdict in observations.checks; the KA verdicts in observations.knownAnswers; the CF
 * classifications in observations.confirmFirst; the fix state in observations.fixes; all written in cleanup, so a setup
 * error still carries what was observed). Portal tokens are kept in memory only and never recorded.
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

const { WP5 } = COMMERCIAL;
const DEEP_BOOK = COMMERCIAL.deep;
const D087 = DEEP_BOOK['087-COM'];
const D087B = DEEP_BOOK['087-COM-B'];
const D052 = DEEP_BOOK['052-COM'];
const STAGE4_167 = COMMERCIAL['stage4:167'];
const STAGE4_170 = COMMERCIAL['stage4:170'];

// -- the WP-5 book patch must be applied (BOOK-G3 first, then G1-G23; WP5ADJ Q1-Q12) -------------------------------------
const leafAt = (key) => key.split('.').reduce((node, k) => (node && typeof node === 'object' ? node[k] : undefined), COMMERCIAL);
const WP5_PATCH_LEAVES = [
  'WP5.R2.confirmAgain', 'WP5.R2.awardCommitment', 'WP5.R5.overLimit', 'WP5.R5.overLimitDetails', 'WP5.R5.overLimitOverride', 'WP5.R5.expired',
  'WP5.R5.expiredDetails', 'WP5.O5.on087', 'WP5.O5.onJ', 'WP5.closeBeforeDelivery.issuedForceClose', 'WP5.closeBeforeDelivery.ackForceClose',
  'WP5.closeBeforeDelivery.receiveAfterClose', 'WP5.CF.L199issue', 'WP5.CF.L107', 'WP5.CF.L119', 'WP5.CF.DFUN1delete', 'WP5.CF.INV1',
  'WP5.J.project', 'WP5.J.team', 'WP5.J.fixture', 'WP5.J.vendors', 'WP5.J.orders', 'WP5.J.bids', 'WP5.J.awardOrder', 'WP5.J.stock',
  'WP5.J.directCosts', 'WP5.J.choreography', 'deep.087-COM.o2CementEnd',
];
{
  const missing = WP5_PATCH_LEAVES.filter((key) => { const leaf = leafAt(key); return !leaf || typeof leaf !== 'object' || !('value' in leaf); });
  if (missing.length) throw new Error(`answers/commercial.js carries no WP-5 leaf ${missing.join(', ')}: apply the WP-5 book patch (C:/Temp/octapm-cert/scratch/wp5/book/book-insert.js) first`);
  const g3 = WP5.D5.overInvoicedLedger;
  if (g3.today !== 0 || g3.ref !== 'HR-C5' || g3.value !== 60000) {
    throw new Error('answers/commercial.js carries the pre-BOOK-G3 WP5.D5.overInvoicedLedger (today must be 0.00 under ref HR-C5, value 600.00): apply the WP-5 book patch first (WP5ADJ Q12)');
  }
  if (WP5.R2.concurrentConfirms.value?.confirms !== 2 || WP5.O2.forceWithReason.ref !== 'HR-C8' || !String(WP5.mutations.awardLock.value[0]).startsWith('R2.J.confirmAgain')
    || WP5.R4.lineCoding.ref !== 'AWARD-CODING' || WP5.O6.refCollision.ref !== 'HR-C9' || WP5.N6.issuedQty.ref !== 'HR-C7') {
    throw new Error('answers/commercial.js carries the pre-WP-5 values of WP5.R2.concurrentConfirms / O2.forceWithReason / mutations.awardLock / R4.lineCoding / O6.refCollision / N6.issuedQty (G4, G12, G18, G19, refs): apply the WP-5 book patch first');
  }
}

const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const REGISTER = 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md';
const STATE_DIR = 'C:/Temp/octapm-cert/state/cert3';
const REPO = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(__dirname, '..', '..', '..', 'src');

const DEEP = {
  '087-COM': { company: '087', name: 'CERT3 Commercial (087-COM)' },
  '087-COM-B': { company: '087', name: 'CERT3 Commercial B (087-COM-B)' },
  '052-COM': { company: '052', name: 'CERT3 Commercial (052-COM)' },
};

// -- CLI ------------------------------------------------------------------------------------------------------------
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const setOf = (text) => (text ? new Set(text.split(',').map((s) => s.trim()).filter(Boolean)) : null);
const ONLY = setOf(argOf('only'));
const SKIP = setOf(argOf('skip'));
const PROJECT_FILTER = argOf('project');

// -- the fixed list of checks: id, section, plan reference, answer-book key, where it runs ---------------------------
// where: 'J' | '087-COM' | '087-COM-B' | '052-COM' | 'stored:<code>' | 'static' | 'setup', or a comma list for a check
// that reads several. The section is the 6th argument (the sections split by project, see the header); the setup checks
// (S.*) carry no answer-book key (WP-1 L5). Book keys with a dot inside a member are written as the book writes them
// (WP5.R1['bid.gulf.total']).
// <CHECKS>
const L = (...lines) => `${PLAN_DOC}:${lines.join(',')}`;
const C = (id, planRef, bookKey, where, description, section) => ({ id, section, planRef, bookKey, where, description });
const CHECKS = [
  C('S.book', L('734-793'), null, 'setup', 'the commercial answer book loads with the WP-5 patch (BOOK-G3 first, G1-G23; the load guard above): its figures() rows carry ref, WP5.D5.overInvoicedLedger.today is 0.00 under HR-C5, every key this proof reads resolves', 'S'),
  C('S.state', L(427, 428, 444), null, 'setup', 'the build state files the selected checks read are present with their WP-5 steps done, or BLOCKED only with their moment-map ref (087-COM po.C.close-short and po.A.close-received: HR-C8, each with its observed answer); 087-COM\'s directory names the supplier company J uses; a fix commit, when set, is the one git dates', 'S'),
  C('S.projects', L(427, 428, 444), null, 'setup', 'the deep projects the selected checks read resolve by exact name through the API, exactly one live each, matching the state files; every persona signs in to its company', 'S'),
  C('S.J.create', L(734), null, 'J', 'J0: J created by the 087 PM (WP5.J.project: explicit defaultRetentionRate 10, EGP, five_day); team planner, qs, cost_controller, procurement, site_engineer, finance (WP5.J.team), the warehouse keeper not on it', 'S'),
  C('S.J.fixture', L(734), null, 'J', 'J1-J2: seven activities with the site engineer, cost codes 02-100 / 09-100 / 05-100 with budget lines 02-100/material and 09-100/indirect only, the BOQ row J-B003 60 t @ 1,200.00, the supplier J-SUP, warehouses J-SITE (J-B01, J-B02, J-Q) and J-YARD (J-Y1), the 13 items, the directory vendors J-QUAL (approved to 2028-01-01, limit 250,000.00) and J-EXP (approved, its insurance lapsing 30 s later) (WP5.J.fixture, WP5.J.vendors): each creation asserted', 'S'),
  C('S.J.archived', L(734), null, 'J', 'end: J archived by the PM (archivedAt read back)', 'S'),

  C('R1.stored.bids', L(748), 'WP5.R1.unqualifiedAward', 'stored:087-COM', 'stored step bids done (the build asserted the totals 69,000.00 / 71,400.00 / 74,400.00 = WP5.R1 bid.*.total, the late bid \'409 BID_PAST_DUE\' = WP5.R1.submitAfterDue and Coastal withdrawn); record bid.confirm.no-override said \'409 PREQUAL_AWARD_BLOCKED\' (WP5.R1.unqualifiedAward); finding WP5-AWD-1 kept', 'COM'),
  C('R1.live.package', L(748), 'WP5.R1.packageStates', '087-COM', 'GET bids/<package>: awarded, awardedBidId (Emirates) and awardedCommitmentId the stored ones; its bids: Emirates awarded, Gulf and Northern unsuccessful, Coastal withdrawn, no late bid submitted; three bidders priced (deep.087-COM.bidders)', 'COM'),
  C('R1.live.ranking', L(748), 'WP5.R1.ranking', '087-COM', 'GET leveling: Gulf rank 1 (69,000.00), Northern rank 2 (71,400.00), Emirates rank 3 (74,400.00); estimateTotal 72,000.00 (WP5.R1.estimate)', 'COM'),
  C('R1.live.gap', L(748), 'WP5.R1.awardedNotLowestGap', '087-COM', 'the awarded total less the lowest total = 5,400.00', 'COM'),
  C('R1.live.commitment', L(748, 749), 'WP5.R2.awardCommitment', '087-COM', 'the award\'s commitment: draft, purchase_order, original 74,400.00, retentionRate 0, vendor Emirates, one SOV line carrying B-003, 02-100, 02-100/material and A130, 60 t @ 1,240.00 (BOOK-G2)', 'COM'),
  C('R1.cancelAwarded', L(748), 'WP5.R1.cancelAwarded', '087-COM', 'DELETE bids/<package> on 087-COM\'s awarded package: \'409 BID_PACKAGE_LOCKED\', still awarded (cancelPackage :415; no WP-5 mutant touches it)', 'COM'),
  C('R4.live.awardPoValue', L(751), 'WP5.R4.awardPoValue', '087-COM', 'PO-AWARD: value 74,400.00, one line 60 @ 1,240.00, supplier Emirates, raised from the procurement package (packageId)', 'COM'),
  C('KA.R4.lineCoding.087', L(751, 784, 1110), 'WP5.R4.lineCoding', '087-COM', 'PO-AWARD\'s line: value costCodeId / budgetLineId / boqItemId the bid line\'s 02-100, 02-100/material and B-003 beside A130; today activityId only - AWARD-CODING (a build record: STORED-PRE-FIX once the fix is set)', 'COM'),
  C('R1.J.publishPastDue', L(748), 'WP5.R1.publishPastDue', 'J', 'J10, J-BP3 (a draft created with a past dueAt, one J-B003 line, J-EXP invited on a prequalOverrideReason): publish \'400 BID_DUE_DATE_REQUIRED\', still draft', 'JR'),
  C('R1.J.inviteOnDraft', L(748), 'WP5.R1.inviteOnDraft', 'J', 'J10, J-BP3 draft: the RESEND of J-EXP\'s invitation \'409 BID_PACKAGE_NOT_OPEN\' (BOOK-G22: inviting on a draft is allowed)', 'JR'),
  C('R1.J.states', L(748), 'WP5.R1.packageStates', 'J', 'J10, J-BP1 read back draft -> open -> closed -> awarded, each state read after its step; J-BP3 cancelled from closed', 'JR'),
  C('R1.J.withdrawResubmit', L(748), 'WP5.R1.withdrawResubmit', 'J', 'J10, J-WD on the portal: submitted -> withdrawn -> submitted again, total 255,000.00 (WP5.J.bids)', 'JR'),
  C('R1.J.confirmNoBid', L(748), 'WP5.R1.confirmNoBid', 'J', 'J10, J-BP3 closed, no soft award, no bidId: confirm \'400 BID_NOT_FOUND\', no commitment created', 'JR'),
  C('R5.J.overLimit', L(752), 'WP5.R5.overLimit', 'J', 'J10, J-BP1 soft-awarded to J-QUAL (252,000.00 > limit 250,000.00): confirm without a reason \'409 PREQUAL_AWARD_BLOCKED\', details status approved, singleAwardLimit 250,000.00, amount 252,000.00 (WP5.R5.overLimitDetails); no commitment', 'JR'),
  C('R5.J.overLimitOverride', L(752), 'WP5.R5.overLimitOverride', 'J', 'J10, the same confirm with a prequalOverrideReason: 201, the commitment draft 252,000.00, J-BP1 awarded, the reason on the package\'s award audit event', 'JR'),
  C('R5.J.expired', L(752), 'WP5.R5.expired', 'J', 'J10, J-BP3 soft-awarded to J-EXP, its insurance cover lapsed after the approval: confirm \'409 PREQUAL_AWARD_BLOCKED\', details status expired (WP5.R5.expiredDetails; assumption A-3; the 30 s lapse kept, WP5ADJ Q10)', 'JR'),
  C('R2.J.confirmAgain', L(749, 1149), 'WP5.R2.confirmAgain', 'J', 'J10, J-BP1 awarded: the same confirm again \'409 BID_PACKAGE_LOCKED\'; one commitment from J-BP1 (catcher of M-AWD0, writes only on J)', 'JR'),
  C('KA.R2.concurrentConfirms', L(749, 782, 1110), 'WP5.R2.concurrentConfirms', 'J', 'J10, J-BP2 soft-awarded to J-QUAL: two confirms at once (in process): value one 201, one \'409 BID_PACKAGE_LOCKED\', one commitment; today two 201 and two draft commitments - AWARD-ATOMIC (racy: one shot, never retried)', 'JR'),
  C('R3.J.firstOrder', L(750), 'WP5.J.awardOrder', 'J', 'J10, procurement orders from J-PP1: 201, value 252,000.00, one line 60 @ 4,200.00 on J-A130, supplier J-QUAL, status planned (WP5.J.awardOrder)', 'JR'),
  C('KA.R3.secondOrder', L(750, 783, 1110), 'WP5.R3.secondOrder', 'J', 'J10, the same order again: value 409 (the code is the fix\'s); today 201 and two orders on J-PP1 - AWARD-ONE-ORDER', 'JR'),
  C('KA.R4.lineCoding.J', L(751, 784, 1110), 'WP5.R4.lineCoding', 'J', 'J10, J\'s award order line: value costCodeId / budgetLineId / boqItemId the J-BP1 line\'s 02-100, 02-100/material and J-B003 beside J-A130; today activityId only - AWARD-CODING', 'JR'),

  C('O2.stored.087', L(755, 757), 'WP5.O2.statusAfterPartial', 'stored:087-COM', 'stored step receipts done (the build asserted PO-C 100 / 60 partial, PO-O4 10 accepted + 2 rejected, blocks on hand 10): states PO-A and PO-B received, PO-C partial (WP5.O2.statusAfterPartial), PO-O4 partial, PO-SVC received', 'COM'),
  C('O2.stored.052', L(444, 755), 'deep.052-COM.O2.statusAfterPartial', 'stored:052-COM', 'stored step po.O2 done: PO-O2 partial (deep.052-COM.O2.statusAfterPartial), its receipt said 201', 'D2'),
  C('KA.O2.stored.closeShort', L(755, 785, 1076), 'WP5.O2.forceWithReason', 'stored:087-COM', 'stored step po.C.close-short: value done with PO-C closed; today BLOCKED HR-C8 with the observed \'409 PO_TRANSITION_INVALID\' (the leaf\'s today) - HR-C8 (STORED-PRE-FIX after the fix)', 'COM'),
  C('KA.O2.stored.closeReceived', L(755, 785, 1076), 'WP5.O2.fullyReceivedClose', 'stored:087-COM', 'stored step po.A.close-received: value done with PO-A closed; today BLOCKED HR-C8 with the observed \'409 PO_TRANSITION_INVALID\' - HR-C8', 'COM'),
  C('O.live.087.statuses', L(427, 755), 'deep.087-COM.poStatuses', '087-COM', 'the register now: PO-00001 acknowledged with nothing received, PO-X cancelled, PO-AWARD issued from the award, PO-C partial and PO-A received while their closes are BLOCKED HR-C8 (deep.087-COM.poStatuses: the state before the arrow while the stored close step is BLOCKED, after it once done)', 'COM'),
  C('O6.collision.live', L(428, 759), 'deep.087-COM-B.poRefCollision', '087-COM,087-COM-B', 'both first orders read PO-00001 live (087-COM PO-ACK acknowledged, 087-COM-B PO-1 issued)', 'COMB'),
  C('O2.live.087', L(755), 'WP5.O2.statusAfterPartial', '087-COM', 'PO-C: status partial, warehouseStatus partial, one line 100 ordered / 60 received (WP5.O2.ordered / received), value 1,000.00 (WP5.O2.order1000)', 'COM'),
  C('O2.live.052', L(444, 755), 'deep.052-COM.O2.statusAfterPartial', '052-COM', 'PO-O2: the same (deep.052-COM.O2.*), in USD', 'D2'),
  C('O2.closeOutstanding.087', L(755, 1149), 'WP5.O2.closeOutstanding', '087-COM', 'close PO-C, no force: \'409 PO_CLOSE_OUTSTANDING\', details.lines [1]; still partial (refused before the transition; catcher of M-PCLg, which writes nothing here at HEAD)', 'COM'),
  C('O2.closeOutstanding.052', L(444, 755, 1149), 'deep.052-COM.O2.closeOutstanding', '052-COM', 'the same on PO-O2', 'D2'),
  C('O2.forceNoReason.087', L(755, 1149), 'WP5.O2.forceNoReason', '087-COM', 'PO-C, force without a reason: \'400 PO_CLOSE_REASON_REQUIRED\'; still partial (catcher of M-PCLgb)', 'COM'),
  C('O2.forceNoReason.052', L(444, 755, 1149), 'deep.052-COM.O2.forceNoReason', '052-COM', 'the same on PO-O2', 'D2'),
  C('KA.O5.receivableList.087', L(758, 786, 1112), 'WP5.O5.on087', '087-COM', 'GET /inventory/purchase-orders?projectId=087-COM&scope=receivable: value ACK (PO-00001), C, O4, SVC2, AWARD; today the acknowledged PO-00001 missing (BOOK-G9: 087-COM holds no draft) - RCV-LIST', 'COM'),
  C('KA.O6.refCollision', L(759, 787, 1077), 'WP5.O6.refCollision', '087-COM,087-COM-B', 'GET /inventory/purchase-orders/PO-00001 as the warehouse keeper: value 409 (ambiguous, or projectId required; the code is the decision\'s); today 200 with one arbitrary PO-00001 of the company (which one recorded) - HR-C9', 'COMB'),
  C('O1.J.submitNoSupplier', L(754), 'WP5.O1.submitNoSupplier', 'J', 'J5, J-NS (raised with no supplier): submit \'400 PO_SUPPLIER_REQUIRED\'', 'JO'),
  C('O1.J.submitNoRequiredBy', L(754), 'WP5.O1.submitNoRequiredBy', 'J', 'J5, J-NR (raised with no requiredBy): submit \'400 PO_REQUIRED_DATE\'', 'JO'),
  C('O1.J.submitNoLines', L(754, 793), 'WP5.O1.submitNoLines', 'J', 'J8, J-DEL1 after its only activity J-A-DEL is deleted (D-FUN-1, the only live path to an empty order; BOOK-G6): submit \'400 PO_NO_LINES\'', 'JO'),
  C('O1.J.rejectNoReason', L(754), 'WP5.O1.rejectNoReason', 'J', 'J5, the PM rejects the pending J-PEND without a reason: \'400 PO_REJECT_REASON_REQUIRED\'', 'JO'),
  C('O1.J.issuePending', L(754), 'WP5.O1.issuePending', 'J', 'J5, procurement issues the pending J-PEND: \'409 PO_TRANSITION_INVALID\'', 'JO'),
  C('O1.J.patchIssued', L(754), 'WP5.O1.patchIssued', 'J', 'J5, PATCH the issued PO-A\' {notes}: \'409 PO_LOCKED\'', 'JO'),
  C('O2.J.partial', L(755), 'WP5.O2.statusAfterPartial', 'J', 'J6, J-C 100 @ 10.00 (1,000.00 = WP5.O2.order1000), 60 received: status partial, warehouseStatus partial, line 100 / 60; J-CEM2 on hand 60', 'JO'),
  C('O4.J.overOrder', L(757, 1149), 'WP5.O4.overOrder', 'J', 'J6, J-C: 41 against 40 outstanding \'409 RECEIPT_OVER_ORDER\'; the line still 60, J-CEM2 still 60 (catcher of M-OVER, writes only on J)', 'JO'),
  C('KA.O3.cancelAfterDelivery', L(756, 785, 1076), 'WP5.O3.cancelAfterDelivery', 'J', 'J7, cancel J-C with a reason: value \'409 PO_CANCEL_AFTER_DELIVERY\'; today \'409 PO_TRANSITION_INVALID\', J-C still partial - HR-C8', 'JO'),
  C('O2.J.closeOutstanding', L(755, 1149), 'WP5.O2.closeOutstanding', 'J', 'J7, close J-C, no force: \'409 PO_CLOSE_OUTSTANDING\', details.lines [1] (catcher of M-PCLg)', 'JO'),
  C('O2.J.forceNoReason', L(755, 1149), 'WP5.O2.forceNoReason', 'J', 'J7, J-C force without a reason: \'400 PO_CLOSE_REASON_REQUIRED\' (catcher of M-PCLgb)', 'JO'),
  C('KA.O2.forceWithReason', L(755, 785, 1076), 'WP5.O2.forceWithReason', 'J', 'J7, J-C force with a reason: value 200 closed; today \'409 PO_TRANSITION_INVALID\', J-C still partial - HR-C8 (catcher of M-PCL1 after the fix)', 'JO'),
  C('KA.O2.receiveAfterClose', L(755, 785, 1076), 'WP5.O2.receiveAfterClose', 'J', 'J7, sent only when J-C reads closed: a receipt of 40 \'409 PO_NOT_ISSUED\'; at HEAD not sent (J-C stays partial): BLOCKED with the leaf\'s today - HR-C8', 'JO'),
  C('KA.O2.fullyReceivedClose', L(755, 785, 1076), 'WP5.O2.fullyReceivedClose', 'J', 'J7, PO-A\' (received in full) closed without force: value 200 closed; today \'409 PO_TRANSITION_INVALID\' - HR-C8', 'JO'),
  C('O2.J.issued.closeOutstanding', L(755, 1149), 'WP5.O2.closeOutstanding', 'J', 'J7, J-ISS issued, nothing received: close without force \'409 PO_CLOSE_OUTSTANDING\' (catcher of M-PCLg / M-PCLga)', 'JO'),
  C('O2.J.issued.forceNoReason', L(755, 1149), 'WP5.O2.forceNoReason', 'J', 'J7, J-ISS force without a reason: \'400 PO_CLOSE_REASON_REQUIRED\' (catcher of M-PCLgb)', 'JO'),
  C('O2.J.issued.forceWithReason', L(755, 1149), 'WP5.closeBeforeDelivery.issuedForceClose', 'J', 'J7, J-ISS force with a reason: 200 closed (issued -> closed exists at HEAD; BOOK-G5; catcher of M-PCL0 / M-PCL0i)', 'JO'),
  C('O2.J.ack.forceWithReason', L(755, 1149), 'WP5.closeBeforeDelivery.ackForceClose', 'J', 'J7, J-ACKC acknowledged, nothing received: force with a reason 200 closed (BOOK-G5; catcher of M-PCL0 / M-PCL0k)', 'JO'),
  C('O2.J.issued.receiveAfterClose', L(755), 'WP5.closeBeforeDelivery.receiveAfterClose', 'J', 'J7, J-ISS closed: the keeper\'s receipt \'409 PO_NOT_ISSUED\' (the code of the plan\'s case, on an order closed before any delivery)', 'JO'),
  C('O4.J.draftReceipt', L(757), 'WP5.O4.draftReceipt', 'J', 'J6, J-DRAFT: a receipt \'409 PO_NOT_ISSUED\'', 'JO'),
  C('O4.J.acknowledgedReceipt', L(757), 'WP5.O4.acknowledgedReceipt', 'J', 'J6, J-ACK acknowledged: a receipt of 20 answers 201, the order received, J-NAIL on hand 20', 'JO'),
  C('O4.J.duplicateLine', L(757), 'WP5.O4.duplicateLine', 'J', 'J6, J-C with the same poLineId twice: \'400 RECEIPT_DUPLICATE_LINE\', nothing written', 'JO'),
  C('O4.J.alreadyPosted', L(757), 'WP5.O4.alreadyPosted', 'J', 'J6, the procurement door with J-O7\'s receiptNumber again: \'409 RECEIPT_ALREADY_POSTED\'', 'JO'),
  C('O4.J.acceptedRejected', L(757), 'WP5.O4.acceptedStock', 'J', 'J6, J-O4: 10 accepted + 2 rejected: J-BLK on hand +10 (100.00), line rejectedQty 2 (WP5.O4.rejectedQty), one movement only', 'JO'),
  C('O4.J.matchFlag', L(757), 'WP5.O4.matchFlag', 'J', 'J6, GET match/order J-O4: the line flags rejected_on_delivery (warning)', 'JO'),
  C('O7.J.ignoredFields', L(760, 788), 'WP5.O7.ignoredFields', 'J', 'J6, the procurement door receipt of J-O7 with issueToActivity true and issuedQty 60: 201, one receipt movement, no issue movement, no material_issue entry, line issuedQty 0 (the leaf\'s value is HEAD\'s; HR-C7 undecided)', 'JO'),
  C('KA.O5.receivableList.J', L(758, 786, 1112), 'WP5.O5.onJ', 'J', 'J6, J\'s list scope=receivable read before any close: value J-C, J-O4, J-ISS, J-ACKC, J-STK, J-DEL2; today the drafts J-DEL1, J-DRAFT, J-NS, J-NR listed and J-ACKC missing - RCV-LIST', 'JO'),

  C('N.stored.087', L(762), 'WP5.N1.availableAfterReserve', 'stored:087-COM', 'stored steps inventory, transfers, reservation done (the build asserted the cement 90 at 11.00 = WP5.existing.stockOnHand and the cost-code-only issue costPosted false = WP5.N1.costCodeOnly); reservation out onHand 90, reserved 50, available 40', 'COM'),
  C('N1.live.087', L(762), 'WP5.existing.stockOnHand', '087-COM', 'the cement now: onHand 90, reserved 50, available 40, averageCost 11.00 (stage4:170.weightedAverage), value 990.00 (WP5.existing.stockValue); read only (issue 41 / 40 run on J)', 'COM'),
  C('N.live.087.store', L(427, 765, 766), 'deep.087-COM.o2CementEnd', '087-COM', 'two project warehouses with their bins (site Z-A, Z-A-B01, Z-A-B02, Z-Q; yard Y-1, Y-1-B01; deep.087-COM.warehouses); the O2 cement as the build left it: onHand 47, damaged 2, quarantined 3, inTransit 0 (BOOK-G8); the serial meter recorded, not judged (no book key)', 'COM'),
  C('N1.J.existing', L(762), 'stage4:170.weightedAverage', 'J', 'J9, J-CEM: PO-A\' 100 @ 10.00 + PO-B\' 50 @ 13.00 on J-A130 / 02-100 (stage4:167, stage4:170 PO-A / PO-B value) = 150 @ 11.00; issue 60 to J-A130 posts 660.00 (stage4:170.issue60Cost); 90 on hand, 990.00 (WP5.existing)', 'JN'),
  C('N1.J.reserve', L(762), 'WP5.N1.availableAfterReserve', 'J', 'J9, reserve 50 J-CEM: onHand 90, reserved 50, available 40', 'JN'),
  C('N1.J.issue41', L(762, 1149), 'WP5.N1.issue41', 'J', 'J9, issue 41 naming no bin: \'409 INV_INSUFFICIENT_AVAILABLE\'; on hand still 90 (the warehouse-level draw, inventory :1031; catcher of M-AVL / M-AVLa)', 'JN'),
  C('N1.J.issue41bin', L(762, 1149), 'WP5.N1.issue41', 'J', 'J9, issue 41 naming J-B01: \'409 INV_INSUFFICIENT_AVAILABLE\'; on hand still 90 (the per-bin check, postMovement :756; catcher of M-AVL / M-AVLb)', 'JN'),
  C('N1.J.issue40', L(762), 'WP5.N1.issue40Cost', 'J', 'J9, issue 40: 201, value 440.00, costPosted true; onHand 50, reserved 50, available 0', 'JN'),
  C('N1.J.release51', L(762), 'WP5.N1.release51', 'J', 'J9, release 51: \'409 INV_RESERVATION_NEGATIVE\'', 'JN'),
  C('N1.J.noTarget', L(762), 'WP5.N1.noTarget', 'J', 'J9, J-BLK issued with no activity and no cost code: \'400 INV_NO_COST_TARGET\'', 'JN'),
  C('N1.J.costCodeOnly', L(762), 'WP5.N1.costCodeOnly', 'J', 'J9, J-BLK 2 issued to cost code 02-100 only: 201, costPosted false, a costNote, the movement on no project (no ledger entry)', 'JN'),
  C('KA.N2.returnNeverIssued', L(763, 789), 'WP5.N2.returnNeverIssued', 'J', 'J9, J-SAND 100 @ 10.00 received; return 50 never issued (the project and 02-100, no activity): value 4xx (400); today 201 - L36 (CERT-5)', 'JN'),
  C('KA.N2.stockAfterRefusal', L(763, 789), 'WP5.N2.stockAfterRefusal', 'J', 'J9, J-SAND after the return: value 100 / 1,000.00; today 150 / 1,500.00 - L36', 'JN'),
  C('KA.N2.projectCostAfterRefusal', L(763, 789), 'WP5.N2.projectCostAfterRefusal', 'J', 'J9, J\'s ledger across the return: value 0.00; today -500.00 - L36', 'JN'),
  C('N2.J.activityAfterReturn4', L(763), 'WP5.N2.activityAfterReturn4', 'J', 'J9, J-GRAVEL 20 @ 10.00 in, 10 issued to J-A310 (100.00), 4 returned to J-A310: the activity\'s ledger 60.00', 'JN'),
  C('KA.N2.return30After10', L(763, 789), 'WP5.N2.return30After10', 'J', 'J9, 30 more of J-GRAVEL returned to the project only (no activity, so no cost record goes below zero): value 400; today 201 - L36', 'JN'),
  C('KA.N3.credit', L(764, 789), 'WP5.N3.credit', 'J', 'J9, J-PIPE 10 @ 10.00 in, 10 issued to J-A220, 10 @ 14.00 in, 5 returned to J-A220: the return\'s credit value 50.00; today 70.00 - X-FINANCE-1 (CERT-5)', 'JN'),
  C('KA.N3.activity', L(764, 789), 'WP5.N3.activity', 'J', 'J9, J-A220\'s ledger after the return: value 50.00; today 30.00 - X-FINANCE-1', 'JN'),
  C('KA.N3.stock', L(764, 789), 'WP5.N3.stock', 'J', 'J9, J-PIPE after the return: value 15 / 190.00; today 15 / 210.00 (the second return is not sent: BOOK-G7) - X-FINANCE-1', 'JN'),
  C('N4.J.overReceipt', L(765), 'WP5.N4.overReceipt', 'J', 'J9, transfer J-T1 (10 J-CEM3 @ 11.00, J-SITE to J-YARD) received 9 + 2 damaged: \'400 TRANSFER_OVER_RECEIPT\', still in transit', 'JN'),
  C('N4.J.values', L(765), 'WP5.N4.conserved', 'J', 'J9, J-T1 received 7 + 1 damaged: transfer_out 110.00 (WP5.N4.sentValue); at the yard 77.00 on hand (receivedValue); damage 11.00 + short write-off 22.00 = 33.00 (writtenOff); 110.00 = 77.00 + 33.00 (conserved); nothing left in transit', 'JN'),
  C('N4.J.receiveAgain', L(765), 'WP5.N4.receiveAgain', 'J', 'J9, J-T1 received again: \'409 TRANSFER_STATE\'', 'JN'),
  C('N5.J.releaseOverQuarantine', L(766), 'WP5.N5.releaseOverQuarantine', 'J', 'J9, J-CEM3 at J-B02: 5 quarantined, release 6: \'409 INV_INSUFFICIENT_STOCK\'', 'JN'),
  C('N5.J.release5', L(766), 'WP5.N5.release5', 'J', 'J9, release 5: J-B02 back to 10 on hand, 0 quarantined (WP5.N5.release5)', 'JN'),
  C('KA.N6.issuedQty', L(767, 788), 'WP5.N6.issuedQty', 'J', 'J9, J-A130\'s plan row after the issue of 60: issuedQty value 60; today 0 - HR-C7', 'JN'),
  C('KA.N6.usage50', L(767, 788), 'WP5.N6.usage50', 'J', 'J9, usage 50 on the plan row: value accepted (the leaf\'s 200); today \'409 MATERIAL_USAGE_EXCEEDS_ISSUED_QTY\' - HR-C7', 'JN'),
  C('N6.J.usage70', L(767), 'WP5.N6.usage70', 'J', 'J9, usage 70: \'409 MATERIAL_USAGE_EXCEEDS_ISSUED_QTY\' (true today and after HR-C7)', 'JN'),
  C('N7.J.adjustNoNotes', L(768), 'WP5.N7.adjustNoNotes', 'J', 'J9, J-CEM3 adjusted without notes: \'400 INV_ADJUST_REASON\'', 'JN'),
  C('N7.J.damageOverReceipt', L(768), 'WP5.N7.damageOverReceipt', 'J', 'J9, receive 5 J-CEM3 with damagedQty 6: \'400 INV_DAMAGE_EXCEEDS_RECEIPT\', nothing written', 'JN'),

  C('D.live.087.stateCoverage', L(427, 770), 'deep.087-COM.stateCoverage.directCostsTypeByState', '087-COM', 'the 20 stored direct costs read live in their type and state', 'COM'),
  C('D.live.087.voidedAfterApproval', L(427, 771), 'deep.087-COM.supplierInvoiceVoidedAfterApproval.sourceNet', '087-COM', 'SINV-VOID: ledger entries +1,000.00 and -1,000.00 (a reversal) on A100, net 0.00, status void, postedAmount 0.00 (deep.087-COM.supplierInvoiceVoidedAfterApproval.*)', 'COM'),
  C('KA.D4.087', L(773, 789), 'WP5.D4.ledgerInvoiceBeforeReceipt', '087-COM', 'the membrane on A130: SINV-EARLY\'s direct_cost entries plus the issue\'s material_issue: value 1,000.00; today 2,000.00 - L35 (CERT-5; a build record)', 'COM'),
  C('D5.live.087.priceVariance', L(774), 'WP5.D5.priceVarianceVerdict', '087-COM', 'GET match/invoice SINV-VAR: verdict review, price_variance blocking (14.00 against 13.00)', 'COM'),
  C('D5.live.087.overInvoiced', L(774), 'WP5.D5.overInvoicedLedger', '087-COM', 'GET match/order PO-SVC: invoiced 120 > received 100, invoiced_more_than_received blocking, verdict review; SINV-OVER1 approved with postedAmount 0.00 (WP5-SVC-1)', 'COM'),
  C('D7.087.balanced', L(775), 'WP5.D7.balanced', '087-COM', 'GET /cost/reconciliation on 087-COM: balanced true', 'COM'),
  C('D1.J.emptySubmit', L(770), 'WP5.D1.emptySubmit', 'J', 'J11, J-DC1 with no line submitted: \'400 DIRECT_COST_EMPTY\'', 'JD'),
  C('D1.J.uncodedSubmit', L(770), 'WP5.D1.uncodedSubmit', 'J', 'J11, a line with no cost code and no budget line submitted: \'400 DIRECT_COST_LINE_COST_CODE_REQUIRED\'', 'JD'),
  C('D1.J.approveDraft', L(770), 'WP5.D1.approveDraft', 'J', 'J11, finance approves the draft: \'409 DIRECT_COST_NOT_PENDING\'', 'JD'),
  C('D1.J.returnNoReason', L(770), 'WP5.D1.returnNoReason', 'J', 'J11, finance returns the pending cost without a reason: \'400 VALIDATION_ERROR\' (the route)', 'JD'),
  C('D1.J.returnedState', L(770), 'WP5.D1.returnedState', 'J', 'J11, returned with a reason: draft, rejectedReason kept; edited; resubmitted: pending', 'JD'),
  C('D1.J.patchApproved', L(770), 'WP5.D1.patchApproved', 'J', 'J11, PATCH the approved J-DC1: \'409 DIRECT_COST_LOCKED\'', 'JD'),
  C('D1.J.deletePending', L(770), 'WP5.D1.deletePending', 'J', 'J11, DELETE the pending J-DC1: \'409 DIRECT_COST_LOCKED\'', 'JD'),
  C('D2.J.ledger', L(771, 1149), 'WP5.D2.ledger', 'J', 'J11, J-DC2 (1,000.00 / 2,000.00 / 3,000.00 on J-A320) approved: +6,000.00 in three entries, one per sourceLineId (WP5.D2.entryCount; key direct_cost:<id>:<lineId>; catcher of M-DCK)', 'JD'),
  C('D2.J.concurrentApprove', L(771, 1149), 'WP5.D2.concurrentApprove', 'J', 'J11, FIXTURE.d2Rounds rounds, each a fresh pending J-DC3 (500.00): two approvals at once (in process): one 200, one \'409 DIRECT_COST_NOT_PENDING\', one ledger entry; green only if every round is (WP5ADJ Q8; catcher of M-DCL)', 'JD'),
  C('D2.J.voidMirror', L(771), 'WP5.D2.voidMirror', 'J', 'J11, J-DC2 voided with a reason: three reversal entries, -6,000.00; the source nets 0.00; postedAmount 0.00 on each line', 'JD'),
  C('D2.J.voidAgain', L(771), 'WP5.D2.voidAgain', 'J', 'J11, J-DC2 voided again: \'409 DIRECT_COST_LOCKED\'', 'JD'),
  C('D3.J.payOver', L(772), 'WP5.D3.payOver', 'J', 'J11, J-DC4 (6,000.00 approved): a payment of 6,000.01 \'400 DIRECT_COST_PAYMENT_EXCEEDS\'', 'JD'),
  C('D3.J.payFull', L(772), 'WP5.D3.payFull', 'J', 'J11, 6,000.00 paid on 2026-09-20: 201, status paid', 'JD'),
  C('D3.J.voidPaid', L(772), 'WP5.D3.voidPaid', 'J', 'J11, the paid J-DC4 voided: \'409 DIRECT_COST_HAS_PAYMENTS\'', 'JD'),
  C('D3.J.cashOutflow', L(772), 'WP5.D3.cashOutflow', 'J', 'J11, GET /cash-flow on J, no rebuild sent: 2026-09 outflow 6,000.00 (J\'s only payment)', 'JD'),
  C('KA.D4.J.invoiceBeforeReceipt', L(773, 789), 'WP5.D4.ledgerInvoiceBeforeReceipt', 'J', 'J11, J-STK membrane 10 @ 100.00: invoice approved before the receipt, then received and 10 issued to J-A130: value 1,000.00; today 2,000.00 - L35 (CERT-5)', 'JD'),
  C('D4.J.controlPath', L(773), 'WP5.D4.controlPath', 'J', 'J11, J-STK2: received (J6), invoice approved (capitalised, postedAmount 0.00), 10 issued to J-A130: 1,000.00', 'JD'),
  C('D5.J.priceVariance', L(774), 'WP5.D5.priceVarianceVerdict', 'J', 'J11, J-VAR on PO-B\' (50 @ 13.00 received, invoiced 50 @ 14.00): match verdict review, price_variance blocking', 'JD'),
  C('D5.J.matched', L(774), "WP5.existing['stage12.invoiceA']", 'J', 'J11, stage 12 on J: J-INVA 100 @ 10.00 = 1,000.00 against PO-A\' verdict matched; J-VAR 700.00 against 650.00 received, variance +50.00; both approved (J-VAR in KA.D5.priceVarianceApproval) and capitalised: ledger delta 0.00 (WP5.existing stage12.*)', 'JD'),
  C('KA.D5.priceVarianceApproval', L(774, 791), 'WP5.D5.priceVarianceApproval', 'J', 'J11, finance approves J-VAR: value refused (4xx) unless an override with a reason; today 200 approved - HR-C5', 'JD'),
  C('KA.D5.overInvoicedLedger', L(774, 791), 'WP5.D5.overInvoicedLedger', 'J', 'J11, J-SVC (100 hr @ 10.00 received) invoiced 60 + 60, both approved: value 600.00 on the ledger; today 0.00 (BOOK-G3: WP5-SVC-1 capitalises both) - HR-C5', 'JD'),
  C('KA.D6.invoiceSideVerdict', L(774, 791), 'WP5.D6.invoiceSideVerdict', 'J', 'J11, J-D6INV: J-D6\'s line at +10% plus a freight line with no poLineId: value review; today check - HR-C5', 'JD'),
  C('D7.J.balanced', L(775), 'WP5.D7.balanced', 'J', 'J11, GET /cost/reconciliation on J after J9 and after J11 (J\'s end state: nothing writes on J after J11 but its archive): balanced true, no budget or activity variance', 'JD'),

  C('CF.awardAtomic', L(782, 1110), 'WP5.R2.concurrentConfirms', 'J,static', 'confirm-first: the non-atomic award confirmation (KA.R2.concurrentConfirms: two 201, two draft commitments from J-BP2; confirmAward claims nothing under a lock) - AWARD-ATOMIC, reported until its fix lands (then must be REJECTED)', 'CF'),
  C('CF.awardSecondOrder', L(783, 1110), 'WP5.R3.secondOrder', 'J,static', 'confirm-first: a second order from one award (KA.R3.secondOrder; raiseOrderFromAward records no order on the award) - AWARD-ONE-ORDER, reported until its fix lands', 'CF'),
  C('CF.awardCoding', L(784, 1110), 'WP5.R4.lineCoding', 'J,087-COM,static', 'confirm-first: award orders lose their coding (KA.R4.lineCoding.J and .087; the award line map copies no cost code, budget line or BOQ item) - AWARD-CODING, reported until its fix lands', 'CF'),
  C('CF.HRC8', L(785, 1076), 'WP5.O2.forceWithReason', 'J,stored:087-COM', 'confirm-first: a PO cannot be closed after any delivery and its cancel answers the wrong code (KA.O2.forceWithReason, KA.O2.fullyReceivedClose, KA.O3.cancelAfterDelivery, the stored BLOCKED closes) - HR-C8, reported', 'CF'),
  C('CF.receivableList', L(786, 1112), 'WP5.O5.receivableList', 'J,087-COM', 'confirm-first: the receivable list lists drafts and misses acknowledged orders (KA.O5.receivableList.J / .087) - RCV-LIST, reported until its fix lands', 'CF'),
  C('CF.HRC9', L(787, 1077), 'WP5.O6.refCollision', '087-COM,087-COM-B', 'confirm-first: the reference scan crosses projects (KA.O6.refCollision, O6.collision.live, and whether the keeper is on the team of the answered order\'s project) - HR-C9, reported', 'CF'),
  C('CF.HRC7', L(788, 1075), 'WP5.N6.issuedQty', 'J', 'confirm-first: ignored fields and an issued quantity never raised (O7.J.ignoredFields, KA.N6.issuedQty, KA.N6.usage50) - HR-C7, reported', 'CF'),
  C('CF.HRC6', L(789, 1074), 'WP5.N2.returnNeverIssued', 'J,087-COM', 'confirm-first: L35, L36 and X-FINANCE-1 (KA.N2.*, KA.N3.*, KA.D4.*) - HR-C6, recorded and deferred to CERT-5', 'CF'),
  C('CF.L199issue', L(790), 'WP5.CF.L199issue', 'J', 'confirm-first L199: the same issue body (one reference) twice on J-GRAVEL: today two 201 and two movements (BOOK-G10) - reported', 'CF'),
  C('CF.HRC5', L(791, 1073), 'WP5.D5.priceVarianceApproval', 'J,087-COM,static', 'confirm-first: the match is advisory and mixed lines downgrade the verdict (KA.D5.*, KA.D6.invoiceSideVerdict; approveDirectCost reads no match) - HR-C5, reported', 'CF'),
  C('CF.L107', L(792), 'WP5.CF.L107', 'J', 'confirm-first L107: J-VAR approved (700.00 against 650.00 received) is capitalised; the 50.00 variance lands in neither stock nor cost (BOOK-G10) - reported', 'CF'),
  C('CF.L119', L(792), 'WP5.CF.L119', 'J', 'confirm-first L119: J-L119 (750.00 coded 05-100, no budget line on J) approved: the ledger total +750.00, the budget lines\' recorded actual unchanged (BOOK-G10) - reported', 'CF'),
  C('CF.DFUN1delete', L(793), 'WP5.CF.DFUN1delete', 'J', 'confirm-first D-FUN-1: deleting J-A-DEL removes J-DEL2\'s line on it and J-DEL2 keeps 400.00 (today) instead of 100.00 (BOOK-G10) - reported', 'CF'),
  C('CF.SVC1', `${REGISTER}:292`, 'WP5.D5.overInvoicedLedger', 'J,087-COM', 'confirm-first WP5-SVC-1: J-SVC\'s service line names an inventory item after its receipt and both its invoices read postedAmount 0.00 (087-COM: PO-SVC and SINV-OVER1 likewise; the stored finding) - reported', 'CF'),
  C('CF.AWD1', `${REGISTER}:293`, 'WP5.R1.awardedNotLowestGap', 'stored:087-COM,087-COM,static', 'confirm-first WP5-AWD-1: the stored finding; 087-COM awarded above the lowest bid; the confirm route takes no not-the-lowest justification (routes/bids.js: only prequalOverrideReason) - reported', 'CF'),
  C('CF.INV1', `${REGISTER}:257`, 'WP5.CF.INV1', 'J,087-COM-B', 'confirm-first WP0-INV-1: the warehouse keeper, on neither J\'s nor 087-COM-B\'s team, receives (201), issues to J-A110 (201, 10.00 on J) and returns (201) J-INV1 stock, and lists 087-COM-B\'s orders (200); value 403 PROJECT_ACCESS_DENIED / 404 PROJECT_NOT_FOUND - reported', 'CF'),
];
/**
 * Fixed before the first run: the checks above (G.5xx is the harness's own, on top). WP5-PREP's draft list
 * (wp5-checks-draft.json): 142 checks; the book's check-to-key changes (book-changes.md, "For the proof and the lists")
 * are applied to the keys, not to the ids.
 */
const EXPECTED_CHECKS = 142;
// </CHECKS>
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((c) => c.id)).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');

/** Which projects each section touches (the --project filter selects sections). */
const SECTION_PROJECTS = {
  S: ['J', '087-COM', '087-COM-B', '052-COM', 'static'],
  JO: ['J'], JN: ['J'], JR: ['J'], JD: ['J'],
  COM: ['087-COM'], COMB: ['087-COM-B', '087-COM'], D2: ['052-COM'],
  CF: ['J', '087-COM', '087-COM-B', 'static'],
};
for (const c of CHECKS) if (!SECTION_PROJECTS[c.section]) throw new Error(`check ${c.id}: section ${c.section} is not in SECTION_PROJECTS`);
for (const [flag, set] of [['only', ONLY], ['skip', SKIP]]) {
  for (const section of set || []) if (!SECTION_PROJECTS[section]) throw new Error(`--${flag}: no section ${section} (sections: ${Object.keys(SECTION_PROJECTS).join(' ')})`);
}
if (PROJECT_FILTER && !Object.values(SECTION_PROJECTS).some((list) => list.includes(PROJECT_FILTER))) throw new Error(`--project: no project ${PROJECT_FILTER}`);
/** The sections CF classifies from (confirmFirstFlow reads their records, known answers and observations). */
const CF_SOURCES = ['JO', 'JN', 'JR', 'JD', 'COM', 'COMB'];
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
const NEED_J = ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes('J'));
/** Whether a selected check reads a step's result: J steps nothing selected reads are skipped in a filtered run. */
const wants = (...ids) => ids.some((id) => ACTIVE_IDS.has(id));
/** The deep projects (live or stored) the selected checks need. */
const NEED_DEEP = Object.keys(DEEP).filter((code) => runsOn(code));
/** Live reads of a deep project (stored-only checks need its state file, not the project). */
const NEED_LIVE = Object.keys(DEEP).filter((code) => ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes(code)));
const NEED_COMPANIES = [...new Set(['087', ...NEED_DEEP.map((code) => DEEP[code].company)])];
/** J9, J10, J11: run when a selected check (or CF) reads them. */
const NEED_J9 = NEED_J && (on('JN') || wants('CF.HRC7', 'CF.HRC6', 'CF.L199issue'));
const NEED_J10 = NEED_J && (on('JR') || wants('CF.awardAtomic', 'CF.awardSecondOrder', 'CF.awardCoding'));
const NEED_J11 = NEED_J && (on('JD') || wants('CF.HRC5', 'CF.HRC6', 'CF.L107', 'CF.L119', 'CF.SVC1'));

// -- small helpers --------------------------------------------------------------------------------------------------
/** A list out of an answer's data: the array itself, or its items / orders / rows / entries / ... */
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items', 'orders', 'rows', 'entries', 'lines', 'members', 'commitments', 'data']) if (Array.isArray(data?.[key])) return data[key];
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
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && sameJson([...a].sort(), [...b].sort());
const statusPart = (said) => Number(String(said).split(' ')[0]);
const is4xx = (said) => statusPart(said) >= 400 && statusPart(said) < 500;
const readState = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${code}.json`), 'utf8'));
const outOf = (state, step) => {
  const st = state?.steps?.[step];
  if (!st || st.status !== 'done') throw new Error(`build ${state?.code}: step ${step} is ${st ? st.status : 'not run'}`);
  return st.out;
};
const recordOf = (state, name) => state?.records?.[name] || null;
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
/** A book error leaf as the answer string ('409 PO_LOCKED'); a code-null leaf as its status alone. */
const saidOf = (leaf) => (leaf.value?.code ? `${leaf.value.status} ${leaf.value.code}` : String(leaf.value?.status));
/** A book today written as an error object, as the answer string. */
const saidOfToday = (leaf) => (leaf.today?.code ? `${leaf.today.status} ${leaf.today.code}` : String(leaf.today?.status));
/** A J book row by its key. */
const jRow = (list, key, value) => {
  const rows = list.filter((row) => row[key] === value);
  if (rows.length !== 1) throw new Error(`answer book: ${rows.length} rows with ${key} ${value} (exactly one expected)`);
  return rows[0];
};
/** A J record key as a reference part ("PO-A'" -> "POA"). */
const refKey = (key) => String(key).replace(/[^A-Za-z0-9]/g, '');

// -- J as the book types it (currency units in payloads, cents in the leaves) -------------------------------------------
const JB = {
  project: WP5.J.project.value,
  team: WP5.J.team.value,
  fixture: WP5.J.fixture.value,
  vendors: WP5.J.vendors.value,
  orders: WP5.J.orders.value,
  bids: WP5.J.bids.value,
  awardOrder: WP5.J.awardOrder.value,
  stock: WP5.J.stock.value,
  directCosts: WP5.J.directCosts.value,
};
/** The team J is made with: every WP5.J.team member but the warehouse keeper, who joins after J3 (CF.INV1). */
const J_TEAM = Object.fromEntries(Object.entries(JB.team).filter(([key]) => key !== 'warehouse'));
const J_KEEPER_ROLE = 'warehouse';
/**
 * Fixture inputs that are not expected figures (WP4ADJ B8 precedent): dates the choreography types, the two budget lines'
 * original amounts (no check reads them), the units and unit costs of the items the book names without one, and the
 * number of rounds of the direct-cost concurrency probe (WP5ADJ Q8). A builder or book change to these updates them here.
 */
const FIXTURE = Object.freeze({
  activityStart: '2026-02-02',
  activityEnd: '2026-06-30',
  costDate: '2026-09-25',
  budget: [{ code: '02-100', costType: 'material', originalBudget: 5000000 }, { code: '09-100', costType: 'indirect', originalBudget: 5000000 }],
  costTypeOf: { '02-100': 'material', '09-100': 'indirect', '05-100': 'subcontract' },
  items: {
    'J-CEM': ['bag', 10], 'J-CEM2': ['bag', 10], 'J-CEM3': ['bag', 11], 'J-BLK': ['pcs', 10], 'J-NAIL': ['kg', 5], 'J-TIE': ['kg', 2],
    'J-SAND': ['t', 10], 'J-GRAVEL': ['t', 10], 'J-PIPE': ['pcs', 10], 'J-MEM': ['roll', 100], 'J-MEM2': ['roll', 100], 'J-BOLT': ['pcs', 1], 'J-INV1': ['pcs', 5],
  },
  d2Rounds: 5,
  lapseMs: 30_000,
});
/** J-DC4's payment date, as the book's J record names it (WP5.J.directCosts J-DC4: "paid 6,000.00 on 2026-09-20"). */
const D3_PAID_AT = (/\d{4}-\d{2}-\d{2}/.exec(jRow(JB.directCosts, 'ref', 'J-DC4').serves) || [])[0] || null;
if (!D3_PAID_AT) throw new Error('answer book: WP5.J.directCosts J-DC4 names no payment date');
/** The issuedQty the procurement door is sent on J-O7 (WP5.J.choreography J6: "issueToActivity true and issuedQty 60"). */
const O7_ISSUED_QTY = Number((/issuedQty (\d+)/.exec(WP5.J.choreography.value.find((s) => /^J6 /.test(s)) || '') || [])[1]);
if (!Number.isInteger(O7_ISSUED_QTY) || O7_ISSUED_QTY <= 0) throw new Error('answer book: WP5.J.choreography J6 names no issuedQty for J-O7');
/** The 087-COM build's bidders (build/087-com.js BIDDERS: their invitation e-mails name them). */
const BIDDERS_087 = ['gulf', 'northern', 'emirates', 'coastal', 'late'];
const bidderMail087 = (key) => `${key}.087com@bidders.c087.octapm-cert.test`;
/** The 087-COM build's purchase-order keys (step purchase-orders out, po.from-award). */
const ORDER_KEYS_087 = { ack: 'ACK', a: 'A', b: 'B', c: 'C', o4: 'O4', x: 'X', svc: 'SVC', svc2: 'SVC2', stk: 'STK' };

// -- rules, the fix commits and the contracts pending their decisions or plan reviews ----------------------------------
const ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp4/PREP4-ADJUDICATION.md section D ${item}`;
/**
 * The fix commits: EMPTY until each fix lands (each goes ahead only if it confirms as P1, plan :1107). The integration
 * owner sets both fields from the fix commit (`git show -s --format=%cI <commit>`); the proof checks the time against git
 * (S.state). Once set, the rule is decided, its KAs and CF are judged on the value, and a build record observed before
 * the commit reads STORED-PRE-FIX. The four owner rules (HR-C5, HR-C7, HR-C8, HR-C9) are undecided: their entries are
 * set only by the commit that implements the owner's decision, together with its CONTRACT fields; HR-C8's stored build
 * moments (KA.O2.stored.*) then read STORED-PRE-FIX until the builder changes and the exit rebuild (WP-3 Q3 / WP-4 Q4).
 */
const FIXES = Object.freeze({
  'AWARD-ATOMIC': Object.freeze({ commit: null, committedAt: null }),
  'AWARD-ONE-ORDER': Object.freeze({ commit: null, committedAt: null }),
  'AWARD-CODING': Object.freeze({ commit: null, committedAt: null }),
  'RCV-LIST': Object.freeze({ commit: null, committedAt: null }),
  'HR-C5': Object.freeze({ commit: null, committedAt: null }),
  'HR-C7': Object.freeze({ commit: null, committedAt: null }),
  'HR-C8': Object.freeze({ commit: null, committedAt: null }),
  'HR-C9': Object.freeze({ commit: null, committedAt: null }),
});
const fixed = (rule) => Boolean(FIXES[rule]?.commit);
const fixRule = (rule, statement, sources) => ({ status: fixed(rule) ? 'decided' : 'proposed', statement: `${statement}${fixed(rule) ? `; implemented in ${FIXES[rule].commit}` : '; not yet decided and implemented'}.`, sources });
const RULES = {
  'HR-C5': fixRule('HR-C5', 'The three-way match gates approval: a blocking verdict refuses the invoice unless PM or finance overrides with a reason; an invoice line with no order line does not downgrade a review verdict (the recommendation :1073; undecided)', [`${PLAN_DOC}:744,774,791,1073`]),
  'HR-C6': { status: 'proposed', statement: 'Stocked-material cost: L35 (an invoice approved before its receipt counted once), L36 (returns bounded by what was issued), X-FINANCE-1 (a return credited at the issue cost); CERT-5 decides, CERT-3 records (owner decision, plan section 0.1).', sources: [`${PLAN_DOC}:742,763-764,773,789,1074`] },
  'HR-C7': fixRule('HR-C7', 'Material usage: a stock issue raises the plan row\'s issued quantity, usage is bounded by it, and the procurement door either honours issueToActivity / issuedQty or refuses them (the recommendation :1075; undecided)', [`${PLAN_DOC}:743,760,767,788,1075`]),
  'HR-C8': fixRule('HR-C8', 'A PO after delivery: partial -> closed with force and a reason, received -> closed, cancel after any delivery refused 409 PO_CANCEL_AFTER_DELIVERY, a receipt after a close refused (the recommendation :1076; undecided)', [`${PLAN_DOC}:737,755-756,785,1076`, ADJ('Q2, Q4')]),
  'HR-C9': fixRule('HR-C9', 'A purchase-order reference scan never crosses projects: ambiguous refs answer 409 or require projectId; authorisation within the company (the recommendation :1077, the plan proposes P1; undecided)', [`${PLAN_DOC}:759,787,1077`, ADJ('Q3')]),
  L35: { status: 'proposed', statement: 'An invoice approved before its receipt is counted once on the ledger (lead L35; HR-C6, CERT-5).', sources: [`${PLAN_DOC}:773,789`] },
  L36: { status: 'proposed', statement: 'A return is bounded by what was issued; a never-issued return is refused (lead L36; HR-C6, CERT-5).', sources: [`${PLAN_DOC}:763,789`] },
  'X-FINANCE-1': { status: 'proposed', statement: 'A return is credited at the cost it was issued at, not the current average (HR-C6, CERT-5).', sources: [`${PLAN_DOC}:764,789`] },
  'AWARD-ATOMIC': fixRule('AWARD-ATOMIC', 'Award confirmation is atomic: two confirms at once make one commitment and one 409 BID_PACKAGE_LOCKED (the section 5 defect fix :1110, made in WP-5 if it confirms as P1; P1 kept until the reproduction, WP5ADJ Q3)', [`${PLAN_DOC}:749,782,1110`, ADJ('Q3, Q8')]),
  'AWARD-ONE-ORDER': fixRule('AWARD-ONE-ORDER', 'One order per award: a second order from one award is refused 409 (code the fix\'s; :1110; whether a cancelled award order may be replaced is the owner\'s question)', [`${PLAN_DOC}:750,783,1110`, ADJ('Q4')]),
  'AWARD-CODING': fixRule('AWARD-CODING', 'An order raised from an award keeps the package line\'s cost code, budget line and BOQ item (:1110)', [`${PLAN_DOC}:751,784,1110`]),
  'RCV-LIST': fixRule('RCV-LIST', 'The receivable list is {issued, acknowledged, partial} (:1112; P3 proposed: no consumer)', [`${PLAN_DOC}:758,786,1112`]),
  L199: { status: 'proposed', statement: 'A stock issue carries an idempotency key: the same issue body twice makes one movement (lead L199; P3 proposed).', sources: [`${PLAN_DOC}:790`] },
  L107: { status: 'proposed', statement: 'A price variance on a capitalised invoice is recognised once, in stock or in cost (lead L107; P2 proposed).', sources: [`${PLAN_DOC}:792`] },
  L119: { status: 'proposed', statement: 'Cost coded to a cost code with no budget line reaches the budget register (lead L119; P2 proposed).', sources: [`${PLAN_DOC}:792`] },
  'D-FUN-1': { status: 'proposed', statement: 'Deleting an activity does not silently drop a PO\'s line and leave its value stale (register D-FUN-1, P2).', sources: [`${PLAN_DOC}:793`, `${REGISTER}:195`] },
  'WP5-SVC-1': { status: 'proposed', statement: 'Register WP5-SVC-1 (P2): a received service line becomes a stocked item, so its invoices are capitalised and never reach project cost.', sources: [`${REGISTER}:292`] },
  'WP5-AWD-1': { status: 'proposed', statement: 'Register WP5-AWD-1 (P3): an award to other than the lowest bid takes no justification beyond the prequalification override.', sources: [`${REGISTER}:293`] },
  'WP0-INV-1': { status: 'proposed', statement: 'Register WP0-INV-1 (P2): inventory movements and reads naming a project need access to that project (403 PROJECT_ACCESS_DENIED / 404 PROJECT_NOT_FOUND); severity against HR-C9 is the owner\'s (WP5ADJ Q3).', sources: [`${REGISTER}:257,265`, ADJ('Q3')] },
};
const CF_RULE = {
  'CF.awardAtomic': 'AWARD-ATOMIC', 'CF.awardSecondOrder': 'AWARD-ONE-ORDER', 'CF.awardCoding': 'AWARD-CODING', 'CF.HRC8': 'HR-C8', 'CF.receivableList': 'RCV-LIST',
  'CF.HRC9': 'HR-C9', 'CF.HRC7': 'HR-C7', 'CF.HRC6': 'HR-C6', 'CF.L199issue': 'L199', 'CF.HRC5': 'HR-C5', 'CF.L107': 'L107', 'CF.L119': 'L119',
  'CF.DFUN1delete': 'D-FUN-1', 'CF.SVC1': 'WP5-SVC-1', 'CF.AWD1': 'WP5-AWD-1', 'CF.INV1': 'WP0-INV-1',
};
/** The defect checks of a landed fix (none at HEAD): kind 'defect', judged on the value, today fails. */
const DECIDED_RED = {
  ...(fixed('AWARD-ATOMIC') ? {
    'KA.R2.concurrentConfirms': { rule: 'AWARD-ATOMIC', defect: 'AWARD-ATOMIC two confirms at once make two commitments', stored: false, today: 'two 201, two draft commitments' },
    'CF.awardAtomic': { rule: 'AWARD-ATOMIC', defect: 'AWARD-ATOMIC the non-atomic award confirmation', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('AWARD-ONE-ORDER') ? {
    'KA.R3.secondOrder': { rule: 'AWARD-ONE-ORDER', defect: 'AWARD-ONE-ORDER a second order from one award', stored: false, today: '201, two orders' },
    'CF.awardSecondOrder': { rule: 'AWARD-ONE-ORDER', defect: 'AWARD-ONE-ORDER a second order from one award', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('AWARD-CODING') ? {
    'KA.R4.lineCoding.J': { rule: 'AWARD-CODING', defect: 'AWARD-CODING the award order drops its coding (J)', stored: false, today: 'activityId only' },
    'KA.R4.lineCoding.087': { rule: 'AWARD-CODING', defect: 'AWARD-CODING the award order drops its coding (087-COM build record)', stored: true, today: 'activityId only' },
    'CF.awardCoding': { rule: 'AWARD-CODING', defect: 'AWARD-CODING award orders lose their coding', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('RCV-LIST') ? {
    'KA.O5.receivableList.J': { rule: 'RCV-LIST', defect: 'RCV-LIST the receivable list (J)', stored: false, today: 'drafts listed, acknowledged missing' },
    'KA.O5.receivableList.087': { rule: 'RCV-LIST', defect: 'RCV-LIST the receivable list (087-COM)', stored: false, today: 'acknowledged missing' },
    'CF.receivableList': { rule: 'RCV-LIST', defect: 'RCV-LIST the receivable list', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-C8') ? {
    'KA.O2.forceWithReason': { rule: 'HR-C8', defect: 'HR-C8 a partial PO cannot be closed short', stored: false, today: '409 PO_TRANSITION_INVALID' },
    'KA.O2.receiveAfterClose': { rule: 'HR-C8', defect: 'HR-C8 a receipt after a short close', stored: false, today: 'not sent' },
    'KA.O2.fullyReceivedClose': { rule: 'HR-C8', defect: 'HR-C8 a received PO cannot be closed', stored: false, today: '409 PO_TRANSITION_INVALID' },
    'KA.O3.cancelAfterDelivery': { rule: 'HR-C8', defect: 'HR-C8 a cancel after a delivery answers the wrong code', stored: false, today: '409 PO_TRANSITION_INVALID' },
    'KA.O2.stored.closeShort': { rule: 'HR-C8', defect: 'HR-C8 087-COM PO-C close-short (build moment)', stored: true, today: 'BLOCKED HR-C8' },
    'KA.O2.stored.closeReceived': { rule: 'HR-C8', defect: 'HR-C8 087-COM PO-A close-received (build moment)', stored: true, today: 'BLOCKED HR-C8' },
    'CF.HRC8': { rule: 'HR-C8', defect: 'HR-C8 a PO after delivery', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-C5') ? {
    'KA.D5.priceVarianceApproval': { rule: 'HR-C5', defect: 'HR-C5 an approval over a blocking variance', stored: false, today: '200 approved' },
    'KA.D5.overInvoicedLedger': { rule: 'HR-C5', defect: 'HR-C5 over-invoicing approved (also rests on WP5-SVC-1)', stored: false, today: '0 cents posted' },
    'KA.D6.invoiceSideVerdict': { rule: 'HR-C5', defect: 'HR-C5 a line without poLineId downgrades the verdict', stored: false, today: 'check' },
    'CF.HRC5': { rule: 'HR-C5', defect: 'HR-C5 the match is advisory', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-C7') ? {
    'KA.N6.issuedQty': { rule: 'HR-C7', defect: 'HR-C7 an issue never raises the issued quantity', stored: false, today: '0' },
    'KA.N6.usage50': { rule: 'HR-C7', defect: 'HR-C7 usage within the issued quantity refused', stored: false, today: '409 MATERIAL_USAGE_EXCEEDS_ISSUED_QTY' },
    'CF.HRC7': { rule: 'HR-C7', defect: 'HR-C7 ignored fields, issued quantity never raised', stored: false, today: 'CONFIRMED' },
  } : {}),
  ...(fixed('HR-C9') ? {
    'KA.O6.refCollision': { rule: 'HR-C9', defect: 'HR-C9 the reference scan crosses projects', stored: false, today: '200 arbitrary' },
    'CF.HRC9': { rule: 'HR-C9', defect: 'HR-C9 the reference scan crosses projects', stored: false, today: 'CONFIRMED' },
  } : {}),
};
for (const [id, d] of Object.entries(DECIDED_RED)) {
  if (!CHECKS.some((c) => c.id === id) || RULES[d.rule]?.status !== 'decided') throw new Error(`DECIDED_RED ${id}: not a check, or ${d.rule} is not decided`);
}

/**
 * The contracts of the undecided rules and the defect fixes, filled ONLY from the adjudicated decision or fix plan
 * (WP4ADJ Q2 precedent: no contract is guessed). While null, only what the book's value says is judged.
 *   AWARD-ATOMIC.loserCode            '<status> <CODE>' of the losing confirm (else the book's '409 BID_PACKAGE_LOCKED')
 *   AWARD-ONE-ORDER.refusalStatusCode '<status> <CODE>' of the second order (else any 409)
 *   HR-C8.cancelCode                  '<status> <CODE>' of a cancel after a delivery (else the book's)
 *   HR-C9.statusCode                  '<status> <CODE>' of an ambiguous scan (else any 409)
 */
const CONTRACT = Object.freeze({
  'AWARD-ATOMIC': Object.freeze({ loserCode: null }),
  'AWARD-ONE-ORDER': Object.freeze({ refusalStatusCode: null }),
  'HR-C8': Object.freeze({ cancelCode: null }),
  'HR-C9': Object.freeze({ statusCode: null }),
});

/** The setup checks. */
const SETUP_IDS = new Set(CHECKS.filter((c) => c.id.startsWith('S.')).map((c) => c.id));
/**
 * The live catchers of the section 6.2 WP-5 guards (WP5.mutations.*, WP5ADJ Q7); the variants, the HEAD-only complement
 * and the post-fix mutants with them. G.5xx is the harness's check (a 500 under M-DCL counts through it).
 */
const CATCHERS = {
  'M-PCL0': ['O2.J.issued.forceWithReason', 'O2.J.ack.forceWithReason'], 'M-PCL0i': ['O2.J.issued.forceWithReason'], 'M-PCL0k': ['O2.J.ack.forceWithReason'],
  'M-PCL1': ['KA.O2.forceWithReason', 'KA.O2.receiveAfterClose', 'KA.O2.fullyReceivedClose'],
  'M-PCLg': ['O2.J.issued.closeOutstanding', 'O2.J.closeOutstanding', 'O2.closeOutstanding.087', 'O2.closeOutstanding.052'], 'M-PCLga': ['O2.J.issued.closeOutstanding'],
  'M-PCLgb': ['O2.J.issued.forceNoReason', 'O2.J.forceNoReason', 'O2.forceNoReason.087', 'O2.forceNoReason.052'],
  'M-AWD0': ['R2.J.confirmAgain'], 'M-AWD1': ['KA.R2.concurrentConfirms'],
  'M-OVER': ['O4.J.overOrder'],
  'M-AVL': ['N1.J.issue41', 'N1.J.issue41bin'], 'M-AVLa': ['N1.J.issue41'], 'M-AVLb': ['N1.J.issue41bin'],
  'M-DCL': ['D2.J.concurrentApprove', 'G.5xx'], 'M-DCK': ['D2.J.ledger'],
};
/** Other checks a mutant turns red (named so a mutation result is read correctly); M-DCX is EQUIVALENT, recorded, not run. */
const COLLATERAL = {
  'M-PCL0': ['O2.J.issued.receiveAfterClose (J-ISS still issued: the receipt is accepted, 201, into J-INV1 on J)'],
  'M-PCL0i': ['O2.J.issued.receiveAfterClose'],
  'M-PCLg': ['O2.J.issued.forceNoReason and O2.J.issued.forceWithReason (J-ISS already closed: 409 PO_TRANSITION_INVALID)', 'the deep close refusals answer 409 PO_TRANSITION_INVALID: nothing written (HEAD only)'],
  'M-PCLga': ['O2.J.closeOutstanding, O2.closeOutstanding.087 / .052 (400 PO_CLOSE_REASON_REQUIRED instead of 409: nothing written)'],
  'M-PCLgb': ['the deep force-without-reason probes answer 409 PO_TRANSITION_INVALID: nothing written (HEAD only)'],
  'M-OVER': ['O2.J.closeOutstanding, O2.J.forceNoReason (J-C received: 409 PO_TRANSITION_INVALID)', 'KA.O2.forceWithReason and KA.O5.receivableList.J read wrong (J-C received)'],
  'M-AVL': ['N1.J.issue40 (available 0 by then: 409)', 'KA.N6.issuedQty / CF.HRC7 unchanged'],
  'M-AVLa': ['N1.J.issue40'], 'M-AVLb': ['N1.J.issue40'],
  'M-DCK': ['D2.J.voidMirror (one reversal, -1,000.00)'],
  'M-AWD0': ['none: the second confirm answers 400 BID_NOT_FOUND and writes nothing'],
};
/**
 * The fix mutations (plan section 1.4, wp5-mutations-draft.json): each puts a landed defect fix back, so each is run only
 * once its fix is in (FIXES set); their catchers are the fix's known answers, judged on the value from then on.
 */
const FIX_CATCHERS = { 'M-ORD1': ['KA.R3.secondOrder'], 'M-COD1': ['KA.R4.lineCoding.J'], 'M-RCV1': ['KA.O5.receivableList.J', 'KA.O5.receivableList.087'] };
for (const id of new Set(Object.values(FIX_CATCHERS).flat())) if (!CHECKS.some((c) => c.id === id)) throw new Error(`FIX_CATCHERS names ${id}, not a check`);
// The catchers are the book's (WP5.mutations.*: each names its catcher by check id, G16-G18).
{
  const bookText = Object.values(WP5.mutations).map((leaf) => leaf.value.join(' ')).join(' ');
  const missing = [...new Set(Object.values(CATCHERS).flat())].filter((id) => !bookText.includes(id));
  if (missing.length) throw new Error(`WP5.mutations names no catcher ${missing.join(', ')}: CATCHERS and the book disagree (G16-G18)`);
  for (const id of new Set(Object.values(CATCHERS).flat())) if (id !== harness.FIVE_XX_CHECK && !CHECKS.some((c) => c.id === id)) throw new Error(`CATCHERS names ${id}, not a check`);
}

const planEntries = ACTIVE.map((c) => [
  c.id,
  c.description,
  SETUP_IDS.has(c.id) ? { setup: true } : DECIDED_RED[c.id] ? { defect: DECIDED_RED[c.id].defect, rule: DECIDED_RED[c.id].rule } : c.id.startsWith('CF.') ? { rule: CF_RULE[c.id] } : {},
]);

const h = harness.createHarness({
  name: 'wp5-supply-proof',
  plan: planEntries,
  rules: RULES,
  mailPrefix: 'wp5',
  meta: {
    plan: `${PLAN_DOC} section 4 WP-5 (:734-793), section 6.2 WP-5 guards (:1149), section 5 HR-C5..HR-C9 (:1073-1077); plan lines as numbered at 48db9e9`,
    prep: 'C:/Temp/octapm-cert/scratch/wp5/WP5-PREP.md',
    adjudication: 'C:/Temp/octapm-cert/scratch/wp4/PREP4-ADJUDICATION.md section D (Q1-Q12 applied)',
    momentMap: 'backend/scripts/cert/cert3/build/MOMENT-MAP.md (WP-5 deviations to record when the proof lands: rows 144, 148, 150, 151 per WP5ADJ Q1)',
    answerBook: `backend/scripts/cert/cert3/answers/commercial.js @${COMMERCIAL.meta.head} + the WP-5 book patch (BOOK-G3, G1-G23)`,
    expectedChecks: EXPECTED_CHECKS,
    activeChecks: ACTIVE.length,
    filter: { only: ONLY ? [...ONLY] : null, skip: SKIP ? [...SKIP] : null, project: PROJECT_FILTER, sections: [...selectedSections], deepProjects: NEED_DEEP, live: NEED_LIVE, throwaway: { J: NEED_J, J9: NEED_J9, J10: NEED_J10, J11: NEED_J11 } },
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
    decidedRed: DECIDED_RED,
    fixes: FIXES,
    contract: Object.fromEntries(Object.entries(CONTRACT).map(([rule, fields]) => [rule, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? `pending the ${rule} decision or fix plan` : v]))])),
    fixture: FIXTURE,
    catchers: CATCHERS,
    fixCatchers: FIX_CATCHERS,
    collateral: COLLATERAL,
    deviations: [
      'The O2 closes and the receipt after a close run on J (J-C, PO-A\', J-ISS, J-ACKC); 087-COM PO-C and 052-COM PO-O2 keep a read and the two close refusals (WP5ADJ Q1, Q2; MOMENT-MAP row 144).',
      'N1\'s issue 41 / 40 and release 51 run on J\'s J-CEM; the 087-COM cement is read only (MOMENT-MAP row 148). N6\'s usage runs on J\'s plan row (row 150). The D5 approvals and the over-invoicing ledger run on J (row 151); 087-COM keeps the match reads.',
      'J\'s purchase orders carry their own references (C3W5-<key>-<stamp>), so that no J order reads PO-00001 in the keeper\'s reference scan (KA.O6.refCollision).',
    ],
    equivalentMutants: 'M-DCX (the ledger key pre-check dropped: the unique index on (orgId, sourceKey) refuses the same posting; WP5.mutations.directCostOnePosting): recorded, not run',
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
  const text = `${blocked ? `BLOCKED (known answer, ${ref})` : preFix ? `STORED-PRE-FIX (built ${storedAt}, before the ${ref} fix ${FIXES[ref].commit} of ${FIXES[ref].committedAt}): HEAD's pre-fix answer, reported with the register link ${ref}, not a WP-5 failure` : verdict === 'today' ? `FAIL: HEAD still gives the known answer of ${ref}, which is decided${storedAt !== null ? (FIXES[ref]?.commit ? ` (stored ${storedAt}, not before the fix commit)` : ` (no ${ref} fix commit yet)`) : ''}` : verdict === 'value' ? 'value' : `WRONG: neither the book's value nor HEAD's known answer (${ref})`}; ${detail}`;
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
/** A step a throwaway choreography cannot go on without: a setup error, not a verdict (as WP-1's W ... WP-4's K). */
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
const ctx = { db: null, q: null, orgs: {}, people: {}, sessions: {}, specs: {}, j: null, state: {}, deep: {}, cleanup: [], deepWrites: [], restorations: [], dir: {} };
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
/** A bidder's personal link: the token at the end of a portal URL (kept in memory only, never logged). */
const tokenOf = (url) => {
  const token = String(url || '').split('/bid/')[1];
  if (!token) throw new Error('a portal link without /bid/<token> came back');
  return token.split(/[?#]/)[0];
};
/** A public token route (the vendor portal): no session; the label never carries the token. */
const portal = async (method, token, suffix, body) => {
  const res = await api.raw(method, `/public/bids/${token}${suffix}`, body === undefined ? {} : { json: body });
  h.keep(`portal ${method} /public/bids/<token>${suffix}`, res);
  return res;
};
/** Every audit event of a project the filter selects, read to the end of the cursor. */
const auditEvents = async (who, P, query) => {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const data = await dataOf(who, `${P}/audit?${query}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    rows.push(...listOf(data?.events, 'events'));
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
/** The cost ledger entries behind an activity or a budget line (cost/reconciliation/explain), optionally of some sources. */
const ledgerEntries = async (who, P, { activityId = null, budgetLineId = null, sourceIds = null } = {}) => {
  const query = activityId ? `activityId=${activityId}` : `budgetLineId=${budgetLineId}`;
  const entries = listOf((await dataOf(who, `${P}/cost/reconciliation/explain?${query}&limit=500`))?.entries);
  return sourceIds ? entries.filter((e) => sourceIds.includes(e.sourceId)) : entries;
};
const sumCents = (rows, key = 'amount') => rows.reduce((s, r) => s + (cents(r[key]) ?? NaN), 0);
const recon = async (who, P) => dataOf(who, `${P}/cost/reconciliation`);
const reconFigures = (r) => ({ balanced: r?.balanced === true, ledgerTotal: cents(r?.ledger?.total), budgetRecorded: cents(r?.budget?.recordedTotal), budgetVariances: listOf(r?.budget?.variances).length, activityVariances: listOf(r?.activity?.variances).length });
/** An inventory item read back with its derived figures (GET /inventory/items/:id). */
const itemOf = async (who, itemId) => dataOf(who, `/inventory/items/${itemId}`);
const itemFigures = (i) => ({ onHand: num(i?.onHand), reserved: num(i?.reserved), available: num(i?.available), quarantined: num(i?.quarantined), damaged: num(i?.damaged), inTransit: num(i?.inTransit), averageCost: cents(i?.averageCost), value: cents(i?.value) });
/** Where an item is, per warehouse and bin (the scan by SKU). */
const stockOf = async (who, sku) => listOf((await dataOf(who, `/inventory/items/scan/${encodeURIComponent(sku)}`))?.stock);
/** An item's ledger movements, newest first (GET /inventory/stock/transactions). */
const movesOf = async (who, itemId, type = null) => listOf(await dataOf(who, `/inventory/stock/transactions?itemId=${itemId}${type ? `&type=${type}` : ''}&limit=500`));

// -- stored moments (pure over a state file and the book; exported for the static simulation) ------------------------
const saidRec = (st, name) => recordOf(st, name)?.said ?? null;
const findingRefs = (st) => (Array.isArray(st?.findings) ? st.findings : []).map((f) => f.ref);

/** A stored close step judged as a known answer (KA.O2.stored.*): done and closed (value), BLOCKED HR-C8 with the leaf's today (today). */
const storedClose = (st, step, leaf) => {
  const s = st?.steps?.[step];
  const observed = { status: s?.status ?? 'not run', ref: s?.blocked?.ref ?? null, said: s?.blocked?.observed?.said ?? null, outStatus: s?.out?.status ?? null };
  return {
    value: leaf.value,
    today: leaf.today,
    observed,
    verdict: judge(observed, (x) => x.status === 'done' && x.outStatus === leaf.value, (x) => x.status === 'blocked' && x.ref === 'HR-C8' && x.said === saidOfToday(leaf)),
    storedAt: stepAt(st, step),
  };
};

/** 087-COM's WP-5 build moments. */
const storedCom087 = (st) => {
  const out = {};
  const r1o = { bids: st?.steps?.bids?.status ?? null, noOverride: saidRec(st, 'bid.confirm.no-override'), awardFinding: findingRefs(st).includes('WP5-AWD-1') };
  const r1e = { bids: 'done', noOverride: saidOf(WP5.R1.unqualifiedAward), awardFinding: true };
  out['R1.stored.bids'] = { ok: sameJson(r1o, r1e), expected: r1e, observed: r1o, detail: 'the step done means the build asserted the totals against WP5.R1 bid.gulf / northern / emirates.total, the late bid against WP5.R1.submitAfterDue and Coastal withdrawn (build/087-com.js step bids)' };
  const rc = st?.steps?.receipts;
  const o2o = { receipts: rc?.status ?? null, states: rc?.out?.states ?? null };
  const o2e = { receipts: 'done', states: { a: 'received', b: 'received', c: WP5.O2.statusAfterPartial.value, o4: 'partial', svc: 'received' } };
  out['O2.stored.087'] = { ok: sameJson(o2o, o2e), expected: o2e, observed: o2o, detail: 'the step done means the build asserted PO-C 100 / 60 (WP5.O2.ordered / received), PO-O4 10 accepted + 2 rejected (WP5.O4.acceptedStock / rejectedQty) and the blocks on hand 10' };
  out['KA.O2.stored.closeShort'] = storedClose(st, 'po.C.close-short', WP5.O2.forceWithReason);
  out['KA.O2.stored.closeReceived'] = storedClose(st, 'po.A.close-received', WP5.O2.fullyReceivedClose);
  const res = st?.steps?.reservation?.out || {};
  const no = { steps: ['inventory', 'transfers', 'reservation'].map((k) => st?.steps?.[k]?.status ?? null), reservation: { onHand: num(res.onHand), reserved: num(res.reserved), available: num(res.available) } };
  const ne = { steps: ['done', 'done', 'done'], reservation: { onHand: WP5.existing.stockOnHand.value, reserved: WP5.existing.stockOnHand.value - WP5.N1.availableAfterReserve.value, available: WP5.N1.availableAfterReserve.value } };
  out['N.stored.087'] = { ok: sameJson(no, ne), expected: ne, observed: no, detail: 'the steps done mean the build asserted the cement 90 at 11.00 (WP5.existing) and the cost-code-only issue costPosted false (WP5.N1.costCodeOnly)' };
  out.findings = { awd1: findingRefs(st).includes('WP5-AWD-1'), svc1: findingRefs(st).includes('WP5-SVC-1') };
  return out;
};

/** 052-COM's PO-O2 moment. */
const storedCom052 = (st) => {
  const o = { step: st?.steps?.['po.O2']?.status ?? null, status: st?.steps?.['po.O2']?.out?.status ?? null, receipt: saidRec(st, 'receipt.O2') };
  const e = { step: 'done', status: D052.O2.statusAfterPartial.value, receipt: '201' };
  return { 'O2.stored.052': { ok: sameJson(o, e), expected: e, observed: o, detail: 'the step done means the build asserted PO-O2 100 / 60 at 1,000.00 USD (deep.052-COM.O2.ordered / received / order1000)' } };
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
const stripComments = (text) => String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** The CF items read from the source: null where the file or the declaration is not found (a gap, never a guess). */
const staticScan = () => {
  const confirm = bodyOf('services/bid.service.js', 'confirmAward');
  const raise = bodyOf('services/procurement.service.js', 'raiseOrderFromAward');
  const approve = bodyOf('services/direct-cost.service.js', 'approveDirectCost');
  const bidsRoute = fileOf('routes/bids.js');
  const at = bidsRoute ? bidsRoute.lines.findIndex((l) => /["'`]\/:packageId\/award\/confirm["'`]/.test(l)) : -1;
  const confirmFields = at >= 0 ? [...new Set([...bidsRoute.lines.slice(at, at + 6).join('\n').matchAll(/body\(["'`]([A-Za-z.*]+)["'`]\)/g)].map((m) => m[1]))] : null;
  const lineMap = raise === null ? null : (/const lines = \(enquiry\.lines[\s\S]*?\.filter\(/.exec(stripComments(raise))?.[0] ?? null);
  return {
    awardClaimWithoutLock: confirm === null ? null : !/FOR UPDATE/i.test(stripComments(confirm)),
    awardOrderRecordsNothing: raise === null ? null : !/awardedOrderId|ALREADY_ORDERED/.test(stripComments(raise)),
    awardLineMapCoding: lineMap === null ? null : ['costCodeId', 'budgetLineId', 'boqItemId'].filter((f) => lineMap.includes(f)),
    approveReadsMatch: approve === null ? null : /match/i.test(stripComments(approve)),
    confirmFields,
  };
};

// -- setup --------------------------------------------------------------------------------------------------------------
/** The build steps whose stored outputs (moment answers and ids) the proof reads, per state file, and the BLOCKED refs allowed. */
const STATE_STEPS = {
  '087-COM': ['directory', 'cost-codes', 'budget-lines', 'activities', 'boq', 'suppliers', 'warehouses', 'items', 'material-plan', 'purchase-orders', 'receipts',
    'po.C.close-short', 'po.A.close-received', 'inventory', 'transfers', 'reservation', 'bids', 'po.from-award', 'supplier-invoices', 'membrane.after-invoice', 'direct-costs'],
  '087-COM-B': ['po.PO-00001'],
  '052-COM': ['suppliers', 'warehouse', 'po.O2'],
};
/** J reads only 087-COM's directory (the supplier company its supplier and invoices name): the steps when no 087-COM check is selected. */
const STATE_STEPS_J_ONLY = { '087-COM': ['directory'] };
const ALLOWED_BLOCKED = { '087-COM': { 'po.C.close-short': 'HR-C8', 'po.A.close-received': 'HR-C8' } };
const PERSONAS = {
  pm: ['087', 'pm'], planner: ['087', 'planner'], qs: ['087', 'qs'], cost: ['087', 'cost'], procurement: ['087', 'procurement'], warehouse: ['087', 'warehouse'],
  site: ['087', 'site'], finance: ['087', 'finance'], pm052: ['052', 'pm'], procurement052: ['052', 'procurement'],
};
/** The 087 directory company J's supplier and invoices name (build/087-com.js DIRECTORY supplier). */
const SUPPLIER_087 = { key: 'supplier', name: 'CERT3 Cement Supplier (087-COM)' };

const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  // S.book: the load guard above passed (the WP-5 leaves exist with their patched values); figures() carries ref.
  const rows = COMMERCIAL.figures();
  const withRef = rows.filter((row) => Object.prototype.hasOwnProperty.call(row, 'ref') && row.ref).length;
  rec('S.book', rows.length > 0 && withRef > 0 && WP5_PATCH_LEAVES.every((key) => leafAt(key)) && WP5.D5.overInvoicedLedger.today === 0, { observed: { head: COMMERCIAL.meta.head, figures: rows.length, withRef, patchLeaves: WP5_PATCH_LEAVES.length, overInvoicedLedgerToday: WP5.D5.overInvoicedLedger.today }, detail: `answers/commercial.js @${COMMERCIAL.meta.head} + the WP-5 patch: ${rows.length} figures, ${withRef} with a ref` });

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
  const needStates = [...new Set([...NEED_DEEP, ...(NEED_J ? ['087-COM'] : [])])];
  for (const code of needStates) {
    const steps = NEED_DEEP.includes(code) ? STATE_STEPS[code] : STATE_STEPS_J_ONLY[code];
    try {
      ctx.state[code] = readState(code);
      for (const step of steps) {
        const st = ctx.state[code].steps?.[step];
        const allowed = ALLOWED_BLOCKED[code]?.[step];
        if (st?.status === 'done') continue;
        if (st?.status === 'blocked' && allowed && st.blocked?.ref === allowed && st.blocked?.observed?.said) continue;
        stateProblems.push(`${code}: step ${step} is ${st?.status || 'not run'}${st?.status === 'blocked' ? ` (${st.blocked?.ref}; allowed ${allowed || 'none'}; observed ${st.blocked?.observed?.said || 'none'})` : ''}`);
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
  rec('S.state', stateProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.state).map(([c, s]) => [c, { projectId: s.projectId, runs: s.runs?.length, updatedAt: s.updatedAt }])), detail: stateProblems.join('; ') || `${needStates.length} state files (${needStates.join(', ') || 'none needed'}), every needed step done or BLOCKED with its moment-map ref and its observed answer; fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}` });

  // S.projects: the deep projects by their exact names, through the API as each company's PM.
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

  // J's supplier company: 087's directory supplier the 087-COM build made, by the id its state names, read back by name.
  if (NEED_J) {
    const id = outOf(ctx.state['087-COM'], 'directory').ids?.[SUPPLIER_087.key];
    const page = await get('pm', `/companies?limit=100&search=${encodeURIComponent(SUPPLIER_087.name)}`);
    const row = listOf(page.body?.data).find((c) => c.id === id && c.name === SUPPLIER_087.name) || null;
    if (!row) throw new Error(`setup: J's supplier company: no company ${id} named "${SUPPLIER_087.name}" (${h.said(page)})`);
    ctx.dir.supplier = { id: row.id, name: row.name };
  }
};

// -- the throwaway J: create, archive -------------------------------------------------------------------------------------
const archivedAtOf = async (id) => (await ctx.q('select "archivedAt"::text as a from "Project" where id = $1', [id]))[0]?.a || null;
/** Archives J once (the end step or cleanup): the answer and archivedAt read back. */
const archive = async (t, label) => {
  if (!t || t.archived) return t?.archived || null;
  const res = await send('pm', 'DELETE', `/projects/${t.id}`);
  const at = await archivedAtOf(t.id);
  t.archived = { said: h.said(res), status: res.status, archivedAt: at, label };
  return t.archived;
};
/** The user ids on a project's team (GET /projects/:id/team as the PM). */
const teamOf = async (who, P) => listOf(await dataOf(who, `${P}/team`), 'members', 'team').map((r) => r.userId ?? r.user?.id ?? r.id).filter(Boolean);
const poRouteJ = (id) => `${ctx.j.P}/purchase-orders/${id}`;
const poOf = async (who, P, id) => dataOf(who, `${P}/purchase-orders/${id}`);
const poAct = (who, id, verb, body = {}) => send(who, 'POST', `${poRouteJ(id)}/${verb}`, body);
const lineFigures = (order, n = 0) => { const l = (order?.lines || [])[n] || {}; return { ordered: num(l.orderedQty), received: num(l.receivedQty), rejected: num(l.rejectedQty), issued: num(l.issuedQty), inventoryItemId: l.inventoryItemId ?? null }; };

// -- J: J0-J2 (S.J.create, S.J.fixture) -----------------------------------------------------------------------------------
const jSetup = async () => {
  const name = String(JB.project.name).replace('<stamp>', h.STAMP);
  const created = await send('pm', 'POST', '/projects', { ...JB.project, name });
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (!id) throw new Error(`J could not be created: ${h.said(created)} ${created.body?.error?.message || ''}`);
  const j = { id, P: `/projects/${id}`, name, created, shown: created.body?.data || {}, members: [], acts: {}, codes: {}, lines: {}, boq: {}, wh: {}, bins: {}, items: {}, orders: {}, vendors: {}, archived: null };
  ctx.j = j;
  ctx.cleanup.push(async () => { const a = await archive(j, 'J'); return `J ${id} archive ${a?.said ?? 'not sent'}, archivedAt ${a?.archivedAt || 'NOT SET'}`; });
  for (const [key, role] of Object.entries(J_TEAM)) {
    const res = await send('pm', 'POST', `${j.P}/team`, { userId: ctx.people[key], role });
    j.members.push({ key, role, said: h.said(res), status: res.status });
  }
  const team = await teamOf('pm', j.P);
  const keeperOn = team.includes(ctx.people.warehouse);
  const createdOk = created.status === 201 && j.members.length === Object.keys(J_TEAM).length && j.members.every((m) => [200, 201].includes(m.status))
    && Number(j.shown.defaultRetentionRate) === JB.project.defaultRetentionRate && j.shown.currency === JB.project.currency && !keeperOn;
  rec('S.J.create', createdOk, { expected: { project: JB.project, team: J_TEAM, keeperOnTeam: false }, observed: { id, said: h.said(created), defaultRetentionRate: j.shown.defaultRetentionRate ?? null, currency: j.shown.currency ?? null, team: j.members, keeperOnTeam: keeperOn }, detail: 'explicit defaultRetentionRate 10 (WP-5 never depends on HR-C1); the warehouse keeper joins after J3 (CF.INV1)' });
  need(createdOk, 'J0: J or its team could not be made');

  // J1: activities, cost codes, budget lines, the BOQ row
  const made = [];
  for (const [i, code] of JB.fixture.activities.entries()) {
    const res = await send('planner', 'POST', `${j.P}/activities`, { name: `CERT3 WP5 ${code} ${h.STAMP}`, activityCode: code, wbsCode: 'WP5-J', category: 'civil', startDate: FIXTURE.activityStart, endDate: FIXTURE.activityEnd, sortOrder: i, engineerIds: [ctx.people.site] });
    j.acts[code] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push([code, h.said(res)]);
  }
  const library = await dataOf('cost', `${j.P}/budget/cost-codes`);
  for (const code of JB.fixture.costCodes) { const hits = listOf(library?.available).filter((c) => c.code === code); j.codes[code] = hits.length === 1 ? hits[0].id : null; }
  const select = JB.fixture.costCodes.every((code) => j.codes[code]) ? await send('cost', 'PUT', `${j.P}/budget/cost-codes`, { costCodeIds: JB.fixture.costCodes.map((code) => j.codes[code]) }) : null;
  const lineAnswers = [];
  for (const l of FIXTURE.budget) {
    const key = `${l.code}/${l.costType}`;
    const res = j.codes[l.code] ? await send('cost', 'POST', `${j.P}/budget/lines`, { costCodeId: j.codes[l.code], costType: l.costType, description: `CERT3 WP5 ${key} ${h.STAMP}`, originalBudget: units(l.originalBudget), status: 'active' }) : null;
    j.lines[key] = res?.status === 201 ? res.body?.data?.id || null : null;
    lineAnswers.push([key, res ? h.said(res) : 'no cost code']);
  }
  const budgetKeysOk = sameSet(FIXTURE.budget.map((l) => `${l.code}/${l.costType}`), JB.fixture.budgetLines);
  const row = JB.fixture.boqRow;
  const boq = await send('qs', 'POST', `${j.P}/boq/items`, { code: row.code, description: `CERT3 WP5 ${row.code} rebar ${h.STAMP}`, quantity: row.qty, unit: row.unit, rate: row.rate });
  j.boq[row.code] = boq.status === 201 ? boq.body?.data?.item?.id ?? boq.body?.data?.id ?? null : null;

  // J2: the supplier, the warehouses and their bins, the items, the directory vendors
  const sup = await send('procurement', 'POST', `${j.P}/procurement/suppliers`, { companyId: ctx.dir.supplier.id, code: `J-SUP-${h.STAMP}`, contactName: `Account manager CERT3 WP5 ${h.STAMP}`, status: 'approved', notes: `CERT3 WP5 J-SUP ${h.STAMP}` });
  j.supplierId = sup.status === 201 ? sup.body?.data?.id || null : null;
  const whAnswers = [];
  for (const [whKey, bins] of Object.entries(JB.fixture.warehouses)) {
    const res = await send('pm', 'POST', '/inventory/warehouses', { code: `C3W5-${refKey(whKey)}-${h.STAMP}`, name: `CERT3 WP5 ${whKey} ${h.STAMP}`, kind: whKey === 'J-SITE' ? 'site' : 'project', projectId: j.id, notes: `CERT3 WP5 ${whKey} ${h.STAMP}` });
    j.wh[whKey] = res.status === 201 ? res.body?.data?.id || null : null;
    whAnswers.push([whKey, h.said(res)]);
    for (const bin of bins) {
      const b = j.wh[whKey] ? await send('pm', 'POST', `/inventory/warehouses/${j.wh[whKey]}/locations`, { code: bin, name: `CERT3 WP5 ${bin} ${h.STAMP}`, kind: bin === 'J-Q' ? 'zone' : 'bin' }) : null;
      j.bins[bin] = b?.status === 201 ? b.body?.data?.id || null : null;
      whAnswers.push([bin, b ? h.said(b) : 'no warehouse']);
    }
  }
  const itemAnswers = [];
  for (const key of JB.fixture.items) {
    const [unit, unitCost] = FIXTURE.items[key] || [];
    const sku = `CERT3-WP5-${key}-${h.STAMP}`;
    const res = unit ? await send('procurement', 'POST', '/inventory/items', { sku, name: `CERT3 WP5 ${key} ${h.STAMP}`, unit, category: 'cert3-wp5', projectId: j.id, unitCost, notes: `CERT3 WP5 ${key}` }) : null;
    j.items[key] = res?.status === 201 ? { id: res.body?.data?.id || null, sku } : { id: null, sku };
    itemAnswers.push([key, res ? h.said(res) : 'no fixture unit']);
  }
  // The directory vendors (the PM is 087's company admin, HR-A1): nine criteria scored, then the decision.
  const vendorOf = async (key, { limitCents, lapses }) => {
    const spec = JB.vendors[key];
    const res = await send('pm', 'POST', '/company/vendors', { name: `CERT3 WP5 ${key} ${h.STAMP}`, email: h.mail(refKey(key).toLowerCase(), 'vendors.c087.octapm-cert.test'), contactName: `Estimator CERT3 WP5 ${key}`, isVendor: true });
    const vid = res.status === 201 ? res.body?.data?.id || null : null;
    if (!vid) return { key, said: h.said(res), id: null };
    const pq = await dataOf('pm', `/company/vendors/${vid}/prequalification`);
    const keys = listOf(pq?.criteria).map((c) => c.key);
    const scores = [];
    for (const k of keys.filter((x) => !(lapses && x === 'insurance'))) scores.push([k, h.said(await send('pm', 'PATCH', `/company/vendors/${vid}/prequalification/criteria/${k}`, { score: 5, reference: `CERT3-WP5-${refKey(key)}-${k}-${h.STAMP}` }))]);
    let lapseAt = null;
    if (lapses) {
      lapseAt = new Date(Date.now() + FIXTURE.lapseMs).toISOString();
      scores.push(['insurance', h.said(await send('pm', 'PATCH', `/company/vendors/${vid}/prequalification/criteria/insurance`, { score: 5, reference: `CERT3-WP5-${refKey(key)}-insurance-${h.STAMP}`, expiresAt: lapseAt }))]);
    }
    const decided = await send('pm', 'POST', `/company/vendors/${vid}/prequalification/decision`, { status: spec.decision, validUntil: spec.validUntil, ...(limitCents !== null ? { singleAwardLimit: units(limitCents) } : {}), decisionNote: `CERT3 WP5 ${key} ${h.STAMP}` });
    const view = decided.body?.data || {};
    return { key, id: vid, said: h.said(res), criteria: keys.length, scores: scores.map(([, s]) => s), decision: h.said(decided), effectiveStatus: view.effectiveStatus ?? null, qualified: view.qualified ?? null, singleAwardLimit: cents(view.singleAwardLimit), validUntil: String(view.validUntil || '').slice(0, 10), expiresBecause: view.expiresBecause ?? null, expiresAt: view.expiresAt ?? null, lapseAt };
  };
  const qual = await vendorOf('J-QUAL', { limitCents: WP5.R5.singleAwardLimit.value, lapses: false });
  const exp = await vendorOf('J-EXP', { limitCents: null, lapses: true });
  j.vendors = { 'J-QUAL': qual, 'J-EXP': exp };
  j.lapseAt = exp.lapseAt;

  const fixture = { made, codes: j.codes, select: select ? h.said(select) : null, lines: lineAnswers, budgetKeysOk, boq: h.said(boq), supplier: h.said(sup), warehouses: whAnswers, items: itemAnswers, vendors: j.vendors };
  obs.jFixture = fixture;
  const vendorOk = (v, { limitCents, lapses }) => v.id && v.criteria === 9 && v.scores.every((s) => s === '200') && v.decision === '200' && v.effectiveStatus === JB.vendors[v.key].decision && v.qualified === true
    && v.validUntil === JB.vendors[v.key].validUntil && (limitCents === null ? v.singleAwardLimit === null : v.singleAwardLimit === limitCents) && (!lapses || (v.expiresAt === v.lapseAt && Boolean(v.expiresBecause)));
  const ok = made.every(([, s]) => s === '201') && Object.values(j.acts).every(Boolean) && select?.status === 200 && budgetKeysOk && lineAnswers.every(([, s]) => s === '201') && Boolean(j.boq[row.code])
    && Boolean(j.supplierId) && whAnswers.every(([, s]) => s === '201') && itemAnswers.every(([, s]) => s === '201')
    && vendorOk(qual, { limitCents: WP5.R5.singleAwardLimit.value, lapses: false }) && vendorOk(exp, { limitCents: null, lapses: true });
  rec('S.J.fixture', ok, { expected: { activities: JB.fixture.activities, costCodes: JB.fixture.costCodes, budgetLines: JB.fixture.budgetLines, boqRow: row, warehouses: JB.fixture.warehouses, items: JB.fixture.items.length, vendors: JB.vendors, singleAwardLimit: WP5.R5.singleAwardLimit.value }, observed: fixture, detail: `the budget amounts are fixture inputs (FIXTURE.budget); J-EXP's insurance lapses at ${exp.lapseAt} (assumption A-3)` });
  need(ok, `J1-J2: the fixture could not be set up (${json(fixture, 900)})`);
};

// -- J: J3, the warehouse keeper before joining J (CF.INV1, WP0-INV-1) ---------------------------------------------------------
const jKeeperOff = async () => {
  const j = ctx.j;
  const m = JB.stock.movements.inv1;
  const inv1 = j.items[m.item];
  const keeperOnJ = (await teamOf('pm', j.P)).includes(ctx.people.warehouse);
  const rcv = await send('warehouse', 'POST', '/inventory/stock/receive', { itemId: inv1.id, warehouseId: j.wh['J-SITE'], locationId: j.bins['J-B02'], quantity: m.receipt[0], unitCost: m.receipt[1], projectId: j.id, reference: `C3W5-INV1-RCV-${h.STAMP}`, notes: 'CERT3 WP5 J3: the keeper, not on J' });
  const iss = await send('warehouse', 'POST', '/inventory/stock/issue', { itemId: inv1.id, warehouseId: j.wh['J-SITE'], quantity: m.issued, activityId: j.acts['J-A110'], projectId: j.id, reference: `C3W5-INV1-ISS-${h.STAMP}`, notes: 'CERT3 WP5 J3' });
  const issueIds = listOf(iss.body?.data?.movements).map((x) => x.id);
  const issueCostOnJ = issueIds.length ? sumCents(await ledgerEntries('cost', j.P, { activityId: j.acts['J-A110'], sourceIds: issueIds })) : 0;
  const ret = await send('warehouse', 'POST', '/inventory/stock/return', { itemId: inv1.id, warehouseId: j.wh['J-SITE'], locationId: j.bins['J-B02'], quantity: m.returned, activityId: j.acts['J-A110'], projectId: j.id, reference: `C3W5-INV1-RET-${h.STAMP}`, notes: 'CERT3 WP5 J3' });
  let list = null;
  if (ctx.deep['087-COM-B']) {
    const B = ctx.deep['087-COM-B'];
    const keeperOnB = (await teamOf('pm', B.P)).includes(ctx.people.warehouse);
    const res = await get('warehouse', `/inventory/purchase-orders?projectId=${B.id}`);
    list = { keeperOnTeam: keeperOnB, said: h.said(res), refs: listOf(res.body?.data).map((o) => o.ref) };
  }
  obs.inv1 = { keeperOnJ, receive: h.said(rcv), issue: h.said(iss), issueCostOnJ, return: h.said(ret), ordersOf087ComB: list };
  const add = await send('pm', 'POST', `${j.P}/team`, { userId: ctx.people.warehouse, role: J_KEEPER_ROLE });
  need([200, 201].includes(add.status) && (await teamOf('pm', j.P)).includes(ctx.people.warehouse), `J3: the PM could not add the warehouse keeper to J (${h.said(add)})`);
};

// -- J: J4-J5, the plan row and the orders (O1) -----------------------------------------------------------------------------
const J_DRAFT_STATES = new Set(['draft']);
const J_PENDING_STATES = new Set(['pending_approval']);
/** The orders acknowledged after their issue (WP5.J.choreography J5: "J-ACKC and J-ACK then acknowledged"). */
const J_ACKNOWLEDGED = new Set(['J-ACKC', 'J-ACK']);
const orderBody = (row) => {
  const j = ctx.j;
  const key = row.ref;
  return {
    ref: `C3W5-${refKey(key)}-${h.STAMP}`,
    item: `CERT3 WP5 ${key} ${h.STAMP}`,
    ...(key === 'J-NS' ? {} : { supplierId: j.supplierId }),
    status: 'draft',
    currency: JB.project.currency,
    ...(key === 'J-NR' ? {} : { requiredBy: dayFromNow(21) }),
    promisedDate: dayFromNow(14),
    buyer: `Buyer CERT3 WP5 ${h.STAMP}`,
    notes: `CERT3 WP5 ${key} ${h.STAMP}`,
    lines: row.lines.map((l, i) => ({
      lineNumber: i + 1,
      activityId: j.acts[l.activity],
      costCodeId: j.codes[l.costCode],
      budgetLineId: j.lines[l.budgetLine],
      ...(l.item ? { itemCode: j.items[l.item].sku } : {}),
      ...(key === JB.fixture.planRow.orderLine && l.item === JB.fixture.planRow.item ? { activityMaterialId: j.planRow } : {}),
      description: `${l.what} (CERT3 WP5 ${key})`,
      unit: l.unit,
      orderedQty: l.qty,
      unitCost: units(l.unitCost),
      notes: `CERT3 WP5 ${key} L${i + 1}`,
    })),
  };
};
const jOrders = async () => {
  const j = ctx.j;
  // J4: the plan row on J-A130 (WP5.N6)
  const pr = JB.fixture.planRow;
  const plan = await send('planner', 'POST', `${j.P}/activities/${j.acts[pr.activity]}/materials`, { name: `CERT3 WP5 ${pr.item} plan ${h.STAMP}`, code: j.items[pr.item].sku, unit: pr.unit, qty: pr.qty, requiredTiming: 'activity_start', leadWeeks: 2, bufferDays: 7, supplierId: j.supplierId, notes: `CERT3 WP5 J4 ${h.STAMP}` });
  j.planRow = plan.status === 201 ? plan.body?.data?.id ?? plan.body?.data?.material?.id ?? null : null;
  need(Boolean(j.planRow), `J4: the plan row could not be made (${h.said(plan)} ${plan.body?.error?.message || ''})`);
  // J5: every order raised as a draft; then driven to its state
  const answers = [];
  for (const row of JB.orders) {
    const res = await send('procurement', 'POST', `${j.P}/procurement/purchase-orders`, orderBody(row));
    const id = res.status === 201 ? res.body?.data?.id || null : null;
    need(Boolean(id), `J5: ${row.ref} could not be raised (${h.said(res)} ${res.body?.error?.message || ''})`);
    const order = await poOf('procurement', j.P, id);
    j.orders[row.ref] = { id, ref: order.ref, lineIds: (order.lines || []).map((l) => l.id), value: cents(order.value) };
    need(j.orders[row.ref].lineIds.length === row.lines.length && j.orders[row.ref].value === row.value, `J5: ${row.ref} reads ${json({ lines: j.orders[row.ref].lineIds.length, value: j.orders[row.ref].value })}, the book ${json({ lines: row.lines.length, value: row.value })}`);
    const steps = [];
    if (!J_DRAFT_STATES.has(row.stateAtJ6)) steps.push(['procurement', 'submit', 'pending_approval']);
    if (!J_DRAFT_STATES.has(row.stateAtJ6) && !J_PENDING_STATES.has(row.stateAtJ6)) steps.push(['pm', 'approve', 'approved'], ['procurement', 'issue', 'issued']);
    if (J_ACKNOWLEDGED.has(row.ref)) steps.push(['procurement', 'acknowledge', 'acknowledged']);
    for (const [who, verb, to] of steps) {
      const r = await poAct(who, id, verb, verb === 'acknowledge' ? { acknowledgedRef: `C3W5-ACK-${refKey(row.ref)}-${h.STAMP}` } : {});
      need(r.status === 200 && r.body?.data?.status === to, `J5: ${row.ref} ${verb} answered ${h.said(r)} (${r.body?.data?.status ?? '-'})`);
    }
    answers.push([row.ref, h.said(res), steps.map(([, v]) => v).join('>') || 'draft']);
  }
  obs.jOrders = answers;
  const O = j.orders;
  const ns = await poAct('procurement', O['J-NS'].id, 'submit');
  rec('O1.J.submitNoSupplier', h.is(ns, saidOf(WP5.O1.submitNoSupplier)), { expected: saidOf(WP5.O1.submitNoSupplier), observed: h.said(ns) });
  const nr = await poAct('procurement', O['J-NR'].id, 'submit');
  rec('O1.J.submitNoRequiredBy', h.is(nr, saidOf(WP5.O1.submitNoRequiredBy)), { expected: saidOf(WP5.O1.submitNoRequiredBy), observed: h.said(nr) });
  const rj = await poAct('pm', O['J-PEND'].id, 'reject', {});
  rec('O1.J.rejectNoReason', h.is(rj, saidOf(WP5.O1.rejectNoReason)), { expected: saidOf(WP5.O1.rejectNoReason), observed: h.said(rj) });
  const ip = await poAct('procurement', O['J-PEND'].id, 'issue');
  const pendNow = (await poOf('procurement', j.P, O['J-PEND'].id)).status;
  rec('O1.J.issuePending', h.is(ip, saidOf(WP5.O1.issuePending)) && pendNow === 'pending_approval', { expected: { said: saidOf(WP5.O1.issuePending), status: 'pending_approval' }, observed: { said: h.said(ip), status: pendNow } });
  const pt = await send('procurement', 'PATCH', poRouteJ(O["PO-A'"].id), { notes: `CERT3 WP5 a header edit after issue ${h.STAMP}` });
  rec('O1.J.patchIssued', h.is(pt, saidOf(WP5.O1.patchIssued)), { expected: saidOf(WP5.O1.patchIssued), observed: h.said(pt) });
};

// -- J: J6, receipts (O2, O4, O5, O7) -----------------------------------------------------------------------------------------
/** A goods receipt through the inventory door (the keeper) or the procurement door (procurement). */
const receipt = (who, order, lines, { door = 'inventory', receiptNumber = null, extra = {} } = {}) => (door === 'inventory'
  ? send(who, 'POST', '/inventory/goods-receipt', { orderId: order.id, projectId: ctx.j.id, warehouseId: ctx.j.wh['J-SITE'], deliveryNote: `C3W5-DN-${order.ref}`, notes: `CERT3 WP5 ${order.ref}`, lines })
  : send(who, 'POST', `${ctx.j.P}/procurement/purchase-orders/${order.id}/receipts`, { receiptNumber, warehouseId: ctx.j.wh['J-SITE'], notes: `CERT3 WP5 ${order.ref}`, ...extra, lines }));
const rline = (order, n, accepted, { rejected = 0, item = null, bin = null, extra = {} } = {}) => ({ poLineId: order.lineIds[n], acceptedQty: accepted, rejectedQty: rejected, ...(item ? { inventoryItemId: ctx.j.items[item].id } : {}), ...(bin ? { locationId: ctx.j.bins[bin] } : {}), notes: `CERT3 WP5 ${h.STAMP}`, ...extra });
/** The J order key of an order id (or 'other:<ref>'). */
const jKeyOf = (id, ref) => Object.entries(ctx.j.orders).find(([, o]) => o.id === id)?.[0] ?? `other:${ref}`;
const jReceipts = async () => {
  const j = ctx.j;
  const O = j.orders;
  const mustReceive = async (key, lines) => {
    const r = await receipt('warehouse', O[key], lines);
    need(r.status === 201, `J6: the receipt of ${key} answered ${h.said(r)} ${r.body?.error?.message || ''}`);
    return r;
  };
  const cem = JB.stock.movements.cement;
  await mustReceive("PO-A'", [rline(O["PO-A'"], 0, cem.receipts[0][0], { item: cem.item, bin: 'J-B01' })]);
  await mustReceive("PO-B'", [rline(O["PO-B'"], 0, cem.receipts[1][0], { item: cem.item, bin: 'J-B01' })]);
  // O2: J-C 60 of 100
  const jc = jRow(JB.orders, 'ref', 'J-C');
  await mustReceive('J-C', [rline(O['J-C'], 0, WP5.O2.received.value, { item: jc.lines[0].item, bin: 'J-B02' })]);
  const cOrder = await poOf('procurement', j.P, O['J-C'].id);
  const cem2 = itemFigures(await itemOf('warehouse', j.items[jc.lines[0].item].id));
  const o2o = { status: cOrder.status, warehouseStatus: cOrder.warehouseStatus, line: lineFigures(cOrder), value: cents(cOrder.value), cem2OnHand: cem2.onHand };
  const o2e = { status: WP5.O2.statusAfterPartial.value, warehouseStatus: WP5.O2.statusAfterPartial.value, ordered: WP5.O2.ordered.value, received: WP5.O2.received.value, value: WP5.O2.order1000.value, cem2OnHand: WP5.O2.received.value };
  rec('O2.J.partial', o2o.status === o2e.status && o2o.warehouseStatus === o2e.warehouseStatus && o2o.line.ordered === o2e.ordered && o2o.line.received === o2e.received && o2o.value === o2e.value && o2o.cem2OnHand === o2e.cem2OnHand, { expected: o2e, observed: o2o });
  // O4: J-O4 10 accepted + 2 rejected; its match
  const o4row = jRow(JB.orders, 'ref', 'J-O4');
  const blk = j.items[o4row.lines[0].item];
  const blkBefore = itemFigures(await itemOf('warehouse', blk.id));
  const o4r = await mustReceive('J-O4', [rline(O['J-O4'], 0, WP5.O4.acceptedStock.value, { rejected: WP5.O4.rejectedQty.value, item: o4row.lines[0].item, bin: 'J-B02' })]);
  const blkAfter = itemFigures(await itemOf('warehouse', blk.id));
  const o4Order = await poOf('procurement', j.P, O['J-O4'].id);
  const o4o = { movements: o4r.body?.data?.movements ?? null, onHandDelta: blkAfter.onHand - blkBefore.onHand, valueDelta: blkAfter.value - blkBefore.value, rejectedQty: lineFigures(o4Order).rejected, received: lineFigures(o4Order).received };
  const o4e = { movements: 1, onHandDelta: WP5.O4.acceptedStock.value, valueDelta: WP5.O4.acceptedStock.value * o4row.lines[0].unitCost, rejectedQty: WP5.O4.rejectedQty.value, received: WP5.O4.acceptedStock.value };
  rec('O4.J.acceptedRejected', sameJson(o4o, o4e), { expected: o4e, observed: o4o, detail: 'what was rejected went back on the lorry: one receipt movement, the line records the rejection' });
  const mo = await dataOf('warehouse', `/inventory/match/order/${O['J-O4'].id}`);
  const flags = listOf(mo?.lines)[0]?.flags || [];
  const rejectedFlag = flags.find((f) => f.code === WP5.O4.matchFlag.value) || null;
  rec('O4.J.matchFlag', Boolean(rejectedFlag) && rejectedFlag.severity === 'warning', { expected: { code: WP5.O4.matchFlag.value, severity: 'warning' }, observed: { flags: flags.map((f) => `${f.code}/${f.severity}`), verdict: mo?.verdict ?? null } });
  // J-ACK acknowledged, received
  const ack = jRow(JB.orders, 'ref', 'J-ACK');
  const ar = await receipt('warehouse', O['J-ACK'], [rline(O['J-ACK'], 0, ack.lines[0].qty, { item: ack.lines[0].item, bin: 'J-B02' })]);
  const ackOrder = await poOf('procurement', j.P, O['J-ACK'].id);
  const nail = itemFigures(await itemOf('warehouse', j.items[ack.lines[0].item].id));
  rec('O4.J.acknowledgedReceipt', h.said(ar) === String(WP5.O4.acknowledgedReceipt.value) && ackOrder.status === 'received' && nail.onHand === ack.lines[0].qty, { expected: { said: String(WP5.O4.acknowledgedReceipt.value), status: 'received', onHand: ack.lines[0].qty }, observed: { said: h.said(ar), status: ackOrder.status, onHand: nail.onHand } });
  // the other deliveries the later steps need: J-SVC (no item: WP5-SVC-1), J-STK2, J-D6
  await mustReceive('J-SVC', [rline(O['J-SVC'], 0, jRow(JB.orders, 'ref', 'J-SVC').lines[0].qty, { bin: 'J-B02' })]);
  for (const key of ['J-STK2', 'J-D6']) {
    const row = jRow(JB.orders, 'ref', key);
    await mustReceive(key, [rline(O[key], 0, row.lines[0].qty, { item: row.lines[0].item, bin: 'J-B02' })]);
  }
  // refused probes, each naming an existing item (a refused receipt settles its item first: WP5-PREP fact 13)
  const dr = await receipt('warehouse', O['J-DRAFT'], [rline(O['J-DRAFT'], 0, 1, { item: 'J-INV1', bin: 'J-B02' })]);
  rec('O4.J.draftReceipt', h.is(dr, saidOf(WP5.O4.draftReceipt)), { expected: saidOf(WP5.O4.draftReceipt), observed: h.said(dr) });
  const dup = await receipt('warehouse', O['J-C'], [rline(O['J-C'], 0, 1, { item: jc.lines[0].item, bin: 'J-B02' }), rline(O['J-C'], 0, 1, { item: jc.lines[0].item, bin: 'J-B02' })]);
  const afterDup = { line: lineFigures(await poOf('procurement', j.P, O['J-C'].id)).received, onHand: itemFigures(await itemOf('warehouse', j.items[jc.lines[0].item].id)).onHand };
  rec('O4.J.duplicateLine', h.is(dup, saidOf(WP5.O4.duplicateLine)) && afterDup.line === WP5.O2.received.value && afterDup.onHand === WP5.O2.received.value, { expected: { said: saidOf(WP5.O4.duplicateLine), line: WP5.O2.received.value, onHand: WP5.O2.received.value }, observed: { said: h.said(dup), ...afterDup } });
  const outstanding = WP5.O2.ordered.value - WP5.O2.received.value;
  const over = await receipt('warehouse', O['J-C'], [rline(O['J-C'], 0, outstanding + 1, { item: jc.lines[0].item, bin: 'J-B02' })]);
  const afterOver = { line: lineFigures(await poOf('procurement', j.P, O['J-C'].id)).received, onHand: itemFigures(await itemOf('warehouse', j.items[jc.lines[0].item].id)).onHand };
  rec('O4.J.overOrder', h.is(over, saidOf(WP5.O4.overOrder)) && afterOver.line === WP5.O2.received.value && afterOver.onHand === WP5.O2.received.value, { expected: { said: saidOf(WP5.O4.overOrder), qty: outstanding + 1, line: WP5.O2.received.value, onHand: WP5.O2.received.value }, observed: { said: h.said(over), ...afterOver }, detail: 'the catcher of M-OVER (writes only on J)' });
  // O7: the procurement door ignores issueToActivity and issuedQty
  const o7 = jRow(JB.orders, 'ref', 'J-O7');
  const bolt = j.items[o7.lines[0].item];
  const grn = `C3W5-GRN-O7-${h.STAMP}`;
  const o7body = [rline(O['J-O7'], 0, o7.lines[0].qty, { item: o7.lines[0].item, bin: 'J-B02', extra: { issuedQty: O7_ISSUED_QTY } })];
  const pr = await receipt('procurement', O['J-O7'], o7body, { door: 'procurement', receiptNumber: grn, extra: { issueToActivity: true } });
  const boltMoves = await movesOf('warehouse', bolt.id);
  const boltIssued = boltMoves.filter((x) => x.type === 'issue').reduce((s, x) => s + Math.abs(Number(x.quantity) || 0), 0);
  const boltEntries = (await ledgerEntries('cost', j.P, { activityId: j.acts[o7.lines[0].activity] })).filter((e) => boltMoves.some((x) => x.id === e.sourceId));
  const o7Line = lineFigures(await poOf('procurement', j.P, O['J-O7'].id));
  const o7o = { said: h.said(pr), movements: pr.body?.data?.movements ?? null, stockIssued: boltIssued, ledgerEntries: boltEntries.length, lineIssuedQty: o7Line.issued };
  rec('O7.J.ignoredFields', o7o.said === '201' && o7o.movements === 1 && sameJson({ stockIssued: o7o.stockIssued, ledgerEntries: o7o.ledgerEntries }, WP5.O7.ignoredFields.value) && o7o.lineIssuedQty === 0, { expected: { said: '201', movements: 1, ...WP5.O7.ignoredFields.value, lineIssuedQty: 0 }, observed: o7o, detail: 'issueToActivity true and lines[0].issuedQty 60 sent through the procurement door (routes/procurement.js:312, :327)' });
  const again = await receipt('procurement', O['J-O7'], o7body, { door: 'procurement', receiptNumber: grn, extra: { issueToActivity: true } });
  rec('O4.J.alreadyPosted', h.is(again, saidOf(WP5.O4.alreadyPosted)), { expected: saidOf(WP5.O4.alreadyPosted), observed: h.said(again) });
  // O5: the receivable list, read before any close
  const list = await dataOf('warehouse', `/inventory/purchase-orders?projectId=${j.id}&scope=receivable`);
  const keys = listOf(list).map((o) => jKeyOf(o.id, o.ref));
  obs.receivableJ = keys;
  const LJ = WP5.O5.onJ;
  ka('KA.O5.receivableList.J', { ref: LJ.ref, value: LJ.value, today: LJ.today, observed: keys, verdict: judge(keys, (x) => sameSet(x, LJ.value), (x) => sameSet(x, LJ.today)), detail: `statuses listed: value ${json(WP5.O5.receivableList.value)}, today ${json(WP5.O5.receivableList.today)} (goods-receipt.service.js:196-197 against :365)` });
};

// -- J: J7, the closes (O2, O3) ------------------------------------------------------------------------------------------------
const jCloses = async () => {
  const j = ctx.j;
  const O = j.orders;
  const reason = (what) => `CERT3 WP5 ${what} ${h.STAMP}`;
  const statusOf = async (key) => (await poOf('procurement', j.P, O[key].id)).status;
  // J-C (partial): cancel, close, force without and with a reason
  const cancel = await poAct('procurement', O['J-C'].id, 'cancel', { reason: reason('J-C cancelled after a delivery') });
  const cAfterCancel = await statusOf('J-C');
  const O3 = WP5.O3.cancelAfterDelivery;
  const cancelValue = CONTRACT['HR-C8'].cancelCode || saidOf(O3);
  const o3o = { said: h.said(cancel), status: cAfterCancel };
  ka('KA.O3.cancelAfterDelivery', { ref: O3.ref, value: O3.value, today: O3.today, observed: o3o, verdict: judge(o3o, (x) => x.said === cancelValue && x.status === WP5.O2.statusAfterPartial.value, (x) => x.said === saidOfToday(O3) && x.status === WP5.O2.statusAfterPartial.value), detail: 'the code is unreachable live at HEAD: assertTransition answers first (WP5-PREP fact 4, BOOK-G15)' });
  const co = await poAct('procurement', O['J-C'].id, 'close', {});
  rec('O2.J.closeOutstanding', h.is(co, saidOf(WP5.O2.closeOutstanding)) && sameJson(co.body?.error?.details?.lines ?? null, [1]) && (await statusOf('J-C')) === WP5.O2.statusAfterPartial.value, { expected: { said: saidOf(WP5.O2.closeOutstanding), lines: [1] }, observed: { said: h.said(co), lines: co.body?.error?.details?.lines ?? null }, detail: 'the catcher of M-PCLg (writes only on J)' });
  const fn = await poAct('procurement', O['J-C'].id, 'close', { force: true });
  rec('O2.J.forceNoReason', h.is(fn, saidOf(WP5.O2.forceNoReason)), { expected: saidOf(WP5.O2.forceNoReason), observed: h.said(fn), detail: 'the catcher of M-PCLgb' });
  const fw = await poAct('procurement', O['J-C'].id, 'close', { force: true, reason: reason('J-C closed short') });
  const cAfterForce = await statusOf('J-C');
  const FW = WP5.O2.forceWithReason;
  const fwo = { said: h.said(fw), status: cAfterForce };
  ka('KA.O2.forceWithReason', { ref: FW.ref, value: FW.value, today: FW.today, observed: fwo, verdict: judge(fwo, (x) => x.said === '200' && x.status === FW.value, (x) => x.said === saidOfToday(FW) && x.status === WP5.O2.statusAfterPartial.value), detail: 'no partial -> closed row at HEAD (purchase-order.service.js:116-125)' });
  const RA = WP5.O2.receiveAfterClose;
  let rao;
  if (cAfterForce === FW.value) {
    const jc = jRow(JB.orders, 'ref', 'J-C');
    const r = await receipt('warehouse', O['J-C'], [rline(O['J-C'], 0, WP5.O2.ordered.value - WP5.O2.received.value, { item: jc.lines[0].item, bin: 'J-B02' })]);
    rao = { sent: true, said: h.said(r), status: cAfterForce };
  } else {
    rao = { sent: false, said: null, status: cAfterForce };
  }
  ka('KA.O2.receiveAfterClose', { ref: RA.ref, value: RA.value, today: RA.today, observed: rao, verdict: judge(rao, (x) => x.sent && x.said === saidOf(RA), (x) => !x.sent && x.status === WP5.O2.statusAfterPartial.value), detail: 'sent only once J-C reads closed; the code is shown at HEAD on J-ISS (O2.J.issued.receiveAfterClose)' });
  // PO-A' (received in full): close without force
  const fr = await poAct('procurement', O["PO-A'"].id, 'close', { reason: reason("PO-A' delivered in full") });
  const aAfter = await statusOf("PO-A'");
  const FR = WP5.O2.fullyReceivedClose;
  const fro = { said: h.said(fr), status: aAfter };
  ka('KA.O2.fullyReceivedClose', { ref: FR.ref, value: FR.value, today: FR.today, observed: fro, verdict: judge(fro, (x) => x.said === '200' && x.status === FR.value, (x) => x.said === saidOfToday(FR) && x.status === 'received'), detail: 'no received -> closed row at HEAD' });
  // J-ISS (issued, nothing received): the closes HEAD allows, then a receipt
  const ic = await poAct('procurement', O['J-ISS'].id, 'close', {});
  rec('O2.J.issued.closeOutstanding', h.is(ic, saidOf(WP5.O2.closeOutstanding)) && (await statusOf('J-ISS')) === 'issued', { expected: { said: saidOf(WP5.O2.closeOutstanding), status: 'issued' }, observed: { said: h.said(ic), lines: ic.body?.error?.details?.lines ?? null }, detail: 'the catcher of M-PCLg / M-PCLga' });
  const ifn = await poAct('procurement', O['J-ISS'].id, 'close', { force: true });
  rec('O2.J.issued.forceNoReason', h.is(ifn, saidOf(WP5.O2.forceNoReason)), { expected: saidOf(WP5.O2.forceNoReason), observed: h.said(ifn), detail: 'the catcher of M-PCLgb' });
  const ifw = await poAct('procurement', O['J-ISS'].id, 'close', { force: true, reason: reason('J-ISS no longer needed') });
  const issAfter = await statusOf('J-ISS');
  rec('O2.J.issued.forceWithReason', h.said(ifw) === '200' && issAfter === WP5.closeBeforeDelivery.issuedForceClose.value, { expected: { said: '200', status: WP5.closeBeforeDelivery.issuedForceClose.value }, observed: { said: h.said(ifw), status: issAfter }, detail: 'the catcher of M-PCL0 / M-PCL0i (writes only on J)' });
  const ir = await receipt('warehouse', O['J-ISS'], [rline(O['J-ISS'], 0, jRow(JB.orders, 'ref', 'J-ISS').lines[0].qty, { item: 'J-INV1', bin: 'J-B02' })]);
  rec('O2.J.issued.receiveAfterClose', h.is(ir, saidOf(WP5.closeBeforeDelivery.receiveAfterClose)), { expected: saidOf(WP5.closeBeforeDelivery.receiveAfterClose), observed: h.said(ir), detail: 'J-ISS has no item: the receipt names J-INV1 (a refused receipt settles its item first)' });
  // J-ACKC (acknowledged, nothing received): force with a reason
  const kfw = await poAct('procurement', O['J-ACKC'].id, 'close', { force: true, reason: reason('J-ACKC no longer needed') });
  const ackcAfter = await statusOf('J-ACKC');
  rec('O2.J.ack.forceWithReason', h.said(kfw) === '200' && ackcAfter === WP5.closeBeforeDelivery.ackForceClose.value, { expected: { said: '200', status: WP5.closeBeforeDelivery.ackForceClose.value }, observed: { said: h.said(kfw), status: ackcAfter }, detail: 'the catcher of M-PCL0 / M-PCL0k (writes only on J)' });
  obs.hrc8 = { cancel: o3o, forceWithReason: fwo, receiveAfterClose: rao, fullyReceivedClose: fro };
};

// -- J: J8, the activity delete (D-FUN-1) ---------------------------------------------------------------------------------------
const jDelete = async () => {
  const j = ctx.j;
  const O = j.orders;
  const figure = (o) => ({ lines: (o?.lines || []).length, value: cents(o?.value) });
  const del2Before = figure(await poOf('procurement', j.P, O['J-DEL2'].id));
  const del1Before = figure(await poOf('procurement', j.P, O['J-DEL1'].id));
  const del = await send('planner', 'DELETE', `${j.P}/activities/${j.acts['J-A-DEL']}`);
  need(del.status === 200, `J8: J-A-DEL could not be deleted (${h.said(del)} ${del.body?.error?.message || ''})`);
  const del1After = figure(await poOf('procurement', j.P, O['J-DEL1'].id));
  const sub = await poAct('procurement', O['J-DEL1'].id, 'submit');
  rec('O1.J.submitNoLines', h.is(sub, saidOf(WP5.O1.submitNoLines)) && del1After.lines === 0, { expected: { said: saidOf(WP5.O1.submitNoLines), lines: 0 }, observed: { said: h.said(sub), before: del1Before, after: del1After }, detail: 'the activity-delete cascade emptied J-DEL1 (schema.prisma:3206; BOOK-G6)' });
  const del2After = figure(await poOf('procurement', j.P, O['J-DEL2'].id));
  obs.dfun1 = { deleted: h.said(del), del2Before, del2After, del1Before, del1After };
};

// -- J: J9, inventory (N) ----------------------------------------------------------------------------------------------------
const stockMove = (who, verb, body) => send(who, 'POST', `/inventory/stock/${verb}`, body);
const movementIds = (res) => listOf(res.body?.data?.movements).map((m) => m.id);
const movementValue = (res) => listOf(res.body?.data?.movements).reduce((s, m) => s + (cents(m.value) ?? NaN), 0);
/** The usage quantities the choreography sends on the plan row (WP5.J.choreography J9: "usage 50 ... usage 70"). */
const USAGE = (() => {
  const text = WP5.J.choreography.value.find((s) => /^J9 /.test(s)) || '';
  const first = Number((/usage (\d+) -> KA\.N6\.usage50/.exec(text) || [])[1]);
  const second = Number((/usage (\d+) -> N6\.J\.usage70/.exec(text) || [])[1]);
  if (!Number.isInteger(first) || !Number.isInteger(second)) throw new Error('answer book: WP5.J.choreography J9 names no usage quantities');
  return { first, second };
})();
const jInventory = async () => {
  const j = ctx.j;
  const site = j.wh['J-SITE'];
  const ref = (what) => `C3W5-${what}-${h.STAMP}`;
  const M = JB.stock.movements;
  const F = JB.stock.figures;
  const code0201 = j.codes['02-100'];
  const cemId = j.items[M.cement.item].id;
  const a130 = j.acts[JB.fixture.planRow.activity];

  await h.section('J: J9 N1 the cement (issue, reserve, the available guard, release) and N6', async () => {
    // N1.J.existing: stage 4 on J (G20)
    const poA = await poOf('procurement', j.P, j.orders["PO-A'"].id);
    const poB = await poOf('procurement', j.P, j.orders["PO-B'"].id);
    const before = itemFigures(await itemOf('warehouse', cemId));
    const i60 = await stockMove('site', 'issue', { itemId: cemId, warehouseId: site, quantity: M.cement.issue, activityId: a130, projectId: j.id, reference: ref('CEM-ISS-60'), notes: 'CERT3 WP5 N1' });
    const i60Ledger = sumCents(await ledgerEntries('cost', j.P, { activityId: a130, sourceIds: movementIds(i60) }));
    const after60 = itemFigures(await itemOf('warehouse', cemId));
    const codeOf = (o) => ({ value: cents(o.value), activity: (o.lines || [])[0]?.activityId === a130 ? JB.fixture.planRow.activity : (o.lines || [])[0]?.activityId ?? null, costCode: (o.lines || [])[0]?.costCodeId === code0201 ? '02-100' : (o.lines || [])[0]?.costCodeId ?? null });
    const n1o = { poA: codeOf(poA), poB: codeOf(poB), received: before.onHand, averageCost: before.averageCost, issue: h.said(i60), issue60Cost: movementValue(i60), ledger: i60Ledger, onHand: after60.onHand, value: after60.value };
    const jAct = (k) => `J-${STAGE4_167[k].value}`;
    const n1e = {
      poA: { value: STAGE4_170['PO-A.value'].value, activity: jAct('PO-A.line.activity'), costCode: STAGE4_167['PO-A.line.costCode'].value },
      poB: { value: STAGE4_170['PO-B.value'].value, activity: jAct('PO-B.line.activity'), costCode: STAGE4_167['PO-B.line.costCode'].value },
      received: F.cement.received, averageCost: STAGE4_170.weightedAverage.value, issue: '201', issue60Cost: STAGE4_170.issue60Cost.value, ledger: STAGE4_170.issue60Cost.value,
      onHand: WP5.existing.stockOnHand.value, value: WP5.existing.stockValue.value,
    };
    rec('N1.J.existing', sameJson(n1o, n1e), { expected: n1e, observed: n1o, detail: 'stage 4\'s PO-A / PO-B and the issue of 60 re-derived on J (G20): the activity is J\'s counterpart of the book\'s A130' });
    // reserve 50
    const rs = await send('site', 'POST', '/inventory/stock/reserve', { itemId: cemId, warehouseId: site, quantity: M.cement.reserve, reference: ref('CEM-RES'), notes: 'CERT3 WP5 N1 reserve' });
    const rso = { said: h.said(rs), onHand: num(rs.body?.data?.onHand), reserved: num(rs.body?.data?.reserved), available: num(rs.body?.data?.available) };
    const rse = { said: '200', onHand: WP5.existing.stockOnHand.value, reserved: M.cement.reserve, available: WP5.N1.availableAfterReserve.value };
    rec('N1.J.reserve', sameJson(rso, rse), { expected: rse, observed: rso });
    // issue 41: warehouse-level, then naming the bin
    const i41 = await stockMove('site', 'issue', { itemId: cemId, warehouseId: site, quantity: M.cement.issue41, activityId: a130, projectId: j.id, reference: ref('CEM-ISS-41'), notes: 'CERT3 WP5 N1 issue 41' });
    const after41 = itemFigures(await itemOf('warehouse', cemId));
    rec('N1.J.issue41', h.is(i41, saidOf(WP5.N1.issue41)) && after41.onHand === WP5.existing.stockOnHand.value, { expected: { said: saidOf(WP5.N1.issue41), onHand: WP5.existing.stockOnHand.value }, observed: { said: h.said(i41), onHand: after41.onHand, issued: movementValue(i41) }, detail: 'the catcher of M-AVL / M-AVLa (writes only on J)' });
    const i41b = await stockMove('site', 'issue', { itemId: cemId, warehouseId: site, locationId: j.bins['J-B01'], quantity: M.cement.issue41, activityId: a130, projectId: j.id, reference: ref('CEM-ISS-41-BIN'), notes: 'CERT3 WP5 N1 issue 41 from J-B01' });
    const after41b = itemFigures(await itemOf('warehouse', cemId));
    rec('N1.J.issue41bin', h.is(i41b, saidOf(WP5.N1.issue41)) && after41b.onHand === WP5.existing.stockOnHand.value, { expected: { said: saidOf(WP5.N1.issue41), onHand: WP5.existing.stockOnHand.value }, observed: { said: h.said(i41b), onHand: after41b.onHand }, detail: 'the catcher of M-AVL / M-AVLb (writes only on J)' });
    // issue 40, release 51
    const i40 = await stockMove('site', 'issue', { itemId: cemId, warehouseId: site, quantity: M.cement.issue40, activityId: a130, projectId: j.id, reference: ref('CEM-ISS-40'), notes: 'CERT3 WP5 N1 issue 40' });
    const after40 = itemFigures(await itemOf('warehouse', cemId));
    const i40o = { said: h.said(i40), value: movementValue(i40), costPosted: i40.body?.data?.costPosted ?? null, end: { onHand: after40.onHand, reserved: after40.reserved, available: after40.available } };
    const i40e = { said: '201', value: WP5.N1.issue40Cost.value, costPosted: true, end: F.cement.end };
    rec('N1.J.issue40', sameJson(i40o, i40e), { expected: i40e, observed: i40o });
    const r51 = await send('site', 'POST', '/inventory/stock/reserve', { itemId: cemId, warehouseId: site, quantity: -M.cement.release, reference: ref('CEM-REL-51'), notes: 'CERT3 WP5 N1 release 51' });
    rec('N1.J.release51', h.is(r51, saidOf(WP5.N1.release51)), { expected: saidOf(WP5.N1.release51), observed: h.said(r51) });
    // J-BLK: no target; a cost code only
    const blk = j.items[M.blocks.item];
    const nt = await stockMove('site', 'issue', { itemId: blk.id, warehouseId: site, quantity: M.blocks.noTargetProbe, reference: ref('BLK-NT'), notes: 'CERT3 WP5 N1 no target' });
    rec('N1.J.noTarget', h.is(nt, saidOf(WP5.N1.noTarget)), { expected: saidOf(WP5.N1.noTarget), observed: h.said(nt) });
    const r0 = reconFigures(await recon('cost', j.P));
    const cc = await stockMove('site', 'issue', { itemId: blk.id, warehouseId: site, quantity: M.blocks.toCostCodeOnly, costCodeId: code0201, reference: ref('BLK-CC'), notes: 'CERT3 WP5 N1 cost code only' });
    const r1 = reconFigures(await recon('cost', j.P));
    const ccMoves = listOf(cc.body?.data?.movements);
    const cco = { said: h.said(cc), costPosted: cc.body?.data?.costPosted ?? null, costNote: Boolean(cc.body?.data?.costNote), onProject: ccMoves.some((m) => m.projectId), ledgerDelta: r1.ledgerTotal - r0.ledgerTotal };
    const cce = { said: '201', costPosted: WP5.N1.costCodeOnly.value, costNote: true, onProject: false, ledgerDelta: 0 };
    rec('N1.J.costCodeOnly', sameJson(cco, cce), { expected: cce, observed: cco });
    // N6: the plan row after the issue of 60; usage
    const planRows = listOf(await dataOf('planner', `${j.P}/activities/${a130}/materials`), 'materials');
    const row = planRows.find((r) => r.id === j.planRow) || null;
    const iq = { issuedQty: num(row?.issuedQty) };
    obs.n6 = { planRow: row ? { qty: num(row.qty), receivedQty: num(row.receivedQty), issuedQty: num(row.issuedQty), consumedQty: num(row.consumedQty) } : null };
    const IQ = WP5.N6.issuedQty;
    ka('KA.N6.issuedQty', { ref: IQ.ref, value: IQ.value, today: IQ.today, observed: iq, verdict: judge(iq, (x) => x.issuedQty === IQ.value, (x) => x.issuedQty === IQ.today), detail: 'a stock issue never writes ActivityMaterial.issuedQty (HR-C7)' });
    const usage = (qty) => send('site', 'POST', `${j.P}/activities/${a130}/materials/${j.planRow}/usage`, { usedQty: qty, notes: `CERT3 WP5 N6 usage ${qty} ${h.STAMP}` });
    const u50 = await usage(USAGE.first);
    const U5 = WP5.N6.usage50;
    const u5o = { said: h.said(u50) };
    ka('KA.N6.usage50', { ref: U5.ref, value: U5.value, today: U5.today, observed: u5o, verdict: judge(u5o, (x) => statusPart(x.said) === U5.value, (x) => x.said === saidOfToday(U5)), detail: `usage ${USAGE.first}; the leaf\'s value reads 200 (the route answers a recorded usage 201: materials.js:157)` });
    const u70 = await usage(USAGE.second);
    rec('N6.J.usage70', h.is(u70, saidOf(WP5.N6.usage70)), { expected: saidOf(WP5.N6.usage70), observed: { said: h.said(u70), qty: USAGE.second } });
  });

  await probe('KA.N2 (J9: J-SAND, J-GRAVEL)', async () => {
    const N2 = WP5.N2;
    const sand = M.sand;
    const sandId = j.items[sand.item].id;
    const rcv = await stockMove('warehouse', 'receive', { itemId: sandId, warehouseId: site, locationId: j.bins['J-B02'], quantity: sand.receipt[0], unitCost: sand.receipt[1], projectId: j.id, reference: ref('SAND-RCV'), notes: 'CERT3 WP5 N2' });
    if (rcv.status !== 201) throw probeSetup('KA.N2.returnNeverIssued', `the J-SAND receipt answered ${h.said(rcv)}`);
    const r0 = reconFigures(await recon('cost', j.P));
    const ret = await stockMove('site', 'return', { itemId: sandId, warehouseId: site, locationId: j.bins['J-B02'], quantity: sand.returned, projectId: j.id, costCodeId: code0201, reference: ref('SAND-RET'), notes: 'CERT3 WP5 N2 a return never issued' });
    const r1 = reconFigures(await recon('cost', j.P));
    const sandNow = itemFigures(await itemOf('warehouse', sandId));
    const rni = { said: h.said(ret) };
    ka('KA.N2.returnNeverIssued', { ref: N2.returnNeverIssued.ref, value: N2.returnNeverIssued.value, today: N2.returnNeverIssued.today, observed: rni, verdict: judge(rni, (x) => statusPart(x.said) === N2.returnNeverIssued.value.status, (x) => x.said === '201'), detail: 'the project and 02-100 named, no activity (no cost record can go below zero); today \'accepted\'' });
    kaLeaf('KA.N2.stockAfterRefusal', N2.stockAfterRefusal, { qty: sandNow.onHand, valueCents: sandNow.value });
    kaLeaf('KA.N2.projectCostAfterRefusal', N2.projectCostAfterRefusal, r1.ledgerTotal - r0.ledgerTotal, { detail: 'J\'s ledger total across the return (GET /cost/reconciliation)' });
    const gr = M.gravel;
    const grId = j.items[gr.item].id;
    const a310 = j.acts['J-A310'];
    const grc = await stockMove('warehouse', 'receive', { itemId: grId, warehouseId: site, locationId: j.bins['J-B02'], quantity: gr.receipt[0], unitCost: gr.receipt[1], projectId: j.id, reference: ref('GRV-RCV'), notes: 'CERT3 WP5 N2' });
    const gis = await stockMove('site', 'issue', { itemId: grId, warehouseId: site, quantity: gr.issued, activityId: a310, costCodeId: code0201, projectId: j.id, reference: ref('GRV-ISS'), notes: 'CERT3 WP5 N2' });
    if (grc.status !== 201 || gis.status !== 201) throw probeSetup('N2.J.activityAfterReturn4', `the J-GRAVEL receipt / issue answered ${h.said(grc)} / ${h.said(gis)}`);
    const rt4 = await stockMove('site', 'return', { itemId: grId, warehouseId: site, locationId: j.bins['J-B02'], quantity: gr.returned, activityId: a310, costCodeId: code0201, projectId: j.id, reference: ref('GRV-RET-4'), notes: 'CERT3 WP5 N2 return 4' });
    const a310Total = sumCents(await ledgerEntries('cost', j.P, { activityId: a310 }));
    rec('N2.J.activityAfterReturn4', h.said(rt4) === '201' && a310Total === WP5.N2.activityAfterReturn4.value && a310Total === F.gravel.activityAfterReturn4, { expected: { said: '201', activity: WP5.N2.activityAfterReturn4.value }, observed: { said: h.said(rt4), activity: a310Total } });
    const r30 = await stockMove('site', 'return', { itemId: grId, warehouseId: site, locationId: j.bins['J-B02'], quantity: gr.returnedMore, projectId: j.id, costCodeId: code0201, reference: ref('GRV-RET-30'), notes: 'CERT3 WP5 N2 return 30, the project only' });
    const r3o = { status: statusPart(h.said(r30)) };
    const R3 = N2.return30After10;
    ka('KA.N2.return30After10', { ref: R3.ref, value: R3.value, today: R3.today, observed: { said: h.said(r30) }, verdict: judge(r3o, (x) => x.status === R3.value.status, (x) => x.status === R3.today.status), detail: 'named the project only: no activity, so no cost record goes below zero (L36 predicts a 500 otherwise; never sent)' });
  });

  await probe('KA.N3 (J9: J-PIPE)', async () => {
    const pp = M.pipe;
    const id = j.items[pp.item].id;
    const a220 = j.acts['J-A220'];
    const r1 = await stockMove('warehouse', 'receive', { itemId: id, warehouseId: site, locationId: j.bins['J-B02'], quantity: pp.receipts[0][0], unitCost: pp.receipts[0][1], projectId: j.id, reference: ref('PIPE-RCV-1'), notes: 'CERT3 WP5 N3' });
    const iss = await stockMove('site', 'issue', { itemId: id, warehouseId: site, quantity: pp.issued, activityId: a220, costCodeId: code0201, projectId: j.id, reference: ref('PIPE-ISS'), notes: 'CERT3 WP5 N3' });
    const r2 = await stockMove('warehouse', 'receive', { itemId: id, warehouseId: site, locationId: j.bins['J-B02'], quantity: pp.receipts[1][0], unitCost: pp.receipts[1][1], projectId: j.id, reference: ref('PIPE-RCV-2'), notes: 'CERT3 WP5 N3' });
    if (![r1, iss, r2].every((r) => r.status === 201)) throw probeSetup('KA.N3.credit', `the J-PIPE receipts / issue answered ${[r1, iss, r2].map((r) => h.said(r)).join(' / ')}`);
    const ret = await stockMove('site', 'return', { itemId: id, warehouseId: site, locationId: j.bins['J-B02'], quantity: pp.returned, activityId: a220, costCodeId: code0201, projectId: j.id, reference: ref('PIPE-RET'), notes: 'CERT3 WP5 N3 return 5' });
    const credit = -sumCents(await ledgerEntries('cost', j.P, { activityId: a220, sourceIds: movementIds(ret) }));
    const activity = sumCents(await ledgerEntries('cost', j.P, { activityId: a220 }));
    const pipe = itemFigures(await itemOf('warehouse', id));
    obs.n3 = { said: h.said(ret), credit, activity, stock: { qty: pipe.onHand, valueCents: pipe.value } };
    kaLeaf('KA.N3.credit', WP5.N3.credit, credit, { detail: `the return answered ${h.said(ret)}; credited at the current average (X-FINANCE-1)` });
    kaLeaf('KA.N3.activity', WP5.N3.activity, activity);
    kaLeaf('KA.N3.stock', WP5.N3.stock, { qty: pipe.onHand, valueCents: pipe.value }, { detail: 'the second return is not sent (BOOK-G7, CERT-5)' });
  });

  await h.section('J: J9 N4 the transfer, N5 the quarantine, N7 the refusals, L199', async () => {
    const c3 = M.cem3;
    const c3Item = j.items[c3.item];
    const yard = j.wh['J-YARD'];
    const rcv = await stockMove('warehouse', 'receive', { itemId: c3Item.id, warehouseId: site, locationId: j.bins['J-B02'], quantity: c3.receipt[0], unitCost: c3.receipt[1], projectId: j.id, reference: ref('CEM3-RCV'), notes: 'CERT3 WP5 N4' });
    need(rcv.status === 201, `J9: the J-CEM3 receipt answered ${h.said(rcv)}`);
    const made = await send('warehouse', 'POST', '/inventory/transfers', { fromWarehouseId: site, toWarehouseId: yard, reason: `CERT3 WP5 J-T1 ${h.STAMP}`, lines: [{ itemId: c3Item.id, quantity: c3.transfer }] });
    const tId = made.status === 201 ? made.body?.data?.id || null : null;
    const tRef = made.body?.data?.ref ?? null;
    const lineId = made.body?.data?.lines?.[0]?.id ?? null;
    need(Boolean(tId && lineId), `J9: transfer J-T1 could not be made (${h.said(made)})`);
    const dsp = await send('warehouse', 'POST', `/inventory/transfers/${tId}/dispatch`, {});
    need(dsp.status === 200 && dsp.body?.data?.status === 'in_transit', `J9: J-T1's dispatch answered ${h.said(dsp)}`);
    const transferNow = async () => listOf(await dataOf('warehouse', '/inventory/transfers')).find((t) => t.id === tId) || null;
    const over = await send('warehouse', 'POST', `/inventory/transfers/${tId}/receive`, { lines: [{ id: lineId, receivedQty: c3.overProbe[0], damagedQty: c3.overProbe[1] }] });
    const afterOver = (await transferNow())?.status ?? null;
    rec('N4.J.overReceipt', h.is(over, saidOf(WP5.N4.overReceipt)) && afterOver === 'in_transit', { expected: { said: saidOf(WP5.N4.overReceipt), status: 'in_transit' }, observed: { said: h.said(over), status: afterOver } });
    const ok = await send('warehouse', 'POST', `/inventory/transfers/${tId}/receive`, { lines: [{ id: lineId, receivedQty: c3.received, damagedQty: c3.damaged }] });
    need(ok.status === 200, `J9: J-T1's receipt answered ${h.said(ok)}`);
    const moves = (await movesOf('warehouse', c3Item.id)).filter((x) => x.reference === tRef);
    const sum = (rows) => rows.reduce((s, x) => s + (cents(x.value) ?? NaN), 0);
    const sent = sum(moves.filter((x) => x.type === 'transfer_out'));
    const writtenOff = sum(moves.filter((x) => x.warehouseId === yard && ['damage', 'adjust'].includes(x.type)));
    const item = itemFigures(await itemOf('warehouse', c3Item.id));
    const yardOnHand = (await stockOf('warehouse', c3Item.sku)).filter((b) => b.warehouseId === yard).reduce((s, b) => s + (Number(b.onHand) || 0), 0);
    const receivedValue = Number.isInteger(item.averageCost) ? yardOnHand * item.averageCost : null;
    const n4o = { sentValue: sent, receivedValue, writtenOff, conserved: sent === receivedValue + writtenOff, inTransit: item.inTransit };
    const n4e = { sentValue: WP5.N4.sentValue.value, receivedValue: WP5.N4.receivedValue.value, writtenOff: WP5.N4.writtenOff.value, conserved: WP5.N4.conserved.value, inTransit: 0 };
    rec('N4.J.values', sameJson(n4o, n4e), { expected: n4e, observed: { ...n4o, yardOnHand, movements: moves.map((x) => `${x.type} ${x.quantity} ${x.value}`) } });
    const again = await send('warehouse', 'POST', `/inventory/transfers/${tId}/receive`, { lines: [{ id: lineId, receivedQty: c3.received, damagedQty: c3.damaged }] });
    rec('N4.J.receiveAgain', h.is(again, saidOf(WP5.N4.receiveAgain)), { expected: saidOf(WP5.N4.receiveAgain), observed: h.said(again) });
    // N5: quarantine at J-B02, release over it, release
    const atBin = async () => (await stockOf('warehouse', c3Item.sku)).find((b) => b.warehouseId === site && b.locationId === j.bins['J-B02']) || {};
    const before = await atBin();
    const q = await stockMove('warehouse', 'quarantine', { itemId: c3Item.id, warehouseId: site, locationId: j.bins['J-B02'], quantity: c3.quarantine, projectId: j.id, reference: ref('CEM3-QTN'), notes: 'CERT3 WP5 N5 held for a test certificate' });
    need(q.status === 201, `J9: the quarantine of J-CEM3 answered ${h.said(q)}`);
    const r6 = await stockMove('warehouse', 'release', { itemId: c3Item.id, warehouseId: site, locationId: j.bins['J-B02'], quantity: c3.releaseProbe, projectId: j.id, reference: ref('CEM3-REL-6'), notes: 'CERT3 WP5 N5 release 6' });
    rec('N5.J.releaseOverQuarantine', h.is(r6, saidOf(WP5.N5.releaseOverQuarantine)), { expected: saidOf(WP5.N5.releaseOverQuarantine), observed: h.said(r6) });
    const r5 = await stockMove('warehouse', 'release', { itemId: c3Item.id, warehouseId: site, locationId: j.bins['J-B02'], quantity: c3.quarantine, projectId: j.id, reference: ref('CEM3-REL-5'), notes: 'CERT3 WP5 N5 release 5' });
    const after = await atBin();
    const n5o = { said: h.said(r5), onHand: num(after.onHand), quarantined: num(after.quarantined), restored: num(after.onHand) === num(before.onHand) };
    const n5e = { said: '201', onHand: c3.receipt[0] - c3.transfer, quarantined: 0, restored: true };
    rec('N5.J.release5', sameJson(n5o, n5e), { expected: n5e, observed: n5o, detail: `WP5.N5.release5 '${WP5.N5.release5.value}'` });
    // N7
    const adj = await stockMove('warehouse', 'adjust', { itemId: c3Item.id, warehouseId: site, locationId: j.bins['J-B02'], quantity: 1, projectId: j.id, reference: ref('CEM3-ADJ') });
    rec('N7.J.adjustNoNotes', h.is(adj, saidOf(WP5.N7.adjustNoNotes)), { expected: saidOf(WP5.N7.adjustNoNotes), observed: h.said(adj) });
    const d0 = itemFigures(await itemOf('warehouse', c3Item.id));
    const dmg = await stockMove('warehouse', 'receive', { itemId: c3Item.id, warehouseId: site, locationId: j.bins['J-B02'], quantity: c3.damageProbe[0], unitCost: c3.receipt[1], damagedQty: c3.damageProbe[1], projectId: j.id, reference: ref('CEM3-DMG'), notes: 'CERT3 WP5 N7' });
    const d1 = itemFigures(await itemOf('warehouse', c3Item.id));
    rec('N7.J.damageOverReceipt', h.is(dmg, saidOf(WP5.N7.damageOverReceipt)) && d1.onHand === d0.onHand && d1.damaged === d0.damaged, { expected: { said: saidOf(WP5.N7.damageOverReceipt), unchanged: true }, observed: { said: h.said(dmg), before: d0, after: d1 } });
    // L199: one issue body twice
    const gr = M.gravel;
    const grId = j.items[gr.item].id;
    const dupRef = ref('J-DUP');
    const body = { itemId: grId, warehouseId: site, quantity: gr.duplicateIssue, activityId: j.acts['J-A310'], costCodeId: code0201, projectId: j.id, reference: dupRef, notes: 'CERT3 WP5 L199 the same body twice' };
    const s1 = await stockMove('site', 'issue', body);
    const s2 = await stockMove('site', 'issue', body);
    const movements = (await movesOf('warehouse', grId, 'issue')).filter((x) => x.reference === dupRef).length;
    obs.l199 = { statuses: [statusPart(h.said(s1)), statusPart(h.said(s2))], movements };
    obs.reconJ = { ...(obs.reconJ || {}), afterN: reconFigures(await recon('cost', j.P)) };
  });
};

// -- J: J10, bids and the award (R) ---------------------------------------------------------------------------------------------
const bidRoute = (pkgId) => `${ctx.j.P}/bids/${pkgId}`;
const pkgOf = async (pkgId) => dataOf('procurement', bidRoute(pkgId));
const bidsOf = async (pkgId) => listOf(await dataOf('procurement', `${bidRoute(pkgId)}/bids`));
const commitmentsTitled = async (title) => listOf(await dataOf('qs', `${ctx.j.P}/commitments`), 'commitments').filter((c) => c.title === title);
/** How long a J package is open for bids (WP5.J.bids J-BP1: "dueAt 30 min ahead"). */
const DUE_MIN = Number((/(\d+) min/.exec(jRow(JB.bids, 'pkg', 'J-BP1').madeBy) || [])[1]);
if (!Number.isInteger(DUE_MIN) || DUE_MIN <= 0) throw new Error('answer book: WP5.J.bids J-BP1 names no due time in minutes');
const dueAhead = () => new Date(Date.now() + DUE_MIN * 60_000).toISOString();
/** Adds the J-B003 line to a package and codes it as the book's line (activity, cost code, budget line). */
const lineUp = async (pkgId, bookLine) => {
  const j = ctx.j;
  const add = await send('procurement', 'POST', `${bidRoute(pkgId)}/lines/from-boq`, { boqItemIds: [j.boq[bookLine.boqRow]] });
  const line = ((await pkgOf(pkgId)).lines || []).find((l) => l.boqItemId === j.boq[bookLine.boqRow]) || null;
  const coded = line ? await send('procurement', 'PATCH', `${bidRoute(pkgId)}/lines/${line.id}`, { activityId: j.acts[bookLine.activity], costCodeId: j.codes[bookLine.costCode], budgetLineId: j.lines[bookLine.budgetLine] }) : null;
  return { add: h.said(add), lineId: line?.id ?? null, qty: num(line?.qty), unit: line?.unit ?? null, coded: coded ? h.said(coded) : null };
};
const lineUpOk = (ln, bookLine) => ln.add === '200' && ln.coded === '200' && Boolean(ln.lineId) && ln.qty === bookLine.qty;
/** A bidder's portal token from the resend's answer (an open package only); kept in memory, never recorded. */
const tokenFor = async (pkgId, invitationId) => {
  const res = await send('procurement', 'POST', `${bidRoute(pkgId)}/invitations/${invitationId}/resend`, {});
  return { said: h.said(res), token: res.status === 200 ? tokenOf(res.body?.data?.portalUrl) : null };
};
const priceBid = async (token, lineId, rateCents, label, { submit = true } = {}) => {
  const saved = await portal('PUT', token, '/bid', { lines: [{ packageLineId: lineId, rate: units(rateCents), included: true, note: `CERT3 WP5 ${label}` }], leadTimeDays: 14, validityDays: 30, notes: `CERT3 WP5 ${label} ${h.STAMP}` });
  const sent = submit && saved.status === 200 ? await portal('POST', token, '/bid/submit', { submittedBy: `Estimator CERT3 WP5 ${label}` }) : null;
  return { saved: h.said(saved), submitted: sent ? h.said(sent) : null, status: sent?.body?.data?.status ?? null };
};
const confirmRoute = (pkgId) => `${bidRoute(pkgId)}/award/confirm`;
const awardBody = (bidId, title) => ({ ...(bidId ? { bidId } : {}), title, retentionRate: 0, startDate: dayFromNow(0), endDate: dayFromNow(120) });
/** The coding fields an order line carries, and whether each carried one is the package line's. */
const codingOf = (line, expect) => {
  const fields = ['costCodeId', 'budgetLineId', 'boqItemId', 'activityId'].filter((f) => line?.[f]);
  return { fields, matches: fields.every((f) => line[f] === expect[f]) };
};

const jBids = async () => {
  const j = ctx.j;
  const bp1 = jRow(JB.bids, 'pkg', 'J-BP1');
  const bidOf = (row, bidder) => jRow(row.bids, 'bidder', bidder);
  j.bp1States = [];
  await h.section('J: J10 J-PP1 / J-BP1, the award, the orders (R1-R5)', async () => {
    const pp = await send('procurement', 'POST', `${j.P}/procurement/packages`, { packageNumber: `C3W5-PP1-${h.STAMP}`, title: `CERT3 WP5 J-PP1 rebar ${h.STAMP}`, description: `CERT3 WP5 J-PP1 ${h.STAMP}`, activityId: j.acts[bp1.line.activity], status: 'tendering', buyer: `Buyer CERT3 WP5 ${h.STAMP}`, requiredTiming: 'activity_start', leadWeeks: 2, bufferDays: 7, notes: `CERT3 WP5 J-PP1 ${h.STAMP}` });
    const ppId = pp.status === 201 ? pp.body?.data?.id || null : null;
    need(Boolean(ppId), `J10: J-PP1 could not be made (${h.said(pp)})`);
    j.pp1 = ppId;
    const q = await send('procurement', 'POST', `${j.P}/procurement/packages/${ppId}/quotes`, { title: `CERT3 WP5 J-BP1 ${h.STAMP}`, description: `CERT3 WP5 J-BP1: price ${bp1.line.qty} ${bp1.line.unit}`, instructions: 'Quote per tonne', dueAt: dueAhead() });
    const id = q.status === 201 ? q.body?.data?.id || null : null;
    need(Boolean(id), `J10: J-BP1 could not be made (${h.said(q)})`);
    j.bp1 = id;
    j.bp1States.push((await pkgOf(id)).status);
    const ln = await lineUp(id, bp1.line);
    need(lineUpOk(ln, bp1.line), `J10: J-BP1's line ${json(ln)}`);
    const wdMail = h.mail('jwd', 'bidders.c087.octapm-cert.test');
    const adMail = h.mail('jadhoc', 'bidders.c087.octapm-cert.test');
    const inv = await send('procurement', 'POST', `${bidRoute(id)}/invitations`, { invitations: [{ vendorCompanyId: j.vendors['J-QUAL'].id }, { companyName: `CERT3 WP5 J-WD ${h.STAMP}`, contactName: 'Estimator CERT3 WP5 J-WD', contactEmail: wdMail }, { companyName: `CERT3 WP5 J-ADHOC ${h.STAMP}`, contactName: 'Estimator CERT3 WP5 J-ADHOC', contactEmail: adMail }] });
    const invRows = listOf(inv.body?.data);
    const invOf = { 'J-QUAL': invRows.find((r) => r.vendorCompanyId === j.vendors['J-QUAL'].id)?.id, 'J-WD': invRows.find((r) => r.contactEmail === wdMail)?.id, 'J-ADHOC': invRows.find((r) => r.contactEmail === adMail)?.id };
    need(inv.status === 201 && Object.values(invOf).every(Boolean), `J10: J-BP1's invitations answered ${h.said(inv)}`);
    const pub = await send('procurement', 'POST', `${bidRoute(id)}/publish`, {});
    need(pub.status === 200, `J10: J-BP1's publish answered ${h.said(pub)}`);
    j.bp1States.push((await pkgOf(id)).status);
    const tok = {};
    for (const key of Object.keys(invOf)) { tok[key] = await tokenFor(id, invOf[key]); need(Boolean(tok[key].token), `J10: J-BP1 ${key}'s link (${tok[key].said})`); }
    const qual = await priceBid(tok['J-QUAL'].token, ln.lineId, bidOf(bp1, 'J-QUAL').rate, 'J-QUAL');
    const wd1 = await priceBid(tok['J-WD'].token, ln.lineId, bidOf(bp1, 'J-WD').rate, 'J-WD');
    const wdW = await portal('POST', tok['J-WD'].token, '/bid/withdraw', {});
    const wd2 = await priceBid(tok['J-WD'].token, ln.lineId, bidOf(bp1, 'J-WD').rate, 'J-WD again');
    const adhoc = await priceBid(tok['J-ADHOC'].token, ln.lineId, bidOf(bp1, 'J-ADHOC').rate, 'J-ADHOC');
    const list = await bidsOf(id);
    const bidFor = (key) => list.find((b) => b.invitationId === invOf[key]) || null;
    const wd = bidFor('J-WD');
    const wro = { first: wd1.submitted, withdrawn: `${h.said(wdW)} ${wdW.body?.data?.status ?? '-'}`, again: wd2.submitted, status: wd?.status ?? null, total: cents(wd?.total) };
    const wre = { first: '200', withdrawn: '200 withdrawn', again: '200', status: WP5.R1.withdrawResubmit.value, total: bidOf(bp1, 'J-WD').total };
    rec('R1.J.withdrawResubmit', sameJson(wro, wre), { expected: wre, observed: wro });
    need(qual.submitted === '200' && adhoc.submitted === '200' && wd?.status === 'submitted', `J10: J-BP1's bids ${json({ qual, adhoc, wd: wd?.status })}`);
    const cl = await send('procurement', 'POST', `${bidRoute(id)}/close`, {});
    need(cl.status === 200, `J10: J-BP1's close answered ${h.said(cl)}`);
    j.bp1States.push((await pkgOf(id)).status);
    const qBid = bidFor('J-QUAL');
    const sa = await send('pm', 'POST', `${bidRoute(id)}/award`, { bidId: qBid.id });
    need(sa.status === 200, `J10: J-BP1's soft award answered ${h.said(sa)}`);
    // R5: over the single-award limit, then on the override
    const title1 = `CERT3 WP5 J-BP1 award ${h.STAMP}`;
    const body = awardBody(qBid.id, title1);
    const ol = await send('pm', 'POST', confirmRoute(id), body);
    const d = ol.body?.error?.details || {};
    const olo = { said: h.said(ol), details: { status: d.status ?? null, singleAwardLimit: cents(d.singleAwardLimit), amount: cents(d.amount) }, commitments: (await commitmentsTitled(title1)).length };
    const ole = { said: saidOf(WP5.R5.overLimit), details: WP5.R5.overLimitDetails.value, commitments: 0 };
    rec('R5.J.overLimit', sameJson(olo, ole), { expected: ole, observed: olo, detail: 'the details answer currency units, compared in cents' });
    const reason = `CERT3 WP5 J-BP1: the PM awards over J-QUAL's single-award limit ${h.STAMP}`;
    const ov = await send('pm', 'POST', confirmRoute(id), { ...body, prequalOverrideReason: reason });
    const cId = ov.body?.data?.commitment?.id ?? null;
    const cm = cId ? await dataOf('qs', `${j.P}/commitments/${cId}`) : null;
    const pkgNow = await pkgOf(id);
    const events = await auditEvents('pm', j.P, `entityType=bid_package&entityId=${id}`);
    const OV = WP5.R5.overLimitOverride.value;
    const ovo = { status: statusPart(h.said(ov)), packageStatus: pkgNow.status, commitmentStatus: cm?.status ?? null, commitmentOriginal: cents(cm?.original), auditReason: events.some((e) => e.reason === reason) };
    const ove = { status: OV.status, packageStatus: OV.packageStatus, commitmentStatus: OV.commitmentStatus, commitmentOriginal: OV.commitmentOriginal, auditReason: true };
    rec('R5.J.overLimitOverride', sameJson(ovo, ove), { expected: ove, observed: ovo, detail: `WP5.R5.overLimitOverride.value.auditReason: ${OV.auditReason}` });
    j.bp1States.push(pkgNow.status);
    // R2: the same confirm again (M-AWD0)
    const again = await send('pm', 'POST', confirmRoute(id), { ...body, prequalOverrideReason: reason });
    const fromBp1 = (await commitmentsTitled(title1)).length;
    rec('R2.J.confirmAgain', h.is(again, saidOf(WP5.R2.confirmAgain)) && fromBp1 === 1, { expected: { said: saidOf(WP5.R2.confirmAgain), commitments: 1 }, observed: { said: h.said(again), commitments: fromBp1 }, detail: 'the catcher of M-AWD0 (under it: 400 BID_NOT_FOUND, nothing written)' });
    // R3: the order raised from the award, then again
    const ord = (n) => send('procurement', 'POST', `${j.P}/procurement/packages/${ppId}/order`, { ref: `C3W5-AWARD${n}-${h.STAMP}`, requiredBy: dayFromNow(40), leadWeeks: 2, notes: `CERT3 WP5 order ${n} from J-PP1 ${h.STAMP}` });
    const o1r = await ord(1);
    const o1 = o1r.status === 201 ? await poOf('procurement', j.P, o1r.body?.data?.id) : null;
    const AO = JB.awardOrder;
    const actKey = (aid) => Object.entries(j.acts).find(([, v]) => v === aid)?.[0] ?? aid;
    const r3o = { said: h.said(o1r), value: cents(o1?.value), status: o1?.status ?? null, supplier: o1?.supplier ?? null, lines: (o1?.lines || []).map((l) => ({ activity: actKey(l.activityId), qty: num(l.orderedQty), unit: l.unit, unitCost: cents(l.unitCost) })) };
    const r3e = { said: '201', value: AO.value, status: AO.status, supplier: `CERT3 WP5 ${AO.supplier} ${h.STAMP}`, lines: AO.lines.map((l) => ({ activity: l.activity, qty: l.qty, unit: l.unit, unitCost: l.unitCost })) };
    rec('R3.J.firstOrder', sameJson(r3o, r3e), { expected: r3e, observed: r3o });
    const LC = WP5.R4.lineCoding;
    const expectCoding = { costCodeId: j.codes[bp1.line.costCode], budgetLineId: j.lines[bp1.line.budgetLine], boqItemId: j.boq[bp1.line.boqRow], activityId: j.acts[bp1.line.activity] };
    const lc = codingOf((o1?.lines || [])[0], expectCoding);
    obs.r4J = lc;
    ka('KA.R4.lineCoding.J', { ref: LC.ref, value: LC.value, today: LC.today, observed: lc, verdict: judge(lc, (x) => sameSet(x.fields, LC.value) && x.matches, (x) => sameSet(x.fields, LC.today) && x.matches), detail: 'the award line map (procurement.service.js:1805-1819) against the J-BP1 line\'s coding' });
    const o2r = await ord(2);
    const onPkg = listOf(await dataOf('procurement', `${j.P}/procurement/purchase-orders`)).filter((o) => o.packageId === ppId).length;
    const so = { said: h.said(o2r), ordersOnPackage: onPkg };
    obs.r3 = so;
    const SO = WP5.R3.secondOrder;
    const rc = CONTRACT['AWARD-ONE-ORDER'].refusalStatusCode;
    ka('KA.R3.secondOrder', { ref: SO.ref, value: SO.value, today: SO.today, observed: so, verdict: judge(so, (x) => statusPart(x.said) === SO.value.status && (rc ? x.said === rc : true) && x.ordersOnPackage === 1, (x) => x.said === '201' && x.ordersOnPackage === 2), detail: 'the code is the fix\'s (F-2): only the status is judged until it names one' });
  });

  if (wants('KA.R2.concurrentConfirms', 'CF.awardAtomic')) await probe('KA.R2.concurrentConfirms (J10: J-BP2)', async () => {
    const bp2 = jRow(JB.bids, 'pkg', 'J-BP2');
    const mk = await send('procurement', 'POST', `${j.P}/bids`, { title: `CERT3 WP5 J-BP2 ${h.STAMP}`, description: 'CERT3 WP5 J-BP2', dueAt: dueAhead(), currency: JB.project.currency, commitmentType: 'purchase_order' });
    const id = mk.status === 201 ? mk.body?.data?.id || null : null;
    if (!id) throw probeSetup('KA.R2.concurrentConfirms', `J-BP2 answered ${h.said(mk)}`);
    const ln = await lineUp(id, bp2.line);
    if (!lineUpOk(ln, bp2.line)) throw probeSetup('KA.R2.concurrentConfirms', `J-BP2's line ${json(ln)}`);
    const inv = await send('procurement', 'POST', `${bidRoute(id)}/invitations`, { invitations: [{ vendorCompanyId: j.vendors['J-QUAL'].id }] });
    const invId = listOf(inv.body?.data)[0]?.id;
    const pub = await send('procurement', 'POST', `${bidRoute(id)}/publish`, {});
    const tk = invId && pub.status === 200 ? await tokenFor(id, invId) : { token: null };
    const pr = tk.token ? await priceBid(tk.token, ln.lineId, bp2.bids[0].rate, 'J-QUAL on J-BP2') : { submitted: null };
    const cl = pr.submitted === '200' ? await send('procurement', 'POST', `${bidRoute(id)}/close`, {}) : null;
    const bid = (await bidsOf(id))[0] || null;
    const sa = cl?.status === 200 && bid ? await send('pm', 'POST', `${bidRoute(id)}/award`, { bidId: bid.id }) : null;
    if (sa?.status !== 200) throw probeSetup('KA.R2.concurrentConfirms', `J-BP2's set-up ${json({ invite: h.said(inv), publish: h.said(pub), bid: pr.submitted, close: cl ? h.said(cl) : null, softAward: sa ? h.said(sa) : null })}`);
    const title2 = `CERT3 WP5 J-BP2 award ${h.STAMP}`;
    const body = awardBody(bid.id, title2);
    const answers = await Promise.all([send('pm', 'POST', confirmRoute(id), body), send('pm', 'POST', confirmRoute(id), body)]);
    const made = await commitmentsTitled(title2);
    const loser = CONTRACT['AWARD-ATOMIC'].loserCode || saidOf(WP5.R2.confirmAgain);
    const o = { confirms: answers.length, ok2xx: answers.filter((a) => a.status >= 200 && a.status < 300).length, conflict409: answers.filter((a) => h.said(a) === loser).length, commitments: made.length, commitmentStatus: [...new Set(made.map((c) => c.status))].sort().join(',') || null, answers: answers.map((a) => h.said(a)) };
    obs.r2 = o;
    const R2 = WP5.R2.concurrentConfirms;
    ka('KA.R2.concurrentConfirms', { ref: R2.ref, value: R2.value, today: R2.today, observed: o, verdict: judge(o, (x) => x.confirms === R2.value.confirms && x.ok2xx === R2.value.ok2xx && x.conflict409 === R2.value.conflict409 && x.commitments === R2.value.commitments, (x) => x.ok2xx === R2.today.ok2xx && x.conflict409 === R2.today.conflict409 && x.commitments === R2.today.commitments && x.commitmentStatus === R2.today.commitmentStatus), detail: 'two confirms sent together in process (one tick); racy: one shot, never retried (PREP4-ADJUDICATION B5); a lucky single success at HEAD reads value and is recorded' });
  });

  if (wants('R1.J.publishPastDue', 'R1.J.inviteOnDraft', 'R1.J.confirmNoBid', 'R5.J.expired', 'R1.J.states')) await probe('J-BP3 (J10: the past due date, the resend on a draft, no bid, the lapsed cover)', async () => {
    const bp3 = jRow(JB.bids, 'pkg', 'J-BP3');
    const mk = await send('procurement', 'POST', `${j.P}/bids`, { title: `CERT3 WP5 J-BP3 ${h.STAMP}`, description: 'CERT3 WP5 J-BP3', dueAt: new Date(Date.now() - 86_400_000).toISOString(), currency: JB.project.currency, commitmentType: 'purchase_order' });
    const id = mk.status === 201 ? mk.body?.data?.id || null : null;
    if (!id) throw probeSetup('R1.J.publishPastDue', `J-BP3 answered ${h.said(mk)}`);
    j.bp3 = id;
    const ln = await lineUp(id, bp3.line);
    const inv = await send('procurement', 'POST', `${bidRoute(id)}/invitations`, { invitations: [{ vendorCompanyId: j.vendors['J-EXP'].id }], prequalOverrideReason: `CERT3 WP5 J-BP3: J-EXP invited on the PM's decision ${h.STAMP}` });
    const invId = listOf(inv.body?.data)[0]?.id;
    if (!lineUpOk(ln, bp3.line) || inv.status !== 201 || !invId) throw probeSetup('R1.J.publishPastDue', `J-BP3's line / invitation ${json({ ln, invite: h.said(inv) })}`);
    const pp = await send('procurement', 'POST', `${bidRoute(id)}/publish`, {});
    const after = (await pkgOf(id)).status;
    rec('R1.J.publishPastDue', h.is(pp, saidOf(WP5.R1.publishPastDue)) && after === 'draft', { expected: { said: saidOf(WP5.R1.publishPastDue), status: 'draft' }, observed: { said: h.said(pp), status: after } });
    const rs = await send('procurement', 'POST', `${bidRoute(id)}/invitations/${invId}/resend`, {});
    rec('R1.J.inviteOnDraft', h.is(rs, saidOf(WP5.R1.inviteOnDraft)), { expected: saidOf(WP5.R1.inviteOnDraft), observed: h.said(rs), detail: 'the resend on a draft (BOOK-G22)' });
    const due = await send('procurement', 'PATCH', bidRoute(id), { dueAt: dueAhead() });
    const pub = await send('procurement', 'POST', `${bidRoute(id)}/publish`, {});
    const tk = pub.status === 200 ? await tokenFor(id, invId) : { token: null };
    const pr = tk.token ? await priceBid(tk.token, ln.lineId, bp3.bids[0].rate, 'J-EXP on J-BP3') : { submitted: null };
    const cl = pr.submitted === '200' ? await send('procurement', 'POST', `${bidRoute(id)}/close`, {}) : null;
    if (due.status !== 200 || cl?.status !== 200) throw probeSetup('R1.J.confirmNoBid', `J-BP3's set-up ${json({ due: h.said(due), publish: h.said(pub), bid: pr.submitted, close: cl ? h.said(cl) : null })}`);
    const title3 = `CERT3 WP5 J-BP3 award ${h.STAMP}`;
    const nb = await send('pm', 'POST', confirmRoute(id), awardBody(null, title3));
    const nbMade = (await commitmentsTitled(title3)).length;
    rec('R1.J.confirmNoBid', h.is(nb, saidOf(WP5.R1.confirmNoBid)) && nbMade === 0, { expected: { said: saidOf(WP5.R1.confirmNoBid), commitments: 0 }, observed: { said: h.said(nb), commitments: nbMade } });
    const bid = (await bidsOf(id))[0] || null;
    const sa = bid ? await send('pm', 'POST', `${bidRoute(id)}/award`, { bidId: bid.id }) : null;
    if (sa?.status !== 200) throw probeSetup('R5.J.expired', `J-BP3's soft award answered ${sa ? h.said(sa) : 'not sent (no bid)'}`);
    const wait = Date.parse(j.lapseAt) + 2000 - Date.now();
    if (wait > 0) { console.log(`waiting ${Math.round(wait / 1000)} s for J-EXP's insurance cover to lapse (WP5ADJ Q10)`); await h.sleep(wait); }
    const ex = await send('pm', 'POST', confirmRoute(id), awardBody(bid.id, title3));
    const exo = { said: h.said(ex), details: { status: ex.body?.error?.details?.status ?? null }, commitments: (await commitmentsTitled(title3)).length };
    const exe = { said: saidOf(WP5.R5.expired), details: WP5.R5.expiredDetails.value, commitments: 0 };
    rec('R5.J.expired', sameJson(exo, exe), { expected: exe, observed: exo, detail: `J-EXP's cover lapsed at ${j.lapseAt} (assumption A-3)` });
    const cn = await send('procurement', 'DELETE', bidRoute(id), { reason: `CERT3 WP5 J-BP3 cancelled ${h.STAMP}` });
    j.bp3Cancelled = { said: h.said(cn), status: (await pkgOf(id)).status, from: 'closed' };
  });

  if (wants('R1.J.states')) await h.section('J: J10 R1.J.states', async () => {
    const sto = { bp1: j.bp1States, bp3: j.bp3Cancelled ? { said: j.bp3Cancelled.said, status: j.bp3Cancelled.status } : null };
    const ste = { bp1: WP5.R1.packageStates.value, bp3: { said: '200', status: 'cancelled' } };
    rec('R1.J.states', sameJson(sto, ste), { expected: ste, observed: sto, detail: 'J-BP3 is cancelled from closed (WP5.J.bids J-BP3: "cancelled from closed")' });
  });
};

// -- J: J11, direct costs, the ledger and the match (D) ---------------------------------------------------------------------
const dcRoute = (id) => `${ctx.j.P}/direct-costs/${id}`;
const dcOf = async (id) => dataOf('cost', dcRoute(id));
const dcAct = (who, id, verb, body = {}) => send(who, 'POST', `${dcRoute(id)}/${verb}`, body);
/** A J direct cost line from its book row: the book's activity and cost code, its order line where it bills one. */
const dcLine = (row, l, order) => {
  const j = ctx.j;
  const costType = FIXTURE.costTypeOf[l.costCode];
  const blKey = `${l.costCode}/${costType}`;
  return {
    description: `${l.what} (CERT3 WP5 ${row.ref})`,
    costCodeId: j.codes[l.costCode],
    ...(j.lines[blKey] ? { budgetLineId: j.lines[blKey] } : {}),
    activityId: j.acts[l.activity],
    costType,
    quantity: l.qty,
    unit: l.unit,
    unitCost: units(l.unitCost),
    amount: units(l.amount),
    ...(l.onOrderLine && order ? { poLineId: order.lineIds[0] } : {}),
  };
};
const dcBody = (row, { lines, label = row.ref } = {}) => {
  const j = ctx.j;
  const order = row.order ? j.orders[row.order] : null;
  return {
    type: row.type,
    description: `CERT3 WP5 ${label} ${h.STAMP}`,
    costDate: FIXTURE.costDate,
    ...(row.type === 'invoice' ? { vendorCompanyId: ctx.dir.supplier.id, invoiceNumber: `C3W5-${refKey(label)}-${h.STAMP}`, purchaseOrderId: order.id } : { vendorName: `CERT3 WP5 payee ${h.STAMP}` }),
    notes: `CERT3 WP5 ${label}`,
    lines: lines !== undefined ? lines : row.lines.map((l) => dcLine(row, l, order)),
  };
};
/** A direct cost made by the cost controller (and submitted when asked): its id; a setup error if it cannot be made. */
const makeDc = async (row, { submit = true, label = row.ref, lines } = {}) => {
  const mk = await send('cost', 'POST', `${ctx.j.P}/direct-costs`, dcBody(row, { lines, label }));
  const id = mk.status === 201 ? mk.body?.data?.id || null : null;
  need(Boolean(id), `J11: ${label} could not be made (${h.said(mk)} ${mk.body?.error?.message || ''})`);
  if (submit) { const sb = await dcAct('cost', id, 'submit'); need(sb.status === 200 && sb.body?.data?.status === 'pending', `J11: ${label}'s submit answered ${h.said(sb)}`); }
  return id;
};
const matchOfInvoice = async (id) => dataOf('warehouse', `/inventory/match/invoice/${id}`);
const firstWord = (text) => String(text).split(/[\s(]/)[0];

const jDirectCosts = async () => {
  const j = ctx.j;
  const DC = (ref) => jRow(JB.directCosts, 'ref', ref);
  await h.section('J: J11 D1 the states, D2 the ledger and the void, D3 payments', async () => {
    // D1 on J-DC1
    const r1 = DC('J-DC1');
    const id1 = await makeDc(r1, { submit: false, lines: [] });
    const e = await dcAct('cost', id1, 'submit');
    rec('D1.J.emptySubmit', h.is(e, saidOf(WP5.D1.emptySubmit)), { expected: saidOf(WP5.D1.emptySubmit), observed: h.said(e) });
    const l0 = r1.lines[0];
    const un = await send('cost', 'PATCH', dcRoute(id1), { lines: [{ description: `${l0.what} uncoded (CERT3 WP5 J-DC1)`, quantity: l0.qty, unit: l0.unit, unitCost: units(l0.unitCost), amount: units(l0.amount) }] });
    need(un.status === 200, `J11: J-DC1's uncoded line answered ${h.said(un)}`);
    const u = await dcAct('cost', id1, 'submit');
    rec('D1.J.uncodedSubmit', h.is(u, saidOf(WP5.D1.uncodedSubmit)), { expected: saidOf(WP5.D1.uncodedSubmit), observed: h.said(u) });
    const ad = await dcAct('finance', id1, 'approve');
    rec('D1.J.approveDraft', h.is(ad, saidOf(WP5.D1.approveDraft)), { expected: saidOf(WP5.D1.approveDraft), observed: h.said(ad) });
    const cd = await send('cost', 'PATCH', dcRoute(id1), { lines: r1.lines.map((l) => dcLine(r1, l, null)) });
    const s3 = cd.status === 200 ? await dcAct('cost', id1, 'submit') : null;
    need(s3?.status === 200, `J11: J-DC1's coded resubmission answered ${h.said(cd)} / ${s3 ? h.said(s3) : '-'}`);
    const rn = await dcAct('finance', id1, 'reject', {});
    rec('D1.J.returnNoReason', h.is(rn, saidOf(WP5.D1.returnNoReason)), { expected: saidOf(WP5.D1.returnNoReason), observed: h.said(rn), detail: 'the route asks for a reason first (routes/direct-costs.js:59)' });
    const why = `CERT3 WP5 J-DC1 returned: attach the timesheet ${h.STAMP}`;
    const rr = await dcAct('finance', id1, 'reject', { reason: why });
    const afterR = await dcOf(id1);
    const ed = await send('cost', 'PATCH', dcRoute(id1), { notes: `CERT3 WP5 J-DC1 edited after the return ${h.STAMP}` });
    const s4 = await dcAct('cost', id1, 'submit');
    const afterS = await dcOf(id1);
    const rso = { returned: h.said(rr), status: afterR.status, rejectedReason: afterR.rejectedReason === why, edited: h.said(ed), resubmitted: h.said(s4), statusAfter: afterS.status };
    const rse = { returned: '200', status: WP5.D1.returnedState.value, rejectedReason: true, edited: '200', resubmitted: '200', statusAfter: 'pending' };
    rec('D1.J.returnedState', sameJson(rso, rse), { expected: rse, observed: rso });
    const dp = await send('cost', 'DELETE', dcRoute(id1));
    rec('D1.J.deletePending', h.is(dp, saidOf(WP5.D1.deletePending)), { expected: saidOf(WP5.D1.deletePending), observed: h.said(dp) });
    const ap = await dcAct('finance', id1, 'approve');
    need(ap.status === 200, `J11: J-DC1's approval answered ${h.said(ap)}`);
    const pa = await send('cost', 'PATCH', dcRoute(id1), { notes: `CERT3 WP5 J-DC1 an edit after approval ${h.STAMP}` });
    rec('D1.J.patchApproved', h.is(pa, saidOf(WP5.D1.patchApproved)), { expected: saidOf(WP5.D1.patchApproved), observed: h.said(pa) });
    // D2: J-DC2 approved, three keyed entries (M-DCK)
    const r2 = DC('J-DC2');
    const id2 = await makeDc(r2);
    const ap2 = await dcAct('finance', id2, 'approve');
    need(ap2.status === 200, `J11: J-DC2's approval answered ${h.said(ap2)}`);
    const act2 = j.acts[r2.lines[0].activity];
    const dc2 = await dcOf(id2);
    const e2 = await ledgerEntries('cost', j.P, { activityId: act2, sourceIds: [id2] });
    const d2o = { total: sumCents(e2), entries: e2.length, perLine: sameSet(e2.map((x) => x.sourceLineId), (dc2.lines || []).map((l) => l.id)), amounts: e2.map((x) => cents(x.amount)).sort((a, b) => a - b) };
    const d2e = { total: WP5.D2.ledger.value, entries: WP5.D2.entryCount.value, perLine: true, amounts: r2.lines.map((l) => l.amount).sort((a, b) => a - b) };
    rec('D2.J.ledger', sameJson(d2o, d2e), { expected: d2e, observed: d2o, detail: 'the catcher of M-DCK: one entry per line (cost-ledger.service.js:113-114)' });
    // D2: void, void again
    const vd = await dcAct('finance', id2, 'void', { reason: `CERT3 WP5 J-DC2 booked twice ${h.STAMP}` });
    const all = await ledgerEntries('cost', j.P, { activityId: act2, sourceIds: [id2] });
    const rev = all.filter((x) => x.isReversal === true);
    const dc2v = await dcOf(id2);
    const vo = { said: h.said(vd), reversals: rev.length, reversed: sumCents(rev), net: sumCents(all), status: dc2v.status, posted: (dc2v.lines || []).map((l) => cents(l.postedAmount)) };
    const ve = { said: '200', reversals: WP5.D2.entryCount.value, reversed: WP5.D2.voidMirror.value, net: 0, status: 'void', posted: r2.lines.map(() => 0) };
    rec('D2.J.voidMirror', sameJson(vo, ve), { expected: ve, observed: vo });
    const va = await dcAct('finance', id2, 'void', { reason: `CERT3 WP5 J-DC2 again ${h.STAMP}` });
    rec('D2.J.voidAgain', h.is(va, saidOf(WP5.D2.voidAgain)), { expected: saidOf(WP5.D2.voidAgain), observed: h.said(va) });
    // D3: J-DC4 payments
    const r4 = DC('J-DC4');
    const id4 = await makeDc(r4);
    const ap4 = await dcAct('finance', id4, 'approve');
    need(ap4.status === 200, `J11: J-DC4's approval answered ${h.said(ap4)}`);
    const pay = (amountCents, ref) => send('finance', 'POST', `${dcRoute(id4)}/payments`, { amount: units(amountCents), paidAt: `${D3_PAID_AT}T09:00:00.000Z`, method: 'bank_transfer', reference: `C3W5-${ref}-${h.STAMP}`, note: `CERT3 WP5 ${ref}` });
    const po = await pay(r4.total + 1, 'DC4-OVER');
    rec('D3.J.payOver', h.is(po, saidOf(WP5.D3.payOver)), { expected: saidOf(WP5.D3.payOver), observed: { said: h.said(po), amount: r4.total + 1 } });
    const pf = await pay(r4.total, 'DC4-PAY');
    const dc4 = await dcOf(id4);
    rec('D3.J.payFull', h.said(pf) === '201' && dc4.status === WP5.D3.payFull.value, { expected: { said: '201', status: WP5.D3.payFull.value }, observed: { said: h.said(pf), status: dc4.status, paidAt: D3_PAID_AT } });
    const vp = await dcAct('finance', id4, 'void', { reason: `CERT3 WP5 J-DC4 void after payment ${h.STAMP}` });
    rec('D3.J.voidPaid', h.is(vp, saidOf(WP5.D3.voidPaid)), { expected: saidOf(WP5.D3.voidPaid), observed: h.said(vp) });
    const flow = await dataOf('cost', `${j.P}/cash-flow`);
    const month = (flow?.monthly || []).find((m) => m.period === D3_PAID_AT.slice(0, 7)) || { outflow: 0 };
    rec('D3.J.cashOutflow', cents(month.outflow) === WP5.D3.cashOutflow.value, { expected: { period: D3_PAID_AT.slice(0, 7), outflow: WP5.D3.cashOutflow.value }, observed: { outflow: cents(month.outflow), months: (flow?.monthly || []).map((m) => `${m.period} ${m.outflow}`) }, detail: 'no rebuild sent by the proof (the payment rebuilds the projection itself, direct-cost.service.js:608)' });
  });

  await h.section(`J: J11 D2 two approvals at once, ${FIXTURE.d2Rounds} rounds (M-DCL)`, async () => {
    const r3 = DC('J-DC3');
    const rounds = [];
    const conflict = saidOf(WP5.D1.approveDraft);
    for (let n = 1; n <= FIXTURE.d2Rounds; n += 1) {
      const id = await makeDc(r3, { label: `J-DC3 round ${n}` });
      const answers = await Promise.all([dcAct('finance', id, 'approve'), dcAct('finance', id, 'approve')]);
      const entries = await ledgerEntries('cost', j.P, { activityId: j.acts[r3.lines[0].activity], sourceIds: [id] });
      rounds.push({ round: n, answers: answers.map((a) => h.said(a)).sort(), entries: entries.length, posted: sumCents(entries) });
    }
    const want = ['200', conflict].sort();
    const ok = rounds.length === FIXTURE.d2Rounds && rounds.every((r) => sameJson(r.answers, want) && r.entries === WP5.D2.concurrentApprove.value.postings && r.posted === r3.total);
    obs.d2Rounds = rounds;
    rec('D2.J.concurrentApprove', ok, { expected: { perRound: { answers: want, postings: WP5.D2.concurrentApprove.value.postings, conflict409: WP5.D2.concurrentApprove.value.conflict409, posted: r3.total }, rounds: FIXTURE.d2Rounds }, observed: rounds, detail: 'two approvals sent together in process each round; green only if every round is (WP5ADJ Q8); the catcher of M-DCL' });
  });

  await probe('KA.D4.J.invoiceBeforeReceipt (J11: J-STK)', async () => {
    const row = DC('J-STK-INV');
    const orow = jRow(JB.orders, 'ref', row.order);
    const order = j.orders[row.order];
    const id = await makeDc(row);
    const ap = await dcAct('finance', id, 'approve');
    const rc = ap.status === 200 ? await receipt('warehouse', order, [rline(order, 0, orow.lines[0].qty, { item: orow.lines[0].item, bin: 'J-B02' })]) : null;
    const iss = rc?.status === 201 ? await stockMove('site', 'issue', { itemId: j.items[orow.lines[0].item].id, warehouseId: j.wh['J-SITE'], quantity: orow.lines[0].qty, activityId: j.acts[orow.lines[0].activity], costCodeId: j.codes['02-100'], projectId: j.id, reference: `C3W5-MEM-ISS-${h.STAMP}`, notes: 'CERT3 WP5 D4' }) : null;
    if (iss?.status !== 201) throw probeSetup('KA.D4.J.invoiceBeforeReceipt', `J-STK ${json({ approve: h.said(ap), receipt: rc ? h.said(rc) : null, issue: iss ? h.said(iss) : null })}`);
    const total = sumCents(await ledgerEntries('cost', j.P, { activityId: j.acts[orow.lines[0].activity], sourceIds: [id, ...movementIds(iss)] }));
    obs.d4J = { total };
    kaLeaf('KA.D4.J.invoiceBeforeReceipt', WP5.D4.ledgerInvoiceBeforeReceipt, total, { detail: 'the invoice\'s direct_cost entries plus the issue\'s material_issue on J-A130 (L35, CERT-5)' });
  });

  await h.section('J: J11 D4 the control path, D5 the match and the approvals, D6, L119', async () => {
    // D4's control path: J-STK2 received in J6, invoiced (capitalised), issued
    const row = DC('J-STK2-INV');
    const orow = jRow(JB.orders, 'ref', row.order);
    const id = await makeDc(row);
    const ap = await dcAct('finance', id, 'approve');
    const iss = await stockMove('site', 'issue', { itemId: j.items[orow.lines[0].item].id, warehouseId: j.wh['J-SITE'], quantity: orow.lines[0].qty, activityId: j.acts[orow.lines[0].activity], costCodeId: j.codes['02-100'], projectId: j.id, reference: `C3W5-MEM2-ISS-${h.STAMP}`, notes: 'CERT3 WP5 D4 control' });
    const dcNow = await dcOf(id);
    const total = sumCents(await ledgerEntries('cost', j.P, { activityId: j.acts[orow.lines[0].activity], sourceIds: [id, ...movementIds(iss)] }));
    const cpo = { approve: h.said(ap), issue: h.said(iss), postedAmount: (dcNow.lines || []).map((l) => cents(l.postedAmount)), total };
    const cpe = { approve: '200', issue: '201', postedAmount: row.lines.map(() => 0), total: WP5.D4.controlPath.value };
    rec('D4.J.controlPath', sameJson(cpo, cpe), { expected: cpe, observed: cpo });
    // D5: J-INVA matched, J-VAR the price variance; the approvals; L107
    const ra = DC('J-INVA');
    const rv = DC('J-VAR');
    const idA = await makeDc(ra);
    const idV = await makeDc(rv);
    const r0 = reconFigures(await recon('cost', j.P));
    const apA = await dcAct('finance', idA, 'approve');
    const mA = await matchOfInvoice(idA);
    const mV = await matchOfInvoice(idV);
    const flagsV = (mV?.lines || []).flatMap((l) => l.flags || []);
    const pvo = { verdict: mV?.verdict ?? null, priceVariance: flagsV.filter((f) => f.code === 'price_variance').map((f) => f.severity) };
    rec('D5.J.priceVariance', pvo.verdict === WP5.D5.priceVarianceVerdict.value && sameJson(pvo.priceVariance, ['blocking']), { expected: { verdict: WP5.D5.priceVarianceVerdict.value, priceVariance: ['blocking'] }, observed: { ...pvo, unitCosts: (mV?.lines || []).map((l) => [l.orderedUnitCost, l.invoicedUnitCost]) } });
    const cemId = j.items[JB.stock.movements.cement.item].id;
    const cem0 = itemFigures(await itemOf('warehouse', cemId));
    const r1 = reconFigures(await recon('cost', j.P));
    const apV = await dcAct('finance', idV, 'approve');
    const r2 = reconFigures(await recon('cost', j.P));
    const cem1 = itemFigures(await itemOf('warehouse', cemId));
    const vNow = await dcOf(idV);
    const PV = WP5.D5.priceVarianceApproval;
    const pao = { said: h.said(apV), status: vNow.status };
    ka('KA.D5.priceVarianceApproval', { ref: PV.ref, value: PV.value, today: PV.today, observed: pao, verdict: judge(pao, (x) => is4xx(x.said) && x.status === 'pending', (x) => x.said === '200' && x.status === firstWord(PV.today)), detail: 'approveDirectCost never reads the match (HR-C5)' });
    obs.l107 = { stockValueDelta: cem1.value - cem0.value, ledgerDelta: r2.ledgerTotal - r1.ledgerTotal, recognised: (cem1.value - cem0.value) + (r2.ledgerTotal - r1.ledgerTotal), invoiced: cents(vNow.total), received: cents(mV?.totals?.received) };
    const S12 = (k) => WP5.existing[`stage12.${k}`].value;
    const mo = { invoiceA: cents((await dcOf(idA)).total), approveA: h.said(apA), verdictA: mA?.verdict ?? null, invoiceB: cents(vNow.total), varianceB: cents(mV?.totals?.invoiced) - cents(mV?.totals?.received), ledgerDelta: r2.ledgerTotal - r0.ledgerTotal };
    const me = { invoiceA: S12('invoiceA'), approveA: '200', verdictA: 'matched', invoiceB: S12('invoiceB'), varianceB: S12('varianceB'), ledgerDelta: S12('ledgerDelta') };
    rec('D5.J.matched', sameJson(mo, me), { expected: me, observed: mo, detail: 'stage 12 re-derived on J (G20); both invoices are on received stocked lines, so neither posts project cost' });
    // D5: J-SVC over-invoiced, both approved (BOOK-G3, WP5-SVC-1)
    const s1 = DC('J-SVC-INV1');
    const s2 = DC('J-SVC-INV2');
    const sid1 = await makeDc(s1);
    const sid2 = await makeDc(s2);
    const sa1 = await dcAct('finance', sid1, 'approve');
    const sa2 = await dcAct('finance', sid2, 'approve');
    const svcAct = j.acts[s1.lines[0].activity];
    const posted = sumCents(await ledgerEntries('cost', j.P, { activityId: svcAct, sourceIds: [sid1, sid2] }));
    const svcLine = lineFigures(await poOf('procurement', j.P, j.orders[s1.order].id));
    const postedAmounts = [...((await dcOf(sid1)).lines || []), ...((await dcOf(sid2)).lines || [])].map((l) => cents(l.postedAmount));
    obs.svc1 = { approvals: [h.said(sa1), h.said(sa2)], posted, svcLineItem: svcLine.inventoryItemId, postedAmounts };
    kaLeaf('KA.D5.overInvoicedLedger', WP5.D5.overInvoicedLedger, posted, { detail: `approvals ${h.said(sa1)} / ${h.said(sa2)}; J-SVC's line names an inventory item ${svcLine.inventoryItemId ? 'since its receipt' : 'none'} (WP5-SVC-1); the value needs service lines to stay service lines AND HR-C5 to refuse the second approval` });
    // D6: one order line at +10% plus a freight line with no poLineId
    const d6 = DC('J-D6INV');
    const id6 = await makeDc(d6, { submit: false });
    const m6 = await matchOfInvoice(id6);
    const D6 = WP5.D6.invoiceSideVerdict;
    const d6o = { verdict: m6?.verdict ?? null, flags: (m6?.flags || []).map((f) => f.code), lineFlags: (m6?.lines || []).flatMap((l) => (l.flags || []).map((f) => `${f.code}/${f.severity}`)) };
    ka('KA.D6.invoiceSideVerdict', { ref: D6.ref, value: D6.value, today: D6.today, observed: d6o, verdict: judge(d6o, (x) => x.verdict === D6.value, (x) => x.verdict === firstWord(D6.today)), detail: 'goods-receipt.service.js:1036 downgrades whenever a line lacks a poLineId (HR-C5)' });
    // L119: coded to a cost code with no budget line on J
    const l119 = DC('J-L119');
    const k0 = reconFigures(await recon('cost', j.P));
    const idL = await makeDc(l119);
    const apL = await dcAct('finance', idL, 'approve');
    const k1 = reconFigures(await recon('cost', j.P));
    obs.l119 = { approve: h.said(apL), ledgerDelta: k1.ledgerTotal - k0.ledgerTotal, budgetActualDelta: k1.budgetRecorded - k0.budgetRecorded };
    // D7: the reconciliation after J9 (when it ran) and now, after J11, the last write on J
    obs.reconJ = { ...(obs.reconJ || {}), afterD: reconFigures(await recon('cost', j.P)) };
    const points = obs.reconJ;
    const okPoint = (p) => Boolean(p) && p.balanced === WP5.D7.balanced.value && p.budgetVariances === 0 && p.activityVariances === 0;
    rec('D7.J.balanced', Object.values(points).every(okPoint) && okPoint(points.afterD), { expected: { balanced: WP5.D7.balanced.value, variances: 0, checkpoints: NEED_J9 ? ['afterN', 'afterD'] : ['afterD'] }, observed: points, detail: 'afterD is J\'s end state: nothing writes on J after J11 but its archive' });
  });
};

/** J's end: J archived (S.J.archived). */
const jEnd = async () => {
  const j = ctx.j;
  const a = await archive(j, 'J');
  rec('S.J.archived', a?.status === 200 && Boolean(a?.archivedAt), { observed: a, detail: `J ${j.id}` });
};

// -- 087-COM: the stored moments, the live reads and the refusals no WP-5 mutant turns into a write -------------------------
const comFlow = async () => {
  const st = ctx.state['087-COM'];
  const s = storedCom087(st);
  const { P, id: projectId087 } = ctx.deep['087-COM'];
  const stored = (id) => rec(id, s[id].ok === true, { expected: s[id].expected, observed: s[id].observed, detail: s[id].detail || '' });
  const pickKa = (k) => ({ value: k.value, today: k.today, observed: k.observed, verdict: k.verdict, storedAt: k.storedAt ?? null });
  stored('R1.stored.bids');
  stored('O2.stored.087');
  stored('N.stored.087');
  ka('KA.O2.stored.closeShort', { ref: WP5.O2.forceWithReason.ref, ...pickKa(s['KA.O2.stored.closeShort']), detail: 'stored at the build: 087-COM po.C.close-short (MOMENT-MAP row 144)' });
  ka('KA.O2.stored.closeReceived', { ref: WP5.O2.fullyReceivedClose.ref, ...pickKa(s['KA.O2.stored.closeReceived']), detail: 'stored at the build: 087-COM po.A.close-received (MOMENT-MAP row 144)' });
  obs.com087Findings = s.findings;
  const ids = { boq: outOf(st, 'boq').ids['B-003'], code: outOf(st, 'cost-codes').ids['02-100'], line: outOf(st, 'budget-lines').ids['02-100:material'], act: outOf(st, 'activities').ids.A130, a100: outOf(st, 'activities').ids.A100 };
  // R1: the package, its bids, the leveling, the gap
  const bids = outOf(st, 'bids');
  const pkg = await dataOf('procurement', `${P}/bids/${bids.bidPackageId}`);
  const keyOfInvitation = Object.fromEntries((pkg.invitations || []).map((i) => [i.id, BIDDERS_087.find((k) => i.contactEmail === bidderMail087(k)) || `other:${i.contactEmail}`]));
  const list = listOf(await dataOf('procurement', `${P}/bids/${bids.bidPackageId}/bids`));
  const statusBy = Object.fromEntries(list.map((b) => [keyOfInvitation[b.invitationId] || `other:${b.invitationId}`, b.status]));
  const priced = list.filter((b) => ['submitted', 'awarded', 'unsuccessful'].includes(b.status)).length;
  const po = { status: pkg.status, awardedBidId: pkg.awardedBidId === bids.awardedBidId, awardedCommitmentId: pkg.awardedCommitmentId === bids.commitmentId, bids: statusBy, priced };
  const pe = { status: WP5.R1.packageStates.value[WP5.R1.packageStates.value.length - 1], awardedBidId: true, awardedCommitmentId: true, bids: { emirates: 'awarded', gulf: 'unsuccessful', northern: 'unsuccessful', coastal: 'withdrawn' }, priced: D087.bidders.value };
  rec('R1.live.package', sameJson(po, pe), { expected: pe, observed: po, detail: 'the bidders named by the build\'s invitation e-mails (build/087-com.js BIDDERS); the late bid was refused, so it is not listed' });
  const lev = await dataOf('procurement', `${P}/bids/${bids.bidPackageId}/leveling`);
  const ranked = listOf(lev?.bidders, 'bidders').map((b) => ({ key: keyOfInvitation[b.invitationId], rank: b.rank, total: cents(b.total) })).sort((a, b) => a.rank - b.rank);
  const ro = { order: ranked.map((r) => r.key), totals: Object.fromEntries(ranked.map((r) => [r.key, r.total])), estimate: cents(lev?.estimateTotal) };
  const re = { order: WP5.R1.ranking.value, totals: { gulf: WP5.R1['bid.gulf.total'].value, northern: WP5.R1['bid.northern.total'].value, emirates: WP5.R1['bid.emirates.total'].value }, estimate: WP5.R1.estimate.value };
  rec('R1.live.ranking', sameJson(ro, re), { expected: re, observed: ro });
  const awardedKey = keyOfInvitation[list.find((b) => b.id === bids.awardedBidId)?.invitationId];
  const lowest = Math.min(...Object.values(ro.totals).filter((v) => Number.isInteger(v)));
  const gap = ro.totals[awardedKey] - lowest;
  rec('R1.live.gap', gap === WP5.R1.awardedNotLowestGap.value, { expected: WP5.R1.awardedNotLowestGap.value, observed: { awarded: awardedKey, awardedTotal: ro.totals[awardedKey] ?? null, lowest, gap } });
  // R1/R2: the award's commitment (BOOK-G2)
  const cm = await dataOf('qs', `${P}/commitments/${bids.commitmentId}`);
  const AC = WP5.R2.awardCommitment.value;
  const l0 = (cm.lines || [])[0] || {};
  const co = { status: cm.status, type: cm.type, original: cents(cm.original), retentionRate: num(cm.retentionRate), vendorEmirates: /Emirates Rebar Trading/.test(String(cm.vendor?.name || '')), lines: (cm.lines || []).length, line: { boqItem: l0.boqItemId === ids.boq ? 'B-003' : l0.boqItemId ?? null, costCode: l0.costCodeId === ids.code ? '02-100' : l0.costCodeId ?? null, budgetLine: l0.budgetLineId === ids.line ? '02-100/material' : l0.budgetLineId ?? null, activity: l0.activityId === ids.act ? 'A130' : l0.activityId ?? null, qty: num(l0.qty), unit: l0.unit ?? null, rate: cents(l0.rate), amount: cents(l0.amount) } };
  const ce = { status: AC.status, type: AC.type, original: AC.original, retentionRate: AC.retentionRate, vendorEmirates: true, lines: AC.sovLines.length, line: AC.sovLines[0] };
  rec('R1.live.commitment', sameJson(co, ce), { expected: ce, observed: co, detail: `WP5.R2.awardCommitment.value.vendor: ${AC.vendor}` });
  const cancel = await deepProbe('087-COM', 'procurement', 'DELETE', `${P}/bids/${bids.bidPackageId}`, { reason: `CERT3 WP5 proof: cancel an awarded package ${h.STAMP}` }, 'a cancel of the awarded package');
  const pkgAfter = (await dataOf('procurement', `${P}/bids/${bids.bidPackageId}`)).status;
  rec('R1.cancelAwarded', h.is(cancel, saidOf(WP5.R1.cancelAwarded)) && pkgAfter === 'awarded', { expected: { said: saidOf(WP5.R1.cancelAwarded), status: 'awarded' }, observed: { said: h.said(cancel), status: pkgAfter } });
  // R4: PO-AWARD
  const award = outOf(st, 'po.from-award');
  const apo = await poOf('procurement', P, award.id);
  const regRow = listOf(await dataOf('procurement', `${P}/procurement/purchase-orders`)).find((r) => r.id === award.id) || null;
  const r4o = { value: cents(apo.value), lines: (apo.lines || []).length, qty: num(apo.lines?.[0]?.orderedQty), unitCost: cents(apo.lines?.[0]?.unitCost), supplierEmirates: /Emirates Rebar Trading/.test(String(apo.supplier || '')), fromPackage: regRow?.packageId === bids.procurementPackageId };
  const r4e = { value: WP5.R4.awardPoValue.value, lines: 1, qty: AC.sovLines[0].qty, unitCost: AC.sovLines[0].rate, supplierEmirates: true, fromPackage: true };
  rec('R4.live.awardPoValue', sameJson(r4o, r4e), { expected: r4e, observed: r4o });
  const LC = WP5.R4.lineCoding;
  const lc = codingOf((apo.lines || [])[0], { costCodeId: ids.code, budgetLineId: ids.line, boqItemId: ids.boq, activityId: ids.act });
  obs.r4087 = lc;
  ka('KA.R4.lineCoding.087', { ref: LC.ref, value: LC.value, today: LC.today, observed: lc, verdict: judge(lc, (x) => sameSet(x.fields, LC.value) && x.matches, (x) => sameSet(x.fields, LC.today) && x.matches), storedAt: stepAt(st, 'po.from-award'), detail: 'a build record (step po.from-award): STORED-PRE-FIX once the AWARD-CODING fix is set' });
  // O: the register, PO-C, its two refusals, the receivable list
  const pos = outOf(st, 'purchase-orders');
  const statusOfPo = async (id) => (await poOf('procurement', P, id)).status;
  const leaf = D087.poStatuses.value;
  const closeDone = (step) => st.steps?.[step]?.status === 'done';
  const fromLeaf = (entry, step) => { const [before, after] = String(entry).split('->'); return closeDone(step) ? String(after).split(' ')[0] : before; };
  const ackOrder = await poOf('procurement', P, pos.ack.id);
  const so = { ack: ackOrder.status, ackReceived: lineFigures(ackOrder).received, x: await statusOfPo(pos.x.id), award: apo.status, c: await statusOfPo(pos.c.id), a: await statusOfPo(pos.a.id) };
  const se = { ack: leaf[2], ackReceived: 0, x: leaf[3], award: 'issued', c: fromLeaf(leaf[0], 'po.C.close-short'), a: fromLeaf(leaf[1], 'po.A.close-received') };
  rec('O.live.087.statuses', sameJson(so, se), { expected: se, observed: so, detail: `deep.087-COM.poStatuses ${json(leaf)}: the state before the arrow while the stored close is BLOCKED HR-C8; 'from award' is the issued PO-AWARD` });
  const cOrder = await poOf('procurement', P, pos.c.id);
  const o2o = { status: cOrder.status, warehouseStatus: cOrder.warehouseStatus, ordered: lineFigures(cOrder).ordered, received: lineFigures(cOrder).received, value: cents(cOrder.value) };
  const o2e = { status: WP5.O2.statusAfterPartial.value, warehouseStatus: WP5.O2.statusAfterPartial.value, ordered: WP5.O2.ordered.value, received: WP5.O2.received.value, value: WP5.O2.order1000.value };
  rec('O2.live.087', sameJson(o2o, o2e), { expected: o2e, observed: o2o });
  const co1 = await deepProbe('087-COM', 'procurement', 'POST', `${P}/purchase-orders/${pos.c.id}/close`, {}, 'a close of PO-C without force');
  const cAfter1 = await statusOfPo(pos.c.id);
  rec('O2.closeOutstanding.087', h.is(co1, saidOf(WP5.O2.closeOutstanding)) && sameJson(co1.body?.error?.details?.lines ?? null, [1]) && cAfter1 === WP5.O2.statusAfterPartial.value, { expected: { said: saidOf(WP5.O2.closeOutstanding), lines: [1], status: WP5.O2.statusAfterPartial.value }, observed: { said: h.said(co1), lines: co1.body?.error?.details?.lines ?? null, status: cAfter1 }, detail: 'refused before the transition (purchase-order.service.js:633)' });
  const fn1 = await deepProbe('087-COM', 'procurement', 'POST', `${P}/purchase-orders/${pos.c.id}/close`, { force: true }, 'a force close of PO-C without a reason');
  const cAfter2 = await statusOfPo(pos.c.id);
  rec('O2.forceNoReason.087', h.is(fn1, saidOf(WP5.O2.forceNoReason)) && cAfter2 === WP5.O2.statusAfterPartial.value, { expected: { said: saidOf(WP5.O2.forceNoReason), status: WP5.O2.statusAfterPartial.value }, observed: { said: h.said(fn1), status: cAfter2 } });
  const orderKeys = { ...Object.fromEntries(Object.entries(ORDER_KEYS_087).map(([k, label]) => [pos[k]?.id, label])), [award.id]: 'AWARD' };
  const rl = listOf(await dataOf('warehouse', `/inventory/purchase-orders?projectId=${projectId087}&scope=receivable`)).map((o) => orderKeys[o.id] || `other:${o.ref}`);
  obs.receivable087 = rl;
  const L5 = WP5.O5.on087;
  ka('KA.O5.receivableList.087', { ref: L5.ref, value: L5.value, today: L5.today, observed: rl, verdict: judge(rl, (x) => sameSet(x, L5.value), (x) => sameSet(x, L5.today)), detail: 'ACK is 087-COM\'s acknowledged PO-00001 (BOOK-G9)' });
  // N: the cement, the stores, the O2 cement
  const items = outOf(st, 'items');
  const cem = itemFigures(await itemOf('warehouse', items.cement));
  const n1o = { onHand: cem.onHand, reserved: cem.reserved, available: cem.available, averageCost: cem.averageCost, value: cem.value };
  const n1e = { onHand: WP5.existing.stockOnHand.value, reserved: WP5.existing.stockOnHand.value - WP5.N1.availableAfterReserve.value, available: WP5.N1.availableAfterReserve.value, averageCost: STAGE4_170.weightedAverage.value, value: WP5.existing.stockValue.value };
  rec('N1.live.087', sameJson(n1o, n1e), { expected: n1e, observed: n1o, detail: 'read only: issue 41 / 40 and release 51 run on J (MOMENT-MAP row 148)' });
  const wh = outOf(st, 'warehouses');
  const whs = listOf(await dataOf('warehouse', `/inventory/warehouses?projectId=${projectId087}`));
  const locCodes = async (id) => listOf(await dataOf('warehouse', `/inventory/warehouses/${id}/locations`)).map((l) => l.code).sort();
  const c2 = itemFigures(await itemOf('warehouse', items.cement2));
  const meter = itemFigures(await itemOf('warehouse', items.meter));
  // GET /inventory/warehouses?projectId lists the project's own stores and the company's central ones (inventory.service.js:519)
  const sto = { warehouses: whs.filter((w) => [wh.site, wh.yard].includes(w.id)).length, projectWarehouses: whs.filter((w) => w.projectId === projectId087).length, site: await locCodes(wh.site), yard: await locCodes(wh.yard), o2Cement: { onHand: c2.onHand, damaged: c2.damaged, quarantined: c2.quarantined, inTransit: c2.inTransit } };
  const ste = { warehouses: D087.warehouses.value, projectWarehouses: D087.warehouses.value, site: Object.keys(wh.siteLocations).sort(), yard: Object.keys(wh.yardLocations).sort(), o2Cement: D087.o2CementEnd.value };
  rec('N.live.087.store', sameJson(sto, ste), { expected: ste, observed: { ...sto, meterOnHand: meter.onHand }, detail: 'the bins are the build\'s record names (step warehouses out); the serial meter is recorded, not judged (no book key)' });
  // D: the 20 cells, SINV-VOID, the membrane (L35), the matches, the reconciliation
  const cells = outOf(st, 'direct-costs').cells;
  const cellRead = [];
  for (const [key, id] of Object.entries(cells)) { const dc = await dataOf('cost', `${P}/direct-costs/${id}`); cellRead.push({ key, read: `${dc.type}:${dc.status}` }); }
  const want = D087.stateCoverage.directCostsTypeByState.value;
  const cellOk = cellRead.every((c) => c.read === c.key.replace('-', ':')) && sameSet(cellRead.map((c) => c.read), want);
  rec('D.live.087.stateCoverage', cellOk, { expected: want, observed: cellRead });
  const inv = outOf(st, 'supplier-invoices');
  const vEntries = await ledgerEntries('cost', P, { activityId: ids.a100, sourceIds: [inv.voidedAfterApproval] });
  const vdc = await dataOf('cost', `${P}/direct-costs/${inv.voidedAfterApproval}`);
  const V = D087.supplierInvoiceVoidedAfterApproval;
  const vo = { posts: vEntries.filter((e) => !e.isReversal).map((e) => cents(e.amount)), mirrors: vEntries.filter((e) => e.isReversal).map((e) => cents(e.amount)), entries: vEntries.length, net: sumCents(vEntries), status: vdc.status, postedAmount: (vdc.lines || []).map((l) => cents(l.postedAmount)) };
  const ve = { posts: [V.approvePosts.value], mirrors: [V.voidMirror.value], entries: V.entries.value, net: V.sourceNet.value, status: 'void', postedAmount: (vdc.lines || []).map(() => 0) };
  rec('D.live.087.voidedAfterApproval', sameJson(vo, ve), { expected: ve, observed: vo });
  const memIssues = (await movesOf('warehouse', items.membrane, 'issue')).map((m) => m.id);
  const d4 = sumCents(await ledgerEntries('cost', P, { activityId: ids.act, sourceIds: [inv.approvedBeforeReceipt, ...memIssues] }));
  obs.d4087 = { total: d4, issues: memIssues.length };
  kaLeaf('KA.D4.087', WP5.D4.ledgerInvoiceBeforeReceipt, d4, { storedAt: stepAt(st, 'membrane.after-invoice'), detail: 'SINV-EARLY\'s direct_cost entries plus the membrane issue\'s material_issue on A130 (L35, CERT-5; a build record)' });
  const mv = await dataOf('warehouse', `/inventory/match/invoice/${inv.variance}`);
  const pv = (mv?.lines || []).flatMap((l) => (l.flags || []).filter((f) => f.code === 'price_variance').map((f) => f.severity));
  rec('D5.live.087.priceVariance', mv?.verdict === WP5.D5.priceVarianceVerdict.value && sameJson(pv, ['blocking']), { expected: { verdict: WP5.D5.priceVarianceVerdict.value, priceVariance: ['blocking'] }, observed: { verdict: mv?.verdict ?? null, priceVariance: pv, unitCosts: (mv?.lines || []).map((l) => [l.orderedUnitCost, l.invoicedUnitCost]) } });
  const mo = await dataOf('warehouse', `/inventory/match/order/${pos.svc.id}`);
  const ml = (mo?.lines || [])[0] || {};
  const over1 = await dataOf('cost', `${P}/direct-costs/${inv.overInvoiced[0]}`);
  const oo = { verdict: mo?.verdict ?? null, invoicedOverReceived: num(ml.invoicedQty) > num(ml.receivedQty), flag: (ml.flags || []).filter((f) => f.code === 'invoiced_more_than_received').map((f) => f.severity), over1: { status: over1.status, postedAmount: (over1.lines || []).map((l) => cents(l.postedAmount)) } };
  const oe = { verdict: 'review', invoicedOverReceived: true, flag: ['blocking'], over1: { status: 'approved', postedAmount: (over1.lines || []).map(() => WP5.D5.overInvoicedLedger.today) } };
  obs.svc087 = { ...oo, invoicedQty: num(ml.invoicedQty), receivedQty: num(ml.receivedQty) };
  rec('D5.live.087.overInvoiced', sameJson(oo, oe), { expected: oe, observed: obs.svc087, detail: 'SINV-OVER1\'s postedAmount 0.00 is WP5.D5.overInvoicedLedger\'s today (BOOK-G3, WP5-SVC-1)' });
  const rc = await recon('cost', P);
  rec('D7.087.balanced', rc?.balanced === WP5.D7.balanced.value, { expected: WP5.D7.balanced.value, observed: reconFigures(rc) });
  obs.static = staticScan();
};

// -- 087-COM-B with 087-COM: PO-00001 -----------------------------------------------------------------------------------------
const combFlow = async () => {
  const B = ctx.deep['087-COM-B'];
  const A = ctx.deep['087-COM'];
  const p1 = outOf(ctx.state['087-COM-B'], 'po.PO-00001');
  const ackId = outOf(ctx.state['087-COM'], 'purchase-orders').ack.id;
  const bOrder = await poOf('procurement', B.P, p1.orderId);
  const aOrder = await poOf('procurement', A.P, ackId);
  const ref = D087B.poRefCollision.value;
  const co = { a: { ref: aOrder.ref, status: aOrder.status }, b: { ref: bOrder.ref, status: bOrder.status }, stateNamesThePair: p1.collidesWith?.orderId === ackId };
  const ce = { a: { ref, status: 'acknowledged' }, b: { ref, status: 'issued' }, stateNamesThePair: true };
  rec('O6.collision.live', sameJson(co, ce), { expected: ce, observed: co });
  const scan = await get('warehouse', `/inventory/purchase-orders/${encodeURIComponent(ref)}`);
  const found = scan.body?.data || {};
  const which = found.id === ackId ? '087-COM' : found.id === p1.orderId ? '087-COM-B' : found.id ? 'another project' : null;
  let keeperOnTeam = null;
  if (found.projectId) keeperOnTeam = (await teamOf('pm', `/projects/${found.projectId}`).catch(() => [])).includes(ctx.people.warehouse);
  const o = { said: h.said(scan), ref: found.ref ?? null, which, projectId: found.projectId ?? null, keeperOnTeam };
  obs.hrc9 = o;
  const OC = WP5.O6.refCollision;
  const sc = CONTRACT['HR-C9'].statusCode;
  ka('KA.O6.refCollision', { ref: OC.ref, value: OC.value, today: OC.today, observed: o, verdict: judge(o, (x) => statusPart(x.said) === OC.value.status && (sc ? x.said === sc : true), (x) => x.said === '200' && x.ref === ref), detail: 'read as the warehouse keeper (inventory:read; no project check: goods-receipt.service.js:165-181)' });
};

// -- 052-COM: PO-O2, a read and its two close refusals (WP5ADJ Q2) --------------------------------------------------------------
const d2Flow = async () => {
  const st = ctx.state['052-COM'];
  const s = storedCom052(st);
  rec('O2.stored.052', s['O2.stored.052'].ok === true, { expected: s['O2.stored.052'].expected, observed: s['O2.stored.052'].observed, detail: s['O2.stored.052'].detail });
  const D = ctx.deep['052-COM'];
  const o2 = outOf(st, 'po.O2');
  const order = await poOf('procurement052', D.P, o2.id);
  const O2 = D052.O2;
  const lo = { status: order.status, warehouseStatus: order.warehouseStatus, ordered: lineFigures(order).ordered, received: lineFigures(order).received, value: cents(order.value), currency: order.currency };
  const le = { status: O2.statusAfterPartial.value, warehouseStatus: O2.statusAfterPartial.value, ordered: O2.ordered.value, received: O2.received.value, value: O2.order1000.value, currency: D052.currency.value };
  rec('O2.live.052', sameJson(lo, le), { expected: le, observed: lo });
  const cl = await deepProbe('052-COM', 'procurement052', 'POST', `${D.P}/purchase-orders/${o2.id}/close`, {}, 'a close of PO-O2 without force');
  const s1 = (await poOf('procurement052', D.P, o2.id)).status;
  rec('O2.closeOutstanding.052', h.is(cl, saidOf(O2.closeOutstanding)) && sameJson(cl.body?.error?.details?.lines ?? null, [1]) && s1 === O2.statusAfterPartial.value, { expected: { said: saidOf(O2.closeOutstanding), lines: [1], status: O2.statusAfterPartial.value }, observed: { said: h.said(cl), lines: cl.body?.error?.details?.lines ?? null, status: s1 } });
  const fn = await deepProbe('052-COM', 'procurement052', 'POST', `${D.P}/purchase-orders/${o2.id}/close`, { force: true }, 'a force close of PO-O2 without a reason');
  const s2 = (await poOf('procurement052', D.P, o2.id)).status;
  rec('O2.forceNoReason.052', h.is(fn, saidOf(O2.forceNoReason)) && s2 === O2.statusAfterPartial.value, { expected: { said: saidOf(O2.forceNoReason), status: O2.statusAfterPartial.value }, observed: { said: h.said(fn), status: s2 } });
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
  /** A CF observation against its book leaf (WP5.CF.*): today present, value absent, else a gap. */
  const leafState = (leaf, observed) => (observed === undefined || observed === null ? 'gap' : sameJson(observed, leaf.today) ? 'present' : sameJson(observed, leaf.value) ? 'absent' : 'gap');
  const scan = obs.static || staticScan();
  cf('CF.awardAtomic', { ...split([['J-BP2: two confirms at once both succeed, two draft commitments', kaState('KA.R2.concurrentConfirms')], ['confirmAward claims nothing under a lock (static)', yes(scan.awardClaimWithoutLock)]]), detail: `${json(obs.r2)}; fix ${FIXES['AWARD-ATOMIC'].commit || 'not yet'}; severity P1 kept until this reproduction shows what the duplicate drafts can reach (WP5ADJ Q3)` });
  cf('CF.awardSecondOrder', { ...split([['J-PP1 ordered twice: two orders', kaState('KA.R3.secondOrder')], ['raiseOrderFromAward records no order on the award (static)', yes(scan.awardOrderRecordsNothing)]]), detail: `${json(obs.r3)}; fix ${FIXES['AWARD-ONE-ORDER'].commit || 'not yet'}` });
  cf('CF.awardCoding', { ...split([['J\'s award order line carries the activity only', kaState('KA.R4.lineCoding.J')], ['087-COM PO-AWARD\'s line carries the activity only', kaState('KA.R4.lineCoding.087')], ['the award line map copies no cost code, budget line or BOQ item (static)', scan.awardLineMapCoding === null ? 'gap' : yes(scan.awardLineMapCoding.length === 0)]]), detail: `${json({ j: obs.r4J, com: obs.r4087 })}; fix ${FIXES['AWARD-CODING'].commit || 'not yet'}` });
  cf('CF.HRC8', { ...split([['J-C (partial): the force close with a reason refused', kaState('KA.O2.forceWithReason')], ['PO-A\' (received): the close refused', kaState('KA.O2.fullyReceivedClose')], ['J-C: a cancel after a delivery answers PO_TRANSITION_INVALID', kaState('KA.O3.cancelAfterDelivery')], ['087-COM build: po.C.close-short BLOCKED', kaState('KA.O2.stored.closeShort')], ['087-COM build: po.A.close-received BLOCKED', kaState('KA.O2.stored.closeReceived')]]), detail: `${json(obs.hrc8)}; HR-C8 undecided (D-FUN-1)` });
  cf('CF.receivableList', { ...split([['J: drafts listed, the acknowledged J-ACKC missing', kaState('KA.O5.receivableList.J')], ['087-COM: the acknowledged PO-00001 missing', kaState('KA.O5.receivableList.087')]]), detail: `${json({ j: obs.receivableJ, com: obs.receivable087 })}; no consumer reads scope=receivable (P3 proposed)` });
  const h9 = obs.hrc9;
  cf('CF.HRC9', { ...split([['the keeper\'s scan of PO-00001 answers one arbitrary order', kaState('KA.O6.refCollision')], ['two live projects of the company hold PO-00001', passed('O6.collision.live')], ['the answered order is on a project the keeper is not on the team of', !h9 || h9.keeperOnTeam === null ? 'gap' : yes(h9.keeperOnTeam === false)]]), detail: `${json(h9)}; HR-C9 undecided (the plan proposes P1); WP0-INV-1 is the same class (WP5ADJ Q3)` });
  cf('CF.HRC7', { ...split([['the procurement door ignores issueToActivity and issuedQty', passed('O7.J.ignoredFields')], ['a stock issue never raises the plan row\'s issuedQty', kaState('KA.N6.issuedQty')], ['usage within what was issued refused', kaState('KA.N6.usage50')]]), detail: `${json(obs.n6)}; HR-C7 undecided` });
  cf('CF.HRC6', { ...split([['L36: a never-issued return accepted', kaState('KA.N2.returnNeverIssued')], ['L36: a return of 30 after 10 issued accepted', kaState('KA.N2.return30After10')], ['X-FINANCE-1: a return credited at the current average', kaState('KA.N3.credit')], ['L35 on J: an invoice before its receipt counted twice', kaState('KA.D4.J.invoiceBeforeReceipt')], ['L35 on 087-COM', kaState('KA.D4.087')]]), detail: `${json({ n3: obs.n3, d4J: obs.d4J, d4087: obs.d4087 })}; recorded and deferred to CERT-5 (HR-C6)` });
  cf('CF.L199issue', { ...split([['the same issue body twice makes two movements', leafState(WP5.CF.L199issue, obs.l199 ? (obs.l199.movements === 1 ? { movements: 1 } : obs.l199) : null)]]), detail: json(obs.l199) });
  cf('CF.HRC5', { ...split([['J-VAR approved over a blocking variance', kaState('KA.D5.priceVarianceApproval')], ['J-SVC over-invoiced: both approvals accepted', kaState('KA.D5.overInvoicedLedger')], ['J-D6INV: a line without poLineId downgrades review to check', kaState('KA.D6.invoiceSideVerdict')], ['approveDirectCost reads no match (static)', scan.approveReadsMatch === null ? 'gap' : yes(scan.approveReadsMatch === false)]]), detail: `${json({ svc: obs.svc1 })}; HR-C5 undecided` });
  cf('CF.L107', { ...split([['the 50.00 price variance lands in neither stock nor cost', leafState(WP5.CF.L107, obs.l107 ? obs.l107.recognised : null)]]), detail: json(obs.l107) });
  cf('CF.L119', { ...split([['the ledger moves, the budget lines\' actual does not', leafState(WP5.CF.L119, obs.l119 ? (obs.l119.ledgerDelta === obs.l119.budgetActualDelta ? { budgetActualDeltaEqualsLedgerDelta: true } : { ledgerDelta: obs.l119.ledgerDelta, budgetActualDelta: obs.l119.budgetActualDelta }) : null)]]), detail: json(obs.l119) });
  cf('CF.DFUN1delete', { ...split([['J-DEL2 keeps its value after its line on J-A-DEL is gone', leafState(WP5.CF.DFUN1delete, obs.dfun1 ? obs.dfun1.del2After.value : null)], ['J-DEL2 lost the line on the deleted activity', !obs.dfun1 ? 'gap' : yes(obs.dfun1.del2After.lines === obs.dfun1.del2Before.lines - 1)]]), detail: json(obs.dfun1) });
  const sv = obs.svc1;
  cf('CF.SVC1', { ...split([['J-SVC\'s received service line names an inventory item', !sv ? 'gap' : yes(Boolean(sv.svcLineItem))], ['both J-SVC invoices read postedAmount 0.00', !sv ? 'gap' : yes(sv.postedAmounts.length > 0 && sv.postedAmounts.every((p) => p === 0))], ['087-COM SINV-OVER1 approved with postedAmount 0.00', !obs.svc087 ? 'gap' : yes(obs.svc087.over1.postedAmount.every((p) => p === 0))], ['the stored finding WP5-SVC-1', !obs.com087Findings ? 'gap' : yes(obs.com087Findings.svc1)]]), detail: `${json({ j: sv, com: obs.svc087 })}; scope wider than registered: every received PO line is stocked (WP5-PREP fact 9)` });
  const fields = scan.confirmFields;
  cf('CF.AWD1', { ...split([['the stored finding WP5-AWD-1', !obs.com087Findings ? 'gap' : yes(obs.com087Findings.awd1)], ['087-COM awarded above the lowest bid', passed('R1.live.gap')], ['the confirm route takes no not-the-lowest justification (static)', fields === null ? 'gap' : yes(!fields.some((f) => /justif|lowest/i.test(f)) && fields.includes('prequalOverrideReason'))]]), detail: `${json({ confirmFields: fields })}; P3, or EXPECTED BEHAVIOUR if the owner accepts the prequalification override as the record (WP5ADJ Q3)` });
  const i1 = obs.inv1;
  const INV = WP5.CF.INV1;
  const deny = (said) => INV.value.statusIn.includes(statusPart(said)) && INV.value.codeIn.includes(String(said).split(' ')[1]);
  const item = (said, todayStatus) => (said === undefined || said === null ? 'gap' : statusPart(said) === todayStatus ? 'present' : deny(said) ? 'absent' : 'gap');
  cf('CF.INV1', { ...split([
    ['the keeper (not on J) receives J-INV1 stock for J', !i1 || i1.keeperOnJ !== false ? 'gap' : item(i1.receive, INV.today.receive)],
    ['the keeper issues it to J-A110, posting cost on J', !i1 || i1.keeperOnJ !== false ? 'gap' : (item(i1.issue, INV.today.issue) === 'present' && i1.issueCostOnJ === INV.today.issueCostOnJ ? 'present' : item(i1.issue, INV.today.issue) === 'absent' ? 'absent' : 'gap')],
    ['the keeper returns it from J-A110', !i1 || i1.keeperOnJ !== false ? 'gap' : item(i1.return, INV.today.return)],
    ['the keeper lists 087-COM-B\'s orders without being on its team', !i1?.ordersOf087ComB || i1.ordersOf087ComB.keeperOnTeam !== false ? 'gap' : item(i1.ordersOf087ComB.said, INV.today.ordersOf087ComB)],
  ]), detail: `${json(i1)}; P2 registered; against HR-C9's proposed P1 the owner decides (WP5ADJ Q3)` });
};

// -- the run ------------------------------------------------------------------------------------------------------------------
const main = async () => {
  console.log(`wp5-supply-proof: ${ACTIVE.length} of ${EXPECTED_CHECKS} checks active${ONLY ? ` (--only=${[...ONLY].join(',')})` : ''}${SKIP ? ` (--skip=${[...SKIP].join(',')})` : ''}${PROJECT_FILTER ? ` (--project=${PROJECT_FILTER})` : ''}; sections ${[...selectedSections].join(' ')}; deep projects ${NEED_DEEP.join(', ') || 'none'}; J ${NEED_J ? `yes (J9 ${NEED_J9 ? 'yes' : 'no'}, J10 ${NEED_J10 ? 'yes' : 'no'}, J11 ${NEED_J11 ? 'yes' : 'no'})` : 'no'}; fixes ${Object.entries(FIXES).map(([r, f]) => `${r} ${f.commit || 'not set'}`).join(', ')}; in process\n`);
  if (ACTIVE.length !== CHECKS.length) console.log(`not exercised in this run (filtered out): ${CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id).join(', ')}\n`);
  await setup();
  // The deep projects first: reads and pre-write refusals only, before J and its orders exist.
  if (on('COM')) await h.section('087-COM: stored moments, reads and refusals', comFlow);
  if (on('COMB')) await h.section('087-COM-B and 087-COM: PO-00001', combFlow);
  if (on('D2')) await h.section('052-COM: PO-O2', d2Flow);
  if (NEED_J) {
    // J's fixture in its own section: when it cannot be set up the run is a setup error, and the other sections still run.
    await h.section('J: the fixture (J0-J2)', async () => { await jSetup(); ctx.jReady = true; });
    if (ctx.jReady) await h.section('J: J3 the warehouse keeper off the team (WP0-INV-1)', async () => { await jKeeperOff(); ctx.jKeeper = true; });
    if (ctx.jKeeper) await h.section('J: J4-J5 the plan row and the orders (O1)', async () => { await jOrders(); ctx.jOrdered = true; });
    if (ctx.jOrdered) await h.section('J: J6 receipts (O2, O4, O5, O7)', async () => { await jReceipts(); ctx.jReceived = true; });
    if (ctx.jReceived) {
      await h.section('J: J7 the closes (O2, O3)', jCloses);
      await h.section('J: J8 the activity delete (D-FUN-1)', jDelete);
      if (NEED_J9) await jInventory();
      if (NEED_J10) await jBids();
      if (NEED_J11) await jDirectCosts();
    }
    if (ctx.j) await h.section('J: the end (archive)', jEnd);
  } else {
    for (const id of ['S.J.create', 'S.J.fixture', 'S.J.archived']) rec(id, true, { detail: 'not needed (no selected check runs on J)' });
  }
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
  console.log(`\ntally: ${tally.pass} pass, ${tally.fail} fail of ${tally.activeRecorded} recorded (${tally.active} active); failures: ${tally.otherFailing.join(', ') || 'none'}; known answers: ${tally.knownAnswers.value} value, ${tally.knownAnswers.blocked} BLOCKED, ${tally.knownAnswers.storedPreFix} STORED-PRE-FIX, ${tally.knownAnswers.fail} fail (${tally.knownAnswers.wrong} wrong)`);
  console.log(`confirm-first: ${Object.entries(confirmFirst).map(([id, c]) => `${id} ${c.classification}`).join('; ') || 'not classified'}`);
};

const cleanup = async () => {
  const notes = [];
  for (const step of ctx.cleanup.reverse()) {
    try { notes.push(String(await step())); } catch (error) { notes.push(`cleanup failed: ${error.message}`); }
  }
  if (!ctx.cleanup.length) notes.push('nothing to remove');
  // Verify through the API listing as 087's PM: no live J of any run of this proof is left.
  if (ctx.sessions.pm) {
    try {
      const prefix = String(JB.project.name).replace('<stamp>', '').trim();
      const page = await get('pm', `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(prefix)}`);
      const found = listOf(page.body?.data).filter((p) => String(p.name || '').startsWith(prefix));
      const live = found.filter((p) => !p.archivedAt);
      notes.push(`throwaway check (GET /projects as 087 PM, ${h.said(page)}): ${found.length} '${prefix}' projects, ${live.length} live${live.length ? ` (${live.map((p) => `${p.name} ${p.id}`).join(', ')})` : ''}`);
      h.observe('throwawayCheck', { total: found.length, live: live.map((p) => ({ id: p.id, name: p.name })) });
    } catch (error) {
      notes.push(`throwaway check failed: ${error.message}`);
    }
  }
  if (ctx.j) notes.push(`company-level residue in 087 (stamp ${h.STAMP}): the directory vendors J-QUAL and J-EXP (WP5ADJ Q6), J's two warehouses and 13 items (projectId J) with their stock, the item goods receipt made for J-SVC's service line (WP5-SVC-1)`);
  notes.push(`deep projects: ${ctx.deepWrites.length ? `UNEXPECTED WRITES: ${ctx.deepWrites.join('; ')}` : 'nothing written; every refusal probe was refused'}`);
  if (ctx.restorations.length) notes.push(`restorations: ${ctx.restorations.join('; ')}`);
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

module.exports = { __wp5: { kaStatus, judge, storedCom087, storedCom052, storedClose, staticScan, CHECKS, EXPECTED_CHECKS, SECTION_PROJECTS, CF_SOURCES, CATCHERS, FIX_CATCHERS, COLLATERAL, DECIDED_RED, CONTRACT, FIXES, RULES, FIXTURE, USAGE, DUE_MIN, O7_ISSUED_QTY, D3_PAID_AT } };

h.run({ main, cleanup });
