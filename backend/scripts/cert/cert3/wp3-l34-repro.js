'use strict';

/**
 * WP-3 L34 reproduction: official actual cost at a past cutoff, and in a
 * locked reporting period, read from the wrong source.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp3-l34-repro.js
 *
 * No flags, ever: mutate-multi.js runs it with none (list key
 * 'wp3fix-l34-repro', the L34 fix list wp3-fix-mutations.l34.json; each entry's
 * repro field names its R catchers).
 *
 * THE DEFECT. At HEAD (earned-value.service.js getOfficialActualCostMap
 * :486-514 @f599e67) an activity's whole cumulative CostRecord.actual counts
 * at a cutoff only while its forward-only actualThroughDate is on or before
 * it (cost-ledger.service.js:205-224), so one posting dated after a cutoff
 * removes the activity's earlier cost there, and a lock freezes it. THE
 * DECIDED RULE (plan section 0.1 :53-55; HR-E1 :1092; WP3.L34.acRule): official
 * AC = the cost ledger's entries that carry an activity, dated incurredOn on
 * or before the cutoff date; the isActive filter is kept (WP3.L34.isActiveFilter,
 * WP3ADJ Q4); a reversal counts at its own incurredOn, the original's
 * (WP3.L34.reversals). Sources: C:\Temp\octapm-cert\scratch\wp3\fixplan\
 * L34-FIX-PLAN.md (s1.2-s1.5 repros L-R1..L-R3, s6.3, s7), WP3-PREP.md section 9
 * (R1-R9), WP3-ADJUDICATION.md (the L34 paragraph, Q3, Q4, Q5),
 * PREP4-ADJUDICATION.md section C item 4 (this script: the only live catcher
 * of the fix mutation L34-M3).
 *
 * WHERE. In process (CERT_INPROCESS=1, through the lock runner only) on the
 * certification database, on ONE throwaway project of company 087, R ("CERT3
 * WP3 L34 repro <stamp>"), created by 087's PM, used and archived (DELETE
 * /projects/:id) in cleanup whatever happened. Nothing is written on 087-EV,
 * 052-SCH-EV or any other project; company 087's cost-code library is only
 * read (01-100 and 02-100 are selected onto R). R is built from the answer
 * book's 087-EV records (inputs.ev087: the five-row BOQ allocated whole, BAC
 * 387,000.00; the five loadings; the direct costs A110 50,000.00 on 01-20 and
 * 10,000.00 on 09-30, A130 20,000.00 on 02-10, A120 30,000.00 on 10-01), so
 * the WP3.T3 / WP3.periods.* figures are R's. No progress is approved on R:
 * EV is 0 at every past cutoff either way (the book's EV there is 0, every
 * approval being stamped after those cutoffs), and the run-date control
 * judges AC only. Personas: 087's pm, planner, qs, cost (cost_controller),
 * finance. Every write goes through a product route. (The draft's R8, an
 * HR-S9 known answer that retired A140 with a SQL fixture, was dropped by the
 * integration owner on 2026-10-10: a proof writes only through product paths,
 * and an undecided HR-S9 reading BLOCKED adds no L34 evidence.)
 *
 * THE CHECKS (fixed before the first run: 12 + the harness's G.5xx; money in
 * cents; the run date is the Cairo date at the start of the run, fixed for
 * every run-date read, and must be on or after 2026-10-01, the latest dated
 * fixture row):
 *
 *   id          what                                                        decided (fix)              HEAD
 *   S.personas  087's pm, planner, qs, cost, finance sign in (setup)
 *   S.project   R created (WP3.L34.repro.inputs), four team members (setup)
 *   S.fixture   six hand-built activities, BOQ + 5 approved allocations,
 *               5 approved loadings, the 4 fixture costs approved; the
 *               ledger rows are the book's; run-date BAC = PV = 387,000.00,
 *               zone Africa/Cairo (setup)
 *   R1  defect  ?cutoffDate=2026-02-28: WP3.T3 (13 figures)                  AC 70,000.00               20,000.00  FAIL
 *   R2  defect  ?cutoffDate=2026-01-31: WP3.periods.jan.snapshot             AC 50,000.00, CPI 0 alert  0, CPI null FAIL
 *   R3  check   run-date AC = WP3.T2.ac (both readings agree)                110,000.00                 110,000.00
 *   R4  defect  period 2026-02 locked by the PM with a reason; the served
 *               snapshot = WP3.periods.feb.snapshot = the open read          AC 70,000.00               20,000.00  FAIL
 *   R5  defect  after the back-dated A130 5,000.00 (02-15):
 *               ?cutoffDate=2026-02-28 = WP3.periods.afterLock.cutoffAfterCost  75,000.00            25,000.00  FAIL
 *   R5.frozen   the locked 2026-02 report byte-identical after that cost
 *               (WP3.periods.afterLock.periodReport)                         PASS                       PASS
 *   R6  check   that cost voided (mirror at its incurredOn): AC drops by
 *               5,000.00 at 02-28 and at the run date, 0 at 01-31 (WP3.L34.reversals;
 *               WP3.L34.repro.R6)                                            PASS                       PASS
 *   R7  defect  A110's cost record typed actualThroughDate 2099-01-01:
 *               run-date AC unchanged (WP3.L34.repro.R7)                     delta 0                    -60,000.00 FAIL
 *   R9  check   a cost-code-only 2,000.00 dated 02-20 (no activity): AC at
 *               02-28 and the run date unchanged (WP3.L34.acRule)            PASS                       PASS
 *   G.5xx       no answer was a 5xx (harness)
 *
 * Expected at HEAD: 13 recorded, 5 FAIL (R1, R2, R4, R5, R7),
 * exit 2, DEFECT_PRESENT, harness classification CONFIRMED (5 of 5 defect
 * checks). On the L34-fixed tree: exit 0, PASS, classification
 * REJECTED. Under the fix mutations (on the fixed tree): L34-M1 FAIL R1 R2 R4
 * R5; L34-M1R (narrowed) FAIL R1 R2 R4 R5 R7; L34-M2 FAIL R1 R2 R4 R5 R6 (R6:
 * the 2026-01-31 read counts the mirror dated 02-15); L34-M3 FAIL R6 ONLY (the
 * void does not net out: delta 0); L34-M4 nothing (survives); L34-M5 nothing
 * while the book's contract leaves are pending, R1 R2 R4 R5 once
 * WP3.L34.formulaVersion carries its adjudicated value. Exit 2 in every
 * caught case: the setup checks read nothing a mutant moves. (If Prisma
 * refuses L34-M1's nested filter, every EV read answers 500 and the run ends
 * as a setup error at S.fixture: the fix plan's R-4.)
 *
 * The contract-visible fields of the fix (formulaVersion, actualCostSource,
 * the basis texts) are judged on R1, R2, R4 and R5 exactly as the WP-3 proof
 * judges its live checks (contractProblems): only once the book's WP3.L34
 * leaves carry their adjudicated values; while they read 'contract pending
 * the L34 plan review' nothing is judged (WP3ADJ Q5). R6-R9 are deltas and
 * never judge the contract, so R6 stays attributable to the reversal rule.
 *
 * Figures: every expected figure is an answer-book leaf (WP3.*, inputs.ev087)
 * or a PROPOSED leaf (WP3.L34.repro.*, below; listed for the book owner in
 * C:\Temp\octapm-cert\scratch\wp3\repro\wp3-l34-repro.proposed-leaves.json).
 * The proposed figures are re-derived at load with the book's own rules
 * (rules.acLedger, rules.acHead) and the load refuses any departure; once the
 * book carries WP3.L34.repro.* the book's leaves are used and must equal them.
 *
 * Exit 0 every check holds (the decided behaviour), 2 a check failed (the
 * defect present), 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\wp3-l34-repro.json (records, known
 * answers, the R6 ledger rows, the tally: written in cleanup).
 *
 * DRAFT (read-only preparation, 2026-10-10): never run against the product by
 * its author. Checked without a database: registration-check.js (the real
 * harness registers exactly these 13 checks; a model of every code version
 * gives EXPECT_FAIL) and fake-run.js (main and cleanup end to end against an
 * in-memory fake of the routes and SQL used: 16 dry runs, each as expected),
 * both in C:\Temp\octapm-cert\scratch\wp3\repro\. Claude Main installs it as
 * backend/scripts/cert/cert3/wp3-l34-repro.js.
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const api = require('../lib/api');
const certEnv = require('../lib/cert-env');
const SCHEDULE = require('./answers/schedule');

const { WP3 } = SCHEDULE;
const EV = SCHEDULE.inputs.ev087;
const BOOK_RULES = SCHEDULE.rules;
const PLAN_DOC = 'docs/certification/OCTAPM_CERT3_PLAN.md';
const NAME = 'wp3-l34-repro';
const COMPANY = '087';
const ZONE = WP3.setup.timeZone.value; // Africa/Cairo (company 087; R copies it at creation)
const L34_PENDING = 'contract pending the L34 plan review';
const PERSONAS = ['pm', 'planner', 'qs', 'cost', 'finance'];
const CUT_JAN = '2026-01-31';
const CUT_FEB = '2026-02-28';

// -- small helpers ------------------------------------------------------------
const listOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'members', 'events', 'periods', 'rows', 'lines', 'allocations', 'activities']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const json = (v, max = 600) => { try { return JSON.stringify(v).slice(0, max); } catch { return String(v).slice(0, max); } };
const r6 = (x) => (x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(Number(x).toFixed(6)));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
};
const sameJson = (a, b) => canonical(a) === canonical(b);
const localDate = (instant, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
/** Money as integer cents (the API answers currency units); a value that is not an exact amount reads as a string, so it never matches. */
const cents = (v) => {
  if (v === null || v === undefined) return null;
  try { return harness.toCents(v); } catch { return `not cents: ${v}`; }
};
const sortRows = (rows) => [...rows].map((row) => row.map(String)).sort((a, b) => a.join('|').localeCompare(b.join('|')));
const leafAt = (key) => key.split('.').reduce((node, k) => (node && typeof node === 'object' ? node[k] : undefined), SCHEDULE);

