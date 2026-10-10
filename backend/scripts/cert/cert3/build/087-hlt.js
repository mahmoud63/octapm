'use strict';

/**
 * CERT-3 deep company 087, project 087-HLT "CERT3 Health" (plan §3.2, WP-9 health).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-hlt.js [--fresh]
 *
 * What it holds (plan §3.2 087-HLT; answer book field-controls.js WP9.health.*):
 *   - The EV record set of the answer book (WP9.health.evRecords): two activities, two BOQ
 *     rows allocated whole (60,000 + 30,000), approved cost loadings of 60,000 and 30,000 and
 *     approved direct costs of 50,000 and 30,000, all dated on or before the 2026-08-31 cutoff,
 *     and approved progress 100% and 50%. Approvals carry the build's real timestamps (plan
 *     §3.3), so (builders' adjudication 087-EXC/HLT item 6, settled on paper in the book):
 *       at ?cutoffDate=2026-08-31   PV 90,000, AC 80,000, EV 0 (WP9.health.pv/ac/evAtCutoff)
 *       on the card's basis         PV 90,000, EV 75,000, AC 80,000 (an ad hoc report cut at
 *                                   today: no reporting period on 087-HLT; WP9.health.cardBasis,
 *                                   pv/ev/acOnCardBasis, spi, cpi, scheduleScore, costScore)
 *   - Quality: 1 major NCR (closed), 1 minor NCR (open), 1 legacy ITP failed, 1 form ITP failed
 *     (WP9.health.qualityByRule 42 / qualityInCode 57).
 *   - Safety: a closed LTI, an open incident, an incident archived while open
 *     (WP9.health.safetyExpected 75 / today 70). Step health.safety judges the card against
 *     the book: BLOCKED HR-K1 on today's 70 (round 2, R2-A; as 052-FLD's safety.score).
 *   - Documents, the literal §3.2 contents (WP9.health.docControlRecords, item 8): an open RFI
 *     overdue by dueDate and responseRequiredBy, an answered RFI past its dueDate
 *     (responseRequiredBy null), 2 pending submittals not yet due, no drawings
 *     (docControlExpected / docControlCard 80 / 80). The variant with IFC and non-IFC drawings
 *     is a second project "CERT3 Health IFC variant (087-HLT)" with the same document records
 *     plus 2 drawings, 1 IFC (WP9.health.docControlIfcVariant).
 *   - Commercial: CO1 scheduleImpact 4 (link days 0) and CO2 scheduleImpact 0 with link days 6,
 *     both approved (WP9.health.commercialCard 91 / commercialWorkspace 94).
 *   - Supply chain: one long-lead item, criticality critical, linked to an activity, not
 *     ordered, its order-by date passed (WP9.health.supplyChainRecord / Card 75 / Workspace 88).
 *   - The 50-working-day activity H50 starts on the project start, which the answer book's rule
 *     places for the run date (rules.delayedExampleDatesFor, WP9.health.delayedExampleDates;
 *     item 7, R3-10): its calendar-day finish is before the run date and its working-day finish
 *     after it. The WP-9 health proof reads the card on a date in the window the step
 *     health.read records (windowFrom .. windowThrough; delayedExpected 0, today 1). Step
 *     health.delayed judges the card at the build against the book: BLOCKED HR-K2 on today's 1
 *     (round 2, R2-A).
 *   - One open risk whose mitigation is overdue (WP9.health.workspaceScheduleWithOverdueRisk 55).
 */

const lib = require('./lib');
const kit = require('./kit-controls');

const { is } = lib;
const FC = lib.answers.fieldControls;
const H = FC.WP9.health;
/** The answer book's EV record set (WP9.health.evRecords), by activity code. */
const REC = Object.fromEntries(H.evRecords.value.map((r) => [r.code, r]));
/** Money of a cents leaf, in currency units, for is.cents. */
const units = (leaf) => leaf.value / 100;
const minDay = (a, b2) => (a <= b2 ? a : b2);

