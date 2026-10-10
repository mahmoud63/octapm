'use strict';

/**
 * WP-3 (Earned value, reporting periods, forecast) primary proving run: the
 * known-answer run of plan §4 WP-3 on the cert3d population
 * (docs/certification/OCTAPM_CERT3_PLAN.md §4 WP-3 :626-669, §3.1 half-hour
 * zones :392, §3.2 087-EV :426, D2 052-SCH-EV :443, D3 006-LITE :449, §3.3
 * time :466-469, §0.1 L34 :53-55, §5 HR-S9 :1036, HR-E1..HR-E4 :1092-1095,
 * the defect-fix list :1107-1121, §6.1 E3/E6/E8, §6.2 WP-3 guards :1147;
 * plan lines as numbered at 114e9f1). Preparation
 * C:\Temp\octapm-cert\scratch\wp3\WP3-PREP.md (+ wp3-checks-draft.json,
 * wp3-mutations-draft.json, derive-v.json); the BINDING integration-owner
 * adjudication C:\Temp\octapm-cert\scratch\wp3\WP3-ADJUDICATION.md (Q1-Q16);
 * moment map build/MOMENT-MAP.md (087-EV rows 60-66, 71-104; 052 rows
 * 238-245; 006 row 252); answer book answers/schedule.js (WP3.*, D2.WP3.*,
 * D3.WP3.*, CLAUDE.SPI/CPI/EAC) AFTER the WP-3 book patch
 * (C:\Temp\octapm-cert\scratch\wp3\book\book-insert.js; the proof refuses to
 * load without it).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp3-ev-proof.js [--only=T4,PERV] [--project=V] [--skip=D2,D3]
 *
 * Filters. Sections are the id prefixes (S EVS EVL PER T4 T7 FC DP D2 D3 CF),
 * with two splits so a partial population can be skipped cleanly: PERV holds
 * the PER.* and KA.PER.* checks that run on the throwaway project V (PER keeps
 * the six period probes on the live 087-EV), and FCS holds FC.siteEngineerMoney
 * (087-SCH + 087-EXTRAS; FC keeps the V and pure forecast checks).
 * --only=<sections> keeps those sections, --project=<V|087-EV|087-SCH|
 * 052-SCH-EV|006-LITE|pure|static> the sections that touch that project,
 * --skip=<sections> drops sections. Selecting CF selects every section CF
 * classifies from (EVS EVL PER PERV T4 FC D2); skipping one of those needs
 * --skip=CF too. The setup checks (S.*) always run, but only for the projects
 * and state files the selected checks need; a filtered-out check is neither
 * registered nor recorded. The V choreography runs whole whenever one selected
 * check runs on V (its steps depend on each other, as WP-2's P), except the
 * probes no later step needs and no selected check reads (V5 L106, V15 the
 * EV-based finish, V22 the concurrent locks, V23 L113, V24 L112, V25 the actor
 * role), which are skipped.
 *
 * In process (CERT_INPROCESS=1, through the lock runner only) on the
 * certification database. Every expected figure is an answer-book key (A10);
 * every figure the V choreography types is read from WP3.V.inputs (a book
 * leaf). Deep projects are resolved by their exact names through the API as
 * each company's PM (exactly one live project each); build state files are
 * read only for moment figures and ids (C:\Temp\octapm-cert\state\cert3\
 * <code>.json, steps[].out), with every stored unit named (STORED_UNITS).
 *
 * WHERE EACH CHECK RUNS (the CHECKS table carries it per id):
 *   V          a throwaway project of company 087 this run creates and
 *              archives (WP3ADJ Q1; WP3-PREP §5.1; the book's WP3.V.choreography
 *              V0-V25): T4 (the four reads through the in-process app,
 *              WP3ADJ Q2), the live T7 hash, the lock-rule catchers (V-A), the
 *              L34 lock, L113 (V-F), the concurrent locks (V-B), L106 (before
 *              any cost), the EV-based finish (buildForecast in process,
 *              inproc:V), the L112 probe (V24) and the actor role (V25, an 087
 *              staff QS assigned as cost_controller, WP3ADJ Q13).
 *   087-EV     live, writing nothing at HEAD: the run-date, 2026-02-28 and
 *              locked-period reads, the relocks (finance January, PM
 *              February; no overrideReason), a loading naming the locked
 *              February (409), a duplicate code (409), end before start (400),
 *              the override audit read. stored: every WP-3 build moment.
 *   087-SCH    live: GET /forecast as the 087-EXTRAS T-NOBOQ site engineer
 *              (withheld) and as the site engineer persona (money, E1).
 *   052-SCH-EV stored wp3.T1-T3; live ?cutoffDate=2026-02-28 (L34).
 *   006-LITE   stored ev.T1.
 *   pure       FC.pace (forecastActivity), DP (pickDefaultReportingPeriod with
 *              stored-shaped rows and an injected zone and now; DP.halfHour
 *              Asia/Kolkata +05:30 and Asia/Kathmandu +05:45, WP3ADJ Q9).
 *   static     source scans for the confirm-first items (WP3-TZ-1, HR-E4, L113,
 *              L106).
 *
 * KNOWN ANSWERS (KA.* and PER.V.afterLock.cutoffChanges): judged value
 * (pass), today (BLOCKED / known, with the ref, counted separately, never exit
 * 2, while the rule is undecided) or wrong (fail). A decided rule's today
 * fails (the WP-1 ka() rule). A probe whose own setup fails is a setup error
 * (exit 1), never 'wrong' (R-SET): each such probe runs in its own section.
 * CONFIRM-FIRST (CF.*): the items of plan :661-669 and register WP3-TZ-1,
 * classified from this run's observations as CONFIRMED / PARTIAL / REJECTED /
 * TEST GAP. L34 is decided: CF.L34 must be REJECTED (a defect check, RED at
 * HEAD); the others are reported (HR-E3 and HR-E4 are the owner's questions,
 * WP3ADJ Q15; WP3-TZ-1 is classified REJECTED by code reading, WP3ADJ Q14).
 *
 * L34 (DECIDED, CONFIRMED in CERT-3, fixed in WP-3; plan §0.1 :54, HR-E1
 * :1092; WP3ADJ). Its checks expect the DECIDED behaviour (official AC = the
 * ledger entries carrying an activity, dated incurredOn on or before the
 * cutoff date, WP3.L34.acRule; the isActive filter kept, WP3.L34.isActiveFilter,
 * WP3ADJ Q4) and are RED at HEAD: each is a 'defect' check of rule L34 and
 * records FAIL (exit 2, DEFECT_PRESENT), never a setup error. Only the figures
 * the rule moves are judged; the fix's contract-visible fields (WP3.L34.
 * formulaVersion, actualCostSource, basisTexts) are 'contract pending the L34
 * plan review' (WP3ADJ Q5) and are judged on the live and fresh checks only
 * once the book carries their adjudicated values (CONTRACT_L34, read from
 * those leaves).
 *
 *   check                           where           judged (decided)                 HEAD (today)
 *   KA.EVS.T3                       stored 087-EV   AC 70,000.00 (CV, ETC follow)    AC 20,000.00
 *   KA.EVS.febOpen                  stored 087-EV   WP3.periods.feb.snapshot         AC 20,000.00
 *   KA.EVS.febSnapshot              stored 087-EV   WP3.periods.feb.snapshot         AC 20,000.00
 *   KA.EVS.janSnapshot              stored 087-EV   WP3.periods.jan.snapshot         AC 0 (CPI null, no alert)
 *   KA.EVS.afterLock.cutoff0228     stored 087-EV   WP3.T3 then cutoffAfterCost      AC 20,000.00 then 25,000.00
 *   KA.EVL.febPeriod.figures        frozen 087-EV   WP3.periods.feb.snapshot         AC 20,000.00
 *   KA.EVL.janPeriod.figures        frozen 087-EV   WP3.periods.jan.snapshot         AC 0
 *   KA.D2.stored.T3                 stored 052      D2.WP3.T3 AC 70,000.00           20,000.00
 *   KA.EVL.cutoff0228               live 087-EV     cutoffAfterCost AC 75,000.00     25,000.00
 *   KA.PER.V.lockAc                 fresh V         WP3.V.lockA AC 120,001.00        100,001.00
 *   PER.V.afterLock.cutoffChanges   fresh V         WP3.V.cutoffAfter AC 125,001.00  105,001.00
 *   KA.D2.live.T3                   live 052        D2.WP3.T3 AC 70,000.00           20,000.00
 *   CF.L34                          live/fresh      REJECTED                         CONFIRMED
 *
 * STORED-PRE-FIX (WP3ADJ Q3 (b)+(c); WP3.L34.storedPreFix). Locked periods are
 * never recomputed and there is no unlock, so after the L34 fix the stored
 * build moments and the snapshots locked before it keep HEAD's figures. Once
 * the fix commit exists, L34_FIX below names it (commit and committedAt, set
 * by the integration owner when the fix lands; the proof checks the time
 * against git) and a STORED or FROZEN observation whose build or lock predates
 * that commit and shows exactly the leaf's today is judged STORED-PRE-FIX: a
 * pass, reported with the register link L34 (OCTAPM_LAUNCH_BLOCKERS.md), never
 * a WP-3 failure. Live and fresh observations are strict. The exit run's
 * rebuild (plan §7 step 5) judges every moment on the fixed code. While
 * L34_FIX is empty every L34 today is a failure.
 *
 * Expected at HEAD on cert3d (after the book patch, L34_FIX empty): 93 checks
 * + G.5xx; 13 FAIL (the L34 table above), exit 2, DEFECT_PRESENT; harness
 * provisional classification CONFIRMED (13 of 13 defect checks). Known
 * answers BLOCKED (6): KA.EVS.T5delete (L112), KA.EVS.T6.after (HR-S9),
 * KA.EVL.runDate (HR-S9), KA.FC.L106 (L106), KA.PER.futureCutoffLock (HR-E2),
 * KA.PER.concurrentLocks (CONCURRENT; value if the two locks serialise). CF
 * reported: CF.L118, CF.L112, CF.L113, CF.L106, CF.HRE3, CF.HRE4,
 * CF.concurrentLocks, CF.actorRole CONFIRMED; CF.WP3TZ1 REJECTED.
 * After the L34 fix with L34_FIX set: the five live/fresh L34 checks turn
 * green and the eight stored/frozen ones read STORED-PRE-FIX: exit 0 if
 * nothing else moved.
 *
 * Adjudication applied (WP3ADJ): Q1 V runs T4, live T7, the lock-rule
 * catchers, the L34 lock, L113 and the concurrent locks; only the non-writing
 * period probes stay on live 087-EV (a WP-3 deviation from MOMENT-MAP rows
 * 93-94, recorded in the moment map's deviation section when the proof
 * lands). Q2 T4 through buildOfficialEvReport (GET /reports/ev on V through
 * the in-process app). Q3 STORED-PRE-FIX. Q4 isActive kept. Q5 contract
 * pending. Q6 FC.siteEngineerMoney is the T-NOBOQ member's withheld view; the
 * site engineer persona receiving money (boq:read, E1) is expected behaviour,
 * observed in the same check. Q7 L106 reproduced (KA, BLOCKED until classified;
 * fixed in WP-3 only if it confirms P1). Q8 L112 recorded. Q9 DP.halfHour in
 * the fixed count. Q10 the catchers named in CHECKS / meta.catchers (M1, M1a,
 * M1b, M2, M2b, M3, M3b, M4; the status-filter mutants are equivalent and not
 * run). Q11 the loading names the locked period (HEAD's rule). Q12 the
 * concurrent locks' code-derived today. Q13 the staff QS on V. Q14 WP3-TZ-1
 * REJECTED by code reading. Q15 HR-E3/HR-E4 reported. Q16 severities are the
 * journal's, after this run.
 * EXPECTED_CHECKS: WP3-PREP's 92 + DP.halfHour (adopted into the fixed count,
 * Q9) = 93; G.5xx on top.
 *
 * Exit 0 pass / 2 a check failed / 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp3-ev-proof.json (every check with its
 * plan reference, answer-book key, expected, observed and verdict in
 * observations.checks; the KA verdicts in observations.knownAnswers; the CF
 * classifications in observations.confirmFirst; the decided-rule table in
 * observations.decidedRules; the L34 fix state in observations.l34Fix; all
 * written in cleanup, so a setup error still carries what was observed).
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');
const SCHEDULE = require('./answers/schedule');

const { WP3, D2, D3, CLAUDE } = SCHEDULE;
const IN = SCHEDULE.inputs;
const BOOK_RULES = SCHEDULE.rules;

// ── the WP-3 book patch must be applied (G1-G21 leaves; WP3ADJ Q1-Q16) ───────
const leafAt = (key) => key.split('.').reduce((node, k) => (node && typeof node === 'object' ? node[k] : undefined), SCHEDULE);
const WP3_PATCH_LEAVES = [
  'WP3.T4.fixture', 'WP3.T4.inputs.read1', 'WP3.T4.inputs.read2', 'WP3.T4.inputs.read3', 'WP3.T4.inputs.read4',
  'WP3.periods.feb.overriddenAuditFilter', 'WP3.periods.afterLock.relockProbes', 'WP3.periods.afterLock.loadingInLockedPeriodRequest',
  'WP3.periods.halfHourZones.kolkata.cutoff', 'WP3.periods.halfHourZones.kathmandu.cutoff',
  'WP3.forecast.evBasedFinishInputs', 'WP3.forecast.L106counts', 'WP3.forecast.L106fixture', 'WP3.forecast.siteEngineerMoneyMember', 'WP3.forecast.siteEngineerWithBoqRead',
  'WP3.V.inputs', 'WP3.V.choreography', 'WP3.V.reportingGateReady', 'WP3.V.cutoffA', 'WP3.V.bac', 'WP3.V.runDateAc', 'WP3.V.forecastSpi',
  'WP3.V.lockA.ac', 'WP3.V.cutoffAfter.ac', 'WP3.V.evAfterNewApproval', 'WP3.V.l112.bac', 'WP3.V.l112.edit', 'WP3.V.l112.delete',
  'WP3.L34.acRule', 'WP3.L34.isActiveFilter', 'WP3.L34.formulaVersion', 'WP3.L34.actualCostSource', 'WP3.L34.basisTexts', 'WP3.L34.storedPreFix',
  'WP3.confirmFirst.zoneChange', 'WP3.confirmFirst.zonePrecedence',
];
{
  const missing = WP3_PATCH_LEAVES.filter((key) => { const leaf = leafAt(key); return !leaf || typeof leaf !== 'object' || !('value' in leaf); });
  if (missing.length) throw new Error(`answers/schedule.js carries no WP-3 leaf ${missing.join(', ')}: apply the WP-3 book patch (C:/Temp/octapm-cert/scratch/wp3/book/book-insert.js) first`);
  if (!Array.isArray(WP3.forecast.L106budgetLines.value) || WP3.forecast.siteEngineerMoney.value?.costWithheld !== true || !/T4\.cpi09\.cpiAlert/.test(WP3.mutations.alertBoundary.value)
    || WP3.periods.concurrentLocks.value?.snapshotRows !== 1 || WP3.T5.deleteProbe.ref !== 'L112' || WP3.periods.futureCutoffLock.ref !== 'HR-E2') {
    throw new Error('answers/schedule.js carries the pre-WP-3 values of WP3.forecast.L106budgetLines / siteEngineerMoney / mutations.alertBoundary / periods.concurrentLocks / T5.deleteProbe / periods.futureCutoffLock (G8, G6, G3, G17, G16, G10): apply the WP-3 book patch first');
  }
}

// CLAUDE.md's SPI / CPI / EAC known answers are WP3.T1 / T2's figures: EVS.T1 and EVS.T2 assert them (E4; book load check G18).
if (CLAUDE.SPI.value.value !== WP3.T1.spi.value || CLAUDE.CPI.noAlert.value !== WP3.T1.cpi.value || CLAUDE.CPI.alert.value !== WP3.T2.cpi.value || CLAUDE.EAC.value !== WP3.T1.eac.value) {
  throw new Error('answers/schedule.js: CLAUDE.SPI / CPI / EAC are not WP3.T1 / T2\'s figures, so EVS.T1 / EVS.T2 would not assert them (G18)');
}

const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const STATE_DIR = 'C:/Temp/octapm-cert/state/cert3';
const REPO = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(__dirname, '..', '..', '..', 'src');
const ZONE = WP3.setup.timeZone.value; // Africa/Cairo (company 087; V copies it at creation)
const VI = WP3.V.inputs.value; // V's records, as the book types them (currency units)
const L34_PENDING = 'contract pending the L34 plan review';

const DEEP = {
  '087-EV': { company: '087', name: 'CERT3 Earned value (087-EV)' },
  '087-SCH': { company: '087', name: 'CERT3 Programme (087-SCH)' },
  '052-SCH-EV': { company: '052', name: 'CERT3 Programme and EV (052-SCH-EV)' },
  '006-LITE': { company: '006', name: 'CERT3 Lite (006-LITE)' },
};

// ── CLI ───────────────────────────────────────────────────────────────────────
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const setOf = (text) => (text ? new Set(text.split(',').map((s) => s.trim()).filter(Boolean)) : null);
const ONLY = setOf(argOf('only'));
const SKIP = setOf(argOf('skip'));
const PROJECT_FILTER = argOf('project');

// ── the fixed list of checks: id, section, plan reference, answer-book key, where it runs ──
// where: 'V' | 'inproc:V' | '087-EV' | '087-SCH' | '052-SCH-EV' | 'stored:<code>' | 'pure' | 'static' | 'setup', or a
// comma list for a confirm-first item. A known-answer check (KA.<section>.*) belongs to the section it judges; the
// period checks on V form PERV and FC.siteEngineerMoney forms FCS (the 6th argument), so a partial population skips them.
// The setup checks (S.*, T4.inputs) carry where 'setup' or their project; S.* carry no answer-book key (WP-1 L5).
// <CHECKS>
const L = (...lines) => `${PLAN_DOC}:${lines.join(',')}`;
const C = (id, planRef, bookKey, where, description, section = null) => ({ id, section: section || (id.startsWith('KA.') ? id.split('.')[1] : id.split('.')[0]), planRef, bookKey, where, description });
const CHECKS = [
  C('S.companies', L('371-416'), null, 'setup', '087 (and 052, 006 for their lanes) resolve, exactly one certification organisation each; the personas the selected checks need sign in (087 pm, planner, qs, cost, site, finance and, for V, the actor-role member: an 087 staff QS; 052 pm, cost; 006 pm)'),
  C('S.state', L('453-470'), null, 'setup', 'the build state files the selected checks read are present with their WP-3 steps done, or BLOCKED only with their moment-map ref (087-EV: L34 x7, L112, HR-S9; 052-SCH-EV wp3.T3: L34); 087-EXTRAS names the T-NOBOQ member, who signs in as the state names them; the L34 fix commit (L34_FIX), when set, is the one git dates'),
  C('S.projects', L('417-451'), null, 'setup', 'the deep projects the selected checks read resolve by exact name, exactly one live each, matching the state files'),
  C('S.branch', L(642), 'WP3.T5.deleteProbe', 'stored:087-EV', 'the T5 delete probe\'s stored outcome gives the branch every later 087-EV read takes (BLOCKED L112 or audited: revisionDeleted; refused: revisionKept); any other state is a setup error'),
  C('S.gate087EV', L(647, 1147), null, '087-EV', '087-EV\'s reporting gate is blocked now (BASELINE_NOT_LOCKED after T6, MOMENT-MAP row 93): the precondition that makes the 087-EV relocks write nothing under mutation M2b'),
  C('S.throwaway', L(636), null, 'V', 'V is created by the 087 PM (WP3.V.inputs: start 2026-01-05, five_day, EGP) with the planner, the QS, the cost controller, the site engineer, finance and the actor-role member (an 087 staff QS assigned as cost_controller) on its team'),
  C('S.V.fixture', L(636), 'WP3.V.inputs', 'V', 'X1/X2/X3 hand-built with their dates (site engineer assigned), BOQ V-1/V-2/V-3 allocated whole and approved (BAC 387,000.00 = WP3.V.bac), cost codes 01-100 and 02-100 selected, the one L106 budget line on 02-100, V\'s reporting gate blocked (WP3.V.reportingGateReady); each creation asserted'),

  C('EVS.setup', L(426, '630-632'), 'WP3.setup', 'stored:087-EV', 'steps boq, allocations, loadings, progress, directCosts done with the book\'s rows (five allocations 387,000.00; five approved loadings; A110 100 / A120 50 / A130 25 approved; three approved direct costs)'),
  C('EVS.T1', L(638), 'WP3.T1', 'stored:087-EV', 'checkpoint.T1: the 13 figures the value (BAC 387,000.00, PV 387,000.00, EV 97,500.00, AC 80,000.00, SPI 0.251938 alert, CPI 1.21875 no alert, EAC 317,538.46, SV -289,500.00, CV 17,500.00, ETC 237,538.46); CLAUDE.SPI/CPI/EAC are these figures (book load check, G18)'),
  C('EVS.T2', L(639), 'WP3.T2', 'stored:087-EV', 'checkpoint.T2: AC 110,000.00, CPI 0.886364 alert, EAC 436,615.38 (13 figures); addedCost 30,000.00'),
  C('KA.EVS.T3', L(640), 'WP3.T3', 'stored:087-EV', 'checkpoint.T3 at 2026-02-28 (cutoff 2026-02-28T21:59:59.999Z): PV 180,000.00, EV 0; AC value 70,000.00 / today 20,000.00 (L34 decided: today FAILS; STORED-PRE-FIX once the fix exists)'),
  C('EVS.T5', L(642), 'WP3.T5', 'stored:087-EV', 'checkpoint.T5: revision delta 13,000.00, BAC 400,000.00, EAC 451,282.05, ETC 341,282.05 on the T2 state'),
  C('KA.EVS.T5delete', L(642, 664), 'WP3.T5.deleteProbe', 'stored:087-EV', 'probe.T5.delete: value refused_or_audited; today the PM\'s silent 200 delete (no audit event, BAC back to 387,000.00) - L112'),
  C('EVS.T7', L(644), 'WP3.T7', 'stored:087-EV', 'checkpoint.T7.after hash = checkpoint.T7.before hash (A310 30% draft, A320 20% submitted, A130 50% rejected)'),
  C('EVS.periods', L(426, 646), 'WP3.periods.futurePeriod', 'stored:087-EV', 'periods step: 2026-01 (cutoff WP3.periods.jan.cutoff), 2026-02 (WP3.periods.feb.cutoff), the future one = rules.futurePeriodFor(the build\'s Cairo run date), its cutoff the end of that day in Cairo'),
  C('KA.EVS.febOpen', L(647), 'WP3.periods.feb.snapshot', 'stored:087-EV', 'checkpoint.feb.open: the open February report = WP3.periods.feb.snapshot; AC value 70,000.00 / today 20,000.00 (L34)'),
  C('EVS.feb.lockAsPlanner', L(647), 'WP3.periods.lockAsPlanner', 'stored:087-EV', 'lock.2026-02 refusals: planner \'403 FORBIDDEN\''),
  C('EVS.feb.financeWhileBlocked', L(647), 'WP3.periods.financeWhileBlocked', 'stored:087-EV', 'lock.2026-02 refusals: finance without a reason \'409 REPORTING_READINESS_BLOCKED\''),
  C('EVS.feb.financeWithOverride', L(647), 'WP3.periods.financeWithOverride', 'stored:087-EV', 'lock.2026-02 refusals: finance with a reason \'403 REPORTING_READINESS_OVERRIDE_FORBIDDEN\''),
  C('EVS.feb.lockByPm', L(647), 'WP3.periods.feb.lockByPmWithReason', 'stored:087-EV', 'lock.2026-02: the PM with a reason 200 (gate blocked before), isSnapshot, a snapshotId, readinessOverride.reason the build\'s reason, figures and alerts = checkpoint.feb.open'),
  C('KA.EVS.febSnapshot', L(647), 'WP3.periods.feb.snapshot', 'stored:087-EV', 'lock.2026-02 snapshot: AC value 70,000.00 / today 20,000.00 (CV, ETC follow) - L34'),
  C('EVS.jan.lockNormal', L(426), 'WP3.periods.jan.lock', 'stored:087-EV', 'gate.ready then lock.2026-01 by finance with no override: 200, isSnapshot, readinessOverride null'),
  C('KA.EVS.janSnapshot', L(426), 'WP3.periods.jan.snapshot', 'stored:087-EV', 'lock.2026-01 snapshot (cutoff 2026-01-31T21:59:59.999Z): AC value 50,000.00 / today 0 (CPI 0 alert vs null no alert; basis budget_cpi_zero vs budget_no_cost_performance) - L34'),
  C('EVS.afterLock.periodReport', L(648), 'WP3.periods.afterLock.periodReport', 'stored:087-EV', 'checkpoint.afterLock.afterCost and .afterApproval February period reads hash = checkpoint.afterLock.before\'s'),
  C('KA.EVS.afterLock.cutoff0228', L(648), 'WP3.periods.afterLock.cutoffAfterCost', 'stored:087-EV', 'the stored 2026-02-28 reads: before = WP3.T3; after the back-dated cost and after the approval = WP3.periods.afterLock.cutoffAfterCost (AC value 75,000.00 / today 25,000.00, EV 0) - L34'),
  C('EVS.afterLock.runDateAfterCost', L(648), 'WP3.periods.afterLock.runDateAfterCost', 'stored:087-EV', 'run-date read after the back-dated cost: WP3.periods.afterLock.runDateAfterCost.<branch> (AC 115,000.00, CPI 0.847826 alert)'),
  C('EVS.afterLock.runDateAfterApproval', L(648), 'WP3.periods.afterLock.runDateAfterApproval', 'stored:087-EV', 'run-date read after A120 50 -> 60: WP3.periods.afterLock.runDateAfterApproval.<branch>; EV = WP3.periods.afterLock.runDateEv 100,500.00'),
  C('EVS.T6.before', L(643), 'WP3.T6.before', 'stored:087-EV', 'checkpoint.T6.before: WP3.T6.before.<branch> (AC 120,000.00 = acBeforeRetirement, CPI 0.8375); ledgerDelta 5,000.00'),
  C('KA.EVS.T6.after', L(643), 'WP3.T6.after', 'stored:087-EV', 'checkpoint.T6.after: WP3.T6.after.<branch>: AC value 120,000.00 / today 115,000.00 (A140 dropped with its retirement), CPI 0.8375 / 0.873913 - HR-S9'),
  C('EVS.zone', L(633, 1214), 'WP3.setup.timeZoneSource', 'stored:087-EV', 'every stored read and period answer: zone Africa/Cairo = company 087\'s, source \'project\', note null (planValue \'organisation\': plan premise A8)'),

  C('KA.EVL.runDate', L(631, 643), 'WP3.T6.after', '087-EV', 'GET /reports/ev?cutoffDate=<Cairo today> as cost: cut and zone asserted; WP3.T6.after.<branch>: EV 100,500.00; AC value 120,000.00 / today 115,000.00 - HR-S9 (catcher of M4: EV moves under it, wrong)'),
  C('KA.EVL.cutoff0228', L(640, 648), 'WP3.periods.afterLock.cutoffAfterCost', '087-EV', 'GET ?cutoffDate=2026-02-28 now (cutoff WP3.T3.cutoff): WP3.periods.afterLock.cutoffAfterCost: AC value 75,000.00 / today 25,000.00; EV 0; PV 180,000.00 - L34, live (strict after the fix)'),
  C('EVL.febPeriod.hash', L(634, 648, 1147), 'WP3.periods.afterLock.periodReport', '087-EV', 'GET ?periodId=<Feb> as cost: isSnapshot, the stored snapshotId and lockedAt, sha256 (canonical, without reporting.asOfDate) = checkpoint.afterLock.before\'s period sha256 (catcher of M2)'),
  C('KA.EVL.febPeriod.figures', L(647), 'WP3.periods.feb.snapshot', '087-EV', 'the February snapshot as served now: WP3.periods.feb.snapshot, AC value 70,000.00 / today 20,000.00 (frozen at the lock; STORED-PRE-FIX once the fix exists) - L34'),
  C('KA.EVL.janPeriod.figures', L(426), 'WP3.periods.jan.snapshot', '087-EV', 'the January snapshot as served now: WP3.periods.jan.snapshot, AC value 50,000.00 / today 0 (frozen) - L34'),

  C('PER.relock.jan', L(648, 1147), 'WP3.periods.afterLock.relockProbes', '087-EV', 'finance POST lock January with {} (no overrideReason): 200, the stored snapshotId and lockedAt; nothing written (catcher of M2b: 409 REPORTING_READINESS_BLOCKED, nothing written)'),
  C('PER.relock.feb', L(648, 1147), 'WP3.periods.afterLock.relockProbes', '087-EV', 'the PM POST lock February with {}: 200, the same snapshotId and lockedAt (catcher of M2b)'),
  C('PER.loadingLocked', L(634, 648), 'WP3.periods.afterLock.loadingInLockedPeriod', '087-EV', 'cost POST /reports/cost-loading naming the locked February (WP3.periods.afterLock.loadingInLockedPeriodRequest: A110, plannedDate 2026-02-20, 1,000.00): \'409 REPORTING_PERIOD_LOCKED\'; loading count unchanged'),
  C('PER.duplicateCode', L(646), 'WP3.periods.duplicateCode', '087-EV', 'cost POST /reports/periods with code 2026-01: \'409 CONFLICT\'; period count unchanged'),
  C('PER.endBeforeStart', L(646), 'WP3.periods.endBeforeStart', '087-EV', 'cost POST /reports/periods with periodStart 2026-03-31, periodEnd 2026-03-01: \'400 INVALID_REPORTING_PERIOD_DATES\'; count unchanged'),
  C('PER.overrideAudit.feb', L(634, 647), 'WP3.periods.feb.overriddenAuditEvents', '087-EV', 'GET /audit with WP3.periods.feb.overriddenAuditFilter (project_setup_readiness, overridden, source audit): exactly 1 event whose summary.periodId is February, its reason the build\'s'),

  C('KA.FC.L106', L(654, 666), 'WP3.forecast.L106budgetLines', 'V', 'V5, the PM GET /forecast on V with one budget line (02-100, originalBudget 100,000.00, no cost): cost.budgetLines value [] (counts.lines 0) / today one line {revised 0, forecast 100,000.00, overrun 100,000.00, level medium} (counts.lines 1) - L106'),
  C('T4.inputs', L(641), 'WP3.T4.inputs', 'V', 'the four reads on V give the book\'s inputs (WP3.T4.inputs.read1..read4: read1 PV 0 / EV 90,000 / AC 100,000; read2 PV 100,000; read3 AC 100,001; read4 at 2026-01-31 PV 100,000 / EV 0 / AC 50,000; BAC 387,000.00 each), cut where asked, in Africa/Cairo (else a setup error, R-SET)'),
  C('T4.pv0.spi', L(641), 'WP3.T4.pv0.spi', 'V', 'read1: SPI null'),
  C('T4.pv0.spiAlert', L(641), 'WP3.T4.pv0.spiAlert', 'V', 'read1: spiAlert false'),
  C('T4.spi09.spi', L(641), 'WP3.T4.spi09.spi', 'V', 'read2: SPI 0.9'),
  C('T4.spi09.spiAlert', L(641, 657), 'WP3.T4.spi09.spiAlert', 'V', 'read2: spiAlert false at exactly 0.9 (catcher of M1, M1a)'),
  C('T4.cpi09.cpi', L(641), 'WP3.T4.cpi09.cpi', 'V', 'read2: CPI 0.9'),
  C('T4.cpi09.cpiAlert', L(641, 657), 'WP3.T4.cpi09.cpiAlert', 'V', 'read2: cpiAlert false at exactly 0.9 (catcher of M1, M1b)'),
  C('T4.cpi09.eac', L(641), 'WP3.T4.cpi09.eac', 'V', 'read2: EAC 430,000.00'),
  C('T4.ac100001.cpi', L(641), 'WP3.T4.ac100001.cpi', 'V', 'read3: CPI 0.899991'),
  C('T4.ac100001.cpiAlert', L(641), 'WP3.T4.ac100001.cpiAlert', 'V', 'read3: cpiAlert true'),
  C('T4.ac100001.eac', L(641), 'WP3.T4.ac100001.eac', 'V', 'read3: EAC 430,004.30'),
  C('T4.ev0.cpi', L(641), 'WP3.T4.ev0.cpi', 'V', 'read4 (2026-01-31): CPI 0'),
  C('T4.ev0.cpiAlert', L(641), 'WP3.T4.ev0.cpiAlert', 'V', 'read4: cpiAlert true'),
  C('T4.ev0.eac', L(641, 1094), 'WP3.T4.ev0.eac', 'V', 'read4: EAC = BAC 387,000.00 (HR-E3: HEAD is the recommendation)'),
  C('T4.ev0.eacBasis', L(641, 1094), 'WP3.T4.ev0.eacBasis', 'V', 'read4: eacBasis \'budget_cpi_zero\' (HR-E3)'),
  C('FC.pace.basis', L(652), 'WP3.forecast.pace.basis', 'pure', 'forecastActivity on the book\'s activity (WP3.forecast.pace.inputs: 2026-05-01..05-31, one approval at 20%), asOf 2026-06-01: basis \'pace\''),
  C('FC.pace.projectedFinish', L(652), 'WP3.forecast.pace.projectedFinish', 'pure', 'projectedFinish 2026-10-03 (2026-06-01 + 80 x 31 / 20 = 124 days)'),
  C('FC.pace.slipDays', L(652), 'WP3.forecast.pace.slipDays', 'pure', 'slipDays 125'),
  C('FC.evBasedFinish', L(653), 'WP3.forecast.evBasedFinish', 'inproc:V', 'V15, buildForecast({ asOf: 2026-06-01 }) in process on V after the X3 loading (SPI 0.5, planned finish X3\'s 2026-07-01; WP3.forecast.evBasedFinishInputs): schedule.evBasedFinish 2026-07-31'),
  C('FC.siteEngineerMoney', L(655), 'WP3.forecast.siteEngineerMoney', '087-SCH', 'GET /forecast on 087-SCH as the 087-EXTRAS T-NOBOQ site engineer (neither boq:read nor cost:read): cost withheld with the reason, none of the money keys, budget lines without amounts, counts without atRisk, each activity cost {withheld, reason}; the site engineer persona (boq:read) receives the money (WP3.forecast.siteEngineerWithBoqRead, E1)', 'FCS'),
  C('T7.live.hash', L(644, 657), 'WP3.T7', 'V', 'V16, V\'s run-date report hash (canonical, without asOfDate) unchanged by X2 30% draft, X3 20% submitted, X2 40% submitted then rejected (catcher of M4)'),

  C('PER.V.planner', L(647), 'WP3.periods.lockAsPlanner', 'V', 'V19, the planner POST lock V-A: \'403 FORBIDDEN\'; V-A still open', 'PERV'),
  C('PER.V.financeBlocked', L(634, 647, 1147), 'WP3.periods.financeWhileBlocked', 'V', 'finance POST lock V-A with {}, V\'s gate blocked: \'409 REPORTING_READINESS_BLOCKED\'; V-A open, no snapshot (catcher of M3)', 'PERV'),
  C('PER.V.financeOverride', L(647), 'WP3.periods.financeWithOverride', 'V', 'finance POST lock V-A with a reason: \'403 REPORTING_READINESS_OVERRIDE_FORBIDDEN\'; V-A open (catcher of M3b)', 'PERV'),
  C('PER.V.pmOverride', L(647), 'WP3.periods.feb.lockByPmWithReason', 'V', 'the PM POST lock V-A with a reason: 200, isSnapshot, readinessOverride.reason the PM\'s, the snapshot\'s 13 figures and alerts = the open V-A report read just before (V18)', 'PERV'),
  C('PER.V.overrideAudit', L(634, 647), 'WP3.periods.feb.overriddenAuditEvents', 'V', 'exactly 1 OVERRIDDEN event naming V-A (summary.periodId), actor the PM, the reason', 'PERV'),
  C('KA.PER.V.lockAc', L(632, 647), 'WP3.V.lockA', 'V', 'the V-A snapshot at 2026-02-28: WP3.V.lockA, AC value 120,001.00 / today 100,001.00 (X3 20,000.00 of 02-10 dropped by its 03-10 posting) - L34, fresh (strict)', 'PERV'),
  C('PER.V.afterLock.periodHash', L(648, 1147), 'WP3.periods.afterLock.periodReport', 'V', 'V20, after X1 5,000.00 dated 02-15 and X2 10% approved: GET ?periodId=V-A hash = the hash right after the lock, isSnapshot, same snapshotId and lockedAt (catcher of M2)', 'PERV'),
  C('PER.V.afterLock.cutoffChanges', L(648), 'WP3.V.cutoffAfter', 'V', 'GET ?cutoffDate=2026-02-28 moves by the back-dated 5,000.00: WP3.V.cutoffAfter, AC value 125,001.00 / today 105,001.00 - L34, fresh (strict)', 'PERV'),
  C('PER.V.relock', L(648, 1147), 'WP3.periods.afterLock.relockProbes', 'V', 'V21, the PM POST lock V-A with {}: 200, the same snapshotId and lockedAt (catcher of M2b)', 'PERV'),
  C('KA.PER.futureCutoffLock', L(650, 665, 1093), 'WP3.periods.futureCutoffLock', 'V', 'V23, the PM POST lock V-F (rules.futurePeriodFor(the Cairo run date)) with a reason: value 409 (code not asserted) / today 200 - HR-E2', 'PERV'),
  C('KA.PER.concurrentLocks', L(667), 'WP3.periods.concurrentLocks', 'V', 'V22, two PM locks of V-B with reasons sent at once: value one 200 and one 409 (code not asserted), one EvPeriodSnapshot row, one OVERRIDDEN event / today both 200, one row, two events - CONCURRENT (sends that did not overlap: a setup error)', 'PERV'),

  C('DP.on20260305', L(649), 'WP3.periods.defaultPeriod.on20260305', 'pure', 'pickDefaultReportingPeriod(087-EV\'s periods as stored rows, Africa/Cairo, now 2026-03-05T00:00Z) = 2026-02'),
  C('DP.on20260401', L(649), 'WP3.periods.defaultPeriod.on20260401', 'pure', 'with 2026-03 (cutoff 03-31) added, now 2026-04-01T00:00Z, Africa/Cairo = 2026-03'),
  C('DP.chicagoCaution', L(649), 'WP3.periods.defaultPeriod.chicagoCaution', 'pure', 'the same in America/Chicago = 2026-02 (03-31 has not ended there)'),
  C('DP.halfHour', L(392, 633), 'WP3.periods.halfHourZones', 'pure', 'resolveReportingCutoff 2026-02-28 in Asia/Kolkata = 2026-02-28T18:29:59.999Z and Asia/Kathmandu = 18:14:59.999Z; the default period flips from 2026-01 to 2026-02 exactly at those instants (WP3ADJ Q9)'),

  C('D2.stored.T1', L(443, 638), 'D2.WP3.T1', 'stored:052-SCH-EV', 'wp3.T1: every D2.WP3.T1 leaf in USD and BAC 387,000.00; America/Chicago, source project, note null'),
  C('D2.stored.T2', L(443, 639), 'D2.WP3.T2', 'stored:052-SCH-EV', 'wp3.T2: AC 110,000.00, CPI 0.886364 alert, EAC 436,615.38'),
  C('KA.D2.stored.T3', L(443, 640), 'D2.WP3.T3', 'stored:052-SCH-EV', 'wp3.T3: cutoff 2026-03-01T05:59:59.999Z, PV 180,000.00, EV 0; AC value 70,000.00 / today 20,000.00 - L34 (STORED-PRE-FIX once the fix exists)'),
  C('KA.D2.live.T3', L(443, 640), 'D2.WP3.T3', '052-SCH-EV', 'live GET ?cutoffDate=2026-02-28 on 052-SCH-EV as 052\'s cost controller (MOMENT-MAP row 241: later records add no cost before the cutoff): cutoff, PV, EV the leaves; AC value 70,000.00 / today 20,000.00 - L34, live (strict)'),
  C('D3.stored.T1', L(449, 638), 'D3.WP3.T1', 'stored:006-LITE', 'ev.T1: every D3.WP3.T1 leaf in AED; Asia/Dubai, source project, note null'),

  C('CF.L34', L('53-55', 640, 662, 1092), 'WP3.L34.acRule', 'V,087-EV,052-SCH-EV', 'confirm-first: AC at a past cutoff drops an activity\'s cost when it posts after the cutoff - L34 decided: must be REJECTED; classified from the live and fresh checks only (KA.EVL.cutoff0228, KA.PER.V.lockAc, PER.V.afterLock.cutoffChanges, KA.D2.live.T3)'),
  C('CF.L118', L(663, 1036), 'WP3.T6.acAfterRetirement', '087-EV', 'confirm-first: a retired activity\'s AC drops out of the project totals (KA.EVS.T6.after, KA.EVL.runDate) - HR-S9'),
  C('CF.L112', L(664), 'WP3.V.l112', 'V,087-EV', 'confirm-first: approved budget revisions edited or deleted without audit (V24 on V: approve +13,000.00, the PM\'s amount edit, the PM\'s delete, the revision\'s audit events after each; plus KA.EVS.T5delete) - L112'),
  C('CF.L113', L(650, 665, 1093), 'WP3.periods.futureCutoffLock', 'V,087-EV,static', 'confirm-first: a period locked before its cutoff (KA.PER.futureCutoffLock); no unlock route (routes/reports.js); a normal lock writes no audit event (087-EV January) - HR-E2'),
  C('CF.L106', L(654, 666), 'WP3.forecast.L106budgetLines', 'V,static', 'confirm-first: the forecast reads line.revised, a field the budget register does not emit (KA.FC.L106; forecast.service.js budgetLineRisks; budget.service.js serializeLine) - L106'),
  C('CF.HRE3', L(668, 1094), 'WP3.T4.ev0.eac', 'V', 'confirm-first: EAC at CPI 0 is BAC, labelled budget_cpi_zero (T4.ev0.*) - HR-E3, reported (owner question, WP3ADJ Q15)'),
  C('CF.HRE4', L(669, 1095), 'WP3.T1.spiAlert', 'V,static', 'confirm-first: the report flag is the only alert (computed only in earned-value.service.js; no notice; no SPI exception kind; the flags on V\'s reads) - HR-E4, reported (owner question, WP3ADJ Q15)'),
  C('CF.concurrentLocks', L(667), 'WP3.periods.concurrentLocks', 'V', 'confirm-first: two locks of one period at once both succeed (KA.PER.concurrentLocks) - low'),
  C('CF.actorRole', L(667), 'WP3.V.inputs', 'V', 'confirm-first: a cost loading records the organisation role, not the project role (V25: an 087 staff QS assigned on V as cost_controller creates and submits a loading; approvalHistory actorRole qs vs the effective cost_controller) - low'),
  C('CF.WP3TZ1', L(632, 1214), 'WP3.confirmFirst.zoneChange', 'static,pure', 'confirm-first WP3-TZ-1: a change of the company zone reaches existing projects - by code reading (no write of Organisation.defaultTimezone after creation; no project zone field; a project zone written only at creation) and the pure precedence (WP3.confirmFirst.zonePrecedence): REJECTED expected (WP3ADJ Q14)'),
];
/**
 * Fixed before the first run: the checks above (G.5xx is the harness's own, on top). WP3-PREP proposed 92 fixed checks with
 * DP.halfHour optional; the binding adjudication adopted DP.halfHour into the fixed count (Q9). 92 + 1 = 93.
 */