// -- the book this script needs (the WP-3 book patch applied) -----------------
{
  const needed = [
    'WP3.L34.acRule', 'WP3.L34.isActiveFilter', 'WP3.L34.reversals', 'WP3.L34.formulaVersion', 'WP3.L34.actualCostSource', 'WP3.L34.basisTexts',
    'WP3.T1.bac', 'WP3.T1.pv', 'WP3.T2.ac', 'WP3.T3.cutoff', 'WP3.T3.ac', 'WP3.T3.ev',
    'WP3.periods.jan.cutoff', 'WP3.periods.jan.snapshot.ac', 'WP3.periods.jan.snapshot.ev', 'WP3.periods.feb.cutoff', 'WP3.periods.feb.snapshot.ac',
    'WP3.periods.afterLock.backdatedCost', 'WP3.periods.afterLock.cutoffAfterCost.ac', 'WP3.periods.afterLock.cutoffAfterCost.ev', 'WP3.periods.afterLock.periodReport',
    'WP3.T6.ledgerDelta', 'WP3.T6.acAfterRetirement', 'WP3.setup.timeZone', 'WP3.setup.timeZoneSource', 'WP3.setup.timeZoneNote', 'WP3.setup.allocations',
  ];
  const missing = needed.filter((key) => { const leaf = leafAt(key); return !leaf || typeof leaf !== 'object' || !('value' in leaf); });
  if (missing.length) throw new Error(`answers/schedule.js carries no leaf ${missing.join(', ')}: apply the WP-3 book patch (C:/Temp/octapm-cert/scratch/wp3/book/book-insert.js) first`);
  for (const key of ['boq', 'loadings', 'directCosts', 't2Cost', 'backdatedAfterLock', 'a140Cost', 'periods']) if (!EV?.[key]) throw new Error(`answers/schedule.js inputs.ev087.${key} is missing`);
  // R carries no progress: the book's EV at the past cutoffs R reads is 0 (every approval is stamped after them).
  if (WP3.T3.ev.value !== 0 || WP3.periods.jan.snapshot.ev.value !== 0 || WP3.periods.afterLock.cutoffAfterCost.ev.value !== 0) throw new Error('the book\'s EV at 2026-01-31 / 2026-02-28 is not 0: R (no progress) would not carry the book\'s figures');
  // The February snapshot is the T3 set; the back-dated cost is inputs.ev087's; February is inputs.ev087.periods[1].
  if (WP3.periods.feb.snapshot.ac.value !== WP3.T3.ac.value || !sameJson(WP3.periods.afterLock.backdatedCost.value, EV.backdatedAfterLock)) throw new Error('WP3.periods.feb.snapshot / afterLock.backdatedCost do not match WP3.T3 / inputs.ev087');
  const feb = EV.periods[1];
  if (!feb || feb.code !== '2026-02' || feb.cutoff !== CUT_FEB || EV.periods[0]?.cutoff !== CUT_JAN) throw new Error('inputs.ev087.periods[0..1] are not 2026-01 / 2026-02');
  // BAC: the five allocations whole (WP3.setup.allocations, cents) = WP3.T1.bac = the T3 / January / after-lock sets' bac.
  const allocated = Object.values(WP3.setup.allocations.value).reduce((s, x) => s + x, 0);
  const boqAllocated = EV.boq.reduce((s, row) => s + row.allocations.reduce((t, a) => t + harness.toCents(a[2]), 0), 0);
  if (allocated !== WP3.T1.bac.value || boqAllocated !== allocated || WP3.T3.bac.value !== allocated || WP3.periods.jan.snapshot.bac.value !== allocated || WP3.periods.afterLock.cutoffAfterCost.bac.value !== allocated) throw new Error('the book\'s BAC leaves disagree with inputs.ev087.boq');
}

// -- the proposed leaves (WP3.L34.repro.*): fixture choices and the R6-R9 figures --
/**
 * Not in the book yet: proposed for the book owner (wp3-l34-repro.proposed-leaves.json, same values). Re-derived at load
 * below with the book's rules; once the book carries WP3.L34.repro.<key>, the book's value / today / ref must equal these.
 */
