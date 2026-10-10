'use strict';

/**
 * CERT-3 deep population, company 087 (D1): project 087-EV "CERT3 Earned value".
 *
 * docs/certification/OCTAPM_CERT3_PLAN.md §3.2 row 087-EV (serves WP-3):
 *   "Starts 2026-01-05. The F1 programme activated. Approved cost loadings:
 *    60,000 on 01-23, 30,000 on 01-28, 90,000 on 02-13, 135,000 on 03-20,
 *    72,000 on 04-10. Approved progress: A110 100, A120 50, A130 25. Direct
 *    costs: A110 50,000 on 01-20 and 10,000 on 09-30; A130 20,000 on 02-10;
 *    later 30,000 on A120 on 10-01. A budget revision of +13,000 effective
 *    03-01. Reporting periods 2026-01, 2026-02 and one with a future cutoff;
 *    one locked normally and one locked with a PM override. Finally, a 5,000
 *    cost on A140 and then a revision that retires A140. Steps run in
 *    answer-book order."
 *
 * Every input and every expected figure comes from the answer book,
 * answers/schedule.js: inputs.ev087 (boq, loadings, progress, directCosts,
 * t2Cost, budgetRevision, backdatedAfterLock, approvalAfterLock, a140Cost,
 * order), rules.ev087PeriodsFor / futurePeriodFor / endOfLocalDay, and the
 * WP3 tree. A comment "[WP3.x]" names the book key a step asserts.
 * The builders' adjudication (C:\Temp\octapm-cert\scratch\wp0\
 * builders-adjudication.md, 087-EV items 1-7, R1-1, R1-15, R1-20, R1-21,
 * R1-23, G1-G6) is applied.
 *
 * ── ORDER (EV087.order) ──────────────────────────────────────────────────────
 *   setup   project, team, cost codes, BOQ (E-001..E-005), F1 imported,
 *           submitted, approved and activated, the site engineer on the five
 *           activities that take progress, five approved allocations, five
 *           approved cost loadings, approved progress A110 100 / A120 50 /
 *           A130 25, the three direct costs
 *   T1      checkpoint (cutoff: the company-local date of the read)
 *   T2      30,000 on A120 dated 2026-10-01; checkpoint
 *   T3      checkpoint (cutoff 2026-02-28)
 *   T4      in process (the WP-3 proof; nothing to build)
 *   T5      budget revision +13,000 effective 2026-03-01, approved; checkpoint
 *   T5 delete probe   the PM deletes the approved revision [WP3.T5.deleteProbe]
 *   T7      checkpoint, a draft, a submitted and a rejected submission
 *           (A310 30% draft, A320 20% submitted, A130 50% rejected, all on
 *           allocated activities), checkpoint again: byte-identical
 *   periods 2026-01, 2026-02 and the future one (rules.ev087PeriodsFor of the
 *           company-local run date); the open February report; February
 *           locked while the reporting gate is blocked (planner, finance and
 *           finance-with-a-reason refused, then the PM with a reason); the gate
 *           made ready (every activity's progress method, the baseline);
 *           January locked normally by finance; the back-dated 5,000 on A130
 *           (2026-02-15) and the new approval A120 50 -> 60%, each followed by
 *           the period report, the 2026-02-28 report and the run-date report
 *   forecast  in process (nothing to build)
 *   T6      5,000 on A140 dated the run date, checkpoint, the revision that
 *           retires A140 (F1 with A140 left out, A110 kept at 80 h), checkpoint
 *
 * ── CHECKPOINTS (adjudication 087-EV item 1, R1-1, G1) ─────────────────────
 * A checkpoint reads GET /reports/ev as the cost controller, at the moment the
 * WP-3 check needs, and ASSERTS there:
 *   - the cut: cutoffLocalDate as asked and cutoffDate = rules.endOfLocalDay
 *     of it in the company zone (book instants where the book fixes one); a
 *     "today" cutoff is the company-local date at the moment of the read;
 *   - the zone: reporting.timeZone = WP3.setup.timeZone = the company's zone,
 *     timeZoneSource = WP3.setup.timeZoneSource, timeZoneNote =
 *     WP3.setup.timeZoneNote (087-EV item 5, R1-15);
 *   - every figure (BAC, PV, EV, AC, SPI, CPI, EAC, its basis, SV, CV, ETC and
 *     both alerts) against the book's leaves, thirteen per read, never a
 *     figure computed here (A10; round 3 R3-2: the 2026-02-28 read after the
 *     back-dated cost takes WP3.periods.afterLock.cutoffAfterCost, the T6
 *     reads take WP3.T6.before / WP3.T6.after in the branch the T5 probe
 *     left); each figure's leaf is named beside it in the step output.
 * A figure that is neither the book's value nor HEAD's value the book records
 * for a registered defect (leaf.today) fails the build. HEAD's recorded value
 * passes the checkpoint and is judged by the step "verdict.<checkpoint>"
 * right after it, from the stored output (a resume judges the same moment):
 * BLOCKED with the defect's ref and the observed figures (L34 for AC at a past
 * cutoff, HR-S9 for AC of a retired activity), or done once every figure is
 * the book's value. A verdict step never blocks the steps after it.
 * Each checkpoint keeps the summarised report: figures, alerts, activity rows
 * and the sha256 of the canonical (sorted-key) JSON of the report without
 * reporting.asOfDate (R1-20). Hash references: T7 compares with
 * checkpoint.T7.before; the February period report compares with
 * checkpoint.afterLock.before's period read (taken after the January lock,
 * which adds a locked history point to February's report), not with the
 * lock-time snapshot.
 *
 * ── T5 DELETE PROBE (R1-21) ─────────────────────────────────────────────────
 * Between T5 and T7, as the book orders it. The PM (cost:delete and
 * cost:approve; the cost controller's own delete is refused by the approval
 * authority rule, which is not what L112 asks) sends DELETE on the approved
 * revision. It is judged by the book (round 2, R2-F): the value is
 * refused_or_audited, so a refusal (400, 403, 409 or 422; the revision stays
 * approved, BAC WP3.T5.bac) or a deletion (200 or 204) with an audit event of
 * the delete is done. HEAD's recorded answer, the silent 200 (no audit event,
 * BAC back to WP3.T1.bac), is BLOCKED L112 with the observed answer and BAC.
 * Any other answer (another status, a silent 204, a deletion that leaves the
 * revision listed or BAC elsewhere) fails the build. The request is recorded
 * and never sent again; every later checkpoint's BAC follows from its outcome.
 * The run-date reads after the locks take the book's leaves
 * WP3.periods.afterLock.runDateAfterCost / runDateAfterApproval (R2-B4) in the
 * branch the probe left: revisionKept after a refusal, revisionDeleted after
 * an audited or a silent delete.
 *
 * ── BLOCKED REFS THIS BUILD CAN RECORD ──────────────────────────────────────
 *   L34 (verdict steps of T3, the open February report, both locked
 *   snapshots and the after-lock reads), HR-S9 (verdict of T6 after the
 *   retirement; register L118), L112 (the delete probe). Nothing else is
 *   known: any other refusal or figure fails the build. HR-S2 is decided and
 *   fixed (WP1-MS-1, f599e67): the readiness reader stays, and a zero-duration
 *   milestone failing approval or baseline fails the build as a regression.
 *
 * ── PEOPLE ──────────────────────────────────────────────────────────────────
 *   pm       creates the project; approves the revisions, allocations, cost
 *            loadings, progress and the budget revision; deletes it in the
 *            probe; locks the baseline; locks 2026-02 with the override
 *   planner  imports and submits the programmes, assigns the site engineer,
 *            allocates the BOQ, configures the progress methods
 *   qs       enters the BOQ rows
 *   cost     cost codes, cost loadings, direct costs, the budget revision,
 *            reporting periods; reads every checkpoint
 *   site     submits progress (assigned to the activities it reports on)
 *   finance  approves the direct costs; locks 2026-01
 *
 * Run alone (debug, through the proof lock, from backend/ with DATABASE_URL unset):
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-ev.js [--fresh]
 * or by run-all.js in plan order. State: C:\Temp\octapm-cert\state\cert3\087-EV.json.
 */

const crypto = require('crypto');
const lib = require('./lib');

const { is } = lib;
const SCHEDULE = lib.answers.schedule;
const RULES = SCHEDULE.rules;
const BOOK = SCHEDULE.WP3;
const EV = SCHEDULE.inputs.ev087;
const F1_TASKS = SCHEDULE.inputs.F1.tasks;
const F1_CODES = F1_TASKS.map((t) => t[0]);
const START = SCHEDULE.inputs.start; // 2026-01-05, a Monday (plan §3.2)
const JAN = '2026-01'; // plan §3.2: "Reporting periods 2026-01, 2026-02 and one with a future cutoff"
const FEB = '2026-02';

/** Answer-book rows [code, name, wbs, hours, FS predecessor, pct] as programme tasks and links (files.programme). */
const tasksOf = (rows) => rows.map(([code, name, wbs, hours, , pct]) => ({ code, name, wbs, hours, pct }));
const linksOf = (rows) => rows.filter((row) => row[4]).map(([code, , , , pred]) => ({ pred, succ: code, type: 'FS', lagHours: 0 }));

/**
 * The two programmes: F1 (files.F1(), checked against the answer book), and
 * the revision that retires A140 (F1 with A140 left out; nothing else moves).
 */
const PROGRAMMES = {
  F1: () => lib.files.F1(),
  F1r: () => {
    const rows = F1_TASKS.filter((t) => t[0] !== 'A140');
    return lib.files.programme({ name: 'F1r', wbs: SCHEDULE.inputs.wbs, tasks: tasksOf(rows), links: linksOf(rows), note: '087-EV T6: F1 with A140 left out (its retirement)' });
  },
};