const EXPECTED_CHECKS = 93;
// </CHECKS>
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((c) => c.id)).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');

/** Which sections touch which project (the --project filter selects sections). */
const SECTION_PROJECTS = {
  S: ['V', '087-EV', '087-SCH', '052-SCH-EV', '006-LITE', 'pure', 'static'],
  EVS: ['087-EV'], EVL: ['087-EV'], PER: ['087-EV'], PERV: ['V'], T4: ['V'], T7: ['V'], FC: ['V', 'pure'], FCS: ['087-SCH'],
  DP: ['pure'], D2: ['052-SCH-EV'], D3: ['006-LITE'],
  CF: ['V', '087-EV', '052-SCH-EV', 'static', 'pure'],
};
for (const c of CHECKS) if (!SECTION_PROJECTS[c.section]) throw new Error(`check ${c.id}: section ${c.section} is not in SECTION_PROJECTS`);
for (const [flag, set] of [['only', ONLY], ['skip', SKIP]]) {
  for (const section of set || []) if (!SECTION_PROJECTS[section]) throw new Error(`--${flag}: no section ${section} (sections: ${Object.keys(SECTION_PROJECTS).join(' ')})`);
}
if (PROJECT_FILTER && !Object.values(SECTION_PROJECTS).some((list) => list.includes(PROJECT_FILTER))) throw new Error(`--project: no project ${PROJECT_FILTER}`);
/** The sections CF classifies from (confirmFirstFlow reads their records, known answers and observations). */
const CF_SOURCES = ['EVS', 'EVL', 'PER', 'PERV', 'T4', 'FC', 'D2'];
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
const runsOn = (code) => ACTIVE.some((c) => !c.id.startsWith('S.') && wheresOf(c).includes(code));
const NEED_V = runsOn('V') || runsOn('inproc:V');
/** Whether a selected check reads a step's result: the V probes nothing selected reads are skipped (V5, V15, V22-V25 feed no later step). */
const wants = (...ids) => ids.some((id) => ACTIVE_IDS.has(id));
/** The deep projects (live) and the build state files (stored moments) the selected checks need. */
const NEED_DEEP = Object.keys(DEEP).filter((code) => runsOn(code) || runsOn(`stored:${code}`) || (code === '087-SCH' && on('FCS')));
/** 087-EXTRAS (no project of its own): its T-NOBOQ member for the withheld forecast. */
const NEED_EXTRAS = on('FCS');
const NEED_COMPANIES = [...new Set(['087', ...NEED_DEEP.map((code) => DEEP[code].company)])];