const PROPOSED = Object.freeze({
  inputs: {
    unit: 'text',
    value: {
      project: { name: 'CERT3 WP3 L34 repro <stamp>', start: '2026-01-05', end: '2027-06-30', calendar: 'five_day', currency: 'EGP', projectType: 'building', contractType: 'unit_rate' },
      team: { planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', finance: 'finance' },
      activities: { codes: ['A110', 'A120', 'A130', 'A140', 'A310', 'A320'], start: '2026-01-05', end: '2026-12-31', wbsCode: 'L34-R', category: 'civil', engineer: 'planner' },
      costCodeOf: { A110: '01-100', A120: '02-100', A130: '02-100', A140: '01-100' },
      costTypeOf: { A110: 'equipment', A120: 'material', A130: 'material', A140: 'labour' },
      period: '2026-02',
      progress: 'none',
    },
  },
  R6: { unit: 'cents', value: { voided: ['A130', 5000, '2026-02-15'], acDelta: { '2026-01-31': 0, '2026-02-28': -500000, runDate: -500000 } } },
  R7: { unit: 'cents', value: { activity: 'A110', typedThroughDate: '2099-01-01', runDateAcDelta: 0 }, today: { runDateAcDelta: -6000000 }, ref: 'L34' },
  R9: { unit: 'cents', value: { line: { activity: null, costCode: '01-100', costType: 'material', amount: 2000, costDate: '2026-02-20' }, acDelta: { '2026-02-28': 0, runDate: 0 } } },
});
/** A WP3.L34.repro leaf: the book's once it carries one (its value / today / ref must equal the proposal), else the proposal. */
const LEAF = Object.freeze(Object.fromEntries(Object.entries(PROPOSED).map(([key, proposed]) => {
  const book = leafAt(`WP3.L34.repro.${key}`);
  if (book && (!sameJson(book.value, proposed.value) || !sameJson(book.today ?? null, proposed.today ?? null) || (book.ref ?? null) !== (proposed.ref ?? null))) {
    throw new Error(`answers/schedule.js WP3.L34.repro.${key} differs from this script's proposal: re-derive one of them (A10)`);
  }
  return [key, { ...proposed, source: book ? 'book' : 'proposed' }];
})));
const IN = LEAF.inputs.value;

// -- the proposed figures re-derived with the book's rules (A10: worked on paper, never computed from a read) --
const c = (amount) => harness.toCents(amount);
const bookRow = ([code, amount, date]) => [code, c(amount), date];
/** The book's reference run date (schedule.js RUN; its runDateAssumption: on or after 2026-10-01). Only the deltas use it. */
const REF_RUN = '2026-10-09';
const ROWS_FIXTURE = [...EV.directCosts, EV.t2Cost].map(bookRow);
const ROW_BACKDATED = bookRow(EV.backdatedAfterLock);
const ROWS_R5 = [...ROWS_FIXTURE, ROW_BACKDATED];
const ROW_MIRROR = [ROW_BACKDATED[0], -ROW_BACKDATED[1], ROW_BACKDATED[2]];
const ROWS_R6 = [...ROWS_R5, ROW_MIRROR];
const LATEST_FIXTURE_DAY = ROWS_R5.map((r) => r[2]).sort().pop();
const deltasOf = (acOf, before, after) => ({
  [CUT_JAN]: acOf(CUT_JAN, after) - acOf(CUT_JAN, before),
  [CUT_FEB]: acOf(CUT_FEB, after) - acOf(CUT_FEB, before),
  runDate: acOf(REF_RUN, after) - acOf(REF_RUN, before),
});
const DERIVED = (() => {
  const { acLedger, acHead } = BOOK_RULES;
  const problems = [];
  if (!(LATEST_FIXTURE_DAY <= REF_RUN) || LATEST_FIXTURE_DAY !== '2026-10-01') problems.push(`the latest fixture row is dated ${LATEST_FIXTURE_DAY}, not 2026-10-01 on or before the reference run date`);
  // R6: the void of the back-dated cost writes a mirror at the original's incurredOn (WP3.L34.reversals).
  const r6Ledger = deltasOf(acLedger, ROWS_R5, ROWS_R6);
  const r6Head = deltasOf(acHead, ROWS_R5, ROWS_R6); // HEAD: the projection nets the mirror; the through-date stays at 02-15
  const r6M3 = deltasOf((cut, rows) => acLedger(cut, rows.filter((r) => r !== ROW_MIRROR)), ROWS_R5, ROWS_R6); // L34-M3: reversals left out
  if (!sameJson(LEAF.R6.value.voided, EV.backdatedAfterLock)) problems.push('R6.voided is not inputs.ev087.backdatedAfterLock');
  if (!sameJson(r6Ledger, LEAF.R6.value.acDelta)) problems.push(`R6.acDelta ${json(LEAF.R6.value.acDelta)} is not the ledger rule's ${json(r6Ledger)}`);
  if (!sameJson(r6Head, r6Ledger)) problems.push(`R6: HEAD's reading ${json(r6Head)} departs from the ledger's ${json(r6Ledger)} (R6 must pass at HEAD)`);
  if (r6M3[CUT_FEB] === r6Ledger[CUT_FEB] || r6M3.runDate === r6Ledger.runDate) problems.push(`R6 does not tell L34-M3 apart (${json(r6M3)})`);
  // R7: a typed through-date far ahead (a zero-amount row moves HEAD's through-date; the ledger holds no posting for it).
  const typed = [LEAF.R7.value.activity, 0, LEAF.R7.value.typedThroughDate];
  const r7Ledger = acLedger(REF_RUN, [...ROWS_R6, typed]) - acLedger(REF_RUN, ROWS_R6);
  const r7Head = acHead(REF_RUN, [...ROWS_R6, typed]) - acHead(REF_RUN, ROWS_R6);
  const a110Whole = -ROWS_R6.filter((r) => r[0] === LEAF.R7.value.activity).reduce((s, r) => s + r[1], 0);
  if (r7Ledger !== LEAF.R7.value.runDateAcDelta || r7Head !== LEAF.R7.today.runDateAcDelta || r7Head !== a110Whole) problems.push(`R7: ledger ${r7Ledger}, HEAD ${r7Head} (A110 whole ${a110Whole}) against ${json(LEAF.R7)}`);
  // R9: a posting without an activity is in neither reading (the book's rows always carry one).
  if (LEAF.R9.value.line.activity !== null || !sameJson(LEAF.R9.value.acDelta, { [CUT_FEB]: 0, runDate: 0 })) problems.push('R9: a cost-code-only line must leave AC unchanged');
  if (problems.length) throw new Error(`wp3-l34-repro: the proposed leaves do not follow from the book: ${problems.join('; ')}`);
  return { r6Ledger, r6Head, r6M3, r7Ledger, r7Head };
})();

// -- the 13 EV figures in the book's units (as wp3-ev-proof.js) ----------------
const METRIC_KEYS = ['bac', 'pv', 'ev', 'ac', 'spi', 'spiAlert', 'cpi', 'cpiAlert', 'eac', 'eacBasis', 'sv', 'cv', 'etc'];
const MONEY_KEYS = new Set(['bac', 'pv', 'ev', 'ac', 'eac', 'sv', 'cv', 'etc']);
const RATIO_KEYS = new Set(['spi', 'cpi']);
const asBook = (key, v) => (v === null || v === undefined ? null : MONEY_KEYS.has(key) ? cents(v) : RATIO_KEYS.has(key) ? r6(v) : v);
const figuresOf = (report) => {
  if (!report || typeof report !== 'object') return null;
  const src = { ...report, bac: report.totalBudget ?? report.bac, spiAlert: report.alerts?.spiAlert, cpiAlert: report.alerts?.cpiAlert };
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, asBook(k, src[k])]));
};
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
const sameFigures = (a, b) => sameJson(figuresOf(a), figuresOf(b));
const ZONE_EXPECT = { timeZone: WP3.setup.timeZone.value, timeZoneSource: WP3.setup.timeZoneSource.value, timeZoneNote: WP3.setup.timeZoneNote.value };
const zoneOf = (reporting) => ({ timeZone: reporting?.timeZone ?? null, timeZoneSource: reporting?.timeZoneSource ?? null, timeZoneNote: reporting?.timeZoneNote ?? null });
const canonicalObject = (value) => {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalObject(value[k])]));
  return value;
};
/** sha256 of the canonical JSON of a report without reporting.asOfDate (wp3-ev-proof.js reportHash). */
const reportHash = (report) => {
  const copy = JSON.parse(JSON.stringify(report ?? null));
  if (copy && copy.reporting) delete copy.reporting.asOfDate;
  // eslint-disable-next-line global-require
  return require('crypto').createHash('sha256').update(JSON.stringify(canonicalObject(copy))).digest('hex');
};