lib.main('087-HLT', async (b) => {
  // ── dates: the answer book's rule for this run date (WP9.health.delayedExampleDates) ──
  const R = b.today;
  const X = FC.rules.delayedExampleDatesFor(R);
  const S = X.start;
  const CUTOFF = X.cutoff; // plan §3.2 087-HLT: every PV and AC date is on or before it
  b.assert(X.startOnOrBeforeCutoff === true, `the project start ${S} is on or before the cutoff ${CUTOFF} (answer book rules.delayedExampleDatesFor, run date ${R})`);
  b.assert(X.windowFrom <= R && R <= X.windowThrough, `the run date ${R} lies in the delayed window ${X.windowFrom} .. ${X.windowThrough} (H50 calendar finish ${X.calendarFinish} passed, working-day finish ${X.workingFinish} ahead)`);
  b.assert(kit.dateOfWorkingDay(S, REC.H50.workingDays) === X.workingFinish, `H50's ${REC.H50.workingDays} working days from ${S} end on ${X.workingFinish} on the answer book's calendar`);
  const LOAD_H10 = minDay(kit.addDays(S, 7), CUTOFF);
  const COST_H10 = minDay(kit.addDays(S, 10), CUTOFF);
  b.past(LOAD_H10);
  b.past(COST_H10);
  b.past(CUTOFF);
  b.note(`run date ${R}; project start ${S} (Monday); H50 calendar finish ${X.calendarFinish}, working-day finish ${X.workingFinish}; proof window ${X.windowFrom} .. ${X.windowThrough}; cutoff ${CUTOFF}`);

  await b.project({
    title: 'Health',
    payload: { startDate: S, projectCalendar: 'five_day', currency: 'EGP', type: 'building', contractType: 'unit_rate', location: b.name('Health site') },
    fields: { projectCalendar: 'five_day', currency: 'EGP', startDate: is.day(S) },
  });
  const P = b.P;
  await b.team({ planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', site: 'site_engineer', quality: null, finance: 'finance', procurement: 'procurement' });
  const ids = {};
  for (const key of ['pm', 'planner', 'qs', 'site', 'quality']) ids[key] = await b.userId(key);

  // ── cost code and budget line ──────────────────────────────────────────────
  const budget = await b.step('budget', async (s) => {
    const codes = await kit.companyCostCodes(s, 'pm', ['01-100']);
    await s.act('budget.costcodes', 'pm', 'PUT', `${P}/budget/cost-codes`, { costCodeIds: [codes['01-100']] }, {
      fields: { items: (v, d) => kit.rows(d).some((c) => (c.costCodeId || c.id) === codes['01-100'] || c.code === '01-100') || 'the project selection lists 01-100' },
      verify: async (s2) => kit.rows(await s2.get('pm', `${P}/budget/cost-codes`)).some((c) => c.code === '01-100'),
    });
    const description = b.name('Health works budget line');
    const line = await s.create('budget.line', 'cost', `${P}/budget/lines`, {
      costCodeId: codes['01-100'], costType: 'labour', description, originalBudget: 100000, status: 'active',
    }, {
      fields: { description, costType: 'labour', originalBudget: is.cents(100000), status: 'active' },
      get: (id) => `${P}/budget/lines/${id}`,
      find: async (s2) => kit.findRow(s2, 'cost', `${P}/budget/lines`, (l) => l.description === description),
    });
    return { costCodeId: codes['01-100'], lineId: line.id };
  });

  // ── activities: H10 and H50 (the book's working days), both from the start ──
  const ACTS = [
    { code: 'H10', name: 'Enabling works', duration: REC.H10.workingDays, sortOrder: 0 },
    { code: 'H50', name: 'Fifty-working-day works', duration: REC.H50.workingDays, sortOrder: 1 },
  ];
  const acts = await b.step('activities', async (s) => {
    const out = {};
    for (const a of ACTS) {
      const name = `${a.code} ${a.name} (${b.code})`;
      const row = await s.create(`activity.${a.code}`, 'planner', `${P}/activities`, {
        name, activityCode: a.code, wbsCode: b.name('Health works'), category: 'civil', duration: a.duration, isMilestone: false, sortOrder: a.sortOrder, engineerIds: [ids.site],
      }, {
        fields: { name, activityCode: a.code, duration: a.duration },
        get: (id) => `${P}/activities/${id}`,
        find: async (s2) => kit.findRow(s2, 'planner', `${P}/activities`, (r) => r.activityCode === a.code && r.name === name),
      });
      out[a.code] = row.id;
    }
    // CPM placed both at the start (ES 0, EF = the working days); their dates are the answer
    // book's calendar's: start S, working-day finish S + duration working days (WP9.health.delayedExampleDates).
    for (const a of ACTS) {
      const row = await s.get('planner', `${P}/activities/${out[a.code]}`);
      s.expectFields(row, { earlyStart: 0, earlyFinish: a.duration, startDate: is.day(S), endDate: is.day(kit.dateOfWorkingDay(S, a.duration)) }, `${a.code} CPM`);
    }
    return out;
  }, {
    verify: async (s, out) => {
      for (const a of ACTS) {
        const row = await s.get('planner', `${P}/activities/${out[a.code]}`);
        if (Number(row.earlyFinish) !== a.duration) return `${a.code} early finish ${row.earlyFinish}, not ${a.duration}`;
      }
      return true;
    },
  });

  // ── BOQ: two rows, each allocated whole (approved): the book's allocations ──
  const RATE = 100;
  const ROWS = [
    { code: 'HB-1', act: 'H10', description: 'Enabling earthworks', unit: 'm3', rate: RATE, quantity: REC.H10.allocation / RATE },
    { code: 'HB-2', act: 'H50', description: 'Fifty-day works', unit: 'm2', rate: RATE, quantity: REC.H50.allocation / RATE },
  ];
  for (const r of ROWS) b.assert(Number.isInteger(r.quantity) && r.quantity * r.rate === REC[r.act].allocation, `${r.code}: ${r.quantity} x ${r.rate} = the book's allocation ${REC[r.act].allocation} on ${r.act}`);
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
      for (const r of ROWS) if (!items.some((i) => i.id === out[r.code])) return `BOQ row ${r.code} (${out[r.code]}) is not on the bill`;
      return true;
    },
  });

  const allocList = async (s2) => kit.rows(await s2.get('qs', `${P}/activity-boq-allocations`));
  await b.step('allocations', async (s) => {
    const out = {};
    for (const r of ROWS) {
      const amount = r.quantity * r.rate;
      const created = await s.create(`alloc.${r.code}`, 'planner', `${P}/activity-boq-allocations`, {
        boqItemId: boq[r.code], activityId: acts[r.act], quantity: r.quantity, amount, source: 'manual', notes: b.ref(`alloc-${r.code}`),
      }, {
        idOf: (d) => d?.id ?? d?.allocation?.id ?? null,
        fields: { quantity: is.number(r.quantity), amount: is.cents(amount) },
        get: null,
        find: async (s2) => kit.only(s2, await allocList(s2), (x) => x.boqItemId === boq[r.code] && x.activityId === acts[r.act] && x.isActive !== false, `the allocation of ${r.code} to ${r.act}`),
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

  // ── approved progress: the book's percentages (H10 100%, H50 50%) ───────────
  const PROGRESS = [['H10', REC.H10.pct], ['H50', REC.H50.pct]];
  const subsOf = async (s2, code) => kit.rows(await s2.get('planner', `${P}/activities/${acts[code]}/progress-submissions`));
  await b.step('progress', async (s) => {
    const out = {};
    for (const [code, pct] of PROGRESS) {
      const notes = `${b.ref(`progress-${code}`)} measured on site`;
      await s.create(`progress.${code}`, 'site', `${P}/activities/${acts[code]}/progress`, {
        pctComplete: pct, progressMethod: 'percent', status: 'submitted', source: 'manual', notes,
      }, {
        expect: [200, 201],
        idOf: (d) => d?.submission?.id ?? null,
        fields: { 'submission.status': 'submitted', 'submission.pctComplete': is.number(pct) },
        get: null, // re-read live by the step's verify
        find: async (s2) => {
          const row = kit.only(s2, await subsOf(s2, code), (x) => x.notes === notes, `the progress submission on ${code}`);
          return row ? { submission: row } : null;
        },
      });
      const sid = b.id(`progress.${code}`); // the recorded id (a stored answer may be kept only in part)
      await s.act(`progress.${code}.approve`, 'planner', 'POST', `${P}/activities/${acts[code]}/progress-submissions/${sid}/approve`, {}, {
        fields: { status: 'approved' },
        verify: async (s2) => (await subsOf(s2, code)).find((x) => x.id === sid)?.status === 'approved',
      });
      out[code] = sid;
    }
    return out;
  }, {
    verify: async (s, out) => {
      for (const [code, pct] of PROGRESS) {
        const row = (await subsOf(s, code)).find((x) => x.id === out[code]);
        if (row?.status !== 'approved' || Number(row.pctComplete) !== pct) return `the progress on ${code} is ${row?.status ?? 'missing'} at ${row?.pctComplete}`;
      }
      return true;
    },
  });

  // ── PV: approved cost loadings on or before the cutoff (the book's loadings) ──
  const LOADINGS = [['H10', REC.H10.loading, LOAD_H10], ['H50', REC.H50.loading, CUTOFF]];
  const loadingList = async (s2) => kit.rows(await s2.get('cost', `${P}/reports/cost-loading`));
  await b.step('loadings', async (s) => {
    const out = {};
    for (const [code, value, date] of LOADINGS) {
      b.past(date);
      const notes = b.ref(`pv-${code}`);
      const row = await s.create(`loading.${code}`, 'cost', `${P}/reports/cost-loading`, {
        activityId: acts[code], plannedDate: date, plannedValue: value, source: 'manual', status: 'draft', notes,
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
      for (const [code, value, date] of LOADINGS) {
        const row = list.find((x) => x.id === out[code]);
        if (row?.status !== 'approved' || Number(row.plannedValue) !== value || kit.day(row.plannedDate) !== date) return `the cost loading on ${code} is ${row?.status ?? 'missing'} (${row?.plannedValue} on ${kit.day(row?.plannedDate)})`;
      }
      return true;
    },
  });

  // ── AC: approved direct costs on or before the cutoff (the book's costs) ────
  const COSTS = [['H10', REC.H10.cost, COST_H10], ['H50', REC.H50.cost, CUTOFF]];
  await b.step('costs', async (s) => {
    const out = {};
    for (const [code, amount, date] of COSTS) {
      b.past(date);
      const description = b.name(`Actual cost ${code}`);
      const row = await s.create(`cost.${code}`, 'cost', `${P}/direct-costs`, {
        type: 'invoice', description, costDate: date, receivedDate: date, vendorName: b.name('Health works supplier'), invoiceNumber: b.ref(`INV-${code}`),
        notes: b.ref(`ac-${code}`),
        lines: [{ description: `${code} works (${b.code})`, costCodeId: budget.costCodeId, budgetLineId: budget.lineId, activityId: acts[code], costType: 'labour', quantity: 1, unit: 'item', unitCost: amount, amount }],
      }, {
        fields: { description, status: 'draft', total: is.cents(amount) },
        get: (id) => `${P}/direct-costs/${id}`,
        find: async (s2) => kit.findRow(s2, 'cost', `${P}/direct-costs`, (x) => x.description === description),
      });
      // A submitted direct cost reads 'pending' (awaiting approval).
      await s.act(`cost.${code}.submit`, 'cost', 'POST', `${P}/direct-costs/${row.id}/submit`, {}, {
        fields: { status: 'pending' },
        verify: async (s2) => ['pending', 'approved'].includes((await s2.get('cost', `${P}/direct-costs/${row.id}`)).status),
      });
      await s.act(`cost.${code}.approve`, 'finance', 'POST', `${P}/direct-costs/${row.id}/approve`, {}, {
        fields: { status: 'approved' },
        verify: async (s2) => (await s2.get('cost', `${P}/direct-costs/${row.id}`)).status === 'approved',
      });
      out[code] = row.id;
    }
    return out;
  });

  // ── the EV figures, at the cutoff and on the card's basis (item 6, R3-4) ───
  await b.step('ev.check', async (s) => {
    // WP9.health.cardBasis: with no reporting period on 087-HLT, the card (and the default EV
    // report) cut an ad hoc report at today.
    const periods = kit.rows(await s.get('cost', `${P}/reports/periods`));
    s.assert(periods.length === 0, `087-HLT has no reporting period (WP9.health.cardBasis: ${H.cardBasis.value}); found ${periods.length}`);
    const card = await s.get('cost', `${P}/reports/ev`);
    s.expectFields(card, {
      pv: is.cents(units(H.pvOnCardBasis)), ev: is.cents(units(H.evOnCardBasis)), ac: is.cents(units(H.acOnCardBasis)),
      'reporting.cutoffLocalDate': (v) => (typeof v === 'string' && v >= R) || `today in the reporting zone (on or after the run date ${R})`,
    }, 'EV on the card basis (WP9.health.pv/ev/acOnCardBasis)');
    s.assert(Math.abs(Number(card.spi) - H.spi.value) < 1e-6, `SPI ${card.spi} is ${H.spi.value} (WP9.health.spi)`);
    s.assert(Math.abs(Number(card.cpi) - H.cpi.value) < 1e-6, `CPI ${card.cpi} is ${H.cpi.value} (WP9.health.cpi)`);
    const atCutoff = await s.get('cost', `${P}/reports/ev?cutoffDate=${CUTOFF}`);
    s.expectFields(atCutoff, {
      pv: is.cents(units(H.pvAtCutoff)), ac: is.cents(units(H.acAtCutoff)), ev: is.cents(units(H.evAtCutoff)),
      'reporting.cutoffDate': H.cutoffInstant.value,
    }, `EV at ?cutoffDate=${CUTOFF} (WP9.health.pv/ac/evAtCutoff, cutoffInstant)`);
    s.note(`plan execution note (builders' adjudication 087-EXC/HLT item 6): PV and AC are asserted at the cutoff ${CUTOFF} and EV ${atCutoff.ev} there (approvals carry real timestamps, plan §3.3); EV ${card.ev} is asserted on the card's default basis (WP9.health.evAtCutoff planValue ${H.evAtCutoff.planValue} cents is the card basis)`);
    return {
      cardBasis: { pv: card.pv, ev: card.ev, ac: card.ac, spi: card.spi, cpi: card.cpi, cutoffLocalDate: card.reporting?.cutoffLocalDate ?? null },
      atCutoff: { pv: atCutoff.pv, ev: atCutoff.ev, ac: atCutoff.ac, cutoffDate: atCutoff.reporting?.cutoffDate ?? null },
    };
  }, { needs: ['progress', 'loadings', 'costs'] });

  // ── change orders: CO1 scheduleImpact 4 (link 0), CO2 scheduleImpact 0 (link 6) ──
  const COS = [
    { key: 'CO1', value: 2000, scheduleImpact: 4, linkDays: 0 },
    { key: 'CO2', value: 3000, scheduleImpact: 0, linkDays: 6 },
  ];
  const coList = async (s2) => kit.rows(await s2.get('qs', `${P}/change-orders?includeArchived=true`));
  const citesDocument = (order, documentId) => (order?.attachmentRefs || []).some((a) => a.documentId === documentId);
  await b.step('change-orders', async (s) => {
    const out = { ids: {}, documents: {} };
    for (const co of COS) {
      const description = b.name(`${co.key} client instruction`);
      const created = await s.create(`co.${co.key}`, 'qs', `${P}/change-orders`, {
        description, category: 'client_variation', value: co.value, budgetLineId: budget.lineId, activityId: acts.H50, scheduleImpact: co.scheduleImpact,
        scheduleImpactSummary: `${co.scheduleImpact} days on the completion date; link ${co.linkDays} days on H50 (${b.code})`,
        costImpactSummary: `${co.value} at agreed rates (${b.code})`,
        activityLinks: [{ activityId: acts.H50, relationType: 'impacted', scheduleImpactDays: co.linkDays, costImpact: co.value, notes: b.ref(co.key) }],
      }, {
        fields: { description, status: 'draft', scheduleImpact: co.scheduleImpact, value: is.cents(co.value) },
        get: null, // re-read live by the step's verify
        find: async (s2) => kit.only(s2, await coList(s2), (x) => x.description === description, `the change order ${co.key}`),
      });
      const doc = await kit.attach(b, s, `co.${co.key}.instruction`, 'qs', { recordType: 'change_order', recordId: created.id, label: `${co.key}-instruction` });
      await s.act(`co.${co.key}.documents`, 'qs', 'PATCH', `${P}/change-orders/${created.id}`, { documentIds: [doc.documentId] }, {
        fields: { id: created.id, attachmentRefs: (v, d) => citesDocument(d, doc.documentId) || `the instruction ${doc.documentId} cited as a supporting document` },
        verify: async (s2) => citesDocument((await coList(s2)).find((x) => x.id === created.id), doc.documentId),
      });
      await s.act(`co.${co.key}.submit`, 'qs', 'POST', `${P}/change-orders/${created.id}/submit`, { comment: b.ref(`${co.key}-submit`) }, {
        fields: { status: 'pending' },
        verify: async (s2) => ['pending', 'approved'].includes((await coList(s2)).find((x) => x.id === created.id)?.status),
      });
      await s.act(`co.${co.key}.approve`, 'pm', 'POST', `${P}/change-orders/${created.id}/approve`, { comment: b.ref(`${co.key}-approve`) }, {
        fields: { status: 'approved', scheduleImpact: co.scheduleImpact },
        verify: async (s2) => (await coList(s2)).find((x) => x.id === created.id)?.status === 'approved',
      });
      out.ids[co.key] = created.id;
      out.documents[co.key] = doc.documentId;
    }
    // The card reads Σ max(0, scheduleImpact + Σ link approved days) = 4 + 6 = 10 (WP9.health.commercialCard).
    const orders = await coList(s);
    for (const co of COS) {
      const row = orders.find((x) => x.id === out.ids[co.key]);
      const linkDays = (row?.activityLinks || []).reduce((sum, l) => sum + Number(l.approvedScheduleImpactDays || 0), 0);
      s.assert(linkDays === co.linkDays, `${co.key}: approved link days ${linkDays}, expected ${co.linkDays}`);
    }
    return { ...out.ids, documents: out.documents };
  }, {
    verify: async (s, out) => {
      const orders = await coList(s);
      for (const co of COS) {
        const row = orders.find((x) => x.id === out[co.key]);
        if (row?.status !== 'approved' || Number(row.scheduleImpact) !== co.scheduleImpact) return `${co.key} (${out[co.key]}) is ${row?.status ?? 'missing'} with scheduleImpact ${row?.scheduleImpact}`;
        if (!citesDocument(row, out.documents[co.key])) return `${co.key} no longer cites its instruction ${out.documents[co.key]}`;
      }
      return true;
    },
  });

  // ── quality: 1 major NCR closed, 1 minor NCR open, 1 legacy ITP failed, 1 form ITP failed ──
  const ncrList = async (s2) => kit.rows(await s2.get('quality', `${P}/ncr`));
  const itpList = async (s2) => kit.rows(await s2.get('quality', `${P}/itp`));
  const FORM_ITEM = 'Cover to reinforcement within tolerance';
  /** The form's answer to its one item (sections[].items[].response.value). */
  const responseOf = (form, itemId) => (form?.sections || []).flatMap((sec) => sec.items || []).find((i) => i.id === itemId)?.response?.value ?? null;
  await b.step('quality', async (s) => {
    const majorText = b.name('Major NCR honeycombing at pad footing');
    const major = await s.create('ncr.major', 'site', `${P}/ncr`, {
      severity: 'major', description: majorText, disposition: `Repair to method statement (${b.code})`, responsible: b.name('Concrete foreman'),
      assigneeUserId: ids.site, activityId: acts.H10, dueDate: kit.addDays(S, 20), comment: b.ref('ncr-major'),
    }, {
      fields: { severity: 'major', description: majorText },
      get: null, // re-read live by the step's verify
      find: async (s2) => kit.only(s2, await ncrList(s2), (x) => x.description === majorText, 'the major NCR'),
    });
    const evidence = await kit.workflowUpload(b, s, 'ncr.major.evidence', 'site', 'ncr-major-closeout');
    await s.act('ncr.major.close', 'site', 'POST', `${P}/ncr/${major.id}/close`, {
      closureComment: `Cut out and made good; re-inspected (${b.code})`, responsible: b.name('Concrete foreman'), dueDate: kit.addDays(S, 20), attachmentRefs: [evidence],
    }, {
      fields: { status: 'submitted' },
      verify: async (s2) => ['submitted', 'closed'].includes((await ncrList(s2)).find((x) => x.id === major.id)?.status),
    });
    await s.act('ncr.major.approve', 'quality', 'POST', `${P}/ncr/${major.id}/approve`, { comment: b.ref('ncr-major-approve') }, {
      fields: { status: 'closed' },
      verify: async (s2) => (await ncrList(s2)).find((x) => x.id === major.id)?.status === 'closed',
    });
    const minorText = b.name('Minor NCR block joints out of tolerance');
    const minor = await s.create('ncr.minor', 'quality', `${P}/ncr`, {
      severity: 'minor', description: minorText, disposition: `Rake out and re-point (${b.code})`, responsible: b.name('Blockwork foreman'),
      assigneeUserId: ids.site, activityId: acts.H50, dueDate: R, comment: b.ref('ncr-minor'),
    }, {
      fields: { severity: 'minor', description: minorText, status: 'open' },
      get: null, // re-read live by the step's verify
      find: async (s2) => kit.only(s2, await ncrList(s2), (x) => x.description === minorText, 'the minor NCR'),
    });

    const itpTitle = b.name('Legacy ITP rebar inspection');
    const itp = await s.create('itp.legacy', 'quality', `${P}/itp`, {
      title: itpTitle, pointType: 'hold', status: 'pending', activityId: acts.H10, dueDate: kit.addDays(S, 8), inspectionDate: kit.addDays(S, 8),
      inspector: b.name('Quality inspector'), notes: b.ref('itp-legacy'), comment: b.ref('itp-legacy'), assigneeUserId: ids.site, ownerUserId: ids.quality,
    }, {
      fields: { title: itpTitle, status: 'pending' },
      get: null, // re-read live by the step's verify
      find: async (s2) => kit.only(s2, await itpList(s2), (x) => x.title === itpTitle, 'the legacy ITP'),
    });
    await s.act('itp.legacy.fail', 'site', 'PATCH', `${P}/itp/${itp.id}`, { status: 'failed', inspectionDate: kit.addDays(S, 9), comment: `Not accepted (${b.code})` }, {
      fields: { status: 'failed' },
      verify: async (s2) => (await itpList(s2)).find((x) => x.id === itp.id)?.status === 'failed',
    });

    // The form ITP (WP9.health: form ITPs are not in the code's score, HR-Q3).
    const templateName = b.name('Form ITP pour check');
    const template = await s.create('form.template', 'quality', `${P}/forms/templates`, {
      name: templateName, description: b.ref('form-template'), trade: 'Concrete', type: 'itp', status: 'active',
      sections: [{ title: `Pour check (${b.code})`, items: [{ label: FORM_ITEM, responseType: 'pass_fail' }] }],
    }, {
      fields: { name: templateName, type: 'itp', status: 'active' },
      get: (id) => `${P}/forms/templates/${id}`,
      find: async (s2) => kit.findRow(s2, 'quality', `${P}/forms/templates`, (x) => x.name === templateName),
    });
    const itemId = kit.exactlyOne(s, (template.sections || []).flatMap((sec) => sec.items || []), (i) => i.label === FORM_ITEM, 'the form ITP template item').id;
    const formTitle = b.name('Form ITP pour check H10');
    const form = await s.create('form.instance', 'site', `${P}/forms`, {
      templateId: template.id, title: formTitle, activityId: acts.H10, assigneeUserId: ids.site, inspectorUserId: ids.quality, approverUserId: ids.pm,
      scheduledFor: kit.addDays(S, 9), dueDate: kit.addDays(S, 10),
    }, {
      fields: { title: formTitle },
      get: (id) => `${P}/forms/${id}`,
      find: async (s2) => kit.findRow(s2, 'site', `${P}/forms`, (x) => x.title === formTitle),
    });
    const formGet = async (s2) => s2.get('site', `${P}/forms/${form.id}`);
    await s.act('form.start', 'site', 'POST', `${P}/forms/${form.id}/start`, {}, {
      fields: { status: 'in_progress' },
      verify: async (s2) => ['in_progress', 'complete', 'completed'].includes((await formGet(s2)).status),
    });
    await s.act('form.responses', 'site', 'PUT', `${P}/forms/${form.id}/responses`, { responses: [{ itemId, value: 'fail', note: `Cover below tolerance at grid B2 (${b.code})` }] }, {
      fields: { id: form.id, sections: (v, d) => responseOf(d, itemId) === 'fail' || `the item ${itemId} answered 'fail'` },
      verify: async (s2) => responseOf(await formGet(s2), itemId) === 'fail',
    });
    const done = await s.act('form.complete', 'site', 'POST', `${P}/forms/${form.id}/complete`, {}, {
      fields: { outcome: 'fail' },
      verify: async (s2) => (await formGet(s2)).outcome === 'fail',
    });
    return {
      majorNcr: major.id, minorNcr: minor.id, legacyItp: itp.id, formTemplate: template.id, formItp: form.id, formItem: itemId, formStatus: done?.status ?? null,
      evidence: { storageKey: evidence.storageKey, fileName: evidence.fileName },
    };
  }, {
    needs: ['progress'],
    verify: async (s, out) => {
      const ncrs = await ncrList(s);
      const major = ncrs.find((x) => x.id === out.majorNcr);
      if (major?.status !== 'closed' || !kit.citesEvidence(major, out.evidence)) return `the major NCR is ${major?.status ?? 'missing'}${major && !kit.citesEvidence(major, out.evidence) ? ' and no longer cites its closeout evidence' : ''}`;
      const minor = ncrs.find((x) => x.id === out.minorNcr);
      if (minor?.status !== 'open' || minor.severity !== 'minor') return `the minor NCR is ${minor?.status ?? 'missing'}`;
      const itp = (await itpList(s)).find((x) => x.id === out.legacyItp);
      if (itp?.status !== 'failed') return `the legacy ITP is ${itp?.status ?? 'missing'}`;
      const form = await s.get('site', `${P}/forms/${out.formItp}`);
      if (form.outcome !== 'fail' || responseOf(form, out.formItem) !== 'fail') return `the form ITP's outcome is ${form.outcome}`;
      return true;
    },
  });

  // ── safety: a closed LTI, an open incident, an incident archived while open ──
  const safetyList = async (s2) => kit.rows(await s2.get('quality', `${P}/safety?includeArchived=true`));
  await b.step('safety', async (s) => {
    const make = async (name, persona, { incidentType, title, date, lostDays = 0 }) =>
      s.create(name, persona, `${P}/safety`, {
        incidentType, title, date, activityId: acts.H10, responsible: b.name('Site supervisor'), investigation: `Statements taken (${b.code})`,
        severity: incidentType === 'lti' ? 'high' : 'low', dueDate: kit.addDays(date, 7), lostDays, comment: b.ref(name), assigneeUserId: ids.site, status: 'open',
      }, {
        fields: { incidentType, title, status: 'open' },
        get: null, // re-read live by the step's verify
        find: async (s2) => kit.only(s2, await safetyList(s2), (x) => x.title === title, `the incident ${name}`),
      });
    const lti = await make('safety.lti', 'site', { incidentType: 'lti', title: b.name('LTI operative fell from hop-up'), date: kit.addDays(S, 4), lostDays: 3 });
    const evidence = await kit.workflowUpload(b, s, 'safety.lti.evidence', 'site', 'lti-closeout');
    await s.act('safety.lti.close', 'site', 'POST', `${P}/safety/${lti.id}/close`, {
      closureComment: `Corrective actions briefed (${b.code})`, responsible: b.name('Site supervisor'), dueDate: kit.addDays(S, 11), attachmentRefs: [evidence],
    }, {
      fields: { status: 'submitted' },
      verify: async (s2) => ['submitted', 'closed'].includes((await safetyList(s2)).find((x) => x.id === lti.id)?.status),
    });
    await s.act('safety.lti.approve', 'quality', 'POST', `${P}/safety/${lti.id}/approve`, { comment: b.ref('lti-approve') }, {
      fields: { status: 'closed' },
      verify: async (s2) => (await safetyList(s2)).find((x) => x.id === lti.id)?.status === 'closed',
    });
    const open = await make('safety.open', 'site', { incidentType: 'near_miss', title: b.name('Near miss reversing dumper'), date: kit.addDays(S, 12) });
    const archived = await make('safety.archived', 'site', { incidentType: 'near_miss', title: b.name('Near miss entered in error'), date: kit.addDays(S, 13) });
    await s.act('safety.archived.archive', 'pm', 'DELETE', `${P}/safety/${archived.id}`, undefined, {
      fields: { $status: 200 },
      verify: async (s2) => Boolean((await safetyList(s2)).find((x) => x.id === archived.id)?.archivedAt),
    });
    const after = await safetyList(s);
    const arch = after.find((x) => x.id === archived.id);
    s.assert(Boolean(arch?.archivedAt) && arch.status !== 'closed', `the archived incident is archived while open (status ${arch?.status}, archivedAt ${arch?.archivedAt})`);
    return { lti: lti.id, open: open.id, archived: archived.id, evidence: { storageKey: evidence.storageKey, fileName: evidence.fileName } };
  }, {
    verify: async (s, out) => {
      const all = await safetyList(s);
      const lti = all.find((x) => x.id === out.lti);
      if (lti?.status !== 'closed' || !kit.citesEvidence(lti, out.evidence)) return `the LTI is ${lti?.status ?? 'missing'}${lti && !kit.citesEvidence(lti, out.evidence) ? ' and no longer cites its closeout evidence' : ''}`;
      const open = all.find((x) => x.id === out.open);
      if (open?.status !== 'open' || open.archivedAt) return `the open incident is ${open?.status ?? 'missing'}${open?.archivedAt ? ' (archived)' : ''}`;
      const arch = all.find((x) => x.id === out.archived);
      if (!arch?.archivedAt || arch.status === 'closed') return `the incident archived while open is ${arch ? `${arch.status}, archivedAt ${arch.archivedAt}` : 'missing'}`;
      return true;
    },
  });

  // ── documents (and the same in the IFC variant): WP9.health.docControlRecords ──
  const documents = async (s, persona, P2, tag, people) => {
    const rfis = async (s2) => kit.rows(await s2.get(persona, `${P2}/rfi?limit=100`));
    const subs = async (s2) => kit.rows(await s2.get(persona, `${P2}/submittals?limit=100`));
    const openSubject = b.name(`${tag} RFI overdue open`);
    // Overdue by both its dueDate and its responseRequiredBy.
    const openRfi = await s.create(`${tag}.rfi.open`, 'site', `${P2}/rfi`, {
      subject: openSubject, question: `Confirm the slab edge detail (${b.code})`, priority: 'normal', discipline: 'Structural', status: 'open',
      managerUserId: people.pm, assigneeUserIds: [people.planner], raisedDate: kit.addDays(S, 2), dueDate: kit.addDays(S, 9), responseRequiredBy: kit.addDays(S, 9), comment: b.ref(`${tag}-rfi-open`),
    }, {
      // Both dates asserted (round 2, R2-F): the record set is "overdue by dueDate and responseRequiredBy".
      fields: { subject: openSubject, status: 'open', dueDate: is.day(kit.addDays(S, 9)), responseRequiredBy: is.day(kit.addDays(S, 9)) },
      get: (id) => `${P2}/rfi/${id}`,
      find: async (s2) => kit.only(s2, await rfis(s2), (x) => x.subject === openSubject, `the RFI ${openSubject}`),
    });
    // Past its stored dueDate, responseRequiredBy null (the book's record set).
    const answeredSubject = b.name(`${tag} RFI answered after due`);
    const answered = await s.create(`${tag}.rfi.answered`, 'site', `${P2}/rfi`, {
      subject: answeredSubject, question: `Confirm the blockwork bond (${b.code})`, priority: 'normal', discipline: 'Architectural', status: 'open',
      managerUserId: people.pm, assigneeUserIds: [people.planner], raisedDate: kit.addDays(S, 3), dueDate: kit.addDays(S, 10), comment: b.ref(`${tag}-rfi-answered`),
    }, {
      fields: { subject: answeredSubject, status: 'open', responseRequiredBy: is.absent },
      get: (id) => `${P2}/rfi/${id}`,
      find: async (s2) => kit.only(s2, await rfis(s2), (x) => x.subject === answeredSubject, `the RFI ${answeredSubject}`),
    });
    await s.act(`${tag}.rfi.answer`, 'planner', 'POST', `${P2}/rfi/${answered.id}/answer`, { response: `Stretcher bond as drawn (${b.code})`, answeredDate: R, comment: b.ref(`${tag}-rfi-answer`) }, {
      fields: { status: 'answered' },
      verify: async (s2) => (await s2.get(persona, `${P2}/rfi/${answered.id}`)).status === 'answered',
    });
    const submittals = [];
    for (const n of [1, 2]) {
      const title = b.name(`${tag} submittal ${n} pending`);
      const row = await s.create(`${tag}.submittal.${n}`, 'site', `${P2}/submittals`, {
        title, specRef: `03 30 00.${n}`, discipline: 'Structural', managerUserId: people.pm, leadTimeWeeks: 2, reviewDays: 7,
        requiredOnSite: b.date(60, { future: true }), dueDate: b.date(21, { future: true }), comment: b.ref(`${tag}-submittal-${n}`),
      }, {
        fields: { title, status: 'pending' },
        get: (id) => `${P2}/submittals/${id}`,
        find: async (s2) => kit.only(s2, await subs(s2), (x) => x.title === title, `the submittal ${title}`),
      });
      submittals.push(row.id);
    }
    return { openRfi: openRfi.id, answeredRfi: answered.id, submittals };
  };

  await b.step('documents', async (s) => documents(s, 'pm', P, 'HLT', ids));

  // ── supply chain: one critical long-lead item, not ordered, order-by passed ──
  const longLeadList = async (s2) => kit.rows(await s2.get('procurement', `${P}/long-lead`));
  await b.step('long-lead', async (s) => {
    const item = b.name('Long-lead switchgear');
    const row = await s.create('longlead', 'procurement', `${P}/long-lead`, {
      item, activityId: acts.H50, leadWeeks: 8, requiredTiming: 'activity_finish', needOffsetDays: 0, bufferDays: 14, criticality: 'critical', status: 'not_ordered', supplier: b.name('Switchgear supplier'),
    }, {
      fields: { item, status: 'not_ordered', criticality: 'critical' },
      get: null, // re-read live by the step's verify
      find: async (s2) => kit.only(s2, await longLeadList(s2), (x) => x.item === item, `the long-lead item ${item}`),
    });
    return { id: row.id };
  }, {
    verify: async (s, out) => {
      const row = (await longLeadList(s)).find((x) => x.id === out.id);
      return (row?.status === 'not_ordered' && row.criticality === 'critical') || `the long-lead item ${out.id} is ${row ? `${row.status}, ${row.criticality}` : 'missing'}`;
    },
  });

  // ── one open risk whose mitigation is overdue (workspace schedule 60 - 5 = 55) ──
  const riskList = async (s2) => kit.rows(await s2.get('pm', `${P}/risks`));
  await b.step('risk', async (s) => {
    const description = b.name('Risk late design release overdue mitigation');
    const row = await s.create('risk.overdue', 'pm', `${P}/risks`, {
      description, probability: 'medium', impact: 'high', mitigation: `Chase the design team weekly (${b.code})`, dueDate: CUTOFF, status: 'open', activityId: acts.H50,
    }, {
      fields: { description, status: 'open', dueDate: is.day(CUTOFF) },
      get: null, // re-read live by the step's verify
      find: async (s2) => kit.only(s2, await riskList(s2), (x) => x.description === description, 'the overdue risk'),
    });
    return { id: row.id };
  }, {
    verify: async (s, out) => {
      const row = (await riskList(s)).find((x) => x.id === out.id);
      return (row?.status === 'open' && kit.day(row.dueDate) === CUTOFF) || `the overdue risk ${out.id} is ${row ? `${row.status}, due ${kit.day(row.dueDate)}` : 'missing'}`;
    },
  });

  // ── the IFC variant: the same document records plus 2 drawings, 1 IFC ──────
  const VARIANT_TEAM = [['planner', 'planning_eng'], ['site', 'site_engineer']];
  const variant = await b.step('variant.project', async (s) => {
    const name = b.name('Health IFC variant');
    const search = `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(name)}`;
    const project = await s.create('variant.project', 'pm', '/projects', {
      name, startDate: S, projectCalendar: 'five_day', currency: 'EGP', type: 'building', contractType: 'unit_rate',
    }, {
      fields: { name, archivedAt: is.absent, projectCalendar: 'five_day' },
      get: (id) => `/projects/${id}`,
      adopt: true,
      find: async (s2) => kit.only(s2, kit.rows(await s2.get('pm', search)), (p) => p.name === name && !p.archivedAt, `the live project named ${name}`),
    });
    const P2 = `/projects/${project.id}`;
    const team = {};
    for (const [key, role] of VARIANT_TEAM) {
      const userId = await b.userId(key);
      const data = await s.create(`variant.team.${key}`, 'pm', `${P2}/team`, { userId, role }, {
        expect: [201, 200], named: false, idOf: (d) => d?.userId ?? null, fields: { userId, assignmentRole: role },
        get: null, // re-read live by the step's verify
        // Interrupted: the assignment, found by user id, is adopted (never sent again).
        find: async (s2) => kit.only(s2, kit.rows(await s2.get('pm', `${P2}/team`)), (i) => i.userId === userId, `${key} on the variant project`),
      });
      team[key] = { userId, role: data.assignmentRole };
    }
    return { projectId: project.id, team };
  }, {
    verify: async (s, out) => {
      const project = await s.get('pm', `/projects/${out.projectId}`);
      if (project.archivedAt) return `the variant project ${out.projectId} is archived`;
      const members = kit.rows(await s.get('pm', `/projects/${out.projectId}/team`));
      for (const [key, member] of Object.entries(out.team || {})) {
        const row = members.find((i) => i.userId === member.userId);
        if (row?.assignmentRole !== member.role) return `${key} is ${row ? row.assignmentRole : 'not'} on the variant project, not ${member.role}`;
      }
      return true;
    },
  });
  const VARIANT_DRAWINGS = [[1, 'ifc'], [2, 'tender']];
  const drawingList = async (s2) => kit.rows(await s2.get('planner', `/projects/${variant.projectId}/drawings`));
  await b.step('variant.documents', async (s) => {
    const P2 = `/projects/${variant.projectId}`;
    const docs = await documents(s, 'pm', P2, 'VAR', ids);
    const out = { ...docs, drawings: [] };
    for (const [n, purpose] of VARIANT_DRAWINGS) {
      const title = b.name(`Variant drawing ${n} ${purpose}`);
      const row = await s.create(`variant.drawing.${n}`, 'planner', `${P2}/drawings`, {
        drawingNumber: b.ref(`S-${n}`), title, status: 'active', purpose, issueDate: kit.addDays(S, 1), comment: b.ref(`drawing-${n}`),
      }, {
        fields: { title, purpose },
        get: null, // re-read live by the step's verify
        find: async (s2) => kit.only(s2, await drawingList(s2), (x) => x.title === title, `the drawing ${title}`),
      });
      out.drawings.push(row.id);
    }
    return out;
  }, {
    needs: ['variant.project'],
    verify: async (s, out) => {
      const list = await drawingList(s);
      for (const [i, [, purpose]] of VARIANT_DRAWINGS.entries()) {
        const row = list.find((x) => x.id === out.drawings[i]);
        if (row?.purpose !== purpose) return `variant drawing ${i + 1} is ${row ? row.purpose : 'missing'}, not ${purpose}`;
      }
      return true;
    },
  });

  // ── what the health card reads now (records as built; HEAD's figures) ──────
  // The two readings where HEAD departs from the answer book are judged in steps of their own
  // (health.delayed, HR-K2; health.safety, HR-K1; round 2, R2-A), never asserted here as DONE.
  const healthDims = (s, card) => {
    const dims = card?.dimensions || [];
    const keys = dims.map((d) => d.key);
    s.assert(new Set(keys).size === keys.length, `the health card names each dimension once (${keys.join(', ')})`);
    return Object.fromEntries(dims.map((d) => [d.key, d]));
  };
  await b.step('health.read', async (s) => {
    const card = await s.get('pm', `${P}/health`);
    const dim = healthDims(s, card);
    // Record counts the build made (facts, not rules).
    s.expectFields(dim.schedule.detail, { spi: H.spiDetail.value }, 'schedule detail (delayedActivities: step health.delayed)');
    s.expectFields(dim.cost.detail, { cpi: H.cpiDetail.value }, 'cost detail');
    s.expectFields(dim.commercial.detail, { approvedChangeOrders: 2, approvedScheduleImpactDays: 10 }, 'commercial detail');
    s.expectFields(dim.quality.detail, { majorNCRs: 1, minorNCRs: 1, failedITPs: 1 }, 'quality detail (legacy register only)');
    s.expectFields(dim.safety.detail, { ltiCount: 1, fatalityCount: 0 }, 'safety detail (one LTI, no fatality; the open investigations and the score: step health.safety)');
    s.expectFields(dim.docControl.detail, { overdueRfis: 2, pendingSubmittals: 2, ifcRatio: '100%' }, 'doc-control detail');
    s.expectFields(dim.supplyChain.detail, { criticalRisks: 1, atRiskItems: 1 }, 'supply-chain detail');
    const scores = Object.fromEntries(Object.entries(dim).map(([k, d]) => [k, d.score]));
    s.expectFields(scores, {
      schedule: H.scheduleScore.value, cost: H.costScore.value, commercial: H.commercialCard.value, quality: H.qualityInCode.value,
      docControl: H.docControlCard.value, supplyChain: H.supplyChainCard.value,
    }, 'the card scores as HEAD computes them on these records (safety: step health.safety)');
    const variantCard = await s.get('pm', `/projects/${variant.projectId}/health`);
    const vdoc = kit.exactlyOne(s, variantCard.dimensions || [], (d) => d.key === 'docControl', 'the variant card\'s doc-control dimension');
    s.expectFields({ score: vdoc.score, ifcRatio: vdoc.detail?.ifcRatio }, { score: H.docControlIfcVariant.value, ifcRatio: '50%' }, 'the IFC variant doc-control card');
    b.note(`087-HLT card scores at the build (HEAD): ${JSON.stringify(scores)}; overall ${card.overallScore}`);
    return {
      scores,
      overall: card.overallScore,
      variantDocControl: vdoc.score,
      runDate: R,
      projectStart: S,
      // The WP-9 health proof reads the card on a date in this window (WP9.health.delayedExampleDates note).
      delayedWindow: { from: X.windowFrom, through: X.windowThrough, calendarFinish: X.calendarFinish, workingFinish: X.workingFinish },
    };
  }, { needs: ['ev.check', 'change-orders', 'quality', 'safety', 'documents', 'long-lead', 'risk', 'variant.documents'] });

  // ── delayed activities against the book (WP9.health.delayedExpected; R2-A) ──
  // Expected 0: H50's working-day finish is after the run date (HR-K2's recommendation). HEAD adds
  // earlyFinish to the start as calendar days, so H50's finish has passed and the card counts 1: the
  // book's `today`, BLOCKED HR-K2 with the product's reading. The two readings differ only inside the
  // window asserted at the top (windowFrom <= run date <= windowThrough).
  await b.step('health.delayed', async (s) => {
    const card = await s.get('pm', `${P}/health`);
    const schedule = healthDims(s, card).schedule;
    s.assert(Boolean(schedule), 'the health card has a schedule dimension', (card?.dimensions || []).map((d) => d.key));
    const observed = { runDate: R, delayedActivities: schedule.detail?.delayedActivities ?? null, detail: schedule.detail || null, score: schedule.score, window: { from: X.windowFrom, through: X.windowThrough, calendarFinish: X.calendarFinish, workingFinish: X.workingFinish } };
    if (observed.delayedActivities === H.delayedExpected.value) return observed;
    if (observed.delayedActivities === H.delayedExpected.today) {
      s.blocked('HR-K2', { expected: H.delayedExpected.value, known: H.delayedExpected.today, ...observed, note: `GET /projects/:id/health counts H50 delayed: its calendar-day finish ${X.calendarFinish} is before the run date ${R}, its working-day finish ${X.workingFinish} after it (WP9.health.delayedExpected: ${H.delayedExpected.value}, today ${H.delayedExpected.today})` });
    }
    s.assert(false, `the card's delayed activities are neither the book's ${H.delayedExpected.value} nor HR-K2's known ${H.delayedExpected.today}`, observed);
    return null;
  }, { needs: ['health.read'] });

  // ── safety against the book (WP9.health.safetyExpected; R2-A) ───────────────
  // Expected 75 = 100 - 20 (the closed LTI) - 5 (the open incident), the incident archived while open
  // excluded. HEAD counts every status but 'closed' as an open investigation, the archived one included:
  // 100 - 20 - 5 x 2 = 70, the book's `today`, BLOCKED HR-K1 (the plan's HR-K1 row: archived excluded),
  // as 052-FLD's safety.score.
  await b.step('health.safety', async (s) => {
    const card = await s.get('pm', `${P}/health`);
    const safety = healthDims(s, card).safety;
    s.assert(Boolean(safety), 'the health card has a safety dimension', (card?.dimensions || []).map((d) => d.key));
    const detail = safety.detail || {};
    s.expectFields(detail, { ltiCount: 1, fatalityCount: 0 }, 'the safety detail (one LTI, no fatality)');
    // The card's own detail reproduces its score under the book's rule (FC.rules.safetyScore), so the open
    // investigations it counted are the ones the score carries: 1 for the book's 75, 2 for HR-K1's 70.
    const byRule = FC.rules.safetyScore({ fatalities: Number(detail.fatalityCount), lti: Number(detail.ltiCount), open: Number(detail.openInvestigations) });
    const observed = { score: safety.score, detail, scoreFromDetailByBookRule: byRule };
    s.assert(byRule === safety.score, `the card's safety detail gives ${byRule} under the book's rule (rules.safetyScore), its score is ${safety.score}`, observed);
    if (safety.score === H.safetyExpected.value) return observed;
    if (safety.score === H.safetyExpected.today) {
      s.blocked('HR-K1', { expected: H.safetyExpected.value, known: H.safetyExpected.today, ...observed, note: 'GET /projects/:id/health counts the incident archived while open as an open investigation (status != closed): 100 - 20 - 5 x 2 = 70 (WP9.health.safetyExpected today)' });
    }
    s.assert(false, `the safety card is neither the book's ${H.safetyExpected.value} nor HR-K1's known ${H.safetyExpected.today} (archived incident counted open)`, observed);
    return null;
  }, { needs: ['health.read'] });
});