// ── small helpers ──────────────────────────────────────────────────────────────
/** A list out of an answer's data: the array itself, or its items / members / events / periods / rows / lines / allocations. */
const listOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'members', 'events', 'periods', 'rows', 'lines', 'allocations', 'activities']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dayOf = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const json = (v, max = 600) => { try { return JSON.stringify(v).slice(0, max); } catch { return String(v).slice(0, max); } };
const r6 = (x) => (x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(Number(x).toFixed(6)));
/** Sorted-key JSON text: the same object gives the same text whatever order its keys were written in. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
};
const sameJson = (a, b) => canonical(a) === canonical(b);
const sha256 = (body) => crypto.createHash('sha256').update(body).digest('hex');
const statusPart = (said) => Number(String(said).split(' ')[0]);
const readState = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${code}.json`), 'utf8'));
const outOf = (state, step) => {
  const st = state?.steps?.[step];
  if (!st || st.status !== 'done') throw new Error(`build ${state?.code}: step ${step} is ${st ? st.status : 'not run'}`);
  return st.out;
};
/** The calendar date an instant falls on in a zone (YYYY-MM-DD; the book's endOfLocalDay uses the same formatter). */
const localDate = (instant, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
const cairoToday = () => localDate(Date.now(), ZONE);
/** Money as integer cents (the API answers currency units); a value that is not an exact amount reads as a string, so it never matches. */
const cents = (v) => {
  if (v === null || v === undefined) return null;
  try { return harness.toCents(v); } catch { return `not cents: ${v}`; }
};

/**
 * The units the build state files store figures in, named per step field (WP-2 adjudication finding 7: never guessed).
 * 087-EV's checkpoints store the EV report's figures (currency units) and its summary; 052-SCH-EV's wp3.T1/T2 and
 * 006-LITE's ev.T1 store the book's units (lanes.assertMetricLeaves: cents, ratios to six places); 052's wp3.T3 stores
 * the report's units (done: { pv, ev, ac }; blocked: observed { pv, ev, today }).
 */
const STORED_UNITS = {
  '087-EV': { 'checkpoint.*.figures': 'units' },
  '052-SCH-EV': { 'wp3.T1': 'book', 'wp3.T2': 'book', 'wp3.T3.out': 'units', 'wp3.T3.blocked.observed': 'units' },
  '006-LITE': { 'ev.T1': 'book' },
};
/** A stored money figure in cents, by the unit STORED_UNITS names for it (never guessed: an unnamed field throws). */
const storedCents = (code, field, value) => {
  const unit = STORED_UNITS[code]?.[field];
  if (!unit) throw new Error(`no stored unit recorded for ${code} ${field}: the proof never guesses a stored unit`);
  if (value === null || value === undefined) return null;
  return unit === 'units' ? cents(value) : value;
};

// ── the 13 EV figures in the book's units ─────────────────────────────────────
const METRIC_KEYS = ['bac', 'pv', 'ev', 'ac', 'spi', 'spiAlert', 'cpi', 'cpiAlert', 'eac', 'eacBasis', 'sv', 'cv', 'etc'];
const MONEY_KEYS = new Set(['bac', 'pv', 'ev', 'ac', 'eac', 'sv', 'cv', 'etc']);
const RATIO_KEYS = new Set(['spi', 'cpi']);
const asBook = (key, v) => (v === null || v === undefined ? null : MONEY_KEYS.has(key) ? cents(v) : RATIO_KEYS.has(key) ? r6(v) : v);
/** A report's 13 figures (money in cents, ratios to six places, flags and the basis as given). */
const figuresOf = (report) => {
  if (!report || typeof report !== 'object') return null;
  const src = { ...report, bac: report.totalBudget ?? report.bac, spiAlert: report.alerts?.spiAlert, cpiAlert: report.alerts?.cpiAlert };
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, asBook(k, src[k])]));
};
/** The same from a 087-EV build checkpoint (087-ev.js summarise: figures and alerts in the report's units). */
const summaryFigures = (summary) => {
  if (STORED_UNITS['087-EV']['checkpoint.*.figures'] !== 'units') throw new Error('087-EV checkpoint figures: no stored unit recorded');
  return summary ? figuresOf({ ...(summary.figures || {}), alerts: summary.alerts || null }) : null;
};
/** A leaf's expected figure: its value, or its today where it has one ('today'), ratios to six places. */
const expectOf = (node, k, which) => {
  const leaf = node?.[k];
  if (!leaf) throw new Error(`answer book: no leaf ${k} in the metric node`);
  const v = which === 'today' && leaf.today !== undefined ? leaf.today : leaf.value;
  return leaf.unit === 'ratio' ? r6(v) : v;
};
const valuesOf = (node, keys = METRIC_KEYS, which = 'value') => Object.fromEntries(keys.map((k) => [k, expectOf(node, k, which)]));
/** value when every figure is the leaf's value; today when every figure is its today (where it has one, else its value) and some leaf has one; else wrong. */
const metricVerdict = (fig, node, keys = METRIC_KEYS) => {
  if (!fig) return 'wrong';
  if (keys.every((k) => sameJson(fig[k], expectOf(node, k, 'value')))) return 'value';
  const hasToday = keys.some((k) => node[k].today !== undefined);
  return hasToday && keys.every((k) => sameJson(fig[k], expectOf(node, k, 'today'))) ? 'today' : 'wrong';
};
const ZONE_EXPECT = { timeZone: WP3.setup.timeZone.value, timeZoneSource: WP3.setup.timeZoneSource.value, timeZoneNote: WP3.setup.timeZoneNote.value };
const zoneOf = (reporting) => ({ timeZone: reporting?.timeZone ?? null, timeZoneSource: reporting?.timeZoneSource ?? null, timeZoneNote: reporting?.timeZoneNote ?? null });
/**
 * The report hash: sha256 of the canonical (sorted-key) JSON of the report without reporting.asOfDate, exactly as
 * build/087-ev.js summarise computes the 087-EV references (JSON.stringify of a sorted-key copy).
 */
const canonicalObject = (value) => {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalObject(value[k])]));
  return value;
};
const reportHash = (report) => {
  const copy = JSON.parse(JSON.stringify(report ?? null));
  if (copy && copy.reporting) delete copy.reporting.asOfDate;
  return sha256(JSON.stringify(canonicalObject(copy)));
};
const sameFigures = (a, b) => sameJson(figuresOf(a), figuresOf(b));

/**
 * The L34 fix's contract-visible fields (WP3ADJ Q5), read from the book: null while the leaf's value is
 * 'contract pending the L34 plan review'. A live or fresh L34 check judges a field only once it is not null.
 */
const contractField = (leaf) => (leaf.value === L34_PENDING ? null : leaf.value);
const CONTRACT_L34 = Object.freeze({
  formulaVersion: contractField(WP3.L34.formulaVersion),
  actualCostSource: contractField(WP3.L34.actualCostSource),
  basisTexts: contractField(WP3.L34.basisTexts),
});
/** What the contract says of a live report: [] while every field is pending; otherwise the fields that differ. */
const contractProblems = (report) => {
  const problems = [];
  if (CONTRACT_L34.formulaVersion !== null && report?.reporting?.formulaVersion !== CONTRACT_L34.formulaVersion) problems.push(`formulaVersion ${report?.reporting?.formulaVersion}`);
  if (CONTRACT_L34.actualCostSource !== null) {
    const want = typeof CONTRACT_L34.actualCostSource === 'object' ? CONTRACT_L34.actualCostSource.actualCostSource : CONTRACT_L34.actualCostSource;
    const bad = listOf(report?.activityBreakdown).filter((a) => num(a.ac) > 0 && a.actualCostSource !== want).map((a) => `${a.activityId} ${a.actualCostSource}`);
    if (bad.length) problems.push(`actualCostSource ${bad.join(', ')}`);
    const priority = typeof CONTRACT_L34.actualCostSource === 'object' ? CONTRACT_L34.actualCostSource.officialSourcePriority : null;
    if (priority && report?.sourceSummary?.ac?.officialSourcePriority && !sameJson(report.sourceSummary.ac.officialSourcePriority, priority)) problems.push('officialSourcePriority');
  }
  if (CONTRACT_L34.basisTexts !== null && typeof CONTRACT_L34.basisTexts === 'object') {
    if (CONTRACT_L34.basisTexts.basisAc && report?.basis?.ac !== CONTRACT_L34.basisTexts.basisAc) problems.push('basis.ac');
    if (CONTRACT_L34.basisTexts.basisActualCosts && report?.basis?.actualCosts !== CONTRACT_L34.basisTexts.basisActualCosts) problems.push('basis.actualCosts');
  }
  return problems;
};
const contractNote = () => (Object.values(CONTRACT_L34).every((v) => v === null) ? `${L34_PENDING}: formulaVersion, actualCostSource and the basis texts are not judged (WP3ADJ Q5)` : `contract judged: ${json(CONTRACT_L34, 300)}`);

/**
 * The L34 fix commit (WP3ADJ Q3): EMPTY until the fix lands. The integration owner sets both fields from the fix commit
 * (`git show -s --format=%cI <commit>`); the proof checks the time against git (S.state). While empty, every L34 today
 * is a failure of the decided rule; once set, a stored or frozen observation older than committedAt that shows exactly
 * the leaf's today is STORED-PRE-FIX.
 */
const L34_FIX = Object.freeze({ commit: null, committedAt: null });

// ── rules, decided-rule checks and the confirm-first rows ──────────────────────
const ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp3/WP3-ADJUDICATION.md ${item}`;
const RULES = {
  L34: { status: 'decided', statement: 'Official AC at a cutoff is the sum of the project\'s cost-ledger entries that carry an activity, dated incurredOn on or before the cutoff date (WP3.L34.acRule; HR-E1); the activity isActive filter is kept (WP3.L34.isActiveFilter, WP3ADJ Q4). L34 is CONFIRMED in CERT-3 (plan section 0.1, the 087-EV build) and fixed in WP-3; its contract-visible fields are pending the L34 plan review (WP3ADJ Q5). Stored moments and frozen snapshots built before the fix commit read STORED-PRE-FIX (WP3ADJ Q3).', sources: [`${PLAN_DOC}:53-55,632,662,1092`, ADJ('the L34 paragraph; Q3, Q4, Q5')] },
  'HR-S9': { status: 'proposed', statement: 'Activities retired by activation keep their AC and EV in project totals (the recommendation; undecided; L118).', sources: [`${PLAN_DOC}:1036`] },
  'HR-E2': { status: 'proposed', statement: 'A period lock before its cutoff is refused (409; the code undecided, never guessed); no unlock; audit every lock (the recommendation; undecided; L113).', sources: [`${PLAN_DOC}:1093`, ADJ('Q1, Q16')] },
  'HR-E3': { status: 'proposed', statement: 'EAC at CPI 0 keeps BAC, labelled (the recommendation; HEAD already does; owner question whether to keep it as is, WP3ADJ Q15).', sources: [`${PLAN_DOC}:1094`, ADJ('Q15')] },
  'HR-E4': { status: 'proposed', statement: 'SPI or CPI below 0.9: the report flag, plus an exception kind when the engine is on; no new notice (the recommendation; undecided; the exception kind is WP-9\'s, owner question WP3ADJ Q15).', sources: [`${PLAN_DOC}:1095`, ADJ('Q15')] },
  L112: { status: 'proposed', statement: 'Approved budget revisions are not edited or deleted silently: refused, or audited (a lead with no section 5 row; P2 proposed, recorded unless it reproduces as P1, WP3ADJ Q8). A refusal\'s code is never guessed.', sources: [`${PLAN_DOC}:642,664`, ADJ('Q8, Q16')] },
  L106: { status: 'proposed', statement: 'The forecast\'s budget-line risks read the register\'s revised budget: a line within its budget is not a risk (lead; on the section 5 defect-fix list: fixed in WP-3 only if it confirms as P1, WP3ADJ Q7).', sources: [`${PLAN_DOC}:654,666,1117`, ADJ('Q7')] },
  CONCURRENT: { status: 'proposed', statement: 'Concurrent locks of one period: an observation (plan :667, low); expected serialised (one refused 409, its code never guessed); HEAD\'s code-derived today: both 200, one snapshot row, two OVERRIDDEN events (WP3ADJ Q12).', sources: [`${PLAN_DOC}:667`, ADJ('Q12')] },
  'ACTOR-ROLE': { status: 'proposed', statement: 'The actor role recorded on cost loadings is the effective (project) role, as the lock route records it: an observation (plan :667, low).', sources: [`${PLAN_DOC}:667`, ADJ('Q13')] },
  'WP3-TZ-1': { status: 'proposed', statement: 'Suspect registered by the builders: a later change of the company zone reaches existing projects. Classified by code reading (WP3ADJ Q14: REJECTED expected).', sources: [`${PLAN_DOC}:1214`, ADJ('Q14')] },
  'E1-WITHHOLD': { status: 'decided', statement: 'Owner decision E1 (2026-09-28): a reader of the BOQ receives the forecast as built; a reader of neither the BOQ nor the cost module receives it with the money withheld (utils/boq-figures withheldForecast).', sources: [`${PLAN_DOC}:655`, ADJ('Q6')] },
};
const CF_RULE = { 'CF.L34': 'L34', 'CF.L118': 'HR-S9', 'CF.L112': 'L112', 'CF.L113': 'HR-E2', 'CF.L106': 'L106', 'CF.HRE3': 'HR-E3', 'CF.HRE4': 'HR-E4', 'CF.concurrentLocks': 'CONCURRENT', 'CF.actorRole': 'ACTOR-ROLE', 'CF.WP3TZ1': 'WP3-TZ-1' };
/** The decided-rule checks (the header table): kind 'defect', rule L34, RED at HEAD until the fix (exit 2, never 1). stored: a build moment or frozen snapshot (STORED-PRE-FIX applies). */
const DECIDED_RED = {
  'KA.EVS.T3': { rule: 'L34', defect: 'L34 AC at a past cutoff from the whole cumulative CostRecord (087-EV T3, stored)', stored: true, today: 'AC 20,000.00' },
  'KA.EVS.febOpen': { rule: 'L34', defect: 'L34 the open February report (087-EV, stored)', stored: true, today: 'AC 20,000.00' },
  'KA.EVS.febSnapshot': { rule: 'L34', defect: 'L34 the February snapshot frozen at the lock (087-EV, stored)', stored: true, today: 'AC 20,000.00' },
  'KA.EVS.janSnapshot': { rule: 'L34', defect: 'L34 the January snapshot frozen at the lock (087-EV, stored)', stored: true, today: 'AC 0' },
  'KA.EVS.afterLock.cutoff0228': { rule: 'L34', defect: 'L34 the 2026-02-28 reads around the back-dated cost (087-EV, stored)', stored: true, today: 'AC 20,000.00 then 25,000.00' },
  'KA.EVL.febPeriod.figures': { rule: 'L34', defect: 'L34 the February snapshot as served (087-EV, frozen)', stored: true, today: 'AC 20,000.00' },
  'KA.EVL.janPeriod.figures': { rule: 'L34', defect: 'L34 the January snapshot as served (087-EV, frozen)', stored: true, today: 'AC 0' },
  'KA.D2.stored.T3': { rule: 'L34', defect: 'L34 AC at 2026-02-28 (052-SCH-EV wp3.T3, stored)', stored: true, today: 'AC 20,000.00' },
  'KA.EVL.cutoff0228': { rule: 'L34', defect: 'L34 AC at 2026-02-28 on the live 087-EV', stored: false, today: 'AC 25,000.00' },
  'KA.PER.V.lockAc': { rule: 'L34', defect: 'L34 a lock freezes the cumulative-record AC (V-A, fresh)', stored: false, today: 'AC 100,001.00' },
  'PER.V.afterLock.cutoffChanges': { rule: 'L34', defect: 'L34 the 2026-02-28 read after the back-dated cost (V, fresh)', stored: false, today: 'AC 105,001.00' },
  'KA.D2.live.T3': { rule: 'L34', defect: 'L34 AC at 2026-02-28 on the live 052-SCH-EV', stored: false, today: 'AC 20,000.00' },
  'CF.L34': { rule: 'L34', defect: 'L34 AC at a past cutoff drops a later-posted activity\'s cost', stored: false, today: 'CONFIRMED' },
};
for (const [id, d] of Object.entries(DECIDED_RED)) {
  if (!CHECKS.some((c) => c.id === id) || RULES[d.rule]?.status !== 'decided') throw new Error(`DECIDED_RED ${id}: not a check, or ${d.rule} is not decided`);
}
// The stored and frozen L34 checks judge exactly the leaves the book's STORED-PRE-FIX rule lists (WP3.L34.storedPreFix, G12).
{
  const listed = new Set(WP3.L34.storedPreFix.value.leaves);
  const judged = ['WP3.T3.ac', 'WP3.periods.feb.snapshot.ac', 'WP3.periods.jan.snapshot.ac', 'WP3.periods.afterLock.cutoffReportAc', 'WP3.periods.afterLock.cutoffAfterCost.ac', 'D2.WP3.T3.ac'];
  const missing = judged.filter((key) => !listed.has(key));
  if (missing.length) throw new Error(`WP3.L34.storedPreFix does not list ${missing.join(', ')}: the stored L34 checks and the book disagree (G12)`);
}
/** The setup checks: the S.* rows and T4.inputs (V's reads must give the book's inputs, R-SET). */
const SETUP_IDS = new Set([...CHECKS.filter((c) => c.id.startsWith('S.')).map((c) => c.id), 'T4.inputs']);
/** The live catchers of the §6.2 WP-3 guards (WP3.mutations.*, WP3ADJ Q10); M2b, M3b, M1a, M1b are variants. */
const CATCHERS = {
  M1: ['T4.spi09.spiAlert', 'T4.cpi09.cpiAlert'], M1a: ['T4.spi09.spiAlert'], M1b: ['T4.cpi09.cpiAlert'],
  M2: ['EVL.febPeriod.hash', 'PER.V.afterLock.periodHash'], M2b: ['PER.relock.jan', 'PER.relock.feb', 'PER.V.relock'],
  M3: ['PER.V.financeBlocked'], M3b: ['PER.V.financeOverride'],
  M4: ['T7.live.hash', 'KA.EVL.runDate'],
  'L34-M1': ['KA.EVL.cutoff0228', 'KA.PER.V.lockAc', 'KA.D2.live.T3', 'CF.L34'], 'L34-M2': ['KA.EVL.cutoff0228', 'KA.PER.V.lockAc', 'KA.D2.live.T3', 'CF.L34'],
};

const planEntries = ACTIVE.map((c) => [
  c.id,
  c.description,
  SETUP_IDS.has(c.id) ? { setup: true } : DECIDED_RED[c.id] ? { defect: DECIDED_RED[c.id].defect, rule: DECIDED_RED[c.id].rule } : c.id.startsWith('CF.') ? { rule: CF_RULE[c.id] } : c.id === 'FC.siteEngineerMoney' ? { rule: 'E1-WITHHOLD' } : {},
]);

const h = harness.createHarness({
  name: 'wp3-ev-proof',
  plan: planEntries,
  rules: RULES,
  meta: {
    plan: `${PLAN_DOC} section 4 WP-3 (:626-669), section 6.2 WP-3 guards (:1147); plan lines as numbered at 114e9f1`,
    prep: 'C:/Temp/octapm-cert/scratch/wp3/WP3-PREP.md',
    adjudication: 'C:/Temp/octapm-cert/scratch/wp3/WP3-ADJUDICATION.md (Q1-Q16 applied)',
    momentMap: 'backend/scripts/cert/cert3/build/MOMENT-MAP.md (deviation to record when the proof lands: L113 and the concurrent locks on V, not on 087-EV\'s future period, WP3ADJ Q1)',
    answerBook: `backend/scripts/cert/cert3/answers/schedule.js @${SCHEDULE.meta.head} + the WP-3 book patch (G1-G21)`,
    expectedChecks: EXPECTED_CHECKS,
    activeChecks: ACTIVE.length,
    filter: { only: ONLY ? [...ONLY] : null, skip: SKIP ? [...SKIP] : null, project: PROJECT_FILTER, sections: [...selectedSections], deepProjects: NEED_DEEP, throwaway: { V: NEED_V }, extras: NEED_EXTRAS },
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
    decidedRed: DECIDED_RED,
    l34Fix: L34_FIX,
    contractL34: Object.fromEntries(Object.entries(CONTRACT_L34).map(([k, v]) => [k, v === null ? L34_PENDING : v])),
    catchers: CATCHERS,
    equivalentMutants: 'the status filters of the EV progress include (earned-value.service.js:742) and of selectApprovedProgressForCutoff (:156): ActivityProgress rows are written only at approval (progress.service.js:2171), so dropping them changes nothing a check can see; recorded, not run as evidence (WP3ADJ Q10)',
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
 * A known answer's status: PASS (the value), BLOCKED (the today of an undecided rule), STORED-PRE-FIX (the today of L34 seen
 * in a stored moment or a frozen snapshot whose build or lock, storedAt, predates the L34 fix commit; WP3ADJ Q3), else FAIL.
 * Never STORED-PRE-FIX while the fix commit is not set.
 */
const kaStatus = ({ ref, verdict, storedAt = null }, fix = L34_FIX) => {
  const decided = RULES[ref]?.status === 'decided';
  if (verdict === 'value') return 'PASS';
  if (verdict === 'today' && !decided) return 'BLOCKED';
  const predates = storedAt !== null && Boolean(fix.committedAt) && Number.isFinite(Date.parse(storedAt)) && Date.parse(storedAt) < Date.parse(fix.committedAt);
  if (verdict === 'today' && ref === 'L34' && predates) return 'STORED-PRE-FIX';
  return 'FAIL';
};
/**
 * A known answer (A10): `verdict` is 'value' (the book's expected figure holds), 'today' (HEAD's recorded answer under an
 * undecided rule: BLOCKED / known, never exit 2) or 'wrong' (neither: an unexplained departure, a failure). Under a decided
 * rule (L34) a today fails, except a STORED or FROZEN observation (`storedAt`, its build or lock time) older than the L34
 * fix commit: STORED-PRE-FIX, a pass reported with the register link (WP3ADJ Q3).
 */
const ka = (id, { ref, value, today, observed, verdict, storedAt = null, detail = '' }) => {
  const c = BY_ID.get(id);
  const decided = RULES[ref]?.status === 'decided';
  const status = kaStatus({ ref, verdict, storedAt });
  const blocked = status === 'BLOCKED';
  const preFix = status === 'STORED-PRE-FIX';
  knownAnswers[id] = { ref, bookKey: c.bookKey, value, today, observed, verdict, ruleDecided: decided, storedAt, status, ...(preFix ? { register: 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md L34', fix: L34_FIX } : {}) };
  const ok = verdict === 'value' || blocked || preFix;
  const text = `${blocked ? `BLOCKED (known answer, ${ref})` : preFix ? `STORED-PRE-FIX (built ${storedAt}, before the L34 fix ${L34_FIX.commit} of ${L34_FIX.committedAt}): HEAD's pre-fix figures, reported with the register link L34, not a WP-3 failure` : verdict === 'today' ? `FAIL: HEAD still gives the known answer of ${ref}, which is decided${storedAt !== null && ref === 'L34' ? (L34_FIX.commit ? ` (stored ${storedAt}, not before the fix commit)` : ' (no L34 fix commit yet)') : ''}` : verdict === 'value' ? 'value' : `WRONG: neither the book's value nor HEAD's known answer (${ref})`}; ${detail}`;
  rec(id, ok, { expected: { value, today }, observed, detail: text });
  records[id].verdict = status;
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
/** A step the V choreography cannot go on without: a setup error, not a verdict (as WP-1's W and WP-2's P). */
const need = (condition, what) => {
  if (condition !== true) throw new Error(`V: ${what}: the choreography cannot go on (a setup error, not a verdict)`);
};
/** A confirm-first item classified from this run's observations (plan §0.0: CONFIRMED / PARTIAL / REJECTED / TEST GAP). */
const cf = (id, { present, absent, gap = [], detail = '' }) => {
  const total = present.length + absent.length + gap.length;
  const classification = total === 0 || gap.length === total ? 'TEST GAP' : present.length === 0 ? 'REJECTED' : absent.length === 0 && gap.length === 0 ? 'CONFIRMED' : 'PARTIAL';
  const rule = RULES[CF_RULE[id]];
  confirmFirst[id] = { classification, rule: CF_RULE[id], ruleStatus: rule.status, present, absent, gap, note: rule.status === 'decided' ? 'a decided rule: CONFIRMED is a failure (RED until its fix lands)' : 'an undecided rule: CONFIRMED is reported, not failed; EXPECTED BEHAVIOUR is the owner\'s call' };
  const ok = rule.status === 'decided' ? classification === 'REJECTED' : classification !== 'TEST GAP';
  rec(id, ok, { expected: rule.status === 'decided' ? 'REJECTED (fixed)' : 'CONFIRMED or REJECTED (reported)', observed: { classification, present, absent, gap }, detail: `${classification}; ${detail}` });
  return classification;
};

// ── sessions and requests ──────────────────────────────────────────────────────
const ctx = { db: null, q: null, orgs: {}, people: {}, sessions: {}, specs: {}, v: null, state: {}, deep: {}, cleanup: [], branch: null, gate087EV: null, deepWrites: [] };
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
/** The EV report as a persona reads it: { res, report, figures, hash }. */
const evRead = async (who, P, query) => {
  const res = await get(who, `${P}/reports/ev${query}`);
  const report = res.status === 200 ? res.body?.data : null;
  return { res, report, figures: figuresOf(report), hash: report ? reportHash(report) : null, said: h.said(res) };
};
/** Every audit event of a project the filter selects, read to the end of the cursor (as the PM). */
const auditEvents = async (P, query) => {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const data = await dataOf('pm', `${P}/audit?${query}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    rows.push(...listOf(data?.events));
    cursor = data?.nextCursor || null;
    if (!cursor) break;
  }
  return rows;
};
const gateOf = async (projectId) => (await dataOf('pm', `/projects/${projectId}/setup-readiness`))?.gates?.reporting ?? null;