// -- the L34 fix's contract-visible fields (WP3ADJ Q5), exactly as wp3-ev-proof.js contractProblems --
const contractField = (leaf) => (leaf.value === L34_PENDING ? null : leaf.value);
const CONTRACT_L34 = Object.freeze({
  formulaVersion: contractField(WP3.L34.formulaVersion),
  actualCostSource: contractField(WP3.L34.actualCostSource),
  basisTexts: contractField(WP3.L34.basisTexts),
});
/** What the contract says of a report: [] while every field is pending; otherwise the fields that differ. */
const contractProblems = (report, contract = CONTRACT_L34) => {
  const problems = [];
  if (contract.formulaVersion !== null && report?.reporting?.formulaVersion !== contract.formulaVersion) problems.push(`formulaVersion ${report?.reporting?.formulaVersion}`);
  if (contract.actualCostSource !== null) {
    const want = typeof contract.actualCostSource === 'object' ? contract.actualCostSource.actualCostSource : contract.actualCostSource;
    const bad = listOf(report?.activityBreakdown).filter((a) => Number(a.ac) > 0 && a.actualCostSource !== want).map((a) => `${a.activityId} ${a.actualCostSource}`);
    if (bad.length) problems.push(`actualCostSource ${bad.join(', ')}`);
    const priority = typeof contract.actualCostSource === 'object' ? contract.actualCostSource.officialSourcePriority : null;
    if (priority && report?.sourceSummary?.ac?.officialSourcePriority && !sameJson(report.sourceSummary.ac.officialSourcePriority, priority)) problems.push('officialSourcePriority');
  }
  if (contract.basisTexts !== null && typeof contract.basisTexts === 'object') {
    if (contract.basisTexts.basisAc && report?.basis?.ac !== contract.basisTexts.basisAc) problems.push('basis.ac');
    if (contract.basisTexts.basisActualCosts && report?.basis?.actualCosts !== contract.basisTexts.basisActualCosts) problems.push('basis.actualCosts');
  }
  return problems;
};
const contractNote = () => (Object.values(CONTRACT_L34).every((v) => v === null) ? `${L34_PENDING}: formulaVersion, actualCostSource and the basis texts are not judged (WP3ADJ Q5)` : `contract judged: ${json(CONTRACT_L34, 300)}`);