/** The activities that take progress in this build: the site engineer is assigned to these. */
const PROGRESS_CODES = ['A110', 'A120', 'A130', 'A310', 'A320'];
/** T7: a draft, a submitted and a rejected submission, all on allocated activities. */
const T7 = [
  { key: 'draft', code: 'A310', pct: 30, status: 'draft' },
  { key: 'submitted', code: 'A320', pct: 20, status: 'submitted' },
  { key: 'rejected', code: 'A130', pct: 50, status: 'submitted', reject: true },
];
/** The company cost code each direct cost is coded to (087's library: 01-100 Site works, 02-100 Concrete). */
const COST_CODE_OF = { A110: '01-100', A120: '02-100', A130: '02-100', A140: '01-100' };
const COST_TYPE_OF = { A110: 'equipment', A120: 'material', A130: 'material', A140: 'labour' };
const COST_CODES = [...new Set(Object.values(COST_CODE_OF))];
const FALLBACK_CODE = { '01-100': { name: 'Site works', category: 'labour' }, '02-100': { name: 'Concrete', category: 'material' } };
/** The statuses a refusal of the T5 delete may take (WP3.T5.deleteProbe 'refused_or_audited': the code is undecided, so status only). */
const PROBE_REFUSALS = [400, 403, 409, 422];
/**
 * The deletions of the T5 probe the step itself judges (R2-F): the lib records them under L112 so they are
 * never sent again; the step decides. With an audit event of the delete: the book's value ('audited').
 * Silent and 200: HEAD's recorded answer (L112). Silent and anything else: the build fails.
 */
const PROBE_DELETIONS = ['200', '204'];
/** HEAD's recorded answer to the T5 delete (WP3.T5.deleteProbe today: a silent delete), as the lib says it. */
const PROBE_L112_SAID = '200';

// ── the answer book's figures ────────────────────────────────────────────────
const FIGURES = ['totalBudget', 'pv', 'ev', 'ac', 'spi', 'cpi', 'eac', 'eacBasis', 'sv', 'cv', 'etc', 'approvedAllocatedAmount', 'approvedBudgetRevisionDelta', 'unallocatedBoqAmount'];
const METRICS = ['bac', 'pv', 'ev', 'ac', 'spi', 'spiAlert', 'cpi', 'cpiAlert', 'eac', 'eacBasis', 'sv', 'cv', 'etc'];
const r6 =(x) => (x === null || x === undefined ? null : Number(Number(x).toFixed(6)));

/** A leaf of the answer book's WP3 tree by its dotted path ('T1.ac', 'periods.feb.cutoff'). */
function leaf(path) {
  const node = String(path).split('.').reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), BOOK);
  if (!node || typeof node !== 'object' || !('value' in node) || !('unit' in node)) throw new lib.BuildError(`answer book: WP3.${path} is not a leaf`);
  return node;
}

/** An expected figure from a book leaf: its value, HEAD's recorded value (leaf.today) where the book keeps one, its unit and key. */
const fromBook = (path, from = null) => {
  const l = leaf(path);
  return { value: l.value, ...(l.today !== undefined ? { today: l.today } : {}), unit: l.unit, from: from || `WP3.${path}` };
};

/**
 * The thirteen metric leaves of a book node (WP3.T1, WP3.T3, WP3.periods.feb.snapshot,
 * WP3.periods.afterLock.cutoffAfterCost, WP3.T6.after.revisionDeleted, ...): every expected
 * figure of a read is a leaf (A10, R3-2); none is computed here.
 */
const metricsFrom = (prefix, label = null) => Object.fromEntries(METRICS.map((k) => [k, fromBook(`${prefix}.${k}`, label ? `WP3.${prefix}.${k} (${label})` : null)]));

const observedFigure = (summary, key) => {
  if (key === 'bac') return summary.figures.totalBudget;
  if (key === 'spiAlert' || key === 'cpiAlert') return summary.alerts?.[key];
  return summary.figures[key];
};

/** Money in integer cents (the API answers in currency units), ratios to six places, the rest exactly. */
const sameFigure = (unit, observed, expected) => {
  if (unit === 'cents') {
    if (observed === null || observed === undefined || expected === null) return (observed ?? null) === expected;
    try {
      return lib.toCents(observed) === expected;
    } catch {
      return false;
    }
  }
  if (unit === 'ratio') return observed === null || observed === undefined ? expected === null : expected !== null && r6(observed) === expected;
  return observed === expected;
};

/** An answered figure in the book's unit (money in cents, ratios to six places), for the record. */
const inBookUnit = (unit, observed) => {
  if (observed === null || observed === undefined) return null;
  if (unit === 'cents') {
    try {
      return lib.toCents(observed);
    } catch {
      return `not cents: ${observed}`;
    }
  }
  return unit === 'ratio' ? r6(observed) : observed;
};

/** Each expected figure judged: 'value' (the book's), 'today' (HEAD's recorded value of a registered defect), or 'wrong'. */
function judgeFigures(summary, expected) {
  const rows = {};
  for (const [key, e] of Object.entries(expected)) {
    const observed = observedFigure(summary, key);
    let verdict = 'wrong';
    if (sameFigure(e.unit, observed, e.value)) verdict = 'value';
    else if (e.today !== undefined && sameFigure(e.unit, observed, e.today)) verdict = 'today';
    rows[key] = { observed: observed ?? null, asBook: inBookUnit(e.unit, observed), value: e.value, ...(e.today !== undefined ? { today: e.today } : {}), unit: e.unit, from: e.from, verdict };
  }
  return rows;
}

/** JSON with every object's keys sorted, so a hash depends on content, never on key order (R1-20). */
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
};
const shaOf = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** What a checkpoint keeps of an EV report: figures, alerts, activity rows, the cut and zone, and the canonical hash without asOfDate (plan WP-3 T7). */
function summarise(report) {
  const copy = JSON.parse(JSON.stringify(report ?? null));
  if (copy && copy.reporting) delete copy.reporting.asOfDate;
  const r = report?.reporting || {};
  return {
    sha256: shaOf(copy),
    hashOf: 'sha256 of the canonical (sorted-key) JSON of the report without reporting.asOfDate',
    figures: Object.fromEntries(FIGURES.filter((k) => report && k in report).map((k) => [k, report[k]])),
    alerts: report?.alerts ?? null,
    reporting: {
      cutoffDate: r.cutoffDate ?? null,
      cutoffLocalDate: r.cutoffLocalDate ?? null,
      timeZone: r.timeZone ?? null,
      timeZoneSource: r.timeZoneSource ?? null,
      timeZoneNote: r.timeZoneNote ?? null,
      isSnapshot: Boolean(r.isSnapshot),
      snapshotId: r.snapshotId ?? null,
      lockedAt: r.lockedAt ?? null,
      periodId: r.period?.id ?? null,
      periodCode: r.period?.code ?? null,
      periodStatus: r.period?.status ?? null,
    },
    readinessOverride: report?.readinessOverride ?? null,
    activities: (report?.activityBreakdown || []).map((a) => ({
      activityId: a.activityId,
      budget: a.budget,
      pv: a.pv,
      ev: a.ev,
      ac: a.ac,
      pct: a.pct,
      officialActualThroughDate: a.officialActualThroughDate ?? null,
      progressStatus: a.progressStatus ?? null,
    })),
    basisWarnings: report?.basisWarnings || [],
  };
}

/**
 * The readiness reader (GET .../readiness): 'ready' when no blocking check of
 * `gate` fails; 'hr-s2' when the only failing one is date_sanity and every
 * invalid row is a zero-duration activity whose finish is not after its start
 * (HR-S2 is fixed, so that is a regression); 'other' for anything else.
 */
function hrS2Verdict(readiness, gate, zeroIds) {
  const failing = (readiness?.checks || []).filter(
    (c) => c.severity === 'blocking' && !c.passed && (!Array.isArray(c.requiredFor) || c.requiredFor.includes(gate)),
  );
  const summary = failing.map((c) => ({ key: c.key, message: c.message, invalidRows: c.details?.invalidRows ?? undefined }));
  if (!failing.length) return { verdict: 'ready', failing: summary };
  const rows = failing.flatMap((c) => c.details?.invalidRows || []);
  const onlyMilestoneDates = failing.every((c) => c.key === 'date_sanity')
    && rows.length > 0
    && rows.every((row) => row.issue === 'finish_date_before_start_date' && zeroIds.has(String(row.activityId)));
  return { verdict: onlyMilestoneDates ? 'hr-s2' : 'other', failing: summary };
}

const notReady = (what, verdict) => (verdict.verdict === 'hr-s2'
  ? `${what}: a zero-duration milestone fails the date check; HR-S2 is decided and fixed at f599e67 (WP1-MS-1), so this is a regression, never a known answer`
  : `${what}: blocking readiness checks fail`);