// ── stored moments (pure over a state file and the book; exported for the static simulation) ──
/** The branch the T5 delete probe left (087-ev.js revisionKept): revisionDeleted after BLOCKED L112 or an audited delete, revisionKept after a refusal. */
const branchOf = (st) => {
  const probeStep = st?.steps?.['probe.T5.delete'];
  if (probeStep?.status === 'blocked' && probeStep.blocked?.ref === 'L112') return 'revisionDeleted';
  if (probeStep?.status === 'done' && probeStep.out?.outcome === 'refused') return 'revisionKept';
  if (probeStep?.status === 'done' && probeStep.out?.outcome === 'audited') return 'revisionDeleted';
  return null;
};
const pickNode = (node, keys) => Object.fromEntries(keys.map((k) => [k, node[k]]));
/** 087-EV's stored WP-3 moments judged against the book: { id: { ok | verdict, expected, observed, storedAt?, detail } }. */
const storedEv087 = (st, branch) => {
  const out = (step) => outOf(st, step);
  const r = {};
  // EVS.setup
  const boq = out('boq');
  const alloc = out('allocations');
  const loads = out('loadings');
  const prog = out('progress');
  const costs = out('directCosts');
  const allocCents = Object.fromEntries(Object.entries(alloc).map(([code, a]) => [code, cents(a.amount)]));
  const allocTotal = Object.values(allocCents).reduce((s, x) => s + (typeof x === 'number' ? x : NaN), 0);
  const sortRows = (rows) => [...rows].map((row) => row.map(String)).sort((a, b) => a.join('|').localeCompare(b.join('|')));
  const setupObserved = {
    boq: Object.keys(boq).sort(),
    allocations: allocCents,
    allocatedTotal: allocTotal,
    loadings: sortRows(Object.entries(loads).map(([code, l]) => [code, l.amount, l.plannedDate])),
    progress: Object.fromEntries(Object.entries(prog).map(([code, p]) => [code, p.status === 'approved' ? p.pct : `${p.status} ${p.pct}`])),
    directCosts: sortRows(Object.values(costs).map((c) => [c.activity, c.amount, c.costDate])),
  };
  const setupExpected = {
    boq: WP3.setup.boq.value.map((row) => row.code).sort(),
    allocations: WP3.setup.allocations.value,
    allocatedTotal: WP3.setup.allocatedTotal.value,
    loadings: sortRows(WP3.setup.loadings.value),
    progress: WP3.setup.progress.value,
    directCosts: sortRows(WP3.setup.directCosts.value),
  };
  r['EVS.setup'] = { ok: sameJson(setupObserved, setupExpected), expected: setupExpected, observed: setupObserved };
  // T1, T2, T3
  const t1 = summaryFigures(out('checkpoint.T1'));
  r['EVS.T1'] = { ok: metricVerdict(t1, WP3.T1) === 'value', expected: valuesOf(WP3.T1), observed: t1, detail: 'CLAUDE.SPI.value / CPI.noAlert / CPI.alert / EAC are WP3.T1 / T2 figures (book load check G18)' };
  const t2Out = out('checkpoint.T2');
  const t2 = summaryFigures(t2Out);
  r['EVS.T2'] = { ok: metricVerdict(t2, WP3.T2) === 'value' && t2Out.addedCost === WP3.T2.addedCost.value, expected: { ...valuesOf(WP3.T2), addedCost: WP3.T2.addedCost.value }, observed: { ...t2, addedCost: t2Out.addedCost } };
  const t3Out = out('checkpoint.T3');
  const t3 = summaryFigures(t3Out);
  r['KA.EVS.T3'] = { verdict: t3Out.reporting?.cutoffDate === WP3.T3.cutoff.value ? metricVerdict(t3, WP3.T3) : 'wrong', value: valuesOf(WP3.T3), today: valuesOf(WP3.T3, METRIC_KEYS, 'today'), observed: { ...t3, cutoffDate: t3Out.reporting?.cutoffDate }, storedAt: t3Out.capturedAt || st.steps['checkpoint.T3'].finishedAt };
  // T5 (BAC, EAC, ETC from WP3.T5; the rest the T2 state: 087-ev.js t5State)
  const t5Node = { ...pickNode(WP3.T2, METRIC_KEYS), bac: WP3.T5.bac, eac: WP3.T5.eac, etc: WP3.T5.etc };
  const t5Out = out('checkpoint.T5');
  const t5 = summaryFigures(t5Out);
  const delta = storedCents('087-EV', 'checkpoint.*.figures', t5Out.figures?.approvedBudgetRevisionDelta);
  r['EVS.T5'] = { ok: metricVerdict(t5, t5Node) === 'value' && delta === WP3.T5.budgetRevision.value, expected: { ...valuesOf(t5Node), budgetRevision: WP3.T5.budgetRevision.value }, observed: { ...t5, budgetRevision: delta } };
  // T5 delete probe (L112)
  const probeStep = st.steps['probe.T5.delete'];
  const probeObserved = { status: probeStep?.status ?? null, ref: probeStep?.blocked?.ref ?? null, said: probeStep?.blocked?.observed?.said ?? probeStep?.out?.said ?? null, outcome: probeStep?.out?.outcome ?? null, auditDeleteEvents: probeStep?.blocked?.observed?.auditDeleteEvents ?? null, bacAfter: cents(probeStep?.blocked?.observed?.bacAfter?.totalBudget ?? probeStep?.out?.bacAfter?.totalBudget) };
  r['KA.EVS.T5delete'] = { verdict: judge(probeObserved, (o) => o.status === 'done' && ['refused', 'audited'].includes(o.outcome), (o) => o.status === 'blocked' && o.ref === 'L112' && o.said === '200' && o.auditDeleteEvents === 0 && o.bacAfter === WP3.T1.bac.value), value: WP3.T5.deleteProbe.value, today: WP3.T5.deleteProbe.today, observed: probeObserved };
  // T7
  const before = out('checkpoint.T7.before');
  const after = out('checkpoint.T7.after');
  const subs = out('T7.submissions');
  const subStates = Object.fromEntries(Object.entries(subs).map(([k, s]) => [k, s.status]));
  r['EVS.T7'] = { ok: WP3.T7.value === 'byte_identical' && before.sha256 === after.sha256 && sameJson(subStates, { draft: 'draft', submitted: 'submitted', rejected: 'rejected' }), expected: { hash: 'byte_identical', submissions: { draft: 'draft', submitted: 'submitted', rejected: 'rejected' } }, observed: { before: before.sha256, after: after.sha256, submissions: subStates } };
  // periods
  const periods = out('periods');
  const runDates = [st.steps.periods.startedAt, st.steps.periods.finishedAt].filter(Boolean).map((at) => localDate(at, ZONE));
  const futures = runDates.map((d) => BOOK_RULES.futurePeriodFor(d));
  const future = Object.entries(periods).find(([, p]) => p.future);
  const futureOk = Boolean(future) && futures.some((f) => f.code === future[0] && future[1].cutoff === f.cutoff && future[1].cutoffInstant === BOOK_RULES.endOfLocalDay(f.cutoff, ZONE));
  r['EVS.periods'] = { ok: periods['2026-01']?.cutoffInstant === WP3.periods.jan.cutoff.value && periods['2026-02']?.cutoffInstant === WP3.periods.feb.cutoff.value && futureOk && Object.keys(periods).length === 3, expected: { jan: WP3.periods.jan.cutoff.value, feb: WP3.periods.feb.cutoff.value, future: futures }, observed: Object.fromEntries(Object.entries(periods).map(([code, p]) => [code, { cutoff: p.cutoff, cutoffInstant: p.cutoffInstant, future: p.future }])) };
  // the open February report and the February lock
  const febOpenOut = out('checkpoint.feb.open');
  const febOpen = summaryFigures(febOpenOut);
  const FEBS = WP3.periods.feb.snapshot;
  r['KA.EVS.febOpen'] = { verdict: febOpenOut.reporting?.isSnapshot === false && febOpenOut.reporting?.cutoffDate === WP3.periods.feb.cutoff.value ? metricVerdict(febOpen, FEBS) : 'wrong', value: valuesOf(FEBS), today: valuesOf(FEBS, METRIC_KEYS, 'today'), observed: { ...febOpen, isSnapshot: febOpenOut.reporting?.isSnapshot, cutoffDate: febOpenOut.reporting?.cutoffDate }, storedAt: febOpenOut.capturedAt || st.steps['checkpoint.feb.open'].finishedAt };
  const lockFeb = out('lock.2026-02');
  r['EVS.feb.lockAsPlanner'] = { ok: lockFeb.refusals?.planner === WP3.periods.lockAsPlanner.value, expected: WP3.periods.lockAsPlanner.value, observed: lockFeb.refusals?.planner ?? null };
  r['EVS.feb.financeWhileBlocked'] = { ok: lockFeb.refusals?.finance === WP3.periods.financeWhileBlocked.value, expected: WP3.periods.financeWhileBlocked.value, observed: lockFeb.refusals?.finance ?? null };
  r['EVS.feb.financeWithOverride'] = { ok: lockFeb.refusals?.financeOverride === WP3.periods.financeWithOverride.value, expected: WP3.periods.financeWithOverride.value, observed: lockFeb.refusals?.financeOverride ?? null };
  const febRecord = st.records?.['lock.2026-02'] || null;
  const febSnap = lockFeb.snapshot || {};
  const pmLock = { said: febRecord?.said ?? null, persona: febRecord?.persona ?? null, gateReadyBefore: lockFeb.gateBefore?.ready ?? null, isSnapshot: febSnap.reporting?.isSnapshot ?? null, snapshotId: febSnap.reporting?.snapshotId ?? null, reason: febSnap.readinessOverride?.reason ?? null, buildReason: lockFeb.overrideReason ?? null, equalsOpen: sameJson({ f: febSnap.figures, a: febSnap.alerts }, { f: febOpenOut.figures, a: febOpenOut.alerts }) };
  r['EVS.feb.lockByPm'] = { ok: statusPart(pmLock.said) === WP3.periods.feb.lockByPmWithReason.value && pmLock.persona === 'pm' && pmLock.gateReadyBefore === false && pmLock.isSnapshot === true && Boolean(pmLock.snapshotId) && Boolean(pmLock.reason) && pmLock.reason === pmLock.buildReason && pmLock.equalsOpen, expected: { said: WP3.periods.feb.lockByPmWithReason.value, persona: 'pm', gateReadyBefore: false, isSnapshot: true, reason: 'the build\'s overrideReason', equalsOpen: true }, observed: pmLock };
  const febSnapFig = summaryFigures(febSnap);
  r['KA.EVS.febSnapshot'] = { verdict: febSnap.reporting?.cutoffDate === WP3.periods.feb.cutoff.value ? metricVerdict(febSnapFig, FEBS) : 'wrong', value: valuesOf(FEBS), today: valuesOf(FEBS, METRIC_KEYS, 'today'), observed: { ...febSnapFig, cutoffDate: febSnap.reporting?.cutoffDate, lockedAt: febSnap.reporting?.lockedAt }, storedAt: febSnap.reporting?.lockedAt || st.steps['lock.2026-02'].finishedAt };
  // January, locked normally by finance
  const gateReady = out('gate.ready');
  const lockJan = out('lock.2026-01');
  const janRecord = st.records?.['lock.2026-01'] || null;
  const janSnap = lockJan.snapshot || {};
  const janObserved = { gateReady: gateReady.ready, said: janRecord?.said ?? null, persona: janRecord?.persona ?? null, isSnapshot: janSnap.reporting?.isSnapshot ?? null, readinessOverride: janSnap.readinessOverride ?? null, book: WP3.periods.jan.lock.value };
  r['EVS.jan.lockNormal'] = { ok: janObserved.gateReady === true && janObserved.said === '200' && janObserved.persona === 'finance' && janObserved.isSnapshot === true && janObserved.readinessOverride === null && WP3.periods.jan.lock.value === 'normal', expected: { gateReady: true, said: '200', persona: 'finance', isSnapshot: true, readinessOverride: null, lock: 'normal' }, observed: janObserved };
  const JANS = WP3.periods.jan.snapshot;
  const janFig = summaryFigures(janSnap);
  r['KA.EVS.janSnapshot'] = { verdict: janSnap.reporting?.cutoffDate === WP3.periods.jan.cutoff.value ? metricVerdict(janFig, JANS) : 'wrong', value: valuesOf(JANS), today: valuesOf(JANS, METRIC_KEYS, 'today'), observed: { ...janFig, cutoffDate: janSnap.reporting?.cutoffDate, lockedAt: janSnap.reporting?.lockedAt }, storedAt: janSnap.reporting?.lockedAt || st.steps['lock.2026-01'].finishedAt };
  // after the locks
  const alB = out('checkpoint.afterLock.before');
  const alC = out('checkpoint.afterLock.afterCost');
  const alA = out('checkpoint.afterLock.afterApproval');
  r['EVS.afterLock.periodReport'] = { ok: WP3.periods.afterLock.periodReport.value === 'byte_identical' && Boolean(alB.period?.sha256) && alC.period?.sha256 === alB.period.sha256 && alA.period?.sha256 === alB.period.sha256, expected: { periodReport: 'byte_identical', reference: alB.period?.sha256 ?? null }, observed: { afterCost: alC.period?.sha256 ?? null, afterApproval: alA.period?.sha256 ?? null } };
  const CAC = WP3.periods.afterLock.cutoffAfterCost;
  const c0228 = [[alB, WP3.T3], [alC, CAC], [alA, CAC]].map(([o, node]) => ({ cutoffDate: o.cutoff0228?.reporting?.cutoffDate ?? null, verdict: o.cutoff0228?.reporting?.cutoffDate === WP3.T3.cutoff.value ? metricVerdict(summaryFigures(o.cutoff0228), node) : 'wrong', ac: summaryFigures(o.cutoff0228)?.ac ?? null }));
  const vs = c0228.map((x) => x.verdict);
  r['KA.EVS.afterLock.cutoff0228'] = { verdict: vs.every((x) => x === 'value') ? 'value' : vs.every((x) => x === 'today') ? 'today' : 'wrong', value: { before: valuesOf(WP3.T3), after: valuesOf(CAC) }, today: { before: valuesOf(WP3.T3, METRIC_KEYS, 'today'), after: valuesOf(CAC, METRIC_KEYS, 'today') }, observed: { before: c0228[0], afterCost: c0228[1], afterApproval: c0228[2] }, storedAt: [alB, alC, alA].map((o) => o.capturedAt).filter(Boolean).sort().pop() || st.steps['checkpoint.afterLock.afterApproval'].finishedAt };
  const RDC = WP3.periods.afterLock.runDateAfterCost[branch];
  const rdc = summaryFigures(alC.today);
  r['EVS.afterLock.runDateAfterCost'] = { ok: Boolean(RDC) && metricVerdict(rdc, RDC) === 'value', expected: RDC ? valuesOf(RDC) : `no branch ${branch}`, observed: rdc };
  const RDA = WP3.periods.afterLock.runDateAfterApproval[branch];
  const rda = summaryFigures(alA.today);
  r['EVS.afterLock.runDateAfterApproval'] = { ok: Boolean(RDA) && metricVerdict(rda, RDA) === 'value' && rda?.ev === WP3.periods.afterLock.runDateEv.value, expected: RDA ? { ...valuesOf(RDA), runDateEv: WP3.periods.afterLock.runDateEv.value } : `no branch ${branch}`, observed: rda };
  // T6
  const t6bOut = out('checkpoint.T6.before');
  const t6b = summaryFigures(t6bOut);
  const T6B = WP3.T6.before[branch];
  r['EVS.T6.before'] = { ok: Boolean(T6B) && metricVerdict(t6b, T6B) === 'value' && t6bOut.ledgerDelta === WP3.T6.ledgerDelta.value && t6b?.ac === WP3.T6.acBeforeRetirement.value, expected: T6B ? { ...valuesOf(T6B), ledgerDelta: WP3.T6.ledgerDelta.value } : `no branch ${branch}`, observed: { ...t6b, ledgerDelta: t6bOut.ledgerDelta } };
  const t6aOut = out('checkpoint.T6.after');
  const t6a = summaryFigures(t6aOut);
  const T6A = WP3.T6.after[branch];
  r['KA.EVS.T6.after'] = { verdict: T6A ? metricVerdict(t6a, T6A) : 'wrong', value: T6A ? valuesOf(T6A) : null, today: T6A ? valuesOf(T6A, METRIC_KEYS, 'today') : null, observed: t6a };
  // zone on every stored read and period answer
  const reads = [];
  const addRead = (label, summary) => { if (summary?.reporting) reads.push([label, zoneOf(summary.reporting)]); };
  for (const step of ['checkpoint.T1', 'checkpoint.T2', 'checkpoint.T3', 'checkpoint.T5', 'checkpoint.T7.before', 'checkpoint.T7.after', 'checkpoint.feb.open', 'checkpoint.T6.before', 'checkpoint.T6.after']) addRead(step, out(step));
  for (const step of ['checkpoint.afterLock.before', 'checkpoint.afterLock.afterCost', 'checkpoint.afterLock.afterApproval']) for (const part of ['period', 'cutoff0228', 'today']) addRead(`${step}.${part}`, out(step)[part]);
  addRead('lock.2026-02.snapshot', lockFeb.snapshot);
  addRead('lock.2026-01.snapshot', lockJan.snapshot);
  for (const [code, p] of Object.entries(periods)) reads.push([`periods.${code}`, zoneOf(p)]);
  const badZones = reads.filter(([, z]) => !sameJson(z, ZONE_EXPECT));
  r['EVS.zone'] = { ok: reads.length >= 20 && badZones.length === 0, expected: { ...ZONE_EXPECT, planValue: WP3.setup.timeZoneSource.planValue }, observed: { reads: reads.length, departures: badZones }, detail: `the plan's 'organisation' (premise A8) is the leaf's planValue; WP3-TZ-1 is CF.WP3TZ1` };
  return r;
};
/** 052-SCH-EV's stored WP-3 moments (STORED_UNITS: wp3.T1/T2 in the book's units, wp3.T3 in the report's). */
const storedD2 = (st) => {
  const r = {};
  const t1 = outOf(st, 'wp3.T1');
  const T1 = D2.WP3.T1;
  const t1Keys = Object.keys(T1).filter((k) => T1[k] && typeof T1[k] === 'object' && 'value' in T1[k]);
  const t1Bad = t1Keys.filter((k) => !sameJson(T1[k].unit === 'ratio' ? r6(t1[k]) : T1[k].unit === 'cents' ? storedCents('052-SCH-EV', 'wp3.T1', t1[k]) : t1[k], expectOf(T1, k, 'value')));
  const bac = Object.values(D2.WP3.setup.allocations.value).reduce((s, x) => s + x, 0);
  const zone = { timeZone: t1.timeZone ?? null, timeZoneSource: t1.timeZoneSource ?? null, timeZoneNote: t1.timeZoneNote ?? null };
  const zoneWant = { timeZone: D2.WP3.timeZone.value, timeZoneSource: D2.WP3.timeZoneSource.value, timeZoneNote: D2.WP3.timeZoneNote.value };
  r['D2.stored.T1'] = { ok: t1Bad.length === 0 && storedCents('052-SCH-EV', 'wp3.T1', t1.bac) === bac && sameJson(zone, zoneWant), expected: { ...valuesOf(T1, t1Keys), bac, ...zoneWant }, observed: t1, detail: t1Bad.length ? `departures: ${t1Bad.join(', ')}` : '' };
  const t2 = outOf(st, 'wp3.T2');
  const T2 = D2.WP3.T2;
  const t2Keys = Object.keys(T2).filter((k) => T2[k] && typeof T2[k] === 'object' && 'value' in T2[k]);
  const t2Bad = t2Keys.filter((k) => !sameJson(T2[k].unit === 'ratio' ? r6(t2[k]) : T2[k].unit === 'cents' ? storedCents('052-SCH-EV', 'wp3.T2', t2[k]) : t2[k], expectOf(T2, k, 'value')));
  r['D2.stored.T2'] = { ok: t2Bad.length === 0, expected: valuesOf(T2, t2Keys), observed: t2, detail: t2Bad.length ? `departures: ${t2Bad.join(', ')}` : '' };
  const step = st.steps?.['wp3.T3'];
  const T3 = D2.WP3.T3;
  let o = null;
  const u3 = (field, value) => storedCents('052-SCH-EV', field, value);
  if (step?.status === 'done') o = { from: 'out', pv: u3('wp3.T3.out', step.out?.pv), ev: u3('wp3.T3.out', step.out?.ev), ac: u3('wp3.T3.out', step.out?.ac), cutoffDate: step.out?.cutoffDate ?? null };
  else if (step?.status === 'blocked' && step.blocked?.ref === 'L34') o = { from: 'blocked L34', pv: u3('wp3.T3.blocked.observed', step.blocked.observed?.pv), ev: u3('wp3.T3.blocked.observed', step.blocked.observed?.ev), ac: u3('wp3.T3.blocked.observed', step.blocked.observed?.today), cutoffDate: step.blocked.observed?.cutoffDate ?? null };
  const frame = Boolean(o) && o.pv === T3.pv.value && o.ev === T3.ev.value && o.cutoffDate === T3.cutoff.value;
  r['KA.D2.stored.T3'] = { verdict: !frame ? 'wrong' : o.ac === T3.ac.value ? 'value' : o.ac === T3.ac.today ? 'today' : 'wrong', value: { cutoff: T3.cutoff.value, pv: T3.pv.value, ev: T3.ev.value, ac: T3.ac.value }, today: { ac: T3.ac.today }, observed: o || { status: step?.status ?? 'not run' }, storedAt: step?.finishedAt ?? null };
  return r;
};
/** 006-LITE's stored ev.T1 (STORED_UNITS: the book's units). */
const storedD3 = (st) => {
  const t1 = outOf(st, 'ev.T1');
  const T1 = D3.WP3.T1;
  const fig = Object.fromEntries(METRIC_KEYS.map((k) => [k, T1[k].unit === 'ratio' ? r6(t1[k]) : T1[k].unit === 'cents' ? storedCents('006-LITE', 'ev.T1', t1[k]) : t1[k] ?? null]));
  const zone = { timeZone: t1.timeZone ?? null, timeZoneSource: t1.timeZoneSource ?? null, timeZoneNote: t1.timeZoneNote ?? null };
  const zoneWant = { timeZone: D3.WP3.timeZone.value, timeZoneSource: D3.WP3.timeZoneSource.value, timeZoneNote: D3.WP3.timeZoneNote.value };
  return { 'D3.stored.T1': { ok: metricVerdict(fig, T1) === 'value' && sameJson(zone, zoneWant), expected: { ...valuesOf(T1), ...zoneWant }, observed: { ...fig, ...zone } } };
};

