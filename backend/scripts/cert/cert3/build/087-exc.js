'use strict';

/**
 * CERT-3 deep company 087, project 087-EXC "CERT3 Controls" (plan §3.2, WP-9 T2-T4,
 * handling, notices, risk register, schedule history).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-exc.js [--fresh]
 *
 * Starts 2026-06-01 (a Monday), five-day calendar, EGP. Working days are counted on the
 * answer book's own calendar (answers/field-controls.js rules.addWorkingDays, through
 * kit-controls.js), never with the product's CPM code (builders' adjudication G7, R3-10).
 * The run date R is the build's company-local date (b.today); its working-day index is D. R must
 * be a weekday: a Saturday or Sunday has no index on the book's calendar, so the build fails closed.
 *
 *   schedule  an imported programme (no milestone), approved, activated, its baseline
 *             locked, then a later revision activated over it (WP9.history.*). X20, mapped
 *             to BOQ row Q2 with certification pending, has its baseline finish
 *             WP9.T3.slipMeasured (7) working days before R and 40% approved progress: the
 *             slip from the data date is 7 when the data date is R (X20 carries float, so
 *             the row is a warning: WP9.T3.slipSeverity).
 *   quantity  Q1 100 m3 allocated whole to X10 (quantity method); approved entries 60 + 45
 *             (WP9.T2/T2b.quantityFirst 105). STAGED for the proof, not approved: an entry of
 *             8 m3 bundled in a submitted progress submission (113 once approved,
 *             quantityLater*), and a change order CO-Q with an allocation link of +10 m3 on
 *             Q1/X10, submitted (110 once approved, quantityWithCo*). The proof approves them
 *             between its evaluations (105 warning -> 113 critical -> 113 against 110 warning).
 *   money     L1 10,000 against SC-1 10,500 executed (committedOverBudget*); L2 revised
 *             20,000 with a typed forecast of 23,000 (forecastOverRevised*; the exceedance
 *             the build fixes is 3,000.00); an IPC certified above earned value on a PM
 *             override (certifiedOverEarned*: IPC-2 claims one unit beyond the cap left once
 *             IPC-1 is certified); two approved change orders with the same description and
 *             activity impact (duplicateCo*); a budget revision linked to VO-999 (orphanLinkRows).
 *   periods   P1 (2026-06) past and locked; P2 past and unlocked, cutoff R - 9
 *             (WP9.T2c.periodUnlockedMeasured: 8 whole days past the end of its cutoff date at
 *             any instant of R in Africa/Cairo); P3 with a cutoff after R. Approved cost
 *             loadings (PV > 0); direct costs on both sides of P1's cutoff.
 *   risks     one per state (open with an overdue mitigation, monitoring, submitted, closed,
 *             archived), each linked to X40 (WP9.risk.mix, WP9.risk.activitySummary).
 *
 * The instants the WP-9 proofs measure from (R3-15). Two kinds:
 *   - the run date R. X20's slip (WP9.T3.slipMeasured 7) and P2's unlocked days
 *     (WP9.T2c.periodUnlockedMeasured 8) hold for an evaluation as of an instant of R in
 *     Africa/Cairo (or one injected as such) that is after the build's last progress approval:
 *     before it, X10 is unfinished and the slip rules measure it from the data date too.
 *   - the approvals' real timestamps (plan §3.3). progress_stale (WP9.T2c.staleMeasured 15)
 *     counts whole days from an activity's latest approvedAt to the cutoff (or to the clock),
 *     not from R, so the stale proof evaluates with cutoff = the latest approval + 15 days.
 *   Every activity's latest approvedAt, and the latest of them, are recorded in
 *   steps['controls.read'].out.approvals.
 *
 * Change events raised from an exception, voided and converted (plan §3.2) are not built:
 * an exception row exists only after an engine evaluation, which would be WP-9 T2's first.
 * The WP-9 handling proof raises, voids and converts them on this project (builders'
 * adjudication 087-EXC/HLT item 1; MOMENT-MAP).
 */

const lib = require('./lib');
const kit = require('./kit-controls');

const { is } = lib;
const FC = lib.answers.fieldControls;
const T2 = FC.WP9['T2/T2b'];
const T2C = FC.WP9.T2c;
const T3 = FC.WP9.T3;

const START = '2026-06-01';
const FIVE = 'five_day';