async function build(b, { programmes = PROGRAMMES, title = 'Earned value' } = {}) {
  const today = b.today; // transaction dates (b.past): the earlier of UTC's and the company's date
  const zone = b.company.timezone;
  const ZONE = { timeZone: leaf('setup.timeZone').value, timeZoneSource: leaf('setup.timeZoneSource').value, timeZoneNote: leaf('setup.timeZoneNote').value };
  b.assert(zone === ZONE.timeZone, `company ${b.company.code}'s zone ${zone} is the book's WP3.setup.timeZone ${ZONE.timeZone}`);
  /** The company-local date now: a "today" cutoff is read at it (R1-1), never at b.today, whose end may already be past in Cairo. */
  const localToday = () => lib.dates.ymd(new Date(), zone);
  const list = (data, key) => (Array.isArray(data) ? data : Array.isArray(data?.[key]) ? data[key] : Array.isArray(data?.items) ? data.items : []);
  /** G6: the one record that matches (or null when none does); two or more is a failure, never a pick. */
  const one = (rows, what) => {
    if (rows.length > 1) throw new lib.BuildError(`${what}: ${rows.length} records match (${rows.map((r) => r?.id ?? '?').join(', ')}); exactly one is expected (G6)`);
    return rows[0] || null;
  };
  /** 087-EV's period of a code for the company-local run date (rules.ev087PeriodsFor), exactly one. */
  const periodDef = (code, runDate = localToday()) => {
    const rows = RULES.ev087PeriodsFor(runDate).filter((p) => p.code === code);
    b.assert(rows.length === 1, `rules.ev087PeriodsFor(${runDate}) holds period ${code} once (found ${rows.length})`);
    return rows[0];
  };
  const T3_DATE = periodDef(FEB).cutoff;
  b.assert(lib.dates.ymd(new Date(leaf('T3.cutoff').value), zone) === T3_DATE, `the book's WP3.T3.cutoff ${leaf('T3.cutoff').value} is the end of ${T3_DATE} in ${zone}`);

  // T6's revision is this build's own and active: it supersedes F1's revision and
  // retires A140, which earlier steps' verifies accept (only) in that case.
  const t6Active = async (s) => {
    const st = b.state.steps['import.F1r'];
    if (!st || st.status !== 'done' || !st.out?.revisionId) return false;
    return Boolean((await s.get('pm', `/projects/${b.projectId}/schedule/revisions/${st.out.revisionId}`)).isActive);
  };

  // Every chain step needs the one before it, so a resume never runs one out of
  // answer-book order. A side step (the delete probe, a checkpoint's verdict)
  // needs the chain step before it, but no chain step needs it: its BLOCKED
  // verdict never blocks the build behind it.
  let previous = null;
  const needsOf = (opts) => [...(opts.needs || []), ...(previous ? [previous] : [])];
  const chain = async (name, fn, opts = {}) => {
    const out = await b.step(name, fn, { ...opts, needs: needsOf(opts) });
    previous = name;
    return out;
  };
  const side = (name, fn, opts = {}) => b.step(name, fn, { ...opts, needs: needsOf(opts) });

  // ── the project and its people ─────────────────────────────────────────────
  const f1 = programmes.F1();
  b.assert(f1.start === START, `F1 starts ${f1.start}, the plan says ${START}`);
  await b.project({
    title,
    payload: { startDate: START, endDate: f1.finishDate, projectCalendar: 'five_day', currency: 'EGP', type: 'building', contractType: 'unit_rate' },
    fields: { projectCalendar: 'five_day', currency: 'EGP', startDate: is.day(START), endDate: is.day(f1.finishDate) },
  });
  previous = 'project';
  const P = b.P;
  await b.team({ planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', site: 'site_engineer', finance: 'finance' });
  previous = 'team';

  // ── cost codes: two of 087's library codes put on the project (R1-23: exactly one row per code) ──
  const libraryRows = async (s, code) => ((await s.get('cost', `${P}/budget/cost-codes`)).available || []).filter((c) => c.code === code);
  const codes = await chain('costCodes', async (s) => {
    const ids = {};
    for (const code of COST_CODES) {
      let row = one(await libraryRows(s, code), `087's company cost code ${code}`);
      if (!row) {
        // Not in the restored library: made once, for this build (named for it).
        const made = await s.create(`costCode.${code}`, 'pm', '/company/cost-codes', { code, name: `${FALLBACK_CODE[code].name} (CERT3 ${b.code})`, category: FALLBACK_CODE[code].category, status: 'active' }, {
          fields: { code, status: 'active' },
          get: null,
          find: async (s2) => one(await libraryRows(s2, code), `company cost code ${code}`),
        });
        s.note(`company cost code ${code} was not in 087's library; made ${made.id}`);
        row = one(await libraryRows(s, code), `087's company cost code ${code}`);
        s.assert(row?.id === made.id, `the company cost code ${code} made here is the one row with that code`);
      }
      ids[code] = row.id;
    }
    await s.act('costCodes.select', 'cost', 'PUT', `${P}/budget/cost-codes`, { costCodeIds: Object.values(ids) }, {
      fields: { items: (v) => (Array.isArray(v) && Object.values(ids).every((id) => v.filter((i) => i.costCodeId === id && i.status === 'active').length === 1)) || 'both codes selected once and active' },
      verify: async (s2) => {
        const now = (await s2.get('cost', `${P}/budget/cost-codes`)).items || [];
        return Object.values(ids).every((id) => now.some((i) => i.costCodeId === id && i.status === 'active'));
      },
    });
    return ids;
  }, {
    verify: async (s, out) => {
      const now = (await s.get('cost', `${P}/budget/cost-codes`)).items || [];
      for (const [code, id] of Object.entries(out)) {
        if (now.filter((i) => i.costCodeId === id && i.status === 'active').length !== 1) return `cost code ${code} (${id}) is not selected once and active on the project`;
        if ((await libraryRows(s, code)).length !== 1) return `087's library no longer holds exactly one cost code ${code}`;
      }
      return true;
    },
  });

  // ── BOQ: the five in-scope rows of 087-EV [WP3.setup.boq] ─────────────────
  const boq = await chain('boq', async (s) => {
    const ids = {};
    for (const row of EV.boq) {
      const description = `${row.description} (CERT3 ${b.code})`;
      const data = await s.create(`boq.${row.code}`, 'qs', `${P}/boq/items`, { code: row.code, description, quantity: row.quantity, unit: row.unit, rate: row.rate }, {
        fields: { 'item.code': row.code, 'item.quantity': row.quantity, 'item.unit': row.unit, 'item.amount': is.cents(row.quantity * row.rate), 'item.mappingRule': 'required' },
        get: `${P}/boq`,
        find: async (s2) => {
          const item = one(list(await s2.get('qs', `${P}/boq`), 'items').filter((i) => i.code === row.code), `BOQ item ${row.code}`);
          return item ? { item } : null;
        },
      });
      ids[row.code] = data.item?.id ?? data.id;
    }
    return ids;
  });

  // ── F1 imported, submitted, approved, activated (plan §3.2 "The F1 programme activated") ──
  const zeroKeysOf = (snapshot) => new Set((snapshot?.activities || []).filter((a) => Number(a.duration ?? a.originalDuration ?? 0) === 0).map((a) => String(a.draftKey ?? a.sourceTaskId ?? '')));
  const codeSet = (codesList) => [...codesList].map(String).sort().join(',');
  const importProgramme = (stepName, model, fileName) => chain(stepName, async (s) => {
    const file = lib.files.xer(model, { filename: b.file(fileName) });
    const wanted = codeSet(model.activities.map((a) => a.code));
    const data = await s.upload(stepName, 'planner', `${P}/import/xer`, file, {
      expect: 201,
      idOf: (d) => d?.revisionId ?? null,
      get: (id) => `${P}/schedule/revisions/${id}`,
      fields: { staged: true, imported: model.activities.length, dependencyCount: model.links.length },
      // An interrupted import is found by identity: an XER revision whose staged
      // activities are exactly this file's codes (F1 and F1r differ by A140).
      // What it returns is the live revision as read (R3-5, as 087-imp.js does):
      // its own activity and dependency counts, and whether it is still a staged
      // draft, so the fields check reads what the product holds, not the model.
      find: async (s2) => {
        const candidates = list(await s2.get('planner', `${P}/schedule/revisions`), 'items').filter((r) => r.source === 'xer' && r.activityCount === model.activities.length);
        const same = [];
        for (const r of candidates) {
          const detail = await s2.get('planner', `${P}/schedule/revisions/${r.id}`);
          if (codeSet((detail.snapshotJson?.activities || []).map((a) => a.p6ActivityId)) === wanted) same.push(detail);
        }
        const hit = one(same, `the staged revision of ${file.filename}`);
        return hit ? { revisionId: hit.id, staged: hit.status === 'draft' && !hit.isActive, imported: hit.activityCount, dependencyCount: (hit.snapshotJson?.dependencies || []).length } : null;
      },
    });
    // A rerun of this step after its upload was recorded gets the revision as read back (its id), not the
    // import's answer (R3-7, as 087-imp.js stage()): the revision id then comes from the record.
    const rec = b.state.records[stepName];
    const revisionId = data.revisionId ?? rec?.id ?? null;
    s.assert(typeof revisionId === 'string' && revisionId.length > 0, `the import of ${file.filename} names its revision (answer ${JSON.stringify(data?.revisionId ?? null)}, record ${JSON.stringify(rec?.id ?? null)})`);
    return { revisionId, file: file.filename, sha256: file.sha256, activities: model.activities.length };
  }, {
    verify: async (s, out) => {
      const rev = await s.get('planner', `${P}/schedule/revisions/${out.revisionId}`);
      return rev.activityCount === out.activities || `revision ${out.revisionId} holds ${rev.activityCount} activities`;
    },
  });

  const submitRevision = (stepName, revisionOf) => chain(stepName, async (s) => {
    const rev = revisionOf();
    const data = await s.act(stepName, 'planner', 'POST', `${P}/schedule/revisions/${rev}/submit-review`, { comment: b.name('submitted for review') }, {
      fields: { status: 'under_review' },
      verify: async (s2) => ['under_review', 'approved', 'baselined'].includes((await s2.get('planner', `${P}/schedule/revisions/${rev}`)).status),
    });
    return { status: data?.status ?? 'under_review' };
  });

  const approveRevision = (stepName, revisionOf) => chain(stepName, async (s) => {
    const rev = revisionOf();
    const revision = await s.get('pm', `${P}/schedule/revisions/${rev}`);
    const readiness = await s.get('pm', `${P}/schedule/revisions/${rev}/readiness`);
    const verdict = hrS2Verdict(readiness, 'approval', zeroKeysOf(revision.snapshotJson));
    s.assert(verdict.verdict === 'ready', notReady(`revision ${rev} is not ready for approval`, verdict), verdict.failing);
    const data = await s.act(stepName, 'pm', 'POST', `${P}/schedule/revisions/${rev}/approve`, { comment: b.name('approved') }, {
      fields: { status: 'approved' },
      verify: async (s2) => ['approved', 'baselined'].includes((await s2.get('pm', `${P}/schedule/revisions/${rev}`)).status),
    });
    return { status: data?.status ?? 'approved', readiness: verdict };
  });

  const imported = await importProgramme('import.F1', f1, 'F1.xer');
  const revF1 = () => imported.revisionId;
  await submitRevision('submit.F1', revF1);
  await approveRevision('approve.F1', revF1);

  await chain('activate.F1', async (s) => {
    const rev = revF1();
    const data = await s.act('activate.F1', 'pm', 'POST', `${P}/schedule/revisions/${rev}/activate`, { mappings: [], comment: b.name('F1 activated') }, {
      fields: { 'revision.isActive': true, 'activation.newActivities': is.count(f1.activities.length), 'activation.retiredActivities': is.count(0) },
      verify: async (s2) => Boolean((await s2.get('pm', `${P}/schedule/revisions/${rev}`)).isActive),
    });
    return { revisionId: rev, newActivities: data?.activation?.newActivities?.length ?? null };
  }, {
    // Active, or superseded by this build's own T6 revision once that one is active
    // (also when a run was killed right after the T6 activation was sent).
    verify: async (s, out) => {
      const rev = await s.get('pm', `${P}/schedule/revisions/${out.revisionId}`);
      return Boolean(rev.isActive) || (rev.status === 'superseded' && (await t6Active(s))) || `revision ${out.revisionId} is ${rev.status} and not active`;
    },
  });

  // ── the activities (G6: each F1 code exactly once), and the site engineer on the five that take progress ──
  const acts = await chain('activities', async (s) => {
    const rows = list(await s.get('planner', `${P}/activities`), 'items');
    s.assert(rows.length === F1_CODES.length, `${F1_CODES.length} active activities after the activation (found ${rows.length})`);
    const byCode = {};
    for (const code of F1_CODES) {
      const hits = rows.filter((a) => a.p6ActivityId === code);
      s.assert(hits.length === 1, `exactly one active activity carries code ${code} (found ${hits.length})`, hits.map((a) => a.id));
      byCode[code] = hits[0].id;
    }
    const siteId = await b.userId('site');
    for (const code of PROGRESS_CODES) {
      await s.act(`assign.site.${code}`, 'planner', 'PATCH', `${P}/activities/${byCode[code]}`, { engineerIds: [siteId] }, {
        fields: { assignedEngineers: (v) => (Array.isArray(v) && v.some((e) => e.id === siteId)) || 'the site engineer among the assigned engineers' },
        verify: async (s2) => ((await s2.get('planner', `${P}/activities/${byCode[code]}`)).assignedEngineers || []).some((e) => e.id === siteId),
      });
    }
    return {
      byCode,
      siteId,
      zeroDuration: rows.filter((a) => Number(a.duration) === 0).map((a) => a.id),
      milestones: rows.filter((a) => a.isMilestone).map((a) => a.p6ActivityId),
    };
  }, {
    verify: async (s, out) => {
      const rows = list(await s.get('planner', `${P}/activities`), 'items');
      return PROGRESS_CODES.every((code) => rows.some((a) => a.id === out.byCode[code])) || 'an activity that takes progress is no longer active';
    },
  });

  // ── five approved allocations, one row whole to one activity [WP3.setup.allocations, WP3.setup.allocatedTotal] ──
  const allocationsNow = async (s) => list(await s.get('planner', `${P}/activity-boq-allocations`), 'allocations');
  await chain('allocations', async (s) => {
    const out = {};
    for (const row of EV.boq) {
      for (const [code, quantity, amount] of row.allocations) {
        const name = `alloc.${row.code}.${code}`;
        const boqItemId = boq[row.code];
        const activityId = acts.byCode[code];
        const created = await s.create(name, 'planner', `${P}/activity-boq-allocations`, { boqItemId, activityId, quantity, amount, source: 'manual', notes: b.name(`${row.code} to ${code}`) }, {
          fields: { status: 'draft', boqItemId, activityId, amount: is.cents(amount), quantity: is.number(quantity) },
          get: null,
          find: async (s2) => one((await allocationsNow(s2)).filter((a) => a.boqItemId === boqItemId && a.activityId === activityId), `allocation of ${row.code} to ${code}`),
        });
        const isAt = async (s2, statuses) => statuses.includes((await allocationsNow(s2)).find((a) => a.id === created.id)?.status);
        await s.act(`${name}.submit`, 'planner', 'POST', `${P}/activity-boq-allocations/${created.id}/submit`, {}, {
          fields: { status: 'submitted' },
          verify: (s2) => isAt(s2, ['submitted', 'approved']),
        });
        await s.act(`${name}.approve`, 'pm', 'POST', `${P}/activity-boq-allocations/${created.id}/approve`, {}, {
          fields: { status: 'approved', amount: is.cents(amount) },
          verify: (s2) => isAt(s2, ['approved']),
        });
        out[code] = { id: created.id, boqItemId, amount };
      }
    }
    return out;
  }, {
    verify: async (s, out) => {
      const rows = await allocationsNow(s);
      const bad = Object.entries(out).filter(([, a]) => rows.find((r) => r.id === a.id)?.status !== 'approved').map(([code]) => code);
      return bad.length === 0 || `allocations no longer approved: ${bad.join(', ')}`;
    },
  });

  // ── approved cost loadings [WP3.setup.loadings; PV of T1/T3, the period snapshots] ──
  const loadingsNow = async (s) => list(await s.get('cost', `${P}/reports/cost-loading`), 'items');
  await chain('loadings', async (s) => {
    const out = {};
    for (const [code, amount, date] of EV.loadings) {
      const name = `loading.${code}`;
      const activityId = acts.byCode[code];
      const notes = b.name(`cost loading ${code} ${date}`);
      const created = await s.create(name, 'cost', `${P}/reports/cost-loading`, { activityId, plannedDate: date, plannedValue: amount, source: 'manual', status: 'submitted', notes }, {
        fields: { status: 'submitted', activityId, plannedDate: is.day(date), plannedValue: is.cents(amount) },
        get: `${P}/reports/cost-loading`,
        find: async (s2) => one((await loadingsNow(s2)).filter((l) => l.notes === notes), `cost loading ${code}`),
      });
      await s.act(`${name}.approve`, 'pm', 'POST', `${P}/reports/cost-loading/${created.id}/approve`, {}, {
        fields: { status: 'approved', plannedValue: is.cents(amount) },
        verify: async (s2) => (await loadingsNow(s2)).find((l) => l.id === created.id)?.status === 'approved',
      });
      out[code] = { id: created.id, amount, plannedDate: date };
    }
    return out;
  }, {
    verify: async (s, out) => {
      const rows = await loadingsNow(s);
      const bad = Object.entries(out).filter(([, l]) => rows.find((r) => r.id === l.id)?.status !== 'approved').map(([code]) => code);
      return bad.length === 0 || `cost loadings no longer approved: ${bad.join(', ')}`;
    },
  });

  // ── progress submissions (site) and their review (pm) ──────────────────────
  const submissionsOf = async (s, activityId) => list(await s.get('pm', `${P}/activities/${activityId}/progress-submissions`), 'items');
  const progress = async (s, name, code, pct, { status = 'submitted', approve = status === 'submitted', reject = false } = {}) => {
    const activityId = acts.byCode[code];
    const notes = b.name(`${name}: ${code} ${pct}%`);
    const data = await s.create(name, 'site', `${P}/activities/${activityId}/progress`, { pctComplete: pct, progressMethod: 'percent', status, source: 'manual', notes }, {
      expect: 200,
      idOf: (d) => d?.submission?.id ?? null,
      fields: { 'submission.status': status, 'submission.pctComplete': pct, 'submission.activityId': activityId },
      get: `${P}/activities/${activityId}/progress-submissions`,
      find: async (s2) => {
        const found = one((await submissionsOf(s2, activityId)).filter((x) => x.notes === notes), `progress submission "${notes}"`);
        return found ? { submission: found } : null;
      },
    });
    const submissionId = data?.submission?.id ?? data?.id;
    const statusNow = async (s2) => (await submissionsOf(s2, activityId)).find((x) => x.id === submissionId)?.status;
    let final = status;
    if (reject) {
      await s.act(`${name}.reject`, 'pm', 'POST', `${P}/activities/${activityId}/progress-submissions/${submissionId}/reject`, { reason: b.name('T7: the rejected submission') }, {
        fields: { status: 'rejected' },
        verify: async (s2) => (await statusNow(s2)) === 'rejected',
      });
      final = 'rejected';
    } else if (approve) {
      await s.act(`${name}.approve`, 'pm', 'POST', `${P}/activities/${activityId}/progress-submissions/${submissionId}/approve`, {}, {
        fields: { status: 'approved', pctComplete: pct },
        verify: async (s2) => (await statusNow(s2)) === 'approved',
      });
      final = 'approved';
    }
    return { activity: code, activityId, submissionId, pct, status: final };
  };
  const verifySubmissions = async (s, out) => {
    for (const row of Object.values(out || {})) {
      const now = (await submissionsOf(s, row.activityId)).find((x) => x.id === row.submissionId);
      if (now?.status !== row.status) return `${row.activity}'s submission ${row.submissionId} is ${now?.status ?? 'gone'}, not ${row.status}`;
    }
    return true;
  };

  // Approved progress A110 100, A120 50, A130 25 [WP3.setup.progress; EV 97,500.00 of T1]
  await chain('progress', async (s) => {
    const out = {};
    for (const [code, pct] of Object.entries(EV.progress)) out[code] = await progress(s, `progress.${code}`, code, pct);
    return out;
  }, { verify: verifySubmissions });

  // ── direct costs: created (cost), submitted (cost), approved (finance) ─────
  const directCost = async (s, name, [code, amount, date], why) => {
    b.past(date);
    const activityId = acts.byCode[code];
    const costCodeId = codes[COST_CODE_OF[code]];
    const description = b.name(`${why}: ${code} ${amount} incurred ${date}`);
    const created = await s.create(name, 'cost', `${P}/direct-costs`, {
      type: 'expense',
      description,
      vendorName: b.name('Site payee'),
      costDate: date,
      lines: [{ description, costCodeId, activityId, costType: COST_TYPE_OF[code], quantity: 1, unit: 'ls', unitCost: amount, amount }],
    }, {
      fields: { status: 'draft', costDate: date, total: is.cents(amount), 'lines.0.activityId': activityId, 'lines.0.amount': is.cents(amount) },
      find: async (s2) => one(list(await s2.get('cost', `${P}/direct-costs?q=${encodeURIComponent(b.code)}`), 'items').filter((d) => d.description === description), `direct cost "${description}"`),
    });
    const statusNow = async (s2) => (await s2.get('cost', `${P}/direct-costs/${created.id}`)).status;
    await s.act(`${name}.submit`, 'cost', 'POST', `${P}/direct-costs/${created.id}/submit`, {}, {
      fields: { status: 'pending' },
      verify: async (s2) => ['pending', 'approved'].includes(await statusNow(s2)),
    });
    await s.act(`${name}.approve`, 'finance', 'POST', `${P}/direct-costs/${created.id}/approve`, {}, {
      fields: { status: 'approved', 'lines.0.postedAmount': is.cents(amount) },
      verify: async (s2) => (await statusNow(s2)) === 'approved',
    });
    return { id: created.id, ref: created.ref ?? null, activity: code, amount, costDate: date };
  };
  const verifyCosts = async (s, out) => {
    for (const row of Object.values(out || {})) {
      const now = await s.get('cost', `${P}/direct-costs/${row.id}`);
      if (now.status !== 'approved') return `direct cost ${row.id} (${row.activity}) is ${now.status}`;
    }
    return true;
  };

  // A110 50,000 on 01-20 and 10,000 on 09-30; A130 20,000 on 02-10 [WP3.setup.directCosts; AC of T1, T3 (L34)]
  await chain('directCosts', async (s) => {
    const out = {};
    for (const row of EV.directCosts) out[`${row[0]}.${row[2]}`] = await directCost(s, `cost.${row[0]}.${row[2]}`, row, 'direct cost');
    return out;
  }, { verify: verifyCosts });

  // ── checkpoints: the EV report as the cost controller reads it ─────────────
  const zoneHolds = (s, where, r) => {
    s.assert(r.timeZone === ZONE.timeZone && r.timeZone === zone, `${where}: reporting zone ${r.timeZone}; the book's WP3.setup.timeZone ${ZONE.timeZone} is company ${b.company.code}'s ${zone}`);
    s.assert(r.timeZoneSource === ZONE.timeZoneSource, `${where}: timeZoneSource ${r.timeZoneSource}; the book's WP3.setup.timeZoneSource is ${ZONE.timeZoneSource}`);
    s.assert((r.timeZoneNote ?? null) === ZONE.timeZoneNote, `${where}: timeZoneNote ${JSON.stringify(r.timeZoneNote)}; the book's WP3.setup.timeZoneNote is ${JSON.stringify(ZONE.timeZoneNote)}`);
  };
  /**
   * One EV report read, asserted: cut at `local` (and at its instant: the book's
   * rule, endOfLocalDay in the company zone), in the book's zone, and every
   * expected figure the book's value or, for the registered defect `ref`, the
   * value HEAD gives (leaf.today). Anything else fails the build.
   */
  const read = async (s, query, { local, instant = RULES.endOfLocalDay(local, zone), expected, ref = null }) => {
    const report = await s.get('cost', `${P}/reports/ev${query}`);
    const r = report?.reporting || {};
    s.assert(r.cutoffLocalDate === local, `GET /reports/ev${query} is cut at ${local} (got ${r.cutoffLocalDate})`);
    s.assert(r.cutoffDate === instant, `GET /reports/ev${query} is cut at the instant ${instant} (got ${r.cutoffDate})`);
    zoneHolds(s, `GET /reports/ev${query}`, r);
    const summary = summarise(report);
    const rows = judgeFigures(summary, expected);
    const wrong = Object.entries(rows).filter(([, x]) => x.verdict === 'wrong');
    s.assert(wrong.length === 0, `GET /reports/ev${query}: ${wrong.map(([k]) => k).join(', ')} neither the book's value nor HEAD's recorded value`, Object.fromEntries(wrong));
    const known = Object.keys(rows).filter((k) => rows[k].verdict === 'today');
    if (known.length && !ref) throw new lib.BuildError(`${s.name}: GET /reports/ev${query} gives HEAD's recorded value for ${known.join(', ')}, but this read names no registered defect for it`);
    return { query, ...summary, book: { ref: known.length ? ref : null, known, rows } };
  };
  /** A "today" read: cut at the company-local date at the moment of the read (R1-1). */
  const readToday = (s, expected, ref = null) => {
    const local = localToday();
    return read(s, `?cutoffDate=${local}`, { local, expected, ref });
  };
  const readFebPeriod = (s, expected, ref) => read(s, `?periodId=${periodId(FEB)}`, { local: periodDef(FEB).cutoff, instant: leaf('periods.feb.cutoff').value, expected, ref });
  const readT3 = (s, expected, ref) => read(s, `?cutoffDate=${T3_DATE}`, { local: T3_DATE, instant: leaf('T3.cutoff').value, expected, ref });
  const checkpoint = (name, serves, readIt) => chain(name, async (s) => ({ serves, capturedAt: new Date().toISOString(), ...(await readIt(s)) }));

  /** The reads a checkpoint stored: the checkpoint itself, or its named parts (snapshot, period, cutoff0228, today). */
  const partsOf = (out) => (out?.book ? { report: out } : Object.fromEntries(Object.entries(out || {}).filter(([, v]) => v && typeof v === 'object' && v.book)));
  /**
   * The verdict on a checkpoint, from its stored output: BLOCKED with the
   * registered defect's ref when a figure is HEAD's recorded value (leaf.today),
   * done when every figure is the book's value. A side step: nothing needs it.
   */
  const verdictOf = (checkpointName) => side(`verdict.${checkpointName}`, async (s) => {
    const known = [];
    const refs = new Set();
    for (const [part, summary] of Object.entries(partsOf(b.out(checkpointName)))) {
      for (const key of summary.book.known) {
        const row = summary.book.rows[key];
        known.push({ read: part, query: summary.query ?? null, figure: key, unit: row.unit, observed: row.asBook, book: row.value, headRecorded: row.today, from: row.from });
        refs.add(summary.book.ref);
      }
    }
    if (!known.length) return { checkpoint: checkpointName, verdict: 'the book\'s value for every figure' };
    s.assert(refs.size === 1 && !refs.has(null), `${checkpointName}: HEAD's recorded values belong to one registered defect`, [...refs]);
    return s.blocked([...refs][0], { checkpoint: checkpointName, observed: 'the figures HEAD gives are the ones the answer book records for this defect (leaf.today), not its values (money in cents)', figures: known });
  });

  // T1 [WP3.T1: BAC 387,000.00, PV 387,000.00, EV 97,500.00, AC 80,000.00, SPI 0.251938 alert, CPI 1.21875, EAC 317,538.46]
  await checkpoint('checkpoint.T1', 'WP3.T1', (s) => readToday(s, metricsFrom('T1')));

  // T2: 30,000 on A120 dated 2026-10-01 [WP3.T2.addedCost; AC 110,000.00, CPI 0.886364 alert, EAC 436,615.38]
  await chain('cost.T2', async (s) => ({ T2: await directCost(s, 'cost.T2', EV.t2Cost, 'T2 cost') }), { verify: verifyCosts });
  await checkpoint('checkpoint.T2', 'WP3.T2', async (s) => {
    const report = await readToday(s, metricsFrom('T2'));
    const added = lib.toCents(report.figures.ac) - lib.toCents(b.out('checkpoint.T1').figures.ac);
    s.assert(added === leaf('T2.addedCost').value, `AC moved by ${added} cents from T1; the book's WP3.T2.addedCost is ${leaf('T2.addedCost').value}`);
    return { ...report, addedCost: added };
  });

  // T3 [WP3.T3: cutoff 2026-02-28 in Cairo; PV 180,000.00, EV 0, AC 70,000.00 expected; HEAD 20,000.00 (L34)]
  await checkpoint('checkpoint.T3', 'WP3.T3', (s) => readT3(s, metricsFrom('T3'), 'L34'));
  await verdictOf('checkpoint.T3');
  b.note('T4 is in process (WP-3 proof): nothing to build.');

  // T5: budget revision +13,000 effective 2026-03-01, approved [WP3.T5.budgetRevision; BAC 400,000.00]
  const revisionsNow = async (s) => list(await s.get('cost', `${P}/budget-revisions`), 'rows');
  /** The T5 delete probe's request as the state holds it: accepted (the revision deleted), refused, or sent and not recorded. */
  const probeRecord = () => b.state.records['budgetRevision.T5.delete'] || null;
  await chain('budgetRevision.T5', async (s) => {
    const { amount, changeType, effectiveDate } = EV.budgetRevision;
    b.past(effectiveDate);
    const revisionTitle = b.name(`Budget revision +${amount} effective ${effectiveDate}`);
    const created = await s.create('budgetRevision.T5', 'cost', `${P}/budget-revisions`, { title: revisionTitle, changeType, amount, effectiveDate, status: 'submitted', notes: b.name('T5') }, {
      fields: { status: 'submitted', changeType, amount: is.cents(amount), effectiveDate: is.day(effectiveDate), title: revisionTitle },
      get: null,
      find: async (s2) => one((await revisionsNow(s2)).filter((r) => r.title === revisionTitle), `budget revision "${revisionTitle}"`),
    });
    await s.act('budgetRevision.T5.approve', 'pm', 'PATCH', `${P}/budget-revisions/${created.id}`, { status: 'approved' }, {
      fields: { status: 'approved', amount: is.cents(amount) },
      verify: async (s2) => (await revisionsNow(s2)).find((r) => r.id === created.id)?.status === 'approved',
    });
    return { id: created.id, ref: created.ref ?? null, amount, effectiveDate };
  }, {
    // Approved, unless this build's own T5 delete probe took it (HEAD's L112 answer).
    verify: async (s, out) => {
      const rows = (await revisionsNow(s)).filter((r) => r.id === out.id);
      const probe = probeRecord();
      if (probe?.status === 'unexpected') return rows.length === 0 || `budget revision ${out.id} is listed again after this build's T5 delete probe deleted it`;
      if (probe?.status === 'pending') return rows.length === 0 || (rows.length === 1 && rows[0].status === 'approved') || `budget revision ${out.id} is ${rows[0]?.status}`;
      return (rows.length === 1 && rows[0].status === 'approved') || `budget revision ${out.id} is not approved`;
    },
  });
  /** T5's state: BAC, EAC and ETC from WP3.T5; PV, EV, AC and the rest are T2's (the book's WP3.T5.eac runs on the T2 state). */
  const t5State = () => ({ ...metricsFrom('T2', 'T5 runs on the T2 state: WP3.T5.eac'), bac: fromBook('T5.bac'), eac: fromBook('T5.eac'), etc: fromBook('T5.etc') });
  await checkpoint('checkpoint.T5', 'WP3.T5', async (s) => {
    const report = await readToday(s, t5State());
    s.assert(lib.toCents(report.figures.approvedBudgetRevisionDelta) === leaf('T5.budgetRevision').value, `approvedBudgetRevisionDelta ${report.figures.approvedBudgetRevisionDelta}; the book's WP3.T5.budgetRevision is ${leaf('T5.budgetRevision').value} cents`);
    return report;
  });

  // ── T5 delete probe [WP3.T5.deleteProbe; L112], in answer-book order between T5 and T7 (R1-21) ──
  const auditEventsOf = async (s, entityId) => list(await s.get('pm', `${P}/audit?entityId=${entityId}&limit=100`), 'events');
  const bacRead = async (s) => {
    const local = localToday();
    const report = await s.get('cost', `${P}/reports/ev?cutoffDate=${local}`);
    return { cutoffLocalDate: local, totalBudget: report.totalBudget, approvedBudgetRevisionDelta: report.approvedBudgetRevisionDelta };
  };
  await side('probe.T5.delete', async (s) => {
    const rev = b.out('budgetRevision.T5');
    const probeLeaf = leaf('T5.deleteProbe');
    const listed = async (s2) => one((await revisionsNow(s2)).filter((r) => r.id === rev.id), `budget revision ${rev.id}`);
    let refusal;
    try {
      refusal = await s.refused('budgetRevision.T5.delete', 'pm', 'DELETE', `${P}/budget-revisions/${rev.id}`, undefined, PROBE_REFUSALS, {
        named: false,
        // The deletions this step judges (R2-F); the lib keeps them under L112, never sent again.
        known: { ref: 'L112', said: PROBE_DELETIONS },
        // Sent and never recorded: it took effect when the revision is gone (then kept as accepted, never sent again).
        find: async (s2) => ((await listed(s2)) ? null : { id: rev.id }),
      });
    } catch (error) {
      if (!(error instanceof lib.Blocked)) throw error;
      // A deletion (200 or 204): the approved revision is gone. Judged by the book, WP3.T5.deleteProbe (R2-F):
      // with an audit event of the delete it is the value ('refused_or_audited'); silent and answered 200 it
      // is HEAD's recorded answer (L112); silent with any other answer it fails the build.
      const said = error.observed?.said ?? null;
      s.assert((await listed(s)) === null, `budget revision ${rev.id} is gone after the delete was answered ${said ?? '2xx'}`);
      const bac = await bacRead(s);
      s.assert(lib.toCents(bac.totalBudget) === leaf('T1.bac').value && lib.toCents(bac.approvedBudgetRevisionDelta) === 0, `after the delete BAC is ${bac.totalBudget} with revisions ${bac.approvedBudgetRevisionDelta}; a deleted revision gives WP3.T1.bac ${leaf('T1.bac').value} cents and no revision (WP3.T5.deleteProbe)`);
      const events = await auditEventsOf(s, rev.id);
      const deletions = events.filter((e) => /delet/i.test(String(e.action || '')));
      if (deletions.length) {
        // The book's value 'refused_or_audited': deleted with an audit event.
        return { outcome: 'audited', said, auditEvents: deletions.map((e) => ({ id: e.id ?? null, action: e.action })), bacAfter: bac, book: probeLeaf.value };
      }
      // Silent. HEAD's recorded answer is the silent 200. A DELETE an interrupted run sent and never recorded
      // has no status to read ('(accepted by an earlier run)'); its observed effect, a silent delete with BAC
      // back to WP3.T1.bac, is the one the book records as today, so it is judged L112 with that said.
      const interrupted = typeof said === 'string' && said.startsWith('(accepted by an earlier run');
      s.assert(said === PROBE_L112_SAID || interrupted, `the T5 delete was answered ${said} and left no audit event: neither the book's value (${probeLeaf.value}: a refusal, or a delete with an audit event) nor HEAD's recorded answer (L112: a silent ${PROBE_L112_SAID})`);
      return s.blocked('L112', {
        said,
        data: error.observed?.data ?? null,
        revisionListedAfter: false,
        auditDeleteEvents: 0,
        auditEventsOfRevision: events.length,
        bacAfter: bac,
        book: { value: probeLeaf.value, headRecorded: probeLeaf.today },
        downstream: `the checkpoints after the probe expect BAC WP3.T1.bac (${leaf('T1.bac').value} cents): the T2 state for T7, and the run-date reads after the locks take WP3.periods.afterLock.runDateAfterCost / runDateAfterApproval .revisionDeleted`,
      });
    }
    // Refused (the book's value): the revision stays approved and BAC stays WP3.T5.bac.
    const kept = await listed(s);
    s.assert(kept?.status === 'approved', `budget revision ${rev.id} stays approved after the refusal ${refusal.said} (it is ${kept?.status ?? 'gone'})`);
    const bac = await bacRead(s);
    s.assert(lib.toCents(bac.totalBudget) === leaf('T5.bac').value, `after the refusal BAC is ${bac.totalBudget}; the book's WP3.T5.bac is ${leaf('T5.bac').value} cents`);
    return { outcome: 'refused', said: refusal.said, bacAfter: bac, book: probeLeaf.value };
  }, {
    verify: async (s, out) => {
      const rows = (await revisionsNow(s)).filter((r) => r.id === b.out('budgetRevision.T5').id);
      if (out.outcome === 'refused') return (rows.length === 1 && rows[0].status === 'approved') || 'the revision the probe could not delete is no longer approved';
      return rows.length === 0 || 'the revision the probe deleted is listed again';
    },
  });
  /** The probe's outcome, as the state holds it: every later checkpoint's BAC follows from it. */
  const revisionKept = () => {
    const st = b.state.steps['probe.T5.delete'];
    if (st?.status === 'blocked') return false; // HEAD's L112 answer: deleted, silently
    if (st?.status === 'done' && ['refused', 'audited'].includes(st.out?.outcome)) return st.out.outcome === 'refused';
    throw new lib.BuildError(`the T5 delete probe is ${st ? st.status : 'not run'}; the checkpoints after it take their BAC from its outcome`);
  };
  /** The run-date state between T5 and the periods step: T5's if the revision stayed, else T2's (BAC back to 387,000.00). */
  const todayState = () => (revisionKept() ? t5State() : metricsFrom('T2', 'the T5 revision deleted by the probe: BAC back to WP3.T1.bac'));

  // T7: draft, submitted and rejected submissions leave the report byte-identical [WP3.T7]
  await checkpoint('checkpoint.T7.before', 'WP3.T7 (before; the hash reference)', (s) => readToday(s, todayState()));
  await chain('T7.submissions', async (s) => {
    const out = {};
    for (const row of T7) out[row.key] = await progress(s, `T7.${row.key}`, row.code, row.pct, { status: row.status, approve: false, reject: Boolean(row.reject) });
    return out;
  }, { verify: verifySubmissions });
  await checkpoint('checkpoint.T7.after', 'WP3.T7 (after)', async (s) => {
    const report = await readToday(s, todayState());
    const reference = b.out('checkpoint.T7.before').sha256;
    s.assert(leaf('T7').value === 'byte_identical' && report.sha256 === reference, `WP3.T7 ${leaf('T7').value}: the report after the draft, submitted and rejected submissions hashes ${report.sha256}, before ${reference}`);
    return { ...report, hashReference: { step: 'checkpoint.T7.before', sha256: reference } };
  });

  // ── reporting periods: 2026-01, 2026-02 and the future one [WP3.periods, WP3.periods.futurePeriod] ──
  const periodsNow = async (s) => list(await s.get('cost', `${P}/reports/periods`), 'periods');
  const periods = await chain('periods', async (s) => {
    const runDate = localToday();
    const all = RULES.ev087PeriodsFor(runDate);
    const future = RULES.futurePeriodFor(runDate);
    const fixed = all.filter((p) => p.code !== future.code);
    s.assert(all.length === 3 && fixed.length === 2 && fixed.every((p) => [JAN, FEB].includes(p.code)), `rules.ev087PeriodsFor(${runDate}) is ${JAN}, ${FEB} and the future period ${future.code}`, all);
    s.assert(future.cutoff > runDate && Date.parse(RULES.endOfLocalDay(future.cutoff, zone)) > Date.now(), `the future period ${future.code} (cutoff ${future.cutoff}) is after the company-local run date ${runDate}`);
    const cutoffLeaf = { [JAN]: 'periods.jan.cutoff', [FEB]: 'periods.feb.cutoff' };
    const out = {};
    const make = async (recordName, period, { isFuture }) => {
      if (!isFuture) b.past(period.cutoff);
      const label = b.name(`Period ${period.code}`);
      const instant = isFuture ? RULES.endOfLocalDay(period.cutoff, zone) : leaf(cutoffLeaf[period.code]).value;
      const created = await s.create(recordName, 'cost', `${P}/reports/periods`, { code: period.code, label, periodStart: period.start, periodEnd: period.end, cutoffDate: period.cutoff }, {
        fields: { code: period.code, label, cutoffLocalDate: period.cutoff, cutoffDate: instant, timeZone: ZONE.timeZone, timeZoneSource: ZONE.timeZoneSource, timeZoneNote: ZONE.timeZoneNote },
        get: null,
        find: async (s2) => one((await periodsNow(s2)).filter((p) => (isFuture ? ![JAN, FEB].includes(p.code) : p.code === period.code)), `reporting period ${isFuture ? '(the future one)' : period.code}`),
      });
      // A record made by an earlier attempt of this step (the run month may have turned since) is never made again.
      s.assert(created.code === period.code, `${recordName} is ${created.code}; this run's period is ${period.code}`);
      zoneHolds(s, `period ${period.code}`, created);
      out[period.code] = { id: created.id, cutoff: period.cutoff, cutoffInstant: created.cutoffDate ?? null, timeZone: created.timeZone ?? null, timeZoneSource: created.timeZoneSource ?? null, timeZoneNote: created.timeZoneNote ?? null, future: isFuture };
    };
    for (const period of fixed) await make(`period.${period.code}`, period, { isFuture: false });
    await make('period.future', future, { isFuture: true });
    s.finding('WP3-TZ-1', `reporting.timeZoneSource is '${ZONE.timeZoneSource}' with timeZone ${zone} (company 087's zone) and timeZoneNote null on the period answers and on every EV report of this project, as the answer book's WP3.setup.timeZoneSource gives it (value 'project', planValue 'organisation'): plan premise A8 reads 'organisation'. Open for WP-3 confirm-first: whether a later change of the company zone reaches this project.`);
    return out;
  }, {
    verify: async (s, out) => {
      const rows = await periodsNow(s);
      return Object.entries(out).every(([code, p]) => rows.filter((r) => r.id === p.id && r.code === code).length === 1) || 'a reporting period is gone';
    },
  });
  const periodId = (code) => periods[code].id;
  const lockRoute = (code) => `${P}/reports/periods/${periodId(code)}/lock`;
  const statusOf = async (s, code) => (await periodsNow(s)).find((p) => p.id === periodId(code))?.status ?? null;
  const gateNow = async (s) => (await s.get('pm', `/projects/${b.projectId}/setup-readiness`))?.gates?.reporting ?? null;
  const sameFigures = (x, y) => JSON.stringify(canonical({ figures: x.figures, alerts: x.alerts })) === JSON.stringify(canonical({ figures: y.figures, alerts: y.alerts }));

  // The open February report, before the lock [WP3.periods.feb.snapshot: the T3 figures; AC per L34]
  await checkpoint('checkpoint.feb.open', 'WP3.periods.feb (the open report the snapshot is compared with)', (s) => readFebPeriod(s, metricsFrom('periods.feb.snapshot'), 'L34'));
  await verdictOf('checkpoint.feb.open');

  // February: locked while the gate is blocked, on a PM override [WP3.periods.lockAsPlanner, financeWhileBlocked, financeWithOverride, feb.lockByPmWithReason, feb.snapshot]
  await chain('lock.2026-02', async (s) => {
    const gate = await gateNow(s);
    s.assert(gate && gate.ready === false, 'the reporting gate is blocked before February is locked (the override needs a blocked gate)', gate);
    const reason = b.name('February locked on a PM override: baseline not locked and progress methods not configured yet');
    const lockedNow = async (s2) => ((await statusOf(s2, FEB)) === 'locked' ? { id: periodId(FEB) } : null);
    const planner = await s.refused('lock.2026-02.planner', 'planner', 'POST', lockRoute(FEB), {}, leaf('periods.lockAsPlanner').value, { named: false, find: lockedNow });
    const finance = await s.refused('lock.2026-02.finance', 'finance', 'POST', lockRoute(FEB), {}, leaf('periods.financeWhileBlocked').value, { named: false, find: lockedNow });
    const financeOverride = await s.refused('lock.2026-02.finance-override', 'finance', 'POST', lockRoute(FEB), { overrideReason: b.name('finance tries the override') }, leaf('periods.financeWithOverride').value, { find: lockedNow });
    await s.act('lock.2026-02', 'pm', 'POST', lockRoute(FEB), { overrideReason: reason }, {
      expect: leaf('periods.feb.lockByPmWithReason').value,
      fields: { 'reporting.isSnapshot': true, 'reporting.snapshotId': is.present, 'reporting.period.code': FEB, 'readinessOverride.reason': reason },
      verify: async (s2) => (await statusOf(s2, FEB)) === 'locked',
    });
    const snapshot = await readFebPeriod(s, metricsFrom('periods.feb.snapshot'), 'L34');
    s.assert(snapshot.reporting.isSnapshot === true && Boolean(snapshot.reporting.snapshotId), 'February is served from its snapshot after the lock', snapshot.reporting);
    s.assert(snapshot.readinessOverride?.reason === reason, 'the snapshot carries the PM\'s override reason', snapshot.readinessOverride);
    const open = b.out('checkpoint.feb.open');
    s.assert(sameFigures(snapshot, open), 'the snapshot\'s figures and alerts equal the open report\'s (plan WP-3 "snapshot equal to the open report")', { snapshot: snapshot.figures, open: open.figures });
    return {
      gateBefore: { ready: gate.ready, blockers: (gate.blockers || []).map((x) => x.code) },
      refusals: { planner: planner.said, finance: finance.said, financeOverride: financeOverride.said },
      overrideReason: reason,
      snapshot,
      hashNote: 'the period report hash reference is checkpoint.afterLock.before\'s period read: the January lock, made later, adds a locked history point to February\'s report',
    };
  }, {
    verify: async (s) => (await statusOf(s, FEB)) === 'locked' || 'February is not locked',
  });
  await verdictOf('lock.2026-02');

  // The gate made ready for a normal lock: progress methods on every activity, then the baseline [WP3.periods.jan.lock "once 087-EV's reporting gate is ready"]
  await chain('gate.methods', async (s) => {
    const rows = list(await s.get('planner', `${P}/activities`), 'items').filter((a) => !a.isMilestone);
    const out = {};
    for (const a of rows) {
      const code = a.p6ActivityId || a.id;
      const route = `${P}/activities/${a.id}/progress-method`;
      // get: null: GET progress-method answers 404 once an activity is retired (A140
      // at T6), so the step's verify reads the activity list instead.
      const data = await s.create(`method.${code}`, 'planner', route, { method: 'percent', notes: b.name('progress method for official EV') }, {
        method: 'PUT',
        expect: 200,
        get: null,
        fields: { method: 'percent', activityId: a.id, id: is.present },
        find: async (s2) => {
          const m = await s2.get('planner', route);
          return m?.id ? m : null;
        },
      });
      out[code] = { activityId: a.id, methodId: data.id };
    }
    return out;
  }, {
    verify: async (s, out) => {
      const rows = list(await s.get('planner', `${P}/activities`), 'items');
      const t6 = await t6Active(s);
      for (const [code, m] of Object.entries(out || {})) {
        const row = rows.find((a) => a.id === m.activityId);
        if (!row) {
          if (t6 && m.activityId === acts.byCode.A140) continue; // retired by this build's T6 revision
          return `${code} is no longer active`;
        }
        if (row.progressMethodConfig?.method !== 'percent') return `${code}'s progress method is ${row.progressMethodConfig?.method ?? 'not configured'}`;
      }
      return true;
    },
  });

  await chain('baseline', async (s) => {
    const rev = revF1();
    const readiness = await s.get('pm', `${P}/schedule/revisions/${rev}/readiness`);
    const verdict = hrS2Verdict(readiness, 'baseline', new Set(acts.zeroDuration));
    s.assert(verdict.verdict === 'ready', notReady(`the active F1 revision ${rev} is not ready for the baseline`, verdict), verdict.failing);
    const data = await s.act('baseline', 'pm', 'POST', `${P}/schedule/revisions/${rev}/baseline`, { comment: b.name('baseline locked for official reporting') }, {
      fields: { 'revision.status': 'baselined', locked: F1_CODES.length },
      verify: async (s2) => (await s2.get('pm', `${P}/schedule/revisions/${rev}`)).status === 'baselined',
    });
    return { revisionId: rev, locked: data?.locked ?? null };
  });

  await chain('gate.ready', async (s) => {
    const gate = await gateNow(s);
    s.assert(gate?.ready === true, 'the reporting gate is ready once the methods are configured and the baseline is locked', gate?.blockers);
    return { ready: true, warnings: (gate.warnings || []).map((w) => w.code) };
  });

  // January: locked normally, by finance, the gate ready [WP3.periods.jan: lock 'normal', cutoff, snapshot (AC per L34)]
  await chain('lock.2026-01', async (s) => {
    s.assert(leaf('periods.jan.lock').value === 'normal', `the book's WP3.periods.jan.lock is ${leaf('periods.jan.lock').value}`);
    await s.act('lock.2026-01', 'finance', 'POST', lockRoute(JAN), {}, {
      fields: { 'reporting.isSnapshot': true, 'reporting.snapshotId': is.present, 'reporting.period.code': JAN, readinessOverride: is.absent },
      verify: async (s2) => (await statusOf(s2, JAN)) === 'locked',
    });
    const snapshot = await read(s, `?periodId=${periodId(JAN)}`, { local: periodDef(JAN).cutoff, instant: leaf('periods.jan.cutoff').value, expected: metricsFrom('periods.jan.snapshot'), ref: 'L34' });
    s.assert(snapshot.reporting.isSnapshot === true && snapshot.readinessOverride === null, 'January is served from its snapshot, locked without an override', snapshot.reporting);
    return { snapshot };
  }, {
    verify: async (s) => (await statusOf(s, JAN)) === 'locked' || 'January is not locked',
  });
  await verdictOf('lock.2026-01');

  // After the locks: the back-dated cost and the new approval [WP3.periods.afterLock]
  /** The branch the T5 delete probe left: revisionKept after a refusal (BAC WP3.T5.bac), revisionDeleted after an audited delete or HEAD's silent L112 delete (BAC WP3.T1.bac). */
  const probeBranch = () => (revisionKept() ? 'revisionKept' : 'revisionDeleted');
  const branchLabel = () => `the T5 probe left the revision ${probeBranch() === 'revisionKept' ? 'approved' : 'deleted'}`;
  /**
   * The run-date read after the back-dated cost ('runDateAfterCost') or after the new approval
   * ('runDateAfterApproval'): the answer book's on-paper leaves (R2-B4, A10), never figures computed
   * here, in the branch the probe left.
   */
  const runDateAfter = (moment) => metricsFrom(`periods.afterLock.${moment}.${probeBranch()}`, `${moment === 'runDateAfterCost' ? 'after the back-dated cost' : 'after the new approval'}; ${branchLabel()}`);
  /**
   * The 2026-02-28 read after the back-dated cost: the book's leaves WP3.periods.afterLock.cutoffAfterCost
   * (round 3, R3-2), one set for both probe branches (the T5 revision is effective after this cutoff) and
   * for both after-lock reads (the new approval is stamped after the cutoff instant).
   */
  const cutoffAfterCost = () => metricsFrom('periods.afterLock.cutoffAfterCost', 'the 2026-02-28 read after the back-dated cost');
  const afterLock = (name, serves, { cutoff0228, todayExpected }) => chain(name, async (s) => {
    const period = await readFebPeriod(s, metricsFrom('periods.feb.snapshot'), 'L34');
    const reference = name === 'checkpoint.afterLock.before' ? null : b.out('checkpoint.afterLock.before').period.sha256;
    if (reference) s.assert(leaf('periods.afterLock.periodReport').value === 'byte_identical' && period.sha256 === reference, `WP3.periods.afterLock.periodReport ${leaf('periods.afterLock.periodReport').value}: February's report hashes ${period.sha256}, the reference ${reference}`);
    return {
      serves,
      capturedAt: new Date().toISOString(),
      period,
      cutoff0228: await readT3(s, cutoff0228(), 'L34'),
      today: await readToday(s, todayExpected()),
      hashReference: { step: 'checkpoint.afterLock.before', read: 'period', sha256: reference ?? period.sha256 },
    };
  });
  await afterLock('checkpoint.afterLock.before', 'WP3.periods.afterLock (before; the February hash reference)', { cutoff0228: () => metricsFrom('T3'), todayExpected: todayState });
  await verdictOf('checkpoint.afterLock.before');
  // 5,000 on A130 dated 2026-02-15 [WP3.periods.afterLock.backdatedCost, cutoffReportAc]
  await chain('cost.backdated', async (s) => ({ backdated: await directCost(s, 'cost.backdated', EV.backdatedAfterLock, 'back-dated after the February lock') }), { verify: verifyCosts });
  // the run-date read [WP3.periods.afterLock.runDateAfterCost.<branch>: AC 115,000.00, CPI 0.847826 alert]
  await afterLock('checkpoint.afterLock.afterCost', 'WP3.periods.afterLock (after the back-dated cost)', {
    cutoff0228: cutoffAfterCost,
    todayExpected: () => runDateAfter('runDateAfterCost'),
  });
  await verdictOf('checkpoint.afterLock.afterCost');
  // A120 approved 50 -> 60% [WP3.periods.afterLock.newApproval, cutoffReportEv 0, runDateEv 100,500.00]
  await chain('progress.afterLock', async (s) => {
    const [code, pct] = EV.approvalAfterLock;
    return { [code]: await progress(s, `progress.${code}.${pct}`, code, pct) };
  }, { verify: verifySubmissions });
  // the run-date read [WP3.periods.afterLock.runDateAfterApproval.<branch>: EV 100,500.00, AC 115,000.00, CPI 0.873913 alert]
  await afterLock('checkpoint.afterLock.afterApproval', 'WP3.periods.afterLock (after the new approval)', {
    cutoff0228: cutoffAfterCost,
    todayExpected: () => runDateAfter('runDateAfterApproval'),
  });
  await verdictOf('checkpoint.afterLock.afterApproval');
  b.note('Forecast is in process (WP-3 proof): nothing to build. The future period\'s lock before its cutoff (L113 / HR-E2), the relock, a loading in the locked period and the code/date refusals are the WP-3 proof\'s.');

  // ── T6: a 5,000 cost on A140, then the revision that retires A140 [WP3.T6] ──
  await chain('cost.A140', async (s) => {
    const [code, amount] = EV.a140Cost; // [A140, 5,000, 'run date']
    return { A140: await directCost(s, 'cost.A140', [code, amount, today], 'T6 cost before the retirement') };
  }, { verify: verifyCosts });
  /**
   * T6's run-date reads: the book's leaves WP3.T6.before / WP3.T6.after (round 3, R3-2; thirteen each,
   * built on WP3.T2.pv, WP3.periods.afterLock.runDateEv and WP3.T6.acBeforeRetirement / acAfterRetirement)
   * in the branch the T5 probe left, as the after-lock reads.
   */
  const t6State = (stage) => metricsFrom(`T6.${stage}.${probeBranch()}`, `${stage} the retirement; ${branchLabel()}`);
  // [WP3.T6.before.<branch>: AC 120,000.00 (acBeforeRetirement), ledgerDelta 5,000.00; EV = WP3.periods.afterLock.runDateEv]
  await checkpoint('checkpoint.T6.before', 'WP3.T6 (before the retirement)', async (s) => {
    const report = await readToday(s, t6State('before'));
    const delta = lib.toCents(report.figures.ac) - lib.toCents(b.out('checkpoint.afterLock.afterApproval').today.figures.ac);
    s.assert(delta === leaf('T6.ledgerDelta').value, `AC moved by ${delta} cents with the A140 cost; the book's WP3.T6.ledgerDelta is ${leaf('T6.ledgerDelta').value}`);
    return { ...report, ledgerDelta: delta };
  });

  const f1r = programmes.F1r();
  b.assert(!f1r.activities.some((a) => a.code === 'A140') && f1r.activities.length === F1_CODES.length - 1, 'F1r is F1 without A140');
  const importedR = await importProgramme('import.F1r', f1r, 'F1r-retires-A140.xer');
  const revF1r = () => importedR.revisionId;
  await submitRevision('submit.F1r', revF1r);
  await approveRevision('approve.F1r', revF1r);

  await chain('activate.F1r', async (s) => {
    const rev = revF1r();
    const a140 = acts.byCode.A140;
    const reason = b.name('T6: A140 retired by the revision (L118 / HR-S9 observation)');
    let payload = { mappings: [], unmappedRemovals: [{ oldActivityId: a140, reason }], comment: b.name('F1r activated: A140 retired') };
    const current = await s.get('pm', `${P}/schedule/revisions/${rev}`);
    if (!current.isActive) {
      const mapping = await s.get('pm', `${P}/schedule/revisions/${rev}/mapping`);
      const suggested = mapping.suggestedMappings || [];
      const kept = F1_CODES.filter((code) => code !== 'A140');
      s.assert(suggested.length === kept.length, `${kept.length} activities are suggested for mapping (found ${suggested.length})`, mapping.counts);
      s.assert(suggested.every((m) => m.oldActivity?.p6ActivityId && m.oldActivity.p6ActivityId === m.newActivity?.p6ActivityId), 'every suggestion maps an activity onto the one with its own code', suggested.map((m) => [m.oldActivity?.p6ActivityId, m.newActivity?.p6ActivityId, m.matchType]));
      s.assert(kept.every((code) => suggested.filter((m) => m.oldActivity?.p6ActivityId === code).length === 1 && m0(suggested, code).oldActivityId === acts.byCode[code]), 'each kept activity is suggested exactly once, from its own id', suggested.map((m) => [m.oldActivityId, m.oldActivity?.p6ActivityId]));
      s.assert((mapping.unmappedExisting || []).length === 1 && mapping.unmappedExisting[0].id === a140, 'A140 is the one active activity left unmapped', mapping.unmappedExisting);
      s.assert((mapping.newActivities || []).length === 0, 'the revision adds no activity', mapping.newActivities);
      payload = { ...payload, mappings: suggested.map((m) => ({ oldActivityId: m.oldActivityId, newActivityKey: m.newActivityKey })) };
    }
    const data = await s.act('activate.F1r', 'pm', 'POST', `${P}/schedule/revisions/${rev}/activate`, payload, {
      fields: { 'revision.isActive': true, 'activation.updatedActivities': is.count(F1_CODES.length - 1), 'activation.newActivities': is.count(0), 'activation.retiredActivities': (v) => (Array.isArray(v) && v.length === 1 && v[0] === a140) || 'A140 alone retired' },
      verify: async (s2) => Boolean((await s2.get('pm', `${P}/schedule/revisions/${rev}`)).isActive),
    });
    return { revisionId: rev, retired: data?.activation?.retiredActivities ?? [a140] };
  }, {
    verify: async (s, out) => {
      const rows = list(await s.get('planner', `${P}/activities`), 'items');
      return (Boolean((await s.get('pm', `${P}/schedule/revisions/${out.revisionId}`)).isActive) && !rows.some((a) => a.id === acts.byCode.A140)) || 'F1r is not the active revision, or A140 is active again';
    },
  });
  // [WP3.T6.after.<branch>: AC 120,000.00 (acAfterRetirement) and CPI 0.8375 (= cpiAfterRetirement); HEAD drops A140's 5,000 (L118 -> HR-S9: the leaves' today)]
  await checkpoint('checkpoint.T6.after', 'WP3.T6 (after the retirement)', (s) => readToday(s, t6State('after'), 'HR-S9'));
  await verdictOf('checkpoint.T6.after');
}

/** The one suggestion of a code (asserted unique by the caller). */
const m0 = (suggested, code) => suggested.find((m) => m.oldActivity?.p6ActivityId === code) || {};

module.exports = { build, PROGRAMMES, tasksOf, linksOf, summarise, hrS2Verdict, canonical, judgeFigures, metricsFrom, fromBook };

if (require.main === module) lib.main('087-EV', (b) => build(b));