// ── static scans of backend/src (read only; tests, live suites, mocks and the OpenAPI text excluded) ──
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
/** The top-level declaration a line sits in: the nearest line above it that starts a const / function / class at column 0. */
const enclosingDecl = (lines, i) => {
  for (let j = i; j >= 0; j -= 1) {
    const m = /^(?:const|let|var|async function|function|class)\s+([A-Za-z0-9_$]+)/.exec(lines[j]);
    if (m) return { name: m[1], start: j };
  }
  return { name: null, start: 0 };
};
/** WP3-TZ-1 by code reading (WP3ADJ Q14): who writes Organisation.defaultTimezone or Project.timezone, and whether the project API takes a zone. */
const zoneScan = () => {
  const orgWrites = [];
  for (const f of srcFiles()) {
    f.lines.forEach((line, i) => {
      if (/\borganisation\s*\.\s*(update|updateMany|upsert)\s*\(/.test(line) || /UPDATE\s+"Organisation"/i.test(line)) {
        const decl = enclosingDecl(f.lines, i);
        const body = f.lines.slice(decl.start, i + 8).join('\n');
        orgWrites.push({ file: f.rel, line: i + 1, fn: decl.name, writesZone: /defaultTimezone|workspaceDefaults/.test(body) });
      }
    });
  }
  const pf = fileOf('services/project.service.js');
  const projectZoneWrites = [];
  pf?.lines.forEach((line, i) => { if (/\btimezone\s*=(?!=)|\btimezone\s*:\s*(?!true\b|false\b)/.test(line) && !/^\s*(\/\/|\*)/.test(line)) projectZoneWrites.push({ line: i + 1, fn: enclosingDecl(pf.lines, i).name, text: line.trim().slice(0, 120) }); });
  const routes = fileOf('routes/projects.js');
  const zoneFields = routes ? routes.lines.map((line, i) => [line, i + 1]).filter(([line]) => /body\(\s*["'](timezone|timeZone)["']/.test(line)).map(([, n]) => n) : null;
  return { orgWrites, projectZoneWrites, zoneFields };
};
/** HR-E4 by code reading: where the 0.9 flags are computed, whether the EV service sends a notice, whether an exception rule tests SPI. */
const alertScan = () => {
  const flagSites = [];
  const spiRules = [];
  for (const f of srcFiles()) {
    f.lines.forEach((line, i) => {
      if (/\b(spiAlert|cpiAlert)\s*:[^,]*<=?\s*0\.9/.test(line)) flagSites.push(`${f.rel}:${i + 1}`);
      if (f.rel.startsWith('services/exception-rules/') && (/\bspi\s*(<|<=|>|>=)\s*[\w.]/i.test(line) || /(<|<=|>|>=)\s*[\w.]*\bspi\b/i.test(line)) && !/^\s*(\/\/|\*)/.test(line)) spiRules.push(`${f.rel}:${i + 1}`);
    });
  }
  const ev = fileOf('services/earned-value.service.js');
  const notices = ev ? ev.lines.map((line, i) => [line, i + 1]).filter(([line]) => /require\([^)]*notif/i.test(line)).map(([, n]) => n) : null;
  return { flagSites, spiRules, evNoticeRequires: notices };
};
/** L113: the period routes (no unlock). L106: what budgetLineRisks reads and what the register serializes. */
const periodRouteScan = () => {
  const routes = fileOf('routes/reports.js');
  return { unlockMentions: routes ? routes.lines.map((line, i) => [line, i + 1]).filter(([line]) => /unlock/i.test(line)).map(([, n]) => n) : null };
};
const l106Scan = () => {
  const fc = fileOf('services/forecast.service.js');
  const bs = fileOf('services/budget.service.js');
  const bodyOf = (f, name) => {
    if (!f) return null;
    const start = f.lines.findIndex((line) => new RegExp(`^const ${name}\\s*=`).test(line));
    if (start < 0) return null;
    let end = f.lines.length;
    for (let j = start + 1; j < f.lines.length; j += 1) if (/^(?:const|let|function|async function|module\.exports)\b/.test(f.lines[j])) { end = j; break; }
    return f.lines.slice(start, end).join('\n');
  };
  const risks = bodyOf(fc, 'budgetLineRisks');
  const serializer = bodyOf(bs, 'serializeLine');
  return { readsRevised: risks === null ? null : /\bline\.revised\b/.test(risks), registerEmitsRevisedBudget: serializer === null ? null : /\brevisedBudget\s*:/.test(serializer), registerEmitsRevised: serializer === null ? null : /^\s*revised\s*:/m.test(serializer) };
};

// ── setup ──────────────────────────────────────────────────────────────────────
/** The build steps whose stored outputs (moment figures and ids) the proof reads, per state file, and the BLOCKED refs allowed. */
const STATE_STEPS = {
  '087-EV': ['project', 'activities', 'boq', 'allocations', 'loadings', 'progress', 'directCosts', 'checkpoint.T1', 'checkpoint.T2', 'checkpoint.T3', 'verdict.checkpoint.T3', 'checkpoint.T5', 'probe.T5.delete', 'checkpoint.T7.before', 'T7.submissions', 'checkpoint.T7.after', 'periods', 'checkpoint.feb.open', 'verdict.checkpoint.feb.open', 'lock.2026-02', 'verdict.lock.2026-02', 'gate.ready', 'lock.2026-01', 'verdict.lock.2026-01', 'checkpoint.afterLock.before', 'verdict.checkpoint.afterLock.before', 'checkpoint.afterLock.afterCost', 'verdict.checkpoint.afterLock.afterCost', 'checkpoint.afterLock.afterApproval', 'verdict.checkpoint.afterLock.afterApproval', 'checkpoint.T6.before', 'activate.F1r', 'checkpoint.T6.after', 'verdict.checkpoint.T6.after'],
  '087-SCH': ['project'],
  '052-SCH-EV': ['project', 'wp3.T1', 'wp3.T2', 'wp3.T3'],
  '006-LITE': ['project', 'ev.T1'],
  '087-EXTRAS': ['people', 'templates', 'members'],
};
const ALLOWED_BLOCKED = {
  '087-EV': { 'verdict.checkpoint.T3': 'L34', 'verdict.checkpoint.feb.open': 'L34', 'verdict.lock.2026-02': 'L34', 'verdict.lock.2026-01': 'L34', 'verdict.checkpoint.afterLock.before': 'L34', 'verdict.checkpoint.afterLock.afterCost': 'L34', 'verdict.checkpoint.afterLock.afterApproval': 'L34', 'probe.T5.delete': 'L112', 'verdict.checkpoint.T6.after': 'HR-S9' },
  '052-SCH-EV': { 'wp3.T3': 'L34' },
};
const PERSONAS = { pm: ['087', 'pm'], planner: ['087', 'planner'], qs: ['087', 'qs'], cost: ['087', 'cost'], site: ['087', 'site'], finance: ['087', 'finance'], pm052: ['052', 'pm'], cost052: ['052', 'cost'], pm006: ['006', 'pm'] };
/** The 087 staff named by other builds, never the actor-role member: 087-OTH's only-here QS (build/087-oth.js STAFF) and 087-EXTRAS's people. */
const STAFF_TAKEN = ['mateo.wang.6', 'lucia.haddad.20'];
const ACTOR_PROJECT_ROLE = 'cost_controller';

const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  const specs = Object.fromEntries(h.companies(...NEED_COMPANIES).map((c) => [c.code, c]));
  ctx.specs = specs;
  const problems = [];
  for (const code of NEED_COMPANIES) {
    const rows = await ctx.q('select id, slug, name from "Organisation" where slug like $1', [`cert-${code}-%`]);
    if (rows.length !== 1) { problems.push(`company ${code}: ${rows.length} organisations, exactly one expected`); continue; }
    try {
      ctx.orgs[code] = certEnv.assertCertOrganisation(rows[0]) || rows[0];
    } catch (error) {
      problems.push(`company ${code}: ${error.message}`);
    }
  }
  const needPersona = (key) => {
    const [code] = PERSONAS[key];
    if (!NEED_COMPANIES.includes(code) || !ctx.orgs[code]) return false;
    if (key === 'pm052' || key === 'pm006') return true;
    if (key === 'cost052') return NEED_DEEP.includes('052-SCH-EV');
    return true;
  };
  for (const [key, [code, who]] of Object.entries(PERSONAS)) {
    if (!needPersona(key)) continue;
    const email = `${who}@${specs[code].domain}`;
    ctx.sessions[key] = api.as({ email, orgId: ctx.orgs[code].id });
    const me = await get(key, '/auth/me');
    if (me.status !== 200) problems.push(`${key} (${email}): GET /auth/me ${h.said(me)}`);
    else {
      ctx.people[key] = me.body?.data?.id;
      if ((me.body?.data?.active?.orgId ?? me.body?.data?.orgId) !== ctx.orgs[code].id) problems.push(`${key}: session in another org`);
    }
  }
  // The actor-role member (WP3ADJ Q13): the first 087 staff QS by e-mail that no other build names (087-OTH's only-here QS,
  // 087-EXTRAS's people); org role qs, assigned on V as cost_controller. Taken off V's team in cleanup.
  if (NEED_V && ctx.orgs['087']) {
    let taken = [...STAFF_TAKEN];
    try { taken = [...taken, ...Object.values(readState('087-EXTRAS').steps?.people?.out || {}).map((p) => p?.key).filter(Boolean)]; } catch { /* 087-EXTRAS not built: the fixed names stand */ }
    const spec = specs['087'];
    const candidates = (spec.people || []).filter((p) => p.role === 'qs' && p.email.split('@')[0] !== 'qs' && !taken.includes(p.email.split('@')[0])).sort((a, b) => a.email.localeCompare(b.email));
    const person = candidates[0] || null;
    if (!person) problems.push(`actor-role member: no 087 staff QS outside ${taken.join(', ')}`);
    else {
      ctx.sessions.actor = api.as({ email: person.email, orgId: ctx.orgs['087'].id });
      const me = await get('actor', '/auth/me');
      const role = String(me.body?.data?.role ?? me.body?.data?.active?.role ?? '').toLowerCase();
      if (me.status !== 200 || role !== 'qs') problems.push(`actor-role member ${person.email}: GET /auth/me ${h.said(me)}, role ${role || 'none'} (qs expected)`);
      else { ctx.people.actor = me.body.data.id; ctx.actorKey = person.email.split('@')[0]; }
    }
  }
  rec('S.companies', problems.length === 0, { observed: { orgs: Object.fromEntries(Object.entries(ctx.orgs).map(([c, o]) => [c, { id: o.id, slug: o.slug }])), people: Object.keys(ctx.people), actor: ctx.actorKey || null }, detail: problems.join('; ') || `${NEED_COMPANIES.length} companies (${NEED_COMPANIES.join(', ')}), ${Object.keys(ctx.people).length} sessions` });
  if (problems.length) throw new Error(`setup: ${problems.join('; ')}`);

  // The build state files the selected checks read: moment figures and ids only (and 087-EXTRAS's T-NOBOQ member).
  const stateProblems = [];
  const needStates = [...NEED_DEEP, ...(NEED_EXTRAS ? ['087-EXTRAS'] : [])];
  for (const code of needStates) {
    try {
      ctx.state[code] = readState(code);
      for (const step of STATE_STEPS[code]) {
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
  if (NEED_EXTRAS && ctx.state['087-EXTRAS']?.steps?.people?.status === 'done') {
    // The member denied boq:read (087-EXTRAS T-NOBOQ on 087-SCH; WP3.forecast.siteEngineerMoneyMember): signed in as the state names them.
    const { key, userId } = ctx.state['087-EXTRAS'].steps.people.out.noBoq || {};
    const spec = ctx.specs['087'];
    const person = key ? (spec.people || []).find((x) => x.email === `${key}@${spec.domain}`) : null;
    if (!person || key !== WP3.forecast.siteEngineerMoneyMember.value.personaKey) stateProblems.push(`087-EXTRAS people.noBoq ${key}: not a person of 087's population, or not WP3.forecast.siteEngineerMoneyMember (${WP3.forecast.siteEngineerMoneyMember.value.personaKey})`);
    else {
      ctx.sessions.noBoq = api.as({ email: person.email, orgId: ctx.orgs['087'].id });
      const me = await get('noBoq', '/auth/me');
      if (me.status !== 200) stateProblems.push(`noBoq (${key}): GET /auth/me ${h.said(me)}`);
      else if (me.body?.data?.id !== userId || String(me.body?.data?.role).toLowerCase() !== 'site_engineer') stateProblems.push(`noBoq (${key}): user ${me.body?.data?.id} role ${me.body?.data?.role}; the state names ${userId} (site_engineer)`);
      else ctx.people.noBoq = userId;
    }
  }
  // The L34 fix commit, when set, is the one git dates (WP3ADJ Q3).
  if (L34_FIX.commit || L34_FIX.committedAt) {
    const shown = spawnSync('git', ['-C', REPO, 'show', '-s', '--format=%cI', String(L34_FIX.commit)], { encoding: 'utf8' });
    const gitAt = shown.status === 0 ? shown.stdout.trim() : null;
    obs.l34FixGit = { commit: L34_FIX.commit, committedAt: L34_FIX.committedAt, git: gitAt, error: shown.status === 0 ? null : String(shown.stderr || shown.error || '').slice(0, 300) };
    if (!L34_FIX.commit || !L34_FIX.committedAt || !gitAt || Date.parse(gitAt) !== Date.parse(L34_FIX.committedAt)) stateProblems.push(`L34_FIX ${json(L34_FIX)}: git dates the commit ${gitAt || 'not at all'}; set both fields from git show -s --format=%cI <commit>`);
  }
  rec('S.state', stateProblems.length === 0, { observed: Object.fromEntries(Object.entries(ctx.state).map(([c, s]) => [c, { projectId: s.projectId, runs: s.runs?.length, updatedAt: s.updatedAt }])), detail: stateProblems.join('; ') || `${needStates.length} state files (${needStates.join(', ') || 'none needed'}), every needed step done or BLOCKED with its moment-map ref; L34 fix ${L34_FIX.commit || 'not set'}` });

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

  // 087-EV: the branch the T5 delete probe left, and the reporting gate now (blocked: the relocks write nothing even under M2b).
  const ev087 = NEED_DEEP.includes('087-EV');
  ctx.branch = ev087 ? branchOf(ctx.state['087-EV']) : null;
  const probeStep = ctx.state['087-EV']?.steps?.['probe.T5.delete'];
  rec('S.branch', !ev087 || ctx.branch !== null, { expected: 'revisionDeleted (BLOCKED L112 or audited) or revisionKept (refused)', observed: ev087 ? { branch: ctx.branch, status: probeStep?.status ?? null, ref: probeStep?.blocked?.ref ?? null, outcome: probeStep?.out?.outcome ?? null } : null, detail: ev087 ? '' : 'not needed (no selected check reads 087-EV)' });
  if (ev087 && ctx.branch === null) throw new Error('setup: the T5 delete probe left no branch the book knows');
  const live087 = ACTIVE.some((c) => c.where === '087-EV' && !c.id.startsWith('S.'));
  if (live087) ctx.gate087EV = await gateOf(ctx.deep['087-EV'].id);
  rec('S.gate087EV', !live087 || ctx.gate087EV?.ready === false, { expected: { ready: false }, observed: live087 ? { ready: ctx.gate087EV?.ready ?? null, blockers: (ctx.gate087EV?.blockers || []).map((b) => b.code) } : null, detail: live087 ? '' : 'not needed (no selected check reads 087-EV live)' });

  // The throwaway project V of 087 (WP3ADJ Q1; WP3.V.inputs); the PM is its creator.
  if (NEED_V) ctx.v = await makeV();
  const teamOk = !NEED_V || (ctx.v.members.every((m) => [200, 201].includes(m.res.status)) && ctx.v.members.length === 6);
  rec('S.throwaway', teamOk, { observed: ctx.v ? { id: ctx.v.id, created: h.said(ctx.v.created), team: ctx.v.members.map((m) => `${m.key} ${m.role} ${h.said(m.res)}`) } : null, detail: `V ${ctx.v?.id || 'not needed (no selected check runs on V)'}` });
  if (!teamOk) throw new Error('setup: V\'s team could not be set');
};

/** The project of 087 this run creates (archived in cleanup, the actor-role member taken off its team first): { id, P }. */
const makeV = async () => {
  const name = String(VI.project.name).replace('<stamp>', h.STAMP);
  const created = await send('pm', 'POST', '/projects', { name, startDate: VI.project.start, endDate: VI.project.end, projectCalendar: VI.project.calendar, currency: VI.project.currency, type: VI.project.projectType, contractType: VI.project.contractType });
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (!id) throw new Error(`V could not be created: ${h.said(created)} ${created.body?.error?.message || ''}`);
  ctx.cleanup.push(async () => {
    const res = await send('pm', 'DELETE', `/projects/${id}`);
    const row = (await ctx.q('select "archivedAt"::text as a from "Project" where id = $1', [id]))[0];
    return `V ${id} archive ${h.said(res)}, archivedAt ${row?.a || 'NOT SET'}`;
  });
  if (!/cost_controller/.test(String(VI.team.actorRole))) throw new Error('WP3.V.inputs.team.actorRole does not name cost_controller');
  const team = [['planner', VI.team.planner], ['qs', VI.team.qs], ['cost', VI.team.cost], ['site', VI.team.site], ['finance', VI.team.finance], ['actor', ACTOR_PROJECT_ROLE]];
  const members = [];
  for (const [key, role] of team) {
    const res = await send('pm', 'POST', `/projects/${id}/team`, { userId: ctx.people[key], role });
    members.push({ key, role, res });
    if (key === 'actor' && [200, 201].includes(res.status)) {
      ctx.cleanup.push(async () => `actor-role member ${ctx.actorKey} off V's team ${h.said(await send('pm', 'DELETE', `/projects/${id}/team/${ctx.people.actor}`))}`);
    }
  }
  return { id, P: `/projects/${id}`, name, created, members, ids: {}, items: {}, codes: {} };
};

// ── V: X1/X2/X3, the bill, the allocations, the cost codes, the L106 line, the gate (S.V.fixture) ──
const vSetup = async () => {
  if (!NEED_V) {
    rec('S.V.fixture', true, { detail: 'not needed (no selected check runs on V)' });
    return;
  }
  const v = ctx.v;
  const { P } = v;
  // V1: hand-built activities with the book's dates (no duration: no CPM rewrites them), the site engineer on each
  const made = [];
  for (const [i, [code, start, end]] of VI.activities.entries()) {
    const res = await send('planner', 'POST', `${P}/activities`, { name: `CERT3 WP3 ${code} ${h.STAMP}`, activityCode: code, wbsCode: 'WP3-V', category: 'civil', startDate: start, endDate: end, sortOrder: i, engineerIds: [ctx.people.site] });
    v.ids[code] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push([code, h.said(res)]);
  }
  const acts = listOf(await dataOf('planner', `${P}/activities`));
  const dates = Object.fromEntries(VI.activities.map(([code]) => { const a = acts.find((x) => x.id === v.ids[code]); return [code, a ? [dayOf(a.startDate), dayOf(a.endDate), (a.assignedEngineers || []).some((e) => (e?.id ?? e) === ctx.people.site)] : null]; }));
  const datesOk = VI.activities.every(([code, start, end]) => sameJson(dates[code], [start, end, true]));
  // V2: the bill (QS); V3: each row allocated whole to its activity (planner creates and submits, the QS approves)
  const items = [];
  for (const [code, quantity, unit, rate] of VI.boq) {
    const res = await send('qs', 'POST', `${P}/boq/items`, { code, description: `CERT3 WP3 ${code} ${h.STAMP}`, quantity, unit, rate });
    v.items[code] = res.status === 201 ? res.body?.data?.item?.id ?? res.body?.data?.id ?? null : null;
    items.push([code, h.said(res)]);
  }
  const allocs = [];
  for (const [code, quantity, , rate, activity] of VI.boq) {
    const created = await send('planner', 'POST', `${P}/activity-boq-allocations`, { boqItemId: v.items[code], activityId: v.ids[activity], quantity, amount: quantity * rate, source: 'manual', notes: `CERT3 WP3 ${code} to ${activity} ${h.STAMP}` });
    const aid = created.body?.data?.id || null;
    const submitted = aid ? await send('planner', 'POST', `${P}/activity-boq-allocations/${aid}/submit`, {}) : null;
    const approved = aid ? await send('qs', 'POST', `${P}/activity-boq-allocations/${aid}/approve`, {}) : null;
    allocs.push([`${code}.${activity}`, h.said(created), submitted ? h.said(submitted) : null, approved ? h.said(approved) : null, approved?.body?.data?.status ?? null]);
  }
  const allocOk = allocs.length === VI.boq.length && allocs.every(([, c, s, a, status]) => c === '201' && s === '200' && a === '200' && status === 'approved');
  // V4: cost codes 01-100 (direct costs) and 02-100 (the L106 line) from 087's library, selected; the one budget line
  const library = await dataOf('cost', `${P}/budget/cost-codes`);
  const codeRow = (code) => listOf(library?.available).filter((c) => c.code === code);
  const codeIds = {};
  for (const code of [VI.directCostCode, VI.l106Line.costCode]) { const rows = codeRow(code); codeIds[code] = rows.length === 1 ? rows[0].id : null; }
  const select = Object.values(codeIds).every(Boolean) ? await send('cost', 'PUT', `${P}/budget/cost-codes`, { costCodeIds: Object.values(codeIds) }) : null;
  v.codes = codeIds;
  const line = codeIds[VI.l106Line.costCode] ? await send('cost', 'POST', `${P}/budget/lines`, { costCodeId: codeIds[VI.l106Line.costCode], costType: 'material', description: `CERT3 WP3 L106 line ${h.STAMP}`, originalBudget: VI.l106Line.originalBudget }) : null;
  const lines = listOf(await dataOf('cost', `${P}/budget/lines`));
  const lineOk = lines.length === 1 && lines[0].costCode?.code === VI.l106Line.costCode && cents(lines[0].revisedBudget) === cents(VI.l106Line.originalBudget) && cents(lines[0].actual) === 0 && lines[0].status === VI.l106Line.status;
  // BAC and the reporting gate
  const bac = await evRead('cost', P, `?cutoffDate=${cairoToday()}`);
  const gate = await gateOf(v.id);
  const fixture = { made, dates, items, allocs, codes: codeIds, select: select ? h.said(select) : null, line: line ? h.said(line) : null, lines: lines.map((l) => ({ code: l.costCode?.code, revisedBudget: l.revisedBudget, actual: l.actual, status: l.status })), bac: bac.figures?.bac ?? null, zone: zoneOf(bac.report?.reporting), gateReady: gate?.ready ?? null };
  obs.vFixture = fixture;
  const ok = made.every(([, said]) => said === '201') && datesOk && items.every(([, said]) => said === '201') && allocOk && select?.status === 200 && line?.status === 201 && lineOk
    && bac.figures?.bac === WP3.V.bac.value && sameJson(fixture.zone, ZONE_EXPECT) && gate?.ready === WP3.V.reportingGateReady.value;
  rec('S.V.fixture', ok, { expected: { activities: VI.activities, bac: WP3.V.bac.value, line: VI.l106Line, zone: ZONE_EXPECT, gateReady: WP3.V.reportingGateReady.value }, observed: fixture });
  if (!ok) throw new Error(`V: the fixture could not be set up (${json(fixture, 900)})`);
};

// ── V: the WP-3 choreography V5-V25 (WP3.V.choreography, binding order) ──────
const vFlow = async () => {
  const v = ctx.v;
  const { P } = v;
  const id = v.ids;
  const A = (code) => `${P}/activities/${id[code]}`;
  /** A progress submission: { res, sid }. */
  const submit = async (code, pct, status, label) => {
    const res = await send('site', 'POST', `${A(code)}/progress`, { pctComplete: pct, progressMethod: 'percent', status, source: 'manual', notes: `CERT3 WP3 ${label} ${h.STAMP}` });
    return { res, sid: res.status === 200 ? res.body?.data?.submission?.id || null : null };
  };
  const approveProgress = (code, sid) => send('qs', 'POST', `${A(code)}/progress-submissions/${sid}/approve`, {});
  /** A direct cost: created and submitted by the cost controller, approved by finance; the step needs it approved. */
  const directCost = async ([code, amount, date], label) => {
    const description = `CERT3 WP3 ${label}: ${code} ${amount} incurred ${date} ${h.STAMP}`;
    const created = await send('cost', 'POST', `${P}/direct-costs`, { type: 'expense', description, vendorName: `CERT3 WP3 payee ${h.STAMP}`, costDate: date, lines: [{ description, costCodeId: v.codes[VI.directCostCode], activityId: id[code], costType: 'material', quantity: 1, unit: 'ls', unitCost: amount, amount }] });
    const dcId = created.status === 201 ? created.body?.data?.id || null : null;
    const submitted = dcId ? await send('cost', 'POST', `${P}/direct-costs/${dcId}/submit`, {}) : null;
    const approved = dcId ? await send('finance', 'POST', `${P}/direct-costs/${dcId}/approve`, {}) : null;
    need(approved?.status === 200 && approved.body?.data?.status === 'approved', `the direct cost ${label} was not approved (${h.said(created)} / ${submitted ? h.said(submitted) : '-'} / ${approved ? h.said(approved) : '-'})`);
    return dcId;
  };
  /** A cost loading: created submitted by the cost controller, approved by the PM; the step needs it approved. */
  const loading = async ([code, amount, date], label) => {
    const created = await send('cost', 'POST', `${P}/reports/cost-loading`, { activityId: id[code], plannedDate: date, plannedValue: amount, source: 'manual', status: 'submitted', notes: `CERT3 WP3 ${label} ${h.STAMP}` });
    const lid = created.status === 201 ? created.body?.data?.id || null : null;
    const approved = lid ? await send('pm', 'POST', `${P}/reports/cost-loading/${lid}/approve`, {}) : null;
    need(approved?.status === 200 && approved.body?.data?.status === 'approved', `the cost loading ${label} was not approved (${h.said(created)} / ${approved ? h.said(approved) : '-'})`);
    return lid;
  };
  /** The run-date read on V (cut at the Cairo date of the read, as the 087-EV build reads 'today'). */
  const runDate = async () => { const today = cairoToday(); return { today, ...(await evRead('cost', P, `?cutoffDate=${today}`)) }; };
  const cutOk = (read, local) => read.res.status === 200 && read.report?.reporting?.cutoffLocalDate === local && read.report?.reporting?.cutoffDate === BOOK_RULES.endOfLocalDay(local, ZONE) && sameJson(zoneOf(read.report?.reporting), ZONE_EXPECT);
  const periodsOfV = async () => listOf(await dataOf('cost', `${P}/reports/periods`));
  const periodStatus = async (periodId) => (await periodsOfV()).find((p) => p.id === periodId)?.status ?? null;
  const makePeriod = async (def, label) => send('cost', 'POST', `${P}/reports/periods`, { code: def.code, label: `CERT3 WP3 ${label} ${h.STAMP}`, periodStart: def.start, periodEnd: def.end, cutoffDate: def.cutoff });
  const lockRoute = (periodId) => `${P}/reports/periods/${periodId}/lock`;
  const snapshotRows = async (periodId) => Number((await ctx.q('select count(*)::int as n from "EvPeriodSnapshot" where "reportingPeriodId" = $1', [periodId]))[0].n);
  const overriddenFor = async (periodId) => (await auditEvents(P, `entityType=${WP3.periods.feb.overriddenAuditFilter.value.query.entityType}&action=${WP3.periods.feb.overriddenAuditFilter.value.query.action}&source=${WP3.periods.feb.overriddenAuditFilter.value.query.source}`)).filter((e) => e.summary?.periodId === periodId);

  // ── V5: L106, before any cost (WP3.forecast.L106fixture) ──
  if (wants('KA.FC.L106', 'CF.L106')) await probe('KA.FC.L106 (V5)', async () => {
    const res = await get('pm', `${P}/forecast`);
    const f = res.body?.data;
    if (res.status !== 200 || f?.available !== true || !f?.cost) throw probeSetup('KA.FC.L106', `GET /forecast answered ${h.said(res)} (available ${f?.available})`);
    const lines = listOf(f.cost.budgetLines).map((l) => ({ costCode: l.costCode ?? null, revised: cents(l.revised), committed: cents(l.committed), actual: cents(l.actual), forecast: cents(l.forecast), overrun: cents(l.overrun), overrunPct: l.overrunPct ?? null, level: l.level ?? null }));
    const observed = { lines, count: num(f.cost.counts?.lines) };
    obs.l106 = observed;
    const leaf = WP3.forecast.L106budgetLines;
    const counts = WP3.forecast.L106counts;
    ka('KA.FC.L106', { ref: leaf.ref, value: { lines: leaf.value, count: counts.value }, today: { lines: leaf.today, count: counts.today }, observed, verdict: judge(observed, (o) => sameJson(o.lines, leaf.value) && o.count === counts.value, (o) => sameJson(o.lines, leaf.today) && o.count === counts.today) });
  });

  // ── V6-V13: T4's four reads (WP3.T4.fixture; WP3ADJ Q2: the report through the in-process app) ──
  const x1 = await submit('X1', VI.progressT4.X1, 'submitted', 'V6 X1');
  const x1ok = x1.sid ? await approveProgress('X1', x1.sid) : null;
  need(x1ok?.status === 200 && x1ok.body?.data?.status === 'approved', `X1 ${VI.progressT4.X1}% was not approved (${h.said(x1.res)} / ${x1ok ? h.said(x1ok) : '-'})`);
  for (const [i, row] of VI.costsT4.entries()) await directCost(row, `V7 cost ${i + 1}`);
  const read1 = await runDate();
  await loading(VI.loadingT4, 'V9 loading X1');
  const read2 = await runDate();
  await directCost(VI.costPlusOne, 'V11 one more');
  const read3 = await runDate();
  const read4 = { today: VI.read4Cutoff, ...(await evRead('cost', P, `?cutoffDate=${VI.read4Cutoff}`)) };
  const reads = { read1, read2, read3, read4 };
  const four = Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, r.figures ? { bac: r.figures.bac, pv: r.figures.pv, ev: r.figures.ev, ac: r.figures.ac } : null]));
  const t4cut = Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, cutOk(r, r.today)]));
  obs.t4 = Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, { cutoff: r.today, said: r.said, figures: r.figures }]));
  const inputsOk = Object.keys(reads).every((k) => sameJson(four[k], WP3.T4.inputs[k].value) && t4cut[k]);
  rec('T4.inputs', inputsOk, { expected: Object.fromEntries(Object.keys(reads).map((k) => [k, WP3.T4.inputs[k].value])), observed: { inputs: four, cut: t4cut }, detail: 'V\'s reads must give the book\'s inputs (R-SET); a departure is a setup error' });
  if (inputsOk) {
    const f1 = read1.figures;
    const f2 = read2.figures;
    const f3 = read3.figures;
    const f4 = read4.figures;
    const T4 = WP3.T4;
    rec('T4.pv0.spi', f1.spi === T4.pv0.spi.value, { expected: T4.pv0.spi.value, observed: f1.spi });
    rec('T4.pv0.spiAlert', f1.spiAlert === T4.pv0.spiAlert.value, { expected: T4.pv0.spiAlert.value, observed: f1.spiAlert });
    rec('T4.spi09.spi', f2.spi === T4.spi09.spi.value, { expected: T4.spi09.spi.value, observed: f2.spi });
    rec('T4.spi09.spiAlert', f2.spiAlert === T4.spi09.spiAlert.value, { expected: T4.spi09.spiAlert.value, observed: f2.spiAlert, detail: 'SPI exactly 0.9: no alert (the catcher of M1 / M1a)' });
    rec('T4.cpi09.cpi', f2.cpi === T4.cpi09.cpi.value, { expected: T4.cpi09.cpi.value, observed: f2.cpi });
    rec('T4.cpi09.cpiAlert', f2.cpiAlert === T4.cpi09.cpiAlert.value, { expected: T4.cpi09.cpiAlert.value, observed: f2.cpiAlert, detail: 'CPI exactly 0.9: no alert (the catcher of M1 / M1b)' });
    rec('T4.cpi09.eac', f2.eac === T4.cpi09.eac.value, { expected: T4.cpi09.eac.value, observed: f2.eac });
    rec('T4.ac100001.cpi', f3.cpi === T4.ac100001.cpi.value, { expected: T4.ac100001.cpi.value, observed: f3.cpi });
    rec('T4.ac100001.cpiAlert', f3.cpiAlert === T4.ac100001.cpiAlert.value, { expected: T4.ac100001.cpiAlert.value, observed: f3.cpiAlert });
    rec('T4.ac100001.eac', f3.eac === T4.ac100001.eac.value, { expected: T4.ac100001.eac.value, observed: f3.eac });
    rec('T4.ev0.cpi', f4.cpi === T4.ev0.cpi.value, { expected: T4.ev0.cpi.value, observed: f4.cpi });
    rec('T4.ev0.cpiAlert', f4.cpiAlert === T4.ev0.cpiAlert.value, { expected: T4.ev0.cpiAlert.value, observed: f4.cpiAlert });
    rec('T4.ev0.eac', f4.eac === T4.ev0.eac.value, { expected: T4.ev0.eac.value, observed: f4.eac, detail: 'HR-E3 (undecided): HEAD keeps BAC, the recommendation; CF.HRE3 reports it' });
    rec('T4.ev0.eacBasis', f4.eacBasis === T4.ev0.eacBasis.value, { expected: T4.ev0.eacBasis.value, observed: f4.eacBasis, detail: 'HR-E3: labelled' });
  }

  // ── V14: the X3 loading (run-date SPI 0.5, WP3.V.forecastSpi); V15: the EV-based finish in process ──
  await loading(VI.loadingForecast, 'V14 loading X3');
  const spiRead = await runDate();
  need(spiRead.figures?.spi === WP3.V.forecastSpi.value, `the run-date SPI on V is ${spiRead.figures?.spi}, not WP3.V.forecastSpi ${WP3.V.forecastSpi.value}`);
  if (wants('FC.evBasedFinish')) await probe('FC.evBasedFinish (V15, in process)', async () => {
    const FI = WP3.forecast.evBasedFinishInputs.value;
    let fcs;
    try {
      // eslint-disable-next-line global-require
      fcs = require('../../../src/services/forecast.service');
    } catch (error) {
      throw probeSetup('FC.evBasedFinish', `the forecast service could not be loaded: ${error.message}`);
    }
    const forecast = await fcs.buildForecast({ orgId: ctx.orgs['087'].id, projectId: v.id, asOf: new Date(FI.asOf), access: null });
    const s = forecast?.schedule || {};
    const observed = { available: forecast?.available ?? null, evBasedFinish: s.evBasedFinish ?? null, plannedFinish: s.plannedFinish ?? null, spi: s.spi ?? null, basis: s.basis ?? null };
    obs.evBasedFinish = observed;
    if (observed.available !== true || observed.plannedFinish !== FI.plannedFinish || r6(observed.spi) !== FI.spi) throw probeSetup('FC.evBasedFinish', `the forecast's inputs are not the book's (WP3.forecast.evBasedFinishInputs ${json(FI)}): ${json(observed)}`);
    rec('FC.evBasedFinish', observed.evBasedFinish === WP3.forecast.evBasedFinish.value, { expected: WP3.forecast.evBasedFinish.value, observed, detail: 'buildForecast with access null (no figure depends on it, forecast.service.js:542-548)' });
  });

  // ── V16: T7 on live records (WP3.T7; the catcher of M4) ──
  const h0 = await runDate();
  const t7 = [];
  for (const row of VI.t7) {
    const s = await submit(row.activity, row.pct, row.status, `V16 T7 ${row.activity} ${row.pct}`);
    let rejected = null;
    if (row.reject && s.sid) rejected = await send('qs', 'POST', `${A(row.activity)}/progress-submissions/${s.sid}/reject`, { reason: `CERT3 WP3 T7: the rejected submission ${h.STAMP}` });
    t7.push({ ...row, said: h.said(s.res), status: s.res.body?.data?.submission?.status ?? null, rejected: rejected ? `${h.said(rejected)} ${rejected.body?.data?.status ?? ''}`.trim() : null });
    need(Boolean(s.sid) && s.res.body?.data?.submission?.status === row.status && (!row.reject || (rejected?.status === 200 && rejected.body?.data?.status === 'rejected')), `the T7 submission ${row.activity} ${row.pct}% ${row.status}${row.reject ? ' (rejected)' : ''} could not be made (${json(t7[t7.length - 1])})`);
  }
  const h1 = { today: h0.today, ...(await evRead('cost', P, `?cutoffDate=${h0.today}`)) };
  obs.t7 = { h0: h0.hash, h1: h1.hash, cutoff: h0.today, submissions: t7 };
  need(h0.res.status === 200 && h1.res.status === 200, `the T7 reads answered ${h0.said} / ${h1.said}`);
  rec('T7.live.hash', h1.hash === h0.hash && WP3.T7.value === 'byte_identical', { expected: { hash: WP3.T7.value }, observed: obs.t7, detail: 'both reads at the same cutoff date; sha256 of the canonical JSON without reporting.asOfDate' });

  // ── V17: X3's cost on both sides of 2026-02-28 (L34 on V) ──
  for (const [i, row] of VI.costsL34.entries()) await directCost(row, `V17 X3 cost ${i + 1}`);
  const acL34 = await runDate();
  need(acL34.figures?.ac === WP3.V.runDateAc.value.afterL34Costs, `the run-date AC on V is ${acL34.figures?.ac}, not WP3.V.runDateAc (afterL34Costs) ${WP3.V.runDateAc.value.afterL34Costs}`);

  // ── V18: period V-A and its open report; V19: the four locks ──
  const PA = VI.periods.A;
  const madeA = await makePeriod(PA, 'period V-A');
  const vaId = madeA.status === 201 ? madeA.body?.data?.id || null : null;
  need(Boolean(vaId), `period ${PA.code} could not be made (${h.said(madeA)} ${madeA.body?.error?.message || ''})`);
  const openA = await evRead('cost', P, `?periodId=${vaId}`);
  need(openA.res.status === 200 && openA.report?.reporting?.isSnapshot === false && openA.report?.reporting?.cutoffDate === WP3.V.cutoffA.value, `the open V-A report answered ${openA.said} (isSnapshot ${openA.report?.reporting?.isSnapshot}, cutoff ${openA.report?.reporting?.cutoffDate})`);
  const gateA = await gateOf(v.id);
  need(gateA?.ready === WP3.V.reportingGateReady.value, `V's reporting gate is ${gateA?.ready ? 'ready' : 'unknown'}: the 409 of PER.V.financeBlocked needs it blocked (WP3.V.reportingGateReady)`);
  const reasonA = `CERT3 WP3 V-A locked on the PM's override: no baseline on V ${h.STAMP}`;
  const plannerLock = await send('planner', 'POST', lockRoute(vaId), {});
  const statusAfterPlanner = await periodStatus(vaId);
  rec('PER.V.planner', h.is(plannerLock, WP3.periods.lockAsPlanner.value) && statusAfterPlanner === 'open', { expected: { said: WP3.periods.lockAsPlanner.value, status: 'open' }, observed: { said: h.said(plannerLock), status: statusAfterPlanner } });
  const financeLock = await send('finance', 'POST', lockRoute(vaId), {});
  const statusAfterFinance = await periodStatus(vaId);
  const rowsAfterFinance = await snapshotRows(vaId);
  rec('PER.V.financeBlocked', h.is(financeLock, WP3.periods.financeWhileBlocked.value) && statusAfterFinance === 'open' && rowsAfterFinance === 0, { expected: { said: WP3.periods.financeWhileBlocked.value, status: 'open', snapshotRows: 0 }, observed: { said: h.said(financeLock), status: statusAfterFinance, snapshotRows: rowsAfterFinance }, detail: 'the catcher of M3 (the gate skipped on lock)' });
  const financeOverride = await send('finance', 'POST', lockRoute(vaId), { overrideReason: `CERT3 WP3 finance tries the override ${h.STAMP}` });
  const statusAfterOverride = await periodStatus(vaId);
  rec('PER.V.financeOverride', h.is(financeOverride, WP3.periods.financeWithOverride.value) && statusAfterOverride === 'open', { expected: { said: WP3.periods.financeWithOverride.value, status: 'open' }, observed: { said: h.said(financeOverride), status: statusAfterOverride }, detail: 'the catcher of M3b (the PM-only override)' });
  const pmLock = await send('pm', 'POST', lockRoute(vaId), { overrideReason: reasonA });
  const lockAnswer = pmLock.status === 200 ? pmLock.body?.data : null;
  const pmObserved = { said: h.said(pmLock), isSnapshot: lockAnswer?.reporting?.isSnapshot ?? null, snapshotId: lockAnswer?.reporting?.snapshotId ?? null, reason: lockAnswer?.readinessOverride?.reason ?? null, equalsOpen: lockAnswer ? sameFigures(lockAnswer, openA.report) : false };
  rec('PER.V.pmOverride', pmLock.status === WP3.periods.feb.lockByPmWithReason.value && pmObserved.isSnapshot === true && Boolean(pmObserved.snapshotId) && pmObserved.reason === reasonA && pmObserved.equalsOpen, { expected: { said: WP3.periods.feb.lockByPmWithReason.value, isSnapshot: true, reason: reasonA, equalsOpen: true }, observed: { ...pmObserved, open: openA.figures, snapshot: figuresOf(lockAnswer) } });
  const eventsA = await overriddenFor(vaId);
  const eventsAObserved = eventsA.map((e) => ({ actorId: e.actorId, reason: e.reason, periodId: e.summary?.periodId }));
  rec('PER.V.overrideAudit', eventsA.length === WP3.periods.feb.overriddenAuditEvents.value && eventsA[0]?.actorId === ctx.people.pm && eventsA[0]?.reason === reasonA, { expected: { count: WP3.periods.feb.overriddenAuditEvents.value, actor: 'pm', reason: reasonA }, observed: eventsAObserved });
  const statusA = await periodStatus(vaId);
  need(statusA === 'locked', `V-A is ${statusA} after the four locks: V20-V21 need it locked`);
  // the V-A snapshot as served (the lock's frozen figures; fresh, so strict after the fix)
  const servedA = await evRead('cost', P, `?periodId=${vaId}`);
  need(servedA.res.status === 200, `GET ?periodId=V-A answered ${servedA.said}`);
  const LA = WP3.V.lockA;
  const lockAcContract = contractProblems(servedA.report);
  const lockAcVerdict = servedA.report?.reporting?.cutoffDate === WP3.V.cutoffA.value ? metricVerdict(servedA.figures, LA) : 'wrong';
  ka('KA.PER.V.lockAc', { ref: 'L34', value: valuesOf(LA), today: valuesOf(LA, METRIC_KEYS, 'today'), observed: { ...servedA.figures, cutoffDate: servedA.report?.reporting?.cutoffDate, isSnapshot: servedA.report?.reporting?.isSnapshot, contract: lockAcContract }, verdict: lockAcVerdict === 'value' && lockAcContract.length ? 'wrong' : lockAcVerdict, detail: contractNote() });

  // ── V20: after the lock, a back-dated cost and a new approval ──
  const hA = servedA;
  await directCost(VI.backdatedAfterLock, 'V20 back-dated');
  const [apCode, apPct] = VI.approvalAfterLock;
  const ap = await submit(apCode, apPct, 'submitted', `V20 ${apCode} ${apPct}`);
  const apOk = ap.sid ? await approveProgress(apCode, ap.sid) : null;
  need(apOk?.status === 200 && apOk.body?.data?.status === 'approved', `${apCode} ${apPct}% was not approved (${h.said(ap.res)} / ${apOk ? h.said(apOk) : '-'})`);
  const hB = await evRead('cost', P, `?periodId=${vaId}`);
  const hashObserved = { first: hA.hash, after: hB.hash, isSnapshot: hB.report?.reporting?.isSnapshot ?? null, snapshotId: [hA.report?.reporting?.snapshotId ?? null, hB.report?.reporting?.snapshotId ?? null], lockedAt: [hA.report?.reporting?.lockedAt ?? null, hB.report?.reporting?.lockedAt ?? null] };
  rec('PER.V.afterLock.periodHash', hB.res.status === 200 && hB.hash === hA.hash && hashObserved.isSnapshot === true && hashObserved.snapshotId[0] === hashObserved.snapshotId[1] && Boolean(hashObserved.snapshotId[0]) && hashObserved.lockedAt[0] === hashObserved.lockedAt[1] && WP3.periods.afterLock.periodReport.value === 'byte_identical', { expected: { periodReport: WP3.periods.afterLock.periodReport.value, isSnapshot: true }, observed: hashObserved, detail: 'the catcher of M2 (a locked period recomputed on read)' });
  const after0228 = await evRead('cost', P, '?cutoffDate=2026-02-28');
  need(after0228.res.status === 200, `GET ?cutoffDate=2026-02-28 on V answered ${after0228.said}`);
  const CA = WP3.V.cutoffAfter;
  const cutContract = contractProblems(after0228.report);
  const cutVerdict = after0228.report?.reporting?.cutoffDate === WP3.V.cutoffA.value ? metricVerdict(after0228.figures, CA) : 'wrong';
  ka('PER.V.afterLock.cutoffChanges', { ref: 'L34', value: valuesOf(CA), today: valuesOf(CA, METRIC_KEYS, 'today'), observed: { ...after0228.figures, cutoffDate: after0228.report?.reporting?.cutoffDate, movedBy: typeof after0228.figures?.ac === 'number' && typeof servedA.figures?.ac === 'number' ? after0228.figures.ac - servedA.figures.ac : null, contract: cutContract }, verdict: cutVerdict === 'value' && cutContract.length ? 'wrong' : cutVerdict, detail: `the cutoff-date report moves by the back-dated ${VI.backdatedAfterLock[1]} either way; ${contractNote()}` });
  const runAfter = await runDate();
  obs.vAfterLock = { runDateAc: runAfter.figures?.ac ?? null, runDateEv: runAfter.figures?.ev ?? null, book: { ac: WP3.V.runDateAc.value.afterBackdated, ev: WP3.V.evAfterNewApproval.value } };
  need(runAfter.figures?.ac === WP3.V.runDateAc.value.afterBackdated, `the run-date AC on V is ${runAfter.figures?.ac}, not WP3.V.runDateAc (afterBackdated) ${WP3.V.runDateAc.value.afterBackdated}`);
  if (runAfter.figures?.ev !== WP3.V.evAfterNewApproval.value) h.lead(`V's run-date EV after the new approval is ${runAfter.figures?.ev}, not WP3.V.evAfterNewApproval ${WP3.V.evAfterNewApproval.value} (a fixture figure; T7.live.hash and KA.EVL.runDate judge EV)`, obs.vAfterLock);

  // ── V21: the PM relocks V-A with no overrideReason (WP3.periods.afterLock.relockProbes) ──
  const relock = await send('pm', 'POST', lockRoute(vaId), {});
  const relockObserved = { said: h.said(relock), snapshotId: relock.body?.data?.reporting?.snapshotId ?? null, lockedAt: relock.body?.data?.reporting?.lockedAt ?? null, stored: { snapshotId: hA.report?.reporting?.snapshotId ?? null, lockedAt: hA.report?.reporting?.lockedAt ?? null } };
  rec('PER.V.relock', relock.status === 200 && WP3.periods.afterLock.relockSameSnapshotId.value === true && relockObserved.snapshotId === relockObserved.stored.snapshotId && Boolean(relockObserved.snapshotId) && WP3.periods.afterLock.relockSameLockedAt.value === true && relockObserved.lockedAt === relockObserved.stored.lockedAt, { expected: { said: '200', sameSnapshotId: true, sameLockedAt: true }, observed: relockObserved, detail: 'the catcher of M2b (the relock path recomputes: 409 REPORTING_READINESS_BLOCKED on V\'s blocked gate)' });

  // ── V22: two PM locks of V-B at once (WP3.periods.concurrentLocks) ──
  if (wants('KA.PER.concurrentLocks', 'CF.concurrentLocks')) await probe('KA.PER.concurrentLocks (V22)', async () => {
    const PB = VI.periods.B;
    const madeB = await makePeriod(PB, 'period V-B');
    const vbId = madeB.status === 201 ? madeB.body?.data?.id || null : null;
    if (!vbId) throw probeSetup('KA.PER.concurrentLocks', `period ${PB.code} could not be made (${h.said(madeB)})`);
    const [one, two] = await Promise.all([1, 2].map((n) => send('pm', 'POST', lockRoute(vbId), { overrideReason: `CERT3 WP3 V-B concurrent lock ${n} ${h.STAMP}` })));
    const answers = [one, two].map((r) => ({ said: h.said(r), snapshotId: r.body?.data?.reporting?.snapshotId ?? null, lockedAt: r.body?.data?.reporting?.lockedAt ?? null }));
    const rows = await snapshotRows(vbId);
    const events = (await overriddenFor(vbId)).length;
    const succeeded = answers.filter((a) => a.said === '200').length;
    const refused = answers.find((a) => statusPart(a.said) >= 400) || null;
    const observed = { succeeded, refused: refused ? { status: statusPart(refused.said), code: null, said: refused.said } : null, snapshotRows: rows, overriddenAuditEvents: events, answers };
    obs.concurrentLocks = observed;
    // The second answer being the first's stored snapshot (same id and time, one event) shows the sends did not overlap (R-SET).
    if (succeeded === 2 && answers[0].snapshotId === answers[1].snapshotId && answers[0].lockedAt === answers[1].lockedAt && events === 1) throw probeSetup('KA.PER.concurrentLocks', `the two locks did not overlap (the second returned the stored snapshot): ${json(observed)}`);
    const leaf = WP3.periods.concurrentLocks;
    const shape = (o) => ({ succeeded: o.succeeded, refused: o.refused ? { status: o.refused.status, code: null } : null, snapshotRows: o.snapshotRows, overriddenAuditEvents: o.overriddenAuditEvents });
    ka('KA.PER.concurrentLocks', { ref: leaf.ref, value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (o) => sameJson(shape(o), leaf.value), (o) => sameJson(shape(o), leaf.today)), detail: 'the refusal\'s code is not asserted (undecided, never guessed)' });
  });

  // ── V23: V-F, a period whose cutoff is ahead, locked by the PM with a reason (L113 / HR-E2) ──
  if (wants('KA.PER.futureCutoffLock', 'CF.L113')) await probe('KA.PER.futureCutoffLock (V23)', async () => {
    const runDay = cairoToday();
    const PF = BOOK_RULES.futurePeriodFor(runDay);
    const madeF = await makePeriod(PF, 'period V-F');
    const vfId = madeF.status === 201 ? madeF.body?.data?.id || null : null;
    if (!vfId) throw probeSetup('KA.PER.futureCutoffLock', `period ${PF.code} could not be made (${h.said(madeF)})`);
    if (!(Date.parse(BOOK_RULES.endOfLocalDay(PF.cutoff, ZONE)) > Date.now())) throw probeSetup('KA.PER.futureCutoffLock', `V-F's cutoff ${PF.cutoff} has passed`);
    const lockF = await send('pm', 'POST', lockRoute(vfId), { overrideReason: `CERT3 WP3 V-F locked before its cutoff ${h.STAMP}` });
    const observed = { period: PF.code, runDate: runDay, said: h.said(lockF), isSnapshot: lockF.body?.data?.reporting?.isSnapshot ?? null, events: (await overriddenFor(vfId)).length };
    obs.futureCutoffLock = observed;
    const leaf = WP3.periods.futureCutoffLock;
    ka('KA.PER.futureCutoffLock', { ref: leaf.ref, value: leaf.value, today: leaf.today, observed, verdict: judge(observed, (o) => statusPart(o.said) === leaf.value, (o) => o.said === String(leaf.today)), detail: 'the refusal\'s code is not asserted (HR-E2 undecided; CUTOFF_NOT_REACHED is only proposed)' });
  });

  // ── V24: L112 on fresh records: approve +13,000.00, the PM edits the amount, the PM deletes it ──
  if (wants('CF.L112')) await probe('CF.L112 observation (V24)', async () => {
    const R = VI.l112;
    const bacNow = async () => (await runDate()).figures?.bac ?? null;
    const auditCount = async (rid) => (await auditEvents(P, `entityId=${rid}&source=audit`)).length;
    const created = await send('cost', 'POST', `${P}/budget-revisions`, { title: `CERT3 WP3 L112 revision ${h.STAMP}`, changeType: R.changeType, amount: R.amount, effectiveDate: R.effectiveDate, status: R.createdAs, notes: `CERT3 WP3 V24 ${h.STAMP}` });
    const rid = created.status === 201 ? created.body?.data?.id || null : null;
    if (!rid) throw probeSetup('CF.L112', `the revision could not be made (${h.said(created)})`);
    const approved = await send('pm', 'PATCH', `${P}/budget-revisions/${rid}`, { status: 'approved' });
    const bacApproved = await bacNow();
    if (approved.status !== 200 || approved.body?.data?.status !== 'approved' || bacApproved !== WP3.V.l112.bac.value.afterApproval) throw probeSetup('CF.L112', `the revision was not approved to BAC ${WP3.V.l112.bac.value.afterApproval} (${h.said(approved)}, BAC ${bacApproved})`);
    const a0 = await auditCount(rid);
    const edit = await send('pm', 'PATCH', `${P}/budget-revisions/${rid}`, { amount: R.editAmountTo });
    const bacEdited = await bacNow();
    const a1 = await auditCount(rid);
    const del = await send('pm', 'DELETE', `${P}/budget-revisions/${rid}`);
    const bacDeleted = await bacNow();
    const a2 = await auditCount(rid);
    const listed = listOf(await dataOf('cost', `${P}/budget-revisions`)).some((x) => x.id === rid);
    obs.l112 = { approve: h.said(approved), auditBefore: a0, edit: { said: h.said(edit), bac: bacEdited, newAuditEvents: a1 - a0 }, delete: { said: h.said(del), data: del.body?.data ?? null, bac: bacDeleted, newAuditEvents: a2 - a1, listedAfter: listed }, book: { bac: WP3.V.l112.bac.value, edit: WP3.V.l112.edit.today, delete: WP3.V.l112.delete.today } };
  });

  // ── V25: the actor role recorded on a cost loading (an 087 staff QS assigned on V as cost_controller) ──
  if (wants('CF.actorRole')) await probe('CF.actorRole observation (V25)', async () => {
    const AR = VI.actorRoleLoading;
    const created = await send('actor', 'POST', `${P}/reports/cost-loading`, { activityId: id[AR.activity], plannedDate: AR.plannedDate, plannedValue: AR.plannedValue, source: 'manual', status: 'draft', notes: `CERT3 WP3 V25 actor role ${h.STAMP}` });
    const lid = created.status === 201 ? created.body?.data?.id || null : null;
    if (!lid) throw probeSetup('CF.actorRole', `the actor-role member could not create a loading (${h.said(created)} ${created.body?.error?.message || ''})`);
    const submitted = await send('actor', 'POST', `${P}/reports/cost-loading/${lid}/submit`, {});
    if (submitted.status !== 200) throw probeSetup('CF.actorRole', `the actor-role member could not submit the loading (${h.said(submitted)})`);
    const row = listOf(await dataOf('cost', `${P}/reports/cost-loading`)).find((x) => x.id === lid);
    const team = listOf(await dataOf('pm', `${P}/team`));
    const member = team.find((m) => m.userId === ctx.people.actor) || null;
    const events = listOf(row?.approvalHistory).filter((e) => e.actorId === ctx.people.actor).map((e) => ({ toStatus: e.toStatus ?? e.newStatus ?? null, actorRole: e.actorRole ?? null }));
    obs.actorRole = { member: ctx.actorKey, orgRole: 'qs', projectRole: member?.assignmentRole ?? null, events };
  });
};