// -- rules and the fixed list of checks -----------------------------------------
const ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp3/WP3-ADJUDICATION.md ${item}`;
const FIXPLAN = 'C:/Temp/octapm-cert/scratch/wp3/fixplan/L34-FIX-PLAN.md';
const RULES = {
  L34: { status: 'decided', statement: 'Official AC at a cutoff is the sum of the project\'s cost-ledger entries that carry an activity, dated incurredOn on or before the cutoff date (WP3.L34.acRule; HR-E1); the activity isActive filter is kept (WP3.L34.isActiveFilter, WP3ADJ Q4); a reversal is a ledger entry dated at the original\'s incurredOn, so a void nets out at every cutoff on or after the original\'s date (WP3.L34.reversals, an assumption of the fix design the L34 plan review sees). L34 is CONFIRMED in CERT-3 (plan section 0.1, the 087-EV build) and fixed in WP-3.', sources: [`${PLAN_DOC}:53-55,632,662,1092`, ADJ('the L34 paragraph; Q3, Q4, Q5'), `${FIXPLAN} s1-s3, s6.3, s7`] },
};
const DEFECT = (what) => ({ defect: `L34 ${what}`, rule: 'L34' });
/** Fixed before the first run: id, description, opts (setup / defect + rule / rule). G.5xx is the harness's own, on top. */
const CHECKS = [
  ['S.personas', `company ${COMPANY} resolves to one certification organisation; its pm, planner, qs, cost (cost_controller) and finance sign in (GET /auth/me 200 in 087)`, { setup: true }],
  ['S.project', 'the PM creates R (WP3.L34.repro.inputs: start 2026-01-05, five_day, EGP) and puts the planner (planning_eng), the QS, the cost controller and finance on its team; the Cairo run date is on or after 2026-10-01, the latest fixture row', { setup: true }],
  ['S.fixture', 'R from inputs.ev087: six hand-built activities (A110 A120 A130 A140 A310 A320), cost codes 01-100 and 02-100 selected, the five BOQ rows allocated whole and approved, the five loadings approved, the four fixture costs approved; the ledger rows are the book\'s (WP3.setup.directCosts + WP3.T2.addedCost); run-date BAC 387,000.00 (WP3.T1.bac) and PV 387,000.00 (WP3.T1.pv), zone Africa/Cairo (WP3.setup.timeZone*)', { setup: true }],
  ['R1', 'GET ?cutoffDate=2026-02-28 (cutoff WP3.T3.cutoff): WP3.T3\'s 13 figures, AC value 70,000.00 / today 20,000.00 (A110 and A120 dropped whole by their later postings) - L34', DEFECT('AC at 2026-02-28 from the whole cumulative CostRecord (R, live)')],
  ['R2', 'GET ?cutoffDate=2026-01-31 (cutoff WP3.periods.jan.cutoff): WP3.periods.jan.snapshot\'s 13 figures, AC value 50,000.00 (CPI 0, alert, budget_cpi_zero) / today 0 (CPI null, no alert, budget_no_cost_performance) - L34', DEFECT('AC at 2026-01-31: nothing passes the through-date filter (R, live)')],
  ['R3', 'GET ?cutoffDate=<the Cairo run date>: AC = WP3.T2.ac 110,000.00 (every posting on or before the run date: the ledger and HEAD agree; the control)', { rule: 'L34' }],
  ['R4', 'period 2026-02 (inputs.ev087.periods[1]) created; locked by the PM with a reason (R\'s gate is blocked): the served snapshot is WP3.periods.feb.snapshot (AC value 70,000.00 / today 20,000.00), isSnapshot, figures equal to the open read just before - L34', DEFECT('a lock freezes the cumulative-record AC (R, fresh)')],
  ['R5', 'after the back-dated A130 5,000.00 dated 2026-02-15 (WP3.periods.afterLock.backdatedCost): GET ?cutoffDate=2026-02-28 = WP3.periods.afterLock.cutoffAfterCost, AC value 75,000.00 / today 25,000.00 - L34', DEFECT('the 2026-02-28 read after a back-dated cost (R, live)')],
  ['R5.frozen', 'after that cost the locked 2026-02 report is byte-identical (WP3.periods.afterLock.periodReport): same sha256 (canonical, without reporting.asOfDate), isSnapshot, same snapshotId and lockedAt'],
  ['R6', 'finance voids the back-dated cost: the ledger holds its mirror (-5,000.00, reversalOfId the original, incurredOn the original\'s 2026-02-15); AC drops by 5,000.00 at 2026-02-28 and at the run date and is unchanged at 2026-01-31 (WP3.L34.reversals; WP3.L34.repro.R6). HEAD agrees (the projection nets the mirror); the only live catcher of L34-M3', { rule: 'L34' }],
  ['R7', 'the cost controller types actualThroughDate 2099-01-01 on A110\'s cost record (PATCH /cost/:id; accepted or refused, owner question O-4 is not judged): run-date AC unchanged, delta value 0 / today -60,000.00 (A110 dropped whole: L118\'s typed half; WP3.L34.repro.R7) - L34', DEFECT('a typed through-date removes the activity\'s AC (R, live)')],
  ['R9', 'a direct cost with one line on cost code 01-100 and no activity, 2,000.00 dated 2026-02-20, approved (one ledger entry, activityId null): AC at 2026-02-28 and at the run date unchanged (WP3.L34.acRule: postings with no activity are not in AC; WP3.L34.repro.R9)', { rule: 'L34' }],
];
/** Fixed before the first run: the 12 checks above (G.5xx is the harness's own, on top: 13 recorded). */
const EXPECTED_CHECKS = 12;
if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`the CHECKS table has ${CHECKS.length} checks; EXPECTED_CHECKS is ${EXPECTED_CHECKS} (the count is fixed before the first run)`);
if (new Set(CHECKS.map((x) => x[0])).size !== CHECKS.length) throw new Error('a check id repeats in the CHECKS table');
/** The defect checks expected to fail at HEAD and under each fix mutation (header table; the lists' repro fields). */
const EXPECT_FAIL = Object.freeze({
  head: ['R1', 'R2', 'R4', 'R5', 'R7'],
  fix: [],
  'L34-M1': ['R1', 'R2', 'R4', 'R5'],
  'L34-M1R': ['R1', 'R2', 'R4', 'R5', 'R7'],
  'L34-M2': ['R1', 'R2', 'R4', 'R5', 'R6'],
  'L34-M3': ['R6'],
  'L34-M4': [],
  'L34-M5 (contract pending)': [],
  'L34-M5 (contract adjudicated)': ['R1', 'R2', 'R4', 'R5'],
});

const h = harness.createHarness({
  name: NAME,
  plan: CHECKS,
  rules: RULES,
  meta: {
    plan: `${PLAN_DOC} section 0.1 (:53-55), section 4 WP-3 (:626-669), section 5 HR-E1 (:1092), HR-S9 (:1036)`,
    fixPlan: `${FIXPLAN} (s1.2-s1.5, s6.3, s7)`,
    prep: 'C:/Temp/octapm-cert/scratch/wp3/WP3-PREP.md section 9 (R1-R9)',
    adjudication: 'C:/Temp/octapm-cert/scratch/wp3/WP3-ADJUDICATION.md (L34, Q3, Q4, Q5); C:/Temp/octapm-cert/scratch/wp4/PREP4-ADJUDICATION.md section C items 4, 5',
    answerBook: `backend/scripts/cert/cert3/answers/schedule.js @${SCHEDULE.meta.head} + the WP-3 book patch; WP3.L34.repro.* ${Object.values(LEAF).every((l) => l.source === 'book') ? 'from the book' : 'PROPOSED (wp3-l34-repro.proposed-leaves.json)'}`,
    expectedChecks: EXPECTED_CHECKS,
    checks: CHECKS.map(([id, , opts = {}]) => ({ id, kind: opts.setup ? 'setup' : opts.defect ? 'defect' : 'check', rule: opts.rule || null })),
    expectFail: EXPECT_FAIL,
    contractL34: Object.fromEntries(Object.entries(CONTRACT_L34).map(([k, v]) => [k, v === null ? L34_PENDING : v])),
    leaves: Object.fromEntries(Object.entries(LEAF).map(([k, l]) => [`WP3.L34.repro.${k}`, { source: l.source, value: l.value, today: l.today ?? null, ref: l.ref ?? null }])),
    derived: DERIVED,
    dropped: 'R8 (HR-S9 known answer via a SQL retirement fixture), integration owner 2026-10-10: product paths only',
  },
});

// -- per-check records and known answers (written in cleanup) -------------------
const records = {};
const knownAnswers = {};
const obs = {};
const rec = (id, ok, { expected = null, observed = null, detail = '' } = {}) => {
  records[id] = { expected, observed, verdict: ok === true ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 2000) };
  return h.check(id, ok === true, `${detail}${expected !== null ? ` | expected ${json(expected, 400)}` : ''}${observed !== null ? ` | observed ${json(observed, 700)}` : ''}`);
};
/** A known answer's status: PASS (the value), BLOCKED (the today of an undecided rule), else FAIL (a decided rule's today, or wrong). */
const kaStatus = ({ ref, verdict }) => (verdict === 'value' ? 'PASS' : verdict === 'today' && RULES[ref]?.status !== 'decided' ? 'BLOCKED' : 'FAIL');
const ka = (id, { ref, bookKey, value, today, observed, verdict, detail = '' }) => {
  const status = kaStatus({ ref, verdict });
  knownAnswers[id] = { ref, bookKey, value, today, observed, verdict, ruleDecided: RULES[ref]?.status === 'decided', status };
  const text = status === 'BLOCKED' ? `BLOCKED (known answer, ${ref}: undecided)` : verdict === 'today' ? `FAIL: HEAD's known answer of ${ref}, which is decided` : verdict === 'value' ? 'value' : `WRONG: neither the leaf's value nor its today (${ref})`;
  rec(id, status !== 'FAIL', { expected: { value, today }, observed, detail: `${text}; ${detail}` });
  records[id].verdict = status;
  return verdict;
};
/** A step R cannot go on without: a setup error, not a verdict (R-SET). */
const need = (condition, what) => {
  if (condition !== true) throw new Error(`R: ${what}: the reproduction cannot go on (a setup error, not a verdict; R-SET)`);
};

// -- the judgements (pure: also run over the modelled readings by registration-check.js) --
const JUDGE = {
  /** A read judged on a 13-figure book set: wrong unless cut where asked in Cairo (and, for a snapshot, served as one and equal to the open read). */
  metricRead: (o, node, cutoffWant, { snapshot = false } = {}) => {
    if (!o || !o.figures || o.cutoffDate !== cutoffWant || !sameJson(o.zone, ZONE_EXPECT)) return 'wrong';
    if (snapshot && (o.isSnapshot !== true || o.equalsOpen !== true)) return 'wrong';
    const v = metricVerdict(o.figures, node);
    return v === 'value' && Array.isArray(o.contract) && o.contract.length ? 'wrong' : v;
  },
  R3: (ac) => ac === WP3.T2.ac.value,
  R5frozen: (o) => o.periodReport === 'byte_identical' && o.said === '200' && Boolean(o.reference) && o.hash === o.reference && o.isSnapshot === true && Boolean(o.snapshotId) && o.snapshotId === o.storedSnapshotId && o.lockedAt === o.storedLockedAt,
  R6: (d) => sameJson(d, LEAF.R6.value.acDelta),
  R7: (delta) => (delta === LEAF.R7.value.runDateAcDelta ? 'value' : delta === LEAF.R7.today.runDateAcDelta ? 'today' : 'wrong'),
  R9: (d) => sameJson(d, LEAF.R9.value.acDelta),
};

// -- sessions and requests ------------------------------------------------------
const ctx = { db: null, q: null, org: null, spec: null, sessions: {}, people: {}, cleanup: [], r: null, runDay: null, lock: null };
const RETRY_429 = 6;
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
/** The EV report as a persona reads it: { res, report, figures, hash, said }. */
const evRead = async (who, P, query) => {
  const res = await get(who, `${P}/reports/ev${query}`);
  const report = res.status === 200 ? res.body?.data : null;
  return { res, report, figures: figuresOf(report), hash: report ? reportHash(report) : null, said: h.said(res) };
};
/** What a check keeps of a read. */
const observeRead = (read) => ({
  said: read.said,
  figures: read.figures,
  cutoffDate: read.report?.reporting?.cutoffDate ?? null,
  zone: zoneOf(read.report?.reporting),
  isSnapshot: read.report?.reporting?.isSnapshot ?? null,
  formulaVersion: read.report?.reporting?.formulaVersion ?? null,
  contract: read.report ? contractProblems(read.report) : [],
});
/** R's ledger as stored: [{ id, code, amount (text), day, reversalOfId, sourceId, activityId }], in posting order. */
const ledgerRows = async () => ctx.q(
  `select e.id, a."activityCode" as code, e.amount::text as amount, to_char(e."incurredOn", 'YYYY-MM-DD') as day, e."reversalOfId" as "reversalOfId", e."sourceId" as "sourceId", e."activityId" as "activityId"
     from "CostLedgerEntry" e left join "Activity" a on a.id = e."activityId"
    where e."projectId" = $1 order by e."createdAt", e.id`,
  [ctx.r.id],
);

// -- setup ------------------------------------------------------------------------
const setup = async () => {
  ctx.db = await h.connect();
  ctx.q = h.sql(ctx.db).q;
  const [spec] = h.companies(COMPANY);
  ctx.spec = spec;
  const problems = [];
  const orgs = await ctx.q('select id, slug, name from "Organisation" where slug like $1', [`cert-${COMPANY}-%`]);
  if (orgs.length !== 1) problems.push(`company ${COMPANY}: ${orgs.length} organisations, exactly one expected`);
  else {
    try { ctx.org = certEnv.assertCertOrganisation(orgs[0]) || orgs[0]; } catch (error) { problems.push(`company ${COMPANY}: ${error.message}`); }
  }
  if (ctx.org) {
    for (const who of PERSONAS) {
      const email = `${who}@${spec.domain}`;
      ctx.sessions[who] = api.as({ email, orgId: ctx.org.id });
      const me = await get(who, '/auth/me');
      if (me.status !== 200) problems.push(`${who} (${email}): GET /auth/me ${h.said(me)}`);
      else {
        ctx.people[who] = me.body?.data?.id;
        if ((me.body?.data?.active?.orgId ?? me.body?.data?.orgId) !== ctx.org.id) problems.push(`${who}: session in another org`);
      }
    }
  }
  rec('S.personas', problems.length === 0, { observed: { org: ctx.org ? { id: ctx.org.id, slug: ctx.org.slug } : null, people: Object.keys(ctx.people) }, detail: problems.join('; ') || `${PERSONAS.length} sessions in ${COMPANY}` });
  if (problems.length) throw new Error(`setup: ${problems.join('; ')}`);
};

/** R: created by the PM (archived in cleanup, whatever happened), with its team. */
const makeR = async () => {
  ctx.runDay = localDate(Date.now(), ZONE);
  const name = String(IN.project.name).replace('<stamp>', h.STAMP);
  const created = await send('pm', 'POST', '/projects', { name, startDate: IN.project.start, endDate: IN.project.end, projectCalendar: IN.project.calendar, currency: IN.project.currency, type: IN.project.projectType, contractType: IN.project.contractType });
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  if (id) {
    ctx.cleanup.push(async () => {
      const res = await send('pm', 'DELETE', `/projects/${id}`);
      const row = (await ctx.q('select "archivedAt"::text as a from "Project" where id = $1', [id]))[0];
      return `R ${id} archive ${h.said(res)}, archivedAt ${row?.a || 'NOT SET'}`;
    });
  }
  const members = [];
  if (id) for (const [who, role] of Object.entries(IN.team)) members.push({ who, role, said: h.said(await send('pm', 'POST', `/projects/${id}/team`, { userId: ctx.people[who], role })) });
  ctx.r = id ? { id, P: `/projects/${id}`, name, ids: {}, items: {}, codes: {} } : null;
  const runDayOk = ctx.runDay >= LATEST_FIXTURE_DAY;
  const ok = Boolean(id) && members.length === Object.keys(IN.team).length && members.every((m) => ['200', '201'].includes(m.said)) && runDayOk;
  rec('S.project', ok, { expected: { project: IN.project, team: IN.team, runDayOnOrAfter: LATEST_FIXTURE_DAY }, observed: { id, created: h.said(created), team: members, runDay: ctx.runDay }, detail: `R ${id || 'not created'} ${created.body?.error?.message || ''}` });
  if (!ok) throw new Error(`setup: R could not be set up (${h.said(created)}; team ${json(members)}; run day ${ctx.runDay})`);
};

/** A direct cost: created and submitted by the cost controller, approved by finance. { id, ok, said }. */
const directCost = async ({ activity, amount, date, costCode, costType }, label) => {
  const { P } = ctx.r;
  const description = `CERT3 WP3 L34 repro ${label}: ${activity || 'no activity'} ${amount} incurred ${date} ${h.STAMP}`;
  const line = { description, costCodeId: ctx.r.codes[costCode] || null, costType, quantity: 1, unit: 'ls', unitCost: amount, amount };
  if (activity) line.activityId = ctx.r.ids[activity];
  const created = await send('cost', 'POST', `${P}/direct-costs`, { type: 'expense', description, vendorName: `CERT3 L34 repro payee ${h.STAMP}`, costDate: date, lines: [line] });
  const id = created.status === 201 ? created.body?.data?.id || null : null;
  const submitted = id ? await send('cost', 'POST', `${P}/direct-costs/${id}/submit`, {}) : null;
  const approved = id ? await send('finance', 'POST', `${P}/direct-costs/${id}/approve`, {}) : null;
  const ok = approved?.status === 200 && approved.body?.data?.status === 'approved';
  return { id, ok, said: `${h.said(created)} / ${submitted ? h.said(submitted) : '-'} / ${approved ? h.said(approved) : '-'}`, label };
};
const costOf = ([code, amount, date], label) => directCost({ activity: code, amount, date, costCode: IN.costCodeOf[code], costType: IN.costTypeOf[code] }, label);

/** R's records from inputs.ev087 (S.fixture). */
const fixture = async () => {
  const r = ctx.r;
  const { P } = r;
  const A = IN.activities;
  const made = [];
  for (const [i, code] of A.codes.entries()) {
    const res = await send('planner', 'POST', `${P}/activities`, { name: `CERT3 WP3 L34 repro ${code} ${h.STAMP}`, activityCode: code, wbsCode: A.wbsCode, category: A.category, startDate: A.start, endDate: A.end, sortOrder: i, engineerIds: [ctx.people[A.engineer]] });
    r.ids[code] = res.status === 201 ? res.body?.data?.id || null : null;
    made.push([code, h.said(res)]);
  }
  // cost codes from 087's library (read only), selected onto R
  const library = await get('cost', `${P}/budget/cost-codes`);
  const available = listOf(library.body?.data?.available);
  const wanted = [...new Set([...Object.values(IN.costCodeOf), LEAF.R9.value.line.costCode])];
  for (const code of wanted) { const rows = available.filter((x) => x.code === code); r.codes[code] = rows.length === 1 ? rows[0].id : null; }
  const select = wanted.every((code) => r.codes[code]) ? await send('cost', 'PUT', `${P}/budget/cost-codes`, { costCodeIds: wanted.map((code) => r.codes[code]) }) : null;
  // the BOQ (QS) and each row allocated whole (planner creates and submits, the QS approves), as the WP-3 proof's V
  const items = [];
  for (const row of EV.boq) {
    const res = await send('qs', 'POST', `${P}/boq/items`, { code: row.code, description: `${row.description} (CERT3 WP3 L34 repro ${h.STAMP})`, quantity: row.quantity, unit: row.unit, rate: row.rate });
    r.items[row.code] = res.status === 201 ? res.body?.data?.item?.id ?? res.body?.data?.id ?? null : null;
    items.push([row.code, h.said(res)]);
  }
  const allocs = [];
  for (const row of EV.boq) {
    for (const [code, quantity, amount] of row.allocations) {
      const created = await send('planner', 'POST', `${P}/activity-boq-allocations`, { boqItemId: r.items[row.code], activityId: r.ids[code], quantity, amount, source: 'manual', notes: `CERT3 WP3 L34 repro ${row.code} to ${code} ${h.STAMP}` });
      const aid = created.body?.data?.id || null;
      const submitted = aid ? await send('planner', 'POST', `${P}/activity-boq-allocations/${aid}/submit`, {}) : null;
      const approved = aid ? await send('qs', 'POST', `${P}/activity-boq-allocations/${aid}/approve`, {}) : null;
      allocs.push([`${row.code}.${code}`, h.said(created), submitted ? h.said(submitted) : null, approved ? h.said(approved) : null, approved?.body?.data?.status ?? null]);
    }
  }
  // the loadings (cost creates them submitted, the PM approves)
  const loads = [];
  for (const [code, amount, date] of EV.loadings) {
    const created = await send('cost', 'POST', `${P}/reports/cost-loading`, { activityId: r.ids[code], plannedDate: date, plannedValue: amount, source: 'manual', status: 'submitted', notes: `CERT3 WP3 L34 repro loading ${code} ${date} ${h.STAMP}` });
    const lid = created.status === 201 ? created.body?.data?.id || null : null;
    const approved = lid ? await send('pm', 'POST', `${P}/reports/cost-loading/${lid}/approve`, {}) : null;
    loads.push([code, h.said(created), approved ? h.said(approved) : null, approved?.body?.data?.status ?? null]);
  }
  // the four fixture costs (WP3.setup.directCosts, then WP3.T2's addedCost), each approved
  const costs = [];
  for (const [i, row] of [...EV.directCosts, EV.t2Cost].entries()) costs.push(await costOf(row, `fixture cost ${i + 1}`));
  // the ledger as stored, and the run-date read
  const ledger = (await ledgerRows()).map((e) => [e.code, cents(e.amount), e.day]);
  const read = await evRead('cost', P, `?cutoffDate=${ctx.runDay}`);
  const fixtureObserved = { made, codes: r.codes, select: select ? h.said(select) : null, items, allocs, loads, costs: costs.map((x) => `${x.label} ${x.said}`), ledger, runDate: { day: ctx.runDay, said: read.said, bac: read.figures?.bac ?? null, pv: read.figures?.pv ?? null, zone: zoneOf(read.report?.reporting) } };
  obs.fixture = fixtureObserved;
  const ok = made.every(([, said]) => said === '201') && select?.status === 200
    && items.every(([, said]) => said === '201')
    && allocs.length === EV.boq.reduce((s, row) => s + row.allocations.length, 0) && allocs.every(([, cr, sb, ap, status]) => cr === '201' && sb === '200' && ap === '200' && status === 'approved')
    && loads.length === EV.loadings.length && loads.every(([, cr, ap, status]) => cr === '201' && ap === '200' && status === 'approved')
    && costs.every((x) => x.ok)
    && sameJson(sortRows(ledger), sortRows(ROWS_FIXTURE))
    && read.res.status === 200 && read.figures?.bac === WP3.T1.bac.value && read.figures?.pv === WP3.T1.pv.value && sameJson(zoneOf(read.report?.reporting), ZONE_EXPECT);
  rec('S.fixture', ok, { expected: { ledger: ROWS_FIXTURE, bac: WP3.T1.bac.value, pv: WP3.T1.pv.value, zone: ZONE_EXPECT }, observed: fixtureObserved });
  if (!ok) throw new Error(`R: the fixture could not be set up (${json(fixtureObserved, 1200)})`);
};

// -- the reproduction R1-R9 (in this order: each step's state is the next one's) --
const reproduce = async () => {
  const r = ctx.r;
  const { P } = r;
  const at = (cutoff) => evRead('cost', P, `?cutoffDate=${cutoff}`);
  const acAt = async (cutoff, label) => {
    const read = await at(cutoff);
    need(read.res.status === 200 && typeof read.figures?.ac === 'number', `${label}: GET ?cutoffDate=${cutoff} answered ${read.said}`);
    return read.figures.ac;
  };
  const acTriple = async (label) => ({ [CUT_JAN]: await acAt(CUT_JAN, label), [CUT_FEB]: await acAt(CUT_FEB, label), runDate: await acAt(ctx.runDay, label) });
  const diff = (after, before) => Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]));

  // R1: AC at 2026-02-28 (fix plan L-R1)
  const o1 = observeRead(await at(CUT_FEB));
  ka('R1', { ref: 'L34', bookKey: 'WP3.T3', value: valuesOf(WP3.T3), today: valuesOf(WP3.T3, METRIC_KEYS, 'today'), observed: o1, verdict: JUDGE.metricRead(o1, WP3.T3, WP3.T3.cutoff.value), detail: `live; ${contractNote()}` });

  // R2: AC at 2026-01-31 (fix plan L-R2, read open)
  const JANS = WP3.periods.jan.snapshot;
  const o2 = observeRead(await at(CUT_JAN));
  ka('R2', { ref: 'L34', bookKey: 'WP3.periods.jan.snapshot', value: valuesOf(JANS), today: valuesOf(JANS, METRIC_KEYS, 'today'), observed: o2, verdict: JUDGE.metricRead(o2, JANS, WP3.periods.jan.cutoff.value), detail: `live; ${contractNote()}` });

  // R3: the control at the run date
  const r3 = await at(ctx.runDay);
  rec('R3', r3.res.status === 200 && JUDGE.R3(r3.figures?.ac ?? null), { expected: { ac: WP3.T2.ac.value }, observed: { said: r3.said, runDay: ctx.runDay, ac: r3.figures?.ac ?? null }, detail: 'every posting on or before the run date: both readings give WP3.T2.ac' });

  // R4: 2026-02 locked by the PM with a reason; the served snapshot (fix plan L-R2, the locked corruption)
  const PD = EV.periods[1];
  const madeP = await send('cost', 'POST', `${P}/reports/periods`, { code: PD.code, label: `CERT3 WP3 L34 repro ${PD.code} ${h.STAMP}`, periodStart: PD.start, periodEnd: PD.end, cutoffDate: PD.cutoff });
  const periodId = madeP.status === 201 ? madeP.body?.data?.id || null : null;
  need(Boolean(periodId), `period ${PD.code} could not be made (${h.said(madeP)} ${madeP.body?.error?.message || ''})`);
  const open = await evRead('cost', P, `?periodId=${periodId}`);
  need(open.res.status === 200 && open.report?.reporting?.isSnapshot === false, `the open ${PD.code} report answered ${open.said} (isSnapshot ${open.report?.reporting?.isSnapshot})`);
  const reason = `CERT3 WP3 L34 repro: ${PD.code} locked on the PM's override (R has no baseline) ${h.STAMP}`;
  const lock = await send('pm', 'POST', `${P}/reports/periods/${periodId}/lock`, { overrideReason: reason });
  need(lock.status === 200 && lock.body?.data?.reporting?.isSnapshot === true, `the PM's lock of ${PD.code} answered ${h.said(lock)} ${lock.body?.error?.message || ''}`);
  const served = await evRead('cost', P, `?periodId=${periodId}`);
  need(served.res.status === 200, `GET ?periodId=<${PD.code}> answered ${served.said}`);
  ctx.lock = { periodId, hash: served.hash, snapshotId: served.report?.reporting?.snapshotId ?? null, lockedAt: served.report?.reporting?.lockedAt ?? null };
  const FEBS = WP3.periods.feb.snapshot;
  const o4 = { ...observeRead(served), equalsOpen: sameFigures(served.report, open.report), open: open.figures, snapshotId: ctx.lock.snapshotId, lockedAt: ctx.lock.lockedAt };
  ka('R4', { ref: 'L34', bookKey: 'WP3.periods.feb.snapshot', value: valuesOf(FEBS), today: valuesOf(FEBS, METRIC_KEYS, 'today'), observed: o4, verdict: JUDGE.metricRead(o4, FEBS, WP3.periods.feb.cutoff.value, { snapshot: true }), detail: `fresh: locked in this run; ${contractNote()}` });

  // R5: a cost back-dated into the locked month (fix plan L-R3)
  const dc5 = await costOf(EV.backdatedAfterLock, 'R5 back-dated after the lock');
  need(dc5.ok, `the back-dated cost was not approved (${dc5.said})`);
  const CAC = WP3.periods.afterLock.cutoffAfterCost;
  const o5 = observeRead(await at(CUT_FEB));
  ka('R5', { ref: 'L34', bookKey: 'WP3.periods.afterLock.cutoffAfterCost', value: valuesOf(CAC), today: valuesOf(CAC, METRIC_KEYS, 'today'), observed: o5, verdict: JUDGE.metricRead(o5, CAC, WP3.T3.cutoff.value), detail: `live; the open read moves by the back-dated ${EV.backdatedAfterLock[1]} either way; ${contractNote()}` });
  const again = await evRead('cost', P, `?periodId=${periodId}`);
  const o5f = { periodReport: WP3.periods.afterLock.periodReport.value, said: again.said, reference: ctx.lock.hash, hash: again.hash, isSnapshot: again.report?.reporting?.isSnapshot ?? null, snapshotId: again.report?.reporting?.snapshotId ?? null, storedSnapshotId: ctx.lock.snapshotId, lockedAt: again.report?.reporting?.lockedAt ?? null, storedLockedAt: ctx.lock.lockedAt };
  rec('R5.frozen', JUDGE.R5frozen(o5f), { expected: { periodReport: 'byte_identical', isSnapshot: true }, observed: o5f, detail: 'a locked period answers from its snapshot, never recomputed (plan :634)' });

  // R6: the void of that cost, dated before the cutoff (the reversal rule; the live catcher of L34-M3)
  const L6 = LEAF.R6.value;
  const before6 = await acTriple('R6 before the void');
  const voided = await send('finance', 'POST', `${P}/direct-costs/${dc5.id}/void`, { reason: `CERT3 WP3 L34 repro R6: the back-dated cost voided ${h.STAMP}` });
  need(voided.status === 200 && voided.body?.data?.status === 'void', `the void answered ${h.said(voided)} ${voided.body?.error?.message || ''}`);
  const entries = (await ledgerRows()).filter((e) => e.sourceId === dc5.id);
  const original = entries.find((e) => !e.reversalOfId) || null;
  const mirror = entries.find((e) => e.reversalOfId) || null;
  const mirrorObserved = { entries: entries.map((e) => ({ code: e.code, amount: e.amount, day: e.day, reversal: Boolean(e.reversalOfId) })) };
  need(entries.length === 2 && Boolean(original) && Boolean(mirror) && mirror.reversalOfId === original.id && original.code === L6.voided[0] && cents(original.amount) === c(L6.voided[1]) && original.day === L6.voided[2] && cents(mirror.amount) === -c(L6.voided[1]) && mirror.day === original.day,
    `the void did not leave exactly the original and one mirror at its incurredOn (WP3.L34.reversals): ${json(mirrorObserved)}`);
  const after6 = await acTriple('R6 after the void');
  const d6 = diff(after6, before6);
  obs.r6 = { before: before6, after: after6, delta: d6, ledger: mirrorObserved, ac0228AfterVoid: { observed: after6[CUT_FEB], value: WP3.T3.ac.value, today: WP3.T3.ac.today } };
  rec('R6', JUDGE.R6(d6), { expected: L6.acDelta, observed: { delta: d6, before: before6, after: after6 }, detail: 'the mirror carries the original\'s incurredOn (cost-ledger.service.js reverse): AC drops by the voided amount at every cutoff on or after it and never at an earlier one; a delta of 0 is L34-M3 (reversals left out of the sum)' });

  // R7: a typed through-date far ahead on A110's cost record (L118's typed half; fix plan s1.5)
  const L7 = LEAF.R7;
  const recordRows = await ctx.q('select id from "CostRecord" where "projectId" = $1 and "activityId" = $2', [r.id, r.ids[L7.value.activity]]);
  need(recordRows.length === 1, `${L7.value.activity} has ${recordRows.length} cost records, one expected`);
  const before7 = await acAt(ctx.runDay, 'R7 before');
  const patch = await send('cost', 'PATCH', `${P}/cost/${recordRows[0].id}`, { actualThroughDate: L7.value.typedThroughDate });
  const stored = (await ctx.q('select to_char("actualThroughDate", \'YYYY-MM-DD\') as d from "CostRecord" where id = $1', [recordRows[0].id]))[0]?.d ?? null;
  if (patch.status === 200) need(stored === L7.value.typedThroughDate, `the PATCH answered 200 but stored ${stored}`);
  else need(patch.status >= 400 && patch.status < 500, `the PATCH answered ${h.said(patch)}`);
  const after7 = await acAt(ctx.runDay, 'R7 after');
  const delta7 = after7 - before7;
  ka('R7', { ref: 'L34', bookKey: 'WP3.L34.repro.R7', value: { runDateAcDelta: L7.value.runDateAcDelta }, today: { runDateAcDelta: L7.today.runDateAcDelta }, observed: { patch: h.said(patch), storedThroughDate: stored, before: before7, after: after7, delta: delta7 }, verdict: JUDGE.R7(delta7), detail: 'the PATCH may be accepted or refused (owner question O-4 is not judged); the ledger is the AC either way' });

  // R9: a cost-code-only posting (no activity) is not in AC
  const L9 = LEAF.R9.value;
  const before9 = { [CUT_FEB]: await acAt(CUT_FEB, 'R9 before'), runDate: await acAt(ctx.runDay, 'R9 before') };
  const dc9 = await directCost({ activity: null, amount: L9.line.amount, date: L9.line.costDate, costCode: L9.line.costCode, costType: L9.line.costType }, 'R9 cost-code-only');
  need(dc9.ok, `the cost-code-only cost was not approved (${dc9.said})`);
  const e9 = (await ledgerRows()).filter((e) => e.sourceId === dc9.id);
  need(e9.length === 1 && e9[0].activityId === null && cents(e9[0].amount) === c(L9.line.amount) && e9[0].day === L9.line.costDate, `the cost-code-only cost is not one ledger entry without an activity: ${json(e9)}`);
  const after9 = { [CUT_FEB]: await acAt(CUT_FEB, 'R9 after'), runDate: await acAt(ctx.runDay, 'R9 after') };
  const d9 = diff(after9, before9);
  rec('R9', JUDGE.R9(d9), { expected: L9.acDelta, observed: { delta: d9, before: before9, after: after9 }, detail: 'postings with no activity are not in AC (WP3.L34.acRule), as today' });
};