lib.main('087-EXC', async (b) => {
  const R = b.today;
  // Fail closed on a Saturday or Sunday run date (round 2, R2-F): the book's five-day calendar gives it no index.
  b.assert(kit.isWorkingDay(R), `the run date ${R} is a weekday: a Saturday or Sunday has no working-day index on the answer book's five-day calendar, so WP9.T3.slipMeasured (${T3.slipMeasured.value}) cannot be placed from it; build on a weekday`);
  const D = kit.workingDayOf(START, R); // the run date's working-day index on the answer book's calendar
  b.assert(Number.isInteger(D) && D >= 40, `the run date ${R} is working day ${D} of a programme starting ${START} (at least 40 needed)`);
  const X20_EF = D - T3.slipMeasured.value; // WP9.T3.slipMeasured: data-date index D - baseline finish = 7
  const X20_BF_DATE = kit.dateOfWorkingDay(START, X20_EF);
  // WP9.T2c.periodUnlockedMeasured: floor((at - end of the cutoff date) / day) = 8 at any instant of R.
  const P2_CUTOFF = kit.addDays(R, -(T2C.periodUnlockedMeasured.value + 1));
  const P3_END = b.date(22, { future: true });
  b.note(`run date ${R} = working day ${D} from ${START} (answer-book calendar); X20 baseline finish index ${X20_EF} (${X20_BF_DATE}); P2 cutoff ${P2_CUTOFF}; P3 cutoff ${P3_END}`);

  // The project's end: after the programme's (R1 ends at working day D + 50). The official
  // reporting gate refuses a period lock while it is missing (PROJECT_END_MISSING).
  const END = kit.dateOfWorkingDay(START, D + 60);
  const DURATION_DAYS = Math.round((Date.parse(`${END}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / kit.DAY_MS);
  await b.project({
    title: 'Controls',
    payload: { startDate: START, endDate: END, duration: DURATION_DAYS, durationUnit: 'days', projectCalendar: FIVE, currency: 'EGP', type: 'building', contractType: 'unit_rate', contractValue: 150000, defaultRetentionRate: 5, location: b.name('Controls site') },
    fields: { projectCalendar: FIVE, currency: 'EGP', startDate: is.day(START) },
  });
  const P = b.P;
  // Asserted (and set, on a project adopted from an earlier run): end date and duration.
  await b.step('project.profile', async (s) => {
    const data = await s.act('project.profile', 'pm', 'PATCH', `/projects/${b.projectId}`, { endDate: END, duration: DURATION_DAYS, durationUnit: 'days' }, {
      fields: { endDate: is.day(END), duration: DURATION_DAYS },
      verify: async (s2) => String((await s2.get('pm', `/projects/${b.projectId}`)).endDate || '').slice(0, 10) === END,
    });
    return { endDate: END, duration: data?.duration ?? DURATION_DAYS };
  });
  await b.team({ planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', site: 'site_engineer', finance: 'finance' });
  const ids = {};
  for (const key of ['pm', 'planner', 'qs', 'site', 'cost', 'finance']) ids[key] = await b.userId(key);

  // ── budget lines: L1 (subcontract 10,000), L2 (material 20,000, forecast 23,000), L3 ─
  const LINES = {
    L1: { code: '03-100', costType: 'subcontract', original: 10000 },
    L2: { code: '02-100', costType: 'material', original: 20000 },
    L3: { code: '01-100', costType: 'labour', original: 120000 },
  };
  const budget = await b.step('budget', async (s) => {
    const codes = await kit.companyCostCodes(s, 'pm', Object.values(LINES).map((l) => l.code));
    await s.act('budget.costcodes', 'pm', 'PUT', `${P}/budget/cost-codes`, { costCodeIds: Object.values(codes) }, {
      fields: { items: (v, d) => Object.keys(codes).every((c) => kit.rows(d).some((r) => r.code === c)) || 'the project selection lists 01-100, 02-100 and 03-100' },
      verify: async (s2) => {
        const selected = kit.rows(await s2.get('pm', `${P}/budget/cost-codes`));
        return Object.keys(codes).every((c) => selected.some((r) => r.code === c));
      },
    });
    const out = { codes };
    for (const [key, l] of Object.entries(LINES)) {
      const description = b.name(`${key} budget line`);
      const row = await s.create(`budget.${key}`, 'cost', `${P}/budget/lines`, {
        costCodeId: codes[l.code], costType: l.costType, description, originalBudget: l.original, status: 'active',
      }, {
        fields: { description, costType: l.costType, originalBudget: is.cents(l.original), revisedBudget: is.cents(l.original) },
        get: (id) => `${P}/budget/lines/${id}`,
        find: async (s2) => kit.findRow(s2, 'cost', `${P}/budget/lines`, (x) => x.description === description),
      });
      out[key] = { id: row.id, costCodeId: codes[l.code], costType: l.costType };
    }
    // L2's typed forecast (WP9.T2/T2b.forecastOverRevisedSeverity: 23,000 against revised 20,000).
    await s.act('budget.L2.forecast', 'cost', 'PATCH', `${P}/budget/lines/${out.L2.id}`, { forecast: 23000 }, {
      fields: { forecast: is.cents(23000), forecastIsManual: true, revisedBudget: is.cents(20000) },
      verify: async (s2) => Number((await s2.get('cost', `${P}/budget/lines/${out.L2.id}`)).forecast) === 23000,
    });
    return out;
  });

  // ── the programme: R1 imported, approved, activated (baseline later) ────────
  const wbs = { EXC: '1 Controls works' };
  const task = (code, name, days) => ({ code, name: `${code} ${name} (${b.code})`, wbs: 'EXC', hours: days * 8 });
  const R1 = lib.files.programme({
    name: 'EXC-R1',
    start: START,
    wbs,
    tasks: [
      task('X05', 'Site establishment', 10),
      task('X10', 'Q1 concrete pour', 10),
      task('X20', 'Structure works', X20_EF - 20),
      task('X30', 'Certified works', D),
      task('X40', 'Finishing works', 20),
      task('X50', 'Plant installation', D + 40),
    ],
    links: [
      { pred: 'X05', succ: 'X10' }, { pred: 'X10', succ: 'X20' }, { pred: 'X05', succ: 'X30' },
      { pred: 'X20', succ: 'X40' }, { pred: 'X05', succ: 'X50' },
    ],
    note: '087-EXC R1: X20 ends 7 working days before the run date; X05 -> X50 is the critical path',
  });
  const R2 = lib.files.programme({
    name: 'EXC-R2',
    start: START,
    wbs,
    tasks: [...R1.activities.map((a) => ({ code: a.code, name: a.name, wbs: 'EXC', hours: a.code === 'X40' ? 23 * 8 : a.hours })), task('X60', 'Snagging', 5)],
    links: [...R1.links.map((l) => ({ pred: l.pred, succ: l.succ })), { pred: 'X40', succ: 'X60' }],
    note: '087-EXC R2: X40 20 -> 23 days and a new X60 after it; every R1 activity keeps its id',
  });
  const r1x20 = R1.activities.find((a) => a.code === 'X20');
  b.assert(r1x20.ef === X20_EF && r1x20.tf > 0, `R1: X20 early finish ${r1x20.ef} = ${X20_EF} with float ${r1x20.tf} (not critical)`);

  const revisionsOf = async (s) => kit.rows(await s.get('planner', `${P}/schedule/revisions`));
  /** A staged revision's identity: its snapshot holds exactly this programme's activities (codes and names; the names carry the build code). */
  const holdsProgramme = (rev, model) => {
    const staged = rev?.snapshotJson?.activities || [];
    const wanted = new Map(model.activities.map((a) => [a.code, a.name]));
    return staged.length === wanted.size && staged.every((a) => wanted.get(a.p6ActivityId) === a.name);
  };
  const importRevision = async (s, tag, model) => {
    const file = lib.files.xer(model, { filename: b.file(`${tag}.xer`) });
    const data = await s.upload(`schedule.${tag}.import`, 'planner', `${P}/import/xer`, file, {
      expect: [200, 201],
      idOf: (d) => d?.revisionId ?? null,
      get: (id) => `${P}/schedule/revisions/${id}`,
      fields: { staged: true, revisionId: is.present, imported: model.activities.length },
      // An interrupted import: the XER revision whose staged activities are exactly this
      // programme's (a revision's label does not carry the file name; a second import would
      // supersede the first). Two such revisions would be a duplicate: the build stops.
      find: async (s2) => {
        const candidates = (await revisionsOf(s2)).filter((r) => r.source === 'xer' && Number(r.activityCount) === model.activities.length);
        const read = [];
        for (const r of candidates) read.push(await s2.get('planner', `${P}/schedule/revisions/${r.id}`));
        const rev = kit.only(s2, read, (r) => holdsProgramme(r, model), `the staged ${tag} import`);
        return rev ? { ...rev, revisionId: rev.id, staged: true, imported: rev.activityCount } : null;
      },
    });
    return data.revisionId || data.id;
  };
  const revisionStatus = async (s, id) => (await s.get('planner', `${P}/schedule/revisions/${id}`)).status;
  const submitAndApprove = async (s, tag, rid) => {
    await s.act(`schedule.${tag}.submit`, 'planner', 'POST', `${P}/schedule/revisions/${rid}/submit-review`, { comment: b.ref(`${tag}-submit`) }, {
      fields: { status: 'under_review' },
      verify: async (s2) => ['under_review', 'approved', 'active', 'baselined'].includes(await revisionStatus(s2, rid)),
    });
    await s.act(`schedule.${tag}.approve`, 'pm', 'POST', `${P}/schedule/revisions/${rid}/approve`, { comment: b.ref(`${tag}-approve`) }, {
      fields: { status: 'approved' },
      verify: async (s2) => ['approved', 'active', 'baselined'].includes(await revisionStatus(s2, rid)),
    });
  };
  /** The active activities by code; one activity per code (G6). */
  const activitiesByCode = async (s) => {
    const out = {};
    for (const a of kit.rows(await s.get('planner', `${P}/activities`))) {
      const code = a.activityCode || a.p6ActivityId;
      if (a.isActive === false || !code) continue;
      s.assert(!out[code], `one active activity carries the code ${code}, not two (${out[code]?.id}, ${a.id})`);
      out[code] = a;
    }
    return out;
  };

  const r1 = await b.step('schedule.R1', async (s) => {
    const rid = await importRevision(s, 'R1', R1);
    await submitAndApprove(s, 'R1', rid);
    await s.act('schedule.R1.activate', 'pm', 'POST', `${P}/schedule/revisions/${rid}/activate`, { mappings: [], comment: b.ref('R1-activate') }, {
      fields: { 'revision.isActive': true },
      verify: async (s2) => (await s2.get('planner', `${P}/schedule/revisions/${rid}`)).isActive === true,
    });
    const acts = await activitiesByCode(s);
    const out = { revisionId: rid, ids: {} };
    for (const a of R1.activities) {
      const row = acts[a.code];
      s.assert(Boolean(row), `activated R1 carries ${a.code}`);
      s.expectFields(row, { earlyStart: a.es, earlyFinish: a.ef, totalFloat: a.tf }, `${a.code} CPM after activation`);
      out.ids[a.code] = row.id;
    }
    return out;
  });
  const act = r1.ids;

  // Site engineer on the measured activities; every activity's progress method configured.
  const engineersOf = async (s2, code) => ((await s2.get('planner', `${P}/activities/${act[code]}`)).assignedEngineers || []).map((e) => e.id);
  await b.step('activities.setup', async (s) => {
    for (const code of ['X05', 'X10', 'X20', 'X30']) {
      await s.act(`engineer.${code}`, 'planner', 'PATCH', `${P}/activities/${act[code]}`, { engineerIds: [ids.site] }, {
        fields: { id: act[code], assignedEngineers: (v) => (Array.isArray(v) && v.some((e) => e.id === ids.site)) || 'the site engineer assigned' },
        verify: async (s2) => (await engineersOf(s2, code)).includes(ids.site),
      });
    }
    for (const code of ['X05', 'X10', 'X20', 'X30', 'X40', 'X50']) {
      const body = code === 'X10'
        ? { method: 'quantity', plannedQuantity: 100, quantityUnit: 'm3', notes: b.ref('method-X10') }
        : { method: 'percent', notes: b.ref(`method-${code}`) };
      await s.act(`method.${code}`, 'planner', 'PUT', `${P}/activities/${act[code]}/progress-method`, body, {
        fields: { method: body.method },
        verify: async (s2) => (await s2.get('planner', `${P}/activities/${act[code]}/progress-method`)).method === body.method,
      });
    }
    return { methods: { X10: 'quantity' } };
  });

  // ── BOQ: Q1 (X10), Q2 (X20), Q3 (X30), each allocated whole and approved ─────
  const ROWS = [
    { code: 'Q1', act: 'X10', description: 'Q1 structural concrete', unit: 'm3', quantity: 100, rate: 400 }, // 40,000
    { code: 'Q2', act: 'X20', description: 'Q2 structure works', unit: 'm2', quantity: 200, rate: 300 }, // 60,000
    { code: 'Q3', act: 'X30', description: 'Q3 certified works', unit: 'm3', quantity: 100, rate: 500 }, // 50,000
  ];
  const boq = await b.step('boq', async (s) => {
    const out = {};
    for (const r of ROWS) {
      const description = `${r.description} (${b.code})`;
      const data = await s.create(`boq.${r.code}`, 'qs', `${P}/boq/items`, { code: r.code, description, quantity: r.quantity, unit: r.unit, rate: r.rate }, {
        fields: { 'item.code': r.code, 'item.amount': is.cents(r.quantity * r.rate) },
        get: null,
        find: async (s2) => {
          const row = kit.only(s2, kit.rows(await s2.get('qs', `${P}/boq`)), (i) => i.code === r.code && i.description === description, `BOQ row ${r.code}`);
          return row ? { item: row } : null;
        },
      });
      out[r.code] = data.item?.id || data.id;
    }
    return out;
  }, {
    verify: async (s, out) => {
      const items = kit.rows(await s.get('qs', `${P}/boq`));
      for (const r of ROWS) if (!items.some((i) => i.id === out[r.code])) return `BOQ row ${r.code} is not on the bill`;
      return true;
    },
  });
  const allocList = async (s) => kit.rows(await s.get('qs', `${P}/activity-boq-allocations`));
  const alloc = await b.step('allocations', async (s) => {
    const out = {};
    for (const r of ROWS) {
      const amount = r.quantity * r.rate;
      const created = await s.create(`alloc.${r.code}`, 'planner', `${P}/activity-boq-allocations`, {
        boqItemId: boq[r.code], activityId: act[r.act], quantity: r.quantity, amount, source: 'manual', notes: b.ref(`alloc-${r.code}`),
      }, {
        idOf: (d) => d?.id ?? d?.allocation?.id ?? null,
        fields: { quantity: is.number(r.quantity), amount: is.cents(amount) },
        get: null,
        find: async (s2) => kit.only(s2, await allocList(s2), (x) => x.boqItemId === boq[r.code] && x.activityId === act[r.act] && x.isActive !== false, `the allocation of ${r.code} to ${r.act}`),
      });
      const id = created?.id ?? created?.allocation?.id;
      await s.act(`alloc.${r.code}.submit`, 'planner', 'POST', `${P}/activity-boq-allocations/${id}/submit`, {}, {
        fields: { status: 'submitted' },
        verify: async (s2) => ['submitted', 'approved'].includes((await allocList(s2)).find((x) => x.id === id)?.status),
      });
      await s.act(`alloc.${r.code}.approve`, 'qs', 'POST', `${P}/activity-boq-allocations/${id}/approve`, {}, {
        fields: { status: 'approved' },
        verify: async (s2) => (await allocList(s2)).find((x) => x.id === id)?.status === 'approved',
      });
      out[r.code] = id;
    }
    return out;
  }, {
    verify: async (s, out) => {
      const list = await allocList(s);
      for (const r of ROWS) if (list.find((x) => x.id === out[r.code])?.status !== 'approved') return `allocation ${r.code} is not approved`;
      return true;
    },
  });

  // ── the baseline, locked on R1 (baseline = early dates) ─────────────────────
  await b.step('baseline', async (s) => {
    // `locked` is the number of activities whose baseline was locked: all 6 of R1.
    const data = await s.act('schedule.R1.baseline', 'pm', 'POST', `${P}/schedule/revisions/${r1.revisionId}/baseline`, { comment: b.ref('R1-baseline') }, {
      fields: { locked: R1.activities.length, 'revision.status': 'baselined', 'revision.isActive': true },
      verify: async (s2) => (await revisionStatus(s2, r1.revisionId)) === 'baselined',
    });
    const x20 = await s.get('planner', `${P}/activities/${act.X20}`);
    // GET /activities/:id gives the baseline as a date; the expected date is the answer book's calendar's.
    s.expectFields(x20, { baselineFinishDate: is.day(X20_BF_DATE), earlyFinish: X20_EF, isCritical: false }, `X20 baseline (WP9.T3: slip from the data date = D - baseline finish = ${T3.slipMeasured.value})`);
    return { status: data?.revision?.status ?? null, x20BaselineFinish: X20_EF, x20BaselineFinishDate: X20_BF_DATE };
  }, { needs: ['allocations', 'activities.setup'] });

  // ── approved progress: X05 100, X20 40, X30 60 (percent) ────────────────────
  const subsOf = async (s, code) => kit.rows(await s.get('planner', `${P}/activities/${act[code]}/progress-submissions`));
  const submitProgress = async (s, name, code, body) => {
    await s.create(name, 'site', `${P}/activities/${act[code]}/progress`, body, {
      expect: [200, 201],
      idOf: (d) => d?.submission?.id ?? null,
      fields: { 'submission.status': 'submitted' },
      get: null, // re-read live by the step's verify
      find: async (s2) => {
        const row = kit.only(s2, await subsOf(s2, code), (x) => x.notes === body.notes, `the progress submission ${name}`);
        return row ? { submission: row } : null;
      },
    });
    return b.id(name); // the recorded id (a stored answer may be kept only in part)
  };
  const approveProgress = async (s, name, code, sid) =>
    s.act(name, 'planner', 'POST', `${P}/activities/${act[code]}/progress-submissions/${sid}/approve`, {}, {
      fields: { status: 'approved' },
      verify: async (s2) => (await subsOf(s2, code)).find((x) => x.id === sid)?.status === 'approved',
    });
  /** A step verify: each recorded submission is live with its status. */
  const submissionsHold = async (s, wanted) => {
    for (const [label, { code, id, status }] of Object.entries(wanted)) {
      const row = (await subsOf(s, code)).find((x) => x.id === id);
      if (row?.status !== status) return `${label} (${id}) on ${code} is ${row?.status ?? 'missing'}, not ${status}`;
    }
    return true;
  };
  const PROGRESS = [['X05', 100], ['X20', 40], ['X30', 60]];
  await b.step('progress', async (s) => {
    const out = {};
    for (const [code, pct] of PROGRESS) {
      const sid = await submitProgress(s, `progress.${code}`, code, { pctComplete: pct, progressMethod: 'percent', status: 'submitted', source: 'manual', notes: `${b.ref(`progress-${code}`)} measured on site` });
      await approveProgress(s, `progress.${code}.approve`, code, sid);
      out[code] = sid;
    }
    return out;
  }, {
    needs: ['baseline'],
    verify: async (s, out) => submissionsHold(s, Object.fromEntries(PROGRESS.map(([code]) => [`progress ${code}`, { code, id: out[code], status: 'approved' }]))),
  });

  // ── quantities on X10 / Q1: 60 + 45 approved; 8 more staged (submitted) ─────
  const quantity = await b.step('quantity', async (s) => {
    const entry = async (name, qty, date) => {
      b.past(date);
      const clientRequestId = b.ref(name);
      const data = await s.create(name, 'site', `${P}/quantity-progress`, {
        activityId: act.X10, boqItemId: boq.Q1, quantity: qty, unit: 'm3', date, status: 'submitted', note: b.ref(name), clientRequestId,
      }, {
        expect: [201, 200],
        idOf: (d) => d?.entry?.id ?? null,
        fields: { 'entry.quantity': is.number(qty), 'entry.status': 'submitted' },
        get: (id) => `${P}/quantity-progress/${id}`,
        // Interrupted: the entry this request made, found by its clientRequestId (never sent again).
        find: async (s2) => {
          const row = kit.only(s2, kit.rows(await s2.get('site', `${P}/quantity-progress?activityId=${act.X10}`)), (x) => x.clientRequestId === clientRequestId, `the quantity entry ${name}`);
          return row ? { entry: row } : null;
        },
      });
      return data.entry?.id ?? data.id;
    };
    const bundle = async (name, entryIds) => submitProgress(s, name, 'X10', { progressMethod: 'quantity', status: 'submitted', source: 'manual', entryIds, notes: `${b.ref(name)} quantity bundle` });
    const e60 = await entry('qty.e60', 60, '2026-06-17');
    const s60 = await bundle('qty.s60', [e60]);
    await approveProgress(s, 'qty.s60.approve', 'X10', s60);
    const e45 = await entry('qty.e45', 45, '2026-06-24');
    const s45 = await bundle('qty.s45', [e45]);
    await approveProgress(s, 'qty.s45.approve', 'X10', s45);
    // STAGED for WP-9 T2 (not approved here): +8 m3 takes installed from 105 to 113 once the proof approves it.
    const e8 = await entry('qty.e8.staged', 8, '2026-06-26');
    const s8 = await bundle('qty.s8.staged', [e8]);
    return { entries: { e60, e45, e8 }, submissions: { s60, s45 }, staged: { entryId: e8, submissionId: s8, approveRoute: `${P}/activities/${act.X10}/progress-submissions/${s8}/approve`, installedAfter: T2.quantityLaterExceedance.value + 100 } };
  }, {
    needs: ['progress'],
    verify: async (s, out) => submissionsHold(s, {
      'bundle 60': { code: 'X10', id: out.submissions.s60, status: 'approved' },
      'bundle 45': { code: 'X10', id: out.submissions.s45, status: 'approved' },
      'staged bundle 8': { code: 'X10', id: out.staged.submissionId, status: 'submitted' },
    }),
  });

  // ── PV: approved cost loadings ──────────────────────────────────────────────
  const LOADINGS = [['X05', 10000, '2026-06-10'], ['X10', 40000, '2026-06-26'], ['X30', 25000, '2026-07-31'], ['X20', 30000, '2026-08-14']];
  const loadingList = async (s2) => kit.rows(await s2.get('cost', `${P}/reports/cost-loading`));
  await b.step('loadings', async (s) => {
    const out = {};
    for (const [code, value, date] of LOADINGS) {
      b.past(date);
      const notes = b.ref(`pv-${code}`);
      const row = await s.create(`loading.${code}`, 'cost', `${P}/reports/cost-loading`, {
        activityId: act[code], plannedDate: date, plannedValue: value, source: 'manual', status: 'draft', notes,
      }, {
        fields: { status: 'draft', plannedValue: is.cents(value), plannedDate: is.day(date) },
        get: null, // re-read live by the step's verify
        find: async (s2) => kit.only(s2, await loadingList(s2), (x) => x.notes === notes, `the cost loading ${notes}`),
      });
      await s.act(`loading.${code}.submit`, 'cost', 'POST', `${P}/reports/cost-loading/${row.id}/submit`, {}, {
        fields: { status: 'submitted' },
        verify: async (s2) => ['submitted', 'approved'].includes((await loadingList(s2)).find((x) => x.id === row.id)?.status),
      });
      await s.act(`loading.${code}.approve`, 'finance', 'POST', `${P}/reports/cost-loading/${row.id}/approve`, {}, {
        fields: { status: 'approved' },
        verify: async (s2) => (await loadingList(s2)).find((x) => x.id === row.id)?.status === 'approved',
      });
      out[code] = row.id;
    }
    return out;
  }, {
    verify: async (s, out) => {
      const list = await loadingList(s);
      for (const [code, value] of LOADINGS) {
        const row = list.find((x) => x.id === out[code]);
        if (row?.status !== 'approved' || Number(row.plannedValue) !== value) return `the cost loading on ${code} is ${row?.status ?? 'missing'} (${row?.plannedValue})`;
      }
      return true;
    },
  });

  // ── AC: direct costs on both sides of P1's cutoff (2026-06-30) ──────────────
  const COSTS = [['X05a', 'X05', 6000, '2026-06-20'], ['X05b', 'X05', 4000, '2026-07-15'], ['X20', 'X20', 20000, '2026-08-20']];
  await b.step('costs', async (s) => {
    const out = {};
    for (const [key, code, amount, date] of COSTS) {
      b.past(date);
      const description = b.name(`Actual cost ${key}`);
      const row = await s.create(`cost.${key}`, 'cost', `${P}/direct-costs`, {
        type: 'invoice', description, costDate: date, receivedDate: date, vendorName: b.name('Controls supplier'), invoiceNumber: b.ref(`INV-${key}`), notes: b.ref(`ac-${key}`),
        lines: [{ description: `${key} works (${b.code})`, costCodeId: budget.L3.costCodeId, budgetLineId: budget.L3.id, activityId: act[code], costType: budget.L3.costType, quantity: 1, unit: 'item', unitCost: amount, amount }],
      }, {
        fields: { description, status: 'draft', total: is.cents(amount) },
        get: (id) => `${P}/direct-costs/${id}`,
        find: async (s2) => kit.findRow(s2, 'cost', `${P}/direct-costs`, (x) => x.description === description),
      });
      await s.act(`cost.${key}.submit`, 'cost', 'POST', `${P}/direct-costs/${row.id}/submit`, {}, {
        fields: { status: 'pending' },
        verify: async (s2) => ['pending', 'approved'].includes((await s2.get('cost', `${P}/direct-costs/${row.id}`)).status),
      });
      await s.act(`cost.${key}.approve`, 'finance', 'POST', `${P}/direct-costs/${row.id}/approve`, {}, {
        fields: { status: 'approved' },
        verify: async (s2) => (await s2.get('cost', `${P}/direct-costs/${row.id}`)).status === 'approved',
      });
      out[key] = row.id;
    }
    return out;
  });

  // ── reporting periods: P1 past and locked, P2 past and unlocked, P3 future ──
  const PERIODS = [
    { key: 'P1', start: '2026-06-01', end: '2026-06-30', cutoff: '2026-06-30', status: 'locked' },
    { key: 'P2', start: '2026-07-01', end: P2_CUTOFF, cutoff: P2_CUTOFF, status: 'open' },
    { key: 'P3', start: kit.addDays(P2_CUTOFF, 1), end: P3_END, cutoff: P3_END, status: 'open' },
  ];
  const periodList = async (s2) => kit.rows(await s2.get('cost', `${P}/reports/periods`));
  const periods = await b.step('periods', async (s) => {
    const out = {};
    for (const p of PERIODS) {
      const code = b.ref(p.key);
      const row = await s.create(`period.${p.key}`, 'cost', `${P}/reports/periods`, {
        code, label: b.name(`Period ${p.key}`), periodStart: p.start, periodEnd: p.end, cutoffDate: p.cutoff,
      }, {
        fields: { code, cutoffLocalDate: p.cutoff },
        get: null, // re-read live by the step's verify
        find: async (s2) => kit.only(s2, await periodList(s2), (x) => x.code === code, `the reporting period ${code}`),
      });
      out[p.key] = row.id;
    }
    const gate = (await s.get('pm', `/projects/${b.projectId}/setup-readiness`))?.gates?.reporting || null;
    b.note(`reporting gate before the P1 lock: ready ${gate?.ready}; blockers ${JSON.stringify((gate?.blockers || []).map((x) => x.code))}`);
    await s.act('period.P1.lock', 'finance', 'POST', `${P}/reports/periods/${out.P1}/lock`, {}, {
      fields: { 'reporting.isSnapshot': true },
      verify: async (s2) => (await periodList(s2)).find((x) => x.id === out.P1)?.status === 'locked',
    });
    const after = await periodList(s);
    s.expectFields(Object.fromEntries(PERIODS.map((p) => [p.key, after.find((x) => x.id === out[p.key])?.status])), Object.fromEntries(PERIODS.map((p) => [p.key, p.status])), 'period statuses');
    return out;
  }, {
    needs: ['loadings', 'costs'],
    verify: async (s, out) => {
      const list = await periodList(s);
      for (const p of PERIODS) {
        const row = list.find((x) => x.id === out[p.key]);
        if (row?.status !== p.status || row.code !== b.ref(p.key)) return `period ${p.key} is ${row?.status ?? 'missing'}, not ${p.status}`;
      }
      return true;
    },
  });

  // ── SC-1: a subcontract of 10,500 on L1, executed (committed 10,500 > 10,000) ─
  await b.step('commitment', async (s) => {
    const vendorName = b.name('Controls blockwork subcontractor');
    const vendor = await s.create('vendor', 'pm', '/companies', { name: vendorName, type: 'external', status: 'active', email: `exc.vendor@parties.c087.octapm-cert.test` }, {
      fields: { name: vendorName, type: 'external' },
      get: `/companies?limit=100&search=${encodeURIComponent(vendorName)}`,
      adopt: true,
      find: async (s2) => kit.findRow(s2, 'pm', `/companies?limit=100&search=${encodeURIComponent(vendorName)}`, (c) => c.name === vendorName),
    });
    const title = b.name('SC-1 blockwork subcontract');
    const list = async (s2) => kit.rows(await s2.get('qs', `${P}/commitments`));
    const sc = await s.create('sc1', 'qs', `${P}/commitments`, {
      type: 'subcontract', title, description: b.ref('SC-1'), vendorCompanyId: vendor.id, retentionRate: 5, paymentTerms: `30 days (${b.code})`,
      startDate: START, endDate: b.date(120, { future: true }), notes: b.ref('SC-1'),
      lines: [{ lineNumber: 1, description: `Blockwork lump sum (${b.code})`, costCodeId: budget.L1.costCodeId, budgetLineId: budget.L1.id, unit: 'sum', qty: 1, amount: 10500 }],
    }, {
      fields: { title, status: 'draft' },
      get: (id) => `${P}/commitments/${id}`,
      find: async (s2) => kit.only(s2, await list(s2), (x) => x.title === title, `the commitment ${title}`),
    });
    const status = async (s2) => (await s2.get('qs', `${P}/commitments/${sc.id}`)).status;
    await s.act('sc1.submit', 'qs', 'POST', `${P}/commitments/${sc.id}/submit`, {}, {
      fields: { status: 'pending' },
      verify: async (s2) => ['pending', 'approved', 'executed'].includes(await status(s2)),
    });
    await s.act('sc1.approve', 'pm', 'POST', `${P}/commitments/${sc.id}/approve`, {}, {
      fields: { status: 'approved' },
      verify: async (s2) => ['approved', 'executed'].includes(await status(s2)),
    });
    const executed = await s.upload('sc1.execute', 'pm', `${P}/commitments/${sc.id}/execute`, kit.pdfFile(b, 'SC-1-signed'), {
      expect: 200,
      field: 'file',
      idOf: (d) => d?.id ?? null,
      get: (id) => `${P}/commitments/${id}`,
      fields: { status: 'executed' },
      find: async (s2) => ((await status(s2)) === 'executed' ? s2.get('qs', `${P}/commitments/${sc.id}`) : null),
    });
    const l1 = await s.get('cost', `${P}/budget/lines/${budget.L1.id}`);
    s.expectFields(l1, { committed: is.cents(10500), revisedBudget: is.cents(10000) }, 'L1 after SC-1 (WP9.T2/T2b.committedOverBudget*)');
    return { vendorId: vendor.id, commitmentId: sc.id, status: executed.status };
  });

  // ── the IPC certified above earned value on a PM override ───────────────────
  const ipc = await b.step('ipc', async (s) => {
    await s.act('contract.terms', 'pm', 'PATCH', `${P}/prime-contract`, { title: b.name('Client contract'), retentionRate: 5, notes: b.ref('contract') }, {
      fields: { retentionRate: is.number(5), originalValueSource: 'project_value' },
      verify: async (s2) => Number((await s2.get('qs', `${P}/prime-contract`)).retentionRate) === 5,
    });
    const labels = { one: b.ref('IPC-1'), two: b.ref('IPC-2') };
    const route = (label) => `${P}/ipc/${encodeURIComponent(label)}`;
    const certificate = async (name, label) => s.create(name, 'qs', `${P}/ipc`, { period: label }, {
      fields: { period: label, status: 'draft' },
      get: () => route(label),
      find: async (s2) => kit.only(s2, kit.rows(await s2.get('qs', `${P}/ipc`)), (x) => x.period === label, `the certificate ${label}`),
    });
    const q3Item = (cert) => kit.exactlyOne(s, cert.items || [], (i) => i.allocationId === alloc.Q3, 'the certificate item on Q3 / X30');
    const one = await certificate('ipc.one', labels.one);
    const itemOne = q3Item(one);
    // X30 is 60% approved on a 50,000 allocation: the cap is 30,000 = 60 m3 x 500.
    await s.act('ipc.one.item', 'qs', 'PATCH', `${route(labels.one)}/items/${itemOne.id}`, { qty: 60 }, {
      fields: { currentCert: is.cents(30000) },
      verify: async (s2) => Number(q3Item(await s2.get('qs', route(labels.one))).qty) === 60,
    });
    // IPC-2 claims one more unit while IPC-1 is still a draft (within the cap until IPC-1 is certified).
    const two = await certificate('ipc.two', labels.two);
    const itemTwo = q3Item(two);
    await s.act('ipc.two.item', 'qs', 'PATCH', `${route(labels.two)}/items/${itemTwo.id}`, { qty: 1 }, {
      fields: { currentCert: is.cents(500) },
      verify: async (s2) => Number(q3Item(await s2.get('qs', route(labels.two))).qty) === 1,
    });
    const statusOf = async (s2, label) => (await s2.get('qs', route(label))).status;
    await s.act('ipc.one.submit', 'qs', 'POST', `${route(labels.one)}/submit`, {}, {
      fields: { status: 'submitted' },
      verify: async (s2) => ['submitted', 'certified'].includes(await statusOf(s2, labels.one)),
    });
    await s.act('ipc.one.certify', 'pm', 'POST', `${route(labels.one)}/certify`, { comment: b.ref('IPC-1-certify') }, {
      fields: { status: 'certified', overCertificationAmount: is.cents(0) },
      verify: async (s2) => (await statusOf(s2, labels.one)) === 'certified',
    });
    await s.act('ipc.two.submit', 'qs', 'POST', `${route(labels.two)}/submit`, {}, {
      fields: { status: 'submitted' },
      verify: async (s2) => ['submitted', 'certified'].includes(await statusOf(s2, labels.two)),
    });
    await s.act('ipc.two.certify', 'pm', 'POST', `${route(labels.two)}/certify`, {
      comment: b.ref('IPC-2-certify'), overrideReason: `PM override: certified one unit ahead of the progress record (${b.code})`,
    }, {
      fields: { status: 'certified', overCertificationAmount: is.cents(500), certificationOverrideReason: is.present },
      verify: async (s2) => (await statusOf(s2, labels.two)) === 'certified',
    });
    // Read back (an adopted transition answers no data): WP9.T2/T2b.certifiedOverEarned*, one
    // critical row, measured = the stored 500.00 (the build's figure).
    const certified = s.expectFields(await s.get('qs', route(labels.two)), { status: 'certified', overCertificationAmount: is.cents(500) }, 'IPC-2 as certified');
    return { labels, overCertificationAmount: Number(certified.overCertificationAmount) };
  }, { needs: ['progress', 'allocations'] });

  // ── change orders: two duplicates (approved), CO-Q +10 m3 (staged: submitted) ─
  const coList = async (s) => kit.rows(await s.get('qs', `${P}/change-orders?includeArchived=true`));
  const citesDocument = (order, documentId) => (order?.attachmentRefs || []).some((a) => a.documentId === documentId);
  const changeOrder = async (s, key, { description, value, links, allocationLinks, scheduleImpact = 0, approve }) => {
    const created = await s.create(`co.${key}`, 'qs', `${P}/change-orders`, {
      description, category: 'client_variation', value, budgetLineId: budget.L3.id, scheduleImpact,
      scheduleImpactSummary: `${links.map((l) => `${l.days} days on ${l.code}`).join('; ')} (${b.code})`,
      costImpactSummary: `${value} at agreed rates (${b.code})`,
      activityLinks: links.map((l) => ({ activityId: act[l.code], relationType: 'impacted', scheduleImpactDays: l.days, costImpact: value / links.length, notes: b.ref(key) })),
      ...(allocationLinks ? { allocationLinks } : {}),
    }, {
      fields: { description, status: 'draft', value: is.cents(value) },
      get: null, // re-read live by the step's verify
      // The duplicates share a description: the one with it that this build has not recorded yet.
      find: async (s2) => kit.only(
        s2,
        (await coList(s2)).filter((x) => x.description === description),
        (x) => !Object.values(b.state.records).some((r) => r.kind === 'create' && r.id === x.id && r.status === 'done'),
        `the change order ${key}`,
      ),
    });
    const doc = await kit.attach(b, s, `co.${key}.instruction`, 'qs', { recordType: 'change_order', recordId: created.id, label: `${key}-instruction` });
    await s.act(`co.${key}.documents`, 'qs', 'PATCH', `${P}/change-orders/${created.id}`, { documentIds: [doc.documentId] }, {
      fields: { id: created.id, attachmentRefs: (v, d) => citesDocument(d, doc.documentId) || `the instruction ${doc.documentId} cited as a supporting document` },
      verify: async (s2) => citesDocument((await coList(s2)).find((x) => x.id === created.id), doc.documentId),
    });
    await s.act(`co.${key}.submit`, 'qs', 'POST', `${P}/change-orders/${created.id}/submit`, { comment: b.ref(`${key}-submit`) }, {
      fields: { status: 'pending' },
      verify: async (s2) => ['pending', 'approved'].includes((await coList(s2)).find((x) => x.id === created.id)?.status),
    });
    if (approve) {
      await s.act(`co.${key}.approve`, 'pm', 'POST', `${P}/change-orders/${created.id}/approve`, { comment: b.ref(`${key}-approve`) }, {
        fields: { status: 'approved' },
        verify: async (s2) => (await coList(s2)).find((x) => x.id === created.id)?.status === 'approved',
      });
    }
    return { id: created.id, documentId: doc.documentId };
  };
  const cos = await b.step('change-orders', async (s) => {
    const duplicate = b.name('Duplicate instruction extra skirting');
    const d1 = await changeOrder(s, 'D1', { description: duplicate, value: 1000, links: [{ code: 'X40', days: 2 }], approve: true });
    const d2 = await changeOrder(s, 'D2', { description: duplicate, value: 1000, links: [{ code: 'X40', days: 2 }], approve: true });
    // STAGED for WP-9 T2 (submitted, not approved): +10 m3 on Q1 / X10 makes the authorised quantity 110 once approved.
    const q = await changeOrder(s, 'Q', {
      description: b.name('CO-Q additional Q1 concrete 10 m3'), value: 4000, links: [{ code: 'X10', days: 0 }],
      allocationLinks: [{ allocationId: alloc.Q1, quantity: 10, amount: 4000, notes: b.ref('CO-Q') }], approve: false,
    });
    const orders = await coList(s);
    const pair = orders.filter((x) => [d1.id, d2.id].includes(x.id));
    s.assert(pair.length === 2 && pair.every((x) => x.status === 'approved' && x.description === duplicate), `the two duplicates are approved with one description (WP9.T2/T2b.duplicateCoMeasured ${T2.duplicateCoMeasured.value})`);
    s.assert(orders.find((x) => x.id === q.id)?.status === 'pending', 'CO-Q is pending: staged for the proof');
    return {
      duplicates: [d1.id, d2.id],
      documents: { D1: d1.documentId, D2: d2.documentId, Q: q.documentId },
      staged: { changeOrderId: q.id, approveRoute: `${P}/change-orders/${q.id}/approve`, authorisedAfter: T2.quantityWithCoLimit.value },
    };
  }, {
    needs: ['allocations'],
    verify: async (s, out) => {
      const orders = await coList(s);
      const of = (id) => orders.find((x) => x.id === id);
      const wanted = { D1: [out.duplicates[0], 'approved'], D2: [out.duplicates[1], 'approved'], Q: [out.staged.changeOrderId, 'pending'] };
      for (const [key, [id, status]] of Object.entries(wanted)) {
        if (of(id)?.status !== status) return `change order ${key} (${id}) is ${of(id)?.status ?? 'missing'}, not ${status}`;
        if (!citesDocument(of(id), out.documents[key])) return `change order ${key} no longer cites its instruction ${out.documents[key]}`;
      }
      return true;
    },
  });

  // ── a budget revision linked to VO-999 (no such change order) ───────────────
  const revisionList = async (s2) => kit.rows(await s2.get('cost', `${P}/budget-revisions`));
  await b.step('budget-revision', async (s) => {
    const title = b.name('Budget revision citing VO-999');
    const row = await s.create('revision.vo999', 'cost', `${P}/budget-revisions`, {
      title, changeType: 'addition', amount: 5000, effectiveDate: R, status: 'draft', linkedChangeOrder: 'VO-999', notes: b.ref('VO-999'),
    }, {
      fields: { title, linkedChangeOrder: 'VO-999', status: 'draft' },
      get: null, // re-read live by the step's verify
      find: async (s2) => kit.only(s2, await revisionList(s2), (x) => x.title === title, `the budget revision ${title}`),
    });
    return { id: row.id };
  }, {
    verify: async (s, out) => {
      const row = (await revisionList(s)).find((x) => x.id === out.id);
      return (row?.linkedChangeOrder === 'VO-999' && row.status === 'draft') || `the VO-999 budget revision ${out.id} is ${row ? `${row.status}, linked to ${row.linkedChangeOrder}` : 'missing'}`;
    },
  });

  // ── a later revision R2, activated over the baselined R1 (ids kept) ─────────
  await b.step('schedule.R2', async (s) => {
    const rid = await importRevision(s, 'R2', R2);
    await submitAndApprove(s, 'R2', rid);
    const mappings = R1.activities.map((a) => ({ oldActivityId: act[a.code], newActivityKey: String(1001 + R2.activities.find((x) => x.code === a.code).index) }));
    const mapping = await s.get('pm', `${P}/schedule/revisions/${rid}/mapping`);
    b.note(`R2 mapping suggestions: ${JSON.stringify((mapping?.suggestedMappings || []).map((m) => [m.oldActivityId, m.newActivityKey, m.matchType])).slice(0, 900)}`);
    await s.act('schedule.R2.activate', 'pm', 'POST', `${P}/schedule/revisions/${rid}/activate`, { mappings, comment: b.ref('R2-activate') }, {
      fields: { 'revision.isActive': true },
      verify: async (s2) => (await s2.get('planner', `${P}/schedule/revisions/${rid}`)).isActive === true,
    });
    const acts = await activitiesByCode(s);
    // WP9.history.activationKeepsIds, asserted at the activation (G1).
    const kept = R1.activities.every((a) => acts[a.code]?.id === act[a.code]);
    s.assert(kept === FC.WP9.history.activationKeepsIds.value, `every R1 activity keeps its id through the R2 activation (WP9.history.activationKeepsIds ${FC.WP9.history.activationKeepsIds.value}); read ${JSON.stringify(R1.activities.map((a) => [a.code, acts[a.code]?.id === act[a.code]]))}`);
    s.assert(Boolean(acts.X60?.id), 'R2 brings the new X60');
    const x20 = acts.X20;
    s.expectFields(x20, { baselineFinishDate: is.day(X20_BF_DATE), earlyFinish: X20_EF }, 'X20 after R2 (baseline kept; WP9.T3)');
    const old = await s.get('planner', `${P}/schedule/revisions/${r1.revisionId}`);
    s.assert(old.isActive === false, `R1 (the baselined revision) is no longer active after R2 (status ${old.status})`);
    return { revisionId: rid, x60: acts.X60.id, r1Status: old.status, activationKeepsIds: kept };
  }, { needs: ['baseline', 'quantity', 'ipc', 'change-orders'] });

  // ── risks: one per state, each linked to X40 (WP9.risk.mix) ─────────────────
  const RISK_STATES = { 'R-OPEN': 'open', 'R-MON': 'monitoring', 'R-SUB': 'submitted', 'R-CLO': 'closed', 'R-ARC': 'archived' };
  const riskList = async (s2) => kit.rows(await s2.get('pm', `${P}/risks?includeArchived=true`));
  await b.step('risks', async (s) => {
    const statusOf = async (s2, id) => (await riskList(s2)).find((x) => x.id === id)?.status;
    const make = async (key, { status = 'open', dueDate }) => {
      const description = b.name(`Risk ${key}`);
      return s.create(`risk.${key}`, 'pm', `${P}/risks`, {
        description, probability: 'medium', impact: 'high', mitigation: `Mitigation for ${key} (${b.code})`, dueDate, status, activityId: act.X40,
      }, {
        fields: { description, status },
        get: null, // re-read live by the step's verify
        find: async (s2) => kit.only(s2, await riskList(s2), (x) => x.description === description, `the risk ${key}`),
      });
    };
    const open = await make('R-OPEN', { dueDate: kit.addDays(R, -5) });
    const mon = await make('R-MON', { status: 'monitoring', dueDate: b.date(30, { future: true }) });
    const sub = await make('R-SUB', { dueDate: b.date(20, { future: true }) });
    const closeout = (key) => ({ closeoutComment: `Closed out ${key} (${b.code})`, responsePlan: `Response plan ${key} (${b.code})`, dueDate: b.date(20, { future: true }) });
    await s.act('risk.R-SUB.submit', 'pm', 'POST', `${P}/risks/${sub.id}/submit`, closeout('R-SUB'), {
      fields: { status: 'submitted' },
      verify: async (s2) => (await statusOf(s2, sub.id)) === 'submitted',
    });
    const clo = await make('R-CLO', { dueDate: b.date(20, { future: true }) });
    await s.act('risk.R-CLO.submit', 'pm', 'POST', `${P}/risks/${clo.id}/submit`, closeout('R-CLO'), {
      fields: { status: 'submitted' },
      verify: async (s2) => ['submitted', 'closed'].includes(await statusOf(s2, clo.id)),
    });
    await s.act('risk.R-CLO.approve', 'pm', 'POST', `${P}/risks/${clo.id}/approve`, { comment: b.ref('R-CLO-approve') }, {
      fields: { status: 'closed' },
      verify: async (s2) => (await statusOf(s2, clo.id)) === 'closed',
    });
    const arc = await make('R-ARC', { dueDate: b.date(20, { future: true }) });
    await s.act('risk.R-ARC.archive', 'pm', 'DELETE', `${P}/risks/${arc.id}`, undefined, {
      fields: { $status: 200 },
      verify: async (s2) => (await statusOf(s2, arc.id)) === 'archived',
    });
    const all = await riskList(s);
    const made = { 'R-OPEN': open.id, 'R-MON': mon.id, 'R-SUB': sub.id, 'R-CLO': clo.id, 'R-ARC': arc.id };
    s.expectFields(Object.fromEntries(Object.entries(made).map(([k, id]) => [k, all.find((x) => x.id === id)?.status])), RISK_STATES, 'risk states (WP9.risk.mix)');
    return { open: open.id, monitoring: mon.id, submitted: sub.id, closed: clo.id, archived: arc.id, byKey: made };
  }, {
    verify: async (s, out) => {
      const all = await riskList(s);
      for (const [key, status] of Object.entries(RISK_STATES)) {
        const row = all.find((x) => x.id === out.byKey[key]);
        if (row?.status !== status) return `risk ${key} is ${row?.status ?? 'missing'}, not ${status}`;
      }
      return true;
    },
  });

  // Change events raised from an exception, voided and converted: served by the WP-9 handling
  // proof on this project (builders' adjudication 087-EXC/HLT item 1), not by the build.
  b.note('plan §3.2 "change events raised from an exception, voided and converted": served by the WP-9 handling proof on 087-EXC (raise 201 then 409 EXCEPTION_IN_CHANGE, void, convert) after WP-9 T2\'s first evaluation; builders\' adjudication 087-EXC/HLT item 1 (MOMENT-MAP, plan execution note)');

  // ── what the build leaves for the WP-9 proofs ────────────────────────────────
  await b.step('controls.read', async (s) => {
    const lines = Object.fromEntries(await Promise.all(Object.entries(budget).filter(([k]) => /^L\d$/.test(k)).map(async ([k, l]) => [k, await s.get('cost', `${P}/budget/lines/${l.id}`)])));
    s.expectFields(lines.L1, { committed: is.cents(10500), revisedBudget: is.cents(10000) }, 'L1');
    s.expectFields(lines.L2, { forecast: is.cents(23000), revisedBudget: is.cents(20000), forecastIsManual: true }, 'L2');
    const ev = await s.get('cost', `${P}/reports/ev`);
    const evToday = await s.get('cost', `${P}/reports/ev?cutoffDate=${R}`);
    s.assert(Number(ev.pv) > 0 && Number(evToday.pv) > 0, `the approved cost loadings give PV > 0 (plan §3.2): ${ev.pv} at the default period, ${evToday.pv} at the run date`);
    const x10 = await s.get('qs', `${P}/activities/${act.X10}/quantities`);
    const q1Block = kit.exactlyOne(s, kit.rows(x10), (i) => (i.boqItemId || i.id) === boq.Q1, 'the Q1 block of X10\'s quantities');
    const installed = q1Block?.figures?.installed?.value ?? null;
    s.assert(Number(installed) === T2.quantityFirst.value, `Q1 installed on X10 is ${T2.quantityFirst.value} m3 (approved 60 + 45; WP9.T2/T2b.quantityFirst), read ${installed}`);
    const x40 = await s.get('planner', `${P}/activities/${act.X40}`);
    s.expectFields(x40.projectRiskSummary || {}, { ...FC.WP9.risk.activitySummary.value }, 'X40 projectRiskSummary (WP9.risk.activitySummary)');
    b.note(`EV at the default period (P2, cutoff ${P2_CUTOFF}): pv ${ev.pv} ev ${ev.ev} ac ${ev.ac} bac ${ev.totalBudget} eac ${ev.eac} cpi ${ev.cpi}; at the run date: pv ${evToday.pv} ev ${evToday.ev} ac ${evToday.ac} eac ${evToday.eac} cpi ${evToday.cpi}`);
    // R3-15: the instants progress_stale counts from: each activity's latest approved progress.
    const approvals = {};
    for (const code of ['X05', 'X10', 'X20', 'X30']) {
      const row = await s.get('planner', `${P}/activities/${act[code]}`);
      const at = row.progressSource?.approvedAt ?? null;
      s.assert(typeof at === 'string' && Number.isFinite(Date.parse(at)), `${code}'s latest approved progress carries its approvedAt (read ${at})`);
      approvals[code] = { approvedAt: at, pctComplete: row.pctComplete, submissionId: row.progressSource?.submissionId ?? null };
    }
    const latest = Object.values(approvals).map((a) => a.approvedAt).sort().pop();
    return {
      runDate: R,
      dataDateIndex: D,
      x20BaselineFinish: X20_EF,
      x20BaselineFinishDate: X20_BF_DATE,
      p2Cutoff: P2_CUTOFF,
      approvals: { byActivity: approvals, latestProgressApprovedAt: latest, staleCutoffFrom: new Date(Date.parse(latest) + T2C.staleMeasured.value * kit.DAY_MS).toISOString() },
      l2: { forecast: lines.L2.forecast, revisedBudget: lines.L2.revisedBudget, forecastExceedance: Number(lines.L2.forecast) - Number(lines.L2.revisedBudget) },
      l1: { committed: lines.L1.committed, revisedBudget: lines.L1.revisedBudget },
      ipcOverCertification: ipc.overCertificationAmount,
      ev: { default: { pv: ev.pv, ev: ev.ev, ac: ev.ac, bac: ev.totalBudget, eac: ev.eac, cpi: ev.cpi, period: ev.reporting?.period?.code ?? null }, atRunDate: { pv: evToday.pv, ev: evToday.ev, ac: evToday.ac, eac: evToday.eac, cpi: evToday.cpi } },
      x40RiskSummary: x40.projectRiskSummary ? Object.fromEntries(Object.keys(FC.WP9.risk.activitySummary.value).map((k) => [k, x40.projectRiskSummary[k]])) : null,
      staged: { quantity: quantity.staged, coLink: cos.staged },
      ids: { activities: act, boq, allocations: alloc, periods },
      q1InstalledOnX10: Number(installed),
    };
  }, { needs: ['schedule.R2', 'risks', 'periods', 'commitment', 'budget-revision'] });
});