// ── 087-EV: the stored WP-3 moments ──────────────────────────────────────────
const evsFlow = async () => {
  const st = ctx.state['087-EV'];
  const s = storedEv087(st, ctx.branch);
  const at = (id) => s[id];
  rec('EVS.setup', at('EVS.setup').ok === true, { expected: at('EVS.setup').expected, observed: at('EVS.setup').observed });
  rec('EVS.T1', at('EVS.T1').ok === true, { expected: at('EVS.T1').expected, observed: at('EVS.T1').observed, detail: at('EVS.T1').detail });
  rec('EVS.T2', at('EVS.T2').ok === true, { expected: at('EVS.T2').expected, observed: at('EVS.T2').observed });
  ka('KA.EVS.T3', { ref: 'L34', ...pickKa(at('KA.EVS.T3')), detail: 'stored at the build (checkpoint.T3)' });
  rec('EVS.T5', at('EVS.T5').ok === true, { expected: at('EVS.T5').expected, observed: at('EVS.T5').observed });
  ka('KA.EVS.T5delete', { ref: WP3.T5.deleteProbe.ref, ...pickKa(at('KA.EVS.T5delete')), detail: 'the PM\'s delete of the approved +13,000.00 revision at the build (probe.T5.delete)' });
  rec('EVS.T7', at('EVS.T7').ok === true, { expected: at('EVS.T7').expected, observed: at('EVS.T7').observed });
  rec('EVS.periods', at('EVS.periods').ok === true, { expected: at('EVS.periods').expected, observed: at('EVS.periods').observed });
  ka('KA.EVS.febOpen', { ref: 'L34', ...pickKa(at('KA.EVS.febOpen')), detail: 'stored at the build (checkpoint.feb.open)' });
  rec('EVS.feb.lockAsPlanner', at('EVS.feb.lockAsPlanner').ok === true, { expected: at('EVS.feb.lockAsPlanner').expected, observed: at('EVS.feb.lockAsPlanner').observed });
  rec('EVS.feb.financeWhileBlocked', at('EVS.feb.financeWhileBlocked').ok === true, { expected: at('EVS.feb.financeWhileBlocked').expected, observed: at('EVS.feb.financeWhileBlocked').observed });
  rec('EVS.feb.financeWithOverride', at('EVS.feb.financeWithOverride').ok === true, { expected: at('EVS.feb.financeWithOverride').expected, observed: at('EVS.feb.financeWithOverride').observed });
  rec('EVS.feb.lockByPm', at('EVS.feb.lockByPm').ok === true, { expected: at('EVS.feb.lockByPm').expected, observed: at('EVS.feb.lockByPm').observed });
  ka('KA.EVS.febSnapshot', { ref: 'L34', ...pickKa(at('KA.EVS.febSnapshot')), detail: 'the snapshot frozen at the February lock (lock.2026-02)' });
  rec('EVS.jan.lockNormal', at('EVS.jan.lockNormal').ok === true, { expected: at('EVS.jan.lockNormal').expected, observed: at('EVS.jan.lockNormal').observed });
  ka('KA.EVS.janSnapshot', { ref: 'L34', ...pickKa(at('KA.EVS.janSnapshot')), detail: 'the snapshot frozen at the January lock (lock.2026-01)' });
  rec('EVS.afterLock.periodReport', at('EVS.afterLock.periodReport').ok === true, { expected: at('EVS.afterLock.periodReport').expected, observed: at('EVS.afterLock.periodReport').observed });
  ka('KA.EVS.afterLock.cutoff0228', { ref: 'L34', ...pickKa(at('KA.EVS.afterLock.cutoff0228')), detail: 'the three stored 2026-02-28 reads (checkpoint.afterLock.*)' });
  rec('EVS.afterLock.runDateAfterCost', at('EVS.afterLock.runDateAfterCost').ok === true, { expected: at('EVS.afterLock.runDateAfterCost').expected, observed: at('EVS.afterLock.runDateAfterCost').observed, detail: `branch ${ctx.branch}` });
  rec('EVS.afterLock.runDateAfterApproval', at('EVS.afterLock.runDateAfterApproval').ok === true, { expected: at('EVS.afterLock.runDateAfterApproval').expected, observed: at('EVS.afterLock.runDateAfterApproval').observed, detail: `branch ${ctx.branch}` });
  rec('EVS.T6.before', at('EVS.T6.before').ok === true, { expected: at('EVS.T6.before').expected, observed: at('EVS.T6.before').observed, detail: `branch ${ctx.branch}` });
  ka('KA.EVS.T6.after', { ref: 'HR-S9', ...pickKa(at('KA.EVS.T6.after')), detail: `branch ${ctx.branch}; A140 retired by F1r (L118)` });
  rec('EVS.zone', at('EVS.zone').ok === true, { expected: at('EVS.zone').expected, observed: at('EVS.zone').observed, detail: at('EVS.zone').detail });
};
/** The ka() arguments of a stored judgement. */
const pickKa = (j) => ({ value: j.value, today: j.today, observed: j.observed, verdict: j.verdict, storedAt: j.storedAt ?? null });