// -- the run --------------------------------------------------------------------
const main = async () => {
  console.log(`${NAME}: ${EXPECTED_CHECKS} checks + G.5xx; company ${COMPANY}; throwaway R; WP3.L34.repro.* ${Object.values(LEAF).every((l) => l.source === 'book') ? 'from the book' : 'proposed'}; ${contractNote()}; in process\n`);
  await setup();
  await makeR();
  await h.section('R: the fixture from inputs.ev087 (S.fixture)', async () => { await fixture(); ctx.fixtureReady = true; });
  if (ctx.fixtureReady) await h.section('R: the reproduction R1-R9', reproduce);
};

const recordObservations = () => {
  h.observe('checks', records);
  h.observe('knownAnswers', knownAnswers);
  h.observe('runObservations', obs);
  h.observe('l34Contract', { contract: CONTRACT_L34, note: contractNote() });
  const failing = Object.entries(records).filter(([, x]) => x.verdict === 'FAIL').map(([id]) => id).sort();
  const tally = {
    expectedChecks: EXPECTED_CHECKS,
    recorded: Object.keys(records).length,
    failing,
    blocked: Object.entries(records).filter(([, x]) => x.verdict === 'BLOCKED').map(([id]) => id),
    matches: Object.fromEntries(Object.entries(EXPECT_FAIL).map(([k, ids]) => [k, sameJson([...ids].sort(), failing)])),
  };
  h.observe('tally', tally);
  console.log(`\ntally: ${tally.recorded} of ${EXPECTED_CHECKS} recorded; failing ${failing.join(', ') || 'none'}; BLOCKED ${tally.blocked.join(', ') || 'none'}; matches ${Object.entries(tally.matches).filter(([, m]) => m).map(([k]) => k).join(', ') || 'no expected pattern'}`);
};