// ── 087-EV: the live reads and the period probes that write nothing ─────────────
const evlFlow = async () => {
  const st = ctx.state['087-EV'];
  const { P } = ctx.deep['087-EV'];
  const out = (step) => outOf(st, step);
  const periods = out('periods');
  const JAN = periods['2026-01'];
  const FEB = periods['2026-02'];
  const lockFeb = out('lock.2026-02');
  const lockJan = out('lock.2026-01');
  const reference = out('checkpoint.afterLock.before').period?.sha256 || null;
  const branch = ctx.branch;
  if (on('EVL')) {
    await probe('KA.EVL.runDate (087-EV)', async () => {
      const today = cairoToday();
      const read = await evRead('cost', P, `?cutoffDate=${today}`);
      const cut = read.res.status === 200 && read.report?.reporting?.cutoffLocalDate === today && read.report?.reporting?.cutoffDate === BOOK_RULES.endOfLocalDay(today, ZONE) && sameJson(zoneOf(read.report?.reporting), ZONE_EXPECT);
      if (!cut) throw probeSetup('KA.EVL.runDate', `the run-date read answered ${read.said}, cut ${read.report?.reporting?.cutoffLocalDate} / ${read.report?.reporting?.cutoffDate} in ${json(zoneOf(read.report?.reporting))}`);
      const node = WP3.T6.after[branch];
      ka('KA.EVL.runDate', { ref: 'HR-S9', value: valuesOf(node), today: valuesOf(node, METRIC_KEYS, 'today'), observed: read.figures, verdict: metricVerdict(read.figures, node), detail: `branch ${branch}; the catcher of M4 (EV read from every submission: wrong)` });
      obs.evlRunDate = { today, figures: read.figures };
    });
    await probe('KA.EVL.cutoff0228 (087-EV)', async () => {
      const read = await evRead('cost', P, '?cutoffDate=2026-02-28');
      if (read.res.status !== 200) throw probeSetup('KA.EVL.cutoff0228', `GET ?cutoffDate=2026-02-28 answered ${read.said}`);
      const node = WP3.periods.afterLock.cutoffAfterCost;
      const contract = contractProblems(read.report);
      const v = read.report?.reporting?.cutoffDate === WP3.T3.cutoff.value && sameJson(zoneOf(read.report?.reporting), ZONE_EXPECT) ? metricVerdict(read.figures, node) : 'wrong';
      ka('KA.EVL.cutoff0228', { ref: 'L34', value: valuesOf(node), today: valuesOf(node, METRIC_KEYS, 'today'), observed: { ...read.figures, cutoffDate: read.report?.reporting?.cutoffDate, contract }, verdict: v === 'value' && contract.length ? 'wrong' : v, detail: `live: strict after the fix; ${contractNote()}` });
    });
    await probe('EVL.febPeriod (087-EV)', async () => {
      const feb = await evRead('cost', P, `?periodId=${FEB.id}`);
      let buildHash = null;
      try {
        // the hash of the 087-EV reference, exactly as the build computed it (087-ev.js summarise)
        // eslint-disable-next-line global-require
        buildHash = feb.report ? require('./build/087-ev').summarise(feb.report).sha256 : null;
      } catch (error) {
        obs.buildSummarise = `build/087-ev.js summarise could not be loaded (${error.message}); the proof's own canonical hash is used`;
      }
      const febHash = buildHash || feb.hash;
      const febObserved = { said: feb.said, isSnapshot: feb.report?.reporting?.isSnapshot ?? null, snapshotId: feb.report?.reporting?.snapshotId ?? null, lockedAt: feb.report?.reporting?.lockedAt ?? null, sha256: febHash, proofHash: feb.hash, builderHash: buildHash };
      const febStored = { snapshotId: lockFeb.snapshot?.reporting?.snapshotId ?? null, lockedAt: lockFeb.snapshot?.reporting?.lockedAt ?? null, sha256: reference };
      rec('EVL.febPeriod.hash', feb.res.status === 200 && febObserved.isSnapshot === true && febObserved.snapshotId === febStored.snapshotId && febObserved.lockedAt === febStored.lockedAt && Boolean(reference) && febHash === reference, { expected: febStored, observed: febObserved, detail: 'the catcher of M2 (the locked period recomputed on read)' });
      if (feb.res.status !== 200) throw probeSetup('KA.EVL.febPeriod.figures', `GET ?periodId=<February> answered ${feb.said}`);
      const node = WP3.periods.feb.snapshot;
      ka('KA.EVL.febPeriod.figures', { ref: 'L34', value: valuesOf(node), today: valuesOf(node, METRIC_KEYS, 'today'), observed: { ...feb.figures, cutoffDate: feb.report?.reporting?.cutoffDate, lockedAt: febObserved.lockedAt }, verdict: feb.report?.reporting?.cutoffDate === WP3.periods.feb.cutoff.value ? metricVerdict(feb.figures, node) : 'wrong', storedAt: febObserved.lockedAt, detail: 'frozen at the February lock, served now' });
    });
    await probe('KA.EVL.janPeriod.figures (087-EV)', async () => {
      const jan = await evRead('cost', P, `?periodId=${JAN.id}`);
      if (jan.res.status !== 200) throw probeSetup('KA.EVL.janPeriod.figures', `GET ?periodId=<January> answered ${jan.said}`);
      const node = WP3.periods.jan.snapshot;
      ka('KA.EVL.janPeriod.figures', { ref: 'L34', value: valuesOf(node), today: valuesOf(node, METRIC_KEYS, 'today'), observed: { ...jan.figures, cutoffDate: jan.report?.reporting?.cutoffDate, lockedAt: jan.report?.reporting?.lockedAt ?? null }, verdict: jan.report?.reporting?.cutoffDate === WP3.periods.jan.cutoff.value && jan.report?.reporting?.isSnapshot === true ? metricVerdict(jan.figures, node) : 'wrong', storedAt: jan.report?.reporting?.lockedAt ?? null, detail: 'frozen at the January lock, served now' });
    });
  }
  if (on('PER')) {
    // The relocks (WP3.periods.afterLock.relockProbes): sent only while the gate is blocked (S.gate087EV), so under M2b they reach
    // the gate and are refused, writing nothing.
    await probe('PER.relock (087-EV)', async () => {
      if (ctx.gate087EV?.ready !== false) throw probeSetup('PER.relock', `087-EV's reporting gate is not blocked (${json(ctx.gate087EV, 200)}): a relock under M2b would write`);
      const probes = WP3.periods.afterLock.relockProbes.value.filter((p) => p.project === '087-EV');
      const byPeriod = { '2026-01': { id: JAN.id, stored: lockJan.snapshot?.reporting }, '2026-02': { id: FEB.id, stored: lockFeb.snapshot?.reporting } };
      const answers = {};
      for (const p of probes) {
        const target = byPeriod[p.period];
        const res = await send(p.by, 'POST', `${P}/reports/periods/${target.id}/lock`, p.body);
        answers[p.period] = { by: p.by, said: h.said(res), snapshotId: res.body?.data?.reporting?.snapshotId ?? null, lockedAt: res.body?.data?.reporting?.lockedAt ?? null, stored: { snapshotId: target.stored?.snapshotId ?? null, lockedAt: target.stored?.lockedAt ?? null } };
      }
      obs.relocks087EV = answers;
      const ok = (a) => Boolean(a) && a.said === '200' && Boolean(a.snapshotId) && a.snapshotId === a.stored.snapshotId && a.lockedAt === a.stored.lockedAt;
      rec('PER.relock.jan', ok(answers['2026-01']) && answers['2026-01'].by === 'finance', { expected: { by: 'finance', said: '200', sameSnapshotId: WP3.periods.afterLock.relockSameSnapshotId.value, sameLockedAt: WP3.periods.afterLock.relockSameLockedAt.value }, observed: answers['2026-01'] ?? null, detail: 'the catcher of M2b' });
      rec('PER.relock.feb', ok(answers['2026-02']) && answers['2026-02'].by === 'pm', { expected: { by: 'pm', said: '200', sameSnapshotId: WP3.periods.afterLock.relockSameSnapshotId.value, sameLockedAt: WP3.periods.afterLock.relockSameLockedAt.value }, observed: answers['2026-02'] ?? null, detail: 'the catcher of M2b' });
    });
    // A loading naming the locked February (WP3.periods.afterLock.loadingInLockedPeriodRequest; HEAD keys the rule on the period, WP3ADJ Q11)
    await h.section('PER.loadingLocked (087-EV)', async () => {
      const LR = WP3.periods.afterLock.loadingInLockedPeriodRequest.value;
      const loadsBefore = listOf(await dataOf('cost', `${P}/reports/cost-loading`)).length;
      const activityId = out('activities').byCode?.[LR.body.activity] || null;
      const plannedValue = Number(String(LR.body.plannedValue).replace(/,/g, ''));
      const loadingRes = activityId ? await send('cost', 'POST', `${P}/reports/cost-loading`, { activityId, reportingPeriodId: FEB.id, plannedDate: LR.body.plannedDate, plannedValue, source: 'manual', status: 'draft', notes: `CERT3 WP3 proof: a loading in the locked February ${h.STAMP}` }) : null;
      const loadsAfter = listOf(await dataOf('cost', `${P}/reports/cost-loading`)).length;
      if (loadingRes && loadingRes.status < 300) ctx.deepWrites.push(`087-EV: a cost loading in the locked February was ACCEPTED (${h.said(loadingRes)} id ${loadingRes.body?.data?.id})`);
      rec('PER.loadingLocked', Boolean(loadingRes) && h.is(loadingRes, WP3.periods.afterLock.loadingInLockedPeriod.value) && loadsAfter - loadsBefore === LR.loadingsDelta, { expected: { said: WP3.periods.afterLock.loadingInLockedPeriod.value, loadingsDelta: LR.loadingsDelta }, observed: { said: loadingRes ? h.said(loadingRes) : `no activity ${LR.body.activity} in the state`, delta: loadsAfter - loadsBefore } });
    });
    // Period refusals: a duplicate code and an end before its start (count unchanged)
    await h.section('PER.duplicateCode / PER.endBeforeStart (087-EV)', async () => {
      const periodsNow = async () => listOf(await dataOf('cost', `${P}/reports/periods`)).length;
      const pc0 = await periodsNow();
      const dup = await send('cost', 'POST', `${P}/reports/periods`, { code: '2026-01', label: `CERT3 WP3 proof duplicate code ${h.STAMP}`, periodStart: '2026-01-01', periodEnd: '2026-01-31', cutoffDate: '2026-01-31' });
      const pc1 = await periodsNow();
      if (dup.status < 300) ctx.deepWrites.push(`087-EV: a period with the duplicate code 2026-01 was ACCEPTED (${h.said(dup)})`);
      rec('PER.duplicateCode', h.is(dup, WP3.periods.duplicateCode.value) && pc1 === pc0, { expected: { said: WP3.periods.duplicateCode.value, written: 0 }, observed: { said: h.said(dup), written: pc1 - pc0 } });
      const backwards = await send('cost', 'POST', `${P}/reports/periods`, { code: `CERT3-WP3-${h.STAMP}`, label: `CERT3 WP3 proof end before start ${h.STAMP}`, periodStart: '2026-03-31', periodEnd: '2026-03-01' });
      const pc2 = await periodsNow();
      if (backwards.status < 300) ctx.deepWrites.push(`087-EV: a period ending before its start was ACCEPTED (${h.said(backwards)})`);
      rec('PER.endBeforeStart', h.is(backwards, WP3.periods.endBeforeStart.value) && pc2 === pc1, { expected: { said: WP3.periods.endBeforeStart.value, written: 0 }, observed: { said: h.said(backwards), written: pc2 - pc1 } });
    });
    // The override audit (WP3.periods.feb.overriddenAuditFilter), and January's (a normal lock: none) for CF.L113
    await h.section('PER.overrideAudit.feb (087-EV)', async () => {
      const AF = WP3.periods.feb.overriddenAuditFilter.value;
      const overridden = await auditEvents(P, `entityType=${AF.query.entityType}&action=${AF.query.action}&source=${AF.query.source}`);
      const febEvents = overridden.filter((e) => e.summary?.periodId === FEB.id);
      const janEvents = overridden.filter((e) => e.summary?.periodId === JAN.id);
      const janAny = (await auditEvents(P, `entityId=${JAN.id}&source=audit`)).length;
      obs.lockAudit087EV = { overridden: overridden.length, feb: febEvents.map((e) => ({ actorId: e.actorId, reason: e.reason })), janOverridden: janEvents.length, janEntityEvents: janAny };
      rec('PER.overrideAudit.feb', febEvents.length === AF.count && febEvents[0]?.reason === lockFeb.overrideReason, { expected: { count: AF.count, reason: lockFeb.overrideReason }, observed: obs.lockAudit087EV });
    });
  }
};

// ── in process: the forecast pace (pure) ─────────────────────────────────────
const fcPureFlow = async () => {
  // eslint-disable-next-line global-require
  const fcs = require('../../../src/services/forecast.service');
  const I = WP3.forecast.pace.inputs.value;
  const activityId = 'cert3-wp3-pace';
  // One approval inside the window (fewer than two: no velocity); its date is a choice (WP3.forecast.pace.inputs: approvals 1).
  const ctxPure = { history: new Map([[activityId, [{ activityId, pct: I.pct, at: new Date(`${I.start}T00:00:00.000Z`) }]]]), impacts: new Map(), costs: new Map(), rfis: new Map(), submittals: new Map(), longLead: new Map() };
  const activity = { id: activityId, name: 'CERT3 WP3 pace', pctComplete: I.pct, startDate: `${I.start}T00:00:00.000Z`, endDate: `${I.end}T00:00:00.000Z`, totalFloat: null, isCritical: false, budget: 0 };
  const f = fcs.forecastActivity(activity, ctxPure, new Date(`${I.asOf}T00:00:00.000Z`));
  obs.pace = { basis: f.basis, projectedFinish: f.projectedFinish, slipDays: f.slipDays, velocity: f.velocity };
  const PACE = WP3.forecast.pace;
  rec('FC.pace.basis', f.basis === PACE.basis.value, { expected: PACE.basis.value, observed: obs.pace });
  rec('FC.pace.projectedFinish', f.projectedFinish === PACE.projectedFinish.value, { expected: PACE.projectedFinish.value, observed: f.projectedFinish });
  rec('FC.pace.slipDays', f.slipDays === PACE.slipDays.value, { expected: PACE.slipDays.value, observed: f.slipDays });
};

// ── 087-SCH: the forecast money as the two site engineers read it (E1; WP3ADJ Q6) ──
const fcsFlow = async () => {
  const { P } = ctx.deep['087-SCH'];
  const SM = WP3.forecast.siteEngineerMoney.value;
  const withheldRes = await get('noBoq', `${P}/forecast`);
  const w = withheldRes.body?.data;
  const cost = w?.cost || {};
  const activityCosts = listOf(w?.activities).map((a) => a.cost);
  const topRiskCosts = listOf(w?.schedule?.topRisks).filter((a) => a && 'cost' in a).map((a) => a.cost);
  const withheldObserved = {
    said: h.said(withheldRes),
    withheld: cost.withheld ?? null,
    reason: cost.reason ?? null,
    keysPresent: SM.costKeysAbsent.filter((k) => Object.prototype.hasOwnProperty.call(cost, k)),
    lineKeysPresent: [...new Set(listOf(cost.budgetLines).flatMap((l) => SM.budgetLineKeysAbsent.filter((k) => Object.prototype.hasOwnProperty.call(l, k))))],
    countsAtRisk: Boolean(cost.counts && Object.prototype.hasOwnProperty.call(cost.counts, 'atRisk')),
    activities: activityCosts.length,
    activityCostsWithheld: activityCosts.every((c) => sameJson(c, SM.activityCost)) && topRiskCosts.every((c) => sameJson(c, SM.activityCost)),
  };
  const withheldOk = withheldRes.status === 200 && withheldObserved.withheld === SM.costWithheld && withheldObserved.reason === SM.costReason && withheldObserved.keysPresent.length === 0 && withheldObserved.lineKeysPresent.length === 0 && withheldObserved.countsAtRisk === !SM.countsAtRiskAbsent && withheldObserved.activities > 0 && withheldObserved.activityCostsWithheld;
  const moneyRes = await get('site', `${P}/forecast`);
  const m = moneyRes.body?.data;
  const moneyObserved = { said: h.said(moneyRes), withheld: m?.cost?.withheld ?? null, keys: ['budget', 'bac', 'eac', 'actual'].filter((k) => Object.prototype.hasOwnProperty.call(m?.cost || {}, k)), activityCostsWithheld: listOf(m?.activities).some((a) => a?.cost?.withheld === true) };
  const moneyOk = moneyRes.status === 200 && moneyObserved.withheld !== true && moneyObserved.keys.length === 4 && !moneyObserved.activityCostsWithheld;
  obs.siteEngineerMoney = { tNoBoq: withheldObserved, siteEngineer: moneyObserved };
  rec('FC.siteEngineerMoney', withheldOk && moneyOk, { expected: { tNoBoq: SM, siteEngineer: WP3.forecast.siteEngineerWithBoqRead.value }, observed: obs.siteEngineerMoney, detail: `the T-NOBOQ member ${WP3.forecast.siteEngineerMoneyMember.value.personaKey} (WP3.forecast.siteEngineerMoneyMember); the site engineer persona holds boq:read and receives the money (E1, expected behaviour; the plan's 'no money fields' is siteEngineerWithBoqRead's planValue, reported to the owner, WP3ADJ Q6)` });
};

// ── in process: the default period and the half-hour zones (pure) ────────────
const dpFlow = async () => {
  /* eslint-disable global-require */
  const { pickDefaultReportingPeriod } = require('../../../src/services/earned-value.service');
  const { storedValueForReportingDate, resolveReportingCutoff } = require('../../../src/utils/reporting-cutoff');
  /* eslint-enable global-require */
  /** Periods as stored rows (ReportingPeriod.cutoffDate = the last millisecond of the date in UTC), latest stored cutoff first. */
  const rowsOf = (periods) => periods.map((p) => ({ id: p.code, code: p.code, cutoffDate: storedValueForReportingDate(p.cutoff), evSnapshot: null })).sort((a, b) => b.cutoffDate - a.cutoffDate);
  const pick = (periods, timeZone, now) => pickDefaultReportingPeriod(rowsOf(periods), { timeZone, source: 'project' }, new Date(now))?.code ?? null;
  const ref = IN.ev087.periods;
  const withMarch = [...ref.slice(0, 2), { code: '2026-03', cutoff: '2026-03-31' }]; // WP3.periods.defaultPeriod.on20260401's periods
  const DPL = WP3.periods.defaultPeriod;
  const a = pick(ref, ZONE, '2026-03-05T00:00:00.000Z');
  rec('DP.on20260305', a === DPL.on20260305.value, { expected: DPL.on20260305.value, observed: a });
  const b = pick(withMarch, ZONE, '2026-04-01T00:00:00.000Z');
  rec('DP.on20260401', b === DPL.on20260401.value, { expected: DPL.on20260401.value, observed: b });
  const c = pick(withMarch, D2.WP3.timeZone.value, '2026-04-01T00:00:00.000Z'); // 052's zone, America/Chicago
  rec('DP.chicagoCaution', c === DPL.chicagoCaution.value, { expected: DPL.chicagoCaution.value, observed: c });
  // +05:30 and +05:45 with an injected zone (plan §3.1 :392; WP3ADJ Q9): the end of 2026-02-28 and the flip of the default period
  const HALF = { kolkata: 'Asia/Kolkata', kathmandu: 'Asia/Kathmandu' };
  const fixed = ref.slice(0, 2);
  const observed = {};
  const expected = {};
  for (const [key, zone] of Object.entries(HALF)) {
    const z = WP3.periods.halfHourZones[key];
    if (!z || !String(z.cutoff.derivation).includes(zone)) throw new Error(`WP3.periods.halfHourZones.${key} does not name ${zone}`);
    const cutoff = resolveReportingCutoff({ value: '2026-02-28', timeZone: zone, timeZoneSource: 'project' }).cutoffDate.toISOString();
    const justBefore = new Date(Date.parse(z.cutoff.value) - 1).toISOString();
    observed[key] = { cutoff, defaultJustBefore: pick(fixed, zone, justBefore), defaultAtCutoff: pick(fixed, zone, z.cutoff.value) };
    expected[key] = { cutoff: z.cutoff.value, defaultJustBefore: z.defaultJustBefore.value, defaultAtCutoff: z.defaultAtCutoff.value };
  }
  rec('DP.halfHour', sameJson(observed, expected), { expected, observed });
};

// ── 052-SCH-EV and 006-LITE ───────────────────────────────────────────────────
const d2Flow = async () => {
  const s = storedD2(ctx.state['052-SCH-EV']);
  rec('D2.stored.T1', s['D2.stored.T1'].ok === true, { expected: s['D2.stored.T1'].expected, observed: s['D2.stored.T1'].observed, detail: s['D2.stored.T1'].detail });
  rec('D2.stored.T2', s['D2.stored.T2'].ok === true, { expected: s['D2.stored.T2'].expected, observed: s['D2.stored.T2'].observed, detail: s['D2.stored.T2'].detail });
  ka('KA.D2.stored.T3', { ref: 'L34', ...pickKa(s['KA.D2.stored.T3']), detail: 'stored at the build (052-SCH-EV wp3.T3)' });
  await probe('KA.D2.live.T3 (052-SCH-EV)', async () => {
    const { P } = ctx.deep['052-SCH-EV'];
    const read = await evRead('cost052', P, '?cutoffDate=2026-02-28');
    if (read.res.status !== 200) throw probeSetup('KA.D2.live.T3', `052's GET ?cutoffDate=2026-02-28 answered ${read.said}`);
    const T3 = D2.WP3.T3;
    const o = { cutoffDate: read.report?.reporting?.cutoffDate ?? null, pv: read.figures?.pv ?? null, ev: read.figures?.ev ?? null, ac: read.figures?.ac ?? null, zone: zoneOf(read.report?.reporting), contract: contractProblems(read.report) };
    const frame = o.cutoffDate === T3.cutoff.value && o.pv === T3.pv.value && o.ev === T3.ev.value && o.zone.timeZone === D2.WP3.timeZone.value;
    const v = !frame ? 'wrong' : o.ac === T3.ac.value ? (o.contract.length ? 'wrong' : 'value') : o.ac === T3.ac.today ? 'today' : 'wrong';
    ka('KA.D2.live.T3', { ref: 'L34', value: { cutoff: T3.cutoff.value, pv: T3.pv.value, ev: T3.ev.value, ac: T3.ac.value }, today: { ac: T3.ac.today }, observed: o, verdict: v, detail: `live: strict after the fix; ${contractNote()}` });
  });
};
const d3Flow = async () => {
  const s = storedD3(ctx.state['006-LITE']);
  rec('D3.stored.T1', s['D3.stored.T1'].ok === true, { expected: s['D3.stored.T1'].expected, observed: s['D3.stored.T1'].observed });
};

// ── confirm-first classification from this run's observations ─────────────────
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
  cf('CF.L34', { ...split([['087-EV live: AC at 2026-02-28 from the cumulative record', kaState('KA.EVL.cutoff0228')], ['V: a lock freezes the cumulative-record AC', kaState('KA.PER.V.lockAc')], ['V: the 2026-02-28 read after the back-dated cost', kaState('PER.V.afterLock.cutoffChanges')], ['052-SCH-EV live: AC at 2026-02-28', kaState('KA.D2.live.T3')]]), detail: `the stored moments and frozen snapshots are judged in their own checks (STORED-PRE-FIX after the fix, WP3ADJ Q3); L34 fix ${L34_FIX.commit || 'not yet'}` });
  cf('CF.L118', { ...split([['a retired activity\'s AC dropped at the build (T6.after)', kaState('KA.EVS.T6.after')], ['still dropped at the run date', kaState('KA.EVL.runDate')]]), detail: `${json({ stored: knownAnswers['KA.EVS.T6.after']?.observed?.ac, live: knownAnswers['KA.EVL.runDate']?.observed?.ac })}; HR-S9 undecided; the L34 fix keeps the isActive filter (WP3ADJ Q4)` });
  const l = obs.l112;
  const silent = (step) => (!step ? 'gap' : step.said === '200' && step.newAuditEvents === 0 ? 'present' : (statusPart(step.said) >= 400 && statusPart(step.said) < 500) || step.newAuditEvents > 0 ? 'absent' : 'gap');
  cf('CF.L112', { ...split([['V: an approved revision\'s amount edited with no audit event', silent(l?.edit)], ['V: an approved revision deleted with no audit event', silent(l?.delete)], ['087-EV build: the PM\'s silent delete', kaState('KA.EVS.T5delete')]]), detail: `${json(l, 700)}; P2 proposed, not on the section 5 defect-fix list (WP3ADJ Q8)` });
  const routes = periodRouteScan();
  const lockAudit = obs.lockAudit087EV;
  cf('CF.L113', { ...split([['a period locked before its cutoff (V-F)', kaState('KA.PER.futureCutoffLock')], ['no unlock route (routes/reports.js)', routes.unlockMentions === null ? 'gap' : yes(routes.unlockMentions.length === 0)], ['a normal lock writes no audit event (087-EV January)', !lockAudit ? 'gap' : yes(lockAudit.janOverridden === 0 && lockAudit.janEntityEvents === 0)]]), detail: `${json({ futureCutoffLock: obs.futureCutoffLock, unlockMentions: routes.unlockMentions, lockAudit })}; HR-E2 undecided` });
  const l106 = l106Scan();
  cf('CF.L106', { ...split([['the forecast lists a line within its budget as an overrun (V5)', kaState('KA.FC.L106')], ['budgetLineRisks reads line.revised (forecast.service.js)', yes(l106.readsRevised)], ['the register emits revisedBudget, not revised (budget.service.js serializeLine)', l106.registerEmitsRevisedBudget === null ? 'gap' : yes(l106.registerEmitsRevisedBudget && !l106.registerEmitsRevised)]]), detail: `${json({ live: obs.l106, scan: l106 })}; on the section 5 defect-fix list: fixed in WP-3 only if it confirms as P1 (WP3ADJ Q7)` });
  const t4 = obs.t4;
  const ev0 = t4?.read4?.figures;
  cf('CF.HRE3', { ...split([['CPI 0 gives EAC = BAC', !ev0 ? 'gap' : yes(ev0.cpi === 0 && ev0.eac === ev0.bac)], ['labelled budget_cpi_zero', !ev0 ? 'gap' : yes(ev0.eacBasis === 'budget_cpi_zero')]]), detail: `${json(ev0)}; HEAD equals HR-E3's recommendation: owner question 'keep as is?' (WP3ADJ Q15)` });
  const alerts = alertScan();
  const flagsOnReads = t4 ? Object.values(t4).every((x) => typeof x.figures?.spiAlert === 'boolean' && typeof x.figures?.cpiAlert === 'boolean') : null;
  cf('CF.HRE4', { ...split([['the 0.9 flags are computed only in the EV report (earned-value.service.js)', yes(alerts.flagSites.length > 0 && alerts.flagSites.every((s) => s.startsWith('services/earned-value.service.js:')))], ['the EV service sends no notice', alerts.evNoticeRequires === null ? 'gap' : yes(alerts.evNoticeRequires.length === 0)], ['no exception rule tests SPI', yes(alerts.spiRules.length === 0)], ['the flags are on V\'s reports', yes(flagsOnReads)]]), detail: `${json(alerts)}; HR-E4 undecided; its exception kind is WP-9's (owner question, WP3ADJ Q15)` });
  const conc = obs.concurrentLocks;
  cf('CF.concurrentLocks', { ...split([['two locks of one period both succeed', kaState('KA.PER.concurrentLocks')]]), detail: json(conc) });
  const ar = obs.actorRole;
  const recorded = ar?.events?.map((e) => String(e.actorRole ?? '').toLowerCase()) || [];
  cf('CF.actorRole', { ...split([['the loading\'s events record the organisation role (qs), not the project role (cost_controller)', !ar || !recorded.length ? 'gap' : ar.projectRole !== ACTOR_PROJECT_ROLE ? 'gap' : recorded.every((x) => x === ar.orgRole) ? 'present' : recorded.every((x) => x === ar.projectRole) ? 'absent' : 'gap']]), detail: `${json(ar)}; routes/reports.js records req.user.role on the loading routes, getEffectiveRole on the lock route` });
  const zs = zoneScan();
  // eslint-disable-next-line global-require
  const { resolveReportingTimeZone } = require('../../../src/utils/reporting-cutoff');
  const precedence = resolveReportingTimeZone({ project: { timezone: WP3.confirmFirst.zonePrecedence.value.timeZone }, organisation: { defaultTimezone: D3.WP3.timeZone.value } });
  const projectWritesOutsideCreate = zs.projectZoneWrites.filter((w) => w.fn !== 'createProject');
  cf('CF.WP3TZ1', { ...split([['a path writes Organisation.defaultTimezone after creation', !zs.orgWrites.length ? 'gap' : yes(zs.orgWrites.some((w) => w.writesZone))], ['the project API takes a zone', zs.zoneFields === null ? 'gap' : yes(zs.zoneFields.length > 0)], ['a project\'s zone is written after its creation', !zs.projectZoneWrites.length ? 'gap' : yes(projectWritesOutsideCreate.length > 0)], ['the company zone overrides a project\'s own', yes(!sameJson({ timeZone: precedence.timeZone, source: precedence.source }, WP3.confirmFirst.zonePrecedence.value))]]), detail: `${json({ scan: zs, precedence }, 900)}; WP3.confirmFirst.zoneChange: ${WP3.confirmFirst.zoneChange.value}` });
};

// ── the run ────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log(`wp3-ev-proof: ${ACTIVE.length} of ${EXPECTED_CHECKS} checks active${ONLY ? ` (--only=${[...ONLY].join(',')})` : ''}${SKIP ? ` (--skip=${[...SKIP].join(',')})` : ''}${PROJECT_FILTER ? ` (--project=${PROJECT_FILTER})` : ''}; sections ${[...selectedSections].join(' ')}; deep projects ${NEED_DEEP.join(', ') || 'none'}; V ${NEED_V ? 'yes' : 'no'}; L34 fix ${L34_FIX.commit || 'not set'}; in process\n`);
  if (ACTIVE.length !== CHECKS.length) console.log(`not exercised in this run (filtered out): ${CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id).join(', ')}\n`);
  await setup();
  // V's fixture in its own section: when it cannot be set up the run is a setup error, and the other sections still run.
  if (NEED_V) await h.section('V: the fixture (V1-V4, S.V.fixture)', async () => { await vSetup(); ctx.vReady = true; });
  else await vSetup();
  if (NEED_V && ctx.vReady) await h.section('V: the WP-3 choreography on the throwaway project (V5-V25)', vFlow);
  if (on('EVS')) await h.section('087-EV: the stored WP-3 moments', evsFlow);
  if (on('EVL') || on('PER')) await h.section('087-EV: the live reads and the period probes that write nothing', evlFlow);
  if (on('FC')) await h.section('in process: the forecast pace', fcPureFlow);
  if (on('FCS')) await h.section('087-SCH: the forecast money as the two site engineers read it', fcsFlow);
  if (on('DP')) await h.section('in process: the default period and the half-hour zones', dpFlow);
  if (on('D2')) await h.section('052-SCH-EV: the stored WP-3 moments and the live 2026-02-28 read', d2Flow);
  if (on('D3')) await h.section('006-LITE: the stored WP-3 T1', d3Flow);
  if (on('CF')) await h.section('confirm-first classification', async () => confirmFirstFlow());
};

/** The per-check records, the known answers, the confirm-first classifications, the decided-rule table and the tally, written in cleanup (always). */
const recordObservations = () => {
  for (const [id, r] of Object.entries(records)) r.registered = ACTIVE_IDS.has(id);
  for (const [id, k] of Object.entries(knownAnswers)) k.registered = ACTIVE_IDS.has(id);
  h.observe('checks', records);
  h.observe('knownAnswers', knownAnswers);
  h.observe('confirmFirst', confirmFirst);
  h.observe('decidedRules', Object.fromEntries(Object.entries(DECIDED_RED).map(([id, d]) => [id, { ...d, verdict: records[id]?.verdict ?? 'not run', expectedAtHead: 'FAIL (RED until the L34 fix lands; STORED-PRE-FIX for a stored moment once L34_FIX is set)' }])));
  h.observe('l34Fix', { ...L34_FIX, git: obs.l34FixGit ?? null, contract: CONTRACT_L34 });
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
    knownAnswers: { value: known.filter((k) => k.status === 'PASS').length, blocked: known.filter((k) => k.status === 'BLOCKED').length, storedPreFix: known.filter((k) => k.status === 'STORED-PRE-FIX').length, fail: known.filter((k) => k.status === 'FAIL').length, wrong: known.filter((k) => k.verdict === 'wrong').length },
    confirmFirst: Object.fromEntries(Object.entries(confirmFirst).map(([id, c]) => [id, c.classification])),
    notExercised: CHECKS.filter((c) => !ACTIVE_IDS.has(c.id)).map((c) => c.id),
  };
  h.observe('tally', tally);
  console.log(`\ntally: ${tally.pass} pass, ${tally.fail} fail of ${tally.activeRecorded} recorded (${tally.active} active); decided-rule RED (L34): ${tally.decidedRedFailing.join(', ') || 'none'}; other failures: ${tally.otherFailing.join(', ') || 'none'}; known answers: ${tally.knownAnswers.value} value, ${tally.knownAnswers.blocked} BLOCKED, ${tally.knownAnswers.storedPreFix} STORED-PRE-FIX, ${tally.knownAnswers.fail} fail (${tally.knownAnswers.wrong} wrong)`);
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
      const prefix = String(VI.project.name).replace('<stamp>', '').trim();
      const page = await get('pm', `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(prefix)}`);
      const mine = listOf(page.body?.data).filter((p) => String(p.name || '').startsWith(prefix));
      const live = mine.filter((p) => !p.archivedAt);
      notes.push(`throwaway check (GET /projects as 087 PM, ${h.said(page)}): ${mine.length} '${prefix}' projects, ${live.length} live${live.length ? ` (${live.map((p) => `${p.name} ${p.id}`).join(', ')})` : ''}`);
      h.observe('throwawayCheck', { said: h.said(page), total: mine.length, live: live.map((p) => ({ id: p.id, name: p.name })) });
    } catch (error) {
      notes.push(`throwaway check failed: ${error.message}`);
    }
  }
  notes.push(`deep projects: ${ctx.deepWrites.length ? `UNEXPECTED WRITES: ${ctx.deepWrites.join('; ')}` : 'nothing written (the relocks returned their snapshots; the loading and the period creates were refused; the rest were reads)'}`);
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

module.exports = { __wp3: { kaStatus, storedEv087, storedD2, storedD3, branchOf, figuresOf, summaryFigures, metricVerdict, valuesOf, reportHash, zoneScan, alertScan, periodRouteScan, l106Scan, CHECKS, CATCHERS, DECIDED_RED, CONTRACT_L34, L34_FIX } };

h.run({ main, cleanup });