const cleanup = async () => {
  const notes = [];
  for (const step of ctx.cleanup.reverse()) {
    try { notes.push(String(await step())); } catch (error) { notes.push(`cleanup failed: ${error.message}`); }
  }
  if (!ctx.cleanup.length) notes.push('nothing to remove');
  if (ctx.sessions.pm) {
    try {
      const prefix = String(IN.project.name).replace('<stamp>', '').trim();
      const page = await get('pm', `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(prefix)}`);
      const mine = listOf(page.body?.data).filter((p) => String(p.name || '').startsWith(prefix));
      const live = mine.filter((p) => !p.archivedAt);
      notes.push(`throwaway check (GET /projects as 087 PM, ${h.said(page)}): ${mine.length} '${prefix}' projects, ${live.length} live${live.length ? ` (${live.map((p) => `${p.name} ${p.id}`).join(', ')})` : ''}`);
    } catch (error) {
      notes.push(`throwaway check failed: ${error.message}`);
    }
  }
  notes.push('deep projects: none touched (every write is on R; 087\'s cost-code library is only read)');
  try { recordObservations(); } catch (error) { notes.push(`observations: ${error.message}`); }
  return notes;
};

module.exports = { __l34repro: { CHECKS, EXPECTED_CHECKS, EXPECT_FAIL, RULES, PROPOSED, LEAF, DERIVED, JUDGE, kaStatus, metricVerdict, valuesOf, figuresOf, contractProblems, CONTRACT_L34, ZONE_EXPECT, METRIC_KEYS, ROWS: { fixture: ROWS_FIXTURE, backdated: ROW_BACKDATED, mirror: ROW_MIRROR }, REF_RUN, CUT_JAN, CUT_FEB } };

h.run({ main, cleanup });
